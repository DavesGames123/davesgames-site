// ============================================================================
//  TEST  ·  sequence.js and metrics.js
// ----------------------------------------------------------------------------
//  Run it with:  node tools/test-metrics.mjs
//  Exit code 1 on any failure.
//
//  THE RULE OF THIS FILE. It writes its own distance, angle, RMSD and
//  rotation maths and never asks the module under test what a measurement
//  is. Then it checks the module against its own numbers. Where a case has
//  an answer that can be worked out on paper, the paper answer is the one
//  the test uses.
//
//  SECTIONS
//    1  vector and rotation maths of the test itself
//    2  superposition: identity, a turn and a shift, a mirror, optimality
//    3  TM-score: identical, a turn and a shift, one displaced residue
//    4  sequence.js: the table, determinism, held residues, temperature
//    5  the ensemble read-out
//    6  a design scored against itself
//    7  a scrambled design and an expanded design
//    8  the motif held against the motif released
//    9  real designs, scored from end to end
//   10  the campaign funnel
//   11  the API shape and the module rules
// ============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, '..');

const { MOTIFS, motifById } = await import(join(DIR, 'motif.js'));
const { scaffold } = await import(join(DIR, 'scaffold.js'));
const { validate, rng } = await import(join(DIR, 'design.js'));
const SEQ = await import(join(DIR, 'sequence.js'));
const MET = await import(join(DIR, 'metrics.js'));

let pass = 0, fail = 0;
const t0 = Date.now();
function ok(name, cond, note = '') {
  if (cond) { pass++; console.log(`  pass  ${name}${note ? ': ' + note : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${note ? ': ' + note : ''}`); }
}
function near(name, got, want, tol, unit = '') {
  const good = Number.isFinite(got) && Math.abs(got - want) <= tol;
  ok(name, good, `${fmt(got)}${unit} against ${fmt(want)}${unit}, tolerance ${fmt(tol)}`);
}
const fmt = (v) => (Number.isFinite(v) ? (Math.abs(v) >= 1e-4 || v === 0 ? v.toFixed(4) : v.toExponential(2)) : String(v));
const head = (s) => console.log(`\n${s}`);

// ---------------------------------------------------------------- 1. maths
head('1  the test writes its own maths');

const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vlen = (a) => Math.sqrt(vdot(a, a));
const vdist = (a, b) => vlen(vsub(a, b));
const pt = (arr, i) => [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];

// RMSD with no fitting, written here and not imported.
function myRmsd(a, b, idx = null) {
  const m = idx ? idx.length : Math.floor(a.length / 3);
  let s = 0;
  for (let q = 0; q < m; q++) {
    const i = idx ? idx[q] : q;
    const d = vdist(pt(a, i), pt(b, i));
    s += d * d;
  }
  return Math.sqrt(s / m);
}
// A rotation about a unit axis by an angle, by the Rodrigues formula.
function myRot(axis, ang) {
  const L = vlen(axis), [x, y, z] = axis.map((v) => v / L);
  const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}
const applyRT = (R, tr, src, n) => {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const [x, y, z] = pt(src, i);
    out[i * 3] = R[0] * x + R[1] * y + R[2] * z + tr[0];
    out[i * 3 + 1] = R[3] * x + R[4] * y + R[5] * z + tr[1];
    out[i * 3 + 2] = R[6] * x + R[7] * y + R[8] * z + tr[2];
  }
  return out;
};
const det3 = (R) => R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);

// A helix of 60 points with a 3.80 A step, built here.
function testTrace(n = 60) {
  const out = new Float32Array(n * 3);
  const rad = 2.3, rise = 1.5;
  for (let i = 0; i < n; i++) {
    const a = i * 100 * Math.PI / 180;
    out[i * 3] = rad * Math.cos(a); out[i * 3 + 1] = rad * Math.sin(a); out[i * 3 + 2] = i * rise;
  }
  return out;
}
const TR = testTrace(60);
// A helix of radius 2.3 A, rise 1.5 A and 100 degrees per residue gives
// sqrt((2*2.3*sin(50))^2 + 1.5^2) = 3.830 A, which is the textbook step.
near('the test helix has the textbook C-alpha step', vdist(pt(TR, 0), pt(TR, 1)),
  Math.hypot(2 * 2.3 * Math.sin(50 * Math.PI / 180), 1.5), 1e-6, ' A');
near('the Rodrigues rotation keeps a length', vlen([1, 2, 3]), vlen((() => { const R = myRot([1, 1, 0], 0.9); return [R[0] + 2 * R[1] + 3 * R[2], R[3] + 2 * R[4] + 3 * R[5], R[6] + 2 * R[7] + 3 * R[8]]; })()), 1e-6);

// ------------------------------------------------------- 2. superposition
head('2  superposition against answers worked out on paper');

{
  const n = 60;
  // 2a. a structure on itself.
  let f = MET.kabsch(TR, TR);
  ok('identity fit gives zero RMSD', f.rmsd < 1e-6, `${f.rmsd.toExponential(2)} A`);
  let maxOff = 0;
  for (let k = 0; k < 9; k++) maxOff = Math.max(maxOff, Math.abs(f.R[k] - (k % 4 === 0 ? 1 : 0)));
  ok('identity fit gives the identity rotation', maxOff < 1e-6, `largest error ${maxOff.toExponential(2)}`);

  // 2b. a known turn and shift. The fit must undo both exactly.
  const R = myRot([0.3, -0.5, 0.81], 1.23), tr = [12.5, -7.25, 3.0];
  const moved = applyRT(R, tr, TR, n);
  f = MET.kabsch(moved, TR);
  ok('a turn and a shift fit to zero RMSD', f.rmsd < 1e-4, `${f.rmsd.toExponential(2)} A`);
  const back = MET.applyFit(f, moved, n);
  ok('the fitted copy lands on the original', myRmsd(back, TR) < 1e-4, `${myRmsd(back, TR).toExponential(2)} A by the test own RMSD`);
  // The recovered rotation must be the inverse of the applied one.
  let worst = 0;
  for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) worst = Math.max(worst, Math.abs(f.R[k * 3 + j] - R[j * 3 + k]));
  ok('the recovered rotation is the transpose of the applied one', worst < 1e-4, `largest error ${worst.toExponential(2)}`);

  // 2c. a mirror image must NOT be fitted away.
  const mir = Float32Array.from(TR);
  for (let i = 0; i < n; i++) mir[i * 3 + 2] *= -1;
  f = MET.kabsch(mir, TR);
  ok('a mirror image does not fit', f.rmsd > 2.0, `${f.rmsd.toFixed(2)} A`);
  near('the fit is a proper rotation, determinant +1', det3(f.R), 1, 1e-6);

  // 2d. the fit is the best one. 400 small turns of the answer may not beat it.
  const half = Float32Array.from(TR);
  for (let i = 0; i < n / 2; i++) half[i * 3] += 3.0;
  f = MET.kabsch(half, TR);
  const base = f.rmsd;
  const rand = rng(4242);
  let beaten = 0, bestOther = Infinity;
  for (let t = 0; t < 400; t++) {
    const ax = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
    const ang = (rand() * 2 - 1) * 0.25;
    const Q = myRot(ax, ang);
    // Turn the fitted copy a little about the reference centroid.
    const fitted = MET.applyFit(f, half, n);
    const c = f.cRef;
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const p = vsub(pt(fitted, i), c);
      out[i * 3] = Q[0] * p[0] + Q[1] * p[1] + Q[2] * p[2] + c[0];
      out[i * 3 + 1] = Q[3] * p[0] + Q[4] * p[1] + Q[5] * p[2] + c[1];
      out[i * 3 + 2] = Q[6] * p[0] + Q[7] * p[1] + Q[8] * p[2] + c[2];
    }
    const r = myRmsd(out, TR);
    if (r < bestOther) bestOther = r;
    if (r < base - 1e-9) beaten++;
  }
  ok('no random turn beats the fit', beaten === 0, `fit ${base.toFixed(4)} A, best of 400 turns ${bestOther.toFixed(4)} A`);

  // 2e. the RMSD of the half-shifted case, by the test own maths.
  near('the module RMSD matches the test RMSD', base, myRmsd(MET.applyFit(f, half, n), TR), 1e-5, ' A');

  // 2f. fitting on a subset scores only that subset.
  const idx = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const g = MET.kabsch(half, TR, idx);
  ok('a fit on ten unmoved residues is near exact', g.rmsd < 1e-4, `${g.rmsd.toExponential(2)} A over ${g.count} residues`);
}

// ------------------------------------------------------------ 3. TM-score
head('3  TM-score against answers worked out on paper');

{
  const n = 60;
  const d0 = 1.24 * Math.cbrt(n - 15) - 1.8;
  const got = MET.tmScore(TR, TR, n);
  near('d0 follows 1.24*(L-15)^(1/3) - 1.8', got.d0, d0, 1e-9, ' A');
  near('a structure against itself scores 1', got.tm, 1, 1e-9);
  near('coverage of a structure against itself is 1', got.coverage, 1, 1e-12);

  const R = myRot([0.1, 0.9, -0.42], 2.1), tr = [-30, 5, 11];
  const moved = applyRT(R, tr, TR, n);
  near('a turn and a shift still score 1', MET.tmScore(moved, TR, n).tm, 1, 1e-6);

  // One residue pushed out by exactly 4 A. Fitting the other 59 is exact,
  // so TM is at least (59 + 1/(1+(4/d0)^2)) / 60, and never above 1.
  const one = Float32Array.from(TR);
  one[10 * 3] += 4.0;
  const bound = (59 + 1 / (1 + (4.0 / d0) ** 2)) / 60;
  const t1 = MET.tmScore(one, TR, n).tm;
  ok('one residue out by 4 A scores at least the paper bound and at most 1',
    t1 >= bound - 1e-6 && t1 <= 1 + 1e-12, `${t1.toFixed(6)} against the bound ${bound.toFixed(6)}`);

  // Two unrelated compact chains of the same length score low.
  const rand = rng(99);
  const blob = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = i * 3;
    blob[k] = (rand() - 0.5) * 24; blob[k + 1] = (rand() - 0.5) * 24; blob[k + 2] = (rand() - 0.5) * 24;
  }
  const tLow = MET.tmScore(blob, TR, n).tm;
  ok('an unrelated cloud scores low', tLow < 0.35, `${tLow.toFixed(4)}`);

  // A scaled copy: every point moves out by (s-1)*r from the centroid.
  const s = 1.25;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += TR[i * 3]; cy += TR[i * 3 + 1]; cz += TR[i * 3 + 2]; }
  cx /= n; cy /= n; cz /= n;
  const big = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    big[i * 3] = cx + (TR[i * 3] - cx) * s;
    big[i * 3 + 1] = cy + (TR[i * 3 + 1] - cy) * s;
    big[i * 3 + 2] = cz + (TR[i * 3 + 2] - cz) * s;
  }
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const r = vdist(pt(TR, i), [cx, cy, cz]);
    sum += 1 / (1 + ((s - 1) * r / d0) ** 2);
  }
  const noFitTm = sum / n;
  const tBig = MET.tmScore(big, TR, n).tm;
  ok('a 25 percent larger copy scores at least the no-fit value and below 1',
    tBig >= noFitTm - 1e-6 && tBig < 0.999,
    `${tBig.toFixed(4)} against the no-fit value ${noFitTm.toFixed(4)}`);

  // Timing on a real chain length.
  const long = testTrace(200);
  const tStart = Date.now();
  MET.tmScore(long, long, 200);
  console.log(`  note  TM-score of a 200-residue pair takes ${Date.now() - tStart} ms`);
}

// --------------------------------------------------------- 4. sequence.js
head('4  sequence.js');

const AA_LETTERS = 'ACDEFGHIKLMNPQRSTVWY';
{
  ok('AA_INFO holds all twenty amino acids', Object.keys(SEQ.AA_INFO).length === 20
    && AA_LETTERS.split('').every((a) => SEQ.AA_INFO[a]));
  const bad = Object.entries(SEQ.AA_INFO).filter(([, v]) => !(
    typeof v.name === 'string' && Number.isFinite(v.hydropathy) && Number.isFinite(v.charge)
    && Number.isFinite(v.helixProp) && Number.isFinite(v.sheetProp) && v.volume > 50));
  ok('every AA_INFO row has all six columns', bad.length === 0, bad.map((b) => b[0]).join(',') || 'none missing');
  near('isoleucine is the most oily, at +4.5', SEQ.AA_INFO.I.hydropathy, 4.5, 1e-9);
  near('arginine is the most water-loving, at -4.5', SEQ.AA_INFO.R.hydropathy, -4.5, 1e-9);
  ok('aspartate and glutamate carry -1, lysine and arginine +1',
    SEQ.AA_INFO.D.charge === -1 && SEQ.AA_INFO.E.charge === -1
    && SEQ.AA_INFO.K.charge === 1 && SEQ.AA_INFO.R.charge === 1);
  ok('glycine is the smallest and tryptophan the largest',
    Math.min(...Object.values(SEQ.AA_INFO).map((v) => v.volume)) === SEQ.AA_INFO.G.volume
    && Math.max(...Object.values(SEQ.AA_INFO).map((v) => v.volume)) === SEQ.AA_INFO.W.volume);
  const fsum = Object.values(SEQ.AA_FREQ).reduce((a, b) => a + b, 0);
  near('the background shares add to 100 percent', fsum, 100, 1.0, '%');
}

const kemp = motifById('kemp');
const kempEntry = MOTIFS.find((m) => m.id === 'kemp');
const RUN = scaffold({ motif: kemp, motifStr: kempEntry.motifStr, seqLength: kempEntry.seqLength, seed: 3, steps: 240 });
const BASE = RUN.design;
ok('the base design passes validate()', validate(BASE).ok, validate(BASE).errors.join('; ') || `${BASE.n} residues`);

{
  const tA = Date.now();
  const a = SEQ.designSequence(BASE, kemp, { seed: 7, temperature: 0.1, nSeq: 4 });
  const msA = Date.now() - tA;
  const b = SEQ.designSequence(BASE, kemp, { seed: 7, temperature: 0.1, nSeq: 4 });
  ok('designSequence returns the asked-for count', a.length === 4);
  ok('designSequence is deterministic from its seed',
    JSON.stringify(a.map((x) => x.seq)) === JSON.stringify(b.map((x) => x.seq)));
  const c = SEQ.designSequence(BASE, kemp, { seed: 8, temperature: 0.1, nSeq: 4 });
  ok('another seed gives another ensemble', a[0].seq !== c[0].seq);
  ok('every sequence has the length of the design', a.every((x) => x.seq.length === BASE.n));
  ok('every letter is an amino acid', a.every((x) => !/[^ACDEFGHIKLMNPQRSTVWY]/.test(x.seq)));
  ok('the log probability is negative and finite', a.every((x) => x.logp < 0 && Number.isFinite(x.logp)));
  ok('perResidue has one row per residue', a[0].perResidue.length === BASE.n
    && a[0].perResidue.every((r, i) => r.i === i && r.aa === a[0].seq[i]));

  // Motif residues keep the identity the chemistry needs.
  const wrong = [];
  for (let i = 0; i < BASE.n; i++) {
    if (!BASE.fixed[i]) continue;
    const want = kemp.residues[BASE.motifId[i]].code;
    for (const x of a) if (x.seq[i] !== want) wrong.push(`${i} wanted ${want} got ${x.seq[i]}`);
  }
  ok('every held residue keeps its own identity', wrong.length === 0, wrong.join('; ') || 'glutamate and serine held');
  ok('the held residues are marked in perResidue',
    a[0].perResidue.filter((r) => r.fixed).length === [...BASE.fixed].filter(Boolean).length);

  // Burial does what it says: the buried half is more oily than the rest.
  const f = SEQ.residueFeatures(BASE);
  let hiSum = 0, hiN = 0, loSum = 0, loN = 0;
  for (let i = 0; i < BASE.n; i++) {
    if (BASE.fixed[i]) continue;
    const h = SEQ.AA_INFO[a[0].seq[i]].hydropathy;
    if (f.burialRank[i] > 0.75) { hiSum += h; hiN++; } else if (f.burialRank[i] < 0.25) { loSum += h; loN++; }
  }
  ok('the buried quarter is oilier than the exposed quarter',
    hiSum / hiN > loSum / loN + 2.0,
    `buried mean hydropathy ${(hiSum / hiN).toFixed(2)}, exposed ${(loSum / loN).toFixed(2)}`);

  // Composition sanity. A real protein is not one letter.
  const count = {};
  for (const ch of a[0].seq) count[ch] = (count[ch] || 0) + 1;
  const top = Math.max(...Object.values(count)) / BASE.n;
  ok('no single letter takes more than a third of the chain', top < 0.34, `the most common letter is ${(100 * top).toFixed(0)}%`);
  ok('at least twelve different letters appear', Object.keys(count).length >= 12, `${Object.keys(count).length} letters`);
  const oily = [...a[0].seq].filter((ch) => 'AVLIMFWC'.includes(ch)).length / BASE.n;
  ok('the oily share sits between a third and two thirds', oily > 0.33 && oily < 0.67, `${(100 * oily).toFixed(0)}%`);

  // A high temperature must widen the ensemble.
  const hot = SEQ.designSequence(BASE, kemp, { seed: 7, temperature: 1.5, nSeq: 6 });
  const cold = SEQ.designSequence(BASE, kemp, { seed: 7, temperature: 0.05, nSeq: 6 });
  const agHot = SEQ.ensembleAgreement(hot).mean, agCold = SEQ.ensembleAgreement(cold).mean;
  ok('a low temperature agrees more than a high one', agCold > agHot + 0.1,
    `agreement ${agCold.toFixed(3)} at 0.05 against ${agHot.toFixed(3)} at 1.5`);
  ok('a high temperature loses log probability', hot[0].logp < cold[0].logp,
    `${hot[0].logp.toFixed(1)} against ${cold[0].logp.toFixed(1)}`);
  console.log(`  note  four sequences of ${BASE.n} residues take ${msA} ms`);

  // Bad arguments are refused.
  let threw = 0;
  for (const bad of [{ nSeq: 0 }, { nSeq: 1.5 }, { temperature: 0 }, { temperature: -1 }]) {
    try { SEQ.designSequence(BASE, kemp, { seed: 1, ...bad }); } catch { threw++; }
  }
  ok('bad arguments are refused', threw === 4, `${threw} of 4 threw`);

  // predictSS
  const ssH = SEQ.predictSS('M' + 'AEELLKEAEELLKEAEELLKEAEELLKEA'.repeat(2));
  const ssE = SEQ.predictSS('M' + 'VTVIVTVIVTVIVTVIVTVIVTVIVTVIV'.repeat(2));
  ok('a glutamate and leucine run predicts helix', (ssH.match(/H/g) || []).length > ssH.length * 0.5,
    `${(100 * (ssH.match(/H/g) || []).length / ssH.length).toFixed(0)}% helix`);
  ok('a valine and threonine run predicts strand', (ssE.match(/E/g) || []).length > ssE.length * 0.5,
    `${(100 * (ssE.match(/E/g) || []).length / ssE.length).toFixed(0)}% strand`);
  ok('predictSS uses only H, E and L', !/[^HEL]/.test(ssH + ssE));
  ok('predictSS keeps the length', SEQ.predictSS(a[0].seq).length === BASE.n);
}

// ---------------------------------------------------------- 5. the ensemble
head('5  the ensemble read-out');
{
  const ag = SEQ.ensembleAgreement(['ACDE', 'ACDE', 'ACDE']);
  near('three identical sequences agree perfectly', ag.mean, 1, 1e-12);
  ok('the consensus of identical sequences is the sequence', ag.consensus === 'ACDE');
  near('their pairwise identity is 1', ag.identity, 1, 1e-12);
  const ag2 = SEQ.ensembleAgreement(['AAAA', 'AAAC']);
  near('one letter in four differing gives 0.875 agreement', ag2.mean, (1 + 1 + 1 + 0.5) / 4, 1e-12);
  near('their pairwise identity is 0.75', ag2.identity, 0.75, 1e-12);
  let threw = false;
  try { SEQ.ensembleAgreement(['AA', 'AAA']); } catch { threw = true; }
  ok('sequences of different lengths are refused', threw);
}

// ------------------------------------------- 6. a design against itself
head('6  a design scored against itself');

const ENS = SEQ.designSequence(BASE, kemp, { seed: 7, temperature: 0.1, nSeq: 1 });
BASE.seq = ENS[0].seq;

const SELF = MET.evaluate(BASE, kemp, { seed: 101, releaseDesign: BASE });
{
  const M = SELF.metrics, F = SELF.families;
  near('its own C-alpha RMSD is zero', M.selfConsistency.rmsd, 0, 1e-4, ' A');
  near('its own TM-score is 1', M.selfConsistency.tm, 1, 1e-9);
  near('its own motif RMSD is zero', M.motifRmsd, 0, 1e-4, ' A');
  near('its own ligand RMSD is zero', M.ligandRmsd, 0, 1e-3, ' A');
  near('the pin check is zero', M.motifHeldRmsd, 0, 1e-3, ' A');
  near('every catalytic measurement is inside tolerance', SELF.extra.geomPass, 1, 1e-12);
  near('the motif family scores 1', F.motif, 1, 1e-3);
  near('the self-consistency family scores 1', F.selfConsistency, 1, 1e-3);
  // The pocket and fold families are absolute quality, not a comparison,
  // so they are high and not exactly 1. The test says which is which.
  ok('the pocket family is high', F.pocket > 0.75, F.pocket.toFixed(3));
  ok('the fold family is high', F.fold > 0.75, F.fold.toFixed(3));
  ok('the overall score is high', SELF.overall > 0.85, SELF.overall.toFixed(3));
  ok('it passes every funnel step', SELF.pass, SELF.failed.join(',') || 'nothing failed');
  console.log(`  note  families  motif ${F.motif.toFixed(3)}  pocket ${F.pocket.toFixed(3)}  fold ${F.fold.toFixed(3)}  self-consistency ${F.selfConsistency.toFixed(3)}`);
}

// ------------------------------- 7. a scrambled and an expanded design
head('7  a scrambled design and an expanded design');

function scramble(d, seed) {
  const rand = rng(seed), n = d.n;
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const ca = new Float32Array(n * 3), cb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const s = order[i] * 3, t = i * 3;
    ca[t] = d.ca[s]; ca[t + 1] = d.ca[s + 1]; ca[t + 2] = d.ca[s + 2];
    cb[t] = d.cb[s]; cb[t + 1] = d.cb[s + 1]; cb[t + 2] = d.cb[s + 2];
  }
  return { ...d, ca, cb, meta: { ...d.meta } };
}
function expand(d, s) {
  const n = d.n;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += d.ca[i * 3]; cy += d.ca[i * 3 + 1]; cz += d.ca[i * 3 + 2]; }
  cx /= n; cy /= n; cz /= n;
  const ca = new Float32Array(n * 3), cb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = i * 3;
    ca[k] = cx + (d.ca[k] - cx) * s; ca[k + 1] = cy + (d.ca[k + 1] - cy) * s; ca[k + 2] = cz + (d.ca[k + 2] - cz) * s;
    cb[k] = cx + (d.cb[k] - cx) * s; cb[k + 1] = cy + (d.cb[k + 1] - cy) * s; cb[k + 2] = cz + (d.cb[k + 2] - cz) * s;
  }
  return { ...d, ca, cb, meta: { ...d.meta } };
}
const SCRAM = scramble(BASE, 1234);
const EXPAND = expand(BASE, 1.6);
{
  // A scrambled trace keeps every point, so the test checks that it is
  // the same cloud in a different order.
  const sumA = [...BASE.ca].reduce((a, b) => a + b, 0), sumB = [...SCRAM.ca].reduce((a, b) => a + b, 0);
  near('the scrambled design is the same cloud in another order', sumB, sumA, 1e-2, ' A');
  ok('the scrambled design is no longer a legal chain', !validate(SCRAM).ok, validate(SCRAM).errors[0] || '');
  ok('the expanded design is no longer a legal chain', !validate(EXPAND).ok, validate(EXPAND).errors[0] || '');

  // As a reference for the design: the comparison families collapse.
  const vsScram = MET.evaluate(BASE, kemp, { seed: 101, releaseDesign: SCRAM });
  const vsExpand = MET.evaluate(BASE, kemp, { seed: 101, releaseDesign: EXPAND });
  ok('the scrambled reference scores far worse on TM', vsScram.metrics.selfConsistency.tm < 0.35,
    `${vsScram.metrics.selfConsistency.tm.toFixed(3)} against 1.000 for itself`);
  ok('the expanded reference scores far worse on TM', vsExpand.metrics.selfConsistency.tm < 0.55,
    `${vsExpand.metrics.selfConsistency.tm.toFixed(3)} against 1.000 for itself`);
  ok('the scrambled reference scores far worse on motif RMSD', vsScram.metrics.motifRmsd > 8.0,
    `${vsScram.metrics.motifRmsd.toFixed(2)} A against 0.00 A for itself`);
  ok('the expanded reference scores far worse on motif RMSD', vsExpand.metrics.motifRmsd > 4.0,
    `${vsExpand.metrics.motifRmsd.toFixed(2)} A against 0.00 A for itself`);
  ok('both fall out of the funnel', !vsScram.pass && !vsExpand.pass,
    `scrambled failed ${vsScram.failed.join(',')}; expanded failed ${vsExpand.failed.join(',')}`);
  ok('the self-consistency family collapses for both',
    vsScram.families.selfConsistency < 0.2 && vsExpand.families.selfConsistency < 0.45,
    `scrambled ${vsScram.families.selfConsistency.toFixed(3)}, expanded ${vsExpand.families.selfConsistency.toFixed(3)}`);

  // As designs in their own right, with the refold switched off because a
  // broken chain is not worth folding.
  const asScram = MET.evaluate(SCRAM, kemp, { selfConsistency: false });
  const asExpand = MET.evaluate(EXPAND, kemp, { selfConsistency: false });
  ok('a scrambled design scores far lower overall', asScram.overall < SELF.overall - 0.3,
    `${asScram.overall.toFixed(3)} against ${SELF.overall.toFixed(3)}`);
  ok('an expanded design scores far lower overall', asExpand.overall < SELF.overall - 0.3,
    `${asExpand.overall.toFixed(3)} against ${SELF.overall.toFixed(3)}`);
  ok('a scrambled design fails the legal-chain step', asScram.failed.includes('chain'), asScram.failed.join(','));
  ok('an expanded design fails the legal-chain step', asExpand.failed.includes('chain'), asExpand.failed.join(','));
  ok('an expanded design loses its pocket', asExpand.metrics.ligandBuried < SELF.metrics.ligandBuried - 0.1,
    `burial ${asExpand.metrics.ligandBuried.toFixed(2)} against ${SELF.metrics.ligandBuried.toFixed(2)}`);
  console.log(`  note  overall  itself ${SELF.overall.toFixed(3)}  scrambled ${asScram.overall.toFixed(3)}  expanded ${asExpand.overall.toFixed(3)}`);
}

// ----------------------------- 8. the motif held against the motif released
head('8  a design built with the motif held, against the same chain released');
{
  const rel = MET.pinRelease(BASE, kemp, { seed: 101, seeds: 2, release: 0.10 });
  const heldPin = MET.motifHeldRmsd(BASE, kemp).rmsd;
  const freePins = rel.designs.map((d) => MET.motifHeldRmsd(d, kemp).rmsd);
  ok('with the motif held, the catalytic residues sit on the motif', heldPin < 0.05, `${heldPin.toExponential(2)} A`);
  ok('with the motif released, they move far away', Math.min(...freePins) > 1.0,
    `${freePins.map((v) => v.toFixed(2)).join(' and ')} A over ${rel.designs.length} runs`);
  ok('the held design beats the released one on motif RMSD by a wide margin',
    Math.min(...freePins) > heldPin + 1.0,
    `held ${heldPin.toExponential(2)} A against released ${Math.min(...freePins).toFixed(2)} A`);
  // The released chain is still a legal chain, so the drift is relaxation
  // and not breakage.
  ok('the released chain is still legal', rel.designs.every((d) => validate(d).ok),
    validate(rel.designs[0]).errors.join('; ') || 'both runs pass validate()');
  console.log(`  note  the pin release of ${BASE.n} residues takes ${rel.ms.toFixed(0)} ms for ${rel.designs.length} runs`);

  // The refold from noise is reported honestly as uninformative.
  const noise = MET.refold(BASE, kemp, { seed: 211, seeds: 1 });
  const cmp = MET.compareToDesign(BASE, noise.designs[0], []);
  ok('the refold from noise returns a legal chain', validate(noise.designs[0]).ok);
  ok('the refold from noise scores near two unrelated chains, as the header says',
    cmp.tm > 0.10 && cmp.tm < 0.40, `TM ${cmp.tm.toFixed(3)}, RMSD ${cmp.rmsd.toFixed(1)} A`);
  console.log(`  note  the refold from noise takes ${noise.ms.toFixed(0)} ms and is reported with informative: false`);
}

// -------------------------------------- 9. real designs, end to end
head('9  real designs from scaffold.js, scored end to end');

const RESULTS = [];
{
  const rows = [];
  for (const entry of MOTIFS) {
    const m = motifById(entry.id);
    for (const seed of [2, 3, 5, 6]) {
      const tA = Date.now();
      const run = scaffold({ motif: m, motifStr: entry.motifStr, seqLength: entry.seqLength, seed, steps: 240 });
      const msScaffold = Date.now() - tA;
      const tB = Date.now();
      const ens = SEQ.designSequence(run.design, m, { seed: 7, temperature: 0.1, nSeq: 4 });
      const msSeq = Date.now() - tB;
      run.design.seq = ens[0].seq;
      const tC = Date.now();
      const r = MET.evaluate(run.design, m, { seed: 101 });
      const msEval = Date.now() - tC;
      RESULTS.push(r);
      const ag = SEQ.ensembleAgreement(ens);
      rows.push({
        id: entry.id, seed, n: run.design.n, r, ag: ag.mean,
        msScaffold, msSeq, msEval, valid: validate(run.design).ok,
      });
    }
  }
  const p = (v, w, k = 2) => (Number.isFinite(v) ? v.toFixed(k) : 'na').padStart(w);
  console.log('');
  console.log('  motif  seed    n  motifRmsd  held  geom  clash%  buried  support  relTM  relRMSD  noiseTM  agree | motif pocket  fold    sc | overall  pass  failed');
  for (const x of rows) {
    const M = x.r.metrics, F = x.r.families;
    console.log('  ' + [
      x.id.padEnd(6), String(x.seed).padStart(4), String(x.n).padStart(4),
      p(M.motifRmsd, 10), p(M.motifHeldRmsd, 5, 3), p(x.r.extra.geomPass, 5),
      p(M.ligandClashPct, 6, 0), p(M.ligandBuried, 7), p(M.motifSupport, 8, 1),
      p(M.selfConsistency.tm, 6, 3), p(M.selfConsistency.rmsd, 8),
      p(M.fromNoise && M.fromNoise.tm, 8, 3), p(x.ag, 6, 2), '|',
      p(F.motif, 5), p(F.pocket, 6), p(F.fold, 5), p(F.selfConsistency, 5), '|',
      p(x.r.overall, 7), (x.r.pass ? 'yes' : 'no').padStart(5),
      ' ' + (x.r.failed.join(',') || '-'),
    ].join(' '));
  }
  console.log('');
  for (const x of rows) {
    console.log(`  time  ${x.id} seed ${x.seed}: scaffold ${x.msScaffold} ms, sequence ${x.msSeq} ms, evaluate ${x.msEval} ms`);
  }
  ok('every design is a legal chain', rows.every((x) => x.valid));
  ok('every design places its motif', rows.every((x) => x.r.metrics.motifHeldRmsd < 0.05));
  ok('every catalytic measurement of every design is inside tolerance',
    rows.every((x) => x.r.extra.geomPass === 1));
  ok('no design lets the chain run through the ligand', rows.every((x) => x.r.metrics.ligandClashPct === 0));
  ok('the refold from noise is flat across every design, which is why it is not scored',
    rows.every((x) => x.r.metrics.fromNoise.tm < 0.40) && rows.every((x) => x.r.metrics.fromNoise.informative === false),
    `TM from ${Math.min(...rows.map((x) => x.r.metrics.fromNoise.tm)).toFixed(3)} to ${Math.max(...rows.map((x) => x.r.metrics.fromNoise.tm)).toFixed(3)}`);
  const relTm = rows.map((x) => x.r.metrics.selfConsistency.tm);
  ok('the pin release does spread across designs, which is why it is scored',
    Math.max(...relTm) - Math.min(...relTm) > 0.08,
    `TM from ${Math.min(...relTm).toFixed(3)} to ${Math.max(...relTm).toFixed(3)}`);
  const ev = rows.map((x) => x.msEval);
  ok('evaluate stays under 400 ms per design', Math.max(...ev) < 400, `worst ${Math.max(...ev)} ms`);

  // Determinism of the whole chain of modules.
  const again = MET.evaluate(RUN.design, kemp, { seed: 101 });
  const first = MET.evaluate(RUN.design, kemp, { seed: 101 });
  ok('evaluate is deterministic', JSON.stringify(again.metrics.selfConsistency) === JSON.stringify(first.metrics.selfConsistency)
    && again.overall === first.overall, `overall ${first.overall.toFixed(6)}`);
}

// ------------------------------------------------------ 10. the funnel
head('10  the campaign funnel');
{
  const fn = MET.funnel(RESULTS);
  console.log('');
  for (const s of fn.steps) {
    console.log(`  ${s.key.padEnd(15)} kept ${String(s.kept).padStart(3)} of ${String(s.of).padStart(3)}, lost ${s.lost}`);
  }
  console.log(`  survivors ${fn.kept} of ${fn.started}`);
  ok('the funnel never gains a design', fn.steps.every((s) => s.kept <= s.of));
  ok('the funnel counts add up', fn.steps.every((s) => s.kept + s.lost === s.of));
  ok('the survivor count matches the last step', fn.kept === fn.steps[fn.steps.length - 1].kept);
  ok('every survivor says it passed', fn.survivors.every((r) => r.pass));
  ok('the funnel starts with every design', fn.started === RESULTS.length && fn.steps[0].of === RESULTS.length);
  ok('a design that fails names the step it failed',
    RESULTS.every((r) => r.pass === (r.failed.length === 0)));
  ok('FILTERS has the shape the contract gives', MET.FILTERS.length >= 4
    && MET.FILTERS.every((f) => typeof f.key === 'string' && typeof f.label === 'string'
      && typeof f.test === 'function' && typeof f.why === 'string' && f.why.length > 40));
  ok('every filter key is different', new Set(MET.FILTERS.map((f) => f.key)).size === MET.FILTERS.length);
}

// ------------------------------- 11. the API shape and the module rules
head('11  the API shape and the module rules');
{
  for (const name of ['designSequence', 'AA_INFO']) ok(`sequence.js exports ${name}`, SEQ[name] !== undefined);
  for (const name of ['evaluate', 'FILTERS']) ok(`metrics.js exports ${name}`, MET[name] !== undefined);
  const M = SELF.metrics;
  for (const key of ['motifRmsd', 'ligandClashPct', 'ligandBuried', 'rg', 'ssFraction', 'contactOrder', 'geometry', 'selfConsistency']) {
    ok(`metrics carries ${key}`, M[key] !== undefined);
  }
  ok('ssFraction holds H, E and L that add to 1',
    Math.abs(M.ssFraction.H + M.ssFraction.E + M.ssFraction.L - 1) < 1e-6);
  ok('selfConsistency holds rmsd and tm', Number.isFinite(M.selfConsistency.rmsd) && Number.isFinite(M.selfConsistency.tm));
  for (const key of ['motif', 'pocket', 'fold', 'selfConsistency']) {
    ok(`families carries ${key}, inside 0 to 1`, SELF.families[key] >= 0 && SELF.families[key] <= 1,
      SELF.families[key].toFixed(3));
  }
  ok('the record carries overall, pass, failed and ms',
    Number.isFinite(SELF.overall) && typeof SELF.pass === 'boolean'
    && Array.isArray(SELF.failed) && Number.isFinite(SELF.ms));
  ok('every geometry row carries label, value, ideal, tol and pass',
    M.geometry.length > 0 && M.geometry.every((g) => typeof g.label === 'string'
      && Number.isFinite(g.value) && Number.isFinite(g.ideal) && Number.isFinite(g.tol)
      && typeof g.pass === 'boolean' && typeof g.why === 'string'));
  ok('every card can say the result is a simulation', SELF.extra.simulated === true);

  // No live Math.random, and no DOM, in either module.
  for (const file of ['sequence.js', 'metrics.js']) {
    const src = readFileSync(join(DIR, file), 'utf8');
    const live = src.split('\n').filter((l) => l.includes('Math.random') && !l.trim().startsWith('//'));
    ok(`${file} uses no live Math.random`, live.length === 0, live.join(' | ') || 'none');
    const dom = src.split('\n').filter((l) => /\b(document|window|navigator)\b/.test(l) && !l.trim().startsWith('//'));
    ok(`${file} touches no DOM`, dom.length === 0, dom.join(' | ') || 'none');
    ok(`${file} has a header with a grep map`, src.includes('EXPORTS   (grep -n'));
  }
  // The scaling table must be ordered the way its names claim.
  const S = MET.SCORING;
  ok('the falling scales have good below bad',
    S.motifRmsd.good < S.motifRmsd.bad && S.ligandRmsd.good < S.ligandRmsd.bad
    && S.scRmsd.good < S.scRmsd.bad && S.heldRmsd.good < S.heldRmsd.bad);
  ok('the rising scales have bad below good',
    S.buried.bad < S.buried.good && S.support.bad < S.support.good
    && S.ssOrder.bad < S.ssOrder.good && S.tm.bad < S.tm.good);
  near('the family weights add to 1', Object.values(S.families).reduce((a, b) => a + b, 0), 1, 1e-9);
}

// ------------------------------------------------------------------ result
console.log(`\n${pass + fail} checks, ${fail} failures, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (fail) { console.log('FAILED'); process.exit(1); }
console.log('all checks passed');
