// ============================================================================
//  SPIROGRAPH  ·  spiro.js — gear geometry and rolling kinematics (no DOM)
// ----------------------------------------------------------------------------
//  Units. A gear with N teeth has a pitch radius of N units. All gears have
//  the same tooth pitch, so the teeth of any two gears mesh. One tooth pitch
//  is 2*pi units of arc, and the module is 2 units: the tip of a tooth is 2
//  units outside the pitch circle and the root is 2.5 units inside it.
//
//  Kinematics. The wheel (r teeth) rolls without slip on the fixed gear (R
//  teeth). t is the angle of the wheel center about the fixed center.
//    inside the ring    center (R - r) e^{it}, wheel turns phi = -(R - r)t/r
//    outside the wheel  center (R + r) e^{it}, wheel turns phi = (R + r)t/r + pi
//  The arc that rolls over the fixed gear (R t) equals the arc that rolls
//  over the wheel, so one tooth of the fixed gear meets one tooth of the
//  wheel at each step. The pen sits at distance d from the wheel center, at
//  wheel angle phi. That gives the hypotrochoid and the epitrochoid:
//    x = (R - r) cos t + d cos((R - r)t/r),  y = (R - r) sin t - d sin((R - r)t/r)
//    x = (R + r) cos t - d cos((R + r)t/r),  y = (R + r) sin t - d sin((R + r)t/r)
//  With g = gcd(R, r), the curve closes after L = r/g laps (t = 2 pi L) and
//  has n = R/g petals.
//
//  Tooth phase. Fixed-gear teeth are centered at angles 2 pi k / R. Wheel
//  teeth are centered at (j + 1/2) 2 pi / r in the wheel frame. At t = 0 a
//  fixed tooth sits at the contact point and the wheel shows a gap there,
//  and the rolling keeps that order (tests.mjs checks it).
//
//  EXPORTS   (jump with grep -n "<anchor>" spiro.js)
//      gcd ............. "export function gcd"
//      closure ......... "export function closure"     g, petals, laps
//      wheelAngle ...... "export function wheelAngle"  phi(t)
//      wheelCenter ..... "export function wheelCenter"
//      penAt ........... "export function penAt"       the curve point
//      toothRadius ..... "export function toothRadius" profile of one gear
//      holes ........... "export function holes"       pen holes of a wheel
//      extent .......... "export function extent"      radius the rig needs
//      penSpeed ........ "export function penSpeed"    max |dp/dt|
//      samplePath ...... "export function samplePath"  points for a t range
// ============================================================================
export const TAU = Math.PI * 2;
export const ADD = 2, DED = 2.5;           // addendum and dedendum, in units

export function gcd(a, b) {
  a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b));
  while (b) { const t = a % b; a = b; b = t; }
  return a || 1;
}

// g = gcd(R, r). petals n = R/g. laps L = r/g. period T = 2 pi L.
export function closure(R, r) {
  const g = gcd(R, r);
  return { g, petals: R / g, laps: r / g, period: TAU * r / g };
}

export function wheelAngle(R, r, out, t) {
  return out ? (R + r) / r * t + Math.PI : -(R - r) / r * t;
}

export function wheelCenter(R, r, out, t) {
  const a = out ? R + r : R - r;
  return [a * Math.cos(t), a * Math.sin(t)];
}

// The pen point for pen distance d. Same as center + d e^{i phi}.
export function penAt(R, r, out, d, t) {
  if (out) {
    const a = R + r, k = a / r;
    return [a * Math.cos(t) - d * Math.cos(k * t), a * Math.sin(t) - d * Math.sin(k * t)];
  }
  const a = R - r, k = a / r;
  return [a * Math.cos(t) + d * Math.cos(k * t), a * Math.sin(t) - d * Math.sin(k * t)];
}

// Radius of the tooth outline at angle a (gear frame) for a gear of N teeth.
// phase0 is the angle of a tooth center. internal: the teeth point in.
// A clipped cosine gives straight-ish flanks with flat tips and roots.
export function toothRadius(N, a, phase0, internal) {
  const v = Math.max(-1, Math.min(1, 1.85 * Math.cos(N * (a - phase0)) + 0.15));
  const h = v > 0 ? v * ADD : v * DED;
  return internal ? N - h : N + h;
}

// The pen holes of a wheel with r teeth: [{ d, a }], d in units from the
// center, a the angle in the wheel frame. The holes go out on a spiral. Each
// angle is a whole number of tooth pitches, so a turn of the wheel that puts
// a hole at angle 0 keeps the tooth phase.
export function holes(r) {
  const out = [], pitch = TAU / r;
  const d0 = Math.max(2.4, 0.1 * r), dMax = r - DED - 3, step = 2.5;
  const n = Math.max(1, Math.floor((dMax - d0) / step + 1e-9) + 1);
  for (let i = 0; i < n; i++) {
    const d = n === 1 ? Math.max(1.5, Math.min(d0, dMax)) : d0 + i * step;
    out.push({ d, a: Math.round(i * 2.4 / pitch) * pitch });
  }
  return out;
}

// The radius from the fixed center that the rig needs (gear tips included).
export function extent(R, r, out) {
  return out ? R + 2 * r + ADD : R + DED + ringRim(R);
}
export function ringRim(R) { return 5 + 0.06 * R; }

// An upper bound of the pen speed |dp/dt| in units per radian of t.
export function penSpeed(R, r, out, d) {
  const a = out ? R + r : R - r;
  return a + d * a / r;
}

// Points of the curve for t in [t0, t1], at most maxStep units apart.
// Returns a Float32Array of x, y pairs. rot turns the whole curve.
export function samplePath(R, r, out, d, rot, t0, t1, maxStep) {
  const n = Math.max(1, Math.ceil((t1 - t0) * penSpeed(R, r, out, d) / maxStep));
  const pts = new Float32Array((n + 1) * 2), c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i <= n; i++) {
    const [x, y] = penAt(R, r, out, d, t0 + (t1 - t0) * i / n);
    pts[2 * i] = c * x - s * y; pts[2 * i + 1] = s * x + c * y;
  }
  return pts;
}
