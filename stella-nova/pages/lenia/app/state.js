// ============================================================================
//  LENIA  ·  app/state.js — page state, DOM helpers and media queries
// ----------------------------------------------------------------------------
//  The one state object S that every app/ module reads and writes, the
//  phone and fine-pointer media queries, and the small DOM helpers. det()
//  is the detail of the current creature. ?debug exposes S as
//  window.lenia for the headless checks.
//
//  GREP MAP
//    grep -n 'const S ='       the page state
//    grep -n 'const PHONE_Q'   the phone layout query
//    grep -n 'const FINE_Q'    the mouse query
//    grep -n 'function toast'  the status toast
//    grep -n 'function lsGet'  localStorage read, safe in private mode
//    grep -n 'function lsSet'  localStorage write
//    grep -n 'function det'    detail of the current creature
// ============================================================================
export const $ = id => document.getElementById(id);
// The phone layout. This query matches the PHONE block in style.css.
export const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
export const FINE_Q = matchMedia('(pointer:fine)');
export const LS_KEY = 'stella-nova.lenia.creature';
export const DEFAULT_CODE = 'O2u';
export const TOOLS = { stamp: '✦', draw: '✎', erase: '⌫' };

export const S = {
  creatures: [], idx: -1, c: null,
  engine: null, gpu: true,
  playing: true, speed: 2, acc: 0,
  rule: { m: 0, s: 0, T: 10, scale: 1 },
  tool: 'stamp', brush: 1.5,
  view: { mode: 'world', palette: 'lenia', zoom: 1, follow: false },
  worldShort: 128, stats: null, time: 0,
  // Cells per unit of length. The world and every creature scale by it, so
  // a creature keeps its size on the screen and gets detail x more cells.
  detail: 2,
  // Centroid velocity in cells per unit of time, for the follow camera.
  vel: { x: 0, y: 0 }, statT: 0,
  maxSteps: 48, stepCap: 48,
};
// ?debug exposes the page state for the headless checks.
if (/[?&]debug\b/.test(location.search)) window.lenia = S;

// ------------------------------------------------------------------ helpers
export function setText(el, s) { if (typeof el === 'string') el = $(el); if (el && el.textContent !== s) el.textContent = s; }
export function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
export function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
let toastT = 0;
export function toast(msg, err = false, ms = 2400) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('err', err);
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), ms);
}

// The detail of the current creature. A creature flagged fixed in the
// catalog changes class at detail 2 (all Game of Life patterns, and 5
// Lenia creatures), so it always runs at detail 1.
export function det() { return S.c && S.c.fixed ? 1 : S.detail; }
