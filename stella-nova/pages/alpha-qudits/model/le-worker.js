// ============================================================================
//  ALPHA QUDITS  ·  model/le-worker.js  ·  module worker for the look-elsewhere count (MODEL)
// ----------------------------------------------------------------------------
//  Protocol (postMessage):
//    in  { cmd: 'run', id, params }   start a count; a new run replaces the old
//    in  { cmd: 'cancel', id }        stop the run with that id
//    out { type: 'progress', id, progress (0..1), scanned, total, rawHits }
//    out { type: 'result', id, result }        (see look-elsewhere.js)
//    out { type: 'cancelled', id }
//    out { type: 'error', id, message }
//  The run works in time slices of about 30 ms and yields to the event
//  loop between slices, so a cancel message is handled at once.
//
//  grep -n targets:  function run | self.onmessage | SLICE_MS
// ============================================================================
import { lookElsewhereSteps } from './look-elsewhere.js';
import { value } from './value.js';

const SLICE_MS = 30;
let current = null;
const now = () => (globalThis.performance ? performance.now() : Date.now());
const yieldNow = () => new Promise(r => setTimeout(r, 0));

async function run(id, params) {
  const job = { id, cancelled: false };
  if (current) current.cancelled = true;
  current = job;
  try {
    const v = value();
    const candidate = { ...v.numerator, D: v.denominator };
    const it = lookElsewhereSteps({ ...params, candidate });
    for (;;) {
      if (job.cancelled) { self.postMessage({ type: 'cancelled', id }); return; }
      const t0 = now();
      let step;
      do { step = it.next().value; } while (!step.done && now() - t0 < SLICE_MS);
      if (step.done) { self.postMessage({ type: 'result', id, result: step.result }); if (current === job) current = null; return; }
      self.postMessage({ type: 'progress', id, progress: step.progress, scanned: step.scanned, total: step.total, rawHits: step.rawHits });
      await yieldNow();
    }
  } catch (e) {
    self.postMessage({ type: 'error', id, message: String(e && e.message || e) });
  }
}

self.onmessage = ev => {
  const m = ev.data || {};
  if (m.cmd === 'run') run(m.id, m.params || {});
  else if (m.cmd === 'cancel' && current && (m.id == null || current.id === m.id)) current.cancelled = true;
};
