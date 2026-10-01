// ============================================================================
//  MATERIAL STUDIO  ·  export/ctx.js — the module context of the export
// ────────────────────────────────────────────────────────────────────────────
//  export.js init() calls bind(ctx) once with the main.js context. The other
//  export modules import C, S and last as live bindings, so they read the
//  bound values. Only bind() writes C and S. Only setLast() writes last.
//  UI is one shared object: the ui/ modules put the panel elements in it.
//
//  GREP TARGETS
//      C  S  UI  last  bind  setLast  err
// ============================================================================
export let C = null;            // main.js ctx
export let S = null;            // store.state
export const UI = {};           // panel elements
export let last = null;         // last export summary

/** @param {object} ctx main.js module context */
export function bind(ctx) { C = ctx; S = ctx.store.state; }
/** @param {object} v the summary of the export that just ended */
export function setLast(v) { last = v; }
/** Log an error and show it as a toast. */
export const err = e => { console.error(e); C.store.toast(String(e.message || e), 'error'); };
