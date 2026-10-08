// ============================================================================
//  MUSHROOM DRAW  ·  worker.js — one specimen per message (module worker)
// ----------------------------------------------------------------------------
//  Original code (davesgames.io). saver.js asks for the specimens of the
//  next shot here, so the frame loop never waits for the engine.
//  In:  { id, params, seed }   Out: { id, spec } or { id, error }
// ============================================================================
import { buildSpecimen } from './engine.js';

self.onmessage = e => {
  const { id, params, seed } = e.data;
  try {
    const spec = buildSpecimen(params, seed);
    const tr = [spec.xy.buffer, spec.offs.buffer, spec.lens.buffer, spec.kinds.buffer, spec.part.buffer, spec.order.buffer, ...spec.washes.map(w => w.xy.buffer)];
    self.postMessage({ id, spec }, tr);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
