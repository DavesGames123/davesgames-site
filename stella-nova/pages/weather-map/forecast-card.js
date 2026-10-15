// ============================================================================
//  WEATHER MAP  ·  forecast-card.js — the full forecast for one place
// ----------------------------------------------------------------------------
//  openForecast(target) opens the card for a city ({ id, name, state, lat,
//  lon, tz }) or a bare point ({ lat, lon }). It loads data/forecast.js
//  loadForecast and shows: now (both units, feels like, wind, humidity,
//  pressure), a 48 h chart (temperature line, precipitation bars, SVG), a
//  10-day list with high/low bars, sunrise and sunset, UV, and the local
//  time and date of the place (ticking). closeForecast() hides it.
//
//  The card lives in #card (index.html). The builders (hourlyChartSVG,
//  dailyRowsHTML, nowHTML) are pure strings, so node tests run them.
//
//  grep -n targets: "export function initForecastCard", "export async function openForecast",
//    "export function closeForecast", "export function hourlyChartSVG",
//    "export function dailyRowsHTML", "export function nowHTML", "export function placeTitle"
// ============================================================================
import { loadForecast, codeText } from './data/forecast.js';
import { nearestCity } from './data/cities.js';
import {
  fmtTemp, tempParts, tempOne, fmtWind, fmtPrecip, fmtPressure, compass, fmtClock, fmtHour, fmtDate, fmtDay,
  tzAbbr, iconSVG, tempColor, cToF, esc,
} from './ui.js';

const H = 3600e3;
let ctx = { app: null, root: null, onClose: null };
let token = 0, tick = 0, shown = null;

// ── PURE BUILDERS ───────────────────────────────────────────────────────
// The place title: a city name, or "40.71° N, 74.01° W" (near: "near X").
export function placeTitle(target, near) {
  if (target && target.name) return { name: target.name, sub: target.state || '' };
  const la = target.lat, lo = target.lon;
  const name = `${Math.abs(la).toFixed(2)}° ${la >= 0 ? 'N' : 'S'}, ${Math.abs(lo).toFixed(2)}° ${lo >= 0 ? 'E' : 'W'}`;
  return { name, sub: near ? `Near ${near.name}, ${near.state}` : '' };
}

export function nowHTML(fc, units) {
  const c = fc.current || {};
  const tp = tempParts(c.t2m, units);
  const ct = codeText(c.code, c.isDay !== false);
  const d0 = (fc.daily || [])[0] || {};
  const facts = [
    ['Feels like', fmtTemp(c.feels, units)],
    ['Wind', `${compass(c.dir)} ${fmtWind(c.wind, units)}`.trim()],
    ['Gusts', fmtWind(c.gust, units)],
    ['Humidity', Number.isFinite(c.rh) ? `${Math.round(c.rh)}%` : '–'],
    ['Pressure', fmtPressure(c.msl, units)],
    ['Cloud cover', Number.isFinite(c.cloud) ? `${Math.round(c.cloud)}%` : '–'],
  ];
  return `<div class="fc-now">
  <div class="fc-big">${iconSVG(ct.icon, 64, ct.text)}<div class="fc-temp"><span class="v">${esc(tp.main)}</span><span class="u">${esc(tp.unit)}</span><span class="alt">${esc(tp.alt)}</span></div></div>
  <div class="fc-cond">${esc(ct.text)}${Number.isFinite(d0.max) ? `<span class="hilo">H ${esc(tempOne(d0.max, units))} · L ${esc(tempOne(d0.min, units))}</span>` : ''}</div>
  <dl class="fc-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
</div>`;
}

// Smooth path through points (Catmull-Rom as cubic Béziers).
function smoothPath(pts) {
  if (!pts.length) return '';
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

// 48 h chart: the temperature line in the units-first scale over a soft
// area, precipitation bars (mm, right scale) and the chance of rain as a
// faint band; local 6 h ticks; a "now" rule at opts.now.
export function hourlyChartSVG(hourly, units, tz, opts = {}) {
  const W = opts.w || 360, Hh = opts.h || 150, padL = 30, padR = 8, padT = 16, padB = 22;
  const rows = (hourly || []).filter(h => Number.isFinite(h.time) && Number.isFinite(h.t2m)).slice(0, 48);
  if (rows.length < 2) return `<svg class="fc-chart" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="No hourly data"><text x="${W / 2}" y="${Hh / 2}" text-anchor="middle" class="ax">No hourly data</text></svg>`;
  const conv = c => (units === 'C' ? c : cToF(c));
  const vals = rows.map(h => conv(h.t2m));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max(2, (hi - lo) * 0.15);
  lo = Math.floor((lo - pad) / 5) * 5; hi = Math.ceil((hi + pad) / 5) * 5;
  const t0 = rows[0].time, t1 = rows[rows.length - 1].time;
  const X = t => padL + (t - t0) / (t1 - t0) * (W - padL - padR);
  const Y = v => padT + (hi - v) / (hi - lo) * (Hh - padT - padB);
  const pts = rows.map((h, i) => [X(h.time), Y(vals[i])]);
  const line = smoothPath(pts);
  const base = Hh - padB;
  const area = `${line}L${pts[pts.length - 1][0].toFixed(1)} ${base}L${pts[0][0].toFixed(1)} ${base}Z`;
  const maxP = Math.max(2, ...rows.map(h => (Number.isFinite(h.precip) ? h.precip : 0)));
  const bw = Math.max(2, (W - padL - padR) / rows.length - 1.5);
  let bars = '';
  for (const h of rows) {
    if (Number.isFinite(h.pop) && h.pop > 0) bars += `<rect class="pop" x="${(X(h.time) - bw / 2).toFixed(1)}" y="${padT}" width="${bw.toFixed(1)}" height="${(base - padT).toFixed(1)}" opacity="${(h.pop / 100 * 0.16).toFixed(3)}"/>`;
    if (Number.isFinite(h.precip) && h.precip > 0.04) {
      const bh = Math.max(1.5, h.precip / maxP * (base - padT) * 0.55);
      bars += `<rect class="pr" x="${(X(h.time) - bw / 2).toFixed(1)}" y="${(base - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="1"/>`;
    }
  }
  // gradient stops follow the TV palette over the value range
  const gstops = [0, 0.25, 0.5, 0.75, 1].map(u => {
    const v = hi - u * (hi - lo), c = units === 'C' ? v : (v - 32) * 5 / 9;
    return `<stop offset="${u}" stop-color="${tempColor(c)}"/>`;
  }).join('');
  let grid = '';
  for (let v = lo; v <= hi + 1e-9; v += (hi - lo) > 30 ? 10 : 5) {
    grid += `<line class="gl" x1="${padL}" x2="${W - padR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="ax" x="${padL - 5}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end">${Math.round(v)}°</text>`;
  }
  let xt = '';
  for (const h of rows) {
    const hr = new Date(h.time);
    const lp = fmtHour(h.time, tz);
    // local hour from the formatter: label 12 AM / 6 AM / noon / 6 PM
    const hh = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', hour: 'numeric', hourCycle: 'h23' }).format(hr)) % 24;
    if (hh % 6) continue;
    const x = X(h.time).toFixed(1);
    const label = hh === 0 ? fmtDay(h.time, tz) : hh === 12 ? 'Noon' : lp;
    xt += `<line class="${hh === 0 ? 'gd' : 'gx'}" x1="${x}" x2="${x}" y1="${padT}" y2="${base}"/><text class="ax${hh === 0 ? ' day' : ''}" x="${x}" y="${Hh - 6}" text-anchor="middle">${esc(label)}</text>`;
  }
  // high and low marks
  const iMax = vals.indexOf(Math.max(...vals)), iMin = vals.indexOf(Math.min(...vals));
  const mark = (i, above) => `<circle class="mk" cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="3"/><text class="mkt" x="${pts[i][0].toFixed(1)}" y="${(pts[i][1] + (above ? -7 : 14)).toFixed(1)}" text-anchor="middle">${Math.round(vals[i])}°</text>`;
  let nowRule = '';
  if (Number.isFinite(opts.now) && opts.now >= t0 && opts.now <= t1) {
    const x = X(opts.now).toFixed(1);
    nowRule = `<line class="nowr" x1="${x}" x2="${x}" y1="${padT - 6}" y2="${base}"/><text class="nowt" x="${x}" y="${padT - 8}" text-anchor="middle">Now</text>`;
  }
  const id = `g${Math.random().toString(36).slice(2, 8)}`;
  return `<svg class="fc-chart" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Temperature and precipitation for the next 48 hours">
<defs><linearGradient id="${id}l" x1="0" y1="0" x2="0" y2="1">${gstops}</linearGradient>
<linearGradient id="${id}a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient></defs>
${grid}${xt}${bars}<path class="area" d="${area}" fill="url(#${id}a)"/><path class="tl" d="${line}" stroke="url(#${id}l)"/>${mark(iMax, true)}${iMin !== iMax ? mark(iMin, false) : ''}${nowRule}
</svg>`;
}

// 10-day rows: day, icon, chance of rain, low, a bar from low to high on
// the shared range of all days (coloured by the TV palette), high.
export function dailyRowsHTML(daily, units, tz) {
  const days = (daily || []).filter(d => Number.isFinite(d.max) && Number.isFinite(d.min)).slice(0, 10);
  if (!days.length) return '<p class="fc-empty">No daily forecast.</p>';
  const lo = Math.min(...days.map(d => d.min)), hi = Math.max(...days.map(d => d.max)), span = Math.max(1, hi - lo);
  return '<ol class="fc-days">' + days.map((d, i) => {
    const ct = codeText(d.code, true);
    const a = (d.min - lo) / span * 100, b = (d.max - lo) / span * 100;
    const name = i === 0 ? 'Today' : fmtDay(d.date + 12 * H, tz);
    const pop = Number.isFinite(d.pop) && d.pop >= 10 ? `<span class="pop">${Math.round(d.pop)}%</span>` : '<span class="pop"></span>';
    return `<li><span class="day">${esc(name)}</span><span class="ic">${iconSVG(ct.icon, 26, ct.text)}</span>${pop}` +
      `<span class="lo">${esc(tempOne(d.min, units))}</span>` +
      `<span class="bar"><i style="left:${a.toFixed(1)}%;width:${Math.max(3, b - a).toFixed(1)}%;background:linear-gradient(90deg,${tempColor(d.min)},${tempColor(d.max)})"></i></span>` +
      `<span class="hi">${esc(tempOne(d.max, units))}</span></li>`;
  }).join('') + '</ol>';
}

function sunHTML(fc, units) {
  const d = (fc.daily || [])[0] || {}, tz = fc.tz;
  const len = Number.isFinite(d.sunrise) && Number.isFinite(d.sunset) ? (d.sunset - d.sunrise) / H : NaN;
  const uv = d.uv, uvTxt = !Number.isFinite(uv) ? '–' : `${uv.toFixed(0)} · ${uv < 3 ? 'Low' : uv < 6 ? 'Moderate' : uv < 8 ? 'High' : uv < 11 ? 'Very high' : 'Extreme'}`;
  const cells = [
    ['Sunrise', fmtClock(d.sunrise, tz)],
    ['Sunset', fmtClock(d.sunset, tz)],
    ['Daylight', Number.isFinite(len) ? `${Math.floor(len)} h ${Math.round((len % 1) * 60)} min` : '–'],
    ['UV index', uvTxt],
    ['Wind max', fmtWind(d.windMax, units)],
    ['Rain today', fmtPrecip(d.sum, units)],
  ];
  return `<dl class="fc-sun">${cells.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}

// ── DOM ─────────────────────────────────────────────────────────────────
export function initForecastCard(opts) {
  ctx = { ...ctx, ...opts };
  const root = ctx.root || document.getElementById('card');
  ctx.root = root;
  if (!root || root.dataset.wired) return;
  root.dataset.wired = '1';
  root.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeForecast(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !root.hidden) closeForecast(); });
}

export function isOpen() { return !!(ctx.root && !ctx.root.hidden); }
export function current() { return shown; }

export function closeForecast() {
  token++;
  clearInterval(tick);
  shown = null;
  if (ctx.root) { ctx.root.classList.remove('open'); ctx.root.hidden = true; }
  document.documentElement.classList.remove('wx-card');
  if (ctx.onClose) ctx.onClose();
}

function shell(title, tz) {
  return `<div class="fc-scrim" data-close></div><section class="fc-panel" role="dialog" aria-modal="false" aria-labelledby="fcTitle">
<header class="fc-head"><div class="fc-place"><h2 id="fcTitle">${esc(title.name)}${title.sub ? ` <span class="st">${esc(title.sub)}</span>` : ''}</h2>
<div class="fc-clock"><span class="fc-time"></span><span class="fc-date"></span></div></div>
<button type="button" class="fc-x" data-close aria-label="Close the forecast"><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></header>
<div class="fc-body" data-tz="${esc(tz || '')}"><div class="fc-loading"><span class="spin" aria-hidden="true"></span>Loading the forecast…</div></div>
</section>`;
}

function render(fc, target) {
  const app = ctx.app || {}, units = app.units || 'F', tz = fc.tz || target.tz || 'UTC';
  const body = ctx.root.querySelector('.fc-body');
  if (!body) return;
  const note = fc.live === false
    ? `<p class="fc-note">${fc.sampleOf ? `The live forecast did not load. This is a saved sample forecast for ${esc(fc.sampleOf.name)}, ${esc(fc.sampleOf.state)}.` : 'The live forecast did not load. This is the last saved copy.'}</p>` : '';
  const chartNow = Date.now();
  body.innerHTML = note + nowHTML(fc, units) +
    `<h3>Next 48 hours <span class="leg"><i class="l-t"></i>Temperature °${units}<i class="l-p"></i>Precipitation</span></h3>` +
    hourlyChartSVG(fc.hourly, units, tz, { now: chartNow }) +
    '<h3>10 days</h3>' + dailyRowsHTML(fc.daily, units, tz) +
    '<h3>Sun and sky</h3>' + sunHTML(fc, units) +
    '<p class="fc-attr">Weather data by Open-Meteo.com (CC BY 4.0)</p>';
}

function startClock(tz) {
  const tEl = ctx.root.querySelector('.fc-time'), dEl = ctx.root.querySelector('.fc-date');
  const upd = () => {
    const t = Date.now();
    if (tEl) tEl.textContent = `${fmtClock(t, tz)} ${tzAbbr(t, tz)}`;
    if (dEl) dEl.textContent = fmtDate(t, tz);
  };
  clearInterval(tick);
  upd();
  tick = setInterval(upd, 1000);
}

// target: a city, or { lat, lon }. A bare point uses the nearest city's
// zone until the forecast names its own zone.
export async function openForecast(target, opts = {}) {
  if (!target || !Number.isFinite(target.lat) || !Number.isFinite(target.lon)) return null;
  if (!ctx.root) initForecastCard({});
  const root = ctx.root;
  if (!root) return null;
  const my = ++token;
  const near = target.name ? null : nearestCity(target.lat, target.lon, 1.5);
  const known = target.tz || (near && near.tz) || (nearestCity(target.lat, target.lon, 12) || {}).tz || null;
  const tz = known || 'UTC';
  shown = { ...target, tz };
  root.innerHTML = shell(placeTitle(target, near), tz);
  root.hidden = false;
  document.documentElement.classList.add('wx-card');
  requestAnimationFrame(() => root.classList.add('open'));
  startClock(tz);
  const loader = opts.loadForecast || loadForecast;
  let fc;
  // no city near (open sea, Canada, Mexico): Open-Meteo names the zone
  // ('auto'), so the days and the clock are local, not UTC
  try { fc = await loader(target.lat, target.lon, known || 'auto'); }
  catch (e) {
    if (my !== token) return null;
    const body = root.querySelector('.fc-body');
    if (body) body.innerHTML = `<p class="fc-note">The forecast did not load (${esc(e && e.message || e)}).</p>`;
    return null;
  }
  if (my !== token) return null;
  shown.fc = fc;
  if (fc.tz && fc.tz !== tz && !fc.sampleOf) startClock(fc.tz);
  render(fc, shown);
  return fc;
}

// Re-render the open card (after a unit change).
export function refreshForecast() {
  if (shown && shown.fc && isOpen()) render(shown.fc, shown);
}
