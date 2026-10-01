// ============================================================================
//  PROTEIN VIEWER  ·  app/feedback.js — toast, loading veil, first-use hint
// ────────────────────────────────────────────────────────────────────────────
//  Messages to the user that are not part of the panel. The hint text is
//  set at load and the hint goes after 10 s or at the first orbit.
//
//  GREP MAP
//    function toast                          short message, err = red
//    function showLoading / hideLoading      the loading veil
//    const nextFrame                         let the veil paint first
//    function hideHint                       the gesture hint
// ============================================================================
import { $, COARSE } from './env.js';

let toastT = 0;
export function toast(msg, err = false) {
  const t = $('toast');
  t.textContent = msg; t.classList.toggle('err', err); t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), err ? 6000 : 3200);
}
export function showLoading(msg) { $('loadingText').textContent = msg; $('loading').hidden = false; }
export function hideLoading() { $('loading').hidden = true; }
export const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
let hintGone = false;
export function hideHint() { if (!hintGone) { hintGone = true; $('hint').classList.add('gone'); } }
$('hint').textContent = COARSE ? 'one finger orbits · pinch zooms · two fingers pan · tap a residue' : 'drag to orbit · scroll to zoom · right-drag to pan · click a residue · double-click to focus';
setTimeout(hideHint, 10000);
