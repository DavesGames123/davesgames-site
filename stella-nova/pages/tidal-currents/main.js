// main.js — Tidal Currents page: full-screen map, floating text, clock, atlas.
//
// engine.js draws the map into #map with WebGPU. The map fills the whole
// window at every aspect: view.js picks the part of the extent raster that
// the screen shows. This file does everything else. It floats the title,
// legend, credit and locator blocks over the quietest parts of the
// view, places the place labels, runs the clock, and switches the location
// with a short fade through black. quality.js lowers the particle share and
// the render scale when the frames do not keep up with the display.
//
//   Left / Right   previous / next location     Space   play / pause
//   M              atlas (location menu)        I       caption
//   Esc            close the open sheet
//   Swipe left or right to change the location. Drag the 7-day bar to set the time.
//   #<id> in the URL picks a location.
//
// grep: function relayout  function buildCover  function placeLabels
//       function placeBlocks  function bestSpot  function switchTo  function frame
//       function buildAtlas  const CAPTIONS  function captionHTML

import { computeView, lonLatToScreen, metersPerScreenPx, viewCornersLonLat, coreOf } from './view.js';
import { createLocator } from './locator.js';
import { createGovernor, LEVELS } from './quality.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const poster = $('poster');
const canvas = $('map');
const overlay = $('overlay');
const fadeEl = $('fade');
const loadingEl = $('loading');
const fallbackEl = $('fallback');
const captionEl = $('caption');
const atlasEl = $('atlas');
const scrim = $('scrim');
const strip = $('controls');

const WEEK_SECONDS = 70;            // one week of model time in about 70 s
const IDLE_MS = 2500;
const DESIGN_AREA = 720 * 1280;     // the v1 design grid: one portrait poster
const TEXT_SCALE = 0.78;            // v2: the text is about 22 % smaller than v1
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

// Line breaks for a stacked title, when meta.titleLines is not there.
const TITLE_LINES = {
  'puget-sound': ['Puget', 'Sound'],
  'sf-bay': ['San Francisco', 'Bay'],
  'san-juan-islands': ['San Juan', 'Islands'],
  'straits-of-mackinac': ['Straits of', 'Mackinac'],
};

// Hand-written captions, used when meta.blurb is not there.
const CAPTIONS = {
  'puget-sound': 'Puget Sound fills and drains through a few narrow passages. Twice a day, the whole of the South Sound pushes in and out through the Tacoma Narrows, a channel only about a mile wide, and the current there is among the fastest in the Sound.',
  'sf-bay': 'The tide turns under the Golden Gate Bridge about four times a day. The strait is the bay’s only opening to the Pacific, so every flood and every ebb for the whole bay squeezes through it.',
  'san-juan-islands': 'Twice a day, the tide carries Pacific water in through the Strait of Juan de Fuca and back out again. Among the islands it funnels into Haro Strait and Rosario Strait, the two main channels between the Strait of Juan de Fuca and the Strait of Georgia.',
  'cook-inlet': 'Cook Inlet has one of the largest tidal ranges in North America. Near Anchorage, the largest tides rise and fall by more than 30 feet, and on the flood a tidal bore can run up Turnagain Arm.',
  'straits-of-mackinac': 'Lake Michigan and Lake Huron are one lake, joined here at the Straits of Mackinac. The current through the straits often reverses, but not with the tide: wind piles water against one shore, and the lake sloshes back in a slow seiche.',
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
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
let scr = { w: 1, h: 1, u: 1 };
let cover = null;             // coarse water coverage of the view, with a summed-area table
let coverSrc = null;          // the canvas that holds the full mask at low res
let locator = null;
let locatorBlock = null;
const metaCache = new Map();  // id -> meta (for the atlas)
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

// Read env(safe-area-inset-*) through a probe element.
const insetProbe = el('div');
insetProbe.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;' +
  'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
document.body.appendChild(insetProbe);
function safeInsets() {
  const cs = getComputedStyle(insetProbe);
  return { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
}

// ─── overlay content ────────────────────────────────────────────────────────
function legendRamp() {
  return rampCSS || 'linear-gradient(90deg, #3b2a8f, #3f5fd6, #2fb3e0, #3fd49a, #d8e04a, #f39a3a, #e0453a)';
}

function buildOverlay() {
  overlay.textContent = '';

  // title, subtitle, time, 7-day bar
  const t = el('div', 'blk title');
  const tt = el('div', 't-title');
  const sub = el('div', 't-sub', esc(meta.subtitle || 'A Week of Currents'));
  const time = el('div', 't-time mono');
  const prog = el('div', 'prog');
  prog.setAttribute('role', 'slider');
  prog.setAttribute('aria-label', 'Time in the week');
  prog.setAttribute('aria-valuemin', '0');
  prog.setAttribute('aria-valuemax', String(lastHour()));
  const days = Math.round(lastHour() / 24);
  for (let i = 1; i < days; i++) {
    const tick = el('div', 'tick');
    tick.style.left = (i / days * 100) + '%';
    prog.appendChild(tick);
  }
  const fill = el('div', 'fill');
  const knob = el('div', 'knob');
  prog.append(fill, knob);
  t.append(tt, sub, time, prog);
  bindScrub(prog);

  // legend and scale bar
  const g = el('div', 'blk legend');
  g.appendChild(el('div', 'l-head mono', 'Water temperature'));
  const bar = el('div', 'l-bar');
  bar.style.background = legendRamp();
  g.appendChild(bar);
  const lf = meta.legendF ?? { min: 51, max: 61 };
  g.appendChild(el('div', 'l-ends mono', `<span>${lf.min}°F</span><span>${lf.max}°F</span>`));
  g.appendChild(el('div', 'l-foot mono', 'Brightness = speed'));
  const scale = el('div', 'scale mono');
  g.appendChild(scale);

  // data credit
  const b = el('div', 'blk credit');
  b.appendChild(el('div', 'c-line mono first', esc(`${agencyOf(meta)} ${modelShort(meta)} model`)));
  b.appendChild(el('div', 'c-line mono', esc(sourceOf(meta).short)));
  b.appendChild(el('div', 'c-line mono', esc(meta.dates ?? '')));
  const more = el('button', 'c-line mono c-more', 'Sources &amp; credits ›');
  more.type = 'button';
  more.addEventListener('click', () => { setCaption(true); $('capCredits')?.scrollIntoView({ block: 'nearest' }); });
  b.appendChild(more);

  // locator globe: one canvas for the page, so it can turn between locations
  if (!locatorBlock) {
    locatorBlock = el('div', 'blk locator');
    const lc = el('canvas');
    lc.setAttribute('role', 'img');
    lc.setAttribute('aria-label', 'Locator globe');
    locatorBlock.appendChild(lc);
    locator = createLocator(lc, new URL('data/world.json', import.meta.url).href);
  }
  const l = locatorBlock;

  overlay.append(t, g, b, l);

  // place labels
  const labels = [];
  for (const lb of meta.labels ?? []) {
    const n = el('div', `lbl s-${lb.side === 'left' ? 'left' : 'right'} z-${['xs', 'sm', 'md', 'lg'].includes(lb.size) ? lb.size : 'sm'}`);
    n.append(el('div', 'dot'), el('div', 'txt', esc(lb.name)));
    n.dataset.size = ['xs', 'sm', 'md', 'lg'].includes(lb.size) ? lb.size : 'sm';
    overlay.appendChild(n);
    labels.push({ node: n, lb });
  }

  ui = { time, prog, fill, knob, tt, scale, labels, blocks: { title: t, legend: g, credit: b, locator: l } };
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
    ui.prog.setAttribute('aria-valuenow', String(h));
    ui.prog.setAttribute('aria-valuetext', stamp(h));
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
// Full layout pass: view, canvas size, coverage, labels, blocks, locator.
function relayout() {
  if (!meta) return;
  const w = window.innerWidth, h = window.innerHeight;
  const { phone, tablet } = device();
  document.body.classList.toggle('phone', phone);
  const u = Math.sqrt((w * h) / DESIGN_AREA) * TEXT_SCALE;
  scr = { w, h, u };
  poster.style.setProperty('--u', u.toFixed(4) + 'px');

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

  // Title: stacked on a narrow screen, one line on a wide one.
  const lines = meta.titleLines ?? TITLE_LINES[meta.id] ?? [meta.title];
  const stacked = w / h < 1.25 || w < 720;
  ui.tt.innerHTML = (stacked ? lines : [lines.join(' ')]).map(esc).join('<br>');

  // Locator size: small on a phone.
  const locPx = Math.round(clamp((phone ? 58 : 120) * Math.max(1, u / 0.9), 52, 150));
  ui.blocks.locator.style.setProperty('--loc', locPx + 'px');
  locator.resize(locPx);

  buildCover();
  const labelBoxes = placeLabels();
  placeBlocks(labelBoxes);
  updateScale();
  const corners = viewCornersLonLat(meta, view);
  const b = meta.bbox, c = coreOf(meta);
  const clon = b.lon0 + (c.x0 + c.x1) / 2 * (b.lon1 - b.lon0);
  const clat = b.lat1 - (c.y0 + c.y1) / 2 * (b.lat1 - b.lat0);
  locator.setTarget(clon, clat, corners, !relayout.turned);
  relayout.turned = true;
}

// Coverage of the view on a coarse grid (0 land .. 1 water), with a summed-area table.
function buildCoverSource(images) {
  coverSrc = null;
  const img = images?.mask ?? images?.base;
  if (!img) return;
  try {
    const cw = Math.min(512, img.width);
    const ch = Math.max(1, Math.round(cw * img.height / img.width));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, cw, ch);
    coverSrc = c;
  } catch { coverSrc = null; }
}

function buildCover() {
  const gw = 96;
  const gh = Math.max(24, Math.round(gw * scr.h / scr.w));
  const data = new Float32Array(gw * gh);
  if (coverSrc) {
    const c = document.createElement('canvas');
    c.width = gw; c.height = gh;
    const cx = c.getContext('2d', { willReadFrequently: true });
    const sw = coverSrc.width, sh = coverSrc.height;
    cx.drawImage(coverSrc, view.x0 * sw, view.y0 * sh, (view.x1 - view.x0) * sw, (view.y1 - view.y0) * sh, 0, 0, gw, gh);
    const px = cx.getImageData(0, 0, gw, gh).data;
    for (let i = 0; i < gw * gh; i++) data[i] = px[i * 4] / 255;
  }
  const sat = new Float64Array((gw + 1) * (gh + 1));
  for (let y = 0; y < gh; y++) {
    let row = 0;
    for (let x = 0; x < gw; x++) {
      row += data[y * gw + x];
      sat[(y + 1) * (gw + 1) + x + 1] = sat[y * (gw + 1) + x + 1] + row;
    }
  }
  cover = { gw, gh, sat };
}

// Mean water coverage in a screen rect.
function waterIn(x, y, w, h) {
  if (!cover) return 0;
  const { gw, gh, sat } = cover;
  const x0 = clamp(Math.floor(x / scr.w * gw), 0, gw), x1 = clamp(Math.ceil((x + w) / scr.w * gw), 0, gw);
  const y0 = clamp(Math.floor(y / scr.h * gh), 0, gh), y1 = clamp(Math.ceil((y + h) / scr.h * gh), 0, gh);
  const n = (x1 - x0) * (y1 - y0);
  if (n <= 0) return 1;
  const W = gw + 1;
  return (sat[y1 * W + x1] - sat[y0 * W + x1] - sat[y1 * W + x0] + sat[y0 * W + x0]) / n;
}

// Put each label at its lon/lat. Hide it when it is off screen or collides.
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
  const kept = [];
  const pad = 4;
  for (const it of items) {
    if (it.node.dataset.size === 'xs' && scr.u < 0.5) { it.node.hidden = true; continue; }
    const t = it.node.querySelector('.txt').getBoundingClientRect();
    const d = it.node.querySelector('.dot').getBoundingClientRect();
    const box = { x0: Math.min(t.left, d.left), x1: Math.max(t.right, d.right), y0: Math.min(t.top, d.top), y1: Math.max(t.bottom, d.bottom) };
    const off = box.x0 < 4 || box.y0 < 4 || box.x1 > scr.w - 4 || box.y1 > scr.h - 4;
    const hit = kept.some((k) => box.x0 - pad < k.x1 && box.x1 + pad > k.x0 && box.y0 - pad < k.y1 && box.y1 + pad > k.y0);
    if (off || hit) { it.node.hidden = true; continue; }
    box.node = it.node;
    kept.push(box);
  }
  return kept;
}

const overlapArea = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

// Search the screen for the quietest spot for a block of w x h px.
function bestSpot(w, h, opts) {
  const { avoid, labels, pref, corners } = opts;
  const ins = safeInsets();
  const m = Math.max(14, 26 * scr.u);
  const L = ins.l + m, T = ins.t + m, R = scr.w - ins.r - m - w, B = scr.h - ins.b - m - h;
  if (R < L || B < T) return null;
  const cands = [];
  if (corners) {
    cands.push([L, T], [R, T], [L, B], [R, B]);
  } else {
    const step = Math.max(6, Math.min(scr.w, scr.h) / 60);
    for (let y = T; y <= B + 0.5; y += step) for (let x = L; x <= R + 0.5; x += step) cands.push([x, y]);
    cands.push([L, T], [R, T], [L, B], [R, B], [R, (T + B) / 2], [L, (T + B) / 2]);
  }
  let best = null;
  for (const [x, y] of cands) {
    const r = { x0: x, y0: y, x1: x + w, y1: y + h };
    if (avoid.some((a) => overlapArea(r, a) > 0)) continue;
    let cost = waterIn(x, y, w, h);
    let lab = 0;
    for (const k of labels) lab += overlapArea(r, { x0: k.x0 - 6, y0: k.y0 - 6, x1: k.x1 + 6, y1: k.y1 + 6 });
    cost += 3 * lab / (w * h);
    cost += pref(x, y, w, h);
    if (!best || cost < best.cost) best = { x, y, cost };
  }
  if (!best) return null;
  // Snap to the margin when the spot is near it, so blocks share an edge.
  const snap = Math.max(24, scr.w * 0.03);
  for (const sx of [L, R]) {
    if (Math.abs(best.x - sx) < snap) {
      const r = { x0: sx, y0: best.y, x1: sx + w, y1: best.y + h };
      if (!avoid.some((a) => overlapArea(r, a) > 0)) best.x = sx;
    }
  }
  return best;
}

function placeBlocks(labelBoxes) {
  const k = ui.blocks;
  const { phone } = device();
  const sr = strip.getBoundingClientRect();
  const avoid = [{ x0: sr.left - 10, y0: sr.top - 10, x1: sr.right + 10, y1: sr.bottom + 10 }];
  const W = scr.w, H = scr.h, diag = Math.hypot(W, H);
  const placed = {};

  const put = (name, node, opts) => {
    node.hidden = false;
    node.classList.remove('a-right');
    // measure after alignment is known: a trial at the left first
    let w = node.offsetWidth, h = node.offsetHeight;
    let spot = bestSpot(w, h, { avoid, labels: labelBoxes, ...opts });
    if (!spot) { node.hidden = true; return null; }
    const right = spot.x + w / 2 > W / 2;
    node.classList.toggle('a-right', right);
    w = node.offsetWidth; h = node.offsetHeight;
    node.style.left = Math.round(spot.x) + 'px';
    node.style.top = Math.round(spot.y) + 'px';
    const r = { x0: spot.x, y0: spot.y, x1: spot.x + w, y1: spot.y + h, cost: spot.cost };
    avoid.push({ x0: r.x0 - 12, y0: r.y0 - 12, x1: r.x1 + 12, y1: r.y1 + 12 });
    placed[name] = r;
    node.classList.toggle('busy', spot.cost > 0.45);   // over bright water: a darker halo
    return r;
  };

  const edge = (x, w) => 1 - Math.abs((x + w / 2) / W - 0.5) * 2;       // 0 at an edge, 1 at the center
  put('title', k.title, { pref: (x, y, w, h) => 0.35 * (y / H) + 0.12 * edge(x, w) });
  const tr = placed.title;
  put('locator', k.locator, {
    corners: true,
    pref: (x, y) => (phone ? 0.2 * (y / H) : 0) + (tr ? 0.05 * (Math.hypot(x - tr.x0, y - tr.y0) < W / 3 ? 0 : 1) : 0),
  });
  put('legend', k.legend, {
    pref: (x, y, w, h) => (tr ? 0.3 * Math.hypot(x + w / 2 - (tr.x0 + tr.x1) / 2, y - tr.y1) / diag : 0) + 0.08 * edge(x, w),
  });
  put('credit', k.credit, { pref: (x, y, w, h) => 0.3 * (1 - (y + h) / H) + 0.1 * edge(x, w) });

  // A locator on a busy spot is noise: hide it on a phone.
  if (phone && placed.locator && placed.locator.cost > 0.55) k.locator.hidden = true;

  // Labels that a block still covers go.
  const blocks = Object.values(placed);
  for (const lb of labelBoxes) {
    if (blocks.some((b) => overlapArea(lb, b) > 0)) lb.node.hidden = true;
  }
}

function niceLength(target) {
  const steps = [0.5, 1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 300, 500];
  let best = steps[0];
  for (const s of steps) if (Math.abs(Math.log(s / target)) < Math.abs(Math.log(best / target))) best = s;
  return best;
}

function updateScale() {
  const mpp = metersPerScreenPx(meta, view, scr.h);
  if (!(mpp > 0)) { ui.scale.textContent = ''; return; }
  const target = Math.max(60, 90 * scr.u);
  const km = niceLength((target * mpp) / 1000);
  const mi = niceLength((target * mpp) / 1609.344);
  const kmLen = (km * 1000) / mpp, miLen = (mi * 1609.344) / mpp;
  ui.scale.innerHTML =
    `<div class="row"><i style="width:${kmLen.toFixed(1)}px"></i><span>${km} km</span></div>` +
    `<div class="row mi"><i style="width:${miLen.toFixed(1)}px"></i><span>${mi} mi</span></div>`;
  ui.scale.setAttribute('aria-label', `Scale: ${km} kilometers, ${mi} miles. North is up.`);
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
      const when = pk.hour != null ? stamp(pk.hour).replace(/^(\d+) ([A-Z]+)/, (m, d, mo) => `${d} ${mo[0]}${mo.slice(1).toLowerCase()}`) : null;
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
    $('capTitle').innerHTML = `${esc(meta.title)}<small>${esc(meta.subtitle || 'A Week of Currents')}</small>`;
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
    sec.appendChild(el('h3', 'mono', esc(region)));
    const grid = el('div', 'a-grid');
    for (const it of items) {
      const b = el('button', 'a-item');
      b.type = 'button';
      b.dataset.index = String(it.i);
      b.appendChild(thumbFor(it));
      const cap = el('span', 'a-cap');
      cap.append(el('span', 'a-title', esc(it.title)), el('span', 'a-model mono', esc(it.model ? `${it.agency} ${it.model}` : '')));
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
  $('atlasBtn').setAttribute('aria-pressed', String(open));
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
  $('atlasBtn').addEventListener('click', () => setAtlas(atlasEl.hidden));
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
  storeSet(loc.id);
  if (location.hash.slice(1) !== loc.id) history.replaceState(null, '', '#' + loc.id);

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
  buildCoverSource(ds.images);
  if (engine) engine.setDataset(ds);
  governor.hold();
  loadingEl.hidden = true;
  loadingEl.lastChild.textContent = 'Loading';
  if (!captionEl.hidden) setCaption(true);
  await document.fonts?.ready;
  if (token !== switchToken) return;
  relayout();
  fillFallback();
  requestAnimationFrame(() => fadeEl.classList.add('clear'));
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
    hour += dt * (span / WEEK_SECONDS);
    if (hour >= span) hour -= span;
  }
  updateClockUI();
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

// The fallback names the location, so the title block can stay hidden.
function fillFallback() {
  if (fallbackEl.hidden) return;
  const title = meta?.title ?? locs[locIndex]?.title ?? '';
  fallbackEl.innerHTML =
    `<div class="f-title">${esc(title)}</div>` +
    `<h2>${esc(meta?.subtitle || 'A Week of Currents')}</h2>` +
    '<div class="rule"></div>' +
    '<p>This browser does not offer WebGPU,<br>so the map cannot draw here.<br>Try a recent Chrome, Edge or Safari.</p>';
}

// ─── start ──────────────────────────────────────────────────────────────────
async function start() {
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

start();
