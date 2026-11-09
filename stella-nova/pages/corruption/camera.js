// ============================================================================
//  CORRUPTION  ·  camera.js — an orbit camera and its matrices (no DOM)
// ----------------------------------------------------------------------------
//  Right-handed, y up. Clip z is 0..1 (WebGPU). viewState() returns the
//  fields that params.js packUniforms reads, and the ray of a pixel for the
//  click pick. shiftY moves the principal point (a saver frames the subject
//  in the clear band of the label plate).
//
//  GREP MAP
//    grep -n 'export function orbitCamera'   the state and its moves
//    grep -n 'function viewState'            matrices and basis vectors
//    grep -n 'function rayAt'                the ray through a pixel
// ============================================================================
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function mul4(a, b) {             // column-major a * b
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

export function orbitCamera(o = {}) {
  const c = {
    yaw: o.yaw ?? 0.55, pitch: o.pitch ?? 0.28, dist: o.dist ?? 4.6,
    target: o.target ? [...o.target] : [0, 1, 0], fov: o.fov ?? 0.72, shiftY: 0,
    minDist: 1.2, maxDist: 14,
  };
  c.position = () => {
    const cp = Math.cos(c.pitch);
    return [c.target[0] + c.dist * cp * Math.sin(c.yaw), c.target[1] + c.dist * Math.sin(c.pitch), c.target[2] + c.dist * cp * Math.cos(c.yaw)];
  };
  c.orbit = (dx, dy) => {
    c.yaw -= dx; c.pitch = Math.min(1.35, Math.max(-0.05, c.pitch + dy));
  };
  c.zoom = f => { c.dist = Math.min(c.maxDist, Math.max(c.minDist, c.dist * f)); };
  c.viewState = (w, h) => {
    const eye = c.position(), F = norm(sub(c.target, eye));
    const R = norm(cross(F, [0, 1, 0])), Up = cross(R, F);
    const aspect = w / Math.max(1, h), t = Math.tan(c.fov / 2), near = 0.05, far = 80;
    const view = [R[0], Up[0], -F[0], 0, R[1], Up[1], -F[1], 0, R[2], Up[2], -F[2], 0,
      -dot(R, eye), -dot(Up, eye), dot(F, eye), 1];
    const f = 1 / t;
    const proj = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, c.shiftY, far / (near - far), -1, 0, 0, (near * far) / (near - far), 0];
    return { w, h, viewProj: mul4(proj, view), cam: eye, camR: R, camU: Up, camF: F, aspect, tanHalf: t, shiftY: c.shiftY };
  };
  // the ray through pixel (x, y) of a w x h view
  c.rayAt = (x, y, w, h) => {
    const v = c.viewState(w, h);
    const nx = (x / w) * 2 - 1, ny = 1 - (y / h) * 2 + v.shiftY;
    const d = norm([0, 1, 2].map(i => v.camF[i] + v.camR[i] * nx * v.tanHalf * v.aspect + v.camU[i] * ny * v.tanHalf));
    return { o: v.cam, d };
  };
  return c;
}
