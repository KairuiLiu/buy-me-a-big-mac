import test from 'node:test';
import assert from 'node:assert/strict';
import { saveReceipt, readReceipt, readRecentReceipt, deleteReceipt } from '../src/lib/payment-storage.js';

const ID = 'a'.repeat(32);
const UID = 'b'.repeat(32);
const TOKEN = 'c'.repeat(64);
const ORIGIN = 'https://example.com';
const NOW = 1_790_000_000_000;
const config = { repo: 'octocat/hello-world', storeCode: '100001', beType: 1, afdianId: UID, notifications: true };
const receipt = { intentId: ID, readToken: TOKEN, createdAt: NOW, expiresAt: NOW + 300_000, config, items: [{ code: 'BIGMAC', name: '巨无霸', quantity: 1 }], amountCents: 2550, blessing: '谢谢你 🍔' };
function memory() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}
function options(extra = {}) { return { storage: memory(), origin: ORIGIN, now: NOW, ...extra }; }

test('receipts recover their public meal snapshot but never a stored payment status', () => {
  const opts = options();
  assert.equal(saveReceipt(receipt, opts), true);
  const saved = readReceipt(ID, opts);
  assert.equal(saved.config.notifications, true);
  assert.equal(Object.hasOwn(saved.config, 'storeName'), false);
  assert.equal([...opts.storage.values.values()][0].includes('storeName'), false);
  assert.deepEqual(saved.items, receipt.items);
  assert.equal(saved.blessing, receipt.blessing);
  assert.equal(Object.hasOwn(saved, 'status'), false);
  assert.equal(Object.hasOwn(saved, 'afdianOrderNo'), false);
  assert.deepEqual(readRecentReceipt(opts), saved);
  assert.equal(saveReceipt({ ...receipt, status: 'notified' }, opts), false);
  assert.equal(saveReceipt({ ...receipt, payUrl: 'https://evil.test' }, opts), false);
  for (const name of ['storeName', 'webhookUrl', 'managementToken', 'token', 'afdianOrderNo']) {
    assert.equal(saveReceipt({ ...receipt, config: { ...config, [name]: TOKEN } }, opts), false);
  }
  assert.equal(saveReceipt({ ...receipt, managementToken: TOKEN }, opts), false);
});

test('receipt order numbers roundtrip without dropping leading zeroes or precision', () => {
  const opts = options();
  for (const afdianOrderNo of ['0', '000012345678901234567890', '9'.repeat(64)]) {
    assert.equal(saveReceipt({ ...receipt, afdianOrderNo }, opts), true);
    assert.equal(readReceipt(ID, opts).afdianOrderNo, afdianOrderNo);
    assert.equal(readRecentReceipt(opts).afdianOrderNo, afdianOrderNo);
    const serialized = JSON.parse([...opts.storage.values.values()][0]);
    assert.equal(serialized.entries[0].afdianOrderNo, afdianOrderNo);
    for (const field of ['payer', 'address', 'webhookUrl', 'managementToken', 'token']) {
      assert.equal(saveReceipt({ ...receipt, afdianOrderNo, [field]: TOKEN }, opts), false);
    }
  }
  assert.equal(saveReceipt(receipt, opts), true);
  assert.equal(Object.hasOwn(readReceipt(ID, opts), 'afdianOrderNo'), false);
});

test('receipts preserve item subtotals including free items without changing historical receipts', () => {
  const opts = options();
  const items = [{ ...receipt.items[0], amountCents: 2550 }, { code: 'water', name: '水', quantity: 1, amountCents: 0 }];
  assert.equal(saveReceipt({ ...receipt, items }, opts), true);
  assert.deepEqual(readReceipt(ID, opts).items, items);
  assert.equal(saveReceipt(receipt, opts), true);
  assert.deepEqual(readReceipt(ID, opts).items, receipt.items);
});

test('partial, malformed or mismatched line totals cannot be saved or restored', () => {
  const opts = options();
  assert.equal(saveReceipt(receipt, opts), true);
  const key = [...opts.storage.values.keys()][0];
  const invalidItems = [
    ...[-1, 0.5, '2550', null, 3_000_001, 2549].map(amountCents => [{ ...receipt.items[0], amountCents }]),
    [{ ...receipt.items[0], amountCents: 2550 }, { code: 'water', name: '水', quantity: 1 }],
  ];
  for (const items of invalidItems) {
    const candidate = { ...receipt, items };
    assert.equal(saveReceipt(candidate, opts), false);
    opts.storage.setItem(key, JSON.stringify({ v: 1, entries: [candidate] }));
    assert.equal(readReceipt(ID, opts), null);
  }
});

test('optional and long messages roundtrip without truncation', () => {
  const opts = options();
  for (const blessing of ['', '谢'.repeat(600), 'a'.repeat(8192)]) {
    assert.equal(saveReceipt({ ...receipt, blessing }, opts), true);
    assert.equal(readReceipt(ID, opts).blessing, blessing);
  }
});

test('invalid receipt order numbers are rejected on save and restore', () => {
  const opts = options();
  assert.equal(saveReceipt(receipt, opts), true);
  const key = [...opts.storage.values.keys()][0];
  for (const afdianOrderNo of [undefined, null, 123, true, '', '1'.repeat(65), ' 123', '123 ', '123\n', '123\r', '12\u00003', '１２３', '12.3', '1e3', '-123', [], {}]) {
    const candidate = { ...receipt, afdianOrderNo };
    assert.equal(saveReceipt(candidate, opts), false);
    // JSON cannot represent an explicitly present undefined field.
    if (afdianOrderNo === undefined) continue;
    opts.storage.setItem(key, JSON.stringify({ v: 1, entries: [candidate] }));
    assert.equal(readReceipt(ID, opts), null);
    assert.equal(readRecentReceipt(opts), null);
  }
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
    { items: [{ ...receipt.items[0], code: '../escape' }] }, { blessing: 'a'.repeat(8193) },
  ]) assert.equal(saveReceipt({ ...receipt, ...invalid }, opts), false);
});

test('blocked or full storage fails safely so the caller can offer a fallback', () => {
  for (const storage of [null, { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); } }, { getItem() { return null; }, setItem() { throw new Error('QuotaExceeded'); } }]) {
    const opts = options({ storage });
    assert.equal(saveReceipt(receipt, opts), false);
    assert.equal(readReceipt(ID, opts), null);
    assert.equal(readRecentReceipt(opts), null);
    assert.equal(deleteReceipt(ID, opts), false);
  }
});
