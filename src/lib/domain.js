/** Pure domain helpers. No credentials, storage, network calls, or packages. */
import { giftPath } from './routes.js';
import { validateStripePaymentLink } from './stripe.js';

const MAX_CENTS = 3_000_000;
// An application transport guard, not an Afdian message character limit.
const MAX_AFDIAN_URL_LENGTH = 8192;
const MAX_CONFIG_BYTES = 4096;
const CONFIG_KEYS = new Set(['v', 'sponsorType', 'name', 'repo', 'storeCode', 'beType', 'orderType', 'afdianId', 'notifications', 'paymentProvider', 'stripePaymentLink', 'stripeReturn']);
const QUERY_CONFIG_KEYS = new Set(['p', 'u', 'm', 'a', 's', 't', 'h', 'r']);
const CONTROL = /[\u0000-\u001f\u007f]/;

function fail(message) { throw new TypeError(message); }

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label}格式无效`);
  return value;
}

function text(value, label, maxLength = 160, allowEmpty = false) {
  if (typeof value !== 'string' || CONTROL.test(value)) fail(`${label}格式无效`);
  const result = value.trim();
  if ((!allowEmpty && !result) || result.length > maxLength) fail(`${label}长度无效`);
  return result;
}

function remarkText(value) {
  if (typeof value !== 'string') fail('赞助留言格式无效');
  const result = value.replace(/\r\n/g, '\n').trim();
  // Preserve line breaks, but reject tabs, lone CR, NUL and other controls.
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(value.replace(/\r\n/g, '\n'))) fail('赞助留言含不支持的控制字符');
  if (!result) fail('赞助留言长度无效');
  return result;
}

function code(value, label) {
  const result = text(value, label, 80);
  if (!/^[A-Za-z0-9_.-]+$/.test(result)) fail(`${label}只能包含字母、数字、点、短横线或下划线`);
  return result;
}

function cents(value, label, allowZero = true) {
  // calculate-price returns JSON numbers in cents. Do not coerce empty strings,
  // currency strings, booleans, null, fractional cents, or malformed responses.
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > MAX_CENTS) {
    fail(`${label}必须是${allowZero ? '0' : '1'}到${MAX_CENTS}之间的整数分`);
  }
  return value;
}

function yuanToCents(value, label) {
  if (typeof value !== 'string' && typeof value !== 'number') fail(`${label}必须是十进制元金额`);
  const source = String(value);
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(source)) fail(`${label}必须是最多两位小数的非负元金额`);
  const [whole, fraction = ''] = source.split('.');
  return cents(Number(whole) * 100 + Number(fraction.padEnd(2, '0')), label);
}

function payload(raw, label) {
  const outer = record(raw, label);
  if ('success' in outer && outer.success !== true) fail(`${label}请求未成功`);
  if ('code' in outer && outer.code !== 200) fail(`${label}返回错误状态`);
  return record(Object.hasOwn(outer, 'data') ? outer.data : outer, label);
}

export function parseGithubRepo(input) {
  let source = text(input, 'GitHub 仓库', 512);
  if (/^(?:https:\/\/)?(?:www\.)?github\.com\//i.test(source) || /^https:\/\//i.test(source)) {
    const match = /^(?:https:\/\/)?(?:www\.)?github\.com\/([^?#]+)$/i.exec(source);
    if (!match) fail('请使用 github.com 仓库链接');
    source = match[1].replace(/\/$/, '');
  }
  source = source.replace(/\.git$/, '');
  const parts = source.split('/');
  if (parts.length !== 2) fail('仓库格式应为 owner/repo');
  const [owner, repository] = parts;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner) || owner.includes('--')) {
    fail('GitHub 用户或组织名无效');
  }
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(repository) || repository === '.' || repository === '..') {
    fail('GitHub 仓库名无效');
  }
  return `${owner}/${repository}`;
}

export function validateAfdianId(input) {
  const id = text(input, '爱发电作者 UID', 32);
  if (!/^[a-fA-F0-9]{32}$/.test(id)) fail('爱发电作者 UID 必须是32位十六进制字符，不能使用主页链接');
  return id.toLowerCase();
}

export function validateSponsorName(input) {
  return text(input, '您的名字', 80);
}

export function normalizeConfig(input) {
  const value = record(input, '分享配置');
  for (const key of Object.keys(value)) {
    if (!CONFIG_KEYS.has(key)) fail(`分享配置包含不允许的字段：${key}`);
  }
  if (value.v !== undefined && value.v !== 1) fail('不支持的分享配置版本');
  if (value.orderType !== undefined && value.orderType !== 1) fail('仅支持到店场景');
  if (value.beType !== 1 && value.beType !== 5) fail('取餐方式必须是到店自取或得来速');
  if (value.paymentProvider !== undefined && value.paymentProvider !== 'afdian' && value.paymentProvider !== 'stripe') fail('付款方式无效');
  const afdian = value.afdianId !== undefined;
  const stripe = value.stripePaymentLink !== undefined;
  if (!afdian && !stripe) fail('请至少填写一种收款方式');
  if ((value.paymentProvider === 'stripe' && !stripe) || (value.paymentProvider === 'afdian' && !afdian)) fail('付款方式与收款信息不一致');
  if (value.notifications !== undefined && value.notifications !== true) fail('付款通知开关无效');
  if (value.stripeReturn !== undefined && value.stripeReturn !== true) fail('Stripe 返回开关无效');
  if (!afdian && value.notifications !== undefined) fail('爱发电付款通知需要作者 UID');
  if (!stripe && value.stripeReturn !== undefined) fail('Stripe 返回需要支付链接');
  // Earlier local receipts used one exclusive provider and always returned
  // from Stripe. Keep that behavior while emitting only the new shared shape.
  const stripeReturn = value.stripeReturn === true || (value.paymentProvider === 'stripe' && value.stripeReturn === undefined);
  if (value.sponsorType !== undefined && value.sponsorType !== 'person' && value.sponsorType !== 'project') fail('赞助对象无效');
  const person = value.sponsorType === 'person';
  if (person && value.repo !== undefined) fail('个人赞助链接不应包含项目地址');
  if (!person && value.name !== undefined) fail('项目赞助链接不应包含个人名字');
  return {
    v: 1,
    ...(person ? { sponsorType: 'person', name: validateSponsorName(value.name) } : { repo: parseGithubRepo(value.repo) }),
    storeCode: code(value.storeCode, '门店编码'),
    beType: value.beType,
    orderType: 1,
    ...(afdian ? { afdianId: validateAfdianId(value.afdianId), ...(value.notifications === true ? { notifications: true } : {}) } : {}),
    ...(stripe ? { stripePaymentLink: validateStripePaymentLink(value.stripePaymentLink), ...(stripeReturn ? { stripeReturn: true } : {}) } : {}),
  };
}

export function hasPaymentNotifications(config) {
  return Boolean(config?.afdianId) && config?.notifications === true;
}

export function encodeConfig(input) {
  const config = normalizeConfig(input);
  const params = new URLSearchParams({
    ...(config.sponsorType === 'person' ? { u: config.name } : { p: config.repo }),
    m: config.storeCode,
    ...(config.afdianId ? { a: config.afdianId } : {}),
    ...(config.stripePaymentLink ? { s: config.stripePaymentLink.slice('https://buy.stripe.com/'.length) } : {}),
  });
  if (config.beType === 5) params.set('t', '1');
  if (config.afdianId) params.set('h', config.notifications ? '1' : '0');
  if (config.stripePaymentLink) params.set('r', config.stripeReturn ? '1' : '0');
  const encoded = params.toString();
  if (new TextEncoder().encode(encoded).length > MAX_CONFIG_BYTES) fail('分享配置过长');
  return encoded;
}

function readQueryParams(encoded) {
  if (new TextEncoder().encode(encoded).length > MAX_CONFIG_BYTES) fail('分享配置过长');
  if (encoded.startsWith('?') || encoded.split('&').some(part => !part || !part.includes('='))) fail('分享链接参数格式无效');
  // URLSearchParams repairs malformed escapes and invalid UTF-8. Validate the
  // original representation first so a damaged link cannot silently change.
  try { decodeURIComponent(encoded.replace(/\+/g, ' ')); }
  catch { fail('分享链接参数编码无效'); }
  const params = new URLSearchParams(encoded);
  // Retired parameters in already-shared links have no effect on the menu
  // scene or preview. Drop them before validating the active schema.
  params.delete('b');
  params.delete('pv');
  const seen = new Set();
  for (const [key] of params) {
    if (!QUERY_CONFIG_KEYS.has(key)) fail(`分享配置包含不允许的字段：${key}`);
    if (seen.has(key)) fail(`分享配置包含重复字段：${key}`);
    seen.add(key);
  }
  return params;
}

export function decodeConfig(encoded) {
  if (typeof encoded !== 'string' || !encoded || encoded.length > MAX_CONFIG_BYTES) {
    fail('分享链接中的配置编码无效');
  }
  const params = readQueryParams(encoded);
  const person = params.has('u');
  if (person === params.has('p')) fail('分享配置必须且只能包含一个赞助对象');
  if (params.has('t') && params.get('t') !== '1') fail('取餐方式编码无效');
  const stripe = params.has('s');
  const afdian = params.has('a');
  if (!stripe && !afdian) fail('分享配置必须包含至少一种付款方式');
  if (afdian ? !['0', '1'].includes(params.get('h')) : params.has('h')) fail('付款通知开关无效');
  if (stripe) {
    if (!/^[A-Za-z0-9_]{6,200}$/.test(params.get('s'))) fail('Stripe 支付链接标识无效');
    if (params.has('r') && !['0', '1'].includes(params.get('r'))) fail('Stripe 返回开关无效');
  } else if (params.has('r')) fail('Stripe 返回需要支付链接');
  return normalizeConfig({
    v: 1,
    ...(person ? { sponsorType: 'person', name: params.get('u') } : { repo: params.get('p') }),
    storeCode: params.get('m'),
    beType: params.has('t') ? 5 : 1,
    ...(afdian ? { afdianId: params.get('a'), ...(params.get('h') === '1' ? { notifications: true } : {}) } : {}),
    ...(stripe ? { stripePaymentLink: `https://buy.stripe.com/${params.get('s')}`,
      // Existing shared Stripe links predate r and always enabled the return.
      ...(params.get('r') !== '0' ? { stripeReturn: true } : {}) } : {}),
  });
}

function webUrl(input, label) {
  const source = text(input, label, 8192);
  let url;
  try { url = new URL(source); } catch { fail(`${label}不是有效网址`); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password) {
    fail(`${label}必须使用 HTTPS（本地预览除外）且不能包含登录信息`);
  }
  return url;
}

export function createShareUrl(siteUrl, config, { preview = false, language = '' } = {}) {
  // Only our public allowlisted configuration is copied into the share link;
  // whatever path, query or fragment the current page carries is dropped.
  const url = new URL(giftPath(preview, language), webUrl(siteUrl, '站点网址'));
  url.search = encodeConfig(config);
  return url.href;
}

export function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export function createBadgeMarkup(shareUrl, badgeUrl, altText = 'Buy me a Big Mac') {
  const share = webUrl(shareUrl, '分享网址').href;
  const badge = webUrl(badgeUrl, '徽章网址').href;
  const label = text(altText, '徽章文字', 160);
  const markdownLabel = label.replace(/[\\[\]<>]/g, '\\$&');
  const markdownUrl = value => value.replace(/\(/g, '%28').replace(/\)/g, '%29');
  return {
    html: `<a href="${escapeHTML(share)}"><img src="${escapeHTML(badge)}" alt="${escapeHTML(label)}" /></a>`,
    markdown: `[![${markdownLabel}](<${markdownUrl(badge)}>)](<${markdownUrl(share)}>)`,
  };
}

export function formatMoney(amountCents) {
  const amount = cents(amountCents, '金额');
  return `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`;
}

export function buildAfdianUrl({ afdianId, amountCents, remark, reference } = {}) {
  const url = new URL('https://afdian.com/order/create');
  url.searchParams.set('user_id', validateAfdianId(afdianId));
  url.searchParams.set('custom_price', formatMoney(cents(amountCents, '赞助金额', false)));
  url.searchParams.set('month', '1');
  url.searchParams.set('remark', remarkText(remark));
  if (reference !== undefined && reference !== '') {
    const ref = text(reference, '赞助标识', 100);
    if (!/^[A-Za-z0-9_-]+$/.test(ref)) fail('赞助标识格式无效');
    url.searchParams.set('custom_order_id', ref);
  }
  // Reserve room for the reference before an intent is created. Never truncate
  // the message or discover an oversized URL only after saving payment state.
  const referenceReserve = url.searchParams.has('custom_order_id') ? 0 : '&custom_order_id='.length + 100;
  if (url.href.length + referenceReserve > MAX_AFDIAN_URL_LENGTH) fail('赞助内容过长，请缩短留言或减少餐品后重试。');
  return url.href;
}

export function safeHttpsUrl(input) {
  if (typeof input !== 'string' || input.length > 2048 || CONTROL.test(input)) return '';
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function menuCategoryName(value) {
  // A display label must not prevent otherwise valid meals from loading.
  if (typeof value !== 'string') return '其他餐品';
  const name = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/gu, ' ').trim();
  return Array.from(name).slice(0, 100).join('') || '其他餐品';
}

export function normalizeMenu(raw) {
  const data = payload(raw, '菜单');
  const meals = record(data.meals, '餐品映射');
  if (!Array.isArray(data.categories)) fail('菜单分类必须是数组');
  if (Object.keys(meals).length > 2000 || data.categories.length > 200) fail('菜单数据过大');
  const products = Object.entries(meals).map(([productCode, rawProduct]) => {
    const product = record(rawProduct, '餐品');
    return {
      code: code(productCode, '餐品编码'),
      name: text(product.name, '餐品名称', 200),
      priceCents: yuanToCents(product.currentPrice, '餐品现价'),
      // Older menu responses may omit the strike-through price. In that case
      // the displayed reference equals the current menu price. The client
      // adds these integer-cent menu prices to estimate a sponsorship amount.
      originalPriceCents: yuanToCents(product.originalPrice ?? product.currentPrice, '餐品原价'),
      image: safeHttpsUrl(product.image),
      discountType: product.discountType == null ? null : text(product.discountType, '优惠类型', 100, true),
    };
  });
  const productCodes = new Set(products.map(product => product.code));
  const groupedCategories = new Map();
  for (const rawCategory of data.categories) {
    const category = record(rawCategory, '菜单分类');
    if (!Array.isArray(category.meals)) fail('分类餐品必须是数组');
    const codes = category.meals.map(rawMeal => {
      const mealCode = code(record(rawMeal, '分类餐品').code, '餐品编码');
      if (!productCodes.has(mealCode)) fail('菜单分类引用了缺失餐品');
      return mealCode;
    });
    const name = menuCategoryName(category.name);
    const groupedCodes = groupedCategories.get(name) || new Set();
    for (const mealCode of codes) groupedCodes.add(mealCode);
    groupedCategories.set(name, groupedCodes);
  }
  const categories = Array.from(groupedCategories, ([name, codes]) => ({ name, codes: [...codes] }));
  return { categories, products };
}

export function normalizeQuote(raw) {
  const data = payload(raw, '算价');
  const amountCents = cents(data.price, '实付金额', false);
  const originalCents = cents(data.originalPrice, '原始金额');
  const discountCents = cents(data.discount, '优惠金额');
  if (originalCents < amountCents || discountCents > originalCents) fail('算价金额关系无效');
  if (!Array.isArray(data.productList) || !data.productList.length || data.productList.length > 200) fail('算价缺少有效商品列表');
  const items = data.productList.map(rawItem => {
    const item = record(rawItem, '算价商品');
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) fail('商品数量无效');
    const itemAmount = cents(item.subtotal, '商品小计');
    const itemOriginal = cents(item.originalSubtotal, '商品原价小计');
    if (itemOriginal < itemAmount) fail('商品小计关系无效');
    return {
      code: code(item.productCode, '餐品编码'),
      name: text(item.productName, '餐品名称', 200),
      quantity: item.quantity,
      originalCents: itemOriginal,
      amountCents: itemAmount,
    };
  });
  return { amountCents, originalCents, discountCents, items };
}
