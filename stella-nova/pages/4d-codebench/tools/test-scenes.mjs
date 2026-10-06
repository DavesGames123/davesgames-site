// ============================================================================
//  TEST-SCENES  ·  checks for the four reference scenes (Node, no DOM)
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/4d-codebench/tools/test-scenes.mjs
//
//  For each scene in scenes.js the test:
//    1. runs make() two times and compares every float (determinism),
//    2. runs world.validate(),
//    3. prints frames, objects, vertex counts, bounds at the first and the
//       last frame, and the time of one make(),
//    4. runs one physical sanity check for the matter family.
//  It also checks the API shape: SCENES fields, sceneById, CAMERA, GROUND,
//  and that each family key is in data.js COMPOSITION.
//  The exit code is 1 if one check fails.
//
//  grep -n targets
//    shared checks .... "function common"
//    family checks .... "const FAMILY_CHECKS"
// ============================================================================

import { SCENES, CAMERA, GROUND, sceneById } from '../scenes.js';
import { validate, bounds, storedFrames } from '../world.js';
import { COMPOSITION } from '../data.js';

let failed = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? 'pass' : 'FAIL'}  ${msg}`); if (!cond) failed++; };
const f3 = (a) => `[${a.map((v) => v.toFixed(3)).join(', ')}]`;
const P = (o, t, i) => { const f = storedFrames(o) === 1 ? 0 : t, k = (f * o.count + i) * 3; return [o.pos[k], o.pos[k + 1], o.pos[k + 2]]; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// --------------------------------------------------------------- API shape
console.log('api');
ok(Array.isArray(SCENES) && SCENES.length === 4, `SCENES has 4 entries (${SCENES.length})`);
ok(SCENES.map((s) => s.id).join() === 'rigid,deformable,codim,flowing', 'ids are rigid, deformable, codim, flowing');
const famKeys = new Set(COMPOSITION.families.map((f) => f.key));
for (const s of SCENES) {
  ok(typeof s.label === 'string' && typeof s.blurb === 'string' && typeof s.make === 'function' && s.seconds > 0, `${s.id}: label, blurb, seconds, make`);
  ok(famKeys.has(s.family), `${s.id}: family '${s.family}' is in data.js COMPOSITION`);
  ok(sceneById(s.id) === s, `sceneById('${s.id}')`);
}
ok(sceneById('nope') === null, 'sceneById of an unknown id is null');
ok(CAMERA.eye.length === 3 && CAMERA.target.length === 3 && CAMERA.fovY > 0, `CAMERA ${f3(CAMERA.eye)} -> ${f3(CAMERA.target)} fovY ${CAMERA.fovY}`);
ok(GROUND.y === 0 && GROUND.size > 0, `GROUND size ${GROUND.size} y ${GROUND.y}`);

// ----------------------------------------------------------- shared checks
function common(s) {
  let t0 = performance.now();
  const a = s.make();
  const ms = performance.now() - t0;
  const b = s.make();
  const v = validate(a);
  ok(v.ok, `validate: ${v.ok ? 'ok' : v.errors.slice(0, 3).join('; ')}`);
  let same = a.frames === b.frames && a.objects.length === b.objects.length;
  for (let n = 0; same && n < a.objects.length; n++) {
    const p = a.objects[n].pos, q = b.objects[n].pos;
    if (p.length !== q.length) same = false;
    else for (let k = 0; k < p.length; k++) if (p[k] !== q[k] && !(Number.isNaN(p[k]) && Number.isNaN(q[k]))) { same = false; break; }
  }
  ok(same, 'two make() calls give identical positions');
  ok(a.fps === 30, `fps ${a.fps}`);
  ok(a.frames >= 90 && a.frames <= 120 && a.frames === s.seconds * 30, `frames ${a.frames} (${s.seconds} s)`);
  ok(ms < 1500, `make() time ${ms.toFixed(0)} ms (limit 1500)`);
  ok(a.camera.eye.join() === CAMERA.eye.join() && a.camera.target.join() === CAMERA.target.join(), 'world camera is CAMERA');
  console.log(`  objects ${a.objects.length}:`);
  for (const o of a.objects) {
    const extra = o.kind === 'mesh' ? `${o.faces.length / 3} tris` : `radius ${o.radius.toFixed(4)}`;
    console.log(`    ${o.name.padEnd(10)} ${o.kind.padEnd(6)} ${o.dynamic ? 'dynamic' : 'static '} count ${String(o.count).padStart(5)}  ${extra}  stored frames ${storedFrames(o)}`);
  }
  for (const t of [0, a.frames - 1]) { const bb = bounds(a, t); console.log(`  bounds t=${String(t).padStart(3)}: min ${f3(bb.min)} max ${f3(bb.max)}`); }
  // Topology: static objects store one frame, dynamic objects every frame.
  ok(a.objects.every((o) => storedFrames(o) === (o.dynamic ? a.frames : 1)), 'dynamic objects store every frame, static objects one');
  ok(a.objects.some((o) => !o.dynamic), 'scene has a static object');
  // Floor: nothing is lower than 1 cm below y = 0 in any frame.
  let minY = Infinity;
  for (const o of a.objects) for (let k = 1; k < o.pos.length; k += 3) if (o.pos[k] < minY) minY = o.pos[k];
  ok(minY > -0.01, `lowest point over all frames y = ${minY.toFixed(4)} m (limit -0.01)`);
  // Motion: dynamic matter moves.
  const dyn = a.objects.filter((o) => o.dynamic);
  let travel = 0;
  for (const o of dyn) for (let i = 0; i < o.count; i++) travel = Math.max(travel, dist(P(o, 0, i), P(o, a.frames - 1, i)));
  ok(travel > 0.05, `largest displacement first to last frame ${travel.toFixed(3)} m`);
  // Frame to frame speed: no explosion (30 fps, limit 6 m/s).
  let vmax = 0;
  for (const o of dyn) for (let t = 1; t < a.frames; t++) for (let i = 0; i < o.count; i++) vmax = Math.max(vmax, dist(P(o, t, i), P(o, t - 1, i)) * 30);
  ok(vmax < 6, `top speed ${vmax.toFixed(2)} m/s (limit 6)`);
  return a;
}

// ----------------------------------------------------------- family checks
const FAMILY_CHECKS = {
  // Rigid bodies keep their shape: distances from vertex 0 to every vertex
  // stay the same in every frame.
  rigid(w) {
    let worst = 0, fallen = 0;
    for (const o of w.objects.filter((o) => o.dynamic)) {
      for (let t = 0; t < w.frames; t++) {
        const a0 = P(o, 0, 0), at = P(o, t, 0);
        for (let i = 1; i < o.count; i++) worst = Math.max(worst, Math.abs(dist(at, P(o, t, i)) - dist(a0, P(o, 0, i))));
      }
      if (o.name.startsWith('domino')) {
        let top = -Infinity; for (let i = 0; i < o.count; i++) top = Math.max(top, P(o, w.frames - 1, i)[1]);
        if (top < 0.08) fallen++;
      }
    }
    ok(worst < 1e-4, `rigid shape: worst change of a vertex distance ${(worst * 1000).toFixed(4)} mm (limit 0.1 mm)`);
    ok(fallen >= 5, `dominoes knocked over at the last frame: ${fallen} of 7`);
  },
  // Soft solid: the enclosed volume of the surface stays near the rest
  // volume, and the shape does change (it is not rigid).
  deformable(w) {
    const o = w.objects.find((o) => o.dynamic);
    const vol = (t) => { let V = 0; for (let f = 0; f < o.faces.length; f += 3) { const a = P(o, t, o.faces[f]), b = P(o, t, o.faces[f + 1]), c = P(o, t, o.faces[f + 2]); V += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; } return V; };
    const V0 = vol(0); let lo = Infinity, hi = -Infinity, shape = 0;
    for (let t = 0; t < w.frames; t++) {
      const r = vol(t) / V0; lo = Math.min(lo, r); hi = Math.max(hi, r);
      const a0 = P(o, 0, 0), at = P(o, t, 0);
      for (let i = 1; i < o.count; i++) shape = Math.max(shape, Math.abs(dist(at, P(o, t, i)) - dist(a0, P(o, 0, i))));
    }
    ok(V0 > 0, `rest volume ${(V0 * 1e6).toFixed(0)} cm^3 (faces point out)`);
    ok(lo > 0.9 && hi < 1.1, `volume ratio over all frames ${lo.toFixed(3)} .. ${hi.toFixed(3)} (limit 0.9 .. 1.1)`);
    ok(shape > 0.005, `it deforms: largest change of a vertex distance ${(shape * 1000).toFixed(1)} mm`);
  },
  // Cloth: grid edges keep their length within a few percent. The limit is
  // on the 99th percentile in each frame and on the mean; the single worst
  // edge (a short spike where the cloth hits the ball) is printed and has a
  // looser limit.
  codim(w) {
    const o = w.objects.find((o) => o.dynamic), n = Math.round(Math.sqrt(o.count));
    ok(n * n === o.count, `cloth is a ${n} x ${n} grid`);
    let worst = 0, worstT = 0, p99 = 0, p99T = 0, mean = 0, cnt = 0;
    const strain = new Float64Array(2 * n * (n - 1));
    for (let t = 0; t < w.frames; t++) {
      let m = 0;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) for (const [di, dj] of [[1, 0], [0, 1]]) {
        if (i + di >= n || j + dj >= n) continue;
        const a = j * n + i, b = (j + dj) * n + i + di;
        const r = Math.abs(dist(P(o, t, a), P(o, t, b)) / dist(P(o, 0, a), P(o, 0, b)) - 1);
        strain[m++] = r; mean += r; cnt++;
        if (r > worst) { worst = r; worstT = t; }
      }
      strain.sort();
      const q = strain[Math.floor(0.99 * (m - 1))];
      if (q > p99) { p99 = q; p99T = t; }
    }
    ok(p99 < 0.05, `edge length: worst frame 99th percentile ${(p99 * 100).toFixed(2)} % at t=${p99T} (limit 5 %)`);
    ok(mean / cnt < 0.01, `edge length: mean ${(mean / cnt * 100).toFixed(3)} % (limit 1 %)`);
    ok(worst < 0.2, `edge length: single worst edge ${(worst * 100).toFixed(1)} % at t=${worstT} (limit 20 %)`);
    const ball = w.objects.find((o) => !o.dynamic), bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let i = 0; i < ball.count; i++) { const p = P(ball, 0, i); for (let a = 0; a < 3; a++) { bb.min[a] = Math.min(bb.min[a], p[a]); bb.max[a] = Math.max(bb.max[a], p[a]); } }
    const c = [0, 1, 2].map((a) => (bb.min[a] + bb.max[a]) / 2), R = (bb.max[0] - bb.min[0]) / 2;
    let deep = 0;
    for (let t = 0; t < w.frames; t++) for (let i = 0; i < o.count; i++) deep = Math.max(deep, R - dist(P(o, t, i), c));
    ok(deep < 0.01, `deepest cloth vertex inside the ball ${(deep * 1000).toFixed(2)} mm (limit 10 mm)`);
  },
  // Fluid: particles stay inside the tank. The tank inner walls are the
  // inner faces of its end walls and its back wall; the front lip is at
  // z = +0.17. The values are those of makeFlowing in scenes.js.
  flowing(w) {
    const o = w.objects.find((o) => o.dynamic), T = { x0: -0.44, x1: 0.44, z0: -0.17, z1: 0.17 };
    ok(o.kind === 'points' && o.count >= 1500 && o.count <= 4000, `${o.count} particles (1500 .. 4000)`);
    let out = 0, top0 = 0, top1 = 0, spread0 = -Infinity, spread1 = -Infinity;
    for (let t = 0; t < w.frames; t++) for (let i = 0; i < o.count; i++) {
      const p = P(o, t, i);
      if (p[0] < T.x0 - 1e-6 || p[0] > T.x1 + 1e-6 || p[2] < T.z0 - 1e-6 || p[2] > T.z1 + 1e-6) out++;
      if (t === 0) { top0 = Math.max(top0, p[1]); spread0 = Math.max(spread0, p[0]); }
      if (t === w.frames - 1) { top1 = Math.max(top1, p[1]); spread1 = Math.max(spread1, p[0]); }
    }
    ok(out === 0, `particle-frames outside the tank walls: ${out}`);
    ok(spread1 > spread0 + 0.3 && top1 < top0, `the column collapses: top ${top0.toFixed(3)} -> ${top1.toFixed(3)} m, front x ${spread0.toFixed(3)} -> ${spread1.toFixed(3)} m`);
    // Incompressibility: the settled depth matches the column volume spread
    // over the tank floor, within 15 %. For a flat layer of depth D the mean
    // particle height is D / 2, so D = 2 * mean y + radius (the floor gap).
    const area = (T.x1 - T.x0) * (T.z1 - T.z0), d = o.radius * 2, expect = o.count * d * d * d / area;
    let sumY = 0;
    for (let i = 0; i < o.count; i++) sumY += P(o, w.frames - 1, i)[1];
    const depth = 2 * sumY / o.count + o.radius;
    ok(Math.abs(depth / expect - 1) < 0.15, `settled depth ${depth.toFixed(3)} m vs volume / area ${expect.toFixed(3)} m (ratio ${(depth / expect).toFixed(3)}, limit 0.85 .. 1.15)`);
  },
};

let total = 0;
for (const s of SCENES) {
  console.log(`\n${s.id}  (${s.label}, family ${s.family})`);
  const t0 = performance.now();
  const w = common(s);
  FAMILY_CHECKS[s.id](w);
  total += performance.now() - t0;
}
console.log(`\n${failed ? `${failed} check(s) FAILED` : 'all checks passed'}  (${(total / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
