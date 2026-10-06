// ============================================================================
//  VOLUME NOISE  ·  noise-ref.js — the CPU reference port (no DOM, no GPU)
// ----------------------------------------------------------------------------
//  This module is a JavaScript port of TileableVolumeNoise by Sebastien
//  Hillaire (MIT, see LICENSE-TileableVolumeNoise). tests.mjs compares the
//  WGSL output (shaders/noise.wgsl + shaders/gen.wgsl) with it, voxel by
//  voxel. The page uses it only for the hash table (hashTable).
//
//  PORTS  (C++ name -> name here)
//    Tileable3dNoise::hash ........... hash
//    Tileable3dNoise::noise .......... valueNoise
//    Tileable3dNoise::Cells .......... cells
//    Tileable3dNoise::WorleyNoise .... worleyNoise
//    Tileable3dNoise::PerlinNoise .... perlinNoise
//    glm::perlin(vec4, vec4) ......... perlin4Periodic (GLM 0.9.x gtc/noise.inl,
//                                      from the webgl-noise of Stefan Gustavson
//                                      and Ashima Arts; GLM is MIT)
//    main.cpp remap .................. remap
//    main.cpp base shape loop ........ shapeTexel   (128^3 cloud shape)
//    main.cpp erosion loop ........... detailTexel  (32^3 cloud detail)
//
//  FLOAT RULES. The C++ code runs in float. The hash multiplies sin() by
//  43758.5453, so a small error in sin() moves the hash value completely.
//  A GPU sin() for an argument near 20000 is not accurate enough. hash()
//  here does each float step with Math.fround, and the page uploads the
//  hash values as a table (hashTable). The GPU then reads the same float
//  values that the C++ code makes. The other steps use double precision.
//  Their error is less than one 8-bit step.
//
//  SEED. The original has no seed. seed 0 gives the original values. A
//  seed s adds s * SEED_STRIDE to the lattice number n before the hash
//  (Worley), and sets the fourth Perlin coordinate w to perlinW(s).
//
//  QUANTIZE. main.cpp writes unsigned char(255.0f * v), which truncates.
//  q8 does the same. gen.wgsl writes floor(255 v) / 255 to rgba8unorm.
//
//  GREP TARGETS
//    "export function hash"  "export function cells"  "export function perlin4Periodic"
//    "export function perlinNoise"  "export function shapeTexel"  "export function detailTexel"
//    "export function weatherTexel"  "export const RECIPE"
// ============================================================================

const f32 = Math.fround;
const F1951 = f32(1.951), F43758 = f32(43758.5453);

/** main.cpp frequenceMul: the cell-count multipliers of the Perlin-Worley Worley octaves. */
export const FREQ_MUL = [2, 8, 14, 20, 26, 32];
/** Largest Worley cell count the hash table covers (8 cells x 16 for the A channel). */
export const MAX_CELLS = 128;
/** Lattice numbers n = x + 57 y + 113 z for x, y, z < MAX_CELLS. */
export const TABLE_LEN = 171 * MAX_CELLS;
export const SEED_STRIDE = 1000;
/** The fourth Perlin coordinate for a seed (0 for seed 0, as in the original). */
export const perlinW = seed => (seed * 0.6180339887) % 7;

/** The constants of main.cpp. The page lets the user change them. */
export const RECIPE = Object.freeze({
  shapeRes: 128,     // cloudBaseShapeTextureSize
  detailRes: 32,     // cloudErosionTextureSize
  perlinFreq: 8,     // PerlinNoise frequency in the base loop
  perlinOct: 3,      // PerlinNoise octaveCount in the base loop
  pwCells: 4,        // cellCount of the Perlin-Worley block (x frequenceMul)
  gbaCells: 4,       // cellCount of the G, B, A Worley FBM (x 1, 2, 4, 8, 16)
  detailCells: 2,    // cellCount of the erosion texture (x 1, 2, 4, 8)
  seed: 0,
});

const fractF = x => f32(x - Math.floor(x));
const fract = x => x - Math.floor(x);
const mix = (a, b, t) => a + (b - a) * t;
const mod = (x, y) => x - y * Math.floor(x / y);
const clamp01 = x => Math.min(1, Math.max(0, x));

/** Tileable3dNoise::hash, in float steps: fract(sin(n + 1.951) * 43758.5453). */
export function hash(n) {
  return fractF(f32(f32(Math.sin(f32(f32(n) + F1951))) * F43758));
}

/** The table that the GPU reads: table[n] = hash(n + seed * SEED_STRIDE). */
export function hashTable(seed = 0) {
  const t = new Float32Array(TABLE_LEN), off = seed * SEED_STRIDE;
  for (let n = 0; n < TABLE_LEN; n++) t[n] = hash(n + off);
  return t;
}

/** Tileable3dNoise::noise, the hash-based value noise. */
export function valueNoise(x, y, z, seed = 0) {
  const px = Math.floor(x), py = Math.floor(y), pz = Math.floor(z);
  let fx = x - px, fy = y - py, fz = z - pz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const n = px + py * 57 + 113 * pz + seed * SEED_STRIDE;
  return mix(
    mix(mix(hash(n + 0), hash(n + 1), fx), mix(hash(n + 57), hash(n + 58), fx), fy),
    mix(mix(hash(n + 113), hash(n + 114), fx), mix(hash(n + 170), hash(n + 171), fx), fy),
    fz);
}

/**
 * Tileable3dNoise::Cells. The feature point of lattice cell tp is
 * tp + noise(mod(tp, cellCount)) on all three axes (one scalar offset).
 * tp is an integer, so noise() returns hash(n) of that cell.
 */
export function cells(x, y, z, cellCount, seed = 0) {
  const cx = x * cellCount, cy = y * cellCount, cz = z * cellCount;
  const fx = Math.floor(cx), fy = Math.floor(cy), fz = Math.floor(cz);
  let d = 1.0e10;
  for (let xo = -1; xo <= 1; xo++) for (let yo = -1; yo <= 1; yo++) for (let zo = -1; zo <= 1; zo++) {
    const tx = fx + xo, ty = fy + yo, tz = fz + zo;
    const h = valueNoise(mod(tx, cellCount), mod(ty, cellCount), mod(tz, cellCount), seed);
    const dx = cx - tx - h, dy = cy - ty - h, dz = cz - tz - h;
    d = Math.min(d, dx * dx + dy * dy + dz * dz);
  }
  return clamp01(d);
}

/** Tileable3dNoise::WorleyNoise: squared distance to the nearest feature point, in [0, 1]. */
export const worleyNoise = (x, y, z, cellCount, seed = 0) => cells(x, y, z, cellCount, seed);

// ── glm::perlin(vec4 P, vec4 rep), the periodic classic Perlin noise ────────
// The GPU port finds floor(x / 289) and floor(x / 7) with a half-unit bias.
// That gives the same integer as exact division for an integer x, and a fast
// GPU reciprocal cannot move it across an integer. The math is the same.
const mod289 = x => x - Math.floor((x + 0.5) / 289) * 289;
const permute = x => mod289((x * 34 + 1) * x);
const taylorInvSqrt = r => 1.79284291400159 - 0.85373472095314 * r;
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);

// One gradient of the 4D lattice: GLM's gx/gy/gz/gw from a permuted index.
function grad4(i) {
  const q7 = Math.floor((i + 0.5) / 7), q49 = Math.floor((q7 + 0.5) / 7);
  let gx = (i - 7 * q7) / 7 - 0.5, gy = (q7 - 7 * q49) / 7 - 0.5;
  const gz = (q49 - 6 * Math.floor((q49 + 0.5) / 6)) / 6 - 0.5;
  const gw = 0.75 - Math.abs(gx) - Math.abs(gy) - Math.abs(gz);
  const sw = gw <= 0 ? 1 : 0;   // step(gw, 0)
  gx -= sw * ((gx >= 0 ? 1 : 0) - 0.5);
  gy -= sw * ((gy >= 0 ? 1 : 0) - 0.5);
  const k = taylorInvSqrt(gx * gx + gy * gy + gz * gz + gw * gw);
  return [gx * k, gy * k, gz * k, gw * k];
}

/** glm::perlin(vec4 P, vec4 rep): classic Perlin noise with period rep per axis, about [-1, 1]. */
export function perlin4Periodic(P, rep) {
  const Pi0 = P.map((p, a) => mod(Math.floor(p), rep[a]));
  const Pi1 = Pi0.map((p, a) => mod(p + 1, rep[a]));
  const Pf0 = P.map(p => p - Math.floor(p));
  const Pf1 = Pf0.map(p => p - 1);
  const n = (bx, by, bz, bw) => {
    const ixy = permute(permute(bx ? Pi1[0] : Pi0[0]) + (by ? Pi1[1] : Pi0[1]));
    const ixyz = permute(ixy + (bz ? Pi1[2] : Pi0[2]));
    const g = grad4(permute(ixyz + (bw ? Pi1[3] : Pi0[3])));
    return g[0] * (bx ? Pf1[0] : Pf0[0]) + g[1] * (by ? Pf1[1] : Pf0[1]) + g[2] * (bz ? Pf1[2] : Pf0[2]) + g[3] * (bw ? Pf1[3] : Pf0[3]);
  };
  const f = Pf0.map(fade);
  const lerpW = (bx, by, bz) => mix(n(bx, by, bz, 0), n(bx, by, bz, 1), f[3]);
  const lerpZ = (bx, by) => mix(lerpW(bx, by, 0), lerpW(bx, by, 1), f[2]);
  const lerpY = bx => mix(lerpZ(bx, 0), lerpZ(bx, 1), f[1]);
  return 2.2 * mix(lerpY(0), lerpY(1), f[0]);
}

/**
 * Tileable3dNoise::PerlinNoise. Octave weights start at 0.5 and square
 * each octave (0.5, 0.25, 0.0625): the original does weight *= weight.
 * The frequency doubles each octave, and it is also the period.
 * w is the fourth coordinate. The original uses w = 0. This page sets
 * w = perlinW(seed), so a seed gives a new 3D slice of the 4D noise, and
 * x, y, z keep the period.
 */
export function perlinNoise(x, y, z, frequency, octaveCount, w = 0) {
  let sum = 0, weightSum = 0, weight = 0.5;
  for (let oct = 0; oct < octaveCount; oct++) {
    const val = perlin4Periodic([x * frequency, y * frequency, z * frequency, w * frequency], [frequency, frequency, frequency, frequency]);
    sum += val * weight;
    weightSum += weight;
    weight *= weight;
    frequency *= 2;
  }
  return clamp01((sum / weightSum) * 0.5 + 0.5);
}

/** main.cpp remap (GPU Pro 7). */
export const remap = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c);
/** unsigned char(255.0f * v) */
export const q8 = v => Math.floor(f32(255 * f32(v)));

/**
 * The 128^3 base shape texel at voxel (s, t, r) of an N^3 texture.
 * Returns the floats before quantization:
 *   rgba  = [PerlinWorley, worleyFBM0, worleyFBM1, worleyFBM2]  (noiseShape.tga)
 *   parts = [perlinFBM, worleyFBM of the PW block, 1 - Worley(gbaCells), packed]
 * packed is the value main.cpp writes to noiseShapePacked.tga.
 */
export function shapeTexel(s, t, r, N, prm = RECIPE) {
  const x = s / N, y = t / N, z = r / N, sd = prm.seed || 0;
  const perlin = perlinNoise(x, y, z, prm.perlinFreq, prm.perlinOct, perlinW(sd));
  const pw = prm.pwCells;
  // worleyNoise3..5 of the original block are not used in its result.
  const pw0 = 1 - worleyNoise(x, y, z, pw * FREQ_MUL[0], sd);
  const pw1 = 1 - worleyNoise(x, y, z, pw * FREQ_MUL[1], sd);
  const pw2 = 1 - worleyNoise(x, y, z, pw * FREQ_MUL[2], sd);
  const worleyFBM = pw0 * 0.625 + pw1 * 0.25 + pw2 * 0.125;
  const perlinWorley = remap(perlin, 0, 1, worleyFBM, 1);
  const c = prm.gbaCells;
  const w1 = 1 - worleyNoise(x, y, z, c * 2, sd);
  const w2 = 1 - worleyNoise(x, y, z, c * 4, sd);
  const w3 = 1 - worleyNoise(x, y, z, c * 8, sd);
  const w4 = 1 - worleyNoise(x, y, z, c * 16, sd);
  const w0 = 1 - worleyNoise(x, y, z, c * 1, sd);
  const fbm0 = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
  const fbm1 = w2 * 0.625 + w3 * 0.25 + w4 * 0.125;
  const fbm2 = w3 * 0.75 + w4 * 0.25;
  const lowFreqFBM = fbm0 * 0.625 + fbm1 * 0.25 + fbm2 * 0.125;
  const packed = clamp01(remap(perlinWorley, -(1 - lowFreqFBM), 1, 0, 1));
  return { rgba: [perlinWorley, fbm0, fbm1, fbm2], parts: [perlin, worleyFBM, w0, packed] };
}

/**
 * The 32^3 erosion (detail) texel. rgba = [worleyFBM0, worleyFBM1,
 * worleyFBM2, packed]. main.cpp writes 255 to A and the packed value to a
 * second file (noiseErosionPacked.tga); this port keeps packed in A.
 */
export function detailTexel(s, t, r, N, prm = RECIPE) {
  const x = s / N, y = t / N, z = r / N, sd = prm.seed || 0, c = prm.detailCells;
  const w0 = 1 - worleyNoise(x, y, z, c * 1, sd);
  const w1 = 1 - worleyNoise(x, y, z, c * 2, sd);
  const w2 = 1 - worleyNoise(x, y, z, c * 4, sd);
  const w3 = 1 - worleyNoise(x, y, z, c * 8, sd);
  const fbm0 = w0 * 0.625 + w1 * 0.25 + w2 * 0.125;
  const fbm1 = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
  const fbm2 = w2 * 0.75 + w3 * 0.25;
  return { rgba: [fbm0, fbm1, fbm2, fbm0 * 0.625 + fbm1 * 0.25 + fbm2 * 0.125] };
}

/**
 * The 2D weather texel. main.cpp makes no weather texture: this recipe is
 * this page's own, built from the same tileable functions on the plane
 * z = 0.37. R = coverage, G = cloud type (0 stratus .. 1 cumulus).
 */
export function weatherTexel(s, t, N, prm = RECIPE) {
  const x = s / N, y = t / N, sd = prm.seed || 0;
  const p = perlinNoise(x, y, 0.37, 4, 3, perlinW(sd));
  const w = 1 - worleyNoise(x, y, 0.37, 5, sd);
  const cov = clamp01(remap(p * 0.65 + w * 0.35, 0.35, 0.8, 0, 1));
  const type = perlinNoise(x, y, 0.71, 2, 2, perlinW(sd));
  return { rgba: [cov, clamp01(remap(type, 0.3, 0.7, 0, 1)), 0, 1] };
}
