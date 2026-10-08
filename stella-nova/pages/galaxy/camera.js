// ============================================================================
//  GALAXY  ·  camera.js — the orbit camera and its motion helpers (no DOM)
// ----------------------------------------------------------------------------
//  The camera orbits a target point. yaw turns round the galaxy's axis
//  (world z); pitch is the height above the disk plane, so the inclination
//  of the disk to the line of sight is i = 90 deg - pitch. A small dist
//  with pitch near 0 puts the eye inside the disk: the "fly into the disk"
//  view is the same orbit camera, close in and level.
//
//  The basis has no singular pose: right = (-sin yaw, cos yaw, 0) for any
//  pitch, so a face-on view (pitch 90 deg) still has a defined up.
//
//  EXPORTS  basis, frameUniform, fitDistance, spring, springAngle, lerp,
//           ease, inclToPitch
// ============================================================================

export const DEG = Math.PI / 180;
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = t => t * t * (3 - 2 * t);
export const inclToPitch = i => (90 - i) * DEG;

// c = { target: [x, y, z], yaw, pitch, dist, fov (deg) }
export function basis(c) {
  const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch), cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  const back = [cp * cy, cp * sy, sp];
  const eye = [0, 1, 2].map(i => c.target[i] + back[i] * c.dist);
  const fwd = back.map(v => -v);
  const right = [-sy, cy, 0];
  const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  return { eye, fwd, right, up };
}

// The camera fields of the frame uniform, for a view aspect w/h.
export function frameUniform(c, aspect) {
  const b = basis(c), tanHalf = Math.tan((c.fov || 40) * DEG / 2);
  return { eye: b.eye, right: b.right, up: b.up, fwd: b.fwd, tanHalf, aspect };
}

// Distance at which a disk of radius R fills `fill` of the view height,
// for a vertical fov. A short clear band (fraction band of the height)
// pushes the camera back so the galaxy fits in it.
export function fitDistance(R, fov, aspect = 1.6, band = 1, fill = 0.92) {
  const th = Math.tan(fov * DEG / 2), tw = th * aspect;
  const t = Math.min(th * band, tw) * fill;
  return R / Math.max(1e-3, t);
}

// Critically damped spring toward x1 (rate w per second). Returns [x, v].
export function spring(x, v, x1, w, dt) {
  const f = 1 + 2 * dt * w, oo = w * w, hoo = dt * oo, hhoo = dt * hoo;
  const det = 1 / (f + hhoo);
  const nx = (f * x + dt * v + hhoo * x1) * det;
  const nv = (v + hoo * (x1 - x)) * det;
  return [nx, nv];
}
// The same for an angle: takes the short way round.
export function springAngle(x, v, x1, w, dt) {
  let d = x1 - x; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
  return spring(x, v, x + d, w, dt);
}
