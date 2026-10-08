// ============================================================================
//  PLANET FORGE  ·  noise.js — seeded noise on the sphere (no DOM)
// ----------------------------------------------------------------------------
//  Every map comes from 3D positions on the unit sphere, never from 2D UV.
//  So a map has no seam at the date line and no pinch at the poles.
//
//  The base is 3D simplex noise with an integer hash (no permutation table,
//  no global state). The same (x, y, z, seed) gives the same value in a
//  worker, in the page and in node. simplex3 can also write its analytic
//  gradient, which the derivative-damped fBm and the curl noise use.
//
//  The kernel radius is r^2 = 0.5, not the classic 0.6. With 0.6 the kernel
//  reaches past the four simplex corners and the field has small steps; a
//  normal map from the height shows them as lines.
//
//  BUILDING BLOCKS
//    simplex3(x,y,z,seed,g)   value in about [-1, 1]; g (length 3) gets the gradient
//    fbm(p, o, seed)          sum of octaves. o = { freq, octaves, lacunarity, gain }
//    fbmEroded(p, o, seed, k) octaves damped by 1 / (1 + k |sum of gradients|^2)
//    ridged(p, o, seed, sharp) Musgrave ridged multifractal, crest power sharp
//    warp(p, amount, freq, seed, out)  two-level domain warp
//    curl(p, freq, seed, out) divergence-free tangent flow: grad(psi) x p
//    mulberry(seed)           seeded RNG in [0, 1)
//    onSphere(rnd, out)       uniform random unit vector
//    fibonacci(n)             n near-uniform unit vectors (deterministic)
//    texelDir(x, y, w, h)     the unit vector of an equirect texel centre
//
//  SPHERE MAPPING (the same as THREE.SphereGeometry, so maps drop onto it)
//    u = (x + 0.5) / W, theta = (y + 0.5) / H * pi (row 0 is the north pole)
//    p = (-cos(2 pi u) sin(theta), cos(theta), sin(2 pi u) sin(theta))
//    +u is east, -theta is north.
//
//  grep -n targets: "export function simplex3", "export function fbm",
//  "export function fbmEroded", "export function ridged", "export function warp",
//  "export function curl", "export function texelDir", "const ROT"
// ============================================================================

export const TAU = Math.PI * 2;
const F3 = 1 / 3, G3 = 1 / 6;
// The 12 edge gradients of the cube, plus 4 repeats so that h & 15 picks one.
const GX = [1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0, 1, -1, 0, 0];
const GY = [1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, 1, -1, -1];
const GZ = [0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1, 0, 0, 1, -1];
// NORM sets the output range to about [-1, 1] (measured over 2e6 samples
// with r^2 = 0.5: max |n| * NORM = 0.98).
const NORM = 75.4;

// Integer hash of a lattice point and a seed (32-bit, deterministic).
function hash(i, j, k, s) {
  let h = Math.imul(i, 0x8da6b343) ^ Math.imul(j, 0xd8163841) ^ Math.imul(k, 0xcb1ab31f) ^ s;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

// 3D simplex noise. When g is given, g gets d(noise)/d(x, y, z).
export function simplex3(x, y, z, seed, g) {
  const s = (x + y + z) * F3;
  const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
  const t = (i + j + k) * G3;
  const x0 = x - i + t, y0 = y - j + t, z0 = z - k + t;
  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) {
    if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
    else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
  } else {
    if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
    else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
    else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
  }
  let n = 0, dx = 0, dy = 0, dz = 0;
  for (let c = 0; c < 4; c++) {
    let cx, cy, cz, ci, cj, ck;
    if (c === 0) { cx = x0; cy = y0; cz = z0; ci = i; cj = j; ck = k; }
    else if (c === 1) { cx = x0 - i1 + G3; cy = y0 - j1 + G3; cz = z0 - k1 + G3; ci = i + i1; cj = j + j1; ck = k + k1; }
    else if (c === 2) { cx = x0 - i2 + 2 * G3; cy = y0 - j2 + 2 * G3; cz = z0 - k2 + 2 * G3; ci = i + i2; cj = j + j2; ck = k + k2; }
    else { cx = x0 - 1 + 3 * G3; cy = y0 - 1 + 3 * G3; cz = z0 - 1 + 3 * G3; ci = i + 1; cj = j + 1; ck = k + 1; }
    const r = 0.5 - cx * cx - cy * cy - cz * cz;
    if (r <= 0) continue;
    const h = hash(ci, cj, ck, seed) & 15;
    const gx = GX[h], gy = GY[h], gz = GZ[h];
    const gd = gx * cx + gy * cy + gz * cz;
    const r2 = r * r, r4 = r2 * r2;
    n += r4 * gd;
    if (g) {
      const f = -8 * r2 * r * gd;
      dx += f * cx + r4 * gx; dy += f * cy + r4 * gy; dz += f * cz + r4 * gz;
    }
  }
  if (g) { g[0] = dx * NORM; g[1] = dy * NORM; g[2] = dz * NORM; }
  return n * NORM;
}

// A fixed rotation between octaves (orthonormal, about 37 degrees on a
// skew axis). It stops the lattice axes of all octaves from lining up.
const ROT = (() => {
  const a = 0.65, c = Math.cos(a), s = Math.sin(a);
  const k = [0.48, 0.6, 0.64], [x, y, z] = k.map(v => v / Math.hypot(...k));
  return [
    c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s,
    y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s,
    z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c),
  ];
})();
const R = ROT;

// Fractal Brownian motion: sum gain^i * n(freq * lac^i * p), rotated per octave.
export function fbm(p, o, seed) {
  let x = p[0] * o.freq, y = p[1] * o.freq, z = p[2] * o.freq;
  let v = 0, a = 1, norm = 0;
  const oct = o.octaves | 0;
  for (let i = 0; i < oct; i++) {
    v += a * simplex3(x, y, z, (seed + i * 1013) | 0);
    norm += a; a *= o.gain;
    const nx = (R[0] * x + R[1] * y + R[2] * z) * o.lacunarity;
    const ny = (R[3] * x + R[4] * y + R[5] * z) * o.lacunarity;
    const nz = (R[6] * x + R[7] * y + R[8] * z) * o.lacunarity;
    x = nx; y = ny; z = nz;
  }
  // Fractional octaves fade in the last one, so the slider is continuous.
  const fr = o.octaves - oct;
  if (fr > 0) { v += fr * a * simplex3(x, y, z, (seed + oct * 1013) | 0); norm += fr * a; }
  return norm > 0 ? v / Math.sqrt(norm) / 1.1 : 0;
}

// Derivative-damped fBm (the "erosion" fBm of I. Quilez). Each octave adds
// a * n / (1 + k |D|^2), where D sums the gradients of the earlier octaves.
// Steep slopes get less fine detail, so slopes read as smooth gullies and
// the detail collects in flat valley floors and on crests.
const _g = new Float64Array(3);
export function fbmEroded(p, o, seed, k) {
  let x = p[0] * o.freq, y = p[1] * o.freq, z = p[2] * o.freq;
  let v = 0, a = 1, norm = 0, Dx = 0, Dy = 0, Dz = 0, sc = o.freq;
  // M: the rotation from p space to octave space (x_i = sc M p)
  let M = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const oct = Math.ceil(o.octaves);
  for (let i = 0; i < oct; i++) {
    const w = i < (o.octaves | 0) ? 1 : o.octaves - (o.octaves | 0);
    const n = simplex3(x, y, z, (seed + i * 1013) | 0, _g);
    // d n / d p = sc M^T grad
    const gx = (M[0] * _g[0] + M[3] * _g[1] + M[6] * _g[2]) * sc;
    const gy = (M[1] * _g[0] + M[4] * _g[1] + M[7] * _g[2]) * sc;
    const gz = (M[2] * _g[0] + M[5] * _g[1] + M[8] * _g[2]) * sc;
    Dx += a * gx; Dy += a * gy; Dz += a * gz;
    v += w * a * n / (1 + k * (Dx * Dx + Dy * Dy + Dz * Dz) * 0.01);
    norm += w * a; a *= o.gain; sc *= o.lacunarity;
    const nx = (R[0] * x + R[1] * y + R[2] * z) * o.lacunarity;
    const ny = (R[3] * x + R[4] * y + R[5] * z) * o.lacunarity;
    const nz = (R[6] * x + R[7] * y + R[8] * z) * o.lacunarity;
    x = nx; y = ny; z = nz;
    M = [
      R[0] * M[0] + R[1] * M[3] + R[2] * M[6], R[0] * M[1] + R[1] * M[4] + R[2] * M[7], R[0] * M[2] + R[1] * M[5] + R[2] * M[8],
      R[3] * M[0] + R[4] * M[3] + R[5] * M[6], R[3] * M[1] + R[4] * M[4] + R[5] * M[7], R[3] * M[2] + R[4] * M[5] + R[5] * M[8],
      R[6] * M[0] + R[7] * M[3] + R[8] * M[6], R[6] * M[1] + R[7] * M[4] + R[8] * M[7], R[6] * M[2] + R[7] * M[5] + R[8] * M[8],
    ];
  }
  return norm > 0 ? v / Math.sqrt(norm) / 1.1 : 0;
}

// Ridged multifractal (F. K. Musgrave). signal = (1 - |n|)^sharp; each
// octave is weighted by the previous signal, so ridges branch from ridges
// and the lowlands stay smooth. Result in about [0, 1].
export function ridged(p, o, seed, sharp) {
  let x = p[0] * o.freq, y = p[1] * o.freq, z = p[2] * o.freq;
  let v = 0, a = 1, w = 1, norm = 0;
  const oct = Math.ceil(o.octaves);
  for (let i = 0; i < oct; i++) {
    const f = i < (o.octaves | 0) ? 1 : o.octaves - (o.octaves | 0);
    let s = 1 - Math.abs(simplex3(x, y, z, (seed + i * 7919) | 0));
    s = Math.pow(Math.max(s, 0), sharp) * w;
    w = Math.min(1, Math.max(0, s * 1.6));
    v += f * a * s; norm += f * a; a *= o.gain;
    const nx = (R[0] * x + R[1] * y + R[2] * z) * o.lacunarity;
    const ny = (R[3] * x + R[4] * y + R[5] * z) * o.lacunarity;
    const nz = (R[6] * x + R[7] * y + R[8] * z) * o.lacunarity;
    x = nx; y = ny; z = nz;
  }
  return norm > 0 ? v / norm : 0;
}

// Two-level domain warp (q = fbm3(p), out = p + amount * fbm3(p + 2.6 q)).
// The second level folds the first, which gives the swirled, sheared
// coastlines that one warp alone cannot make.
const WO = { freq: 1, octaves: 3, lacunarity: 2.1, gain: 0.5 };
export function warp(p, amount, freq, seed, out) {
  if (!(amount > 0)) { out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; return out; }
  WO.freq = freq;
  const qx = fbm(p, WO, seed + 11), qy = fbm(p, WO, seed + 23), qz = fbm(p, WO, seed + 37);
  const t = [p[0] + 2.6 * qx, p[1] + 2.6 * qy, p[2] + 2.6 * qz];
  out[0] = p[0] + amount * fbm(t, WO, seed + 41);
  out[1] = p[1] + amount * fbm(t, WO, seed + 53);
  out[2] = p[2] + amount * fbm(t, WO, seed + 67);
  return out;
}

// Curl noise on the sphere: v = grad(psi) x p for a stream function psi.
// v is tangent to the sphere and has no divergence on it, so dye that it
// carries stretches into filaments and does not pile up.
export function curl(p, freq, seed, out, octaves = 2) {
  let gx = 0, gy = 0, gz = 0, a = 1, f = freq;
  for (let i = 0; i < octaves; i++) {
    simplex3(p[0] * f, p[1] * f, p[2] * f, (seed + i * 313) | 0, _g);
    gx += a * _g[0]; gy += a * _g[1]; gz += a * _g[2];
    a *= 0.5; f *= 2.03;
  }
  out[0] = gy * p[2] - gz * p[1];
  out[1] = gz * p[0] - gx * p[2];
  out[2] = gx * p[1] - gy * p[0];
  return out;
}

// mulberry32: seeded RNG, values in [0, 1).
export function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A uniform random unit vector.
export function onSphere(rnd, out = [0, 0, 0]) {
  const z = rnd() * 2 - 1, a = rnd() * TAU, r = Math.sqrt(1 - z * z);
  out[0] = r * Math.cos(a); out[1] = z; out[2] = r * Math.sin(a);
  return out;
}

// n points on the Fibonacci spiral: a deterministic, even cover of the
// sphere. Used to measure height quantiles independent of map size.
export function fibonacci(n) {
  const pts = new Float64Array(n * 3), ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * i + 1) / n, r = Math.sqrt(1 - y * y), a = ga * i;
    pts[i * 3] = r * Math.cos(a); pts[i * 3 + 1] = y; pts[i * 3 + 2] = r * Math.sin(a);
  }
  return pts;
}

// The unit vector at an equirect texel centre (THREE.SphereGeometry layout).
export function texelDir(x, y, w, h, out = [0, 0, 0]) {
  const u = (x + 0.5) / w, th = (y + 0.5) / h * Math.PI, st = Math.sin(th);
  out[0] = -Math.cos(TAU * u) * st; out[1] = Math.cos(th); out[2] = Math.sin(TAU * u) * st;
  return out;
}

// East and north unit vectors at a texel (the tangent frame of the maps).
export function texelFrame(x, y, w, h, east, north) {
  const u = (x + 0.5) / w, th = (y + 0.5) / h * Math.PI;
  const cu = Math.cos(TAU * u), su = Math.sin(TAU * u);
  east[0] = su; east[1] = 0; east[2] = cu;
  north[0] = cu * Math.cos(th); north[1] = Math.sin(th); north[2] = -su * Math.cos(th);
}

export const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
export const mix = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
