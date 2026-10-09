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
// No DOM. worker.js, main.js (fallback) and tests.mjs import it.
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
//            events: [{ k, i?, n? }]   (see EVENT KINDS)
//            stats: { ms, ... } }
// The coordinates are map units, y down (as upstream). The view is
// [0, w] x [0, h]; the generator works on the view grown 1.2 times about
// its centre, as upstream does (Util.DRAW_INFLATE_AMOUNT), so roads run
// off the edge.
//
// EVENT KINDS (in order): field, coast, river, road {cls, i}, parks {i},
// block {i}, lots {block, from, n}, building {i}
//
// grep: export const SIZES  export function defaults  export async function generate
//       function runStreamlines  function seeded  function fieldAt

import * as MG from '../../vendor/mapgenerator/mapgen.js';

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
  const realRandom = Math.random;
  const rnd = seeded(o.seed);
  Math.random = rnd;
  try {
    return await build(o, W, H, t0);
  } finally {
    Math.random = realRandom;
  }
}

async function build(o, W, H, t0) {
  const { Vector, TensorField, RK4Integrator, StreamlineGenerator, WaterGenerator, Graph, PolygonFinder } = MG;
  const INFLATE = 1.2;
  const origin = new Vector(-(INFLATE - 1) / 2 * W, -(INFLATE - 1) / 2 * H);
  const dims = new Vector(W * INFLATE, H * INFLATE);
  const events = [];

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
  tf.parks = []; tf.sea = []; tf.river = [];
  const water = new WaterGenerator(integrator, origin, dims, { ...coastParams, coastNoise: { ...coastParams.coastNoise }, riverNoise: { ...coastParams.riverNoise } }, tf);
  let coastRoadIdx = -1, riverRoadIdx = -1;
  if (o.coast) {
    water.createCoast();
    coastRoadIdx = water.allStreamlinesSimple.length - 1;
    events.push({ k: 'coast' });
  } else {
    water.coastlineMajor = Math.random() < 0.5;   // createCoast would have set it
  }
  if (o.river) {
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
  const main = roadGen(mainParams, [water]);
  await runStreamlines(main);
  tf.ignoreRiver = false;

  tf.parks = []; tf.ignoreRiver = true;
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
  {
    const polys = parkFinder(major.allStreamlinesSimple.concat(main.allStreamlinesSimple));
    if (polys.length > o.bigParks) {
      for (let i = 0; i < o.bigParks; i++) bigParks.push(polys[Math.floor(Math.random() * polys.length)]);
    } else bigParks.push(...polys);
  }
  tf.parks = bigParks;    // minor road pre-generate callback
  const minor = roadGen(minorParams, [water, main, major]);
  await runStreamlines(minor);
  let smallParks = [];
  if (o.smallParks > 0) {
    const polys = parkFinder(major.allStreamlinesSimple.concat(main.allStreamlinesSimple, minor.allStreamlinesSimple));
    for (let i = 0; i < o.smallParks && polys.length; i++) smallParks.push(polys[Math.floor(Math.random() * polys.length)]);
  }
  tf.parks = [...bigParks, ...smallParks];

  // ─── blocks and lots (buildings.ts generate) ──────────────────────────────
  const all = [...main.allStreamlinesSimple, ...major.allStreamlinesSimple, ...minor.allStreamlinesSimple,
    ...water.allStreamlinesSimple];
  if (water.riverSecondaryRoad && water.riverSecondaryRoad.length) all.push(water.riverSecondaryRoad);
  const g = new Graph(all, minorParams.dstep, true);
  const lotParams = { maxLength: 20, minArea: o.lotArea, shrinkSpacing: 4, chanceNoDivide: o.noDivide };
  const finder = new PolygonFinder(g.nodes, lotParams, tf);
  finder.findPolygons();
  await finder.shrink(false);
  const blocksV = finder._shrunkPolygons.slice();
  // divide one block per update(), as upstream's animated mode does, and
  // note which lots each block gave. toDivide.pop() takes the last block.
  const dividing = finder.divide(true);
  const lotBlockOrder = [];
  const lotsV = [];
  if (blocksV.length) {
    let guard = 0;
    while (finder.toDivide.length > 0 && guard++ < 1e6) {
      const block = finder.toDivide.length - 1;
      const before = finder._dividedPolygons.length;
      finder.update();
      const after = finder._dividedPolygons.length;
      for (let i = before; i < after; i++) { lotsV.push(finder._dividedPolygons[i]); lotBlockOrder.push(block); }
    }
  }
  await dividing;

  // ─── copy out ─────────────────────────────────────────────────────────────
  const roads = {
    coast: coastRoadIdx >= 0 ? [line(water.allStreamlinesSimple[coastRoadIdx])] : [],
    river: riverRoadIdx >= 0 ? [line(water.allStreamlinesSimple[riverRoadIdx])].concat(water.riverSecondaryRoad.length ? [line(water.riverSecondaryRoad)] : []) : [],
    main: main.allStreamlinesSimple.map(line),
    major: major.allStreamlinesSimple.map(line),
    minor: minor.allStreamlinesSimple.map(line),
  };
  // the family of each road line: 1 = it follows the major eigenvector
  const family = (gen) => gen.allStreamlines.map((sl) => (gen.streamlinesMajor.includes(sl) ? 1 : 0));
  const roadFamily = { main: family(main), major: family(major), minor: family(minor) };
  const blocks = blocksV.map(line);
  const lots = lotsV.map(line);

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

  // building heights: ours. Taller near the field centres (the radial
  // centre most), a seeded spread, a few towers. Legible, not real.
  const centres = fields.map((f) => ({ x: f.x, y: f.y, w: f.type === 'radial' ? 1.4 : 0.8 }));
  const R = Math.max(W, H) * 0.32;
  const buildings = lots.map((lot) => {
    let cx = 0, cy = 0;
    for (const p of lot) { cx += p[0]; cy += p[1]; }
    cx /= lot.length; cy /= lot.length;
    let core = 0;
    for (const c of centres) core = Math.max(core, c.w * Math.exp(-((cx - c.x) ** 2 + (cy - c.y) ** 2) / (R * R)));
    core = Math.min(1, core);
    const u = Math.random();
    let h = 5 + 9 * u + 62 * Math.pow(core, 2.4) * (0.35 + 0.65 * Math.random());
    if (Math.random() < 0.015 + 0.08 * core) h *= 1.7;
    return { h: Math.round(h * o.height * 10) / 10 };
  });
  buildings.forEach((_, i) => events.push({ k: 'building', i }));

  const t1 = (typeof performance !== 'undefined' ? performance : Date).now();
  const city = {
    v: VERSION,
    seed: o.seed >>> 0,
    opts: o,
    view: { w: W, h: H },
    domain: { x: origin.x, y: origin.y, w: dims.x, h: dims.y },
    fields,
    sea: line(water.seaPolygon),
    coastline: line(water.coastline),
    river: line(water.riverPolygon),
    roads,
    roadFamily,
    roadParams: { main: { dsep: mainParams.dsep, dtest: mainParams.dtest, dlookahead: mainParams.dlookahead }, major: { dsep: majorParams.dsep, dtest: majorParams.dtest, dlookahead: majorParams.dlookahead }, minor: { dsep: minorParams.dsep, dtest: minorParams.dtest, dlookahead: minorParams.dlookahead } },
    parks: [...bigParks, ...smallParks].map(line),
    blocks,
    lots,
    lotBlock: lotBlockOrder,
    buildings,
    events,
    stats: {
      ms: Math.round(t1 - t0),
      roads: roads.main.length + roads.major.length + roads.minor.length,
      blocks: blocks.length, lots: lots.length,
      tallest: buildings.reduce((m, b) => Math.max(m, b.h), 0),
    },
  };
  return city;
}

// The tensor field at a map point, for the field drawing: the major
// eigenvector direction (unit [x, y]) or null in the sea or at a
// degenerate point. Rebuilds the field from city.fields (no randomness used).
export function fieldSampler(city) {
  const { Vector, TensorField } = MG;
  const tf = new TensorField({ globalNoise: false, noiseSizePark: 20, noiseAnglePark: 90, noiseSizeGlobal: 30, noiseAngleGlobal: 20 });
  tf.smooth = !!city.opts?.smooth;
  tf.sea = city.sea.map((p) => new Vector(p[0], p[1]));
  for (const f of city.fields) {
    if (f.type === 'grid') tf.addGrid(new Vector(f.x, f.y), f.size, f.decay, f.theta);
    else tf.addRadial(new Vector(f.x, f.y), f.size, f.decay);
  }
  return function fieldAt(x, y) {
    const t = tf.samplePoint(new Vector(x, y));
    const m = t.getMajor();
    if (!isFinite(m.x) || (m.x === 0 && m.y === 0)) return null;
    return [m.x, m.y];
  };
}
