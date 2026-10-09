// main.js — City Atlas page: 3D city, plate text, overlays, atlas, saver.
//
// renderer.js draws the city into #map with WebGPU. worker.js loads each
// city file off the main thread. This file does everything else: the head
// and the foot in the look of the shell screensaver plate (as Tidal
// Currents does), the overlay chips and their settings drawer, the orbit
// camera input, the place labels, the city switch with a short fade, the
// live wind from Open-Meteo, and the screensaver tour.
//
//   Left / Right   previous / next city        Space   play / pause (clock and orbit)
//   T  C  W        terrain / currents / wind    L       overlay settings
//   M              atlas (city menu)            I       about sheet
//   Esc            close the open sheet         double-click   reset the view
//   Drag to orbit, wheel or pinch to zoom, right-drag or two fingers to pan.
//   #<id> in the URL picks a city.
//
// grep: function buildOverlay  function buildLayers  function switchTo  function frame
//       function bindOrbit  function liveWind  function placeLabels  function captionHTML
//       function defaultView  function sourcesHTML  window.snSaver  function saverShot

import { project } from './camera.js';
import { LIGHTS, lightFor } from './renderer.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const canvas = $('map');
const overlay = $('overlay');
const fadeEl = $('fade');
const loadingEl = $('loading');
const fallbackEl = $('fallback');
const captionEl = $('caption');
const atlasEl = $('atlas');
const layersEl = $('layers');
const scrim = $('scrim');
const headEl = $('head');
const footEl = $('foot');
const scrubEl = $('scrub');

const DAYS_SECONDS = 60;            // the 48 hours of current data in about 60 s
const IDLE_MS = 2500;
const ORBIT_IDLE_MS = 6000;         // auto-orbit after this much time without input
const STORE_KEY = 'city-atlas.city';
const DEFAULT_ID = 'new-york';
const KNOTS = 1 / 0.514444;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ICON_PAUSE = '<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="2.5" y="1.5" width="3" height="11" rx="0.6"/><rect x="8.5" y="1.5" width="3" height="11" rx="0.6"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 1.6v10.8a.5.5 0 0 0 .76.43l8.6-5.4a.5.5 0 0 0 0-.86l-8.6-5.4a.5.5 0 0 0-.76.43z"/></svg>';
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

// ─── state ──────────────────────────────────────────────────────────────────
let cities = [];
let locIndex = 0;
let meta = null;              // meta of the city on screen
let renderer = null;
let worker = null;
let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let scrubbing = false;
let hour = 0;
let lastT = null;
let switchToken = 0;
let saver = false;
let ui = {};
let renderScale = 1;
const pending = new Map();    // id -> Promise of the worker result
const slots = new Map();      // id -> GPU slot (renderer.upload)
let lastInput = -1e9;

const ov = {
  // terrain and wind are on at load (the user asked for both by default)
  terrain: { on: true, exag: 2, contour: true, amt: 0 },
  ocean: { on: false, amt: 0 },
  wind: { on: true, amt: 0, live: false, dirFrom: 270, speed: 5, slice: 12, seaBreeze: false, heat: true, liveInfo: null },
  view: { light: 'golden', colour: 0, orbit: true },
};
const cam = { target: [0, 0, 0], yaw: 3.6, pitch: 0.5, dist: 4500 };
let camGoal = null;            // eased toward on a city switch and a reset
let sunAz = 210;

// ─── helpers ────────────────────────────────────────────────────────────────
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lastHour = () => Math.max(1, (meta?.current?.hours ?? 49) - 1);
const LINK = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${esc(text)}</a>`;
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
const fmt = (v, d = 0) => Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

function storeGet() { try { return sessionStorage.getItem(STORE_KEY); } catch { return null; } }
function storeSet(v) { try { sessionStorage.setItem(STORE_KEY, v); } catch { /* private mode */ } }

// The data window in the city's local time zone.
function stamp(h) {
  const start = Date.parse(meta?.current?.startUTC || '2026-09-24T00:00:00Z');
  const d = new Date(start + Math.floor(h) * 3600e3);
  try {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: meta?.tz || 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' });
    return f.format(d).replace(',', '');
  } catch {
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}:00 UTC`;
  }
}

const coarse = matchMedia('(pointer: coarse)');
function device() {
  const short = Math.min(window.innerWidth, window.innerHeight);
  const phone = coarse.matches && short < 600;
  return { phone, tablet: coarse.matches && !phone };
}

// PAGE MARK. The number and the section of this page, counted as the saver
// plate counts them (lib/screensaver.js allPages). The section colour goes to --c.
function pageMark() {
  const cat = window.SN_SAVER_CATALOG?.pages ?? {};
  let n = 0, hit = null;
  for (const r of window.SN_NAV ?? []) for (const c of r.constellations) for (const g of c.groups) for (const p of g.p) {
    if (p[0] === 'home' || cat[p[0]]?.tier === 'excluded') continue;
    n++;
    if (p[0] === 'city-atlas') hit = { n, con: c.label, color: c.color };
  }
  if (!hit) return { text: 'City atlas', color: null };
  return { text: `No. ${String(hit.n).padStart(3, '0')} · ${hit.con}`, color: hit.color };
}

// ─── sources ────────────────────────────────────────────────────────────────
// Who made each dataset and under what terms. The foot line, the overlay
// groups and the about sheet read these, so they cannot disagree.
function currentSource(m) {
  const c = m?.current;
  if (!c) return null;
  const parts = [];
  if (c.tidal) {
    if (c.tidal.agency === 'Marine Institute') parts.push({ short: 'Marine Institute NEATL · CC BY 4.0', html: `Currents near the city: ${esc(c.tidal.modelLong || 'Marine Institute NEATL')}, © Irish Marine Institute, ${LINK('https://erddap.marine.ie/erddap/griddap/IMI_NEATL.html', 'Marine Institute ERDDAP')}, ${LINK('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0')}. Changes: hourly surface currents resampled to this map's grid.` });
    else parts.push({ short: `NOAA ${c.tidal.model} · public domain`, html: `Currents near the city: ${esc(c.tidal.modelLong || 'NOAA ' + c.tidal.model)}, ${LINK('https://tidesandcurrents.noaa.gov/models.html', 'NOAA NOS CO-OPS')}. U.S. Government work, public domain.` });
  }
  if (c.sources.includes('HYCOM')) parts.push({ short: 'HYCOM ESPC-D-V02', html: `${c.tidal ? 'Currents offshore' : 'Currents'}: Navy ESPC-D-V02 global HYCOM analysis, 1/12° (cells of about 4 to 9 km), hourly surface velocity, from ${LINK('https://www.hycom.org/dataserver/espc-d-v02', 'HYCOM.org')} (U.S. Navy, FNMOC; freely available). It resolves the regional current and the tide, not the harbour channels; near the coast its field is carried a short way into the harbour and fades out over 3 km.` });
  return { short: parts.map((p) => p.short).join(' + '), html: parts.map((p) => `<li>${p.html}</li>`).join('') };
}

function sourcesHTML(m) {
  const items = [];
  items.push(`<li>Buildings, water and place names: ${LINK('https://overturemaps.org/', 'Overture Maps Foundation')} release 2026-09-23.1, ${LINK('https://opendatacommons.org/licenses/odbl/1-0/', 'ODbL 1.0')}. Includes © ${LINK('https://www.openstreetmap.org/copyright', 'OpenStreetMap contributors')} and the other sources that ${LINK('https://docs.overturemaps.org/attribution/', 'Overture lists')}. The building and water data of this page are a derived database under the same licence.</li>`);
  items.push(`<li>Land cover: © ESA WorldCover project 2021 / contains modified Copernicus Sentinel data (2021) processed by the ESA WorldCover consortium, ${LINK('https://esa-worldcover.org/', 'esa-worldcover.org')}, ${LINK('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0')}.</li>`);
  items.push(`<li>Elevation and sea floor: ${LINK('https://registry.opendata.aws/terrain-tiles/', 'Terrain Tiles on AWS')} (Mapzen terrarium). United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey. Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration. Europe terrain data produced using Copernicus data and information funded by the European Union - EU-DEM layers. United Kingdom terrain data © Environment Agency copyright and/or database right 2015. All rights reserved. Canada terrain data contains information licensed under the Open Government Licence – Canada. Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017. Full list: ${LINK('https://github.com/tilezen/joerd/blob/master/docs/attribution.md', 'terrain tile attribution')}.</li>`);
  const cs = currentSource(m);
  if (cs) items.push(cs.html);
  items.push(`<li>Default wind (2025 wind rose): ERA5 reanalysis via the ${LINK('https://open-meteo.com/', 'Open-Meteo')} historical API. Live wind: Open-Meteo forecast API. Weather data by Open-Meteo.com, ${LINK('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0')}.</li>`);
  items.push(`<li>Idea: ${LINK('https://github.com/opengeos/GeoLibre', 'GeoLibre')} by Qiusheng Wu (opengeos, MIT), which shows open buildings and terrarium terrain in the browser. This page uses none of its code.</li>`);
  items.push('<li>Renderer, wind solver, current streaks and design: Dave, for Stella Nova.</li>');
  return `<section id="capCredits" class="credits"><h3>Credits and licences</h3><ul>${items.join('')}</ul></section>`;
}

// ─── overlay content (head, foot, labels) ───────────────────────────────────
const param = (v, label, extra = '') => `<div class="p"><span class="v">${v}</span>${extra}<small>${esc(label)}</small></div>`;

function buildOverlay() {
  overlay.textContent = '';
  $('ttl').textContent = meta.title;
  $('sub').textContent = [meta.country, meta.region].filter((s) => s && s !== meta.title).join(' · ');
  const days = Math.round(lastHour() / 24);
  scrubEl.querySelectorAll('.tick').forEach((t) => t.remove());
  scrubEl.setAttribute('aria-valuemax', String(lastHour()));
  for (let i = 1; i < days; i++) {
    const tick = el('i', 'tick');
    tick.style.left = (i / days * 100) + '%';
    scrubEl.prepend(tick);
  }
  const labels = [];
  for (const lb of meta.labels ?? []) {
    const n = el('div', `lbl s-right z-${lb.size || 'sm'}${lb.water ? ' water' : ''}`);
    n.append(el('div', 'dot'), el('div', 'txt', esc(lb.water ? titleCase(lb.name) : lb.name)));
    n.dataset.size = lb.size || 'sm';
    overlay.appendChild(n);
    labels.push({ node: n, lb });
  }
  ui = { labels };
  fillParams();
}
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s.-])([a-z])/g, (m, a, b) => a + b.toUpperCase());

function fillParams() {
  invalidate(3);
  if (!meta) return;
  const b = meta.buildings;
  const parts = [param(`${fmt(b.count)}`, 'buildings'), param(`<i class="sym">h</i><sub>max</sub> = ${fmt(b.tallest)} m`, 'tallest')];
  if (ov.ocean.on && meta.current) parts.push(param('<i class="sym">t</i> = <span id="pTime"></span>', 'current data'));
  if (ov.ocean.on && meta.current) parts.push(param(`<i class="sym m1">u</i><sub>max</sub> = ${fmt(meta.curMax * KNOTS, 1)} kn`, 'fastest water'));
  if (ov.wind.on) parts.push(param(`<i class="sym">U</i> = ${fmt(ov.wind.speed, 1)} m/s ${compass(ov.wind.dirFrom)}`, ov.wind.live ? 'live wind' : 'wind'));
  if (ov.terrain.on) parts.push(param(`× ${fmt(ov.terrain.exag, 1)}`, 'relief'));
  $('params').innerHTML = parts.join('');
  ui.time = $('pTime');
  const what = [];
  if (ov.terrain.on) what.push('real relief, sea floor in blue');
  if (ov.ocean.on) what.push(meta.current ? 'streaks follow the surface current' : 'no current data here');
  if (ov.wind.on) what.push('streaks follow a simulated wind');
  if (!what.length) what.push('drag to orbit, pick an overlay below');
  const cs = currentSource(meta);
  const src = ['© OpenStreetMap contributors · Overture Maps · ESA WorldCover'];
  if (ov.ocean.on && cs) src.push(cs.short);
  if (ov.wind.on && ov.wind.live) src.push('Open-Meteo');
  const line = what.join('; ');
  $('notes').innerHTML = `${esc(meta.region)}. ${esc(line[0].toUpperCase() + line.slice(1))}.<span class="src">${esc(src.join(' · '))}</span>`;
  scrubEl.classList.toggle('off', !(ov.ocean.on && meta.current));
  updateClockUI(true);
}

let shownHour = -1, shownF = -1;
const scrubFill = scrubEl.querySelector('.fill'), scrubKnob = scrubEl.querySelector('.knob');
function updateClockUI(force) {
  const f = clamp(hour / lastHour(), 0, 1);
  // the bar moves only when it moves a visible amount: no style work per frame
  if (force || Math.abs(f - shownF) > 5e-4) {
    shownF = f;
    scrubFill.style.transform = `scaleX(${f})`;
    scrubKnob.style.left = (f * 100) + '%';
  }
  const h = Math.floor(hour);
  if (force || h !== shownHour) {
    shownHour = h;
    if (ui.time) ui.time.textContent = stamp(h);
    scrubEl.setAttribute('aria-valuenow', String(h));
    scrubEl.setAttribute('aria-valuetext', stamp(h));
    const t = $('ocTime');
    if (t) { t.value = String(h); $('ocTimeOut').textContent = stamp(h).replace(/ [A-Z+0-9:-]+$/, ''); }
  }
}

function bindScrub(prog) {
  const setFrom = (e) => {
    const r = prog.getBoundingClientRect();
    hour = clamp((e.clientX - r.left) / r.width, 0, 1) * lastHour();
    updateClockUI();
  };
  prog.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    scrubbing = true;
    try { prog.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    setFrom(e);
  });
  prog.addEventListener('pointermove', (e) => { if (scrubbing) setFrom(e); });
  const end = () => { scrubbing = false; };
  prog.addEventListener('pointerup', end);
  prog.addEventListener('pointercancel', end);
}

const hits = (a, b, pad = 0) => a.x0 - pad < b.x1 && a.x1 + pad > b.x0 && a.y0 - pad < b.y1 && a.y1 + pad > b.y0;
function contentBox(node) {
  let box = null;
  for (const c of node.children) {
    if (c.offsetParent === null) continue;
    const r = c.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    box = box ? { x0: Math.min(box.x0, r.left), y0: Math.min(box.y0, r.top), x1: Math.max(box.x1, r.right), y1: Math.max(box.y1, r.bottom) }
      : { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
  }
  return box;
}

// Labels at their 3D place, each frame. Hidden behind the camera, off
// screen, under the head or the foot, or on a larger label.
let keepBoxes = [], keepAt = -1e9;
function placeLabels(t) {
  const vp = renderer?.info?.vp;
  if (!vp || !ui.labels) return;
  const w = window.innerWidth, h = window.innerHeight;
  if (t - keepAt > 500) {
    keepAt = t;
    keepBoxes = [contentBox(headEl), contentBox(footEl)].filter(Boolean);
    for (const sh of [layersEl, atlasEl, captionEl]) {
      if (sh.hidden) continue;
      const r = sh.getBoundingClientRect();
      keepBoxes.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
    }
  }
  const E = ov.terrain.exag * ov.terrain.amt;
  const kept = keepBoxes.slice();
  const small = Math.min(w, h) < 520;
  for (const it of ui.labels) {
    const p = project(vp, [it.lb.x, it.lb.y, it.lb.z * E + 40], w, h);
    const n = it.node;
    if (!p || (small && it.lb.size === 'sm' && !it.lb.water)) { n.hidden = true; continue; }
    n.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    const far = p.d > cam.dist * 2.6;
    const tw = (it.w ||= n.querySelector('.txt').getBoundingClientRect().width || 80);
    const box = { x0: p.x - 3, x1: p.x + 10 + tw, y0: p.y - 8, y1: p.y + 8 };
    const off = box.x0 < 4 || box.y0 < 4 || box.x1 > w - 4 || box.y1 > h - 4;
    if (far || off || kept.some((k) => hits(box, k, 6))) { n.hidden = true; continue; }
    n.hidden = false;
    kept.push(box);
  }
}

// ─── about sheet ────────────────────────────────────────────────────────────
function captionHTML() {
  const m = meta, b = m.buildings, w = m.wind;
  const paras = [`<p>${esc(m.blurb)}</p>`];
  const facts = [
    ['Buildings in the disc', `${fmt(b.count)} (radius ${fmt(m.r, 1)} km)`],
    ['With a mapped height', `${fmt(100 * b.tagged / Math.max(1, b.count))} %`],
    ['Tallest (mapped)', `${fmt(b.tallest)} m`],
    ['Over 100 m', fmt(b.over100)],
    ['Highest ground (12 km square)', `${fmt(m.terrain.max)} m`],
    ['Deepest water (64 km square)', `${fmt(-Math.min(0, m.terrain.deepest))} m`],
    ['Prevailing wind, 2025', `from ${compass(w.prevail.dir)}, mean ${fmt(w.mean, 1)} m/s`],
  ];
  if (m.current) facts.push(['Fastest surface water', `${fmt(m.curMax * KNOTS, 1)} kn (${fmt(m.curMax, 2)} m/s)`]);
  paras.push(`<div class="facts">${facts.map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div>`);
  paras.push('<h3 class="sub">The overlays</h3>');
  paras.push('<p><b>Terrain</b> lifts the ground and the sea floor to their real heights, with a vertical exaggeration. Land shows contour lines; water is darker where it is deeper, and the relief of the sea floor shows through it.</p>');
  paras.push(m.current
    ? `<p><b>Currents</b> plays two days of hourly surface currents (${esc(stamp(0))} to ${esc(stamp(lastHour()))}). Each streak moves along the current; brighter and yellower is faster. The streak speed on screen is compressed (it grows with the 0.6 power of the real speed), so slack water still moves.</p>`
    : '<p><b>Currents</b>: no open ocean model in this atlas covers the water here, so this overlay is off for this city.</p>');
  paras.push(`<p><b>Wind</b> is a simplified simulation, not a forecast. Two nested 2D lattice Boltzmann solvers run on your GPU: a coarse one over 12 km, where hills higher than about ${fmt((m.groundRef || 0) + 160)} m are walls and the land and the city add drag, and a fine one over the buildings (cells of about ${fmt(2 * m.fHalf / 640)} m), where every building taller than the slice height is a wall. The fine solver takes its inflow from the coarse one. It shows channelling along streets, wakes and vortex shedding behind towers, and the slower wind over the city than over water. It has no vertical motion and no heat, and its Reynolds number is far below the real one, so the speeds are only relative. The optional sea breeze adds a weak push from the sea toward the land.</p>`);
  paras.push('<h3 class="sub">Controls</h3><p>Drag to orbit. Wheel or pinch to zoom. Right-drag or two fingers to pan. Double-click to reset. Keys: T, C and W turn the overlays on and off; L opens their settings; Left and Right change the city.</p>');
  paras.push(sourcesHTML(m));
  return paras.join('');
}

function setCaption(open) {
  if (open) { setAtlas(false); if (device().phone) setLayers(false); }
  captionEl.hidden = !open;
  $('info').setAttribute('aria-pressed', String(open));
  if (open && meta) {
    $('capTitle').innerHTML = `${esc(meta.title)}<small>${esc(meta.country)} · ${fmt(Math.abs(meta.lat), 3)}° ${meta.lat >= 0 ? 'N' : 'S'}, ${fmt(Math.abs(meta.lon), 3)}° ${meta.lon >= 0 ? 'E' : 'W'}</small>`;
    $('capBody').innerHTML = captionHTML();
  }
  syncScrim();
}

// ─── atlas (city menu) ──────────────────────────────────────────────────────
function thumbFor(c) {
  const img = el('img', 'a-thumb');
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.onerror = () => img.replaceWith(el('div', 'a-thumb none'));
  img.src = new URL(`data/thumbs/${c.id}.webp`, import.meta.url).href;
  return img;
}

let atlasBuilt = false;
function buildAtlas() {
  const body = $('atlasBody');
  $('atlasCount').textContent = `${cities.length} cities`;
  const groups = new Map();
  cities.forEach((c, i) => {
    if (!groups.has(c.region)) groups.set(c.region, []);
    groups.get(c.region).push({ ...c, i });
  });
  body.textContent = '';
  for (const [region, items] of groups) {
    const sec = el('section', 'a-group');
    sec.appendChild(el('h3', null, `${esc(region)}<small>${items.length}</small>`));
    const grid = el('div', 'a-grid');
    for (const it of items) {
      const b = el('button', 'a-item');
      b.type = 'button';
      b.dataset.index = String(it.i);
      b.appendChild(thumbFor(it));
      const cap = el('span', 'a-cap');
      cap.append(el('span', 'a-title', esc(it.title)), el('span', 'a-model', esc(`${it.country} · ${fmt(it.buildings)} buildings`)));
      b.appendChild(cap);
      b.addEventListener('click', () => { setAtlas(false); if (it.i !== locIndex) switchTo(it.i); });
      grid.appendChild(b);
    }
    sec.appendChild(grid);
    body.appendChild(sec);
  }
  atlasBuilt = true;
  markAtlas();
}
function markAtlas() {
  for (const b of atlasEl.querySelectorAll('.a-item')) b.setAttribute('aria-current', String(+b.dataset.index === locIndex));
}
function setAtlas(open) {
  if (open) { setCaption(false); if (device().phone) setLayers(false); }
  atlasEl.hidden = !open;
  $('where').setAttribute('aria-expanded', String(open));
  if (open) {
    if (!atlasBuilt) buildAtlas(); else markAtlas();
    requestAnimationFrame(() => atlasEl.querySelector('.a-item[aria-current="true"]')?.scrollIntoView({ block: 'nearest' }));
  }
  syncScrim();
}
function setLayers(open) {
  if (open && device().phone) { setCaption(false); setAtlas(false); }
  layersEl.hidden = !open;
  $('layersBtn').setAttribute('aria-expanded', String(open));
  if (open) syncLayers();
  syncScrim();
}
function syncScrim() {
  keepAt = -1e9;
  const phone = document.body.classList.contains('phone');
  scrim.hidden = atlasEl.hidden && (captionEl.hidden || !phone) && (layersEl.hidden || !phone);
}

function bindSheetDrag(sheet, grip, close) {
  let y0 = null;
  grip.addEventListener('pointerdown', (e) => { y0 = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch { /* */ } });
  grip.addEventListener('pointermove', (e) => { if (y0 != null) sheet.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`; });
  const end = (e) => {
    if (y0 == null) return;
    const dy = e.clientY - y0;
    y0 = null;
    sheet.style.transform = '';
    if (dy > 70) close();
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

// ─── overlay settings drawer ────────────────────────────────────────────────
const sw = (id, on, label) => `<button class="sw" id="${id}" type="button" role="switch" aria-checked="${on}" aria-label="${esc(label)}"></button>`;
const range = (id, label, min, max, step, val) =>
  `<label class="row"><span>${esc(label)}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><output id="${id}Out"></output></label>`;
const seg = (id, label, opts, cur) => `<div class="row two"><span>${esc(label)}</span><span class="seg" id="${id}">${opts.map(([v, t]) =>
  `<button type="button" data-v="${v}" aria-pressed="${String(v) === String(cur)}">${esc(t)}</button>`).join('')}</span></div>`;

function buildLayers() {
  const body = $('layersBody');
  body.innerHTML = `
  <section class="lg" data-k="terrain" id="lgTerrain">
    <h3>Terrain ${sw('swTerrain', ov.terrain.on, 'Terrain')}</h3>
    <p class="why">Real elevation and sea floor, draped and lit, with the buildings standing on it.</p>
    ${range('trExag', 'Exaggeration', 1, 6, 0.25, ov.terrain.exag)}
    <div class="row two"><span>Contours</span>${sw('swContour', ov.terrain.contour, 'Contour lines')}</div>
    <p class="src">Terrain Tiles on AWS (terrarium) · ESA WorldCover</p>
  </section>
  <section class="lg" data-k="ocean" id="lgOcean">
    <h3>Currents ${sw('swOcean', ov.ocean.on, 'Currents')}</h3>
    <p class="why" id="ocWhy"></p>
    ${range('ocTime', 'Time', 0, 48, 1, 0)}
    <div class="legend" id="ocLegend"></div><div class="ticks" id="ocTicks"></div>
    <p class="src" id="ocSrc"></p>
  </section>
  <section class="lg" data-k="wind" id="lgWind">
    <h3>Wind ${sw('swWind', ov.wind.on, 'Wind')}</h3>
    <p class="why">A simplified 2D flow simulation around the buildings and hills. Speeds are relative.</p>
    <div class="row two"><span>Live wind</span>${sw('swLive', ov.wind.live, 'Live wind from Open-Meteo')}</div>
    <div class="status" id="wdStatus"></div>
    ${range('wdDir', 'From', 0, 359, 1, ov.wind.dirFrom)}
    ${range('wdSpeed', 'Speed', 1, 20, 0.5, ov.wind.speed)}
    ${range('wdSlice', 'Slice height', 5, 150, 5, ov.wind.slice)}
    <div class="row two"><span>Speed map</span>${sw('swHeat', ov.wind.heat, 'Wind speed map')}</div>
    <div class="row two"><span>Sea breeze</span>${sw('swBreeze', ov.wind.seaBreeze, 'Sea breeze')}</div>
    <div class="legend" id="wdLegend"></div><div class="ticks" id="wdTicks"></div>
    <p class="src">Lattice Boltzmann D2Q9 on WebGPU · default wind: ERA5 2025 rose via Open-Meteo (CC BY 4.0)</p>
  </section>
  <section class="lg" data-k="view" id="lgView">
    <h3>View</h3>
    ${seg('vwLight', 'Light', Object.keys(LIGHTS).map((k) => [k, k[0].toUpperCase() + k.slice(1)]), ov.view.light)}
    ${seg('vwColour', 'Colour', [[0, 'Height'], [1, 'Use']], ov.view.colour)}
    <div class="row two"><span>Slow orbit</span>${sw('swOrbit', ov.view.orbit, 'Slow orbit when idle')}</div>
  </section>`;
  const ramp = 'linear-gradient(90deg, rgb(20,41,115), rgb(26,140,217) 25%, rgb(77,217,166) 50%, rgb(250,219,89) 75%, rgb(255,247,230))';
  $('ocLegend').style.background = ramp;
  $('wdLegend').style.background = ramp;
  const onSw = (id, fn) => $(id).addEventListener('click', (e) => {
    const b = e.currentTarget;
    const v = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(v));
    fn(v);
    invalidate(3);
  });
  onSw('swTerrain', (v) => setOverlay('terrain', v));
  onSw('swOcean', (v) => setOverlay('ocean', v));
  onSw('swWind', (v) => setOverlay('wind', v));
  onSw('swContour', (v) => { ov.terrain.contour = v; });
  onSw('swHeat', (v) => { ov.wind.heat = v; });
  onSw('swBreeze', (v) => { ov.wind.seaBreeze = v; pushWind(); });
  onSw('swOrbit', (v) => { ov.view.orbit = v; });
  onSw('swLive', (v) => { ov.wind.live = v; if (v) liveWind(); else { setWindStatus(''); syncLayers(); } fillParams(); });
  $('trExag').addEventListener('input', (e) => { ov.terrain.exag = +e.target.value; syncLayers(); fillParams(); });
  $('ocTime').addEventListener('input', (e) => { hour = +e.target.value; updateClockUI(true); });
  let dirT = 0;
  $('wdDir').addEventListener('input', (e) => {
    ov.wind.dirFrom = +e.target.value; ov.wind.live = false; $('swLive').setAttribute('aria-checked', 'false');
    syncLayers(); clearTimeout(dirT); dirT = setTimeout(pushWind, 160); fillParams();
  });
  $('wdSpeed').addEventListener('input', (e) => {
    ov.wind.speed = +e.target.value; ov.wind.live = false; $('swLive').setAttribute('aria-checked', 'false');
    syncLayers(); pushWind(); fillParams();
  });
  let sliceT = 0;
  $('wdSlice').addEventListener('input', (e) => { ov.wind.slice = +e.target.value; syncLayers(); clearTimeout(sliceT); sliceT = setTimeout(pushWind, 160); });
  for (const id of ['vwLight', 'vwColour']) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (id === 'vwLight') ov.view.light = b.dataset.v; else ov.view.colour = +b.dataset.v;
      syncLayers();
    });
  }
  syncLayers();
}

function syncLayers() {
  invalidate(3);
  if (!$('lgTerrain')) return;
  const set = (id, v) => { const b = $(id); if (b) b.setAttribute('aria-checked', String(!!v)); };
  set('swTerrain', ov.terrain.on); set('swOcean', ov.ocean.on); set('swWind', ov.wind.on);
  set('swContour', ov.terrain.contour); set('swHeat', ov.wind.heat); set('swBreeze', ov.wind.seaBreeze);
  set('swOrbit', ov.view.orbit); set('swLive', ov.wind.live);
  $('lgTerrain').classList.toggle('on', ov.terrain.on);
  $('lgOcean').classList.toggle('on', ov.ocean.on);
  $('lgWind').classList.toggle('on', ov.wind.on);
  $('trExag').value = String(ov.terrain.exag);
  $('trExagOut').textContent = `× ${fmt(ov.terrain.exag, 2)}`;
  $('wdDir').value = String(Math.round(ov.wind.dirFrom));
  $('wdDirOut').textContent = `${Math.round(ov.wind.dirFrom)}° ${compass(ov.wind.dirFrom)}`;
  $('wdSpeed').value = String(ov.wind.speed);
  $('wdSpeedOut').textContent = `${fmt(ov.wind.speed, 1)} m/s`;
  $('wdSlice').value = String(ov.wind.slice);
  $('wdSliceOut').textContent = `${ov.wind.slice} m`;
  const top = windTop();
  $('wdTicks').innerHTML = `<span>0</span><span>${fmt(top / 4, 1)}</span><span>${fmt(top, 1)} m/s</span>`;   // square-root scale
  for (const id of ['vwLight', 'vwColour']) {
    const cur = id === 'vwLight' ? ov.view.light : ov.view.colour;
    for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === String(cur)));
  }
  if (meta) {
    const has = !!meta.current;
    $('swOcean').disabled = !has;
    $('ocTime').disabled = !has;
    $('ocTime').max = String(lastHour());
    const cs = currentSource(meta);
    $('ocWhy').textContent = has ? 'Two days of hourly surface currents as streaks on the water. Brighter is faster.' : 'No open ocean model in this atlas covers the water here.';
    $('ocSrc').textContent = cs ? cs.short : '';
    const t = meta.curTop || 0.5;
    $('ocTicks').innerHTML = has ? `<span>0</span><span>${fmt(t / 2, 2)}</span><span>${fmt(t, 2)} m/s · ${fmt(t * KNOTS, 1)} kn</span>` : '';
  }
  for (const [k, id] of [['terrain', 'chipTerrain'], ['ocean', 'chipOcean'], ['wind', 'chipWind']]) $(id).setAttribute('aria-pressed', String(ov[k].on));
  $('chipOcean').disabled = !!meta && !meta.current;
}

const windTop = () => Math.max(ov.wind.speed * 2.2, 2.5);
function setWindStatus(text, err = false) {
  const s = $('wdStatus');
  if (!s) return;
  s.textContent = text;
  s.classList.toggle('err', err);
}

function setOverlay(k, v) {
  if (k === 'ocean' && v && meta && !meta.current) v = false;
  ov[k].on = v;
  if (k === 'wind' && v) pushWind();
  syncLayers();
  fillParams();
}

function pushWind() {
  renderer?.setWind({ dirFrom: ov.wind.dirFrom, speed: ov.wind.speed, slice: ov.wind.slice, seaBreeze: ov.wind.seaBreeze ? 1 : 0 });
  invalidate(3);
}

// LIVE WIND. Open-Meteo forecast API, current 10 m wind. CORS, no key, CC BY 4.0.
const liveCache = new Map();
async function liveWind() {
  if (!meta) return;
  const id = meta.id;
  setWindStatus('Fetching the current wind…');
  try {
    let r = liveCache.get(id);
    if (!r || Date.now() - r.at > 10 * 60e3) {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${meta.lat}&longitude=${meta.lon}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      r = { at: Date.now(), speed: j.current.wind_speed_10m, dir: j.current.wind_direction_10m, time: j.current.time };
      liveCache.set(id, r);
    }
    if (!ov.wind.live || meta.id !== id) return;
    ov.wind.dirFrom = Math.round(r.dir);
    ov.wind.speed = clamp(Math.round(r.speed * 2) / 2, 1, 20);
    ov.wind.liveInfo = r;
    setWindStatus(`Now: ${fmt(r.speed, 1)} m/s from ${compass(r.dir)} (${Math.round(r.dir)}°), ${r.time.replace('T', ' ')} UTC · Open-Meteo`);
    pushWind();
  } catch (err) {
    ov.wind.live = false;
    setWindStatus(`Live wind not available (${err.message}). The wind stays at the setting.`, true);
  }
  syncLayers();
  fillParams();
}

// ─── controls ───────────────────────────────────────────────────────────────
function syncControls() {
  $('locName').textContent = cities[locIndex]?.title ?? '';
  $('locCount').textContent = `${locIndex + 1} / ${cities.length}`;
  const p = $('play');
  p.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
  p.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  if (atlasBuilt) markAtlas();
}
function setPlaying(v) { playing = v; syncControls(); }
function step(d) { switchTo((locIndex + d + cities.length) % cities.length); }

let idleTimer = 0;
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (atlasEl.hidden && layersEl.hidden) document.body.classList.add('idle'); }, IDLE_MS);
}

function bindInput() {
  $('prev').addEventListener('click', () => step(-1));
  $('next').addEventListener('click', () => step(1));
  $('play').addEventListener('click', () => setPlaying(!playing));
  $('info').addEventListener('click', () => setCaption(captionEl.hidden));
  $('where').addEventListener('click', () => setAtlas(atlasEl.hidden));
  $('layersBtn').addEventListener('click', () => setLayers(layersEl.hidden));
  $('chipTerrain').addEventListener('click', () => setOverlay('terrain', !ov.terrain.on));
  $('chipOcean').addEventListener('click', () => setOverlay('ocean', !ov.ocean.on));
  $('chipWind').addEventListener('click', () => setOverlay('wind', !ov.wind.on));
  bindScrub(scrubEl);
  $('capClose').addEventListener('click', () => setCaption(false));
  $('atlasClose').addEventListener('click', () => setAtlas(false));
  $('layersClose').addEventListener('click', () => setLayers(false));
  scrim.addEventListener('click', () => { setAtlas(false); setCaption(false); if (device().phone) setLayers(false); });
  bindSheetDrag(captionEl, $('capGrip'), () => setCaption(false));
  bindSheetDrag(atlasEl, $('atlasGrip'), () => setAtlas(false));
  bindSheetDrag(layersEl, $('layersGrip'), () => setLayers(false));

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('input')) return;
    wake();
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === ' ' || e.code === 'Space') { if (e.target.closest?.('button')) return; e.preventDefault(); setPlaying(!playing); }
    else if (k === 'i') setCaption(captionEl.hidden);
    else if (k === 'm') setAtlas(atlasEl.hidden);
    else if (k === 'l') setLayers(layersEl.hidden);
    else if (k === 't') setOverlay('terrain', !ov.terrain.on);
    else if (k === 'c') setOverlay('ocean', !ov.ocean.on);
    else if (k === 'w') setOverlay('wind', !ov.wind.on);
    else if (e.key === 'Escape') { setCaption(false); setAtlas(false); setLayers(false); }
  });

  let tapWhileIdle = false;
  window.addEventListener('pointerdown', (e) => {
    tapWhileIdle = e.pointerType !== 'mouse' && document.body.classList.contains('idle');
  }, { capture: true, passive: true });
  for (const strip of [$('controls'), $('chips')]) {
    strip.addEventListener('click', (e) => {
      if (tapWhileIdle) { e.stopPropagation(); e.preventDefault(); tapWhileIdle = false; }
    }, { capture: true });
  }
  for (const ev of ['pointermove', 'pointerdown', 'touchstart', 'wheel']) window.addEventListener(ev, wake, { passive: true });
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', (e) => {
    const inSheet = captionEl.contains(e.target) || atlasEl.contains(e.target) || layersEl.contains(e.target);
    if (!inSheet) e.preventDefault();
  }, { passive: false });

  let rz = 0;
  const onResize = () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { relayout(); syncScrim(); }); };
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
  window.addEventListener('hashchange', () => {
    const i = cities.findIndex((c) => c.id === location.hash.slice(1));
    if (i >= 0 && i !== locIndex) switchTo(i);
  });
  document.addEventListener('visibilitychange', () => { lastT = null; });
  bindOrbit();
}

// ORBIT INPUT. One pointer orbits (mouse: left button; right or shift pans),
// two pointers pinch to zoom and pan. The wheel zooms.
function bindOrbit() {
  const pts = new Map();
  let last = null;
  const note = () => { lastInput = performance.now(); camGoal = null; invalidate(2); };
  const pan = (dx, dy) => {
    const k = cam.dist / Math.max(window.innerHeight, 1) * 1.1;
    const s = Math.sin(cam.yaw), c = Math.cos(cam.yaw);
    // screen right = (-cos, sin) east/north, screen up (forward) = (-sin, -cos)
    cam.target[0] += (-c * dx + -s * -dy) * k * -1;
    cam.target[1] += (s * dx + -c * -dy) * k * -1;
    const lim = (meta?.r || 2.5) * 1000 * 1.6;
    cam.target[0] = clamp(cam.target[0], -lim, lim);
    cam.target[1] = clamp(cam.target[1], -lim, lim);
  };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch { /* */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    last = null;
    note();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    note();
    if (pts.size === 1) {
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      if (e.buttons & 2 || e.shiftKey) pan(dx, dy);
      else {
        cam.yaw -= dx * 0.0055;
        cam.pitch = clamp(cam.pitch + dy * 0.004, 0.08, 1.45);
      }
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d = Math.hypot(a.x - b.x, a.y - b.y);
      if (last) {
        cam.dist = clamp(cam.dist * last.d / Math.max(d, 1), 350, 40000);
        pan(mid.x - last.mid.x, mid.y - last.mid.y);
      }
      last = { mid, d };
    }
  });
  const up = (e) => { pts.delete(e.pointerId); last = null; };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    note();
    const k = Math.exp(clamp(e.deltaY, -200, 200) * (e.ctrlKey ? 0.01 : 0.0015));
    cam.dist = clamp(cam.dist * k, 350, 40000);
  }, { passive: false });
  canvas.addEventListener('dblclick', () => { camGoal = defaultView(); });
}

// ─── layout ─────────────────────────────────────────────────────────────────
// RENDER SIZE. lib/render-scale.js sizes the canvas: the window x dpr (at
// most 2), then a pixel budget, then a factor that its frame-rate control
// lowers below 45 fps. The budget (PIXELS) was 3600 px long side, MSAA 4x:
// 2880 x 1800 x 4 samples on a 1440 x 900 Retina laptop. The GPU-time rule
// in governor() lowers the budget too, for a browser whose rAF does not slow.
const PIXELS = { desktop: 2.4e6, phone: 1.3e6, min: 0.7e6 };
let pixelBudget = 0, rs = null;
function makeScale() {
  const { phone } = device();
  if (!pixelBudget) pixelBudget = phone ? PIXELS.phone : PIXELS.desktop;
  rs = window.RenderScale?.create({ canvas, maxDpr: 2, fracDesktop: 1, fracMobile: 1, maxPixels: pixelBudget }) || null;
}
function syncCanvas() {
  if (renderer && (renderer.width !== canvas.width || renderer.height !== canvas.height)) {
    renderer.resize(canvas.width, canvas.height);
    invalidate(2);    // a new canvas size clears it
  }
}
function relayout() {
  const { phone } = device();
  document.body.classList.toggle('phone', phone);
  if (!rs) makeScale();
  if (rs) rs.resize();
  else {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const k = Math.min(1, Math.sqrt(pixelBudget / Math.max(1, innerWidth * innerHeight * dpr * dpr)));
    canvas.width = Math.max(1, Math.round(innerWidth * dpr * k)); canvas.height = Math.max(1, Math.round(innerHeight * dpr * k));
  }
  syncCanvas();
  for (const it of ui.labels || []) it.w = 0;
  keepAt = -1e9;
  invalidate(3);
}

// ─── city view ──────────────────────────────────────────────────────────────
// The camera looks at the skyline from the side with the most water, so
// the first view of each city is the classic one from the harbour.
function waterBearing(c) {
  const a = c.arrays.wf_in, n = a.shape[0], half = c.meta.grid.inner.half, R = c.meta.r * 1000;
  let best = 200, bestW = -1;
  for (let deg = 0; deg < 360; deg += 10) {
    const s = Math.sin(deg * Math.PI / 180), co = Math.cos(deg * Math.PI / 180);
    let w = 0;
    for (const f of [0.7, 1.0, 1.3, 1.7, 2.1]) {
      const x = s * R * f, y = co * R * f;
      const i = Math.floor((x + half) / (2 * half) * n), j = Math.floor((y + half) / (2 * half) * n);
      if (i >= 0 && j >= 0 && i < n && j < n) w += a.data[j * n + i] / 255;
    }
    if (w > bestW + 0.01) { bestW = w; best = deg; }
  }
  return best;
}

// A portrait screen sees less across, so the camera backs off to keep the disc in view.
function defaultView() {
  const R = (meta?.r || 2.4) * 1000;
  const yawDeg = meta?._bearing ?? 200;
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  const k = Math.max(1, Math.pow(1.25 / aspect, 0.75));
  return { target: [0, 0, (meta?.groundRef || 0)], yaw: yawDeg * Math.PI / 180, pitch: 0.42, dist: R * 2.05 * k };
}

// ─── city switch ────────────────────────────────────────────────────────────
// requestCity resolves on the worker's first stage (terrain, sea, wind
// arrays). r.full is a promise of the second stage (building mesh and
// raster), so a city can draw its terrain before its buildings exist.
function requestCity(i) {
  const c = cities[i];
  if (pending.has(c.id)) return pending.get(c.id);
  let fullOk, fullErr;
  const full = new Promise((res, rej) => { fullOk = res; fullErr = rej; });
  full.catch(() => {});
  const p = new Promise((resolve, reject) => {
    let base = null;
    const onMsg = (e) => {
      if (e.data.id !== c.id) return;
      const r = e.data;
      if (!r.ok) {
        worker.removeEventListener('message', onMsg);
        const err = new Error(r.error);
        if (base) fullErr(err); else { reject(err); fullErr(err); }
        return;
      }
      if (r.stage === 'base') {
        base = r;
        r.timing.baseAt = performance.now();
        const tb = performance.now();
        r.meta._bearing = waterBearing(r);
        r.timing.bearingMs = performance.now() - tb;
        r.full = full;
        resolve(r);
      } else {
        worker.removeEventListener('message', onMsg);
        Object.assign(base.timing, r.timing, { fullAt: performance.now() });
        fullOk(r);
      }
    };
    worker.addEventListener('message', onMsg);
    worker.postMessage({ id: c.id, url: new URL(`data/${c.id}.bin`, import.meta.url).href, rasterN: 1024 });
  });
  pending.set(c.id, p);
  p.catch(() => pending.delete(c.id));
  return p;
}

// GPU slot of a city: upload once, keep the current and the next one. The
// terrain uploads at once; the buildings join the slot when the worker
// sends them (renderer.addBuildings). opts.full: resolve only after that
// (the saver preloads this way, so its cut never shows a bare city).
async function slotFor(i, opts = {}) {
  const c = cities[i];
  let s = slots.get(c.id);
  if (!s) {
    const data = await requestCity(i);
    s = slots.get(c.id);
    if (!s) {
      const tu = performance.now();
      s = renderer.upload(data);
      data.timing.uploadMs = performance.now() - tu;
      s.data = data;
      slots.set(c.id, s);
      s.built = data.full.then((f) => {
        if (s.dropped) return;
        const tb = performance.now();
        renderer.addBuildings(s, f);
        data.timing.buildUploadMs = performance.now() - tb;
        if (loadLog.cur?.id === c.id) Object.assign(loadLog.cur, f.timing, { buildUploadMs: data.timing.buildUploadMs, buildings: performance.now() - loadLog.cur.t0 });
        invalidate(3);
      });
      s.built.catch((err) => console.warn('city-atlas: buildings failed', c.id, err));
    }
  }
  if (opts.full) await s.built.catch(() => {});
  return s;
}
// Decode the next city in the worker, but only when the page is idle: no
// input for 2 s, and an idle callback (Safari has none: a 2 s timer). It is
// not uploaded to the GPU until it is picked.
function preloadWhenIdle(token, i) {
  const go = () => {
    if (token !== switchToken || saver) return;
    if (performance.now() - lastInput < 2000) { setTimeout(() => preloadWhenIdle(token, i), 2000); return; }
    requestCity(i).catch(() => {});
  };
  if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 4000 }); else setTimeout(go, 2000);
}

// GPU slots: the current city, the one before it (a quick way back) and
// any ids the caller names. Decoded cities outside the slots are freed.
const recent = [];
function trimSlots(keepIds) {
  const cur = keepIds[0];
  if (cur && recent[0] !== cur) { recent.unshift(cur); recent.length = Math.min(recent.length, 2); }
  keepIds = [...keepIds, ...recent];
  for (const [id, s] of slots) {
    if (keepIds.includes(id)) continue;
    renderer.drop(s);
    slots.delete(id);
  }
  for (const id of [...pending.keys()]) if (!keepIds.includes(id) && !slots.has(id)) pending.delete(id);
}

async function switchTo(i, opts = {}) {
  const token = ++switchToken;
  const t0 = performance.now();
  locIndex = i;
  const c = cities[i];
  syncControls();
  if (!saver) {
    storeSet(c.id);
    if (location.hash.slice(1) !== c.id) history.replaceState(null, '', '#' + c.id);
  }
  fadeEl.classList.remove('clear');
  const slow = setTimeout(() => { if (token === switchToken) loadingEl.hidden = false; }, opts.initial ? 0 : 380);
  let s;
  try {
    [s] = await Promise.all([renderer ? slotFor(i) : requestCity(i).then((d) => ({ meta: d.meta, data: d })), wait(opts.initial ? 0 : (opts.fadeMs ?? 340))]);
  } catch (err) {
    clearTimeout(slow);
    if (token !== switchToken) return;
    console.warn('city-atlas: city load failed', c.id, err);
    loadingEl.hidden = false;
    loadingEl.lastChild.textContent = `${c.title}: data not available`;
    return;
  }
  clearTimeout(slow);
  if (token !== switchToken) return;
  meta = s.meta;
  if (renderer) {
    const ts = performance.now();
    renderer.show(s);
    loadLog.cur = { id: c.id, t0, ready: performance.now(), showMs: performance.now() - ts, ...(s.data?.timing || {}), cached: !!opts.cached };
    if (s.data?.timing?.fullAt) loadLog.cur.buildings = Math.max(0, s.data.timing.fullAt - t0);   // built before the switch
    trimSlots([c.id, ...(opts.keep || [])]);
  }
  if (!meta.current) ov.ocean.on = false;
  if (!opts.keepWind) {
    const p = meta.wind?.prevail;
    if (p && !ov.wind.live) { ov.wind.dirFrom = p.dir; ov.wind.speed = clamp(Math.round(p.speed * 2) / 2, 2, 12); }
  }
  pushWind();
  if (ov.wind.live) liveWind();
  hour = Math.min(hour, lastHour());
  sunAz = ((meta._bearing ?? 200) + 55) % 360;
  if (!opts.view) { Object.assign(cam, defaultView()); cam.target = cam.target.slice(); camGoal = null; }
  else Object.assign(cam, opts.view);
  buildOverlay();
  syncLayers();
  loadingEl.hidden = true;
  loadingEl.lastChild.textContent = 'Loading';
  if (!captionEl.hidden) setCaption(true);
  await document.fonts?.ready;
  if (token !== switchToken) return;
  relayout();
  invalidate(40);
  requestAnimationFrame(() => {
    fadeEl.classList.add('clear'); document.body.classList.add('shown');
    if (loadLog.cur && loadLog.cur.id === c.id) loadLog.cur.interactive = performance.now() - loadLog.cur.t0;
  });
  // preload the neighbours a moment later (not in the saver: it preloads its own next city)
  if (!saver && renderer) preloadWhenIdle(token, (i + 1) % cities.length);
}

// ─── frame loop ─────────────────────────────────────────────────────────────
// QUALITY GOVERNOR, aiming at 60 fps. render-scale.js handles the pixels
// from the frame rate. This rule reads the GPU time (submit to done) every
// 2 s: over 13 ms it lowers, in order, the wind lattice steps per frame,
// the streak count, then the pixel budget; under 6.5 ms for 6 s it raises
// them back in the reverse order. Level 0 is full quality.
const QUALITY = [
  { wind: 1, share: 1, pix: 1 },
  { wind: 0.6, share: 1, pix: 1 },
  { wind: 0.4, share: 0.7, pix: 1 },
  { wind: 0.4, share: 0.6, pix: 0.75 },
  { wind: 0.25, share: 0.5, pix: 0.55 },
  { wind: 0.25, share: 0.4, pix: 0.4 },
];
let qLevel = 0, govAt = 0, govGood = 0;
function governor(t) {
  if (t - govAt < 2000 || !renderer) return;
  govAt = t;
  const g = med(renderer.info.gpuHist);
  if (!g) return;
  let next = qLevel;
  if (g > 13 && qLevel < QUALITY.length - 1) { next = qLevel + 1; govGood = 0; }
  else if (g < 6.5) { if (++govGood >= 3 && qLevel > 0) { next = qLevel - 1; govGood = 0; } }
  else govGood = 0;
  if (next === qLevel) return;
  const pixBefore = QUALITY[qLevel].pix;
  qLevel = next;
  renderScale = QUALITY[qLevel].pix;
  if (QUALITY[qLevel].pix !== pixBefore) {
    const { phone } = device();
    pixelBudget = Math.max(PIXELS.min, (phone ? PIXELS.phone : PIXELS.desktop) * QUALITY[qLevel].pix);
    makeScale();
    relayout();
  }
  renderer.info.gpuHist.length = 0;
}

// RENDER ON DEMAND. With no overlay on, no orbit, no input and no camera
// ease, the image does not change, so the loop skips the GPU work. Any UI
// change calls invalidate(n) for n more frames.
let dirtyFrames = 0;
function invalidate(n = 2) { dirtyFrames = Math.max(dirtyFrames, n); }
function animating(t) {
  if (saver || camGoal || dirtyFrames > 0) return true;
  if (renderer?.info.shadowPending) return true;
  if (t - lastInput < 500) return true;
  if (playing && ov.view.orbit && t - lastInput > ORBIT_IDLE_MS) return true;
  for (const k of ['terrain', 'ocean', 'wind']) {
    if (Math.abs(ov[k].amt - (ov[k].on ? 1 : 0)) > 1e-3) return true;
  }
  return (ov.ocean.on && !!meta?.current) || ov.wind.on;
}

function ease(cur, goal, dt, tau) { return cur + (goal - cur) * (1 - Math.exp(-dt / tau)); }

function frame(t) {
  requestAnimationFrame(frame);
  const tf0 = performance.now();
  rafGaps.push(lastT == null ? 0 : t - lastT); if (rafGaps.length > 120) rafGaps.shift();
  const rawMs = lastT == null ? 0 : t - lastT;
  const dt = Math.min(0.1, Math.max(0, rawMs / 1000));
  lastT = t;
  if (!meta || !renderer || !renderer.current) return;
  if (rs && !saver) { rs.tick(t); syncCanvas(); }
  // the clock runs on a skipped frame too (it is only text without the currents)
  if (playing && !scrubbing) {
    hour += dt * (lastHour() / DAYS_SECONDS) * (saver ? saverRate : 1);
    if (hour >= lastHour()) hour -= lastHour();
  }
  updateClockUI();
  if (!animating(t)) { idleFrames++; return; }
  if (dirtyFrames > 0) dirtyFrames--;
  for (const k of ['terrain', 'ocean', 'wind']) {
    const goal = ov[k].on ? 1 : 0;
    ov[k].amt = Math.abs(ov[k].amt - goal) < 2e-3 ? goal : ease(ov[k].amt, goal, dt, 0.35);   // snap: the shadow map waits for a still E
  }
  const E = ov.terrain.exag * ov.terrain.amt;
  if (saver) saverTick(dt, t);
  else {
    if (camGoal) {
      for (const k of ['yaw', 'pitch', 'dist']) cam[k] = ease(cam[k], camGoal[k], dt, 0.4);
      for (let a = 0; a < 3; a++) cam.target[a] = ease(cam.target[a], camGoal.target[a], dt, 0.4);
      if (Math.abs(cam.dist - camGoal.dist) < 2 && Math.abs(cam.yaw - camGoal.yaw) < 1e-3) camGoal = null;
    }
    if (playing && ov.view.orbit && t - lastInput > ORBIT_IDLE_MS) cam.yaw += dt * 0.035;
  }
  const groundZ = (meta.groundRef || 0) * E;
  const camState = { target: [cam.target[0], cam.target[1], groundZ], yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist };
  try {
    renderer.frame({
      cam: camState, dt, time: t / 1000, dpr: canvas.width / Math.max(1, window.innerWidth),
      light: lightFor(ov.view.light, sunAz), exag: E, terrain: ov.terrain.amt,
      contour: ov.terrain.contour ? contourStep(meta) : 0, colourMode: ov.view.colour,
      ocean: { on: ov.ocean.amt * (meta.current ? 1 : 0), hour },
      wind: { on: ov.wind.amt, heat: ov.wind.heat ? 1 : 0, slice: ov.wind.slice, speed: ov.wind.speed, colourTop: windTop() },
      offsetY: saver ? saverOffsetY : 0, fovY: 0.75,
      // streak speed on screen follows the zoom: the reference current and
      // the free-stream wind move about 6 % of the view distance per second
      oceanVis: cam.dist * 0.07, windVis: cam.dist * 0.07,
      windAlpha: saver ? 0.45 : 0.7,
      windMult: QUALITY[qLevel].wind, particleShare: QUALITY[qLevel].share,
      fog: Math.max(22000, cam.dist * 6),
    });
  } catch (err) {
    console.error('city-atlas: render failed', err);
    renderer = null;
    showFallback();
    return;
  }
  framesDrawn++;
  const lc = loadLog.cur;
  if (lc && lc.firstFrame == null) { lc.firstFrame = performance.now() - lc.t0; loadLog.list.push(lc); }
  frameCpu.push(performance.now() - tf0); if (frameCpu.length > 120) frameCpu.shift();
  placeLabels(t);
  if (saver && saverLabel && t - saverPlateT >= 1000) { saverPlateT = t; saverPlate(); }
  governor(t);
}
let idleFrames = 0;

function contourStep(m) {
  const relief = Math.max(10, (m.terrain.max || 50) - (m.groundRef || 0));
  return relief > 600 ? 50 : relief > 200 ? 20 : relief > 60 ? 10 : 5;
}

function showFallback() {
  document.body.classList.add('no-gpu');
  fallbackEl.hidden = false;
  fallbackEl.innerHTML = '<p>This browser does not offer WebGPU, so the city cannot draw here. Try a recent Chrome, Edge or Safari.</p>';
}

// ─── start ──────────────────────────────────────────────────────────────────
async function start() {
  bootLog.start = performance.now();
  const mark = pageMark();
  $('cat').textContent = mark.text;
  if (mark.color) document.documentElement.style.setProperty('--c', mark.color);
  bindInput();
  buildLayers();
  wake();
  const res = await fetch(new URL('data/index.json', import.meta.url));
  cities = await res.json();
  const want = location.hash.slice(1) || storeGet() || DEFAULT_ID;
  const at = (id) => cities.findIndex((c) => c.id === id);
  locIndex = at(want) >= 0 ? at(want) : Math.max(0, at(DEFAULT_ID));
  syncControls();
  worker = new Worker(new URL('worker.js', import.meta.url), { type: 'module' });
  requestCity(locIndex).catch(() => {});
  try {
    const mod = await import('./renderer.js');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer = await mod.createRenderer(canvas, { mobile: device().phone, msaa: !device().phone && dpr < 1.5, timing: /[?&]gputime\b/.test(location.search) });
    bootLog.renderer = performance.now();
  } catch (err) {
    console.warn('city-atlas: WebGPU renderer unavailable', err?.message ?? err);
    renderer = null;
    showFallback();
  }
  relayout();
  await switchTo(locIndex, { initial: true });
  requestAnimationFrame(frame);
}

// ─── screensaver ────────────────────────────────────────────────────────────
// The shell screensaver (lib/screensaver.js) calls enter(). The page hides
// its text (style.css SAVER) and tours the cities: a seeded shuffle, each
// shot a slow orbit around the city centre at a flattering height and light,
// with the overlays varied but calm. A shot lasts 8 to 15 s (calm: longer).
// The next city loads (worker) and uploads (GPU) during the shot, so the
// cut, a short fade through black, never waits. The camera frames the city
// in the clear band of the label plate (lib/saver-clear.js plateBand).
let saverLabel = null, saverPlateT = 0, saverRate = 1, saverOffsetY = 0;
const tour = { order: [], k: 0, shot: null, next: null, rnd: null, calm: 0, band: null, bandAt: -1e9, bandFn: null, cutting: false };

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One shot: city index, orbit, light and overlays, all from the seeded rng.
function saverShot(i) {
  const r = tour.rnd;
  const c = cities[i];
  const lights = [['golden', 0.36], ['dusk', 0.28], ['day', 0.2], ['night', 0.16]];
  let x = r(), light = 'golden';
  for (const [k, w] of lights) { if ((x -= w) <= 0) { light = k; break; } }
  const has = !!c.current;
  // primary overlay: terrain, currents, wind or none; terrain often rides along
  const pick = r();
  let primary = pick < 0.3 ? 'terrain' : pick < 0.62 && has ? 'ocean' : pick < 0.88 ? 'wind' : 'none';
  if (primary === 'ocean' && !has) primary = 'terrain';
  const calm = tour.calm;
  return {
    i, light, primary,
    terrain: primary === 'terrain' || r() < 0.45,
    exag: primary === 'terrain' ? 1.6 + r() * 1.4 : 1.25 + r() * 0.5,
    ocean: primary === 'ocean',
    wind: primary === 'wind',
    yaw0: r() * Math.PI * 2,
    yawRate: (r() < 0.5 ? -1 : 1) * (0.028 + r() * 0.02) / (1 + calm * 0.6),
    pitch: 0.34 + r() * 0.24,
    distK: 1.7 + r() * 0.9,
    seconds: (8 + r() * 4) * (1 + calm * 0.3),
    heat: r() < 0.2,
  };
}

async function saverStart(shot, first) {
  const c = cities[shot.i];
  const s = await slotFor(shot.i, { full: true });
  // fade to black, then switch
  if (!first) { fadeEl.classList.remove('clear'); await wait(650); }
  meta = s.meta;
  locIndex = shot.i;
  renderer.show(s);
  trimSlots([c.id, tour.next ? cities[tour.next.i].id : '']);
  ov.view.light = shot.light;
  ov.terrain.on = shot.terrain; ov.terrain.exag = shot.exag;
  ov.ocean.on = shot.ocean && !!meta.current;
  ov.wind.on = shot.wind; ov.wind.heat = shot.heat; ov.wind.live = false;
  ov.wind.slice = 12;
  const p = meta.wind?.prevail;
  if (p) { ov.wind.dirFrom = p.dir; ov.wind.speed = clamp(Math.round(p.speed * 2) / 2, 3, 8); }
  pushWind();
  // overlays start at their target, no fade-in from zero
  for (const k of ['terrain', 'ocean', 'wind']) ov[k].amt = ov[k].on ? 1 : 0;
  sunAz = ((meta._bearing ?? 200) + 55) % 360;
  const R = meta.r * 1000;
  cam.target = [0, 0, meta.groundRef || 0];
  cam.yaw = shot.yaw0; cam.pitch = shot.pitch; cam.dist = R * shot.distK;
  hour = tour.rnd() * lastHour();
  buildOverlay();
  shot.t0 = performance.now();
  tour.shot = shot;
  saverPlateT = 0;
  saverPlate();
  requestAnimationFrame(() => fadeEl.classList.add('clear'));
  // pick and preload the next city
  tour.k = (tour.k + 1) % tour.order.length;
  if (tour.k === 0) tour.order = shuffle(tour.order.slice(), tour.rnd);
  tour.next = saverShot(tour.order[tour.k]);
  setTimeout(() => slotFor(tour.next.i, { full: true }).catch(() => {}), 1500);
}

function shuffle(a, r) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function saverTick(dt, t) {
  const sh = tour.shot;
  if (!sh) return;
  cam.yaw += sh.yawRate * dt;
  // frame the city in the clear band of the plate: shift the image so the
  // target sits at the middle of the band, and zoom to its height
  if (tour.bandFn && t - tour.bandAt > 700) { tour.bandAt = t; tour.band = tour.bandFn(window.innerHeight); }
  const h = window.innerHeight;
  if (tour.band && h > 0) {
    const mid = (tour.band.t + (h - tour.band.b)) / 2;
    saverOffsetY = ease(saverOffsetY, 1 - (2 * mid) / h, dt, 0.8);
    const k = clamp((h - tour.band.t - tour.band.b) / (h * 0.62), 0.8, 1.2);
    cam.dist = ease(cam.dist, meta.r * 1000 * sh.distK / k, dt, 1.2);
  } else saverOffsetY = ease(saverOffsetY, 0, dt, 0.8);
  if (!tour.cutting && (t - sh.t0) / 1000 > sh.seconds && tour.next) {
    tour.cutting = true;
    const nx = tour.next;
    slotFor(nx.i, { full: true }).then(() => saverStart(nx, false)).catch(() => {}).finally(() => { tour.cutting = false; });
  }
}

// The plate: title, the city, the overlay numbers, and a real extract of
// the shader that draws the primary overlay.
const codeCache = new Map();
async function shaderText(name) {
  if (!codeCache.has(name)) codeCache.set(name, fetch(new URL(`shaders/${name}`, import.meta.url)).then((r) => r.text()).catch(() => ''));
  return codeCache.get(name);
}
function extract(src, from, lines) {
  const a = src.split('\n');
  const i = a.findIndex((l) => l.includes(from));
  return i < 0 ? '' : a.slice(i, i + lines).join('\n');
}
const CODE = {
  wind: ['lbm.wgsl', 'let Q = pxx * pxx', 12, 'Smagorinsky BGK collision'],
  ocean: ['tracers.wgsl', 'fn stepOf(u: vec2f)', 10, 'current streak step'],
  terrain: ['terrain.wgsl', '  let w = waterAt(p);', 12, 'water over the sea floor'],
  none: ['buildings.wgsl', '  // windows: a faint grid', 12, 'lit windows after dusk'],
};
let saverCode = null;
function saverPlate() {
  if (!saverLabel || !meta || !tour.shot) return;
  const sh = tour.shot, b = meta.buildings;
  const params = [
    { sym: 'N', name: 'buildings', value: fmt(b.count) },
    { sym: 'h_{\\max}', name: 'tallest', value: `${fmt(b.tallest)} m` },
  ];
  if (ov.terrain.on) params.push({ sym: 'E', name: 'relief', value: `× ${fmt(ov.terrain.exag, 1)}` });
  if (ov.ocean.on && meta.current) params.push({ sym: 'u_{\\max}', name: 'fastest water', value: `${fmt(meta.curMax * KNOTS, 1)} kn`, cls: 'm1' });
  if (ov.wind.on) params.push({ sym: 'U', name: 'wind', value: `${fmt(ov.wind.speed, 1)} m/s from ${compass(ov.wind.dirFrom)}`, cls: 'm1' });
  const lines = [`${meta.country}. ${fmt(Math.abs(meta.lat), 2)}° ${meta.lat >= 0 ? 'N' : 'S'}, ${fmt(Math.abs(meta.lon), 2)}° ${meta.lon >= 0 ? 'E' : 'W'}.`];
  if (ov.ocean.on && meta.current) lines.push(`Surface currents, ${stamp(hour)}. ${currentSource(meta).short}.`);
  if (ov.wind.on) lines.push('Wind: a simplified 2D lattice Boltzmann simulation around the buildings.');
  const tex = sh.primary === 'wind'
    ? [String.raw`f_q(\mathbf{x}+\mathbf{c}_q,t+1)=f_q-\frac{1}{\tau}\big(f_q-f_q^{\mathrm{eq}}(\rho,\mathbf{u})\big)`]
    : sh.primary === 'ocean' ? [String.raw`\mathbf{x}_{n+1}=\mathbf{x}_n+\Delta t\,\hat{\mathbf{u}}\big(\mathbf{x}_n+\tfrac{\Delta t}{2}\hat{\mathbf{u}}(\mathbf{x}_n)\big)`]
      : sh.primary === 'terrain' ? [String.raw`z=E\,h(x,y),\qquad h<0:\ \text{sea floor}`] : [];
  const k = CODE[sh.primary] || CODE.none;
  try {
    saverLabel({
      title: meta.title,
      sub: `${meta.region} · ${sh.primary === 'none' ? 'buildings' : sh.primary === 'ocean' ? 'ocean currents' : sh.primary}`,
      params, lines, tex, rules: [['\\mathbf{u}', 'm1'], ['\\hat{\\mathbf{u}}', 'm1']],
      code: saverCode && saverCode.key === sh.primary ? saverCode.code : undefined,
    });
  } catch { /* the plate is optional */ }
  if (!saverCode || saverCode.key !== sh.primary) {
    shaderText(k[0]).then((src) => {
      const text = extract(src, k[1], k[2]);
      if (text) { saverCode = { key: sh.primary, code: { lang: 'wgsl', name: `${k[0]} · ${k[3]}`, text } }; saverPlateT = 0; }
    });
  }
}

window.snSaver = {
  async enter(opts) {
    const calm = clamp(+opts.calm || 0, 0, 1);
    await started;
    saver = true;
    saverLabel = opts.labels === false || typeof opts.label !== 'function' ? null : opts.label;
    tour.calm = calm;
    tour.rnd = mulberry32((opts.seed >>> 0) || 1);
    tour.order = shuffle(cities.map((_, i) => i), tour.rnd);
    tour.k = 0;
    saverRate = 0.5 / (1 + calm);
    import('../../lib/saver-clear.js').then((m) => { tour.bandFn = m.plateBand; }).catch(() => { /* no band */ });
    document.body.classList.add('saver', 'idle');
    setCaption(false); setAtlas(false); setLayers(false);
    setPlaying(true);
    if (renderer) {
      ++switchToken;
      await saverStart(saverShot(tour.order[0]), true);
    }
    return { canvas, warmupMs: 1800 };
  },
  exit() {
    saver = false;
    saverLabel = null;
    saverOffsetY = 0;
    document.body.classList.remove('saver');
  },
};

// Debug handle for the console and the headless checks.
let framesDrawn = 0;
const loadLog = { cur: null, list: [] };
const bootLog = {};
const frameCpu = [], rafGaps = [];
const med = (a) => { const s = a.filter((x) => x > 0).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
window.__cityAtlas = {
  get ready() { return !!meta && document.body.classList.contains('shown') && fadeEl.classList.contains('clear'); },
  get frames() { return framesDrawn; },
  get city() { return meta?.id; },
  get loads() { return loadLog.list; },
  get boot() { return { ...bootLog, r: renderer?.info.boot }; },
  get perf() { return { cpuMs: med(frameCpu), rafMs: med(rafGaps), gpuMs: med(renderer?.info.gpuHist || []), gpuMax: Math.max(0, ...(renderer?.info.gpuHist || [])), q: qLevel, pass: renderer?.info.pass, idleFrames, drawn: framesDrawn, shadowDraws: renderer?.info.shadowDraws, msaa: renderer?.info.sampleCount, tris: renderer?.info.tris, renderScale, w: canvas.width, h: canvas.height }; },
  get state() { return { ov: JSON.parse(JSON.stringify(ov)), cam: { ...cam }, hour, renderScale, gpuMs: renderer?.info.gpuMs, tris: renderer?.info.tris }; },
  overlay: (k, v) => setOverlay(k, v),
  go: (id) => { const i = cities.findIndex((c) => c.id === id); if (i >= 0) return switchTo(i); return null; },
  set: (patch) => { for (const [k, v] of Object.entries(patch)) Object.assign(ov[k], v); syncLayers(); fillParams(); pushWind(); },
  view: (v) => { Object.assign(cam, v); lastInput = performance.now(); invalidate(3); },
  layers: (o) => setLayers(o),
  about: (o) => setCaption(o),
  atlas: (o) => setAtlas(o),
};

const started = start();
