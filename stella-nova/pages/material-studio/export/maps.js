// ============================================================================
//  MATERIAL STUDIO  ·  export/maps.js — MaterialMaps at the export resolution
// ────────────────────────────────────────────────────────────────────────────
//  withMaps(res, fn) gives fn a MaterialMaps set at res. The preview res
//  uses state.maps. Another res uses bake.bakeAt, then bake.bakeOnce, and
//  last the preview res swap: setRes(res), waitBake, then setRes(prev).
//
//  GREP TARGETS
//      waitBake  withMaps
// ============================================================================
import { C, S } from './ctx.js';

function waitBake(ms = 120000) {
  return new Promise((res, rej) => {
    const offs = [];
    const done = f => v => { offs.forEach(o => o()); clearTimeout(t); f(v); };
    offs.push(C.store.on('bake:done', done(res)));
    offs.push(C.store.on('bake:error', done(e => rej(new Error('Bake failed: ' + (e && e.message))))));
    const t = setTimeout(() => { offs.forEach(o => o()); rej(new Error(`No bake:done in ${ms / 1000} s`)); }, ms);
  });
}

/**
 * Run fn(maps) with MaterialMaps at `res`. The same res as the preview uses
 * state.maps. Another res calls __studio.bake.bakeAt(res) when the bake module
 * has it; otherwise it changes the preview resolution, waits for bake:done,
 * and puts the old resolution back after fn.
 */
export async function withMaps(res, fn, progress) {
  const cur = S.maps;
  if (!res || (cur && cur.res === res)) {
    if (!cur) throw new Error('Nothing is baked yet. Wait for the bake, then export.');
    return fn(cur);
  }
  const bake = window.__studio?.bake;
  if (bake && typeof bake.bakeAt === 'function') {
    progress?.(`baking ${res}²`, 0.02);
    const m = await bake.bakeAt(res);
    try { return await fn(m); } finally { try { m.release?.(); } catch (e) {} }
  }
  // bake.bakeOnce(res) makes a private map set: no bake:done, no preview flicker.
  if (bake && typeof bake.bakeOnce === 'function') {
    progress?.(`baking ${res}²`, 0.02);
    const m = await bake.bakeOnce(res);
    m.res = m.res || res;
    try { return await fn(m); } finally { try { m.destroy?.(); } catch (e) {} }
  }
  const prev = S.settings.res;
  progress?.(`baking ${res}² (preview res swaps for the export)`, 0.02);
  const wait = waitBake();
  C.store.setRes(res);
  const m = await wait;
  try { return await fn(m); }
  finally { if (S.settings.res !== prev) C.store.setRes(prev); }
}
