import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import { compileModule } from 'svelte/compiler';
import { demoConfig } from '../src/lib/preview.js';

// Exercise the actual Svelte runes controller without introducing a DOM runner.
const filename = fileURLToPath(new URL('../src/lib/controller.svelte.ts', import.meta.url));
const transformed = await transform(await readFile(filename, 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' });
const compiled = compileModule(transformed.code, { filename, generate: 'client' });
const bundled = await build({
  stdin: { contents: compiled.js.code, sourcefile: filename, resolveDir: dirname(filename), loader: 'js' },
  bundle: true, write: false, format: 'esm', platform: 'node', target: 'node22', conditions: ['browser'],
});
const { createAppController } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

const menu = {
  categories: [{ name: '汉堡', codes: ['burger'] }, { name: '小食', codes: ['fries'] }],
  products: [
    { code: 'burger', name: '巨无霸', priceCents: 2500, image: null },
    { code: 'fries', name: '薯条', priceCents: 1500, image: null },
  ],
};

function quoteFor(request) {
  const items = request.items.map(item => {
    const product = menu.products.find(product => product.code === item.productCode);
    const amountCents = product.priceCents * item.quantity;
    return { code: product.code, name: product.name, quantity: item.quantity, amountCents, originalCents: amountCents };
  });
  const amountCents = items.reduce((sum, item) => sum + item.amountCents, 0);
  return { items, amountCents, originalCents: amountCents, discountCents: 0 };
}

function fixture(t, debounceMs = 30_000) {
  const requests = [];
  const app = createAppController({
    debounceMs,
    createClient() {
      let request;
      return {
        async connect() {},
        async getMenu() { return structuredClone(menu); },
        async searchStores() { return []; },
        calculate(_config, items) {
          return new Promise((resolve, reject) => {
            request = { items: structuredClone(items), resolve, reject, disconnects: 0 };
            requests.push(request);
          });
        },
        disconnect() { if (request) request.disconnects++; },
      };
    },
  });
  Object.assign(app.state, { config: { ...demoConfig }, menu: structuredClone(menu), connected: true, role: 'gift', preview: true });
  t.after(() => {
    app.state.connected = false;
    while (app.state.cart.length) app.changeQuantity(app.state.cart[0].code, -1);
    for (const request of requests) request.resolve(quoteFor(request));
  });
  return { app, requests };
}

const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

function stubDocument(t) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: () => null, querySelector: () => null } });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else delete globalThis.document;
  });
}

test('badge language selection updates both embed formats, the copied code and the share path', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const copied = [];
  for (const [key, value] of Object.entries({
    location: { origin: 'https://example.com', pathname: '/preview/gift' },
    navigator: { clipboard: { async writeText(value) { copied.push(value); } } },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    });
  }
  const { app } = fixture(t);
  const originalConfig = JSON.stringify(app.state.config);
  const query = new URL(app.shareUrl()).search;
  assert.equal(app.state.badgeLanguage, 'zh-CN');
  const markupFor = (share, asset, label) => ({
    html: `<a href="${share.replace(/&/g, '&amp;')}"><img src="https://example.com/assets/${asset}" alt="${label}" /></a>`,
    markdown: `[![${label}](<https://example.com/assets/${asset}>)](<${share}>)`,
  });
  const defaultMarkup = markupFor(app.shareUrl(), 'badge-zh-cn.svg', '请我吃份巨无霸');
  assert.deepEqual(app.badgeMarkup(), defaultMarkup);
  for (const [language, asset, label, path] of [
    ['en', 'badge.svg', 'Buy me a Big Mac', '/preview/gift/en'],
    ['zh-CN', 'badge-zh-cn.svg', '请我吃份巨无霸', '/preview/gift'],
    ['zh-TW', 'badge-zh-tw.svg', '請我吃份大麥克', '/preview/gift/zh-tw'],
    ['yue-CN', 'badge-yue-cn.svg', '请我食份巨无霸', '/preview/gift/yue-cn'],
    ['yue-HK', 'badge-yue-hk.svg', '請我食份巨無霸', '/preview/gift/yue-hk'],
  ]) {
    app.setBadgeLanguage(language);
    assert.equal(app.state.badgeLanguage, language);
    const share = app.shareUrl();
    // The language picks the prerendered shell through the path; the gift
    // configuration is the same query for every language.
    assert.equal(new URL(share).pathname, path);
    assert.equal(new URL(share).search, query);
    const markup = app.badgeMarkup();
    assert.deepEqual(markup, markupFor(share, asset, label));
    app.setCodeTab('html');
    await app.copy('code');
    assert.equal(copied.at(-1), markup.html);
    app.setCodeTab('markdown');
    await app.copy('code');
    assert.equal(copied.at(-1), markup.markdown);
    assert.equal(JSON.stringify(app.state.config), originalConfig);
  }
  app.setBadgeLanguage('../../private');
  assert.equal(app.state.badgeLanguage, 'yue-HK');
  await app.copy('link');
  assert.equal(copied.at(-1), app.shareUrl());
  app.state.badgeLanguage = 'unknown';
  assert.deepEqual(app.badgeMarkup(), defaultMarkup);
  const fresh = createAppController();
  assert.equal(fresh.state.badgeLanguage, 'zh-CN');
  assert.deepEqual(fresh.badgeMarkup(), { html: '', markdown: '' });
});

test('leaving a share link for the create page keeps nothing of it in the URL', async t => {
  const pushed = [];
  const location = { origin: 'https://example.com', pathname: '/gift/en', search: '?p=a%2Fb' };
  for (const [key, value] of Object.entries({
    location,
    history: { pushState(_state, _title, value) {
      pushed.push(value);
      Object.assign(location, { pathname: new URL(value, location.origin).pathname, search: '' });
    } },
    window: { scrollTo() {} },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    });
  }
  stubDocument(t);
  const app = createAppController();
  app.state.role = 'gift';
  app.home();
  assert.deepEqual(pushed, ['/']);
  assert.equal(app.state.role, 'author');
  app.home();
  assert.deepEqual(pushed, ['/'], 'the create page does not navigate to itself');
});

test('rapid cart changes collapse into one quote containing the latest quantities', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { app, requests } = fixture(t, 100);
  app.changeQuantity('burger', 1);
  t.mock.timers.tick(80);
  app.changeQuantity('burger', 1);
  app.changeQuantity('fries', 1);
  assert.equal(app.state.quoteStatus, 'scheduled');
  t.mock.timers.tick(99);
  assert.equal(requests.length, 0);
  t.mock.timers.tick(1);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].items, [{ productCode: 'burger', quantity: 2 }, { productCode: 'fries', quantity: 1 }]);
  requests[0].resolve(quoteFor(requests[0]));
  await settle();
  assert.equal(app.state.quote.amountCents, 6500);
  assert.equal(app.state.quoteStatus, 'idle');
});

test('a superseded quote that ignores cancellation cannot overwrite a newer result', async t => {
  const { app, requests } = fixture(t);
  app.changeQuantity('burger', 1);
  const first = app.quote();
  app.changeQuantity('burger', 1);
  assert.ok(requests[0].disconnects > 0);
  const second = app.quote();
  requests[1].resolve(quoteFor(requests[1]));
  await second;
  assert.equal(app.state.quote.amountCents, 5000);
  requests[0].resolve(quoteFor(requests[0]));
  await first;
  assert.equal(app.state.quote.amountCents, 5000);
  assert.equal(app.state.quote.items[0].quantity, 2);
  assert.equal(app.state.error, '');
});

test('emptying the cart cancels pending pricing and ignores its late result', async t => {
  const { app, requests } = fixture(t);
  app.changeQuantity('burger', 1);
  const pending = app.quote();
  app.changeQuantity('burger', -1);
  assert.ok(requests[0].disconnects > 0);
  assert.equal(app.state.cart.length, 0);
  assert.equal(app.state.quoteStatus, 'idle');
  requests[0].resolve(quoteFor(requests[0]));
  await pending;
  assert.equal(app.state.quote, null);
  assert.equal(app.state.quotedAt, 0);
  assert.equal(app.state.confirmed, false);
});

test('a quote with different quantities is rejected and an explicit retry can recover', async t => {
  const { app, requests } = fixture(t);
  app.changeQuantity('burger', 1);
  const invalid = app.quote();
  const mismatched = quoteFor(requests[0]);
  mismatched.items[0].quantity = 2;
  requests[0].resolve(mismatched);
  await invalid;
  assert.equal(app.state.quote, null);
  assert.equal(app.state.quoteStatus, 'error');
  assert.match(app.state.error, /数量.*不一致/);
  app.confirmMeal();
  assert.equal(app.state.confirmed, false);
  const retry = app.quote();
  requests[1].resolve(quoteFor(requests[1]));
  await retry;
  assert.equal(app.state.quoteStatus, 'idle');
  assert.equal(app.state.quote.amountCents, 2500);
  assert.equal(app.state.error, '');
});

test('meal confirmation requires current pricing but does not fire the sponsorship celebration', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  stubDocument(t);
  const { app, requests } = fixture(t);
  app.changeQuantity('burger', 1);
  app.confirmMeal();
  assert.equal(app.state.confirmed, false);
  const pricing = app.quote();
  requests[0].resolve(quoteFor(requests[0]));
  await pricing;
  app.pay();
  assert.equal(app.toastMessage, '');
  app.confirmMeal();
  app.confirmMeal();
  assert.equal(app.state.confirmed, true);
  assert.equal(app.state.celebrationId, 0);
  app.pay();
  assert.match(app.toastMessage, /演示完成/);
  app.changeQuantity('fries', 1);
  assert.equal(app.state.confirmed, false);
  assert.equal(app.state.quote, null);
  assert.equal(app.state.quoteStatus, 'scheduled');
  await settle();
});

test('successfully generating an author link fires a celebration, while an invalid setup does not', async t => {
  stubDocument(t);
  const { app } = fixture(t);
  Object.assign(app.state, {
    role: 'author', step: 3,
    author: { sponsorType: 'project', name: '', repo: demoConfig.repo, afdianId: demoConfig.afdianId, city: '上海', keyword: '人民广场', beType: 1 },
    stores: [{ storeCode: 'demo-store', storeName: '演示餐厅', beCode: '' }],
    selected: null,
  });
  app.generateLink();
  assert.equal(app.state.celebrationId, 0);
  assert.ok(app.state.error);

  app.selectStore(0);
  app.generateLink();
  assert.equal(app.state.step, 4);
  assert.equal(app.state.config.storeCode, 'demo-store');
  assert.equal(Object.hasOwn(app.state.config, 'storeName'), false);
  assert.equal(app.state.error, '');
  assert.equal(app.state.celebrationId, 1);
  await settle();
});

test('personal setup separates identity, restaurant and payment validation across four steps', async t => {
  stubDocument(t);
  let connections = 0;
  const app = createAppController({ createClient: () => ({
    async connect() { connections++; throw new Error('offline'); },
    async searchStores() { return [{ storeCode: 'nearby', storeName: '附近餐厅' }]; },
    disconnect() {},
  }) });
  assert.equal(app.state.author.sponsorType, 'person');
  await app.connectAuthor();
  assert.equal(app.state.step, 1);
  assert.match(app.state.error, /名字/);
  app.setAuthorField('name', '  小林  ');
  await app.connectAuthor();
  assert.equal(app.state.step, 2);
  assert.equal(app.state.author.name, '小林');
  assert.equal(app.state.author.afdianId, '');
  assert.equal(connections, 0, 'identity entry must not need a restaurant connection');
  app.continueToPayment();
  assert.equal(app.state.step, 2);
  assert.match(app.state.error, /选择一家餐厅/);
  await app.searchStores();
  app.selectStore(0);
  app.continueToPayment();
  assert.equal(app.state.step, 3);
  assert.equal(app.state.config, null);
  app.generateLink();
  assert.equal(app.state.step, 3);
  assert.match(app.state.error, /UID/);
  app.setAuthorField('afdianId', demoConfig.afdianId);
  app.generateLink();
  assert.equal(app.state.step, 4);
  assert.equal(app.state.config.sponsorType, 'person');
  assert.equal(app.state.config.name, '小林');
  assert.equal(Object.hasOwn(app.state.config, 'storeName'), false);
  assert.equal(Object.hasOwn(app.state.config, 'repo'), false);
  assert.equal(app.state.config.integrationId, undefined);
  await settle();
});

test('project setup validates the repository and keeps separate personal identity drafts', async t => {
  stubDocument(t);
  const { app } = fixture(t);
  app.state.role = 'author';
  app.setAuthorField('name', '小林');
  app.setSponsorType('project');
  app.setAuthorField('repo', 'https://example.com/owner/repo');
  await app.connectAuthor();
  assert.equal(app.state.step, 1);
  assert.match(app.state.error, /github.com/);
  app.setAuthorField('repo', 'https://github.com/octocat/hello-world');
  await app.connectAuthor();
  assert.equal(app.state.step, 2);
  assert.equal(app.state.author.repo, 'octocat/hello-world');
  app.backToProject();
  app.setSponsorType('person');
  assert.equal(app.state.author.name, '小林');
  await app.connectAuthor();
  assert.equal(app.state.step, 2);
  await settle();
});

test('optional webhook integration is remembered before sharing and cannot leak across recipients', async t => {
  stubDocument(t);
  const { app } = fixture(t);
  Object.assign(app.state, { role: 'author', step: 3, config: null,
    stores: [{ storeCode: 'nearby', storeName: '附近餐厅' }], selected: 0 });
  app.setAuthorField('name', '小林');
  app.setAuthorField('afdianId', 'a'.repeat(32));
  app.setNotificationIntegrationId('b'.repeat(32));
  assert.equal(app.state.config, null);
  app.generateLink();
  assert.equal(app.state.config.integrationId, 'b'.repeat(32));
  app.backToPayment();
  assert.equal(app.state.step, 3);
  app.setNotificationIntegrationId(undefined);
  app.generateLink();
  assert.equal(app.state.config.integrationId, undefined);
  app.backToPayment();
  app.setNotificationIntegrationId('b'.repeat(32));
  app.setAuthorField('afdianId', 'c'.repeat(32));
  app.generateLink();
  assert.equal(app.state.config.afdianId, 'c'.repeat(32));
  assert.equal(app.state.config.integrationId, undefined);
  assert.throws(() => app.setNotificationIntegrationId('not-an-id'), TypeError);
  app.backToStores();
  assert.equal(app.state.step, 2);
  app.continueToPayment();
  assert.equal(app.state.author.name, '小林');
  assert.equal(app.state.author.afdianId, 'c'.repeat(32));
  await settle();
});

test('expired pricing cannot confirm a meal and schedules a fresh calculation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { app, requests } = fixture(t, 100);
  app.changeQuantity('burger', 1);
  const pricing = app.quote();
  requests[0].resolve(quoteFor(requests[0]));
  await pricing;
  app.state.quotedAt = Date.now() - 5 * 60 * 1000 - 1;
  app.confirmMeal();
  assert.equal(app.state.confirmed, false);
  assert.equal(app.state.quote, null);
  assert.equal(app.state.quoteStatus, 'scheduled');
  t.mock.timers.tick(100);
  assert.equal(requests.length, 2);
  requests[1].resolve(quoteFor(requests[1]));
  await settle();
  assert.equal(app.state.quote.amountCents, 2500);
});

test('the printed note starts with a random message and preserves edits when the meal changes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(Math, 'random', () => 0);
  const { app, requests } = fixture(t);
  t.mock.method(Math, 'random', () => 0.99);
  const other = fixture(t).app;
  assert.ok(app.state.customBlessing.trim());
  assert.ok(other.state.customBlessing.trim());
  assert.notEqual(app.state.customBlessing, other.state.customBlessing);

  app.changeQuantity('burger', 1);
  const pricing = app.quote();
  requests[0].resolve(quoteFor(requests[0]));
  await pricing;
  app.confirmMeal();
  const editedNote = '谢谢你维护这个项目！\n这一餐我请。';
  app.setCustomBlessing(editedNote);
  app.changeQuantity('fries', 1);
  const updatedPricing = app.quote();
  requests[1].resolve(quoteFor(requests[1]));
  await updatedPricing;
  app.confirmMeal();
  assert.equal(app.state.customBlessing, editedNote);
  assert.equal(app.state.confirmed, true);
  app.pay();
  assert.match(app.toastMessage, /演示完成/);
});

test('clearing the printed note is preserved across confirmation and blocks sending', async t => {
  stubDocument(t);
  const { app, requests } = fixture(t);
  app.changeQuantity('burger', 1);
  const pricing = app.quote();
  requests[0].resolve(quoteFor(requests[0]));
  await pricing;
  app.confirmMeal();
  app.setCustomBlessing('   ');
  app.changeQuantity('fries', 1);
  const updatedPricing = app.quote();
  requests[1].resolve(quoteFor(requests[1]));
  await updatedPricing;
  app.confirmMeal();
  assert.equal(app.state.customBlessing, '   ');
  app.pay();
  assert.match(app.state.error, /留一句祝福/);
  assert.equal(app.toastMessage, '');
  await settle();
});
