// ============================================================================
//  FLY DUEL  ·  the hovered version of a card in play mode
//  (node tests/peek.test.mjs)
// ----------------------------------------------------------------------------
//  The user (verbatim, 2026-10-12): "hovering cards in the game section
//  should pull the image up in their hovered version".
//    size      peekSize keeps 5:7 inside the view
//    place     peekPlace: a hand card gets its copy above it; a table
//              card beside the pointer; in 3000 random cases the copy
//              stays in the view and never covers the anchor (the card
//              or the point under the pointer)
//    peek      createPeek (linkedom): schedule waits PEEK.delay ms (120),
//              then shows the card id with a full drawCard and its
//              picture; a move from card to card does not wait again;
//              hide() stops a wait; id null (a hidden card) never shows
//    hand      ui/play/hand.js: a mouse hover gives onHover(id, el) and
//              onHover(null) on leave; a touch hold gives onHold, the
//              card lifts (.is-peek), the release gives onHoldEnd and no
//              select or play; a drag up before the hold plays the card
//              with no hold; a touch contextmenu does not open the
//              inspector, a mouse one does
//    play      mountPlay with a stub 3D scene (pickFace): a mouse hover
//              on a face-up table card shows its copy after the delay, a
//              hidden card (id null) shows none, leaving hides it; a
//              touch hold on the table shows it, the release hides it and
//              makes no move; a hover on a hand card shows it above
//    css       play.css: the hovered hand card rises and grows in place
//              (:hover and .is-peek), the copy takes no pointer events
//  Exit code 1 on any failure.
// ============================================================================
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.VERBOSE) console.log('ok  ', m); } else { fail++; console.error('FAIL', m); } };

const { PEEK, peekSize, peekPlace, createPeek } = await import('../ui/play/peek.js');
const cards = await import('../game/cards.js');
const { CARD } = cards;
const ids = Object.keys(CARD);

// --- size --------------------------------------------------------------------------------
for (const [w, h] of [[1920, 1080], [390, 844], [844, 390], [360, 740], [1180, 820]]) {
  const s = peekSize(w, h);
  ok(Math.abs(s.h / s.w - 1.4) < 0.02 && s.w <= w * PEEK.w + 1 && s.h <= h * PEEK.h + 1 && s.h <= PEEK.maxH, `size ${w}x${h}: ${s.w}x${s.h}, 5:7, inside the view`);
}

// --- place (pure) ----------------------------------------------------------------------------
const overlap = (p, a) => p.x < a.right && p.x + p.w > a.left && p.y < a.bottom && p.y + p.h > a.top;
const inside = (p, vw, vh) => p.x >= PEEK.margin - 0.5 && p.y >= PEEK.margin - 0.5 && p.x + p.w <= vw - PEEK.margin + 0.5 && p.y + p.h <= vh - PEEK.margin + 0.5;
{
  const hand = { left: 150, top: 690, right: 247, bottom: 826 };
  const p = peekPlace(hand, peekSize(390, 844), [390, 844], 'above');
  ok(p.at === 'above' && !overlap(p, hand) && inside(p, 390, 844), `place: a phone hand card gets its copy above it (${p.at} ${p.x | 0},${p.y | 0} ${p.w}x${p.h})`);
  const desk = { left: 900, top: 900, right: 1046, bottom: 1104 };
  const q = peekPlace(desk, peekSize(1920, 1200), [1920, 1200], 'above');
  ok(q.at === 'above' && !overlap(q, desk) && Math.abs(q.x + q.w / 2 - 973) < 2, `place: a desktop hand card gets its copy above it, centred (${q.x | 0},${q.y | 0})`);
  const ptr = { left: 944, top: 524, right: 976, bottom: 556 };
  const r = peekPlace(ptr, peekSize(1920, 1080), [1920, 1080], 'side');
  ok(r.at === 'right' && !overlap(r, ptr), `place: a table card in the middle gets its copy at the right of the pointer (${r.at})`);
  const edge = { left: 1800, top: 524, right: 1832, bottom: 556 };
  const e = peekPlace(edge, peekSize(1920, 1080), [1920, 1080], 'side');
  ok(e.at === 'left' && !overlap(e, edge) && inside(e, 1920, 1080), `place: near the right edge it goes to the left (${e.at})`);
  const phone = { left: 180, top: 400, right: 212, bottom: 432 };
  const f = peekPlace(phone, peekSize(390, 844), [390, 844], 'side');
  ok(!overlap(f, phone) && inside(f, 390, 844) && f.w >= PEEK.minW, `place: on a phone a table card copy goes to the ${f.at} side of the finger, ${f.w}x${f.h}, not on it`);
}
{
  let bad = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 3000; i++) {
    const vw = 320 + Math.round(rnd() * 1700), vh = 320 + Math.round(rnd() * 1000);
    const prefer = rnd() < 0.5 ? 'above' : 'side';
    const aw = prefer === 'above' ? 60 + rnd() * 120 : 32, ah = prefer === 'above' ? aw * 1.4 : 32;
    const ax = rnd() * (vw - aw), ay = prefer === 'above' ? vh - ah * (0.5 + rnd() * 0.6) : rnd() * (vh - ah);
    const a = { left: ax, top: Math.max(0, ay), right: ax + aw, bottom: Math.min(vh, ay + ah) };
    const p = peekPlace(a, peekSize(vw, vh), [vw, vh], prefer);
    if (overlap(p, a) || !inside(p, vw, vh)) bad.push(`${vw}x${vh} ${prefer} anchor ${[a.left, a.top, a.right, a.bottom].map(v => v | 0)} -> ${p.at} ${[p.x, p.y, p.w, p.h].map(v => v | 0)}`);
  }
  ok(bad.length === 0, `place: 3000 random anchors: the copy stays in the view and off the anchor${bad.length ? ` (${bad.length} bad: ${bad.slice(0, 2).join('; ')})` : ''}`);
}

// --- DOM (linkedom) ----------------------------------------------------------------------------
let parseHTML = null;
for (const base of [join(ROOT, 'package.json'), '/usr/local/lib/node_modules/openclaw/package.json']) {
  try { ({ parseHTML } = createRequire(base)('linkedom')); break; } catch { /* next */ }
}
if (!parseHTML) console.log('  skip: DOM checks (linkedom is missing)');
else {
  const { window, document } = parseHTML('<!doctype html><html><body><div id="h"></div><main id="play"></main></body></html>');
  globalThis.window = window; globalThis.document = document;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const pev = (el, type, o = {}) => { const e = new window.Event(type, { bubbles: true, cancelable: true }); Object.assign(e, { clientX: 0, clientY: 0, button: 0, buttons: 0, pointerId: 1, pointerType: 'mouse', detail: 1 }, o); el.dispatchEvent(e); return e; };

  // --- peek
  {
    const drawn = [], arts = [];
    const CF = {
      drawCard: (g, card, o) => drawn.push([card.id, o.mode, o.w, o.h]),
      paintWithArt: (t, id, draw) => { arts.push(id); draw(null); },
    };
    const host = document.getElementById('h');
    const P = createPeek(host, { CARD, CF, KEYWORDS: cards.KEYWORDS || {}, view: () => [1280, 800] });
    // linkedom has no canvas: a 2D context stub
    P.el.querySelector('canvas').getContext = () => ({ setTransform() {}, clearRect() {} });
    const anchor = { left: 600, top: 380, right: 632, bottom: 412 };
    P.schedule(ids[0], anchor, 'side');
    ok(P.el.hidden && P.waiting(), 'peek: schedule does not show at once');
    await wait(PEEK.delay / 2);
    ok(P.el.hidden, `peek: hidden at ${PEEK.delay / 2} ms`);
    await wait(PEEK.delay);
    ok(!P.el.hidden && P.id() === ids[0] && P.el.dataset.id === ids[0], `peek: shows the card after ${PEEK.delay} ms`);
    ok(drawn.some(d => d[0] === ids[0] && d[1] === 'full') && arts.includes(ids[0]), 'peek: a full drawCard with the picture (paintWithArt)');
    const x0 = P.el.style.left;
    P.move({ left: 900, top: 380, right: 932, bottom: 412 });
    ok(P.el.style.left !== x0, `peek: it follows the hover (left ${x0} -> ${P.el.style.left})`);
    P.schedule(ids[1], anchor, 'side');
    ok(!P.el.hidden && P.id() === ids[1], 'peek: from card to card it changes at once');
    P.hide();
    ok(P.el.hidden && P.id() === null, 'peek: hide');
    P.schedule(ids[2], anchor, 'side'); P.hide();
    await wait(PEEK.delay + 40);
    ok(P.el.hidden, 'peek: a leave before the delay stops the wait');
    P.schedule(null, anchor); P.show(null, anchor);
    await wait(PEEK.delay + 40);
    ok(P.el.hidden, 'peek: a hidden card (id null) never shows');
    P.show('no-such-card', anchor);
    ok(P.el.hidden, 'peek: an unknown id does not show');
    P.dispose();
  }

  // --- hand
  {
    const { createHand, HOLD_MS } = await import('../ui/play/hand.js');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const log = [];
    const H = createHand(host, {
      onSelect: i => log.push(['select', i]), onPlay: i => log.push(['play', i]), onInspect: id => log.push(['inspect', id]),
      onHover: (id, el) => log.push(['hover', id, !!el]), onHold: (id, el) => log.push(['hold', id, !!el]), onHoldEnd: () => log.push(['holdEnd']),
    });
    const hand = ids.slice(0, 4);
    const L = { w: 1280, hand: { w: 120, h: 168 } };
    host.getBoundingClientRect = () => ({ top: 700, bottom: 900, left: 0, right: 1280 });
    // the canvas painter needs a context
    const realCreate = document.createElement.bind(document);
    document.createElement = tag => { const el = realCreate(tag); if (tag === 'canvas') el.getContext = () => null; return el; };
    H.render(hand, { hand: hand.map(() => ({ playable: true })), selected: null, mode: 'main' }, L, CARD);
    document.createElement = realCreate;
    const cardsEl = [...host.querySelectorAll('.pl-hc')];
    pev(cardsEl[1], 'pointerenter');
    pev(cardsEl[1], 'pointerleave');
    ok(JSON.stringify(log.slice(0, 2)) === JSON.stringify([['hover', hand[1], true], ['hover', null, true]]), `hand: a mouse hover gives onHover(id, el), the leave onHover(null) (${JSON.stringify(log.slice(0, 2))})`);
    log.length = 0;
    pev(cardsEl[2], 'pointerenter', { pointerType: 'touch' });
    ok(log.length === 0, 'hand: a touch enter is not a hover');
    pev(cardsEl[2], 'pointerdown', { pointerType: 'touch', clientX: 100, clientY: 800 });
    await wait(HOLD_MS + 60);
    ok(log.some(l => l[0] === 'hold' && l[1] === hand[2]) && cardsEl[2].classList.contains('is-peek'), `hand: a touch hold gives onHold and the card lifts (.is-peek) (${JSON.stringify(log)})`);
    pev(cardsEl[2], 'contextmenu', { pointerType: 'touch' });
    ok(!log.some(l => l[0] === 'inspect'), 'hand: the contextmenu of a touch hold does not open the inspector');
    pev(cardsEl[2], 'pointerup', { pointerType: 'touch', clientX: 100, clientY: 800 });
    ok(log.some(l => l[0] === 'holdEnd') && !cardsEl[2].classList.contains('is-peek') && !log.some(l => l[0] === 'select' || l[0] === 'play'), `hand: the release gives onHoldEnd, no select, no play (${JSON.stringify(log)})`);
    log.length = 0;
    pev(cardsEl[0], 'pointerdown', { pointerType: 'touch', clientX: 100, clientY: 800, pointerId: 2 });
    pev(cardsEl[0], 'pointermove', { pointerType: 'touch', clientX: 100, clientY: 740, pointerId: 2 });
    pev(cardsEl[0], 'pointermove', { pointerType: 'touch', clientX: 100, clientY: 600, pointerId: 2 });
    await wait(HOLD_MS + 60);
    pev(cardsEl[0], 'pointerup', { pointerType: 'touch', clientX: 100, clientY: 600, pointerId: 2 });
    ok(!log.some(l => l[0] === 'hold') && log.some(l => l[0] === 'play' && l[1] === 0), `hand: a drag up before the hold plays the card, no hold (${JSON.stringify(log)})`);
    log.length = 0;
    pev(cardsEl[3], 'pointerdown', { pointerType: 'mouse', button: 2 });
    pev(cardsEl[3], 'contextmenu', { pointerType: 'mouse', button: 2 });
    ok(log.some(l => l[0] === 'inspect' && l[1] === hand[3]), 'hand: a mouse right-click opens the inspector');
    host.remove();
  }

  // --- play (mountPlay with a stub 3D scene)
  {
    const { mountPlay } = await import('../ui/play/play.js');
    const { greedyBot } = await import('../game/bots.js');
    const rules = await import('../game/rules.js');
    let face = null, moves = 0;
    const scene = {
      pickPermanent: () => null, pickFace: () => face, setFirstPerson() {}, highlight() {}, setState() {}, setSpeed() {}, resize() {},
      play: () => { moves++; return Promise.resolve(); }, orbitBy: () => ({}), zoomBy: () => ({}), seatView() {},
    };
    const root = document.getElementById('play');
    const P = mountPlay(root, { rules, cards, bots: { greedyBot }, flies: {}, connectomes: {}, seed: 4, scene, sceneEl: document.createElement('canvas') });
    const q = s => root.querySelector(s);
    pev(q('.pl-go'), 'click');
    pev(q('[data-call="heads"]'), 'click');
    await wait(5);
    pev(q('.pl-go'), 'click');
    q('[data-keep]') && pev(q('[data-keep]'), 'click');
    await wait(20);
    const pk = q('.pl-peek'), table = q('.pl-table');
    ok(!!pk && pk.hidden && !q('.pl-zoom'), 'play: one hovered-version element, hidden; the old .pl-zoom is gone');
    face = { id: ids[5], zone: 'perm', seat: 0, uid: 3 };
    pev(table, 'pointermove', { clientX: 500, clientY: 300 });
    await wait(40);
    ok(pk.hidden, 'play: a table hover waits (40 ms)');
    await wait(PEEK.delay + 60);
    ok(!pk.hidden && pk.dataset.id === ids[5], `play: a mouse hover on a face-up table card shows its copy after the delay (${pk.dataset.id})`);
    face = { id: null, zone: 'hand', seat: 1, uid: null };
    pev(table, 'pointermove', { clientX: 520, clientY: 300 });
    await wait(40);
    ok(pk.hidden, 'play: a hidden card (id null) shows no copy');
    face = { id: ids[6], zone: 'perm', seat: 1, uid: 4 };
    pev(table, 'pointermove', { clientX: 540, clientY: 300 });
    await wait(PEEK.delay + 60);
    pev(table, 'pointerleave');
    ok(pk.hidden, 'play: leaving the table hides the copy');
    const n0 = P.controller.history.length;
    face = { id: ids[7], zone: 'perm', seat: 1, uid: 4 };
    pev(table, 'pointerdown', { pointerType: 'touch', clientX: 300, clientY: 300, pointerId: 5 });
    await wait(PEEK.holdMs + 60);
    ok(!pk.hidden && pk.dataset.id === ids[7], 'play: a touch hold on a table card shows its copy');
    pev(table, 'pointerup', { pointerType: 'touch', clientX: 300, clientY: 300, pointerId: 5 });
    pev(table, 'click', { pointerType: 'touch', clientX: 300, clientY: 300 });
    ok(pk.hidden && P.controller.history.length === n0 && q('.pl-insp').hidden, 'play: the release hides it, and the hold makes no move and opens no inspector');
    // a touch move before the hold is an orbit: no copy
    pev(table, 'pointerdown', { pointerType: 'touch', clientX: 300, clientY: 300, pointerId: 6 });
    pev(table, 'pointermove', { pointerType: 'touch', clientX: 340, clientY: 300, pointerId: 6, buttons: 1 });
    await wait(PEEK.holdMs + 60);
    pev(table, 'pointerup', { pointerType: 'touch', clientX: 340, clientY: 300, pointerId: 6 });
    ok(pk.hidden, 'play: a touch drag (orbit) shows no copy');
    const hc = [...root.querySelectorAll('.pl-hc')].filter(e => !e.hidden);
    if (hc.length) {
      const hid = P.controller.state.players[P.controller.humanSeat].hand[0];
      pev(hc[0], 'pointerenter');
      await wait(PEEK.delay + 60);
      ok(!pk.hidden && pk.dataset.id === hid, `play: a mouse hover on your hand card shows its copy (${pk.dataset.id})`);
      pev(hc[0], 'pointerleave');
      ok(pk.hidden, 'play: leaving the hand card hides it');
    } else ok(false, 'play: the hand has cards');
    P.destroy();
    ok(!root.querySelector('.pl-peek'), 'play: destroy removes the copy');
  }
}

// --- css -------------------------------------------------------------------------------------
{
  const css = readFileSync(join(ROOT, 'ui/play/play.css'), 'utf8');
  ok(/\.pl-hc\.is-peek:not\(\.is-drag\) \{ transform: translate\(var\(--x\), calc\(0px - var\(--lift\)\)\) rotate\(0deg\) scale\(1\.16\)/.test(css), 'css: a held hand card rises and grows in place (.is-peek)');
  ok(/@media \(hover: hover\) and \(pointer: fine\) \{\s*\.pl-hc:hover:not\(\.is-drag\) \{[^}]*scale\(1\.16\)/.test(css), 'css: a hovered hand card rises and grows in place (fine pointer only)');
  ok(/\.pl-peek \{[^}]*pointer-events: none/.test(css), 'css: the copy takes no pointer events');
  ok(/\.pl-hc \{ -webkit-touch-callout: none; \}/.test(css), 'css: no iOS callout on a held hand card');
}

console.log(`peek: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
