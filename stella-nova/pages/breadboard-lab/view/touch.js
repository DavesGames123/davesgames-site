// ============================================================================
//  BREADBOARD LAB  ·  view/touch.js — pointer gestures
// ----------------------------------------------------------------------------
//  One recognizer turns raw pointer events (mouse, pen, touch) into the
//  gestures the scene acts on (CONTRACT 4.2):
//    primary  : down, tap, dragstart, drag, dragend, longpress, cancel,
//               hover (mouse with no button)
//    navigate : orbit / pan (dx, dy px), zoom (factor, x, y), twist (rad)
//  Mouse: left = primary, right or middle drag = pan, wheel = zoom.
//  Touch: one finger = primary; a second finger cancels the primary and
//  starts two-finger mode (midpoint drag = pan, pinch = zoom, twist = yaw).
//  Long press (touch and pen, 550 ms, under 8 px of movement) = longpress.
//
//  The core (createGestures) takes plain event objects and an injected
//  clock and timer, so node tests drive it. attachGestures binds it to a
//  DOM element with pointer capture.
//
//  GREP MAP
//    TAP_PX / DRAG_PX / LONG_MS .. thresholds
//    createGestures .............. the state machine (down / move / up)
//    twoFinger ................... pinch, pan, twist from two pointers
//    wheel ....................... wheel and trackpad pinch (ctrl+wheel)
//    attachGestures .............. DOM listeners, capture, cleanup
// ============================================================================

export const DRAG_PX = { mouse: 4, pen: 6, touch: 8 };
export const LONG_MS = 550;

export function createGestures(h, env = {}) {
  const now = env.now || (() => Date.now());
  const setT = env.setTimeout || ((f, ms) => setTimeout(f, ms));
  const clrT = env.clearTimeout || (id => clearTimeout(id));
  const emit = (type, ev) => { if (h[type]) h[type](ev); if (h.any) h.any(type, ev); };

  const ptrs = new Map();              // pointerId → { x, y, type }
  let prim = null;                     // the primary gesture
  let nav = null;                      // mouse pan drag
  let two = null;                      // two-finger state
  let longTimer = null;

  const base = e => ({ x: e.clientX, y: e.clientY, shift: !!e.shiftKey, alt: !!e.altKey, meta: !!(e.metaKey || e.ctrlKey), pointerType: e.pointerType || 'mouse', button: e.button | 0 });

  function clearLong() { if (longTimer !== null) { clrT(longTimer); longTimer = null; } }

  function cancelPrimary() {
    clearLong();
    if (prim && !prim.done) { emit('cancel', { ...prim.last, dragging: prim.dragging }); prim.done = true; }
    prim = null;
  }

  function twoState() {
    const [a, b] = [...ptrs.values()];
    return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  function down(e) {
    const type = e.pointerType || 'mouse';
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, type });
    if (type === 'touch' && ptrs.size >= 2) {
      cancelPrimary();
      if (ptrs.size === 2) two = twoState();
      return;
    }
    if (type === 'mouse' && (e.button === 1 || e.button === 2)) {
      nav = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, button: e.button, start: base(e) };
      return;
    }
    if (prim) cancelPrimary();
    const ev = base(e);
    prim = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: now(), dragging: false, long: false, done: false, last: ev, type };
    emit('down', ev);
    if (type !== 'mouse') {
      longTimer = setT(() => {
        longTimer = null;
        if (prim && !prim.dragging && !prim.done) { prim.long = true; emit('longpress', prim.last); }
      }, LONG_MS);
    }
  }

  function move(e) {
    const p = ptrs.get(e.pointerId);
    if (!p) { if ((e.pointerType || 'mouse') === 'mouse' && !prim && !nav) emit('hover', base(e)); return; }
    p.x = e.clientX; p.y = e.clientY;
    if (two && ptrs.size === 2) {
      const s = twoState();
      const dx = s.mx - two.mx, dy = s.my - two.my;
      if (dx || dy) emit('pan', { dx, dy, x: s.mx, y: s.my, touch: true });
      if (two.d > 4 && s.d > 4 && Math.abs(s.d - two.d) > 0.5) emit('zoom', { factor: two.d / s.d, x: s.mx, y: s.my });
      let da = s.ang - two.ang;
      if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
      if (Math.abs(da) > 0.002) emit('twist', { da, x: s.mx, y: s.my });
      two = s;
      return;
    }
    if (nav && e.pointerId === nav.id) {
      const dx = e.clientX - nav.x, dy = e.clientY - nav.y;
      nav.x = e.clientX; nav.y = e.clientY; nav.moved += Math.abs(dx) + Math.abs(dy);
      emit('pan', { dx, dy, x: e.clientX, y: e.clientY, touch: false });
      return;
    }
    if (!prim || e.pointerId !== prim.id || prim.done) return;
    const ev = base(e);
    prim.last = ev;
    const dist = Math.hypot(e.clientX - prim.x0, e.clientY - prim.y0);
    if (!prim.dragging) {
      if (dist < (DRAG_PX[prim.type] || 4)) return;
      if (prim.long) return;                     // after a long press, no drag
      clearLong();
      prim.dragging = true;
      emit('dragstart', { ...ev, x0: prim.x0, y0: prim.y0, lx: prim.x0, ly: prim.y0 });
      prim.lx = prim.x0; prim.ly = prim.y0;
    }
    emit('drag', { ...ev, dx: e.clientX - prim.lx, dy: e.clientY - prim.ly, x0: prim.x0, y0: prim.y0 });
    prim.lx = e.clientX; prim.ly = e.clientY;
  }

  function up(e, cancelled = false) {
    const had = ptrs.get(e.pointerId);
    ptrs.delete(e.pointerId);
    if (two) {
      if (ptrs.size < 2) two = null;
      return;
    }
    if (nav && e.pointerId === nav.id) {
      const n = nav; nav = null;
      if (!cancelled && n.button === 2 && n.moved < 4) emit('context', { ...n.start, x: e.clientX, y: e.clientY });
      return;
    }
    if (!prim || e.pointerId !== prim.id) { if (!had) return; return; }
    clearLong();
    const p = prim; prim = null;
    if (p.done) return;
    const ev = { ...base(e), dragging: p.dragging };
    if (cancelled) { emit('cancel', ev); return; }
    if (p.dragging) emit('dragend', ev);
    else if (!p.long) emit('tap', { ...ev, ms: now() - p.t0 });
    emit('up', ev);
  }

  function wheel(e) {
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= 400;
    const pinch = !!e.ctrlKey;                   // trackpad pinch arrives as ctrl+wheel
    const factor = Math.exp(Math.max(-1, Math.min(1, dy * (pinch ? 0.01 : 0.0015))));
    emit('zoom', { factor, x: e.clientX, y: e.clientY, wheel: true });
  }

  return {
    down, move, up: e => up(e, false), cancel: e => up(e, true), wheel,
    reset() { clearLong(); ptrs.clear(); prim = null; nav = null; two = null; },
    get active() { return !!(prim || nav || two); },
    get dragging() { return !!(prim && prim.dragging); },
    get pointers() { return ptrs.size; },
  };
}

// Binds a recognizer to an element. Returns a function that removes it.
export function attachGestures(el, g) {
  const onDown = e => {
    if (e.pointerType === 'mouse' && e.button > 2) return;
    try { el.setPointerCapture(e.pointerId); } catch { /* old browsers */ }
    g.down(e);
    if (e.pointerType !== 'mouse') e.preventDefault();
  };
  const onMove = e => g.move(e);
  const onUp = e => { try { el.releasePointerCapture(e.pointerId); } catch { /* not captured */ } g.up(e); };
  const onCancel = e => g.cancel(e);
  const onWheel = e => { e.preventDefault(); g.wheel(e); };
  const onCtx = e => e.preventDefault();
  const onLeave = e => { if (e.pointerType === 'mouse' && !g.active) g.move({ ...e, clientX: -1e6, clientY: -1e6, pointerType: 'mouse', pointerId: -1 }); };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  el.addEventListener('pointerleave', onLeave);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('contextmenu', onCtx);
  if (el.style) el.style.touchAction = 'none';
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
    el.removeEventListener('pointerleave', onLeave);
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('contextmenu', onCtx);
    g.reset();
  };
}
