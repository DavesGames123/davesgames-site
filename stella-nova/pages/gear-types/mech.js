// ============================================================================
//  GEAR TYPES  ·  mech.js — mesh geometry, contact and forces (no DOM)
// ----------------------------------------------------------------------------
//  No DOM and no THREE: tests.mjs runs this file in Node. Units are mm, N,
//  N·m and rad. Five gear pairs, each with a driver (gear 1) and a driven
//  member (gear 2):
//    spur ...... parallel shafts, straight involute teeth, 18 : 30
//    helical ... the same pair with a 20 deg helix: more teeth in contact,
//                and an axial thrust Fa = Ft tan(beta)
//    bevel ..... shafts at 90 deg, 16 : 32. The pitch cones share one apex:
//                tan(gamma1) = sin(S) / (N2/N1 + cos(S))
//    worm ...... one-start worm on a 30-tooth wheel. Lead angle lambda,
//                friction angle phi' = atan(mu / cos(alpha_n)). The wheel
//                cannot drive the worm when lambda <= phi' (self-locking)
//    rack ...... pinion on a rack: rack speed v = omega * r. The pinion
//                swings to and fro (a steering rack), so the rack stays on
//                its guide
//
//  THE TEST PLANE. Each pair has a transverse plane (the bevel: the back
//  cone, Tredgold's virtual gears; the worm: the mid-plane of the wheel).
//  plane(D) puts the pair in it: gear 1 centre, gear 2 centre (or a rack
//  pitch line), the pitch point P and the line of action P + s d. d is the
//  direction of the push on the driven member. Contact runs along +d from
//  sMin (approach) to sMax (recess). The contact ratio is
//      eps_alpha = (sMax - sMin) / p_b         p_b = pi m cos(alpha_t)
//
//  PHASE. arc is the pitch-line travel of the driver in its running sense.
//  Teeth are 0.48 p thick (t = 0.48), so the driving flank of a driver
//  tooth sits 0.24 p ahead of the tooth centre, and the contact of pair k
//  is at s_k = cos(alpha_t) (arc + 0.24 p + k p). The driven member keeps
//  0.02 p of backlash at each flank. tests.mjs checks the s_k points on the
//  real tooth outlines (teeth.js).
//
//  GREP MAP
//    export const UNITS ......... the five pairs and their numbers
//    export function derive ..... radii, pitches, contact ratio, forces
//    export function plane ...... the test plane and the line of action
//    export function pose ....... part angles and travel at input angle th
//    export function contacts ... s of each tooth pair in contact
//    export function pairsIn .... pairs in contact (helical: over the face)
//    export function helixNormal  the tooth normal of the helical flank
//    export function wormEff .... worm efficiency both ways
// ============================================================================

export const TAU = Math.PI * 2;
export const D2R = Math.PI / 180;
export const T_IN = 20;          // input torque for the force numbers, N·m
export const T_TH = 0.48;        // tooth thickness, share of the pitch
const inv = a => Math.tan(a) - a;

export const UNITS = [
  { id: 'spur', name: 'Spur', kind: 'Parallel shafts · straight teeth', N1: 18, N2: 30, m: 4, alpha: 20 * D2R, b: 24 },
  { id: 'helical', name: 'Helical', kind: 'Parallel shafts · 20° helix', N1: 18, N2: 30, m: 4, alpha: 20 * D2R, beta: 20 * D2R, b: 30 },
  { id: 'bevel', name: 'Bevel', kind: 'Shafts at 90° · pitch cones', N1: 16, N2: 32, m: 4, alpha: 20 * D2R, F: 20, sigma: 90 * D2R },
  { id: 'worm', name: 'Worm', kind: 'Crossed shafts · 30 : 1', z1: 1, N2: 30, m: 4, q: 10, alpha: 20 * D2R, mu: 0.10, b: 24 },
  { id: 'rack', name: 'Rack & pinion', kind: 'Turn to slide · v = ω r', N1: 20, m: 4, alpha: 20 * D2R, b: 24, swing: 0.9 * Math.PI, slow: 3 },
];
export const unit = id => UNITS.find(u => u.id === id);

// worm efficiency, worm driving (fwd) and wheel driving (back). back <= 0
// means the wheel cannot turn the worm: self-locking.
export function wormEff(lambda, mu, an) {
  const c = Math.cos(an), t = Math.tan(lambda);
  return { fwd: (c - mu * t) / (c + mu / t), back: (c - mu / t) / (c + mu * t) };
}

// the second root of |P + s d - C| = R (the larger s when hi)
function circleHit(P, d, C, R, hi) {
  const fx = P[0] - C[0], fy = P[1] - C[1], b = fx * d[0] + fy * d[1], c = fx * fx + fy * fy - R * R, q = Math.sqrt(b * b - c);
  return hi ? -b + q : -b - q;
}

export function derive(u) {
  const D = { id: u.id, m: u.m };
  if (u.id === 'spur' || u.id === 'helical') {
    const beta = u.beta || 0, mt = u.m / Math.cos(beta), at = Math.atan(Math.tan(u.alpha) / Math.cos(beta));
    Object.assign(D, { beta, mt, at, N1: u.N1, N2: u.N2, b: u.b, r1: u.N1 * mt / 2, r2: u.N2 * mt / 2, ha: u.m, hf: 1.25 * u.m });
    D.betaB = Math.atan(Math.tan(beta) * Math.cos(at));
    D.ratio = u.N2 / u.N1;
    D.epsB = u.b * Math.sin(beta) / (Math.PI * u.m);
    D.Ft = T_IN * 1000 / D.r1; D.Fr = D.Ft * Math.tan(at); D.Fa = D.Ft * Math.tan(beta);
  } else if (u.id === 'bevel') {
    const g1 = Math.atan2(Math.sin(u.sigma), u.N2 / u.N1 + Math.cos(u.sigma)), g2 = u.sigma - g1;
    const r1 = u.N1 * u.m / 2, r2 = u.N2 * u.m / 2;
    // the virtual (Tredgold) gears on the back cone, at the heel
    Object.assign(D, { g1, g2, mt: u.m, at: u.alpha, beta: 0, N1: u.N1, N2: u.N2, R1: r1, R2: r2, A: r1 / Math.sin(g1), F: u.F, ha: u.m, hf: 1.25 * u.m });
    D.r1 = r1 / Math.cos(g1); D.r2 = r2 / Math.cos(g2); D.Nv1 = u.N1 / Math.cos(g1); D.Nv2 = u.N2 / Math.cos(g2);
    D.ratio = u.N2 / u.N1; D.epsB = 0;
    D.rm1 = r1 * (1 - 0.5 * u.F / D.A);
    D.Ft = T_IN * 1000 / D.rm1;
    D.Fa1 = D.Ft * Math.tan(u.alpha) * Math.sin(g1); D.Fr1 = D.Ft * Math.tan(u.alpha) * Math.cos(g1);
    D.Fa2 = D.Ft * Math.tan(u.alpha) * Math.sin(g2); D.Fr2 = D.Ft * Math.tan(u.alpha) * Math.cos(g2);
  } else if (u.id === 'worm') {
    const r1 = u.q * u.m / 2, L = u.z1 * Math.PI * u.m, lambda = Math.atan(L / (TAU * r1));
    // the axial section of the worm is a rack; its flank angle is alpha_x
    const at = Math.atan(Math.tan(u.alpha) / Math.cos(lambda));
    Object.assign(D, { r1, r2: u.N2 * u.m / 2, L, lambda, at, mt: u.m, beta: lambda, N2: u.N2, z1: u.z1, b: u.b, ha: u.m, hf: 1.25 * u.m });
    D.phiF = Math.atan(u.mu / Math.cos(u.alpha));
    D.eff = wormEff(lambda, u.mu, u.alpha);
    D.selfLock = Math.tan(lambda) <= u.mu / Math.cos(u.alpha);
    D.ratio = u.N2 / u.z1; D.epsB = 0; D.mu = u.mu;
  } else {
    Object.assign(D, { r1: u.N1 * u.m / 2, at: u.alpha, mt: u.m, beta: 0, N1: u.N1, b: u.b, ha: u.m, hf: 1.25 * u.m, ratio: 1, epsB: 0 });
    D.swing = u.swing; D.slow = u.slow;
  }
  D.p = Math.PI * D.mt; D.pb = D.p * Math.cos(D.at);
  const L = plane(D);
  D.sMin = L.sMin; D.sMax = L.sMax;
  D.epsA = (D.sMax - D.sMin) / D.pb;
  D.eps = D.epsA + D.epsB;
  return D;
}

// The test plane. gear 1 (the driver) at the origin; gear 2 at (a, 0), or
// a rack. Worm: the thread is a rack (pitch line y = 0) and the wheel sits
// at (0, r2). dir < 0: the drive runs backward and the line of action is
// mirrored across the line of centres.
export function plane(D, dir = 1) {
  const c = Math.cos(D.at), s = Math.sin(D.at);
  let o;
  if (D.id === 'rack') {
    const P = [0, -D.r1];
    o = { kind: 'rack', P, d: [c, -s], t: [1, 0], C1: [0, 0], C2: null, pitchY: -D.r1 };
    o.sMin = -D.ha / s; o.sMax = circleHit(P, o.d, [0, 0], D.r1 + D.ha, true);
  } else if (D.id === 'worm') {
    const P = [0, 0];
    o = { kind: 'worm', P, d: [-c, s], t: [-1, 0], C1: null, C2: [0, D.r2], pitchY: 0 };
    o.sMin = circleHit(P, o.d, o.C2, D.r2 + D.ha, false); o.sMax = D.ha / s;
  } else {
    const P = [D.r1, 0];
    o = { kind: 'gears', P, d: [s, c], t: [0, 1], C1: [0, 0], C2: [D.r1 + D.r2, 0] };
    o.sMin = circleHit(P, o.d, o.C2, D.r2 + D.ha, false); o.sMax = circleHit(P, o.d, o.C1, D.r1 + D.ha, true);
  }
  if (dir < 0) { const k = o.d[0] * o.t[0] + o.d[1] * o.t[1]; o.d = [o.d[0] - 2 * k * o.t[0], o.d[1] - 2 * k * o.t[1]]; }
  return o;
}

// Part angles at the input angle th. a1, a2: gear 1 and gear 2 spins (the
// kit spin about each part axis); x: rack or worm axial travel; arc: the
// driver's pitch-line travel; dir: the running sense; w: d(arc)/d(th) / r1
// (the driver turn per unit th, so omega = w * input omega).
export function pose(D, th) {
  if (D.id === 'rack') {
    const psi = D.swing * Math.sin(th / D.slow), w = D.swing / D.slow * Math.cos(th / D.slow);
    return { th, a1: psi, a2: 0, x: D.r1 * psi, arc: D.r1 * psi, dir: w >= 0 ? 1 : -1, w };
  }
  if (D.id === 'worm') {
    const x = D.L * th / TAU;
    return { th, a1: th, a2: -x / D.r2 + Math.PI / D.N2, x: -x, arc: x, dir: 1, w: 1 };
  }
  // spur, helical, bevel: tooth 0 of gear 1 on the contact at th = 0, a gap
  // of gear 2 on it (half a pitch on)
  return { th, a1: th, a2: -th * D.N1 / D.N2 + Math.PI / D.N2, x: 0, arc: D.R1 ? D.R1 * th : D.r1 * th, dir: 1, w: 1 };
}

// s of each tooth pair in contact, at driver travel arc (dir: the sense)
export function contacts(D, arc, dir = 1) {
  const c = Math.cos(D.at), s0 = c * (dir * arc + T_TH / 2 * D.p), out = [];
  for (let k = Math.ceil((D.sMin - s0) / D.pb); s0 + k * D.pb <= D.sMax + 1e-9; k++) out.push(s0 + k * D.pb);
  return out;
}

// Tooth pairs in contact. Helical: the face is cut in n slices; slice z
// sees the driver turned by z tan(beta) / r1, so the count is the mean.
export function pairsIn(D, arc, dir = 1, n = 48) {
  if (!D.beta || D.id === 'worm') return contacts(D, arc, dir).length;
  let sum = 0;
  for (let i = 0; i < n; i++) { const z = D.b * ((i + 0.5) / n - 0.5); sum += contacts(D, arc + z * Math.tan(D.beta), dir).length; }
  return sum / n;
}

// The 3D tooth surface of the helical driver near the pitch point: the
// leading involute flank, turned by z tan(beta) / r1 at axial place z (the
// twist rule scene.js gives the teeth). Returns the unit normal at the pitch
// point as [radial, tangential, axial] (x, y, z of the test plane, gear 1 at
// the origin, the flank point on +x). The push on gear 2 is along it.
export function helixNormal(D) {
  const rb = D.r1 * Math.cos(D.at), tp = T_TH * Math.PI / D.N1, k = Math.tan(D.beta) / D.r1;
  const half = r => tp + inv(D.at) - inv(Math.acos(rb / r));
  const th0 = -half(D.r1);
  const X = (r, z) => { const f = th0 + half(r) + k * z; return [r * Math.cos(f), r * Math.sin(f), z]; };
  const e = 1e-4, a = X(D.r1 + e, 0), b = X(D.r1 - e, 0), c = X(D.r1, e), d = X(D.r1, -e);
  const dr = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dz = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
  let n = [dr[1] * dz[2] - dr[2] * dz[1], dr[2] * dz[0] - dr[0] * dz[2], dr[0] * dz[1] - dr[1] * dz[0]];
  if (n[1] < 0) n = n.map(v => -v);   // out of the leading flank: ahead
  const l = Math.hypot(...n);
  return n.map(v => v / l);
}
