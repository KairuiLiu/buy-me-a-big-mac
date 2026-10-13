import { normalizeConfig } from './domain.js';

const RECEIPTS_KEY = 'bigmac.payments.receipts.v1';
const RECEIPT_LIFETIME = 30 * 60_000;
const MAX_RECEIPTS = 5;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
const token = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const timestamp = value => Number.isSafeInteger(value) && value >= 0;
const orderNo = value => typeof value === 'string' && value === value.trim() && /^[0-9]{1,64}$/.test(value);
const invalid = () => { throw new TypeError('本地付款记录格式无效'); };

function fields(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) invalid();
}

function context(options = {}) {
  const now = options.now ?? Date.now();
  if (!timestamp(now)) invalid();
  return {
    storage: options.storage === undefined ? globalThis.localStorage : options.storage,
    now,
  };
}

function readEntries(storage, key, max, maxBytes) {
  const raw = storage.getItem(key);
  if (raw === null) return [];
  if (typeof raw !== 'string' || raw.length > maxBytes) invalid();
  const parsed = JSON.parse(raw);
  fields(parsed, ['v', 'entries']);
  if (parsed.v !== 1 || !Array.isArray(parsed.entries) || parsed.entries.length > max) invalid();
  return parsed.entries;
}

function label(value, max, multiline = false) {
  if (typeof value !== 'string' || value.length > max
    || (multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)) invalid();
  return value.trim();
}

function normalizeReceipt(value, now) {
  fields(value, ['intentId', 'readToken', 'expiresAt', 'createdAt', 'config', 'items', 'amountCents', 'blessing', 'afdianOrderNo']);
  if (!id(value.intentId) || !token(value.readToken)
    || !timestamp(value.expiresAt) || value.expiresAt === 0 || !timestamp(value.createdAt)
    || value.createdAt > now || now - value.createdAt >= RECEIPT_LIFETIME
    || !Number.isSafeInteger(value.amountCents) || value.amountCents < 1 || value.amountCents > 3_000_000
    || !Array.isArray(value.items) || value.items.length === 0 || value.items.length > 200
    || (Object.hasOwn(value, 'afdianOrderNo') && !orderNo(value.afdianOrderNo))) invalid();
  const items = value.items.map(item => {
    fields(item, ['code', 'name', 'quantity', 'amountCents']);
    if (typeof item.code !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(item.code)
      || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 999
      || (Object.hasOwn(item, 'amountCents') && (!Number.isSafeInteger(item.amountCents)
        || item.amountCents < 0 || item.amountCents > 3_000_000))) invalid();
    const name = label(item.name, 200);
    if (!name) invalid();
    return { code: item.code, name, quantity: item.quantity,
      ...(Object.hasOwn(item, 'amountCents') ? { amountCents: item.amountCents } : {}) };
  });
  if (new Set(items.map(item => item.code)).size !== items.length) invalid();
  // Historical receipts have no line prices. New receipts preserve every line
  // total so returning to checkout cannot silently rebuild a different table.
  const pricedItems = items.filter(item => Object.hasOwn(item, 'amountCents'));
  if (pricedItems.length && (pricedItems.length !== items.length
    || pricedItems.reduce((sum, item) => sum + item.amountCents, 0) !== value.amountCents)) invalid();
  return {
    intentId: value.intentId,
    readToken: value.readToken,
    expiresAt: value.expiresAt,
    createdAt: value.createdAt,
    config: normalizeConfig(value.config),
    items,
    amountCents: value.amountCents,
    blessing: label(value.blessing, 8192, true),
    ...(Object.hasOwn(value, 'afdianOrderNo') ? { afdianOrderNo: value.afdianOrderNo } : {}),
  };
}

function receipts({ storage, now }) {
  return readEntries(storage, RECEIPTS_KEY, MAX_RECEIPTS, 1_048_576)
    .flatMap(entry => { try { return [normalizeReceipt(entry, now)]; } catch { return []; } })
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Browser metadata lasts 30 minutes; only a fresh backend response establishes status. */
export function saveReceipt(value, options) {
  try {
    const ctx = context(options);
    const entry = normalizeReceipt(value, ctx.now);
    let existing;
    try { existing = receipts(ctx); } catch { existing = []; }
    const entries = [entry, ...existing.filter(item => item.intentId !== entry.intentId)]
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_RECEIPTS);
    ctx.storage.setItem(RECEIPTS_KEY, JSON.stringify({ v: 1, entries }));
    return true;
  } catch { return false; }
}

export function readReceipt(intentId, options) {
  try {
    if (!id(intentId)) return null;
    return receipts(context(options)).find(entry => entry.intentId === intentId) ?? null;
  } catch { return null; }
}

export function readRecentReceipt(options) {
  try { return receipts(context(options))[0] ?? null; } catch { return null; }
}

export function deleteReceipt(intentId, options) {
  try {
    if (!id(intentId)) return false;
    const ctx = context(options);
    const entries = receipts(ctx).filter(entry => entry.intentId !== intentId);
    ctx.storage.setItem(RECEIPTS_KEY, JSON.stringify({ v: 1, entries }));
    return true;
  } catch { return false; }
}
