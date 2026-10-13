import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDonationRemark } from '../src/lib/donation-remark.js';

const base = {
  recipient: '小明',
  blessing: '这顿我请！',
  items: [{ name: '巨无霸', quantity: 2, amountCents: 4800 }],
  amountCents: 4800,
};

test('remark has the requested 20/8/6 columns, merged recipient, and literal footer', () => {
  assert.equal(buildDonationRemark(base), [
    '这顿我请！', '',
    '赠予' + ' '.repeat(26) + '小明',
    '商品' + ' '.repeat(16) + '数目' + ' '.repeat(4) + '价格' + ' '.repeat(2),
    '巨无霸' + ' '.repeat(14) + '×2' + ' '.repeat(6) + '￥48.00',
    '总计' + ' '.repeat(16) + '×2' + ' '.repeat(6) + '￥48.00',
    '', 'Create by Buy me a Big Mac',
  ].join('\n'));
});

test('recipient overflows the merged cell intact without wrapping or truncation', () => {
  const recipient = 'KairuiLiu/buy-me-a-big-mac';
  const result = buildDonationRemark({ ...base, recipient });
  assert.equal(result.split('\n')[2], '赠予' + ' '.repeat(16) + recipient);
  assert.equal(result.split('\n').filter(line => line.includes(recipient)).length, 1);
});

test('line prices are subtotals and total quantity sums all items', () => {
  const result = buildDonationRemark({
    ...base,
    items: [
      { name: '巨无霸', quantity: 3, amountCents: 7200 },
      { name: '薯条', quantity: 123, amountCents: 12300 },
    ],
    amountCents: 19500,
  });
  const lines = result.split('\n');
  assert.equal(lines[4], '巨无霸' + ' '.repeat(14) + '×3' + ' '.repeat(6) + '￥72.00');
  assert.equal(lines[5], '薯条' + ' '.repeat(16) + '×123' + ' '.repeat(4) + '￥123.00');
  assert.equal(lines[6], '总计' + ' '.repeat(16) + '×126' + ' '.repeat(4) + '￥195.00');
});

test('mixed CJK, combining marks, emoji families, flags, and skin tones keep display columns', () => {
  const name = 'A中e\u0301👨‍👩‍👧‍👦🇨🇳👍🏽'; // 1 + 2 + 1 + 2 + 2 + 2 = 10 display cells.
  const result = buildDonationRemark({ ...base, items: [{ name, quantity: 1, amountCents: 100 }] });
  assert.equal(result.split('\n')[4], name + ' '.repeat(10) + '×1' + ' '.repeat(6) + '￥1.00');
});

test('long names wrap without losing text and put numbers only on the first line', () => {
  const segments = ['十'.repeat(9) + 'A', '👨‍👩‍👧‍👦' + '🍔'.repeat(9), 'e\u0301加长套餐'];
  const name = segments.join('');
  const result = buildDonationRemark({ ...base, items: [{ name, quantity: 2, amountCents: 4800 }] });
  const itemLines = result.split('\n').slice(4, 7);
  assert.equal(itemLines[0], segments[0] + ' ' + '×2' + ' '.repeat(6) + '￥48.00');
  assert.equal(itemLines[1], segments[1] + ' '.repeat(14));
  assert.equal(itemLines[2], segments[2] + ' '.repeat(25));
  assert.equal(itemLines.map((line, i) => i === 0 ? line.split(' ×2')[0] : line.trimEnd()).join(''), name);
});

test('prices wider than six display cells remain on one line with exact cents', () => {
  const result = buildDonationRemark({ ...base, amountCents: 1234567, items: [{ name: '餐品', quantity: 1, amountCents: 1234567 }] });
  assert.equal(result.split('\n')[4], '餐品' + ' '.repeat(16) + '×1' + ' '.repeat(6) + '￥12345.67');
  assert.match(result, /总计 {16}×1 {6}￥12345\.67/);
});

test('zero cents are prices but legacy items without subtotals display a dash', () => {
  const result = buildDonationRemark({
    ...base,
    items: [{ name: '旧餐品', quantity: 1 }, { name: '另一旧餐品', quantity: 1, amountCents: null }, { name: '赠品', quantity: 1, amountCents: 0 }],
    amountCents: 100,
  });
  assert.equal(result.split('\n')[4], '旧餐品' + ' '.repeat(14) + '×1' + ' '.repeat(6) + '—' + ' '.repeat(5));
  assert.equal(result.split('\n')[5], '另一旧餐品' + ' '.repeat(10) + '×1' + ' '.repeat(6) + '—' + ' '.repeat(5));
  assert.equal(result.split('\n')[6], '赠品' + ' '.repeat(16) + '×1' + ' '.repeat(6) + '￥0.00');
});

test('blank blessing starts at the table, while written blessings retain whitespace and line breaks', () => {
  assert.ok(buildDonationRemark({ ...base, blessing: '' }).startsWith('赠予'));
  assert.ok(buildDonationRemark({ ...base, blessing: undefined }).startsWith('赠予'));
  const blessing = ' 谢谢你 🍔\n愿每顿都开心！ ';
  assert.ok(buildDonationRemark({ ...base, blessing }).startsWith(blessing + '\n\n赠予'));
  assert.ok(buildDonationRemark({ ...base, blessing: '谢谢\r\n加油' }).startsWith('谢谢\n加油\n\n赠予'));
});

test('formatter uses plain spaces and rejects controls that could corrupt table rows', () => {
  const result = buildDonationRemark(base);
  assert.doesNotMatch(result, /\t|<table|<br/);
  for (const patch of [
    { recipient: '小\t明' }, { blessing: '谢谢\t你' },
    { items: [{ name: '餐品\n其他', quantity: 1, amountCents: 100 }] },
    { items: [{ name: '餐品', quantity: 0, amountCents: 100 }] },
    { items: [{ name: '餐品', quantity: 1, amountCents: -100 }] },
    { amountCents: 1.5 },
  ]) assert.throws(() => buildDonationRemark({ ...base, ...patch }), TypeError);
});
