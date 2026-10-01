// app/controls.js -- the control dispatcher, the view reset, the interface zoom, and the keys.
//
// Every DOM control carries data-act. apply is the one dispatcher, as app.rs
// apply is: it changes S, runs the action, and calls syncUI so that every copy
// of a control (bar, sheet, dock) shows the new state. onKey maps the keys to
// the same actions.
//
// grep map:
//   apply     -- every control action                    [app.rs apply]
//   resetView -- the 2D zoom and pan, or the 3D orbit and pan
//   uiZoom    -- the root font size (main.rs: Command plus, minus, zero)
//   onKey     -- every keyboard shortcut                 [main.rs window_event]

import * as patterns from '../patterns.js';
import { Orbit } from '../view.js';
import { $, TOOL_KEYS, SPEEDS, S, save, isPhone } from './state.js';
import { applyLayout } from './layout.js';
import { toggleLibSource } from './libpanel.js';
import { syncUI } from './readouts.js';
import { undo, redo, loadPreset } from './edit.js';
import { savePng, exportFold } from './files.js';

// ── the control dispatcher (app.rs apply) ───────────────────────────────────
export function apply(act, el) {
  const [verb, arg] = act.split(':');
  switch (verb) {
    case 'tool': S.tool = arg; break;
    case 'grid': S.showGrid = !S.showGrid; break;
    case 'library': S.libraryOpen = !S.libraryOpen; if (S.libraryOpen && isPhone()) S.panelOpen = false; break;
    case 'library-close': S.libraryOpen = false; break;
    case 'preset': { const p = patterns.byId(arg); if (p) loadPreset(p); if (isPhone()) S.panelOpen = false; break; }
    case 'libsrc': toggleLibSource(arg); return;
    case 'play': S.auto = !S.auto; break;
    case 'flat': S.auto = false; S.fraction = 0; S.mesh.resetFlat(); break;
    case 'speed': {
      const i = SPEEDS.findIndex((s) => Math.abs(s - S.foldSpeed) < 1e-3);
      S.foldSpeed = SPEEDS[((i < 0 ? 1 : i) + 1) % SPEEDS.length];
      S.auto = true;
      break;
    }
    case 'fraction': S.auto = false; S.fraction = Math.min(Math.max(Number(el.value), 0), 1); break;
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'layout': S.layoutMode = arg; try { sessionStorage.setItem('origami.layout', arg); } catch { /* storage blocked */ } applyLayout(); break;
    case 'panel': S.panelOpen = !S.panelOpen; break;
    case 'fit': resetView('2d'); resetView('3d'); break;
    case 'png': savePng(); break;
    case 'fold-export': exportFold(); break;
    case 'fold-import': $('foldFile').click(); break;
    default: return;
  }
  syncUI();
}

export function resetView(pane) {
  if (pane === '2d') { S.zoom2d = 1; S.pan2d = [0, 0]; }
  else { S.orbit = new Orbit(); S.pan3d = [0, 0]; }
}


// ── interface zoom (main.rs: Command plus, minus, zero) ─────────────────────
export function uiZoom(f) {
  S.ui = f === 0 ? 1 : Math.min(Math.max(S.ui * f, 0.7), 2.0);
  document.documentElement.style.fontSize = (16 * S.ui).toFixed(2) + 'px';
  save('origami.ui', S.ui);
  requestAnimationFrame(applyLayout);
}

// ── keyboard (main.rs window_event, plus web keys) ──────────────────────────
export function onKey(e) {
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key;
  if (e.target && e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  if (mod) {
    if (k === '+' || k === '=') { e.preventDefault(); uiZoom(1.12); }
    else if (k === '-' || k === '_') { e.preventDefault(); uiZoom(1 / 1.12); }
    else if (k === '0') { e.preventDefault(); uiZoom(0); }
    else if (k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (k.toLowerCase() === 'y' && e.ctrlKey) { e.preventDefault(); redo(); }
    return;
  }
  if (e.altKey) return;
  const lk = k.toLowerCase();
  if (lk === 's') { e.preventDefault(); savePng(); return; }
  if (TOOL_KEYS[lk]) { apply('tool:' + TOOL_KEYS[lk]); return; }
  if (k === ' ') { e.preventDefault(); apply('play'); return; }
  if (lk === 'f') { apply('flat'); return; }
  if (lk === 'g') { apply('grid'); return; }
  if (lk === 'l') { apply('library'); return; }
  if (k === 'Escape') { S.libraryOpen = false; S.panelOpen = false; syncUI(); }
}
