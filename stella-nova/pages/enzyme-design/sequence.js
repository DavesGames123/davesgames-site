// ============================================================================
//  SEQUENCE  ·  a heuristic stand-in for LigandMPNN
// ----------------------------------------------------------------------------
//  The scaffolder gives a shape. This module gives that shape a sequence.
//  It chooses one amino acid for each residue, then samples an ensemble of
//  sequences at a temperature. No DOM, so Node can import it.
//
//  IT IS NOT LigandMPNN. The real pipeline runs a learned graph network
//  over the backbone and the ligand. This module runs a hand-written score
//  with six terms. The score is a heuristic, and every card that shows a
//  sequence from it must say that the sequence is a simulation.
//
//  WHY AN ENSEMBLE. The AlphaProtein Novo abstract states that one of the
//  two things that made the designs work was scoring a backbone by an
//  ensemble of sequences instead of one sequence. So this module returns
//  nSeq sequences, and ensembleAgreement reports how much they agree. The
//  repository README gives 0.1 as the default sampling temperature, which
//  is why designSequence takes 0.1 as its own default.
//
//  THE SEVEN TERMS of the score for amino acid a at residue i:
//    burial ..... a buried residue wants an oily side chain, and an
//                 exposed residue wants a water-loving one. The term is
//                 the Kyte-Doolittle hydropathy times the burial rank.
//    background . the natural abundance of a. Without this term the
//                 score gives one letter to every buried position and
//                 one letter to every exposed position, which no real
//                 protein looks like.
//    structure .. the Chou-Fasman helix or strand propensity of a, for
//                 the structure state the scaffolder measured at i.
//    pocket ..... residues near the ligand get a lining preference. A
//                 small or flat side chain makes a better wall than a
//                 long charged one.
//    charge ..... a buried charge pays a penalty, because there is no
//                 water inside a protein to hold it.
//    volume ..... a crowded buried position pays for a large side chain.
//    special .... methionine starts the chain, cysteine is avoided,
//                 proline breaks a helix or a strand, glycine helps a
//                 loop turn.
//  Motif residues take the identity the chemistry needs. They are not
//  scored and not sampled.
//
//  DECODING ORDER. The module decodes the residues in a random order,
//  one at a time, and each choice sees the choices already made nearby.
//  A position pays a penalty for the letter that its decoded neighbours
//  already took, so a core packs several shapes instead of one. The real
//  LigandMPNN also decodes in a random order; the penalty here is our
//  own stand-in for what its network learned. One effect is useful: the
//  order changes between the samples, so the ensemble still differs at a
//  temperature of 0.1.
//
//  BURIAL. The design format holds one C-alpha and one C-beta per
//  residue, so this module measures burial by half-sphere exposure: the
//  count of C-beta points inside HSE_CUT angstroms that lie on the
//  side-chain side of the residue. The measure is approximate, because a
//  trace carries no side-chain atoms.
//
//  Two burial numbers come out of that count. `burial` is the absolute
//  one, from HSE_LO to HSE_HI, and the page shows it. `burialRank` is
//  the rank of the count inside this one design, 0 for the most exposed
//  residue and 1 for the most enclosed one. The score uses the rank,
//  because a protein buries about half of its residues whatever its
//  size, and a rank says that directly.
//
//  Units are angstroms. Every random number comes from rng() in
//  design.js, so one seed gives one ensemble, in Node and in the browser.
//
//  EXPORTS   (grep -n "<anchor>" sequence.js)
//    amino acid table .. "export const AA_INFO"
//    background share .. "export const AA_FREQ"
//    pocket preference . "export const POCKET_PREF"
//    score weights ..... "export const WEIGHTS"
//    the designer ...... "export function designSequence"
//    per residue input . "export function residueFeatures"
//    structure guess ... "export function predictSS"
//    ensemble read-out . "export function ensembleAgreement"
//
//  INTERNAL   (grep -n "<anchor>" sequence.js)
//    one position ...... "function scorePosition"
//    softmax ........... "function softmax"
//    categorical draw .. "function drawFrom"
// ============================================================================

import { AA, rng } from './design.js';

// The twenty amino acids.
//   name ........ the full name, for a label on the page
//   hydropathy .. Kyte-Doolittle, -4.5 water-loving to +4.5 oily
//   charge ...... net charge at pH 7; histidine is part charged
//   helixProp ... Chou-Fasman P(alpha); above 1.0 favours a helix
//   sheetProp ... Chou-Fasman P(beta); above 1.0 favours a strand
//   volume ...... side-chain plus backbone volume in cubic angstroms
// All six columns are textbook scales. None comes from the preprint.
export const AA_INFO = {
  A: { name: 'alanine',       hydropathy:  1.8, charge:  0.0, helixProp: 1.42, sheetProp: 0.83, volume:  88.6 },
  C: { name: 'cysteine',      hydropathy:  2.5, charge:  0.0, helixProp: 0.70, sheetProp: 1.19, volume: 108.5 },
  D: { name: 'aspartate',     hydropathy: -3.5, charge: -1.0, helixProp: 1.01, sheetProp: 0.54, volume: 111.1 },
  E: { name: 'glutamate',     hydropathy: -3.5, charge: -1.0, helixProp: 1.51, sheetProp: 0.37, volume: 138.4 },
  F: { name: 'phenylalanine', hydropathy:  2.8, charge:  0.0, helixProp: 1.13, sheetProp: 1.38, volume: 189.9 },
  G: { name: 'glycine',       hydropathy: -0.4, charge:  0.0, helixProp: 0.57, sheetProp: 0.75, volume:  60.1 },
  H: { name: 'histidine',     hydropathy: -3.2, charge:  0.1, helixProp: 1.00, sheetProp: 0.87, volume: 153.2 },
  I: { name: 'isoleucine',    hydropathy:  4.5, charge:  0.0, helixProp: 1.08, sheetProp: 1.60, volume: 166.7 },
  K: { name: 'lysine',        hydropathy: -3.9, charge:  1.0, helixProp: 1.16, sheetProp: 0.74, volume: 168.6 },
  L: { name: 'leucine',       hydropathy:  3.8, charge:  0.0, helixProp: 1.21, sheetProp: 1.30, volume: 166.7 },
  M: { name: 'methionine',    hydropathy:  1.9, charge:  0.0, helixProp: 1.45, sheetProp: 1.05, volume: 162.9 },
  N: { name: 'asparagine',    hydropathy: -3.5, charge:  0.0, helixProp: 0.67, sheetProp: 0.89, volume: 114.1 },
  P: { name: 'proline',       hydropathy: -1.6, charge:  0.0, helixProp: 0.57, sheetProp: 0.55, volume: 112.7 },
  Q: { name: 'glutamine',     hydropathy: -3.5, charge:  0.0, helixProp: 1.11, sheetProp: 1.10, volume: 143.8 },
  R: { name: 'arginine',      hydropathy: -4.5, charge:  1.0, helixProp: 0.98, sheetProp: 0.93, volume: 173.4 },
  S: { name: 'serine',        hydropathy: -0.8, charge:  0.0, helixProp: 0.77, sheetProp: 0.75, volume:  89.0 },
  T: { name: 'threonine',     hydropathy: -0.7, charge:  0.0, helixProp: 0.83, sheetProp: 1.19, volume: 116.1 },
  V: { name: 'valine',        hydropathy:  4.2, charge:  0.0, helixProp: 1.06, sheetProp: 1.70, volume: 140.0 },
  W: { name: 'tryptophan',    hydropathy: -0.9, charge:  0.0, helixProp: 1.08, sheetProp: 1.37, volume: 227.8 },
  Y: { name: 'tyrosine',      hydropathy: -1.3, charge:  0.0, helixProp: 0.69, sheetProp: 1.47, volume: 193.6 },
};

// Background abundance in percent, from the Swiss-Prot residue
// composition. A textbook table, and not a number from the preprint.
export const AA_FREQ = {
  A: 8.25, C: 1.38, D: 5.45, E: 6.75, F: 3.86, G: 7.07, H: 2.27, I: 5.96,
  K: 5.84, L: 9.66, M: 2.42, N: 4.06, P: 4.70, Q: 3.93, R: 5.53, S: 6.56,
  T: 5.34, V: 6.87, W: 1.08, Y: 2.92,
};

// How well each amino acid lines a pocket, as this module judges it.
// These numbers are our own heuristic, not a measured scale. A small or
// flat side chain makes a good wall. A long charged one does not, unless
// the chemistry asks for it, and then the motif holds it anyway.
export const POCKET_PREF = {
  A: 0.35, C: 0.30, D: 0.15, E: 0.10, F: 0.60, G: 0.40, H: 0.55, I: 0.30,
  K: -0.30, L: 0.35, M: 0.40, N: 0.40, P: -0.40, Q: 0.35, R: -0.10, S: 0.50,
  T: 0.50, V: 0.35, W: 0.50, Y: 0.70,
};

// Strength of each term of the score. The score goes into a softmax, so
// only the ratios matter.
export const WEIGHTS = {
  burial: 3.20,   // hydropathy against the burial rank
  prior: 1.60,    // natural abundance
  ss: 1.00,       // Chou-Fasman propensity
  pocket: 1.40,   // pocket lining preference
  charge: 1.40,   // penalty for a buried charge
  volume: 0.90,   // penalty for a large side chain in a crowded core
  loop: 0.55,     // bonus for a loop-friendly residue in a loop
  repeat: 0.90,   // penalty for a letter a decoded neighbour already took
};

// The exposed side of the burial term is weaker than the buried side.
// Packing a core is a hard constraint; facing water is a soft one.
const EXPOSED_SOFT = 0.60;

// Burial and pocket cut-offs, in angstroms.
const HSE_CUT = 12.0;       // half-sphere exposure radius
const HSE_LO = 4;           // this count counts as fully exposed
const HSE_HI = 18;          // this count counts as fully buried
const CROWD_LO = 12;        // neighbour count that counts as roomy
const CROWD_HI = 24;        // neighbour count that counts as crowded
const NB_CUT = 10.0;        // neighbour count radius
const PACK_CUT = 7.5;       // radius of the decoded neighbours that a choice sees
const POCKET_NEAR = 5.5;    // inside this, the residue is pocket wall
const POCKET_FAR = 9.5;     // beyond this, the ligand does not matter

// Residues that help a loop turn.
const LOOP_FRIENDLY = { G: 1.00, P: 0.70, S: 0.60, N: 0.65, D: 0.60, T: 0.35 };

const clip01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Letter to column of the score vector.
const AA_INDEX = {};
for (let k = 0; k < AA.length; k++) AA_INDEX[AA[k]] = k;

// --------------------------------------------------------------- features

// Measure the input of the score for every residue of a design.
// Returns { n, burial, burialRank, neighbours, hse, ligDist, pocket, ss,
//           pack }.
//   pack       pack[i] is the list of residues inside PACK_CUT of i
//   burial     0 exposed to 1 buried, from half-sphere exposure
//   burialRank the rank of the same count inside this design, 0 to 1
//   ligDist angstroms from the C-beta point to the nearest ligand atom
//   pocket  0 far from the ligand to 1 against it
export function residueFeatures(design) {
  const n = design.n;
  if (!Number.isInteger(n) || n < 1) throw new Error('design has no residue count');
  const { ca, cb } = design;
  if (!(ca instanceof Float32Array) || !(cb instanceof Float32Array)) throw new Error('design needs ca and cb as Float32Array');
  const ss = typeof design.ss === 'string' && design.ss.length === n ? design.ss : 'L'.repeat(n);
  const burial = new Float32Array(n);
  const burialRank = new Float32Array(n);
  const hse = new Int32Array(n);
  const neighbours = new Int32Array(n);
  const ligDist = new Float32Array(n);
  const pocket = new Float32Array(n);
  const pack = Array.from({ length: n }, () => []);
  const hseCut2 = HSE_CUT * HSE_CUT, nbCut2 = NB_CUT * NB_CUT, packCut2 = PACK_CUT * PACK_CUT;

  for (let i = 0; i < n; i++) {
    const a = i * 3;
    const ux = cb[a] - ca[a], uy = cb[a + 1] - ca[a + 1], uz = cb[a + 2] - ca[a + 2];
    const uL = Math.hypot(ux, uy, uz) || 1;
    let hseCount = 0, nb = 0;
    for (let j = 0; j < n; j++) {
      if (j === i || Math.abs(j - i) < 2) continue;
      const b = j * 3;
      const dx = cb[b] - ca[a], dy = cb[b + 1] - ca[a + 1], dz = cb[b + 2] - ca[a + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < nbCut2) nb++;
      if (d2 < packCut2) pack[i].push(j);
      if (d2 > hseCut2) continue;
      // The side-chain side of the residue only.
      if ((dx * ux + dy * uy + dz * uz) / uL > 0) hseCount++;
    }
    neighbours[i] = nb;
    hse[i] = hseCount;
    burial[i] = clip01((hseCount - HSE_LO) / (HSE_HI - HSE_LO));
    let best = Infinity;
    const atoms = (design.ligand && design.ligand.atoms) || [];
    for (const at of atoms) {
      const dx = cb[a] - at.x, dy = cb[a + 1] - at.y, dz = cb[a + 2] - at.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) best = d2;
    }
    ligDist[i] = atoms.length ? Math.sqrt(best) : Infinity;
    pocket[i] = atoms.length ? clip01((POCKET_FAR - ligDist[i]) / (POCKET_FAR - POCKET_NEAR)) : 0;
  }
  // The burial rank. Ties share the mean rank of the tie, so the rank
  // does not depend on the order of the residues.
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => hse[a] - hse[b]);
  for (let k = 0; k < n;) {
    let q = k;
    while (q + 1 < n && hse[order[q + 1]] === hse[order[k]]) q++;
    const mean = n > 1 ? ((k + q) / 2) / (n - 1) : 0.5;
    for (let t = k; t <= q; t++) burialRank[order[t]] = mean;
    k = q + 1;
  }
  return { n, burial, burialRank, hse, neighbours, ligDist, pocket, ss, pack };
}

// ------------------------------------------------------------------ score

// Score the twenty amino acids at one residue. Returns a Float64Array of
// twenty scores, in the order of AA.
function scorePosition(f, i) {
  const out = new Float64Array(20);
  const bur = f.burial[i];
  const rank = f.burialRank[i];
  // The burial factor runs -1 for the most exposed residue to +1 for the
  // most enclosed one.
  const bf0 = 2 * rank - 1;
  const bf = bf0 > 0 ? bf0 : bf0 * EXPOSED_SOFT;
  const crowd = clip01((f.neighbours[i] - CROWD_LO) / (CROWD_HI - CROWD_LO)) * bur;
  const st = f.ss[i];
  const pk = f.pocket[i];
  for (let k = 0; k < 20; k++) {
    const a = AA[k], info = AA_INFO[a];
    let s = 0;
    // 1. burial against hydropathy.
    s += WEIGHTS.burial * (info.hydropathy / 4.5) * bf;
    // 2. natural abundance, against a 5 percent reference.
    s += WEIGHTS.prior * Math.log(AA_FREQ[a] / 5.0);
    // 3. structure propensity.
    if (st === 'H') s += WEIGHTS.ss * (info.helixProp - 1.0);
    else if (st === 'E') s += WEIGHTS.ss * (info.sheetProp - 1.0);
    else {
      s -= WEIGHTS.ss * 0.25 * Math.max(0, Math.max(info.helixProp, info.sheetProp) - 1.0);
      s += WEIGHTS.loop * (LOOP_FRIENDLY[a] || 0);
    }
    // 4. pocket lining.
    s += WEIGHTS.pocket * pk * POCKET_PREF[a];
    // 5. a buried charge has no water to hold it.
    s -= WEIGHTS.charge * Math.abs(info.charge) * bur;
    // 6. a crowded core has no room for a large side chain.
    const over = Math.max(0, (info.volume - 170) / 60);
    s -= WEIGHTS.volume * crowd * over * over;
    // 7. special rules.
    if (a === 'C') s -= 1.20;                                  // reactive, so avoided
    if (a === 'M' && i === 0) s += 2.50;                       // the chain starts with methionine
    if (a === 'P' && (st === 'H' || st === 'E')) s -= 3.00;     // proline breaks both
    out[k] = s;
  }
  return out;
}

// Turn scores into probabilities at a temperature.
function softmax(s, temperature) {
  const t = Math.max(1e-3, temperature);
  let max = -Infinity;
  for (let k = 0; k < s.length; k++) if (s[k] > max) max = s[k];
  const p = new Float64Array(s.length);
  let sum = 0;
  for (let k = 0; k < s.length; k++) { p[k] = Math.exp((s[k] - max) / t); sum += p[k]; }
  for (let k = 0; k < s.length; k++) p[k] /= sum;
  return p;
}

// Draw one index from a probability vector.
function drawFrom(p, u) {
  let acc = 0;
  for (let k = 0; k < p.length; k++) { acc += p[k]; if (u <= acc) return k; }
  return p.length - 1;
}

// --------------------------------------------------------------- designer

// Choose amino acids for a design.
//   design       a Design from scaffold.js or design.js
//   motif        the built motif, for the identity of each held residue
//   seed         the random seed; the same seed gives the same ensemble
//   temperature  softmax temperature; the repository default is 0.1
//   nSeq         how many sequences to return
// Returns [ { seq, logp, perResidue, fixedCount, temperature, seed } ].
//   seq         a string of n letters
//   logp        the total log probability of the free residues
//   perResidue  [ { i, aa, p, logp, fixed, ss, burial, ligDist, pocket,
//                   top: [ { aa, p } ] } ]
export function designSequence(design, motif, opts = {}) {
  const { seed = 0, temperature = 0.1, nSeq = 1 } = opts;
  if (!Number.isInteger(nSeq) || nSeq < 1 || nSeq > 64) throw new Error(`nSeq must be an integer 1..64, got ${nSeq}`);
  if (!(temperature > 0) || temperature > 10) throw new Error(`temperature must be above 0 and at most 10, got ${temperature}`);
  const n = design.n;
  const f = residueFeatures(design);
  const rand = rng(seed >>> 0);

  // The identity of every held residue. The motif decides it, and the
  // design's own letter is the fallback.
  const held = new Array(n).fill(null);
  const resList = (motif && Array.isArray(motif.residues)) ? motif.residues : [];
  for (let i = 0; i < n; i++) {
    if (!design.fixed || !design.fixed[i]) continue;
    const mi = design.motifId ? design.motifId[i] : -1;
    const r = mi >= 0 ? resList[mi] : null;
    let code = r && typeof r.code === 'string' ? r.code : null;
    if (!code && typeof design.seq === 'string') code = design.seq[i];
    held[i] = code && AA.includes(code) ? code : null;
  }

  // The six scores of a position do not change between the samples, so
  // they are computed once. Only the repeat penalty changes.
  const base = new Array(n);
  for (let i = 0; i < n; i++) base[i] = held[i] ? null : scorePosition(f, i);

  const out = [];
  const index = AA_INDEX;
  for (let s = 0; s < nSeq; s++) {
    // A new decoding order for every sample.
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const pick = new Array(n).fill(null);
    const prob = new Array(n).fill(null);
    let logp = 0;
    for (const i of order) {
      if (held[i]) { pick[i] = held[i]; continue; }
      const sc = Float64Array.from(base[i]);
      // What the decoded neighbours already took.
      for (const j of f.pack[i]) {
        if (pick[j] === null) continue;
        sc[index[pick[j]]] -= WEIGHTS.repeat;
      }
      const pv = softmax(sc, temperature);
      const k = drawFrom(pv, rand());
      pick[i] = AA[k];
      prob[i] = pv;
      logp += Math.log(Math.max(1e-300, pv[k]));
    }
    const perResidue = new Array(n);
    let seq = '';
    for (let i = 0; i < n; i++) {
      const aa = pick[i];
      seq += aa;
      const pv = prob[i];
      const p = pv ? pv[index[aa]] : 1;
      const top = [];
      if (pv) {
        const rank = Array.from(pv, (v, k) => [AA[k], v]).sort((a, b) => b[1] - a[1]).slice(0, 3);
        for (const [letter, v] of rank) top.push({ aa: letter, p: v });
      } else top.push({ aa, p: 1 });
      perResidue[i] = {
        i, aa, p, logp: Math.log(Math.max(1e-300, p)),
        fixed: !!held[i], ss: f.ss[i],
        burial: f.burial[i], burialRank: f.burialRank[i],
        ligDist: f.ligDist[i], pocket: f.pocket[i], top,
      };
    }
    out.push({ seq, logp, perResidue, fixedCount: held.filter(Boolean).length, temperature, seed: seed >>> 0 });
  }
  return out;
}

// --------------------------------------------------------- structure guess

// Guess the structure state of a sequence, with no coordinates. The guess
// is a Chou-Fasman window average: a window of six residues that favours
// a helix becomes 'H', a window of five that favours a strand becomes
// 'E', and the rest is 'L'. The guess is what the self-consistency
// refold in metrics.js is allowed to know about the sequence.
export function predictSS(seq) {
  const n = seq.length;
  const out = new Array(n).fill('L');
  if (n < 6) return out.join('');
  const pa = new Float64Array(n), pb = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const info = AA_INFO[seq[i]];
    pa[i] = info ? info.helixProp : 1.0;
    pb[i] = info ? info.sheetProp : 1.0;
  }
  const mean = (arr, i, w) => {
    let s = 0;
    for (let k = 0; k < w; k++) s += arr[i + k];
    return s / w;
  };
  const formers = (arr, i, w, lim) => {
    let c = 0;
    for (let k = 0; k < w; k++) if (arr[i + k] >= lim) c++;
    return c;
  };
  // Chou-Fasman nucleation: four helix formers in six residues, a window
  // mean above 1.03, and the helix mean above the strand mean.
  for (let i = 0; i + 6 <= n; i++) {
    const a = mean(pa, i, 6), b = mean(pb, i, 6);
    if (formers(pa, i, 6, 1.0) >= 4 && a > 1.03 && a > b + 0.03) for (let k = 0; k < 6; k++) out[i + k] = 'H';
  }
  // Three strand formers in five residues, and the strand mean above the
  // helix mean.
  for (let i = 0; i + 5 <= n; i++) {
    let clear = true;
    for (let k = 0; k < 5; k++) if (out[i + k] === 'H') { clear = false; break; }
    if (!clear) continue;
    const a = mean(pa, i, 5), b = mean(pb, i, 5);
    if (formers(pb, i, 5, 1.05) >= 3 && b > 1.05 && b > a + 0.03) for (let k = 0; k < 5; k++) out[i + k] = 'E';
  }
  // Drop a run that is too short to be real, the same rule the
  // scaffolder uses on its own latent state.
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

// ------------------------------------------------------------- the ensemble

// Read an ensemble of sequences. The paper's stated enabler was scoring a
// backbone by an ensemble, so the page shows how much the ensemble agrees.
// Returns { n, nSeq, perPosition: Float32Array, mean, consensus, identity }.
//   perPosition  the share of the ensemble that holds the most common
//                letter at that position, 1/nSeq to 1
//   mean         the average of perPosition
//   consensus    the most common letter at every position
//   identity     the mean identity of every pair of sequences
export function ensembleAgreement(seqs) {
  const list = seqs.map((s) => (typeof s === 'string' ? s : s.seq));
  if (!list.length) throw new Error('ensembleAgreement needs at least one sequence');
  const n = list[0].length;
  for (const s of list) if (s.length !== n) throw new Error('the sequences have different lengths');
  const perPosition = new Float32Array(n);
  let consensus = '';
  for (let i = 0; i < n; i++) {
    const count = new Map();
    for (const s of list) count.set(s[i], (count.get(s[i]) || 0) + 1);
    let bestLetter = list[0][i], bestCount = 0;
    for (const [letter, c] of count) if (c > bestCount || (c === bestCount && letter < bestLetter)) { bestLetter = letter; bestCount = c; }
    perPosition[i] = bestCount / list.length;
    consensus += bestLetter;
  }
  let mean = 0;
  for (let i = 0; i < n; i++) mean += perPosition[i];
  mean /= n || 1;
  let identity = 1, pairs = 0, acc = 0;
  for (let a = 0; a < list.length; a++) {
    for (let b = a + 1; b < list.length; b++) {
      let same = 0;
      for (let i = 0; i < n; i++) if (list[a][i] === list[b][i]) same++;
      acc += same / n; pairs++;
    }
  }
  if (pairs) identity = acc / pairs;
  return { n, nSeq: list.length, perPosition, mean, consensus, identity };
}
