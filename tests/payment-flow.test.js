import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import { compileModule } from 'svelte/compiler';
import { demoConfig } from '../src/lib/preview.js';
import { encodeConfig, normalizeConfig } from '../src/lib/domain.js';
import { thanksPath } from '../src/lib/routes.js';

// Run the real Svelte controller so browser-return and cancellation checks cover
// the production orchestration, rather than a second model of the payment flow.
const filename = fileURLToPath(new URL('../src/lib/controller.svelte.ts', import.meta.url));
const transformed = await transform(await readFile(filename, 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' });
const compiled = compileModule(transformed.code, { filename, generate: 'client' });
const bundled = await build({
  stdin: { contents: compiled.js.code, sourcefile: filename, resolveDir: dirname(filename), loader: 'js' },
  bundle: true, write: false, format: 'esm', platform: 'node', target: 'node22', conditions: ['browser'],
});
const { createAppController } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

const intentId = 'c'.repeat(32);
const readToken = 'd'.repeat(64);
const menu = {
  categories: [{ name: '汉堡', codes: ['burger'] }],
  products: [{ code: 'burger', name: '巨无霸', priceCents: 2500, image: null }],
};
const quote = {
  items: [{ code: 'burger', name: '巨无霸', quantity: 1, amountCents: 2500, originalCents: 2500 }],
  amountCents: 2500, originalCents: 2500, discountCents: 0,
};

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const settle = async () => { for (let count = 0; count < 6; count++) await Promise.resolve(); };

function browser(t, initialPath = '/', { focusNewTab = true } = {}) {
  const saved = new Map();
  const operations = [];
  const tabs = [];
  const cleanup = [];
  const window = new EventTarget();
  const document = new EventTarget();
  document.visibilityState = 'visible';
  document.getElementById = () => null;
  document.querySelector = () => null;
  const location = {
    origin: 'https://bigmac.example', pathname: '/', search: '',
    assign(url) { operations.push({ type: 'assign', url }); },
  };
  const visit = (value, type = '') => {
    const url = new URL(value, location.origin);
    location.pathname = url.pathname;
    location.search = url.search;
    if (type) operations.push({ type, url: url.href });
  };
  visit(initialPath);
  const history = {
    replaceState(_state, _title, value) { visit(value, 'replace'); },
    pushState(_state, _title, value) { visit(value, 'push'); },
  };
  const localStorage = {
    get length() { return saved.size; },
    key(index) { return Array.from(saved.keys())[index] ?? null; },
    getItem(key) { return saved.get(key) ?? null; },
    setItem(key, value) { operations.push({ type: 'save', key }); saved.set(key, String(value)); },
    removeItem(key) { saved.delete(key); },
  };
  window.open = (url, target) => {
    operations.push({ type: 'open', url, target });
    let opener = window;
    const tab = {
      closed: false,
      get opener() { return opener; },
      set opener(value) { opener = value; operations.push({ type: 'detach', value }); },
      location: { replace(url) { operations.push({ type: 'tab-replace', url }); } },
      close() { this.closed = true; operations.push({ type: 'close' }); },
    };
    tabs.push(tab);
    if (focusNewTab) document.visibilityState = 'hidden';
    return tab;
  };
  window.scrollTo = () => {};
  Object.assign(window, { location, history, localStorage });
  const descriptors = [];
  for (const [key, value] of Object.entries({ window, document, location, history, localStorage })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    descriptors.push([key, descriptor]);
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  t.after(() => {
    for (const dispose of cleanup) dispose();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    assert.equal(operations.some(operation => operation.type === 'assign'), false, 'checkout must never replace the current tab');
  });
  const go = path => {
    visit(path);
    window.dispatchEvent(new Event('popstate'));
  };
  return { window, document, location, history, localStorage, saved, operations, tabs, cleanup, go };
}

function ready(app, notifications = true) {
  Object.assign(app.state, {
    preview: false, role: 'gift', connected: true,
    config: { ...demoConfig, ...(notifications ? { notifications: true } : {}) },
    menu: structuredClone(menu), cart: [], quote: null,
    customBlessing: '谢谢你维护这个项目！',
  });
  app.changeQuantity('burger', 1);
}

function fixture(t, { notifications = true, pollingMs = 10_000, focusNewTab = true } = {}) {
  const env = browser(t, '/', { focusNewTab });
  const intents = [];
  const statuses = [];
  const app = createAppController({
    pollingMs,
    createClient: () => ({
      async connect() {}, async searchStores() { return []; },
      async getMenu() { return structuredClone(menu); },
      async calculate() { return structuredClone(quote); }, disconnect() {},
    }),
    createPaymentClient() {
      let request;
      return {
        createIntent(input) {
          request = { ...deferred(), input: structuredClone(input), disconnects: 0 };
          intents.push(request);
          return request.promise;
        },
        status(id, token) {
          request = { ...deferred(), intentId: id, readToken: token, disconnects: 0 };
          statuses.push(request);
          return request.promise;
        },
        disconnect() { if (request) request.disconnects++; },
      };
    },
  });
  env.cleanup.push(app.init());
  ready(app, notifications);
  function returnToReceipt() {
    env.document.visibilityState = 'visible';
    env.window.dispatchEvent(new Event('popstate'));
  }
  async function checkout() {
    const paying = app.pay();
    intents.at(-1).resolve({ intentId, readToken, expiresAt: Date.now() + 5 * 60_000 });
    await paying;
  }
  return { app, env, intents, statuses, checkout, returnToReceipt };
}

test('short gift routes preserve the restaurant scene while estimates stay local', async t => {
  for (const beType of [1, 5]) {
    await t.test(`pickup type ${beType}`, async t => {
      const config = { ...demoConfig, beCode: 'B001', beType };
      const env = browser(t, `/gift?${encodeConfig(config)}`);
      const requests = [];
      const app = createAppController({ createClient: () => ({
        async getMenu(scene) { requests.push({ ...scene }); return structuredClone(menu); },
        async calculate() { assert.fail('Selecting a meal must not request remote pricing'); },
        disconnect() {},
      }) });
      env.cleanup.push(app.init());
      await settle();
      assert.equal(app.state.badLink, false);
      assert.equal(app.state.connected, true);
      app.changeQuantity('burger', 1);
      assert.equal(requests.length, 1);
      for (const scene of requests) assert.deepEqual(scene, normalizeConfig(config));
      assert.equal(app.state.quote.amountCents, 2500);
    });
  }
});

test('recent payments belong only to the current recipient with notifications enabled', async t => {
  const { app, env, statuses, checkout } = fixture(t);
  await checkout();
  for (const [config, expected] of [
    [{ ...demoConfig }, null],
    [{ ...demoConfig, notifications: true, afdianId: 'a'.repeat(32) }, null],
    [{ ...demoConfig, notifications: true }, intentId],
  ]) {
    env.go(`/gift?${encodeConfig(config)}`);
    await settle();
    assert.equal(app.state.recentReceiptId, expected);
    assert.equal(statuses.length, 0);
  }
});

test('a restored receipt without notifications never offers or requests tracked payment', async t => {
  const { app, env, statuses, checkout, returnToReceipt } = fixture(t);
  await checkout();
  const key = 'bigmac.payments.receipts.v1';
  const record = JSON.parse(env.saved.get(key));
  delete record.entries[0].config.notifications;
  env.saved.set(key, JSON.stringify(record));
  returnToReceipt();
  assert.equal(app.state.paymentStatus, 'unknown');
  assert.equal(app.state.recentReceiptId, null);
  assert.equal(app.paymentUrl(), '');
  app.state.paymentStatus = 'pending';
  await app.checkPayment();
  const previousNavigations = env.operations.filter(operation => operation.type === 'tab-replace').length;
  app.continuePayment();
  assert.equal(statuses.length, 0);
  assert.equal(env.operations.filter(operation => operation.type === 'tab-replace').length, previousNavigations);
});

test('sponsorships without notifications go straight to Afdian without registering a payment intent', async t => {
  const { app, env, intents } = fixture(t, { notifications: false });
  await app.pay();
  assert.equal(intents.length, 0);
  assert.equal(env.saved.size, 0);
  assert.deepEqual(env.operations.map(operation => operation.type), ['open', 'detach', 'tab-replace']);
  assert.equal(env.operations[0].url, 'about:blank');
  assert.equal(env.operations[0].target, '_blank');
  assert.equal(env.tabs[0].opener, null);
  assert.equal(env.tabs[0].closed, false);
  assert.equal(app.state.role, 'gift');
  const url = new URL(env.operations.find(operation => operation.type === 'tab-replace').url);
  assert.equal(url.origin, 'https://afdian.com');
  assert.equal(url.searchParams.get('user_id'), demoConfig.afdianId);
  assert.equal(url.searchParams.get('custom_price'), '25.00');
  assert.doesNotMatch(url.searchParams.get('remark'), /参考餐厅|餐厅|undefined/);
  assert.equal(url.searchParams.has('custom_order_id'), false);
});

test('blocked payment tabs report an error before creating an intent or leaving this site', async t => {
  for (const notifications of [false, true]) {
    await t.test(notifications ? 'tracked checkout' : 'untracked checkout', async t => {
      const { app, env, intents } = fixture(t, { notifications });
      const open = t.mock.method(env.window, 'open', () => null);
      await app.pay();
      assert.deepEqual(open.mock.calls[0].arguments, ['about:blank', '_blank']);
      assert.equal(intents.length, 0);
      assert.equal(env.saved.size, 0);
      assert.equal(env.operations.length, 0);
      assert.equal(app.state.role, 'gift');
      assert.equal(app.state.busy, '');
      assert.match(app.state.error, /拦截.*新标签页/);
    });
  }
});

test('personal sponsorships carry their name into checkout and the restored receipt', async t => {
  const { app, env, statuses, checkout, returnToReceipt } = fixture(t);
  const { repo: _repo, ...scene } = app.state.config;
  app.state.config = { ...scene, sponsorType: 'person', name: '小林 🍔' };
  app.setCustomBlessing('谢谢你的分享！');
  await checkout();
  const outbound = new URL(env.operations.find(operation => operation.type === 'tab-replace').url);
  assert.match(outbound.searchParams.get('remark'), /赠予 +小林 🍔/);
  assert.equal(outbound.searchParams.get('remark').includes('项目：'), false);
  returnToReceipt();
  assert.equal(app.state.receipt.config.name, '小林 🍔');
  assert.equal(app.state.receipt.config.sponsorType, 'person');
  assert.equal(Object.hasOwn(app.state.receipt.config, 'repo'), false);
  statuses[0].resolve({ status: 'notified', amountCents: 2500, receivedAt: Date.now() });
  await settle();
  assert.equal(app.state.paymentStatus, 'notified');
});

test('tracked checkout reserves a tab synchronously and saves a private receipt before opening Afdian there', async t => {
  const { app, env, intents } = fixture(t);
  const paying = app.pay();
  assert.equal(intents.length, 1);
  assert.deepEqual(intents[0].input, { afdianId: demoConfig.afdianId, amountCents: 2500 });
  assert.deepEqual(env.operations, [{ type: 'open', url: 'about:blank', target: '_blank' }, { type: 'detach', value: null }]);
  assert.equal(env.tabs[0].opener, null);
  assert.equal(env.tabs[0].closed, false);
  await app.pay();
  assert.equal(env.tabs.length, 1, 'double click must not open a second tab');
  assert.equal(intents.length, 1, 'double click must not create a second pending sponsorship');

  intents[0].resolve({ intentId, readToken, expiresAt: Date.now() + 5 * 60_000 });
  await paying;
  const operations = env.operations.map(operation => operation.type);
  assert.ok(operations.indexOf('save') >= 0);
  assert.ok(operations.indexOf('save') < operations.indexOf('replace'));
  assert.ok(operations.indexOf('replace') < operations.indexOf('tab-replace'));
  assert.equal(env.location.pathname, thanksPath(intentId));
  assert.equal(app.state.role, 'payment');
  assert.equal(app.state.receipt.intentId, intentId);
  assert.equal(app.state.receipt.config.notifications, true);
  const saved = JSON.parse(env.saved.get('bigmac.payments.receipts.v1')).entries[0];
  assert.equal(saved.config.notifications, true);
  assert.equal(saved.readToken, readToken);
  assert.equal(env.tabs[0].closed, false, 'entering the receipt view must keep the payment tab open');
  assert.ok([...env.saved.values()].some(value => value.includes(readToken)));
  const outbound = env.operations.find(operation => operation.type === 'tab-replace').url;
  const url = new URL(outbound);
  assert.equal(url.searchParams.get('custom_order_id'), intentId);
  assert.equal(url.searchParams.get('custom_price'), '25.00');
  assert.match(url.searchParams.get('remark'), /巨无霸 +×1 +￥25\.00/);
  assert.doesNotMatch(url.searchParams.get('remark'), /参考餐厅|餐厅|undefined/);
  assert.equal(outbound.includes(readToken), false);
  assert.equal(env.operations.find(operation => operation.type === 'replace').url.includes(readToken), false);
});

test('an intent error keeps the sponsor on this site until an explicit untracked fallback', async t => {
  const { app, env, intents } = fixture(t);
  const paying = app.pay();
  intents[0].reject(new Error('通知服务暂时不可用'));
  await paying;
  assert.equal(env.operations.some(operation => operation.type === 'tab-replace'), false);
  assert.equal(env.operations.some(operation => operation.type === 'replace'), false);
  assert.equal(env.tabs[0].closed, true, 'failed intent creation must close its reserved tab');
  assert.equal(app.state.paymentFallback, true);
  assert.match(app.state.error, /通知服务暂时不可用/);
  assert.equal(app.state.busy, '');

  const blocked = t.mock.method(env.window, 'open', () => null);
  await app.payDirect();
  assert.match(app.state.error, /拦截.*新标签页/);
  assert.equal(env.operations.some(operation => operation.type === 'tab-replace'), false);
  blocked.mock.restore();
  await app.payDirect();
  assert.equal(intents.length, 1);
  assert.equal(env.tabs.length, 2);
  assert.equal(env.tabs[1].opener, null);
  assert.equal(env.tabs[1].closed, false);
  const outbound = new URL(env.operations.find(operation => operation.type === 'tab-replace').url);
  assert.equal(outbound.searchParams.has('custom_order_id'), false);
});

test('the explicit fallback permits an empty message after an intent failure', async t => {
  const { app, env, intents } = fixture(t);
  const paying = app.pay();
  intents[0].reject(new Error('通知服务暂时不可用'));
  await paying;
  app.setCustomBlessing('   ');
  await app.payDirect();
  await settle();
  const outbound = new URL(env.operations.find(operation => operation.type === 'tab-replace').url);
  assert.match(outbound.searchParams.get('remark'), /^赠予 +/);
  assert.match(outbound.searchParams.get('remark'), /巨无霸 +×1 +￥25\.00/);
  assert.equal(app.state.error, '');
});

test('blocked browser storage cannot silently start a tracked payment whose receipt cannot be restored', async t => {
  const { app, env, intents } = fixture(t);
  env.localStorage.setItem = () => { throw new Error('Storage is blocked'); };
  const paying = app.pay();
  intents[0].resolve({ intentId, readToken, expiresAt: Date.now() + 5 * 60_000 });
  await paying;
  assert.equal(env.operations.some(operation => operation.type === 'tab-replace'), false);
  assert.equal(env.operations.some(operation => operation.type === 'replace'), false);
  assert.equal(app.state.paymentFallback, true);
  assert.equal(env.tabs[0].closed, true);
  assert.ok(app.state.error);
});

test('an overlong checkout URL is rejected before any intent is written', async t => {
  const { app, env, intents } = fixture(t);
  app.state.customBlessing = '祝'.repeat(2000);
  await app.pay();
  assert.equal(intents.length, 0);
  assert.equal(env.operations.length, 0);
  assert.ok(app.state.error);
});

test('invalid message formatting is reported before creating a payment or opening a tab', async t => {
  const { app, env, intents } = fixture(t);
  app.setCustomBlessing('谢谢\t你');
  await app.pay();
  assert.equal(intents.length, 0);
  assert.equal(env.operations.length, 0);
  assert.match(app.state.error, /控制字符/);
});

test('a message longer than 500 characters survives checkout and the local receipt', async t => {
  const { app, env, checkout } = fixture(t);
  const blessing = '谢'.repeat(600);
  app.setCustomBlessing(blessing);
  await checkout();
  assert.equal(app.state.role, 'payment');
  assert.equal(app.state.receipt.blessing, blessing);
  const saved = JSON.parse(env.saved.get('bigmac.payments.receipts.v1')).entries[0];
  assert.equal(saved.blessing, blessing);
  const outbound = new URL(env.operations.find(operation => operation.type === 'tab-replace').url);
  assert.ok(outbound.searchParams.get('remark').startsWith(blessing + '\n'));
});

test('an empty optional message still saves the receipt and includes meal metadata in checkout', async t => {
  const { app, env, checkout } = fixture(t);
  app.setCustomBlessing('   ');
  await checkout();
  assert.equal(app.state.role, 'payment');
  assert.equal(app.state.receipt.blessing, '');
  const saved = JSON.parse(env.saved.get('bigmac.payments.receipts.v1')).entries[0];
  assert.equal(saved.blessing, '');
  const outbound = new URL(env.operations.find(operation => operation.type === 'tab-replace').url);
  assert.match(outbound.searchParams.get('remark'), /^赠予 +/);
  assert.match(outbound.searchParams.get('remark'), /巨无霸 +×1 +￥25\.00/);
});

test('item subtotals and total quantity survive checkout, storage and continuing payment', async t => {
  const { app, env, checkout } = fixture(t);
  app.state.menu.products.push({ code: 'fries', name: '薯条（大份）', priceCents: 1450, image: null });
  app.changeQuantity('burger', 1);
  app.changeQuantity('fries', 1);
  await checkout();
  const first = new URL(env.operations.find(operation => operation.type === 'tab-replace').url);
  const remark = first.searchParams.get('remark');
  assert.equal(first.searchParams.get('custom_price'), '64.50');
  assert.match(remark, /商品 +数目 +价格/);
  assert.match(remark, /巨无霸 +×2 +￥50\.00/);
  assert.match(remark, /薯条（大份） +×1 +￥14\.50/);
  assert.match(remark, /总计 +×3 +￥64\.50/);
  assert.ok(remark.endsWith('\n\nCreate by Buy me a Big Mac'));
  const saved = JSON.parse(env.saved.get('bigmac.payments.receipts.v1')).entries[0];
  assert.deepEqual(saved.items.map(item => item.amountCents), [5000, 1450]);
  assert.equal(new URL(app.paymentUrl()).searchParams.get('remark'), remark);
  env.go('/');
  env.go(thanksPath(intentId));
  assert.equal(new URL(app.paymentUrl()).searchParams.get('remark'), remark);
  app.continuePayment();
  const last = new URL(env.operations.filter(operation => operation.type === 'tab-replace').at(-1).url);
  assert.equal(last.searchParams.get('remark'), remark);
  assert.equal(last.searchParams.get('custom_order_id'), intentId);
});

test('navigating away while an intent is created ignores a late completion', async t => {
  const { app, env, intents } = fixture(t);
  const paying = app.pay();
  env.go('/');
  assert.ok(intents[0].disconnects > 0);
  assert.equal(env.tabs[0].closed, true);
  intents[0].resolve({ intentId, readToken, expiresAt: Date.now() + 5 * 60_000 });
  await paying;
  assert.equal(app.state.role, 'author');
  assert.equal(env.saved.size, 0);
  assert.equal(env.operations.some(operation => operation.type === 'tab-replace'), false);
});

test('suspending a pending checkout closes its reserved tab and ignores late completion', async t => {
  for (const trigger of ['pagehide', 'unmount']) {
    await t.test(trigger, async t => {
      const { app, env, intents } = fixture(t);
      const paying = app.pay();
      if (trigger === 'pagehide') env.window.dispatchEvent(new Event('pagehide'));
      else env.cleanup.shift()();
      assert.equal(env.tabs[0].closed, true);
      assert.ok(intents[0].disconnects > 0);
      intents[0].resolve({ intentId, readToken, expiresAt: Date.now() + 5 * 60_000 });
      await paying;
      assert.equal(env.saved.size, 0);
      assert.equal(env.tabs.length, 1);
      assert.equal(env.operations.some(operation => operation.type === 'tab-replace'), false);
      assert.equal(env.operations.some(operation => operation.type === 'replace'), false);
    });
  }
});

test('closing the reserved tab preserves the receipt and explicit continuation reuses the same intent', async t => {
  const { app, env, intents, statuses } = fixture(t);
  const paying = app.pay();
  env.tabs[0].close();
  env.document.visibilityState = 'visible';
  intents[0].resolve({ intentId, readToken, expiresAt: Date.now() + 5 * 60_000 });
  await paying;
  assert.equal(env.location.pathname, thanksPath(intentId));
  assert.equal(app.state.role, 'payment');
  assert.equal(app.state.receipt.intentId, intentId);
  assert.ok([...env.saved.values()].some(value => value.includes(readToken)));
  assert.equal(env.tabs.length, 1, 'completion must not open a tab after the user closed it');
  assert.equal(env.operations.some(operation => operation.type === 'tab-replace'), false);
  assert.match(app.state.paymentError, /已关闭.*继续前往爱发电/);
  assert.equal(statuses.length, 1);
  statuses[0].resolve({ status: 'pending', expiresAt: app.state.receipt.expiresAt });
  await settle();

  const blocked = t.mock.method(env.window, 'open', () => null);
  app.continuePayment();
  assert.match(app.state.paymentError, /拦截.*新标签页/);
  assert.equal(env.operations.some(operation => operation.type === 'tab-replace'), false);
  blocked.mock.restore();
  app.continuePayment();
  assert.equal(intents.length, 1);
  assert.equal(env.tabs.length, 2);
  assert.equal(env.tabs[1].opener, null);
  assert.equal(env.tabs[1].closed, false);
  assert.equal(app.state.paymentError, '');
  const outbound = new URL(env.operations.find(operation => operation.type === 'tab-replace').url);
  assert.equal(outbound.searchParams.get('custom_order_id'), intentId);
  assert.equal(outbound.toString().includes(readToken), false);
});

test('a failed tab navigation keeps the saved receipt available for explicit continuation', async t => {
  const { app, env, intents } = fixture(t);
  const paying = app.pay();
  env.tabs[0].location.replace = () => { throw new Error('Navigation blocked'); };
  intents[0].resolve({ intentId, readToken, expiresAt: Date.now() + 5 * 60_000 });
  await paying;
  assert.equal(env.tabs[0].closed, true);
  assert.equal(env.tabs.length, 1);
  assert.equal(app.state.role, 'payment');
  assert.equal(app.state.receipt.intentId, intentId);
  assert.equal(app.state.paymentStatus, 'pending');
  assert.equal(app.state.paymentFallback, false);
  assert.match(app.state.paymentError, /未能打开爱发电.*继续前往爱发电/);
  app.continuePayment();
  assert.equal(intents.length, 1);
  assert.equal(env.tabs.length, 2);
  assert.equal(env.tabs[1].closed, false);
  const outbound = new URL(env.operations.find(operation => operation.type === 'tab-replace').url);
  assert.equal(outbound.searchParams.get('custom_order_id'), intentId);
});

test('the original tab renders its receipt and checks payment whenever it becomes visible', async t => {
  for (const focusNewTab of [true, false]) {
    await t.test(focusNewTab ? 'Afdian opens in the foreground' : 'Afdian opens in the background', async t => {
      const { app, env, statuses, checkout } = fixture(t, { focusNewTab });
      await checkout();
      assert.equal(app.state.role, 'payment');
      assert.equal(app.state.receipt.intentId, intentId);
      assert.equal(statuses.length, focusNewTab ? 0 : 1);
      if (focusNewTab) {
        env.document.visibilityState = 'visible';
        env.document.dispatchEvent(new Event('visibilitychange'));
      }
      env.window.dispatchEvent(new Event('focus'));
      assert.equal(statuses.length, 1);
      statuses[0].resolve({ status: 'pending', expiresAt: app.state.receipt.expiresAt });
      await settle();
      env.document.visibilityState = 'hidden';
      env.document.dispatchEvent(new Event('visibilitychange'));
      env.document.visibilityState = 'visible';
      env.document.dispatchEvent(new Event('visibilitychange'));
      assert.equal(statuses.length, 2);
      statuses[1].resolve({ status: 'notified', amountCents: 2500, receivedAt: Date.now() });
      await settle();
      assert.equal(app.state.paymentStatus, 'notified');
      assert.equal(app.state.celebrationId, 1);
      assert.equal(env.tabs.length, 1, 'visibility changes must not reopen Afdian');
      assert.equal(env.tabs[0].closed, false);
    });
  }
});

test('returning to a saved receipt queries the status without automatically opening another payment', async t => {
  const { app, env, statuses, checkout, returnToReceipt } = fixture(t);
  await checkout();
  const outboundCount = env.operations.filter(operation => operation.type === 'tab-replace').length;
  returnToReceipt();
  assert.equal(app.state.role, 'payment');
  assert.equal(app.state.receipt.intentId, intentId);
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].intentId, intentId);
  assert.equal(statuses[0].readToken, readToken);
  assert.equal(app.state.celebrationId, 0);
  app.replayCelebration();
  assert.equal(app.state.celebrationId, 0, 'pending payments cannot replay a success animation');
  assert.equal(env.operations.filter(operation => operation.type === 'tab-replace').length, outboundCount);
  const afdianOrderNo = '00202610130250001234567890123';
  statuses[0].resolve({ status: 'notified', amountCents: 2500, receivedAt: Date.now(), expiresAt: Date.now() + 5 * 60_000, afdianOrderNo });
  await settle();
  assert.equal(app.state.paymentStatus, 'notified');
  assert.equal(app.state.receipt.afdianOrderNo, afdianOrderNo);
  const savedReceipt = JSON.parse(env.saved.get('bigmac.payments.receipts.v1')).entries.find(entry => entry.intentId === intentId);
  assert.equal(savedReceipt.afdianOrderNo, afdianOrderNo, 'the exact platform order number survives a page reload');
  assert.equal(app.state.celebrationId, 1);
  env.window.dispatchEvent(new Event('focus'));
  await app.checkPayment();
  await settle();
  assert.equal(statuses.length, 1);
  assert.equal(app.state.celebrationId, 1, 'a confirmed notification must not celebrate again on focus or recheck');
  app.replayCelebration();
  assert.equal(app.state.celebrationId, 2, 'only an explicit replay starts another animation');
  assert.equal(statuses.length, 1, 'replaying does not query or initiate another payment');
  assert.equal(env.operations.filter(operation => operation.type === 'tab-replace').length, outboundCount);
});

test('the receipt preview includes an example order and allows replay without payment requests', t => {
  const env = browser(t, '/preview/thanks');
  let paymentClients = 0;
  const app = createAppController({ createPaymentClient() { paymentClients++; throw new Error('Preview must stay offline'); } });
  env.cleanup.push(app.init());
  assert.equal(app.state.preview, true);
  assert.equal(app.state.paymentStatus, 'notified');
  assert.match(app.state.receipt.afdianOrderNo, /^\d+$/);
  assert.equal(app.state.celebrationId, 1);
  app.replayCelebration();
  assert.equal(app.state.celebrationId, 2);
  assert.equal(paymentClients, 0);
  assert.equal(env.saved.size, 0);
});

test('browser Back after navigating elsewhere restores the saved receipt from the back-forward cache', async t => {
  const { app, env, statuses, checkout } = fixture(t);
  await checkout();
  env.window.dispatchEvent(new Event('pagehide'));
  env.document.visibilityState = 'visible';
  const restored = new Event('pageshow');
  Object.defineProperty(restored, 'persisted', { value: true });
  env.window.dispatchEvent(restored);
  assert.equal(app.state.role, 'payment');
  assert.equal(app.state.receipt.intentId, intentId);
  assert.equal(statuses.length, 1);
  statuses[0].resolve({ status: 'unknown' });
  await settle();
  assert.equal(app.state.paymentStatus, 'unknown');
  assert.equal(env.operations.filter(operation => operation.type === 'tab-replace').length, 1);
});

test('continuing checkout uses the server intent expiry instead of extending it by response latency', async t => {
  const { app, env, intents, statuses, returnToReceipt } = fixture(t);
  const serverExpiry = Date.now() + 299_000;
  const paying = app.pay();
  intents[0].resolve({ intentId, readToken, expiresAt: serverExpiry });
  await paying;
  returnToReceipt();
  statuses[0].resolve({ status: 'pending', expiresAt: serverExpiry });
  await settle();
  t.mock.method(Date, 'now', () => serverExpiry + 1);
  assert.ok(Date.now() < app.state.receipt.createdAt + 300_000);
  app.continuePayment();
  assert.equal(env.operations.filter(operation => operation.type === 'tab-replace').length, 1);
  assert.match(app.state.paymentError, /过期/);
});

test('pending status polls only while visible, then stops when the server can no longer confirm it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { app, env, statuses, checkout, returnToReceipt } = fixture(t);
  await checkout();
  returnToReceipt();
  statuses[0].resolve({ status: 'pending', expiresAt: Date.now() + 5 * 60_000 });
  await settle();
  assert.equal(app.state.celebrationId, 0);
  t.mock.timers.tick(9_999);
  assert.equal(statuses.length, 1);
  t.mock.timers.tick(1);
  assert.equal(statuses.length, 2);
  statuses[1].resolve({ status: 'pending', expiresAt: Date.now() + 5 * 60_000 });
  await settle();

  env.document.visibilityState = 'hidden';
  env.document.dispatchEvent(new Event('visibilitychange'));
  t.mock.timers.tick(30_000);
  assert.equal(statuses.length, 2);
  env.document.visibilityState = 'visible';
  env.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(statuses.length, 3);
  statuses[2].resolve({ status: 'unknown' });
  await settle();
  assert.equal(app.state.paymentStatus, 'unknown');
  assert.equal(app.state.celebrationId, 0);
  t.mock.timers.tick(60_000);
  assert.equal(statuses.length, 3);
});

test('a late status response cannot overwrite the page after navigation', async t => {
  const { app, env, statuses, checkout, returnToReceipt } = fixture(t);
  await checkout();
  returnToReceipt();
  env.go('/');
  assert.ok(statuses[0].disconnects > 0);
  statuses[0].resolve({ status: 'notified', amountCents: 2500, receivedAt: Date.now(), expiresAt: Date.now() + 5 * 60_000 });
  await settle();
  assert.equal(app.state.role, 'author');
  assert.equal(app.state.receipt, null);
  assert.notEqual(app.state.paymentStatus, 'notified');
});

test('opening a receipt URL without its local read token cannot claim payment or call the status API', t => {
  const { app, env, statuses } = fixture(t);
  env.go(thanksPath(intentId));
  assert.equal(app.state.role, 'payment');
  assert.equal(app.state.paymentStatus, 'missing');
  assert.equal(app.state.receipt, null);
  assert.equal(statuses.length, 0);
  assert.equal(env.operations.some(operation => operation.type === 'tab-replace'), false);
});

test('returning after the maximum local query window does not restart polling or infer success', async t => {
  const { app, statuses, checkout, returnToReceipt } = fixture(t);
  const startedAt = Date.now();
  await checkout();
  t.mock.method(Date, 'now', () => startedAt + 11 * 60_000);
  returnToReceipt();
  await settle();
  assert.equal(app.state.role, 'payment');
  assert.ok(['unknown', 'missing'].includes(app.state.paymentStatus));
  assert.equal(statuses.length, 0);
});

test('a status network error remains unconfirmed and can be retried explicitly', async t => {
  const { app, statuses, checkout, returnToReceipt } = fixture(t);
  await checkout();
  returnToReceipt();
  statuses[0].reject(new Error('网络暂时不可用'));
  await settle();
  assert.equal(app.state.paymentStatus, 'error');
  assert.equal(app.state.celebrationId, 0);
  assert.ok(app.state.paymentError);
  const retry = app.checkPayment();
  assert.equal(statuses.length, 2);
  statuses[1].resolve({ status: 'notified', amountCents: 2500, receivedAt: Date.now(), expiresAt: Date.now() + 5 * 60_000 });
  await retry;
  assert.equal(app.state.paymentStatus, 'notified');
  assert.equal(app.state.celebrationId, 1);
  assert.equal(app.state.paymentError, '');
});
