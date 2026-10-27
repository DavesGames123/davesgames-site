// ============================================================================
//  MUSHROOM DRAW  ·  engine/params.js — the parameter schema and its helpers
// ----------------------------------------------------------------------------
//  Original code (davesgames.io). No DOM. engine.js re-exports every
//  name here, so callers import from engine.js. PROFILES and SHAPES are
//  index-aligned: SHAPES[profile] is the base meridian of capShape().
//  sanitize() clamps to the schema; mutate, blendParams, takeGroup,
//  applyLocks and diffParams all return sanitized params.
//
//  GREP MAP
//    grep -n 'export const PROFILES'         the cap profiles and their base shapes
//    grep -n 'export const PARAMS'           the parameter schema
//    grep -n 'export const DEFAULTS'         the default species
//    grep -n 'export function sanitize'      clamp and round to the schema
//    grep -n 'export function mutate'        a random step; locked keys keep
//    grep -n 'export function blendParams'   a mix of two species
//    grep -n 'export function diffParams'    the fields that differ from a base
// ============================================================================
import { clamp, TAU } from '../geom.js';


// ── PARAMS ──────────────────────────────────────────────────────────────────
export const PROFILES = ['Egg', 'Convex', 'Bell', 'Conical', 'Plane', 'Umbonate', 'Funnel', 'Parasol', 'Morel', 'Puffball'];
// q: superellipse power (1 cone, 2 dome, 4 flat top); cl: closure past
// the equator; um: umbo; dp: central depression; fl: margin flare.
export const SHAPES = [
  { q: 2.0, cl: 0.7, um: 0, dp: 0, fl: 0 },
  { q: 2.2, cl: 0.12, um: 0, dp: 0, fl: 0 },
  { q: 1.55, cl: 0, um: 0, dp: 0, fl: 0.55 },
  { q: 1.12, cl: 0, um: 0, dp: 0, fl: 0.1 },
  { q: 4.0, cl: 0.02, um: 0, dp: 0, fl: 0 },
  { q: 3.0, cl: 0, um: 0.6, dp: 0, fl: 0 },
  { q: 2.0, cl: 0, um: 0, dp: 1, fl: 0 },
  { q: 2.6, cl: 0, um: 0.45, dp: 0, fl: 0 },
  { q: 1.35, cl: 0, um: 0, dp: 0, fl: 0 },
  { q: 2.0, cl: 1.05, um: 0, dp: 0, fl: 0 },
];
export const MOREL = 8, PUFF = 9;

const E_ = (key, group, label, opts) => ({ key, group, label, kind: 'enum', opts, min: 0, max: opts.length - 1, step: 1 });
const B_ = (key, group, label) => ({ key, group, label, kind: 'bool', min: 0, max: 1, step: 1 });
const I_ = (key, group, label, min, max) => ({ key, group, label, kind: 'int', min, max, step: 1 });
const F_ = (key, group, label, min, max, step = 0.01) => ({ key, group, label, kind: 'float', min, max, step });

export const GROUPS = [
  { id: 'cap', label: 'Cap' },
  { id: 'under', label: 'Underside' },
  { id: 'stem', label: 'Stem' },
  { id: 'surface', label: 'Surface' },
  { id: 'colour', label: 'Colour wash' },
  { id: 'cluster', label: 'Cluster and ground' },
  { id: 'view', label: 'View' },
];
export const PARAMS = [
  E_('profile', 'cap', 'Profile', PROFILES),
  F_('capR', 'cap', 'Cap radius', 12, 120, 1),
  F_('capH', 'cap', 'Cap height', 0.05, 2.6),
  F_('age', 'cap', 'Age', 0, 1),
  F_('margin', 'cap', 'Margin', -1, 1),
  F_('umbo', 'cap', 'Umbo', 0, 1),
  F_('flesh', 'cap', 'Flesh', 0.05, 0.6),
  F_('wobble', 'cap', 'Wavy margin', 0, 1),
  E_('under', 'under', 'Underside', ['Gills', 'Pores', 'Teeth', 'Ridges', 'Smooth']),
  I_('gills', 'under', 'Gill count', 10, 110),
  I_('lamellulae', 'under', 'Short gills', 0, 3),
  F_('stemH', 'stem', 'Stem height', 0.15, 6),
  F_('stemTop', 'stem', 'Top width', 0.05, 0.9),
  F_('stemBot', 'stem', 'Base width', 0.05, 1),
  F_('bulb', 'stem', 'Bulb', 0, 1),
  F_('lean', 'stem', 'Lean', -0.5, 0.5),
  F_('curve', 'stem', 'Curve', -0.6, 0.6),
  E_('ring', 'stem', 'Ring', ['None', 'Ring', 'Skirt']),
  F_('ringPos', 'stem', 'Ring height', 0.2, 0.95),
  F_('volva', 'stem', 'Volva', 0, 1),
  E_('stemTex', 'stem', 'Texture', ['Smooth', 'Fibres', 'Snakeskin', 'Net', 'Scaly']),
  E_('marks', 'surface', 'Cap marks', ['None', 'Warts', 'Spots', 'Scales', 'Zones', 'Granules']),
  I_('markN', 'surface', 'Mark count', 0, 240),
  F_('markSize', 'surface', 'Mark size', 0.3, 2.5),
  F_('striate', 'surface', 'Striations', 0, 1),
  F_('hatch', 'surface', 'Hatch density', 0, 1),
  F_('shade', 'surface', 'Shading', 0, 1),
  F_('capHue', 'colour', 'Cap hue', 0, 360, 1),
  F_('capSat', 'colour', 'Cap saturation', 0, 1),
  F_('capLit', 'colour', 'Cap lightness', 0.08, 0.97),
  F_('markLit', 'colour', 'Mark lightness', 0.05, 0.98),
  F_('gillHue', 'colour', 'Underside hue', 0, 360, 1),
  F_('gillSat', 'colour', 'Underside saturation', 0, 1),
  F_('gillLit', 'colour', 'Underside lightness', 0.08, 0.97),
  F_('fleshHue', 'colour', 'Stem hue', 0, 360, 1),
  F_('fleshSat', 'colour', 'Stem saturation', 0, 1),
  F_('fleshLit', 'colour', 'Stem lightness', 0.08, 0.97),
  I_('count', 'cluster', 'Count', 1, 7),
  F_('ageSpread', 'cluster', 'Age spread', 0, 1),
  F_('sizeVar', 'cluster', 'Size spread', 0, 1),
  F_('scatter', 'cluster', 'Scatter', 0, 1),
  B_('ground', 'cluster', 'Ground'),
  F_('moss', 'cluster', 'Moss', 0, 1),
  I_('grass', 'cluster', 'Grass tufts', 0, 14),
  I_('litter', 'cluster', 'Leaf litter', 0, 16),
  F_('elev', 'view', 'Camera height', -0.45, 0.45),
];
export const PARAM_BY_KEY = Object.fromEntries(PARAMS.map(d => [d.key, d]));

export const DEFAULTS = {
  profile: 1, capR: 70, capH: 0.6, age: 0.55, margin: 0, umbo: 0, flesh: 0.25, wobble: 0.15,
  under: 0, gills: 60, lamellulae: 1,
  stemH: 1.6, stemTop: 0.2, stemBot: 0.26, bulb: 0.2, lean: 0, curve: 0.1, ring: 0, ringPos: 0.8, volva: 0, stemTex: 0,
  marks: 0, markN: 40, markSize: 1, striate: 0.2, hatch: 0.5, shade: 0.6,
  capHue: 28, capSat: 0.5, capLit: 0.45, markLit: 0.9, gillHue: 40, gillSat: 0.2, gillLit: 0.85, fleshHue: 40, fleshSat: 0.2, fleshLit: 0.88,
  count: 1, ageSpread: 0.5, sizeVar: 0.4, scatter: 0.5, ground: 1, moss: 0.3, grass: 3, litter: 4, elev: 0.12,
};

// ── sanitize, mutate, blend ─────────────────────────────────────────────────
export function roundTo(v, step) {
  const d = Math.min(4, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
  return +(+v).toFixed(d);
}
// Clamps each field to its range and rounds int, enum and bool fields.
// Unknown keys drop out; missing keys take DEFAULTS.
export function sanitize(p) {
  const o = {};
  for (const d of PARAMS) {
    let v = p && p[d.key] !== undefined ? +p[d.key] : DEFAULTS[d.key];
    if (!Number.isFinite(v)) v = DEFAULTS[d.key];
    v = clamp(v, d.min, d.max);
    o[d.key] = d.kind === 'float' ? v : Math.round(v);
  }
  return o;
}
function gauss(rnd) {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}
// spread 0..1; locked: a Set of keys that do not change. Profile and
// underside switch rarely, so a mutation keeps the species readable.
export function mutate(p, spread, rnd, locked = null) {
  const o = Object.assign({}, p);
  for (const d of PARAMS) {
    if (locked && locked.has(d.key)) continue;
    if (rnd() > 0.3 + spread) continue;
    const v = +o[d.key];
    if (d.kind === 'float' || d.kind === 'int') {
      const k = d.group === 'colour' ? 0.35 : 0.5;
      o[d.key] = roundTo(clamp(v + gauss(rnd) * spread * (d.max - d.min) * k, d.min, d.max), d.step);
    } else if (d.kind === 'enum') {
      const rare = d.key === 'profile' || d.key === 'under' ? 0.12 : 0.35;
      if (rnd() < spread * rare) o[d.key] = Math.floor(rnd() * d.opts.length);
    } else if (rnd() < spread * 0.2) o[d.key] = v ? 0 : 1;
  }
  return sanitize(o);
}
export function blendParams(a, b, t) {
  const o = {};
  for (const d of PARAMS) {
    const x = +a[d.key], y = +b[d.key];
    if (d.kind === 'float') {
      if (d.key.endsWith('Hue')) { let dh = ((y - x + 540) % 360) - 180; o[d.key] = (x + dh * t + 360) % 360; }
      else o[d.key] = x + (y - x) * t;
    } else if (d.kind === 'int') o[d.key] = Math.round(x + (y - x) * t);
    else o[d.key] = t < 0.5 ? x : y;
  }
  return sanitize(o);
}
export function takeGroup(p, fresh, group, locked = null) {
  const o = Object.assign({}, p);
  for (const d of PARAMS) if (d.group === group && !(locked && locked.has(d.key))) o[d.key] = fresh[d.key];
  return sanitize(o);
}
export function applyLocks(p, keep, locked) {
  if (!locked || !locked.size) return p;
  const o = Object.assign({}, p);
  for (const k of locked) if (k in keep) o[k] = keep[k];
  return sanitize(o);
}
export function diffParams(p, base) {
  const o = {};
  for (const d of PARAMS) {
    if (+p[d.key] === +base[d.key]) continue;
    o[d.key] = roundTo(p[d.key], d.kind === 'float' ? Math.min(d.step, 0.001) : 1);
  }
  return o;
}

