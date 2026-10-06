// ============================================================================
//  GENEVA DRIVE & CAMS  ·  mech.js — outlines and motion laws (no DOM)
// ----------------------------------------------------------------------------
//  No DOM and no THREE: tests.mjs runs this file in Node. Units are mm and
//  rad. All outlines are 2D in the plane of motion (X, Y), with angles
//  counter-clockwise. scene.js extrudes them up local y; kit.js maps the
//  outline plane (x, -z) so that a positive spin about +y is CCW here.
//
//  GENEVA DRIVE (external, n slots, centre distance a)
//    The star wheel turns about the origin, the driver about C1 = (a, 0).
//    The pin rides at r = a sin(pi/n) on the driver. It enters a slot at
//    a right angle to the line of centres, so it meets the slot along its
//    axis with no shock:
//      engaged while |theta - pi| <= alpha0 = pi/2 - pi/n
//    In that time the slot follows the pin, so the star turns by 2 pi/n.
//    For the rest of the turn the locking disc on the driver sits in a
//    concave arc of the star and holds it still (the dwell).
//    Output angle in the engaged part, with u = theta - pi:
//      tan(slot) = r sin(-u) / (a - r cos u)   ... from P - O
//    star(theta) is that slot angle relative to its start, minus 2 pi/n
//    for each finished step.
//
//  DISC CAM, TRANSLATING ROLLER FOLLOWER
//    The follower slides on +X; its roller centre is at R(theta) =
//    Rb + Rr + s(theta). Program: rise h over B1, dwell, return over B2,
//    dwell, with cycloidal laws (zero velocity and acceleration at both
//    ends):  s = h (x - sin(2 pi x) / (2 pi)),  x = phase / B
//    The cam turns CCW by theta, so the follower sees cam angle -theta.
//    Pitch curve (cam frame): p(phi) = R(phi) (cos -phi, sin -phi) ... the
//    profile is the pitch curve moved in by Rr along its normal.
//    Pressure angle: tan(phi_p) = (ds/dtheta) / R.
//
//  GREP MAP
//    export const UNITS ......... the three units and their numbers
//    export function geneva ..... radii and the star and lock outlines
//    export function genevaPose . star angle and phase for a driver angle
//    export function camLaw ..... s, ds, d2s at a cam angle
//    export function camProfile . the cam outline from the pitch curve
//    export function camPose .... follower travel and pressure angle
// ============================================================================

export const TAU = Math.PI * 2;

export const UNITS = [
  { id: 'geneva4', name: 'Geneva, 4 slots', kind: 'Intermittent drive · 90° per step', n: 4, a: 120, pinR: 6, clr: 1 },
  { id: 'geneva6', name: 'Geneva, 6 slots', kind: 'Intermittent drive · 60° per step', n: 6, a: 120, pinR: 6, clr: 1 },
  { id: 'cam', name: 'Disc cam', kind: 'Rise · dwell · return · dwell', Rb: 46, Rr: 12, h: 38, B1: 120, D1: 60, B2: 120, D2: 60 },
];
export const unit = id => UNITS.find(u => u.id === id);

const arc = (cx, cy, R, a0, a1, n) => { const p = []; for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * i / n; p.push([cx + R * Math.cos(t), cy + R * Math.sin(t)]); } return p; };
const wrap = x => { x %= TAU; return x < 0 ? x + TAU : x; };

// ── Geneva ──────────────────────────────────────────────────────────────────
export function geneva(u) {
  const { n, a, pinR, clr } = u;
  const r = a * Math.sin(Math.PI / n);            // pin radius on the driver
  const R2 = a * Math.cos(Math.PI / n);           // star tip radius
  const alpha0 = Math.PI / 2 - Math.PI / n;       // half the engaged driver angle
  const w = pinR + clr;                           // slot half width
  const rb = a - r - clr;                         // slot bottom (semicircle centre)
  // locking disc: as large as the slot walls allow (the concave arc must end
  // on the rim before the slot starts), less a margin
  const sw = Math.asin(w / R2);
  const dMax = Math.PI / n - sw - 0.06;
  // concave arc radius rho meets the rim at angle dMax from its centre
  const rho = Math.sqrt(a * a + R2 * R2 - 2 * a * R2 * Math.cos(dMax));
  const Rl = rho - clr;
  const d = Math.acos((a * a + R2 * R2 - rho * rho) / (2 * a * R2));

  // the star outline, CCW, in the star frame (slot j on pi/n + 2 pi j/n,
  // concave arc j centred at angle 2 pi j/n, distance a)
  const star = [];
  for (let j = 0; j < n; j++) {
    const g = TAU * j / n, cx = a * Math.cos(g), cy = a * Math.sin(g);
    // concave arc: from the rim point at g - d to the one at g + d, round
    // the side of Cj that faces the origin
    const e0 = Math.atan2(R2 * Math.sin(g - d) - cy, R2 * Math.cos(g - d) - cx);
    let e1 = Math.atan2(R2 * Math.sin(g + d) - cy, R2 * Math.cos(g + d) - cx);
    while (e1 > e0) e1 -= TAU;                    // clockwise about Cj
    star.push(...arc(cx, cy, rho, e0, e1, 24));
    // rim to the slot
    const s = g + Math.PI / n;
    star.push(...arc(0, 0, R2, g + d, s - sw, 10).slice(1));
    // slot: in on the lower wall, round the bottom, out on the upper wall
    const ux = Math.cos(s), uy = Math.sin(s), px = -uy, py = ux;
    const bx = rb * ux, by = rb * uy, rIn = Math.sqrt(R2 * R2 - w * w);
    star.push([rIn * ux - w * px, rIn * uy - w * py], [bx - w * px, by - w * py]);
    star.push(...arc(bx, by, w, s - Math.PI / 2, s - 3 * Math.PI / 2, 12).slice(1, -1));
    star.push([bx + w * px, by + w * py], [rIn * ux + w * px, rIn * uy + w * py]);
    star.push(...arc(0, 0, R2, s + sw, g + TAU / n - d, 10).slice(1, -1));
  }
  // the locking disc in the driver frame (pin on local angle 0): a circle
  // of radius Rl with a relief where the star tips pass during the step,
  // a circle about (a, 0) (the star centre when the pin points at it)
  const relR = R2 + 2 * clr;
  const ca = (a * a + Rl * Rl - relR * relR) / (2 * a * Rl);
  const k = Math.acos(Math.max(-1, Math.min(1, ca)));
  const lock = arc(0, 0, Rl, k, TAU - k, 72);
  const f0 = Math.atan2(Rl * Math.sin(-k), Rl * Math.cos(-k) - a);
  let f1 = Math.atan2(Rl * Math.sin(k), Rl * Math.cos(k) - a);
  while (f1 > f0) f1 -= TAU;
  lock.push(...arc(a, 0, relR, f0 + TAU, f1 + TAU, 24).slice(1, -1));
  return { n, a, r, R2, alpha0, w, rb, rho, Rl, relR, d, sw, pinR, star, lock, stepAngle: TAU / n, dwell: 1 - 2 * alpha0 / TAU };
}

// theta: driver angle (pin direction, world, CCW from +X). The driver turns
// CCW. Returns { psi: star angle (unwrapped), engaged, step, frac, omega }
// with omega = dpsi/dtheta.
export function genevaPose(G, theta) {
  const tau = theta - (Math.PI - G.alpha0);
  const k = Math.floor(tau / TAU), f = tau - k * TAU;
  if (f <= 2 * G.alpha0) {
    const u = f - G.alpha0;                       // driver angle from the line of centres
    const px = G.a + G.r * Math.cos(Math.PI + u), py = G.r * Math.sin(Math.PI + u);
    const sl = Math.atan2(py, px);                // slot axis, world
    const psi = -TAU * k / G.n + (sl - Math.PI / G.n);
    const lam = G.r / G.a, cu = Math.cos(u);
    const omega = -lam * (cu - lam) / (1 - 2 * lam * cu + lam * lam);
    return { psi, engaged: true, step: k, frac: f / (2 * G.alpha0), omega, pin: [px, py] };
  }
  return { psi: -TAU * (k + 1) / G.n, engaged: false, step: k, frac: 1, omega: 0, pin: [G.a + G.r * Math.cos(theta), G.r * Math.sin(theta)] };
}

// ── cam ─────────────────────────────────────────────────────────────────────
// s, ds/dtheta, d2s/dtheta2 at cam angle phi (the angle the follower sees)
export function camLaw(c, phi) {
  const D = Math.PI / 180, B1 = c.B1 * D, D1 = c.D1 * D, B2 = c.B2 * D;
  const x = wrap(phi);
  const cyc = (t, B) => [t - Math.sin(TAU * t) / TAU, (1 - Math.cos(TAU * t)) / B, TAU * Math.sin(TAU * t) / (B * B)];
  if (x < B1) { const [s, v, a] = cyc(x / B1, B1); return { s: c.h * s, v: c.h * v, a: c.h * a, seg: 'rise' }; }
  if (x < B1 + D1) return { s: c.h, v: 0, a: 0, seg: 'dwell high' };
  if (x < B1 + D1 + B2) { const [s, v, a] = cyc((x - B1 - D1) / B2, B2); return { s: c.h * (1 - s), v: -c.h * v, a: -c.h * a, seg: 'return' }; }
  return { s: 0, v: 0, a: 0, seg: 'dwell low' };
}

// The cam outline in the cam frame, CCW (N points). The follower stands on
// +X, so the point that touches it at cam turn theta is at cam-frame angle
// -theta; the outline is the pitch curve moved in by Rr along its normal.
export function camProfile(c, N = 360) {
  const pitch = i => { const ph = TAU * i / N, R = c.Rb + c.Rr + camLaw(c, ph).s; return [R * Math.cos(-ph), R * Math.sin(-ph)]; };
  const out = [];
  for (let i = N; i > 0; i--) {                    // -phi from 0 to 2 pi: CCW in the cam frame
    const p = pitch(i), q0 = pitch(i + 1), q1 = pitch(i - 1);
    let tx = q1[0] - q0[0], ty = q1[1] - q0[1]; const l = Math.hypot(tx, ty); tx /= l; ty /= l;
    // CCW tangent: the outward normal is (ty, -tx)
    out.push([p[0] - c.Rr * ty, p[1] + c.Rr * tx]);
  }
  return out;
}

export function camPose(c, theta) {
  const L = camLaw(c, theta), R = c.Rb + c.Rr + L.s;
  return { ...L, x: R, press: Math.atan2(L.v, R) };
}
