// gen.js — one city from a seed: our glue around the vendored MapGenerator.
//
// The road, water, park and lot logic is ProbableTrain's MapGenerator
// (LGPL-3.0, vendor/mapgenerator/mapgen.js, unchanged). This file does what
// the upstream UI classes did (src/ts/ui/main_gui.ts generateEverything,
// road_gui.ts, water_gui.ts, buildings.ts, tensor_field_gui.ts
// setRecommended): it sets the parameters, calls the generators in the
// upstream order, and copies the results out as plain arrays. It adds:
//   - a seed: Math.random is a seeded PRNG while generate() runs
//   - an event log: the order in which the generator made each thing
//   - building heights (our own rule: tall near the field centres)
//   - terrain (opts.terrain): terrain.js grows a DLA world first; its sea,
//     lakes and largest river replace upstream's random coast and river,
//     steep ground is closed to roads and lots, a slope field turns the
//     streets along the contours, parks favour steep or wet ground, and
//     buildings are lower on slopes. Off, the city is as before.
//   - the ragged edge (edge.js, opts.edge): the built area grows out from
//     the centre and a few villages over a cost field (slope, water, noise,
//     roads), so it stops in a ragged line; past it, fields and wild land
// No DOM. worker.js, main.js (fallback) and tests.mjs import it.
//
// opts.onTerrain(p) and opts.onStage(k) are optional progress hooks (the
// LIB terrain progress, and a stage key of layout.js STAGES: field, water,
// main, major, minor, blocks, lots). The city does not depend on them, and
// city.opts does not keep them. With no hook, generate() adds no await.
//
// generate(opts) -> Promise<city>
//   city = { v, seed, opts, view: {w, h}, domain: {x, y, w, h},
//            fields: [{type, x, y, size, decay, theta}],
//            sea, coastline, river, riverRoad  (polygons and lines, [[x, y]..])
//            roads: { coast, river, main, major, minor }  ([line, ..], creation order)
//            roadFamily: { main|major|minor: [1 major eigenvector, 0 minor] }
//            roadParams: { main|major|minor: { dsep, dtest, dlookahead } }
//            parks, blocks, lots  ([polygon, ..])
//            lotBlock  (Int32Array-like: the block of each lot)
//            buildings: [{ lot, h }]   (h in map units, 1 unit = 1 m in 3D)
//            farms: [{ poly, crop }]  (edge.js field strips past the city edge)
//            form: { edge, R, cell, nuclei, urbanShare }  (edge.js)
//            terrain   (only with opts.terrain: terrain.js buildTerrain(), the
//                       ground, snapshots, underlay, rings and river; the
//                       sea is then an even-odd polygon of several rings,
//                       coastlines lists every shore run)
//            events: [{ k, i?, n? }]   (see EVENT KINDS)
//            stats: { ms, ... } }
// The coordinates are map units, y down (as upstream). The view is
// [0, w] x [0, h]; the generator works on the view grown 1.2 times about
// its centre, as upstream does (Util.DRAW_INFLATE_AMOUNT), so roads run
// off the edge.
//
// EVENT KINDS (in order): terrain (terrain on only), field, coast, river,
// road {cls, i}, parks {i}, block {i}, lots {block, from, n}, building {i}
//
// grep: export const SIZES  export function defaults  export async function generate
//       function runStreamlines  function seeded  function fieldAt  function terrainWater
//       function pickParks  function familyOf

import * as MG from '../../vendor/mapgenerator/mapgen.js';
import { terrainDefaults, buildTerrain, makeSlopeField, groundAt, slopeAt, riverAt } from './terrain.js';
import { urbanForm, trimLines, nearPolys } from './edge.js';

const ANCHOR_TRIM = 12;   // m: a trimmed road keeps its runs this near a kept block

export const VERSION = 1;
export const SIZES = {
  town: { w: 960, h: 640, label: 'Town' },
  city: { w: 1440, h: 900, label: 'City' },
  metro: { w: 1920, h: 1200, label: 'Metro' },
};

export function defaults() {
  return {
    seed: 1,
    size: 'city',
    grids: 4,           // grid basis fields (upstream setRecommended: 4)
    radials: 1,         // radial basis fields (upstream: 1)
    fieldScale: 1,      // multiplies the basis field sizes
    smooth: false,      // TensorField.smooth
    coast: true,
    river: true,
    mainSep: 400,       // dsep of the main roads (upstream 400)
    majorSep: 100,      // (upstream 100)
    minorSep: 20,       // (upstream 20)
    bigParks: 2,        // (upstream numBigParks 2)
    smallParks: 0,      // (upstream numSmallParks 0)
    lotArea: 50,        // PolygonFinder minArea for lots (upstream 50)
    noDivide: 0.05,     // chanceNoDivide (upstream 0.05)
    height: 1,          // building height scale (ours)
    edge: 0.7,          // the ragged edge (edge.js): 0 fills the view, 1 the most sprawl and fields
    ...terrainDefaults(),   // terrain.js: off by default
  };
}

// mulberry32: a small seeded PRNG, the same stream on every engine.
export function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const P = (v) => [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100];
const line = (a) => (a || []).map(P);

// Runs a StreamlineGenerator to the end without a frame loop. Upstream's
// createAllStreamlines(true) makes one streamline per update() call (the
// main loop calls update); here the calls come in a tight loop. The
// promise resolves after joinDanglingStreamlines, as upstream.
async function runStreamlines(gen) {
  const done = gen.createAllStreamlines(true);
  let guard = 0;
  while (gen.update() && guard++ < 1e6) { /* one streamline per call */ }
  await done;
}

export async function generate(input = {}) {
  const o = { ...defaults(), ...input };
  const size = SIZES[o.size] || SIZES.city;
  const W = size.w, H = size.h;
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  // the progress hooks get no city data back, so they cannot change the
  // city; city.opts does not keep them (a worker posts the city)
  const onStage = typeof input.onStage === 'function' ? input.onStage : null;
  delete o.onTerrain; delete o.onStage;
  // the terrain first, outside the seeded Math.random (the LIB has its own
  // generator), so the city stream starts at the same place either way
  const T = o.terrain ? await buildTerrain(o, W, H, input.onTerrain || null) : null;
  const realRandom = Math.random;
  const rnd = seeded(o.seed);
  Math.random = rnd;
  try {
    return await build(o, W, H, t0, T, onStage);
  } finally {
    Math.random = realRandom;
  }
}

async function build(o, W, H, t0, T = null, onStage = null) {
  const stage = async (k) => { if (onStage) { try { await onStage(k); } catch { /* the hook is optional */ } } };
  if (onStage) await stage('field');
  const { Vector, TensorField, RK4Integrator, StreamlineGenerator, WaterGenerator, Graph, PolygonFinder } = MG;
  const INFLATE = 1.2;
  const origin = new Vector(-(INFLATE - 1) / 2 * W, -(INFLATE - 1) / 2 * H);
  const dims = new Vector(W * INFLATE, H * INFLATE);
  const events = [];
  if (T) events.push({ k: 'terrain' });

  // ─── tensor field (tensor_field_gui.ts setRecommended) ───────────────────
  const noise = { globalNoise: false, noiseSizePark: 20, noiseAnglePark: 90, noiseSizeGlobal: 30, noiseAngleGlobal: 20 };
  const tf = new TensorField(noise);
  tf.smooth = !!o.smooth;
  const SPAWN = 0.7;
  const rr = (max, min = 0) => Math.random() * (max - min) + min;   // Util.randomRange
  const fields = [];
  const sz = new Vector(W * SPAWN, H * SPAWN);
  const o0 = new Vector(W * (1 - SPAWN) / 2, H * (1 - SPAWN) / 2);
  const corners = [o0.clone(), o0.clone().add(sz), o0.clone().add(new Vector(sz.x, 0)), o0.clone().add(new Vector(0, sz.y))];
  const randomLocation = () => new Vector(Math.random(), Math.random()).multiply(sz).add(o0);
  for (let g = 0; g < o.grids; g++) {
    const at = g < 4 ? corners[g] : randomLocation();
    const s = rr(W / 4, W) * o.fieldScale, d = rr(50), th = rr(Math.PI / 2);
    tf.addGrid(at, s, d, th);
    fields.push({ type: 'grid', x: at.x, y: at.y, size: s, decay: d, theta: th });
  }
  for (let r = 0; r < o.radials; r++) {
    const at = randomLocation();
    const s = rr(W / 10, W / 5) * o.fieldScale, d = rr(50);
    tf.addRadial(at, s, d);
    fields.push({ type: 'radial', x: at.x, y: at.y, size: s, decay: d });
  }
  // terrain: the slope field goes last (see terrain.js makeSlopeField)
  if (T) tf.addField(makeSlopeField(T, tf.basisFields.length, tf.smooth));
  events.push({ k: 'field' });

  // ─── parameters (main_gui.ts) ─────────────────────────────────────────────
  const pathIterations = 1.5 * Math.max(W, H) / 1;    // road_gui.ts setPathIterations, dstep 1
  const minorParams = { dsep: o.minorSep, dtest: 15 * o.minorSep / 20, dstep: 1, dlookahead: 40, dcirclejoin: 5, joinangle: 0.1, pathIterations, seedTries: 300, simplifyTolerance: 0.5, collideEarly: 0 };
  const coastParams = Object.assign({
    coastNoise: { noiseEnabled: true, noiseSize: 30, noiseAngle: 20 },
    riverNoise: { noiseEnabled: true, noiseSize: 30, noiseAngle: 20 },
    riverBankSize: 10, riverSize: 30,
  }, minorParams);
  coastParams.pathIterations = pathIterations;   // WaterGUI runs setPathIterations too
  coastParams.simplifyTolerance = 10;
  const majorParams = { ...minorParams, dsep: o.majorSep, dtest: 30 * o.majorSep / 100, dlookahead: 200 };
  const mainParams = { ...minorParams, dsep: o.mainSep, dtest: 200 * o.mainSep / 400, dlookahead: 500 };
  const integrator = new RK4Integrator(tf, minorParams);

  // ─── water (water_gui.ts generateRoads) ──────────────────────────────────
  if (onStage) await stage('water');
  tf.parks = []; tf.sea = []; tf.river = [];
  const water = new WaterGenerator(integrator, origin, dims, { ...coastParams, coastNoise: { ...coastParams.coastNoise }, riverNoise: { ...coastParams.riverNoise } }, tf);
  let coastRoadIdx = -1, riverRoadIdx = -1;
  let tw = null;
  if (T) {
    tw = terrainWater(T, tf, water, Vector);
    if (tw.coast.length || T.water.length) events.push({ k: 'coast' });
    if (T.river) events.push({ k: 'river' });
  } else if (o.coast) {
    water.createCoast();
    coastRoadIdx = water.allStreamlinesSimple.length - 1;
    events.push({ k: 'coast' });
  } else {
    water.coastlineMajor = Math.random() < 0.5;   // createCoast would have set it
  }
  if (o.river && !T) {
    const before = water.allStreamlinesSimple.length;
    water.createRiver();
    if (water.allStreamlinesSimple.length > before) riverRoadIdx = water.allStreamlinesSimple.length - 1;
    events.push({ k: 'river' });
  }

  // ─── roads (road_gui.ts generateRoads, main_gui.ts callbacks) ─────────────
  const roadGen = (params, existing) => {
    const g = new StreamlineGenerator(integrator, origin, dims, { ...params });
    for (const e of existing) g.addExistingStreamlines(e);
    return g;
  };
  tf.ignoreRiver = true;
  if (onStage) await stage('main');
  const main = roadGen(mainParams, [water]);
  await runStreamlines(main);
  tf.ignoreRiver = false;

  tf.parks = []; tf.ignoreRiver = true;
  if (onStage) await stage('major');
  const major = roadGen(majorParams, [water, main]);
  await runStreamlines(major);
  tf.ignoreRiver = false;

  // big parks (main_gui.ts addParks with no minor roads yet)
  const parkFinder = (streams) => {
    const g = new Graph(streams, minorParams.dstep);
    const p = new PolygonFinder(g.nodes, { maxLength: 20, minArea: 80, shrinkSpacing: 4, chanceNoDivide: 1 }, tf);
    p.findPolygons();
    return p.polygons;
  };
  let bigParks = [];
  let superBlocks = [];
  {
    const polys = parkFinder(major.allStreamlinesSimple.concat(main.allStreamlinesSimple));
    superBlocks = polys.map(line);
    if (T) bigParks = pickParks(T, polys, o.bigParks);
    else if (polys.length > o.bigParks) {
      for (let i = 0; i < o.bigParks; i++) bigParks.push(polys[Math.floor(Math.random() * polys.length)]);
    } else bigParks.push(...polys);
  }
  tf.parks = bigParks;    // minor road pre-generate callback
  if (onStage) await stage('minor');
  const minor = roadGen(minorParams, [water, main, major]);
  await runStreamlines(minor);
  let smallParks = [];
  if (o.smallParks > 0) {
    const polys = parkFinder(major.allStreamlinesSimple.concat(main.allStreamlinesSimple, minor.allStreamlinesSimple));
    if (T) smallParks = pickParks(T, polys, o.smallParks);
    else for (let i = 0; i < o.smallParks && polys.length; i++) smallParks.push(polys[Math.floor(Math.random() * polys.length)]);
  }
  tf.parks = [...bigParks, ...smallParks];

  // ─── blocks and lots (buildings.ts generate) ──────────────────────────────
  const all = [...main.allStreamlinesSimple, ...major.allStreamlinesSimple, ...minor.allStreamlinesSimple,
    ...water.allStreamlinesSimple];
  if (water.riverSecondaryRoad && water.riverSecondaryRoad.length) all.push(water.riverSecondaryRoad);
  const g = new Graph(all, minorParams.dstep, true);
  const lotParams = { maxLength: 20, minArea: o.lotArea, shrinkSpacing: 4, chanceNoDivide: o.noDivide };
  if (onStage) await stage('blocks');
  const finder = new PolygonFinder(g.nodes, lotParams, tf);
  finder.findPolygons();
  await finder.shrink(false);
  const blocksV = finder._shrunkPolygons.slice();
  // divide one block per update(), as upstream's animated mode does, and
  // note which lots each block gave. toDivide.pop() takes the last block.
  if (onStage) await stage('lots');
  const dividing = finder.divide(true);
  const lotBlockOrder0 = [];
  const lotsV = [];
  {
    // (with no shrunk block, upstream divides the unshrunk faces: those
    // lots have no block here, so they are dropped, but the queue is
    // drained so that the divide promise resolves)
    let guard = 0;
    while (finder.toDivide.length > 0 && guard++ < 1e6) {
      const block = finder.toDivide.length - 1;
      const before = finder._dividedPolygons.length;
      finder.update();
      const after = finder._dividedPolygons.length;
      if (blocksV.length) for (let i = before; i < after; i++) { lotsV.push(finder._dividedPolygons[i]); lotBlockOrder0.push(block); }
    }
  }
  await dividing;

  // ─── copy out ─────────────────────────────────────────────────────────────
  const roads = {
    coast: tw ? tw.coast.map(line) : coastRoadIdx >= 0 ? [line(water.allStreamlinesSimple[coastRoadIdx])] : [],
    river: tw ? tw.river.map(line) : riverRoadIdx >= 0 ? [line(water.allStreamlinesSimple[riverRoadIdx])].concat(water.riverSecondaryRoad.length ? [line(water.riverSecondaryRoad)] : []) : [],
    main: main.allStreamlinesSimple.map(line),
    major: major.allStreamlinesSimple.map(line),
    minor: minor.allStreamlinesSimple.map(line),
  };
  // the family of each road line: 1 = it follows the major eigenvector
  const family = (gen) => gen.allStreamlines.map((sl) => (gen.streamlinesMajor.includes(sl) ? 1 : 0));
  const roadFamily = { main: family(main), major: family(major), minor: family(minor) };
  const blocksAll = blocksV.map(line);
  const lotsAll = lotsV.map(line);
  const lotBlockAll = lotBlockOrder0;

  // building heights: ours. Taller near the field centres (the radial
  // centre most), a seeded spread, a few towers. Legible, not real.
  const centres = fields.map((f) => ({ x: f.x, y: f.y, w: f.type === 'radial' ? 1.4 : 0.8 }));
  const R = Math.max(W, H) * 0.32;
  const heightsAll = lotsAll.map((lot) => {
    let cx = 0, cy = 0;
    for (const p of lot) { cx += p[0]; cy += p[1]; }
    cx /= lot.length; cy /= lot.length;
    let core = 0;
    for (const c of centres) core = Math.max(core, c.w * Math.exp(-((cx - c.x) ** 2 + (cy - c.y) ** 2) / (R * R)));
    core = Math.min(1, core);
    const u = Math.random();
    let h = 5 + 9 * u + 62 * Math.pow(core, 2.4) * (0.35 + 0.65 * Math.random());
    if (Math.random() < 0.015 + 0.08 * core) h *= 1.7;
    // terrain: lower on slopes (a hillside of houses, towers on the flat)
    if (T) h *= Math.min(1, Math.max(0.35, 1 - 0.65 * slopeAt(T, cx, cy) / T.grade));
    return { h: Math.round(h * o.height * 10) / 10 };
  });
  // the ragged edge (edge.js): which blocks stay urban, which become
  // fields, which lots stay empty, how low the fringe is. Its own seeded
  // stream, after the heights, so opts.edge 0 gives the old city exactly.
  const F = urbanForm({ W, H, dom: { x: origin.x, y: origin.y, w: dims.x, h: dims.y }, blocks: blocksAll, lots: lotsAll, lotBlock: lotBlockAll,
    roads, fields, T, sea: T ? null : line(water.seaPolygon), river: T ? null : line(water.riverPolygon), edge: o.edge, seed: o.seed, grade: T ? T.grade : 0.22, superBlocks });
  const blockMap = new Int32Array(blocksAll.length).fill(-1);
  const blocks = [];
  blocksAll.forEach((b, i) => { if (F.keepBlock[i] === 1) { blockMap[i] = blocks.length; blocks.push(b); } });
  const lots = [], lotBlockOrder = [], buildings = [];
  lotsAll.forEach((l, i) => {
    if (!F.keepLot[i] || blockMap[lotBlockAll[i]] < 0) return;
    lots.push(l); lotBlockOrder.push(blockMap[lotBlockAll[i]]);
    const h = heightsAll[i].h * F.lotScale[i];
    buildings.push({ h: F.lotScale[i] === 1 ? heightsAll[i].h : Math.max(3.5, Math.round(h * 10) / 10) });
  });
  if (F.form.edge > 0) {
    // minor roads: their runs near urban blocks; major roads: near urban
    // blocks or fields. Main, coast and river roads stay whole.
    const nearU = nearPolys(blocks, ANCHOR_TRIM);
    const nearUF = nearPolys(blocks.concat(F.farms.map((f) => f.poly)), ANCHOR_TRIM);
    for (const [cls, near] of [['minor', nearU], ['major', nearUF]]) {
      const t = trimLines(roads[cls], roadFamily[cls], near);
      roads[cls] = t.lines; roadFamily[cls] = t.fam;
    }
  }

  // events: roads in creation order (allStreamlinesSimple keeps it), parks
  // after the major roads, blocks, then lots block by block, then buildings
  for (const cls of ['main', 'major']) roads[cls].forEach((_, i) => events.push({ k: 'road', cls, i }));
  bigParks.forEach((_, i) => events.push({ k: 'parks', i }));
  roads.minor.forEach((_, i) => events.push({ k: 'road', cls: 'minor', i }));
  smallParks.forEach((_, i) => events.push({ k: 'parks', i: bigParks.length + i }));
  blocks.forEach((_, i) => events.push({ k: 'block', i }));
  {
    let i = 0;
    while (i < lots.length) {
      const b = lotBlockOrder[i];
      let j = i;
      while (j < lots.length && lotBlockOrder[j] === b) j++;
      events.push({ k: 'lots', block: b, from: i, n: j - i });
      i = j;
    }
  }

  buildings.forEach((_, i) => events.push({ k: 'building', i }));

  const t1 = (typeof performance !== 'undefined' ? performance : Date).now();
  const city = {
    v: VERSION,
    seed: o.seed >>> 0,
    opts: o,
    view: { w: W, h: H },
    domain: { x: origin.x, y: origin.y, w: dims.x, h: dims.y },
    fields,
    sea: T ? T.water : line(water.seaPolygon),
    coastline: T ? longest(tw.coast.map(line)) : line(water.coastline),
    river: T ? (T.river ? T.river.poly : []) : line(water.riverPolygon),
    roads,
    roadFamily,
    roadParams: { main: { dsep: mainParams.dsep, dtest: mainParams.dtest, dlookahead: mainParams.dlookahead }, major: { dsep: majorParams.dsep, dtest: majorParams.dtest, dlookahead: majorParams.dlookahead }, minor: { dsep: minorParams.dsep, dtest: minorParams.dtest, dlookahead: minorParams.dlookahead } },
    parks: [...bigParks, ...smallParks].map(line),
    blocks,
    lots,
    lotBlock: lotBlockOrder,
    farms: F.farms,
    form: F.form,
    buildings,
    events,
    stats: {
      ms: Math.round(t1 - t0),
      roads: roads.main.length + roads.major.length + roads.minor.length,
      blocks: blocks.length, lots: lots.length,
      tallest: buildings.reduce((m, b) => Math.max(m, b.h), 0),
      farms: F.farms.length, urbanShare: F.form.urbanShare,
    },
  };
  if (T) {
    city.coastlines = tw.coast.map(line);
    if (T.river) delete T.river.carved;
    city.terrain = T;
    city.stats.relief = T.stats.relief;
    city.stats.terrainMs = T.stats.ms;
  }
  return city;
}

const longest = (ls) => ls.reduce((b, l) => (l.length > b.length ? l : b), []);

// The upstream family of a line: 1 if it runs mostly along the major
// eigenvector of the field (sampled before the sea is set).
function familyOf(tf, l, Vector) {
  let a = 0, n = 0;
  for (let i = 1; i < l.length; i += Math.max(1, l.length >> 5)) {
    const dx = l[i][0] - l[i - 1][0], dy = l[i][1] - l[i - 1][1], L = Math.hypot(dx, dy);
    if (!L) continue;
    const m = tf.samplePoint(new Vector(l[i][0], l[i][1])).getMajor();
    if (!m.x && !m.y) continue;
    a += Math.abs(m.x * dx + m.y * dy) / L; n++;
  }
  return n ? a / n >= Math.SQRT1_2 : true;
}

// TERRAIN WATER. Upstream WaterGenerator.createCoast and createRiver grow a
// noisy streamline and build their polygons from it; with terrain the
// polygons come from terrain.js instead and go in through the upstream
// public fields: tensorField.sea (water plus ground too steep for a road:
// TensorField.onLand is false there, so no road, seed or lot), and
// tensorField.river (the bank ring). The shore runs and the two banks
// become roads through WaterGenerator.manuallyAddStreamline, the upstream
// call for river roads, each in the family it runs along.
function terrainWater(T, tf, water, Vector) {
  const V = (l) => l.map((p) => new Vector(p[0], p[1]));
  const coast = [], river = [];
  const lines = [];
  for (const l of T.coast) lines.push([l, coast]);
  if (T.river) for (const l of T.river.banks) lines.push([l, river]);
  const fam = lines.map(([l]) => familyOf(tf, l, Vector));
  tf.sea = V(T.block);
  if (T.river) tf.river = V(T.river.bank);
  lines.forEach(([l, out], i) => {
    const s = V(l);
    water.manuallyAddStreamline(s, fam[i]);
    out.push(s);
  });
  return { coast, river };
}

// Parks on terrain: a weighted pick of the faces, steep or wet ground first.
function pickParks(T, polys, n) {
  if (!polys.length || n <= 0) return [];
  const w = polys.map((p) => {
    let sl = 0, wet = 0;
    for (const v of p) {
      sl += slopeAt(T, v.x, v.y);
      const g = groundAt(T, v.x, v.y);
      const r = riverAt(T, v.x, v.y);
      if ((T.hasSea && g < T.seaLevel + 3) || (r && r.d < T.river.halfW + 90)) wet++;
    }
    sl /= p.length; wet /= p.length;
    return 0.15 + 2 * Math.min(1.5, sl / T.grade) + 1.5 * wet;
  });
  const total = w.reduce((a, b) => a + b, 0);
  const out = [];
  for (let k = 0; k < Math.min(n, polys.length); k++) {
    let x = Math.random() * total, i = 0;
    while (i < w.length - 1 && (x -= w[i]) > 0) i++;
    out.push(polys[i]);
  }
  return out;
}

// The tensor field at a map point, for the field drawing: the major
// eigenvector direction (unit [x, y]) or null in the sea or at a
// degenerate point. Rebuilds the field from city.fields (no randomness used).
export function fieldSampler(city) {
  const { Vector, TensorField } = MG;
  const tf = new TensorField({ globalNoise: false, noiseSizePark: 20, noiseAnglePark: 90, noiseSizeGlobal: 30, noiseAngleGlobal: 20 });
  tf.smooth = !!city.opts?.smooth;
  tf.sea = (city.terrain ? city.terrain.block : city.sea).map((p) => new Vector(p[0], p[1]));
  for (const f of city.fields) {
    if (f.type === 'grid') tf.addGrid(new Vector(f.x, f.y), f.size, f.decay, f.theta);
    else tf.addRadial(new Vector(f.x, f.y), f.size, f.decay);
  }
  if (city.terrain) tf.addField(makeSlopeField(city.terrain, tf.basisFields.length, tf.smooth));
  return function fieldAt(x, y) {
    const t = tf.samplePoint(new Vector(x, y));
    const m = t.getMajor();
    if (!isFinite(m.x) || (m.x === 0 && m.y === 0)) return null;
    return [m.x, m.y];
  };
}
