// ============================================================================
//  HUMAN SKELETON  ·  app/state.js — session state, redraw flag, messages
// ────────────────────────────────────────────────────────────────────────────
//  S is the one state object of the page. The STATE note in main.js gives
//  its per-bone arrays. The modules change S in place and do not replace
//  it. dirty() asks the loop for one more frame. T holds the boot times
//  for the headless checks.
//
//  GREP MAP
//    const T / const S / const dirty                 state and redraw flag
//    controls.addEventListener                       orbit stops a fly-to
//    function toast / hideHint                       messages
//    function regionOf                               region of a bone
// ============================================================================
import { $ } from './env.js';
import { controls } from './stage.js';

export const T = { start: performance.now(), firstFrame: 0, firstBones: 0, allBones: 0 };
export const S = {
  M: null, P: null, n: 0, bones: [], regions: [], regionIx: null, state: null,
  mode: 'radial', lastMode: 'radial', amount: 1, amt: null, sort: 'region',
  cur: null, from: null, to: null, delay: null, tr: null, traysOn: false, cat: null,
  drag: null, dOff: null, dVel: null, springing: new Set(),
  appear: null, loaded: null, vis: null, hiddenRegion: new Set(), show: { teeth: true, cartilage: false, spin: false },
  sel: -1, hov: -1, iso: -1, isoBack: null, fly: null, dirty: true, frames: 0, groups: new Map(), mats: null,
  labelsOn: false, theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark', ready: false,
};
export const dirty = () => { S.dirty = true; };
controls.addEventListener('change', dirty);
controls.addEventListener('start', () => { S.fly = null; hideHint(); });

let toastT = 0;
export function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}
let hintGone = false;
export function hideHint() { if (!hintGone) { hintGone = true; $('hint').classList.add('gone'); } }
export function regionOf(b) { return S.regions[S.regionIx.get(b.region)]; }
