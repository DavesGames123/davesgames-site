// ============================================================================
//  CORAL REEF  ·  input.js  ·  pointer, touch, wheel and keys for camera.js
// ----------------------------------------------------------------------------
//  createInput({ canvas, cam, onTap, onMode, hint, flyOk }) -> { take(dt), keys,
//  dispose() }. main.js calls take(dt) each frame before cam.update.
//
//  ORBIT  mouse: a left drag turns round the rock under the pointer; a
//    right or middle drag (or Shift + drag) grabs the rock and pans; the
//    wheel zooms to the rock under the cursor; a double click flies there.
//    Touch: one finger turns, two fingers pan (the rock under the
//    midpoint follows), pinch zooms, twist turns; a double tap flies.
//    Keys: WASD or the arrows move the target, Q and E zoom.
//  SWIM  WASD or the arrows move (forward is along the view), E or Space
//    up, Q or C down, Shift fast; the wheel sets the speed. A click locks
//    the pointer for a mouse look (Esc frees it); with no lock a drag
//    looks. Touch: the left 42 % of the canvas is a stick (move), a drag
//    on the right looks.
//  FOLLOW  a drag looks round the ROV; the wheel and pinch set the
//    distance.
//  TOUR  a drag, a key, a pinch or the wheel takes over: swim mode at the
//    same pose and speed.
//  SAVER  no input.
//  Keys of the camera: F swim or orbit, G follow the ROV. A key goes to
//  the camera only when no text field has the focus and no Ctrl, Alt or
//  Meta is down.
//  onTap(x, y, kind): kind 'tap' or 'double' (client px), for the plant
//  mode of main.js. onMode(mode) after a key or a take-over changes mode.
//  flyOk() -> false stops the double tap fly (main.js: in plant mode).
//
//  grep -n targets: "export function createInput", "function onDown",
//  "function onMove", "function onUp", "function onWheel", "function take",
//  "function stickUI", "export function tapKind"
// ============================================================================

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const STICK_R = 56;          // px, the swim stick radius
export const TAP_PX = 9, TAP_MS = 320, DOUBLE_MS = 340, DOUBLE_PX = 30;

// 'tap' | 'double' | 'drag' for a press (down) and release (up), with the
// last tap (or null). Points are { x, y, t } (px, ms).
export function tapKind(down, up, lastTap) {
  if (Math.hypot(up.x - down.x, up.y - down.y) > TAP_PX || up.t - down.t > TAP_MS) return 'drag';
  if (lastTap && up.t - lastTap.t < DOUBLE_MS && Math.hypot(up.x - lastTap.x, up.y - lastTap.y) < DOUBLE_PX) return 'double';
  return 'tap';
}

export function createInput(o) {
  const { canvas, cam } = o;
  const doc = canvas.ownerDocument || (typeof document !== 'undefined' ? document : null);
  const win = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);
  const keys = new Set();
  const ptrs = new Map();
  let two = null, stick = null, look = null, lastTap = null, dragKind = null;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const rect = () => { const r = canvas.getBoundingClientRect(); return { x: r.left || 0, y: r.top || 0, w: r.width || (win && win.innerWidth) || 1, h: r.height || (win && win.innerHeight) || 1 }; };
  const ndc = (x, y) => { const r = rect(); return [2 * (x - r.x) / r.w - 1, 1 - 2 * (y - r.y) / r.h]; };
  const touched = () => { cam.noteInput(); if (o.hint) o.hint.classList.add('gone'); };
  const mode = () => cam.mode;
  const locked = () => doc && doc.pointerLockElement === canvas;
  const takeover = () => { if (mode() === 'tour') { cam.takeOver(); if (o.onMode) o.onMode(cam.mode); } };

  // ── the stick (swim, touch) ───────────────────────────────────────────────
  let ring = null, knob = null;
  function stickUI(on, x, y, dx = 0, dy = 0) {
    if (!doc || !doc.body) return;
    if (!ring) {
      ring = doc.createElement('div'); knob = doc.createElement('div');
      ring.setAttribute('aria-hidden', 'true'); knob.setAttribute('aria-hidden', 'true');
      ring.style.cssText = `position:fixed;z-index:23;width:${STICK_R * 2}px;height:${STICK_R * 2}px;margin:-${STICK_R}px 0 0 -${STICK_R}px;border:2px solid rgba(207,230,224,0.45);border-radius:50%;pointer-events:none;display:none;background:rgba(5,20,28,0.25)`;
      knob.style.cssText = 'position:fixed;z-index:23;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;pointer-events:none;display:none;background:rgba(207,230,224,0.5)';
      doc.body.appendChild(ring); doc.body.appendChild(knob);
    }
    ring.style.display = knob.style.display = on ? 'block' : 'none';
    if (!on) return;
    ring.style.left = `${x}px`; ring.style.top = `${y}px`;
    knob.style.left = `${x + dx}px`; knob.style.top = `${y + dy}px`;
  }

  // ── pointers ──────────────────────────────────────────────────────────────
  function onDown(e) {
    if (mode() === 'saver') return;
    touched();
    try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* old browser */ }
    const p = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: now(), type: e.pointerType || 'mouse', btn: e.button, shift: e.shiftKey, moved: false };
    ptrs.set(e.pointerId, p);
    const m = mode(), r = rect();
    if (ptrs.size === 2) {
      // two fingers: end the one-finger turn, begin the gesture
      const [a, b] = [...ptrs.values()];
      two = { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1, ang: Math.atan2(b.y - a.y, b.x - a.x) };
      stick = null; look = null; stickUI(false);
      if (m === 'orbit') { cam.orbitEnd(); const q = ndc(two.mx, two.my); cam.gestureBegin(q[0], q[1]); }
      dragKind = 'two';
      return;
    }
    if (ptrs.size > 2) return;
    if (m === 'swim' || m === 'tour') {
      if (p.type === 'touch' && e.clientX - r.x < r.w * 0.42) { stick = { id: p.id, x: e.clientX, y: e.clientY, dx: 0, dy: 0 }; stickUI(true, e.clientX, e.clientY); dragKind = 'stick'; return; }
      if (p.type === 'mouse' && m === 'swim' && !locked() && canvas.requestPointerLock && e.button === 0) { try { const q = canvas.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch (x) { /* no lock: drag to look */ } }
      look = { id: p.id }; dragKind = 'look';
      return;
    }
    if (m === 'follow') { look = { id: p.id }; dragKind = 'look'; return; }
    // orbit
    const q = ndc(e.clientX, e.clientY);
    if (p.type === 'mouse' && (e.button === 1 || e.button === 2 || e.shiftKey)) { cam.panBegin(q[0], q[1]); dragKind = 'pan'; }
    else { cam.orbitBegin(q[0], q[1]); dragKind = 'turn'; }
  }
  function onMove(e) {
    if (mode() === 'saver') return;
    if (locked()) {
      // the mouse look with the pointer locked (client x and y stay still)
      const k = 0.0024, mx = e.movementX || 0, my = e.movementY || 0;
      if (mode() === 'tour' && Math.abs(mx) + Math.abs(my) > 2) takeover();
      if (mode() === 'swim') cam.swimInput(null, [mx * k, -my * k]);
      return;
    }
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (Math.hypot(p.x - p.x0, p.y - p.y0) > TAP_PX) p.moved = true;
    const r = rect(), m = mode();
    if (two && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, d = Math.hypot(a.x - b.x, a.y - b.y) || 1, ang = Math.atan2(b.y - a.y, b.x - a.x);
      const scale = d / two.d; let tw = ang - two.ang;
      if (tw > Math.PI) tw -= 2 * Math.PI; if (tw < -Math.PI) tw += 2 * Math.PI;
      if (m === 'tour') takeover();
      const mm = mode();
      if (mm === 'orbit' || mm === 'follow') { const q = ndc(mx, my); cam.gesture(q[0], q[1], scale, tw); }
      else if (mm === 'swim') cam.swimInput(null, [-(mx - two.mx) * 0.004, (my - two.my) * 0.004]);
      two = { mx, my, d, ang };
      touched();
      return;
    }
    if (dragKind === 'stick' && stick && stick.id === e.pointerId) {
      let sx = e.clientX - stick.x, sy = e.clientY - stick.y; const l = Math.hypot(sx, sy);
      if (l > STICK_R) { sx *= STICK_R / l; sy *= STICK_R / l; }
      stick.dx = sx; stick.dy = sy; stickUI(true, stick.x, stick.y, sx, sy);
      if (l > 6) takeover();
      return;
    }
    if (dragKind === 'look') {
      if (!p.moved) return;
      const k = Math.PI * 1.1 / Math.max(300, r.h);
      if (m === 'tour') takeover();
      if (mode() === 'swim') cam.swimInput(null, [dx * k * (p.type === 'touch' ? 1.2 : 1), -dy * k]);
      else if (mode() === 'follow') cam.followLook(dx * k * 1.4, dy * k);
      touched();
      return;
    }
    if (dragKind === 'pan') { const q = ndc(e.clientX, e.clientY); cam.panMove(q[0], q[1]); touched(); return; }
    if (dragKind === 'turn' && p.moved) { cam.orbitRotate(dx, dy, r.h); touched(); }
  }
  function onUp(e) {
    const p = ptrs.get(e.pointerId);
    ptrs.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch (x) { /* not captured */ }
    if (stick && stick.id === e.pointerId) { stick = null; stickUI(false); }
    if (look && look.id === e.pointerId) look = null;
    if (ptrs.size < 2) two = null;
    if (ptrs.size === 1 && mode() === 'orbit') {
      // one finger left after a gesture: go on turning round it, no tap
      const [q] = [...ptrs.values()]; q.moved = true; const n = ndc(q.x, q.y); cam.orbitBegin(n[0], n[1]); dragKind = 'turn';
    }
    if (!ptrs.size) { if (mode() === 'orbit') cam.orbitEnd(); dragKind = null; }
    if (!p || e.type === 'pointercancel' || mode() === 'saver') return;
    const k = tapKind({ x: p.x0, y: p.y0, t: p.t }, { x: e.clientX, y: e.clientY, t: now() }, lastTap);
    if (k === 'drag' || p.moved) return;
    lastTap = k === 'double' ? null : { x: e.clientX, y: e.clientY, t: now() };
    if (k === 'double' && (mode() === 'orbit' || mode() === 'tour') && (!o.flyOk || o.flyOk())) {
      if (mode() === 'tour') cam.setMode('orbit');
      const q = ndc(e.clientX, e.clientY); cam.flyTo(q[0], q[1]);
      if (o.onMode) o.onMode(cam.mode);
    }
    if (o.onTap) o.onTap(e.clientX, e.clientY, k);
  }
  function onWheel(e) {
    if (mode() === 'saver') return;
    e.preventDefault();
    touched();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    const m = mode();
    if (m === 'swim' || m === 'tour') { takeover(); cam.swimSpeed(Math.exp(-clamp(dy, -200, 200) * 0.002)); return; }
    const q = ndc(e.clientX, e.clientY);
    cam.zoomAt(q[0], q[1], Math.exp(clamp(dy, -300, 300) * 0.0016));
  }
  const typing = (e) => { const t = e.target; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')); };
  const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyC', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
  function onKey(e) {
    if (mode() === 'saver' || e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
    if (e.type === 'keyup') { keys.delete(e.code); return; }
    if (MOVE_KEYS.has(e.code)) {
      keys.add(e.code);
      if (e.code !== 'ShiftLeft' && e.code !== 'ShiftRight') { takeover(); touched(); }
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      return;
    }
    if (e.repeat) return;
    if (e.code === 'KeyF') { cam.setMode(mode() === 'swim' ? 'orbit' : 'swim'); if (o.onMode) o.onMode(cam.mode); }
    else if (e.code === 'KeyG') { cam.follow(cam.followId); if (o.onMode) o.onMode(cam.mode); }
  }
  const blur = () => { keys.clear(); };
  const noMenu = (e) => { if (mode() === 'orbit') e.preventDefault(); };
  const onLock = () => { if (!locked()) keys.delete('ShiftLeft'); };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', noMenu);
  if (doc) doc.addEventListener('pointerlockchange', onLock);
  if (win) { win.addEventListener('keydown', onKey); win.addEventListener('keyup', onKey); win.addEventListener('blur', blur); }

  // Each frame: the keys and the stick to the camera.
  function take(dt) {
    const m = mode();
    const k = (c) => keys.has(c);
    const fwd = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    const side = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    const boost = k('ShiftLeft') || k('ShiftRight');
    if (m === 'swim') {
      const up = (k('KeyE') || k('Space') ? 1 : 0) - (k('KeyQ') || k('KeyC') ? 1 : 0);
      let mv = [side, up, fwd];
      if (stick) mv = [clamp(stick.dx / STICK_R, -1, 1), mv[1], clamp(-stick.dy / STICK_R, -1, 1)];
      cam.swimInput(mv, null, boost);
    } else if (m === 'orbit') {
      const zoom = (k('KeyQ') ? 1 : 0) - (k('KeyE') ? 1 : 0);
      cam.orbitKeys(side, fwd, zoom, dt * (boost ? 3 : 1));
    } else if (m === 'follow') {
      const zoom = (k('KeyQ') ? 1 : 0) - (k('KeyE') ? 1 : 0);
      if (zoom) cam.zoomAt(null, null, Math.exp(zoom * dt * 1.2));
      if (side) cam.followLook(side * dt * 1.4, 0);
    }
  }
  function dispose() {
    canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('contextmenu', noMenu);
    if (doc) doc.removeEventListener('pointerlockchange', onLock);
    if (win) { win.removeEventListener('keydown', onKey); win.removeEventListener('keyup', onKey); win.removeEventListener('blur', blur); }
    stickUI(false);
  }
  return { take, keys, dispose, get pointers() { return ptrs.size; } };
}
