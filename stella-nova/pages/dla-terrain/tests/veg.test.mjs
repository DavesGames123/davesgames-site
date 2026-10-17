// ============================================================================
//  DLA TERRAIN  ·  tests/veg.test.mjs — node tests for render/scatter.js
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/dla-terrain/tests/veg.test.mjs
//  (CORE's tests.mjs also runs every file in tests/). Exit code 1 on a fail.
//  The tests use a synthetic terrain (synthTerrain below, the contract
//  Terrain shape) so they do not need lib/dla-terrain.js. When the LIB is
//  present, one more test scatters on a real generated terrain.
//    determinism, tile order and tile size independence (no seams),
//    Poisson spacing across tile edges, no instances in water, no trees on
//    steep slopes, density per biome, species rules (cacti in desert, reeds
//    on the shore), the tile stream and its distance bands.
// ============================================================================
import { makeField, scatterTile, tilesFor, createScatterStream, LAYERS, LAYER_INDEX,
  SPECIES, SPECIES_INDEX, STRIDE, SLOPE_TREE, BIOME_KEYS } from '../render/scatter.js';

let fails = 0, passes = 0;
function check(name, ok, info = '') {
  if (ok) { passes++; console.log('  ok   ' + name + (info ? '  (' + info + ')' : '')); }
  else { fails++; console.log('  FAIL ' + name + (info ? '  (' + info + ')' : '')); }
}

// A 2 km test world: sea in the south west, a river valley, a lake, a
// mountain with cliffs in the north east, a desert in the east.
export function synthTerrain(n = 256, worldSize = 2048) {
  const N = n * n, o = -worldSize / 2;
  const height = new Float32Array(N), moisture = new Float32Array(N), river = new Float32Array(N);
  const water = new Float32Array(N), flow = new Float32Array(N), temperature = new Float32Array(N), biome = new Uint8Array(N);
  const B = Object.fromEntries(BIOME_KEYS.map((k, i) => [k, i]));
  const sea = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = o + (i + 0.5) / n * worldSize, z = o + (j + 0.5) / n * worldSize, k = j * n + i;
    let h = 30 + 18 * Math.sin(x / 210) * Math.cos(z / 170) + 9 * Math.sin((x + z) / 77);
    h -= 60 * Math.max(0, 1 - Math.hypot(x + 900, z + 900) / 700);         // sea corner
    const mx = x - 550, mz = z - 500, md = Math.hypot(mx, mz);
    h += 420 * Math.exp(-(md * md) / (2 * 260 * 260));                       // mountain
    if (md < 330 && md > 230) h += 60 * Math.max(0, Math.sin(Math.atan2(mz, mx) * 3)); // cliff bands
    const rv = Math.abs(z - 120 * Math.sin(x / 300) + 50);                   // river line
    const rw = Math.max(0, 1 - rv / 14);
    h -= 6 * Math.max(0, 1 - rv / 60);
    const lake = Math.hypot(x + 300, z - 420) < 90;
    if (lake) h = Math.min(h, 12);
    height[k] = h;
    river[k] = rw;
    water[k] = lake ? 2 : rw > 0.5 ? 1 : 0;
    flow[k] = rw * 8;
    const dry = Math.max(0, (x - 300) / 600) * Math.max(0, (-z - 100) / 400);
    moisture[k] = Math.min(1, Math.max(0, 0.6 + 0.3 * Math.sin(x / 140 + z / 260) - dry + 0.4 * Math.max(0, 1 - rv / 120)));
    temperature[k] = 1 - Math.max(0, h) / 460;
    let b;
    if (h < sea) b = B.ocean;
    else if (lake) b = B.lake;
    else if (rw > 0.5) b = B.river;
    else if (h < sea + 3) b = B.beach;
    else if (h > 360) b = B.snow;
    else if (h > 270) b = B.barerock;
    else if (h > 200) b = B.alpinemeadow;
    else if (h > 130) b = B.borealforest;
    else if (x < -450 && z > 550) b = B.borealforest;                    // a cold plain
    else if (dry > 0.4) b = B.desert;
    else if (dry > 0.2) b = B.savanna;
    else if (moisture[k] > 0.62) b = B.temperateforest;
    else b = B.grassland;
    biome[k] = b;
  }
  return { n, worldSize, heightScale: 500, seaLevel: sea, height, flow, river, water, moisture,
    temperature, biome, seed: 7 };
}

function allTiles(f, layer, tiles) {
  const parts = tiles.map(([tx, tz]) => scatterTile(f, layer, tx, tz));
  const n = parts.reduce((a, p) => a + p.count, 0);
  const d = new Float32Array(n * STRIDE); let o = 0;
  for (const p of parts) { d.set(p.data, o); o += p.data.length; }
  return { data: d, count: n };
}
const keyOf = (d, i) => d[i * STRIDE].toFixed(3) + ',' + d[i * STRIDE + 2].toFixed(3);

console.log('veg: scatter tests');
const T = synthTerrain();
const f = makeField(T);
const t0 = performance.now();

// 1 determinism
{
  const a = scatterTile(f, 'canopy', 6, 6), b = scatterTile(makeField(synthTerrain()), 'canopy', 6, 6);
  let same = a.count === b.count;
  for (let i = 0; same && i < a.data.length; i++) same = a.data[i] === b.data[i];
  check('determinism: same terrain and tile give the same instances', same && a.count > 0, a.count + ' trees');
}

// 2 seams: a 2x2 block of tiles equals one tile of twice the size
for (const lk of ['canopy', 'understory', 'rocks', 'ground']) {
  const L = LAYERS[LAYER_INDEX[lk]];
  const big = { ...L, tile: L.tile * 2 };
  // the big tile with the most content (so the test is not empty)
  const nb = Math.floor(f.worldSize / big.tile);
  let tx = 0, tz = 0, best = -1;
  for (let j = 0; j < nb; j += Math.max(1, nb >> 3)) for (let i = 0; i < nb; i += Math.max(1, nb >> 3)) {
    const c = scatterTile(f, big, i, j).count; if (c > best) { best = c; tx = i; tz = j; }
  }
  const small = allTiles(f, lk, [[2 * tx, 2 * tz], [2 * tx + 1, 2 * tz], [2 * tx, 2 * tz + 1], [2 * tx + 1, 2 * tz + 1]]);
  const one = scatterTile(f, big, tx, tz);
  const A = new Set(); for (let i = 0; i < small.count; i++) A.add(keyOf(small.data, i));
  const Bs = new Set(); for (let i = 0; i < one.count; i++) Bs.add(keyOf(one.data, i));
  let same = A.size === Bs.size && small.count === one.count;
  for (const k of A) if (!Bs.has(k)) { same = false; break; }
  check('seams: 4 tiles = 1 tile of twice the size (' + lk + ')', same && one.count > 0, small.count + ' vs ' + one.count);
}

// 3 Poisson spacing across tile edges (3x3 tiles of the canopy)
{
  const tiles = []; for (let j = 5; j < 8; j++) for (let i = 5; i < 8; i++) tiles.push([i, j]);
  const all = allTiles(f, 'canopy', tiles);
  const r = LAYERS[LAYER_INDEX.canopy].r;
  let minD = Infinity;
  for (let i = 0; i < all.count; i++) for (let k = i + 1; k < all.count; k++) {
    const dx = all.data[i * STRIDE] - all.data[k * STRIDE], dz = all.data[i * STRIDE + 2] - all.data[k * STRIDE + 2];
    const d = Math.hypot(dx, dz); if (d < minD) minD = d;
  }
  check('poisson: no two canopy trees closer than r across 9 tiles', minD >= r - 1e-4, 'min ' + minD.toFixed(2) + ' m, r ' + r + ', n ' + all.count);
}

// Full scatter of every layer over the whole world (tile by tile)
const world = {};
for (const L of LAYERS) {
  // small layers: only the middle 768 m (they stream to 70..90 m anyway)
  const nt = Math.ceil(f.worldSize / L.tile), tiles = [];
  const m = L.tile <= 32 ? Math.floor(768 / L.tile / 2) : nt;
  const a = Math.max(0, (nt >> 1) - m), b = Math.min(nt, (nt >> 1) + m);
  for (let j = a; j < b; j++) for (let i = a; i < b; i++) tiles.push([i, j]);
  world[L.key] = allTiles(f, L.key, tiles);
}
const tScatter = performance.now() - t0;

// 4 no instances in water; no trees on steep slopes
{
  let wet = 0, steep = 0, tot = 0, maxSlope = 0;
  for (const L of LAYERS) {
    const w = world[L.key];
    for (let i = 0; i < w.count; i++) {
      const x = w.data[i * STRIDE], z = w.data[i * STRIDE + 2], sp = SPECIES[w.data[i * STRIDE + 5]];
      tot++;
      if (f.isWaterAt(x, z)) wet++;
      if (sp.kind === 'tree') { const s = f.slopeAt(x, z); maxSlope = Math.max(maxSlope, s); if (s > SLOPE_TREE) steep++; }
    }
  }
  check('water: no instance stands in the sea, a lake or a river', wet === 0, wet + ' of ' + tot);
  check('slope: no tree on a slope over ' + SLOPE_TREE, steep === 0, 'max tree slope ' + maxSlope.toFixed(2));
}

// 5 density per biome (canopy trees per hectare)
const perBiome = {};
{
  const area = new Float64Array(BIOME_KEYS.length), cnt = new Float64Array(BIOME_KEYS.length);
  const cell = (f.worldSize / T.n) ** 2;
  // gentle ground only (slope under 0.3), so the test reads the biome rule
  const o0 = -f.worldSize / 2, tx = (k) => o0 + ((k % T.n) + 0.5) * f.worldSize / T.n, tz = (k) => o0 + (Math.floor(k / T.n) + 0.5) * f.worldSize / T.n;
  for (let k = 0; k < T.n * T.n; k++) if (f.slopeAt(tx(k), tz(k)) < 0.3) area[T.biome[k]] += cell;
  const w = world.canopy;
  for (let i = 0; i < w.count; i++) { const x = w.data[i * STRIDE], z = w.data[i * STRIDE + 2]; if (f.slopeAt(x, z) < 0.3) cnt[f.biomeAt(x, z)]++; }
  for (let b = 0; b < BIOME_KEYS.length; b++) if (area[b] > 1e4) perBiome[BIOME_KEYS[b]] = cnt[b] / (area[b] / 1e4);
  const fmt = Object.entries(perBiome).map(([k, v]) => k + ' ' + v.toFixed(1)).join(', ');
  console.log('       canopy trees per ha (slope < 0.3): ' + fmt);
  check('density: temperate forest has more trees than grassland', perBiome.temperateforest > 3 * perBiome.grassland);
  check('density: boreal forest is dense (> 150 per ha)', (perBiome.borealforest ?? 0) > 150, (perBiome.borealforest ?? 0).toFixed(0));
  let dTrees = 0, dArea = 0;
  const cellA = (f.worldSize / T.n) ** 2, o = -f.worldSize / 2;
  for (let k = 0; k < T.n * T.n; k++) if (BIOME_KEYS[T.biome[k]] === 'desert') {
    const x = o + ((k % T.n) + 0.5) * f.worldSize / T.n, z = o + (Math.floor(k / T.n) + 0.5) * f.worldSize / T.n;
    if (f.waterDistAt(x, z) > 40) dArea += cellA;
  }
  for (let i = 0; i < w.count; i++) { const x = w.data[i * STRIDE], z = w.data[i * STRIDE + 2]; if (BIOME_KEYS[f.biomeAt(x, z)] === 'desert' && f.waterDistAt(x, z) > 40) dTrees++; }
  const dha = dTrees / (dArea / 1e4);
  check('density: dry desert (over 40 m from water) has almost no trees (< 2 per ha)', dha < 2, dha.toFixed(2));
  check('density: no trees in snow', (perBiome.snow ?? 0) === 0);
}

// 6 species rules
{
  const u = world.understory, cactus = SPECIES_INDEX.cactus;
  let cIn = 0, cOut = 0;
  for (let i = 0; i < u.count; i++) if (u.data[i * STRIDE + 5] === cactus) {
    const b = BIOME_KEYS[f.biomeAt(u.data[i * STRIDE], u.data[i * STRIDE + 2])];
    if (b === 'desert') cIn++; else cOut++;
  }
  check('species: cacti grow only in the desert', cIn > 0 && cOut === 0, cIn + ' in, ' + cOut + ' out');
  const r = world.reeds; let far = 0;
  for (let i = 0; i < r.count; i++) if (f.waterDistAt(r.data[i * STRIDE], r.data[i * STRIDE + 2]) > 10) far++;
  check('species: reeds stand within 10 m of water', r.count > 0 && far === 0, r.count + ' reeds, ' + far + ' far');
  const c = world.canopy; let wil = 0, wilFar = 0, dead = 0;
  for (let i = 0; i < c.count; i++) {
    const sp = c.data[i * STRIDE + 5];
    if (sp === SPECIES_INDEX.willow) { wil++; if (f.waterDistAt(c.data[i * STRIDE], c.data[i * STRIDE + 2]) > 30) wilFar++; }
    if (sp === SPECIES_INDEX.deadtree) dead++;
  }
  check('species: willows stand near water', wil > 0 && wilFar <= wil * 0.05, wil + ' willows, ' + wilFar + ' far');
  check('species: dead trees exist near the treeline', dead > 0, dead + '');
  const g = world.ground; let fl = 0, fe = 0;
  for (let i = 0; i < g.count; i++) { const sp = g.data[i * STRIDE + 5]; if (sp === SPECIES_INDEX.flower) fl++; if (sp === SPECIES_INDEX.fern) fe++; }
  check('species: flowers and ferns both grow', fl > 0 && fe > 0, fl + ' flowers, ' + fe + ' ferns');
  // scree: more rocks per ha at cliff bases than on flat grass
  const rk = world.rocks; let base = 0, flat = 0;
  for (let i = 0; i < rk.count; i++) {
    const x = rk.data[i * STRIDE], z = rk.data[i * STRIDE + 2];
    const md = Math.hypot(x - 550, z - 500);
    if (md > 330 && md < 420) base++; else if (md > 700 && BIOME_KEYS[f.biomeAt(x, z)] === 'grassland') flat++;
  }
  check('species: rock fields round the mountain foot', base > flat * 0.2 && base > 50, base + ' at the foot, ' + flat + ' on far grass');
}

// 6b rocks keep clear of tree trunks (boulders 3.2 m, others 1.6 m)
{
  const rk = world.rocks, c = world.canopy;
  const grid = new Map(), cell = 8;
  for (let i = 0; i < c.count; i++) { const k = Math.floor(c.data[i * STRIDE] / cell) + ',' + Math.floor(c.data[i * STRIDE + 2] / cell); (grid.get(k) || grid.set(k, []).get(k)).push(i); }
  let bad = 0;
  for (let i = 0; i < rk.count; i++) {
    const x = rk.data[i * STRIDE], z = rk.data[i * STRIDE + 2], rad = SPECIES[rk.data[i * STRIDE + 5]].key === 'boulder' ? 3.2 : 1.6;
    const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const k of grid.get((gx + dx) + ',' + (gz + dz)) || []) {
      if (Math.hypot(c.data[k * STRIDE] - x, c.data[k * STRIDE + 2] - z) < rad) bad++;
    }
  }
  check('rocks: no rock, log or stump inside a tree trunk', bad === 0 && rk.count > 0, rk.count + ' rocks, ' + bad + ' too near');
}

// 7 the stream: bands and budget
{
  const tl = tilesFor(f, 0, 0);
  const byLayer = {}; for (const t of tl) byLayer[t.layer] = (byLayer[t.layer] || 0) + 1;
  check('stream: every layer has tiles round the camera', LAYERS.every((L) => byLayer[L.key] > 0), JSON.stringify(byLayer));
  const s = createScatterStream(f);
  let rounds = 0; s.update(0, 0, 1e9); rounds++;
  const n0 = s.count();
  s.update(400, 0, 1e9);
  const ok = s.pending === 0 && s.count() > 0;
  let kept = 0; for (const t of s.tiles.values()) if (t.layer === 'ground') kept++;
  check('stream: a move of 400 m rebuilds the near tiles', ok && kept > 0, n0 + ' -> ' + s.count() + ' instances');
  const s2 = createScatterStream(f); s2.update(0, 0, 0);
  check('stream: a zero budget still makes one tile per update', s2.tiles.size === 1 && s2.pending > 0);
}

let total = 0; for (const L of LAYERS) total += world[L.key].count;
console.log('       instances in the 2 km test world: ' + LAYERS.map((L) => L.key + ' ' + world[L.key].count).join(', ') + '; total ' + total + ' in ' + tScatter.toFixed(0) + ' ms');

// 8 the real LIB terrain, when it is there
try {
  const lib = await import('../../../lib/dla-terrain.js');
  const opts = { ...lib.defaults(), n: 256, seed: 3 };
  const t = await lib.generateTerrain(opts, () => {});
  const fl = makeField(t, { biomes: lib.BIOMES });
  const tiles = tilesFor(fl, 0, 0).filter((x) => x.layer === 'canopy');
  let c = 0, wet = 0;
  for (const w of tiles) { const r = scatterTile(fl, 'canopy', w.tx, w.tz); c += r.count; for (let i = 0; i < r.count; i++) if (fl.isWaterAt(r.data[i * STRIDE], r.data[i * STRIDE + 2])) wet++; }
  check('lib: scatter on a generated terrain, no tree in water', c > 0 && wet === 0, c + ' trees');
} catch (e) {
  console.log('  skip lib terrain test: ' + String(e.message || e).split('\n')[0]);
}

console.log('veg: ' + passes + ' passed, ' + fails + ' failed');
if (fails) process.exitCode = 1;
