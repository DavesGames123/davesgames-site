// ============================================================================
//  PLANT GROWTH  ·  the model in a module worker
// ----------------------------------------------------------------------------
//  main.js posts { cmd: 'start', token, opts } (opts as grow.js createSim).
//  The worker steps the model one year at a time and posts each year's
//  snapshot: { type: 'year', token, snap }, then { type: 'done', token }.
//  A new start (or { cmd: 'stop' }) ends the old run; a message with an old
//  token is dropped on the main thread. The large arrays are transferred,
//  not copied (the per-year history arrays stay with the model).
// ============================================================================
import { createSim } from './grow.js';

let sim = null, token = -1;

self.onmessage = e => {
  const m = e.data || {};
  if (m.cmd === 'start') {
    token = m.token;
    try { sim = createSim(m.opts || {}); } catch (err) { postMessage({ type: 'error', token, message: String(err && err.message || err) }); return; }
    step(token);
  } else if (m.cmd === 'stop') { sim = null; token = -1; }
};

function step(tk) {
  if (!sim || tk !== token) return;
  if (sim.done) { postMessage({ type: 'done', token: tk }); return; }
  const t0 = performance.now();
  sim.stepYear();
  const snap = sim.snapshot();
  snap.ms = performance.now() - t0;
  const keep = new Set([snap.radius, snap.light, snap.vigor, snap.tips].map(a => a.buffer));
  const transfer = [];
  for (const k in snap) { const v = snap[k]; if (v && v.buffer instanceof ArrayBuffer && !keep.has(v.buffer)) transfer.push(v.buffer); }
  postMessage({ type: 'year', token: tk, snap }, transfer);
  setTimeout(() => step(tk), 0);
}
