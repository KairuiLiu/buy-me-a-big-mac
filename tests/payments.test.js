import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handlePayments, cleanupPayments } from '../worker/payments.js';

const ROOT = 'https://bigmac.example';
const CREATOR = 'a'.repeat(32);
const OTHER_CREATOR = 'b'.repeat(32);
const PAYER = 'c'.repeat(32);
const FIVE_MINUTES = 300_000;
const START = Date.UTC(2026, 9, 12, 12);
const migration = readFileSync(new URL('../migrations/0001_payments.sql', import.meta.url), 'utf8');
const orderNumberMigration = readFileSync(new URL('../migrations/0002_payment_order_number.sql', import.meta.url), 'utf8');
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// Run the actual migration and SQL on SQLite. D1 batch() is transactional: a
// later failure must undo earlier statements, including an inserted receipt.
class SqliteD1 {
  constructor(filename = ':memory:') {
    this.sqlite = new DatabaseSync(filename);
    this.sqlite.exec('PRAGMA foreign_keys = ON');
    this.failBatchAfter = null;
  }
  prepare(sql) {
    const db = this;
    const make = values => ({
      bind: (...next) => make(next),
      execute() {
        const statement = db.sqlite.prepare(sql);
        const results = statement.all(...values).map(row => ({ ...row }));
        const meta = db.sqlite.prepare('SELECT changes() AS changes, last_insert_rowid() AS last_row_id').get();
        return { success: true, results, meta: { ...meta } };
      },
      async first(column) {
        const row = db.sqlite.prepare(sql).get(...values);
        return row === undefined ? null : column === undefined ? { ...row } : row[column];
      },
      async all() { return this.execute(); },
      async run() { return this.execute(); },
    });
    return make([]);
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) {
        results.push(statement.execute());
        if (this.failBatchAfter === results.length) throw new Error('injected transactional failure');
      }
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
  close() { this.sqlite.close(); }
}

function request(path, input = {}, options = {}) {
  return new Request(new URL(path, ROOT), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ROOT, 'CF-Connecting-IP': '192.0.2.1', ...options.headers },
    body: options.body ?? JSON.stringify(input), duplex: 'half', signal: options.signal,
  });
}

function fixture(t, { persistent = false, applyOrderNumberMigration = true } = {}) {
  const directory = persistent ? mkdtempSync(join(tmpdir(), 'bigmac-payments-')) : null;
  const filename = directory ? join(directory, 'payments.sqlite') : ':memory:';
  const db = new SqliteD1(filename);
  db.sqlite.exec(migration);
  if (applyOrderNumberMigration) db.sqlite.exec(orderNumberMigration);
  const state = { now: START, db, env: { PAYMENTS_DB: db, PAYMENT_RATE_LIMITER: { limit: async () => ({ success: true }) } } };
  const options = () => ({ now: () => state.now, publicKey });
  state.handle = (req, overrides = {}) => handlePayments(req, state.env, { ...options(), ...overrides });
  state.call = async (path, input, extra) => {
    const response = await state.handle(request(path, input, extra));
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  state.register = async (afdianId = CREATOR) => {
    const response = await state.call('/api/payments/integrations', { afdianId });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body.data;
  };
  state.intent = async (integration, amountCents = 2550, afdianId = CREATOR) => {
    const response = await state.call('/api/payments/intents', { integrationId: integration.integrationId, afdianId, amountCents });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body.data;
  };
  state.status = async intent => {
    const response = await state.call('/api/payments/status', { intentId: intent.intentId, readToken: intent.readToken });
    assert.equal(response.status, 200);
    return response.body.data;
  };
  state.integrationStatus = async integration => {
    const response = await state.call('/api/payments/integrations/status', { integrationId: integration.integrationId, managementToken: integration.managementToken });
    assert.equal(response.status, 200);
    return response.body.data;
  };
  state.notify = (integration, payload) => state.call(integration.webhookUrl, payload, { headers: { Origin: '' } });
  state.reopen = () => {
    assert.ok(directory, 'persistence test needs a file-backed database');
    state.db.close();
    state.db = new SqliteD1(filename);
    state.env.PAYMENTS_DB = state.db;
  };
  t.after(() => {
    state.db.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });
  return state;
}

function callback(intent, overrides = {}) {
  const order = {
    out_trade_no: '202610121200001234567890123',
    user_id: PAYER,
    plan_id: '',
    month: 1,
    total_amount: '25.50',
    show_amount: '25.50',
    status: 2,
    custom_order_id: intent.intentId,
    remark: 'Private blessing not for storage',
    address_person: 'Private payer name',
    address_phone: '13800000000',
    address_address: 'Private payer address',
    ...overrides,
  };
  // Match the official signed string precisely. custom_order_id is deliberately
  // absent: a signed callback is a notification, not independent recipient proof.
  const message = order.out_trade_no + order.user_id + order.plan_id + order.total_amount;
  return { ec: 200, em: 'ok', data: { type: 'order', order, sign: sign('sha256', Buffer.from(message), privateKey).toString('base64') } };
}

// The developer dashboard displays this unsigned connection-test sample:
// https://afdian.com/dashboard/dev (dashboardDev.bbdd1b22.js, text1).
// It deliberately has no custom_order_id and must never confirm a payment.
function dashboardProbe() {
  return { ec: 200, em: 'ok', data: { type: 'order', order: {
    out_trade_no: '202106232138371083454010626',
    user_id: 'adf397fe8374811eaacee52540025c377',
    plan_id: 'a45353328af911eb973052540025c377',
    month: 1,
    total_amount: '5.00',
    show_amount: '5.00',
    status: 2,
    remark: '',
    redeem_id: '',
    product_type: 0,
    discount: '0.00',
    sku_detail: [],
    address_person: '',
    address_phone: '',
    address_address: '',
  } } };
}

test('registration returns independent private credentials once and stores only credential hashes', async t => {
  const f = fixture(t);
  const first = await f.register();
  const second = await f.register();
  assert.match(first.integrationId, /^[a-f0-9]{32}$/);
  assert.match(first.managementToken, /^[a-f0-9]{64}$/);
  const url = new URL(first.webhookUrl);
  assert.equal(url.origin, ROOT);
  assert.match(url.pathname, new RegExp(`^/api/payments/webhook/${first.integrationId}/[a-f0-9]{64}$`));
  assert.notEqual(first.managementToken, url.pathname.split('/').at(-1));
  assert.notEqual(first.integrationId, second.integrationId);
  assert.notEqual(first.managementToken, second.managementToken);
  assert.notEqual(first.webhookUrl, second.webhookUrl);
  const rows = JSON.stringify(f.db.sqlite.prepare('SELECT * FROM payment_integrations').all());
  assert.equal(rows.includes(first.managementToken), false);
  assert.equal(rows.includes(url.pathname.split('/').at(-1)), false);
  assert.deepEqual(await f.integrationStatus(first), { webhookReceived: false, lastWebhookAt: null });
});

test('pending intent is private, expires after five minutes and unknown capabilities reveal no status', async t => {
  const f = fixture(t);
  const integration = await f.register();
  const intent = await f.intent(integration);
  assert.match(intent.intentId, /^[a-f0-9]{32}$/);
  assert.match(intent.readToken, /^[a-f0-9]{64}$/);
  assert.equal(intent.expiresAt, START + FIVE_MINUTES);
  assert.deepEqual(await f.status(intent), { status: 'pending', expiresAt: intent.expiresAt });
  const wrongToken = await f.status({ ...intent, readToken: '0'.repeat(64) });
  const missing = await f.status({ intentId: '0'.repeat(32), readToken: intent.readToken });
  assert.deepEqual(wrongToken, { status: 'unknown' });
  assert.deepEqual(missing, wrongToken);
  const row = JSON.stringify(f.db.sqlite.prepare('SELECT * FROM payment_intents').get());
  assert.equal(row.includes(intent.readToken), false);
  f.now = intent.expiresAt;
  assert.deepEqual(await f.status(intent), { status: 'unknown' });
});

test('order-number migration preserves existing intents, credentials and hash-only replay records', async t => {
  const f = fixture(t, { applyOrderNumberMigration: false });
  const integration = await f.register();
  const notified = await f.intent(integration);
  const pending = await f.intent(integration);
  f.db.sqlite.prepare('UPDATE payment_intents SET notified_at = ? WHERE id = ?').run(START, notified.intentId);
  f.db.sqlite.prepare('INSERT INTO payment_order_receipts (order_hash, signed_message_hash, intent_id, received_at) VALUES (?, ?, ?, ?)')
    .run('0'.repeat(64), '1'.repeat(64), notified.intentId, START);
  const oldIntents = f.db.sqlite.prepare('SELECT * FROM payment_intents ORDER BY id').all();
  const oldIntegrations = f.db.sqlite.prepare('SELECT * FROM payment_integrations').all();
  const oldReplayRecords = f.db.sqlite.prepare('SELECT * FROM payment_order_receipts').all();

  f.db.sqlite.exec(orderNumberMigration);
  assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM payment_intents ORDER BY id').all().map(row => ({ ...row })),
    oldIntents.map(row => ({ ...row, afdian_order_no: null })));
  assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM payment_integrations').all(), oldIntegrations);
  assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM payment_order_receipts').all(), oldReplayRecords);
  assert.deepEqual(await f.status(notified), { status: 'notified', amountCents: 2550, receivedAt: START, expiresAt: notified.expiresAt });
  assert.deepEqual(await f.status(pending), { status: 'pending', expiresAt: pending.expiresAt });

  // An old Worker can still write its original columns after the additive migration.
  f.db.sqlite.prepare('UPDATE payment_intents SET notified_at = ?, expires_at = ? WHERE id = ?')
    .run(START, pending.expiresAt, pending.intentId);
  assert.deepEqual(await f.status(pending), { status: 'notified', amountCents: 2550, receivedAt: START, expiresAt: pending.expiresAt });
});

test('verified webhook publishes only the matching notification and no payer data', async t => {
  const f = fixture(t);
  const integration = await f.register();
  const intent = await f.intent(integration);
  f.now += 45_000;
  const payload = callback(intent);
  const result = await f.notify(integration, payload);
  assert.equal(result.status, 200);
  assert.equal(result.body.ec, 200);
  assert.deepEqual(await f.status(intent), { status: 'notified', receivedAt: f.now, amountCents: 2550, expiresAt: f.now + FIVE_MINUTES,
    afdianOrderNo: payload.data.order.out_trade_no });
  assert.deepEqual(await f.status({ ...intent, readToken: '0'.repeat(64) }), { status: 'unknown' });
  assert.deepEqual(await f.integrationStatus(integration), { webhookReceived: true, lastWebhookAt: f.now });
  const database = JSON.stringify(['payment_integrations', 'payment_intents', 'payment_order_receipts'].flatMap(table => f.db.sqlite.prepare(`SELECT * FROM ${table}`).all()));
  const response = JSON.stringify(await f.status(intent));
  assert.equal(f.db.sqlite.prepare('SELECT afdian_order_no FROM payment_intents WHERE id = ?').get(intent.intentId).afdian_order_no, payload.data.order.out_trade_no);
  assert.equal(JSON.stringify(f.db.sqlite.prepare('SELECT * FROM payment_order_receipts').all()).includes(payload.data.order.out_trade_no), false);
  for (const privateValue of [PAYER, payload.data.order.remark, payload.data.order.address_person, payload.data.order.address_phone, payload.data.order.address_address, payload.data.sign]) {
    assert.equal(database.includes(privateValue), false, `database leaked ${privateValue}`);
    assert.equal(response.includes(privateValue), false);
  }
});

test('verified order numbers remain exact strings with leading zeroes through status reads', async t => {
  const f = fixture(t);
  const integration = await f.register();
  for (const afdianOrderNo of ['0', '000202610121200001234567890123', '0'.repeat(63) + '1']) {
    const intent = await f.intent(integration);
    const result = await f.notify(integration, callback(intent, { out_trade_no: afdianOrderNo }));
    assert.equal(result.status, 200);
    assert.equal((await f.status(intent)).afdianOrderNo, afdianOrderNo);
  }
});

test('dashboard connection probes acknowledge only their integration without consuming an order or notifying a payment', async t => {
  const f = fixture(t);
  const integration = await f.register();
  const otherIntegration = await f.register(OTHER_CREATOR);
  const intent = await f.intent(integration, 500);
  const otherIntent = await f.intent(otherIntegration, 500, OTHER_CREATOR);
  const pendingRows = f.db.sqlite.prepare('SELECT * FROM payment_intents ORDER BY id').all();
  const otherIntegrationRow = f.db.sqlite.prepare('SELECT * FROM payment_integrations WHERE id = ?').get(otherIntegration.integrationId);

  for (const emptyCustomId of [false, false, true]) {
    f.now += 15_000;
    const payload = dashboardProbe();
    if (emptyCustomId) payload.data.order.custom_order_id = '';
    const result = await f.notify(integration, payload);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.ec, 200);
    assert.deepEqual(await f.integrationStatus(integration), { webhookReceived: true, lastWebhookAt: f.now });
    assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM payment_intents ORDER BY id').all(), pendingRows);
    assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM payment_integrations WHERE id = ?').get(otherIntegration.integrationId), otherIntegrationRow);
    assert.deepEqual(await f.status(intent), { status: 'pending', expiresAt: intent.expiresAt });
    assert.deepEqual(await f.status(otherIntent), { status: 'pending', expiresAt: otherIntent.expiresAt });
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 0);
  }

  f.now += 15_000;
  const paid = await f.notify(integration, callback(intent, { total_amount: '5.00', show_amount: '5.00' }));
  assert.equal(paid.status, 200);
  assert.equal(paid.body.ec, 200);
  assert.deepEqual(await f.status(intent), { status: 'notified', receivedAt: f.now, amountCents: 500, expiresAt: f.now + FIVE_MINUTES,
    afdianOrderNo: callback(intent).data.order.out_trade_no });
  assert.equal((await f.status(otherIntent)).status, 'pending');
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 1);
});

test('signed dashboard connection probes require valid RSA signatures and only update their connection timestamp', async t => {
  const f = fixture(t);
  const integration = await f.register();
  const otherIntegration = await f.register(OTHER_CREATOR);
  const intent = await f.intent(integration, 500);
  const otherIntent = await f.intent(otherIntegration, 500, OTHER_CREATOR);
  const pendingRows = f.db.sqlite.prepare('SELECT * FROM payment_intents ORDER BY id').all();
  const integrationRow = f.db.sqlite.prepare('SELECT * FROM payment_integrations WHERE id = ?').get(integration.integrationId);
  const otherIntegrationRow = f.db.sqlite.prepare('SELECT * FROM payment_integrations WHERE id = ?').get(otherIntegration.integrationId);
  const payload = dashboardProbe();

  // A real RSA signature over another order is still invalid for this sample.
  payload.data.sign = callback(intent).data.sign;
  assert.equal((await f.notify(integration, payload)).status, 403);
  assert.deepEqual(await f.integrationStatus(integration), { webhookReceived: false, lastWebhookAt: null });

  const order = payload.data.order;
  const message = order.out_trade_no + order.user_id + order.plan_id + order.total_amount;
  payload.data.sign = sign('sha256', Buffer.from(message), privateKey).toString('base64');
  for (const emptyCustomId of [false, false, true]) {
    f.now += 15_000;
    if (emptyCustomId) order.custom_order_id = '';
    const result = await f.notify(integration, payload);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.ec, 200);
    assert.deepEqual(await f.integrationStatus(integration), { webhookReceived: true, lastWebhookAt: f.now });
    assert.deepEqual({ ...f.db.sqlite.prepare('SELECT * FROM payment_integrations WHERE id = ?').get(integration.integrationId) }, { ...integrationRow, last_webhook_at: f.now });
    assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM payment_integrations WHERE id = ?').get(otherIntegration.integrationId), otherIntegrationRow);
    assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM payment_intents ORDER BY id').all(), pendingRows);
    assert.deepEqual(await f.status(intent), { status: 'pending', expiresAt: intent.expiresAt });
    assert.deepEqual(await f.status(otherIntent), { status: 'pending', expiresAt: otherIntent.expiresAt });
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 0);
  }
});

test('dashboard connection probes still require the private webhook URL', async t => {
  const f = fixture(t);
  const integration = await f.register();
  const intent = await f.intent(integration, 500);
  const wrongUrl = integration.webhookUrl.slice(0, -1) + (integration.webhookUrl.endsWith('0') ? '1' : '0');
  const failed = await f.notify({ ...integration, webhookUrl: wrongUrl }, dashboardProbe());
  assert.equal(failed.status, 404);
  assert.deepEqual(await f.integrationStatus(integration), { webhookReceived: false, lastWebhookAt: null });
  assert.deepEqual(await f.status(intent), { status: 'pending', expiresAt: intent.expiresAt });
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 0);
});

test('near-match dashboard probes and unsigned real orders cannot update connection or payment state', async t => {
  const f = fixture(t);
  const integration = await f.register();
  const intent = await f.intent(integration, 500);
  const pendingRows = f.db.sqlite.prepare('SELECT * FROM payment_intents').all();
  const cases = [
    ['order number', payload => { payload.data.order.out_trade_no += '1'; }],
    ['payer ID', payload => { payload.data.order.user_id = PAYER; }],
    ['plan ID', payload => { payload.data.order.plan_id = ''; }],
    ['amount', payload => { payload.data.order.total_amount = '5.01'; }],
    ['amount representation', payload => { payload.data.order.total_amount = '5.0'; }],
    ['status', payload => { payload.data.order.status = 1; }],
    ['string status', payload => { payload.data.order.status = '2'; }],
    ['outer ec', payload => { payload.ec = 400; }],
    ['missing outer ec', payload => { delete payload.ec; }],
    ['string outer ec', payload => { payload.ec = '200'; }],
    ['notification type', payload => { payload.data.type = 'test'; }],
    ['missing notification type', payload => { delete payload.data.type; }],
    ['empty signature', payload => { payload.data.sign = ''; }],
    ['null signature', payload => { payload.data.sign = null; }],
    ['invalid signature', payload => { payload.data.sign = 'not-valid-base64!'; }],
    ['base64 signature', payload => { payload.data.sign = Buffer.alloc(256).toString('base64'); }],
    ['live custom order ID', payload => { payload.data.order.custom_order_id = intent.intentId; }],
    ['unrecognized custom order ID', payload => { payload.data.order.custom_order_id = 'unknown'; }],
    ['null custom order ID', payload => { payload.data.order.custom_order_id = null; }],
  ];
  for (const [label, mutate] of cases) {
    const payload = dashboardProbe();
    mutate(payload);
    const result = await f.notify(integration, payload);
    assert.ok(result.status >= 400 && result.status < 500, `${label}: ${JSON.stringify(result)}`);
    assert.deepEqual(await f.integrationStatus(integration), { webhookReceived: false, lastWebhookAt: null }, label);
    assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM payment_intents').all(), pendingRows, label);
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 0, label);
  }
  const unsignedOrder = callback(intent, { total_amount: '5.00' });
  delete unsignedOrder.data.sign;
  const result = await f.notify(integration, unsignedOrder);
  assert.ok(result.status >= 400 && result.status < 500);
  assert.deepEqual(await f.integrationStatus(integration), { webhookReceived: false, lastWebhookAt: null });
  assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM payment_intents').all(), pendingRows);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 0);
});

test('signature and identifier diagnostics do not disclose payment data', async t => {
  const f = fixture(t);
  const integration = await f.register();
  const intent = await f.intent(integration);
  const probe = dashboardProbe();
  probe.data.sign = 'private-signature-value';
  const signedOrder = callback(intent, { user_id: PAYER + 'c' });

  for (const [payload, expectedStatus] of [[probe, 403], [signedOrder, 400]]) {
    const result = await f.notify(integration, payload);
    assert.equal(result.status, expectedStatus);
    assert.equal(result.body.ec, expectedStatus);
    if (expectedStatus === 403) {
      assert.equal(result.body.em, '付款通知签名无效');
    } else {
      assert.match(result.body.em, /^付款通知订单标识格式无效（不匹配的测试字段：/);
      assert.ok(result.body.em.includes('order.user_id'));
    }
    const response = JSON.stringify(result.body);
    const order = payload.data.order;
    for (const privateValue of [
      order.out_trade_no, order.user_id, order.custom_order_id, order.remark,
      order.address_person, order.address_phone, order.address_address, payload.data.sign,
      integration.webhookUrl, integration.managementToken, intent.readToken,
    ].filter(Boolean)) {
      assert.equal(response.includes(privateValue), false, 'diagnostics must not expose request or credential values');
    }
  }

  assert.deepEqual(await f.integrationStatus(integration), { webhookReceived: false, lastWebhookAt: null });
  assert.deepEqual(await f.status(intent), { status: 'pending', expiresAt: intent.expiresAt });
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 0);
});

test('dashboard probe persistence failures are not acknowledged as successful connections', async t => {
  const f = fixture(t);
  const integration = await f.register();
  const intent = await f.intent(integration, 500);
  f.db.sqlite.exec(`CREATE TRIGGER fail_probe_update BEFORE UPDATE OF last_webhook_at ON payment_integrations
    BEGIN SELECT RAISE(ABORT, 'injected connection persistence failure'); END`);
  const failed = await f.notify(integration, dashboardProbe());
  assert.ok(failed.status >= 500 && failed.status < 600, JSON.stringify(failed.body));
  assert.notEqual(failed.body.ec, 200);
  assert.deepEqual(await f.integrationStatus(integration), { webhookReceived: false, lastWebhookAt: null });
  assert.deepEqual(await f.status(intent), { status: 'pending', expiresAt: intent.expiresAt });
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 0);
});

test('private webhook URL and RSA signature are both required, including signed-field tampering', async t => {
  const f = fixture(t);
  const integration = await f.register();
  const intent = await f.intent(integration);
  const wrongUrl = integration.webhookUrl.slice(0, -64) + '0'.repeat(64);
  assert.equal((await f.notify({ ...integration, webhookUrl: wrongUrl }, callback(intent))).status, 404);
  for (const mutate of [
    payload => { payload.data.sign = Buffer.alloc(256).toString('base64'); },
    payload => { payload.data.sign = 'not-valid-base64!'; },
    payload => { payload.data.order.total_amount = '26.00'; },
    payload => { payload.data.order.out_trade_no += '1'; },
    payload => { payload.data.order.user_id = OTHER_CREATOR; },
    payload => { payload.data.order.plan_id = 'd'.repeat(32); },
  ]) {
    const payload = callback(intent);
    mutate(payload);
    assert.equal((await f.notify(integration, payload)).status, 403);
  }
  assert.equal((await f.status(intent)).status, 'pending');
  assert.equal(f.db.sqlite.prepare('SELECT afdian_order_no FROM payment_intents WHERE id = ?').get(intent.intentId).afdian_order_no, null);
  assert.deepEqual(await f.integrationStatus(integration), { webhookReceived: false, lastWebhookAt: null });
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 0);
});

test('amount, integration and pending lifetime must match before a notification becomes visible', async t => {
  const f = fixture(t);
  const integration = await f.register();
  const otherIntegration = await f.register(OTHER_CREATOR);
  const intent = await f.intent(integration);
  let sequence = 0;
  const distinctCallback = overrides => callback(intent, { out_trade_no: `20261012120000123456789012${sequence++}`, ...overrides });
  for (const amount of ['25.49', '25.51', '0.00']) {
    const result = await f.notify(integration, distinctCallback({ total_amount: amount }));
    assert.equal(result.status, 200);
    assert.equal(result.body.ec, 200);
    assert.equal((await f.status(intent)).status, 'pending');
  }
  assert.equal((await f.notify(otherIntegration, distinctCallback())).body.ec, 200);
  assert.equal((await f.status(intent)).status, 'pending');
  f.now = intent.expiresAt;
  assert.equal((await f.notify(integration, distinctCallback())).body.ec, 200);
  assert.deepEqual(await f.status(intent), { status: 'unknown' });
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 5);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts WHERE intent_id IS NOT NULL').get().n, 0);
  assert.equal(f.db.sqlite.prepare('SELECT afdian_order_no FROM payment_intents WHERE id = ?').get(intent.intentId).afdian_order_no, null);
});

test('retries do not extend the five-minute result lifetime, even before physical cleanup', async t => {
  const f = fixture(t);
  const integration = await f.register();
  const intent = await f.intent(integration);
  f.now += 60_000;
  assert.equal((await f.notify(integration, callback(intent))).body.ec, 200);
  const first = await f.status(intent);
  f.now = first.expiresAt - 1;
  assert.equal((await f.notify(integration, callback(intent))).body.ec, 200);
  assert.deepEqual(await f.status(intent), first);
  f.now = first.expiresAt;
  assert.equal((await f.notify(integration, callback(intent))).body.ec, 200);
  assert.deepEqual(await f.status(intent), { status: 'unknown' });
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_intents').get().n, 1);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 1);
});

test('one platform order cannot notify two intents, including altered unsigned custom_order_id', async t => {
  const f = fixture(t);
  const integration = await f.register();
  const first = await f.intent(integration);
  const second = await f.intent(integration);
  const payload = callback(first);
  assert.equal((await f.notify(integration, payload)).body.ec, 200);
  payload.data.order.custom_order_id = second.intentId;
  assert.equal((await f.notify(integration, payload)).body.ec, 200);
  assert.equal((await f.status(first)).status, 'notified');
  assert.equal((await f.status(second)).status, 'pending');
  assert.equal(Object.hasOwn(await f.status(second), 'afdianOrderNo'), false);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 1);
});

test('repartitioning the unseparated signed text cannot evade order replay protection', async t => {
  const f = fixture(t);
  const integration = await f.register();
  const first = await f.intent(integration);
  const second = await f.intent(integration);
  const payload = callback(first, { user_id: '1'.repeat(32), plan_id: '2'.repeat(32) });
  assert.equal((await f.notify(integration, payload)).body.ec, 200);
  // Both representations satisfy the documented field formats and produce the
  // identical signed concatenation, despite having different order numbers.
  payload.data.order.out_trade_no += payload.data.order.user_id;
  payload.data.order.user_id = payload.data.order.plan_id;
  payload.data.order.plan_id = '';
  payload.data.order.custom_order_id = second.intentId;
  assert.equal((await f.notify(integration, payload)).body.ec, 200);
  assert.equal((await f.status(first)).status, 'notified');
  assert.equal((await f.status(second)).status, 'pending');
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 1);
});

test('one intent records the first order only and a second order cannot reset its lifetime', async t => {
  const f = fixture(t);
  const integration = await f.register();
  const intent = await f.intent(integration);
  assert.equal((await f.notify(integration, callback(intent))).body.ec, 200);
  const first = await f.status(intent);
  f.now += 60_000;
  assert.equal((await f.notify(integration, callback(intent, { out_trade_no: '202610121201009999999999999' }))).body.ec, 200);
  assert.deepEqual(await f.status(intent), first);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 2);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts WHERE intent_id IS NOT NULL').get().n, 1);
});

test('authentic callbacks without a current successful match cannot be relabeled into a new success', async t => {
  const f = fixture(t);
  const integration = await f.register();
  const intent = await f.intent(integration);
  for (const [index, overrides] of [
    { custom_order_id: '' }, { custom_order_id: '0'.repeat(32) }, { status: 1 },
  ].entries()) {
    const payload = callback(intent, { out_trade_no: `20261012120000123456789012${index}`, ...overrides });
    assert.equal((await f.notify(integration, payload)).body.ec, 200);
    // These two fields are not covered by the official RSA signature.
    payload.data.order.custom_order_id = intent.intentId;
    payload.data.order.status = 2;
    assert.equal((await f.notify(integration, payload)).body.ec, 200);
    assert.equal((await f.status(intent)).status, 'pending');
  }
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 3);
});

test('payment status survives database reconnection and cleanup retains replay protection', async t => {
  const f = fixture(t, { persistent: true });
  const integration = await f.register();
  const expiredPending = await f.intent(integration);
  const notified = await f.intent(integration);
  f.now += 30_000;
  const payload = callback(notified);
  await f.notify(integration, payload);
  const expected = await f.status(notified);
  f.reopen();
  assert.deepEqual(await f.status(notified), expected);
  assert.equal((await f.integrationStatus(integration)).webhookReceived, true);
  f.now = expiredPending.expiresAt;
  assert.deepEqual(await cleanupPayments(f.env, f.now), { deleted: 1 });
  assert.deepEqual(await f.status(notified), expected);
  f.now = expected.expiresAt;
  assert.deepEqual(await cleanupPayments(f.env, f.now), { deleted: 1 });
  assert.deepEqual(await f.status(notified), { status: 'unknown' });
  assert.deepEqual(await f.status(expiredPending), { status: 'unknown' });
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_intents').get().n, 0);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_integrations').get().n, 1);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 1);
  assert.equal(JSON.stringify(['payment_integrations', 'payment_intents', 'payment_order_receipts']
    .flatMap(table => f.db.sqlite.prepare(`SELECT * FROM ${table}`).all())).includes(payload.data.order.out_trade_no), false);
  const fresh = await f.intent(integration);
  payload.data.order.custom_order_id = fresh.intentId;
  await f.notify(integration, payload);
  assert.equal((await f.status(fresh)).status, 'pending');
});

test('atomic D1 callback processing rolls back receipt and status together on database failure', async t => {
  const f = fixture(t);
  const integration = await f.register();
  const intent = await f.intent(integration);
  for (const failAfter of [1, 2]) {
    f.db.failBatchAfter = failAfter;
    const failed = await f.notify(integration, callback(intent));
    assert.ok(failed.status >= 500, 'the webhook must not acknowledge a failed transaction');
    assert.equal((await f.status(intent)).status, 'pending');
    assert.equal(f.db.sqlite.prepare('SELECT afdian_order_no FROM payment_intents WHERE id = ?').get(intent.intentId).afdian_order_no, null);
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 0);
  }
  f.db.failBatchAfter = null;
  assert.equal((await f.notify(integration, callback(intent))).body.ec, 200);
  assert.equal((await f.status(intent)).status, 'notified');
});

test('concurrent callbacks for the same order notify at most one intent', async t => {
  const f = fixture(t);
  const integration = await f.register();
  const intents = await Promise.all([f.intent(integration), f.intent(integration)]);
  const results = await Promise.all(intents.map(intent => f.notify(integration, callback(intent))));
  assert.deepEqual(results.map(result => result.status), [200, 200]);
  const statuses = await Promise.all(intents.map(intent => f.status(intent)));
  assert.equal(statuses.filter(status => status.status === 'notified').length, 1);
  assert.equal(statuses.filter(status => status.status === 'pending').length, 1);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 1);
});

test('management token cannot be replaced with a public integration ID or payer read token', async t => {
  const f = fixture(t);
  const integration = await f.register();
  const intent = await f.intent(integration);
  for (const managementToken of ['0'.repeat(64), intent.readToken]) {
    const result = await f.call('/api/payments/integrations/status', { integrationId: integration.integrationId, managementToken });
    assert.equal(result.status, 404);
    assert.equal(JSON.stringify(result.body).includes(integration.managementToken), false);
    assert.equal(JSON.stringify(result.body).includes(integration.webhookUrl), false);
  }
});

test('rejects invalid or extraneous payment parameters without inserting an intent', async t => {
  const f = fixture(t);
  const integration = await f.register();
  const valid = { integrationId: integration.integrationId, afdianId: CREATOR, amountCents: 2550 };
  for (const body of [
    { ...valid, amountCents: 0 }, { ...valid, amountCents: -1 },
    { ...valid, amountCents: 1.5 }, { ...valid, amountCents: '2550' },
    { ...valid, amountCents: 10_000_001 }, { ...valid, paid: true }, { ...valid, afdianOrderNo: '12345' },
    { ...valid, integrationId: '../other' }, { ...valid, afdianId: OTHER_CREATOR },
  ]) {
    const response = await f.call('/api/payments/intents', body);
    assert.ok(response.status >= 400 && response.status < 500, JSON.stringify(body));
  }
  for (const body of [{ afdianId: 'invalid' }, { afdianId: CREATOR, apiToken: 'never-accepted' }, []]) {
    const response = await f.call('/api/payments/integrations', body);
    assert.equal(response.status, 400);
  }
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_intents').get().n, 0);
});

test('browser endpoints reject cross-origin requests, malformed JSON, wrong media types and URL credentials', async t => {
  const f = fixture(t);
  const path = '/api/payments/integrations';
  const cases = [
    [request(path, { afdianId: CREATOR }, { headers: { Origin: 'https://evil.example' } }), 403],
    [request(path, { afdianId: CREATOR }, { headers: { 'Sec-Fetch-Site': 'cross-site' } }), 403],
    [request(path, { afdianId: CREATOR }, { headers: { 'Content-Type': 'text/plain' } }), 415],
    [request(path, {}, { body: '{' }), 400],
    [request(`${path}?token=never-in-url`, { afdianId: CREATOR }), 404],
    [request('/api/payments/unknown'), 404],
    [new Request(`${ROOT}${path}`, { headers: { 'CF-Connecting-IP': '192.0.2.1' } }), 405],
  ];
  for (const [input, expected] of cases) {
    const response = await f.handle(input);
    assert.equal(response.status, expected, input.url);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_integrations').get().n, 0);
});

test('streamed request limits are enforced independently of declared Content-Length', async t => {
  const f = fixture(t);
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(256 * 1024)); },
    cancel() { cancelled = true; },
  });
  const response = await f.handle(request('/api/payments/integrations', {}, { body, headers: { 'Content-Length': '1' } }));
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  const declared = await f.call('/api/payments/integrations', { afdianId: CREATOR }, { headers: { 'Content-Length': '262144' } });
  assert.equal(declared.status, 413);
});

test('a stalled or cancelled request terminates without persisting an integration', async t => {
  const f = fixture(t);
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const timeout = await f.handle(request('/api/payments/integrations', {}, { body }), { timeoutMs: 15 });
  assert.equal(timeout.status, 504);
  assert.equal(cancelled, true);
  const controller = new AbortController();
  controller.abort();
  const aborted = await f.handle(request('/api/payments/integrations', { afdianId: CREATOR }, { signal: controller.signal }));
  assert.equal(aborted.status, 499);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_integrations').get().n, 0);
});

test('production verifier ignores any public-key override supplied through environment bindings', async t => {
  const f = fixture(t);
  const integration = await f.register();
  const intent = await f.intent(integration);
  const response = await handlePayments(request(integration.webhookUrl, callback(intent)), {
    ...f.env, AFDIAN_PUBLIC_KEY: publicKey, publicKey,
  }, { now: () => f.now });
  assert.equal(response.status, 403);
  assert.equal((await f.status(intent)).status, 'pending');
});

test('missing bindings and rate limiter failures fail closed without exposing diagnostic text', async t => {
  const f = fixture(t);
  const input = () => request('/api/payments/integrations', { afdianId: CREATOR });
  for (const env of [{}, { PAYMENTS_DB: f.db }, { PAYMENT_RATE_LIMITER: f.env.PAYMENT_RATE_LIMITER }]) {
    assert.equal((await handlePayments(input(), env, { publicKey })).status, 503);
  }
  f.env.PAYMENT_RATE_LIMITER.limit = async () => { throw new Error('private-database-secret'); };
  const failed = await f.handle(input());
  assert.equal(failed.status, 503);
  assert.equal((await failed.text()).includes('private-database-secret'), false);
  f.env.PAYMENT_RATE_LIMITER.limit = async () => ({ success: false });
  const limited = await f.handle(input());
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '60');
});
