// ============================================================================
//  SCIENCE TOOLKIT  ·  core/stats.js  ·  descriptive statistics and tests
// ----------------------------------------------------------------------------
//  Pure functions on arrays of numbers. Conventions match R and SciPy so
//  that tests.mjs can check them against SciPy results:
//    SD and variance use n − 1. Quartiles are R type 7 (numpy "linear").
//    Skewness is the moment coefficient g1 (scipy.stats.skew, bias=True)
//    and the adjusted G1 (bias=False).
//    t-tests: one sample, paired, Welch (Welch–Satterthwaite df) and
//    Student (pooled variance); two-sided, "less" or "greater".
//    chi-square: goodness of fit and contingency tables (Yates correction
//    only when asked, on a 2 × 2 table).
//    One-way ANOVA with η². Pearson r with the Fisher-z interval;
//    Spearman ρ on average ranks with the t approximation for p (as SciPy).
//    Power of t-tests from the noncentral t law (as statsmodels), and of
//    two proportions with Cohen's h (normal approximation).
//
//  GREP MAP
//    grep -n "export function describe"
//    grep -n "export function ttest"
//    grep -n "export function chisqGof"   and chisqTable
//    grep -n "export function anova1"
//    grep -n "export function pearson"    and spearman
//    grep -n "export function nctCdf"     noncentral t
//    grep -n "export function powerT"     and solveN, powerProp
// ============================================================================
import { DIST, normCdf, normPpf } from './special.js';
import { integrate, brent } from './numeric.js';

const sum = (a) => { let s = 0; for (const x of a) s += x; return s; };
export const mean = (a) => sum(a) / a.length;
export function variance(a) {
  const m = mean(a);
  let s = 0;
  for (const x of a) s += (x - m) ** 2;
  return s / (a.length - 1);
}
export const sd = (a) => Math.sqrt(variance(a));

// R type 7 quantile on sorted data.
export function quantile(sorted, p) {
  const n = sorted.length, h = (n - 1) * p, i = Math.floor(h);
  return i + 1 < n ? sorted[i] + (h - i) * (sorted[i + 1] - sorted[i]) : sorted[n - 1];
}

const need = (a, n, what = 'data') => { if (a.length < n) throw new Error(`Enter at least ${n} values for the ${what}.`); };

export function describe(data, conf = 0.95) {
  need(data, 2);
  const s = [...data].sort((a, b) => a - b), n = s.length, m = mean(s), v = variance(s), sdv = Math.sqrt(v);
  const sem = sdv / Math.sqrt(n), tq = DIST.t.ppf(0.5 + conf / 2, { df: n - 1 });
  let m2 = 0, m3 = 0, m4 = 0;
  for (const x of s) { const d = x - m; m2 += d * d; m3 += d ** 3; m4 += d ** 4; }
  m2 /= n; m3 /= n; m4 /= n;
  const g1 = m3 / m2 ** 1.5, G1 = n > 2 ? g1 * Math.sqrt(n * (n - 1)) / (n - 2) : NaN;
  const g2 = m4 / (m2 * m2) - 3;
  return {
    n, mean: m, median: quantile(s, 0.5), var: v, sd: sdv, sem, ci: [m - tq * sem, m + tq * sem], tq,
    min: s[0], q1: quantile(s, 0.25), q3: quantile(s, 0.75), max: s[n - 1], sum: sum(s),
    skew: g1, skewAdj: G1, kurt: g2, cv: sdv / Math.abs(m), sorted: s,
  };
}

// p-value of a statistic with a symmetric (t) law for an alternative.
function pT(t, df, alt) {
  if (alt === 'less') return DIST.t.cdf(t, { df });
  if (alt === 'greater') return DIST.t.sf(t, { df });
  return Math.min(1, 2 * DIST.t.sf(Math.abs(t), { df }));
}
function ciT(est, se, df, conf, alt) {
  if (alt === 'less') return [-Infinity, est + DIST.t.ppf(conf, { df }) * se];
  if (alt === 'greater') return [est - DIST.t.ppf(conf, { df }) * se, Infinity];
  const q = DIST.t.ppf(0.5 + conf / 2, { df });
  return [est - q * se, est + q * se];
}

// mode: one | paired | welch | student. Returns t, df, p, estimate, ci, d.
export function ttest(mode, a, b = [], { mu = 0, alt = 'two-sided', conf = 0.95 } = {}) {
  if (mode === 'one') {
    need(a, 2, 'sample');
    const n = a.length, m = mean(a), se = sd(a) / Math.sqrt(n), t = (m - mu) / se, df = n - 1;
    return { t, df, p: pT(t, df, alt), est: m, ci: ciT(m, se, df, conf, alt), se, d: (m - mu) / sd(a) };
  }
  if (mode === 'paired') {
    if (a.length !== b.length) throw new Error(`A paired test needs equal lengths (${a.length} and ${b.length}).`);
    const diff = a.map((x, i) => x - b[i]);
    const r = ttest('one', diff, [], { mu, alt, conf });
    return { ...r, est: mean(diff) };
  }
  need(a, 2, 'first sample'); need(b, 2, 'second sample');
  const na = a.length, nb = b.length, ma = mean(a), mb = mean(b), va = variance(a), vb = variance(b);
  let se, df;
  if (mode === 'welch') {
    se = Math.sqrt(va / na + vb / nb);
    df = (va / na + vb / nb) ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1));
  } else {
    df = na + nb - 2;
    const sp2 = ((na - 1) * va + (nb - 1) * vb) / df;
    se = Math.sqrt(sp2 * (1 / na + 1 / nb));
  }
  const est = ma - mb, t = (est - mu) / se;
  const sPool = Math.sqrt(((na - 1) * va + (nb - 1) * vb) / (na + nb - 2));
  return { t, df, p: pT(t, df, alt), est, ci: ciT(est, se, df, conf, alt), se, d: est / sPool, ma, mb };
}

// Goodness of fit. expected: counts or probabilities (scaled to the total),
// or empty for equal cells. ddof: extra parameters fitted from the data.
export function chisqGof(obs, expected = [], ddof = 0) {
  need(obs, 2, 'observed counts');
  const N = sum(obs);
  let e = expected.length ? expected.slice() : obs.map(() => 1);
  if (e.length !== obs.length) throw new Error(`Observed has ${obs.length} cells and expected has ${e.length}.`);
  const se = sum(e);
  e = e.map(x => x * N / se);
  if (e.some(x => !(x > 0))) throw new Error('Every expected count must be greater than 0.');
  const chi2 = obs.reduce((s, o, i) => s + (o - e[i]) ** 2 / e[i], 0);
  const df = obs.length - 1 - ddof;
  return { chi2, df, p: DIST.chi2.sf(chi2, { df }), expected: e, small: e.filter(x => x < 5).length };
}

// Contingency table (rows of counts). yates: continuity correction (2 × 2).
export function chisqTable(t, yates = false) {
  const R = t.length, C = t[0] ? t[0].length : 0;
  if (R < 2 || C < 2) throw new Error('A contingency table needs at least 2 rows and 2 columns.');
  if (t.some(r => r.length !== C)) throw new Error('Every row needs the same number of columns.');
  const rs = t.map(sum), cs = t[0].map((_, j) => sum(t.map(r => r[j]))), N = sum(rs);
  let chi2 = 0;
  const e = t.map((r, i) => r.map((_, j) => rs[i] * cs[j] / N));
  if (e.some(r => r.some(x => !(x > 0)))) throw new Error('A row or a column sums to 0.');
  const corr = yates && R === 2 && C === 2;
  for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
    let d = Math.abs(t[i][j] - e[i][j]);
    if (corr) d = Math.max(0, d - 0.5);
    chi2 += d * d / e[i][j];
  }
  const df = (R - 1) * (C - 1);
  return { chi2, df, p: DIST.chi2.sf(chi2, { df }), expected: e, cramerV: Math.sqrt(chi2 / (N * (Math.min(R, C) - 1))), N, yates: corr };
}

export function anova1(groups) {
  if (groups.length < 2) throw new Error('Enter at least two groups, one per line.');
  groups.forEach((g, i) => need(g, 1, `group ${i + 1}`));
  const all = groups.flat(), N = all.length, k = groups.length, gm = mean(all);
  const ssb = groups.reduce((s, g) => s + g.length * (mean(g) - gm) ** 2, 0);
  const ssw = groups.reduce((s, g) => { const m = mean(g); return s + g.reduce((t, x) => t + (x - m) ** 2, 0); }, 0);
  const df1 = k - 1, df2 = N - k;
  if (df2 < 1) throw new Error('ANOVA needs more values than groups.');
  const msb = ssb / df1, msw = ssw / df2, F = msb / msw;
  return { ssb, ssw, sst: ssb + ssw, df1, df2, msb, msw, F, p: DIST.f.sf(F, { d1: df1, d2: df2 }), eta2: ssb / (ssb + ssw), means: groups.map(mean), ns: groups.map(g => g.length) };
}

export function pearson(x, y, conf = 0.95) {
  if (x.length !== y.length) throw new Error('x and y need the same length.');
  need(x, 3, 'pairs');
  const n = x.length, mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx === 0 || syy === 0) throw new Error('A constant column has no correlation.');
  const r = Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
  const df = n - 2, t = r * Math.sqrt(df / Math.max(1e-300, 1 - r * r));
  const p = Math.abs(r) === 1 ? 0 : 2 * DIST.t.sf(Math.abs(t), { df });
  let ci = [NaN, NaN];
  if (n > 3 && Math.abs(r) < 1) {
    const z = Math.atanh(r), se = 1 / Math.sqrt(n - 3), q = normPpf(0.5 + conf / 2);
    ci = [Math.tanh(z - q * se), Math.tanh(z + q * se)];
  }
  return { r, t, df, p, ci, n };
}

// Average ranks (ties share the mean rank), 1-based.
export function ranks(a) {
  const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
  const r = new Array(a.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

export function spearman(x, y) {
  const r = pearson(ranks(x), ranks(y));
  return { rho: r.r, t: r.t, df: r.df, p: r.p, n: r.n };
}

// Noncentral t cdf: P(T' <= t) = ∫ Φ(t √(v/ν) − δ) f_χ²ν(v) dv.
export function nctCdf(t, df, nc) {
  const lg = DIST.chi2;
  const f = (v) => v <= 0 ? 0 : normCdf(t * Math.sqrt(v / df) - nc) * lg.pdf(v, { df });
  const m = df, s = Math.sqrt(2 * df);
  const lo = Math.max(0, m - 40 * s), hi = m + 60 * s + 50;
  // Below lo the chi-square mass is under 1e-30, so the integral starts there.
  const r = integrate(f, lo, hi, { tol: 1e-13 }).value;
  return Math.min(1, Math.max(0, r));
}

// Power of a t-test. kind: 'two' (two independent groups, n per group) or
// 'one' (one sample or paired, n pairs). d is Cohen's d.
export function powerT(kind, d, n, alpha = 0.05, alt = 'two-sided') {
  const df = kind === 'two' ? 2 * n - 2 : n - 1;
  const nc = kind === 'two' ? d * Math.sqrt(n / 2) : d * Math.sqrt(n);
  if (df < 1) return NaN;
  if (alt === 'two-sided') {
    const c = DIST.t.ppf(1 - alpha / 2, { df });
    return 1 - nctCdf(c, df, nc) + nctCdf(-c, df, nc);
  }
  const c = DIST.t.ppf(1 - alpha, { df });
  return alt === 'greater' ? 1 - nctCdf(c, df, nc) : nctCdf(-c, df, nc);
}

// Power of the two-proportion z test (Cohen's h, equal groups).
export function cohenH(p1, p2) { return 2 * Math.asin(Math.sqrt(p1)) - 2 * Math.asin(Math.sqrt(p2)); }
export function powerProp(h, n, alpha = 0.05, alt = 'two-sided') {
  const ncp = Math.abs(h) * Math.sqrt(n / 2);
  if (alt === 'two-sided') { const z = normPpf(1 - alpha / 2); return normCdf(ncp - z) + normCdf(-ncp - z); }
  return normCdf(ncp - normPpf(1 - alpha));
}

// Smallest real n (fractional, as statsmodels solve_power) with power >= target.
export function solveN(powerOf, target, nMin = 2) {
  if (!(target > 0 && target < 1)) throw new Error('The power must be between 0 and 1.');
  let hi = nMin + 1;
  while (powerOf(hi) < target) { hi *= 2; if (hi > 1e9) throw new Error('No sample size reaches that power: the effect is too small.'); }
  const lo = Math.max(nMin, hi / 2 > nMin ? hi / 2 : nMin);
  if (powerOf(lo) >= target) return lo;
  return brent((n) => powerOf(n) - target, lo, hi, 1e-10).x;
}
