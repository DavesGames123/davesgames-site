// ============================================================================
//  TEST-SCORE  ·  checks score.js on synthetic worlds (node tools/test-score.mjs)
// ----------------------------------------------------------------------------
//  The test makes its own worlds, so that it does not need scenes.js:
//    cube      a box that bounces on the floor (exact ballistic physics,
//              restitution 0.7) and turns, next to a static crate
//    slow      the same motion played at 0.8 x speed (time error)
//    frozen    frame 0 in every frame
//    shifted   the exact motion, moved 5 cm on x
//    grains    400 particles that fall and stop on the floor
//    cloth     a 60 x 60 sheet that waves, plus 2000 particles (timing)
//  Checks:
//    1. Every world scored against itself gives >= 0.99 in every metric.
//    2. Frozen is the worst variant on both dynamics families.
//    3. Shift: the geometry loss is larger than the dynamics loss.
//    4. Time error: the dynamics loss is larger than the geometry loss.
//    5. A 90-frame pair scores in less than 1500 ms.
//  The script exits with code 1 if a check fails.
//
//  grep -n targets: "function cubeWorld", "function grainsWorld",
//  "function clothWorld", "CHECKS"
// ============================================================================

import { scoreWorld, METRIC_INFO } from '../score.js';
import { validate } from '../world.js';

const FPS = 30, T = 90, G = 9.81;
const CAMERA = { eye: [0, 1.4, 4.5], target: [0, 0.6, 0], fovY: 40 };

function boxMesh(h) {
  const v = [];
  for (const x of [-h, h]) for (const y of [-h, h]) for (const z of [-h, h]) v.push([x, y, z]);
  // Vertex index = 4 * (x > 0) + 2 * (y > 0) + (z > 0).
  const q = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  const f = [];
  for (const [a, b, c, d] of q) f.push(a, b, c, a, c, d);
  return { verts: v, faces: new Uint32Array(f) };
}

// Height of the bottom of a box dropped from h0, restitution e, at time t.
function bounceHeight(h0, e, t) {
  let tf = Math.sqrt(2 * h0 / G);
  if (t < tf) return h0 - 0.5 * G * t * t;
  t -= tf;
  let v = e * G * tf;
  while (v > 1e-3) {
    const fl = 2 * v / G;
    if (t < fl) return v * t - 0.5 * G * t * t;
    t -= fl; v *= e;
  }
  return 0;
}

// Cube world. motion(t) gives the time used for frame t (seconds).
function cubeWorld({ timeOf = t => t, shift = [0, 0, 0] } = {}) {
  const h = 0.2, { verts, faces } = boxMesh(h);
  const pos = new Float32Array(T * 8 * 3);
  for (let f = 0; f < T; f++) {
    const t = timeOf(f / FPS);
    const cx = -1 + 0.6 * t, cy = bounceHeight(1.5, 0.7, t) + h, a = 1.0 * t;
    const c = Math.cos(a), s = Math.sin(a);
    verts.forEach((p, i) => {
      const k = (f * 8 + i) * 3;
      pos[k] = cx + c * p[0] + s * p[2] + shift[0];
      pos[k + 1] = cy + p[1] + shift[1];
      pos[k + 2] = -s * p[0] + c * p[2] + shift[2];
    });
  }
  const cr = boxMesh(0.25), cpos = new Float32Array(8 * 3);
  cr.verts.forEach((p, i) => { cpos[i * 3] = p[0] + 1.3 + shift[0]; cpos[i * 3 + 1] = p[1] + 0.25 + shift[1]; cpos[i * 3 + 2] = p[2] - 0.3 + shift[2]; });
  return { fps: FPS, frames: T, camera: CAMERA, objects: [
    { name: 'cube', kind: 'mesh', color: [0.9, 0.4, 0.2], dynamic: true, count: 8, faces, pos },
    { name: 'crate', kind: 'mesh', color: [0.3, 0.5, 0.8], dynamic: false, count: 8, faces: cr.faces, pos: cpos },
  ] };
}

function frozen(w) {
  const objects = w.objects.map(o => {
    if (o.pos.length === o.count * 3) return o;
    const pos = new Float32Array(o.pos.length), n = o.count * 3;
    for (let f = 0; f < w.frames; f++) pos.set(o.pos.subarray(0, n), f * n);
    return { ...o, pos };
  });
  return { ...w, objects };
}

function shifted(w, dx) {
  return { ...w, objects: w.objects.map(o => {
    const pos = Float32Array.from(o.pos);
    for (let k = 0; k < pos.length; k += 3) pos[k] += dx;
    return { ...o, pos };
  }) };
}

// 400 grains from a block 0.6 m up, with small sideways speeds.
function grainsWorld() {
  const n = 400, r = 0.03, pos = new Float32Array(T * n * 3);
  let s = 12345; const R = () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296;
  const p0 = [], v0 = [];
  for (let i = 0; i < n; i++) { p0.push([-0.3 + 0.6 * R(), 0.6 + 0.6 * R(), -0.3 + 0.6 * R()]); v0.push([0.6 * (R() - 0.5), 0, 0.6 * (R() - 0.5)]); }
  for (let f = 0; f < T; f++) {
    const t = f / FPS;
    for (let i = 0; i < n; i++) {
      const tl = Math.sqrt(2 * (p0[i][1] - r) / G), tt = Math.min(t, tl), k = (f * n + i) * 3;
      pos[k] = p0[i][0] + v0[i][0] * tt;
      pos[k + 1] = Math.max(r, p0[i][1] - 0.5 * G * tt * tt);
      pos[k + 2] = p0[i][2] + v0[i][2] * tt;
    }
  }
  return { fps: FPS, frames: T, camera: CAMERA, objects: [
    { name: 'grains', kind: 'points', color: [0.85, 0.75, 0.5], dynamic: true, count: n, radius: r, pos },
  ] };
}

// 60 x 60 cloth sheet with a travelling wave, plus 2000 orbiting particles.
function clothWorld() {
  const N = 60, n = N * N, pos = new Float32Array(T * n * 3), f = [];
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = j * N + i; f.push(a, a + 1, a + N, a + 1, a + N + 1, a + N);
  }
  for (let fr = 0; fr < T; fr++) {
    const t = fr / FPS;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const u = i / (N - 1), v = j / (N - 1), k = (fr * n + j * N + i) * 3;
      pos[k] = -1 + 2 * u; pos[k + 2] = -1 + 2 * v;
      pos[k + 1] = 0.8 + 0.15 * Math.sin(6 * u - 3 * t) * Math.cos(4 * v + t);
    }
  }
  const m = 2000, pp = new Float32Array(T * m * 3);
  for (let fr = 0; fr < T; fr++) for (let i = 0; i < m; i++) {
    const a = i * 0.37 + fr / FPS, rr = 0.3 + 0.5 * (i / m), k = (fr * m + i) * 3;
    pp[k] = rr * Math.cos(a); pp[k + 1] = 0.2 + 0.1 * (i % 7); pp[k + 2] = rr * Math.sin(a);
  }
  return { fps: FPS, frames: T, camera: CAMERA, objects: [
    { name: 'cloth', kind: 'mesh', color: [0.7, 0.2, 0.3], dynamic: true, count: n, faces: new Uint32Array(f), pos },
    { name: 'drops', kind: 'points', color: [0.3, 0.6, 0.9], dynamic: true, count: m, radius: 0.012, pos: pp },
  ] };
}

const KEYS = Object.keys(METRIC_INFO);
const fmt = x => (typeof x === 'number' ? x.toFixed(3) : String(x));
const geom = r => (r.families.geom25 + r.families.geom3d) / 2;
const dyn = r => (r.families.dyn2d + r.families.dyn3d) / 2;
function row(name, r) {
  console.log(`${name.padEnd(16)} ${KEYS.map(k => fmt(r.metrics[k]).padStart(8)).join('')}   geom ${fmt(geom(r))}  dyn ${fmt(dyn(r))}  overall ${fmt(r.overall)}  ${r.ms.toFixed(0).padStart(5)} ms`);
}

// CHECKS
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };

const cube = cubeWorld();
const worlds = {
  cube, slow: cubeWorld({ timeOf: t => 0.8 * t }), frozen: frozen(cube), shifted: shifted(cube, 0.05),
  grains: grainsWorld(), cloth: clothWorld(),
};
for (const [k, w] of Object.entries(worlds)) { const v = validate(w); if (!v.ok) { console.log(`world ${k} invalid: ${v.errors.join('; ')}`); fails++; } }

console.log(`${'pair'.padEnd(16)} ${KEYS.map(k => k.slice(0, 7).padStart(8)).join('')}`);
const R = {};
for (const k of ['cube', 'grains', 'cloth']) { R['self-' + k] = scoreWorld(worlds[k], worlds[k]); row('self ' + k, R['self-' + k]); }
for (const k of ['slow', 'frozen', 'shifted']) { R[k] = scoreWorld(cube, worlds[k]); row('cube vs ' + k, R[k]); }
R.gFrozen = scoreWorld(worlds.grains, frozen(worlds.grains)); row('grains vs frozen', R.gFrozen);
R.gShift = scoreWorld(worlds.grains, shifted(worlds.grains, 0.05)); row('grains vs shift', R.gShift);
R.cFrozen = scoreWorld(worlds.cloth, frozen(worlds.cloth)); row('cloth vs frozen', R.cFrozen);
console.log('raw cube vs shifted:', JSON.stringify(R.shifted.raw, (_k, v) => typeof v === 'number' ? +v.toFixed(4) : v));
console.log('raw cube vs slow:   ', JSON.stringify(R.slow.raw, (_k, v) => typeof v === 'number' ? +v.toFixed(4) : v));
console.log('raw cube vs frozen: ', JSON.stringify(R.frozen.raw, (_k, v) => typeof v === 'number' ? +v.toFixed(4) : v));
console.log('');

for (const k of ['cube', 'grains', 'cloth']) {
  const r = R['self-' + k], low = KEYS.filter(m => !(r.metrics[m] >= 0.99));
  check(!low.length, `self score ${k}: every metric >= 0.99${low.length ? ' (low: ' + low.join(', ') + ')' : ''}`);
}
for (const fam of ['dyn2d', 'dyn3d']) {
  check(R.frozen.families[fam] < R.slow.families[fam] && R.frozen.families[fam] < R.shifted.families[fam],
    `frozen is worst on ${fam}: ${fmt(R.frozen.families[fam])} < slow ${fmt(R.slow.families[fam])}, shifted ${fmt(R.shifted.families[fam])}`);
}
check(R.gFrozen.families.dyn3d < R.gShift.families.dyn3d, `grains: frozen dyn3d ${fmt(R.gFrozen.families.dyn3d)} < shifted dyn3d ${fmt(R.gShift.families.dyn3d)}`);
check(1 - geom(R.shifted) > 1 - dyn(R.shifted), `shift: geometry loss ${fmt(1 - geom(R.shifted))} > dynamics loss ${fmt(1 - dyn(R.shifted))}`);
check(1 - dyn(R.slow) > 1 - geom(R.slow), `time error: dynamics loss ${fmt(1 - dyn(R.slow))} > geometry loss ${fmt(1 - geom(R.slow))}`);
const worst = Math.max(...Object.values(R).map(r => r.ms));
check(worst < 1500, `slowest call ${worst.toFixed(0)} ms < 1500 ms`);
console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
process.exit(fails ? 1 : 0);
