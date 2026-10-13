// ============================================================================
//  PLANET COLLISION  ·  view.js — the camera: auto framing on the contact
//  plus the user's orbit (no DOM, no GPU)
// ----------------------------------------------------------------------------
//  The world frame is the centre of mass of the collision (it stays at 0).
//  The orbits of the two bodies are in the x-y plane, and spins are about z.
//
//  AXIS (fn pairAxis). The approach axis d is the unit vector from the
//  target centre to the impactor centre, in the x-y plane. When the two
//  centres are closer than 0.35 (R0 + R1) (a merger), the axis of the frame
//  before stays.
//
//  CONTACT POINT (fn contactPoint). Apart: the point on the axis between
//  the two surfaces. Overlapped: the centre of the circle where the two
//  spheres cut each other (the neck).
//
//  AUTO YAW (fn impactYaw). The eye looks at the contact from the side: the
//  eye direction is perpendicular to the axis, so the neck is in profile
//  and no body is between the eye and the contact. The side (v.side, +1 or
//  -1) is fixed for one run; fn sideFor picks the side that the sun lights.
//  The yaw follows the axis with no lag (an eased yaw lags behind a fast
//  oblique swing and then looks past a limb). v.yaw is the user's offset.
//
//  AUTO FRAME (fn frameTarget). Before contact: the point and distance that
//  hold both spheres. After contact: the contact point first, then (over
//  2 sim hours) the middle of the bodies; the distance holds both bodies
//  (a runner that leaves to 5 (R0 + R1) drops out) and an ejecta sphere.
//  The ejecta radius is ext (analysis.js outcome R90, when known) or
//  R0 (1.15 + 0.9 h), up to 3.5 R0: the view pulls out as the debris
//  spreads. Target and distance ease to the goal (fn stepView).
//
//  CAMERA (fn cameraOf). eye, target and up for render.js. On a tall frame
//  (aspect < 0.85) the up vector turns to the axis, so the two bodies
//  stack in the long direction of the screen. A user yaw of 0.6 rad or
//  more turns it back to z. Then the band fit (fn bandView).
//
//  CLEAR BAND (fn bandFrom). The screen band that no phone GUI covers,
//  from the rects of the caption and of the bottom GUI (dock, sheets).
//  A caption counts only when it spans the width (portrait). In landscape
//  it is a narrow left column, and the band keeps the full height.
//
//  grep -n targets: "export function makeView", "export function pairAxis",
//  "export function contactPoint", "export function impactYaw",
//  "export function sideFor", "export function frameTarget",
//  "export function stepView", "export function eyeOf",
//  "export function cameraOf", "export function bandView",
//  "export function bandFrom", "export function halfAngle"
// ============================================================================

// base: the auto yaw; yaw: the user's offset from it
export function makeView() {
  return { base: -1.25, yaw: 0, pitch: 0.42, zoom: 1, side: 1, axis: null, target: [0, 0, 0], dist: 8, goal: null, user: false };
}

const len3 = a => Math.hypot(a[0], a[1], a[2]);
const nrm = a => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dt3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// The half angle of the narrow side of the frame (fov: vertical, radians).
export function halfAngle(fov, aspect) {
  return Math.min(fov / 2, Math.atan(Math.tan(fov / 2) * aspect));
}

// bodies: [{ c, R }]. Returns { d, D, ok }; prev: the axis to keep.
export function pairAxis(bodies, prev) {
  const a = bodies[0], b = bodies[1];
  const keep = prev || [1, 0, 0];
  if (!a || !b || !a.c || !b.c) return { d: keep, D: 0, ok: false };
  const dx = b.c[0] - a.c[0], dy = b.c[1] - a.c[1], dz = b.c[2] - a.c[2];
  const D = Math.hypot(dx, dy, dz), h = Math.hypot(dx, dy);
  if (D < 0.35 * (a.R + b.R) || h < 1e-9) return { d: keep, D, ok: false };
  return { d: [dx / h, dy / h, 0], D, ok: true };
}

// The contact point of spheres a and b ({ c, R }).
export function contactPoint(a, b) {
  const u = [b.c[0] - a.c[0], b.c[1] - a.c[1], b.c[2] - a.c[2]], D = len3(u);
  if (D < 1e-9) return a.c.slice();
  let s;
  if (D >= a.R + b.R) s = a.R + (D - a.R - b.R) * a.R / (a.R + b.R);
  else s = Math.max(0, Math.min(a.R, (D * D + a.R * a.R - b.R * b.R) / (2 * D)));
  return [0, 1, 2].map(k => a.c[k] + u[k] / D * s);
}

// The yaw of an eye direction perpendicular to axis d, on side s (+1, -1).
export function impactYaw(d, s = 1) {
  return Math.atan2(s * d[0], -s * d[1]);
}
// The side whose eye direction has the sun (unit vector) in front of it.
export function sideFor(d, sun) {
  const y = impactYaw(d, 1);
  return Math.cos(y) * sun[0] + Math.sin(y) * sun[1] >= 0 ? 1 : -1;
}

// bodies: [{ c: [x,y,z] or null, R }] (index 0 the target); contactT: sim
// hours since the first contact (null before); fov: vertical, radians;
// aspect: width / height; o: { axis (the axis before), ext (ejecta radius
// about the remnant, code units) }. Returns { target, dist, axis, p }.
export function frameTarget(bodies, contactT, fov, aspect, o = {}) {
  const live = bodies.filter(b => b && b.c);
  if (!live.length) return { target: [0, 0, 0], dist: 6, axis: o.axis || [1, 0, 0], p: [0, 0, 0] };
  const half = halfAngle(fov, aspect);
  const A = bodies[0] && bodies[0].c ? bodies[0] : live[0];
  const B = bodies[1] && bodies[1].c ? bodies[1] : null;
  if (!B) return { target: A.c.slice(), dist: 1.6 * A.R / Math.sin(half), axis: o.axis || [1, 0, 0], p: A.c.slice() };
  const ax = pairAxis([A, B], o.axis);
  const p = contactPoint(A, B);
  // the box round both spheres
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const b of [A, B]) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], b.c[k] - b.R); hi[k] = Math.max(hi[k], b.c[k] + b.R); }
  const mid = lo.map((v, k) => 0.5 * (v + hi[k]));
  if (contactT == null) {
    const rad = 0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
    return { target: mid, dist: 1.08 * rad / Math.sin(half), axis: ax.d, p };
  }
  const w = Math.min(1, Math.max(0, contactT) / 2);
  const target = p.map((x, k) => x + (mid[k] - x) * w);
  const far = 5 * (A.R + B.R);
  const spheres = [A];
  if (len3([B.c[0] - A.c[0], B.c[1] - A.c[1], B.c[2] - A.c[2]]) < far) spheres.push(B);
  const ej = o.ext > 0 ? Math.max(A.R, Math.min(o.ext, 4 * (A.R + B.R))) : A.R * Math.min(3.5, 1.15 + 0.9 * Math.max(0, contactT));
  spheres.push({ c: A.c, R: ej });
  let rad = 0;
  for (const s of spheres) rad = Math.max(rad, len3([s.c[0] - target[0], s.c[1] - target[1], s.c[2] - target[2]]) + s.R);
  return { target, dist: 1.1 * rad / Math.sin(half), axis: ax.d, p };
}

// Move the view toward goal { target, dist } over dt seconds (tau: the time
// constant, s).
export function stepView(v, goal, dt, tau = 0.8) {
  const k = 1 - Math.exp(-dt / tau);
  for (let i = 0; i < 3; i++) v.target[i] += (goal.target[i] - v.target[i]) * k;
  v.dist += (goal.dist - v.dist) * k;
}

// The eye position for the view (z up): yaw base + yaw, pitch, dist x zoom.
export function eyeOf(v) {
  const d = v.dist * v.zoom, cp = Math.cos(v.pitch), y = (v.base || 0) + v.yaw;
  return [v.target[0] + d * cp * Math.cos(y), v.target[1] + d * cp * Math.sin(y), v.target[2] + d * Math.sin(v.pitch)];
}

// eye and target for view v, fitted to the band (zoom back by H / band
// height, then pan along the camera's up so the target sits at the band
// centre). H: the frame height in CSS px; up: the up vector.
export function bandView(v, band, fov, H, up = [0, 0, 1]) {
  const hb = Math.max(0.3 * H, H - band.t - band.b);
  const vv = Object.assign({}, v, { dist: v.dist * Math.min(2.5, H / hb) });
  let eye = eyeOf(vv), target = vv.target.slice();
  const fw = nrm([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  let right = crs(fw, up);
  if (len3(right) < 1e-6) right = crs(fw, [0, 0, 1]);
  right = nrm(right);
  const u = crs(right, fw);
  const D = len3([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]), s = (band.t - band.b) / 2 * 2 * D * Math.tan(fov / 2) / H;
  eye = eye.map((x, k) => x + u[k] * s); target = target.map((x, k) => x + u[k] * s);
  return { eye, target };
}

// The camera for render.js: { eye, target, up }. v: the view (after a
// director's shot); band: the clear band; H, aspect: the frame.
export function cameraOf(v, band, fov, H, aspect) {
  let up = [0, 0, 1];
  if (aspect < 0.85 && v.axis) {
    const w = Math.max(0, Math.min(1, 1 - Math.abs(v.yaw) / 0.6));
    const u = nrm([v.axis[0] * w, v.axis[1] * w, v.axis[2] * w + (1 - w)]);
    const eye = eyeOf(v), fw = nrm([v.target[0] - eye[0], v.target[1] - eye[1], v.target[2] - eye[2]]);
    if (Math.abs(dt3(fw, u)) < 0.95) up = u;
  }
  const bv = bandView(v, band, fov, H, up);
  return { eye: bv.eye, target: bv.target, up };
}

// H, W: the viewport in CSS px; cap: the caption rect or null; lows: the
// rects of the dock and the open sheets. Returns { t, b } in CSS px. The
// band keeps at least 30 % of H.
export function bandFrom(H, W, cap, lows) {
  let t = cap && cap.bottom > 0 && cap.width > 0.6 * W ? cap.bottom + 6 : 0, b = 0;
  for (const r of lows) if (r && r.height > 0 && r.top > H * 0.25) b = Math.max(b, H - r.top + 6);
  const room = 0.3 * H;
  if (H - t - b < room) { const k = (H - room) / (t + b); t *= k; b *= k; }
  return { t, b };
}
