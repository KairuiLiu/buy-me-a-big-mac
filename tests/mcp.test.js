import test from 'node:test';
import assert from 'node:assert/strict';
import { McdClient } from '../public/lib/mcp.js';

const config = { storeCode: '00123', beCode: '456', orderType: 1, beType: 1 };
const stores = [{ storeCode: '00123', storeName: '上海餐厅' }];
const menu = { categories: [{ name: '汉堡', codes: ['123'] }], products: [{ code: '123', name: '巨无霸', priceCents: 2650, originalPriceCents: 2900, image: '', discountType: null }] };
const quote = { amountCents: 5300, originalCents: 5800, discountCents: 500, items: [{ code: '123', quantity: 2, amountCents: 5300, originalCents: 5800 }] };
const json = (data, status = 200) => new Response(JSON.stringify(status < 400 ? { data } : { error: data }), { status, headers: { 'Content-Type': 'application/json' } });
function server(handle) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, ...options, body });
    if (handle) { const response = await handle(url, body, options); if (response) return response; }
    return json({ '/api/connect': { ok: true }, '/api/stores': stores, '/api/menu': menu, '/api/quote': quote }[url]);
  };
  return { fetchImpl, requests };
}

test('connects once without browser credentials and uses only business API paths', async () => {
  const api = server();
  const client = new McdClient(api);
  await Promise.all([client.connect(), client.connect()]);
  assert.deepEqual(await client.searchStores({ city: ' 上海 ', keyword: ' 人民广场 ' }), stores);
  assert.deepEqual(await client.getMenu(config), menu);
  assert.deepEqual(await client.calculate(config, [{ productCode: '123', quantity: 2 }]), quote);
  assert.deepEqual(api.requests.map(request => request.url), ['/api/connect', '/api/stores', '/api/menu', '/api/quote']);
  assert.deepEqual(api.requests[0].body, {});
  assert.deepEqual(api.requests[1].body, { city: '上海', keyword: '人民广场', beType: 1 });
  for (const request of api.requests) {
    assert.equal(request.method, 'POST');
    assert.deepEqual(request.headers, { 'Content-Type': 'application/json', Accept: 'application/json' });
    assert.equal(request.credentials, 'same-origin');
    assert.equal(request.redirect, 'error');
    assert.equal(request.cache, 'no-store');
    assert.equal(request.url.includes('mcp.mcd.cn'), false);
  }
  assert.equal(typeof client.callTool, 'undefined');
  assert.equal(typeof client.getMeal, 'undefined');
  client.disconnect();
});

test('sends only restaurant scene and product quantities, excluding recipient and arbitrary MCP arguments', async () => {
  const api = server();
  const client = new McdClient(api);
  const privateConfig = { ...config, repo: 'owner/project', afdianId: 'a'.repeat(32), storeName: '附近餐厅', tool: 'create-order', reservationDate: '2099-01-01' };
  await client.getMenu(privateConfig);
  await client.calculate(privateConfig, [{ productCode: '123', quantity: 2, couponId: 'personal-coupon', roundList: [], withOrder: {} }]);
  assert.deepEqual(api.requests[1].body, { config });
  assert.deepEqual(api.requests[2].body, { config, items: [{ productCode: '123', quantity: 2 }] });
  assert.equal(JSON.stringify(api.requests).includes('owner/project'), false);
  assert.equal(JSON.stringify(api.requests).includes('personal-coupon'), false);
  client.disconnect();
});

test('normalized prices remain integer cents rather than being converted a second time', async () => {
  const api = server();
  const client = new McdClient(api);
  assert.equal((await client.getMenu(config)).products[0].priceCents, 2650);
  assert.equal((await client.calculate(config, [{ productCode: '123', quantity: 2 }])).amountCents, 5300);
  client.disconnect();
});

test('uses location lookup without account history or sender metadata', async () => {
  const api = server();
  const client = new McdClient(api);
  await client.searchStores({ latitude: '31.2', longitude: 121.4, beType: '5', city: 'ignored', keyword: 'ignored', searchType: 1 });
  assert.deepEqual(api.requests.at(-1).body, { latitude: 31.2, longitude: 121.4, beType: 5 });
  client.disconnect();
});

test('rejects invalid scenes, coordinates and carts before any request', async () => {
  const api = server();
  const client = new McdClient(api);
  for (const values of [{ latitude: 300, longitude: 121 }, { latitude: '', longitude: 121 }, { latitude: null, longitude: 121 }]) await assert.rejects(client.searchStores(values), /有效的经纬度/);
  await assert.rejects(client.searchStores({ city: '上海' }), /请输入城市/);
  await assert.rejects(client.searchStores({ city: '上海', keyword: '人民广场', beType: 2 }), /到店自取/);
  await assert.rejects(client.getMenu({ storeCode: '' }), /选择餐厅/);
  await assert.rejects(client.getMenu({ ...config, orderType: 2 }), /只支持/);
  await assert.rejects(client.calculate(config, []), /1 至 30/);
  await assert.rejects(client.calculate(config, [{ productCode: '123', quantity: 21 }]), /数量无效/);
  await assert.rejects(client.calculate(config, [{ productCode: '123', quantity: 1.1 }]), /数量无效/);
  assert.equal(api.requests.length, 0);
  client.disconnect();
});

test('shows sanitized service errors and permits retry after failed connection', async () => {
  let attempts = 0;
  const api = server(url => url === '/api/connect' && ++attempts === 1 ? json('服务暂时不可用，请稍后重试', 503) : undefined);
  const client = new McdClient(api);
  await assert.rejects(client.connect(), /服务暂时不可用/);
  await client.connect();
  assert.equal(api.requests.length, 2);
  client.disconnect();
});

test('network and non-JSON HTTP errors do not reflect response bodies or fetch error details', async () => {
  for (const fetchImpl of [async () => { throw new Error('private-internal-details'); }, async () => new Response('private-internal-details', { status: 502 })]) {
    const client = new McdClient({ fetchImpl });
    await assert.rejects(client.connect(), error => { assert.equal(error.message.includes('private-internal-details'), false); assert.match(error.message, /重试/); return true; });
    client.disconnect();
  }
});

test('enforces timeout even if fetch ignores abort, and aborts the request', async () => {
  let signal;
  const client = new McdClient({ timeoutMs: 20, fetchImpl: async (_url, options) => { signal = options.signal; return new Promise(() => {}); } });
  await assert.rejects(client.connect(), /响应超时/);
  assert.equal(signal.aborted, true);
  client.disconnect();
});

test('disconnect aborts an in-flight menu and prevents future requests', async () => {
  let signal;
  let start;
  const started = new Promise(resolve => { start = resolve; });
  const api = server((url, _body, options) => {
    if (url !== '/api/menu') return;
    signal = options.signal; start(); return new Promise(() => {});
  });
  const client = new McdClient(api);
  const pending = assert.rejects(client.getMenu(config), /连接已关闭/);
  await started;
  client.disconnect();
  await pending;
  assert.equal(signal.aborted, true);
  await assert.rejects(client.connect(), /连接已关闭/);
  await assert.rejects(client.getMenu(config), /连接已关闭/);
});

test('a late connect response cannot resurrect a disconnected client', async () => {
  let resolveJson;
  let start;
  const started = new Promise(resolve => { start = resolve; });
  const client = new McdClient({ fetchImpl: async () => ({ ok: true, json: () => { start(); return new Promise(resolve => { resolveJson = resolve; }); } }) });
  const pending = assert.rejects(client.connect(), /连接已关闭/);
  await started;
  client.disconnect();
  resolveJson({ data: { ok: true } });
  await pending;
  await assert.rejects(client.connect(), /连接已关闭/);
});

test('timeout covers a response body that never completes', async () => {
  const client = new McdClient({ timeoutMs: 20, fetchImpl: async () => ({ ok: true, json: () => new Promise(() => {}) }) });
  await assert.rejects(client.connect(), /响应超时/);
  client.disconnect();
});

test('rejects malformed API envelopes and connect acknowledgements', async () => {
  for (const body of ['not json', '{}', '{"data":{"ok":false}}']) {
    const client = new McdClient({ fetchImpl: async () => new Response(body) });
    await assert.rejects(client.connect(), /无效 JSON|缺少查询结果|暂时无法连接/);
    client.disconnect();
  }
});

test('rejects malformed normalized menus and quotes before rendering or payment', async () => {
  const api = server(url => url === '/api/menu' ? json({ categories: [], products: null }) : url === '/api/quote' ? json({ ...quote, amountCents: 53.5 }) : undefined);
  const client = new McdClient(api);
  await assert.rejects(client.getMenu(config), /菜单格式/);
  await assert.rejects(client.calculate(config, [{ productCode: '123', quantity: 2 }]), /建议金额格式/);
  client.disconnect();
});
