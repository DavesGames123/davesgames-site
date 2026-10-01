// ============================================================================
//  HUMAN SKELETON  ·  main.js — state, loading, UI, picking, camera, loop
// ────────────────────────────────────────────────────────────────────────────
//  The manifest arrives first: it builds the list, the camera frame and the
//  bone state texture. The eight body groups then load at the same time
//  (spine and thorax first) and each one dissolves in when it arrives.
//
//  STATE    per bone: cur / from / to (offset + rotation), a stagger delay,
//           a drag offset with a spring, an appear factor, a flag (shown,
//           hidden, ghost). Every frame that changes, they go into the
//           BoneState texture (render.js) and the GPU moves the bones.
//  MODES    radial, regional (layout.js), catalogue (the tray). An amount
//           per region scales radial and regional, so one hand can open
//           while the rest stays put. Reconstruct plays the stagger back.
//  PICK     the bones render their row as a colour into a small target
//           round the tap (view offset of the main camera); the nearest
//           coloured pixel wins. Radius 4 px (mouse) or 22 px (touch).
//  SELECT   the bone glows, the card opens, the list marks it, and the
//           camera pans if the bone sits under the card or the panel.
//  ISOLATE  the other bones become fresnel ghosts; the camera flies to
//           the bone and orbits it.
//  FRAME    occlusion() measures the panel and the card;
//           camera.setViewOffset centres the view in the clear part.
//
//  GREP MAP
//    function loadAll / addGroup / ensureCartilage        loading
//    function setMode / explode / reconstruct / target    layouts
//    function pickAt / onTap / select / showCard          picking
//    function isolate / step / focusRegion / focusBone    inspection
//    function buildList / syncList / setRegionHidden      the bone list
//    function occlusion / resize / flyTo / fitView        camera
//    function setTheme / buildUI / syncUI / setOpen       controls
//    function placeLabels / buildTrays                    the tray
//    function frame                                       the loop
// ============================================================================
import { $ } from './app/env.js';
import { canvas, camera, controls } from './app/stage.js';
import { T, S, toast } from './app/state.js';
import { fitView } from './app/camera.js';
import { pickAt } from './app/pick.js';
import { loadAll } from './app/load.js';
import { setMode, explode, reconstruct, setAmount, toggleRegionExplode } from './app/layouts.js';
import { boneCentre, select, clearSelection, step } from './app/select.js';
import { isolate, exitIsolate, focusBone, focusRegion } from './app/inspect.js';
import { setRegionHidden } from './app/list.js';
import { setOpen } from './app/panel.js';
import { setTheme, setShow, buildUI } from './app/controls.js';
import { frame } from './app/loop.js';

// debug and headless checks
window.__hs = {
  S, T, select, clearSelection, isolate, exitIsolate, setMode, explode, reconstruct, setAmount, toggleRegionExplode, focusRegion, focusBone,
  setTheme, setShow, setRegionHidden, pickAt, step, camera, controls, setOpen, fitView,
  screenOf(id) {
    const b = typeof id === 'number' ? S.bones[id] : S.P.byId.get(id);
    const p = boneCentre(b.i).project(camera);
    const cr = canvas.getBoundingClientRect();
    return { x: cr.left + (p.x + 1) / 2 * cr.width, y: cr.top + (1 - p.y) / 2 * cr.height, i: b.i };
  },
  busy: () => !!(S.tr || S.fly || S.springing.size || S.bones.some(b => S.loaded[b.i] && S.appear[b.i] < 1)),
};

// ── boot ────────────────────────────────────────────────────────────────────
buildUI();
setTheme(S.theme);
requestAnimationFrame(frame);
loadAll().catch(e => { console.error(e); $('loadingText').textContent = 'The skeleton failed to load'; toast(String(e.message || e)); });
