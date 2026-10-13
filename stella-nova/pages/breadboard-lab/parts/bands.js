// ============================================================================
//  BREADBOARD LAB  ·  parts/bands.js — resistor colour code and E-series
// ----------------------------------------------------------------------------
//  The colour code: digit bands, a multiplier band and a tolerance band.
//  5 % and wider parts get 4 bands (2 digits). 1 % and closer get 5 bands
//  (3 digits). The value rounds to the digits that the bands can carry.
//
//  E-SERIES. E12 and E24 are the preferred values per decade. snapE rounds a
//  value to the nearest member on a log scale (the inspector snaps R and C).
//
//  GREP MAP
//    BAND_NAMES / BAND_HEX .. colour names by digit, and their paint
//    resistorBands .......... ohms -> ['red','red','brown','gold']
//    E12 / E24 / snapE ...... preferred values
//    formatOhms ............. 4700 -> '4.7k' (the silk label of a resistor)
// ============================================================================

export const BAND_NAMES = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'white'];
export const BAND_HEX = {
  black: '#1b1b1b', brown: '#6b3a1e', red: '#c62a26', orange: '#e06a1b', yellow: '#e8c91c',
  green: '#2e8a3a', blue: '#2a5bc0', violet: '#7a3fb0', grey: '#8a8a8a', white: '#f0f0ea',
  gold: '#c9a338', silver: '#b8bcc4', none: '#00000000',
};
const TOL = [[0.0005, 'grey'], [0.001, 'violet'], [0.0025, 'blue'], [0.005, 'green'], [0.01, 'brown'],
  [0.02, 'red'], [0.05, 'gold'], [0.1, 'silver']];
const MULT_NEG = { '-1': 'gold', '-2': 'silver' };

export function resistorBands(ohms, tolerance = 0.05) {
  if (!(ohms > 0) || !Number.isFinite(ohms)) return ['black', 'black', 'black', 'gold'];
  const digits = tolerance <= 0.01 ? 3 : 2;
  // the exponent e such that ohms = d1d2(d3) x 10^e
  let e = Math.floor(Math.log10(ohms) + 1e-9) - (digits - 1);
  let m = Math.round(ohms / 10 ** e);
  if (m >= 10 ** digits) { m = Math.round(m / 10); e += 1; }
  if (e < -2) { e = -2; m = Math.round(ohms * 100); }
  const ds = String(m).padStart(digits, '0').split('').map(Number);
  const mult = e >= 0 ? BAND_NAMES[Math.min(9, e)] : MULT_NEG[String(e)];
  let tol = 'none';
  for (const [t, c] of TOL) if (Math.abs(tolerance - t) < t * 1e-3 || tolerance <= t) { tol = c; break; }
  return [...ds.map(d => BAND_NAMES[d]), mult, tol];
}

export const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
export const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3,
  4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];

export function snapE(value, series = 'E24') {
  if (!(value > 0) || !Number.isFinite(value)) return value;
  const S = series === 'E12' ? E12 : E24;
  const dec = Math.floor(Math.log10(value));
  let best = value, bd = Infinity;
  for (const d of [dec - 1, dec, dec + 1]) {
    for (const s of S) {
      const v = s * 10 ** d;
      const dd = Math.abs(Math.log(v / value));
      if (dd < bd) { bd = dd; best = v; }
    }
  }
  return Number(best.toPrecision(3));
}

export function formatOhms(r) {
  if (!(r >= 0)) return '?';
  const f = (v, u) => (Number(v.toPrecision(3)) + '').replace(/\.0+$/, '') + u;
  if (r >= 1e6) return f(r / 1e6, 'M');
  if (r >= 1e3) return f(r / 1e3, 'k');
  return f(r, '');
}
