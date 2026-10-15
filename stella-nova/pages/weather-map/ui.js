// ============================================================================
//  WEATHER MAP  ·  ui.js — formatting, palettes, icons and the page chrome
// ----------------------------------------------------------------------------
//  Two halves. The top half is pure (no DOM at load, node tests import it):
//  unit formatting, local time, the city search, the scrubber range and
//  ticks, the temperature and radar palettes, and the inline SVG icons.
//  The bottom half, createUI(app, hooks), builds the chrome into the
//  elements of index.html: top bar, focus chips and search, layer toggles,
//  legend, time scrubber, unit order, the phone dock and bottom sheet.
//
//  Temperatures are stored in °C. A label shows both units; app.units sets
//  which comes first ('F' or 'C').
//
//  grep -n targets:
//    "export function fmtTemp"      both units in app.units order
//    "export function tempParts"    big number + small other unit
//    "export function fmtWind"      m/s -> mph and km/h
//    "export function fmtClock"     local time in an IANA zone
//    "export function searchCities" the focus search ranking
//    "export function scrubRange"   the scrubber window (-6 h .. +48 h)
//    "export function scrubTicks"   local 6 h ticks and day labels
//    "export const TEMP_STOPS"      the TV temperature palette (°C)
//    "export const DBZ_STOPS"       the radar reflectivity ramp
//    "export function iconSVG"      weather icons by codeText() icon key
//    "export function frontSVG"     legend swatches for the front types
//    "export function createUI"     the DOM chrome
// ============================================================================
import { localParts } from './astro.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const H = 3600e3;

// ── UNITS ───────────────────────────────────────────────────────────────
export const cToF = c => c * 9 / 5 + 32;
export const fToC = f => (f - 32) * 5 / 9;
const pair = (a, b, units) => (units === 'C' ? `${b} · ${a}` : `${a} · ${b}`);

// fmtTemp(22, 'F') -> '72°F · 22°C'; fmtTemp(22, 'C') -> '22°C · 72°F'
export function fmtTemp(c, units = 'F') {
  if (!Number.isFinite(c)) return '–';
  return pair(`${Math.round(cToF(c))}°F`, `${Math.round(c)}°C`, units);
}

// { main: '72°', unit: 'F', alt: '22°C' } for the big number + small unit
export function tempParts(c, units = 'F') {
  if (!Number.isFinite(c)) return { main: '–', unit: '', alt: '' };
  const f = Math.round(cToF(c)), cc = Math.round(c);
  return units === 'C' ? { main: `${cc}°`, unit: 'C', alt: `${f}°F` } : { main: `${f}°`, unit: 'F', alt: `${cc}°C` };
}

// One unit only (for compact rows): the units-first value with its degree.
export function tempOne(c, units = 'F') {
  if (!Number.isFinite(c)) return '–';
  return `${Math.round(units === 'C' ? c : cToF(c))}°`;
}

export function fmtWind(ms, units = 'F') {
  if (!Number.isFinite(ms)) return '–';
  return pair(`${Math.round(ms * 2.23694)} mph`, `${Math.round(ms * 3.6)} km/h`, units);
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compass(deg) {
  if (!Number.isFinite(deg)) return '';
  return COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

export function fmtPrecip(mm, units = 'F') {
  if (!Number.isFinite(mm)) return '–';
  const inch = mm / 25.4;
  return pair(`${inch < 0.995 ? inch.toFixed(2) : inch.toFixed(1)} in`, `${mm < 10 ? mm.toFixed(1) : Math.round(mm)} mm`, units);
}

export function fmtPressure(hPa, units = 'F') {
  if (!Number.isFinite(hPa)) return '–';
  return pair(`${(hPa * 0.0295300).toFixed(2)} inHg`, `${Math.round(hPa)} hPa`, units);
}

// ── TIME ────────────────────────────────────────────────────────────────
const fmtCache = new Map();
function dtf(tz, opts) {
  const key = (tz || 'UTC') + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    try { f = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', ...opts }); }
    catch { f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }); }
    fmtCache.set(key, f);
  }
  return f;
}
const safe = (t, tz, opts) => (Number.isFinite(t) ? dtf(tz, opts).format(new Date(t)) : '–');

export const fmtClock = (t, tz, sec = false) => safe(t, tz, sec ? { hour: 'numeric', minute: '2-digit', second: '2-digit' } : { hour: 'numeric', minute: '2-digit' });
export const fmtHour = (t, tz) => safe(t, tz, { hour: 'numeric' });
export const fmtDate = (t, tz) => safe(t, tz, { weekday: 'long', month: 'long', day: 'numeric' });
export const fmtDay = (t, tz) => safe(t, tz, { weekday: 'short' });
export const tzAbbr = (t, tz) => localParts(t, tz).tzAbbr;

// 'Now', '+6 h', '−3 h' relative to the reference now (rounded hours)
export function relHours(t, now) {
  const h = Math.round((t - now) / H);
  if (h === 0) return 'Now';
  return h > 0 ? `+${h} h` : `−${-h} h`;
}

// ── SEARCH ──────────────────────────────────────────────────────────────
const fold = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Score: exact name 0, name prefix 1, word prefix 2, state code 3,
// substring 4; ties by rank then population. Returns cities.
export function searchCities(q, list, limit = 8) {
  const s = fold(q);
  if (!s) return [];
  const hits = [];
  for (const c of list) {
    const n = fold(c.name), st = c.state.toLowerCase(), full = `${n} ${st}`;
    let score = -1;
    if (n === s || full === s) score = 0;
    else if (n.startsWith(s) || full.startsWith(s)) score = 1;
    else if (n.split(' ').some(w => w.startsWith(s))) score = 2;
    else if (s.length === 2 && st === s) score = 3;
    else if (s.length >= 3 && full.includes(s)) score = 4;
    if (score >= 0) hits.push({ c, score });
  }
  hits.sort((a, b) => a.score - b.score || a.c.rank - b.c.rank || b.c.pop - a.c.pop);
  return hits.slice(0, limit).map(h => h.c);
}

// ── SCRUBBER ────────────────────────────────────────────────────────────
// The window: grid.times if present (about -6 h .. +48 h), else now-6 h ..
// now+48 h. now is clamped inside it.
export function scrubRange(grid, now) {
  const ts = grid && grid.times && grid.times.length > 1 ? grid.times : null;
  const t0 = ts ? ts[0] : now - 6 * H, t1 = ts ? ts[ts.length - 1] : now + 48 * H;
  return { t0, t1, now: clamp(now, t0, t1) };
}

// Ticks at local hours divisible by 6 in zone tz; day labels at midnight.
// [{ t, u (0..1), h, major, label }]
export function scrubTicks(t0, t1, tz) {
  const out = [];
  if (!(t1 > t0)) return out;
  for (let t = Math.ceil(t0 / H) * H; t <= t1; t += H) {
    const p = localParts(t, tz);
    if (p.mi !== 0 || p.h % 6) continue;
    out.push({ t, u: (t - t0) / (t1 - t0), h: p.h, major: p.h === 0, label: p.h === 0 ? p.weekday : (p.h === 12 ? 'noon' : '') });
  }
  return out;
}

// Snap t to the step grid (ms) from t0, clamped to [t0, t1].
export const snapTime = (t, t0, t1, step = 15 * 60e3) => clamp(t0 + Math.round((t - t0) / step) * step, t0, t1);

// ── PALETTES ────────────────────────────────────────────────────────────
// TV temperature palette, keyed in °C (the °F anchors are in the comments).
export const TEMP_STOPS = [
  [-40, '#e6d6ff'], // -40 °F pale lilac
  [-29, '#9b6bd6'], // -20 °F violet
  [-18, '#5a4fcf'], //   0 °F indigo
  [-7, '#3b7ddd'],  //  20 °F blue
  [0, '#4fb3e8'],   //  32 °F freezing line, sky blue
  [5, '#48c9b0'],   //  41 °F teal
  [10, '#6fcf6f'],  //  50 °F green
  [16, '#c4e35a'],  //  60 °F yellow-green
  [21, '#f6d743'],  //  70 °F yellow
  [27, '#f7a03c'],  //  80 °F orange
  [32, '#ec5a3a'],  //  90 °F red
  [38, '#c22a4d'],  // 100 °F crimson
  [43, '#8e1f5f'],  // 110 °F plum
];

// NWS reflectivity ramp (dBZ).
export const DBZ_STOPS = [
  [5, '#04e9e7'], [10, '#019ff4'], [15, '#0300f4'], [20, '#02fd02'], [25, '#01c501'], [30, '#008e00'],
  [35, '#fdf802'], [40, '#e5bc00'], [45, '#fd9500'], [50, '#fd0000'], [55, '#d40000'], [60, '#bc0000'],
  [65, '#f800fd'], [70, '#9854c6'], [75, '#fdfdfd'],
];

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const toHex = c => '#' + c.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

export function rampColor(stops, v) {
  if (!Number.isFinite(v)) return '#888888';
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [b, cb] = stops[i];
    if (v <= b) {
      const [a, ca] = stops[i - 1], u = (v - a) / (b - a), A = hex(ca), B = hex(cb);
      return toHex(A.map((x, k) => x + (B[k] - x) * u));
    }
  }
  return stops[stops.length - 1][1];
}
export const tempColor = c => rampColor(TEMP_STOPS, c);

// CSS linear-gradient for a ramp over [lo, hi].
export function rampCSS(stops, lo, hi) {
  return 'linear-gradient(90deg,' + stops.filter(([v]) => v >= lo - 1e-9 && v <= hi + 1e-9)
    .map(([v, c]) => `${c} ${((v - lo) / (hi - lo) * 100).toFixed(1)}%`).join(',') + ')';
}

// ── ICONS ───────────────────────────────────────────────────────────────
// 32x32 viewBox, drawn from a few parts. Keys are data/forecast.js icons.
const C = { sun: '#ffc547', moon: '#e4e9f2', cloud: '#eef2f7', dark: '#a9b3c2', rain: '#5cb4ff', snow: '#ffffff', bolt: '#ffd84a', ice: '#bfe3ff' };
const sunPart = (cx, cy, r) => {
  let s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.sun}"/><g stroke="${C.sun}" stroke-width="2" stroke-linecap="round">`;
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, c = Math.cos(a), n = Math.sin(a);
    s += `<line x1="${(cx + c * (r + 2.6)).toFixed(1)}" y1="${(cy + n * (r + 2.6)).toFixed(1)}" x2="${(cx + c * (r + 5)).toFixed(1)}" y2="${(cy + n * (r + 5)).toFixed(1)}"/>`;
  }
  return s + '</g>';
};
// crescent: the big arc runs through the left side, the inner arc returns
const moonPart = (cx, cy, r) => {
  const ax = (cx + r * 0.3).toFixed(1), ay = (cy - r * 0.95).toFixed(1), bx = (cx + r * 0.95).toFixed(1), by = (cy + r * 0.3).toFixed(1);
  return `<path d="M${ax} ${ay}A${r} ${r} 0 1 0 ${bx} ${by}A${(r * 0.78).toFixed(1)} ${(r * 0.78).toFixed(1)} 0 0 1 ${ax} ${ay}z" fill="${C.moon}"/>`;
};
const cloudPart = (fill, dy = 0) => `<path d="M9.5 ${24 + dy}h13.5a5.2 5.2 0 0 0 .7-10.35 7.2 7.2 0 0 0-13.6 1.6A4.4 4.4 0 0 0 9.5 ${24 + dy}z" fill="${fill}"/>`;
const drops = (n, col = C.rain) => {
  let s = `<g stroke="${col}" stroke-width="2" stroke-linecap="round">`;
  const xs = n === 2 ? [13, 19] : [11, 16, 21];
  for (const x of xs) s += `<line x1="${x}" y1="25.5" x2="${x - 1.6}" y2="29.5"/>`;
  return s + '</g>';
};
const flakes = n => {
  let s = `<g fill="${C.snow}">`;
  const xs = n === 2 ? [13, 19] : [11, 16, 21];
  xs.forEach((x, i) => { s += `<circle cx="${x - (i % 2)}" cy="${27.5 + (i % 2)}" r="1.5"/>`; });
  return s + '</g>';
};
const bolt = `<path d="M16.5 22l-3.2 5h2.6l-1.6 4 4.8-6h-2.8l1.6-3z" fill="${C.bolt}"/>`;
const fogLines = `<g stroke="${C.dark}" stroke-width="2" stroke-linecap="round"><line x1="6" y1="22" x2="26" y2="22"/><line x1="8" y1="26" x2="24" y2="26"/><line x1="10" y1="18" x2="22" y2="18"/></g>`;

const ICONS = {
  'clear-day': () => sunPart(16, 16, 6),
  'clear-night': () => moonPart(15, 16, 8),
  'mostly-clear-day': () => sunPart(14, 14, 6) + `<path d="M17 26h8a3.2 3.2 0 0 0 .3-6.4 4.4 4.4 0 0 0-8.4 1A2.7 2.7 0 0 0 17 26z" fill="${C.cloud}"/>`,
  'mostly-clear-night': () => moonPart(13, 13, 7) + `<path d="M17 26h8a3.2 3.2 0 0 0 .3-6.4 4.4 4.4 0 0 0-8.4 1A2.7 2.7 0 0 0 17 26z" fill="${C.cloud}"/>`,
  'partly-cloudy-day': () => sunPart(12, 11, 5) + cloudPart(C.cloud, 1),
  'partly-cloudy-night': () => moonPart(11, 10, 6) + cloudPart(C.cloud, 1),
  overcast: () => `<path d="M14 18h9a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.4 1.3A3.4 3.4 0 0 0 14 18z" fill="${C.dark}"/>` + cloudPart(C.cloud, 1),
  fog: () => fogLines,
  drizzle: () => cloudPart(C.cloud, -2) + drops(2),
  rain: () => cloudPart(C.cloud, -2) + drops(3),
  'heavy-rain': () => cloudPart(C.dark, -2) + drops(3) + `<line x1="13.5" y1="27" x2="12" y2="31" stroke="${C.rain}" stroke-width="2" stroke-linecap="round"/>`,
  'freezing-rain': () => cloudPart(C.cloud, -2) + drops(2, C.ice) + `<circle cx="16" cy="28.5" r="1.4" fill="${C.ice}"/>`,
  snow: () => cloudPart(C.cloud, -2) + flakes(3),
  'heavy-snow': () => cloudPart(C.dark, -2) + flakes(3) + `<circle cx="13.5" cy="30" r="1.3" fill="${C.snow}"/>`,
  'showers-day': () => sunPart(11, 9, 4.5) + cloudPart(C.cloud, -1) + drops(2),
  'showers-night': () => moonPart(10, 9, 5) + cloudPart(C.cloud, -1) + drops(2),
  thunder: () => cloudPart(C.dark, -3) + bolt,
  'thunder-hail': () => cloudPart(C.dark, -3) + bolt + `<g fill="${C.ice}"><circle cx="10.5" cy="27" r="1.4"/><circle cx="22" cy="27.5" r="1.4"/></g>`,
  unknown: () => `<circle cx="16" cy="16" r="9" fill="none" stroke="${C.dark}" stroke-width="2"/>`,
};
export const ICON_KEYS = Object.keys(ICONS);

export function iconSVG(key, size = 32, title = '') {
  const body = (ICONS[key] || ICONS.unknown)();
  const t = title ? `<title>${esc(title)}</title>` : '';
  return `<svg class="wx-icon" viewBox="0 0 32 32" width="${size}" height="${size}" role="img" aria-hidden="${title ? 'false' : 'true'}">${t}${body}</svg>`;
}

// Legend swatch of a front type (WPC colours), 56x16.
export const FRONT_COLORS = { COLD: '#2f6fff', WARM: '#ff3b30', STNRY: '#ff3b30', OCFNT: '#a24bd8', TROF: '#d08a3a', DRYLINE: '#c9a27a', SQLN: '#ff3b30' };
export function frontSVG(type) {
  const y = 9, w = 56;
  const tri = (x, up, col) => `<path d="M${x - 4} ${y}L${x} ${up ? y - 6 : y + 6}L${x + 4} ${y}z" fill="${col}"/>`;
  const semi = (x, up, col) => `<path d="M${x - 4} ${y}A4 4 0 0 ${up ? 1 : 0} ${x + 4} ${y}z" fill="${col}"/>`;
  const line = (col, dash = '') => `<line x1="2" y1="${y}" x2="${w - 2}" y2="${y}" stroke="${col}" stroke-width="2.4"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  let s = '';
  if (type === 'COLD') s = line(FRONT_COLORS.COLD) + [12, 28, 44].map(x => tri(x, true, FRONT_COLORS.COLD)).join('');
  else if (type === 'WARM') s = line(FRONT_COLORS.WARM) + [12, 28, 44].map(x => semi(x, true, FRONT_COLORS.WARM)).join('');
  else if (type === 'STNRY') s = `<line x1="2" y1="${y}" x2="28" y2="${y}" stroke="${FRONT_COLORS.COLD}" stroke-width="2.4"/><line x1="28" y1="${y}" x2="54" y2="${y}" stroke="${FRONT_COLORS.WARM}" stroke-width="2.4"/>` + tri(15, false, FRONT_COLORS.COLD) + semi(41, true, FRONT_COLORS.WARM);
  else if (type === 'OCFNT') s = line(FRONT_COLORS.OCFNT) + tri(14, true, FRONT_COLORS.OCFNT) + semi(28, true, FRONT_COLORS.OCFNT) + tri(42, true, FRONT_COLORS.OCFNT);
  else if (type === 'TROF') s = line(FRONT_COLORS.TROF, '6 4');
  else if (type === 'DRYLINE') s = line(FRONT_COLORS.DRYLINE) + [12, 28, 44].map(x => `<circle cx="${x}" cy="${y - 4}" r="2.4" fill="none" stroke="${FRONT_COLORS.DRYLINE}" stroke-width="1.6"/>`).join('');
  else s = line('#888');
  return `<svg viewBox="0 0 ${w} 18" width="${w}" height="18" aria-hidden="true">${s}</svg>`;
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// The layer toggles, in panel order. key = app.layers key.
export const LAYERS = [
  { key: 'temp', name: 'Temperature' },
  { key: 'radar', name: 'Radar' },
  { key: 'clouds', name: 'Clouds' },
  { key: 'fronts', name: 'Fronts' },
  { key: 'isobars', name: 'Pressure' },
  { key: 'labels', name: 'City temperatures' },
];

// The phone layout query; style.css uses the same one.
export const PHONE_MQ = '(max-width: 768px), (max-height: 500px) and (pointer: coarse)';

// ── DOM ─────────────────────────────────────────────────────────────────
// createUI(app, hooks): hooks = {
//   regions() -> [{ id, name }]   focus chips (DIRECTOR REGIONS or a fallback)
//   goRegion(id)                  chip click
//   goCity(city)                  search pick (fly + open the forecast)
//   setLayer(key, on)             toggle
//   setUnits(u), setLight(mode), saver(), now() -> reference now (ms),
//   range() -> { t0, t1, now }    the scrubber window
//   cities                        the search list
// }
// Returns { update(dt), setStatus(text, live), setFocus(focus), refreshRegions(),
//           setActiveRegion(id), legend(stops?) }
export function createUI(app, hooks) {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const ui = {};
  const phone = () => matchMedia(PHONE_MQ).matches;

  // ── top bar
  const badge = $('badge'), focusName = $('focusName'), focusTime = $('focusTime'), focusDate = $('focusDate');
  ui.setStatus = (text, live) => {
    const s = $('status');
    if (s) s.textContent = text || '';
    if (badge && live !== undefined) {
      badge.dataset.state = live === true ? 'live' : live === false ? 'sample' : 'wait';
      badge.textContent = live === true ? 'Live' : live === false ? 'Sample data' : 'Loading';
    }
  };
  ui.setFocus = f => { if (focusName) focusName.textContent = f && f.name ? f.name : 'United States'; };

  // ── focus chips
  const chips = $('regionChips');
  let activeRegion = null;
  ui.refreshRegions = () => {
    if (!chips) return;
    chips.textContent = '';
    for (const r of hooks.regions()) {
      const b = el('button', 'chip', esc(r.name));
      b.type = 'button';
      b.dataset.id = r.id;
      b.setAttribute('aria-pressed', String(r.id === activeRegion));
      b.addEventListener('click', () => { hooks.goRegion(r.id); if (phone()) sheet.close(); });
      chips.append(b);
    }
  };
  ui.setActiveRegion = id => {
    activeRegion = id;
    if (chips) for (const b of chips.children) b.setAttribute('aria-pressed', String(b.dataset.id === id));
  };

  // ── city search (combobox + listbox)
  const q = $('search'), list = $('searchList');
  let results = [], sel = -1;
  const renderResults = () => {
    list.textContent = '';
    results.forEach((c, i) => {
      const cur = app.data.current && app.data.current.get ? app.data.current.get(c.id) : null;
      const li = el('li', 'opt', `<span class="n">${esc(c.name)}</span><span class="s">${esc(c.state)}</span>` +
        (cur && Number.isFinite(cur.t2m) ? `<span class="t">${esc(tempOne(cur.t2m, app.units))}</span>` : ''));
      li.id = `opt-${c.id}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === sel));
      li.addEventListener('pointerdown', e => { e.preventDefault(); choose(c); });
      list.append(li);
    });
    list.hidden = !results.length;
    q.setAttribute('aria-expanded', String(!!results.length));
    q.setAttribute('aria-activedescendant', sel >= 0 && results[sel] ? `opt-${results[sel].id}` : '');
  };
  const choose = c => {
    q.value = ''; results = []; sel = -1; renderResults(); q.blur();
    if (phone()) sheet.close();
    hooks.goCity(c);
  };
  if (q && list) {
    q.addEventListener('input', () => { results = searchCities(q.value, hooks.cities, 8); sel = results.length ? 0 : -1; renderResults(); });
    q.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (results.length) sel = (sel + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
        renderResults();
      } else if (e.key === 'Enter' && results[sel]) { e.preventDefault(); choose(results[sel]); }
      else if (e.key === 'Escape') { q.value = ''; results = []; renderResults(); q.blur(); }
      e.stopPropagation();
    });
    q.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 120));
  }

  // ── layer toggles
  const layerBox = $('layerList');
  if (layerBox) {
    for (const L of LAYERS) {
      const b = el('button', 'tog', `<span class="sw" aria-hidden="true"></span><span>${esc(L.name)}</span>`);
      b.type = 'button';
      b.dataset.key = L.key;
      b.setAttribute('role', 'switch');
      b.setAttribute('aria-checked', String(!!app.layers[L.key]));
      b.addEventListener('click', () => {
        const on = !app.layers[L.key];
        b.setAttribute('aria-checked', String(on));
        hooks.setLayer(L.key, on);
        legendSync();
      });
      layerBox.append(b);
    }
  }
  ui.syncLayers = () => {
    if (layerBox) for (const b of layerBox.children) b.setAttribute('aria-checked', String(!!app.layers[b.dataset.key]));
    legendSync();
  };

  // ── units + light
  const unitBtns = document.querySelectorAll('[data-units]');
  const syncUnits = () => unitBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.units === app.units)));
  unitBtns.forEach(b => b.addEventListener('click', () => { hooks.setUnits(b.dataset.units); syncUnits(); legendSync(); }));
  syncUnits();
  ui.syncUnits = () => { syncUnits(); legendSync(); };
  const lightBtns = document.querySelectorAll('[data-light]');
  const syncLight = () => lightBtns.forEach(b => b.setAttribute('aria-pressed', String(app.lightMode === 'real')));
  lightBtns.forEach(b => b.addEventListener('click', () => { hooks.setLight(app.lightMode === 'real' ? 'day' : 'real'); syncLight(); }));
  syncLight();
  ui.syncLight = syncLight;
  for (const id of ['saverBtn', 'dockSaver']) { const b = $(id); if (b) b.addEventListener('click', () => hooks.saver()); }

  // ── legend
  let tempStops = TEMP_STOPS;
  const legendSync = () => {
    const lg = $('legend');
    if (!lg) return;
    const lo = -18, hi = 43; // 0 °F .. 110 °F
    const rows = [];
    if (app.layers.temp || app.layers.labels) {
      const ticksF = [0, 20, 40, 60, 80, 100], ticksC = [-15, 0, 15, 30, 40];
      const tk = (app.units === 'C' ? ticksC : ticksF.map(fToC)).map(c => {
        const v = app.units === 'C' ? `${c}°` : `${Math.round(cToF(c))}°`;
        return `<span style="left:${((c - lo) / (hi - lo) * 100).toFixed(1)}%">${v}</span>`;
      }).join('');
      rows.push(`<div class="lg-row"><div class="lg-h">Temperature <span class="u">°${app.units}</span></div><div class="ramp" style="background:${rampCSS(tempStops, lo, hi)}"></div><div class="ticks">${tk}</div></div>`);
    }
    if (app.layers.radar) {
      const tk = [10, 30, 50, 70].map(v => `<span style="left:${((v - 5) / 70 * 100).toFixed(1)}%">${v}</span>`).join('');
      rows.push(`<div class="lg-row"><div class="lg-h">Radar <span class="u">dBZ</span></div><div class="ramp" style="background:${rampCSS(DBZ_STOPS, 5, 75)}"></div><div class="ticks">${tk}</div><div class="lg-sub"><span>Light</span><span>Heavy</span></div></div>`);
    }
    if (app.layers.fronts) {
      rows.push('<div class="lg-row"><div class="lg-h">Fronts</div><ul class="fronts">' +
        [['COLD', 'Cold'], ['WARM', 'Warm'], ['STNRY', 'Stationary'], ['OCFNT', 'Occluded'], ['TROF', 'Trough']]
          .map(([k, n]) => `<li>${frontSVG(k)}<span>${n}</span></li>`).join('') + '</ul></div>');
    }
    if (app.layers.isobars) rows.push('<div class="lg-row lg-hl"><span class="hl h">H</span>High <span class="hl l">L</span>Low <span class="lg-note">isobars every 4 hPa</span></div>');
    lg.innerHTML = rows.join('');
    lg.hidden = !rows.length;
  };
  // On a phone the legend moves into the Layers sheet; back on a wide screen.
  const legendEl = $('legend'), slot = $('legendSlot');
  if (legendEl && slot) {
    const mq = matchMedia(PHONE_MQ);
    const place = () => { if (mq.matches) { if (legendEl.parentNode !== slot) slot.append(legendEl); } else if (legendEl.parentNode === slot) document.body.insertBefore(legendEl, $('timebar')); };
    if (mq.addEventListener) mq.addEventListener('change', place);
    place();
  }
  ui.legend = stops => { if (Array.isArray(stops) && stops.length > 2) tempStops = stops; legendSync(); };
  legendSync();

  // ── time scrubber
  const range = $('scrub'), tLabel = $('timeLabel'), tRel = $('timeRel'), ticksBox = $('scrubTicks'), nowMark = $('scrubNow');
  const playBtns = [$('playBtn'), $('dockPlay')].filter(Boolean), nowBtns = [$('nowBtn'), $('dockNow')].filter(Boolean);
  let scrubbing = false, tickKey = '';
  const rateSel = $('rateSel');
  if (range) {
    range.addEventListener('input', () => {
      const r = hooks.range();
      scrubbing = true;
      app.followNow = false;
      app.playing = false;
      app.t = snapTime(r.t0 + (+range.value / 1000) * (r.t1 - r.t0), r.t0, r.t1);
      syncPlay();
    });
    range.addEventListener('change', () => { scrubbing = false; });
    range.addEventListener('keydown', e => e.stopPropagation());
  }
  const syncPlay = () => playBtns.forEach(b => {
    b.setAttribute('aria-pressed', String(!!app.playing));
    b.setAttribute('aria-label', app.playing ? 'Pause the time-lapse' : 'Play the time-lapse');
    b.innerHTML = app.playing
      ? '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><rect x="5" y="4" width="3.4" height="12" rx="1" fill="currentColor"/><rect x="11.6" y="4" width="3.4" height="12" rx="1" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M6 4l10 6-10 6z" fill="currentColor"/></svg>';
  });
  ui.togglePlay = () => { app.playing = !app.playing; if (app.playing) app.followNow = false; syncPlay(); };
  ui.goNow = () => { app.followNow = true; app.playing = false; app.t = hooks.now(); syncPlay(); };
  playBtns.forEach(b => b.addEventListener('click', ui.togglePlay));
  nowBtns.forEach(b => b.addEventListener('click', ui.goNow));
  if (rateSel) rateSel.addEventListener('change', () => { app.rate = +rateSel.value || 3; });
  ui.syncPlay = syncPlay;
  syncPlay();

  // ── phone dock + bottom sheet
  const panel = $('panel'), grip = $('sheetGrip');
  const sheet = {
    open(tab) {
      if (!panel) return;
      panel.classList.add('open');
      if (tab) panel.dataset.tab = tab;
      document.querySelectorAll('#dock [data-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === panel.dataset.tab && panel.classList.contains('open'))));
    },
    close() {
      if (!panel) return;
      panel.classList.remove('open', 'full');
      document.querySelectorAll('#dock [data-tab]').forEach(b => b.setAttribute('aria-pressed', 'false'));
    },
  };
  ui.sheet = sheet;
  document.querySelectorAll('#dock [data-tab]').forEach(b => b.addEventListener('click', () => {
    if (panel.classList.contains('open') && panel.dataset.tab === b.dataset.tab) sheet.close();
    else sheet.open(b.dataset.tab);
  }));
  if (grip) {
    let y0 = null;
    grip.addEventListener('pointerdown', e => { y0 = e.clientY; grip.setPointerCapture(e.pointerId); });
    grip.addEventListener('pointerup', e => {
      if (y0 == null) return;
      const dy = e.clientY - y0;
      y0 = null;
      if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else sheet.close(); }
      else if (dy < -40) panel.classList.add('full');
      else panel.classList.toggle('full');
    });
  }
  const closeBtn = $('panelClose');
  if (closeBtn) closeBtn.addEventListener('click', () => sheet.close());

  // ── per-frame
  let clockAcc = 1;
  ui.update = dt => {
    const r = hooks.range();
    const f = app.focus || {};
    const tz = f.tz || 'America/Chicago';
    // the scrubber
    if (range && !scrubbing) range.value = String(Math.round((app.t - r.t0) / Math.max(1, r.t1 - r.t0) * 1000));
    if (nowMark) {
      // the range thumb travels 8 px in from each end of the track
      const u = clamp((r.now - r.t0) / Math.max(1, r.t1 - r.t0), 0, 1);
      nowMark.style.left = `calc(8px + ${(u * 100).toFixed(2)}% - ${(u * 16).toFixed(1)}px)`;
    }
    const key = `${r.t0}|${r.t1}|${tz}`;
    if (ticksBox && key !== tickKey) {
      tickKey = key;
      ticksBox.innerHTML = scrubTicks(r.t0, r.t1, tz).map(k =>
        `<span class="tk${k.major ? ' major' : ''}" style="left:${(k.u * 100).toFixed(2)}%">${k.label ? `<em>${esc(k.label)}</em>` : ''}</span>`).join('');
    }
    clockAcc += dt;
    if (clockAcc < 0.25) return;
    clockAcc = 0;
    const rel = relHours(app.t, r.now);
    if (tLabel) tLabel.textContent = `${fmtDay(app.t, tz)} ${fmtClock(app.t, tz)} ${tzAbbr(app.t, tz)}`;
    if (tRel) { tRel.textContent = app.followNow ? 'Now' : rel; tRel.dataset.kind = app.followNow || rel === 'Now' ? 'now' : app.t < r.now ? 'past' : 'future'; }
    // the focus clock is the real wall time of the place, not the scrubber
    const wall = hooks.wallNow ? hooks.wallNow() : Date.now();
    if (focusTime) focusTime.textContent = `${fmtClock(wall, tz)} ${tzAbbr(wall, tz)}`;
    if (focusDate) focusDate.textContent = fmtDate(wall, tz);
  };

  ui.refreshRegions();
  return ui;
}
