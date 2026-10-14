import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import { compileModule } from 'svelte/compiler';
import { demoConfig } from '../src/lib/preview.js';
import { encodeConfig } from '../src/lib/domain.js';

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

function fixture(t) {
  const requests = [];
  const app = createAppController({
    createClient() {
      return {
        async connect() {},
        async getMenu() { return structuredClone(menu); },
        async searchStores() { return []; },
        calculate(...args) { requests.push(args); throw new Error('Menu prices must be calculated locally'); },
        disconnect() {},
      };
    },
  });
  Object.assign(app.state, { config: { ...demoConfig }, menu: structuredClone(menu), connected: true, role: 'gift', preview: true });
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

test('badge language and carousel selection update both embed formats, the copied code and the share path', async t => {
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
    ['carousel', 'badge-carousel.svg', '请我吃份巨无霸', '/preview/gift/carousel'],
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
  assert.equal(app.state.badgeLanguage, 'carousel');
  await app.copy('link');
  assert.equal(copied.at(-1), app.shareUrl());
  assert.equal(new URL(copied.at(-1)).pathname, '/preview/gift/carousel');
  assert.equal(new URL(copied.at(-1)).search, query);
  assert.equal(JSON.stringify(app.state.config), originalConfig);
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

test('each cart change calculates immediately from the displayed menu without pricing requests', t => {
  const { app, requests } = fixture(t);
  app.changeQuantity('burger', 1);
  assert.equal(app.state.quote.amountCents, 2500);
  app.changeQuantity('burger', 1);
  assert.equal(app.state.quote.amountCents, 5000);
  app.changeQuantity('fries', 1);
  assert.equal(app.state.quote.amountCents, 6500);
  assert.deepEqual(app.state.quote.items.map(({ code, quantity }) => ({ code, quantity })), [
    { code: 'burger', quantity: 2 }, { code: 'fries', quantity: 1 },
  ]);
  app.changeQuantity('burger', -1);
  assert.equal(app.state.quote.amountCents, 4000);
  assert.equal(requests.length, 0);
});

test('menu estimates use integer cents and preserve displayed discounts', t => {
  const { app } = fixture(t);
  Object.assign(app.state.menu.products[0], { priceCents: 2555, originalPriceCents: 2700 });
  app.changeQuantity('burger', 1);
  app.changeQuantity('burger', 1);
  app.changeQuantity('burger', 1);
  assert.equal(app.state.quote.amountCents, 7665);
  assert.equal(app.state.quote.originalCents, 8100);
  assert.equal(app.state.quote.discountCents, 435);
});

test('emptying the cart clears its total and cannot start payment', async t => {
  const { app, requests } = fixture(t);
  app.changeQuantity('burger', 1);
  app.changeQuantity('burger', -1);
  assert.equal(app.state.cart.length, 0);
  assert.equal(app.state.quote, null);
  await app.pay();
  assert.equal(app.toastMessage, '');
  assert.equal(requests.length, 0);
});

test('invalid menu prices are never silently treated as free items', t => {
  const { app } = fixture(t);
  for (const invalid of [undefined, null, NaN, Infinity, -1, 1.5, '2500']) {
    app.state.menu.products[0].priceCents = invalid;
    app.changeQuantity('burger', 1);
    assert.equal(app.state.cart.length, 0);
    assert.equal(app.state.quote, null);
    assert.match(app.state.error, /餐品价格/);
  }
  app.state.menu.products[0].priceCents = 2500;
  app.changeQuantity('burger', 1);
  assert.equal(app.state.quote.amountCents, 2500);
  assert.equal(app.state.error, '');
});

test('a zero-price item can be combined with paid items but cannot start a zero-value payment', async t => {
  const { app } = fixture(t);
  app.state.menu.products[0].priceCents = 0;
  app.changeQuantity('burger', 1);
  assert.equal(app.state.cart.length, 1);
  assert.equal(app.state.quote, null);
  await app.pay();
  assert.equal(app.toastMessage, '');
  app.changeQuantity('fries', 1);
  assert.equal(app.state.quote.amountCents, 1500);
  assert.equal(app.state.quote.items[0].amountCents, 0);
});

test('the sponsorship amount cap blocks checkout and recovers after reducing quantities', async t => {
  const { app } = fixture(t);
  app.state.menu.products[0].priceCents = 3_000_000;
  app.changeQuantity('burger', 1);
  assert.equal(app.state.quote.amountCents, 3_000_000);
  app.changeQuantity('burger', 1);
  assert.equal(app.state.quote, null);
  assert.match(app.state.error, /30,000/);
  await app.pay();
  assert.equal(app.toastMessage, '');
  app.changeQuantity('burger', -1);
  assert.equal(app.state.quote.amountCents, 3_000_000);
  assert.equal(app.state.error, '');
});

test('checkout uses the selected meal directly without a confirmation step or celebration', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { app, requests } = fixture(t);
  app.changeQuantity('burger', 1);
  await app.pay();
  assert.match(app.toastMessage, /演示完成/);
  assert.equal(app.state.celebrationId, 0);
  app.changeQuantity('fries', 1);
  assert.equal(app.state.quote.amountCents, 4000);
  assert.equal(requests.length, 0);
});

test('successfully generating an author link fires a celebration, while an invalid setup does not', async t => {
  stubDocument(t);
  const { app } = fixture(t);
  Object.assign(app.state, {
    role: 'author', step: 3,
    author: { sponsorType: 'project', name: '', repo: demoConfig.repo, afdianId: demoConfig.afdianId, city: '上海', keyword: '人民广场', beType: 1 },
    stores: [{ storeCode: 'demo-store', storeName: '演示餐厅', beCode: 'B001' }],
    selected: null,
  });
  app.generateLink();
  assert.equal(app.state.celebrationId, 0);
  assert.ok(app.state.error);

  app.selectStore(0);
  app.generateLink();
  assert.equal(app.state.step, 4);
  assert.equal(app.state.config.storeCode, 'demo-store');
  assert.equal(Object.hasOwn(app.state.config, 'beCode'), false);
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
  assert.equal(app.state.config.notifications, undefined);
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

test('shared notification selection is reused across projects for the same author without registration', async t => {
  stubDocument(t);
  let networkCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => { networkCalls++; throw new Error('No registration expected'); });
  const { app } = fixture(t);
  Object.assign(app.state, { role: 'author', step: 3, config: null,
    stores: [{ storeCode: 'nearby', storeName: '附近餐厅' }], selected: 0 });
  app.setSponsorType('project');
  app.setAuthorField('repo', 'owner/first');
  app.setAuthorField('afdianId', 'a'.repeat(32));
  app.setPaymentNotifications(true);
  app.generateLink();
  assert.equal(app.state.config.notifications, true);
  assert.equal(new URLSearchParams(encodeConfig(app.state.config)).get('h'), '1');
  app.backToProject();
  app.setAuthorField('repo', 'owner/second');
  app.setAuthorField('afdianId', ` ${'A'.repeat(32)} `);
  app.state.step = 3;
  app.generateLink();
  assert.equal(app.state.config.repo, 'owner/second');
  assert.equal(app.state.config.notifications, true);
  assert.equal(networkCalls, 0);
  await settle();
});

test('notification toggles update the share configuration and never follow a different author UID', async t => {
  stubDocument(t);
  const { app } = fixture(t);
  Object.assign(app.state, { role: 'author', step: 3, config: null,
    stores: [{ storeCode: 'nearby', storeName: '附近餐厅' }], selected: 0 });
  app.setAuthorField('name', '小林');
  app.setAuthorField('afdianId', 'a'.repeat(32));
  app.setPaymentNotifications(true);
  assert.equal(app.state.config, null);
  app.generateLink();
  assert.equal(app.state.config.notifications, true);
  app.setPaymentNotifications(false);
  assert.equal(app.state.config.notifications, undefined);
  assert.equal(new URLSearchParams(encodeConfig(app.state.config)).get('h'), '0');
  app.setPaymentNotifications(true);
  app.backToPayment();
  app.setAuthorField('afdianId', 'c'.repeat(32));
  app.generateLink();
  assert.equal(app.state.config.afdianId, 'c'.repeat(32));
  assert.equal(app.state.config.notifications, undefined);
  app.backToPayment();
  app.setPaymentNotifications(true);
  app.generateLink();
  assert.equal(app.state.config.notifications, true);
  app.setPaymentNotifications(false);
  assert.equal(app.state.config.notifications, undefined);
  for (const invalid of [undefined, null, 0, 1, 'true']) assert.throws(() => app.setPaymentNotifications(invalid), TypeError);
  await settle();
});

test('loaded menu prices remain usable after five minutes without new requests', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { app, requests } = fixture(t);
  app.changeQuantity('burger', 1);
  const openedAt = Date.now();
  t.mock.method(Date, 'now', () => openedAt + 30 * 60_000);
  await app.pay();
  assert.equal(app.state.quote.amountCents, 2500);
  assert.match(app.toastMessage, /演示完成/);
  assert.equal(requests.length, 0);
});

test('the message starts with a preset and preserves edits when the meal changes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { app } = fixture(t);
  assert.equal(app.state.customBlessing, '愿麦麦保佑认真贡献的你');
  app.changeQuantity('burger', 1);
  const editedNote = '谢谢你维护这个项目！\n这一餐我请。';
  app.setCustomBlessing(editedNote);
  app.changeQuantity('fries', 1);
  assert.equal(app.state.customBlessing, editedNote);
  await app.pay();
  assert.match(app.toastMessage, /演示完成/);
});

test('blessings cycle through all six messages with the project owner and wrap around', t => {
  const { app } = fixture(t);
  app.state.config = { ...demoConfig, repo: 'octocat/hello-world' };
  const expected = [
    '偷偷请的哦，我是 octocat 的薯条守护神。',
    '此刻语言略显苍白，唯有麦麦配得上我的感谢',
    '我宣布，这个项目值得一份大薯。谁赞成，谁反对？',
    '你的项目救了我，必须请你吃顿麦麦',
    '项目很好用，谢谢你的付出，请你吃顿麦麦',
    '愿麦麦保佑认真贡献的你',
  ];
  for (const blessing of expected) {
    app.cycleBlessing();
    assert.equal(app.state.customBlessing, blessing);
  }
});

test('personal blessings use the author name and change custom text only on explicit cycling', t => {
  const { app } = fixture(t);
  app.state.config = { ...demoConfig, sponsorType: 'person', name: '小麦 $&' };
  app.cycleBlessing();
  assert.equal(app.state.customBlessing, '偷偷请的哦，我是 小麦 $& 的薯条守护神。');
  app.setCustomBlessing('这句是自己写的');
  app.state.busy = 'payment';
  app.cycleBlessing();
  assert.equal(app.state.customBlessing, '这句是自己写的');
  app.state.busy = '';
  app.cycleBlessing();
  assert.equal(app.state.customBlessing, '愿麦麦保佑认真贡献的你');
  app.setCustomBlessing('');
  app.cycleBlessing();
  assert.equal(app.state.customBlessing, '愿麦麦保佑认真贡献的你');
});

test('clearing the optional message is preserved when the meal changes and permits checkout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { app } = fixture(t);
  app.changeQuantity('burger', 1);
  app.setCustomBlessing('   ');
  app.changeQuantity('fries', 1);
  assert.equal(app.state.customBlessing, '   ');
  await app.pay();
  assert.equal(app.state.error, '');
  assert.match(app.toastMessage, /演示完成/);
});
