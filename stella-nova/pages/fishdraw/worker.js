// ============================================================================
//  FISHDRAW  ·  worker.js — one fish per message, off the main thread
// ----------------------------------------------------------------------------
//  A module worker. It fetches fishdraw.js (Lingdong Huang, MIT, see
//  LICENSE-fishdraw.txt) as text once, makes one engine with
//  engine.js makeEngine(), and answers each job with drawFish().
//
//  IN   { id, name, params (object or null), label (bool) }
//  OUT  { id, name, seed, base, params, xy, offs, lens, total, bbox, ms }
//       xy, offs and lens are typed arrays, sent as transfers.
//       { id, error } when the engine throws for these params.
//
//  pool.js makes these workers and keeps the queue.
// ============================================================================
import { makeEngine, drawFish, flatten } from './engine.js';

const ready = fetch(new URL('./fishdraw.js', import.meta.url))
  .then(r => { if (!r.ok) throw new Error('fishdraw.js HTTP ' + r.status); return r.text(); })
  .then(makeEngine);

self.onmessage = async e => {
  const { id, name, params, label } = e.data;
  try {
    const E = await ready;
    const t0 = performance.now();
    const f = drawFish(E, name, params, label);
    const flat = flatten(f.polylines);
    self.postMessage({ id, name: f.name, seed: f.seed, base: f.base, params: f.params, ...flat, ms: performance.now() - t0 },
      [flat.xy.buffer, flat.offs.buffer, flat.lens.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
