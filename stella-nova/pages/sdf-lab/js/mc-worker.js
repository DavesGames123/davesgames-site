// ============================================================================
//  SDF FORGE  ·  mc-worker.js — the OBJ export, off the main thread
// ----------------------------------------------------------------------------
//  A module worker. It takes { doc (JSON text), res, bounds }, compiles the
//  CPU field from the document itself, runs marching cubes and posts back
//  { progress } messages, then { obj, stats }. The page stays live while a
//  192-cell export runs.
// ============================================================================
import { fromJSON } from './doc.js';
import { compileField } from './field.js';
import { polygonize, vertexNormals, toOBJ, meshStats } from './mc.js';

self.onmessage = (e) => {
  const { doc, res, bounds, name } = e.data;
  try {
    const t0 = performance.now();
    const F = compileField(fromJSON(doc));
    let last = 0;
    const m = polygonize(F.mapD, bounds, res, {
      stepK: F.stepK,
      onProgress: p => { if (p - last > 0.02 || p >= 1) { last = p; self.postMessage({ progress: p }); } },
    });
    const N = vertexNormals(F.mapD, m.pos, m.h * 0.5);
    const obj = toOBJ(m, N, name || 'sdf');
    const st = meshStats(m);
    self.postMessage({ obj, stats: { ...st, ms: Math.round(performance.now() - t0), evals: m.evals } });
  } catch (err) {
    self.postMessage({ error: String(err && err.message || err) });
  }
};
