// ============================================================================
//  LEO CATALOG  ·  core/format.js — text formats and the slider scales
// ----------------------------------------------------------------------------
//  Pure functions, no DOM and no three.js. main.js uses them for the time
//  readouts, the two log-scale sliders and every innerHTML row.
//
//    time slider  offset = sign(s) (exp(|s| K) - 1) / (exp(K) - 1) range,
//                 s = 2 frac - 1, K = SLIDER_K. Fine seconds and minutes
//                 near NOW (the centre), days and months at the edges.
//    rate slider  speed = 0.1 x 10^(6 frac): frac 0 = 0.1x, 1/6 = 1x (real
//                 time), 1/2 = 100x, 2/3 = 1000x, 1 = 100000x.
//
//  grep -n targets: "export function fmt", "export function escHtml",
//  "export function fmtTime", "export function fmtDelta",
//  "export function fmtRate", "export function fracToOffsetMs",
//  "export function offsetMsToFrac", "export function rateFracToSpeed",
//  "export function rateSpeedToFrac"
// ============================================================================

// Format a number to d decimals, or an em dash when it is not finite.
export function fmt(v, d=1) { return Number.isFinite(v) ? v.toFixed(d) : '—'; }
// Escape a string for safe insertion into innerHTML.
export function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Format a Date as a UTC timestamp string.
export function fmtTime(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ` +
         `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`;
}
// Format a signed time offset from NOW compactly (minutes, hours, or days).
export function fmtDelta(ms) {
  if (Math.abs(ms) < 60000) return '+0m';
  const sign = ms > 0 ? '+' : '−';
  const s = Math.abs(ms) / 1000;
  if (s < 3600)  return `${sign}${(s/60)|0}m`;
  if (s < 86400) return `${sign}${(s/3600).toFixed(1)}h`;
  return `${sign}${(s/86400).toFixed(1)}d`;
}
// Format the playback rate compactly (×, k×).
export function fmtRate(s) {
  if (s < 1)     return s.toFixed(2) + '×';
  if (s < 10)    return s.toFixed(1) + '×';
  if (s < 1000)  return Math.round(s) + '×';
  if (s < 10000) return (s/1000).toFixed(1) + 'k×';
  return Math.round(s/1000) + 'k×';
}

// Time slider: fraction [0,1] to a signed offset in ms, and back.
const SLIDER_K   = 9;
const SLIDER_KM1 = Math.exp(SLIDER_K) - 1;
export function fracToOffsetMs(frac, range) {
  const s = frac * 2 - 1;
  return Math.sign(s) * (Math.exp(Math.abs(s) * SLIDER_K) - 1) / SLIDER_KM1 * range;
}
export function offsetMsToFrac(offsetMs, range) {
  const r = Math.max(-1, Math.min(1, offsetMs / range));
  const s = Math.sign(r) * Math.log(1 + Math.abs(r) * SLIDER_KM1) / SLIDER_K;
  return (s + 1) / 2;
}

// Rate slider: fraction to SIM.speed, and back.
const RATE_K = 6;
export function rateFracToSpeed(frac) { return 0.1 * Math.pow(10, frac * RATE_K); }
export function rateSpeedToFrac(speed) { return Math.log10(Math.max(speed, 0.001) / 0.1) / RATE_K; }
