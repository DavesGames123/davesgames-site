// ============================================================================
//  MATERIAL STUDIO  ·  mobile.js — phone and tablet layout: dock, sheet, drawer
// ────────────────────────────────────────────────────────────────────────────
//  Owner: PANELS agent. styles/mobile.css holds the layout; this module holds
//  the state that the CSS reads, and the touch gestures.
//
//  LAYOUTS  (body[data-layout], set from the media queries below)
//      phone    PHONE_Q. The viewport fills the screen. The dock opens one
//               panel at a time: a bottom sheet in portrait (half or full
//               height, drag the grip), a right drawer in landscape (the dock
//               is a rail on the left edge).
//      tablet   TABLET_Q. Desktop grid without the library column; the
//               library is a left drawer, and in portrait the viewport sits
//               over the graph. The dock switches the side tabs.
//      desktop  everything else; the dock is hidden.
//
//  STATE THE CSS READS
//      body[data-layout]     phone | tablet | desktop
//      body[data-orient]     port | land
//      body[data-sheet]      graph | lib | inspector | env | export | maps | ''
//      body[data-sheet-size] half | full  (phone portrait only)
//      --sheet-px            the dragged sheet height in px while a drag runs
//
//  SECTIONS  (grep -n the banner to jump)
//      queries ......... PHONE_Q, LAND_Q, TABLET_Q, applyLayout
//      sheet ........... setSheet, setSheetSize, grip drag, Esc
//      dock ............ labels, badges
//      touch graph ..... one-finger pan, two-finger pinch for #graph-wrap
//                        (used only when the editor does not do touch itself)
//      init / api ...... init(ctx), __studio.mobile
//
//  The viewport stays visible: in half-sheet portrait and in landscape the
//  CSS shrinks #viewport-wrap to the area the panel does not cover, and this
//  module fires a window resize so the viewport canvas follows.
// ============================================================================

let ctx = null, store = null, $ = id => document.getElementById(id);

// ------------------------------------------------------------ queries
// These strings match the @media blocks in styles/mobile.css.
export const PHONE_Q = '(max-width: 768px), (max-height: 500px) and (pointer: coarse)';
export const LAND_Q = '(orientation: landscape) and (max-height: 500px)';
export const TABLET_Q = '(pointer: coarse) and (min-width: 769px) and (max-width: 1199px) and (min-height: 501px)';
const mq = { phone: matchMedia(PHONE_Q), land: matchMedia(LAND_Q), tablet: matchMedia(TABLET_Q), coarse: matchMedia('(pointer: coarse)') };

const SHEET_TITLES = { graph: 'Node graph', lib: 'Node library', inspector: 'Inspector', env: 'Light & view', export: 'Export', maps: 'Baked maps' };

function layout() { return mq.phone.matches ? 'phone' : mq.tablet.matches ? 'tablet' : 'desktop'; }
function applyLayout() {
  const b = document.body;
  const prev = b.dataset.layout;
  b.dataset.layout = layout();
  b.dataset.orient = (mq.land.matches || innerWidth > innerHeight) ? 'land' : 'port';
  b.classList.toggle('touch', mq.coarse.matches);
  if (prev && prev !== b.dataset.layout) {
    // Leaving the phone: keep a side tab, drop sheet-only state.
    if (b.dataset.layout === 'desktop') setSheet('');
  }
  fireResize();
}
let rz = 0;
function fireResize() {
  cancelAnimationFrame(rz);
  rz = requestAnimationFrame(() => { window.dispatchEvent(new Event('resize')); setTimeout(() => window.dispatchEvent(new Event('resize')), 320); });
}

// ------------------------------------------------------------ sheet
const SIDE = ['inspector', 'env', 'export'];
/**
 * Open a dock panel ('' closes it). On a phone it opens the sheet or drawer.
 * On a tablet, 'lib' toggles the library drawer, 'graph' maximizes the graph,
 * 'maps' enlarges the strip, and the side names switch the side tab.
 * On a desktop only the side names do anything.
 * @param {string} name
 */
export function setSheet(name) {
  const b = document.body;
  name = name || '';
  const L = b.dataset.layout || layout();
  if (SIDE.includes(name)) {
    const tab = document.querySelector(`#side-tabs button[data-tab="${name}"]`);
    if (tab) tab.click(); else b.dataset.side = name;
  }
  if (L === 'desktop') { b.dataset.sheet = ''; markDock(); return; }
  if (L === 'tablet' && SIDE.includes(name)) name = '';
  b.dataset.sheet = name;
  if (name && L === 'phone' && !b.dataset.sheetSize) b.dataset.sheetSize = name === 'graph' ? 'full' : 'half';
  $('sheet')?.setAttribute('aria-hidden', String(!name));
  const t = $('sheet-title'); if (t) t.textContent = SHEET_TITLES[name] || '';
  if (ctx) ctx.store.state.ui.sheet = name;
  markDock();
  fireResize();
}
/** @param {'half'|'full'} size */
export function setSheetSize(size) {
  document.body.dataset.sheetSize = size === 'full' ? 'full' : 'half';
  const b = $('sheet-size'); if (b) b.textContent = size === 'full' ? 'Half' : 'Full';
  fireResize();
}
function markDock() {
  const b = document.body, L = b.dataset.layout;
  const cur = b.dataset.sheet;
  for (const btn of $('dock').querySelectorAll('button[data-sheet]')) {
    const s = btn.dataset.sheet;
    const on = s === cur || (L === 'tablet' && SIDE.includes(s) && b.dataset.side === s);
    btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', String(on));
  }
}
function initSheet() {
  const sheet = $('sheet'), grip = $('sheet-grip');
  // the size toggle and close live in the sheet bar
  const size = document.createElement('button');
  size.type = 'button'; size.id = 'sheet-size'; size.className = 'sheet-btn'; size.textContent = 'Full';
  size.addEventListener('click', () => setSheetSize(document.body.dataset.sheetSize === 'full' ? 'half' : 'full'));
  const close = document.createElement('button');
  close.type = 'button'; close.id = 'sheet-close'; close.className = 'sheet-btn'; close.setAttribute('aria-label', 'Close the panel'); close.textContent = '✕';
  close.addEventListener('click', () => setSheet(''));
  sheet.append(size, close);
  // grip: tap closes; drag up or down resizes, a long pull down closes
  let drag = null;
  grip.addEventListener('pointerdown', e => {
    if (document.body.dataset.orient === 'land') return;
    drag = { y0: e.clientY, h0: sheetPx(), moved: false };
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener('pointermove', e => {
    if (!drag) return;
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dy) < 6) return;
    drag.moved = true;
    document.body.classList.add('sheet-drag');
    const hpx = Math.max(80, Math.min(maxSheetPx(), drag.h0 - dy));
    document.documentElement.style.setProperty('--sheet-px', hpx + 'px');
  });
  const end = e => {
    if (!drag) return;
    const d = drag; drag = null;
    document.body.classList.remove('sheet-drag');
    document.documentElement.style.removeProperty('--sheet-px');
    if (!d.moved) { setSheet(''); return; }
    const dy = e.clientY - d.y0, hpx = d.h0 - dy;
    if (hpx < 120 || dy > 160) setSheet('');
    else setSheetSize(hpx > (maxSheetPx() + halfSheetPx()) / 2 ? 'full' : 'half');
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
  grip.addEventListener('click', e => e.preventDefault()); // the stub's click-to-close is replaced by end()
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !document.body.dataset.sheet) return;
    const t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (document.querySelector('.pn-modal, .pn-menu, .pn-picker:not([hidden])')) return;
    setSheet('');
  });
}
function sheetPx() { const el = $('side'); const panels = ['graph-wrap', 'lib-panel', 'side', 'maps-strip'].map($).filter(x => x && x.offsetParent); return (panels[0] || el)?.getBoundingClientRect().height || halfSheetPx(); }
function halfSheetPx() { return Math.min(innerHeight * 0.52, innerHeight - 200); }
function maxSheetPx() { const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top')) || 34; const dock = $('dock')?.getBoundingClientRect().height || 56; return innerHeight - top - dock - 40; }

// ------------------------------------------------------------ dock
const DOCK_LABELS = { graph: 'Graph', lib: 'Library', inspector: 'Inspect', env: 'Light', export: 'Export', maps: 'Maps' };
function initDock() {
  const dock = $('dock');
  for (const b of dock.querySelectorAll('button[data-sheet]')) {
    const s = b.dataset.sheet;
    b.textContent = '';
    b.append(Object.assign(document.createElement('span'), { className: 'dk-l', textContent: DOCK_LABELS[s] || s }));
    b.append(Object.assign(document.createElement('i'), { className: 'dk-badge' }));
    b.setAttribute('aria-label', SHEET_TITLES[s] || s);
  }
  dock.addEventListener('click', e => {
    const b = e.target.closest('button[data-sheet]'); if (!b) return;
    const s = b.dataset.sheet, L = document.body.dataset.layout;
    if (L === 'tablet' && SIDE.includes(s)) { setSheet(s); return; }
    setSheet(document.body.dataset.sheet === s ? '' : s);
  });
  // badges: selection count on Inspect, bake error on Maps
  store.on('graph:select', ({ ids }) => {
    const bd = dock.querySelector('button[data-sheet=inspector] .dk-badge');
    if (bd) { bd.textContent = ids.length ? String(ids.length) : ''; bd.classList.toggle('on', ids.length > 0); }
    // main.js switches the side tab to the inspector on a selection; keep the sheet in step
    const cur = document.body.dataset.sheet;
    if (ids.length && (cur === 'env' || cur === 'export')) setSheet('inspector');
  });
  store.on('bake:error', () => dock.querySelector('button[data-sheet=maps] .dk-badge')?.classList.add('on', 'err'));
  store.on('bake:done', () => dock.querySelector('button[data-sheet=maps] .dk-badge')?.classList.remove('on', 'err'));
  // after a library add on the phone, panels.js calls setSheet('graph') itself
}

// ------------------------------------------------------------ touch graph
// The graph editor owns pan and zoom. If its api says it handles touch
// (editor.touch === true) this does nothing. Otherwise, when the editor has
// panBy(dx, dy) and zoomAt(factor, clientX, clientY), this maps one-finger
// drags on the empty canvas to pan and two-finger pinch to zoom.
function initTouchGraph() {
  const wrap = $('graph-wrap'); if (!wrap) return;
  const pts = new Map();
  let last = null;
  const ed = () => ctx.modules.editor || {};
  const api = () => window.__studio?.editor || ed();
  const usable = () => { const a = api(); return a && a.touch !== true && typeof a.panBy === 'function' && typeof a.zoomAt === 'function'; };
  wrap.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' || !usable()) return;
    // a touch on a node, socket or widget belongs to the editor
    if (pts.size === 0 && e.target.closest('[data-node], .node, .ne-node, .gn, button, input, select, textarea')) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    last = snapshot(pts);
  }, { capture: true });
  wrap.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const now = snapshot(pts);
    if (last && now.n === last.n) {
      const a = api();
      a.panBy(now.cx - last.cx, now.cy - last.cy);
      if (now.n >= 2 && last.d > 0) a.zoomAt(now.d / last.d, now.cx, now.cy);
      e.preventDefault(); e.stopPropagation();
    }
    last = now;
  }, { capture: true });
  const up = e => { if (pts.delete(e.pointerId)) last = pts.size ? snapshot(pts) : null; };
  wrap.addEventListener('pointerup', up, { capture: true });
  wrap.addEventListener('pointercancel', up, { capture: true });
}
function snapshot(pts) {
  const a = [...pts.values()];
  const cx = a.reduce((s, p) => s + p.x, 0) / a.length, cy = a.reduce((s, p) => s + p.y, 0) / a.length;
  const d = a.length >= 2 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0;
  return { n: a.length, cx, cy, d };
}

// ------------------------------------------------------------ init / api
export const api = {
  setSheet, setSheetSize, PHONE_Q, LAND_Q, TABLET_Q,
  get layout() { return document.body.dataset.layout; },
  selfTest() {
    const b = document.body;
    const vp = $('viewport-wrap')?.getBoundingClientRect();
    return {
      layout: b.dataset.layout, orient: b.dataset.orient, sheet: b.dataset.sheet || '',
      dockVisible: getComputedStyle($('dock')).display !== 'none',
      viewport: vp ? [Math.round(vp.width), Math.round(vp.height)] : null,
      overflowX: document.documentElement.scrollWidth > innerWidth,
      ok: !!b.dataset.layout,
    };
  },
};

/** @param {object} c main.js module context */
export async function init(c) {
  ctx = c; store = c.store; $ = c.$;
  for (const q of Object.values(mq)) q.addEventListener('change', applyLayout);
  window.addEventListener('orientationchange', applyLayout);
  applyLayout();
  initDock();
  initSheet();
  initTouchGraph();
  setSheet('');
  ctx.register('mobile', api);
}
