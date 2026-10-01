// ui/scene.js — Mandelbulber page: changes to the scene and the hand-off to the engine.
//
// setMain and setSlot change one param, loadScene replaces the whole scene. Each change
// sets sceneDirty, so the frame loop calls pushScene, which gives the engine a copy of
// the scene. touch runs the fast preview and the share-link update after each change.
//
// grep: let sceneDirty  function touch  function setMain  function setSlot  function loadScene
//       let scenePromise  function pushScene

import { quantizeColor } from '../fract.js';
import { P, mainSpec } from './data.js';
import { scene, engine, setScene, setActiveSlot, setInfo } from './state.js';
import { setStatus, flash } from './hud.js';
import { refreshAll } from './controls.js';
import { writeHash } from './io.js';
import { buildSlotEditor } from './panel.js';
import { stopInertia } from './pointer.js';

export let sceneDirty = true;
let previewTimer = 0, previewOn = false;

// Each change shows a fast preview. Full quality comes back 150 ms after the last change, but
// only once the preview of that change is on screen (a slow band can hold it up), so a single
// click on a control still shows its effect at once.
export function touch() {
  sceneDirty = true;
  if (engine) {
    if (!previewOn) { engine.setPreview(true); previewOn = true; }
    const shown = engine.stats?.().presents ?? 0;
    const t0 = performance.now();
    const back = () => {
      if ((engine.stats?.().presents ?? 1) === shown && performance.now() - t0 < 3000) { previewTimer = setTimeout(back, 50); return; }
      previewOn = false; engine.setPreview(false); engine.reset(); setInfo(null);
    };
    clearTimeout(previewTimer);
    previewTimer = setTimeout(back, 150);
  }
  writeHash();
}

export function setMain(name, v) {
  if (mainSpec(name)?.type === 'rgb') v = quantizeColor(v);
  scene.main[name] = v;
  if (/^formula_\d$|^hybrid_fractal_enable$/.test(name)) buildSlotEditor();
  refreshAll();
  touch();
}

export function setSlot(s, name, v) {
  if (P.fractal[name]?.type === 'rgb') v = quantizeColor(v);
  scene.fractal[s][name] = v;
  refreshAll();
  touch();
}

export function loadScene(next, label) {
  stopInertia();
  setScene(next);
  setActiveSlot(0);
  buildSlotEditor();
  refreshAll();
  sceneDirty = true;
  engine?.reset();
  setInfo(null);
  writeHash();
  if (label) flash(label);
}

// Hand the engine a snapshot, so a compile that finishes late sees the scene it was given.
export let scenePromise = Promise.resolve();
export function pushScene() {
  sceneDirty = false;
  const onErr = (e) => { setStatus(`error: ${e.message}`); console.error(e); };
  try { scenePromise = Promise.resolve(engine.setScene(structuredClone(scene))).catch(onErr); } catch (e) { onErr(e); }
  setInfo(null);
}
