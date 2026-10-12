// ============================================================================
//  FLY DUEL  ·  play mode, layout numbers  (ES module, no DOM, pure)
// ----------------------------------------------------------------------------
//  The play screen is designed for a phone held upright (390 x 844 CSS px)
//  first. layoutFor() turns the viewport into one of four layouts and the
//  sizes the DOM uses. fanLayout() places the hand cards on an arc.
//
//  LAYOUTS
//      phone       width < 600 and upright. Scorecards compact in one row
//                  at the top, the table in the middle, the hand fan at the
//                  bottom, the big button above the right end of the fan
//                  (right thumb). The fan never scrolls: more cards
//                  overlap more (fanLayout).
//      phone-land  a phone on its side (height < 500 on a coarse pointer,
//                  or width < 600 and wider than high). Scorecards in a
//                  column at the left, the button at the right edge,
//                  shorter hand cards.
//      tablet      600 <= width < 1024.
//      desktop     width >= 1024. Full scorecards, larger cards, hover
//                  zoom, keys.
//  Every touch target is at least 44 CSS px on a coarse pointer.
//
//  GREP MAP
//      grep -n 'export const BREAK'       breakpoints
//      grep -n 'export function layoutFor'
//      grep -n 'export function fanLayout'   the fan, no scroll, no clip
//      grep -n 'export const HAND'        hand box geometry (play.css)
//      grep -n 'export function handCardRect'  a hand card in the view
//      grep -n 'export const DRAG'        drag to play: start, drop line
//      grep -n 'export const CARD_RATIO'  5:7 card shape (ui/cardface.js)
// ============================================================================

export const BREAK = Object.freeze({ phone: 600, desktop: 1024, shortLand: 500 });
export const CARD_RATIO = 1.4;     // height / width (cardface draws 100 x 140)
export const TOUCH = 44;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function layoutFor(w, h, { coarse = false } = {}) {
  w = Math.max(1, w | 0); h = Math.max(1, h | 0);
  let kind;
  if ((coarse && h < BREAK.shortLand && w > h) || (w < BREAK.phone && w > h)) kind = 'phone-land';
  else if (w < BREAK.phone) kind = 'phone';
  else if (w < BREAK.desktop) kind = 'tablet';
  else kind = 'desktop';

  let handW;
  if (kind === 'phone') handW = clamp(Math.round(w * 0.25), 80, 108);
  else if (kind === 'phone-land') handW = clamp(Math.round((h * 0.34) / CARD_RATIO), 58, 84);
  else if (kind === 'tablet') handW = clamp(Math.round(w * 0.14), 104, 128);
  else handW = clamp(Math.round(Math.min(w * 0.095, h * 0.15)), 120, 156);
  const handH = Math.round(handW * CARD_RATIO);

  // how much of the hand shows when it rests (the rest is below the edge)
  const peek = kind === 'phone' ? Math.round(handH * 0.72) : kind === 'phone-land' ? Math.round(handH * 0.62) : Math.round(handH * 0.78);

  // creature cards on the 2D board: six fit across the board
  const boardWidth = kind === 'phone-land' ? w - 200 : w - 32;
  const boardW = clamp(Math.floor(boardWidth / 6.4), 48, kind === 'desktop' ? 104 : 84);

  const zoomW = Math.round(clamp(Math.min(w - 32, (h - 120) / CARD_RATIO), 220, 400));

  return {
    kind, w, h, coarse,
    target: coarse ? TOUCH : 32,
    hand: { w: handW, h: handH, peek },
    board: { w: boardW, h: Math.round(boardW * CARD_RATIO) },
    zoom: { w: zoomW, h: Math.round(zoomW * CARD_RATIO) },
    score: kind === 'phone' || kind === 'phone-land' ? 'compact' : 'full',
    scoreSide: kind === 'phone-land' ? 'column' : 'row',
    button: { minW: kind === 'phone' ? 148 : 172, h: Math.max(coarse ? 52 : 44, 44) },
    hover: !coarse,
  };
}

// Places n hand cards. width: the space for the fan (the whole width of
// the play box: the fan is not a fixed box). Returns { cards: [{ x, y,
// rot }], total, scroll, step, lift }. x is the left edge of a card, y
// the drop below the top line (the arc), rot in degrees. A selected card
// rises by 0.3 of its height and stands straight. The user (2026-10-12):
// "my hand should not be bounded". So the fan never scrolls and never
// clips: with more cards the step gets smaller and the cards overlap
// more, and every card stays in the width. scroll is always false (it
// stays in the result for old callers). lift: px that a hovered or held
// card rises, so that the whole card shows above the bottom edge (peek:
// px of a resting card in view, layoutFor().hand.peek).
export function fanLayout(n, { width, cardW, cardH = cardW * CARD_RATIO, selected = -1, maxRot = 12, peek = cardH * 0.72 } = {}) {
  const lift = hoverLift(cardH, peek);
  if (n <= 0) return { cards: [], total: 0, scroll: false, step: 0, lift };
  // room for the hover growth (HAND.hoverScale) of the end cards
  const pad = Math.max(8, Math.ceil(cardW * (HAND.hoverScale - 1) / 2) + 2);
  const room = Math.max(cardW, width - 2 * pad);
  const natural = cardW * 0.96;
  const stepX = n > 1 ? Math.max(0, Math.min(natural, (room - cardW) / (n - 1))) : 0;
  const total = cardW + stepX * (n - 1);
  const x0 = pad + (room - total) / 2;
  const rotStep = n > 1 ? Math.min(maxRot * 2 / (n - 1), 5) : 0;
  const mid = (n - 1) / 2;
  // a wide fan of many small steps keeps a flat arc
  const arcK = cardH * 0.012 * Math.min(1, stepX / (cardW * 0.42));
  const cards = [];
  for (let i = 0; i < n; i++) {
    const o = i - mid;
    const sel = i === selected;
    const rot = sel ? 0 : o * rotStep;
    const arc = Math.min(cardH * 0.2, Math.abs(o) * Math.abs(o) * arcK);
    cards.push({ x: Math.round(x0 + i * stepX), y: Math.round(sel ? -cardH * 0.3 : arc), rot: Math.round(rot * 10) / 10 });
  }
  return { cards, total: Math.round(total + 2 * pad), scroll: false, step: stepX, lift };
}

// The hand box geometry of play.css (.pl-handbox, .pl-hc), in units of the
// card height h: the box is HAND.box h high, a card rests HAND.top h below
// its top, and the box bottom is h - peek below the bottom edge.
// hoverScale: the hovered or held card grows by this (play.css scale).
// origin: transform-origin y of a hand card (1.3 = 130 %).
export const HAND = Object.freeze({ box: 1.36, top: 0.34, hoverScale: 1.16, origin: 1.3, margin: 6 });

// px that a hovered card rises: the bottom of the card comes HAND.margin px
// above the bottom edge of the view.
export function hoverLift(cardH, peek) {
  const below = cardH * (HAND.top + 1 - HAND.box) + cardH - peek;
  return Math.max(Math.round(cardH * 0.22), Math.round(below + HAND.margin));
}

// The rect of hand card i in the view (client px, rotation not counted),
// for the tests and the drop line: f = fanLayout(), vh = view height,
// sab = the bottom safe area. hover: the card is hovered or held (it
// stands at the top line, rises by f.lift and grows by HAND.hoverScale
// about its origin; the arc and the selection rise do not count).
export function handCardRect(L, f, i, { vh, sab = 0, hover = false } = {}) {
  const h = L.hand.h, w = L.hand.w, peek = L.hand.peek;
  const boxBottom = vh - sab - (peek - h);           // .pl-handbox bottom
  const boxTop = boxBottom - h * HAND.box;
  const c = f.cards[i];
  let top = boxTop + h * HAND.top + c.y, left = c.x;
  if (!hover) return { left, top, right: left + w, bottom: top + h };
  top = boxTop + h * HAND.top - f.lift;              // the hover drops the arc
  const s = HAND.hoverScale, oy = top + h * HAND.origin, cx = left + w / 2;
  return { left: cx - (w * s) / 2, right: cx + (w * s) / 2, top: oy - (oy - top) * s, bottom: oy - (oy - top - h) * s };
}

// Drag to play. start: px a press must move before it is a drag (in any
// direction: the fan does not scroll). pad: the drop line is this many px
// above the top of the hand box. A release above the line plays the card;
// a release below it, or a cancel, puts the card back in the hand.
export const DRAG = Object.freeze({ start: 10, pad: 8 });
export const dragStarts = (dx, dy) => Math.hypot(dx, dy) > DRAG.start;
export const dropLine = handTop => handTop - DRAG.pad;
export function dropVerdict(type, y, line) {
  return type === 'pointerup' && y < line ? 'play' : 'return';
}
