// ui/sheet-drag.js — Mandelbulber page: the drag gestures of the phone bottom sheet.
//
// In sheet mode the user drags the sheet from the grab handle, the header and the peek
// bar (pointer events), and from the panel body when it is scrolled to the top and the
// finger pulls down (touch events). At the release the sheet snaps to peek, half or
// full, by position and speed. A focused text field opens the sheet to full, and the
// sheet goes back when the field loses focus.
//
// grep: function sheetDragBegin  function sheetDragMove  function sheetDragEnd  const dragZone  const sheetPtrEnd
//       const bodyTouchEnd  const typing  function initSheetDrag

import { panel, pbody, root, clamp, px } from './dom.js';
import { touchUI } from './state.js';
import { L, setSheetDragging, snapH, setSheetY, snapTo, flushResize } from './layout.js';
import { stopInertia } from '../main.js';

// Sheet drag: from the grab handle, the header and the peek bar (pointer events), and from
// the panel body when it is scrolled to the top and the finger pulls down (touch events).
function sheetDragBegin(y) {
  L.drag = { y0: y, h0: L.full - L.y, samples: [{ y, t: performance.now() }] };
  setSheetDragging(true);
  stopInertia();
  panel.classList.add('dragging');
}

function sheetDragMove(y) {
  const d = L.drag;
  const vis = clamp(d.h0 - (y - d.y0), L.peek * 0.6, L.full);
  d.samples.push({ y, t: performance.now() });
  if (d.samples.length > 6) d.samples.shift();
  setSheetY(L.full - vis, true);
  root.style.setProperty('--cover-b', px(Math.min(vis, L.half)));   // the canvas stretches until the snap
}

function sheetDragEnd() {
  const d = L.drag;
  if (!d) return;
  const now = performance.now();
  d.samples.push({ y: d.samples[d.samples.length - 1].y, t: now });   // a finger that stopped has no speed
  const recent = d.samples.filter((q) => now - q.t < 100);
  const a = recent[0], b = recent[recent.length - 1];
  const v = recent.length > 1 ? (b.y - a.y) / Math.max(b.t - a.t, 8) : 0;   // px per ms, + is down
  const vis = L.full - L.y;
  const order = ['peek', 'half', 'full'];
  let s = order.reduce((best, k) => (Math.abs(snapH(k) - (vis - v * 160)) < Math.abs(snapH(best) - (vis - v * 160)) ? k : best), 'peek');
  if (Math.abs(v) > 0.5) {                                           // a flick moves at least one step
    const cur = order.reduce((best, k) => (Math.abs(snapH(k) - vis) < Math.abs(snapH(best) - vis) ? k : best), 'peek');
    const i = order.indexOf(cur) + (v > 0 ? -1 : 1);
    if (order.indexOf(s) === order.indexOf(cur)) s = order[clamp(i, 0, 2)];
  }
  L.drag = null;
  setSheetDragging(false);
  panel.classList.remove('dragging');
  snapTo(s);
  flushResize();
}

const dragZone = (t) => t.closest?.('#grab, #panel > header, #peek');
let sheetPtr = null;

export function initSheetDrag() {
  panel.addEventListener('pointerdown', (e) => {
    if (L.mode !== 'sheet' || !dragZone(e.target) || L.drag) return;
    sheetPtr = { id: e.pointerId, y0: e.clientY, moved: false, grab: !!e.target.closest('#grab') };
  });
  panel.addEventListener('pointermove', (e) => {
    if (!sheetPtr || e.pointerId !== sheetPtr.id) return;
    if (!sheetPtr.moved && Math.abs(e.clientY - sheetPtr.y0) > 6) {
      sheetPtr.moved = true;
      panel.setPointerCapture(e.pointerId);                          // capture only now, so a tap still clicks
      sheetDragBegin(sheetPtr.y0);
    }
    if (sheetPtr.moved) sheetDragMove(e.clientY);
  });
  panel.addEventListener('pointerup', sheetPtrEnd);
  panel.addEventListener('pointercancel', sheetPtrEnd);
  pbody.addEventListener('touchstart', (e) => {
    if (L.mode !== 'sheet' || e.touches.length !== 1) { bodyTouch = null; return; }
    bodyTouch = { y0: e.touches[0].clientY, top: pbody.scrollTop <= 0, on: false };
  }, { passive: true });
  pbody.addEventListener('touchmove', (e) => {
    if (!bodyTouch) return;
    const y = e.touches[0].clientY;
    if (!bodyTouch.on) {
      if (bodyTouch.top && pbody.scrollTop <= 0 && y - bodyTouch.y0 > 8) { bodyTouch.on = true; sheetDragBegin(bodyTouch.y0); } else return;
    }
    e.preventDefault();
    sheetDragMove(y);
  }, { passive: false });
  pbody.addEventListener('touchend', bodyTouchEnd);
  pbody.addEventListener('touchcancel', bodyTouchEnd);
  panel.addEventListener('focusin', (e) => {
    if (L.mode !== 'sheet' || !typing(e.target) || !touchUI() || L.snap === 'full') return;
    L.focusSnap = L.snap; snapTo('full');
  });
  panel.addEventListener('focusout', () => {
    setTimeout(() => {
      if (L.focusSnap && !(panel.contains(document.activeElement) && typing(document.activeElement))) { const s = L.focusSnap; L.focusSnap = null; snapTo(s); }
    }, 60);
  });
}

const sheetPtrEnd = (e) => {
  if (!sheetPtr || e.pointerId !== sheetPtr.id) return;
  const p = sheetPtr;
  sheetPtr = null;
  if (p.moved) {
    sheetDragEnd();
    const eat = (ev) => { ev.stopPropagation(); ev.preventDefault(); };   // the drag is not a click
    window.addEventListener('click', eat, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', eat, true), 80);
  } else if (p.grab && e.type === 'pointerup') snapTo(L.snap === 'peek' ? 'half' : L.snap === 'half' ? 'full' : 'half');
};

let bodyTouch = null;

const bodyTouchEnd = () => { if (bodyTouch?.on) sheetDragEnd(); bodyTouch = null; };

// A text field in the sheet opens the sheet to full, so the keyboard does not cover it.
const typing = (t) => t instanceof HTMLInputElement && /^(text|search|number)$/.test(t.type);
