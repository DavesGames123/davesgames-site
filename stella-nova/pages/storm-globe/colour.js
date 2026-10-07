// ============================================================================
//  STORM GLOBE  ·  colour.js  ·  colour maps and the speed scale
// ----------------------------------------------------------------------------
//  No DOM. The globe shader and the legend use the same maps, so the
//  legend can mark the Saffir-Simpson thresholds where the colours are.
//
//  Speed ("aggressiveness of velocity"): magma over x = sqrt(s / SPEED_MAX).
//  The square root gives the calm 2-15 m/s of most of the planet room in
//  the dark half of the map and keeps the storm cores in the bright half.
//
//  Maps: matplotlib magma (CC0), a cyclonic vorticity map (calm grey to
//  magma-orange for cyclonic, to blue for anticyclonic), and a pressure
//  map (deep low = bright, high = dark blue-grey).
//
//  grep -n targets: "export const SPEED_MAX", "export const SS_MARKS",
//                   "export function lutBytes", "export function speedToX"
// ============================================================================
import { KT } from './sources.js';

export const SPEED_MAX = 75;            // m/s at the top of the speed scale
export const VORT_MAX = 40;             // 1e-5 1/s at the ends of the vorticity scale
export const P_LO = 950, P_HI = 1040;   // hPa range of the pressure scale

// Saffir-Simpson (1-min sustained wind) thresholds, m/s from the kt limits
export const SS_MARKS = [
  { label: 'TS', kt: 34 }, { label: '1', kt: 64 }, { label: '2', kt: 83 },
  { label: '3', kt: 96 }, { label: '4', kt: 113 }, { label: '5', kt: 137 },
].map(m => ({ ...m, ms: m.kt * KT }));

const MAGMA = '0000040b092420114b3b0f7057157e721f818c2981a8327dc43c75de4968f1605dfa7f5efe9f6dfebf84fddea0fcfdbf';
function hexStops(s) { const out = []; for (let k = 0; k < s.length; k += 6) out.push([0, 2, 4].map(o => parseInt(s.substr(k + o, 2), 16))); return out; }
function ramp(stops, x) {
  const n = stops.length, f = Math.max(0, Math.min(1, x)) * (n - 1), i = Math.min(n - 2, Math.floor(f)), u = f - i;
  return stops[i].map((v, j) => Math.round(v + (stops[i + 1][j] - v) * u));
}
const MAGMA_STOPS = hexStops(MAGMA);
export function magma(x) { return ramp(MAGMA_STOPS, x); }
// cyclonic vorticity: 0 = anticyclonic (blue), 0.5 = none (grey), 1 = cyclonic (magma)
const VORT_STOPS = [[40, 110, 220], [60, 140, 230], [70, 90, 150], [38, 36, 48], [24, 20, 28], [110, 30, 90], [215, 60, 70], [250, 140, 70], [252, 220, 150]];
export function vortColour(x) { return ramp(VORT_STOPS, x); }
const PRES_STOPS = [[252, 253, 191], [252, 160, 100], [222, 73, 104], [140, 41, 129], [70, 40, 110], [40, 50, 90], [30, 60, 80], [26, 40, 52]];
export function presColour(x) { return ramp(PRES_STOPS, x); }

// value -> 0..1 position on each scale (the shader does the same)
export function speedToX(ms) { return Math.sqrt(Math.max(0, Math.min(1, ms / SPEED_MAX))); }
export function vortToX(v) { return 0.5 + 0.5 * Math.sign(v) * Math.sqrt(Math.min(1, Math.abs(v) / VORT_MAX)); }
export function presToX(hpa) { return Math.max(0, Math.min(1, (hpa - P_LO) / (P_HI - P_LO))); }

// 256 x 4 RGBA rows: magma, vorticity, pressure, magma (spare)
export function lutBytes() {
  const d = new Uint8Array(256 * 4 * 4);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    d.set([...magma(x), 255], i * 4);
    d.set([...vortColour(x), 255], (256 + i) * 4);
    d.set([...presColour(x), 255], (512 + i) * 4);
    d.set([...magma(x), 255], (768 + i) * 4);
  }
  return d;
}
export function cssGradient(fn, n = 24) {
  const s = []; for (let i = 0; i <= n; i++) { const c = fn(i / n); s.push(`rgb(${c[0]},${c[1]},${c[2]}) ${(i / n * 100).toFixed(1)}%`); }
  return `linear-gradient(90deg, ${s.join(', ')})`;
}
// Category colours for tracks and markers: by Saffir-Simpson category
export const CAT_COLOURS = ['#7fb7ff', '#ffe08a', '#ffc24d', '#ff9a3d', '#ff5a36', '#e8306f', '#c02cc8'];
export function catColour(cat) { return CAT_COLOURS[Math.max(0, Math.min(6, cat + 1))]; }
