// ============================================================================
//  PROTEIN VIEWER  ·  app/env.js — DOM lookup, device queries, text helpers
// ────────────────────────────────────────────────────────────────────────────
//  These helpers keep no state. The media queries are read one time at load,
//  except PHONE_Q: panel.js and the layout code read its live value.
//
//  GREP MAP
//    const $ / PHONE_Q / COARSE / HOVER / REDUCED / DPR      device
//    const esc / ease / cap                                  text, easing
// ============================================================================

export const $ = id => document.getElementById(id);
export const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
export const COARSE = matchMedia('(pointer:coarse)').matches;
export const HOVER = matchMedia('(hover:hover) and (pointer:fine)').matches;
export const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const DPR = () => Math.min(window.devicePixelRatio || 1, 2);
export const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
export const ease = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const cap = s => s.charAt(0) + s.slice(1).toLowerCase();
