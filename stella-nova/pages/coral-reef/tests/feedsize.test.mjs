// ============================================================================
//  CORAL REEF  ·  FEED SIZE tests (node, pure):  node tests/feedsize.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "the rov's feeds need to be bigger", then
//  "the amount of space the ROV layer takes up is too considerable in this
//  layout. in the veritcal layout it's alright".
//  squad-hud.js feedLayout and feedRects, per viewport and S/M/L size:
//    main ...... landscape at M: the main card is 22 to 26 % of the 3D VIEW
//                width (the window less the open panel); S < M <= L
//    group ..... the whole group (cards and tool row) is 34 % of the view
//                width or less, in the right part of the view; the
//                1520x897 window with a 1060 px view (the screenshot)
//    narrow .... a narrow view (panels open) collapses the other cards
//                to tabs (one: true)
//    fit ....... the stack fits under the readout and over the bottom
//                margin; no card overlaps the minimap (lower left, 240 to
//                300 px, or 420 px at L) or the camera bar (top centre);
//                no two cards overlap
//    portrait .. a window higher than wide: the layout of 35272396, same
//                numbers (the old feedLayout is copied here)
//    phone ..... one card, large (M: 0.58 of the width)
//  The feed render budget (rov/feeds.js) does not read the card size:
//  tests/feeds.test.mjs checks it.
// ============================================================================
import { feedLayout, feedRects, FEED_TOOLS_H } from '../squad-hud.js';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${name}${info !== '' ? ' ' + info : ''}`); } };
const CARD_AR = 322 / 352;
// the feedLayout of 35272396 (the portrait layout keeps it)
function oldLayout({ vw, vh, n, top = 0, bottom = 12, right = 12, left = 0, gap = 8, size = 'M' }) {
  const F = { S: 0.26, M: 0.32, L: 0.38 }, A = Math.max(160, vh - top - bottom - FEED_TOOLS_H), m = Math.max(0, n - 1);
  let main = Math.min(vw * F[size], A / CARD_AR, 900);
  let thumb = m ? Math.min(main * 0.62, (A - gap * (m - 1)) / (m * CARD_AR)) : 0;
  const room = vw - right - left;
  if (main + (m ? gap + thumb : 0) > room) { const k = Math.max(0.3, (room - (m ? gap : 0)) / (main + thumb)); main *= k; thumb *= k; }
  return { main: Math.round(Math.max(150, main)), thumb: m ? Math.round(Math.max(96, thumb)) : 0 };
}
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const groupOf = R => { const all = [R.tools, ...R.cards], x0 = Math.min(...all.map(r => r.x)), x1 = Math.max(...all.map(r => r.x + r.w)); return { x0, x1, w: x1 - x0 }; };
const cases = [[1440, 900, 0], [1680, 1050, 320], [1920, 1200, 320], [1280, 800, 0], [1520, 897, 460]];
for (const [vw, vh, px] of cases) {
  const top = 230, n = 4, view = { x: px, w: vw - px };
  const Ls = {}; for (const size of ['S', 'M', 'L']) Ls[size] = feedLayout({ vw, vh, n, top, size, view });
  const M = Ls.M, f = M.main / view.w;
  ok(f >= 0.22 && f <= 0.26, `${vw}x${vh} view ${view.w} M: the main card is 22 to 26 % of the view width`, f.toFixed(3));
  ok(Ls.S.main < M.main && M.main <= Ls.L.main, `${vw}x${vh}: S < M <= L`, `${Ls.S.main} ${M.main} ${Ls.L.main}`);
  for (const size of ['S', 'M', 'L']) for (const mm of [240, 300, 420]) {
    // the minimap: lower left, right of the panel, a legend under it
    const map = { x: px + 14, y: vh - 14 - mm - 40, w: mm + 12, h: mm + 40 };
    const L = feedLayout({ vw, vh, n, top, size, left: map.x + map.w + 12, view });
    const R = feedRects(L, { vw, vh, n });
    const bar = { x: px + view.w / 2 - 260, y: 56, w: 520, h: 44 };
    const all = [R.tools, ...R.cards], g = groupOf(R);
    const tag = `${vw}x${vh} view ${view.w} ${size} map ${mm}`;
    ok(g.w <= 0.34 * view.w + 1, `${tag}: the group is 34 % of the view width or less`, (g.w / view.w).toFixed(3));
    ok(g.x0 >= px + 0.66 * view.w - 1, `${tag}: the group stays in the right part of the view`, g.x0.toFixed(0));
    ok(R.tools.y >= top - 1, `${tag}: the stack fits under the readout`, `${R.tools.y.toFixed(0)} < ${top}`);
    ok(all.every(r => !hit(r, map)), `${tag}: no card overlaps the minimap`, JSON.stringify(R.cards[0]));
    ok(all.every(r => !hit(r, bar)), `${tag}: no card overlaps the camera bar`);
    ok(R.cards.every((a, i) => R.cards.every((b, j) => i === j || !hit(a, b))), `${tag}: no two cards overlap`);
    ok(R.cards.every(r => r.x >= 0 && r.x + r.w <= vw - 11 && r.y + r.h <= vh - 11), `${tag}: the cards stay in the window`);
  }
}
{
  // the screenshot: a 1520x897 window, the shell sidebar and the panel open, a 1060 px view
  const vw = 1520, vh = 897, view = { x: 460, w: 1060 }, n = 4, top = 180;
  const L = feedLayout({ vw, vh, n, top, size: 'M', view, left: 460 + 14 + 240 + 24 });
  const R = feedRects(L, { vw, vh, n }), g = groupOf(R);
  const area = [R.tools, ...R.cards].reduce((a, r) => a + r.w * r.h, 0) / (view.w * (vh - 70));
  ok(!L.one && L.thumb >= 80, 'screenshot view: the other cards stay as a column', JSON.stringify(L));
  ok(g.w / view.w <= 0.34, 'screenshot view: the group is 34 % of the view width or less', (g.w / view.w).toFixed(3));
  ok(area <= 0.2, 'screenshot view: the cards cover 20 % of the view area or less', area.toFixed(3));
  console.log(`  screenshot view M: main ${L.main} px, others ${L.thumb} px, group ${(g.w / view.w * 100).toFixed(1)} % of the width, ${(area * 100).toFixed(1)} % of the area`);
  // more panels open: an 800 px view collapses the other cards to tabs
  const N = feedLayout({ vw, vh, n, top, size: 'M', view: { x: 720, w: 800 } });
  ok(N.one && N.thumb === 0 && N.main <= 0.34 * 800, 'narrow 800 px view: the other cards collapse to tabs', JSON.stringify(N));
}
// portrait: the layout of 35272396, unchanged
for (const [vw, vh] of [[900, 1300], [1080, 1920], [800, 1100]]) for (const size of ['S', 'M', 'L']) {
  const a = feedLayout({ vw, vh, n: 4, top: 230, size, view: { x: 0, w: vw } }), b = oldLayout({ vw, vh, n: 4, top: 230, size });
  ok(a.main === b.main && a.thumb === b.thumb && !a.one, `portrait ${vw}x${vh} ${size}: the layout is unchanged`, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
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
