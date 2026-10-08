// ============================================================================
//  HOPF FIBRATION  ·  hopf.js — the geometry, with no DOM and no three.js
// ----------------------------------------------------------------------------
//  The 3-sphere S3 is the set of unit vectors (z0, z1) in C2. We write a
//  point of S3 as four reals q = [x1, x2, x3, x4], with z0 = x1 + i x2 and
//  z1 = x3 + i x4. The same four reals are the unit quaternion
//  q = x1 + x2 i + x3 j + x4 k, so z0 + z1 j = q.
//
//  HOPF MAP  p(z0, z1) = (2 z0 conj(z1), |z0|^2 - |z1|^2), a point of S2 in
//  C x R. hopf(q) gives it as [X, Y, Z]:
//      X + iY = 2 z0 conj(z1)     Z = |z0|^2 - |z1|^2
//
//  FIBRE  The fibre over b = (sin th cos ph, sin th sin ph, cos th) is
//      (z0, z1) = e^{it} (cos(th/2) e^{i ph}, sin(th/2)),  t in [0, 2 pi).
//  It is the orbit of one point under q -> e^{it} q (left product with a
//  unit complex number), so it is a great circle of S3.
//
//  SEIFERT ORBITS  The weighted circle action t -> (e^{ipt} z0, e^{iqt} z1)
//  with p, q > 0 coprime. The orbit through (cos(th/2) e^{i ph}, sin(th/2))
//  is seifertPoint(b, t, p, q). It stays on the torus |z0| = cos(th/2), so
//  it is a (p, q) torus knot: in the 3D view it winds p times about the
//  axis x1 = x2 = 0 and q times about the unit circle (the orbit z1 = 0).
//  Two orbits off the two core circles link p q times. At (1, 1) the orbit
//  is the Hopf fibre, point for point.
//
//  STEREOGRAPHIC PROJECTION  from the pole e4 = (0, 0, 0, 1):
//      (x1, x2, x3, x4) -> (x1, x2, x3) / (1 - x4)
//  It sends each great circle to a circle of R3, or to a line when the
//  circle passes through the pole.
//
//  4D ROTATION  The page applies a 4x4 rotation M before the projection.
//  Matrices are row-major arrays of 16 numbers and act on column vectors.
//      leftMat(a)   q -> a q      (a = e^{is}: each fibre slides on itself)
//      rightMat(b)  q -> q b      (each fibre goes onto another fibre)
//      planeMat(i, j, s)          a simple rotation in the (xi, xj) plane
//  rotationFor(mode, s, opts) builds M for the modes of the page.
//
//  The vertex shader in scene.js has the same fibre and projection code.
//  A change here must also go there (grep 'hopfFibre').
//
//  EXPORTS  (grep -n "export function <name>")
//    hopf, fibrePoint, seifertPoint, stereo, project, fibreCurve,
//    baseFromAngles
//    qmul, qconj, leftMat, rightMat, planeMat, matMul, matVec, ident,
//    rotationFor, MODES, baseColor, toSRGB, hexOf,
//    sampleItems, PRESETS, PRESET_GROUPS, makeRng, fibonacciSphere,
//    loopPoint, polyhedron, torusArea,
//    ident3, mat3Mul, mat3Vec, mat3T, axisAngle3, orthonormal3, nlerp3
//    circleFrom3, pierce, linkingNumber, loxodrome
// ============================================================================

export const TAU = Math.PI * 2;

// ------------------------------------------------------------------ the map
export function hopf(q) {
  const [x1, x2, x3, x4] = q;
  return [2 * (x1 * x3 + x2 * x4), 2 * (x2 * x3 - x1 * x4), x1 * x1 + x2 * x2 - x3 * x3 - x4 * x4];
}

// The point at parameter t on the fibre over the base point b (unit 3-vector).
export function fibrePoint(b, t) {
  const c = Math.sqrt(Math.max(0, (1 + b[2]) / 2)), s = Math.sqrt(Math.max(0, (1 - b[2]) / 2));
  const r = Math.hypot(b[0], b[1]);
  const ex = r > 1e-9 ? b[0] / r : 1, ey = r > 1e-9 ? b[1] / r : 0;
  const ct = Math.cos(t), st = Math.sin(t);
  return [c * (ct * ex - st * ey), c * (st * ex + ct * ey), s * ct, s * st];
}

// The orbit of the weighted action through the base point b: at t,
// (z0, z1) = (cos(th/2) e^{i(ph + p t)}, sin(th/2) e^{i q t}).
export function seifertPoint(b, t, p = 1, q = 1) {
  const c = Math.sqrt(Math.max(0, (1 + b[2]) / 2)), s = Math.sqrt(Math.max(0, (1 - b[2]) / 2));
  const r = Math.hypot(b[0], b[1]);
  const ex = r > 1e-9 ? b[0] / r : 1, ey = r > 1e-9 ? b[1] / r : 0;
  const ca = Math.cos(p * t), sa = Math.sin(p * t);
  return [c * (ca * ex - sa * ey), c * (sa * ex + ca * ey), s * Math.cos(q * t), s * Math.sin(q * t)];
}

// Stereographic projection from e4. d = 1 - x4 (0 at the pole).
export function stereo(q) {
  const d = 1 - q[3], k = 1 / Math.max(d, 1e-9);
  return [q[0] * k, q[1] * k, q[2] * k];
}

// Rotate by M (may be null), then project.
export function project(q, M) { return stereo(M ? matVec(M, q) : q); }

// n points of the projected fibre over b, as a flat Float64Array (x, y, z).
// pq = [p, q] gives the weighted orbit (default the Hopf fibre).
export function fibreCurve(b, M, n = 128, pq = null) {
  const out = new Float64Array(n * 3), hopfOnly = !pq || (pq[0] === 1 && pq[1] === 1);
  for (let i = 0; i < n; i++) {
    const t = TAU * i / n, p = project(hopfOnly ? fibrePoint(b, t) : seifertPoint(b, t, pq[0], pq[1]), M);
    out[i * 3] = p[0]; out[i * 3 + 1] = p[1]; out[i * 3 + 2] = p[2];
  }
  return out;
}

// th: polar angle from +Z (0 at the north pole); ph: longitude.
export function baseFromAngles(th, ph) { return [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)]; }

// --------------------------------------------------------------- quaternions
// [w, x, y, z] = w + x i + y j + z k
export function qmul(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}
export function qconj(a) { return [a[0], -a[1], -a[2], -a[3]]; }

// q -> a q as a matrix.
export function leftMat(a) {
  const [w, x, y, z] = a;
  return [w, -x, -y, -z,
          x,  w, -z,  y,
          y,  z,  w, -x,
          z, -y,  x,  w];
}
// q -> q b as a matrix.
export function rightMat(b) {
  const [w, x, y, z] = b;
  return [w, -x, -y, -z,
          x,  w,  z, -y,
          y, -z,  w,  x,
          z,  y, -x,  w];
}
// A rotation by s in the plane of axes i and j (0-based).
export function planeMat(i, j, s) {
  const m = ident(), c = Math.cos(s), n = Math.sin(s);
  m[i * 4 + i] = c; m[j * 4 + j] = c; m[i * 4 + j] = -n; m[j * 4 + i] = n;
  return m;
}
export function ident() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
export function matMul(A, B) {
  const C = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    let s = 0; for (let k = 0; k < 4; k++) s += A[r * 4 + k] * B[k * 4 + c];
    C[r * 4 + c] = s;
  }
  return C;
}
export function matVec(M, q) {
  return [
    M[0] * q[0] + M[1] * q[1] + M[2] * q[2] + M[3] * q[3],
    M[4] * q[0] + M[5] * q[1] + M[6] * q[2] + M[7] * q[3],
    M[8] * q[0] + M[9] * q[1] + M[10] * q[2] + M[11] * q[3],
    M[12] * q[0] + M[13] * q[1] + M[14] * q[2] + M[15] * q[3],
  ];
}

// ------------------------------------------------------------ 4D rotations
// The rotation modes of the page. keepsFibres: M sends each Hopf fibre onto
// a Hopf fibre, so a base point has an image on S2.
//   still       no rotation
//   along       q -> e^{is} q: each fibre turns on itself; the circles stay
//   isoclinic   q -> q e^{u s/2} (u = j, or a tilt of j toward k): fibres go
//               to fibres, and the base sphere turns by s about an axis
//   plane       a simple rotation in the (x1, x4) plane: it moves points
//               toward and away from the projection pole
//   double      (x1, x4) at s and (x2, x3) at s / golden ratio
export const MODES = {
  still:     { label: 'Still',             keepsFibres: true },
  along:     { label: 'Along the fibres',  keepsFibres: true },
  isoclinic: { label: 'Fibre to fibre',    keepsFibres: true },
  plane:     { label: 'One plane',         keepsFibres: false },
  double:    { label: 'Two planes',        keepsFibres: false },
};
const GOLD = (1 + Math.sqrt(5)) / 2;
export function rotationFor(mode, s, opts = {}) {
  if (mode === 'along') return leftMat([Math.cos(s), Math.sin(s), 0, 0]);
  if (mode === 'isoclinic') {
    const tilt = opts.tilt || 0, h = s / 2;
    return rightMat([Math.cos(h), 0, Math.sin(h) * Math.cos(tilt), Math.sin(h) * Math.sin(tilt)]);
  }
  if (mode === 'plane') return planeMat(0, 3, s);
  if (mode === 'double') return matMul(planeMat(0, 3, s), planeMat(1, 2, s / GOLD));
  return ident();
}

// ------------------------------------------------------- turns of S2 (3x3)
// The flow turns the base points on S2. Row-major 9 numbers, as uBaseRot.
export function ident3() { return [1, 0, 0, 0, 1, 0, 0, 0, 1]; }
export function mat3Mul(A, B) {
  const C = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
  return C;
}
export function mat3Vec(R, v) { return [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]]; }
export function mat3T(R) { return [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]; }
// A turn by s about the unit axis a (Rodrigues).
export function axisAngle3(a, s) {
  const [x, y, z] = a, c = Math.cos(s), n = Math.sin(s), k = 1 - c;
  return [c + x * x * k, x * y * k - z * n, x * z * k + y * n,
          y * x * k + z * n, c + y * y * k, y * z * k - x * n,
          z * x * k - y * n, z * y * k + x * n, c + z * z * k];
}
// Gram-Schmidt on the rows, so a product of many small turns stays a turn.
export function orthonormal3(R) {
  const a = norm3([R[0], R[1], R[2]]), b0 = [R[3], R[4], R[5]], d = dot3(a, b0);
  const b = norm3([b0[0] - d * a[0], b0[1] - d * a[1], b0[2] - d * a[2]]), c = cross3(a, b);
  return [...a, ...b, ...c];
}
// The base point of a morph at u in 0..1: a blend, put back on S2. The
// vertex shader does the same (uMorph). Near-opposite ends jump to b.
export function nlerp3(a, b, u) {
  const m = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u], l = Math.hypot(m[0], m[1], m[2]);
  return l > 1e-3 ? [m[0] / l, m[1] / l, m[2] / l] : b.slice();
}

// ------------------------------------------------------------------ colour
// The colour of a base point: hue from the longitude, lightness from the
// height Z (dark south, light north), in OKLCH. The chroma falls to zero at
// the poles, where the longitude has no value, so the map is continuous.
// Returns linear-light RGB in 0..1.
export function baseColor(b) {
  const z = Math.max(-1, Math.min(1, b[2])), r = Math.hypot(b[0], b[1]);
  const L = 0.52 + 0.36 * (z + 1) / 2;
  let C = 0.16 * Math.min(1, 1.7 * r);
  const h = Math.atan2(b[1], b[0]);
  for (let k = 0; k < 24; k++) {
    const rgb = oklchLinear(L, C, h);
    if (rgb.every(v => v >= -1e-4 && v <= 1.0001)) return rgb.map(v => Math.max(0, Math.min(1, v)));
    C *= 0.88;
  }
  return oklchLinear(L, 0, h).map(v => Math.max(0, Math.min(1, v)));
}
function oklchLinear(L, C, h) {
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}
// Linear 0..1 to sRGB 0..255.
export function toSRGB(rgb) {
  return rgb.map(v => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)));
}
export function hexOf(rgb) { return '#' + toSRGB(rgb).map(v => v.toString(16).padStart(2, '0')).join(''); }

// --------------------------------------------------------------- base sets
// A random source (mulberry32). Same seed, same numbers.
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  return { next, range: (x, y) => x + (y - x) * next(), int: (x, y) => x + Math.floor((y - x + 1) * next()), pick: arr => arr[Math.floor(next() * arr.length)],
    shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; } };
}
// A uniform point on S2 from two numbers in 0..1.
function uniformS2(u, v) { const z = 2 * u - 1, r = Math.sqrt(Math.max(0, 1 - z * z)), ph = TAU * v; return [r * Math.cos(ph), r * Math.sin(ph), z]; }
// n near-even points on S2 (Fibonacci lattice).
export function fibonacciSphere(n) {
  const out = [], ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * i + 1) / n, r = Math.sqrt(Math.max(0, 1 - z * z)), ph = i * ga;
    out.push([r * Math.cos(ph), r * Math.sin(ph), z]);
  }
  return out;
}
const norm3 = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// A point that moves on S2: a loxodrome that goes from pole to pole and
// back, with a slow turn. u is time in turns.
export function loxodrome(u) {
  const z = Math.sin(TAU * u * 0.5) * 0.92, ph = TAU * u * 2.2;
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(ph), r * Math.sin(ph), z];
}

// ---------------------------------------------------------- closed curves
// A point of a closed curve on S2 at u in [0, 1). The fibres over a closed
// curve fill a Hopf torus (Pinkall 1985). It is flat in S3, with area
// pi * L for a curve of length L on the unit S2 (torusArea checks this).
//   flower  th = th0 + amp sin(k ph): a latitude with k waves
//   seam    the tennis-ball seam (a cos s + b cos 3s, a sin s - b sin 3s,
//           2 sqrt(ab) sin 2s), a + b = 1, lifted toward the north by
//           lift and put back on S2 (so no fibre goes near infinity)
//   tilt    a circle of radius rho about the axis (sin tl, 0, cos tl)
export function loopPoint(it, u) {
  const ph = TAU * u;
  if (it.shape === 'seam') {
    const a = it.a ?? 0.7, b = 1 - a, l = it.lift ?? 0.9, k = 2 * Math.sqrt(a * b);
    const v = [a * Math.cos(ph) + b * Math.cos(3 * ph), a * Math.sin(ph) - b * Math.sin(3 * ph), k * Math.sin(2 * ph) + l];
    const c = Math.cos(it.ph0 || 0), s = Math.sin(it.ph0 || 0);
    return norm3([c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]]);
  }
  if (it.shape === 'tilt') {
    const rho = it.rho ?? 0.5, tl = it.tl ?? 0.6, ax = [Math.sin(tl), 0, Math.cos(tl)], e1 = [Math.cos(tl), 0, -Math.sin(tl)], e2 = [0, 1, 0];
    const cr = Math.cos(rho), sr = Math.sin(rho);
    return [0, 1, 2].map(j => cr * ax[j] + sr * (Math.cos(ph) * e1[j] + Math.sin(ph) * e2[j]));
  }
  const th = (it.th0 ?? 1.2) + (it.amp ?? 0.25) * Math.sin((it.k ?? 5) * ph + (it.ph1 || 0));
  return baseFromAngles(Math.max(1e-3, Math.min(Math.PI - 1e-3, th)), ph + (it.ph0 || 0));
}
// The area in S3 of the surface of fibres over the curve P(u), u in [0,1),
// by the midpoint rule; and the length of the curve on S2. For a closed
// curve, area = pi * length.
export function torusArea(P, nu = 400, nt = 200) {
  let A = 0, L = 0;
  const h = 1e-5;
  for (let i = 0; i < nu; i++) {
    const u = (i + 0.5) / nu, a = P(u - 0.5 / nu), b = P(u + 0.5 / nu);
    L += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const bu = P(u), bp = P(u + h), bm = P(u - h);
    for (let j = 0; j < nt; j++) {
      const t = TAU * (j + 0.5) / nt, f0 = fibrePoint(bp, t), f1 = fibrePoint(bm, t), g0 = fibrePoint(bu, t + h), g1 = fibrePoint(bu, t - h);
      const Pu = f0.map((v, k) => (v - f1[k]) / (2 * h)), Pt = g0.map((v, k) => (v - g1[k]) / (2 * h));
      const E = Pu.reduce((q, v) => q + v * v, 0), Gt = Pt.reduce((q, v) => q + v * v, 0), F = Pu.reduce((q, v, k) => q + v * Pt[k], 0);
      A += Math.sqrt(Math.max(0, E * Gt - F * F)) / nu * TAU / nt;
    }
  }
  return { area: A, length: L };
}

// ------------------------------------------------------------- polyhedra
// The vertices of a regular solid as unit vectors, turned by a fixed
// rotation so that no vertex sits on the south pole (whose fibre is the
// line through infinity).
export function polyhedron(name) {
  const g = GOLD, ig = 1 / GOLD, V = [];
  const cyc = (a, b, c) => { V.push([a, b, c], [c, a, b], [b, c, a]); };
  if (name === 'octa') { for (const s of [1, -1]) { V.push([s, 0, 0], [0, s, 0], [0, 0, s]); } }
  else if (name === 'cube') { for (const x of [1, -1]) for (const y of [1, -1]) for (const z of [1, -1]) V.push([x, y, z]); }
  else if (name === 'dodeca') {
    for (const x of [1, -1]) for (const y of [1, -1]) for (const z of [1, -1]) V.push([x, y, z]);
    for (const a of [ig, -ig]) for (const b of [g, -g]) cyc(0, a, b);
  } else { for (const a of [1, -1]) for (const b of [g, -g]) cyc(0, a, b); }
  // a turn by 0.5 rad about the axis (1, 2, 3)
  const ax = norm3([1, 2, 3]), c = Math.cos(0.5), sn = Math.sin(0.5);
  return V.map(v => { v = norm3(v); const d = dot3(ax, v), x = cross3(ax, v); return norm3([0, 1, 2].map(j => v[j] * c + x[j] * sn + ax[j] * d * (1 - c))); });
}

// Items are what the user puts on the base sphere:
//   { kind: 'point', b }                   one fibre
//   { kind: 'lat', z, n?, ph0?, span?, open? }  n fibres over a circle of
//                                          latitude (open: the end of the
//                                          span gets no fibre)
//   { kind: 'loop', shape, ..., n? }       n fibres over a closed curve
//                                          (loopPoint)
//   { kind: 'great', axis, n? }            n fibres over a great circle
//   { kind: 'curve', pts }                 fibres along a painted curve
//   { kind: 'cloud', pts }                 a fixed set of points
// density sets n where an item has none. The result is a list of
// { b, item } with b a unit 3-vector. cap limits the total.
export function sampleItems(items, density = 24, cap = 2000) {
  const out = [];
  const push = (b, k) => { if (out.length < cap) out.push({ b: norm3(b), item: k }); };
  items.forEach((it, k) => {
    if (it.kind === 'point') push(it.b, k);
    else if (it.kind === 'lat') {
      const n = it.n || density, z = Math.max(-0.999, Math.min(0.999, it.z)), r = Math.sqrt(1 - z * z);
      const span = it.span || TAU, ph0 = it.ph0 || 0;
      const full = span >= TAU - 1e-9 || it.open;
      for (let i = 0; i < n; i++) { const ph = ph0 + span * (full ? i / n : i / Math.max(1, n - 1)); push([r * Math.cos(ph), r * Math.sin(ph), z], k); }
    } else if (it.kind === 'great') {
      const a = norm3(it.axis), u = norm3(Math.abs(a[2]) < 0.9 ? cross3(a, [0, 0, 1]) : cross3(a, [1, 0, 0])), v = cross3(a, u);
      const n = it.n || density;
      for (let i = 0; i < n; i++) { const s = TAU * i / n, c = Math.cos(s), sn = Math.sin(s); push([u[0] * c + v[0] * sn, u[1] * c + v[1] * sn, u[2] * c + v[2] * sn], k); }
    } else if (it.kind === 'curve') {
      const P = it.pts; if (!P || !P.length) return;
      if (P.length === 1) { push(P[0], k); return; }
      let len = 0; const cum = [0];
      for (let i = 1; i < P.length; i++) { len += Math.acos(Math.max(-1, Math.min(1, dot3(norm3(P[i - 1]), norm3(P[i]))))); cum.push(len); }
      const n = it.n || Math.max(2, Math.min(4 * density, Math.round(len / TAU * density * 1.6) + 1));
      let j = 0;
      for (let i = 0; i < n; i++) {
        const s = len * i / Math.max(1, n - 1);
        while (j < cum.length - 2 && cum[j + 1] < s) j++;
        const f = cum[j + 1] > cum[j] ? (s - cum[j]) / (cum[j + 1] - cum[j]) : 0;
        const a = P[j], b = P[j + 1];
        push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], k);
      }
    } else if (it.kind === 'loop') {
      const n = it.n || Math.round(density * 1.5);
      for (let i = 0; i < n; i++) push(loopPoint(it, i / n), k);
    } else if (it.kind === 'cloud') it.pts.forEach(b => push(b, k));
  });
  return out;
}

// The presets of the page. Each returns { items, ...view hints }.
// rng is used by 'random' only.
export const PRESETS = [
  { id: 'single', name: 'Single fibre', blurb: 'One point of S² and its fibre: a great circle of S³, here a round circle.',
    make: () => ({ items: [{ kind: 'point', b: baseFromAngles(1.05, 0.6) }] }) },
  { id: 'linked', name: 'Two linked fibres', blurb: 'Any two fibres link once. Each circle passes through the disc of the other.',
    make: () => ({ items: [{ kind: 'point', b: baseFromAngles(0.85, 0.2) }, { kind: 'point', b: baseFromAngles(2.0, 2.6) }], discs: true }) },
  { id: 'torus', name: 'Circle of latitude', blurb: 'The fibres over one circle of latitude fill a torus. Each fibre is a Villarceau circle on it.',
    make: (d) => ({ items: [{ kind: 'lat', z: 0, n: Math.max(12, d) }] }) },
  { id: 'nested', name: 'Nested tori', blurb: 'Four latitudes give four nested tori. A wedge of each circle is left out, so the inner tori show.',
    make: (d) => ({ items: [0.82, 0.5, 0.12, -0.3].map((z, i) => ({ kind: 'lat', z, n: Math.max(8, Math.round(d * (0.55 + 0.25 * i))), ph0: 0.9, span: TAU * 0.78 })) }) },
  { id: 'meridian', name: 'Great circle through the poles', blurb: 'A great circle of S² through both poles. Its fibres fill a torus that contains the line through infinity.',
    make: (d) => ({ items: [{ kind: 'great', axis: [0, 1, 0], n: Math.max(16, Math.round(d * 1.4)) }] }) },
  { id: 'random', name: 'Random points', blurb: 'Points at random on S². However they fall, every pair of fibres links once.',
    make: (d, rng) => ({ items: Array.from({ length: Math.max(8, Math.round(d * 0.75)) }, () => ({ kind: 'point', b: uniformS2(rng.next(), rng.next()) })) }) },
  { id: 'dense', name: 'The whole fibration', blurb: 'An even net of points over all of S². The fibres fill space, one circle through each point.',
    make: (d) => ({ items: [{ kind: 'cloud', pts: fibonacciSphere(Math.round(d * d * 0.75)) }], thin: true }) },
  { id: 'trace', name: 'Trace a moving point', blurb: 'A point moves on S² from pole to pole. Its fibre moves with it and leaves a trail of fibres.',
    make: () => ({ items: [], trace: true }) },
  // ---- Hopf tori: the fibres over a closed curve
  { id: 'flower', group: 'tori', name: 'Flower torus', blurb: 'The fibres over a wavy latitude fill a Hopf torus with five bulges. Pinkall showed that every Hopf torus is flat in S³, with area π times the length of its curve.',
    make: (d) => ({ items: [{ kind: 'loop', shape: 'flower', th0: 1.15, amp: 0.32, k: 5, n: Math.max(30, Math.round(d * 2.2)) }] }) },
  { id: 'seam', group: 'tori', name: 'Tennis-ball torus', blurb: 'A curve like the seam of a tennis ball. Its fibres fill a Hopf torus that twists in and out. Fibres over distinct points never meet, so the torus does not cut itself.',
    make: (d) => ({ items: [{ kind: 'loop', shape: 'seam', a: 0.7, lift: 0.9, n: Math.max(36, Math.round(d * 2.4)) }] }) },
  { id: 'twin', group: 'tori', name: 'Two linked tori', blurb: 'Two small circles on S², far apart. Their Hopf tori are linked: each fibre of one torus links each fibre of the other once.',
    make: (d) => ({ items: [{ kind: 'loop', shape: 'tilt', rho: 0.42, tl: 0.55, n: Math.max(18, Math.round(d * 1.1)) }, { kind: 'loop', shape: 'tilt', rho: 0.42, tl: 2.2, ph0: 0, n: Math.max(18, Math.round(d * 1.1)) }] }) },
  { id: 'spiral', group: 'tori', name: 'Spiral ribbon', blurb: 'The fibres along a spiral from the south to the north of S². An arc of the base lifts to a band of circles that winds down to the unit circle.',
    make: (d) => ({ items: [{ kind: 'curve', pts: Array.from({ length: 160 }, (_, i) => { const z = -0.55 + 1.45 * i / 159, r = Math.sqrt(1 - z * z), ph = 3 * TAU * i / 159; return [r * Math.cos(ph), r * Math.sin(ph), z]; }), n: Math.max(40, Math.round(d * 3)) }] }) },
  // ---- links: fibres over finite sets
  { id: 'icosa', group: 'links', name: 'Icosahedron', blurb: 'The 12 vertices of an icosahedron on S² give 12 great circles of S³. Each pair links once: 66 linked pairs.',
    make: () => ({ items: polyhedron('icosa').map(b => ({ kind: 'point', b })) }) },
  { id: 'dodeca', group: 'links', name: 'Dodecahedron', blurb: 'The 20 vertices of a dodecahedron give 20 circles and 190 linked pairs. Opposite vertices give circles that are as far apart as two fibres can be.',
    make: () => ({ items: polyhedron('dodeca').map(b => ({ kind: 'point', b })) }) },
  { id: 'necklace', group: 'links', name: 'Necklace', blurb: 'Points along a tilted great circle of S². Their fibres lie on one Clifford torus, and each pair links once.',
    make: (d) => ({ items: [{ kind: 'great', axis: [Math.sin(0.5), 0, Math.cos(0.5)], n: Math.max(7, Math.round(d * 0.45)) }] }) },
  // ---- torus knots: the weighted action t -> (e^{ipt} z0, e^{iqt} z1)
  { id: 'trefoils', group: 'knots', name: 'Trefoil torus', blurb: 'Weights (2, 3): the circle action t ↦ (e²ⁱᵗ z₀, e³ⁱᵗ z₁). Its orbits over one latitude are trefoil knots that fill a torus. Any two orbits link 6 times.',
    make: (d) => ({ items: [{ kind: 'lat', z: 0.05, n: Math.max(6, Math.round(d * 0.5)), span: TAU / 3, open: true }], pq: [2, 3] }) },
  { id: 'seifert', group: 'knots', name: 'Seifert tori', blurb: 'Weights (3, 2) on three nested tori. Each orbit is a (3, 2) torus knot. Only the two core circles z₀ = 0 and z₁ = 0 are shorter orbits: the exceptional fibres.',
    make: (d) => ({ items: [0.62, 0.05, -0.45].map((z, i) => ({ kind: 'lat', z, n: Math.max(4, Math.round(d * (0.25 + 0.08 * i))), span: TAU / 2, open: true, ph0: 0.9 * i })), pq: [3, 2] }) },
  { id: 'cinquefoil', group: 'knots', name: 'Cinquefoil', blurb: 'Weights (2, 5): each orbit is a (2, 5) torus knot, a cinquefoil, that winds 2 times about the axis and 5 times about the core circle.',
    make: (d) => ({ items: [{ kind: 'lat', z: 0.2, n: Math.max(3, Math.round(d * 0.2)), span: TAU / 5, open: true }], pq: [2, 5] }) },
  { id: 'knotpair', group: 'knots', name: 'Two trefoils', blurb: 'Two orbits of the (2, 3) action on two different tori. They link p·q = 6 times: the readout gives the Gauss integral.',
    make: () => ({ items: [{ kind: 'point', b: baseFromAngles(1.05, 0.2) }, { kind: 'point', b: baseFromAngles(1.95, 1.4) }], pq: [2, 3], discs: true }) },
];
// The groups of the preset gallery. A preset with no group is 'hopf'.
export const PRESET_GROUPS = [
  { id: 'hopf', name: 'Hopf fibres' }, { id: 'tori', name: 'Hopf tori' },
  { id: 'links', name: 'Links' }, { id: 'knots', name: 'Torus knots' },
];

// ---------------------------------------------------------- circle and link
// The circle through three points of R3: centre, radius, unit normal.
// Null when the points are on one line.
export function circleFrom3(a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = cross3(ab, ac), nn = dot3(n, n);
  if (nn < 1e-18) return null;
  const t1 = cross3(n, ab), t2 = cross3(ac, n), a2 = dot3(ac, ac), b2 = dot3(ab, ab);
  const o = [(t1[0] * a2 + t2[0] * b2) / (2 * nn), (t1[1] * a2 + t2[1] * b2) / (2 * nn), (t1[2] * a2 + t2[2] * b2) / (2 * nn)];
  const centre = [a[0] + o[0], a[1] + o[1], a[2] + o[2]];
  return { centre, radius: Math.hypot(o[0], o[1], o[2]), normal: norm3(n) };
}

// Where the curve B (flat xyz array, closed) passes through the disc of
// circle A. Returns the points of B on the plane of A inside the circle.
export function pierce(A, B) {
  const n = B.length / 3, out = [];
  const f = i => { const k = (i % n) * 3; return (B[k] - A.centre[0]) * A.normal[0] + (B[k + 1] - A.centre[1]) * A.normal[1] + (B[k + 2] - A.centre[2]) * A.normal[2]; };
  for (let i = 0; i < n; i++) {
    const f0 = f(i), f1 = f(i + 1);
    if (f0 === 0 || f0 * f1 < 0) {
      const s = f0 === 0 ? 0 : f0 / (f0 - f1), k0 = i * 3, k1 = ((i + 1) % n) * 3;
      const p = [B[k0] + (B[k1] - B[k0]) * s, B[k0 + 1] + (B[k1 + 1] - B[k0 + 1]) * s, B[k0 + 2] + (B[k1 + 2] - B[k0 + 2]) * s];
      // a segment across infinity has huge ends: skip it
      if (Math.hypot(B[k1] - B[k0], B[k1 + 1] - B[k0 + 1], B[k1 + 2] - B[k0 + 2]) > 4 * A.radius + 10) continue;
      if (Math.hypot(p[0] - A.centre[0], p[1] - A.centre[1], p[2] - A.centre[2]) < A.radius) out.push(p);
    }
  }
  return out;
}

// The Gauss linking integral of two closed curves (flat xyz arrays), by the
// midpoint rule. For two Hopf fibres it is +1 or -1 (sign by orientation).
export function linkingNumber(A, B) {
  const na = A.length / 3, nb = B.length / 3;
  let s = 0;
  for (let i = 0; i < na; i++) {
    const i0 = i * 3, i1 = ((i + 1) % na) * 3;
    const ax = (A[i0] + A[i1]) / 2, ay = (A[i0 + 1] + A[i1 + 1]) / 2, az = (A[i0 + 2] + A[i1 + 2]) / 2;
    const dax = A[i1] - A[i0], day = A[i1 + 1] - A[i0 + 1], daz = A[i1 + 2] - A[i0 + 2];
    for (let j = 0; j < nb; j++) {
      const j0 = j * 3, j1 = ((j + 1) % nb) * 3;
      const rx = ax - (B[j0] + B[j1]) / 2, ry = ay - (B[j0 + 1] + B[j1 + 1]) / 2, rz = az - (B[j0 + 2] + B[j1 + 2]) / 2;
      const dbx = B[j1] - B[j0], dby = B[j1 + 1] - B[j0 + 1], dbz = B[j1 + 2] - B[j0 + 2];
      const cx = day * dbz - daz * dby, cy = daz * dbx - dax * dbz, cz = dax * dby - day * dbx;
      const r2 = rx * rx + ry * ry + rz * rz;
      s += (rx * cx + ry * cy + rz * cz) / (r2 * Math.sqrt(r2));
    }
  }
  return s / (4 * Math.PI);
}
