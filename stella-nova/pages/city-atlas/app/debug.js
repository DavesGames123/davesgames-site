// ============================================================================
//  DEBUG  ·  city-atlas/app/debug.js — the debug handle window.__cityAtlas
// ----------------------------------------------------------------------------
//  Debug handle for the console and the headless checks: readiness, frame
//  and load counters, timing medians, the state, and calls that set the
//  overlays, the city, the camera and the sheets. bootLog holds the boot
//  times that main.js start() writes.
//
//  grep -n targets
//    boot times ........... "export const bootLog"
//    handle ............... "export function installDebug"
//    timing medians ....... "get perf()"
// ============================================================================

import { S, ov, cam, invalidate } from './state.js';
import { canvas, fadeEl } from './dom.js';
import { med } from './quality.js';
import { loadLog } from './loader.js';
import { quality } from './layout.js';
import { stats } from './loop.js';
import { fillParams } from './foot.js';
import { setOverlay, syncLayers, pushWind } from './drawer.js';
import { setCaption, setAtlas, setLayers } from './sheets.js';
import { switchTo } from './switch.js';

export const bootLog = {};

export function installDebug() {
  window.__cityAtlas = {
    get ready() { return !!S.meta && document.body.classList.contains('shown') && fadeEl.classList.contains('clear'); },
    get frames() { return stats.drawn; },
    get city() { return S.meta?.id; },
    get loads() { return loadLog.list; },
    get boot() { return { ...bootLog, r: S.renderer?.info.boot }; },
    get perf() {
      const r = S.renderer;
      return { cpuMs: med(stats.cpu), rafMs: med(stats.gaps), gpuMs: med(r?.info.gpuHist || []), gpuMax: Math.max(0, ...(r?.info.gpuHist || [])), q: quality.level, pass: r?.info.pass, idleFrames: stats.idle, drawn: stats.drawn, shadowDraws: r?.info.shadowDraws, msaa: r?.info.sampleCount, tris: r?.info.tris, renderScale: S.renderScale, w: canvas.width, h: canvas.height };
    },
    get state() { return { ov: JSON.parse(JSON.stringify(ov)), cam: { ...cam }, hour: S.hour, renderScale: S.renderScale, gpuMs: S.renderer?.info.gpuMs, tris: S.renderer?.info.tris }; },
    overlay: (k, v) => setOverlay(k, v),
    go: (id) => { const i = S.cities.findIndex((c) => c.id === id); if (i >= 0) return switchTo(i); return null; },
    set: (patch) => { for (const [k, v] of Object.entries(patch)) Object.assign(ov[k], v); syncLayers(); fillParams(); pushWind(); },
    view: (v) => { Object.assign(cam, v); S.lastInput = performance.now(); invalidate(3); },
    layers: (o) => setLayers(o),
    about: (o) => setCaption(o),
    atlas: (o) => setAtlas(o),
  };
}
