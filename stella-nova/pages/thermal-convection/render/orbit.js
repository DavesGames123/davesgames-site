// ============================================================================
//  THERMAL CONVECTION  ·  render/orbit.js — block view camera (VIEW)
// ----------------------------------------------------------------------------
//  No DOM. World = box units, z up, the block z is scaled by zScale (the
//  views pass dims.Lz = zScale). Matrices are Float32Array(16), column-major,
//  right-handed view, WebGPU clip depth 0..1.
//
//  orbitCam({ yaw, pitch, dist, target, fovY = 0.6, aspect = 1, near, far })
//    -> { view, proj, viewProj, eye, yaw, pitch, dist, target, fovY, aspect }
//    eye = target + dist (cos p cos y, cos p sin y, sin p).
//  fitBlock(dims, aspect, { yaw, pitch, fovY, margin }) -> cam state
//    { yaw, pitch, dist, target, fovY, aspect }: the smallest dist at which
//    all 8 box corners project inside margin (default 0.9) of the NDC square.
//    dims = { Lx, Ly, Lz } (Lz = zScale, default 1).
//  boxCorners(dims) -> 8 [x, y, z]
//  project(viewProj, p) -> { x, y, z, w } NDC (x, y in -1..1, z depth 0..1)
//  clampCam(cam) -> pitch in [0.08, 1.45], dist > 0
//  refitCam(cam, dims, aspect) -> cam fitted again when Lz or aspect changed,
//    with the user zoom kept
//  BLOCK_YAW, BLOCK_PITCH  the default view (front-left, 32° down)
//
//  grep -n targets: "export function orbitCam", "export function fitBlock",
//  "export function boxCorners", "export function project", "export function lookAt",
//  "export function perspective", "export function mul4", "export function clampCam",
//  "export function refitCam"
// ============================================================================

export const BLOCK_YAW = -2.25;
export const BLOCK_PITCH = 0.56;
export const BLOCK_FOV = 0.6;

export function mul4(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2), o = new Float32Array(16);
  o[0] = f / aspect; o[5] = f;
  o[10] = far / (near - far); o[11] = -1;
  o[14] = (near * far) / (near - far);
  return o;
}

export function lookAt(eye, at, up = [0, 0, 1]) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const nrm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const f = nrm(sub(at, eye));
  let s = cross(f, up);
  if (Math.hypot(s[0], s[1], s[2]) < 1e-6) s = cross(f, [0, 1, 0]);
  s = nrm(s);
  const u = cross(s, f), o = new Float32Array(16);
  o[0] = s[0]; o[4] = s[1]; o[8] = s[2];
  o[1] = u[0]; o[5] = u[1]; o[9] = u[2];
  o[2] = -f[0]; o[6] = -f[1]; o[10] = -f[2];
  o[12] = -dot(s, eye); o[13] = -dot(u, eye); o[14] = dot(f, eye); o[15] = 1;
  return o;
}

export function clampCam(cam) {
  return {
    ...cam,
    pitch: Math.min(1.45, Math.max(0.08, Number.isFinite(cam.pitch) ? cam.pitch : BLOCK_PITCH)),
    yaw: Number.isFinite(cam.yaw) ? cam.yaw : BLOCK_YAW,
    dist: Math.max(1e-3, Number.isFinite(cam.dist) ? cam.dist : 8),
  };
}

export function orbitCam({ yaw = BLOCK_YAW, pitch = BLOCK_PITCH, dist = 8, target = [2, 2, 0.5], fovY = BLOCK_FOV, aspect = 1, near, far } = {}) {
  const cp = Math.cos(pitch);
  const eye = [target[0] + dist * cp * Math.cos(yaw), target[1] + dist * cp * Math.sin(yaw), target[2] + dist * Math.sin(pitch)];
  const n = near ?? Math.max(0.01, dist * 0.05);
  const f = far ?? (dist * 4 + 10);
  const view = lookAt(eye, target);
  const proj = perspective(fovY, Math.max(1e-3, aspect), n, f);
  return { view, proj, viewProj: mul4(proj, view), eye, yaw, pitch, dist, target: target.slice(), fovY, aspect };
}

export function project(m, p) {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return { x: x / w, y: y / w, z: z / w, w };
}

export function boxCorners({ Lx = 4, Ly = 4, Lz = 1 } = {}) {
  const out = [];
  for (const z of [0, Lz]) for (const y of [0, Ly]) for (const x of [0, Lx]) out.push([x, y, z]);
  return out;
}

export function fitBlock(dims = {}, aspect = 1, opts = {}) {
  const Lx = dims.Lx || 4, Ly = dims.Ly || 4, Lz = dims.Lz || 1;
  const yaw = opts.yaw ?? BLOCK_YAW, pitch = opts.pitch ?? BLOCK_PITCH, fovY = opts.fovY ?? BLOCK_FOV;
  const margin = opts.margin ?? 0.9;
  const target = [Lx / 2, Ly / 2, Lz / 2];
  const corners = boxCorners({ Lx, Ly, Lz });
  const fits = d => {
    const c = orbitCam({ yaw, pitch, dist: d, target, fovY, aspect });
    return corners.every(p => {
      const q = project(c.viewProj, p);
      return q.w > 0 && Math.abs(q.x) <= margin && Math.abs(q.y) <= margin && q.z >= 0 && q.z <= 1;
    });
  };
  const rad = 0.5 * Math.hypot(Lx, Ly, Lz);
  let lo = rad * 1.01, hi = rad * 2;
  while (!fits(hi) && hi < 1e4) hi *= 1.6;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; }
  return { yaw, pitch, dist: hi, target, fovY, aspect };
}

// Keep a user camera framed when the block changes shape. cam = null or a
// camera state; dims = { Lx, Ly, Lz }. When Lz (the vertical scale) or the
// rect aspect differs from the last fit, fit again at the camera's yaw and
// pitch and keep the user's zoom (dist / fitted dist). Same Lz and aspect:
// the same object comes back.
export function refitCam(cam, dims = {}, aspect = 1) {
  const Lz = dims.Lz || 1;
  if (cam && cam.fitLz === Lz && Math.abs((cam.fitAspect || 0) - aspect) < 1e-3) return cam;
  const f = fitBlock(dims, aspect, cam ? { yaw: cam.yaw, pitch: cam.pitch } : {});
  const fit = { fitDist: f.dist, fitLz: Lz, fitAspect: aspect, aspect };
  if (!cam) return { ...f, ...fit };
  const zoom = Number.isFinite(cam.dist) && cam.fitDist > 0 ? cam.dist / cam.fitDist : 1;
  return { ...cam, ...fit, target: f.target, dist: f.dist * zoom };
}
