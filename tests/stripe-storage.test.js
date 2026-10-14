import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/lib/domain.js';
import { saveReceipt, readReceipt, readRecentReceipt, deleteReceipt } from '../src/lib/payment-storage.js';

const KEY = 'bigmac.payments.receipts.v1';
const NOW = 1_790_000_000_000;
const ID = 'a'.repeat(32);
const config = { stripePaymentLink: 'https://buy.stripe.com/test_Abc123', repo: 'o/r', storeCode: '001', beType: 1 };
const receipt = { provider: 'stripe', intentId: ID, createdAt: NOW, config, items: [{ code: 'BIGMAC', name: '巨无霸', quantity: 1, amountCents: 2550 }], amountCents: 2550, blessing: '谢谢 🍔' };
const afdian = { ...receipt, intentId: 'b'.repeat(32), readToken: 'c'.repeat(64), expiresAt: NOW + 300_000, config: { repo: 'o/r', storeCode: '001', beType: 1, afdianId: 'd'.repeat(32) } };
delete afdian.provider;
function memory() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}
const options = () => ({ storage: memory(), now: NOW });

test('Stripe receipts preserve only local context and no backend payment fields', () => {
  const opts = options();
  assert.equal(saveReceipt(receipt, opts), true);
  const expected = { ...receipt, config: normalizeConfig(config) };
  assert.deepEqual(readReceipt(ID, opts), expected);
  assert.deepEqual(readRecentReceipt(opts), expected);
  assert.deepEqual(JSON.parse(opts.storage.getItem(KEY)), { v: 1, entries: [expected] });
  for (const field of ['readToken', 'expiresAt', 'afdianOrderNo', 'status', 'paid', 'payUrl', 'sessionId', 'webhookUrl', 'managementToken']) {
    for (const value of ['private', undefined]) assert.equal(saveReceipt({ ...receipt, [field]: value }, opts), false, field);
    const candidate = { ...receipt, [field]: 'private' };
    opts.storage.setItem(KEY, JSON.stringify({ v: 1, entries: [candidate] }));
    assert.equal(readReceipt(ID, opts), null, field);
  }
});

test('provider and config mismatches cannot be saved or restored', () => {
  const opts = options();
  const { provider: _provider, ...withoutProvider } = receipt;
  const invalid = [
    withoutProvider, { ...receipt, provider: 'afdian' }, { ...receipt, provider: undefined }, { ...receipt, provider: 'other' },
    { ...receipt, config: afdian.config }, { ...afdian, config }, { ...afdian, provider: 'stripe' },
    { ...receipt, config: { ...config, notifications: true } },
    { ...receipt, config: { ...config, beCode: 'BE001' } },
  ];
  for (const candidate of invalid) {
    assert.equal(saveReceipt(candidate, opts), false);
    opts.storage.setItem(KEY, JSON.stringify({ v: 1, entries: [candidate] }));
    assert.equal(readReceipt(candidate.intentId, opts), null);
  }
});

test('a shared dual-method config stores receipts for either chosen provider independently', () => {
  const opts = options();
  const dual = { ...config, afdianId: afdian.config.afdianId, notifications: true, stripeReturn: true };
  const stripeReceipt = { ...receipt, config: dual };
  const afdianReceipt = { ...afdian, config: dual };
  assert.equal(saveReceipt(stripeReceipt, opts), true);
  assert.equal(saveReceipt(afdianReceipt, opts), true);
  assert.deepEqual(readReceipt(receipt.intentId, opts), { ...stripeReceipt, config: normalizeConfig(dual) });
  assert.deepEqual(readReceipt(afdian.intentId, opts), { ...afdianReceipt, config: normalizeConfig(dual) });
  assert.equal(readRecentReceipt({ ...opts, provider: 'stripe' }).intentId, receipt.intentId);
  assert.equal(readRecentReceipt({ ...opts, provider: 'afdian' }).intentId, afdian.intentId);
});

test('old exclusive Stripe receipts migrate their config while preserving the selected receipt provider', () => {
  const opts = options();
  const old = { ...receipt, config: { ...config, paymentProvider: 'stripe' } };
  opts.storage.setItem(KEY, JSON.stringify({ v: 1, entries: [old] }));
  const restored = readReceipt(ID, opts);
  assert.equal(restored.provider, 'stripe');
  assert.deepEqual(restored.config, normalizeConfig({ ...config, stripeReturn: true }));
  assert.equal(Object.hasOwn(restored.config, 'paymentProvider'), false);
  assert.equal(saveReceipt(restored, opts), true);
  assert.deepEqual(readReceipt(ID, opts), restored);
});

test('Stripe receipt context expires at exactly 30 minutes and rejects future timestamps', () => {
  const opts = options();
  assert.equal(saveReceipt(receipt, opts), true);
  assert.equal(readReceipt(ID, { ...opts, now: NOW + 1_799_999 }).intentId, ID);
  assert.equal(readReceipt(ID, { ...opts, now: NOW + 1_800_000 }), null);
  assert.equal(readRecentReceipt({ ...opts, now: NOW + 1_800_000 }), null);
  assert.equal(readReceipt(ID, { ...opts, now: NOW - 1 }), null);
  assert.equal(saveReceipt(receipt, { ...opts, now: NOW + 1_800_000 }), false);
  for (const createdAt of [NOW + 1, -1, 1.5, Infinity, '1790000000000', null]) {
    assert.equal(saveReceipt({ ...receipt, createdAt }, opts), false);
  }
});

test('Stripe and Afdian share a five-record limit while keeping their separate shapes', () => {
  const opts = options();
  for (let index = 1; index <= 7; index++) {
    const value = { ...(index % 2 ? receipt : afdian), intentId: index.toString(16).padStart(32, '0'), createdAt: NOW + index };
    assert.equal(saveReceipt(value, { ...opts, now: NOW + index }), true);
  }
  const later = { ...opts, now: NOW + 10 };
  assert.equal(readReceipt('1'.padStart(32, '0'), later), null);
  assert.equal(readReceipt('2'.padStart(32, '0'), later), null);
  const entries = JSON.parse(opts.storage.getItem(KEY)).entries;
  assert.equal(entries.length, 5);
  assert.equal(readRecentReceipt(later).provider, 'stripe');
  for (const entry of entries) {
    assert.equal(Object.hasOwn(entry, 'readToken'), entry.provider !== 'stripe');
    assert.equal(Object.hasOwn(entry, 'expiresAt'), entry.provider !== 'stripe');
  }
  const recent = readRecentReceipt(later);
  assert.equal(saveReceipt({ ...recent, blessing: '再来一份' }, later), true);
  assert.equal(readRecentReceipt(later).blessing, '再来一份');
  assert.equal(JSON.parse(opts.storage.getItem(KEY)).entries.length, 5);
  assert.equal(deleteReceipt(recent.intentId, later), true);
  assert.equal(readReceipt(recent.intentId, later), null);
  assert.equal(Object.hasOwn(readRecentReceipt(later), 'provider'), false);
});

test('mixed storage ignores invalid entries without dropping valid receipts', () => {
  const opts = options();
  opts.storage.setItem(KEY, JSON.stringify({ v: 1, entries: [
    { ...receipt, readToken: 'c'.repeat(64) }, afdian,
    { ...receipt, intentId: 'e'.repeat(32), createdAt: NOW - 1_800_000 },
    { ...receipt, intentId: 'f'.repeat(32), createdAt: NOW + 1 }, receipt,
  ] }));
  assert.equal(readReceipt(ID, opts).provider, 'stripe');
  assert.deepEqual(readReceipt(afdian.intentId, opts), { ...afdian, config: normalizeConfig(afdian.config) });
  assert.equal(readReceipt('e'.repeat(32), opts), null);
  assert.equal(readReceipt('f'.repeat(32), opts), null);
  assert.equal(saveReceipt(receipt, opts), true);
  assert.equal(JSON.parse(opts.storage.getItem(KEY)).entries.length, 2);
});

test('recent receipts optionally find the newest matching provider in mixed storage', () => {
  const opts = options();
  assert.equal(readRecentReceipt({ ...opts, provider: 'afdian' }), null);
  assert.equal(readRecentReceipt({ ...opts, provider: 'stripe' }), null);
  const candidates = [
    { ...afdian, intentId: '1'.repeat(32), createdAt: NOW - 4 },
    { ...receipt, intentId: '2'.repeat(32), createdAt: NOW - 3 },
    { ...afdian, intentId: '3'.repeat(32), createdAt: NOW - 2 },
    { ...receipt, intentId: '4'.repeat(32), createdAt: NOW - 1 },
  ];
  for (const candidate of candidates) assert.equal(saveReceipt(candidate, opts), true);
  assert.equal(readRecentReceipt(opts).intentId, '4'.repeat(32));
  assert.equal(readRecentReceipt({ ...opts, provider: 'stripe' }).intentId, '4'.repeat(32));
  assert.equal(readRecentReceipt({ ...opts, provider: 'afdian' }).intentId, '3'.repeat(32));
  assert.equal(readRecentReceipt({ ...opts, provider: undefined }).intentId, '4'.repeat(32));
  for (const provider of ['other', '', null, false]) assert.equal(readRecentReceipt({ ...opts, provider }), null);
  assert.equal(deleteReceipt('4'.repeat(32), opts), true);
  assert.equal(readRecentReceipt(opts).intentId, '3'.repeat(32));
  assert.equal(readRecentReceipt({ ...opts, provider: 'stripe' }).intentId, '2'.repeat(32));
  assert.equal(readRecentReceipt({ ...opts, provider: 'afdian' }).intentId, '3'.repeat(32));
});

test('Stripe receipt money, item totals and local storage failures remain strictly validated', () => {
  const opts = options();
  for (const change of [
    { amountCents: 0 }, { amountCents: 3_000_001 }, { amountCents: 2550.1 }, { amountCents: '2550' },
    { items: [] }, { items: [receipt.items[0], receipt.items[0]] },
    { items: [{ ...receipt.items[0], amountCents: 2549 }] }, { items: [{ ...receipt.items[0], name: 'bad\0name' }] },
    { items: [{ ...receipt.items[0], quantity: 0 }] }, { intentId: ID.toUpperCase() }, { blessing: 'a'.repeat(8193) },
  ]) assert.equal(saveReceipt({ ...receipt, ...change }, opts), false);
  for (const storage of [null, { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); } },
    { getItem() { return null; }, setItem() { throw new Error('QuotaExceeded'); } }]) {
    assert.equal(saveReceipt(receipt, { ...opts, storage }), false);
    assert.equal(readReceipt(ID, { ...opts, storage }), null);
  }
});
