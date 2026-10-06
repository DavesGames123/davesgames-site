// ============================================================================
//  CVT  ·  model.js — geometry and ratio of two continuously variable drives
// ----------------------------------------------------------------------------
//  No DOM and no THREE: tests.mjs runs this file in Node. Units are mm and
//  rad. A control value x in 0..1 sets the ratio of each unit: x = 0 is
//  the lowest gear (the output turns slowest), x = 1 the highest.
//
//  PUSH-BELT CVT (Van Doorne)
//    Two shafts at centre distance C. Each pulley is two cones (sheaves)
//    with the half angle BETA. One sheave of each pulley slides on the
//    shaft. At radius r the axial gap between the faces is s + 2 r tan BETA,
//    s being the gap at r = 0. The belt is BW wide at its pitch line, so it
//    runs where the gap is BW:  r = (BW - s) / (2 tan BETA).
//    The control sets the input radius r1 = R_MIN + x (R_MAX - R_MIN). The
//    belt length is fixed, so r2 follows from
//      L = 2 C cos a + pi (r1 + r2) + 2 a (r1 - r2),   sin a = (r1 - r2) / C
//    with L0 = L(R_MAX, R_MIN). Newton on r2 (dL/dr2 = pi - 2a).
//    Ratio i = w1 / w2 = r2 / r1. The movable sheaves sit on opposite
//    sides, so the belt centre planes move the same way and nearly keep in
//    line. The rest (the misalignment) is tan BETA (2 r_m - r1 - r2), r_m the
//    radius at i = 1.
//    The pitch loop, run counter-clockwise from above +z: the top strand
//    from pulley 2 to pulley 1, the arc on pulley 1, the bottom strand, the
//    arc on pulley 2. Pulley 1 centre (-C/2, 0), pulley 2 (C/2, 0).
//
//  FULL-TOROIDAL TRACTION DRIVE (Torotrak)
//    Main axis a. The cavity between the input disc (a < 0) and the output
//    disc (a > 0) is a torus: core circle radius E, tube radius R0. Each
//    roller has its centre on the core circle and its rim radius
//    RHO = R0 - FILM (FILM: the traction oil film). It tilts by g about the
//    tangent of the core circle. In the (r, a) plane of the roller:
//      input contact   P1 = (E - R0 sin g, -R0 cos g)
//      output contact  P2 = (E + R0 sin g,  R0 cos g)
//      roller axis     n  = (cos g, -sin g)
//    No slip: w_in r_in = w_roll RHO = w_out r_out, the output turns back.
//    i = w_in / |w_out| = r_out / r_in. The control sets g = G_MAX (1 - 2x).
//    i(g) i(-g) = 1: the range is the same each side of 1 : 1.
//
//  GREP MAP
//    export const UNITS ......... the two units and their numbers
//    export function beltLength . L(C, r1, r2)
//    export function beltState .. (u, x) -> radii, sheave gaps, ratio, L
//    export function beltPoint .. (u, st, s) -> a point of the pitch loop
//    export function toroState .. (u, x) -> tilt, contacts, ratio
// ============================================================================

export const TAU = Math.PI * 2;
const D = Math.PI / 180;

export const UNITS = [
  { id: 'belt', name: 'Push-belt CVT', kind: 'Sliding sheaves · steel push belt',
    C: 170, BETA: 11 * D, BW: 34, R_MIN: 30, R_MAX: 72, R_OUT: 81, SHAFT: 12,
    N: 256, DEPTH: 12, HEAD: 5.4, CLEAR: 0.5, T_TOP: 2.0, T_LOW: 1.0 },
  { id: 'toroidal', name: 'Toroidal CVT', kind: 'Full-toroidal traction drive',
    E: 60, R0: 40, FILM: 0.4, G_MAX: 0.6, GAP: 16, CROWN: 10, ROLL_T: 16, N_ROLL: 2, SHAFT: 10 },
];
export const unit = id => UNITS.find(u => u.id === id);

// ── push belt ───────────────────────────────────────────────────────────────
export function beltLength(C, r1, r2) {
  const a = Math.asin((r1 - r2) / C);
  return 2 * C * Math.cos(a) + Math.PI * (r1 + r2) + 2 * a * (r1 - r2);
}
export const L0 = u => beltLength(u.C, u.R_MAX, u.R_MIN);
// the radius on both pulleys at i = 1
export const rMid = u => (L0(u) - 2 * u.C) / (2 * Math.PI);
// the sheave gap at r = 0 that puts the belt at radius r
export const sheaveS = (u, r) => u.BW - 2 * r * Math.tan(u.BETA);
export const gapAt = (u, s, r) => s + 2 * r * Math.tan(u.BETA);

export function solveR2(u, r1) {
  const L = L0(u);
  let r2 = 2 * rMid(u) - r1;
  for (let k = 0; k < 40; k++) {
    const a = Math.asin((r1 - r2) / u.C), f = beltLength(u.C, r1, r2) - L;
    r2 -= f / (Math.PI - 2 * a);
    if (Math.abs(f) < 1e-13) break;
  }
  return r2;
}

export function beltState(u, x) {
  x = Math.max(0, Math.min(1, x));
  const r1 = u.R_MIN + x * (u.R_MAX - u.R_MIN), r2 = solveR2(u, r1);
  const a = Math.asin((r1 - r2) / u.C), s1 = sheaveS(u, r1), s2 = sheaveS(u, r2), sm = sheaveS(u, rMid(u));
  return {
    x, r1, r2, i: r2 / r1, s1, s2, a,
    L: beltLength(u.C, r1, r2),
    // belt centre plane on each pulley (z), and their offset
    z1: -sm / 2 + s1 / 2, z2: sm / 2 - s2 / 2, mis: (s1 + s2) / 2 - sm,
    // movable sheave travel from its widest place (mm)
    travel1: sheaveS(u, u.R_MIN) - s1, travel2: sheaveS(u, u.R_MIN) - s2,
    wrap1: Math.PI + 2 * a, wrap2: Math.PI - 2 * a,
    strand: u.C * Math.cos(a),
  };
}

// A point at arc length s on the pitch loop: { p, t (travel), n (out),
// on: 1 | 2 | 0 (straight), f: 0..1 along a strand from its start }
export function beltPoint(u, st, s) {
  const { r1, r2, a, strand } = st, c1 = -u.C / 2, c2 = u.C / 2;
  const A1 = r1 * st.wrap1, A2 = r2 * st.wrap2, L = 2 * strand + A1 + A2;
  s = ((s % L) + L) % L;
  const top = Math.PI / 2 - a, sa = Math.sin(a), ca = Math.cos(a);
  if (s < strand) {          // top strand, pulley 2 -> pulley 1
    const f = s / strand, p0 = [c2 + r2 * sa, r2 * ca], p1 = [c1 + r1 * sa, r1 * ca];
    return { p: [p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f], t: [-ca, sa], n: [sa, ca], on: 0, f, strand: 'top' };
  }
  s -= strand;
  if (s < A1) {              // arc on pulley 1, counter-clockwise
    const q = top + s / r1;
    return { p: [c1 + r1 * Math.cos(q), r1 * Math.sin(q)], t: [-Math.sin(q), Math.cos(q)], n: [Math.cos(q), Math.sin(q)], on: 1, f: s / A1 };
  }
  s -= A1;
  if (s < strand) {          // bottom strand, pulley 1 -> pulley 2
    const f = s / strand, p0 = [c1 + r1 * sa, -r1 * ca], p1 = [c2 + r2 * sa, -r2 * ca];
    return { p: [p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f], t: [ca, sa], n: [sa, -ca], on: 0, f, strand: 'bottom' };
  }
  s -= strand;
  const q = -top + s / r2;   // arc on pulley 2, counter-clockwise
  return { p: [c2 + r2 * Math.cos(q), r2 * Math.sin(q)], t: [-Math.sin(q), Math.cos(q)], n: [Math.cos(q), Math.sin(q)], on: 2, f: s / A2 };
}

// element thickness (along the belt) at a depth h below the pitch line
export const elemT = (u, h) => u.T_TOP - (u.T_TOP - u.T_LOW) * Math.min(1, Math.max(0, h / u.DEPTH));

// ── toroidal ────────────────────────────────────────────────────────────────
export function toroState(u, x) {
  x = Math.max(0, Math.min(1, x));
  const g = u.G_MAX * (1 - 2 * x), sg = Math.sin(g), cg = Math.cos(g);
  const rIn = u.E - u.R0 * sg, rOut = u.E + u.R0 * sg, rho = u.R0 - u.FILM;
  return {
    x, g, rIn, rOut, rho, i: rOut / rIn,
    P1: [rIn, -u.R0 * cg], P2: [rOut, u.R0 * cg], n: [cg, -sg],
    // roller spin per input turn, output turn per input turn (backward)
    kRoll: rIn / rho, kOut: -rIn / rOut,
  };
}
// the cavity arc of a disc ends where it meets the flat face at |a| = GAP/2
export const arcEnd = u => Math.asin(u.GAP / 2 / u.R0);
