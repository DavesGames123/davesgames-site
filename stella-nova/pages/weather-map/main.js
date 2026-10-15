// ============================================================================
//  WEATHER MAP  ·  main.js — the app object, boot, camera input, frame loop
// ----------------------------------------------------------------------------
//  Owns `app` (also window.WX). Boot order:
//    1. app + the UI chrome (ui.js) + the forecast card: these work
//       without WebGPU (search, chips, forecasts).
//    2. data loaders (data/*.js) in parallel; each result goes to the
//       layers that exist (wire()). Refresh every 10 min (the loaders hold
//       their own caches, so a refresh inside a cache period costs nothing).
//    3. createCore (render/core.js); #nogpu when it fails.
//    4. phase-2 modules by dynamic import, each in try/catch, so a missing
//       or broken module leaves the rest of the page running:
//         render/clouds.js  createClouds(core) -> layer, setGrid
//         render/fields.js  createFields(core) -> layer, setGrid, setRadar, set
//         render/fronts.js  createFronts(core) -> layer, setFronts, set
//         director.js       REGIONS, createDirector(app, { view })
//         labels.js         createLabels(root, app) -> { update(m, dt), onPick, setMarks }
//         saver.js          installSaver({ app, director, canvas, onEnter, onExit })
//                           -> saver; it also sets globalThis.snSaver and
//                           binds the S and Esc keys itself
//
//  Frame order: the saver tick (when it runs, it owns app.cam and app.t),
//  else the map clock and the director, then core.render, then the labels
//  (with the isobar marks of render/fields.js), then the chrome.
//
//  app.t is the map time (epoch ms). app.followNow keeps it at the
//  reference now; app.playing runs the time-lapse at app.rate hours per
//  second inside the scrubber window. With sample data (live false) the
//  reference now is the sample's own time, because the sample is in the
//  past (DATA report).
//
//  grep -n targets: "── APP", "── PREFS", "── NOW", "── DATA", "── LAYERS",
//    "── FOCUS", "── CAMERA", "── KEYS", "── LOOP", "── BOOT", "── SAVER"
// ============================================================================
import { createCore } from './render/core.js';
import { camState, pick, viewProj, flight, flightSeconds, FOV_Y, ALT_MIN, ALT_MAX } from './camera.js';
import { CITIES, CITY_BY_ID, nearestCity } from './data/cities.js';
import { loadGrid } from './data/grid.js';
import { loadFronts } from './data/fronts.js';
import { loadRadar } from './data/radar.js';
import { loadCurrent } from './data/now.js';
import { createUI, scrubRange, fmtClock } from './ui.js';
import { initForecastCard, openForecast, closeForecast, refreshForecast, isOpen as cardOpen } from './forecast-card.js';

const H = 3600e3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const $ = id => document.getElementById(id);
const canvas = $('view');
const NATIONAL = { lat: 38.5, lon: -97, alt: 0.95, tilt: 0.32, heading: 0 };

// ── APP ─────────────────────────────────────────────────────────────────
const app = {
  t: Date.now(), playing: false, rate: 3, units: 'F', lightMode: 'day', followNow: true,
  layers: { clouds: true, radar: true, temp: true, isobars: false, fronts: true, labels: true },
  focus: { name: 'United States', lat: NATIONAL.lat, lon: NATIONAL.lon, tz: 'America/Chicago' },
  data: { grid: null, fronts: null, radar: null, current: null },
  core: null, cam: camState(NATIONAL.lat, NATIONAL.lon, NATIONAL.alt, NATIONAL.tilt, 0),
  mods: {}, layerObjs: {}, director: null, labels: null, ui: null, saverObj: null,
};
// deno-lint-ignore no-window
window.WX = app;

// ── PREFS (per viewer; storage can throw or be empty) ────────────────────
function loadPrefs() {
  try {
    const u = localStorage.getItem('wx-units');
    if (u === 'F' || u === 'C') app.units = u;
    else if (/^en-US\b/.test(navigator.language || 'en-US') === false) app.units = 'C';
    const l = JSON.parse(localStorage.getItem('wx-layers') || 'null');
    if (l && typeof l === 'object') for (const k of Object.keys(app.layers)) if (typeof l[k] === 'boolean') app.layers[k] = l[k];
  } catch { /* defaults */ }
}
function savePrefs() {
  try {
    localStorage.setItem('wx-units', app.units);
    localStorage.setItem('wx-layers', JSON.stringify(app.layers));
  } catch { /* storage off */ }
}
loadPrefs();

// ── NOW ─────────────────────────────────────────────────────────────────
const bootWall = Date.now();
// The reference now: the wall clock, or inside a past sample its own time
// plus the time since boot.
function nowRef() {
  const g = app.data.grid;
  if (g && g.live === false && g.times && g.times.length > 1) {
    const a = g.times[0], z = g.times[g.times.length - 1], wall = Date.now();
    // a recent session copy still holds the real now
    if (wall >= a && wall <= z) return wall;
    const anchor = Number.isFinite(g.fetched) && g.fetched >= a && g.fetched <= z ? g.fetched : Math.min(z, a + 6 * H);
    return Math.min(z, anchor + (Date.now() - bootWall));
  }
  return Date.now();
}
const range = () => scrubRange(app.data.grid, nowRef());
app.nowRef = nowRef;

// ── DATA ────────────────────────────────────────────────────────────────
const sources = {};
let gpuOk = null;
async function loadAll() {
  const jobs = {
    grid: loadGrid().then(g => { app.data.grid = g; }),
    fronts: loadFronts().then(f => { app.data.fronts = f; }),
    radar: loadRadar().then(r => { app.data.radar = r; }),
    current: loadCurrent(CITIES).then(c => { app.data.current = c; }),
  };
  const keys = Object.keys(jobs);
  const res = await Promise.allSettled(keys.map(k => jobs[k].then(() => wire())));
  res.forEach((r, i) => {
    const k = keys[i], d = app.data[k];
    sources[k] = r.status === 'fulfilled' && d ? d.live !== false : false;
    if (r.status === 'rejected') console.warn(`weather-map: ${k} did not load`, r.reason);
  });
  statusLine();
}

function statusLine() {
  const live = Object.values(sources);
  if (!live.length) return;
  const allLive = live.every(Boolean);
  const off = Object.keys(sources).filter(k => !sources[k]);
  const names = { grid: 'model fields', fronts: 'fronts', radar: 'radar', current: 'city temperatures' };
  const tz = (app.focus && app.focus.tz) || 'America/Chicago';
  const txt = allLive
    ? `Live data · updated ${fmtClock(Date.now(), tz)}`
    : `Saved sample for ${off.map(k => names[k]).join(', ')} · the live source did not answer`;
  app.ui && app.ui.setStatus(gpuOk === false ? `${txt} · WebGPU is not available` : txt, allLive);
  const b = $('badge');
  if (b) b.title = allLive ? 'All sources are live' : `Not live: ${off.map(k => names[k]).join(', ')}`;
}

// Push the data to the layers once per new object.
const pushed = new WeakMap();
function once(layer, method, data) {
  if (!layer || !data || typeof layer[method] !== 'function') return;
  let seen = pushed.get(layer);
  if (!seen) pushed.set(layer, (seen = {}));
  if (seen[method] === data) return;
  seen[method] = data;
  try { layer[method](data); } catch (e) { console.warn(`weather-map: ${method} failed`, e); }
}
function wire() {
  const L = app.layerObjs, d = app.data;
  once(L.clouds, 'setGrid', d.grid);
  once(L.fields, 'setGrid', d.grid);
  once(L.fields, 'setRadar', d.radar);
  once(L.fronts, 'setFronts', d.fronts);
  // WPC H / L for the fields layer; without it, H / L come from grid extrema
  once(L.fields, 'setFronts', d.fronts);
  // a past sample: put the map time inside its window
  if (d.grid && d.grid.live === false && app.followNow) app.t = nowRef();
}

// ── LAYERS ──────────────────────────────────────────────────────────────
function call(obj, name, ...args) {
  if (obj && typeof obj[name] === 'function') { try { return obj[name](...args); } catch (e) { console.warn(`weather-map: ${name} failed`, e); } }
  return undefined;
}
function applyLayers() {
  const L = app.layerObjs, on = app.layers, core = app.core;
  if (core && L.clouds) {
    // set({ visible }) also stops the compute pass and clears the cloud
    // map (render/clouds.js); a layer without set() leaves the list
    if (typeof L.clouds.set === 'function') call(L.clouds, 'set', { visible: on.clouds });
    else if (on.clouds) core.addLayer(L.clouds); else core.removeLayer(L.clouds);
  }
  call(L.fields, 'set', { temp: on.temp, radar: on.radar, isobars: on.isobars, wind: false });
  call(L.fronts, 'set', { visible: on.fronts });
  const lr = $('labels');
  if (lr) lr.hidden = !on.labels;
}
function setLayer(key, val) {
  app.layers[key] = !!val;
  applyLayers();
  savePrefs();
}

// ── FOCUS ───────────────────────────────────────────────────────────────
const FALLBACK_REGIONS = [
  { id: 'national', name: 'National', cam: NATIONAL, cities: ['chi'] },
  { id: 'northeast', name: 'Northeast', cam: { lat: 42.3, lon: -73.8, alt: 0.3, tilt: 0.35, heading: 0 }, cities: ['nyc'] },
  { id: 'southeast', name: 'Southeast', cam: { lat: 32.6, lon: -84.2, alt: 0.32, tilt: 0.35, heading: 0 }, cities: [] },
  { id: 'midwest', name: 'Midwest', cam: { lat: 41.6, lon: -89.5, alt: 0.32, tilt: 0.35, heading: 0 }, cities: ['chi'] },
  { id: 'plains', name: 'Plains', cam: { lat: 38.6, lon: -99, alt: 0.34, tilt: 0.35, heading: 0 }, cities: [] },
  { id: 'texas', name: 'Texas', cam: { lat: 31, lon: -99.3, alt: 0.3, tilt: 0.35, heading: 0 }, cities: [] },
  { id: 'southwest', name: 'Southwest', cam: { lat: 34.2, lon: -111.5, alt: 0.32, tilt: 0.35, heading: 0 }, cities: [] },
  { id: 'rockies', name: 'Rockies', cam: { lat: 41.5, lon: -107.5, alt: 0.34, tilt: 0.35, heading: 0 }, cities: [] },
  { id: 'california', name: 'California', cam: { lat: 37, lon: -119.6, alt: 0.3, tilt: 0.35, heading: 0 }, cities: ['la'] },
  { id: 'pnw', name: 'Pacific Northwest', cam: { lat: 46.2, lon: -121, alt: 0.28, tilt: 0.35, heading: 0 }, cities: [] },
  { id: 'alaska', name: 'Alaska', cam: { lat: 62.5, lon: -152, alt: 0.62, tilt: 0.3, heading: 0 }, cities: [] },
  { id: 'hawaii', name: 'Hawaii', cam: { lat: 20.6, lon: -157.4, alt: 0.12, tilt: 0.3, heading: 0 }, cities: [] },
];
const regions = () => (app.mods.director && Array.isArray(app.mods.director.REGIONS) && app.mods.director.REGIONS.length
  ? app.mods.director.REGIONS : FALLBACK_REGIONS);

function focusOf(r) {
  const cam = r.cam || NATIONAL;
  const c0 = r.cities && r.cities.length ? CITY_BY_ID.get(r.cities[0]) : null;
  const tz = (c0 && c0.tz) || (nearestCity(cam.lat, cam.lon, 15) || {}).tz || 'America/Chicago';
  return { id: r.id, name: r.id === 'national' ? 'United States' : r.name, lat: cam.lat, lon: cam.lon, tz, region: r.id };
}

let fly = null, autoMode = null, userHold = false;   // autoMode: null | 'tour' | 'fronts'
function flyTo(to) {
  const from = { ...app.cam };
  const dest = camState(to.lat, to.lon, to.alt ?? app.cam.alt, to.tilt ?? app.cam.tilt, to.heading ?? 0);
  fly = { f: flight(from, dest), u: 0, dur: flightSeconds(from, dest) };
}
const dirBusy = d => (typeof d.busy === 'function' ? !!d.busy() : !!d.busy) || !!d.touring;
function stopTour() {
  if (!autoMode) return;
  const d = app.director;
  if (d) call(d, autoMode === 'tour' ? 'tour' : 'follow', false);
  autoMode = null;
}

function goRegion(id) {
  const r = regions().find(x => x.id === id);
  const d = app.director;
  userHold = false;
  if (id === 'tour' || id === 'fronts') {
    // Tour and Follow fronts are DIRECTOR auto modes; a second click stops
    const was = autoMode;
    stopTour();
    if (was !== id && d) { call(d, id === 'tour' ? 'tour' : 'follow', true); autoMode = id; }
    app.ui.setActiveRegion(autoMode);
    return;
  }
  stopTour();
  if (r && r.cam) app.focus = focusOf(r);
  app.ui.setFocus(app.focus);
  app.ui.setActiveRegion(id);
  if (d) call(d, 'goTo', id);
  else if (r && r.cam) flyTo(r.cam);
  setHash(`r=${id}`);
}

function goCity(c, open = true) {
  const d = app.director;
  userHold = false;
  stopTour();
  app.focus = { id: c.id, name: `${c.name}, ${c.state}`, lat: c.lat, lon: c.lon, tz: c.tz, city: c.id };
  app.ui.setFocus(app.focus);
  app.ui.setActiveRegion(null);
  const alt = clamp(c.rank === 1 ? 0.16 : 0.12, ALT_MIN, ALT_MAX);
  const target = { id: c.id, name: `${c.name}, ${c.state}`, tz: c.tz, lat: c.lat - 0.9, lon: c.lon, alt, tilt: 0.5, heading: 0 };
  if (d) call(d, 'goTo', target); else flyTo(target);
  if (open) openForecast(c);
  setHash(`c=${c.id}`);
}

function setHash(h) {
  try { history.replaceState(null, '', `#${h}`); } catch { /* sandboxed */ }
}
function readHash() {
  const m = /^#([rc])=([\w-]+)/.exec(location.hash || '');
  if (!m) return null;
  return m[1] === 'c' ? { city: CITY_BY_ID.get(m[2]) } : { region: m[2] };
}

// A click on the globe: the nearest city inside a radius that grows with
// altitude, else the point itself.
app.onPick = ll => {
  const c = nearestCity(ll.lat, ll.lon, clamp(app.cam.alt * 2.2, 0.25, 2.5));
  openForecast(c || { lat: ll.lat, lon: ll.lon });
  if (c) { app.focus = { id: c.id, name: `${c.name}, ${c.state}`, lat: c.lat, lon: c.lon, tz: c.tz, city: c.id }; app.ui.setFocus(app.focus); }
};

// ── CAMERA ──────────────────────────────────────────────────────────────
const pointers = new Map();
let dragMoved = 0, lastPinch = 0, lastMid = null, vel = { lat: 0, lon: 0 };

// Any hand on the camera stops the tour and the flight.
function stopAuto() {
  fly = null;
  if (app.director) {
    if (autoMode) { stopTour(); app.ui.setActiveRegion(null); }
    if (dirBusy(app.director)) { userHold = true; call(app.director, 'stop'); }
  }
}

function panBy(dx, dy) {
  const c = app.cam, h = canvas.clientHeight || 1;
  // ground degrees per CSS px at the target: the view height covers about
  // 2 alt tan(fov / 2) radii there
  const k = 2 * c.alt * Math.tan((app.core ? app.core.fovY : FOV_Y) / 2) / h * 180 / Math.PI;
  const ch = Math.cos(c.heading), sh = Math.sin(c.heading);
  const north = dy * ch + dx * sh, east = -dx * ch + dy * sh;
  const dLat = north * k, dLon = east * k / Math.max(0.2, Math.cos(c.lat * Math.PI / 180));
  c.lat = clamp(c.lat + dLat, -85, 85);
  c.lon = ((c.lon + dLon + 540) % 360) - 180;
  vel = { lat: dLat, lon: dLon };
}
function zoomBy(f) { app.cam.alt = clamp(app.cam.alt * f, ALT_MIN * 2, ALT_MAX); }
function tiltBy(dx, dy) {
  const c = app.cam;
  c.tilt = clamp(c.tilt + dy * 0.004, 0, 1.15);
  c.heading = c.heading - dx * 0.004;
}

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey });
  dragMoved = 0; vel = { lat: 0, lon: 0 }; lastPinch = 0; lastMid = null;
  canvas.classList.add('drag');
});
canvas.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  dragMoved += Math.abs(dx) + Math.abs(dy);
  if (dragMoved < 4) return;
  stopAuto();
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (lastPinch) zoomBy(lastPinch / Math.max(d, 1));
    if (lastMid) tiltBy(0, mid.y - lastMid.y);
    lastPinch = d; lastMid = mid;
  } else if (p.button === 2 || p.shift) tiltBy(dx, dy);
  else panBy(dx, dy);
  hideHint();
});
const up = e => {
  pointers.delete(e.pointerId);
  lastPinch = 0; lastMid = null;
  if (!pointers.size) canvas.classList.remove('drag');
  if (dragMoved < 5 && e.type === 'pointerup' && e.button === 0) {
    const r = canvas.getBoundingClientRect();
    const ll = pick(currentMatrices(), e.clientX - r.left, e.clientY - r.top);
    if (ll && typeof app.onPick === 'function') app.onPick(ll);
    vel = { lat: 0, lon: 0 };
  }
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  stopAuto();
  zoomBy(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
  hideHint();
}, { passive: false });

const hintTimer = setTimeout(() => hideHint(), 9000);
function hideHint() { clearTimeout(hintTimer); const h = $('hint'); if (h) h.classList.add('gone'); }

// The matrices of the last frame, or computed here when the GPU is off.
function currentMatrices() {
  if (app.core && app.core.lastFrame && app.core.lastFrame.m) return app.core.lastFrame.m;
  return viewProj(app.cam, canvas.clientWidth || 1, canvas.clientHeight || 1, FOV_Y);
}

// ── KEYS ────────────────────────────────────────────────────────────────
addEventListener('keydown', e => {
  const tag = (e.target && e.target.tagName) || '';
  if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
  // saver.js binds S and Esc; while it runs, the page keys are off
  if (saverOn()) return;
  const k = e.key;
  if (k === ' ') { e.preventDefault(); app.ui.togglePlay(); }
  else if (k === 'n' || k === 'N') app.ui.goNow();
  else if (k === 'u' || k === 'U') setUnits(app.units === 'F' ? 'C' : 'F');
  else if (k === '/') { e.preventDefault(); const q = $('search'); if (q) { if (globalThis.matchMedia && app.ui.sheet && matchMedia('(max-width: 768px)').matches) app.ui.sheet.open('focus'); q.focus(); } }
  else if (k === 'ArrowLeft' || k === 'ArrowRight') {
    const r = range();
    app.followNow = false; app.playing = false; app.ui.syncPlay();
    app.t = clamp(Math.round((app.t + (k === 'ArrowLeft' ? -H : H)) / H) * H, r.t0, r.t1);
  } else if (k === 'Escape') {
    if (cardOpen()) closeForecast();
    else if (app.ui.sheet) app.ui.sheet.close();
  }
});

function setUnits(u) {
  app.units = u === 'C' ? 'C' : 'F';
  savePrefs();
  app.ui.syncUnits();
  refreshForecast();
}

// ── SAVER ───────────────────────────────────────────────────────────────
// saver.js (installSaver) owns the saver state. app.saverObj is null until
// bootSaver() has run.
const saverOn = () => !!(app.saverObj && app.saverObj.active);
function toggleSaver() {
  const s = app.saverObj;
  if (!s) { app.ui.setStatus('The screensaver is not available yet'); return; }
  try { s.toggle(); } catch (e) { console.warn('weather-map: saver toggle failed', e); }
}
// On enter: close the card and the sheet, stop the auto modes and any
// flight. saver.js sets app.layers itself; the layer objects follow here.
function onSaverEnter() {
  closeForecast();
  if (app.ui.sheet) app.ui.sheet.close();
  stopTour(); fly = null; vel = { lat: 0, lon: 0 }; userHold = false;
  app.ui.setActiveRegion(null);
  applyLayers();
}
function onSaverExit() {
  applyLayers();
  if (app.ui.syncLayers) app.ui.syncLayers();
  app.ui.syncPlay();
}

// ── LOOP ────────────────────────────────────────────────────────────────
let last = performance.now(), focusKey = '', lastMarks = null;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const r = range();
  app.tBase = r.now;   // labels.js and saver.js: the "now" the observations belong to
  let saverRan = false;
  if (app.saverObj) {
    try { saverRan = !!app.saverObj.tick(dt); } catch (e) { console.warn('weather-map: saver tick failed', e); }
  }
  if (!saverRan) clockAndCamera(dt, r);
  if (app.core && !app.core.lost) {
    try { app.core.render(app.cam, app); } catch (e) { console.error(e); app.core.lost = true; app.ui.setStatus('The renderer stopped'); }
  }
  // the isobar values (and grid H / L without WPC) from render/fields.js
  const F = app.layerObjs.fields;
  if (app.labels && F && typeof F.marks === 'function') {
    const mk = F.marks();
    if (mk && mk !== lastMarks) { lastMarks = mk; call(app.labels, 'setMarks', mk); }
  }
  if (app.labels && typeof app.labels.update === 'function') {
    try { app.labels.update(currentMatrices(), dt); } catch (e) { console.warn('weather-map: labels failed', e); app.labels = null; }
  }
  app.ui.update(dt);
  requestAnimationFrame(frame);
}

function clockAndCamera(dt, r) {
  // the map time
  if (app.followNow) app.t = r.now;
  else if (app.playing) {
    app.t += dt * app.rate * H;
    if (app.t > r.t1) app.t = r.t0;
  }
  if (!app.followNow) app.t = clamp(app.t, r.t0, r.t1);
  // the camera: the director (tour or move), else a fallback flight, else the glide
  const d = app.director;
  if (d && typeof d.tick === 'function') {
    let c = null;
    try { c = d.tick(dt); } catch (e) { console.warn('weather-map: director tick failed', e); }
    const busy = dirBusy(d);
    if (!busy) userHold = false;
    if (busy && !userHold && c && Number.isFinite(c.lat)) {
      if (c !== app.cam) Object.assign(app.cam, { lat: c.lat, lon: c.lon, alt: c.alt, tilt: c.tilt || 0, heading: c.heading || 0 });
    }
    // the director's forecast time-lapse while it holds in an auto mode
    const lapse = +d.lapseHours || 0;
    if (lapse && app.followNow) app.t = clamp(r.now + lapse * H, r.t0, r.t1);
    if (focusKey !== (app.focus && app.focus.name)) { focusKey = app.focus && app.focus.name; app.ui.setFocus(app.focus); }
  }
  if (fly) {
    fly.u = Math.min(1, fly.u + dt / fly.dur);
    Object.assign(app.cam, fly.f(fly.u));
    if (fly.u >= 1) fly = null;
  } else if (!pointers.size && (vel.lat || vel.lon)) {
    const c = app.cam, k = Math.exp(-dt * 4);
    c.lat = clamp(c.lat + vel.lat * dt * 50, -85, 85);
    c.lon = ((c.lon + vel.lon * dt * 50 + 540) % 360) - 180;
    vel = { lat: vel.lat * k, lon: vel.lon * k };
    if (Math.abs(vel.lat) + Math.abs(vel.lon) < 1e-4) vel = { lat: 0, lon: 0 };
  }
}

// ── BOOT ────────────────────────────────────────────────────────────────
async function opt(path) {
  try { return await import(path); }
  catch (e) { console.warn(`weather-map: ${path} is not loaded`, e); return null; }
}

async function makeLayer(path, factory) {
  const mod = await opt(path);
  app.mods[factory] = mod;
  if (!mod || typeof mod[factory] !== 'function' || !app.core) return null;
  try {
    const layer = await mod[factory](app.core);
    if (layer) app.core.addLayer(layer);
    return layer || null;
  } catch (e) { console.warn(`weather-map: ${factory} failed`, e); return null; }
}

async function bootGPU() {
  if (!navigator.gpu) { $('nogpu').hidden = false; return false; }
  try { app.core = await createCore(canvas); }
  catch (e) { console.error(e); $('nogpu').hidden = false; return false; }
  addEventListener('resize', () => app.core && app.core.resize());
  app.core.textures.then(st => {
    const have = ['day', 'detail', 'night', 'height', 'water'].filter(k => st && st[k]);
    if (!have.length) app.ui.setStatus('Earth imagery is not available, flat colours shown');
  }).catch(() => {});
  const [clouds, fields, fronts] = await Promise.all([
    makeLayer('./render/clouds.js', 'createClouds'),
    makeLayer('./render/fields.js', 'createFields'),
    makeLayer('./render/fronts.js', 'createFronts'),
  ]);
  Object.assign(app.layerObjs, { clouds, fields, fronts });
  // the legend follows the fields palette when the module exports one
  const fm = app.mods.createFields;
  if (fm && (fm.TEMP_STOPS || fm.TEMP_RAMP)) app.ui.legend(fm.TEMP_STOPS || fm.TEMP_RAMP);
  return true;
}

// The clear area for DIRECTOR's framing: the canvas minus the chrome that
// covers it (top bar, the desktop panel, the time bar).
function clearInsets() {
  const W = canvas.clientWidth || 1, Hh = canvas.clientHeight || 1, cr = canvas.getBoundingClientRect();
  const rect = id => { const e = $(id); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return b.width && b.height ? b : null; };
  const top = rect('top'), panel = rect('panel'), bar = rect('timebar');
  const ins = { t: top ? Math.max(0, top.bottom - cr.top - 12) : 0, r: 0, b: 0, l: 0 };
  if (panel && panel.left < W * 0.3 && panel.bottom > cr.top && panel.top < cr.bottom && panel.width < W * 0.5) ins.l = Math.max(0, panel.right - cr.left);
  if (bar && bar.top < cr.bottom) ins.b = Math.max(0, cr.bottom - bar.top);
  return { w: W, h: Hh, inset: ins };
}
function syncView() {
  if (!app.director || typeof app.director.view !== 'function') return;
  const v = clearInsets();
  try { app.director.view(v.w, v.h, v.inset); } catch { /* director view */ }
}

async function bootDirector() {
  const dm = await opt('./director.js');
  app.mods.director = dm;
  if (dm && typeof dm.createDirector === 'function') {
    // view(): the canvas minus the chrome, read at each move, so a region
    // fit leaves the panel, the top bar and the time bar clear
    try { app.director = dm.createDirector(app, { view: clearInsets }); } catch (e) { console.warn('weather-map: createDirector failed', e); }
    syncView();
    addEventListener('resize', syncView);
  }
  app.ui.refreshRegions();
  const lm = await opt('./labels.js');
  if (lm && typeof lm.createLabels === 'function') {
    try {
      app.labels = lm.createLabels($('labels'), app);
      call(app.labels, 'onPick', c => {
        if (!c) return;
        const city = c.id && CITY_BY_ID.get(c.id) ? CITY_BY_ID.get(c.id) : c;
        openForecast(city);
        if (city.name) { app.focus = { id: city.id, name: city.state ? `${city.name}, ${city.state}` : city.name, lat: city.lat, lon: city.lon, tz: city.tz, city: city.id }; app.ui.setFocus(app.focus); }
      });
    } catch (e) { console.warn('weather-map: createLabels failed', e); app.labels = null; }
  }
}

async function bootSaver() {
  const sm = await opt('./saver.js');
  if (sm && typeof sm.installSaver === 'function') {
    try {
      app.saverObj = sm.installSaver({
        app, director: app.director, canvas,
        resize: () => { if (app.core) app.core.resize(); syncView(); },
        onEnter: onSaverEnter, onExit: onSaverExit,
      });
    } catch (e) { console.warn('weather-map: installSaver failed', e); app.saverObj = null; }
  }
}

async function boot() {
  app.ui = createUI(app, {
    regions, goRegion, goCity, setLayer, setUnits,
    setLight: m => { app.lightMode = m; },
    saver: toggleSaver, now: nowRef, wallNow: () => Date.now(), range, cities: CITIES,
  });
  initForecastCard({ app, root: $('card') });
  app.ui.setStatus('Loading weather data…', undefined);
  app.ui.setFocus(app.focus);
  requestAnimationFrame(frame);

  const data = loadAll();
  const gpu = await bootGPU();
  gpuOk = gpu;
  await bootDirector();
  applyLayers();
  wire();
  await bootSaver();
  await data;
  statusLine();

  const h = readHash();
  if (h && h.city) goCity(h.city, true);
  else if (h && h.region && regions().some(r => r.id === h.region)) goRegion(h.region);
  else if (regions()[0]) app.ui.setActiveRegion(regions()[0].id);

  // refresh every 10 min; the loaders keep their own cache periods
  setInterval(() => { loadAll().catch(e => console.warn('weather-map: refresh failed', e)); }, 10 * 60 * 1000);
}
boot();
