// ============================================================================
//  FLY DUEL  ·  the card zoom of the watch table  (ES module, DOM)
// ----------------------------------------------------------------------------
//  The user (2026-10-11, verbatim): "also if i hover and right click over
//  any card during the simulation i should be able to see a magnified
//  view of it superimposed on the screen until i right click somewhere
//  elese".
//
//  createCardZoom puts one large card face over the centre of the screen:
//  drawCard of ui/cardface.js at the screen pixel ratio, with its picture
//  (paintWithArt draws again when the picture loads). The card has a dark
//  1 px rim and no veil around it. The zoom takes no pointer events, so
//  the next right-click goes to the table under it.
//
//  attachCardZoom gives the zoom its input on the table canvas:
//    right-click (contextmenu) on a card     open it, or change to it
//    right-click on no card, or anywhere
//    else on the page                         close
//    Escape                                   close
//    touch: a long press (450 ms) on a card   open it
//    touch: a tap outside the card face       close
//  pick(x, y) -> { id } | null is the raycast of the scene (pickFace of
//  ui/fly3d/scene.js). A hit with id null (a hidden card) never opens:
//  the zoom never shows the face of a hidden card. active() false (play
//  mode: play.js has its own inspector) turns the input off.
//
//  GREP MAP
//      grep -n 'export const ZOOM'            size limits
//      grep -n 'export function zoomSize'     CSS px of the card
//      grep -n 'export function createCardZoom'  the zoom element
//      grep -n 'export function attachCardZoom'  the input
// ============================================================================

// h: at most this part of the view height, w: of the width; the card
// face is 5:7.
export const ZOOM = Object.freeze({ h: 0.82, w: 0.86, maxH: 980, longMs: 450, slop: 10 });

// The CSS px size of the zoom card for a view of vw x vh.
export function zoomSize(vw, vh) {
  let h = Math.min(ZOOM.maxH, vh * ZOOM.h);
  let w = h * 5 / 7;
  if (w > vw * ZOOM.w) { w = vw * ZOOM.w; h = w * 7 / 5; }
  return { w: Math.round(w), h: Math.round(h) };
}

// host: the element the zoom goes in (#app). opts: CARD (id -> card),
// CF (ui/cardface.js: drawCard, paintWithArt), view() -> [w, h].
export function createCardZoom(host, { CARD, CF, view } = {}) {
  const doc = host.ownerDocument;
  const el = doc.createElement('div');
  el.className = 'czoom';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = '<canvas class="czoom-cv"></canvas>';
  host.appendChild(el);
  const cv = el.querySelector('canvas');
  let cur = null;

  function draw(id) {
    const card = CARD?.[id];
    const [vw, vh] = view ? view() : [globalThis.innerWidth || 390, globalThis.innerHeight || 844];
    const { w, h } = zoomSize(vw, vh);
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

  function open(id) {
    if (id == null || !CARD?.[id]) return false;
    if (cur === id && !el.hidden) return true;
    cur = id;
    el.dataset.id = id;
    el.setAttribute('aria-label', `${CARD[id].name}: magnified card. Right-click elsewhere or press Escape to close.`);
    el.hidden = false;
    draw(id);
    return true;
  }
  function close() {
    if (el.hidden) return false;
    el.hidden = true; cur = null; delete el.dataset.id;
    return true;
  }
  // the card rect on the screen (client px), for "a tap outside"
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
    if (h && h.id != null) zoom.open(h.id);
    else zoom.close();
  };
  // a right-click anywhere else on the page closes the zoom
  const onDocMenu = e => {
    if (e.target === canvas || !zoom.isOpen()) return;
    e.preventDefault();
    zoom.close();
  };
  const onKey = e => { if (e.key === 'Escape' && zoom.isOpen()) { zoom.close(); e.preventDefault?.(); } };
  // touch: a long press opens, a tap outside the card closes
  let press = null;
  const onDown = e => {
    if (e.pointerType !== 'touch' || !active()) return;
    clearTimeout(press?.t);
    const x = e.clientX, y = e.clientY;
    press = { x, y, long: false, t: setTimeout(() => {
      const h = hitAt(x, y);
      if (h && h.id != null) { press.long = true; zoom.open(h.id); }
    }, ZOOM.longMs) };
  };
  const onMove = e => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > ZOOM.slop) { clearTimeout(press.t); press.moved = true; } };
  const onUp = e => {
    if (!press || e.pointerType !== 'touch') return;
    clearTimeout(press.t);
    const p = press; press = null;
    if (p.long || p.moved || !zoom.isOpen()) return;
    const r = zoom.rect();
    const inCard = r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inCard) zoom.close();
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
