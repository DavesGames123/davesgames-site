// ============================================================================
//  ALPHAFOLD EXPLAINED  ·  co-variation from an MSA  (no DOM)
// ----------------------------------------------------------------------------
//  The classic pre-AlphaFold contact signal, made to run in the page. It is
//  NOT what AlphaFold computes. AlphaFold learns its own use of the MSA. The
//  page uses this score to show why an MSA holds contact information at all.
//
//    weights ... each sequence counts 1 / (number of rows at >= 80% identity)
//    MI ........ mutual information of columns i and j, 21 states (gap too)
//    APC ....... average product correction removes the part of MI that
//                comes from column entropy and shared ancestry
//
//  grep: function couplings  function conservation  function contacts
// ============================================================================
const ALPHA = 'ARNDCQEGHILKMFPSTWYV-';
const IDX = new Uint8Array(128).fill(20);
for (let k = 0; k < ALPHA.length; k++) IDX[ALPHA.charCodeAt(k)] = k;
const Q = 21;

export function encode(rows) {
  const N = rows.length, L = rows[0].length, X = new Uint8Array(N * L);
  for (let s = 0; s < N; s++) for (let i = 0; i < L; i++) X[s * L + i] = IDX[rows[s].charCodeAt(i)];
  return { X, N, L };
}

export function weights({ X, N, L }) {
  const w = new Float64Array(N), thr = 0.8 * L;
  const nb = new Float64Array(N).fill(1);
  for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) {
    let m = 0; const oa = a * L, ob = b * L;
    for (let i = 0; i < L; i++) if (X[oa + i] === X[ob + i]) m++;
    if (m >= thr) { nb[a]++; nb[b]++; }
  }
  for (let s = 0; s < N; s++) w[s] = 1 / nb[s];
  return w;
}

// Per-column conservation: 1 - H / log(21), on the weighted counts.
export function conservation(enc) {
  const { X, N, L } = enc, w = weights(enc), out = new Float32Array(L);
  for (let i = 0; i < L; i++) {
    const f = new Float64Array(Q); let t = 0;
    for (let s = 0; s < N; s++) { f[X[s * L + i]] += w[s]; t += w[s]; }
    let H = 0; for (let a = 0; a < Q; a++) { const p = f[a] / t; if (p > 0) H -= p * Math.log(p); }
    out[i] = 1 - H / Math.log(Q);
  }
  return out;
}

// APC-corrected mutual information, L x L, symmetric, zero on |i-j| < 6.
export function couplings(enc) {
  const { X, N, L } = enc, w = weights(enc);
  let Wt = 0; for (let s = 0; s < N; s++) Wt += w[s];
  const lam = 0.5 / (Wt + 0.5);       // small pseudocount weight
  const fi = new Float64Array(L * Q);
  for (let s = 0; s < N; s++) for (let i = 0; i < L; i++) fi[i * Q + X[s * L + i]] += w[s];
  for (let k = 0; k < L * Q; k++) fi[k] = (1 - lam) * fi[k] / Wt + lam / Q;
  const MI = new Float64Array(L * L), fij = new Float64Array(Q * Q);
  for (let i = 0; i < L; i++) for (let j = i + 1; j < L; j++) {
    fij.fill(0);
    for (let s = 0; s < N; s++) fij[X[s * L + i] * Q + X[s * L + j]] += w[s];
    let mi = 0;
    for (let a = 0; a < Q; a++) for (let b = 0; b < Q; b++) {
      const p = (1 - lam) * fij[a * Q + b] / Wt + lam / (Q * Q);
      mi += p * Math.log(p / (fi[i * Q + a] * fi[j * Q + b]));
    }
    MI[i * L + j] = MI[j * L + i] = mi;
  }
  const row = new Float64Array(L); let all = 0;
  for (let i = 0; i < L; i++) { let t = 0; for (let j = 0; j < L; j++) if (j !== i) t += MI[i * L + j]; row[i] = t / (L - 1); all += t; }
  all /= L * (L - 1);
  const C = new Float32Array(L * L);
  for (let i = 0; i < L; i++) for (let j = 0; j < L; j++)
    C[i * L + j] = Math.abs(i - j) < 6 ? 0 : MI[i * L + j] - row[i] * row[j] / all;
  return C;
}

// True contacts: C-beta distance < 8 Å, |i-j| >= 6. CB is a flat xyz array.
export function contacts(CB, L, cut = 8) {
  const T = new Uint8Array(L * L);
  for (let i = 0; i < L; i++) for (let j = i + 6; j < L; j++) {
    const d = Math.hypot(CB[3*i]-CB[3*j], CB[3*i+1]-CB[3*j+1], CB[3*i+2]-CB[3*j+2]);
    if (d < cut) T[i * L + j] = T[j * L + i] = 1;
  }
  return T;
}

// The top n pairs (i < j) by score, and the fraction that are contacts.
export function topPairs(C, L, n, T) {
  const all = [];
  for (let i = 0; i < L; i++) for (let j = i + 6; j < L; j++) all.push([C[i * L + j], i, j]);
  all.sort((a, b) => b[0] - a[0]);
  const top = all.slice(0, n);
  const hit = T ? top.filter(([, i, j]) => T[i * L + j]).length : 0;
  return { top, precision: T ? hit / n : 0 };
}
