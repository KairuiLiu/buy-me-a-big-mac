/** Stripe Payment Links helpers. Public URLs only; no API keys or network calls. */
const PAYMENT_LINK = /^https:\/\/buy\.stripe\.com\/([A-Za-z0-9_]{6,200})$/;
const RECEIPT_ID = /^[0-9a-f]{32}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const RETURN_PARAMS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'session_id']);

export function validateStripePaymentLink(input) {
  if (typeof input !== 'string' || CONTROL.test(input)) throw new TypeError('Stripe Payment Link 格式无效');
  const value = input.trim();
  // Validate the original path instead of letting URL normalize escaping,
  // credentials, backslashes, dot segments, ports or lookalike host names.
  if (!PAYMENT_LINK.test(value)) throw new TypeError('请使用 https://buy.stripe.com/ 开头的完整 Payment Link, 不要附加参数');
  return value;
}

export function buildStripePaymentUrl({ paymentLink, amountCents, receiptId } = {}) {
  const url = new URL(validateStripePaymentLink(paymentLink));
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 3_000_000) {
    throw new TypeError('Stripe 赞助金额必须是 1 到 3000000 之间的整数分');
  }
  if (typeof receiptId !== 'string' || !RECEIPT_ID.test(receiptId)) throw new TypeError('本地付款记录标识无效');
  url.searchParams.set('prefilled_amount', String(amountCents));
  url.searchParams.set('utm_content', `bm_${receiptId}`);
  return url.href;
}

export function createStripeReturnUrl(siteOrigin) {
  if (typeof siteOrigin !== 'string' || CONTROL.test(siteOrigin)) throw new TypeError('站点网址格式无效');
  let site;
  try { site = new URL(siteOrigin.trim()); } catch { throw new TypeError('站点网址格式无效'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(site.hostname);
  if ((site.protocol !== 'https:' && !(site.protocol === 'http:' && local)) || site.username || site.password) {
    throw new TypeError('站点网址必须使用 HTTPS (本地预览除外), 且不能包含登录信息');
  }
  return new URL('/thanks/stripe', site.origin).href;
}

/** A return marker finds local context only; it never proves a payment succeeded. */
export function parseStripeReturnId(search) {
  if (typeof search !== 'string' || search.length > 8192 || CONTROL.test(search)) return null;
  const source = search.startsWith('?') ? search.slice(1) : search;
  if (!source || source.startsWith('?') || source.includes('#') || source.split('&').some(part => !part || !part.includes('='))) return null;
  // URLSearchParams repairs bad escapes/UTF-8; fail closed before it can do so.
  try { decodeURIComponent(source.replace(/\+/g, ' ')); } catch { return null; }
  const params = new URLSearchParams(source);
  for (const [key, value] of params) {
    if (!RETURN_PARAMS.has(key) || CONTROL.test(value)) return null;
  }
  const markers = params.getAll('utm_content');
  if (markers.length !== 1 || !/^bm_[0-9a-f]{32}$/.test(markers[0])) return null;
  return markers[0].slice(3);
}
