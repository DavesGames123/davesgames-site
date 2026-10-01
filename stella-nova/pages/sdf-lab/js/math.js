// ============================================================================
//  SDF FORGE  ·  math.js — vectors, 3x3 and 4x4 matrices, Euler angles
// ----------------------------------------------------------------------------
//  PURE. Plain arrays, no classes, no DOM. Every other module reads these.
//
//  CONVENTIONS (the same as Forge): right-handed, +Y up, column vectors.
//  A 3x3 matrix is a flat array of 9 numbers in COLUMN-MAJOR order, so
//  m[c*3 + r] is row r of column c. A 4x4 matrix is 16 numbers, column-major.
//  Rotation is Euler XYZ in degrees: R = Rz * Ry * Rx, so X turns first.
//
//  GREP MAP
//    add sub scale dot cross len norm lerp ........ vec3 helpers
//    m3mul m3vec m3T m3inv eulerToM3 m3ToEuler ..... 3x3
//    trs m4mul m4vec m4dir m4inv m4linear .......... 4x4
//    isOrtho ....................................... a test helper
// ============================================================================
export const DEG = Math.PI / 180;
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const mulv = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = a => Math.hypot(a[0], a[1], a[2]);
export const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ── 3x3 ─────────────────────────────────────────────────────────────────────
export const M3I = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];
export function m3mul(a, b) {
  const o = new Array(9);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++)
    o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
  return o;
}
export const m3vec = (m, v) => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
export const m3T = m => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
export function m3inv(m) {
  // columns (a b c) (d e f) (g h i); rows are (a d g) (b e h) (c f i)
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - h * f) - d * (b * i - h * c) + g * (b * f - e * c);
  const k = 1 / (det || 1e-30);
  return [
    (e * i - h * f) * k, (h * c - b * i) * k, (b * f - e * c) * k,
    (g * f - d * i) * k, (a * i - g * c) * k, (d * c - a * f) * k,
    (d * h - g * e) * k, (g * b - a * h) * k, (a * e - d * b) * k];
}
export function eulerToM3(r) {
  const [x, y, z] = r.map(v => v * DEG);
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  // R = Rz * Ry * Rx, written by column
  return [
    cy * cz, cy * sz, -sy,
    sx * sy * cz - cx * sz, sx * sy * sz + cx * cz, sx * cy,
    cx * sy * cz + sx * sz, cx * sy * sz - sx * cz, cx * cy];
}
export function m3ToEuler(m) {
  // R20 = m[2], R21 = m[5], R22 = m[8], R10 = m[1], R00 = m[0]
  const sy = clamp(-m[2], -1, 1);
  const y = Math.asin(sy);
  let x, z;
  if (Math.abs(sy) < 0.999999) { x = Math.atan2(m[5], m[8]); z = Math.atan2(m[1], m[0]); }
  else { x = Math.atan2(-m[7], m[4]); z = 0; }   // gimbal lock: put the turn on X
  return [x / DEG, y / DEG, z / DEG];
}
export function axisAngleM3(a, ang) {
  const [x, y, z] = norm(a), c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  return [
    t * x * x + c, t * x * y + s * z, t * x * z - s * y,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c];
}
export function isOrtho(m, tol = 1e-6) {
  const c = [0, 1, 2].map(i => [m[i * 3], m[i * 3 + 1], m[i * 3 + 2]]);
  return Math.abs(dot(c[0], c[1])) < tol && Math.abs(dot(c[0], c[2])) < tol && Math.abs(dot(c[1], c[2])) < tol
    && c.every(v => Math.abs(len(v) - 1) < tol);
}

// ── 4x4 ─────────────────────────────────────────────────────────────────────
export const M4I = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
// T * R * S from position, Euler degrees and scale
export function trs(pos, rot, scl) {
  const R = eulerToM3(rot);
  return [
    R[0] * scl[0], R[1] * scl[0], R[2] * scl[0], 0,
    R[3] * scl[1], R[4] * scl[1], R[5] * scl[1], 0,
    R[6] * scl[2], R[7] * scl[2], R[8] * scl[2], 0,
    pos[0], pos[1], pos[2], 1];
}
export function m4mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
export const m4vec = (m, v) => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
export const m4dir = (m, v) => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2]];
export const m4linear = m => [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
export function m4inv(m) {
  // affine inverse: [L t]^-1 = [L^-1  -L^-1 t]
  const Li = m3inv(m4linear(m));
  const t = m3vec(Li, [m[12], m[13], m[14]]);
  return [Li[0], Li[1], Li[2], 0, Li[3], Li[4], Li[5], 0, Li[6], Li[7], Li[8], 0, -t[0], -t[1], -t[2], 1];
}
