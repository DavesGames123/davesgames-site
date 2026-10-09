// ============================================================================
//  CT EXPLAINED  ·  colour theme  (ES module, no DOM)
// ----------------------------------------------------------------------------
//  One page-wide colour map choice for every figure. Scenes do not name a
//  map. They name a role, and Raster.set (draw.js) gets the LUT here:
//
//      role      classic map   what it colours
//      @image    bone          objects and reconstructions
//      @data     magma         sinograms, Fourier magnitude, projections
//      @hu       grey          the Hounsfield window figure
//      @signed   berlin        signed images (error = recon - object)
//
//  With no choice ("Classic"), each role keeps its classic map. When the
//  reader picks a map, @image, @data and @hu use it, with reverse and
//  gamma. @signed always uses a diverging map: the partner of the group
//  of the chosen map (PARTNER below), so a signed figure keeps zero in
//  the middle of the scale. The partners have a dark middle (berlin,
//  vanimo, managua): zero error then looks like the dark page, not white.
//
//  The choice persists per viewer in localStorage (key KEY). Every
//  storage access is in try/catch, so the page works without storage.
//  The saver sets a temporary choice with { persist: false } and can
//  cross-fade two choices with setFade(); it restores the old choice on
//  exit.
//
//  GREP MAP
//    grep -n 'export const CLASSIC'      classic map of each role
//    grep -n 'export function lutFor'    768-byte LUT of a role (cached)
//    grep -n 'export function setTheme'  change the choice, persist it
//    grep -n 'export function setFade'   cross-fade from an earlier choice
//    grep -n 'export function mixLut'    linear blend of two LUTs
//    grep -n 'export function mapBag'    seeded map order for the saver
// ============================================================================
import * as CM from '../ct-lab/colormaps/maps.js';

export const KEY = 'ct-explained.cmap.v1';
export const CLASSIC = Object.freeze({ image: 'bone', data: 'magma', hu: 'grey', signed: 'berlin' });
export const PICKER_GROUPS = ['grey', 'medical', 'perceptual', 'cyclic', 'artistic'];
export const PARTNER = Object.freeze({ grey: 'berlin', medical: 'vanimo', perceptual: 'berlin', cyclic: 'managua', artistic: 'vanimo' });

const T = { id: null, reverse: false, gamma: 1, version: 1, fade: null };
const listeners = new Set();
const cache = new Map();

export const isRole = (c) => typeof c === 'string' && c.charCodeAt(0) === 64; // '@'
export function version() { return T.version; }
export function state() { return { id: T.id, reverse: T.reverse, gamma: T.gamma }; }
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** The diverging partner of a map: the map itself when it is diverging. */
export function partnerOf(id) {
  if (!id) return CLASSIC.signed;
  const m = CM.get(id);
  if (m.kind === 'diverging') return m.id;
  return PARTNER[m.group] || CLASSIC.signed;
}

/** { id, reverse, gamma } of a role under a choice s ({ id: null } = classic). */
export function specFor(role, s = T) {
  const r = String(role).replace(/^@/, '');
  const base = CLASSIC[r] ? r : 'image';
  if (base === 'signed') return { id: partnerOf(s.id), reverse: false, gamma: 1 };
  if (!s.id) return { id: CLASSIC[base], reverse: false, gamma: 1 };
  return { id: s.id, reverse: !!s.reverse, gamma: s.gamma > 0 ? +s.gamma : 1 };
}

/** Linear blend of two 768-byte LUTs: k = 0 gives a, k = 1 gives b. */
export function mixLut(a, b, k, out = new Uint8Array(768)) {
  const t = k < 0 ? 0 : k > 1 ? 1 : k;
  for (let i = 0; i < 768; i++) out[i] = Math.round(a[i] + (b[i] - a[i]) * t);
  return out;
}

/** The 768-byte LUT of a role now (with the cross-fade when one runs). */
export function lutFor(role) {
  const key = `${T.version}|${role}`;
  let lut = cache.get(key);
  if (lut) return lut;
  const now = specFor(role);
  lut = CM.variant(now.id, now);
  if (T.fade && T.fade.k < 1) {
    const was = specFor(role, T.fade.from);
    lut = mixLut(CM.variant(was.id, was), lut, T.fade.k);
  }
  if (cache.size > 64) cache.clear();
  cache.set(key, lut);
  return lut;
}

/** The map id a role shows now (for labels and tests). */
export function idFor(role) { return specFor(role).id; }

function bump() {
  T.version++;
  for (const fn of listeners) { try { fn(state()); } catch (e) { /* a listener is optional */ } }
}

function store(storage) {
  if (storage !== undefined) return storage;
  try { return globalThis.localStorage || null; } catch (e) { return null; }
}

/** Change the choice. next.id null or 'classic' = classic. opts.persist (default true). */
export function setTheme(next = {}, opts = {}) {
  const id = next.id === undefined ? T.id : (next.id && next.id !== 'classic' && CM.has(next.id) ? next.id : null);
  T.id = id;
  if (next.reverse !== undefined) T.reverse = !!next.reverse;
  if (next.gamma !== undefined) T.gamma = next.gamma > 0 && Number.isFinite(+next.gamma) ? +next.gamma : 1;
  if (!id) { T.reverse = next.reverse !== undefined ? !!next.reverse : false; }
  T.fade = null;
  if (opts.persist !== false) save(opts.storage);
  bump();
  return state();
}

/** Start or move a cross-fade from choice `from` to the current choice. k in 0..1. */
export function setFade(from, k) {
  T.fade = from && k < 1 ? { from: { id: from.id || null, reverse: !!from.reverse, gamma: from.gamma || 1 }, k: Math.max(0, k) } : null;
  bump();
}

export function save(storage) {
  const s = store(storage);
  if (!s) return false;
  try { s.setItem(KEY, JSON.stringify(state())); return true; } catch (e) { return false; }
}

/** Read the stored choice. Bad or absent data gives classic. Never throws. */
export function load(storage) {
  let v = null;
  const s = store(storage);
  if (s) { try { v = JSON.parse(s.getItem(KEY) || 'null'); } catch (e) { v = null; } }
  const ok = v && typeof v === 'object' && (v.id === null || (CM.has(v.id) && PICKER_GROUPS.includes(CM.get(v.id).group)));
  setTheme(ok ? { id: v.id, reverse: !!v.reverse, gamma: +v.gamma || 1 } : { id: null, reverse: false, gamma: 1 }, { persist: false });
  return state();
}

// ---------------------------------------------------------------- saver bag
// A seeded order of maps. Each refill shuffles the pool again. next(kind)
// never gives the map it gave last (also across refills). kind 'signed'
// draws from the diverging maps; any other kind from SAVER_POOL.
export const SAVER_POOL = [
  ...['viridis', 'magma', 'inferno', 'plasma', 'cividis', 'mako', 'rocket', 'cubehelix', 'turbo'],
  ...['bone', 'pink-tissue', 'hot-iron', 'pet-rainbow', 'ocean', 'copper', 'ice'],
  ...['aurora', 'nebula', 'ember', 'glacier', 'synthwave', 'gold-leaf', 'xray-blue', 'cyanotype', 'forest', 'rose', 'orchid'],
  'grey', 'sepia', 'twilight',
];
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function mapBag(seed, o = {}) {
  const R = rng(seed);
  const pools = { seq: (o.pool || SAVER_POOL).filter((id) => CM.has(id)), signed: CM.list('diverging').map((m) => m.id) };
  const bags = { seq: [], signed: [] };
  let last = null;
  const refill = (k) => {
    const b = pools[k].slice();
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
    bags[k] = b;
  };
  return {
    next(kind = 'seq') {
      const k = kind === 'signed' ? 'signed' : 'seq';
      if (!bags[k].length) refill(k);
      let i = bags[k].length - 1;
      if (bags[k][i] === last && bags[k].length > 1) i = 0;
      if (bags[k][i] === last) { refill(k); i = bags[k][bags[k].length - 1] === last ? 0 : bags[k].length - 1; }
      const id = bags[k].splice(i, 1)[0];
      last = id;
      return id;
    },
    get last() { return last; },
  };
}
