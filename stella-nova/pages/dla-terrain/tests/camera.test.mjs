// tests/camera.test.mjs — CAMERA package checks (node, no GPU, no browser).
// Run alone: node stella-nova/pages/dla-terrain/tests/camera.test.mjs
// CORE's tests.mjs also runs it with every other file in tests/.
//
// What it checks, on a real LIB terrain (lib/dla-terrain.js at n 256; the
// stub terrain when LIB is not there):
//   the spring step is exact and stable for any dt; the camera update
//   stays finite for any dt; zoom to the cursor keeps the picked point
//   under the cursor on each frame; grab and drag keeps the grip point
//   under the pointer; a turn keeps the pivot under the pointer; the
//   two-finger pinch, twist and drag keep both ground points under the
//   fingers; random flights, zooms, turns, drags and mode changes never
//   put the eye under the ground; the drone path is over the ground at
//   1 m steps; the drone speed is even (low variance in m/s); no yaw step
//   over a threshold per frame (drone, hairpin, take-over, resume, flyTo);
//   the speed eases in and brakes at the end; the take-over keeps the
//   speed; flyTo and the FOV glide; the near plane is 0.1 m low down;
//   the fly eye stays 0.4 m outside a trunk (world.trunkAt).

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { project } from '../gpu/mat.js';
import { createCamera, dronePath, spring, CLEAR, MIN_DIST, DRONE_RAMP, PITCH_MAX, PITCH_MIN } from '../camera.js';
import * as Stub from '../gpu/stub-terrain.js';

let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`ok ${pass + fail} camera: ${name}`); }
  else { fail++; console.log(`not ok ${pass + fail} camera: ${name} ${extra}`); }
}
const libPath = fileURLToPath(new URL('../../../lib/dla-terrain.js', import.meta.url));
let lib = Stub, which = 'stub';
if (existsSync(libPath)) { try { lib = await import(pathToFileURL(libPath).href); which = 'lib'; } catch (e) { console.log('  lib import failed', e.message); } }

// a seeded random
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const wrap = a => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
const yawOf = f => Math.atan2(f[0], -f[2]);
const W = 1280, H = 800;

async function makeWorld(preset, seed) {
  const opts = { ...lib.defaults(), ...(lib.PRESETS[preset] ? lib.PRESETS[preset].opts : {}), n: 256, seed };
  const t = await lib.generateTerrain(opts, () => {});
  const n = t.n, ws = t.worldSize, h = t.height;
  // the bilinear height of gpu/terrain-gpu.js sampleHeight (main.js world)
  const heightAt = (x, z) => {
    const tx = ws / n, fx = (x + ws / 2) / tx - 0.5, fz = (z + ws / 2) / tx - 0.5;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const at = (a, b) => h[Math.max(0, Math.min(n - 1, b)) * n + Math.max(0, Math.min(n - 1, a))];
    return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
  };
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < h.length; i++) { lo = Math.min(lo, h[i]); hi = Math.max(hi, h[i]); }
  const world = { heightAt, size: ws, seaLevel: (t.seaLevel ?? 0) + 0.4, midH: (Math.max(lo, t.seaLevel ?? 0) + hi) / 2 };
  return { t, world };
}
const ground = (w, x, z) => Math.max(w.heightAt(x, z), w.seaLevel);
const ndcOf = (cam, P, shift) => { const m = cam.matrices(W, H, { shift }); const q = project(m.viewProj, P); return [q[0], q[1]]; };
const px = (a, b) => Math.hypot((a[0] - b[0]) * W / 2, (a[1] - b[1]) * H / 2);

const A = await makeWorld('alpine', 7);
const F = await makeWorld('fjords', 3);
console.log(`  terrain: ${which}, alpine ${A.world.size} m, fjords ${F.world.size} m`);

// ── springs and damping
{
  let x = 1, v = 0, mono = true, prev = 1;
  for (const dt of [1e-4, 0.016, 0.1, 1, 10, 1000]) {
    let a = 1, b = 0;
    for (let i = 0; i < 50; i++) { [a, b] = spring(a, b, 0, 4, dt); if (a < -1e-12 || !Number.isFinite(a) || !Number.isFinite(b)) mono = false; }
  }
  for (let i = 0; i < 200; i++) { [x, v] = spring(x, v, 0, 4, 0.02); if (x > prev + 1e-12 || x < -1e-12) mono = false; prev = x; }
  ok(mono, 'spring from rest: no overshoot and finite for dt 1e-4 .. 1000 s');
  let a = [2, 0.5], b = [2, 0.5];
  a = spring(a[0], a[1], 0.3, 3, 1);
  for (let i = 0; i < 1000; i++) b = spring(b[0], b[1], 0.3, 3, 0.001);
  ok(Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9, 'spring: one step of 1 s = 1000 steps of 1 ms (exact)');
  const cam = createCamera();
  cam.frameWorld(A.world, 0.5);
  const r = rng(5);
  let finite = true;
  for (let i = 0; i < 400; i++) {
    const dt = [0, 1e-5, 0.016, 0.1, 0.3, 0.49][i % 6];
    if (i % 7 === 0) cam.orbitZoomAt(r() * 2 - 1, r() * 2 - 1, (r() - 0.5) * 8, A.world);
    cam.orbitRotate((r() - 0.5) * 200, (r() - 0.5) * 100);
    cam.update(dt, {}, A.world);
    cam.matrices(W, H, {});
    if (![...cam.pos, ...cam.forward, cam.orbit.dist].every(Number.isFinite)) finite = false;
  }
  ok(finite && cam.orbit.dist <= A.world.size * 1.8 + 1, 'orbit update is finite for dt 0 .. 0.49 s with impulses');
}

// a fresh orbit camera over the world, framed once
function orbitCam(w, o) {
  const cam = createCamera();
  cam.orbit = { target: o.target.slice(), yaw: o.yaw, pitch: o.pitch, dist: o.dist };
  cam.update(1, {}, w);
  cam.matrices(W, H, { shift: o.shift });
  return cam;
}

// ── zoom to the cursor
{
  const w = A.world;
  let worst = 0, closer = true, n = 0;
  for (const [cx, cy, shift] of [[0.4, -0.3, [0, 0]], [-0.6, -0.5, [0, 0.3]], [0.1, 0.2, [0.1, -0.2]]]) {
    const cam = orbitCam(w, { target: [800, ground(w, 800, -600), -600], yaw: 1.1, pitch: -0.7, dist: 6000, shift });
    const P = cam.pick(cx, cy, w);
    if (!P) { worst = Infinity; continue; }
    const d0 = Math.hypot(...cam.pos.map((v, i) => v - P[i]));
    cam.orbitZoomAt(cx, cy, 3, w);
    for (let f = 0; f < 90; f++) {
      cam.update(1 / 60, {}, w);
      worst = Math.max(worst, px(ndcOf(cam, P, shift), [cx, cy]));
      n++;
    }
    const d1 = Math.hypot(...cam.pos.map((v, i) => v - P[i]));
    if (!(Math.abs(d1 / d0 - 0.8 ** 3) < 0.01)) closer = false;
    // and out again
    cam.orbitZoomAt(cx, cy, -2, w);
    const Q = cam.pick(cx, cy, w);
    for (let f = 0; f < 90; f++) { cam.update(1 / 60, {}, w); worst = Math.max(worst, Q ? px(ndcOf(cam, Q, shift), [cx, cy]) : 0); }
  }
  ok(worst < 0.5, `zoom to the cursor: the picked point stays under the cursor (worst ${worst.toFixed(3)} px in ${n} frames)`);
  ok(closer, 'zoom: 3 wheel steps take the eye to 0.8^3 of the distance to the point');
  // zoom in hard: MIN_DIST and the clearance hold
  const cam = orbitCam(w, { target: [0, ground(w, 0, 0), 0], yaw: 0.3, pitch: -0.5, dist: 3000 });
  const P = cam.pick(0, -0.2, w);
  for (let k = 0; k < 40; k++) { cam.orbitZoomAt(0, -0.2, 4, w); for (let f = 0; f < 6; f++) cam.update(1 / 60, {}, w); }
  for (let f = 0; f < 120; f++) cam.update(1 / 60, {}, w);
  const dP = Math.hypot(...cam.pos.map((v, i) => v - P[i]));
  ok(dP >= MIN_DIST - 0.5 && cam.pos[1] >= ground(w, cam.pos[0], cam.pos[2]) + CLEAR, `zoom in hard stops at ${dP.toFixed(1)} m (MIN_DIST ${MIN_DIST}) over the ground`);
  for (let k = 0; k < 60; k++) { cam.orbitZoomAt(0, 0, -5, w); for (let f = 0; f < 4; f++) cam.update(1 / 60, {}, w); }
  ok(cam.orbit.dist <= w.size * 1.8 + 1, `zoom out stops at ${Math.round(cam.orbit.dist)} m (world ${w.size} m x 1.8)`);
}

// ── grab and drag, turn round the pivot
{
  const w = A.world;
  const cam = orbitCam(w, { target: [-1500, ground(w, -1500, 900), 900], yaw: 2.2, pitch: -0.8, dist: 5000 });
  const a = [-0.3, -0.2], b = [0.35, 0.25];
  const G = cam.orbitBegin(a[0], a[1], w);
  for (let k = 1; k <= 20; k++) {
    const t = k / 20;
    cam.orbitDrag(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, w);
    cam.update(1 / 60, {}, w);
  }
  const e = px(ndcOf(cam, G, [0, 0]), b);
  ok(G && e < 0.5, `grab and drag: the grip point is under the pointer (${e.toFixed(3)} px)`);
  cam.orbitEnd();
  const t0 = cam.orbit.target.slice();
  for (let f = 0; f < 60; f++) cam.update(1 / 60, {}, w);
  const glide = Math.hypot(cam.orbit.target[0] - t0[0], cam.orbit.target[2] - t0[2]);
  ok(glide > 1, `a fling glides on after the release (${glide.toFixed(0)} m)`);
  for (let f = 0; f < 240; f++) cam.update(1 / 60, {}, w);
  const c = [0.25, -0.35];
  const Pv = cam.orbitBegin(c[0], c[1], w);
  let worst = 0, pitchOK = true;
  for (let k = 0; k < 40; k++) {
    cam.orbitRotate(9, k < 20 ? 3 : -4);
    cam.update(1 / 60, {}, w);
    worst = Math.max(worst, px(ndcOf(cam, Pv, [0, 0]), c));
    if (cam.orbit.pitch > PITCH_MAX + 1e-9 || cam.orbit.pitch < PITCH_MIN - 1e-9) pitchOK = false;
  }
  cam.orbitEnd();
  ok(worst < 0.5, `turn round the pivot: the pivot stays under the pointer (worst ${worst.toFixed(3)} px)`);
  for (let k = 0; k < 60; k++) { cam.orbitBegin(0, 0, w); cam.orbitRotate(0, k % 2 ? 300 : -300); cam.update(1 / 30, {}, w); cam.orbitEnd(); }
  ok(pitchOK && cam.orbit.pitch <= PITCH_MAX + 1e-9 && cam.orbit.pitch >= PITCH_MIN - 1e-9, 'pitch stays in PITCH_MIN .. PITCH_MAX');
}

// ── two fingers: pinch, twist and drag
{
  const flat = { heightAt: () => 50, size: 16000, seaLevel: -100 };
  const cam = orbitCam(flat, { target: [0, 50, 0], yaw: 0.7, pitch: -1.53, dist: 3000 });
  const fa = [-0.3, 0.1], fb = [0.2, -0.2];
  const pa = cam.pick(...fa, flat), pb = cam.pick(...fb, flat);
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  // NDC is not square: measure the finger distance and angle in px
  const dist = (p, q) => Math.hypot((p[0] - q[0]) * W, (p[1] - q[1]) * H);
  const ang = (p, q) => Math.atan2((q[1] - p[1]) * H, (q[0] - p[0]) * W);
  let A0 = fa, B0 = fb;
  cam.orbitGestureBegin(...mid(A0, B0), flat);
  // the fingers spread x 1.6, turn 0.5 rad counterclockwise and move
  const c0 = mid(fa, fb), s = 1.6, rot = 0.5, mv = [0.15, 0.1];
  const place = (p, t) => {
    const k = 1 + (s - 1) * t, a = rot * t;
    const dx = (p[0] - c0[0]) * W, dy = (p[1] - c0[1]) * H;
    const x = (dx * Math.cos(a) - dy * Math.sin(a)) * k, y = (dx * Math.sin(a) + dy * Math.cos(a)) * k;
    return [c0[0] + mv[0] * t + x / W, c0[1] + mv[1] * t + y / H];
  };
  for (let i = 1; i <= 24; i++) {
    const A1 = place(fa, i / 24), B1 = place(fb, i / 24);
    cam.orbitGesture(...mid(A1, B1), dist(A0, B0) / dist(A1, B1), wrap(ang(A1, B1) - ang(A0, B0)), flat);
    cam.update(1 / 60, {}, flat);
    A0 = A1; B0 = B1;
  }
  const ea = px(ndcOf(cam, pa, [0, 0]), A0), eb = px(ndcOf(cam, pb, [0, 0]), B0);
  ok(ea < 4 && eb < 4, `pinch, twist and drag: both ground points stay under the fingers (${ea.toFixed(2)} px, ${eb.toFixed(2)} px)`);
  ok(Math.abs(cam.orbit.dist - 3000 / s) < 60, `pinch x ${s}: the distance goes to ${Math.round(cam.orbit.dist)} m (${Math.round(3000 / s)})`);
}

// ── no ground penetration: random flights, zooms, turns, drags, modes
for (const { world: w, t } of [A, F]) {
  const r = rng(w.size), cam = createCamera();
  cam.frameWorld(w, 0.55);
  cam.update(1, {}, w);
  let worst = Infinity, frames = 0, bad = null;
  const ridges = (t.ridges || []).slice().sort((a, b) => b.pts.length - a.pts.length);
  for (let leg = 0; leg < 60; leg++) {
    const mode = ['orbit', 'fly', 'orbit', 'fly', 'drone'][leg % 5];
    if (mode === 'drone' && ridges.length) {
      cam.drone = dronePath(ridges[leg % Math.min(4, ridges.length)].pts, w, { clearance: 110, lookAhead: 520, lookDown: 90, spacing: 90, window: 320 });
      cam.droneS = 0; cam.droneSpeed = 85; cam.mode = 'drone';
    } else if (mode !== 'drone') cam.setMode(mode, w);
    if (mode === 'orbit' && leg % 3 === 0) { const x = (r() - 0.5) * w.size * 0.8, z = (r() - 0.5) * w.size * 0.8; cam.flyTo(x, z, w); }
    const move = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1].map(v => (Math.abs(v) < 0.3 ? 0 : Math.sign(v)));
    const boost = r() < 0.3;
    for (let f = 0; f < 120; f++) {
      const dt = 0.004 + r() * 0.096;
      if (cam.mode === 'orbit') {
        if (f % 10 === 0) cam.orbitZoomAt(r() * 2 - 1, r() * 2 - 1, (r() - 0.35) * 6, w);
        if (f === 20) cam.orbitBegin(r() * 2 - 1, r() * 2 - 1, w);
        if (f > 20 && f < 60) cam.orbitRotate((r() - 0.5) * 40, (r() - 0.45) * 30);
        if (f === 60) { cam.orbitEnd(); cam.orbitBegin(r() * 2 - 1, -r(), w); }
        if (f > 60 && f < 90) cam.orbitDrag(r() * 2 - 1, -r(), w);
        if (f === 90) cam.orbitEnd();
      }
      cam.update(dt, { move: cam.mode === 'fly' ? move : [0, 0, 0], look: cam.mode === 'fly' ? [(r() - 0.5) * 30, (r() - 0.5) * 20] : [0, 0], boost }, w);
      cam.matrices(W, H, {});
      const c = cam.pos[1] - ground(w, cam.pos[0], cam.pos[2]);
      if (c < worst) { worst = c; bad = cam.mode; }
      frames++;
    }
  }
  ok(worst >= CLEAR - 1e-6, `${w.size} m world: ${frames} random frames, the eye is never under ground + CLEAR (min ${worst.toFixed(2)} m, ${bad})`);
}

// ── drone paths: clearance, even speed, no yaw flips, ease in and out
{
  const { world: w, t } = A;
  const rivers = (t.rivers || []).slice().sort((a, b) => b.pts.length - a.pts.length);
  const ridges = (t.ridges || []).slice().sort((a, b) => b.pts.length - a.pts.length);
  const cases = [];
  if (ridges[0]) cases.push(['ridge', ridges[0].pts, { clearance: 110, lookAhead: 520, lookDown: 90, spacing: 90, window: 320 }, 85]);
  if (rivers[0]) cases.push(['river', rivers[0].pts, { clearance: 45, lookAhead: 520, lookDown: 80, spacing: 70, window: 400, side: 420, sideK: 0.8 }, 45]);
  // a vista: the high opening pass straight over the world
  const vp = []; for (let i = 0; i <= 40; i++) vp.push(-w.size * 0.4 + i / 40 * w.size * 0.8, -w.size * 0.1 + Math.sin(i / 6) * 800);
  cases.push(['vista', new Float32Array(vp), { clearance: 350, lookAhead: 2600, lookDown: 900, spacing: 150, window: 2200, side: 1500, sideK: 0.6, pitchMin: -0.38, pitchMax: -0.2 }, 120]);
  // a hairpin: the old look-ahead turned the camera round in one frame
  const hp = [];
  for (let i = 0; i <= 25; i++) hp.push(-2500 + i * 100, -300);
  for (let i = 1; i < 30; i++) { const a = -Math.PI / 2 + Math.PI * i / 30; hp.push(Math.cos(a) * 300, Math.sin(a) * 300); }
  for (let i = 0; i <= 25; i++) hp.push(-i * 100, 300);
  cases.push(['hairpin', new Float32Array(hp), { clearance: 90, lookAhead: 520, lookDown: 80, spacing: 70, window: 300 }, 85]);
  for (const [name, pts, o, speed] of cases) {
    const d = dronePath(pts, w, o);
    let minC = Infinity;
    for (let s = 0; s <= d.len; s += 1) { const p = d.at(s).pos; minC = Math.min(minC, p[1] - ground(w, p[0], p[2])); }
    ok(minC >= o.clearance - 3, `${name}: the path is over the ground at 1 m steps (min ${minC.toFixed(1)} m, clearance ${o.clearance})`);
    const cam = createCamera();
    cam.frameWorld(w, 0.5); cam.update(1, {}, w);
    cam.drone = d; cam.droneS = 0; cam.droneSpeed = speed; cam.mode = 'drone';
    const dt = 1 / 60, v = [], yawStep = [], ds = [];
    let last = null, lastYaw = null;
    const nF = Math.min(24 * 60, Math.ceil((d.len / speed + DRONE_RAMP) / dt));
    for (let f = 0; f < nF; f++) {
      const s0 = cam.droneS;
      cam.update(dt, {}, w);
      ds.push((cam.droneS - s0) / dt);
      const y = yawOf(cam.forward);
      if (last) {
        const sp = Math.hypot(...cam.pos.map((x, i) => x - last[i])) / dt;
        // cruise: after the glide in from the orbit view and the ease-in
        if (f * dt > 10 && d.len - cam.droneS > Math.max(120, speed * 3) + speed) v.push(sp);
        if (f * dt > 0.8) yawStep.push(Math.abs(wrap(y - lastYaw)));
      }
      last = cam.pos.slice(); lastYaw = y;
    }
    if (v.length > 30) {
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
      ok(sd / m < 0.01 && Math.abs(m - speed) / speed < 0.02, `${name}: even speed ${m.toFixed(2)} m/s (set ${speed}), sd ${sd.toFixed(4)} m/s over ${v.length} frames`);
    } else ok(name === 'hairpin', `${name}: cruise frames for the speed check (${v.length})`);
    const k1 = Math.round(DRONE_RAMP / 2 / dt);
    ok(ds[0] < speed * 0.01 && ds[k1] > speed * 0.4 && ds[k1] < speed * 0.6 && ds.slice(0, 2 * k1).every((x, i) => i === 0 || x >= ds[i - 1] - 1e-9),
      `${name}: the speed eases in (${ds[0].toFixed(3)}, ${ds[k1].toFixed(1)}, ${ds[2 * k1 - 1].toFixed(1)} m/s at 0, ${DRONE_RAMP / 2}, ${DRONE_RAMP} s)`);
    // the end: brake to a stop with no jerk
    cam.droneS = Math.max(0, d.len - speed * 8);
    const ve = [];
    for (let f = 0; f < 60 * 14; f++) {
      const s0 = cam.droneS; cam.update(dt, {}, w); ve.push((cam.droneS - s0) / dt);
      const y = yawOf(cam.forward);
      if (f > 90) yawStep.push(Math.abs(wrap(y - lastYaw)));   // after the jump to the end part
      lastYaw = y;
    }
    if (process.env.CAM_DEBUG) console.log(name, d.len.toFixed(0), ve.filter((_, i) => i % 30 === 0).map(x => x.toFixed(1)).join(' '));
    const maxDrop = Math.max(...ve.slice(1).map((x, i) => ve[i] - x));
    ok(cam.droneS === d.len && ve[ve.length - 1] === 0 && maxDrop < speed * 0.05, `${name}: the drone brakes to a stop at the end (largest speed drop ${maxDrop.toFixed(2)} m/s per frame)`);
    const maxYaw = Math.max(...yawStep);
    ok(maxYaw < 0.03, `${name}: no yaw step over 0.03 rad per frame at 60 fps (max ${maxYaw.toFixed(4)})`);
  }
}

// ── take over and resume, flyTo, mode glides, FOV
{
  const { world: w, t } = A;
  const ridges = (t.ridges || []).slice().sort((a, b) => b.pts.length - a.pts.length);
  const cam = createCamera();
  cam.frameWorld(w, 0.5); cam.update(1, {}, w);
  cam.drone = dronePath(ridges[0].pts, w, { clearance: 110, lookAhead: 520, lookDown: 90, spacing: 90, window: 320 });
  cam.droneS = 0; cam.droneSpeed = 85; cam.mode = 'drone';
  cam.update(1, {}, w);   // a saver cut: no glide in, full speed
  const dt = 1 / 60;
  let yawMax = 0, stepMax = 0, last = cam.pos.slice(), lastYaw = yawOf(cam.forward);
  const track = () => {
    const y = yawOf(cam.forward);
    yawMax = Math.max(yawMax, Math.abs(wrap(y - lastYaw)));
    stepMax = Math.max(stepMax, Math.hypot(...cam.pos.map((x, i) => x - last[i])));
    last = cam.pos.slice(); lastYaw = y;
  };
  for (let f = 0; f < 360; f++) { cam.update(dt, {}, w); track(); }
  const pd = cam.pos.slice(); cam.update(dt, {}, w); track();
  const vDrone = Math.hypot(...cam.pos.map((x, i) => x - pd[i])) / dt;
  cam.setMode('fly', w);
  const p0 = cam.pos.slice();
  cam.update(dt, {}, w); track();
  const v1 = Math.hypot(...cam.pos.map((x, i) => x - p0[i])) / dt;
  ok(v1 > 85 * 0.9 && v1 < 85 * 1.1, `take-over: fly starts at the drone speed (${v1.toFixed(1)} m/s, drone 85)`);
  for (let f = 0; f < 240; f++) { cam.update(dt, { look: [2, 0] }, w); track(); }
  let still = 0; for (let f = 0; f < 5; f++) { const a = cam.pos.slice(); cam.update(dt, {}, w); still = Math.hypot(...cam.pos.map((x, i) => x - a[i])) / dt; }
  ok(still < 10, `take-over: with no input the fly speed decays (${still.toFixed(2)} m/s after 4 s)`);
  for (let f = 0; f < 60; f++) { cam.update(dt, { move: [1, 0, 0.5] }, w); track(); }
  const resumed = cam.resumeDrone(w);
  for (let f = 0; f < 300; f++) { cam.update(dt, {}, w); track(); }
  ok(resumed && cam.mode === 'drone' && cam.droneS > 0, `resume: the drone flies on from the nearest path point (s ${Math.round(cam.droneS)} m)`);
  // flyTo and the glides between modes
  cam.setMode('orbit', w);
  for (let f = 0; f < 120; f++) { cam.update(dt, {}, w); track(); }
  cam.flyTo(w.size * 0.3, -w.size * 0.25, w);
  let done = -1;
  for (let f = 0; f < 600; f++) { cam.update(dt, {}, w); track(); if (done < 0 && !cam.orbitGoal) done = f; }
  const tgtErr = Math.hypot(cam.orbit.target[0] - w.size * 0.3, cam.orbit.target[2] + w.size * 0.25);
  ok(done > 0 && tgtErr < 2, `flyTo: the target arrives in ${(done * dt).toFixed(2)} s (error ${tgtErr.toFixed(2)} m)`);
  cam.setMode('fly', w); for (let f = 0; f < 30; f++) { cam.update(dt, {}, w); track(); }
  cam.drone = dronePath(ridges[1 % ridges.length].pts, w, { clearance: 110, lookAhead: 520, lookDown: 90, spacing: 90, window: 320 });
  cam.droneS = 0; cam.mode = 'drone';
  for (let f = 0; f < 300; f++) { cam.update(dt, {}, w); track(); }
  ok(yawMax < 0.1, `take-over, resume, flyTo, new drone: no yaw step over 0.1 rad per frame (max ${yawMax.toFixed(4)})`);
  ok(stepMax < w.size * 0.03, `the same: no jump of the eye (max step ${stepMax.toFixed(1)} m per frame, drone ${vDrone.toFixed(1)} m/s)`);
  // FOV glide
  cam.fovY = 50 * Math.PI / 180; cam.update(1, {}, w); cam.matrices(W, H);
  cam.fovY = 70 * Math.PI / 180;
  let fv = [], mono = true;
  for (let f = 0; f < 90; f++) { cam.update(dt, {}, w); const m = cam.matrices(W, H); if (fv.length && m.fovY < fv[fv.length - 1] - 1e-9) mono = false; fv.push(m.fovY); }
  ok(mono && fv[0] < 52 * Math.PI / 180 && Math.abs(fv[fv.length - 1] - cam.fovY) < 0.01, `FOV glides from 50 to 70 deg with no overshoot (frame 1 ${(fv[0] * 180 / Math.PI).toFixed(2)} deg)`);
}

// ── the near plane low down, the trunk query
{
  const w = { heightAt: () => 100, size: 8000, seaLevel: 0 };
  const cam = createCamera();
  cam.setMode('fly', w);
  const nearAt = h => { cam.fly.pos = [0, 100 + h, 0]; cam.update(1, {}, w); const m = cam.matrices(W, H); return [m.near, m.proj[14]]; };
  const [n1, p1] = nearAt(2), [n2] = nearAt(80), [n3] = nearAt(120), [n4, p4] = nearAt(400);
  ok(Math.abs(n1 - 0.1) < 1e-9 && Math.abs(p1 - 0.1) < 1e-6 && Math.abs(n2 - 0.1) < 1e-9 && n3 > 0.1 && n3 < 0.5 && Math.abs(n4 - 0.5) < 1e-9 && Math.abs(p4 - 0.5) < 1e-6,
    `near plane: ${n1} m at 2 m, ${n2} m at 80 m, ${n3.toFixed(2)} m at 120 m, ${n4} m at 400 m over the ground (proj[14] the same)`);
  const wt = { ...w, trunkAt: () => ({ x: 0, z: -20, r: 0.6 }) };
  cam.fly = { pos: [0, 102, 0], yaw: 0, pitch: 0 }; cam.update(1, {}, wt);
  let minD = Infinity;
  for (let f = 0; f < 240; f++) { cam.update(1 / 60, { move: [0, 0, 1] }, wt); minD = Math.min(minD, Math.hypot(cam.pos[0], cam.pos[2] + 20)); }
  ok(minD >= 1.0 - 1e-6, `fly into a trunk (r 0.6 m): the eye stays ${minD.toFixed(3)} m from its axis (>= r + 0.4)`);
}

// ── input.js with a fake canvas (no DOM): the events reach the camera
{
  const L = {}, G = {};
  const target = map => ({ addEventListener: (k, f) => { (map[k] ||= []).push(f); } });
  const fire = (map, k, e) => (map[k] || []).forEach(f => f({ preventDefault() {}, clientX: 0, clientY: 0, pointerId: 1, pointerType: 'mouse', button: 0, ...e }));
  globalThis.addEventListener ||= target(G).addEventListener;
  globalThis.document ||= { pointerLockElement: null, addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, firstChild: { style: {} } }), body: { appendChild() {} } };
  globalThis.matchMedia ||= () => ({ matches: false });
  const canvas = { ...target(L), focus() {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }) };
  const { createInput } = await import('../input.js');
  const w = A.world, cam = createCamera();
  const app = { camMode: 'orbit', lastInput: 0, saverRun: null, flyTo: (x, z) => cam.flyTo(x, z, w) };
  const input = createInput({ canvas, app, cam, world: w, ui: () => ({ syncView() {}, toast() {} }), ready: () => true });
  cam.orbit = { target: [0, ground(w, 0, 0), 0], yaw: 0.5, pitch: -0.6, dist: 5000 };
  cam.update(1, {}, w); cam.matrices(W, H);
  const P = cam.pick(0.3, -0.2, w);
  fire(L, 'wheel', { clientX: W * 0.65, clientY: H * 0.6, deltaY: -300, deltaMode: 0 });
  for (let f = 0; f < 90; f++) cam.update(1 / 60, input.take(), w);
  const e1 = px(ndcOf(cam, P, [0, 0]), [0.3, -0.2]);
  ok(cam.orbit.dist < 5000 * 0.6 && e1 < 0.5, `input: the wheel zooms to the cursor (dist ${Math.round(cam.orbit.dist)} m, point ${e1.toFixed(3)} px off)`);
  const y0 = cam.orbit.yaw;
  fire(L, 'pointerdown', { clientX: 600, clientY: 500 });
  for (let i = 1; i <= 10; i++) { fire(L, 'pointermove', { clientX: 600 + i * 10, clientY: 500 }); cam.update(1 / 60, input.take(), w); }
  fire(L, 'pointerup', { clientX: 700, clientY: 500 });
  ok(Math.abs(cam.orbit.yaw - y0) > 0.2, `input: a left drag turns the orbit (yaw ${(cam.orbit.yaw - y0).toFixed(3)} rad)`);
  const d0 = cam.orbit.dist;
  fire(L, 'pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 500, clientY: 400 });
  fire(L, 'pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 700, clientY: 400 });
  for (let i = 1; i <= 10; i++) { fire(L, 'pointermove', { pointerId: 2, pointerType: 'touch', clientX: 500 - i * 10, clientY: 400 }); fire(L, 'pointermove', { pointerId: 3, pointerType: 'touch', clientX: 700 + i * 10, clientY: 400 }); cam.update(1 / 60, input.take(), w); }
  fire(L, 'pointerup', { pointerId: 2, pointerType: 'touch', clientX: 400, clientY: 400 }); fire(L, 'pointerup', { pointerId: 3, pointerType: 'touch', clientX: 800, clientY: 400 });
  ok(Math.abs(cam.orbit.dist / d0 - 0.5) < 0.05, `input: a pinch from 200 to 400 px halves the distance (x ${(cam.orbit.dist / d0).toFixed(3)})`);
  app.camMode = 'fly'; cam.setMode('fly', w); cam.update(1, {}, w);
  fire(L, 'pointerdown', { pointerId: 4, pointerType: 'touch', clientX: 200, clientY: 600 });
  fire(L, 'pointermove', { pointerId: 4, pointerType: 'touch', clientX: 200, clientY: 540 });
  const mv = input.take().move;
  fire(L, 'pointerup', { pointerId: 4, pointerType: 'touch', clientX: 200, clientY: 540 });
  ok(mv[2] > 0.8 && Math.abs(mv[0]) < 1e-9 && input.take().move[2] === 0, `input: the left touch stick pushed up flies forward (move z ${mv[2].toFixed(2)}), the release stops it`);
}

console.log(`# camera: ${pass} pass, ${fail} fail`);
if (fail) process.exitCode = 1;
export default { pass, fail };
