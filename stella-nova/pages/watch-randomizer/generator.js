// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  generator.js — a seed in, a timepiece spec out
// ────────────────────────────────────────────────────────────────────────────
//  makeSpec(seed, o) turns a seed string into a full description of one
//  timepiece: its type, its movement (one of the four working calibres of
//  watch-movement, with a finish), its face and its case. The same seed
//  always gives the same piece. No DOM and no THREE; tests.mjs runs it.
//
//  LOCKS
//    o.type fixes the type. o.keep = { movement, face, case } with a
//    previous spec: a kept section is copied over, so the user can roll
//    the face alone, or the case alone. A kept movement also keeps the
//    type, since the type decides which calibres fit.
//
//  COMPATIBILITY  (the type decides the calibre; the calibre decides the
//  seconds display on the dial)
//    pocket  lever (small seconds at 6), tourbillon (aperture), verge (none)
//    wrist   automatic (centre seconds), lever or tourbillon (a large
//            "pocket conversion" wristwatch)
//    wall    automatic without its rotor (centre seconds), lever without
//            seconds
//    alarm   lever without seconds, automatic without its rotor
//
//  GREP MAP
//    function rng ............ seeded generator (xmur3 + mulberry32)
//    const TYPES ............. type weights and the calibres each allows
//    function makerName ...... invented maker names, real brands refused
//    function makeSpec ....... the whole spec
//    function describe ....... rows for the panel
// ============================================================================

// ── seeded random ───────────────────────────────────────────────────────────
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
  return () => { h = Math.imul(h ^ h >>> 16, 2246822507); h = Math.imul(h ^ h >>> 13, 3266489909); return (h ^= h >>> 16) >>> 0; };
}
function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// a stream per section, so a kept section does not shift the others
export function rng(seed, section = '') {
  const r = mulberry32(xmur3(`${seed}|${section}`)());
  const R = () => r();
  R.pick = arr => arr[Math.floor(r() * arr.length)];
  R.weighted = pairs => { let t = r() * pairs.reduce((s, p) => s + p[1], 0); for (const [v, w] of pairs) { if ((t -= w) <= 0) return v; } return pairs[pairs.length - 1][0]; };
  R.range = (a, b) => a + (b - a) * r();
  R.chance = p => r() < p;
  return R;
}
export function newSeed() {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

// ── catalogue ───────────────────────────────────────────────────────────────
export const TYPES = {
  pocket: { name: 'Pocket watch', weight: 3, calibres: [['lever', 5], ['tourbillon', 2], ['verge', 3]] },
  wrist: { name: 'Wristwatch', weight: 3.5, calibres: [['automatic', 7], ['lever', 1.5], ['tourbillon', 1.5]] },
  wall: { name: 'Wall clock', weight: 1.5, calibres: [['automatic', 6], ['lever', 4]] },
  alarm: { name: 'Alarm clock', weight: 2, calibres: [['lever', 6], ['automatic', 4]] },
};
export const CALIBRE_NAMES = { lever: 'Swiss lever', tourbillon: 'Tourbillon', automatic: 'Automatic', verge: 'Verge fusee' };
export const DIAL_BASES = ['enamel', 'cream', 'black', 'slate', 'sunray-blue', 'sunray-green', 'salmon', 'silver-guilloche'];
export const NUMERALS = ['roman', 'arabic', 'breguet', 'baton', 'dots'];
export const TRACKS = ['railway', 'minutes', 'dots', 'none'];
export const HAND_STYLES = ['breguet', 'dauphine', 'leaf', 'sword', 'spade', 'cathedral', 'baton'];
const LIGHT = new Set(['enamel', 'cream', 'salmon', 'silver-guilloche']);

// movement finishes: palette overrides for the kit's material templates
export const FINISH = {
  plate: { rhodium: { plate: { color: '#aab0bb' }, rhodium: { color: '#c4c9d2' } }, gilt: { plate: { color: '#d8b06a' }, rhodium: { color: '#e2bd72' }, giltPlate: { color: '#e2b766' }, giltBridge: { color: '#e6bc6c' } },
    'two-tone': { plate: { color: '#d8b06a' }, rhodium: { color: '#c4c9d2' } }, black: { plate: { color: '#3b3f47' }, rhodium: { color: '#2d3038', roughness: 0.3 }, giltPlate: { color: '#3b3f47' }, giltBridge: { color: '#2d3038' } },
    rose: { plate: { color: '#d9a58a' }, rhodium: { color: '#e3ae92' }, giltPlate: { color: '#d9a58a' }, giltBridge: { color: '#e3ae92' } } },
  wheels: { gilt: { gilt: { color: '#e8be72' } }, rhodium: { gilt: { color: '#d6d9e0' } }, rose: { gilt: { color: '#eaa98a' } }, black: { gilt: { color: '#30333a' } } },
  screws: { blued: { blued: { color: '#2a4fc8' } }, polished: { blued: { color: '#e4e6ec', roughness: 0.1 } }, gold: { blued: { color: '#f0c46a', roughness: 0.15 } } },
  jewels: { ruby: { ruby: { color: '#b3102c', emissive: '#3a0008' } }, sapphire: { ruby: { color: '#1838a8', emissive: '#050a30' } }, clear: { ruby: { color: '#e8eef8', emissive: '#101418' } } },
  balance: { glucydur: { glucydur: { color: '#f2a878' } }, gold: { glucydur: { color: '#f0c46a' } }, steel: { glucydur: { color: '#d6d9e0' } } },
};
export const METALS = {
  'yellow gold': { color: '#f0c66a', roughness: 0.14 }, 'rose gold': { color: '#eaa47e', roughness: 0.14 }, silver: { color: '#e1e4ea', roughness: 0.12 },
  steel: { color: '#cfd3da', roughness: 0.18 }, gunmetal: { color: '#55595f', roughness: 0.22 }, brass: { color: '#d9a95a', roughness: 0.25 }, nickel: { color: '#c9ccd2', roughness: 0.16 },
};
export const PAINTS = { red: '#b02a2a', green: '#2e6b48', cream: '#efe3c4', black: '#1d1e22', blue: '#2a4f8f', mint: '#8fc9b0', orange: '#d86b2a' };
export const WOODS = { walnut: '#6b4428', oak: '#a8794a', mahogany: '#7a3324', ebony: '#2a201c' };
export const LEATHERS = { black: '#1d1c1e', brown: '#5a3a24', tan: '#a8703e', green: '#2f4a36', blue: '#24344f', oxblood: '#5a1a1e' };

// ── maker names: invented, never a real brand ──────────────────────────────
const PRE = ['Aur', 'Bel', 'Cal', 'Dor', 'Ever', 'Fal', 'Gal', 'Hal', 'Ivo', 'Jor', 'Kel', 'Lun', 'Mar', 'Nor', 'Orl', 'Per', 'Quin', 'Ros', 'Sel', 'Tor', 'Ul', 'Val', 'Wren', 'Ys', 'Zel', 'Ash', 'Brim', 'Cor', 'Dun', 'Elm'];
const MID = ['a', 'e', 'i', 'o', 'en', 'an', 'el', 'ar', 'is', 'ow', 'ith', 'em'];
const POST = ['ett', 'ine', 'ard', 'ley', 'mont', 'ford', 'ier', 'ane', 'oux', 'vale', 'wick', 'ton', 'elle', 'ay', 'sen'];
const FORMS = ['{A}', '{A} & {B}', 'Maison {A}', '{A} Frères', '{A} & Sons', 'Atelier {A}', '{A} {B}'];
// real watch and clock houses the generator must never print
export const REAL_BRANDS = ['rolex', 'omega', 'patek', 'philippe', 'breguet', 'longines', 'tissot', 'seiko', 'cartier', 'zenith', 'tudor', 'hamilton', 'bulova', 'timex', 'swatch', 'casio', 'citizen', 'oris', 'rado', 'iwc', 'panerai', 'hublot', 'jaeger', 'lecoultre', 'vacheron', 'constantin', 'audemars', 'piguet', 'blancpain', 'glashutte', 'lange', 'nomos', 'sinn', 'junghans', 'breitling', 'tag', 'heuer', 'chopard', 'piaget', 'jaquet', 'droz', 'girard', 'perregaux', 'ulysse', 'nardin', 'doxa', 'certina', 'mido', 'movado', 'elgin', 'waltham', 'illinois', 'westclox', 'seth', 'thomas', 'ingraham', 'howard', 'dent', 'frodsham', 'tompion', 'graham', 'mudge', 'arnold', 'harrison', 'ebel', 'eterna', 'fortis', 'glycine', 'enicar', 'favre', 'leuba', 'universal', 'gallet', 'minerva', 'angelus', 'excelsior', 'lemania', 'valjoux', 'unitas', 'eta', 'sellita', 'kienzle', 'hermle', 'vulcain', 'smiths', 'ingersoll', 'benrus', 'gruen', 'wittnauer', 'lip', 'yema', 'tutima', 'stowa', 'laco', 'bremont', 'christopher', 'ward', 'roger', 'dubuis', 'greubel', 'forsey', 'urwerk', 'mb', 'richard', 'mille', 'montblanc', 'bovet', 'parmigiani', 'speake', 'marin', 'dornbluth', 'grand', 'credor', 'orient', 'raketa', 'vostok', 'poljot', 'pobeda', 'molnija'];
const BAN = new Set(REAL_BRANDS);
function word(R) { return R.pick(PRE) + (R.chance(0.5) ? R.pick(MID) : '') + R.pick(POST); }
export function makerName(R) {
  for (let tries = 0; tries < 50; tries++) {
    const A = word(R), B = word(R);
    const name = R.pick(FORMS).replace('{A}', A).replace('{B}', B);
    const toks = name.toLowerCase().replace(/[^a-zà-ÿ ]/g, ' ').split(/\s+/).filter(Boolean);
    if (toks.every(t => !BAN.has(t)) && A !== B) return name;
  }
  return 'Stella Nova';
}
const CITIES = ['Genève', 'London', 'Paris', 'Le Locle', 'La Chaux-de-Fonds', 'Bienne', 'Besançon', 'Vienna', 'Coventry', 'Pforzheim'];

// ── the spec ────────────────────────────────────────────────────────────────
function movementSpec(R, type) {
  const calibre = R.weighted(TYPES[type].calibres);
  const plate = calibre === 'verge' ? R.weighted([['gilt', 8], ['rose', 1]]) : R.weighted([['rhodium', 5], ['gilt', 2], ['two-tone', 2], ['black', 1.2], ['rose', 1]]);
  return {
    calibre, plate,
    wheels: plate === 'black' ? R.pick(['gilt', 'rose', 'rhodium']) : R.weighted([['gilt', 6], ['rhodium', 2], ['rose', 1.2], ['black', 0.6]]),
    screws: R.weighted([['blued', 6], ['polished', 2], ['gold', 1.5]]),
    jewels: R.weighted([['ruby', 8], ['sapphire', 1.2], ['clear', 0.8]]),
    balance: R.weighted([['glucydur', 5], ['gold', 2], ['steel', 1.5]]),
  };
}
// the seconds display follows the calibre and the type
function secondsFor(type, calibre) {
  if (calibre === 'verge') return 'none';
  if (calibre === 'tourbillon') return 'aperture';
  if (calibre === 'automatic') return 'centre';
  return type === 'wall' || type === 'alarm' ? 'none' : 'small';
}
function faceSpec(R, type, calibre) {
  const era = calibre === 'verge' ? 'old' : type === 'wrist' && calibre === 'automatic' ? 'modern' : 'classic';
  const base = era === 'old' ? R.weighted([['enamel', 7], ['cream', 3]]) : era === 'modern' ? R.weighted([['black', 2], ['slate', 1.5], ['sunray-blue', 2], ['sunray-green', 1.2], ['silver-guilloche', 1.2], ['salmon', 1], ['cream', 1], ['enamel', 0.8]]) : R.weighted(DIAL_BASES.map(b => [b, LIGHT.has(b) ? 2 : 1]));
  const numerals = era === 'old' ? 'roman' : type === 'alarm' || type === 'wall' ? R.weighted([['arabic', 4], ['roman', 2], ['baton', 1.5], ['breguet', 1]]) : R.weighted([['roman', 2], ['arabic', 2], ['breguet', 1.5], ['baton', era === 'modern' ? 3 : 1], ['dots', 1]]);
  const light = LIGHT.has(base);
  const handStyle = era === 'old' ? R.weighted([['beetle', 7], ['breguet', 3]]) : R.weighted(HAND_STYLES.map(s => [s, s === 'dauphine' && era === 'modern' ? 3 : s === 'breguet' && era === 'classic' ? 3 : 1]));
  return {
    base, numerals,
    track: R.weighted([['railway', 3], ['minutes', 3], ['dots', 1.5], ['none', era === 'modern' ? 1 : 0.3]]),
    seconds: secondsFor(type, calibre),
    brand: makerName(R),
    city: R.pick(CITIES),
    handStyle,
    handColor: light ? R.weighted([['blued', 5], ['black', 2], ['gold', 2], ['steel', 1]]) : R.weighted([['steel', 4], ['gold', 3], ['lume', 1.5]]),
    secondColor: R.weighted([['match', 3], ['red', 2.5], ['gold', 1], ['blue', 1]]),
    lollipop: R.chance(0.25),
    accent: R.pick(['#b0402e', '#2a4f8f', '#b08a3e', '#3c6b4f']),
  };
}
function caseSpec(R, type, calibre) {
  if (type === 'pocket') return {
    metal: R.weighted([['yellow gold', 4], ['silver', 3], ['rose gold', 1.5], ['gunmetal', 1], ['nickel', 1]]),
    style: calibre === 'verge' ? R.weighted([['open face', 7], ['hunter', 3]]) : R.weighted([['open face', 6], ['hunter', 4]]),
    bezel: R.pick(['smooth', 'coin', 'fluted']), crystal: R.weighted([['domed', 3], ['flat', 1]]),
    back: R.weighted([['display', 6], ['hinged', 4]]), bow: R.pick(['round', 'oval']),
  };
  if (type === 'wrist') return {
    metal: R.weighted([['steel', 5], ['yellow gold', 2], ['rose gold', 1.5], ['gunmetal', 1.2], ['silver', 1]]),
    shape: calibre === 'automatic' ? R.weighted([['round', 6], ['cushion', 2], ['tonneau', 1.2], ['square', 1.2]]) : R.weighted([['round', 3], ['cushion', 1]]),
    bezel: R.weighted([['smooth', 4], ['coin', 2], ['fluted', 1.5], ['diver', 2]]),
    strap: R.weighted([['leather', 6], ['bracelet', 3], ['mesh', 1.5]]),
    leather: R.pick(Object.keys(LEATHERS)),
    crown: R.pick(['onion', 'fluted']),
  };
  if (type === 'wall') return {
    style: R.weighted([['schoolhouse', 4], ['station', 3], ['kitchen', 2], ['porthole', 2]]),
    wood: R.pick(Object.keys(WOODS)), paint: R.pick(Object.keys(PAINTS)),
    metal: R.pick(['brass', 'nickel', 'steel']),
    diameter: Math.round(R.range(230, 320) / 10) * 10,
  };
  return {
    body: R.weighted([['painted', 5], ['chrome', 2], ['brass', 2]]),
    paint: R.pick(Object.keys(PAINTS)),
    bells: R.pick(['chrome', 'brass']),
    feet: R.pick(['ball', 'splayed']),
    diameter: Math.round(R.range(95, 125) / 5) * 5,
    alarmAt: Math.floor(R.range(0, 12 * 60 / 5)) * 5,
  };
}

// o: { type, keep: { movement, face, case }, prev }
export function makeSpec(seed, o = {}) {
  const keep = o.keep || {}, prev = o.prev;
  const RT = rng(seed, 'type');
  let type = o.type && TYPES[o.type] ? o.type : RT.weighted(Object.entries(TYPES).map(([k, v]) => [k, v.weight]));
  if (prev && keep.movement) type = prev.type;
  const movement = prev && keep.movement ? prev.movement : movementSpec(rng(seed, 'movement'), type);
  // a kept face keeps its look; its seconds display follows the calibre
  const freshFace = faceSpec(rng(seed, 'face'), type, movement.calibre);
  const face = prev && keep.face ? { ...freshFace, ...pickKeep(prev.face) } : freshFace;
  const kase = prev && keep.case && prev.type === type ? prev.case : caseSpec(rng(seed, 'case'), type, movement.calibre);
  return { seed, type, movement, face, case: kase };
}
// a kept face on a new calibre keeps its look, not its seconds display
function pickKeep(f) { const { seconds, ...rest } = f; return rest; }

// ── a readable list for the panel ───────────────────────────────────────────
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
export function describe(spec) {
  const m = spec.movement, f = spec.face, c = spec.case, rows = [];
  rows.push(['Type', TYPES[spec.type].name]);
  rows.push(['Maker', `${f.brand}, ${f.city}`]);
  rows.push(['Movement', `${CALIBRE_NAMES[m.calibre]}${spec.type === 'wall' || spec.type === 'alarm' ? ' (clock platform)' : ''}`]);
  rows.push(['Finish', `${cap(m.plate)} bridges, ${m.wheels} wheels, ${m.screws} screws, ${m.jewels} jewels`]);
  rows.push(['Dial', `${f.base.replace('-', ' ')}, ${f.numerals} numerals, ${f.track === 'none' ? 'no track' : f.track + ' track'}`]);
  rows.push(['Hands', `${f.handStyle}, ${f.handColor}; seconds ${f.seconds}`]);
  if (spec.type === 'pocket') rows.push(['Case', `${c.metal} ${c.style}, ${c.bezel} bezel, ${c.crystal} crystal, ${c.back} back`]);
  if (spec.type === 'wrist') rows.push(['Case', `${c.metal} ${c.shape}, ${c.bezel} bezel, ${c.crown} crown`], ['Strap', c.strap === 'leather' ? `${c.leather} leather` : c.strap === 'bracelet' ? `${c.metal} bracelet` : `${c.metal} mesh`]);
  if (spec.type === 'wall') rows.push(['Case', `${c.style}, ${c.diameter} mm, ${c.style === 'schoolhouse' ? c.wood : c.style === 'kitchen' ? c.paint + ' paint' : c.metal}`]);
  if (spec.type === 'alarm') {
    const h = Math.floor(c.alarmAt / 60) || 12, mm = String(c.alarmAt % 60).padStart(2, '0');
    rows.push(['Case', `${c.body === 'painted' ? c.paint + ' painted' : c.body} drum, ${c.diameter} mm, ${c.bells} bells, ${c.feet} feet`], ['Alarm', `set for ${h}:${mm}`]);
  }
  return rows;
}
