// ============================================================================
//  MATERIAL STUDIO  ·  camera.js — orbit camera and the matrix helpers
// ────────────────────────────────────────────────────────────────────────────
//  An orbit camera around a target point, driven by pointer input on the
//  viewport canvas. viewport.js calls update(dt, aspect) once per frame; the
//  return value says if the camera still moves (inertia, a frame animation or
//  the turntable), so the viewport renders on demand and stops when idle.
//
//  INPUT
//      left drag ............ orbit (yaw, pitch), with inertia
//      right / middle drag .. pan; also left drag with Ctrl or Cmd
//      Shift + drag ......... rotate the environment (onEnvRotate callback)
//      wheel / pinch ........ dolly toward the target
//      two-finger drag ...... pan (touch)
//      double click / tap ... frame the mesh (animated)
//      keys (canvas focus) .. arrows orbit, +/- zoom, F frame, R reset
//
//  MATRICES
//      Column-major Float32Array(16), WebGPU clip space (z in 0..1).
//      perspective() uses a right-handed view: the camera looks down -Z.
//
//  CONTENTS  (grep -n the name to jump)
//      mat4 helpers ...... m4mul, m4inv, lookAt, perspective, ortho
//      createOrbitCamera . the camera object and its input handlers
//      fitDist / frame ... framing of a bounding radius (aspect aware)
//      getState/setState . plain JSON for save and restore
// ============================================================================

// ------------------------------------------------------------ mat4 helpers
export function m4ident() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }

/** a * b (column-major). */
export function m4mul(a, b, out = new Float32Array(16)) {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return out;
}

/** General 4x4 inverse. Returns the identity for a singular matrix. */
export function m4inv(m, out = new Float32Array(16)) {
  const a = m, o = new Float64Array(16);
  o[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  o[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  o[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  o[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  o[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  o[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  o[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  o[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  o[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  o[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  o[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  o[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  o[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  o[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  o[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  o[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  const det = a[0] * o[0] + a[1] * o[4] + a[2] * o[8] + a[3] * o[12];
  if (!det) return m4ident();
  for (let i = 0; i < 16; i++) out[i] = o[i] / det;
  return out;
}

/** View matrix: camera at eye looking at center. */
export function lookAt(eye, center, up = [0, 1, 0], out = new Float32Array(16)) {
  let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz);
  if (l < 1e-6) { xx = 1; xy = 0; xz = 0; l = 1; }
  xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

/** Perspective projection, WebGPU depth 0..1. fovy in radians. */
export function perspective(fovy, aspect, near, far, out = new Float32Array(16)) {
  const f = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect; out[5] = f;
  out[10] = far / (near - far); out[11] = -1;
  out[14] = (near * far) / (near - far);
  return out;
}

/** Orthographic projection, WebGPU depth 0..1. */
export function ortho(l, r, b, t, n, f, out = new Float32Array(16)) {
  out.fill(0);
  out[0] = 2 / (r - l); out[5] = 2 / (t - b); out[10] = 1 / (n - f);
  out[12] = (l + r) / (l - r); out[13] = (t + b) / (b - t); out[14] = n / (n - f); out[15] = 1;
  return out;
}

// ------------------------------------------------------------ orbit camera
const DEFAULTS = { yaw: 0.55, pitch: 0.28, dist: 3.4, target: [0, 0, 0], fov: 35 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * @param {HTMLCanvasElement} canvas  pointer input source
 * @param {{onEnvRotate?:(deltaDeg:number)=>void, getRadius?:()=>number}} [opts]
 * @returns {object} camera (see the fields set below)
 */
export function createOrbitCamera(canvas, opts = {}) {
  const cam = {
    yaw: DEFAULTS.yaw, pitch: DEFAULTS.pitch, dist: DEFAULTS.dist,
    target: [...DEFAULTS.target], fov: DEFAULTS.fov,
    near: 0.05, far: 200,
    autoRotate: false, autoSpeed: 0.35, // rad/s
    view: m4ident(), proj: m4ident(), viewProj: m4ident(), invViewProj: m4ident(),
    eye: [0, 0, 3], aspect: 1,
    update, frame, reset, onChange, getState, setState, dispose, poke,
    get moving() { return isMoving(); },
  };
  const subs = new Set();
  let vYaw = 0, vPitch = 0, vPanX = 0, vPanY = 0;
  let anim = null;      // {from, to, t, dur}
  let dirty = true;

  function poke() { dirty = true; for (const fn of subs) { try { fn(); } catch (e) { console.error(e); } } }
  function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }
  function isMoving() {
    return !!anim || cam.autoRotate || Math.abs(vYaw) > 1e-4 || Math.abs(vPitch) > 1e-4 || Math.abs(vPanX) > 1e-5 || Math.abs(vPanY) > 1e-5;
  }

  function radius() { return (opts.getRadius && opts.getRadius()) || 1; }
  /** Distance that fits a sphere of radius r in the narrower of the two FOVs. */
  function fitDist(r) {
    const v = (cam.fov * Math.PI) / 180;
    const aspect = cam.aspect || (canvas.clientWidth / Math.max(1, canvas.clientHeight)) || 1;
    const h = 2 * Math.atan(Math.tan(v / 2) * aspect);
    return (r * 1.12) / Math.sin(Math.min(v, h) / 2);
  }

  /** Frame a sphere of radius r (default: the mesh radius). Animated unless
   *  `instant`. keepAngles false also resets yaw and pitch. */
  function frame(r = radius(), keepAngles = true, instant = false) {
    const to = { yaw: keepAngles ? cam.yaw : DEFAULTS.yaw, pitch: keepAngles ? cam.pitch : DEFAULTS.pitch, dist: fitDist(r), target: [0, 0, 0] };
    vYaw = vPitch = vPanX = vPanY = 0;
    if (instant) { anim = null; Object.assign(cam, { yaw: to.yaw, pitch: to.pitch, dist: to.dist, target: to.target }); dirty = true; }
    else anim = { from: { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, target: [...cam.target] }, to, t: 0, dur: 0.35 };
    poke();
  }
  function reset() { frame(radius(), false); }

  function pan(dx, dy) {
    // dx, dy in pixels -> world units at the target distance
    const h = canvas.clientHeight || 1;
    const k = (2 * cam.dist * Math.tan(((cam.fov * Math.PI) / 180) / 2)) / h;
    const v = cam.view; // rows of the rotation are the camera axes
    const rx = [v[0], v[4], v[8]], uy = [v[1], v[5], v[9]];
    for (let i = 0; i < 3; i++) cam.target[i] += (-dx * rx[i] + dy * uy[i]) * k;
  }

  /**
   * Advance inertia and animation, then rebuild the matrices.
   * @param {number} dt seconds  @param {number} aspect width / height
   * @returns {boolean} true while the camera moves
   */
  function update(dt, aspect) {
    dt = Math.min(0.05, Math.max(0, dt || 0));
    const moving = isMoving();
    if (anim) {
      anim.t += dt / anim.dur;
      const t = Math.min(1, anim.t), e = 1 - Math.pow(1 - t, 3);
      let dy = anim.to.yaw - anim.from.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      cam.yaw = anim.from.yaw + dy * e;
      cam.pitch = anim.from.pitch + (anim.to.pitch - anim.from.pitch) * e;
      cam.dist = anim.from.dist + (anim.to.dist - anim.from.dist) * e;
      for (let i = 0; i < 3; i++) cam.target[i] = anim.from.target[i] + (anim.to.target[i] - anim.from.target[i]) * e;
      if (t >= 1) anim = null;
    }
    if (!drag) {
      cam.yaw += vYaw * dt * 60; cam.pitch += vPitch * dt * 60;
      if (vPanX || vPanY) pan(vPanX * dt * 60, vPanY * dt * 60);
      const k = Math.exp(-dt * 7);
      vYaw *= k; vPitch *= k; vPanX *= k; vPanY *= k;
      if (Math.abs(vYaw) < 1e-4) vYaw = 0;
      if (Math.abs(vPitch) < 1e-4) vPitch = 0;
      if (Math.abs(vPanX) < 1e-3) vPanX = 0;
      if (Math.abs(vPanY) < 1e-3) vPanY = 0;
    }
    if (cam.autoRotate && !drag) cam.yaw += cam.autoSpeed * dt;
    cam.pitch = clamp(cam.pitch, -1.55, 1.55);
    cam.dist = clamp(cam.dist, 0.4, 60);
    if (aspect && aspect !== cam.aspect) { cam.aspect = aspect; dirty = true; }
    if (moving || dirty) {
      const cp = Math.cos(cam.pitch);
      cam.eye = [
        cam.target[0] + cam.dist * cp * Math.sin(cam.yaw),
        cam.target[1] + cam.dist * Math.sin(cam.pitch),
        cam.target[2] + cam.dist * cp * Math.cos(cam.yaw),
      ];
      lookAt(cam.eye, cam.target, [0, 1, 0], cam.view);
      cam.near = Math.max(0.01, cam.dist * 0.02);
      cam.far = cam.dist * 40 + 20;
      perspective((cam.fov * Math.PI) / 180, cam.aspect, cam.near, cam.far, cam.proj);
      m4mul(cam.proj, cam.view, cam.viewProj);
      m4inv(cam.viewProj, cam.invViewProj);
      dirty = false;
    }
    return isMoving();
  }

  // -------------------------------------------------------- pointer input
  const pts = new Map(); // pointerId -> {x, y}
  let drag = null;       // {mode:'orbit'|'pan'|'env', x, y}
  let pinch = null;      // {d, mx, my}
  let lastTap = 0;

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button > 2) return;
    canvas.setPointerCapture?.(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    anim = null;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      drag = null;
    } else if (pts.size === 1) {
      let mode = 'orbit';
      if (e.button === 1 || e.button === 2 || e.ctrlKey || e.metaKey) mode = 'pan';
      else if (e.shiftKey) mode = 'env';
      drag = { mode, x: e.clientX, y: e.clientY };
      vYaw = vPitch = vPanX = vPanY = 0;
      // double tap on touch frames the mesh (dblclick covers mice)
      if (e.pointerType !== 'mouse') {
        const now = performance.now();
        if (now - lastTap < 300) frame();
        lastTap = now;
      }
    }
    e.preventDefault();
  }
  function onMove(e) {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (pinch.d > 0 && d > 0) cam.dist *= pinch.d / d;
      pan(mx - pinch.mx, my - pinch.my);
      pinch = { d, mx, my };
      poke();
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.mode === 'orbit') {
      const k = 0.0085;
      cam.yaw -= dx * k; cam.pitch += dy * k;
      vYaw = -dx * k * 0.5; vPitch = dy * k * 0.5;
    } else if (drag.mode === 'pan') {
      pan(dx, dy); vPanX = dx * 0.5; vPanY = dy * 0.5;
    } else if (drag.mode === 'env' && opts.onEnvRotate) {
      opts.onEnvRotate(dx * 0.4);
    }
    poke();
  }
  function onUp(e) {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0) {
      // keep the release velocity only for a fast flick
      if (drag && drag.mode !== 'orbit') { vPanX *= 0.6; vPanY *= 0.6; }
      drag = null;
    } else if (pts.size === 1) {
      const [p] = [...pts.values()];
      drag = { mode: 'orbit', x: p.x, y: p.y };
    }
    poke();
  }
  function onWheel(e) {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (e.ctrlKey && Math.abs(dy) < 50) cam.dist *= Math.exp(dy * 0.01); // trackpad pinch
    else cam.dist *= Math.exp(dy * 0.0012);
    anim = null;
    poke();
  }
  function onKey(e) {
    const step = e.shiftKey ? 0.2 : 0.06;
    switch (e.key) {
      case 'ArrowLeft': cam.yaw += step; break;
      case 'ArrowRight': cam.yaw -= step; break;
      case 'ArrowUp': cam.pitch += step; break;
      case 'ArrowDown': cam.pitch -= step; break;
      case '+': case '=': cam.dist *= 0.9; break;
      case '-': case '_': cam.dist *= 1.1; break;
      case 'f': case 'F': frame(); break;
      case 'r': case 'R': reset(); break;
      default: return;
    }
    e.preventDefault();
    poke();
  }
  const onDbl = e => { e.preventDefault(); frame(); };
  const onCtx = e => e.preventDefault();

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('lostpointercapture', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDbl);
  canvas.addEventListener('contextmenu', onCtx);
  canvas.addEventListener('keydown', onKey);
  if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = 0;

  function dispose() {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('lostpointercapture', onUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('dblclick', onDbl);
    canvas.removeEventListener('contextmenu', onCtx);
    canvas.removeEventListener('keydown', onKey);
    subs.clear();
  }

  function getState() { return { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, target: [...cam.target], fov: cam.fov }; }
  function setState(s) {
    if (!s) return;
    for (const k of ['yaw', 'pitch', 'dist', 'fov']) if (Number.isFinite(s[k])) cam[k] = s[k];
    if (Array.isArray(s.target) && s.target.length === 3 && s.target.every(Number.isFinite)) cam.target = [...s.target];
    cam.fov = clamp(cam.fov, 10, 100);
    dirty = true; poke();
  }

  update(0, canvas.clientWidth / Math.max(1, canvas.clientHeight));
  return cam;
}
