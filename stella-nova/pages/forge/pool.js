// ============================================================================
//  PLANET FORGE  ·  pool.js — generate a planet across module workers
// ----------------------------------------------------------------------------
//  createPool(n) -> { generate(P, W, onProgress) -> Promise<M>, terminate() }
//  The rows split into stripes of 8 (16 at 4k); each idle worker takes the
//  next stripe. Then one worker runs the normal and AO pass. A newer
//  generate() call cancels the older one (its promise rejects 'stale'),
//  so a slider drag never queues a backlog. Without Worker support the
//  same work runs on the main thread in one go.
// ============================================================================
import { assemble, generate as genSync } from './maps.js';

export function createPool(n) {
  let workers = [];
  try { for (let i = 0; i < n; i++) workers.push(new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })); }
  catch (e) { workers.forEach(w => w.terminate()); workers = []; }
  let job = 0, nextId = 1;
  const waiting = new Map();
  for (const w of workers) w.onmessage = ({ data }) => { const f = waiting.get(data.id); if (f) { waiting.delete(data.id); f(data); } };
  const call = (w, msg, transfer) => new Promise((res, rej) => {
    const id = nextId++;
    waiting.set(id, d => d.error ? rej(new Error(d.error)) : res(d));
    w.postMessage({ ...msg, id }, transfer || []);
  });

  async function generate(P, W, onProgress = () => {}) {
    const my = ++job;
    const planet = JSON.parse(JSON.stringify(P));
    if (!workers.length) { const M = genSync(planet, W); onProgress(1); return M; }
    const H = W / 2, step = W >= 4096 ? 16 : 8, stripes = [];
    for (let y = 0; y < H; y += step) stripes.push([y, Math.min(H, y + step)]);
    const parts = []; let done = 0, k = 0;
    await Promise.all(workers.map(async w => {
      while (k < stripes.length) {
        if (my !== job) throw new Error('stale');
        const [y0, y1] = stripes[k++];
        const r = await call(w, { cmd: 'rows', planet, W, y0, y1 });
        parts.push(r.part); done++;
        onProgress(0.9 * done / stripes.length);
      }
    }));
    if (my !== job) throw new Error('stale');
    const M = assemble(W, parts);
    const f = await call(workers[0], { cmd: 'finish', planet, M: { W, H, height: M.height, albedo: M.albedo, cloud: M.cloud } });
    if (my !== job) throw new Error('stale');
    M.normal = f.normal; M.ao = f.ao; M.stats = f.stats; M.reliefKm = f.reliefKm;
    onProgress(1);
    return M;
  }
  return { generate, size: workers.length, terminate() { job++; workers.forEach(w => w.terminate()); workers = []; } };
}
