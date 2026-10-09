// ============================================================================
//  SCIENCE TOOLKIT  ·  core/fit.js  ·  least-squares curve fits
// ----------------------------------------------------------------------------
//  polyFit()  linear least squares for y = Σ c_k x^k (degree 1 is a line),
//             solved by Householder QR (core/linalg.js lstsq), not by the
//             normal equations, so a high degree keeps its precision.
//  lmFit()    Levenberg–Marquardt for any model f(x; p): numeric Jacobian
//             (central differences), Marquardt's diagonal scaling, the
//             step accepted when the weighted sum of squares falls.
//  Both give the parameter covariance as SciPy's curve_fit does:
//    no σ column    C = s² (JᵀJ)⁻¹, s² = SSR / (n − p)
//    with σ column  C = (JᵀWJ)⁻¹, W = diag(1/σ²)  (absolute_sigma=True)
//  MODELS holds the named models with start values taken from the data.
//
//  GREP MAP
//    grep -n "export function polyFit"
//    grep -n "export function lmFit"
//    grep -n "export const MODELS"
//    grep -n "export function fitModel"   choose the model, start, fit, stats
// ============================================================================
import { lstsq, solve } from './linalg.js';
import { compile, parse, freeVars } from './expr.js';

function stats(x, y, yhat, p, sig) {
  const n = x.length;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let ssr = 0, sst = 0, chi2 = 0;
  for (let i = 0; i < n; i++) {
    ssr += (y[i] - yhat[i]) ** 2; sst += (y[i] - my) ** 2;
    if (sig) chi2 += ((y[i] - yhat[i]) / sig[i]) ** 2;
  }
  const dof = n - p;
  return { ssr, r2: 1 - ssr / sst, adjR2: 1 - (ssr / dof) / (sst / (n - 1)), dof, rmse: Math.sqrt(ssr / dof), chi2: sig ? chi2 : null, redChi2: sig ? chi2 / dof : null };
}

export function polyFit(x, y, deg, sig = null) {
  if (x.length <= deg) throw new Error(`A degree-${deg} fit needs at least ${deg + 2} points for an uncertainty (it has ${x.length}).`);
  const w = sig ? sig.map(s => 1 / s) : x.map(() => 1);
  const A = x.map((xi, i) => Array.from({ length: deg + 1 }, (_, k) => xi ** k * w[i]));
  const b = y.map((yi, i) => yi * w[i]);
  const { x: c, cov } = lstsq(A, b);
  const yhat = x.map(xi => c.reduce((s, ck, k) => s + ck * xi ** k, 0));
  const st = stats(x, y, yhat, deg + 1, sig);
  const s2 = sig ? 1 : st.ssr / st.dof;
  const C = cov.map(r => r.map(v => v * s2));
  return { p: c, err: C.map((r, i) => Math.sqrt(r[i])), cov: C, yhat, ...st, f: (t) => c.reduce((s, ck, k) => s + ck * t ** k, 0) };
}

// Levenberg–Marquardt. f(x, p) -> y. p0 start values.
export function lmFit(f, x, y, p0, sig = null, { maxIter = 500, tol = 1e-12 } = {}) {
  const n = x.length, m = p0.length;
  if (n < m) throw new Error(`The model has ${m} parameters, so it needs at least ${m} points.`);
  const w = sig ? sig.map(s => 1 / (s * s)) : x.map(() => 1);
  let p = p0.slice();
  const resid = (pp) => x.map((xi, i) => y[i] - f(xi, pp));
  const cost = (r) => r.reduce((s, ri, i) => s + w[i] * ri * ri, 0);
  const jac = (pp) => {
    const J = x.map(() => new Array(m));
    for (let k = 0; k < m; k++) {
      const h = 1e-6 * Math.max(Math.abs(pp[k]), 1e-6);
      const a = pp.slice(), b = pp.slice();
      a[k] += h; b[k] -= h;
      for (let i = 0; i < n; i++) J[i][k] = (f(x[i], a) - f(x[i], b)) / (2 * h);
    }
    return J;
  };
  let r = resid(p), c = cost(r);
  if (!Number.isFinite(c)) throw new Error('The model is not finite at the start values. Change the start values.');
  let lambda = 1e-3, iter = 0, converged = false;
  for (; iter < maxIter; iter++) {
    const J = jac(p);
    const JTJ = Array.from({ length: m }, () => new Array(m).fill(0)), g = new Array(m).fill(0);
    for (let i = 0; i < n; i++) for (let a = 0; a < m; a++) {
      g[a] += w[i] * J[i][a] * r[i];
      for (let b = 0; b < m; b++) JTJ[a][b] += w[i] * J[i][a] * J[i][b];
    }
    let improved = false;
    for (let tries = 0; tries < 30; tries++) {
      const M = JTJ.map((row, a) => row.map((v, b) => a === b ? v * (1 + lambda) + 1e-300 : v));
      let dp;
      try { dp = solve(M, g); } catch (e) { lambda *= 10; continue; }
      const pn = p.map((v, k) => v + dp[k]);
      const rn = resid(pn), cn = cost(rn);
      if (Number.isFinite(cn) && cn <= c) {
        const rel = (c - cn) / Math.max(c, 1e-300);
        const step = Math.max(...dp.map((d, k) => Math.abs(d) / (Math.abs(p[k]) + 1e-12)));
        p = pn; r = rn; c = cn; lambda = Math.max(lambda / 10, 1e-12); improved = true;
        if (rel < tol && step < 1e-10) converged = true;
        if (cn === 0) converged = true;
        break;
      }
      lambda *= 10;
    }
    if (!improved || converged) { converged = true; break; }
  }
  const J = jac(p);
  const JTJ = Array.from({ length: m }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++) for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) JTJ[a][b] += w[i] * J[i][a] * J[i][b];
  let cov;
  try { cov = solve(JTJ, JTJ.map((_, i) => JTJ.map((__, j) => +(i === j)))); }
  catch (e) { cov = JTJ.map(row => row.map(() => NaN)); }
  const yhat = x.map(xi => f(xi, p));
  const st = stats(x, y, yhat, m, sig);
  const s2 = sig ? 1 : (st.dof > 0 ? st.ssr / st.dof : NaN);
  const C = cov.map(row => row.map(v => v * s2));
  return { p, err: C.map((row, i) => Math.sqrt(row[i])), cov: C, yhat, iter, converged, ...st, f: (t) => f(t, p) };
}

// Linear fit of (u, v) for start values.
function line(u, v) {
  const n = u.length, mu = u.reduce((s, a) => s + a, 0) / n, mv = v.reduce((s, a) => s + a, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (u[i] - mu) * (v[i] - mv); sxx += (u[i] - mu) ** 2; }
  const b = sxx ? sxy / sxx : 0;
  return [mv - b * mu, b];
}

export const MODELS = {
  linear: { name: 'Line  y = a + b x', tex: 'y = a + b\\,x', params: ['a', 'b'], poly: 1 },
  poly: { name: 'Polynomial  y = Σ c_k x^k', tex: 'y = \\sum_{k=0}^{d} c_k x^k', poly: true },
  exp: {
    name: 'Exponential  y = a e^{b x}', tex: 'y = a\\,e^{b x}', params: ['a', 'b'],
    f: (x, [a, b]) => a * Math.exp(b * x),
    start(x, y) {
      const ok = x.map((_, i) => i).filter(i => y[i] > 0);
      if (ok.length < 2) return [y[0] || 1, 0];
      const [c0, c1] = line(ok.map(i => x[i]), ok.map(i => Math.log(y[i])));
      return [Math.exp(c0), c1];
    },
  },
  expc: {
    name: 'Exponential with offset  y = a e^{b x} + c', tex: 'y = a\\,e^{b x} + c', params: ['a', 'b', 'c'],
    f: (x, [a, b, c]) => a * Math.exp(b * x) + c,
    start(x, y) {
      const i0 = x.indexOf(Math.min(...x)), i1 = x.indexOf(Math.max(...x));
      const lo = Math.min(...y), hi = Math.max(...y), rng = hi - lo || 1;
      const falling = y[i0] > y[i1];
      const c = falling ? lo - 0.05 * rng : hi + 0.05 * rng;
      const ok = x.map((_, i) => i);
      const [c0, c1] = line(ok.map(i => x[i]), ok.map(i => Math.log(Math.abs(y[i] - c))));
      return [(falling ? 1 : -1) * Math.exp(c0), c1, c];
    },
  },
  power: {
    name: 'Power law  y = a x^b', tex: 'y = a\\,x^{b}', params: ['a', 'b'],
    f: (x, [a, b]) => a * x ** b,
    start(x, y) {
      const ok = x.map((_, i) => i).filter(i => x[i] > 0 && y[i] > 0);
      if (ok.length < 2) return [1, 1];
      const [c0, c1] = line(ok.map(i => Math.log(x[i])), ok.map(i => Math.log(y[i])));
      return [Math.exp(c0), c1];
    },
  },
  gauss: {
    name: 'Gaussian  y = A exp(−(x−μ)²/2σ²)', tex: 'y = A\\,\\exp\\!\\left(-\\frac{(x-\\mu)^2}{2\\sigma^2}\\right)', params: ['A', 'mu', 'sigma'],
    f: (x, [A, mu, s]) => A * Math.exp(-((x - mu) ** 2) / (2 * s * s)),
    start(x, y) { return gaussStart(x, y, 0); },
  },
  gaussc: {
    name: 'Gaussian with offset  + c', tex: 'y = A\\,\\exp\\!\\left(-\\frac{(x-\\mu)^2}{2\\sigma^2}\\right) + c', params: ['A', 'mu', 'sigma', 'c'],
    f: (x, [A, mu, s, c]) => A * Math.exp(-((x - mu) ** 2) / (2 * s * s)) + c,
    start(x, y) { const c = Math.min(...y); return [...gaussStart(x, y, c), c]; },
  },
  custom: { name: 'Custom expression', tex: 'y = f(x;\\,p_1,\\dots,p_k)' },
};

function gaussStart(x, y, c) {
  let k = 0;
  for (let i = 1; i < y.length; i++) if (y[i] > y[k]) k = i;
  const A = y[k] - c, half = c + A / 2;
  let sw = 0, sxx = 0;
  for (let i = 0; i < x.length; i++) { const wv = Math.max(0, y[i] - c); sw += wv; sxx += wv * (x[i] - x[k]) ** 2; }
  let s = sw > 0 ? Math.sqrt(sxx / sw) : 1;
  // Prefer the half-width at half-maximum when the data cross it.
  const above = x.filter((_, i) => y[i] >= half);
  if (above.length >= 2) s = (Math.max(...above) - Math.min(...above)) / 2.3548;
  return [A, x[k], s || 1];
}

// Parse "a=1, b=0.5" to { a: 1, b: 0.5 }.
export function parseStart(text) {
  const out = {};
  for (const part of String(text).split(/[,;\n]/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([-+0-9.eE]+)\s*$/.exec(part);
    if (m) out[m[1]] = Number(m[2]);
    else if (part.trim()) throw new Error(`Cannot read the start value "${part.trim()}". Write a=1, b=0.5.`);
  }
  return out;
}

// Fit by model id. Returns { names, p, err, yhat, r2, ... , tex }.
export function fitModel(id, x, y, sig = null, { deg = 2, expr = '', start = '' } = {}) {
  const M = MODELS[id];
  if (!M) throw new Error('Unknown model.');
  if (x.length !== y.length) throw new Error('x and y need the same length.');
  if (M.poly) {
    const d = M.poly === true ? deg : M.poly;
    const r = polyFit(x, y, d, sig);
    const names = M.params || Array.from({ length: d + 1 }, (_, k) => `c${k}`);
    return { ...r, names };
  }
  let f, names, p0;
  const given = parseStart(start);
  if (id === 'custom') {
    const tree = parse(expr.replace(/^\s*y\s*=\s*/, ''));
    names = freeVars(tree).filter(v => v !== 'x');
    if (!names.length) throw new Error('The model has no parameters. Use x and names such as a, b, c.');
    const g = compile(tree), sc = {};
    f = (xv, p) => { sc.x = xv; for (let k = 0; k < names.length; k++) sc[names[k]] = p[k]; return g(sc); };
    p0 = names.map(n => given[n] ?? 1);
  } else {
    names = M.params; f = M.f;
    const s = M.start(x, y);
    p0 = names.map((n, k) => given[n] ?? s[k]);
  }
  const r = lmFit(f, x, y, p0, sig);
  return { ...r, names, p0 };
}
