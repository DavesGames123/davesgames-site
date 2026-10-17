// ============================================================================
//  DLA TERRAIN WORKER  ·  runs lib/dla-terrain.js off the main thread
// ----------------------------------------------------------------------------
//  Module worker: new Worker(new URL('../../lib/dla-terrain-worker.js',
//  import.meta.url), { type: 'module' }).
//
//  PROTOCOL (pages/dla-terrain/CONTRACT.md)
//    in   { type: 'generate', id, opts }
//    out  { type: 'progress', id, stage, label, frac, stageFrac, snapshot }
//         ... { type: 'done', id, terrain }
//         or  { type: 'error', id, message }
//    in   { type: 'cancel', id }   stops that run at its next snapshot; the
//         worker then sends { type: 'error', id, message: 'cancelled' }.
//  The typed arrays of each snapshot and of the terrain are transferred,
//  not copied. A new 'generate' while a run is busy cancels the old run.
//
//  grep -n targets: "function arraysOf", "async function run", "onmessage"
// ============================================================================

import { generateTerrain, terrainTransferables } from './dla-terrain.js';

const cancelled = new Set();
let active = null;

// The buffers of a snapshot (its typed arrays, and the dla arrays).
function arraysOf(snap) {
  const out = [];
  if (!snap) return out;
  for (const k in snap) {
    const v = snap[k];
    if (ArrayBuffer.isView(v)) out.push(v.buffer);
    else if (v && typeof v === 'object') for (const j in v) if (ArrayBuffer.isView(v[j])) out.push(v[j].buffer);
  }
  return out;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function run(id, opts) {
  active = id;
  try {
    const terrain = await generateTerrain(opts || {}, async (p) => {
      self.postMessage({ type: 'progress', id, stage: p.stage, label: p.label, frac: p.frac, stageFrac: p.stageFrac, snapshot: p.snapshot }, arraysOf(p.snapshot));
      await tick();   // lets a 'cancel' or a new 'generate' in
      if (cancelled.has(id)) throw new Error('cancelled');
    });
    self.postMessage({ type: 'done', id, terrain }, terrainTransferables(terrain));
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String((err && err.message) || err) });
  } finally {
    cancelled.delete(id);
    if (active === id) active = null;
  }
}

self.onmessage = (e) => {
  const m = e.data || {};
  if (m.type === 'cancel') { cancelled.add(m.id); return; }
  if (m.type !== 'generate') return;
  if (active != null && active !== m.id) cancelled.add(active);
  run(m.id, m.opts);
};
