// ============================================================================
//  BREADBOARD LAB  ·  view/picking.js — rays, planes and holes (pure)
// ----------------------------------------------------------------------------
//  Holes are not meshes that the raycaster tests one by one: there are up to
//  830 per board. A pick intersects the ray with the top plane of each board
//  (y = 8.5), and core/space.js finds the hole near the hit in O(1). Socket
//  pins and lead tips are points: a pick measures the distance from the ray.
//
//  A camera here is plain data { pos, target, up?, fov (deg, vertical),
//  aspect }, so node tests can pick without THREE. scene.js builds the same
//  data from its THREE camera.
//
//  GREP MAP
//    cameraBasis ........ forward / right / up of a look-at camera
//    ndcFromClient ...... client px → normalized device coords (view offset)
//    clientFromNdc ...... the inverse
//    insetViewOffset .... the view offset that centres the free band
//    rayFromCamera ...... a world ray through an NDC point
//    rayPlaneY .......... hit of the ray with a horizontal plane
//    rayPointDistance ... closest distance of a point to the ray
//    projectPoint ....... world → NDC and client px
//    pickBench .......... board top hit → hole, else the mat point
//    pickPoints ......... nearest of a set of points within a radius
// ============================================================================
import { BOARD_H, boardHit, nearestHoleInfo } from '../core/space.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function cameraBasis(cam) {
  const f = norm(sub(cam.target, cam.pos));
  let up = cam.up || [0, 1, 0];
  let r = cross(f, up);
  if (Math.hypot(r[0], r[1], r[2]) < 1e-6) { up = [0, 0, -1]; r = cross(f, up); }
  r = norm(r);
  const u = cross(r, f);
  return { f, r, u };
}

// view: an optional camera view offset (THREE camera.view: fullWidth,
// fullHeight, offsetX, offsetY, width, height, enabled). With it the canvas
// shows a window of a larger image, so a client pixel maps into that image.
export function ndcFromClient(clientX, clientY, rect, view = null) {
  if (!view || view.enabled === false) return { x: ((clientX - rect.left) / rect.width) * 2 - 1, y: -(((clientY - rect.top) / rect.height) * 2 - 1) };
  const sx = (clientX - rect.left) / rect.width * view.width + view.offsetX;
  const sy = (clientY - rect.top) / rect.height * view.height + view.offsetY;
  return { x: sx / view.fullWidth * 2 - 1, y: -(sy / view.fullHeight * 2 - 1) };
}
// the inverse: NDC of the full image → client px
export function clientFromNdc(nx, ny, rect, view = null) {
  if (!view || view.enabled === false) return { x: rect.left + (nx + 1) / 2 * rect.width, y: rect.top + (1 - ny) / 2 * rect.height };
  const sx = (nx + 1) / 2 * view.fullWidth - view.offsetX, sy = (1 - ny) / 2 * view.fullHeight - view.offsetY;
  return { x: rect.left + sx / view.width * rect.width, y: rect.top + sy / view.height * rect.height };
}
// The view offset that puts the image centre (the camera target) in the
// middle of the band the panels leave free. insets in px: left, right, top,
// bottom. null when there is nothing to move.
export function insetViewOffset(ins, w, h) {
  const ox = -((ins.left || 0) - (ins.right || 0)) / 2, oy = -((ins.top || 0) - (ins.bottom || 0)) / 2;
  if (Math.abs(ox) < 0.5 && Math.abs(oy) < 0.5) return null;
  return { enabled: true, fullWidth: w, fullHeight: h, offsetX: ox, offsetY: oy, width: w, height: h };
}

export function rayFromCamera(cam, nx, ny) {
  const { f, r, u } = cameraBasis(cam);
  const th = Math.tan((cam.fov * Math.PI / 180) / 2);
  const a = cam.aspect || 1;
  const d = norm([
    f[0] + r[0] * nx * th * a + u[0] * ny * th,
    f[1] + r[1] * nx * th * a + u[1] * ny * th,
    f[2] + r[2] * nx * th * a + u[2] * ny * th,
  ]);
  return { o: cam.pos.slice(), d };
}

export function rayPlaneY(ray, y) {
  if (Math.abs(ray.d[1]) < 1e-9) return null;
  const t = (y - ray.o[1]) / ray.d[1];
  if (t <= 0) return null;
  return { x: ray.o[0] + ray.d[0] * t, y, z: ray.o[2] + ray.d[2] * t, t };
}

export function rayPointDistance(ray, p) {
  const v = sub(p, ray.o);
  const t = Math.max(0, dot(v, ray.d));
  const c = [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t];
  return { d: Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]), t };
}

export function projectPoint(cam, p, rect, view = null) {
  const { f, r, u } = cameraBasis(cam);
  const v = sub(p, cam.pos);
  const z = dot(v, f);
  if (z <= 1e-6) return null;
  const th = Math.tan((cam.fov * Math.PI / 180) / 2);
  const nx = dot(v, r) / (z * th * (cam.aspect || 1));
  const ny = dot(v, u) / (z * th);
  const out = { nx, ny, depth: z };
  if (rect) { const c = clientFromNdc(nx, ny, rect, view); out.x = c.x; out.y = c.y; }
  return out;
}

// The bench under the ray: a hole on a board top (when one is within
// maxDist of the hit), else the point on the board top or on the mat.
export function pickBench(doc, ray, maxDist = 1.27, opts = {}) {
  const top = rayPlaneY(ray, BOARD_H);
  if (top) {
    const b = boardHit(doc, top.x, top.z);
    if (b) {
      const h = nearestHoleInfo(doc, top.x, top.z, maxDist, opts);
      return { hole: h ? h.hole : null, board: b.id, point: top, d: h ? h.d : null };
    }
  }
  const mat = rayPlaneY(ray, 0);
  return { hole: null, board: null, point: mat, d: null };
}

// points: [{ p:[x,y,z], ...payload }]. Returns the item nearest to the ray
// within radius (mm), preferring the one nearest to the camera on ties.
export function pickPoints(ray, points, radius) {
  let best = null;
  for (const it of points) {
    const { d, t } = rayPointDistance(ray, it.p);
    if (d > radius) continue;
    if (!best || d < best.d - 0.2 || (Math.abs(d - best.d) <= 0.2 && t < best.t)) best = { item: it, d, t };
  }
  return best ? best.item : null;
}
