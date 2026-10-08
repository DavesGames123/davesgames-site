// ============================================================================
//  NONFLOWERS  ·  pool.js — two painting workers, a queue and a cache
// ----------------------------------------------------------------------------
//  paint(seed, { prio, tag, onStage }) returns a Promise of a plant:
//    { seed, token, type, par, focus, leaf, base, painting, bg, blank, hash, ms, where }
//  painting and bg are ImageBitmaps (worker) or canvases (main thread).
//  where is 'worker' or 'main'.
//
//  The pool has two module workers (worker.js), so the page can paint the
//  next plant while the user looks at this one. A job waits in a queue,
//  ordered by prio (low first), then by age. The cache keeps the last
//  CACHE_MAX plants. cancel(tag) drops the queued jobs of a tag unless a
//  caller with another tag waits for the same seed. A job that a worker
//  runs now ends and goes to the cache.
//
//  FALLBACK. When a module worker cannot start, or a worker has no
//  OffscreenCanvas 2D (older Safari), the jobs run on the main thread with
//  real canvases through engine.js paint(), one per macrotask. The page
//  stops while a plant paints (about 1 to 4 s). On the main thread the
//  upstream Array.prototype getters ("x", "y", "z", "-1".."-3") stay on the
//  page realm; see engine.js MAIN-THREAD FALLBACK.
//
//  GREP MAP
//    grep -n 'export function createPool'   the pool
//    grep -n 'function pump'                give queued jobs to free workers
//    grep -n 'function useFallback'         the main-thread path
// ============================================================================
import { paint as paintNow, plainPAR, rgbaHash, cleanSeed, plantFoci } from './engine.js';

const CACHE_MAX = 24;   // about 2.5 MB of bitmaps per plant

export function createPool(n = 2) {
  const cache = new Map(), inflight = new Map(), queue = [], workers = [];
  let seq = 0, fallback = null, alive = true;

  function remember(seed, plant) {
    cache.delete(seed); cache.set(seed, plant);
    // An old plant is not closed: the page may still show it. The GC
    // frees its bitmaps when no one holds it.
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  function finish(job, msg) {
    inflight.delete(job.seed);
    if (msg.error) { job.reject(new Error(msg.error)); return; }
    const plant = { seed: job.seed, token: msg.token, type: msg.type, par: msg.par, focus: msg.focus, leaf: msg.leaf, base: msg.base, painting: msg.painting, bg: msg.bg, blank: msg.blank, hash: msg.hash, ms: msg.ms, where: msg.where || 'worker' };
    remember(job.seed, plant);
    job.resolve(plant);
  }
  function stage(job, name, at) { for (const f of job.listeners) { try { f(name, at); } catch (e) { /* a page callback */ } } }
  function spawn() {
    try {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      w.busy = null;
      w.onmessage = e => {
        const m = e.data, job = w.busy;
        if (!job || m.id !== job.seq) return;
        if (m.stage) { stage(job, m.stage, m.at); return; }
        w.busy = null;
        if (m.noCanvas) { w.dead = true; queue.unshift(job); useFallback(); pump(); return; }
        finish(job, m); pump();
      };
      w.onerror = e => {
        if (e && e.preventDefault) e.preventDefault();
        const job = w.busy; w.busy = null; w.dead = true;
        if (job) queue.unshift(job);
        if (workers.every(x => x.dead)) useFallback();
        pump();
      };
      workers.push(w);
    } catch (err) { useFallback(); }
  }
  function useFallback() {
    if (fallback) return;
    fallback = fetch(new URL('./upstream/main.js', import.meta.url)).then(r => r.text());
    fallback.busy = false;
  }
  function pump() {
    if (!alive) return;
    queue.sort((a, b) => a.prio - b.prio || a.seq - b.seq);
    if (fallback && workers.every(w => w.dead)) {
      if (fallback.busy || !queue.length) return;
      const job = queue.shift(); fallback.busy = true;
      const env = { canvas: () => document.createElement('canvas') };
      fallback.then(src => new Promise(r => setTimeout(r, 30)).then(() => {
        try {
          const r = paintNow(src, job.seed, env, s => stage(job, s, 0));
          const hash = rgbaHash(r.ctx.getImageData(0, 0, r.ctx.canvas.width, r.ctx.canvas.height).data);
          const f = plantFoci(r.blits);
          finish(job, { token: r.E.token, type: r.type, par: plainPAR(r.PAR), focus: f.flower, leaf: f.leaf, base: r.base, painting: r.ctx.canvas, bg: r.bg, blank: r.blank, hash, ms: r.ms, where: 'main' });
        } catch (err) { finish(job, { error: String(err && err.message || err) }); }
      })).finally(() => { fallback.busy = false; pump(); });
      return;
    }
    for (const w of workers) {
      if (w.busy || w.dead || !queue.length) continue;
      const job = queue.shift(); w.busy = job;
      w.postMessage({ id: job.seq, seed: job.seed });
    }
  }

  for (let i = 0; i < n; i++) spawn();

  return {
    size: n,
    get pending() { return queue.length + workers.filter(w => w.busy).length; },
    get mode() { return fallback && workers.every(w => w.dead) ? 'main' : 'worker'; },
    cached(seed) { return cache.get(cleanSeed(seed)) || null; },
    paint(seed0, { prio = 5, tag = '*', onStage = null } = {}) {
      const seed = cleanSeed(seed0);
      const hit = cache.get(seed);
      if (hit) { remember(seed, hit); return Promise.resolve(hit); }
      if (inflight.has(seed)) {
        const j = inflight.get(seed);
        if (prio < j.prio) { j.prio = prio; pump(); }
        j.tags.add(tag);
        if (onStage) j.listeners.add(onStage);
        return j.promise;
      }
      const job = { seed, prio, seq: ++seq, tags: new Set([tag]), listeners: new Set(onStage ? [onStage] : []) };
      job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
      inflight.set(seed, job); queue.push(job); pump();
      return job.promise;
    },
    cancel(tag) {
      for (let i = queue.length - 1; i >= 0; i--) {
        const j = queue[i];
        if (!j.tags.has(tag)) continue;
        j.tags.delete(tag);
        if (!j.tags.size) { queue.splice(i, 1); inflight.delete(j.seed); j.reject(Object.assign(new Error('cancelled'), { cancelled: true })); }
      }
    },
    destroy() { alive = false; workers.forEach(w => w.terminate()); },
  };
}
