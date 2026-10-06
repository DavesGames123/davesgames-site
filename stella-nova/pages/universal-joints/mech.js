// ============================================================================
//  UNIVERSAL & CV JOINTS  ·  mech.js — joint kinematics in 3D (no DOM)
// ----------------------------------------------------------------------------
//  No DOM and no THREE: tests.mjs runs this file in Node. Units are mm and
//  rad. World axes as on the page: y is up, the input shaft lies on +x and
//  every bend turns about +y by the shaft angle beta. Vectors are [x, y, z].
//
//  SHAFT FRAME
//    For an axis s in the bend plane: e = norm(Y x s) lies in the bend
//    plane, f = Y. (e, f, s) is right-handed. An angle th on the shaft is
//    the direction cos th e + sin th f.
//
//  CARDAN (HOOKE) JOINT
//    The input fork pin axis is a = cos th e1 + sin th f1. The cross keeps
//    its two arms at 90 deg, and the output fork pin must be normal to the
//    output shaft, so b = norm(s2 x a). The output angle is the turn of b
//    about s2 from its place at th = 0. That gives the closed forms
//      tan psi = tan th / cos beta
//      w2 / w1 = cos beta / (1 - sin^2 beta cos^2 th)
//    tests.mjs checks the vector solution against both.
//
//  DOUBLE CARDAN
//    An intermediate shaft at beta to the input, then a second joint. The
//    second fork on the intermediate shaft is in phase with the first
//    (a2 = b1) or turned 90 deg (phase = 1, the assembly error). Z: the
//    output is parallel to the input. W: the output turns by a further
//    beta, so the shafts meet. In phase, the second joint undoes the
//    ripple of the first, and the output angle is the input angle.
//
//  RZEPPA
//    Six balls ride in six meridian grooves of the outer race (input) and
//    of the inner race (output). The cage holds every ball centre on the
//    plane through the joint centre with normal n = norm(s1 + s2): the
//    bisecting (homokinetic) plane. The reflection in that plane takes
//    shaft 1 to shaft 2, so each ball is the same distance from both axes,
//    and the output turns exactly with the input. A ball is the meeting
//    of its input groove plane and the bisecting plane, at radius rp.
//
//  GREP MAP
//    export const UNITS ......... the four joints and their numbers
//    export function axes ....... shaft axes and joint centres for beta
//    export function solve ...... (id, th, beta, phase) -> pose
//    export function ratio ...... output speed / input speed (numeric)
//    export function cardanPsi .. the closed form for one joint
//    export function cardanRatio  the closed form speed ratio
// ============================================================================

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const UNITS = [
  { id: 'cardan', name: 'Cardan joint', kind: 'One Hooke joint · speed ripple', joints: 1 },
  { id: 'doubleZ', name: 'Double · Z', kind: 'Parallel shafts · ripple cancels', joints: 2, arr: 'Z' },
  { id: 'doubleW', name: 'Double · W', kind: 'Shafts meet · ripple cancels', joints: 2, arr: 'W' },
  { id: 'rzeppa', name: 'Rzeppa CV', kind: 'Six balls on the bisecting plane', joints: 1, balls: 6 },
];
export const unit = id => UNITS.find(u => u.id === id);

// sizes shared with scene.js (mm)
export const SIZE = {
  L: 190,          // input and output shaft length from the joint centre
  Lm: 150,         // intermediate shaft length, joint centre to joint centre
  arm: 24,         // cross arm length from the cross centre to the pin end
  rp: 38,          // Rzeppa ball centre radius
  rb: 7,           // Rzeppa ball radius
  betaMax: 40 * DEG,
};

// ── vectors ───────────────────────────────────────────────────────────────
export const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; },
};
const Y = [0, 1, 0];
// turn v about +y by ang (right hand): x -> (cos, 0, -sin)
export const rotY = (v, ang) => { const c = Math.cos(ang), s = Math.sin(ang); return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]]; };
export const shaftFrame = s => ({ e: V.norm(V.cross(Y, s)), f: Y, s });
const dirAt = (F, th) => V.add(V.mul(F.e, Math.cos(th)), V.mul(F.f, Math.sin(th)));
const wrap = a => a - TAU * Math.round(a / TAU);
// the turn of v about s, measured from v0 (both normal to s)
const turn = (v, v0, s) => Math.atan2(V.dot(v, V.cross(s, v0)), V.dot(v, v0));

// ── closed forms for one Cardan joint ───────────────────────────────────────
export const cardanPsi = (th, beta) => th + wrap(Math.atan2(Math.sin(th), Math.cos(th) * Math.cos(beta)) - th);
export const cardanRatio = (th, beta) => Math.cos(beta) / (1 - Math.sin(beta) ** 2 * Math.cos(th) ** 2);

// ── axes and joint centres ──────────────────────────────────────────────────
// s1 input axis; J1 the first joint centre (origin). Double: sm and J2.
// sOut the output axis. W turns the output by a further beta.
export function axes(id, beta) {
  const s1 = [1, 0, 0], J1 = [0, 0, 0];
  if (id === 'doubleZ' || id === 'doubleW') {
    const sm = rotY(s1, beta), J2 = V.mul(sm, SIZE.Lm);
    const sOut = id === 'doubleZ' ? s1 : rotY(s1, 2 * beta);
    return { s1, J1, sm, J2, sOut, Jout: J2 };
  }
  return { s1, J1, sOut: rotY(s1, beta), Jout: J1 };
}

// one Cardan joint: input pin a on shaft sIn, output shaft sOut -> pin b
const cardanPin = (a, sOut) => V.norm(V.cross(sOut, a));

// pose at input angle th and shaft angle beta.
// Returns { th, out, err, mid?, A } where A holds the frames scene.js needs:
// every frame is { X, Y, at } with Y the axis and X the pin (or groove) axis.
export function solve(id, th, beta, phase = 0) {
  const A = axes(id, beta), F1 = shaftFrame(A.s1), Fo = shaftFrame(A.sOut);
  const a1 = dirAt(F1, th), a10 = F1.e;
  if (id === 'cardan') {
    const b = cardanPin(a1, A.sOut), b0 = cardanPin(a10, A.sOut);
    const out = th + wrap(turn(b, b0, A.sOut) - th);
    return {
      th, out, err: out - th, A,
      frames: { inYoke: { X: a1, Y: A.s1, at: A.J1 }, cross1: { X: a1, Z: b, at: A.J1 }, outYoke: { X: b, Y: A.sOut, at: A.J1 } },
    };
  }
  if (id === 'rzeppa') {
    const n = V.norm(V.add(A.s1, A.sOut)), balls = [], ang = [];
    const ce = V.norm(V.cross(Y, n));
    for (let k = 0; k < 6; k++) {
      const g = dirAt(F1, th + k * TAU / 6), m = V.cross(A.s1, g);
      let d = V.norm(V.cross(n, m));
      if (V.dot(d, g) < 0) d = V.mul(d, -1);
      balls.push(V.mul(d, SIZE.rp));
      ang.push(Math.atan2(V.dot(d, Y), V.dot(d, ce)));
    }
    // output angle: ball 0 seen in the output shaft frame
    const p = balls[0], out = th + wrap(Math.atan2(V.dot(p, Fo.f), V.dot(p, Fo.e)) - th);
    // cage angle: the circular mean of (ball angle - k 60 deg)
    let cx = 0, cy = 0;
    for (let k = 0; k < 6; k++) { const q = ang[k] - k * TAU / 6; cx += Math.cos(q); cy += Math.sin(q); }
    const cage = Math.atan2(cy, cx), shift = ang.map((q, k) => wrap(q - cage - k * TAU / 6));
    const cageX = V.add(V.mul(ce, Math.cos(cage)), V.mul(Y, Math.sin(cage)));
    return {
      th, out, err: out - th, A, balls, n, cage, shift,
      frames: { bell: { X: a1, Y: A.s1, at: A.J1 }, inner: { X: dirAt(Fo, out), Y: A.sOut, at: A.J1 }, cage: { X: cageX, Y: n, at: A.J1 } },
    };
  }
  // double Cardan
  const Fm = shaftFrame(A.sm);
  const b1 = cardanPin(a1, A.sm), b10 = cardanPin(a10, A.sm);
  const mid = th + wrap(turn(b1, b10, A.sm) - th);
  const second = b => (phase ? V.norm(V.cross(A.sm, b)) : b);
  const a2 = second(b1), a20 = second(b10);
  const b2 = cardanPin(a2, A.sOut), b20 = cardanPin(a20, A.sOut);
  const out = th + wrap(turn(b2, b20, A.sOut) - th);
  return {
    th, out, err: out - th, mid, A,
    frames: {
      inYoke: { X: a1, Y: A.s1, at: A.J1 }, cross1: { X: a1, Z: b1, at: A.J1 },
      midShaft: { X: b1, Y: A.sm, at: A.J1 }, midYoke2: { X: a2, Y: A.sm, at: A.J1 },
      cross2: { X: a2, Z: b2, at: A.J2 }, outYoke: { X: b2, Y: A.sOut, at: A.J2 },
    },
    Fm,
  };
}

// output speed / input speed, by a central difference on the output angle
export function ratio(id, th, beta, phase = 0, h = 1e-5) {
  return (solve(id, th + h, beta, phase).out - solve(id, th - h, beta, phase).out) / (2 * h);
}
// the intermediate shaft speed / input speed (double Cardan)
export function midRatio(id, th, beta, phase = 0, h = 1e-5) {
  return (solve(id, th + h, beta, phase).mid - solve(id, th - h, beta, phase).mid) / (2 * h);
}
