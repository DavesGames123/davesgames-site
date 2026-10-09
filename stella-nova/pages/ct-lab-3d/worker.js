// ============================================================================
//  CT LAB 3D  ·  worker.js — SIRT off the main thread (module Web Worker)
// ----------------------------------------------------------------------------
//  The iterative option is too slow for a frame: one 3D SIRT iteration is a
//  full forward and a full back projection. main.js starts this worker with
//  { entry, codes, n, settings, iterations }. The worker builds the same
//  volume and the same scan (same seed, so the same noise) and posts
//  { iter, residual, data } after each iteration, then { done }.
//  'stop' ends it at once (main.js also terminates the worker).
// ============================================================================
import { toVolume } from './lib/objects.js';
import { createSession } from './lib/session.js';

let stop = false;
self.onmessage = async (e) => {
  const m = e.data;
  if (m === 'stop') { stop = true; return; }
  try {
    const vol = toVolume(m.entry, m.codes, m.n);
    const s = createSession(m.entry, vol, m.settings);
    for (let a = 0; a < s.total && !stop; a += 8) s.scan(8);
    for (let k = 0; k < m.iterations && !stop; k++) {
      const r = s.sirtStep(1);
      const copy = new Float32Array(r.volume.data);
      self.postMessage({ iter: r.iter, residual: r.residual, data: copy, dims: [vol.nx, vol.ny, vol.nz] }, [copy.buffer]);
      await new Promise((res) => setTimeout(res, 0));   // let a 'stop' in
    }
    self.postMessage({ done: true });
  } catch (err) {
    self.postMessage({ error: String(err && err.message || err) });
  }
};
