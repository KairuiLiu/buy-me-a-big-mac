import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../worker/api.js';
import { McdClient } from '../worker/mcp-client.js';
import { createApp } from '../worker/index.js';

const ROOT = 'https://bigmac.example';
const TOKEN = 'fake-server-only-token';
const config = { storeCode: '123', beCode: '456', orderType: 1, beType: 1 };
const items = [{ productCode: 'BIGMAC', quantity: 2 }];
const env = () => ({ MCD_TOKEN: TOKEN, API_RATE_LIMITER: { limit: async () => ({ success: true }) } });
const request = (path, body = {}, options = {}) => new Request(`${ROOT}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ROOT, 'CF-Connecting-IP': '192.0.2.1', ...options.headers },
  body: options.body ?? JSON.stringify(body), duplex: 'half', signal: options.signal,
});
const quote = { price: 5000, originalPrice: 5500, discount: 500, productList: [{ productCode: 'BIGMAC', productName: '巨无霸', quantity: 2, subtotal: 5000, originalSubtotal: 5500, userId: 'private-id' }], userId: 'private-id', couponId: 'private-coupon' };
const menu = { frequent: [{ code: 'BIGMAC', tags: ['我的常点'] }], userId: 'private-id', categories: [{ name: '汉堡', meals: [{ code: 'BIGMAC', tags: ['private-tag'] }] }], meals: { BIGMAC: { name: '巨无霸', currentPrice: '25', originalPrice: '27.5', image: 'https://example.com/bigmac.jpg', discountType: null, withOrder: { cardId: 'private-card' }, isCanWithOrder: true } } };
function fake(overrides = {}) {
  let disconnected = 0;
  const calls = [];
  const clientFactory = (token, options) => {
    assert.equal(token, TOKEN);
    return {
      connect: async () => { calls.push(['connect']); },
      searchStores: async args => { calls.push(['stores', args]); return [{ storeCode: '123', beCode: '456', storeName: '测试餐厅', address: '测试路', distance: '1公里', businessStatus: true, favorite: true, userId: 'private-id', reservationTimeOptions: [{ private: true }] }]; },
      getMenu: async args => { calls.push(['menu', args]); return menu; },
      calculate: async (args, cart) => { calls.push(['quote', args, cart]); return quote; },
      disconnect: () => { disconnected++; }, ...overrides,
    };
  };
  return { clientFactory, calls, countDisconnected: () => disconnected };
}

test('business routes use only the server credential and return normalized public fields', async () => {
  const f = fake();
  const cases = [
    ['/api/connect', {}, { ok: true }],
    ['/api/stores', { city: '上海', keyword: '人民广场', beType: 1 }, [{ storeCode: '123', beCode: '456', storeName: '测试餐厅', address: '测试路', distance: '1公里', businessStatus: true }]],
    ['/api/menu', { config }, { categories: [{ name: '汉堡', codes: ['BIGMAC'] }], products: [{ code: 'BIGMAC', name: '巨无霸', priceCents: 2500, originalPriceCents: 2750, image: 'https://example.com/bigmac.jpg', discountType: null }] }],
    ['/api/quote', { config, items }, { amountCents: 5000, originalCents: 5500, discountCents: 500, items: [{ code: 'BIGMAC', name: '巨无霸', quantity: 2, amountCents: 5000, originalCents: 5500 }] }],
  ];
  for (const [path, input, expected] of cases) {
    const response = await handleApi(request(path, input, { headers: { 'X-Mcd-Token': 'browser-supplied-secret', Authorization: 'Bearer ignored-site-login' } }), env(), f);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const raw = await response.text();
    for (const privateText of [TOKEN, 'private-', 'frequent', 'withOrder', 'favorite', 'browser-supplied']) assert.equal(raw.includes(privateText), false);
    assert.deepEqual(JSON.parse(raw), { data: expected });
  }
  assert.equal(f.countDisconnected(), 4);
  assert.deepEqual(f.calls.at(-1), ['quote', config, items]);
});

test('rejects account and mutation parameters at every nesting level before constructing an upstream client', async () => {
  const f = fake();
  const cases = [
    ['/api/connect', { token: 'secret' }],
    ['/api/stores', { searchType: 1 }],
    ['/api/stores', { city: '上海', keyword: '广场', searchType: 2 }],
    ['/api/stores', { latitude: 31, longitude: 121, keyword: '广场' }],
    ['/api/stores', { latitude: 91, longitude: 121 }],
    ['/api/stores', { latitude: 31 }],
    ['/api/stores', { latitude: '31', longitude: 121 }],
    ['/api/stores', { city: '上海', keyword: '广场', beType: 2 }],
    ['/api/menu', { config: { ...config, couponId: 'private' } }],
    ['/api/menu', { config: { ...config, orderType: 2 } }],
    ['/api/menu', { config: { ...config, storeCode: 'a/b' } }],
    ['/api/menu', { config: { ...config, storeCode: 123 } }],
    ['/api/menu', { config, withOrder: {} }],
    ['/api/quote', { config, items: [{ ...items[0], couponId: 'id' }] }],
    ['/api/quote', { config, items: [{ ...items[0], withOrder: {} }] }],
    ['/api/quote', { config, items: [{ ...items[0], roundList: [] }] }],
    ['/api/quote', { config, items: [{ ...items[0], quantity: 0 }] }],
    ['/api/quote', { config, items: [{ ...items[0], quantity: 21 }] }],
    ['/api/quote', { config, items: [{ ...items[0], quantity: '2' }] }],
    ['/api/quote', { config, items: [items[0], items[0]] }],
    ['/api/quote', { config, items: Array.from({ length: 31 }, (_, i) => ({ productCode: `P${i}`, quantity: 1 })) }],
    ['/api/quote', { config, items: [] }],
    ['/api/quote', { config, items, name: 'create-order' }],
  ];
  for (const [path, input] of cases) {
    const response = await handleApi(request(path, input), env(), f);
    assert.equal(response.status, 400, `${path}: ${JSON.stringify(input)}`);
  }
  assert.equal(f.countDisconnected(), 0);
  assert.deepEqual(f.calls, []);
});

test('only explicit text or geolocation store searches are accepted', async () => {
  const f = fake();
  const response = await handleApi(request('/api/stores', { latitude: 31.2, longitude: 121.4, beType: 5 }), env(), f);
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls[0], ['stores', { latitude: 31.2, longitude: 121.4, beType: 5 }]);
});

test('all API routes including malformed and stale RPC requests are rate limited', async () => {
  const limited = [];
  const settings = env();
  settings.API_RATE_LIMITER.limit = async input => { limited.push(input); return { success: false }; };
  for (const path of ['/api/connect', '/api/stores', '/api/menu', '/api/quote', '/api/mcp', '/api/unknown']) {
    const response = await handleApi(request(path), settings, fake());
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '60');
  }
  assert.deepEqual(limited, Array(6).fill({ key: '192.0.2.1' }));
  const missing = await handleApi(request('/api/connect'), { MCD_TOKEN: TOKEN }, fake());
  assert.equal(missing.status, 503);
  const failed = await handleApi(request('/api/connect'), { ...env(), API_RATE_LIMITER: { limit: () => { throw new Error(TOKEN); } } }, fake());
  assert.equal(failed.status, 503);
  assert.equal((await failed.text()).includes(TOKEN), false);
});

test('rejects generic RPC routes, cross origin, wrong methods, media types, malformed JSON and oversized streamed bodies', async () => {
  const f = fake();
  const malformed = [
    [request('/api/mcp', { jsonrpc: '2.0', method: 'tools/call', params: { name: 'create-order' } }), 404],
    [request('/api/meal'), 404],
    [request('/api/connect?token=secret'), 404],
    [new Request(`${ROOT}/api/connect`, { headers: { 'CF-Connecting-IP': '192.0.2.1' } }), 405],
    [request('/api/connect', {}, { headers: { Origin: 'https://evil.example' } }), 403],
    [request('/api/connect', {}, { headers: { 'Sec-Fetch-Site': 'cross-site' } }), 403],
    [request('/api/connect', {}, { headers: { 'Content-Type': 'text/plain' } }), 415],
    [request('/api/connect', {}, { body: '{' }), 400],
    [request('/api/connect', []), 400],
    [request('/api/connect', {}, { headers: { 'Content-Length': '17000' } }), 413],
  ];
  for (const [input, status] of malformed) assert.equal((await handleApi(input, env(), f)).status, status);
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(17 * 1024)); }, cancel() { cancelled = true; } });
  assert.equal((await handleApi(request('/api/connect', {}, { body, headers: { 'Content-Length': '1' } }), env(), f)).status, 413);
  assert.equal(cancelled, true);
  assert.equal(f.countDisconnected(), 0);
});

test('mismatched quotes and upstream account diagnostics fail closed with generic messages', async () => {
  for (const failure of [() => { throw new Error(`${TOKEN} private-id private-coupon`); }, () => ({ ...quote, productList: [{ ...quote.productList[0], productCode: 'ANOTHER' }] })]) {
    const response = await handleApi(request('/api/quote', { config, items }), env(), fake({ calculate: failure }));
    assert.equal(response.status, 502);
    const raw = await response.text();
    for (const privateText of [TOKEN, 'private-', 'ANOTHER']) assert.equal(raw.includes(privateText), false);
  }
});

test('deadline and caller cancellation disconnect request-scoped upstream clients', async () => {
  const f = fake({ connect: () => new Promise(() => {}) });
  const response = await handleApi(request('/api/connect'), env(), { ...f, timeoutMs: 15 });
  assert.equal(response.status, 504);
  assert.ok(f.countDisconnected() >= 1);
  const controller = new AbortController();
  const f2 = fake({ connect: async () => { controller.abort(); return new Promise(() => {}); } });
  const aborted = await handleApi(request('/api/connect', {}, { signal: controller.signal }), env(), f2);
  assert.equal(aborted.status, 499);
  assert.ok(f2.countDisconnected() >= 1);
});

test('upstream transport always uses fixed HTTPS endpoint, server bearer, manual redirects and internally generated session headers', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, options, body });
    let result;
    if (body.method === 'initialize') result = { protocolVersion: '2025-03-26' };
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (body.method === 'tools/list') result = { tools: [{ name: 'query-meals', inputSchema: { type: 'object' } }] };
    if (body.method === 'tools/call') result = { structuredContent: { success: true, code: 200, data: menu } };
    return new Response(JSON.stringify({ id: body.id, result }), { headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'server-session' } });
  };
  const response = await handleApi(request('/api/menu', { config }, { headers: { Authorization: 'Bearer site-cookie', 'X-Mcd-Token': 'evil', 'Mcp-Session-Id': 'browser-session' } }), env(), { fetchImpl });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 4);
  for (const { url, options } of calls) {
    assert.equal(url, 'https://mcp.mcd.cn/');
    assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(options.headers['X-Mcd-Token'], undefined);
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, undefined);
    assert.equal(options.cache, undefined);
    assert.notEqual(options.headers['Mcp-Session-Id'], 'browser-session');
  }
  assert.equal(calls.at(-1).options.headers['Mcp-Session-Id'], 'server-session');
});

test('upstream JSON and SSE bodies are bounded, and redirects are never followed', async () => {
  for (const kind of ['json', 'sse', 'redirect']) {
    let cancelled = false;
    let calls = 0;
    const client = new McdClient(TOKEN, { fetchImpl: async () => {
      calls++;
      const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(3 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; } });
      return new Response(stream, { status: kind === 'redirect' ? 302 : 200, headers: { 'Content-Type': kind === 'sse' ? 'text/event-stream' : 'application/json', Location: `https://evil.example/${TOKEN}` } });
    } });
    await assert.rejects(client.connect());
    assert.equal(cancelled, true);
    assert.equal(calls, 1);
    client.disconnect();
  }
});

test('static app passes env into API and never exposes server modules as assets', async () => {
  const app = createApp({ '/index.html': { body: '<html></html>', type: 'text/html' } });
  assert.equal((await app.fetch(new Request(`${ROOT}/worker/mcp-client.js`), env())).status, 404);
  assert.equal((await app.fetch(request('/api/mcp'), env())).status, 404);
  assert.equal((await app.fetch(request('/api/connect'), {})).status, 503);
});

test('public store labels tolerate null fields, numeric upstream codes and presentation whitespace', async () => {
  const response = await handleApi(request('/api/stores', { city: '上海', keyword: '测试' }), env(), fake({ searchStores: async () => [{ storeCode: 123, beCode: 456, storeName: '测试\n餐厅', address: null, distance: null }] }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: [{ storeCode: '123', beCode: '456', storeName: '测试 餐厅', address: '', distance: '' }] });
});

test('even an upstream success cannot echo the server credential in public labels', async () => {
  const response = await handleApi(request('/api/stores', { city: '上海', keyword: '测试' }), env(), fake({ searchStores: async () => [{ storeCode: '123', beCode: '456', storeName: TOKEN }] }));
  assert.equal(response.status, 502);
  assert.equal((await response.text()).includes(TOKEN), false);
});
