// ============================================================================
//  ALPHAFOLD EXPLAINED  ·  rigid-body geometry  (no DOM)
// ----------------------------------------------------------------------------
//  Small vector and frame helpers for the structure-module panels. A frame
//  is { R: [9] row-major 3x3, t: [3] }. T o x = R x + t. Each residue frame
//  comes from N, CA, C by Gram-Schmidt, the same construction as the
//  AlphaFold 2 paper (origin at CA, x axis toward C, N in the x-y plane).
//
//  grep: function frameFrom3  function quatFromR  function slerp
//        function dihedral  function fape  function drmsd
// ============================================================================
export const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
export const add = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
export const scl = (a, s) => [a[0]*s, a[1]*s, a[2]*s];
export const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
export const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export const norm = a => Math.hypot(a[0], a[1], a[2]);
export const unit = a => scl(a, 1 / (norm(a) || 1));
export const at = (arr, i) => [arr[3*i], arr[3*i+1], arr[3*i+2]];

// R x (R row-major) and R^T x
export const mv = (R, x) => [R[0]*x[0]+R[1]*x[1]+R[2]*x[2], R[3]*x[0]+R[4]*x[1]+R[5]*x[2], R[6]*x[0]+R[7]*x[1]+R[8]*x[2]];
export const mtv = (R, x) => [R[0]*x[0]+R[3]*x[1]+R[6]*x[2], R[1]*x[0]+R[4]*x[1]+R[7]*x[2], R[2]*x[0]+R[5]*x[1]+R[8]*x[2]];
export const mm = (A, B) => { const C = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[3*r+c] = A[3*r]*B[c] + A[3*r+1]*B[3+c] + A[3*r+2]*B[6+c]; return C; };
export const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const apply = (T, x) => add(mv(T.R, x), T.t);
export const applyInv = (T, x) => mtv(T.R, sub(x, T.t));
export const compose = (A, B) => ({ R: mm(A.R, B.R), t: apply(A, B.t) });

// Frame from N, CA, C. Columns of R are e1 (CA->C), e2, e3.
export function frameFrom3(n, ca, c) {
  const e1 = unit(sub(c, ca));
  const v2 = sub(n, ca);
  const e2 = unit(sub(v2, scl(e1, dot(e1, v2))));
  const e3 = cross(e1, e2);
  return { R: [e1[0], e2[0], e3[0], e1[1], e2[1], e3[1], e1[2], e2[2], e3[2]], t: ca.slice() };
}

export function rotAxis(axis, ang) {
  const [x, y, z] = unit(axis), c = Math.cos(ang), s = Math.sin(ang), C = 1 - c;
  return [c+x*x*C, x*y*C-z*s, x*z*C+y*s, y*x*C+z*s, c+y*y*C, y*z*C-x*s, z*x*C-y*s, z*y*C+x*s, c+z*z*C];
}

export function quatFromR(m) {
  const tr = m[0] + m[4] + m[8]; let w, x, y, z;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = s/4; x = (m[7]-m[5])/s; y = (m[2]-m[6])/s; z = (m[3]-m[1])/s; }
  else if (m[0] > m[4] && m[0] > m[8]) { const s = Math.sqrt(1+m[0]-m[4]-m[8])*2; w = (m[7]-m[5])/s; x = s/4; y = (m[1]+m[3])/s; z = (m[2]+m[6])/s; }
  else if (m[4] > m[8]) { const s = Math.sqrt(1+m[4]-m[0]-m[8])*2; w = (m[2]-m[6])/s; x = (m[1]+m[3])/s; y = s/4; z = (m[5]+m[7])/s; }
  else { const s = Math.sqrt(1+m[8]-m[0]-m[4])*2; w = (m[3]-m[1])/s; x = (m[2]+m[6])/s; y = (m[5]+m[7])/s; z = s/4; }
  return [w, x, y, z];
}
export function RfromQuat([w, x, y, z]) {
  const n = Math.hypot(w, x, y, z); w /= n; x /= n; y /= n; z /= n;
  return [1-2*(y*y+z*z), 2*(x*y-w*z), 2*(x*z+w*y), 2*(x*y+w*z), 1-2*(x*x+z*z), 2*(y*z-w*x), 2*(x*z-w*y), 2*(y*z+w*x), 1-2*(x*x+y*y)];
}
export function slerp(a, b, t) {
  let d = a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
  if (d < 0) { b = b.map(v => -v); d = -d; }
  if (d > 0.9995) return a.map((v, k) => v + (b[k] - v) * t);
  const th = Math.acos(d), s = Math.sin(th);
  return a.map((v, k) => (Math.sin((1 - t) * th) * v + Math.sin(t * th) * b[k]) / s);
}

// Dihedral angle a-b-c-d in degrees, -180..180.
export function dihedral(a, b, c, d) {
  const b0 = sub(a, b), b1 = unit(sub(c, b)), b2 = sub(d, c);
  const v = sub(b0, scl(b1, dot(b0, b1))), w = sub(b2, scl(b1, dot(b2, b1)));
  return Math.atan2(dot(cross(b1, v), w), dot(v, w)) * 180 / Math.PI;
}

// FAPE over frames F and points X (true: Ft, Xt). Returns the mean clamped
// error in Å (the loss is this value / Z with Z = 10 Å).
export function fape(F, X, Ft, Xt, clamp = 10) {
  let s = 0, n = 0;
  for (let i = 0; i < F.length; i++) for (let j = 0; j < X.length; j++) {
    const a = applyInv(F[i], X[j]), b = applyInv(Ft[i], Xt[j]);
    s += Math.min(clamp, Math.sqrt(dot(sub(a, b), sub(a, b)) + 1e-4)); n++;
  }
  return s / n;
}
// RMS difference of the two inter-point distance matrices.
export function drmsd(X, Y) {
  let s = 0, n = 0;
  for (let i = 0; i < X.length; i++) for (let j = i + 1; j < X.length; j++) {
    const d = norm(sub(X[i], X[j])) - norm(sub(Y[i], Y[j])); s += d * d; n++;
  }
  return Math.sqrt(s / n);
}
