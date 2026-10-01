// ============================================================================
//  MATERIAL STUDIO  ·  viewport/material.js — material sets, bake results, compare A side
// ────────────────────────────────────────────────────────────────────────────
//  A material set is the six map textures, the scalars, a uniform buffer and
//  the group 1 bind group. R.cur is the set on screen. R.def holds flat
//  defaults before the first bake, R.test the test maps. R.A is side A of
//  the compare view, and R.lastCopy is a copy of the last bake for the
//  'prev' compare mode. A set that is `owned` is destroyed by the viewport.
//
//  GREP TARGETS
//      SNAP_MAX ............... largest snapshot side, texels
//      makeMatSet / destroySet  make and release a set
//      defaultSet ............. 4x4 flat default maps
//      setMaps ................ show a bake result (bake:done)
//      snapshot ............... copy a set into viewport-owned textures
//      pinA ................... pin the current maps as side A
//      useTestMaps ............ show the test maps until the next bake
// ============================================================================
import * as C from '../contract.js';
import { MAT_FLOATS, device, store, state, R } from './state.js';
import { mapTexture, writeHalf } from './textures.js';
import { makeTestMaps } from './test-maps.js';
import { blitPipeline } from './pipelines.js';
import { requestRender } from './render.js';
import { updateStats } from './hud.js';

const SNAP_MAX = 1024;

/**
 * A material set: the six map textures, the scalars, a uniform buffer and
 * the group 1 bind group. `owned` sets are destroyed by the viewport.
 */
export function makeMatSet(tex, scalars, owned, res, label) {
  const fill = R.def ? R.def.tex : null;
  const t = {};
  for (const k of C.MAP_NAMES) t[k] = tex[k] || (fill && fill[k]);
  const ubuf = device.createBuffer({ label: 'vp-mat-' + label, size: MAT_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bg = device.createBindGroup({
    label: 'vp-mat-' + label,
    layout: R.layout.mat,
    entries: [
      { binding: 0, resource: { buffer: ubuf } },
      ...C.MAP_NAMES.map((k, i) => ({ binding: i + 1, resource: t[k].createView() })),
      { binding: 7, resource: R.samp.map },
    ],
  });
  return { tex: t, scalars: { ...C.DEFAULT_SCALARS, ...(scalars || {}) }, owned, ubuf, bg, res, label, version: ++R.matVersion };
}

export function destroySet(s) {
  if (!s) return;
  if (s.owned) for (const k of C.MAP_NAMES) { try { s.tex[k] && s.tex[k] !== R.def?.tex[k] && s.tex[k].destroy(); } catch (e) {} }
  try { s.ubuf.destroy(); } catch (e) {}
}

/** Flat defaults for slots before the first bake (contract MATERIAL_INPUTS defaults). */
export function defaultSet() {
  const v = {
    albedo: [0.8, 0.8, 0.8, 1], normal: [0.5, 0.5, 1, 1], orm: [1, 0.5, 0, 1],
    height: [0.5, 0.5, 0.5, 1], emissive: [0, 0, 0, 1], extra: [0, 0.1, 0, 0],
  };
  const tex = {};
  for (const k of C.MAP_NAMES) {
    tex[k] = mapTexture('vp-default-' + k, 4);
    writeHalf(tex[k], 4, (u, w, px) => { px[0] = v[k][0]; px[1] = v[k][1]; px[2] = v[k][2]; px[3] = v[k][3]; });
  }
  return makeMatSet(tex, C.DEFAULT_SCALARS, true, 4, 'default');
}

/**
 * Show a bake result. Called on bake:done. In compare 'prev' mode the old
 * snapshot becomes A and the new maps are copied for the next swap.
 * @param {import('./contract.js').MaterialMaps} maps
 * @param {import('./contract.js').Scalars} [scalars]
 */
export function setMaps(maps, scalars) {
  if (!device || !maps) return;
  const sc = scalars || maps.scalars || state.scalars;
  if (R.cur && R.cur !== R.def && R.cur !== R.test && !R.cur.owned) destroySet({ ...R.cur, owned: false });
  R.cur = makeMatSet(maps, sc, false, maps.res || 0, 'bake');
  if (state.view.compare === 'prev') {
    if (R.lastCopy) { destroySet(R.A); R.A = R.lastCopy; R.A.label = 'previous'; }
    R.lastCopy = snapshot(R.cur, 'last');
  }
  R.shadowSig = '';
  updateStats();
  requestRender();
}

/** Copy a set into viewport-owned textures (at most SNAP_MAX texels a side). */
export function snapshot(src, label) {
  const res = Math.max(4, Math.min(SNAP_MAX, src.res || src.tex.albedo.width || 4));
  const enc = device.createCommandEncoder();
  const out = {};
  for (const k of C.MAP_NAMES) {
    out[k] = mapTexture(`vp-${label}-${k}`, res);
    const bg = device.createBindGroup({ layout: R.layout.blit, entries: [{ binding: 0, resource: src.tex[k].createView() }, { binding: 1, resource: R.samp.clamp }] });
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: out[k].createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    pass.setPipeline(blitPipeline()); pass.setBindGroup(0, bg); pass.draw(3); pass.end();
  }
  device.queue.submit([enc.finish()]);
  return makeMatSet(out, src.scalars, true, res, label);
}

/** Pin the current maps as side A of the compare view. */
export function pinA() {
  if (!device || !R.cur) return;
  destroySet(R.A);
  R.A = snapshot(R.cur, 'pinned');
  R.A.label = 'pinned';
  if (state.view.compare === 'off' || state.view.compare === 'prev') store.setView({ compare: 'pinned' });
  else requestRender();
  store.toast('Pinned the current material as A', 'ok', 1600);
}

/** Show synthetic test maps until the next bake. */
export function useTestMaps(res = 512) {
  if (!device) return false;
  if (!R.test || R.test.res !== res) { destroySet(R.test); const m = makeTestMaps(res); R.test = makeMatSet(m, m.scalars, true, res, 'test'); }
  R.cur = R.test; R.shadowSig = '';
  requestRender();
  return true;
}
