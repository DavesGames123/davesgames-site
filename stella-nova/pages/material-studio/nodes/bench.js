// ============================================================================
//  MATERIAL STUDIO  ·  nodes/bench.js — Composition Bench cells as material nodes
// ────────────────────────────────────────────────────────────────────────────
//  Every cell of every Composition Bench library (21 libraries, 1120 cells,
//  composition-bench/libs/index.json) becomes one boundary 'pass' NodeDef of
//  type "bench.<lib>.<cell>". The five generic bench kinds (transform, warp,
//  displace, blend, map) become "bench.gen.<kind>". The WGSL assembly and the
//  uniform packing come from ../../../lib/bench-wgsl.js, the same code the
//  bench page runs, so a node renders here as it does on the bench.
//
//  DATA FLOW
//      loadBenchNodes() ── index.json only ──▶ 1125 NodeDefs (no WGSL yet)
//      bake ── def.pass.run(job) ──▶ ensureLib (fetch libs/<key>.json once)
//          ──▶ cell pass: moduleFor + in0/in1 hook ──▶ cell texture (res x ss)
//              (sim libraries: compute steps on an N x N state, then present)
//          ──▶ frame pass: zoom / rotate / offset, tile mode, matte, value,
//              sRGB decode ──▶ job.target (rgba16float, res x res)
//      compiler without run() ── def.pass.wgsl(ctx) ──▶ a fused pass_main
//          fallback (the cell inlined as a function, uniforms as literals)
//      importBenchGraph(json) ──▶ contract Graph (bench nodes + Material Output)
//      exportBenchGraph(graph) ──▶ bench graph JSON ── openInBench ──▶ new tab
//
//  MODULE TREE  (nodes/bench/; each file header lists its grep targets)
//      catalog.js ....... BENCH_BASE / CAT / catalog / LIB_TRAITS / BENCH_NON_TILEABLE
//                         BENCH_NON_TILEABLE_CELLS / TILE_MODES / DEFS / benchDef
//      defs.js .......... P / SHARED / paramsFor / portsFor / makePass / cellDef
//                         genericDef / loadBenchNodes
//      values.js ........ withDefaults / nodeOf / paletteOf
//      cell-wgsl.js ..... RE_IN / hookInputs / cellSource
//      frame-wgsl.js .... FRAME_STRUCT / FRAME_FNS / FRAME_WGSL / frameUniform
//      fallback.js ...... lit / parseStruct / uniformCtor / fallbackWGSL
//      runner.js ........ BenchRunner (pipelines, pools, run, sims, trim, flush)
//                         runnerFor / trimBench / runBenchPass / prepareBenchPass
//                         renderBenchNode
//      graph-io.js ...... importBenchGraph / exportBenchGraph / openInBench
//      selftest.js ...... selfTest / selfTestAll
//      api.js ........... init (registers __studio.bench)
//      bench.test.mjs ... Node characterization test (bench.golden.json)
//  This file re-exports the public names. main.js, bake.js and panels.js
//  read them from the module namespace of nodes/bench.js.
//
//  PASS PROTOCOL  (beyond contract.js; the compiler and bake should use it)
//      def.pass.external === 'bench' marks a node that runs its own GPU work.
//      await def.pass.run(job) renders the node into job.target and submits
//      its own command buffers on device.queue. Submit the passes that write
//      the input textures before you call run (queue order does the rest).
//        job = { device, target: GPUTexture|GPUTextureView (rgba16float,
//                res x res, RENDER_ATTACHMENT), res, values: node.params,
//                inputs: {inputId: GPUTexture|GPUTextureView|null} (null or
//                missing = not linked), seed?: number, time?: number }
//      def.pass.prepare(device, values) compiles the pipelines ahead of time.
//      def.pass.wgsl(ctx) is the contract fallback: a pass_main that inlines
//      the cell. It reads ctx.values (all bench params are uniform:false, so
//      an edit recompiles) and ctx.linked?.[id] (else ctx.tex[id] presence)
//      to know if an input is wired. Sim libraries have no fallback: their
//      wgsl() throws, and they need run().
//
//  OUTPUTS OF A NODE  (the rgba16float texture the node writes)
//      image cells .... rgb = color (linear after sRGB decode), a = value
//                       outputs: color (rgb), value (a), tex (rgba)
//      coord cells .... rg = coordinate in studio uv space (bench p*0.5+0.5)
//                       outputs: uv (rg), tex (rgba)
//
//  COORDINATES
//      Studio uv is [0,1)^2, origin top-left, +v down. The cell renders with
//      fp.xy = uv * size, which is the bench framebuffer convention, so no
//      flip is needed. A coord input converts studio uv to the bench space
//      p = (uv*2-1)*scale (param coordSpace 'uv') or passes it raw ('bench').
//      Tiling: see LIB_TRAITS and the 'tile' param (none, seamless, mirror,
//      repeat). BENCH_NON_TILEABLE names the libraries whose cells draw one
//      centered subject, where 'seamless' blends ghosts instead of a texture.
//      BENCH_NON_TILEABLE_CELLS names single cells of tiling libraries that
//      still have an edge seam: their default tile mode is 'none'.
//      Graph tiling: a cell with no linked input repeats job.tiling times
//      (frameUniform xf.w = tiling / res, fract in fs_frame).
// ============================================================================
export {
  BENCH_BASE, BENCH_PAGE, BENCH_HANDOFF_KEY, catalog, LIB_TRAITS,
  BENCH_NON_TILEABLE, BENCH_NON_TILEABLE_CELLS, BENCH_PERIODIC, benchDef,
} from './bench/catalog.js';
export { loadBenchNodes } from './bench/defs.js';
export { withDefaults } from './bench/values.js';
export { parseStruct, uniformCtor, fallbackWGSL } from './bench/fallback.js';
export { trimBench, runBenchPass, prepareBenchPass, renderBenchNode } from './bench/runner.js';
export { importBenchGraph, exportBenchGraph, openInBench } from './bench/graph-io.js';
export { selfTest, selfTestAll } from './bench/selftest.js';
export { init } from './bench/api.js';
