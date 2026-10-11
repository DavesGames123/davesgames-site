// ============================================================================
//  FLY DUEL  ·  cards and the table  (DOM module)
// ----------------------------------------------------------------------------
//  Draws cards and the game table as HTML. A card has the frame of
//  ui/cardface.js (name bar, painted picture, type line, rules box, stat
//  plate), styled by ui/card.css. The pictures are the public-domain plates
//  in art/cards/. The mana glyphs come from ui/art.js. A card id with no
//  picture falls back to the procedural art of ui/art.js. The game state comes from game/rules.js (package A):
//    players[i] = { life, library, hand, battlefield, graveyard, landPlayed }
//  A permanent is { uid, id, tapped, sick, dmg, pp, pt } (game/rules.js,
//  pp/pt = pump this turn). permInfo() reads it, with fallbacks for other
//  field names. Decks are DECKS[name] = { name, colour, list: [[id, n]] }.
//
//  Player 0 is Fly A (top of the layout is Fly B, bottom is Fly A, as two
//  players at a table). The table re-renders on each decision, at most a
//  few times per second, so plain innerHTML is enough.
//
//  GREP MAP
//      grep -n 'export function permInfo'     read one permanent
//      grep -n 'export function ensureCardCSS' link ui/card.css once
//      grep -n 'export function cardHTML'     one card, full or mini
//      grep -n 'export function renderBoard'  the table for one state
//      grep -n 'export function deckCounts'   card id -> count in a deck
//      grep -n 'export function renderDecks'  section 01 deck lists
//      grep -n 'export function renderGallery' section 01 card gallery
// ============================================================================
import { cardArt, costGlyphs, manaGlyph, colourKey } from './art.js';
import { ART_CREDIT, artURL, typeLine, rulesRuns, frameKind, TOKEN_NOTE } from './cardface.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Reminder text per keyword. main.js replaces it with KEYWORDS from
// game/cards.js when that module loads (setKeywordText).
export const KEYWORD_TEXT = {
  swift: ['swift', 'can attack on the turn it enters'],
  wings: ['wings', 'only creatures with wings can block it'],
  sting: ['sting', 'any damage it deals to a creature destroys that creature'],
  thick: ['thick', 'cannot attack'],
  sap: ['sap', 'combat damage it deals also gives you that much life'],
};
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

function ptOf(card, info) {
  if (!card || card.type !== 'creature') return null;
  return [(card.power ?? 0) + (info?.pp | 0), (card.toughness ?? 0) + (info?.pt | 0)];
}

// Link ui/card.css once, so the card frame has its styles before the page
// links the file itself. No work without a DOM.
let cardCssDone = false;
export function ensureCardCSS() {
  if (cardCssDone || typeof document === 'undefined') return;
  cardCssDone = true;
  if (document.querySelector('link[data-card-css]')) return;
  const href = new URL('./card.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(l => l.href === href)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href; l.dataset.cardCss = '';
  document.head.appendChild(l);
}

// The picture of a card: the plate when there is one, else the
// procedural art.
function pictureHTML(card, small) {
  if (ART_CREDIT[card.id]) {
    return `<img class="art" src="${esc(artURL(card.id, { small }))}" alt="${esc(card.name)}" loading="lazy" decoding="async" draggable="false">`;
  }
  return cardArt(card, 'art');
}

function rulesHTML(card) {
  return rulesRuns(card).map(r => r.s === 'b' ? `<b>${esc(r.t)}</b>` : r.s === 'i' ? `<i>${esc(r.t)}</i>` : esc(r.t)).join('');
}

// One card. opts: { mini, tapped, damage, sick, info, count, hot, uid }.
export function cardHTML(card, opts = {}) {
  ensureCardCSS();
  if (!card) return `<div class="fcard fx ${opts.mini ? 'mini' : ''} unknown"><div class="fx-name"><span class="fx-title">?</span></div></div>`;
  const ck = colourKey(card.colour);
  const pt = ptOf(card, opts.info);
  const pumped = !!((opts.info?.pp | 0) || (opts.info?.pt | 0));
  const kw = (card.keywords || []).map(k => `<span class="kw" title="${esc(KEYWORD_TEXT[k]?.[1] || k)}">${esc(KEYWORD_TEXT[k]?.[0] || k)}</span>`).join('');
  const cls = ['fcard', 'fx', `c-${ck}`, `f-${frameKind(card)}`, `t-${card.type}`, card.token ? 'token' : '', opts.mini ? 'mini' : '', opts.tapped ? 'tapped' : '', opts.sick ? 'sick' : '', opts.hot ? 'hot' : ''].filter(Boolean).join(' ');
  const dmg = opts.damage ? `<span class="fx-dmg" title="${opts.damage} damage">−${opts.damage}</span>` : '';
  const cnt = opts.count ? `<span class="fx-count">${opts.count}×</span>` : '';
  const uid = opts.uid != null ? ` data-uid="${esc(opts.uid)}"` : '';
  const title = `${card.name}${card.text ? ' — ' + card.text : ''}`;
  const ptHTML = pt ? `<div class="fx-pt${pumped ? ' pumped' : ''}">${dmg}<span>${pt[0]}/${pt[1]}</span></div>` : '';
  if (opts.mini) {
    return `<div class="${cls}" data-id="${esc(card.id)}"${uid} title="${esc(title)}">`
      + `<div class="fx-art">${pictureHTML(card, true)}</div>`
      + `<div class="fx-name"><span class="fx-title">${esc(card.name)}</span></div>`
      + (kw ? `<div class="fx-kws">${kw}</div>` : '')
      + ptHTML + cnt + `</div>`;
  }
  const flav = card.flavour || (card.token ? TOKEN_NOTE : '');
  const rules = rulesHTML(card);
  const land = card.type === 'land'
    ? `<div class="fx-landglyph">${manaGlyph(card.produces === 'moss' ? 'moss' : card.produces === 'amber' ? 'amber' : 'generic', 1, 40)}</div>` : '';
  const credit = ART_CREDIT[card.id] ? `<div class="fx-credit">Art: ${esc(ART_CREDIT[card.id])}</div>` : '';
  return `<div class="${cls}" data-id="${esc(card.id)}"${uid}>`
    + `<div class="fx-name"><span class="fx-title">${esc(card.name)}</span><span class="fx-cost">${costGlyphs(card.cost, 16)}</span></div>`
    + `<div class="fx-art">${pictureHTML(card, false)}</div>`
    + `<div class="fx-type">${esc(typeLine(card))}</div>`
    + `<div class="fx-text${rules ? '' : ' only-flavour'}">${land}${rules ? `<p class="fx-rules">${rules}</p>` : ''}${flav ? `<p class="fx-flav">${esc(flav)}</p>` : ''}</div>`
    + ptHTML + credit + cnt
    + `</div>`;
}

function landChip(card, info) {
  const ck = colourKey(card?.colour);
  const g = ck === 'amber' ? manaGlyph('amber', 0, 15) : ck === 'moss' ? manaGlyph('moss', 0, 15) : manaGlyph('generic', 1, 15);
  return `<span class="land ${info.tapped ? 'tapped' : ''}" title="${esc(card?.name || 'land')}${info.tapped ? ' (tapped)' : ''}">${g}</span>`;
}

// The table for one state. opts: { byId: Map, names: [a, b], hands:
// 'open' | 'count', hot: Set of uids to light, last: string, lastWho:
// seat of the last action, banner: { text, seat } at a game end }.
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

// Section 01: the two deck lists, sorted lands, creatures by cost, spells.
export function renderDecks(root, cards, decks) {
  if (!root) return;
  const byId = new Map(cards.map(c => [c.id, c]));
  const cmc = c => (c.cost?.generic | 0) + (c.cost?.amber | 0) + (c.cost?.moss | 0);
  const order = { land: 0, creature: 1, spell: 2 };
  root.innerHTML = Object.entries(decks).filter(([, d]) => d && (Array.isArray(d) || typeof d === 'object')).slice(0, 2).map(([name, deck]) => {
    const counts = [...deckCounts(deck)].map(([id, n]) => ({ c: byId.get(id), n })).filter(o => o.c)
      .sort((a, b) => order[a.c.type] - order[b.c.type] || cmc(a.c) - cmc(b.c) || a.c.name.localeCompare(b.c.name));
    const total = counts.reduce((s, o) => s + o.n, 0);
    const lands = counts.filter(o => o.c.type === 'land').reduce((s, o) => s + o.n, 0);
    const title = deck.name || (name[0].toUpperCase() + name.slice(1));
    return `<div class="decklist c-${colourKey(deck.colour || name)}"><h4>${esc(title)} <small>${total} cards, ${lands} lands</small></h4><ul>`
      + counts.map(o => `<li><b>${o.n}</b><span class="dl-name c-${colourKey(o.c.colour)}">${esc(o.c.name)}</span><span class="dl-cost">${costGlyphs(o.c.cost, 13)}</span></li>`).join('')
      + `</ul></div>`;
  }).join('');
}

// Section 01: a gallery of full cards, filtered by colour or type.
export function renderGallery(root, cards, filter = 'all') {
  if (!root) return;
  const pick = cards.filter(c => filter === 'all' || colourKey(c.colour) === filter || c.type === filter);
  root.innerHTML = pick.map(c => cardHTML(c)).join('') || '<p class="none">No cards in this filter.</p>';
}
