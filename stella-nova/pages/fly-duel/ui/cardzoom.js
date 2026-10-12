// ============================================================================
//  FLY DUEL  ·  the card zoom of the watch table  (ES module, DOM)
// ----------------------------------------------------------------------------
//  The user (2026-10-11, verbatim): "also if i hover and right click over
//  any card during the simulation i should be able to see a magnified
//  view of it superimposed on the screen until i right click somewhere
//  elese".
//  The user (2026-10-12, verbatim): "wehen i focus on a card it sholdnt
//  be the only thing availabe in the iterface".
//
//  NON-MODAL FOCUS. A focused card never blocks the interface. The zoom
//  has no veil, no full-screen box and no click-catcher. Only its close
//  control (.czoom-x, 44 px) takes pointer events. A click, a drag or a
//  wheel on the table goes to the table under the card. focusPlace puts
//  the card on the side of the screen away from the pointer, above the
//  reserved bands (the hand and the buttons). A phone gets a compact
//  card docked at the top (FOCUS.phone). ui/play/inspector.js uses the
//  same focusPlace for play mode.
//
//  createCardZoom draws one card face: drawCard of ui/cardface.js at the
//  screen pixel ratio, with its picture (paintWithArt draws again when
//  the picture loads). The card has a dark 1 px rim.
//
//  attachCardZoom gives the zoom its input on the table canvas:
//    right-click (contextmenu) on a card     open it, or change to it
//    right-click on no card, or anywhere
//    else on the page                         close
//    Escape                                   close
//    the close control (.czoom-x)             close
//    touch: a long press (450 ms) on a card   open it, or change to it
//    a left click or a tap on the table       goes to the table (the
//                                             zoom stays open)
//  pick(x, y) -> { id } | null is the raycast of the scene (pickFace of
//  ui/fly3d/scene.js). A hit with id null (a hidden card) never opens:
//  the zoom never shows the face of a hidden card. active() false (play
//  mode: play.js has its own inspector) turns the input off.
//
//  GREP MAP
//      grep -n 'export const ZOOM'            size limits
//      grep -n 'export function zoomSize'     CSS px of the card (old max)
//      grep -n 'export const FOCUS'           limits of the focused card
//      grep -n 'export function focusPlace'   where a focused card goes
//      grep -n 'export function createCardZoom'  the zoom element
//      grep -n 'export function attachCardZoom'  the input
// ============================================================================

// longMs, slop: the touch long press. h, w, maxH: zoomSize, the old
// centred size (h: part of the view height, w: of the width; 5:7). The
// page now sizes the card with focusPlace; tests/cardzoom.test.mjs still
// reads zoomSize, so it stays.
export const ZOOM = Object.freeze({ h: 0.82, w: 0.86, maxH: 980, longMs: 450, slop: 10 });

// The CSS px size of the zoom card for a view of vw x vh.
export function zoomSize(vw, vh) {
  let h = Math.min(ZOOM.maxH, vh * ZOOM.h);
  let w = h * 5 / 7;
  if (w > vw * ZOOM.w) { w = vw * ZOOM.w; h = w * 7 / 5; }
  return { w: Math.round(w), h: Math.round(h) };
}

// The limits of a focused card. h: at most this part of the free band
// height; w: of the view width; maxH: CSS px; margin: px to the view
// edge. A view narrower than phone px (or lower than low px) is a phone:
// the card is compact (phoneW of the width, at most phoneMax px wide).
export const FOCUS = Object.freeze({ h: 0.9, w: 0.34, maxH: 620, minW: 96, margin: 10, phone: 600, low: 460, phoneW: 0.34, phoneMax: 150 });

// Where a focused card goes. view: [vw, vh]. ptr: { x, y } (the pointer
// that focused the card, in the same px) or null. opts: top and bottom
// (px bands to keep clear: the scorecards, the hand and the buttons),
// extra (px of text under the card, desktop only). The card goes on the
// side away from the pointer (right when there is no pointer), at the
// top of the free band. Returns { x, y, w, h, side, dock } (w x h is the
// card, 5:7; dock true on a phone).
export function focusPlace(view, ptr = null, { top = 0, bottom = 0, extra = 0 } = {}) {
  const [vw, vh] = view;
  const m = FOCUS.margin;
  const dock = vw < FOCUS.phone || vh < FOCUS.low;
  const side = ptr && Number.isFinite(ptr.x) && ptr.x >= vw / 2 ? 'left' : 'right';
  const t = Math.max(0, Math.min(top, vh * 0.4)), b = Math.max(0, Math.min(bottom, vh * 0.45));
  const band = Math.max(60, vh - t - b - 2 * m - (dock ? 0 : extra));
  let w, h;
  if (dock) {
    w = Math.min(FOCUS.phoneMax, vw * FOCUS.phoneW);
    h = w * 7 / 5;
    if (h > band) { h = band; w = h * 5 / 7; }
  } else {
    h = Math.min(FOCUS.maxH, band * FOCUS.h);
    w = h * 5 / 7;
    if (w > vw * FOCUS.w) { w = vw * FOCUS.w; h = w * 7 / 5; }
    if (w < FOCUS.minW) { w = Math.min(FOCUS.minW, vw - 2 * m); h = w * 7 / 5; }
  }
  w = Math.round(w); h = Math.round(h);
  const x = side === 'left' ? m : Math.max(m, vw - m - w);
  const y = Math.round(t + m);
  return { x, y, w, h, side, dock };
}

// host: the element the zoom goes in (#app). opts: CARD (id -> card),
// CF (ui/cardface.js: drawCard, paintWithArt), view() -> [w, h] (the
// size when the host has no layout box), bands() -> { top, bottom } (px
// to keep clear; default: the part of the host under the .stage box,
// that is the control bar of the watch table).
export function createCardZoom(host, { CARD, CF, view, bands } = {}) {
  const doc = host.ownerDocument;
  const el = doc.createElement('div');
  el.className = 'czoom';
  el.hidden = true;
  // non-modal: a region of the page, not a dialog; focus stays where it is
  el.setAttribute('role', 'region');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = '<canvas class="czoom-cv"></canvas><button type="button" class="czoom-x" aria-label="Close the magnified card">\u00d7</button>';
  host.appendChild(el);
  const cv = el.querySelector('canvas');
  const x = el.querySelector('.czoom-x');
  let cur = null, ptr = null;
  x.addEventListener('click', e => { e.stopPropagation?.(); close(); });
  x.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation?.(); close(); });

  const boxOf = n => { try { return n?.getBoundingClientRect?.() || null; } catch { return null; } };
  const bandsOf = (o, vh) => {
    if (bands) { try { return bands() || {}; } catch { return {}; } }
    const st = boxOf(host.querySelector?.('.stage'));
    if (!o || !st || !(st.height > 0)) return { top: 0, bottom: 0 };
    return { top: 0, bottom: Math.max(0, Math.min(vh, o.bottom - st.bottom)) };
  };

  function draw(id) {
    const card = CARD?.[id];
    const o = boxOf(host);
    const has = o && o.width > 0 && o.height > 0;
    const [vw, vh] = has ? [o.width, o.height] : (view ? view() : [globalThis.innerWidth || 390, globalThis.innerHeight || 844]);
    const p = ptr ? { x: ptr.x - (has ? o.left : 0), y: ptr.y - (has ? o.top : 0) } : null;
    const P = focusPlace([vw, vh], p, bandsOf(has ? o : null, vh));
    const { w, h } = P;
    el.style.left = `${P.x}px`; el.style.top = `${P.y}px`;
    el.style.width = `${w}px`;
    el.dataset.side = P.side;
    if (P.dock) el.dataset.dock = ''; else delete el.dataset.dock;
    const dpr = Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1));
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = `${w}px`; cv.style.height = `${h}px`;
    let g = null;
    try { g = cv.getContext?.('2d') || null; } catch { g = null; }
    if (!g || !card || !CF?.drawCard) return;
    const paint = art => {
      if (cur !== id) return;
      g.setTransform?.(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cv.width, cv.height);
      CF.drawCard(g, card, { w: cv.width, h: cv.height, art: art || null, mode: 'full', dpr });
    };
    if (CF.paintWithArt) CF.paintWithArt(cv, id, paint); else paint(null);
  }

  // at: the client point of the pointer that focused the card (optional);
  // the card goes on the other side of the screen
  function open(id, at = null) {
    if (id == null || !CARD?.[id]) return false;
    if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) ptr = { x: at.x, y: at.y };
    if (cur === id && !el.hidden) return true;
    cur = id;
    el.dataset.id = id;
    el.setAttribute('aria-label', `${CARD[id].name}: magnified card. Right-click elsewhere, press Escape or use the close button to close it.`);
    el.hidden = false;
    draw(id);
    return true;
  }
  function close() {
    if (el.hidden) return false;
    el.hidden = true; cur = null; delete el.dataset.id;
    return true;
  }
  // the card rect on the screen (client px)
  function rect() { return el.hidden ? null : cv.getBoundingClientRect?.() || null; }

  return {
    el, open, close, rect,
    id: () => cur, isOpen: () => !el.hidden,
    resize() { if (cur != null) draw(cur); },
    dispose() { close(); el.remove(); },
  };
}

// The input of the zoom. canvas: the table canvas; zoom: createCardZoom;
// pick(x, y) -> { id } | null; active() -> bool. Returns { dispose }.
export function attachCardZoom(canvas, zoom, { pick, active = () => true, doc = canvas.ownerDocument } = {}) {
  const hitAt = (x, y) => { let h = null; try { h = pick(x, y); } catch { h = null; } return h; };
  // a right-click on the table: a card opens or changes, no card closes
  const onMenu = e => {
    if (!active()) return;
    e.preventDefault();
    e.stopPropagation?.();
    const h = hitAt(e.clientX, e.clientY);
    if (h && h.id != null) zoom.open(h.id, { x: e.clientX, y: e.clientY });
    else zoom.close();
  };
  // a right-click anywhere else on the page closes the zoom (the close
  // control has its own handler)
  const onDocMenu = e => {
    if (e.target === canvas || !zoom.isOpen() || zoom.el?.contains?.(e.target)) return;
    e.preventDefault();
    zoom.close();
  };
  const onKey = e => { if (e.key === 'Escape' && zoom.isOpen()) { zoom.close(); e.preventDefault?.(); } };
  // touch: a long press opens or changes the card. A tap goes to the
  // table (orbit, a pick): it does not close the zoom (non-modal); the
  // close control, Escape or a right-click elsewhere close it.
  let press = null;
  const onDown = e => {
    if (e.pointerType !== 'touch' || !active()) return;
    clearTimeout(press?.t);
    const x = e.clientX, y = e.clientY;
    press = { x, y, long: false, t: setTimeout(() => {
      const h = hitAt(x, y);
      if (h && h.id != null) { press.long = true; zoom.open(h.id, { x, y }); }
    }, ZOOM.longMs) };
  };
  const onMove = e => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > ZOOM.slop) { clearTimeout(press.t); press.moved = true; } };
  const onUp = e => {
    if (!press || e.pointerType !== 'touch') return;
    clearTimeout(press.t);
    press = null;
  };
  const onCancel = () => { if (press) { clearTimeout(press.t); press = null; } };
  canvas.addEventListener('contextmenu', onMenu);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  doc?.addEventListener('contextmenu', onDocMenu);
  doc?.addEventListener('keydown', onKey);
  return {
    dispose() {
      onCancel();
      canvas.removeEventListener('contextmenu', onMenu);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      doc?.removeEventListener('contextmenu', onDocMenu);
      doc?.removeEventListener('keydown', onKey);
    },
  };
}
