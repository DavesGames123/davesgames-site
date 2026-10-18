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
//    The GPU cull through its CPU twin (vegetation.js classifyCPU): no
//    visible plant culled from many cameras (1 m from a trunk, inside a
//    crown, looking up, high up), LOD0 near, no pop in 1 m steps, shadow
//    casters out of view; the 3D stream bands; the page pool order.
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

// 7b the user mix (frame.veg -> f.mix): density scales, conifer and
// flower shares; the far canopy fades over its own wide band
{
  const fm = makeField(synthTerrain());
  const countSp = (mix, layer, keys) => {
    fm.mix = mix; let c = 0, all = 0;
    for (const w of tilesFor(fm, 0, 0).filter((x) => x.layer === layer)) {
      const r = scatterTile(fm, layer, w.tx, w.tz); all += r.count;
      for (let i = 0; i < r.count; i++) if (keys.includes(SPECIES[r.data[i * STRIDE + 5]].key)) c++;
    }
    return { c, all };
  };
  const m0 = { density: 1, conifer: 0.5, flowers: 0.5 };
  const lo = countSp({ ...m0, density: 0.3 }, 'canopy', []).all, mid = countSp(m0, 'canopy', []).all, hi = countSp({ ...m0, density: 2.5 }, 'canopy', []).all;
  check('mix: tree count rises with density', lo < mid && mid < hi, lo + ' < ' + mid + ' < ' + hi);
  const noCon = countSp({ ...m0, conifer: 0 }, 'canopy', ['spruce', 'pine']).c;
  const allCon = countSp({ ...m0, conifer: 1 }, 'canopy', ['oak', 'beech', 'birch', 'willow', 'jungle']).c;
  check('mix: conifer 0 has no spruce or pine, conifer 1 no broadleaf', noCon === 0 && allCon === 0, noCon + ', ' + allCon);
  const fl0 = countSp({ ...m0, flowers: 0 }, 'ground', ['flower']).c, fl1 = countSp({ ...m0, flowers: 1 }, 'ground', ['flower']).c;
  check('mix: flowers 0 has none, flowers 1 has some', fl0 === 0 && fl1 > 0, fl0 + ', ' + fl1);
  fm.mix = null;
  const far = LAYERS[LAYER_INDEX.canopyFar];
  check('far canopy: a far fade band wider than the near band', far.farBand > far.band * 4, far.band + ' / ' + far.farBand);
}

// 9 the GPU cull, through its CPU twin (render/vegetation.js classifyCPU,
// the same maths as props.wgsl classify). The truth is the LOD0 mesh of
// each plant, placed as props.wgsl placeVertex does (scale, lean, yaw,
// sink): a plant with a vertex in the view frustum and a layer fade over
// 0 must be drawn. Cameras: eye height, 1 m from a trunk, inside a crown,
// looking up, a 1.5 km high view, and a low fast flight in 1 m steps.
{
  const V = await import('../render/vegetation.js');
  const { perspectiveRZ, lookAt, mul } = await import('../gpu/mat.js');
  const fm = makeField(synthTerrain());
  const protos = {};
  const protoOf = (si) => (protos[si] ||= V.standInProto(SPECIES[si].key, 1000 + si * 37));
  // the plants round a forest point: a boreal plain (x -700, z 800)
  const cx0 = -700, cz0 = 760;
  const inst = [];
  for (const L of LAYERS) {
    if (L.key === 'canopyFar') continue;
    for (const w of tilesFor(fm, cx0, cz0).filter((t) => t.layer === L.key && t.d < 160)) {
      const r = scatterTile(fm, L.key, w.tx, w.tz);
      for (let i = 0; i < r.count; i++) {
        const o = i * STRIDE;
        inst.push({ it: new Float32Array([r.data[o], fm.heightAt(r.data[o], r.data[o + 2]), r.data[o + 2], r.data[o + 3], r.data[o + 4], r.data[o + 5] + 256 * LAYER_INDEX[L.key], r.data[o + 6], r.data[o + 7]]), si: r.data[o + 5] });
      }
    }
  }
  const trees = inst.filter((x) => SPECIES[x.si].kind === 'tree' && SPECIES[x.si].layer === 'canopy');
  const W = 1280, H = 720, fov = 50 * Math.PI / 180, nearP = 0.5;
  const camAt = (eye, fwd) => {
    const proj = perspectiveRZ(fov, W / H, nearP);
    const t = [eye[0] + fwd[0], eye[1] + fwd[1], eye[2] + fwd[2]];
    const up = Math.abs(fwd[1]) > 0.999 ? [0, 0, -1] : [0, 1, 0];
    const vp = mul(proj, lookAt(eye, t, up));
    const P = V.writeCullParams(new Float32Array(64), { cam: eye, proj, H, q: 0.75, farK: 0.875, shadowFar: 975, shadowsOn: true, sun: [0.3, 0.5, 0.81], lists: 999, species: 40 });
    return { eye, vp, proj, P, G: { viewProj: vp, proj, wind: [0, 0] } };
  };
  const dirOf = (yaw, pitch) => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  // any LOD0 vertex in the frustum (every 2nd vertex)
  function truthVisible(x, cam) {
    const pr = protoOf(x.si), it = x.it, s = it[3], h = pr.spec[0] * s;
    const lean = pr.spec[7] * (it[7] - 0.5) * 2, cl = Math.cos(lean), sl = Math.sin(lean), cy = Math.cos(it[4]), sy = Math.sin(it[4]);
    const ry = it[1] - pr.spec[6] * h, m = cam.vp;
    for (let k = 0; k < pr.pos.length; k += 6) {
      let px = pr.pos[k] * s, py = pr.pos[k + 1] * s;
      const pz = pr.pos[k + 2] * s;
      const lx = px * cl - py * sl; py = px * sl + py * cl; px = lx;
      const wx = it[0] + cy * px + sy * pz, wy = ry + py, wz = it[2] - sy * px + cy * pz;
      const q = (j) => m[j] * wx + m[4 + j] * wy + m[8 + j] * wz + m[12 + j];
      const w = q(3);
      if (w >= nearP && Math.abs(q(0)) <= w && Math.abs(q(1)) <= w) return true;
    }
    return false;
  }
  // the old cull (before this fix): sphere max(0.55 h, radius) at the
  // base + h/2, margin r * proj + 2 % of w, and no near plane
  function oldCulls(x, cam) {
    const pr = protoOf(x.si), it = x.it, h = pr.spec[0] * it[3], r = Math.max(h * 0.55, pr.spec[1] * it[3]);
    const m = cam.vp, c = [it[0], it[1] + h * 0.5, it[2]];
    const q = (j) => m[j] * c[0] + m[4 + j] * c[1] + m[8 + j] * c[2] + m[12 + j];
    const qx = q(0), qy = q(1), qw = q(3);
    if (qw < -r) return true;
    const mx = r * cam.proj[0] + 0.02 * Math.max(qw, 0), my = r * cam.proj[5] + 0.02 * Math.max(qw, 0);
    return qx < -qw - mx || qx > qw + mx || qy < -qw - my || qy > qw + my;
  }
  const keepOf = (c) => c.lists.reduce((a, l) => a + V.fadeKeep(l[1], l[2]), 0);
  const cams = [];
  const tr = trees.slice().sort((a, b) => Math.hypot(a.it[0] - cx0, a.it[2] - cz0) - Math.hypot(b.it[0] - cx0, b.it[2] - cz0)).slice(0, 6);
  for (const t of tr) {
    const [x, y, z] = t.it, h = protoOf(t.si).spec[0] * t.it[3];
    for (let a = 0; a < 8; a++) {
      const yaw = a * Math.PI / 4;
      // 1 m from the trunk at eye height (2.2 m, camera.js CLEAR), trunk at the screen edge too
      cams.push(camAt([x - Math.sin(yaw) * 1.0, y + 2.2, z + Math.cos(yaw) * 1.0], dirOf(yaw + 0.5, 0)));
      cams.push(camAt([x - Math.sin(yaw) * 1.6, y + 2.2, z + Math.cos(yaw) * 1.6], dirOf(yaw, 0.1)));
      // inside the crown, and under it looking up
      cams.push(camAt([x + 0.8, y + h * 0.7, z + 0.6], dirOf(yaw, (a - 4) * 0.3)));
      cams.push(camAt([x - Math.sin(yaw) * 2.5, y + 2.2, z + Math.cos(yaw) * 2.5], dirOf(yaw, 1.25)));
    }
  }
  for (let a = 0; a < 12; a++) cams.push(camAt([cx0 + Math.cos(a) * 30, fm.heightAt(cx0, cz0) + 2.2 + a * 3, cz0 + Math.sin(a) * 30], dirOf(a * 0.53, -0.1 - a * 0.05)));
  const nCull = cams.length;
  let checked = 0, missed = 0, oldMissed = 0, nearBad = 0, nearN = 0, missInfo = '';
  for (const cam of cams) for (const x of inst) {
    const pr = protoOf(x.si);
    const c = V.classifyCPU(x.it, pr.spec, cam.P, cam.G);
    if (!(c.lf > 0.002)) continue;
    if (!truthVisible(x, cam)) continue;
    checked++;
    if (c.n === 0 || keepOf(c) <= 0) { missed++; if (!missInfo) missInfo = SPECIES[x.si].key + ' d ' + c.d.toFixed(1); }
    if (oldCulls(x, cam)) oldMissed++;
    if (c.d < 12) { nearN++; if (!(c.n === 1 && c.lists[0][0] % 4 === 0 && c.lists[0][1] === 1)) nearBad++; }
  }
  check('cull twin: every plant with a LOD0 vertex in view and a layer fade is drawn (' + nCull + ' cameras)', checked > 1000 && missed === 0, checked + ' visible, ' + missed + ' culled ' + missInfo);
  check('cull twin: the old cull dropped visible plants (the fault this fixes)', oldMissed > 0, oldMissed + ' of ' + checked + ' with the old sphere and margin');
  check('cull twin: plants nearer than 12 m draw the full LOD0 mesh, no cross-fade', nearN > 100 && nearBad === 0, nearN + ' near, ' + nearBad + ' not LOD0');
  // a fast low flight in 1 m steps: no plant in view jumps in coverage
  let pops = 0, steps = 0, popInfo = '';
  const yawF = 0.7, f0 = dirOf(yawF, -0.08);
  let prev = null;
  for (let k = 0; k <= 240; k++) {
    const ex = cx0 - 120 * Math.sin(yawF) + k * Math.sin(yawF), ez = cz0 + 120 * Math.cos(yawF) - k * Math.cos(yawF);
    const cam = camAt([ex, fm.heightAt(ex, ez) + 4, ez], f0);
    const cur = inst.map((x) => { const c = V.classifyCPU(x.it, protoOf(x.si).spec, cam.P, cam.G); return { keep: c.n ? keepOf(c) : 0, view: c.inView }; });
    if (prev) for (let i = 0; i < inst.length; i++) {
      if (!(cur[i].view && prev[i].view)) continue;
      steps++;
      if (Math.abs(cur[i].keep - prev[i].keep) > 0.34) { pops++; if (!popInfo) popInfo = SPECIES[inst[i].si].key + ' ' + prev[i].keep.toFixed(2) + ' -> ' + cur[i].keep.toFixed(2); }
    }
    prev = cur;
  }
  check('cull twin: no pop on a 240 m flight in 1 m steps (coverage change under 0.34)', steps > 1000 && pops === 0, steps + ' plant steps, ' + pops + ' pops ' + popInfo);
  // shadows: a tree outside the view whose shadow falls into it casts
  {
    const t = tr[0], [x, y, z] = t.it;
    const sun = [0.25, 0.2, 0.95];
    const sl = Math.hypot(...sun), sd = sun.map((v) => v / sl);
    // the camera looks at the ground 25 m from the tree on the side away from the sun
    const g = [x - sd[0] / Math.hypot(sd[0], sd[2]) * 40, y, z - sd[2] / Math.hypot(sd[0], sd[2]) * 40];
    const eye = [g[0] + 6, y + 12, g[2] + 6];
    const dir = [g[0] - eye[0], g[1] - eye[1], g[2] - eye[2]], dl = Math.hypot(...dir);
    const cam = camAt(eye, dir.map((v) => v / dl));
    V.writeCullParams(cam.P, { cam: eye, proj: cam.proj, H, q: 0.75, farK: 0.875, shadowFar: 975, shadowsOn: true, sun: sd, lists: 999, species: 40 });
    const c = V.classifyCPU(t.it, protoOf(t.si).spec, cam.P, cam.G);
    check('shadow: a tree out of view with its low sun shadow in view stays a caster', c.shadow >= 0, 'in view ' + c.inView + ', shadow list ' + c.shadow);
  }
}

// 10 the stream in 3D: from a camera 1.5 km over the ground, every point
// where the GPU band shows a layer has its tile in the stream set
{
  const fm = makeField(synthTerrain());
  const farK = 0.875, cx = -300, cz = 200, cy = fm.heightAt(cx, cz) + 1500;
  const covered = (set) => {
    let need = 0, miss = 0;
    for (let k = 0; k < 4000; k++) {
      const a = k * 2.39996, rr = 1400 * Math.sqrt((k + 0.5) / 4000);
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      if (!fm.inside(x, z)) continue;
      for (const L of LAYERS) {
        const d = Math.hypot(x - cx, fm.heightAt(x, z) + 8 - cy, z - cz);
        const near = L.near * farK, far = L.far * farK;
        const lf = (near > 0 ? Math.min(1, Math.max(0, (d - near) / L.band)) : 1) * (d < far ? 1 : 0);
        if (lf <= 0.002) continue;
        need++;
        const tx = Math.floor((x - fm.origin) / L.tile), tz = Math.floor((z - fm.origin) / L.tile);
        if (!set.has(L.key + ':' + tx + ':' + tz)) miss++;
      }
    }
    return { need, miss };
  };
  const s3 = covered(new Set(tilesFor(fm, cx, cz, { farScale: farK, cy }).map((t) => t.key)));
  const s2 = covered(new Set(tilesFor(fm, cx, cz, { farScale: farK }).map((t) => t.key)));
  check('stream 3D: a camera 1.5 km up has a tile under every point that the GPU band shows', s3.need > 1000 && s3.miss === 0, s3.need + ' points, ' + s3.miss + ' without a tile');
  check('stream 3D: the xz stream (before this fix) left a hole under the high camera', s2.miss > 0, s2.miss + ' of ' + s2.need + ' points without a tile');
  const tl = tilesFor(fm, cx, cz, { farScale: farK, cy: fm.heightAt(cx, cz) + 3 });
  const firstFar = tl.findIndex((t) => t.layer === 'canopyFar'), lastNear = tl.map((t) => t.layer === 'canopy' && t.d < 300).lastIndexOf(true);
  check('stream order: the near canopy streams before the far canopy', firstFar > lastNear, 'last near canopy ' + lastNear + ', first far ' + firstFar);
  // a fast flight (300 m per frame, a fixed tile cost): the first tile made
  // after each jump is one under the camera
  let tick = 0;
  const st = createScatterStream(fm, { farScale: farK, now: () => (tick += 1) });
  let bad = 0;
  for (let k = 0; k < 6; k++) {
    const x = -800 + k * 300, z = -200;
    const before = new Set(st.tiles.keys());
    st.update(x, z, 4, fm.heightAt(x, z) + 3);
    const made = [...st.tiles.keys()].filter((key) => !before.has(key));
    const first = made[0] ? made[0].split(':') : null;
    const L = first ? LAYERS[LAYER_INDEX[first[0]]] : null;
    if (!first || tileDistOk(fm, L, +first[1], +first[2], x, z) > 1) bad++;
  }
  function tileDistOk(f, L, tx, tz, x, z) {
    const x0 = f.origin + tx * L.tile, z0 = f.origin + tz * L.tile;
    return Math.hypot(Math.max(x0 - x, 0, x - x0 - L.tile), Math.max(z0 - z, 0, z - z0 - L.tile));
  }
  check('stream: on a fast flight the first new tile is the one under the camera', bad === 0, bad + ' of 6 jumps');
}

// 11 the instance page pool: when it is full, the nearest tiles win
{
  const { planPages } = await import('../render/vegetation.js');
  const have = [{ key: 'far1', d: 900, pages: 3 }, { key: 'far2', d: 600, pages: 2 }, { key: 'mid', d: 200, pages: 2 }];
  const p = planPages([{ key: 'near', d: 5, need: 4 }, { key: 'next', d: 50, need: 1 }, { key: 'huge', d: 700, need: 50 }], have, 0);
  check('pages: a near tile takes the pages of the farthest tiles', p.write.includes('near') && p.evict[0] === 'far1' && p.evict.includes('far2') && !p.evict.includes('mid'), JSON.stringify(p));
  check('pages: a tile that cannot fit evicts nothing for itself', !p.write.includes('huge') && p.evict.length === 2, JSON.stringify(p));
  const q = planPages([{ key: 'a', d: 10, need: 1 }], [{ key: 'b', d: 5, pages: 9 }], 0);
  check('pages: a far tile never takes the pages of a nearer one', q.write.length === 0 && q.evict.length === 0, JSON.stringify(q));
}

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
