// ============================================================================
//  DLA TERRAIN  ·  gpu/stub-worker.js — the worker protocol over the stub (CORE)
// ----------------------------------------------------------------------------
//  The LIB protocol of CONTRACT.md on gpu/stub-terrain.js, for the time
//  before lib/dla-terrain-worker.js exists:
//    { type: 'generate', id, opts } -> { type: 'progress', id, stage, label,
//    frac, snapshot } ... { type: 'done', id, terrain } | { type: 'error', id, message }
// ============================================================================
import { generateTerrain } from './stub-terrain.js';

const buffers = o => {
  const out = [];
  for (const k in o) { const v = o[k]; if (v && v.buffer instanceof ArrayBuffer && !out.includes(v.buffer)) out.push(v.buffer); }
  return out;
};
self.onmessage = async e => {
  const m = e.data;
  if (!m || m.type !== 'generate') return;
  try {
    const t = await generateTerrain(m.opts, p => {
      const s = p.snapshot;
      self.postMessage({ type: 'progress', id: m.id, stage: p.stage, label: p.label, frac: p.frac, snapshot: s }, s ? buffers(s) : []);
    });
    self.postMessage({ type: 'done', id: m.id, terrain: t }, buffers(t));
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) });
  }
};
