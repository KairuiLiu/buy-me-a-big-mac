import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import { compileModule } from 'svelte/compiler';
import { demoConfig } from '../src/lib/preview.js';

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

const integrationId = 'b'.repeat(32);
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

function browser(t, initialHash = '#create') {
  const saved = new Map();
  const operations = [];
  const cleanup = [];
  const window = new EventTarget();
  const document = new EventTarget();
  document.visibilityState = 'visible';
  document.getElementById = () => null;
  document.querySelector = () => null;
  const location = {
    origin: 'https://bigmac.example', pathname: '/', hash: initialHash,
    assign(url) { operations.push({ type: 'assign', url }); },
  };
  const history = {
    replaceState(_state, _title, value) {
      const url = new URL(value, location.origin);
      operations.push({ type: 'replace', url: url.href });
      location.hash = url.hash;
    },
  };
  const localStorage = {
    get length() { return saved.size; },
    key(index) { return Array.from(saved.keys())[index] ?? null; },
    getItem(key) { return saved.get(key) ?? null; },
    setItem(key, value) { operations.push({ type: 'save', key }); saved.set(key, String(value)); },
    removeItem(key) { saved.delete(key); },
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
  });
  return { window, document, location, history, localStorage, saved, operations, cleanup };
}

function ready(app, integrated = true) {
  Object.assign(app.state, {
    preview: false, role: 'gift', connected: true,
    config: { ...demoConfig, ...(integrated ? { integrationId } : {}) },
    menu: structuredClone(menu), cart: [{ code: 'burger', name: '巨无霸', quantity: 1 }],
    quote: structuredClone(quote), quotedAt: Date.now(), quoteStatus: 'idle', confirmed: true,
    customBlessing: '谢谢你维护这个项目！',
  });
}

function fixture(t, { integrated = true, pollingMs = 10_000 } = {}) {
  const env = browser(t);
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
  ready(app, integrated);
  function returnToReceipt() {
    env.window.dispatchEvent(new Event('hashchange'));
  }
  async function checkout() {
    const paying = app.pay();
    intents.at(-1).resolve({ intentId, readToken, expiresAt: Date.now() + 5 * 60_000 });
    await paying;
  }
  return { app, env, intents, statuses, checkout, returnToReceipt };
}

test('legacy sponsorship links go straight to Afdian without registering a payment intent', async t => {
  const { app, env, intents } = fixture(t, { integrated: false });
  await app.pay();
  assert.equal(intents.length, 0);
  assert.equal(env.saved.size, 0);
  assert.equal(env.operations.length, 1);
  const url = new URL(env.operations[0].url);
  assert.equal(url.origin, 'https://afdian.com');
  assert.equal(url.searchParams.get('user_id'), demoConfig.afdianId);
  assert.equal(url.searchParams.get('custom_price'), '25.00');
  assert.equal(url.searchParams.has('custom_order_id'), false);
});

test('tracked checkout waits for its intent and saves a private receipt before replacing history and leaving', async t => {
  const { app, env, intents } = fixture(t);
  const paying = app.pay();
  assert.equal(intents.length, 1);
  assert.deepEqual(intents[0].input, { integrationId, afdianId: demoConfig.afdianId, amountCents: 2500 });
  assert.equal(env.operations.length, 0);
  await app.pay();
  assert.equal(intents.length, 1, 'double click must not create a second pending sponsorship');

  intents[0].resolve({ intentId, readToken, expiresAt: Date.now() + 5 * 60_000 });
  await paying;
  const operations = env.operations.map(operation => operation.type);
  assert.ok(operations.indexOf('save') >= 0);
  assert.ok(operations.indexOf('save') < operations.indexOf('replace'));
  assert.ok(operations.indexOf('replace') < operations.indexOf('assign'));
  assert.equal(env.location.hash, `#/thanks/${intentId}`);
  assert.ok([...env.saved.values()].some(value => value.includes(readToken)));
  const outbound = env.operations.find(operation => operation.type === 'assign').url;
  const url = new URL(outbound);
  assert.equal(url.searchParams.get('custom_order_id'), intentId);
  assert.equal(url.searchParams.get('custom_price'), '25.00');
  assert.ok(url.searchParams.get('remark').includes('巨无霸 ×1'));
  assert.equal(outbound.includes(readToken), false);
  assert.equal(env.operations.find(operation => operation.type === 'replace').url.includes(readToken), false);
});

test('an intent error keeps the sponsor on this site until an explicit untracked fallback', async t => {
  const { app, env, intents } = fixture(t);
  const paying = app.pay();
  intents[0].reject(new Error('通知服务暂时不可用'));
  await paying;
  assert.equal(env.operations.some(operation => operation.type === 'assign'), false);
  assert.equal(env.operations.some(operation => operation.type === 'replace'), false);
  assert.equal(app.state.paymentFallback, true);
  assert.match(app.state.error, /通知服务暂时不可用/);
  assert.equal(app.state.busy, '');

  await app.payDirect();
  assert.equal(intents.length, 1);
  const outbound = new URL(env.operations.find(operation => operation.type === 'assign').url);
  assert.equal(outbound.searchParams.has('custom_order_id'), false);
});

test('the explicit fallback still requires a blessing after an intent failure', async t => {
  const { app, env, intents } = fixture(t);
  const paying = app.pay();
  intents[0].reject(new Error('通知服务暂时不可用'));
  await paying;
  app.setCustomBlessing('   ');
  await app.payDirect();
  await settle();
  assert.equal(env.operations.some(operation => operation.type === 'assign'), false);
  assert.match(app.state.error, /祝福/);
});

test('blocked browser storage cannot silently start a tracked payment whose receipt cannot be restored', async t => {
  const { app, env, intents } = fixture(t);
  env.localStorage.setItem = () => { throw new Error('Storage is blocked'); };
  const paying = app.pay();
  intents[0].resolve({ intentId, readToken, expiresAt: Date.now() + 5 * 60_000 });
  await paying;
  assert.equal(env.operations.some(operation => operation.type === 'assign'), false);
  assert.equal(env.operations.some(operation => operation.type === 'replace'), false);
  assert.equal(app.state.paymentFallback, true);
  assert.ok(app.state.error);
});

test('an invalid checkout message is rejected before any intent is written', async t => {
  const { app, env, intents } = fixture(t);
  app.state.customBlessing = '祝'.repeat(500);
  await app.pay();
  assert.equal(intents.length, 0);
  assert.equal(env.operations.length, 0);
  assert.ok(app.state.error);
});

test('navigating away while an intent is created ignores a late completion', async t => {
  const { app, env, intents } = fixture(t);
  const paying = app.pay();
  env.location.hash = '#create';
  env.window.dispatchEvent(new Event('hashchange'));
  assert.ok(intents[0].disconnects > 0);
  intents[0].resolve({ intentId, readToken, expiresAt: Date.now() + 5 * 60_000 });
  await paying;
  assert.equal(app.state.role, 'author');
  assert.equal(env.saved.size, 0);
  assert.equal(env.operations.some(operation => operation.type === 'assign'), false);
});

test('returning to a saved receipt queries the status without automatically opening another payment', async t => {
  const { app, env, statuses, checkout, returnToReceipt } = fixture(t);
  await checkout();
  const outboundCount = env.operations.filter(operation => operation.type === 'assign').length;
  returnToReceipt();
  assert.equal(app.state.role, 'payment');
  assert.equal(app.state.receipt.intentId, intentId);
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].intentId, intentId);
  assert.equal(statuses[0].readToken, readToken);
  assert.equal(app.state.celebrationId, 0);
  assert.equal(env.operations.filter(operation => operation.type === 'assign').length, outboundCount);
  statuses[0].resolve({ status: 'notified', amountCents: 2500, receivedAt: Date.now(), expiresAt: Date.now() + 5 * 60_000 });
  await settle();
  assert.equal(app.state.paymentStatus, 'notified');
  assert.equal(app.state.celebrationId, 1);
  env.window.dispatchEvent(new Event('focus'));
  await app.checkPayment();
  await settle();
  assert.equal(statuses.length, 1);
  assert.equal(app.state.celebrationId, 1, 'a confirmed notification must not celebrate again on focus or recheck');
  assert.equal(env.operations.filter(operation => operation.type === 'assign').length, outboundCount);
});

test('browser Back from Afdian restores the saved result route from the back-forward cache', async t => {
  const { app, env, statuses, checkout } = fixture(t);
  await checkout();
  env.window.dispatchEvent(new Event('pagehide'));
  const restored = new Event('pageshow');
  Object.defineProperty(restored, 'persisted', { value: true });
  env.window.dispatchEvent(restored);
  assert.equal(app.state.role, 'payment');
  assert.equal(app.state.receipt.intentId, intentId);
  assert.equal(statuses.length, 1);
  statuses[0].resolve({ status: 'unknown' });
  await settle();
  assert.equal(app.state.paymentStatus, 'unknown');
  assert.equal(env.operations.filter(operation => operation.type === 'assign').length, 1);
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
  assert.equal(env.operations.filter(operation => operation.type === 'assign').length, 1);
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
  env.location.hash = '#create';
  env.window.dispatchEvent(new Event('hashchange'));
  assert.ok(statuses[0].disconnects > 0);
  statuses[0].resolve({ status: 'notified', amountCents: 2500, receivedAt: Date.now(), expiresAt: Date.now() + 5 * 60_000 });
  await settle();
  assert.equal(app.state.role, 'author');
  assert.equal(app.state.receipt, null);
  assert.notEqual(app.state.paymentStatus, 'notified');
});

test('opening a receipt URL without its local read token cannot claim payment or call the status API', t => {
  const { app, env, statuses } = fixture(t);
  env.location.hash = `#/thanks/${intentId}`;
  env.window.dispatchEvent(new Event('hashchange'));
  assert.equal(app.state.role, 'payment');
  assert.equal(app.state.paymentStatus, 'missing');
  assert.equal(app.state.receipt, null);
  assert.equal(statuses.length, 0);
  assert.equal(env.operations.some(operation => operation.type === 'assign'), false);
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
