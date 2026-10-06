// ============================================================================
//  SCAFFOLD  ·  reverse diffusion that grows a chain around a motif
// ----------------------------------------------------------------------------
//  This module is the core of the lab. It starts from a cloud of noise and
//  ends with a folded, compact, protein-like C-alpha trace. The catalytic
//  motif stays where the chemistry needs it, and the ligand ends up inside
//  a pocket. No DOM, so Node can import it.
//
//  IT IS NOT AlphaProtein Novo. The real pipeline runs a learned diffusion
//  model. This module runs a hand-written denoiser: a set of geometric
//  restraints that pull a noisy trace toward protein-like shape. Every card
//  that shows an output of this module must say that the result is a
//  simulation.
//
//  THE LOOP. One step of the reverse process does two things:
//    1. predict a clean structure - relax the current trace with the
//       restraints below, which stands in for the network prediction,
//    2. add noise again, scaled by the next point of the schedule.
//  The schedule falls from sigmaMax to sigmaMin, so the early steps are a
//  search and the late steps are a refinement. Fixed residues take no
//  noise.
//
//  THE RESTRAINTS.
//    bond ....... consecutive C-alpha at 3.80 A
//    angle ...... the C-alpha(i-1), C-alpha(i), C-alpha(i+1) angle inside
//                 about 80 to 150 degrees, held as a limit on the i to i+2
//                 distance
//    clash ...... non-neighbouring C-alpha at least 4.00 A apart
//    ligand ..... no C-alpha closer than 4.50 A to a ligand atom
//    compaction . radius of gyration toward 2.2 * n^0.38 A, with a soft
//                 shell at SHELL_K times that target that stops a helix
//                 from hanging outside the globule
//    pocket ..... the chain centre pulled onto the ligand centre, which
//                 buries the ligand instead of leaving it on the surface
//    chirality .. a helix must turn to the right. The signed volume of
//                 the C-alpha(i..i+3) step vectors is about +43 A^3 for an
//                 ideal right-handed helix and -43 for its mirror. Distance
//                 restraints alone cannot tell the two apart, so this
//                 restraint holds the volume positive.
//    structure .. a per-residue latent state, 'H', 'E' or 'L', that sets
//                 helix spacings (i+2 5.45 A, i+3 5.05 A, i+4 6.20 A) and
//                 strand spacings (i+2 6.70 A, i+3 10.00 A), with strand
//                 pairs held at 4.95 A so that hairpins close
//    motif ...... fixed residues pulled hard onto the motif coordinates
//  The latent structure state is sampled at the start. While the noise is
//  still high the module proposes new states and keeps a proposal only if
//  the energy falls. The count of kept proposals is Run.accepted.
//
//  TWO MORE FEATURES OF THE REAL PIPELINE.
//    partial diffusion - start from a parent design, not from noise. The
//      module noises the parent to the level of stepsBack / steps, then
//      runs the reverse from that point. Fewer steps back keeps the child
//      closer to the parent.
//    indexed and unindexed - indexed puts the motif at the sequence
//      positions motif_str gives. Unindexed draws several placements, runs
//      a short trial of each one, and keeps the placement with the lowest
//      energy.
//
//  EXPORTS   (grep -n "<anchor>" scaffold.js)
//    defaults ......... "export const DEFAULTS"
//    entry point ...... "export function scaffold"
//    motif targets .... "export function motifTargets"   (rejects a motif
//                       residue whose atoms carry no coordinate)
//    geometry read ..... "export function traceStats"
//    structure read ... "export function classifySS"
//
//  INTERNAL   (grep -n "<anchor>" scaffold.js)
//    restraint weights  "const W ="
//    one restraint ..... "function pull"
//    one relax sweep ... "function relax"
//    helix handedness .. "function chirSweep"
//    energy ............ "function energy"
//    latent sampler .... "function sampleSS"
//    the reverse loop .. "function runDiffusion"
//    chain layout ...... "function buildLayout"
//    C-beta builder .... "function buildCB"
// ============================================================================

import { rng, parseMotifStr, planChain, LIMITS } from './design.js';

export const DEFAULTS = {
  steps: 240,          // reverse steps of a full run
  relaxIters: 4,       // relax sweeps per reverse step
  polishIters: 40,     // noise-free sweeps after the loop
  finalIters: 12,      // last sweeps, hard geometry only
  sigmaMax: 10.0,      // A, noise at the start of the schedule
  sigmaMin: 0.02,      // A, noise at the end
  rho: 2.0,            // schedule curve; 2 spends more steps at low noise
  bond: 3.80,          // A, C-alpha to C-alpha
  d13Min: 4.95,        // A, from a 80 degree virtual angle
  d13Max: 7.25,        // A, from a 150 degree virtual angle
  clash: 4.00,         // A, non-neighbour C-alpha floor
  ligClash: 4.50,      // A, C-alpha to ligand atom floor
  rgCoef: 2.2,         // radius of gyration target, coefficient
  rgExp: 0.38,         // radius of gyration target, exponent
  helix: { d2: 5.45, d3: 5.05, d4: 6.20, chir: 36.0 },
  strand: { d2: 6.70, d3: 10.00, pair: 4.95 },
  anneal: { until: 0.55, every: 10, iters: 6 },
  unindexedTries: 6,   // placements drawn when unindexed is true
  trialSteps: 30,      // reverse steps of one unindexed trial
  maxFrames: 60,       // frames kept in the trajectory
  cbLen: 1.53,         // A, C-alpha to C-beta
};

// Restraint strengths. Each one is the share of the violation that a
// single sweep removes.
const W = {
  bond: 1.00, angle: 0.55, ss: 0.50, pair: 0.42, clash: 0.60,
  lig: 0.70, rg: 0.22, pocket: 0.16, motif: 0.90, chir: 0.45, shell: 0.30,
};
// The most one chirality sweep may move a C-alpha point, in angstroms.
// Without a cap the step would break the bonds, because the signed volume
// is strongly curved.
const CHIR_CAP = 0.55;
// A structure restraint counts as met inside SS_SAT angstroms, and a met
// restraint is worth SS_REWARD of energy.
const SS_SAT = 0.65;
const SS_REWARD = 1.4;
// The soft shell radius, as a multiple of the target radius of gyration.
// A uniform ball of radius R has a radius of gyration of 0.775 R, so 1.55
// leaves room for a shape that is not a ball.
const SHELL_K = 1.55;

// Energy weights. The energy ranks latent states and placements, so only
// the ratios matter.
const EW = {
  bond: 4.0, angle: 1.5, ss: 1.0, pair: 1.0, clash: 3.0,
  lig: 3.0, rg: 0.6, pocket: 0.3, motif: 6.0, chir: 0.02,
};

const ALL = { bond: 1, angle: 1, ss: 1, chir: 1, clash: 1, lig: 1, rg: 1, pocket: 1, motif: 1 };
const HARD = { bond: 1, angle: 1, ss: 0, chir: 1, clash: 1, lig: 1, rg: 0, pocket: 0, motif: 1 };

// ---------------------------------------------------------------------------
//  small vector and random helpers
// ---------------------------------------------------------------------------

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a) => { const r = len3(a) || 1; return [a[0] / r, a[1] / r, a[2] / r]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// One normal sample from a uniform generator (Box-Muller).
function gauss(rand) {
  let u = rand();
  if (u < 1e-12) u = 1e-12;
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// A new independent generator, derived from an old one.
const forkRng = (rand) => rng((rand() * 4294967296) >>> 0);

const dist2 = (x, i, j) => {
  const a = i * 3, b = j * 3;
  const dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2];
  return dx * dx + dy * dy + dz * dz;
};
const distAt = (x, i, j) => Math.sqrt(dist2(x, i, j));

// ---------------------------------------------------------------------------
//  motif targets
// ---------------------------------------------------------------------------

// Read the C-alpha and C-beta point of every motif residue. A motif
// residue carries all-atom coordinates, but the design format holds a
// trace, so this function takes the two points the trace needs.
//   key is chain + resId, for example 'A1'.
// Returns Map(key -> { index, code, ca: [3], cb: [3] }).
export function motifTargets(motif) {
  const out = new Map();
  if (!motif || !Array.isArray(motif.residues)) throw new Error('motif has no residues array');
  const placed = (a) => !!a && Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);
  const centre = (list) => {
    let sx = 0, sy = 0, sz = 0;
    for (const a of list) { sx += a.x; sy += a.y; sz += a.z; }
    return [sx / list.length, sy / list.length, sz / list.length];
  };
  motif.residues.forEach((r, index) => {
    const all = r.atoms || [];
    const key = String(r.chain) + String(r.resId);
    if (!all.length) throw new Error(`motif residue ${key} has no atoms`);
    // An atom with no coordinate is not a placed atom. A motif that
    // carries one must fail here, with the residue named, and not later
    // as a chain full of NaN.
    const atoms = all.filter(placed);
    if (!atoms.length) throw new Error(`motif residue ${key} has no atom with a coordinate`);
    const byName = new Map(atoms.map((a) => [a.name, a]));
    let caV;
    const ca = byName.get('CA');
    if (ca) caV = [ca.x, ca.y, ca.z];
    else if (all.some((a) => a.name === 'CA')) {
      throw new Error(`motif residue ${key} has a CA atom with no coordinate`);
    } else caV = centre(atoms);   // no backbone atom: use the residue centre
    let cbV;
    const cb = byName.get('CB');
    if (cb) cbV = [cb.x, cb.y, cb.z];
    else {
      // Point the side chain at the atoms the chemistry needs held.
      const tip = (r.tip || []).map((nm) => byName.get(nm)).filter(placed);
      const src = tip.length ? tip : atoms;
      const dir = norm3(sub3(centre(src), caV));
      cbV = [caV[0] + dir[0] * DEFAULTS.cbLen, caV[1] + dir[1] * DEFAULTS.cbLen, caV[2] + dir[2] * DEFAULTS.cbLen];
    }
    if (![...caV, ...cbV].every(Number.isFinite)) throw new Error(`motif residue ${key} gives a C-alpha or C-beta point that is not finite`);
    const code = typeof r.code === 'string' && /^[ACDEFGHIKLMNPQRSTVWY]$/.test(r.code) ? r.code : 'X';
    out.set(String(r.chain) + String(r.resId), { index, code, ca: caV, cb: cbV });
  });
  return out;
}

// ---------------------------------------------------------------------------
//  chain layout
// ---------------------------------------------------------------------------

// Turn a parsed motif_str and a chain plan into a residue layout.
// Returns { n, fixed, motifId, segs }.
function buildLayout(parsed, plan, targets) {
  const n = plan.total;
  const fixed = new Uint8Array(n);
  const motifId = new Int32Array(n).fill(-1);
  const code = new Array(n).fill('X');
  const segs = [];
  let p = 0;
  parsed.chain.forEach((s, si) => {
    const start = p;
    const count = plan.lengths[si];
    if (s.kind === 'motif') {
      for (let k = 0; k < count; k++) {
        const key = s.chain + (s.from + k);
        const t = targets.get(key);
        if (!t) throw new Error(`motif_str asks for residue ${key}, but the motif has no such residue`);
        fixed[p] = 1; motifId[p] = t.index; code[p] = t.code; p++;
      }
      segs.push({ kind: 'motif', ref: s.chain + s.from + (s.to > s.from ? '-' + s.to : ''), start, end: p - 1, len: count });
    } else {
      p += count;
      segs.push({ kind: 'design', ref: null, start, end: p - 1, len: count });
    }
  });
  if (p !== n) throw new Error(`chain plan totals ${p} residues, not ${n}`);
  return { n, fixed, motifId, code, segs };
}

// ---------------------------------------------------------------------------
//  the restraint context
// ---------------------------------------------------------------------------

function buildCtx(layout, motif, targets, D) {
  const { n, fixed, motifId } = layout;
  const mob = new Float32Array(n);
  for (let i = 0; i < n; i++) mob[i] = fixed[i] ? 0.12 : 1.0;

  // Motif anchor points, one per fixed residue.
  const anchor = new Float32Array(n * 3);
  const byIndex = new Map();
  for (const t of targets.values()) byIndex.set(t.index, t);
  for (let i = 0; i < n; i++) {
    if (!fixed[i]) continue;
    const t = byIndex.get(motifId[i]);
    anchor[i * 3] = t.ca[0]; anchor[i * 3 + 1] = t.ca[1]; anchor[i * 3 + 2] = t.ca[2];
  }

  // Ligand atoms, their centre and their reach.
  const la = motif.ligand && Array.isArray(motif.ligand.atoms) ? motif.ligand.atoms : [];
  if (!la.length) throw new Error('motif has no ligand atoms');
  const lig = new Float32Array(la.length * 3);
  let cx = 0, cy = 0, cz = 0;
  la.forEach((a, k) => {
    lig[k * 3] = a.x; lig[k * 3 + 1] = a.y; lig[k * 3 + 2] = a.z;
    cx += a.x; cy += a.y; cz += a.z;
  });
  const ligC = [cx / la.length, cy / la.length, cz / la.length];
  let reach = 0;
  for (let k = 0; k < la.length; k++) {
    const r = Math.hypot(lig[k * 3] - ligC[0], lig[k * 3 + 1] - ligC[1], lig[k * 3 + 2] - ligC[2]);
    if (r > reach) reach = r;
  }
  const ligCut = reach + D.ligClash + 2.0;

  return {
    n, fixed, motifId, mob, anchor, lig, ligN: la.length, ligC, ligCut,
    rgTarget: D.rgCoef * Math.pow(n, D.rgExp), D,
    ss: null, ssR: { ri: new Int32Array(0), rj: new Int32Array(0), rt: new Float32Array(0), rw: new Float32Array(0), rn: 0 },
    pairs: [], helixWin: new Int32Array(0),
  };
}

// ---------------------------------------------------------------------------
//  one restraint
// ---------------------------------------------------------------------------

// Move residues i and j so that their distance approaches target.
// mode 0 holds the distance, 1 is a floor, 2 is a ceiling. Each residue
// moves in proportion to its mobility, so a fixed residue hardly moves.
function pull(x, mob, i, j, target, w, mode) {
  const a = i * 3, b = j * 3;
  let dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2];
  let d2 = dx * dx + dy * dy + dz * dz;
  if (d2 < 1e-8) { dx = 1e-3; dy = 0; dz = 0; d2 = 1e-6; }
  const d = Math.sqrt(d2);
  if (mode === 1 && d >= target) return;
  if (mode === 2 && d <= target) return;
  const mi = mob[i], mj = mob[j], ms = mi + mj;
  if (ms <= 1e-6) return;
  const f = (w * (d - target)) / (d * ms);
  x[a] += f * mi * dx; x[a + 1] += f * mi * dy; x[a + 2] += f * mi * dz;
  x[b] -= f * mj * dx; x[b + 1] -= f * mj * dy; x[b + 2] -= f * mj * dz;
}

// ---------------------------------------------------------------------------
//  one relax sweep: the stand-in for a network prediction
// ---------------------------------------------------------------------------

function relax(ctx, x, flags) {
  const { n, mob, D } = ctx;
  if (flags.bond) for (let i = 1; i < n; i++) pull(x, mob, i - 1, i, D.bond, W.bond, 0);
  if (flags.angle) {
    for (let i = 1; i < n - 1; i++) {
      pull(x, mob, i - 1, i + 1, D.d13Min, W.angle, 1);
      pull(x, mob, i - 1, i + 1, D.d13Max, W.angle, 2);
    }
  }
  if (flags.chir) chirSweep(ctx, x);
  if (flags.ss) {
    const r = ctx.ssR;
    for (let k = 0; k < r.rn; k++) pull(x, mob, r.ri[k], r.rj[k], r.rt[k], r.rw[k], 0);
  }
  if (flags.clash) {
    const lim = D.clash, lim2 = lim * lim;
    for (let i = 0; i < n - 3; i++) {
      for (let j = i + 3; j < n; j++) {
        if (dist2(x, i, j) < lim2) pull(x, mob, i, j, lim, W.clash, 1);
      }
    }
  }
  if (flags.lig) ligSweep(ctx, x);
  if (flags.rg) rgSweep(ctx, x);
  if (flags.pocket) pocketSweep(ctx, x);
  if (flags.motif) {
    const { fixed, anchor } = ctx, w = W.motif;
    for (let i = 0; i < n; i++) {
      if (!fixed[i]) continue;
      const k = i * 3;
      x[k] += w * (anchor[k] - x[k]);
      x[k + 1] += w * (anchor[k + 1] - x[k + 1]);
      x[k + 2] += w * (anchor[k + 2] - x[k + 2]);
    }
  }
}

// The signed volume of the three steps of one C-alpha(i..i+3) window.
// An ideal right-handed alpha-helix gives about +43 A^3; its mirror gives
// about -43. Four points, 2.3 A helix radius and 1.5 A rise per residue
// give that value.
function chirVolume(x, i) {
  const a = i * 3, b = a + 3, c = a + 6, e = a + 9;
  const r1 = [x[b] - x[a], x[b + 1] - x[a + 1], x[b + 2] - x[a + 2]];
  const r2 = [x[c] - x[b], x[c + 1] - x[b + 1], x[c + 2] - x[b + 2]];
  const r3 = [x[e] - x[c], x[e + 1] - x[c + 1], x[e + 2] - x[c + 2]];
  const cp = cross3(r1, r2);
  return { v: cp[0] * r3[0] + cp[1] * r3[1] + cp[2] * r3[2], r1, r2, r3, cp };
}

// Turn every helix window to the right. The gradient of the signed volume
// is exact; the step is the linear one, capped, so a run of sweeps rotates
// a left-handed helix through the flat state instead of tearing it.
function chirSweep(ctx, x) {
  const { mob, D, helixWin } = ctx;
  const vT = D.helix.chir, w = W.chir;
  for (let q = 0; q < helixWin.length; q++) {
    const i = helixWin[q];
    const { v, r1, r2, r3, cp } = chirVolume(x, i);
    if (v >= vT) continue;
    const A = cross3(r2, r3), B = cross3(r3, r1), C = cp;
    const g = [
      [-A[0], -A[1], -A[2]],
      [A[0] - B[0], A[1] - B[1], A[2] - B[2]],
      [B[0] - C[0], B[1] - C[1], B[2] - C[2]],
      [C[0], C[1], C[2]],
    ];
    const m = [mob[i], mob[i + 1], mob[i + 2], mob[i + 3]];
    let gg = 0, gMax = 0;
    for (let k = 0; k < 4; k++) {
      const s2 = g[k][0] * g[k][0] + g[k][1] * g[k][1] + g[k][2] * g[k][2];
      gg += m[k] * s2;
      const r = m[k] * Math.sqrt(s2);
      if (r > gMax) gMax = r;
    }
    if (gg < 1e-6 || gMax < 1e-9) continue;
    const boost = v < 0 ? 2.6 : 1;
    let step = (w * boost * (vT - v)) / gg;
    const cap = CHIR_CAP * boost;
    if (step * gMax > cap) step = cap / gMax;
    for (let k = 0; k < 4; k++) {
      const o = (i + k) * 3, f = step * m[k];
      x[o] += f * g[k][0]; x[o + 1] += f * g[k][1]; x[o + 2] += f * g[k][2];
    }
  }
}

// Push C-alpha points out of the ligand. A coarse test on the ligand
// centre removes most residues before the atom loop runs.
function ligSweep(ctx, x) {
  const { n, mob, lig, ligN, ligC, ligCut, D } = ctx;
  const cut2 = ligCut * ligCut, lim = D.ligClash, lim2 = lim * lim, w = W.lig;
  for (let i = 0; i < n; i++) {
    const k = i * 3;
    const ddx = x[k] - ligC[0], ddy = x[k + 1] - ligC[1], ddz = x[k + 2] - ligC[2];
    if (ddx * ddx + ddy * ddy + ddz * ddz > cut2) continue;
    const m = mob[i];
    if (m <= 1e-6) continue;
    for (let q = 0; q < ligN; q++) {
      const b = q * 3;
      let dx = x[k] - lig[b], dy = x[k + 1] - lig[b + 1], dz = x[k + 2] - lig[b + 2];
      let d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= lim2) continue;
      if (d2 < 1e-8) { dx = 1e-3; dy = 0; dz = 0; d2 = 1e-6; }
      const d = Math.sqrt(d2);
      const f = (w * m * (lim - d)) / d;
      x[k] += f * dx; x[k + 1] += f * dy; x[k + 2] += f * dz;
    }
  }
}

// Scale the chain about its own centre toward the target radius of
// gyration. The step is capped so that it does not break the bonds.
function rgSweep(ctx, x) {
  const { n, mob, rgTarget } = ctx;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { const k = i * 3; cx += x[k]; cy += x[k + 1]; cz += x[k + 2]; }
  cx /= n; cy /= n; cz /= n;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const k = i * 3;
    const dx = x[k] - cx, dy = x[k + 1] - cy, dz = x[k + 2] - cz;
    s2 += dx * dx + dy * dy + dz * dz;
  }
  const rg = Math.sqrt(s2 / n) || 1;
  let s = 1 + W.rg * (rgTarget / rg - 1);
  if (s > 1.03) s = 1.03;
  if (s < 0.97) s = 0.97;
  for (let i = 0; i < n; i++) {
    const k = i * 3, f = 1 + (s - 1) * mob[i];
    x[k] = cx + (x[k] - cx) * f;
    x[k + 1] = cy + (x[k + 1] - cy) * f;
    x[k + 2] = cz + (x[k + 2] - cz) * f;
  }
  // The shell. A residue outside it comes back in, which stops a helix or
  // a terminus from hanging off the globule.
  const rMax = rgTarget * SHELL_K;
  for (let i = 0; i < n; i++) {
    const m = mob[i];
    if (m <= 1e-6) continue;
    const k = i * 3;
    const dx = x[k] - cx, dy = x[k + 1] - cy, dz = x[k + 2] - cz;
    const r = Math.hypot(dx, dy, dz);
    if (r <= rMax) continue;
    const g = (W.shell * m * (r - rMax)) / r;
    x[k] -= g * dx; x[k + 1] -= g * dy; x[k + 2] -= g * dz;
  }
}

// Slide the chain so that the ligand centre sits inside the fold and not
// on the surface. The restraint has a flat bottom of POCKET_OK angstroms,
// so a real pocket can stay a little off the chain centre.
const POCKET_OK = 2.0;
function pocketSweep(ctx, x) {
  const { n, mob, ligC } = ctx;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { const k = i * 3; cx += x[k]; cy += x[k + 1]; cz += x[k + 2]; }
  cx /= n; cy /= n; cz /= n;
  const ox = ligC[0] - cx, oy = ligC[1] - cy, oz = ligC[2] - cz;
  const off = Math.hypot(ox, oy, oz);
  if (off <= POCKET_OK) return;
  const want = (off - POCKET_OK) / off * W.pocket;
  let dx = ox * want, dy = oy * want, dz = oz * want;
  const r = Math.hypot(dx, dy, dz);
  if (r > 1.0) { const f = 1.0 / r; dx *= f; dy *= f; dz *= f; }
  for (let i = 0; i < n; i++) {
    const k = i * 3, m = mob[i];
    x[k] += dx * m; x[k + 1] += dy * m; x[k + 2] += dz * m;
  }
}

// ---------------------------------------------------------------------------
//  energy: ranks latent states and motif placements
// ---------------------------------------------------------------------------

function energy(ctx, x) {
  const { n, fixed, anchor, lig, ligN, ligC, ligCut, rgTarget, D } = ctx;
  let e = 0;
  const sq = (v) => v * v;
  for (let i = 1; i < n; i++) e += EW.bond * sq(distAt(x, i - 1, i) - D.bond);
  for (let i = 1; i < n - 1; i++) {
    const d = distAt(x, i - 1, i + 1);
    if (d < D.d13Min) e += EW.angle * sq(D.d13Min - d);
    else if (d > D.d13Max) e += EW.angle * sq(d - D.d13Max);
  }
  // A latent structure state is scored by how well the shape can hold it,
  // not by how many restraints it adds. A restraint that the geometry
  // already meets pays a reward; one that it fights pays its violation.
  // Without the reward the search would always choose an all-loop state,
  // because a loop adds no restraint and so adds no violation.
  const r = ctx.ssR;
  for (let k = 0; k < r.rn; k++) {
    const dev = Math.abs(distAt(x, r.ri[k], r.rj[k]) - r.rt[k]);
    if (dev < SS_SAT) e -= SS_REWARD * r.rw[k];
    else e += EW.ss * r.rw[k] * sq(dev);
  }
  for (let q = 0; q < ctx.helixWin.length; q++) {
    const { v } = chirVolume(x, ctx.helixWin[q]);
    if (v < D.helix.chir) e += EW.chir * sq(D.helix.chir - v);
    else e -= SS_REWARD * 0.5;
  }
  const lim2 = D.clash * D.clash;
  for (let i = 0; i < n - 3; i++) {
    for (let j = i + 3; j < n; j++) {
      const d2 = dist2(x, i, j);
      if (d2 < lim2) e += EW.clash * sq(D.clash - Math.sqrt(d2));
    }
  }
  const cut2 = ligCut * ligCut, ll2 = D.ligClash * D.ligClash;
  for (let i = 0; i < n; i++) {
    const k = i * 3;
    const ax = x[k] - ligC[0], ay = x[k + 1] - ligC[1], az = x[k + 2] - ligC[2];
    if (ax * ax + ay * ay + az * az > cut2) continue;
    for (let q = 0; q < ligN; q++) {
      const b = q * 3;
      const dx = x[k] - lig[b], dy = x[k + 1] - lig[b + 1], dz = x[k + 2] - lig[b + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < ll2) e += EW.lig * sq(D.ligClash - Math.sqrt(d2));
    }
  }
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { const k = i * 3; cx += x[k]; cy += x[k + 1]; cz += x[k + 2]; }
  cx /= n; cy /= n; cz /= n;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const k = i * 3;
    s2 += sq(x[k] - cx) + sq(x[k + 1] - cy) + sq(x[k + 2] - cz);
  }
  e += EW.rg * n * sq(Math.sqrt(s2 / n) - rgTarget) / 10;
  const rMax = rgTarget * SHELL_K;
  for (let i = 0; i < n; i++) {
    const k = i * 3;
    const r = Math.hypot(x[k] - cx, x[k + 1] - cy, x[k + 2] - cz);
    if (r > rMax) e += EW.rg * sq(r - rMax);
  }
  const off = Math.hypot(cx - ligC[0], cy - ligC[1], cz - ligC[2]);
  if (off > POCKET_OK) e += EW.pocket * n * sq(off - POCKET_OK) / 10;
  for (let i = 0; i < n; i++) {
    if (!fixed[i]) continue;
    const k = i * 3;
    e += EW.motif * (sq(x[k] - anchor[k]) + sq(x[k + 1] - anchor[k + 1]) + sq(x[k + 2] - anchor[k + 2]));
  }
  return e / n;
}

// ---------------------------------------------------------------------------
//  the latent structure state
// ---------------------------------------------------------------------------

// Draw a per-residue state string of 'H', 'E' and 'L'. Strands come in
// hairpin pairs, so that a pair restraint always has a partner. Motif
// residues and their neighbours stay loops, because their coordinates are
// already set and a helix restraint would fight them.
// Returns { ss: string, pairs: [[a0, a1, b0, b1]] }.
function sampleSS(n, fixed, rand) {
  const s = new Array(n).fill('L');
  const pairs = [];
  const iv = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  let i = iv(2, 5);
  while (i < n - 5) {
    const roll = rand();
    if (roll < 0.60) {
      const L = Math.min(iv(8, 17), n - 2 - i);
      if (L < 5) break;
      for (let k = 0; k < L; k++) s[i + k] = 'H';
      i += L + iv(3, 5);
    } else {
      // A hairpin: strand, tight turn, strand.
      const L = iv(4, 7), turn = iv(2, 4);
      if (i + 2 * L + turn > n - 2) break;
      const a0 = i, a1 = i + L - 1;
      const b0 = a1 + 1 + turn, b1 = b0 + L - 1;
      for (let k = a0; k <= a1; k++) s[k] = 'E';
      for (let k = b0; k <= b1; k++) s[k] = 'E';
      pairs.push([a0, a1, b0, b1]);
      i = b1 + 1 + iv(3, 5);
    }
  }
  // Clear the motif and its neighbours.
  for (let k = 0; k < n; k++) {
    if (!fixed[k]) continue;
    for (let q = Math.max(0, k - 1); q <= Math.min(n - 1, k + 1); q++) s[q] = 'L';
  }
  // Drop runs that are now too short to be real.
  const ss = s.join('');
  const out = s.slice();
  let run = 0;
  for (let k = 0; k <= n; k++) {
    const c = k < n ? ss[k] : 'x';
    if (k > 0 && c === ss[k - 1]) { run++; continue; }
    if (k > 0) {
      const min = ss[k - 1] === 'H' ? 5 : ss[k - 1] === 'E' ? 3 : 0;
      if (run < min) for (let q = k - run; q < k; q++) out[q] = 'L';
    }
    run = 1;
  }
  const final = out.join('');
  const kept = pairs.filter(([a0, a1, b0, b1]) => final[a0] === 'E' && final[a1] === 'E' && final[b0] === 'E' && final[b1] === 'E');
  return { ss: final, pairs: kept };
}

// Turn a latent state into a flat restraint list. The list is rebuilt
// only when the state changes, so the relax sweep stays cheap.
function setSS(ctx, ss, pairs) {
  const { n, D } = ctx;
  const ri = [], rj = [], rt = [], rw = [];
  const add = (i, j, t, w) => { ri.push(i); rj.push(j); rt.push(t); rw.push(w); };
  for (let i = 0; i + 2 < n; i++) {
    if (ss[i] === 'H' && ss[i + 1] === 'H' && ss[i + 2] === 'H') add(i, i + 2, D.helix.d2, 1.0);
    if (ss[i] === 'E' && ss[i + 1] === 'E' && ss[i + 2] === 'E') add(i, i + 2, D.strand.d2, 1.0);
  }
  const hw = [];
  for (let i = 0; i + 3 < n; i++) {
    const h = ss[i] === 'H' && ss[i + 1] === 'H' && ss[i + 2] === 'H' && ss[i + 3] === 'H';
    if (h) { add(i, i + 3, D.helix.d3, 1.0); hw.push(i); }
    const e = ss[i] === 'E' && ss[i + 1] === 'E' && ss[i + 2] === 'E' && ss[i + 3] === 'E';
    if (e) add(i, i + 3, D.strand.d3, 0.6);
  }
  for (let i = 0; i + 4 < n; i++) {
    let h = true;
    for (let k = 0; k <= 4; k++) if (ss[i + k] !== 'H') { h = false; break; }
    if (h) add(i, i + 4, D.helix.d4, 1.0);
  }
  const pw = W.pair / W.ss;
  for (const [a0, a1, b0, b1] of pairs) {
    const L = Math.min(a1 - a0, b1 - b0) + 1;
    for (let k = 0; k < L; k++) add(a0 + k, b1 - k, D.strand.pair, pw);
  }
  ctx.ss = ss;
  ctx.pairs = pairs;
  ctx.helixWin = Int32Array.from(hw);
  ctx.ssR = { ri: Int32Array.from(ri), rj: Int32Array.from(rj), rt: Float32Array.from(rt), rw: Float32Array.from(rw), rn: ri.length };
}

// ---------------------------------------------------------------------------
//  the reverse loop
// ---------------------------------------------------------------------------

// The noise schedule. u runs 1 at the start to 0 at the end.
const sigmaAt = (u, D) => D.sigmaMin + (D.sigmaMax - D.sigmaMin) * Math.pow(Math.max(0, Math.min(1, u)), D.rho);

// Run the reverse process on one context.
//   opts = { steps, from, start, rand, anneal, keepTrajectory, onStep }
//   from  the schedule point to start at, 1 for noise, less for partial
//   start an optional Float32Array to start from
// Returns { x, accepted, frames, energy }.
function runDiffusion(ctx, { steps, from = 1, start = null, rand, anneal = true, keepTrajectory = false, onStep = null }) {
  const { n, fixed, anchor, rgTarget, D } = ctx;
  const x = new Float32Array(n * 3);
  if (start) {
    x.set(start);
    const s0 = sigmaAt(from, D);
    for (let i = 0; i < n; i++) {
      if (fixed[i]) continue;
      const k = i * 3;
      x[k] += gauss(rand) * s0; x[k + 1] += gauss(rand) * s0; x[k + 2] += gauss(rand) * s0;
    }
  } else {
    const spread = rgTarget * 0.75;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      x[k] = ctx.ligC[0] + gauss(rand) * spread;
      x[k + 1] = ctx.ligC[1] + gauss(rand) * spread;
      x[k + 2] = ctx.ligC[2] + gauss(rand) * spread;
    }
  }
  for (let i = 0; i < n; i++) {
    if (!fixed[i]) continue;
    const k = i * 3;
    x[k] = anchor[k]; x[k + 1] = anchor[k + 1]; x[k + 2] = anchor[k + 2];
  }

  const nStep = Math.max(1, Math.round(steps * from));
  const frames = [];
  const stride = keepTrajectory ? Math.max(1, Math.ceil(nStep / (D.maxFrames - 1))) : 0;
  let accepted = 0;
  const scratch = anneal ? new Float32Array(n * 3) : null;

  for (let s = 0; s < nStep; s++) {
    const u = from * (1 - s / nStep);
    const uNext = from * (1 - (s + 1) / nStep);
    const sigma = sigmaAt(u, D);

    // 1. predict a clean structure.
    for (let it = 0; it < D.relaxIters; it++) relax(ctx, x, ALL);

    // 2. search the latent structure state while the noise is still high.
    if (anneal && u > D.anneal.until && s % D.anneal.every === 0 && s > 0) {
      const cur = energy(ctx, x);
      const curSS = ctx.ss, curPairs = ctx.pairs, curR = ctx.ssR, curW = ctx.helixWin;
      const cand = sampleSS(n, fixed, rand);
      setSS(ctx, cand.ss, cand.pairs);
      scratch.set(x);
      for (let it = 0; it < D.anneal.iters; it++) relax(ctx, scratch, ALL);
      if (energy(ctx, scratch) < cur) { x.set(scratch); accepted++; }
      else { ctx.ss = curSS; ctx.pairs = curPairs; ctx.ssR = curR; ctx.helixWin = curW; }
    }

    if (keepTrajectory && (s % stride === 0)) frames.push({ t: u, sigma, ca: x.slice() });
    if (onStep) onStep({ i: s, steps: nStep, t: u, sigma, ca: x });

    // 3. add noise again at the next level of the schedule.
    const sn = sigmaAt(uNext, D);
    if (sn > D.sigmaMin) {
      for (let i = 0; i < n; i++) {
        if (fixed[i]) continue;
        const k = i * 3;
        x[k] += gauss(rand) * sn; x[k + 1] += gauss(rand) * sn; x[k + 2] += gauss(rand) * sn;
      }
    }
  }

  // Polish with no noise, then close with the hard geometry only, so the
  // bonds and the clashes end clean.
  for (let it = 0; it < D.polishIters; it++) relax(ctx, x, ALL);
  for (let it = 0; it < D.finalIters; it++) relax(ctx, x, HARD);
  if (keepTrajectory) frames.push({ t: 0, sigma: 0, ca: x.slice() });

  return { x, accepted, frames, energy: energy(ctx, x) };
}

// ---------------------------------------------------------------------------
//  C-beta points and the measured structure state
// ---------------------------------------------------------------------------

// Build a C-beta point for every residue. The direction is the outward
// bisector of the two backbone steps, tilted toward the local normal.
// This is an approximation: the design format holds no backbone nitrogen
// or carbonyl carbon, so an exact frame is not available.
function buildCB(ca, n, fixed, motifId, byIndex, cbLen) {
  const cb = new Float32Array(n * 3);
  const get = (i) => [ca[i * 3], ca[i * 3 + 1], ca[i * 3 + 2]];
  for (let i = 0; i < n; i++) {
    if (fixed[i]) {
      const t = byIndex.get(motifId[i]);
      if (t) { cb[i * 3] = t.cb[0]; cb[i * 3 + 1] = t.cb[1]; cb[i * 3 + 2] = t.cb[2]; continue; }
    }
    const im = i > 0 ? i - 1 : i + 1;
    const ip = i < n - 1 ? i + 1 : i - 1;
    const p = get(i);
    const v1 = norm3(sub3(get(im), p));
    const v2 = norm3(sub3(get(ip), p));
    let bis = [v1[0] + v2[0], v1[1] + v2[1], v1[2] + v2[2]];
    if (len3(bis) < 1e-3) bis = [v1[0], v1[1], v1[2] + 1e-3];
    bis = norm3(bis);
    let nrm = cross3(v1, v2);
    if (len3(nrm) < 1e-3) nrm = [bis[1], bis[2], bis[0]];
    nrm = norm3(nrm);
    const dir = norm3([-0.9 * bis[0] + 0.44 * nrm[0], -0.9 * bis[1] + 0.44 * nrm[1], -0.9 * bis[2] + 0.44 * nrm[2]]);
    cb[i * 3] = p[0] + dir[0] * cbLen;
    cb[i * 3 + 1] = p[1] + dir[1] * cbLen;
    cb[i * 3 + 2] = p[2] + dir[2] * cbLen;
  }
  return cb;
}

// Read the structure state back out of the geometry, not out of the
// latent. A design reports what it actually built.
export function classifySS(ca, n) {
  const out = new Array(n).fill('L');
  const d = (i, j) => Math.hypot(ca[j * 3] - ca[i * 3], ca[j * 3 + 1] - ca[i * 3 + 1], ca[j * 3 + 2] - ca[i * 3 + 2]);
  for (let i = 0; i + 4 < n; i++) {
    const d2 = d(i, i + 2), d3 = d(i, i + 3), d4 = d(i, i + 4);
    if (d2 > 4.8 && d2 < 6.1 && d3 > 4.4 && d3 < 5.9 && d4 > 5.3 && d4 < 7.2) {
      for (let k = 0; k <= 4; k++) out[i + k] = 'H';
    }
  }
  for (let i = 0; i + 4 < n; i++) {
    let clear = true;
    for (let k = 0; k <= 4; k++) if (out[i + k] === 'H') { clear = false; break; }
    if (!clear) continue;
    const a2 = d(i, i + 2), b2 = d(i + 1, i + 3), c2 = d(i + 2, i + 4);
    const d3 = d(i, i + 3), e3 = d(i + 1, i + 4), d4 = d(i, i + 4);
    const ext2 = (v) => v > 6.25 && v < 7.25;
    const ext3 = (v) => v > 9.0 && v < 10.9;
    if (ext2(a2) && ext2(b2) && ext2(c2) && ext3(d3) && ext3(e3) && d4 > 11.8 && d4 < 14.6) {
      for (let k = 0; k <= 4; k++) out[i + k] = 'E';
    }
  }
  // Drop runs too short to call.
  const s = out.join('');
  let run = 0;
  for (let k = 0; k <= n; k++) {
    const c = k < n ? s[k] : 'x';
    if (k > 0 && c === s[k - 1]) { run++; continue; }
    if (k > 0) {
      const min = s[k - 1] === 'H' ? 5 : s[k - 1] === 'E' ? 3 : 0;
      if (run < min) for (let q = k - run; q < k; q++) out[q] = 'L';
    }
    run = 1;
  }
  return out.join('');
}

// Geometry read-out of a trace. Used by the log, the page and the tests.
export function traceStats(ca, n) {
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += ca[i * 3]; cy += ca[i * 3 + 1]; cz += ca[i * 3 + 2]; }
  cx /= n; cy /= n; cz /= n;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    s2 += (ca[i * 3] - cx) ** 2 + (ca[i * 3 + 1] - cy) ** 2 + (ca[i * 3 + 2] - cz) ** 2;
  }
  let bMin = Infinity, bMax = 0, worst = Infinity;
  for (let i = 1; i < n; i++) {
    const r = distAt(ca, i - 1, i);
    if (r < bMin) bMin = r;
    if (r > bMax) bMax = r;
  }
  for (let i = 0; i < n - 3; i++) {
    for (let j = i + 3; j < n; j++) {
      const r2 = dist2(ca, i, j);
      if (r2 < worst) worst = r2;
    }
  }
  return {
    centre: [cx, cy, cz],
    rg: Math.sqrt(s2 / n),
    bondMin: bMin, bondMax: bMax,
    worstClash: n > 3 ? Math.sqrt(worst) : Infinity,
  };
}

// ---------------------------------------------------------------------------
//  entry point
// ---------------------------------------------------------------------------

// Grow a chain around a motif.
//   opts = { motif, motifStr, seqLength, seed, steps, partial, unindexed,
//            keepTrajectory, onStep }
//     partial = { parent: Design, stepsBack: n }
// Returns Run = { design, trajectory, steps, accepted, ms, plan, log }.
export function scaffold(opts = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const {
    motif, motifStr, seqLength = null, seed = 0,
    steps = DEFAULTS.steps, partial = null, unindexed = false,
    keepTrajectory = true, onStep = null,
  } = opts;
  if (!motif) throw new Error('scaffold needs a motif');
  if (!Number.isInteger(steps) || steps < 8 || steps > 4000) throw new Error(`steps must be an integer 8..4000, got ${steps}`);
  const D = { ...DEFAULTS, steps };
  const log = [];
  const rand = rng(seed >>> 0);
  const targets = motifTargets(motif);
  const byIndex = new Map();
  for (const t of targets.values()) byIndex.set(t.index, t);

  // --- the chain layout -----------------------------------------------
  let layout = null, plan = null, parsed = null, candidates = null;
  if (partial && partial.parent) {
    const p = partial.parent;
    if (!(p.ca instanceof Float32Array) || !Number.isInteger(p.n)) throw new Error('partial.parent is not a design');
    layout = { n: p.n, fixed: p.fixed, motifId: p.motifId, code: null, segs: (p.meta && p.meta.segs) || [] };
    plan = { lengths: null, total: p.n, resolved: (p.meta && p.meta.motifStr) || null, indexed: true, fromParent: true };
    log.push(`Partial diffusion. The parent has ${p.n} residues.`);
  } else {
    const mk = () => {
      const q = parseMotifStr(motifStr, rand);
      const pl = planChain(q, { seqLength, rand });
      return { parsed: q, plan: pl, layout: buildLayout(q, pl, targets) };
    };
    if (unindexed) {
      // Draw several placements, run a short trial of each one, keep the
      // placement with the lowest energy.
      candidates = [];
      for (let c = 0; c < D.unindexedTries; c++) {
        const cand = mk();
        if (cand.plan.total < LIMITS.minLen || cand.plan.total > LIMITS.maxLen) continue;
        const ctxC = buildCtx(cand.layout, motif, targets, D);
        const ss0 = sampleSS(cand.layout.n, cand.layout.fixed, rand);
        setSS(ctxC, ss0.ss, ss0.pairs);
        const trial = runDiffusion(ctxC, {
          steps: Math.min(D.trialSteps, steps), rand: forkRng(rand), anneal: false, keepTrajectory: false,
        });
        candidates.push({ resolved: cand.parsed.resolved, total: cand.plan.total, energy: trial.energy, cand });
      }
      if (!candidates.length) throw new Error('no motif placement gave a legal chain length');
      candidates.sort((a, b) => a.energy - b.energy);
      const best = candidates[0];
      parsed = best.cand.parsed; plan = best.cand.plan; layout = best.cand.layout;
      log.push(`Unindexed. ${candidates.length} placements were tried; the best one scored ${best.energy.toFixed(2)}.`);
      for (const c of candidates) log.push(`  placement ${c.resolved} at ${c.total} residues scored ${c.energy.toFixed(2)}.`);
      plan.indexed = false;
      plan.candidates = candidates.map((c) => ({ resolved: c.resolved, total: c.total, energy: c.energy }));
    } else {
      const one = mk();
      parsed = one.parsed; plan = one.plan; layout = one.layout;
      plan.indexed = true;
      log.push(`Indexed. The motif sits where motif_str puts it: ${parsed.resolved}.`);
    }
    plan.resolved = parsed.resolved;
    plan.segs = layout.segs;
    if (plan.missed) log.push(`The plan could not reach seq_length ${seqLength}; it landed at ${plan.total} residues.`);
  }

  const n = layout.n;
  if (n < LIMITS.minLen || n > LIMITS.maxLen) throw new Error(`the chain plan gives ${n} residues, outside ${LIMITS.minLen}..${LIMITS.maxLen}`);

  // --- the restraints -------------------------------------------------
  const ctx = buildCtx(layout, motif, targets, D);
  log.push(`Target radius of gyration ${ctx.rgTarget.toFixed(2)} A for ${n} residues.`);

  let from = 1, start = null, anneal = true;
  if (partial && partial.parent) {
    const back = Math.max(1, Math.min(steps, Math.round(partial.stepsBack)));
    from = back / steps;
    start = partial.parent.ca;
    anneal = from > D.anneal.until;
    const latent = (partial.parent.meta && partial.parent.meta.ssLatent) || null;
    if (latent && latent.length === n) setSS(ctx, latent, (partial.parent.meta.ssPairs || []));
    else { const s0 = sampleSS(n, layout.fixed, rand); setSS(ctx, s0.ss, s0.pairs); }
    log.push(`${back} of ${steps} steps back. Noise at the restart is ${sigmaAt(from, D).toFixed(2)} A.`);
  } else {
    const s0 = sampleSS(n, layout.fixed, rand);
    setSS(ctx, s0.ss, s0.pairs);
  }

  // --- the reverse process --------------------------------------------
  const out = runDiffusion(ctx, { steps, from, start, rand, anneal, keepTrajectory, onStep });

  // --- assemble the design --------------------------------------------
  const ca = out.x;
  const cb = buildCB(ca, n, layout.fixed, layout.motifId, byIndex, D.cbLen);
  const ss = classifySS(ca, n);
  let seq = '';
  for (let i = 0; i < n; i++) {
    if (layout.fixed[i]) {
      const t = byIndex.get(layout.motifId[i]);
      seq += t ? t.code : 'X';
    } else seq += 'X';
  }
  const st = traceStats(ca, n);
  const hN = (ss.match(/H/g) || []).length, eN = (ss.match(/E/g) || []).length;
  log.push(`Radius of gyration ${st.rg.toFixed(2)} A. Bonds ${st.bondMin.toFixed(2)} to ${st.bondMax.toFixed(2)} A. Closest non-neighbour pair ${st.worstClash.toFixed(2)} A.`);
  log.push(`Measured structure: ${(100 * hN / n).toFixed(0)}% helix, ${(100 * eN / n).toFixed(0)}% strand.`);
  if (out.accepted) log.push(`${out.accepted} new latent structure states lowered the energy and were kept.`);

  const design = {
    n, ca, cb,
    fixed: layout.fixed instanceof Uint8Array ? layout.fixed : Uint8Array.from(layout.fixed),
    motifId: layout.motifId instanceof Int32Array ? layout.motifId : Int32Array.from(layout.motifId),
    seq, ss,
    ligand: { name: (motif.ligand && motif.ligand.name) || 'LIG', atoms: (motif.ligand.atoms || []).map((a) => ({ ...a })), bonds: (motif.ligand.bonds || []).map((b) => b.slice()) },
    meta: {
      seed: seed >>> 0, steps, motifStr: motifStr || (plan && plan.resolved) || null, seqLength,
      motifId_: null, indexed: !!(plan && plan.indexed), unindexed: !!unindexed,
      partial: partial ? { stepsBack: Math.round(partial.stepsBack), from } : null,
      motif: motif.id || null,
      ssLatent: ctx.ss, ssPairs: ctx.pairs.map((p) => p.slice()),
      segs: plan && plan.segs ? plan.segs : [],
      rgTarget: ctx.rgTarget, energy: out.energy,
      simulated: true,
    },
  };

  const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  return {
    design,
    trajectory: out.frames,
    steps: Math.max(1, Math.round(steps * from)),
    accepted: out.accepted,
    ms: t1 - t0,
    plan,
    log,
  };
}
