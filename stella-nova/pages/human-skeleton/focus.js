// ============================================================================
//  HUMAN SKELETON  ·  focus.js — mesh ray picks, bone framing, the flight
// ────────────────────────────────────────────────────────────────────────────
//  No DOM and no THREE, so tests.mjs and tests-focus.mjs run it in Node on
//  the shipped meshes. Vectors are plain [x, y, z] arrays.
//
//  PICK    A ray goes into the rest frame of each bone: the vertex shader
//          does p' = rot(q, p - c) + c + off (render.js), so the ray takes
//          the inverse of that move. A sphere test and a box test (the
//          bone box in its rest frame) stop most bones before the
//          triangle test (Moller-Trumbore, both faces). The nearest
//          triangle hit wins. With no hit, a vertex near the ray (inside
//          the angle tol, for thin bones) gives the bone.
//          Two sets: solid bones take the tol, ghost bones take only a
//          direct hit, and only when the ray misses every solid bone.
//  FRAME   The camera distance puts the bounding sphere of the bone at
//          FILL of the short side of the clear part of the view.
//  VIEW    chooseView keeps the present view direction when the line of
//          sight to the bone and the flight path cross no other bone. Else
//          it tries other directions (turns round the up axis, outward
//          from the body axis, from above) and takes the lowest score.
//  FLIGHT  flightPose eases the target in a line, turns the direction on
//          the great circle and changes the distance on a log scale, so
//          the zoom has the same speed at each scale (no lunge).
//
//  GREP MAP
//    export const FILL / FLY_S / TAP_PX                tuning
//    export function qrot / qinv                       quaternion helpers
//    export function meshIndex                         rest box, sphere of a bone
//    export function boneHit / boneNear                one bone, one ray
//    export function pickBones                         nearest bone on a ray
//    export function crossings                         bones a segment crosses
//    export function frameDistance                     distance for FILL
//    export function flightPose / slerpDir             the camera flight
//    export function viewCandidates / chooseView       a clear direction
//    export function pressKind                         tap, drag or long press
//    export function regionStep                        previous / next in a region
// ============================================================================

// The bounding sphere fills this share of the short side of the clear part.
export const FILL = 0.6;
// The flight time in seconds.
export const FLY_S = 1.0;
// Pointer travel (CSS px) and time (ms) that make a press a drag or a long press.
export const TAP_PX = { mouse: 5, touch: 10, longMs: 480, tapMs: 600 };

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const nrm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// v + 2 cross(q.xyz, cross(q.xyz, v) + w v), as the vertex shader does
export function qrot(q, v) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const t0 = y * v[2] - z * v[1] + w * v[0], t1 = z * v[0] - x * v[2] + w * v[1], t2 = x * v[1] - y * v[0] + w * v[2];
  return [v[0] + 2 * (y * t2 - z * t1), v[1] + 2 * (z * t0 - x * t2), v[2] + 2 * (x * t1 - y * t0)];
}
export const qinv = q => [-q[0], -q[1], -q[2], q[3]];

// The rest box and the bounding sphere of one bone, from its range in a
// decoded group (decode.js decodeGroup: pos, idx, ranges).
export function meshIndex(pos, idx, r) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = r.v0; v < r.v0 + r.nv; v++) for (let k = 0; k < 3; k++) { const x = pos[v * 3 + k]; if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; }
  const mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  let rad = 0;
  for (let v = r.v0; v < r.v0 + r.nv; v++) rad = Math.max(rad, Math.hypot(pos[v * 3] - mid[0], pos[v * 3 + 1] - mid[1], pos[v * 3 + 2] - mid[2]));
  return { pos, idx, v0: r.v0, nv: r.nv, t0: r.t0, nt: r.nt, lo, hi, mid, rad };
}

// The ray in the rest frame of a bone. pose: { c, off, q } (c the turn
// centre, off the move, q the turn), as in the BoneState texture.
function toRest(o, d, pose) {
  const qi = qinv(pose.q), c = pose.c, off = pose.off;
  const lo = qrot(qi, [o[0] - c[0] - off[0], o[1] - c[1] - off[1], o[2] - c[2] - off[2]]);
  return { o: [lo[0] + c[0], lo[1] + c[1], lo[2] + c[2]], d: qrot(qi, d) };
}
// The span [t0, t1] of the ray inside the box grown by m, or null.
function slab(o, d, lo, hi, m, tMax) {
  let t0 = 0, t1 = tMax;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-12) { if (o[k] < lo[k] - m || o[k] > hi[k] + m) return null; continue; }
    let a = (lo[k] - m - o[k]) / d[k], b = (hi[k] + m - o[k]) / d[k];
    if (a > b) { const s = a; a = b; b = s; }
    if (a > t0) t0 = a; if (b < t1) t1 = b;
    if (t0 > t1) return null;
  }
  return [t0, t1];
}
// The sphere test in world space. The sphere centre moves with the bone.
function sphereSpan(o, d, mi, pose, m, tMax) {
  const c = pose.c, s = qrot(pose.q, [mi.mid[0] - c[0], mi.mid[1] - c[1], mi.mid[2] - c[2]]);
  const w = [s[0] + c[0] + pose.off[0] - o[0], s[1] + c[1] + pose.off[1] - o[1], s[2] + c[2] + pose.off[2] - o[2]];
  const tc = dot(w, d), e2 = dot(w, w) - tc * tc, r = mi.rad + m;
  if (e2 > r * r) return false;
  const h = Math.sqrt(r * r - e2);
  return tc + h >= 0 && tc - h <= tMax;
}

// The nearest triangle hit of one bone (t along the unit ray d), or Infinity.
export function boneHit(mi, pose, o, d, tMax = Infinity) {
  if (!sphereSpan(o, d, mi, pose, 0, tMax)) return Infinity;
  const r = toRest(o, d, pose);
  if (!slab(r.o, r.d, mi.lo, mi.hi, 1e-6, tMax)) return Infinity;
  const P = mi.pos, I = mi.idx, ox = r.o[0], oy = r.o[1], oz = r.o[2], dx = r.d[0], dy = r.d[1], dz = r.d[2];
  let best = tMax;
  for (let t = mi.t0; t < mi.t0 + mi.nt; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ax = P[a], ay = P[a + 1], az = P[a + 2];
    const e1x = P[b] - ax, e1y = P[b + 1] - ay, e1z = P[b + 2] - az;
    const e2x = P[c] - ax, e2y = P[c + 1] - ay, e2z = P[c + 2] - az;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-14 && det < 1e-14) continue;
    const inv = 1 / det, sx = ox - ax, sy = oy - ay, sz = oz - az;
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (tt > 1e-7 && tt < best) best = tt;
  }
  return best < tMax ? best : Infinity;
}
// The vertex of one bone nearest the ray in angle, when the angle is under
// tol (tan of the angle from the ray origin). { a, t } or null.
export function boneNear(mi, pose, o, d, tol) {
  const c = pose.c, s = qrot(pose.q, [mi.mid[0] - c[0], mi.mid[1] - c[1], mi.mid[2] - c[2]]);
  const far = len([s[0] + c[0] + pose.off[0] - o[0], s[1] + c[1] + pose.off[1] - o[1], s[2] + c[2] + pose.off[2] - o[2]]) + mi.rad;
  const m = tol * far;
  if (!sphereSpan(o, d, mi, pose, m, Infinity)) return null;
  const r = toRest(o, d, pose);
  if (!slab(r.o, r.d, mi.lo, mi.hi, m, Infinity)) return null;
  const P = mi.pos;
  let best = null;
  for (let v = mi.v0; v < mi.v0 + mi.nv; v++) {
    const wx = P[v * 3] - r.o[0], wy = P[v * 3 + 1] - r.o[1], wz = P[v * 3 + 2] - r.o[2];
    const t = wx * r.d[0] + wy * r.d[1] + wz * r.d[2];
    if (t <= 1e-6) continue;
    const e = Math.sqrt(Math.max(0, wx * wx + wy * wy + wz * wz - t * t)), a = e / t;
    if (a <= tol && (!best || a < best.a)) best = { a, t };
  }
  return best;
}

// The bone under the ray. opts: { n, mesh(i) -> meshIndex or null,
// pose(i) -> { c, off, q }, solid(i), ghost(i), tol }. The solid bones go
// first: the nearest triangle hit, else the nearest vertex inside tol.
// Then the ghost bones, a direct hit only. { i, t, exact, ghost } or null.
export function pickBones(o, d, opts) {
  d = nrm(d);
  let bi = -1, bt = Infinity;
  for (let i = 0; i < opts.n; i++) {
    if (!opts.solid(i)) continue;
    const mi = opts.mesh(i); if (!mi) continue;
    const t = boneHit(mi, opts.pose(i), o, d, bt);
    if (t < bt) { bt = t; bi = i; }
  }
  if (bi >= 0) return { i: bi, t: bt, exact: true, ghost: false };
  if (opts.tol > 0) {
    let ba = Infinity, bn = null;
    for (let i = 0; i < opts.n; i++) {
      if (!opts.solid(i)) continue;
      const mi = opts.mesh(i); if (!mi) continue;
      const h = boneNear(mi, opts.pose(i), o, d, opts.tol);
      // a near miss: the smaller angle wins, and at the same angle the nearer
      if (h && (h.a < ba - 1e-9 || (Math.abs(h.a - ba) <= 1e-9 && h.t < bn.t))) { ba = h.a; bn = { i, t: h.t, exact: false, ghost: false }; }
    }
    if (bn) return bn;
  }
  if (opts.ghost) {
    for (let i = 0; i < opts.n; i++) {
      if (!opts.ghost(i)) continue;
      const mi = opts.mesh(i); if (!mi) continue;
      const t = boneHit(mi, opts.pose(i), o, d, bt);
      if (t < bt) { bt = t; bi = i; }
    }
    if (bi >= 0) return { i: bi, t: bt, exact: true, ghost: true };
  }
  return null;
}

// The number of bones (opts.solid, but not skip) whose triangles the segment
// a -> b crosses.
export function crossings(a, b, opts, skip = -1) {
  const v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = len(v);
  if (L < 1e-9) return 0;
  const d = [v[0] / L, v[1] / L, v[2] / L];
  let n = 0;
  for (let i = 0; i < opts.n; i++) {
    if (i === skip || !opts.solid(i)) continue;
    const mi = opts.mesh(i); if (!mi) continue;
    if (boneHit(mi, opts.pose(i), a, d, L) < Infinity) n++;
  }
  return n;
}

// The camera distance that puts a sphere of radius r at `fill` of the short
// side of the clear part. fy: tan of half the vertical field of view. clear:
// { x0, x1, y0, y1, h } in CSS px (the view offset centres the view in it).
export function frameDistance(r, fy, clear, fill = FILL, minD = 0) {
  const s = fy * Math.max(1, Math.min(clear.x1 - clear.x0, clear.y1 - clear.y0)) / Math.max(1, clear.h);
  return Math.max(minD, r / Math.sin(Math.atan(fill * s)));
}
// The share of the clear short side that the sphere fills from distance d.
export function sphereFill(r, d, fy, clear) {
  const s = fy * Math.max(1, Math.min(clear.x1 - clear.x0, clear.y1 - clear.y0)) / Math.max(1, clear.h);
  return Math.tan(Math.asin(Math.min(1, r / d))) / s;
}

// Unit vector a to unit vector b, along the great circle, at k (0..1).
export function slerpDir(a, b, k) {
  const c = Math.max(-1, Math.min(1, dot(a, b)));
  if (c > 0.9999) return nrm([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
  let ax = crs(a, b);
  if (len(ax) < 1e-6) { ax = crs(a, [0, 1, 0]); if (len(ax) < 1e-6) ax = crs(a, [1, 0, 0]); }
  ax = nrm(ax);
  const th = Math.acos(c) * k, cs = Math.cos(th), sn = Math.sin(th), p = crs(ax, a), ad = dot(ax, a);
  return nrm([a[0] * cs + p[0] * sn + ax[0] * ad * (1 - cs), a[1] * cs + p[1] * sn + ax[1] * ad * (1 - cs), a[2] * cs + p[2] * sn + ax[2] * ad * (1 - cs)]);
}
// sine ease in and out: no speed at the two ends, a peak of pi/2 x the mean
const easeIO = t => 0.5 - 0.5 * Math.cos(Math.PI * t);
// The camera at k (0..1) of a flight f = { t0, t1, u0, u1, r0, r1 }: the
// target in a line, the direction on the great circle, the distance on a
// log scale. Returns { target, pos }.
export function flightPose(f, k) {
  const e = easeIO(Math.max(0, Math.min(1, k)));
  const target = [f.t0[0] + (f.t1[0] - f.t0[0]) * e, f.t0[1] + (f.t1[1] - f.t0[1]) * e, f.t0[2] + (f.t1[2] - f.t0[2]) * e];
  const u = slerpDir(f.u0, f.u1 || f.u0, e);
  const r = f.r0 > 0 && f.r1 > 0 ? f.r0 * Math.pow(f.r1 / f.r0, e) : f.r0 + (f.r1 - f.r0) * e;
  return { target, pos: [target[0] + u[0] * r, target[1] + u[1] * r, target[2] + u[2] * r], u, r };
}

// The directions to try, the present one first: turns round the up axis,
// outward from the body axis (x, z of the bone centre), and from above.
export function viewCandidates(u0, c) {
  const out = [u0.slice()];
  const yaw = (u, a) => { const cs = Math.cos(a), sn = Math.sin(a); return nrm([u[0] * cs + u[2] * sn, u[1], -u[0] * sn + u[2] * cs]); };
  for (const deg of [35, -35, 70, -70, 110, -110, 180]) out.push(yaw(u0, deg * Math.PI / 180));
  const h = Math.hypot(c[0], c[2]);
  if (h > 0.02) out.push(nrm([c[0] / h, 0.25, c[2] / h]));
  out.push(nrm([u0[0] * 0.5, 1.2, u0[2] * 0.5 + 0.3]));
  return out;
}
// A clear view of the bone. o: { u0, t0, r0, c (bone centre), d (distance),
// i (the bone), cast: the crossings opts, samples }. Each direction scores
// the bones on the line of sight, plus the bones that the flight path
// crosses, plus 0.4 per radian of turn from u0. A clear present direction
// returns at once. { u, score, los, path }
export function chooseView(o) {
  const samples = o.samples || 6;
  let best = null;
  for (const u of viewCandidates(o.u0, o.c)) {
    const end = [o.c[0] + u[0] * o.d, o.c[1] + u[1] * o.d, o.c[2] + u[2] * o.d];
    const los = crossings(end, o.c, o.cast, o.i);
    let path = 0, prev = null;
    const f = { t0: o.t0, t1: o.c, u0: o.u0, u1: u, r0: o.r0, r1: o.d };
    for (let k = 0; k <= samples; k++) {
      const p = flightPose(f, k / samples).pos;
      if (prev) path += crossings(prev, p, o.cast, o.i);
      prev = p;
    }
    const turn = Math.acos(Math.max(-1, Math.min(1, dot(u, o.u0))));
    const score = los + path + 0.4 * turn;
    if (!best || score < best.score) best = { u, score, los, path };
    if (turn < 1e-9 && los + path === 0) return best;
  }
  return best;
}

// A press: 'tap', 'drag' (it moved, or two fingers), or 'long' (held).
// down/up: { x, y, t }, moved: the largest travel in the press (CSS px).
export function pressKind(down, up, moved, touch, multi = false) {
  const lim = touch ? TAP_PX.touch : TAP_PX.mouse;
  if (multi || Math.max(moved, Math.hypot(up.x - down.x, up.y - down.y)) > lim) return 'drag';
  const dt = up.t - down.t;
  if (dt >= TAP_PX.longMs) return touch ? 'long' : dt > TAP_PX.tapMs ? 'drag' : 'tap';
  return 'tap';
}

// The previous or next shown bone in the region of bone i, in list order.
export function regionStep(bones, vis, i, dir) {
  const b = bones[i];
  if (!b) return -1;
  const list = bones.filter(x => x.region === b.region && vis[x.i]).map(x => x.i);
  if (!list.length) return -1;
  const k = list.indexOf(i);
  return list[(k < 0 ? 0 : k + dir + list.length) % list.length];
}
