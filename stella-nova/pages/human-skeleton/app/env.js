// ============================================================================
//  HUMAN SKELETON  ·  app/env.js — constants, device queries, small helpers
// ────────────────────────────────────────────────────────────────────────────
//  This module has no state and no side effects past the media queries. All
//  other modules can import it at the top level with no order problem.
//
//  GREP MAP
//    const PHONE_Q / COARSE / HOVER / REDUCED / DPR      device queries
//    const $ / esc / clamp01 / easeIO / ease             helpers
//    const TYPE_NAME / SIDE_NAME / MODE_NAME             card and readout text
//    const LOAD_ORDER                                    group download order
//    const THEMES                                        dark and light colours
// ============================================================================

export const $ = id => document.getElementById(id);
export const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
export const COARSE = matchMedia('(pointer:coarse)').matches;
export const HOVER = matchMedia('(hover:hover) and (pointer:fine)').matches;
export const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const DPR = () => Math.min(window.devicePixelRatio || 1, 2);
export const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
export const clamp01 = t => (t <= 0 ? 0 : t >= 1 ? 1 : t);
export const easeIO = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const ease = t => t * t * (3 - 2 * t);

export const TYPE_NAME = { long: 'Long bone', short: 'Short bone', flat: 'Flat bone', irregular: 'Irregular bone', sesamoid: 'Sesamoid bone', tooth: 'Tooth', cartilage: 'Cartilage' };
export const SIDE_NAME = { L: 'Left', R: 'Right', '': 'Midline' };
export const MODE_NAME = { assembled: 'Assembled', radial: 'Radial', regional: 'Regions', catalogue: 'Tray' };
// smallest and most central first; two downloads at a time, so the first
// group does not share the bandwidth with all the others
export const LOAD_ORDER = ['pelvis', 'spine', 'thorax', 'head', 'lower-l', 'lower-r', 'upper-l', 'upper-r'];
export const THEMES = {
  dark: { sel: 0xf0b862, hov: 0xc9b48f, ghost: 0xd8c8ad, ghostA: 0.42, shadow: 0.5, pool: 0xc8a676, poolA: 0.11, tray: 0x1f1b17, trayLine: 0x6b5638, exposure: 1.0, label: 'Gallery' },
  light: { sel: 0xa8361f, hov: 0x8f6b3d, ghost: 0x5a4a36, ghostA: 0.36, shadow: 0.26, pool: 0xffffff, poolA: 0.55, tray: 0xe2d9c9, trayLine: 0xa08868, exposure: 0.92, label: 'Archive' },
};
