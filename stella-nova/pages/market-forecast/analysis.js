// ============================================================================
//  ANALYSIS  ·  pages/market-forecast/analysis.js — portfolio and backtest
// ----------------------------------------------------------------------------
//  Pure maths, no DOM. Two jobs:
//
//  1. The portfolio distribution at the horizon end. Each model gives a
//     set of quantiles per ticker (the marginal distribution only). A
//     Gaussian copula joins them:
//        z = L * eps          eps ~ N(0, I), L L^T = the correlation matrix
//        price_i = Q_i(Phi(z_i))   Q_i: the quantile function of ticker i
//        total   = sum shares_i * price_i
//     The correlation comes from the historical log returns (Pearson,
//     shrunk to the identity). corr = null gives independent positions.
//     The copula is an assumption: the models do not give a joint
//     distribution, and a Gaussian copula has no tail dependence.
//
//  2. A rolling-origin backtest. For each origin the model sees the bars
//     up to the origin only, and the realised bars after it score the
//     forecast: 80 % band coverage, reliability per level, and the
//     weighted quantile loss (WQL) against two baselines that see the
//     same past only (naive last value, seasonal naive).
//
//  Quantile function (quantileFn): the model gives values at some levels
//  (for example 0.1..0.9). Between two levels the value is linear in
//  z = normInv(p). Out of the outermost levels the value continues the
//  slope of the outermost segment in z. That is a Gaussian-like tail
//  assumption: the model says nothing about p < 0.1 or p > 0.9 for
//  Chronos-Bolt, and that tail is only an estimate. Values are first made
//  non-decreasing (a running maximum), because quantile outputs can cross.
//
//  grep -n targets
//    normal cdf/inverse .. "export function normCdf"  "export function normInv"
//    quantile function ... "export function quantileFn"
//    correlation ......... "export function corrMatrix"  "export function cholesky"
//    portfolio ........... "export function portfolio"
//    losses .............. "export function pinball"  "export function wql"
//    backtest ............ "export function backtest"
//    origins ............. "export function pickOrigins"
// ============================================================================
import { rng } from './synth.js';

// ── normal distribution ─────────────────────────────────────────────────────
// Upper tail Q(x) = 1 - Phi(x) for x >= 0: Marsaglia (2004) "Evaluating the
// Normal Distribution", a Taylor series about the nearest even point,
// absolute error near 1e-15. |x| is clamped to 15.
const MR = [1.25331413731550025, 0.421369229288054473, 0.236652382913560671, 0.162377660896867462,
  0.127475730055354430, 0.104748432079012453, 0.0899423419058213487, 0.0786890447926457803, 0.0699262021447627108];
function upperTail(x) {
  x = Math.min(Math.abs(x), 15);
  const j = Math.floor(0.5 * (x + 1));
  let a = MR[j], z = 2 * j, b = a * z - 1, h = x - z, s = a + h * b, t = a, q = h * h, pwr = 1;
  for (let i = 2; s !== t && i < 200; i += 2) { a = (a + z * b) / i; b = (b + z * a) / (i + 1); pwr *= q; t = s; s = t + pwr * (a + h * b); }
  return s * Math.exp(-0.5 * x * x - 0.91893853320467274178);
}
export function normCdf(x) {
  if (x !== x) return NaN;
  return x < 0 ? upperTail(-x) : 1 - upperTail(x);
}
// Acklam's rational approximation, then one Halley step on normCdf.
const A = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
const B = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
const C = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
const D = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
export function normInv(p) {
  if (!(p > 0)) return p === 0 ? -Infinity : NaN;
  if (!(p < 1)) return p === 1 ? Infinity : NaN;
  let x;
  if (p < 0.02425) { const q = Math.sqrt(-2 * Math.log(p)); x = (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1); }
  else if (p > 1 - 0.02425) { const q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1); }
  else { const q = p - 0.5, r = q * q; x = (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1); }
  // Halley refinement. err = Phi(x) - p, from the tail on the near side,
  // so a small p keeps its precision.
  const err = x < 0 ? upperTail(-x) - p : (1 - p) - upperTail(x);
  const u = err * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
  return x - u / (1 + x * u / 2);
}

// ── quantile function ───────────────────────────────────────────────────────
// quantileFn(levels, values) -> f(p); f.atZ(z) is the same in z = normInv(p).
export function quantileFn(levels, values) {
  const n = levels.length;
  const z = Float64Array.from(levels, normInv);
  const v = Float64Array.from(values);
  for (let k = 1; k < n; k++) if (v[k] < v[k - 1]) v[k] = v[k - 1];
  const atZ = x => {
    if (n === 1) return v[0];
    if (x <= z[0]) return v[0] + (x - z[0]) * (v[1] - v[0]) / (z[1] - z[0]);
    if (x >= z[n - 1]) return v[n - 1] + (x - z[n - 1]) * (v[n - 1] - v[n - 2]) / (z[n - 1] - z[n - 2]);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (z[m] <= x) lo = m; else hi = m; }
    return v[lo] + (x - z[lo]) * (v[hi] - v[lo]) / (z[hi] - z[lo]);
  };
  const f = p => atZ(normInv(Math.min(1 - 1e-12, Math.max(1e-12, p))));
  f.atZ = atZ;
  return f;
}
// Values at other levels (for example 0.25 and 0.75 for the inner band).
export function interpLevels(levels, values, want) {
  const f = quantileFn(levels, values);
  return want.map(p => { const k = levels.indexOf(p); return k >= 0 ? values[k] : f(p); });
}

// ── returns and correlation ─────────────────────────────────────────────────
export function logReturns(c) {
  const r = new Float64Array(Math.max(0, c.length - 1));
  for (let i = 1; i < c.length; i++) r[i - 1] = c[i] > 0 && c[i - 1] > 0 ? Math.log(c[i] / c[i - 1]) : NaN;
  return r;
}
// Pearson correlation of aligned rows (pairwise, finite values only), then
// (1 - shrink) R + shrink I. Rows can have different lengths; they are
// aligned at the end (the newest values).
export function corrMatrix(rows, shrink = 0.1) {
  const n = rows.length, R = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    R[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const a = rows[i], b = rows[j], m = Math.min(a.length, b.length), oa = a.length - m, ob = b.length - m;
      let k = 0, sa = 0, sb = 0;
      for (let t = 0; t < m; t++) { const x = a[oa + t], y = b[ob + t]; if (Number.isFinite(x) && Number.isFinite(y)) { sa += x; sb += y; k++; } }
      let r = 0;
      if (k > 2) {
        const ma = sa / k, mb = sb / k; let xy = 0, xx = 0, yy = 0;
        for (let t = 0; t < m; t++) { const x = a[oa + t], y = b[ob + t]; if (Number.isFinite(x) && Number.isFinite(y)) { xy += (x - ma) * (y - mb); xx += (x - ma) ** 2; yy += (y - mb) ** 2; } }
        r = xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0;
      }
      R[i][j] = R[j][i] = (1 - shrink) * r;
    }
  }
  return R;
}
// Lower Cholesky factor. If A is not positive definite, add a growing
// jitter to the diagonal (1e-10 .. 1e-2) and try again.
export function cholesky(A) {
  const n = A.length;
  for (let jit = 0; jit <= 1e-2; jit = jit ? jit * 10 : 1e-10) {
    const L = Array.from({ length: n }, () => new Float64Array(n));
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      for (let j = 0; j <= i; j++) {
        let s = A[i][j] + (i === j ? jit : 0);
        for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        if (i === j) { if (!(s > 0)) { ok = false; break; } L[i][i] = Math.sqrt(s); }
        else L[i][j] = s / L[j][j];
      }
    }
    if (ok) return L;
  }
  throw new Error('cholesky: matrix is not positive definite');
}

// ── sample statistics ───────────────────────────────────────────────────────
function sortedQ(sorted, p) {
  const n = sorted.length; if (!n) return NaN;
  const x = p * (n - 1), i = Math.floor(x), f = x - i;
  return i + 1 < n ? sorted[i] + f * (sorted[i + 1] - sorted[i]) : sorted[n - 1];
}
function histogram(samples, bins = 60, lo, hi) {
  if (lo === undefined || hi === undefined) {
    const s = Float64Array.from(samples).sort();
    lo = lo ?? sortedQ(s, 0.002); hi = hi ?? sortedQ(s, 0.998);
  }
  if (!(hi > lo)) hi = lo + 1;
  const counts = new Float64Array(bins), w = (hi - lo) / bins;
  for (const x of samples) { const k = Math.floor((x - lo) / w); if (k >= 0 && k < bins) counts[k]++; }
  const edges = Float64Array.from({ length: bins + 1 }, (_, k) => lo + k * w);
  return { edges, counts, lo, hi };
}

// ── portfolio ───────────────────────────────────────────────────────────────
// positions: [{ sym, shares, price, costBasis?, levels, endQ }]
// corr: n x n matrix or null (independent). Result: see the header and
// the fields below. Deterministic for a seed.
export function portfolio({ positions, corr = null, n = 20000, seed = 1, compareIndependent = false }) {
  const P = positions.length;
  const fns = positions.map(p => quantileFn(p.levels, p.endQ));
  const L = corr ? cholesky(corr) : null;
  const R = rng(seed);
  const total = new Float64Array(n);
  const vals = positions.map(() => new Float64Array(n));
  const eps = new Float64Array(P), z = new Float64Array(P);
  for (let s = 0; s < n; s++) {
    for (let i = 0; i < P; i++) eps[i] = R.n();
    if (L) for (let i = 0; i < P; i++) { let a = 0; for (let k = 0; k <= i; k++) a += L[i][k] * eps[k]; z[i] = a; }
    else z.set(eps);
    let t = 0;
    for (let i = 0; i < P; i++) { const v = positions[i].shares * fns[i].atZ(z[i]); vals[i][s] = v; t += v; }
    total[s] = t;
  }
  const now = positions.reduce((a, p) => a + p.shares * p.price, 0);
  const sorted = Float64Array.from(total).sort();
  const q = {};
  for (const p of [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99]) q['p' + String(Math.round(p * 100)).padStart(2, '0')] = sortedQ(sorted, p);
  let mean = 0, up = 0;
  for (let s = 0; s < n; s++) { mean += total[s]; if (total[s] > now) up++; }
  mean /= n;
  let varT = 0; for (let s = 0; s < n; s++) varT += (total[s] - mean) ** 2; varT /= n;
  let tail = 0, tn = 0;
  for (let s = 0; s < n; s++) if (total[s] <= q.p05) { tail += now - total[s]; tn++; }
  const perPos = positions.map((p, i) => {
    const v = vals[i], vs = Float64Array.from(v).sort(), pnow = p.shares * p.price;
    let m = 0, c = 0, u = 0;
    for (let s = 0; s < n; s++) m += v[s]; m /= n;
    for (let s = 0; s < n; s++) { c += (v[s] - m) * (total[s] - mean); if (v[s] > pnow) u++; }
    return { sym: p.sym, now: pnow, pUp: u / n, q10: sortedQ(vs, 0.1), q50: sortedQ(vs, 0.5), q90: sortedQ(vs, 0.9), contrib: varT > 0 ? c / n / varT : 0 };
  });
  const res = {
    samples: total, now, q, mean, sd: Math.sqrt(varT), pUp: up / n,
    var95: now - q.p05, es95: tn ? tail / tn : 0, range80: [q.p10, q.p90],
    perPos, correlated: !!corr, n,
    histogram: (bins, lo, hi) => histogram(total, bins, lo, hi),
  };
  if (compareIndependent && corr) {
    const ind = portfolio({ positions, corr: null, n, seed, compareIndependent: false });
    res.indep = ind;
  }
  return res;
}

// ── losses ──────────────────────────────────────────────────────────────────
export function pinball(y, qv, tau) { return y >= qv ? tau * (y - qv) : (1 - tau) * (qv - y); }
// rows: [{ y, q: number[] (one value per level), levels }]
// WQL = mean over levels of 2 * sum_rows pinball / sum_rows |y|
// (the GluonTS "mean weighted sum quantile loss").
export function wql(rows) {
  if (!rows.length) return NaN;
  const K = rows[0].levels.length;
  let den = 0; const num = new Float64Array(K);
  for (const r of rows) { den += Math.abs(r.y); for (let k = 0; k < K; k++) num[k] += pinball(r.y, r.q[k], r.levels[k]); }
  if (!(den > 0)) return NaN;
  let s = 0; for (let k = 0; k < K; k++) s += 2 * num[k] / den;
  return s / K;
}

// Empirical quantiles of the log ratio c[j + lag] / c[j] for j + lag <= end
// and j >= end - window. No value after end is read.
function empiricalLogQ(c, end, lag, window, levels) {
  const out = [];
  for (let j = Math.max(0, end - window); j + lag <= end; j++) {
    const a = c[j], b = c[j + lag];
    if (a > 0 && b > 0) out.push(Math.log(b / a));
  }
  if (out.length < 3) return levels.map(() => 0);
  const s = Float64Array.from(out).sort();
  return levels.map(p => sortedQ(s, p));
}

// ── backtest ────────────────────────────────────────────────────────────────
// closes: the full series. origins: index of the last bar the model saw.
// forecasts[o][k]: H values of level k for origin o (steps origin+1..+H).
export function backtest({ closes, origins, H, levels, forecasts, season = 78, window = 500 }) {
  const K = levels.length;
  const w80 = interpIdx(levels);
  const rowsM = [], rowsN = [], rowsS = [];
  const below = new Float64Array(K);
  let nCov = 0, inCov = 0, nEnd = 0, inEnd = 0, maeM = 0, maeN = 0, nMae = 0, nRel = 0;
  const perOrigin = [];
  origins.forEach((o, oi) => {
    const fc = forecasts[oi];
    const base = closes[o];
    const qN = Array.from({ length: H }, (_, h) => empiricalLogQ(closes, o, h + 1, window, levels));
    const oRows = []; let oIn = 0, oN = 0, end = null;
    for (let h = 0; h < H; h++) {
      const t = o + h + 1;
      if (t >= closes.length) break;
      const y = closes[t];
      if (!Number.isFinite(y)) continue;
      const qv = levels.map((_, k) => fc[k][h]);
      const [q10, q50, q90] = w80(qv);
      rowsM.push({ y, q: qv, levels }); oRows.push({ y, q: qv, levels });
      const qnv = qN[h].map(x => base * Math.exp(x));
      rowsN.push({ y, q: qnv, levels });
      // Seasonal naive: the value k seasons before the target, k = ceil(h/season).
      const kS = Math.ceil((h + 1) / season), src = t - kS * season;
      if (src >= 0) {
        const qs = empiricalLogQ(closes, o, kS * season, window, levels);
        rowsS.push({ y, q: qs.map(x => closes[src] * Math.exp(x)), levels });
      }
      const inside = y >= q10 && y <= q90;
      nCov++; oN++; if (inside) { inCov++; oIn++; }
      for (let k = 0; k < K; k++) if (y <= qv[k]) below[k]++;
      nRel++;
      maeM += Math.abs(y - q50); maeN += Math.abs(y - base); nMae++;
      if (h === H - 1) { nEnd++; if (inside) inEnd++; const [n10, n50, n90] = w80(qnv); end = { y, q10, q50, q90, naive: { q10: n10, q50: n50, q90: n90 } }; }
    }
    perOrigin.push({ origin: o, wql: wql(oRows), covered: oN ? oIn / oN : NaN, end });
  });
  const wqlModel = wql(rowsM), wqlNaive = wql(rowsN), wqlSeasonal = wql(rowsS);
  return {
    n: origins.length, steps: nCov,
    coverage80: nCov ? inCov / nCov : NaN, coverage80End: nEnd ? inEnd / nEnd : NaN,
    wqlModel, wqlNaive, wqlSeasonal,
    skillNaive: 1 - wqlModel / wqlNaive, skillSeasonal: 1 - wqlModel / wqlSeasonal,
    // MAE of the model median over MAE of the last value (< 1 is better).
    maseMedian: maeN > 0 ? maeM / maeN : NaN,
    reliability: levels.map((tau, k) => ({ tau, observed: nRel ? below[k] / nRel : NaN })),
    // perOrigin[i].end: the realised value and the model and naive
    // q10/q50/q90 at the last step of origin i.
    perOrigin,
  };
}
// q10, q50, q90 from the values at the model levels.
function interpIdx(levels) {
  const want = [0.1, 0.5, 0.9], idx = want.map(p => levels.indexOf(p));
  if (idx.every(i => i >= 0)) return qv => idx.map(i => qv[i]);
  return qv => interpLevels(levels, qv, want);
}

// Evenly spaced origins, newest last. Each has H bars after it and at
// least minContext bars before it. With stride, origins step back by stride.
export function pickOrigins(len, H, count, stride, minContext = 32) {
  const last = len - 1 - H;
  if (last < minContext || count < 1) return [];
  const out = [];
  if (stride) { for (let i = 0; i < count && last - i * stride >= minContext; i++) out.push(last - i * stride); }
  else if (count === 1) out.push(last);
  else {
    const span = last - minContext;
    for (let i = 0; i < count; i++) out.push(Math.round(last - span * i / (count - 1)));
  }
  return [...new Set(out)].sort((a, b) => a - b);
}
