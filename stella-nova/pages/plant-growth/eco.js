// ============================================================================
//  PLANT GROWTH  ·  the ground ecosystem round the plants (DOM-free)
// ----------------------------------------------------------------------------
//  The meadow, the woodland edge and the floor under the crown, as a plant
//  community. Placement runs once per sowing (buildEco). The response to
//  the crown runs in the shaders each frame, from the same fields
//  (ECO_GLSL), so the community changes as the crown grows: sun grass and
//  meadow flowers fade under the spreading crown, and shade grass, ferns
//  and periwinkle come in.
//
//  FIELDS (metres, sun to the south = SUN_XZ, so shade falls north)
//    sward(x, z)   0..1, patches of dense sward and open gaps (1 to 3 m)
//    meadow(x, z)  0..1, tall meadow (1) against short fine sward (0)
//    moist(x, z)   0..1, wet in the hollows of the micro-relief
//    path(x, z)    0..1, a trampled desire line past the tree
//    wood(x, z)    0..1, inside the woodland edge (an arc behind the tree)
//    light(x, z)   0..1, sky light: the crowns (live radius, offset north)
//                  and the woodland. 1 is open sun.
//    drip(x, z)    0..1, the band under the crown edge (the drip line)
//  Each field is in JavaScript and in GLSL. The noise is an integer hash
//  (the same bits in both), not fract(sin()), so the two agree.
//
//  POINT PROCESSES (all seeded)
//    Thomas cluster process: parents Poisson, children Gaussian round
//      them. Grass tussocks (swards of tussocks) and forb drifts.
//    Inhibition: a hard core between large stones (a Strauss process with
//      gamma = 0 at short range), and a Matern II thinning by size between
//      forbs and stones (a smaller plant next to a larger one dies).
//    Stones: sizes from a truncated power law, N(> s) ~ s^-STONE_B, in
//      outcrops (boulders with a halo of cobbles) and a sparse scatter.
//  ripleyL() is the L function (minus sampling) that the tests use.
//
//  SEASONS. grassState(p) gives the height, greenness, seed heads, ripe
//  heads and lodging of grass at year phase p (0 = 1 January). FORBS has
//  the bloom window of each species, the niche (light) and the clusters.
//
//  SEEDLINGS. seedlings() is an individual-based model over the years:
//  each seed-bearing tree drops seeds (gravity or wind kernel), they
//  germinate in spring, and each year a seedling lives with a chance that
//  rises with light. In deep shade most die.
//
//  grep -n targets
//    hash and noise ....... "export function hash3"
//    fields ............... "export function makeFields"
//    light and crowns ..... "export function lightAt"
//    gusts ................ "export function gust"
//    grass seasons ........ "export function grassState"
//    grass kinds .......... "export const GRASS"
//    forb table ........... "export const FORBS"
//    stone sizes .......... "export function stoneSize"
//    point processes ...... "export function thomas"
//    build the community .. "export function buildEco"
//    leaf litter piles .... "function litterPiles"
//    the far meadow ....... "export function procGrass"
//    seedlings ............ "export function seedlings"
//    L function ........... "export function ripleyL"
//    GLSL twin ............ "export const ECO_GLSL"
// ============================================================================
import { rng } from '../../lib/dla-engine.js';
import { groundY, relief, RELIEF_AMP, inCutaway } from './ground.js';

export const SUN_XZ = [Math.cos(0.9), Math.sin(0.9)];   // toward the noon sun (render.js seasonSun)
export const MAX_CROWNS = 12;
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = v => Math.min(1, Math.max(0, v));
const frac = v => v - Math.floor(v);
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ------------------------------------------------------------ hash, noise
// The same bits as ehash() in ECO_GLSL (uint arithmetic mod 2^32).
export function hash3(ix, iz, salt) {
  let h = (Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h >>> 8) / 16777216;
}
export function vnoise(x, z, salt) {
  const ix = Math.floor(x), iz = Math.floor(z);
  let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const a = hash3(ix, iz, salt), b = hash3(ix + 1, iz, salt), c = hash3(ix, iz + 1, salt), d = hash3(ix + 1, iz + 1, salt);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

// --------------------------------------------------------------- fields
// The static fields. params: { path: [dx, dz, offset, phase], edge: [nx,
// nz, dist, on] } from buildEco (seeded).
export const FIELD = {
  sward: [2.3, 0.9],       // noise scales (m)
  meadow: 7.5,
  moist: 11,
  pathW: 0.45,             // half width of the trampled core (m)
  edgeIn: 3,               // m from the edge line to the full wood
};
export function makeFields(params) {
  const P = params.path, E = params.edge;
  const sward = (x, z) => clamp01((0.62 * vnoise(x / FIELD.sward[0], z / FIELD.sward[0], 11) + 0.38 * vnoise(x / FIELD.sward[1], z / FIELD.sward[1], 12) - 0.18) * 1.5);
  const meadow = (x, z) => ss(0.3, 0.7, vnoise(x / FIELD.meadow, z / FIELD.meadow, 13));
  const path = (x, z) => {
    const u = x * P[0] + z * P[1], v = -x * P[1] + z * P[0];
    const c = P[2] + 1.1 * Math.sin(u * 0.11 + P[3]) + 0.5 * Math.sin(u * 0.29 + 2 * P[3]);
    const d = (v - c) / FIELD.pathW;
    return Math.exp(-d * d);
  };
  const edgeR = (x, z) => {
    const r = Math.hypot(x, z) || 1e-6, ca = (x * E[0] + z * E[1]) / r, sa = (z * E[0] - x * E[1]) / r;
    const a = Math.atan2(sa, ca), aa = Math.abs(a);
    return E[2] + 2.5 * Math.sin(3 * a + 1) + 1.5 * Math.sin(7 * a) + 60 * ss(1.0, 1.7, aa);
  };
  const wood = (x, z) => E[3] > 0.5 ? ss(-1, FIELD.edgeIn, Math.hypot(x, z) - edgeR(x, z)) : 0;
  const woodShade = (x, z) => E[3] > 0.5 ? ss(-7, 3, Math.hypot(x, z) - edgeR(x, z)) : 0;
  const moist = (x, z) => clamp01(0.42 + 0.45 * (vnoise(x / FIELD.moist, z / FIELD.moist, 14) - 0.5) - 1.6 * relief(x, z) / RELIEF_AMP * 0.25 + 0.2 * woodShade(x, z));
  return { sward, meadow, path, wood, woodShade, edgeR, moist, params };
}

// crowns: [{ x, z, r, w }] (r live crown radius, w weight: 1 tree, 0.3 fern)
export function coverAt(x, z, crowns) {
  let c = 0;
  for (const k of crowns) {
    if (k.r < 0.05) continue;
    const cx = k.x - SUN_XZ[0] * 0.22 * k.r, cz = k.z - SUN_XZ[1] * 0.22 * k.r;
    const d = Math.hypot(x - cx, z - cz);
    c = Math.max(c, k.w * (1 - ss(0.45 * k.r, 1.12 * k.r, d)));
  }
  return c;
}
export function lightAt(x, z, crowns, F) {
  return (1 - 0.86 * coverAt(x, z, crowns)) * (1 - 0.85 * (F ? F.woodShade(x, z) : 0));
}
export function dripAt(x, z, crowns) {
  let m = 0;
  for (const k of crowns) {
    if (k.r < 1) continue;
    const d = Math.hypot(x - k.x, z - k.z), e = (d - 0.95 * k.r) / (0.16 * k.r + 0.3);
    m = Math.max(m, k.w * Math.exp(-e * e));
  }
  return m;
}

// Gusts: crests that travel downwind at about 5 m/s, bent by a slow cross
// wave, so the meadow shows bands of bent, lighter grass that move.
export function gust(x, z, t, dir = [0.93, 0.37]) {
  const s = x * dir[0] + z * dir[1], q = -x * dir[1] + z * dir[0];
  const g1 = Math.sin(s * 0.42 - t * 2.2 + 0.9 * Math.sin(q * 0.13 + t * 0.17));
  const g2 = Math.sin(s * 0.17 - t * 1.1 + q * 0.05 + 1.7);
  return ss(0.3, 1.0, 0.5 + 0.5 * (0.65 * g1 + 0.35 * g2));
}

// ---------------------------------------------------------- grass seasons
// out: [height share, green, seed heads, ripe, lodging], all 0..1.
// Winter: low brown stubble, lodged. Spring: green-up, new leaves grow.
// Summer: culms with seed heads, then they ripen and the sward cures.
// Autumn: browning and lodging. Snow flattens it.
export const GRASS_CAL = {
  grow: [0.17, 0.42], greenUp: [0.16, 0.32], cure: [0.52, 0.68], die: [0.74, 0.93], compact: [0.9, 1.0],
  head: [0.38, 0.46], headEnd: [0.68, 0.8], ripe: [0.5, 0.62], unlodge: [0.18, 0.34], lodge: [0.78, 0.92],
};
export function grassState(p, kind, snow, out = [0, 0, 0, 0, 0]) {
  const C = GRASS_CAL;
  const grow = ss(C.grow[0], C.grow[1], p), die = ss(C.die[0], C.die[1], p), cmp = ss(C.compact[0], C.compact[1], p);
  let h = 0.38 + 0.62 * grow - 0.25 * die - 0.37 * cmp;
  let green = 0.3 + 0.7 * ss(C.greenUp[0], C.greenUp[1], p) - 0.15 * ss(C.cure[0], C.cure[1], p) - 0.45 * die - 0.1 * cmp;
  let seed = ss(C.head[0], C.head[1], p) * (1 - ss(C.headEnd[0], C.headEnd[1], p));
  const ripe = ss(C.ripe[0], C.ripe[1], p);
  let lodge = 0.75 * (1 - ss(C.unlodge[0], C.unlodge[1], p)) + 0.75 * ss(C.lodge[0], C.lodge[1], p);
  if (kind === 2) { green += 0.25 * (1 - green); seed *= 0.4; }
  if (kind === 3) { seed = 0; h = 0.6 + 0.4 * h; }
  h *= 1 - 0.65 * snow;
  lodge = Math.max(lodge, 0.95 * snow);
  out[0] = h; out[1] = clamp01(green); out[2] = seed; out[3] = ripe; out[4] = clamp01(lodge);
  return out;
}

// Grass kinds. h: blade height at full growth (m). sigma, mu: the Thomas
// cluster (child spread m, children per parent). keep(L): the share of the
// tussocks that grow at light L (the shaders use the same numbers).
export const GRASS = [
  { id: 'meadow', label: 'tall meadow grass (cocksfoot, Yorkshire fog)', h: [0.32, 0.6], spread: [0.05, 0.12], sigma: 0.28, mu: 7, keep: [0.22, 0.7, 0.0] },
  { id: 'fine', label: 'fine sward (fescues, bents)', h: [0.2, 0.34], spread: [0.06, 0.14], sigma: 0.55, mu: 10, keep: [0.12, 0.55, 0.15] },
  { id: 'shade', label: 'shade grass (wood meadow-grass)', h: [0.22, 0.4], spread: [0.04, 0.09], sigma: 0.35, mu: 4, keep: [0.5, 0.85, -1] },
  { id: 'path', label: 'trampled turf (rye-grass) at the path', h: [0.05, 0.12], spread: [0.05, 0.1], sigma: 0.16, mu: 4, keep: [0.2, 0.7, 0.0] },
];
// keep: [a, b, floor]. floor >= 0: floor + (1 - floor) smoothstep(a, b, L);
// floor < 0: 1 - smoothstep(a, b, L) (a shade plant that sun grass beats).
export function grassKeep(kind, L) {
  const k = GRASS[kind].keep;
  return k[2] < 0 ? 1 - ss(k[0], k[1], L) : k[2] + (1 - k[2]) * ss(k[0], k[1], L);
}

// ----------------------------------------------------------------- forbs
// assets: nature pack ids (stella-nova/assets/nature). scale: the mesh
// scale range (the height is the asset height times the scale). niche:
// [lo, hi] of light (vigour = smoothstep round lo times one minus
// smoothstep round hi). prior: where the drifts start ('open', 'edge',
// 'shade', 'path', 'drip', 'base'). sigma, mu: the Thomas drift. life:
// [emerge, full, senesce, gone] in year phase (an evergreen keeps a winter
// share). bloom: [open, end] (null: no showy bloom). petal: petal colour.
// h0: a typical height of the asset at scale 1 (m; the manifest has each).
export const FORBS = [
  { id: 'celandine', h0: 0.18, label: 'lesser celandine', kind: 'flower', assets: ['celandine_01_a', 'celandine_01_b'], scale: [0.6, 0.9], niche: [0.12, 1.1], moist: 0.65, prior: 'edge', sigma: 0.45, mu: 14, n: 7, life: [0.12, 0.2, 0.36, 0.44], winter: 0, bloom: [0.19, 0.31], petal: '#f2cf1d' },
  { id: 'dandelion', h0: 0.14, label: 'dandelion', kind: 'flower', assets: ['dandelion_01_a', 'dandelion_01_b'], scale: [1.0, 1.7], niche: [0.5, 1.3], moist: 0.5, prior: 'open', sigma: 1.1, mu: 6, n: 7, life: [0.18, 0.28, 0.85, 0.98], winter: 0.35, bloom: [0.28, 0.4], petal: '#f4c21a' },
  { id: 'buttercup', h0: 0.22, label: 'meadow buttercup', kind: 'flower', assets: ['flower_empodium_a', 'flower_empodium_b'], scale: [1.0, 1.5], niche: [0.45, 1.3], moist: 0.7, prior: 'open', sigma: 1.0, mu: 16, n: 6, life: [0.22, 0.34, 0.7, 0.85], winter: 0.2, bloom: [0.36, 0.52], petal: '#f6d42a' },
  { id: 'daisy', h0: 0.15, label: 'oxeye daisy', kind: 'flower', assets: ['flower_ursinia_a', 'flower_ursinia_b', 'flower_ursinia_c'], scale: [1.5, 2.4], niche: [0.6, 1.3], moist: 0.3, prior: 'open', sigma: 0.9, mu: 18, n: 7, life: [0.24, 0.36, 0.72, 0.86], winter: 0.25, bloom: [0.42, 0.58], petal: '#f4f1e6' },
  { id: 'bellflower', h0: 0.32, label: 'blue edge flower', kind: 'flower', assets: ['flower_heliophila_b', 'flower_heliophila_c'], scale: [0.8, 1.2], niche: [0.32, 0.95], moist: 0.5, prior: 'edge', sigma: 0.7, mu: 10, n: 5, life: [0.26, 0.38, 0.7, 0.84], winter: 0, bloom: [0.45, 0.62], petal: '#7c8be0' },
  { id: 'periwinkle', h0: 0.3, label: 'lesser periwinkle', kind: 'flower', assets: ['periwinkle_plant_a', 'periwinkle_plant_b', 'periwinkle_plant_c'], scale: [0.7, 1.0], niche: [0.0, 0.6], moist: 0.55, prior: 'shade', sigma: 0.55, mu: 16, n: 5, life: [0, 0.3, 0.95, 1], winter: 0.8, bloom: [0.27, 0.42], petal: '#7d7fd8' },
  { id: 'nettle', h0: 0.17, label: 'stinging nettle', kind: 'herb', assets: ['nettle_plant_a', 'nettle_plant_c'], scale: [2.2, 3.0], niche: [0.25, 0.92], moist: 0.65, prior: 'edge', sigma: 0.5, mu: 12, n: 4, life: [0.22, 0.4, 0.8, 0.92], winter: 0, bloom: null, petal: null },
  { id: 'plantain', h0: 0.064, label: 'greater plantain', kind: 'herb', assets: ['weed_plant_02_a', 'weed_plant_02_b'], scale: [1.2, 1.8], niche: [0.35, 1.3], moist: 0.5, prior: 'path', sigma: 0.4, mu: 5, n: 7, life: [0.2, 0.3, 0.85, 0.97], winter: 0.4, bloom: null, petal: null },
  { id: 'fern', h0: 0.32, label: 'male fern', kind: 'fern', assets: ['fern_02_a', 'fern_02_b', 'fern_02_c', 'fern_02_d'], scale: [1.2, 2.0], niche: [-0.2, 0.55], moist: 0.7, prior: 'shade', sigma: 0.6, mu: 6, n: 4, life: [0.28, 0.4, 0.8, 0.92], winter: 0, bloom: null, petal: null },
  { id: 'mushroom', h0: 0.135, label: 'bolete (with the tree roots)', kind: 'fungus', assets: ['rubberduck_mushrooms_a', 'rubberduck_mushrooms_b'], scale: [0.7, 1.0], niche: [-0.2, 0.7], moist: 0.6, prior: 'drip', sigma: 0.3, mu: 5, n: 4, life: [0.71, 0.75, 0.83, 0.88], winter: 0, bloom: null, petal: null },
  { id: 'moss', h0: 0.027, label: 'moss cushions', kind: 'moss', assets: ['moss_01_a', 'moss_01_b'], scale: [1.5, 3.0], niche: [-0.2, 0.75], moist: 0.7, prior: 'base', sigma: 0.35, mu: 9, n: 8, life: [0, 0.1, 0.95, 1], winter: 1, bloom: null, petal: null },
];
export const FORB_IDS = FORBS.map(f => f.id);

// The vigour of a forb at light L (0..1): its niche.
export function niche(f, L) {
  return ss(f.niche[0] - 0.12, f.niche[0] + 0.12, L) * (1 - ss(f.niche[1] - 0.12, f.niche[1] + 0.12, L));
}
// The size share of a forb through the year (0..1): emerge, full, senesce, gone.
export function forbLife(f, p) {
  const l = f.life, up = ss(l[0], l[1], p), down = ss(l[2], l[3], p);
  return Math.max(f.winter, up * (1 - down));
}
// 1 while the flowers are open, 0 before and after (petals fall at the end).
export function bloomAt(f, p) {
  if (!f.bloom) return 0;
  return ss(f.bloom[0] - 0.02, f.bloom[0] + 0.015, p) * (1 - ss(f.bloom[1] - 0.015, f.bloom[1] + 0.02, p));
}

// ---------------------------------------------------------------- stones
// Size s = the longest horizontal extent (m). A truncated power law:
// N(> s) ~ s^-STONE_B between STONE_MIN and STONE_MAX.
export const STONE_B = 1.7, STONE_MIN = 0.02, STONE_MAX = 1.8;
export function stoneSize(u) {
  const a = Math.pow(STONE_MIN, -STONE_B), b = Math.pow(STONE_MAX, -STONE_B);
  return Math.pow(a - u * (a - b), -1 / STONE_B);
}
export const STONE_CLASSES = [
  { id: 'pebble', max: 0.1, assets: ['stone_01', 'rock_09'] },
  { id: 'cobble', max: 0.4, assets: ['rock_07', 'stone_01', 'boulder_01'] },
  { id: 'boulder', max: 99, assets: ['boulder_01', 'rock_moss_set_02_a', 'rock_moss_set_02_b', 'rock_moss_set_01_c'] },
];
export function stoneClass(s) { return s < STONE_CLASSES[0].max ? 0 : s < STONE_CLASSES[1].max ? 1 : 2; }

// ------------------------------------------------------- point processes
function gauss(r) { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
function poisson(r, mean) { let k = 0, p = Math.exp(-mean), s = p; const u = r(); while (u > s && k < 200) { k++; p *= mean / k; s += p; } return k; }
// A Thomas cluster process in the disc of radius R. intensity(x, z) in
// 0..1 thins the children (an inhomogeneous process). Returns [[x, z]].
export function thomas(r, { R, parents, sigma, mu, intensity, max = Infinity, centre = null }) {
  const out = [];
  for (let p = 0; p < parents && out.length < max; p++) {
    let px, pz;
    if (centre) { const c = centre(r); px = c[0]; pz = c[1]; }
    else { const a = r() * Math.PI * 2, d = R * Math.sqrt(r()); px = Math.cos(a) * d; pz = Math.sin(a) * d; }
    const n = poisson(r, mu);
    for (let k = 0; k < n && out.length < max; k++) {
      const x = px + gauss(r) * sigma, z = pz + gauss(r) * sigma;
      if (x * x + z * z > R * R) continue;
      if (intensity && r() > intensity(x, z)) continue;
      out.push([x, z]);
    }
  }
  return out;
}

// --------------------------------------------------------- the community
// opts: seed, plants [{ x, z, species, form, rMature }], cut (cut-away
// radius or 0), limits { tussocks, forbs, stones, litter, woodland,
// seedlings } (layout.js ecoLimits), R (the grass radius).
// Returns { params, fields, tussocks (Float32Array, 8 per tussock: x, z,
// kind, height, spread, rand, rank, widthK), forbs [...], stones [...],
// litter (Float32Array, 8 per leaf), woodland [...], shrubs [...] }.
export const ECO_R = 24;
export function buildEco(opts) {
  const seed = (opts.seed ?? 7) >>> 0, r = rng((seed * 48271 + 101) >>> 0 || 1);
  const L = opts.limits || { tussocks: 26000, forbs: 1100, stones: 1400, litter: 7000, woodland: 520, seedlings: 160 };
  const R = opts.R ?? ECO_R;
  const plants = opts.plants && opts.plants.length ? opts.plants : [{ x: 0, z: 0, species: 'oak', form: 'tree', rMature: 6.7 }];
  // the path runs across the view behind the tree; the wood is behind it
  const pa = -Math.PI / 4 + (r() - 0.5) * 0.5;
  const ea = -0.75 * Math.PI + (r() - 0.5) * 0.6;
  const params = {
    path: [Math.cos(pa), Math.sin(pa), -(6.2 + 1.6 * r()), r() * 6.28],
    edge: [Math.cos(ea), Math.sin(ea), 22.5 + 3 * r(), 1],
  };
  const F = makeFields(params);
  const potential = plants.map(p => ({ x: p.x, z: p.z, r: p.rMature, w: p.form === 'tree' ? 1 : 0.3 }));
  const Lpot = (x, z) => lightAt(x, z, potential, F);
  const cut = opts.cut || 0;
  const onPad = (x, z, pad) => {
    if (cut && inCutaway(x, z, cut + pad)) return true;
    for (const p of plants) if (Math.hypot(x - p.x, z - p.z) < (p.form === 'tree' ? 0.35 : 0.22) + pad) return true;
    return false;
  };

  // --- stones first: they exclude plants -----------------------------------
  const stones = [];
  const nOut = 2 + Math.floor(r() * 3), outcrops = [];
  for (let k = 0, tries = 0; k < nOut && tries < 300; tries++) {
    const a = r() * Math.PI * 2, d = 5 + (R - 5) * Math.sqrt(r()), x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (onPad(x, z, 3) || F.path(x, z) > 0.2) continue;
    if (outcrops.some(o => Math.hypot(o[0] - x, o[1] - z) < 7)) continue;
    outcrops.push([x, z]); k++;
  }
  const sizes = [];
  for (let k = 0; k < L.stones; k++) sizes.push(stoneSize(r()));
  sizes.sort((a, b) => b - a);   // the largest first: a hard core for them
  const clear = (x, z, s) => {
    for (const o of stones) {
      if (o.s < 0.12 && s < 0.12) continue;
      const lim = 0.55 * (o.s + s) + (o.s > 0.35 && s > 0.35 ? 0.35 : 0);
      if (Math.abs(o.x - x) < lim && Math.abs(o.z - z) < lim && Math.hypot(o.x - x, o.z - z) < lim) return false;
    }
    return true;
  };
  for (const s of sizes) {
    const big = s > 0.35, mid = s > 0.1;
    for (let t = 0; t < 30; t++) {
      let x, z;
      const u = r();
      if (outcrops.length && (big || (mid && u < 0.55) || (!mid && u < 0.3))) {
        const o = outcrops[Math.floor(r() * outcrops.length)], sg = big ? 1.4 : mid ? 2.0 : 2.6;
        x = o[0] + gauss(r) * sg; z = o[1] + gauss(r) * sg;
      } else if (!mid && u < 0.55) {   // pebbles at the path, where the turf wears thin
        const v = (r() - 0.5) * 2 * R, c = params.path, off = c[2] + 1.1 * Math.sin(v * 0.11 + c[3]) + 0.5 * Math.sin(v * 0.29 + 2 * c[3]) + gauss(r) * 0.5;
        x = v * c[0] - off * c[1]; z = v * c[1] + off * c[0];
      } else { const a = r() * Math.PI * 2, d = R * Math.sqrt(r()); x = Math.cos(a) * d; z = Math.sin(a) * d; }
      if (x * x + z * z > R * R || onPad(x, z, s * 0.6 + 0.1)) continue;
      if (big && F.path(x, z) > 0.3) continue;
      if (!clear(x, z, s)) continue;
      const cls = stoneClass(s), A = STONE_CLASSES[cls].assets;
      stones.push({ x, z, s, cls, asset: A[Math.floor(r() * A.length)], rot: r() * Math.PI * 2, tilt: (r() - 0.5) * (big ? 0.12 : 0.5), sink: big ? 0.18 + 0.22 * r() : 0.25 + 0.3 * r(), rand: r() });
      break;
    }
  }

  // --- grass tussocks (Thomas clusters by kind, a radial LOD) ---------------
  const intensity = [
    (x, z) => Math.pow(F.sward(x, z), 1.4) * (1 - 0.92 * F.path(x, z)) * (0.35 + 0.65 * F.meadow(x, z)) * (1 - 0.9 * F.wood(x, z)),
    (x, z) => (0.3 + 0.7 * F.sward(x, z)) * (1 - 0.75 * F.path(x, z)) * (1 - 0.6 * F.meadow(x, z)) * (1 - 0.8 * F.wood(x, z)),
    (x, z) => 0.7 * (1 - ss(0.4, 0.85, Lpot(x, z))) * (0.4 + 0.6 * F.sward(x, z)),
    (x, z) => { const p = F.path(x, z); return p > 0.08 && p < 0.75 ? 1 : 0; },
  ];
  const lodW = d => Math.min(1, Math.pow(7 / Math.max(7, d), 1.1));
  const bigStones = stones.filter(s => s.s > 0.08);
  const tuss = new Float32Array(L.tussocks * 8);
  let nt = 0;
  for (let guard = 0; nt < L.tussocks && guard < L.tussocks * 3; guard++) {
    const a = r() * Math.PI * 2, d = R * Math.sqrt(r()), px = Math.cos(a) * d, pz = Math.sin(a) * d;
    if (r() > lodW(d)) continue;
    const w = intensity.map(f => f(px, pz)), sum = w[0] + w[1] + w[2] + w[3];
    if (sum < 1e-3) continue;
    let u = r() * sum, kind = 0; while (kind < 3 && u > w[kind]) { u -= w[kind]; kind++; }
    const G = GRASS[kind], n = poisson(r, G.mu);
    for (let c = 0; c < n && nt < L.tussocks; c++) {
      const x = px + gauss(r) * G.sigma, z = pz + gauss(r) * G.sigma;
      const dd = Math.hypot(x, z);
      if (dd > R || onPad(x, z, 0.05)) continue;
      if (r() > Math.min(1, intensity[kind](x, z) * 1.3)) continue;
      let blocked = false;
      for (const s of bigStones) if (s.s > 0.08 && Math.abs(s.x - x) < s.s * 0.5 && Math.abs(s.z - z) < s.s * 0.5) { blocked = true; break; }
      if (blocked) continue;
      const q = nt * 8, wk = 1 / Math.sqrt(lodW(dd));
      tuss[q] = x; tuss[q + 1] = z; tuss[q + 2] = kind;
      tuss[q + 3] = G.h[0] + (G.h[1] - G.h[0]) * (0.35 * r() + 0.65 * F.meadow(x, z) * (kind === 0 ? 1 : 0.5)) * (0.8 + 0.4 * F.moist(x, z));
      tuss[q + 4] = (G.spread[0] + (G.spread[1] - G.spread[0]) * r()) * Math.min(1.8, wk);
      tuss[q + 5] = r(); tuss[q + 6] = r() * 0.92; tuss[q + 7] = wk;
      nt++;
    }
  }
  const tussocks = tuss.subarray(0, nt * 8);

  // --- forbs: drifts by species, then a Matern II thinning by size ----------
  const forbs = [];
  const prior = {
    open: (x, z) => Lpot(x, z) * (1 - F.wood(x, z)) * (1 - 0.8 * F.path(x, z)),
    edge: (x, z) => { const l = Lpot(x, z); return Math.exp(-Math.pow((l - 0.55) / 0.22, 2)); },
    shade: (x, z) => 1 - ss(0.35, 0.75, Lpot(x, z)),
    path: (x, z) => { const p = F.path(x, z); return p > 0.15 ? 1 : 0; },
    drip: (x, z) => Math.max(...potential.map(p => Math.exp(-Math.pow((Math.hypot(x - p.x, z - p.z) - 0.85 * p.r) / 1.2, 2)) * p.w)),
    base: (x, z) => Math.max(...potential.map(p => p.w * Math.exp(-Math.pow(Math.hypot(x - p.x + SUN_XZ[0] * 0.35, z - p.z + SUN_XZ[1] * 0.35) / 0.9, 2)))),
  };
  const budget = L.forbs;
  const total = FORBS.reduce((s, f) => s + f.n * f.mu, 0);
  for (let fi = 0; fi < FORBS.length; fi++) {
    const f = FORBS[fi], pr = prior[f.prior];
    const want = Math.max(4, Math.round(budget * f.n * f.mu / total));
    // parents at points the prior likes (rejection), children in a drift
    const centre = rr => {
      for (let t = 0; t < 60; t++) {
        const a = rr() * Math.PI * 2, d = R * Math.sqrt(rr()), x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (rr() < pr(x, z)) return [x, z];
      }
      if (f.prior === 'base' || f.prior === 'drip') { const p = plants[0]; return [p.x - SUN_XZ[0] * 0.6, p.z - SUN_XZ[1] * 0.6]; }
      return [0, 0];
    };
    const pts = thomas(r, { R, parents: f.n * 3, sigma: f.sigma, mu: f.mu, max: want, centre,
      intensity: (x, z) => clamp01(pr(x, z) * 1.4) * (1 - Math.abs(F.moist(x, z) - f.moist) * 0.8) });
    for (const [x, z] of pts) {
      if (onPad(x, z, f.prior === 'base' ? 0.12 : 0.1)) continue;
      const A = f.assets[Math.floor(r() * f.assets.length)];
      const sc = f.scale[0] + (f.scale[1] - f.scale[0]) * r();
      forbs.push({ sp: fi, id: f.id, asset: A, x, z, scale: sc, rot: r() * Math.PI * 2, rand: r(), rad: 0.06 + 0.12 * sc * (f.kind === 'fern' ? 1.6 : f.kind === 'moss' ? 0.3 : 0.6) });
    }
  }
  // Matern II: in random order of marks, a forb dies if an earlier (larger)
  // forb or a stone is closer than the sum of their radii.
  forbs.sort((a, b) => b.rad - a.rad || a.rand - b.rand);
  const kept = [];
  for (const f of forbs) {
    let ok = true;
    for (const s of bigStones) if (Math.hypot(s.x - f.x, s.z - f.z) < s.s * 0.5 + f.rad * 0.5) { ok = false; break; }
    if (ok) for (const g of kept) if (Math.abs(g.x - f.x) < 0.6 && Math.hypot(g.x - f.x, g.z - f.z) < (g.rad + f.rad) * 0.6) { ok = false; break; }
    if (ok) kept.push(f);
  }
  // moss also grows on the shady side of the boulders
  const mossI = FORB_IDS.indexOf('moss');
  for (const s of stones) {
    if (s.s < 0.5) continue;
    for (let k = 0; k < 5; k++) {
      const a = Math.atan2(-SUN_XZ[1], -SUN_XZ[0]) + (r() - 0.5) * 1.8, d = s.s * (0.5 + 0.12 * r());
      kept.push({ sp: mossI, id: 'moss', asset: FORBS[mossI].assets[k % 2], x: s.x + Math.cos(a) * d, z: s.z + Math.sin(a) * d, scale: 2 + r(), rot: r() * 6.28, rand: r(), rad: 0.05 });
    }
  }
  for (const f of kept) f.y = groundY(f.x, f.z);
  for (const s of stones) s.y = groundY(s.x, s.z);

  // --- the woodland: the edge belt behind the tree, and far stands ----------
  const woodland = [], shrubs = [];
  const WOOD = ['mantissa_generic_furrowed_a', 'mantissa_generic_furrowed_b', 'mantissa_generic_smooth_a', 'mantissa_generic_smooth_b', 'mantissa_birch_a', 'mantissa_birch_b', 'mantissa_birch_c', 'fir_tree_01_b', 'pine_tree_01_b'];
  const put = (x, z, sp) => { woodland.push({ x, z, y: groundY(x, z), asset: WOOD[sp], scale: 0.85 + 0.35 * r(), rot: r() * 6.28, rand: r() }); };
  const tooClose = (x, z, d) => woodland.some(o => Math.abs(o.x - x) < d && Math.hypot(o.x - x, o.z - z) < d);
  for (let t = 0; t < 9000 && woodland.length < L.woodland * 0.35; t++) {
    const a = Math.atan2(params.edge[1], params.edge[0]) + (r() - 0.5) * 3.2, d0 = F.edgeR(Math.cos(a), Math.sin(a));
    const d = d0 + 1.5 + 26 * r() * r();
    if (d > 80) continue;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (tooClose(x, z, 4.4)) continue;
    // birch at the edge (a pioneer), oaks and limes inside, a few conifers
    const inner = d - d0, u = r();
    put(x, z, inner < 6 && u < 0.25 ? 4 + Math.floor(r() * 3) : u < 0.9 ? Math.floor(r() * 4) : 7 + Math.floor(r() * 2));
  }
  for (let t = 0; t < 20000 && woodland.length < L.woodland; t++) {
    const a = r() * Math.PI * 2, d = 85 + 130 * Math.sqrt(r()), x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (vnoise(x / 38, z / 38, 21) < 0.45) continue;   // stands and fields
    if (tooClose(x, z, 6.5)) continue;
    const u = r(); put(x, z, u < 0.75 ? Math.floor(r() * 4) : u < 0.85 ? 4 + Math.floor(r() * 3) : 7 + Math.floor(r() * 2));
  }
  // the shrub mantle along the edge (hazel, hawthorn scale bushes, 1.5 to
  // 3 m), two loose rows, and an understory a few metres into the wood
  const SHRUB = ['nobiax_bushes_a', 'nobiax_bushes_d', 'shrub_02_a', 'shrub_02_c'];
  const nShrub = Math.round(L.woodland * 0.3);
  for (let t = 0; t < 6000 && shrubs.length < nShrub; t++) {
    const a = Math.atan2(params.edge[1], params.edge[0]) + (r() - 0.5) * 2.6, under = r() < 0.3;
    const d = F.edgeR(Math.cos(a), Math.sin(a)) + (under ? 2 + 9 * r() : -1.2 + 2.6 * r());
    if (d > 60) continue;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (shrubs.some(o => Math.abs(o.x - x) < 1.3 && Math.hypot(o.x - x, o.z - z) < (under ? 2.2 : 1.25))) continue;
    shrubs.push({ x, z, y: groundY(x, z), asset: SHRUB[Math.floor(r() * SHRUB.length)], scale: (under ? 1.0 : 1.25) + 0.6 * r(), rot: r() * 6.28, rand: r() });
  }

  // the stump of an old tree, out in the meadow toward the wood
  let stump = null;
  for (let t = 0; t < 80 && !stump; t++) {
    const a = Math.atan2(params.edge[1], params.edge[0]) + (r() - 0.5) * 2.2, d = 9 + 7 * r(), x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (onPad(x, z, 1.2) || F.path(x, z) > 0.01 || bigStones.some(s => Math.hypot(s.x - x, s.z - z) < s.s * 0.5 + 1)) continue;
    stump = { asset: 'tree_stump_01', x, z, y: groundY(x, z), scale: 0.9 + 0.3 * r(), rot: r() * 6.28, rand: r(), tilt: 0 };
  }
  const litter = litterPiles(r, plants, stones, F, L.litter, onPad);
  return { params, fields: F, plants, tussocks, forbs: kept, stones, litter, woodland, shrubs, outcrops, stump };
}

// Leaf litter that drifts: candidate points round each deciduous tree,
// kept with a weight that is high in the hollows of the relief, on the
// downwind side of stones, at the trunk base and at the path edge. Each
// record (8 floats): x, z, rot, rand, rank, plant, size, tilt.
const WIND_XZ = [0.93, 0.37];
function litterPiles(r, plants, stones, F, n, onPad) {
  const out = new Float32Array(n * 8);
  stones = stones.filter(s => s.s >= 0.15);
  const trees = plants.map((p, k) => ({ p, k })).filter(o => o.p.form === 'tree');
  let m = 0;
  for (let t = 0; t < n * 12 && m < n && trees.length; t++) {
    const { p, k } = trees[Math.floor(r() * trees.length)];
    const a = r() * Math.PI * 2, d = p.rMature * 1.5 * Math.sqrt(r());
    const x = p.x + Math.cos(a) * d + WIND_XZ[0] * 0.8, z = p.z + Math.sin(a) * d + WIND_XZ[1] * 0.8;
    if (onPad(x, z, 0.02)) continue;
    let w = 0.12 + 1.6 * clamp01(-relief(x, z) / RELIEF_AMP * 1.4);
    for (const s of stones) {
      const dx = x - s.x, dz = z - s.z, dd = Math.hypot(dx, dz);
      if (dd < s.s * 0.45) { w = 0; break; }
      const lee = (dx * WIND_XZ[0] + dz * WIND_XZ[1]) / (dd || 1);
      w += 1.8 * Math.exp(-Math.pow((dd - s.s * 0.55) / (0.12 + 0.25 * s.s), 2)) * (0.35 + 0.65 * Math.max(0, lee));
    }
    w += 1.5 * Math.exp(-Math.pow((Math.hypot(x - p.x, z - p.z) - 0.45) / 0.35, 2));
    const pth = F.path(x, z); w += 0.8 * (pth > 0.2 && pth < 0.6 ? 1 : 0) - 0.9 * (pth > 0.8 ? 1 : 0);
    w *= 1 - ss(0.7, 1.5, Math.hypot(x - p.x, z - p.z) / p.rMature);
    if (r() * 3.2 > w) continue;
    const q = m * 8;
    out[q] = x; out[q + 1] = z; out[q + 2] = r() * 6.2832; out[q + 3] = r(); out[q + 4] = r();
    out[q + 5] = k; out[q + 6] = 0.07 + 0.07 * r(); out[q + 7] = r();
    m++;
  }
  return out.subarray(0, m * 8);
}

// --------------------------------------------------------------- seedlings
// opts: seed, plants [{ x, z, species, form, rMature, disperse ('gravity'
// or 'wind') }], crowns (crowns[y] = [live crown radius per plant] at the
// end of year y), years (how many years to run), fields (makeFields),
// cap, blocked(x, z) (stones, pads). A tree bears seed once its crown
// radius is over 0.35 of its mature radius. Returns [{ x, z, plant,
// species, born, died (year phase time, or Infinity), growth (m per
// year), rand }]. Deterministic: the result for years 0..Y does not change
// when more years come.
export const SEEDLING = { bear: 0.35, germMax: 7, sShade: 0.22, sSun: 0.86, hMax: 1.7 };
export function seedlingSurvival(L, path) {
  return Math.max(0.02, SEEDLING.sShade + (SEEDLING.sSun - SEEDLING.sShade) * ss(0.15, 0.75, L) - 0.12 * ss(0.75, 1.0, L) - 0.5 * path);
}
export function seedlings(opts) {
  const { plants, crowns, years, fields: F } = opts;
  const seed = (opts.seed ?? 7) >>> 0, list = [];
  for (let y = 0; y < years; y++) {
    const cr = crowns[y]; if (!cr) break;
    const live = plants.map((p, k) => ({ x: p.x, z: p.z, r: cr[k] || 0, w: p.form === 'tree' ? 1 : 0.3 }));
    // seed rain of this year, germinating next spring
    plants.forEach((p, k) => {
      if (p.form !== 'tree' || !(cr[k] > SEEDLING.bear * p.rMature)) return;
      const r = rng(((seed * 2654435761) ^ (y * 40503) ^ (k * 9973)) >>> 0 || 1);
      const fec = Math.pow(Math.min(1, cr[k] / p.rMature), 2);
      const n = poisson(r, 1 + SEEDLING.germMax * fec);
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2;
        let d, wx = 0, wz = 0;
        if (p.disperse === 'wind') { d = cr[k] * (0.3 + 0.9 * r()) - Math.log(1 - r() * 0.999) * cr[k] * 0.6; const dw = -Math.log(1 - r() * 0.999) * 1.6; wx = WIND_XZ[0] * dw; wz = WIND_XZ[1] * dw; }
        else if (r() < 0.12) d = cr[k] * (1 + 2 * r());      // a jay caches an acorn out in the open
        else d = cr[k] * 0.6 * Math.abs(gauss(r));
        const x = p.x + Math.cos(a) * d + wx, z = p.z + Math.sin(a) * d + wz;
        if (Math.hypot(x, z) > ECO_R - 1 || (opts.blocked && opts.blocked(x, z))) continue;
        list.push({ x, z, plant: k, species: p.species, born: y + 1 + 0.27 + 0.05 * r(), died: Infinity, growth: 0, rand: r(), id: list.length + y * 1000 + k * 100000 });
      }
    });
    // a year of survival for each seedling alive in year y
    for (const s of list) {
      if (s.died !== Infinity || s.born > y + 1) continue;
      const L = lightAt(s.x, s.z, live, F), pth = F ? F.path(s.x, s.z) : 0;
      s.growth = Math.max(s.growth, 0.02 + 0.22 * L);
      if (hash3(s.id, y, seed) > seedlingSurvival(L, pth)) s.died = y + 0.55 + 0.25 * s.rand;
    }
  }
  // the cap: drop the dead ones first, the oldest dead first
  if (opts.cap && list.length > opts.cap) {
    const alive = list.filter(s => s.died === Infinity), dead = list.filter(s => s.died !== Infinity).sort((a, b) => b.died - a.died);
    return alive.slice(-opts.cap).concat(dead.slice(0, Math.max(0, opts.cap - alive.length)));
  }
  return list;
}
export function seedlingHeight(s, t) { return Math.min(SEEDLING.hMax, 0.035 + s.growth * Math.max(0, t - s.born)); }

// ----------------------------------------------------------------- ground
// The ground layers and their weights: the CPU twin of the ground shader
// (render.js makeGround, groundWeights in ECO_GLSL). Colours are the
// linear means of the textures, for the CPU preview and the tests.
//   turf    dense grass turf (sward), meadow  open meadow ground,
//   forest  worn ground under a crown, soil  bare soil (path, gaps, drip
//   line, trunk base), litter  leaf litter (hollows, under the crown, the
//   wood), moss  moss on wet shaded ground and the north side of a trunk.
export const GROUND_COL = {
  turf: [0.118, 0.153, 0.026], meadow: [0.325, 0.299, 0.095], forest: [0.287, 0.247, 0.109],
  soil: [0.072, 0.056, 0.034], litter: [0.27, 0.162, 0.038], rot: [0.075, 0.05, 0.025], moss: [0.05, 0.1, 0.018], snow: [0.78, 0.82, 0.88],
};
// Leaf litter through the year: k (amount 0..1) and decay (0 fresh .. 1 rotted).
export function litterSeason(p) {
  const k = p >= 0.74 ? ss(0.76, 0.9, p) : (1 - ss(0.15, 0.42, p));
  const decay = p >= 0.74 ? 0.4 * ss(0.88, 1, p) : 0.4 + 0.6 * ss(0, 0.3, p);
  return { k, decay };
}
// env: { F, crowns, litter (k), decay, snow, plants }. Returns the
// weights { turf, soil, litter, moss, forest } and col (linear rgb).
export function groundMix(x, z, env) {
  const F = env.F, cr = env.crowns || [];
  const cov = coverAt(x, z, cr), wood = F.wood(x, z), sw = F.sward(x, z), pth = F.path(x, z), mo = F.moist(x, z), dr = dripAt(x, z, cr);
  const shade = Math.max(cov, wood);
  const hollow = clamp01(-relief(x, z) / RELIEF_AMP * 1.4);
  let base = 0;
  for (const c of cr) if (c.r > 0.3) base = Math.max(base, c.w * Math.exp(-Math.pow(Math.hypot(x - c.x, z - c.z) / (0.35 + 0.08 * c.r), 2)));
  const turf = (0.5 + 0.5 * sw) * (1 - 0.85 * shade) * (1 - pth);
  const soil = clamp01(Math.max(ss(0.3, 0.9, pth), (1 - sw) * 0.5 * (1 - 0.6 * shade), dr * 0.4, base * 0.7));
  const litter = clamp01(wood * 0.75 + (env.litter ?? 0) * (cov * 1.15 + dr * 0.4 + hollow * 0.7 * Math.min(1, cov * 2 + wood)) * (1 - 0.6 * pth));
  const north = clamp01(1 - (((x - (cr[0] ? cr[0].x : 0)) * SUN_XZ[0] + (z - (cr[0] ? cr[0].z : 0)) * SUN_XZ[1]) + 0.2) * 2);
  const moss = clamp01(clamp01((mo - 0.45) * 2.5) * shade * 0.75 + base * north * 0.9);
  const G = GROUND_COL;
  let c = mix3(G.meadow.map((v, k) => v * [0.72, 0.85, 0.6][k]), G.turf, turf);   // grass shades the meadow soil
  c = mix3(c, G.forest.map(v => v * 0.62), shade * 0.85);
  c = mix3(c, G.moss, moss);
  const soilC = mix3(G.soil, G.soil.map(v => v * 2.4 + 0.03), pth * (1 - 0.6 * mo));   // a dry trodden path is lighter
  c = mix3(c, soilC, soil);
  c = mix3(c, mix3(G.litter, G.rot, (env.decay ?? 0) * 0.9), litter);
  c = c.map(v => v * (1 - 0.45 * F.woodShade(x, z)));
  if (env.snow) c = mix3(c, G.snow, clamp01(env.snow * (1 - 0.55 * cov)));
  return { turf, soil, litter, moss, forest: shade, col: c };
}

// ------------------------------------------------------------ grass blades
// One tussock instance has BLADES blades (fewer far from the camera, see
// LOD_D; bladeAt returns null for a dropped blade). bladeAt() is the CPU twin of the
// grass vertex shader (render.js makeGrass): where blade b of tussock q
// stands, how tall it is, its lean, width and colour, at env { p (year
// phase), snow, time, wind, dir, crowns, F (fields), R (grass radius) }.
// bladePoint() gives a point at t (0 base .. 1 tip) and side (-1 .. 1).
export const BLADES = 8, BLADE_W = [0.0062, 0.0038, 0.0058, 0.0045];
export const LEAN = [[0.3, 0.65], [0.3, 0.6], [0.6, 0.6], [0.35, 0.5]];   // [base, + rand] per kind
// distance LOD (m from the camera): 8 blades, 4 past LOD_D[0], 2 past LOD_D[1]
export const LOD_D = [18, 40];
export const GRASS_COL = { base: [0.07, 0.14, 0.03], tip: [0.2, 0.33, 0.08], straw: [0.55, 0.47, 0.26], dead: [0.3, 0.23, 0.13], flower: [0.17, 0.14, 0.11], flower2: [0.15, 0.16, 0.08], ripe: [0.42, 0.34, 0.17] };
export function bladeAt(T, q, b, env, keep = -1) {
  const x = T[q], z = T[q + 1], kind = T[q + 2] | 0, H = T[q + 3], spread = T[q + 4], rand = T[q + 5], rank = T[q + 6], wk = T[q + 7];
  // env.cam ([x, z]): the distance LOD of the shader
  const camD = env.cam ? Math.hypot(env.cam[0] - x, env.cam[1] - z) : 0, nB = camD > LOD_D[1] ? 2 : camD > LOD_D[0] ? 4 : 8;
  if (b > 0 && b < BLADES - (nB - 1)) return null;   // keep the culm blade and the last nB - 1 leaves
  const rb = frac(rand * 31.7 + b * 0.618), rb2 = frac(rand * 17.3 + b * 0.377);
  const ang = b * 2.39996 + rand * 6.2832, rr = spread * Math.sqrt((b + 0.5) / BLADES);
  const bx = x + Math.cos(ang) * rr, bz = z + Math.sin(ang) * rr;
  const L = lightAt(bx, bz, env.crowns || [], env.F);
  let vis = ss(rank, rank + 0.12, grassKeep(kind, L));
  vis *= keep >= 0 ? keep : 1 - ss(0.85 * env.R, env.R, Math.hypot(bx, bz));   // keep: the far-meadow weight (procGrass)
  const st = grassState(env.p, kind, env.snow || 0);
  const culm = b < 1 && kind <= 1 && rb < 0.85;
  const h = culm ? H * 1.45 * (0.85 + 0.3 * rb) * st[2] * vis * (1 - 0.65 * (env.snow || 0)) : H * (0.6 + 0.55 * rb) * st[0] * vis;
  const tw = (rb2 - 0.5) * 1.2;
  const dir = [Math.cos(ang + tw), Math.sin(ang + tw)];
  const lean = culm ? 0.05 + 0.3 * st[4] : LEAN[kind][0] + LEAN[kind][1] * rb2 + 0.6 * st[4];
  const gs = gust(bx, bz, env.time || 0, env.dir || WIND_XZ), wind = env.wind ?? 0.35;
  const width = culm ? 0.0016 : BLADE_W[kind] * (0.75 + 0.5 * rb) * wk * (7 / (nB - 1));
  const tint = frac(rand * 7.31), tint2 = frac(rand * 3.17);
  let fresh = mix3(GRASS_COL.base, GRASS_COL.tip, 0.5).map(v => v * (0.82 + 0.36 * tint));
  fresh = mix3(fresh, [fresh[0] * 1.2, fresh[1], fresh[2] * 0.7], tint2 * 0.6);
  if (kind === 2) fresh = [fresh[0] * 0.7, fresh[1] * 0.85, fresh[2] * 1.1];
  const dry = mix3(GRASS_COL.dead, GRASS_COL.straw, st[3] * 0.6 + 0.25);
  let col = mix3(dry, fresh, Math.pow(st[1], 0.8 + 0.6 * rb));
  if (!culm && rb > 0.9) col = dry.map(v => v * 0.85);         // last year's dead leaves
  const dim = 1 - 0.5 * (env.F ? env.F.woodShade(bx, bz) : 0);
  col = col.map(v => v * dim);
  return { bx, bz, h, lean, dir, gs, wind, width, culm, col, st, L, vis, kind };
}
// a point of a blade at t, side (-1 .. 1): [x, y, z]
export function bladePoint(B, t, side, env, out = [0, 0, 0]) {
  const wv = (env.wind ?? 0.35) * (0.25 + 1.2 * B.gs) * (1 - 0.5 * B.st[4]);
  const d = env.dir || WIND_XZ, t2 = t * t;
  const hz = B.lean * B.h * Math.pow(t, 1.6) + (B.culm ? 0.12 * B.h * t2 * t2 : 0), vy = B.h * t * (1 - 0.55 * Math.min(1.2, B.lean) * t) - 0.3 * wv * B.h * t2;
  const w = B.culm ? (t > 0.8 ? 0.0022 + 0.0045 * B.st[2] * Math.sin(Math.PI * (t - 0.8) / 0.2) : B.width) : B.width * (1 - 0.8 * t);
  out[0] = B.bx + B.dir[0] * hz + d[0] * wv * B.h * t2 * 0.8 - B.dir[1] * w * side;
  out[2] = B.bz + B.dir[1] * hz + d[1] * wv * B.h * t2 * 0.8 + B.dir[0] * w * side;
  out[1] = groundY(B.bx, B.bz) + Math.max(0.002, vy);
  return out;
}

// ------------------------------------------------------ the far meadow
// Past the tussocks of buildEco (radius R round the plants), a grass layer
// follows the camera: two square grids of world-anchored cells (PROC.n x
// PROC.n each, sizes PROC.cell), one tussock candidate per cell at a
// hashed jitter. The kind and the density come from the same fields, so
// the swards, the path and the wood go on; a candidate lives if a hash is
// under the density. It fades in over 0.82 R .. R, where the tussocks of
// buildEco fade out, and at the outer edge of its grid. procGrass() is
// the CPU twin of the PROC branch of the grass shader (meadow.js). It
// returns tussock records (8 floats, as buildEco) and a keep weight.
export const PROC = { cell: [0.25, 0.9], n: 80 };   // n: the desktop grid (layout.js procN)
export function procGrass(cx, cz, F, R, n = PROC.n) {
  const out = [];
  for (let lvl = 0; lvl < 2; lvl++) {
    const cs = PROC.cell[lvl], salt = 41 + lvl, half = Math.floor(n / 2);
    const bx = Math.floor(cx / cs) - half, bz = Math.floor(cz / cs) - half;
    for (let j = 0; j < n * n; j++) {
      const ix = bx + (j % n), iz = bz + Math.floor(j / n);
      const x = (ix + hash3(ix, iz, salt)) * cs, z = (iz + hash3(ix, iz, salt + 7)) * cs;
      const rec = procTussock(ix, iz, x, z, lvl, cx, cz, F, R, n);
      if (rec) out.push(rec);
    }
  }
  return out;
}
export function procTussock(ix, iz, x, z, lvl, cx, cz, F, R, n) {
  const cs = PROC.cell[lvl], salt = 41 + lvl, half = Math.floor(n / 2);
  if (lvl === 1 && Math.max(Math.abs(x - cx), Math.abs(z - cz)) < PROC.cell[0] * half - PROC.cell[0]) return null;
  const dc = Math.max(Math.abs(x - cx), Math.abs(z - cz));
  const edge = 1 - ss(cs * half * 0.8, cs * half, dc);
  const disc = ss(0.82 * R, R, Math.hypot(x, z));
  const sw = F.sward(x, z), mead = F.meadow(x, z), pth = F.path(x, z), wd = F.wood(x, z);
  let kind = pth > 0.08 && pth < 0.75 ? 3 : hash3(ix, iz, salt + 23) < mead ? 0 : 1;
  if (wd > 0.5) kind = 2;
  let dens = kind === 0 ? Math.pow(sw, 1.4) * (1 - 0.92 * pth) : kind === 1 ? (0.3 + 0.7 * sw) * (1 - 0.75 * pth) : kind === 2 ? 0.45 : 1;
  dens *= 1 - 0.9 * ss(0.85, 1, pth);
  const keep = (hash3(ix, iz, salt + 29) < dens * 1.8 ? 1 : 0) * disc * edge;
  if (keep <= 0) return null;
  const G = GRASS[kind], r1 = hash3(ix, iz, salt + 31), r2 = hash3(ix, iz, salt + 37);
  const wk = Math.sqrt(cs / PROC.cell[0]);
  const H = G.h[0] + (G.h[1] - G.h[0]) * (0.35 * r1 + 0.65 * mead * (kind === 0 ? 1 : 0.5)) * (0.8 + 0.4 * F.moist(x, z));
  return { rec: [x, z, kind, H, (G.spread[0] + (G.spread[1] - G.spread[0]) * r2) * Math.min(1.8, wk), hash3(ix, iz, salt + 19), hash3(ix, iz, salt + 13) * 0.92, wk], keep };
}

// ------------------------------------------------------------ statistics
// Ripley's L(r) for points in the disc of radius R, with minus sampling:
// only points at least r from the edge are centres. L(r) = r for complete
// spatial randomness, L > r for clustering, L < r for inhibition.
export function ripleyL(pts, rr, R) {
  const A = Math.PI * R * R, n = pts.length;
  let cnt = 0, centres = 0;
  for (let i = 0; i < n; i++) {
    const [xi, zi] = pts[i];
    if (Math.hypot(xi, zi) > R - rr) continue;
    centres++;
    for (let j = 0; j < n; j++) if (j !== i) { const dx = pts[j][0] - xi, dz = pts[j][1] - zi; if (dx * dx + dz * dz < rr * rr) cnt++; }
  }
  if (!centres) return 0;
  const K = A * cnt / (centres * (n - 1));
  return Math.sqrt(K / Math.PI);
}

// ---------------------------------------------------------------- GLSL twin
const g = v => Number(v).toFixed(4);
const kp = GRASS.map(k => `vec3(${g(k.keep[0])}, ${g(k.keep[1])}, ${g(k.keep[2])})`);
const C = GRASS_CAL;
export const ECO_GLSL = /* glsl */`
uniform vec4 uPath, uEdge;
uniform vec4 uCrown[${MAX_CROWNS}];
uniform float uNCrown;
const vec2 SUN_XZ = vec2(${g(SUN_XZ[0])}, ${g(SUN_XZ[1])});
float ehash(ivec2 i, uint salt) {
  uint h = (uint(i.x) * 0x27d4eb2du) ^ (uint(i.y) * 0x165667b1u) ^ (salt * 0x9e3779b9u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = (h ^ (h >> 13u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return float(h >> 8u) / 16777216.0;
}
float vnoise(vec2 p, uint salt) {
  vec2 fl = floor(p); ivec2 i = ivec2(fl); vec2 f = p - fl; f = f * f * (3.0 - 2.0 * f);
  float a = ehash(i, salt), b = ehash(i + ivec2(1, 0), salt), c = ehash(i + ivec2(0, 1), salt), d = ehash(i + ivec2(1, 1), salt);
  return a + (b - a) * f.x + (c - a) * f.y + (a - b - c + d) * f.x * f.y;
}
float fSward(vec2 p) { return clamp((0.62 * vnoise(p / ${g(FIELD.sward[0])}, 11u) + 0.38 * vnoise(p / ${g(FIELD.sward[1])}, 12u) - 0.18) * 1.5, 0.0, 1.0); }
float fMeadow(vec2 p) { return smoothstep(0.3, 0.7, vnoise(p / ${g(FIELD.meadow)}, 13u)); }
float fPath(vec2 p) {
  float u = p.x * uPath.x + p.y * uPath.y, v = -p.x * uPath.y + p.y * uPath.x;
  float c = uPath.z + 1.1 * sin(u * 0.11 + uPath.w) + 0.5 * sin(u * 0.29 + 2.0 * uPath.w);
  float d = (v - c) / ${g(FIELD.pathW)};
  return exp(-d * d);
}
float fEdgeR(vec2 p) {
  float r = max(length(p), 1e-6);
  float ca = dot(p, uEdge.xy) / r, sa = (p.y * uEdge.x - p.x * uEdge.y) / r;
  float a = atan(sa, ca);
  return uEdge.z + 2.5 * sin(3.0 * a + 1.0) + 1.5 * sin(7.0 * a) + 60.0 * smoothstep(1.0, 1.7, abs(a));
}
float fWood(vec2 p) { return uEdge.w > 0.5 ? smoothstep(-1.0, ${g(FIELD.edgeIn)}, length(p) - fEdgeR(p)) : 0.0; }
float fWoodShade(vec2 p) { return uEdge.w > 0.5 ? smoothstep(-7.0, 3.0, length(p) - fEdgeR(p)) : 0.0; }
float fMoist(vec2 p) { return clamp(0.42 + 0.45 * (vnoise(p / ${g(FIELD.moist)}, 14u) - 0.5) - 1.6 * relief(p.x, p.y) / ${g(RELIEF_AMP)} * 0.25 + 0.2 * fWoodShade(p), 0.0, 1.0); }
float fCover(vec2 p) {
  float c = 0.0;
  for (int k = 0; k < ${MAX_CROWNS}; k++) {
    if (float(k) >= uNCrown) break;
    vec4 q = uCrown[k];
    if (q.z < 0.05) continue;
    float d = length(p - (q.xy - SUN_XZ * 0.22 * q.z));
    c = max(c, q.w * (1.0 - smoothstep(0.45 * q.z, 1.12 * q.z, d)));
  }
  return c;
}
float fLight(vec2 p) { return (1.0 - 0.86 * fCover(p)) * (1.0 - 0.85 * fWoodShade(p)); }
float fDrip(vec2 p) {
  float m = 0.0;
  for (int k = 0; k < ${MAX_CROWNS}; k++) {
    if (float(k) >= uNCrown) break;
    vec4 q = uCrown[k];
    if (q.z < 1.0) continue;
    float e = (length(p - q.xy) - 0.95 * q.z) / (0.16 * q.z + 0.3);
    m = max(m, q.w * exp(-e * e));
  }
  return m;
}
float gust(vec2 p, float t, vec2 dir) {
  float s = dot(p, dir), q = -p.x * dir.y + p.y * dir.x;
  float g1 = sin(s * 0.42 - t * 2.2 + 0.9 * sin(q * 0.13 + t * 0.17));
  float g2 = sin(s * 0.17 - t * 1.1 + q * 0.05 + 1.7);
  return smoothstep(0.3, 1.0, 0.5 + 0.5 * (0.65 * g1 + 0.35 * g2));
}
const vec3 GKEEP[4] = vec3[4](${kp.join(', ')});
float grassKeep(int kind, float L) {
  vec3 k = GKEEP[kind];
  return k.z < 0.0 ? 1.0 - smoothstep(k.x, k.y, L) : k.z + (1.0 - k.z) * smoothstep(k.x, k.y, L);
}
// x height share, y green, z seed heads, w ripe; lodge out
vec4 grassState(float p, int kind, float snow, out float lodge) {
  float grow = smoothstep(${g(C.grow[0])}, ${g(C.grow[1])}, p), die = smoothstep(${g(C.die[0])}, ${g(C.die[1])}, p), cmp = smoothstep(${g(C.compact[0])}, ${g(C.compact[1])}, p);
  float h = 0.38 + 0.62 * grow - 0.25 * die - 0.37 * cmp;
  float green = 0.3 + 0.7 * smoothstep(${g(C.greenUp[0])}, ${g(C.greenUp[1])}, p) - 0.15 * smoothstep(${g(C.cure[0])}, ${g(C.cure[1])}, p) - 0.45 * die - 0.1 * cmp;
  float seed = smoothstep(${g(C.head[0])}, ${g(C.head[1])}, p) * (1.0 - smoothstep(${g(C.headEnd[0])}, ${g(C.headEnd[1])}, p));
  float ripe = smoothstep(${g(C.ripe[0])}, ${g(C.ripe[1])}, p);
  lodge = 0.75 * (1.0 - smoothstep(${g(C.unlodge[0])}, ${g(C.unlodge[1])}, p)) + 0.75 * smoothstep(${g(C.lodge[0])}, ${g(C.lodge[1])}, p);
  if (kind == 2) { green += 0.25 * (1.0 - green); seed *= 0.4; }
  if (kind == 3) { seed = 0.0; h = 0.6 + 0.4 * h; }
  h *= 1.0 - 0.65 * snow;
  lodge = clamp(max(lodge, 0.95 * snow), 0.0, 1.0);
  return vec4(h, clamp(green, 0.0, 1.0), seed, ripe);
}
`;
