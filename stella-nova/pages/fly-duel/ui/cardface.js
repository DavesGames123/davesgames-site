// ============================================================================
//  FLY DUEL  ·  card face and card back on a 2D canvas  (ES module)
// ----------------------------------------------------------------------------
//  This file is the one card renderer of the page. The 3D table, the
//  screensaver, the gallery, the deck lists, the hand and the inspector all
//  call drawCard(). ui/cardview.js puts drawCard() on a DOM canvas.
//
//  The card has the look of a classic fantasy trading card: a name bar with
//  the cost at the right, a painted picture, a type line, a rules box and a
//  power/toughness plate. The frame shape, the ornaments, the mana glyphs
//  and the card back are our own. The frame is an elytron plate: the two
//  top corners are cut at 45 degrees, the bottom corners are round.
//
//  Two levels of detail (opts.mode, or 'auto' from the CSS width):
//      full    name, cost, picture, type line, rules, flavour, stat plate,
//              credit. For 180 CSS px and wider.
//      thumb   name, cost, a tall picture, a type word and the stat plate,
//              in larger type. For narrower cards (120 px and up).
//  The default mode is 'full', so old callers draw what they drew before.
//
//  Colours. The colour data comes from game/cards.js: card.colour (one
//  key, an array, or keys joined by '/' or '+'), card.colours, the cost
//  keys and land.produces. An optional COLOURS export there can give a
//  name, a hex value and a glyph design per key. This file has no fixed
//  list of colours. A key with no entry gets a frame from its hex value,
//  or from a word match on its name, or from its place in the order.
//  Frame kinds:
//      <key>   one colour: the rim of that colour
//      gold    two or more colours: a gold rim, bars blend the colours
//      land    a land: an earth-brown rim, bars in the mana colour; a land
//              with two or more colours gets a split rim
//      none    colourless: grey stone
//
//  The pictures are public-domain plates (art/art.json, art/CREDITS-ART.md).
//  loadCardArt() loads one picture and keeps it in a cache. A card id with
//  no plate gets the procedural picture of ui/art.js. drawCard() draws the
//  cached picture, or a flat placeholder while the picture loads. Call
//  drawCard() again when the promise of loadCardArt() resolves.
//
//  The module has no DOM work at import time. node tests can call
//  drawCard() and cardBack() with a stub 2D context.
//
//  GREP MAP
//      grep -n 'export const ART_CREDIT'    id -> "artist, year"
//      grep -n 'export const ART_IDS'       ids that have a picture
//      grep -n 'export const SUBTYPE'       id -> subtype word
//      grep -n 'export function typeLine'   "Creature — Moth"
//      grep -n 'export const FRAME'         hand-set frame colours
//      grep -n 'export function colourOrder'   every colour key, in order
//      grep -n 'export function colourInfo'    key -> name, hex, glyph
//      grep -n 'export function cardColours'   card -> colour keys
//      grep -n 'export function frameKind'  card -> key|gold|land|none
//      grep -n 'export function frameOf'    the palette of one card
//      grep -n 'export function costList'   cost -> glyph list
//      grep -n 'export function manaValueOf'  total cost of a card
//      grep -n 'export function artURL'     picture URL for an id
//      grep -n 'export function loadArtIndex'  art/art.json, once
//      grep -n 'export function artCredit'  "Art: Dru Drury, 1770"
//      grep -n 'export function loadCardArt'   picture loader and cache
//      grep -n 'export function getCardArt'    cached picture or null
//      grep -n 'export function rulesRuns'  rules text as styled runs
//      grep -n 'export function drawManaGlyph' one mana glyph
//      grep -n 'export function cardMode'   auto -> thumb | full
//      grep -n 'export function drawCard'   the card face
//      grep -n 'function drawFull'          full layout
//      grep -n 'function drawThumb'         thumbnail layout
//      grep -n 'export function cardBack'   the card back
//      grep -n 'function elytronPath'       the frame outline
//      grep -n 'function layoutText'        word wrap with styled runs
// ============================================================================
import * as CM from '../game/cards.js';
import { cardArt } from './art.js';

const KEYWORDS = CM.KEYWORDS || {};

// id -> short credit "artist, year" for every card picture in art/cards/.
// It is a copy of art/art.json (artist, year), so a DOM card and a canvas
// card can show the credit without a fetch. tests/cards-art.test.mjs
// checks that the two agree.
export const ART_CREDIT = Object.freeze({
  "amber-ridge": "Albert Bierstadt, 1866",
  "moss-hollow": "Ernst Haeckel, 1904",
  "ember-gnat": "Robert Hooke, 1665",
  "cinder-ant": "John Lubbock, 1897",
  "dune-wasp": "Edward Saunders, 1892",
  "hive-soldier": "W. H. Lizars, 1840",
  "spark-hornet": "Edward Saunders, 1896",
  "ember-mantis": "W. H. Lizars, 1840",
  "brood-captain": "John Lubbock, 1897",
  "magma-beetle": "Dru Drury, 1770",
  "sun-locust": "W. H. Lizars, 1840",
  "sting-hopper": "W. H. Lizars, 1840",
  "flare-spit": "W. H. Lizars, 1840",
  "heat-pulse": "W. H. Lizars, 1840",
  "kiln-burst": "Joseph Wright of Derby, c. 1776",
  "war-chirp": "W. H. Lizars, 1840",
  "swarm-call": "John Lubbock, 1897",
  "root-sentinel": "Ivan Shishkin, 1865",
  "moss-snail": "Giovanna Garzoni, before 1670",
  "thorn-vine": "Flora Batava, 1893",
  "bark-toad": "A. J. Rösel von Rosenhof, 1758",
  "dew-moth": "Dru Drury, 1770",
  "briar-wall": "Pierre-Joseph Redouté, 1801",
  "spore-mother": "Anna Maria Hussey, 1847",
  "grove-stag": "Brehms Tierleben, 1884",
  "fern-beast": "Ernst Haeckel, 1904",
  "deep-roots": "Vincent van Gogh, 1890",
  "sap-bloom": "Johan Carl Krauss, 1802",
  "strangle-root": "John Ellis, 1769",
  "swell": "Anna Maria Hussey, 1847",
  "spore-burst": "J. B. F. P. Bulliard, 1780-1791",
  "drift-seed": "Walther Otto Müller, 1887",
  "hollow-husk": "James Dwight Dana, 1852",
  "ember-larva": "F. Nemos, 1895",
  "spore": "Ernst Haeckel, 1904",
});
export const ART_IDS = Object.freeze(Object.keys(ART_CREDIT));
const HAS_ART = new Set(ART_IDS);

// The word after the dash on the type line. It names what the picture
// shows. A card can also carry its own `subtype` field.
export const SUBTYPE = Object.freeze({
  'amber-ridge': 'Ridge', 'moss-hollow': 'Hollow',
  'ember-gnat': 'Gnat', 'cinder-ant': 'Ant', 'dune-wasp': 'Wasp', 'hive-soldier': 'Bee', 'spark-hornet': 'Hornet',
  'ember-mantis': 'Mantis', 'brood-captain': 'Ant', 'magma-beetle': 'Beetle', 'sun-locust': 'Locust',
  'sting-hopper': 'Hopper',
  'flare-spit': 'Venom', 'heat-pulse': 'Fever', 'kiln-burst': 'Eruption', 'war-chirp': 'Song', 'swarm-call': 'Signal',
  'root-sentinel': 'Oak', 'moss-snail': 'Snail', 'thorn-vine': 'Bramble', 'bark-toad': 'Toad', 'dew-moth': 'Moth',
  'briar-wall': 'Rose', 'spore-mother': 'Fungus', 'grove-stag': 'Beetle', 'fern-beast': 'Fern',
  'deep-roots': 'Growth', 'sap-bloom': 'Nectar', 'strangle-root': 'Snare', 'swell': 'Growth', 'spore-burst': 'Spores',
  'drift-seed': 'Seed', 'hollow-husk': 'Crab',
  'ember-larva': 'Larva', 'spore': 'Fungus',
});

const cap = s => { s = String(s || ''); return s ? s[0].toUpperCase() + s.slice(1) : s; };

export function typeLine(card) {
  if (!card) return '';
  const t = String(card.type || 'spell');
  const base = t === 'creature' ? 'Creature' : t === 'land' ? 'Land' : t === 'spell' ? 'Spell' : cap(t);
  const sub = card.subtype || SUBTYPE[card.id];
  return `${card.token ? 'Token ' : ''}${base}${sub ? ' — ' + sub : ''}`;
}

// ------------------------------------------------------------ colours
// Hand-set frames. rim0 -> rim1 is the vertical gradient of the rim.
export const FRAME = Object.freeze({
  amber: { rim0: '#e6a647', rim1: '#8f4a12', edge: '#2a1404', line: '#ffe2a6', bar: '#f6dca4', barEdge: '#7a3f0e',
    ink: '#2a1604', paper: '#f7e9cb', paperInk: '#2b1d0e', fleck: '#9a5a1c', soft: '#6a4a2a' },
  moss: { rim0: '#5d8f3a', rim1: '#1d3a17', edge: '#0b1608', line: '#cfe8a2', bar: '#d9e6b8', barEdge: '#2c4f22',
    ink: '#14200e', paper: '#eef0dc', paperInk: '#1d2616', fleck: '#4f7a34', soft: '#46553a' },
  none: { rim0: '#b3b6bd', rim1: '#565b65', edge: '#1b1d22', line: '#eef0f4', bar: '#e4e3de', barEdge: '#4a4e57',
    ink: '#1d1f24', paper: '#efede7', paperInk: '#25272c', fleck: '#7d828c', soft: '#4d5058' },
  land: { rim0: '#a27b4e', rim1: '#4c3320', edge: '#1e1309', line: '#f0dcb8', bar: '#ead7b2', barEdge: '#5a3e24',
    ink: '#24170b', paper: '#f1e5cc', paperInk: '#2a1e10', fleck: '#8a6a44', soft: '#5e4a34' },
  gold: { rim0: '#efcf74', rim1: '#7a5512', edge: '#21170a', line: '#fff0bf', bar: '#f3e2b0', barEdge: '#6e5016',
    ink: '#22180a', paper: '#f6ecd2', paperInk: '#2a200e', fleck: '#a8822e', soft: '#64512c' },
});

// Glyph designs. No design is a disc.
//   cell   a hexagon with a resin drop            leaf   a diamond with a leaf
//   wave   a pointed oval with two waves          moon   a pentagon with a crescent
//   spark  an octagon with a four-point star      flame  a tall shield with a flame
const DESIGNS = ['cell', 'leaf', 'wave', 'moon', 'spark', 'flame'];

// Known keys, then word matches for keys that game/cards.js may add.
const KNOWN = {
  amber: { name: 'Amber', hex: '#ffb347', deep: '#2b1604', glyph: 'cell', tex: 'bubbles' },
  moss: { name: 'Moss', hex: '#a8d65a', deep: '#14260a', glyph: 'leaf', tex: 'veins' },
};
const WORDS = [
  [/tide|brine|sea|rain|river|marsh|pond|frost|ice|mist|dew|wave|water|blue|azure|reef|stream|lake|silt/, { hex: '#6cb4ee', deep: '#0b1e33', glyph: 'wave', tex: 'ripples' }],
  [/dusk|night|shade|shadow|rot|venom|gloom|ash|bone|dark|void|black|murk|blight|grave|mould|mold|decay|carrion/, { hex: '#b49ae8', deep: '#1a1030', glyph: 'moon', tex: 'stars' }],
  [/sun|light|pollen|petal|bloom|silk|sky|dawn|day|white|bright|halo|ivory|wing|cloud|chalk|pearl/, { hex: '#f1ead2', deep: '#2a2618', glyph: 'spark', tex: 'rays' }],
  [/ember|flame|fire|cinder|blaze|red|ruby|rust|scarlet|lava|magma|heat|spark|forge|blood/, { hex: '#ff6a4a', deep: '#2e0b06', glyph: 'flame', tex: 'bubbles' }],
  [/moss|leaf|fern|grove|green|root|vine|bark|wood/, { hex: '#a8d65a', deep: '#14260a', glyph: 'leaf', tex: 'veins' }],
  [/amber|resin|honey|gold|wax|hive/, { hex: '#ffb347', deep: '#2b1604', glyph: 'cell', tex: 'bubbles' }],
];
const SPARE_HEX = ['#6cb4ee', '#b49ae8', '#f1ead2', '#ff6a4a', '#7fd3c0', '#e8a0c8'];
const NOT_A_COLOUR = new Set(['', 'none', 'colourless', 'colorless', 'generic', 'gold', 'multi', 'multicolour', 'multicolor', 'any', 'x']);

const lc = s => String(s ?? '').trim().toLowerCase();
function splitKeys(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(splitKeys);
  if (typeof v === 'object') return Object.entries(v).filter(([, n]) => n).map(([k]) => lc(k));
  return String(v).split(/[\s,+/&|]+/).map(lc).filter(Boolean);
}

// The COLOURS export of game/cards.js, as a map key -> entry. Accepts an
// object or an array of { key|id, ... }.
function colourTable() {
  const C = CM.COLOURS || CM.COLORS || null;
  if (!C) return {};
  if (Array.isArray(C)) return Object.fromEntries(C.map((e, i) => (typeof e === 'string' ? [lc(e), { order: i }] : [lc(e.key ?? e.id ?? e.name), { ...e, order: i }])));
  return Object.fromEntries(Object.entries(C).map(([k, e], i) => [lc(k), typeof e === 'object' && e ? { ...e, order: i } : { name: String(e), order: i }]));
}

let orderMemo = null;
// Every colour key, in order: the COLOURS export first, then the keys the
// cards use (card colours, cost keys, lands), in pool order.
export function colourOrder() {
  if (orderMemo) return orderMemo;
  const out = [];
  const add = k => { k = lc(k); if (!NOT_A_COLOUR.has(k) && !out.includes(k)) out.push(k); };
  Object.keys(colourTable()).forEach(add);
  for (const c of [...(CM.CARDS || []), ...(CM.TOKENS || [])]) {
    splitKeys(c.colours ?? c.colors ?? c.colour ?? c.color).forEach(add);
    Object.keys(c.cost || {}).forEach(add);
    splitKeys(c.produces).forEach(add);
  }
  orderMemo = out;
  return out;
}

const infoMemo = new Map();
// key -> { key, name, hex, deep, glyph, tex }.
export function colourInfo(key) {
  key = lc(key);
  if (infoMemo.has(key)) return infoMemo.get(key);
  const T = colourTable()[key] || {};
  let base = KNOWN[key] || null;
  if (!base) for (const [re, v] of WORDS) if (re.test(key)) { base = v; break; }
  const order = colourOrder();
  const i = Math.max(0, order.indexOf(key));
  if (!base) base = { hex: SPARE_HEX[i % SPARE_HEX.length], deep: '#141820', glyph: DESIGNS[(i + 2) % DESIGNS.length], tex: 'stone' };
  const hex = T.hex || T.ink || T.colour || T.color || base.hex;
  const glyph = DESIGNS.includes(T.glyph) ? T.glyph : base.glyph;
  const info = {
    key, name: T.name || base.name || cap(key), hex, deep: T.deep || base.deep || mix(hex, '#000000', 0.82),
    glyph, tex: T.texture || base.tex || 'stone',
  };
  infoMemo.set(key, info);
  return info;
}

// The colour keys of one card, in colourOrder(). A land takes its colours
// from what it produces. A card with no colour field takes its colours
// from the coloured parts of its cost.
export function cardColours(card) {
  if (!card) return [];
  let keys = splitKeys(card.colours ?? card.colors ?? card.colour ?? card.color);
  if (card.type === 'land') keys = [...keys, ...splitKeys(card.produces)];
  keys = keys.filter(k => !NOT_A_COLOUR.has(k));
  if (!keys.length && card.type !== 'land') keys = Object.entries(card.cost || {}).filter(([k, n]) => k !== 'generic' && (n | 0) > 0).map(([k]) => lc(k));
  const order = colourOrder();
  const uniq = [...new Set(keys)];
  return uniq.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
}

export function frameKind(card) {
  if (!card) return 'none';
  if (card.type === 'land') return 'land';
  const cs = cardColours(card);
  return cs.length === 0 ? 'none' : cs.length === 1 ? cs[0] : 'gold';
}

// --- small colour maths (hex <-> HSL) ---
function hexRGB(h) {
  h = String(h || '#888').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
function mix(a, b, t) { const A = hexRGB(a), B = hexRGB(b); return toHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }
function hsl(hex) {
  const [r, g, b] = hexRGB(hex).map(v => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function fromHSL(h, s, l) {
  s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return toHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

// A frame palette from one hex value. A light colour (a white, cream or
// pale yellow key) gets a pale rim with a dark edge.
function frameFromHex(hex) {
  const [h, s0, l0] = hsl(hex);
  const s = Math.max(0.25, s0);
  if (l0 > 0.68) {
    return { rim0: fromHSL(h, s * 0.45, 0.9), rim1: fromHSL(h, s * 0.2, 0.56), edge: fromHSL(h, 0.3, 0.1), line: '#ffffff',
      bar: fromHSL(h, s * 0.6, 0.92), barEdge: fromHSL(h, 0.25, 0.38), ink: fromHSL(h, 0.3, 0.1), paper: fromHSL(h, s * 0.5, 0.95),
      paperInk: fromHSL(h, 0.25, 0.13), fleck: fromHSL(h, 0.25, 0.5), soft: fromHSL(h, 0.15, 0.35) };
  }
  return { rim0: fromHSL(h, s * 0.8, 0.52), rim1: fromHSL(h, s * 0.75, 0.22), edge: fromHSL(h, 0.5, 0.07), line: fromHSL(h, 0.75, 0.85),
    bar: fromHSL(h, s * 0.55, 0.82), barEdge: fromHSL(h, s * 0.55, 0.27), ink: fromHSL(h, 0.5, 0.1), paper: fromHSL(h, s * 0.45, 0.92),
    paperInk: fromHSL(h, 0.3, 0.13), fleck: fromHSL(h, s * 0.5, 0.4), soft: fromHSL(h, 0.22, 0.33) };
}

const frameMemo = new Map();
function paletteOf(key) {
  if (FRAME[key]) return FRAME[key];
  if (!frameMemo.has(key)) frameMemo.set(key, Object.freeze(frameFromHex(colourInfo(key).hex)));
  return frameMemo.get(key);
}

// The palette of one card: { kind, F, colours, bars: [bar tints], rims:
// [[rim0, rim1]], tex }. bars has more than one entry for a gold card or
// a land with two or more colours; the bars blend those tints.
export function frameOf(card) {
  const kind = frameKind(card);
  const colours = cardColours(card);
  const F = kind === 'land' ? FRAME.land : paletteOf(kind);
  const tints = colours.map(k => paletteOf(k));
  let bars = [F.bar], rims = [[F.rim0, F.rim1]], tex = 'stone';
  if (kind === 'land') {
    tex = 'wood';
    if (tints.length) bars = tints.map(t => t.bar);
    if (tints.length > 1) rims = tints.map(t => [t.rim0, t.rim1]);
  } else if (kind === 'gold') {
    tex = 'filigree';
    bars = tints.map(t => t.bar);
  } else if (kind !== 'none') tex = colourInfo(kind).tex;
  return { kind, F, colours, bars, rims, tex };
}

// ------------------------------------------------------------ art loading
const BASE = new URL('../art/', import.meta.url);

export function artURL(id, { small = false } = {}) {
  return new URL(`cards/${id}${small ? '@sm' : ''}.jpg`, BASE).href;
}

let indexPromise = null;
let artIndex = null;
// art/art.json, fetched once. Resolves to {} when fetch is not there.
export function loadArtIndex() {
  if (indexPromise) return indexPromise;
  indexPromise = (typeof fetch === 'function'
    ? fetch(new URL('art.json', BASE).href).then(r => (r.ok ? r.json() : {})).catch(() => ({}))
    : Promise.resolve({})).then(j => (artIndex = j || {}));
  return indexPromise;
}
// Give the index directly (node tests, or a page that has it already).
export function setArtIndex(j) { artIndex = j || {}; indexPromise = Promise.resolve(artIndex); }

// True when the id has a plate picture (ART_CREDIT or art.json).
export function hasPlate(id) { return HAS_ART.has(id) || !!artIndex?.[id]?.file; }

// Short credit line for the foot of the card, or '' when unknown.
// art.json gives `artist` (short) and `author` (full).
export function artCredit(id) {
  const e = artIndex?.[id];
  if (e) return `Art: ${String(e.artist || e.author || '').split(/[;(]/)[0].trim()}${e.year ? ', ' + e.year : ''}`;
  return ART_CREDIT[id] ? `Art: ${ART_CREDIT[id]}` : '';
}

const artCache = new Map();   // key -> { promise, img }

// Load the picture of one card. Resolves to an ImageBitmap or an image
// element. A card with no plate gets the procedural SVG of ui/art.js.
// When nothing loads, resolves to a placeholder canvas (or null when
// there is no DOM).
export function loadCardArt(id, { small = false } = {}) {
  const key = `${id}${small ? '@sm' : ''}`;
  const hit = artCache.get(key);
  if (hit) return hit.promise;
  const rec = { img: null, promise: null };
  rec.promise = (async () => {
    loadArtIndex();
    if (!HAS_ART.has(id)) await loadArtIndex();
    let img = null;
    if (hasPlate(id)) {
      try {
        if (typeof fetch === 'function' && typeof createImageBitmap === 'function') {
          const r = await fetch(artURL(id, { small }));
          if (!r.ok) throw new Error(`art ${id}: ${r.status}`);
          img = await createImageBitmap(await r.blob());
        } else if (typeof Image === 'function') {
          img = await imageFrom(artURL(id, { small }));
        }
      } catch { img = null; }
    }
    if (!img && typeof Image === 'function') {
      const card = CM.CARD?.[id];
      if (card) {
        try { img = await imageFrom('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(cardArt(card, 'art').replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="280" '))); } catch { img = null; }
      }
    }
    if (!img) img = placeholderCanvas(id);
    rec.img = img;
    return img;
  })();
  artCache.set(key, rec);
  return rec.promise;
}

function imageFrom(src) {
  return new Promise((res, rej) => { const im = new Image(); im.decoding = 'async'; im.onload = () => res(im); im.onerror = rej; im.src = src; });
}

// The cached picture, or null while it loads. Prefers the large file.
export function getCardArt(id, { small = false } = {}) {
  const big = artCache.get(id)?.img, sm = artCache.get(`${id}@sm`)?.img;
  return (small ? sm || big : big || sm) || null;
}

function placeholderCanvas(id) {
  if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') return null;
  const cv = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(240, 180) : Object.assign(document.createElement('canvas'), { width: 240, height: 180 });
  const g = cv.getContext('2d');
  if (!g) return null;
  drawPlaceholder(g, 0, 0, 240, 180, id);
  return cv;
}

// ------------------------------------------------------------ helpers
// FNV-1a, then mulberry32. Same id, same texture.
function rngOf(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The elytron outline: top corners cut at 45 degrees (c), bottom corners
// round (r).
function elytronPath(g, x, y, w, h, c, r) {
  g.beginPath();
  g.moveTo(x + c, y);
  g.lineTo(x + w - c, y);
  g.lineTo(x + w, y + c);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + c);
  g.closePath();
}

// A bar with cut ends (name bar, type line, stat plate).
function barPath(g, x, y, w, h, cut) {
  g.beginPath();
  g.moveTo(x + cut, y);
  g.lineTo(x + w - cut, y);
  g.lineTo(x + w, y + h / 2);
  g.lineTo(x + w - cut, y + h);
  g.lineTo(x + cut, y + h);
  g.lineTo(x, y + h / 2);
  g.closePath();
}

function rectPath(g, x, y, w, h) { g.beginPath(); g.rect(x, y, w, h); }

// A fill over (x .. x + w): one colour, or a left-to-right blend with a
// hard-ish centre for two or more colours.
function hFill(g, cols, x, w, fallback) {
  if (cols.length < 2 || typeof g.createLinearGradient !== 'function') return cols[0] || fallback;
  const gr = g.createLinearGradient(x, 0, x + w, 0);
  if (!gr || !gr.addColorStop) return cols[0] || fallback;
  const n = cols.length;
  cols.forEach((c, i) => {
    const a = i / n, b = (i + 1) / n, e = 0.06 / n;
    gr.addColorStop(Math.max(0, a + (i ? e : 0)), c);
    gr.addColorStop(Math.min(1, b - (i < n - 1 ? e : 0)), c);
  });
  return gr;
}

// Paper fibres and flecks, clipped by the caller.
function paperTexture(g, x, y, w, h, F, rnd, u) {
  const n = Math.min(900, Math.round((w * h) / (u * u) / 9));
  g.save();
  for (let i = 0; i < n; i++) {
    const px = x + rnd() * w, py = y + rnd() * h;
    g.globalAlpha = 0.05 + rnd() * 0.07;
    g.fillStyle = rnd() < 0.7 ? F.fleck : '#ffffff';
    if (rnd() < 0.6) g.fillRect(px, py, u * (0.2 + rnd() * 0.25), u * (0.2 + rnd() * 0.25));
    else g.fillRect(px, py, u * (0.8 + rnd() * 2.2), Math.max(0.5, u * 0.12));
  }
  g.restore();
}

// Rim texture by kind: bubbles (resin), veins (leaf), ripples (water),
// stars (night), rays (light), filigree (gold), wood (land), stone.
function rimTexture(g, x, y, w, h, tex, F, rnd, u) {
  g.save();
  g.lineWidth = Math.max(0.6, u * 0.18);
  const A = () => 0.12 + rnd() * 0.14;
  if (tex === 'wood') {
    for (let i = 0; i < 26; i++) {
      const yy = y + rnd() * h;
      g.globalAlpha = A(); g.strokeStyle = rnd() < 0.5 ? F.edge : F.line;
      g.beginPath(); g.moveTo(x, yy);
      g.bezierCurveTo(x + w * 0.3, yy + (rnd() - 0.5) * 3 * u, x + w * 0.7, yy + (rnd() - 0.5) * 3 * u, x + w, yy + (rnd() - 0.5) * 2 * u);
      g.stroke();
    }
  } else if (tex === 'veins') {
    for (let i = 0; i < 34; i++) {
      const px = x + rnd() * w, py = y + rnd() * h, a = rnd() * Math.PI * 2, l = u * (1.5 + rnd() * 3);
      g.globalAlpha = A(); g.strokeStyle = rnd() < 0.5 ? F.line : F.edge;
      g.beginPath(); g.moveTo(px, py); g.quadraticCurveTo(px + Math.cos(a + 0.6) * l * 0.6, py + Math.sin(a + 0.6) * l * 0.6, px + Math.cos(a) * l, py + Math.sin(a) * l); g.stroke();
    }
  } else if (tex === 'bubbles') {
    for (let i = 0; i < 46; i++) {
      const px = x + rnd() * w, py = y + rnd() * h, rr = u * (0.15 + rnd() * 0.55);
      g.globalAlpha = A(); g.fillStyle = rnd() < 0.6 ? F.line : F.edge;
      g.beginPath(); g.arc(px, py, rr, 0, Math.PI * 2); g.fill();
    }
  } else if (tex === 'ripples') {
    for (let i = 0; i < 30; i++) {
      const px = x + rnd() * w, py = y + rnd() * h, l = u * (2 + rnd() * 4);
      g.globalAlpha = A(); g.strokeStyle = rnd() < 0.6 ? F.line : F.edge;
      g.beginPath(); g.moveTo(px - l, py); g.quadraticCurveTo(px - l / 2, py - u * 0.8, px, py); g.quadraticCurveTo(px + l / 2, py + u * 0.8, px + l, py); g.stroke();
    }
  } else if (tex === 'stars') {
    for (let i = 0; i < 60; i++) {
      const px = x + rnd() * w, py = y + rnd() * h, s = u * (0.12 + rnd() * 0.35);
      g.globalAlpha = 0.15 + rnd() * 0.3; g.fillStyle = rnd() < 0.7 ? F.line : F.edge;
      g.fillRect(px - s, py - s * 0.25, s * 2, s * 0.5); g.fillRect(px - s * 0.25, py - s, s * 0.5, s * 2);
    }
  } else if (tex === 'rays') {
    const cx = x + w / 2, cy = y + h * 0.4;
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 + rnd() * 0.05;
      g.globalAlpha = 0.08 + rnd() * 0.08; g.strokeStyle = i % 2 ? F.line : F.edge;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * w * 0.3, cy + Math.sin(a) * w * 0.3); g.lineTo(cx + Math.cos(a) * w, cy + Math.sin(a) * w); g.stroke();
    }
  } else if (tex === 'filigree') {
    const s = 4 * u;
    for (let yy = y + s / 2, row = 0; yy < y + h; yy += s, row++) {
      for (let xx = x + (row & 1 ? s / 2 : 0); xx < x + w; xx += s) {
        g.globalAlpha = 0.1 + rnd() * 0.08; g.strokeStyle = (row + Math.round(xx)) & 1 ? F.line : F.edge;
        g.beginPath(); g.moveTo(xx, yy - s * 0.32); g.lineTo(xx + s * 0.32, yy); g.lineTo(xx, yy + s * 0.32); g.lineTo(xx - s * 0.32, yy); g.closePath(); g.stroke();
      }
    }
  } else {
    for (let i = 0; i < 160; i++) {
      g.globalAlpha = 0.08 + rnd() * 0.12; g.fillStyle = rnd() < 0.5 ? F.edge : F.line;
      g.fillRect(x + rnd() * w, y + rnd() * h, u * (0.2 + rnd() * 0.5), u * (0.2 + rnd() * 0.4));
    }
  }
  g.restore();
}

// A small corner ornament: a wing-vein curl. (x, y) is the corner, sx and
// sy are +1 or -1 and point into the corner.
function curl(g, x, y, sx, sy, s) {
  g.beginPath();
  g.moveTo(x - sx * s * 2.6, y);
  g.quadraticCurveTo(x, y, x, y - sy * s * 2.6);
  g.moveTo(x - sx * s * 1.4, y - sy * s * 0.2);
  g.bezierCurveTo(x - sx * s * 0.6, y - sy * s * 0.6, x - sx * s * 0.3, y - sy * s * 1.0, x - sx * s * 0.2, y - sy * s * 1.4);
  g.stroke();
}

// ------------------------------------------------------------ mana glyphs
const GENERIC = { fill: '#dcdad3', edge: '#5d616b' };
const SERIF = "'STIX Two Text','Times New Roman',Georgia,serif";
const SANS = "Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";

// One mana glyph in the box (x, y, s, s). kind: a colour key or
// 'generic' (with the number n). The design comes from colourInfo().
export function drawManaGlyph(g, kind, x, y, s, n = 0) {
  const k = s / 20;
  const P = (px, py) => [x + px * k, y + py * k];
  const poly = pts => { g.beginPath(); pts.forEach((p, i) => { const [a, b] = P(...p); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.closePath(); };
  g.save();
  g.lineJoin = 'round';
  if (kind === 'generic' || !kind || NOT_A_COLOUR.has(lc(kind))) {
    const r = 3.6 * k, [x0, y0] = P(1.6, 1.6), w = 16.8 * k;
    g.beginPath();
    g.moveTo(x0 + r, y0); g.lineTo(x0 + w - r, y0); g.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
    g.lineTo(x0 + w, y0 + w - r); g.quadraticCurveTo(x0 + w, y0 + w, x0 + w - r, y0 + w);
    g.lineTo(x0 + r, y0 + w); g.quadraticCurveTo(x0, y0 + w, x0, y0 + w - r);
    g.lineTo(x0, y0 + r); g.quadraticCurveTo(x0, y0, x0 + r, y0); g.closePath();
    g.fillStyle = GENERIC.fill; g.fill(); g.lineWidth = 1.4 * k; g.strokeStyle = GENERIC.edge; g.stroke();
    g.fillStyle = '#1d1f24'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `600 ${Math.round(12.5 * k * 10) / 10}px ${SERIF}`;
    g.fillText(String(n | 0), x + 10 * k, y + 10.8 * k);
    g.restore();
    return;
  }
  const I = colourInfo(kind), hex = I.hex, deep = I.deep;
  const shell = (lw) => { g.fillStyle = deep; g.fill(); g.lineWidth = lw * k; g.strokeStyle = hex; g.stroke(); };
  switch (I.glyph) {
    case 'cell': {
      poly([[10, 1.2], [17.7, 5.6], [17.7, 14.4], [10, 18.8], [2.3, 14.4], [2.3, 5.6]]); shell(1.6);
      g.beginPath();
      g.moveTo(...P(10, 4.8));
      g.bezierCurveTo(...P(12.4, 8.1), ...P(13.6, 10.1), ...P(13.6, 11.7));
      g.bezierCurveTo(...P(13.6, 13.8), ...P(12, 15.3), ...P(10, 15.3));
      g.bezierCurveTo(...P(8, 15.3), ...P(6.4, 13.8), ...P(6.4, 11.7));
      g.bezierCurveTo(...P(6.4, 10.1), ...P(7.6, 8.1), ...P(10, 4.8));
      g.closePath(); g.fillStyle = hex; g.fill();
      g.fillStyle = '#fff3d0'; g.fillRect(...P(8.2, 10.6), 1.4 * k, 1.4 * k);
      break;
    }
    case 'leaf': {
      poly([[10, 1], [19, 10], [10, 19], [1, 10]]); shell(1.5);
      g.beginPath();
      g.moveTo(...P(6.2, 13.8));
      g.bezierCurveTo(...P(6.2, 9.4), ...P(9.2, 6.6), ...P(13.6, 6.4));
      g.bezierCurveTo(...P(13.8, 10.8), ...P(10.9, 13.7), ...P(6.2, 13.8));
      g.closePath(); g.fillStyle = hex; g.fill();
      g.beginPath(); g.moveTo(...P(6.7, 13.3)); g.lineTo(...P(12.6, 7.4)); g.lineWidth = 1 * k; g.strokeStyle = deep; g.stroke();
      break;
    }
    case 'wave': {
      g.beginPath(); g.moveTo(...P(10, 1)); g.bezierCurveTo(...P(17, 5), ...P(17, 15), ...P(10, 19)); g.bezierCurveTo(...P(3, 15), ...P(3, 5), ...P(10, 1)); g.closePath(); shell(1.5);
      g.lineWidth = 1.7 * k; g.strokeStyle = hex; g.lineCap = 'round';
      for (const yy of [8.2, 12.4]) { g.beginPath(); g.moveTo(...P(6, yy)); g.quadraticCurveTo(...P(8, yy - 2), ...P(10, yy)); g.quadraticCurveTo(...P(12, yy + 2), ...P(14, yy)); g.stroke(); }
      break;
    }
    case 'moon': {
      poly([[10, 1.2], [18.6, 7.4], [15.3, 18], [4.7, 18], [1.4, 7.4]]); shell(1.5);
      g.beginPath(); g.arc(...P(10, 11), 4.6 * k, 0, Math.PI * 2); g.fillStyle = hex; g.fill();
      g.beginPath(); g.arc(...P(12.2, 9.6), 3.9 * k, 0, Math.PI * 2); g.fillStyle = deep; g.fill();
      break;
    }
    case 'spark': {
      const o = [];
      for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i * Math.PI) / 4; o.push([10 + Math.cos(a) * 9, 10 + Math.sin(a) * 9]); }
      poly(o); shell(1.4);
      poly([[10, 3.6], [11.4, 8.6], [16.4, 10], [11.4, 11.4], [10, 16.4], [8.6, 11.4], [3.6, 10], [8.6, 8.6]]);
      g.fillStyle = hex; g.fill();
      break;
    }
    case 'flame':
    default: {
      g.beginPath(); g.moveTo(...P(10, 1)); g.lineTo(...P(17.5, 4.5)); g.lineTo(...P(16.5, 12)); g.quadraticCurveTo(...P(14, 17), ...P(10, 19.2)); g.quadraticCurveTo(...P(6, 17), ...P(3.5, 12)); g.lineTo(...P(2.5, 4.5)); g.closePath(); shell(1.5);
      g.beginPath(); g.moveTo(...P(10, 4.6));
      g.bezierCurveTo(...P(13.8, 8.4), ...P(14, 11.4), ...P(12.6, 13.8));
      g.bezierCurveTo(...P(11.6, 15.4), ...P(8.4, 15.4), ...P(7.4, 13.8));
      g.bezierCurveTo(...P(6.4, 12), ...P(7.4, 10.2), ...P(8.6, 9.4));
      g.bezierCurveTo(...P(8.8, 10.8), ...P(9.6, 11.4), ...P(10.2, 11.2));
      g.bezierCurveTo(...P(10.8, 9.2), ...P(10.6, 7), ...P(10, 4.6));
      g.closePath(); g.fillStyle = hex; g.fill();
      break;
    }
  }
  g.restore();
}

// Glyph list for a cost: generic first (one numbered glyph), then each
// colour in colourOrder(), one glyph per mana.
export function costList(cost) {
  const out = [];
  if (!cost) return out;
  if ((cost.generic | 0) > 0) out.push(['generic', cost.generic | 0]);
  const order = colourOrder();
  const keys = Object.keys(cost).filter(k => k !== 'generic').sort((a, b) => (order.indexOf(lc(a)) + 1 || 99) - (order.indexOf(lc(b)) + 1 || 99));
  for (const key of keys) for (let i = 0; i < Math.min(9, cost[key] | 0); i++) out.push([lc(key), 0]);
  return out;
}

// Total cost of a card (every cost key).
export function manaValueOf(card) {
  return Object.values(card?.cost || {}).reduce((s, v) => s + (v | 0), 0);
}

// ------------------------------------------------------------ rules text
const KW_LIST = () => Object.keys(KEYWORDS);
function kwRe() { const ks = KW_LIST(); return ks.length ? new RegExp(`^(${ks.join('|')})\\.$`, 'i') : /^$/; }

// The rules text of a card as runs { t, s } with s = 'r' (roman), 'b'
// (bold keyword), 'i' (italic reminder) or 'd' (dice text such as 2d4 or
// d20, drawn bold in a small die outline). A card whose text is only
// keywords gets the reminder text in italic, as a classic card does.
// Flavour line of a token that has none: what a token is.
export const TOKEN_NOTE = 'Made by an effect. It never goes to a hand or a graveyard.';

export function rulesRuns(card) {
  const text = String(card?.text || '').trim();
  if (!text) return [];
  const KW_RE = kwRe();
  const parts = text.split(/(?<=\.)\s+/);
  const onlyKw = parts.every(p => KW_RE.test(p));
  const runs = [];
  parts.forEach((p, i) => {
    if (i) runs.push({ t: ' ', s: 'r' });
    if (KW_RE.test(p)) {
      const name = p.replace('.', '');
      runs.push({ t: onlyKw ? name : p, s: 'b' });
      if (onlyKw) {
        const rem = String(KEYWORDS[name.toLowerCase()] || '').replace(/^[^:]*:\s*/, '').replace(/\.$/, '');
        runs.push({ t: rem ? ` (${rem}.)` : '.', s: 'i' });
      }
    } else if (/^Tap:/.test(p)) {
      runs.push({ t: 'Tap:', s: 'b' }, { t: p.slice(4), s: 'r' });
    } else runs.push({ t: p, s: 'r' });
  });
  // dice text in a roman run: its own 'd' run
  const out = [];
  for (const r of runs) {
    if (r.s !== 'r' || !DICE_RE.test(r.t)) { out.push(r); continue; }
    for (const bit of r.t.split(DICE_SPLIT)) if (bit) out.push({ t: bit, s: DICE_RE.test(bit) && DICE_WHOLE.test(bit) ? 'd' : 'r' });
  }
  return out;
}
const DICE_RE = /\b\d*d(?:4|6|8|10|12|20)\b/;
const DICE_SPLIT = /(\b\d*d(?:4|6|8|10|12|20)\b)/;
const DICE_WHOLE = /^\d*d(?:4|6|8|10|12|20)$/;

// The die outline behind a 'd' run: a rounded square, open ink.
function diceChip(g, x, y, w, px, ink) {
  const pad = px * 0.22, h = px * 1.08, r = px * 0.22;
  const x0 = x - pad, y0 = y - px * 0.86, ww = w + pad * 2;
  g.save();
  g.strokeStyle = ink; g.globalAlpha = 0.7; g.lineWidth = Math.max(0.5, px * 0.09);
  g.beginPath();
  g.moveTo(x0 + r, y0); g.lineTo(x0 + ww - r, y0); g.quadraticCurveTo(x0 + ww, y0, x0 + ww, y0 + r);
  g.lineTo(x0 + ww, y0 + h - r); g.quadraticCurveTo(x0 + ww, y0 + h, x0 + ww - r, y0 + h);
  g.lineTo(x0 + r, y0 + h); g.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  g.lineTo(x0, y0 + r); g.quadraticCurveTo(x0, y0, x0 + r, y0);
  g.closePath(); g.stroke();
  g.restore();
}

function fontFor(s, px) {
  const sz = Math.round(px * 10) / 10;
  return s === 'b' || s === 'd' ? `600 ${sz}px ${SERIF}` : s === 'i' ? `italic 400 ${sz}px ${SERIF}` : `400 ${sz}px ${SERIF}`;
}

// Word wrap for styled runs. paragraphs: [[run...], ...]. Returns lines
// [{ y, items: [{ x, t, s }] , para }] and the total height.
function layoutText(g, paragraphs, width, px, gap) {
  const lines = [];
  const lh = px * 1.22;
  let y = 0;
  paragraphs.forEach((runs, pi) => {
    if (pi) y += gap;
    let line = { y, items: [], para: pi, w: 0 };
    let x = 0;
    const words = [];
    for (const r of runs) {
      const bits = r.t.split(/(\s+)/).filter(Boolean);
      for (const b of bits) words.push({ t: b, s: r.s });
    }
    for (const wd of words) {
      g.font = fontFor(wd.s, px);
      const ww = g.measureText(wd.t).width;
      const isSpace = /^\s+$/.test(wd.t);
      if (!isSpace && x + ww > width && x > 0) {
        lines.push(line); y += lh; x = 0;
        line = { y, items: [], para: pi, w: 0 };
      }
      if (isSpace && x === 0) continue;
      line.items.push({ x, t: wd.t, s: wd.s });
      x += ww; line.w = x;
    }
    lines.push(line); y += lh;
  });
  return { lines, height: y };
}

// Fit one line of text in maxW: shrink down to minPx, then cut with an
// ellipsis. Returns { text, px }.
function fitLine(g, text, weight, px, minPx, maxW) {
  g.font = `${weight} ${px}px ${SERIF}`;
  for (let i = 0; i < 12 && px > minPx && g.measureText(text).width > maxW; i++) { px = Math.max(minPx, px * 0.93); g.font = `${weight} ${px}px ${SERIF}`; }
  let t = text;
  while (t.length > 3 && g.measureText(t).width > maxW) t = t.slice(0, -1);
  if (t !== text) t = t.replace(/\s+$/, '') + '…';
  return { text: t, px };
}

// ------------------------------------------------------------ placeholder
function drawPlaceholder(g, x, y, w, h, id) {
  const card = CM.CARD?.[id] || { id };
  const { F } = frameOf(card);
  g.save();
  g.fillStyle = F.rim1; g.fillRect(x, y, w, h);
  g.strokeStyle = F.line; g.globalAlpha = 0.35; g.lineWidth = Math.max(1, w / 160);
  const rnd = rngOf(String(id));
  for (let i = 0; i < 7; i++) {
    g.beginPath();
    g.moveTo(x + w * 0.5, y + h * 0.95);
    g.bezierCurveTo(x + w * (0.2 + rnd() * 0.6), y + h * 0.6, x + w * (0.1 + rnd() * 0.8), y + h * 0.3, x + w * (0.1 + rnd() * 0.8), y + h * (0.08 + rnd() * 0.2));
    g.stroke();
  }
  g.restore();
}

// Cover-fit a picture in a box.
function drawCover(g, img, x, y, w, h) {
  const iw = img.width || img.naturalWidth || 1, ih = img.height || img.naturalHeight || 1;
  const s = Math.max(w / iw, h / ih);
  const sw = w / s, sh = h / s;
  g.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

// ------------------------------------------------------------ the card face
// Below this CSS width, mode 'auto' draws the thumbnail.
export const THUMB_BELOW = 180;

export function cardMode(mode, w, dpr = 1) {
  if (mode === 'thumb' || mode === 'full') return mode;
  if (mode === 'auto') return w / Math.max(1, dpr || 1) < THUMB_BELOW ? 'thumb' : 'full';
  return 'full';
}

// Draw one card face in the box (x, y, w, h) of ctx. The card keeps the
// 5:7 shape and is centred in the box.
// opts.mode: 'full' (default), 'thumb', or 'auto' (by w / opts.dpr).
// opts.state (all optional):
//   tapped     art dims, a hatch band crosses the art
//   sick       a dashed ring inside the rim (entered this turn)
//   attacking  a 2-unit red ring
//   blocking   a 2-unit white ring
//   hot        a 1-unit white ring (just changed)
//   dead       grey veil and a diagonal stroke
//   damage     damage marked this turn (a red cell on the stat plate)
//   pp, pt     pump this turn (+power, +toughness)
//   dim        a dark veil (a card you cannot play now)
// opts.art: a picture to use instead of the cache.
export function drawCard(ctx, card, { w = 300, h = 420, state = {}, art = null, x: ox = 0, y: oy = 0, mode = 'full', dpr = 1 } = {}) {
  const g = ctx;
  const u = Math.min(w / 100, h / 140);
  const W = 100 * u, H = 140 * u;
  const x0 = ox + (w - W) / 2, y0 = oy + (h - H) / 2;
  const L = {
    g, card, u, W, H, x0, y0, X: v => x0 + v * u, Y: v => y0 + v * u,
    id: String(card?.id ?? 'unknown'), st: state || {}, fr: frameOf(card),
  };
  L.F = L.fr.F;
  L.rnd = rngOf(L.id);
  L.pic = art || getCardArt(L.id, { small: w < 260 * Math.max(1, dpr || 1) && W < 420 });
  g.save();
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  drawRim(L);
  if (cardMode(mode, w, dpr) === 'thumb') drawThumb(L); else drawFull(L);
  drawStateMarks(L);
  g.restore();
}

// Outline, rim (one colour, or split for a land with two colours), the
// rim texture and the inner ornament line.
function drawRim(L) {
  const { g, x0, y0, W, H, u, X, Y, F, fr, rnd } = L;
  elytronPath(g, x0, y0, W, H, 7 * u, 5 * u);
  g.fillStyle = F.edge; g.fill();
  elytronPath(g, X(0.8), Y(0.8), W - 1.6 * u, H - 1.6 * u, 6.6 * u, 4.4 * u);
  const canGrad = typeof g.createLinearGradient === 'function';
  if (fr.rims.length > 1 && canGrad) {
    g.fillStyle = hFill(g, fr.rims.map(r => r[0]), x0, W, F.rim0); g.fill();
    const shade = g.createLinearGradient(x0, y0, x0, y0 + H);
    if (shade && shade.addColorStop) { shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,0.5)'); g.fillStyle = shade; g.fill(); }
  } else {
    const grad = canGrad ? g.createLinearGradient(x0, y0, x0, y0 + H) : null;
    if (grad && grad.addColorStop) { grad.addColorStop(0, F.rim0); grad.addColorStop(1, F.rim1); g.fillStyle = grad; } else g.fillStyle = F.rim0;
    g.fill();
  }
  g.save(); g.clip(); rimTexture(g, x0, y0, W, H, fr.tex, F, rnd, u); g.restore();
  elytronPath(g, X(2.6), Y(2.6), W - 5.2 * u, H - 5.2 * u, 5.6 * u, 3.4 * u);
  g.lineWidth = Math.max(0.6, 0.35 * u); g.strokeStyle = F.line; g.globalAlpha = 0.75; g.stroke(); g.globalAlpha = 1;
}

// A bar (name, type, stat): fill (blended for two or more colours), paper
// texture, rim stroke.
function bar(L, x, y, w, h, cut, fills) {
  const { g, F, u, rnd } = L;
  barPath(g, x, y, w, h, cut);
  g.fillStyle = hFill(g, fills || L.fr.bars, x, w, F.bar); g.fill();
  g.save(); g.clip(); paperTexture(g, x, y, w, h, F, rnd, u); g.restore();
  g.lineWidth = Math.max(0.8, 0.45 * u); g.strokeStyle = F.barEdge; g.stroke();
}

// The cost glyphs, right-aligned at xr. Returns the left edge.
function costRow(L, xr, y, gs) {
  const glyphs = costList(L.card?.cost);
  const gGap = gs * 0.08;
  let gx = xr - glyphs.length * (gs + gGap) + gGap;
  const left = gx;
  for (const [k, n] of glyphs) { drawManaGlyph(L.g, k, gx, y, gs, n); gx += gs + gGap; }
  return glyphs.length ? left : xr;
}

// The picture in (ax, ay, aw, ah), with the tapped hatch and a thin line.
function picture(L, ax, ay, aw, ah) {
  const { g, F, u, st, pic, id } = L;
  g.fillStyle = F.edge; g.fillRect(ax - 0.7 * u, ay - 0.7 * u, aw + 1.4 * u, ah + 1.4 * u);
  g.save();
  rectPath(g, ax, ay, aw, ah); g.clip();
  if (pic) {
    if (st.tapped) g.globalAlpha = 0.5;
    drawCover(g, pic, ax, ay, aw, ah);
    g.globalAlpha = 1;
  } else drawPlaceholder(g, ax, ay, aw, ah, id);
  if (st.tapped) {
    g.strokeStyle = F.edge; g.globalAlpha = 0.55; g.lineWidth = 2 * u;
    for (let i = -2; i <= 2; i++) { const cx = ax + aw * 0.5 + i * 3.2 * u; g.beginPath(); g.moveTo(cx - ah * 0.5, ay + ah); g.lineTo(cx + ah * 0.5, ay); g.stroke(); }
    g.globalAlpha = 1;
  }
  g.restore();
  g.lineWidth = Math.max(0.6, 0.3 * u); g.strokeStyle = F.line; g.globalAlpha = 0.6;
  g.strokeRect(ax + 0.5 * u, ay + 0.5 * u, aw - 1 * u, ah - 1 * u); g.globalAlpha = 1;
}

// The stat plate at (sx, sy, sw, sh). The damage cell goes to its left,
// or on top of it (above = true, the thumbnail).
function statPlate(L, sx, sy, sw, sh, fontU, above = false) {
  const { g, F, u, st, card } = L;
  const pp = st.pp | 0, pt = st.pt | 0;
  const pw = (card.power ?? 0) + pp, tw = (card.toughness ?? 0) + pt;
  barPath(g, sx, sy, sw, sh, 1.8 * u);
  g.fillStyle = F.edge; g.fill();
  barPath(g, sx + 0.6 * u, sy + 0.6 * u, sw - 1.2 * u, sh - 1.2 * u, 1.5 * u);
  g.fillStyle = F.bar; g.fill();
  g.save(); g.clip(); paperTexture(g, sx, sy, sw, sh, F, L.rnd, u); g.restore();
  if (pp || pt) { g.lineWidth = Math.max(1, 0.5 * u); g.strokeStyle = '#1d1f24'; g.stroke(); }
  g.font = `600 ${fontU * u}px ${SERIF}`;
  g.fillStyle = F.ink; g.textAlign = 'center';
  g.fillText(`${pw}/${tw}`, sx + sw / 2, sy + sh * 0.72);
  g.textAlign = 'left';
  const dmg = st.damage | 0;
  if (dmg > 0) {
    const cw = sh * 0.9, ch = sh - 1.6 * u;
    const cx = above ? sx + sw - cw - 2 * u : sx - cw - 1 * u, cy = above ? sy - ch - 0.6 * u : sy + 0.8 * u;
    g.fillStyle = '#05070c'; g.fillRect(cx - 0.5 * u, cy - 0.5 * u, cw + u, ch + u);
    g.fillStyle = '#ff4d4d'; g.fillRect(cx, cy, cw, ch);
    g.fillStyle = '#05070c'; g.textAlign = 'center'; g.font = `700 ${fontU * 0.84 * u}px ${SANS}`;
    g.fillText(`−${dmg}`, cx + cw / 2, cy + ch * 0.74); g.textAlign = 'left';
  }
}

// The mana glyphs a land makes, centred at (cx, y), each s units.
function landGlyphs(L, cx, y, s) {
  const ks = L.fr.colours.length ? L.fr.colours : ['generic'];
  const gap = s * 0.25, tot = ks.length * s + (ks.length - 1) * gap;
  ks.forEach((k, i) => drawManaGlyph(L.g, k, cx - tot / 2 + i * (s + gap), y, s, 1));
}

// ---- full layout (180 CSS px and wider)
function drawFull(L) {
  const { g, card, u, X, Y, F, id } = L;
  // 1. name bar and cost
  bar(L, X(4.5), Y(4.6), 91 * u, 10 * u, 2.2 * u);
  const costLeft = costRow(L, X(93), Y(6.3), 6.6 * u);
  const nm = fitLine(g, String(card?.name ?? '?'), 500, 5.8 * u, 3.6 * u, costLeft - X(8) - 1.5 * u);
  g.font = `500 ${nm.px}px ${SERIF}`;
  g.fillStyle = F.ink; g.fillText(nm.text, X(8), Y(11.6));

  // 2. picture (4:3) and corner curls
  const ax = X(6.5), ay = Y(16.2), aw = 87 * u, ah = 65.25 * u;
  picture(L, ax, ay, aw, ah);
  g.strokeStyle = F.line; g.lineWidth = Math.max(0.6, 0.3 * u); g.globalAlpha = 0.85;
  curl(g, ax - 0.9 * u, ay + ah + 0.9 * u, -1, -1, 1.2 * u);
  curl(g, ax + aw + 0.9 * u, ay + ah + 0.9 * u, 1, -1, 1.2 * u);
  g.globalAlpha = 1;

  // 3. type line, with the colour pips of a gold card at the right
  bar(L, X(4.5), Y(82.8), 91 * u, 8.6 * u, 2 * u);
  const pips = L.fr.kind === 'gold' ? L.fr.colours : [];
  const pipS = 5 * u, pipRight = X(92.5);
  pips.forEach((k, i) => drawManaGlyph(g, k, pipRight - (pips.length - i) * (pipS + 0.6 * u), Y(84.6), pipS, 0));
  const tl = fitLine(g, typeLine(card), 500, 4.7 * u, 3.2 * u, (pips.length ? 80 - pips.length * 5.6 : 82) * u);
  g.font = `500 ${tl.px}px ${SERIF}`;
  g.fillStyle = F.ink; g.fillText(tl.text, X(8), Y(88.6));

  // 4. rules box
  const bx = X(7.2), by = Y(92.8), bw = 85.6 * u, bh = 38.6 * u;
  g.fillStyle = F.edge; g.fillRect(bx - 0.5 * u, by - 0.5 * u, bw + 1 * u, bh + 1 * u);
  g.fillStyle = F.paper; g.fillRect(bx, by, bw, bh);
  g.save(); rectPath(g, bx, by, bw, bh); g.clip(); paperTexture(g, bx, by, bw, bh, F, L.rnd, u); g.restore();

  const isCreature = card?.type === 'creature';
  const isLand = card?.type === 'land';
  const padX = 2.6 * u, padY = 2.4 * u;
  const textW = bw - padX * 2;
  const textH = bh - padY * 2 - (isCreature ? 3.2 * u : 0);
  if (isLand) landGlyphs(L, bx + bw / 2, by + 3 * u, 14 * u);
  const rules = rulesRuns(card);
  const paras = [];
  if (rules.length) paras.push(rules);
  const flav = String(card?.flavour || '').trim() || (card?.token ? TOKEN_NOTE : '');
  if (flav) paras.push([{ t: flav, s: 'i' }]);
  if (paras.length) {
    let px = 4.6 * u, lay;
    const topSpace = isLand ? 18 * u : 0;
    const avail = textH - topSpace;
    for (let i = 0; i < 14; i++) {
      lay = layoutText(g, paras, textW, px, px * 0.75);
      if (lay.height <= avail || px < 2.9 * u) break;
      px *= 0.94;
    }
    // centre the block in the free space (classic cards centre short text)
    const ty0 = by + padY + topSpace + Math.max(0, (avail - lay.height) / 2) + px * 0.92;
    const hasRules = rules.length > 0;
    for (const ln of lay.lines) {
      const isFlav = hasRules ? ln.para === 1 : true;
      const dx = isFlav && !hasRules ? (textW - ln.w) / 2 : 0;
      for (const it of ln.items) {
        g.font = fontFor(it.s, px);
        g.fillStyle = isFlav ? F.soft : F.paperInk;
        if (it.s === 'd') diceChip(g, bx + padX + dx + it.x, ty0 + ln.y, g.measureText(it.t).width, px, F.paperInk);
        g.fillText(it.t, bx + padX + dx + it.x, ty0 + ln.y);
      }
    }
    if (hasRules && flav) {
      const first = lay.lines.find(l => l.para === 1);
      if (first) {
        const ly = ty0 + first.y - px * 1.05;
        g.strokeStyle = F.fleck; g.globalAlpha = 0.5; g.lineWidth = Math.max(0.5, 0.2 * u);
        g.beginPath(); g.moveTo(bx + bw * 0.3, ly); g.lineTo(bx + bw * 0.7, ly); g.stroke(); g.globalAlpha = 1;
      }
    }
  }

  // 5. stat plate
  if (isCreature) statPlate(L, X(72), Y(127.4), 22.5 * u, 9.4 * u, 6.2);

  // 6. foot: illustrator credit
  const credit = artCredit(id);
  if (credit) {
    g.font = `400 ${2.5 * u}px ${SANS}`;
    g.fillStyle = F.line; g.globalAlpha = 0.9;
    let c = credit;
    const maxW = (isCreature ? 62 : 86) * u;
    while (c.length > 8 && g.measureText(c).width > maxW) c = c.slice(0, -2);
    if (c !== credit) c = c.replace(/\s+\S*$/, '') + '…';
    g.fillText(c, X(7.5), Y(135.6));
    g.globalAlpha = 1;
  }
}

// ---- thumbnail layout (narrower than 180 CSS px): large name and cost, a
// tall picture, a type word and a large stat plate.
function drawThumb(L) {
  const { g, card, u, X, Y, F } = L;
  // 1. name bar, 14 units tall
  bar(L, X(4), Y(4.4), 92 * u, 14 * u, 2.6 * u);
  const costLeft = costRow(L, X(93.6), Y(6.4), 10 * u);
  const nm = fitLine(g, String(card?.name ?? '?'), 600, 8.4 * u, 6.2 * u, costLeft - X(7.4) - 1.2 * u);
  g.font = `600 ${nm.px}px ${SERIF}`;
  g.fillStyle = F.ink; g.fillText(nm.text, X(7.4), Y(11.4) + nm.px * 0.36);

  // 2. tall picture
  const ax = X(6.5), ay = Y(20.6), aw = 87 * u, ah = 94 * u;
  picture(L, ax, ay, aw, ah);
  if (card?.type === 'land') {
    // the mana a land makes, on a dark band over the foot of the picture
    g.fillStyle = F.edge; g.globalAlpha = 0.72; g.fillRect(ax, ay + ah - 20 * u, aw, 20 * u); g.globalAlpha = 1;
    landGlyphs(L, ax + aw / 2, ay + ah - 17 * u, 14 * u);
  }

  // 3. foot bar: the type word, and the stat plate of a creature
  const isCreature = card?.type === 'creature';
  bar(L, X(4), Y(117.4), 92 * u, 16.6 * u, 2.4 * u);
  const word = card?.token ? 'Token' : typeLine(card).split(' — ')[0];
  const tw = fitLine(g, word, 500, 7 * u, 5.4 * u, (isCreature ? 44 : 84) * u);
  g.font = `500 ${tw.px}px ${SERIF}`;
  g.fillStyle = F.ink; g.fillText(tw.text, X(8), Y(125.7) + tw.px * 0.36);
  if (isCreature) statPlate(L, X(55), Y(115.6), 39 * u, 20.2 * u, 12.6, true);
}

// Sick ring, dead veil, dim veil, attack and block rings.
function drawStateMarks(L) {
  const { g, x0, y0, W, H, u, X, Y, st } = L;
  if (st.sick) {
    elytronPath(g, X(1.4), Y(1.4), W - 2.8 * u, H - 2.8 * u, 6.2 * u, 4 * u);
    if (typeof g.setLineDash === 'function') g.setLineDash([2 * u, 1.6 * u]);
    g.lineWidth = Math.max(1, 0.5 * u); g.strokeStyle = '#eef0f5'; g.globalAlpha = 0.8; g.stroke();
    if (typeof g.setLineDash === 'function') g.setLineDash([]);
    g.globalAlpha = 1;
  }
  if (st.dim) {
    elytronPath(g, x0, y0, W, H, 7 * u, 5 * u);
    g.fillStyle = '#0b0e15'; g.globalAlpha = 0.45; g.fill(); g.globalAlpha = 1;
  }
  if (st.dead) {
    elytronPath(g, x0, y0, W, H, 7 * u, 5 * u);
    g.fillStyle = '#0b0e15'; g.globalAlpha = 0.6; g.fill(); g.globalAlpha = 1;
    g.strokeStyle = '#ff4d4d'; g.lineWidth = 1.6 * u;
    g.beginPath(); g.moveTo(X(10), Y(130)); g.lineTo(X(90), Y(10)); g.stroke();
  }
  const ring = st.attacking ? ['#ff4d4d', 2.2] : st.blocking ? ['#eef0f5', 2.2] : st.hot ? ['#eef0f5', 1.2] : null;
  if (ring) {
    elytronPath(g, x0 + ring[1] * u / 2, y0 + ring[1] * u / 2, W - ring[1] * u, H - ring[1] * u, 6.6 * u, 4.6 * u);
    g.lineWidth = ring[1] * u; g.strokeStyle = ring[0]; g.stroke();
  }
}

// ------------------------------------------------------------ the card back
// Our own back: a fruit fly wing with its veins over a honeycomb of
// ommatidia, in bronze on near black, in the same elytron shape.
export function cardBack(ctx, { w = 300, h = 420, x: ox = 0, y: oy = 0 } = {}) {
  const g = ctx;
  const u = Math.min(w / 100, h / 140);
  const W = 100 * u, H = 140 * u;
  const x0 = ox + (w - W) / 2, y0 = oy + (h - H) / 2;
  const X = v => x0 + v * u, Y = v => y0 + v * u;
  const bronze = '#c9a45a', bronzeDim = '#6e5a32', ground = '#15110b', edge = '#050402';
  g.save();
  elytronPath(g, x0, y0, W, H, 7 * u, 5 * u);
  g.fillStyle = edge; g.fill();
  elytronPath(g, X(0.8), Y(0.8), W - 1.6 * u, H - 1.6 * u, 6.6 * u, 4.4 * u);
  g.fillStyle = '#5a4524'; g.fill();
  elytronPath(g, X(3.4), Y(3.4), W - 6.8 * u, H - 6.8 * u, 5.4 * u, 3 * u);
  g.fillStyle = ground; g.fill();
  g.save(); g.clip();
  // ommatidia: a hexagon grid
  g.strokeStyle = '#4a3b22'; g.lineWidth = Math.max(0.5, 0.25 * u);
  const r = 3.2 * u, hx = r * Math.sqrt(3);
  for (let row = -1, yy = y0; yy < y0 + H + r; row++, yy = y0 + row * r * 1.5) {
    for (let xx = x0 + (row & 1 ? hx / 2 : 0) - hx; xx < x0 + W + hx; xx += hx) {
      g.beginPath();
      for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; const px = xx + Math.cos(a) * r, py = yy + Math.sin(a) * r; i ? g.lineTo(px, py) : g.moveTo(px, py); }
      g.closePath(); g.stroke();
    }
  }
  // a pair of wings from one hinge, as a fly at rest seen from above.
  // Each blade has five long veins and two cross veins.
  const L = 50 * u, B = 15 * u;
  const blade = () => {
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(L * 0.18, -B * 0.95, L * 0.78, -B * 1.05, L * 0.98, -B * 0.2);
    g.bezierCurveTo(L * 1.06, B * 0.45, L * 0.7, B * 1.0, L * 0.38, B * 0.78);
    g.bezierCurveTo(L * 0.2, B * 0.62, L * 0.06, B * 0.3, 0, 0);
    g.closePath();
  };
  const veins = [[0.55, -0.95], [0.95, -0.55], [1.0, -0.05], [0.88, 0.5], [0.5, 0.82]];
  for (const side of [-1, 1]) {
    g.save();
    g.translate(X(50), Y(46));
    g.rotate(Math.PI / 2 + side * 0.32);
    g.scale(1, side);
    blade(); g.fillStyle = '#251c10'; g.fill();
    g.lineWidth = Math.max(1, 0.8 * u); g.strokeStyle = bronze; g.stroke();
    g.save(); blade(); g.clip();
    g.lineWidth = Math.max(0.8, 0.5 * u);
    for (const [ex, ey] of veins) {
      g.beginPath(); g.moveTo(L * 0.02, 0);
      g.quadraticCurveTo(L * ex * 0.45, B * ey * 0.25, L * ex, B * ey); g.stroke();
    }
    g.beginPath(); g.moveTo(L * 0.42, -B * 0.1); g.lineTo(L * 0.46, B * 0.3); g.stroke();
    g.beginPath(); g.moveTo(L * 0.66, B * 0.22); g.lineTo(L * 0.62, B * 0.58); g.stroke();
    g.restore();
    g.restore();
  }
  // the hinge: a small thorax plate
  g.beginPath();
  g.moveTo(X(50), Y(40)); g.lineTo(X(53), Y(46)); g.lineTo(X(50), Y(52)); g.lineTo(X(47), Y(46)); g.closePath();
  g.fillStyle = bronze; g.fill();
  g.restore();
  // a thin inner line and the name
  elytronPath(g, X(5.4), Y(5.4), W - 10.8 * u, H - 10.8 * u, 4.4 * u, 2 * u);
  g.lineWidth = Math.max(0.6, 0.3 * u); g.strokeStyle = bronzeDim; g.stroke();
  g.fillStyle = bronze; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = `500 ${6 * u}px ${SERIF}`;
  g.fillText('Fly Duel', X(50), Y(124));
  g.restore();
}
