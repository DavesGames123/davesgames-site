// ============================================================================
//  FLY DUEL  ·  cards and the table  (DOM module)
// ----------------------------------------------------------------------------
//  Every card here is a canvas card of ui/cardview.js: drawCard() of
//  ui/cardface.js, the same face as the 3D table. This module writes the
//  card shells as HTML strings, sets innerHTML, then calls hydrate() to
//  draw them. The game state comes from game/rules.js:
//    players[i] = { life, library, hand, battlefield, graveyard, landPlayed }
//  A permanent is { uid, id, tapped, sick, dmg, pp, pt } (pp/pt = pump this
//  turn). permInfo() reads it, with fallbacks for other field names. Decks
//  are DECKS[id] = { name, colours, desc, list: [[id, n]] } in DECK_ORDER.
//
//  Player 0 is Fly A (top of the layout is Fly B, bottom is Fly A, as two
//  players at a table). The table re-renders on each decision, at most a
//  few times per second. hydrate() draws a shell on screen at once and
//  copies a face that is in its cache, so the table does not flash.
//
//  Section 01 has the deck boxes (renderDecks) and the gallery with its
//  filter bar (renderGallery, renderGalleryControls, filterCards).
//
//  GREP MAP
//      grep -n 'export function permInfo'     read one permanent
//      grep -n 'export function ensureCardCSS' link ui/card.css once
//      grep -n 'export function cardHTML'     one card shell, full or mini
//      grep -n 'export function renderBoard'  the table for one state
//      grep -n 'export function deckCounts'   card id -> count in a deck
//      grep -n 'function thumbHTML'           picture crop of a deck row
//      grep -n 'export function renderDecks'  section 01 deck boxes
//      grep -n 'export const GALLERY_ALL'     the empty filter
//      grep -n 'export function galleryGroup' card -> colour group
//      grep -n 'export function filterCards'  filter and sort the pool
//      grep -n 'export function renderGallery' section 01 card grid
//      grep -n 'export function renderGalleryControls' the filter bar
// ============================================================================
import * as CM from '../game/cards.js';
import { ART_CREDIT, artURL, typeLine, cardColours, colourOrder, colourInfo, manaValueOf, hasPlate } from './cardface.js';
import { shellHTML, hydrate, glyphHTML } from './cardview.js';
import { cardArt } from './art.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Reminder text per keyword: [display word, reminder]. Filled from
// KEYWORDS of game/cards.js. main.js can replace it (setKeywordText).
export const KEYWORD_TEXT = Object.fromEntries(Object.entries(CM.KEYWORDS || {}).map(([k, v]) => [k, [k, String(v).replace(/^[^:]*:\s*/, '')]]));
export function setKeywordText(map) {
  for (const [k, v] of Object.entries(map || {})) KEYWORD_TEXT[k] = [k, String(v).replace(/^[^:]*:\s*/, '')];
}

// Read one permanent. Package A owns the exact shape; this reads the
// likely field names and falls back when a field is absent.
export function permInfo(p) {
  if (p == null) return { cardId: null, uid: null, tapped: false, damage: 0, sick: false };
  if (typeof p !== 'object') return { cardId: p, uid: p, tapped: false, damage: 0, sick: false };
  const cardId = p.card ?? p.cardId ?? p.def ?? p.id;
  return {
    cardId,
    uid: p.uid ?? p.iid ?? p.key ?? p.id,
    tapped: !!p.tapped,
    damage: (p.dmg ?? p.damage) | 0,
    sick: !!(p.sick ?? p.summoningSick),
    pp: (p.pp ?? p.pump ?? 0) | 0, pt: (p.pt ?? p.pump ?? 0) | 0,
    token: !!p.token,
  };
}

// Link ui/card.css once, so the card layout has its styles before the
// page links the file itself. No work without a DOM.
let cardCssDone = false;
export function ensureCardCSS() {
  if (cardCssDone || typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
  cardCssDone = true;
  if (document.querySelector('link[data-card-css]')) return;
  const href = new URL('./card.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(l => l.href === href)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href; l.dataset.cardCss = '';
  document.head.appendChild(l);
}

// One card shell. opts: { mini, tapped, damage, sick, info (pump), count,
// hot, uid, attacking, blocking, dim, mode, zoomable }. hydrate() draws it.
export function cardHTML(card, opts = {}) {
  ensureCardCSS();
  const st = {
    tapped: opts.tapped, sick: opts.sick, hot: opts.hot, attacking: opts.attacking, blocking: opts.blocking, dim: opts.dim,
    damage: opts.damage | 0, pp: opts.info?.pp | 0, pt: opts.info?.pt | 0,
  };
  return shellHTML(card, { mini: opts.mini, state: st, count: opts.count, uid: opts.uid, mode: opts.mode, zoomable: opts.zoomable,
    art: card && !hasPlate(card.id) && !CM.CARD?.[card.id] ? procedural(card) : undefined });
}

// The procedural picture (ui/art.js) of a card that is not in
// game/cards.js. cardview draws it from the shell.
function procedural(card) { return cardArt(card, 'art'); }

function landChip(card, info) {
  const ks = cardColours(card);
  const g = glyphHTML(ks.length ? Object.fromEntries(ks.map(k => [k, 1])) : { generic: 1 }, 15, card?.name || 'land');
  return `<span class="land ${info.tapped ? 'tapped' : ''}" data-zoom="1" data-id="${esc(card?.id ?? '')}" title="${esc(card?.name || 'land')}${info.tapped ? ' (tapped)' : ''}">${g}</span>`;
}

// The table for one state. opts: { byId: Map, names: [a, b], hands:
// 'open' | 'count' | 'none', hot: Set of uids to light, last: string,
// lastWho: seat of the last action, banner: { text, seat } at a game end }.
export function renderBoard(root, state, opts = {}) {
  if (!root) return;
  if (!state || !state.players) { root.innerHTML = `<div class="board-empty">${esc(opts.empty || 'Waiting for the rules engine.')}</div>`; return; }
  const byId = opts.byId || new Map();
  const names = opts.names || ['Fly A', 'Fly B'];
  const hot = opts.hot || new Set();
  const side = i => {
    const P = state.players[i];
    const perms = (P.battlefield || []).map(p => ({ p, info: permInfo(p) })).map(o => ({ ...o, card: byId.get(o.info.cardId) }));
    const lands = perms.filter(o => o.card?.type === 'land');
    const crit = perms.filter(o => o.card?.type !== 'land');
    const untapped = lands.filter(o => !o.info.tapped).length;
    const hand = P.hand || [];
    const handHTML = opts.hands === 'open'
      ? hand.map(id => cardHTML(byId.get(id), { mini: true })).join('')
      : `<span class="handcount">${hand.length} in hand</span>`;
    const act = state.toAct === i;
    return `<div class="side side-${i} ${act ? 'acting' : ''}" data-side="${i}">`
      + `<div class="side-head"><span class="who"><i class="dot d${i}"></i>${esc(names[i])}</span>`
      + `<span class="life" title="life">${P.life}</span>`
      + `<span class="meta">lib ${(P.library || []).length} · hand ${hand.length} · gy ${(P.graveyard || []).length}</span>`
      + `<span class="lands" aria-label="${lands.length} lands, ${untapped} untapped">${lands.map(o => landChip(o.card, o.info)).join('')}</span></div>`
      + `<div class="row crit">${crit.length ? crit.map(o => cardHTML(o.card, { mini: true, tapped: o.info.tapped, damage: o.info.damage, sick: o.info.sick, info: o.info, uid: o.info.uid, hot: hot.has(o.info.uid) })).join('') : '<span class="none">no creatures</span>'}</div>`
      + (opts.hands === 'none' ? '' : `<div class="row hand">${handHTML}</div>`)
      + `</div>`;
  };
  const phase = state.phase ? `${state.phase}` : '';
  // The midline: turn and phase, and the last action in the actor's seat
  // colour. A result banner replaces it at a game end (opts.banner).
  const ban = opts.banner;
  const mid = ban
    ? `<div class="midline banner${ban.seat >= 0 ? ` s${ban.seat}` : ''}" role="note"><b>${esc(ban.text)}</b></div>`
    : `<div class="midline"><span>turn ${state.turn ?? '?'}${phase ? ' · ' + esc(phase) : ''}</span><span class="last${opts.lastWho != null ? ` s${opts.lastWho}` : ''}">${esc(opts.last || '')}</span></div>`;
  root.innerHTML = side(1) + mid + side(0);
  hydrate(root);
}

// card id -> count for a deck given as { list: [[id, n]] }, as ids, as
// { id, n|count } rows, or as { id: count }.
export function deckCounts(deck) {
  const m = new Map();
  if (!deck) return m;
  const list = Array.isArray(deck) ? deck : Array.isArray(deck.list) ? deck.list : Array.isArray(deck.cards) ? deck.cards : null;
  if (list) {
    for (const e of list) {
      if (typeof e === 'string' || typeof e === 'number') m.set(e, (m.get(e) || 0) + 1);
      else if (Array.isArray(e)) m.set(e[0], (m.get(e[0]) || 0) + (e[1] ?? 1));
      else if (e && e.id != null) m.set(e.id, (m.get(e.id) || 0) + (e.n ?? e.count ?? 1));
    }
  } else for (const [k, v] of Object.entries(deck)) if (typeof v === 'number') m.set(k, v);
  return m;
}

// A crop of the picture of a card for a deck row, 32 x 24 px: the 240 px
// plate file, or a canvas that cardview draws with the procedural picture.
function thumbHTML(card) {
  if (ART_CREDIT[card.id] || hasPlate(card.id)) return `<img class="dl-art" src="${esc(artURL(card.id, { small: true }))}" alt="" loading="lazy" decoding="async" draggable="false">`;
  return `<canvas class="dl-art" data-art-id="${esc(card.id)}" width="32" height="24" aria-hidden="true"></canvas>`;
}

function deckColoursOf(deck, name, counts, byId) {
  let cs = deck.colours || (deck.colour ? [deck.colour] : null);
  if (!cs || !cs.length) {
    const set = new Set();
    for (const id of counts.keys()) for (const k of cardColours(byId.get(id))) set.add(k);
    cs = [...set];
  }
  if (!cs.length && name) cs = [name];
  const order = colourOrder();
  return cs.map(c => String(c).toLowerCase()).sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
}

// Section 01: one deck box per deck, in DECK_ORDER. A box is a <details>:
// the summary has the name, the colour glyphs, the size, the text of the
// deck and its three most costly cards. The list (lands, creatures by
// cost, spells) opens under it. Each row opens the card in the inspector.
export function renderDecks(root, cards, decks, { order } = {}) {
  if (!root) return;
  const byId = new Map(cards.map(c => [c.id, c]));
  const typeRank = { land: 0, creature: 1 };
  const ids = (order || CM.DECK_ORDER || Object.keys(decks)).filter(k => decks[k] && typeof decks[k] === 'object');
  const many = ids.length > 2;
  root.classList?.add('cv-decks');
  root.innerHTML = ids.map((name, i) => {
    const deck = decks[name];
    const counts = deckCounts(deck);
    const rows = [...counts].map(([id, n]) => ({ c: byId.get(id), n })).filter(o => o.c)
      .sort((a, b) => (typeRank[a.c.type] ?? 2) - (typeRank[b.c.type] ?? 2) || manaValueOf(a.c) - manaValueOf(b.c) || a.c.name.localeCompare(b.c.name));
    const total = rows.reduce((s, o) => s + o.n, 0);
    const lands = rows.filter(o => o.c.type === 'land').reduce((s, o) => s + o.n, 0);
    const title = deck.name || (name[0].toUpperCase() + name.slice(1));
    const cs = deckColoursOf(deck, name, counts, byId);
    const pips = glyphHTML(Object.fromEntries(cs.map(k => [k, 1])), 16, cs.map(k => colourInfo(k).name).join(' and '));
    const fan = rows.filter(o => o.c.type !== 'land').sort((a, b) => manaValueOf(b.c) - manaValueOf(a.c) || b.n - a.n || a.c.name.localeCompare(b.c.name)).slice(0, 3);
    const fanHTML = fan.map(o => shellHTML(o.c, { mode: 'thumb', count: 0 })).join('');
    const open = !many || i === 0 ? ' open' : '';
    return `<details class="decklist cv-deck c-${esc(cs[0] || 'none')}${cs.length > 1 ? ' multi' : ''}" data-deck="${esc(name)}"${open}>`
      + `<summary><h4>${esc(title)} <small>${total} cards, ${lands} lands</small></h4><span class="cv-pips">${pips}</span>`
      + (deck.desc ? `<span class="cv-desc">${esc(deck.desc)}</span>` : '')
      + (fanHTML ? `<span class="cv-fan">${fanHTML}</span>` : '')
      + `<span class="cv-open">List</span></summary><ul>`
      + rows.map(o => `<li data-zoom="1" data-id="${esc(o.c.id)}" data-count="${o.n}" tabindex="0" role="button" title="${esc(o.c.name)}${o.c.text ? ' — ' + esc(o.c.text) : ''}"><b>${o.n}</b>${thumbHTML(o.c)}<span class="dl-name t-${esc(o.c.type)}">${esc(o.c.name)}</span><span class="dl-cost">${glyphHTML(o.c.cost, 13)}</span></li>`).join('')
      + `</ul></details>`;
  }).join('');
  hydrate(root);
}

// ------------------------------------------------------------ the gallery
// Filter: colour 'all' | a colour key | 'multi' | 'none' | 'land'; type
// 'all' | 'creature' | 'spell' | 'land'; cost 'all' | '0'...'4' | '5'
// (5 or more); q a search text (name, type line, rules, flavour).
export const GALLERY_ALL = Object.freeze({ colour: 'all', type: 'all', cost: 'all', q: '' });

// The colour group of a card: a colour key, 'multi', 'none' or 'land'.
export function galleryGroup(card) {
  if (card?.type === 'land') return 'land';
  const cs = cardColours(card);
  return cs.length === 0 ? 'none' : cs.length === 1 ? cs[0] : 'multi';
}

// Filter and sort: colour group in order (each colour, multicolour,
// colourless, lands), then cost, then name. A string filter is the old
// form: a colour key or a type.
export function filterCards(cards, f = GALLERY_ALL) {
  if (typeof f === 'string') f = f === 'all' ? GALLERY_ALL : ['creature', 'spell', 'land'].includes(f) ? { ...GALLERY_ALL, type: f } : { ...GALLERY_ALL, colour: f };
  f = { ...GALLERY_ALL, ...f };
  const q = String(f.q || '').trim().toLowerCase();
  const order = [...colourOrder(), 'multi', 'none', 'land'];
  const rank = c => { const g = galleryGroup(c); const i = order.indexOf(g); return i < 0 ? 99 : i; };
  return cards.filter(c => {
    if (!c) return false;
    const grp = galleryGroup(c);
    if (f.colour !== 'all') {
      if (f.colour === 'multi' || f.colour === 'none' || f.colour === 'land') { if (grp !== f.colour) return false; }
      else if (c.type === 'land' || !cardColours(c).includes(f.colour)) return false;
    }
    if (f.type !== 'all' && c.type !== f.type) return false;
    if (f.cost !== 'all') { const mv = manaValueOf(c); if (f.cost === '5' ? mv < 5 : mv !== +f.cost) return false; }
    if (q) {
      const hay = `${c.name} ${typeLine(c)} ${c.text || ''} ${c.flavour || ''} ${(c.keywords || []).join(' ')}`.toLowerCase();
      if (!q.split(/\s+/).every(w => hay.includes(w))) return false;
    }
    return true;
  }).sort((a, b) => rank(a) - rank(b) || manaValueOf(a) - manaValueOf(b) || a.name.localeCompare(b.name));
}

// Section 01: the grid of cards for a filter. Returns the number shown.
export function renderGallery(root, cards, filter = 'all') {
  if (!root) return 0;
  root.classList?.add('cv-gallery');
  const pick = filterCards(cards, filter);
  root.innerHTML = pick.map(c => cardHTML(c)).join('') || '<p class="none">No cards in this filter.</p>';
  hydrate(root);
  return pick.length;
}

// The filter bar: colour chips (each colour with its glyph, multicolour,
// colourless, lands), type chips, cost chips, a search box and the count.
// onChange(filter) runs on each change. Returns { set(n) } to show the
// count of shown cards.
export function renderGalleryControls(root, cards, filter, onChange) {
  if (!root) return { set() {} };
  let f = { ...GALLERY_ALL, ...filter };
  const groups = new Set(cards.map(galleryGroup));
  const colours = colourOrder().filter(k => cards.some(c => c.type !== 'land' && cardColours(c).includes(k)));
  const chip = (key, v, label, extra = '') => `<button type="button" class="cv-chip" data-f="${key}" data-v="${esc(v)}" aria-pressed="${f[key] === v}">${extra}${esc(label)}</button>`;
  const colourChips = [chip('colour', 'all', 'All')]
    .concat(colours.map(k => chip('colour', k, colourInfo(k).name, glyphHTML({ [k]: 1 }, 14, ''))))
    .concat(groups.has('multi') ? [chip('colour', 'multi', 'Multicolour')] : [])
    .concat(groups.has('none') ? [chip('colour', 'none', 'Colourless')] : [])
    .concat(groups.has('land') ? [chip('colour', 'land', 'Lands')] : []);
  const typeChips = [chip('type', 'all', 'Any'), chip('type', 'creature', 'Creatures'), chip('type', 'spell', 'Spells')];
  const costChips = [chip('cost', 'all', 'Any')].concat(['0', '1', '2', '3', '4'].map(v => chip('cost', v, v))).concat([chip('cost', '5', '5+')]);
  root.classList?.remove('seg');
  root.classList?.add('cv-filters');
  root.setAttribute?.('aria-label', 'Filter the cards');
  root.innerHTML = `<div class="cv-row" role="group" aria-label="Colour"><span class="cv-lab">Colour</span>${colourChips.join('')}</div>`
    + `<div class="cv-row" role="group" aria-label="Type"><span class="cv-lab">Type</span>${typeChips.join('')}</div>`
    + `<div class="cv-row" role="group" aria-label="Cost"><span class="cv-lab">Cost</span>${costChips.join('')}</div>`
    + `<div class="cv-row"><input class="cv-search" type="search" placeholder="Search name or text" aria-label="Search the cards" value="${esc(f.q)}"><span class="cv-found" aria-live="polite"></span></div>`;
  hydrate(root);
  root.addEventListener?.('click', e => {
    const b = e.target?.closest?.('.cv-chip');
    if (!b) return;
    f = { ...f, [b.dataset.f]: b.dataset.v };
    for (const x of root.querySelectorAll(`.cv-chip[data-f="${b.dataset.f}"]`)) x.setAttribute('aria-pressed', String(x === b));
    onChange?.(f);
  });
  let t = 0;
  root.addEventListener?.('input', e => {
    if (!e.target?.classList?.contains('cv-search')) return;
    clearTimeout(t);
    t = setTimeout(() => { f = { ...f, q: e.target.value }; onChange?.(f); }, 120);
  });
  const found = root.querySelector?.('.cv-found');
  return { set(n) { if (found) found.textContent = `${n} of ${cards.length} cards`; } };
}
