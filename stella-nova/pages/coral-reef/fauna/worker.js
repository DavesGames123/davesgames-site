// ============================================================================
//  CORAL REEF  ·  fauna/worker.js  ·  the creature spawner off the main thread
// ----------------------------------------------------------------------------
//  A module worker. The spawn of a chunk reads the world field a few
//  thousand times (about 30 to 120 ms), so the page asks this worker:
//    { type: 'init', seed, fine }                  builds the world field
//    { type: 'spawn', id, i, j, budget }  ->  { type: 'spawn', id, r }
//  r is the plain result of fauna/spawn.js spawnChunk (species objects are
//  plain data). An error answers { type: 'error', id, message }.
//
//  grep -n targets: "self.onmessage"
// ============================================================================
import { createWorld } from '../world/field.js';
import { spawnChunk } from './spawn.js';

let W = null, seed = 1;
self.onmessage = e => {
  const m = e.data || {};
  try {
    if (m.type === 'init') { seed = m.seed; W = createWorld({ seed: m.seed, fine: m.fine ?? 1 }); return; }
    if (m.type === 'spawn') {
      if (!W) throw new Error('fauna worker: spawn before init');
      const r = spawnChunk({ W, seed, i: m.i, j: m.j, budget: m.budget });
      self.postMessage({ type: 'spawn', id: m.id, r }, [r.grid.h.buffer, r.grid.sand.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String((err && err.stack) || err) });
  }
};
