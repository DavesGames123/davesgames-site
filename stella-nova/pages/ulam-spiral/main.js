// ============================================================================
//  ULAM SPIRAL  ·  main.js — boot, the frame loop, the app object
// ----------------------------------------------------------------------------
//  Data path: worker.js sieves the odd numbers (bitset) -> render.js
//  uploads it as a texture -> each frame, frameState() turns S into the
//  renderer state and render.js draws it. The overlay canvas (#ov) gets
//  the labels, the diagonal lines and the cursor ring from the same
//  camera. Regions past the sieve (or past the arithmetic table) get a
//  CPU tile from the worker (Miller-Rabin), uploaded as a texture.
//
//  MODULES (app/, one concern each; S and rt in state.js are shared)
//    state.js     S, the page state; rt, renderer, worker, dpr, flags
//    dom.js       elements, media queries, 2D contexts, toast
//    palettes.js  colour maps, backgrounds, highlight modes, presets
//    format.js    number and lattice-number text
//    camera.js    2D and 3D camera maths, visible rectangle and cells
//    view.js      canvas size, the clear area (occlusion, saver plate)
//    framing.js   world boxes, fitted cameras, home views, n ranges
//    numbers.js   isPrimeN and the worker messages
//    tiles.js     when and where to ask for a CPU tile
//    frame.js     frameState and the density pyramid region
//    motion.js    morph, walk, camera flights
//    overlay.js   labels, diagonals, rings on #ov
//    readout.js   hover, readout card, prime count, quadratic, status
//    controls.js  setShape, setMode, home, walk, go-to
//    input.js     wheel, pointer, pinch, tap, keys
//    panel.js     the panel, dock, sheet, minimap drag
//    thumbs.js    gallery thumbnails and the minimap image
//    selftest.js  GPU maps against layouts.js (window.__ulam.selfTest)
//
//  GREP MAP
//    grep -n 'createRenderer('         the renderer and the worker
//    grep -n 'const released'          stop when the shell releases the page
//    grep -n 'function loop'           the frame loop
//    grep -n 'const app = '            what saver.js reads
//    grep -n 'window.__ulam'           the debug and test hook
// ============================================================================
import * as T from './numtheory.js';
import * as L from './layouts.js';
import { createRenderer } from './render.js';
import { installSaver } from './saver.js';
import { S, rt } from './app/state.js';
import { $, PHONE_Q, cv, ov, oc } from './app/dom.js';
import { PALETTES, BGS, MODES } from './app/palettes.js';
import { fmt, fmtS } from './app/format.js';
import { is3D, toScreen, toWorld, cam3Mats, project3 } from './app/camera.js';
import { initView, view } from './app/view.js';
import { bboxOf, fitCam, homeCount, homeCam, home3, n3Count, nSpan } from './app/framing.js';
import { isPrimeN, onWorkerMessage, startSieve } from './app/numbers.js';
import { tileCheck } from './app/tiles.js';
import { frameState } from './app/frame.js';
import { startMorph, stepMorph, startWalk, stopWalk, stepWalk, flyTo, stepFly } from './app/motion.js';
import { drawOverlay, computeRays } from './app/overlay.js';
import { updatePi, updateQuad, statusRight } from './app/readout.js';
import { setShape, shapeChanged, setMode, gotoNumber } from './app/controls.js';
import { installInput } from './app/input.js';
import { setOpen, buildUI } from './app/panel.js';
import { renderThumbs, renderMini } from './app/thumbs.js';
import { selfTest } from './app/selftest.js';
export { PALETTES, BGS, MODES, fmt, homeCount, startMorph, startWalk, flyTo, setShape, setMode, gotoNumber };

// --- boot ------------------------------------------------------------------------
try { rt.R = createRenderer(cv); } catch (e) { console.error(e); }
if (!rt.R) { $('nogl').hidden = false; }
const worker = rt.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
initView();
worker.onmessage = onWorkerMessage;
installInput();

// --- the frame loop ----------------------------------------------------------------------------
let last = 0, glLost = false;
// The shell released the page (lib/gpu-guard.js), or the GL context is
// lost: draw nothing more. The guard also stops requestAnimationFrame,
// but a frame queued before the release still runs once.
const released = () => glLost || !!(window.__snGuardStats && window.__snGuardStats().released);
cv.addEventListener('webglcontextlost', e => { glLost = true; e.preventDefault(); });
cv.addEventListener('webglcontextrestored', () => { location.reload(); });
function loop(now) {
  requestAnimationFrame(loop);
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
  const R = rt.R;
  if (!R || !oc || released()) return;
  const v = view();
  if (S.frameHook) S.frameHook(dt, v);
  const anim = !!(S.morph || S.walk || S.fly || S.sweep || S.animating);
  if (S.morph) stepMorph(dt);
  if (S.walk) stepWalk(dt, v);
  if (S.fly) stepFly(dt);
  if (!S.dirty && !anim && !S.overlayDirty) { renderThumbs(2); return; }
  S.tileOn = !S.morph && tileCheck(v);
  const fs = frameState(v);
  R.draw(fs);
  rt.lastState = fs; rt.frames++;
  drawOverlay(v);
  S.dirty = R.pyrBusy(); S.overlayDirty = false;
  if (!S.saver) { updatePi(v); renderMini(v); if (now - (S.statusAt || 0) > 200) { S.statusAt = now; statusRight(v); } }
  if (S.saverComposite) S.saverComposite();
}

// --- the app object and the start ------------------------------------------------------------------
const app = {
  S, R: () => rt.R, L, T, MODES, PALETTES, BGS, view, toScreen, toWorld, frameState, setShape, setMode, startMorph, startWalk, stopWalk,
  flyTo, homeCam, home3, n3Count, fitCam, bboxOf, cam3Mats, project3, nSpan, isPrimeN, fmt, fmtS, setOpen, drawOverlay, computeRays,
  updateQuad, worker, get dpr() { return rt.dpr; }, gl: cv, ov, is3D, PHONE_Q, homeCount, shapeChanged,
};
window.__ulam = { S, app, selfTest, gotoNumber, setShape, setMode, L, T, frames: () => rt.frames, ready: () => !!(S.bits && rt.R) };
buildUI();
S.cam = homeCam(); S.cam.z = Math.max(S.cam.z, 2.2);
startSieve(1e8);
installSaver(app);
requestAnimationFrame(loop);
