// DLA terrain · WATER bodies tests (world/hydro-lakes.js, node, no GPU).
// Run: node stella-nova/pages/dla-terrain/tests/hydro.test.mjs
// CORE's tests.mjs runs it with every other file in tests/.
//   1 priority flood on synthetic basins: every level is the spill height,
//     no basin cell at or over its level, the basin is closed at its level,
//     the outlet is down the drainage tree from the spill
//   2 fillBasin from a seed agrees with the full flood (nested pits too)
//   3 the add-water tool floods exactly the basin under the point, scoops
//     a bowl where there is none, and undo puts back every cell
//   4 the coastal shelf keeps the coast line and the land
//   5 the LIB wrapper: options, presets, dice
//   6 a real LIB terrain: lake counts per option, great lakes are large,
//     rivers end in lakes and leave them at the spill, closed lakes have no
//     outflow, every lake is closed at its level
import assert from 'node:assert/strict';
import * as L from '../../../lib/dla-terrain.js';
import {
  priorityFlood, findBasins, fillBasin, applyWaterBodies, addWaterAt, undoWaterEdit,
  withWaterBodies, WATER_OPTIONS, WATER_GROUP, libOptions, waterBalance, splitRivers,
} from '../world/hydro-lakes.js';

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('ok - ' + name); }
  catch (e) { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.stack || e)); }
}
const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// a terrain from f(x, z) over n x n cells of 1 m (cell centres at i + 0.5)
function grid(n, f) {
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = f(i, j);
  return h;
}
function terrain(n, h, extra = {}) {
  const N = n * n;
  return {
    n, worldSize: n * 10, seaLevel: -100, height: h, water: new Float32Array(N), biome: new Uint8Array(N).fill(4),
    river: new Float32Array(N), moisture: new Float32Array(N).fill(0.7), temperature: new Float32Array(N).fill(12),
    flow: new Float32Array(N).fill(0.01), rivers: [], lakes: [], stats: { hasSea: false }, opts: { seed: 1 }, ...extra,
  };
}
// a slope down to the x edge with two closed bowls (A west, B east) and a
// small pit inside A that is deeper than A's floor
function twoBasins(n = 64) {
  return grid(n, (i, j) => {
    let h = 50 + (n - i) * 0.5;                                // falls toward +x
    const da = Math.hypot(i - 18, j - 32), db = Math.hypot(i - 44, j - 30);
    if (da < 10) h -= 12 * (1 - (da / 10) ** 2);              // A: 12 m bowl
    if (db < 7) h -= 8 * (1 - (db / 7) ** 2);                 // B: 8 m bowl
    if (Math.hypot(i - 22, j - 34) < 2.2) h -= 5;             // nested pit in A
    return h;
  });
}
function closedAtLevel(H, n, cells, level, isLake) {
  // every neighbour of a basin cell is in the basin or at or over the level
  for (const c of cells) {
    const x = c % n, y = (c / n) | 0;
    for (const [dx, dy] of D8) {
      const a = x + dx, b = y + dy;
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      const j = b * n + a;
      if (!isLake(j) && H[j] < level) return `cell ${j} at ${H[j]} under ${level} next to ${c}`;
    }
  }
  return null;
}

// ------------------------------------------------------------ 1 flood ----
await test('priority flood: levels equal the spill heights, basins are closed', () => {
  const n = 64, H = twoBasins(n);
  const pf = priorityFlood(H, n, {});
  const { label, basins } = findBasins(H, n, pf);
  assert.ok(basins.length >= 2, 'basins ' + basins.length);
  const big = basins.filter((b) => b.cells.length > 20);
  assert.equal(big.length, 2, 'two large basins, got ' + big.map((b) => b.cells.length));
  for (const b of basins) {
    assert.ok(b.spill >= 0, 'spill found');
    assert.equal(H[b.spill], b.level, 'level is the spill height');
    for (const c of b.cells) assert.ok(H[c] < b.level, 'no basin cell at or over the level');
    assert.equal(closedAtLevel(H, n, b.cells, b.level, (j) => label[j] === b.id), null);
    // the outlet: down the tree from the spill, nothing on the way over the level
    assert.ok(b.outlet >= 0 && H[b.outlet] < b.level, 'outlet under the level');
    let c = b.spill, k = 0;
    while (c !== b.outlet && k++ < 4 * n) { assert.ok(H[c] <= b.level); c = pf.from[c]; }
    assert.equal(c, b.outlet);
    // and no water above the spill: the filled surface is flat at the level
    for (const q of b.cells) assert.equal(pf.filled[q], b.level);
  }
  // the nested pit belongs to A
  const A = label[32 * n + 18], P = label[34 * n + 22];
  assert.ok(A >= 0 && A === P, 'nested pit is part of basin A');
});

await test('fillBasin from a seed matches the full flood, nested pit included', () => {
  const n = 64, H = twoBasins(n);
  const pf = priorityFlood(H, n, {});
  const { label, basins } = findBasins(H, n, pf);
  for (const seed of [32 * n + 18, 34 * n + 22, 30 * n + 44]) {
    const b = basins[label[seed]];
    const f = fillBasin(H, n, seed, {});
    assert.equal(f.level, b.level, 'same level');
    assert.equal(H[f.spill], f.level, 'spill at the level');
    assert.deepEqual([...f.cells].sort((p, q) => p - q), [...b.cells].sort((p, q) => p - q), 'same cells');
  }
  // a seed on the open slope has no basin
  const s = fillBasin(H, n, 10 * n + 50, {});
  assert.equal(s.cells.length, 0);
});

await test('water balance: wet basins spill, dry basins sink and turn salt', () => {
  const wet = waterBalance({ moisture: 0.8, temperature: 8, wetness: 0.5, catchM2: 5e6, lakeM2: 1e6 });
  assert.ok(wet.open && !wet.salt);
  const dry = waterBalance({ moisture: 0.1, temperature: 24, wetness: 0.1, catchM2: 5e6, lakeM2: 1e6 });
  assert.ok(!dry.open && dry.salt && dry.eqArea < 1e6 * 0.5, JSON.stringify(dry));
});

// -------------------------------------------------------- 3 add water ----
await test('add water floods exactly the basin under the point; undo restores', () => {
  const n = 64, H = twoBasins(n), t = terrain(n, H);
  const before = { h: Float32Array.from(H), w: Float32Array.from(t.water), b: Uint8Array.from(t.biome), m: Float32Array.from(t.moisture) };
  const pf = priorityFlood(H, n, {});
  const { label, basins } = findBasins(H, n, pf);
  const A = basins[label[32 * n + 18]], B = basins[label[30 * n + 44]];
  // click in A (world metres: cell centre (i + 0.5) * 10 - worldSize / 2)
  const wx = (i) => (i + 0.5) * 10 - t.worldSize / 2;
  const r = addWaterAt(t, wx(18), wx(32));
  assert.ok(r.ok, r.reason);
  assert.equal(r.lake.level, A.level, 'level = spill of A');
  assert.equal(H[r.lake.spillCell], r.lake.level, 'the spill cell holds the level');
  const got = [];
  for (let i = 0; i < n * n; i++) if (t.lakeId[i] === r.id) got.push(i);
  assert.deepEqual(got.sort((p, q) => p - q), [...A.cells].sort((p, q) => p - q), 'exactly basin A');
  for (const c of B.cells) assert.equal(t.lakeId[c], -1, 'B stays dry');
  for (const c of got) assert.ok(t.water[c] > 0 && t.water[c] === r.lake.level - H[c]);
  // a second click in the lake is a no-op
  assert.equal(addWaterAt(t, wx(18), wx(32)).reason, 'lake');
  undoWaterEdit(t, r.edit);
  assert.deepEqual(H, before.h, 'heights back');
  assert.deepEqual(t.water, before.w, 'water back');
  assert.deepEqual(t.biome, before.b, 'biomes back');
  assert.deepEqual(t.moisture, before.m, 'moisture back');
  assert.equal(t.lakeId.indexOf(r.id), -1, 'no lake id left');
  assert.equal(t.lakes.length, 0);
});

await test('add water on a slope scoops a bowl and fills it to its spill; undo restores', () => {
  const n = 64, H = grid(n, (i, j) => 30 + i * 0.3 + Math.sin(j * 0.3)), t = terrain(n, H);
  const h0 = Float32Array.from(H);
  const r = addWaterAt(t, 0, 0, { radius: 60 });
  assert.ok(r.ok && r.scooped, r.reason);
  assert.ok(r.cells >= 4, 'cells ' + r.cells);
  assert.equal(H[r.lake.spillCell], r.lake.level);
  let lakeCells = [];
  for (let i = 0; i < n * n; i++) if (t.lakeId[i] === r.id) lakeCells.push(i);
  assert.equal(closedAtLevel(H, n, lakeCells, r.lake.level, (j) => t.lakeId[j] === r.id), null);
  undoWaterEdit(t, r.edit);
  assert.deepEqual(H, h0);
  lakeCells = 0;
  for (let i = 0; i < n * n; i++) if (t.lakeId[i] >= 0) lakeCells++;
  assert.equal(lakeCells, 0);
});

await test('add water refuses the sea and the edge', () => {
  const n = 32, H = grid(n, (i) => i - 8), t = terrain(n, H, { seaLevel: 0, stats: { hasSea: true } });
  assert.equal(addWaterAt(t, (2 + 0.5) * 10 - 160, 0).reason, 'sea');
  assert.equal(addWaterAt(t, 155, 0).reason, 'edge');
});

// ------------------------------------------------------------ 4 coast ----
await test('the shelf keeps the coast line and leaves the land alone', () => {
  const n = 96, H = grid(n, (i, j) => 40 - i * 1.2 + 6 * Math.sin(j * 0.2)), t = terrain(n, H, { seaLevel: 0, stats: { hasSea: true }, worldSize: n * 40 });
  const h0 = Float32Array.from(H);
  applyWaterBodies(t, { lakeMode: 'none', greatLakes: 0, ponds: 0, shelf: 0.8 });
  let shallower = 0;
  for (let i = 0; i < n * n; i++) {
    if (h0[i] >= 0) assert.equal(H[i], h0[i], 'land unchanged');
    else {
      assert.ok(H[i] < 0, 'sea stays sea');
      if (H[i] !== h0[i]) { assert.ok(H[i] <= -0.25 && H[i] > h0[i], 'a shelf cell rises and stays 0.25 m under'); shallower++; }
    }
  }
  assert.ok(shallower > 100, 'a shelf formed ' + shallower);
});

// ---------------------------------------------------------- 5 wrapper ----
await test('LIB wrapper: water options replace lakes, presets and dice carry them', () => {
  const lib = withWaterBodies(L);
  assert.ok(!lib.OPTIONS.some((d) => d.key === 'lakes'));
  for (const d of WATER_OPTIONS) assert.ok(lib.OPTIONS.includes(d));
  const def = lib.defaults();
  assert.equal(def.lakeMode, 'few');
  for (const [id, p] of Object.entries(lib.PRESETS)) assert.ok(['none', 'few', 'many'].includes(p.opts.lakeMode), id);
  assert.equal(lib.PRESETS.canyonlands.opts.lakeMode, 'none');
  assert.ok(lib.PRESETS['great-lakes'].opts.greatLakes >= 2);
  const a = lib.randomOptions(9, def, WATER_GROUP), b = lib.randomOptions(9, def, WATER_GROUP);
  assert.deepEqual(a, b, 'same seed, same dice');
  for (const k of Object.keys(def)) if (!WATER_OPTIONS.some((d) => d.key === k)) assert.equal(a[k], def[k], 'only water keys change: ' + k);
  const all = lib.randomOptions(9, def);
  for (const d of WATER_OPTIONS) assert.ok(all[d.key] !== undefined, d.key);
  assert.equal(libOptions({ lakeMode: 'none' }).lakes, false);
  assert.equal(libOptions({ lakeMode: 'many' }).lakeMode, undefined);
  assert.equal(withWaterBodies(lib), lib, 'wrap once');
});

// ------------------------------------------------------- 6 real terrain --
const lib = withWaterBodies(L);
async function make(id, extra = {}, n = 256, seed = 3) {
  const o = { ...lib.defaults(), ...lib.PRESETS[id].opts, n, seed, ...extra };
  const t = await L.generateTerrain(libOptions(o));
  const info = applyWaterBodies(t, o);
  return { t, info, o };
}
function checkLakes(t) {
  const n = t.n, H = t.height;
  t.lakes.forEach((lk, k) => {
    const cells = [];
    for (let i = 0; i < n * n; i++) if (t.lakeId[i] === k) cells.push(i);
    assert.equal(cells.length, lk.cells, 'cell count of lake ' + k);
    for (const c of cells) assert.ok(H[c] < lk.level && Math.abs(t.water[c] - (lk.level - H[c])) < 1e-3, 'bed under the level');
    assert.equal(closedAtLevel(H, n, cells, lk.level, (j) => t.lakeId[j] === k), null, 'lake ' + k + ' ' + lk.kind + ' closed');
    assert.ok(lk.level <= lk.spillLevel + 1e-6, 'no water over the spill');
    if (lk.open) assert.equal(H[lk.spillCell], lk.level, 'an open lake stands at its spill');
  });
}
const counts = {};
await test('lake counts per option: none < few <= many; ponds follow the slider', async () => {
  for (const mode of ['none', 'few', 'many']) {
    const { t } = await make('highlands', { lakeMode: mode, greatLakes: 0 });
    counts[mode] = t.lakes.length;
    checkLakes(t);
  }
  assert.equal(counts.none, 0);
  assert.ok(counts.few > 0 && counts.many >= counts.few, JSON.stringify(counts));
  const p0 = (await make('highlands', { lakeMode: 'many', greatLakes: 0, ponds: 0 })).t.lakes.filter((l) => l.kind === 'pond').length;
  const p1 = (await make('highlands', { lakeMode: 'many', greatLakes: 0, ponds: 1 })).t.lakes.filter((l) => l.kind === 'pond').length;
  assert.ok(p1 > p0, `ponds 0 -> ${p0}, 1 -> ${p1}`);
  console.log('# lakes highlands n256 seed3:', JSON.stringify(counts), 'ponds 0/1:', p0, p1);
});

await test('great lakes: large basins with islands, open lakes have an outflow at the spill', async () => {
  const { t, info } = await make('great-lakes');
  checkLakes(t);
  const great = t.lakes.filter((l) => l.kind === 'great');
  const world = t.worldSize * t.worldSize;
  assert.ok(great.length >= 2, 'great lakes ' + great.length);
  const biggest = Math.max(...great.map((l) => l.area));
  assert.ok(biggest > world * 0.01, `largest great lake ${(biggest / 1e6).toFixed(1)} km2 of ${(world / 1e6).toFixed(0)}`);
  const small = t.lakes.filter((l) => l.kind !== 'great');
  assert.ok(biggest > 4 * Math.max(...small.map((l) => l.area), 1), 'great lakes are much larger than the others');
  // islands: dry cells that the water of a great lake closes in
  const n = t.n, cs = t.worldSize / n;
  let islands = 0;
  for (const g of great) {
    const k = t.lakes.indexOf(g);
    const x0 = Math.floor((g.bbox[0] + t.worldSize / 2) / cs), z0 = Math.floor((g.bbox[1] + t.worldSize / 2) / cs);
    const x1 = Math.ceil((g.bbox[2] + t.worldSize / 2) / cs) - 1, z1 = Math.ceil((g.bbox[3] + t.worldSize / 2) / cs) - 1;
    const seen = new Set();
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const c = z * n + x;
      if (t.lakeId[c] === k || seen.has(c)) continue;
      let open = false;
      const st = [c]; seen.add(c);
      while (st.length) {
        const q = st.pop(), qx = q % n, qz = (q / n) | 0;
        if (qx <= x0 || qz <= z0 || qx >= x1 || qz >= z1) open = true;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = qx + dx, b = qz + dz;
          if (a < x0 || b < z0 || a > x1 || b > z1) continue;
          const j = b * n + a;
          if (t.lakeId[j] !== k && !seen.has(j)) { seen.add(j); st.push(j); }
        }
      }
      if (!open) islands++;
    }
  }
  assert.ok(islands >= 1, 'islands ' + islands);
  // rivers: every 'lake' end is in its lake, every outflow starts at the spill
  for (const r of t.rivers) {
    if (r.end === 'lake' && r.lake != null) assert.equal(t.lakeId[r.cells[r.cells.length - 1]], r.lake, 'river ends in its lake');
    if (r.fromLake != null) {
      const s = t.lakes[r.fromLake].spillCell, c = r.cells[0];
      assert.ok(Math.max(Math.abs((s % n) - (c % n)), Math.abs(((s / n) | 0) - ((c / n) | 0))) <= 1, 'outflow at the spill');
      assert.ok(t.lakes[r.fromLake].open, 'only open lakes flow out');
    }
  }
  const ends = t.rivers.filter((r) => r.end === 'lake').length, outs = t.rivers.filter((r) => r.fromLake != null).length;
  assert.ok(ends > 0 && outs > 0, `rivers in ${ends}, out ${outs}`);
  for (const g of great.filter((l) => l.open)) assert.ok(t.rivers.some((r) => r.fromLake === t.lakes.indexOf(g)), 'each open great lake has an outflow');
  console.log('# great-lakes n256:', JSON.stringify(info.counts), 'great km2', great.map((l) => (l.area / 1e6).toFixed(1)).join(' '), 'islands', islands, 'rivers in/out', ends, outs, 'ms', info.ms);
});

await test('dry climate: closed salt lakes sit under their spill and have no outflow', async () => {
  const { t, info } = await make('rift-valley', { lakeWetness: 0.05, greatLakes: 2 });
  checkLakes(t);
  const closed = t.lakes.filter((l) => !l.open);
  assert.ok(closed.length > 0 || info.playas > 0, 'a closed lake or a salt pan');
  for (const l of closed) {
    assert.ok(l.level < l.spillLevel, 'under the spill');
    assert.ok(!t.rivers.some((r) => r.fromLake === t.lakes.indexOf(l)), 'no outflow');
  }
  console.log('# rift-valley dry:', JSON.stringify(info.counts), 'closed', closed.length, 'salt', info.salt, 'playas', info.playas);
});

await test('add water on a real terrain, then undo, gives the same arrays', async () => {
  const { t } = await make('alpine', {}, 256, 5);
  const keep = ['height', 'water', 'biome', 'river', 'moisture', 'lakeId'].map((k) => [k, t[k].slice()]);
  const lakes0 = t.lakes, rivers0 = t.rivers;
  // a valley floor: the land cell of lowest height at the map centre band
  const n = t.n, cs = t.worldSize / n;
  let best = -1;
  for (let j = n / 4; j < 3 * n / 4; j++) for (let i = n / 4; i < 3 * n / 4; i++) {
    const c = j * n + i;
    if (t.lakeId[c] < 0 && t.height[c] > t.seaLevel + 5 && (best < 0 || t.height[c] < t.height[best])) best = c;
  }
  const r = addWaterAt(t, (best % n + 0.5) * cs - t.worldSize / 2, (((best / n) | 0) + 0.5) * cs - t.worldSize / 2, { radius: 300 });
  assert.ok(r.ok, r.reason);
  checkLakes({ ...t, lakes: t.lakes.map((l) => (l.merged != null ? { ...l, cells: 0 } : l)) });
  undoWaterEdit(t, r.edit);
  for (const [k, a] of keep) assert.deepEqual(t[k], a, k + ' back');
  assert.equal(t.lakes, lakes0);
  assert.equal(t.rivers, rivers0);
});

await test('splitRivers: a river through a lake ends in it and goes on from the spill', () => {
  // a valley down +x with a lake in the middle; the river crosses it
  // a valley down +x, a dam across it at x 30..31 with a notch at the centre
  const n = 48, H = grid(n, (i, j) => {
    const h = 40 - i * 0.3 + Math.abs(j - 24) * 2;
    if (i === 30 || i === 31) return j === 24 ? 38 : Math.max(h, 44);
    return h;
  });
  const t = terrain(n, H);
  const cells = [], pts = [];
  for (let i = 2; i < n - 1; i++) { cells.push(24 * n + i); pts.push((i + 0.5) * 10 - t.worldSize / 2, (24 + 0.5) * 10 - t.worldSize / 2); }
  t.rivers = [{ pts: new Float32Array(pts), width: new Float32Array(cells.length).fill(6), flow: new Float32Array(cells.length).fill(1), end: 'edge', cells: Int32Array.from(cells) }];
  const r = addWaterAt(t, (15 + 0.5) * 10 - t.worldSize / 2, (24 + 0.5) * 10 - t.worldSize / 2);
  assert.ok(r.ok && !r.scooped, r.reason);
  assert.equal(r.lake.level, 38, 'the notch holds the level');
  const into = t.rivers.find((q) => q.end === 'lake'), out = t.rivers.find((q) => q.fromLake === r.id);
  assert.ok(into, 'inflow ends in the lake');
  assert.equal(t.lakeId[into.cells[into.cells.length - 1]], r.id);
  assert.ok(out, 'outflow from the spill');
  const s = r.lake.spillCell, c = out.cells[0];
  assert.ok(Math.max(Math.abs((s % n) - (c % n)), Math.abs(((s / n) | 0) - ((c / n) | 0))) <= 1);
  void splitRivers;
});

await test('the Add water mode: a tap floods, a drag does not, undo restores', async () => {
  const { createWaterTool } = await import('../world/water-tool.js');
  const hydro = await import('../world/hydro-lakes.js');
  const handlers = {};
  const canvas = { style: {}, addEventListener: (k, f) => { handlers[k] = f; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 400 }) };
  const keys = [];
  globalThis.addEventListener = globalThis.addEventListener || ((k, f) => keys.push([k, f]));
  const n = 64, H = twoBasins(n), t = terrain(n, H), h0 = Float32Array.from(H);
  const app = { terrain: t };
  let applied = 0;
  const wx = (i) => (i + 0.5) * 10 - t.worldSize / 2;
  const tool = createWaterTool({ canvas, app, hydro: () => hydro, pick: () => [wx(18), 0, wx(32)], apply: () => { applied++; }, toast: () => {} });
  const ev = (x, y, extra = {}) => ({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, ...extra });
  handlers.pointerdown(ev(100, 100)); handlers.pointerup(ev(101, 100));
  assert.equal(applied, 0, 'the mode is off: no flood');
  tool.setActive(true);
  handlers.pointerdown(ev(100, 100)); handlers.pointerup(ev(160, 100));
  assert.equal(applied, 0, 'a drag moves the camera, it does not flood');
  handlers.pointerdown(ev(100, 100)); handlers.pointerup(ev(103, 101));
  assert.equal(applied, 1, 'a tap floods');
  assert.ok(t.lakes.length === 1 && tool.canUndo());
  assert.ok(tool.undo());
  assert.equal(applied, 2);
  assert.deepEqual(H, h0);
  assert.equal(t.lakes.length, 0);
  assert.ok(!tool.canUndo());
  // a new terrain clears the undo list
  tool.floodAt(wx(18), wx(32));
  app.terrain = terrain(n, twoBasins(n));
  assert.ok(!tool.canUndo(), 'undo belongs to one terrain');
});

console.log(`\n# hydro: ${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
