// ============================================================================
//  NOISE TABLE  ·  state.js — shared globals and helpers
// ----------------------------------------------------------------------------
//  This module holds the data that the other modules read. It imports nothing
//  and it touches no GPU. Each subsystem module imports the names it needs from
//  here, so there is one owner for the state.
//
//  EXPORTS  (grep the name to find it)
//      $ .......... getElementById helper
//      hexToRgb ... "#rrggbb" -> [r,g,b] in 0..1
//      G .......... the live global state: palette, hover mode, scale/tempo/gain
//      stage ...... the scroll container element
//      tiles ...... the tile list; gpu.js fills it
// ============================================================================
export const $ = id => document.getElementById(id);
export const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

export const G = { ink: hexToRgb('#0e1118'), tone: hexToRgb('#5a8cc0'), cream: hexToRgb('#e8ecf4'), hoverOnly: true, scale: 1, tempo: 1, gain: 1 };

export const stage = $('stage');
export const tiles = [];
