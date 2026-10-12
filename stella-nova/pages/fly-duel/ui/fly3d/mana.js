// ============================================================================
//  FLY DUEL 3D  ·  mana colours and land stacks  (pure ES module, no three)
// ----------------------------------------------------------------------------
//  The table reads the mana colours from game/cards.js at run time. It does
//  not keep its own list of colours. A colour is a key that a land
//  produces or that a cost names (for example 'amber' or 'moss'). The order
//  is the order of the first card that names the colour.
//
//  A land can produce one colour or more (a dual land). The field can be
//  'mana: ["amber", "moss"]' (game/cards.js, read first), 'produces: "amber"', 'produces: ["amber", "moss"]', 'produces:
//  "amber/moss"' or 'colours: [...]'. landProduces() reads all of them.
//
//  Land stacks. On the table, the lands of one player lie in stacks, one
//  stack per colour set (one colour, or the two colours of a dual land).
//  The cards of a stack lie in a cascade toward the seat, so the top edge
//  of each card shows. The untapped lands of a stack carry one mana token
//  each, in a tower at the head of the stack, so the height of the tower
//  is the free mana of that colour. stackLayout() gives the place of each
//  land and each stack. It is pure, so the node test checks it for every
//  mix of colours.
//
//  GREP MAP
//      grep -n 'export function manaColours'   colour keys from the cards
//      grep -n 'export function landProduces'  colours of one land
//      grep -n 'export function colourHex'     colour key -> '#rrggbb'
//      grep -n 'export function tokenShape'    token sides per colour
//      grep -n 'export function costColours'   coloured part of a cost
//      grep -n 'export function stackKey'      stack name of one land
//      grep -n 'export function stackLayout'   stacks and land places
//      grep -n 'export const STACK'            stack layout numbers
// ============================================================================
import { CARDS, CARD } from '../../game/cards.js';
import { PALETTE } from '../art.js';
import { TOKENS } from '../tokens.js';

// Keys that are not a colour of mana.
const NOT_COLOUR = new Set(['generic', 'none', 'colourless', 'colorless', '', 'any', 'x']);

const norm = c => String(c ?? '').trim().toLowerCase();

// Colours of one land (or of any card that produces mana). [] for none.
export function landProduces(card) {
  const k = typeof card === 'string' ? CARD[card] : card;
  if (!k) return [];
  let raw = k.mana ?? k.produces ?? k.colours ?? k.colors ?? null;
  if (raw == null) return [];
  if (typeof raw === 'string') raw = raw.split(/[\/|,+]/);
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const c of raw) { const n = norm(c); if (!NOT_COLOUR.has(n) && !out.includes(n)) out.push(n); }
  return out;
}

// The coloured part of a cost: [[colour, n], ...] with n > 0.
export function costColours(cost) {
  const out = [];
  for (const [k, v] of Object.entries(cost || {})) {
    const n = norm(k);
    if (NOT_COLOUR.has(n) || !(v > 0)) continue;
    out.push([n, v | 0]);
  }
  return out;
}

// Every mana colour in the card pool, in first-use order. Card colours that
// are lists (a gold card) or 'amber/moss' strings count too.
let cache = null, cacheLen = -1;
export function manaColours(cards = CARDS) {
  if (cards === CARDS && cache && cacheLen === CARDS.length) return cache;
  const out = [];
  const add = c => { const n = norm(c); if (n && !NOT_COLOUR.has(n) && !out.includes(n)) out.push(n); };
  for (const k of cards) {
    for (const c of landProduces(k)) add(c);
    for (const [c] of costColours(k.cost)) add(c);
    const col = k.colour ?? k.color;
    if (Array.isArray(col)) col.forEach(add);
    else if (typeof col === 'string') col.split(/[\/|,+]/).forEach(add);
  }
  if (cards === CARDS) { cache = out; cacheLen = CARDS.length; }
  return out;
}

// '#rrggbb' of a colour key. The card palette (ui/art.js) first, then the
// colour tokens, then a fixed list for a colour that neither names yet.
const SPARE = ['#6fb6ff', '#ff7a6b', '#c9a6ff', '#5fd3c4', '#f2e27a', '#ff9fd0', '#9fe07a'];
const HEX = /^#[0-9a-f]{6}$/i;
export function colourHex(key) {
  const k = norm(key);
  const p = PALETTE[k]?.ink;
  if (typeof p === 'string' && HEX.test(p)) return p;
  if (typeof TOKENS[k] === 'string' && HEX.test(TOKENS[k])) return TOKENS[k];
  if (NOT_COLOUR.has(k)) return TOKENS.none;
  const all = manaColours();
  const unknown = all.filter(c => !(PALETTE[c]?.ink) && !(TOKENS[c]));
  const i = unknown.indexOf(k);
  return SPARE[(i >= 0 ? i : hashKey(k)) % SPARE.length];
}

// The token of a colour is a prism with this many sides (amber: a
// honeycomb cell, moss: a diamond). Other colours take the next free
// shape, so each colour has its own outline as well as its own hue.
// 0 = a square box (generic mana).
const KNOWN_SHAPE = { amber: 6, moss: 4 };
const SHAPE_POOL = [3, 8, 5, 12, 7, 10];
export function tokenShape(key) {
  const k = norm(key);
  if (NOT_COLOUR.has(k)) return 0;
  if (KNOWN_SHAPE[k]) return KNOWN_SHAPE[k];
  const others = manaColours().filter(c => !KNOWN_SHAPE[c]);
  const i = others.indexOf(k);
  return SHAPE_POOL[(i >= 0 ? i : hashKey(k)) % SHAPE_POOL.length];
}

// The stack name of one land: its colours in colour order, joined by '+'.
// 'none' for a land with no colour.
export function stackKey(card, order = manaColours()) {
  const cs = landProduces(card).slice().sort((a, b) => rank(order, a) - rank(order, b));
  return cs.length ? cs.join('+') : 'none';
}
const rank = (order, c) => { const i = order.indexOf(c); return i < 0 ? 1e3 + hashKey(c) % 1e3 : i; };

// ------------------------------------------------------------- the stacks
// Seat-space numbers (see scene.js TABLE): u across, v toward the seat.
export const STACK = {
  half: 1.75,       // stacks lie in u from -half to +half
  gap: 0.66,        // u from one stack to the next (less when crowded)
  cascade: 0.075,   // v from one card of a stack to the next
  spread: 0.36,     // the cascade of one stack is never longer than this
  lift: 0.0035,     // y from one card of a stack to the next
  towerV: -0.2,     // the token tower stands this far from the card centre
  towerStep: 0.088, // y from one token of a tower to the next
};

function slots(n, half, gap) {
  if (!n) return [];
  const step = n > 1 ? Math.min(gap, (2 * half) / (n - 1)) : 0;
  const w = step * (n - 1);
  return Array.from({ length: n }, (_, i) => -w / 2 + i * step);
}

// lands: [{ uid, id, tapped }] in battlefield order (non-land entries are
// skipped). o: STACK overrides, plus order (colour keys) and card (id ->
// card definition, default CARD of game/cards.js; the test gives its own). Returns { stacks: [{ key, colours, u, n, untapped, uids,
// free }], at: Map uid -> { stack, k, u, dv, dy, tapped }, tower: Map uid
// -> { stack, j, u, dv, y } } for the untapped lands. free: the untapped
// uids of the stack in tower order (the last one is the top token).
export function stackLayout(lands, o = {}) {
  const S = { ...STACK, ...o };
  const order = o.order || manaColours();
  const cardOf = o.card || (id => CARD[id]);
  const groups = new Map();
  for (const x of lands) {
    const card = cardOf(x.id);
    if (!card || card.type !== 'land') continue;
    const key = stackKey(card, order);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(x);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const ca = a === 'none' ? [] : a.split('+'), cb = b === 'none' ? [] : b.split('+');
    const ra = ca.length ? rank(order, ca[0]) : 1e4, rb = cb.length ? rank(order, cb[0]) : 1e4;
    return ra - rb || ca.length - cb.length || (a < b ? -1 : a > b ? 1 : 0);
  });
  const us = slots(keys.length, S.half, S.gap);
  const stacks = [], at = new Map(), tower = new Map();
  keys.forEach((key, si) => {
    const xs = groups.get(key), n = xs.length;
    const step = n > 1 ? Math.min(S.cascade, S.spread / (n - 1)) : 0;
    const free = [];
    xs.forEach((x, k) => {
      at.set(x.uid, { stack: si, k, u: us[si], dv: k * step, dy: k * S.lift, tapped: !!x.tapped });
      if (!x.tapped) free.push(x.uid);
    });
    free.forEach((uid, j) => tower.set(uid, { stack: si, j, u: us[si], dv: S.towerV, y: j * S.towerStep }));
    stacks.push({ key, colours: key === 'none' ? [] : key.split('+'), u: us[si], n, untapped: free.length, uids: xs.map(x => x.uid), free });
  });
  return { stacks, at, tower };
}

function hashKey(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
