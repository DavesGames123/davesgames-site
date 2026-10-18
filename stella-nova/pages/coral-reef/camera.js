// ============================================================================
//  CORAL REEF  ·  camera.js  ·  the explore camera of the page (no DOM)
// ----------------------------------------------------------------------------
//  The main view is always the user's own camera. createExploreCamera()
//  has five modes; input.js turns the pointer, touch, wheel and keys into
//  the calls below, and main.js copies cam.eye and cam.look to three.
//
//    orbit ... cam.orbit = { target, yaw, pitch, dist }. The eye is
//              target + dirOf(yaw, pitch) * dist. A turn pivots round the
//              rock under the pointer (orbitBegin picks it), the wheel and
//              the pinch zoom about the rock under the cursor (the point
//              stays under the cursor), a grab pan keeps the grip point
//              under the pointer, a double tap flies to a point (flyTo).
//    swim .... cam.swim = { pos, vel, yaw, pitch, speedK }. swimInput()
//              each frame: move [strafe, up, forward] -1..1 (forward
//              goes along the view, so a look up and forward rises), look
//              [dyaw, dpitch] in radians, boost. Velocity with speed-up
//              and brake. Near rock the speed into the rock fades out and
//              a soft push holds the eye at CLEAR_SOFT: smooth contact.
//    tour .... a guided path through a canyon or under an arch
//              (buildTours, from rock.features). Any user input takes
//              over: the camera goes to swim at the same pose and speed.
//    follow .. a chase camera behind one ROV, with free look (a drag).
//              When rock blocks the boom behind the ROV, pickBoom turns
//              it round the ROV to the side or above that has water. A
//              glide that rock holds for 0.4 s cuts to the boom, and
//              follow(id, { snap }) cuts at once. The look comes back
//              to the back of the vehicle after 3 s with no input.
//              The ROV body is an obstacle (bodySdf, bodyOut): the boom
//              is never shorter than the body + BODY_MARGIN, the boom
//              yaw is a damped spring capped by BOOM_RATE and BOOM_ACC,
//              and an eye move that crosses the body goes round it.
//    saver ... saverGoal(pos, look, cut) from the saver director of
//              main.js; the springs of this module move the camera.
//
//  SPRINGS. Each mode gives a goal pose (eye, look). Critically damped
//  springs (spring(), the exact step) take the camera to it. A mode
//  change glides with a slow spring for about 1.2 s.
//
//  WORLD (CONTRACT-V4.md). On the infinite world R is Infinity: no plot
//  bound, the orbit distance stops at o.maxDist, the tours come from the
//  features near the eye (refreshTours) and rock.tourGrid gives the route
//  maker (no plot grid).
//
//  ROCK. rock.sdfAll is a 1.5-Lipschitz bound: true metres are about
//  sdf / rock.sdfScale (measured: 0.7x to 1.8x of that). Every frame the
//  eye moves by moveSafe(): a sphere trace (steps of (sdf - hard) / 1.5,
//  so the trace never steps over rock) from the last eye to the new eye.
//  At a hit the move slides along the rock; an eye under CLEAR_HARD is
//  pushed out along the gradient, or the last good eye stays.
//  The orbit boom: rock between the target and the eye pulls the eye in.
//
//  grep -n targets
//    "export function spring"            the critically damped step
//    "export function createField"       metres, normal, trace, pick, moveSafe
//    "export function buildTours"        the canyon and arch paths
//    "export function rayAt"             a screen ray of a pose
//    "export function createExploreCamera"
//    "  function orbitGoal"  "  function swimStep"  "  function tourStep"
//    "  function pickBoom"  "  function followGoal" "  function update("
//    "export function bodySdf"  "export function bodyOut"  "BOOM_RATE"
// ============================================================================

import { createGrid, pullTight, pushOut as pilotPushOut } from './rov/pilot.js';

export const CLEAR_HARD = 0.35;    // m: the eye is never nearer the rock than this
export const CLEAR_SOFT = 0.7;     // m: the swim push starts here
export const TOUR_CLEAR = 0.45;
// The ROV body as an obstacle of the follow eye (the user: "when ROV's turn
// quickly they turn the camera into the rov"): a box round the vehicle
// (2.2 x 1.4 x 1.5 m x scale 0.6, with a skin), and a margin over it.
export const BODY_HALF = [0.72, 0.46, 0.5];
export const BODY_MARGIN = 0.3;
export const BOOM_RATE = 1.8;      // rad/s: the most the boom turns round the ROV
export const BOOM_ACC = 5;         // rad/s2: the most its turn rate changes
// metres from p to the box of a vehicle at c with heading yaw (x forward)
export function bodySdf(p, c, yaw, half = BODY_HALF) {
  const dx = p[0] - c[0], dy = p[1] - c[1], dz = p[2] - c[2], cy = Math.cos(yaw), sy = Math.sin(yaw);
  const qx = Math.abs(dx * cy + dz * sy) - half[0], qy = Math.abs(dy) - half[1], qz = Math.abs(-dx * sy + dz * cy) - half[2];
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
}
// p moved out from the body centre along c -> p (or along `away` when p is
// at the centre) to the body + margin shell; p itself when it is outside
export function bodyOut(p, c, yaw, away, half = BODY_HALF, margin = BODY_MARGIN) {
  if (bodySdf(p, c, yaw, half) >= margin) return p;
  let d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], l = Math.hypot(d[0], d[1], d[2]);
  if (l < 1e-3 && away) { d = away.slice(); l = Math.hypot(d[0], d[1], d[2]); }
  if (l < 1e-3) { d = [0, 1, 0]; l = 1; }
  d = [d[0] / l, d[1] / l, d[2] / l];
  let lo = 0, hi = Math.hypot(half[0], half[1], half[2]) + margin + 0.05;
  for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (bodySdf([c[0] + d[0] * m, c[1] + d[1] * m, c[2] + d[2] * m], c, yaw, half) >= margin) hi = m; else lo = m; }
  return [c[0] + d[0] * hi, c[1] + d[1] * hi, c[2] + d[2] * hi];
}    // m: every tour sample has this much water (arch gaps are about 2 m)
const TAU = Math.PI * 2;
const UP = [0, 1, 0];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const DIRS = [];
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) { const l = Math.hypot(x, y, z); DIRS.push([x / l, y / l, z / l]); }
DIRS.sort((a, b) => b[1] - a[1]);

// The unit vector of a yaw (round y, from +x to +z) and a pitch (up).
export function dirOf(yaw, pitch) { const c = Math.cos(pitch); return [c * Math.cos(yaw), Math.sin(pitch), c * Math.sin(yaw)]; }
export function anglesOf(d) { const n = norm(d); return { yaw: Math.atan2(n[2], n[0]), pitch: Math.asin(clamp(n[1], -1, 1)) }; }

// The exact step of a critically damped spring: x goes to goal with no
// overshoot. omega: 1/s (a larger omega is a stiffer spring).
export function spring(x, v, goal, omega, dt) {
  const y = x - goal, e = Math.exp(-omega * dt), k = (v + omega * y) * dt;
  return [goal + (y + k) * e, (v - omega * k) * e];
}
function spring3(S, goal, omega, dt) {
  for (let i = 0; i < 3; i++) { const r = spring(S.x[i], S.v[i], goal[i], omega, dt); S.x[i] = r[0]; S.v[i] = r[1]; }
}

// Rodrigues: v turned by angle a round the unit axis k.
function rotate(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a), kv = cross(k, v), kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}

// ── the rock as a field in metres ──────────────────────────────────────────
// rock: createRock() (sdfAll, sdfScale, lipschitz) or any { sdf } in metres.
export function createField(rock) {
  const f = rock.sdfAll || rock.sdf;
  const scale = rock.sdfScale || 1, lip = rock.lipschitz || 1.5;
  const sdf = (p) => f(p[0], p[1], p[2]);
  const metres = (p) => f(p[0], p[1], p[2]) / scale;
  function normal(p, e = 0.06) {
    const gx = f(p[0] + e, p[1], p[2]) - f(p[0] - e, p[1], p[2]);
    const gy = f(p[0], p[1] + e, p[2]) - f(p[0], p[1] - e, p[2]);
    const gz = f(p[0], p[1], p[2] + e) - f(p[0], p[1], p[2] - e);
    const l = Math.hypot(gx, gy, gz);
    return l > 1e-6 ? [gx / l, gy / l, gz / l] : null;
  }
  // The first t on o + d t (d a unit vector) with metres < clr, or Infinity
  // up to max. The step (sdf - clr * scale) / lip is a lower bound of the
  // way to that level, so no thin wall is stepped over.
  function trace(o, d, max, clr = 0) {
    const c = clr * scale;
    let t = 0;
    for (let i = 0; i < 400 && t <= max; i++) {
      const s = f(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t) - c;
      if (s < 0) return t;
      t += Math.max(s / lip, 0.01);
    }
    return Infinity;
  }
  // The rock (or sand) under a screen ray: { p, t } or null.
  function pick(o, d, max = 160) {
    const t = trace(o, d, max, 0);
    if (!Number.isFinite(t)) return null;
    // a few bisection steps onto the surface
    let a = Math.max(0, t - 0.05), b = t;
    for (let i = 0; i < 8; i++) { const m = (a + b) / 2; if (f(o[0] + d[0] * m, o[1] + d[1] * m, o[2] + d[2] * m) < 0) b = m; else a = m; }
    return { p: add(o, mul(d, a)), t: a };
  }
  // Out of the rock along the gradient to clr metres; null if it fails
  // (deep in the clamped field the gradient is 0).
  function pushOut(p, clr) {
    let q = p.slice();
    for (let i = 0; i < 12; i++) {
      const m = metres(q);
      if (m >= clr) return q;
      const n = normal(q);
      if (!n) return null;
      q = add(q, mul(n, (clr - m) * 0.8 + 0.02));
    }
    return metres(q) >= clr ? q : null;
  }
  // Move from a to b; stop at the clr level and slide along the rock with
  // what is left of the move. a must be clear (else it is pushed out).
  // pushOut, else the nearest clear point on shells of 26 directions, up
  // first (as rov/pilot.js pushOut), else null
  function escape(p, clr) {
    const q = pushOut(p, clr); if (q) return q;
    for (let r = 0.2; r < 12; r *= 1.3) for (const d of DIRS) { const c = add(p, mul(d, r)); if (metres(c) >= clr) return c; }
    return null;
  }
  function moveSafe(a, b, clr = CLEAR_HARD) {
    let p = a;
    if (metres(p) < clr) { const q = pushOut(p, clr + 0.02); if (q) p = q; else return a; }
    let want = sub(b, p);
    for (let k = 0; k < 3; k++) {
      const L = len(want); if (L < 1e-6) return p;
      const d = mul(want, 1 / L), t = trace(p, d, L, clr);
      if (!Number.isFinite(t) || t >= L) { const q = add(p, want); return metres(q) >= clr ? q : p; }
      const t0 = Math.max(0, t - 0.01);
      p = add(p, mul(d, t0));
      const n = normal(p);
      if (!n) return p;
      const rest = mul(d, L - t0), into = dot(rest, n);
      want = into < 0 ? sub(rest, mul(n, into * 1.02)) : rest;
    }
    return p;
  }
  return { f, sdf, metres, normal, trace, pick, pushOut, escape, moveSafe, scale, lip };
}

// ── a screen ray of a pose ─────────────────────────────────────────────────
// pose { eye, look }, P { fov (deg), aspect, shift [sx, sy] }: the shift is
// the view offset in NDC (main.js: [2 ox / w, -2 oy / h]).
export function basisOf(eye, look) {
  const f = norm(sub(look, eye));
  let r = cross(f, UP); if (len(r) < 1e-6) r = [1, 0, 0];
  r = norm(r);
  return { f, r, u: cross(r, f) };
}
export function rayAt(pose, P, nx, ny) {
  const B = basisOf(pose.eye, pose.look), t = Math.tan((P.fov || 50) * Math.PI / 360), a = P.aspect || 1;
  const sx = (P.shift && P.shift[0]) || 0, sy = (P.shift && P.shift[1]) || 0;
  const x = (nx + sx) * t * a, y = (ny + sy) * t;
  return { o: pose.eye.slice(), d: norm([B.f[0] + B.r[0] * x + B.u[0] * y, B.f[1] + B.r[1] * x + B.u[1] * y, B.f[2] + B.r[2] * x + B.u[2] * y]) };
}
// NDC of a world point (the inverse of rayAt), or null behind the eye.
export function project(pose, P, p) {
  const B = basisOf(pose.eye, pose.look), v = sub(p, pose.eye), z = dot(v, B.f);
  if (z <= 1e-6) return null;
  const t = Math.tan((P.fov || 50) * Math.PI / 360), a = P.aspect || 1;
  const sx = (P.shift && P.shift[0]) || 0, sy = (P.shift && P.shift[1]) || 0;
  return [dot(v, B.r) / z / (t * a) - sx, dot(v, B.u) / z / t - sy];
}

// ── tours: guided paths through the canyons and under the arches ──────────
// A tour is a list of control points: a lead-in from high water, the
// feature (the canyon floor path 1.6 m up, or the arch axis through the
// gap), a lead-out. rov/pilot.js plans the route (imported, not copied):
// a free-water grid and A* between the control points, then string
// pulling on each leg. Here the route gets a Catmull-Rom curve, sampled every 0.1 m;
// a curve sample with less than TOUR_CLEAR of water falls back to the
// route line, which pullTight checked. A tour with a sample that stays
// under TOUR_CLEAR is dropped (ok false). An arch tour also tells if it
// passes under rock (under).
function resample(pts, step) {
  const out = [pts[0].slice()];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = len(sub(b, a));
    if (L < 1e-9) continue;
    let t = step - carry;
    while (t <= L) { out.push(lerp3(a, b, t / L)); t += step; }
    carry = L - (t - step);
  }
  const last = pts[pts.length - 1];
  if (len(sub(out[out.length - 1], last)) > step * 0.3) out.push(last.slice());
  return out;
}
function catmullAt(P, i, t) {
  const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[Math.min(P.length - 1, i + 1)], p3 = P[Math.min(P.length - 1, i + 2)];
  const t2 = t * t, t3 = t2 * t;
  return [0, 1, 2].map(j => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3));
}
function makePath(F, ctrl, grid, sdfS) {
  const clearS = (TOUR_CLEAR + 0.1) * F.scale;
  // A* per leg, and string pulling per leg: the control points stay on
  // the route (one pull over all legs would cut over an arch)
  const route = [pilotPushOut(sdfS, ctrl[0].slice(), clearS)];
  for (let i = 1; i < ctrl.length; i++) {
    const r = grid.route(route[route.length - 1], ctrl[i], clearS);
    if (!r || r.length < 2) continue;              // unreachable: skip it
    r[0] = route[route.length - 1];
    const leg = pullTight(sdfS, r, clearS, 0.5);
    for (let k = 1; k < leg.length; k++) route.push(leg[k]);
  }
  if (route.length < 2) return { pts: ctrl.slice(0, 2), minClear: -Infinity, ok: false };
  // knots every 1.5 m along the route, then the curve through them
  const K = resample(route, 1.5);
  const S = [];
  for (let i = 0; i < K.length - 1; i++) {
    const n = Math.max(2, Math.ceil(len(sub(K[i + 1], K[i])) / 0.1));
    for (let k = 0; k < n; k++) {
      const t = k / n, q = catmullAt(K, i, t);
      S.push(F.metres(q) >= TOUR_CLEAR + 0.05 ? q : lerp3(K[i], K[i + 1], t));
    }
  }
  S.push(K[K.length - 1].slice());
  let P = resample(S, 0.1);
  for (let pass = 0; pass < 4; pass++) {
    let bad = 0;
    for (let i = 0; i < P.length; i++) if (F.metres(P[i]) < TOUR_CLEAR + 0.02) { bad++; const q = F.pushOut(P[i], TOUR_CLEAR + 0.06); if (q) P[i] = q; }
    if (!bad) break;
    P = resample(P, 0.1);
  }
  // each sample has TOUR_CLEAR of water, and a trace at the TOUR_CLEAR
  // level along each segment finds no rock
  let minM = Infinity, maxStep = 0, segOk = true;
  for (let i = 0; i < P.length; i++) {
    const m = F.metres(P[i]); if (m < minM) minM = m;
    if (!i) continue;
    const d = sub(P[i], P[i - 1]), L = len(d); maxStep = Math.max(maxStep, L);
    if (L > 1e-6 && Number.isFinite(F.trace(P[i - 1], mul(d, 1 / L), L, TOUR_CLEAR))) segOk = false;
  }
  return { pts: P, minClear: minM, maxStep, ok: minM >= TOUR_CLEAR && segOk && maxStep <= 0.3 };
}
function pathApi(T) {
  const P = T.pts, n = P.length, cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + len(sub(P[i], P[i - 1]));
  T.len = cum[n - 1];
  T.at = (s) => {
    s = clamp(s, 0, T.len);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const L = cum[hi] - cum[lo] || 1;
    return lerp3(P[lo], P[hi], (s - cum[lo]) / L);
  };
  T.nearest = (p) => { let b = 0, bd = Infinity; for (let i = 0; i < n; i += 2) { const d = len(sub(P[i], p)); if (d < bd) { bd = d; b = i; } } return cum[b]; };
  return T;
}
// The tour list from rock.features (labels only; build(T) plans one).
export function tourList(rock) {
  const out = [];
  let nc = 0, na = 0;
  for (const f of rock.features || []) {
    if (f.kind === 'canyon' && f.path && f.path.length >= 2) { nc++; out.push({ id: 'canyon' + nc, kind: 'canyon', label: `Canyon ${nc}`, feature: f }); }
    else if (f.kind === 'arch' && f.axis && f.gap) { na++; out.push({ id: 'arch' + na, kind: 'arch', label: `Arch ${na}${f.type === 'bridge' ? ' (bridge)' : ''}`, feature: f }); }
  }
  return out;
}
export function tourControls(f) {
  if (f.kind === 'canyon') {
    // floor points every 2 m, 1.6 m up
    const fl = resample(f.path.map(p => p.slice()), 2).map(p => [p[0], p[1] + 1.6, p[2]]);
    const t0 = norm(sub(fl[1] || fl[0], fl[0])), t1 = norm(sub(fl[fl.length - 1], fl[fl.length - 2] || fl[0]));
    return [add(add(fl[0], mul(t0, -6)), [0, 7, 0]), add(add(fl[0], mul(t0, -2.5)), [0, 2.5, 0]), ...fl, add(add(fl[fl.length - 1], mul(t1, 3)), [0, 2.5, 0]), add(add(fl[fl.length - 1], mul(t1, 6)), [0, 7, 0])];
  }
  const a = norm([f.axis[0], 0, f.axis[2]]);
  const y = f.gap[0] + Math.min(1.6, Math.max(0.6, (f.gap[1] - f.gap[0]) * 0.45));
  const c = [f.center[0], y, f.center[2]], L = (f.size || 4) * 0.5 + 3;
  return [add(add(c, mul(a, -(L + 9))), [0, 6, 0]), add(add(c, mul(a, -(L + 3))), [0, 1.5, 0]), c, add(add(c, mul(a, L + 3)), [0, 1.5, 0]), add(add(c, mul(a, L + 9)), [0, 6, 0])];
}
// The free-water grid of the tours (rov/pilot.js createGrid on sdfAll).
export function tourGrid(rock, o = {}) {
  // an infinite world gives its own route maker (no plot grid)
  if (typeof rock.tourGrid === 'function') return rock.tourGrid(o);
  const R = rock.radius || 30, b = rock.bounds;
  return createGrid(rock.sdfAll || rock.sdf, { radius: R * 1.25, ymin: b ? b.min[1] : -3, ymax: (b ? b.max[1] : 10) + 9, cell: o.cell || 0.6 });
}
export function buildTour(rock, T, o = {}) {
  const F = o.field || createField(rock), grid = o.grid || tourGrid(rock);
  const f = T.feature, P = makePath(F, tourControls(f), grid, rock.sdfAll || rock.sdf);
  const out = pathApi(Object.assign({}, T, P));
  if (T.kind === 'arch') {
    const c = f.center;
    out.under = false;
    for (const p of out.pts) {
      if (Math.hypot(p[0] - c[0], p[2] - c[2]) > Math.max(1.5, (f.size || 4) * 0.35)) continue;
      if (Number.isFinite(F.trace(p, UP, Math.max(1, (f.top ?? p[1] + 6) - p[1] + 1), 0))) { out.under = true; break; }
    }
  }
  return out;
}
export function buildTours(rock, o = {}) {
  const F = o.field || createField(rock), grid = o.grid || tourGrid(rock, o);
  return tourList(rock).map(T => buildTour(rock, T, { field: F, grid }));
}

// ── the camera ──────────────────────────────────────────────────────────────
// o: rock, R (plot radius), fov, eye, look (start pose), field (optional)
export function createExploreCamera(o = {}) {
  let rock = o.rock || null, F = rock ? (o.field || createField(rock)) : null, R = o.R || 30;
  // the orbit distance limit: 3.5 R on a plot; o.maxDist on the infinite
  // world (R = Infinity, no plot bound)
  const maxD = () => Math.min(R * 3.5, o.maxDist ?? Infinity);
  let topY = rock && rock.bounds ? rock.bounds.max[1] : 8;
  const proj = { fov: o.fov || 50, aspect: 1, shift: [0, 0] };
  const eye0 = o.eye || [18, 12, 22], look0 = o.look || [0, 2, 0];
  const E = { x: eye0.slice(), v: [0, 0, 0] }, L = { x: look0.slice(), v: [0, 0, 0] };
  const goal = { eye: eye0.slice(), look: look0.slice() };
  const a0 = anglesOf(sub(eye0, look0));
  const orbit = { target: look0.slice(), yaw: a0.yaw, pitch: a0.pitch, dist: len(sub(eye0, look0)), wYaw: 0, wPitch: 0, pivot: null, grip: null, plane: null, auto: false };
  const swim = { pos: eye0.slice(), vel: [0, 0, 0], yaw: 0, pitch: 0, yawT: 0, pitchT: 0, speedK: 1, move: [0, 0, 0], boost: false };
  const tour = { T: null, s: 0, spd: 0, wait: true, look: null };
  const follow = { id: 1, dist: 3.4, yawOff: 0, pitchOff: 0.28, idle: 0, autoYaw: 0, autoPitch: 0, wantYaw: 0, wantPitch: 0, searchT: 0, snapNext: false, stuckT: 0, boomYaw: null, boomRate: 0, vYaw: 0, body: null };
  const saver = { eye: eye0.slice(), look: look0.slice(), omega: 2.2 };
  let mode = 'orbit', blend = 0, idle = 0, tours = null, grid = null;
  let lastGood = eye0.slice();
  const cam = {
    get mode() { return mode; }, orbit, swim, tour, chase: follow, proj,
    get followId() { return follow.id; },
    get eye() { return E.x; }, get look() { return L.x; }, goal,
    // the tour labels (no planning); buildTour plans one on demand
    tourList() { if (!tours && rock) tours = tourList(rock); return tours || []; },
    buildTour(id) {
      const T = cam.tourList().find(t => t.id === id); if (!T) return null;
      if (!T.pts) { if (!grid) grid = o.grid || tourGrid(rock); Object.assign(T, buildTour(rock, T, { field: F, grid })); }
      return T.ok ? T : null;
    },
    get field() { return F; },
    // the infinite world: its features move with the eye, so the page
    // asks for a new tour list from time to time
    refreshTours() { tours = null; grid = null; },
  };

  cam.setRock = (rk, r) => {
    rock = rk; F = rk ? createField(rk) : null; R = r || rk.radius || R; tours = null; grid = null;
    topY = rk && rk.bounds ? rk.bounds.max[1] : 8;
    if (F && F.metres(E.x) < CLEAR_HARD) E.x = F.escape(E.x, CLEAR_SOFT) || [E.x[0], topY + 6, E.x[2]];
    lastGood = E.x.slice();
  };
  cam.setProjection = (p) => { Object.assign(proj, p); };
  const pose = () => ({ eye: E.x, look: L.x });
  // the goal pose: in orbit, the orbit pose with no boom (so the zoom and
  // the pan keep their point under the pointer exactly)
  const goalPose = () => (mode === 'orbit' ? cam.orbitPose() : { eye: goal.eye, look: goal.look });
  cam.ray = (nx, ny, fromGoal) => rayAt(fromGoal ? goalPose() : pose(), proj, nx, ny);
  cam.pick = (nx, ny, fromGoal) => { if (!F) return null; const r = cam.ray(nx, ny, fromGoal); const h = F.pick(r.o, r.d); return h ? h.p : null; };
  cam.project = (p, fromGoal) => project(fromGoal ? goalPose() : pose(), proj, p);

  function setMode(m, opt = {}) {
    if (m === mode && !opt.force) return;
    const prev = mode;
    mode = m; blend = opt.snap ? 0 : 1.2;
    const f = norm(sub(L.x, E.x));
    if (m === 'orbit') {
      // the target: the rock ahead, or 8 m ahead
      let t = null;
      if (F) { const h = F.pick(E.x, f, 40); if (h) t = h.p; }
      if (!t) t = add(E.x, mul(f, 8));
      orbit.target = opt.target || t;
      const a = anglesOf(sub(E.x, orbit.target));
      orbit.yaw = a.yaw; orbit.pitch = clamp(a.pitch, -0.6, 1.45); orbit.dist = clamp(len(sub(E.x, orbit.target)), 0.8, maxD());
      orbit.wYaw = orbit.wPitch = 0;
    } else if (m === 'swim') {
      swim.pos = E.x.slice();
      const a = anglesOf(f);
      swim.yaw = swim.yawT = a.yaw; swim.pitch = swim.pitchT = clamp(a.pitch, -1.45, 1.45);
      swim.vel = opt.vel ? opt.vel.slice() : (prev === 'tour' && tour.T ? mul(f, tour.spd) : [0, 0, 0]);
      blend = 0;     // the swim starts at the eye: nothing to glide
    } else if (m === 'follow') {
      if (opt.id != null) follow.id = opt.id;
      follow.yawOff = 0; follow.pitchOff = 0.28; follow.idle = 0;
      follow.autoYaw = follow.autoPitch = follow.wantYaw = follow.wantPitch = 0;
      follow.searchT = 0; follow.stuckT = 0; follow.snapNext = !!opt.snap; follow.boomYaw = null; follow.boomRate = 0;
    } else if (m === 'saver') {
      saver.eye = E.x.slice(); saver.look = L.x.slice();
    }
  }
  cam.setMode = setMode;

  // ── orbit ─────────────────────────────────────────────────────────────────
  function orbitEye() { return add(orbit.target, mul(dirOf(orbit.yaw, orbit.pitch), orbit.dist)); }
  cam.frame = ({ target, dist, yaw, pitch, snap } = {}) => {
    if (mode !== 'orbit') setMode('orbit', { snap });
    if (target) orbit.target = target.slice();
    if (dist) orbit.dist = dist;
    if (yaw != null) orbit.yaw = yaw;
    if (pitch != null) orbit.pitch = pitch;
    orbit.wYaw = orbit.wPitch = 0;
    if (snap) cam.snap();
  };
  // Begin a turn: the pivot is the rock under the pointer (or the target).
  cam.orbitBegin = (nx, ny) => {
    orbit.wYaw = orbit.wPitch = 0; idle = 0;
    orbit.pivot = (nx != null && cam.pick(nx, ny)) || orbit.target.slice();
  };
  // A turn round the pivot by angles (rad): yaw round the vertical,
  // pitch round the view right axis. The target turns with the eye.
  function turn(dy, dp) {
    const P = orbit.pivot || orbit.target;
    const p1 = clamp(orbit.pitch + dp, -0.6, 1.45); dp = p1 - orbit.pitch;
    let v = sub(orbit.target, P);
    if (dp) {
      const d = dirOf(orbit.yaw, orbit.pitch), dd = [-Math.sin(orbit.pitch) * Math.cos(orbit.yaw), Math.cos(orbit.pitch), -Math.sin(orbit.pitch) * Math.sin(orbit.yaw)];
      v = rotate(v, norm(cross(d, dd)), dp);
    }
    if (dy) v = rotate(v, [0, -1, 0], dy);      // yaw grows from +x to +z: round -y
    orbit.target = add(P, v); orbit.yaw += dy; orbit.pitch = p1;
  }
  cam.turn = turn;
  cam.orbitRotate = (dxPx, dyPx, hPx = 800) => {
    if (mode !== 'orbit') return;
    const k = Math.PI * 1.1 / Math.max(200, hPx), dy = dxPx * k, dp = dyPx * k;
    turn(dy, dp); idle = 0;
    orbit.wYaw = orbit.wYaw * 0.5 + dy * 30; orbit.wPitch = orbit.wPitch * 0.5 + dp * 30;   // rad/s for the fling
  };
  cam.orbitEnd = () => { orbit.grip = null; orbit.plane = null; };
  cam.orbitStop = () => { orbit.wYaw = orbit.wPitch = 0; };
  // Zoom about the rock under the cursor: the eye and the target scale
  // about that point, so it stays under the cursor (on the goal pose).
  cam.zoomAt = (nx, ny, k) => {
    if (mode === 'follow') { follow.dist = clamp(follow.dist * k, 1.4, 14); return; }
    if (mode !== 'orbit') return;
    idle = 0;
    let P = nx != null ? cam.pick(nx, ny, true) : null;
    if (!P) { const r = cam.ray(nx ?? 0, ny ?? 0, true); P = add(r.o, mul(r.d, orbit.dist)); }
    const ge = orbitEye(), dP = len(sub(ge, P));
    k = clamp(k, 0.6 / Math.max(dP, 1e-3), maxD() / Math.max(orbit.dist, 1e-3));
    if (orbit.dist * k < 0.8) k = 0.8 / orbit.dist;
    orbit.target = add(P, mul(sub(orbit.target, P), k));
    orbit.dist *= k;
    goal.eye = orbitEye();
  };
  // Grab pan: the grip point stays under the pointer.
  cam.panBegin = (nx, ny) => {
    idle = 0; orbit.wYaw = orbit.wPitch = 0;
    const g = cam.pick(nx, ny, true);
    const r = cam.ray(nx, ny, true);
    orbit.grip = g || add(r.o, mul(r.d, orbit.dist));
    orbit.plane = norm(sub(goal.look, goal.eye));
  };
  cam.panMove = (nx, ny) => {
    if (mode !== 'orbit' || !orbit.grip) return;
    goal.eye = orbitEye(); goal.look = orbit.target.slice();
    const r = cam.ray(nx, ny, true), n = orbit.plane, den = dot(r.d, n);
    if (Math.abs(den) < 1e-4) return;
    const t = dot(sub(orbit.grip, r.o), n) / den;
    if (t <= 0) return;
    const hit = add(r.o, mul(r.d, t));
    let d = sub(orbit.grip, hit);
    const dl = len(d), cap = Math.max(4, orbit.dist * 0.6);
    if (dl > cap) d = mul(d, cap / dl);
    orbit.target = add(orbit.target, d);
    idle = 0;
  };
  // Two fingers: the midpoint grips (pan), the pinch zooms and the twist
  // turns round the grip.
  cam.gestureBegin = (nx, ny) => { cam.panBegin(nx, ny); orbit.pivot = orbit.grip ? orbit.grip.slice() : orbit.target.slice(); };
  cam.gesture = (nx, ny, scale, twist) => {
    if (mode === 'follow') { follow.dist = clamp(follow.dist / scale, 1.4, 14); follow.yawOff += twist; follow.idle = 0; return; }
    if (mode !== 'orbit') return;
    cam.panMove(nx, ny);
    if (twist) { orbit.pivot = orbit.grip; turn(-twist, 0); }
    if (scale && Math.abs(scale - 1) > 1e-4) cam.zoomAt(nx, ny, 1 / scale);
  };
  // Fly to the rock under a point: the orbit target goes there, closer.
  cam.flyTo = (nx, ny) => {
    const p = cam.pick(nx, ny);
    if (!p) return null;
    if (mode !== 'orbit') setMode('orbit');
    orbit.target = p; orbit.dist = clamp(orbit.dist * 0.45, 2.2, 9);
    orbit.wYaw = orbit.wPitch = 0;
    blend = 1.4;
    return p;
  };
  cam.orbitKeys = (mx, mz, zoom, dt) => {
    if (mode !== 'orbit') return;
    if (mx || mz) {
      const f = norm([-Math.cos(orbit.yaw), 0, -Math.sin(orbit.yaw)]), r = [-f[2], 0, f[0]];
      const sp = clamp(orbit.dist, 2, 60) * 0.8 * dt;
      orbit.target = add(orbit.target, add(mul(f, mz * sp), mul(r, mx * sp)));
      idle = 0;
    }
    if (zoom) { orbit.dist = clamp(orbit.dist * Math.exp(zoom * dt * 1.4), 0.8, maxD()); idle = 0; }
  };
  cam.setAutoRotate = (v) => { orbit.auto = !!v; };
  // the orbit pose with no boom and no push (for the zoom and pan tests)
  cam.orbitPose = () => ({ eye: orbitEye(), look: orbit.target.slice() });
  function orbitGoal(dt) {
    if (orbit.wYaw || orbit.wPitch) {
      const e = Math.exp(-dt * 4);
      if (!orbit.grip) turn(orbit.wYaw * dt, orbit.wPitch * dt);
      orbit.wYaw *= e; orbit.wPitch *= e;
      if (Math.abs(orbit.wYaw) + Math.abs(orbit.wPitch) < 1e-3) orbit.wYaw = orbit.wPitch = 0;
    }
    if (orbit.auto && idle > 2) { orbit.pivot = orbit.target; turn(dt * 0.08, 0); }
    let eye = orbitEye();
    // the boom: rock between the target and the eye pulls the eye in
    if (F) {
      const d = dirOf(orbit.yaw, orbit.pitch), s0 = Math.min(0.5, orbit.dist * 0.5), o0 = add(orbit.target, mul(d, s0));
      const t = F.trace(o0, d, orbit.dist - s0, CLEAR_SOFT * 0.8);
      if (Number.isFinite(t)) eye = add(o0, mul(d, Math.max(0, t - 0.05)));
      if (F.metres(eye) < CLEAR_SOFT) { const q = F.pushOut(eye, CLEAR_SOFT); if (q) eye = q; }
    }
    goal.eye = eye; goal.look = orbit.target.slice();
  }

  // ── swim ──────────────────────────────────────────────────────────────────
  // move [x strafe, y up, z forward] -1..1, look [dyaw, dpitch] rad
  cam.swimInput = (move, look, boost) => {
    if (move) swim.move = move;
    if (look && (look[0] || look[1])) { swim.yawT += look[0]; swim.pitchT = clamp(swim.pitchT + look[1], -1.45, 1.45); idle = 0; }
    swim.boost = !!boost;
    if (move && (move[0] || move[1] || move[2])) idle = 0;
  };
  cam.swimSpeed = (k) => { swim.speedK = clamp(swim.speedK * k, 0.25, 6); return swim.speedK; };
  function swimStep(dt) {
    const e = 1 - Math.exp(-dt * 16);
    swim.yaw += (swim.yawT - swim.yaw) * e; swim.pitch += (swim.pitchT - swim.pitch) * e;
    const f = dirOf(swim.yaw, swim.pitch), r = norm(cross(f, UP));
    const m = swim.move, sp = 1.6 * swim.speedK * (swim.boost ? 3 : 1);
    const want = mul(add(add(mul(r, m[0]), mul(UP, m[1])), mul(f, m[2])), sp);
    const k = 1 - Math.exp(-dt * (m[0] || m[1] || m[2] ? 3.5 : 2.2));
    for (let i = 0; i < 3; i++) swim.vel[i] += (want[i] - swim.vel[i]) * k;
    if (F) {
      // smooth contact: the speed into the rock fades out from CLEAR_SOFT
      // to CLEAR_HARD, and a soft push holds the eye at CLEAR_SOFT
      const c = F.metres(swim.pos);
      if (c < CLEAR_SOFT + 0.4) {
        const n = F.normal(swim.pos);
        if (n) {
          const u = clamp((c - CLEAR_HARD) / (CLEAR_SOFT + 0.4 - CLEAR_HARD), 0, 1), vn = dot(swim.vel, n);
          if (vn < 0) swim.vel = sub(swim.vel, mul(n, vn * (1 - u * u)));
          if (c < CLEAR_SOFT) swim.vel = add(swim.vel, mul(n, (CLEAR_SOFT - c) * 6 * dt));
        }
      }
      const next = F.moveSafe(swim.pos, add(swim.pos, mul(swim.vel, dt)), CLEAR_HARD + 0.05);
      // the speed that the rock took away is lost (no bounce)
      if (dt > 0) { const got = mul(sub(next, swim.pos), 1 / dt); if (len(got) < len(swim.vel) * 0.98) swim.vel = got; }
      swim.pos = next;
    } else swim.pos = add(swim.pos, mul(swim.vel, dt));
    bound(swim.pos);
    goal.eye = swim.pos.slice(); goal.look = add(swim.pos, mul(f, 4));
  }

  // ── tours ─────────────────────────────────────────────────────────────────
  cam.startTour = (id, opt = {}) => {
    const T = cam.buildTour(id);
    if (!T) return null;
    setMode('tour', { force: true });
    tour.T = T; tour.s = opt.resume ? T.nearest(E.x) : 0; tour.spd = 0; tour.wait = !opt.resume; tour.look = null; tour.done = false;
    blend = 0;
    return T;
  };
  cam.tourSpeed = 1.5;
  function tourStep(dt) {
    const T = tour.T; if (!T) { setMode('orbit'); return; }
    const p = T.at(tour.s);
    // the lead-in: wait at the start until the eye is near it
    if (tour.wait) {
      goal.eye = p; goal.look = T.at(tour.s + 4);
      if (len(sub(E.x, p)) < 1.2) tour.wait = false;
      tour.waitT = (tour.waitT || 0) + dt;
      if (tour.waitT > 8) tour.wait = false;
      return 2.0;
    }
    const left = T.len - tour.s, top = cam.tourSpeed * swim.speedK;
    const want = left < 4 ? top * Math.max(0.15, left / 4) : top;
    tour.spd += (want - tour.spd) * (1 - Math.exp(-dt * 0.9));
    tour.s = Math.min(T.len, tour.s + tour.spd * dt);
    const lk = T.at(tour.s + 3.5);
    tour.look = tour.look ? lerp3(tour.look, lk, 1 - Math.exp(-dt * 3)) : lk;
    goal.eye = T.at(tour.s); goal.look = tour.look;
    if (tour.s >= T.len - 0.05) { tour.done = true; setMode('orbit'); }
    return 8;
  }

  // ── follow ────────────────────────────────────────────────────────────────
  // getVehicle(id) -> { pos [x, y, z], yaw } (the ROV heading, from +x to +z)
  // opt.snap: cut to the boom on the next update (no glide from the old eye)
  cam.follow = (id, opt = {}) => setMode('follow', { id, force: true, snap: !!opt.snap });
  cam.followLook = (dyaw, dpitch) => { follow.yawOff += dyaw; follow.pitchOff = clamp(follow.pitchOff + dpitch, -0.9, 1.3); follow.idle = 0; };
  // The boom: the straight-back boom (with the free look) when it has
  // water for most of follow.dist, else the best of BOOM_YAW x BOOM_PITCH
  // offsets round the ROV (most water, least turn, near the last pick).
  // The search runs 4 times a second (10 when the boom is short); the
  // pick eases in.
  const BOOM_YAW = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.3, -2.3, Math.PI];
  const BOOM_PITCH = [0, 0.35, 0.75, 1.1];
  function boomLen(piv, d) {
    const t = F.trace(piv, d, follow.dist, CLEAR_SOFT * 0.8);
    return Number.isFinite(t) ? Math.max(0, t - 0.05) : follow.dist;
  }
  function pickBoom(piv, yaw0, pitch0) {
    let best = null;
    for (const dy of BOOM_YAW) for (const dp of BOOM_PITCH) {
      const p = clamp(pitch0 + dp, -0.9, 1.3);
      const l = boomLen(piv, dirOf(yaw0 + dy, p));
      const turn = Math.abs(dy - follow.autoYaw) + Math.abs(dp - follow.autoPitch);
      const score = (l / follow.dist) * 3 - Math.abs(dy) * 0.35 - dp * 0.3 - turn * 0.25;
      if (!best || score > best.score) best = { dy, dp, score };
    }
    return best;
  }
  function followGoal(dt, ctx) {
    const v = ctx && ctx.getVehicle ? ctx.getVehicle(follow.id) : null;
    if (!v) { setMode('orbit'); return; }
    follow.idle += dt;
    if (follow.idle > 3) { const e = 1 - Math.exp(-dt * 0.6); follow.yawOff -= follow.yawOff * e; follow.pitchOff += (0.28 - follow.pitchOff) * e; }
    const fw = [Math.cos(v.yaw), 0, Math.sin(v.yaw)];
    const yaw0 = v.yaw + Math.PI + follow.yawOff, pitch0 = follow.pitchOff;
    const piv = add(v.pos, [0, 0.35, 0]);
    if (F) {
      follow.searchT -= dt;
      const now = boomLen(piv, dirOf(yaw0 + follow.autoYaw, clamp(pitch0 + follow.autoPitch, -0.9, 1.3)));
      const back = boomLen(piv, dirOf(yaw0, pitch0));
      if (back >= follow.dist * 0.85) { follow.wantYaw = 0; follow.wantPitch = 0; }
      else if (follow.searchT <= 0 || follow.snapNext) {
        follow.searchT = now < follow.dist * 0.6 ? 0.1 : 0.25;
        const b = pickBoom(piv, yaw0, pitch0);
        follow.wantYaw = b.dy; follow.wantPitch = b.dp;
      }
      const e = follow.snapNext ? 1 : 1 - Math.exp(-dt * 2.2);
      follow.autoYaw += (follow.wantYaw - follow.autoYaw) * e;
      follow.autoPitch += (follow.wantPitch - follow.autoPitch) * e;
    }
    // the boom yaw follows the wanted yaw with a critically damped spring,
    // with a cap on its rate and on its acceleration: a fast ROV turn (or
    // a new pick) swings the eye round the ROV on the boom circle, not
    // through the vehicle
    const want = yaw0 + follow.autoYaw;
    if (follow.boomYaw == null || follow.snapNext) { follow.boomYaw = want; follow.boomRate = 0; }
    else {
      let d = (want - follow.boomYaw) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU;
      const w = 3.2, acc = clamp(w * w * d - 2 * w * follow.boomRate, -BOOM_ACC, BOOM_ACC);
      follow.boomRate = clamp(follow.boomRate + acc * dt, -BOOM_RATE, BOOM_RATE);
      follow.boomYaw += follow.boomRate * dt;
    }
    // the smoothed heading of the ROV (for the look point)
    follow.vYaw = follow.boomYaw - Math.PI - follow.yawOff - follow.autoYaw;
    follow.body = { c: v.pos, yaw: v.yaw, half: v.half || BODY_HALF };
    const dir = dirOf(follow.boomYaw, clamp(pitch0 + follow.autoPitch, -0.9, 1.3));
    // the boom is never shorter than the body + margin in its direction
    const minB = len(sub(bodyOut(piv, v.pos, v.yaw, dir, follow.body.half), piv));
    let eye = add(piv, mul(dir, follow.dist));
    if (F) {
      eye = add(piv, mul(dir, Math.max(minB, boomLen(piv, dir))));
      if (F.metres(eye) < CLEAR_SOFT) { const q = F.pushOut(eye, CLEAR_SOFT); if (q) eye = q; }
    }
    eye = bodyOut(eye, v.pos, v.yaw, dir, follow.body.half);
    const sfw = [Math.cos(follow.vYaw), 0, Math.sin(follow.vYaw)];
    goal.eye = eye; goal.look = add(v.pos, mul(sfw, 1.2 * Math.cos(follow.yawOff + follow.autoYaw)));
    return 4.5;
  }

  // ── saver ─────────────────────────────────────────────────────────────────
  cam.saverGoal = (pos, look, cut) => {
    if (mode !== 'saver') setMode('saver', { snap: true });
    saver.eye = pos.slice(); saver.look = look.slice();
    if (cut) {
      let p = pos.slice();
      if (F && F.metres(p) < CLEAR_HARD) p = F.escape(p, CLEAR_HARD + 0.05) || lastGood.slice();
      E.x = p; L.x = look.slice(); E.v = [0, 0, 0]; L.v = [0, 0, 0]; lastGood = E.x.slice();
    }
  };

  // ── bounds and the update ─────────────────────────────────────────────────
  function bound(p) {
    const r = Math.hypot(p[0], p[2]), rm = R * 1.35;
    if (r > rm) { p[0] *= rm / r; p[2] *= rm / r; }
    if (p[1] > topY + 45) p[1] = topY + 45;
    return p;
  }
  cam.snap = () => {
    if (mode === 'orbit') orbitGoal(0);
    let p = goal.eye.slice();
    if (F && F.metres(p) < CLEAR_HARD) p = F.escape(p, CLEAR_SOFT) || lastGood.slice();
    E.x = p; L.x = goal.look.slice(); E.v = [0, 0, 0]; L.v = [0, 0, 0];
    lastGood = E.x.slice();
  };
  cam.noteInput = () => { idle = 0; };
  cam.takeOver = () => { if (mode === 'tour') setMode('swim'); };
  // ctx: { getVehicle(id) } for follow
  cam.update = (dt, ctx) => {
    dt = clamp(dt || 0, 0, 0.25);
    idle += dt;
    let omega = 10;
    if (mode === 'orbit') { orbitGoal(dt); omega = 9; }
    else if (mode === 'swim') { swimStep(dt); omega = 40; }
    else if (mode === 'tour') omega = tourStep(dt) || 8;
    else if (mode === 'follow') omega = followGoal(dt, ctx) || 4.5;
    else if (mode === 'saver') { goal.eye = saver.eye.slice(); goal.look = saver.look.slice(); omega = saver.omega; }
    if (mode === 'orbit' && !F) { /* no rock yet */ }
    // a mode change: a slow spring for the glide
    if (blend > 0) { const u = blend / 1.2; omega = Math.min(omega, 2.6 + (omega - 2.6) * (1 - Math.min(1, u))); blend -= dt; }
    const prev = E.x.slice();
    spring3(E, goal.eye, omega, dt); spring3(L, goal.look, omega * 1.25, dt);
    bound(E.x);
    if (F) {
      const q = F.moveSafe(prev, E.x, CLEAR_HARD);
      if (q !== prev && F.metres(q) >= CLEAR_HARD) { E.x = q; lastGood = q.slice(); }
      else if (F.metres(E.x) >= CLEAR_HARD && !Number.isFinite(F.trace(prev, norm(sub(E.x, prev)), len(sub(E.x, prev)), CLEAR_HARD))) lastGood = E.x.slice();
      else { E.x = (F.metres(prev) >= CLEAR_HARD ? prev : lastGood).slice(); E.v = [0, 0, 0]; }
      // follow: rock between the eye and the boom holds the eye at the
      // rock (moveSafe slides, the glide stops). After 0.4 s of that, or
      // on a snap, cut to the boom eye (it has water by pickBoom).
      if (mode === 'follow') {
        const far = len(sub(goal.eye, E.x)) > 0.6, moved = len(sub(E.x, prev)) / Math.max(dt, 1e-3);
        follow.stuckT = far && moved < 0.4 ? follow.stuckT + dt : 0;
        if ((follow.snapNext || follow.stuckT > 0.4) && F.metres(goal.eye) >= CLEAR_HARD) {
          E.x = goal.eye.slice(); L.x = goal.look.slice(); E.v = [0, 0, 0]; L.v = [0, 0, 0];
          lastGood = E.x.slice(); follow.stuckT = 0; blend = 0;
        }
        follow.snapNext = false;
      }
    }
    // follow: the eye stays out of the ROV body (+ margin). An eye in the
    // shell, or a move that crosses the body, goes out from the body
    // centre on the side the eye came from: round the vehicle, not
    // through it. Rock wins: a point in rock keeps the last eye.
    if (mode === 'follow' && follow.body) {
      const B = follow.body;
      let cross = false;
      for (let k = 1; k <= 4 && !cross; k++) if (bodySdf(lerp3(prev, E.x, k / 4), B.c, B.yaw, B.half) < BODY_MARGIN) cross = true;
      if (cross) {
        const away = sub(prev, B.c);
        const q = bodyOut(bodySdf(E.x, B.c, B.yaw, B.half) < BODY_MARGIN ? E.x : lerp3(prev, E.x, 0.5), B.c, B.yaw, away, B.half);
        const q2 = bodySdf(q, B.c, B.yaw, B.half) >= BODY_MARGIN - 1e-3 ? q : bodyOut(add(B.c, away), B.c, B.yaw, away, B.half);
        if (!F || F.metres(q2) >= CLEAR_HARD) { E.x = q2; lastGood = q2.slice(); }
      }
    }
    if (len(sub(L.x, E.x)) < 0.05) L.x = add(E.x, dirOf(swim.yaw, swim.pitch));
    return cam;
  };
  // Copy the pose to a three.js camera.
  cam.apply = (c) => { c.position.set(E.x[0], E.x[1], E.x[2]); c.up.set(0, 1, 0); c.lookAt(L.x[0], L.x[1], L.x[2]); };
  cam.clearance = () => (F ? F.metres(E.x) : Infinity);
  cam.TAU = TAU;
  return cam;
}
