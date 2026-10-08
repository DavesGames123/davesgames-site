// ============================================================================
//  STORM GLOBE  ·  camera.js  ·  orbit camera, projection, eased flights
// ----------------------------------------------------------------------------
//  No DOM. World frame: the Earth is the unit sphere, z = north pole,
//  x = (0N, 0E), y = (0N, 90E). The camera looks at a surface point:
//    cam = { lat, lon (deg), alt (Earth radii above the surface),
//            tilt (deg from straight down), heading (deg, 0 = north up) }
//  basis(cam, aspect, off) gives eye, right, up, fwd and the tangents the
//  shaders use; off = { x, y } shifts the principal point (NDC), so the
//  subject sits in the clear part of the screen (panels, the saver plate).
//
//  flight(a, b, opt) -> { at(k) -> cam, dur }  a great-circle flight with
//  an eased arc: the camera rises with the angle to cross and comes down
//  at the far end (after van Wijk and Nuij's zoom-and-pan, simplified).
//  flightDur(w) sets the duration from FLY: the smootherstep peak angular
//  speed (1.875 w / T) stays at or below FLY.omega and the peak angular
//  acceleration (5.774 w / T^2) at or below FLY.alpha.
//
//  Framing rule (minimum altitude): frameAlt(rKm, clear) is the altitude
//  at which a ground radius rKm fills the narrow side of the clear area
//  (the screen less the panels or the saver plate). A portrait phone has
//  a narrow horizontal field, so the same radius needs more altitude
//  there. minAlt(clear, who) applies MIN_R_KM: 'auto' for the tour, the
//  flights and the saver, 'user' for the pinch and wheel limit.
//
//  Smoothing: spring(s, target, omega, dt) is a critically damped spring
//  (no overshoot) on a number; follow(f, p, omega, dt, vmax) is the same
//  on the sphere, with the angular speed limited to vmax (rad/s). The
//  tour and the saver follow a moving storm through it, so a storm that
//  turns at a track fix does not jerk the camera.
//
//  grep -n targets: "export function basis", "export function flight",
//                   "export function project", "export function pick",
//                   "export function frameAlt", "export const FLY",
//                   "export function spring", "export function follow"
// ============================================================================
const D = Math.PI / 180;
export const FOV = 34;                  // vertical field of view, deg

export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
export function unit(lat, lon) { return [Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D)]; }
export function toLatLon(p) { const n = v3.norm(p); return { lat: Math.asin(Math.max(-1, Math.min(1, n[2]))) / D, lon: Math.atan2(n[1], n[0]) / D }; }
export function east(lon) { return [-Math.sin(lon * D), Math.cos(lon * D), 0]; }
export function north(lat, lon) { return [-Math.sin(lat * D) * Math.cos(lon * D), -Math.sin(lat * D) * Math.sin(lon * D), Math.cos(lat * D)]; }
// great-circle angle between two points (rad)
export function arc(a, b) { return Math.acos(Math.max(-1, Math.min(1, v3.dot(unit(a.lat, a.lon), unit(b.lat, b.lon))))); }
export function slerp(a, b, k) {
  const pa = unit(a.lat, a.lon), pb = unit(b.lat, b.lon), w = Math.acos(Math.max(-1, Math.min(1, v3.dot(pa, pb))));
  if (w < 1e-6) return { lat: a.lat, lon: a.lon };
  const s = Math.sin(w), ka = Math.sin((1 - k) * w) / s, kb = Math.sin(k * w) / s;
  return toLatLon(v3.add(v3.mul(pa, ka), v3.mul(pb, kb)));
}

export function basis(cam, aspect, off = { x: 0, y: 0 }) {
  const T = unit(cam.lat, cam.lon), E = east(cam.lon), N = north(cam.lat, cam.lon);
  const h = (cam.heading || 0) * D, tau = (cam.tilt || 0) * D;
  const F = v3.add(v3.mul(N, Math.cos(h)), v3.mul(E, Math.sin(h)));
  const eye = v3.add(T, v3.mul(v3.sub(v3.mul(T, Math.cos(tau)), v3.mul(F, Math.sin(tau))), cam.alt));
  const fwd = v3.norm(v3.sub(T, eye));
  const up0 = v3.add(v3.mul(F, Math.cos(tau)), v3.mul(T, Math.sin(tau)));
  const right = v3.norm(v3.cross(fwd, up0));
  const up = v3.cross(right, fwd);
  const tanY = Math.tan(FOV * D / 2), tanX = tanY * aspect;
  return { eye, fwd, right, up, tanX, tanY, off, aspect };
}
// world point -> { x, y } in NDC (-1..1), z (depth along fwd), front (faces the eye)
export function project(b, p) {
  const v = v3.sub(p, b.eye), z = v3.dot(v, b.fwd);
  const x = v3.dot(v, b.right) / (z * b.tanX) + b.off.x, y = v3.dot(v, b.up) / (z * b.tanY) + b.off.y;
  const front = v3.dot(p, v3.sub(b.eye, p)) > 0 && z > 0;
  return { x, y, z, front };
}
// NDC -> surface { lat, lon } or null
export function pick(b, nx, ny) {
  const d = v3.norm(v3.add(b.fwd, v3.add(v3.mul(b.right, (nx - b.off.x) * b.tanX), v3.mul(b.up, (ny - b.off.y) * b.tanY))));
  const o = b.eye, bb = v3.dot(o, d), c = v3.dot(o, o) - 1, h = bb * bb - c;
  if (h < 0) return null;
  return toLatLon(v3.add(o, v3.mul(d, -bb - Math.sqrt(h))));
}
// The altitude at which a cap of angular radius r (rad) fills a screen
// half-height (tilt 0): the camera above the centre sees the cap edge at
// half the field of view.
export function altForRadius(r, fill = 0.9) {
  const t = Math.tan(FOV * D / 2) * fill;
  // edge point at angle r: eye at distance 1 + a; tan(view angle) = sin r / (1 + a - cos r)
  return Math.max(0.02, Math.sin(r) / t - 1 + Math.cos(r));
}

// The share of the view height that the whole globe may span: the narrow
// side of the clear area, so a portrait phone fits the globe to its width.
// clear = { w, h, H } as frameAlt reads it; 0.3 at least.
export function narrowFill(clear) { return Math.max(0.3, Math.min(clear.w, clear.h) / Math.max(1, clear.H)); }
// The altitude at which the whole globe spans fill of the view height.
export function globeAlt(fill) {
  const k = Math.tan(FOV * D / 2) * fill, s = k / Math.sqrt(1 + k * k);
  return 1 / s - 1;
}

// ── framing rule ─────────────────────────────────────────────────────────
export const R_KM = 6371;
// the smallest ground radius (km) on the narrow side of the clear area
export const MIN_R_KM = { auto: 900, user: 450 };
// clear = { w, h, H }: the clear area (CSS px) and the view height
export function frameAlt(rKm, clear) {
  const fill = Math.max(0.12, Math.min(clear.w, clear.h) / Math.max(1, clear.H));
  return altForRadius(rKm / R_KM, fill);
}
export function minAlt(clear, who = 'auto') { return frameAlt(MIN_R_KM[who] || MIN_R_KM.auto, clear); }

// ── smoothing ────────────────────────────────────────────────────────────
// s = { x, v }; critically damped toward target; sub-steps keep it stable
export function spring(s, target, omega, dt) {
  const n = Math.max(1, Math.ceil(dt * omega * 4)), h = dt / n;
  for (let i = 0; i < n; i++) { const a = omega * omega * (target - s.x) - 2 * omega * s.v; s.v += a * h; s.x += s.v * h; }
  return s.x;
}
// f = { p: [x,y,z] unit, v: [x,y,z] tangent (rad/s) }; p -> target unit
// vector; |v| <= vmax. Returns { lat, lon }.
export function follow(f, target, omega, dt, vmax = 0.35) {
  const n = Math.max(1, Math.ceil(dt * omega * 4)), h = dt / n;
  for (let i = 0; i < n; i++) {
    const d = v3.sub(target, v3.mul(f.p, v3.dot(target, f.p)));          // tangent toward the target
    const dl = v3.len(d), ang = Math.atan2(dl, v3.dot(target, f.p));
    const e = dl > 1e-12 ? v3.mul(d, ang / dl) : [0, 0, 0];               // log map: the tangent of length ang
    let v = v3.add(f.v, v3.mul(v3.sub(v3.mul(e, omega * omega), v3.mul(f.v, 2 * omega)), h));
    v = v3.sub(v, v3.mul(f.p, v3.dot(v, f.p)));
    const sp = v3.len(v); if (sp > vmax) v = v3.mul(v, vmax / sp);
    f.p = v3.norm(v3.add(f.p, v3.mul(v, h)));
    f.v = v3.sub(v, v3.mul(f.p, v3.dot(v, f.p)));
  }
  return toLatLon(f.p);
}
export function follower(cam) { return { p: unit(cam.lat, cam.lon), v: [0, 0, 0] }; }

export const ease = k => (k < 0 ? 0 : k > 1 ? 1 : k * k * k * (k * (6 * k - 15) + 10));   // smootherstep
function lerpAngle(a, b, k) { let d = ((b - a + 540) % 360) - 180; return a + d * k; }

// FLY: omega peak angular speed (rad/s), alpha peak angular acceleration
// (rad/s^2), climb the peak rate of altitude change (Earth radii/s)
export const FLY = { omega: 0.5, alpha: 0.4, climb: 0.9, minDur: 2.6, maxDur: 12 };
export function flightDur(w, dAlt = 0, minDur = FLY.minDur) {
  const t = Math.max(minDur, 1.875 * w / FLY.omega, Math.sqrt(5.774 * w / FLY.alpha), 1.875 * Math.abs(dAlt) / FLY.climb);
  return Math.min(FLY.maxDur, t);
}
export function flight(a, b, opt = {}) {
  const w = arc(a, b);
  const peak = Math.max(a.alt, b.alt, Math.min(3.2, 0.35 + w * 1.25));
  // the climb to the peak and back down counts as altitude change
  const dAlt = Math.max(Math.abs(b.alt - a.alt), 2 * (peak - Math.max(a.alt, b.alt)));
  const dur = Math.max(opt.dur ?? 0, flightDur(w, dAlt, opt.minDur));
  return {
    dur, w, peak,
    at(k) {
      const e = ease(k), pos = slerp(a, b, e);
      // altitude: a quadratic arc through a.alt, peak, b.alt
      const lift = Math.max(0, peak - (a.alt * (1 - e) + b.alt * e)) * Math.sin(Math.PI * e);
      return {
        lat: pos.lat, lon: pos.lon,
        alt: a.alt * (1 - e) + b.alt * e + lift,
        tilt: (a.tilt || 0) * (1 - e) + (b.tilt || 0) * e - Math.sin(Math.PI * e) * Math.min(a.tilt || 0, b.tilt || 0) * 0.8,
        heading: lerpAngle(a.heading || 0, b.heading || 0, e),
      };
    },
  };
}
