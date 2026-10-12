// ============================================================================
//  FLY DUEL  ·  the title screen: mode and deck chooser  (DOM module)
// ----------------------------------------------------------------------------
//  The chooser is a layer over the 3D table. The page keeps the table
//  alive behind it, and a flat veil dims the table. The layer has three
//  parts:
//    title    the title lockup, one line of lede, and the honesty line
//    modes    two mode cards with a picture on a canvas:
//               watch  two model flies face each other at the table
//               play   your hand of cards, first person, and the fly
//    decks    two seats side by side and one deck picker:
//               watch  seat 0 = deck of Fly A, seat 1 = deck of Fly B
//               play   seat 0 = your deck, seat 1 = the opponent (Fly A,
//                      Fly B or the greedy bot) and its deck
//             A deck tile shows a fan of the three key cards of the deck
//             (drawCard of ui/cardface.js), the colour glyphs, the full
//             name, the description and the measured win rate of each
//             fly with the deck against the greedy bot.
//  The start button says what will happen ("Play Pollen Hive vs Fly B ·
//  Wildfire Compost").
//
//  Layout. Desktop (900 px and wider): title and modes on the left,
//  seats and deck grid on the right, all on one screen. Phone: a step
//  flow (data-step="mode" -> "decks"), a swipe carousel of deck tiles,
//  and a start bar at the bottom. No control needs hover.
//
//  Keys. Arrow keys move the focus in the mode cards, the seats and the
//  deck grid (the grid moves by the screen position of each tile).
//  Enter or Space picks. W and P pick the mode. Escape goes back one
//  step on a phone, or closes a closable chooser.
//
//  Custom decks (play mode, your seat). A "Your decks" strip shows the
//  decks of the deck builder (ui/deckbuilder/, localStorage
//  "fly-duel.decks.v1") as tiles with their key cards, and a "Build a
//  new deck" tile. Build and Edit open the builder over the chooser (a
//  child .fdc-builder; deckbuilder.js loads on first use). "Play this
//  deck vs a fly" in the builder starts the game at once. A deck that
//  is not legal yet opens in the builder instead of being picked. The
//  start choice then has humanDeck 'my-<id>' and customDeck (deckstore
//  customDeckOf: { id, name, colours, list, code, ... }). opts.initial
//  .myCode (a ?mydeck= share code) saves that deck and picks it.
//
//  Memory. The last start is kept in localStorage ("fly-duel.chooser.v1"),
//  in try/catch. Values in opts.initial win over the memory.
//
//  The module has no DOM work at import time. The pure helpers are
//  exported for tests/chooser.test.mjs.
//
//  GREP MAP
//      grep -n 'export function keyCardsOf'   the top n key cards of a deck
//      grep -n 'export function deckStat'     measured rates of one deck
//      grep -n 'export function deckBlurb'    description without colour words
//      grep -n 'export function filterDecks'  colour and mono/mixed filter
//      grep -n 'export function startLabel'   the label of the start button
//      grep -n 'export function normalise'    a choice with known deck ids
//      grep -n 'function customHTML'          the Your decks strip
//      grep -n 'function openBuilder'         the deck builder over the layer
//      grep -n 'export function loadChoice'   localStorage -> a choice
//      grep -n 'export function saveChoice'   a choice -> localStorage
//      grep -n 'export function drawFan'      three cards in a fan
//      grep -n 'export const MODE_ART'        the watch and play captures
//      grep -n 'export function mountChooser' the layer, events, sync
//      grep -n 'function sync'                state -> DOM
//      grep -n 'function onKey'               arrow, Enter, Escape keys
// ============================================================================
import { drawCard, cardBack, getCardArt, paintWithArt, manaValueOf, colourInfo, drawManaGlyph } from '../cardface.js';
import { loadDecks, saveDecks, upsertDeck, customDeckOf, customFromCode } from '../deckbuilder/deckstore.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const STORE_KEY = 'fly-duel.chooser.v1';
const FLY_HEX = ['#39d0f0', '#f26ad6'];
const OPP = [
  { v: 'A', label: 'Fly A', src: 'hemibrain' },
  { v: 'B', label: 'Fly B', src: 'FlyWire' },
  { v: 'bot', label: 'Greedy bot', src: 'no brain' },
];

// ------------------------------------------------------------ pure helpers
// The top n key cards of a deck: non-land cards by mana value, a
// creature before a spell on a tie, then the most copies. The first
// card is the keyCardOf() card of main.js.
export function keyCardsOf(deck, CARD, n = 3) {
  const rows = [];
  for (const [id, k] of deck?.list || []) {
    const c = CARD?.[id];
    if (!c || c.type === 'land') continue;
    rows.push({ c, key: [manaValueOf(c), c.type === 'creature' ? 1 : 0, k] });
  }
  rows.sort((a, b) => b.key[0] - a.key[0] || b.key[1] - a.key[1] || b.key[2] - a.key[2]);
  return rows.slice(0, n).map(r => r.c);
}

// Measured rates of one deck against the greedy bot, from
// data/training-curve.json meta.final.perDeck. null when not measured.
export function deckStat(curve, id) {
  let f = curve?.meta?.final;
  if (typeof f === 'string') { try { f = JSON.parse(f); } catch { f = null; } }
  const d = f?.perDeck?.[id];
  if (!d?.A || !d?.B) return null;
  return { a: d.A.rate, b: d.B.rate, n: Math.min(d.A.n | 0, d.B.n | 0), greedy: d.greedy?.rate ?? null };
}

// The description of a deck without a first sentence that only names
// its colours ("Amber and dew."): the glyphs show the colours.
export function deckBlurb(deck, colours = {}) {
  const t = String(deck?.desc || '').trim();
  const names = new Set(Object.values(colours).map(c => String(c?.name || '').toLowerCase()).filter(Boolean));
  const m = t.match(/^([^.]*)\.\s+(.*)$/s);
  if (!m) return t;
  const words = m[1].toLowerCase().split(/[\s,]+/).filter(w => w && w !== 'and');
  return words.length && words.every(w => names.has(w)) ? m[2] : t;
}

// Deck ids that pass the filter. cols: colour keys that a deck must all
// have. kind: 'all' | 'mono' | 'mixed'.
export function filterDecks(ids, decks, { cols = [], kind = 'all' } = {}) {
  const want = [...cols];
  return ids.filter(id => {
    const c = decks?.[id]?.colours || [];
    if (kind === 'mono' && c.length !== 1) return false;
    if (kind === 'mixed' && c.length < 2) return false;
    return want.every(k => c.includes(k));
  });
}

const nameOf = (decks, id) => (id && id !== 'random' && decks?.[id]?.name) || 'a random deck';
const oppName = v => (v === 'bot' ? 'the greedy bot' : `Fly ${v}`);

// The label of the start button.
export function startLabel(ch, decks) {
  if (ch.mode === 'play') return `Play ${nameOf(decks, ch.humanDeck)} vs ${oppName(ch.opponent)} · ${nameOf(decks, ch.flyDeck)}`;
  return `Watch Fly A · ${nameOf(decks, ch.deckA)} vs Fly B · ${nameOf(decks, ch.deckB)}`;
}

// A full choice with known deck ids ('random' for an unknown id).
// customIds: ids of custom decks, allowed for your deck only.
export function normalise(ch = {}, ids = [], customIds = []) {
  const known = v => (v && ids.includes(v) ? v : 'random');
  return {
    mode: ch.mode === 'play' ? 'play' : 'watch',
    deckA: known(ch.deckA), deckB: known(ch.deckB),
    humanDeck: ch.humanDeck && customIds.includes(ch.humanDeck) ? ch.humanDeck : known(ch.humanDeck), flyDeck: known(ch.flyDeck),
    opponent: ['A', 'B', 'bot'].includes(ch.opponent) ? ch.opponent : 'B',
  };
}

function store() { try { return globalThis.localStorage || null; } catch { return null; } }

export function loadChoice(st = store()) {
  try { const j = JSON.parse(st?.getItem(STORE_KEY) || 'null'); return j && typeof j === 'object' ? j : null; } catch { return null; }
}
export function saveChoice(ch, st = store()) {
  try { st?.setItem(STORE_KEY, JSON.stringify(ch)); return true; } catch { return false; }
}

// ------------------------------------------------------------ drawing
// Canvas size from its CSS box. Returns [g, W, H, dpr] in device px, or
// null when there is no 2D context (node).
function prep(cv, fw, fh) {
  if (!cv || typeof cv.getContext !== 'function') return null;
  const r = typeof cv.getBoundingClientRect === 'function' ? cv.getBoundingClientRect() : null;
  const w = Math.round(r?.width || 0) || fw, h = Math.round(r?.height || 0) || fh;
  const dpr = Math.min(2, Math.max(1, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1));
  const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
  if (cv.width !== W) cv.width = W;
  if (cv.height !== H) cv.height = H;
  let g = null;
  try { g = cv.getContext('2d'); } catch { g = null; }
  if (!g || typeof g.setTransform !== 'function') return null;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  return [g, W, H, dpr];
}

// Three cards in a fan, the key card on top in the middle. cards: card
// definitions (an empty list draws three card backs). Device px.
export function drawFan(g, W, H, cards, dpr = 1) {
  const ch = H * 0.88, cw = ch * 5 / 7;
  const px = W / 2, py = H + ch * 0.95;
  const dx = Math.min(cw * 0.3, (W - cw) * 0.3);
  const list = cards.length ? cards.slice(0, 3) : [null, null, null];
  const order = list.length === 3 ? [1, 2, 0] : list.map((_, i) => i).reverse();
  const ang = list.length === 3 ? [0, -0.17, 0.17] : list.length === 2 ? [-0.09, 0.09] : [0];
  for (const i of order) {
    g.save();
    g.translate(px, py);
    g.rotate(ang[i] || 0);
    const side = list.length === 3 ? [0, -1, 1][i] : list.length === 2 ? [-0.5, 0.5][i] : 0;
    const x = -cw / 2 + side * dx, y = -py + (H - ch) * 0.5 - (i === 0 ? H * 0.02 : 0);
    if (list[i]) drawCard(g, list[i], { x, y, w: cw, h: ch, mode: 'thumb', dpr, art: getCardArt(list[i].id, { small: true }) });
    else cardBack(g, { x, y, w: cw, h: ch });
    g.restore();
  }
}

// Screen captures of the real page (art/modes/, made from a headless
// Chrome run of ?mode=watch and ?mode=play, then cropped to 2:1). The URL
// is relative to this module, so ui/chooser/dev.html finds them too.
export const MODE_ART = {
  watch: new URL('../../art/modes/watch.jpg', import.meta.url).href,
  play: new URL('../../art/modes/play.jpg', import.meta.url).href,
};

// ------------------------------------------------------------ the layer
const PIP = (k, s = 16) => `<canvas class="fdc-glyph" data-k="${esc(k)}" width="${s}" height="${s}" style="width:${s}px;height:${s}px" aria-hidden="true"></canvas>`;

function tileHTML(id, D) {
  if (id === 'random') {
    return `<button type="button" class="fdc-tile" data-deck="random" aria-pressed="false">`
      + `<span class="fdc-fanbox"><canvas class="fdc-fan" aria-hidden="true"></canvas></span>`
      + `<span class="fdc-tb"><b class="fdc-name">Random</b><span class="fdc-desc">A different deck each game. Neither you nor the fly chooses it.</span>`
      + `<span class="fdc-stat">Any of the ${D.ids.length} decks</span></span>`
      + `<span class="fdc-marks" aria-hidden="true"></span></button>`;
  }
  const d = D.decks[id];
  const cols = d?.colours || [];
  const st = deckStat(D.curve, id);
  const pct = v => `${Math.round(v * 100)}%`;
  const stat = st
    ? `<span class="fdc-stat"><span class="fdc-r a">Fly A ${pct(st.a)}</span><span class="fdc-r b">Fly B ${pct(st.b)}</span><small>won vs greedy bot · measured, ${st.n} games each</small></span>`
    : '<span class="fdc-stat"><small>not measured against the greedy bot</small></span>';
  return `<button type="button" class="fdc-tile" data-deck="${esc(id)}" data-cols="${esc(cols.join(' '))}" aria-pressed="false">`
    + `<span class="fdc-fanbox"><canvas class="fdc-fan" aria-hidden="true"></canvas></span>`
    + `<span class="fdc-tb"><span class="fdc-pips" role="img" aria-label="${esc(cols.map(k => colourInfo(k).name).join(' and '))}">${cols.map(k => PIP(k, 15)).join('')}</span>`
    + `<b class="fdc-name">${esc(d?.name || id)}</b><span class="fdc-desc">${esc(deckBlurb(d, D.colours))}</span>${stat}</span>`
    + `<span class="fdc-marks" aria-hidden="true"></span></button>`;
}

// The Your decks strip: one tile per custom deck, then Build.
function customHTML(customs, ch) {
  const tiles = Object.values(customs).map(d => {
    const cols = d.colours || [];
    return `<button type="button" class="fdc-ctile" data-cdeck="${esc(d.id)}" aria-pressed="${ch.humanDeck === d.id}">`
      + `<span class="fdc-fanbox"><canvas class="fdc-fan" aria-hidden="true"></canvas></span>`
      + `<span class="fdc-tb"><span class="fdc-pips" role="img" aria-label="${esc(cols.map(k => colourInfo(k).name).join(' and ') || 'no colour')}">${cols.map(k => PIP(k, 15)).join('')}</span>`
      + `<b class="fdc-name">${esc(d.name)}</b><span class="fdc-desc">${esc(d.desc)}</span>`
      + `<span class="fdc-stat">${d.ok ? 'Legal: 40 cards' : '<span class="fdc-bad">Not legal yet: tap to fix</span>'}</span></span></button>`;
  }).join('');
  return tiles + `<button type="button" class="fdc-ctile fdc-build" data-act="build"><span class="fdc-plus" aria-hidden="true">+</span><span class="fdc-tb"><b class="fdc-name">Build a new deck</b><span class="fdc-desc">Pick cards from the whole pool, or copy a preset and change it.</span></span></button>`;
}

function shellHTML(D) {
  const colourKeys = Object.keys(D.colours || {});
  return `<div class="fdc-veil" aria-hidden="true"></div>
<div class="fdc-in">
  <header class="fdc-top">
    <h1 class="fdc-title" id="fdcTitle"><span class="fdc-t1">Fly Brain</span> <span class="fdc-t2">Card Duel</span></h1>
    <p class="fdc-lede">Two model fruit fly brains, each wired from the connectome of a different fly, learned this game by dopamine. Watch them duel, or take a seat.</p>
    <button type="button" class="fdc-x" data-act="close" hidden>Close</button>
  </header>
  <section class="fdc-modes" role="radiogroup" aria-label="Mode">
    <button type="button" class="fdc-mode" role="radio" data-mode="watch" aria-checked="true">
      <span class="fdc-art"><img src="${MODE_ART.watch}" alt="" width="1200" height="600" decoding="async"></span>
      <span class="fdc-mt"><b>Watch</b><span>Fly A and Fly B duel at the convention table, brains firing live.</span></span>
    </button>
    <button type="button" class="fdc-mode" role="radio" data-mode="play" aria-checked="false">
      <span class="fdc-art"><img src="${MODE_ART.play}" alt="" width="1200" height="600" decoding="async"></span>
      <span class="fdc-mt"><b>Play</b><span>Take the seat across from a model fly. Your hand, first person.</span></span>
    </button>
  </section>
  <section class="fdc-decks" aria-labelledby="fdcDeckH">
    <div class="fdc-dhead">
      <button type="button" class="fdc-back" data-act="back" aria-label="Back to the mode">Mode</button>
      <h2 id="fdcDeckH">Choose the decks</h2>
    </div>
    <div class="fdc-seats" role="radiogroup" aria-label="Seat to fill">
      <div class="fdc-seat" data-seat="0"><button type="button" class="fdc-seat-b" role="radio" data-seat="0" aria-checked="true">
        <span class="fdc-seat-cvb"><canvas class="fdc-seat-cv" aria-hidden="true"></canvas></span>
        <span class="fdc-seat-t"><span class="fdc-who"></span><b class="fdc-seat-n"></b><span class="fdc-seat-p"></span></span>
      </button></div>
      <span class="fdc-vs" aria-hidden="true">vs</span>
      <div class="fdc-seat" data-seat="1"><button type="button" class="fdc-seat-b" role="radio" data-seat="1" aria-checked="false">
        <span class="fdc-seat-cvb"><canvas class="fdc-seat-cv" aria-hidden="true"></canvas></span>
        <span class="fdc-seat-t"><span class="fdc-who"></span><b class="fdc-seat-n"></b><span class="fdc-seat-p"></span></span>
      </button>
      <div class="fdc-opp" role="radiogroup" aria-label="Opponent">${OPP.map(o => `<button type="button" role="radio" data-opp="${o.v}" aria-checked="false"><b>${o.label}</b><small>${o.src}</small></button>`).join('')}</div></div>
    </div>
    <div class="fdc-custom" role="group" aria-labelledby="fdcCustH" hidden>
      <div class="fdc-chead"><h3 id="fdcCustH">Your decks</h3><button type="button" class="fdc-edit" data-act="edit" hidden>Edit this deck</button></div>
      <div class="fdc-cgrid"></div>
    </div>
    <div class="fdc-filter" role="group" aria-label="Filter the decks">
      <span class="fdc-fpips">${colourKeys.map(k => `<button type="button" class="fdc-fpip" data-col="${esc(k)}" aria-pressed="false" aria-label="${esc(D.colours[k]?.name || k)}" title="${esc(D.colours[k]?.name || k)}">${PIP(k, 20)}</button>`).join('')}</span>
      <span class="fdc-kind" role="radiogroup" aria-label="Colours per deck">${['all', 'mono', 'mixed'].map(k => `<button type="button" role="radio" data-kind="${k}" aria-checked="${k === 'all'}">${k === 'all' ? 'All' : k === 'mono' ? 'One colour' : 'Two or more'}</button>`).join('')}</span>
    </div>
    <div class="fdc-grid" role="group" aria-label="Decks">${['random', ...D.ids].map(id => tileHTML(id, D)).join('')}</div>
    <p class="fdc-none" hidden>No deck has all of these colours.</p>
    <p class="fdc-note">Win rates: each fly played the deck 200 times against the greedy bot with learning off (data/training-curve.json). Measured by our code, not estimated.</p>
  </section>
  <footer class="fdc-foot">
    <button type="button" class="fdc-go" data-act="start"><span class="fdc-go-l"></span></button>
    <button type="button" class="fdc-how" data-act="how">How it works</button>
  </footer>
  <p class="fdc-fine"><b>We do not train a real fly.</b> Two computer models of one brain structure play. The game, cards, names, frame and symbols are our own, inspired by Magic: The Gathering. Not affiliated with or endorsed by Wizards of the Coast.</p>
</div>`;
}

// Mount the chooser in root. opts:
//   decks      game/cards.js DECKS          deckOrder  DECK_ORDER
//   colours    COLOURS                      cards      CARD (id -> card)
//   curve      data/training-curve.json
//   initial    { mode, deckA, deckB, humanDeck, opponent, flyDeck, myCode }
//              (a value given here wins over the remembered choice)
//   flies      { A: bool, B: bool } (false disables that opponent)
//   onStart(choice)  choice: normalise() output, mode 'watch' | 'play';
//              with a custom deck also customDeck (deckstore customDeckOf)
//   builderModule  the deckbuilder.js namespace (tests); default: import()
//   onHow()    "How it works"      onClose()  Close or Escape (closable)
// Returns { open({ mode, closable }), close(), destroy(), choice(), el }.
export function mountChooser(root, opts = {}) {
  const decks = opts.decks || {};
  const ids = (opts.deckOrder || Object.keys(decks)).filter(id => decks[id]);
  const D = { decks, ids, colours: opts.colours || {}, cards: opts.cards || {}, curve: opts.curve || null };
  const flies = { A: opts.flies?.A !== false, B: opts.flies?.B !== false };
  const init = { ...(loadChoice() || {}) };
  for (const [k, v] of Object.entries(opts.initial || {})) if (v != null) init[k] = v;
  // custom decks of the deck builder; a ?mydeck= code is saved and picked
  let customs = {};
  const refreshCustoms = () => {
    customs = Object.fromEntries(loadDecks().map(d => customDeckOf(d)).map(d => [d.id, d]));
    for (const id of [...keyCache.keys()]) if (!decks[id]) keyCache.delete(id);
  };
  const keyCache = new Map();
  if (init.myCode) {
    const d = customFromCode(init.myCode);
    if (d) { saveDecks(upsertDeck(loadDecks(), { id: d.savedId, name: d.name, list: d.list, updated: Date.now() })); init.mode = 'play'; init.humanDeck = d.id; }
  }
  refreshCustoms();
  const deckOf = id => decks[id] || customs[id];
  const ch = normalise(init, ids, Object.keys(customs));
  if (!flies[ch.opponent] && ch.opponent !== 'bot') ch.opponent = flies.B ? 'B' : flies.A ? 'A' : 'bot';
  const S = { step: 'mode', seat: 0, cols: new Set(), kind: 'all', closable: false, touchedB: false, open: false, building: false };
  const keys = id => {
    if (!id || id === 'random') return [];
    if (!keyCache.has(id)) keyCache.set(id, keyCardsOf(deckOf(id), D.cards, 5));
    return keyCache.get(id);
  };

  root.classList.add('fdc');
  root.innerHTML = shellHTML(D);
  // the stylesheet of the deck builder, early, so the builder opens styled
  try {
    const doc = root.ownerDocument;
    if (doc && !doc.getElementById('fdb-css')) {
      const l = doc.createElement('link');
      l.id = 'fdb-css'; l.rel = 'stylesheet'; l.href = new URL('../deckbuilder/deckbuilder.css', import.meta.url).href;
      (doc.head || doc.documentElement).appendChild(l);
    }
  } catch { /* no document head: the builder adds the link itself */ }
  root.hidden = true;
  const $ = s => root.querySelector(s);
  const $$ = s => [...root.querySelectorAll(s)];

  // ---- painting: each canvas draws now and again when its pictures load
  const waits = new WeakMap();
  const later = new Set();
  let raf = 0;
  const schedule = fn => {
    later.add(fn);
    if (raf) return;
    const go = () => { raf = 0; const fs = [...later]; later.clear(); fs.forEach(f => f()); };
    raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(go) : setTimeout(go, 16);
  };
  function hookArt(cv, cards, again) {
    let subs = waits.get(cv);
    if (!subs) { subs = []; waits.set(cv, subs); }
    cards.forEach((c, i) => {
      if (!subs[i]) subs[i] = {};
      let now = true;
      paintWithArt(subs[i], c.id, art => { if (!now && art) schedule(again); }, { small: true });
      now = false;
    });
  }
  function paintFanCv(cv, id) {
    const p = prep(cv, 220, 130);
    if (!p) return;
    const [g, W, H, dpr] = p;
    const cards = keys(id).slice(0, 3);
    drawFan(g, W, H, cards, dpr);
    cv._fdcId = id;
    cv._fdcAgain = cv._fdcAgain || (() => paintFanCv(cv, cv._fdcId));
    hookArt(cv, cards, cv._fdcAgain);
  }
  function paintGlyphs() {
    for (const cv of $$('canvas.fdc-glyph')) {
      if (cv._fdcDone) continue;
      const s = parseInt(cv.style.width, 10) || 16;
      const p = prep(cv, s, s);
      if (!p) continue;
      const [g, W] = p;
      cv._fdcDone = true;
      g.scale(W / s, W / s);
      try { drawManaGlyph(g, cv.dataset.k, 0, 0, s); } catch { /* an unknown key draws nothing */ }
    }
  }
  function paintTiles() {
    for (const t of $$('.fdc-tile')) paintFanCv(t.querySelector('canvas'), t.dataset.deck);
    for (const t of $$('.fdc-ctile[data-cdeck]')) paintFanCv(t.querySelector('canvas'), t.dataset.cdeck);
  }
  function paintSeats() { $$('.fdc-seat-cv').forEach((cv, i) => paintFanCv(cv, seatDeck(i))); }
  function paintAll() { paintGlyphs(); paintTiles(); paintSeats(); }

  // ---- state
  const seatDeck = i => (ch.mode === 'play' ? (i ? ch.flyDeck : ch.humanDeck) : (i ? ch.deckB : ch.deckA));
  function setSeatDeck(i, id) {
    if (ch.mode === 'play') { if (i) ch.flyDeck = id; else ch.humanDeck = id; }
    else if (i) ch.deckB = id; else ch.deckA = id;
  }
  let lastCustom = '';
  function sync() {
    const play = ch.mode === 'play';
    root.dataset.mode = ch.mode; root.dataset.step = S.step;
    $$('.fdc-mode').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === ch.mode)));
    const all = { ...decks, ...customs };
    const who = play ? ['Your deck', `${oppName(ch.opponent).replace(/^the g/, 'G')}'s deck`] : ['Fly A · hemibrain', 'Fly B · FlyWire'];
    $$('.fdc-seat').forEach((el, i) => {
      const id = seatDeck(i);
      el.dataset.on = String(S.seat === i);
      el.dataset.side = play ? (i ? (ch.opponent === 'A' ? 'a' : ch.opponent === 'B' ? 'b' : 'bot') : 'you') : (i ? 'b' : 'a');
      const b = el.querySelector('.fdc-seat-b');
      b.setAttribute('aria-checked', String(S.seat === i));
      b.setAttribute('aria-label', `${who[i]}: ${nameOf(all, id)}. Pick to change.`);
      el.querySelector('.fdc-who').textContent = who[i];
      el.querySelector('.fdc-seat-n').textContent = id === 'random' ? 'Random deck' : deckOf(id)?.name || id;
      el.querySelector('.fdc-seat-p').innerHTML = id === 'random' ? '' : (deckOf(id)?.colours || []).map(k => PIP(k, 13)).join('');
    });
    $$('.fdc-opp button').forEach(b => {
      b.setAttribute('aria-checked', String(b.dataset.opp === ch.opponent));
      b.disabled = b.dataset.opp !== 'bot' && !flies[b.dataset.opp];
    });
    $('.fdc-opp').hidden = !play;
    $('#fdcDeckH').textContent = play ? 'Your deck and your opponent' : 'Decks for the two flies';
    const shown = new Set(filterDecks(ids, decks, { cols: S.cols, kind: S.kind }));
    let any = false;
    $$('.fdc-tile').forEach(t => {
      const id = t.dataset.deck;
      const vis = id === 'random' || shown.has(id);
      t.hidden = !vis; any = any || (vis && id !== 'random');
      t.setAttribute('aria-pressed', String(seatDeck(S.seat) === id));
      const marks = [0, 1].filter(i => seatDeck(i) === id);
      const mk = marks.map(i => `<i class="m${i}">${play ? (i ? (ch.opponent === 'bot' ? 'Bot' : ch.opponent) : 'You') : (i ? 'B' : 'A')}</i>`).join('');
      const mEl = t.querySelector('.fdc-marks');
      if (mEl.innerHTML !== mk) mEl.innerHTML = mk;
    });
    $('.fdc-none').hidden = any;
    $$('.fdc-fpip').forEach(b => b.setAttribute('aria-pressed', String(S.cols.has(b.dataset.col))));
    $$('.fdc-kind button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.kind === S.kind)));
    // the Your decks strip: play mode, your seat
    const showC = play && S.seat === 0;
    $('.fdc-custom').hidden = !showC;
    if (showC) {
      const sig = JSON.stringify([Object.values(customs).map(d => [d.id, d.name, d.code]), ch.humanDeck]);
      if (sig !== lastCustom) {
        lastCustom = sig;
        $('.fdc-cgrid').innerHTML = customHTML(customs, ch);
        for (const t of $$('.fdc-ctile[data-cdeck]')) paintFanCv(t.querySelector('canvas'), t.dataset.cdeck);
      }
      $('.fdc-edit').hidden = !customs[ch.humanDeck];
    }
    $('.fdc-go-l').textContent = startLabel(ch, all);
    $('.fdc-x').hidden = !S.closable;
    paintGlyphs();
    paintSeats();
  }

  // ---- events
  function pickMode(m, advance = true) { ch.mode = m === 'play' ? 'play' : 'watch'; S.seat = 0; if (advance) S.step = 'decks'; sync(); }
  function pickDeck(id) {
    setSeatDeck(S.seat, id);
    if (S.seat === 0 && !S.touchedB) { S.touchedB = true; S.seat = 1; }
    sync();
  }
  function start() {
    const out = normalise(ch, ids, Object.keys(customs));
    saveChoice(out);
    if (out.mode === 'play' && customs[out.humanDeck]) out.customDeck = customs[out.humanDeck];
    opts.onStart?.(out);
  }

  // ---- the deck builder over the layer (ui/deckbuilder/deckbuilder.js)
  let builder = null, builderEl = null;
  async function openBuilder(deckId) {
    S.building = true;
    if (!builder) {
      builderEl = root.ownerDocument.createElement('div');
      builderEl.className = 'fdc-builder';
      root.appendChild(builderEl);
      let B = null;
      try { B = opts.builderModule || await import('../deckbuilder/deckbuilder.js'); } catch (e) { console.info('fly-duel: deck builder', e); }
      if (!B?.mountDeckBuilder) { S.building = false; builderEl.remove(); builderEl = null; return null; }
      builder = B.mountDeckBuilder(builderEl, {
        onSaved: () => { refreshCustoms(); },
        onClose: () => { S.building = false; refreshCustoms(); sync(); $('.fdc-custom .fdc-build')?.focus?.(); },
        onPlay: d => {
          builder.close(); S.building = false;
          refreshCustoms();
          ch.mode = 'play'; ch.humanDeck = d.id;
          if (!customs[d.id]) customs[d.id] = d;
          sync();
          start();
        },
      });
    }
    const saved = deckId && customs[deckId] ? { id: customs[deckId].savedId, name: customs[deckId].name, list: customs[deckId].list } : null;
    builder.open(saved || { id: undefined, name: undefined, list: [] });
    return builder;
  }
  function pickCustom(id) {
    const d = customs[id];
    if (!d) return;
    if (!d.ok) { openBuilder(id); return; }
    ch.humanDeck = id;
    if (!S.touchedB) { S.touchedB = true; S.seat = 1; }
    sync();
  }
  function close() { if (!S.open) return; S.open = false; root.hidden = true; }
  function onClick(e) {
    const t = e.target?.closest?.('button');
    if (!t || !root.contains(t) || t.disabled) return;
    if (t.dataset.mode) return pickMode(t.dataset.mode);
    if (t.classList.contains('fdc-seat-b')) { S.seat = +t.dataset.seat; S.touchedB = true; return sync(); }
    if (t.dataset.opp) { ch.opponent = t.dataset.opp; S.seat = 1; return sync(); }
    if (t.dataset.col) { if (S.cols.has(t.dataset.col)) S.cols.delete(t.dataset.col); else S.cols.add(t.dataset.col); return sync(); }
    if (t.dataset.kind) { S.kind = t.dataset.kind; return sync(); }
    if (t.dataset.deck) return pickDeck(t.dataset.deck);
    if (t.dataset.cdeck) return pickCustom(t.dataset.cdeck);
    const act = t.dataset.act;
    if (act === 'build') { openBuilder(null); return; }
    if (act === 'edit') { openBuilder(ch.humanDeck); return; }
    if (act === 'start') return start();
    if (act === 'how') return opts.onHow?.();
    if (act === 'back') { S.step = 'mode'; sync(); $('.fdc-mode[aria-checked="true"]')?.focus?.(); return; }
    if (act === 'close') { close(); opts.onClose?.(); }
  }

  // Arrow keys: by row in a strip, by screen position in the grid.
  function moveIn(list, cur, key) {
    const vis = list.filter(el => !el.hidden && !el.disabled);
    const i = vis.indexOf(cur);
    if (i < 0) return null;
    if (key === 'Home') return vis[0];
    if (key === 'End') return vis[vis.length - 1];
    const r = el => (typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null);
    const rc = r(cur);
    if (!rc || !rc.width || key === 'ArrowLeft' || key === 'ArrowRight') {
      const d = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
      return vis[(i + d + vis.length) % vis.length];
    }
    const down = key === 'ArrowDown';
    let best = null, bd = Infinity;
    for (const el of vis) {
      if (el === cur) continue;
      const q = r(el);
      const dy = q.top - rc.top;
      if (down ? dy <= 4 : dy >= -4) continue;
      const d = Math.abs(dy) * 4 + Math.abs(q.left - rc.left);
      if (d < bd) { bd = d; best = el; }
    }
    return best;
  }
  function onKey(e) {
    if (!S.open || S.building) return;
    const k = e.key;
    const a = typeof document !== 'undefined' ? document.activeElement : null;
    if (k === 'Escape') {
      if (S.step === 'decks' && root.classList.contains('fdc-phone')) { S.step = 'mode'; sync(); }
      else if (S.closable) { close(); opts.onClose?.(); }
      e.preventDefault?.();
      return;
    }
    if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName || '')) return;
    if ((k === 'w' || k === 'W') && !e.metaKey && !e.ctrlKey) { pickMode('watch', false); return; }
    if ((k === 'p' || k === 'P') && !e.metaKey && !e.ctrlKey) { pickMode('play', false); return; }
    if (!/^(Arrow(Left|Right|Up|Down)|Home|End)$/.test(k) || !a || !root.contains(a)) return;
    let list = null;
    if (a.classList.contains('fdc-tile')) list = $$('.fdc-tile');
    else if (a.classList.contains('fdc-ctile')) list = $$('.fdc-ctile');
    else if (a.classList.contains('fdc-mode')) list = $$('.fdc-mode');
    else if (a.classList.contains('fdc-seat-b')) list = $$('.fdc-seat-b');
    else if (a.closest?.('.fdc-opp')) list = $$('.fdc-opp button');
    else if (a.closest?.('.fdc-filter')) list = $$('.fdc-filter button');
    if (!list) return;
    const nx = moveIn(list, a, k);
    if (nx) {
      e.preventDefault?.();
      nx.focus?.();
      nx.scrollIntoView?.({ block: 'nearest', inline: 'center' });
      if (a.classList.contains('fdc-seat-b')) { S.seat = +nx.dataset.seat; S.touchedB = true; sync(); }
    }
  }

  // Phone or desktop, from the width of the layer.
  let ro = null;
  function layout() {
    const w = root.getBoundingClientRect?.().width || (typeof innerWidth === 'number' ? innerWidth : 1200);
    root.classList.toggle('fdc-phone', w < 900);
    if (S.open) schedule(paintAll);
  }
  root.addEventListener('click', onClick);
  if (typeof document !== 'undefined') document.addEventListener('keydown', onKey);
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => layout()); ro.observe(root); }
  else if (typeof addEventListener === 'function') addEventListener('resize', layout);

  sync();
  return {
    el: root,
    open({ mode, closable = false } = {}) {
      if (mode) ch.mode = mode === 'play' ? 'play' : 'watch';
      S.closable = !!closable; S.open = true; S.step = mode ? 'decks' : 'mode'; S.seat = 0; S.touchedB = false;
      refreshCustoms(); lastCustom = '';
      root.hidden = false;
      layout(); sync(); paintAll();
      ($('.fdc-go') || null)?.focus?.({ preventScroll: true });
    },
    close,
    destroy() {
      close();
      builder?.destroy(); builder = null;
      root.removeEventListener('click', onClick);
      if (typeof document !== 'undefined') document.removeEventListener('keydown', onKey);
      ro?.disconnect(); if (!ro && typeof removeEventListener === 'function') removeEventListener('resize', layout);
      root.innerHTML = ''; root.classList.remove('fdc', 'fdc-phone');
    },
    choice: () => normalise(ch, ids, Object.keys(customs)),
    customs: () => ({ ...customs }),
    openBuilder,
    _state: S,
  };
}
