// ============================================================================
//  MATERIAL STUDIO  ·  panels/ctx.js — the module context of the panels
// ────────────────────────────────────────────────────────────────────────────
//  panels.js init() calls bind(c) once with the main.js context. The other
//  panel modules import these names as live bindings, so they read the bound
//  values. Only bind() writes them.
//
//  GREP TARGETS
//      bind  ctx  store  state  M  $
// ============================================================================
export let ctx = null, store = null, state = null, M = {}, $ = id => document.getElementById(id);

/** @param {object} c main.js module context */
export function bind(c) { ctx = c; store = c.store; state = c.store.state; M = c.modules; $ = c.$; }
