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
//    xr.js        VR and AR view (lib/xr-view.js); index.html loads it
//
//  GREP MAP
//    window.__pv                           debug and headless hooks
//    boot                                  buildUI, syncUI, first preset, loop
//    window.snSaver                        screensaver hook (lib/screensaver.js)
// ============================================================================
import { PRESETS, byId } from './presets.js';
import { camera, canvas, controls, post } from './app/stage.js';
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

// ── screensaver ───────────────────────────────────────────────────────────
// Hook for the shell screensaver (lib/screensaver.js). It closes the panel,
// hides all DOM but canvas#view, spins the camera slowly and plays a seeded
// order of local presets that show the whole molecule (no focus, so no fly
// to a pocket). Each change fades the molecule into the background in the
// composite pass (post.fade), so the recorded canvas has no hard cut. The
// presets come from data/; fetchId (network) is never called. S.saver stops
// the URL hash write in loadPreset. No exit(): the shell reloads the page.
const SAVER_LIST = ['rhodopsin', 'ubiquitin', 'tim', 'deoxyhb', 'gb1', 'adkopen', 'bdna', 'afp53', 'crambin', 'villin'];
window.snSaver = {
  enter(o = {}) {
    const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
    const secs = Math.max(20, +o.seconds || 60);
    S.saver = true;
    setOpen(false);
    const st = document.createElement('style');
    st.textContent = 'body>*:not(#stage),#stage>*:not(#view){display:none!important}' +
      '#stage{top:0!important;bottom:0!important;right:0!important;left:0!important}#view{cursor:none!important}';
    document.head.appendChild(st);
    window.dispatchEvent(new Event('resize'));
    controls.autoRotateSpeed = 1.1 * (0.25 + 0.35 * (1 - calm));
    S.spin = true;
    // seeded order of the list (an LCG and a shuffle)
    let r = (o.seed >>> 0) || 1;
    const rnd = () => (r = (r * 1664525 + 1013904223) >>> 0) / 4294967296;
    const order = SAVER_LIST.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const hold = Math.max(10, secs / 3) * 1000, fadeS = 0.8 + 1.2 * calm;
    const fadeTo = to => new Promise(res => {
      const from = post.fade, t0 = performance.now();
      const step = now => {
        const k = Math.min(1, (now - t0) / (fadeS * 1000));
        post.fade = from + (to - from) * (k * k * (3 - 2 * k));
        S.dirty = true;
        if (k < 1) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
    let n = 0;
    const next = async () => {
      await fadeTo(1);
      await loadPreset(order[n++ % order.length]);
      await new Promise(res => setTimeout(res, 300));
      await fadeTo(0);
      setTimeout(next, hold);
    };
    // start on a fresh molecule from the faded state
    post.fade = 1; S.dirty = true;
    (async () => { await loadPreset(order[n++ % order.length]); await new Promise(res => setTimeout(res, 300)); await fadeTo(0); setTimeout(next, hold); })();
    return { canvas, warmupMs: 2500 };
  },
};
