// ============================================================================
//  STEREOGRAM HISTORY  ·  client.js — run a job in the worker
// ----------------------------------------------------------------------------
//  run(op, args) -> Promise<result>. It uses worker.js (a module worker).
//  If the worker cannot start, or it fails to load its modules, run()
//  imports jobs.js and calls it on the main thread. The calls queue in
//  order of arrival; the worker works one job at a time.
//
//  grep -n targets: "export function run", "function fallback"
// ============================================================================
let worker = null, seq = 0, broken = false, local = null;
const pending = new Map();

function start() {
  if (worker || broken) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => {
      const p = pending.get(e.data.id); if (!p) return;
      pending.delete(e.data.id);
      e.data.ok ? p.resolve(e.data.result) : p.reject(new Error(e.data.error));
    };
    worker.onerror = e => { e.preventDefault && e.preventDefault(); toFallback(); };
  } catch (err) { broken = true; worker = null; }
  return worker;
}

// The worker failed (for example no module workers): move every waiting
// job to the main thread.
function toFallback() {
  broken = true;
  if (worker) { try { worker.terminate(); } catch (e) { /* gone */ } }
  worker = null;
  const jobs = [...pending.values()]; pending.clear();
  jobs.forEach(j => fallback(j.op, j.args).then(j.resolve, j.reject));
}

async function fallback(op, args) {
  if (!local) local = import('./jobs.js');
  const m = await local;
  return m.handle(op, args);
}

export function run(op, args = {}) {
  const w = start();
  if (!w) return fallback(op, args);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject, op, args });
    w.postMessage({ id, op, args });
  });
}
