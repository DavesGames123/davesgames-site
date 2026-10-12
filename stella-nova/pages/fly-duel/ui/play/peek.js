// ============================================================================
//  FLY DUEL  ·  play mode, the hovered version of a card  (ES module, DOM)
// ----------------------------------------------------------------------------
//  The user (verbatim, 2026-10-12): "hovering cards in the game section
//  should pull the image up in their hovered version". As in MTG Arena:
//      mouse or pen   hover a card in your hand or a face-up card on the
//                     table; after PEEK.delay ms (120) a large copy of the
//                     card shows beside or above it, it follows the
//                     hover, and it goes when the pointer leaves
//      touch          press and hold (PEEK.holdMs) shows it, release
//                     hides it; a drag to play or an orbit drag never
//                     shows it (the hold timer stops when the finger moves)
//  The copy is drawCard of ui/cardface.js at the screen pixel ratio with
//  its picture (paintWithArt draws again when the picture loads), and the
//  keyword reminders under it. A hidden card (the question-mark back, id
//  null) never shows. The copy takes no pointer events and never lies on
//  the card or the point that the pointer is on (peekPlace).
//  ui/play/hand.js lifts and enlarges the hovered hand card in place
//  (play.css .pl-hc.is-peek and :hover). ui/play/play.js gives the input.
//
//  GREP MAP
//      grep -n 'export const PEEK'           delay, hold, gap, sizes
//      grep -n 'export function peekSize'    CSS px of the copy
//      grep -n 'export function peekPlace'   where it goes (pure)
//      grep -n 'export function createPeek'  the element and its timer
// ============================================================================

// delay: hover time before the copy shows (ms); holdMs: touch hold;
// gap: px between the copy and the card; margin: px to the view edge;
// maxH: the copy is at most this high (CSS px), and at most vh * h and
// vw * w (5:7); minW: a copy that must shrink is this wide or more on
// any phone (320 px and up), tests/peek.test.mjs.
export const PEEK = Object.freeze({ delay: 120, holdMs: 380, gap: 12, margin: 8, maxH: 560, h: 0.62, w: 0.9, minW: 120 });

// The CSS px size of the copy for a view of vw x vh.
export function peekSize(vw, vh) {
  let h = Math.min(PEEK.maxH, vh * PEEK.h);
  let w = h * 5 / 7;
  if (w > vw * PEEK.w) { w = vw * PEEK.w; h = w * 7 / 5; }
  return { w: Math.round(w), h: Math.round(h) };
}

// Where the copy goes. a: the anchor rect in client px ({ left, top,
// right, bottom }: the card, or a small box round the pointer). size:
// { w, h }. view: [vw, vh]. prefer: 'above' (a hand card) or 'side' (a
// card on the table). The copy never overlaps the anchor. Order:
//   above   above the anchor, centred on it; else beside it (right,
//           then left); else below; else above, shrunk to the room
//   side    right of the anchor, then left; else above, then below;
//           else the largest of the four, shrunk to the room
// Returns { x, y, w, h, at } (at: above | below | right | left).
export function peekPlace(a, size, view, prefer = 'side') {
  const [vw, vh] = view;
  const m = PEEK.margin, g = PEEK.gap;
  const clampX = (x, w) => Math.max(m, Math.min(vw - m - w, x));
  const clampY = (y, h) => Math.max(m, Math.min(vh - m - h, y));
  const room = {
    above: a.top - g - m, below: vh - m - (a.bottom + g),
    right: vw - m - (a.right + g), left: a.left - g - m,
  };
  const cx = (a.left + a.right) / 2, cy = (a.top + a.bottom) / 2;
  const at = (k, w, h) => {
    if (k === 'above') return { x: clampX(cx - w / 2, w), y: a.top - g - h, w, h, at: k };
    if (k === 'below') return { x: clampX(cx - w / 2, w), y: a.bottom + g, w, h, at: k };
    if (k === 'right') return { x: a.right + g, y: clampY(prefer === 'above' ? a.bottom - h : cy - h / 2, h), w, h, at: k };
    return { x: a.left - g - w, y: clampY(prefer === 'above' ? a.bottom - h : cy - h / 2, h), w, h, at: k };
  };
  const fits = k => (k === 'above' || k === 'below') ? room[k] >= size.h && vw - 2 * m >= size.w : room[k] >= size.w && vh - 2 * m >= size.h;
  const order = prefer === 'above' ? ['above', 'right', 'left', 'below'] : ['right', 'left', 'above', 'below'];
  for (const k of order) if (fits(k)) return at(k, size.w, size.h);
  // nothing fits at full size: shrink into the side with the most room
  let best = null;
  for (const k of order) {
    const vert = k === 'above' || k === 'below';
    let w = vert ? Math.min(size.w, vw - 2 * m, room[k] * 5 / 7) : Math.min(size.w, room[k], (vh - 2 * m) * 5 / 7);
    w = Math.floor(w);
    if (!best || w > best.w) best = { k, w };
  }
  const w = Math.max(48, best.w);
  return at(best.k, w, Math.round(w * 7 / 5));
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// host: the play root. opts: CARD (id -> card), CF (ui/cardface.js:
// drawCard, paintWithArt), KEYWORDS (keyword -> reminder), view() -> [w, h]
// (the size of the host when it has no layout box). Returns { el, schedule, show, move, hide, id, isOpen,
// dispose }. The anchor of schedule, show and move is a client rect (or a
// function that gives one, read when the copy shows).
export function createPeek(host, { CARD, CF, KEYWORDS = {}, view } = {}) {
  const doc = host.ownerDocument;
  const el = doc.createElement('div');
  el.className = 'pl-peek';
  el.hidden = true;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<canvas class="pl-peek-cv"></canvas><p class="pl-peek-kw" hidden></p>';
  host.appendChild(el);
  const cv = el.querySelector('canvas'), kw = el.querySelector('.pl-peek-kw');
  let cur = null, timer = 0, pending = null, last = null;
  const vw = () => (view ? view() : [globalThis.innerWidth || 390, globalThis.innerHeight || 844]);
  const rectOf = a => (typeof a === 'function' ? a() : a);

  function draw(id, w, h) {
    const card = CARD?.[id];
    const dpr = Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1));
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    cv.style.width = `${w}px`; cv.style.height = `${h}px`;
    if (el.dataset.drawn === `${id}|${W}x${H}`) return;
    el.dataset.drawn = `${id}|${W}x${H}`;
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

  // the anchor is in client px; the copy is placed in the host box
  function place(anchor, prefer) {
    const c = rectOf(anchor);
    if (!c) return;
    let o = null;
    try { o = host.getBoundingClientRect?.() || null; } catch { o = null; }
    const ox = o?.left || 0, oy = o?.top || 0;
    const [w, h] = o?.width > 0 && o?.height > 0 ? [o.width, o.height] : vw();
    const r = { left: c.left - ox, top: c.top - oy, right: c.right - ox, bottom: c.bottom - oy };
    // the keyword box under the card takes room too (0 without layout)
    const extra = kw.hidden ? 0 : (kw.offsetHeight || 0) + 4;
    const sz = peekSize(w, h);
    const p = peekPlace(r, { w: sz.w, h: sz.h + extra }, [w, h], prefer);
    const ch = Math.max(1, p.h - extra);
    draw(cur, Math.round(Math.min(p.w, ch * 5 / 7)), Math.round(Math.min(ch, p.w * 7 / 5)));
    el.style.left = `${Math.round(p.x)}px`; el.style.top = `${Math.round(p.y)}px`;
    el.dataset.at = p.at;
    last = { anchor, prefer };
  }

  // Show the copy of card id now. A hidden card (id null) or an unknown
  // id hides it.
  function show(id, anchor, prefer = 'side') {
    clearTimeout(timer); timer = 0; pending = null;
    if (id == null || !CARD?.[id]) { hide(); return false; }
    const card = CARD[id];
    if (cur !== id) {
      cur = id;
      el.dataset.id = id;
      delete el.dataset.drawn;
      const kws = (card.keywords || []).map(k => KEYWORDS[k]).filter(Boolean);
      kw.innerHTML = kws.map(esc).join('<br>');
      kw.hidden = !kws.length;
    }
    el.hidden = false;
    place(anchor, prefer);
    return true;
  }
  // Show it after PEEK.delay ms, unless hide() or another card comes
  // first. The copy that shows already changes at once (MTG Arena: a move
  // from card to card does not wait again).
  function schedule(id, anchor, prefer = 'side') {
    if (id == null || !CARD?.[id]) { hide(); return; }
    if (!el.hidden) { show(id, anchor, prefer); return; }
    if (pending && pending.id === id) { pending.anchor = anchor; pending.prefer = prefer; return; }
    clearTimeout(timer);
    pending = { id, anchor, prefer };
    timer = setTimeout(() => { const p = pending; pending = null; timer = 0; if (p) show(p.id, p.anchor, p.prefer); }, PEEK.delay);
  }
  // follow the hover: a new anchor for the copy that shows (or waits)
  function move(anchor) {
    if (pending) { pending.anchor = anchor; return; }
    if (!el.hidden && last) place(anchor, last.prefer);
  }
  function hide() {
    clearTimeout(timer); timer = 0; pending = null;
    if (el.hidden) return false;
    el.hidden = true; cur = null; last = null; delete el.dataset.id;
    return true;
  }
  return {
    el, schedule, show, move, hide,
    id: () => cur, isOpen: () => !el.hidden, waiting: () => !!pending,
    resize() { if (!el.hidden && last) place(last.anchor, last.prefer); },
    dispose() { hide(); el.remove(); },
  };
}
