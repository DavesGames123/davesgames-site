// ============================================================================
//  DLA TERRAIN  ·  world/hydro-worker.js — the page terrain worker: LIB's
//  generateTerrain, then the bodies of water (world/hydro-lakes.js)
// ----------------------------------------------------------------------------
//  Module worker, the same protocol as lib/dla-terrain-worker.js (CONTRACT):
//    in   { type: 'generate', id, opts }   (page opts: LIB keys + water keys)
//    out  { type: 'progress', id, stage, label, frac, stageFrac, snapshot }
//         ... { type: 'done', id, terrain }  or  { type: 'error', id, message }
//    in   { type: 'cancel', id }
//  The LIB runs with libOptions(opts) (its own "lakes" from lakeMode); the
//  last progress before 'done' is { stage: 'biomes', label: 'Lakes and
//  seas' } with no snapshot. terrain.lakeId (Int16Array) and
//  terrain.waterBodies (counts, ms) are new fields; the typed arrays are
//  transferred.
//
//  grep -n targets: "function arraysOf", "async function run", "onmessage"
// ============================================================================

import { generateTerrain, terrainTransferables } from '../../../lib/dla-terrain.js';
import { applyWaterBodies, libOptions, waterTransferables } from './hydro-lakes.js';

const cancelled = new Set();
let active = null;

function arraysOf(snap) {
  const out = [];
  if (!snap) return out;
  for (const k in snap) {
    const v = snap[k];
    if (ArrayBuffer.isView(v)) out.push(v.buffer);
    else if (v && typeof v === 'object') for (const j in v) if (ArrayBuffer.isView(v[j])) out.push(v[j].buffer);
  }
  return out;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function run(id, opts) {
  active = id;
  try {
    const o = opts || {};
    const terrain = await generateTerrain(libOptions(o), async (p) => {
      self.postMessage({ type: 'progress', id, stage: p.stage, label: p.label, frac: p.frac, stageFrac: p.stageFrac, snapshot: p.snapshot }, arraysOf(p.snapshot));
      await tick();
      if (cancelled.has(id)) throw new Error('cancelled');
    });
    self.postMessage({ type: 'progress', id, stage: 'biomes', label: 'Lakes and seas', frac: 1, stageFrac: 1, snapshot: null });
    await tick();
    if (cancelled.has(id)) throw new Error('cancelled');
    try { applyWaterBodies(terrain, o); } catch (e) { terrain.waterBodies = { error: String((e && e.message) || e) }; }
    // one buffer once in the list (a river slice has its own buffer)
    const list = [...new Set([...terrainTransferables(terrain), ...waterTransferables(terrain)])];
    self.postMessage({ type: 'done', id, terrain }, list);
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String((err && err.message) || err) });
  } finally {
    cancelled.delete(id);
    if (active === id) active = null;
  }
}

self.onmessage = (e) => {
  const m = e.data || {};
  if (m.type === 'cancel') { cancelled.add(m.id); return; }
  if (m.type !== 'generate') return;
  if (active != null && active !== m.id) cancelled.add(active);
  run(m.id, m.opts);
};
