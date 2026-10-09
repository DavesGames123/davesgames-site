// ============================================================================
//  BIOME PARTS  ·  view.js — framing a part for the SDF lab camera
// ----------------------------------------------------------------------------
//  PURE. Converts a tape's FreeCAD bounding box (mm, Z up) to the renderer's
//  world (units of MM mm, +Y up), and frames an SDF lab orbit camera on it.
//
//  GREP MAP
//    worldBounds ..... FC bbox -> { lo, hi } in world units
//    sceneSphere ..... [x, y, z, r] for struct U scene (early outs)
//    frameFor ........ { cam, scene, bounds } for a yaw and pitch
//    opWorldCentre ... the world centre of one op's tool (push-in shots)
// ============================================================================
import { makeCam, frameBounds } from '../../sdf-lab/js/camera.js';
import { MM } from './part.js';

export function worldBounds(A) {
  if (!A || A.empty || !Number.isFinite(A.bbox[0][0])) return { lo: [-2, 0, -2], hi: [2, 1, 2] };
  const [l, h] = A.bbox;
  return { lo: [l[0] / MM, l[2] / MM, -h[1] / MM], hi: [h[0] / MM, h[2] / MM, -l[1] / MM] };
}
export function sceneSphere(b, pad = 0.4) {
  const c = [0, 1, 2].map(i => (b.lo[i] + b.hi[i]) / 2);
  const r = Math.hypot(...[0, 1, 2].map(i => b.hi[i] - b.lo[i])) / 2;
  return [...c, r + pad];
}
export function frameFor(A, o = {}) {
  const bounds = worldBounds(A);
  const cam = makeCam('persp', { yaw: o.yaw ?? 38, pitch: o.pitch ?? 28, fov: o.fov ?? 34 });
  frameBounds(cam, bounds, o.fill ?? 1.25, o.aspect ?? 1.6);
  return { cam, scene: sceneSphere(bounds), bounds };
}

export function opWorldCentre(op) {
  const z0 = Math.max(op.z0, op.z1 - 40), zc = (z0 + op.z1) / 2;
  const F = op.F, p = op.p;
  const q = [0, 1, 2].map(i => F.o[i] + F.u[i] * p.cu + F.v[i] * p.cv + F.n[i] * zc);
  return [q[0] / MM, q[2] / MM, -q[1] / MM];
}
