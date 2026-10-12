import test from 'node:test';
import assert from 'node:assert/strict';
import { saveIntegration, readIntegration, saveReceipt, readReceipt, readRecentReceipt, deleteReceipt } from '../src/lib/payment-storage.js';

const ID = 'a'.repeat(32);
const UID = 'b'.repeat(32);
const TOKEN = 'c'.repeat(64);
const ORIGIN = 'https://example.com';
const NOW = 1_790_000_000_000;
const integration = { integrationId: ID, managementToken: TOKEN, webhookUrl: `${ORIGIN}/api/payments/webhook/${ID}/${'d'.repeat(64)}`, enabled: true };
const config = { repo: 'octocat/hello-world', storeCode: '100001', storeName: '附近餐厅', beType: 1, afdianId: UID, integrationId: ID };
const receipt = { intentId: ID, readToken: TOKEN, createdAt: NOW, expiresAt: NOW + 300_000, config, items: [{ code: 'BIGMAC', name: '巨无霸', quantity: 1 }], amountCents: 2550, blessing: '谢谢你 🍔' };
function memory() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}
function options(extra = {}) { return { storage: memory(), origin: ORIGIN, now: NOW, ...extra }; }

test('author settings roundtrip by UID while public config contains no private settings', () => {
  const opts = options();
  assert.equal(saveIntegration(UID, integration, opts), true);
  const saved = readIntegration(UID.toUpperCase(), opts);
  assert.deepEqual(saved, { afdianId: UID, ...integration, updatedAt: NOW });
  assert.equal(readIntegration('f'.repeat(32), opts), null);
  assert.equal(saveIntegration(UID, { ...saved, enabled: false }, opts), true);
  assert.equal(readIntegration(UID, opts).enabled, false);
  assert.equal(saveIntegration('f'.repeat(32), saved, opts), false);
});

test('author settings reject unsafe URLs, cross-origin restores and missing enabled boolean', () => {
  const opts = options();
  for (const candidate of [
    { ...integration, webhookUrl: integration.webhookUrl.replace(ORIGIN, 'https://evil.test') },
    { ...integration, webhookUrl: `${integration.webhookUrl}?secret=${TOKEN}` },
    { ...integration, integrationId: UID }, { ...integration, managementToken: 'short' },
    { ...integration, enabled: 'true' }, { ...integration, secret: TOKEN },
  ]) assert.equal(saveIntegration(UID, candidate, opts), false);
  saveIntegration(UID, integration, opts);
  assert.equal(readIntegration(UID, { ...opts, origin: 'https://other.test' }), null);
});

test('author settings keep only the 10 most recently saved accounts', () => {
  const opts = options();
  for (let i = 1; i <= 12; i++) assert.equal(saveIntegration(i.toString(16).padStart(32, '0'), integration, { ...opts, now: NOW + i }), true);
  assert.equal(readIntegration('1'.padStart(32, '0'), opts), null);
  assert.equal(readIntegration('2'.padStart(32, '0'), opts), null);
  assert.equal(readIntegration('3'.padStart(32, '0'), opts).integrationId, ID);
  assert.equal(JSON.parse([...opts.storage.values.values()][0]).entries.length, 10);
});

test('receipts recover their public meal snapshot but never a stored payment status', () => {
  const opts = options();
  assert.equal(saveReceipt(receipt, opts), true);
  const saved = readReceipt(ID, opts);
  assert.equal(saved.config.integrationId, ID);
  assert.deepEqual(saved.items, receipt.items);
  assert.equal(saved.blessing, receipt.blessing);
  assert.equal(Object.hasOwn(saved, 'status'), false);
  assert.deepEqual(readRecentReceipt(opts), saved);
  assert.equal(saveReceipt({ ...receipt, status: 'notified' }, opts), false);
  assert.equal(saveReceipt({ ...receipt, payUrl: 'https://evil.test' }, opts), false);
  for (const name of ['webhookUrl', 'managementToken', 'token']) {
    assert.equal(saveReceipt({ ...receipt, config: { ...config, [name]: TOKEN } }, opts), false);
  }
  assert.equal(saveReceipt({ ...receipt, managementToken: TOKEN }, opts), false);
});

test('metadata remains readable after the five-minute query window but expires at 30 minutes', () => {
  const opts = options();
  assert.equal(saveReceipt(receipt, opts), true);
  assert.equal(readReceipt(ID, { ...opts, now: NOW + 300_001 }).intentId, ID);
  assert.equal(readRecentReceipt({ ...opts, now: NOW + 1_799_999 }).intentId, ID);
  assert.equal(readReceipt(ID, { ...opts, now: NOW + 1_800_000 }), null);
  assert.equal(readRecentReceipt({ ...opts, now: NOW + 1_800_000 }), null);
  assert.equal(saveReceipt(receipt, { ...opts, now: NOW + 1_800_000 }), false);
  assert.equal(readReceipt(ID, { ...opts, now: NOW - 1 }), null);
});

test('receipts keep the latest five, replace matching IDs and delete only the requested record', () => {
  const opts = options();
  for (let i = 1; i <= 7; i++) saveReceipt({ ...receipt, intentId: i.toString(16).padStart(32, '0'), createdAt: NOW + i }, { ...opts, now: NOW + i });
  const latest = { ...opts, now: NOW + 10 };
  assert.equal(readReceipt('1'.padStart(32, '0'), latest), null);
  assert.equal(readReceipt('2'.padStart(32, '0'), latest), null);
  assert.equal(readRecentReceipt(latest).intentId, '7'.padStart(32, '0'));
  const updated = { ...readRecentReceipt(latest), blessing: '再接再厉' };
  assert.equal(saveReceipt(updated, latest), true);
  assert.equal(readRecentReceipt(latest).blessing, '再接再厉');
  assert.equal(JSON.parse([...opts.storage.values.values()][0]).entries.length, 5);
  assert.equal(deleteReceipt(updated.intentId, latest), true);
  assert.equal(readReceipt(updated.intentId, latest), null);
  assert.equal(readRecentReceipt(latest).intentId, '6'.padStart(32, '0'));
});

test('malformed and oversized browser storage cannot restore a trusted receipt', () => {
  const opts = options();
  saveReceipt(receipt, opts);
  const key = [...opts.storage.values.keys()][0];
  for (const raw of ['{', 'null', '[]', JSON.stringify({ v: 9, entries: [receipt] }), JSON.stringify({ v: 1, entries: Array(6).fill(receipt) }), 'x'.repeat(1_048_577)]) {
    opts.storage.setItem(key, raw);
    assert.equal(readReceipt(ID, opts), null);
    assert.equal(readRecentReceipt(opts), null);
  }
  opts.storage.setItem(key, JSON.stringify({ v: 1, entries: [{ ...receipt, status: 'notified' }] }));
  assert.equal(readReceipt(ID, opts), null);
  assert.equal(saveReceipt(receipt, opts), true);
  assert.equal(readReceipt(ID, opts).intentId, ID);
});

test('receipt validation rejects malformed money, identities, items and timestamps', () => {
  const opts = options();
  for (const invalid of [
    { readToken: 'short' }, { intentId: ID.toUpperCase() }, { amountCents: 0 }, { amountCents: 3_000_001 },
    { amountCents: '2550' }, { createdAt: NOW + 1 }, { expiresAt: Infinity }, { expiresAt: 0 },
    { items: [] }, { items: Array(201).fill(receipt.items[0]) }, { items: [receipt.items[0], receipt.items[0]] },
    { items: [{ ...receipt.items[0], name: 'bad\0name' }] }, { items: [{ ...receipt.items[0], quantity: '1' }] },
    { items: [{ ...receipt.items[0], code: '../escape' }] }, { blessing: 'a'.repeat(501) },
  ]) assert.equal(saveReceipt({ ...receipt, ...invalid }, opts), false);
});

test('blocked or full storage fails safely so the caller can offer a fallback', () => {
  for (const storage of [null, { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); } }, { getItem() { return null; }, setItem() { throw new Error('QuotaExceeded'); } }]) {
    const opts = options({ storage });
    assert.equal(saveReceipt(receipt, opts), false);
    assert.equal(readReceipt(ID, opts), null);
    assert.equal(readRecentReceipt(opts), null);
    assert.equal(deleteReceipt(ID, opts), false);
    assert.equal(saveIntegration(UID, integration, opts), false);
    assert.equal(readIntegration(UID, opts), null);
  }
});
