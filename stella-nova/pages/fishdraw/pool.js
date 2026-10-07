// ============================================================================
//  FISHDRAW  ·  pool.js — the worker pool, the queue and the fish cache
// ----------------------------------------------------------------------------
//  draw(name, params, label, prio) returns a Promise of a fish:
//    { key, name, seed, base, params, xy, offs, lens, total, bbox, ms }
//  The pool has min(4, cores - 1) module workers (worker.js). A job waits
//  in a queue, ordered by prio (low first), then by age. A cache of the
//  last CACHE_MAX fish answers a repeat at once. cancel(tag) drops the
//  queued jobs of a tag (for example a grid that the user replaced), unless
//  a caller with another tag also waits for the job. The default tag '*'
//  is never cancelled. A job that a worker already runs ends and goes to
//  the cache.
//
//  FALLBACK. When a module worker cannot start (an old browser), the jobs
//  run on the main thread through engine.js, one per macrotask.
//
//  GREP MAP
//    grep -n 'export function createPool'   the pool
//    grep -n 'function pump'                give queued jobs to free workers
//    grep -n 'function keyOf'               the cache key
// ============================================================================
import { makeEngine, drawFish, flatten, PARAMS } from './engine.js';

const CACHE_MAX = 480;

export function keyOf(name, params, label) {
  return name + '|' + (label ? 1 : 0) + '|' + (params ? PARAMS.map(d => params[d.key]).join(',') : '-');
}

export function createPool(n) {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const size = Math.max(1, Math.min(n || 4, cores - 1));
  const cache = new Map(), inflight = new Map(), queue = [];
  const workers = [];
  let seq = 0, fallback = null, alive = true;

  function remember(key, fish) {
    cache.delete(key); cache.set(key, fish);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  function finish(job, msg) {
    inflight.delete(job.key);
    if (msg.error) { job.reject(new Error(msg.error)); return; }
    const fish = { key: job.key, ...msg };
    delete fish.id;
    remember(job.key, fish);
    job.resolve(fish);
  }
  function spawn() {
    try {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      w.busy = null;
      w.onmessage = e => { const job = w.busy; w.busy = null; if (job) finish(job, e.data); pump(); };
      w.onerror = e => {
        // A module worker that fails to load: run the rest on the main thread.
        e.preventDefault && e.preventDefault();
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
    fallback = fetch(new URL('./fishdraw.js', import.meta.url)).then(r => r.text()).then(makeEngine);
  }
  function pump() {
    if (!alive) return;
    queue.sort((a, b) => a.prio - b.prio || a.seq - b.seq);
    if (fallback) {
      if (fallback.busy || !queue.length) return;
      const job = queue.shift(); fallback.busy = true;
      fallback.then(E => new Promise(r => setTimeout(r, 0)).then(() => {
        try { const f = drawFish(E, job.name, job.params, job.label); finish(job, { name: f.name, seed: f.seed, base: f.base, params: f.params, ...flatten(f.polylines), ms: 0 }); }
        catch (err) { finish(job, { error: String(err && err.message || err) }); }
      })).finally(() => { fallback.busy = false; pump(); });
      return;
    }
    for (const w of workers) {
      if (w.busy || w.dead || !queue.length) continue;
      const job = queue.shift(); w.busy = job;
      w.postMessage({ id: job.seq, name: job.name, params: job.params, label: job.label });
    }
  }

  for (let i = 0; i < size; i++) spawn();

  return {
    size,
    get pending() { return queue.length + workers.filter(w => w.busy).length; },
    cached(name, params, label) { return cache.get(keyOf(name, params, label)) || null; },
    draw(name, params = null, label = true, prio = 5, tag = '*') {
      const key = keyOf(name, params, label);
      const hit = cache.get(key);
      if (hit) { remember(key, hit); return Promise.resolve(hit); }
      if (inflight.has(key)) {
        const j = inflight.get(key);
        if (prio < j.prio) j.prio = prio;
        j.tags.add(tag);
        return j.promise;
      }
      const job = { key, name, params, label, prio, seq: ++seq, tags: new Set([tag]) };
      job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
      inflight.set(key, job); queue.push(job); pump();
      return job.promise;
    },
    cancel(tag) {
      for (let i = queue.length - 1; i >= 0; i--) {
        const j = queue[i];
        if (!j.tags.has(tag)) continue;
        j.tags.delete(tag);
        if (!j.tags.size) { queue.splice(i, 1); inflight.delete(j.key); j.reject(Object.assign(new Error('cancelled'), { cancelled: true })); }
      }
    },
    destroy() { alive = false; workers.forEach(w => w.terminate()); },
  };
}
