// ============================================================================
//  DLA TERRAIN  ·  world/settle-place.js — where people settle, and the
//  roads between them (package CITIES). DOM-free, no GPU: render/
//  settlements.js calls it (in world/settle-worker.js when it can), and
//  tests/settle.test.mjs checks it in node.
// ----------------------------------------------------------------------------
//  The user: "i also want to scatter random cities in the DLA terrain layout
//  as an option in the renderer".
//
//  SITING  A site grid of S x S cells (S = min(n, 256)) over the LIB
//  Terrain. Each cell gets: mean height, mean slope (rise over run), the
//  share of sea, lake and river water, and bad ground (snow, bare rock,
//  scree, glacier cold). Chamfer distance fields give the distance to a
//  river, to the sea and to a lake. The score of a dry, gentle cell:
//    flat * climate * (0.25 + river + confluence + coast + harbour + lake
//                      + pass) * a seeded jitter
//  river: near a river, more for a larger flow; confluence: near the end
//  of a river that joins another ('join'); coast: near the sea; harbour:
//  a bay (the sea takes 18 to 55 % of a 1.2 km disc); lake: a shore; pass:
//  a saddle of the smoothed height. flat falls to 0 at MAX_SLOPE. Water,
//  steep ground, snow and rock score 0.
//  Picks go greedy by score, the largest kind first (cities, towns, then
//  villages), with a spacing by both radii, and a check that at least half
//  of the disc is buildable. COUNTS sets the counts of a mode, PROFILE_CAPS
//  lowers them on phones.
//
//  ROADS  A* on a road grid (R = min(n, ROAD_N)) with 16 moves (the knight
//  moves let a road zigzag up a slope: switchbacks come from the cost,
//  not from a rule). Step cost = length * (1 + (grade / 0.07)^2), and a
//  step over MAX_GRADE (on any quarter of it) is closed; a link with no
//  path tries again at MOUNTAIN_GRADE. Sea and lake cells are closed; a cell
//  under a LIB river polyline costs a bridge (BRIDGE_COST m once per
//  crossing, 6 times the length to stay on it). A cell on a road already built costs half, so roads join into a
//  network. Links: a minimum spanning tree of the sites (Prim), then each
//  town or city to its second nearest town or city. A path goes to world
//  points (cell centres), one Chaikin pass off the bridges, a resample
//  every STEP m, the height of the ground (LIB terrainHeightAt) and, within
//  6 m of a river edge or over water, a deck DECK m over the water (the
//  bed + 3 m: the top of the WATER river surface) between its abutments.
//
//  API
//    siteSettlements(t, opts) -> { sites, roads, grid, ms }
//      t     a LIB Terrain (or a TerrainGPU with .cpu)
//      opts  { mode 'off'|'few'|'many', size 0.5..2, seed, profile id }
//      sites [{ id, x, z, y, kind 'city'|'town'|'village', r (m), score,
//               why: { river, confluence, coast, harbour, lake, pass } }]
//      roads [{ pts Float32Array x, y, z per point, w (m), kind 'main'|'track',
//               a, b (site ids), bridges [[i0, i1], ..] (point ranges on a
//               deck), len (m), mountain (true: found at MOUNTAIN_GRADE) }]
//    COUNTS, PROFILE_CAPS, capsFor(profileId), countsFor(mode, profileId)
//    classify(t, x, z) -> { water: 'sea'|'lake'|'river'|null, slope, y, depth }
//    riverIndex(t) -> { near(x, z) -> { d (m to the water edge), hw, x, z } | null, segs }
//    MAX_SLOPE, MAX_GRADE
//
//  grep -n targets: "export function siteSettlements", "function siteGrid",
//  "function chamfer", "function scoreCells", "function pickSites",
//  "function roadGrid", "function astar", "function linkSites",
//  "function toWorldPath", "export const COUNTS", "export const PROFILE_CAPS"
// ============================================================================

import { terrainHeightAt } from '../../../lib/dla-terrain.js';

export const MAX_SLOPE = 0.2;     // rise over run: a site cell steeper than this scores 0
export const MAX_GRADE = 0.16;    // a road step steeper than this is closed
export const MOUNTAIN_GRADE = 0.22;   // the second try of a link that found no road
export const ROAD_N = 512;        // the road grid at most ROAD_N cells a side
export const STEP = 10;           // m between road points
export const DECK = 4;            // m: a bridge deck over the water surface
const BRIDGE_COST = 900;          // m of road a river crossing costs
const BAD_BIOMES = new Set([9, 10, 14]);   // bare rock, snow, scree

// The counts of a mode. "few": a few towns and villages; "many": up to two
// cities, more towns, many villages.
export const COUNTS = Object.freeze({
  off: { city: 0, town: 0, village: 0 },
  few: { city: 0, town: 2, village: 6 },
  many: { city: 2, town: 5, village: 16 },
});
// Profile caps (gpu/budget.js ids): counts, building instances, the near
// LOD distance (m), the far draw distance (m), lamps, shadow casters.
export const PROFILE_CAPS = Object.freeze({
  desktop: { city: 2, town: 5, village: 16, buildings: 32000, near: 2600, far: 18000, lamps: 7000, shadows: true },
  safari: { city: 2, town: 5, village: 16, buildings: 20000, near: 2000, far: 14000, lamps: 5000, shadows: true },
  safe: { city: 1, town: 3, village: 10, buildings: 9000, near: 1400, far: 10000, lamps: 2500, shadows: true },
  phone: { city: 0, town: 1, village: 5, buildings: 2500, near: 900, far: 6000, lamps: 700, shadows: false },
  'phone-min': { city: 0, town: 0, village: 4, buildings: 1000, near: 600, far: 4000, lamps: 300, shadows: false },
});
export function capsFor(profileId) { return PROFILE_CAPS[profileId] || PROFILE_CAPS.desktop; }
export function countsFor(mode, profileId) {
  const c = COUNTS[mode] || COUNTS.off, p = capsFor(profileId);
  return { city: Math.min(c.city, p.city), town: Math.min(c.town, p.town), village: Math.min(c.village, p.village) };
}
// the base radius (m) of each kind; times opts.size and the site quality
export const RADIUS = Object.freeze({ city: 760, town: 270, village: 95 });

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The water and the slope at a world point (texel lookups, nearest).
export function classify(t, x, z) {
  if (t && t.cpu) t = t.cpu;
  const n = t.n, tx = t.worldSize / n, o = -t.worldSize / 2;
  const i = clamp(Math.floor((x - o) / tx), 0, n - 1), j = clamp(Math.floor((z - o) / tx), 0, n - 1);
  const q = j * n + i, H = t.height;
  const hs = (a, b) => H[clamp(b, 0, n - 1) * n + clamp(a, 0, n - 1)];
  const slope = Math.hypot(hs(i + 1, j) - hs(i - 1, j), hs(i, j + 1) - hs(i, j - 1)) / (2 * tx);
  let water = null;
  const hasSea = t.seaLevel > -50;
  if (hasSea && H[q] < t.seaLevel) water = 'sea';
  else if (t.water && t.water[q] > 0.4) water = t.river && t.river[q] > 0.35 ? 'river' : 'lake';
  else if (t.river && t.river[q] > 0.6) water = 'river';
  return { water, slope, y: H[q], depth: t.water ? t.water[q] : 0 };
}

// ── SITE GRID ────────────────────────────────────────────────────────────
function siteGrid(t, S) {
  const n = t.n, k = n / S, tx = t.worldSize / n;
  const N = S * S;
  const g = {
    S, k, cell: t.worldSize / S, origin: -t.worldSize / 2,
    h: new Float32Array(N), slope: new Float32Array(N), sea: new Float32Array(N), lake: new Float32Array(N),
    riv: new Float32Array(N), flow: new Float32Array(N), bad: new Float32Array(N), temp: new Float32Array(N), moist: new Float32Array(N),
  };
  const H = t.height, hasSea = t.seaLevel > -50;
  const kk = Math.max(1, Math.floor(k));
  for (let J = 0; J < S; J++) for (let I = 0; I < S; I++) {
    let sh = 0, ss = 0, nsea = 0, nl = 0, nr = 0, fl = 0, nb = 0, te = 0, mo = 0, c = 0;
    for (let b = 0; b < kk; b++) for (let a = 0; a < kk; a++) {
      const i = Math.min(n - 1, Math.floor(I * k) + a), j = Math.min(n - 1, Math.floor(J * k) + b), q = j * n + i;
      const hx = H[j * n + Math.min(n - 1, i + 1)] - H[j * n + Math.max(0, i - 1)];
      const hz = H[Math.min(n - 1, j + 1) * n + i] - H[Math.max(0, j - 1) * n + i];
      sh += H[q]; ss += Math.hypot(hx, hz) / (2 * tx); c++;
      if (hasSea && H[q] < t.seaLevel) nsea++;
      else if (t.water && t.water[q] > 0.4 && !(t.river && t.river[q] > 0.35)) nl++;
      if (t.river && t.river[q] > 0.35) { nr++; fl = Math.max(fl, t.flow ? t.flow[q] : 1); }
      if (t.biome && BAD_BIOMES.has(t.biome[q])) nb++;
      te += t.temperature ? t.temperature[q] : 10;
      mo += t.moisture ? t.moisture[q] : 0.5;
    }
    const Q = J * S + I;
    g.h[Q] = sh / c; g.slope[Q] = ss / c; g.sea[Q] = nsea / c; g.lake[Q] = nl / c; g.riv[Q] = nr / c;
    g.flow[Q] = fl; g.bad[Q] = nb / c; g.temp[Q] = te / c; g.moist[Q] = mo / c;
  }
  return g;
}

// Two-pass chamfer distance (in cells, 1 and 1.414) from the seed cells.
// carry: an optional value copied from the nearest seed.
function chamfer(S, seed, carry = null) {
  const d = new Float32Array(S * S).fill(1e9);
  const v = carry ? new Float32Array(S * S) : null;
  for (let q = 0; q < S * S; q++) if (seed(q)) { d[q] = 0; if (v) v[q] = carry[q]; }
  const R2 = Math.SQRT2;
  const relax = (q, p, w) => { if (d[p] + w < d[q]) { d[q] = d[p] + w; if (v) v[q] = v[p]; } };
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const q = j * S + i;
    if (i > 0) relax(q, q - 1, 1);
    if (j > 0) { relax(q, q - S, 1); if (i > 0) relax(q, q - S - 1, R2); if (i < S - 1) relax(q, q - S + 1, R2); }
  }
  for (let j = S - 1; j >= 0; j--) for (let i = S - 1; i >= 0; i--) {
    const q = j * S + i;
    if (i < S - 1) relax(q, q + 1, 1);
    if (j < S - 1) { relax(q, q + S, 1); if (i < S - 1) relax(q, q + S + 1, R2); if (i > 0) relax(q, q + S - 1, R2); }
  }
  return { d, v };
}

// ── SCORE ────────────────────────────────────────────────────────────────
function scoreCells(t, g, rnd) {
  const { S, cell } = g, N = S * S;
  const wet = (q) => g.sea[q] > 0.5 || g.lake[q] > 0.5;
  const dRiv = chamfer(S, (q) => g.riv[q] > 0.08, g.flow);
  const dSea = chamfer(S, (q) => g.sea[q] > 0.5).d;
  const dLake = chamfer(S, (q) => g.lake[q] > 0.5).d;
  // confluences: the last point of a river that joins another
  const conf = new Uint8Array(N);
  for (const r of t.rivers || []) {
    if (r.end !== 'join' || !r.pts || r.pts.length < 2) continue;
    const x = r.pts[r.pts.length - 2], z = r.pts[r.pts.length - 1];
    const I = clamp(Math.floor((x - g.origin) / cell), 0, S - 1), J = clamp(Math.floor((z - g.origin) / cell), 0, S - 1);
    conf[J * S + I] = 1;
  }
  const dConf = chamfer(S, (q) => conf[q] === 1).d;
  // the sea share of a 1.2 km disc (a bay is a harbour)
  const rr = Math.max(1, Math.round(600 / cell));
  const seaDisc = new Float32Array(N);
  {
    // a summed-area table of the sea share
    const sat = new Float64Array((S + 1) * (S + 1));
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) sat[(j + 1) * (S + 1) + i + 1] = g.sea[j * S + i] + sat[j * (S + 1) + i + 1] + sat[(j + 1) * (S + 1) + i] - sat[j * (S + 1) + i];
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const a = Math.max(0, i - rr), b = Math.max(0, j - rr), c = Math.min(S, i + rr + 1), e = Math.min(S, j + rr + 1);
      seaDisc[j * S + i] = (sat[e * (S + 1) + c] - sat[b * (S + 1) + c] - sat[e * (S + 1) + a] + sat[b * (S + 1) + a]) / ((c - a) * (e - b));
    }
  }
  // saddles of the smoothed height (passes): low across one axis, high
  // along the other, with a 2-cell reach
  const hs = (i, j) => g.h[clamp(j, 0, S - 1) * S + clamp(i, 0, S - 1)];
  let hMin = Infinity, hMax = -Infinity;
  for (let q = 0; q < N; q++) if (!wet(q)) { hMin = Math.min(hMin, g.h[q]); hMax = Math.max(hMax, g.h[q]); }
  const span = Math.max(1, hMax - hMin);
  const score = new Float32Array(N);
  const why = new Uint8Array(N);   // bits: 1 river, 2 confluence, 4 coast, 8 harbour, 16 lake, 32 pass
  const kmCell = cell / 1000;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const q = j * S + i;
    if (wet(q) || g.riv[q] > 0.25 || g.slope[q] > MAX_SLOPE || g.bad[q] > 0.4 || g.temp[q] < -3) continue;
    const flat = 1 - smooth(0.03, MAX_SLOPE, g.slope[q]);
    const elev = (g.h[q] - hMin) / span;
    const climate = (1 - 0.75 * smooth(0.45, 0.95, elev)) * (0.45 + 0.55 * smooth(0.08, 0.35, g.moist[q])) * (1 - g.bad[q]);
    const dr = dRiv.d[q] * kmCell, big = dRiv.v[q];
    const river = dr < 1.2 ? (1 - smooth(0.1, 1.2, dr)) * (0.55 + 0.45 * smooth(1, 80, big)) : 0;
    const confluence = 0.6 * (1 - smooth(0.15, 0.7, dConf[q] * kmCell));
    const coast = 0.75 * (1 - smooth(0.15, 1.0, dSea[q] * kmCell));
    const harbour = coast > 0.3 && seaDisc[q] > 0.18 && seaDisc[q] < 0.55 ? 0.6 * (1 - Math.abs(seaDisc[q] - 0.35) / 0.2) : 0;
    const lake = 0.5 * (1 - smooth(0.1, 0.8, dLake[q] * kmCell));
    let pass = 0;
    {
      const ax = hs(i - 2, j) > g.h[q] && hs(i + 2, j) > g.h[q] && hs(i, j - 2) < g.h[q] && hs(i, j + 2) < g.h[q];
      const az = hs(i, j - 2) > g.h[q] && hs(i, j + 2) > g.h[q] && hs(i - 2, j) < g.h[q] && hs(i + 2, j) < g.h[q];
      if ((ax || az) && elev > 0.25) pass = 0.35;
    }
    const s = flat * climate * (0.25 + river + confluence + coast + Math.max(0, harbour) + lake + pass) * (0.85 + 0.3 * rnd());
    score[q] = s;
    why[q] = (river > 0.2 ? 1 : 0) | (confluence > 0.2 ? 2 : 0) | (coast > 0.2 ? 4 : 0) | (harbour > 0.1 ? 8 : 0) | (lake > 0.15 ? 16 : 0) | (pass > 0 ? 32 : 0);
  }
  return { score, why };
}

// The buildable share of a disc (24 samples on two rings and the centre).
function buildableShare(t, x, z, r) {
  let ok = 0, n = 0;
  for (let k = 0; k < 25; k++) {
    const ring = k === 0 ? 0 : k <= 8 ? 0.45 : 0.9, a = k * 2.399963;
    const c = classify(t, x + Math.cos(a) * r * ring, z + Math.sin(a) * r * ring);
    n++;
    if (!c.water && c.slope < MAX_SLOPE * 1.2) ok++;
  }
  return ok / n;
}

// ── PICK ─────────────────────────────────────────────────────────────────
function pickSites(t, g, sc, counts, size, rnd) {
  const { S, cell, origin } = g;
  const order = [];
  for (let q = 0; q < S * S; q++) if (sc.score[q] > 0) order.push(q);
  order.sort((a, b) => sc.score[b] - sc.score[a] || a - b);
  const best = order.length ? sc.score[order[0]] : 0;
  const sites = [];
  const ws = t.worldSize, edge = 0.04 * ws;
  for (const kind of ['city', 'town', 'village']) {
    let need = counts[kind];
    const minScore = kind === 'city' ? 0.55 * best : kind === 'town' ? 0.3 * best : 0.08 * best;
    for (let o = 0; o < order.length && need > 0; o++) {
      const q = order[o];
      if (sc.score[q] < minScore) break;
      const I = q % S, J = (q - I) / S;
      // the best of 9 points in the cell: gentle, dry
      let bx = 0, bz = 0, bs = Infinity;
      for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
        const x = origin + (I + 0.2 + 0.3 * a) * cell, z = origin + (J + 0.2 + 0.3 * b) * cell;
        const c = classify(t, x, z);
        const s = c.water ? Infinity : c.slope;
        if (s < bs) { bs = s; bx = x; bz = z; }
      }
      if (bs === Infinity || Math.abs(bx) > ws / 2 - edge || Math.abs(bz) > ws / 2 - edge) continue;
      const qual = clamp(sc.score[q] / Math.max(best, 1e-6), 0.4, 1);
      const r = RADIUS[kind] * size * (0.7 + 0.5 * qual) * (0.9 + 0.2 * rnd());
      if (sites.some((s) => Math.hypot(s.x - bx, s.z - bz) < (s.r + r) * 2.1 + 500)) continue;
      if (buildableShare(t, bx, bz, r) < (kind === 'village' ? 0.45 : 0.55)) continue;
      const w = sc.why[q];
      sites.push({
        id: sites.length, x: Math.round(bx * 10) / 10, z: Math.round(bz * 10) / 10, y: terrainHeightAt(t, bx, bz), kind, r: Math.round(r), score: +sc.score[q].toFixed(4),
        why: { river: !!(w & 1), confluence: !!(w & 2), coast: !!(w & 4), harbour: !!(w & 8), lake: !!(w & 16), pass: !!(w & 32) },
      });
      need--;
    }
  }
  return sites;
}

// ── ROADS ────────────────────────────────────────────────────────────────
// cls: 0 dry, 1 river (a bridge: the cells under a LIB river polyline,
// where WATER draws its river ribbons), 2 closed (sea, lake)
function roadGrid(t, R) {
  const n = t.n, k = n / R, N = R * R;
  const h = new Float32Array(N), cls = new Uint8Array(N);
  const hasSea = t.seaLevel > -50;
  const cell = t.worldSize / R, origin = -t.worldSize / 2;
  for (let J = 0; J < R; J++) for (let I = 0; I < R; I++) {
    const i = Math.min(n - 1, Math.floor((I + 0.5) * k)), j = Math.min(n - 1, Math.floor((J + 0.5) * k)), q = j * n + i, Q = J * R + I;
    h[Q] = t.height[q];
    const wd = t.water ? t.water[q] : 0;
    if (hasSea && t.height[q] < t.seaLevel) cls[Q] = 2;
    else if (wd > 0.4 && !(t.river && t.river[q] > 0.35)) cls[Q] = 2;
  }
  for (const r of t.rivers || []) {
    const p = r.pts;
    for (let s = 0; s + 3 < p.length; s += 2) {
      const ax = p[s], az = p[s + 1], bx = p[s + 2], bz = p[s + 3];
      const m = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (cell * 0.5)));
      for (let u = 0; u <= m; u++) {
        const x = ax + (bx - ax) * u / m, z = az + (bz - az) * u / m;
        const I = clamp(Math.floor((x - origin) / cell), 0, R - 1), J = clamp(Math.floor((z - origin) / cell), 0, R - 1);
        if (cls[J * R + I] !== 2) cls[J * R + I] = 1;
      }
    }
  }
  return { R, cell, origin, h, cls, used: new Uint8Array(N) };
}

// The river segments in a hash of SEG m cells (for the bridge test)
const SEG = 200;
export function riverIndex(t) {
  const map = new Map(), segs = [];
  const key = (i, j) => i * 92821 + j;
  (t.rivers || []).forEach((r, ri) => {
    const p = r.pts, w = r.width;
    for (let s = 0; s + 3 < p.length; s += 2) {
      const k = segs.length;
      const hw = 0.5 * Math.max(w ? w[s >> 1] : 8, w ? w[(s >> 1) + 1] : 8);
      segs.push([p[s], p[s + 1], p[s + 2], p[s + 3], hw, ri]);
      const x0 = Math.min(p[s], p[s + 2]) - hw, x1 = Math.max(p[s], p[s + 2]) + hw, z0 = Math.min(p[s + 1], p[s + 3]) - hw, z1 = Math.max(p[s + 1], p[s + 3]) + hw;
      for (let i = Math.floor(x0 / SEG); i <= Math.floor(x1 / SEG); i++) for (let j = Math.floor(z0 / SEG); j <= Math.floor(z1 / SEG); j++) {
        const kk = key(i, j);
        if (!map.has(kk)) map.set(kk, []);
        map.get(kk).push(k);
      }
    }
  });
  // distance from (x, z) to the nearest river edge (negative inside the
  // water), with the half width there; null when none within SEG
  const near = (x, z) => {
    const l = map.get(key(Math.floor(x / SEG), Math.floor(z / SEG)));
    if (!l) return null;
    let best = null;
    for (const k of l) {
      const [ax, az, bx, bz, hw] = segs[k];
      const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1;
      const u = clamp(((x - ax) * dx + (z - az) * dz) / L, 0, 1);
      const d = Math.hypot(ax + dx * u - x, az + dz * u - z) - hw;
      if (!best || d < best.d) best = { d, hw, x: ax + dx * u, z: az + dz * u };
    }
    return best;
  };
  return { near, segs };
}

const MOVES = (() => {
  const m = [];
  for (const [a, b] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2], [1, -2], [2, -1]]) m.push([a, b, Math.hypot(a, b)]);
  return m;
})();

// bilinear of a grid field at fractional cell (x, y)
function bil(f, R, x, y) {
  const i = clamp(Math.floor(x), 0, R - 2), j = clamp(Math.floor(y), 0, R - 2), fx = x - i, fy = y - j;
  return (f[j * R + i] * (1 - fx) + f[j * R + i + 1] * fx) * (1 - fy) + (f[(j + 1) * R + i] * (1 - fx) + f[(j + 1) * R + i + 1] * fx) * fy;
}

// A* from cell s to cell e. Returns the cell list or null.
function astar(rg, s, e, maxExpand, maxGrade = MAX_GRADE) {
  const { R, cell, h, cls, used } = rg, N = R * R;
  const gS = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const ei = e % R, ej = (e - ei) / R;
  const heur = (q) => { const i = q % R, j = (q - i) / R; return Math.hypot(i - ei, j - ej) * cell; };
  const heap = [], hv = [];
  const push = (q, v) => {
    heap.push(q); hv.push(v);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (hv[p] <= hv[i]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; [hv[p], hv[i]] = [hv[i], hv[p]]; i = p; }
  };
  const pop = () => {
    const q = heap[0], lq = heap.pop(), lv = hv.pop();
    if (heap.length) {
      heap[0] = lq; hv[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && hv[l] < hv[m]) m = l;
        if (r < heap.length && hv[r] < hv[m]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; [hv[m], hv[i]] = [hv[i], hv[m]];
        i = m;
      }
    }
    return q;
  };
  gS[s] = 0; push(s, heur(s));
  let expand = 0;
  while (heap.length && expand++ < maxExpand) {
    const q = pop();
    if (closed[q]) continue;
    closed[q] = 1;
    if (q === e) break;
    const i = q % R, j = (q - i) / R;
    for (const [di, dj, L0] of MOVES) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= R || b >= R) continue;
      const p = b * R + a;
      if (closed[p] || cls[p] === 2) continue;
      // a knight move passes two cells: neither may be closed
      if (Math.abs(di) + Math.abs(dj) === 3) {
        const m1 = (j + Math.round(dj / 2)) * R + (i + Math.round(di / 2));
        if (cls[m1] === 2) continue;
      }
      const L = L0 * cell;
      // the grade over the quarters of the step (bilinear ground between
      // the cell centres: a knight move crosses two other cells)
      let g = 0, hp = h[q];
      for (let u = 1; u <= 4; u++) {
        const hu = u === 4 ? h[p] : bil(h, R, i + di * u / 4, j + dj * u / 4);
        g = Math.max(g, Math.abs(hu - hp) * 4 / L);
        hp = hu;
      }
      if (g > maxGrade) continue;
      let c;
      if (cls[p] === 1 || cls[q] === 1) {
        // on a river cell: a bridge once at the step onto it, and costly
        // to stay on (a road does not run up a river bed)
        c = L * 6 + (cls[q] !== 1 && cls[p] === 1 ? BRIDGE_COST : 0);
      } else {
        c = L * (1 + (g / 0.06) ** 2);
      }
      if (used[p]) c *= 0.5;
      const ng = gS[q] + c;
      if (ng < gS[p]) { gS[p] = ng; from[p] = q; push(p, ng + heur(p)); }
    }
  }
  if (from[e] < 0 && s !== e) return null;
  const path = [e];
  let q = e, guard = 0;
  while (q !== s && guard++ < N) { q = from[q]; path.push(q); }
  return path.reverse();
}

// a cell path to world points with heights and bridge runs
function toWorldPath(t, rg, path, rix) {
  const { R, cell, origin, cls } = rg;
  const P = path.map((q) => { const i = q % R, j = (q - i) / R; return [origin + (i + 0.5) * cell, origin + (j + 0.5) * cell, cls[q] === 1 ? 1 : 0]; });
  // Chaikin, once, off the river cells (a bridge stays straight)
  let L = P;
  for (let it = 0; it < 1; it++) {
    const o = [L[0]];
    for (let k = 0; k < L.length - 1; k++) {
      const a = L[k], b = L[k + 1];
      if (a[2] || b[2]) { o.push(b); continue; }
      o.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1], 0]);
      o.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1], 0]);
    }
    o.push(L[L.length - 1]);
    L = o;
  }
  // resample every STEP m
  const out = [];
  for (let k = 0; k < L.length - 1; k++) {
    const a = L[k], b = L[k + 1], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const m = Math.max(1, Math.round(d / STEP));
    for (let s = 0; s < m; s++) out.push([a[0] + (b[0] - a[0]) * s / m, a[1] + (b[1] - a[1]) * s / m]);
  }
  out.push([L[L.length - 1][0], L[L.length - 1][1]]);
  const np = out.length;
  const pts = new Float32Array(np * 3);
  for (let k = 0; k < np; k++) {
    pts[3 * k] = out[k][0]; pts[3 * k + 2] = out[k][1];
    pts[3 * k + 1] = terrainHeightAt(t, out[k][0], out[k][1]);
  }
  // bridges: the runs of points within BANK m of a river (its edge), and
  // over any other water; the deck sits DECK m over the highest water
  // surface of the run (the WATER river surface is at most 3 m over the
  // ground of its bed), ramps of 2 points at each end
  const BANK = 6;
  const wet = new Uint8Array(np), top = new Float32Array(np).fill(-Infinity);
  for (let k = 0; k < np; k++) {
    const r = rix.near(out[k][0], out[k][1]);
    const c = classify(t, out[k][0], out[k][1]);
    if ((r && r.d < BANK) || c.water) {
      wet[k] = 1;
      const bed = r && r.d < BANK ? Math.min(terrainHeightAt(t, r.x, r.z), pts[3 * k + 1]) : pts[3 * k + 1];
      top[k] = Math.max(bed + 3, c.y + Math.max(0, c.depth)) + DECK;
    }
  }
  const bridges = [];
  for (let k = 0; k < np; k++) {
    if (!wet[k]) continue;
    let e = k;
    while (e + 1 < np && wet[e + 1]) e++;
    const a = Math.max(0, k - 2), b = Math.min(np - 1, e + 2);
    let deck = -Infinity;
    for (let s = k; s <= e; s++) deck = Math.max(deck, top[s]);
    for (let s = a; s <= b; s++) {
      const ramp = s < k ? (s - a + 1) / (k - a + 1) : s > e ? (b - s + 1) / (b - e + 1) : 1;
      const y = pts[3 * s + 1];
      pts[3 * s + 1] = Math.max(y, y + (deck - y) * ramp);
    }
    bridges.push([a, b]);
    k = e;
  }
  let len = 0;
  for (let k = 1; k < np; k++) len += Math.hypot(out[k][0] - out[k - 1][0], out[k][1] - out[k - 1][1]);
  return { pts, bridges, len };
}

function linkSites(sites) {
  const n = sites.length, edges = [];
  if (n < 2) return edges;
  const d = (a, b) => Math.hypot(sites[a].x - sites[b].x, sites[a].z - sites[b].z);
  // Prim
  const inT = new Uint8Array(n); inT[0] = 1;
  for (let k = 1; k < n; k++) {
    let ba = -1, bb = -1, bd = Infinity;
    for (let a = 0; a < n; a++) if (inT[a]) for (let b = 0; b < n; b++) if (!inT[b] && d(a, b) < bd) { bd = d(a, b); ba = a; bb = b; }
    inT[bb] = 1; edges.push([ba, bb]);
  }
  // each town or city to its second nearest town or city: a loop
  const big = sites.filter((s) => s.kind !== 'village').map((s) => s.id);
  for (const a of big) {
    const o = big.filter((b) => b !== a).sort((p, q) => d(a, p) - d(a, q));
    const b = o[1];
    if (b === undefined) continue;
    if (!edges.some(([p, q]) => (p === a && q === b) || (p === b && q === a))) edges.push([a, b]);
  }
  edges.sort((p, q) => d(p[0], p[1]) - d(q[0], q[1]));
  return edges;
}

export function siteSettlements(t0, opts = {}) {
  const t = t0 && t0.cpu ? t0.cpu : t0;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const ms0 = now();
  const mode = opts.mode || 'off';
  const counts = countsFor(mode, opts.profile || 'desktop');
  if (!t || !t.height || mode === 'off' || counts.city + counts.town + counts.village === 0) return { sites: [], roads: [], ms: 0 };
  const seed = ((opts.seed >>> 0) || 1) ^ Math.imul((t.opts && t.opts.seed) >>> 0 || 7, 0x9e3779b1);
  const rnd = mulberry(seed);
  const size = clamp(+opts.size || 1, 0.4, 2.5);
  const S = Math.min(t.n, 256);
  const g = siteGrid(t, S);
  const sc = scoreCells(t, g, rnd);
  const sites = pickSites(t, g, sc, counts, size, rnd);
  // roads
  const R = Math.min(t.n, opts.roadN || ROAD_N);
  const rg = roadGrid(t, R);
  const rix = riverIndex(t);
  const cellOf = (x, z) => clamp(Math.floor((z - rg.origin) / rg.cell), 0, R - 1) * R + clamp(Math.floor((x - rg.origin) / rg.cell), 0, R - 1);
  const roads = [];
  for (const [a, b] of linkSites(sites)) {
    const A = sites[a], B = sites[b];
    let s = cellOf(A.x, A.z), e = cellOf(B.x, B.z);
    if (rg.cls[s] === 2 || rg.cls[e] === 2) continue;
    // a mountain road (MOUNTAIN_GRADE) where no gentle road gets through
    let mountain = false;
    let path = astar(rg, s, e, R * R * 2);
    if (!path) { path = astar(rg, s, e, R * R * 2, MOUNTAIN_GRADE); mountain = !!path; }
    if (!path || path.length < 2) continue;
    for (const q of path) rg.used[q] = 1;
    const w = A.kind === 'village' || B.kind === 'village' ? 'track' : 'main';
    const wp = toWorldPath(t, rg, path, rix);
    roads.push({ ...wp, w: w === 'main' ? 7 : 4.2, kind: w, mountain, a, b });
  }
  return { sites, roads, ms: Math.round(now() - ms0), counts, grid: { S, R } };
}
