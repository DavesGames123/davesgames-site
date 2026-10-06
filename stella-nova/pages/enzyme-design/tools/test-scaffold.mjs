// ============================================================================
//  TEST-SCAFFOLD  ·  checks the reverse diffusion scaffolder (Node, no DOM)
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/enzyme-design/tools/test-scaffold.mjs
//
//  The test builds its own small motif, so that it does not need motif.js.
//  The motif is three residues around a flat four-atom ligand. It is a test
//  fixture and no chemistry is claimed for it.
//
//  The checks:
//    1  determinism      two runs at one seed give the same floats
//    2  format           design.js validate() passes
//    3  motif            C-alpha RMSD of the fixed residues, must be small
//    4  clashes          closest non-neighbour C-alpha pair
//    5  compaction       radius of gyration against 2.2 * n^0.38
//    6  structure        share of residues in helix and in strand, the
//                       handedness of the helices, and how close the
//                       paired strands sit
//    7  pocket           protein neighbours of the ligand inside 8 A
//    8  partial          fewer steps back must stay closer to the parent
//    9  unindexed        several placements are tried and the best is kept
//   10  speed            140 residues, 240 steps, well under 2 s
//   11  onStep           the callback that drives the page animation
//   13  bad input        a motif residue with no coordinate is named and
//                       refused, and is not turned into a chain of NaN
//  The exit code is 1 if one check fails.
//
//  grep -n targets
//    the test motif ... "function testMotif"
//    measurements ..... "function report"
//    partial check .... "section('8"
// ============================================================================

import { validate } from '../design.js';
import { scaffold, DEFAULTS, traceStats, motifTargets } from '../scaffold.js';

let failed = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? 'pass' : 'FAIL'}  ${msg}`); if (!cond) failed++; };
const section = (s) => console.log(`\n${s}`);
const f = (v, k = 2) => (Number.isFinite(v) ? v.toFixed(k) : String(v));
// Small numbers print in full, so that an exact zero is not confused with
// a rounded one.
const fs = (v) => (Number.isFinite(v) && v !== 0 && Math.abs(v) < 1e-3 ? v.toExponential(2) : f(v, 4));

// ---------------------------------------------------------------------------
//  the test motif: three residues and a flat ligand
// ---------------------------------------------------------------------------

function testMotif() {
  // The ligand is a flat ring-like plate on the xy plane at the origin.
  const ligand = {
    name: 'TST',
    atoms: [
      { name: 'C1', el: 'C', x: 1.30, y: 0.00, z: 0.00 },
      { name: 'C2', el: 'C', x: -0.40, y: 1.24, z: 0.00 },
      { name: 'N3', el: 'N', x: -1.10, y: -1.00, z: 0.00 },
      { name: 'O4', el: 'O', x: 0.20, y: -0.24, z: 1.35 },
    ],
    bonds: [[0, 1], [1, 2], [2, 0], [0, 3]],
  };
  // Each residue sits about 6.6 A from the ligand centre, with its side
  // chain aimed at the ligand.
  const place = (code, name, chain, resId, ca, tipName, tipEl) => {
    const r = Math.hypot(ca[0], ca[1], ca[2]);
    const u = [-ca[0] / r, -ca[1] / r, -ca[2] / r];
    const cb = [ca[0] + u[0] * 1.53, ca[1] + u[1] * 1.53, ca[2] + u[2] * 1.53];
    const tip = [ca[0] + u[0] * 3.90, ca[1] + u[1] * 3.90, ca[2] + u[2] * 3.90];
    return {
      code, name, chain, resId,
      atoms: [
        { name: 'CA', el: 'C', x: ca[0], y: ca[1], z: ca[2] },
        { name: 'CB', el: 'C', x: cb[0], y: cb[1], z: cb[2] },
        { name: tipName, el: tipEl, x: tip[0], y: tip[1], z: tip[2] },
      ],
      tip: [tipName],
    };
  };
  return {
    id: 'test',
    label: 'Test fixture',
    residues: [
      place('E', 'Glu', 'A', 1, [6.50, 0.00, 2.00], 'OE2', 'O'),
      place('S', 'Ser', 'A', 2, [-3.20, 5.60, -2.50], 'OG', 'O'),
      place('H', 'His', 'A', 3, [-3.20, -5.60, 2.50], 'NE2', 'N'),
    ],
    ligand,
    geometry: [],
  };
}

const MOTIF = testMotif();
const MOTIF_STR = '20-60,A1,6-18,A2,6-18,A3,20-60/B1';
const UNINDEXED_STR = 'A1,A2,A3|20-60,{},6-18,{},6-18,{},20-60/B1';

// ---------------------------------------------------------------------------
//  measurements
// ---------------------------------------------------------------------------

const d3 = (a, i, b, j) => Math.hypot(a[i * 3] - b[j * 3], a[i * 3 + 1] - b[j * 3 + 1], a[i * 3 + 2] - b[j * 3 + 2]);

function motifRmsd(design, motif) {
  const t = motifTargets(motif);
  const byIndex = new Map();
  for (const v of t.values()) byIndex.set(v.index, v);
  let s = 0, m = 0;
  for (let i = 0; i < design.n; i++) {
    if (!design.fixed[i]) continue;
    const a = byIndex.get(design.motifId[i]);
    const dx = design.ca[i * 3] - a.ca[0], dy = design.ca[i * 3 + 1] - a.ca[1], dz = design.ca[i * 3 + 2] - a.ca[2];
    s += dx * dx + dy * dy + dz * dz; m++;
  }
  return { rmsd: m ? Math.sqrt(s / m) : NaN, count: m };
}

// Protein neighbours of the ligand. The ligand is buried when many
// C-alpha points surround it.
function burial(design, cut = 8) {
  const at = design.ligand.atoms;
  let cx = 0, cy = 0, cz = 0;
  for (const a of at) { cx += a.x; cy += a.y; cz += a.z; }
  cx /= at.length; cy /= at.length; cz /= at.length;
  const perAtom = at.map((a) => {
    let c = 0;
    for (let i = 0; i < design.n; i++) {
      if (Math.hypot(design.ca[i * 3] - a.x, design.ca[i * 3 + 1] - a.y, design.ca[i * 3 + 2] - a.z) <= cut) c++;
    }
    return c;
  });
  let centre = 0;
  for (let i = 0; i < design.n; i++) {
    if (Math.hypot(design.ca[i * 3] - cx, design.ca[i * 3 + 1] - cy, design.ca[i * 3 + 2] - cz) <= cut) centre++;
  }
  // Depth: how far the ligand centre sits from the chain surface, read as
  // the distance from the ligand centre to the chain centre.
  const st = traceStats(design.ca, design.n);
  const offCentre = Math.hypot(st.centre[0] - cx, st.centre[1] - cy, st.centre[2] - cz);
  return { centre, minPerAtom: Math.min(...perAtom), meanPerAtom: perAtom.reduce((a, b) => a + b, 0) / perAtom.length, offCentre, rg: st.rg };
}

function ligandClash(design) {
  let worst = Infinity;
  for (const a of design.ligand.atoms) {
    for (let i = 0; i < design.n; i++) {
      const r = Math.hypot(design.ca[i * 3] - a.x, design.ca[i * 3 + 1] - a.y, design.ca[i * 3 + 2] - a.z);
      if (r < worst) worst = r;
    }
  }
  return worst;
}

// The signed volume of a C-alpha(i..i+3) window. An ideal right-handed
// alpha-helix gives about +43 A^3. Real proteins hold no left-handed
// alpha-helix, so this number separates a helix from its mirror.
function handedness(design) {
  const ca = design.ca;
  const P = (i) => [ca[i * 3], ca[i * 3 + 1], ca[i * 3 + 2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let right = 0, left = 0, sum = 0;
  for (let i = 0; i + 3 < design.n; i++) {
    if (design.ss.slice(i, i + 4) !== 'HHHH') continue;
    const v = dt(cr(sub(P(i + 1), P(i)), sub(P(i + 2), P(i + 1))), sub(P(i + 3), P(i + 2)));
    if (v > 0) { right++; sum += v; } else left++;
  }
  return { right, left, n: right + left, meanRight: right ? sum / right : NaN };
}

// How close the strand pairs of the latent state ended up. A real
// antiparallel sheet holds its paired C-alpha points near 4.95 A.
function pairSpacing(design) {
  const ca = design.ca, out = [];
  for (const [a0, a1, b0, b1] of design.meta.ssPairs) {
    const L = Math.min(a1 - a0, b1 - b0) + 1;
    for (let k = 0; k < L; k++) out.push(d3(ca, a0 + k, ca, b1 - k));
  }
  if (!out.length) return { n: 0, mean: NaN, inRange: 0 };
  return {
    n: out.length,
    mean: out.reduce((a, b) => a + b, 0) / out.length,
    inRange: out.filter((v) => v > 4.2 && v < 6.2).length / out.length,
  };
}

function ssFrac(ss) {
  const n = ss.length;
  const c = (ch) => (ss.match(new RegExp(ch, 'g')) || []).length / n;
  return { H: c('H'), E: c('E'), L: c('L') };
}

// Similarity of two traces that share one frame, so no superposition is
// needed: the motif is pinned in both.
function similarity(a, b, n) {
  const d0 = Math.max(0.5, 1.24 * Math.cbrt(Math.max(16, n) - 15) - 1.8);
  let s2 = 0, tm = 0;
  for (let i = 0; i < n; i++) {
    const d = d3(a, i, b, i);
    s2 += d * d;
    tm += 1 / (1 + (d / d0) ** 2);
  }
  return { rmsd: Math.sqrt(s2 / n), tm: tm / n };
}

function report(label, run) {
  const d = run.design;
  const st = traceStats(d.ca, d.n);
  const sf = ssFrac(d.ss);
  const mr = motifRmsd(d, MOTIF);
  const bu = burial(d);
  console.log(`  ${label}: n=${d.n} steps=${run.steps} ms=${f(run.ms, 1)} accepted=${run.accepted} frames=${run.trajectory.length}`);
  console.log(`    bonds ${f(st.bondMin)} to ${f(st.bondMax)} A, worst non-neighbour pair ${f(st.worstClash)} A, ligand floor ${f(ligandClash(d))} A`);
  console.log(`    Rg ${f(st.rg)} A vs target ${f(d.meta.rgTarget)} A, motif RMSD ${fs(mr.rmsd)} A over ${mr.count} residues`);
  console.log(`    structure H ${(100 * sf.H).toFixed(0)}% E ${(100 * sf.E).toFixed(0)}% L ${(100 * sf.L).toFixed(0)}%`);
  console.log(`    ligand neighbours inside 8 A: ${bu.centre} at the centre, ${bu.minPerAtom} worst atom, ${f(bu.meanPerAtom, 1)} mean; ligand sits ${f(bu.offCentre)} A off the chain centre`);
  return { st, sf, mr, bu, d };
}

// ---------------------------------------------------------------------------

console.log('TEST-SCAFFOLD  ·  reverse diffusion over a C-alpha trace');
console.log(`  defaults: steps=${DEFAULTS.steps} relaxIters=${DEFAULTS.relaxIters} sigma ${DEFAULTS.sigmaMax} to ${DEFAULTS.sigmaMin} A`);

section('1  determinism');
const a1 = scaffold({ motif: MOTIF, motifStr: MOTIF_STR, seqLength: '140', seed: 7, steps: 120 });
const a2 = scaffold({ motif: MOTIF, motifStr: MOTIF_STR, seqLength: '140', seed: 7, steps: 120 });
const a3 = scaffold({ motif: MOTIF, motifStr: MOTIF_STR, seqLength: '140', seed: 8, steps: 120 });
let same = a1.design.n === a2.design.n;
if (same) for (let i = 0; i < a1.design.ca.length; i++) if (a1.design.ca[i] !== a2.design.ca[i]) { same = false; break; }
ok(same, `seed 7 twice gives the same ${a1.design.n * 3} floats`);
ok(a1.design.ss === a2.design.ss, 'the same seed gives the same structure string');
let diff = a1.design.n !== a3.design.n;
if (!diff) for (let i = 0; i < a1.design.ca.length; i++) if (Math.abs(a1.design.ca[i] - a3.design.ca[i]) > 1e-6) { diff = true; break; }
ok(diff, 'seed 8 gives a different design');

section('2  the main run: 140 residues, 240 steps');
const t0 = performance.now();
const main = scaffold({ motif: MOTIF, motifStr: MOTIF_STR, seqLength: '140', seed: 3, steps: 240 });
const wall = performance.now() - t0;
const M = report('main', main);
for (const line of main.log) console.log(`    log | ${line}`);

const v = validate(main.design);
ok(v.ok, `validate() passes${v.ok ? '' : ': ' + v.errors.join('; ')}`);
ok(main.design.n === 140, `the chain has 140 residues, got ${main.design.n}`);
ok(M.st.bondMin > 3.6 && M.st.bondMax < 4.0, `every C-alpha bond is near 3.80 A (${f(M.st.bondMin)} to ${f(M.st.bondMax)})`);

section('3  the motif is held');
ok(M.mr.rmsd < 0.25, `motif C-alpha RMSD ${fs(M.mr.rmsd)} A is under 0.25 A`);
console.log('    the motif pull runs last in every sweep, so the fixed residues land on their');
console.log('    coordinates to float precision. The motif RMSD that scores a design is the');
console.log('    one metrics.js measures after a refold with the motif restraint switched off.');
ok(M.mr.count === 3, `3 residues are fixed, got ${M.mr.count}`);

section('4  no clashes');
ok(M.st.worstClash > 3.6, `the closest non-neighbour C-alpha pair is ${f(M.st.worstClash)} A, over 3.6 A`);
ok(ligandClash(main.design) > 4.0, `the closest C-alpha to a ligand atom is ${f(ligandClash(main.design))} A, over 4.0 A`);

section('5  compaction');
const rgT = 2.2 * Math.pow(main.design.n, 0.38);
ok(Math.abs(M.st.rg - rgT) / rgT < 0.18, `Rg ${f(M.st.rg)} A is within 18% of the target ${f(rgT)} A`);

section('6  real secondary structure');
const hd = handedness(main.design);
const ps = pairSpacing(main.design);
console.log(`    helix windows ${hd.n}: ${hd.right} right-handed, ${hd.left} left-handed, mean signed volume ${f(hd.meanRight, 1)} A^3`);
console.log(`    ${ps.n} paired strand positions, mean ${f(ps.mean)} A, ${(100 * ps.inRange).toFixed(0)}% inside 4.2 to 6.2 A`);
console.log(`    latent state: ${main.design.meta.ssLatent.slice(0, 70)}...`);
console.log(`    measured      ${main.design.ss.slice(0, 70)}...`);
ok(M.sf.H + M.sf.E > 0.50, `ordered share ${(100 * (M.sf.H + M.sf.E)).toFixed(0)}% is over 50%, so the chain is not a random coil`);
ok(hd.n >= 8, `${hd.n} helix windows were found`);
ok(hd.right / hd.n > 0.80, `${(100 * hd.right / hd.n).toFixed(0)}% of the helix windows turn to the right, over 80%`);
ok(hd.meanRight > 34 && hd.meanRight < 52, `the mean signed volume ${f(hd.meanRight, 1)} A^3 is near the ideal 43 A^3`);
ok(main.design.meta.ssPairs.length >= 1, `${main.design.meta.ssPairs.length} strand pairs are in the latent state, so strands have partners`);
ok(ps.inRange > 0.75, `${(100 * ps.inRange).toFixed(0)}% of the paired strand positions sit inside 4.2 to 6.2 A`);

console.log('    a sweep of seeds, to show that both element types appear:');
const sweep = [];
for (const sd of [3, 5, 11, 29, 2, 17]) {
  const r = scaffold({ motif: MOTIF, motifStr: MOTIF_STR, seqLength: '140', seed: sd, steps: 240, keepTrajectory: false });
  const sf = ssFrac(r.design.ss), h = handedness(r.design);
  sweep.push({ sd, ...sf, right: h.right, left: h.left });
  console.log(`      seed ${String(sd).padStart(2)}  H ${(100 * sf.H).toFixed(0).padStart(2)}%  E ${(100 * sf.E).toFixed(0).padStart(2)}%  L ${(100 * sf.L).toFixed(0).padStart(2)}%  helix windows right/left ${h.right}/${h.left}`);
}
const mH = sweep.reduce((a, b) => a + b.H, 0) / sweep.length;
const mE = sweep.reduce((a, b) => a + b.E, 0) / sweep.length;
ok(mH > 0.20, `the mean helix share over 6 seeds is ${(100 * mH).toFixed(0)}%, over 20%`);
ok(mE > 0.15, `the mean strand share over 6 seeds is ${(100 * mE).toFixed(0)}%, over 15%`);
ok(sweep.every((x) => x.H + x.E > 0.45), 'every seed builds an ordered chain, over 45% helix plus strand');
ok(sweep.every((x) => x.H > 0.05 && x.E > 0.05), 'every seed builds both helix and strand');
const sR = sweep.reduce((a, b) => a + b.right, 0), sL = sweep.reduce((a, b) => a + b.left, 0);
ok(sR / (sR + sL) > 0.85, `over the sweep ${(100 * sR / (sR + sL)).toFixed(0)}% of helix windows turn to the right`);

section('7  the ligand is buried');
ok(M.bu.centre >= 6, `${M.bu.centre} C-alpha points lie inside 8 A of the ligand centre, at least 6`);
ok(M.bu.minPerAtom >= 4, `the worst ligand atom has ${M.bu.minPerAtom} C-alpha neighbours inside 8 A, at least 4`);
ok(M.bu.offCentre < 0.45 * rgT, `the ligand sits ${f(M.bu.offCentre)} A off the chain centre, under ${f(0.45 * rgT)} A`);

section('8  partial diffusion');
const parent = scaffold({ motif: MOTIF, motifStr: MOTIF_STR, seqLength: '150', seed: 11, steps: 240 });
ok(validate(parent.design).ok, `the parent design is valid at n=${parent.design.n}`);
const backs = [24, 60, 120, 180, 216];
const sims = [];
for (const b of backs) {
  const child = scaffold({
    motif: MOTIF, motifStr: MOTIF_STR, seed: 29, steps: 240,
    partial: { parent: parent.design, stepsBack: b }, keepTrajectory: false,
  });
  const s = similarity(parent.design.ca, child.design.ca, parent.design.n);
  const good = validate(child.design);
  sims.push({ b, ...s, ok: good.ok, ms: child.ms, steps: child.steps });
  console.log(`    ${String(b).padStart(3)} of 240 steps back -> TM ${f(s.tm, 3)}  RMSD ${f(s.rmsd)} A  (${child.steps} reverse steps, ${f(child.ms, 0)} ms, valid=${good.ok ? 'yes' : 'NO ' + good.errors.join('; ')})`);
}
ok(sims.every((s) => s.ok), 'every partial child passes validate()');
let mono = true;
for (let i = 1; i < sims.length; i++) if (sims[i].tm > sims[i - 1].tm) mono = false;
ok(mono, 'the similarity to the parent falls as the number of steps back rises');
ok(sims[0].tm > 0.9, `24 steps back keeps TM ${f(sims[0].tm, 3)} above 0.90`);
ok(sims[sims.length - 1].tm < sims[0].tm - 0.2, `216 steps back drops TM to ${f(sims[sims.length - 1].tm, 3)}, far under the near run`);
console.log('    note: the real pipeline reports TM about 95 at 600 of 1000 steps and about 80 at 900.');
console.log('          those are its numbers, not ours. Only the direction is shared.');

section('9  indexed and unindexed');
const uni = scaffold({ motif: MOTIF, motifStr: UNINDEXED_STR, seqLength: '140', seed: 5, steps: 160, unindexed: true });
const U = report('unindexed', uni);
ok(validate(uni.design).ok, 'the unindexed design passes validate()');
ok(Array.isArray(uni.plan.candidates) && uni.plan.candidates.length >= 3, `${uni.plan.candidates ? uni.plan.candidates.length : 0} placements were scored`);
ok(uni.plan.indexed === false, 'the plan is marked unindexed');
const best = Math.min(...uni.plan.candidates.map((c) => c.energy));
ok(uni.plan.candidates[0].energy === best, 'the kept placement is the lowest-energy one');
const idx = scaffold({ motif: MOTIF, motifStr: UNINDEXED_STR, seqLength: '140', seed: 5, steps: 160 });
ok(idx.plan.indexed === true && !idx.plan.candidates, `the indexed run scores one placement only: ${idx.plan.resolved}`);
ok(U.mr.rmsd < 0.25, `the unindexed run still holds the motif to ${fs(U.mr.rmsd)} A`);

section('10  speed');
console.log(`    140 residues, 240 steps, trajectory kept: ${f(wall, 1)} ms (run reported ${f(main.ms, 1)} ms)`);
const t1 = performance.now();
scaffold({ motif: MOTIF, motifStr: MOTIF_STR, seqLength: '140', seed: 3, steps: 240, keepTrajectory: false });
const bare = performance.now() - t1;
console.log(`    the same run with no trajectory: ${f(bare, 1)} ms`);
ok(wall < 1200, `the full run takes ${f(wall, 0)} ms, well under the 2000 ms budget`);
ok(main.trajectory.length <= 60 && main.trajectory.length >= 30, `${main.trajectory.length} trajectory frames, inside 30..60`);
ok(main.trajectory.every((fr) => fr.ca instanceof Float32Array && fr.ca.length === 140 * 3), 'every frame holds a full C-alpha copy');
let fall = true;
for (let i = 1; i < main.trajectory.length; i++) if (main.trajectory[i].sigma > main.trajectory[i - 1].sigma) fall = false;
ok(fall, 'the noise level falls over the trajectory');

section('11  onStep drives the animation');
let calls = 0, lastT = 2, shapeOk = true;
const anim = scaffold({
  motif: MOTIF, motifStr: MOTIF_STR, seqLength: '140', seed: 13, steps: 60, keepTrajectory: false,
  onStep: (s) => {
    calls++;
    if (!(s.ca instanceof Float32Array) || s.ca.length !== s.ca.length) shapeOk = false;
    if (!Number.isFinite(s.sigma) || s.t > lastT + 1e-9) shapeOk = false;
    lastT = s.t;
  },
});
ok(calls === 60, `onStep fired once per reverse step: ${calls} of 60`);
ok(shapeOk, 'every onStep call carries a C-alpha array and a falling schedule point');
ok(anim.steps === 60, `the run reports ${anim.steps} steps`);
ok(DEFAULTS.steps === 240 && DEFAULTS.maxFrames === 60, 'DEFAULTS carries the documented step count and frame cap');

section('12  the long chain still behaves');
const big = scaffold({ motif: MOTIF, motifStr: '60-130,A1,6-18,A2,6-18,A3,60-130/B1', seqLength: '260', seed: 2, steps: 240, keepTrajectory: false });
report('260 residues', big);
ok(validate(big.design).ok, 'the 260-residue design passes validate()');
ok(big.ms < 2000, `260 residues, 240 steps took ${f(big.ms, 0)} ms, under 2000 ms`);

section('13  bad input is refused, not folded');
const threw = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
// A motif residue that carries a CA atom with no coordinate. motif.js
// built one while this test was written, and it gave a chain of NaN that
// validate() caught only at the end.
const holed = JSON.parse(JSON.stringify(testMotif()));
holed.residues[1].atoms[0].x = null;
let m1 = threw(() => scaffold({ motif: holed, motifStr: MOTIF_STR, seqLength: '140', seed: 1, steps: 40 }));
ok(!!m1 && /A2/.test(m1) && /CA/.test(m1), `a CA atom with no coordinate is refused and named: ${m1}`);

const blank = JSON.parse(JSON.stringify(testMotif()));
blank.residues[2].atoms.forEach((a) => { a.x = null; a.y = null; a.z = null; });
let m2 = threw(() => scaffold({ motif: blank, motifStr: MOTIF_STR, seqLength: '140', seed: 1, steps: 40 }));
ok(!!m2 && /A3/.test(m2), `a residue with no placed atom is refused and named: ${m2}`);

let m3 = threw(() => scaffold({ motif: MOTIF, motifStr: '20-60,A9,20-60/B1', seqLength: '140', seed: 1, steps: 40 }));
ok(!!m3 && /A9/.test(m3), `a motif_str that asks for a residue the motif lacks is refused: ${m3}`);

let m4 = threw(() => scaffold({ motif: MOTIF, motifStr: MOTIF_STR, seqLength: '140', seed: 1, steps: 0 }));
ok(!!m4 && /steps/.test(m4), `a step count of zero is refused: ${m4}`);

let m5 = threw(() => scaffold({ motif: MOTIF, motifStr: '2-6,A1,2-6/B1', seqLength: null, seed: 1, steps: 40 }));
ok(!!m5 && /residues/.test(m5), `a chain that is too short is refused: ${m5}`);

console.log(`\n${failed === 0 ? 'ALL CHECKS PASS' : failed + ' CHECK(S) FAILED'}`);
process.exit(failed === 0 ? 0 : 1);
