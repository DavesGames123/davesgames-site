// ============================================================================
//  HUMAN SKELETON  ·  main.js — entry: module tree, debug object, boot
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
//  MODULE TREE (app/, one concern per file; each file has its own map)
//    env.js         constants, device queries, helpers, THEMES
//    stage.js       renderer, scene, lights, floor, pool, trays, controls
//    state.js       S, dirty, T, toast, hideHint, regionOf
//    load.js        loadAll / addGroup / ensureCartilage
//    visibility.js  refreshVisibility: S.vis and the bone flags
//    layouts.js     setMode / explode / reconstruct / retarget
//    tray.js        buildTrays / placeLabels
//    pick.js        pickAt
//    select.js      select / clearSelection / step / boneCentre
//    card.js        showCard / hideCard and the card buttons
//    inspect.js     isolate / exitIsolate / focusBone / focusRegion
//    list.js        buildList / syncList / setRegionHidden, search
//    pointer.js     tap, double tap, hover, drag out
//    camera.js      occlusion / resize / flyTo / fitView / fitShadow
//    panel.js       setOpen, the phone sheet, the dock list button
//    controls.js    setTheme / setShow / syncUI / syncRead / buildUI
//    loop.js        frame, and the pagehide teardown
//
//  ORDER    env.js and stage.js evaluate first. If WebGL 2 is missing,
//           stage.js throws and no other module runs. The other modules
//           call each other only inside functions, so the import cycles
//           do not read a binding before it is set.
//
//  GREP MAP
//    window.__hs                                     debug and headless checks
//    // ── boot                                     start the page
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
