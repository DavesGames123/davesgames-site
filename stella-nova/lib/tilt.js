// ============================================================================
//  TILT  ·  lib/tilt.js — a slight camera parallax from the phone's tilt
// ----------------------------------------------------------------------------
//  The site owner asked: "can we make 3d pages slightly reactive to the
//  phone's accelerometer?" This module answers that request. When the user
//  tilts a phone or a tablet, the camera of a 3D page turns a few degrees
//  round the point it looks at. The scene then seems to stay fixed in the
//  room behind the glass.
//
//  OPT-IN (one line per page, in index.html, AFTER the importmap)
//    <script type="module" src="../../lib/tilt.js"></script>
//  The module finds three.js itself: the global THREE of the classic
//  builds (r128, r139), or import('three') through the page's importmap
//  (r160, r185). A page that imports three by a plain URL calls
//    snTilt.three(THREE)
//  A page with a composer that renders to a target of another size, or
//  with a camera rig, can give the camera and the pivot:
//    snTilt.attach({ camera, controls })     // controls.target is the pivot
//    snTilt.attach({ camera, pivot: vec3 })
//  WebGPU and custom-camera pages read the plain offsets once per frame:
//    const { yaw, pitch } = snTilt.get();    // radians, 0 when off
//  or turn the eye of their own lookAt (import { tiltEye } from this file):
//    view = lookAt(tiltEye(eye, target, up), target, up);
//
//  HOW THE THREE.JS WRAP WORKS
//    WebGLRenderer.render calls scene.onBeforeRender after it updates the
//    camera matrices, and scene.onAfterRender at the end. The module puts
//    a hook on Scene.prototype for both (r128 to r185). Before a frame, it
//    turns camera.matrixWorld round the pivot and sets matrixWorldInverse.
//    After the frame, it copies back the two saved matrices, bit for bit.
//    The module never writes camera.position, camera.quaternion or
//    controls.target. OrbitControls, damping and the page's own code thus
//    never see the offset.
//    The pivot is, in order: an attached pivot or controls.target, else the
//    last point given to camera.lookAt (OrbitControls.update calls it), if
//    that point is still on the view axis, else the world origin projected
//    on the view axis, else a point at |camera.position| along the view.
//    The wrap applies to perspective cameras with no parent or the scene as
//    parent. It applies to the default framebuffer, and to a render target
//    with the canvas aspect and at least 64 px (an EffectComposer pass, a
//    render-scale pass). It never applies in WebXR, to small or square
//    targets (picking, reflections) or to an orthographic camera, unless
//    the page attaches that camera.
//
//  SIGNAL PATH  (the pure core, createCore; tools/tilt-check.mjs tests it)
//    deviceorientation alpha, beta, gamma  ->  quaternion (W3C Z-X'-Y'')
//    -> screen frame (turn by the screen angle: portrait, landscape left or
//       right, upside down)
//    -> rotation relative to a NEUTRAL pose. The neutral pose follows the
//       current pose with a time constant of TAU s, so any hold is
//       "centre" after a few seconds. The quaternion has no gimbal jump:
//       near beta = 90 the browser can flip alpha, beta and gamma together,
//       but the quaternion stays the same.
//    -> rotation vector, x = pitch, y = yaw (screen roll is not used)
//    -> dead zone (hand tremor), gain, soft clamp (tanh) to MAX_DEG
//    -> critically damped spring per axis (exact step, no overshoot)
//    It recentres on orientation change, on a return to a visible tab,
//    and when tilt turns on again.
//
//  WHEN IT IS OFF  (get() returns zeros and the wrap does nothing)
//    - a desktop: the module starts only when (pointer: coarse) and
//      (hover: none) match
//    - prefers-reduced-motion: reduce
//    - the screensaver: html.sn-saver on the page, or body.sn-saver-on in
//      the shell. Saver framing thus does not change.
//    - the setting: localStorage 'sn-tilt' = '0'. The shell has a "Tilt"
//      button in the sidebar footer (phones only). Other ways:
//      snTilt.set(false), or ?tilt=0 in the page URL. A storage event from
//      the shell turns pages on and off at once.
//    - the tab is hidden, or no sensor event came in the last 0.5 s
//
//  PERMISSION
//    iOS needs DeviceOrientationEvent.requestPermission() from a user
//    gesture. The module asks on the first touchend or click on the page,
//    if no sensor event has come yet. It shows no dialog of its own. When
//    the user refuses, the module stays off and does not ask again on that
//    page. Android needs no permission.
//
//  grep -n targets
//    tuning ............... "export const TUNING"
//    sensor maths ......... "export function quatFromEuler"
//    pure core ............ "export function createCore"
//    setting .............. "export function readSetting"
//    controller ........... "export function createTilt"
//    three.js wrap ........ "export function installThree"
//    custom cameras ....... "export function tiltEye"
//    permission ........... "function askPermission"
//    browser boot ......... "export function bootTilt"
// ============================================================================

const D2R = Math.PI / 180;

export const TUNING = {
  gain: 0.35,       // camera degrees per degree of phone tilt
  maxDeg: 4,        // soft limit of the camera offset
  deadDeg: 0.35,    // tilt below this is hand tremor
  tau: 2.5,         // s, the neutral pose follows the hold
  omega: 7,         // rad/s, the spring (settles in about 0.7 s)
  staleMs: 500,     // no event for this time: target goes to 0
  key: 'sn-tilt',   // localStorage key, '0' is off
};

// ---------------------------------------------------------------- maths ----
// Quaternions are [x, y, z, w].

// W3C DeviceOrientation: intrinsic Z-X'-Y'' with alpha (z), beta (x),
// gamma (y), in degrees. Result: device frame to earth frame.
export function quatFromEuler(alpha, beta, gamma) {
  const x = (beta || 0) * D2R / 2, y = (gamma || 0) * D2R / 2, z = (alpha || 0) * D2R / 2;
  const cX = Math.cos(x), cY = Math.cos(y), cZ = Math.cos(z);
  const sX = Math.sin(x), sY = Math.sin(y), sZ = Math.sin(z);
  return [
    sX * cY * cZ - cX * sY * sZ,
    cX * sY * cZ + sX * cY * sZ,
    cX * cY * sZ + sX * sY * cZ,
    cX * cY * cZ - sX * sY * sZ,
  ];
}

export function qmul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function qconj(q) { return [-q[0], -q[1], -q[2], q[3]]; }

function qnorm(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

// The device frame turned to the screen frame. angle = screen.orientation
// .angle in degrees (0 portrait, 90 landscape with the top to the left,
// 270 or -90 landscape with the top to the right, 180 upside down).
export function screenQuat(q, angleDeg) {
  const h = -(angleDeg || 0) * D2R / 2;
  return qmul(q, [0, 0, Math.sin(h), Math.cos(h)]);
}

// Rotation vector (axis * angle, radians) of conj(n) * q, in n's frame.
export function relVector(n, q) {
  let r = qmul(qconj(n), q);
  if (r[3] < 0) r = [-r[0], -r[1], -r[2], -r[3]];
  const s = Math.hypot(r[0], r[1], r[2]);
  if (s < 1e-12) return [0, 0, 0];
  const a = 2 * Math.atan2(s, r[3]) / s;
  return [r[0] * a, r[1] * a, r[2] * a];
}

// Normalised lerp from a toward b by t (small steps, so it acts as slerp).
export function qnlerp(a, b, t) {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = d < 0 ? -1 : 1;
  return qnorm([
    a[0] + (s * b[0] - a[0]) * t, a[1] + (s * b[1] - a[1]) * t,
    a[2] + (s * b[2] - a[2]) * t, a[3] + (s * b[3] - a[3]) * t,
  ]);
}

// Exact step of a critically damped spring toward g.
export function springStep(x, v, g, omega, dt) {
  const y = x - g, e = Math.exp(-omega * dt), k = (v + omega * y) * dt;
  return [g + (y + k) * e, (v - omega * k) * e];
}

// Dead zone, gain and soft clamp on the (pitch, yaw) vector, radians.
export function shape(px, py, t = TUNING) {
  const m = Math.hypot(px, py);
  const dz = t.deadDeg * D2R, mx = t.maxDeg * D2R;
  if (m <= dz) return [0, 0];
  const out = mx * Math.tanh(((m - dz) * t.gain) / mx);
  return [px / m * out, py / m * out];
}

// ------------------------------------------------------------ pure core ----
// push(event, screenAngle, tMs) takes one sensor event; step(tMs) moves the
// spring and returns { yaw, pitch } in radians. No DOM.
export function createCore(tuning = TUNING) {
  const t = { ...TUNING, ...tuning };
  const S = {
    neutral: null, cur: null, lastEv: -1, angle: 0, target: [0, 0],
    x: [0, 0], v: [0, 0], lastStep: -1, recentre: true,
  };
  function push(ev, angle, now) {
    if (!ev || (ev.beta == null && ev.gamma == null)) return false;
    const a = angle || 0;
    if (a !== S.angle) { S.angle = a; S.recentre = true; }
    const q = screenQuat(quatFromEuler(ev.alpha, ev.beta, ev.gamma), a);
    if (S.recentre || !S.neutral) { S.neutral = q; S.recentre = false; }
    else {
      const dt = Math.min(Math.max((now - S.lastEv) / 1000, 0), 0.5);
      S.neutral = qnlerp(S.neutral, q, 1 - Math.exp(-dt / t.tau));
    }
    S.cur = q; S.lastEv = now;
    const r = relVector(S.neutral, q);
    S.target = shape(r[0], r[1], t);
    return true;
  }
  function step(now, active = true) {
    const dt = S.lastStep < 0 ? 0 : Math.min(Math.max((now - S.lastStep) / 1000, 0), 0.25);
    S.lastStep = now;
    if (!active) { reset(); return { yaw: 0, pitch: 0 }; }
    const stale = S.lastEv < 0 || now - S.lastEv > t.staleMs;
    const g = stale ? [0, 0] : S.target;
    for (let i = 0; i < 2; i++) {
      const r = springStep(S.x[i], S.v[i], g[i], t.omega, dt);
      S.x[i] = r[0]; S.v[i] = r[1];
    }
    const mx = t.maxDeg * D2R;
    const c = (u) => (u > mx ? mx : u < -mx ? -mx : u);
    return { pitch: c(S.x[0]), yaw: c(S.x[1]) };
  }
  function recentre() { S.recentre = true; S.target = [0, 0]; }
  function reset() { S.x = [0, 0]; S.v = [0, 0]; S.recentre = true; S.target = [0, 0]; }
  return { push, step, recentre, reset, state: S, tuning: t };
}

// -------------------------------------------------------------- setting ----
export function readSetting(storage, key = TUNING.key) {
  try { return storage.getItem(key) !== '0'; } catch (e) { return true; }
}
export function writeSetting(storage, on, key = TUNING.key) {
  try { storage.setItem(key, on ? '1' : '0'); } catch (e) {}
}

// ----------------------------------------------------------- controller ----
// env = { now(), visible(), saver(), reducedMotion(), storage, search }
export function createTilt(env = {}, tuning) {
  const core = createCore(tuning);
  const now = env.now || (() => Date.now());
  const ctl = {
    core,
    supported: !!env.supported,
    permission: env.permission || 'unknown', // unknown | granted | denied
    enabled: readSetting(env.storage) && !/(?:^|[?&])tilt=0(?:&|$)/.test(env.search || ''),
    attached: new Map(),
    last: { yaw: 0, pitch: 0, t: -1 },
  };
  ctl.active = () => !!(ctl.supported && ctl.enabled && ctl.permission !== 'denied'
    && !(env.reducedMotion && env.reducedMotion()) && !(env.saver && env.saver())
    && !(env.visible && !env.visible()));
  // One spring step per time stamp: many renders in one frame share it.
  ctl.get = () => {
    const t = now();
    if (t !== ctl.last.t) {
      const o = core.step(t, ctl.active());
      ctl.last = { yaw: o.yaw, pitch: o.pitch, t };
    }
    return { yaw: ctl.last.yaw, pitch: ctl.last.pitch };
  };
  ctl.onOrientation = (ev, angle) => {
    if (ctl.permission === 'unknown' && ev && ev.beta != null) ctl.permission = 'granted';
    core.push(ev, angle, now());
  };
  ctl.recentre = () => core.recentre();
  ctl.set = (on) => {
    on = !!on;
    if (on !== ctl.enabled) core.reset();
    ctl.enabled = on;
    if (env.storage) writeSetting(env.storage, on);
  };
  ctl.attach = (o) => { if (o && o.camera) ctl.attached.set(o.camera, o); return ctl; };
  ctl.detach = (camera) => { ctl.attached.delete(camera); };
  ctl.three = (THREE) => installThree(THREE, ctl);
  return ctl;
}

// ------------------------------------------------------- three.js wrap ----
// Puts the before/after hooks on THREE.Scene.prototype and a pivot record
// on Object3D.prototype.lookAt. Safe to call more than once.
export function installThree(THREE, ctl) {
  if (!THREE || !THREE.Scene || !THREE.Matrix4) return false;
  const SP = THREE.Scene.prototype, OP = THREE.Object3D.prototype;
  if (SP.__snTilt) { SP.__snTilt.ctl = ctl; return true; }
  const lookAts = new WeakMap(), saved = new Map();
  const A = new THREE.Matrix4(), B = new THREE.Matrix4();
  const Q1 = new THREE.Quaternion(), Q2 = new THREE.Quaternion();
  const AX = new THREE.Vector3();
  const reg = { ctl, lookAts, saved };

  const la = OP.lookAt;
  OP.lookAt = function (x, y, z) {
    la.apply(this, arguments);
    if (this.isCamera) {
      if (x && x.isVector3) lookAts.set(this, [x.x, x.y, x.z]);
      else if (typeof x === 'number') lookAts.set(this, [x, y, z]);
    }
    return this;
  };

  const before = SP.onBeforeRender, after = SP.onAfterRender;
  SP.onBeforeRender = function (renderer, scene, camera, target) {
    if (before) before.apply(this, arguments);
    try { tiltBefore(reg, renderer, this, camera, target, A, B, Q1, Q2, AX); } catch (e) {}
  };
  SP.onAfterRender = function (renderer, scene, camera) {
    try { tiltAfter(reg, camera); } catch (e) {}
    if (after) after.apply(this, arguments);
  };
  SP.__snTilt = reg;
  return true;
}

function restore(reg, camera) {
  const s = reg.saved.get(camera);
  if (!s) return;
  const m = camera.matrixWorld.elements, mi = camera.matrixWorldInverse.elements;
  for (let i = 0; i < 16; i++) { m[i] = s.mw[i]; mi[i] = s.mwi[i]; }
  reg.saved.delete(camera);
}

function tiltAfter(reg, camera) { if (camera) restore(reg, camera); }

function tiltBefore(reg, renderer, scene, camera, target, A, B, Q1, Q2, AX) {
  const ctl = reg.ctl;
  if (!camera || !camera.matrixWorld || !ctl) return;
  if (reg.saved.has(camera)) restore(reg, camera); // a frame that threw
  if (camera.isArrayCamera || (renderer && renderer.xr && renderer.xr.isPresenting)) return;
  const att = ctl.attached.get(camera);
  if (!att) {
    if (!camera.isPerspectiveCamera) return;
    if (camera.parent && camera.parent !== scene) return;
    if (target) {
      const c = renderer && renderer.domElement;
      // A composer or render-scale pass: the canvas aspect (1 %), at
      // least 64 px. Picking (1 x 1) and square reflection maps fail.
      if (!c || !c.width || !c.height || !(target.width >= 64) || !(target.height >= 64)) return;
      if (Math.abs((target.width / target.height) / (c.width / c.height) - 1) > 0.01) return;
    }
  }
  const o = ctl.get();
  if (Math.abs(o.yaw) < 1e-7 && Math.abs(o.pitch) < 1e-7) return;

  const m = camera.matrixWorld.elements;
  const px = m[12], py = m[13], pz = m[14];
  const rl = Math.hypot(m[0], m[1], m[2]) || 1, ul = Math.hypot(m[4], m[5], m[6]) || 1;
  const bl = Math.hypot(m[8], m[9], m[10]) || 1;
  const rx = m[0] / rl, ry = m[1] / rl, rz = m[2] / rl;
  const ux = m[4] / ul, uy = m[5] / ul, uz = m[6] / ul;
  const fx = -m[8] / bl, fy = -m[9] / bl, fz = -m[10] / bl;
  const near = camera.near || 0.01;

  // Distance to the pivot along the view axis.
  let d = -1;
  const onAxis = (p, tol) => {
    const vx = p[0] - px, vy = p[1] - py, vz = p[2] - pz;
    const t = vx * fx + vy * fy + vz * fz;
    if (!(t > near)) return -1;
    const e = Math.hypot(vx - fx * t, vy - fy * t, vz - fz * t);
    return e <= tol * t + 1e-9 ? t : -1;
  };
  const ap = att && (att.pivot || (att.controls && att.controls.target));
  if (ap) d = onAxis([ap.x, ap.y, ap.z], 1e9); // trusted, any offset
  if (d < 0) { const l = reg.lookAts.get(camera); if (l) d = onAxis(l, 0.02); }
  if (d < 0) d = onAxis([0, 0, 0], 0.5);
  if (d < 0) d = Math.max(near * 50, Math.hypot(px, py, pz) || 5);
  const cx = px + fx * d, cy = py + fy * d, cz = pz + fz * d;

  reg.saved.set(camera, { mw: m.slice(), mwi: camera.matrixWorldInverse.elements.slice() });
  // World turn: yaw round the camera up axis, pitch round its right axis.
  Q1.setFromAxisAngle(AX.set(ux, uy, uz), o.yaw);
  Q2.setFromAxisAngle(AX.set(rx, ry, rz), o.pitch);
  Q2.multiply(Q1);
  A.makeTranslation(-cx, -cy, -cz);
  camera.matrixWorld.premultiply(A);
  B.makeRotationFromQuaternion(Q2);
  camera.matrixWorld.premultiply(B);
  A.makeTranslation(cx, cy, cz);
  camera.matrixWorld.premultiply(A);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
}

// ------------------------------------------------ custom-camera pages ----
// Turns eye round target: yaw round the camera up axis, pitch round its
// right axis, as the three.js wrap does. up is the world up of the page.
export function orbitEye(eye, target, yaw, pitch, up = [0, 1, 0]) {
  let fx = target[0] - eye[0], fy = target[1] - eye[1], fz = target[2] - eye[2];
  const fl = Math.hypot(fx, fy, fz);
  if (!(fl > 0)) return [eye[0], eye[1], eye[2]];
  fx /= fl; fy /= fl; fz /= fl;
  let rx = fy * up[2] - fz * up[1], ry = fz * up[0] - fx * up[2], rz = fx * up[1] - fy * up[0];
  const rl = Math.hypot(rx, ry, rz);
  if (!(rl > 1e-9)) return [eye[0], eye[1], eye[2]];
  rx /= rl; ry /= rl; rz /= rl;
  const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
  const rot = (v, k, a) => { // Rodrigues, unit axis k
    const c = Math.cos(a), s = Math.sin(a), d = (k[0] * v[0] + k[1] * v[1] + k[2] * v[2]) * (1 - c);
    return [v[0] * c + (k[1] * v[2] - k[2] * v[1]) * s + k[0] * d,
      v[1] * c + (k[2] * v[0] - k[0] * v[2]) * s + k[1] * d,
      v[2] * c + (k[0] * v[1] - k[1] * v[0]) * s + k[2] * d];
  };
  let v = [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]];
  v = rot(rot(v, [ux, uy, uz], yaw), [rx, ry, rz], pitch);
  return [target[0] + v[0], target[1] + v[1], target[2] + v[2]];
}

// The eye with the current tilt, for a page that builds its own view
// matrix: view = lookAt(tiltEye(eye, target, up), target, up). It gives
// back the same eye when tilt is off, so page state never sees it.
export function tiltEye(eye, target, up) {
  const t = tilt;
  if (!t) return eye;
  const o = t.get();
  if (Math.abs(o.yaw) < 1e-7 && Math.abs(o.pitch) < 1e-7) return eye;
  return orbitEye(eye, target, o.yaw, o.pitch, up || [0, 1, 0]);
}

// ------------------------------------------------------------ permission ----
// Asks once, from the first touchend or click, and only if no sensor event
// came first. DOE = the DeviceOrientationEvent constructor.
export function askPermission(win, ctl, DOE, start) {
  if (!DOE || typeof DOE.requestPermission !== 'function') return false;
  let asked = false;
  const opts = { capture: true, passive: true };
  const off = () => { win.removeEventListener('touchend', on, opts); win.removeEventListener('click', on, opts); };
  function on() {
    if (asked) return;
    if (ctl.permission === 'granted' || !ctl.enabled) { if (ctl.permission === 'granted') off(); return; }
    asked = true; off();
    let p;
    try { p = DOE.requestPermission(); } catch (e) { ctl.permission = 'denied'; return; }
    Promise.resolve(p).then((r) => {
      ctl.permission = r === 'granted' ? 'granted' : 'denied';
      if (ctl.permission === 'granted' && start) start();
    }, () => { ctl.permission = 'denied'; });
  }
  win.addEventListener('touchend', on, opts);
  win.addEventListener('click', on, opts);
  return true;
}

// ------------------------------------------------------------ browser boot ----
function screenAngle(win) {
  try {
    const so = win.screen && win.screen.orientation;
    if (so && typeof so.angle === 'number') return so.angle;
  } catch (e) {}
  return typeof win.orientation === 'number' ? win.orientation : 0;
}

function inSaver(win) {
  const d = win.document;
  if (d.documentElement.classList.contains('sn-saver')) return true;
  try {
    const p = win.parent;
    if (p && p !== win && p.document && p.document.body && p.document.body.classList.contains('sn-saver-on')) return true;
  } catch (e) {}
  return false;
}

export function bootTilt(win) {
  if (win.snTilt) return win.snTilt;
  const mm = (q) => { try { return win.matchMedia(q); } catch (e) { return null; } };
  const touch = mm('(pointer: coarse) and (hover: none)');
  const rm = mm('(prefers-reduced-motion: reduce)');
  let storage = null;
  try { storage = win.localStorage; } catch (e) {}
  const perf = win.performance;
  const ctl = createTilt({
    supported: !!(touch && touch.matches && 'DeviceOrientationEvent' in win),
    storage,
    search: (win.location && win.location.search) || '',
    now: () => (perf ? perf.now() : Date.now()),
    visible: () => win.document.visibilityState !== 'hidden',
    saver: () => inSaver(win),
    reducedMotion: () => !!(rm && rm.matches),
  });
  win.snTilt = ctl;
  if (!ctl.supported) return ctl;

  let listening = false;
  const onEv = (e) => ctl.onOrientation(e, screenAngle(win));
  const start = () => { if (!listening) { listening = true; win.addEventListener('deviceorientation', onEv); } };
  start(); // Android, and iOS after an earlier grant: events come at once.
  askPermission(win, ctl, win.DeviceOrientationEvent, start);

  win.addEventListener('orientationchange', () => ctl.recentre());
  try { win.screen.orientation.addEventListener('change', () => ctl.recentre()); } catch (e) {}
  win.document.addEventListener('visibilitychange', () => { ctl.core.reset(); });
  win.addEventListener('storage', (e) => {
    if (e.key === TUNING.key) { const on = e.newValue !== '0'; if (on !== ctl.enabled) ctl.core.reset(); ctl.enabled = on; }
  });

  if (win.THREE && win.THREE.Scene) installThree(win.THREE, ctl);
  else {
    let map = null;
    try {
      const s = win.document.querySelector('script[type="importmap"]');
      map = s && JSON.parse(s.textContent).imports;
    } catch (e) {}
    if (map && map.three) import('three').then((T) => installThree(T, ctl), () => {});
  }
  return ctl;
}

function safeBoot() {
  try { return (typeof window !== 'undefined' && window.document) ? bootTilt(window) : null; } catch (e) { return null; }
}
export const tilt = safeBoot();
export default tilt;
