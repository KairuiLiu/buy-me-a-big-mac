const CLOSE_DISTANCE = 72;
const OPEN_DISTANCE = 48;
const DIRECTION_SLOP = 6;
const INTERACTIVE = 'button, a, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="button"]';

/**
 * Keep mobile paper gestures inside the printer. The caller supplies live state
 * getters and uses touch-action: pinch-zoom on both gesture surfaces so native
 * pinch zoom remains available while single-finger scrolling belongs here.
 *
 * @param {{
 *   paper: HTMLElement, mouth: HTMLElement,
 *   enabled: () => boolean, isOpen: () => boolean, isPrinting: () => boolean,
 *   onPull: (distance: number) => void, onOpen: (distance: number) => void, onClose: () => void
 * }} options
 * @returns {() => void}
 */
export function bindReceiptGestures({ paper, mouth, enabled, isOpen, isPrinting, onPull, onOpen, onClose }) {
  const document = paper.ownerDocument;
  const window = document.defaultView;
  const listeners = [];
  let gesture;
  let momentum = 0;
  let disposed = false;
  let suppressClick;
  const now = () => window.performance.now();

  function listen(target, type, callback, options) {
    target.addEventListener(type, callback, options);
    listeners.push(() => target.removeEventListener(type, callback, options));
  }

  function stopMomentum() {
    if (momentum) window.cancelAnimationFrame(momentum);
    momentum = 0;
  }

  function cancelGesture() {
    gesture = undefined;
    onPull(0);
  }

  function reset() {
    stopMomentum();
    cancelGesture();
  }

  function closest(target, selector) {
    const element = target?.nodeType === 1 ? target : target?.parentElement;
    return element?.closest?.(selector) || null;
  }

  function scroll(element, distance) {
    const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
    const before = Math.max(0, Math.min(maximum, element.scrollTop));
    const after = Math.max(0, Math.min(maximum, before + distance));
    element.scrollTop = after;
    return after - before;
  }

  function consumeScroll(distance, textarea) {
    const consumed = textarea ? scroll(textarea, distance) : 0;
    return scroll(paper, distance - consumed);
  }

  function prevent(event) {
    if (event.cancelable) event.preventDefault();
  }

  function begin(source, kind, id, point, target) {
    if (disposed || !enabled() || (source === 'paper' ? !isOpen() : isOpen())) return false;
    reset();
    const interactive = Boolean(closest(target, INTERACTIVE));
    // Mouse selection and clicks on controls keep their usual behavior. Touch
    // still needs isolation, including when the gesture starts in a textarea.
    if (kind === 'mouse' && interactive) return false;
    const textarea = closest(target, 'textarea');
    gesture = {
      source, kind, id, interactive,
      textarea: textarea && paper.contains(textarea) ? textarea : null,
      startX: point.clientX, startY: point.clientY,
      lastY: point.clientY, lastAt: now(),
      atTop: paper.scrollTop <= 1,
      axis: '', mode: '', distance: 0, velocity: 0,
      blocked: source === 'paper' && isPrinting(),
    };
    return true;
  }

  function move(point, event) {
    const current = gesture;
    if (!current) return;
    if (!enabled() || (current.source === 'paper' ? !isOpen() : isOpen())) { reset(); return; }
    const x = point.clientX - current.startX;
    const y = point.clientY - current.startY;
    if (!current.axis) {
      if (Math.max(Math.abs(x), Math.abs(y)) < DIRECTION_SLOP) return;
      current.axis = Math.abs(y) > Math.abs(x) ? 'vertical' : 'horizontal';
    }
    if (current.axis !== 'vertical') return;
    prevent(event);
    current.distance = y;
    if (current.source === 'mouth') { onPull(Math.min(0, y)); return; }
    if (current.blocked || isPrinting()) {
      current.blocked = true;
      return;
    }
    if (!current.mode) {
      // Eligibility is decided at the beginning of a gesture, not when a long
      // read later reaches the paper's top edge.
      current.mode = current.atTop && !current.interactive && y > 0 ? 'pull' : 'read';
    }
    if (current.mode === 'pull') { onPull(Math.max(0, y)); return; }
    const time = now();
    const distance = consumeScroll(current.lastY - point.clientY, current.textarea);
    const elapsed = Math.max(8, time - current.lastAt);
    current.velocity = distance ? Math.max(-2.5, Math.min(2.5, distance / elapsed)) : 0;
    current.lastY = point.clientY;
    current.lastAt = time;
  }

  function coast(velocity) {
    if (Math.abs(velocity) < 0.08) return;
    let previous = now();
    const frame = time => {
      momentum = 0;
      if (disposed || !enabled() || !isOpen() || isPrinting() || gesture) return;
      const elapsed = Math.min(32, Math.max(0, time - previous));
      previous = time;
      const travelled = scroll(paper, velocity * elapsed);
      velocity *= Math.exp(-elapsed / 180);
      if ((elapsed && Math.abs(travelled) < 0.01) || Math.abs(velocity) < 0.02) return;
      momentum = window.requestAnimationFrame(frame);
    };
    momentum = window.requestAnimationFrame(frame);
  }

  function end() {
    const current = gesture;
    if (!current) return;
    cancelGesture();
    if (!enabled() || current.blocked || isPrinting() || current.axis !== 'vertical') return;
    if (current.kind === 'mouse') {
      suppressClick = { surface: current.source === 'paper' ? paper : mouth, until: now() + 350 };
    }
    if (current.source === 'mouth') {
      if (!isOpen() && current.distance <= -OPEN_DISTANCE) onOpen(current.distance);
    } else if (isOpen()) {
      if (current.mode === 'pull' && current.distance >= CLOSE_DISTANCE) onClose();
      else if (current.kind === 'touch' && current.mode === 'read' && !current.interactive && now() - current.lastAt < 100) {
        coast(current.velocity);
      }
    }
  }

  for (const [element, source] of [[paper, 'paper'], [mouth, 'mouth']]) {
    listen(element, 'touchstart', event => {
      if (event.touches.length !== 1) { reset(); return; }
      const touch = event.touches[0];
      begin(source, 'touch', touch.identifier, touch, event.target);
    }, { passive: true });
    listen(element, 'touchmove', event => {
      if (event.touches.length !== 1) { reset(); return; }
      if (gesture?.kind !== 'touch') return;
      const touch = Array.from(event.touches).find(item => item.identifier === gesture.id);
      if (touch) move(touch, event);
    }, { passive: false });
    listen(element, 'touchend', event => {
      if (gesture?.kind !== 'touch') return;
      if (event.touches.length) { reset(); return; }
      if (Array.from(event.changedTouches).some(item => item.identifier === gesture.id)) end();
    }, { passive: true });
    listen(element, 'touchcancel', reset, { passive: true });
    listen(element, 'pointerdown', event => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      if (begin(source, 'mouse', event.pointerId, event, event.target)) prevent(event);
    });
    listen(element, 'click', event => {
      if (suppressClick?.surface === element && suppressClick.until >= now()) {
        prevent(event);
        event.stopPropagation();
        suppressClick = undefined;
      }
    }, { capture: true });
  }

  // A second finger can land outside the paper; give the whole gesture back to
  // the browser for pinch zoom instead of retaining a stale one-finger drag.
  listen(document, 'touchstart', event => {
    if (event.touches.length > 1) reset();
  }, { passive: true });
  listen(document, 'pointermove', event => {
    if (gesture?.kind !== 'mouse' || gesture.id !== event.pointerId) return;
    if (event.buttons !== undefined && !(event.buttons & 1)) { reset(); return; }
    move(event, event);
  });
  listen(document, 'pointerup', event => {
    if (gesture?.kind === 'mouse' && gesture.id === event.pointerId) end();
  });
  listen(document, 'pointercancel', event => {
    if (gesture?.kind === 'mouse' && gesture.id === event.pointerId) reset();
  });
  listen(window, 'blur', reset);
  listen(paper, 'wheel', event => {
    if (!enabled() || !isOpen() || event.ctrlKey || !event.deltaY) return;
    prevent(event);
    reset();
    if (isPrinting()) return;
    const textarea = closest(event.target, 'textarea');
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? paper.clientHeight : 1;
    consumeScroll(event.deltaY * unit, textarea && paper.contains(textarea) ? textarea : null);
  }, { passive: false });

  return () => {
    disposed = true;
    reset();
    for (const remove of listeners) remove();
    suppressClick = undefined;
  };
}
