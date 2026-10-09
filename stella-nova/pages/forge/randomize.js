// ============================================================================
//  PLANET FORGE  ·  randomize.js — strong random draws, locks, mutate, links
// ----------------------------------------------------------------------------
//  draw(mode, seed, preset) -> P: one planet, a pure function of its input.
//    mode 'type'  the family of `preset`, widened (rocky: rockyWiden 0.55;
//                 giants: archetypes.js gasWild with the family's palettes)
//    mode 'rocky' | 'gas' | 'any'  a random family of that kind (all old
//                 and new families), widened to the full range
//  Every draw has P.rand = { mode, seed, type } and P.view (sun azimuth,
//  elevation, exposure; lockSun for an eyeball world). The old presets
//  keep their look: only these draws use the wide ranges and gasx.js.
//
//  GROUPS: the dice and lock groups. Each lists the recipe paths it owns
//  for a rocky world and for a giant. rollGroup(P, id, seed) draws a new
//  member of P's family and copies that group's paths into P.
//  applyLocks(next, prev, locks) copies the locked groups of prev into
//  next (only when both are of one kind; lockKind tells the caller).
//
//  mutate(P, amount, seed): every number moves `amount` (0..1) of the way
//  to a new member of the family; switches (sea liquid, rings on, polar
//  type) flip with chance amount^2. amount 0 returns P unchanged.
//
//  Share links: shareHash(P) -> 'r=<mode>.<seed>[.<type>]' when P is
//  still a pure draw, else 'p=z<base64url deflate-raw JSON>' (or 'p=j...'
//  without CompressionStream). readHash(hash) -> P or null.
//
//  grep -n targets: "export const MODES", "export const GROUPS", "export function draw",
//  "export function rollGroup", "export function applyLocks", "export function mutate",
//  "export async function shareHash", "export async function readHash", "export function clean"
// ============================================================================
import * as PR from './presets.js';
import { makeDice, gasWild, rockyWiden, GAS_FAMILY } from './archetypes.js';
import { sanitizeGx, sanitizeRingx } from './gasx.js';

export const MODES = [
  { id: 'type', label: 'this type' }, { id: 'rocky', label: 'any rocky' },
  { id: 'gas', label: 'any giant' }, { id: 'any', label: 'anything' },
];

const GX_SHAPE = ['jets', 'profile', 'asym', 'eqJet', 'eqWidth', 'jetAmp', 'jetDecay', 'kh', 'khWaves', 'spots', 'spotSize', 'ovalChains', 'polar', 'polySides', 'polyLat', 'cyclones'].map(k => 'gx.' + k);
export const GROUPS = [
  { id: 'shape', label: 'shape and terrain', gasLabel: 'bands and storms',
    rocky: ['seed', 'terrain', 'plates', 'mountains', 'erosion', 'craters', 'features', 'dunes', 'cracks', 'volcanoes', 'relief', 'radiusKm', 'bump', 'tilt', 'spin'],
    gas: ['seed', 'bands', 'turbulence', 'storms', 'relief', 'radiusKm', 'bump', 'tilt', 'spin', ...GX_SHAPE] },
  { id: 'ocean', label: 'oceans and climate', gasLabel: 'heat and aurorae',
    rocky: ['ocean', 'climate', 'rivers', 'lava'], gas: ['glow', 'gx.glowT', 'gx.aurora', 'gx.auroraLat'] },
  { id: 'sky', label: 'atmosphere and clouds', gasLabel: 'atmosphere and haze',
    rocky: ['atmo', 'clouds'], gas: ['atmo', 'haze', 'clouds', 'gx.hood'] },
  { id: 'palette', label: 'palette', rocky: ['palette'], gas: ['palette', 'gx.col', 'gx.accent', 'gx.patchy', 'gx.albedo'] },
  { id: 'rings', label: 'rings', rocky: ['rings', 'ringx'], gas: ['rings', 'ringx'] },
  { id: 'light', label: 'lighting', rocky: ['view'], gas: ['view'] },
];

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const families = kind => PR.PRESETS.filter(p => p.kind === kind).map(p => p.id);

// A clean recipe: SCHEMA numbers clamped (presets.js normalize), gx and
// ringx clamped, view numbers finite.
export function clean(P) {
  const Q = PR.normalize(P);
  if (Q.kind === 'gas' && Q.gx) Q.gx = sanitizeGx(Q.gx);
  if (Q.kind !== 'gas') delete Q.gx;
  if (Q.ringx) Q.ringx = sanitizeRingx(Q.ringx);
  if (Q.view) {
    const v = Q.view, f = (x, d, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(+x) ? +x : d));
    Q.view = { sunAz: f(v.sunAz, 50, -360, 720), sunEl: f(v.sunEl, 12, -60, 60), exposure: f(v.exposure, 0.65, 0.1, 3), ...(v.lockSun ? { lockSun: 1 } : {}) };
  }
  return Q;
}

function randomView(F, P) {
  if (P.view && P.view.lockSun) return { ...P.view, exposure: F.u(0.58, 0.78) };
  return { sunAz: F.u(0, 360), sunEl: F.u(-12, 30), exposure: F.u(0.56, 0.78) };
}

export function draw(mode = 'any', seed = 1, preset = 'earth') {
  seed >>>= 0;
  const F = makeDice(seed, 'draw:' + mode);
  let id;
  if (mode === 'type') id = PR.presetById(preset).id;
  else id = F.pick(families(mode === 'any' ? (F.coin(0.5) ? 'rocky' : 'gas') : mode));
  const pr = PR.presetById(id), s2 = F.i(0, 999999);
  let P;
  if (pr.kind === 'gas') {
    const fam = GAS_FAMILY[id] || {};
    const o = mode === 'type' ? fam : { ...fam, wild: Math.max(fam.wild ?? 1, 0.75) };
    P = PR.merge(PR.GAS_DEFAULT, gasWild(makeDice(s2, 'gas:' + id), o));
  } else {
    P = rockyWiden(makeDice(s2, 'widen:' + id), PR.fromPreset(id, s2), mode === 'type' ? 0.55 : 1);
  }
  P.seed = s2; P.name = pr.name; P.preset = id;
  P.view = randomView(makeDice(s2, 'view:' + mode), P);
  P = clean(P);
  P.rand = mode === 'type' ? { mode, seed, type: id } : { mode, seed };
  return P;
}

// copy one recipe path from src to dst (a top-level key missing in src
// is deleted from dst; a missing nested key is left alone)
function copyPath(dst, src, path) {
  const v = PR.getPath(src, path);
  if (v === undefined) { if (!path.includes('.')) delete dst[path]; return; }
  PR.setPath(dst, path, PR.clone(v));
}
const groupPaths = (id, kind) => (GROUPS.find(g => g.id === id) || { rocky: [], gas: [] })[kind === 'gas' ? 'gas' : 'rocky'];

export function rollGroup(P, id, seed) {
  const donor = draw('type', seed, P.preset), out = PR.clone(P);
  if (donor.kind === P.kind) for (const path of groupPaths(id, P.kind)) copyPath(out, donor, path);
  delete out.rand;
  return clean(out);
}

// Can locks carry over to a planet of this kind? (one kind only)
export const lockKind = (locks, prev) => Object.values(locks || {}).some(Boolean) ? prev.kind : null;
export function applyLocks(next, prev, locks) {
  if (!prev || next.kind !== prev.kind || !Object.values(locks || {}).some(Boolean)) return next;
  const out = PR.clone(next);
  for (const g of GROUPS) if (locks[g.id]) for (const path of groupPaths(g.id, next.kind)) copyPath(out, prev, path);
  delete out.rand;
  return clean(out);
}

const SKIP = new Set(['kind', 'name', 'preset', 'rand', 'seed', 'view.lockSun']);
// switches, and counts whose change moves every feature (a new plate or
// jet count redraws the whole layout), flip as a whole
const DISCRETE = ['ocean.liquid', 'rings.on', 'atmo.on', 'bands.symmetric', 'storms.spot', 'storms.polar', 'gx.polar', 'gx.spots', 'gx.ovalChains', 'gx.polySides',
  'gx.jets', 'gx.cyclones', 'gx.khWaves', 'plates.count', 'turbulence.steps', 'volcanoes.count', 'features.basins', 'features.shields', 'storms.small', 'storms.ovals', 'bands.count'];
export function mutate(P, amount, seed) {
  const a = Math.min(1, Math.max(0, +amount || 0));
  if (a === 0) return PR.clone(P);
  const donor = draw('type', seed, P.preset);
  if (donor.kind !== P.kind) return PR.clone(P);
  const F = makeDice(seed, 'mutate'), out = PR.clone(P), disc = new Set(DISCRETE);
  const walk = (o, d, path) => {
    for (const k of Object.keys(o)) {
      const p = path + k;
      if (SKIP.has(p) || disc.has(p)) continue;
      const v = o[k], w = d[k];
      if (typeof v === 'number' && typeof w === 'number' && Number.isFinite(w)) o[k] = v + a * (w - v);
      else if (Array.isArray(v) && Array.isArray(w) && v.length === w.length) walk(v, w, p + '.');
      else if (isObj(v) && isObj(w)) walk(v, w, p + '.');
    }
  };
  walk(out, donor, '');
  for (const path of DISCRETE) {
    const w = PR.getPath(donor, path);
    if (w !== undefined && PR.getPath(out, path) !== undefined && F.r() < a * a) PR.setPath(out, path, w);
  }
  if (out.rings.on && !out.ringx && donor.ringx && F.r() < a) out.ringx = PR.clone(donor.ringx);
  if (a >= 0.6 && F.r() < a) out.seed = donor.seed;
  delete out.rand;
  return clean(out);
}

// ── share links ─────────────────────────────────────────────────────────
const b64u = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = str => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/')); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; };
async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
const canZip = () => typeof CompressionStream === 'function';

const strip = P => { const Q = PR.clone(P); delete Q.rand; return Q; };
export function isPureDraw(P) {
  const r = P && P.rand;
  if (!r) return false;
  try { return JSON.stringify(strip(draw(r.mode, r.seed, r.type))) === JSON.stringify(strip(P)); } catch (e) { return false; }
}
export async function shareHash(P) {
  if (isPureDraw(P)) return 'r=' + [P.rand.mode, P.rand.seed, P.rand.mode === 'type' ? P.rand.type : null].filter(v => v != null).join('.');
  const json = new TextEncoder().encode(JSON.stringify(strip(P)));
  if (canZip()) { try { return 'p=z' + b64u(await pipe(json, new CompressionStream('deflate-raw'))); } catch (e) { /* plain below */ } }
  return 'p=j' + b64u(json);
}
export async function readHash(hash) {
  const h = String(hash || '').replace(/^#/, '');
  try {
    if (h.startsWith('r=')) {
      const [mode, seed, type] = h.slice(2).split('.');
      if (!MODES.some(m => m.id === mode)) return null;
      return draw(mode, +seed >>> 0, type);
    }
    if (h.startsWith('p=')) {
      const body = h.slice(3), kind = h[2];
      const bytes = kind === 'z' ? await pipe(unb64u(body), new DecompressionStream('deflate-raw')) : unb64u(body);
      const P = JSON.parse(new TextDecoder().decode(bytes));
      return isObj(P) ? clean(P) : null;
    }
  } catch (e) { return null; }
  return null;
}
