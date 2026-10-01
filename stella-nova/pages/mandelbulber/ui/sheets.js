// ui/sheets.js — Mandelbulber page: the full-screen sheets (formula picker and presets).
//
// openSheet and closeSheet show and hide a sheet. syncViewport copies the visual viewport
// into --vv-top and --vv-h, so on a phone a sheet fills the part above the keyboard.
// initSheets adds swipe-to-close: a swipe down on the head, or on the list when it is
// scrolled to the top, closes the sheet (not in float mode).
//
// grep: function syncViewport  function openSheet  function closeSheet  function swipeToClose  function initSheets

import { root, picker, exSheet, px } from './dom.js';
import { closePicker } from './picker.js';
import { closeExamples } from './preset-sheet.js';
import { L, queueLayout } from '../main.js';

// On a phone they fill the visual viewport, so the search field stays above the keyboard.
// Swipe down on the head, or on the list when it is scrolled to the top, to close.
export function syncViewport() {
  const vv = window.visualViewport;
  root.style.setProperty('--vv-top', px(vv ? vv.offsetTop : 0));
  root.style.setProperty('--vv-h', px(vv ? vv.height : innerHeight));
}

export function initSheets() {
  window.visualViewport?.addEventListener('resize', () => { syncViewport(); queueLayout(); });
  window.visualViewport?.addEventListener('scroll', syncViewport);
  swipeToClose(picker, closePicker);
  swipeToClose(exSheet, () => closeExamples());
}

export function openSheet(s) { syncViewport(); s.style.transform = ''; s.classList.remove('hidden'); }
export function closeSheet(s) {
  if (s.contains(document.activeElement)) document.activeElement.blur();
  s.classList.add('hidden'); s.style.transform = '';
}

function swipeToClose(s, close) {
  const body = s.querySelector('.pbody');
  let t = null;
  s.addEventListener('touchstart', (e) => {
    if (L.mode === 'float' || e.touches.length !== 1) { t = null; return; }
    t = { y0: e.touches[0].clientY, t0: performance.now(), ok: !!e.target.closest('.phead') || body.scrollTop <= 0, on: false, dy: 0 };
  }, { passive: true });
  s.addEventListener('touchmove', (e) => {
    if (!t?.ok) return;
    const dy = e.touches[0].clientY - t.y0;
    if (!t.on) { if (dy > 10 && (body.scrollTop <= 0 || e.target.closest('.phead'))) { t.on = true; s.classList.add('dragging'); } else return; }
    e.preventDefault();
    t.dy = Math.max(0, dy);
    s.style.transform = `translateY(${t.dy}px)`;
  }, { passive: false });
  const end = () => {
    if (!t?.on) { t = null; return; }
    s.classList.remove('dragging');
    const v = t.dy / Math.max(performance.now() - t.t0, 1);
    if (t.dy > 110 || v > 0.6) close(); else s.style.transform = '';
    t = null;
  };
  s.addEventListener('touchend', end);
  s.addEventListener('touchcancel', end);
}
