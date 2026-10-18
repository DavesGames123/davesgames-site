// ============================================================================
//  CORAL REEF  ·  world/pool.js  ·  a pool of world workers (DOM-free)
// ----------------------------------------------------------------------------
//  The chunk jobs of world/stream.js run in module workers of
//  world/worker.js. A queue holds the jobs; each job has a priority that
//  the pool reads again each time a worker is free (prio(): lower first),
//  so a chunk that the eye comes near goes ahead of the others. A coral
//  job takes seconds: at most maxCoral of them run at one time (default
//  size - 1, at least 1), so one worker is always there for the rock.
//
//    const pool = createPool({ size, makeWorker, maxCoral, onFallback });
//    const h = pool.submit(job, prio)  // job: a world/worker.js message;
//                                      // prio: a number or a function
//    h.promise -> the result (null when cancelled), h.cancel()
//    pool.stats -> { queued, running, done, local, workers }
//    pool.dispose()
//
//  FALL BACK. With no makeWorker (jsdom, node), or when a worker fails,
//  the jobs run on this thread, one at a time, through runJob: the coral
//  growth in slices of sliceMs with a timer between them (world/corals.js
//  growChunkAsync). onFallback(why) tells the page (a smaller profile).
//
//  grep -n targets: "export function createPool", "function pump", "function runLocalNext"
// ============================================================================
import { runJob } from './worker.js';

export function createPool({ size = 2, makeWorker = null, maxCoral, onFallback = null, sliceMs = 6, delay = (ms) => new Promise(r => setTimeout(r, ms)) } = {}) {
  const queue = [];
  const workers = [];
  let nextId = 1, done = 0, local = !makeWorker, localBusy = false, why = '';
  const maxC = Math.max(1, maxCoral ?? size - 1);
  const pending = new Map();          // id -> entry (running in a worker)

  function fallback(reason) {
    if (local) return;
    local = true; why = reason;
    for (const w of workers) { try { w.w.terminate(); } catch (e) { /* gone */ } if (w.job) queue.push(w.job); w.job = null; }
    workers.length = 0;
    pending.clear();
    if (onFallback) { try { onFallback(reason); } catch (e) { /* page */ } }
    pump();
  }
  if (!local) {
    try {
      for (let i = 0; i < size; i++) {
        const w = { w: makeWorker(), job: null };
        w.w.onmessage = e => onResult(w, e.data);
        w.w.onerror = e => { e && e.preventDefault && e.preventDefault(); fallback('a world worker failed: ' + ((e && e.message) || 'error')); };
        workers.push(w);
      }
    } catch (e) { workers.length = 0; local = true; why = 'no module worker: ' + ((e && e.message) || e); if (onFallback) onFallback(why); }
  }

  const prioOf = j => (typeof j.prio === 'function' ? j.prio() : j.prio);
  function take(coralOk) {
    let best = -1, bp = Infinity;
    for (let i = 0; i < queue.length; i++) {
      const j = queue[i];
      if (j.cancelled) { queue.splice(i, 1); i--; j.resolve(null); continue; }
      if (j.job.type === 'coral' && !coralOk) continue;
      const p = prioOf(j);
      if (p < bp) { bp = p; best = i; }
    }
    return best < 0 ? null : queue.splice(best, 1)[0];
  }
  function coralRunning() { let n = 0; for (const w of workers) if (w.job && w.job.job.type === 'coral') n++; return n; }
  function pump() {
    if (local) { runLocalNext(); return; }
    for (const w of workers) {
      if (w.job) continue;
      const j = take(coralRunning() < maxC);
      if (!j) break;
      w.job = j; pending.set(j.id, j);
      try { w.w.postMessage(Object.assign({ id: j.id }, j.job)); }
      catch (e) { fallback('postMessage failed: ' + ((e && e.message) || e)); return; }
    }
  }
  function onResult(w, out) {
    const j = w.job; w.job = null;
    if (j) pending.delete(j.id);
    done++;
    if (j) {
      if (!out || !out.ok) j.reject(new Error((out && out.error) || 'world job failed'));
      else j.resolve(j.cancelled ? null : out.result);
    }
    pump();
  }
  async function runLocalNext() {
    if (localBusy) return;
    const j = take(true);
    if (!j) return;
    localBusy = true;
    try {
      await delay(0);
      if (j.cancelled) { j.resolve(null); }
      else {
        const out = await runJob(Object.assign({ id: j.id }, j.job), { slice: { budgetMs: sliceMs, wait: () => delay(0) } });
        done++;
        j.resolve(j.cancelled ? null : out.result);
      }
    } catch (e) { j.reject(e); }
    localBusy = false;
    runLocalNext();
  }

  function submit(job, prio = 0) {
    const e = { id: nextId++, job, prio, cancelled: false };
    e.promise = new Promise((res, rej) => { e.resolve = res; e.reject = rej; });
    queue.push(e);
    pump();
    return { id: e.id, promise: e.promise, cancel() { e.cancelled = true; } };
  }
  function dispose() {
    for (const w of workers) { try { w.w.terminate(); } catch (e) { /* gone */ } }
    workers.length = 0;
    for (const j of queue) j.resolve(null);
    queue.length = 0;
  }
  return {
    submit, dispose, pump,
    get stats() { return { queued: queue.length, running: local ? (localBusy ? 1 : 0) : workers.filter(w => w.job).length, done, local, workers: workers.length, why }; },
    get local() { return local; }, get why() { return why; },
  };
}
