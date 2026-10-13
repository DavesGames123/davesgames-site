// ============================================================================
//  BREADBOARD LAB  ·  ui/format.js — numbers with units, in and out
// ----------------------------------------------------------------------------
//  Pure functions. Every readout on the page goes through si(): three
//  significant digits, trailing zeros kept (4.70 kΩ, not 4.7 kΩ), an SI
//  prefix from p to T. parseSI() reads what a person types into a value
//  well: "4k7", "10u", "2.2M", "100nF", "3.3 V", "1e-3".
//
//  E-SERIES. A resistor or capacitor well snaps to the E12 or E24 series in
//  log space, and the scrub steps one series value at a time.
//
//  GREP MAP
//    PREFIXES / si ......... value -> "13.6 mA"
//    siParts ............... value -> { num, prefix, scale } for displays
//    parseSI ............... "4k7" -> 4700, NaN when it cannot read it
//    E12 / E24 / snapE ..... nearest series value; stepE one step up or down
//    fmtTime / fmtRatio .... the status bar
//    clamp / esc ........... small helpers the panels share
// ============================================================================

export const PREFIXES = [[1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];

// value -> { num: '13.6', prefix: 'm', scale: 1e-3 }
export function siParts(v, digits = 3) {
  if (!Number.isFinite(v)) return { num: Number.isNaN(v) ? '—' : (v > 0 ? '∞' : '-∞'), prefix: '', scale: 1 };
  if (v === 0) return { num: (0).toFixed(Math.max(0, digits - 1)), prefix: '', scale: 1 };
  const a = Math.abs(v);
  let i = PREFIXES.findIndex(([s]) => a >= s * 0.9995);
  if (i < 0) i = PREFIXES.length - 1;
  for (;;) {
    const [s, p] = PREFIXES[i];
    const m = v / s;
    let txt = Number(m.toPrecision(digits));
    // 999.6 rounds to 1000: move up one prefix
    if (Math.abs(txt) >= 1000 && i > 0) { i--; continue; }
    const intDigits = Math.max(1, Math.floor(Math.log10(Math.abs(txt) || 1)) + 1);
    const dec = Math.max(0, digits - intDigits);
    return { num: txt.toFixed(dec), prefix: p, scale: s };
  }
}
export function si(v, unit = '', digits = 3) {
  const { num, prefix } = siParts(v, digits);
  return `${num} ${prefix}${unit}`.trim();
}

const PFX = { T: 1e12, G: 1e9, M: 1e6, k: 1e3, K: 1e3, m: 1e-3, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, n: 1e-9, p: 1e-12 };
// "4k7" -> 4700, "10u" -> 1e-5, "2.2 MΩ" -> 2.2e6, "1e-3" -> 0.001, "-3.3V" -> -3.3
export function parseSI(s) {
  if (typeof s === 'number') return s;
  let t = String(s).trim().replace(/,/g, '.').replace(/\s+/g, '');
  if (!t) return NaN;
  t = t.replace(/(ohms?|Ω|Hz|°C|V|A|F|H|W|s)$/i, '');
  const r = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?([TGMkKmuµμnp]?)(\d*)$/.exec(t);
  if (!r) return NaN;
  const [, sign, ip, fp, ex, pf, tail] = r;
  if (!ip && !fp && !tail) return NaN;
  let num;
  if (pf && tail && fp === undefined && !ex) num = parseFloat(`${ip || '0'}.${tail}`);    // 4k7
  else { if (tail) return NaN; num = parseFloat(`${ip || '0'}.${fp || '0'}${ex ? 'e' + ex : ''}`); }
  if (!Number.isFinite(num)) return NaN;
  const k = pf ? PFX[pf] : 1;
  const v = k < 1 ? num / Math.round(1 / k) : num * k;
  return (sign === '-' ? -1 : 1) * Number(v.toPrecision(12));
}

export const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
export const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];
const SERIES = { E12, E24 };
// every series value from 1e-12 to 1e12, sorted
function ladder(series) {
  const L = [];
  for (let d = -12; d <= 12; d++) for (const m of SERIES[series]) L.push(Number((m * Math.pow(10, d)).toPrecision(3)));
  return L;
}
const LADDERS = {};
const getLadder = s => (LADDERS[s] = LADDERS[s] || ladder(s));
export function snapE(v, series = 'E12') {
  if (!(v > 0) || !SERIES[series]) return v;
  const L = getLadder(series), lv = Math.log(v);
  let best = L[0], bd = Infinity;
  let lo = 0, hi = L.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (L[mid] < v) lo = mid; else hi = mid; }
  for (const c of [L[lo], L[hi]]) { const d = Math.abs(Math.log(c) - lv); if (d < bd) { bd = d; best = c; } }
  return best;
}
export function stepE(v, dir, series = 'E12') {
  const L = getLadder(series), s = snapE(v, series);
  const i = L.indexOf(s);
  if (i < 0) return s;
  if (dir > 0 && s <= v * (1 + 1e-9)) return L[Math.min(L.length - 1, i + 1)];
  if (dir < 0 && s >= v * (1 - 1e-9)) return L[Math.max(0, i - 1)];
  return s;
}

export function fmtTime(t) {
  if (!Number.isFinite(t)) return '—';
  if (t < 1e-3) return si(t, 's');
  if (t < 60) return t.toFixed(3) + ' s';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
export function fmtRatio(r) {
  if (!Number.isFinite(r) || r <= 0) return '—';
  if (r >= 0.995 && r <= 1.005) return '1.00×';
  return (r >= 10 ? r.toFixed(0) : r >= 1 ? r.toFixed(2) : r.toPrecision(2)) + '×';
}
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
