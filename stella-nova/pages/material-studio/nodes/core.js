// ============================================================================
//  MATERIAL STUDIO  ·  nodes/core.js — the built-in node library
// ────────────────────────────────────────────────────────────────────────────
//  Exports NODES, an array of contract NodeDef, from the section files in
//  nodes/core/. main.js puts each def on state.registry before any module
//  init. compile.js turns the defs into
//  WGSL: an `expr` def is fused per texel into its consumer's pass, a `pass`
//  def renders its own texture, and an `expand` def (a macro) is replaced by
//  a small subgraph of other defs before compile.
//
//  DATA FLOW
//      NodeDef.expr(ctx)       -> {outputId: WGSL expr}   ctx = contract ExprCtx
//      NodeDef.pass.wgsl(ctx)  -> WGSL that defines pass_main(uv) -> vec4f
//      NodeDef.expand(values)  -> {nodes, links, inputs, outputs}  (macro)
//      Library helpers (ms_*) come from shaders/bake-lib.wgsl. compile.js
//      adds only the helpers that the generated code names.
//
//  CONVENTIONS
//      Generators are periodic: an integer scale tiles in the uv square.
//      A `uv` input with default 'uv' reads the texel uv when unlinked.
//      Int and bool params reach WGSL as f32 expressions: wrap with i32().
//      Math nodes read a param (va, vb, ...) when the matching input is not
//      linked, so a node with one link still does useful work.
//      Pass outputs of type 'normal' hold raw -1..1 xyz (not encoded).
//      Filter radii and offsets are in tile uv units, so a result does not
//      change with the bake resolution.
//
//  FILES  (one section per file, in display order; grep -n a type id there)
//      core/build.js ......... port, param and def builders, the def list
//      core/output.js ........ Material Output
//      core/input.js ......... uv, tile coord, constants, seed, time, image
//      core/noise.js ......... value, gradient, simplex, worley, fbm family, warp
//      core/generator.js ..... bricks, tiles, hex, checker, stripes, gradients, shapes
//      core/pattern.js ....... tile sampler, splatter
//      core/filter.js ........ blur, sharpen, edges, warps, morphology, tileable
//      core/height-normal.js . height->normal, blends, AO, curvature, slope
//      core/transform.js ..... image transforms (pass) and uv transforms (expr)
//      core/color.js ......... hsv, levels of color, gray, channels, gradient map
//      core/adjust.js ........ levels, curves, histogram, invert, remap, threshold
//      core/blend.js ......... 20 blend modes, mix, mask combine
//      core/math.js .......... float math (28 ops)
//      core/vector.js ........ vec2/vec3 math
//      core/utility.js ....... switch, reroute, cache, WGSL expression, custom pass
//      core/material.js ...... PBR from height (macro), presets, layer mix
//      core/core.test.mjs .... characterization test (node nodes/core/core.test.mjs)
//
//  ORDER
//      Each section file calls def() when it is evaluated. ES modules run
//      their imports in source order, so the import order below sets the
//      order of NODES. Add a new section file at the matching position.
//
//  GREP TARGETS (this file)
//      NODES catalogSummary init
// ============================================================================
import { defs } from './core/build.js';
import './core/output.js';
import './core/input.js';
import './core/noise.js';
import './core/generator.js';
import './core/pattern.js';
import './core/filter.js';
import './core/height-normal.js';
import './core/transform.js';
import './core/color.js';
import './core/adjust.js';
import './core/blend.js';
import './core/math.js';
import './core/vector.js';
import './core/utility.js';
import './core/material.js';

/** @type {import('../contract.js').NodeDef[]} */
export const NODES = defs;

/** Category -> count, for the self test and the library header. */
export function catalogSummary() {
  const out = {};
  for (const d of NODES) out[d.category] = (out[d.category] || 0) + 1;
  return { total: NODES.length, byCategory: out };
}

/** @param {object} ctx main.js module context */
export async function init(ctx) {
  ctx.register('core', { NODES, catalogSummary, selfTest: () => catalogSummary() });
}
