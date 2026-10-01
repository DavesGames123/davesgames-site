// ============================================================================
//  PROTEIN VIEWER  ·  main.js — boot
// ────────────────────────────────────────────────────────────────────────────
//  One structure at a time. Loading (preset, ID, file or paste) gives a
//  parse.js model. setStructure() centres it, turns its principal axes to
//  the screen (the long axis across, or up on a portrait screen), and
//  builds the layers in the `mol` group. A colour or highlight change only
//  repaints the layers. A rep, filter or chain change rebuilds them.
//
//  This file only boots the page. stage.js must stay the first app import:
//  it throws when WebGL 2 is missing, before any listener is installed.
//  The other modules are in app/, one concern per file:
//    env.js       DOM lookup, device queries, text helpers
//    state.js     the state S, dirty(), residue helpers
//    stage.js     renderer, scene, camera, materials, orbit controls
//    feedback.js  toast, loading veil, hint
//    structure.js setStructure, principal-axis frame
//    load.js      presets, IDs, files, paste, drop
//    layers.js    the mesh layers of the rep, the stick overlay
//    paint.js     colours and surface opacity
//    pick.js      ray picking, 5 Å neighbours
//    select.js    the selection
//    card.js      the residue card
//    measure.js   distance, angle, dihedral
//    labels.js    HTML labels on the 3D view
//    strip.js     the sequence strip
//    pointer.js   canvas tap, double tap, hover
//    camera.js    clear area, framing, fly-to
//    panel.js     panel and phone sheet
//    ui.js        panel controls, dock, keys
//    loop.js      render loop, teardown
//
//  GREP MAP
//    window.__pv                           debug and headless hooks
//    boot                                  buildUI, syncUI, first preset, loop
// ============================================================================
import { PRESETS, byId } from './presets.js';
import { camera, controls } from './app/stage.js';
import { S } from './app/state.js';
import { resolveSel } from './app/structure.js';
import { fetchId, loadPreset } from './app/load.js';
import { pickAt } from './app/pick.js';
import { clearSelection, select } from './app/select.js';
import { addMeasureAtom, setMeasure } from './app/measure.js';
import { focusSelection, resetView } from './app/camera.js';
import { setOpen } from './app/panel.js';
import { buildUI, setColor, setRep, syncUI } from './app/ui.js';
import { frame } from './app/loop.js';

// debug and headless checks
window.__pv = { S, loadPreset, select, clearSelection, setRep, setColor, setMeasure, addMeasureAtom, pickAt, resolveSel, camera, controls, PRESETS, setOpen, focusSelection, resetView, fetchId };

// ── boot ──────────────────────────────────────────────────────────────────
buildUI();
syncUI();
const start = decodeURIComponent((location.hash || '').slice(1));
loadPreset(byId(start) ? start : 'rhodopsin');
requestAnimationFrame(frame);
