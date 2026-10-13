import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
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
const universalMigration = readFileSync(new URL('../migrations/0003_universal_webhook.sql', import.meta.url), 'utf8');
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

function fixture(t, { persistent = false, applyUniversalMigration = true } = {}) {
  const directory = persistent ? mkdtempSync(join(tmpdir(), 'bigmac-payments-')) : null;
  const filename = directory ? join(directory, 'payments.sqlite') : ':memory:';
  const db = new SqliteD1(filename);
  db.sqlite.exec(migration);
  db.sqlite.exec(orderNumberMigration);
  if (applyUniversalMigration) db.sqlite.exec(universalMigration);
  const state = { now: START, db, env: { PAYMENTS_DB: db, PAYMENT_RATE_LIMITER: { limit: async () => ({ success: true }) } } };
  const options = () => ({ now: () => state.now, publicKey });
  state.handle = (req, overrides = {}) => handlePayments(req, state.env, { ...options(), ...overrides });
  state.call = async (path, input, extra) => {
    const response = await state.handle(request(path, input, extra));
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  state.intent = async (amountCents = 2550, afdianId = CREATOR) => {
    const response = await state.call('/api/payments/intents', { afdianId, amountCents });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body.data;
  };
  state.status = async intent => {
    const response = await state.call('/api/payments/status', { intentId: intent.intentId, readToken: intent.readToken });
    assert.equal(response.status, 200);
    return response.body.data;
  };
  state.notify = payload => state.call('/api/payments/webhook', payload, { headers: { Origin: '' } });
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

test('pending intent is private, expires after five minutes and unknown capabilities reveal no status', async t => {
  const f = fixture(t);
  const intent = await f.intent();
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

test('universal migration preserves payment data and replay records while removing the integration schema', async t => {
  const f = fixture(t, { applyUniversalMigration: false });
  const integrationIds = ['d'.repeat(32), 'e'.repeat(32)];
  for (const [index, creator] of [CREATOR, OTHER_CREATOR].entries()) {
    f.db.sqlite.prepare(`INSERT INTO payment_integrations
      (id, afdian_id, webhook_secret_hash, management_token_hash, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(integrationIds[index], creator, '0'.repeat(64), '1'.repeat(64), START);
  }
  const seeded = integrationIds.map((integrationId, index) => {
    const intentId = randomBytes(16).toString('hex');
    const readToken = randomBytes(32).toString('hex');
    const expiresAt = START + FIVE_MINUTES;
    f.db.sqlite.prepare(`INSERT INTO payment_intents
      (id, integration_id, amount_cents, read_token_hash, created_at, notified_at, expires_at, afdian_order_no)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(intentId, integrationId, 2550, createHash('sha256').update(readToken).digest('hex'), START,
        index ? START : null, expiresAt, index ? '000123' : null);
    return { intentId, readToken, expiresAt };
  });
  f.db.sqlite.prepare('INSERT INTO payment_order_receipts (order_hash, signed_message_hash, intent_id, received_at) VALUES (?, ?, ?, ?)')
    .run('0'.repeat(64), '1'.repeat(64), seeded[1].intentId, START);
  const oldIntents = f.db.sqlite.prepare('SELECT * FROM payment_intents ORDER BY id').all();
  const oldReceipts = f.db.sqlite.prepare('SELECT * FROM payment_order_receipts').all();

  f.db.sqlite.exec(universalMigration);
  assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM payment_intents ORDER BY id').all().map(row => ({ ...row })),
    oldIntents.map(({ integration_id, ...row }) => ({ ...row, afdian_id: integration_id === integrationIds[0] ? CREATOR : OTHER_CREATOR })));
  assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM payment_order_receipts').all(), oldReceipts);
  assert.deepEqual(f.db.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'payment_integrations'").get().n, 0);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'payment_intents_expiry'").get().n, 1);
  const columns = f.db.sqlite.prepare('PRAGMA table_info(payment_intents)').all();
  assert.equal(columns.some(column => column.name === 'integration_id'), false);
  assert.equal(columns.find(column => column.name === 'afdian_id').notnull, 1);
  assert.deepEqual(await f.status(seeded[1]), { status: 'notified', amountCents: 2550, receivedAt: START,
    expiresAt: seeded[1].expiresAt, afdianOrderNo: '000123' });
  assert.equal((await f.notify(callback(seeded[0]))).status, 200);
  assert.equal((await f.status(seeded[0])).status, 'notified');
  const modern = await f.intent();
  assert.equal(f.db.sqlite.prepare('SELECT afdian_id FROM payment_intents WHERE id = ?').get(modern.intentId).afdian_id, CREATOR);
});

test('removed integration APIs and private webhook routes are unavailable', async t => {
  const f = fixture(t);
  for (const path of [
    '/api/payments/integrations', '/api/payments/integrations/status', '/api/payments/integrations/restore',
    `/api/payments/webhook/${'0'.repeat(32)}/${'1'.repeat(64)}`,
  ]) assert.equal((await f.call(path, {})).status, 404);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_intents').get().n, 0);
});

test('one universal webhook correlates separate projects and creators without registering integrations', async t => {
  const f = fixture(t);
  const first = await f.intent();
  const second = await f.intent();
  const otherCreator = await f.intent(2550, OTHER_CREATOR.toUpperCase());
  const intents = [first, second, otherCreator];
  assert.deepEqual(f.db.sqlite.prepare('SELECT afdian_id FROM payment_intents ORDER BY rowid').all().map(row => ({ ...row })),
    [{ afdian_id: CREATOR }, { afdian_id: CREATOR }, { afdian_id: OTHER_CREATOR }]);

  for (let i = 0; i < intents.length; i++) {
    const result = await f.notify(callback(intents[i], { out_trade_no: `20261013000${i}` }));
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ec: 200 });
    for (let j = 0; j < intents.length; j++) assert.equal((await f.status(intents[j])).status, j <= i ? 'notified' : 'pending');
    assert.deepEqual(await f.status({ ...intents[i], readToken: '0'.repeat(64) }), { status: 'unknown' });
  }
});

test('universal dashboard probes acknowledge connectivity without persisting diagnostic state or confirming payments', async t => {
  const f = fixture(t);
  const intent = await f.intent(500);
  const intents = f.db.sqlite.prepare('SELECT * FROM payment_intents').all();
  const signedProbe = dashboardProbe();
  const order = signedProbe.data.order;
  signedProbe.data.sign = sign('sha256', Buffer.from(order.out_trade_no + order.user_id + order.plan_id + order.total_amount), privateKey).toString('base64');
  for (const probe of [dashboardProbe(), signedProbe]) {
    const response = await f.notify(probe);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ec: 200 });
  }
  assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM payment_intents').all(), intents);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS count FROM payment_order_receipts').get().count, 0);
  assert.equal((await f.status(intent)).status, 'pending');
  signedProbe.data.sign = 'AAAA';
  assert.equal((await f.notify(signedProbe)).status, 403);
  const forbiddenProbe = dashboardProbe();
  forbiddenProbe.data.order.custom_order_id = intent.intentId;
  assert.equal((await f.notify(forbiddenProbe)).status, 400);
});

test('universal notifications require RSA signature, matching amount, success status and an unexpired reference', async t => {
  const cases = [
    { name: 'invalid signature', mutate: payload => { payload.data.sign = 'AAAA'; }, http: 403 },
    { name: 'missing signature', mutate: payload => { delete payload.data.sign; }, http: 400 },
    { name: 'signed amount changed', mutate: payload => { payload.data.order.total_amount = '25.51'; }, http: 403 },
    { name: 'other signed amount', overrides: { total_amount: '25.51' }, http: 200 },
    { name: 'not successful', overrides: { status: 1 }, http: 200 },
    { name: 'unknown reference', overrides: { custom_order_id: '0'.repeat(32) }, http: 200 },
    { name: 'missing reference', mutate: payload => { delete payload.data.order.custom_order_id; }, http: 200 },
    { name: 'expired intent', elapsed: FIVE_MINUTES, http: 200 },
  ];
  for (const entry of cases) {
    const f = fixture(t);
    const intent = await f.intent();
    const payload = callback(intent, entry.overrides);
    entry.mutate?.(payload);
    f.now += entry.elapsed ?? 0;
    const response = await f.notify(payload);
    assert.equal(response.status, entry.http, entry.name);
    assert.equal(f.db.sqlite.prepare('SELECT notified_at FROM payment_intents WHERE id = ?').get(intent.intentId).notified_at, null, entry.name);
    assert.equal((await f.status(intent)).status, entry.elapsed ? 'unknown' : 'pending', entry.name);
  }
});

test('universal notifications keep global replay protection and do not renew expiry on retries', async t => {
  const f = fixture(t);
  const first = await f.intent();
  const second = await f.intent(2550, OTHER_CREATOR);
  const third = await f.intent();
  const payload = callback(first);
  f.now += 20_000;
  assert.equal((await f.notify(payload)).status, 200);
  const originalStatus = await f.status(first);
  f.now += 30_000;
  assert.equal((await f.notify(payload)).status, 200);
  payload.data.order.custom_order_id = second.intentId;
  assert.equal((await f.notify(payload)).status, 200);
  payload.data.order.custom_order_id = third.intentId;
  assert.equal((await f.notify(payload)).status, 200);
  assert.deepEqual(await f.status(first), originalStatus);
  assert.equal((await f.status(second)).status, 'pending');
  assert.equal((await f.status(third)).status, 'pending');
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS count FROM payment_order_receipts').get().count, 1);
  f.now = originalStatus.expiresAt;
  assert.deepEqual(await f.status(first), { status: 'unknown' });
});

test('universal intent creation still validates creator and amount, and rejects obsolete integration fields', async t => {
  const f = fixture(t);
  for (const input of [
    { amountCents: 2550 }, { afdianId: 'bad', amountCents: 2550 },
    { afdianId: CREATOR, amountCents: 0 }, { afdianId: CREATOR, amountCents: 25.5 },
    { afdianId: CREATOR, amountCents: 2550, integrationId: null },
    { afdianId: CREATOR, amountCents: 2550, integrationId: '0'.repeat(32) },
    { afdianId: CREATOR, amountCents: 10_000_001 },
    { afdianId: CREATOR, amountCents: '2550' },
    { afdianId: CREATOR, amountCents: 2550, paid: true },
    { afdianId: CREATOR, amountCents: 2550, afdianOrderNo: '12345' },
    { afdianId: CREATOR, amountCents: 2550, apiToken: 'never-accepted' },
    { afdianId: CREATOR, amountCents: 2550, webhookSecret: '0'.repeat(64) },
  ]) {
    assert.equal((await f.call('/api/payments/intents', input)).status, 400);
  }
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS count FROM payment_intents').get().count, 0);
});

test('verified webhook publishes only the matching notification and no payer data', async t => {
  const f = fixture(t);
  const intent = await f.intent();
  f.now += 45_000;
  const payload = callback(intent);
  const result = await f.notify(payload);
  assert.equal(result.status, 200);
  assert.equal(result.body.ec, 200);
  assert.deepEqual(await f.status(intent), { status: 'notified', receivedAt: f.now, amountCents: 2550, expiresAt: f.now + FIVE_MINUTES,
    afdianOrderNo: payload.data.order.out_trade_no });
  assert.deepEqual(await f.status({ ...intent, readToken: '0'.repeat(64) }), { status: 'unknown' });
  const database = JSON.stringify(['payment_intents', 'payment_order_receipts'].flatMap(table => f.db.sqlite.prepare(`SELECT * FROM ${table}`).all()));
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
  for (const afdianOrderNo of ['0', '000202610121200001234567890123', '0'.repeat(63) + '1']) {
    const intent = await f.intent();
    const result = await f.notify(callback(intent, { out_trade_no: afdianOrderNo }));
    assert.equal(result.status, 200);
    assert.equal((await f.status(intent)).afdianOrderNo, afdianOrderNo);
  }
});

test('near-match dashboard probes and unsigned real orders cannot notify payments', async t => {
  const f = fixture(t);
  const intent = await f.intent(500);
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
    const result = await f.notify(payload);
    assert.ok(result.status >= 400 && result.status < 500, `${label}: ${JSON.stringify(result)}`);
    assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM payment_intents').all(), pendingRows, label);
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 0, label);
  }
  const unsignedOrder = callback(intent, { total_amount: '5.00' });
  delete unsignedOrder.data.sign;
  const result = await f.notify(unsignedOrder);
  assert.ok(result.status >= 400 && result.status < 500);
  assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM payment_intents').all(), pendingRows);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 0);
});

test('signature and identifier diagnostics do not disclose payment data', async t => {
  const f = fixture(t);
  const intent = await f.intent();
  const probe = dashboardProbe();
  probe.data.sign = 'private-signature-value';
  const signedOrder = callback(intent, { user_id: PAYER + 'c' });

  for (const [payload, expectedStatus] of [[probe, 403], [signedOrder, 400]]) {
    const result = await f.notify(payload);
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
      intent.readToken,
    ].filter(Boolean)) {
      assert.equal(response.includes(privateValue), false, 'diagnostics must not expose request or credential values');
    }
  }

  assert.deepEqual(await f.status(intent), { status: 'pending', expiresAt: intent.expiresAt });
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 0);
});

test('RSA signatures reject signed-field tampering', async t => {
  const f = fixture(t);
  const intent = await f.intent();
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
    assert.equal((await f.notify(payload)).status, 403);
  }
  assert.equal((await f.status(intent)).status, 'pending');
  assert.equal(f.db.sqlite.prepare('SELECT afdian_order_no FROM payment_intents WHERE id = ?').get(intent.intentId).afdian_order_no, null);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 0);
});

test('retries do not extend the five-minute result lifetime, even before physical cleanup', async t => {
  const f = fixture(t);
  const intent = await f.intent();
  f.now += 60_000;
  assert.equal((await f.notify(callback(intent))).body.ec, 200);
  const first = await f.status(intent);
  f.now = first.expiresAt - 1;
  assert.equal((await f.notify(callback(intent))).body.ec, 200);
  assert.deepEqual(await f.status(intent), first);
  f.now = first.expiresAt;
  assert.equal((await f.notify(callback(intent))).body.ec, 200);
  assert.deepEqual(await f.status(intent), { status: 'unknown' });
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_intents').get().n, 1);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 1);
});

test('repartitioning the unseparated signed text cannot evade order replay protection', async t => {
  const f = fixture(t);
  const first = await f.intent();
  const second = await f.intent();
  const payload = callback(first, { user_id: '1'.repeat(32), plan_id: '2'.repeat(32) });
  assert.equal((await f.notify(payload)).body.ec, 200);
  // Both representations satisfy the documented field formats and produce the
  // identical signed concatenation, despite having different order numbers.
  payload.data.order.out_trade_no += payload.data.order.user_id;
  payload.data.order.user_id = payload.data.order.plan_id;
  payload.data.order.plan_id = '';
  payload.data.order.custom_order_id = second.intentId;
  assert.equal((await f.notify(payload)).body.ec, 200);
  assert.equal((await f.status(first)).status, 'notified');
  assert.equal((await f.status(second)).status, 'pending');
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 1);
});

test('one intent records the first order only and a second order cannot reset its lifetime', async t => {
  const f = fixture(t);
  const intent = await f.intent();
  assert.equal((await f.notify(callback(intent))).body.ec, 200);
  const first = await f.status(intent);
  f.now += 60_000;
  assert.equal((await f.notify(callback(intent, { out_trade_no: '202610121201009999999999999' }))).body.ec, 200);
  assert.deepEqual(await f.status(intent), first);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 2);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts WHERE intent_id IS NOT NULL').get().n, 1);
});

test('authentic callbacks without a current successful match cannot be relabeled into a new success', async t => {
  const f = fixture(t);
  const intent = await f.intent();
  for (const [index, overrides] of [
    { custom_order_id: '' }, { custom_order_id: '0'.repeat(32) }, { status: 1 },
  ].entries()) {
    const payload = callback(intent, { out_trade_no: `20261012120000123456789012${index}`, ...overrides });
    assert.equal((await f.notify(payload)).body.ec, 200);
    // These two fields are not covered by the official RSA signature.
    payload.data.order.custom_order_id = intent.intentId;
    payload.data.order.status = 2;
    assert.equal((await f.notify(payload)).body.ec, 200);
    assert.equal((await f.status(intent)).status, 'pending');
  }
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 3);
});

test('payment status survives database reconnection and cleanup retains replay protection', async t => {
  const f = fixture(t, { persistent: true });
  const expiredPending = await f.intent();
  const notified = await f.intent();
  f.now += 30_000;
  const payload = callback(notified);
  await f.notify(payload);
  const expected = await f.status(notified);
  f.reopen();
  assert.deepEqual(await f.status(notified), expected);
  f.now = expiredPending.expiresAt;
  assert.deepEqual(await cleanupPayments(f.env, f.now), { deleted: 1 });
  assert.deepEqual(await f.status(notified), expected);
  f.now = expected.expiresAt;
  assert.deepEqual(await cleanupPayments(f.env, f.now), { deleted: 1 });
  assert.deepEqual(await f.status(notified), { status: 'unknown' });
  assert.deepEqual(await f.status(expiredPending), { status: 'unknown' });
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_intents').get().n, 0);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 1);
  assert.equal(JSON.stringify(['payment_intents', 'payment_order_receipts']
    .flatMap(table => f.db.sqlite.prepare(`SELECT * FROM ${table}`).all())).includes(payload.data.order.out_trade_no), false);
  const fresh = await f.intent();
  payload.data.order.custom_order_id = fresh.intentId;
  await f.notify(payload);
  assert.equal((await f.status(fresh)).status, 'pending');
});

test('atomic D1 callback processing rolls back receipt and status together on database failure', async t => {
  const f = fixture(t);
  const intent = await f.intent();
  for (const failAfter of [1, 2]) {
    f.db.failBatchAfter = failAfter;
    const failed = await f.notify(callback(intent));
    assert.ok(failed.status >= 500, 'the webhook must not acknowledge a failed transaction');
    assert.equal((await f.status(intent)).status, 'pending');
    assert.equal(f.db.sqlite.prepare('SELECT afdian_order_no FROM payment_intents WHERE id = ?').get(intent.intentId).afdian_order_no, null);
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 0);
  }
  f.db.failBatchAfter = null;
  assert.equal((await f.notify(callback(intent))).body.ec, 200);
  assert.equal((await f.status(intent)).status, 'notified');
});

test('concurrent callbacks for the same order notify at most one intent', async t => {
  const f = fixture(t);
  const intents = await Promise.all([f.intent(), f.intent()]);
  const results = await Promise.all(intents.map(intent => f.notify(callback(intent))));
  assert.deepEqual(results.map(result => result.status), [200, 200]);
  const statuses = await Promise.all(intents.map(intent => f.status(intent)));
  assert.equal(statuses.filter(status => status.status === 'notified').length, 1);
  assert.equal(statuses.filter(status => status.status === 'pending').length, 1);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_order_receipts').get().n, 1);
});

test('browser endpoints reject cross-origin requests, malformed JSON, wrong media types and URL credentials', async t => {
  const f = fixture(t);
  const path = '/api/payments/intents';
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
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_intents').get().n, 0);
});

test('streamed request limits are enforced independently of declared Content-Length', async t => {
  const f = fixture(t);
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(256 * 1024)); },
    cancel() { cancelled = true; },
  });
  const response = await f.handle(request('/api/payments/intents', {}, { body, headers: { 'Content-Length': '1' } }));
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  const declared = await f.call('/api/payments/intents', { afdianId: CREATOR }, { headers: { 'Content-Length': '262144' } });
  assert.equal(declared.status, 413);
});

test('a stalled or cancelled request terminates without persisting an intent', async t => {
  const f = fixture(t);
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const timeout = await f.handle(request('/api/payments/intents', {}, { body }), { timeoutMs: 15 });
  assert.equal(timeout.status, 504);
  assert.equal(cancelled, true);
  const controller = new AbortController();
  controller.abort();
  const aborted = await f.handle(request('/api/payments/intents', { afdianId: CREATOR }, { signal: controller.signal }));
  assert.equal(aborted.status, 499);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_intents').get().n, 0);
});

test('production verifier ignores any public-key override supplied through environment bindings', async t => {
  const f = fixture(t);
  const intent = await f.intent();
  const response = await handlePayments(request('/api/payments/webhook', callback(intent)), {
    ...f.env, AFDIAN_PUBLIC_KEY: publicKey, publicKey,
  }, { now: () => f.now });
  assert.equal(response.status, 403);
  assert.equal((await f.status(intent)).status, 'pending');
});

test('missing bindings and rate limiter failures fail closed without exposing diagnostic text', async t => {
  const f = fixture(t);
  const input = () => request('/api/payments/intents', { afdianId: CREATOR });
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
