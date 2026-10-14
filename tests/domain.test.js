import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGithubRepo, validateSponsorName, validateAfdianId, normalizeConfig, encodeConfig, decodeConfig, hasPaymentNotifications,
  createShareUrl, createBadgeMarkup, buildAfdianUrl, formatMoney,
  safeHttpsUrl, normalizeMenu, normalizeQuote,
} from '../src/lib/domain.js';

const UID = '0123456789abcdef0123456789abcdef';
const config = {
  repo: 'octocat/hello-world', storeCode: '100001',
  beType: 1, afdianId: UID,
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
  for (const invalid of ['留言\t制表符', '留言\r裸回车', '留言\0空字符', '留言\u007f删除字符', '\n\r\n']) {
    assert.throws(() => buildAfdianUrl({ afdianId: UID, amountCents: 3590, remark: invalid }), TypeError);
  }
});

test('checkout preserves long remarks but rejects oversized encoded URLs before creating a reference', () => {
  const input = { afdianId: UID, amountCents: 3590, remark: '祝'.repeat(600) };
  const direct = new URL(buildAfdianUrl(input));
  assert.equal(direct.searchParams.get('remark'), input.remark);
  const linked = new URL(buildAfdianUrl({ ...input, reference: 'f'.repeat(100) }));
  assert.ok(linked.href.length <= 8192);
  assert.equal(linked.searchParams.get('remark'), input.remark);
  assert.throws(() => buildAfdianUrl({ ...input, remark: '祝'.repeat(1000) }), /赞助内容过长/);
  const baseLength = new URL(buildAfdianUrl({ ...input, remark: 'a' })).href.length - 1;
  const max = 8192 - baseLength - '&custom_order_id='.length - 100;
  assert.doesNotThrow(() => buildAfdianUrl({ ...input, remark: 'a'.repeat(max) }));
  assert.doesNotThrow(() => buildAfdianUrl({ ...input, remark: 'a'.repeat(max), reference: 'f'.repeat(100) }));
  assert.throws(() => buildAfdianUrl({ ...input, remark: 'a'.repeat(max + 1) }), /赞助内容过长/);
});

test('author UID is a validated 32-character hex identifier', () => {
  assert.equal(validateAfdianId(UID.toUpperCase()), UID);
  for (const input of ['https://afdian.com/a/author', 'author', UID + '0', 'z'.repeat(32), null]) {
    assert.throws(() => validateAfdianId(input), TypeError);
  }
});

test('configuration roundtrip retains the public whitelist without a restaurant label', () => {
  const normalized = normalizeConfig(config);
  assert.deepEqual(decodeConfig(encodeConfig(config)), normalized);
  assert.deepEqual(Object.keys(normalized), ['v', 'repo', 'storeCode', 'beType', 'orderType', 'afdianId']);
  assert.equal(normalized.orderType, 1);
  assert.equal(normalizeConfig({ ...config, beType: 5 }).beType, 5);
  for (const invalid of [{ ...config, token: 'secret' }, { ...config, auth: {} }, { ...config, v: 2 }, { ...config, beType: 2 }, { ...config, orderType: 2 }, { ...config, storeCode: '<script>' }]) {
    assert.throws(() => encodeConfig(invalid), TypeError);
  }
  for (const storeName of ['附近餐厅', '', null, undefined]) {
    assert.throws(() => normalizeConfig({ ...config, storeName }), /不允许的字段：storeName/);
    assert.throws(() => encodeConfig({ ...config, storeName }), /不允许的字段：storeName/);
  }
});

test('short parameters roundtrip both identities, pickup modes and notification settings', () => {
  for (const identity of [{ repo: 'octocat/hello-world' }, { sponsorType: 'person', name: '小林 🍔' }]) {
    for (const beType of [1, 5]) for (const notifications of [{}, { notifications: true }]) {
      const input = { ...identity, storeCode: '100001', beType,
        afdianId: UID, ...notifications };
      const encoded = encodeConfig(input);
      const params = new URLSearchParams(encoded);
      assert.match(encoded, /^(?:p|u)=/);
      assert.deepEqual(Object.fromEntries(params), {
        ...(identity.name ? { u: identity.name } : { p: identity.repo }), m: '100001', a: UID,
        ...(beType === 5 ? { t: '1' } : {}), h: notifications.notifications ? '1' : '0',
      });
      assert.equal(params.has('v'), false);
      assert.equal(params.has('t'), beType === 5);
      assert.equal(params.has('h'), true);
      assert.equal(params.has('i'), false);
      assert.equal(params.has('b'), false);
      assert.equal(params.has('pv'), false);
      assert.equal(params.has('storeName'), false);
      assert.deepEqual(decodeConfig(encoded), normalizeConfig(input));
    }
  }
  assert.equal(encodeConfig(config), `p=octocat%2Fhello-world&m=100001&a=${UID}&h=0`);
  assert.equal(encodeConfig({ ...config, beType: 5, notifications: true }), `p=octocat%2Fhello-world&m=100001&a=${UID}&t=1&h=1`);
  assert.equal(encodeConfig({ ...config, notifications: true }), `p=octocat%2Fhello-world&m=100001&a=${UID}&h=1`);
  const minimal = { repo: 'o/r', storeCode: '0001', beType: 1, afdianId: '0'.repeat(32) };
  assert.equal(encodeConfig(minimal), `p=o%2Fr&m=0001&a=${'0'.repeat(32)}&h=0`);
  assert.equal(decodeConfig(encodeConfig(minimal)).storeCode, '0001');
});

test('short names escape Chinese text and URL punctuation without turning them into extra parameters', () => {
  const name = '小林 🍔 & + = ? # / % 「」';
  const personal = { sponsorType: 'person', name, storeCode: '100001', beType: 1, afdianId: UID };
  const encoded = encodeConfig(personal);
  assert.ok(encoded.includes('%E5%B0%8F%E6%9E%97'));
  for (const escaped of ['%26', '%2B', '%3D', '%3F', '%23', '%2F', '%25']) assert.ok(encoded.includes(escaped));
  assert.equal(new URLSearchParams(encoded).get('u'), name);
  assert.deepEqual(decodeConfig(encoded), normalizeConfig(personal));
  const url = new URL(createShareUrl('https://example.com/', personal));
  assert.equal(url.pathname, '/gift');
  assert.equal(url.search, `?${encoded}`);
  assert.equal(decodeConfig(url.search.slice(1)).name, name);
});

test('short query decoder rejects missing notification flags, contradictions and removed fields', () => {
  const valid = `p=octocat%2Fhello-world&m=100001&a=${UID}&h=0`;
  const changed = (key, value) => {
    const params = new URLSearchParams(valid);
    if (value === undefined) params.delete(key);
    else params.set(key, value);
    return params.toString();
  };
  const enabled = changed('h', undefined);
  const invalid = [
    ...['p', 'm', 'a', 'h'].map(key => changed(key, undefined)),
    ...['', '0', '01', '00', '-1', '2', '5', 'true', '1.0', ' 1'].map(t => changed('t', t)),
    ...['', '2', '00', '01', 'false', 'true', '0.0', '1.0', ' 0', ' 1'].map(h => changed('h', h)),
    `${valid}&i=${'a'.repeat(32)}`, `${valid}&i=`,
    `${changed('h', '1')}&i=${'a'.repeat(32)}`, `${changed('h', '1')}&i=`,
    ...['', 'short', 'a'.repeat(32), 'A'.repeat(32), `${'a'.repeat(32)}/secret`].map(i => `${enabled}&i=${i}`),
    `${valid}&u=小林`, changed('p', ''), changed('p', 'https://evil.example/o/r'),
    `${changed('p', undefined)}&u=`, changed('m', '../store'), changed('a', 'short'),
    ...['p', 'm', 'a', 'h'].map(key => `${valid}&${key}=duplicate`),
    `${valid}&t=1&t=1`, `${enabled}&i=${'a'.repeat(32)}&i=${'a'.repeat(32)}`,
    `${valid}&%70=o%2Fr`, `${valid}&%68=0`,
    ...['v', 'repo', 'name', 'store', 'pickup', 'afdian', 'hook', 'be', 'integration', 'notifications', 'storeName', 'sponsorType', 'token', 'webhookUrl', 'managementToken', 'readToken', '__proto__']
      .map(key => `${valid}&${key}=private`),
    `${valid}&v=3`, `?${valid}`, `${valid}&`, `${valid}&&b=B001`, `${valid}&b`,
  ];
  for (const value of invalid) assert.throws(() => decodeConfig(value), TypeError, value);
});

test('query parameters reject malformed escapes, invalid UTF-8, controls and oversized values', () => {
  const suffix = `&m=100001&a=${UID}&h=0`;
  for (const name of ['%', '%0', '%GG', '%FF', '%C0%AF', '%E4%B8', '%ED%A0%80', '%F4%90%80%80', '%00', '%0A', '%7F']) {
    assert.throws(() => decodeConfig(`u=${name}${suffix}`), TypeError, name);
  }
  assert.throws(() => decodeConfig(`u=${'a'.repeat(4096)}${suffix}`), TypeError);
  assert.throws(() => decodeConfig(`u=valid${suffix}&bad%=1`), TypeError);
});

test('personal sponsorship links preserve a validated name without a repository', () => {
  const { repo: _repo, ...restaurant } = config;
  const personal = { ...restaurant, sponsorType: 'person', name: ' 小林 🍔 ' };
  const decoded = decodeConfig(encodeConfig(personal));
  assert.equal(decoded.sponsorType, 'person');
  assert.equal(decoded.name, '小林 🍔');
  assert.equal(Object.hasOwn(decoded, 'repo'), false);
  assert.equal(decoded.afdianId, UID);
  assert.equal(validateSponsorName('  Lin  '), 'Lin');
  assert.equal(encodeConfig({ ...config, sponsorType: 'project' }), encodeConfig(config));
  for (const name of ['', '  ', 'a'.repeat(81), '名字\n换行', '名字\0', null, 42]) {
    assert.throws(() => encodeConfig({ ...personal, name }), TypeError);
  }
  for (const invalid of [
    { ...personal, repo: config.repo }, { ...config, name: '不应包含名字' },
    { ...config, sponsorType: 'unknown' }, { ...personal, webhookUrl: 'private' },
  ]) assert.throws(() => encodeConfig(invalid), TypeError);
});

test('decoder accepts only short query parameters and rejects removed formats', () => {
  const oldV1 = Buffer.from(JSON.stringify({ v: 1, ...config, storeName: '旧餐厅名', orderType: 1 })).toString('base64url');
  const oldV2 = Buffer.from(JSON.stringify({ v: 2, r: 'o/r', s: '100001', t: 0, a: UID })).toString('base64url');
  const longParameters = `repo=octocat%2Fhello-world&store=100001&pickup=0&afdian=${UID}&hook=0`;
  for (const value of [oldV1, oldV1 + '=', oldV2, longParameters, `v=3&${longParameters}`,
    ...['1', '2', '3', ''].map(version => `v=${version}&${encodeConfig(config)}`),
  ]) assert.throws(() => decodeConfig(value), TypeError, value);
  for (const value of [null, undefined, {}, [], false, 42, '', '#', 'p', 'a'.repeat(4097)]) {
    assert.throws(() => decodeConfig(value), TypeError);
  }
});

test('notifications use only an explicit public flag and reject removed integration fields', () => {
  const shared = decodeConfig(encodeConfig({ ...config, notifications: true }));
  assert.equal(shared.notifications, true);
  assert.equal(Object.hasOwn(shared, 'integrationId'), false);
  assert.equal(hasPaymentNotifications(shared), true);
  for (const disabled of [null, undefined, config, normalizeConfig(config), { notifications: false }]) {
    assert.equal(hasPaymentNotifications(disabled), false);
  }
  assert.equal(encodeConfig({ ...config, notifications: undefined }), encodeConfig(config));
  for (const notifications of [false, null, 0, 1, 'true', '1', {}, []]) {
    assert.throws(() => normalizeConfig({ ...config, notifications }), TypeError);
  }
  for (const integrationId of [undefined, '', null, 'a'.repeat(32)]) {
    assert.throws(() => normalizeConfig({ ...config, integrationId }), /不允许的字段：integrationId/);
    assert.throws(() => normalizeConfig({ ...config, notifications: true, integrationId }), /不允许的字段：integrationId/);
  }
  for (const field of ['webhookUrl', 'managementToken', 'readToken', 'secret']) {
    assert.throws(() => encodeConfig({ ...config, notifications: true, [field]: 'private' }), TypeError);
  }
});

test('share URL points at the gift page and keeps nothing from the current one', () => {
  const url = new URL(createShareUrl('https://example.com/project/?token=SECRET#/old', config));
  assert.equal(url.pathname, '/gift');
  assert.match(url.search, /^\?p=/);
  assert.equal(url.hash, '');
  assert.deepEqual(decodeConfig(url.search.slice(1)), normalizeConfig(config));
  assert.ok(!url.href.includes('SECRET'));
  assert.equal(new URL(createShareUrl('https://example.com/', config, { preview: true })).pathname, '/preview/gift');
  assert.throws(() => createShareUrl('javascript:alert(1)', config));
  assert.throws(() => createShareUrl('https://user:password@example.com/', config));
  assert.match(createShareUrl('http://localhost:5173/', config), /^http:\/\/localhost:5173\/gift\?/);
});

test('share URL carries the preview language in its path, never in its query', () => {
  const url = new URL(createShareUrl('https://example.com/', config, { language: 'yue-HK' }));
  assert.equal(url.pathname, '/gift/yue-hk');
  assert.deepEqual(decodeConfig(url.search.slice(1)), normalizeConfig(config));
  for (const language of ['zh-CN', 'nonexistent', '', undefined]) {
    assert.equal(new URL(createShareUrl('https://example.com/', config, { language })).pathname, '/gift');
  }
});

test('share links omit BE codes and preview revisions in both live and preview routes', () => {
  for (const preview of [false, true]) for (const language of ['zh-CN', 'carousel']) {
    const url = new URL(createShareUrl('https://example.com/?b=B001&pv=3', config, { preview, language }));
    assert.equal(url.searchParams.has('b'), false);
    assert.equal(url.searchParams.has('pv'), false);
    assert.equal(url.search.slice(1), encodeConfig(config));
    assert.deepEqual(decodeConfig(url.search.slice(1)), normalizeConfig(config));
  }
  assert.throws(() => normalizeConfig({ ...config, beCode: 'B001' }), /不允许的字段：beCode/);
});

test('old share links ignore retired BE codes and preview revisions without weakening active validation', () => {
  for (const identity of [{ repo: 'octocat/hello-world' }, { sponsorType: 'person', name: '小林 🍔' }]) {
    for (const beType of [1, 5]) for (const notifications of [{}, { notifications: true }]) {
      const current = { ...identity, storeCode: '100001', afdianId: UID, beType, ...notifications };
      const query = encodeConfig(current);
      for (const suffix of ['b=B001', 'pv=3', 'b=B001&pv=3', 'b=&pv=', 'b=..%2Fbe&pv=old', 'b=B001&b=B002&pv=1&pv=3', '%62=B001&%70v=3']) {
        const decoded = decodeConfig(`${query}&${suffix}`);
        assert.deepEqual(decoded, normalizeConfig(current));
        assert.equal(encodeConfig(decoded), query);
        assert.equal(Object.hasOwn(decoded, 'beCode'), false);
      }
    }
  }
  const query = encodeConfig(config);
  for (const invalid of [query.replace('&h=0', ''), `${query}&m=other`, `${query}&token=private`, `${query}&b=%FF`]) {
    assert.throws(() => decodeConfig(`${invalid}&b=B001&pv=3`), TypeError);
  }
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

test('badge markup preserves its English default and safely embeds translated labels', () => {
  const share = 'https://example.com/#/gift/test';
  const badge = 'https://example.com/assets/badge.svg';
  assert.deepEqual(createBadgeMarkup(share, badge), {
    html: `<a href="${share}"><img src="${badge}" alt="Buy me a Big Mac" /></a>`,
    markdown: `[![Buy me a Big Mac](<${badge}>)](<${share}>)`,
  });
  const localized = createBadgeMarkup(share, badge, '請我吃份大麥克');
  assert.ok(localized.html.includes('alt="請我吃份大麥克"'));
  assert.ok(localized.markdown.startsWith('[![請我吃份大麥克]'));
  const escaped = createBadgeMarkup(share, badge, '请我 [吃饭] <img src=x onerror="bad"> \\');
  assert.ok(escaped.html.includes('&lt;img src=x onerror=&quot;bad&quot;&gt;'));
  assert.ok(escaped.markdown.includes('\\[吃饭\\]'));
  assert.ok(escaped.markdown.includes('\\<img'));
  assert.equal(escaped.html.includes('<img src=x'), false);
  for (const label of ['', ' ', null, 'a'.repeat(161), '请我\n吃饭']) {
    assert.throws(() => createBadgeMarkup(share, badge, label), TypeError);
  }
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
