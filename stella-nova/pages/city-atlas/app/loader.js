// ============================================================================
//  LOADER  ·  city-atlas/app/loader.js — city files and their GPU slots
// ----------------------------------------------------------------------------
//  worker.js decodes each city file off the main thread in two stages.
//  requestCity resolves on the first stage (terrain, sea, wind arrays);
//  r.full is a promise of the second stage (building mesh and raster), so a
//  city can draw its terrain before its buildings exist. slotFor uploads a
//  city to the GPU once; trimSlots frees the slots and decodes no view needs.
//  loadLog keeps the timing of each city load for the debug handle.
//
//  grep -n targets
//    load timing .......... "export const loadLog"
//    worker request ....... "export function requestCity"
//    GPU slot ............. "export async function slotFor"
//    idle preload ......... "export function preloadWhenIdle"
//    slot trim ............ "export function trimSlots"
// ============================================================================

import { S, pending, slots, invalidate, pageUrl } from './state.js';
import { coarse } from './dom.js';
import { waterBearing } from './view.js';

export const loadLog = { cur: null, list: [] };

export function requestCity(i) {
  const c = S.cities[i];
  if (pending.has(c.id)) return pending.get(c.id);
  const worker = S.worker;
  let fullOk, fullErr;
  const full = new Promise((res, rej) => { fullOk = res; fullErr = rej; });
  full.catch(() => {});
  const p = new Promise((resolve, reject) => {
    let base = null;
    const onMsg = (e) => {
      if (e.data.id !== c.id) return;
      const r = e.data;
      if (!r.ok) {
        worker.removeEventListener('message', onMsg);
        const err = new Error(r.error);
        if (base) fullErr(err); else { reject(err); fullErr(err); }
        return;
      }
      if (r.stage === 'base') {
        base = r;
        r.timing.baseAt = performance.now();
        const tb = performance.now();
        r.meta._bearing = waterBearing(r);
        r.timing.bearingMs = performance.now() - tb;
        r.full = full;
        resolve(r);
      } else {
        worker.removeEventListener('message', onMsg);
        Object.assign(base.timing, r.timing, { fullAt: performance.now() });
        fullOk(r);
      }
    };
    worker.addEventListener('message', onMsg);
    // a coarse pointer (phone, tablet) gets the lower building detail (mesh.js)
    worker.postMessage({ id: c.id, url: pageUrl(`data/${c.id}.bin`).href, rasterN: 1024, detail: coarse.matches ? 0 : 1 });
  });
  pending.set(c.id, p);
  p.catch(() => pending.delete(c.id));
  return p;
}

// GPU slot of a city: upload once, keep the current and the next one. The
// terrain uploads at once; the buildings join the slot when the worker
// sends them (renderer.addBuildings). opts.full: resolve only after that
// (the saver preloads this way, so its cut never shows a bare city).
export async function slotFor(i, opts = {}) {
  const c = S.cities[i];
  let s = slots.get(c.id);
  if (!s) {
    const data = await requestCity(i);
    s = slots.get(c.id);
    if (!s) {
      const tu = performance.now();
      s = S.renderer.upload(data);
      data.timing.uploadMs = performance.now() - tu;
      s.data = data;
      slots.set(c.id, s);
      s.built = data.full.then((f) => {
        if (s.dropped) return;
        const tb = performance.now();
        S.renderer.addBuildings(s, f);
        data.timing.buildUploadMs = performance.now() - tb;
        if (loadLog.cur?.id === c.id) Object.assign(loadLog.cur, f.timing, { buildUploadMs: data.timing.buildUploadMs, buildings: performance.now() - loadLog.cur.t0 });
        invalidate(3);
      });
      s.built.catch((err) => console.warn('city-atlas: buildings failed', c.id, err));
    }
  }
  if (opts.full) await s.built.catch(() => {});
  return s;
}

// Decode the next city in the worker, but only when the page is idle: no
// input for 2 s, and an idle callback (Safari has none: a 2 s timer). It is
// not uploaded to the GPU until it is picked.
export function preloadWhenIdle(token, i) {
  const go = () => {
    if (token !== S.switchToken || S.saver) return;
    if (performance.now() - S.lastInput < 2000) { setTimeout(() => preloadWhenIdle(token, i), 2000); return; }
    requestCity(i).catch(() => {});
  };
  if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 4000 }); else setTimeout(go, 2000);
}

// GPU slots: the current city, the one before it (a quick way back) and
// any ids the caller names. Decoded cities outside the slots are freed.
const recent = [];
export function trimSlots(keepIds) {
  const cur = keepIds[0];
  if (cur && recent[0] !== cur) { recent.unshift(cur); recent.length = Math.min(recent.length, 2); }
  keepIds = [...keepIds, ...recent];
  for (const [id, s] of slots) {
    if (keepIds.includes(id)) continue;
    S.renderer.drop(s);
    slots.delete(id);
  }
  for (const id of [...pending.keys()]) if (!keepIds.includes(id) && !slots.has(id)) pending.delete(id);
}
