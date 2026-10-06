// ============================================================================
//  LINKAGES  ·  mech.js — joint positions of three planar linkages (no DOM)
// ----------------------------------------------------------------------------
//  No DOM and no THREE: tests.mjs runs this file in Node. Units are mm and
//  rad, in the plane of the linkage (X right, Y up). Every joint comes from
//  circle-circle intersections. Each circle pair has two answers; solve()
//  takes the branch that the unit asks for at the first call, then the
//  answer nearest the last one, so the linkage never flips through a
//  singular pose.
//
//  FOUR-BAR (crank-rocker)
//    Ground O2 = (0, 0), O4 = (d, 0). Crank a, coupler b, rocker c.
//    Grashof: s + l <= p + q, and the shortest link is the crank, so the
//    crank turns fully and the rocker swings. The coupler point P is fixed
//    on the coupler (u along A->B, v across it): it traces the coupler curve.
//
//  PEAUCELLIER-LIPKIN (exact straight line)
//    Fixed pivots O = (0, 0) and O1 = (r, 0). The input arm O1 C has length
//    r, so C runs on a circle through O. Two long links O A = O B = L and a
//    rhombus C A P B of side s. Then OC * OP = L^2 - s^2 (an inversion in a
//    circle), and the inverse of a circle through O is a straight line: P
//    moves on x = (L^2 - s^2) / (2 r) exactly. The arm swings +-SWING.
//
//  JANSEN LEG (Theo Jansen's numbers, scale k)
//    Crank centre O = (0, 0), crank m. Fixed pivot Z = (-a, -l). Links
//    b c d e f g h i j k as in Jansen's drawing. The foot G moves on a flat
//    stance stroke at the bottom and lifts on the way back.
//
//  GREP MAP
//    export const UNITS ......... the three units and their numbers
//    function solve ............. a circle-circle joint with a branch memory
//    export function makeLinkage  (unit) -> { pose(theta), links, pins }
//    export function circle2 .... both intersections of two circles
// ============================================================================

export const TAU = Math.PI * 2;
const D = Math.PI / 180;

export const UNITS = [
  { id: 'fourbar', name: 'Four-bar', kind: 'Crank-rocker · coupler curve', a: 40, b: 120, c: 80, d: 100, u: 70, v: 45 },
  { id: 'peaucellier', name: 'Peaucellier', kind: 'Exact straight line · 1864', r: 50, L: 140, s: 80, SWING: 75 * D },
  { id: 'jansen', name: 'Jansen leg', kind: 'Strandbeest walking leg', k: 2.6,
    J: { a: 38, b: 41.5, c: 39.3, d: 40.1, e: 55.8, f: 39.4, g: 36.7, h: 65.7, i: 49, j: 50, k: 61.9, l: 7.8, m: 15 } },
];
export const unit = id => UNITS.find(u => u.id === id);

export function circle2(p1, r1, p2, r2) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1], d = Math.hypot(dx, dy);
  if (d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9 || d === 0) return null;
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const mx = p1[0] + a * dx / d, my = p1[1] + a * dy / d;
  return [[mx + h * dy / d, my - h * dx / d], [mx - h * dy / d, my + h * dx / d]];
}

// A joint solver with memory. pick(first two answers) chooses at the first
// call; later calls take the answer nearest the last one.
function solve(pick) {
  let last = null;
  const f = (p1, r1, p2, r2) => {
    const s = circle2(p1, r1, p2, r2);
    if (!s) return last;
    const q = last ? (Math.hypot(s[0][0] - last[0], s[0][1] - last[1]) <= Math.hypot(s[1][0] - last[0], s[1][1] - last[1]) ? s[0] : s[1]) : pick(s);
    last = q;
    return q;
  };
  f.reset = () => { last = null; };
  return f;
}
const hi = s => (s[0][1] >= s[1][1] ? s[0] : s[1]);
const lo = s => (s[0][1] < s[1][1] ? s[0] : s[1]);
const left = s => (s[0][0] < s[1][0] ? s[0] : s[1]);
const ang = (p, q) => Math.atan2(q[1] - p[1], q[0] - p[0]);

// links: [{ id, from, to, len }] (joint names); pins: joint names;
// pose(theta) -> { J: joints by name, angle: link angles by id, ... }
export function makeLinkage(u) {
  if (u.id === 'fourbar') {
    const B = solve(hi), O2 = [0, 0], O4 = [u.d, 0];
    return {
      links: [{ id: 'crank', from: 'O2', to: 'A', len: u.a }, { id: 'coupler', from: 'A', to: 'B', len: u.b }, { id: 'rocker', from: 'O4', to: 'B', len: u.c }],
      ground: ['O2', 'O4'], trace: 'P',
      pose(th) {
        const A = [u.a * Math.cos(th), u.a * Math.sin(th)];
        const Bp = B(A, u.b, O4, u.c);
        const t = ang(A, Bp), P = [A[0] + u.u * Math.cos(t) - u.v * Math.sin(t), A[1] + u.u * Math.sin(t) + u.v * Math.cos(t)];
        return { J: { O2, O4, A, B: Bp, P }, input: th, out: ang(O4, Bp) };
      },
      reset() { B.reset(); },
    };
  }
  if (u.id === 'peaucellier') {
    const O = [0, 0], O1 = [u.r, 0];
    return {
      links: [{ id: 'arm', from: 'O1', to: 'C', len: u.r }, { id: 'longA', from: 'O', to: 'A', len: u.L }, { id: 'longB', from: 'O', to: 'B', len: u.L },
        { id: 'rhCA', from: 'C', to: 'A', len: u.s }, { id: 'rhCB', from: 'C', to: 'B', len: u.s }, { id: 'rhAP', from: 'A', to: 'P', len: u.s }, { id: 'rhBP', from: 'B', to: 'P', len: u.s }],
      ground: ['O', 'O1'], trace: 'P', line: (u.L * u.L - u.s * u.s) / (2 * u.r),
      pose(th) {
        // the arm swings about O1 between -SWING and +SWING as th turns
        const phi = u.SWING * Math.sin(th);
        const C = [u.r + u.r * Math.cos(phi), u.r * Math.sin(phi)];
        const s = circle2(O, u.L, C, u.s);
        // A on the left of O->C, B on the right, always
        const cx = (p) => (C[0] - O[0]) * (p[1] - O[1]) - (C[1] - O[1]) * (p[0] - O[0]);
        const A = cx(s[0]) > 0 ? s[0] : s[1], Bq = A === s[0] ? s[1] : s[0];
        const P = [A[0] + Bq[0] - C[0], A[1] + Bq[1] - C[1]];
        return { J: { O, O1, C, A, B: Bq, P }, input: phi, out: P[1] };
      },
      reset() {},
    };
  }
  // Jansen
  const k = u.k, J = Object.fromEntries(Object.entries(u.J).map(([n, v]) => [n, v * k]));
  const Z = [-J.a, -J.l], O = [0, 0];
  const sB = solve(hi), sD = solve(lo), sE = solve(left), sF = solve(left), sG = solve(lo);
  return {
    links: [{ id: 'crank', from: 'O', to: 'C', len: J.m }, { id: 'j', from: 'C', to: 'B', len: J.j }, { id: 'kk', from: 'C', to: 'D', len: J.k },
      { id: 'b', from: 'Z', to: 'B', len: J.b }, { id: 'c', from: 'Z', to: 'D', len: J.c }, { id: 'd', from: 'Z', to: 'E', len: J.d }, { id: 'e', from: 'B', to: 'E', len: J.e },
      { id: 'f', from: 'E', to: 'F', len: J.f }, { id: 'g', from: 'D', to: 'F', len: J.g }, { id: 'h', from: 'F', to: 'G', len: J.h }, { id: 'i', from: 'D', to: 'G', len: J.i }],
    ground: ['O', 'Z'], trace: 'G', J,
    pose(th) {
      const C = [J.m * Math.cos(th), J.m * Math.sin(th)];
      const B = sB(C, J.j, Z, J.b), Dp = sD(C, J.k, Z, J.c), E = sE(B, J.e, Z, J.d), F = sF(E, J.f, Dp, J.g), G = sG(F, J.h, Dp, J.i);
      return { J: { O, Z, C, B, D: Dp, E, F, G }, input: th, out: G[1] };
    },
    reset() { [sB, sD, sE, sF, sG].forEach(f => f.reset()); },
  };
}

// The trace curve over one input turn: N points of the trace joint.
export function traceCurve(u, N = 360) {
  const L = makeLinkage(u), pts = [];
  for (let i = 0; i < N; i++) pts.push(L.pose(TAU * i / N).J[L.trace]);
  return pts;
}
