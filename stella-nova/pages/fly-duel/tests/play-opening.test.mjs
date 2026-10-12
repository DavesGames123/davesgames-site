// ============================================================================
//  FLY DUEL  ·  play mode, the opening hand is drawn card by card
//  (node tests/play-opening.test.mjs)
// ----------------------------------------------------------------------------
//  The user (verbatim, 2026-10-12): "show mny opening hand as me actually
//  drawing cards, the mulligan row is bad interface design. i want to see
//  each card getting drawn then choose".
//    timeline  openingTimeline: one card at a time, the choice after the
//              last card lands; reduced motion: no flight, still one by one
//    seq       createOpeningSeq: no Keep or Mulligan during the draw; the
//              last card opens the choice; a mulligan goes through the
//              shuffle to a new draw; skip shows the rest at once
//    layout    openingLayout at 390 x 760, 1920 x 1080 and 844 x 390 for
//              4 to 7 cards: every card, the library and the choice bar
//              in the view, the bar under the cards
//    dom       mountOpening (linkedom, a manual clock): the cards come in
//              one at a time, the bar shows only after the last one, a
//              mulligan shuffles back and draws one card less, Keep calls
//              onKeep once and the overlay goes
//    play      mountPlay: after the coin the overlay draws the hand (no
//              mulligan sheet row), and Keep starts the game
//  Exit code 1 on any failure.
// ============================================================================
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.VERBOSE) console.log('ok  ', m); } else { fail++; console.error('FAIL', m); } };

let O = null;
try { O = await import('../ui/play/opening.js'); } catch (e) { ok(false, `ui/play/opening.js loads (${e.message.split('\n')[0]})`); }

if (O) {
  const { OPENING, openingTimeline, createOpeningSeq, openingLayout, mountOpening } = O;
  // --- timeline
  {
    const t = openingTimeline(7);
    ok(t.draws.length === 7 && t.draws.every((d, i) => i === 0 || d.at - t.draws[i - 1].at >= OPENING.gap), 'timeline: seven draws, one at a time');
    ok(t.draws[0].at >= OPENING.lead && t.choose >= t.draws[6].at + OPENING.fly, 'timeline: the choice comes after the last card lands');
    const r = openingTimeline(7, { reduced: true });
    ok(r.draws.every(d => d.dur === 0) && r.draws[6].at > r.draws[0].at, 'timeline: reduced motion has no flight, the cards still come one by one');
  }
  // --- state machine
  {
    const s = createOpeningSeq();
    ok(s.phase === 'idle' && !s.keep() && !s.mulligan(), 'seq: idle has no choice');
    s.deal(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    ok(s.phase === 'draw' && s.drawn === 0, 'seq: deal starts the draw with no card in view');
    ok(!s.keep() && !s.mulligan() && s.phase === 'draw', 'seq: no Keep and no Mulligan during the draw');
    for (let i = 0; i < 6; i++) s.step();
    ok(s.phase === 'draw' && s.shown.length === 6, 'seq: six of seven cards: still drawing');
    s.step();
    ok(s.phase === 'choose' && s.shown.length === 7, 'seq: the seventh card opens the choice');
    ok(!s.step(), 'seq: no draw past the hand');
    ok(s.mulligan() && s.phase === 'shuffle' && s.drawn === 0, 'seq: a mulligan shuffles the hand back');
    ok(!s.keep(), 'seq: no Keep during the shuffle');
    ok(s.deal(['a', 'b', 'c', 'd', 'e', 'f']) && s.phase === 'draw' && s.deals === 2, 'seq: the new hand is drawn again');
    ok(s.skip() && s.phase === 'choose' && s.shown.length === 6, 'seq: skip shows the rest at once');
    ok(s.keep() && s.phase === 'kept' && !s.deal(['x']) && !s.mulligan(), 'seq: keep ends it');
  }
  // --- layout
  {
    let bad = '';
    for (const [vw, vh] of [[390, 760], [1920, 1080], [844, 390], [320, 568]]) {
      for (let n = 4; n <= 7; n++) {
        const L = openingLayout(n, vw, vh);
        for (const c of L.cards) if (c.x < 0 || c.y < 0 || c.x + L.w > vw || c.y + L.h > vh) bad ||= `${vw}x${vh} n${n}: a card leaves the view`;
        if (L.bar.y < L.cards[0].y + L.h) bad ||= `${vw}x${vh} n${n}: the bar covers the cards`;
        if (L.bar.y + L.bar.h > vh) bad ||= `${vw}x${vh} n${n}: the bar leaves the view (${L.bar.y} + ${L.bar.h} > ${vh})`;
        if (L.deck.x < 0 || L.deck.y < 0 || L.deck.y + L.deck.h > vh) bad ||= `${vw}x${vh} n${n}: the library leaves the view`;
      }
    }
    ok(!bad, `layout: cards, library and bar in the view (${bad || 'ok'})`);
    ok(openingLayout(7, 1920, 1080).w >= 160 && openingLayout(7, 390, 760).w >= 60, `layout: large cards (${openingLayout(7, 1920, 1080).w} px at 1920, ${openingLayout(7, 390, 760).w} px at 390)`);
  }

  // --- DOM
  let parseHTML = null;
  for (const base of [join(ROOT, 'package.json'), '/usr/local/lib/node_modules/openclaw/package.json']) {
    try { ({ parseHTML } = createRequire(base)('linkedom')); break; } catch { /* next */ }
  }
  if (!parseHTML) console.log('  skip: DOM checks (linkedom is missing)');
  else {
    const { window, document } = parseHTML('<!doctype html><html><body><main id="r"></main><main id="play"></main></body></html>');
    globalThis.window = window; globalThis.document = document;
    // a manual clock
    let now = 0, q = [], seqId = 0;
    const wait = (f, ms) => { const id = ++seqId; q.push({ id, at: now + ms, f }); return id; };
    const unwait = id => { q = q.filter(x => x.id !== id); };
    const tick = ms => { const end = now + ms; for (;;) { q.sort((a, b) => a.at - b.at || a.id - b.id); const x = q[0]; if (!x || x.at > end) break; q.shift(); now = x.at; x.f(); } now = end; };
    const root = document.getElementById('r');
    let hand = ['h0', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'], kept = 0, mulls = 0;
    const V = mountOpening(root, {
      ids: hand, view: () => [390, 760], wait, unwait,
      info: () => ({ n: hand.length, lands: 2, mulls, canMull: mulls < 3, flyLine: 'Fly B keeps its hand.', library: 40 - hand.length }),
      onKeep: () => kept++,
      onMulligan: () => { mulls++; hand = hand.slice(0, hand.length - 1); return hand; },
    });
    const cardsIn = () => root.querySelectorAll('.pl-oh').length;
    const bar = () => root.querySelector('.pl-open-bar');
    ok(!!root.querySelector('.pl-open') && cardsIn() === 0 && bar().hidden, 'dom: the overlay opens with no card drawn and no choice');
    tick(OPENING.lead + 1);
    ok(cardsIn() === 1, `dom: the first card comes off the library (${cardsIn()})`);
    const counts = [];
    for (let i = 1; i < 7; i++) { tick(OPENING.gap); counts.push(cardsIn()); if (!bar().hidden) break; }
    ok(JSON.stringify(counts) === '[2,3,4,5,6,7]', `dom: one card at a time (${counts})`);
    ok(bar().hidden, 'dom: no choice while the last card flies');
    tick(OPENING.fly + OPENING.settle + 40);
    ok(!bar().hidden && /Keep 7/.test(root.querySelector('[data-keep]').textContent) && /Mulligan to 6/.test(root.querySelector('[data-mull]').textContent), 'dom: then Keep 7 / Mulligan to 6 show');
    root.querySelector('[data-mull]').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(V.seq.phase === 'shuffle' && bar().hidden && root.querySelector('.pl-open-deck').classList.contains('is-shuffle'), 'dom: a mulligan hides the choice and shuffles the library');
    tick(OPENING.shuffle + 1);
    ok(mulls === 1 && V.seq.phase === 'draw' && cardsIn() === 0, 'dom: after the shuffle the new hand is drawn from nothing');
    tick(OPENING.lead + 1);
    ok(cardsIn() === 1, 'dom: the new hand comes one card at a time');
    tick(openingTimeline(6).choose + 100);
    ok(cardsIn() === 6 && !bar().hidden && /Keep 6/.test(root.querySelector('[data-keep]').textContent), 'dom: six cards, then Keep 6');
    root.querySelector('[data-keep]').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(kept === 1 && V.seq.phase === 'kept', 'dom: Keep calls onKeep once');
    tick(OPENING.down + 100);
    ok(!root.querySelector('.pl-open'), 'dom: the overlay goes after the cards go down');

    // --- play: mountPlay uses the overlay
    {
      const realST = globalThis.setTimeout;
      globalThis.setTimeout = f => realST(f, 0);
      const rules = await import('../game/rules.js');
      const cards = await import('../game/cards.js');
      const bots = await import('../game/bots.js');
      const { mountPlay } = await import('../ui/play/play.js');
      const proot = document.getElementById('play');
      const ev = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
      const P = mountPlay(proot, { rules, cards, bots, flies: {}, connectomes: {}, seed: 7 });
      const pq = s => proot.querySelector(s);
      ev(pq('.pl-seg[data-k="opp"] button[data-v="bot"]'), 'click');
      ev(pq('.pl-go'), 'click');
      ev(pq('[data-call="heads"]'), 'click');
      ev(pq('.pl-go'), 'click');
      ok(!!pq('.pl-open') && !pq('.pl-openhand'), 'play: after the coin the opening hand is drawn in the overlay, not a sheet row');
      ok(pq('.pl-sheet').hidden, 'play: the sheet is closed while the hand is drawn');
      ok(P.controller.phase === 'mulligan', 'play: the game waits for the choice');
      await new Promise(r => realST(r, 20));
      ok(!pq('.pl-open-bar').hidden && pq('.pl-open').querySelectorAll('.pl-oh').length === P.controller.state.players[P.controller.humanSeat].hand.length, 'play: every card of the hand is drawn, then the choice shows');
      ev(pq('[data-mull]'), 'click');
      await new Promise(r => realST(r, 20));
      ok(P.controller.mulligans[P.controller.humanSeat] === 1 && pq('.pl-open').querySelectorAll('.pl-oh').length === 6, 'play: Mulligan draws six cards');
      ev(pq('[data-keep]'), 'click');
      await new Promise(r => realST(r, 20));
      ok(P.controller.phase === 'play' && !pq('.pl-open'), 'play: Keep starts the game and the overlay goes');
      P.destroy();
      globalThis.setTimeout = realST;
    }
  }
}

// --- css
{
  const css = readFileSync(join(ROOT, 'ui/play/play.css'), 'utf8');
  ok(/\.pl-open \{/.test(css) && /\.pl-oh \{[^}]*transition: transform/.test(css), 'css: the overlay and the card flight (transition on transform)');
  ok(/\.pl-open-deck\.is-shuffle/.test(css), 'css: the library shuffle');
}

console.log(`play-opening: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
