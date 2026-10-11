// ============================================================================
//  FLY DUEL  ·  card face and card back on a 2D canvas  (ES module)
// ----------------------------------------------------------------------------
//  Draws one card in the look of a classic fantasy trading card: a name bar
//  with the cost at the right, a painted picture, a type line, a rules box
//  and a power/toughness plate. The frame shape, the ornaments, the mana
//  glyphs and the card back are our own. The frame is an elytron plate: the
//  two top corners are cut at 45 degrees, the bottom corners are round.
//
//  The pictures are public-domain natural-history plates (art/art.json,
//  art/CREDITS-ART.md). loadCardArt() loads one picture and keeps it in a
//  cache. drawCard() draws the cached picture, or a flat placeholder when
//  the picture is not loaded yet. Call drawCard() again when the promise
//  of loadCardArt() resolves.
//
//  Frame colours by card colour:
//      amber   warm gold and orange rim, warm parchment
//      moss    deep green rim, pale green parchment
//      none    grey stone rim, grey parchment
//      land    earth-brown rim, the mana colour in the glyph only
//
//  The module has no DOM work at import time. node tests can call
//  drawCard() and cardBack() with a stub 2D context.
//
//  GREP MAP
//      grep -n 'export const ART_CREDIT'    id -> "artist, year"
//      grep -n 'export const ART_IDS'       ids that have a picture
//      grep -n 'export const SUBTYPE'       id -> subtype word
//      grep -n 'export function typeLine'   "Creature — Moth"
//      grep -n 'export const FRAME'         frame colours per kind
//      grep -n 'export function frameKind'  card -> amber|moss|none|land
//      grep -n 'export function artURL'     picture URL for an id
//      grep -n 'export function loadArtIndex'  art/art.json, once
//      grep -n 'export function artCredit'  "Art: John Curtis, 1836"
//      grep -n 'export function loadCardArt'   picture loader and cache
//      grep -n 'export function getCardArt'    cached picture or null
//      grep -n 'export function rulesRuns'  rules text as styled runs
//      grep -n 'export function drawManaGlyph' one mana glyph
//      grep -n 'export function drawCard'   the card face
//      grep -n 'export function cardBack'   the card back
//      grep -n 'function elytronPath'       the frame outline
//      grep -n 'function layoutText'        word wrap with styled runs
// ============================================================================
import { KEYWORDS } from '../game/cards.js';

// id -> short credit "artist, year" for every card picture in art/cards/.
// It is a copy of art/art.json (artist, year), so a DOM card and a canvas
// card can show the credit without a fetch. tests/cards-art.test.mjs
// checks that the two agree.
export const ART_CREDIT = Object.freeze({
  "amber-ridge": "Albert Bierstadt, 1866",
  "moss-hollow": "Ernst Haeckel, 1904",
  "ember-gnat": "John Curtis, 1836",
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
  "moss-snail": "G. B. Sowerby, 1884",
  "thorn-vine": "Flora Batava, 1893",
  "bark-toad": "A. J. Rösel von Rosenhof, 1758",
  "dew-moth": "Dru Drury, 1770",
  "briar-wall": "Pierre-Joseph Redouté, 1801",
  "spore-mother": "Anna Maria Hussey, 1847",
  "grove-stag": "Brehms Tierleben, 1884",
  "fern-beast": "Ernst Haeckel, 1904",
  "deep-roots": "Vincent van Gogh, 1890",
  "sap-bloom": "Johan Carl Krauss, 1802",
  "strangle-root": "Flora Batava, 1853",
  "swell": "Anna Maria Hussey, 1847",
  "spore-burst": "J. B. F. P. Bulliard, 1780-1791",
  "drift-seed": "Walther Otto Müller, 1887",
  "hollow-husk": "G. B. Sowerby, 1857",
  "ember-larva": "F. Nemos, 1895",
  "spore": "Ernst Haeckel, 1904",
});
export const ART_IDS = Object.freeze(Object.keys(ART_CREDIT));
const HAS_ART = new Set(ART_IDS);

// The word after the dash on the type line. It names what the picture shows.
export const SUBTYPE = Object.freeze({
  'amber-ridge': 'Ridge', 'moss-hollow': 'Hollow',
  'ember-gnat': 'Gnat', 'cinder-ant': 'Ant', 'dune-wasp': 'Wasp', 'hive-soldier': 'Bee', 'spark-hornet': 'Hornet',
  'ember-mantis': 'Mantis', 'brood-captain': 'Ant', 'magma-beetle': 'Beetle', 'sun-locust': 'Locust',
  'sting-hopper': 'Hopper',
  'flare-spit': 'Venom', 'heat-pulse': 'Fever', 'kiln-burst': 'Eruption', 'war-chirp': 'Song', 'swarm-call': 'Signal',
  'root-sentinel': 'Oak', 'moss-snail': 'Snail', 'thorn-vine': 'Bramble', 'bark-toad': 'Toad', 'dew-moth': 'Moth',
  'briar-wall': 'Rose', 'spore-mother': 'Fungus', 'grove-stag': 'Beetle', 'fern-beast': 'Fern',
  'deep-roots': 'Growth', 'sap-bloom': 'Nectar', 'strangle-root': 'Vine', 'swell': 'Growth', 'spore-burst': 'Spores',
  'drift-seed': 'Seed', 'hollow-husk': 'Crab',
  'ember-larva': 'Larva', 'spore': 'Fungus',
});

export function typeLine(card) {
  if (!card) return '';
  const base = card.type === 'creature' ? 'Creature' : card.type === 'land' ? 'Land' : 'Spell';
  const sub = SUBTYPE[card.id];
  return `${card.token ? 'Token ' : ''}${base}${sub ? ' — ' + sub : ''}`;
}

// Frame colours. rim0 -> rim1 is the one linear gradient of the rim.
export const FRAME = Object.freeze({
  amber: { rim0: '#e6a647', rim1: '#8f4a12', edge: '#2a1404', line: '#ffe2a6', bar: '#f6dca4', barEdge: '#7a3f0e',
    ink: '#2a1604', paper: '#f7e9cb', paperInk: '#2b1d0e', fleck: '#9a5a1c', soft: '#6a4a2a' },
  moss: { rim0: '#5d8f3a', rim1: '#1d3a17', edge: '#0b1608', line: '#cfe8a2', bar: '#d9e6b8', barEdge: '#2c4f22',
    ink: '#14200e', paper: '#eef0dc', paperInk: '#1d2616', fleck: '#4f7a34', soft: '#46553a' },
  none: { rim0: '#b3b6bd', rim1: '#565b65', edge: '#1b1d22', line: '#eef0f4', bar: '#e4e3de', barEdge: '#4a4e57',
    ink: '#1d1f24', paper: '#efede7', paperInk: '#25272c', fleck: '#7d828c', soft: '#4d5058' },
  land: { rim0: '#a27b4e', rim1: '#4c3320', edge: '#1e1309', line: '#f0dcb8', bar: '#ead7b2', barEdge: '#5a3e24',
    ink: '#24170b', paper: '#f1e5cc', paperInk: '#2a1e10', fleck: '#8a6a44', soft: '#5e4a34' },
});

export function frameKind(card) {
  if (!card) return 'none';
  if (card.type === 'land') return 'land';
  const c = String(card.colour || '').toLowerCase();
  return c === 'amber' ? 'amber' : c === 'moss' ? 'moss' : 'none';
}

// Mana colours. The same values as --amber and --moss in style.css.
const MANA = { amber: '#ffb347', amberDeep: '#2b1604', moss: '#a8d65a', mossDeep: '#14260a', generic: '#dcdad3', genericEdge: '#5d616b' };

const SERIF = "'STIX Two Text','Times New Roman',Georgia,serif";
const SANS = "Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";

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

// Short credit line for the foot of the card, or '' when unknown.
// art.json gives `artist` (short) and `author` (full).
export function artCredit(id) {
  const e = artIndex?.[id];
  if (e) return `Art: ${String(e.artist || e.author || '').split(/[;(]/)[0].trim()}${e.year ? ', ' + e.year : ''}`;
  return ART_CREDIT[id] ? `Art: ${ART_CREDIT[id]}` : '';
}

const artCache = new Map();   // key -> { promise, img }

// Load the picture of one card. Resolves to an ImageBitmap or an image
// element. When the file does not load, resolves to a placeholder canvas
// (or null when there is no DOM).
export function loadCardArt(id, { small = false } = {}) {
  const key = `${id}${small ? '@sm' : ''}`;
  const hit = artCache.get(key);
  if (hit) return hit.promise;
  const rec = { img: null, promise: null };
  rec.promise = (async () => {
    loadArtIndex();
    let img = null;
    if (HAS_ART.has(id)) {
      try {
        if (typeof fetch === 'function' && typeof createImageBitmap === 'function') {
          const r = await fetch(artURL(id, { small }));
          if (!r.ok) throw new Error(`art ${id}: ${r.status}`);
          img = await createImageBitmap(await r.blob());
        } else if (typeof Image === 'function') {
          img = await new Promise((res, rej) => { const im = new Image(); im.decoding = 'async'; im.onload = () => res(im); im.onerror = rej; im.src = artURL(id, { small }); });
        }
      } catch { img = null; }
    }
    if (!img) img = placeholderCanvas(id);
    rec.img = img;
    return img;
  })();
  artCache.set(key, rec);
  return rec.promise;
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

// Paper fibres and flecks, clipped by the caller.
function paperTexture(g, x, y, w, h, F, rnd, u) {
  const n = Math.round((w * h) / (u * u) / 9);
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

// Rim texture: resin bubbles (amber), leaf veins (moss), stone grain
// (none), wood grain (land).
function rimTexture(g, x, y, w, h, kind, F, rnd, u) {
  g.save();
  g.lineWidth = Math.max(0.6, u * 0.18);
  if (kind === 'land') {
    for (let i = 0; i < 26; i++) {
      const yy = y + rnd() * h;
      g.globalAlpha = 0.12 + rnd() * 0.12; g.strokeStyle = rnd() < 0.5 ? F.edge : F.line;
      g.beginPath(); g.moveTo(x, yy);
      g.bezierCurveTo(x + w * 0.3, yy + (rnd() - 0.5) * 3 * u, x + w * 0.7, yy + (rnd() - 0.5) * 3 * u, x + w, yy + (rnd() - 0.5) * 2 * u);
      g.stroke();
    }
  } else if (kind === 'moss') {
    for (let i = 0; i < 34; i++) {
      const px = x + rnd() * w, py = y + rnd() * h, a = rnd() * Math.PI * 2, l = u * (1.5 + rnd() * 3);
      g.globalAlpha = 0.12 + rnd() * 0.12; g.strokeStyle = rnd() < 0.5 ? F.line : F.edge;
      g.beginPath(); g.moveTo(px, py); g.quadraticCurveTo(px + Math.cos(a + 0.6) * l * 0.6, py + Math.sin(a + 0.6) * l * 0.6, px + Math.cos(a) * l, py + Math.sin(a) * l); g.stroke();
    }
  } else if (kind === 'amber') {
    for (let i = 0; i < 46; i++) {
      const px = x + rnd() * w, py = y + rnd() * h, rr = u * (0.15 + rnd() * 0.55);
      g.globalAlpha = 0.14 + rnd() * 0.16; g.fillStyle = rnd() < 0.6 ? F.line : F.edge;
      g.beginPath(); g.arc(px, py, rr, 0, Math.PI * 2); g.fill();
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
// One mana glyph in the box (x, y, s, s). kind: amber | moss | generic.
// No glyph is a disc: amber is a hexagon cell, moss a diamond with a leaf,
// generic a rounded square with the number.
export function drawManaGlyph(g, kind, x, y, s, n = 0) {
  const k = s / 20;
  const P = (px, py) => [x + px * k, y + py * k];
  g.save();
  g.lineJoin = 'round';
  if (kind === 'amber') {
    g.beginPath();
    const pts = [[10, 1.2], [17.7, 5.6], [17.7, 14.4], [10, 18.8], [2.3, 14.4], [2.3, 5.6]];
    pts.forEach((p, i) => { const [a, b] = P(...p); i ? g.lineTo(a, b) : g.moveTo(a, b); });
    g.closePath(); g.fillStyle = MANA.amberDeep; g.fill();
    g.lineWidth = 1.6 * k; g.strokeStyle = MANA.amber; g.stroke();
    g.beginPath();
    g.moveTo(...P(10, 4.8));
    g.bezierCurveTo(...P(12.4, 8.1), ...P(13.6, 10.1), ...P(13.6, 11.7));
    g.bezierCurveTo(...P(13.6, 13.8), ...P(12, 15.3), ...P(10, 15.3));
    g.bezierCurveTo(...P(8, 15.3), ...P(6.4, 13.8), ...P(6.4, 11.7));
    g.bezierCurveTo(...P(6.4, 10.1), ...P(7.6, 8.1), ...P(10, 4.8));
    g.closePath(); g.fillStyle = MANA.amber; g.fill();
    g.fillStyle = '#fff3d0'; g.fillRect(...P(8.2, 10.6), 1.4 * k, 1.4 * k);
  } else if (kind === 'moss') {
    g.beginPath();
    g.moveTo(...P(10, 1)); g.lineTo(...P(19, 10)); g.lineTo(...P(10, 19)); g.lineTo(...P(1, 10)); g.closePath();
    g.fillStyle = MANA.mossDeep; g.fill(); g.lineWidth = 1.5 * k; g.strokeStyle = MANA.moss; g.stroke();
    g.beginPath();
    g.moveTo(...P(6.2, 13.8));
    g.bezierCurveTo(...P(6.2, 9.4), ...P(9.2, 6.6), ...P(13.6, 6.4));
    g.bezierCurveTo(...P(13.8, 10.8), ...P(10.9, 13.7), ...P(6.2, 13.8));
    g.closePath(); g.fillStyle = MANA.moss; g.fill();
    g.beginPath(); g.moveTo(...P(6.7, 13.3)); g.lineTo(...P(12.6, 7.4)); g.lineWidth = 1 * k; g.strokeStyle = MANA.mossDeep; g.stroke();
  } else {
    const r = 3.6 * k, [x0, y0] = P(1.6, 1.6), w = 16.8 * k;
    g.beginPath();
    g.moveTo(x0 + r, y0); g.lineTo(x0 + w - r, y0); g.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
    g.lineTo(x0 + w, y0 + w - r); g.quadraticCurveTo(x0 + w, y0 + w, x0 + w - r, y0 + w);
    g.lineTo(x0 + r, y0 + w); g.quadraticCurveTo(x0, y0 + w, x0, y0 + w - r);
    g.lineTo(x0, y0 + r); g.quadraticCurveTo(x0, y0, x0 + r, y0); g.closePath();
    g.fillStyle = MANA.generic; g.fill(); g.lineWidth = 1.4 * k; g.strokeStyle = MANA.genericEdge; g.stroke();
    g.fillStyle = '#1d1f24'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `600 ${Math.round(12.5 * k * 10) / 10}px ${SERIF}`;
    g.fillText(String(n | 0), x + 10 * k, y + 10.8 * k);
  }
  g.restore();
}

// Glyph list for a cost: generic first, then amber, then moss.
function costList(cost) {
  const out = [];
  if (!cost) return out;
  if ((cost.generic | 0) > 0) out.push(['generic', cost.generic | 0]);
  for (let i = 0; i < (cost.amber | 0); i++) out.push(['amber', 0]);
  for (let i = 0; i < (cost.moss | 0); i++) out.push(['moss', 0]);
  return out;
}

// ------------------------------------------------------------ rules text
const KW_NAMES = { swift: 'Swift', wings: 'Wings', sting: 'Sting', thick: 'Thick', sap: 'Sap' };
const KW_RE = /^(Swift|Wings|Sting|Thick|Sap)\.$/i;

// The rules text of a card as runs { t, s } with s = 'r' (roman), 'b'
// (bold keyword) or 'i' (italic reminder). A card whose text is only
// keywords gets the reminder text in italic, as a classic card does.
// Flavour line of a token that has none: what a token is.
export const TOKEN_NOTE = 'Made by an effect. It never goes to a hand or a graveyard.';

export function rulesRuns(card) {
  const text = String(card?.text || '').trim();
  if (!text) return [];
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
  return runs;
}

function fontFor(s, px) {
  const sz = Math.round(px * 10) / 10;
  return s === 'b' ? `600 ${sz}px ${SERIF}` : s === 'i' ? `italic 400 ${sz}px ${SERIF}` : `400 ${sz}px ${SERIF}`;
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

// ------------------------------------------------------------ placeholder
function drawPlaceholder(g, x, y, w, h, id) {
  const card = { id };
  const kind = frameKind(card);
  const F = FRAME[kind];
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
// Draw one card face in the box (0, 0, w, h) of ctx. The card keeps the
// 5:7 shape and is centred in the box.
// opts.state (all optional):
//   tapped     art dims, a hatch band crosses the art
//   sick       a dashed ring inside the rim (entered this turn)
//   attacking  a 2-unit red ring
//   blocking   a 2-unit white ring
//   hot        a 1-unit white ring (just changed)
//   dead       grey veil and a diagonal stroke
//   damage     damage marked this turn (a red cell on the stat plate)
//   pp, pt     pump this turn (+power, +toughness)
// opts.art: a picture to use instead of the cache.
export function drawCard(ctx, card, { w = 300, h = 420, state = {}, art = null, x: ox = 0, y: oy = 0 } = {}) {
  const g = ctx;
  const u = Math.min(w / 100, h / 140);
  const W = 100 * u, H = 140 * u;
  const x0 = ox + (w - W) / 2, y0 = oy + (h - H) / 2;
  const X = v => x0 + v * u, Y = v => y0 + v * u;
  const kind = frameKind(card);
  const F = FRAME[kind];
  const id = String(card?.id ?? 'unknown');
  const rnd = rngOf(id);
  const st = state || {};

  g.save();
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';

  // 1. outline and rim
  elytronPath(g, x0, y0, W, H, 7 * u, 5 * u);
  g.fillStyle = F.edge; g.fill();
  elytronPath(g, X(0.8), Y(0.8), W - 1.6 * u, H - 1.6 * u, 6.6 * u, 4.4 * u);
  const grad = typeof g.createLinearGradient === 'function' ? g.createLinearGradient(x0, y0, x0, y0 + H) : null;
  if (grad && grad.addColorStop) { grad.addColorStop(0, F.rim0); grad.addColorStop(1, F.rim1); g.fillStyle = grad; } else g.fillStyle = F.rim0;
  g.fill();
  g.save(); g.clip(); rimTexture(g, x0, y0, W, H, kind, F, rnd, u); g.restore();
  // inner ornament line
  elytronPath(g, X(2.6), Y(2.6), W - 5.2 * u, H - 5.2 * u, 5.6 * u, 3.4 * u);
  g.lineWidth = Math.max(0.6, 0.35 * u); g.strokeStyle = F.line; g.globalAlpha = 0.75; g.stroke(); g.globalAlpha = 1;

  // 2. name bar
  barPath(g, X(4.5), Y(4.6), 91 * u, 10 * u, 2.2 * u);
  g.fillStyle = F.bar; g.fill();
  g.save(); g.clip(); paperTexture(g, X(4.5), Y(4.6), 91 * u, 10 * u, F, rnd, u); g.restore();
  g.lineWidth = Math.max(0.8, 0.45 * u); g.strokeStyle = F.barEdge; g.stroke();
  const glyphs = costList(card?.cost);
  const gs = 6.6 * u, gGap = 0.5 * u;
  let gx = X(93) - glyphs.length * (gs + gGap) + gGap;
  const costLeft = gx;
  for (const [k, n] of glyphs) { drawManaGlyph(g, k, gx, Y(6.3), gs, n); gx += gs + gGap; }
  // name, shrunk to fit before the cost
  const name = String(card?.name ?? '?');
  let fs = 5.8 * u;
  const room = costLeft - X(8) - 1.5 * u;
  g.font = `500 ${fs}px ${SERIF}`;
  for (let i = 0; i < 8 && g.measureText(name).width > room; i++) { fs *= 0.93; g.font = `500 ${fs}px ${SERIF}`; }
  g.fillStyle = F.ink; g.fillText(name, X(8), Y(11.6));

  // 3. art window (4:3)
  const ax = X(6.5), ay = Y(16.2), aw = 87 * u, ah = 65.25 * u;
  g.fillStyle = F.edge; g.fillRect(ax - 0.7 * u, ay - 0.7 * u, aw + 1.4 * u, ah + 1.4 * u);
  const pic = art || getCardArt(id, { small: w < 260 });
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
  // corner curls outside the art window
  g.strokeStyle = F.line; g.lineWidth = Math.max(0.6, 0.3 * u); g.globalAlpha = 0.85;
  curl(g, ax - 0.9 * u, ay + ah + 0.9 * u, -1, -1, 1.2 * u);
  curl(g, ax + aw + 0.9 * u, ay + ah + 0.9 * u, 1, -1, 1.2 * u);
  g.globalAlpha = 1;

  // 4. type line
  barPath(g, X(4.5), Y(82.8), 91 * u, 8.6 * u, 2 * u);
  g.fillStyle = F.bar; g.fill();
  g.save(); g.clip(); paperTexture(g, X(4.5), Y(82.8), 91 * u, 8.6 * u, F, rnd, u); g.restore();
  g.lineWidth = Math.max(0.8, 0.45 * u); g.strokeStyle = F.barEdge; g.stroke();
  let ts = 4.7 * u;
  const tl = typeLine(card);
  g.font = `500 ${ts}px ${SERIF}`;
  for (let i = 0; i < 6 && g.measureText(tl).width > 80 * u; i++) { ts *= 0.93; g.font = `500 ${ts}px ${SERIF}`; }
  g.fillStyle = F.ink; g.fillText(tl, X(8), Y(88.6));

  // 5. rules box
  const bx = X(7.2), by = Y(92.8), bw = 85.6 * u, bh = 38.6 * u;
  g.fillStyle = F.edge; g.fillRect(bx - 0.5 * u, by - 0.5 * u, bw + 1 * u, bh + 1 * u);
  g.fillStyle = F.paper; g.fillRect(bx, by, bw, bh);
  g.save(); rectPath(g, bx, by, bw, bh); g.clip(); paperTexture(g, bx, by, bw, bh, F, rnd, u); g.restore();

  const isCreature = card?.type === 'creature';
  const padX = 2.6 * u, padY = 2.4 * u;
  const textW = bw - padX * 2;
  const textH = bh - padY * 2 - (isCreature ? 3.2 * u : 0);
  if (card?.type === 'land') {
    // a large mana glyph, then the rules line
    const k = card.produces === 'moss' ? 'moss' : card.produces === 'amber' ? 'amber' : 'generic';
    drawManaGlyph(g, k, bx + bw / 2 - 8 * u, by + 3 * u, 16 * u, 1);
  }
  const rules = rulesRuns(card);
  const paras = [];
  if (rules.length) paras.push(rules);
  const flav = String(card?.flavour || '').trim() || (card?.token ? TOKEN_NOTE : '');
  if (flav) paras.push([{ t: flav, s: 'i' }]);
  if (paras.length) {
    let px = 4.6 * u, lay;
    const avail = card?.type === 'land' ? textH - 19 * u : textH;
    for (let i = 0; i < 14; i++) {
      lay = layoutText(g, paras, textW, px, px * 0.75);
      if (lay.height <= avail || px < 2.9 * u) break;
      px *= 0.94;
    }
    // centre the block in the free space (classic cards centre short text)
    const topSpace = card?.type === 'land' ? 19 * u : 0;
    const ty0 = by + padY + topSpace + Math.max(0, (avail - lay.height) / 2) + px * 0.92;
    const hasRules = rules.length > 0;
    for (const ln of lay.lines) {
      const isFlav = hasRules ? ln.para === 1 : true;
      const dx = isFlav && !hasRules ? (textW - ln.w) / 2 : 0;
      for (const it of ln.items) {
        g.font = fontFor(it.s, px);
        g.fillStyle = isFlav ? F.soft : F.paperInk;
        g.fillText(it.t, bx + padX + dx + it.x, ty0 + ln.y);
      }
    }
    // a hairline between rules and flavour
    if (hasRules && flav) {
      const first = lay.lines.find(l => l.para === 1);
      if (first) {
        const ly = ty0 + first.y - px * 1.05;
        g.strokeStyle = F.fleck; g.globalAlpha = 0.5; g.lineWidth = Math.max(0.5, 0.2 * u);
        g.beginPath(); g.moveTo(bx + bw * 0.3, ly); g.lineTo(bx + bw * 0.7, ly); g.stroke(); g.globalAlpha = 1;
      }
    }
  }

  // 6. stat plate
  if (isCreature) {
    const pp = st.pp | 0, pt = st.pt | 0;
    const pw = (card.power ?? 0) + pp, tw = (card.toughness ?? 0) + pt;
    const sx = X(72), sy = Y(127.4), sw = 22.5 * u, sh = 9.4 * u;
    barPath(g, sx, sy, sw, sh, 1.8 * u);
    g.fillStyle = F.edge; g.fill();
    barPath(g, sx + 0.6 * u, sy + 0.6 * u, sw - 1.2 * u, sh - 1.2 * u, 1.5 * u);
    g.fillStyle = F.bar; g.fill();
    g.save(); g.clip(); paperTexture(g, sx, sy, sw, sh, F, rnd, u); g.restore();
    if (pp || pt) { g.lineWidth = Math.max(1, 0.5 * u); g.strokeStyle = '#1d1f24'; g.stroke(); }
    g.font = `600 ${6.2 * u}px ${SERIF}`;
    g.fillStyle = F.ink; g.textAlign = 'center';
    g.fillText(`${pw}/${tw}`, sx + sw / 2, sy + sh * 0.74);
    g.textAlign = 'left';
    const dmg = st.damage | 0;
    if (dmg > 0) {
      const cx = sx - 9.5 * u;
      g.fillStyle = '#ff4d4d'; g.fillRect(cx, sy + 0.8 * u, 8.5 * u, sh - 1.6 * u);
      g.fillStyle = '#05070c'; g.textAlign = 'center'; g.font = `700 ${5.2 * u}px ${SANS}`;
      g.fillText(`−${dmg}`, cx + 4.25 * u, sy + sh * 0.72); g.textAlign = 'left';
    }
  }

  // 7. foot: illustrator credit
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

  // 8. state marks
  if (st.sick) {
    elytronPath(g, X(1.4), Y(1.4), W - 2.8 * u, H - 2.8 * u, 6.2 * u, 4 * u);
    if (typeof g.setLineDash === 'function') g.setLineDash([2 * u, 1.6 * u]);
    g.lineWidth = Math.max(1, 0.5 * u); g.strokeStyle = '#eef0f5'; g.globalAlpha = 0.8; g.stroke();
    if (typeof g.setLineDash === 'function') g.setLineDash([]);
    g.globalAlpha = 1;
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
  g.restore();
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
