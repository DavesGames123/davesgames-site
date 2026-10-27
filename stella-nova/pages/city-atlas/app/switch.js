// ============================================================================
//  SWITCH  ·  city-atlas/app/switch.js — the city switch with a short fade
// ----------------------------------------------------------------------------
//  switchTo(i) fades the map out, loads city i (app/loader.js: the GPU slot,
//  or the decoded data alone without WebGPU), shows it, sets the wind to
//  the city's prevailing wind, puts the camera at the harbour view, fills
//  the head, the foot and the drawer, and fades back in. A newer switch
//  cancels an older one (S.switchToken). Outside the saver the city goes
//  into the URL hash and the session store, and the next city preloads.
//
//  grep -n targets
//    switch ............... "export async function switchTo"
//    load failure ......... "data not available"
//    wind and camera ...... "opts.keepWind"
//    fade in .............. "classList.add('clear')"
// ============================================================================

import { S, ov, cam, lastHour, invalidate } from './state.js';
import { fadeEl, loadingEl, captionEl, storeSet, homeView } from './dom.js';
import { wait, clamp } from './text.js';
import { sunAzOf } from './view.js';
import { loadLog, requestCity, slotFor, preloadWhenIdle, trimSlots } from './loader.js';
import { buildOverlay } from './foot.js';
import { syncLayers, pushWind, liveWind } from './drawer.js';
import { setCaption } from './sheets.js';
import { syncControls } from './controls.js';
import { relayout } from './layout.js';

// opts: initial (no fade wait), fadeMs, view (camera to use), keepWind,
// keep (more slot ids to keep), cached (for the load log).
export async function switchTo(i, opts = {}) {
  const token = ++S.switchToken;
  const t0 = performance.now();
  S.locIndex = i;
  const c = S.cities[i];
  syncControls();
  if (!S.saver) {
    storeSet(c.id);
    if (location.hash.slice(1) !== c.id) history.replaceState(null, '', '#' + c.id);
  }
  fadeEl.classList.remove('clear');
  const slow = setTimeout(() => { if (token === S.switchToken) loadingEl.hidden = false; }, opts.initial ? 0 : 380);
  let s;
  try {
    [s] = await Promise.all([S.renderer ? slotFor(i) : requestCity(i).then((d) => ({ meta: d.meta, data: d })), wait(opts.initial ? 0 : (opts.fadeMs ?? 340))]);
  } catch (err) {
    clearTimeout(slow);
    if (token !== S.switchToken) return;
    console.warn('city-atlas: city load failed', c.id, err);
    loadingEl.hidden = false;
    loadingEl.lastChild.textContent = `${c.title}: data not available`;
    return;
  }
  clearTimeout(slow);
  if (token !== S.switchToken) return;
  const meta = S.meta = s.meta;
  if (S.renderer) {
    const ts = performance.now();
    S.renderer.show(s);
    loadLog.cur = { id: c.id, t0, ready: performance.now(), showMs: performance.now() - ts, ...(s.data?.timing || {}), cached: !!opts.cached };
    if (s.data?.timing?.fullAt) loadLog.cur.buildings = Math.max(0, s.data.timing.fullAt - t0);   // built before the switch
    trimSlots([c.id, ...(opts.keep || [])]);
  }
  if (!meta.current) ov.ocean.on = false;
  if (!opts.keepWind) {
    const p = meta.wind?.prevail;
    if (p && !ov.wind.live) { ov.wind.dirFrom = p.dir; ov.wind.speed = clamp(Math.round(p.speed * 2) / 2, 2, 12); }
  }
  pushWind();
  if (ov.wind.live) liveWind();
  S.hour = Math.min(S.hour, lastHour());
  S.sunAz = sunAzOf(meta);
  if (!opts.view) { Object.assign(cam, homeView(meta)); cam.target = cam.target.slice(); S.camGoal = null; }
  else Object.assign(cam, opts.view);
  buildOverlay();
  syncLayers();
  loadingEl.hidden = true;
  loadingEl.lastChild.textContent = 'Loading';
  if (!captionEl.hidden) setCaption(true);
  await document.fonts?.ready;
  if (token !== S.switchToken) return;
  relayout();
  invalidate(40);
  requestAnimationFrame(() => {
    fadeEl.classList.add('clear'); document.body.classList.add('shown');
    if (loadLog.cur && loadLog.cur.id === c.id) loadLog.cur.interactive = performance.now() - loadLog.cur.t0;
  });
  // preload the neighbours a moment later (not in the saver: it preloads its own next city)
  if (!S.saver && S.renderer) preloadWhenIdle(token, (i + 1) % S.cities.length);
}
