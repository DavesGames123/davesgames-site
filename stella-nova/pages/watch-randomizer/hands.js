// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  hands.js — hand styles, widths and materials
// ────────────────────────────────────────────────────────────────────────────
//  handStyle(name) returns what the kit's B.hand takes: a style name it
//  knows (breguet, dauphine, leaf, sword, spade, cathedral, baton, beetle,
//  poker, needle), or a function (len, w) -> [[outline, holes], ...] for a
//  style defined here. HAND_W gives each style's width as a share of its
//  length; forClock swaps styles whose details have a fixed size.
// ============================================================================
export const HAND_W = { breguet: 0.042, dauphine: 0.06, leaf: 0.045, sword: 0.05, spade: 0.026, cathedral: 0.03, baton: 0.035, beetle: 0.04, poker: 0.022 };
export const forClock = s => (s === 'breguet' || s === 'beetle' ? 'spade' : s);
export const minuteFor = s => (s === 'beetle' ? 'poker' : s);
export const HAND_MAT = { blued: 'blued', black: 'black', gold: 'gold', steel: 'polished', lume: 'lume' };
export const SEC_MAT = { red: 'paint', gold: 'gold', blue: 'blued' };
// styles defined in this file: name -> (len, w) => [[outline, holes], ...]
export const EXTRA = {};
export const handStyle = name => EXTRA[name] || name;
