// ============================================================================
//  SCIENCE TOOLKIT  ·  core/numeric.js  ·  roots, quadrature, derivatives
// ----------------------------------------------------------------------------
//  brent()      a root in a bracket [a, b] with f(a) f(b) < 0: Brent's
//               method (inverse quadratic interpolation, secant and
//               bisection), R. P. Brent, Algorithms for Minimization
//               without Derivatives (1973), ch. 4; the zeroin form of
//               Forsythe, Malcolm and Moler (1977).
//  roots()      every sign change of f on a grid over [a, b], each refined
//               by brent().
//  integrate()  adaptive Gauss–Kronrod 7-15 (as QUADPACK QAG). An infinite
//               limit maps to a finite one with x = t / (1 - t^2).
//  deriv()      first or second derivative by central differences with
//               Richardson extrapolation (Ridders' table).
//
//  GREP MAP
//    grep -n "export function brent"
//    grep -n "export function roots"
//    grep -n "export function integrate"
//    grep -n "export function deriv"
// ============================================================================

export function brent(f, a, b, tol = 1e-15, maxIter = 200) {
  let fa = f(a), fb = f(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb)) throw new Error('f is not finite at an end of the bracket.');
  if (fa === 0) return { x: a, fx: 0, iter: 0 };
  if (fb === 0) return { x: b, fx: 0, iter: 0 };
  if (fa * fb > 0) throw new Error('f(a) and f(b) have the same sign, so the bracket holds no sign change.');
  let c = a, fc = fa, d = b - a, e = d, iter = 0;
  for (; iter < maxIter; iter++) {
    if (fb * fc > 0) { c = a; fc = fa; d = e = b - a; }
    if (Math.abs(fc) < Math.abs(fb)) { a = b; b = c; c = a; fa = fb; fb = fc; fc = fa; }
    const tol1 = 2 * Number.EPSILON * Math.abs(b) + 0.5 * tol, xm = 0.5 * (c - b);
    if (Math.abs(xm) <= tol1 || fb === 0) return { x: b, fx: fb, iter };
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p, q;
      if (a === c) { p = 2 * xm * s; q = 1 - s; }
      else {
        const qq = fa / fc, r = fb / fc;
        p = s * (2 * xm * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q; else p = -p;
      if (2 * p < Math.min(3 * xm * q - Math.abs(tol1 * q), Math.abs(e * q))) { e = d; d = p / q; }
      else { d = xm; e = d; }
    } else { d = xm; e = d; }
    a = b; fa = fb;
    b += Math.abs(d) > tol1 ? d : (xm > 0 ? tol1 : -tol1);
    fb = f(b);
  }
  return { x: b, fx: fb, iter, warn: 'no convergence' };
}

// Every root on [a, b] found from n grid cells (sign changes and exact zeros).
export function roots(f, a, b, n = 400) {
  const out = [];
  let x0 = a, f0 = f(a);
  for (let i = 1; i <= n; i++) {
    const x1 = a + (b - a) * i / n, f1 = f(x1);
    if (f0 === 0) out.push(x0);
    else if (Number.isFinite(f0) && Number.isFinite(f1) && f0 * f1 < 0) {
      const r = brent(f, x0, x1);
      // A pole also changes sign: keep only a true zero.
      if (Math.abs(r.fx) < 1e-6 * (Math.abs(f0) + Math.abs(f1)) || Math.abs(r.fx) < 1e-12) out.push(r.x);
    }
    x0 = x1; f0 = f1;
  }
  if (f0 === 0) out.push(x0);
  return out;
}

// Gauss–Kronrod 7-15 nodes and weights (QUADPACK qk15).
const XGK = [0.991455371120812639206854697526329, 0.949107912342758524526189684047851, 0.864864423359769072789712788640926, 0.741531185599394439863864773280788, 0.586087235467691130294144845693013, 0.405845151377397166906606412076961, 0.207784955007898467600689403773245, 0];
const WGK = [0.022935322010529224963732008058970, 0.063092092629978553290700663189204, 0.104790010322250183839876322541518, 0.140653259715525918745189590510238, 0.169004726639267902826583426598550, 0.190350578064785409913256402421014, 0.204432940075298892414161999234649, 0.209482141084727828012999174891714];
const WG = [0.129484966168869693270611432679082, 0.279705391489276667901467771423780, 0.381830050505118944950369775488975, 0.417959183673469387755102040816327];

function gk15(f, a, b) {
  const c = 0.5 * (a + b), h = 0.5 * (b - a);
  const fc = f(c);
  let rk = fc * WGK[7], rg = fc * WG[3];
  for (let j = 0; j < 7; j++) {
    const x = h * XGK[j], f1 = f(c - x), f2 = f(c + x);
    rk += WGK[j] * (f1 + f2);
    if (j % 2 === 1) rg += WG[(j - 1) / 2] * (f1 + f2);
  }
  return { r: rk * h, err: Math.abs((rk - rg) * h) };
}

// ∫_a^b f(x) dx. Returns { value, err, evals }.
export function integrate(f, a, b, { tol = 1e-12, maxSeg = 2000 } = {}) {
  if (a === b) return { value: 0, err: 0, evals: 0 };
  if (a > b) { const r = integrate(f, b, a, { tol, maxSeg }); return { ...r, value: -r.value }; }
  let g = f, lo = a, hi = b;
  if (a === -Infinity || b === Infinity) {
    // x = t / (1 - t^2), dx = (1 + t^2) / (1 - t^2)^2 dt, t in (-1, 1).
    const tOf = (x) => x === Infinity ? 1 : x === -Infinity ? -1 : (Math.abs(x) < 1e-8 ? x : (-1 + Math.sqrt(1 + 4 * x * x)) / (2 * x));
    lo = tOf(a); hi = tOf(b);
    g = (t) => { const d = 1 - t * t; if (d <= 0) return 0; const v = f(t / d) * (1 + t * t) / (d * d); return Number.isFinite(v) ? v : 0; };
  }
  let segs = [{ a: lo, b: hi, ...gk15(g, lo, hi) }];
  let evals = 15;
  for (let it = 0; it < maxSeg; it++) {
    const total = segs.reduce((s, x) => s + x.r, 0), err = segs.reduce((s, x) => s + x.err, 0);
    if (err <= Math.max(tol * Math.abs(total), 1e-300)) return { value: total, err, evals };
    let k = 0;
    for (let i = 1; i < segs.length; i++) if (segs[i].err > segs[k].err) k = i;
    const s = segs[k], m = 0.5 * (s.a + s.b);
    if (m === s.a || m === s.b) break;
    segs.splice(k, 1, { a: s.a, b: m, ...gk15(g, s.a, m) }, { a: m, b: s.b, ...gk15(g, m, s.b) });
    evals += 30;
  }
  const value = segs.reduce((s, x) => s + x.r, 0);
  return { value, err: segs.reduce((s, x) => s + x.err, 0), evals, warn: 'the error target was not met' };
}

// Ridders' extrapolation of central differences. order 1 or 2.
export function deriv(f, x, order = 1, h0) {
  let h = h0 || (order === 1 ? 1e-2 : 5e-2) * Math.max(1, Math.abs(x));
  const D = (hh) => order === 1 ? (f(x + hh) - f(x - hh)) / (2 * hh) : (f(x + hh) - 2 * f(x) + f(x - hh)) / (hh * hh);
  const N = 10, CON = 1.4, CON2 = CON * CON;
  const a = [];
  a[0] = [D(h)];
  let best = a[0][0], err = Infinity;
  for (let i = 1; i < N; i++) {
    h /= CON;
    a[i] = [D(h)];
    let fac = CON2;
    for (let j = 1; j <= i; j++) {
      a[i][j] = (a[i][j - 1] * fac - a[i - 1][j - 1]) / (fac - 1);
      fac *= CON2;
      const e = Math.max(Math.abs(a[i][j] - a[i][j - 1]), Math.abs(a[i][j] - a[i - 1][j - 1]));
      if (e <= err) { err = e; best = a[i][j]; }
    }
    if (Math.abs(a[i][i] - a[i - 1][i - 1]) >= 2 * err) break;
  }
  return { value: best, err };
}
