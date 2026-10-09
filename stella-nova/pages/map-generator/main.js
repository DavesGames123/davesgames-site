// main.js — City Generator page: controls, playback clock, 2D map, 3D view
// switch, settings, exports, about sheet, screensaver.
//
// worker.js makes the city (gen.js, the vendored MapGenerator). The page
// then plays back how it was made (playback.js), in the 2D map (draw2d.js)
// or in the 3D view (view3d.js, loaded on first use).
//
//   Space  play / pause     Left / Right  previous / next seed    R  new city
//   E      skip to the end  X  speed      V  2D / 3D               F  field
//   S      settings         D  export     I  about                 Esc  close
//   2D: drag to pan, wheel or pinch to zoom, double-click to fit.
//   #seed=..&size=.. in the URL picks a city (other options too).
//
// grep: function regenerate  function frame  function buildPanel  function bind2D
//       function setView  function buildSave  function captionHTML  window.snSaver
//       function draw2D  function fit2D  function hashOpts

import { SIZES, defaults, generate, fieldSampler } from './gen.js';
import { timeline, frameAt } from './playback.js';
import { drawMap, fullFrame, fitView, toSVG, toJSON, CREDIT } from './draw2d.js';

const $ = (id) => document.getElementById(id);
const c2 = $('map2d');
const c3 = $('map3d');
const scrubEl = $('scrub');
const panelEl = $('panel'), saveEl = $('save'), captionEl = $('caption'), scrim = $('scrim');
const loadingEl = $('loading'), fallbackEl = $('fallback');

const KEY = 'map-generator';
const IDLE_MS = 2500;
const SPEEDS = [1, 2, 4, 0.5];
const ICON_PAUSE = '<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="2.5" y="1.5" width="3" height="11" rx="0.6"/><rect x="8.5" y="1.5" width="3" height="11" rx="0.6"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 1.6v10.8a.5.5 0 0 0 .76.43l8.6-5.4a.5.5 0 0 0 0-.86l-8.6-5.4a.5.5 0 0 0-.76.43z"/></svg>';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)');

// ─── state ──────────────────────────────────────────────────────────────────
let opts = defaults();
let city = null, tl = null, fieldAt = null;
let T = 0, playing = false, speedI = 0, scrubbing = false;
let view = '2d';
let showField = false;
let v2 = null;               // 2D view: { s, ox, oy }
let dirty = true;
let lastT = null;
let worker = null, workerOk = true, reqId = 0;
const pending = new Map();
let genToken = 0;
let v3 = null, v3Loading = null, v3Failed = false;
let meshFor = -1;            // genToken of the mesh in the 3D view
let saver = false;
let light = 'golden';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = (v, d = 0) => Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const LINK = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${esc(text)}</a>`;
function device() {
  const short = Math.min(window.innerWidth, window.innerHeight);
  const phone = coarse.matches && short < 600 || window.innerWidth <= 600;
  return { phone };
}

// PAGE MARK. The number and the section of this page, counted as the saver
// plate counts them. The section colour goes to --c.
function pageMark() {
  const cat = window.SN_SAVER_CATALOG?.pages ?? {};
  let n = 0, hit = null;
  for (const r of window.SN_NAV ?? []) for (const c of r.constellations) for (const g of c.groups) for (const p of g.p) {
    if (p[0] === 'home' || cat[p[0]]?.tier === 'excluded') continue;
    n++;
    if (p[0] === KEY) hit = { n, con: c.label, color: c.color };
  }
  if (!hit) return { text: 'Procedural city', color: null };
  return { text: `No. ${String(hit.n).padStart(3, '0')} · ${hit.con}`, color: hit.color };
}

// ─── URL options ────────────────────────────────────────────────────────────
const NUM_KEYS = ['seed', 'grids', 'radials', 'fieldScale', 'mainSep', 'majorSep', 'minorSep', 'bigParks', 'lotArea', 'noDivide', 'height'];
const BOOL_KEYS = ['coast', 'river', 'smooth'];
function hashOpts() {
  const q = new URLSearchParams(location.hash.slice(1));
  const o = {};
  for (const k of NUM_KEYS) if (q.has(k) && Number.isFinite(+q.get(k))) o[k] = +q.get(k);
  for (const k of BOOL_KEYS) if (q.has(k)) o[k] = q.get(k) === '1';
  if (q.has('size') && SIZES[q.get('size')]) o.size = q.get('size');
  return o;
}
function writeHash() {
  const d = defaults(), q = new URLSearchParams();
  q.set('seed', String(opts.seed));
  q.set('size', opts.size);
  for (const k of NUM_KEYS) if (k !== 'seed' && opts[k] !== d[k]) q.set(k, String(opts[k]));
  for (const k of BOOL_KEYS) if (opts[k] !== d[k]) q.set(k, opts[k] ? '1' : '0');
  try { history.replaceState(null, '', '#' + q.toString()); } catch { /* sandboxed */ }
}

// ─── generation ─────────────────────────────────────────────────────────────
function startWorker() {
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data);
    };
    worker.onerror = () => { workerOk = false; for (const p of pending.values()) p.reject(new Error('worker')); pending.clear(); };
  } catch { workerOk = false; }
}
function ask(msg) {
  return new Promise((resolve, reject) => {
    const id = ++reqId;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, ...msg });
  });
}

async function regenerate(patch = {}, { play = !reduced } = {}) {
  Object.assign(opts, patch);
  opts.seed = (opts.seed >>> 0) || 1;
  writeHash();
  syncSeed();
  const token = ++genToken;
  loadingEl.hidden = false;
  let c = null;
  try {
    if (workerOk && worker) c = (await ask({ type: 'gen', opts: { ...opts } })).city;
  } catch { workerOk = false; }
  if (!c) c = await generate({ ...opts });     // main-thread fallback
  if (token !== genToken) return;
  loadingEl.hidden = true;
  city = c;
  tl = timeline(city);
  fieldAt = fieldSampler(city);
  T = play ? 0 : tl.dur;
  setPlaying(play);
  fit2D();
  buildTicks();
  fillParams();
  syncPanel();
  dirty = true;
  if (view === '3d') await load3D().then(() => push3D()).catch(() => { /* 2D stays */ });
}

// ─── head, foot ─────────────────────────────────────────────────────────────
const param = (v, label) => `<div class="p"><span class="v">${v}</span><small>${esc(label)}</small></div>`;
function fillParams() {
  if (!city) return;
  const s = city.stats;
  const roads = city.roads.main.length + city.roads.major.length + city.roads.minor.length;
  $('params').innerHTML = [
    param(`${fmt(roads)}`, 'roads'),
    param(`${fmt(s.blocks)}`, 'blocks'),
    param(`${fmt(s.lots)}`, 'buildings'),
    param(`<i class="sym">h</i><sub>max</sub> = ${fmt(s.tallest)} m`, 'tallest'),
  ].join('');
  $('sub').textContent = `Seed ${city.seed} · ${SIZES[opts.size].label} · ${fmt(city.view.w * 2 / 1000, 1)} × ${fmt(city.view.h * 2 / 1000, 1)} km`;
}
function syncSeed() {
  $('seedName').textContent = `Seed ${opts.seed}`;
  $('seedSize').textContent = SIZES[opts.size].label.toUpperCase();
}

const PHASE_NOTE = {
  field: () => `Tensor field: ${opts.grids} grid${opts.grids === 1 ? '' : 's'} and ${opts.radials} radial centre${opts.radials === 1 ? '' : 's'} set the street directions`,
  coast: () => 'Coastline: a noisy streamline that crosses the map',
  river: () => 'River: a streamline of the other direction, widened, a road on each bank',
  main: () => `Main roads: streamlines ${opts.mainSep} m apart`,
  major: () => `Major roads: streamlines ${opts.majorSep} m apart`,
  parks: () => 'Parks: faces of the major road grid',
  minor: () => `Minor roads: streamlines ${opts.minorSep} m apart, noisy inside the parks`,
  blocks: () => 'Blocks: the faces of the road graph, shrunk from the kerb',
  lots: () => `Lots: each block cut into pieces of ${opts.lotArea} m² or more`,
  buildings: () => 'Buildings: one per lot, tallest near the field centres',
  done: () => view === '3d' ? 'Finished. Drag to orbit, pinch or scroll to zoom' : 'Finished. Drag to pan, scroll to zoom, or open the 3D view',
};
let shownPhase = '';
function syncPhase(f) {
  const k = f ? f.phase : 'done';
  if (k === shownPhase) return;
  shownPhase = k;
  $('phase').textContent = (PHASE_NOTE[k] || PHASE_NOTE.done)();
}

// ─── playback bar ───────────────────────────────────────────────────────────
const scrubFill = scrubEl.querySelector('.fill'), scrubKnob = scrubEl.querySelector('.knob');
function buildTicks() {
  scrubEl.querySelectorAll('.tick').forEach((t) => t.remove());
  if (!tl) return;
  for (const p of tl.phases.slice(1)) {
    const tick = document.createElement('i');
    tick.className = 'tick';
    tick.style.left = (p.t0 / tl.dur * 100) + '%';
    tick.title = p.k;
    scrubEl.prepend(tick);
  }
  scrubEl.setAttribute('aria-valuemax', fmt(tl.dur, 1));
}
function syncScrub() {
  if (!tl) return;
  const f = clamp(T / tl.dur, 0, 1);
  scrubFill.style.transform = `scaleX(${f})`;
  scrubKnob.style.left = (f * 100) + '%';
  scrubEl.setAttribute('aria-valuenow', fmt(T, 1));
}
function bindScrub() {
  const at = (e) => {
    const r = scrubEl.getBoundingClientRect();
    T = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1) * (tl ? tl.dur : 0);
    dirty = true;
  };
  scrubEl.addEventListener('pointerdown', (e) => {
    if (!tl) return;
    scrubbing = true; setPlaying(false);
    try { scrubEl.setPointerCapture(e.pointerId); } catch { /* */ }
    at(e);
  });
  scrubEl.addEventListener('pointermove', (e) => { if (scrubbing) at(e); });
  const end = () => { scrubbing = false; };
  scrubEl.addEventListener('pointerup', end);
  scrubEl.addEventListener('pointercancel', end);
  scrubEl.addEventListener('keydown', (e) => {
    if (!tl) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault(); e.stopPropagation();
      setPlaying(false);
      T = clamp(T + (e.key === 'ArrowLeft' ? -1 : 1), 0, tl.dur); dirty = true;
    }
  });
}

function setPlaying(v) {
  playing = !!v && !!tl;
  if (playing && tl && T >= tl.dur) T = 0;
  const b = $('play');
  b.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
  b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  dirty = true;
}
function skipEnd() { if (!tl) return; T = tl.dur; setPlaying(false); dirty = true; }
function cycleSpeed() {
  speedI = (speedI + 1) % SPEEDS.length;
  $('speed').textContent = `${SPEEDS[speedI]}×`.replace('0.5×', '½×');
}

// ─── 2D view ────────────────────────────────────────────────────────────────
function band() {
  const h = window.innerHeight;
  if (saver) return { t: 0, b: 0 };
  let t = $('head').getBoundingClientRect().bottom + 6;
  let b = h - $('foot').getBoundingClientRect().top + 6;
  // keep at least 40% of the height for the map
  if (h - t - b < h * 0.4) { t = Math.min(t, h * 0.18); b = Math.min(b, h * 0.42); }
  return { t, b };
}
function fit2D() {
  if (!city) return;
  const w = window.innerWidth, h = window.innerHeight;
  v2 = fitView(city, w, h, device().phone ? 6 : 24, band());
  dirty = true;
}
function sizeCanvas2D() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(window.innerWidth * dpr), H = Math.round(window.innerHeight * dpr);
  if (c2.width !== W || c2.height !== H) { c2.width = W; c2.height = H; }
  return dpr;
}
const ctx2 = c2.getContext('2d');
function draw2D(fr) {
  const dpr = sizeCanvas2D();
  const f = fr || (tl ? frameAt(city, tl, T) : fullFrame(city));
  const fieldA = Math.max(f.field, showField ? 0.75 : 0);
  drawMap(ctx2, city, { ...f, field: fieldA }, { w: window.innerWidth, h: window.innerHeight, dpr, ...v2, fieldAt, layers: {} });
}

function bind2D() {
  const pts = new Map();
  let last = null;
  const zoomAt = (px, py, k) => {
    if (!v2) return;
    const s = clamp(v2.s * k, 0.05, 40);
    k = s / v2.s;
    v2 = { s, ox: px - (px - v2.ox) * k, oy: py - (py - v2.oy) * k };
    dirty = true;
  };
  c2.addEventListener('pointerdown', (e) => {
    try { c2.setPointerCapture(e.pointerId); } catch { /* */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    last = null;
    c2.classList.add('drag');
  });
  c2.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !v2) return;
    const prev = pts.get(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      v2 = { ...v2, ox: v2.ox + e.clientX - prev.x, oy: v2.oy + e.clientY - prev.y };
      dirty = true;
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d = Math.hypot(a.x - b.x, a.y - b.y);
      if (last) {
        v2 = { ...v2, ox: v2.ox + mid.x - last.mid.x, oy: v2.oy + mid.y - last.mid.y };
        zoomAt(mid.x, mid.y, d / Math.max(1, last.d));
      }
      last = { mid, d };
    }
  });
  const up = (e) => { pts.delete(e.pointerId); last = null; if (!pts.size) c2.classList.remove('drag'); };
  c2.addEventListener('pointerup', up);
  c2.addEventListener('pointercancel', up);
  c2.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-clamp(e.deltaY, -200, 200) * (e.ctrlKey ? 0.01 : 0.0015)));
  }, { passive: false });
  c2.addEventListener('dblclick', () => fit2D());
}

// ─── 3D view ────────────────────────────────────────────────────────────────
function load3D() {
  if (v3) return Promise.resolve(v3);
  if (v3Failed) return Promise.reject(new Error('3D unavailable'));
  if (!v3Loading) {
    v3Loading = import('./view3d.js')
      .then((m) => m.createView3D(c3, { phone: device().phone, onInput: () => { dirty = true; } }))
      .then((v) => { v3 = v; return v; })
      .catch((err) => {
        v3Failed = true;
        console.warn('map-generator: 3D view', err);
        fallbackEl.innerHTML = `<p>The 3D view needs WebGPU, which this browser does not offer. The 2D map works everywhere.</p>`;
        throw err;
      });
  }
  return v3Loading;
}
async function push3D() {
  if (!v3 || !city || meshFor === genToken) return;
  const token = genToken;
  let mesh = null;
  try {
    if (workerOk && worker) mesh = (await ask({ type: 'mesh' })).mesh;
  } catch { /* fall back */ }
  const m3 = await import('./mesh3d.js');
  if (!mesh) mesh = m3.buildMesh(city, tl);
  if (token !== genToken) return;
  v3.setCity(city, tl, mesh, m3.fieldLines(city, fieldAt));
  meshFor = token;
  dirty = true;
}
async function setView(v) {
  if (v === view && !(v === '3d' && !v3)) return;
  if (v === '3d') {
    loadingEl.hidden = false;
    try { await load3D(); await push3D(); }
    catch {
      loadingEl.hidden = true;
      if (!saver) {
        fallbackEl.hidden = false;
        setTimeout(() => { fallbackEl.hidden = true; }, 4200);
      }
      return;
    }
    loadingEl.hidden = true;
  }
  view = v;
  c2.hidden = v !== '2d';
  c3.hidden = v !== '3d';
  $('chip2d').setAttribute('aria-pressed', String(v === '2d'));
  $('chip3d').setAttribute('aria-pressed', String(v === '3d'));
  shownPhase = '';
  if (v === '3d' && v3) v3.resize();
  dirty = true;
}

// ─── frame ──────────────────────────────────────────────────────────────────
function frame(t) {
  requestAnimationFrame(frame);
  const dt = lastT == null ? 0 : Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  if (saver && saverTick) saverTick(dt, t);
  if (playing && tl && !scrubbing) {
    T += dt * SPEEDS[speedI] * (saver ? saverRate : 1);
    if (T >= tl.dur) { T = tl.dur; setPlaying(false); }
    dirty = true;
  }
  if (!city) return;
  const f = (dirty || view === '3d') && tl ? frameAt(city, tl, T) : null;
  if (f) { syncPhase(f); syncScrub(); }
  if (view === '2d' && dirty && v2) { draw2D(f); dirty = false; }
  else if (view === '3d' && v3 && meshFor === genToken) {
    v3.frame({ T: T >= tl.dur ? 1e9 : T, dt, light, field: Math.max(f ? f.field : 0, showField ? 0.75 : 0), saver, offsetY: saver ? saverOffsetY : 0 });
    dirty = false;
  }
}

// ─── settings panel ─────────────────────────────────────────────────────────
const sw = (id, on, label) => `<button class="sw" id="${id}" type="button" role="switch" aria-checked="${on}" aria-label="${esc(label)}"></button>`;
const range = (id, label, min, max, step, val) =>
  `<label class="row"><span>${esc(label)}</span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}"><output id="${id}O"></output></label>`;
const seg = (id, label, list, cur) => `<div class="row two"><span>${esc(label)}</span><span class="seg" id="${id}">${list.map(([v, t]) =>
  `<button type="button" data-v="${v}" aria-pressed="${v === cur}">${esc(t)}</button>`).join('')}</span></div>`;

const SLIDERS = [
  // id, opts key, label, min, max, step, format
  ['sGrids', 'grids', 'Grids', 0, 8, 1, (v) => `${v}`],
  ['sRadials', 'radials', 'Radials', 0, 4, 1, (v) => `${v}`],
  ['sScale', 'fieldScale', 'Field size', 0.4, 2, 0.05, (v) => `× ${fmt(v, 2)}`],
  ['sMain', 'mainSep', 'Main', 200, 800, 10, (v) => `${v} m`],
  ['sMajor', 'majorSep', 'Major', 50, 250, 5, (v) => `${v} m`],
  ['sMinor', 'minorSep', 'Minor', 12, 50, 1, (v) => `${v} m`],
  ['sParks', 'bigParks', 'Parks', 0, 8, 1, (v) => `${v}`],
  ['sLot', 'lotArea', 'Lot size', 20, 300, 5, (v) => `${v} m²`],
  ['sWhole', 'noDivide', 'Whole blocks', 0, 0.6, 0.01, (v) => `${fmt(v * 100)} %`],
  ['sHeight', 'height', 'Height', 0.3, 3, 0.05, (v) => `× ${fmt(v, 2)}`],
];
function buildPanel() {
  const lg = (k, title, why, body) => `<section class="lg" data-k="${k}"><h3>${esc(title)}</h3><p class="why">${esc(why)}</p>${body}</section>`;
  const S = (id) => { const s = SLIDERS.find((x) => x[0] === id); return range(s[0], s[2], s[3], s[4], s[5], opts[s[1]]); };
  $('panelBody').innerHTML = [
    lg('view', 'City', 'Every seed is a different city. The same seed and settings always give the same city.',
      `<label class="row two"><span>Seed</span><input id="seedIn" type="number" min="1" max="4294967295" step="1" value="${opts.seed}"></label>` +
      seg('sizeSeg', 'Size', Object.entries(SIZES).map(([k, v]) => [k, v.label]), opts.size) +
      `<div class="row btns"><button class="btn" id="genBtn" type="button">Generate</button><button class="btn" id="rndBtn" type="button">Random seed</button></div>`),
    lg('field', 'Tensor field', 'Grid centres pull the streets into straight grids at an angle. Radial centres make ring roads and spokes.',
      S('sGrids') + S('sRadials') + S('sScale') +
      `<div class="row two"><span>Smooth</span>${sw('swSmooth', opts.smooth, 'Smooth the field')}</div>`),
    lg('water', 'Water', 'A coastline and a river are streamlines too, with noise added.',
      `<div class="row two"><span>Coast</span>${sw('swCoast', opts.coast, 'Coastline')}</div><div class="row two"><span>River</span>${sw('swRiver', opts.river, 'River')}</div>`),
    lg('roads', 'Roads', 'The distance between two roads of a class that run side by side.',
      S('sMain') + S('sMajor') + S('sMinor') + S('sParks')),
    lg('build', 'Lots and buildings', 'Blocks are cut into lots no smaller than the lot size. Some blocks stay whole.',
      S('sLot') + S('sWhole') + S('sHeight')),
    lg('view', '3D light', 'The light of the 3D view, as in City Atlas.',
      seg('lightSeg', 'Light', [['day', 'Day'], ['golden', 'Golden'], ['dusk', 'Dusk'], ['night', 'Night']], light)),
  ].join('');
  for (const [id, key, , , , , f] of SLIDERS) {
    const inp = $(id), out = $(id + 'O');
    out.textContent = f(+inp.value);
    inp.addEventListener('input', () => { out.textContent = f(+inp.value); });
    inp.addEventListener('change', () => regenerate({ [key]: +inp.value }));
  }
  const swb = (id, key) => $(id).addEventListener('click', () => {
    const on = $(id).getAttribute('aria-checked') !== 'true';
    $(id).setAttribute('aria-checked', String(on));
    regenerate({ [key]: on });
  });
  swb('swSmooth', 'smooth'); swb('swCoast', 'coast'); swb('swRiver', 'river');
  $('sizeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    for (const x of $('sizeSeg').children) x.setAttribute('aria-pressed', String(x === b));
    regenerate({ size: b.dataset.v });
  });
  $('lightSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    for (const x of $('lightSeg').children) x.setAttribute('aria-pressed', String(x === b));
    light = b.dataset.v; dirty = true;
  });
  $('genBtn').addEventListener('click', () => regenerate({ seed: +$('seedIn').value || 1 }));
  $('rndBtn').addEventListener('click', () => newCity());
  $('seedIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') regenerate({ seed: +$('seedIn').value || 1 }); });
}
function syncPanel() {
  if (!$('seedIn')) return;
  $('seedIn').value = opts.seed;
  for (const [id, key, , , , , f] of SLIDERS) { $(id).value = opts[key]; $(id + 'O').textContent = f(opts[key]); }
  $('swSmooth').setAttribute('aria-checked', String(!!opts.smooth));
  $('swCoast').setAttribute('aria-checked', String(!!opts.coast));
  $('swRiver').setAttribute('aria-checked', String(!!opts.river));
  for (const x of $('sizeSeg').children) x.setAttribute('aria-pressed', String(x.dataset.v === opts.size));
}
function newCity() { regenerate({ seed: 1 + Math.floor(Math.random() * 999999) }); }

// ─── exports ────────────────────────────────────────────────────────────────
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
const baseName = () => `city-seed${city.seed}-${opts.size}`;
function exportPNG() {
  const k = 2, w = city.view.w * k, h = city.view.h * k;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  drawMap(c.getContext('2d'), city, fullFrame(city), { w, h, dpr: 1, s: k, ox: 0, oy: 0, fieldAt: null, layers: { field: false } });
  c.toBlob((b) => b && download(b, baseName() + '.png'), 'image/png');
}
function exportSVG() { download(new Blob([toSVG(city, { title: `City, seed ${city.seed}` })], { type: 'image/svg+xml' }), baseName() + '.svg'); }
function exportJSON() { download(new Blob([toJSON(city)], { type: 'application/json' }), baseName() + '.json'); }
async function exportSTL() {
  const { toSTL } = await import('./mesh3d.js');
  download(new Blob([toSTL(city)], { type: 'model/stl' }), baseName() + '.stl');
}
function buildSave() {
  const row = (id, title, text) => `<div class="ex"><b>${esc(title)}</b><button id="${id}" type="button">Save</button><p>${esc(text)}</p></div>`;
  $('saveBody').innerHTML = [
    row('exPNG', 'Map image (PNG)', 'The finished 2D map, two pixels per metre.'),
    row('exSVG', 'Map drawing (SVG)', 'Water, parks, blocks, lots and roads as vector shapes, in map units.'),
    row('exJSON', 'City data (JSON)', 'Every polygon and road line, the building heights, the field and the build order.'),
    row('exSTL', '3D model (STL)', 'Blocks and buildings as one solid for a 3D printer or a modeller, in metres.'),
    `<p id="saveNote">${esc(CREDIT)}</p>`,
  ].join('');
  $('exPNG').addEventListener('click', () => city && exportPNG());
  $('exSVG').addEventListener('click', () => city && exportSVG());
  $('exJSON').addEventListener('click', () => city && exportJSON());
  $('exSTL').addEventListener('click', () => city && exportSTL().catch(() => { $('exSTL').disabled = true; }));
}

// ─── about ──────────────────────────────────────────────────────────────────
function captionHTML() {
  return `
<p>A city from a seed. A <b>tensor field</b> gives every point of the map two directions at right angles. Roads are <b>streamlines</b> of that field: curves that follow one of the two directions, started at random points and stopped when they come too close to a road that runs the same way. Main roads are spaced widest, then major roads, then minor roads.</p>
<p>The coastline and the river are streamlines with noise. The faces of the road graph become blocks, the blocks are cut into lots, and each lot gets a building. The page makes the whole city first, then plays back the order in which it was made.</p>
<p>The 3D view uses the light, colours and camera of City Atlas. Building heights are an invented rule: taller near the centres of the field.</p>
<section class="credits"><h3>Credits and licences</h3><ul>
<li>City generation: ${LINK('https://github.com/probabletrain/mapgenerator', 'MapGenerator')} by <b>ProbableTrain</b> and contributors (${LINK('https://maps.probabletrain.com', 'documentation')}, ${LINK('https://probabletrain.itch.io/city-generator', 'the original app')}), ${LINK('https://www.gnu.org/licenses/lgpl-3.0.html', 'LGPL-3.0')}. Its generation code (tensor field, streamlines, water, graph, polygons) is used unchanged as a separate, replaceable module: ${LINK('../../vendor/mapgenerator/CREDITS.md', 'vendor/mapgenerator')}, with its ${LINK('../../vendor/mapgenerator/THIRD-PARTY.txt', 'bundled libraries')} (jsts, simplify-js, isect, d3-quadtree, polyk, simplex-noise, loglevel).</li>
<li>Method: G. Chen, G. Esch, P. Wonka, P. Müller, E. Zhang, “Interactive Procedural Street Modeling”, ACM SIGGRAPH 2008.</li>
<li>This page (controls, playback, 2D and 3D views, building heights, exports): Dave, for Stella Nova. The upstream app's interface is not used.</li>
</ul></section>`;
}
function setCaption(open) {
  if (open) { $('capTitle').innerHTML = 'City Generator<small>Tensor-field streets, after ProbableTrain</small>'; $('capBody').innerHTML = captionHTML(); }
  captionEl.hidden = !open;
  $('info').setAttribute('aria-pressed', String(open));
  if (open) { setSheet(panelEl, false); setSheet(saveEl, false); }
  syncScrim();
}
function setSheet(el, open) {
  el.hidden = !open;
  const btn = el === panelEl ? $('settingsBtn') : $('saveBtn');
  btn.setAttribute('aria-expanded', String(open));
  if (el === panelEl) $('where').setAttribute('aria-expanded', String(open));
  if (open) { captionEl.hidden = true; $('info').setAttribute('aria-pressed', 'false'); if (device().phone) (el === panelEl ? saveEl : panelEl).hidden = true; }
  syncScrim();
}
function syncScrim() {
  const phone = device().phone;
  scrim.hidden = (captionEl.hidden || !phone) && (panelEl.hidden || !phone) && saveEl.hidden;
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

// ─── input ──────────────────────────────────────────────────────────────────
let idleTimer = 0;
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (panelEl.hidden && saveEl.hidden && captionEl.hidden) document.body.classList.add('idle'); }, IDLE_MS);
}
function bindInput() {
  $('prev').addEventListener('click', () => regenerate({ seed: Math.max(1, opts.seed - 1) }));
  $('next').addEventListener('click', () => regenerate({ seed: opts.seed + 1 }));
  $('play').addEventListener('click', () => setPlaying(!playing));
  $('speed').addEventListener('click', cycleSpeed);
  $('end').addEventListener('click', skipEnd);
  $('dice').addEventListener('click', newCity);
  $('where').addEventListener('click', () => setSheet(panelEl, panelEl.hidden));
  $('settingsBtn').addEventListener('click', () => setSheet(panelEl, panelEl.hidden));
  $('saveBtn').addEventListener('click', () => setSheet(saveEl, saveEl.hidden));
  $('info').addEventListener('click', () => setCaption(captionEl.hidden));
  $('chip2d').addEventListener('click', () => setView('2d'));
  $('chip3d').addEventListener('click', () => setView('3d'));
  $('chipField').addEventListener('click', () => { showField = !showField; $('chipField').setAttribute('aria-pressed', String(showField)); dirty = true; });
  $('capClose').addEventListener('click', () => setCaption(false));
  $('panelClose').addEventListener('click', () => setSheet(panelEl, false));
  $('saveClose').addEventListener('click', () => setSheet(saveEl, false));
  scrim.addEventListener('click', () => { setCaption(false); setSheet(saveEl, false); if (device().phone) setSheet(panelEl, false); });
  bindSheetDrag(captionEl, $('capGrip'), () => setCaption(false));
  bindSheetDrag(panelEl, $('panelGrip'), () => setSheet(panelEl, false));
  bindSheetDrag(saveEl, $('saveGrip'), () => setSheet(saveEl, false));
  bindScrub();
  bind2D();

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('input')) return;
    wake();
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowLeft') { e.preventDefault(); regenerate({ seed: Math.max(1, opts.seed - 1) }); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); regenerate({ seed: opts.seed + 1 }); }
    else if (e.key === ' ' || e.code === 'Space') { if (e.target.closest?.('button')) return; e.preventDefault(); setPlaying(!playing); }
    else if (k === 'r') newCity();
    else if (k === 'e') skipEnd();
    else if (k === 'x') cycleSpeed();
    else if (k === 'v') setView(view === '2d' ? '3d' : '2d');
    else if (k === 'f') $('chipField').click();
    else if (k === 's') setSheet(panelEl, panelEl.hidden);
    else if (k === 'd') setSheet(saveEl, saveEl.hidden);
    else if (k === 'i') setCaption(captionEl.hidden);
    else if (e.key === 'Escape') { setCaption(false); setSheet(panelEl, false); setSheet(saveEl, false); }
  });
  for (const ev of ['pointermove', 'pointerdown', 'touchstart', 'wheel']) window.addEventListener(ev, wake, { passive: true });
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', (e) => {
    const inSheet = captionEl.contains(e.target) || panelEl.contains(e.target) || saveEl.contains(e.target);
    if (!inSheet) e.preventDefault();
  }, { passive: false });
  let rz = 0;
  const onResize = () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { document.body.classList.toggle('phone', device().phone); fit2D(); if (v3) v3.resize(); syncScrim(); }); };
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
  document.addEventListener('visibilitychange', () => { lastT = null; });
}

// ─── screensaver ────────────────────────────────────────────────────────────
// The shell screensaver (lib/screensaver.js) calls window.snSaver.enter().
// Each city: a plan view from above while the field and the roads draw,
// a tilt down while the blocks, lots and buildings come, then fly-through
// shots of the finished city (along a street, round the tallest tower,
// the skyline from the water, a high pass), cut every 6 to 11 s. Then a
// new seed. Shots come from a seeded shuffle, so each run differs. With
// no WebGPU the saver plays the 2D map with slow push-ins.
// The plate has the city, the phase and the counts; no code.
let saverTick = null, saverRate = 1, saverLabel = null, saverOffsetY = 0;
const tour = { rnd: null, calm: 0, shot: null, shotT: 0, shotLen: 8, n: 0, band: null, bandAt: -1e9, bandFn: null, busy: false, light: 'golden', bag: [] };
function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const SAVER_LIGHTS = [['golden', 0.4], ['day', 0.25], ['dusk', 0.2], ['night', 0.15]];
function pickLight(r) { let x = r(); for (const [k, w] of SAVER_LIGHTS) if ((x -= w) <= 0) return k; return 'golden'; }

// a point and the direction along a road, at share u of its length (world x, y)
function alongRoad(l, u) {
  const cx = city.view.w / 2, cy = city.view.h / 2;
  let L = 0;
  for (let i = 1; i < l.length; i++) L += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
  let left = L * clamp(u, 0, 1);
  for (let i = 1; i < l.length; i++) {
    const s = Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
    if (s >= left || i === l.length - 1) {
      const k = s ? Math.min(1, left / s) : 0;
      const x = l[i - 1][0] + (l[i][0] - l[i - 1][0]) * k, y = l[i - 1][1] + (l[i][1] - l[i - 1][1]) * k;
      return { p: [x - cx, cy - y], dir: [(l[i][0] - l[i - 1][0]) / (s || 1), -(l[i][1] - l[i - 1][1]) / (s || 1)], L };
    }
    left -= s;
  }
  return { p: [0, 0], dir: [1, 0], L };
}
function inView(x, y) { return Math.abs(x) < city.view.w * 0.45 && Math.abs(y) < city.view.h * 0.45; }

function nextShot() {
  const r = tour.rnd, h = v3.home();
  const end = T >= tl.dur;
  tour.shotT = 0;
  tour.shotLen = (6 + r() * 5) * (1 + tour.calm * 0.4);
  if (!end) {
    const minorEnd = (tl.phases.find((p) => p.k === 'minor') || { t1: tl.dur * 0.6 }).t1;
    if (T < minorEnd) {
      // plan view: from above, turning slowly while the roads draw
      tour.shot = { k: 'plan', yaw0: r() * Math.PI * 2, spin: (r() < 0.5 ? -1 : 1) * 0.05, dist: h.dist * (0.75 + r() * 0.2) };
      Object.assign(v3.cam, { target: [0, 0, 0], yaw: tour.shot.yaw0, pitch: 1.5, dist: tour.shot.dist });
    } else {
      // tilt down while the blocks, lots and buildings come
      tour.shot = { k: 'tilt' };
      v3.goal({ target: [(r() - 0.5) * city.view.w * 0.2, (r() - 0.5) * city.view.h * 0.2, 0], yaw: v3.cam.yaw + 0.6, pitch: 0.42 + r() * 0.15, dist: h.dist * (0.55 + r() * 0.2) }, 0.35);
    }
    return;
  }
  if (tour.n >= 4 + Math.floor(r() * 3)) { tour.shot = { k: 'next' }; return; }
  tour.n++;
  if (!tour.bag.length) tour.bag = ['street', 'tower', 'skyline', 'high', 'street'].sort(() => r() - 0.5);
  const k = tour.bag.pop();
  if (k === 'street') {
    const roads = city.roads.main.concat(city.roads.major).filter((l) => l.length > 1);
    const l = roads[Math.floor(r() * roads.length)] || [];
    const u0 = 0.15 + r() * 0.3;
    const a = alongRoad(l, u0);
    tour.shot = { k, l, u: u0, speed: 26 / Math.max(a.L, 1), pitch: 0.1 + r() * 0.1, dist: 140 + r() * 120, side: (r() - 0.5) * 0.5 };
    if (!inView(a.p[0], a.p[1])) tour.shot.u = 0.5;
    Object.assign(v3.cam, { target: [a.p[0], a.p[1], 10], yaw: Math.atan2(-a.dir[0], -a.dir[1]) + tour.shot.side, pitch: tour.shot.pitch, dist: tour.shot.dist });
  } else if (k === 'tower') {
    let best = 0;
    city.buildings.forEach((b, i) => { if (b.h > city.buildings[best].h && r() < 0.9) best = i; });
    const c = city.lots[best].reduce((a, q) => [a[0] + q[0] / city.lots[best].length, a[1] + q[1] / city.lots[best].length], [0, 0]);
    const p = [c[0] - city.view.w / 2, city.view.h / 2 - c[1]];
    const hh = city.buildings[best].h;
    tour.shot = { k, spin: (r() < 0.5 ? -1 : 1) * 0.12 };
    Object.assign(v3.cam, { target: [p[0], p[1], hh * 0.55], yaw: r() * Math.PI * 2, pitch: 0.25 + r() * 0.2, dist: Math.max(160, hh * 3.2) });
  } else if (k === 'skyline') {
    tour.shot = { k, spin: (r() < 0.5 ? -1 : 1) * 0.03 };
    let yaw = r() * Math.PI * 2;
    if (city.coastline.length) {
      const m = city.coastline[city.coastline.length >> 1];
      const sx = m[0] - city.view.w / 2, sy = city.view.h / 2 - m[1];
      // look from the water toward the centre: the camera sits past the coast
      const sea = city.sea.length ? city.sea.reduce((a, q) => [a[0] + q[0] / city.sea.length, a[1] + q[1] / city.sea.length], [0, 0]) : m;
      const wx = sea[0] - city.view.w / 2, wy = city.view.h / 2 - sea[1];
      yaw = Math.atan2(wx - sx, wy - sy);
    }
    Object.assign(v3.cam, { target: [0, 0, 20], yaw, pitch: 0.12 + r() * 0.08, dist: h.dist * (0.7 + r() * 0.2) });
  } else {
    tour.shot = { k: 'high', spin: (r() < 0.5 ? -1 : 1) * 0.04 };
    Object.assign(v3.cam, { target: [(r() - 0.5) * city.view.w * 0.3, (r() - 0.5) * city.view.h * 0.3, 0], yaw: r() * Math.PI * 2, pitch: 0.7 + r() * 0.3, dist: h.dist * (0.45 + r() * 0.2) });
  }
  if (r() < 0.35) tour.light = pickLight(r);
  light = tour.light;
}

async function saverCity() {
  tour.busy = true;
  tour.n = 0;
  tour.light = pickLight(tour.rnd);
  light = tour.light;
  await regenerate({ seed: 1 + Math.floor(tour.rnd() * 999999) }, { play: true });
  tour.shot = null;
  tour.busy = false;
}

function saverPlate() {
  if (!saverLabel || !city) return;
  const f = tl ? frameAt(city, tl, T) : null;
  const ph = f ? f.phase : 'done';
  const s = city.stats;
  const roads = city.roads.main.length + city.roads.major.length + city.roads.minor.length;
  try {
    saverLabel({
      title: 'City Generator',
      sub: `Seed ${city.seed} · ${ph === 'done' ? 'the finished city' : PHASE_TITLE[ph] || ph}`,
      params: [
        { sym: 'N_{\\mathrm{roads}}', name: 'roads', value: fmt(roads) },
        { sym: 'N_{\\mathrm{lots}}', name: 'buildings', value: fmt(s.lots) },
        { sym: 'h_{\\max}', name: 'tallest', value: `${fmt(s.tallest)} m` },
      ],
      tex: [String.raw`\frac{d\mathbf{x}}{ds}=\mathbf{e}_{\mathrm{major}}(\mathbf{x}),\qquad T=R\begin{pmatrix}\cos 2\theta&\sin 2\theta\\ \sin 2\theta&-\cos 2\theta\end{pmatrix}`],
      eq: ['dx/ds = e_major(x),  T = R [cos 2θ, sin 2θ; sin 2θ, −cos 2θ]'],
      lines: ['Streets are streamlines of a tensor field. Generator: MapGenerator by ProbableTrain (LGPL-3.0).'],
    });
  } catch { /* the plate is optional */ }
}
const PHASE_TITLE = { field: 'the tensor field', coast: 'the coastline', river: 'the river', main: 'main roads', major: 'major roads', parks: 'parks', minor: 'minor roads', blocks: 'blocks', lots: 'lots', buildings: 'buildings rise' };

let plateAt = -1e9, platePhase = '';
saverTick = (dt, t) => {
  if (!city || !tl || tour.busy) return;
  if (tour.bandFn && t - tour.bandAt > 700) { tour.bandAt = t; tour.band = tour.bandFn(window.innerHeight); }
  const h = window.innerHeight;
  const target = tour.band ? (tour.band.b - tour.band.t) / h : 0;
  saverOffsetY += (target - saverOffsetY) * (1 - Math.exp(-dt * 0.8));
  const ph = frameAt(city, tl, T).phase;
  if (saverLabel && (t - plateAt > 1500 || ph !== platePhase)) { plateAt = t; platePhase = ph; saverPlate(); }
  if (view !== '3d' || !v3) {
    // 2D: slow push-in, a new city after the finished map has shown a while
    tour.shotT += dt;
    if (v2) { const k = Math.exp(dt * 0.012); const cx = window.innerWidth / 2, cy = window.innerHeight / 2; v2 = { s: v2.s * k, ox: cx - (cx - v2.ox) * k, oy: cy - (cy - v2.oy) * k }; dirty = true; }
    if (T >= tl.dur && tour.shotT > 14) { tour.shotT = 0; saverCity(); }
    return;
  }
  if (!tour.shot) nextShot();
  const sh = tour.shot;
  tour.shotT += dt;
  if (sh.k === 'next') { saverCity(); return; }
  if (sh.k === 'plan') v3.cam.yaw += sh.spin * dt;
  else if (sh.k === 'street') {
    sh.u += sh.speed * dt;
    const a = alongRoad(sh.l, Math.min(sh.u, 0.95));
    const k = 1 - Math.exp(-dt * 2);
    v3.cam.target[0] += (a.p[0] - v3.cam.target[0]) * k;
    v3.cam.target[1] += (a.p[1] - v3.cam.target[1]) * k;
    let want = Math.atan2(-a.dir[0], -a.dir[1]) + sh.side, d = want - v3.cam.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    v3.cam.yaw += d * (1 - Math.exp(-dt * 0.8));
  } else if (sh.spin) v3.cam.yaw += sh.spin * dt;
  const done = T >= tl.dur;
  // cut when the shot is long enough; the plan view holds until the roads are drawn
  const minorEnd = (tl.phases.find((p) => p.k === 'minor') || { t1: 0 }).t1;
  if (sh.k === 'plan' && T < minorEnd) { if (tour.shotT > tour.shotLen) nextShot(); return; }
  if (sh.k === 'plan' || (sh.k === 'tilt' && done) || (sh.k !== 'tilt' && tour.shotT > tour.shotLen)) nextShot();
};

window.snSaver = {
  async enter(o = {}) {
    await started;
    saver = true;
    tour.calm = clamp(+o.calm || 0, 0, 1);
    tour.rnd = mulberry32((o.seed >>> 0) || 1);
    tour.bag = [];
    saverRate = 1.15 / (1 + tour.calm * 0.6);
    saverLabel = o.labels === false || typeof o.label !== 'function' ? null : o.label;
    import('../../lib/saver-clear.js').then((m) => { tour.bandFn = m.plateBand; }).catch(() => { /* no band */ });
    document.body.classList.add('saver', 'idle');
    setCaption(false); setSheet(panelEl, false); setSheet(saveEl, false);
    speedI = 0;
    let canvas = c2;
    try { await setView('3d'); if (view === '3d') { canvas = c3; v3.auto = false; } } catch { /* 2D */ }
    await saverCity();
    if (view === '2d') fit2D();
    return { canvas, warmupMs: 1500 };
  },
  exit() {
    saver = false;
    saverLabel = null;
    saverOffsetY = 0;
    if (v3) v3.auto = true;
    document.body.classList.remove('saver');
    fit2D();
  },
};

// ─── start ──────────────────────────────────────────────────────────────────
async function start() {
  const mark = pageMark();
  $('cat').textContent = mark.text;
  if (mark.color) document.documentElement.style.setProperty('--c', mark.color);
  const { phone } = device();
  document.body.classList.toggle('phone', phone);
  if (phone) opts.size = 'town';     // the light path on phones
  Object.assign(opts, hashOpts());
  $('play').innerHTML = ICON_PLAY;
  startWorker();
  buildPanel();
  buildSave();
  bindInput();
  wake();
  requestAnimationFrame(frame);
  await regenerate({}, { play: !reduced });
  document.body.classList.add('shown');
}
const started = start();

// Debug handle for the console and node checks.
window.__mapGen = {
  get city() { return city; },
  get timeline() { return tl; },
  get state() { return { T, playing, view, opts: { ...opts }, speed: SPEEDS[speedI] }; },
  regenerate: (o) => regenerate(o || {}),
  view: (v) => setView(v),
  seek: (t) => { T = clamp(+t || 0, 0, tl ? tl.dur : 0); dirty = true; },
  started,
};
