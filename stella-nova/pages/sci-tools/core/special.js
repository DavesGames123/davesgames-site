// ============================================================================
//  SCIENCE TOOLKIT  ·  core/special.js  ·  special functions, distributions
// ----------------------------------------------------------------------------
//  The log-gamma function, the regularized incomplete gamma and beta
//  functions, erf and erfc, and the distributions that the statistics
//  tools need (normal, Student t, chi-square, F, binomial, Poisson): pdf
//  (or pmf), cdf, sf (upper tail) and quantile.
//
//  Methods: Lanczos log-gamma (g = 7, n = 9); the series and the continued
//  fraction for P(a, x) and Q(a, x); the continued fraction for I_x(a, b)
//  (Numerical Recipes, 3rd ed., §6.1, 6.2, 6.4, modified Lentz); erfc(x) =
//  Q(1/2, x^2). Quantiles of continuous laws: a bracket and bisection to
//  full double precision; the normal quantile starts from Acklam's
//  rational fit and takes Halley steps. tests.mjs checks each against
//  scipy.stats to a relative error of 1e-10 or better.
//
//  GREP MAP
//    grep -n "export function lgamma"
//    grep -n "export function gammaP"     (and gammaQ)
//    grep -n "export function betaI"
//    grep -n "export function erfc"
//    grep -n "export const DIST"          normal, t, chi2, f, binom, poisson
// ============================================================================

const LG = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
export function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = LG[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LG[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

const EPS = 1e-16, FPMIN = 1e-300;

function gser(a, x) {
  let ap = a, sum = 1 / a, del = sum;
  for (let n = 0; n < 10000; n++) {
    ap += 1; del *= x / ap; sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
}
function gcf(a, x) {
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i < 10000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}
// Regularized lower and upper incomplete gamma.
export function gammaP(a, x) {
  if (x <= 0) return 0;
  if (x === Infinity) return 1;
  return x < a + 1 ? gser(a, x) : 1 - gcf(a, x);
}
export function gammaQ(a, x) {
  if (x <= 0) return 1;
  if (x === Infinity) return 0;
  return x < a + 1 ? 1 - gser(a, x) : gcf(a, x);
}

function betacf(a, b, x) {
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 10000; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
// Regularized incomplete beta I_x(a, b).
export function betaI(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
  return 1 - bt * betacf(b, a, 1 - x) / b;
}
// Upper tail 1 - I_x(a, b) without cancellation.
export function betaIc(a, b, x) { return betaI(b, a, 1 - x); }

export function erfc(x) {
  if (x < 0) return 2 - erfc(-x);
  return gammaQ(0.5, x * x);
}
export function erf(x) { return x < 0 ? -erf(-x) : gammaP(0.5, x * x); }

// Normal quantile: Acklam's rational fit, then two Halley steps.
function probit(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425;
  let x;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else if (p <= 1 - pl) { const q = p - 0.5, r = q * q; x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  else { const q = Math.sqrt(-2 * Math.log1p(-p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  for (let i = 0; i < 2; i++) {
    const e = (p < 0.5 ? 0.5 * erfc(-x / Math.SQRT2) - p : -(0.5 * erfc(x / Math.SQRT2) - (1 - p)));
    const u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
    x = x - u / (1 + x * u / 2);
  }
  return x;
}

// Invert a continuous increasing cdf on [lo, hi] by bracketing and bisection.
function invert(cdf, p, lo, hi) {
  if (p <= 0) return lo;
  if (p >= 1) return hi;
  let a = lo === -Infinity ? -1 : lo, b = hi === Infinity ? 1 : Math.min(hi, 1);
  if (lo === -Infinity) while (cdf(a) > p) a *= 2;
  while (cdf(b) < p && b < 1e300) { a = b; b = b <= 0 ? 1 : b * 2; }
  for (let i = 0; i < 400; i++) {
    const m = 0.5 * (a + b);
    if (m === a || m === b) break;
    if (cdf(m) < p) a = m; else b = m;
  }
  return 0.5 * (a + b);
}

const lchoose = (n, k) => lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);

// Each law: params (names), support, pdf, cdf, sf, ppf (quantile), mean, var.
export const DIST = {
  normal: {
    name: 'Normal', params: [['mu', 'mean μ', 0], ['sigma', 'standard deviation σ', 1]],
    check: ({ sigma }) => { if (!(sigma > 0)) throw new Error('σ must be greater than 0.'); },
    pdf: (x, { mu, sigma }) => Math.exp(-0.5 * ((x - mu) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI)),
    cdf: (x, { mu, sigma }) => 0.5 * erfc(-(x - mu) / (sigma * Math.SQRT2)),
    sf: (x, { mu, sigma }) => 0.5 * erfc((x - mu) / (sigma * Math.SQRT2)),
    ppf: (p, { mu, sigma }) => mu + sigma * probit(p),
    mean: ({ mu }) => mu, var: ({ sigma }) => sigma * sigma,
  },
  t: {
    name: 'Student t', params: [['df', 'degrees of freedom ν', 10]],
    check: ({ df }) => { if (!(df > 0)) throw new Error('ν must be greater than 0.'); },
    pdf: (x, { df }) => Math.exp(lgamma((df + 1) / 2) - lgamma(df / 2) - 0.5 * Math.log(df * Math.PI) - (df + 1) / 2 * Math.log1p(x * x / df)),
    cdf: (x, { df }) => { const p = 0.5 * betaI(df / 2, 0.5, df / (df + x * x)); return x > 0 ? 1 - p : p; },
    sf: (x, { df }) => { const p = 0.5 * betaI(df / 2, 0.5, df / (df + x * x)); return x > 0 ? p : 1 - p; },
    ppf(p, prm) { return p === 0.5 ? 0 : invert((x) => this.cdf(x, prm), p, -Infinity, Infinity); },
    mean: ({ df }) => df > 1 ? 0 : NaN, var: ({ df }) => df > 2 ? df / (df - 2) : (df > 1 ? Infinity : NaN),
  },
  chi2: {
    name: 'Chi-square', params: [['df', 'degrees of freedom k', 3]],
    check: ({ df }) => { if (!(df > 0)) throw new Error('k must be greater than 0.'); },
    pdf: (x, { df }) => x < 0 ? 0 : x === 0 ? (df === 2 ? 0.5 : df < 2 ? Infinity : 0) : Math.exp((df / 2 - 1) * Math.log(x) - x / 2 - df / 2 * Math.LN2 - lgamma(df / 2)),
    cdf: (x, { df }) => gammaP(df / 2, x / 2),
    sf: (x, { df }) => gammaQ(df / 2, x / 2),
    ppf(p, prm) { return invert((x) => this.cdf(x, prm), p, 0, Infinity); },
    mean: ({ df }) => df, var: ({ df }) => 2 * df,
  },
  f: {
    name: 'F', params: [['d1', 'numerator df d₁', 5], ['d2', 'denominator df d₂', 20]],
    check: ({ d1, d2 }) => { if (!(d1 > 0 && d2 > 0)) throw new Error('Both df must be greater than 0.'); },
    pdf: (x, { d1, d2 }) => x <= 0 ? 0 : Math.exp(0.5 * (d1 * Math.log(d1 * x) + d2 * Math.log(d2) - (d1 + d2) * Math.log(d1 * x + d2)) - Math.log(x) - (lgamma(d1 / 2) + lgamma(d2 / 2) - lgamma((d1 + d2) / 2))),
    cdf: (x, { d1, d2 }) => x <= 0 ? 0 : betaI(d1 / 2, d2 / 2, d1 * x / (d1 * x + d2)),
    sf: (x, { d1, d2 }) => x <= 0 ? 1 : betaI(d2 / 2, d1 / 2, d2 / (d2 + d1 * x)),
    ppf(p, prm) { return invert((x) => this.cdf(x, prm), p, 0, Infinity); },
    mean: ({ d2 }) => d2 > 2 ? d2 / (d2 - 2) : NaN,
    var: ({ d1, d2 }) => d2 > 4 ? 2 * d2 * d2 * (d1 + d2 - 2) / (d1 * (d2 - 2) ** 2 * (d2 - 4)) : NaN,
  },
  binom: {
    name: 'Binomial', discrete: true, params: [['n', 'trials n', 20], ['p', 'success probability p', 0.3]],
    check: ({ n, p }) => { if (!(Number.isInteger(n) && n >= 0)) throw new Error('n must be a whole number ≥ 0.'); if (!(p >= 0 && p <= 1)) throw new Error('p must be from 0 to 1.'); },
    pdf: (k, { n, p }) => (k < 0 || k > n || !Number.isInteger(k)) ? 0 : p === 0 ? (k === 0 ? 1 : 0) : p === 1 ? (k === n ? 1 : 0) : Math.exp(lchoose(n, k) + k * Math.log(p) + (n - k) * Math.log1p(-p)),
    cdf: (k, { n, p }) => { k = Math.floor(k); return k < 0 ? 0 : k >= n ? 1 : betaI(n - k, k + 1, 1 - p); },
    sf: (k, { n, p }) => { k = Math.floor(k); return k < 0 ? 1 : k >= n ? 0 : betaI(k + 1, n - k, p); },
    ppf(q, prm) { let k = 0; while (k < prm.n && this.cdf(k, prm) < q * (1 - 1e-12)) k++; return k; },
    mean: ({ n, p }) => n * p, var: ({ n, p }) => n * p * (1 - p),
  },
  poisson: {
    name: 'Poisson', discrete: true, params: [['lambda', 'mean λ', 4]],
    check: ({ lambda }) => { if (!(lambda > 0)) throw new Error('λ must be greater than 0.'); },
    pdf: (k, { lambda }) => (k < 0 || !Number.isInteger(k)) ? 0 : Math.exp(k * Math.log(lambda) - lambda - lgamma(k + 1)),
    cdf: (k, { lambda }) => { k = Math.floor(k); return k < 0 ? 0 : gammaQ(k + 1, lambda); },
    sf: (k, { lambda }) => { k = Math.floor(k); return k < 0 ? 1 : gammaP(k + 1, lambda); },
    ppf(q, prm) {
      let k = Math.max(0, Math.floor(prm.lambda + probit(q) * Math.sqrt(prm.lambda)) - 2);
      while (k > 0 && this.cdf(k - 1, prm) >= q * (1 - 1e-12)) k--;
      while (this.cdf(k, prm) < q * (1 - 1e-12)) k++;
      return k;
    },
    mean: ({ lambda }) => lambda, var: ({ lambda }) => lambda,
  },
};

export const normCdf = (z) => 0.5 * erfc(-z / Math.SQRT2);
export const normPpf = probit;
export const tSf2 = (t, df) => betaI(df / 2, 0.5, df / (df + t * t));   // two-sided p of |T| >= |t|
