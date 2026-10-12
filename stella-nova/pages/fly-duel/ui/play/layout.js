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
//                  (right thumb). The fan scrolls sideways when the cards
//                  do not fit at the minimum overlap.
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
//      grep -n 'export function fanLayout'
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

// Places n hand cards. width: the space for the fan. Returns { cards:
// [{ x, y, rot }], total, scroll }. x is the left edge of a card, y the
// drop below the top line (the arc), rot in degrees. A selected card
// rises by lift and stands straight. When the cards do not fit with at
// least minShow of each card in view, the fan stops at that step and
// scroll is true: the DOM lets the fan scroll sideways.
export function fanLayout(n, { width, cardW, cardH = cardW * CARD_RATIO, selected = -1, maxRot = 12, minShow = 0.42 } = {}) {
  if (n <= 0) return { cards: [], total: 0, scroll: false };
  const pad = 8;
  const room = Math.max(cardW, width - 2 * pad);
  const natural = cardW * 0.96;
  let stepX = n > 1 ? Math.min(natural, (room - cardW) / (n - 1)) : 0;
  let scroll = false;
  if (n > 1 && stepX < cardW * minShow) { stepX = cardW * minShow; scroll = true; }
  const total = cardW + stepX * (n - 1);
  const x0 = scroll ? pad : pad + (room - total) / 2;
  const rotStep = n > 1 ? Math.min(maxRot * 2 / (n - 1), 5) : 0;
  const mid = (n - 1) / 2;
  const cards = [];
  for (let i = 0; i < n; i++) {
    const o = i - mid;
    const sel = i === selected;
    const rot = scroll || sel ? 0 : o * rotStep;
    const arc = scroll ? 0 : Math.abs(o) * Math.abs(o) * cardH * 0.012;
    cards.push({ x: Math.round(x0 + i * stepX), y: Math.round(sel ? -cardH * 0.3 : arc), rot: Math.round(rot * 10) / 10 });
  }
  return { cards, total: Math.round(total + 2 * pad), scroll };
}
