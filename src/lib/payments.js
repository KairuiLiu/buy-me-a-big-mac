import { validateAfdianId } from './domain.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
const token = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const timestamp = value => Number.isSafeInteger(value) && value >= 0;
const amount = value => Number.isSafeInteger(value) && value >= 1 && value <= 3_000_000;
const orderNo = value => typeof value === 'string' && value === value.trim() && /^[0-9]{1,64}$/.test(value);
const invalid = () => new Error('付款通知数据格式无效，请稍后重试');
const aborted = () => new Error('付款通知请求已取消');

/** A private URL is accepted only for the exact registered integration on this site. */
export function validateWebhookUrl(value, integrationId, origin = globalThis.location?.origin) {
  if (!id(integrationId) || typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) throw invalid();
  let site;
  let url;
  try { site = new URL(origin); url = new URL(value); } catch { throw invalid(); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(site.hostname);
  if ((site.protocol !== 'https:' && !(site.protocol === 'http:' && local))
    || url.origin !== site.origin || url.username || url.password || url.search || url.hash
    || !new RegExp(`^/api/payments/webhook/${integrationId}/[0-9a-f]{64}$`).test(url.pathname)
    || value !== url.href) throw invalid();
  return url.href;
}

function failure(status) {
  if (status === 429) return new Error('付款通知查询过于频繁，请稍后重试');
  if (status === 404) return new Error('付款通知设置不存在，请作者重新设置');
  if (status === 400) return new Error('付款通知请求无效，请刷新后重试');
  return new Error('付款通知服务暂时不可用，请稍后重试');
}

/** All credentials travel in same-origin POST bodies; there is no response cache. */
export class PaymentsClient {
  #fetch;
  #timeout;
  #origin;
  #closed = false;
  #controllers = new Set();

  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 12_000, origin = globalThis.location?.origin } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('当前环境不支持网络请求');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('请求超时时间无效');
    this.#fetch = (...args) => fetchImpl(...args);
    this.#timeout = timeoutMs;
    this.#origin = origin;
  }

  async #request(path, body, { signal } = {}) {
    if (this.#closed || signal?.aborted) throw aborted();
    const controller = new AbortController();
    this.#controllers.add(controller);
    const cancel = () => controller.abort('cancelled');
    signal?.addEventListener('abort', cancel, { once: true });
    let timer;
    let onAbort;
    const interrupted = new Promise((_, reject) => {
      onAbort = () => reject(controller.signal.reason === 'timeout'
        ? new Error('付款通知服务响应超时，请稍后重试') : aborted());
      controller.signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => controller.abort('timeout'), this.#timeout);
    });
    try {
      return await Promise.race([interrupted, (async () => {
        let response;
        try {
          response = await this.#fetch(path, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            credentials: 'same-origin', cache: 'no-store', redirect: 'error',
            referrerPolicy: 'no-referrer', signal: controller.signal, body: JSON.stringify(body),
          });
        } catch {
          if (controller.signal.aborted || this.#closed) throw aborted();
          throw new Error('暂时无法连接付款通知服务，请检查网络后重试');
        }
        if (!response.ok) throw failure(response.status);
        let payload;
        try { payload = await response.json(); } catch { throw invalid(); }
        if (controller.signal.aborted || this.#closed) throw aborted();
        if (!object(payload) || !object(payload.data)) throw invalid();
        return payload.data;
      })()]);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort);
      signal?.removeEventListener('abort', cancel);
      this.#controllers.delete(controller);
    }
  }

  async register(afdianId, options) {
    const data = await this.#request('/api/payments/integrations', { afdianId: validateAfdianId(afdianId) }, options);
    if (!id(data.integrationId) || !token(data.managementToken)) throw invalid();
    return {
      integrationId: data.integrationId,
      webhookUrl: validateWebhookUrl(data.webhookUrl, data.integrationId, this.#origin),
      managementToken: data.managementToken,
    };
  }

  async integrationStatus(integrationId, managementToken, options) {
    if (!id(integrationId) || !token(managementToken)) throw invalid();
    const data = await this.#request('/api/payments/integrations/status', { integrationId, managementToken }, options);
    if (typeof data.webhookReceived !== 'boolean'
      || (data.webhookReceived ? !timestamp(data.lastWebhookAt) : data.lastWebhookAt !== null)) throw invalid();
    return { webhookReceived: data.webhookReceived, lastWebhookAt: data.lastWebhookAt };
  }

  async createIntent({ integrationId, afdianId, amountCents } = {}, options) {
    if (!id(integrationId) || !amount(amountCents)) throw invalid();
    const data = await this.#request('/api/payments/intents', { integrationId, afdianId: validateAfdianId(afdianId), amountCents }, options);
    if (!id(data.intentId) || !token(data.readToken) || !timestamp(data.expiresAt) || data.expiresAt === 0) throw invalid();
    return { intentId: data.intentId, readToken: data.readToken, expiresAt: data.expiresAt };
  }

  async status(intentId, readToken, options) {
    if (!id(intentId) || !token(readToken)) throw invalid();
    const data = await this.#request('/api/payments/status', { intentId, readToken }, options);
    if (Object.hasOwn(data, 'afdianOrderNo') && !orderNo(data.afdianOrderNo)) throw invalid();
    if (data.status === 'unknown') return { status: 'unknown' };
    if (!timestamp(data.expiresAt) || data.expiresAt === 0) throw invalid();
    if (data.status === 'pending') return { status: 'pending', expiresAt: data.expiresAt };
    if (data.status === 'notified' && amount(data.amountCents) && timestamp(data.receivedAt) && data.receivedAt < data.expiresAt) {
      return {
        status: 'notified', amountCents: data.amountCents, receivedAt: data.receivedAt, expiresAt: data.expiresAt,
        ...(Object.hasOwn(data, 'afdianOrderNo') ? { afdianOrderNo: data.afdianOrderNo } : {}),
      };
    }
    throw invalid();
  }

  disconnect() {
    this.#closed = true;
    for (const controller of this.#controllers) controller.abort('cancelled');
    this.#controllers.clear();
  }
}
