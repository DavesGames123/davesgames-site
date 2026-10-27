// ============================================================================
//  TEXT  ·  city-atlas/app/text.js — formatting helpers of the page text
// ----------------------------------------------------------------------------
//  Escaping, numbers, compass points, coordinates and the clock stamp of the
//  current data window, in the city's local time zone. No DOM: tests.mjs
//  imports this file in node.
//
//  grep -n targets
//    constants ............ "export const KNOTS"
//    html escape .......... "export const esc"
//    numbers .............. "export const fmt"
//    compass point ........ "export const compass"
//    data window .......... "export const hoursOf"
//    clock stamp .......... "export function stamp"
//    coordinates .......... "export const latLon"
// ============================================================================

export const KNOTS = 1 / 0.514444;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const ICON_PAUSE = '<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="2.5" y="1.5" width="3" height="11" rx="0.6"/><rect x="8.5" y="1.5" width="3" height="11" rx="0.6"/></svg>';
export const ICON_PLAY = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 1.6v10.8a.5.5 0 0 0 .76.43l8.6-5.4a.5.5 0 0 0 0-.86l-8.6-5.4a.5.5 0 0 0-.76.43z"/></svg>';

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const LINK = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${esc(text)}</a>`;
export const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
export const fmt = (v, d = 0) => Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
export const titleCase = (s) => s.toLowerCase().replace(/(^|[\s.-])([a-z])/g, (m, a, b) => a + b.toUpperCase());

// The last hour of the current data of city meta m (49 hours when it has none).
export const hoursOf = (m) => Math.max(1, (m?.current?.hours ?? 49) - 1);

// The data window in the city's local time zone.
export function stamp(m, h) {
  const start = Date.parse(m?.current?.startUTC || '2026-09-24T00:00:00Z');
  const d = new Date(start + Math.floor(h) * 3600e3);
  try {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: m?.tz || 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' });
    return f.format(d).replace(',', '');
  } catch {
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}:00 UTC`;
  }
}

// "40.713° N, 74.006° W" with d decimals.
export const latLon = (m, d) => `${fmt(Math.abs(m.lat), d)}° ${m.lat >= 0 ? 'N' : 'S'}, ${fmt(Math.abs(m.lon), d)}° ${m.lon >= 0 ? 'E' : 'W'}`;
