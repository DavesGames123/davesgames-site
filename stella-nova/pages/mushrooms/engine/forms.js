// ============================================================================
//  MUSHROOM DRAW  ·  engine/forms.js — the presets and the random species
// ----------------------------------------------------------------------------
//  Original code (davesgames.io). No DOM. engine.js re-exports every
//  name here. FORMS holds the presets; randomParams(seed) makes a
//  plausible species from the seed; formParams(form, seed) gives either.
//
//  GREP MAP
//    grep -n 'export const FORMS'             the presets
//    grep -n 'export function randomParams'   a plausible random species
//    grep -n 'export function formParams'     the params of a form key
// ============================================================================
import { clamp, mulberry } from '../geom.js';
import { DEFAULTS, sanitize, MOREL, PUFF } from './params.js';


// ── FORMS ───────────────────────────────────────────────────────────────────
// The presets. Each names the look of a real group of mushrooms; the
// params are our own estimates. No psilocybin species.
export const FORMS = {
  fly: { label: 'Fly agaric', latin: 'Amanita-like', p: { profile: 1, capR: 78, capH: 0.62, age: 0.55, margin: 0.05, umbo: 0, flesh: 0.25, wobble: 0.12,
    under: 0, gills: 72, lamellulae: 2, stemH: 1.9, stemTop: 0.16, stemBot: 0.24, bulb: 0.85, lean: 0.04, curve: 0.08, ring: 2, ringPos: 0.84, volva: 0.3, stemTex: 0,
    marks: 1, markN: 70, markSize: 1, striate: 0.45, hatch: 0.55, shade: 0.6, capHue: 4, capSat: 0.82, capLit: 0.47, markLit: 0.96,
    gillHue: 50, gillSat: 0.2, gillLit: 0.93, fleshHue: 50, fleshSat: 0.15, fleshLit: 0.94,
    count: 2, ageSpread: 0.65, sizeVar: 0.4, scatter: 0.5, ground: 1, moss: 0.5, grass: 4, litter: 5, elev: 0.14 } },
  parasol: { label: 'Parasol', latin: 'Macrolepiota-like', p: { profile: 7, capR: 105, capH: 0.3, age: 0.72, margin: 0.05, umbo: 0.6, flesh: 0.15, wobble: 0.1,
    under: 0, gills: 96, lamellulae: 1, stemH: 2.5, stemTop: 0.08, stemBot: 0.13, bulb: 0.75, lean: -0.05, curve: 0.12, ring: 1, ringPos: 0.74, volva: 0, stemTex: 2,
    marks: 3, markN: 90, markSize: 1.1, striate: 0, hatch: 0.5, shade: 0.55, capHue: 34, capSat: 0.3, capLit: 0.8, markLit: 0.32,
    gillHue: 40, gillSat: 0.1, gillLit: 0.92, fleshHue: 35, fleshSat: 0.14, fleshLit: 0.84,
    count: 2, ageSpread: 0.8, sizeVar: 0.3, scatter: 0.7, ground: 1, moss: 0.2, grass: 7, litter: 3, elev: 0.04 } },
  bolete: { label: 'Bolete', latin: 'Boletus-like', p: { profile: 1, capR: 85, capH: 0.55, age: 0.55, margin: -0.05, umbo: 0, flesh: 0.45, wobble: 0.1,
    under: 1, gills: 60, lamellulae: 0, stemH: 1.15, stemTop: 0.36, stemBot: 0.52, bulb: 0.6, lean: 0.05, curve: 0.1, ring: 0, ringPos: 0.8, volva: 0, stemTex: 3,
    marks: 0, markN: 0, markSize: 1, striate: 0, hatch: 0.6, shade: 0.65, capHue: 24, capSat: 0.55, capLit: 0.36, markLit: 0.5,
    gillHue: 52, gillSat: 0.65, gillLit: 0.68, fleshHue: 38, fleshSat: 0.3, fleshLit: 0.78,
    count: 2, ageSpread: 0.5, sizeVar: 0.4, scatter: 0.45, ground: 1, moss: 0.3, grass: 2, litter: 8, elev: -0.14 } },
  chanterelle: { label: 'Chanterelle', latin: 'Cantharellus-like', p: { profile: 6, capR: 55, capH: 0.12, age: 0.6, margin: -0.15, umbo: 0, flesh: 0.3, wobble: 0.85,
    under: 3, gills: 46, lamellulae: 0, stemH: 1.1, stemTop: 0.32, stemBot: 0.17, bulb: 0, lean: 0, curve: 0.15, ring: 0, ringPos: 0.8, volva: 0, stemTex: 0,
    marks: 0, markN: 0, markSize: 1, striate: 0, hatch: 0.5, shade: 0.55, capHue: 40, capSat: 0.85, capLit: 0.55, markLit: 0.5,
    gillHue: 40, gillSat: 0.8, gillLit: 0.6, fleshHue: 42, fleshSat: 0.7, fleshLit: 0.7,
    count: 3, ageSpread: 0.5, sizeVar: 0.5, scatter: 0.5, ground: 1, moss: 0.6, grass: 0, litter: 6, elev: -0.06 } },
  inkcap: { label: 'Shaggy ink cap', latin: 'Coprinus-like', p: { profile: 2, capR: 30, capH: 2.3, age: 0.35, margin: -0.05, umbo: 0.1, flesh: 0.15, wobble: 0.2,
    under: 0, gills: 80, lamellulae: 1, stemH: 3.4, stemTop: 0.3, stemBot: 0.36, bulb: 0.3, lean: 0.05, curve: 0.1, ring: 1, ringPos: 0.28, volva: 0, stemTex: 1,
    marks: 3, markN: 110, markSize: 0.9, striate: 0.2, hatch: 0.5, shade: 0.5, capHue: 32, capSat: 0.12, capLit: 0.93, markLit: 0.55,
    gillHue: 20, gillSat: 0.08, gillLit: 0.82, fleshHue: 40, fleshSat: 0.05, fleshLit: 0.95,
    count: 3, ageSpread: 0.7, sizeVar: 0.4, scatter: 0.4, ground: 1, moss: 0, grass: 9, litter: 1, elev: 0.06 } },
  bonnet: { label: 'Bonnet', latin: 'Mycena-like', p: { profile: 3, capR: 16, capH: 1.05, age: 0.55, margin: 0, umbo: 0.2, flesh: 0.1, wobble: 0.2,
    under: 0, gills: 24, lamellulae: 1, stemH: 5.6, stemTop: 0.12, stemBot: 0.15, bulb: 0, lean: 0.15, curve: 0.35, ring: 0, ringPos: 0.8, volva: 0, stemTex: 0,
    marks: 0, markN: 0, markSize: 1, striate: 0.95, hatch: 0.45, shade: 0.5, capHue: 28, capSat: 0.25, capLit: 0.55, markLit: 0.5,
    gillHue: 30, gillSat: 0.1, gillLit: 0.88, fleshHue: 30, fleshSat: 0.12, fleshLit: 0.78,
    count: 6, ageSpread: 0.8, sizeVar: 0.5, scatter: 0.5, ground: 1, moss: 0.8, grass: 0, litter: 3, elev: 0.1 } },
  morel: { label: 'Morel', latin: 'Morchella-like', p: { profile: 8, capR: 30, capH: 2.0, age: 0.6, margin: 0, umbo: 0, flesh: 0.2, wobble: 0.3,
    under: 4, gills: 30, lamellulae: 0, stemH: 1.35, stemTop: 0.78, stemBot: 0.95, bulb: 0.3, lean: 0.03, curve: 0.08, ring: 0, ringPos: 0.8, volva: 0, stemTex: 4,
    marks: 0, markN: 120, markSize: 1, striate: 0, hatch: 0.6, shade: 0.6, capHue: 34, capSat: 0.38, capLit: 0.55, markLit: 0.25,
    gillHue: 40, gillSat: 0.2, gillLit: 0.8, fleshHue: 45, fleshSat: 0.3, fleshLit: 0.88,
    count: 2, ageSpread: 0.4, sizeVar: 0.4, scatter: 0.5, ground: 1, moss: 0.3, grass: 3, litter: 7, elev: 0.12 } },
  puffball: { label: 'Puffball', latin: 'Lycoperdon-like', p: { profile: 9, capR: 42, capH: 0.85, age: 0.6, margin: 0, umbo: 0, flesh: 0.2, wobble: 0.15,
    under: 4, gills: 30, lamellulae: 0, stemH: 0.3, stemTop: 0.38, stemBot: 0.32, bulb: 0, lean: 0, curve: 0.05, ring: 0, ringPos: 0.8, volva: 0, stemTex: 1,
    marks: 5, markN: 160, markSize: 0.6, striate: 0, hatch: 0.5, shade: 0.65, capHue: 40, capSat: 0.12, capLit: 0.9, markLit: 0.7,
    gillHue: 40, gillSat: 0.15, gillLit: 0.85, fleshHue: 40, fleshSat: 0.15, fleshLit: 0.88,
    count: 3, ageSpread: 0.5, sizeVar: 0.5, scatter: 0.4, ground: 1, moss: 0.4, grass: 5, litter: 3, elev: 0.22 } },
};
export const FORM_KEYS = Object.keys(FORMS);

// ── randomParams ────────────────────────────────────────────────────────────
// A plausible random species: the profile first, then the rest in the
// ranges that suit it, and a natural palette.
const PALETTES = [
  [4, 0.8, 0.46], [18, 0.75, 0.48], [28, 0.55, 0.38], [24, 0.45, 0.28], [34, 0.35, 0.62], [40, 0.12, 0.9],
  [48, 0.7, 0.58], [60, 0.3, 0.45], [80, 0.2, 0.42], [270, 0.12, 0.5], [210, 0.08, 0.55], [0, 0.6, 0.35], [30, 0.25, 0.7],
];
const pickW = (rnd, w) => { let s = 0; for (const x of w) s += x; let t = rnd() * s; for (let i = 0; i < w.length; i++) { t -= w[i]; if (t <= 0) return i; } return w.length - 1; };
const rr = (rnd, a, b) => a + (b - a) * rnd();
export function randomParams(seed) {
  const rnd = mulberry((seed ^ 0x6A09E667) >>> 0);
  const p = Object.assign({}, DEFAULTS);
  const prof = pickW(rnd, [0.05, 0.2, 0.1, 0.12, 0.1, 0.1, 0.1, 0.08, 0.07, 0.08]);
  p.profile = prof;
  const H = [[0.8, 1.2], [0.42, 0.8], [1.1, 2.3], [0.8, 1.4], [0.12, 0.32], [0.18, 0.4], [0.05, 0.2], [0.25, 0.4], [1.6, 2.4], [0.75, 1.0]][prof];
  p.capH = rr(rnd, H[0], H[1]);
  p.capR = 18 + 82 * Math.pow(rnd(), 1.3);
  p.age = rr(rnd, 0.25, 0.85);
  p.margin = rnd() < 0.3 ? rr(rnd, -0.6, 0.4) : 0;
  p.umbo = rnd() < 0.25 ? rr(rnd, 0.1, 0.7) : 0;
  p.flesh = rr(rnd, 0.1, 0.45);
  p.wobble = prof === 6 ? rr(rnd, 0.5, 1) : rr(rnd, 0, 0.35);
  if (prof === MOREL || prof === PUFF) p.under = 4;
  else p.under = pickW(rnd, prof === 6 ? [0.3, 0.05, 0.1, 0.55, 0] : [0.66, prof === 1 || prof === 4 ? 0.2 : 0.05, 0.08, 0.06, 0.03]);
  p.gills = Math.round(rr(rnd, 20, 100));
  p.lamellulae = Math.floor(rnd() * 4);
  const steep = prof === 2 || prof === 3;
  p.stemH = prof === PUFF ? rr(rnd, 0.2, 0.4) : prof === MOREL ? rr(rnd, 1, 1.6) : steep ? rr(rnd, 2.4, 5.6) : rr(rnd, 0.8, 2.6);
  p.stemTop = prof === MOREL ? rr(rnd, 0.65, 0.85) : p.under === 1 ? rr(rnd, 0.25, 0.42) : rr(rnd, 0.08, 0.32);
  p.stemBot = prof === MOREL ? p.stemTop * rr(rnd, 1.05, 1.25) : p.stemTop * rr(rnd, 0.7, 1.6);
  if (prof === PUFF) { p.stemTop = rr(rnd, 0.3, 0.42); p.stemBot = p.stemTop * 0.85; }
  p.bulb = rnd() < 0.35 ? rr(rnd, 0.2, 0.9) : 0;
  p.lean = rr(rnd, -0.2, 0.2);
  p.curve = rr(rnd, -0.3, 0.3);
  const plain = prof === MOREL || prof === PUFF || prof === 6;
  p.ring = plain ? 0 : pickW(rnd, [0.62, 0.23, 0.15]);
  p.ringPos = rr(rnd, 0.55, 0.9);
  p.volva = !plain && rnd() < 0.15 ? rr(rnd, 0.2, 0.9) : 0;
  p.stemTex = prof === MOREL ? 4 : pickW(rnd, [0.4, 0.25, 0.1, p.under === 1 ? 0.4 : 0.05, 0.1]);
  p.marks = prof === MOREL ? 0 : prof === PUFF ? 5 : pickW(rnd, [0.45, 0.14, 0.12, 0.12, 0.1, 0.07]);
  p.markN = Math.round(prof === MOREL ? rr(rnd, 60, 200) : rr(rnd, 20, 140));
  p.markSize = rr(rnd, 0.6, 1.6);
  p.striate = rnd() < 0.35 ? rr(rnd, 0.2, 1) : 0;
  p.hatch = rr(rnd, 0.3, 0.8);
  p.shade = rr(rnd, 0.4, 0.8);
  const pal = PALETTES[Math.floor(rnd() * PALETTES.length)];
  p.capHue = (pal[0] + rr(rnd, -8, 8) + 360) % 360;
  p.capSat = clamp(pal[1] + rr(rnd, -0.1, 0.1), 0, 1);
  p.capLit = clamp(pal[2] + rr(rnd, -0.06, 0.06), 0.1, 0.95);
  p.markLit = p.capLit > 0.6 ? rr(rnd, 0.2, 0.45) : rr(rnd, 0.85, 0.97);
  p.fleshHue = (p.capHue + rr(rnd, -15, 20) + 360) % 360;
  p.fleshSat = rr(rnd, 0.05, 0.35);
  p.fleshLit = rr(rnd, 0.72, 0.93);
  p.gillHue = p.under === 1 ? rr(rnd, 40, 60) : p.fleshHue;
  p.gillSat = p.under === 1 ? rr(rnd, 0.4, 0.7) : rr(rnd, 0.05, 0.3);
  p.gillLit = rr(rnd, 0.62, 0.9);
  p.count = 1 + Math.floor(Math.pow(rnd(), 1.6) * 7);
  p.ageSpread = rr(rnd, 0.2, 0.9);
  p.sizeVar = rr(rnd, 0.2, 0.7);
  p.scatter = rr(rnd, 0.3, 0.8);
  p.ground = 1;
  p.moss = rnd() < 0.6 ? rr(rnd, 0.2, 0.9) : 0;
  p.grass = rnd() < 0.5 ? Math.floor(rr(rnd, 1, 9)) : 0;
  p.litter = Math.floor(rr(rnd, 0, 10));
  p.elev = rr(rnd, -0.25, 0.32);
  return sanitize(p);
}
// The params of a form key ('random' uses the seed).
export function formParams(form, seed) {
  if (FORMS[form]) return sanitize(Object.assign({}, DEFAULTS, FORMS[form].p));
  return randomParams(seed >>> 0);
}
