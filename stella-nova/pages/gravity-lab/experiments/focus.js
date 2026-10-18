// ============================================================================
//  GRAVITY LAB  ·  experiments/focus.js — the focus hooks of the experiments
// ----------------------------------------------------------------------------
//  An experiment with focus(st) tells the action camera (focus.js, THE
//  HOOK) what its action is. The generic weights (each live body 1, a
//  leaving body less, the particles a share) are enough for most runs.
//  These runs need more:
//    galaxies     the two cores and their stars (the tails weigh 60%);
//                 the framing holds both cores (hold)
//    pythagorean  the close encounters: a body weighs more when its
//                 nearest neighbour is near; a leaving body almost 0
//    slingshot    the probe and Jupiter; the Sun and the belt fade out as
//                 the probe comes close to Jupiter
//    lagrange     the five Lagrange points, the two bodies, and the dust
//                 at the points
//    blackhole    Sgr A* and the S-stars; a star near periapsis (a large
//                 pull) weighs more; the stars that fall close to the hole
//                 weigh more, the outer disk of stars does not count
//    tde          the star and the hole; after the breakup the debris
//                 that is bound to the hole (the stream that falls back),
//                 most near the hole; the unbound half little
//    The galaxies keep their unbound stars (keepLeaving): the tails are
//    the action.
//  st: { spec, sys, frame, gone, leaving, parts, ext, rNow, t }.
//
//  grep -n targets: "export function galaxiesFocus", "export function
//  closeFocus", "export function slingshotFocus", "export function
//  lagrangeFocus", "export function blackholeFocus", "export function tdeFocus"
// ============================================================================
import { FOCUS } from '../focus.js';
import { toFrame } from '../frame.js';

const live = (st, i) => i < st.sys.n && st.sys.alive[i] && !st.gone[i];
const dist = (s, i, j) => Math.hypot(s.x[3 * i] - s.x[3 * j], s.x[3 * i + 1] - s.x[3 * j + 1], s.x[3 * i + 2] - s.x[3 * j + 2]);
const r2 = (P, k) => P.pos[3 * k] ** 2 + P.pos[3 * k + 1] ** 2 + P.pos[3 * k + 2] ** 2;

export function galaxiesFocus(st) {
  const s = st.sys;
  if (!live(st, 0) || !live(st, 1)) return null;
  return { bodyW: [1, 1], partShare: 1.5, actionK: 1, hold: [0, 1], keepLeaving: true };
}

// Weight 0.5 + 1.5 dMin / dNearest(i): the bodies of the closest pair 2.
export function closeFocus(st) {
  const s = st.sys, n = s.n, nn = new Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) if (live(st, i)) for (let j = i + 1; j < n; j++) if (live(st, j)) {
    const d = dist(s, i, j); nn[i] = Math.min(nn[i], d); nn[j] = Math.min(nn[j], d);
  }
  const dMin = Math.min(...nn);
  if (!isFinite(dMin)) return null;
  const bodyW = nn.map((d, i) => !live(st, i) ? 0 : st.leaving[i] ? FOCUS.LEAVE_W : 0.5 + 1.5 * dMin / Math.max(d, 1e-300));
  return { bodyW, partShare: 0.25 };
}

// bodies: 0 the Sun, 1 Jupiter, 2 the probe; particle group 0 the probe
// swarm, 1 the main belt.
export function slingshotFocus(st) {
  const s = st.sys;
  if (!live(st, 1) || !live(st, 2)) return null;
  const near = Math.max(0, 1 - dist(s, 1, 2) / (0.35 * st.ext));
  const P = st.parts;
  return {
    bodyW: [0.02 + 0.3 * (1 - near), 1.5, 2],
    partShare: 0.05 + 0.4 * (1 - near),
    partW: P ? (k => P.group[k] === 0 ? 3 : 1) : null,
  };
}

// spec.Lp: the points in units of the separation, the barycentre at 0
// and the secondary on +x.
export function lagrangeFocus(st) {
  const s = st.sys, Lp = st.spec && st.spec.Lp;
  if (!Lp || !live(st, 0) || !live(st, 1)) return null;
  const M = s.m[0] + s.m[1], c = [0, 1, 2].map(k => (s.m[0] * s.x[k] + s.m[1] * s.x[3 + k]) / M);
  const ax = [s.x[3] - s.x[0], s.x[4] - s.x[1], s.x[5] - s.x[2]], d = Math.hypot(...ax);
  const ex = ax.map(a => a / d), ey = [-ex[1], ex[0], 0];
  const points = Lp.map(L => {
    const p = toFrame(st.frame, [c[0] + d * (L[0] * ex[0] + L[1] * ey[0]), c[1] + d * (L[0] * ex[1] + L[1] * ey[1]), c[2]]);
    return [p[0], p[1], p[2], 1];
  });
  return { bodyW: [1, 1], points, partShare: 1, actionK: 0 };
}

// body 0 Sgr A* (the frame centre), 1.. the S-stars.
export function blackholeFocus(st) {
  const s = st.sys, a = [];
  for (let i = 1; i < s.n; i++) if (live(st, i)) a.push(Math.hypot(s.a[3 * i], s.a[3 * i + 1], s.a[3 * i + 2]));
  a.sort((p, q) => p - q);
  const med = a[a.length >> 1] || 1, P = st.parts, ext = st.ext;
  const bodyW = [];
  for (let i = 0; i < s.n; i++) {
    if (!live(st, i)) { bodyW.push(0); continue; }
    if (i === 0) { bodyW.push(1.5); continue; }
    const ai = Math.hypot(s.a[3 * i], s.a[3 * i + 1], s.a[3 * i + 2]);
    bodyW.push(st.leaving[i] ? FOCUS.LEAVE_W : 0.5 + 1.5 * Math.min(1, ai / (3 * med)));
  }
  return {
    bodyW, partShare: 0.5,
    partW: P ? (k => { const q = r2(P, k); return q < (0.6 * ext) ** 2 ? 2 : q < (1.5 * ext) ** 2 ? 1 : 0; }) : null,
  };
}

// body 0 Sgr A* (the frame centre), 1 the star; debris rows have group -1.
export function tdeFocus(st) {
  const P = st.parts, star = live(st, 1), ext = st.ext;
  return {
    bodyW: [1, star ? 2 : 0],
    partShare: star ? 0.2 : 1,
    // the gas ring a little; the debris that is bound to the hole and near
    // it (the stream that falls back) most, the bound debris far out less,
    // the half that is flung away little
    partW: P ? (k => {
      if (P.group[k] >= 0) return 0.15;
      const v2 = P.vel[3 * k] ** 2 + P.vel[3 * k + 1] ** 2 + P.vel[3 * k + 2] ** 2, q = r2(P, k), M = st.sys.m[0];
      if (0.5 * v2 >= M / Math.sqrt(Math.max(q, 1e-300))) return 0.1;
      return q < (0.4 * ext) ** 2 ? 4 : 1;
    }) : null,
  };
}
