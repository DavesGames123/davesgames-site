// ============================================================================
//  MATERIAL STUDIO  ·  editor/state.js — constants, colors, DOM, view, prefs
// ────────────────────────────────────────────────────────────────────────────
//  The leaf of the editor tree. It holds the sizes, the storage keys, the
//  colors, the DOM elements, the canvas size, the pan/zoom transform and the
//  user prefs. Other editor files read the `let` bindings live and change
//  them only through the setters here. This file imports no editor file, so
//  it is ready before any file in the editor import cycle runs.
//
//  GREP TARGETS
//      NODE_W / HEAD / ROW ... node geometry constants
//      CLIP_KEY / PREF_KEY ... localStorage keys
//      CATEGORY_COLORS ....... category colors (header stripe, library, minimap)
//      catColor / typeColor .. color lookups with a fallback
//      export const C ........ canvas palette
//      setDom / setSize ...... the only writers of the DOM and size bindings
//      export const view ..... pan / zoom transform {s, tx, ty}
//      toG / toS ............. screen px <-> graph units
//      prefs / loadPrefs ..... minimap, preview, snap, boxMode
// ============================================================================
import { PORT_COLORS } from '../contract.js';

export const NODE_W = 168, OUT_W = 184, HEAD = 20, ROW = 18, PREV = 88, THUMB = 80, RR = 18;
export const PORT_R = 4.5, SNAP = 10, FRAME_HEAD = 22;
export const ZMIN = 0.08, ZMAX = 3;
export const INLINE_KINDS = new Set(['slider', 'int', 'color', 'enum', 'bool', 'vec2']);
export const CLIP_KEY = 'material-studio.clipboard';
export const PREF_KEY = 'material-studio.editor';
export const RECENT_KEY = 'material-studio.recent';
export const LIB_KEY = 'material-studio.lib-open';
export const FONT = '"IBM Plex Sans", system-ui, -apple-system, sans-serif';
export const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

/** Category colors (header stripe, library dot, minimap). */
export const CATEGORY_COLORS = Object.freeze({
  Output: '#ff6a6a', Input: '#96c8ff', Generator: '#64c864', Noise: '#7ad0c0', Pattern: '#4fb39a',
  Math: '#a0a8b8', Vector: '#b090ff', Color: '#ffc832', Adjust: '#e0a050', Blend: '#ff9a4a',
  Filter: '#d080c0', 'Height & Normal': '#8a9cff', Transform: '#60a0d0', Utility: '#708090', Bench: '#ff8a5c',
});
export function catColor(c) { return CATEGORY_COLORS[c] || '#8090b0'; }
export function typeColor(t) { return PORT_COLORS[t] || '#8090b0'; }
export const C = {
  bg: '#0e1118', grid: 'rgba(150,200,255,0.035)', gridMajor: 'rgba(150,200,255,0.07)',
  node: '#1a2030', nodeHead: '#202838', border: 'rgba(150,200,255,0.16)', borderHover: 'rgba(150,200,255,0.4)',
  sel: '#ffc832', err: '#ff6a6a', text: '#c8d0e0', dim: '#8090b0', faint: '#506080', bright: '#e8ecf4',
  widget: '#10141d', widgetHover: '#151b27',
};

// DOM elements (dom.js sets them once) and the canvas size in CSS px
export let wrap, cv, cx, bar, crumbs, statusEl, palEl, menuEl, colorEl, inlineEl;
export let W = 0, H = 0, dpr = 1;
export function setDom(d) { ({ wrap, cv, cx, bar, crumbs, statusEl, palEl, menuEl, colorEl, inlineEl } = d); }
export function setSize(w, h) { W = w; H = h; }
export function setDpr(r) { dpr = r; }

export const view = { s: 1, tx: 0, ty: 0 };
export function toG(sx, sy) { return [(sx - view.tx) / view.s, (sy - view.ty) / view.s]; }
export function toS(gx, gy) { return [gx * view.s + view.tx, gy * view.s + view.ty]; }

export const prefs = { minimap: true, preview: true, snap: true, boxMode: false };
export function savePrefs() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ prefs })); } catch (e) {}
}
export function loadPrefs() {
  try {
    const j = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
    if (j?.prefs) for (const k of Object.keys(prefs)) if (typeof j.prefs[k] === 'boolean') prefs[k] = j.prefs[k];
  } catch (e) {}
}
