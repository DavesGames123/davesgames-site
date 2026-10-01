// ============================================================================
//  MATERIAL STUDIO  ·  nodes/bench/catalog.js — shared catalog state and library traits
// ────────────────────────────────────────────────────────────────────────────
//  The module state that every other bench file reads. catalog() loads the
//  Composition Bench catalog once (lib/bench-wgsl.js) and sets the live
//  binding CAT. DEFS is the type -> NodeDef map that loadBenchNodes fills.
//  LIB_TRAITS and the tile sets give the per-library defaults.
//
//  GREP TARGETS  (grep -n the name to jump)
//      BENCH_BASE / BENCH_PAGE / BENCH_HANDOFF_KEY
//      CAT / catalog
//      LIB_TRAITS / BENCH_NON_TILEABLE / BENCH_NON_TILEABLE_CELLS / BENCH_PERIODIC
//      TILE_MODES / VALUE_MODES / GEN_KINDS
//      DEFS / benchDef
// ============================================================================
import { loadBenchCatalog } from '../../../../lib/bench-wgsl.js';

/** URL of the composition-bench folder. */
export const BENCH_BASE = new URL('../../../composition-bench/', import.meta.url);
/** URL of the bench page (Open in Composition Bench). */
export const BENCH_PAGE = new URL('index.html', BENCH_BASE);
/** localStorage key of the one-shot graph hand-off to the bench page. */
export const BENCH_HANDOFF_KEY = 'composition-bench.import';

export let CAT = null;          // the loaded catalog (lib/bench-wgsl.js)
let catP = null;
/** The shared bench catalog. Resolves once; later calls reuse it. */
export function catalog() {
  if (!catP) catP = loadBenchCatalog(BENCH_BASE).then(c => (CAT = c));
  return catP;
}

/**
 * Per-library defaults. tile: the default tile mode. decode: 'srgb' for
 * display-referred image cells, 'raw' for data cells (noise, coordinates).
 * centered: the cells draw one subject in the middle (not a texture).
 * operator: the cell transforms its input image (it tiles if the input does).
 */
export const LIB_TRAITS = Object.freeze({
  noise:        { tile: 'seamless', decode: 'raw' },
  field:        { tile: 'none',     decode: 'raw' },
  sim:          { tile: 'repeat',   decode: 'srgb', periodic: true },
  dotfield:     { tile: 'seamless', decode: 'srgb' },
  polar:        { tile: 'none',     decode: 'srgb', centered: true },
  color:        { tile: 'none',     decode: 'srgb', operator: true },
  postfx:       { tile: 'none',     decode: 'srgb', operator: true },
  lighting:     { tile: 'none',     decode: 'srgb', centered: true },
  sampling:     { tile: 'seamless', decode: 'raw' },
  refraction:   { tile: 'none',     decode: 'srgb', operator: true, centered: true },
  solids:       { tile: 'none',     decode: 'srgb', centered: true },
  sdf2d:        { tile: 'none',     decode: 'srgb', centered: true },
  metal:        { tile: 'seamless', decode: 'srgb' },
  beam:         { tile: 'none',     decode: 'srgb', centered: true },
  fire:         { tile: 'none',     decode: 'srgb', centered: true },
  fire_evolved: { tile: 'none',     decode: 'srgb', centered: true },
  smoke:        { tile: 'none',     decode: 'srgb', centered: true },
  heat_haze:    { tile: 'none',     decode: 'srgb', operator: true },
  heat_metal:   { tile: 'repeat',   decode: 'srgb', periodic: true },
  frost:        { tile: 'seamless', decode: 'srgb' },
  orb:          { tile: 'none',     decode: 'srgb', centered: true },
});
/** Libraries whose cells draw one centered subject: they do not tile. */
export const BENCH_NON_TILEABLE = Object.freeze(Object.keys(LIB_TRAITS).filter(k => LIB_TRAITS[k].centered));
/**
 * Cells in a tiling library that still draw a framed subject or a
 * non-periodic field, so 'seamless' or 'repeat' leaves a hard seam at the
 * texture edge. Their default tile mode is 'none'. Found by an edge test:
 * the wrap-edge texel difference was 5x to 40x the neighbor difference.
 */
export const BENCH_NON_TILEABLE_CELLS = Object.freeze(new Set([
  'heat_metal.rolled', 'frost.chill_drain', 'frost.sweat_wet', 'frost.hoar_dust',
  'frost.decal_vs_crust', 'frost.inner_surface', 'frost.lod_levels', 'sim.sand',
]));
/** Libraries that are periodic by construction (wrapped simulation grids). */
export const BENCH_PERIODIC = Object.freeze(Object.keys(LIB_TRAITS).filter(k => LIB_TRAITS[k].periodic));

export const TILE_MODES = ['none', 'seamless', 'mirror', 'repeat'];
export const VALUE_MODES = ['luma', 'alpha', 'red', 'max'];
export const GEN_KINDS = ['transform', 'warp', 'displace', 'blend', 'map'];

export const DEFS = new Map();   // type -> def (bench defs only)
/** The bench NodeDef of a type, after loadBenchNodes. */
export const benchDef = type => DEFS.get(type) || null;
