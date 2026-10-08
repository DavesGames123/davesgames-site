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
//    hopf, fibrePoint, stereo, project, fibreCurve, baseFromAngles
//    qmul, qconj, leftMat, rightMat, planeMat, matMul, matVec, ident,
//    rotationFor, MODES, baseColor, toSRGB, hexOf,
//    sampleItems, PRESETS, makeRng, fibonacciSphere,
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

// Stereographic projection from e4. d = 1 - x4 (0 at the pole).
export function stereo(q) {
  const d = 1 - q[3], k = 1 / Math.max(d, 1e-9);
  return [q[0] * k, q[1] * k, q[2] * k];
}

// Rotate by M (may be null), then project.
export function project(q, M) { return stereo(M ? matVec(M, q) : q); }

// n points of the projected fibre over b, as a flat Float64Array (x, y, z).
export function fibreCurve(b, M, n = 128) {
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p = project(fibrePoint(b, TAU * i / n), M);
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

// Items are what the user puts on the base sphere:
//   { kind: 'point', b }                   one fibre
//   { kind: 'lat', z, n?, ph0?, span? }    n fibres over a circle of latitude
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
      const full = span >= TAU - 1e-9;
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
