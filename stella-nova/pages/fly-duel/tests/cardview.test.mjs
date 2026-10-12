// ============================================================================
//  FLY DUEL  ·  tests for the one card renderer  (node tests/cardview.test.mjs)
// ----------------------------------------------------------------------------
//  ui/cardface.js drawCard() is the face of every card. ui/cardview.js puts
//  it on a DOM canvas, ui/board.js uses that for the table, the decks and
//  the gallery. No browser: a stub 2D context records the calls, and a
//  stub DOM gives cardEl() an element tree.
//
//  GREP MAP
//      grep -n 'DRAW'      drawCard for every card, size, state and mode
//      grep -n 'COLOUR'    colour keys, frames, glyph designs, contrast
//      grep -n 'THUMB'     what the thumbnail shows and what it leaves out
//      grep -n 'CARDEL'    cardEl() in a stub DOM
//      grep -n 'SHELL'     shellHTML / cardHTML text layer
//      grep -n 'GALLERY'   filterCards, renderGallery, renderDecks
//      grep -n 'CSS'       no clip-path frame left
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };

const CM = await import('../game/cards.js');
const cf = await import('../ui/cardface.js');
const cv = await import('../ui/cardview.js');
const board = await import('../ui/board.js');
const POOL = [...CM.CARDS, ...(CM.TOKENS || [])];

// A 2D context that accepts every call, records text and counts bad
// numbers. measureText scales with the font size, as a real one does.
function stubCtx() {
  const calls = { n: 0, bad: 0, text: [], images: 0 };
  const grad = { addColorStop(t) { if (!Number.isFinite(t) || t < 0 || t > 1) calls.bad++; } };
  const t = { calls, font: '10px serif' };
  return new Proxy(t, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === 'measureText') return s => ({ width: String(s).length * (parseFloat(/([\d.]+)px/.exec(o.font)?.[1]) || 10) * 0.52 });
      if (k === 'createLinearGradient') return (...a) => { calls.n++; if (a.some(x => !Number.isFinite(x))) calls.bad++; return grad; };
      if (k === 'fillText') return (s, ...a) => { calls.n++; calls.text.push(String(s)); if (a.some(x => !Number.isFinite(x))) calls.bad++; };
      if (k === 'drawImage') return (...a) => { calls.images++; if (a.slice(1).some(x => !Number.isFinite(x))) calls.bad++; };
      return (...a) => { calls.n++; if (a.some(x => typeof x === 'number' && !Number.isFinite(x))) calls.bad++; };
    },
    set(o, k, v) { o[k] = v; return true; },
  });
}

// --------------------------------------------------------------- DRAW
const SIZES = [[400, 560], [300, 420], [240, 336], [120, 168], [64, 90], [256, 256]];
const STATES = [{}, { tapped: true }, { sick: true }, { attacking: true }, { blocking: true }, { hot: true }, { dead: true }, { dim: true }, { damage: 2 }, { pp: 2, pt: 2 }, { tapped: true, damage: 1, attacking: true, pp: 1, pt: 1 }];
const fakeArt = { width: 480, height: 360 };
let err = 0, bad = 0, runs = 0;
const t0 = Date.now();
for (const [i, card] of POOL.entries()) {
  for (const [w, h] of SIZES) for (const mode of ['full', 'thumb', 'auto']) {
    // every state on a rotating subset, the plain face on every card
    const sts = i % 6 === 0 ? STATES : [STATES[0], STATES[(i + w) % STATES.length]];
    for (const st of sts) for (const dpr of [1, 2]) {
      const g = stubCtx();
      runs++;
      try { cf.drawCard(g, card, { w, h, state: st, mode, dpr, art: (i + w) % 2 ? fakeArt : null }); } catch (e) { err++; if (err < 4) console.error(card.id, w, mode, st, e); }
      if (g.calls.bad) bad++;
    }
  }
}
ok(err === 0, `drawCard does not throw for any card, size, state, mode and dpr (${err} errors in ${runs} runs)`);
ok(bad === 0, `drawCard passes only finite numbers (${bad} bad runs)`);
console.log(`  draw: ${runs} drawCard runs in ${Date.now() - t0} ms`);
{
  const g = stubCtx();
  cf.drawCard(g, null, { w: 120, h: 168, mode: 'thumb' });
  cf.drawCard(g, { id: 'zz-test', name: 'Zz', type: 'spell', colour: ['dew', 'rot'], cost: { generic: 2, dew: 1, rot: 1 } }, { w: 300, h: 420 });
  cf.drawCard(g, { id: 'zz-odd', name: 'Odd', type: 'creature', colour: 'brandnew', cost: { brandnew: 2 }, power: 1, toughness: 1 }, { w: 300, h: 420 });
  ok(g.calls.bad === 0, 'drawCard copes with null, an unknown card and an unknown colour key');
}

// --------------------------------------------------------------- COLOUR
const keys = cf.colourOrder();
const ids5 = CM.COLOUR_IDS || keys.slice(0, 5);
ok(ids5.every(k => keys.includes(k)), `colourOrder has every colour of game/cards.js (${keys.join(' ')})`);
const designs = ids5.map(k => cf.colourInfo(k).glyph);
ok(new Set(designs).size === ids5.length, `each colour has its own glyph design (${designs.join(' ')})`);
const rims = ids5.map(k => cf.frameOf(POOL.find(c => c.type !== 'land' && cf.cardColours(c).length === 1 && cf.cardColours(c)[0] === k) || { type: 'spell', colour: k, cost: {} }).F.rim0);
ok(new Set(rims).size === ids5.length, `each colour has its own rim (${rims.join(' ')})`);
{
  const multi = POOL.filter(c => c.type !== 'land' && cf.cardColours(c).length >= 2);
  const duals = POOL.filter(c => c.type === 'land' && cf.cardColours(c).length >= 2);
  if (multi.length) {
    ok(multi.every(c => cf.frameKind(c) === 'gold'), `multicolour cards get the gold frame (${multi.length})`);
    ok(multi.every(c => cf.frameOf(c).bars.length === cf.cardColours(c).length), 'gold bars blend each colour of the card');
  } else console.log('  colour: no multicolour card in the pool yet');
  if (duals.length) ok(duals.every(c => cf.frameKind(c) === 'land' && cf.frameOf(c).rims.length >= 2), `dual lands get a split rim (${duals.length})`);
  else console.log('  colour: no dual land in the pool yet');
  ok(POOL.filter(c => c.type === 'land').every(c => cf.frameKind(c) === 'land'), 'every land gets the land frame');
  const gold = { id: 'g', type: 'creature', colour: 'multi', colours: ['amber', 'moss'], cost: { generic: 1, amber: 1, moss: 1 } };
  ok(cf.frameKind(gold) === 'gold' && cf.cardColours(gold).join() === 'amber,moss', 'colours from a colours array, gold frame');
  ok(cf.cardColours({ type: 'spell', colour: 'dew/rot', cost: {} }).join() === 'dew,rot', 'colours from "dew/rot"');
  ok(cf.cardColours({ type: 'spell', cost: { generic: 1, pollen: 1 } }).join() === 'pollen', 'colours from the cost when no colour field');
  ok(cf.cardColours({ type: 'land', colour: 'multi', mana: ['moss', 'dew'], produces: 'moss' }).includes('moss'), 'a land takes its colours from what it makes');
  const cl = cf.costList({ generic: 2, rot: 1, amber: 1, moss: 0 });
  ok(cl[0][0] === 'generic' && cl[0][1] === 2 && cl.length === 3 && cl.indexOf(cl.find(x => x[0] === 'amber')) < cl.indexOf(cl.find(x => x[0] === 'rot')), 'cost glyphs: generic first, then colours in order');
}
// Legibility: ink on the bars and on the rules paper, WCAG contrast >= 7.
const lum = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); };
const contrast = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
for (const k of [...ids5, 'gold', 'land', 'none']) {
  const F = k === 'gold' || k === 'land' || k === 'none' ? cf.FRAME[k] : cf.frameOf({ type: 'spell', colour: k, cost: {} }).F;
  ok(contrast(F.ink, F.bar) >= 7, `${k}: name ink on the bar, contrast ${contrast(F.ink, F.bar).toFixed(1)}`);
  ok(contrast(F.paperInk, F.paper) >= 7, `${k}: rules ink on the paper, contrast ${contrast(F.paperInk, F.paper).toFixed(1)}`);
}
{
  const m = stubCtx();
  for (const k of [...ids5, 'generic']) cf.drawManaGlyph(m, k, 0, 0, 20, 3);
  ok(m.calls.bad === 0 && m.calls.text.includes('3'), 'every mana glyph draws, generic shows its number');
}

// --------------------------------------------------------------- THUMB
ok(cf.cardMode('auto', 240, 2) === 'thumb' && cf.cardMode('auto', 400, 2) === 'full' && cf.cardMode('auto', 179, 1) === 'thumb' && cf.cardMode(undefined, 50) === 'full', 'auto mode: thumbnail under 180 CSS px; default is full');
for (const card of POOL.filter((c, i) => i % 3 === 0)) {
  const full = stubCtx(), th = stubCtx();
  cf.drawCard(full, card, { w: 400, h: 560 });
  cf.drawCard(th, card, { w: 120, h: 168, mode: 'thumb' });
  const nameIn = g => g.calls.text.some(t => t === card.name || (t.endsWith('…') && card.name.startsWith(t.slice(0, -1).trim())));
  ok(full.calls.text.includes(card.name) && full.calls.text.includes(cf.typeLine(card)), `${card.id}: full face has the name and the type line`);
  ok(nameIn(th), `${card.id}: thumbnail has the name`);
  if (card.type === 'creature') ok(th.calls.text.includes(`${card.power}/${card.toughness}`) && full.calls.text.includes(`${card.power}/${card.toughness}`), `${card.id}: P/T on both faces`);
  const words = String(card.text || '').split(/\s+/).filter(w => w.length > 6);
  if (words.length) ok(!words.some(w => th.calls.text.includes(w)), `${card.id}: thumbnail leaves out the rules text`);
  ok(!th.calls.text.some(t => /^Art:/.test(t)), `${card.id}: thumbnail leaves out the credit`);
}

// --------------------------------------------------------------- CARDEL
// A stub DOM: enough of createElement, innerHTML (first element only),
// querySelector and getBoundingClientRect for cardEl() and hydrate().
const made = [];
class StubEl {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.attrs = {}; this.dataset = {}; this.style = {}; this.kids = []; this._html = ''; this.isConnected = true; this.width = 300; this.height = 150; this.className = ''; made.push(this); }
  get classList() { const el = this; return { add(c) { el.className += ' ' + c; }, remove() {}, contains: c => el.className.split(/\s+/).includes(c) }; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  set innerHTML(h) {
    this._html = h; this.kids = [];
    const m = /^<(\w+)([^>]*)>/.exec(h);
    if (!m) return;
    const el = new StubEl(m[1]);
    for (const [, k, v] of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) {
      const val = v.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
      el.attrs[k] = val;
      if (k === 'class') el.className = val;
      if (k.startsWith('data-')) el.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = val;
    }
    el._html = h;
    if (/<canvas/.test(h)) el.kids.push(new StubCanvas());
    this.kids.push(el);
  }
  get innerHTML() { return this._html; }
  get firstElementChild() { return this.kids[0] || null; }
  get firstChild() { return this.kids[0] || null; }
  removeChild(c) { this.kids = this.kids.filter(k => k !== c); return c; }
  appendChild(c) { this.kids.push(c); return c; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const out = [];
    const walk = n => { for (const k of n.kids) { if ((sel === 'canvas' && k.tagName === 'CANVAS') || (sel === '.cv' && /\bcv\b/.test(k.className))) out.push(k); walk(k); } };
    walk(this);
    return out;
  }
  getBoundingClientRect() { return { width: 150, height: 210, top: 10, bottom: 220, left: 10, right: 160 }; }
  addEventListener() {}
  closest() { return null; }
}
class StubCanvas extends StubEl {
  constructor() { super('canvas'); this.ctx = stubCtx(); }
  getContext() { return this.ctx; }
}
globalThis.document = { createElement: t => (t === 'canvas' ? new StubCanvas() : new StubEl(t)), addEventListener() {}, body: new StubEl('body'), documentElement: new StubEl('html'), head: new StubEl('head'), querySelector: () => null, querySelectorAll: () => [] };
globalThis.devicePixelRatio = 2;
globalThis.innerWidth = 390; globalThis.innerHeight = 844;
{
  let built = 0, drawn = 0, named = 0, sized = 0;
  const els = [];
  for (const card of POOL) {
    const el = cv.cardEl(card, { state: card.type === 'creature' ? { damage: 1 } : {} });
    if (el && /\bfcard\b/.test(el.className) && /\bcv\b/.test(el.className) && el.dataset.id === card.id) built++;
    els.push([card, el]);
  }
  await new Promise(r => setTimeout(r, 0));
  for (const [card, el] of els) {
    const c = el?.querySelector('canvas');
    if (!c) continue;
    if (c.ctx.calls.n > 50) drawn++;
    if (c.width === 300 && c.height === 420) sized++;
    if (c.ctx.calls.text.some(t => t === card.name || t.endsWith('…'))) named++;
  }
  ok(built === POOL.length, `cardEl builds a .fcard.cv element for every card (${built}/${POOL.length})`);
  ok(drawn === POOL.length, `cardEl draws every card on its canvas (${drawn}/${POOL.length})`);
  ok(sized === POOL.length, `the canvas is CSS width x devicePixelRatio, 5:7 (${sized}/${POOL.length})`);
  ok(named === POOL.length, `each canvas has the card name (${named}/${POOL.length})`);
  const root = new StubEl('div');
  root.innerHTML = board.cardHTML(CM.CARD['dew-moth'] || POOL[0], { mini: true, tapped: true });
  ok(cv.hydrate(root) === 1 && root.firstElementChild.querySelector('canvas').ctx.calls.n > 50, 'hydrate draws a shell set by innerHTML');
  ok(cv.hydrate(root) === 0, 'hydrate does not draw a shell twice');
}

// Lazy: a shell far below the view waits for the IntersectionObserver,
// even when the ResizeObserver reports its size first (it does so at
// once on observe in a browser).
{
  const ioSeen = [], roSeen = [];
  globalThis.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe(t) { ioSeen.push([this, t]); } unobserve() {} };
  globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; } observe(t) { roSeen.push(t); this.cb([{ target: t, contentRect: { width: 150 } }]); } unobserve() {} };
  const cvm = await import('../ui/cardview.js?lazy');
  const root = new StubEl('div');
  root.innerHTML = cvm.shellHTML(POOL[1], {});
  const el = root.firstElementChild;
  el.getBoundingClientRect = () => ({ width: 150, height: 210, top: 5000, bottom: 5210, left: 10, right: 160 });
  cvm.hydrate(root);
  const c = el.querySelector('canvas');
  ok(roSeen.length === 1 && ioSeen.length === 1 && c.ctx.calls.n === 0, `an off-screen shell is not drawn before it comes near the view (${c.ctx.calls.n} calls)`);
  ioSeen[0][0].cb([{ target: el, isIntersecting: true }]);
  ok(c.ctx.calls.n > 50, 'the shell draws when the IntersectionObserver reports it');
  delete globalThis.IntersectionObserver; delete globalThis.ResizeObserver;
}

// --------------------------------------------------------------- SHELL
{
  const all = POOL.map(c => board.cardHTML(c, { mini: c.type === 'creature', damage: 1, info: { pp: 1, pt: 1 } })).join('');
  ok(!/NaN|undefined|\[object/.test(all), 'card shells: no NaN, undefined or [object]');
  ok(POOL.every(c => all.includes(`data-id="${c.id}"`)), 'card shells: one data-id per card');
  ok((all.match(/<div class="cv-sr">/g) || []).length === POOL.length, 'card shells: a text layer per card');
  ok(/class="fx-dmg"/.test(all) && /\bpumped\b/.test(all), 'card shells: damage and pump in the text layer');
  const unk = board.cardHTML({ id: 'zz', name: 'Zz', colour: 'moss', type: 'spell', cost: { generic: 1 }, text: 'x' });
  ok(unk.includes('<svg class="art"'), 'an unknown card carries its procedural picture');
  ok(board.cardHTML(null).includes('unknown'), 'a null card gives an unknown shell');
}

// --------------------------------------------------------------- GALLERY
{
  const cards = CM.CARDS;
  for (const k of ids5) {
    const got = board.filterCards(cards, { colour: k });
    ok(got.length > 0 && got.every(c => c.type !== 'land' && cf.cardColours(c).includes(k)), `filter colour ${k}: ${got.length} cards, all of that colour`);
  }
  const multi = board.filterCards(cards, { colour: 'multi' });
  ok(multi.every(c => cf.cardColours(c).length >= 2 && c.type !== 'land'), `filter multicolour: ${multi.length} cards`);
  const lands = board.filterCards(cards, { colour: 'land' });
  ok(lands.length > 0 && lands.every(c => c.type === 'land'), `filter lands: ${lands.length}`);
  ok(board.filterCards(cards, { colour: 'none' }).every(c => c.type !== 'land' && cf.cardColours(c).length === 0), 'filter colourless');
  ok(board.filterCards(cards, { type: 'creature' }).every(c => c.type === 'creature'), 'filter creatures');
  ok(board.filterCards(cards, { cost: '5' }).every(c => cf.manaValueOf(c) >= 5) && board.filterCards(cards, { cost: '2' }).every(c => cf.manaValueOf(c) === 2), 'filter cost 2 and 5+');
  const one = cards.find(c => c.type === 'creature');
  ok(board.filterCards(cards, { q: one.name.toLowerCase() }).includes(one), 'search by name');
  ok(board.filterCards(cards, 'all').length === cards.length, 'the empty filter keeps every card');
  const groups = board.filterCards(cards).map(board.galleryGroup);
  ok(groups.lastIndexOf('land') === groups.length - 1 || !groups.includes('land'), 'lands sort last');
  const g = { innerHTML: '' };
  ok(board.renderGallery(g, cards, 'all') === cards.length && (g.innerHTML.match(/class="fcard fx cv /g) || []).length === cards.length, 'renderGallery writes one shell per card');
  const d = { innerHTML: '' };
  board.renderDecks(d, POOL, CM.DECKS);
  const nDecks = (CM.DECK_ORDER || Object.keys(CM.DECKS)).length;
  ok((d.innerHTML.match(/<details class="decklist/g) || []).length === nDecks, `renderDecks: one deck box per deck (${nDecks})`);
  ok((d.innerHTML.match(/\b40 cards, \d+ lands/g) || []).length === nDecks, 'renderDecks: every deck shows 40 cards and its lands');
  ok(!/NaN|undefined/.test(d.innerHTML + g.innerHTML), 'deck and gallery markup: no NaN or undefined');
}

// --------------------------------------------------------------- CSS
{
  const css = readFileSync(join(ROOT, 'ui/card.css'), 'utf8');
  ok(!/clip-path/.test(css), 'card.css: no clip-path (the house-shaped DOM frame is gone)');
  ok(!/\.fx-title|\.fx-cost|\.fx-landglyph|--grain/.test(css), 'card.css: no rules for the old DOM frame');
  ok(/aspect-ratio:\s*5\s*\/\s*7/.test(css), 'card.css: the card box is 5:7');
  // style.css sets .fcard{width:168px}; the deck fan has three columns
  // narrower than that, so its cards must override the width or they
  // spill over the next deck panel (user screenshot, 2026-10-12).
  ok(/\.cv-fan\s*>\s*\.fcard\.cv\s*\{[^}]*width:\s*auto/.test(css), 'card.css: deck-fan cards take their grid column width');
  ok(/\[hidden\]\{display:none!important\}/.test(css.replace(/\s+/g, '')), 'card.css: the inspector and preview obey [hidden]');
  ok(!/filter:\s*(saturate|blur|drop-shadow)|text-shadow|backdrop-filter/.test(css), 'card.css: no blur, glow or text shadow');
  for (const f of ['ui/board.js', 'ui/cardview.js']) ok(!/clip-path/.test(readFileSync(join(ROOT, f), 'utf8')), `${f}: no clip-path`);
  const ip = /magic|gathering|wizards|planeswalker|mana symbol|\bwotc\b|beleren|mplantin/i;
  for (const f of ['ui/cardface.js', 'ui/cardview.js', 'ui/card.css', 'ui/board.js']) ok(!ip.test(readFileSync(join(ROOT, f), 'utf8')), `${f}: no trademark or font names`);
}

console.log(`cardview: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
