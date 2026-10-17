// ============================================================================
//  tensor/geometry.js  ·  connection, curvature, transport (DOM-free)
// ----------------------------------------------------------------------------
//  Conventions (MTW, signature -+++ for spacetime):
//      Gamma^a_{ij} = 1/2 g^{ab} (d_i g_bj + d_j g_bi - d_b g_ij)
//      R^r_{s m n}  = d_m Gamma^r_{ns} - d_n Gamma^r_{ms}
//                     + Gamma^r_{ml} Gamma^l_{ns} - Gamma^r_{nl} Gamma^l_{ms}
//      R_{sn} = R^r_{s r n}       R = g^{sn} R_{sn}
//      G_{mn} = R_{mn} - 1/2 R g_{mn}
//  A sphere of radius a has R = 2/a^2 > 0 in this convention.
//  The derivatives of g are exact (jet.js), so Gamma and Riemann have no
//  finite-difference error. covariantDerivative of a user field uses a
//  fourth-order central difference for the partial derivatives.
//
//  Tensor slot order: christoffel ['u','d','d'], riemann ['u','d','d','d'],
//  ricci/einstein ['d','d'], weyl ['d','d','d','d']. The covariant
//  derivative puts its new lower slot last: (nabla T)^a_{b;k}.
//
//  All functions take (metric, x, params) where metric is an id of
//  METRICS or a metric object, and params override metric.params.
//
//  ANCHORS   (grep -n "<anchor>" geometry.js)
//      christoffel ........... "export function christoffel"
//      christoffelJet ........ "export function christoffelJet"
//      riemann ............... "export function riemann"
//      ricci ................. "export function ricci"
//      scalarCurvature ....... "export function scalarCurvature"
//      einsteinTensor ........ "export function einsteinTensor"
//      weyl .................. "export function weyl"
//      curvatureAt ........... "export function curvatureAt"
//      nablaFromPartials ..... "export function nablaFromPartials"
//      covariantDerivative ... "export function covariantDerivative"
//      parallelTransport ..... "export function parallelTransport"
//      geodesic .............. "export function geodesic"
//      angleBetween .......... "export function angleBetween"
//      geodesicDeviation ..... "export function geodesicDeviation"
// ============================================================================

import { Tensor, matInverse, indexTuples } from './tensor.js';
import { getMetric, metricJet, metricAt, paramsOf } from './metrics.js';

// Christoffel symbols as nested arrays G[a][i][j], from a jet (order >= 1).
function gammaFrom(gInv, dg, n) {
  const G1 = []; // first kind G1[b][i][j]
  for (let b = 0; b < n; b++) {
    G1.push([]);
    for (let i = 0; i < n; i++) {
      G1[b].push(new Array(n));
      for (let j = 0; j < n; j++) G1[b][i][j] = 0.5 * (dg[i][b][j] + dg[j][b][i] - dg[b][i][j]);
    }
  }
  const G = [];
  for (let a = 0; a < n; a++) {
    G.push([]);
    for (let i = 0; i < n; i++) {
      G[a].push(new Array(n).fill(0));
      for (let j = 0; j < n; j++) { let s = 0; for (let b = 0; b < n; b++) s += gInv[a][b] * G1[b][i][j]; G[a][i][j] = s; }
    }
  }
  return { G, G1 };
}

const nest3ToTensor = (A, n, variance) => {
  const t = new Tensor([n, n, n], variance);
  for (let a = 0; a < n; a++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) t.data[(a * n + i) * n + j] = A[a][i][j];
  return t;
};

// Gamma^a_{ij} at x.
export function christoffel(metric, x, params) {
  const m = getMetric(metric), n = m.dim;
  const { g, dg } = metricJet(m, x, params, 1);
  const { G } = gammaFrom(matInverse(g), dg, n);
  return nest3ToTensor(G, n, ['u', 'd', 'd']);
}
// Fast nested form for integrators.
function gammaNested(m, x, params) {
  const { g, dg } = metricJet(m, x, params, 1);
  return gammaFrom(matInverse(g), dg, m.dim).G;
}

// Gamma and its exact derivative dGamma[k][a][i][j] = d_k Gamma^a_{ij}.
export function christoffelJet(metric, x, params) {
  const m = getMetric(metric), n = m.dim;
  const { g, dg, d2g } = metricJet(m, x, params, 2);
  const gInv = matInverse(g);
  const { G, G1 } = gammaFrom(gInv, dg, n);
  const dG = [];
  for (let k = 0; k < n; k++) {
    // d_k g^{ab} = -g^{ac} d_k g_cd g^{db}
    const dgi = [];
    for (let a = 0; a < n; a++) {
      dgi.push(new Array(n).fill(0));
      for (let b = 0; b < n; b++) {
        let s = 0;
        for (let c = 0; c < n; c++) { if (!gInv[a][c]) continue; for (let d = 0; d < n; d++) s -= gInv[a][c] * dg[k][c][d] * gInv[d][b]; }
        dgi[a][b] = s;
      }
    }
    const blk = [];
    for (let a = 0; a < n; a++) {
      blk.push([]);
      for (let i = 0; i < n; i++) {
        blk[a].push(new Array(n).fill(0));
        for (let j = 0; j < n; j++) {
          let s = 0;
          for (let b = 0; b < n; b++) {
            const dG1 = 0.5 * (d2g[k][i][b][j] + d2g[k][j][b][i] - d2g[k][b][i][j]);
            s += dgi[a][b] * G1[b][i][j] + gInv[a][b] * dG1;
          }
          blk[a][i][j] = s;
        }
      }
    }
    dG.push(blk);
  }
  return { g, gInv, dg, G, dG, n };
}

function riemannNested(G, dG, n) {
  const R = new Tensor([n, n, n, n], ['u', 'd', 'd', 'd']);
  for (let r = 0; r < n; r++) for (let s = 0; s < n; s++) for (let mu = 0; mu < n; mu++) for (let nu = 0; nu < n; nu++) {
    let v = dG[mu][r][nu][s] - dG[nu][r][mu][s];
    for (let l = 0; l < n; l++) v += G[r][mu][l] * G[l][nu][s] - G[r][nu][l] * G[l][mu][s];
    R.data[((r * n + s) * n + mu) * n + nu] = v;
  }
  return R;
}

// Every curvature quantity at one point.
export function curvatureAt(metric, x, params) {
  const m = getMetric(metric);
  const J = christoffelJet(m, x, params), n = J.n;
  const Riemann = riemannNested(J.G, J.dG, n);
  const gT = Tensor.fromNested(J.g, ['d', 'd']), gInvT = Tensor.fromNested(J.gInv, ['u', 'u']);
  const Ricci = new Tensor([n, n], ['d', 'd']);
  for (let s = 0; s < n; s++) for (let nu = 0; nu < n; nu++) {
    let v = 0; for (let r = 0; r < n; r++) v += Riemann.data[((r * n + s) * n + r) * n + nu];
    Ricci.data[s * n + nu] = v;
  }
  let R = 0;
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) R += J.gInv[a][b] * Ricci.data[a * n + b];
  const Einstein = new Tensor([n, n], ['d', 'd']);
  for (let i = 0; i < n * n; i++) Einstein.data[i] = Ricci.data[i] - 0.5 * R * gT.data[i];
  // R_{abcd} = g_{ar} R^r_{bcd}
  const RiemannDown = new Tensor([n, n, n, n], ['d', 'd', 'd', 'd']);
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) for (let c = 0; c < n; c++) for (let d = 0; d < n; d++) {
    let v = 0; for (let r = 0; r < n; r++) v += J.g[a][r] * Riemann.data[((r * n + b) * n + c) * n + d];
    RiemannDown.data[((a * n + b) * n + c) * n + d] = v;
  }
  return {
    n, g: gT, gInv: gInvT, Gamma: nest3ToTensor(J.G, n, ['u', 'd', 'd']), dGamma: J.dG,
    Riemann, RiemannDown, Ricci, R, Einstein, get Weyl() { return weylFrom(this); },
  };
}

function weylFrom(c) {
  const n = c.n, C = new Tensor([n, n, n, n], ['d', 'd', 'd', 'd']);
  if (n < 3) return C; // no Weyl tensor below 3 dimensions
  const g = (i, j) => c.g.data[i * n + j], Ric = (i, j) => c.Ricci.data[i * n + j];
  const k1 = 1 / (n - 2), k2 = c.R / ((n - 1) * (n - 2));
  for (const [a, b, cc, d] of indexTuples([n, n, n, n])) {
    const v = c.RiemannDown.get(a, b, cc, d)
      - k1 * (g(a, cc) * Ric(b, d) - g(a, d) * Ric(b, cc) - g(b, cc) * Ric(a, d) + g(b, d) * Ric(a, cc))
      + k2 * (g(a, cc) * g(b, d) - g(a, d) * g(b, cc));
    C.set(v, a, b, cc, d);
  }
  return C;
}

export function riemann(metric, x, params) { return curvatureAt(metric, x, params).Riemann; }
// ricci(metric, x, params) or ricci(riemannTensor).
export function ricci(metric, x, params) {
  if (metric instanceof Tensor) {
    const Rm = metric, n = Rm.shape[0], out = new Tensor([n, n], ['d', 'd']);
    for (let s = 0; s < n; s++) for (let nu = 0; nu < n; nu++) { let v = 0; for (let r = 0; r < n; r++) v += Rm.get(r, s, r, nu); out.set(v, s, nu); }
    return out;
  }
  return curvatureAt(metric, x, params).Ricci;
}
export function scalarCurvature(metric, x, params) { return curvatureAt(metric, x, params).R; }
export function einsteinTensor(metric, x, params) { return curvatureAt(metric, x, params).Einstein; }
export function weyl(metric, x, params) { return curvatureAt(metric, x, params).Weyl; }

// (nabla T) from the partial derivatives dT (T's slots plus a last slot k)
// and Gamma: + Gamma^a_{k c} T^{..c..} for each upper slot,
//            - Gamma^c_{k b} T_{..c..} for each lower slot.
export function nablaFromPartials(Gamma, T, dT) {
  const n = Gamma.shape[0], r = T.rank;
  const out = new Tensor(T.shape.concat([n]), T.variance.concat(['d']), dT.data);
  const idx2 = new Array(r);
  for (const full of indexTuples(out.shape)) {
    const k = full[r];
    let v = out.data[out.offset(full)];
    for (let s = 0; s < r; s++) {
      for (let q = 0; q < r; q++) idx2[q] = full[q];
      for (let c = 0; c < n; c++) {
        idx2[s] = c;
        const tv = T.data[T.offset(idx2)];
        if (!tv) continue;
        if (T.variance[s] === 'u') v += Gamma.get(full[s], k, c) * tv;
        else v -= Gamma.get(c, k, full[s]) * tv;
      }
    }
    out.data[out.offset(full)] = v;
  }
  return out;
}

// Partial derivatives of a field(x) -> Tensor by a 4th-order central difference.
export function partialDerivative(field, x, h = 1e-3) {
  const T0 = field(x), n = x.length;
  const out = new Tensor(T0.shape.concat([n]), T0.variance.concat(['d']));
  for (let k = 0; k < n; k++) {
    const at = d => { const y = x.slice(); y[k] += d; return field(y).data; };
    const p1 = at(h), m1 = at(-h), p2 = at(2 * h), m2 = at(-2 * h);
    for (let i = 0; i < T0.data.length; i++) out.data[i * n + k] = (8 * (p1[i] - m1[i]) - (p2[i] - m2[i])) / (12 * h);
  }
  return { T: T0, dT: out };
}

// covariantDerivative(metric, field, x, { params, h }) with field(x) -> Tensor.
export function covariantDerivative(metric, field, x, opts = {}) {
  const Gamma = christoffel(metric, x, opts.params);
  const { T, dT } = partialDerivative(field, x, opts.h ?? 1e-3);
  return nablaFromPartials(Gamma, T, dT);
}

// ---- integrators -------------------------------------------------------------
const axpy = (a, x, y) => y.map((v, i) => v + a * x[i]);

function curveFns(curve) {
  if (typeof curve === 'function') {
    const h = 1e-5;
    return { x: curve, dx: s => { const a = curve(s + h), b = curve(s - h); return a.map((v, i) => (v - b[i]) / (2 * h)); } };
  }
  return curve;
}

// parallelTransport(metric, curve, v0, { params, steps, s0, s1 }).
// curve(s) -> x, or { x(s), dx(s) }, s from s0 = 0 to s1 = 1.
// dv^a/ds = -Gamma^a_{bc} (dx^b/ds) v^c, RK4. Gives { s, x, v, final }.
export function parallelTransport(metric, curve, v0, opts = {}) {
  const m = getMetric(metric), p = paramsOf(m, opts.params), n = m.dim;
  const C = curveFns(curve), steps = opts.steps ?? 400, s0 = opts.s0 ?? 0, s1 = opts.s1 ?? 1, ds = (s1 - s0) / steps;
  const rhs = (s, v) => {
    const x = C.x(s), dx = C.dx(s), G = gammaNested(m, x, p);
    const out = new Array(n).fill(0);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) { if (!dx[b]) continue; for (let c = 0; c < n; c++) out[a] -= G[a][b][c] * dx[b] * v[c]; }
    return out;
  };
  const S = [s0], X = [C.x(s0)], V = [v0.slice()];
  let v = v0.slice();
  for (let k = 0; k < steps; k++) {
    const s = s0 + k * ds;
    const k1 = rhs(s, v), k2 = rhs(s + ds / 2, axpy(ds / 2, k1, v)), k3 = rhs(s + ds / 2, axpy(ds / 2, k2, v)), k4 = rhs(s + ds, axpy(ds, k3, v));
    v = v.map((vi, i) => vi + (ds / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    S.push(s + ds); X.push(C.x(s + ds)); V.push(v.slice());
  }
  return { s: S, x: X, v: V, final: v };
}

// geodesic(metric, x0, v0, { params, steps, ds | length, stop(x, v) }).
// x'' = -Gamma^a_{bc} x'^b x'^c, RK4 on (x, v). Gives { s, x, v, final }.
export function geodesic(metric, x0, v0, opts = {}) {
  const m = getMetric(metric), p = paramsOf(m, opts.params), n = m.dim;
  const steps = opts.steps ?? 400, ds = opts.ds ?? (opts.length ?? 1) / steps;
  const f = (x, v) => {
    const G = gammaNested(m, x, p), a = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let b = 0; b < n; b++) { if (!v[b]) continue; for (let c = 0; c < n; c++) a[i] -= G[i][b][c] * v[b] * v[c]; }
    return a;
  };
  let x = x0.slice(), v = v0.slice();
  const S = [0], X = [x.slice()], V = [v.slice()];
  for (let k = 0; k < steps; k++) {
    const a1 = f(x, v), x1 = v;
    const xb = axpy(ds / 2, x1, x), vb = axpy(ds / 2, a1, v), a2 = f(xb, vb), x2 = vb;
    const xc = axpy(ds / 2, x2, x), vc = axpy(ds / 2, a2, v), a3 = f(xc, vc), x3 = vc;
    const xd = axpy(ds, x3, x), vd = axpy(ds, a3, v), a4 = f(xd, vd), x4 = vd;
    x = x.map((xi, i) => xi + (ds / 6) * (x1[i] + 2 * x2[i] + 2 * x3[i] + x4[i]));
    v = v.map((vi, i) => vi + (ds / 6) * (a1[i] + 2 * a2[i] + 2 * a3[i] + a4[i]));
    S.push((k + 1) * ds); X.push(x.slice()); V.push(v.slice());
    if (opts.stop && opts.stop(x, v)) break;
  }
  return { s: S, x: X, v: V, final: { x, v } };
}

// g(u, v) at x, and the signed angle from u to v in a 2D metric.
export function inner(metric, x, u, v, params) {
  const g = metricAt(metric, x, params);
  let s = 0;
  for (let i = 0; i < u.length; i++) for (let j = 0; j < v.length; j++) s += g[i][j] * u[i] * v[j];
  return s;
}
export function angleBetween(metric, x, u, v, params) {
  const g = metricAt(metric, x, params);
  const ip = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) s += g[i][j] * a[i] * b[j]; return s; };
  const nu = Math.sqrt(ip(u, u)), nv = Math.sqrt(ip(v, v));
  const cos = ip(u, v) / (nu * nv);
  if (u.length !== 2) return Math.acos(Math.max(-1, Math.min(1, cos)));
  const det = g[0][0] * g[1][1] - g[0][1] * g[1][0];
  const sin = Math.sqrt(Math.abs(det)) * (u[0] * v[1] - u[1] * v[0]) / (nu * nv);
  return Math.atan2(sin, cos);
}

// Two nearby geodesics; the separation xi(s) = x2(s) - x1(s) in coordinates.
export function geodesicDeviation(metric, x0, v0, xi0, opts = {}) {
  const eps = opts.eps ?? 1e-3;
  const a = geodesic(metric, x0, v0, opts);
  const b = geodesic(metric, x0.map((v, i) => v + eps * xi0[i]), v0, opts);
  const k = Math.min(a.x.length, b.x.length);
  return { s: a.s.slice(0, k), x: a.x.slice(0, k), x2: b.x.slice(0, k), xi: a.x.slice(0, k).map((p, j) => p.map((v, i) => (b.x[j][i] - v) / eps)) };
}
