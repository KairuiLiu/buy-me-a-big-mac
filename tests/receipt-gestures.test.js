import test from 'node:test';
import assert from 'node:assert/strict';
import { bindReceiptGestures } from '../src/lib/receipt-gestures.js';

// Small event/scroll surface doubles keep these tests about public gestures;
// the browser smoke test covers actual layout and pointer delivery.
class Surface {
  constructor(tag = '', parent = null) {
    this.tagName = tag.toUpperCase();
    this.nodeType = tag ? 1 : 9;
    this.parentElement = parent;
    this.ownerDocument = parent?.ownerDocument || parent;
    this.scrollTop = 0;
    this.scrollHeight = 1000;
    this.clientHeight = 400;
    this.listeners = new Map();
  }
  addEventListener(type, callback, options = {}) {
    const entries = this.listeners.get(type) || [];
    entries.push({ callback, options });
    this.listeners.set(type, entries);
  }
  removeEventListener(type, callback) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(entry => entry.callback !== callback));
  }
  contains(target) {
    return target === this || Boolean(target?.parentElement && this.contains(target.parentElement));
  }
  closest(selector) {
    const matches = selector === 'textarea' ? this.tagName === 'TEXTAREA'
      : ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT'].includes(this.tagName) || this.editable || this.buttonRole;
    return matches ? this : this.parentElement?.closest?.(selector) || null;
  }
  emit(type, fields = {}) {
    const event = {
      target: this, cancelable: true, defaultPrevented: false, stopped: false,
      preventDefault() { if (this.cancelable && !this.passive) this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
      ...fields,
    };
    for (let surface = this; surface; surface = surface.parentElement) {
      for (const entry of surface.listeners.get(type) || []) {
        event.passive = entry.options.passive;
        entry.callback(event);
      }
      if (event.stopped) break;
    }
    return event;
  }
}

function setup({ top = 0, height = 1000, visible = 400, open = true, printing = false, enabled = true } = {}) {
  let time = 0;
  let sequence = 0;
  const frames = new Map();
  const window = new Surface();
  window.performance = { now: () => time };
  window.requestAnimationFrame = callback => { const id = ++sequence; frames.set(id, callback); return id; };
  window.cancelAnimationFrame = id => frames.delete(id);
  const document = new Surface();
  document.defaultView = window;
  const paper = new Surface('div', document);
  const mouth = new Surface('div', document);
  paper.scrollTop = top;
  paper.scrollHeight = height;
  paper.clientHeight = visible;
  const state = { open, printing, enabled, opened: 0, closed: 0, pulls: [], openingDistances: [] };
  const cleanup = bindReceiptGestures({
    paper, mouth,
    enabled: () => state.enabled, isOpen: () => state.open, isPrinting: () => state.printing,
    onPull: distance => state.pulls.push(distance),
    onOpen: distance => { state.openingDistances.push(distance); state.opened++; state.open = true; },
    onClose: () => { state.closed++; state.open = false; },
  });
  function touch(target, type, y, x = 0, fingers = 1) {
    time += 16;
    const point = { clientX: x, clientY: y, identifier: 1 };
    const touches = type === 'touchend' || type === 'touchcancel' ? [] : [point];
    if (fingers === 2) touches.push({ clientX: x + 40, clientY: y, identifier: 2 });
    return target.emit(type, { touches, changedTouches: [point] });
  }
  function pointer(target, type, y, x = 0, fields = {}) {
    time += 16;
    return target.emit(type, { pointerType: 'mouse', pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, ...fields });
  }
  function wheel(target, deltaY, fields = {}) {
    time += 16;
    return target.emit('wheel', { deltaY, deltaMode: 0, ctrlKey: false, ...fields });
  }
  function advance(milliseconds) {
    for (let elapsed = 0; elapsed < milliseconds; elapsed += 16) {
      time += 16;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => callback(time));
    }
  }
  return { paper, mouth, document, window, state, cleanup, touch, pointer, wheel, advance };
}

test('reading a long paper never closes it when the same drag reaches its top', () => {
  const h = setup({ top: 200 });
  h.touch(h.paper, 'touchstart', 100);
  assert.equal(h.touch(h.paper, 'touchmove', 180).defaultPrevented, true);
  assert.equal(h.paper.scrollTop, 120);
  h.touch(h.paper, 'touchmove', 400);
  assert.equal(h.paper.scrollTop, 0);
  h.touch(h.paper, 'touchmove', 500);
  h.touch(h.paper, 'touchend', 500);
  h.advance(1000);
  assert.equal(h.state.closed, 0);
  assert.ok(h.state.pulls.every(value => value === 0));
  h.cleanup();
});

test('a fresh paper-top pull follows the finger and closes only at the threshold', () => {
  const h = setup();
  h.touch(h.paper, 'touchstart', 100);
  h.touch(h.paper, 'touchmove', 171);
  assert.equal(h.state.pulls.at(-1), 71);
  h.touch(h.paper, 'touchend', 171);
  assert.equal(h.state.pulls.at(-1), 0);
  assert.equal(h.state.closed, 0);
  h.touch(h.paper, 'touchstart', 100);
  h.touch(h.paper, 'touchmove', 172);
  h.touch(h.paper, 'touchend', 172);
  assert.equal(h.state.closed, 1);
  h.cleanup();
});

test('reversing a reading gesture at the paper top cannot turn it into a close', () => {
  const h = setup();
  h.touch(h.paper, 'touchstart', 100);
  h.touch(h.paper, 'touchmove', 50);
  assert.equal(h.paper.scrollTop, 50);
  h.touch(h.paper, 'touchmove', 200);
  h.touch(h.paper, 'touchend', 200);
  assert.equal(h.state.closed, 0);
  h.cleanup();
});

test('the closed outlet follows an upward pull and opens at 48 pixels', () => {
  const h = setup({ open: false });
  h.touch(h.mouth, 'touchstart', 100);
  assert.equal(h.touch(h.mouth, 'touchmove', 53).defaultPrevented, true);
  assert.equal(h.state.pulls.at(-1), -47);
  h.touch(h.mouth, 'touchend', 53);
  assert.equal(h.state.opened, 0);
  h.touch(h.mouth, 'touchstart', 100);
  h.touch(h.mouth, 'touchmove', 52);
  h.touch(h.mouth, 'touchend', 52);
  assert.equal(h.state.opened, 1);
  assert.deepEqual(h.state.openingDistances, [-48]);
  assert.equal(h.state.pulls.at(-1), 0);
  h.cleanup();
});

test('printing absorbs vertical touch and wheel movement without scrolling or closing', () => {
  const h = setup({ top: 100, printing: true });
  h.touch(h.paper, 'touchstart', 100);
  assert.equal(h.touch(h.paper, 'touchmove', 200).defaultPrevented, true);
  h.state.printing = false;
  h.touch(h.paper, 'touchmove', 300);
  h.touch(h.paper, 'touchend', 300);
  assert.equal(h.paper.scrollTop, 100, 'a gesture begun during printing stays absorbed');
  assert.equal(h.state.closed, 0);
  h.state.printing = true;
  assert.equal(h.wheel(h.paper, 90).defaultPrevented, true);
  assert.equal(h.paper.scrollTop, 100);
  h.cleanup();
});

test('touches starting on controls scroll paper but cannot pull it closed', () => {
  for (const tag of ['button', 'a', 'input', 'select']) {
    const h = setup();
    const control = new Surface(tag, h.paper);
    h.touch(control, 'touchstart', 100);
    assert.equal(h.touch(control, 'touchmove', 200).defaultPrevented, true);
    h.touch(control, 'touchend', 200);
    assert.equal(h.state.closed, 0, `${tag} must not trigger closing`);
    h.cleanup();
  }
});

test('textarea scrolling is consumed before paper scrolling and cannot close it', () => {
  const h = setup();
  const textarea = new Surface('textarea', h.paper);
  textarea.clientHeight = 100;
  textarea.scrollHeight = 200;
  textarea.scrollTop = 60;
  h.touch(textarea, 'touchstart', 100);
  h.touch(textarea, 'touchmove', 30);
  assert.equal(textarea.scrollTop, 100);
  assert.equal(h.paper.scrollTop, 30);
  h.touch(textarea, 'touchmove', 200);
  assert.equal(textarea.scrollTop, 0);
  assert.equal(h.paper.scrollTop, 0);
  h.touch(textarea, 'touchend', 200);
  assert.equal(h.state.closed, 0);
  h.cleanup();
});

test('a second finger anywhere cancels pulling without blocking pinch zoom', () => {
  const h = setup();
  h.touch(h.paper, 'touchstart', 100);
  h.touch(h.paper, 'touchmove', 190);
  const second = h.touch(h.document, 'touchstart', 190, 0, 2);
  assert.equal(second.defaultPrevented, false);
  assert.equal(h.state.pulls.at(-1), 0);
  assert.equal(h.touch(h.paper, 'touchmove', 210, 0, 2).defaultPrevented, false);
  h.touch(h.paper, 'touchend', 210);
  assert.equal(h.state.closed, 0);
  h.cleanup();
});

test('wheel movement is confined to paper at either edge, including a short receipt', () => {
  for (const height of [1000, 200]) {
    const h = setup({ height });
    assert.equal(h.wheel(h.paper, -500).defaultPrevented, true);
    assert.equal(h.paper.scrollTop, 0);
    assert.equal(h.wheel(h.paper, 2000).defaultPrevented, true);
    assert.equal(h.paper.scrollTop, Math.max(0, height - 400));
    assert.equal(h.wheel(h.paper, 2000).defaultPrevented, true);
    assert.equal(h.state.closed, 0);
    assert.equal(h.wheel(h.paper, 100, { ctrlKey: true }).defaultPrevented, false, 'trackpad pinch is left alone');
    h.cleanup();
  }
});

test('wheel supports line/page units and prioritizes a hovered textarea', () => {
  const h = setup();
  h.wheel(h.paper, 2, { deltaMode: 1 });
  assert.equal(h.paper.scrollTop, 32);
  h.wheel(h.paper, 1, { deltaMode: 2 });
  assert.equal(h.paper.scrollTop, 432);
  const textarea = new Surface('textarea', h.paper);
  textarea.clientHeight = 100;
  textarea.scrollHeight = 200;
  h.wheel(textarea, 140);
  assert.equal(textarea.scrollTop, 100);
  assert.equal(h.paper.scrollTop, 472);
  h.cleanup();
});

test('mouse dragging reads paper and can open the outlet without a synthetic click', () => {
  const h = setup({ top: 100 });
  h.pointer(h.paper, 'pointerdown', 100);
  h.pointer(h.document, 'pointermove', 20);
  h.pointer(h.document, 'pointerup', 20);
  assert.equal(h.paper.scrollTop, 180);
  assert.equal(h.paper.emit('click').defaultPrevented, true);
  h.state.open = false;
  h.pointer(h.mouth, 'pointerdown', 100);
  h.pointer(h.document, 'pointermove', 40);
  h.pointer(h.document, 'pointerup', 40);
  assert.equal(h.state.opened, 1);
  assert.equal(h.mouth.emit('click').defaultPrevented, true);
  h.cleanup();
});

test('light touch momentum stops at the edge and never turns into closing', () => {
  const h = setup({ top: 300 });
  h.touch(h.paper, 'touchstart', 100);
  h.touch(h.paper, 'touchmove', 180);
  h.touch(h.paper, 'touchend', 180);
  const releasedAt = h.paper.scrollTop;
  h.advance(32);
  assert.ok(h.paper.scrollTop < releasedAt);
  h.advance(2000);
  assert.equal(h.paper.scrollTop, 0);
  assert.equal(h.state.closed, 0);
  h.cleanup();
});

test('disabled, cancelled, horizontal, and disposed gestures cannot affect the page', () => {
  const h = setup({ enabled: false });
  h.touch(h.paper, 'touchstart', 100);
  assert.equal(h.touch(h.paper, 'touchmove', 200).defaultPrevented, false);
  assert.equal(h.wheel(h.paper, 100).defaultPrevented, false);
  h.state.enabled = true;
  h.touch(h.paper, 'touchstart', 100);
  assert.equal(h.touch(h.paper, 'touchmove', 105, 80).defaultPrevented, false);
  h.touch(h.paper, 'touchmove', 200, 80);
  h.touch(h.paper, 'touchend', 200, 80);
  assert.equal(h.state.closed, 0);
  h.touch(h.paper, 'touchstart', 100);
  h.touch(h.paper, 'touchmove', 190);
  h.touch(h.paper, 'touchcancel', 190);
  h.touch(h.paper, 'touchend', 190);
  assert.equal(h.state.closed, 0);
  h.touch(h.paper, 'touchstart', 100);
  h.touch(h.paper, 'touchmove', 20);
  h.touch(h.paper, 'touchend', 20);
  h.cleanup();
  const stoppedAt = h.paper.scrollTop;
  h.advance(1000);
  assert.equal(h.paper.scrollTop, stoppedAt, 'cleanup cancels pending momentum');
  h.touch(h.paper, 'touchstart', 100);
  assert.equal(h.touch(h.paper, 'touchmove', 0).defaultPrevented, false);
  assert.equal(h.wheel(h.paper, 100).defaultPrevented, false);
  assert.equal(h.paper.scrollTop, stoppedAt);
});
