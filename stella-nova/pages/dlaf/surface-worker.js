// ============================================================================
//  DLAF PAGE  ·  surface-worker.js — the SDF mesher off the main thread
// ----------------------------------------------------------------------------
//  A module worker around surface-core.js, so the growth and the draw stay
//  smooth while lib/dla-sdf.js recomputes and meshes the bricks.
//
//  Messages in (from surface.js):
//    { type: 'reset', gen, opts }                 a new surface (surfaceOptions)
//    { type: 'add', gen, from, pos, parent }      particles from.. (pos Float32 xyz, parent Int32)
//    { type: 'finish', gen }                      the growth stopped: flush the radius steps
//  Messages out:
//    { type: 'mesh', gen, list, applied, busy, verts, tris }
//      list: records { key, positions, normals, ids, ao, indices } (copies)
//  gen counts the resets, so surface.js drops the results of an old one.
//  With no 'add' for 300 ms the worker flushes the radius steps by itself.
//
//  grep -n targets
//    the tick .............. "function tick"
// ============================================================================
import { createSurfaceCore } from './surface-core.js';

let core = null, gen = 0, timer = 0, lastAdd = 0, flushed = true;
const BUDGET = 14;

function post(list) {
  postMessage({ type: 'mesh', gen, list, applied: core.count, busy: core.busy, verts: core.stats.verts, tris: core.stats.tris });
}

function tick() {
  timer = 0;
  if (!core) return;
  if (!flushed && performance.now() - lastAdd > 300) { core.finish(); flushed = true; }
  const list = core.busy ? core.update(BUDGET) : [];
  post(list);
  if (core.busy || !flushed) schedule(core.busy ? 0 : 320);
}
function schedule(ms = 0) { if (!timer) timer = setTimeout(tick, ms); }

globalThis.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'reset') { gen = m.gen; core = createSurfaceCore(m.opts); flushed = true; schedule(); return; }
  if (!core || m.gen !== gen) return;
  if (m.type === 'add') {
    core.add(m.pos, m.parent, m.from, m.from + m.parent.length, m.from);
    lastAdd = performance.now(); flushed = false;
    schedule();
    return;
  }
  if (m.type === 'finish') { core.finish(); flushed = true; schedule(); }
};
