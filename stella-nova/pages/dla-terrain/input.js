// ============================================================================
//  DLA TERRAIN  ·  input.js — pointer, touch, wheel and camera keys (CAMERA)
// ----------------------------------------------------------------------------
//  createInput({ canvas, app, cam, world, ui: () => ui, hint, ready })
//    -> { keys, take(dt), leaveDrone(), resume() }
//  main.js "── INPUT" makes one and keeps its own keydown for the app keys
//  (F, O, G, P, T, N, B): that handler adds e.code to input.keys.
//
//  ORBIT  mouse: left drag turns round the ground under the pointer, right
//    drag (or shift, or the middle button) grabs the ground and drags it,
//    the wheel zooms to the ground under the cursor, a double click flies
//    there. Touch: one finger turns round the ground under it, two fingers
//    pan (the ground under the midpoint follows), pinch zoom and twist
//    round the midpoint; a double tap flies there. Keys: WASD / arrows
//    move, Q E zoom.
//  FLY  WASD / arrows move, E or Space up, Q or C down, Shift boost, the
//    wheel sets the speed factor, a drag looks; L locks the pointer for a
//    mouse look (Esc frees it). Touch: the left 42% of the canvas is a
//    virtual stick (move), a drag on the right looks.
//  DRONE  a drag, a pinch or WASD takes the camera over (fly mode, the
//    drone is held); R, or the Drone button (app.setCam('drone')),
//    resumes the flight. The wheel sets the drone speed.
//
//  The canvas has touch-action: none and pointer capture, so no gesture
//  goes to the page scroll or to the sheet. NDC comes from the canvas
//  rect; camera.js takes the clear-rect shift into account.
//
//  grep -n targets: "export function createInput", "function onDown",
//  "function onMove", "function endPtr", "function onWheel", "function stickUI"
// ============================================================================

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const STICK_R = 56;   // px, the virtual stick radius

export function createInput(o) {
  const { canvas, app, cam, world } = o;
  const ui = () => (o.ui ? o.ui() : null);
  const ready = () => (o.ready ? o.ready() : true);
  const keys = new Set();
  const ptrs = new Map();
  let look = [0, 0], touchMove = [0, 0, 0], two = null, stick = null, lastTap = null, lastPtrType = 'mouse';
  const now = () => performance.now();
  const touched = () => { app.lastInput = now(); if (o.hint) o.hint.classList.add('gone'); };
  const ndc = (x, y) => {
    const r = canvas.getBoundingClientRect();
    const w = r.width || innerWidth, h = r.height || innerHeight;
    return [2 * (x - (r.left || 0)) / w - 1, 1 - 2 * (y - (r.top || 0)) / h];
  };
  const sync = () => { const u = ui(); if (u) u.syncView(); };
  let toastAt = 0;
  const toast = (t, force) => { const u = ui(); if (u && u.toast && (force || now() - toastAt > 900)) { toastAt = now(); u.toast(t); } };

  function leaveDrone() {
    if (app.camMode !== 'drone') return;
    cam.setMode('fly', world); app.camMode = 'fly'; sync();
    toast(matchMedia('(pointer:coarse)').matches ? 'You fly now · tap Drone to fly on' : 'You fly now · R flies the drone on', true);
  }
  function resume() {
    if (cam.resumeDrone(world)) { app.camMode = 'drone'; sync(); return true; }
    return false;
  }

  // ── the virtual stick (fly mode, touch)
  let stickEl = null;
  function stickUI(on, x, y, kx, ky) {
    if (!stickEl && on) {
      stickEl = document.createElement('div');
      stickEl.setAttribute('aria-hidden', 'true');
      stickEl.style.cssText = `position:fixed;width:${2 * STICK_R}px;height:${2 * STICK_R}px;margin:${-STICK_R}px 0 0 ${-STICK_R}px;border-radius:50%;border:1.5px solid rgba(255,255,255,.55);background:rgba(0,0,0,.18);pointer-events:none;z-index:6;display:none`;
      const k = document.createElement('div');
      k.style.cssText = 'position:absolute;left:50%;top:50%;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(255,255,255,.55)';
      stickEl.appendChild(k);
      document.body.appendChild(stickEl);
    }
    if (!stickEl) return;
    stickEl.style.display = on ? 'block' : 'none';
    if (on) {
      stickEl.style.left = x + 'px'; stickEl.style.top = y + 'px';
      stickEl.firstChild.style.transform = `translate(${kx}px,${ky}px)`;
    }
  }

  // ── two fingers
  const pair = () => {
    const [a, b] = [...ptrs.values()];
    return { a, b, d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(-(b.y - a.y), b.x - a.x), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  };
  function beginTwo() {
    const p = pair();
    two = { d: p.d, ang: p.ang, cx: p.cx, cy: p.cy, d0: p.d, cx0: p.cx, cy0: p.cy };
    if (app.camMode === 'orbit') { cam.orbitEnd(); cam.orbitGestureBegin(...ndc(p.cx, p.cy), world); }
  }

  function onDown(e) {
    if (app.saverRun) return;
    canvas.focus({ preventScroll: true });
    lastPtrType = e.pointerType || 'mouse';
    try { canvas.setPointerCapture(e.pointerId); } catch { /* old browser */ }
    const p = { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey, x0: e.clientX, y0: e.clientY, t0: now(), type: lastPtrType, role: 'main' };
    ptrs.set(e.pointerId, p);
    touched();
    if (app.camMode === 'fly' && p.type !== 'mouse') {
      const r = canvas.getBoundingClientRect();
      if (!stick && e.clientX - r.left < r.width * 0.42) { p.role = 'stick'; stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY }; stickUI(true, e.clientX, e.clientY, 0, 0); return; }
      p.role = 'look';
      return;
    }
    const mains = [...ptrs.values()].filter(q => q.role === 'main').length;
    if (app.camMode === 'orbit') {
      if (mains === 1) {
        cam.orbitBegin(...ndc(e.clientX, e.clientY), world);
        p.pan = p.b === 2 || p.b === 1 || p.shift;
      } else if (mains === 2) beginTwo();
    }
  }

  function onMove(e) {
    if (document.pointerLockElement === canvas && e.pointerType === 'mouse') {
      if (app.camMode === 'fly') { look[0] += e.movementX || 0; look[1] += e.movementY || 0; touched(); }
      return;
    }
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    touched();
    if (p.role === 'stick' && stick) {
      let sx = e.clientX - stick.x0, sy = e.clientY - stick.y0;
      const l = Math.hypot(sx, sy);
      if (l > STICK_R) { sx *= STICK_R / l; sy *= STICK_R / l; }
      // a small dead zone, then the square of the push for fine control
      const m = v => { const a = Math.abs(v) / STICK_R; return Math.sign(v) * clamp((a - 0.08) / 0.92, 0, 1) ** 1.5; };
      touchMove = [m(sx), 0, -m(sy)];
      stickUI(true, stick.x0, stick.y0, sx, sy);
      return;
    }
    if (p.role === 'look') { look[0] += dx * 1.3; look[1] += dy * 1.3; return; }
    const mains = [...ptrs.values()].filter(q => q.role === 'main');
    if (app.camMode === 'drone') {
      if (mains.length > 1 || Math.abs(e.clientX - p.x0) + Math.abs(e.clientY - p.y0) > 6) leaveDrone();
      return;
    }
    if (mains.length === 1) {
      if (app.camMode === 'orbit') {
        if (p.pan) cam.orbitDrag(...ndc(e.clientX, e.clientY), world);
        else cam.orbitRotate(dx, dy);
      } else { look[0] += dx; look[1] += dy; }
    } else if (mains.length === 2) {
      if (!two) beginTwo();
      const q = pair();
      if (app.camMode === 'orbit') {
        let tw = q.ang - two.ang;
        tw = Math.atan2(Math.sin(tw), Math.cos(tw));
        cam.orbitGesture(...ndc(q.cx, q.cy), two.d / Math.max(1, q.d), tw, world);
      } else {
        // fly with a mouse and touch mix: a two-finger joystick
        touchMove = [clamp((q.cx - two.cx0) / 90, -1, 1), clamp(-(q.cy - two.cy0) / 90, -1, 1), clamp((q.d - two.d0) / 90, -1, 1)];
      }
      two.d = q.d; two.ang = q.ang; two.cx = q.cx; two.cy = q.cy;
    }
  }

  function flyToScreen(x, y) {
    if (!ready() || app.saverRun) return false;
    const [nx, ny] = ndc(x, y);
    let p = cam.pick(nx, ny, world);
    if (!p && app.lastMatrices && o.pickGround) p = o.pickGround(app.lastMatrices.invViewProj, nx, ny, world, world.size * 3);
    if (!p) return false;
    app.flyTo(p[0], p[2]);
    return true;
  }

  function endPtr(e) {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    ptrs.delete(e.pointerId);
    if (p.role === 'stick') { stick = null; touchMove = [0, 0, 0]; stickUI(false); return; }
    if (p.role === 'look') return;
    const mains = [...ptrs.values()].filter(q => q.role === 'main');
    if (two && mains.length < 2) {
      two = null; touchMove = [0, 0, 0];
      // one finger stays: it turns on from where it is, with no jump
      if (mains.length === 1 && app.camMode === 'orbit') { cam.orbitEnd(); const q = mains[0]; cam.orbitBegin(...ndc(q.x, q.y), world); q.pan = false; q.x0 = -1e9; }
    }
    if (!mains.length && app.camMode === 'orbit') cam.orbitEnd();
    if (e.type !== 'pointerup' || p.type === 'mouse' || mains.length) return;
    const t = now();
    if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 10 || t - p.t0 > 300) { lastTap = null; return; }
    if (lastTap && t - lastTap.t < 340 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
      lastTap = null;
      flyToScreen(e.clientX, e.clientY);
    } else lastTap = { t, x: e.clientX, y: e.clientY };
  }

  function onWheel(e) {
    e.preventDefault();
    if (app.saverRun) return;
    const s = -e.deltaY / (e.deltaMode === 1 ? 3 : e.deltaMode === 2 ? 0.3 : 100);
    if (!s) return;
    if (app.camMode === 'orbit') cam.orbitZoomAt(...ndc(e.clientX, e.clientY), clamp(s, -4, 4), world);
    else if (app.camMode === 'fly') toast(`Fly speed × ${cam.flySpeedStep(clamp(s, -3, 3)).toFixed(2)}`);
    else if (app.camMode === 'drone') {
      cam.droneSpeed = clamp(cam.droneSpeed * Math.pow(1.15, clamp(s, -3, 3)), 10, 600);
      toast(`Drone speed ${Math.round(cam.droneSpeed)} m/s`);
    }
    touched();
  }

  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', endPtr);
  canvas.addEventListener('pointercancel', endPtr);
  canvas.addEventListener('lostpointercapture', endPtr);
  canvas.addEventListener('dblclick', e => { e.preventDefault(); if (lastPtrType === 'mouse') flyToScreen(e.clientX, e.clientY); });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  // the camera keys (main.js has the app keys and fills keys)
  addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.metaKey || e.ctrlKey || e.altKey || app.saverRun) return;
    if (e.code === 'KeyR' && !e.repeat) { if (!resume() && app.camMode !== 'drone') toast('No drone flight to fly on'); }
    else if (e.code === 'KeyL' && !e.repeat && app.camMode === 'fly') {
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      else try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch { /* not allowed */ }
    }
  });
  if (typeof document !== 'undefined') document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement === canvas) toast('Mouse look · Esc frees the pointer', true); });

  function take() {
    const k = c => (keys.has(c) ? 1 : 0);
    const move = [
      k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft') + touchMove[0],
      k('KeyE') + k('Space') - k('KeyQ') - k('KeyC') + touchMove[1],
      k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown') + touchMove[2],
    ].map(v => clamp(v, -1, 1));
    const out = { look, move, boost: keys.has('ShiftLeft') || keys.has('ShiftRight') };
    look = [0, 0];
    if (move.some(v => v)) app.lastInput = now();
    if (app.camMode !== 'fly' && document.pointerLockElement === canvas) document.exitPointerLock();
    if (app.camMode !== 'fly' && stick) { stick = null; touchMove = [0, 0, 0]; stickUI(false); }
    return out;
  }

  return { keys, take, leaveDrone, resume };
}
