// ============================================================================
//  ULAM SPIRAL  ·  app/palettes.js — colour maps, backgrounds, highlight modes
// ----------------------------------------------------------------------------
//  Pure data, no DOM. frame.js turns a palette key into the renderer
//  uniforms (palArr); panel.js builds the swatches, the mode chips and the
//  quadratic presets from these tables; saver.js reads MODES by app.MODES.
//
//  GREP MAP
//    grep -n 'export const PALETTES'      five stops each, and the f(n) colour
//    grep -n 'export const BGS'           the background gradients
//    grep -n 'export const MODES'         the highlight modes and their notes
//    grep -n 'export const QUAD_PRESETS'  the quadratic preset buttons
//    grep -n 'export const palArr'        a palette as 15 floats
// ============================================================================
import * as T from '../numtheory.js';

export const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

// --- palettes and backgrounds -------------------------------------------------
// Five stops, dark to bright. pal(0.78) is the prime colour; the top stop
// marks the special primes (twins, Sophie Germain, ...).
export const PALETTES = {
  aurora: { name: 'Aurora', stops: ['#121a44', '#2b4aa0', '#3fb0d4', '#9cf2d2', '#f6fff6'], quad: '#ffbf66' },
  ember: { name: 'Ember', stops: ['#1c0812', '#701634', '#e04e2c', '#ffb24a', '#fff4d6'], quad: '#7fd8ff' },
  orchid: { name: 'Orchid', stops: ['#1a0c30', '#5a2d8e', '#b456cf', '#ff9fd6', '#fff1fa'], quad: '#9ef0c4' },
  ice: { name: 'Ice', stops: ['#0a1226', '#1e4382', '#5096e6', '#aee0ff', '#f3fbff'], quad: '#ffb36b' },
  spectral: { name: 'Spectral', stops: ['#3d2c92', '#2d8fc4', '#58c987', '#f2d34c', '#ff7a48'], quad: '#ffffff' },
  gold: { name: 'Gold leaf', stops: ['#161006', '#5c3f10', '#c48d2e', '#f5d071', '#fffaf0'], quad: '#8fb8ff' },
  mono: { name: 'Silver', stops: ['#16181e', '#3c4250', '#8c96a8', '#d7dde8', '#ffffff'], quad: '#ffb057' },
};
export const BGS = {
  night: { name: 'Night', c: ['#0d1224', '#020307'] },
  ink: { name: 'Ink', c: ['#060607', '#000000'] },
  deep: { name: 'Deep blue', c: ['#0b1838', '#01030b'] },
  plum: { name: 'Plum', c: ['#1c0e28', '#050209'] },
  ember: { name: 'Ember', c: ['#211510', '#060303'] },
};
export const palArr = key => new Float32Array(PALETTES[key].stops.flatMap(rgb));

// --- highlight modes -----------------------------------------------------------
const M = T.MODE;
export const MODES = [
  { id: M.primes, key: 'primes', name: 'Primes', note: 'Each prime lights up. Watch the diagonals.' },
  { id: M.twin, key: 'twin', name: 'Twin primes', note: 'Bright: p with p − 2 or p + 2 also prime. Dim: the other primes.' },
  { id: M.cousin, key: 'cousin', name: 'Cousin primes', note: 'Bright: p with p ± 4 also prime.' },
  { id: M.sexy, key: 'sexy', name: 'Sexy primes', note: 'Bright: p with p ± 6 also prime (sex is Latin for six).' },
  { id: M.sophie, key: 'sophie', name: 'Sophie Germain & safe', note: 'Top colour: 2p + 1 is prime (Sophie Germain). Middle: (p − 1)/2 is prime (safe). White: both.' },
  { id: M.gauss, key: 'gauss', name: 'Gaussian primes', note: 'On the lattice of a + bi: primes of ℤ[i]. a² + b² is prime, or a or b is 0 and the other is ±p with p ≡ 3 mod 4.' },
  { id: M.eisen, key: 'eisen', name: 'Eisenstein primes', note: 'On the lattice of a + bω: norm a² − ab + b² prime, or a unit times p with p ≡ 2 mod 3.' },
  { id: M.divisors, key: 'divisors', name: 'Divisor count', note: 'Heat map of d(n), the number of divisors. Primes (d = 2) stay dark; highly composite numbers glow.' },
  { id: M.spf, key: 'spf', name: 'Smallest factor', note: 'Colour by the smallest prime factor: even numbers darkest, primes (their own factor) brightest.' },
  { id: M.totient, key: 'totient', name: 'Totient ratio', note: 'φ(n)/n = ∏(1 − 1/p): near 1 for primes, low for numbers with many small factors.' },
  { id: M.figurate, key: 'figurate', name: 'Squares · triangles · Fibonacci', note: 'Squares, triangular numbers and Fibonacci numbers; primes faint behind them.' },
];
export const QUAD_PRESETS = [[1, 1, 41], [1, -79, 1601], [4, 4, 59], [2, 0, 29], [1, 0, 1], [4, -2, 41], [6, 6, 31], [1, 1, 17]];
