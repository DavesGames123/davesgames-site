// ============================================================================
//  FACET HEAD MODEL  ·  model.js — global PCA and the regional model
// ----------------------------------------------------------------------------
//  Two toy models, both trained on the same pool of N heads (head.js):
//
//  Global PCA: one basis over all 2 * N_V coordinates. Centering costs one
//  dimension, so it has at most N - 1 modes (the rank wall).
//
//  Regional: per region r, one PCA of the vertex positions on its support
//  and one PCA of the Laplacian coordinates there (FACET Sec. 3.1). Each has
//  up to N - 1 modes, so the model has up to 2 * R * (N - 1) coefficients.
//  A fit predicts per-region targets xi_r (positions) and delta_r
//  (Laplacians); the blend weights of head.js mix them per vertex, and the
//  vertices come from one weighted least-squares solve:
//      p* = argmin |L p - delta|^2 + lambda^2 |p - xi|^2
//  with the uniform curve Laplacian L (FACET uses the cotangent Laplacian
//  on its 3D mesh) and lambda = 0.58 as in the paper. The normal matrix
//  L^T L + lambda^2 I is factored once (Cholesky) and reused.
//
//  Fits are least-squares projections onto the first k modes. The paper's
//  global baseline adds a MAP prior; ours does not.
//
//  grep -n: "function pca"  "export function globalModel"
//           "export function regionalModel"  "export function solve"
//           "export function swap"  "export function cutPaste"
//           "export function curves"  "export function v2v"
// ============================================================================
import { N_V, REGIONS, regionWeights, support, regionOf } from './head.js';

export const LAMBDA = 0.58;

// ── small linear algebra ──
function jacobiEig(A, n) {        // symmetric n x n in a Float64Array, returns {vals, vecs (column-major)}
  const a = Float64Array.from(A), V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p * n + q] ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      const apq = a[p * n + q];
      if (Math.abs(apq) < 1e-300) continue;
      const th = (a[q * n + q] - a[p * n + p]) / (2 * apq);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const akp = a[k * n + p], akq = a[k * n + q];
        a[k * n + p] = c * akp - s * akq; a[k * n + q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = a[p * n + k], aqk = a[q * n + k];
        a[p * n + k] = c * apk - s * aqk; a[q * n + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = V[k * n + p], vkq = V[k * n + q];
        V[k * n + p] = c * vkp - s * vkq; V[k * n + q] = s * vkp + c * vkq;
      }
    }
  }
  return { vals: Array.from({ length: n }, (_, i) => a[i * n + i]), V };
}

// PCA of rows (arrays of length D) through the N x N Gram matrix.
// Returns { mean, basis: [Float64Array D] (orthonormal, by variance), sd }.
function pca(rows) {
  const N = rows.length, D = rows[0].length, mean = new Float64Array(D);
  for (const r of rows) for (let d = 0; d < D; d++) mean[d] += r[d] / N;
  const X = rows.map(r => { const x = new Float64Array(D); for (let d = 0; d < D; d++) x[d] = r[d] - mean[d]; return x; });
  const G = new Float64Array(N * N);
  for (let i = 0; i < N; i++) for (let j = i; j < N; j++) { let s = 0; for (let d = 0; d < D; d++) s += X[i][d] * X[j][d]; G[i * N + j] = G[j * N + i] = s; }
  const { vals, V } = jacobiEig(G, N);
  const order = vals.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
  const top = order[0][0], basis = [], sd = [];
  for (const [lam, i] of order) {
    if (basis.length >= Math.min(N - 1, D) || lam <= 1e-10 * top) break;
    const e = new Float64Array(D), inv = 1 / Math.sqrt(lam);
    for (let n = 0; n < N; n++) { const u = V[n * N + i] * inv; if (u) for (let d = 0; d < D; d++) e[d] += u * X[n][d]; }
    basis.push(e); sd.push(Math.sqrt(lam / Math.max(1, N - 1)));
  }
  return { mean, basis, sd };
}
const project = (P, x) => P.basis.map(e => { let s = 0; for (let d = 0; d < x.length; d++) s += e[d] * (x[d] - P.mean[d]); return s; });
function rebuild(P, c, k) {
  const out = Float64Array.from(P.mean), m = Math.min(k, c.length, P.basis.length);
  for (let j = 0; j < m; j++) { const e = P.basis[j], cj = c[j]; for (let d = 0; d < out.length; d++) out[d] += cj * e[d]; }
  return out;
}

// ── Laplacian of the open curve: rows 1 .. N_V - 2 ──
export function laplacian(p) {
  const d = new Float64Array(2 * N_V);
  for (let i = 1; i < N_V - 1; i++) for (let c = 0; c < 2; c++) d[2 * i + c] = p[2 * i + c] - 0.5 * (p[2 * (i - 1) + c] + p[2 * (i + 1) + c]);
  return d;
}

// Cholesky of A = L^T L + lambda^2 I (banded, but dense is small here).
let CH = null;
function factor() {
  if (CH) return CH;
  const n = N_V, A = new Float64Array(n * n), l2 = LAMBDA * LAMBDA;
  for (let i = 1; i < n - 1; i++) {
    const idx = [i - 1, i, i + 1], w = [-0.5, 1, -0.5];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) A[idx[a] * n + idx[b]] += w[a] * w[b];
  }
  for (let i = 0; i < n; i++) A[i * n + i] += l2;
  const Lc = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    let s = A[j * n + j];
    for (let k = 0; k < j; k++) s -= Lc[j * n + k] ** 2;
    Lc[j * n + j] = Math.sqrt(s);
    for (let i = j + 1; i < n; i++) {
      let t = A[i * n + j];
      for (let k = 0; k < j; k++) t -= Lc[i * n + k] * Lc[j * n + k];
      Lc[i * n + j] = t / Lc[j * n + j];
    }
  }
  CH = Lc;
  return CH;
}
// Solve for the vertices from blended targets delta (Laplacian) and xi (positions).
export function solve(delta, xi) {
  const n = N_V, Lc = factor(), l2 = LAMBDA * LAMBDA, p = new Float64Array(2 * n);
  for (let c = 0; c < 2; c++) {
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) b[i] = l2 * xi[2 * i + c];
    for (let i = 1; i < n - 1; i++) { const d = delta[2 * i + c]; b[i - 1] -= 0.5 * d; b[i] += d; b[i + 1] -= 0.5 * d; }
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= Lc[i * n + k] * y[k]; y[i] = s / Lc[i * n + i]; }
    for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= Lc[k * n + i] * p[2 * k + c]; p[2 * i + c] = s / Lc[i * n + i]; }
  }
  return p;
}

// ── the two models ──
export function globalModel(train) {
  const P = pca(train.map(h => Array.from(h)));
  return {
    kind: 'global', maxK: P.basis.length, P,
    coeffs: h => project(P, h),
    fit(h, k) { return rebuild(P, project(P, h), k); },
  };
}

const gather = (x, sup) => { const o = new Float64Array(2 * sup.length); sup.forEach((v, j) => { o[2 * j] = x[2 * v]; o[2 * j + 1] = x[2 * v + 1]; }); return o; };
const lapRows = sup => sup.filter(v => v > 0 && v < N_V - 1);

export function regionalModel(train) {
  const R = REGIONS.length, W = regionWeights();
  const sups = REGIONS.map((_, r) => support(r)), lsups = sups.map(lapRows);
  const laps = train.map(laplacian);
  const PP = sups.map(s => pca(train.map(h => gather(h, s))));
  const PL = lsups.map((s, r) => pca(laps.map(d => gather(d, s))));
  const perBasis = Math.min(...PP.map(P => P.basis.length), ...PL.map(P => P.basis.length));
  // coefficients of a head: [{ pos: [...], lap: [...] }] per region
  const coeffs = h => { const d = laplacian(h); return sups.map((s, r) => ({ pos: project(PP[r], gather(h, s)), lap: project(PL[r], gather(d, lsups[r])) })); };
  // targets from per-region coefficients (each entry may come from a different head)
  function assemble(C, k) {
    const xi = new Float64Array(2 * N_V), delta = new Float64Array(2 * N_V);
    for (let r = 0; r < R; r++) {
      const xp = rebuild(PP[r], C[r].pos, k), xl = rebuild(PL[r], C[r].lap, k);
      sups[r].forEach((v, j) => { const w = W[r][v]; xi[2 * v] += w * xp[2 * j]; xi[2 * v + 1] += w * xp[2 * j + 1]; });
      lsups[r].forEach((v, j) => { const w = W[r][v]; delta[2 * v] += w * xl[2 * j]; delta[2 * v + 1] += w * xl[2 * j + 1]; });
    }
    // Laplacian rows: renormalise where a support edge cut the weight sum
    for (let v = 1; v < N_V - 1; v++) {
      let s = 0; for (let r = 0; r < R; r++) if (W[r][v] > 0 && lsups[r].includes(v)) s += W[r][v];
      if (s > 0 && Math.abs(s - 1) > 1e-12) { delta[2 * v] /= s; delta[2 * v + 1] /= s; }
    }
    return solve(delta, xi);
  }
  return {
    kind: 'regional', maxK: 2 * R * perBasis, perBasis, R, PP, PL,
    coeffs, assemble,
    fit(h, K) { return assemble(coeffs(h), Math.max(1, Math.floor(K / (2 * R)))); },
  };
}

// Region swap: A's coefficients, with the chosen regions taken from B.
export function swap(model, a, b, regions, k = model.perBasis) {
  const ca = model.coeffs(a), cb = model.coeffs(b);
  return model.assemble(ca.map((c, r) => regions.includes(r) ? cb[r] : c), k);
}
// The naive edit: copy B's vertices in the chosen regions, no blend, no solve.
export function cutPaste(a, b, regions) {
  const p = Float64Array.from(a);
  for (let v = 0; v < N_V; v++) if (regions.includes(regionOf(v))) { p[2 * v] = b[2 * v]; p[2 * v + 1] = b[2 * v + 1]; }
  return p;
}

// Per-vertex distance and its mean (V2V, mm).
export function errors(p, q) { const e = new Float64Array(N_V); for (let v = 0; v < N_V; v++) e[v] = Math.hypot(p[2 * v] - q[2 * v], p[2 * v + 1] - q[2 * v + 1]); return e; }
export function v2v(p, q) { const e = errors(p, q); let s = 0; for (const x of e) s += x; return s / N_V; }

// Held-out error curves against total coefficient count K.
export function curves(G, Rm, test) {
  const g = [], r = [];
  const gc = test.map(h => G.coeffs(h)), rc = test.map(h => Rm.coeffs(h));
  const ks = new Set();
  for (let k = 1; k <= G.maxK; k = Math.max(k + 1, Math.round(k * 1.25))) ks.add(k);
  ks.add(G.maxK);
  for (const k of [...ks].sort((a, b) => a - b)) {
    let s = 0; test.forEach((h, i) => { s += v2v(rebuild(G.P, gc[i], k), h); }); g.push([k, s / test.length]);
  }
  const kr = new Set();
  for (let k = 1; k <= Rm.perBasis; k = Math.max(k + 1, Math.round(k * 1.25))) kr.add(k);
  kr.add(Rm.perBasis);
  for (const k of [...kr].sort((a, b) => a - b)) {
    let s = 0; test.forEach((h, i) => { s += v2v(Rm.assemble(rc[i], k), h); }); r.push([2 * Rm.R * k, s / test.length]);
  }
  return { global: g, regional: r };
}
