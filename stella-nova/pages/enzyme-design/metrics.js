// ============================================================================
//  METRICS  ·  the evaluation stage of the lab
// ----------------------------------------------------------------------------
//  The scaffolder makes a shape and the sequence designer gives it letters.
//  This module asks whether the result is any good. It is the fourth stage
//  of the real pipeline, evaluate_design.py, in the shape this page can
//  compute. No DOM, so Node can import it.
//
//  THE ONE LESSON. A design can look perfect and still be worthless,
//  because the scaffolder nailed the catalytic residues in place. The test
//  that catches it is self-consistency: take the SEQUENCE alone, fold it
//  again with the motif restraint switched OFF, and see where it lands. A
//  design that only held its shape because the motif was pinned falls
//  apart. The real pipeline does the same test with AlphaFold 3. The
//  AlphaProtein Novo abstract states that metrics drawn from the reaction
//  mechanism, computed on AlphaFold 3 predictions, were one of the two
//  things that made the designs work.
//
//  The lab runs that test two ways, and only one of the two measures
//  anything. The next two paragraphs say which, and why.
//
//  TWO CHECKS, AND ONE OF THEM FAILED. The module runs both and reports
//  both, because the difference between them is a real lesson.
//
//  refold() is the check the contract asks for: take the sequence alone
//  and fold it again from noise with the motif restraint off. MEASURED
//  RESULT: it carries no signal here. Over three motifs and several
//  seeds the TM-score stays near 0.20 whatever sequence goes in, and
//  feeding the design's own measured structure state as the latent does
//  not raise it. The cause is plain. AlphaFold 3 learned how a sequence
//  folds; our denoiser learned nothing. Bond lengths, clashes,
//  compaction and a helix or strand state do not fix which helix packs
//  against which, so two unrelated compact chains of the same length
//  score about 0.20, and that is what comes back. evaluate() reports the
//  number with `informative: false`.
//
//  pinRelease() is the check that works. Take the design, let go of the
//  catalytic residues, and relax. The scaffolder's own restraints then
//  pull the site wherever they want it. A design whose pocket really
//  cradles the motif hardly moves; a design that only looked right
//  because the residues were nailed down springs apart. Over the same 48
//  designs the motif C-alpha drift runs 3.1 to 10.9 A and the TM-score
//  runs 0.46 to 0.71, so the check ranks designs instead of failing them
//  all. That is what families.selfConsistency and the funnel use, and
//  the page must say that it is the lab's own stand-in for the pipeline's
//  AlphaFold 3 step, not the same test.
//
//  SIDE CHAINS. The design format holds one C-alpha and one C-beta per
//  residue, so a design carries no side-chain atoms. To score the
//  catalytic measurements of the motif, rebuildMotifAtoms() puts each
//  side chain back on its residue rigidly. The frame is the residue's
//  C-alpha, its C-beta and the direction to the ligand centre, and all
//  three exist in the motif and in the design. The rebuild is exact for a
//  residue that the scaffolder pinned, and approximate for one that
//  moved, because it assumes the side chain keeps its turn against the
//  ligand.
//
//  That limit decides where the catalytic measurements are scored. On a
//  released or refolded structure a free residue takes its C-beta from
//  the scaffolder's own bisector guess, so a side-chain measurement
//  there reports the guess and not the chemistry. evaluate() therefore
//  measures the geometry list on the DESIGN, where every motif residue
//  carries the motif's own C-beta. The list is then a check that the
//  site was really built, and the pin release is the check of whether
//  the site can hold.
//
//  COST. evaluate() takes 57 to 134 ms for a design of 123 to 196
//  residues, measured in Node 24. Most of it is the two pin-release runs
//  and the one refold from noise. For a campaign of many designs, pass
//  { fromNoise: false, releaseSeeds: 1 } and the cost falls by about
//  half.
//
//  Units are angstroms, degrees and percent. Nothing here is a number
//  from the preprint.
//
//  EXPORTS   (grep -n "<anchor>" metrics.js)
//    the evaluator ...... "export function evaluate"
//    funnel steps ....... "export const FILTERS"
//    funnel counts ...... "export function funnel"
//    family scaling ..... "export const SCORING"
//    the pin release .... "export function pinRelease"
//    the refold ......... "export function refold"
//    one comparison ..... "export function compareToDesign"
//    superposition ...... "export function kabsch"
//    apply a fit ........ "export function applyFit"
//    plain rmsd ......... "export function rmsdOver"
//    TM-score ........... "export function tmScore"
//    side-chain rebuild . "export function rebuildMotifAtoms"
//    motif pin check .... "export function motifHeldRmsd"
//    ligand burial ...... "export function ligandBurial"
//    ligand clashes ..... "export function ligandClashes"
//    contact order ...... "export function contactOrder"
//    site support ....... "export function motifSupport"
//
//  INTERNAL   (grep -n "<anchor>" metrics.js)
//    eigen of a matrix .. "function jacobiSym"
//    burial directions .. "const BURY_DIRS"
// ============================================================================

import { scaffold, classifySS, traceStats, DEFAULTS } from './scaffold.js';
import { predictSS } from './sequence.js';
import { measure } from './motif.js';

// ---------------------------------------------------------------------------
//  scaling: a number into a 0 to 1 score
// ---------------------------------------------------------------------------

// Every family score is 0 to 1 and higher is better. These are the
// break points. They are the toy's own range, measured on the toy's own
// designs, and they are not the real pipeline's thresholds.
export const SCORING = {
  motifRmsd: { good: 3.0, bad: 11.0 },       // A, motif C-alpha after the pin release
  heldRmsd: { good: 0.1, bad: 1.5 },         // A, the pin check itself
  ligandRmsd: { good: 1.0, bad: 8.0 },       // A, pocket-aligned ligand
  clashPct: { good: 0, bad: 25 },            // percent of ligand atoms
  buried: { bad: 0.70, good: 0.98 },         // share of directions blocked
  support: { bad: 11, good: 26 },            // neighbours per motif residue
  rgRatio: { width: 0.22 },                  // against the target
  ssOrder: { bad: 0.35, good: 0.72 },        // share of helix plus strand
  contactOrder: { lo: 0.10, hi: 0.24 },      // relative contact order band
  tm: { bad: 0.40, good: 0.72 },             // TM after the pin release
  scRmsd: { good: 2.0, bad: 8.0 },           // A, C-alpha after the pin release
  families: { motif: 0.32, pocket: 0.20, fold: 0.18, selfConsistency: 0.30 },
};

const clip01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// A falling score: 1 at good, 0 at bad.
const down = (v, { good, bad }) => clip01((bad - v) / (bad - good));
// A rising score: 0 at bad, 1 at good.
const up = (v, { bad, good }) => clip01((v - bad) / (good - bad));
// A band score: 1 inside lo to hi, falling outside it.
const band = (v, { lo, hi }) => {
  if (v >= lo && v <= hi) return 1;
  const w = (hi - lo) * 0.6;
  return clip01(1 - (v < lo ? lo - v : v - hi) / w);
};

// ---------------------------------------------------------------------------
//  superposition
// ---------------------------------------------------------------------------

// Eigenvalues and eigenvectors of a symmetric matrix, by cyclic Jacobi
// rotation. a is row-major and is not changed. Returns
// { values: [n], vectors: [n][n] }, where vectors[k] is the eigenvector
// of values[k].
function jacobiSym(a, n) {
  const m = Float64Array.from(a);
  const v = new Float64Array(n * n);
  for (let i = 0; i < n; i++) v[i * n + i] = 1;
  for (let sweep = 0; sweep < 64; sweep++) {
    let off = 0;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) off += m[p * n + q] * m[p * n + q];
    if (off < 1e-24) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = m[p * n + q];
        if (Math.abs(apq) < 1e-18) continue;
        const theta = (m[q * n + q] - m[p * n + p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = m[k * n + p], akq = m[k * n + q];
          m[k * n + p] = c * akp - s * akq;
          m[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = m[p * n + k], aqk = m[q * n + k];
          m[p * n + k] = c * apk - s * aqk;
          m[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k * n + p], vkq = v[k * n + q];
          v[k * n + p] = c * vkp - s * vkq;
          v[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const values = [], vectors = [];
  for (let k = 0; k < n; k++) {
    values.push(m[k * n + k]);
    const col = new Float64Array(n);
    for (let i = 0; i < n; i++) col[i] = v[i * n + k];
    vectors.push(col);
  }
  return { values, vectors };
}

// The rigid transform that puts mob on ref with the least squared
// distance. Both arrays hold n*3 coordinates. idx is an optional list of
// residue indices to fit on; the default is every residue.
//   The rotation comes from the largest eigenvector of the 4 by 4
//   quaternion matrix of the correlation. That route always gives a
//   proper rotation, so a structure is never turned into its mirror.
// Returns { R, cMob, cRef, rmsd, count }.
//   R is row-major 3 by 3, and the map is  out = R * (p - cMob) + cRef.
export function kabsch(mob, ref, idx = null) {
  const count = idx ? idx.length : Math.floor(mob.length / 3);
  if (count < 1) throw new Error('kabsch needs at least one point');
  const at = (q) => (idx ? idx[q] : q);
  let ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0;
  for (let q = 0; q < count; q++) {
    const k = at(q) * 3;
    ax += mob[k]; ay += mob[k + 1]; az += mob[k + 2];
    bx += ref[k]; by += ref[k + 1]; bz += ref[k + 2];
  }
  ax /= count; ay /= count; az /= count;
  bx /= count; by /= count; bz /= count;
  let Sxx = 0, Sxy = 0, Sxz = 0, Syx = 0, Syy = 0, Syz = 0, Szx = 0, Szy = 0, Szz = 0;
  let g = 0;
  for (let q = 0; q < count; q++) {
    const k = at(q) * 3;
    const px = mob[k] - ax, py = mob[k + 1] - ay, pz = mob[k + 2] - az;
    const qx = ref[k] - bx, qy = ref[k + 1] - by, qz = ref[k + 2] - bz;
    Sxx += px * qx; Sxy += px * qy; Sxz += px * qz;
    Syx += py * qx; Syy += py * qy; Syz += py * qz;
    Szx += pz * qx; Szy += pz * qy; Szz += pz * qz;
    g += px * px + py * py + pz * pz + qx * qx + qy * qy + qz * qz;
  }
  const N = [
    Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx,
    Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz,
    Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy,
    Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz,
  ];
  const { values, vectors } = jacobiSym(N, 4);
  let top = 0;
  for (let k = 1; k < 4; k++) if (values[k] > values[top]) top = k;
  const e = vectors[top];
  let w = e[0], x = e[1], y = e[2], z = e[3];
  const nrm = Math.hypot(w, x, y, z) || 1;
  w /= nrm; x /= nrm; y /= nrm; z /= nrm;
  const R = new Float64Array([
    w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z,
  ]);
  // The residual follows from the trace, but a direct sum is safer and
  // the cost is the same order.
  let s2 = 0;
  for (let q = 0; q < count; q++) {
    const k = at(q) * 3;
    const px = mob[k] - ax, py = mob[k + 1] - ay, pz = mob[k + 2] - az;
    const rx = R[0] * px + R[1] * py + R[2] * pz;
    const ry = R[3] * px + R[4] * py + R[5] * pz;
    const rz = R[6] * px + R[7] * py + R[8] * pz;
    const dx = rx - (ref[k] - bx), dy = ry - (ref[k + 1] - by), dz = rz - (ref[k + 2] - bz);
    s2 += dx * dx + dy * dy + dz * dz;
  }
  void g;
  return { R, cMob: [ax, ay, az], cRef: [bx, by, bz], rmsd: Math.sqrt(s2 / count), count };
}

// Move a coordinate array through a fit. Returns a new Float32Array.
export function applyFit(fit, src, n = Math.floor(src.length / 3)) {
  const { R, cMob, cRef } = fit;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = i * 3;
    const px = src[k] - cMob[0], py = src[k + 1] - cMob[1], pz = src[k + 2] - cMob[2];
    out[k] = R[0] * px + R[1] * py + R[2] * pz + cRef[0];
    out[k + 1] = R[3] * px + R[4] * py + R[5] * pz + cRef[1];
    out[k + 2] = R[6] * px + R[7] * py + R[8] * pz + cRef[2];
  }
  return out;
}

// Root mean square distance between two coordinate arrays, with no fit.
// idx is an optional list of indices.
export function rmsdOver(a, b, idx = null) {
  const count = idx ? idx.length : Math.floor(a.length / 3);
  if (!count) return 0;
  let s = 0;
  for (let q = 0; q < count; q++) {
    const k = (idx ? idx[q] : q) * 3;
    const dx = a[k] - b[k], dy = a[k + 1] - b[k + 1], dz = a[k + 2] - b[k + 2];
    s += dx * dx + dy * dy + dz * dz;
  }
  return Math.sqrt(s / count);
}

// ---------------------------------------------------------------------------
//  TM-score
// ---------------------------------------------------------------------------

// TM-score of two traces of the same length, residue i against residue i.
//   TM = max over superpositions of  (1/L) * sum 1 / (1 + (di/d0)^2)
//   d0 = 1.24 * (L - 15)^(1/3) - 1.8, and never below 0.5
// The maximum is searched the way TM-score itself searches it: fit on a
// seed fragment, keep the residues that came close, fit again, repeat.
// Returns { tm, d0, fit, aligned, coverage }.
//   coverage is the share of residues inside d0 of their partner.
export function tmScore(mob, ref, n = Math.floor(mob.length / 3)) {
  if (n < 3) throw new Error('tmScore needs at least three residues');
  const d0 = Math.max(0.5, 1.24 * Math.cbrt(Math.max(1, n - 15)) - 1.8);
  const d02 = d0 * d0;
  let best = { tm: -1, fit: null };
  const d2 = new Float64Array(n);
  const seeds = [];
  for (let L = n; L >= 4; L = Math.floor(L / 2)) seeds.push(L);
  if (seeds[seeds.length - 1] !== 4 && n >= 4) seeds.push(4);
  for (const L of seeds) {
    const stride = L >= 16 ? Math.max(1, Math.floor(L / 4)) : 1;
    for (let start = 0; start + L <= n; start += stride) {
      let sel = [];
      for (let k = 0; k < L; k++) sel.push(start + k);
      let last = '';
      for (let it = 0; it < 24; it++) {
        if (sel.length < 3) break;
        const fit = kabsch(mob, ref, sel);
        const { R, cMob, cRef } = fit;
        let sum = 0;
        for (let i = 0; i < n; i++) {
          const k = i * 3;
          const px = mob[k] - cMob[0], py = mob[k + 1] - cMob[1], pz = mob[k + 2] - cMob[2];
          const ox = R[0] * px + R[1] * py + R[2] * pz + cRef[0] - ref[k];
          const oy = R[3] * px + R[4] * py + R[5] * pz + cRef[1] - ref[k + 1];
          const oz = R[6] * px + R[7] * py + R[8] * pz + cRef[2] - ref[k + 2];
          d2[i] = ox * ox + oy * oy + oz * oz;
          sum += 1 / (1 + d2[i] / d02);
        }
        const tm = sum / n;
        if (tm > best.tm) best = { tm, fit };
        // Keep the residues that came close, and widen the cut-off until
        // at least three of them did.
        let cut = d0 + 1.0, next = null;
        for (;;) {
          next = [];
          const c2 = cut * cut;
          for (let i = 0; i < n; i++) if (d2[i] < c2) next.push(i);
          if (next.length >= 3 || cut > 80) break;
          cut += 0.5;
        }
        const key = next.length + ':' + next[0] + ':' + next[next.length - 1];
        if (key === last) break;
        last = key; sel = next;
      }
    }
  }
  const aligned = applyFit(best.fit, mob, n);
  let near = 0;
  for (let i = 0; i < n; i++) {
    const k = i * 3;
    const dx = aligned[k] - ref[k], dy = aligned[k + 1] - ref[k + 1], dz = aligned[k + 2] - ref[k + 2];
    if (dx * dx + dy * dy + dz * dz < d02) near++;
  }
  return { tm: best.tm, d0, fit: best.fit, aligned, coverage: near / n };
}

// ---------------------------------------------------------------------------
//  side chains on a trace
// ---------------------------------------------------------------------------

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const L = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / L, a[1] / L, a[2] / L]; };

// The frame of one residue: its C-alpha, its C-beta and the direction to
// the ligand centre. All three exist in a motif residue and in a design
// residue, so the same construction works on both.
function residueFrame(ca, cb, ligC) {
  const e1 = norm3(sub3(cb, ca));
  let a = sub3(ligC, ca);
  let e2 = sub3(a, [e1[0] * dot3(a, e1), e1[1] * dot3(a, e1), e1[2] * dot3(a, e1)]);
  if (Math.hypot(e2[0], e2[1], e2[2]) < 0.2) {
    // The ligand lies on the C-alpha to C-beta line. Any axis across it
    // will do, and the choice must not depend on the structure.
    a = Math.abs(e1[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const p = dot3(a, e1);
    e2 = sub3(a, [e1[0] * p, e1[1] * p, e1[2] * p]);
  }
  e2 = norm3(e2);
  const e3 = cross3(e1, e2);
  return { o: ca, e1, e2, e3 };
}

const toLocal = (f, p) => { const d = sub3(p, f.o); return [dot3(d, f.e1), dot3(d, f.e2), dot3(d, f.e3)]; };
const toWorld = (f, l) => [
  f.o[0] + l[0] * f.e1[0] + l[1] * f.e2[0] + l[2] * f.e3[0],
  f.o[1] + l[0] * f.e1[1] + l[1] * f.e2[1] + l[2] * f.e3[1],
  f.o[2] + l[0] * f.e1[2] + l[1] * f.e2[2] + l[2] * f.e3[2],
];

// Centre of the ligand atoms of a design or a motif.
function ligandCentre(ligand) {
  const atoms = (ligand && ligand.atoms) || [];
  if (!atoms.length) throw new Error('the ligand has no atoms');
  let x = 0, y = 0, z = 0;
  for (const a of atoms) { x += a.x; y += a.y; z += a.z; }
  return [x / atoms.length, y / atoms.length, z / atoms.length];
}

// Put every catalytic side chain back on the design, rigidly, and return
// an object that motif.js measure() can read. Each residue gains
// `designIndex`, the residue of the chain it was rebuilt on, or -1 when
// the design does not carry that motif residue.
export function rebuildMotifAtoms(design, motif) {
  const ligC = ligandCentre(design.ligand || motif.ligand);
  const where = new Map();
  for (let i = 0; i < design.n; i++) {
    const m = design.motifId ? design.motifId[i] : -1;
    if (m >= 0 && !where.has(m)) where.set(m, i);
  }
  const residues = motif.residues.map((r, m) => {
    const i = where.has(m) ? where.get(m) : -1;
    if (i < 0) return { ...r, designIndex: -1, atoms: r.atoms.map((a) => ({ ...a })) };
    const mCa = [r.atoms.find((a) => a.name === 'CA'), r.atoms.find((a) => a.name === 'CB')];
    if (!mCa[0] || !mCa[1]) return { ...r, designIndex: i, atoms: r.atoms.map((a) => ({ ...a })) };
    const src = residueFrame([mCa[0].x, mCa[0].y, mCa[0].z], [mCa[1].x, mCa[1].y, mCa[1].z], ligC);
    const k = i * 3;
    const dst = residueFrame(
      [design.ca[k], design.ca[k + 1], design.ca[k + 2]],
      [design.cb[k], design.cb[k + 1], design.cb[k + 2]], ligC,
    );
    const atoms = r.atoms.map((a) => {
      const p = toWorld(dst, toLocal(src, [a.x, a.y, a.z]));
      return { ...a, x: p[0], y: p[1], z: p[2] };
    });
    return { ...r, designIndex: i, atoms };
  });
  return { id: motif.id, label: motif.label, residues, ligand: design.ligand || motif.ligand, geometry: motif.geometry };
}

// How far the design's own motif residues sit from the motif, in the
// frame the ligand fixes. A pinned design gives about zero. A design
// folded with the restraint off gives the width of the whole protein.
// Returns { rmsd, count } over the C-alpha and C-beta of every motif
// residue the design carries.
export function motifHeldRmsd(design, motif) {
  let s = 0, c = 0;
  const seen = new Set();
  for (let i = 0; i < design.n; i++) {
    const m = design.motifId ? design.motifId[i] : -1;
    if (m < 0 || seen.has(m)) continue;
    seen.add(m);
    const r = motif.residues[m];
    if (!r) continue;
    const ca = r.atoms.find((a) => a.name === 'CA'), cb = r.atoms.find((a) => a.name === 'CB');
    const k = i * 3;
    if (ca) { s += (design.ca[k] - ca.x) ** 2 + (design.ca[k + 1] - ca.y) ** 2 + (design.ca[k + 2] - ca.z) ** 2; c++; }
    if (cb) { s += (design.cb[k] - cb.x) ** 2 + (design.cb[k + 1] - cb.y) ** 2 + (design.cb[k + 2] - cb.z) ** 2; c++; }
  }
  return { rmsd: c ? Math.sqrt(s / c) : NaN, count: c };
}

// ---------------------------------------------------------------------------
//  pocket
// ---------------------------------------------------------------------------

// 128 directions spread evenly on a sphere, by the Fibonacci rule. The
// set is fixed, so burial is deterministic and needs no seed.
const BURY_DIRS = (() => {
  const K = 128, out = new Float64Array(K * 3);
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < K; i++) {
    const z = 1 - (2 * i + 1) / K;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const th = ga * i;
    out[i * 3] = r * Math.cos(th); out[i * 3 + 1] = r * Math.sin(th); out[i * 3 + 2] = z;
  }
  return out;
})();
const BURY_NEAR = 1.0;    // A, where a direction starts to look for the chain
const BURY_FAR = 26.0;    // A, where it stops
const BURY_WIDE = 4.6;    // A, how near the chain must pass the direction

// What share of the directions out of the ligand centre meet the chain.
// 1 means the ligand is enclosed and 0 means it is in the open.
export function ligandBurial(design) {
  const c = ligandCentre(design.ligand);
  const n = design.n, ca = design.ca;
  const K = BURY_DIRS.length / 3;
  let blocked = 0;
  const wide2 = BURY_WIDE * BURY_WIDE;
  for (let k = 0; k < K; k++) {
    const dx = BURY_DIRS[k * 3], dy = BURY_DIRS[k * 3 + 1], dz = BURY_DIRS[k * 3 + 2];
    let hit = false;
    for (let i = 0; i < n && !hit; i++) {
      const q = i * 3;
      const vx = ca[q] - c[0], vy = ca[q + 1] - c[1], vz = ca[q + 2] - c[2];
      const t = vx * dx + vy * dy + vz * dz;
      if (t < BURY_NEAR || t > BURY_FAR) continue;
      const px = vx - t * dx, py = vy - t * dy, pz = vz - t * dz;
      if (px * px + py * py + pz * pz < wide2) hit = true;
    }
    if (hit) blocked++;
  }
  return blocked / K;
}

// Ligand atoms that the chain runs into.
//   cut is the C-alpha to ligand distance that counts as a clash.
// The real metric percent_ligand_bb_clashes_1_5 uses every backbone atom
// at 1.5 A. A trace carries one point per residue, so the cut here is
// larger and stands for the whole backbone.
// Returns { pct, count, worst, pocket: [residue indices within 10 A] }.
export function ligandClashes(design, cut = 3.6) {
  const atoms = (design.ligand && design.ligand.atoms) || [];
  const n = design.n, ca = design.ca;
  let bad = 0, worst = Infinity;
  const pocket = [];
  const near = new Float64Array(n).fill(Infinity);
  for (const [, a] of atoms.entries()) {
    let min = Infinity;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const d = Math.hypot(ca[k] - a.x, ca[k + 1] - a.y, ca[k + 2] - a.z);
      if (d < min) min = d;
      if (d < near[i]) near[i] = d;
    }
    if (min < worst) worst = min;
    if (min < cut) bad++;
  }
  for (let i = 0; i < n; i++) if (near[i] < 10.0) pocket.push(i);
  return { pct: atoms.length ? (100 * bad) / atoms.length : 0, count: bad, worst, pocket, cut };
}

// ---------------------------------------------------------------------------
//  fold shape
// ---------------------------------------------------------------------------

// Relative contact order: the mean sequence separation of the contacts,
// divided by the chain length. A low number means a local fold and a
// high number means a fold that reaches across itself. Contacts are
// C-alpha pairs inside `cut` with at least three residues between them.
export function contactOrder(design, cut = 8.0) {
  const n = design.n, ca = design.ca, cut2 = cut * cut;
  let sum = 0, count = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 3; j < n; j++) {
      const a = i * 3, b = j * 3;
      const dx = ca[b] - ca[a], dy = ca[b + 1] - ca[a + 1], dz = ca[b + 2] - ca[a + 2];
      if (dx * dx + dy * dy + dz * dz > cut2) continue;
      sum += j - i; count++;
    }
  }
  return { relative: count ? sum / (count * n) : 0, absolute: count ? sum / count : 0, contacts: count };
}

// How well the fold holds each catalytic residue. The count is the
// C-alpha points inside `cut` of a motif residue, with at least three
// residues between them. A catalytic residue in a pocket has many; one
// on the surface has few, and a site on the surface cannot hold a
// substrate still.
// Returns { mean, min, per: [{ index, count }] }.
export function motifSupport(design, cut = 10.0) {
  const n = design.n, ca = design.ca, cut2 = cut * cut;
  const per = [];
  for (let i = 0; i < n; i++) {
    if (!design.fixed || !design.fixed[i]) continue;
    let count = 0;
    for (let j = 0; j < n; j++) {
      if (Math.abs(i - j) < 3) continue;
      const a = i * 3, b = j * 3;
      const dx = ca[b] - ca[a], dy = ca[b + 1] - ca[a + 1], dz = ca[b + 2] - ca[a + 2];
      if (dx * dx + dy * dy + dz * dz < cut2) count++;
    }
    per.push({ index: i, count });
  }
  if (!per.length) return { mean: 0, min: 0, per };
  let s = 0, min = Infinity;
  for (const p of per) { s += p.count; if (p.count < min) min = p.count; }
  return { mean: s / per.length, min, per };
}

// ---------------------------------------------------------------------------
//  the two checks that run the scaffolder again
// ---------------------------------------------------------------------------

// Build a parent that the scaffolder will treat as a free chain. Nothing
// is held, so the motif restraint does nothing.
function freeParent(design, latent) {
  const n = design.n;
  return {
    n, ca: design.ca, cb: design.cb,
    fixed: new Uint8Array(n),
    motifId: new Int32Array(n).fill(-1),
    seq: design.seq, ss: design.ss, ligand: design.ligand,
    meta: { motifStr: (design.meta && design.meta.motifStr) || null, segs: [], ssLatent: latent, ssPairs: [] },
  };
}

// Put the design's own labels back on a structure the scaffolder made
// from a free parent, so the metrics can find the motif residues again.
// The structure did NOT hold them, and meta says so.
function relabel(out, design) {
  out.fixed = design.fixed;
  out.motifId = design.motifId;
  out.meta.motifHeld = false;
  return out;
}

// CHECK 1, THE PIN RELEASE. Take the design, let go of the catalytic
// residues, and relax. The pin is off, so the chain pulls the site
// wherever its own restraints want it. A design whose pocket really
// cradles the motif hardly moves. A design that only looked right
// because the scaffolder nailed the residues down springs apart, and
// the motif C-alpha RMSD says by how much.
//   release  how far up the noise schedule to restart, 0 to 1. The
//            default 0.10 is about 0.12 A of noise, so the drift that
//            follows is relaxation and not noise.
//   seeds    how many runs; the lowest-drift run is the one reported,
//            because the question is whether the site CAN hold.
// Returns { designs, best, ms, latent }.
export function pinRelease(design, motif, opts = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const { seed = 101, seeds = 2, release = 0.10 } = opts;
  if (!(release > 0) || release > 1) throw new Error(`release must be above 0 and at most 1, got ${release}`);
  const steps = (design.meta && design.meta.steps) || DEFAULTS.steps;
  const seq = typeof design.seq === 'string' ? design.seq : 'X'.repeat(design.n);
  const latent = /[^X]/.test(seq) ? predictSS(seq) : design.ss;
  const designs = [];
  for (let k = 0; k < seeds; k++) {
    const run = scaffold({
      motif, seed: (seed + k) >>> 0, steps,
      partial: { parent: freeParent(design, latent), stepsBack: Math.max(1, Math.round(release * steps)) },
      keepTrajectory: false,
    });
    run.design.seq = seq;
    designs.push(relabel(run.design, design));
  }
  const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  return { designs, latent, ms: t1 - t0 };
}

// CHECK 2, THE REFOLD FROM NOISE. This is the check the contract asks
// for: take the sequence alone and fold it again from noise, with the
// motif restraint off, the way the real pipeline asks AlphaFold 3 for a
// structure of the sequence.
//
// MEASURED RESULT, AND IT IS A FAILURE WORTH REPORTING. On this page the
// check carries no signal. Over three motifs and several seeds the
// TM-score sits near 0.20 whatever sequence goes in, and feeding the
// design's own measured structure state as the latent does not raise it.
// The reason is plain: AlphaFold 3 learned how a sequence folds, and our
// denoiser did not. It knows bond lengths, clashes, compaction and a
// structure state, and none of those fixes which helix packs against
// which. Two unrelated compact chains of the same length score about
// 0.2, so that is what comes back.
//
// The function stays, and evaluate() reports its number with
// `informative: false`, because the page teaches the difference between
// a learned model and a restraint model. The score that ranks designs is
// the pin release above.
// Returns { designs, latent, fromSequence, ms }.
export function refold(design, motif, opts = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const { seed = 211, seeds = 1 } = opts;
  const n = design.n;
  const steps = opts.steps || Math.min(DEFAULTS.steps, (design.meta && design.meta.steps) || DEFAULTS.steps);
  const seq = typeof design.seq === 'string' ? design.seq : 'X'.repeat(n);
  const fromSequence = (seq.match(/X/g) || []).length < n * 0.5;
  const latent = fromSequence ? predictSS(seq) : null;
  const designs = [];
  for (let k = 0; k < seeds; k++) {
    // stepsBack equal to steps puts the restart at the top of the
    // schedule, so the run starts from noise and not from the parent.
    const run = scaffold({
      motif, seed: (seed + k) >>> 0, steps,
      partial: { parent: freeParent(design, latent), stepsBack: steps },
      keepTrajectory: false,
    });
    run.design.seq = seq;
    run.design.meta.refold = true;
    designs.push(relabel(run.design, design));
  }
  const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  return { designs, latent, fromSequence, ms: t1 - t0 };
}

// Compare a structure the scaffolder made with the design it came from.
//   rmsd       C-alpha RMSD after the best global fit
//   tm         TM-score, with its own best fit
//   motifRmsd  the motif C-alpha, after the global fit. C-beta is left
//              out on purpose: a free residue takes its C-beta from the
//              scaffolder's bisector guess, so a C-beta term would
//              measure that guess and not the drift.
//   ligandRmsd how far the fixed ligand moves when the pocket backbone
//              of the other structure is put on the pocket backbone of
//              the design. The ligand sits at the same coordinates in
//              both, so the number is the drift of the pocket itself.
export function compareToDesign(design, other, pocketIdx = []) {
  const n = design.n;
  const tm = tmScore(other.ca, design.ca, n);
  const fit = kabsch(other.ca, design.ca, null);
  const fittedCa = applyFit(fit, other.ca, n);
  const idx = [];
  for (let i = 0; i < n; i++) if (design.fixed && design.fixed[i]) idx.push(i);
  let motifRmsd = NaN;
  if (idx.length) motifRmsd = rmsdOver(fittedCa, design.ca, idx);
  let ligandRmsd = NaN;
  if (pocketIdx.length >= 3) {
    const pf = kabsch(other.ca, design.ca, pocketIdx);
    const atoms = (design.ligand && design.ligand.atoms) || [];
    if (atoms.length) {
      const src = new Float32Array(atoms.length * 3);
      atoms.forEach((a, q) => { src[q * 3] = a.x; src[q * 3 + 1] = a.y; src[q * 3 + 2] = a.z; });
      ligandRmsd = rmsdOver(applyFit(pf, src, atoms.length), src);
    }
  }
  return { rmsd: fit.rmsd, tm: tm.tm, coverage: tm.coverage, d0: tm.d0, motifRmsd, ligandRmsd };
}

// ---------------------------------------------------------------------------
//  the evaluator
// ---------------------------------------------------------------------------

// Score one design.
//   design  a Design from scaffold.js, with a sequence if one was made
//   motif   the built motif the design was grown around
//   opts = { seed, selfConsistency = true, release = 0.10,
//            releaseSeeds = 2, fromNoise = true, fromNoiseSeeds = 1,
//            releaseDesign = null, clashCut = 3.6 }
//     releaseDesign  a structure to use instead of running the pin
//                    release. Pass the design itself to see what a
//                    perfect score looks like.
// Returns { metrics, families, overall, pass, failed, ms, extra }.
export function evaluate(design, motif, opts = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (!design || !Number.isInteger(design.n)) throw new Error('evaluate needs a design');
  if (!motif || !Array.isArray(motif.residues)) throw new Error('evaluate needs a built motif');
  const {
    seed = 101, selfConsistency = true, release = 0.10, releaseSeeds = 2,
    fromNoise = true, fromNoiseSeeds = 1, releaseDesign = null, clashCut = 3.6,
  } = opts;
  const n = design.n;

  // --- the design on its own -------------------------------------------
  const st = traceStats(design.ca, n);
  const rgTarget = (design.meta && design.meta.rgTarget) || DEFAULTS.rgCoef * Math.pow(n, DEFAULTS.rgExp);
  const ss = classifySS(design.ca, n);
  const hN = (ss.match(/H/g) || []).length, eN = (ss.match(/E/g) || []).length;
  const ssFraction = { H: hN / n, E: eN / n, L: (n - hN - eN) / n };
  const clash = ligandClashes(design, clashCut);
  const buried = ligandBurial(design);
  const co = contactOrder(design);
  const held = motifHeldRmsd(design, motif);
  const support = motifSupport(design);

  // --- the catalytic measurements --------------------------------------
  // They are measured on the DESIGN, where every motif residue carries
  // the motif's own C-beta, so the rebuild is exact. On a released or
  // refolded structure the C-beta is the scaffolder's bisector guess,
  // and a side-chain measurement on it would report that guess.
  const rebuilt = rebuildMotifAtoms(design, motif);
  const geometry = (motif.geometry || []).map((e) => {
    let value = NaN;
    try { value = measure(rebuilt, e); } catch { value = NaN; }
    const off = Math.abs(value - e.ideal);
    return {
      label: e.label, kind: e.kind, ideal: e.ideal, tol: e.tol, why: e.why,
      value, off, pass: Number.isFinite(value) && off <= e.tol, on: 'design',
    };
  });
  const geomPass = geometry.length ? geometry.filter((g) => g.pass).length / geometry.length : 1;

  // --- check 1: the pin release ----------------------------------------
  let rel = { rmsd: NaN, tm: NaN, coverage: NaN, motifRmsd: NaN, ligandRmsd: NaN };
  let relAll = [], relOut = null, relBest = null;
  if (releaseDesign) {
    rel = compareToDesign(design, releaseDesign, clash.pocket);
    relAll = [rel]; relBest = releaseDesign;
  } else if (selfConsistency) {
    relOut = pinRelease(design, motif, { seed, seeds: releaseSeeds, release });
    relAll = relOut.designs.map((d) => compareToDesign(design, d, clash.pocket));
    // The site that drifts least is the answer to "can it hold at all".
    let bi = 0;
    for (let k = 1; k < relAll.length; k++) if (relAll[k].motifRmsd < relAll[bi].motifRmsd) bi = k;
    rel = relAll[bi]; relBest = relOut.designs[bi];
  }

  // --- check 2: the refold from noise ----------------------------------
  let noise = null, noiseBest = null;
  if (fromNoise && !releaseDesign && selfConsistency) {
    const out = refold(design, motif, { seed: seed + 110, seeds: fromNoiseSeeds });
    const cmp = out.designs.map((d) => compareToDesign(design, d, clash.pocket));
    let bi = 0;
    for (let k = 1; k < cmp.length; k++) if (cmp[k].tm > cmp[bi].tm) bi = k;
    noiseBest = out.designs[bi];
    noise = {
      rmsd: cmp[bi].rmsd, tm: cmp[bi].tm, coverage: cmp[bi].coverage,
      fromSequence: out.fromSequence, informative: false,
      note: 'A restraint denoiser has no learned map from a sequence to a fold, so this score stays near the value of two unrelated chains of the same length. The real pipeline asks AlphaFold 3, which learned that map.',
      ms: out.ms,
    };
  } else if (releaseDesign) {
    noise = null;
  }

  // --- the metric record -----------------------------------------------
  const metrics = {
    motifRmsd: rel.motifRmsd,
    motifHeldRmsd: held.rmsd,
    ligandClashPct: clash.pct,
    ligandBuried: buried,
    ligandRmsd: rel.ligandRmsd,
    rg: st.rg,
    rgTarget,
    ssFraction,
    contactOrder: co.relative,
    motifSupport: support.mean,
    geometry,
    // The contract's key. In this lab the number comes from the pin
    // release, because the refold from noise carries no signal. `mode`
    // says which check produced it, and `fromNoise` carries the other.
    selfConsistency: {
      rmsd: rel.rmsd, tm: rel.tm, coverage: rel.coverage,
      motifRmsd: rel.motifRmsd, mode: releaseDesign ? 'supplied' : 'pin-release',
      release,
    },
    fromNoise: noise,
  };

  // --- the four families ------------------------------------------------
  const families = {
    motif: Number.isFinite(rel.motifRmsd)
      ? 0.55 * down(rel.motifRmsd, SCORING.motifRmsd) + 0.30 * geomPass + 0.15 * down(held.rmsd, SCORING.heldRmsd)
      : 0.70 * geomPass + 0.30 * down(held.rmsd, SCORING.heldRmsd),
    pocket: 0.35 * down(clash.pct, SCORING.clashPct)
      + 0.30 * up(buried, SCORING.buried)
      + 0.20 * up(support.mean, SCORING.support)
      + 0.15 * (Number.isFinite(rel.ligandRmsd) ? down(rel.ligandRmsd, SCORING.ligandRmsd) : 0.5),
    fold: (
      Math.exp(-1 * (((st.rg / rgTarget) - 1) / SCORING.rgRatio.width) ** 2)
      + up(ssFraction.H + ssFraction.E, SCORING.ssOrder)
      + band(co.relative, SCORING.contactOrder)
      + (st.worstClash >= DEFAULTS.clash - 0.15 && st.bondMin > 2.9 && st.bondMax < 4.7 ? 1 : 0)
    ) / 4,
    selfConsistency: Number.isFinite(rel.tm)
      ? 0.6 * up(rel.tm, SCORING.tm) + 0.4 * down(rel.rmsd, SCORING.scRmsd)
      : NaN,
  };
  const wts = SCORING.families;
  let acc = 0, wsum = 0;
  for (const k of Object.keys(wts)) {
    if (!Number.isFinite(families[k])) continue;
    acc += wts[k] * clip01(families[k]); wsum += wts[k];
  }
  const overall = wsum ? acc / wsum : 0;

  const result = {
    metrics, families, overall, pass: true, failed: [], ms: 0,
    extra: {
      n, geomPass,
      bondMin: st.bondMin, bondMax: st.bondMax, worstClash: st.worstClash,
      pocketSize: clash.pocket.length, ligandWorst: clash.worst,
      contacts: co.contacts, supportMin: support.min, support: support.per,
      ss, releaseLatent: relOut ? relOut.latent : null,
      releaseAll: relAll.map((x) => ({ tm: x.tm, rmsd: x.rmsd, motifRmsd: x.motifRmsd })),
      releaseMs: relOut ? relOut.ms : 0,
      releaseDesign: relBest, fromNoiseDesign: noiseBest,
      simulated: true,
    },
  };
  const failed = FILTERS.filter((f) => !f.test(result)).map((f) => f.key);
  result.failed = failed;
  result.pass = failed.length === 0;
  const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  result.ms = t1 - t0;
  return result;
}

// ---------------------------------------------------------------------------
//  the campaign funnel
// ---------------------------------------------------------------------------

// The funnel steps, cheapest first. A campaign runs many designs and
// counts how many survive each step, which is what the page draws. Every
// `test` reads the record that evaluate() returns.
//
// The thresholds were set from a survey of 48 designs of the three
// motifs, so each step cuts a real share and the funnel narrows. They
// are the lab's own numbers. The preprint gives no threshold and no
// success rate, so none is used here.
export const FILTERS = [
  {
    key: 'chain', label: 'A legal chain',
    test: (r) => r.extra.bondMin > 2.9 && r.extra.bondMax < 4.7
      && r.extra.worstClash >= DEFAULTS.clash - 0.15,
    why: 'The bonds are near 3.8 A and no two distant residues sit on top of each other. A design that fails here is not a protein shape at all.',
  },
  {
    key: 'site', label: 'Motif placed',
    test: (r) => r.extra.geomPass >= 0.90 && r.metrics.motifHeldRmsd <= 0.50,
    why: 'Every catalytic measurement is inside its tolerance and the held residues really sit on the motif. This step catches a design whose site was never built, not one whose site is weak.',
  },
  {
    key: 'fold', label: 'Protein-like fold',
    test: (r) => Math.abs(r.metrics.rg / r.metrics.rgTarget - 1) <= 0.25
      && (r.metrics.ssFraction.H + r.metrics.ssFraction.E) >= 0.50
      && r.metrics.contactOrder >= 0.08 && r.metrics.contactOrder <= 0.30,
    why: 'The chain is as compact as a real protein of its length, half of it is helix or strand, and its contacts reach across the fold instead of only along the chain.',
  },
  {
    key: 'pocket', label: 'Ligand enclosed',
    test: (r) => r.metrics.ligandClashPct === 0 && r.metrics.ligandBuried >= 0.93,
    why: 'The chain does not run through the ligand, and almost every direction out of the ligand meets the protein. A substrate on the surface cannot be held still.',
  },
  {
    key: 'support', label: 'Site inside the fold',
    test: (r) => r.metrics.motifSupport >= 17,
    why: 'Each catalytic residue has at least seventeen other residues around it. A site with few neighbours sits on the surface, where nothing holds its shape.',
  },
  {
    key: 'selfConsistent', label: 'Site holds with the pin off',
    test: (r) => Number.isFinite(r.metrics.selfConsistency.motifRmsd)
      && r.metrics.selfConsistency.motifRmsd <= 6.0
      && r.metrics.selfConsistency.tm >= 0.55,
    why: 'With the motif restraint switched off, the catalytic residues stay near where they were drawn and the fold stays recognisable. This is the step a design fails when the scaffolder was the only thing holding the site together, and it is the lab’s stand-in for the AlphaFold 3 check the real pipeline runs.',
  },
];

// Count how many designs survive each funnel step, in order. `results`
// is a list of records from evaluate(). Returns
// { steps: [{ key, label, why, kept, lost, of }], survivors, started, kept }.
export function funnel(results) {
  let live = results.slice();
  const started = live.length;
  const steps = [];
  for (const f of FILTERS) {
    const before = live.length;
    live = live.filter((r) => f.test(r));
    steps.push({ key: f.key, label: f.label, why: f.why, kept: live.length, lost: before - live.length, of: before });
  }
  return { steps, survivors: live, started, kept: live.length };
}
