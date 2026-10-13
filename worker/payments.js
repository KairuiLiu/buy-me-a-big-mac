// Afdian signs out_trade_no + user_id + plan_id + total_amount only. Its RSA
// signature does NOT bind custom_order_id, status or the recipient. The universal
// webhook correlates notifications by that unsigned reference and amount; it
// reports a notification, never independently verified payment or recipient proof.
// Source: https://afdian.com/p/9c65d9cc617011ed81c352540025c377
const AFDIAN_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwwdaCg1Bt+UKZKs0R54y
lYnuANma49IpgoOwNmk3a0rhg/PQuhUJ0EOZSowIC44l0K3+fqGns3Ygi4AfmEfS
4EKbdk1ahSxu7Zkp2rHMt+R9GarQFQkwSS/5x1dYiHNVMiR8oIXDgjmvxuNes2Cr
8fw9dEF0xNBKdkKgG2qAawcN1nZrdyaKWtPVT9m2Hl0ddOO9thZmVLFOb9NVzgYf
jEgI+KWX6aY19Ka/ghv/L4t1IXmz9pctablN5S0CRWpJW3Cn0k6zSXgjVdKm4uN7
jRlgSRaf/Ind46vMCm3N2sgwxu/g3bnooW+db0iLo13zzuvyn727Q3UDQ0MmZcEW
MQIDAQAB
-----END PUBLIC KEY-----`;

const TTL_MS = 300_000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_AMOUNT_CENTS = 10_000_000;
const DASHBOARD_TEST_ORDER = {
  out_trade_no: '202106232138371083454010626',
  user_id: 'adf397fe8374811eaacee52540025c377',
  plan_id: 'a45353328af911eb973052540025c377',
  total_amount: '5.00', status: 2,
};
const PUBLIC_ROUTES = new Set([
  '/api/payments/intents', '/api/payments/status',
]);
const LOCAL_LIMIT = { window: -1, count: 0 };
const encoder = new TextEncoder();
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
let officialKey;

class PaymentError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function reply(status, data) {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    ...(status === 429 ? { 'Retry-After': '60' } : {}),
  } });
}

function fields(input, allowed) {
  if (!object(input) || Object.keys(input).some(key => !allowed.includes(key))) {
    throw new PaymentError(400, '付款状态请求参数无效');
  }
  return input;
}

function hex(value, length) {
  if (typeof value !== 'string' || value.length !== length || !/^[0-9a-f]+$/.test(value)) {
    throw new PaymentError(400, '付款状态凭据格式无效');
  }
  return value;
}

function afdianId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{32}$/i.test(value)) throw new PaymentError(400, '爱发电 ID 格式无效');
  return value.toLowerCase();
}

function amount(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_AMOUNT_CENTS) throw new PaymentError(400, '建议金额无效');
  return value;
}

function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), value => value.toString(16).padStart(2, '0')).join('');
}

async function digest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
}

function equalHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== 64 || b.length !== 64) return false;
  let different = 0;
  for (let i = 0; i < 64; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}

function database(env) {
  if (typeof env.PAYMENTS_DB?.prepare !== 'function' || typeof env.PAYMENTS_DB?.batch !== 'function') {
    throw new PaymentError(503, '付款通知服务尚未配置完成');
  }
  return env.PAYMENTS_DB;
}

async function rateLimit(request, env, webhook) {
  if (typeof env.PAYMENT_RATE_LIMITER?.limit === 'function') {
    const ip = request.headers.get('CF-Connecting-IP');
    if (!ip || ip.length > 64 || !/^[0-9a-fA-F:.]+$/.test(ip)) throw new PaymentError(503, '付款通知服务暂时不可用');
    let result;
    try { result = await env.PAYMENT_RATE_LIMITER.limit({ key: `${webhook ? 'webhook' : 'browser'}:${ip}` }); }
    catch { throw new PaymentError(503, '付款通知服务暂时不可用'); }
    if (result?.success !== true) throw new PaymentError(429, '请求过于频繁，请稍后重试');
    return;
  }
  if (new URL(request.url).hostname !== '127.0.0.1') throw new PaymentError(503, '付款通知服务尚未配置完成');
  const window = Math.floor(Date.now() / 60_000);
  if (LOCAL_LIMIT.window !== window) Object.assign(LOCAL_LIMIT, { window, count: 0 });
  if (++LOCAL_LIMIT.count > 60) throw new PaymentError(429, '请求过于频繁，请稍后重试');
}

function untilAborted(promise, signal) {
  if (signal.aborted) { void promise.catch(() => {}); return Promise.reject(signal.reason); }
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

async function readJson(request, signal) {
  const length = request.headers.get('Content-Length');
  if (length !== null && !/^\d+$/.test(length)) throw new PaymentError(400, '请求长度无效');
  if (length !== null && Number(length) > MAX_BODY_BYTES) throw new PaymentError(413, '请求正文过大');
  if (!request.body) throw new PaymentError(400, '请求正文不能为空');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let total = 0;
  let value = '';
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      const chunk = await untilAborted(reader.read(), signal);
      if (signal.aborted) throw signal.reason;
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_BODY_BYTES) throw new PaymentError(413, '请求正文过大');
      try { value += decoder.decode(chunk.value, { stream: true }); }
      catch { throw new PaymentError(400, '请求必须包含有效 JSON'); }
    }
    try { return JSON.parse(value + decoder.decode()); }
    catch { throw new PaymentError(400, '请求必须包含有效 JSON'); }
  } finally { signal.removeEventListener('abort', cancel); cancel(); }
}

function signedText(value, max, empty = false) {
  if (typeof value !== 'string' || (!empty && value.length === 0) || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new PaymentError(400, '付款通知格式无效');
  }
  return value;
}

function dashboardTestDifferences(input) {
  const order = input.data.order;
  // Only field names may leave this function: never log or return a callback's
  // values, signature, or the secret URL while diagnosing platform test data.
  return [
    ...(input.ec === 200 ? [] : ['ec']),
    ...Object.entries(DASHBOARD_TEST_ORDER).filter(([key, value]) => order[key] !== value).map(([key]) => `order.${key}`),
    ...(Object.hasOwn(order, 'custom_order_id') && order.custom_order_id !== '' ? ['order.custom_order_id'] : []),
  ];
}

function dashboardTest(input) {
  if (!object(input) || !object(input.data) || input.data.type !== 'order' || !object(input.data.order)) return false;
  // The dashboard's documented fixture has a 33-character payer ID:
  // https://guide.afdian.com/creator/developer
  // Actual dashboard tests also attach a signature, verified separately below.
  // Recognize only this fixed sample, never an arbitrary unsigned order.
  return dashboardTestDifferences(input).length === 0;
}

function signatureText(value) {
  const signature = signedText(value, 2048);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature) || signature.length % 4 !== 0) throw new PaymentError(403, '付款通知签名无效');
  return signature;
}

function signedOrder(input) {
  if (!object(input) || !object(input.data) || input.data.type !== 'order' || !object(input.data.order)) throw new PaymentError(400, '付款通知格式无效');
  const order = input.data.order;
  const trade = signedText(order.out_trade_no, 128);
  const payer = signedText(order.user_id, 128);
  const plan = signedText(order.plan_id, 128, true);
  if (!/^\d{1,64}$/.test(trade) || !/^[0-9a-f]{32}$/i.test(payer) || (plan !== '' && !/^[0-9a-f]{32}$/i.test(plan))) {
    throw new PaymentError(400, `付款通知订单标识格式无效（不匹配的测试字段：${dashboardTestDifferences(input).join('、')}）`);
  }
  // Keep the exact original decimal representation until after RSA verification.
  const total = signedText(order.total_amount, 24);
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(total)) throw new PaymentError(400, '付款通知金额格式无效');
  const signature = signatureText(input.data.sign);
  return { order, trade, message: trade + payer + plan + total, signature, total };
}

async function importKey(pem) {
  const encoded = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '');
  return crypto.subtle.importKey('spki', Uint8Array.from(atob(encoded), ch => ch.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

async function verifySignature(signed, publicKey) {
  const key = publicKey === AFDIAN_PUBLIC_KEY ? await (officialKey ||= importKey(publicKey)) : await importKey(publicKey);
  let valid = false;
  try {
    valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key,
      Uint8Array.from(atob(signed.signature), ch => ch.charCodeAt(0)), encoder.encode(signed.message));
  } catch { /* Invalid signatures never expose cryptography diagnostics. */ }
  if (!valid) throw new PaymentError(403, '付款通知签名无效');
}

function signedAmount(total) {
  const [whole, fraction = ''] = total.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

async function webhookOperation(request, db, now, publicKey, signal) {
  const input = await readJson(request, signal);
  if (signal.aborted) throw signal.reason;
  if (dashboardTest(input)) {
    if (Object.hasOwn(input.data, 'sign')) {
      const order = input.data.order;
      await verifySignature({
        message: order.out_trade_no + order.user_id + order.plan_id + order.total_amount,
        signature: signatureText(input.data.sign),
      }, publicKey);
      if (signal.aborted) throw signal.reason;
    }
    // Connectivity only: this public sample cannot notify an intent or
    // consume a real order's replay key, even when its amount matches an intent.
    return reply(200, { ec: 200 });
  }
  const signed = signedOrder(input);
  await verifySignature(signed, publicKey);
  if (signal.aborted) throw signal.reason;
  const cents = signedAmount(signed.total);
  const candidate = typeof signed.order.custom_order_id === 'string' && /^[0-9a-f]{32}$/.test(signed.order.custom_order_id)
    && signed.order.status === 2 && cents > 0 && cents <= MAX_AMOUNT_CENTS ? signed.order.custom_order_id : null;
  const [orderHash, messageHash] = await Promise.all([digest(signed.trade), digest(signed.message)]);
  // D1 batch is transactional. Every authentic order is consumed globally, even
  // if its custom ID is missing/expired. A duplicate cannot retarget that order.
  // A second unique hash prevents re-segmenting the delimiter-free signed fields.
  // The conditional insert+update preserve the first notification's expiry.
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO payment_order_receipts (order_hash, signed_message_hash, intent_id, received_at)
      VALUES (?, ?, (SELECT id FROM payment_intents WHERE id = ?
        AND amount_cents = ? AND notified_at IS NULL AND expires_at > ?), ?)`)
      .bind(orderHash, messageHash, candidate, cents, now, now),
    db.prepare(`UPDATE payment_intents SET notified_at = ?, expires_at = ?, afdian_order_no = ?
      WHERE id = ? AND amount_cents = ? AND notified_at IS NULL AND expires_at > ?
        AND EXISTS (SELECT 1 FROM payment_order_receipts WHERE order_hash = ? AND intent_id = payment_intents.id)`)
      .bind(now, now + TTL_MS, signed.trade, candidate, cents, now, orderHash),
  ]);
  return reply(200, { ec: 200 });
}

async function browserOperation(request, db, pathname, now, signal) {
  const input = await readJson(request, signal);
  if (signal.aborted) throw signal.reason;
  if (pathname === '/api/payments/intents') {
    fields(input, ['afdianId', 'amountCents']);
    const creator = afdianId(input.afdianId);
    const cents = amount(input.amountCents);
    const intentId = randomHex(16);
    const readToken = randomHex(32);
    const expiresAt = now + TTL_MS;
    await db.prepare(`INSERT INTO payment_intents
      (id, afdian_id, amount_cents, read_token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(intentId, creator, cents, await digest(readToken), now, expiresAt).run();
    return reply(201, { data: { intentId, readToken, expiresAt } });
  }
  fields(input, ['intentId', 'readToken']);
  const id = hex(input.intentId, 32);
  const tokenHash = await digest(hex(input.readToken, 64));
  // Read from D1's primary by default. No replicas or KV negative-cache delay.
  const intent = await db.prepare('SELECT read_token_hash, amount_cents, notified_at, expires_at, afdian_order_no FROM payment_intents WHERE id = ? AND expires_at > ?').bind(id, now).first();
  if (!intent || !equalHash(tokenHash, intent.read_token_hash)) return reply(200, { data: { status: 'unknown' } });
  return reply(200, { data: intent.notified_at === null
    ? { status: 'pending', expiresAt: intent.expires_at }
    : { status: 'notified', amountCents: intent.amount_cents, receivedAt: intent.notified_at, expiresAt: intent.expires_at,
      ...(intent.afdian_order_no === null ? {} : { afdianOrderNo: intent.afdian_order_no }) } });
}

// Test-only seams are explicit imported-function arguments, never request or
// environment-controlled verification overrides.
export async function handlePayments(request, env = {}, { now = () => Date.now(), publicKey = AFDIAN_PUBLIC_KEY, timeoutMs = 10_000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(new PaymentError(499, '请求已取消'));
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) abort();
  const timer = setTimeout(() => controller.abort(new PaymentError(504, '付款通知服务响应超时')), timeoutMs);
  const url = new URL(request.url);
  const webhook = url.pathname === '/api/payments/webhook';
  try {
    if (url.search || (!webhook && !PUBLIC_ROUTES.has(url.pathname))) throw new PaymentError(404, '付款状态接口不存在');
    if (request.method !== 'POST') throw new PaymentError(405, '仅支持 POST 请求');
    if (!webhook) {
      const origin = request.headers.get('Origin');
      if ((origin !== null && origin !== url.origin) || ['cross-site', 'same-site'].includes(request.headers.get('Sec-Fetch-Site'))) throw new PaymentError(403, '请从本站发起请求');
    }
    if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('Content-Type') || '')) throw new PaymentError(415, '请求必须使用 application/json');
    await untilAborted(rateLimit(request, env, Boolean(webhook)), controller.signal);
    const db = database(env);
    const timestamp = now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('Invalid time');
    const operation = webhook
      ? webhookOperation(request, db, timestamp, publicKey, controller.signal)
      : browserOperation(request, db, url.pathname, timestamp, controller.signal);
    return await untilAborted(operation, controller.signal);
  } catch (error) {
    const failure = error instanceof PaymentError ? error : new PaymentError(503, '付款通知服务暂时不可用，请稍后重试');
    return reply(failure.status, webhook ? { ec: failure.status, em: failure.message } : { error: failure.message });
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
  }
}

// The five-minute visibility rule is enforced on every status read, independent
// of when scheduled physical deletion runs. Never remove replay tombstones here.
export async function cleanupPayments(env, now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid cleanup time');
  const result = await database(env).prepare(`DELETE FROM payment_intents WHERE id IN
    (SELECT id FROM payment_intents WHERE expires_at <= ? ORDER BY expires_at LIMIT 5000)`).bind(now).run();
  return { deleted: result.meta?.changes || 0 };
}
