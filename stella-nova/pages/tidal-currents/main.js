// main.js — Tidal Currents page: full-screen map, plate text, clock, atlas.
//
// engine.js draws the map into #map with WebGPU. The map fills the whole
// window at every aspect: view.js picks the part of the extent raster that
// the screen shows. This file does everything else. It fills the head and
// the foot in the look of the shell screensaver plate, places the place
// labels clear of both, runs the clock, and switches the location with a
// short fade through black. quality.js lowers the particle share and the
// render scale when the frames do not keep up with the display.
//
//   Left / Right   previous / next location     Space   play / pause
//   M              atlas (location menu)        I       about sheet
//   Esc            close the open sheet
//   Swipe left or right to change the location. Drag the week bar to set the time.
//   #<id> in the URL picks a location.
//
// grep: function relayout  function buildOverlay  function placeLabels
//       function pageMark  function switchTo  function frame
//       function buildAtlas  const CAPTIONS  function captionHTML
//       window.snSaver (shell screensaver hook)  function saverPlate (its label plate)

import { computeView, lonLatToScreen, metersPerScreenPx, viewCornersLonLat, coreOf } from './view.js';
import { createLocator } from './locator.js';
import { createGovernor, LEVELS } from './quality.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const canvas = $('map');
const overlay = $('overlay');
const fadeEl = $('fade');
const loadingEl = $('loading');
const fallbackEl = $('fallback');
const captionEl = $('caption');
const atlasEl = $('atlas');
const scrim = $('scrim');
const strip = $('controls');
const headEl = $('head');
const footEl = $('foot');
const scrubEl = $('scrub');

const WEEK_SECONDS = 70;            // one week of model time in about 70 s
const IDLE_MS = 2500;
const STORE_KEY = 'tidal-currents.location';
// The location of a fresh visit. A #hash in the URL wins, then the last
// location of this tab session (sessionStorage).
const DEFAULT_ID = 'sf-bay';

// Used when data/index.json is not there yet.
const DEFAULT_LOCS = [
  { id: 'puget-sound', title: 'Puget Sound' },
  { id: 'sf-bay', title: 'San Francisco Bay' },
  { id: 'san-juan-islands', title: 'San Juan Islands' },
  { id: 'cook-inlet', title: 'Cook Inlet' },
  { id: 'straits-of-mackinac', title: 'Straits of Mackinac' },
];

// Hand-written captions, used when meta.blurb is not there.
const CAPTIONS = {
  'puget-sound': 'Puget Sound fills and drains through a few narrow passages. Twice a day, the whole of the South Sound pushes in and out through the Tacoma Narrows, a channel only about a mile wide, and the current there is among the fastest in the Sound.',
  'sf-bay': 'The tide turns under the Golden Gate Bridge about four times a day. The strait is the bay’s only opening to the Pacific, so every flood and every ebb for the whole bay squeezes through it.',
  'san-juan-islands': 'Twice a day, the tide carries Pacific water in through the Strait of Juan de Fuca and back out again. Among the islands it funnels into Haro Strait and Rosario Strait, the two main channels between the Strait of Juan de Fuca and the Strait of Georgia.',
  'cook-inlet': 'Cook Inlet has one of the largest tidal ranges in North America. Near Anchorage, the largest tides rise and fall by more than 30 feet, and on the flood a tidal bore can run up Turnagain Arm.',
  'straits-of-mackinac': 'Lake Michigan and Lake Huron are one lake, joined here at the Straits of Mackinac. The current through the straits often reverses, but not with the tide: wind piles water against one shore, and the lake sloshes back in a slow seiche.',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ICON_PAUSE = '<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="2.5" y="1.5" width="3" height="11" rx="0.6"/><rect x="8.5" y="1.5" width="3" height="11" rx="0.6"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 1.6v10.8a.5.5 0 0 0 .76.43l8.6-5.4a.5.5 0 0 0 0-.86l-8.6-5.4a.5.5 0 0 0-.76.43z"/></svg>';

// ─── state ──────────────────────────────────────────────────────────────────
let locs = DEFAULT_LOCS;
let locIndex = 0;
let meta = null;              // meta.json of the current location
let dataset = null;
let engine = null;
let engineMod = null;
let rampCSS = null;
let hour = 0;
let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let scrubbing = false;
let lastT = null;
let shownHour = -1;
let switchToken = 0;
let ui = {};                  // live overlay elements
let view = { x0: 0, y0: 0, x1: 1, y1: 1 };
let scr = { w: 1, h: 1 };
let locator = null;           // the globe in the about sheet
const metaCache = new Map();  // id -> meta (for the atlas)
let saver = false;            // true in the shell screensaver (window.snSaver)
let timeScale = 1;            // model-time rate; the screensaver slows it
let renderScale = 1;          // backing store scale that the quality governor sets

// Quality governor: fewer particles, then a smaller backing store, when the
// frames do not keep up with the display (quality.js).
const governor = createGovernor((level) => {
  const q = LEVELS[level];
  engine?.setParticleShare?.(q.share);
  document.body.dataset.quality = String(level);
  if (q.res !== renderScale) { renderScale = q.res; relayout(); }
});
window.__tidalQuality = governor;   // debug handle: level and stats from the console

// ─── helpers ────────────────────────────────────────────────────────────────
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const lastHour = () => Math.max(1, (meta?.hours ?? 169) - 1);
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s.-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// The last location lasts for the tab session only, so a new visit opens on
// DEFAULT_ID. Old visits kept it in localStorage, and that key is removed.
function storeGet() { try { return sessionStorage.getItem(STORE_KEY); } catch { return null; } }
function storeSet(v) { try { sessionStorage.setItem(STORE_KEY, v); } catch { /* private mode */ } }
try { localStorage.removeItem(STORE_KEY); } catch { /* private mode */ }

function localDate(h) {
  const m = /^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/.exec(meta?.startLocal ?? '2026-09-21T00:00');
  const t0 = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return new Date(t0 + Math.floor(h) * 3600e3);
}
function stamp(h) {
  const d = localDate(h);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${hh}:00 ${meta?.tzLabel ?? ''}`.trim();
}
const modelShort = (m) => (m?.modelShort || m?.model || '').toUpperCase();
const agencyOf = (m) => m?.agency || 'NOAA';   // NOAA, or the Marine Institute for Dublin

// SOURCES. Who made each dataset and under what terms. The corner credit and
// the About panel both read this, so the two cannot disagree.
//   NOAA OFS models and gauges: U.S. Government work, public domain.
//   Marine Institute NEATL: CC BY 4.0 (dataset license attribute on
//   erddap.marine.ie, IMI_NEATL), which requires attribution and a note of
//   changes. Natural Earth: public domain.
const LINK = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${esc(text)}</a>`;
function sourceOf(m) {
  if (agencyOf(m) === 'Marine Institute') {
    return {
      short: '© Irish Marine Institute · CC BY 4.0',
      html: `Currents and temperature: ${esc(m.modelLong || 'Marine Institute Northeast Atlantic Model')} (NEATL), `
        + `© Irish Marine Institute, from the ${LINK('https://erddap.marine.ie/erddap/griddap/IMI_NEATL.html', 'Marine Institute ERDDAP')}, `
        + `licensed ${LINK('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0')}. `
        + 'Changes: hourly surface currents and temperature resampled to an image grid for this map.',
    };
  }
  return {
    short: 'NOAA NOS CO-OPS · public domain',
    html: `Currents and temperature: ${esc(m.modelLong || `NOAA ${modelShort(m)}`)}, `
      + `${LINK('https://tidesandcurrents.noaa.gov/models.html', 'NOAA National Ocean Service, CO-OPS')}. `
      + 'U.S. Government work, public domain. Hourly nowcast surface currents resampled to an image grid for this map.',
  };
}
function creditsHTML(m) {
  const items = [`<li>${sourceOf(m).html}</li>`];
  if (m.id === 'new-york-harbor') {
    items.push(`<li>Water temperature: ${LINK('https://tidesandcurrents.noaa.gov/stationhome.html?id=8518750', 'NOAA CO-OPS station 8518750, The Battery, NY')} (the NYOFS model carries no temperature). Public domain.</li>`);
  }
  items.push(`<li>Land and lakes on the map and the locator globe: ${LINK('https://www.naturalearthdata.com/', 'Natural Earth')} 1:50m, simplified. Public domain.</li>`);
  items.push('<li>Visualization, particle engine and design: Dave, for Stella Nova.</li>');
  return `<section id="capCredits" class="credits"><h3>Credits</h3><ul>${items.join('')}</ul></section>`;
}

// A phone is a coarse pointer with a short side under 600 CSS px.
const coarse = matchMedia('(pointer: coarse)');
function device() {
  const short = Math.min(window.innerWidth, window.innerHeight);
  const phone = coarse.matches && short < 600;
  return { phone, tablet: coarse.matches && !phone };
}

// ─── overlay content ────────────────────────────────────────────────────────
function legendRamp() {
  return rampCSS || 'linear-gradient(90deg, #3b2a8f, #3f5fd6, #2fb3e0, #3fd49a, #d8e04a, #f39a3a, #e0453a)';
}

// PAGE MARK. The number and the section of this page, counted as the saver
// plate counts them (lib/screensaver.js allPages): every page of
// lib/nav-data.js in order, less home and the pages the saver catalog
// excludes. The section colour goes to --c.
function pageMark() {
  const cat = window.SN_SAVER_CATALOG?.pages ?? {};
  let n = 0, hit = null;
  for (const r of window.SN_NAV ?? []) for (const c of r.constellations) for (const g of c.groups) for (const p of g.p) {
    if (p[0] === 'home' || cat[p[0]]?.tier === 'excluded') continue;
    n++;
    if (p[0] === 'tidal-currents') hit = { n, con: c.label, color: c.color };
  }
  if (!hit) return { text: 'Tidal currents', color: null };
  return { text: `No. ${String(hit.n).padStart(3, '0')} · ${hit.con}`, color: hit.color };
}

// A parameter in the plate style: an italic value over a small spaced label.
const param = (v, label, extra = '') => `<div class="p"><span class="v">${v}</span>${extra}<small>${esc(label)}</small></div>`;

function buildOverlay() {
  overlay.textContent = '';
  $('ttl').textContent = meta.title;
  $('sub').textContent = `${meta.modelLong || `${agencyOf(meta)} ${modelShort(meta)}`} (${modelShort(meta)})`;

  // Week bar: one tick per day.
  scrubEl.querySelectorAll('.tick').forEach((t) => t.remove());
  scrubEl.setAttribute('aria-valuemax', String(lastHour()));
  const days = Math.round(lastHour() / 24);
  for (let i = 1; i < days; i++) {
    const tick = el('i', 'tick');
    tick.style.left = (i / days * 100) + '%';
    scrubEl.prepend(tick);
  }

  // Parameters: time, water temperature (with the ramp), fastest water, scale.
  const lf = meta.legendF ?? { min: 51, max: 61 };
  const pk = meta.peak?.knots > 0 ? meta.peak : null;
  $('params').innerHTML =
    param('<i class="sym">t</i> = <span id="pTime"></span>', 'model time') +
    param(`<i class="sym">T</i> = ${lf.min}–${lf.max} °F`, 'water temperature', `<i class="ramp" style="background:${legendRamp()}"></i>`) +
    (pk ? param(`<i class="sym m1">u</i><sub>max</sub> = ${pk.knots.toFixed(1)} kn`, 'fastest this week') : '') +
    '<div class="p" id="pScale"></div>';
  const where = [meta.region, titleCase(meta.dates ?? '')].filter(Boolean).join(', ');
  // The short source line keeps the attribution on screen (CC BY 4.0 for NEATL).
  $('notes').innerHTML = `${esc(where)}. Color is water temperature, brightness is speed.<span class="src">${esc(sourceOf(meta).short)}</span>`;

  // place labels
  const labels = [];
  for (const lb of meta.labels ?? []) {
    const size = ['xs', 'sm', 'md', 'lg'].includes(lb.size) ? lb.size : 'sm';
    const n = el('div', `lbl s-${lb.side === 'left' ? 'left' : 'right'} z-${size}`);
    n.append(el('div', 'dot'), el('div', 'txt', esc(lb.name)));
    n.dataset.size = size;
    overlay.appendChild(n);
    labels.push({ node: n, lb });
  }

  ui = { time: $('pTime'), fill: scrubEl.querySelector('.fill'), knob: scrubEl.querySelector('.knob'), scale: $('pScale'), labels };
  shownHour = -1;
  updateClockUI(true);
}

function updateClockUI(force) {
  if (!ui.fill) return;
  const f = clamp(hour / lastHour(), 0, 1);
  ui.fill.style.transform = `scaleX(${f})`;
  ui.knob.style.left = (f * 100) + '%';
  const h = Math.floor(hour);
  if (force || h !== shownHour) {
    shownHour = h;
    ui.time.textContent = stamp(h);
    scrubEl.setAttribute('aria-valuenow', String(h));
    scrubEl.setAttribute('aria-valuetext', stamp(h));
  }
}

function bindScrub(prog) {
  const setFrom = (e) => {
    const r = prog.getBoundingClientRect();
    hour = clamp((e.clientX - r.left) / r.width, 0, 1) * lastHour();
    updateClockUI();
  };
  prog.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    scrubbing = true;
    try { prog.setPointerCapture(e.pointerId); } catch { /* synthetic event */ }
    setFrom(e);
  });
  prog.addEventListener('pointermove', (e) => { if (scrubbing) setFrom(e); });
  const end = () => { scrubbing = false; };
  prog.addEventListener('pointerup', end);
  prog.addEventListener('pointercancel', end);
}

// ─── layout ─────────────────────────────────────────────────────────────────
// Full layout pass: view, canvas size, labels, scale, locator.
function relayout() {
  if (!meta) return;
  const w = window.innerWidth, h = window.innerHeight;
  const { phone, tablet } = device();
  document.body.classList.toggle('phone', phone);
  scr = { w, h };

  view = computeView(meta, w / h);

  // Backing store: device px, capped harder on phones and tablets.
  const dprMax = phone || tablet ? 2 : 4;
  const longMax = phone ? 2400 : tablet ? 3200 : 3840;
  const dpr = Math.min(window.devicePixelRatio || 1, dprMax);
  let bw = Math.max(1, Math.round(w * dpr * renderScale));
  let bh = Math.max(1, Math.round(h * dpr * renderScale));
  const k = Math.min(1, longMax / Math.max(bw, bh));
  bw = Math.max(1, Math.round(bw * k));
  bh = Math.max(1, Math.round(bh * k));
  if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
  if (engine) {
    engine.resize(bw, bh);
    if (typeof engine.setView === 'function') engine.setView(view);
  }

  updateScale();
  placeLabels();
  const corners = viewCornersLonLat(meta, view);
  const b = meta.bbox, c = coreOf(meta);
  const clon = b.lon0 + (c.x0 + c.x1) / 2 * (b.lon1 - b.lon0);
  const clat = b.lat1 - (c.y0 + c.y1) / 2 * (b.lat1 - b.lat0);
  locator?.setTarget(clon, clat, corners, !relayout.turned);
  relayout.turned = true;
}

const hits = (a, b, pad = 0) => a.x0 - pad < b.x1 && a.x1 + pad > b.x0 && a.y0 - pad < b.y1 && a.y1 + pad > b.y0;
// The box of the visible content of the head or the foot, not of its padding.
function contentBox(node) {
  let box = null;
  for (const c of node.children) {
    if (c.offsetParent === null) continue;
    const r = c.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    box = box
      ? { x0: Math.min(box.x0, r.left), y0: Math.min(box.y0, r.top), x1: Math.max(box.x1, r.right), y1: Math.max(box.y1, r.bottom) }
      : { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
  }
  return box;
}

// Put each label at its lon/lat. Hide it when it is off screen, when it
// collides with a larger label, or when it is under the head or the foot.
function placeLabels() {
  const rank = { lg: 0, md: 1, sm: 2, xs: 3 };
  const items = [...ui.labels];
  for (const it of items) {
    const p = lonLatToScreen(meta, view, it.lb.lon, it.lb.lat, scr.w, scr.h);
    it.node.style.left = p.x + 'px';
    it.node.style.top = p.y + 'px';
    it.node.hidden = false;
  }
  items.sort((a, b) => rank[a.node.dataset.size] - rank[b.node.dataset.size]);
  const kept = [contentBox(headEl), contentBox(footEl)].filter(Boolean);
  const small = Math.min(scr.w, scr.h) < 520;
  for (const it of items) {
    if (it.node.dataset.size === 'xs' && small) { it.node.hidden = true; continue; }
    const t = it.node.querySelector('.txt').getBoundingClientRect();
    const d = it.node.querySelector('.dot').getBoundingClientRect();
    const box = { x0: Math.min(t.left, d.left), x1: Math.max(t.right, d.right), y0: Math.min(t.top, d.top), y1: Math.max(t.bottom, d.bottom) };
    const off = box.x0 < 4 || box.y0 < 4 || box.x1 > scr.w - 4 || box.y1 > scr.h - 4;
    if (off || kept.some((k) => hits(box, k, 8))) { it.node.hidden = true; continue; }
    kept.push(box);
  }
}

function niceLength(target) {
  const steps = [0.5, 1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 300, 500];
  let best = steps[0];
  for (const s of steps) if (Math.abs(Math.log(s / target)) < Math.abs(Math.log(best / target))) best = s;
  return best;
}

// The scale parameter: a bracket as long as a round distance on the map.
function updateScale() {
  const mpp = metersPerScreenPx(meta, view, scr.h);
  if (!(mpp > 0)) { ui.scale.hidden = true; return; }
  ui.scale.hidden = false;
  const target = clamp(Math.min(scr.w, scr.h) * 0.1, 56, 110);
  const metric = (meta.agency === 'Marine Institute');
  const unit = metric ? { m: 1000, name: 'km' } : { m: 1609.344, name: 'mi' };
  const len = niceLength((target * mpp) / unit.m);
  const px = (len * unit.m) / mpp;
  const other = metric ? `${niceLength(len / 1.609344)} mi` : `${niceLength(len * 1.609344)} km`;
  ui.scale.innerHTML = `<span class="v">${len} ${unit.name}</span><i class="bar" style="width:${px.toFixed(1)}px"></i><small>scale</small>`;
  ui.scale.setAttribute('aria-label', `Scale: ${len} ${unit.name === 'mi' ? 'miles' : 'kilometers'} (about ${other}). North is up.`);
}

// ─── caption ────────────────────────────────────────────────────────────────
function fmtKnots(k) {
  const r = Math.round(k * 2) / 2;
  const n = Number.isInteger(r) ? String(r) : r.toFixed(1);
  const word = Math.abs(r - k) < 0.05 ? 'about' : r > k ? 'nearly' : 'just over';
  return `${word} ${n} knots`;
}

function captionHTML() {
  const paras = [];
  if (meta.blurb) {
    paras.push(`<p>${esc(meta.blurb)}</p>`);
  } else {
    if (CAPTIONS[meta.id]) paras.push(`<p>${esc(CAPTIONS[meta.id])}</p>`);
    const pk = meta.peak;
    if (pk && pk.knots > 0) {
      const when = pk.hour != null ? stamp(pk.hour) : null;
      paras.push(`<p>At its strongest this week, the fastest surface water on this map ran at ${fmtKnots(pk.knots)}${when ? ` (${esc(when)})` : ''}.</p>`);
    }
  }
  paras.push('<p>Color shows the water temperature at the surface. Brightness shows the speed of the current.</p>');
  const model = meta.modelLong || `${agencyOf(meta)} ${modelShort(meta)}`;
  paras.push(`<p class="data">Data: ${esc(model)} (${esc(modelShort(meta))}, model), ${esc(titleCase(meta.dates ?? ''))}. Hourly surface currents and temperature.</p>`);
  paras.push(creditsHTML(meta));
  return paras.join('');
}

function setCaption(open) {
  if (open) setAtlas(false);
  captionEl.hidden = !open;
  $('info').setAttribute('aria-pressed', String(open));
  if (open && meta) {
    $('capTitle').innerHTML = `${esc(meta.title)}<small>${esc(meta.subtitle || 'A week of currents')}</small>`;
    $('capBody').innerHTML = captionHTML();
  }
  syncScrim();
}

// ─── atlas (location menu) ──────────────────────────────────────────────────
async function metaFor(id) {
  if (metaCache.has(id)) return metaCache.get(id);
  const p = fetch(new URL(`data/${id}/meta.json`, import.meta.url)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  metaCache.set(id, p);
  return p;
}

function thumbFor(l) {
  const img = el('img', 'a-thumb');
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  const tries = [l.thumb && `data/${l.id}/${l.thumb}`, `data/${l.id}/thumb.webp`, `data/${l.id}/thumb.jpg`].filter(Boolean);
  let i = 0;
  const next = () => {
    if (i >= tries.length) { img.replaceWith(el('div', 'a-thumb none')); return; }
    img.src = new URL(tries[i++], import.meta.url).href;
  };
  img.onerror = next;
  next();
  return img;
}

let atlasBuilt = false;
async function buildAtlas() {
  const body = $('atlasBody');
  $('atlasCount').textContent = `${locs.length} places`;
  const infos = await Promise.all(locs.map(async (l) => {
    const needMeta = !l.region || !(l.modelShort || l.model);
    const m = needMeta ? await metaFor(l.id) : null;
    return { ...l, region: l.region || m?.region || 'Other waters', model: modelShort(l.modelShort ? l : (m ?? l)), agency: agencyOf(l.agency ? l : (m ?? l)) };
  }));
  const groups = new Map();
  infos.forEach((l, i) => {
    if (!groups.has(l.region)) groups.set(l.region, []);
    groups.get(l.region).push({ ...l, i });
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
      cap.append(el('span', 'a-title', esc(it.title)), el('span', 'a-model', esc(it.model ? `${it.agency} ${it.model}` : '')));
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
  if (open) setCaption(false);
  atlasEl.hidden = !open;
  $('where').setAttribute('aria-expanded', String(open));
  if (open) {
    if (!atlasBuilt) buildAtlas(); else markAtlas();
    requestAnimationFrame(() => atlasEl.querySelector('.a-item[aria-current="true"]')?.scrollIntoView({ block: 'nearest' }));
  }
  syncScrim();
}

function syncScrim() {
  scrim.hidden = atlasEl.hidden && (captionEl.hidden || !document.body.classList.contains('phone'));
}

// A sheet on a phone: drag the grip down to close it.
function bindSheetDrag(sheet, grip, close) {
  let y0 = null;
  grip.addEventListener('pointerdown', (e) => { y0 = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch { /* */ } });
  grip.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    sheet.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`;
  });
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

// ─── controls ───────────────────────────────────────────────────────────────
function syncControls() {
  $('locName').textContent = locs[locIndex]?.title ?? '';
  $('locCount').textContent = `${locIndex + 1} / ${locs.length}`;
  const p = $('play');
  p.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
  p.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  if (atlasBuilt) markAtlas();
}

function setPlaying(v) { playing = v; syncControls(); }
function step(d) { switchTo((locIndex + d + locs.length) % locs.length); }

let idleTimer = 0;
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (atlasEl.hidden) document.body.classList.add('idle');
  }, IDLE_MS);
}

function bindInput() {
  $('prev').addEventListener('click', () => step(-1));
  $('next').addEventListener('click', () => step(1));
  $('play').addEventListener('click', () => setPlaying(!playing));
  $('info').addEventListener('click', () => setCaption(captionEl.hidden));
  $('where').addEventListener('click', () => setAtlas(atlasEl.hidden));
  bindScrub(scrubEl);
  $('capClose').addEventListener('click', () => setCaption(false));
  $('atlasClose').addEventListener('click', () => setAtlas(false));
  scrim.addEventListener('click', () => { setAtlas(false); setCaption(false); });
  bindSheetDrag(captionEl, $('capGrip'), () => setCaption(false));
  bindSheetDrag(atlasEl, $('atlasGrip'), () => setAtlas(false));

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    wake();
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === ' ' || e.code === 'Space') { if (e.target.closest?.('button')) return; e.preventDefault(); setPlaying(!playing); }
    else if (e.key === 'i' || e.key === 'I') setCaption(captionEl.hidden);
    else if (e.key === 'm' || e.key === 'M') setAtlas(atlasEl.hidden);
    else if (e.key === 'Escape') { setCaption(false); setAtlas(false); }
  });

  // On touch, the idle strip is hidden. The first tap only shows it again.
  let tapWhileIdle = false;
  window.addEventListener('pointerdown', (e) => {
    tapWhileIdle = e.pointerType !== 'mouse' && document.body.classList.contains('idle');
  }, { capture: true, passive: true });
  strip.addEventListener('click', (e) => {
    if (tapWhileIdle) { e.stopPropagation(); e.preventDefault(); tapWhileIdle = false; }
  }, { capture: true });
  for (const ev of ['pointermove', 'pointerdown', 'touchstart', 'wheel']) {
    window.addEventListener(ev, wake, { passive: true });
  }

  // No zoom and no scroll inside the page.
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  }
  document.addEventListener('touchmove', (e) => {
    const inSheet = captionEl.contains(e.target) || atlasEl.contains(e.target);
    if (e.touches.length > 1 || !inSheet) e.preventDefault();
  }, { passive: false });
  let lastTap = 0;
  document.addEventListener('touchend', (e) => {        // no double-tap zoom
    const now = e.timeStamp;
    if (now - lastTap < 320 && !e.target.closest('button')) e.preventDefault();
    lastTap = now;
  }, { passive: false });

  // Swipe left or right on the map to change the location.
  let sw = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') sw = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  });
  stage.addEventListener('pointerup', (e) => {
    if (!sw) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50 && e.timeStamp - sw.t < 600) step(dx < 0 ? 1 : -1);
    sw = null;
  });

  let rz = 0;
  const onResize = () => {
    cancelAnimationFrame(rz);
    rz = requestAnimationFrame(() => { relayout(); syncScrim(); governor.hold(); });
  };
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 250));

  window.addEventListener('hashchange', () => {
    const i = locs.findIndex((l) => l.id === location.hash.slice(1));
    if (i >= 0 && i !== locIndex) switchTo(i);
  });
  document.addEventListener('visibilitychange', () => { lastT = null; });
}

// ─── dataset switch ─────────────────────────────────────────────────────────
async function loadMetaOnly(url) {
  const res = await fetch(new URL('meta.json', url));
  if (!res.ok) throw new Error(`meta.json ${res.status}`);
  return { meta: await res.json(), images: null };
}

async function switchTo(i, initial = false) {
  const token = ++switchToken;
  locIndex = i;
  const loc = locs[i];
  syncControls();
  if (!saver) {
    storeSet(loc.id);
    if (location.hash.slice(1) !== loc.id) history.replaceState(null, '', '#' + loc.id);
  }

  fadeEl.classList.remove('clear');
  const slow = setTimeout(() => { if (token === switchToken) loadingEl.hidden = false; }, initial ? 0 : 380);
  const url = new URL(`data/${loc.id}/`, import.meta.url).href;
  let ds;
  try {
    const [d] = await Promise.all([
      engineMod?.loadDataset ? engineMod.loadDataset(url) : loadMetaOnly(url),
      wait(initial ? 0 : 320),
    ]);
    ds = d;
  } catch (err) {
    clearTimeout(slow);
    if (token !== switchToken) return;
    console.warn('tidal-currents: dataset load failed', loc.id, err);
    loadingEl.hidden = false;
    loadingEl.lastChild.textContent = `${loc.title}: data not available`;
    return;
  }
  clearTimeout(slow);
  if (token !== switchToken) return;

  dataset = ds;
  meta = { id: loc.id, ...ds.meta };
  if (!meta.id) meta.id = loc.id;
  metaCache.set(loc.id, Promise.resolve(ds.meta));
  hour = Math.min(hour, lastHour());
  buildOverlay();
  if (engine) engine.setDataset(ds);
  governor.hold();
  loadingEl.hidden = true;
  loadingEl.lastChild.textContent = 'Loading';
  if (!captionEl.hidden) setCaption(true);
  await document.fonts?.ready;
  if (token !== switchToken) return;
  relayout();
  fillFallback();
  requestAnimationFrame(() => { fadeEl.classList.add('clear'); document.body.classList.add('shown'); });
}

// ─── frame loop ─────────────────────────────────────────────────────────────
function frame(t) {
  requestAnimationFrame(frame);
  const rawMs = lastT == null ? 0 : t - lastT;
  const dt = Math.min(0.1, Math.max(0, rawMs / 1000));
  lastT = t;
  if (!meta || !engine || !dataset) { governor.idle(rawMs); if (!meta) return; }
  const span = lastHour();
  if (playing && !scrubbing) {
    hour += dt * timeScale * (span / WEEK_SECONDS);
    if (hour >= span) hour -= span;
  }
  updateClockUI();
  if (saverLabel && (t - saverPlateT >= 1000 || Math.floor(hour) !== saverPlateH)) { saverPlateT = t; saverPlate(); }
  if (engine && dataset) {
    try {
      engine.render(hour, dt);
      governor.sample(rawMs, engine.info.gpuMs);
    } catch (err) {
      console.error('tidal-currents: render failed', err);
      engine = null;
      showFallback();
    }
  }
}

function showFallback() {
  document.body.classList.add('no-gpu');
  fallbackEl.hidden = false;
  fillFallback();
}

// The head names the location, so the fallback says only why the map is missing.
function fillFallback() {
  if (fallbackEl.hidden) return;
  fallbackEl.innerHTML = '<p>This browser does not offer WebGPU, so the map cannot draw here. Try a recent Chrome, Edge or Safari.</p>';
}

// ─── start ──────────────────────────────────────────────────────────────────
async function start() {
  const mark = pageMark();
  $('cat').textContent = mark.text;
  if (mark.color) document.documentElement.style.setProperty('--c', mark.color);
  locator = createLocator($('globe'), new URL('data/world.json', import.meta.url).href);
  locator.resize(132);
  bindInput();
  wake();

  try {
    const res = await fetch(new URL('data/index.json', import.meta.url));
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list) && list.length) locs = list;
    }
  } catch { /* keep DEFAULT_LOCS */ }

  const want = location.hash.slice(1) || storeGet() || DEFAULT_ID;
  const at = (id) => locs.findIndex((l) => l.id === id);
  locIndex = at(want) >= 0 ? at(want) : Math.max(0, at(DEFAULT_ID));
  syncControls();

  try {
    const cm = await import('./colormap.js');
    if (typeof cm.rampCSS === 'function') rampCSS = cm.rampCSS();
    else if (Array.isArray(cm.RAMP)) {
      const n = cm.RAMP.length - 1;
      rampCSS = 'linear-gradient(90deg, ' + cm.RAMP.map((c, i) =>
        `rgb(${c.map((v) => Math.round(v * 255)).join(',')}) ${(i / n * 100).toFixed(1)}%`).join(', ') + ')';
    }
  } catch (err) {
    console.warn('tidal-currents: colormap.js not loaded', err);
  }

  try {
    engineMod = await import('./engine.js');
    engine = await engineMod.createEngine(canvas, { mobile: device().phone });
  } catch (err) {
    console.warn('tidal-currents: WebGPU engine unavailable', err?.message ?? err);
    engine = null;
    showFallback();
  }

  await switchTo(locIndex, true);
  requestAnimationFrame(frame);
}

// ─── screensaver ────────────────────────────────────────────────────────────
// The shell screensaver (lib/screensaver.js) calls enter(). It hides the
// head, the foot, the labels and the sheets (style.css SAVER), and plays.
// The shell plate is then the only text over the map.
// opts.seed picks the location. The switch fades through black, as a normal
// switch does. calm 1 halves the model-time rate. In saver mode, switchTo()
// does not write the URL hash or the session store.
//
// The label plate (opts.label) names the location, the ocean model and the
// local model time, all from meta.json. The equations are the ones that
// engine.js and the shaders compute: field.wgsl rebuilds the current from the
// mean and the EOF modes, coefRows() interpolates the mode amplitudes over
// hours, and advect.wgsl moves each tracer along the current by RK2. frame()
// calls saverPlate() every 1 s, so the clock on the plate stays live.
let saverLabel = null, saverPlateT = 0, saverPlateH = -1;
function saverPlate() {
  if (!saverLabel || !meta) return;
  saverPlateH = Math.floor(hour);
  const v = meta.variance?.vel, modes = meta.velModes || 12;
  const rate = timeScale * lastHour() / WEEK_SECONDS;
  // Parameters: TeX symbol, short name, live value. The page has no
  // equation colours, so the plate takes the velocity colour of the fluid
  // pages (u m1). The map fills the window, so the plate has no anchor.
  const params = [
    { sym: 't', name: 'model time', value: `${stamp(hour)}, h ${Math.floor(hour)}/${lastHour()}` },
    { sym: 'K', name: 'EOF modes', value: String(modes) + (v ? `, ${(v * 100).toFixed(1)} %` : '') },
  ];
  if (meta.peak?.knots) params.push({ sym: 'u_{\\max}', name: 'fastest', value: `${meta.peak.knots.toFixed(1)} kn, h ${meta.peak.hour}`, cls: 'm1' });
  if (meta.tempC) params.push({ sym: 'T', name: 'water', value: `${meta.tempC.min.toFixed(1)}–${meta.tempC.max.toFixed(1)} °C` });
  const lines = [`${meta.region ? meta.region + ', ' : ''}${titleCase(meta.dates || '')}`.replace(/, $/, '') + '.',
    `Colour is water temperature. ${rate.toFixed(1)} model hours per second` + (meta.metersPerPixel ? `, ${Math.round(meta.metersPerPixel)} m per cell.` : '.')];
  try {
    saverLabel({
      title: meta.title,
      sub: `${meta.modelLong || modelShort(meta)} (${modelShort(meta)})`,
      params,
      lines,
      tex: [
        String.raw`u(\mathbf{x},t)=\bar{u}(\mathbf{x})+\sum_{k=1}^{K}a_k(t)\,\varphi_k(\mathbf{x})`,
        String.raw`\mathbf{x}_{n+1}=\mathbf{x}_n+\Delta s\;\hat{u}\big(\mathbf{x}_n+\tfrac{\Delta s}{2}\hat{u}(\mathbf{x}_n)\big),\qquad \Delta s\propto\big(|u|/u_{\mathrm{ref}}\big)^{0.6}`,
      ],
      rules: [['u', 'm1'], ['\\bar{u}', 'm1'], ['\\hat{u}', 'm1']],
      eq: [
        `u(x, t) = ū(x) + Σₖ aₖ(t) φₖ(x),  k = 1…${modes}`,
        'aₖ(t): Catmull–Rom between hourly rows',
        'tracer: RK2 along û, step ∝ (|u|/u_ref)^0.6',
      ],
    });
  } catch { /* the shell plate is optional */ }
}
window.snSaver = {
  async enter(opts) {
    const calm = clamp(+opts.calm || 0, 0, 1);
    await started;                  // the location list and the first dataset
    saver = true;
    saverLabel = opts.labels === false || typeof opts.label !== 'function' ? null : opts.label;
    saverPlateT = 0;
    timeScale = 1 / (1 + calm);
    document.body.classList.add('saver', 'idle');
    setCaption(false); setAtlas(false);
    setPlaying(true);
    const i = (opts.seed >>> 0) % locs.length;
    if (i !== locIndex) await switchTo(i);
    saverPlate();
    return { canvas, warmupMs: 1500 };
  },
};

const started = start();
