// ============================================================================
//  CORAL REEF  ·  FEED SIZE tests (node, pure):  node tests/feedsize.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "the rov's feeds need to be bigger".
//  squad-hud.js feedLayout and feedRects, per viewport and S/M/L size:
//    main ...... desktop 16:10 at M: the main card is 30 to 34 % of the
//                width; S < M < L
//    thumbs .... the other 3 cards are at least 1.4 times the old width
//                (the old feedLayout is copied here)
//    fit ....... the stack fits under the readout and over the bottom
//                margin; no card overlaps the minimap (lower left, 240 to
//                300 px, or 420 px at L) or the camera bar (top centre);
//                no two cards overlap
//    phone ..... one card, large (M: 0.58 of the width)
//  The feed render budget (rov/feeds.js) does not read the card size:
//  tests/feeds.test.mjs checks it.
// ============================================================================
import { feedLayout, feedRects, FEED_TOOLS_H } from '../squad-hud.js';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${name}${info !== '' ? ' ' + info : ''}`); } };
const CARD_AR = 322 / 352;
// the feedLayout of 0e13cd76 (before this change)
function oldLayout({ vw, vh, n, top = 0, bottom = 14, gap = 8 }) {
  const A = Math.max(120, vh - top - bottom);
  let wm = Math.min(352, Math.max(220, vw * 0.27)), wt = Math.round(wm * 0.6);
  const need = (a, b) => CARD_AR * (a + (n - 1) * b) + gap * (n - 1);
  if (need(wm, wt) > A) { const k = (A - gap * (n - 1)) / (CARD_AR * (wm + (n - 1) * wt)); wm *= k; wt *= k; }
  return { main: Math.round(Math.max(150, wm)), thumb: Math.round(Math.max(96, wt)) };
}
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

for (const [vw, vh] of [[1440, 900], [1680, 1050], [1920, 1200], [1280, 800]]) {
  const top = 230, n = 4;
  const Ls = {}; for (const size of ['S', 'M', 'L']) Ls[size] = feedLayout({ vw, vh, n, top, size });
  const M = Ls.M, f = M.main / vw;
  ok(f >= 0.30 && f <= 0.34, `${vw}x${vh} M: the main card is 30 to 34 % of the width`, f.toFixed(3));
  ok(Ls.S.main < M.main && M.main <= Ls.L.main, `${vw}x${vh}: S < M <= L`, `${Ls.S.main} ${M.main} ${Ls.L.main}`);
  const o = oldLayout({ vw, vh, n, top });
  ok(M.thumb >= 1.4 * o.thumb, `${vw}x${vh} M: the other cards are clearly larger than before`, `${o.thumb} -> ${M.thumb}`);
  for (const size of ['S', 'M', 'L']) for (const mm of [240, 300, 420]) {
    // the minimap: lower left, right of a 320 px panel, a legend under it
    const map = { x: 320 + 14, y: vh - 14 - mm - 40, w: mm + 12, h: mm + 40 };
    const L = feedLayout({ vw, vh, n, top, size, left: map.x + map.w + 12 });
    const R = feedRects(L, { vw, vh, n });
    const bar = { x: vw / 2 - 360, y: 56, w: 720, h: 44 };
    const all = [R.tools, ...R.cards];
    ok(R.tools.y >= top - 1, `${vw}x${vh} ${size} map ${mm}: the stack fits under the readout`, `${R.tools.y.toFixed(0)} < ${top}`);
    ok(all.every(r => !hit(r, map)), `${vw}x${vh} ${size} map ${mm}: no card overlaps the minimap`, JSON.stringify(R.cards[3]));
    ok(all.every(r => !hit(r, bar)), `${vw}x${vh} ${size} map ${mm}: no card overlaps the camera bar`);
    ok(R.cards.every((a, i) => R.cards.every((b, j) => i === j || !hit(a, b))), `${vw}x${vh} ${size} map ${mm}: no two cards overlap`);
    ok(R.cards.every(r => r.x >= 0 && r.x + r.w <= vw - 11 && r.y + r.h <= vh - 11), `${vw}x${vh} ${size} map ${mm}: the cards stay in the window`);
  }
}
{
  const P = feedLayout({ vw: 390, vh: 844, n: 4, phone: true });
  ok(P.one && P.thumb === 0 && P.main >= 220 && P.main <= 374, 'phone 390x844 M: one large card (about 0.58 of the width)', JSON.stringify(P));
  const Q = feedLayout({ vw: 844, vh: 390, n: 4, phone: true });
  ok(Q.one && Q.main * CARD_AR <= 390 * 0.46, 'phone landscape: the card stays under half the height', JSON.stringify(Q));
  ok(FEED_TOOLS_H > 0, 'the tool row has a height');
}
console.log(`feedsize: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
