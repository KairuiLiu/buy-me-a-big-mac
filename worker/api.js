import { McdClient, McdError } from './mcp-client.js';
import { normalizeMenu, normalizeQuote } from '../src/lib/domain.js';

const ROUTES = new Set(['/api/connect', '/api/stores', '/api/menu', '/api/quote']);
const MAX_BODY_BYTES = 16 * 1024;
const LOCAL_LIMIT = { window: 0, count: 0 };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function reply(status, data) {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    ...(status === 429 ? { 'Retry-After': '60' } : {}),
  } });
}

function fields(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new ApiError(400, '请求参数格式无效');
  return value;
}

function text(value, max = 160, optional = false) {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new ApiError(400, '请求文本格式无效');
  return value.trim();
}

function code(value, optional = false) {
  const result = text(value, 80, optional);
  if (result && !/^[A-Za-z0-9_.-]+$/.test(result)) throw new ApiError(400, '餐厅或餐品编码格式无效');
  return result;
}

function serviceType(value = 1) {
  if (value !== 1 && value !== 5) throw new ApiError(400, '仅支持到店自取或得来速');
  return value;
}

function config(value) {
  fields(value, ['storeCode', 'beCode', 'orderType', 'beType']);
  if (value.orderType !== undefined && value.orderType !== 1) throw new ApiError(400, '仅支持到店场景');
  return { storeCode: code(value.storeCode), beCode: code(value.beCode, true), orderType: 1, beType: serviceType(value.beType) };
}

function search(value) {
  fields(value, ['city', 'keyword', 'beType', 'latitude', 'longitude']);
  const beType = serviceType(value.beType);
  if (value.latitude !== undefined || value.longitude !== undefined) {
    if (value.city !== undefined || value.keyword !== undefined || typeof value.latitude !== 'number' || typeof value.longitude !== 'number' || !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude) || Math.abs(value.latitude) > 90 || Math.abs(value.longitude) > 180) {
      throw new ApiError(400, '请提供有效的经纬度');
    }
    return { beType, latitude: value.latitude, longitude: value.longitude };
  }
  return { beType, city: text(value.city, 80), keyword: text(value.keyword, 160) };
}

function cart(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) throw new ApiError(400, '请选择 1 至 30 种餐品');
  const seen = new Set();
  return value.map(item => {
    fields(item, ['productCode', 'quantity']);
    const productCode = code(item.productCode);
    if (seen.has(productCode)) throw new ApiError(400, '餐品不能重复提交');
    seen.add(productCode);
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) throw new ApiError(400, '每种餐品数量须为 1 至 20');
    return { productCode, quantity: item.quantity };
  });
}

function publicText(value, max, required = false) {
  if (typeof value !== 'string') {
    if (required) throw new Error('Invalid public label');
    return '';
  }
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/gu, ' ').trim().slice(0, max);
  if (required && !clean) throw new Error('Missing public label');
  return clean;
}

function upstreamCode(value, optional = false) {
  return code(Number.isSafeInteger(value) && value >= 0 ? String(value) : value == null && optional ? '' : value, optional);
}

function stores(raw) {
  if (!Array.isArray(raw) || raw.length > 200) throw new Error('Invalid stores');
  return raw.map(store => {
    if (!object(store)) throw new Error('Invalid store');
    return {
      storeCode: upstreamCode(store.storeCode), beCode: upstreamCode(store.beCode, true), storeName: publicText(store.storeName, 160, true),
      address: publicText(store.address, 500), distance: publicText(store.distance, 80),
      ...(typeof store.businessStatus === 'boolean' ? { businessStatus: store.businessStatus } : {}),
    };
  });
}

function checkedQuote(raw, items) {
  const quote = normalizeQuote(raw);
  const expected = new Map(items.map(item => [item.productCode, item.quantity]));
  const actual = new Map();
  for (const item of quote.items) actual.set(item.code, (actual.get(item.code) || 0) + item.quantity);
  if (actual.size !== expected.size || [...expected].some(([key, value]) => actual.get(key) !== value)) throw new Error('Quote does not match cart');
  return quote;
}

async function rateLimit(request, env) {
  if (typeof env.API_RATE_LIMITER?.limit === 'function') {
    // Cloudflare supplies this header at its edge; no user account identifier is stored.
    const key = request.headers.get('CF-Connecting-IP');
    if (!key || key.length > 64 || !/^[0-9a-fA-F:.]+$/.test(key)) throw new ApiError(503, '查询服务暂时不可用，请稍后重试');
    let limited;
    try { limited = await env.API_RATE_LIMITER.limit({ key }); }
    catch { throw new ApiError(503, '查询服务暂时不可用，请稍后重试'); }
    if (limited?.success !== true) throw new ApiError(429, '请求过于频繁，请稍后重试');
    return;
  }
  // Local development alone gets a bounded in-memory fallback. A production
  // deployment without the binding fails closed instead of exposing the token.
  if (new URL(request.url).hostname !== '127.0.0.1') throw new ApiError(503, '查询服务尚未配置完成');
  const window = Math.floor(Date.now() / 60_000);
  if (LOCAL_LIMIT.window !== window) Object.assign(LOCAL_LIMIT, { window, count: 0 });
  if (++LOCAL_LIMIT.count > 60) throw new ApiError(429, '请求过于频繁，请稍后重试');
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
  const declared = request.headers.get('Content-Length');
  if (declared !== null && !/^\d+$/.test(declared)) throw new ApiError(400, '请求长度无效');
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) throw new ApiError(413, '请求正文过大');
  if (!request.body) throw new ApiError(400, '请求正文不能为空');
  const reader = request.body.getReader();
  let total = 0;
  let value = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      const chunk = await untilAborted(reader.read(), signal);
      if (signal.aborted) throw signal.reason;
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_BODY_BYTES) throw new ApiError(413, '请求正文过大');
      try { value += decoder.decode(chunk.value, { stream: true }); }
      catch { throw new ApiError(400, '请求必须包含有效 JSON'); }
    }
    try { return JSON.parse(value + decoder.decode()); }
    catch { throw new ApiError(400, '请求必须包含有效 JSON'); }
  } finally { signal.removeEventListener('abort', cancel); cancel(); }
}

// Business routes are the only browser entrypoint. RPC, tools and credentials
// remain inside this module's request-scoped client, never in response payloads.
export async function handleApi(request, env = {}, { fetchImpl, timeoutMs = 30_000, clientFactory = (token, options) => new McdClient(token, options) } = {}) {
  let client;
  const controller = new AbortController();
  const aborted = () => controller.abort(new ApiError(499, '请求已取消'));
  request.signal.addEventListener('abort', aborted, { once: true });
  if (request.signal.aborted) aborted();
  const timer = setTimeout(() => controller.abort(new ApiError(504, '麦当劳服务响应超时，请稍后重试')), timeoutMs);
  const disconnected = () => client?.disconnect();
  controller.signal.addEventListener('abort', disconnected, { once: true });
  try {
    await untilAborted(rateLimit(request, env), controller.signal);
    const url = new URL(request.url);
    if (!ROUTES.has(url.pathname) || url.search) throw new ApiError(404, '查询接口不存在');
    if (request.method !== 'POST') throw new ApiError(405, '仅支持 POST 请求');
    const origin = request.headers.get('Origin');
    if ((origin !== null && origin !== url.origin) || ['cross-site', 'same-site'].includes(request.headers.get('Sec-Fetch-Site'))) throw new ApiError(403, '请从本站发起查询');
    if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('Content-Type') || '')) throw new ApiError(415, '请求必须使用 application/json');
    const input = await readJson(request, controller.signal);
    let operation;
    if (url.pathname === '/api/connect') { fields(input, []); operation = async () => { await client.connect(); return { ok: true }; }; }
    else if (url.pathname === '/api/stores') { const args = search(input); operation = async () => stores(await client.searchStores(args)); }
    else if (url.pathname === '/api/menu') {
      fields(input, ['config']); const scene = config(input.config);
      operation = async () => normalizeMenu(await client.getMenu(scene));
    } else {
      fields(input, ['config', 'items']); const scene = config(input.config); const items = cart(input.items);
      operation = async () => checkedQuote(await client.calculate(scene, items), items);
    }
    if (typeof env.MCD_TOKEN !== 'string' || !env.MCD_TOKEN || env.MCD_TOKEN.length > 8192 || /[^\x21-\x7e]/.test(env.MCD_TOKEN)) throw new ApiError(503, '查询服务尚未配置完成');
    client = clientFactory(env.MCD_TOKEN, { ...(fetchImpl ? { fetchImpl } : {}), timeoutMs: Math.min(timeoutMs, 20_000) });
    let data;
    try { data = await untilAborted(Promise.resolve().then(operation), controller.signal); }
    catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      // Upstream diagnostics can contain account metadata or echoed credentials.
      // Only known categories are translated to our fixed public messages.
      if (error instanceof McdError && error.code === 'STORE_UNAVAILABLE') {
        throw new ApiError(409, '这家参考餐厅可能已关闭或不在营业时间，暂时无法读取菜单。请在营业时间再试，或联系作者更换参考餐厅。');
      }
      if (error instanceof McdError && error.code === 'TIMEOUT') throw new ApiError(504, '麦当劳服务响应超时，请稍后重试');
      throw new ApiError(502, '麦当劳暂时无法完成查询，请稍后重试');
    }
    // A successful upstream result must not accidentally echo the service credential.
    if (JSON.stringify(data).includes(env.MCD_TOKEN)) throw new ApiError(502, '麦当劳暂时无法完成查询，请稍后重试');
    return reply(200, { data });
  } catch (error) {
    const failure = error instanceof ApiError ? error : new ApiError(502, '查询服务暂时不可用，请稍后重试');
    return reply(failure.status, { error: failure.message });
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', aborted);
    controller.signal.removeEventListener('abort', disconnected);
    client?.disconnect();
  }
}
