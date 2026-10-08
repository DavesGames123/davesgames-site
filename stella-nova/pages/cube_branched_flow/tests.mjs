// ============================================================================
//  CUBE SDF + BRANCHED FLOW  ·  tests.mjs — node tests.mjs
// ----------------------------------------------------------------------------
//  Runs flow.js in node (no DOM, no GPU) and checks:
//    1. The page default trace is the trace of the code before flow.js
//       (golden checksum), and the 8-ring page layout is tO 12, tM 10.
//    2. Each body in BODIES has its surface at rMin and rMax (bodyDist 0),
//       and sdf.frag.glsl body() has the same shape cases.
//    3. bMaxFor keeps each ring off the fold planes (tM < tO).
//    4. Every seeded saver scene is ring-intersecting: ringCheck passes over
//       the shot window (2x the saver guard samples, no margin) and
//       flowCheck passes at the start and the end of the window (the guard
//       checks only the start).
//    5. The old saver ranges (frozen copy below) fail those checks for some
//       seeds. This is the bug the new ranges fix.
//    6. The saver camera framing.
//    7. The phone profile: renderScale keeps a touch canvas under
//       PHONE_MAX_PX, PHONE_SN cuts the trace, and panOffset puts the body
//       centre at the asked screen offset.
// ============================================================================
import fs from 'fs';
import * as F from './flow.js';

const here = new URL('.', import.meta.url).pathname;
let fail = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + msg); if (!ok) fail++; };
const info = msg => console.log('INFO  ' + msg);

// The page defaults: the P_ table of main.js (it names F for the selects).
const src = fs.readFileSync(here + 'main.js', 'utf8');
const P_ = new Function('F', 'return (' + src.slice(src.indexOf('const P_={') + 9, src.indexOf('};\n// Boolean') + 1) + ')')(F);
const D = {}; for (const [k, p] of Object.entries(P_)) D[k] = p.v;
const FLAGS = { fObj: true, sWave: true };

// 1. Default trace. The checksum is the sum of every filament coordinate at
// t = 0, 3.7, 42 and 190 from the main.js trace code before flow.js (git
// HEAD 8fbaee7); the max coordinate difference was 0.
let sum = 0, nf = 0;
for (const t of [0, 3.7, 42, 190]) {
  const { R, Rt } = F.computeGRot(t, D);
  const fils = F.traceAll(F.genSeeds(D, R, Rt, t), D, R, Rt, t, FLAGS);
  nf += fils.length; for (const f of fils) for (const v of f) sum += v;
}
check(Math.abs(sum - -1529.486247) < 1e-4 && nf === 4 * 624, `default trace checksum ${sum.toFixed(6)} (old -1529.486247), ${nf / 4} filaments`);
const L8 = F.ringLayout(8, F.PAGE_RR, F.PAGE_B);
check(Math.abs(L8.tO - 12) < 1e-9 && Math.abs(L8.tM - 10) < 1e-9 && D.sRings === 8 && D.bShape === 0,
  `page default: cube, 8 rings, layout tO ${L8.tO.toFixed(3)} tM ${L8.tM.toFixed(3)}`);

// 2. Body table against bodyDist and the shader.
const glsl = fs.readFileSync(here + 'shaders/sdf.frag.glsl', 'utf8');
const dirs = { x: [1, 0, 0], diag: [1, 1, 1].map(v => v / Math.sqrt(3)), xy: [Math.SQRT1_2, Math.SQRT1_2, 0] };
const far = { cube: 'diag', sphere: 'diag', octa: 'x', cylinder: 'xy', pillow: 'diag' };
const near = { cube: 'x', sphere: 'x', octa: 'diag', cylinder: 'x', pillow: 'x' };
F.BODIES.forEach((b, i) => {
  const C = { sR: 20, bShape: i }, r = F.bodyRadii(C);
  const dn = F.bodyDist(dirs[near[b.k]].map(v => v * r.min), C), df = F.bodyDist(dirs[far[b.k]].map(v => v * r.max), C);
  check(Math.abs(dn) < 1e-6 && Math.abs(df) < 1e-6 && (i === 0 || glsl.includes('u_shape==' + i)),
    `body ${i} ${b.l}: surface at rMin ${r.min.toFixed(2)} and rMax ${r.max.toFixed(2)} (bodyDist ${dn.toExponential(1)}, ${df.toExponential(1)})`);
});

// 3. The fold bound.
for (const n of [2, 4, 8]) {
  const L = F.ringLayout(n, 24, F.bMaxFor(n));
  check(L.tM < L.tO, `${n} rings at bMax ${F.bMaxFor(n).toFixed(3)}: tM ${L.tM.toFixed(2)} < tO ${L.tO.toFixed(2)}`);
}

// 4. Seeded saver scenes.
const SEEDS = 120;
let minDepth = 1e9, ringBad = 0, flowBad = 0, guardBad = 0, scenes = 0, tries = 0, maxTries = 0, minNear = 1, maxTurn = 0;
const mix = {};
for (let s = 1; s <= SEEDS; s++) {
  const rnd = F.makeRnd(Math.imul(s, 2654435761));
  for (let i = 0; i < F.SAVER_SHOTS.length; i++) {
    const calm = rnd(), sc = F.saverScene(rnd, i, calm, D), C = sc.C, span = sc.dur * C.timeScale;
    scenes++; tries += sc.tries; maxTries = Math.max(maxTries, sc.tries);
    if (!sc.ok) guardBad++;
    const rc = F.ringCheck(C, sc.simTime, sc.simTime + span, F.ringSamples(C, span, .5).nT);
    if (!rc.ok) ringBad++;
    minDepth = Math.min(minDepth, rc.worst / rc.tau);
    for (const t of [sc.simTime, sc.simTime + span]) {
      const fc = F.flowCheck(C, t, FLAGS);
      if (!fc.ok) flowBad++;
      minNear = Math.min(minNear, fc.near); maxTurn = Math.max(maxTurn, fc.turn);
    }
    const key = F.BODIES[C.bShape].k + ' x' + C.sRings; mix[key] = (mix[key] || 0) + 1;
  }
}
check(guardBad === 0, `saver guard: ${scenes} scenes, all found a crossing layout (mean tries ${(tries / scenes).toFixed(2)}, max ${maxTries} of ${F.SAVER_TRIES})`);
check(ringBad === 0, `ringCheck at 2x guard samples per shot window: ${ringBad} of ${scenes} scenes fail (worst depth ${minDepth.toFixed(2)} tau, need 1)`);
check(flowBad === 0, `flowCheck at window start and end: ${flowBad} of ${2 * scenes} fail (min near ${minNear.toFixed(2)} >= ${F.FLOW_NEAR_MIN}, max turn ${maxTurn.toFixed(1)} <= ${F.FLOW_TURN_MAX})`);
check(Object.keys(mix).length === F.SAVER_RINGS.length * F.BODIES.length, `body x ring-count mix: ${Object.keys(mix).length} of ${F.SAVER_RINGS.length * F.BODIES.length} pairs seen`);

// 5. The old saver ranges (main.js before this change), frozen here. The old
// shots set the ring layout directly; old Fur used 16 seed rings (8 of them
// off the body), which flow.js clamps to the 8 fold rings.
const OLD_SHOTS = [
  ['Lantern', {}],
  ['Silhouette', { mMetal: 0, mBase: 0, gP: [.3, .5], fCu: 1.5, sCf: 1, rCb: 1.2 }],
  ['Fused', { pK: 20, tm: [2, 3], tO: [7, 9], cD: 4 }],
  ['Constellation', { pK: .1, tO: [17, 20], sR: [7, 10], tM: [6, 8], tm: [.3, .5] }],
  ['Burst', { sCf: 0, sPr: 0, fCu: [.2, .5], sNd: 40, sSl: 5, sN: 40, gP: .6 }],
  ['Fur', { fCu: [2.5, 4], sCf: 0, sPr: 0, fFr: [.5, .8], fFrZ: [.5, .8], sN: 110, sRings: 16, sNd: 14, rCw: 4, rHw: 10, gP: .5, mMetal: .6 }],
  ['Hollow', { tO: 0, pK: 5, tM: [19, 22], tm: [1.5, 2.5], cD: 4 }],
  ['Macro', { mBrush: .6 }],
];
const OLD_JITTER = [['fFr', .2, .9], ['fFrZ', .2, .9], ['fO2', 0, 1.2], ['fO3', 0, 1], ['rS', .2, .8], ['moRA', 0, 1], ['moRB', 0, 1], ['moRC', 0, 1]];
const OLD_SEEDS = 30, oldBad = {};
let oldRing = 0, oldFlow = 0, oldN = 0;
for (let s = 1; s <= OLD_SEEDS; s++) {
  const rnd = F.makeRnd(Math.imul(s, 2654435761)), calm = .7;
  OLD_SHOTS.forEach(([name, vals]) => {
    const C = { ...D };
    for (const [k, a, b] of OLD_JITTER) C[k] = a + (b - a) * rnd();
    for (const [k, v] of Object.entries(vals)) C[k] = Array.isArray(v) ? v[0] + (v[1] - v[0]) * rnd() : v;
    C.timeScale = 1 - .5 * calm;
    const t0 = 300 * rnd(), dur = 6 + 5 * rnd() + 1.5 * calm;
    const rOk = F.ringCheck(C, t0, t0 + dur * C.timeScale, F.ringSamples(C, dur * C.timeScale).nT).ok, fOk = F.flowCheck(C, t0, FLAGS).ok;
    oldN++; if (!rOk) oldRing++; if (!fOk) oldFlow++;
    if (!rOk || !fOk) oldBad[name] = (oldBad[name] || 0) + 1;
  });
}
info(`old ranges, failing scenes per shot of ${OLD_SEEDS}: ${JSON.stringify(oldBad)}`);
check(oldRing > 0 && oldFlow > 0, `old ranges fail: ringCheck ${oldRing} of ${oldN}, flowCheck ${oldFlow} of ${oldN}`);

// 6. Saver camera framing (main.js saverTick). Every shot is fitted: the
// radius r (sc.r, or sceneRadius for Macro, where rk is 0) has a positive
// size, and the camera at its nearest (distance 200 x 0.92) stays at least
// 3 r from the centre, so it is never in or next to the body. The fit is
// at most 0.62 of the band. Macro once put the camera 40 to 55 units out.
{
  let worst = 1e9, zero = 0, n = 0;
  for (let s = 1; s <= 60; s++) {
    const rnd = F.makeRnd(Math.imul(s, 2246822519));
    for (let i = 0; i < F.SAVER_SHOTS.length; i++) {
      const sc = F.saverScene(rnd, i, rnd(), D), r = sc.r || F.sceneRadius(sc.C);
      if (!(r > 0)) zero++;
      worst = Math.min(worst, 200 * 0.92 / r); n++;
    }
  }
  check(zero === 0 && worst >= 3, `saver camera: ${n} shots, every radius > 0, nearest camera at ${worst.toFixed(2)} scene radii (need 3)`);
}

// 7. The phone profile.
{
  const rows = []; let okPx = true;
  for (const [w, h, d] of [[360, 640, 3], [390, 844, 3], [844, 390, 3], [1024, 1366, 2]]) {
    const s = F.renderScale(w, h, d, true), px = Math.floor(w * s) * Math.floor(h * s);
    if (px > F.PHONE_MAX_PX) okPx = false;
    rows.push(`${w}x${h}@${d} ${Math.floor(w * s)}x${Math.floor(h * s)}`);
  }
  check(okPx, `phone canvas <= ${F.PHONE_MAX_PX / 1e6} Mpx: ${rows.join(', ')}`);
  check(F.renderScale(1440, 900, 2, false) === 2 * .85 && F.renderScale(1440, 900, 1, false) === .85, 'desktop render scale is unchanged (min(dpr, 2) x 0.85)');
  // the trace cost at PHONE_SN against the page density
  const C = { ...D }, cost = sN => { C.sN = sN; let t = 0, n = 0;
    for (let f = 0; f < 20; f++) { const tm = f / 20, { R, Rt } = F.computeGRot(tm, C), t0 = performance.now(); n = F.traceAll(F.genSeeds(C, R, Rt, tm), C, R, Rt, tm, FLAGS).length; t += performance.now() - t0; }
    return { ms: t / 20, n }; };
  const a = cost(D.sN), b = cost(F.PHONE_SN);
  check(b.n < a.n * 0.6, `phone trace: ${b.n} filaments at sN ${F.PHONE_SN}, ${a.n} at sN ${D.sN}`);
  info(`trace time in node: ${a.ms.toFixed(1)} ms at sN ${D.sN}, ${b.ms.toFixed(1)} ms at sN ${F.PHONE_SN}`);
  // panOffset: project the origin through the sdf.frag.glsl camera
  let worst = 0;
  for (const [ox, oy, t, p] of [[0, -150, .5, .25], [-160, 0, 2.1, -.4], [40, 90, -1.2, 1.1]]) {
    const d = 135, f = Math.tan(Math.PI / 3), H = 800, ta = F.panOffset(ox, oy, t, p, d, f, H);
    const o = [Math.sin(t) * Math.cos(p), Math.sin(p), Math.cos(t) * Math.cos(p)], ro = ta.map((v, i) => v + d * o[i]);
    const ww = F.nrm(ta.map((v, i) => v - ro[i])), uu = F.nrm([ww[2], 0, -ww[0]]);
    const vv = [ww[1] * uu[2] - ww[2] * uu[1], ww[2] * uu[0] - ww[0] * uu[2], ww[0] * uu[1] - ww[1] * uu[0]];
    const rel = ro.map(v => -v), z = rel[0] * ww[0] + rel[1] * ww[1] + rel[2] * ww[2];
    const sx = f * (rel[0] * uu[0] + rel[1] * uu[1] + rel[2] * uu[2]) / z * H, sy = -f * (rel[0] * vv[0] + rel[1] * vv[1] + rel[2] * vv[2]) / z * H;
    worst = Math.max(worst, Math.abs(sx - ox), Math.abs(sy - oy));
  }
  check(worst < 1.5, `panOffset puts the body centre at the clear-area centre (max err ${worst.toFixed(2)} px)`);
}

console.log(fail ? `${fail} FAILED` : 'all passed');
process.exitCode = fail ? 1 : 0;
