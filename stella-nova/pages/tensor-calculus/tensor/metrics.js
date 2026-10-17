// ============================================================================
//  tensor/metrics.js  ·  the metric library (DOM-free)
// ----------------------------------------------------------------------------
//  Each metric is
//      { id, label, dim, coords: [sym], coordTex: [tex], line: TeX line element,
//        params: { name: default }, paramInfo: [{ key, label, min, max, step }],
//        signature: '+..' | '-+++', sample: [x], g(x, F, p), embed?(x, p),
//        periodic?: [period or 0 per coordinate] }
//  g(x, F, p) returns the n x n components g_ij written with the
//  operations of F (see jet.js), so one formula gives the numbers and
//  their exact first and second derivatives. Units: G = c = 1.
//
//  Conventions: spherical (r, theta, phi) with theta the polar angle
//  from +z (colatitude). Minkowski signature (-, +, +, +), t first.
//  The torus has u around the main axis and v around the tube.
//
//  ANCHORS   (grep -n "<anchor>" metrics.js)
//      METRICS ........... "export const METRICS"
//      getMetric ......... "export function getMetric"
//      metricAt .......... "export function metricAt"
//      metricJet ......... "export function metricJet"
//      jacobianOf ........ "export function jacobianOf"
//      COORD_MAPS ........ "export const COORD_MAPS"
//      lorentzBoost ...... "export function lorentzBoost"
// ============================================================================

import { NUM, jetOps, variables } from './jet.js';
import { matInverse } from './tensor.js';

const TAU = 2 * Math.PI;
const diag = (F, ...d) => d.map((v, i) => d.map((_, j) => (i === j ? v : 0)));

export const METRICS = {
  euclid2: {
    id: 'euclid2', label: 'Euclidean plane', dim: 2, coords: ['x', 'y'], coordTex: ['x', 'y'],
    line: 'ds^2 = dx^2 + dy^2', params: {}, signature: '++', sample: [0.3, -0.2],
    g: (x, F) => diag(F, 1, 1),
    embed: x => [x[0], x[1], 0],
  },
  euclid3: {
    id: 'euclid3', label: 'Euclidean space', dim: 3, coords: ['x', 'y', 'z'], coordTex: ['x', 'y', 'z'],
    line: 'ds^2 = dx^2 + dy^2 + dz^2', params: {}, signature: '+++', sample: [0.3, -0.2, 0.5],
    g: (x, F) => diag(F, 1, 1, 1),
    embed: x => x.slice(),
  },
  polar: {
    id: 'polar', periodic: [0, TAU], label: 'Polar coordinates', dim: 2, coords: ['r', 'theta'], coordTex: ['r', '\\theta'],
    line: 'ds^2 = dr^2 + r^2\\,d\\theta^2', params: {}, signature: '++', sample: [1.5, 0.7],
    g: (x, F) => diag(F, 1, F.sq(x[0])),
    embed: x => [x[0] * Math.cos(x[1]), x[0] * Math.sin(x[1]), 0],
  },
  cylindrical: {
    id: 'cylindrical', periodic: [0, TAU, 0], label: 'Cylindrical coordinates', dim: 3, coords: ['r', 'phi', 'z'], coordTex: ['r', '\\phi', 'z'],
    line: 'ds^2 = dr^2 + r^2\\,d\\phi^2 + dz^2', params: {}, signature: '+++', sample: [1.2, 0.4, 0.3],
    g: (x, F) => diag(F, 1, F.sq(x[0]), 1),
    embed: x => [x[0] * Math.cos(x[1]), x[0] * Math.sin(x[1]), x[2]],
  },
  spherical: {
    id: 'spherical', periodic: [0, 0, TAU], label: 'Spherical coordinates', dim: 3, coords: ['r', 'theta', 'phi'], coordTex: ['r', '\\theta', '\\phi'],
    line: 'ds^2 = dr^2 + r^2\\,d\\theta^2 + r^2\\sin^2\\theta\\,d\\phi^2', params: {}, signature: '+++', sample: [1.3, 0.9, 0.4],
    g: (x, F) => { const r2 = F.sq(x[0]); return diag(F, 1, r2, F.mul(r2, F.sq(F.sin(x[1])))); },
    embed: x => [x[0] * Math.sin(x[1]) * Math.cos(x[2]), x[0] * Math.sin(x[1]) * Math.sin(x[2]), x[0] * Math.cos(x[1])],
  },
  sphere: {
    id: 'sphere', periodic: [0, TAU], label: 'Sphere surface', dim: 2, coords: ['theta', 'phi'], coordTex: ['\\theta', '\\phi'],
    line: 'ds^2 = R^2\\,(d\\theta^2 + \\sin^2\\theta\\,d\\phi^2)', params: { R: 1 },
    paramInfo: [{ key: 'R', label: 'Radius R', min: 0.2, max: 4, step: 0.05 }], signature: '++', sample: [1.0, 0.5],
    g: (x, F, p) => { const R2 = p.R * p.R; return diag(F, R2, F.mul(R2, F.sq(F.sin(x[0])))); },
    embed: (x, p) => [p.R * Math.sin(x[0]) * Math.cos(x[1]), p.R * Math.sin(x[0]) * Math.sin(x[1]), p.R * Math.cos(x[0])],
  },
  torus: {
    id: 'torus', periodic: [TAU, TAU], label: 'Torus surface', dim: 2, coords: ['u', 'v'], coordTex: ['u', 'v'],
    line: 'ds^2 = (R + a\\cos v)^2\\,du^2 + a^2\\,dv^2', params: { R: 2, a: 0.7 },
    paramInfo: [{ key: 'R', label: 'Main radius R', min: 0.5, max: 4, step: 0.05 }, { key: 'a', label: 'Tube radius a', min: 0.1, max: 2, step: 0.05 }],
    signature: '++', sample: [0.4, 0.9],
    g: (x, F, p) => diag(F, F.sq(F.add(p.R, F.mul(p.a, F.cos(x[1])))), p.a * p.a),
    embed: (x, p) => { const w = p.R + p.a * Math.cos(x[1]); return [w * Math.cos(x[0]), w * Math.sin(x[0]), p.a * Math.sin(x[1])]; },
  },
  minkowski: {
    id: 'minkowski', label: 'Minkowski spacetime', dim: 4, coords: ['t', 'x', 'y', 'z'], coordTex: ['t', 'x', 'y', 'z'],
    line: 'ds^2 = -dt^2 + dx^2 + dy^2 + dz^2', params: {}, signature: '-+++', sample: [0.1, 0.2, 0.3, 0.4],
    g: (x, F) => diag(F, -1, 1, 1, 1),
  },
  schwarzschild: {
    id: 'schwarzschild', label: 'Schwarzschild black hole', dim: 4, coords: ['t', 'r', 'theta', 'phi'], coordTex: ['t', 'r', '\\theta', '\\phi'],
    line: 'ds^2 = -\\left(1 - \\frac{2M}{r}\\right)dt^2 + \\left(1 - \\frac{2M}{r}\\right)^{-1}dr^2 + r^2\\,d\\Omega^2',
    params: { M: 1 }, paramInfo: [{ key: 'M', label: 'Mass M', min: 0.1, max: 3, step: 0.05 }], signature: '-+++', sample: [0, 6, 1.1, 0.3],
    g: (x, F, p) => {
      const f = F.sub(1, F.div(2 * p.M, x[1])), r2 = F.sq(x[1]);
      return diag(F, F.neg(f), F.inv(f), r2, F.mul(r2, F.sq(F.sin(x[2]))));
    },
  },
  flrw: {
    id: 'flrw', label: 'FLRW universe', dim: 4, coords: ['t', 'r', 'theta', 'phi'], coordTex: ['t', 'r', '\\theta', '\\phi'],
    line: 'ds^2 = -dt^2 + a(t)^2\\left[\\frac{dr^2}{1 - k r^2} + r^2\\,d\\Omega^2\\right]',
    params: { k: 0, p: 2 / 3 },
    paramInfo: [{ key: 'k', label: 'Spatial curvature k', min: -1, max: 1, step: 1 }, { key: 'p', label: 'Expansion a = t^p', min: 0.1, max: 1.5, step: 0.05 }],
    signature: '-+++', sample: [1.5, 0.4, 1.0, 0.2],
    // a(t) = t^p: p = 2/3 matter, p = 1/2 radiation.
    scale: (t, p) => [t ** p.p, p.p * t ** (p.p - 1), p.p * (p.p - 1) * t ** (p.p - 2)],
    g: (x, F, p) => {
      const a2 = F.pow(x[0], 2 * p.p), r2 = F.sq(x[1]);
      return diag(F, -1, F.div(a2, F.sub(1, F.mul(p.k, r2))), F.mul(a2, r2), F.mul(F.mul(a2, r2), F.sq(F.sin(x[2]))));
    },
  },
};

// getMetric('sphere') or a metric object; params merge over the defaults.
export function getMetric(m) {
  if (typeof m === 'string') {
    if (!METRICS[m]) throw new Error(`no metric '${m}'; the metrics are ${Object.keys(METRICS).join(', ')}`);
    return METRICS[m];
  }
  return m;
}
export const paramsOf = (m, p) => ({ ...(getMetric(m).params || {}), ...(p || {}) });

const toNum = (F, A) => A.map(r => r.map(v => (typeof v === 'number' ? v : v.v)));

// A metric object whose g takes only x (g(x) -> nested numbers) is a
// plain numeric metric: the engine takes its derivatives by finite
// differences (fdJet). A g with two or more parameters gets exact jets.
const isPlain = m => m.g.length < 2 && !m.exact;

// Numeric g_ij at x.
export function metricAt(m, x, params) {
  m = getMetric(m);
  if (isPlain(m)) return m.g(x);
  return toNum(NUM, m.g(x, NUM, paramsOf(m, params)));
}

// Fourth-order central differences for a plain metric g(x).
function fdJet(m, x, order) {
  const n = x.length, h = 1e-3 * Math.max(1, ...x.map(Math.abs));
  const G = y => m.g(y);
  const shift = (a, da, b, db) => { const y = x.slice(); y[a] += da; if (b != null) y[b] += db; return G(y); };
  const W = [[-2, 1 / 12], [-1, -8 / 12], [1, 8 / 12], [2, -1 / 12]];
  const g = G(x);
  const dg = [];
  for (let k = 0; k < n; k++) {
    const acc = g.map(r => r.map(() => 0));
    for (const [o, w] of W) { const s = shift(k, o * h); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) acc[i][j] += w * s[i][j] / h; }
    dg.push(acc);
  }
  let d2g = null;
  if (order >= 2) {
    d2g = [];
    for (let k = 0; k < n; k++) {
      d2g.push([]);
      for (let l = 0; l < n; l++) {
        const acc = g.map(r => r.map(() => 0));
        if (k === l) {
          const C = [[-2, -1 / 12], [-1, 16 / 12], [0, -30 / 12], [1, 16 / 12], [2, -1 / 12]];
          for (const [o, w] of C) { const s = o ? shift(k, o * h) : g; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) acc[i][j] += w * s[i][j] / (h * h); }
        } else {
          for (const [a, wa] of W) for (const [b, wb] of W) { const s = shift(k, a * h, l, b * h); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) acc[i][j] += wa * wb * s[i][j] / (h * h); }
        }
        d2g[k].push(acc);
      }
    }
  }
  return { g, dg, d2g };
}
export function inverseMetricAt(m, x, params) { return matInverse(metricAt(m, x, params)); }

// { g, dg, d2g }: dg[k][i][j] = d_k g_ij, d2g[k][l][i][j] = d_k d_l g_ij.
export function metricJet(m, x, params, order = 2) {
  m = getMetric(m);
  if (isPlain(m)) return fdJet(m, x, order);
  const n = m.dim, F = jetOps(n, order);
  const G = m.g(variables(F, x), F, paramsOf(m, params));
  const g = [], dg = [], d2g = order >= 2 ? [] : null;
  for (let k = 0; k < n; k++) {
    dg.push(Array.from({ length: n }, () => new Array(n).fill(0)));
    if (d2g) d2g.push(Array.from({ length: n }, () => Array.from({ length: n }, () => new Array(n).fill(0))));
  }
  for (let i = 0; i < n; i++) {
    g.push(new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const e = G[i][j];
      if (typeof e === 'number') { g[i][j] = e; continue; }
      g[i][j] = e.v;
      for (let k = 0; k < n; k++) {
        dg[k][i][j] = e.g[k];
        if (d2g) for (let l = 0; l < n; l++) d2g[k][l][i][j] = e.h[k * n + l];
      }
    }
  }
  return { g, dg, d2g };
}

// Jacobian J[a][b] = d f^a / d x^b of a map f(x, F) -> [..], exact.
export function jacobianOf(f, x) {
  const F = jetOps(x.length, 1);
  const y = f(variables(F, x), F);
  return {
    value: y.map(v => (typeof v === 'number' ? v : v.v)),
    J: y.map(v => x.map((_, b) => (typeof v === 'number' ? 0 : v.g[b]))),
  };
}

// Coordinate maps for transform demos: each f(x, F) gives new coordinates.
export const COORD_MAPS = {
  polarToCartesian: { from: 'polar', to: 'euclid2', f: (x, F) => [F.mul(x[0], F.cos(x[1])), F.mul(x[0], F.sin(x[1]))] },
  cartesianToPolar: { from: 'euclid2', to: 'polar', f: (x, F) => [F.sqrt(F.add(F.sq(x[0]), F.sq(x[1]))), atan2J(F, x[1], x[0])] },
  sphericalToCartesian: {
    from: 'spherical', to: 'euclid3',
    f: (x, F) => { const s = F.sin(x[1]); return [F.mul(F.mul(x[0], s), F.cos(x[2])), F.mul(F.mul(x[0], s), F.sin(x[2])), F.mul(x[0], F.cos(x[1]))]; },
  },
  cylindricalToCartesian: { from: 'cylindrical', to: 'euclid3', f: (x, F) => [F.mul(x[0], F.cos(x[1])), F.mul(x[0], F.sin(x[1])), x[2]] },
};
// atan2 for jets (first order): d atan2(y, x) = (x dy - y dx) / (x^2 + y^2).
function atan2J(F, y, x) {
  const yv = F.val(y), xv = F.val(x), v = Math.atan2(yv, xv);
  if (typeof y === 'number' && typeof x === 'number') return v;
  const r2 = xv * xv + yv * yv, n = F.n;
  const gy = typeof y === 'number' ? new Float64Array(n) : y.g, gx = typeof x === 'number' ? new Float64Array(n) : x.g;
  const g = new Float64Array(n);
  for (let i = 0; i < n; i++) g[i] = (xv * gy[i] - yv * gx[i]) / r2;
  return { v, g, h: null };
}

// Lorentz boost with speed beta (c = 1) along axis 1, 2 or 3 of (t, x, y, z).
export function lorentzBoost(beta, axis = 1) {
  if (Math.abs(beta) >= 1) throw new Error('a boost needs |beta| < 1');
  const g = 1 / Math.sqrt(1 - beta * beta);
  const L = [0, 1, 2, 3].map(i => [0, 1, 2, 3].map(j => +(i === j)));
  L[0][0] = g; L[axis][axis] = g; L[0][axis] = -g * beta; L[axis][0] = -g * beta;
  return L;
}
export function rotation2(a) { return [[Math.cos(a), -Math.sin(a)], [Math.sin(a), Math.cos(a)]]; }
export function rotation3(axis, a) {
  const c = Math.cos(a), s = Math.sin(a);
  if (axis === 0) return [[1, 0, 0], [0, c, -s], [0, s, c]];
  if (axis === 1) return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}
