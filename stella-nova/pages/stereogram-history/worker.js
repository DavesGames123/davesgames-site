// ============================================================================
//  STEREOGRAM HISTORY  ·  worker.js — module worker around jobs.js
// ----------------------------------------------------------------------------
//  in  { id, op, args }   out { id, ok: true, result } | { id, ok: false,
//  error }. The typed arrays of a result go back as transfers.
// ============================================================================
import { handle, transfers } from './jobs.js';

self.onmessage = async e => {
  const { id, op, args } = e.data || {};
  try {
    const result = await handle(op, args);
    self.postMessage({ id, ok: true, result }, [...transfers(result)]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
