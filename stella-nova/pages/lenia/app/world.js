// ============================================================================
//  LENIA  ·  app/world.js — world size, canvas size and screen mapping
// ----------------------------------------------------------------------------
//  sizeWorld() sets the world from the canvas aspect. observeSize() sets the
//  canvas px ratio from budget.js renderBudget. worldXY() maps a client
//  point to a cell. occlusion() finds the part of the canvas in sight.
//
//  GREP MAP
//    grep -n 'function setMaxSteps'  steps per frame from the detail
//    grep -n 'function sizeWorld'    world size from the canvas aspect
//    grep -n 'function observeSize'  canvas px ratio (budget.js renderBudget)
//    grep -n 'function worldXY'      client px -> world cell
//    grep -n 'function occlusion'    the canvas part no sheet covers
// ============================================================================
import { renderBudget } from '../budget.js';
import { $, PHONE_Q, FINE_Q, S, det } from './state.js';
import { engineRule, placeCreature } from './creature.js';

// The step cost per cell grows with R^2, so a higher detail gets fewer steps
// per frame. The cap keeps a slow GPU from a queue of frames.
function setMaxSteps(mobile) {
  S.maxSteps = Math.max(2, Math.round((mobile ? 16 : 48) / (det() * det())));
  S.stepCap = S.maxSteps;
}

// The short side is S.worldShort * det(). The long side follows the
// canvas aspect, clamped to 2.2 : 1, and both are multiples of 16.
export function sizeWorld(force = false) {
  if (!S.engine) return;
  const cv = $('gl');
  const a = Math.min(2.2, Math.max(1 / 2.2, (cv.clientWidth || 1) / (cv.clientHeight || 1)));
  const r16 = v => Math.max(64, Math.round(v / 16) * 16);
  setMaxSteps(PHONE_Q.matches || !FINE_Q.matches);
  const n = S.worldShort * det();
  const W = r16(a >= 1 ? n * a : n);
  const H = r16(a >= 1 ? n : n / a);
  const { W: w0, H: h0 } = S.engine.info;
  if (W === w0 && H === h0 && !force) return;
  S.engine.setWorld(W, H);
  if (S.c) { S.engine.setRule(engineRule()); placeCreature(); }
}
export function observeSize() {
  const cv = $('gl');
  let sizeT = 0;
  const apply = () => {
    // The pixel ratio and the bicubic start come from budget.js: a desktop
    // saver draws at the device ratio up to 2 (8.3 M px at most), a phone
    // saver at 1.5 (1.2 M px at most), and a phone takes the bilinear path
    // for cells under 6 device px.
    const cw = Math.max(1, cv.clientWidth), ch = Math.max(1, cv.clientHeight);
    const b = renderBudget({ dpr: devicePixelRatio || 1, cssW: cw, cssH: ch, saver: !!S.saver, phone: PHONE_Q.matches || !FINE_Q.matches });
    S.engine.setView({ cubicMin: b.cubicMin });
    S.engine.resize(Math.round(cw * b.dpr), Math.round(ch * b.dpr), b.dpr);
  };
  new ResizeObserver(() => {
    apply();
    // A new aspect (a phone turned, a window made narrow) gets a new world
    // after the resize settles, so a drag of the window edge does not clear
    // the world at each frame.
    clearTimeout(sizeT);
    sizeT = setTimeout(() => {
      const { W, H } = S.engine.info, a = cv.clientWidth / cv.clientHeight;
      if ((W >= H) !== (a >= 1) || Math.abs(Math.log((W / H) / a)) > 0.45) sizeWorld();
    }, 400);
  }).observe(cv);
  apply();
  S.applySize = apply;   // the screensaver calls it after the dpr cap
}

// Canvas client px -> world cell (x, y), not wrapped.
export function worldXY(clientX, clientY) {
  const cv = $('gl'), r = cv.getBoundingClientRect(), v = S.engine.view, k = S.engine.cellPx();
  return { x: (clientX - r.left - r.width / 2 - v.ox) / k + v.cx, y: (clientY - r.top - r.height / 2 - v.oy) / k + v.cy };
}

// The part of the canvas that no sheet, drawer or dock covers. The view
// center goes to the middle of that part, so a creature at the center stays
// in sight when the phone sheet or the catalog opens. Returns the offset of
// that middle from the canvas center, in CSS px.
export function occlusion() {
  const cv = $('gl').getBoundingClientRect();
  let l = cv.left, r = cv.right, t = cv.top, b = cv.bottom;
  const cover = el => {
    if (!el.classList.contains('open')) return;
    const e = el.getBoundingClientRect();
    if (e.width < 1 || e.height < 1 || e.right <= l || e.left >= r || e.bottom <= t || e.top >= b) return;
    // A panel along the base (phone sheet) or along a side (drawer).
    if (e.width >= (r - l) * 0.9) b = Math.min(b, e.top);
    else if (e.left <= l + 1) l = Math.max(l, e.right);
    else r = Math.min(r, e.left);
  };
  if (PHONE_Q.matches) {
    const d = $('dock').getBoundingClientRect();
    if (d.height && d.width >= (r - l) * 0.9) b = Math.min(b, d.top);
  }
  cover($('panel'));
  cover($('browser'));
  if (r - l < 80 || b - t < 80) return { x: 0, y: 0 };
  return { x: (l + r) / 2 - (cv.left + cv.right) / 2, y: (t + b) / 2 - (cv.top + cv.bottom) / 2 };
}
