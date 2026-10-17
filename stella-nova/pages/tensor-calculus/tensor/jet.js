// ============================================================================
//  tensor/jet.js  ·  forward-mode derivatives to second order (DOM-free)
// ----------------------------------------------------------------------------
//  A metric is written once as g(x, F, p) with the operations of F. The
//  same function gives:
//      NUM   plain numbers (fast, for geodesics)
//      jetOps(n, 2)  value, gradient and Hessian in n coordinates, exact
//  So the first and second derivatives of g_ij that the Christoffel
//  symbols and the Riemann tensor need come with no finite differences.
//
//  A Jet is { v, g: Float64Array(n), h: Float64Array(n*n) | null }.
//
//  ANCHORS   (grep -n "<anchor>" jet.js)
//      NUM ............ "export const NUM"
//      jetOps ......... "export function jetOps"
//      variables ...... "export function variables"
// ============================================================================

export const NUM = {
  c: x => x, add: (a, b) => a + b, sub: (a, b) => a - b, mul: (a, b) => a * b, div: (a, b) => a / b,
  neg: a => -a, sin: Math.sin, cos: Math.cos, sqrt: Math.sqrt, exp: Math.exp, log: Math.log,
  pow: (a, k) => a ** k, sq: a => a * a, inv: a => 1 / a, val: a => a, tanh: Math.tanh, cosh: Math.cosh, sinh: Math.sinh,
};

export function jetOps(n, order = 2) {
  const H = order >= 2;
  const mk = (v, g, h) => ({ v, g, h });
  const lift = a => (typeof a === 'number' ? mk(a, new Float64Array(n), H ? new Float64Array(n * n) : null) : a);
  const unary = (a, f0, f1, f2) => {
    if (typeof a === 'number') return f0;
    const g = new Float64Array(n);
    for (let i = 0; i < n; i++) g[i] = f1 * a.g[i];
    let h = null;
    if (H) {
      h = new Float64Array(n * n);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) h[i * n + j] = f2 * a.g[i] * a.g[j] + f1 * a.h[i * n + j];
    }
    return mk(f0, g, h);
  };
  const F = {
    n, order,
    c: x => lift(x),
    val: a => (typeof a === 'number' ? a : a.v),
    add(a, b) {
      if (typeof a === 'number' && typeof b === 'number') return a + b;
      a = lift(a); b = lift(b);
      const g = new Float64Array(n); for (let i = 0; i < n; i++) g[i] = a.g[i] + b.g[i];
      let h = null; if (H) { h = new Float64Array(n * n); for (let i = 0; i < n * n; i++) h[i] = a.h[i] + b.h[i]; }
      return mk(a.v + b.v, g, h);
    },
    neg: a => (typeof a === 'number' ? -a : F.mul(-1, a)),
    sub: (a, b) => F.add(a, F.neg(b)),
    mul(a, b) {
      if (typeof a === 'number' && typeof b === 'number') return a * b;
      if (typeof a === 'number') [a, b] = [b, a];
      if (typeof b === 'number') {
        const g = new Float64Array(n); for (let i = 0; i < n; i++) g[i] = a.g[i] * b;
        let h = null; if (H) { h = new Float64Array(n * n); for (let i = 0; i < n * n; i++) h[i] = a.h[i] * b; }
        return mk(a.v * b, g, h);
      }
      const g = new Float64Array(n); for (let i = 0; i < n; i++) g[i] = a.g[i] * b.v + a.v * b.g[i];
      let h = null;
      if (H) {
        h = new Float64Array(n * n);
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          const k = i * n + j;
          h[k] = a.h[k] * b.v + a.v * b.h[k] + a.g[i] * b.g[j] + a.g[j] * b.g[i];
        }
      }
      return mk(a.v * b.v, g, h);
    },
    inv: a => { const v = F.val(a); return unary(a, 1 / v, -1 / (v * v), 2 / (v * v * v)); },
    div: (a, b) => (typeof b === 'number' ? F.mul(a, 1 / b) : F.mul(a, F.inv(b))),
    sq: a => F.mul(a, a),
    sin: a => { const v = F.val(a); return unary(a, Math.sin(v), Math.cos(v), -Math.sin(v)); },
    cos: a => { const v = F.val(a); return unary(a, Math.cos(v), -Math.sin(v), -Math.cos(v)); },
    sinh: a => { const v = F.val(a); return unary(a, Math.sinh(v), Math.cosh(v), Math.sinh(v)); },
    cosh: a => { const v = F.val(a); return unary(a, Math.cosh(v), Math.sinh(v), Math.cosh(v)); },
    tanh: a => { const v = F.val(a), t = Math.tanh(v), s = 1 - t * t; return unary(a, t, s, -2 * t * s); },
    exp: a => { const v = F.val(a), e = Math.exp(v); return unary(a, e, e, e); },
    log: a => { const v = F.val(a); return unary(a, Math.log(v), 1 / v, -1 / (v * v)); },
    sqrt: a => { const v = F.val(a), s = Math.sqrt(v); return unary(a, s, 0.5 / s, -0.25 / (s * v)); },
    pow: (a, k) => { const v = F.val(a); return unary(a, v ** k, k * v ** (k - 1), k * (k - 1) * v ** (k - 2)); },
  };
  return F;
}

// The n coordinate variables at the point x, as jets.
export function variables(F, x) {
  return x.map((v, i) => {
    const g = new Float64Array(F.n); g[i] = 1;
    return { v, g, h: F.order >= 2 ? new Float64Array(F.n * F.n) : null };
  });
}
