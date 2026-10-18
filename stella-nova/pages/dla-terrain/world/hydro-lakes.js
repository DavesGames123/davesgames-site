// ============================================================================
//  DLA TERRAIN  ·  world/hydro-lakes.js — bodies of water from the terrain:
//  lakes, ponds, tarns, oxbow lakes, great lakes, salt lakes, the coastal
//  shelf, and the "add water" tool. Package WATER. DOM-free (node tests).
// ----------------------------------------------------------------------------
//  The user (2026-10-18): "i would love if there were the ability to create
//  bodies of water as well (ponds and lakes, great lakes, oceans, etc.)"
//
//  WHERE IT RUNS  after lib/dla-terrain.js generateTerrain, on the final
//  Terrain, in the page worker world/hydro-worker.js (or on the page when
//  there is no worker). withWaterBodies(lib) wraps the LIB module: it adds
//  WATER_OPTIONS (group "Water bodies") to OPTIONS, the water keys to
//  defaults(), PRESETS and randomOptions(), and runs applyWaterBodies after
//  generateTerrain. The LIB option "lakes" is replaced by "lakeMode".
//
//  PIPELINE  applyWaterBodies(t, opts) changes t in place:
//    1 coast    shapeCoast: a shallow shelf on gentle coasts, deep water at
//               cliffs; the coast line does not move (sea cells stay under
//               the sea level by 0.25 m or more).
//    2 sites    the LIB fill leaves no pits, so the basins come from the
//               land itself: flats (the pits that LIB filled), cirque
//               floors on high cold ground (tarns), flat valley floors
//               beside big rivers (oxbows, flood-plain ponds), low wet flats
//               (ponds) and, with "Great lakes", large ellipses of glacial
//               scour with a moraine rim, islands and bays. Each site is
//               carved (only lowered, except the moraine rim and islands).
//    3 flood    priorityFlood (Barnes et al. 2014, priority queue plus a pit
//               queue, epsilon 0) over the whole grid; findBasins labels the
//               raised cells. Each basin: level = its spill height exactly,
//               spill = the rim cell at that level, outlet = the first cell
//               below the level down the drainage tree (from[]).
//    4 keep     a basin that holds a site (or a LIB lake) is kept by kind;
//               the rest is filled flat (the LIB rule), so no pit drains
//               nowhere.
//    5 balance  waterBalance: P / E from the moisture, the temperature and
//               "Climate wetness"; a closed basin (supply under the
//               evaporation) sinks under its spill: an endorheic lake, salt
//               when it is dry; a very dry basin is a salt pan (playa).
//    6 beds     shapeBed: shelving shores, deeper centres (only lowers the
//               bed, so level and spill do not change).
//    7 write    height, water (level - bed), biome (lake), river (0 under a
//               lake), moisture (wet banks), t.lakeId (Int16Array, -1 none),
//               t.lakes (see below).
//    8 rivers   splitRivers: a river that runs into a lake ends there
//               (end 'lake', lake k); the part that leaves a lake is kept
//               only when it leaves at the spill; else it is dropped down to
//               the next join of another river. outflowRivers: a new river
//               from the spill of each open lake with no river there,
//               down the drainage tree (fromLake k).
//
//  t.lakes[k] = { level, x, z, area m2, depth m, kind 'lake'|'pond'|'tarn'|
//    'oxbow'|'great'|'user', open, salt, ice 0..1, fetch m, spill [x, z],
//    spillLevel, outlet [x, z] | null, cells, bbox [x0, z0, x1, z1] }
//  t.rivers[i] gains lake (index, when end is 'lake') and fromLake (index).
//
//  ADD WATER  addWaterAt(t, x, z, { radius }) floods the basin under the
//  point to its spill level; on ground with no closed basin it scoops a
//  bowl of the radius first. It returns an edit; undoWaterEdit(t, edit)
//  puts every touched cell, t.lakes and t.rivers back.
//
//  grep -n targets: "export const WATER_OPTIONS", "export const WATER_PRESETS",
//  "export function withWaterBodies", "export function priorityFlood",
//  "export function findBasins", "export function fillBasin",
//  "export function applyWaterBodies", "function shapeCoast", "function pickSites",
//  "function carveBowl", "function carveCrescent", "function carveGreatLake",
//  "export function waterBalance", "function shapeBed", "function writeLake",
//  "export function splitRivers", "function outflowRivers",
//  "export function addWaterAt", "export function undoWaterEdit"
// ============================================================================

import { BIOMES } from '../../../lib/dla-terrain.js';

const BID = Object.fromEntries(BIOMES.map((b) => [b.key, b.id]));
const GROUP = 'Water bodies';
export const WATER_GROUP = GROUP;

const R = (key, label, min, max, step, def, text) => ({ key, label, group: GROUP, type: 'range', min, max, step, def, text });
const S = (key, label, choices, def, text) => ({ key, label, group: GROUP, type: 'select', choices, def, text });
const T = (key, label, def, text) => ({ key, label, group: GROUP, type: 'bool', def, text });

export const WATER_OPTIONS = Object.freeze([
  S('lakeMode', 'Lakes', ['none', 'few', 'many'], 'few', 'Lakes in closed basins, ponds, tarns and oxbow lakes. None keeps only the great lakes.'),
  R('greatLakes', 'Great lakes', 0, 4, 1, 0, 'Very large basins of glacial scour that fill to big freshwater lakes with islands and bays (0 is off).'),
  R('ponds', 'Ponds', 0, 1, 0.01, 0.35, 'Small ponds on low, flat, wet ground.'),
  R('lakeWetness', 'Climate wetness', 0, 1, 0.01, 0.5, 'The water balance of the lakes. A dry climate keeps closed basins under their spill point: salt lakes with no outflow.'),
  T('tarns', 'Tarns', true, 'Small lakes in glacial cirques on high, cold ground.'),
  T('oxbows', 'Oxbow lakes', true, 'Cut-off meanders and flood-plain ponds beside big rivers on flat valley floors.'),
  R('shelf', 'Coastal shelf', 0, 1, 0.01, 0.5, 'A shallow shelf along gentle coasts (light shallows). Cliffs keep deep water.'),
]);
const WKEYS = WATER_OPTIONS.map((d) => d.key);

export function waterDefaults() {
  const o = {};
  for (const d of WATER_OPTIONS) o[d.key] = d.def;
  return o;
}

// the water keys of each LIB preset (missing keys take the defaults)
export const WATER_PRESETS = Object.freeze({
  alpine: { lakeMode: 'many', tarns: true, ponds: 0.25, lakeWetness: 0.6 },
  archipelago: { lakeMode: 'few', ponds: 0.2, shelf: 0.75 },
  canyonlands: { lakeMode: 'none', ponds: 0, lakeWetness: 0.15 },
  'river-delta': { lakeMode: 'many', oxbows: true, ponds: 0.8, shelf: 0.85 },
  fjords: { lakeMode: 'many', tarns: true, ponds: 0.3, shelf: 0.15 },
  'volcanic-isles': { lakeMode: 'few', ponds: 0.1, shelf: 0.35 },
  highlands: { lakeMode: 'many', greatLakes: 1, ponds: 0.45 },
  'mesa-desert': { lakeMode: 'few', ponds: 0, lakeWetness: 0.06, tarns: false },
  'rift-valley': { lakeMode: 'few', greatLakes: 2, lakeWetness: 0.35 },
  'tropical-island': { lakeMode: 'few', ponds: 0.3, shelf: 0.9 },
  'great-range': { lakeMode: 'many', tarns: true, greatLakes: 1 },
  'tundra-coast': { lakeMode: 'many', ponds: 0.9, tarns: true },
});

// ------------------------------------------------------------ small utils --
function mulberry32(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const D8X = [1, -1, 0, 0, 1, 1, -1, -1], D8Y = [0, 0, 1, -1, 1, -1, 1, -1];
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function vhash(ix, iy, s) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) % 100000) / 100000;
}
function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = vhash(ix, iy, s), b = vhash(ix + 1, iy, s), c = vhash(ix, iy + 1, s), d = vhash(ix + 1, iy + 1, s);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}
function fbm2(x, y, s) { return 0.57 * vnoise(x, y, s) + 0.29 * vnoise(x * 2.1, y * 2.1, s + 7) + 0.14 * vnoise(x * 4.3, y * 4.3, s + 13); }

// A binary min-heap of (cell, key); grows when full.
class Heap {
  constructor(cap = 1024) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  push(v, key) {
    if (this.n >= this.k.length) {
      const k2 = new Float64Array(this.k.length * 2); k2.set(this.k); this.k = k2;
      const v2 = new Int32Array(this.v.length * 2); v2.set(this.v); this.v = v2;
    }
    const K = this.k, V = this.v;
    let c = this.n++;
    while (c > 0) { const p = (c - 1) >> 1; if (K[p] <= key) break; K[c] = K[p]; V[c] = V[p]; c = p; }
    K[c] = key; V[c] = v;
  }
  pop() {
    const K = this.k, V = this.v, top = V[0], lk = K[--this.n], lv = V[this.n];
    let c = 0;
    for (;;) {
      let l = 2 * c + 1; if (l >= this.n) break;
      if (l + 1 < this.n && K[l + 1] < K[l]) l++;
      if (K[l] >= lk) break;
      K[c] = K[l]; V[c] = V[l]; c = l;
    }
    K[c] = lk; V[c] = lv;
    return top;
  }
}

// ------------------------------------------------------- options wrapper --
// The water keys of one preset id and its LIB opts.
export function presetWater(id, libOpts = {}) {
  return { ...waterDefaults(), lakeMode: libOpts.lakes === false ? 'none' : 'few', ...(WATER_PRESETS[id] || {}) };
}

// The dice for the water keys: same seed, same dice.
export function randomWater(seed = 1, base = {}) {
  const r = mulberry32(((seed >>> 0) ^ 0x77a1c3e5) + 11);
  const q = r();
  const rain = base.rainfall ?? 0.55;
  return {
    lakeMode: q < 0.12 ? 'none' : q < 0.6 ? 'few' : 'many',
    greatLakes: r() < 0.22 ? 1 + Math.floor(r() * 2.6) : 0,
    ponds: Math.round(r() * 80) / 100,
    lakeWetness: Math.round(clamp(rain * 0.8 + r() * 0.3 - 0.05, 0, 1) * 100) / 100,
    tarns: r() < 0.75,
    oxbows: r() < 0.8,
    shelf: Math.round((0.15 + r() * 0.8) * 100) / 100,
  };
}

// LIB opts from page opts: the LIB keeps its own lakes unless the mode is none.
export function libOptions(opts = {}) {
  const o = { ...opts };
  o.lakes = (opts.lakeMode ?? 'few') !== 'none';
  for (const k of WKEYS) delete o[k];
  return o;
}

// Wrap the LIB module: OPTIONS, defaults, PRESETS, randomOptions and
// generateTerrain learn the water keys. Every other export is the same.
export function withWaterBodies(lib) {
  if (!lib || lib.waterBodies || !lib.OPTIONS) return lib;
  const OPTIONS = Object.freeze([...lib.OPTIONS.filter((d) => d.key !== 'lakes'), ...WATER_OPTIONS]);
  const PRESETS = {};
  for (const [id, p] of Object.entries(lib.PRESETS || {})) PRESETS[id] = Object.freeze({ ...p, opts: Object.freeze({ ...p.opts, ...presetWater(id, p.opts) }) });
  if (lib.PRESETS && lib.PRESETS.highlands && !PRESETS['great-lakes']) {
    // a lowland under old ice: a few great lakes, many small ones
    PRESETS['great-lakes'] = Object.freeze({ label: 'Great lakes', opts: Object.freeze({
      ...lib.PRESETS.highlands.opts, heightScale: 900, seaFraction: 0, mask: 'none', glacier: 0.6, latitude: 47, rainfall: 0.7,
      ...waterDefaults(), lakeMode: 'many', greatLakes: 3, ponds: 0.6, lakeWetness: 0.65,
    }) });
  }
  const defaults = () => ({ ...lib.defaults(), ...waterDefaults() });
  const randomOptions = (seed = 1, base = {}, group = null) => {
    if (group === GROUP) return { ...base, ...randomWater(seed, base) };
    const o = lib.randomOptions(seed, base, group);
    const keep = {};
    for (const k of WKEYS) if (base[k] !== undefined) keep[k] = base[k];
    return group ? { ...o, ...waterDefaults(), ...keep } : { ...o, ...randomWater(seed, o) };
  };
  const generateTerrain = async (opts = {}, onProgress = null) => {
    const t = await lib.generateTerrain(libOptions(opts), onProgress);
    applyWaterBodies(t, opts);
    return t;
  };
  return { ...lib, OPTIONS, PRESETS: Object.freeze(PRESETS), defaults, randomOptions, generateTerrain, waterBodies: true, WATER_GROUP: GROUP };
}

// ------------------------------------------------------------ the flood --
// Priority-Flood (Barnes, Lehman, Mulla 2014) with a pit queue. Outlets:
// the map edge and the cells of o.outlet (a Uint8Array mask; by default
// every cell under o.sea). epsilon 0: a filled pit is a flat at its spill
// height. from[j] is the cell that reached j first: the drainage tree
// toward the outlets (filled never rises along it).
export function priorityFlood(H, n, o = {}) {
  const N = n * n, sea = o.sea ?? -Infinity, om = o.outlet || null;
  const filled = new Float32Array(N), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const heap = new Heap(Math.max(1024, 8 * n));
  const pit = new Int32Array(N);
  let ph = 0, pt = 0;
  for (let i = 0; i < N; i++) {
    const x = i % n, y = (i / n) | 0;
    if (x === 0 || y === 0 || x === n - 1 || y === n - 1 || (om ? om[i] : H[i] < sea)) {
      filled[i] = H[i]; closed[i] = 1; heap.push(i, H[i]);
    }
  }
  while (pt > ph || heap.n > 0) {
    const c = pt > ph ? pit[ph++] : heap.pop();
    const fc = filled[c], x = c % n, y = (c / n) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + D8X[k], ny = y + D8Y[k];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = ny * n + nx;
      if (closed[j]) continue;
      closed[j] = 1; from[j] = c;
      if (H[j] <= fc) { filled[j] = fc; pit[pt++] = j; }
      else { filled[j] = H[j]; heap.push(j, H[j]); }
    }
  }
  return { filled, from };
}

// The raised cells (filled > H) in 8-connected basins.
// -> { label Int32Array (-1 none), basins [{ id, level, cells Int32Array,
//      spill, outlet, minH, maxDepth, cx, cz (cell units) }] }
export function findBasins(H, n, pf, o = {}) {
  const N = n * n, f = pf.filled, from = pf.from, minRaise = o.minRaise ?? 1e-4;
  const label = new Int32Array(N).fill(-1);
  const stack = new Int32Array(N);
  const basins = [];
  for (let i = 0; i < N; i++) {
    if (label[i] !== -1 || f[i] - H[i] <= minRaise) continue;
    const id = basins.length, level = f[i];
    let sp = 0, cnt = 0, sx = 0, sz = 0, minH = Infinity;
    const cells = [];
    stack[sp++] = i; label[i] = id;
    while (sp) {
      const c = stack[--sp]; cells.push(c); cnt++;
      const x = c % n, y = (c / n) | 0; sx += x; sz += y;
      if (H[c] < minH) minH = H[c];
      for (let k = 0; k < 8; k++) {
        const nx = x + D8X[k], ny = y + D8Y[k];
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const j = ny * n + nx;
        if (label[j] !== -1 || f[j] - H[j] <= minRaise) continue;
        label[j] = id; stack[sp++] = j;
      }
    }
    // the spill: an outside cell at the level that reached a member first
    let spill = -1;
    for (const c of cells) {
      const p = from[c];
      if (p >= 0 && label[p] !== id) { spill = p; break; }
    }
    // the outlet: down the drainage tree to the first cell under the level
    let outlet = -1, c = spill;
    for (let s = 0; c >= 0 && s < 4 * n; s++) {
      if (H[c] < level) { outlet = c; break; }
      c = from[c];
    }
    basins.push({ id, level, cells: Int32Array.from(cells), spill, outlet, minH, maxDepth: level - minH, cx: sx / cnt, cz: sz / cnt });
  }
  return { label, basins };
}

// One basin from a seed cell: a priority flood that grows from the seed.
// A popped cell under the level is a way out only when its steepest
// descent reaches an outlet (o.isOutlet, else a cell under o.sea) or the
// map edge; a descent that ends in a pit is part of the same depression
// (the water fills that pit too). -> { level, cells (H < level), spill
// (the highest cell on the way out: H[spill] === level), outlet (-1 at the
// edge), edge, capped } or null for a seed in an outlet.
export function fillBasin(H, n, seed, o = {}) {
  const maxCells = o.maxCells ?? n * n, sea = o.sea ?? -Infinity;
  const isOut = o.isOutlet || ((c) => H[c] < sea);
  if (!(seed >= 0) || isOut(seed)) return null;
  const border = (c) => { const x = c % n, y = (c / n) | 0; return x === 0 || y === 0 || x === n - 1 || y === n - 1; };
  const from = new Map(), drains = new Map();
  // bounded: a steepest descent falls at every step, at most 4 n steps
  const descends = (c) => {
    const path = [];
    let x = c, r = 0;
    for (let s = 0; s < 4 * n; s++) {
      if (drains.has(x)) { r = drains.get(x); break; }
      path.push(x);
      if (isOut(x) || border(x)) { r = 1; break; }
      let best = -1, bh = H[x];
      const cx = x % n, cy = (x / n) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = cx + D8X[k], ny = cy + D8Y[k];
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const j = ny * n + nx;
        if (H[j] < bh) { bh = H[j]; best = j; }
      }
      if (best < 0) { r = 0; break; }
      x = best;
    }
    for (const p of path) drains.set(p, r);
    return r;
  };
  const heap = new Heap(256);
  const popped = [];
  let level = H[seed], outlet = -1, spill = -1, edge = false, capped = false;
  heap.push(seed, H[seed]); from.set(seed, -1);
  while (heap.n > 0) {
    const c = heap.pop(), hc = H[c];
    if (isOut(c)) { outlet = c; if (hc > level) level = hc; break; }
    if (hc < level && descends(c)) { outlet = c; break; }
    if (hc > level) level = hc;
    popped.push(c);
    if (border(c)) { edge = true; spill = c; break; }
    if (popped.length > maxCells) { capped = true; break; }
    const x = c % n, y = (c / n) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + D8X[k], ny = y + D8Y[k];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = ny * n + nx;
      if (from.has(j)) continue;
      from.set(j, c);
      heap.push(j, H[j]);
    }
  }
  if (outlet >= 0) {
    // the spill: the highest cell on the way from the outlet back to the seed
    let c = from.get(outlet), best = -Infinity;
    for (let s = 0; c >= 0 && c != null && s < n * n; s++) {
      if (H[c] > best) { best = H[c]; spill = c; }
      c = from.get(c);
    }
  }
  // the lake: the cells joined to the seed under the level (a basin down
  // the way out, reached only over the spill, is not part of it)
  const below = new Set();
  for (const c of popped) if (H[c] < level) below.add(c);
  const cells = H[seed] < level ? connected(n, seed, (j) => below.has(j)) : [];
  return { level, cells: Int32Array.from(cells), spill, outlet, edge, capped };
}

// cells of `mask` (Uint8Array) connected to seed (8 neighbours)
function connected(n, seed, ok) {
  const out = [], st = [seed], seen = new Set([seed]);
  while (st.length) {
    const c = st.pop(); out.push(c);
    const x = c % n, y = (c / n) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + D8X[k], ny = y + D8Y[k];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = ny * n + nx;
      if (!seen.has(j) && ok(j)) { seen.add(j); st.push(j); }
    }
  }
  return out;
}

// Chamfer distance (cells) from each region cell to the nearest cell out of
// the region, on the bounding box. -> { x0, y0, w, h, d Float32Array, max }
function regionDistance(cells, n) {
  let x0 = n, y0 = n, x1 = -1, y1 = -1;
  for (const c of cells) { const x = c % n, y = (c / n) | 0; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  x0 -= 1; y0 -= 1; x1 += 1; y1 += 1;
  const w = x1 - x0 + 1, h = y1 - y0 + 1, d = new Float32Array(w * h);
  for (const c of cells) d[(((c / n) | 0) - y0) * w + (c % n) - x0] = 1e9;
  const a = 1, b = Math.SQRT2;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; if (!d[i]) continue;
    d[i] = Math.min(d[i], d[i - 1] + a, d[i - w] + a, d[i - w - 1] + b, d[i - w + 1] + b);
  }
  let max = 0;
  for (let y = h - 2; y >= 1; y--) for (let x = w - 2; x >= 1; x--) {
    const i = y * w + x; if (!d[i]) continue;
    d[i] = Math.min(d[i], d[i + 1] + a, d[i + w] + a, d[i + w + 1] + b, d[i + w - 1] + b);
    if (d[i] > max) max = d[i];
  }
  return { x0, y0, w, h, d, max, at: (c) => d[(((c / n) | 0) - y0) * w + (c % n) - x0] };
}

// ----------------------------------------------------------- the coast --
// A shelf: sea cells near a gentle coast rise toward a shallow profile; at
// a cliff (steep land at the nearest coast cell) the deep water stays.
function shapeCoast(t, k, rec) {
  const n = t.n, N = n * n, H = t.height, sea = t.seaLevel, texel = t.worldSize / n;
  const dist = new Float32Array(N).fill(1e9), cliff = new Float32Array(N);
  let any = false;
  for (let i = 0; i < N; i++) {
    if (H[i] >= sea) continue;
    any = true;
    const x = i % n, y = (i / n) | 0;
    for (let q = 0; q < 4; q++) {
      const nx = x + D8X[q], ny = y + D8Y[q];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = ny * n + nx;
      if (H[j] >= sea) {
        // land slope at the coast cell j
        const jx = j % n, jy = (j / n) | 0;
        const hx = H[jy * n + Math.min(n - 1, jx + 1)] - H[jy * n + Math.max(0, jx - 1)];
        const hz = H[Math.min(n - 1, jy + 1) * n + jx] - H[Math.max(0, jy - 1) * n + jx];
        const s = Math.hypot(hx, hz) / (2 * texel);
        dist[i] = 1; cliff[i] = Math.max(cliff[i], smooth(0.3, 0.9, s));
      }
    }
  }
  if (!any) return 0;
  // two chamfer passes carry the distance and the cliff value of the coast
  const pass = (y0, y1, dy, x0, x1, dx) => {
    for (let y = y0; y !== y1; y += dy) for (let x = x0; x !== x1; x += dx) {
      const i = y * n + x;
      if (H[i] >= sea) continue;
      for (const [ox, oy, w] of [[-dx, 0, 1], [0, -dy, 1], [-dx, -dy, Math.SQRT2], [dx, -dy, Math.SQRT2]]) {
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const j = ny * n + nx;
        if (dist[j] + w < dist[i]) { dist[i] = dist[j] + w; cliff[i] = cliff[j]; }
      }
    }
  };
  pass(0, n, 1, 0, n, 1);
  pass(n - 1, -1, -1, n - 1, -1, -1);
  const shelfW = 300 + 3000 * k, shelfD = 4 + 26 * k;
  let changed = 0;
  for (let i = 0; i < N; i++) {
    if (H[i] >= sea || dist[i] > 1e8) continue;
    const dm = dist[i] * texel;
    const target = dm < shelfW ? 0.4 + shelfD * Math.pow(dm / shelfW, 0.8) : shelfD + (dm - shelfW) * 0.03;
    const want = sea - target;
    if (H[i] >= want) continue;   // already shallower than the shelf
    const m = k * (1 - cliff[i]) * smooth(0, 1.5, dist[i]);
    if (m <= 0.001) continue;
    if (rec) rec.touch(i);
    H[i] = Math.min(sea - 0.25, H[i] + (want - H[i]) * m);
    if (t.water) t.water[i] = sea - H[i];
    changed++;
  }
  return changed;
}

// ----------------------------------------------------------- carving --
// A bowl of radius r (cells) and depth d at (ci, cj): the inside sinks to
// base - d * (1 - u^2)^2, where base is the lowest ground in the disc; the
// rim blends back into the ground on the high side (a cirque headwall).
function carveBowl(H, n, ci, cj, r, d, rec) {
  const R = Math.ceil(r + 1);
  let base = Infinity, seed = -1;
  for (let y = Math.max(0, cj - R); y <= Math.min(n - 1, cj + R); y++) for (let x = Math.max(0, ci - R); x <= Math.min(n - 1, ci + R); x++) {
    if (Math.hypot(x - ci, y - cj) <= r) base = Math.min(base, H[y * n + x]);
  }
  if (!Number.isFinite(base)) return -1;
  let low = Infinity;
  for (let y = Math.max(1, cj - R); y <= Math.min(n - 2, cj + R); y++) for (let x = Math.max(1, ci - R); x <= Math.min(n - 2, ci + R); x++) {
    const u = Math.hypot(x - ci, y - cj) / r;
    if (u >= 1) continue;
    const i = y * n + x, p = (1 - u * u) * (1 - u * u);
    const target = base - d * p + Math.max(0, H[i] - base) * smooth(0.55, 1, u);
    if (target < H[i]) { if (rec) rec.touch(i); H[i] = target; }
    if (H[i] < low) { low = H[i]; seed = i; }
  }
  return seed;
}

// An oxbow: a crescent of width w (cells) on a ring of radius r around
// (cx, cz) cells, open toward the angle `open` (radians), depth d.
function carveCrescent(H, n, cx, cz, r, w, open, d, rec, ok = null, relief = Infinity) {
  const R = Math.ceil(r + w + 1), ci = Math.round(cx), cj = Math.round(cz);
  const cells = [];
  let base = Infinity;
  for (let y = Math.max(1, cj - R); y <= Math.min(n - 2, cj + R); y++) for (let x = Math.max(1, ci - R); x <= Math.min(n - 2, ci + R); x++) {
    const dx = x - cx, dz = y - cz, rho = Math.hypot(dx, dz);
    const u = Math.abs(rho - r) / (w * 0.5);
    if (u >= 1) continue;
    let da = Math.atan2(dz, dx) - (open + Math.PI);
    da = Math.atan2(Math.sin(da), Math.cos(da));
    if (Math.abs(da) > 2.05) continue;
    const i = y * n + x;
    cells.push([i, u, 1 - smooth(1.45, 2.05, Math.abs(da))]);
    base = Math.min(base, H[i]);
  }
  if (!cells.length) return -1;
  // the ring must lie on free, flat ground (no river, no water)
  let hi = -Infinity;
  for (const [i] of cells) { if (ok && !ok(i)) return -1; hi = Math.max(hi, H[i]); }
  if (hi - base > relief) return -1;
  let seed = -1, low = Infinity;
  for (const [i, u, e] of cells) {
    const target = base - d * (1 - u * u) * e - 0.05;
    if (target < H[i]) { if (rec) rec.touch(i); H[i] = target; }
    if (H[i] < low) { low = H[i]; seed = i; }
  }
  return seed;
}

// A great lake: an ellipse (semi-axes a, b cells, angle ang) scoured to
// base - D with bays (warped rim), islands (raised noise peaks) and a
// moraine rim that holds the water at base + 2 m or more.
function carveGreatLake(t, ci, cj, a, b, ang, D, seed, rec) {
  const n = t.n, H = t.height, sea = t.seaLevel ?? -Infinity;
  const ca = Math.cos(ang), sa = Math.sin(ang), R = Math.ceil(Math.max(a, b) * 1.35 + 2);
  const f = 3 / Math.max(a, 4), fi = 9 / Math.max(a, 4);
  const box = [];
  for (let y = Math.max(1, cj - R); y <= Math.min(n - 2, cj + R); y++) for (let x = Math.max(1, ci - R); x <= Math.min(n - 2, ci + R); x++) {
    const dx = x - ci, dz = y - cj, u = (dx * ca + dz * sa) / a, v = (-dx * sa + dz * ca) / b;
    const r = Math.hypot(u, v) * (1 + 0.42 * (fbm2(x * f, y * f, seed) - 0.5));
    if (r < 1.25) box.push([y * n + x, r, x, y]);
  }
  const inside = box.filter((q) => q[1] < 1 && H[q[0]] >= sea).map((q) => H[q[0]]).sort((p, q) => p - q);
  if (inside.length < 16) return -1;
  const Lb = inside[Math.floor(inside.length * 0.35)];
  // the moraine: the ring keeps at least Lb + 2 m (sea cells stay)
  const ring = Math.max(0.12, 2.6 / Math.max(b, 1));
  let rimMin = Infinity;
  for (const [i, r] of box) {
    if (r < 1 || r > 1 + ring || H[i] < sea) continue;
    if (H[i] < Lb + 2) { if (rec) rec.touch(i); H[i] = Lb + 2; }
    rimMin = Math.min(rimMin, H[i]);
  }
  const top = Math.max(Number.isFinite(rimMin) ? rimMin : Lb, Lb + 2);
  let seedCell = -1, low = Infinity;
  for (const [i, r, x, y] of box) {
    if (r >= 1 || H[i] < sea) continue;
    const p = Math.pow(Math.max(0, 1 - r * r), 0.6);
    let target = Lb - D * p + Math.max(0, H[i] - Lb) * smooth(0.78, 1, r);
    let h = Math.min(H[i], target);
    // islands: noise peaks inside the inner part of the basin
    const ni = fbm2(x * fi, y * fi, seed + 31);
    const k = smooth(0.66, 0.76, ni) * (1 - smooth(0.65, 0.9, r));
    if (k > 0) h = h + (top + 3 + 22 * k - h) * k;
    if (h !== H[i]) { if (rec) rec.touch(i); H[i] = h; }
    if (H[i] < low) { low = H[i]; seedCell = i; }
  }
  return seedCell;
}

// -------------------------------------------------------------- sites --
function landStats(t) {
  const H = t.height, sea = t.seaLevel ?? -Infinity, a = [];
  for (let i = 0; i < H.length; i += 5) if (H[i] >= sea) a.push(H[i]);
  a.sort((p, q) => p - q);
  return (q) => (a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : 0);
}
function slopeAt(H, n, i, texel) {
  const x = i % n, y = (i / n) | 0;
  const hx = H[y * n + Math.min(n - 1, x + 1)] - H[y * n + Math.max(0, x - 1)];
  const hz = H[Math.min(n - 1, y + 1) * n + x] - H[Math.max(0, y - 1) * n + x];
  return Math.hypot(hx, hz) / (2 * texel);
}

// The candidate sites: [{ kind, seed (cell) }] after carving them.
function pickSites(t, o, rng, rec) {
  const n = t.n, N = n * n, H = t.height, texel = t.worldSize / n, sea = t.seaLevel ?? -Infinity;
  const river = t.river, water = t.water, moist = t.moisture, temp = t.temperature;
  const q = landStats(t), many = o.lakeMode === 'many', none = o.lakeMode === 'none';
  const sites = [];
  const areaKm2 = (t.worldSize / 1000) ** 2;
  const taken = [];
  const free = (x, y, r) => taken.every(([a, b, s]) => Math.hypot(a - x, b - y) > s + r);
  const okCell = (i) => H[i] >= sea + 0.5 && !(water && water[i] > 0.3) && !(river && river[i] > 0.15);
  const border = (x, y, m) => x < m || y < m || x >= n - m || y >= n - m;

  // great lakes first: they take the most room
  if (o.greatLakes > 0) {
    const nc = 48, cands = [];
    for (let gy = 2; gy < nc - 2; gy++) for (let gx = 2; gx < nc - 2; gx++) {
      const x = Math.floor((gx + 0.5) * n / nc), y = Math.floor((gy + 0.5) * n / nc), i = y * n + x;
      if (H[i] < sea + 3) continue;
      cands.push({ x, y, s: -(H[i] - q(0)) / Math.max(1, q(0.98) - q(0)) + 0.35 * rng() });
    }
    cands.sort((p, r) => r.s - p.s);
    const baseAng = ((t.opts && t.opts.rangeAngle) ?? 35) * Math.PI / 180 + Math.PI / 2;
    const D = clamp(0.05 * (t.heightScale || 1500), 35, 220);
    for (let g = 0; g < o.greatLakes; g++) {
      let a = (n * (0.1 + 0.05 * rng())), c = null;
      const e = 0.4 + 0.25 * rng();
      // smaller ellipses when the land has no room for the first size
      for (let tries = 0; tries < 4 && !c; tries++, a *= 0.75) c = cands.find((p) => !border(p.x, p.y, a * 1.3 + 3) && free(p.x, p.y, a * 1.2) && seaFar(t, p.x, p.y, a * 1.1));
      if (!c) break;
      a /= 0.75;
      const b = a * e;
      const ang = baseAng + (rng() - 0.5) * 0.9;
      const seed = carveGreatLake(t, c.x, c.y, a, b, ang, D, 101 + g * 17 + ((t.opts && t.opts.seed) | 0), rec);
      if (seed >= 0) { sites.push({ kind: 'great', seed }); taken.push([c.x, c.y, a * 1.3]); }
    }
  }
  if (none) return sites;

  // flats: the pits that the LIB fill made flat
  const flat = new Uint8Array(N), tol = 0.016;
  for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
    const i = y * n + x, h = H[i];
    if (h < sea + 0.2) continue;
    let ok = true;
    for (let k = 0; k < 8 && ok; k++) if (Math.abs(H[(y + D8Y[k]) * n + x + D8X[k]] - h) > tol) ok = false;
    if (ok) flat[i] = 1;
  }
  if (river) for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
    const i = y * n + x;
    if (flat[i] || river[i] < 0.2) continue;
    let c = 0;
    for (let k = 0; k < 4; k++) c += flat[(y + D8Y[k]) * n + x + D8X[k]] === 1 ? 1 : 0;
    if (c >= 2) flat[i] = 2;
  }
  const lab = new Int32Array(N).fill(-1), comps = [];
  for (let i = 0; i < N; i++) {
    if (!flat[i] || lab[i] >= 0) continue;
    const id = comps.length;
    lab[i] = id;
    const cells = connected(n, i, (j) => { if (!flat[j] || lab[j] >= 0) return false; lab[j] = id; return true; });
    let edge = false, nearSea = false;
    for (const c of cells) {
      const x = c % n, y = (c / n) | 0;
      if (border(x, y, 2)) edge = true;
      for (let k = 0; k < 8 && !nearSea; k++) { const j = (y + D8Y[k]) * n + x + D8X[k]; if (j >= 0 && j < N && H[j] < sea) nearSea = true; }
    }
    comps.push({ cells, edge, nearSea });
  }
  const minFlat = Math.max(many ? 10 : 22, Math.round(N * (many ? 6e-5 : 3e-4)));
  const flats = comps.filter((c) => !c.edge && !c.nearSea && c.cells.length >= minFlat && c.cells.length < N * 0.05);
  flats.sort((p, r) => r.cells.length - p.cells.length);
  const nFlat = Math.min(flats.length, many ? 32 : 9);
  for (let k = 0; k < nFlat; k++) {
    const cells = flats[k].cells, rd = regionDistance(cells, n);
    const area = cells.length * texel * texel, D = clamp(Math.sqrt(area) * 0.012, 2, 45);
    let seed = -1, best = -1;
    for (const c of cells) {
      const d = rd.at(c);
      if (d < 2) continue;
      const p = 1 - Math.exp(-(d - 1.5) / Math.max(1, rd.max * 0.35));
      if (rec) rec.touch(c);
      H[c] -= D * p;
      if (d > best) { best = d; seed = c; }
    }
    if (seed >= 0) { sites.push({ kind: 'lake', seed }); const s = cells[0]; taken.push([s % n, (s / n) | 0, Math.sqrt(cells.length)]); }
  }

  // tarns: cirque floors on high, cold ground below a headwall
  if (o.tarns) {
    const want = many ? 12 : 4, hi = q(0.68), relief = Math.max(60, 0.035 * (t.heightScale || 1500));
    const rad = Math.max(3, Math.round(500 / texel));
    const cand = [];
    for (let y = rad; y < n - rad; y += 3) for (let x = rad; x < n - rad; x += 3) {
      const i = y * n + x;
      if (H[i] < hi || !okCell(i)) continue;
      if (temp && temp[i] > 7) continue;
      if (slopeAt(H, n, i, texel) > 0.2) continue;
      let up = -Infinity;
      for (let k = 0; k < 16; k++) {
        const a = k / 16 * Math.PI * 2, j = Math.round(y + Math.sin(a) * rad) * n + Math.round(x + Math.cos(a) * rad);
        up = Math.max(up, H[j]);
      }
      if (up - H[i] < relief) continue;
      cand.push({ x, y, s: (up - H[i]) / relief + rng() });
    }
    cand.sort((p, r) => r.s - p.s);
    let got = 0;
    for (const c of cand) {
      if (got >= want) break;
      const r = clamp((70 + 160 * rng()) / texel, 1.8, 6);
      if (!free(c.x, c.y, r * 4)) continue;
      const seed = carveBowl(H, n, c.x, c.y, r, 5 + 12 * rng(), rec);
      if (seed >= 0) { sites.push({ kind: 'tarn', seed }); taken.push([c.x, c.y, r * 4]); got++; }
    }
  }

  // oxbows and flood-plain ponds beside big rivers on flat valley floors
  if (o.oxbows && t.rivers && t.rivers.length) {
    const want = many ? 10 : 3, ws = [];
    for (const r of t.rivers) if (r.flow) for (let k = 0; k < r.flow.length; k += 8) ws.push(r.flow[k]);
    ws.sort((a, b) => a - b);
    const fmin = ws.length ? ws[Math.floor(ws.length * 0.6)] : Infinity;
    const cand = [];
    for (let ri = 0; ri < t.rivers.length; ri++) {
      const r = t.rivers[ri], m = r.pts.length >> 1;
      for (let k = 6; k < m - 6; k += 7) {
        if (!r.flow || r.flow[k] < fmin) continue;
        const ax = r.pts[(k - 4) * 2], az = r.pts[(k - 4) * 2 + 1], bx = r.pts[(k + 4) * 2], bz = r.pts[(k + 4) * 2 + 1];
        const ha = sampleH(t, ax, az), hb = sampleH(t, bx, bz), L = Math.hypot(bx - ax, bz - az) || 1;
        if (Math.abs(ha - hb) / L > 0.006) continue;
        cand.push({ ri, k, s: rng(), dx: (bx - ax) / L, dz: (bz - az) / L });
      }
    }
    cand.sort((p, r) => r.s - p.s);
    let got = 0;
    for (const c of cand) {
      if (got >= want) break;
      const r = t.rivers[c.ri], W = Math.max(r.width ? r.width[c.k] : 20, texel);
      const px = (r.pts[c.k * 2] - (-t.worldSize / 2)) / texel - 0.5, pz = (r.pts[c.k * 2 + 1] - (-t.worldSize / 2)) / texel - 0.5;
      const side = rng() < 0.5 ? 1 : -1, nx = -c.dz * side, nz = c.dx * side;
      const pond = rng() < 0.45;
      let seed = -1, cx, cz, rr;
      if (pond) {
        rr = clamp((25 + 50 * rng()) / texel, 1.5, 4);
        const off = W / 2 / texel + 2.5 + rr;
        cx = px + nx * off; cz = pz + nz * off;
      } else {
        rr = clamp(2.2 * W / texel, 3, 400 / texel + 3);
        const w = Math.max(1.7, 0.9 * W / texel);
        const off = W / 2 / texel + 2 + 0.42 * rr + w / 2;
        cx = px + nx * off; cz = pz + nz * off;
        if (!free(cx, cz, rr + w)) continue;
        seed = carveCrescent(H, n, cx, cz, rr, w, Math.atan2(-nz, -nx), 2 + 2 * rng(), rec, (i) => !(t.river && t.river[i] > 0.15) && !(t.water && t.water[i] > 0.3) && H[i] >= sea + 0.5, 4);
      }
      if (pond) {
        if (!siteFlat(t, cx, cz, rr + 1, 3) || !free(cx, cz, rr * 3)) continue;
        seed = carveBowl(H, n, Math.round(cx), Math.round(cz), rr, 1.5 + 1.5 * rng(), rec);
      }
      if (seed >= 0) { sites.push({ kind: pond ? 'pond' : 'oxbow', seed }); taken.push([cx, cz, rr * 2]); got++; }
    }
  }

  // ponds on low, flat, wet ground
  if (o.ponds > 0) {
    const want = Math.min(160, Math.round(o.ponds * (many ? 18 : 6) * areaKm2 / 100));
    const lo = q(0.5);
    let got = 0;
    for (let tries = 0; tries < want * 40 && got < want; tries++) {
      const x = 4 + Math.floor(rng() * (n - 8)), y = 4 + Math.floor(rng() * (n - 8)), i = y * n + x;
      if (H[i] > lo || !okCell(i)) continue;
      if (moist && moist[i] < 0.35) continue;
      if (slopeAt(H, n, i, texel) > 0.05) continue;
      const r = clamp((20 + 45 * rng()) / texel, 1.5, 4);
      if (!free(x, y, r * 3) || !siteFlat(t, x, y, r + 1, 2.5)) continue;
      const seed = carveBowl(H, n, x, y, r, 1.2 + 1.8 * rng(), rec);
      if (seed >= 0) { sites.push({ kind: 'pond', seed }); taken.push([x, y, r * 3]); got++; }
    }
  }
  return sites;
}
function sampleH(t, x, z) {
  const n = t.n, cs = t.worldSize / n, o = -t.worldSize / 2;
  const i = clamp(Math.round((x - o) / cs - 0.5), 0, n - 1), j = clamp(Math.round((z - o) / cs - 0.5), 0, n - 1);
  return t.height[j * n + i];
}
// the ground in a disc (cells) has under `relief` m between its lowest and
// highest cell, no river and no water
function siteFlat(t, cx, cz, r, relief) {
  const n = t.n, H = t.height, R = Math.ceil(r);
  let lo = Infinity, hi = -Infinity;
  for (let y = Math.round(cz) - R; y <= Math.round(cz) + R; y++) for (let x = Math.round(cx) - R; x <= Math.round(cx) + R; x++) {
    if (x < 2 || y < 2 || x >= n - 2 || y >= n - 2) return false;
    if (Math.hypot(x - cx, y - cz) > r) continue;
    const i = y * n + x;
    if ((t.river && t.river[i] > 0.15) || (t.water && t.water[i] > 0.3) || H[i] < (t.seaLevel ?? -Infinity) + 0.5) return false;
    lo = Math.min(lo, H[i]); hi = Math.max(hi, H[i]);
  }
  return hi - lo < relief;
}
// no sea cell within r cells (coarse test on a ring and the centre)
function seaFar(t, x, y, r) {
  const n = t.n, sea = t.seaLevel ?? -Infinity;
  for (let s = 0.3; s <= 1.01; s += 0.35) for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2, i = clamp(Math.round(x + Math.cos(a) * r * s), 0, n - 1), j = clamp(Math.round(y + Math.sin(a) * r * s), 0, n - 1);
    if (t.height[j * n + i] < sea) return false;
  }
  return true;
}

// ------------------------------------------------------- water balance --
// P / E of a basin from its mean moisture (0..1), mean temperature (C) and
// the wetness option. open: the supply over the catchment and the lake
// is at least the evaporation of the full lake. Else the equilibrium area
// is P Ac / (E - P), and the level sinks to give that area.
export function waterBalance({ moisture = 0.5, temperature = 10, wetness = 0.5, catchM2 = 0, lakeM2 = 1 }) {
  const qn = clamp(moisture + (wetness - 0.5) * 0.9, 0, 1);
  let pe = 0.03 + 2.4 * qn * qn;
  pe /= clamp(0.55 + Math.max(temperature, 0) / 22, 0.4, 1.8);
  const supply = pe * (catchM2 + lakeM2);
  const open = supply >= lakeM2;
  const eqArea = open ? lakeM2 : (pe >= 1 ? lakeM2 : pe * catchM2 / (1 - pe));
  return { pe, open, eqArea: Math.min(lakeM2, eqArea), salt: !open && pe < 0.55 };
}

// ------------------------------------------------------------- the bed --
const DEPTH = {
  pond: (A) => clamp(1.2 + Math.sqrt(A) * 0.01, 1.2, 4),
  oxbow: () => 2.6,
  tarn: (A) => clamp(6 + Math.sqrt(A) * 0.04, 6, 30),
  lake: (A) => clamp(Math.sqrt(A) * 0.02, 3, 60),
  great: (A) => clamp(Math.sqrt(A) * 0.012, 30, 250),
  user: (A) => clamp(Math.sqrt(A) * 0.02, 2, 40),
};
// shelving shores and deeper centres; only lowers the bed
function shapeBed(t, cells, level, kind, salt, rec) {
  const n = t.n, H = t.height, texel = t.worldSize / n;
  const A = cells.length * texel * texel;
  let D = (DEPTH[kind] || DEPTH.lake)(A);
  if (salt) D = Math.min(D, 4);
  const rd = regionDistance(cells, n);
  const sc = Math.max(0.8, rd.max * 0.35);
  for (const c of cells) {
    const d = rd.at(c);
    const p = 1 - Math.exp(-Math.max(0, d - 0.5) / sc);
    const target = level - Math.max(0.35, D * p);
    if (target < H[c]) { if (rec) rec.touch(c); H[c] = target; }
  }
}

// ------------------------------------------------------------- writing --
function cellXZ(t, c) { const n = t.n, cs = t.worldSize / n, o = -t.worldSize / 2; return [o + (c % n + 0.5) * cs, o + (((c / n) | 0) + 0.5) * cs]; }

function writeLake(t, id, cells, level, lake, rec) {
  const n = t.n, H = t.height;
  for (const c of cells) {
    if (rec) rec.touch(c);
    t.lakeId[c] = id;
    if (t.water) t.water[c] = Math.max(0, level - H[c]);
    if (t.biome) t.biome[c] = BID.lake;
    if (t.river) t.river[c] = 0;
  }
  // wet banks (a salt lake: a dry white pan round it, the old shore)
  if (t.moisture || t.biome) {
    const ring = new Set();
    for (const c of cells) {
      const x = c % n, y = (c / n) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + D8X[k], ny = y + D8Y[k];
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const j = ny * n + nx;
        if (t.lakeId[j] !== id) ring.add(j);
      }
    }
    for (const j of ring) {
      if (t.lakeId[j] >= 0 || H[j] < (t.seaLevel ?? -Infinity)) continue;
      if (rec) rec.touch(j);
      if (lake.salt) { if (t.biome && H[j] < lake.spillLevel + 0.5) t.biome[j] = BID.beach; }
      else if (t.moisture) t.moisture[j] = Math.max(t.moisture[j], 0.62);
      if (!lake.salt && t.biome && (lake.kind === 'great' || lake.kind === 'lake') && H[j] - level < 1.2 && slopeAt(H, n, j, t.worldSize / n) < 0.08) t.biome[j] = BID.beach;
    }
  }
}

function lakeRecord(t, kind, cells, level, spill, outlet, extra) {
  const n = t.n, cs = t.worldSize / n, o = -t.worldSize / 2, H = t.height;
  let sx = 0, sz = 0, mx = 0, x0 = n, z0 = n, x1 = 0, z1 = 0, tSum = 0, tN = 0;
  for (const c of cells) {
    const x = c % n, y = (c / n) | 0;
    sx += x; sz += y; mx = Math.max(mx, level - H[c]);
    x0 = Math.min(x0, x); z0 = Math.min(z0, y); x1 = Math.max(x1, x); z1 = Math.max(z1, y);
    if (t.temperature) { tSum += t.temperature[c]; tN++; }
  }
  const area = cells.length * cs * cs, meanT = tN ? tSum / tN : 10;
  return {
    level, x: o + (sx / cells.length + 0.5) * cs, z: o + (sz / cells.length + 0.5) * cs, area, depth: mx, kind,
    open: true, salt: false, ice: clamp((2 - meanT) / 6, 0, 1), fetch: 2 * Math.sqrt(area / Math.PI),
    spill: spill >= 0 ? cellXZ(t, spill) : null, spillCell: spill, spillLevel: level,
    outlet: outlet >= 0 ? cellXZ(t, outlet) : null, outletCell: outlet, cells: cells.length,
    bbox: [o + x0 * cs, o + z0 * cs, o + (x1 + 1) * cs, o + (z1 + 1) * cs], meanT, ...extra,
  };
}

// A change recorder: the old values of each touched cell, once.
function makeRecorder(t) {
  const idx = [], old = { height: [], water: [], biome: [], river: [], moisture: [], lakeId: [] };
  const seen = new Set();
  return {
    idx, old,
    touch(i) {
      if (seen.has(i)) return;
      seen.add(i); idx.push(i);
      old.height.push(t.height[i]);
      old.water.push(t.water ? t.water[i] : 0);
      old.biome.push(t.biome ? t.biome[i] : 0);
      old.river.push(t.river ? t.river[i] : 0);
      old.moisture.push(t.moisture ? t.moisture[i] : 0);
      old.lakeId.push(t.lakeId ? t.lakeId[i] : -1);
    },
  };
}

// ---------------------------------------------------------- the rivers --
function riverCells(t, r) {
  if (r.cells && r.cells.length === r.pts.length >> 1) return r.cells;
  const n = t.n, cs = t.worldSize / n, o = -t.worldSize / 2, m = r.pts.length >> 1, out = new Int32Array(m);
  for (let k = 0; k < m; k++) {
    const i = clamp(Math.round((r.pts[k * 2] - o) / cs - 0.5), 0, n - 1), j = clamp(Math.round((r.pts[k * 2 + 1] - o) / cs - 0.5), 0, n - 1);
    out[k] = j * n + i;
  }
  return out;
}
function sliceRiver(r, cells, a, b, end, extra) {
  return { pts: r.pts.slice(a * 2, b * 2), width: r.width ? r.width.slice(a, b) : new Float32Array(b - a).fill(4), flow: r.flow ? r.flow.slice(a, b) : new Float32Array(b - a).fill(1), end, cells: Int32Array.from(cells.subarray(a, b)), ...extra };
}

// Cut the rivers at the lakes (see the header). lakes: t.lakes; only lakes
// with ids in `which` (a Set) are tested when it is given.
export function splitRivers(t, which = null, rec = null) {
  const n = t.n, lakeId = t.lakeId, lakes = t.lakes;
  if (!t.rivers || !lakeId) return { cut: 0, dropped: 0 };
  const inLake = (c) => { const k = lakeId[c]; return k >= 0 && (!which || which.has(k)) ? k : -1; };
  // join cells: the last cell of every river that joins another
  const joins = new Set();
  const all = t.rivers.map((r) => riverCells(t, r));
  t.rivers.forEach((r, i) => { if (r.end === 'join') joins.add(all[i][all[i].length - 1]); });
  const out = [];
  let cut = 0, dropped = 0;
  const dropCell = (c) => {
    if (rec) rec.touch(c);
    if (t.river) t.river[c] *= 0.3;
    if (t.water && !(lakeId[c] >= 0) && t.height[c] >= (t.seaLevel ?? -Infinity)) t.water[c] = 0;
    dropped++;
  };
  for (let ri = 0; ri < t.rivers.length; ri++) {
    const r = t.rivers[ri], cells = all[ri], L = cells.length;
    let hit = false;
    for (let k = 0; k < L && !hit; k++) if (inLake(cells[k]) >= 0) hit = true;
    if (!hit) { out.push(r); continue; }
    cut++;
    let mode = 'keep', start = 0, lake = -1, from = r.fromLake;
    for (let k = 0; k < L; k++) {
      const c = cells[k], lk = inLake(c);
      if (mode === 'keep') {
        if (lk >= 0) {
          if (k + 1 - start >= 2) out.push(sliceRiver(r, cells, start, k + 1, 'lake', { lake: lk, ...(from != null ? { fromLake: from } : {}) }));
          mode = 'lake'; lake = lk; from = undefined;
        }
      } else if (mode === 'lake') {
        if (lk >= 0) { lake = lk; continue; }
        const L0 = lakes[lake], sc = L0 && L0.spillCell;
        const near = sc >= 0 && Math.max(Math.abs((sc % n) - (c % n)), Math.abs(((sc / n) | 0) - ((c / n) | 0))) <= 1;
        if (L0 && L0.open && near) { mode = 'keep'; start = k; from = lake; }
        else { mode = 'drop'; dropCell(c); }
      } else if (mode === 'drop') {
        if (lk >= 0) { mode = 'lake'; lake = lk; continue; }
        if (joins.has(c)) { mode = 'keep'; start = k; from = undefined; }
        else dropCell(c);
      }
    }
    if (mode === 'keep' && L - start >= 2) out.push(sliceRiver(r, cells, start, L, r.end, from != null ? { fromLake: from } : {}));
  }
  t.rivers = out;
  return { cut, dropped };
}

// A new river from the spill of each open lake with no river leaving there,
// down the drainage tree (pf.from) or, with no tree, by steepest descent.
function outflowRivers(t, ids, from, rec, opt = {}) {
  const n = t.n, H = t.height, lakeId = t.lakeId, sea = t.seaLevel ?? -Infinity, cs = t.worldSize / n, o = -t.worldSize / 2;
  const isRiver = new Uint8Array(n * n);
  for (const r of t.rivers) for (const c of riverCells(t, r)) isRiver[c] = 1;
  const rw = (t.opts && t.opts.riverWidth) || 1;
  const qmax = new Map();
  if (t.flow) for (let i = 0; i < n * n; i++) { const k = lakeId[i]; if (k >= 0 && t.flow[i] > (qmax.get(k) || 0)) qmax.set(k, t.flow[i]); }
  // a channel cell next to a lake would let the lake out under its level
  const nextToLake = (p) => {
    const x = p % n, y = (p / n) | 0;
    for (let q = 0; q < 8; q++) {
      const a = x + D8X[q], b = y + D8Y[q];
      if (a >= 0 && b >= 0 && a < n && b < n && lakeId[b * n + a] >= 0) return true;
    }
    return false;
  };
  let made = 0;
  for (const k of ids) {
    const L = t.lakes[k];
    if (!L || !L.open || !(L.spillCell >= 0)) continue;
    // ponds and oxbows seep; small lakes have no stream of their own
    if (L.kind === 'pond' || L.kind === 'oxbow' || L.area < (opt.minArea ?? 30000)) continue;
    const sc = L.spillCell;
    const has = t.rivers.some((r) => r.fromLake === k);
    if (has) continue;
    const path = [sc];
    let c = sc, end = 'edge';
    for (let s = 0; s < 4 * n; s++) {
      let nx = -1;
      if (from && from[c] >= 0) nx = from[c];
      else {
        let best = H[c];
        const x = c % n, y = (c / n) | 0;
        for (let q = 0; q < 8; q++) {
          const a = x + D8X[q], b = y + D8Y[q];
          if (a < 0 || b < 0 || a >= n || b >= n) continue;
          const j = b * n + a;
          if (H[j] < best && lakeId[j] !== k) { best = H[j]; nx = j; }
        }
      }
      if (nx < 0) { end = 'edge'; break; }
      c = nx;
      path.push(c);
      if (H[c] < sea) { end = 'sea'; break; }
      if (lakeId[c] >= 0 && lakeId[c] !== k) { end = 'lake'; break; }
      if (isRiver[c]) { end = 'join'; break; }
      const x = c % n, y = (c / n) | 0;
      if (x === 0 || y === 0 || x === n - 1 || y === n - 1) { end = 'edge'; break; }
    }
    if (path.length < 3 || lakeId[path[1]] === k) continue;
    // catchment flow of the lake: the largest flow in it
    const q = Math.max(qmax.get(k) || 0, L.area / 1e6);
    const m = path.length, pts = new Float32Array(m * 2), wid = new Float32Array(m), fl = new Float32Array(m);
    // the channel floor never goes under the last cell: no pit at the end
    const floor = H[path[m - 1]];
    let bed = H[sc];
    for (let i = 0; i < m; i++) {
      const p = path[i];
      pts[i * 2] = o + (p % n + 0.5) * cs; pts[i * 2 + 1] = o + (((p / n) | 0) + 0.5) * cs;
      fl[i] = q; wid[i] = rw * (2 + 3.2 * Math.sqrt(q));
      // a shallow channel below the spill: monotone, so it makes no pit
      if (i > 0 && i < m - 1 && !(lakeId[p] >= 0) && H[p] >= sea && !nextToLake(p)) {
        bed = Math.max(Math.min(bed, H[p] - 0.5), floor);
        if (rec) rec.touch(p);
        H[p] = Math.min(H[p], bed);
        if (t.river) t.river[p] = Math.max(t.river[p], 0.6);
        if (t.water) t.water[p] = Math.max(t.water[p], 0.4);
      }
    }
    // the pts start at the spill cell: smooth the inner points (1-2-1)
    if (m > 2) {
      const sm = Float32Array.from(pts);
      for (let i = 1; i < m - 1; i++) { sm[i * 2] = 0.25 * pts[i * 2 - 2] + 0.5 * pts[i * 2] + 0.25 * pts[i * 2 + 2]; sm[i * 2 + 1] = 0.25 * pts[i * 2 - 1] + 0.5 * pts[i * 2 + 1] + 0.25 * pts[i * 2 + 3]; }
      pts.set(sm);
    }
    t.rivers.push({ pts, width: wid, flow: fl, end, cells: Int32Array.from(path), fromLake: k, outflow: true });
    for (const p of path) isRiver[p] = 1;
    made++;
  }
  return made;
}

// ------------------------------------------------------------ pipeline --
const KIND_RANK = { great: 5, user: 4, lake: 3, tarn: 2, oxbow: 1, pond: 0 };
const MIN_CELLS = { pond: 2, oxbow: 3, tarn: 3, lake: 6, great: 40, user: 1 };

export function waterOpts(opts = {}) {
  const o = { ...waterDefaults() };
  for (const d of WATER_OPTIONS) {
    const v = opts[d.key];
    if (v == null) continue;
    if (d.type === 'range') { const x = +v; if (Number.isFinite(x)) o[d.key] = clamp(x, d.min, d.max); }
    else if (d.type === 'bool') o[d.key] = !!v;
    else if (d.choices.includes(v)) o[d.key] = v;
  }
  if (opts.lakeMode == null && opts.lakes === false) o.lakeMode = 'none';
  o.greatLakes = Math.round(o.greatLakes);
  return o;
}

// Find, carve, fill and write every body of water (see the header).
// -> info { ms, counts by kind, salt, closed, playas, shelf, sites, rivers }
export function applyWaterBodies(t, opts = {}) {
  const t0 = now();
  if (!t || !t.height || !t.n) return null;
  const o = waterOpts({ ...(t.opts || {}), ...opts });
  const n = t.n, N = n * n, H = t.height, texel = t.worldSize / n, cell2 = texel * texel;
  const hasSea = t.stats ? !!t.stats.hasSea : (t.seaLevel ?? -100) > -99;
  const sea = hasSea ? t.seaLevel : -Infinity;
  const rng = mulberry32((((opts.seed ?? (t.opts && t.opts.seed)) | 0) * 7919 + 17) >>> 0);
  const info = { ms: 0, counts: { lake: 0, pond: 0, tarn: 0, oxbow: 0, great: 0 }, salt: 0, closed: 0, playas: 0, shelf: 0, sites: 0 };
  const oldLakes = t.lakes || [];
  // 1 coast
  if (hasSea && o.shelf > 0) info.shelf = shapeCoast(t, o.shelf, null);
  // the ocean before the carving: a carved bed under the sea level inland
  // is a lake bed, not the sea
  const ocean = new Uint8Array(N);
  for (let i = 0; i < N; i++) ocean[i] = H[i] < sea ? 1 : 0;
  // 2 sites
  const tv = { ...t, seaLevel: sea };
  const sites = pickSites(tv, o, rng, null);
  info.sites = sites.length;
  // 3 flood
  const pf = priorityFlood(H, n, { outlet: ocean });
  const { label, basins } = findBasins(H, n, pf);
  // 4 keep
  const kindOf = new Map();
  const claim = (b, kind) => { if (b < 0) return; const k = kindOf.get(b); if (k == null || KIND_RANK[kind] > KIND_RANK[k]) kindOf.set(b, kind); };
  for (const s of sites) claim(label[s.seed], s.kind);
  if (o.lakeMode !== 'none') {
    const cs = t.worldSize / n, org = -t.worldSize / 2;
    for (const lk of oldLakes) {
      const ci = clamp(Math.round((lk.x - org) / cs - 0.5), 0, n - 1), cj = clamp(Math.round((lk.z - org) / cs - 0.5), 0, n - 1);
      let best = -1;
      for (let dj = -3; dj <= 3 && best < 0; dj++) for (let di = -3; di <= 3; di++) {
        const i = clamp(ci + di, 0, n - 1), j = clamp(cj + dj, 0, n - 1), b = label[j * n + i];
        if (b >= 0) { best = b; break; }
      }
      claim(best, 'lake');
    }
    // other deep, large basins (left by the erosion or the carving)
    const big = Math.max(24, Math.round(N * (o.lakeMode === 'many' ? 1e-4 : 3e-4)));
    for (const b of basins) if (!kindOf.has(b.id) && b.cells.length >= big && b.maxDepth > 2) claim(b.id, 'lake');
  }
  t.lakeId = new Int16Array(N).fill(-1);
  const lakes = [];
  // the LIB lake cells start dry: the kept lakes write their own cells
  if (t.biome) for (let i = 0; i < N; i++) {
    if (t.biome[i] !== BID.lake) continue;
    t.biome[i] = t.moisture && t.moisture[i] < 0.45 ? BID.beach : BID.wetland;
    if (t.water && !ocean[i]) t.water[i] = 0;
  }
  const fillFlat = (b) => {
    for (const c of b.cells) {
      H[c] = b.level;
      if (t.water && t.water[c] > 0 && t.biome && t.biome[c] === BID.lake) { t.water[c] = 0; t.biome[c] = BID.wetland; }
    }
  };
  const order = basins.filter((b) => kindOf.has(b.id)).sort((p, q) => KIND_RANK[kindOf.get(q.id)] - KIND_RANK[kindOf.get(p.id)] || q.cells.length - p.cells.length);
  for (const b of basins) if (!kindOf.has(b.id)) fillFlat(b);
  for (const b of order) {
    const kind = kindOf.get(b.id);
    if (b.cells.length < MIN_CELLS[kind] || lakes.length >= 512) { fillFlat(b); continue; }
    // 5 the water balance
    let mo = 0, te = 0, catchKm2 = 0;
    for (const c of b.cells) {
      mo += t.moisture ? t.moisture[c] : 0.5;
      te += t.temperature ? t.temperature[c] : 10;
      if (t.flow && t.flow[c] > catchKm2) catchKm2 = t.flow[c];
    }
    mo /= b.cells.length; te /= b.cells.length;
    // the flow through the spill and the outlet holds the whole catchment
    if (t.flow) for (const c of [b.spill, b.outlet]) if (c >= 0 && t.flow[c] > catchKm2) catchKm2 = t.flow[c];
    const A0 = b.cells.length * cell2;
    // ponds and oxbows also take ground water and river floods, tarns melt water
    const gw = kind === 'pond' || kind === 'oxbow' ? 5 * A0 : kind === 'tarn' ? 2 * A0 : 0;
    const wb = waterBalance({ moisture: mo, temperature: te, wetness: o.lakeWetness, catchM2: catchKm2 * 1e6 + gw, lakeM2: A0 });
    let level = b.level, cells = b.cells;
    if (!wb.open) {
      const k = Math.floor(wb.eqArea / cell2);
      if (k < Math.max(MIN_CELLS[kind], 2)) {
        // a salt pan (a lake basin): filled flat and white; a dry pond: gone
        fillFlat(b);
        if (t.biome && (kind === 'lake' || kind === 'great')) { for (const c of b.cells) t.biome[c] = BID.beach; info.playas++; }
        continue;
      }
      const hs = Float32Array.from(b.cells, (c) => H[c]).sort();
      level = 0.5 * (hs[k - 1] + hs[Math.min(k, hs.length - 1)]);
      let deep = b.cells[0];
      for (const c of b.cells) if (H[c] < H[deep]) deep = c;
      const inB = new Set(b.cells);
      cells = Int32Array.from(connected(n, deep, (j) => inB.has(j) && H[j] < level));
      info.closed++;
      if (wb.salt) info.salt++;
    }
    // 6 the bed
    shapeBed(t, cells, level, kind, wb.salt, null);
    // 7 write
    const id = lakes.length;
    const lake = lakeRecord(t, kind, cells, level, b.spill, b.outlet, { open: wb.open, salt: wb.salt, spillLevel: b.level, pe: Math.round(wb.pe * 1000) / 1000 });
    lakes.push(lake);
    writeLake(t, id, cells, level, lake, null);
    info.counts[kind] = (info.counts[kind] || 0) + 1;
  }
  t.lakes = lakes;
  // 8 rivers
  const rs = splitRivers(t, null, null);
  info.rivers = { cut: rs.cut, dropped: rs.dropped, outflows: outflowRivers(t, lakes.map((_, i) => i), pf.from, null) };
  // water depth of the sea after the shelf, biome of new sea cells
  if (hasSea && t.water) for (let i = 0; i < N; i++) if (ocean[i]) t.water[i] = sea - H[i];
  if (t.stats) {
    t.stats.lakeCount = lakes.length;
    t.stats.lakeAreaKm2 = lakes.reduce((a, l) => a + l.area, 0) / 1e6;
    t.stats.riverCount = t.rivers.length;
  }
  info.ms = Math.round(now() - t0);
  t.waterBodies = info;
  return info;
}

// ----------------------------------------------------------- add water --
// Flood the basin under (x, z) to its spill level. -> { ok, reason?, lake?,
// edit } where edit undoes it (undoWaterEdit).
export function addWaterAt(t, x, z, o = {}) {
  if (!t || !t.height) return { ok: false, reason: 'no terrain' };
  const n = t.n, N = n * n, cs = t.worldSize / n, org = -t.worldSize / 2, H = t.height;
  const hasSea = t.stats ? !!t.stats.hasSea : (t.seaLevel ?? -100) > -99;
  const sea = hasSea ? t.seaLevel : -Infinity;
  const ci = Math.round((x - org) / cs - 0.5), cj = Math.round((z - org) / cs - 0.5);
  if (ci < 1 || cj < 1 || ci > n - 2 || cj > n - 2) return { ok: false, reason: 'edge' };
  const c = cj * n + ci;
  if (!t.lakeId) t.lakeId = new Int16Array(N).fill(-1);
  if (t.lakeId[c] >= 0) return { ok: false, reason: 'lake', lake: t.lakeId[c] };
  if (H[c] < sea) return { ok: false, reason: 'sea' };
  const rec = makeRecorder(t);
  const maxCells = o.maxCells ?? Math.round(N * 0.25);
  const isOutlet = (q) => t.lakeId[q] >= 0 || H[q] < sea;
  let b = fillBasin(H, n, c, { isOutlet, maxCells });
  let scooped = false;
  if (!b || b.cells.length < 2) {
    // no closed basin here: scoop a bowl of the radius, then fill it
    const r = clamp((o.radius ?? 220) / cs, 1.6, 40);
    const seed = carveBowl(H, n, ci, cj, r, o.depth ?? clamp(r * cs * 0.06, 2, 30), rec);
    scooped = true;
    b = seed >= 0 ? fillBasin(H, n, seed, { isOutlet, maxCells }) : null;
  }
  const undoTo = { lakes: t.lakes, rivers: t.rivers, stats: t.stats ? { ...t.stats } : null };
  const edit = { rec, ...undoTo };
  if (!b || b.capped || !b.cells.length || (b.edge && b.cells.length < 2)) {
    undoWaterEdit(t, edit);
    return { ok: false, reason: b && b.capped ? 'too big' : 'spills' };
  }
  // a fill that reaches another lake: that lake is taken in
  const merged = new Set();
  for (const q of b.cells) if (t.lakeId[q] >= 0) merged.add(t.lakeId[q]);
  const kind = 'user';
  if (scooped) shapeBed(t, b.cells, b.level, kind, false, rec);
  const lakes = (t.lakes || []).slice();
  const id = lakes.length;
  const lake = lakeRecord(t, kind, b.cells, b.level, b.spill, b.outlet, { open: true, spillLevel: b.level });
  if (merged.size) for (const m of merged) lakes[m] = { ...lakes[m], merged: id };
  lakes.push(lake);
  t.lakes = lakes;
  for (const q of b.cells) { rec.touch(q); }
  for (let i = 0; i < N; i++) if (t.lakeId[i] >= 0 && merged.has(t.lakeId[i])) { rec.touch(i); t.lakeId[i] = id; }
  writeLake(t, id, b.cells, b.level, lake, rec);
  // rivers: end the ones that run in, keep or start the outflow
  t.rivers = (t.rivers || []).slice();
  splitRivers(t, new Set([id]), rec);
  outflowRivers(t, [id], null, rec, { minArea: 4000 });
  if (t.stats) { t.stats.lakeCount = lakes.filter((l) => l.merged == null).length; t.stats.riverCount = t.rivers.length; }
  return { ok: true, lake, id, scooped, cells: b.cells.length, edit };
}

// Put back every cell, the lakes and the rivers of an addWaterAt edit.
export function undoWaterEdit(t, edit) {
  if (!t || !edit || !edit.rec) return false;
  const { idx, old } = edit.rec;
  for (let k = idx.length - 1; k >= 0; k--) {
    const i = idx[k];
    t.height[i] = old.height[k];
    if (t.water) t.water[i] = old.water[k];
    if (t.biome) t.biome[i] = old.biome[k];
    if (t.river) t.river[i] = old.river[k];
    if (t.moisture) t.moisture[i] = old.moisture[k];
    if (t.lakeId) t.lakeId[i] = old.lakeId[k];
  }
  t.lakes = edit.lakes;
  t.rivers = edit.rivers;
  if (edit.stats && t.stats) Object.assign(t.stats, edit.stats);
  return true;
}

// The transfer list of the arrays this module adds (for the worker).
export function waterTransferables(t) {
  const out = [];
  if (t.lakeId) out.push(t.lakeId.buffer);
  return out;
}
