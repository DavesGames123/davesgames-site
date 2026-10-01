// ui/loop.js — Mandelbulber page: the frame loop, the render pause and the PNG save.
//
// tick runs once per animation frame. It moves the camera for fly mode and inertia,
// updates the HUD (every 150 ms), gives a changed scene to the engine, and calls
// engine.frame() until the target sample count. renderPaused stops the render work
// while nobody can see it. savePng asks for a save; tick writes the PNG after one full
// sample, from the canvas.
//
// grep: function renderPaused  let saveRequested  function savePng  function tick

import { canvas, panel, picker, exSheet, download } from './dom.js';
import { isNone } from './data.js';
import { engine, info, setInfo, formulaAt, targetSamples } from './state.js';
import { setStatus, flash, msPerSample, setMsPerSample, showHud } from './hud.js';
import { sceneDirty, pushScene } from './scene.js';
import { L, sheetDragging } from './layout.js';
import { flyStep } from './fly.js';
import { inertiaStep } from './pointer.js';

// No render work while nobody can see it: a sheet drag, a full sheet, a full-screen list.
export function renderPaused() {
  if (saveRequested) return false;
  if (sheetDragging) return true;
  if (L.mode === 'sheet' && L.snap === 'full' && !panel.classList.contains('hidden')) return true;
  return L.mode !== 'float' && (!picker.classList.contains('hidden') || !exSheet.classList.contains('hidden'));
}

let saveRequested = false;
export function savePng() { if (!engine) return flash('no renderer: nothing to save'); saveRequested = true; }

let lastT = performance.now(), lastFrameT = 0, hudT = 0;
export function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min((now - lastT) / 1000, 0.1);
  lastT = now;
  if (document.hidden || !engine) return;
  flyStep(dt);
  inertiaStep(dt);
  if (now - hudT > 150) { hudT = now; showHud(); }
  if (renderPaused()) { lastFrameT = 0; return; }
  if (sceneDirty) pushScene();
  const want = !info || info.compiling || (info.samples < targetSamples.value && !info.done);
  if (want || saveRequested) {
    try {
      const t0 = performance.now();
      const r = engine.frame();
      if (r) setInfo(r);
      const st = engine.stats?.();
      if (st && Number.isFinite(st.lastSampleMs) && st.lastSampleMs > 0) setMsPerSample(st.lastSampleMs);
      else if (lastFrameT && !info?.compiling) setMsPerSample(msPerSample ? msPerSample * 0.85 + (t0 - lastFrameT) * 0.15 : t0 - lastFrameT);
      lastFrameT = t0;
    } catch (e) { setStatus(`error: ${e.message}`); console.error(e); }
    if (saveRequested && (info?.samples ?? 0) > 0) {   // wait for one full sample; the canvas keeps the last presented image
      saveRequested = false;
      const f = formulaAt(0);
      const name = `mandelbulber-${isNone(f) ? 'scene' : f.id}-${info?.samples ?? 0}spp.png`;
      canvas.toBlob((b) => (b ? (download(b, name), flash(`saved ${name}`)) : flash('save failed')), 'image/png');
    }
  } else lastFrameT = 0;
}
