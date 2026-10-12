const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const cents = value => Number.isSafeInteger(value) && value >= 0;

// Only restaurant scene fields cross the API boundary. Project and recipient
// information stays in the share link and never reaches the menu service.
function scene(config = {}) {
  const { storeCode, beCode, orderType = 1, beType = 1 } = config;
  if (storeCode === undefined || storeCode === null || String(storeCode).trim() === '') throw new Error('请先选择餐厅');
  if (Number(orderType) !== 1 || ![1, 5].includes(Number(beType))) throw new Error('当前只支持到店自取或得来速的价格查询');
  const result = { storeCode: String(storeCode), orderType: 1, beType: Number(beType) };
  if (beCode !== undefined && beCode !== null && String(beCode) !== '') result.beCode = String(beCode);
  return result;
}

function validateMenu(menu) {
  if (!object(menu) || !Array.isArray(menu.categories) || !Array.isArray(menu.products)
    || menu.categories.some(category => !object(category) || typeof category.name !== 'string' || !Array.isArray(category.codes) || category.codes.some(code => typeof code !== 'string'))
    || menu.products.some(product => !object(product) || typeof product.code !== 'string' || typeof product.name !== 'string' || !cents(product.priceCents) || !cents(product.originalPriceCents))) {
    throw new Error('餐厅菜单格式暂不支持，请稍后重试');
  }
  return menu;
}

function validateQuote(quote) {
  if (!object(quote) || !cents(quote.amountCents) || quote.amountCents === 0 || !cents(quote.originalCents) || !cents(quote.discountCents)
    || quote.originalCents < quote.amountCents || quote.discountCents > quote.originalCents
    || !Array.isArray(quote.items) || !quote.items.length
    || quote.items.some(item => !object(item) || typeof item.code !== 'string' || !Number.isSafeInteger(item.quantity) || item.quantity < 1)) {
    throw new Error('建议金额格式暂不支持，请稍后重新计算');
  }
  return quote;
}

export class McdClient {
  #fetch;
  #timeout;
  #connected = false;
  #connecting = null;
  #closed = false;
  #controllers = new Set();
  #generation = 0;

  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 30_000 } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('当前环境不支持网络请求');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('请求超时时间无效');
    this.#fetch = (...args) => fetchImpl(...args);
    this.#timeout = timeoutMs;
  }

  async #request(path, body) {
    if (this.#closed) throw new Error('连接已关闭，请重新加载页面');
    const generation = this.#generation;
    const controller = new AbortController();
    this.#controllers.add(controller);
    let timer;
    let onAbort;
    const interrupted = new Promise((_, reject) => {
      onAbort = () => reject(new Error(controller.signal.reason === 'timeout' ? '麦当劳服务响应超时，请稍后重试' : '连接已关闭'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => controller.abort('timeout'), this.#timeout);
    });
    try {
      return await Promise.race([
        interrupted,
        (async () => {
          let response;
          try {
            response = await this.#fetch(path, {
              method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              signal: controller.signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
              body: JSON.stringify(body),
            });
          } catch {
            if (controller.signal.aborted) throw new Error('连接已关闭');
            throw new Error('暂时无法连接本站，请检查网络后重试');
          }
          let payload;
          try { payload = await response.json(); }
          catch {
            if (!response.ok) throw new Error(`服务暂时未能完成请求（HTTP ${response.status}），请稍后重试`);
            throw new Error('服务返回了无效 JSON，请稍后重试');
          }
          if (controller.signal.aborted || this.#closed || generation !== this.#generation) throw new Error('连接已关闭');
          if (!response.ok) {
            const detail = object(payload) && typeof payload.error === 'string' && payload.error.trim()
              ? payload.error.slice(0, 300) : '服务暂时未能完成请求，请稍后重试';
            throw new Error(detail);
          }
          if (!object(payload) || !owns(payload, 'data')) throw new Error('服务响应缺少查询结果，请稍后重试');
          return payload.data;
        })(),
      ]);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort);
      this.#controllers.delete(controller);
    }
  }

  async connect() {
    if (this.#closed) throw new Error('连接已关闭，请重新加载页面');
    if (this.#connected) return;
    if (this.#connecting) return this.#connecting;
    const generation = this.#generation;
    this.#connecting = (async () => {
      const data = await this.#request('/api/connect', {});
      if (!object(data) || data.ok !== true) throw new Error('暂时无法连接麦当劳，请稍后重试');
      if (this.#closed || generation !== this.#generation) throw new Error('连接已关闭');
      this.#connected = true;
    })();
    try { await this.#connecting; }
    finally { this.#connecting = null; }
  }

  async #call(path, body) {
    await this.connect();
    return this.#request(path, body);
  }

  async searchStores({ city, keyword, beType = 1, latitude, longitude } = {}) {
    if (![1, 5].includes(Number(beType))) throw new Error('请选择到店自取或得来速');
    const args = { beType: Number(beType) };
    if (latitude !== undefined || longitude !== undefined) {
      const coordinate = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value));
      if (!coordinate(latitude) || !coordinate(longitude) || Math.abs(Number(latitude)) > 90 || Math.abs(Number(longitude)) > 180) throw new Error('请提供有效的经纬度');
      Object.assign(args, { latitude: Number(latitude), longitude: Number(longitude) });
    } else {
      if (!String(city || '').trim() || !String(keyword || '').trim()) throw new Error('请输入城市和餐厅附近的位置');
      Object.assign(args, { city: String(city).trim(), keyword: String(keyword).trim() });
    }
    const stores = await this.#call('/api/stores', args);
    if (!Array.isArray(stores) || stores.some(store => !object(store) || typeof store.storeCode !== 'string' || typeof store.storeName !== 'string')) throw new Error('餐厅数据格式暂不支持，请稍后重试');
    return stores;
  }

  async getMenu(config) {
    return validateMenu(await this.#call('/api/menu', { config: scene(config) }));
  }

  async calculate(config, items) {
    if (!Array.isArray(items) || items.length === 0 || items.length > 30) throw new Error('请选择 1 至 30 种餐品');
    const products = items.map(item => {
      if (!object(item) || typeof item.productCode !== 'string' || !item.productCode.trim() || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) throw new Error('餐品或数量无效，请重新选择');
      return { productCode: item.productCode, quantity: item.quantity };
    });
    return validateQuote(await this.#call('/api/quote', { config: scene(config), items: products }));
  }

  disconnect() {
    this.#generation++;
    this.#closed = true;
    this.#connected = false;
    for (const controller of this.#controllers) controller.abort('disconnect');
    this.#controllers.clear();
  }
}
