// main.js -- the app: two panes, one crease pattern, one live fold.
//
// Port of origami src/app.rs and src/main.rs. The DIAGRAM pane is the editor.
// The FOLDED pane is the same pattern folded by the simulator, one sim step per
// frame. The panes sit side by side when the stage is wider than tall, and
// stack when it is taller, as app.rs layout does. The topbar toggle (AUTO,
// HORIZONTAL, VERTICAL) can force either; sessionStorage keeps the choice for
// this tab session only, so a forced layout does not stay after the visit.
//
// One structure drives everything. `S.pattern` is what the person edits. Any
// edit rebuilds `S.planar` (planarize) and `S.mesh` (sim.build), so the folded
// pane always shows the current pattern. The fold fraction drives how far it
// folds.
//
// The native forge quad GUI (gui.rs, font.rs) is replaced by DOM controls.
// Every control carries data-act; `apply` is the one dispatcher, as app.rs
// apply is. Copies of one control (bar, sheet, dock) stay in step via syncUI.
//
// Web additions, not in the native app: 2D pan and zoom, a 3D pan offset,
// crease hover, the foldability marks, FOLD import and export, a snap preview,
// tool and transport keys, touch gestures, and the layout toggle.
//
// main.js is the shell: it boots the page and runs the frame loop. Each other
// concern has one module in app/, and each module header has its own grep map.
//
// grep map (this file):
//   frame       -- step the sim, draw both panes, update the readouts  [app.rs frame]
//   boot        -- restore the layout and zoom, wire, build the first pattern, start the GPU
//
// module map (app/):
//   state.js    -- S (all state), TOOLS, SPEEDS, the palette, gpu / setGpu, load / save
//   geom.js     -- pointInPoly, pointInTri2, pointSegDist: the pure hit tests
//   layout.js   -- applyLayout, measure, view2d, region3d, paneAt, dpr, resize
//   libpanel.js -- buildLibrary, filterLibrary, fillThumbs  [app.rs draw_library]
//   readouts.js -- setStatus, syncFold, syncUI, syncCheck
//   edit.js     -- rebuild, pushUndo / undo / redo, loadPreset, eraseNear
//   draw.js     -- draw2d / draw3d, render                  [app.rs draw_2d, draw_3d]
//   hover.js    -- updateHover                              [app.rs update_hover]
//   files.js    -- savePng, exportFold, importFold
//   controls.js -- apply, resetView, uiZoom, onKey          [app.rs apply, main.rs window_event]
//   input.js    -- onDown / onMove / onUp / onWheel, wireSheet, wire
//   hook.js     -- installHook: window.__origami, the test hook the headless check drives

import * as patterns from './patterns.js';
import { initGpu } from './gpu.js';
import { canvas, applyLayout, resize } from './app/layout.js';
import { buildLibrary } from './app/libpanel.js';
import { defaultStatus, setStatus, syncFold, syncUI } from './app/readouts.js';
import { rebuild } from './app/edit.js';
import { render } from './app/draw.js';
import { uiZoom } from './app/controls.js';
import { wire } from './app/input.js';
import { installHook } from './app/hook.js';
import { $, S, gpu, setGpu, load } from './app/state.js';

let last = performance.now();

// ── frame (app.rs frame) ────────────────────────────────────────────────────
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  // Drive the fold. Auto mode sweeps it; otherwise it holds.
  if (!S.frozen) {
    if (S.auto) {
      S.fraction += S.autoDir * dt * S.foldSpeed;
      if (S.fraction >= 0.95) { S.fraction = 0.95; S.autoDir = -1; }
      else if (S.fraction <= 0) {
        S.fraction = 0; S.autoDir = 1;
        // A clean flat sheet at the bottom of the sweep drops any knot.
        S.mesh.resetFlat();
      }
    }
    S.mesh.setFraction(S.fraction);
    S.mesh.step();
    S.mesh.recenter();
  }
  render();
  syncFold();
  requestAnimationFrame(frame);
}

installHook();

// ── boot ────────────────────────────────────────────────────────────────────
async function boot() {
  // The layout choice lives for one tab session. An old localStorage value
  // (kept before this change) forced a stacked layout on wide screens, so it
  // is deleted. A new visit starts in AUTO.
  try { localStorage.removeItem('origami.layout'); } catch { /* storage blocked */ }
  let lay = null; try { lay = sessionStorage.getItem('origami.layout'); } catch { /* storage blocked */ }
  S.layoutMode = ['auto', 'h', 'v'].includes(lay) ? lay : 'auto';
  const ui = Number(load('origami.ui', 1));
  if (Number.isFinite(ui) && ui !== 1) uiZoom(ui);
  buildLibrary();
  wire();
  applyLayout();
  setStatus(defaultStatus());

  const base = new URL('.', import.meta.url);
  const text = (p) => fetch(new URL(p, base)).then((r) => { if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`); return r.text(); });
  patterns.setReader((n) => text('patterns/' + n));
  await patterns.prepare(S.preset);
  S.pattern = patterns.build(S.preset);
  rebuild();
  syncUI();

  const shaders = { tris: await text('shaders/tris.wgsl'), lines: await text('shaders/lines.wgsl') };
  const res = await initGpu(canvas, shaders);
  if (res.error) {
    $('nogpu').hidden = false;
    $('nogpuMsg').textContent = res.error + ' The crease pattern editor and the simulator need it to draw.';
    return;
  }
  setGpu(res.gpu);
  gpu.device.lost.then((info) => {
    $('nogpu').hidden = false;
    $('nogpuMsg').textContent = `The GPU device was lost: ${info.message || info.reason}. Reload the page.`;
  });
  gpu.device.addEventListener('uncapturederror', (e) => console.error('[origami]', e.error.message));
  resize();
  last = performance.now();
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  $('nogpu').hidden = false;
  $('nogpuMsg').textContent = 'The page failed to start: ' + err.message;
});
