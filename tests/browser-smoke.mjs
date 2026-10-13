/**
 * Real-browser integration smoke test. Start the application server first.
 *   npm start
 *   PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/browser-smoke.mjs
 * Optional: BASE_URL, BROWSER_CHANNEL (default: chrome), QA_SCREENSHOT_DIR.
 *
 * Only same-origin business API responses are mocked. Direct browser requests to
 * mcp.mcd.cn fail this test. The eventual Afdian navigation is captured and
 * aborted before network access. No real token, order, or payment is used.
 * Responses match the normalized public menu contract; MCP authentication
 * and the server-side adapter are tested separately.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createShareUrl, decodeConfig, normalizeMenu } from '../src/lib/domain.js';

const playwrightModule = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(playwrightModule ? pathToFileURL(resolve(playwrightModule)).href : 'playwright');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const API_BASE = new URL('/api/', BASE).href;
const ARTIFACTS = resolve(process.env.QA_SCREENSHOT_DIR || 'work/qa');
await mkdir(ARTIFACTS, { recursive: true });
const UID = 'a'.repeat(32);
const REPO = 'qa-maintainer/tiny-tool';
const publicConfig = { v: 1, repo: REPO, afdianId: UID, storeCode: 'QA001', beCode: 'QA-BE', beType: 1, orderType: 1 };
let shareUrl = createShareUrl(BASE, publicConfig);

const meals = {
  '900001': { name: 'QA 巨无霸', currentPrice: '26.50', originalPrice: '29.00', image: '', discountType: '促销优惠' },
  '900002': { name: 'QA 中薯条', currentPrice: '12.00', originalPrice: '12.50', image: '', discountType: null },
  '900003': { name: 'QA 可乐', currentPrice: '9.50', originalPrice: '10.00', image: '', discountType: null },
  '900004': { name: 'QA 麦乐鸡', currentPrice: '18.00', originalPrice: '18.00', image: '', discountType: null },
};
const menu = { frequent: [], meals, categories: [
  { name: '汉堡', meals: [{ code: '900001', tags: [] }], daypart: 8 },
  { name: '小食', meals: [{ code: '900002', tags: [] }, { code: '900004', tags: [] }], daypart: 8 },
  { name: '饮品', meals: [{ code: '900003', tags: [] }], daypart: 8 },
] };
const categoryLabelMenu = { frequent: [], meals, categories: [
  { name: ' \n 热销\t 推荐 \r\n ', meals: [{ code: '900001' }, { code: '900001' }] },
  { name: '热销 推荐', meals: [{ code: '900002' }] },
  { name: null, meals: [{ code: '900003' }] },
  { meals: [{ code: '900004' }] },
  { name: ' \t\r ', meals: [{ code: '900001' }, { code: '900003' }] },
  { name: '全部', meals: [{ code: '900002' }] },
] };
const requests = [];
const browserErrors = [];
const routeErrors = [];
const results = [];
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'zh-CN' });
context.on('page', page => page.on('pageerror', error => browserErrors.push(error.message)));
await context.route(/^https?:\/\/mcp\.mcd\.cn(?:[/:?#]|$)/, route => {
  routeErrors.push('Browser attempted to contact mcp.mcd.cn directly');
  return route.abort('blockedbyclient');
});

async function attachMock(page, scenario = {}) {
  await page.route(`${API_BASE}**`, async route => {
    const request = route.request();
    const responseHeaders = { 'Content-Type': 'application/json' };
    try {
      assert.equal(request.method(), 'POST', 'Business API unexpectedly received a preflight');
      assert.equal(request.headers().authorization, undefined, 'Browser sent an Authorization header');
      assert.equal(request.headers()['x-mcd-token'], undefined, 'Browser sent an MCP token');
      const path = new URL(request.url()).pathname;
      const body = request.postDataJSON();
      requests.push({ path, body });
      const json = data => route.fulfill({ status: 200, headers: responseHeaders, body: JSON.stringify({ data }) });
      const unavailable = () => route.fulfill({ status: 503, headers: responseHeaders, body: JSON.stringify({ error: '麦当劳服务暂时不可用，请稍后重试' }) });
      if (path === '/api/connect') return scenario.connectError ? unavailable() : json({ ok: true });
      if (path === '/api/stores') {
        assert.equal(body.city, '上海');
        assert.equal(body.searchType, undefined);
        return json(body.keyword === '没有餐厅' ? [] : [
          { storeCode: 'QA001', beCode: 'QA-BE', storeName: 'QA 人民广场餐厅', address: '上海市 QA 测试路 1 号', distance: '300m', businessStatus: true },
          { storeCode: 'QA002', beCode: 'QA-BE2', storeName: 'QA 南京路餐厅', address: '上海市 QA 测试路 2 号', distance: '800m', businessStatus: true },
        ]);
      }
      assert.deepEqual(body.config, { storeCode: 'QA001', beCode: 'QA-BE', orderType: 1, beType: 1 });
      if (path === '/api/menu') {
        if (scenario.menuError) return unavailable();
        if (scenario.malformed) return json({ products: null, categories: [] });
        const source = structuredClone(scenario.empty ? { meals: {}, categories: [] } : scenario.categoryLabels ? categoryLabelMenu : menu);
        if (scenario.zeroPrice) source.meals['900001'].currentPrice = '0';
        return json(normalizeMenu(source));
      }
      assert.fail(`Unexpected API request: ${path}; menu selection must calculate locally`);
    } catch (error) {
      routeErrors.push(error.message);
      return route.fulfill({ status: 500, headers: responseHeaders, body: JSON.stringify({ error: error.message }) });
    }
  });
}

async function pageAt(url = BASE, scenario = {}) {
  const page = await context.newPage();
  await attachMock(page, scenario);
  await page.goto(url, { waitUntil: 'networkidle' });
  return page;
}
async function screenshot(page, name) {
  // Blurring avoids Chromium scrolling a focused field back into view while
  // full-page capture temporarily resizes a narrow viewport.
  await page.evaluate(async () => {
    document.activeElement?.blur();
    window.scrollTo({ top: 0, behavior: 'instant' });
    await new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  });
  await page.screenshot({ path: resolve(ARTIFACTS, `${name}.png`), fullPage: true, animations: 'disabled' });
}
async function assertNoOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(Math.max(dimensions.html, dimensions.body) <= dimensions.viewport + 1, `${label}: horizontal overflow ${JSON.stringify(dimensions)}`);
}
async function assertNoBrowserCredentials(page) {
  assert.equal(await page.locator('input[type="password"], input[name="token"]').count(), 0, 'Page asks a visitor for credentials');
  const values = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie }));
  assert.equal(/mcd.?token|authorization/i.test(values), false, 'Browser storage contains credential-related state');
}
async function run(name, test) {
  try { await test(); results.push({ name, status: 'PASS' }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, status: 'FAIL', message: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
// The author builder is a four-step wizard: identity, restaurant, payout
// account, share link. The form opens on sponsoring a person, so the
// repository field only appears on the project tab.
async function fillIdentity(page, repo = `https://github.com/${REPO}`) {
  await page.getByRole('button', { name: '赞助项目' }).click();
  await page.locator('[name="repo"]').fill(repo);
}
async function pickStore(page, keyword = '人民广场') {
  await page.locator('[name="city"]').fill('上海');
  await page.locator('[name="keyword"]').fill(keyword);
  await page.getByRole('button', { name: '搜索餐厅', exact: true }).click();
  await page.locator('.store-option').first().waitFor();
  await page.locator('.store-option').first().click();
  await page.locator('[data-action="continue-payment"]').click();
  await page.locator('[name="afdianId"]').waitFor();
}
async function waitForAmount(page, amount) {
  await page.waitForFunction(expected => {
    const displayed = document.querySelector('.amount-row strong')?.textContent?.replace(/[¥￥\s]/g, '');
    const sponsor = document.querySelector('[data-action="pay"]');
    return displayed === expected && sponsor && !sponsor.disabled;
  }, amount);
  assert.equal(await page.locator('[data-action="quote"], [data-action="confirm-meal"]').count(), 0, 'Selection must not require another calculation or confirmation step');
}
async function assertSponsorshipState(page, disabled = true) {
  assert.equal(await page.locator('[data-action="pay"]').isDisabled(), disabled);
  assert.equal(await page.locator('#custom-blessing').isVisible(), true, 'The message field must always be visible');
  assert.equal(await page.locator('[data-action="confirm-meal"]').count(), 0);
}

try {
  await run('author → store → share → menu → local amount and optional message → Afdian URL', async () => {
    const author = await pageAt();
    await screenshot(author, '01-author-desktop');
    await assertNoBrowserCredentials(author);
    const requestCount = requests.length;
    await author.locator('#author-connect button[type="submit"]').click();
    assert.equal(requests.length, requestCount, 'Blank author form sent MCP requests');
    await fillIdentity(author);
    await author.locator('#author-connect button[type="submit"]').click();
    await author.locator('#store-search').waitFor();
    await author.locator('[name="city"]').fill('上海');
    await author.locator('[name="keyword"]').fill('没有餐厅');
    await author.getByRole('button', { name: '搜索餐厅', exact: true }).click();
    await author.getByText('这里还没有找到餐厅', { exact: true }).waitFor();
    assert.equal(await author.locator('[data-action="continue-payment"]').isDisabled(), true);
    await author.locator('[name="keyword"]').fill('人民广场');
    await author.getByRole('button', { name: '搜索餐厅', exact: true }).click();
    await author.locator('.store-option').first().waitFor();
    assert.equal(await author.locator('.store-option').count(), 2);
    await author.locator('.store-option').first().click();
    await author.locator('[data-action="continue-payment"]').click();
    await author.locator('[name="afdianId"]').fill(UID);
    await author.locator('[data-action="generate"]').click();
    await author.locator('.badge-preview a').waitFor();
    shareUrl = await author.locator('.badge-preview a').getAttribute('href');
    assert.equal(await author.getByRole('textbox', { name: '您的赞助链接' }).inputValue(), shareUrl);
    const decoded = decodeConfig(new URL(shareUrl).search.slice(1));
    assert.equal(new URL(shareUrl).pathname, '/gift');
    assert.deepEqual(decoded, publicConfig);
    const markdown = await author.locator('.code-box').inputValue();
    assert.ok(markdown.includes(shareUrl) && markdown.includes('/assets/badge-zh-cn.svg'));
    await author.getByRole('button', { name: 'HTML', exact: true }).click();
    const html = await author.locator('.code-box').inputValue();
    // The HTML snippet escapes the query separators it embeds in an attribute.
    assert.ok(html.startsWith('<a href=') && html.includes(shareUrl.replace(/&/g, '&amp;')));
    for (const artifact of [shareUrl, markdown, html, JSON.stringify(decoded)]) {
      assert.equal(artifact.toLowerCase().includes('token'), false);
    }
    await screenshot(author, '02-author-share');
    await assertNoBrowserCredentials(author);

    const sponsor = await pageAt(shareUrl);
    await assertNoBrowserCredentials(sponsor);
    await assertSponsorshipState(sponsor);
    await sponsor.locator('#meal-search').waitFor();
    assert.equal(await sponsor.locator('.product-card').count(), 4);
    await sponsor.getByRole('navigation', { name: '餐品分类' }).getByRole('button', { name: /^02\s*小食$/ }).click();
    assert.equal(await sponsor.locator('.product-card').count(), 2);
    await sponsor.getByRole('searchbox', { name: '搜索餐品' }).fill('鸡');
    assert.equal(await sponsor.locator('.product-card').count(), 1);
    await sponsor.getByRole('searchbox', { name: '搜索餐品' }).fill('QA 不存在的餐品');
    await sponsor.getByText('暂时没有匹配的餐品', { exact: true }).waitFor();
    await sponsor.getByRole('searchbox', { name: '搜索餐品' }).fill('');
    await sponsor.getByRole('navigation', { name: '餐品分类' }).getByRole('button', { name: /^00\s*全部餐品$/ }).click();
    const selectionRequestCount = requests.length;
    await sponsor.getByRole('button', { name: '添加QA 巨无霸', exact: true }).click();
    await sponsor.getByRole('button', { name: '增加QA 巨无霸', exact: true }).click();
    await sponsor.getByRole('button', { name: '添加QA 中薯条', exact: true }).click();
    await waitForAmount(sponsor, '65.00');
    await assertSponsorshipState(sponsor, false);
    await sponsor.locator('#custom-blessing').fill('');
    assert.equal(await sponsor.locator('[data-action="pay"]').isDisabled(), false, 'Leaving a message is optional');

    const blessing = '谢谢这个开源项目！\n愿每次合并都顺利。 🍔';
    await sponsor.locator('#custom-blessing').fill(blessing);
    await sponsor.getByRole('button', { name: '增加QA 巨无霸', exact: true }).click();
    await waitForAmount(sponsor, '91.50');
    await sponsor.locator('.gift-aside').getByRole('button', { name: '减少QA 巨无霸', exact: true }).click();
    await sponsor.getByRole('button', { name: '添加QA 可乐', exact: true }).click();
    await waitForAmount(sponsor, '74.50');
    await assertSponsorshipState(sponsor, false);
    assert.equal(await sponsor.locator('#custom-blessing').inputValue(), blessing, 'Quantity changes must preserve the message');
    assert.equal((await sponsor.locator('[data-action="pay"]').innerText()).trim(), '就这样');
    assert.equal(requests.length, selectionRequestCount, 'Selecting food unexpectedly sent another API request');
    await screenshot(sponsor, '03-sponsor-desktop');
    for (const width of [390, 320]) {
      await sponsor.setViewportSize({ width, height: 844 });
      await assertNoOverflow(sponsor, `Sponsor ${width}px`);
      if (width === 390) await screenshot(sponsor, '04-sponsor-mobile');
    }
    await assertNoBrowserCredentials(sponsor);
    let capturedUrl;
    let capture;
    const captured = new Promise(resolveCapture => { capture = resolveCapture; });
    const interceptAfdian = route => {
      capturedUrl = route.request().url();
      capture();
      // Answered locally: the payment site is never reached, and the new tab
      // still ends up with a document the test can inspect.
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: '<title>stubbed payment page</title>' });
    };
    // A new tab's first request must be intercepted at the context level.
    await context.route('https://afdian.com/**', interceptAfdian);
    const originalUrl = sponsor.url();
    const newTab = context.waitForEvent('page', { timeout: 5000 });
    await sponsor.locator('[data-action="pay"]').click();
    const paymentTab = await newTab;
    let timeout;
    try { await Promise.race([captured, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('No Afdian navigation within 5 seconds')), 5000); })]); }
    catch (error) { await screenshot(sponsor, 'payment-failure'); throw new Error(`${error.message}; UI: ${await sponsor.locator('.error-box').allTextContents()}`); }
    finally { clearTimeout(timeout); }
    const destination = new URL(capturedUrl);
    assert.equal(destination.origin, 'https://afdian.com');
    assert.equal(destination.pathname, '/order/create');
    assert.equal(destination.searchParams.get('custom_price'), '74.50');
    assert.equal(destination.searchParams.get('user_id'), UID);
    assert.equal(destination.searchParams.get('month'), '1');
    assert.equal(sponsor.url(), originalUrl, 'Afdian must not replace the sponsor page');
    // The tab starts blank and then navigates, so wait for the destination
    // document before asking it anything.
    await paymentTab.waitForURL('https://afdian.com/**');
    assert.equal(await paymentTab.evaluate(() => window.opener), null, 'The payment tab must not control the sponsor page');
    const remark = destination.searchParams.get('remark');
    for (const part of [blessing, REPO, 'Create by Buy me a Big Mac']) assert.ok(remark.includes(part), `Payment remark missing ${part}`);
    assert.match(remark, /QA 巨无霸\s+×2\s+￥53\.00/u);
    assert.match(remark, /QA 中薯条\s+×1\s+￥12\.00/u);
    assert.match(remark, /QA 可乐\s+×1\s+￥9\.50/u);
    assert.match(remark, /总计\s+×4\s+￥74\.50/u);
    // The restaurant is deliberately absent from the link, the receipt and the remark.
    assert.equal(remark.includes('QA 人民广场餐厅'), false, 'Payment remark names the restaurant');
    assert.ok(requests.some(request => request.path === '/api/stores'));
    assert.ok(requests.some(request => request.path === '/api/menu'));
    assert.equal(capturedUrl.toLowerCase().includes('token'), false);
    await paymentTab.close();
    await context.unroute('https://afdian.com/**', interceptAfdian);
    await author.close();
    await sponsor.close();
  });

  await run('invalid share link is rejected before any API request', async () => {
    const count = requests.length;
    const page = await pageAt(`${BASE}gift?INVALID--NOT-JSON`);
    await page.getByRole('heading', { name: '这个赞助链接不太对。' }).waitFor();
    assert.equal(await page.locator('input[type="password"]').count(), 0);
    assert.equal(requests.length, count);
    await screenshot(page, '05-invalid-share');
    await page.close();
  });

  await run('author service error shows a retryable message and recovers', async () => {
    // The identity step only validates what the author typed; the service is
    // first reached when searching for a restaurant.
    const scenario = { connectError: true };
    const page = await pageAt(BASE, scenario);
    await fillIdentity(page);
    await page.locator('#author-connect button[type="submit"]').click();
    await page.locator('#store-search').waitFor();
    await page.locator('[name="city"]').fill('上海');
    await page.locator('[name="keyword"]').fill('人民广场');
    await page.getByRole('button', { name: '搜索餐厅', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(), /服务暂时不可用/);
    assert.equal(await page.locator('.store-option').count(), 0);
    assert.equal(await page.locator('[data-action="continue-payment"]').isDisabled(), true);
    scenario.connectError = false;
    await page.getByRole('button', { name: '搜索餐厅', exact: true }).click();
    await page.locator('.store-option').first().waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);
    await assertNoBrowserCredentials(page);
    await page.close();
  });

  await run('automatic sponsor menu error can retry without credentials', async () => {
    const scenario = { menuError: true };
    const page = await pageAt(shareUrl, scenario);
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(), /服务暂时不可用/);
    await assertSponsorshipState(page);
    scenario.menuError = false;
    await page.getByRole('button', { name: '重新加载菜单' }).click();
    await page.locator('#meal-search').waitFor();
    await assertNoBrowserCredentials(page);
    await page.close();
  });

  await run('empty menu cannot be sponsored', async () => {
    const page = await pageAt(shareUrl, { empty: true });
    await page.getByText('暂时没有匹配的餐品', { exact: true }).waitFor();
    assert.equal(await page.locator('.product-card').count(), 0);
    assert.equal(await page.locator('[data-action="quote"]').count(), 0);
    await assertSponsorshipState(page);
    await screenshot(page, '06-empty-menu');
    await page.close();
  });

  await run('malformed menu shows an error rather than fabricated food', async () => {
    const page = await pageAt(shareUrl, { malformed: true });
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(), /菜单格式/);
    assert.equal(await page.locator('.product-card').count(), 0);
    await assertSponsorshipState(page);
    await page.close();
  });

  await run('messy category labels merge products and preserve separate global and restaurant All tabs', async () => {
    const page = await pageAt(shareUrl, { categoryLabels: true });
    await page.locator('#meal-search').waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);
    const categoryRail = page.getByRole('navigation', { name: '餐品分类' });
    const categoryButtons = categoryRail.getByRole('button');
    assert.deepEqual(await categoryButtons.locator('b').allTextContents(), ['全部餐品', '热销 推荐', '其他餐品', '餐厅全部']);
    assert.deepEqual(await categoryButtons.locator('span').allTextContents(), ['00', '01', '02', '03']);
    const visibleProducts = async () => (await page.locator('.product-card h3').allTextContents()).sort();
    const allProducts = Object.values(meals).map(meal => meal.name).sort();
    assert.deepEqual(await visibleProducts(), allProducts);

    await categoryRail.getByRole('button', { name: /^01\s*热销 推荐$/ }).click();
    assert.deepEqual(await visibleProducts(), ['QA 巨无霸', 'QA 中薯条'].sort(), 'Duplicate normalized groups did not form a deduplicated union');
    await categoryRail.getByRole('button', { name: /^02\s*其他餐品$/ }).click();
    assert.deepEqual(await visibleProducts(), ['QA 可乐', 'QA 麦乐鸡', 'QA 巨无霸'].sort(), 'Missing, null, and empty category groups lost products');

    const restaurantAll = categoryRail.getByRole('button', { name: /^03\s*餐厅全部$/ });
    const globalAll = categoryRail.getByRole('button', { name: /^00\s*全部餐品$/ });
    await restaurantAll.click();
    assert.deepEqual(await visibleProducts(), ['QA 中薯条']);
    assert.equal(await restaurantAll.getAttribute('aria-pressed'), 'true');
    assert.equal(await globalAll.getAttribute('aria-pressed'), 'false');
    await globalAll.click();
    assert.deepEqual(await visibleProducts(), allProducts);
    assert.equal(await restaurantAll.getAttribute('aria-pressed'), 'false');
    assert.equal(await globalAll.getAttribute('aria-pressed'), 'true');

    await page.getByRole('button', { name: '添加QA 巨无霸', exact: true }).click();
    await waitForAmount(page, '26.50');
    await assertSponsorshipState(page, false);
    await screenshot(page, '08-category-labels');
    await assertNoBrowserCredentials(page);
    await page.close();
  });

  await run('author layout fits 390px and 320px screens', async () => {
    const page = await pageAt();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await assertNoOverflow(page, `Author ${width}px`);
      if (width === 390) await screenshot(page, '07-author-mobile');
    }
    // Each wizard step has its own layout inside a fixed-height panel.
    await page.setViewportSize({ width: 390, height: 844 });
    await fillIdentity(page);
    await page.locator('#author-connect button[type="submit"]').click();
    await page.locator('#store-search').waitFor();
    await assertNoOverflow(page, 'Author restaurant step 390px');
    await pickStore(page);
    await assertNoOverflow(page, 'Author payout step 390px');
    await page.locator('[name="afdianId"]').fill(UID);
    await page.locator('[data-action="generate"]').click();
    await page.locator('.badge-preview a').waitFor();
    await assertNoOverflow(page, 'Author share step 390px');
    await screenshot(page, '09-author-share-mobile');
    await page.close();
  });

  await run('a zero-price product can accompany paid food, but a zero total cannot be sponsored', async () => {
    const page = await pageAt(shareUrl, { zeroPrice: true });
    await assertSponsorshipState(page);
    const count = requests.length;
    await page.getByRole('button', { name: '添加QA 巨无霸', exact: true }).click();
    assert.equal(await page.locator('.gift-aside .cart-line').count(), 1);
    await assertSponsorshipState(page);
    assert.equal(Number((await page.locator('.amount-row strong').innerText()).replace(/[¥￥\s]/g, '')), 0);
    await page.getByRole('button', { name: '添加QA 中薯条', exact: true }).click();
    await waitForAmount(page, '12.00');
    assert.equal(await page.locator('.gift-aside .cart-line').count(), 2);
    await page.locator('.gift-aside').getByRole('button', { name: '减少QA 中薯条', exact: true }).click();
    await assertSponsorshipState(page);
    assert.equal(Number((await page.locator('.amount-row strong').innerText()).replace(/[¥￥\s]/g, '')), 0);
    await page.locator('.gift-aside').getByRole('button', { name: '减少QA 巨无霸', exact: true }).click();
    assert.equal(await page.locator('.gift-aside .cart-line').count(), 0);
    await assertSponsorshipState(page);
    assert.equal(requests.length, count, 'Cart updates must not query for a fresh quote');
    await page.close();
  });

  await run('no runtime exceptions, browser credentials, direct MCP, or mutating APIs', async () => {
    assert.deepEqual(browserErrors, []);
    assert.deepEqual(routeErrors, []);
    assert.ok(requests.every(request => ['/api/connect', '/api/stores', '/api/menu'].includes(request.path)));
    for (const request of requests) {
      assert.equal('jsonrpc' in request.body, false);
      assert.equal('token' in request.body, false);
      assert.equal(JSON.stringify(request.body).includes(UID), false);
      assert.equal(JSON.stringify(request.body).includes(REPO), false);
    }
  });
} finally {
  await browser.close();
  const report = { baseUrl: BASE, browser: 'headless Chromium / Chrome', mockedService: API_BASE, coverage: 'Browser flow with mocked normalized business API responses; upstream MCP network and server credentials are not covered', paymentNavigation: 'captured and answered locally; no payment site visited',
    checks: results, browserErrors, routeErrors, requestCount: requests.length,
    apiPaths: [...new Set(requests.map(request => request.path))], screenshots: ARTIFACTS };
  await writeFile(resolve(ARTIFACTS, 'summary.json'), JSON.stringify(report, null, 2));
  const failures = results.filter(result => result.status === 'FAIL');
  console.log(`\n${results.length - failures.length}/${results.length} checks passed; report: ${resolve(ARTIFACTS, 'summary.json')}`);
  if (failures.length) process.exitCode = 1;
}
