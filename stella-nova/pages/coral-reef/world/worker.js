// ============================================================================
//  CORAL REEF  ·  world/worker.js  ·  the world chunk jobs (module worker)
// ----------------------------------------------------------------------------
//  Runs the jobs of world/stream.js off the main thread. Each message is
//  one job; the answer is { id, ok, result | error, ms } with the array
//  buffers transferred. The worker keeps one world field (world/field.js)
//  per (seed, fine), so the noise tables and the tile caches live on.
//    { id, type: 'rock', seed, ci, cj, lod, c0, fine }
//        -> world/mesh.js meshChunk: { rock, sand, lod, cell, bytes }
//    { id, type: 'coral', seed, ci, cj, budget, fine, plants? }
//        -> world/corals.js growChunk: the grown, meshed corals of the chunk
//           (plants: the planted colonies of the chunk, grown at once after)
//    { id, type: 'plant', seed, fine, co, add, drop }
//        -> world/corals.js plantChunk: the shown chunk co with the plants
//           of drop (uids) taken out and the plants of add grown in
//    { id, type: 'fine', colony, colonies, particles, bridges, quality }
//        -> world/corals.js meshFine: one colony, fine mesh and polyps
//  runJob(msg) is the same job on any thread (node tests, the main-thread
//  fall back of world/pool.js, which passes o.slice for the coral growth).
//
//  grep -n targets: "export function worldFor", "export async function runJob"
// ============================================================================
import { createWorld } from './field.js';
import { meshChunk } from './mesh.js';
import { growChunkSync, growChunkAsync, meshFine, plantChunk, transfers } from './corals.js';
import { QUALITY } from '../reef.js';

const worlds = new Map();
export function worldFor(seed, fine = 1) {
  const key = `${seed}|${fine}`;
  let W = worlds.get(key);
  if (!W) { if (worlds.size > 6) worlds.clear(); W = createWorld({ seed, fine }); worlds.set(key, W); }
  return W;
}
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// o.slice: { budgetMs, wait } for a coral job on the main thread
export async function runJob(msg, o = {}) {
  const t0 = now();
  let result = null;
  if (msg.type === 'rock') {
    result = meshChunk(worldFor(msg.seed, msg.fine), msg.ci, msg.cj, msg.lod, msg.c0);
  } else if (msg.type === 'coral') {
    const W = worldFor(msg.seed, msg.fine ?? 1);
    const plants = msg.plants || null;
    result = o.slice ? await growChunkAsync(W, msg.ci, msg.cj, msg.budget, { seed: msg.seed, plants, slice: o.slice, wait: o.slice.wait }) : growChunkSync(W, msg.ci, msg.cj, msg.budget, { seed: msg.seed, plants });
  } else if (msg.type === 'plant') {
    result = plantChunk(worldFor(msg.seed, msg.fine ?? 1), msg.co, msg.add || [], msg.drop || [], msg.seed);
  } else if (msg.type === 'fine') {
    result = meshFine(msg.colony, msg.particles, msg.bridges, QUALITY[msg.quality] || QUALITY.mid, msg.colonies);
  } else throw new Error('world worker: unknown job ' + msg.type);
  return { id: msg.id, ok: true, result, ms: now() - t0 };
}
function transferOf(out) {
  const r = out.result;
  if (!r) return [];
  if (r.rock !== undefined) {
    const t = [];
    for (const m of [r.rock, r.sand]) if (m) for (const k of ['positions', 'normals', 'indices', 'cavity', 'band']) if (m[k]) t.push(m[k].buffer);
    return t;
  }
  return transfers(r);
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined') {
  self.onmessage = async e => {
    const msg = e.data;
    try {
      const out = await runJob(msg);
      self.postMessage(out, transferOf(out));
    } catch (err) {
      self.postMessage({ id: msg && msg.id, ok: false, error: String((err && err.stack) || err) });
    }
  };
}
export { transferOf };
