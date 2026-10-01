// ============================================================================
//  SDF FORGE  ·  camera.js — orbit cameras and the pane projection
// ----------------------------------------------------------------------------
//  PURE. A camera is { target, yaw, pitch, dist, fov } and nothing else.
//  ORTHOGRAPHIC IS A PROPERTY OF THE PANE, NEVER OF THE CAMERA (Forge
//  convention). The parallel film half-height is DERIVED from the camera:
//  H = dist * tan(fov / 2), so a dolly zooms both projections the same way
//  and the two numbers cannot drift apart.
//
//  The VERTICAL half-extent drives both screen axes, so a pane of any shape
//  keeps its aspect, and the shader, the picking and the gizmo all divide by
//  the same number.
//
//  GREP MAP
//    VIEWS ............ yaw and pitch of the named views (TOP, FRONT, ...)
//    basis ............ eye, right, up, forward
//    projection ....... ray(sx, sy), project(p), worldPerPx(p) for one pane
//    orbit / pan / dolly / frameBounds / viewFromDir
// ============================================================================
import * as V from './math.js';

export const ORTHO_BACK = 400;   // an ortho ray starts this far behind the target
export const VIEWS = {
  top: { yaw: 0, pitch: 90 }, bottom: { yaw: 0, pitch: -90 },
  front: { yaw: 0, pitch: 0 }, back: { yaw: 180, pitch: 0 },
  left: { yaw: -90, pitch: 0 }, right: { yaw: 90, pitch: 0 },
  persp: { yaw: 38, pitch: 28 }, iso: { yaw: 45, pitch: 35.264 },
};
export function makeCam(view = 'persp', o = {}) {
  const v = VIEWS[view] || VIEWS.persp;
  return { target: [0, 0.6, 0], yaw: v.yaw, pitch: v.pitch, dist: 13, fov: 40, ...o };
}
export function basis(c) {
  const y = c.yaw * V.DEG, p = c.pitch * V.DEG;
  const dir = [Math.cos(p) * Math.sin(y), Math.sin(p), Math.cos(p) * Math.cos(y)];   // target to eye
  const fwd = V.scale(dir, -1);
  // right comes from the yaw alone, so the pole (TOP, BOTTOM) is well defined
  const right = [Math.cos(y), 0, -Math.sin(y)];
  const up = V.cross(right, fwd);
  return { eye: V.add(c.target, V.scale(dir, c.dist)), right, up, fwd, dir };
}

// One pane's projection. w and h are the pane size in CSS pixels.
export function projection(c, w, h, ortho) {
  const B = basis(c), tan = Math.tan(c.fov * V.DEG / 2);
  const H = ortho ? c.dist * tan : 0;
  const eye = ortho ? V.sub(c.target, V.scale(B.fwd, ORTHO_BACK)) : B.eye;
  const P = {
    ...B, eye, tan, H, w, h, ortho: !!ortho, cam: c,
    ndc(sx, sy) { return [(2 * sx - w) / h, (h - 2 * sy) / h]; },
    ray(sx, sy) {
      const [nx, ny] = P.ndc(sx, sy);
      if (ortho) return { o: V.add(eye, V.add(V.scale(B.right, nx * H), V.scale(B.up, ny * H))), d: B.fwd };
      return { o: eye, d: V.norm(V.add(B.fwd, V.add(V.scale(B.right, nx * tan), V.scale(B.up, ny * tan)))) };
    },
    // world point to [sx, sy, depth]; null behind the eye
    project(p) {
      const r = V.sub(p, eye), z = V.dot(r, B.fwd);
      if (!ortho && z < 1e-4) return null;
      const s = ortho ? H : z * tan;
      return [(V.dot(r, B.right) / s * h + w) / 2, (h - V.dot(r, B.up) / s * h) / 2, z];
    },
    worldPerPx(p) {
      if (ortho) return 2 * H / h;
      const z = Math.max(1e-3, V.dot(V.sub(p, eye), B.fwd));
      return 2 * z * tan / h;
    },
  };
  return P;
}

export function orbit(c, dx, dy) {
  c.yaw -= dx * 0.4;
  c.pitch = V.clamp(c.pitch + dy * 0.4, -89.5, 89.5);
}
export function pan(c, P, dx, dy) {
  const k = P.worldPerPx(c.target);
  c.target = V.add(c.target, V.add(V.scale(P.right, -dx * k), V.scale(P.up, dy * k)));
}
// Dolly toward the point under the cursor: the point keeps its place on screen.
export function dolly(c, P, sx, sy, f) {
  const r = P.ray(sx, sy);
  // the point on the plane through the target facing the camera
  const n = P.fwd, den = V.dot(r.d, n);
  let hit = c.target;
  if (Math.abs(den) > 1e-4) { const t = V.dot(V.sub(c.target, r.o), n) / den; if (t > 0 || P.ortho) hit = V.add(r.o, V.scale(r.d, t)); }
  const nd = V.clamp(c.dist * f, 0.05, 2000);
  const real = nd / c.dist;
  c.target = V.add(hit, V.scale(V.sub(c.target, hit), real));
  c.dist = nd;
}
// aspect: pane width over height; a narrow pane fits the width instead.
export function frameBounds(c, b, fill = 1.15, aspect = 1) {
  if (!b) return;
  const ctr = V.scale(V.add(b.lo, b.hi), 0.5);
  const r = Math.max(0.3, V.len(V.sub(b.hi, b.lo)) / 2);
  const half = c.fov * V.DEG / 2, hh = Math.atan(Math.tan(half) * Math.min(1, aspect));
  c.target = ctr;
  c.dist = r * fill / Math.sin(hh);
}
// The yaw and pitch that look along -dir (dir points from the target to the eye).
export function viewFromDir(dir, keepYaw = 0) {
  const d = V.norm(dir);
  const pitch = Math.asin(V.clamp(d[1], -1, 1)) / V.DEG;
  const flat = Math.hypot(d[0], d[2]);
  const yaw = flat < 1e-6 ? keepYaw : Math.atan2(d[0], d[2]) / V.DEG;
  return { yaw, pitch };
}
