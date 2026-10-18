// ============================================================================
//  PATTERN DESIGNER  ·  taste.js — tasteful random picks (no DOM)
// ----------------------------------------------------------------------------
//  The page (Randomise all, Shake parameters, Surprise me) and the saver
//  use these picks. They read a random source from engine.js makeRng, so
//  the tests can run them with a fixed seed.
//
//  tasteParams   params near their defaults (within 35% of the range)
//  tasteMods     at most two mild modifiers that suit the family
//  tasteDensity  a Density and a Detail for a random pick: dense by
//                default (D 1.6 to 3.2, under the device cap)
//  usedInks      how many ink slots a pattern uses with its params
//  surprise      a pattern, params, palette and modifiers. The palette
//                must give every used ink a WCAG contrast of 3 or more
//                on the paper (paletteScore); the pick favours a high
//                score, and needs two distinct inks for a pattern that
//                uses two or more.
//
//  grep -n targets: "export const LINE_FAMS", "export function tasteParams",
//                   "export function tasteMods", "export function tasteDensity",
//                   "export function surprise"
// ============================================================================
import { clampParams } from './engine.js';
import { modDefaults } from './modifiers.js';
import { paletteScore } from './color.js';
import { DENSITY, DETAIL } from './density.js';

// Mirror and dash read well on line patterns; on solid tiles a mirror
// cuts blocks at the wedge edge, so those families do not get it.
export const LINE_FAMS = ['flow', 'radial', 'physics', 'distort', 'geometric', 'paths', 'botanical'];

export function tasteParams(p, rng) {
  const P = {};
  for (const k in p.params) {
    const [a, b, step, d, label] = p.params[k];
    // A slot param ("Warp ink") keeps its default, so two parts do not
    // fall on the same ink.
    if (/\bink$/i.test(label)) { P[k] = d; continue; }
    if (step >= 1 && b - a === 1) { P[k] = rng.chance(0.75) ? d : 1 - d; continue; }
    P[k] = Math.max(a, Math.min(b, d + (b - a) * 0.35 * (rng.next() * 2 - 1)));
  }
  return clampParams(p, P);
}
export function tasteMods(rng, p) {
  const out = [], n = rng.weighted([0.6, 0.3, 0.1]);
  const pool = LINE_FAMS.includes(p.family) ? ['warp', 'warp', 'clip', 'mask', 'mirror', 'dash', 'jitter'] : ['warp', 'warp', 'clip', 'clip', 'mask', 'jitter'];
  for (let i = 0; i < n; i++) {
    const t = rng.pick(pool); if (out.some(m => m.type === t)) continue;
    // A mask keeps solids by their centre, so large bands (flow, organic)
    // can drop whole; and a mask then dots leaves too little.
    if (t === 'mask' && (['flow', 'organic', 'opart', 'textile'].includes(p.family) || out.some(m => m.type === 'dash'))) continue;
    if (t === 'dash' && out.some(m => m.type === 'mask')) continue;
    const m = modDefaults(t);
    if (t === 'warp') { m.kind = rng.pick(['lens', 'twirl', 'wave', 'noise']); m.amount = rng.range(0.25, 0.8) * (m.kind === 'lens' && rng.chance(0.3) ? -0.6 : 1); m.size = rng.range(0.35, 0.7); m.cx = rng.range(0.35, 0.65); m.cy = rng.range(0.35, 0.65); }
    if (t === 'clip') { m.shape = rng.pick(['rounded', 'circle', 'arch', 'arch', 'hex']); m.margin = rng.range(0.05, 0.12); }
    if (t === 'mask') { m.shape = rng.pick(['circle', 'arch', 'diamond']); m.margin = rng.range(0.08, 0.16); m.outline = rng.chance(0.5) ? 1 : 0; }
    if (t === 'mirror') { m.kind = rng.pick(['x', 'kaleido', 'kaleido']); m.n = rng.pick([4, 6, 8, 10]); }
    if (t === 'dash') { m.kind = rng.pick(['dash', 'dots']); m.dash = rng.range(8, 30); m.gap = rng.range(5, 16); }
    if (t === 'jitter') { m.amount = rng.range(0.1, 0.35); m.turn = rng.chance(0.4) ? rng.range(0.1, 0.4) : 0; }
    out.push(m);
  }
  return out;
}
// A dense pick: D from 1.6 to 3.2 (at most cap), detail 0.2 to 0.8.
export function tasteDensity(rng, cap = DENSITY.max) {
  const hi = Math.min(cap, 3.2), lo = Math.min(1.6, hi);
  return { D: Math.round(rng.range(lo, hi) * 20) / 20, detail: Math.round(rng.range(0.2, DETAIL.max * 0.8) * 20) / 20 };
}
// The ink slots a pattern draws with: its "inks" param, else three.
export function usedInks(p, P) {
  return p.params.inks ? Math.max(1, Math.round(P.inks)) : 3;
}
// A full pick. pats and pals: the lists to draw from; cap: the device
// density cap. Returns { pat, P, pal, mods, mode, lw, score, D, detail }.
export function surprise(rng, pats, pals, cap = DENSITY.max) {
  const pat = rng.pick(pats), P = tasteParams(pat, rng), n = usedInks(pat, P);
  // Palettes that keep every used ink at contrast 3 or more; a weighted
  // pick by score, so strong contrast comes up more often.
  // A pattern that draws with two or more inks needs two or more distinct
  // inks, or its parts merge into one colour.
  let pool = pals.filter(q => q.ink.length >= Math.min(n, 2)).map(q => [q, paletteScore(q, n)]).filter(([, s]) => s >= 3);
  if (!pool.length) pool = pals.map(q => [q, paletteScore(q, n)]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const [pal, score] = pool[rng.weighted(pool.map(([, s]) => Math.min(12, s)))];
  const mods = tasteMods(rng, pat), lw = +(rng.range(1.3, 3)).toFixed(2);
  return Object.assign({ pat, P, pal, mods, mode: 'auto', lw, score }, tasteDensity(rng, cap));
}
