// ============================================================================
//  DLA TERRAIN  ·  ridges from DLA, rivers from branched flow, then erosion
// ----------------------------------------------------------------------------
//  DOM-free ES module. It runs in a page, in lib/dla-terrain-worker.js and in
//  node (stella-nova/tools/dla-terrain-check.mjs). A seed and the options
//  give the same terrain on every run.
//
//  THE PIPELINE (stage ids in order, each stage sends snapshots)
//    dla       DLA trees grow with lib/dla-engine.js (our MIT port of
//              fogleman/dlaf) on a coarse grid, level by level. Each level
//              doubles the grid: the old particles move to the new scale, a
//              jittered particle goes in the middle of each link, and new
//              walkers add finer branches.
//    upscale   The DLA upscale method. Each level rasterises its tree with
//              v = 1 - 1 / (1 + L / k), L = hops to the farthest leaf, so a
//              trunk is high and a tip is low. The sum is upsampled and
//              blurred once per level, then the crisp tree of the next level
//              goes on top. Old levels get more blur: broad mountains with
//              sharp dendritic ridges and the valleys between them.
//    shape     Domain warp, noise blend (fBm and ridged), land masks
//              (island, continent, archipelago, coast, peninsula, basin),
//              plateaus, terraces, volcanoes, rift, dunes, micro relief, then
//              the sea level from the sea fraction.
//    flow      Branched flow: rays go through a smooth correlated random
//              potential (plus a part of the terrain height). Weak random
//              lensing collects the rays into caustic branches. The ray
//              density is the channel field; it cuts valleys, raises the
//              stream power and steers the delta lobes.
//    rivers    Priority flood (Barnes 2014, with epsilon), D8 routing and
//              flow accumulation weighted by rain, on the erosion grid.
//    erosion   Stream-power incision (implicit, Braun and Willett 2013),
//              hard and soft strata, sediment deposition (Yuan 2019 style:
//              fans and flood plains), deltas, thermal (talus) erosion,
//              optional particle hydraulic erosion, then the full-size river
//              network: lakes, carved beds, river polylines with widths.
//    climate   Temperature from latitude and lapse rate. Moisture from an
//              orographic sweep along the wind (rain shadow), rivers, lakes
//              and the sea.
//    biomes    The 16 BIOMES from temperature, moisture, slope and water.
//
//  API (the contract: pages/dla-terrain/CONTRACT.md "LIB API")
//    BIOMES, OPTIONS, PRESETS, defaults(), randomOptions(seed, base, group?)
//    generateTerrain(opts, onProgress) -> Promise<Terrain>
//      onProgress({ stage, label, frac, stageFrac, snapshot })
//      frac is the fraction of the whole run, stageFrac of the stage.
//      snapshot = { n, height (m), worldSize, seaLevel, ...optional fields:
//      dla, channel, flow, river, water, moisture, temperature, biome }.
//      A snapshot n can be smaller than the final n (early stages).
//    detailHeight(x, z, t)   JS twin of lib/dla-terrain-detail.wgsl
//    sampleHeight(t, x, z)   bilinear height in metres (texel centres)
//    terrainHeightAt(t, x, z) sampleHeight + detailHeight
//    normalizeOptions(opts)  defaults merged, ranges clamped
//    Terrain = { n, worldSize, heightScale, seaLevel, texel, origin,
//      height Float32Array m, flow Float32Array (effective drainage area,
//      km2 of rain-weighted upstream area), river Float32Array 0..1, water
//      Float32Array depth m (sea, lakes, rivers), moisture 0..1,
//      temperature C, sediment m (deposit thickness), channel 0..1 (branched
//      flow), biome Uint8Array (BIOMES id),
//      rivers [{ pts Float32Array xz, width Float32Array m, flow
//      Float32Array, end: 'sea'|'lake'|'edge'|'join', cells Int32Array
//      (texel index of each point before the smoothing) }],
//      lakes [{ level, x, z, area, depth }], ridges [{ pts Float32Array xz }],
//      dla { pos Float32Array xz (world m), parent Int32Array, count },
//      stats, stages [{ id, label, ms }], opts }
//
//  WORLD FRAME  x and z in [origin, origin + worldSize], origin =
//  -worldSize / 2. Texel (i, j) is the sample at x = origin + (i + 0.5) *
//  texel, z = origin + (j + 0.5) * texel, texel = worldSize / n, index j * n
//  + i. Height is in metres above the sea (sea level 0) when the world has a
//  sea. A world with no sea has its lowest point near 0 m and seaLevel -100.
//
//  grep -n targets
//    biome table ......... "export const BIOMES"
//    option table ........ "export const OPTIONS"
//    presets ............. "export const PRESETS"
//    dice ................ "export function randomOptions"
//    noise ............... "function gnoise"
//    grid helpers ........ "function resample", "function boxBlur"
//    seed layouts ........ "function seedChains"
//    land masks .......... "function makeMask"
//    DLA growth .......... "function growDLA"
//    upscale ............. "function upscaleRidges"
//    shape ............... "function shapeField"
//    branched flow ....... "function branchedFlow"
//    priority flood ...... "function priorityFlood"
//    routing ............. "function routeD8"
//    stream power ........ "function erodeGrid"
//    deltas .............. "function buildDeltas"
//    thermal ............. "function thermalPass"
//    droplets ............ "function dropletErosion"
//    river network ....... "function hydrology"
//    climate ............. "function precipSweep", "function climate"
//    biomes .............. "function classifyBiomes"
//    detail (WGSL twin) .. "export function detailHeight"
//    main entry .......... "export async function generateTerrain"
//
//  Credits: dlaf by Michael Fogleman (MIT) through lib/dla-engine.js. The
//  DLA upscale method follows the public description of "DLA mountains"
//  (crisp tree, blurred sum, 1 - 1/(1+x) falloff). Branched flow after
//  Heller (Nature 2016) and pages/cube_branched_flow/flow.js. Priority flood
//  after Barnes, Lehman and Mulla (2014). Implicit stream power after Braun
//  and Willett (2013). Deposition after Yuan et al. (2019). Biome logic
//  after the Whittaker diagram, as in pages/forge/rocky.js. Our own code.
// ============================================================================

import { createModel, rng } from './dla-engine.js';

const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const D2R = Math.PI / 180;

// ═══════════════ BIOMES ═══════════════
// color is sRGB 0..1 (a map colour, not a PBR albedo).
export const BIOMES = Object.freeze([
  { id: 0, key: 'ocean', name: 'Ocean', color: [0.11, 0.24, 0.42] },
  { id: 1, key: 'beach', name: 'Beach', color: [0.86, 0.79, 0.6] },
  { id: 2, key: 'desert', name: 'Desert', color: [0.85, 0.7, 0.47] },
  { id: 3, key: 'savanna', name: 'Savanna', color: [0.67, 0.64, 0.36] },
  { id: 4, key: 'grassland', name: 'Grassland', color: [0.5, 0.62, 0.3] },
  { id: 5, key: 'temperate-forest', name: 'Temperate forest', color: [0.24, 0.42, 0.2] },
  { id: 6, key: 'rainforest', name: 'Rainforest', color: [0.1, 0.33, 0.15] },
  { id: 7, key: 'boreal-forest', name: 'Boreal forest', color: [0.2, 0.32, 0.24] },
  { id: 8, key: 'tundra', name: 'Tundra', color: [0.56, 0.56, 0.47] },
  { id: 9, key: 'bare-rock', name: 'Bare rock', color: [0.47, 0.44, 0.41] },
  { id: 10, key: 'snow', name: 'Snow', color: [0.94, 0.95, 0.97] },
  { id: 11, key: 'wetland', name: 'Wetland', color: [0.3, 0.42, 0.33] },
  { id: 12, key: 'river', name: 'River', color: [0.2, 0.42, 0.6] },
  { id: 13, key: 'lake', name: 'Lake', color: [0.16, 0.36, 0.55] },
  { id: 14, key: 'scree', name: 'Scree', color: [0.6, 0.57, 0.52] },
  { id: 15, key: 'alpine-meadow', name: 'Alpine meadow', color: [0.55, 0.6, 0.38] },
]);
const B = Object.fromEntries(BIOMES.map((b) => [b.key, b.id]));

// ═══════════════ OPTIONS ═══════════════
const GROUPS = ['World', 'DLA ridges', 'Shape', 'Branched flow', 'Erosion', 'Climate', 'Detail'];
const R = (key, label, group, min, max, step, def, text) => ({ key, label, group, type: 'range', min, max, step, def, text });
const S = (key, label, group, choices, def, text) => ({ key, label, group, type: 'select', choices, def, text });
const T = (key, label, group, def, text) => ({ key, label, group, type: 'bool', def, text });

export const OPTIONS = Object.freeze([
  // World
  R('seed', 'Seed', 'World', 1, 999999, 1, 1, 'The random seed. The same seed and options give the same world.'),
  S('n', 'Resolution', 'World', [256, 512, 1024, 2048], 1024, 'Height samples per side.'),
  R('worldSize', 'World size (m)', 'World', 2000, 64000, 1000, 16000, 'The side of the square world in metres.'),
  R('heightScale', 'Peak height (m)', 'World', 300, 6000, 50, 2200, 'The highest peak above the sea.'),
  R('seaFraction', 'Sea fraction', 'World', 0, 0.85, 0.01, 0.35, 'The part of the map under the sea. 0 gives a world with no sea.'),
  // DLA ridges
  S('layout', 'Seed layout', 'DLA ridges', ['point', 'line', 'ring', 'scatter', 'coast', 'ranges'], 'ranges', 'Where the DLA trees start: the trunks become the main ridges.'),
  R('seeds', 'Seeds', 'DLA ridges', 1, 16, 1, 4, 'Roots for the scatter and ranges layouts.'),
  R('particles', 'Branch density', 'DLA ridges', 0.03, 0.4, 0.01, 0.14, 'Particles per cell of the final DLA grid.'),
  R('stickiness', 'Stickiness', 'DLA ridges', 0.05, 1, 0.01, 0.85, 'The probability that a walker joins on contact (dlaf Stickiness). Low values give thick, bushy ranges.'),
  R('attraction', 'Attraction', 'DLA ridges', 1, 4, 0.05, 1.6, 'How near a walker must come to join (dlaf AttractionDistance, in particle spacings).'),
  R('stubbornness', 'Stubbornness', 'DLA ridges', 0, 12, 1, 0, 'Join attempts a particle refuses first (dlaf Stubbornness).'),
  R('rangeAngle', 'Range direction', 'DLA ridges', 0, 180, 1, 35, 'The direction of lines, ranges and walker drift, in degrees.'),
  R('anisotropy', 'Anisotropy', 'DLA ridges', 0, 0.9, 0.01, 0.25, 'Walkers move more along the range direction: long parallel ridges.'),
  R('levels', 'Levels', 'DLA ridges', 2, 6, 1, 4, 'Upscale levels. More levels give more scales of branching.'),
  R('ridgeFalloff', 'Ridge falloff', 'DLA ridges', 0.5, 16, 0.1, 4, 'k in 1 - 1/(1 + L/k): high values keep side ridges high.'),
  R('ridgeSharpness', 'Ridge sharpness', 'DLA ridges', 0, 1, 0.01, 0.55, 'Less blur on the last levels: knife-edge aretes.'),
  R('ridgeWeight', 'Ridge weight', 'DLA ridges', 0, 1, 0.01, 0.75, 'The share of the DLA ridges in the height.'),
  R('jitter', 'Ridge wiggle', 'DLA ridges', 0, 1, 0.01, 0.4, 'The side offset of the new middle particles at each level.'),
  // Shape
  S('mask', 'Land mask', 'Shape', ['none', 'island', 'continent', 'archipelago', 'coast', 'peninsula', 'basin'], 'continent', 'The large shape of the land.'),
  R('maskFalloff', 'Mask falloff', 'Shape', 0.05, 0.6, 0.01, 0.25, 'How wide the slope from land to sea is.'),
  R('coastNoise', 'Coast roughness', 'Shape', 0, 1, 0.01, 0.55, 'Noise on the mask edge: bays and capes.'),
  R('noiseBlend', 'Noise blend', 'Shape', 0, 1, 0.01, 0.3, 'Fractal noise added to the DLA ridges.'),
  R('noiseScale', 'Noise scale', 'Shape', 0.05, 1, 0.01, 0.3, 'The size of the noise features, as a part of the world.'),
  R('ridgedNoise', 'Ridged noise', 'Shape', 0, 1, 0.01, 0.35, 'The share of ridged noise in the noise blend.'),
  R('warp', 'Domain warp', 'Shape', 0, 1, 0.01, 0.35, 'Bends the ridges and the coasts.'),
  R('warpScale', 'Warp scale', 'Shape', 0.05, 1, 0.01, 0.35, 'The size of the warp swirls.'),
  R('uplift', 'Height curve', 'Shape', 0.5, 2.5, 0.01, 1.25, 'Exponent on the height: high values give low plains and steep peaks.'),
  R('plateaus', 'Plateaus', 'Shape', 0, 1, 0.01, 0, 'Flattens the land above the plateau level.'),
  R('plateauLevel', 'Plateau level', 'Shape', 0.15, 0.9, 0.01, 0.55, 'The height (0..1 of the land) of the plateaus.'),
  R('terraces', 'Terraces', 'Shape', 0, 16, 1, 0, 'Number of terrace steps (0 is off).'),
  R('terraceStrength', 'Terrace strength', 'Shape', 0, 1, 0.01, 0.6, 'How sharp the terrace steps are.'),
  R('volcanoes', 'Volcanoes', 'Shape', 0, 12, 1, 0, 'Volcanic cones with craters.'),
  R('rift', 'Rift', 'Shape', 0, 1, 0.01, 0, 'A long graben with raised shoulders, along the range direction.'),
  // Branched flow
  T('bfOn', 'Branched flow', 'Branched flow', true, 'Trace rays through a random potential and use their caustic branches as river channels.'),
  S('bfSource', 'Ray source', 'Branched flow', ['uplands', 'edge', 'ridges'], 'uplands', 'Where the rays start: high ground, one map edge, or the DLA ridges.'),
  R('bfRays', 'Rays', 'Branched flow', 500, 20000, 100, 6000, 'The number of rays.'),
  R('bfCorrelation', 'Correlation length', 'Branched flow', 0.004, 0.08, 0.001, 0.018, 'The size of the random potential bumps, as a part of the world.'),
  R('bfStrength', 'Potential strength', 'Branched flow', 0, 0.4, 0.005, 0.1, 'How strongly the bumps bend the rays. Stronger bumps branch sooner.'),
  R('bfGravity', 'Follow terrain', 'Branched flow', 0, 1, 0.01, 0.55, 'How much the rays run downhill.'),
  R('bfAngle', 'Edge direction', 'Branched flow', 0, 360, 1, 90, 'The ray direction for the edge source, in degrees.'),
  R('bfCarve', 'Channel carving', 'Branched flow', 0, 1, 0.01, 0.45, 'How deeply the branches cut valleys and steer rivers.'),
  // Erosion
  R('erosionIters', 'Erosion passes', 'Erosion', 0, 30, 1, 12, 'Stream-power passes on the erosion grid.'),
  R('erosionStrength', 'Erosion strength', 'Erosion', 0, 1, 0.01, 0.5, 'The stream-power constant K.'),
  R('mExp', 'Area exponent', 'Erosion', 0.3, 0.7, 0.01, 0.45, 'm in E = K A^m S. High values cut big rivers deeper.'),
  R('strata', 'Hard strata', 'Erosion', 0, 1, 0.01, 0, 'Bands of hard rock: cliffs, mesas and canyon steps.'),
  R('strataLayers', 'Strata layers', 'Erosion', 2, 30, 1, 10, 'The number of rock bands over the height range.'),
  R('thermalIters', 'Talus passes', 'Erosion', 0, 30, 1, 8, 'Thermal erosion passes.'),
  R('talus', 'Talus angle', 'Erosion', 15, 55, 1, 36, 'Slopes steeper than this shed material.'),
  R('deposition', 'Deposition', 'Erosion', 0, 1, 0.01, 0.5, 'Sediment that settles on fans and flood plains.'),
  R('deltas', 'Deltas', 'Erosion', 0, 1, 0.01, 0.5, 'Sediment that builds deltas at river mouths.'),
  R('droplets', 'Rain droplets', 'Erosion', 0, 400000, 10000, 0, 'Particle hydraulic erosion on the full grid (slow).'),
  R('riverDensity', 'River density', 'Erosion', 0, 1, 0.01, 0.5, 'Lower drainage threshold for rivers: more streams.'),
  R('riverDepth', 'River depth', 'Erosion', 0, 1, 0.01, 0.5, 'How deep the river beds are cut.'),
  R('riverWidth', 'River width', 'Erosion', 0.2, 3, 0.05, 1, 'A scale on the river widths.'),
  T('lakes', 'Lakes', 'Erosion', true, 'Keep large closed basins as lakes.'),
  // Climate
  R('latitude', 'Latitude', 'Climate', -70, 70, 1, 42, 'The latitude of the map centre, in degrees.'),
  R('latitudeSpan', 'Latitude span', 'Climate', 0, 30, 0.5, 3, 'The latitude change from the north edge to the south edge.'),
  R('baseTemp', 'Temperature offset', 'Climate', -15, 15, 0.5, 0, 'Degrees added to the sea-level temperature.'),
  R('lapseRate', 'Lapse rate', 'Climate', 3, 10, 0.1, 6.5, 'Cooling per km of height (C).'),
  R('windAngle', 'Wind direction', 'Climate', 0, 360, 1, 20, 'The direction the wet wind blows toward (0 is +x, 90 is +z).'),
  R('rainfall', 'Rainfall', 'Climate', 0, 1, 0.01, 0.55, 'Water in the incoming air.'),
  R('rainShadow', 'Rain shadow', 'Climate', 0, 1, 0.01, 0.6, 'How much the mountains take the rain from the air.'),
  // Detail
  R('detailAmp', 'Micro relief', 'Detail', 0, 1, 0.01, 0.4, 'Fractal relief at a few texels, baked into the height.'),
  R('detailRidged', 'Micro ridges', 'Detail', 0, 1, 0.01, 0.5, 'The ridged share of the micro relief on steep ground.'),
  R('detailScale', 'Micro scale', 'Detail', 1, 8, 0.1, 3, 'The wavelength of the micro relief, in texels.'),
  R('dunes', 'Dunes', 'Detail', 0, 1, 0.01, 0, 'Wind-aligned dunes on low dry ground.'),
]);
export const OPTION_GROUPS = GROUPS;

export function defaults() {
  const o = {};
  for (const d of OPTIONS) o[d.key] = d.def;
  return o;
}

// Defaults merged in, numbers clamped to the ranges, selects checked.
export function normalizeOptions(opts = {}) {
  const o = defaults();
  for (const d of OPTIONS) {
    if (!(d.key in opts) || opts[d.key] == null) continue;
    const v = opts[d.key];
    if (d.type === 'range') { const x = Number(v); if (Number.isFinite(x)) o[d.key] = clamp(x, d.min, d.max); }
    else if (d.type === 'bool') o[d.key] = !!v;
    else if (d.choices.includes(v)) o[d.key] = v;
    else if (d.key === 'n' && Number.isFinite(Number(v))) {
      const x = 2 ** Math.round(Math.log2(clamp(Number(v), 64, 2048)));
      o.n = x;
    }
  }
  if (typeof opts.n === 'string' && OPTIONS.find((d) => d.key === 'n').choices.includes(Number(opts.n))) o.n = Number(opts.n);
  for (const k of ['seed', 'seeds', 'levels', 'terraces', 'volcanoes', 'erosionIters', 'thermalIters', 'stubbornness', 'strataLayers', 'bfRays', 'droplets']) o[k] = Math.round(o[k]);
  return o;
}

// ═══════════════ PRESETS ═══════════════
export const PRESETS = Object.freeze({
  alpine: { label: 'Alpine', opts: {
    mask: 'none', seaFraction: 0.04, heightScale: 3600, worldSize: 20000, layout: 'ranges', seeds: 3, particles: 0.17,
    stickiness: 0.9, ridgeSharpness: 0.8, ridgeWeight: 0.85, ridgeFalloff: 5, uplift: 1.45, noiseBlend: 0.25, ridgedNoise: 0.6,
    erosionIters: 14, erosionStrength: 0.55, thermalIters: 10, talus: 38, latitude: 46, baseTemp: -2, rainfall: 0.7,
    riverDensity: 0.55, lakes: true, bfSource: 'uplands', bfCarve: 0.4, detailAmp: 0.55, detailRidged: 0.7 } },
  archipelago: { label: 'Archipelago', opts: {
    mask: 'archipelago', seaFraction: 0.62, heightScale: 900, worldSize: 24000, layout: 'scatter', seeds: 9, particles: 0.1,
    maskFalloff: 0.18, coastNoise: 0.8, ridgeWeight: 0.6, noiseBlend: 0.45, uplift: 1.3, warp: 0.5, latitude: 12, baseTemp: 2,
    rainfall: 0.8, erosionIters: 10, deltas: 0.4, riverDensity: 0.45, bfCarve: 0.35 } },
  canyonlands: { label: 'Canyonlands', opts: {
    mask: 'none', seaFraction: 0, heightScale: 1300, worldSize: 16000, layout: 'coast', particles: 0.12, ridgeWeight: 0.45,
    noiseBlend: 0.35, ridgedNoise: 0.2, uplift: 0.85, plateaus: 0.75, plateauLevel: 0.45, strata: 0.85, strataLayers: 9,
    erosionIters: 18, erosionStrength: 0.75, mExp: 0.55, thermalIters: 4, talus: 48, latitude: 37, baseTemp: 6, rainfall: 0.22,
    rainShadow: 0.4, bfSource: 'edge', bfAngle: 270, bfCarve: 0.75, bfStrength: 0.14, riverDensity: 0.35, deposition: 0.2,
    lakes: false, detailRidged: 0.2, dunes: 0.25 } },
  'river-delta': { label: 'River delta', opts: {
    mask: 'coast', seaFraction: 0.3, heightScale: 1100, worldSize: 32000, layout: 'line', particles: 0.11, rangeAngle: 0,
    ridgeWeight: 0.55, noiseBlend: 0.3, uplift: 1.8, maskFalloff: 0.4, coastNoise: 0.35, bfSource: 'uplands', bfRays: 9000,
    bfCarve: 0.6, bfStrength: 0.12, erosionIters: 16, deposition: 0.85, deltas: 1, riverDensity: 0.6, riverWidth: 1.6,
    latitude: 24, baseTemp: 3, rainfall: 0.75 } },
  fjords: { label: 'Fjords', opts: {
    mask: 'coast', seaFraction: 0.33, heightScale: 1500, worldSize: 20000, layout: 'coast', particles: 0.16, stickiness: 0.95,
    ridgeSharpness: 0.75, ridgeWeight: 0.8, uplift: 1.05, maskFalloff: 0.32, coastNoise: 0.75, warp: 0.45, bfSource: 'ridges',
    bfCarve: 1, bfStrength: 0.08, bfCorrelation: 0.012, erosionIters: 14, erosionStrength: 0.7, thermalIters: 12, talus: 42,
    latitude: 62, baseTemp: -2, rainfall: 0.85, windAngle: 0, riverDensity: 0.5, lakes: true } },
  'volcanic-isles': { label: 'Volcanic isles', opts: {
    mask: 'archipelago', seaFraction: 0.7, heightScale: 2400, worldSize: 24000, layout: 'scatter', seeds: 5, particles: 0.09,
    volcanoes: 6, ridgeWeight: 0.5, noiseBlend: 0.3, uplift: 1.1, coastNoise: 0.6, maskFalloff: 0.22, latitude: 18, baseTemp: 3,
    rainfall: 0.85, rainShadow: 0.8, windAngle: 200, erosionIters: 9, thermalIters: 6, riverDensity: 0.45, deltas: 0.3 } },
  highlands: { label: 'Highlands', opts: {
    mask: 'none', seaFraction: 0.12, heightScale: 1100, worldSize: 24000, layout: 'scatter', seeds: 6, particles: 0.13,
    stickiness: 0.6, ridgeSharpness: 0.3, ridgeWeight: 0.6, uplift: 1.1, noiseBlend: 0.4, ridgedNoise: 0.15, warp: 0.5,
    erosionIters: 14, erosionStrength: 0.45, thermalIters: 10, talus: 30, latitude: 57, baseTemp: -1, rainfall: 0.75,
    lakes: true, riverDensity: 0.6, bfCarve: 0.35 } },
  'mesa-desert': { label: 'Mesa desert', opts: {
    mask: 'none', seaFraction: 0, heightScale: 900, worldSize: 20000, layout: 'scatter', seeds: 7, particles: 0.08,
    ridgeWeight: 0.4, noiseBlend: 0.45, ridgedNoise: 0.1, uplift: 0.8, plateaus: 0.9, plateauLevel: 0.4, terraces: 5,
    terraceStrength: 0.7, strata: 0.7, strataLayers: 6, erosionIters: 12, erosionStrength: 0.6, thermalIters: 3, talus: 50,
    latitude: 30, baseTemp: 9, rainfall: 0.12, rainShadow: 0.3, bfSource: 'edge', bfAngle: 0, bfCarve: 0.55, riverDensity: 0.3,
    lakes: false, dunes: 0.7, detailRidged: 0.1 } },
  'rift-valley': { label: 'Rift valley', opts: {
    mask: 'none', seaFraction: 0.05, heightScale: 2600, worldSize: 40000, layout: 'line', particles: 0.12, rangeAngle: 80,
    anisotropy: 0.55, rift: 0.85, ridgeWeight: 0.6, uplift: 1.15, volcanoes: 2, latitude: -3, baseTemp: 0, rainfall: 0.45,
    rainShadow: 0.75, windAngle: 0, erosionIters: 12, lakes: true, riverDensity: 0.5, bfCarve: 0.4 } },
  'tropical-island': { label: 'Tropical island', opts: {
    mask: 'island', seaFraction: 0.55, heightScale: 1400, worldSize: 16000, layout: 'point', particles: 0.16, stickiness: 0.8,
    ridgeWeight: 0.8, ridgeSharpness: 0.7, uplift: 1.35, coastNoise: 0.65, latitude: 8, baseTemp: 2, rainfall: 0.9,
    rainShadow: 0.7, windAngle: 160, erosionIters: 14, erosionStrength: 0.6, riverDensity: 0.55, deltas: 0.4 } },
  'great-range': { label: 'Great range', opts: {
    mask: 'continent', seaFraction: 0.3, heightScale: 5200, worldSize: 64000, n: 1024, layout: 'line', particles: 0.16,
    rangeAngle: 25, anisotropy: 0.45, ridgeSharpness: 0.75, ridgeWeight: 0.85, uplift: 1.5, levels: 5, latitude: 35,
    rainfall: 0.6, rainShadow: 0.9, windAngle: 300, erosionIters: 16, riverDensity: 0.55, bfRays: 10000 } },
  'tundra-coast': { label: 'Tundra coast', opts: {
    mask: 'coast', seaFraction: 0.4, heightScale: 700, worldSize: 24000, layout: 'ranges', seeds: 5, particles: 0.12,
    stickiness: 0.5, ridgeWeight: 0.55, uplift: 1.6, noiseBlend: 0.4, latitude: 68, baseTemp: -4, rainfall: 0.5,
    lakes: true, riverDensity: 0.7, erosionIters: 10, thermalIters: 6, bfCarve: 0.3 } },
});

// ═══════════════ RANDOM NUMBERS ═══════════════
function subSeed(seed, salt) {
  let h = Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
  return ((h ^ (h >>> 16)) >>> 0) || 1;
}

// The dice. base: the options to start from. group: only this OPTIONS group
// (the dice button of a group); without it, the whole world gets a new style.
export function randomOptions(seed = 1, base = {}, group = null) {
  const r = rng(subSeed(seed, 77));
  const pick = (a) => a[Math.floor(r() * a.length) % a.length];
  const span = (a, b) => a + (b - a) * r();
  const o = normalizeOptions(base);
  const out = Object.assign({}, o);
  const set = (k, v) => { const d = OPTIONS.find((x) => x.key === k); if (!group || d.group === group) out[k] = v; };
  // A coherent style first, then each option near it.
  const mask = pick(['none', 'island', 'continent', 'archipelago', 'coast', 'peninsula', 'continent', 'coast']);
  set('mask', mask);
  const seaBy = { none: span(0, 0.12), island: span(0.45, 0.62), continent: span(0.25, 0.42), archipelago: span(0.55, 0.7), coast: span(0.25, 0.42), peninsula: span(0.35, 0.5), basin: span(0, 0.1) };
  set('seaFraction', +seaBy[mask].toFixed(2));
  set('worldSize', Math.round(span(10, 48)) * 1000);
  set('heightScale', Math.round(span(800, 4200) / 50) * 50);
  set('layout', pick(['point', 'line', 'ring', 'scatter', 'coast', 'ranges', 'ranges', 'scatter']));
  set('seeds', Math.round(span(2, 9)));
  set('particles', +span(0.08, 0.2).toFixed(2));
  set('stickiness', +span(0.45, 1).toFixed(2));
  set('attraction', +span(1.2, 2.4).toFixed(2));
  set('rangeAngle', Math.round(span(0, 180)));
  set('anisotropy', +span(0, 0.6).toFixed(2));
  set('levels', Math.round(span(3, 5)));
  set('ridgeFalloff', +span(2, 8).toFixed(1));
  set('ridgeSharpness', +span(0.3, 0.9).toFixed(2));
  set('ridgeWeight', +span(0.5, 0.9).toFixed(2));
  set('jitter', +span(0.2, 0.7).toFixed(2));
  set('maskFalloff', +span(0.15, 0.4).toFixed(2));
  set('coastNoise', +span(0.3, 0.85).toFixed(2));
  set('noiseBlend', +span(0.15, 0.5).toFixed(2));
  set('noiseScale', +span(0.15, 0.5).toFixed(2));
  set('ridgedNoise', +span(0, 0.7).toFixed(2));
  set('warp', +span(0.1, 0.6).toFixed(2));
  set('warpScale', +span(0.2, 0.6).toFixed(2));
  set('uplift', +span(0.9, 1.7).toFixed(2));
  const flatStyle = r() < 0.2;
  set('plateaus', flatStyle ? +span(0.4, 0.9).toFixed(2) : 0);
  set('plateauLevel', +span(0.35, 0.65).toFixed(2));
  set('terraces', r() < 0.15 ? Math.round(span(3, 9)) : 0);
  set('terraceStrength', +span(0.4, 0.8).toFixed(2));
  set('volcanoes', r() < 0.25 ? Math.round(span(1, 6)) : 0);
  set('rift', r() < 0.15 ? +span(0.4, 0.9).toFixed(2) : 0);
  set('bfOn', r() < 0.9);
  set('bfSource', pick(['uplands', 'uplands', 'edge', 'ridges']));
  set('bfRays', Math.round(span(3000, 9000) / 100) * 100);
  set('bfCorrelation', +span(0.01, 0.035).toFixed(3));
  set('bfStrength', +span(0.05, 0.18).toFixed(3));
  set('bfGravity', +span(0.35, 0.8).toFixed(2));
  set('bfAngle', Math.round(span(0, 360)));
  set('bfCarve', +span(0.25, 0.75).toFixed(2));
  set('erosionIters', Math.round(span(8, 18)));
  set('erosionStrength', +span(0.35, 0.7).toFixed(2));
  set('mExp', +span(0.4, 0.55).toFixed(2));
  set('strata', flatStyle ? +span(0.4, 0.9).toFixed(2) : (r() < 0.15 ? +span(0.2, 0.5).toFixed(2) : 0));
  set('strataLayers', Math.round(span(5, 14)));
  set('thermalIters', Math.round(span(4, 12)));
  set('talus', Math.round(span(30, 44)));
  set('deposition', +span(0.3, 0.8).toFixed(2));
  set('deltas', +span(0.2, 0.9).toFixed(2));
  set('riverDensity', +span(0.35, 0.7).toFixed(2));
  set('riverDepth', +span(0.35, 0.7).toFixed(2));
  set('riverWidth', +span(0.7, 1.6).toFixed(2));
  set('lakes', r() < 0.8);
  set('latitude', Math.round(span(-65, 65)));
  set('latitudeSpan', +span(0, 8).toFixed(1));
  set('baseTemp', +span(-4, 4).toFixed(1));
  set('windAngle', Math.round(span(0, 360)));
  set('rainfall', +span(0.2, 0.9).toFixed(2));
  set('rainShadow', +span(0.3, 0.9).toFixed(2));
  set('detailAmp', +span(0.2, 0.6).toFixed(2));
  set('detailRidged', +span(0.2, 0.8).toFixed(2));
  set('detailScale', +span(2, 4.5).toFixed(1));
  set('dunes', r() < 0.2 ? +span(0.2, 0.7).toFixed(2) : 0);
  if (!group || group === 'World') out.seed = 1 + Math.floor(r() * 999998);
  return normalizeOptions(out);
}

// ═══════════════ NOISE ═══════════════
// Gradient noise on an integer lattice with a 32-bit hash. CPU only (the
// WGSL twin of the detail has its own PCG hash, see detailHeight).
const GRAD = new Float64Array(32);
for (let k = 0; k < 16; k++) { const a = (k + 0.5) / 16 * Math.PI * 2; GRAD[2 * k] = Math.cos(a); GRAD[2 * k + 1] = Math.sin(a); }
function ihash(x, y, s) {
  let h = (Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(s, 0xcb1ab31f)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
function gnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const a = (ihash(ix, iy, s) & 15) << 1, b = (ihash(ix + 1, iy, s) & 15) << 1;
  const c = (ihash(ix, iy + 1, s) & 15) << 1, d = (ihash(ix + 1, iy + 1, s) & 15) << 1;
  const n00 = GRAD[a] * fx + GRAD[a + 1] * fy, n10 = GRAD[b] * (fx - 1) + GRAD[b + 1] * fy;
  const n01 = GRAD[c] * fx + GRAD[c + 1] * (fy - 1), n11 = GRAD[d] * (fx - 1) + GRAD[d + 1] * (fy - 1);
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const x0 = n00 + (n10 - n00) * ux, x1 = n01 + (n11 - n01) * ux;
  return 1.6 * (x0 + (x1 - x0) * uy);
}
// fBm in about [-1, 1].
function fbm(x, y, s, oct, gain = 0.5, lac = 2.03) {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let k = 0; k < oct; k++) {
    sum += a * gnoise(x * f + k * 17.31, y * f - k * 9.71, s + k * 101);
    norm += a; a *= gain; f *= lac;
  }
  return sum / norm;
}
// Ridged multifractal in about [0, 1].
function ridgedFbm(x, y, s, oct, gain = 0.5, lac = 2.07) {
  let a = 1, f = 1, sum = 0, norm = 0, w = 1;
  for (let k = 0; k < oct; k++) {
    let v = 1 - Math.abs(gnoise(x * f + k * 13.7, y * f + k * 7.3, s + k * 211));
    v *= v; v *= w; w = clamp(v * 1.6, 0, 1);
    sum += a * v; norm += a; a *= gain; f *= lac;
  }
  return sum / norm;
}

// ═══════════════ GRID HELPERS ═══════════════
// Bilinear resample of an sn x sn grid to dn x dn (texel centres line up).
function resample(src, sn, dn, out) {
  const dst = out || new Float32Array(dn * dn);
  const k = sn / dn;
  for (let y = 0; y < dn; y++) {
    let fy = (y + 0.5) * k - 0.5; if (fy < 0) fy = 0; if (fy > sn - 1) fy = sn - 1;
    const y0 = Math.floor(fy), y1 = Math.min(y0 + 1, sn - 1), ty = fy - y0;
    for (let x = 0; x < dn; x++) {
      let fx = (x + 0.5) * k - 0.5; if (fx < 0) fx = 0; if (fx > sn - 1) fx = sn - 1;
      const x0 = Math.floor(fx), x1 = Math.min(x0 + 1, sn - 1), tx = fx - x0;
      const a = src[y0 * sn + x0], b = src[y0 * sn + x1], c = src[y1 * sn + x0], d = src[y1 * sn + x1];
      dst[y * dn + x] = (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
    }
  }
  return dst;
}
// Box average down by an integer factor.
function downsample(src, sn, dn) {
  if (sn === dn) return Float32Array.from(src);
  const f = sn / dn, dst = new Float32Array(dn * dn), inv = 1 / (f * f);
  for (let y = 0; y < dn; y++) for (let x = 0; x < dn; x++) {
    let s = 0;
    for (let j = 0; j < f; j++) { const row = (y * f + j) * sn + x * f; for (let i = 0; i < f; i++) s += src[row + i]; }
    dst[y * dn + x] = s * inv;
  }
  return dst;
}
// Separable box blur, radius r, repeated passes (about a Gaussian), clamp edges.
function boxBlur(a, n, r, passes = 2) {
  if (r <= 0 || passes <= 0) return a;
  const tmp = new Float32Array(n * n), w = 1 / (2 * r + 1);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < n; y++) {
      const row = y * n;
      let s = 0;
      for (let i = -r; i <= r; i++) s += a[row + clamp(i, 0, n - 1)];
      for (let x = 0; x < n; x++) {
        tmp[row + x] = s * w;
        s += a[row + Math.min(x + r + 1, n - 1)] - a[row + Math.max(x - r, 0)];
      }
    }
    for (let x = 0; x < n; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += tmp[clamp(i, 0, n - 1) * n + x];
      for (let y = 0; y < n; y++) {
        a[y * n + x] = s * w;
        s += tmp[Math.min(y + r + 1, n - 1) * n + x] - tmp[Math.max(y - r, 0) * n + x];
      }
    }
  }
  return a;
}
function bilinear(a, n, fx, fy) {
  if (fx < 0) fx = 0; if (fy < 0) fy = 0; if (fx > n - 1) fx = n - 1; if (fy > n - 1) fy = n - 1;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(x0 + 1, n - 1), y1 = Math.min(y0 + 1, n - 1);
  const tx = fx - x0, ty = fy - y0;
  const p = a[y0 * n + x0], q = a[y0 * n + x1], r = a[y1 * n + x0], s = a[y1 * n + x1];
  return (p + (q - p) * tx) * (1 - ty) + (r + (s - r) * tx) * ty;
}
function quantile(a, q, stride = 1) {
  const m = Math.floor(a.length / stride), s = new Float32Array(m);
  for (let i = 0; i < m; i++) s[i] = a[i * stride];
  s.sort();
  return s[clamp(Math.floor(q * (m - 1)), 0, m - 1)];
}

// ═══════════════ SEED LAYOUTS ═══════════════
// Chains of seed points in uv (0..1). Each chain is one tree: the first
// point is the root, each next point joins the one before it.
function seedChains(o, r) {
  const a = o.rangeAngle * D2R, ca = Math.cos(a), sa = Math.sin(a);
  const chains = [];
  const line = (cx, cy, len, ang) => {
    const c = Math.cos(ang), s = Math.sin(ang), pts = [], k = 24;
    for (let i = 0; i <= k; i++) {
      const t = i / k - 0.5;
      pts.push([cx + c * t * len, cy + s * t * len]);
    }
    // root in the middle: reorder so the chain grows out both ways
    const mid = k >> 1, out = [pts[mid]];
    for (let i = 1; i <= mid; i++) { if (mid + i <= k) out.push(pts[mid + i]); }
    const left = [];
    for (let i = 1; i <= mid; i++) left.push(pts[mid - i]);
    return [out, left];  // two chains that share the root area
  };
  switch (o.layout) {
    case 'point': chains.push([[0.5 + (r() - 0.5) * 0.08, 0.5 + (r() - 0.5) * 0.08]]); break;
    case 'line': chains.push(...line(0.5, 0.5, 0.7, a)); break;
    case 'ring': {
      const pts = [], k = 40, rad = 0.27;
      for (let i = 0; i < k; i++) { const t = i / k * Math.PI * 2; pts.push([0.5 + Math.cos(t) * rad, 0.5 + Math.sin(t) * rad]); }
      chains.push(pts);
      break;
    }
    case 'coast': {
      // a range parallel to the coast, inland of it (see makeMask 'coast')
      const ang = a, nx = -Math.sin(ang), ny = Math.cos(ang);
      chains.push(...line(0.5 - nx * 0.2, 0.5 - ny * 0.2, 1.0, ang));
      break;
    }
    case 'ranges': {
      for (let k = 0; k < o.seeds; k++) {
        const cx = 0.2 + r() * 0.6, cy = 0.2 + r() * 0.6, len = 0.15 + r() * 0.3, ang = a + (r() - 0.5) * 0.7;
        chains.push(...line(cx, cy, len, ang));
      }
      break;
    }
    default: // scatter
      for (let k = 0; k < o.seeds; k++) chains.push([[0.12 + r() * 0.76, 0.12 + r() * 0.76]]);
  }
  return chains;
}

// ═══════════════ LAND MASKS ═══════════════
// mask(u, v) -> 0..1, 1 is land. Built once from the options and the seed.
function makeMask(o, seed) {
  const r = rng(subSeed(seed, 5));
  const fall = o.maskFalloff, cn = o.coastNoise, s = subSeed(seed, 6);
  const a = o.rangeAngle * D2R, nx = -Math.sin(a), ny = Math.cos(a);
  const blobs = [];
  if (o.mask === 'archipelago') {
    const k = 5 + Math.floor(r() * 5);
    for (let i = 0; i < k; i++) blobs.push([0.15 + r() * 0.7, 0.15 + r() * 0.7, 0.07 + r() * 0.12]);
  }
  const cx = 0.5 + (r() - 0.5) * 0.15, cy = 0.5 + (r() - 0.5) * 0.15;
  const tip = r() * Math.PI * 2;
  const warpU = (u, v) => u + cn * (0.1 * fbm(u * 2.3 + 3.1, v * 2.3 - 1.7, s, 2) + 0.06 * fbm(u * 7 + 3.1, v * 7 - 1.7, s + 3, 4, 0.6));
  const warpV = (u, v) => v + cn * (0.1 * fbm(u * 2.3 - 7.3, v * 2.3 + 5.9, s + 9, 2) + 0.06 * fbm(u * 7 - 7.3, v * 7 + 5.9, s + 12, 4, 0.6));
  const f = (u0, v0) => {
    const u = warpU(u0, v0), v = warpV(u0, v0);
    switch (o.mask) {
      case 'island': { const d = Math.hypot(u - cx, v - cy) / 0.36; return 1 - smoothstep(1 - fall, 1 + fall * 0.6, d); }
      case 'continent': { const d = Math.hypot((u - cx) * 0.9, (v - cy) * 1.1) / 0.5; return 1 - smoothstep(1 - fall, 1 + fall * 0.5, d); }
      case 'archipelago': {
        let m = 0;
        for (const b of blobs) { const d = Math.hypot(u - b[0], v - b[1]) / b[2]; m = Math.max(m, 1 - smoothstep(1 - fall * 1.5, 1 + fall, d)); }
        return m;
      }
      case 'coast': { const d = (u - 0.5) * nx + (v - 0.5) * ny; return 1 - smoothstep(-fall * 0.6, fall * 0.6, d - 0.05); }
      case 'peninsula': {
        const d = (u - 0.5) * nx + (v - 0.5) * ny;
        const base = 1 - smoothstep(-fall * 0.5, fall * 0.5, d + 0.18);
        // a tongue toward the sea side
        const tx = Math.cos(tip) * 0.2 + nx * 0.15, ty = Math.sin(tip) * 0.2 + ny * 0.15;
        const px = u - 0.5, py = v - 0.5, L = Math.hypot(tx, ty) + 0.3, ux = nx, uy = ny;
        const along = px * ux + py * uy, across = Math.abs(-px * uy + py * ux - Math.sin(along * 6 + tip) * 0.04);
        const tongue = (1 - smoothstep(0.09, 0.09 + fall * 0.4, across)) * (1 - smoothstep(0.2 + L * 0.3, 0.45 + L * 0.3, along));
        return Math.max(base, tongue);
      }
      case 'basin': { const d = Math.hypot(u - cx, v - cy) / 0.42; return 0.35 + 0.65 * smoothstep(0.4, 1.0 + fall, d); }
      default: return 1;
    }
  };
  return f;
}

// ═══════════════ DLA GROWTH ═══════════════
// Leaf distance L: hops to the farthest leaf below each particle.
function leafDistance(parent, count) {
  const L = new Int32Array(count);
  for (let i = count - 1; i >= 0; i--) { const p = parent[i]; if (p >= 0 && L[i] + 1 > L[p]) L[p] = L[i] + 1; }
  return L;
}
// Rasterise the tree links into a g x g grid (positions centred on 0).
function rasterTree(pos, parent, count, g, values, out) {
  const a = out || new Float32Array(g * g);
  if (out) a.fill(0);
  const h = g / 2;
  for (let i = 0; i < count; i++) {
    const x1 = pos[i * 3] + h, y1 = pos[i * 3 + 1] + h, v1 = values[i];
    const p = parent[i];
    const x0 = p >= 0 ? pos[p * 3] + h : x1, y0 = p >= 0 ? pos[p * 3 + 1] + h : y1, v0 = p >= 0 ? values[p] : v1;
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, x = Math.floor(x0 + (x1 - x0) * t), y = Math.floor(y0 + (y1 - y0) * t);
      if (x < 0 || y < 0 || x >= g || y >= g) continue;
      const v = v0 + (v1 - v0) * t, k = y * g + x;
      if (v > a[k]) a[k] = v;
    }
  }
  return a;
}
function treeValues(L, count, k) {
  const v = new Float32Array(count);
  for (let i = 0; i < count; i++) v[i] = 1 - 1 / (1 + L[i] / k);
  return v;
}

function makeDLAModel(o, g, rand, mask) {
  const H = g / 2, a = o.rangeAngle * D2R, ca = Math.cos(a), sa = Math.sin(a), an = o.anisotropy;
  const hooks = {
    randomStartingPosition(m, out) {
      for (let k = 0; k < 40; k++) {
        const u = m.random(), v = m.random(), w = mask(u, v);
        if (k === 39 || m.random() < w * w) { out[0] = (u - 0.5) * g; out[1] = (v - 0.5) * g; out[2] = 0; return out; }
      }
      return out;
    },
    shouldReset(m, p) { return p[0] < -H || p[0] > H || p[1] < -H || p[1] > H; },
    motionVector(m, p, out) {
      let x, y;
      do { x = m.random() * 2 - 1; y = m.random() * 2 - 1; } while (x * x + y * y > 1 || x * x + y * y < 1e-6);
      if (an > 0) {
        const al = x * ca + y * sa, ac = (-x * sa + y * ca) * (1 - an);
        x = al * ca - ac * sa; y = al * sa + ac * ca;
      }
      out[0] = x; out[1] = y; out[2] = 0; return out;
    },
  };
  return createModel({
    dim: 2, random: rand, hooks, maxSteps: 20000,
    params: { particleSpacing: 1, attractionDistance: o.attraction, minMoveDistance: 0.75, stubbornness: o.stubbornness, stickiness: o.stickiness },
  });
}

// Grows the DLA level by level. Returns { levels: [{ g, crisp }], final }.
async function growDLA(o, n, mask, emit) {
  const L = o.levels;
  const gL0 = clamp(n >> 2, 64, 512);
  const g0 = Math.max(12, gL0 >> (L - 1));
  const rand = rng(subSeed(o.seed, 1));
  const chains = seedChains(o, rng(subSeed(o.seed, 2)));
  const maxParticles = n >= 2048 ? 120000 : 60000;
  let g = g0;
  let m = makeDLAModel(o, g, rand, mask);
  // seeds: points of each chain, spaced about one cell at level 0
  for (const ch of chains) {
    let prev = -1;
    for (let i = 0; i < ch.length; i++) {
      const p = [(ch[i][0] - 0.5) * g, (ch[i][1] - 0.5) * g, 0];
      if (prev >= 0) {
        // fill the gap with one particle per cell so the chain is a link path
        const px = m.pos[prev * 3], py = m.pos[prev * 3 + 1], d = Math.hypot(p[0] - px, p[1] - py);
        const k = Math.floor(d);
        for (let j = 1; j < k; j++) prev = m.add([px + (p[0] - px) * j / k, py + (p[1] - py) * j / k, 0], prev);
      }
      if (p[0] > -g / 2 && p[0] < g / 2 && p[1] > -g / 2 && p[1] < g / 2) prev = m.add(p, prev);
    }
  }
  if (m.count === 0) m.add([0, 0, 0]);
  const levels = [];
  const snapOut = (lvl, frac) => {
    const cnt = m.count, Lh = leafDistance(m.parent, cnt);
    const vals = treeValues(Lh, cnt, o.ridgeFalloff * 2 ** lvl);
    const crisp = rasterTree(m.pos, m.parent, cnt, g, vals);
    for (let i = 0; i < crisp.length; i++) crisp[i] *= o.heightScale;
    const ws = o.worldSize, pos = new Float32Array(cnt * 2), k = ws / g;
    for (let i = 0; i < cnt; i++) { pos[i * 2] = m.pos[i * 3] * k; pos[i * 2 + 1] = m.pos[i * 3 + 1] * k; }
    return emit(frac, `Growing DLA ridges, level ${lvl + 1} of ${L}`, {
      n: g, height: crisp, dla: { pos, parent: m.parent.slice(0, cnt), count: cnt },
    });
  };
  for (let lvl = 0; lvl < L; lvl++) {
    const target = Math.min(maxParticles, Math.round(o.particles * g * g * (0.35 + 0.65 * (lvl + 1) / L)));
    const chunks = 4;
    const start = m.count;
    for (let c = 1; c <= chunks; c++) {
      const want = Math.round(start + (target - start) * c / chunks);
      while (m.count < want) m.addParticle();
      await snapOut(lvl, (lvl + c / chunks) / L);
    }
    const cnt = m.count, Lh = leafDistance(m.parent, cnt);
    const vals = treeValues(Lh, cnt, o.ridgeFalloff * 2 ** lvl);
    levels.push({ g, crisp: rasterTree(m.pos, m.parent, cnt, g, vals) });
    if (lvl === L - 1) break;
    // upscale the tree: x2 positions, a jittered middle particle per link
    const g2 = g * 2;
    const m2 = makeDLAModel(o, g2, rand, mask);
    const map = new Int32Array(cnt);
    const P = m.pos, Pa = m.parent;
    for (let i = 0; i < cnt; i++) {
      const p = Pa[i], x = P[i * 3] * 2, y = P[i * 3 + 1] * 2;
      if (p < 0) { map[i] = m2.add([x, y, 0], -1); continue; }
      const px = P[p * 3] * 2, py = P[p * 3 + 1] * 2, dx = x - px, dy = y - py, l = Math.hypot(dx, dy) || 1;
      const j = (rand() - 0.5) * o.jitter * 1.2;
      const mid = m2.add([(x + px) / 2 - dy / l * j, (y + py) / 2 + dx / l * j, 0], map[p]);
      map[i] = m2.add([x, y, 0], mid);
    }
    m = m2; g = g2;
  }
  const cnt = m.count, Lh = leafDistance(m.parent, cnt);
  return { levels, g, model: m, count: cnt, L: Lh };
}

// ═══════════════ UPSCALE ═══════════════
// The blurred sum: per level, upsample x2 and blur, add the crisp tree.
async function upscaleRidges(o, n, levels, emit) {
  let a = Float32Array.from(levels[0].crisp), g = levels[0].g;
  boxBlur(a, g, 1, 3);
  const sharp = o.ridgeSharpness;
  const total = Math.log2(n / g) || 1;
  const wf = lerp(0.42, 0.78, sharp);
  let step = 0;
  for (let l = 1; l < levels.length; l++) {
    const g2 = levels[l].g;
    a = resample(a, g, g2);
    g = g2;
    boxBlur(a, g, 1, 3);
    const c = levels[l].crisp, w = Math.pow(wf, l);
    for (let i = 0; i < a.length; i++) a[i] += c[i] * w;
    step++;
    await emitNorm(a, g, (step) / total);
  }
  // the final crisp level gets a light blur so ridges are not one cell wide
  boxBlur(a, g, 1, Math.max(1, Math.round(2.5 - 2 * sharp)));
  while (g < n) {
    a = resample(a, g, g * 2); g *= 2;
    boxBlur(a, g, 1, 1);
    step++;
    await emitNorm(a, g, Math.min(1, step / total));
  }
  let mx = 0;
  for (let i = 0; i < a.length; i++) if (a[i] > mx) mx = a[i];
  const inv = mx > 0 ? 1 / mx : 1;
  for (let i = 0; i < a.length; i++) a[i] *= inv;
  return a;
  function emitNorm(arr, gg, f) {
    let m = 0;
    for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
    const out = new Float32Array(arr.length), k = m > 0 ? o.heightScale / m : 0;
    for (let i = 0; i < arr.length; i++) out[i] = arr[i] * k;
    return emit(f, `Upscaling and blurring, ${gg} x ${gg}`, { n: gg, height: out });
  }
}

// ═══════════════ SHAPE ═══════════════
// Ridge field (0..1, n x n) -> shaped height field (0..1 ish, sea at q).
function shapeField(o, n, ridge, mask) {
  const s = subSeed(o.seed, 11), sw = subSeed(o.seed, 12), sr = subSeed(o.seed, 13);
  const h = new Float32Array(n * n);
  const ws = 1 / o.warpScale, ns = 1 / o.noiseScale;
  const wAmp = o.warp * 0.07;
  const nb = o.noiseBlend, rw = o.ridgeWeight, rn = o.ridgedNoise;
  const inv = 1 / n;
  // the mask is smooth: evaluate it on a coarse grid and interpolate
  const mn = Math.min(n, 256), mg = new Float32Array(mn * mn);
  for (let y = 0; y < mn; y++) for (let x = 0; x < mn; x++) mg[y * mn + x] = mask((x + 0.5) / mn, (y + 0.5) / mn);
  const mk = mn / n;
  // the massif: a very broad blur of the ridges, so the land rises toward
  // the ranges and the plains drain away from them
  const gm = Math.min(n, 256), mass = downsample(ridge, n, gm);
  boxBlur(mass, gm, Math.max(2, gm >> 4), 3);
  let mm = 0; for (let i = 0; i < mass.length; i++) if (mass[i] > mm) mm = mass[i];
  for (let i = 0; i < mass.length; i++) mass[i] /= mm || 1;
  const gk = gm / n;
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) * inv;
      let wu = u, wv = v;
      if (wAmp > 0) {
        wu += wAmp * fbm(u * ws * 3 + 1.7, v * ws * 3 + 9.2, sw, 3);
        wv += wAmp * fbm(u * ws * 3 + 8.3, v * ws * 3 + 2.8, sw + 5, 3);
      }
      const d = bilinear(ridge, n, wu * n - 0.5, wv * n - 0.5);
      let nz = 0;
      if (nb > 0) {
        const f = 0.5 + 0.5 * fbm(wu * ns * 2, wv * ns * 2, s, 6, 0.5);
        const rr = rn > 0 ? ridgedFbm(wu * ns * 2.5 + 3.3, wv * ns * 2.5 - 1.1, sr, 5) : 0;
        nz = lerp(f, rr, rn);
      }
      const low = 0.5 + 0.5 * fbm(wu * 1.3 + 4.4, wv * 1.3 + 0.7, s + 77, 3);
      const ms = bilinear(mass, gm, (wu * n) * gk - 0.5, (wv * n) * gk - 0.5);
      let base = rw * (0.72 * d + 0.38 * ms) + nb * nz * (0.45 + 0.55 * d) + 0.1 * low;
      const m = bilinear(mg, mn, (x + 0.5) * mk - 0.5, (y + 0.5) * mk - 0.5);
      if (o.mask !== 'none') base = base * (0.15 + 0.85 * m) + (m - 1) * 0.45 + m * 0.08;
      h[y * n + x] = base;
    }
  }
  // normalise land part to 0..1
  let mn0 = Infinity, mx0 = -Infinity;
  for (let i = 0; i < h.length; i++) { if (h[i] < mn0) mn0 = h[i]; if (h[i] > mx0) mx0 = h[i]; }
  const span = mx0 - mn0 || 1;
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - mn0) / span;
  return h;
}

// Height-curve, plateaus, terraces, volcanoes, rift, dunes: on h (0..1).
function sculpt(o, n, h, seaQ) {
  const r = rng(subSeed(o.seed, 21));
  const up = o.uplift;
  // the curve acts above the sea only, so coasts stay where the mask put them
  for (let i = 0; i < h.length; i++) {
    const t = h[i] - seaQ;
    if (t > 0) h[i] = seaQ + (1 - seaQ) * Math.pow(t / (1 - seaQ), up);
  }
  if (o.plateaus > 0) {
    const L = seaQ + (1 - seaQ) * o.plateauLevel, p = o.plateaus, s = subSeed(o.seed, 22);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x, t = h[i];
      if (t <= L - 0.08) continue;
      const nz = 0.03 * fbm(x / n * 9, y / n * 9, s, 3);
      const Lp = L + nz;
      // soft cap: above Lp the height is squashed to a near flat top
      const over = t - Lp, k = 0.04;
      const capped = over > 0 ? Lp + over * (1 - p * 0.92) : Lp + over;
      const blend = smoothstep(-k, k, over);
      h[i] = lerp(t, capped, blend * p + (1 - blend) * 0) ;
    }
  }
  if (o.terraces > 0) {
    const N = o.terraces, st = o.terraceStrength, s = subSeed(o.seed, 23);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x, t = h[i];
      if (t <= seaQ) continue;
      const z = (t - seaQ) / (1 - seaQ) * N + 0.25 * fbm(x / n * 6, y / n * 6, s, 2);
      const k = Math.floor(z), f = z - k;
      const stepF = k + Math.pow(smoothstep(0.0, 1.0, f), 1 + st * 5);
      const tt = seaQ + (stepF - 0.25 * fbm(x / n * 6, y / n * 6, s, 2)) / N * (1 - seaQ);
      h[i] = lerp(t, tt, st);
    }
  }
  if (o.volcanoes > 0) {
    // cones on land, preferring high ground
    for (let v = 0; v < o.volcanoes; v++) {
      let bx = 0.5, by = 0.5, bh = -1;
      for (let k = 0; k < 24; k++) {
        const x = 0.12 + r() * 0.76, y = 0.12 + r() * 0.76, hh = bilinear(h, n, x * n, y * n);
        if (hh > bh) { bh = hh; bx = x; by = y; }
      }
      const rad = (0.05 + r() * 0.07) * n, hv = (0.25 + r() * 0.35) * (1 - seaQ), crater = rad * (0.09 + r() * 0.07);
      const x0 = Math.max(0, Math.floor(bx * n - rad * 1.6)), x1 = Math.min(n - 1, Math.ceil(bx * n + rad * 1.6));
      const y0 = Math.max(0, Math.floor(by * n - rad * 1.6)), y1 = Math.min(n - 1, Math.ceil(by * n + rad * 1.6));
      const s = subSeed(o.seed, 30 + v);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dx = x - bx * n, dy = y - by * n, ang = Math.atan2(dy, dx);
        const d = Math.hypot(dx, dy) * (1 + 0.12 * fbm(Math.cos(ang) * 2 + v, Math.sin(ang) * 2, s, 3));
        if (d > rad * 1.6) continue;
        const t = d / rad;
        // concave cone (lava flows), a rim and a crater
        let cone = hv * Math.pow(Math.max(0, 1 - t / 1.6), 2.2);
        const gul = 0.06 * hv * Math.max(0, 1 - t / 1.6) * Math.abs(Math.sin(ang * 9 + fbm(t * 3, v, s, 2) * 3));
        cone -= gul;
        if (d < crater * 1.4) cone -= hv * 0.18 * (1 - smoothstep(crater * 0.6, crater * 1.4, d));
        const i = y * n + x;
        h[i] = Math.max(h[i], h[i] * 0.4 + cone + seaQ * 0.6 + 0.02) ;
      }
    }
  }
  if (o.rift > 0) {
    const a = o.rangeAngle * D2R, nx = -Math.sin(a), ny = Math.cos(a), s = subSeed(o.seed, 40);
    const off = (r() - 0.5) * 0.1;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n - 0.5, v = (y + 0.5) / n - 0.5;
      const along = u * -ny + v * nx;
      const d = (u * nx + v * ny - off) + 0.025 * fbm(along * 5, 1.3, s, 4);
      const w = 0.05 + 0.015 * fbm(along * 3, 7.1, s + 1, 2);
      const floor = 1 - smoothstep(w * 0.7, w * 1.1, Math.abs(d));
      const shoulder = Math.exp(-((Math.abs(d) - w * 1.3) ** 2) / (2 * (w * 0.8) ** 2));
      const i = y * n + x;
      const target = seaQ + (h[i] - seaQ) * 0.2 + 0.02;
      h[i] = lerp(h[i] + o.rift * 0.12 * shoulder * (1 - seaQ), Math.min(h[i], target), floor * o.rift);
    }
  }
}

// Baked micro relief and dunes, in metres, on the full grid.
function microRelief(o, n, hm, sea, texel) {
  const s = subSeed(o.seed, 51), sd = subSeed(o.seed, 52);
  const amp = o.detailAmp * texel * 0.9, rid = o.detailRidged, f = 1 / o.detailScale;
  const wa = o.windAngle * D2R, wx = Math.cos(wa), wz = Math.sin(wa);
  const duneLen = Math.max(4, 180 / texel), dune = o.dunes;
  if (amp <= 0 && dune <= 0) return;
  for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
    const i = y * n + x, h = hm[i];
    if (h < sea - 2) continue;
    const gx = (hm[i + 1] - hm[i - 1]) / (2 * texel), gz = (hm[i + n] - hm[i - n]) / (2 * texel);
    const sl = Math.hypot(gx, gz), steep = smoothstep(0.25, 0.9, sl);
    let d = 0;
    if (amp > 0) {
      const sm = fbm(x * f, y * f, s, 3, 0.5);
      const rr = ridgedFbm(x * f * 0.7 + 3.1, y * f * 0.7, s + 3, 3) - 0.45;
      d = amp * (0.35 + 0.65 * steep) * lerp(sm, rr * 2, rid * steep);
    }
    if (dune > 0) {
      const low = 1 - smoothstep(0.08 * o.heightScale, 0.3 * o.heightScale, h - sea);
      const flat = 1 - smoothstep(0.05, 0.2, sl);
      const dry = 1 - smoothstep(0.25, 0.6, o.rainfall);
      const w = dune * low * flat * (0.4 + 0.6 * dry) * smoothstep(-0.2, 0.3, fbm(x / n * 5, y / n * 5, sd, 3));
      if (w > 0.001) {
        const along = (x * wx + y * wz) / duneLen, across = (-x * wz + y * wx) / (duneLen * 3);
        const ph = along + 0.8 * fbm(across * 1.5, along * 0.25, sd + 1, 3);
        const fr = ph - Math.floor(ph);
        const prof = fr < 0.75 ? fr / 0.75 : (1 - fr) / 0.25;   // gentle stoss, steep lee
        d += w * (prof - 0.5) * Math.min(18, texel * 2.5) * (0.6 + 0.4 * fbm(across * 3, 0, sd + 2, 2));
      }
    }
    hm[i] = h + d;
  }
}

// ═══════════════ BRANCHED FLOW ═══════════════
// Rays through U = strength * V + gravity * height. V is a smooth random
// potential with correlation length corr. A ray turns by the part of -grad U
// across its direction (ray optics in a weak random medium). Many rays
// bunch into caustics: the branches. The density of visits is the channel.
function branchedFlow(o, nb, h01, seaQ, dlaInfo) {
  const s = subSeed(o.seed, 61), r = rng(subSeed(o.seed, 62));
  const corr = o.bfCorrelation * nb;           // in cells
  const N = nb * nb, V = new Float32Array(N);
  const f = 1 / corr;
  let m = 0, m2 = 0;
  for (let y = 0; y < nb; y++) for (let x = 0; x < nb; x++) {
    const v = gnoise(x * f, y * f, s) + 0.35 * gnoise(x * f * 2.1 + 5.5, y * f * 2.1 - 3.3, s + 1);
    V[y * nb + x] = v; m += v; m2 += v * v;
  }
  m /= N; const sd = Math.sqrt(Math.max(1e-9, m2 / N - m * m));
  const st = o.bfStrength, gr = o.bfGravity * 2.5;
  const U = new Float32Array(N);
  for (let i = 0; i < N; i++) U[i] = st * (V[i] - m) / sd + gr * h01[i];
  const Gx = new Float32Array(N), Gy = new Float32Array(N);
  for (let y = 0; y < nb; y++) for (let x = 0; x < nb; x++) {
    const i = y * nb + x;
    Gx[i] = (U[y * nb + Math.min(x + 1, nb - 1)] - U[y * nb + Math.max(x - 1, 0)]) * 0.5;
    Gy[i] = (U[Math.min(y + 1, nb - 1) * nb + x] - U[Math.max(y - 1, 0) * nb + x]) * 0.5;
  }
  const D = new Float32Array(N);
  const ds = 0.5, maxSteps = Math.round(nb * 2.5 / ds), deep = seaQ - 0.04;
  const trace = (x, y, dx, dy) => {
    for (let k = 0; k < maxSteps; k++) {
      if (x < 1 || y < 1 || x > nb - 2 || y > nb - 2) return;
      const ix = x | 0, iy = y | 0, tx = x - ix, ty = y - iy, i = iy * nb + ix;
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      const gx = Gx[i] * w00 + Gx[i + 1] * w10 + Gx[i + nb] * w01 + Gx[i + nb + 1] * w11;
      const gy = Gy[i] * w00 + Gy[i + 1] * w10 + Gy[i + nb] * w01 + Gy[i + nb + 1] * w11;
      const hh = h01[i];
      if (hh < deep) return;
      D[i] += w00; D[i + 1] += w10; D[i + nb] += w01; D[i + nb + 1] += w11;
      const dot = gx * dx + gy * dy;
      dx -= (gx - dot * dx) * ds; dy -= (gy - dot * dy) * ds;
      const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      x += dx * ds; y += dy * ds;
    }
  };
  const rays = o.bfRays;
  if (o.bfSource === 'edge') {
    const a = o.bfAngle * D2R, dx = Math.cos(a), dy = Math.sin(a);
    // start on the line through the centre across dir, behind the map
    const c = nb / 2, back = nb * 0.72;
    for (let k = 0; k < rays; k++) {
      const t = (k + 0.5) / rays - 0.5 + (r() - 0.5) * 0.2 / rays;
      let x = c - dx * back - dy * t * nb * 1.45, y = c - dy * back + dx * t * nb * 1.45;
      // move to the map edge
      for (let j = 0; j < nb * 2 && (x < 1 || y < 1 || x > nb - 2 || y > nb - 2); j++) { x += dx; y += dy; }
      trace(x, y, dx, dy);
    }
  } else {
    const fan = 24, srcs = Math.max(1, Math.round(rays / fan));
    let pts = [];
    if (o.bfSource === 'ridges' && dlaInfo && dlaInfo.count > 0) {
      const pos = dlaInfo.model.pos, { L, g } = dlaInfo, k = nb / g;
      for (let t = 0; t < srcs * 3 && pts.length < srcs; t++) {
        const i = Math.floor(r() * dlaInfo.count);
        if (L[i] < 2) continue;
        pts.push([(pos[i * 3] + g / 2) * k, (pos[i * 3 + 1] + g / 2) * k]);
      }
    }
    for (let t = 0; pts.length < srcs && t < srcs * 40; t++) {
      const x = 2 + r() * (nb - 4), y = 2 + r() * (nb - 4), hh = h01[(y | 0) * nb + (x | 0)];
      const land = (hh - seaQ) / (1 - seaQ);
      if (land > 0.15 && r() < land * 1.4) pts.push([x, y]);
    }
    for (const [x, y] of pts) {
      const a0 = r() * Math.PI * 2;
      for (let k = 0; k < fan; k++) { const a = a0 + k / fan * Math.PI * 2; trace(x, y, Math.cos(a), Math.sin(a)); }
    }
  }
  // log density, normalised by a high quantile, lightly blurred
  let mean = 0, cnt = 0;
  for (let i = 0; i < N; i++) if (D[i] > 0) { mean += D[i]; cnt++; }
  mean = cnt ? mean / cnt : 1;
  const C = new Float32Array(N);
  for (let i = 0; i < N; i++) C[i] = Math.log1p(D[i] / mean);
  const q = quantile(C, 0.995, 3) || 1;
  for (let i = 0; i < N; i++) C[i] = Math.min(1, C[i] / q);
  boxBlur(C, nb, 1, 1);
  return C;
}

// ═══════════════ PRIORITY FLOOD ═══════════════
// Barnes et al. 2014 with epsilon. outlet[i] = 1 for sea cells; the edge is
// always an outlet. Returns filled heights (Float64), the pop order (each
// cell after its receiver can come only later) and the outlet flags.
// cost (optional) scales epsilon per cell. Across a filled flat the fill
// is then a shortest-path surface in a random metric, so the flow lines
// wander (and follow the branched-flow channels) instead of running straight.
function priorityFlood(h, n, sea, eps, cost) {
  const N = n * n, filled = new Float64Array(N), closed = new Uint8Array(N), out = new Uint8Array(N);
  const order = new Int32Array(N), hk = new Float64Array(N + 1), hi = new Int32Array(N + 1);
  let hs = 0, oc = 0;
  const push = (i, k) => {
    let c = hs++;
    while (c > 0) { const p = (c - 1) >> 1; if (hk[p] <= k) break; hk[c] = hk[p]; hi[c] = hi[p]; c = p; }
    hk[c] = k; hi[c] = i;
  };
  const pop = () => {
    const top = hi[0], lk = hk[--hs], li = hi[hs];
    let c = 0;
    for (;;) {
      let l = 2 * c + 1; if (l >= hs) break;
      if (l + 1 < hs && hk[l + 1] < hk[l]) l++;
      if (hk[l] >= lk) break;
      hk[c] = hk[l]; hi[c] = hi[l]; c = l;
    }
    hk[c] = lk; hi[c] = li;
    return top;
  };
  for (let i = 0; i < N; i++) {
    const x = i % n, y = (i / n) | 0;
    if (x === 0 || y === 0 || x === n - 1 || y === n - 1 || h[i] < sea) {
      filled[i] = h[i]; closed[i] = 1; out[i] = 1; push(i, h[i]);
    }
  }
  const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
  while (hs > 0) {
    const c = pop(); order[oc++] = c;
    const fc = filled[c], x = c % n, y = (c / n) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k], ny = y + DY[k];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = ny * n + nx;
      if (closed[j]) continue;
      closed[j] = 1;
      const e = cost ? eps * cost[j] : eps;
      const v = h[j], f = v > fc + e ? v : fc + e;
      filled[j] = f; push(j, f);
    }
  }
  return { filled, order, outlet: out };
}

function flatCost(o, n, chan) {
  const c = new Float32Array(n * n), s = subSeed(o.seed, 64), f = 18 / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, ch = chan ? chan[i] : 0, v = fbm(x * f, y * f, s, 3, 0.55);
    c[i] = 0.25 + 2.2 * (1 - ch) * (1 - ch) + 1.6 * (0.5 + 0.5 * v) * (0.5 + 0.5 * v);
  }
  return c;
}

// Steepest-descent receivers on the filled surface, and rain-weighted
// accumulation (area in cells times the rain weight).
const DXS = [1, -1, 0, 0, 1, 1, -1, -1], DYS = [0, 0, 1, -1, 1, -1, 1, -1];
const DIST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
function routeD8(f, n, pf, rain, out) {
  const N = n * n, rec = out ? out.rec : new Int32Array(N), rd = out ? out.rd : new Float32Array(N);
  const acc = out ? out.acc : new Float32Array(N);
  for (let i = 0; i < N; i++) {
    rec[i] = -1; rd[i] = 1;
    if (pf.outlet[i]) continue;
    const x = i % n, y = (i / n) | 0, fi = f[i];
    let best = -1, bs = 0, bd = 1;
    for (let k = 0; k < 8; k++) {
      const nx = x + DXS[k], ny = y + DYS[k];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = ny * n + nx, s = (fi - f[j]) / DIST[k];
      if (s > bs) { bs = s; best = j; bd = DIST[k]; }
    }
    rec[i] = best; rd[i] = bd;
  }
  for (let i = 0; i < N; i++) acc[i] = rain ? rain[i] : 1;
  const ord = pf.order;
  for (let k = N - 1; k >= 0; k--) { const i = ord[k], r = rec[i]; if (r >= 0) acc[r] += acc[i]; }
  return { rec, rd, acc };
}

// ═══════════════ EROSION ═══════════════
function thermalPass(h, n, talusDrop, rate) {
  const td = talusDrop, tdd = talusDrop * Math.SQRT2;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (x + 1 < n) mv(i, i + 1, td);
      if (y + 1 < n) {
        mv(i, i + n, td);
        if (x + 1 < n) mv(i, i + n + 1, tdd);
        if (x > 0) mv(i, i + n - 1, tdd);
      }
    }
  }
  function mv(a, b, t) {
    const d = h[a] - h[b];
    if (d > t) { const m = (d - t) * 0.25 * rate; h[a] -= m; h[b] += m; }
    else if (-d > t) { const m = (-d - t) * 0.25 * rate; h[a] += m; h[b] -= m; }
  }
}

// Stream power + deposition on the erosion grid. h Float64 (m), modified.
async function erodeGrid(o, ne, h, rain, chan, sea, dx, emit) {
  const N = ne * ne, iters = o.erosionIters;
  const cost = flatCost(o, ne, chan);
  const m = o.mExp;
  // F = K A^m / d, A in cells of a 512 grid, so the look does not depend on ne
  const aScale = (512 / ne) ** 2;
  const K = 0.15 * Math.pow(o.erosionStrength * 2, 1.5) * Math.pow(aScale, m) * Math.pow(800, 0.45 - m);
  const hard = new Float32Array(N);
  const aC = 24 / aScale;   // channel head: smaller areas are hillslope
  const layers = o.strataLayers, sStr = o.strata, s = subSeed(o.seed, 71);
  const hmin = -o.heightScale * 0.4, hspan = o.heightScale * 1.4;
  const sed = new Float32Array(N), seaSed = new Float32Array(N), qs = new Float64Array(N), before = new Float64Array(N);
  const talus = Math.tan(o.talus * D2R) * dx;
  const G = o.deposition * 1.2, fanSlope = Math.tan(1.2 * D2R) * dx;
  const route = { rec: new Int32Array(N), rd: new Float32Array(N), acc: new Float32Array(N) };
  for (let it = 0; it < iters; it++) {
    const pf = priorityFlood(h, ne, sea, 1e-3, cost);
    for (let i = 0; i < N; i++) { if (pf.filled[i] > h[i]) sed[i] += pf.filled[i] - h[i]; h[i] = pf.filled[i]; }
    const { rec, rd, acc } = routeD8(h, ne, pf, rain, route);
    // hardness: soft between hard bands; the bands are wavy
    if (sStr > 0) {
      for (let i = 0; i < N; i++) {
        const x = i % ne, y = (i / ne) | 0;
        const z = (h[i] - hmin) / hspan * layers * 2 + 0.35 * fbm(x / ne * 3, y / ne * 3, s, 2);
        const band = 0.5 + 0.5 * Math.cos(z * Math.PI);
        hard[i] = 1 / (1 + sStr * 9 * smoothstep(0.55, 0.8, band));
      }
    }
    for (let i = 0; i < N; i++) before[i] = h[i];
    const ord = pf.order;
    for (let k = 0; k < N; k++) {
      const i = ord[k], r = rec[i];
      if (r < 0) continue;
      const ae = acc[i] - aC;
      if (ae <= 0) continue;
      let F = K * Math.pow(ae, m) / rd[i];
      if (chan) F *= 1 + o.bfCarve * 2.5 * chan[i];
      if (sStr > 0) F *= hard[i];
      const hr = h[r];
      if (h[i] > hr) h[i] = (h[i] + F * hr) / (1 + F);
    }
    // sediment: flux down the tree, settles where the slope is low
    qs.fill(0);
    for (let k = N - 1; k >= 0; k--) {
      const i = ord[k], r = rec[i];
      qs[i] += Math.max(0, before[i] - h[i]);
      if (r < 0) { if (h[i] < sea) seaSed[i] += qs[i]; continue; }
      if (G > 0) {
        let dep = G * qs[i] / acc[i];
        const lim = h[r] + fanSlope * rd[i] - h[i];
        if (dep > lim) dep = lim > 0 ? lim : 0;
        if (dep > 0) { h[i] += dep; sed[i] += dep; qs[i] -= dep; }
      }
      qs[r] += qs[i];
    }
    if (o.thermalIters > 0) thermalPass(h, ne, talus, 0.8);
    if (emit && (it % Math.max(1, Math.round(iters / 5)) === iters % Math.max(1, Math.round(iters / 5)) || it === iters - 1)) await emit(it + 1, iters);
  }
  return { sed, seaSed };
}

// Deltas: the sediment that reached the sea spreads from each mouth over the
// sea floor. The front moves out fastest along strong branched-flow channels,
// so a delta grows lobes; channel lines stay below the sea as distributaries.
function buildDeltas(o, n, h, seaSed, chan, sea, dx) {
  if (o.deltas <= 0) return null;
  const N = n * n, dep = new Float32Array(N);
  const mouths = [];
  for (let i = 0; i < N; i++) if (seaSed[i] > 0) mouths.push(i);
  mouths.sort((a, b) => seaSed[b] - seaSed[a]);
  const top = Math.min(mouths.length, 400);
  const visited = new Int32Array(N).fill(-1);
  const hk = [], hi = [];
  const r = rng(subSeed(o.seed, 81));
  for (let mI = 0; mI < top; mI++) {
    const m0 = mouths[mI];
    let vol = seaSed[m0] * o.deltas * 1.5;
    if (vol < 2) break;
    // Dijkstra-like growth over sea cells
    hk.length = 0; hi.length = 0;
    hk.push(0); hi.push(m0);
    let steps = 0;
    while (hk.length && vol > 0 && steps < 6000) {
      // pop the min (small arrays: linear scan is fine)
      let bi = 0;
      for (let k = 1; k < hk.length; k++) if (hk[k] < hk[bi]) bi = k;
      const d = hk[bi], c = hi[bi];
      hk[bi] = hk[hk.length - 1]; hi[bi] = hi[hi.length - 1]; hk.pop(); hi.pop();
      if (visited[c] === mI) continue;
      visited[c] = mI; steps++;
      const ch = chan ? chan[c] : 0;
      const targ = sea + 0.7 - d * dx * 0.00035 - ch * 1.6;
      const need = targ - h[c];
      if (need > 0) { const put = Math.min(need, vol); h[c] += put; dep[c] += put; vol -= put; }
      const x = c % n, y = (c / n) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + DXS[k], ny = y + DYS[k];
        if (nx < 1 || ny < 1 || nx >= n - 1 || ny >= n - 1) continue;
        const j = ny * n + nx;
        if (visited[j] === mI || h[j] >= sea + 0.5) continue;
        const cj = chan ? chan[j] : 0;
        hk.push(d + DIST[k] * (1.4 - 1.2 * cj) * (0.8 + 0.4 * r())); hi.push(j);
      }
      if (hk.length > 4000) { hk.length = 4000; hi.length = 4000; }
    }
  }
  return dep;
}

// Particle hydraulic erosion (rain droplets), on the full grid in metres.
function dropletErosion(o, n, h, texel, count) {
  if (count <= 0) return;
  const r = rng(subSeed(o.seed, 91));
  const inertia = 0.05, capK = 4, erodeK = 0.3, depK = 0.3, evap = 0.02, grav = 4, minSlope = 0.01;
  const inv = 1 / texel; // heights in cell units inside the loop
  for (let d = 0; d < count; d++) {
    let x = 1 + r() * (n - 3), y = 1 + r() * (n - 3), dx = 0, dy = 0, sp = 1, water = 1, sed = 0;
    for (let s = 0; s < 48; s++) {
      const ix = x | 0, iy = y | 0, i = iy * n + ix, fx = x - ix, fy = y - iy;
      const h00 = h[i] * inv, h10 = h[i + 1] * inv, h01 = h[i + n] * inv, h11 = h[i + n + 1] * inv;
      const gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy, gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
      const hOld = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
      dx = dx * inertia - gx * (1 - inertia); dy = dy * inertia - gy * (1 - inertia);
      const l = Math.hypot(dx, dy);
      if (l < 1e-9) break;
      dx /= l; dy /= l;
      const nx = x + dx, ny = y + dy;
      if (nx < 1 || ny < 1 || nx > n - 2 || ny > n - 2) break;
      const jx = nx | 0, jy = ny | 0, j = jy * n + jx, tx = nx - jx, ty = ny - jy;
      const hNew = (h[j] * (1 - tx) * (1 - ty) + h[j + 1] * tx * (1 - ty) + h[j + n] * (1 - tx) * ty + h[j + n + 1] * tx * ty) * inv;
      const dh = hNew - hOld;
      const cap = Math.max(-dh, minSlope) * sp * water * capK;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      if (sed > cap || dh > 0) {
        const put = dh > 0 ? Math.min(dh, sed) : (sed - cap) * depK;
        sed -= put;
        const pm = put * texel;
        h[i] += pm * w00; h[i + 1] += pm * w10; h[i + n] += pm * w01; h[i + n + 1] += pm * w11;
      } else {
        const take = Math.min((cap - sed) * erodeK, -dh);
        sed += take;
        const tm = take * texel;
        h[i] -= tm * w00; h[i + 1] -= tm * w10; h[i + n] -= tm * w01; h[i + n + 1] -= tm * w11;
      }
      sp = Math.sqrt(Math.max(0, sp * sp + dh * grav));
      water *= 1 - evap;
      x = nx; y = ny;
    }
  }
}

// ═══════════════ RIVER NETWORK ═══════════════
// Lakes, carved beds, river mask, water depth and river polylines on the
// full grid. hm (m) is modified: small pits are filled, beds are cut.
function hydrology(o, n, hm, rain, sea, texel, origin, chan) {
  const N = n * n, cellKm2 = (texel / 1000) ** 2;
  const pf = priorityFlood(hm, n, sea, 1e-3, flatCost(o, n, chan));
  const f = pf.filled;
  // lakes: connected cells under the spill level, large and deep enough
  const lakeId = new Int32Array(N).fill(-1);
  const lakes = [];
  const minCells = Math.max(16, Math.round(N * 2.5e-5)), stack = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    if (lakeId[i] !== -1 || f[i] - hm[i] < 0.05 || pf.outlet[i]) continue;
    let sp = 0, cnt = 0, sx = 0, sy = 0, mxd = 0, lvl = 0;
    stack[sp++] = i; lakeId[i] = -2;
    const cells = [];
    while (sp) {
      const c = stack[--sp]; cells.push(c); cnt++;
      const x = c % n, y = (c / n) | 0; sx += x; sy += y;
      const dd = f[c] - hm[c]; if (dd > mxd) mxd = dd; if (f[c] > lvl) lvl = f[c];
      for (let k = 0; k < 4; k++) {
        const nx = x + DXS[k], ny = y + DYS[k];
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const j = ny * n + nx;
        if (lakeId[j] !== -1 || f[j] - hm[j] < 0.05 || pf.outlet[j]) continue;
        lakeId[j] = -2; stack[sp++] = j;
      }
    }
    const keep = o.lakes && cnt >= minCells && mxd > 1.5;
    const id = keep ? lakes.length : -3;
    for (const c of cells) lakeId[c] = id;
    if (keep) lakes.push({ level: lvl, x: origin + (sx / cnt + 0.5) * texel, z: origin + (sy / cnt + 0.5) * texel, area: cnt * texel * texel, depth: mxd, cells: cnt });
  }
  // fill the pits that are not lakes; lake beds keep their height
  for (let i = 0; i < N; i++) if (lakeId[i] < 0 && f[i] > hm[i]) hm[i] = f[i];
  const rt = routeD8(f, n, pf, rain);
  const { rec, rd, acc } = rt;
  const flow = new Float32Array(N);
  for (let i = 0; i < N; i++) flow[i] = acc[i] * cellKm2;
  // river threshold: a part of the map area, more rivers with density
  const thr = N * Math.pow(10, -1.55 - 2.2 * o.riverDensity);
  const isRiver = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (acc[i] >= thr && hm[i] >= sea && lakeId[i] < 0 && !(pf.outlet[i] && hm[i] < sea)) isRiver[i] = 1;
  const width = (q) => o.riverWidth * (2 + 3.2 * Math.sqrt(q));
  const depthOf = (q) => o.riverDepth * 2 * (0.5 + Math.pow(q, 0.33));
  // carve beds from the mouth up: each bed is above its receiver's bed
  const hOrig = Float32Array.from(hm);
  const bed = new Float32Array(N);
  const ord = pf.order;
  for (let k = 0; k < N; k++) {
    const i = ord[k];
    if (!isRiver[i]) continue;
    const r = rec[i];
    let base;
    if (r < 0) base = Math.min(hm[i], sea) - 0.5;
    else if (isRiver[r]) base = bed[r];
    else if (lakeId[r] >= 0) base = lakes[lakeId[r]].level - 0.5;
    else base = Math.min(hm[r], f[r]);
    const b = Math.max(base + 1e-3 * rd[i], hm[i] - depthOf(flow[i]));
    bed[i] = Math.min(b, hm[i]);
    if (bed[i] < base) bed[i] = base + 1e-3 * rd[i];
    hm[i] = bed[i];
  }
  // banks and the soft mask, water depth
  const river = new Float32Array(N), water = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (hm[i] < sea) water[i] = sea - hm[i];
    else if (lakeId[i] >= 0) water[i] = Math.max(0, lakes[lakeId[i]].level - hm[i]);
  }
  for (let i = 0; i < N; i++) {
    if (!isRiver[i]) continue;
    const q = flow[i], w = width(q), rpx = w / 2 / texel, dep = Math.max(0.3, (hOrig[i] - bed[i]) * 0.8);
    river[i] = Math.max(river[i], clamp(w / texel, 0.35, 1));
    water[i] = Math.max(water[i], dep);
    if (rpx < 0.7) continue;
    const x = i % n, y = (i / n) | 0, R = Math.ceil(rpx + 1);
    for (let yy = Math.max(0, y - R); yy <= Math.min(n - 1, y + R); yy++) {
      for (let xx = Math.max(0, x - R); xx <= Math.min(n - 1, x + R); xx++) {
        const j = yy * n + xx;
        if (isRiver[j] || lakeId[j] >= 0 || hm[j] < sea) continue;
        const d = Math.hypot(xx - x, yy - y);
        if (d > rpx + 1) continue;
        const t = clamp(d / (rpx + 1), 0, 1);
        const target = bed[i] + t * t * Math.max(0, hOrig[i] - bed[i]) + t * 0.5;
        if (target < hm[j]) hm[j] = target;
        const mv = 1 - smoothstep(rpx - 0.5, rpx + 0.5, d);
        if (mv > river[j]) river[j] = mv;
        if (mv > 0.5) water[j] = Math.max(water[j], dep * (1 - t * t));
      }
    }
  }
  // polylines: from each source down to the sea, a lake, the edge or a join
  const hasDonor = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (isRiver[i] && rec[i] >= 0) hasDonor[rec[i]] = 1;
  const sources = [];
  for (let i = 0; i < N; i++) if (isRiver[i] && !hasDonor[i]) sources.push(i);
  sources.sort((a, b) => hm[b] - hm[a]);
  const visited = new Uint8Array(N);
  const rivers = [];
  const toW = (c) => origin + (c + 0.5) * texel;
  for (const s0 of sources) {
    const path = [];
    let c = s0, end = 'edge';
    for (;;) {
      path.push(c);
      if (visited[c]) { end = 'join'; break; }
      visited[c] = 1;
      const r = rec[c];
      if (r < 0) { end = hm[c] < sea + 0.5 ? 'sea' : 'edge'; break; }
      if (!isRiver[r]) {
        path.push(r);
        end = lakeId[r] >= 0 ? 'lake' : (hm[r] < sea ? 'sea' : (pf.outlet[r] ? 'edge' : 'join'));
        break;
      }
      c = r;
    }
    if (path.length < 4) continue;
    const L = path.length, pts = new Float32Array(L * 2), wid = new Float32Array(L), fl = new Float32Array(L);
    for (let k = 0; k < L; k++) {
      const q = path[k];
      pts[k * 2] = toW(q % n); pts[k * 2 + 1] = toW((q / n) | 0);
      fl[k] = flow[q]; wid[k] = width(flow[q]);
    }
    // light smoothing of the inner points (1-2-1), ends stay on their texels
    if (L > 2) {
      const sm = Float32Array.from(pts);
      for (let k = 1; k < L - 1; k++) {
        sm[k * 2] = 0.25 * pts[k * 2 - 2] + 0.5 * pts[k * 2] + 0.25 * pts[k * 2 + 2];
        sm[k * 2 + 1] = 0.25 * pts[k * 2 - 1] + 0.5 * pts[k * 2 + 1] + 0.25 * pts[k * 2 + 3];
      }
      pts.set(sm);
    }
    rivers.push({ pts, width: wid, flow: fl, end, cells: Int32Array.from(path) });
  }
  return { flow, river, water, rivers, lakes, lakeId, isRiver, rec, acc, thr };
}

// ═══════════════ CLIMATE ═══════════════
// Orographic sweep: air moves along the wind one slice at a time; it takes
// water from the sea and loses it as rain, more where the ground rises.
function precipSweep(o, nc, hc, sea, dxm) {
  const N = nc * nc, P = new Float32Array(N), q = new Float32Array(N);
  const a = o.windAngle * D2R, wx = Math.cos(a), wz = Math.sin(a);
  const major = Math.abs(wx) >= Math.abs(wz) ? 0 : 1;
  const sgn = major === 0 ? Math.sign(wx) || 1 : Math.sign(wz) || 1;
  const minor = major === 0 ? wz / Math.abs(wx) : wx / Math.abs(wz); // minor shift per slice
  const q0 = 0.3 + 0.9 * o.rainfall, oro = o.rainShadow * 30, base = 0.012 + 0.03 * (1 - o.rainShadow);
  const stepLen = Math.hypot(1, minor) * dxm;
  for (let s = 0; s < nc; s++) {
    const sl = sgn > 0 ? s : nc - 1 - s, prev = sl - sgn;
    for (let t = 0; t < nc; t++) {
      const i = major === 0 ? t * nc + sl : sl * nc + t;
      let qa, ha;
      if (prev < 0 || prev >= nc) { qa = q0; ha = hc[i]; }
      else {
        let u = t - minor; if (u < 0) u = 0; if (u > nc - 1) u = nc - 1;
        const u0 = Math.floor(u), u1 = Math.min(u0 + 1, nc - 1), f = u - u0;
        const j0 = major === 0 ? u0 * nc + prev : prev * nc + u0, j1 = major === 0 ? u1 * nc + prev : prev * nc + u1;
        qa = q[j0] * (1 - f) + q[j1] * f; ha = hc[j0] * (1 - f) + hc[j1] * f;
      }
      const h = hc[i];
      if (h < sea) { q[i] = qa + (q0 * 1.1 - qa) * 0.05; P[i] = qa * 0.02; continue; }
      const rise = Math.max(0, (h - ha) / stepLen);
      const cool = 1 + Math.max(0, h) / 2500;    // high, cold air holds less
      let rain = qa * (base + oro * rise) * cool;
      if (rain > qa * 0.6) rain = qa * 0.6;
      P[i] = rain; q[i] = qa - rain * 0.9 + 0.004 * (q0 - qa);
    }
  }
  return P;
}
function distanceField(src, n) {
  // two-pass chamfer distance in cells from src cells (src[i] = 1)
  const N = n * n, d = new Float32Array(N), BIG = 1e9, D1 = 1, D2 = Math.SQRT2;
  for (let i = 0; i < N; i++) d[i] = src[i] ? 0 : BIG;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x; let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + D1);
    if (y > 0) { v = Math.min(v, d[i - n] + D1); if (x > 0) v = Math.min(v, d[i - n - 1] + D2); if (x < n - 1) v = Math.min(v, d[i - n + 1] + D2); }
    d[i] = v;
  }
  for (let y = n - 1; y >= 0; y--) for (let x = n - 1; x >= 0; x--) {
    const i = y * n + x; let v = d[i];
    if (x < n - 1) v = Math.min(v, d[i + 1] + D1);
    if (y < n - 1) { v = Math.min(v, d[i + n] + D1); if (x < n - 1) v = Math.min(v, d[i + n + 1] + D2); if (x > 0) v = Math.min(v, d[i + n - 1] + D2); }
    d[i] = v;
  }
  return d;
}
// Sea-level temperature by latitude (deg), C.
const seaTemp = (lat) => 28 - 0.0058 * lat * lat;
function climate(o, n, hm, sea, hy, texel) {
  const N = n * n, nc = Math.min(256, n), dxm = o.worldSize / nc;
  const hc = downsample(hm, n, nc);
  const P = precipSweep(o, nc, hc, sea, dxm);
  boxBlur(P, nc, 1, 2);
  // water nearness
  const wsrc = new Uint8Array(nc * nc), ssrc = new Uint8Array(nc * nc), k = n / nc;
  for (let i = 0; i < N; i++) {
    const x = i % n, y = (i / n) | 0, c = ((y / k) | 0) * nc + ((x / k) | 0);
    if (hy.isRiver[i] && hy.flow[i] > 0.5 || hy.lakeId[i] >= 0) wsrc[c] = 1;
    if (hm[i] < sea) ssrc[c] = 1;
  }
  const dw = distanceField(wsrc, nc), dsea = distanceField(ssrc, nc);
  let pRef = 0;
  for (let i = 0; i < nc * nc; i++) if (hc[i] >= sea && P[i] > pRef) pRef = P[i];
  pRef = Math.max(1e-4, quantile(P, 0.97) * 0.9 + pRef * 0.1);
  const Mc = new Float32Array(nc * nc);
  for (let i = 0; i < nc * nc; i++) {
    const wn = Math.exp(-dw[i] * dxm / 1500), sn = Math.exp(-dsea[i] * dxm / 4000);
    Mc[i] = clamp(0.08 + 0.85 * Math.sqrt(P[i] / pRef) * (0.4 + 0.8 * o.rainfall) + 0.22 * wn + 0.12 * sn, 0, 1);
  }
  const moisture = resample(Mc, nc, n);
  const temperature = new Float32Array(N);
  const lat0 = o.latitude, span = o.latitudeSpan, lapse = o.lapseRate / 1000;
  for (let y = 0; y < n; y++) {
    const lat = lat0 + span * (0.5 - (y + 0.5) / n);
    const ts = seaTemp(lat) + o.baseTemp;
    for (let x = 0; x < n; x++) {
      const i = y * n + x, h = hm[i];
      temperature[i] = ts - lapse * Math.max(0, h - Math.max(sea, 0));
      if (hy.river[i] > 0.3) moisture[i] = Math.max(moisture[i], 0.75);
    }
  }
  return { moisture, temperature };
}

// ═══════════════ BIOMES ═══════════════
function classifyBiomes(o, n, hm, sea, texel, hy, cl, sed) {
  const N = n * n, biome = new Uint8Array(N);
  const { moisture: M, temperature: Tm } = cl;
  const s = subSeed(o.seed, 101);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, h = hm[i];
    if (h < sea) { biome[i] = B.ocean; continue; }
    if (hy.lakeId[i] >= 0 && hy.water[i] > 0.2) { biome[i] = B.lake; continue; }
    if (hy.river[i] > 0.5) { biome[i] = B.river; continue; }
    const xl = Math.max(0, x - 1), xr = Math.min(n - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(n - 1, y + 1);
    const gx = (hm[y * n + xr] - hm[y * n + xl]) / ((xr - xl) * texel), gz = (hm[yd * n + x] - hm[yu * n + x]) / ((yd - yu) * texel);
    const slope = Math.atan(Math.hypot(gx, gz)) / D2R;
    const T = Tm[i], Mo = M[i];
    const jit = 0.06 * gnoise(x * 0.07, y * 0.07, s);
    const above = h - Math.max(sea, 0);
    if (sea > -50 && above < 3 + 4 * (1 - smoothstep(2, 8, slope)) && slope < 8) {
      // near the sea and low: beach, or wetland where it is wet and flat
      if (Mo > 0.72 && slope < 2 && (sed ? sed[i] > 0.3 : false)) { biome[i] = B.wetland; continue; }
      biome[i] = B.beach; continue;
    }
    if (T < -6 + 3 * jit * 10 || (T < -1.5 && slope < 35 && Mo > 0.35)) { biome[i] = slope > 45 ? B['bare-rock'] : B.snow; continue; }
    if (slope > 42 + 6 * jit * 10) { biome[i] = B['bare-rock']; continue; }
    if (slope > 31 + 5 * jit * 10) { biome[i] = T < 2 ? B['bare-rock'] : B.scree; continue; }
    if (Mo > 0.78 + jit && slope < 3 && T > 0) { biome[i] = B.wetland; continue; }
    if (T < 1.5) { biome[i] = Mo > 0.45 && slope < 25 ? B['alpine-meadow'] : B.tundra; continue; }
    if (T < 4.5 && above > 0.45 * o.heightScale) { biome[i] = Mo > 0.35 ? B['alpine-meadow'] : B.tundra; continue; }
    const m = Mo + jit;
    if (T < 6) { biome[i] = m > 0.4 ? B['boreal-forest'] : B.tundra; continue; }
    if (m < 0.2) { biome[i] = B.desert; continue; }
    if (T > 21) { biome[i] = m > 0.68 ? B.rainforest : m > 0.42 ? B['temperate-forest'] : B.savanna; continue; }
    if (T < 10) { biome[i] = m > 0.42 ? B['boreal-forest'] : B.grassland; continue; }
    biome[i] = m > 0.48 ? B['temperate-forest'] : m > 0.28 ? B.grassland : (T > 16 ? B.savanna : B.grassland);
  }
  return biome;
}

// Ridge polylines from the final DLA tree: chains of particles with a long
// way to their leaves (the trunks and big branches).
function ridgeLines(dla, worldSize) {
  const { model: m, count, L, g } = dla;
  const P = m.pos, Pa = m.parent, k = worldSize / g;
  let mx = 0;
  for (let i = 0; i < count; i++) if (L[i] > mx) mx = L[i];
  const minL = Math.max(6, mx * 0.12);
  const used = new Uint8Array(count), out = [];
  // children counts to find chain starts: a big node whose big children are none
  const bigChild = new Uint8Array(count);
  for (let i = 0; i < count; i++) if (L[i] >= minL && Pa[i] >= 0) bigChild[Pa[i]] = 1;
  for (let i = count - 1; i >= 0; i--) {
    if (L[i] < minL || bigChild[i] || used[i]) continue;
    const pts = [];
    let c = i;
    while (c >= 0) {
      pts.push(P[c * 3] * k, P[c * 3 + 1] * k);
      if (used[c]) break;
      used[c] = 1;
      c = Pa[c];
    }
    if (pts.length >= 8) out.push({ pts: Float32Array.from(pts) });
  }
  return out;
}

// ═══════════════ DETAIL (JS twin of lib/dla-terrain-detail.wgsl) ═══════════════
// The relief below one texel. Gradient noise on lattices of texel / 2^k
// (k = 0..4), anchored at the texel grid, so the integer cell index is exact
// in f32 and in f64. Ridged where the slope is steep, smooth on gentle
// ground, zero on river beds and under water. The masks come from the four
// texels around the point (bilinear), so the function has no seams.
//   slope   from tHeight central differences at the four corner texels
//   river   tAux.g, water depth tAux.a, at the four corner texels
// Keep this function and dla-terrain-detail.wgsl in step: the check tool
// compares them on the GPU.
function pcg(v) {
  const s = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> (((s >>> 28) + 4) >>> 0)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}
function dHash(ix, iy, k) { return pcg((ix >>> 0) ^ pcg(((iy >>> 0) + Math.imul(k, 0x9E3779B9)) >>> 0)); }
// one octave of gradient noise at integer cell (cx, cy) and fraction (fx, fy)
function dNoise(cx, cy, fx, fy, k) {
  const g = (h, ox, oy) => {
    const gx = (h & 0xffff) / 32767.5 - 1, gy = (h >>> 16) / 32767.5 - 1;
    return gx * (fx - ox) + gy * (fy - oy);
  };
  const a = g(dHash(cx, cy, k), 0, 0), b = g(dHash(cx + 1, cy, k), 1, 0);
  const c = g(dHash(cx, cy + 1, k), 0, 1), d = g(dHash(cx + 1, cy + 1, k), 1, 1);
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}
const DETAIL_OCT = 5;
// t: a Terrain (or TerrainGPU with t.cpu). x, z world metres. Returns metres.
export function detailHeight(x, z, t) {
  if (t && t.cpu) t = t.cpu;
  const n = t.n, texel = t.worldSize / n, origin = -t.worldSize / 2;
  const H = t.height, river = t.river, water = t.water;
  let px = (x - origin) / texel - 0.5, pz = (z - origin) / texel - 0.5;
  px = clamp(px, 0, n - 1); pz = clamp(pz, 0, n - 1);
  const ix = Math.min(Math.floor(px), n - 2), iz = Math.min(Math.floor(pz), n - 2);
  const fx = px - ix, fz = pz - iz;
  const L = (i, j) => H[clamp(j, 0, n - 1) * n + clamp(i, 0, n - 1)];
  const slopeAt = (i, j) => {
    const gx = L(i + 1, j) - L(i - 1, j), gz = L(i, j + 1) - L(i, j - 1);
    return Math.hypot(gx, gz) / (2 * texel);
  };
  const bil = (a, b, c, d) => lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
  const s = bil(slopeAt(ix, iz), slopeAt(ix + 1, iz), slopeAt(ix, iz + 1), slopeAt(ix + 1, iz + 1));
  const A = (arr, i, j) => arr[j * n + i];
  const rv = bil(A(river, ix, iz), A(river, ix + 1, iz), A(river, ix, iz + 1), A(river, ix + 1, iz + 1));
  const wd = bil(A(water, ix, iz), A(water, ix + 1, iz), A(water, ix, iz + 1), A(water, ix + 1, iz + 1));
  const steep = smoothstep(0.3, 1.1, s);
  const flat = (1 - smoothstep(0.05, 0.6, rv)) * (1 - smoothstep(0.0, 1.5, wd));
  if (flat <= 0) return 0;
  let sum = 0;
  for (let k = 0; k < DETAIL_OCT; k++) {
    const sc = 1 << k;
    const qx = fx * sc, qz = fz * sc, flx = Math.floor(qx), flz = Math.floor(qz);
    const v = dNoise(ix * sc + flx, iz * sc + flz, qx - flx, qz - flz, k);
    const ridged = 0.55 - Math.abs(v) * 1.6;
    const lam = texel / sc;
    sum += lam * lerp(0.035 * v, 0.07 * ridged, steep);
  }
  return sum * (0.35 + 0.65 * steep) * flat;
}

// Bilinear height (m) at world x, z, texel centres as in the header.
export function sampleHeight(t, x, z) {
  if (t && t.cpu) t = t.cpu;
  const n = t.n, texel = t.worldSize / n, origin = -t.worldSize / 2;
  return bilinear(t.height, n, (x - origin) / texel - 0.5, (z - origin) / texel - 0.5);
}
export function terrainHeightAt(t, x, z) { return sampleHeight(t, x, z) + detailHeight(x, z, t); }

// ═══════════════ MAIN ENTRY ═══════════════
const STAGES = [
  ['dla', 'DLA growth', 0.2], ['upscale', 'Upscale', 0.06], ['shape', 'Shape', 0.08], ['flow', 'Branched flow', 0.08],
  ['rivers', 'Rivers', 0.05], ['erosion', 'Erosion', 0.43], ['climate', 'Climate', 0.05], ['biomes', 'Biomes', 0.05],
];
export const STAGE_IDS = STAGES.map((s) => s[0]);

export async function generateTerrain(opts = {}, onProgress = null) {
  const o = normalizeOptions(opts);
  const n = o.n, ws = o.worldSize, texel = ws / n, origin = -ws / 2;
  const stages = [];
  let curStage = 0, stageT0 = now();
  const base = (k) => STAGES.slice(0, k).reduce((a, s) => a + s[2], 0);
  const emitFor = (k) => async (sf, label, snapshot) => {
    if (!onProgress) return;
    const [id, , w] = STAGES[k];
    if (snapshot) { snapshot.worldSize = ws; if (snapshot.seaLevel == null) snapshot.seaLevel = seaM; }
    await onProgress({ stage: id, label, frac: clamp(base(k) + w * sf, 0, 1), stageFrac: clamp(sf, 0, 1), snapshot: snapshot || null });
  };
  const begin = (k) => { curStage = k; stageT0 = now(); };
  const end = () => { stages.push({ id: STAGES[curStage][0], label: STAGES[curStage][1], ms: Math.round(now() - stageT0) }); };
  let seaM = 0;
  const mask = makeMask(o, o.seed);

  // dla
  begin(0);
  const dla = await growDLA(o, n, mask, emitFor(0));
  end();

  // upscale
  begin(1);
  const ridge = await upscaleRidges(o, n, dla.levels, emitFor(1));
  end();

  // shape
  begin(2);
  const h01 = shapeField(o, n, ridge, mask);
  const hasSea = o.seaFraction > 0.005;
  let seaQ = hasSea ? quantile(h01, o.seaFraction, 7) : -1;
  sculpt(o, n, h01, hasSea ? seaQ : 0);
  if (hasSea) seaQ = quantile(h01, o.seaFraction, 7);
  // metres: land 0..heightScale above the sea, sea floor down to about -0.3 hs
  let hmax = -Infinity, hmin = Infinity;
  for (let i = 0; i < h01.length; i++) { if (h01[i] > hmax) hmax = h01[i]; if (h01[i] < hmin) hmin = h01[i]; }
  const hm = new Float32Array(n * n);
  const qq = hasSea ? seaQ : hmin;
  const landK = o.heightScale / Math.max(1e-6, hmax - qq), seaK = hasSea ? Math.min(landK, o.heightScale * 0.3 / Math.max(1e-6, qq - hmin)) : 0;
  for (let i = 0; i < hm.length; i++) {
    const t = h01[i] - qq;
    hm[i] = t >= 0 ? t * landK : t * seaK;
  }
  seaM = hasSea ? 0 : -100;
  microRelief(o, n, hm, seaM, texel);
  await emitFor(2)(1, 'Shaping land and sea', { n, height: Float32Array.from(hm), seaLevel: seaM });
  end();

  // flow
  begin(3);
  const nb = Math.min(n, 512);
  const hb = downsample(hm, n, nb);
  const hb01 = new Float32Array(nb * nb), seaB = hasSea ? 0 : -1e9;
  // normalised 0..1 copy for the ray potential: sea at seaQb
  let bmn = Infinity, bmx = -Infinity;
  for (let i = 0; i < hb.length; i++) { if (hb[i] < bmn) bmn = hb[i]; if (hb[i] > bmx) bmx = hb[i]; }
  for (let i = 0; i < hb.length; i++) hb01[i] = (hb[i] - bmn) / Math.max(1e-6, bmx - bmn);
  const seaQb = hasSea ? (0 - bmn) / Math.max(1e-6, bmx - bmn) : -1;
  let channel = null;
  if (o.bfOn) {
    const chB = branchedFlow(o, nb, hb01, seaQb, dla);
    channel = nb === n ? chB : resample(chB, nb, n);
    const cBlur = boxBlur(Float32Array.from(channel), n, Math.max(1, Math.round(n / 512)), 2);
    // cut valleys along the branches on land (shallow on the plains)
    const cut = o.bfCarve * 0.07 * o.heightScale;
    for (let i = 0; i < hm.length; i++) {
      const above = hm[i] - seaM;
      if (above <= 0) continue;
      const w = smoothstep(0, 0.15 * o.heightScale, above);
      hm[i] -= cut * Math.pow(cBlur[i], 0.8) * w;
    }
    await emitFor(3)(1, 'Tracing branched flow', { n, height: Float32Array.from(hm), channel: Float32Array.from(channel) });
  } else {
    await emitFor(3)(1, 'Branched flow is off', { n, height: Float32Array.from(hm) });
  }
  end();

  // rivers (on the erosion grid)
  begin(4);
  const ne = Math.min(n, 512), dxe = ws / ne;
  const he = new Float64Array(downsample(hm, n, ne));
  const he0 = Float64Array.from(he);
  const hc0 = downsample(hm, n, Math.min(256, n));
  const nc0 = Math.min(256, n);
  const Pc = precipSweep(o, nc0, hc0, seaM, ws / nc0);
  boxBlur(Pc, nc0, 1, 2);
  let pm = 0; for (let i = 0; i < Pc.length; i++) pm += Pc[i]; pm = pm / Pc.length || 1;
  for (let i = 0; i < Pc.length; i++) Pc[i] = clamp(0.25 + 0.75 * Pc[i] / pm, 0.15, 3);
  const rainE = resample(Pc, nc0, ne);
  const chanE = channel ? downsample(channel, n, ne) : null;
  {
    const pf = priorityFlood(he, ne, seaM, 1e-3, flatCost(o, ne, chanE));
    const rt = routeD8(pf.filled, ne, pf, rainE);
    const thr = ne * ne * Math.pow(10, -1.55 - 2.2 * o.riverDensity);
    const rv = new Float32Array(ne * ne), fl = new Float32Array(ne * ne);
    for (let i = 0; i < rv.length; i++) { fl[i] = rt.acc[i] * (dxe / 1000) ** 2; rv[i] = rt.acc[i] >= thr && he[i] >= seaM ? 1 : 0; }
    await emitFor(4)(1, 'Routing rain to rivers', { n: ne, height: Float32Array.from(he), flow: fl, river: rv });
  }
  end();

  // erosion
  begin(5);
  const emE = emitFor(5);
  const full = () => {
    const d = new Float32Array(ne * ne);
    for (let i = 0; i < d.length; i++) d[i] = he[i] - he0[i];
    const up = ne === n ? d : resample(d, ne, n);
    const out = new Float32Array(n * n);
    for (let i = 0; i < out.length; i++) out[i] = hm[i] + up[i];
    return out;
  };
  const er = await erodeGrid(o, ne, he, rainE, chanE, seaM, dxe, async (it, iters) => {
    await emE(0.75 * it / iters, `Eroding, pass ${it} of ${iters}`, { n, height: full() });
  });
  let deltaDep = null;
  if (hasSea) deltaDep = buildDeltas(o, ne, he, er.seaSed, chanE, seaM, dxe);
  {
    const d = new Float32Array(ne * ne);
    for (let i = 0; i < d.length; i++) d[i] = he[i] - he0[i];
    const up = ne === n ? d : resample(d, ne, n);
    for (let i = 0; i < hm.length; i++) hm[i] += up[i];
  }
  const sedE = er.sed;
  if (deltaDep) for (let i = 0; i < sedE.length; i++) sedE[i] += deltaDep[i];
  const sediment = ne === n ? Float32Array.from(sedE) : resample(sedE, ne, n);
  // full grid: talus and droplets
  if (o.thermalIters > 0) {
    const td = Math.tan(o.talus * D2R) * texel;
    for (let k = 0; k < Math.ceil(o.thermalIters / 2); k++) thermalPass(hm, n, td, 0.6);
  }
  if (o.droplets > 0) {
    await emE(0.8, 'Rain droplets', { n, height: Float32Array.from(hm) });
    dropletErosion(o, n, hm, texel, Math.round(o.droplets * (n / 1024) ** 2));
  }
  await emE(0.85, 'Carving rivers and lakes', { n, height: Float32Array.from(hm) });
  const rainF = resample(Pc, nc0, n);
  const hy = hydrology(o, n, hm, rainF, seaM, texel, origin, channel);
  await emE(1, 'Rivers and lakes', { n, height: Float32Array.from(hm), river: Float32Array.from(hy.river), water: Float32Array.from(hy.water), flow: Float32Array.from(hy.flow) });
  end();

  // climate
  begin(6);
  const cl = climate(o, n, hm, seaM, hy, texel);
  await emitFor(6)(1, 'Temperature and rain', { n, height: Float32Array.from(hm), moisture: Float32Array.from(cl.moisture), temperature: Float32Array.from(cl.temperature) });
  end();

  // biomes
  begin(7);
  const biome = classifyBiomes(o, n, hm, seaM, texel, hy, cl, sediment);
  end();

  // stats
  let mn = Infinity, mx = -Infinity, land = 0, px = 0, pz = 0;
  for (let i = 0; i < hm.length; i++) {
    const h = hm[i];
    if (h < mn) mn = h;
    if (h > mx) { mx = h; px = i % n; pz = (i / n) | 0; }
    if (h >= seaM) land++;
  }
  const bfr = new Array(16).fill(0);
  for (let i = 0; i < biome.length; i++) bfr[biome[i]]++;
  let rlen = 0;
  for (const r of hy.rivers) for (let k = 1; k < r.pts.length / 2; k++) rlen += Math.hypot(r.pts[k * 2] - r.pts[k * 2 - 2], r.pts[k * 2 + 1] - r.pts[k * 2 - 1]);
  const ridges = ridgeLines(dla, ws);
  const dpos = new Float32Array(dla.count * 2), kk = ws / dla.g;
  for (let i = 0; i < dla.count; i++) { dpos[i * 2] = dla.model.pos[i * 3] * kk; dpos[i * 2 + 1] = dla.model.pos[i * 3 + 1] * kk; }
  const lakes = hy.lakes.map(({ level, x, z, area, depth }) => ({ level, x, z, area, depth }));
  const rivers = hy.rivers.map(({ pts, width, flow, end, cells }) => ({ pts, width, flow, end, cells }));
  const totalMs = stages.reduce((a, s) => a + s.ms, 0);
  const stats = {
    minHeight: mn, maxHeight: mx, seaLevel: seaM, hasSea, landFraction: land / hm.length,
    peak: { x: origin + (px + 0.5) * texel, z: origin + (pz + 0.5) * texel, h: mx },
    riverCount: rivers.length, riverLengthKm: rlen / 1000, lakeCount: lakes.length,
    lakeAreaKm2: lakes.reduce((a, l) => a + l.area, 0) / 1e6, dlaParticles: dla.count,
    biomeFractions: bfr.map((c) => c / biome.length), ms: totalMs,
  };
  const terrain = {
    n, worldSize: ws, heightScale: o.heightScale, seaLevel: seaM, texel, origin,
    height: hm, flow: hy.flow, river: hy.river, water: hy.water, moisture: cl.moisture,
    temperature: cl.temperature, sediment, channel: channel || new Float32Array(n * n), biome,
    rivers, lakes, ridges, dla: { pos: dpos, parent: dla.model.parent.slice(0, dla.count), count: dla.count },
    stats, stages, opts: o,
  };
  if (onProgress) await onProgress({ stage: 'biomes', label: 'Done', frac: 1, stageFrac: 1, snapshot: { n, worldSize: ws, seaLevel: seaM, height: Float32Array.from(hm), biome: Uint8Array.from(biome), river: Float32Array.from(hy.river), water: Float32Array.from(hy.water) } });
  return terrain;
}

// The typed arrays of a Terrain, for a transfer list.
export function terrainTransferables(t) {
  const out = [];
  for (const k of ['height', 'flow', 'river', 'water', 'moisture', 'temperature', 'sediment', 'channel', 'biome']) if (t[k]) out.push(t[k].buffer);
  for (const r of t.rivers) out.push(r.pts.buffer, r.width.buffer, r.flow.buffer, r.cells.buffer);
  for (const r of t.ridges) out.push(r.pts.buffer);
  if (t.dla) out.push(t.dla.pos.buffer, t.dla.parent.buffer);
  return out;
}
