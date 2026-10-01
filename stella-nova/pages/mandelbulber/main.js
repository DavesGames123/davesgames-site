// main.js — Mandelbulber page: panel, formula slots, camera input, frame loop.
//
// Part of a port of Mandelbulber2 (Mandelbulber Team, github.com/buddhi1980/
// mandelbulber2, GPL-3.0, see COPYING). The camera math follows upstream
// cCameraTarget (src/camera_target.cpp); the slot and render param names are
// the upstream ones, so the scene object stays in upstream units (contract C5).
//
// The GPU work lives in engine.js (contract C6). This file keeps one scene
// object, builds the panel from gen/catalog.json and gen/params.json, and calls
// engine.frame() once per animation frame until the target sample count.
//
//   drag        orbit around the target       wheel        dolly
//   right drag  pan (or Shift + drag)         F            fly mode on / off
//   V           frame the surface (also runs when slot 1 changes with no example loaded)
//   W A S D     fly: move (Shift = fast)      Q E          fly: down / up
//   P           panel on / off                Esc          close the formula list
//
// Touch: one finger orbits (with inertia), two fingers pinch to dolly and drag to pan,
// a double tap runs Frame, a long press opens a menu (Frame, Reset view, Fly). In fly mode
// two thumbsticks move and look. On a phone the panel is a bottom sheet (peek, half, full)
// or, in landscape, a right drawer. The canvas then covers only the free area, so the
// camera target and Frame center in the part of the screen the user sees.
//
// The URL hash holds the scene diff against the defaults as deflated .fract
// text (#s=...), so a link reopens the same scene.
//
// grep: function boot  function buildPanel  function buildSlotEditor  function openPicker  function ctl
//       function gradientEditor  function loadScene  function exportFract  function writeHash  function readHash
//       function camFromScene  function camToScene  function frameView  function pushScene  function tick
//       function savePng  const MAIN_UI  const SLOT_COMMON  const CREDIT
//       function applyLayout  function pickMode  function snapTo  function sheetDrag  function syncViewport
//       function openExamples  function openCtx  function showTip  function stick  function inertiaStep
//       function renderPaused  const pixelRatio  const renderScale
//       function prepareExamples  function presetFamily  function presetThumb  function randomExample
//       function buildExamples  function filterExSheet  const SOURCES  const FAMILIES

import { defaultScene, parseFract } from './fract.js';
import { $, canvas, panel, picker, exSheet, download } from './ui/dom.js';
import { P, CAT, EXAMPLES, COLLECTIONS, isNone, loadData } from './ui/data.js';
import { scene, activeSlot, engine, info, setScene, setEngine, setInfo, formulaAt, targetSamples, renderScale, pixelRatio } from './ui/state.js';
import { compileStatus, setStatus, flash, msPerSample, setMsPerSample, showHud, fail } from './ui/hud.js';
import { camFromScene, camToScene, frameView } from './ui/camera.js';
import { sceneDirty, setMain, setSlot, loadScene, pushScene } from './ui/scene.js';
import { refreshAll, initTip } from './ui/controls.js';
import {  } from './ui/thumbs.js';
import { loadText, exportText, initIo, shareHash, decodeShare, readHash } from './ui/io.js';
import { exampleScene, loadExample } from './ui/presets.js';
import { buildPanel, initPeek } from './ui/panel.js';
import { openPicker, closePicker, choose, initPicker } from './ui/picker.js';
import { syncViewport, initSheets } from './ui/sheets.js';
import { randomExample, openExamples, closeExamples, initPresetSheet } from './ui/preset-sheet.js';
import { L, sheetDragging, applyLayout, initLayout, snapTo, togglePanel,
  observeCanvas } from './ui/layout.js';
import { initSheetDrag } from './ui/sheet-drag.js';
import { flying, keys, fly, toggleFly, flyStep, initFly } from './ui/fly.js';
import { inertia, inertiaStep, initPointer } from './ui/pointer.js';

// ─── data ───────────────────────────────────────────────────────────────────
// ─── panel specs ────────────────────────────────────────────────────────────
// ─── small DOM helpers ──────────────────────────────────────────────────────
// ─── thumbnails ─────────────────────────────────────────────────────────────
// ─── control rows ───────────────────────────────────────────────────────────
// ─── scene changes ──────────────────────────────────────────────────────────
// ─── panel ──────────────────────────────────────────────────────────────────

// ─── formula picker ─────────────────────────────────────────────────────────
initPicker();
// ─── gradient editor (mat1_surface_color_gradient) ──────────────────────────
// ─── presets ────────────────────────────────────────────────────────────────
// ─── import / export / share ────────────────────────────────────────────────
initIo();
// ─── camera (upstream cCameraTarget) ────────────────────────────────────────
// ─── camera input ───────────────────────────────────────────────────────────
initFly();

initPointer();
initTip();

// ─── layout: floating panel, bottom sheet, right drawer ─────────────────────
initLayout();
initSheetDrag();
// ─── full-screen sheets: formula picker and examples ────────────────────────
initSheets();
initPresetSheet();
initPeek();
applyLayout();
syncViewport();

// No render work while nobody can see it: a sheet drag, a full sheet, a full-screen list.
export function renderPaused() {
  if (saveRequested) return false;
  if (sheetDragging) return true;
  if (L.mode === 'sheet' && L.snap === 'full' && !panel.classList.contains('hidden')) return true;
  return L.mode !== 'float' && (!picker.classList.contains('hidden') || !exSheet.classList.contains('hidden'));
}

// ─── keys ───────────────────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  const t = e.target;
  if (e.key === 'Escape' && !picker.classList.contains('hidden')) { closePicker(); return; }
  if (e.key === 'Escape' && !exSheet.classList.contains('hidden')) { closeExamples(); return; }
  if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (flying && 'wasdqe'.includes(k) && k.length === 1) { keys.add(k); e.preventDefault(); return; }
  if (k === 'shift') { keys.add('shift'); return; }
  if (k === 'p') togglePanel();
  else if (k === 'f') toggleFly();
  else if (k === 'v') frameView(false);
});
window.addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); if (!keys.size) refreshAll(); });
window.addEventListener('blur', () => keys.clear());
$('toggle').addEventListener('click', togglePanel);

// ─── status ─────────────────────────────────────────────────────────────────
// ─── frame loop ─────────────────────────────────────────────────────────────
let saveRequested = false;
export function savePng() { if (!engine) return flash('no renderer: nothing to save'); saveRequested = true; }

let lastT = performance.now(), lastFrameT = 0, hudT = 0;
function tick(now) {
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

// ─── boot ───────────────────────────────────────────────────────────────────
async function boot() {
  await loadData();
  $('subtitle').textContent = `${CAT.formulas.filter((f) => !isNone(f)).length} formulas · ${EXAMPLES.length} presets`;

  setScene((await readHash()) || defaultScene(P));
  buildPanel();
  applyLayout();
  showHud();

  try {
    const { createEngine } = await import('./engine.js');
    setEngine(await createEngine(canvas));
  } catch (e) {
    console.error(e);
    fail(e?.message?.includes('WebGPU') ? e.message : `The renderer did not start: ${e.message}. This page needs WebGPU (a current Chrome, Edge or Safari).`);
    return;
  }
  engine.onStatus((s) => { setStatus(String(s)); showHud(); });
  engine.setMaxSamples?.(targetSamples.value);
  engine.setFrameBudget?.(33);                         // about 30 fps while the user drags
  observeCanvas();
  requestAnimationFrame(tick);
}

// Test hooks for the headless check.
window.__mb = {
  get scene() { return scene; }, get P() { return P; }, get catalog() { return CAT; }, get info() { return info; },
  get examples() { return EXAMPLES; }, get collections() { return COLLECTIONS; }, randomExample,
  loadPreset: (key) => loadExample(EXAMPLES.findIndex((e) => e.key === key)), get activeSlot() { return activeSlot; }, get status() { return compileStatus; },
  loadPartial: (part, label) => loadScene(exampleScene(part), label),
  defaultScene: () => defaultScene(P), parseFract: (t) => parseFract(t, P), exportText, loadText, loadExample,
  shareHash, decodeShare, setMain, setSlot, openPicker, choose, targetSamples, toggleFly, camFromScene, camToScene,
  frameView, get engine() { return engine; },
  layout: L, snapTo, openExamples, closeExamples, fly, inertia, renderScale, pixelRatio, togglePanel,
};

boot().catch((e) => console.error('[mandelbulber]', e));
