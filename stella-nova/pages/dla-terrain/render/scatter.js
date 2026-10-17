// ============================================================================
//  DLA TERRAIN  ·  render/scatter.js — where the plants and stones go (no DOM)
// ----------------------------------------------------------------------------
//  Deterministic placement of trees, bushes, rocks, logs, ferns, flowers,
//  reeds and cacti on the LIB Terrain (lib/dla-terrain.js). The same
//  terrain and seed always give the same instances, in any tile order.
//
//  FIELD  makeField(terrain) wraps the Terrain arrays (row major, index
//  z * n + x, texel centres at origin + (i + 0.5) / n * worldSize, the GPU
//  convention) with bilinear samplers and adds two fields of its own:
//  slope (rise over run, from central differences) and the distance to
//  water in metres (a two pass chamfer transform on a grid of at most
//  512 x 512). Water is the sea (height below sea level), a water depth
//  over 5 cm, a river mask over 0.35, or the ocean, river and lake biomes.
//
//  LAYERS  Each layer has a spacing r, a tile size and a maximum distance
//  from the camera (LAYERS). A layer streams its own square tiles. The
//  canopy has two layers: "canopy" (r 3.4 m, to 1.2 km) and "canopyFar"
//  (r 8 m, from 1.1 km to the horizon), and the GPU cross-fades them with
//  a dither in the 1.1 to 1.2 km band (instance word fadeIn / fadeOut).
//
//  POISSON DISC  The candidate grid is global: cell (i, j) of a layer has
//  one candidate at a hashed jitter, with a hashed priority. A candidate
//  lives if hash < density(x, z) and no living neighbour closer than r has
//  a lower priority. All of these depend only on global cell hashes, so a
//  tile gives the same points as its neighbours along a shared edge: no
//  seams, no tile order effects. In sparse land the spacing is random, in
//  dense land it is a blue noise disc pattern.
//
//  DENSITY  density = biome table x moisture x slope gate x height gate
//  x stand noise x water gate. Stands: a low frequency noise cut at a
//  threshold makes forest stands and glades; near the cut, edge shrubs and
//  edge trees get a boost (the "edge" term). Clustering follows the
//  shan-shui idea of a cubed noise gate for plant clumps (ideas only, from
//  pages/shan-shui/mount.js vegetate(), MIT, Lingdong Huang 2018). Rules:
//  no trees in water or on slopes over SLOPE_TREE; reeds and willows only
//  near water; cacti and dry shrubs in desert and savanna; alpine flowers
//  in alpine meadow and grassland glades; dead trees near the treeline;
//  scree stones below cliffs (high slope within 14 m uphill, low slope
//  at the point).
//
//  INSTANCE  Float32Array, STRIDE 8 floats per instance:
//    0 x  1 y (CPU height, the GPU snaps it to terrainHeight)  2 z
//    3 scale (1 = the species reference height)  4 yaw rad
//    5 species index (SPECIES)  6 tint -1..1 (hue and value variation)
//    7 seed 0..1 (wind phase, dither, LOD hysteresis)
//
//  GREP MAP
//    grep -n 'export const SPECIES'        species: kind, height, biomes
//    grep -n 'export const LAYERS'         spacing, tiles, distances
//    grep -n 'export function makeField'   terrain samplers, water distance
//    grep -n 'function layerDensity'       the density rules per layer
//    grep -n 'function pickSpecies'        species choice and clustering
//    grep -n 'export function scatterTile' Poisson disc in one tile
//    grep -n 'export function tilesFor'    the tile set round the camera
//    grep -n 'export function createScatterStream' streaming, budget
// ============================================================================

export const STRIDE = 8;
export const SLOPE_TREE = 0.75;   // rise / run: no trees above (about 37 deg)
export const SLOPE_ANY = 1.4;     // no plants at all above (about 54 deg)

// The contract biome order. Terrain keys are matched by normalised name,
// so 'temperate forest', 'temperate-forest' and 'temperateForest' all fit.
export const BIOME_KEYS = ['ocean', 'beach', 'desert', 'savanna', 'grassland',
  'temperateforest', 'rainforest', 'borealforest', 'tundra', 'barerock', 'snow',
  'wetland', 'river', 'lake', 'scree', 'alpinemeadow'];
export const normKey = (k) => String(k || '').toLowerCase().replace(/[^a-z]/g, '');
const B = Object.fromEntries(BIOME_KEYS.map((k, i) => [k, i]));

// ---------------------------------------------------------------- species
// kind: the ASSETS kind (manifest) that can stand in for the species.
// h: reference height m. layer: the layer that places it. biomes: weight
// per biome key. tags: rules. The order is the GPU species index.
export const SPECIES = [
  { key: 'oak', kind: 'tree', layer: 'canopy', h: 16, biomes: { temperateforest: 1, grassland: 0.25, savanna: 0.05, wetland: 0.1 } },
  { key: 'beech', kind: 'tree', layer: 'canopy', h: 20, biomes: { temperateforest: 0.9, rainforest: 0.3 } },
  { key: 'birch', kind: 'tree', layer: 'canopy', h: 15, biomes: { temperateforest: 0.35, borealforest: 0.35, grassland: 0.1, tundra: 0.05 } },
  { key: 'spruce', kind: 'tree', layer: 'canopy', h: 22, biomes: { borealforest: 1, temperateforest: 0.25, alpinemeadow: 0.25, tundra: 0.08 } },
  { key: 'pine', kind: 'tree', layer: 'canopy', h: 18, biomes: { borealforest: 0.5, temperateforest: 0.2, savanna: 0.05, beach: 0.08, alpinemeadow: 0.12 } },
  { key: 'jungle', kind: 'tree', layer: 'canopy', h: 26, biomes: { rainforest: 1 } },
  { key: 'palm', kind: 'tree', layer: 'canopy', h: 12, biomes: { beach: 0.6, rainforest: 0.25, wetland: 0.05 } },
  { key: 'acacia', kind: 'tree', layer: 'canopy', h: 9, biomes: { savanna: 1, desert: 0.03 } },
  { key: 'willow', kind: 'tree', layer: 'canopy', h: 13, biomes: { wetland: 1, temperateforest: 0.05, grassland: 0.05 }, tags: { nearWater: 1 } },
  { key: 'deadtree', kind: 'tree', layer: 'canopy', h: 11, biomes: { tundra: 0.25, alpinemeadow: 0.12, borealforest: 0.03, desert: 0.02, wetland: 0.05 } },
  { key: 'bush', kind: 'bush', layer: 'understory', h: 1.8, biomes: { temperateforest: 1, grassland: 0.35, rainforest: 0.8, savanna: 0.3, wetland: 0.4, borealforest: 0.35 } },
  { key: 'conifer-young', kind: 'tree', layer: 'understory', h: 3.5, biomes: { borealforest: 1, alpinemeadow: 0.3, temperateforest: 0.15, tundra: 0.15 } },
  { key: 'dryshrub', kind: 'bush', layer: 'understory', h: 1.1, biomes: { desert: 0.7, savanna: 0.8, tundra: 0.4, beach: 0.1, barerock: 0.08, scree: 0.08 } },
  { key: 'cactus', kind: 'cactus', layer: 'understory', h: 4.5, biomes: { desert: 0.6 } },
  { key: 'fern', kind: 'fern', layer: 'ground', h: 0.9, biomes: { temperateforest: 1, rainforest: 1, borealforest: 0.5, wetland: 0.4 } },
  { key: 'flower', kind: 'flower', layer: 'ground', h: 0.45, biomes: { grassland: 0.9, alpinemeadow: 1, temperateforest: 0.12, savanna: 0.15, wetland: 0.2 } },
  { key: 'mushroom', kind: 'mushroom', layer: 'ground', h: 0.18, biomes: { temperateforest: 0.25, borealforest: 0.3, rainforest: 0.2 } },
  { key: 'pebble', kind: 'rock', layer: 'ground', h: 0.25, biomes: { beach: 0.4, desert: 0.3, tundra: 0.4, barerock: 0.7, scree: 1, alpinemeadow: 0.25, river: 0.5 } },
  { key: 'reed', kind: 'reed', layer: 'reeds', h: 1.9, biomes: { wetland: 1, river: 1, lake: 1, grassland: 1, temperateforest: 1, savanna: 1, borealforest: 1, rainforest: 1, beach: 0.3 }, tags: { nearWater: 1 } },
  { key: 'rock', kind: 'rock', layer: 'rocks', h: 0.9, biomes: { barerock: 1, scree: 1, tundra: 0.6, alpinemeadow: 0.5, desert: 0.35, grassland: 0.12, temperateforest: 0.15, borealforest: 0.3, savanna: 0.15, beach: 0.25 } },
  { key: 'boulder', kind: 'boulder', layer: 'rocks', h: 2.6, biomes: { barerock: 0.6, scree: 0.4, tundra: 0.3, alpinemeadow: 0.3, desert: 0.2, borealforest: 0.15, temperateforest: 0.05, grassland: 0.04 } },
  { key: 'log', kind: 'log', layer: 'rocks', h: 0.6, biomes: { temperateforest: 0.35, borealforest: 0.4, rainforest: 0.2 } },
  { key: 'stump', kind: 'stump', layer: 'rocks', h: 0.5, biomes: { temperateforest: 0.2, borealforest: 0.25 } },
];
export const SPECIES_INDEX = Object.fromEntries(SPECIES.map((s, i) => [s.key, i]));

// ---------------------------------------------------------------- layers
// r: Poisson radius m. tile: tile size m. near/far: distance band m in
// which the layer shows (the GPU fades over `band`). minScale: the layer
// only keeps instances at least this big (far layers drop small ones).
export const LAYERS = [
  { key: 'canopy', r: 3.4, tile: 128, near: 0, far: 1200, band: 100, salt: 11 },
  { key: 'canopyFar', r: 8.0, tile: 512, near: 1100, far: 7000, band: 100, salt: 12, of: 'canopy' },
  { key: 'understory', r: 1.6, tile: 64, near: 0, far: 320, band: 40, salt: 21 },
  { key: 'rocks', r: 2.3, tile: 64, near: 0, far: 420, band: 50, salt: 31 },
  { key: 'ground', r: 0.6, tile: 32, near: 0, far: 70, band: 15, salt: 41 },
  { key: 'reeds', r: 0.38, tile: 32, near: 0, far: 90, band: 15, salt: 51 },
];
export const LAYER_INDEX = Object.fromEntries(LAYERS.map((l, i) => [l.key, i]));

// ---------------------------------------------------------------- hashes
function hash3(a, b, c) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
const U = 1 / 4294967296;
// Four independent uniforms per cell from one seed chain.
function cellRand(i, j, salt, k) { return hash3(i, j, (salt * 7919 + k * 104729) | 0) * U; }

// Value noise, smooth, deterministic, period free.
function vnoise(x, z, salt) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const fx = x - xi, fz = z - zi;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash3(xi, zi, salt) * U, b = hash3(xi + 1, zi, salt) * U;
  const c = hash3(xi, zi + 1, salt) * U, d = hash3(xi + 1, zi + 1, salt) * U;
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
export function fbm(x, z, salt, oct = 3) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) { s += a * vnoise(x * f, z * f, salt + o * 31); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- field
export function makeField(t, opts = {}) {
  const n = t.n, ws = t.worldSize, origin = t.origin ?? -ws / 2;
  const sea = t.seaLevel ?? 0;
  const H = t.height, M = t.moisture, F = t.flow, R = t.river, W = t.water, T = t.temperature;
  const BI = t.biome;
  const seed = (opts.seed ?? t.seed ?? t.opts?.seed ?? 1) | 0;
  // biome id -> contract index (via keys when LIB gives a table)
  const remap = new Uint8Array(256).fill(255);
  const table = opts.biomes || t.biomes || null;
  if (table && table.length) {
    for (const b of table) { const k = normKey(b.key ?? b.name); if (k in B) remap[b.id] = B[k]; }
  } else for (let i = 0; i < BIOME_KEYS.length; i++) remap[i] = i;
  const texel = ws / n;
  const toG = (x) => (x - origin) / ws * n - 0.5;
  const clampI = (i) => (i < 0 ? 0 : i > n - 1 ? n - 1 : i);
  function bil(A, x, z, def = 0) {
    if (!A) return def;
    const gx = toG(x), gz = toG(z);
    const x0 = Math.floor(gx), z0 = Math.floor(gz), fx = gx - x0, fz = gz - z0;
    const xa = clampI(x0), xb = clampI(x0 + 1), za = clampI(z0) * n, zb = clampI(z0 + 1) * n;
    const a = A[za + xa], b = A[za + xb], c = A[zb + xa], d = A[zb + xb];
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }
  const nearestIdx = (x, z) => clampI(Math.round(toG(z))) * n + clampI(Math.round(toG(x)));
  const biomeAt = (x, z) => (BI ? remap[BI[nearestIdx(x, z)]] : B.grassland);
  const heightAt = (x, z) => bil(H, x, z);
  // slope per texel (central differences), sampled bilinear
  const SL = new Float32Array(n * n);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const xa = clampI(x - 1), xb = clampI(x + 1), za = clampI(z - 1), zb = clampI(z + 1);
    const dx = (H[z * n + xb] - H[z * n + xa]) / ((xb - xa) * texel);
    const dz = (H[zb * n + x] - H[za * n + x]) / ((zb - za) * texel);
    SL[z * n + x] = Math.hypot(dx, dz);
  }
  const slopeAt = (x, z) => bil(SL, x, z);
  // moisture: the LIB field is 0..1; without it, a guess from the flow
  const moistureAt = M ? (x, z) => bil(M, x, z) : (x, z) => Math.min(1, 0.4 + 0.1 * bil(F, x, z));
  const riverAt = (x, z) => bil(R, x, z);
  const waterDepthAt = (x, z) => bil(W, x, z);
  // temperature 0..1 when LIB has it (used for the treeline)
  let tMin = 0, tMax = 1;
  if (T) { tMin = Infinity; tMax = -Infinity; for (let i = 0; i < T.length; i += 7) { const v = T[i]; if (v < tMin) tMin = v; if (v > tMax) tMax = v; } if (!(tMax > tMin)) { tMin = 0; tMax = 1; } }
  let hMin = Infinity, hMax = -Infinity;
  for (let i = 0; i < H.length; i += 5) { const v = H[i]; if (v < hMin) hMin = v; if (v > hMax) hMax = v; }
  const coldAt = T ? (x, z) => 1 - (bil(T, x, z) - tMin) / (tMax - tMin)
    : (x, z) => Math.max(0, (heightAt(x, z) - sea) / Math.max(1, hMax - sea));

  const isWaterCell = (i) => {
    const h = H[i];
    if (h < sea + 0.25) return true;
    if (W && W[i] > 0.05) return true;
    if (R && R[i] > 0.35) return true;
    if (BI) { const b = remap[BI[i]]; if (b === B.ocean || b === B.river || b === B.lake) return true; }
    return false;
  };
  // water distance on a coarse grid (chamfer 3-4, metres)
  const dn = Math.min(n, opts.distRes ?? 512), step = n / dn, cell = ws / dn;
  const dist = new Float32Array(dn * dn);
  for (let z = 0; z < dn; z++) for (let x = 0; x < dn; x++) {
    // any water texel in the coarse cell
    let w = false;
    const x0 = Math.floor(x * step), z0 = Math.floor(z * step);
    const x1 = Math.max(x0 + 1, Math.floor((x + 1) * step)), z1 = Math.max(z0 + 1, Math.floor((z + 1) * step));
    for (let zz = z0; zz < z1 && !w; zz += Math.max(1, (z1 - z0) >> 1)) for (let xx = x0; xx < x1 && !w; xx += Math.max(1, (x1 - x0) >> 1)) w = isWaterCell(zz * n + xx);
    dist[z * dn + x] = w ? 0 : 1e9;
  }
  const a1 = cell, a2 = cell * Math.SQRT2;
  for (let z = 0; z < dn; z++) for (let x = 0; x < dn; x++) {
    const i = z * dn + x; let d = dist[i];
    if (x > 0) d = Math.min(d, dist[i - 1] + a1);
    if (z > 0) { d = Math.min(d, dist[i - dn] + a1); if (x > 0) d = Math.min(d, dist[i - dn - 1] + a2); if (x < dn - 1) d = Math.min(d, dist[i - dn + 1] + a2); }
    dist[i] = d;
  }
  for (let z = dn - 1; z >= 0; z--) for (let x = dn - 1; x >= 0; x--) {
    const i = z * dn + x; let d = dist[i];
    if (x < dn - 1) d = Math.min(d, dist[i + 1] + a1);
    if (z < dn - 1) { d = Math.min(d, dist[i + dn] + a1); if (x < dn - 1) d = Math.min(d, dist[i + dn + 1] + a2); if (x > 0) d = Math.min(d, dist[i + dn - 1] + a2); }
    dist[i] = d;
  }
  const waterDistAt = (x, z) => {
    const gx = (x - origin) / ws * dn - 0.5, gz = (z - origin) / ws * dn - 0.5;
    const x0 = Math.floor(gx), z0 = Math.floor(gz), fx = gx - x0, fz = gz - z0;
    const c = (i) => (i < 0 ? 0 : i > dn - 1 ? dn - 1 : i);
    const xa = c(x0), xb = c(x0 + 1), za = c(z0) * dn, zb = c(z0 + 1) * dn;
    return (dist[za + xa] * (1 - fx) + dist[za + xb] * fx) * (1 - fz) + (dist[zb + xa] * (1 - fx) + dist[zb + xb] * fx) * fz;
  };
  // The exact water test at a point (texel level, not the coarse grid).
  const isWaterAt = (x, z) => {
    if (heightAt(x, z) < sea + 0.25) return true;
    if (W && waterDepthAt(x, z) > 0.05) return true;
    if (R && riverAt(x, z) > 0.35) return true;
    const b = biomeAt(x, z);
    return b === B.ocean || b === B.river || b === B.lake;
  };
  // cliffAbove on the coarse grid: 0..1, how much cliff (slope over 0.9)
  // stands uphill within about 14 m. Scree fields form below it.
  const cliff = new Float32Array(dn * dn);
  const cg = (i, j) => ((i < 0 || j < 0 || i >= dn || j >= dn) ? 0 : 1);
  const rr = Math.max(1, Math.round(14 / cell));
  for (let j = 0; j < dn; j++) for (let i = 0; i < dn; i++) {
    const x = origin + (i + 0.5) * cell, z = origin + (j + 0.5) * cell;
    const h0 = heightAt(x, z);
    let best = 0;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      for (let s = 1; s <= rr; s++) {
        const ii = i + Math.round(Math.cos(a) * s), jj = j + Math.round(Math.sin(a) * s);
        if (!cg(ii, jj)) continue;
        const px = origin + (ii + 0.5) * cell, pz = origin + (jj + 0.5) * cell;
        if (heightAt(px, pz) < h0 + 2) continue;
        const v = slopeAt(px, pz); const t = Math.min(1, Math.max(0, (v - 0.9) / 0.7));
        if (t > best) best = t;
      }
    }
    cliff[j * dn + i] = best * best * (3 - 2 * best);
  }
  const cliffAt = (x, z) => {
    const gx = (x - origin) / ws * dn - 0.5, gz = (z - origin) / ws * dn - 0.5;
    const x0 = Math.floor(gx), z0 = Math.floor(gz), fx = gx - x0, fz = gz - z0;
    const c = (i) => (i < 0 ? 0 : i > dn - 1 ? dn - 1 : i);
    const xa = c(x0), xb = c(x0 + 1), za = c(z0) * dn, zb = c(z0 + 1) * dn;
    return (cliff[za + xa] * (1 - fx) + cliff[za + xb] * fx) * (1 - fz) + (cliff[zb + xa] * (1 - fx) + cliff[zb + xb] * fx) * fz;
  };
  const inside = (x, z) => x >= origin && z >= origin && x <= origin + ws && z <= origin + ws;
  return { n, worldSize: ws, origin, seaLevel: sea, texel, seed, hMin, hMax,
    heightAt, slopeAt, moistureAt, riverAt, waterDepthAt, waterDistAt, biomeAt,
    coldAt, cliffAt, flowAt: (x, z) => bil(F, x, z), isWaterAt, inside, B };
}

// ---------------------------------------------------------------- density
// Per biome base density of each layer, 0..1 (the share of grid cells that
// may hold a candidate before the Poisson test).
const LAYER_BIOME = {
  canopy: { temperateforest: 0.85, rainforest: 1, borealforest: 0.9, savanna: 0.03, grassland: 0.018, wetland: 0.2, beach: 0.03, tundra: 0.02, alpinemeadow: 0.05, desert: 0.0012 },
  understory: { temperateforest: 0.45, rainforest: 0.7, borealforest: 0.35, savanna: 0.25, grassland: 0.08, wetland: 0.3, desert: 0.12, tundra: 0.25, alpinemeadow: 0.18, beach: 0.04, barerock: 0.02, scree: 0.03 },
  rocks: { barerock: 0.5, scree: 0.85, tundra: 0.22, alpinemeadow: 0.22, desert: 0.12, grassland: 0.03, temperateforest: 0.12, borealforest: 0.16, rainforest: 0.06, savanna: 0.05, beach: 0.06, snow: 0.08, wetland: 0.02 },
  ground: { temperateforest: 0.5, rainforest: 0.7, borealforest: 0.35, grassland: 0.14, alpinemeadow: 0.3, savanna: 0.08, wetland: 0.25, desert: 0.05, tundra: 0.15, beach: 0.12, barerock: 0.18, scree: 0.55, river: 0.1 },
  reeds: {},
};

// The stand noise: forests in stands with glades. Returns { stand 0..1,
// edge 0..1 } at a point. Scale about 180 m.
function standAt(f, x, z) {
  const s = fbm(x / 190, z / 190, f.seed * 13 + 5, 3);
  const w = fbm(x / 45, z / 45, f.seed * 13 + 9, 2);
  const v = s * 0.8 + w * 0.2;
  const cut = 0.42;
  return { stand: smooth(cut - 0.05, cut + 0.07, v), edge: 1 - Math.min(1, Math.abs(v - cut) / 0.07), v };
}

function layerDensity(f, L, x, z) {
  if (!f.inside(x, z)) return 0;
  const key = L.of || L.key;
  const b = f.biomeAt(x, z);
  const bk = BIOME_KEYS[b];
  if (bk === 'ocean' || bk === 'lake' || (bk === 'snow' && key !== 'rocks')) return 0;
  const sl = f.slopeAt(x, z);
  if (sl > SLOPE_ANY && key !== 'rocks') return 0;
  const wd = f.waterDistAt(x, z);
  const moist = f.moistureAt(x, z);
  if (key === 'reeds') {
    // a band on the shore: 0..9 m from water, on flat ground, not cold
    if (sl > 0.35 || wd > 9) return 0;
    if (f.isWaterAt(x, z)) return 0;
    const cold = f.coldAt(x, z);
    if (cold > 0.8 || bk === 'desert' || bk === 'tundra' || bk === 'barerock' || bk === 'scree') return 0;
    const clump = fbm(x / 9, z / 9, f.seed * 17 + 3, 2);
    return (1 - smooth(1.5, 9, wd)) * smooth(0.35, 0.6, clump) * 0.95;
  }
  if (f.isWaterAt(x, z)) return 0;
  let d = LAYER_BIOME[key][bk] ?? 0;
  // near water: willows and wetland shrubs in any mild biome
  const wetEdge = 1 - smooth(4, 30, wd);
  if (key === 'canopy') {
    if (sl > SLOPE_TREE) return 0;
    d *= 1 - smooth(SLOPE_TREE * 0.55, SLOPE_TREE, sl);
    const st = standAt(f, x, z);
    const forest = bk === 'temperateforest' || bk === 'rainforest' || bk === 'borealforest';
    if (forest) d *= 0.12 + 0.88 * st.stand + 0.25 * st.edge;
    else d *= 0.4 + 1.2 * st.edge + 0.6 * st.stand;
    d *= 0.55 + 0.6 * moist;
    d += wetEdge * 0.12 * (1 - f.coldAt(x, z)) * (bk === 'desert' ? 0.5 : 1);
    if (wd < 2.5) d *= 0.25;     // a gap on the very bank
  } else if (key === 'understory') {
    if (sl > 1.0) return 0;
    const st = standAt(f, x, z);
    d *= 0.6 + 1.6 * st.edge;    // forest edges are bushy
    d *= 0.6 + 0.6 * moist;
    d += wetEdge * 0.1;
  } else if (key === 'rocks') {
    // more rock on steep ground and below cliffs (scree fields)
    d *= 0.5 + 0.8 * smooth(0.25, 1.0, sl);
    const up = cliffAbove(f, x, z);
    d += up * 0.75 * (1 - smooth(0.6, 1.1, sl));
    if (sl > 2.2) return 0;
    d += wetEdge * 0.05;          // river stones
  } else if (key === 'ground') {
    const st = standAt(f, x, z);
    const forest = bk === 'temperateforest' || bk === 'rainforest' || bk === 'borealforest';
    // flowers in glades, ferns under the stand
    d *= forest ? 0.5 + 0.7 * st.stand + 0.4 * (1 - st.stand) : 1;
    const clump = fbm(x / 7, z / 7, f.seed * 19 + 1, 2);
    d *= smooth(0.3, 0.62, clump) * 1.6;
    d += cliffAbove(f, x, z) * 0.5;
    if (sl > 1.0) d *= 0.3;
  }
  return Math.max(0, Math.min(1, d));
}

const cliffAbove = (f, x, z) => f.cliffAt(x, z);

// ---------------------------------------------------------------- species
const LAYER_SPECIES = {};
for (let i = 0; i < SPECIES.length; i++) (LAYER_SPECIES[SPECIES[i].layer] ||= []).push(i);

function pickSpecies(f, L, x, z, u) {
  const key = L.of || L.key;
  const list = LAYER_SPECIES[key];
  const bk = BIOME_KEYS[f.biomeAt(x, z)];
  const wd = f.waterDistAt(x, z);
  const cold = f.coldAt(x, z);
  const moist = f.moistureAt(x, z);
  const sl = f.slopeAt(x, z);
  // two stand noises pick the dominant species of a patch (clustering)
  const p1 = fbm(x / 70, z / 70, f.seed * 23 + 7, 2), p2 = fbm(x / 33, z / 33, f.seed * 29 + 3, 2);
  let tot = 0;
  const w = new Float32Array(list.length);
  for (let k = 0; k < list.length; k++) {
    const s = SPECIES[list[k]];
    let v = s.biomes[bk] ?? 0;
    if (!v && !(s.tags?.nearWater && wd < 25)) continue;
    if (s.tags?.nearWater) v = (v || 0.3) * (1 - smooth(6, 28, wd)) * 2.2;
    switch (s.key) {
      case 'oak': v *= 0.6 + p1 * 0.9; break;
      case 'beech': v *= 1.4 - p1 * 1.1; break;
      case 'birch': v *= 0.4 + smooth(0.55, 0.8, p2) * 1.6; break;
      case 'spruce': v *= 0.7 + cold * 0.8; break;
      case 'pine': v *= 0.5 + (1 - moist) * 1.2 + smooth(0.6, 0.9, p2); break;
      case 'deadtree': v *= 0.2 + smooth(0.65, 0.9, cold) * 2 + (moist < 0.2 ? 0.5 : 0); break;
      case 'palm': v *= wd < 60 ? 1.6 : 0.6; break;
      case 'cactus': v *= 1 - moist; break;
      case 'boulder': v *= 0.6 + smooth(0.3, 1.2, sl); break;
      case 'log': case 'stump': v *= 0.6 + standAt(f, x, z).stand; break;
      case 'flower': v *= 0.4 + smooth(0.5, 0.7, p2) * 1.5; break;
      case 'mushroom': v *= moist; break;
      case 'pebble': v *= 0.6 + smooth(0.3, 1.0, sl) + (wd < 6 ? 1 : 0); break;
    }
    w[k] = Math.max(0, v); tot += w[k];
  }
  if (!(tot > 0)) return -1;
  let t = u * tot;
  for (let k = 0; k < list.length; k++) { t -= w[k]; if (t <= 0 && w[k] > 0) return list[k]; }
  return list[list.length - 1];
}

// ---------------------------------------------------------------- tiles
// Is there a canopy candidate (a live cell of the canopy grid, a superset
// of the real trees) within rad of (x, z)? Deterministic, seam free.
function treeNear(f, x, z, rad) {
  const L = LAYERS[LAYER_INDEX.canopy], c = L.r / Math.SQRT2;
  const salt = (L.salt * 131 + f.seed * 7) | 0;
  const gi = Math.floor((x - f.origin) / c), gj = Math.floor((z - f.origin) / c), m = Math.ceil(rad / c);
  for (let j = gj - m; j <= gj + m; j++) for (let i = gi - m; i <= gi + m; i++) {
    const px = f.origin + (i + cellRand(i, j, salt, 0)) * c, pz = f.origin + (j + cellRand(i, j, salt, 1)) * c;
    if ((px - x) ** 2 + (pz - z) ** 2 > rad * rad) continue;
    if (cellRand(i, j, salt, 3) < layerDensity(f, L, px, pz)) return true;
  }
  return false;
}

// One tile of one layer. tx, tz: tile indices (tile origin = origin +
// tx * L.tile). Returns { data: Float32Array, count, layer }.
export function scatterTile(f, layerKey, tx, tz, opts = {}) {
  const L = typeof layerKey === 'string' ? LAYERS[LAYER_INDEX[layerKey]] : layerKey;
  const r = L.r;
  const c = r / Math.SQRT2;                 // grid cell, one candidate each
  const x0 = f.origin + tx * L.tile, z0 = f.origin + tz * L.tile;
  const i0 = Math.floor((x0 - f.origin) / c), j0 = Math.floor((z0 - f.origin) / c);
  const i1 = Math.floor((x0 + L.tile - f.origin) / c), j1 = Math.floor((z0 + L.tile - f.origin) / c);
  const M = 2;                               // margin cells for the disc test
  const W = i1 - i0 + 1 + 2 * M, Hh = j1 - j0 + 1 + 2 * M;
  const px = new Float32Array(W * Hh), pz = new Float32Array(W * Hh), pr = new Float32Array(W * Hh);
  const live = new Uint8Array(W * Hh);
  const salt = (L.salt * 131 + f.seed * 7) | 0;
  const dScale = Math.min(1, opts.density ?? 1);
  for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
    const gi = i0 - M + i, gj = j0 - M + j, k = j * W + i;
    const x = f.origin + (gi + cellRand(gi, gj, salt, 0)) * c;
    const z = f.origin + (gj + cellRand(gi, gj, salt, 1)) * c;
    px[k] = x; pz[k] = z; pr[k] = cellRand(gi, gj, salt, 2);
    const d = layerDensity(f, L, x, z) * dScale;
    live[k] = cellRand(gi, gj, salt, 3) < d ? 1 : 0;
  }
  const out = [];
  const r2 = r * r;
  for (let j = M; j < Hh - M; j++) for (let i = M; i < W - M; i++) {
    const k = j * W + i;
    if (!live[k]) continue;
    const x = px[k], z = pz[k];
    if (x < x0 || z < z0 || x >= x0 + L.tile || z >= z0 + L.tile) continue; // owned by a neighbour tile
    let ok = true;
    for (let dj = -M; dj <= M && ok; dj++) for (let di = -M; di <= M; di++) {
      if (!di && !dj) continue;
      const q = k + dj * W + di;
      if (!live[q]) continue;
      const ex = px[q] - x, ez = pz[q] - z;
      if (ex * ex + ez * ez < r2 && (pr[q] < pr[k] || (pr[q] === pr[k] && q < k))) { ok = false; break; }
    }
    if (!ok) continue;
    const gi = i0 - M + i, gj = j0 - M + j;
    const sp = pickSpecies(f, L, x, z, cellRand(gi, gj, salt, 4));
    if (sp < 0) continue;
    const S = SPECIES[sp];
    if (S.kind === 'tree' && f.slopeAt(x, z) > SLOPE_TREE) continue;
    // rocks, logs and stumps keep clear of tree trunks
    if (L.key === 'rocks' && treeNear(f, x, z, S.key === 'boulder' ? 3.2 : 1.6)) continue;
    // scale: species jitter, larger in moist lowland, smaller in the cold
    const moist = f.moistureAt(x, z), cold = f.coldAt(x, z);
    let s = 0.72 + 0.56 * cellRand(gi, gj, salt, 5);
    if (S.kind === 'tree') s *= (0.85 + 0.3 * moist) * (1 - 0.35 * smooth(0.6, 0.95, cold));
    if (L.key === 'canopyFar') s *= 1.08;
    if (S.key === 'boulder') s *= 0.6 + 1.2 * cellRand(gi, gj, salt, 8);
    const tint = (cellRand(gi, gj, salt, 6) * 2 - 1);
    out.push(x, f.heightAt(x, z), z, s, cellRand(gi, gj, salt, 7) * Math.PI * 2, sp, tint, cellRand(gi, gj, salt, 9));
  }
  return { layer: L.key, tx, tz, data: new Float32Array(out), count: out.length / STRIDE };
}

// Tiles of every layer within its distance band of the camera at (cx, cz).
// Returns an array of { key: 'layer:tx:tz', layer, tx, tz, d }.
export function tilesFor(f, cx, cz, opts = {}) {
  const far = opts.farScale ?? 1;
  const res = [];
  const nTiles = (L) => Math.ceil(f.worldSize / L.tile);
  for (const L of LAYERS) {
    const near = L.near * far, fa = Math.min(L.far * far, opts.maxDist ?? 1e9);
    if (fa <= near) continue;
    const nt = nTiles(L);
    const ta = Math.max(0, Math.floor((cx - fa - f.origin) / L.tile)), tb = Math.min(nt - 1, Math.floor((cx + fa - f.origin) / L.tile));
    const ua = Math.max(0, Math.floor((cz - fa - f.origin) / L.tile)), ub = Math.min(nt - 1, Math.floor((cz + fa - f.origin) / L.tile));
    for (let tz = ua; tz <= ub; tz++) for (let tx = ta; tx <= tb; tx++) {
      const x0 = f.origin + tx * L.tile, z0 = f.origin + tz * L.tile;
      // nearest and farthest point of the tile to the camera
      const nx = Math.max(x0 - cx, 0, cx - x0 - L.tile), nz = Math.max(z0 - cz, 0, cz - z0 - L.tile);
      const dmin = Math.hypot(nx, nz);
      const fx = Math.max(Math.abs(x0 - cx), Math.abs(x0 + L.tile - cx)), fz = Math.max(Math.abs(z0 - cz), Math.abs(z0 + L.tile - cz));
      const dmax = Math.hypot(fx, fz);
      if (dmin > fa || dmax < near - L.band) continue;
      res.push({ key: L.key + ':' + tx + ':' + tz, layer: L.key, tx, tz, d: dmin });
    }
  }
  res.sort((a, b) => a.d - b.d);
  return res;
}

// Streaming: keeps the tile set round the camera, makes at most
// `budgetMs` of new tiles per update (nearest first), and reports the
// change. The GPU module packs the live tiles into its instance buffer.
export function createScatterStream(f, opts = {}) {
  const live = new Map();             // key -> tile
  let version = 0;
  let pending = [];
  let lastCx = NaN, lastCz = NaN;
  const now = opts.now || (() => (globalThis.performance ? performance.now() : Date.now()));
  return {
    field: f,
    tiles: live,
    get version() { return version; },
    get pending() { return pending.length; },
    update(cx, cz, budgetMs = 4) {
      const moved = !(Math.abs(cx - lastCx) < 8 && Math.abs(cz - lastCz) < 8);
      if (moved) {
        lastCx = cx; lastCz = cz;
        const want = tilesFor(f, cx, cz, opts);
        const keep = new Set(want.map((w) => w.key));
        for (const k of live.keys()) if (!keep.has(k)) { live.delete(k); version++; }
        pending = want.filter((w) => !live.has(w.key));
      }
      const t0 = now();
      let made = 0;
      while (pending.length && (now() - t0 < budgetMs || made === 0)) {
        const w = pending.shift();
        live.set(w.key, scatterTile(f, w.layer, w.tx, w.tz, opts));
        made++; version++;
      }
      return made;
    },
    count() { let c = 0; for (const t of live.values()) c += t.count; return c; },
  };
}
