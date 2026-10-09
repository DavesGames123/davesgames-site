// ============================================================================
//  PLANET FORGE  ·  pool.js — generate a planet across module workers
// ----------------------------------------------------------------------------
//  createPool(n, opts) -> { generate(P, W, onProgress) -> Promise<M>, size, terminate() }
//  The rows split into stripes of 8 (16 at 4k); each idle worker takes the
//  next stripe. Then one worker runs the normal and AO pass. A newer
//  generate() call cancels the older one (its promise rejects 'stale'),
//  so a slider drag never queues a backlog. Without Worker support the
//  same work runs on the main thread in one go.
//  FAILURES  A worker that fails (an error event, a message that cannot be
//  read, or no answer to a stripe in STALL_MS) is dropped and its calls
//  reject. If no worker is left, or a job fails, generate() runs the job
//  on the main thread once, so the page still gets a planet. Before, a
//  worker that died left its stripe unanswered and the page waited forever.
// ============================================================================
import { assemble, generate as genSync } from './maps.js';

// A stripe of 8-16 rows takes well under a second; 30 s means a dead worker.
export const STALL_MS = 30000;

// opts.stallMs (tests: a short stall), opts.makeWorker (tests: a stub).
export function createPool(n, opts = {}) {
  const stallMs = opts.stallMs || STALL_MS;
  const make = opts.makeWorker || (() => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }));
  let workers = [];
  try { for (let i = 0; i < n; i++) workers.push(make(i)); }
  catch (e) { workers.forEach(w => w.terminate()); workers = []; }
  let job = 0, nextId = 1;
  const waiting = new Map();   // id -> { w, done(data), fail(err), timer }
  const drop = (w, why) => {
    if (!workers.includes(w)) return;
    console.warn('forge: worker dropped: ' + why);
    workers = workers.filter(x => x !== w);
    try { w.terminate(); } catch (e) { /* gone */ }
    for (const [id, c] of waiting) if (c.w === w) { waiting.delete(id); clearTimeout(c.timer); c.fail(new Error('worker failed: ' + why)); }
  };
  for (const w of workers) {
    w.onmessage = ({ data }) => { const c = waiting.get(data.id); if (c) { waiting.delete(data.id); clearTimeout(c.timer); c.done(data); } };
    w.onerror = e => { e.preventDefault && e.preventDefault(); drop(w, (e && e.message) || 'error event'); };
    w.onmessageerror = () => drop(w, 'message could not be read');
  }
  const call = (w, msg, transfer) => new Promise((res, rej) => {
    const id = nextId++;
    const timer = setTimeout(() => drop(w, 'no answer in ' + stallMs + ' ms'), stallMs);
    waiting.set(id, { w, timer, fail: rej, done: d => d.error ? rej(new Error(d.error)) : res(d) });
    w.postMessage({ ...msg, id }, transfer || []);
  });

  async function generate(P, W, onProgress = () => {}) {
    const my = ++job;
    const planet = JSON.parse(JSON.stringify(P));
    const sync = () => { const M = genSync(planet, W); onProgress(1); return M; };
    if (!workers.length) return sync();
    try { return await viaWorkers(my, planet, W, onProgress); }
    catch (e) {
      if (e.message === 'stale' || my !== job) throw e;
      // a worker failed: finish this job on the main thread, once
      console.warn('forge: workers failed (' + e.message + '); generating on the main thread');
      return sync();
    }
  }
  async function viaWorkers(my, planet, W, onProgress) {
    const H = W / 2, step = W >= 4096 ? 16 : 8, stripes = [];
    for (let y = 0; y < H; y += step) stripes.push([y, Math.min(H, y + step)]);
    const parts = []; let done = 0, k = 0;
    await Promise.all(workers.slice().map(async w => {
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
    // the joined maps move to the worker (transfer, no copy); the worker
    // sends the finished maps back the same way. The cloud map stays here.
    const f = await call(workers[0], { cmd: 'finish', planet, M: { W, H, height: M.height, albedo: M.albedo, cloud: M.cloud.slice(), emissive: M.emissive, mat: M.mat } },
      [M.height.buffer, M.albedo.buffer, M.emissive.buffer, M.mat.buffer]);
    if (my !== job) throw new Error('stale');
    M.normal = f.normal; M.ao = f.ao; M.stats = f.stats; M.reliefKm = f.reliefKm;
    M.height = f.height; M.albedo = f.albedo; M.mat = f.mat; M.emissive = f.emissive;
    onProgress(1);
    return M;
  }
  return { generate, get size() { return workers.length; }, terminate() { job++; workers.forEach(w => w.terminate()); workers = []; } };
}
