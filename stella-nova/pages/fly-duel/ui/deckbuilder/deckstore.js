// ============================================================================
//  FLY DUEL  ·  custom decks: lists, lands, share codes, storage  (ES module)
// ----------------------------------------------------------------------------
//  The pure half of the deck builder. ui/deckbuilder/deckbuilder.js (the
//  DOM) and ui/chooser/chooser.js (the deck tiles) use it. It has no DOM
//  work, so node tests import it.
//
//  A list is the deck format of game/cards.js: [[id, count]...]. Every
//  function here returns a new list and never changes its input.
//  validateDeck() of game/cards.js is the one judge of a legal deck: 40
//  cards, 16 to 18 lands, at most 4 copies of a card that is not a basic
//  land, and at least 6 lands for each colour that the cards need.
//
//  Fill lands. suggestLands() keeps the cards that are not lands and
//  writes a new land base: 40 minus the other cards, held in 16 to 18.
//  Duals go in first: 4 of the pair in a deck of two colours, 2 of each
//  pair with three colours, 1 of each pair with four or five. Basics take
//  the other slots in the ratio of the coloured cost symbols. A last pass
//  swaps a basic for a dual (or a basic of the short colour) until each
//  colour has 6 lands, when that is possible.
//
//  Share code. "1" + base64url bytes [1, (hash16 hi, hash16 lo, count)...,
//  checksum], then "." + the deck name in base64url UTF-8. hash16 is
//  FNV-1a of the card id folded to 16 bits, so a code does not depend on
//  the order of the card pool. tests/deckbuilder.test.mjs checks that no
//  two cards of the pool have one hash. The code goes in the URL as
//  ?mydeck=<code>.
//
//  Storage. localStorage "fly-duel.decks.v1" holds an array of saved decks
//  { id, name, list, updated }. Every read and write is in try/catch: a
//  private window or a full disk gives an empty list and false.
//
//  A custom deck for the game and the chooser: customDeckOf(saved) gives a
//  DECKS-like entry { id: 'my-<id>', name, desc, colours, colour, list,
//  custom: true, code }.
//
//  GREP MAP
//      grep -n 'export function sortList'      type, colour, cost, name
//      grep -n 'export function poolOrder'     the card pool in grid order
//      grep -n 'export function countOf'       copies of one id
//      grep -n 'export function maxCopies'     4, or no limit for a basic
//      grep -n 'export function addCard'       one more copy (or null)
//      grep -n 'export function removeCard'    one copy less
//      grep -n 'export function deckStats'     counts, curve, pips, sources
//      grep -n 'export function deckMessages'  validateDeck -> plain text
//      grep -n 'export function suggestLands'  the Fill lands rule
//      grep -n 'export function matchCard'     the pool filters
//      grep -n 'export function hash16'        card id -> 16 bits
//      grep -n 'export function encodeDeck'    list + name -> code
//      grep -n 'export function decodeDeck'    code -> list + name
//      grep -n 'export function loadDecks'     localStorage -> saved decks
//      grep -n 'export function saveDecks'     saved decks -> localStorage
//      grep -n 'export function upsertDeck'    add or replace by id
//      grep -n 'export function customDeckOf'  saved deck -> DECKS-like
//      grep -n 'export function customFromCode'  ?mydeck= code -> deck
// ============================================================================
import { CARDS, CARD, DECKS, DECK_ORDER, COLOUR_IDS, COLOURS, manaValue, deckColours, validateDeck, cardRolls, cardCounters } from '../../game/cards.js';

export const DECKS_KEY = 'fly-duel.decks.v1';
export const CUSTOM_PREFIX = 'my-';
export const DECK_SIZE = 40;
export const LANDS_MIN = 16, LANDS_MAX = 18, SOURCES_MIN = 6, COPIES_MAX = 4;
export const NAME_MAX = 40;
export const SAVED_MAX = 60;

const TYPE_RANK = { creature: 0, spell: 1, land: 2 };
// Colour rank: the five colours in COLOUR_IDS order, then two or more
// colours, then colourless.
function colourRank(c) {
  if (c.type === 'land') return c.basic ? COLOUR_IDS.indexOf(c.mana[0]) : 5 + COLOUR_IDS.indexOf(c.mana[0]) / 10 + COLOUR_IDS.indexOf(c.mana[1]) / 100;
  const cs = c.colours || [];
  return cs.length === 1 ? COLOUR_IDS.indexOf(cs[0]) : cs.length ? 5 : 6;
}

// A list in display order: creatures, spells, lands; then cost, then name.
export function sortList(list) {
  return list.filter(([id, n]) => CARD[id] && n > 0).map(r => [r[0], r[1]]).sort(([a], [b]) => {
    const x = CARD[a], y = CARD[b];
    return TYPE_RANK[x.type] - TYPE_RANK[y.type] || manaValue(x) - manaValue(y) || colourRank(x) - colourRank(y) || x.name.localeCompare(y.name);
  });
}

// The card pool (no tokens) in grid order: by colour (lands last), then
// cost, then creature before spell, then name.
export function poolOrder(cards = CARDS) {
  return cards.filter(c => !c.token).slice().sort((x, y) => {
    const lx = x.type === 'land' ? 1 : 0, ly = y.type === 'land' ? 1 : 0;
    return lx - ly || colourRank(x) - colourRank(y) || manaValue(x) - manaValue(y) || TYPE_RANK[x.type] - TYPE_RANK[y.type] || x.name.localeCompare(y.name);
  }).map(c => c.id);
}

export function countOf(list, id) { let n = 0; for (const [i, k] of list) if (i === id) n += k; return n; }
export function totalOf(list) { return list.reduce((s, [, n]) => s + n, 0); }
export const maxCopies = id => (CARD[id]?.basic ? Infinity : COPIES_MAX);

// One more copy of id, or null when the copy limit is reached.
export function addCard(list, id, n = 1) {
  const c = CARD[id];
  if (!c || c.token) return null;
  const have = countOf(list, id);
  if (have + n > maxCopies(id)) return null;
  const out = list.filter(([i]) => i !== id).map(r => [r[0], r[1]]);
  out.push([id, have + n]);
  return sortList(out);
}

// One copy less (the row goes at 0).
export function removeCard(list, id, n = 1) {
  const have = countOf(list, id);
  const out = list.filter(([i]) => i !== id).map(r => [r[0], r[1]]);
  if (have - n > 0) out.push([id, have - n]);
  return sortList(out);
}

// Counts for the deck panel. curve: non-land cards by mana value, the
// last bucket is 6 and more. pips: coloured cost symbols per colour.
// sources: lands that make each colour. colours: colours the cards need.
export function deckStats(list) {
  const curve = [0, 0, 0, 0, 0, 0, 0];
  const pips = Object.fromEntries(COLOUR_IDS.map(c => [c, 0]));
  const sources = Object.fromEntries(COLOUR_IDS.map(c => [c, 0]));
  let cards = 0, lands = 0, creatures = 0, spells = 0, mvSum = 0, duals = 0;
  for (const [id, n] of list) {
    const c = CARD[id];
    if (!c) continue;
    cards += n;
    if (c.type === 'land') { lands += n; if (!c.basic) duals += n; for (const m of c.mana) sources[m] += n; continue; }
    if (c.type === 'creature') creatures += n; else spells += n;
    const mv = manaValue(c);
    mvSum += mv * n;
    curve[Math.min(6, mv)] += n;
    for (const k of COLOUR_IDS) pips[k] += (c.cost[k] || 0) * n;
  }
  const others = cards - lands;
  return { cards, lands, duals, creatures, spells, others, curve, pips, sources, colours: deckColours(list.filter(([id]) => CARD[id])), avgMV: others ? mvSum / others : 0 };
}

const cname = id => CARD[id]?.name || id;
const colName = c => COLOURS[c]?.name || c;

// validateDeck() as plain sentences for the deck panel. Each message is
// { kind: 'count' | 'lands' | 'copies' | 'sources' | 'other', text }.
// The deck is legal when the list is empty and validateDeck says ok.
export function deckMessages(list) {
  const v = validateDeck(list);
  const s = deckStats(list);
  const out = [];
  if (s.cards < DECK_SIZE) out.push({ kind: 'count', text: `Add ${DECK_SIZE - s.cards} card${DECK_SIZE - s.cards === 1 ? '' : 's'}: a deck has exactly ${DECK_SIZE} (now ${s.cards}).` });
  else if (s.cards > DECK_SIZE) out.push({ kind: 'count', text: `Take out ${s.cards - DECK_SIZE} card${s.cards - DECK_SIZE === 1 ? '' : 's'}: a deck has exactly ${DECK_SIZE} (now ${s.cards}).` });
  if (s.lands < LANDS_MIN || s.lands > LANDS_MAX) out.push({ kind: 'lands', text: `${s.lands} land${s.lands === 1 ? '' : 's'}: a deck has ${LANDS_MIN} to ${LANDS_MAX}.` });
  for (const [id] of list) if (CARD[id] && !CARD[id].basic && countOf(list, id) > COPIES_MAX) out.push({ kind: 'copies', text: `${cname(id)}: ${countOf(list, id)} copies, at most ${COPIES_MAX}.` });
  for (const c of s.colours) if (s.sources[c] < SOURCES_MIN) out.push({ kind: 'sources', text: `${colName(c)}: ${s.sources[c]} land${s.sources[c] === 1 ? '' : 's'} make it. Cards of a colour need at least ${SOURCES_MIN}.` });
  // anything that validateDeck finds and the lines above do not say
  const known = /cards, need|lands, need|copies, at most|lands make/;
  for (const e of v.errors) if (!known.test(e)) out.push({ kind: 'other', text: e });
  return { ok: v.ok && out.length === 0, messages: out, result: v, stats: s };
}

// Fill lands: a new land base for the cards that are not lands. See the
// header for the rule. opts.total forces the land count.
export function suggestLands(list, opts = {}) {
  const others = list.filter(([id]) => CARD[id] && CARD[id].type !== 'land');
  const n = totalOf(others);
  const T = opts.total ?? Math.max(LANDS_MIN, Math.min(LANDS_MAX, DECK_SIZE - n));
  const st = deckStats(others);
  let cols = st.colours.slice();
  const counts = new Map();
  const add = (id, k = 1) => counts.set(id, (counts.get(id) || 0) + k);
  const basicOf = c => CARDS.find(x => x.type === 'land' && x.basic && x.mana[0] === c)?.id;
  const dualOf = (a, b) => CARDS.find(x => x.type === 'land' && !x.basic && x.mana.length === 2 && x.mana.includes(a) && x.mana.includes(b))?.id;
  if (!cols.length) {
    // colourless cards only: any basic works; spread them over the colours
    COLOUR_IDS.forEach((c, i) => add(basicOf(c), Math.floor(T / 5) + (i < T % 5 ? 1 : 0)));
    return sortList([...others, ...counts]);
  }
  // duals of each pair of colours
  const per = cols.length === 2 ? 4 : cols.length === 3 ? 2 : cols.length >= 4 ? 1 : 0;
  for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) {
    const d = dualOf(cols[i], cols[j]);
    if (d) add(d, per);
  }
  let used = [...counts.values()].reduce((a, b) => a + b, 0);
  // basics by the share of cost symbols (largest remainder), at least 1 each
  const pipSum = cols.reduce((a, c) => a + Math.max(1, st.pips[c]), 0);
  const left = Math.max(0, T - used);
  const raw = cols.map(c => left * Math.max(1, st.pips[c]) / pipSum);
  const base = raw.map(Math.floor);
  let rest = left - base.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - base[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rest > 0) { base[i]++; rest--; } });
  cols.forEach((c, i) => { if (base[i]) add(basicOf(c), base[i]); });
  // repair: each colour needs SOURCES_MIN lands
  const src = () => {
    const s = Object.fromEntries(cols.map(c => [c, 0]));
    for (const [id, k] of counts) for (const m of CARD[id].mana) if (m in s) s[m] += k;
    return s;
  };
  for (let guard = 0; guard < 40; guard++) {
    const s = src();
    const short = cols.filter(c => s[c] < SOURCES_MIN).sort((a, b) => s[a] - s[b])[0];
    if (!short) break;
    // swap a basic for a dual of (short, donor): the donor keeps its
    // count. With no dual left, a basic of a colour with lands to spare.
    const cands = cols.filter(c => c !== short && (counts.get(basicOf(c)) || 0) > 0)
      .map(c => ({ c, dual: dualOf(short, c) })).map(x => ({ ...x, ok: !!x.dual && (counts.get(x.dual) || 0) < COPIES_MAX }));
    const bySrc = (a, b) => s[b.c] - s[a.c];
    const pick = cands.filter(x => x.ok).sort(bySrc)[0] || cands.filter(x => s[x.c] > SOURCES_MIN).sort(bySrc)[0];
    if (!pick) break;
    counts.set(basicOf(pick.c), counts.get(basicOf(pick.c)) - 1);
    add(pick.ok ? pick.dual : basicOf(short));
  }
  for (const [id, k] of counts) if (!k) counts.delete(id);
  return sortList([...others, ...counts]);
}

// ------------------------------------------------------------ pool filters
// f: { cols: Set of colour ids | 'multi' | 'none', type: 'all' | 'creature'
// | 'spell' | 'land', mv: Set of 0..6 (6 = 6 and more), kw: '' | keyword |
// 'dice' | 'counters', q: text }. A card passes each filter that is set.
// Colours: a card passes when it has one of the picked colours (a land:
// a colour it makes); 'multi' = two or more colours, 'none' = colourless.
export function matchCard(c, f = {}) {
  if (!c) return false;
  const cs = c.type === 'land' ? c.mana : (c.colours || []);
  if (f.cols && f.cols.size) {
    let hit = false;
    for (const k of f.cols) if (k === 'multi' ? cs.length > 1 : k === 'none' ? cs.length === 0 : cs.includes(k)) { hit = true; break; }
    if (!hit) return false;
  }
  if (f.type && f.type !== 'all' && c.type !== f.type) return false;
  if (f.mv && f.mv.size) {
    if (c.type === 'land') return false;
    if (!f.mv.has(Math.min(6, manaValue(c)))) return false;
  }
  if (f.kw) {
    if (f.kw === 'dice') { if (!cardRolls(c)) return false; }
    else if (f.kw === 'counters') { if (!cardCounters(c)) return false; }
    else if (!(c.keywords || []).includes(f.kw)) return false;
  }
  const q = String(f.q || '').trim().toLowerCase();
  if (q) {
    const hay = `${c.name} ${c.subtype || ''} ${c.type} ${c.text || ''} ${(c.keywords || []).join(' ')}`.toLowerCase();
    if (!q.split(/\s+/).every(w => hay.includes(w))) return false;
  }
  return true;
}

// ------------------------------------------------------------ share codes
export function hash16(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h ^ (h >>> 16)) & 0xffff;
}
let byHash = null;
function hashTable() {
  if (byHash) return byHash;
  byHash = new Map();
  for (const c of CARDS) if (!c.token) byHash.set(hash16(c.id), c.id);
  return byHash;
}
const b64u = bytes => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = str => {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  return Uint8Array.from(s, ch => ch.charCodeAt(0));
};

// list + name -> "1<base64url>.<name>". Counts above 255 do not occur (a
// deck has 40 cards).
export function encodeDeck({ list, name = '' }) {
  const rows = sortList(list);
  const bytes = [1];
  for (const [id, n] of rows) { const h = hash16(id); bytes.push(h >> 8, h & 255, Math.min(255, n)); }
  bytes.push(bytes.reduce((a, b) => (a + b) & 255, 0));
  const nm = String(name || '').trim().slice(0, NAME_MAX);
  return `1${b64u(bytes)}${nm ? '.' + b64u(new TextEncoder().encode(nm)) : ''}`;
}

// code -> { ok, list, name, error }. Spaces and line breaks in a pasted
// code are ignored.
export function decodeDeck(code) {
  const bad = error => ({ ok: false, list: [], name: '', error });
  const s = String(code || '').replace(/\s+/g, '');
  if (!s) return bad('The code is empty.');
  if (s[0] !== '1') return bad('This is not a deck code of this page.');
  const [body, nm = ''] = s.slice(1).split('.');
  let bytes;
  try { bytes = unb64u(body); } catch { return bad('The code has a character that is not allowed.'); }
  if (bytes.length < 2 || bytes[0] !== 1 || (bytes.length - 2) % 3) return bad('The code is not complete.');
  const sum = bytes.slice(0, -1).reduce((a, b) => (a + b) & 255, 0);
  if (sum !== bytes[bytes.length - 1]) return bad('The code is damaged (the checksum does not agree).');
  const T = hashTable();
  const list = [];
  for (let i = 1; i < bytes.length - 1; i += 3) {
    const id = T.get((bytes[i] << 8) | bytes[i + 1]);
    if (!id) return bad('The code has a card that this version of the page does not have.');
    if (bytes[i + 2] > 0) list.push([id, bytes[i + 2]]);
  }
  let name = '';
  if (nm) { try { name = new TextDecoder().decode(unb64u(nm)).slice(0, NAME_MAX); } catch { name = ''; } }
  return { ok: true, list: sortList(list), name, error: '' };
}

// ------------------------------------------------------------ storage
function store() { try { return globalThis.localStorage || null; } catch { return null; } }
const cleanList = list => (Array.isArray(list) ? sortList(list.filter(r => Array.isArray(r) && CARD[r[0]] && !CARD[r[0]].token && Number.isInteger(r[1]) && r[1] > 0 && r[1] < 100)) : []);
const cleanDeck = d => (d && typeof d === 'object' && typeof d.id === 'string' && /^[a-z0-9-]{1,40}$/.test(d.id)
  ? { id: d.id, name: String(d.name || 'My deck').slice(0, NAME_MAX), list: cleanList(d.list), updated: +d.updated || 0 } : null);

export function loadDecks(st = store()) {
  try {
    const j = JSON.parse(st?.getItem(DECKS_KEY) || '[]');
    return Array.isArray(j) ? j.map(cleanDeck).filter(Boolean) : [];
  } catch { return []; }
}
export function saveDecks(decks, st = store()) {
  try { st?.setItem(DECKS_KEY, JSON.stringify(decks.slice(0, SAVED_MAX))); return !!st; } catch { return false; }
}
export function upsertDeck(decks, deck) {
  const d = cleanDeck(deck);
  if (!d) return decks.slice();
  return [d, ...decks.filter(x => x.id !== d.id)];
}
export function deleteDeck(decks, id) { return decks.filter(x => x.id !== id); }
export function newDeckId(now = Date.now(), rnd = Math.random()) {
  return `d${Math.floor(now).toString(36)}${Math.floor(rnd * 1296).toString(36).padStart(2, '0')}`;
}

// A name that no saved deck has: "My deck", "My deck 2", ...
export function freeName(decks, base = 'My deck') {
  const names = new Set(decks.map(d => d.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

// A saved deck as a DECKS-like entry for the chooser and the game.
export function customDeckOf(saved) {
  const list = cleanList(saved?.list);
  const colours = deckColours(list);
  const st = deckStats(list);
  const v = deckMessages(list);
  const desc = `Your deck: ${st.creatures} creature${st.creatures === 1 ? '' : 's'}, ${st.spells} spell${st.spells === 1 ? '' : 's'}, ${st.lands} land${st.lands === 1 ? '' : 's'}.`;
  return {
    id: CUSTOM_PREFIX + saved.id, savedId: saved.id, name: saved.name || 'My deck', desc, colours,
    colour: colours.length === 1 ? colours[0] : colours.length ? 'multi' : 'none',
    list, custom: true, ok: v.ok, code: encodeDeck({ list, name: saved.name }),
  };
}

// The deck of a ?mydeck= code, or null. The saved id comes from the code,
// so the same code gives the same deck id each time.
export function customFromCode(code) {
  const r = decodeDeck(code);
  if (!r.ok) return null;
  const s = String(code).replace(/\s+/g, '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return customDeckOf({ id: `u${h.toString(36)}`, name: r.name || 'Shared deck', list: r.list });
}

// The preset decks for "Start from a preset": [{ id, name, list }].
export function presets() { return DECK_ORDER.map(id => ({ id, name: DECKS[id].name, colours: DECKS[id].colours, list: sortList(DECKS[id].list) })); }
