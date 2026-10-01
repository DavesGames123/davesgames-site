// ui/layout.js — Mandelbulber page: the panel layout modes and the canvas size.
//
// pickMode picks float (fine pointer, wide window), sheet (portrait phone) or drawer
// (landscape phone or tablet). applyLayout sets the body class, the sheet snap heights
// (peek, half, full) and --cover-b / --cover-r, so the canvas covers only the free area.
// observeCanvas resizes the render target when the canvas pixel size changes, but not
// during a sheet drag: then the resize waits for flushResize at the snap.
//
// grep: const L  let sheetDragging  function setSheetDragging  function safeInsets  function pickMode  const snapH
//       function setSheetY  function applyLayout  function queueLayout  function initLayout  function snapTo
//       function togglePanel  let resizeCanvas  function observeCanvas  function flushResize

import { canvas, panel, root, el, clamp, px, $ } from './dom.js';
import { engine, setInfo, coarseMQ, touchUI, pixelRatio } from './state.js';
import { syncViewport } from './sheets.js';

// float: fine pointer and a wide window. sheet: portrait phone. drawer: landscape phone
// or tablet. In sheet and drawer mode the canvas shrinks to the free area (--cover-b,
// --cover-r), so the camera target, orbit and Frame center where the user can see them.
// A snap to another sheet height resizes the canvas once; a drag only stretches it.
export const L = { mode: '', snap: 'peek', y: 0, full: 0, peek: 88, half: 320, drawerW: 340, drag: null, focusSnap: null };

export let sheetDragging = false;
export function setSheetDragging(on) { sheetDragging = on; }

const safeProbe = el('div', { style: 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;'
  + 'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)' });

export function initLayout() {
  document.body.append(safeProbe);
  window.addEventListener('resize', queueLayout);
  window.addEventListener('orientationchange', queueLayout);
  coarseMQ.addEventListener?.('change', queueLayout);
}

function safeInsets() {
  const cs = getComputedStyle(safeProbe);
  return { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
}

function pickMode() {
  const w = innerWidth, h = innerHeight;
  const phone = w <= 720 || (coarseMQ.matches && Math.min(w, h) < 720);
  if (phone) return w > h ? 'drawer' : 'sheet';
  return coarseMQ.matches ? 'drawer' : 'float';
}

export const snapH = (s) => (s === 'full' ? L.full : s === 'half' ? L.half : L.peek);
export function setSheetY(y, dragging) {
  L.y = y;
  root.style.setProperty('--sheet-y', px(y));
  if (!dragging) root.style.setProperty('--sheet-hidden', px(Math.max(0, y)));
}

export function applyLayout() {
  const mode = pickMode();
  if (mode !== L.mode) {
    document.body.classList.remove('mode-float', 'mode-sheet', 'mode-drawer');
    document.body.classList.add(`mode-${mode}`);
    L.mode = mode;
  }
  document.body.classList.toggle('touchfly', touchUI());
  const ins = safeInsets();
  const hidden = panel.classList.contains('hidden');
  let coverB = 0, coverR = 0;
  if (mode === 'sheet') {
    L.full = Math.round(innerHeight - ins.top - 8);
    root.style.setProperty('--sheet-full', px(L.full));
    const pk = $('peek');
    L.peek = Math.round(pk.offsetTop + pk.offsetHeight + ins.bottom);
    L.half = Math.round(clamp(innerHeight * 0.5, L.peek + 120, L.full));
    if (!L.drag) setSheetY(L.full - snapH(L.snap));
    coverB = hidden ? 0 : Math.min(snapH(L.snap), L.half);
  } else if (mode === 'drawer') {
    L.drawerW = Math.round(clamp(innerWidth * 0.42, 280, 360) + ins.right);
    root.style.setProperty('--drawer-w', px(L.drawerW));
    coverR = hidden ? 0 : L.drawerW;
  }
  root.style.setProperty('--cover-b', px(coverB));
  root.style.setProperty('--cover-r', px(coverR));
  syncViewport();
}

let layoutQueued = false;
export function queueLayout() { if (layoutQueued) return; layoutQueued = true; requestAnimationFrame(() => { layoutQueued = false; applyLayout(); }); }

export function snapTo(s) {
  L.snap = s;
  panel.classList.remove('hidden');
  applyLayout();
}

export function togglePanel() { panel.classList.toggle('hidden'); applyLayout(); }

let resizePending = false;
export let resizeCanvas = null;                      // set by observeCanvas once the engine runs

// Resize only when the pixel size changes, so a layout pass keeps the accumulated image.
// During a sheet drag the canvas only stretches (object-fit); the resize waits for the snap.
export function observeCanvas() {
  const resize = () => {
    if (sheetDragging) { resizePending = true; return; }
    const w0 = canvas.width, h0 = canvas.height;
    engine.resize(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight), pixelRatio());
    if (canvas.width !== w0 || canvas.height !== h0) setInfo(null);
  };
  resizeCanvas = resize;
  new ResizeObserver(resize).observe(canvas);
  resize();
}
export function flushResize() { if (resizePending) { resizePending = false; resizeCanvas?.(); } }
