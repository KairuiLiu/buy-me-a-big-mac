import test from 'node:test';
import assert from 'node:assert/strict';
import { PaymentsClient } from '../src/lib/payments.js';

const ID = 'a'.repeat(32);
const UID = 'b'.repeat(32);
const TOKEN = 'c'.repeat(64);
const ORIGIN = 'https://example.com';
const NOW = 1_790_000_000_000;
const registration = { integrationId: ID, managementToken: TOKEN, webhookUrl: `${ORIGIN}/api/payments/webhook/${ID}/${'d'.repeat(64)}` };
const response = data => Response.json({ data });

test('payment calls use fixed same-origin POSTs, secret bodies and no caches', async () => {
  const calls = [];
  const replies = [registration, { webhookReceived: true, lastWebhookAt: NOW }, { intentId: ID, readToken: TOKEN, expiresAt: NOW + 300_000 }, { status: 'pending', expiresAt: NOW + 300_000 }];
  const client = new PaymentsClient({ origin: ORIGIN, fetchImpl: async (path, options) => { calls.push([path, options]); return response(replies.shift()); } });
  assert.deepEqual(await client.register(UID.toUpperCase()), registration);
  assert.deepEqual(await client.integrationStatus(ID, TOKEN), { webhookReceived: true, lastWebhookAt: NOW });
  assert.deepEqual(await client.createIntent({ integrationId: ID, afdianId: UID, amountCents: 2550 }), { intentId: ID, readToken: TOKEN, expiresAt: NOW + 300_000 });
  await client.status(ID, TOKEN);
  assert.deepEqual(calls.map(([path]) => path), ['/api/payments/integrations', '/api/payments/integrations/status', '/api/payments/intents', '/api/payments/status']);
  for (const [path, options] of calls) {
    assert.ok(!path.includes(TOKEN));
    assert.equal(options.method, 'POST');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.headers['Content-Type'], 'application/json');
  }
  assert.deepEqual(JSON.parse(calls[0][1].body), { afdianId: UID });
  assert.deepEqual(JSON.parse(calls[2][1].body), { integrationId: ID, afdianId: UID, amountCents: 2550 });
  assert.deepEqual(JSON.parse(calls[3][1].body), { intentId: ID, readToken: TOKEN });
});

test('registration rejects off-site, mismatched and noncanonical webhook addresses', async () => {
  for (const webhookUrl of [
    registration.webhookUrl.replace(ORIGIN, 'https://evil.test'),
    registration.webhookUrl.replace(`/webhook/${ID}`, `/webhook/${UID}`),
    `${registration.webhookUrl}?token=private`, `${registration.webhookUrl}#fragment`,
    registration.webhookUrl.replace('https://', 'https://user:pass@'),
    registration.webhookUrl.replace('https://', 'http://'),
    registration.webhookUrl.replace('/api/', '/a/../api/'),
    `/api/payments/webhook/${ID}/${TOKEN}`, `${registration.webhookUrl}/`,
  ]) {
    const client = new PaymentsClient({ origin: ORIGIN, fetchImpl: async () => response({ ...registration, webhookUrl }) });
    await assert.rejects(client.register(UID), /数据格式无效/);
  }
  const local = new PaymentsClient({ origin: 'http://127.0.0.1:4173', fetchImpl: async () => response({ ...registration, webhookUrl: registration.webhookUrl.replace(ORIGIN, 'http://127.0.0.1:4173') }) });
  assert.match((await local.register(UID)).webhookUrl, /^http:\/\/127\.0\.0\.1:4173/);
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
  for (const data of [{ ...registration, integrationId: ID.toUpperCase() }, { ...registration, managementToken: 'short' }]) {
    await assert.rejects(new PaymentsClient({ origin: ORIGIN, fetchImpl: async () => response(data) }).register(UID), /数据格式无效/);
  }
});

test('invalid outgoing credentials and money do not reach the network', async () => {
  let calls = 0;
  const client = new PaymentsClient({ fetchImpl: async () => { calls++; return response({}); } });
  for (const amountCents of [0, -1, 0.5, '2550', true, Infinity, 3_000_001]) {
    await assert.rejects(client.createIntent({ integrationId: ID, afdianId: UID, amountCents }));
  }
  await assert.rejects(client.status(ID, 'wrong'));
  await assert.rejects(client.integrationStatus('../private', TOKEN));
  await assert.rejects(client.register('not a UID'));
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
