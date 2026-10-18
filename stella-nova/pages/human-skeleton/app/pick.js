// ============================================================================
//  HUMAN SKELETON  ·  app/pick.js — ray picks on the bone meshes (CPU)
// ────────────────────────────────────────────────────────────────────────────
//  pickAt casts the camera ray through a canvas point against the real
//  triangles of the bones (focus.js pickBones). Each bone moves in the
//  vertex shader, so the ray takes the same move from S.cur and S.dOff.
//  The tolerance in px becomes an angle, so a thin bone near the ray
//  still picks. When one bone is isolated, only that bone is solid. A
//  ghost takes the pick only on a direct hit that misses the solid bone
//  (the user clicked it on purpose). With the others hidden, no ghost
//  picks. pickRay does the same for a ray in scene space (WebXR).
//
//  GREP MAP
//    const TOL_PX                                    tolerance, mouse / touch
//    function drawn / pose / pickOpts                which bones, where
//    function pickRay                                bone on a scene ray
//    function pickAt / pickInfo                      bone under a canvas point
// ============================================================================
import * as THREE from 'three';
import { COARSE } from './env.js';
import { canvas, camera } from './stage.js';
import { S } from './state.js';
import { pickBones } from '../focus.js';

export const TOL_PX = { mouse: 4, touch: 14 };
// the bone is in the scene now: loaded, and no toggle hides it
export const drawn = i => !!(S.loaded && S.loaded[i] && S.vis[i]);
// the move of bone i, as the vertex shader does it (render.js)
export function pose(i) {
  const b = S.bones[i], o = S.cur.off, d = S.dOff, q = S.cur.q;
  return { c: b.c, off: [o[i * 3] + d[i * 3], o[i * 3 + 1] + d[i * 3 + 1], o[i * 3 + 2] + d[i * 3 + 2]], q: [q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3]] };
}
export function pickOpts(tol) {
  const iso = S.iso;
  return {
    n: S.n, mesh: i => S.pick[i] || null, pose, tol,
    solid: iso >= 0 ? i => i === iso && drawn(i) : drawn,
    ghost: iso >= 0 && !S.isoHide ? i => i !== iso && drawn(i) : null,
  };
}
// a ray in scene space: origin, unit direction (THREE.Vector3), the
// tolerance as tan of an angle. { i, ghost } or null.
export function pickRay(o, d, tol) {
  if (!S.ready || !S.groups.size) return null;
  const h = pickBones([o.x, o.y, o.z], [d.x, d.y, d.z], pickOpts(tol));
  return h ? { i: h.i, ghost: h.ghost, exact: h.exact, t: h.t } : null;
}
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
export function pickInfo(cx, cy, px = COARSE ? TOL_PX.touch : TOL_PX.mouse) {
  if (!S.ready || !S.groups.size) return null;
  const cr = canvas.getBoundingClientRect();
  if (!cr.width || !cr.height) return null;
  ndc.set(((cx - cr.left) / cr.width) * 2 - 1, -((cy - cr.top) / cr.height) * 2 + 1);
  camera.updateMatrixWorld();
  ray.setFromCamera(ndc, camera);
  // px to an angle: the view is 2 tan(fov / 2) tall in tan units
  const tol = px * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / cr.height;
  return pickRay(ray.ray.origin, ray.ray.direction, tol);
}
export function pickAt(cx, cy, px) { const h = pickInfo(cx, cy, px); return h ? h.i : -1; }
