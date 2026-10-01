// ============================================================================
//  MATERIAL STUDIO  ·  nodes/bench/api.js — module init and the __studio.bench API
// ────────────────────────────────────────────────────────────────────────────
//  init(ctx) loads the catalog, destroys the runner on GPU teardown, and
//  registers the __studio.bench API with main.js.
//
//  GREP TARGETS  (grep -n the name to jump)
//      init / install / loadBenchGraph / stats
// ============================================================================
import { CAT, catalog, DEFS, benchDef, LIB_TRAITS, BENCH_NON_TILEABLE, BENCH_NON_TILEABLE_CELLS, BENCH_PERIODIC } from './catalog.js';
import { fallbackWGSL } from './fallback.js';
import { runners, trimBench, runBenchPass, prepareBenchPass, renderBenchNode } from './runner.js';
import { importBenchGraph, exportBenchGraph, openInBench } from './graph-io.js';
import { selfTest, selfTestAll } from './selftest.js';

/** @param {object} ctx main.js module context */
export async function init(ctx) {
  const { store, gpu } = ctx;
  await catalog();
  if (gpu && gpu.onTeardown) gpu.onTeardown(() => { const r = gpu.device && runners.get(gpu.device); if (r) r.destroy(); });
  /** Install a graph (contract JSON) as the live graph, with undo. */
  const install = (graph, label) => {
    const G = ctx.modules.graph;
    store.state.graph = G && typeof G.deserialize === 'function' ? G.deserialize(graph) : graph;
    store.emit('graph:changed', { reason: 'load' });
    store.checkpoint(label);
  };
  const api = {
    catalog: () => CAT, defs: () => [...DEFS.values()], def: benchDef,
    LIB_TRAITS, BENCH_NON_TILEABLE, BENCH_NON_TILEABLE_CELLS, BENCH_PERIODIC,
    run: (type, job) => runBenchPass(typeof type === 'string' ? benchDef(type) : type, job),
    render: (type, opts) => renderBenchNode(gpu.device, type, opts),
    prepare: (type, values) => prepareBenchPass(benchDef(type), gpu.device, values),
    fallbackWGSL: (type, passCtx) => fallbackWGSL(benchDef(type), passCtx),
    importBenchGraph, exportBenchGraph, openInBench: (graph, opts) => openInBench(graph || store.state.graph, opts),
    /** Parse bench graph JSON text and load it as the live graph. */
    loadBenchGraph(text, opts) {
      const g = importBenchGraph(text, opts);
      const C = CAT; const libs = [...new Set(g.nodes.map(n => benchDef(n.type)).filter(Boolean).map(d => d.bench.lib).filter(Boolean))];
      return Promise.all(libs.map(k => C.ensureLib(k))).then(() => {
        install(g, 'Import bench graph');
        store.toast(`Imported ${g.importNotes.nodes} bench nodes${g.importNotes.skipped.length ? `, skipped ${g.importNotes.skipped.length}` : ''}`, 'ok');
        return g;
      });
    },
    /** Release the pooled cell textures (bake.js calls it after an export bake). */
    trim: () => trimBench(gpu.device),
    stats: () => { const r = gpu.device && runners.get(gpu.device); return r ? { ...r.stats, pipelines: r.pipes.size, pooled: r.pool.size } : null; },
    selfTest: o => selfTest({ device: gpu.device, ...(o || {}) }),
    selfTestAll: o => selfTestAll({ device: gpu.device, ...(o || {}) }),
  };
  ctx.register('bench', api);
}
