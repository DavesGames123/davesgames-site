// ============================================================================
//  PRESENCE ORBS  ·  state.js — shared constants, seeds and helpers
// ----------------------------------------------------------------------------
//  This module holds the data that the other modules read. It imports nothing
//  and it touches no GPU. Each subsystem module imports the names it needs from
//  here, so there is one owner for the state.
//
//  EXPORTS  (grep the name to find it)
//      $ ............... getElementById helper
//      STATES .......... the six assistant states, in order
//      SEED ............ per-state seed values; a state change crossfades them
//      TRANSITION ...... crossfade time, plus ACT_LIFT / LVL_LIFT / ATTACK / RELEASE
//      ease/sstep/arch . easing helpers
//      ENTRY ........... per-entry speed / glow / phase envelopes
//      hexToRgb ........ "#rrggbb" -> [r,g,b] in 0..1
//      G ............... the live global state object
//      stage ........... the scroll container element
//      clock ........... seconds since the module load
//      tiles ........... the tile list; gpu.js fills it
// ============================================================================
export const $ = id => document.getElementById(id);

export const STATES = ['idle', 'listening', 'thinking', 'responding', 'success', 'error'];

export const SEED = {
  idle:       { speed: 0.30, glow: 0.65, depth: 0.75, hue: 0,     entry: 'none' },
  listening:  { speed: 0.90, glow: 1.10, depth: 1.10, hue: 0,     entry: 'none' },
  thinking:   { speed: 1.15, glow: 1.20, depth: 1.25, hue: 0,     entry: 'wake' },
  responding: { speed: 1.45, glow: 1.30, depth: 1.25, hue: 0,     entry: 'none' },
  success:    { speed: 0.55, glow: 1.05, depth: 1.00, hue: 0,     entry: 'swell' },
  error:      { speed: 0.65, glow: 0.80, depth: 1.20, hue: -0.35, entry: 'stutter' },
};

export const TRANSITION = 0.6, ACT_LIFT = 0.25, LVL_LIFT = 0.35, ATTACK = 0.05, RELEASE = 0.25;
export const ease = t => { t = Math.min(Math.max(t / TRANSITION, 0), 1); return t * t * (3 - 2 * t); };
export const sstep = x => { const t = Math.min(Math.max(x, 0), 1); return t * t * (3 - 2 * t); };
export const arch = (tau, s, w) => { const u = (tau - s) / w; return u > 0 && u < 1 ? Math.sin(Math.PI * u) : 0; };

export const ENTRY = {
  none:    { speed: t => 1, glow: t => 1, phase: t => 0 },
  wake:    { speed: t => t > 0 && t < 2.5 ? 1 + 0.6 * Math.exp(-t / 0.4) : 1, glow: t => 1, phase: t => 0 },
  swell:   { speed: t => 1, glow: t => { if (!(t > 0 && t < 1.5)) return 1; const x = t / 0.4; return 1 + 0.35 * Math.pow(x, 2) * Math.exp(2 * (1 - x)) * (1 - sstep((t - 1.1) / 0.4)); }, phase: t => 0 },
  stutter: { speed: t => 1, glow: t => 1, phase: t => t > 0 && t < 0.5 ? -(0.030 * arch(t, 0.05, 0.20) + 0.018 * arch(t, 0.28, 0.16)) : 0 },
};

export const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

export const G = { state: 'thinking', level: 0, activity: 0, voice: false, typing: false, paused: false,
  tone: hexToRgb('#5a8cc0'), tone2: hexToRgb('#5a8cc0'), ink: hexToRgb('#0e1118'),
  live: { level: 0, activity: 0 }, pointer: null, tempo: 1 };

export const stage = $('stage');
export const clock0 = performance.now();
export const clock = () => (performance.now() - clock0) / 1000;
export const tiles = [];
