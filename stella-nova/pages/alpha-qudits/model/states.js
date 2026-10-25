// ============================================================================
//  ALPHA QUDITS  ·  model/states.js  ·  pair kets, swapping, the joint state (MODEL)
// ----------------------------------------------------------------------------
//  pairKet(d1, d2): |omega_m> = sum_{i<m} |i>|i> / sqrt m, m = min(d1, d2),
//  index i * d2 + j. transposeIdentity(A, d1, d2): max difference between
//  (A (x) 1)|omega> and (1 (x) A^T)|omega> on the support. swapping(d):
//  Eq. (S1), <omega|_23 |omega>_12 |omega>_34 = (1/d) |omega>_14.
//  readFarStates(): a read at the qutrit end of a (3, 2) link, in each of
//  the 4 MUBs, leaves the qubit at <e|omega> (one state is zero when e has
//  no part on the support). jointState(): Eq. (S2) built term by term.
//
//  grep -n targets:  export function pairKet | transposeIdentity |
//  swapping | readFarStates | jointState | strandAmplitude
// ============================================================================
import { mubs } from './letters.js';

export function pairKet(d1, d2) {
  const m = Math.min(d1, d2), n = d1 * d2;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < m; i++) re[i * d2 + i] = 1 / Math.sqrt(m);
  return { re, im, d1, d2, m };
}

// A: { re: number[][], im: number[][] } of size d (square, d = m support).
export function transposeIdentity(A, d) {
  const w = pairKet(d, d), n = d * d;
  const L = { re: new Float64Array(n), im: new Float64Array(n) }, Rt = { re: new Float64Array(n), im: new Float64Array(n) };
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) for (let k = 0; k < d; k++) {
    // (A (x) 1): |k, j> -> A_ik |i, j>
    const c = w.re[k * d + j];
    if (c) { L.re[i * d + j] += A.re[i][k] * c; L.im[i * d + j] += A.im[i][k] * c; }
    // (1 (x) A^T): |i, k> -> (A^T)_jk |i, j> = A_kj |i, j>
    const c2 = w.re[i * d + k];
    if (c2) { Rt.re[i * d + j] += A.re[k][j] * c2; Rt.im[i * d + j] += A.im[k][j] * c2; }
  }
  let diff = 0;
  for (let t = 0; t < n; t++) diff = Math.max(diff, Math.abs(L.re[t] - Rt.re[t]), Math.abs(L.im[t] - Rt.im[t]));
  return diff;
}

// Eq. (S1): returns the coefficient c with <w|_23 |w>_12 |w>_34 = c |w>_14,
// plus the per-strand amplitude d^(-3/2).
export function swapping(d) {
  const a = 1 / Math.sqrt(d);
  // result_{1,4}(i, l) = sum_{j,k} conj(w_jk) w_ij w_kl
  const res = Array.from({ length: d }, () => Array(d).fill(0));
  for (let i = 0; i < d; i++) for (let l = 0; l < d; l++) {
    let s = 0;
    for (let j = 0; j < d; j++) for (let k = 0; k < d; k++) s += (j === k ? a : 0) * (i === j ? a : 0) * (k === l ? a : 0);
    res[i][l] = s;
  }
  // res = c * (delta_il / sqrt d)  =>  c = res[0][0] * sqrt d
  const c = res[0][0] * Math.sqrt(d);
  let isPair = true;
  for (let i = 0; i < d; i++) for (let l = 0; l < d; l++) if (Math.abs(res[i][l] - (i === l ? c * a : 0)) > 1e-12) isPair = false;
  return { coefficient: c, isPair, strandAmplitude: a ** 3, terms: d };
}

// A read at the qutrit end of a (3, 2) link in basis b leaves the qubit,
// for each element e, at <e|_Q |omega_2> = sum_{i<2} conj(e_i) |i> / sqrt 2.
export function readFarStates() {
  return mubs(3).map((basis, b) => basis.map((e, k) => {
    const re = [e.re[0] / Math.SQRT2, e.re[1] / Math.SQRT2], im = [-e.im[0] / Math.SQRT2, -e.im[1] / Math.SQRT2];
    const norm2 = re[0] ** 2 + re[1] ** 2 + im[0] ** 2 + im[1] ** 2;
    return { basis: b, element: k, re, im, norm2, zero: norm2 < 1e-12 };
  }));
}

// Eq. (S2): |Omega> = sqrt6 (P3)_{Q1Q2} |w2>_{Q1q1} |w2>_{Q2q2} |w2>_{Q3f}.
// Built on the 216-dim space Q1(3) q1(2) Q2(3) q2(2) Q3(3) f(2).
export function jointState() {
  const dims = [3, 2, 3, 2, 3, 2];
  const idx = t => t.reduce((s, x, k) => s * dims[k] + x, 0);
  const n = dims.reduce((a, b) => a * b, 1);
  const v = new Float64Array(n);
  const h = 1 / Math.SQRT2;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let l = 0; l < 2; l++) v[idx([i, i, j, j, l, l])] = h * h * h;
  // P3 = |w3><w3| on Q1 Q2: amplitude <w3|Q1Q2 = sum_a <a a| / sqrt3.
  const w = new Float64Array(n), r3 = 1 / Math.sqrt(3);
  for (let q1 = 0; q1 < 2; q1++) for (let q2 = 0; q2 < 2; q2++) for (let Q3 = 0; Q3 < 3; Q3++) for (let f = 0; f < 2; f++) {
    let amp = 0;
    for (let a = 0; a < 3; a++) amp += r3 * v[idx([a, q1, a, q2, Q3, f])];
    if (!amp) continue;
    for (let a = 0; a < 3; a++) w[idx([a, q1, a, q2, Q3, f])] += r3 * amp;
  }
  let norm2 = 0; for (const x of w) norm2 += x * x;
  const s6 = Math.sqrt(6), terms = [];
  for (let t = 0; t < n; t++) if (Math.abs(w[t]) > 1e-12) {
    const c = []; let r = t; for (let k = 5; k >= 0; k--) { c[k] = r % dims[k]; r = Math.floor(r / dims[k]); }
    terms.push({ Q1: c[0], q1: c[1], Q2: c[2], q2: c[3], Q3: c[4], f: c[5], amp: w[t] * s6 });
  }
  return { terms, projectedNorm2: norm2, joinProbability: norm2, normalizer: s6 };
}

// A path q1 -> Q1 -> Q2 -> q2 crosses one strand of each pair it uses.
export function strandAmplitude(dims = [2, 3, 2]) { return dims.reduce((p, d) => p / Math.sqrt(d), 1); }
