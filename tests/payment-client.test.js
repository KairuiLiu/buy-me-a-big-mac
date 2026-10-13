import test from 'node:test';
import assert from 'node:assert/strict';
import { PaymentsClient } from '../src/lib/payments.js';

const ID = 'a'.repeat(32);
const UID = 'b'.repeat(32);
const TOKEN = 'c'.repeat(64);
const NOW = 1_790_000_000_000;
const response = data => Response.json({ data });

test('payment calls use fixed same-origin POSTs, secret bodies and no caches', async () => {
  const calls = [];
  const replies = [{ intentId: ID, readToken: TOKEN, expiresAt: NOW + 300_000 }, { status: 'pending', expiresAt: NOW + 300_000 }];
  const client = new PaymentsClient({ fetchImpl: async (path, options) => { calls.push([path, options]); return response(replies.shift()); } });
  assert.deepEqual(await client.createIntent({ afdianId: UID, amountCents: 2550 }), { intentId: ID, readToken: TOKEN, expiresAt: NOW + 300_000 });
  await client.status(ID, TOKEN);
  assert.deepEqual(calls.map(([path]) => path), ['/api/payments/intents', '/api/payments/status']);
  for (const [path, options] of calls) {
    assert.ok(!path.includes(TOKEN));
    assert.equal(options.method, 'POST');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.headers['Content-Type'], 'application/json');
  }
  assert.deepEqual(JSON.parse(calls[0][1].body), { afdianId: UID, amountCents: 2550 });
  assert.deepEqual(JSON.parse(calls[1][1].body), { intentId: ID, readToken: TOKEN });
});

test('universal notifications create an intent without registering an integration', async () => {
  const calls = [];
  const result = { intentId: ID, readToken: TOKEN, expiresAt: NOW + 300_000 };
  const client = new PaymentsClient({ fetchImpl: async (path, options) => {
    calls.push([path, JSON.parse(options.body)]);
    return response(result);
  } });
  assert.deepEqual(await client.createIntent({ afdianId: UID.toUpperCase(), amountCents: 2550 }), result);
  assert.deepEqual(calls, [['/api/payments/intents', { afdianId: UID, amountCents: 2550 }]]);
  for (const integrationId of [null, '', 'invalid']) {
    await assert.rejects(client.createIntent({ integrationId, afdianId: UID, amountCents: 2550 }));
  }
  assert.equal(calls.length, 1);
});

test('credentials, status timestamps and amounts are validated and extra response data discarded', async () => {
  const good = { status: 'notified', amountCents: 2550, receivedAt: NOW, expiresAt: NOW + 300_000 };
  const invalidReplies = [
    { status: 'paid' }, { status: 'pending', expiresAt: null }, { status: 'pending', expiresAt: '300000' },
    { status: 'pending', expiresAt: 0 }, { ...good, amountCents: 0 }, { ...good, amountCents: '2550' },
    { ...good, amountCents: 3_000_001 }, { ...good, receivedAt: NOW + 300_001 }, { ...good, receivedAt: -1 },
  ];
  for (const data of invalidReplies) {
    const client = new PaymentsClient({ fetchImpl: async () => response(data) });
    await assert.rejects(client.status(ID, TOKEN), /数据格式无效/);
  }
  const client = new PaymentsClient({ fetchImpl: async () => response({ ...good, payer: 'PRIVATE', address: 'PRIVATE' }) });
  assert.deepEqual(await client.status(ID, TOKEN), good);
  const unknown = new PaymentsClient({ fetchImpl: async () => response({ status: 'unknown', amountCents: 2550 }) });
  assert.deepEqual(await unknown.status(ID, TOKEN), { status: 'unknown' });

});

test('notified status preserves optional order numbers exactly and supports historical responses', async () => {
  const notified = { status: 'notified', amountCents: 2550, receivedAt: NOW, expiresAt: NOW + 300_000 };
  for (const afdianOrderNo of ['0', '000012345678901234567890', '9'.repeat(64)]) {
    const data = { ...notified, afdianOrderNo };
    const client = new PaymentsClient({ fetchImpl: async () => response({ ...data, payer: 'PRIVATE', managementToken: TOKEN }) });
    assert.deepEqual(await client.status(ID, TOKEN), data);
  }
  const legacy = new PaymentsClient({ fetchImpl: async () => response(notified) });
  const saved = await legacy.status(ID, TOKEN);
  assert.deepEqual(saved, notified);
  assert.equal(Object.hasOwn(saved, 'afdianOrderNo'), false);

  for (const data of [{ status: 'pending', expiresAt: NOW + 300_000 }, { status: 'unknown' }]) {
    const client = new PaymentsClient({ fetchImpl: async () => response({ ...data, afdianOrderNo: '000123' }) });
    assert.deepEqual(await client.status(ID, TOKEN), data);
  }
});

test('status rejects present order numbers that are not one to 64 ASCII digits', async () => {
  const invalidOrderNos = [undefined, null, 123, true, '', '1'.repeat(65), ' 123', '123 ', '123\n', '123\r', '12\u00003', '１２３', '12.3', '1e3', '-123', [], {}];
  for (const status of ['notified', 'pending', 'unknown']) {
    for (const afdianOrderNo of invalidOrderNos) {
      const data = { status, amountCents: 2550, receivedAt: NOW, expiresAt: NOW + 300_000, afdianOrderNo };
      const client = new PaymentsClient({ fetchImpl: async () => ({ ok: true, json: async () => ({ data }) }) });
      await assert.rejects(client.status(ID, TOKEN), /数据格式无效/);
    }
  }
});

test('invalid outgoing credentials and money do not reach the network', async () => {
  let calls = 0;
  const client = new PaymentsClient({ fetchImpl: async () => { calls++; return response({}); } });
  for (const amountCents of [0, -1, 0.5, '2550', true, Infinity, 3_000_001]) {
    await assert.rejects(client.createIntent({ afdianId: UID, amountCents }));
  }
  await assert.rejects(client.status(ID, 'wrong'));
  await assert.rejects(client.createIntent({ afdianId: 'not a UID', amountCents: 2550 }));
  assert.equal(calls, 0);
});

test('raw backend, JSON and fetch errors never become user-visible errors', async () => {
  for (const fetchImpl of [
    async () => Response.json({ error: `SECRET ${TOKEN}` }, { status: 503 }),
    async () => { throw new Error(`SECRET ${TOKEN}`); },
    async () => ({ ok: true, json: async () => { throw new Error(`SECRET ${TOKEN}`); } }),
    async () => response(null),
  ]) {
    const client = new PaymentsClient({ fetchImpl });
    await assert.rejects(client.status(ID, TOKEN), error => !error.message.includes(TOKEN) && !error.message.includes('SECRET'));
  }
  await assert.rejects(new PaymentsClient({ fetchImpl: async () => new Response('', { status: 429 }) }).status(ID, TOKEN), /过于频繁/);
});

test('timeout bounds both hanging fetch and hanging JSON parsing', async () => {
  for (const fetchImpl of [() => new Promise(() => {}), async () => ({ ok: true, json: () => new Promise(() => {}) })]) {
    await assert.rejects(new PaymentsClient({ fetchImpl, timeoutMs: 10 }).status(ID, TOKEN), /响应超时/);
  }
});

test('abort and disconnect reject inflight calls even when fetch ignores cancellation', async () => {
  const controller = new AbortController();
  const client = new PaymentsClient({ fetchImpl: () => new Promise(() => {}) });
  const query = client.status(ID, TOKEN, { signal: controller.signal });
  controller.abort();
  await assert.rejects(query, /已取消/);
  await assert.rejects(client.status(ID, TOKEN, { signal: controller.signal }), /已取消/);
  const first = client.status(ID, TOKEN);
  const second = client.status(ID, TOKEN);
  client.disconnect();
  await assert.rejects(first, /已取消/);
  await assert.rejects(second, /已取消/);
  await assert.rejects(client.status(ID, TOKEN), /已取消/);
});

test('each status check goes to the server, including after a previous notification', async () => {
  let calls = 0;
  const client = new PaymentsClient({ fetchImpl: async () => response(++calls === 1
    ? { status: 'notified', amountCents: 2550, receivedAt: NOW, expiresAt: NOW + 300_000 }
    : { status: 'unknown' }) });
  assert.equal((await client.status(ID, TOKEN)).status, 'notified');
  assert.equal((await client.status(ID, TOKEN)).status, 'unknown');
  assert.equal(calls, 2);
});
