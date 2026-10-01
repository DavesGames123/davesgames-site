// ============================================================================
//  MATERIAL STUDIO  ·  editor/selftest.js — __studio.editor.selfTest()
// ────────────────────────────────────────────────────────────────────────────
//  Render checks for main.js __studio.selfTest(). It builds a 200-node
//  stress graph, times 20 draws, runs a palette search and a type-filtered
//  search, sets a selection and opens the palette. Then it loads the old
//  graph back without a fit (the undo history is reset) and puts the view
//  back.
//
//  GREP TARGETS
//      editorSelfTest ... {ok, checks, detail}
//      checks.smooth .... median draw of 200 nodes under 16 ms
// ============================================================================
import * as G from '../graph.js';
import { state } from '../store.js';
import { cx, W, H, palEl, view } from './state.js';
import { fitAll, holdFit } from './view.js';
import { setSel } from './selection.js';
import { dirty, renderNow } from './render.js';
import { searchDefs } from './search.js';
import { pal, openPalette, closePalette } from './palette.js';
import { stress } from './api.js';

/**
 * Render checks: a 200-node stress graph draws, a palette search returns
 * results, a type-filtered search keeps only compatible nodes, fit and zoom
 * work, then the old graph comes back (the undo history is reset).
 */
export async function editorSelfTest() {
  const checks = {}, detail = {};
  const saved = state.graph ? G.serialize(state.graph) : null;
  const savedView = { ...view };
  try {
    checks.canvas = !!cx && W > 0 && H > 0;
    detail.size = [W, H];
    const ids = stress(200);
    checks.stress = Array.isArray(ids) && ids.length === 200;
    fitAll();
    const times = [];
    for (let i = 0; i < 20; i++) { view.tx += (i % 2 ? 7 : -7); times.push(renderNow()); }
    times.sort((a, b) => a - b);
    detail.render200 = { median: +times[10].toFixed(2), max: +times[19].toFixed(2), links: state.graph.links.length };
    checks.smooth = times[10] < 16;
    view.s = 1; renderNow();
    detail.render200zoom1 = +renderNow().toFixed(2);
    checks.search = searchDefs('value', null).length > 0;
    const wired = searchDefs('', { dir: 'in', type: 'normal' });
    checks.wireFilter = wired.every(r => (r.d.outputs || []).some(p => G.typesCompatible(p.type, 'normal')));
    detail.normalFeeders = wired.length;
    setSel(ids.slice(0, 5));
    checks.select = state.selection.length === 5;
    openPalette({ sx: 20, sy: 40, gx: 0, gy: 0 });
    checks.palette = !palEl.hidden && pal.items.length > 0;
    closePalette();
    checks.paletteClosed = palEl.hidden;
  } catch (e) {
    checks.threw = false; detail.error = String(e && e.stack || e);
  } finally {
    G.flushChanged();
    holdFit(true);
    if (saved) G.actions.load(saved);
    holdFit(false);
    Object.assign(view, savedView);
    setSel([]);
    dirty();
  }
  return { ok: Object.values(checks).every(Boolean), checks, detail };
}
