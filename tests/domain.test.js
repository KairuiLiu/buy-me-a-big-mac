import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGithubRepo, validateAfdianId, normalizeConfig, encodeConfig, decodeConfig,
  createShareUrl, createBadgeMarkup, buildAfdianUrl, formatMoney,
  safeHttpsUrl, normalizeMenu, normalizeQuote,
} from '../public/lib/domain.js';

const UID = '0123456789abcdef0123456789abcdef';
const config = {
  repo: 'octocat/hello-world', storeCode: '100001', beCode: 'B001',
  storeName: '麦当劳 🍔「滨海湾」餐厅', beType: 1, afdianId: UID,
};
const quote = {
  price: 3590, originalPrice: 4000, discount: 410,
  productList: [{ productCode: 'BIGMAC', productName: '巨无霸套餐', quantity: 1, originalSubtotal: 4000, subtotal: 3590 }],
};
const menu = {
  categories: [{ name: '人气热卖', meals: [{ code: 'BIGMAC' }, { code: 'FRIES' }] }],
  meals: {
    BIGMAC: { name: '巨无霸套餐', currentPrice: '35.90', originalPrice: '40', image: 'https://example.com/burger.png', discountType: '促销优惠' },
    FRIES: { name: '薯条', currentPrice: '9.9', originalPrice: '9.9', discountType: null },
  },
};

test('strict GitHub repository parsing rejects other hosts and nested paths', () => {
  assert.equal(parseGithubRepo(' https://github.com/octocat/hello-world.git/ '), 'octocat/hello-world');
  assert.equal(parseGithubRepo('octocat/hello-world'), 'octocat/hello-world');
  assert.equal(parseGithubRepo('github.com/octocat/hello-world'), 'octocat/hello-world');
  assert.equal(parseGithubRepo('https://www.github.com/octocat/hello-world/'), 'octocat/hello-world');
  assert.equal(parseGithubRepo('www.github.com/octocat/hello-world'), 'octocat/hello-world');
  for (const input of ['https://github.com.evil.test/o/r', 'https://evil.test/o/r', 'https://github.com@evil.test/o/r', 'https://github.com/o/r/tree/main', 'https://github.com/o/r?token=secret', 'https://github.com/o%2Fr/x', 'http://github.com/o/r', 'o/..', '../r', '-o/r', 'o--x/r', 'o/r\n']) {
    assert.throws(() => parseGithubRepo(input), TypeError, input);
  }
});

test('sponsorship remarks preserve LF and normalize CRLF without allowing other controls', () => {
  const remark = '谢谢你的项目 🍔\r\n项目：octocat/hello-world\n这一餐：巨无霸 ×1';
  const url = new URL(buildAfdianUrl({ afdianId: UID, amountCents: 3590, remark }));
  assert.equal(url.searchParams.get('remark'), remark.replace(/\r\n/g, '\n'));
  for (const invalid of ['留言\t制表符', '留言\r裸回车', '留言\0空字符', '留言\u007f删除字符', '\n\r\n', 'a'.repeat(501)]) {
    assert.throws(() => buildAfdianUrl({ afdianId: UID, amountCents: 3590, remark: invalid }), TypeError);
  }
});

test('author UID is a validated 32-character hex identifier', () => {
  assert.equal(validateAfdianId(UID.toUpperCase()), UID);
  for (const input of ['https://afdian.com/a/author', 'author', UID + '0', 'z'.repeat(32), null]) {
    assert.throws(() => validateAfdianId(input), TypeError);
  }
});

test('configuration roundtrip preserves Unicode and contains only the public whitelist', () => {
  const normalized = normalizeConfig(config);
  assert.deepEqual(decodeConfig(encodeConfig(config)), normalized);
  assert.deepEqual(Object.keys(normalized), ['v', 'repo', 'storeCode', 'beCode', 'storeName', 'beType', 'orderType', 'afdianId']);
  assert.equal(normalized.orderType, 1);
  assert.equal(normalizeConfig({ ...config, beType: 5 }).beType, 5);
  for (const invalid of [{ ...config, token: 'secret' }, { ...config, auth: {} }, { ...config, v: 2 }, { ...config, beType: 2 }, { ...config, orderType: 2 }, { ...config, storeCode: '<script>' }]) {
    assert.throws(() => encodeConfig(invalid), TypeError);
  }
});

test('decoder validates schema, encoding, UTF-8 and limits', () => {
  const encodeRaw = value => Buffer.from(value).toString('base64url');
  for (const value of ['', '#', 'a'.repeat(6000), 'a', encodeRaw('{'), encodeRaw('null'), encodeRaw('[]'), encodeRaw(JSON.stringify({ ...config, token: 'secret' })), Buffer.from([0xff, 0xfe]).toString('base64url')]) {
    assert.throws(() => decodeConfig(value), undefined, value.slice(0, 80));
  }
  assert.throws(() => decodeConfig(encodeConfig(config) + '='), TypeError);
});

test('share URL strips existing query parameters and replaces the fragment', () => {
  const url = new URL(createShareUrl('https://example.com/project/?token=SECRET#/old', config));
  assert.equal(url.search, '');
  assert.match(url.hash, /^#\/gift\/[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeConfig(url.hash.slice('#/gift/'.length)), normalizeConfig(config));
  assert.ok(!url.href.includes('SECRET'));
  assert.throws(() => createShareUrl('javascript:alert(1)', config));
  assert.throws(() => createShareUrl('https://user:password@example.com/', config));
  assert.match(createShareUrl('http://localhost:5173/', config), /^http:\/\/localhost:5173/);
});

test('badge markup validates URL schemes and escapes HTML attributes', () => {
  const result = createBadgeMarkup('https://example.com/?a=1&b=2', 'https://example.com/a(b).svg?x=1&y=2');
  assert.ok(result.html.includes('&amp;'));
  assert.ok(result.markdown.includes('a%28b%29.svg'));
  assert.ok(!result.html.includes('onerror='));
  assert.throws(() => createBadgeMarkup('javascript:alert(1)', 'https://example.com/a.svg'));
  assert.throws(() => createBadgeMarkup('https://example.com/', 'data:image/svg+xml,<svg/>'));
  const injected = createBadgeMarkup('https://example.com/?x="/><script>alert(1)</script>', 'https://example.com/badge.svg');
  assert.ok(!injected.html.includes('<script>'));
});

test('money formatting and sponsorship URL use integer cents without floating-point loss', () => {
  assert.equal(formatMoney(0), '0.00');
  assert.equal(formatMoney(1), '0.01');
  assert.equal(formatMoney(3590), '35.90');
  assert.equal(formatMoney(3_000_000), '30000.00');
  const remark = '请你吃巨无霸 🍔 & 薯条 = 快乐 # PR42';
  const url = new URL(buildAfdianUrl({ afdianId: UID, amountCents: 3590, remark, reference: 'meal_42' }));
  assert.equal(url.origin, 'https://afdian.com');
  assert.equal(url.pathname, '/order/create');
  assert.equal(url.searchParams.get('custom_price'), '35.90');
  assert.equal(url.searchParams.get('month'), '1');
  assert.equal(url.searchParams.get('remark'), remark);
  assert.equal(url.searchParams.get('custom_order_id'), 'meal_42');
  assert.deepEqual([...url.searchParams.keys()], ['user_id', 'custom_price', 'month', 'remark', 'custom_order_id']);
  for (const amountCents of [0, -1, 3_000_001, 0.5, NaN, Infinity, '3590', null, true]) {
    assert.throws(() => buildAfdianUrl({ afdianId: UID, amountCents, remark }), TypeError);
  }
});

test('image URLs allow only HTTPS and reject credentials or injected controls', () => {
  assert.equal(safeHttpsUrl('https://example.com/image.png'), 'https://example.com/image.png');
  for (const value of ['javascript:alert(1)', 'data:image/svg+xml,test', 'http://example.com/', '//example.com/a.png', 'https://user:pass@example.com/a', 'https://example.com/\nfoo', undefined]) {
    assert.equal(safeHttpsUrl(value), '');
  }
});

test('official menu mapping converts yuan strings into exact integer cents', () => {
  const result = normalizeMenu({ success: true, code: 200, data: menu });
  assert.deepEqual(result.categories, [{ name: '人气热卖', codes: ['BIGMAC', 'FRIES'] }]);
  assert.equal(result.products[0].priceCents, 3590);
  assert.equal(result.products[0].originalPriceCents, 4000);
  assert.equal(result.products[1].priceCents, 990);
  assert.equal(result.products[1].image, '');
  assert.equal(result.products[1].discountType, null);
  for (const currentPrice of [undefined, null, '', '-1', 'NaN', '1e2', '35.999', ' 35.90 ', true, Infinity, '30000.01']) {
    assert.throws(() => normalizeMenu({ ...menu, meals: { ...menu.meals, BIGMAC: { ...menu.meals.BIGMAC, currentPrice } } }), TypeError);
  }
  assert.throws(() => normalizeMenu({ success: false, code: 200, data: menu }), TypeError);
  assert.throws(() => normalizeMenu({ ...menu, meals: [] }), TypeError);
  assert.throws(() => normalizeMenu({ ...menu, categories: [{ name: '热卖', meals: [{ code: 'MISSING' }] }] }), TypeError);
});

test('missing menu originalPrice uses the current display price; malformed prices still fail', () => {
  const withoutOriginal = { ...menu, meals: { BIGMAC: { name: '巨无霸', currentPrice: '35.90' } }, categories: [{ name: '热卖', meals: [{ code: 'BIGMAC' }] }] };
  assert.equal(normalizeMenu(withoutOriginal).products[0].originalPriceCents, 3590);
  assert.equal(normalizeMenu({ ...withoutOriginal, meals: { BIGMAC: { ...withoutOriginal.meals.BIGMAC, originalPrice: null } } }).products[0].originalPriceCents, 3590);
  assert.throws(() => normalizeMenu({ ...withoutOriginal, meals: { BIGMAC: { ...withoutOriginal.meals.BIGMAC, originalPrice: '' } } }), TypeError);
  assert.throws(() => normalizeQuote({ ...quote, originalPrice: undefined }), TypeError);
});

test('display-only category labels tolerate whitespace, controls and missing values', () => {
  const normalized = name => normalizeMenu({ ...menu, categories: [{ name, meals: [{ code: 'BIGMAC' }] }] });
  assert.equal(normalized('\n 汉堡\t精选\r\n').categories[0].name, '汉堡 精选');
  assert.equal(normalized('小食\0\u007f饮品').categories[0].name, '小食 饮品');
  for (const name of [undefined, null, 42, false, {}, [], '', ' \n\t ', '\0\u007f']) {
    const result = normalized(name);
    assert.deepEqual(result.categories, [{ name: '其他餐品', codes: ['BIGMAC'] }]);
    assert.deepEqual(result.products, normalizeMenu(menu).products);
  }
  assert.equal(normalized('🍔'.repeat(101)).categories[0].name, '🍔'.repeat(100));
  assert.equal(normalized('<img src=x onerror=alert(1)>').categories[0].name, '<img src=x onerror=alert(1)>');
});

test('normalized and fallback category names merge without hiding meals', () => {
  const result = normalizeMenu({ ...menu, categories: [
    { name: '热卖\n精选', meals: [{ code: 'BIGMAC' }] },
    { name: ' 热卖 精选 ', meals: [{ code: 'FRIES' }, { code: 'BIGMAC' }] },
    { name: null, meals: [{ code: 'BIGMAC' }] },
    { meals: [{ code: 'FRIES' }] },
    { name: '全部', meals: [{ code: 'FRIES' }] },
  ] });
  assert.deepEqual(result.categories, [
    { name: '热卖 精选', codes: ['BIGMAC', 'FRIES'] },
    { name: '其他餐品', codes: ['BIGMAC', 'FRIES'] },
    { name: '全部', codes: ['FRIES'] },
  ]);
});

test('category label fallback does not relax meal identifiers, references or money checks', () => {
  const categories = [{ name: null, meals: [{ code: 'BIGMAC' }] }];
  assert.throws(() => normalizeMenu({ ...menu, categories, meals: { ...menu.meals, BIGMAC: { ...menu.meals.BIGMAC, currentPrice: 'free' } } }), /餐品现价/);
  assert.throws(() => normalizeMenu({ ...menu, categories: [{ name: null, meals: [{ code: '../BIGMAC' }] }] }), /餐品编码/);
  assert.throws(() => normalizeMenu({ ...menu, categories: [{ name: null, meals: [{ code: 'MISSING' }] }] }), /缺失餐品/);
});

test('official quote keeps cent amounts and normalized line items', () => {
  assert.deepEqual(normalizeQuote({ success: true, code: 200, data: quote }), {
    amountCents: 3590, originalCents: 4000, discountCents: 410,
    items: [{ code: 'BIGMAC', name: '巨无霸套餐', quantity: 1, originalCents: 4000, amountCents: 3590 }],
  });
  assert.equal(normalizeQuote(quote).amountCents, 3590);
  for (const price of [undefined, '', null, '3590', NaN, Infinity, -1, 0, 3590.5, 3_000_001]) {
    assert.throws(() => normalizeQuote({ ...quote, price }), TypeError);
  }
  for (const discount of [undefined, NaN, -1, '410']) assert.throws(() => normalizeQuote({ ...quote, discount }), TypeError);
  assert.throws(() => normalizeQuote({ ...quote, originalPrice: 3000 }), TypeError);
  assert.throws(() => normalizeQuote({ ...quote, productList: [] }), TypeError);
  assert.throws(() => normalizeQuote({ ...quote, productList: [{ ...quote.productList[0], subtotal: -1 }] }), TypeError);
  assert.throws(() => normalizeQuote({ ...quote, productList: [{ ...quote.productList[0], quantity: '1' }] }), TypeError);
  assert.throws(() => normalizeQuote({ success: false, data: quote }), TypeError);
});
