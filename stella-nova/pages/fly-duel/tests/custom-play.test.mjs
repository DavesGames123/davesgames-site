// ============================================================================
//  FLY DUEL  ·  play with your own deck  (node tests/custom-play.test.mjs)
// ----------------------------------------------------------------------------
//  The user (verbatim, 2026-10-12): "we should be able to play with a
//  custom deck against a fly". This file boots the real index.html and
//  main.js on linkedom (no browser: the user does not allow headless
//  Chrome) and checks that a deck of the deck builder gets to the game.
//  Each case runs in its own node process (main.js boots once per
//  process), selected by FD_CUSTOM:
//    pick   a saved deck in localStorage. The title screen opens, the
//           test taps Play, the deck in "Your decks", and Start (the
//           onStart of ui/chooser/chooser.js). Play mode opens, and the
//           game of the play controller deals your seat the custom list.
//    url    ?mode=play&mydeck=<code>&opp=A opens play mode at once with
//           the deck of the code, and the URL keeps the code.
//    bad    ?mode=play&mydeck=<bad code> opens the title screen on play.
//  Skipped, with a message, when linkedom is not found.
//
//  GREP MAP   (grep -n "^// ---" tests/custom-play.test.mjs)
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CASE = process.env.FD_CUSTOM || '';

// --------------------------------------------------------------- parent: one process per case
if (!CASE) {
  let bad = 0;
  for (const c of ['pick', 'url', 'bad']) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { stdio: 'inherit', env: { ...process.env, FD_CUSTOM: c } });
    if (r.status !== 0) bad++;
  }
  process.exit(bad ? 1 : 0);
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log(`  FAIL ${m}`); } };

// --------------------------------------------------------------- linkedom
let linkedom = null;
for (const spec of ['linkedom', '/usr/local/lib/node_modules/openclaw/node_modules/linkedom/esm/index.js']) {
  try { linkedom = await import(spec); break; } catch { /* try the next one */ }
}
if (!linkedom) { console.log('custom-play.test: skipped (linkedom not found)'); process.exit(0); }

// --------------------------------------------------------------- the deck and the URL
const C = await import(pathToFileURL(join(ROOT, 'game/cards.js')).href);
const DS = await import(pathToFileURL(join(ROOT, 'ui/deckbuilder/deckstore.js')).href);
const LIST = DS.sortList(C.DECKS['amber-pollen'].list.map(r => r.slice()));
const mem = new Map();
const localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
if (CASE === 'pick') DS.saveDecks([{ id: 'bee1', name: 'Bee Line', list: LIST, updated: 1 }], localStorage);
const CODE = DS.encodeDeck({ list: LIST, name: 'Shared Bees' });
const SEARCH = CASE === 'url' ? `?mode=play&mydeck=${encodeURIComponent(CODE)}&opp=A`
  : CASE === 'bad' ? '?mode=play&mydeck=not-a-deck-code' : '';

// --------------------------------------------------------------- globals (as tests/boot.test.mjs)
const html = readFileSync(join(ROOT, 'index.html'), 'utf8').replace(/<script[^>]*\ssrc=[^>]*><\/script>/g, '');
const W = linkedom.parseHTML(html);
const { document } = W;
const errors = [];
const oe = console.error, ow = console.warn;
console.error = (...a) => errors.push(a.map(x => x && x.stack || String(x)).join(' '));
console.warn = (...a) => errors.push('warn: ' + a.map(x => x && x.stack || String(x)).join(' '));
const stub = () => {
  const store = {};
  return new Proxy(function () {}, {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => 0;
      if (p === 'then') return undefined;
      if (p in store) return store[p];
      if (p === 'width' || p === 'height' || p === 'length') return 0;
      return stub();
    },
    set(t, p, v) { store[p] = v; return true; },
    apply() { return stub(); },
  });
};
const proto = W.HTMLElement.prototype;
proto.getBoundingClientRect = () => ({ width: 360, height: 260, top: 1000, left: 0, right: 360, bottom: 1260 });
proto.setPointerCapture = () => {}; proto.scrollTo = () => {}; proto.scrollIntoView = () => {};
(W.HTMLCanvasElement || W.HTMLElement).prototype.getContext = function () { return this.__g ||= stub(); };
class Img { set src(v) { this._s = v; setTimeout(() => this.onload?.(), 0); } get src() { return this._s; } decode() { return Promise.resolve(); } }
const { createTrainer } = await import(pathToFileURL(join(ROOT, 'train/worker.js')).href);
class FakeWorker {
  constructor(url) { this.url = String(url); this.t = createTrainer(m => setTimeout(() => this.onmessage?.({ data: structuredClone(m) }), 0)); }
  postMessage(m) { const c = structuredClone(m); setTimeout(() => this.t.handle(c), 0); }
  terminate() {}
}
const frames = [], winL = {}, urls = [];
const realST = globalThis.setTimeout;
globalThis.setTimeout = (f, ms, ...a) => realST(f, Math.min(ms || 0, 1), ...a);
Object.assign(globalThis, {
  location: { search: SEARCH, hash: '' },
  history: { replaceState: (a, b, u) => urls.push(String(u)) },
  window: globalThis, document, Node: W.Node, HTMLElement: W.HTMLElement, Event: W.Event, localStorage,
  innerWidth: 390, innerHeight: 800, devicePixelRatio: 2, Image: Img, Worker: FakeWorker,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  IntersectionObserver: class { constructor(cb) { this.cb = cb; } observe(t) { this.cb([{ target: t, isIntersecting: true }]); } unobserve() {} disconnect() {} },
  ResizeObserver: class { observe() {} disconnect() {} },
  requestAnimationFrame: f => frames.push(f), cancelAnimationFrame() {},
  addEventListener: (t, f) => (winL[t] ||= []).push(f), removeEventListener() {},
  dispatchEvent: e => { (winL[e.type] || []).forEach(f => f(e)); return true; },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  fetch: async p => {
    const f = join(ROOT, String(p).replace(/^\.\//, ''));
    if (!existsSync(f)) return { ok: false, status: 404 };
    const txt = readFileSync(f, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(txt), text: async () => txt };
  },
});
Object.defineProperty(document, 'hidden', { value: false, configurable: true });

// --------------------------------------------------------------- boot
let bootErr = null;
try { await import(pathToFileURL(join(ROOT, 'main.js')).href); } catch (e) { bootErr = e; }
ok(!bootErr, `${CASE}: main.js imports (${bootErr && bootErr.message})`);
const fd = globalThis.flyDuel;
await fd?.ready;
const wait = ms => new Promise(r => realST(r, ms));
await wait(50);
let T = 0;
for (let i = 0; i < 50; i++) { const fs = frames.splice(0); T += 50; for (const f of fs) f(T); }
const $ = id => document.getElementById(id);
const click = el => { el?.dispatchEvent(new W.Event('click', { bubbles: true })); return !!el; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const waitPlay = async () => { for (let i = 0; i < 300 && !fd.app.play; i++) await wait(10); };

// The game of the play controller deals the custom list to your seat.
function checkGame(name) {
  const root = $('playRoot'), q = s => root.querySelector(s);
  const pc = fd.app.play?.controller;
  ok(fd.app.mode === 'play' && !!fd.app.play && root.hidden === false, `${CASE}: play mode opens (mode ${fd.app.mode})`);
  ok(/Call the coin/.test(q('.pl-sheet')?.textContent || ''), `${CASE}: the setup sheet took the custom deck tile, the coin is next (${(q('.pl-sheet h2')?.textContent || '').slice(0, 40)})`);
  const mine = pc?.decks?.[pc.humanSeat];
  ok(Array.isArray(mine) && same(mine, LIST), `${CASE}: the controller gives your seat the custom list (${Array.isArray(mine) ? `${mine.length} rows` : mine})`);
  ok(same(pc?.state?.decks?.[pc.humanSeat], LIST), `${CASE}: the game state of your seat has the custom list`);
  const fly = pc?.decks?.[1 - pc.humanSeat];
  ok(typeof fly === 'string' && !!C.DECKS[fly], `${CASE}: the fly plays a preset deck (${fly})`);
  const lib = pc?.state?.players?.[pc.humanSeat] || { hand: [], library: [] };
  ok(lib.hand.length + lib.library.length === LIST.reduce((s, [, n]) => s + n, 0), `${CASE}: your hand and library hold the 40 cards of the custom list`);
  ok(fd.app.custom?.name === name && fd.app.myDeck === fd.app.custom.id, `${CASE}: the app keeps the custom deck (${fd.app.custom?.name}, ${fd.app.myDeck})`);
  ok(urls.at(-1)?.startsWith('?mode=play&mydeck='), `${CASE}: the URL keeps the deck code (${urls.at(-1)})`);
}

// --------------------------------------------------------------- pick: the title screen
if (CASE === 'pick') {
  const ch = $('chooser'), cq = s => ch.querySelector(s);
  ok(ch.hidden === false, 'pick: no mode in the URL opens the title screen');
  click(cq('.fdc-mode[data-mode="play"]'));
  ok(click(cq('.fdc-ctile[data-cdeck="my-bee1"]')), 'pick: the saved deck shows in Your decks');
  ok(/^Play Bee Line/.test(cq('.fdc-go-l')?.textContent || ''), `pick: the Start label names the deck (${cq('.fdc-go-l')?.textContent})`);
  click(cq('.fdc-go'));
  await waitPlay();
  await wait(20);
  checkGame('Bee Line');
}

// --------------------------------------------------------------- url: ?mode=play&mydeck=<code>
if (CASE === 'url') {
  await waitPlay();
  await wait(20);
  checkGame('Shared Bees');
  ok(fd.app.play.controller.humanSeat === 1, `url: opp=A from the URL puts you in seat 1 (${fd.app.play.controller.humanSeat})`);
  ok(urls.at(-1) === `?mode=play&mydeck=${encodeURIComponent(CODE).replace(/%20/g, '+')}&opp=A`, `url: the URL is the same code and opponent (${urls.at(-1)})`);
}

// --------------------------------------------------------------- bad: a code that does not decode
if (CASE === 'bad') {
  await wait(50);
  ok(fd.app.mode === 'watch' && !fd.app.play && fd.app.custom === null, `bad: a bad code does not start play (mode ${fd.app.mode})`);
  ok($('chooser').hidden === false && fd.app.sheet, 'bad: a bad code opens the title screen');
  ok(!!$('chooser').querySelector('.fdc-mode[data-mode="play"][aria-checked="true"]') || /^Play /.test($('chooser').querySelector('.fdc-go-l')?.textContent || ''), `bad: the title screen is on play (${$('chooser').querySelector('.fdc-go-l')?.textContent})`);
}

console.error = oe; console.warn = ow;
globalThis.setTimeout = realST;
ok(errors.length === 0, `${CASE}: no console.error or console.warn (${errors.length}): ${errors.slice(0, 3).join(' | ').slice(0, 600)}`);
console.log(`custom-play.test (${CASE}): ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
