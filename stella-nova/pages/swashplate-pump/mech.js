// ============================================================================
//  SWASHPLATE PISTON PUMP  ·  mech.js — piston strokes, flow and ports (no DOM)
// ----------------------------------------------------------------------------
//  No DOM and no THREE: tests.mjs runs this file in Node. Units are mm, rad
//  and mm^3. The shaft lies on world +x. The barrel turns about +x by the
//  barrel angle th; piston i sits at phi_i = th + 2 pi i / N, at
//  (y, z) = Rp (cos phi, sin phi).
//
//  SWASHPLATE
//    The plate turns about the world z axis by the swash angle b. Its face
//    passes through the origin, with the normal n = (cos b, sin b, 0). The
//    slipper holds the piston ball at a height hs above the face, so the
//    ball centre lies on n . p = hs:
//      x_ball(phi) = (hs - Rp cos(phi) sin b) / cos b
//    The piston goes into its bore by
//      s(phi) = x_ball(phi) - x_ball(0) = Rp tan b (1 - cos phi)
//    so the stroke is 2 Rp tan b, and zero at b = 0.
//
//  FLOW (no leaks, no oil compression)
//    A piston delivers while ds/dphi = Rp tan b sin phi > 0 (0 < phi < pi).
//    Flow per unit shaft speed: q(th) = A Rp tan b * sum of sin phi_i over
//    the pistons with sin phi_i > 0. The mean is V / (2 pi), with the
//    displacement V = N A 2 Rp tan b. The ripple (q_max - q_min) / q_mean
//    is (pi / 2N) tan(pi / 4N) for odd N (2N pulses per turn) and
//    (pi / N) tan(pi / 2N) for even N (N pulses per turn). Odd N wins.
//
//  VALVE PLATE
//    Two kidneys at radius Rp: delivery from bh to pi - bh, suction from
//    pi + bh to 2 pi - bh, with round ends of radius kw. Each barrel port
//    is a kidney of half angle pa with round ends of radius pw. The
//    bridges are wider than a port, so no cylinder opens to both kidneys.
//
//  SLIPPERS AND RETAINER (plate frame: e1 = (-sin b, cos b, 0), e2 = z)
//    A slipper centre is the ball centre less hs n. Its plate coordinates
//    are (-hs tan b + Rp cos(phi) / cos b, Rp sin phi): an ellipse. The
//    retainer is a rigid ring that turns with the barrel, so its holes are
//    at a mean radius Rr with a clearance for the ellipse.
//
//  GREP MAP
//    export const UNITS ......... the three pumps and their numbers
//    export const LAYOUT ........ scene x stations that tests.mjs checks
//    export function xBall ...... the ball centre on x
//    export function pumpPose ... every piston, the flow, the port state
//    export function flowCurve .. q(th) over one turn
//    export function ripple ..... measured ripple and the closed form
//    export function kidney ..... a kidney outline (valve plate, ports)
//    export function slipperAt .. a slipper centre in the plate frame
// ============================================================================

export const TAU = Math.PI * 2;
export const D = Math.PI / 180;

const COMMON = {
  Rp: 40, d: 16, hs: 14, bMax: 18 * D, b0: 15 * D,
  pa: 4 * D, pw: 5, bh: 21 * D, kw: 6,
  neck: 4.5, hole: 6.5, flange: 11, p: 200,
};
export const UNITS = [
  { id: 'p9', name: '9 pistons', kind: 'Odd count · 18 pulses a turn', N: 9, ...COMMON },
  { id: 'p7', name: '7 pistons', kind: 'Odd count · 14 pulses a turn', N: 7, ...COMMON },
  { id: 'p8', name: '8 pistons', kind: 'Even count · 8 pulses a turn', N: 8, ...COMMON },
];
export const unit = id => UNITS.find(u => u.id === id);

// The scene layout on x (mm) that tests.mjs checks: the barrel face, the
// bore bottom (the front of the port section), the piston body from the
// ball centre, the valve plate and the plate radius.
export const LAYOUT = {
  barrel0: 36, boreEnd: 99.6, barrel1: 110, barrelR: 58, boreR: 8.3,
  pist0: 6, pist1: 70, valve0: 110.4, valve1: 118, plateR: 66, cupTop: 2.5,
};

export const area = u => Math.PI * u.d * u.d / 4;
export const wrap = x => { x %= TAU; return x < 0 ? x + TAU : x; };
// the retainer hole circle: the mean of the slipper ellipse at b = 0 and bMax
export const retainerR = u => u.Rp * (1 + 1 / Math.cos(u.bMax)) / 2;

export const xBall = (u, phi, b) => (u.hs - u.Rp * Math.cos(phi) * Math.sin(b)) / Math.cos(b);
export const stroke = (u, b) => 2 * u.Rp * Math.tan(b);
export const displacement = (u, b) => u.N * area(u) * stroke(u, b);    // mm^3 per turn

// which kidney a barrel port at phi opens to: 'delivery', 'suction' or
// 'bridge' (closed). The port spans phi +- (pa + asin(pw/Rp)); a kidney
// opens from bh - asin(kw/Rp).
export function portState(u, phi) {
  const f = wrap(phi), pe = u.pa + Math.asin(u.pw / u.Rp), ke = u.bh - Math.asin(u.kw / u.Rp);
  const open = (lo, hi) => f + pe > lo && f - pe < hi;
  // pe < ke, so a port near 0 or 2 pi cannot reach past the wrap
  const del = open(ke, Math.PI - ke), suc = open(Math.PI + ke, TAU - ke);
  return del && suc ? 'both' : del ? 'delivery' : suc ? 'suction' : 'bridge';
}

// th: barrel angle, b: swash angle. q is the flow per rad of shaft turn
// (mm^3/rad): multiply by omega (rad/s) for mm^3/s.
export function pumpPose(u, th, b = u.b0) {
  const A = area(u), k = u.Rp * Math.tan(b), x0 = xBall(u, 0, b);
  const pistons = [];
  let q = 0, nDel = 0;
  for (let i = 0; i < u.N; i++) {
    const phi = th + TAU * i / u.N, x = xBall(u, phi, b), v = k * Math.sin(phi);
    if (v > 0) { q += A * v; nDel++; }
    pistons.push({ i, phi, x, s: x - x0, v, port: portState(u, phi) });
  }
  return { th, b, pistons, q, nDel, qMean: displacement(u, b) / TAU, stroke: stroke(u, b) };
}

export function flowCurve(u, b = u.b0, n = 720) {
  const out = [];
  for (let j = 0; j <= n; j++) out.push(pumpPose(u, TAU * j / n, b).q);
  return out;
}

// measured (q_max - q_min) / q_mean and the closed form
export function ripple(u, b = u.b0, n = 7200) {
  const q = flowCurve(u, b, n), mean = displacement(u, b) / TAU;
  const N = u.N, theory = N % 2 ? Math.PI / (2 * N) * Math.tan(Math.PI / (4 * N)) : Math.PI / N * Math.tan(Math.PI / (2 * N));
  return { measured: (Math.max(...q) - Math.min(...q)) / mean, theory, pulses: N % 2 ? 2 * N : N, qMax: Math.max(...q), qMin: Math.min(...q), mean };
}

// a kidney outline, CCW: centre-line arc at radius R from a0 to a1, half
// width w, round ends. Points [x, y] with angles CCW from +x.
export function kidney(R, a0, a1, w, seg = 32) {
  const pts = [], arc = (cx, cy, r, s0, s1, m) => { for (let i = 0; i <= m; i++) { const t = s0 + (s1 - s0) * i / m; pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); } };
  arc(0, 0, R + w, a0, a1, seg);
  arc(R * Math.cos(a1), R * Math.sin(a1), w, a1, a1 + Math.PI, 10);
  arc(0, 0, R - w, a1, a0, seg);
  arc(R * Math.cos(a0), R * Math.sin(a0), w, a0 + Math.PI, a0 + TAU, 10);
  // the arcs share their end points: drop the repeats
  return pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-6);
}

// slipper centre in the plate frame (e1, e2), and the retainer hole for it
export function slipperAt(u, phi, b) {
  return [-u.hs * Math.tan(b) + u.Rp * Math.cos(phi) / Math.cos(b), u.Rp * Math.sin(phi)];
}
export function retainerHole(u, phi, b) {
  const R = retainerR(u);
  return [-u.hs * Math.tan(b) + R * Math.cos(phi), R * Math.sin(phi)];
}

// output numbers at shaft speed rpm and pressure p (bar)
export function rating(u, b, rpm, p = u.p) {
  const V = displacement(u, b);                         // mm^3
  return { V, Lmin: V * rpm * 1e-6, torque: p * 1e5 * V * 1e-9 / TAU, kW: p * 1e5 * V * 1e-9 * rpm / 60 / 1000 };
}
