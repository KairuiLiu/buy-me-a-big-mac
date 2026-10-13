/** Plain-text receipt columns, measured in monospace display cells. */
const NAME_WIDTH = 20;
const QUANTITY_WIDTH = 8;
const PRICE_WIDTH = 6;
const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });
const EMOJI = /\p{Emoji_Presentation}|\uFE0F|\u20E3/u;
const ZERO_WIDTH = /\p{Mark}|\p{Format}/u;
const CONTROL = /[\u0000-\u001f\u007f]/;

function isWide(code) {
  return code >= 0x1100 && (
    code <= 0x115f || code === 0x2329 || code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xa960 && code <= 0xa97c) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1b000 && code <= 0x1b2ff) ||
    (code >= 0x1f200 && code <= 0x1f251) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

function segmentWidth(segment) {
  // A flag, a skin-tone sequence, and an entire ZWJ family each occupy one
  // emoji cell pair. Combining marks stay attached to their base character.
  if (EMOJI.test(segment)) return 2;
  return Array.from(segment).reduce((width, character) => (
    width + (ZERO_WIDTH.test(character) ? 0 : isWide(character.codePointAt(0)) ? 2 : 1)
  ), 0);
}

function displayWidth(value) {
  let width = 0;
  for (const { segment } of graphemes.segment(value)) width += segmentWidth(segment);
  return width;
}

function pad(value, width, right = false) {
  const spaces = ' '.repeat(Math.max(0, width - displayWidth(value)));
  return right ? spaces + value : value + spaces;
}

function wrapName(value) {
  const lines = [];
  let line = '';
  let width = 0;
  for (const { segment } of graphemes.segment(value)) {
    const nextWidth = segmentWidth(segment);
    if (line && width + nextWidth > NAME_WIDTH) {
      lines.push(line);
      line = '';
      width = 0;
    }
    line += segment;
    width += nextWidth;
  }
  lines.push(line);
  return lines;
}

function tableText(value, label) {
  if (typeof value !== 'string' || !value.trim() || CONTROL.test(value)) {
    throw new TypeError(`${label}格式无效`);
  }
  return value;
}

function money(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('金额必须为非负整数分');
  return `￥${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}

function row(name, quantity = '', price = '') {
  return pad(name, NAME_WIDTH) + pad(quantity, QUANTITY_WIDTH) + pad(price, PRICE_WIDTH);
}

/**
 * Build the complete Afdian remark without truncating names or messages.
 * Item amountCents is the line subtotal, not its unit price. Older receipts
 * without a line subtotal show a dash instead of an invented price.
 * Afdian controls its own font; column alignment assumes a monospace font.
 */
export function buildDonationRemark({ recipient, items, amountCents, blessing = '' }) {
  tableText(recipient, '赠予对象');
  if (!Array.isArray(items)) throw new TypeError('商品列表格式无效');
  if (typeof blessing !== 'string') throw new TypeError('留言格式无效');
  const message = blessing.replace(/\r\n/g, '\n');
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(message)) throw new TypeError('留言含不支持的控制字符');

  const lines = [
    // The last two cells merge into one right-aligned 14-cell recipient area.
    // A longer recipient is deliberately allowed to overflow intact.
    pad('赠予', NAME_WIDTH) + pad(recipient, QUANTITY_WIDTH + PRICE_WIDTH, true),
    row('商品', '数目', '价格'),
  ];
  let quantity = 0;
  for (const item of items) {
    tableText(item?.name, '商品名称');
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new TypeError('商品数量必须为正整数');
    quantity += item.quantity;
    if (!Number.isSafeInteger(quantity)) throw new TypeError('商品总数过大');
    const price = item.amountCents == null ? '—' : money(item.amountCents);
    wrapName(item.name).forEach((name, index) => {
      lines.push(index === 0 ? row(name, `×${item.quantity}`, price) : row(name));
    });
  }
  lines.push(row('总计', `×${quantity}`, money(amountCents)));
  const table = lines.join('\n');
  return `${message ? `${message}\n\n` : ''}${table}\n\nCreate by Buy me a Big Mac`;
}
