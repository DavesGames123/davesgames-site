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
//  REGISTRIES
//    types/index.js   the case types (spec side): which calibres fit each,
//                     its case choices, its Spec rows, its sizes
//    CALIBRE_INFO     what the face needs from each calibre: its seconds
//                     display (small, aperture, centre, none), caption,
//                     and where its small seconds or aperture sits
//    catalog.js       the face choices and their weights by era
//  A calibre listed by a type but missing from CALIBRE_INFO is skipped.
//  In a clock a small-seconds calibre shows no seconds.
//
//  GREP MAP
//    function rng ............ seeded generator (xmur3 + mulberry32)
//    const CALIBRE_INFO ...... per-calibre face facts
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

import { TYPE_LIST } from './types/index.js';
import * as CAT from './catalog.js';
import { HAND_NAMES } from './hands.js';
export { FINISH, METALS, PAINTS, WOODS, LEATHERS } from './palettes.js';
export { DIAL_BASES, NUMERALS, TRACKS, HAND_STYLES } from './catalog.js';

// ── registries ──────────────────────────────────────────────────────────────
export const TYPES = Object.fromEntries(TYPE_LIST.map(t => [t.id, t]));
export const CALIBRE_INFO = {
  lever: { name: 'Swiss lever', seconds: 'small', line: 'CHRONOMETER', sub: cal => [-cal.L.F[1], 3.95] },
  tourbillon: { name: 'Tourbillon', seconds: 'aperture', line: 'TOURBILLON', aperture: cal => [-cal.L.O[1], cal.CAL.cageR + 0.15] },
  automatic: { name: 'Automatic', seconds: 'centre', line: 'AUTOMATIC' },
  verge: { name: 'Verge fusee', seconds: 'none' },
};
export const CALIBRE_NAMES = new Proxy({}, { get: (_, k) => (CALIBRE_INFO[k] || {}).name || String(k) });
const fits = type => TYPES[type].calibres.filter(([c]) => CALIBRE_INFO[c]);

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
  const calibre = R.weighted(fits(type));
  const plate = calibre === 'verge' ? R.weighted([['gilt', 8], ['rose', 1]]) : R.weighted([['rhodium', 5], ['gilt', 2], ['two-tone', 2], ['black', 1.2], ['rose', 1]]);
  return {
    calibre, plate,
    wheels: plate === 'black' ? R.pick(['gilt', 'rose', 'rhodium']) : R.weighted([['gilt', 6], ['rhodium', 2], ['rose', 1.2], ['black', 0.6]]),
    screws: R.weighted([['blued', 6], ['polished', 2], ['gold', 1.5]]),
    jewels: R.weighted([['ruby', 8], ['sapphire', 1.2], ['clear', 0.8]]),
    balance: R.weighted([['glucydur', 5], ['gold', 2], ['steel', 1.5]]),
  };
}
// the seconds display follows the calibre; a clock shows no small seconds
function secondsFor(type, calibre) {
  const s = (CALIBRE_INFO[calibre] || {}).seconds || 'none';
  return TYPES[type].clock && s === 'small' ? 'none' : s;
}
function faceSpec(R, type, calibre) {
  const era = CAT.eraOf(type, calibre), base = CAT.pickBase(R, era);
  return {
    base, numerals: CAT.pickNumerals(R, era, !!TYPES[type].clock, base), track: CAT.pickTrack(R, era),
    seconds: secondsFor(type, calibre), brand: makerName(R), city: R.pick(CITIES),
    handStyle: CAT.pickHands(R, era), ...CAT.pickColours(R, base),
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
  const kase = prev && keep.case && prev.type === type ? prev.case : TYPES[type].caseSpec(rng(seed, 'case'), movement.calibre);
  return { seed, type, movement, face, case: kase };
}
// a kept face on a new calibre keeps its look, not its seconds display
function pickKeep(f) { const { seconds, ...rest } = f; return rest; }

// ── a readable list for the panel ───────────────────────────────────────────
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
export function describe(spec) {
  const m = spec.movement, f = spec.face, rows = [];
  rows.push(['Type', TYPES[spec.type].name]);
  rows.push(['Maker', `${f.brand}, ${f.city}`]);
  rows.push(['Movement', `${CALIBRE_NAMES[m.calibre]}${TYPES[spec.type].clock && !['anchor', 'deadbeat', 'brocot'].includes(m.calibre) ? ' (clock platform)' : ''}`]);
  rows.push(['Finish', `${cap(m.plate)} bridges, ${m.wheels} wheels, ${m.screws} screws, ${m.jewels} jewels`]);
  const nm = (map, k) => map[k] || k.replace('-', ' ');
  rows.push(['Dial', `${nm(CAT.BASE_NAMES, f.base)}, ${nm(CAT.NUMERAL_NAMES, f.numerals)} numerals, ${f.track === 'none' ? 'no track' : nm(CAT.TRACK_NAMES, f.track) + ' track'}`]);
  rows.push(['Hands', `${HAND_NAMES[f.handStyle] || f.handStyle}, ${f.handColor}; seconds ${f.seconds}`]);
  rows.push(...TYPES[spec.type].describe(spec));
  return rows;
}
