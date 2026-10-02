// ============================================================================
//  DIFFERENTIAL  ·  diff.js — gear sizes, mesh phases, speeds and torque split
// ────────────────────────────────────────────────────────────────────────────
//  No DOM and no THREE: tests.mjs runs this file in Node. Units are mm for
//  sizes, N·m for torque, rad for angles. The axle lies on x, y is up, the
//  drive pinion comes in from the front along +z.
//
//  FRAMES
//    The carrier turns about +x by phiC. Gears that ride in the carrier
//    (side gears, spiders, helical elements) have their angles in the
//    carrier frame. A gear frame is { N, u, e0 }: u is the gear axis (out of
//    the cone apex for a bevel gear), e0 the direction of tooth 0 at angle 0.
//    Tooth k points along e0 turned by theta + k·2π/N about u (right hand).
//
//  MESH PHASE
//    meshAngle(A, thA, cA, B, cB, k) gives the angle of gear B that puts a
//    gap of B on the contact line when a tooth of A is on it. cA and cB are
//    the directions from each gear's axis to the contact point. k is the
//    speed ratio wB/wA, signed by the rolling condition at the contact.
//    Every gear angle comes from this chain, so the teeth stay in mesh.
//
//  SPEEDS
//    One integrator state: phiC (carrier) and delta (right side gear on the
//    carrier). The left side gear follows through the gears, so the wheel
//    angles are phiC − delta and phiC + delta: (wL + wR)/2 = wC always.
//
//  GREP MAP
//    export const SPEC ......... teeth, modules, road and clutch numbers
//    export const BEV / HEL .... derived cone angles, centres, frames
//    export const spiral ....... the spiral-bevel tooth offset along the face
//    export function meshAngle . the mesh phase rule
//    export function pose ...... every gear angle for (variant, phiC, delta)
//    export function drive ..... wheel speed ratios and the torque split
// ============================================================================
export const D = Math.PI / 180, TAU = Math.PI * 2;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const V = { dot, cross, unit, sub };

export const SPEC = {
  // ha, hf: addendum and dedendum (modules); t: tooth share of the pitch.
  // The small gears get the long addendum and the thick tooth, so no tip of
  // the big gear reaches below the small gear's base circle.
  ring: { N: 41, m: 5.25, F: 32, beta: 32 * D, ha: 0.65, hf: 1.4, t: 0.44 },   // spiral bevel (beta: spiral angle)
  pinion: { N: 11, ha: 1.25, hf: 0.9, t: 0.55 },
  side: { N: 16, m: 5, F: 15, ha: 0.85, hf: 1.25, t: 0.46 },                  // straight bevel side gears
  spider: { N: 10, ha: 1.15, hf: 1.15, t: 0.52 },                             // and spider (planet) gears
  hel: { NS: 18, NP: 9, m: 3, beta: 24 * D, pairs: 3, side: [10, 50], pinA: [-50, 7], pinB: [-7, 50],
    sideT: { ha: 0.7, hf: 1.1, t: 0.48 }, pinT: { ha: 0.8, hf: 1.0, t: 0.48 } },
  road: { tire: 0.32, track: 1.55, load: 4000, muDry: 0.9, muIce: 0.1, Tmove: 300 },
  clutch: { pre: 50, c: 0.35 },                     // friction torque = pre + c · Tc
  torsen: { TBR: 3 },
  TinMax: 400,
};

// ── derived numbers ────────────────────────────────────────────────────────
export const BEV = (() => {
  const r = SPEC.ring, s = SPEC.side, Np = SPEC.pinion.N, Nq = SPEC.spider.N;
  const gR = Math.atan2(r.N, Np), gP = Math.PI / 2 - gR, A = r.m / 2 * Math.hypot(r.N, Np);
  const gS = Math.atan2(s.N, Nq), gQ = Math.PI / 2 - gS, A2 = s.m / 2 * Math.hypot(s.N, Nq);
  const FR = {
    ring: { N: r.N, u: [-1, 0, 0], e0: [0, 1, 0] },
    pinion: { N: Np, u: [0, 0, 1], e0: [1, 0, 0] },
    sideR: { N: s.N, u: [1, 0, 0], e0: [0, 1, 0] },
    sideL: { N: s.N, u: [-1, 0, 0], e0: [0, 1, 0] },
    spiderT: { N: Nq, u: [0, 1, 0], e0: [1, 0, 0] },
    spiderB: { N: Nq, u: [0, -1, 0], e0: [1, 0, 0] },
  };
  const C = {
    rp: [-Math.cos(gR), 0, Math.sin(gR)],
    RT: [Math.cos(gS), Math.sin(gS), 0], LT: [-Math.cos(gS), Math.sin(gS), 0],
    RB: [Math.cos(gS), -Math.sin(gS), 0], LB: [-Math.cos(gS), -Math.sin(gS), 0],
  };
  // spiral: the pinion's offset runs the other way round its own axis
  const sgnP = Math.sign(dot(cross(FR.ring.u, C.rp), cross(FR.pinion.u, C.rp)));
  return { gR, gP, A, gS, gQ, A2, FR, C, sgnP, ratio: r.N / Np };
})();

// spiral(s, gam, sigma): the azimuth offset of a ring or pinion tooth at
// cone distance s. Zero at the heel (s = A), so the mesh phase holds there;
// the same arc offset at the contact for both gears keeps the mesh along
// the face. A small square term curves the tooth like a face-milled spiral.
export const spiral = (s, gam, sigma) => sigma * (Math.tan(SPEC.ring.beta) * (s - BEV.A) + 0.0025 * (s - BEV.A) ** 2) / (s * Math.sin(gam));

export const HEL = (() => {
  const h = SPEC.hel, rS = h.NS * h.m / 2, rP = h.NP * h.m / 2, Rc = rS + rP;
  const dB = 2 * Math.asin(rP / Rc);
  const at = b => [0, Rc * Math.cos(b), Rc * Math.sin(b)];
  const pairs = [];
  for (let i = 0; i < h.pairs; i++) {
    const b = Math.PI / 2 + i * TAU / h.pairs;
    pairs.push({ bA: b - dB / 2, bB: b + dB / 2, cA: at(b - dB / 2), cB: at(b + dB / 2) });
  }
  const side = { N: h.NS, u: [1, 0, 0], e0: [0, 1, 0] }, pin = { N: h.NP, u: [1, 0, 0], e0: [0, 1, 0] };
  // hands: left side +1, A −1, B +1, right side −1 (external pairs are opposite)
  const tw = (sigma, r) => x => sigma * Math.tan(h.beta) * x / r;
  // transverse pressure angle of a 20° normal helical tooth
  const alpha = Math.atan(Math.tan(20 * D) / Math.cos(h.beta));
  return { rS, rP, Rc, dB, pairs, side, pin, alpha, twist: { L: tw(1, rS), A: tw(-1, rP), B: tw(1, rP), R: tw(-1, rS) } };
})();

// ── mesh phase ─────────────────────────────────────────────────────────────
const psi = (g, c) => Math.atan2(dot(cross(g.u, g.e0), c), dot(g.e0, c));
export function rollRatio(A, PA, B, PB) {
  const s = dot(cross(A.u, PA), cross(B.u, PB));
  return Math.sign(s) * A.N / B.N;
}
export function meshAngle(A, thA, cA, B, cB, k) {
  const pA = TAU / A.N, pB = TAU / B.N;
  return k * thA + psi(B, cB) - pB * (0.5 + Math.sign(k) * psi(A, cA) / pA);
}

// precomputed ratios
const KB = (() => {
  const F = BEV.FR, C = BEV.C;
  return {
    rp: rollRatio(F.ring, C.rp, F.pinion, C.rp),
    RT: rollRatio(F.sideR, C.RT, F.spiderT, C.RT), TL: rollRatio(F.spiderT, C.LT, F.sideL, C.LT),
    RB: rollRatio(F.sideR, C.RB, F.spiderB, C.RB),
  };
})();
const KH = (() => {
  const s = HEL.side, p = HEL.pin, c = HEL.pairs[0];
  const ab = sub(c.cB, c.cA);
  return { LA: rollRatio(s, c.cA, p, sub([0, 0, 0], c.cA)), AB: rollRatio(p, ab, p, sub([0, 0, 0], ab)), BR: rollRatio(p, sub([0, 0, 0], c.cB), s, c.cB) };
})();
export const RATIOS = { KB, KH };

// pose(variant, phiC, delta): every gear angle. bevel: ring is fixed in the
// carrier (angle 0 about its own axis), the pinion meshes with it in the
// world frame. helical: three element pairs, each meshed from the left gear.
export function pose(variant, phiC, delta) {
  const F = BEV.FR, C = BEV.C;
  const out = { phiC, delta };
  out.pinion = meshAngle(F.ring, -phiC, C.rp, F.pinion, C.rp, KB.rp);
  if (variant === 'torsen') {
    const s = HEL.side, p = HEL.pin;
    out.sideL = -delta;
    out.A = []; out.B = [];
    let right = 0;
    HEL.pairs.forEach((c, i) => {
      const a = meshAngle(s, out.sideL, unit(c.cA), p, unit(sub([0, 0, 0], c.cA)), KH.LA);
      const d = unit(sub(c.cB, c.cA));
      const b = meshAngle(p, a, d, p, sub([0, 0, 0], d), KH.AB);
      out.A.push(a); out.B.push(b);
      if (i === 0) right = meshAngle(p, b, unit(sub([0, 0, 0], c.cB)), s, unit(c.cB), KH.BR);
    });
    out.sideR = right;
    out.wheelL = phiC + out.sideL; out.wheelR = phiC + out.sideR;
  } else {
    out.sideR = delta;
    out.spiderT = meshAngle(F.sideR, delta, C.RT, F.spiderT, C.RT, KB.RT);
    out.spiderB = meshAngle(F.sideR, delta, C.RB, F.spiderB, C.RB, KB.RB);
    out.sideL = meshAngle(F.spiderT, out.spiderT, C.LT, F.sideL, C.LT, KB.TL);   // about −x
    out.wheelL = phiC - out.sideL; out.wheelR = phiC + out.sideR;
  }
  return out;
}

// ── speeds and torque ──────────────────────────────────────────────────────
// drive(variant, scen, o): o = { Tin (N·m into the pinion), R (turn radius,
// m), dir (+1 left turn, −1 right turn) }. Speeds are ratios to the base
// speed w0: the carrier for a driven car, the right wheel on the lift.
// kC = (kL + kR)/2 in every case. Torques are at the axle (N·m).
export const SCEN = {
  straight: { name: 'Straight ahead', short: 'Straight' },
  corner: { name: 'Cornering', short: 'Corner' },
  ice: { name: 'Right wheel on ice', short: 'Ice' },
  lift: { name: 'On a lift, turn a wheel', short: 'Lift' },
};
export const VARIANTS = [
  { id: 'open', name: 'Open', kind: 'Spiral bevel · 2 spiders' },
  { id: 'clutch', name: 'Clutch LSD', kind: 'Plate clutches · preload' },
  { id: 'torsen', name: 'Torsen', kind: 'Helical · type 2' },
];
export function grip(mu) { const r = SPEC.road; return mu * r.load * r.tire; }
export function friction(variant, Tc) {
  if (variant === 'clutch') return SPEC.clutch.pre + SPEC.clutch.c * Math.max(0, Tc);
  return 0;
}
export function bias(variant, Tc) {
  // the largest torque ratio slow : fast wheel the unit can hold
  if (variant === 'open') return 1;
  if (variant === 'torsen') return SPEC.torsen.TBR;
  const Tf = friction(variant, Tc);
  return Tc > Tf ? (Tc + Tf) / (Tc - Tf) : Infinity;
}
export function drive(variant, scen, o) {
  const r = SPEC.road, Tc = (o.Tin || 0) * BEV.ratio;
  const out = { Tc, kL: 1, kR: 1, TL: Tc / 2, TR: Tc / 2, moving: true, slip: false, stall: false, note: '', hand: 0 };
  if (scen === 'lift') {
    Object.assign(out, { kL: -1, kR: 1, TL: 0, TR: 0, Tc: 0, moving: false });
    out.hand = variant === 'clutch' ? SPEC.clutch.pre : variant === 'torsen' ? 6 : 2;
    out.note = variant === 'open' ? 'The carrier stays still. One wheel turns forward, the other backward at the same speed.'
      : variant === 'clutch' ? `The preload springs hold the clutches: it takes about ${out.hand} N·m to turn the wheels against each other.`
      : 'With no load the helical gears turn freely: the bias needs torque to work on.';
    return out;
  }
  if (scen === 'corner') {
    const R = Math.max(3, o.R || 12), q = r.track / (2 * R), dir = o.dir || 1;
    const kIn = 1 - q, kOut = 1 + q;
    out.kL = dir > 0 ? kIn : kOut; out.kR = dir > 0 ? kOut : kIn;
    let Tin_ = Tc / 2, Tout = Tc / 2;
    if (variant === 'clutch') { const Tf = friction(variant, Tc); Tin_ = (Tc + Tf) / 2; Tout = (Tc - Tf) / 2; }
    if (variant === 'torsen' && Tc > 0) { const B = SPEC.torsen.TBR; Tin_ = Tc * B / (1 + B); Tout = Tc / (1 + B); }
    if (dir > 0) { out.TL = Tin_; out.TR = Tout; } else { out.TR = Tin_; out.TL = Tout; }
    out.note = variant === 'open' ? 'Equal torque to both wheels, while the outer wheel turns faster.'
      : 'The slower inner wheel gets more torque: the unit resists the speed difference.';
    return out;
  }
  if (scen === 'ice') {
    const Li = grip(r.muIce), Ld = grip(r.muDry), Tm = r.Tmove;
    let cap;
    if (variant === 'open') cap = 2 * Li;
    else if (variant === 'clutch') cap = Li + Math.min(Ld, Li + friction(variant, Tc));
    else cap = Li + Math.min(Ld, SPEC.torsen.TBR * Li);
    if (Tc <= cap) {
      out.TR = Math.min(Tc / 2, Li); out.TL = Tc - out.TR;
      if (Tc < Tm) { Object.assign(out, { kL: 0, kR: 0, moving: false, stall: true }); out.note = `${Tc.toFixed(0)} N·m is less than the ${Tm} N·m that moves the car: it does not move.`; }
      else out.note = variant === 'open' ? 'Light throttle: neither wheel slips yet.' : 'The unit holds: both wheels turn together and the car moves.';
      return out;
    }
    out.slip = true;
    out.TR = Li; out.TL = cap - Li;
    const total = cap;
    if (total < Tm) { out.kL = 0; out.kR = 2; out.moving = false; out.note = `The ice wheel spins at twice the carrier speed. The dry wheel gets the same ${Li.toFixed(0)} N·m and stands still.`; }
    else { out.kL = 0.5; out.kR = 1.5; out.note = `The ice wheel slips, but the dry wheel gets ${out.TL.toFixed(0)} N·m and the car moves.`; }
    return out;
  }
  out.note = 'Both wheels turn at the carrier speed, with equal torque.';
  return out;
}
