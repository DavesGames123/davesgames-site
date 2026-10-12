// ============================================================================
//  FLY DUEL  ·  node tests for the way back to the seat in play mode
//  (node tests/play-seatback.test.mjs)
// ----------------------------------------------------------------------------
//  User (2026-10-12, verbatim): "its also very hard to get back to first
//  person perspective if you dont know what you're doing".
//
//    double tap  ui/play/orbit.js isDoubleTap and attachOrbit: away from
//                the seat, a double tap on empty table goes back to the
//                seat and its click picks nothing; a double tap on a card,
//                two slow taps, or a double tap at the seat do not
//    button      ui/play/play.js (linkedom): "Back to my seat" with an
//                icon shows only while away; the button, C and Home bring
//                the camera back; a double tap on the table does too
//    css         the button is bold with a bright edge, 44 px on touch
//    keys        no key or button of play mode selects all attackers
//  Exit code 1 on any failure.
// ============================================================================
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };

const { attachOrbit, isDoubleTap, DOUBLE } = await import('../ui/play/orbit.js');

// ------------------------------------------------------------ double tap
ok(isDoubleTap({ x: 10, y: 10, t: 0 }, { x: 14, y: 12, t: 200 }), 'two near taps in 200 ms: a double tap');
ok(!isDoubleTap({ x: 10, y: 10, t: 0 }, { x: 10, y: 10, t: DOUBLE.ms + 50 }), 'two slow taps: no double tap');
ok(!isDoubleTap({ x: 10, y: 10, t: 0 }, { x: 10 + DOUBLE.px + 5, y: 10, t: 100 }), 'two far taps: no double tap');
ok(!isDoubleTap(null, { x: 0, y: 0, t: 0 }), 'one tap: no double tap');

let clock = 1000;
globalThis.performance = { now: () => clock };
function fakeEl() {
  const ls = {};
  return { addEventListener(t, f) { (ls[t] ||= []).push(f); }, removeEventListener(t, f) { ls[t] = (ls[t] || []).filter(x => x !== f); }, fire(t, e) { for (const f of ls[t] || []) f({ pointerType: 'mouse', button: 0, pointerId: 1, preventDefault() {}, ...e }); } };
}
let cardAt = null;     // { x0, x1 } a card under these x, else empty table
const calls = { seat: 0 };
const fscene = {
  orbitBy: () => ({}), zoomBy: () => ({}), seatView() { calls.seat++; },
  pickPermanent: x => (cardAt && x >= cardAt.x0 && x <= cardAt.x1 ? { uid: 7, id: 'x', seat: 0 } : null),
};
const el = fakeEl();
const changes = [];
const g = attachOrbit(el, fscene, { onChange: v => changes.push(v) });
const tap = (x, y, dt = 60) => { el.fire('pointerdown', { clientX: x, clientY: y }); clock += dt; el.fire('pointerup', { clientX: x, clientY: y }); };
const drag = () => { el.fire('pointerdown', { clientX: 100, clientY: 100 }); for (let i = 1; i <= 8; i++) el.fire('pointermove', { clientX: 100 + i * 8, clientY: 100 }); el.fire('pointerup', { clientX: 164, clientY: 100 }); g.consumeDrag(); };

tap(200, 200); clock += 120; tap(202, 201);
ok(calls.seat === 0, 'at the seat a double tap does nothing');
g.consumeDrag();
drag();
ok(g.orbiting, 'a drag takes the camera away from the seat');
clock += 1000;
tap(300, 200); clock += 150; tap(303, 204);
ok(calls.seat === 1 && !g.orbiting && changes.at(-1) === false, 'away: a double tap on empty table goes back to the seat');
ok(g.consumeDrag() === true, 'the click of the second tap is eaten (it picks nothing)');
drag(); clock += 1000;
tap(300, 200); clock += DOUBLE.ms + 100; tap(300, 200);
ok(calls.seat === 1 && g.orbiting, 'two slow taps do not go back');
clock += 1000;
cardAt = { x0: 280, x1: 320 };
tap(300, 200); clock += 100; tap(300, 200);
ok(calls.seat === 1 && g.orbiting, 'a double tap on a card does not go back (the taps pick the card)');
cardAt = null;
g.dispose();

// ------------------------------------------------------------------ css
const css = readFileSync(join(ROOT, 'ui/play/play.css'), 'utf8');
const rule = css.match(/\n\.pl-seatbtn \{[^}]*\}/)?.[0] || '';
ok(/display: inline-flex/.test(rule) && /font-weight: 600/.test(rule) && /border: 2px solid var\(--ink\)/.test(rule), 'css: the button is bold with a bright edge and an icon row');
ok(/@media \(pointer: coarse\) \{ \.pl-seatbtn \{ min-height: 44px; \} \}/.test(css), 'css: 44 px on a touch screen');

// ----------------------------------------------------------------- keys
const src = readFileSync(join(ROOT, 'ui/play/play.js'), 'utf8');
ok(!/allAttack\(/.test(src), 'play.js: no key or button calls allAttack (no auto-select of attackers)');

// ------------------------------------------------------------ play DOM
let parseHTML = null;
for (const base of [join(ROOT, 'package.json'), '/usr/local/lib/node_modules/openclaw/package.json']) {
  try { ({ parseHTML } = createRequire(base)('linkedom')); break; } catch { /* next */ }
}
if (!parseHTML) console.log('  skip: DOM checks (linkedom is missing)');
else {
  const { window, document } = parseHTML('<!doctype html><html><body><main id="play"></main></body></html>');
  globalThis.window = window; globalThis.document = document;
  const rules = await import('../game/rules.js');
  const cards = await import('../game/cards.js');
  const { greedyBot } = await import('../game/bots.js');
  const { mountPlay } = await import('../ui/play/play.js');
  const fire = (target, type, props = {}) => { const e = new window.Event(type, { bubbles: true }); Object.assign(e, { pointerType: 'mouse', button: 0, pointerId: 1, ...props }); target.dispatchEvent(e); return e; };
  let seats = 0;
  const scene = { pickPermanent: () => null, setFirstPerson() {}, highlight() {}, setState() {}, setSpeed() {}, resize() {}, play: () => Promise.resolve(), orbitBy: () => ({}), zoomBy: () => ({}), seatView() { seats++; } };
  const root = document.getElementById('play');
  const P = mountPlay(root, { rules, cards, bots: { greedyBot }, flies: {}, connectomes: {}, seed: 4, scene, sceneEl: document.createElement('canvas') });
  fire(root.querySelector('.pl-go'), 'click');
  const table = root.querySelector('.pl-table');
  const btn = root.querySelector('.pl-seatbtn');
  const away = () => { fire(table, 'pointerdown', { clientX: 100, clientY: 100 }); for (let i = 1; i <= 8; i++) fire(table, 'pointermove', { clientX: 100 + i * 8, clientY: 100 }); fire(table, 'pointerup', { clientX: 164, clientY: 100 }); fire(table, 'click', { clientX: 164, clientY: 100 }); };
  ok(btn && btn.hidden === true, 'at the seat the button is hidden');
  ok(btn.querySelector('svg') && /Back to my seat/.test(btn.textContent) && /Back to my seat/.test(btn.getAttribute('aria-label')), 'the button has an icon and says "Back to my seat"');
  away();
  ok(btn.hidden === false, 'away from the seat the button shows');
  const s0 = seats;
  fire(btn, 'click');
  ok(seats === s0 + 1 && btn.hidden === true, 'the button brings the camera back and hides');
  for (const key of ['c', 'Home']) {
    away();
    const k0 = seats;
    const e = new window.Event('keydown', { bubbles: true }); Object.assign(e, { key }); document.dispatchEvent(e);
    ok(seats === k0 + 1 && btn.hidden === true, `the ${key} key brings the camera back`);
  }
  away(); clock += 1000;
  const d0 = seats;
  for (let i = 0; i < 2; i++) { fire(table, 'pointerdown', { clientX: 300, clientY: 200 }); clock += 60; fire(table, 'pointerup', { clientX: 300, clientY: 200 }); fire(table, 'click', { clientX: 300, clientY: 200 }); clock += 120; }
  ok(seats === d0 + 1 && btn.hidden === true, 'a double tap on empty table brings the camera back');
  P.destroy();
}

console.log(`play-seatback: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
