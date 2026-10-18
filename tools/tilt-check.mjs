#!/usr/bin/env node
// ============================================================================
//  TILT CHECK  ·  tools/tilt-check.mjs — node tests for stella-nova/lib/tilt.js
// ----------------------------------------------------------------------------
//  No browser. The tests run the pure core (sensor maths, neutral drift,
//  spring, dead zone, clamp, screen orientation, gimbal flip), the off
//  states (reduced motion, saver, setting, hidden tab, desktop), the iOS
//  permission flow with a fake DeviceOrientationEvent, and the three.js
//  render wrap with the real vendored builds (r160 module + OrbitControls,
//  r139 and r128 classic, r185 module). The wrap test makes sure that the
//  camera position, quaternion, matrices and OrbitControls target are the
//  same, bit for bit, as on a twin camera with no tilt.
//  It also makes sure that each page that loads lib/tilt.js loads it after
//  its importmap (a module script before the importmap breaks the page).
//
//  Usage (from the repo root):   node tools/tilt-check.mjs
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SN = path.join(ROOT, 'stella-nova');
const V = path.join(SN, 'vendor');
const T160 = pathToFileURL(path.join(V, 'three@0.160.0/build/three.module.js')).href;
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(s, c, n) { if (s === 'three') return { url: ${JSON.stringify(T160)}, shortCircuit: true }; return n(s, c); }`));

const T = await import(pathToFileURL(path.join(SN, 'lib/tilt.js')).href);
const { createCore, createTilt, installThree, askPermission, bootTilt, quatFromEuler,
  screenQuat, relVector, shape, springStep, readSetting, TUNING, orbitEye, tiltEye } = T;

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; } else { fail++; console.log('FAIL', name, extra !== undefined ? extra : ''); }
}
const D = Math.PI / 180;
const qsame = (a, b, e = 1e-9) => {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return Math.abs(d - 1) < e;
};

// ------------------------------------------------------------ maths ----
ok(qsame(quatFromEuler(0, 0, 0), [0, 0, 0, 1]), 'identity quaternion');
{
  const r = relVector([0, 0, 0, 1], quatFromEuler(0, 10, 0));
  ok(Math.abs(r[0] - 10 * D) < 1e-9 && Math.abs(r[1]) < 1e-9, 'beta is a turn round screen x', r);
  const g = relVector([0, 0, 0, 1], quatFromEuler(0, 0, 10));
  ok(Math.abs(g[1] - 10 * D) < 1e-9 && Math.abs(g[0]) < 1e-9, 'gamma is a turn round screen y', g);
}
// Gimbal: near beta = 90 the browser wraps gamma into [-90, 90) and turns
// alpha and beta to match. The quaternion must be the same.
{
  let worst = 0;
  for (const [a, b, g] of [[30, 89, 89.5], [200, 91, -89], [10, 88, 90], [0, 90, 45], [350, -89, 89.9]]) {
    const q1 = quatFromEuler(a, b, g), q2 = quatFromEuler(a + 180, 180 - b, g - 180);
    const d = 1 - Math.abs(q1[0] * q2[0] + q1[1] * q2[1] + q1[2] * q2[2] + q1[3] * q2[3]);
    worst = Math.max(worst, d);
  }
  ok(worst < 1e-12, 'gimbal flip gives the same orientation', worst);
  // Core output across a flip: no jump.
  const c = createCore();
  let t = 0, maxJump = 0, prev = null;
  for (let i = 0; i <= 120; i++) {
    t += 16;
    const g = 88 + i * 0.03;            // crosses 90 at i = 67
    const ev = g < 90 ? { alpha: 40, beta: 89, gamma: g } : { alpha: 220, beta: 91, gamma: g - 180 };
    c.push(ev, 0, t);
    const o = c.step(t);
    if (prev) maxJump = Math.max(maxJump, Math.abs(o.yaw - prev.yaw), Math.abs(o.pitch - prev.pitch));
    prev = o;
  }
  ok(maxJump < 0.05 * D, 'no output jump across the gimbal flip', maxJump / D);
}
{
  const [x, v] = springStep(1, 0, 0, 7, 1e9);
  ok(Math.abs(x) < 1e-12 && Math.abs(v) < 1e-12, 'spring settles');
  let s = [0, 0], over = 0;
  for (let i = 0; i < 300; i++) { s = springStep(s[0], s[1], 1, 7, 1 / 60); over = Math.max(over, s[0] - 1); }
  ok(over <= 1e-12, 'critically damped: no overshoot', over);
}
{
  const [a, b] = shape(0.2 * D, 0.1 * D);
  ok(a === 0 && b === 0, 'dead zone eats tremor');
  const [c, d] = shape(80 * D, 0);
  ok(c <= TUNING.maxDeg * D + 1e-12 && c > 3 * D && d === 0, 'soft clamp to maxDeg', c / D);
  const [e] = shape(6 * D, 0);
  ok(Math.abs(e / D - (6 - TUNING.deadDeg) * TUNING.gain) < 0.25, 'small tilt is near linear', e / D);
}

// ------------------------------------------------------------- core ----
function run(c, evFn, ms, dt = 16, angle = 0, t0 = 0) {
  let t = t0, out = [];
  for (let k = 0; k <= ms; k += dt) { t = t0 + k; c.push(evFn(t), typeof angle === 'function' ? angle(t) : angle, t); out.push(c.step(t)); }
  return { out, t };
}
{
  // Hold still at an odd angle: no offset, it is the neutral pose.
  const c = createCore();
  const { out } = run(c, () => ({ alpha: 123, beta: 55, gamma: -20 }), 3000);
  ok(out.every((o) => o.yaw === 0 && o.pitch === 0), 'any steady hold is centre');
}
{
  // Step tilt of 8 deg in gamma: yaw rises smoothly, stays under max, and
  // the neutral drift brings it back near 0 in a few seconds.
  const c = createCore();
  run(c, () => ({ alpha: 0, beta: 40, gamma: 0 }), 1000);
  const { out } = run(c, () => ({ alpha: 0, beta: 40, gamma: 8 }), 12000, 16, 0, 1016);
  const peak = Math.max(...out.map((o) => o.yaw));
  const iPeak = out.findIndex((o) => o.yaw === peak);
  let mono = true; for (let i = 1; i <= iPeak; i++) if (out[i].yaw < out[i - 1].yaw - 1e-12) mono = false;
  ok(peak > 0.8 * D && peak <= TUNING.maxDeg * D, 'step tilt gives a slight yaw', peak / D);
  ok(mono, 'smooth rise, no jitter');
  ok(Math.abs(out[out.length - 1].yaw) < 0.05 * D, 'recentres in a few seconds', out[out.length - 1].yaw / D);
  ok(Math.abs(out[out.length - 1].pitch) < 0.05 * D, 'no cross talk to pitch');
}
{
  // Tremor: 0.15 deg noise at 10 Hz gives no motion.
  const c = createCore();
  const { out } = run(c, (t) => ({ alpha: 5, beta: 50 + 0.15 * Math.sin(t / 16), gamma: 0.15 * Math.cos(t / 13) }), 4000);
  ok(out.every((o) => Math.abs(o.yaw) < 1e-9 && Math.abs(o.pitch) < 1e-9), 'tremor is in the dead zone');
}
{
  // Screen orientation: in landscape (angle 90), a turn round device y
  // (gamma) is a turn round screen x, so it shows as pitch.
  const c = createCore();
  run(c, () => ({ alpha: 0, beta: 0, gamma: 0 }), 500, 16, 90);
  const { out } = run(c, () => ({ alpha: 0, beta: 0, gamma: 6 }), 400, 16, 90, 516);
  const o = out[out.length - 1];
  ok(Math.abs(o.pitch) > 0.5 * D && Math.abs(o.yaw) < 0.05 * D, 'landscape maps gamma to pitch', o);
  const c2 = createCore();
  run(c2, () => ({ alpha: 0, beta: 0, gamma: 0 }), 500, 16, -90);
  const o2 = run(c2, () => ({ alpha: 0, beta: 0, gamma: 6 }), 400, 16, -90, 516).out.pop();
  ok(Math.sign(o2.pitch) === -Math.sign(o.pitch), 'landscape left and right have opposite signs', [o.pitch, o2.pitch]);
  // A turn of the screen recentres: no jump at the angle change.
  const c3 = createCore();
  run(c3, () => ({ alpha: 0, beta: 60, gamma: 0 }), 500, 16, 0);
  const o3 = run(c3, () => ({ alpha: 0, beta: 0, gamma: 70 }), 200, 16, 90, 516).out;
  ok(o3.every((v) => v.yaw === 0 && v.pitch === 0), 'orientation change recentres', o3[o3.length - 1]);
}
{
  const c = createCore();
  run(c, () => ({ alpha: 0, beta: 40, gamma: 0 }), 300);
  run(c, () => ({ alpha: 0, beta: 40, gamma: 10 }), 300, 16, 0, 316);
  let later; for (let t = 632; t < 3000; t += 16) later = c.step(t);
  ok(Math.abs(later.yaw) < 0.01 * D, 'stale sensor decays to 0', later.yaw / D);
  ok(c.push({ alpha: null, beta: null, gamma: null }, 0, 1) === false, 'null event (desktop sensor stub) is ignored');
}

// ---------------------------------------------------- off states ----
function env(over = {}) {
  const store = new Map();
  const e = {
    supported: true, t: 0, vis: true, sav: false, rm: false,
    storage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) },
    ...over,
  };
  e.now = () => e.t; e.visible = () => e.vis; e.saver = () => e.sav; e.reducedMotion = () => e.rm;
  return e;
}
function tilted(e, ctl) {
  for (let i = 0; i < 20; i++) { e.t += 16; ctl.onOrientation({ alpha: 0, beta: 40, gamma: 0 }, 0); ctl.get(); }
  for (let i = 0; i < 30; i++) { e.t += 16; ctl.onOrientation({ alpha: 0, beta: 40, gamma: 10 }, 0); }
  e.t += 16; return ctl.get();
}
{
  const e = env(), ctl = createTilt(e);
  const o = tilted(e, ctl);
  ok(o.yaw > 0.5 * D, 'on: a tilt gives yaw', o.yaw / D);
  e.sav = true; e.t += 16;
  ok(ctl.get().yaw === 0, 'saver: offset is 0 at once');
  e.sav = false; e.rm = true; e.t += 16;
  ok(ctl.get().yaw === 0, 'reduced motion: off');
  e.rm = false; e.vis = false; e.t += 16;
  ok(ctl.get().yaw === 0, 'hidden tab: off');
  e.vis = true;
  ctl.set(false); e.t += 16;
  ok(ctl.get().yaw === 0 && e.storage.getItem('sn-tilt') === '0', 'setting off is stored and off');
  const ctl2 = createTilt({ ...e, supported: true });
  ok(ctl2.enabled === false, 'setting read back from storage');
  ctl.set(true);
  ok(e.storage.getItem('sn-tilt') === '1', 'setting on is stored');
  const d = env({ supported: false }), c3 = createTilt(d);
  ok(tilted(d, c3).yaw === 0, 'desktop (not supported): off');
  const q = env({ search: '?x=1&tilt=0' });
  ok(createTilt(q).enabled === false, '?tilt=0 turns it off');
  const bad = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  ok(readSetting(bad) === true, 'storage that throws: default on');
  const c4 = createTilt(env({ storage: bad }));
  let threw = false; try { c4.set(false); } catch (err) { threw = true; }
  ok(!threw && c4.enabled === false, 'storage that throws: set works in memory');
}

// ------------------------------------------------------ permission ----
function fakeWin() {
  const L = {};
  return {
    L,
    addEventListener(t, f) { (L[t] = L[t] || []).push(f); },
    removeEventListener(t, f) { L[t] = (L[t] || []).filter((g) => g !== f); },
    fire(t) { (L[t] || []).slice().forEach((f) => f({ type: t })); },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
{
  const w = fakeWin(), e = env(), ctl = createTilt(e);
  let asks = 0, started = 0;
  const DOE = { requestPermission: () => { asks++; return Promise.resolve('granted'); } };
  askPermission(w, ctl, DOE, () => started++);
  ok(asks === 0, 'no ask before a gesture');
  w.fire('touchend'); await tick();
  ok(asks === 1 && started === 1 && ctl.permission === 'granted', 'ask on first touchend, granted');
  w.fire('click'); w.fire('touchend'); await tick();
  ok(asks === 1, 'asks only once');
}
{
  const w = fakeWin(), e = env(), ctl = createTilt(e);
  let asks = 0, started = 0;
  askPermission(w, ctl, { requestPermission: () => { asks++; return Promise.resolve('denied'); } }, () => started++);
  w.fire('click'); await tick();
  ok(ctl.permission === 'denied' && started === 0, 'denied: stays off');
  ok(tilted(e, ctl).yaw === 0, 'denied: offset 0');
  w.fire('click'); await tick();
  ok(asks === 1, 'denied: no second ask');
}
{
  const w = fakeWin(), e = env(), ctl = createTilt(e);
  let asks = 0;
  askPermission(w, ctl, { requestPermission: () => { asks++; return Promise.resolve('granted'); } }, () => {});
  ctl.onOrientation({ alpha: 0, beta: 10, gamma: 0 }, 0);
  w.fire('touchend'); await tick();
  ok(asks === 0 && ctl.permission === 'granted', 'events already come: no ask');
}
{
  const w = fakeWin(), ctl = createTilt(env());
  ok(askPermission(w, ctl, function DOE() {}, () => {}) === false && !w.L.click, 'Android (no requestPermission): no gesture hook');
  const w2 = fakeWin(), ctl2 = createTilt(env()); ctl2.set(false);
  let asks = 0;
  askPermission(w2, ctl2, { requestPermission: () => { asks++; return Promise.resolve('granted'); } }, () => {});
  w2.fire('touchend'); await tick();
  ok(asks === 0, 'setting off: no ask');
}

// ---------------------------------------------------------- boot ----
function bootWin(coarse) {
  const w = fakeWin();
  const cl = new Set();
  Object.assign(w, {
    matchMedia: (q) => ({ matches: q.includes('coarse') ? coarse : false }),
    DeviceOrientationEvent: function () {},
    localStorage: { getItem: () => null, setItem() {} },
    location: { search: '' },
    performance: { now: () => 0 },
    screen: { orientation: { angle: 0, addEventListener() {} } },
    document: {
      visibilityState: 'visible', documentElement: { classList: { contains: (c) => cl.has(c) } },
      addEventListener() {}, querySelector: () => null,
    },
  });
  w.parent = w;
  return { w, cl };
}
{
  const { w } = bootWin(false), ctl = bootTilt(w);
  ok(ctl.supported === false && !w.L.deviceorientation, 'boot on desktop: no sensor listener');
  const p = bootWin(true), c2 = bootTilt(p.w);
  ok(c2.supported === true && p.w.L.deviceorientation.length === 1 && p.w.snTilt === c2, 'boot on a phone: listens');
  p.cl.add('sn-saver');
  ok(c2.active() === false, 'boot: html.sn-saver turns it off');
}

// ------------------------------------------------- three.js wrap ----
// One frame in the order WebGLRenderer.render uses (r128 to r185).
function frame(THREE, renderer, scene, camera, target) {
  scene.updateMatrixWorld();
  if (camera.parent === null) camera.updateMatrixWorld();
  scene.onBeforeRender(renderer, scene, camera, target || null);
  const seen = camera.matrixWorld.elements.slice(), seenI = camera.matrixWorldInverse.elements.slice();
  scene.onAfterRender(renderer, scene, camera);
  return { seen, seenI };
}
const eq = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const pose = (c) => [c.position.x, c.position.y, c.position.z, c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w];

function wrapSuite(tag, THREE, Orbit) {
  const e = env(), ctl = createTilt(e);
  ok(installThree(THREE, ctl) === true, tag + ': installs');
  ok(installThree(THREE, ctl) === true, tag + ': second install is a no-op');
  const el = () => ({ style: {}, addEventListener() {}, removeEventListener() {}, ownerDocument: { addEventListener() {}, removeEventListener() {} }, getRootNode() { return this; }, clientWidth: 800, clientHeight: 600 });
  const renderer = { domElement: { width: 800, height: 600 }, xr: { isPresenting: false } };
  const mk = () => {
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(50, 4 / 3, 0.1, 100);
    cam.position.set(3, 2, 6);
    const ctr = new Orbit(cam, el());
    ctr.enableDamping = true; ctr.dampingFactor = 0.08;
    ctr.target.set(0.5, 0.3, -0.2);
    ctr.update();
    return { scene, cam, ctr };
  };
  const A = mk(), B = mk(); // A has tilt, B is the twin with none
  let moved = false, exact = true, restored = true, axis = 0;
  for (let i = 0; i < 90; i++) {
    e.t += 16;
    ctl.onOrientation({ alpha: 0, beta: 40, gamma: i > 10 ? 9 : 0 }, 0);
    // The user drags: the same rotate on both, with damping.
    if (i === 30) { A.ctr.target.x += 0.1; B.ctr.target.x += 0.1; }
    A.ctr.update(); B.ctr.update();
    const before = A.cam.matrixWorld.elements.slice();
    const fa = frame(THREE, renderer, A.scene, A.cam);
    B.scene.updateMatrixWorld(); B.cam.updateMatrixWorld(); // twin: no hooks run
    const fb = { seen: B.cam.matrixWorld.elements.slice(), seenI: B.cam.matrixWorldInverse.elements.slice() };
    if (!eq(fa.seen, fb.seen)) moved = true;
    if (!eq(pose(A.cam), pose(B.cam)) || !eq(A.ctr.target.toArray(), B.ctr.target.toArray())) exact = false;
    if (!eq(A.cam.matrixWorld.elements, fb.seen) || !eq(A.cam.matrixWorldInverse.elements, fb.seenI)) restored = false;
    void before;
    // The pivot stays on the tilted view axis.
    const Mi = new THREE.Matrix4().fromArray(fa.seenI);
    const p = A.ctr.target.clone().applyMatrix4(Mi);
    axis = Math.max(axis, Math.hypot(p.x, p.y) / Math.abs(p.z));
  }
  ok(moved, tag + ': the rendered view turns');
  ok(exact, tag + ': position, quaternion and controls.target same as the twin, bit for bit');
  ok(restored, tag + ': matrixWorld and matrixWorldInverse restored after the frame');
  ok(axis < 1e-6, tag + ': the orbit target stays on the view axis', axis);
  // The offset is small.
  const fa = frame(THREE, renderer, A.scene, A.cam);
  const fwdA = new THREE.Vector3(-fa.seen[8], -fa.seen[9], -fa.seen[10]).normalize();
  const fwdB = new THREE.Vector3(-B.cam.matrixWorld.elements[8], -B.cam.matrixWorld.elements[9], -B.cam.matrixWorld.elements[10]).normalize();
  const ang = Math.acos(Math.min(1, fwdA.dot(fwdB))) / D;
  ok(ang > 0.2 && ang <= TUNING.maxDeg + 1e-6, tag + ': offset is slight', ang);
  // Small target (picking, reflection): no tilt. Full-size target: tilt.
  const small = frame(THREE, renderer, A.scene, A.cam, { width: 1, height: 1 });
  ok(eq(small.seen, A.cam.matrixWorld.elements), tag + ': small render target is not tilted');
  const full = frame(THREE, renderer, A.scene, A.cam, { width: 800, height: 600 });
  ok(!eq(full.seen, A.cam.matrixWorld.elements), tag + ': canvas-size target (composer) is tilted');
  const half = frame(THREE, renderer, A.scene, A.cam, { width: 399.5, height: 299.6 });
  ok(!eq(half.seen, A.cam.matrixWorld.elements), tag + ': half-size target, same aspect (render scale) is tilted');
  const sq = frame(THREE, renderer, A.scene, A.cam, { width: 512, height: 512 });
  ok(eq(sq.seen, A.cam.matrixWorld.elements), tag + ': square 512 target (reflection) is not tilted');
  // Orthographic: no tilt, unless attached.
  const oc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10); oc.position.set(0, 0, 5);
  const o1 = frame(THREE, renderer, A.scene, oc);
  ok(eq(o1.seen, oc.matrixWorld.elements), tag + ': orthographic camera is not tilted');
  ctl.attach({ camera: oc, pivot: new THREE.Vector3(0, 0, 0) });
  const o2 = frame(THREE, renderer, A.scene, oc);
  ok(!eq(o2.seen, oc.matrixWorld.elements) && eq(oc.matrixWorld.elements, o1.seen), tag + ': attached camera is tilted and restored');
  // XR presenting: no tilt.
  const xr = frame(THREE, { ...renderer, xr: { isPresenting: true } }, A.scene, A.cam);
  ok(eq(xr.seen, A.cam.matrixWorld.elements), tag + ': WebXR is not tilted');
  // Saver: no tilt.
  e.sav = true; e.t += 16;
  const sv = frame(THREE, renderer, A.scene, A.cam);
  ok(eq(sv.seen, A.cam.matrixWorld.elements), tag + ': saver is not tilted');
  e.sav = false;
  const retilt = () => { for (let i = 0; i < 40; i++) { e.t += 16; ctl.onOrientation({ alpha: 0, beta: 40, gamma: i > 3 ? 9 : 0 }, 0); ctl.get(); } };
  retilt();
  // A camera in a rig (parent is not the scene): no tilt.
  const rig = new THREE.Group(); A.scene.add(rig);
  const rc = new THREE.PerspectiveCamera(); rig.add(rc); rc.position.set(0, 0, 4);
  e.t += 16; A.scene.updateMatrixWorld();
  const rr = frame(THREE, renderer, A.scene, rc);
  ok(eq(rr.seen, rc.matrixWorld.elements), tag + ': rig camera is not tilted');
  // A lookAt pivot with no controls.
  const lc = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  lc.position.set(10, 0, 0); lc.lookAt(new THREE.Vector3(2, 0, 0));
  const lf = frame(THREE, renderer, A.scene, lc);
  const lp = new THREE.Vector3(2, 0, 0).applyMatrix4(new THREE.Matrix4().fromArray(lf.seenI));
  ok(!eq(lf.seen, lc.matrixWorld.elements) && Math.hypot(lp.x, lp.y) < 1e-6 * Math.abs(lp.z), tag + ': lookAt point is the pivot');
}

{
  const THREE = await import(T160);
  const { OrbitControls } = await import(pathToFileURL(path.join(V, 'three@0.160.0/examples/jsm/controls/OrbitControls.js')).href);
  wrapSuite('r160', THREE, OrbitControls);
}
for (const ver of ['0.139.2', '0.128.0']) {
  const ctx = vm.createContext({ console, Date, Math, document: {}, window: {} });
  vm.runInContext(fs.readFileSync(path.join(V, `three@${ver}/build/three.min.js`), 'utf8'), ctx);
  const oc = path.join(V, `three@${ver}/examples/js/controls/OrbitControls.js`);
  if (fs.existsSync(oc)) vm.runInContext(fs.readFileSync(oc, 'utf8'), ctx);
  if (ctx.THREE.OrbitControls) wrapSuite('r' + ver, ctx.THREE, ctx.THREE.OrbitControls);
  else {
    // r128 pages here use no OrbitControls file: a stand-in that calls lookAt.
    const THREE = ctx.THREE;
    class Orbit { constructor(c) { this.object = c; this.target = new THREE.Vector3(); this.v = 0; }
      update() { this.object.lookAt(this.target); } }
    wrapSuite('r' + ver + ' (lookAt stand-in)', THREE, Orbit);
  }
}
{
  const r185 = pathToFileURL(path.join(V, 'three@0.185.1/build/three.module.js')).href;
  if (fs.existsSync(fileURLToPath(r185))) {
    const THREE = await import(r185);
    class Orbit { constructor(c) { this.object = c; this.target = new THREE.Vector3(); }
      update() { this.object.lookAt(this.target); } }
    wrapSuite('r185 (lookAt stand-in)', THREE, Orbit);
  }
}

// ------------------------------------------- custom-camera eye ----
{
  const eye = [3, 2, 6], tgt = [0.5, 0.3, -0.2];
  ok(tiltEye(eye, tgt, [0, 1, 0]) === eye, 'tiltEye with no browser gives the same eye');
  const z = orbitEye(eye, tgt, 0, 0);
  ok(z.every((v, i) => Math.abs(v - eye[i]) < 1e-12), 'orbitEye with 0 offset is the eye');
  const e2 = orbitEye(eye, tgt, 3 * D, -2 * D);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  ok(Math.abs(dist(e2, tgt) - dist(eye, tgt)) < 1e-12, 'orbitEye keeps the distance');
  const cosA = ((eye[0] - tgt[0]) * (e2[0] - tgt[0]) + (eye[1] - tgt[1]) * (e2[1] - tgt[1]) + (eye[2] - tgt[2]) * (e2[2] - tgt[2])) / dist(eye, tgt) ** 2;
  const ang = Math.acos(Math.min(1, cosA)) / D;
  ok(ang > 3 && ang < 3.7, 'orbitEye turns by the offset', ang);
  // Same as the three.js wrap for the same yaw and pitch.
  const THREE = await import(T160);
  const cam = new THREE.PerspectiveCamera(); cam.position.fromArray(eye); cam.lookAt(new THREE.Vector3(...tgt)); cam.updateMatrixWorld();
  const sc = new THREE.Scene();
  const ctl = { get: () => ({ yaw: 3 * D, pitch: -2 * D }), attached: new Map([[cam, { camera: cam, pivot: new THREE.Vector3(...tgt) }]]) };
  const keep = THREE.Scene.prototype.__snTilt.ctl; THREE.Scene.prototype.__snTilt.ctl = ctl;
  sc.onBeforeRender({ domElement: { width: 1, height: 1 } }, sc, cam, null);
  const p = [cam.matrixWorld.elements[12], cam.matrixWorld.elements[13], cam.matrixWorld.elements[14]];
  sc.onAfterRender({}, sc, cam);
  THREE.Scene.prototype.__snTilt.ctl = keep;
  ok(dist(p, e2) < 1e-6, 'orbitEye matches the three.js wrap', dist(p, e2));
  const zUp = orbitEye([0, -10, 4], [0, 0, 0], 2 * D, 1 * D, [0, 0, 1]);
  ok(Math.abs(Math.hypot(...zUp) - Math.hypot(0, 10, 4)) < 1e-12 && Math.abs(zUp[0]) > 0.2, 'orbitEye with z up (map pages)', zUp);
}

// --------------------------------------------- page opt-in order ----
{
  const pages = path.join(SN, 'pages');
  let n = 0, bad = [];
  for (const k of fs.readdirSync(pages)) {
    const f = path.join(pages, k, 'index.html');
    if (!fs.existsSync(f)) continue;
    const h = fs.readFileSync(f, 'utf8');
    const i = h.indexOf('lib/tilt.js');
    if (i < 0) continue;
    n++;
    const im = h.indexOf('type="importmap"');
    const firstMod = h.search(/<script[^>]*type="module"/);
    const tag = h.lastIndexOf('<script', i);
    if (im >= 0 && im > firstMod && firstMod >= 0) bad.push(k + ' (a module before the importmap)');
    if (im >= 0 && tag < im) bad.push(k + ' (tilt before the importmap)');
    if (!/<script type="module" src="\.\.\/\.\.\/lib\/tilt\.js"><\/script>/.test(h)) bad.push(k + ' (tag form)');
  }
  ok(bad.length === 0, 'pages load tilt.js after the importmap', bad);
  console.log('pages with tilt.js:', n);
}

// ------------------------------------------------ shell toggle ----
// The "Tilt" button in the shell sidebar footer, in jsdom (optional: set
// NODE_PATH to a jsdom install, else this part prints SKIP).
{
  const { createRequire } = await import('node:module');
  let JSDOM = null;
  try { ({ JSDOM } = createRequire(import.meta.url)('jsdom')); } catch (e) {}
  if (!JSDOM) console.log('SKIP: shell toggle (jsdom not found, set NODE_PATH)');
  else {
    const { parseCss, styleOf, makeMatchMedia } = await import('./css-viewport.mjs');
    const html = fs.readFileSync(path.join(SN, 'index.html'), 'utf8');
    const scripts = [];
    const bare = html.replace(/<script([^>]*)>([\s\S]*?)<\/script>/g, (m, a, b) => { const sm = a.match(/src="([^"]+)"/); scripts.push(sm ? { src: sm[1] } : { body: b }); return ''; });
    const css = parseCss([...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n'));
    for (const vp of [{ w: 390, h: 844, coarse: true }, { w: 1440, h: 900, coarse: false }]) {
      const dom = new JSDOM(bare, { url: 'http://localhost/stella-nova/index.html#orbital', runScripts: 'dangerously', pretendToBeVisual: true });
      const w = dom.window; w.matchMedia = makeMatchMedia(vp); w.Element.prototype.scrollIntoView = () => {};
      const errs = [];
      for (const sc of scripts) {
        if (sc.src && !['lib/nav-data.js', 'lib/wishlist.js'].includes(sc.src)) continue;
        try { w.eval(sc.src ? fs.readFileSync(path.join(SN, sc.src), 'utf8') : sc.body); } catch (e) { errs.push(e.message); }
      }
      const b = w.document.getElementById('sb-tilt');
      const disp = b && styleOf(b, css, vp).display;
      if (vp.coarse) {
        ok(errs.length === 0, 'shell boots with the toggle', errs);
        ok(b && disp === 'flex', 'shell: Tilt button shows on a phone', disp);
        ok(b.textContent === 'Tilt on' && b.getAttribute('aria-pressed') === 'true', 'shell: default on');
        let set = null; let f = w.document.querySelector('#frame-wrap iframe'); if (!f) { f = w.document.createElement('iframe'); w.document.getElementById('frame-wrap').appendChild(f); }
        f.contentWindow.snTilt = { set: (v) => { set = v; } };
        b.click();
        ok(w.localStorage.getItem('sn-tilt') === '0' && b.textContent === 'Tilt off' && set === false, 'shell: tap turns it off, stores it, tells the page');
        let asked = 0; w.DeviceOrientationEvent = { requestPermission: () => { asked++; return Promise.resolve('granted'); } };
        b.click();
        ok(w.localStorage.getItem('sn-tilt') === '1' && set === true && asked === 1, 'shell: tap on asks the iOS permission');
      } else ok(b && disp === 'none', 'shell: no Tilt button on a desktop', disp);
      w.close();
    }
  }
}

console.log(`tilt-check: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
