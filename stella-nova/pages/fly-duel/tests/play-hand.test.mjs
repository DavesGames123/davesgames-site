// ============================================================================
//  FLY DUEL  ·  play mode, the hand: no bounds, drag to play
//  (node tests/play-hand.test.mjs)
// ----------------------------------------------------------------------------
//  The user (verbatim, 2026-10-12): "i should be able to click and drag to
//  play cards from my hand. my hand should not be bounded."
//    fan       fanLayout at 390 x 760 (phone) and 1920 x 1080 (desktop)
//              for 1 to 24 cards: no scroll, every resting card in the
//              width, a hovered card fully in the view (handCardRect),
//              more cards overlap more
//    drag      dragStarts / dropVerdict: a move of more than DRAG.start
//              px in any direction is a drag; only a release above the
//              drop line plays, a release below it or a cancel returns
//    dom       ui/play/hand.js (linkedom): a drag up past the line plays,
//              a drag that ends below the line returns the card and plays
//              nothing, a sideways drag is a drag (no scroll), the drop
//              line shows while a card is dragged and arms above it, a
//              tap selects and a second tap plays
//    css       play.css: the hand box does not scroll or clip, the cards
//              take every touch move (touch-action: none), the hovered
//              card rises by --lift
//  Exit code 1 on any failure.
// ============================================================================
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.VERBOSE) console.log('ok  ', m); } else { fail++; console.error('FAIL', m); } };

const LAY = await import('../ui/play/layout.js');
const { layoutFor, fanLayout } = LAY;

// --- fan ---------------------------------------------------------------------------------------
{
  ok(typeof LAY.handCardRect === 'function' && typeof LAY.dropVerdict === 'function' && LAY.DRAG && LAY.HAND, 'layout.js exports HAND, handCardRect, DRAG, dropVerdict');
  for (const [vw, vh, coarse] of [[390, 760, true], [1920, 1080, false], [844, 390, true]]) {
    const L = layoutFor(vw, vh, { coarse });
    let prevStep = Infinity, bad = '';
    for (let n = 1; n <= 24; n++) {
      const f = fanLayout(n, { width: vw, cardW: L.hand.w, cardH: L.hand.h, peek: L.hand.peek });
      if (f.scroll) bad ||= `${n} cards scroll`;
      if (n > 1 && f.step > prevStep + 1e-9) bad ||= `${n} cards: the step grows (${f.step} > ${prevStep})`;
      if (n > 1) prevStep = f.step;
      for (let i = 0; i < n && LAY.handCardRect; i++) {
        const r = LAY.handCardRect(L, f, i, { vh });
        if (r.left < 0 || r.right > vw) bad ||= `${n} cards: card ${i} rests outside the width (${r.left}..${r.right})`;
        const h = LAY.handCardRect(L, f, i, { vh, hover: true });
        if (h.left < 0 || h.right > vw || h.top < 0 || h.bottom > vh) bad ||= `${n} cards: hovered card ${i} leaves the view (${Math.round(h.left)},${Math.round(h.top)} .. ${Math.round(h.right)},${Math.round(h.bottom)})`;
      }
    }
    ok(!bad, `fan ${vw} x ${vh}: no scroll, no clip, a hovered card fully in view, the step never grows (${bad || 'ok'})`);
    const r7 = LAY.handCardRect ? LAY.handCardRect(L, fanLayout(7, { width: vw, cardW: L.hand.w, cardH: L.hand.h, peek: L.hand.peek }), 3, { vh }) : { bottom: 0 };
    ok(r7.bottom > vh, `fan ${vw} x ${vh}: a resting card goes past the bottom edge (it peeks), bottom ${Math.round(r7.bottom)}`);
  }
  const f12 = fanLayout(12, { width: 390, cardW: 98 });
  ok(!f12.scroll && f12.cards[11].x + 98 <= 390, `twelve cards on a phone fit the width (right edge ${f12.cards[11].x + 98})`);
  const few = fanLayout(3, { width: 1920, cardW: 150 }), many = fanLayout(14, { width: 1920, cardW: 150 });
  ok(many.cards[13].x - many.cards[0].x > few.cards[2].x - few.cards[0].x, 'more cards fan wider');
}

// --- drag rules --------------------------------------------------------------------------------
if (LAY.DRAG) {
  const { DRAG, dragStarts, dropLine, dropVerdict } = LAY;
  ok(!dragStarts(0, -DRAG.start) && dragStarts(0, -DRAG.start - 1), `a move of more than ${DRAG.start} px up is a drag`);
  ok(dragStarts(DRAG.start + 1, 0), 'a sideways move is a drag too (the fan does not scroll)');
  ok(!dragStarts(5, 5), 'a small jitter is not a drag');
  const line = dropLine(700);
  ok(line === 700 - DRAG.pad, 'the drop line is DRAG.pad px above the hand box');
  ok(dropVerdict('pointerup', line - 1, line) === 'play', 'a release above the line plays');
  ok(dropVerdict('pointerup', line + 1, line) === 'return', 'a release below the line returns the card');
  ok(dropVerdict('pointercancel', line - 200, line) === 'return', 'a cancel returns the card');
}

// --- DOM ---------------------------------------------------------------------------------------
let parseHTML = null;
for (const base of [join(ROOT, 'package.json'), '/usr/local/lib/node_modules/openclaw/package.json']) {
  try { ({ parseHTML } = createRequire(base)('linkedom')); break; } catch { /* next */ }
}
if (!parseHTML) console.log('  skip: DOM checks (linkedom is missing)');
else {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  globalThis.window = window; globalThis.document = document;
  const { CARD } = await import('../game/cards.js');
  const ids = Object.keys(CARD).slice(0, 9);
  const { createHand } = await import('../ui/play/hand.js');
  const pev = (el, type, o = {}) => { const e = new window.Event(type, { bubbles: true, cancelable: true }); Object.assign(e, { clientX: 0, clientY: 0, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', detail: 1 }, o); el.dispatchEvent(e); return e; };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const log = [];
  const H = createHand(host, { onSelect: i => log.push(['select', i]), onPlay: i => log.push(['play', i]), onInspect: () => {}, onHover: () => {}, onHold: () => {}, onHoldEnd: () => {} });
  host.getBoundingClientRect = () => ({ top: 700, bottom: 900, left: 0, right: 390 });
  Object.defineProperty(host, 'clientWidth', { value: 390 });
  const realCreate = document.createElement.bind(document);
  document.createElement = tag => { const el = realCreate(tag); if (tag === 'canvas') el.getContext = () => null; return el; };
  const L = layoutFor(390, 760, { coarse: true });
  const view = (sel = null) => ({ hand: ids.map(() => ({ playable: true })), selected: sel, mode: 'main' });
  H.render(ids, view(), L, CARD);
  const els = [...host.querySelectorAll('.pl-hc')];
  ok(els.length === 9 && !host.classList.contains('is-scroll'), 'dom: nine cards, the hand box does not scroll');
  ok(els.every(e => /^-?\d/.test(e.style.getPropertyValue('--x'))) && /px$/.test(host.style.getPropertyValue('--lift') || H.el.style.getPropertyValue('--lift')), 'dom: each card has its --x and the fan sets --lift');
  const dl = host.querySelector('.pl-dropline');
  ok(!!dl && dl.hidden, 'dom: the drop line is there and hidden at rest');
  // drag up past the line: play
  pev(els[2], 'pointerdown', { clientX: 100, clientY: 800 });
  pev(els[2], 'pointermove', { clientX: 104, clientY: 760 });
  ok(els[2].classList.contains('is-drag') && host.classList.contains('is-dragging') && H.dragging, 'dom: a move up starts the drag');
  ok(dl && !dl.hidden, 'dom: the drop line shows while a card is dragged');
  pev(els[2], 'pointermove', { clientX: 110, clientY: 600 });
  ok(els[2].classList.contains('is-armed') && dl?.classList.contains('is-armed'), 'dom: above the line the card and the line arm');
  pev(els[2], 'pointerup', { clientX: 110, clientY: 600 });
  ok(log.length === 1 && log[0][0] === 'play' && log[0][1] === 2, `dom: a release above the line plays the card (${JSON.stringify(log)})`);
  ok(!els[2].classList.contains('is-drag') && !host.classList.contains('is-dragging') && dl?.hidden, 'dom: after the drop the drag marks go');
  // drag that ends below the line: return
  log.length = 0;
  pev(els[4], 'pointerdown', { clientX: 200, clientY: 800, pointerId: 2 });
  pev(els[4], 'pointermove', { clientX: 200, clientY: 600, pointerId: 2 });
  pev(els[4], 'pointermove', { clientX: 210, clientY: 760, pointerId: 2 });
  ok(!els[4].classList.contains('is-armed'), 'dom: back below the line the card disarms');
  pev(els[4], 'pointerup', { clientX: 210, clientY: 760, pointerId: 2 });
  ok(log.length === 0 && !els[4].classList.contains('is-drag'), `dom: a release below the line returns the card, no play, no select (${JSON.stringify(log)})`);
  // a sideways drag is a drag, not a scroll and not a tap
  pev(els[5], 'pointerdown', { clientX: 200, clientY: 800, pointerId: 3, pointerType: 'touch' });
  pev(els[5], 'pointermove', { clientX: 240, clientY: 800, pointerId: 3, pointerType: 'touch' });
  ok(els[5].classList.contains('is-drag'), 'dom: a sideways touch move drags the card');
  pev(els[5], 'pointercancel', { clientX: 240, clientY: 800, pointerId: 3, pointerType: 'touch' });
  ok(log.length === 0 && !els[5].classList.contains('is-drag'), 'dom: a cancel returns the card');
  // click to play stays: tap selects, the second tap plays
  pev(els[1], 'pointerdown', { clientX: 50, clientY: 800, pointerId: 4 });
  pev(els[1], 'pointerup', { clientX: 50, clientY: 800, pointerId: 4 });
  H.render(ids, view(1), L, CARD);
  pev(els[1], 'pointerdown', { clientX: 50, clientY: 800, pointerId: 5 });
  pev(els[1], 'pointerup', { clientX: 50, clientY: 800, pointerId: 5 });
  ok(JSON.stringify(log) === JSON.stringify([['select', 1], ['play', 1]]), `dom: tap selects, a second tap plays (${JSON.stringify(log)})`);
  document.createElement = realCreate;
  host.remove();
}

// --- css ---------------------------------------------------------------------------------------
{
  const css = readFileSync(join(ROOT, 'ui/play/play.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = sel => { const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}')); return m ? m[1] : ''; };
  const hb = rule('.pl-handbox');
  ok(hb && !/overflow-x:\s*auto/.test(hb) && /overflow: visible/.test(hb), 'css: the hand box does not scroll and does not clip (overflow: visible)');
  ok(/touch-action: none/.test(rule('.pl-hc')), 'css: a hand card takes every touch move (touch-action: none), so a drag in any direction works');
  ok(/\.pl-hc\.is-peek:not\(\.is-drag\) \{ transform: translate\(var\(--x\), calc\(0px - var\(--lift\)\)\) rotate\(0deg\) scale\(1\.16\)/.test(css), 'css: a held card rises by --lift and grows by 1.16 (HAND.hoverScale)');
  ok(/\.pl-dropline \{/.test(css) && /\.pl-dropline\.is-armed \{/.test(css), 'css: the drop line and its armed look');
}

console.log(`play-hand: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
