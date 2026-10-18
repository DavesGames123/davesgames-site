// ============================================================================
//  HUMAN SKELETON  ·  tests-focus.mjs — node tests-focus.mjs
// ────────────────────────────────────────────────────────────────────────────
//  The user asked: "clicking a bone on the skeleton page should isolate it"
//  and "or at least move the camera to it". These tests run focus.js on the
//  shipped meshes (all 248 bones), with no browser:
//    pick ....... the ray pick against the real triangles gives the same
//                 bone and depth as a brute-force test of every triangle in
//                 world space, at rest, exploded (radial) and on the tray
//                 (turned bones); named rays hit the sternum before T6
//    thin ....... a ray 1.5 mm past the fibula misses with no tol and
//                 picks the fibula with the tol; 6 mm past misses
//    ghost ...... with one bone isolated, a ghost in front does not take
//                 the pick; a direct hit on a ghost alone does
//    frame ...... the bounding sphere fills FILL of the clear short side
//                 and its centre is at the centre of the clear part (a real
//                 three.js camera with the page's view offset), desktop
//                 and phone
//    flight ..... the flight starts and ends on the poses, the distance
//                 stays between its two ends (no lunge), the target does
//                 not overshoot, and the frame step has no jump
//    view ....... a clear present direction stays; a thoracic vertebra
//                 seen from the front gets a direction with a clear line
//                 of sight; most bones get a clear line of sight
//    press ...... tap, drag (also a drag that comes back), long press, two
//                 fingers
//    step ....... previous / next stay in the region and wrap round
// ============================================================================
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decodeGroup } from './decode.js';
import { prep, radial, catalogue } from './layout.js';
import * as F from './focus.js';
import * as THREE from '../../vendor/three@0.160.0/build/three.module.js';

const here = new URL('.', import.meta.url).pathname;
const M = JSON.parse(readFileSync(here + 'data/manifest.json', 'utf8'));
const bones = M.bones, n = bones.length, byId = new Map(bones.map(b => [b.id, b]));
let pass = 0, fail = 0;
const ok = (cond, name, info = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
function rng(seed) { let a = seed >>> 0 || 1; return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; }; }

// ── the meshes ──────────────────────────────────────────────────────────────
const mesh = new Array(n).fill(null);
for (const f of M.files) {
  const raw = gunzipSync(readFileSync(here + f.url));
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length);
  const list = bones.filter(b => b.file === f.id);
  const g = decodeGroup(buf, list);
  for (const r of g.ranges) mesh[r.i] = F.meshIndex(g.pos, g.idx, r);
}
ok(mesh.every(Boolean), 'every bone has a pick mesh', `${mesh.filter(Boolean).length}/${n}`);
const P = prep(M);
const poseSet = (off, q) => i => ({ c: bones[i].c, off: [off[i * 3], off[i * 3 + 1], off[i * 3 + 2]], q: [q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3]] });
const zeroOff = new Float32Array(n * 3), unitQ = new Float32Array(n * 4);
for (let i = 0; i < n; i++) unitQ[i * 4 + 3] = 1;
const all = () => true;

// brute force: every triangle of every bone, moved to world space
function brute(o, d, pose, use = all) {
  let bi = -1, bt = Infinity;
  for (let i = 0; i < n; i++) {
    if (!use(i)) continue;
    const mi = mesh[i], p = pose(i), w = new Float32Array(mi.nv * 3);
    for (let v = 0; v < mi.nv; v++) {
      const k = (mi.v0 + v) * 3, r = F.qrot(p.q, [mi.pos[k] - p.c[0], mi.pos[k + 1] - p.c[1], mi.pos[k + 2] - p.c[2]]);
      w[v * 3] = r[0] + p.c[0] + p.off[0]; w[v * 3 + 1] = r[1] + p.c[1] + p.off[1]; w[v * 3 + 2] = r[2] + p.c[2] + p.off[2];
    }
    const wm = { pos: w, idx: mi.idx.slice(mi.t0 * 3, (mi.t0 + mi.nt) * 3).map(x => x - mi.v0), v0: 0, nv: mi.nv, t0: 0, nt: mi.nt, lo: [-1e9, -1e9, -1e9], hi: [1e9, 1e9, 1e9], mid: [0, 0, 0], rad: 1e9 };
    const t = F.boneHit(wm, { c: [0, 0, 0], off: [0, 0, 0], q: [0, 0, 0, 1] }, o, d, bt);
    if (t < bt) { bt = t; bi = i; }
  }
  return bi >= 0 ? { i: bi, t: bt } : null;
}

// ── pick ────────────────────────────────────────────────────────────────────
{
  const vis = new Uint8Array(n).fill(1);
  const exploded = radial(P, new Float32Array(n).fill(1));
  const tray = catalogue(P, vis, M.regions, 'region', 1.6);
  const cases = [['at rest', poseSet(zeroOff, unitQ)], ['radial explode', poseSet(exploded, unitQ)], ['tray (turned)', poseSet(tray.off, tray.q)]];
  for (const [name, pose] of cases) {
    const R = rng(name.length * 977);
    const opts = { n, mesh: i => mesh[i], pose, solid: all, tol: 0 };
    // aim at the centres of random bones, from random directions
    let same = 0, hits = 0, worst = 0, rays = 0, bad = [];
    for (let k = 0; k < 36; k++) {
      const b = bones[Math.floor(R() * n)], p = pose(b.i);
      const c = [b.c[0] + p.off[0], b.c[1] + p.off[1], b.c[2] + p.off[2]];
      const az = R() * 6.283, el = (R() - 0.5) * 1.2, dir = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
      const o = [c[0] + dir[0] * 3, c[1] + dir[1] * 3, c[2] + dir[2] * 3], d = [-dir[0], -dir[1], -dir[2]];
      const a = F.pickBones(o, d, opts), z = brute(o, d, pose);
      rays++;
      if (!a && !z) { same++; continue; }
      if (a && z && a.i === z.i && Math.abs(a.t - z.t) < 1e-5) { same++; hits++; worst = Math.max(worst, Math.abs(a.t - z.t)); }
      else bad.push(`${b.id}: ${a ? bones[a.i].id : '-'} vs ${z ? bones[z.i].id : '-'}`);
    }
    ok(same === rays && hits > 25, `pick ${name}: the nearest bone on the real mesh, as brute force`, `${same}/${rays} rays agree, ${hits} hits, worst depth error ${worst.toExponential(1)} m${bad.length ? '; ' + bad.join(', ') : ''}`);
  }
  // named: from the front the ray to T6 meets the sternum first, from the
  // back the ray to the sternum meets T6 (or a rib) first
  const pose = poseSet(zeroOff, unitQ), opts = { n, mesh: i => mesh[i], pose, solid: all, tol: 0 };
  const st = byId.get('sternum'), t6 = byId.get('t6');
  const front = F.pickBones([0, st.c[1] + 0.02, 3], [0, 0, -1], opts);
  ok(front && bones[front.i].id === 'sternum', 'pick: a front ray at the chest hits the sternum, not the spine behind it', front ? bones[front.i].id : 'none');
  const back = F.pickBones([0, t6.c[1], -3], [0, 0, 1], opts);
  ok(back && bones[back.i].region === 'spine', 'pick: the same ray from the back hits the spine first', back ? bones[back.i].id : 'none');
}

// ── thin ────────────────────────────────────────────────────────────────────
{
  const pose = poseSet(zeroOff, unitQ);
  // the fibula at mid shaft: its most lateral vertex in a 1 cm band, then
  // a ray from the front 1.5 mm further out (only the fibula is near)
  const fib = byId.get('fibula-l'), mi = mesh[fib.i];
  let vx = -Infinity, vk = 0;
  for (let v = mi.v0; v < mi.v0 + mi.nv; v++) if (Math.abs(mi.pos[v * 3 + 1] - fib.c[1]) < 0.005 && mi.pos[v * 3] > vx) { vx = mi.pos[v * 3]; vk = v; }
  const o = [vx + 0.0015, mi.pos[vk * 3 + 1], 3], d = [0, 0, -1];
  const no = F.pickBones(o, d, { n, mesh: i => mesh[i], pose, solid: all, tol: 0 });
  // 4 px of tolerance on a 900 px tall view with a 30 deg lens is 0.0006;
  // the test takes 0.001 (1.5 mm at 3 m is 0.0005)
  const yes = F.pickBones(o, d, { n, mesh: i => mesh[i], pose, solid: all, tol: 0.001 });
  const far = F.pickBones([vx + 0.006, o[1], 3], d, { n, mesh: i => mesh[i], pose, solid: all, tol: 0.001 });
  ok(!no && yes && yes.i === fib.i && !yes.exact && !far, 'thin: 1.5 mm past the fibula misses with no tol, picks the fibula with the tol, 6 mm past misses', `${no ? bones[no.i].id : 'miss'} / ${yes ? bones[yes.i].id + (yes.exact ? ' exact' : ' near') : 'miss'} / ${far ? bones[far.i].id : 'miss'}`);
}

// ── ghost ───────────────────────────────────────────────────────────────────
{
  const pose = poseSet(zeroOff, unitQ);
  const t6 = byId.get('t6'), st = byId.get('sternum');
  const iso = t6.i;
  const opts = { n, mesh: i => mesh[i], pose, solid: i => i === iso, ghost: i => i !== iso, tol: 0.003 };
  const a = F.pickBones([0, t6.c[1], 3], [0, 0, -1], opts);
  ok(a && a.i === iso && !a.ghost, 'ghost: with T6 isolated, a front ray through the ghost sternum picks T6', a ? bones[a.i].id : 'none');
  const b = F.pickBones([0, st.c[1] + 0.02, 3], [0, 0, -1], { ...opts, solid: i => i === byId.get('femur-l').i });
  ok(b && b.ghost && bones[b.i].id === 'sternum', 'ghost: a direct hit on a ghost alone picks that ghost (to switch)', b ? bones[b.i].id + (b.ghost ? ' ghost' : '') : 'none');
  const c = F.pickBones([2, 3, 3], [0, 0, -1], opts);
  ok(c === null, 'ghost: a ray in the empty room picks nothing');
}

// ── frame ───────────────────────────────────────────────────────────────────
{
  const cam = new THREE.PerspectiveCamera(30, 1, 0.015, 60);
  const fy = Math.tan(THREE.MathUtils.degToRad(15));
  const views = [
    { name: 'desktop 1440x848, panel 340 px left, card 364 px right', w: 1440, h: 848, o: { l: 340, r: 364, t: 0, b: 0 } },
    { name: 'phone 390x690, card 300 px top, chip 62 px bottom', w: 390, h: 690, o: { l: 0, r: 0, t: 300, b: 62 } },
  ];
  for (const V of views) {
    cam.aspect = V.w / V.h;
    cam.setViewOffset(V.w, V.h, (V.o.l - V.o.r) / -2, (V.o.t - V.o.b) / -2, V.w, V.h);
    cam.updateProjectionMatrix();
    const clear = { x0: V.o.l, x1: V.w - V.o.r, y0: V.o.t, y1: V.h - V.o.b, h: V.h };
    const short = Math.min(clear.x1 - clear.x0, clear.y1 - clear.y0);
    let worstFill = 0, worstC = 0, count = 0;
    for (const b of bones) {
      const d = F.frameDistance(b.r, fy, clear);
      const u = new THREE.Vector3(0.3, 0.2, 1).normalize();
      const c = new THREE.Vector3(...b.c);
      cam.position.copy(c).addScaledVector(u, d); cam.lookAt(c); cam.updateMatrixWorld();
      const p = c.clone().project(cam);
      const px = (p.x + 1) / 2 * V.w, py = (1 - p.y) / 2 * V.h;
      worstC = Math.max(worstC, Math.hypot(px - (clear.x0 + clear.x1) / 2, py - (clear.y0 + clear.y1) / 2));
      // the sphere's outline: the tangent angle round the view axis
      const ang = Math.asin(b.r / d), rpx = Math.tan(ang) / fy * V.h / 2;
      worstFill = Math.max(worstFill, Math.abs(2 * rpx / short - F.FILL));
      count++;
    }
    ok(worstC < 0.5 && worstFill < 0.005, `frame ${V.name}: the sphere fills ${F.FILL} of the clear short side, centred`, `${count} bones, worst centre ${worstC.toFixed(3)} px, worst fill error ${worstFill.toFixed(4)}`);
    const tiny = byId.get('mpt5-l'), dmin = F.frameDistance(tiny.r, fy, clear, F.FILL, 0.035);
    ok(dmin >= 0.035 && F.sphereFill(tiny.r, dmin, fy, clear) <= F.FILL + 1e-9, `frame ${V.name}: the near limit holds on the smallest bone`, `d ${dmin.toFixed(3)} m, fill ${F.sphereFill(tiny.r, dmin, fy, clear).toFixed(2)}`);
  }
}

// ── flight ──────────────────────────────────────────────────────────────────
{
  const R = rng(5);
  let worst = { ends: 0, dist: 0, over: 0, jump: 0 };
  for (let k = 0; k < 200; k++) {
    const t0 = [R() - 0.5, R() * 1.7, R() - 0.5], t1 = [R() - 0.5, R() * 1.7, R() - 0.5];
    const u0 = F.slerpDir([R() - 0.5, R() - 0.5, R() - 0.5].map((x, j, a) => x / Math.hypot(...a)), [0, 0, 1], 0), u1 = [R() - 0.5, R() - 0.5, R() - 0.5].map((x, j, a) => x / Math.hypot(...a));
    const f = { t0, t1, u0, u1, r0: 0.05 + R() * 4, r1: 0.05 + R() * 4 };
    const a = F.flightPose(f, 0), b = F.flightPose(f, 1);
    const e0 = Math.hypot(a.pos[0] - t0[0] - u0[0] * f.r0, a.pos[1] - t0[1] - u0[1] * f.r0, a.pos[2] - t0[2] - u0[2] * f.r0);
    const e1 = Math.hypot(b.pos[0] - t1[0] - u1[0] * f.r1, b.pos[1] - t1[1] - u1[1] * f.r1, b.pos[2] - t1[2] - u1[2] * f.r1);
    worst.ends = Math.max(worst.ends, e0, e1);
    let prev = a, steps = [];
    for (let s = 1; s <= 60; s++) {
      const p = F.flightPose(f, s / 60);
      const lo = Math.min(f.r0, f.r1), hi = Math.max(f.r0, f.r1);
      worst.dist = Math.max(worst.dist, lo - p.r, p.r - hi);
      const along = ((p.target[0] - t0[0]) * (t1[0] - t0[0]) + (p.target[1] - t0[1]) * (t1[1] - t0[1]) + (p.target[2] - t0[2]) * (t1[2] - t0[2])) / Math.max(1e-9, Math.hypot(t1[0] - t0[0], t1[1] - t0[1], t1[2] - t0[2]) ** 2);
      worst.over = Math.max(worst.over, along - 1, -along);
      steps.push(Math.abs(Math.log(p.r / prev.r)));
      prev = p;
    }
    // the log-distance step at the busiest frame against the mean step
    const mean = steps.reduce((x, y) => x + y, 0) / steps.length;
    if (mean > 1e-6) worst.jump = Math.max(worst.jump, Math.max(...steps) / mean);
  }
  ok(worst.ends < 1e-9, 'flight: it starts and ends on the two poses', worst.ends.toExponential(1));
  ok(worst.dist <= 1e-9 && worst.over <= 1e-9, 'flight: the distance stays between its two ends and the target does not overshoot (no lunge)', `${worst.dist.toExponential(1)}, ${worst.over.toExponential(1)}`);
  ok(worst.jump < 1.65, 'flight: the busiest frame zooms under 1.65 x the mean step (eased, on a log scale)', worst.jump.toFixed(2));
}

// ── view ────────────────────────────────────────────────────────────────────
{
  const pose = poseSet(zeroOff, unitQ);
  const cast = { n, mesh: i => mesh[i], pose, solid: i => bones[i].type !== 'cartilage' };
  const fy = Math.tan(Math.PI / 12), clear = { x0: 340, x1: 1076, y0: 0, y1: 848, h: 848 };
  const u0 = [0.3, 0.1, 1].map((x, j, a) => x / Math.hypot(...a)), t0 = [0, 0.9, 0], r0 = 4.2;
  const view = b => F.chooseView({ u0, t0, r0, c: b.c, d: F.frameDistance(b.r, fy, clear, F.FILL, 0.035), i: b.i, cast });
  const femur = view(byId.get('femur-l'));
  ok(femur.u.every((x, k) => Math.abs(x - u0[k]) < 1e-12) && femur.los === 0, 'view: the femur from the front keeps the present direction', `los ${femur.los}, path ${femur.path}`);
  // straight from the front, the line to T6 meets the sternum
  const t6 = byId.get('t6'), uf = [0, 0, 1], dt6 = F.frameDistance(t6.r, fy, clear, F.FILL, 0.035);
  const v6 = F.chooseView({ u0: uf, t0, r0, c: t6.c, d: dt6, i: t6.i, cast });
  const front = F.crossings(t6.c.map((x, k) => x + uf[k] * dt6), t6.c, cast, t6.i);
  ok(front > 0 && v6.los === 0 && v6.path === 0, 'view: T6 from the front is behind the sternum and ribs, so the camera turns to a clear side', `front crosses ${front}, chosen crosses ${v6.los}, turn ${(Math.acos(v6.u[2]) * 180 / Math.PI).toFixed(0)} deg`);
  const big = bones.filter(b => b.counted && b.len >= 20);
  let clearN = 0, keep = 0, worstMs = 0;
  for (const b of big) {
    const s = performance.now(), v = view(b); worstMs = Math.max(worstMs, performance.now() - s);
    if (v.los === 0) clearN++;
    if (v.u.every((x, k) => Math.abs(x - u0[k]) < 1e-12)) keep++;
  }
  ok(clearN / big.length > 0.85, 'view: most bones of 20 mm or more get a clear line of sight', `${clearN}/${big.length} clear, ${keep} keep the present direction, slowest ${worstMs.toFixed(0)} ms`);
}

// ── press ───────────────────────────────────────────────────────────────────
{
  const d = { x: 100, y: 100, t: 0 };
  ok(F.pressKind(d, { x: 102, y: 101, t: 150 }, 2.2, false) === 'tap', 'press: a short still click is a tap');
  ok(F.pressKind(d, { x: 140, y: 100, t: 300 }, 40, false) === 'drag', 'press: an orbit drag is not a tap');
  ok(F.pressKind(d, { x: 101, y: 100, t: 400 }, 60, false) === 'drag', 'press: a drag that comes back to its start is not a tap');
  ok(F.pressKind(d, { x: 103, y: 104, t: 200 }, 6, true) === 'tap' && F.pressKind(d, { x: 103, y: 104, t: 200 }, 6, false) === 'drag', 'press: touch takes 10 px of jitter, the mouse 5 px');
  ok(F.pressKind(d, { x: 101, y: 100, t: 700 }, 2, true) === 'long', 'press: a held touch is a long press');
  ok(F.pressKind(d, { x: 100, y: 100, t: 100 }, 0, true, true) === 'drag', 'press: two fingers are never a tap');
}

// ── step ────────────────────────────────────────────────────────────────────
{
  const vis = new Uint8Array(n).fill(1);
  const hand = bones.filter(b => b.region === 'hand-l');
  const first = hand[0].i, last = hand[hand.length - 1].i;
  ok(F.regionStep(bones, vis, first, 1) === hand[1].i && F.regionStep(bones, vis, first, -1) === last && F.regionStep(bones, vis, last, 1) === first,
    'step: previous and next stay in the region and wrap round', `${hand.length} bones in hand-l`);
  vis[hand[1].i] = 0;
  ok(F.regionStep(bones, vis, first, 1) === hand[2].i, 'step: a hidden bone is passed over');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
