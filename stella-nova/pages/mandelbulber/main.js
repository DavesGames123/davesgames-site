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
import { $, canvas } from './ui/dom.js';
import { P, CAT, EXAMPLES, COLLECTIONS, isNone, loadData } from './ui/data.js';
import { scene, activeSlot, engine, info, setScene, setEngine, targetSamples, renderScale, pixelRatio } from './ui/state.js';
import { compileStatus, setStatus, showHud, fail } from './ui/hud.js';
import { camFromScene, camToScene, frameView } from './ui/camera.js';
import { setMain, setSlot, loadScene } from './ui/scene.js';
import { initTip } from './ui/controls.js';
import {  } from './ui/thumbs.js';
import { loadText, exportText, initIo, shareHash, decodeShare, readHash } from './ui/io.js';
import { exampleScene, loadExample } from './ui/presets.js';
import { buildPanel, initPeek } from './ui/panel.js';
import { openPicker, choose, initPicker } from './ui/picker.js';
import { syncViewport, initSheets } from './ui/sheets.js';
import { randomExample, openExamples, closeExamples, initPresetSheet } from './ui/preset-sheet.js';
import { L, applyLayout, initLayout, snapTo, togglePanel,
  observeCanvas } from './ui/layout.js';
import { initSheetDrag } from './ui/sheet-drag.js';
import { fly, toggleFly, initFly } from './ui/fly.js';
import { inertia, initPointer } from './ui/pointer.js';
import { initKeys } from './ui/keys.js';
import { tick } from './ui/loop.js';

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

// ─── keys ───────────────────────────────────────────────────────────────────
initKeys();
// ─── status ─────────────────────────────────────────────────────────────────
// ─── frame loop ─────────────────────────────────────────────────────────────
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
