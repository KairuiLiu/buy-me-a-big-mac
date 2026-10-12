const ENDPOINT = 'https://mcp.mcd.cn/';
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024;
const PROTOCOL_VERSION = '2025-03-26';
const READ_TOOLS = new Set([
  'query-nearby-stores',
  'query-meals',
  'query-meal-detail',
  'calculate-price',
]);

const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function safeError(error, token) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [token, token && encodeURIComponent(token)]) {
    if (secret) message = message.split(secret).join('[Token 已隐藏]');
  }
  message = message.replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [已隐藏]');
  return new Error(message.slice(0, 500) || '麦当劳 MCP 请求失败');
}

function rpcResult(payload, id) {
  if (!object(payload) || payload.id !== id) {
    throw new Error('MCP 返回了不匹配的响应');
  }
  if (payload.error) {
    const code = payload.error.code ?? 'unknown';
    throw new Error(`MCP 协议错误 (${code})：${payload.error.message || '请求未成功'}`);
  }
  if (!owns(payload, 'result')) throw new Error('MCP 响应缺少 result');
  return payload.result;
}

async function readSse(response, id, signal) {
  if (!response.body?.getReader) throw new Error('浏览器无法读取 MCP 事件流');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let totalBytes = 0;
  let eventLines = [];
  let firstChunk = true;
  let skipLeadingLf = false;
  const stop = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', stop, { once: true });

  function finishEvent() {
    const data = eventLines.join('\n');
    eventLines = [];
    if (!data || data === '[DONE]') return null;
    let payload;
    try { payload = JSON.parse(data); }
    catch { throw new Error('MCP 事件流包含无效 JSON'); }
    return object(payload) && payload.id === id ? payload : null;
  }

  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      totalBytes += value?.byteLength || 0;
      if (totalBytes > MAX_RESPONSE_BYTES) throw new Error('MCP 响应过大');
      let chunk = done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (firstChunk && chunk) {
        chunk = chunk.replace(/^\uFEFF/, '');
        firstChunk = false;
      }
      buffer += chunk;
      // CR dispatches immediately, including on an open CR-only stream.
      // Suppress a following LF if a CRLF delimiter was split across chunks.
      if (skipLeadingLf && buffer.length) {
        if (buffer[0] === '\n') buffer = buffer.slice(1);
        skipLeadingLf = false;
      }
      let newline;
      while ((newline = buffer.search(/[\r\n]/)) !== -1) {
        const line = buffer.slice(0, newline);
        const separatorLength = buffer[newline] === '\r' && buffer[newline + 1] === '\n' ? 2 : 1;
        skipLeadingLf = buffer[newline] === '\r' && newline === buffer.length - 1;
        buffer = buffer.slice(newline + separatorLength);
        if (line === '') {
          const payload = finishEvent();
          if (payload) return rpcResult(payload, id);
        } else if (line.startsWith('data:')) {
          eventLines.push(line.slice(5).replace(/^ /, ''));
        }
      }
      if (done) {
        if (buffer.startsWith('data:')) eventLines.push(buffer.slice(5).replace(/^ /, '').replace(/\r$/, ''));
        const payload = finishEvent();
        if (payload) return rpcResult(payload, id);
        break;
      }
    }
    throw new Error('MCP 事件流结束，但没有收到请求结果');
  } finally {
    signal.removeEventListener('abort', stop);
    stop();
  }
}

async function readJson(response, signal) {
  const declared = response.headers.get('Content-Length');
  if (declared !== null && Number(declared) > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new Error('MCP 响应过大');
  }
  if (!response.body?.getReader) throw new Error('MCP 响应为空');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  let totalBytes = 0;
  const stop = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', stop, { once: true });
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) return JSON.parse(text + decoder.decode());
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) throw new Error('MCP 响应过大');
      text += decoder.decode(value, { stream: true });
    }
    throw new Error('MCP 响应已中断');
  } finally {
    signal.removeEventListener('abort', stop);
    stop();
  }
}

function resolveSchema(schema, root) {
  if (!object(schema) || !schema.$ref) return schema || {};
  if (!schema.$ref.startsWith('#/')) throw new Error('MCP 工具使用了不支持的外部参数 schema');
  let found = root;
  for (const segment of schema.$ref.slice(2).split('/')) {
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!object(found) || !owns(found, key)) throw new Error('MCP 工具参数 schema 引用无效');
    found = found[key];
  }
  return found;
}

// Only adapt arguments of the four explicitly allowed tools. Never execute a
// server-supplied tool name or dereference a remote schema URL.
function adapt(value, schema, path, root = schema, depth = 0) {
  if (depth > 30) throw new Error('MCP 参数结构过深');
  schema = resolveSchema(schema, root);
  const variants = schema.anyOf || schema.oneOf;
  if (Array.isArray(variants)) {
    for (const variant of variants) {
      try { return adapt(value, variant, path, root, depth + 1); } catch { /* try the next documented type */ }
    }
    throw new Error(`参数 ${path} 不符合 MCP 工具类型要求`);
  }
  if (Array.isArray(schema.type)) {
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const types = [...schema.type].sort((a, b) => Number(b === actual) - Number(a === actual));
    for (const type of types) {
      try { return adapt(value, { ...schema, type }, path, root, depth + 1); } catch { /* try the next type */ }
    }
    throw new Error(`参数 ${path} 类型不受支持`);
  }
  let result = value;
  const type = schema.type || (schema.properties ? 'object' : undefined);
  if (type === 'string') {
    if (typeof value === 'number' && Number.isFinite(value)) result = String(value);
    if (typeof result !== 'string') throw new Error(`参数 ${path} 必须是文本`);
  } else if (type === 'number' || type === 'integer') {
    if (typeof value === 'string' && value.trim() !== '') result = Number(value);
    if (typeof result !== 'number' || !Number.isFinite(result) || (type === 'integer' && !Number.isInteger(result))) {
      throw new Error(`参数 ${path} 必须是${type === 'integer' ? '整数' : '数字'}`);
    }
  } else if (type === 'boolean') {
    if (value === 'true') result = true;
    if (value === 'false') result = false;
    if (typeof result !== 'boolean') throw new Error(`参数 ${path} 必须是布尔值`);
  } else if (type === 'null') {
    if (value !== null) throw new Error(`参数 ${path} 必须为空`);
  } else if (type === 'array') {
    if (!Array.isArray(value)) throw new Error(`参数 ${path} 必须是列表`);
    result = value.map((item, index) => adapt(item, schema.items || {}, `${path}[${index}]`, root, depth + 1));
  } else if (type === 'object') {
    if (!object(value)) throw new Error(`参数 ${path} 必须是对象`);
    result = {};
    for (const key of schema.required || []) {
      if (!owns(value, key) || value[key] === undefined) throw new Error(`MCP 工具缺少必填参数：${key}`);
    }
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('MCP 参数包含不允许的字段');
      if (schema.additionalProperties === false && !owns(schema.properties || {}, key)) {
        throw new Error(`MCP 工具不接受参数：${key}`);
      }
      result[key] = adapt(item, schema.properties?.[key] || {}, `${path}.${key}`, root, depth + 1);
    }
  }
  if (schema.enum && !schema.enum.includes(result)) throw new Error(`参数 ${path} 不在工具允许的取值中`);
  if (owns(schema, 'const') && result !== schema.const) throw new Error(`参数 ${path} 与工具要求不一致`);
  if (typeof result === 'number') {
    if (schema.minimum !== undefined && result < schema.minimum) throw new Error(`参数 ${path} 过小`);
    if (schema.maximum !== undefined && result > schema.maximum) throw new Error(`参数 ${path} 过大`);
  }
  return result;
}

function scene(config = {}) {
  const { storeCode, beCode, orderType = 1, beType = 1 } = config;
  if (storeCode === undefined || storeCode === null || String(storeCode).trim() === '') throw new Error('请先选择餐厅');
  if (Number(orderType) !== 1 || ![1, 5].includes(Number(beType))) throw new Error('当前只支持到店自取或得来速的价格查询');
  const args = { storeCode: String(storeCode), orderType: 1, beType: Number(beType) };
  if (beCode !== undefined && beCode !== null && String(beCode) !== '') args.beCode = String(beCode);
  return args;
}

function unpackTool(result) {
  if (!object(result)) throw new Error('MCP 工具响应格式无效');
  const texts = Array.isArray(result.content) ? result.content.filter(item => item.type === 'text').map(item => item.text || '') : [];
  if (result.isError) throw new Error(`麦当劳工具未成功：${texts.join(' ') || '服务返回错误'}`);
  let payload = result.structuredContent;
  if (payload === undefined) {
    for (const text of texts) {
      try { payload = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); break; }
      catch { /* another content block may contain the result */ }
    }
  }
  if (payload === undefined) throw new Error('MCP 工具没有返回可读取的 JSON 数据');
  if (object(payload)) {
    const failedCode = owns(payload, 'code') && ![0, 200, '0', '200'].includes(payload.code);
    if (payload.success === false || failedCode) throw new Error(`麦当劳查询失败：${payload.message || payload.msg || '服务未接受本次查询'}`);
    if (owns(payload, 'data')) return payload.data;
  }
  return payload;
}

export class McdClient {
  #token;
  #fetch;
  #timeout;
  #session = null;
  #version = null;
  #nextId = 0;
  #connected = false;
  #connecting = null;
  #schemas = new Map();
  #controllers = new Set();
  #generation = 0;

  constructor(token, { fetchImpl = globalThis.fetch, timeoutMs = 20_000 } = {}) {
    if (typeof token !== 'string' || !token || token.length > 8192 || /[^\x21-\x7e]/.test(token)) throw new Error('请输入有效的 MCP Token');
    if (typeof fetchImpl !== 'function') throw new Error('当前环境不支持网络请求');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('请求超时时间无效');
    this.#token = token.trim();
    this.#fetch = (...args) => fetchImpl(...args);
    this.#timeout = timeoutMs;
  }

  async #request(method, params, notification = false) {
    if (!this.#token) throw new Error('连接已关闭，请重新输入 MCP Token');
    const token = this.#token;
    const controller = new AbortController();
    this.#controllers.add(controller);
    const id = notification ? undefined : ++this.#nextId;
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, 'Cache-Control': 'no-store', Pragma: 'no-cache' };
    if (this.#session) headers['Mcp-Session-Id'] = this.#session;
    if (this.#version) headers['MCP-Protocol-Version'] = this.#version;
    let timer;
    let onAbort;
    const interrupted = new Promise((_, reject) => {
      onAbort = () => reject(new Error(controller.signal.reason === 'timeout' ? '麦当劳 MCP 请求超时，请稍后重试' : '连接已关闭'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => controller.abort('timeout'), this.#timeout);
    });
    try {
      return await Promise.race([
        interrupted,
        (async () => {
          let response;
          try {
            response = await this.#fetch(ENDPOINT, {
              method: 'POST', headers, signal: controller.signal, redirect: 'manual',
              body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }),
            });
          } catch (error) {
            if (controller.signal.aborted) throw error;
            throw new Error(`暂时无法连接本站，请检查网络后重试。${error?.message ? `（${error.message}）` : ''}`);
          }
          if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new Error('连接已关闭'); }
          if (!response.ok) {
            void response.body?.cancel().catch(() => {});
            const detail = { 401: 'Token 无效或已过期，请重新获取后连接', 403: '请求被拒绝，可能与权限、网络或网关有关', 429: '请求过于频繁，请稍后重试', 502: '本站暂时无法连接麦当劳，请稍后重试', 504: '麦当劳服务响应超时，请稍后重试' }[response.status] || '服务暂时未能完成请求';
            throw new Error(`麦当劳 MCP HTTP ${response.status}：${detail}`);
          }
          if (controller.signal.aborted) throw new Error('连接已关闭');
          const session = response.headers.get('Mcp-Session-Id');
          if (session) {
            if (session.length > 1024 || /[^\x20-\x7e]/.test(session)) { void response.body?.cancel().catch(() => {}); throw new Error('MCP 会话标识无效'); }
            this.#session = session;
          }
          if (notification) { void response.body?.cancel().catch(() => {}); return undefined; }
          const contentType = response.headers.get('Content-Type') || '';
          if (contentType.includes('text/event-stream')) return readSse(response, id, controller.signal);
          let payload;
          try { payload = await readJson(response, controller.signal); }
          catch { throw new Error('MCP 返回了无效 JSON 响应'); }
          return rpcResult(payload, id);
        })(),
      ]);
    } catch (error) {
      throw safeError(error, token);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort);
      this.#controllers.delete(controller);
    }
  }

  async connect() {
    if (this.#connected) return;
    if (this.#connecting) return this.#connecting;
    if (!this.#token) throw new Error('连接已关闭，请重新输入 MCP Token');
    const generation = this.#generation;
    this.#connecting = (async () => {
      this.#session = null;
      this.#version = null;
      this.#schemas.clear();
      const initialized = await this.#request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'buy-me-a-big-mac', version: '0.1.0' } });
      if (!object(initialized) || typeof initialized.protocolVersion !== 'string' || initialized.protocolVersion.length > 128 || /[^\x20-\x7e]/.test(initialized.protocolVersion)) throw new Error('MCP 初始化响应缺少协议版本');
      this.#version = initialized.protocolVersion;
      await this.#request('notifications/initialized', {}, true);
      let cursor;
      const cursors = new Set();
      for (let page = 0; page < 20; page++) {
        const listed = await this.#request('tools/list', cursor ? { cursor } : {});
        if (!Array.isArray(listed?.tools)) throw new Error('MCP 工具列表无效');
        for (const tool of listed.tools) {
          if (READ_TOOLS.has(tool.name)) this.#schemas.set(tool.name, tool.inputSchema || { type: 'object' });
        }
        if (!listed.nextCursor) { cursor = null; break; }
        cursor = listed.nextCursor;
        if (typeof cursor !== 'string' || cursors.has(cursor)) throw new Error('MCP 工具列表分页无效');
        cursors.add(cursor);
      }
      if (cursor) throw new Error('MCP 工具列表分页过多');
      if (generation !== this.#generation || !this.#token) throw new Error('连接已关闭');
      this.#connected = true;
    })();
    try { await this.#connecting; }
    catch (error) {
      this.#session = null;
      this.#version = null;
      this.#schemas.clear();
      throw safeError(error, this.#token);
    } finally { this.#connecting = null; }
  }

  async #call(name, args) {
    if (!READ_TOOLS.has(name)) throw new Error('此客户端只允许查询餐厅、菜单和价格');
    const token = this.#token;
    try {
      await this.connect();
      if (!this.#schemas.has(name)) throw new Error(`麦当劳服务暂未提供查询工具：${name}`);
      const schema = this.#schemas.get(name);
      const result = await this.#request('tools/call', { name, arguments: adapt(args, schema, 'arguments') });
      return unpackTool(result);
    } catch (error) { throw safeError(error, token); }
  }

  async searchStores({ city, keyword, beType = 1, latitude, longitude } = {}) {
    if (![1, 5].includes(Number(beType))) throw new Error('请选择到店自取或得来速');
    const args = { beType: Number(beType) };
    if (latitude !== undefined || longitude !== undefined) {
      const coordinate = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value));
      if (!coordinate(latitude) || !coordinate(longitude) || Math.abs(Number(latitude)) > 90 || Math.abs(Number(longitude)) > 180) {
        throw new Error('请提供有效的经纬度');
      }
      Object.assign(args, { searchType: 3, latitude: Number(latitude), longitude: Number(longitude) });
    } else {
      if (!String(city || '').trim() || !String(keyword || '').trim()) throw new Error('请输入城市和餐厅附近的位置');
      Object.assign(args, { searchType: 2, city: String(city).trim(), keyword: String(keyword).trim() });
    }
    return this.#call('query-nearby-stores', args);
  }

  async getMenu(config) { return this.#call('query-meals', scene(config)); }

  async getMeal(config, code) {
    if (code === undefined || code === null || String(code).trim() === '') throw new Error('缺少餐品编码');
    return this.#call('query-meal-detail', { ...scene(config), code: String(code) });
  }

  async calculate(config, items) {
    if (!Array.isArray(items) || items.length === 0) throw new Error('请先选择至少一份餐品');
    return this.#call('calculate-price', { ...scene(config), items });
  }

  disconnect() {
    this.#generation++;
    this.#connected = false;
    this.#token = '';
    this.#session = null;
    this.#version = null;
    this.#schemas.clear();
    for (const controller of this.#controllers) controller.abort('disconnect');
    this.#controllers.clear();
  }
}
