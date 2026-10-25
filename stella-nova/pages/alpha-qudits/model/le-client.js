// ============================================================================
//  ALPHA QUDITS  ·  model/le-client.js  ·  page side of the look-elsewhere worker (MODEL)
// ----------------------------------------------------------------------------
//  startLookElsewhere(params, { onProgress }) -> { id, promise, cancel() }
//  promise resolves to the result of look-elsewhere.js, or to null when
//  the run was cancelled (or replaced by a newer run). One module worker
//  serves all runs. Without Worker support the count runs on the page in
//  time slices instead.
//
//  grep -n targets:  export function startLookElsewhere | function worker
// ============================================================================
import { lookElsewhereSteps } from './look-elsewhere.js';
import { value } from './value.js';

let W = null, nextId = 1;
const pending = new Map();

function worker() {
  if (W || typeof Worker === 'undefined') return W;
  try {
    W = new Worker(new URL('./le-worker.js', import.meta.url), { type: 'module' });
    W.onmessage = ev => {
      const m = ev.data, p = pending.get(m.id);
      if (!p) return;
      if (m.type === 'progress') p.onProgress && p.onProgress(m);
      else { pending.delete(m.id); p.resolve(m.type === 'result' ? m.result : null); if (m.type === 'error') p.onError && p.onError(m.message); }
    };
  } catch { W = null; }
  return W;
}

export function startLookElsewhere(params = {}, { onProgress, onError } = {}) {
  const id = nextId++;
  // A new run replaces older ones.
  for (const [oid, p] of pending) { pending.delete(oid); p.resolve(null); }
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  const w = worker();
  if (w) {
    pending.set(id, { resolve, onProgress, onError });
    w.postMessage({ cmd: 'run', id, params });
    return { id, promise, cancel() { if (pending.has(id)) { w.postMessage({ cmd: 'cancel', id }); } } };
  }
  // Fallback: slices on the page.
  let cancelled = false;
  pending.set(id, { resolve, onProgress });
  const v = value();
  const it = lookElsewhereSteps({ ...params, candidate: { ...v.numerator, D: v.denominator } });
  const tick = () => {
    if (cancelled || !pending.has(id)) { pending.delete(id); resolve(null); return; }
    const t0 = Date.now(); let s;
    do { s = it.next().value; } while (!s.done && Date.now() - t0 < 16);
    if (s.done) { pending.delete(id); resolve(s.result); return; }
    onProgress && onProgress({ type: 'progress', id, progress: s.progress, scanned: s.scanned, total: s.total, rawHits: s.rawHits });
    setTimeout(tick, 0);
  };
  setTimeout(tick, 0);
  return { id, promise, cancel() { cancelled = true; } };
}
