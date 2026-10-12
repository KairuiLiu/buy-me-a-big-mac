/**
 * Real-browser integration smoke test. Start the application server first.
 *   npm start
 *   PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/browser-smoke.mjs
 * Optional: BASE_URL, BROWSER_CHANNEL (default: chrome), QA_SCREENSHOT_DIR.
 *
 * Only same-origin business API responses are mocked. Direct browser requests to
 * mcp.mcd.cn fail this test. The eventual Afdian navigation is captured and
 * aborted before network access. No real token, order, or payment is used.
 * Responses match the normalized public menu/quote contract; MCP authentication
 * and the server-side adapter are tested separately.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeMenu, normalizeQuote } from '../public/lib/domain.js';

const playwrightModule = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(playwrightModule ? pathToFileURL(resolve(playwrightModule)).href : 'playwright');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const API_BASE = new URL('/api/', BASE).href;
const ARTIFACTS = resolve(process.env.QA_SCREENSHOT_DIR || 'work/qa');
await mkdir(ARTIFACTS, { recursive: true });
const UID = 'a'.repeat(32);
const REPO = 'qa-maintainer/tiny-tool';
const publicConfig = { v: 1, repo: REPO, afdianId: UID, storeCode: 'QA001', beCode: 'QA-BE', storeName: 'QA 人民广场餐厅', beType: 1, orderType: 1 };
let shareUrl = `${BASE}#/gift/${Buffer.from(JSON.stringify(publicConfig)).toString('base64url')}`;

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

function calculate(items) {
  const productList = items.map(item => {
    const meal = meals[item.productCode];
    assert.ok(meal, `Unrecognized product ${item.productCode}`);
    assert.ok(Number.isInteger(item.quantity) && item.quantity > 0);
    return { productCode: item.productCode, productName: meal.name, quantity: item.quantity,
      subtotal: Math.round(Number(meal.currentPrice) * 100) * item.quantity,
      originalSubtotal: Math.round(Number(meal.originalPrice) * 100) * item.quantity };
  });
  const price = productList.reduce((n, item) => n + item.subtotal, 0);
  const originalPrice = productList.reduce((n, item) => n + item.originalSubtotal, 0);
  return { productOriginalPrice: originalPrice, productPrice: price, deliveryOriginalPrice: 0, deliveryPrice: 0,
    originalPrice, discount: originalPrice - price, price, productList, takeWayList: [], mealAssistanceList: [], tablewarePrice: 0 };
}

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
        return json(normalizeMenu(scenario.empty ? { meals: {}, categories: [] } : scenario.categoryLabels ? categoryLabelMenu : menu));
      }
      assert.equal(path, '/api/quote');
      const quote = normalizeQuote(calculate(body.items));
      if (scenario.mismatchedQuote) quote.items[0].quantity += 1;
      return json(quote);
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
async function fillAuthor(page, repo = `https://github.com/${REPO}`) {
  await page.locator('[name="repo"]').fill(repo);
  await page.locator('[name="afdianId"]').fill(UID);
}

try {
  await run('author → store → share → automatic menu → quote → Afdian URL', async () => {
    const author = await pageAt();
    await screenshot(author, '01-author-desktop');
    await assertNoBrowserCredentials(author);
    const requestCount = requests.length;
    await author.locator('#author-connect button[type="submit"]').click();
    assert.equal(requests.length, requestCount, 'Blank author form sent MCP requests');
    await fillAuthor(author);
    await author.locator('#author-connect button[type="submit"]').click();
    await author.locator('#store-search').waitFor();
    await author.locator('[name="city"]').fill('上海');
    await author.locator('[name="keyword"]').fill('没有餐厅');
    await author.getByRole('button', { name: '搜索餐厅', exact: true }).click();
    await author.getByText('这里还没有找到餐厅', { exact: true }).waitFor();
    assert.equal(await author.locator('[data-action="generate"]').isDisabled(), true);
    await author.locator('[name="keyword"]').fill('人民广场');
    await author.getByRole('button', { name: '搜索餐厅', exact: true }).click();
    await author.locator('.store-option').first().waitFor();
    assert.equal(await author.locator('.store-option').count(), 2);
    await author.locator('.store-option').first().click();
    await author.locator('[data-action="generate"]').click();
    await author.locator('.badge-preview a').waitFor();
    shareUrl = await author.locator('.badge-preview a').getAttribute('href');
    assert.equal(await author.getByRole('textbox', { name: '专属请客链接' }).inputValue(), shareUrl);
    const decoded = JSON.parse(Buffer.from(new URL(shareUrl).hash.slice(7), 'base64url').toString());
    assert.deepEqual(decoded, publicConfig);
    const markdown = await author.locator('.code-box').inputValue();
    assert.ok(markdown.includes(shareUrl) && markdown.includes('/assets/badge.svg'));
    await author.getByRole('button', { name: 'HTML', exact: true }).click();
    const html = await author.locator('.code-box').inputValue();
    assert.ok(html.startsWith('<a href=') && html.includes(shareUrl));
    for (const artifact of [shareUrl, markdown, html, JSON.stringify(decoded)]) {
      assert.equal(artifact.toLowerCase().includes('token'), false);
    }
    await screenshot(author, '02-author-share');
    await assertNoBrowserCredentials(author);

    const sponsor = await pageAt(shareUrl);
    await assertNoBrowserCredentials(sponsor);
    assert.equal(await sponsor.locator('[data-action="pay"]').isDisabled(), true);
    await sponsor.locator('#meal-search').waitFor();
    assert.equal(await sponsor.locator('.product-card').count(), 4);
    await sponsor.getByRole('button', { name: '小食', exact: true }).click();
    assert.equal(await sponsor.locator('.product-card').count(), 2);
    await sponsor.getByRole('searchbox', { name: '搜索餐品' }).fill('鸡');
    assert.equal(await sponsor.locator('.product-card').count(), 1);
    await sponsor.getByRole('searchbox', { name: '搜索餐品' }).fill('QA 不存在的餐品');
    await sponsor.getByText('暂时没有匹配的餐品', { exact: true }).waitFor();
    await sponsor.getByRole('searchbox', { name: '搜索餐品' }).fill('');
    await sponsor.getByRole('button', { name: '全部', exact: true }).click();
    await sponsor.getByRole('button', { name: '添加QA 巨无霸', exact: true }).click();
    await sponsor.getByRole('button', { name: '增加QA 巨无霸', exact: true }).click();
    await sponsor.getByRole('button', { name: '添加QA 中薯条', exact: true }).click();
    await sponsor.locator('[data-action="quote"]').click();
    await sponsor.locator('.quote-note').waitFor();
    assert.match(await sponsor.locator('.amount-row').innerText(), /65\.00/);
    assert.equal(await sponsor.locator('[data-action="pay"]').isDisabled(), false);
    await sponsor.getByRole('button', { name: '增加QA 巨无霸', exact: true }).click();
    assert.equal(await sponsor.locator('[data-action="pay"]').isDisabled(), true, 'Cart change did not invalidate quote');
    assert.equal(await sponsor.locator('.quote-note').count(), 0);
    assert.match(await sponsor.locator('.amount-row').innerText(), /待计算/);
    await sponsor.getByRole('button', { name: '减少QA 巨无霸', exact: true }).click();
    await sponsor.getByRole('button', { name: '添加QA 可乐', exact: true }).click();
    await sponsor.locator('[data-action="quote"]').click();
    await sponsor.locator('.quote-note').waitFor();
    assert.match(await sponsor.locator('.amount-row').innerText(), /74\.50/);
    await sponsor.locator('#blessing-select').selectOption('3');
    const blessing = '谢谢这个开源项目！\n愿每次合并都顺利。 🍔';
    await sponsor.locator('#custom-blessing').fill(blessing);
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
    await sponsor.route('https://afdian.com/**', route => {
      capturedUrl = route.request().url();
      capture();
      return route.abort('blockedbyclient');
    });
    await sponsor.locator('[data-action="pay"]').click();
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
    const remark = destination.searchParams.get('remark');
    for (const part of [blessing, REPO, 'QA 巨无霸 ×2', 'QA 中薯条 ×1', 'QA 可乐 ×1', 'QA 人民广场餐厅', '74.50']) assert.ok(remark.includes(part), `Payment remark missing ${part}`);
    assert.ok(requests.some(request => request.path === '/api/stores'));
    assert.ok(requests.some(request => request.path === '/api/menu'));
    assert.equal(capturedUrl.toLowerCase().includes('token'), false);
    await author.close();
    await sponsor.close();
  });

  await run('invalid share link is rejected before any API request', async () => {
    const count = requests.length;
    const page = await pageAt(`${BASE}#/gift/INVALID--NOT-JSON`);
    await page.getByRole('heading', { name: '这个请客链接不太对。' }).waitFor();
    assert.equal(await page.locator('input[type="password"]').count(), 0);
    assert.equal(requests.length, count);
    await screenshot(page, '05-invalid-share');
    await page.close();
  });

  await run('author service error shows a retryable message and recovers', async () => {
    const scenario = { connectError: true };
    const page = await pageAt(BASE, scenario);
    await fillAuthor(page);
    await page.locator('#author-connect button[type="submit"]').click();
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(), /服务暂时不可用/);
    scenario.connectError = false;
    await page.locator('#author-connect button[type="submit"]').click();
    await page.locator('#store-search').waitFor();
    await assertNoBrowserCredentials(page);
    await page.close();
  });

  await run('automatic sponsor menu error can retry without credentials', async () => {
    const scenario = { menuError: true };
    const page = await pageAt(shareUrl, scenario);
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(), /服务暂时不可用/);
    assert.equal(await page.locator('[data-action="pay"]').isDisabled(), true);
    scenario.menuError = false;
    await page.getByRole('button', { name: '重新加载菜单' }).click();
    await page.locator('#meal-search').waitFor();
    await assertNoBrowserCredentials(page);
    await page.close();
  });

  await run('empty menu has an honest empty state and disabled payment', async () => {
    const page = await pageAt(shareUrl, { empty: true });
    await page.getByText('暂时没有匹配的餐品', { exact: true }).waitFor();
    assert.equal(await page.locator('.product-card').count(), 0);
    assert.equal(await page.locator('[data-action="quote"]').isDisabled(), true);
    assert.equal(await page.locator('[data-action="pay"]').isDisabled(), true);
    await screenshot(page, '06-empty-menu');
    await page.close();
  });

  await run('malformed menu shows an error rather than fabricated food', async () => {
    const page = await pageAt(shareUrl, { malformed: true });
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(), /菜单格式/);
    assert.equal(await page.locator('.product-card').count(), 0);
    assert.equal(await page.locator('[data-action="pay"]').isDisabled(), true);
    await page.close();
  });

  await run('messy category labels merge products and preserve separate global and restaurant All tabs', async () => {
    const page = await pageAt(shareUrl, { categoryLabels: true });
    await page.locator('#meal-search').waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);
    const categoryButtons = page.getByRole('group', { name: '餐品分类' }).getByRole('button');
    assert.deepEqual(await categoryButtons.allTextContents(), ['全部', '热销 推荐', '其他餐品', '全部（餐厅分类）']);
    const visibleProducts = async () => (await page.locator('.product-card h3').allTextContents()).sort();
    const allProducts = Object.values(meals).map(meal => meal.name).sort();
    assert.deepEqual(await visibleProducts(), allProducts);

    await page.getByRole('button', { name: '热销 推荐', exact: true }).click();
    assert.deepEqual(await visibleProducts(), ['QA 巨无霸', 'QA 中薯条'].sort(), 'Duplicate normalized groups did not form a deduplicated union');
    await page.getByRole('button', { name: '其他餐品', exact: true }).click();
    assert.deepEqual(await visibleProducts(), ['QA 可乐', 'QA 麦乐鸡', 'QA 巨无霸'].sort(), 'Missing, null, and empty category groups lost products');

    const restaurantAll = page.getByRole('button', { name: '全部（餐厅分类）', exact: true });
    const globalAll = page.getByRole('button', { name: '全部', exact: true });
    await restaurantAll.click();
    assert.deepEqual(await visibleProducts(), ['QA 中薯条']);
    assert.equal(await restaurantAll.getAttribute('aria-pressed'), 'true');
    assert.equal(await globalAll.getAttribute('aria-pressed'), 'false');
    await globalAll.click();
    assert.deepEqual(await visibleProducts(), allProducts);
    assert.equal(await restaurantAll.getAttribute('aria-pressed'), 'false');
    assert.equal(await globalAll.getAttribute('aria-pressed'), 'true');

    await page.getByRole('button', { name: '添加QA 巨无霸', exact: true }).click();
    await page.locator('[data-action="quote"]').click();
    await page.locator('.quote-note').waitFor();
    assert.match(await page.locator('.amount-row').innerText(), /26\.50/);
    assert.equal(await page.locator('[data-action="pay"]').isDisabled(), false);
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
    await page.close();
  });

  await run('mismatched quote cannot enable payment', async () => {
    const page = await pageAt(shareUrl, { mismatchedQuote: true });
    await page.getByRole('button', { name: '添加QA 巨无霸', exact: true }).click();
    await page.locator('[data-action="quote"]').click();
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(), /数量与所选内容不一致/);
    assert.equal(await page.locator('[data-action="pay"]').isDisabled(), true);
    await page.close();
  });

  await run('no runtime exceptions, browser credentials, direct MCP, or mutating APIs', async () => {
    assert.deepEqual(browserErrors, []);
    assert.deepEqual(routeErrors, []);
    assert.ok(requests.every(request => ['/api/connect', '/api/stores', '/api/menu', '/api/quote'].includes(request.path)));
    for (const request of requests) {
      assert.equal('jsonrpc' in request.body, false);
      assert.equal('token' in request.body, false);
      assert.equal(JSON.stringify(request.body).includes(UID), false);
      assert.equal(JSON.stringify(request.body).includes(REPO), false);
    }
  });
} finally {
  await browser.close();
  const report = { baseUrl: BASE, browser: 'headless Chromium / Chrome', mockedService: API_BASE, coverage: 'Browser flow with mocked normalized business API responses; upstream MCP network and server credentials are not covered', paymentNavigation: 'captured and aborted; no payment site visited',
    checks: results, browserErrors, routeErrors, requestCount: requests.length,
    apiPaths: [...new Set(requests.map(request => request.path))], screenshots: ARTIFACTS };
  await writeFile(resolve(ARTIFACTS, 'summary.json'), JSON.stringify(report, null, 2));
  const failures = results.filter(result => result.status === 'FAIL');
  console.log(`\n${results.length - failures.length}/${results.length} checks passed; report: ${resolve(ARTIFACTS, 'summary.json')}`);
  if (failures.length) process.exitCode = 1;
}
