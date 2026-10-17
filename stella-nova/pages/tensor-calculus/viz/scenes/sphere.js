// ============================================================================
//  TENSOR CALCULUS  ·  viz/scenes/sphere.js  ·  curvature on a sphere  (VIZ)
// ----------------------------------------------------------------------------
//  parallel-transport  A tangent vector goes round a loop on the sphere
//      with no turn of its own (Levi-Civita transport). It comes back
//      turned by the holonomy angle = the integral of K dA over the
//      inside (Gauss-Bonnet): 2 pi (1 - cos th0) for a latitude loop,
//      pi/2 for the octant triangle. Readouts: holonomy, expected.
//  geodesic-deviation  Geodesics that start parallel. On the sphere
//      (K > 0) they meet at the pole; on a saddle (K < 0) they spread.
//      The deviation vector xi obeys D^2 xi / ds^2 = -K xi (Jacobi).
//  curvature-loop  Transport a vector from P to the far corner Q of a
//      small coordinate square by two routes (first mu then nu, or first
//      nu then mu). The two results differ by R^rho_{sigma mu nu} v^sigma
//      dx^mu dx^nu. The angle between them divided by the area goes to
//      K = 1/R^2 as the square shrinks. Readouts: angle, area, ratio.
//
//  DOM-free maths for tests:  grep -n "export function loopPath\|export function transportRun\|export function routes"
// ============================================================================
import { LOOK, tn, num, ic } from '../look.js';
import { sph, sphBasis, transportSphere, signedAngle, holonomyLatitude, greatArc, graphGeodesic,
  add, sub, scl, dot, cross, len, unit, wave, seg, ease, clamp, lerp3, rotVec } from '../vmath.js';

const R = 1.6;

function globe(dl, o = {}) {
  dl.surface((u, v) => sph(Math.PI * v, 2 * Math.PI * u, R), 72, 36, (u, v) => {
    const k = 0.55 + 0.45 * Math.cos(Math.PI * v * 0.9);
    return [0.11 * k + 0.05, 0.14 * k + 0.06, 0.26 * k + 0.1];
  }, { closeU: true, flipN: true, a: o.a ?? 1, wire: { nu: 24, nv: 12, c: '#7d8fc4', a: 0.16, w: 1, lift: 0.004 } });
}

// The loop on the sphere (unit sphere points times R), N + 1 points.
export function loopPath(kind, th0 = 1.0, N = 360) {
  if (kind === 'triangle') {
    const P = [0, 1, 0], A = [1, 0, 0], B = [0, 0, 1];
    const n = Math.round(N / 3);
    return [...greatArc(P, A, n, R), ...greatArc(A, B, n, R).slice(1), ...greatArc(B, P, n, R).slice(1)];
  }
  const pts = [];
  for (let i = 0; i <= N; i++) pts.push(sph(th0, (2 * Math.PI * i) / N, R));
  return pts;
}
// Transport v0 round the loop; returns { vs, angle } with the signed
// holonomy angle at the start point (about the outward normal).
export function transportRun(kind, th0, v0) {
  const pts = loopPath(kind, th0);
  const vs = transportSphere(pts, v0);
  const angle = signedAngle(v0, vs[vs.length - 1], unit(pts[0]));
  return { pts, vs, angle };
}
// The path of a MATH parallel-transport step on the sphere metric:
// numeric.inputs.path rows (th, ph), numeric.output rows (v^th, v^ph).
export function mathPath(step) {
  const nm = step && step.numeric, P = nm && nm.inputs && nm.inputs.path, Vc = nm && nm.output;
  if (!P || !Vc || P.shape.length !== 2 || P.shape[1] !== 2 || Vc.shape.join() !== P.shape.join()) return null;
  const pts = [], vs = [];
  for (let i = 0; i < P.shape[0]; i++) {
    const th = P.data[2 * i], ph = P.data[2 * i + 1], b = sphBasis(th, ph, R);
    pts.push(sph(th, ph, R));
    vs.push(add(scl(b.eth, Vc.data[2 * i]), scl(b.eph, Vc.data[2 * i + 1])));
  }
  const k = 0.6 / (len(vs[0]) || 1);
  for (let i = 0; i < vs.length; i++) vs[i] = scl(vs[i], k);
  const angle = signedAngle(vs[0], vs[vs.length - 1], unit(pts[0]));
  return { pts, vs, angle, holonomy: step.holonomy ?? null };
}

export function expectedHolonomy(kind, th0) {
  if (kind === 'triangle') return Math.PI / 2;
  const a = holonomyLatitude(th0);
  return a > Math.PI ? a - 2 * Math.PI : a;
}

export const parallelTransport = {
  id: 'parallel-transport',
  label: 'Parallel transport and holonomy',
  blurb: 'Carry a vector round a loop with no turn of its own: it comes back turned by the enclosed curvature.',
  params: [
    { key: 'path', label: 'loop', options: ['latitude', 'triangle'], def: null },
    { key: 'th0', label: 'colatitude θ₀', min: 0.25, max: 1.45, step: 0.01, def: null },
  ],
  camera: { pos: [3.3, 2.5, 4.3], target: [0, 0.25, 0], fov: 40 },
  fog: 0.05,
  frame(dl, S) {
    const T = S.time, p = S.p;
    const cyc = Math.floor(T / 16);
    const kind = p.path ?? (cyc % 2 ? 'triangle' : 'latitude');
    const th0 = p.th0 ?? (0.95 + 0.3 * Math.sin(cyc * 1.7));
    const u = S.t != null ? S.t : clamp(((T % 16) - 1) / 11, 0, 1);
    globe(dl);
    // the start vector: for the latitude loop, along -d/dth (north)
    const pts0 = loopPath(kind, th0);
    const P0 = pts0[0];
    let v0;
    if (kind === 'triangle') v0 = scl(unit(add([1, 0, 0], [0, 0, 0.55])), 0.6);
    else v0 = scl(unit(sphBasis(th0, 0, R).eth), -0.6);
    let run = transportRun(kind, th0, v0);
    // a MATH trace step: its own path (th, ph) and vectors (v^th, v^ph)
    const mp = mathPath(S.step);
    if (mp) { run = mp; v0 = mp.vs[0]; }
    const N = run.pts.length - 1, k = Math.round(u * N);
    // the enclosed region, filled
    if (kind === 'latitude') {
      dl.surface((a, b) => sph(th0 * b, 2 * Math.PI * a, R * 1.003), 64, 10, LOOK.gold, { a: 0.1, closeU: true, flipN: true });
    } else {
      dl.surface((a, b) => sph(b * Math.PI / 2, a * Math.PI / 2, R * 1.003), 24, 16, LOOK.gold, { a: 0.1 });
    }
    // the path: done part bright
    const lift = q => scl(q, 1.006);
    dl.poly(run.pts.slice(0, k + 1).map(lift), LOOK.gold, { w: 3, a: 0.95 });
    dl.poly(run.pts.slice(k).map(lift), LOOK.gold, { w: 1.4, a: 0.3 });
    // a trail of ghost vectors
    const step = Math.max(1, Math.round(N / 30));
    for (let i = 0; i < k; i += step) dl.arrow(lift(run.pts[i]), run.vs[i], LOOK.vec, { r: 0.012, a: 0.22 + 0.4 * (i / Math.max(1, k)), sym: 'v' });
    // the vector now
    dl.arrow(lift(run.pts[k]), run.vs[k], LOOK.vec, { r: 0.03, sym: 'v' });
    dl.label(add(lift(run.pts[k]), scl(run.vs[k], 1.25)), tn('v', ['μ']), { c: LOOK.vec, size: 17, sym: 'mu' });
    // the start vector, always shown faint, and at the end the turn
    dl.arrow(lift(P0), v0, LOOK.ink, { r: 0.02, a: 0.55 });
    const done = seg(u, 0.96, 1);
    const ang = run.angle * (k / N > 0.999 ? 1 : 0);
    if (done > 0) {
      const n = unit(P0), arc = [];
      for (let i = 0; i <= 40; i++) arc.push(add(lift(P0), scl(rotVec(unit(v0), n, (run.angle * i) / 40), 0.42)));
      dl.poly(arc, LOOK.gold, { w: 2.6, a: done });
      dl.label(add(lift(P0), add(scl(unit(v0), 0.5), scl(n, 0.35))), `turn = ${num(run.angle, 3)} rad`, { c: LOOK.gold, size: 15, a: done });
    }
    const exp = mp && mp.holonomy != null ? mp.holonomy : expectedHolonomy(kind, th0);
    dl.label(null, `${tn('v', ['μ'])}: &nbsp;d${tn('v', ['μ'])}/dλ + ${tn('Γ', ['μ'], ['ν', 'ρ'])} ${tn('v', ['ν'])} d${tn('x', ['ρ'])}/dλ = 0`, { screen: [0.5, 0.06], size: 17, c: LOOK.ink });
    dl.label(null, `∮ K dA = ${kind === 'triangle' ? '(1/R²)·(πR²/2)' : '2π(1 − cos θ₀)'} = ${num(exp, 3)}`, { screen: [0.5, 0.94], size: 15, c: LOOK.gold, a: 0.5 + 0.5 * done });
    dl.read('holonomy', run.angle); dl.read('expected', exp); dl.read('progress', u); dl.read('th0', th0);
    void ang;
  },
};

// ---- geodesic deviation -------------------------------------------------------
const SADDLE_A = 1.6;
const saddleF = (x, z) => ({ f: (x * x - z * z) / (2 * SADDLE_A), fx: x / SADDLE_A, fz: -z / SADDLE_A, fxx: 1 / SADDLE_A, fxz: 0, fzz: -1 / SADDLE_A });

export function deviationFamily(surface, n = 7, gap = 0.16, s = 1) {
  // sphere: meridians from the equator, phi_k = k gap, heading north
  if (surface === 'sphere') {
    return Array.from({ length: n }, (_, i) => {
      const ph = (i - (n - 1) / 2) * gap, pts = [];
      for (let j = 0; j <= 80; j++) pts.push(sph(Math.PI / 2 - (j / 80) * s * Math.PI / 2, ph, R));
      return pts;
    });
  }
  // saddle y = (x^2 - z^2) / 2a: geodesics that start parallel along +z
  return Array.from({ length: n }, (_, i) => {
    const x0 = (i - (n - 1) / 2) * gap * 1.6;
    return graphGeodesic(saddleF, [x0, -1.6], [0, 1], Math.round(160 * s), 0.02);
  });
}

export const geodesicDeviation = {
  id: 'geodesic-deviation',
  label: 'Geodesics and geodesic deviation',
  blurb: 'Parallel geodesics meet on a sphere and spread on a saddle: D²ξ/ds² = −K ξ.',
  params: [{ key: 'surface', label: 'surface', options: ['sphere', 'saddle'], def: 'sphere' }],
  camera: { pos: [3.6, 2.6, 3.4], target: [0, 0.5, 0], fov: 40 },
  fog: 0.05,
  frame(dl, S) {
    const T = S.time, p = S.p, cyc = Math.floor(T / 14);
    const surface = p.surface ?? 'sphere';
    const u = S.t != null ? ease(S.t) : seg((T % 14), 1, 11);
    const fam = deviationFamily(surface, 7, 0.17, 1);
    if (surface === 'sphere') globe(dl);
    else {
      dl.surface((a, b) => { const x = (a - 0.5) * 3.6, z = (b - 0.5) * 3.6; return [x, saddleF(x, z).f, z]; }, 48, 48, (a, b) => {
        const x = (a - 0.5) * 3.6, z = (b - 0.5) * 3.6, r = Math.hypot(x, z) / 2.5;
        const k = Math.max(0, 1 - r * r);
        return [0.1 + 0.08 * k, 0.12 + 0.1 * k, 0.22 + 0.16 * k];
      }, { wire: { nu: 18, nv: 18, c: '#7d8fc4', a: 0.18, w: 1, lift: 0.004 } });
    }
    const lift = q => surface === 'sphere' ? scl(q, 1.006) : add(q, [0, 0.01, 0]);
    let devs = [];
    fam.forEach((g, i) => {
      const k = Math.max(1, Math.round(u * (g.length - 1)));
      dl.poly(g.slice(0, k + 1).map(lift), ic('mu'), { w: 2.4, a: 0.95, sym: 'mu' });
      dl.poly(g.slice(k).map(lift), ic('mu'), { w: 1, a: 0.2, sym: 'mu' });
      dl.ball(lift(g[k]), 0.035, ic('mu'), { sym: 'mu' });
      // the tangent u^mu at the head
      const t = unit(sub(g[Math.min(g.length - 1, k + 1)], g[Math.max(0, k - 1)]));
      if (i === 3) {
        dl.arrow(lift(g[k]), scl(t, 0.35), ic('mu'), { r: 0.018, sym: 'mu' });
        dl.label(add(lift(g[k]), scl(t, 0.5)), tn('u', ['μ']), { c: ic('mu'), size: 15, sym: 'mu' });
      }
      if (i > 0) {
        const a = lift(fam[i - 1][Math.max(1, Math.round(u * (fam[i - 1].length - 1)))]), b = lift(g[k]);
        devs.push(len(sub(b, a)));
        dl.arrow(a, sub(b, a), ic('nu'), { r: 0.012, head: 0.05, sym: 'nu' });
      }
    });
    // the start spacing, for the readout
    const d0 = len(sub(fam[1][0], fam[0][0]));
    const ratio = devs.length ? devs[2] / d0 : 1;
    const mid = fam[3][Math.max(1, Math.round(u * (fam[3].length - 1)))];
    dl.label(add(lift(mid), surface === 'sphere' ? scl(unit(mid), 0.32) : [0.3, 0.3, 0]), `${tn('ξ', ['ν'])}`, { c: ic('nu'), size: 17, sym: 'nu' });
    dl.label(null, `D²${tn('ξ', ['μ'])}/ds² = −${tn('R', ['μ'], ['ν', 'ρ', 'σ'])} ${tn('u', ['ν'])}${tn('ξ', ['ρ'])}${tn('u', ['σ'])}`, { screen: [0.5, 0.06], size: 17, c: LOOK.ink });
    const K = surface === 'sphere' ? 1 / (R * R) : -1 / (SADDLE_A * SADDLE_A);
    dl.label(null, `K = ${num(K, 3)} &nbsp; |ξ| / |ξ₀| = ${num(ratio, 3)}`, { screen: [0.5, 0.94], size: 15, c: K > 0 ? LOOK.pos : LOOK.neg });
    dl.read('K', K); dl.read('ratio', ratio); dl.read('progress', u);
  },
};

// ---- curvature from a small loop ----------------------------------------------
// Transport v0 from P = (th0, ph0) to Q = (th0 + d, ph0 + d) by two routes.
export function routes(th0, ph0, d, v0, N = 120) {
  const line = (a, b) => {   // coordinate line from (th, ph) a to b
    const pts = [];
    for (let i = 0; i <= N; i++) { const t = i / N; pts.push(sph(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, R)); }
    return pts;
  };
  const P = [th0, ph0], A = [th0, ph0 + d], B = [th0 + d, ph0], Q = [th0 + d, ph0 + d];
  const r1 = [...line(P, A), ...line(A, Q).slice(1)];   // phi first (mu), then theta (nu)
  const r2 = [...line(P, B), ...line(B, Q).slice(1)];   // theta first, then phi
  const v1 = transportSphere(r1, v0), v2 = transportSphere(r2, v0);
  const q = r1[r1.length - 1];
  const angle = signedAngle(v2[v2.length - 1], v1[v1.length - 1], unit(q));
  // the coordinate area of the square: integral of R^2 sin(th) dth dph
  const area = R * R * d * (Math.cos(th0) - Math.cos(th0 + d));
  return { r1, r2, v1, v2, angle, area, ratio: angle / area };
}

export const curvatureLoop = {
  id: 'curvature-loop',
  label: 'Curvature from a small loop',
  blurb: 'Two routes to the same corner give two vectors; their gap is the Riemann tensor times the loop.',
  params: [{ key: 'd', label: 'loop size', min: 0.08, max: 0.9, step: 0.01, def: null }],
  camera: { pos: [2.9, 3.0, 2.6], target: [0.8, 0.85, 0.7], fov: 38 },
  fog: 0.06,
  frame(dl, S) {
    const T = S.time, p = S.p;
    const d = p.d ?? (0.2 + 0.6 * wave(T, 20));
    const u = S.t != null ? S.t : seg(T % 10, 0.5, 7);
    const th0 = 0.55, ph0 = 0.35;
    globe(dl);
    const P = sph(th0, ph0, R), b = sphBasis(th0, ph0, R);
    const v0 = scl(unit(add(unit(b.eth), scl(unit(b.eph), 0.8))), 0.3);
    const rt = routes(th0, ph0, d, v0);
    const lift = q => scl(q, 1.006);
    // the coordinate square, filled
    dl.surface((a, c) => sph(th0 + d * c, ph0 + d * a, R * 1.003), 12, 12, LOOK.gold, { a: 0.12 });
    const N = rt.r1.length - 1, k = Math.round(u * N), half = Math.floor(N / 2);
    for (const [r, vs, cA, cB, sA, sB] of [[rt.r1, rt.v1, ic('mu'), ic('nu'), 'mu', 'nu'], [rt.r2, rt.v2, ic('nu'), ic('mu'), 'nu', 'mu']]) {
      dl.poly(r.slice(0, half + 1).map(lift), cA, { w: 2.6, a: 0.9, sym: sA });
      dl.poly(r.slice(half).map(lift), cB, { w: 2.6, a: 0.9, sym: sB });
      const step = Math.max(1, Math.round(N / 8));
      for (let i = 0; i < k; i += step) dl.arrow(lift(r[i]), vs[i], LOOK.vec, { r: 0.008, a: 0.3, sym: 'sigma' });
      dl.arrow(lift(r[k]), vs[k], LOOK.vec, { r: 0.02, sym: 'sigma' });
    }
    dl.label(lift(rt.r1[Math.round(half / 2)]), `d${tn('x', ['μ'])}`, { c: ic('mu'), size: 15, sym: 'mu', anchor: 'l' });
    dl.label(lift(rt.r2[Math.round(half / 2)]), `d${tn('x', ['ν'])}`, { c: ic('nu'), size: 15, sym: 'nu', anchor: 'r' });
    dl.label(add(lift(P), [0, 0.08, 0]), 'P', { c: LOOK.ink, size: 15 });
    const done = seg(u, 0.95, 1);
    const Q = lift(rt.r1[N]);
    if (done > 0) {
      const a = rt.v1[N], c = rt.v2[N];
      dl.arrow(add(Q, c), sub(a, c), LOOK.gold, { r: 0.012, head: 0.05, a: done, sym: 'rho' });
      dl.label(add(Q, scl(add(a, c), 0.62)), `δ${tn('v', ['ρ'])}`, { c: LOOK.gold, size: 15, a: done, sym: 'rho' });
    }
    dl.label(null, `δ${tn('v', ['ρ'])} = ${tn('R', ['ρ'], ['σ', 'μ', 'ν'])} ${tn('v', ['σ'])} d${tn('x', ['μ'])} d${tn('x', ['ν'])}`, { screen: [0.5, 0.06], size: 17, c: LOOK.ink });
    dl.label(null, `angle / area = ${num(rt.angle, 4)} / ${num(rt.area, 4)} = ${num(rt.ratio, 4)} &nbsp;→ K = 1/R² = ${num(1 / (R * R), 4)}`, { screen: [0.5, 0.94], size: 15, c: LOOK.gold });
    dl.read('angle', rt.angle); dl.read('area', rt.area); dl.read('ratio', rt.ratio); dl.read('d', d);
  },
};
