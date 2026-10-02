// main.js — Starward Belt page: wiring, URL hash, input, UI and frame loop.
//
// camera.js holds the view. overlay.js draws the SVG chart and reports hover
// and pick. engine.js draws the WebGPU field under it. generate.js makes a
// random map from a seed. This file owns the page state and the URL hash,
// turns input into camera moves, plots a course with route.js, and writes
// the title, the plate, the legend, the card, the toolbar, the rail
// scrubber, the zoom buttons and the help card.
//
// The hash holds the map and the animate switch: #seed=<code>&anim=1.
// No seed means the original Starward Belt map.
//
// Without WebGPU the page still works: the SVG overlay draws over the flat
// black stage and a short note shows in #fallback.
//
//   wheel          zoom at the cursor        shift + wheel, sideways scroll   slide along the belt
//   ctrl + wheel   zoom (trackpad pinch)     drag                             pan (the rail clamps it)
//   click two stations   plot a course       double-click                     focus a station, or zoom in
//   arrows, W S    slide and drift           + / -                            zoom
//   H home   R random map   O original map   A animate   ? help   Escape clear
//
// grep: function readHash  function writeHash  function makeMap  function swapTo  function applyMap
//       function randomize  function original  function setAnimate  function buildLegend  function showTitles
//       function goHome  function pick  function plot  function frameCourse  function renderCard
//       function buildScrub  function drawScrub  function onWheel  function toggleHelp  KEYS
//       function tick  function wake  function boot  window.snSaver

import { TIERS, STARWARD_MAP, indexMap } from './data.js';
import { createCamera } from './camera.js';
import { createOverlay } from './overlay.js';
import { cheapest } from './route.js';
import { generateMap, randomSeed } from './generate.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const canvas = $('field');
const svg = $('overlay');
const legend = $('legend');
const card = $('card');
const hint = $('hint');
const seedBtn = $('seed');
const helpCard = $('help');
const scrub = $('scrub');
const scrubTicks = $('scrub-ticks');
const scrubThumb = $('scrub-thumb');
const scrubTip = $('scrub-tip');
const btn = {
  random: $('btn-random'), original: $('btn-original'), anim: $('btn-anim'), help: $('btn-help'),
  zin: $('z-in'), zout: $('z-out'), zfit: $('z-fit'),
};

const SHORT = { none: 'None', haznav: 'Haznav', engine: 'Engine', spoof: 'Spoof' };
const DRAG_PX = 5;          // a press that moves more than this is a drag, not a click
const RING_PAD = 90;        // world units of margin around a framed course
const FADE_OUT = 180;       // ms, map swap: fade out, then swap, then fade in (CSS)
const ANIM_KEY = 'starward-belt:animate';
const FINE = matchMedia('(pointer: fine)');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');

const state = {
  hover: null,
  selected: [],
  path: null,
  tiers: new Set(TIERS.map((t) => t.id)),
  animate: false,
};

let map = null;               // the indexed map on show
let camera = null;
let overlay = null;
let field = null;
let dirty = true;             // the overlay needs a new layout
let sized = false;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

// ─── URL hash ───────────────────────────────────────────────────────────────
// A seed keeps letters and digits only, so the hash can not inject markup.
// generate.js reads a seed in upper case, so the hash does too.
function cleanSeed(s) {
  const v = (s || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 32).toUpperCase();
  return v || null;
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  return { seed: cleanSeed(p.get('seed')), anim: p.has('anim') ? p.get('anim') === '1' : null };
}

function hashFor(seed, anim) {
  const parts = [];
  if (seed) parts.push(`seed=${seed}`);
  if (anim) parts.push('anim=1');
  return parts.length ? `#${parts.join('&')}` : '';
}

// Write the hash for the current map and animate state. push = true adds a
// history entry (a map change). Otherwise the entry changes in place.
function writeHash(push) {
  const url = location.pathname + location.search + hashFor(map.seed, state.animate);
  if (url === location.pathname + location.search + location.hash) return;
  try {
    if (push) history.pushState(null, '', url); else history.replaceState(null, '', url);
  } catch { /* a sandboxed frame can refuse history writes */ }
}

// ─── maps ───────────────────────────────────────────────────────────────────
// The map for a seed, indexed. A seed that the generator refuses gives the
// original map.
function makeMap(seed) {
  let m = STARWARD_MAP;
  if (seed) {
    try { m = generateMap(seed); } catch (err) { console.warn('[starward-belt] seed refused:', seed, err); m = STARWARD_MAP; }
  }
  return m.NODE_BY_ID ? m : indexMap(m);
}

// Fade the map out, swap it, fade it in. A second swap during the fade wins.
let swapToken = 0;
let wanted = null;            // the seed on show or on its way (null = original)
function swapTo(seed) {
  const my = ++swapToken;
  wanted = seed || null;
  const next = makeMap(seed);
  document.body.classList.add('swapping');
  setTimeout(() => {
    if (my !== swapToken) return;
    applyMap(next);
    // Two frames: the first draws the new map under the veil.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (my === swapToken) document.body.classList.remove('swapping');
    }));
  }, FADE_OUT);
}

// Put a map on the page. Selection, course and hover reset. Tiers and the
// animate switch stay.
function applyMap(next) {
  map = next;
  state.hover = null;
  state.selected = [];
  state.path = null;
  camera.setRail(map.RAIL, map.NODES);
  overlay.setMap(map);
  field?.setMap(map);
  showTitles();
  buildScrub();
  dirty = true;
  goHome(true);
  sync();
}

function randomize() {
  let s = randomSeed();
  for (let i = 0; i < 4 && s === map.seed; i++) s = randomSeed();
  firstTouch();
  // The hashchange handler does the swap, so the back button works the same way.
  location.hash = hashFor(s, state.animate);
}

function original() {
  if (!map.seed) { goHome(); wake(); return; }
  firstTouch();
  const url = location.pathname + location.search + hashFor(null, state.animate);
  try { history.pushState(null, '', url); } catch { location.hash = hashFor(null, state.animate); }
  applyHash();
}

// Follow the hash: back, forward, a pasted link, or randomize().
function applyHash() {
  const h = readHash();
  if ((h.seed || null) !== wanted) swapTo(h.seed);
  // An anim part in the hash sets the switch. Without one, the switch stays
  // and the hash gets its anim part back.
  if (h.anim !== null && h.anim !== state.animate) setAnimate(h.anim);
  else if (h.anim === null && state.animate) writeHash(false);
}
window.addEventListener('hashchange', applyHash);
window.addEventListener('popstate', applyHash);

// ─── animate ────────────────────────────────────────────────────────────────
function storedAnimate() {
  try { const v = localStorage.getItem(ANIM_KEY); return v === null ? null : v === '1'; } catch { return null; }
}

function setAnimate(on) {
  state.animate = !!on;
  btn.anim.setAttribute('aria-pressed', String(state.animate));
  try { localStorage.setItem(ANIM_KEY, state.animate ? '1' : '0'); } catch { /* storage off */ }
  writeHash(false);
  sync();
}

// ─── titles ─────────────────────────────────────────────────────────────────
function showTitles() {
  const t = map.title;
  $('title-game').textContent = t.game;
  $('title-vector').textContent = t.vector;
  $('plate-top').textContent = t.plateTop;
  $('plate-name').textContent = t.plate;
  legend.setAttribute('aria-label', `${t.vector}: route tiers`);
  document.title = map.seed ? `${t.plate} · ${map.seed}` : 'Starward Belt';
  seedBtn.hidden = !map.seed;
  if (map.seed) { seedBtn.dataset.seed = map.seed; seedBtn.querySelector('b').textContent = map.seed; seedBtn.classList.remove('copied'); }
  btn.original.hidden = !map.seed;
}

async function copyLink() {
  const url = location.href;
  let ok = false;
  try { await navigator.clipboard.writeText(url); ok = true; } catch {
    const ta = document.createElement('textarea');
    ta.value = url; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  seedBtn.classList.toggle('copied', ok);
  seedBtn.querySelector('i').textContent = ok ? 'link copied' : 'copy failed';
  clearTimeout(copyLink.t);
  copyLink.t = setTimeout(() => { seedBtn.classList.remove('copied'); seedBtn.querySelector('i').textContent = 'copy link'; }, 1600);
}

// ─── legend ─────────────────────────────────────────────────────────────────
function buildLegend() {
  for (const t of TIERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tier';
    b.dataset.tier = t.id;
    b.style.setProperty('--c', t.color);
    b.setAttribute('aria-pressed', 'true');
    b.title = `Show or hide routes that need: ${t.label}`;
    b.innerHTML = `<span class="sw" aria-hidden="true"></span>` +
      `<span class="lab"><span class="full">${esc(t.label)}</span><span class="short">${SHORT[t.id] || esc(t.label)}</span></span>`;
    b.addEventListener('click', () => toggleTier(t.id));
    legend.append(b);
  }
}

function toggleTier(id) {
  if (state.tiers.has(id)) state.tiers.delete(id); else state.tiers.add(id);
  for (const b of legend.children) b.setAttribute('aria-pressed', String(state.tiers.has(b.dataset.tier)));
  plot(false);
}

// ─── selection and course ───────────────────────────────────────────────────
function hover(id) {
  if (state.hover === id) return;
  state.hover = id;
  sync();
}

// A pick fills selected[0], then selected[1]. A third pick starts over.
function pick(id) {
  if (dragged || !map.NODE_BY_ID[id]) return;
  pickedNow = true;
  const s = state.selected;
  if (s.includes(id)) return;
  state.selected = s.length === 1 ? [s[0], id] : [id];
  plot(true);
}

function clearSelection() {
  if (!state.selected.length) return;
  state.selected = [];
  plot(false);
}

// Recompute the course for the current selection and tiers.
function plot(frame) {
  const [a, b] = state.selected;
  state.path = a && b ? cheapest(map, a, b, state.tiers) : null;
  sync();
  if (frame && b) frameCourse(state.path ? state.path.nodes : [a, b]);
}

// Glide the camera so that the listed nodes fit in the part of the viewport
// that the legend and the card leave clear.
function frameCourse(ids) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) {
    const n = map.NODE_BY_ID[id];
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y);
  }
  const v = camera.view();
  const r = clearRect(v);
  const bw = x1 - x0 + 2 * RING_PAD, bh = y1 - y0 + 2 * RING_PAD;
  const z = clamp(Math.min(r.w / bw, r.h / bh) * 0.92, camera.fitZoom, camera.fitZoom * 3);
  // Put the course centre on the centre of the clear rect, not of the viewport.
  const ox = (r.x + r.w / 2 - v.w / 2) / z, oy = (r.y + r.h / 2 - v.h / 2) / z;
  camera.focus((x0 + x1) / 2 - ox, (y0 + y1) / 2 - oy, z);
  wake();
}

// The screen rect free of UI. On a phone the legend sits on top and the card
// spans the bottom. On a wide screen the legend and the card share a left column.
function clearRect(v) {
  const lg = legend.getBoundingClientRect();
  const cd = card.hidden ? null : card.getBoundingClientRect();
  if (v.w <= 600) {
    const top = lg.bottom + 8, bottom = cd ? cd.top : v.h;
    return { x: 0, y: top, w: v.w, h: Math.max(80, bottom - top) };
  }
  const left = Math.min(Math.max(lg.right, cd ? cd.right : 0) + 16, v.w * 0.4);
  return { x: left, y: 0, w: v.w - left, h: v.h };
}

// Home view. On a wide screen, move the belt right until the stations and
// labels in the rows of the legend clear it, but keep the belt on the screen.
// On a phone the legend is a row on top: move a random belt down until it
// clears the row, while the bottom of the belt stays on the screen. The
// original map keeps the home view of the first version.
function goHome(instant = false) {
  const v = camera.view();
  const R = map.RAIL;
  const home = { cx: (R.a.x + R.b.x) / 2, cy: (R.a.y + R.b.y) / 2, zoom: camera.fitZoom, w: v.w, h: v.h, fit: camera.fitZoom };
  const lg = legend.getBoundingClientRect();
  const all = overlay.extent(home);
  let sx = 0, sy = 0;
  if (v.w > 600) {
    const e = overlay.extent(home, [lg.top - 8, lg.bottom + 8]);
    // The scrubber and the zoom buttons take a strip on the right.
    const right = v.w - (scrubShown() ? 48 : 16);
    if (Number.isFinite(e.x0)) sx = Math.max(0, Math.min(lg.right + 16 - e.x0, right - all.x1));
  } else if (map.seed && Number.isFinite(all.y0)) {
    sy = Math.max(0, Math.min(lg.bottom + 6 - all.y0, v.h - 8 - all.y1));
  }
  camera.home(instant, sx, sy);
  wake();
}

function focusNode(id) {
  const n = map.NODE_BY_ID[id];
  camera.focus(n.x, n.y, camera.fitZoom * 2.6);
  wake();
}

// Push the state to the overlay and the card.
function sync() {
  overlay.setState({ hover: state.hover, selected: state.selected, path: state.path, tiers: state.tiers, animate: state.animate });
  renderCard();
  wake();
}

// ─── card ───────────────────────────────────────────────────────────────────
function costTag(tier, cost) {
  return `<span class="cost" style="--c:${map.TIER_BY_ID[tier].color}">-${cost}</span>`;
}

function stationCard(id, note) {
  const N = map.NODE_BY_ID;
  const n = N[id];
  const rows = map.ROUTES
    .filter((r) => r.from === id || r.to === id)
    .sort((p, q) => p.cost - q.cost)
    .map((r) => {
      const other = N[r.from === id ? r.to : r.from];
      const off = state.tiers.has(r.tier) ? '' : ' off';
      return `<div class="row${off}"><span class="to">› ${esc(other.name)}</span>${costTag(r.tier, r.cost)}</div>`;
    }).join('');
  return `<div class="kind">${n.size === 'l' ? 'Hub station' : 'Station'}</div>` +
    `<div class="name">${esc(n.name)}</div><div class="rows">${rows}</div>` +
    (note ? `<div class="note">${note}</div>` : '');
}

function courseCard() {
  const N = map.NODE_BY_ID;
  const [a, b] = state.selected;
  const p = state.path;
  const head = `<div class="kind">Plotted course</div>`;
  if (!p) {
    return head + `<div class="chain"><span>${esc(N[a].name)}</span> <i>›</i> <span>${esc(N[b].name)}</span></div>` +
      `<div class="none">No course — enable more upgrades</div>`;
  }
  const chain = p.nodes.map((id) => `<span>${esc(N[id].name)}</span>`).join(' <i>›</i> ');
  const legs = p.routes.map((ri, k) => {
    const r = map.ROUTES[ri];
    return `<div class="row"><span class="to">${esc(N[p.nodes[k]].name)} › ${esc(N[p.nodes[k + 1]].name)}</span>${costTag(r.tier, r.cost)}</div>`;
  }).join('');
  const used = TIERS.filter((t) => p.routes.some((ri) => map.ROUTES[ri].tier === t.id))
    .map((t) => `<span data-tier="${t.id}" style="--c:${t.color}">${esc(t.label)}</span>`).join('');
  return head + `<div class="chain">${chain}</div><div class="rows">${legs}</div>` +
    `<div class="total"><span>${p.routes.length} jump${p.routes.length === 1 ? '' : 's'}</span><b>-${p.cost}</b></div>` +
    `<div class="used">${used}</div>`;
}

function renderCard() {
  let html = '';
  if (state.hover && map.NODE_BY_ID[state.hover]) html = stationCard(state.hover);
  else if (state.selected.length === 2) html = courseCard();
  else if (state.selected.length === 1) html = stationCard(state.selected[0], 'Pick a destination');
  card.hidden = !html;
  // A hover readout can open under the cursor. It must not take the click.
  card.classList.toggle('passive', !!state.hover);
  if (html) card.innerHTML = html;
}

// ─── rail scrubber ──────────────────────────────────────────────────────────
// A vertical track for the belt from end to end. The end of the belt that is
// higher on the chart is at the top of the track. s is 0 at RAIL.a, 1 at RAIL.b.
function topIsB() { return map.RAIL.b.y <= map.RAIL.a.y; }
function sToFrac(s) { return topIsB() ? 1 - s : s; }
function fracToS(f) { return topIsB() ? 1 - f : f; }

// Position along the axis of a world point, as a fraction of the belt.
function sOf(x, y) {
  const ax = camera.axis, a = map.RAIL.a;
  return ((x - a.x) * ax.ux + (y - a.y) * ax.uy) / ax.len;
}

let ticks = [];
// A fixed element has no offsetParent, so ask the computed style.
function scrubShown() { return getComputedStyle(scrub).display !== 'none'; }

function buildScrub() {
  scrubTicks.textContent = '';
  ticks = map.NODES.map((n) => {
    const f = clamp(sToFrac(sOf(n.x, n.y)), 0, 1);
    const t = document.createElement('span');
    t.className = n.size === 'l' ? 'tick hub' : 'tick';
    t.style.top = `${(f * 100).toFixed(3)}%`;
    scrubTicks.append(t);
    return { f, name: n.name, el: t };
  });
}

// The thumb spans the part of the belt axis on the screen, measured along
// the line through the view centre.
function drawScrub(view) {
  if (!scrubShown()) return;
  const ax = camera.axis;
  const hw = view.w / 2 / view.zoom, hh = view.h / 2 / view.zoom;
  const tmax = Math.min(Math.abs(ax.ux) > 1e-6 ? hw / Math.abs(ax.ux) : Infinity, Math.abs(ax.uy) > 1e-6 ? hh / Math.abs(ax.uy) : Infinity);
  const sc = sOf(view.cx, view.cy), ds = tmax / ax.len;
  const f0 = clamp(sToFrac(sc - ds), 0, 1), f1 = clamp(sToFrac(sc + ds), 0, 1);
  const lo = Math.min(f0, f1), hi = Math.max(f0, f1);
  scrubThumb.style.top = `${(lo * 100).toFixed(3)}%`;
  scrubThumb.style.height = `${((hi - lo) * 100).toFixed(3)}%`;
}

// Glide the view centre along the axis to belt fraction f of the track.
function scrubTo(f) {
  const v = camera.view(), ax = camera.axis;
  const ds = fracToS(clamp(f, 0, 1)) - sOf(v.cx, v.cy);
  camera.focus(v.cx + ax.ux * ds * ax.len, v.cy + ax.uy * ds * ax.len);
  wake();
}

let scrubDrag = null;   // { off } fraction offset from the pointer to the thumb centre
function scrubFrac(e) {
  const r = scrubTicks.getBoundingClientRect();
  return (e.clientY - r.top) / Math.max(1, r.height);
}
scrub.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  firstTouch();
  const f = scrubFrac(e);
  const tr = scrubThumb.getBoundingClientRect(), r = scrubTicks.getBoundingClientRect();
  const mid = (tr.top + tr.height / 2 - r.top) / Math.max(1, r.height);
  // A press on the thumb drags it. A press on the track glides there first.
  const onThumb = e.clientY >= tr.top - 3 && e.clientY <= tr.bottom + 3;
  scrubDrag = { off: onThumb ? mid - f : 0 };
  scrub.setPointerCapture(e.pointerId);
  scrub.classList.add('active');
  if (!onThumb) scrubTo(f);
});
scrub.addEventListener('pointermove', (e) => {
  const f = scrubFrac(e);
  if (scrubDrag) { scrubTo(f + scrubDrag.off); showTip(null); return; }
  // Tooltip: the station tick nearest the pointer, within 7 px.
  const h = scrubTicks.getBoundingClientRect().height;
  let best = null, bd = 7;
  for (const t of ticks) { const d = Math.abs(t.f - f) * h; if (d < bd) { bd = d; best = t; } }
  showTip(best);
});
function endScrub() { scrubDrag = null; scrub.classList.remove('active'); }
scrub.addEventListener('pointerup', endScrub);
scrub.addEventListener('pointercancel', endScrub);
scrub.addEventListener('pointerleave', () => { if (!scrubDrag) showTip(null); });
scrub.addEventListener('wheel', (e) => onWheel(e), { passive: false });

function showTip(t) {
  for (const k of ticks) k.el.classList.toggle('hot', k === t);
  if (!t) { scrubTip.hidden = true; return; }
  scrubTip.textContent = t.name;
  scrubTip.style.top = `${(t.f * 100).toFixed(3)}%`;
  scrubTip.hidden = false;
}

// ─── pointer input ──────────────────────────────────────────────────────────
const pointers = new Map();
let pinch = 0, downAt = null, dragged = false, pickedNow = false;

function firstTouch() { hint.classList.add('gone'); }

// Capture phase: runs before the overlay sees the press.
stage.addEventListener('pointerdown', (e) => {
  firstTouch();
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) { downAt = { x: e.clientX, y: e.clientY }; dragged = false; pickedNow = false; }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = Math.hypot(a.x - b.x, a.y - b.y);
    dragged = true;
  }
}, true);

stage.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  if (e.pointerType === 'mouse' && e.buttons === 0) { endPointer(e); return; }
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (!dragged && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > DRAG_PX) {
    dragged = true;
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('dragging');
  }
  if (!dragged) return;
  if (pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch > 0 && d > 0) camera.zoomAt(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
    pinch = d;
  } else {
    camera.panBy(dx, dy);
  }
  wake();
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = 0;
  if (!pointers.size) stage.classList.remove('dragging');
}
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);

// A click after a drag must not pick. Capture phase stops it before the overlay.
stage.addEventListener('click', (e) => { if (dragged) e.stopPropagation(); }, true);
// A click on empty map clears the course. The overlay sets pickedNow on a station.
stage.addEventListener('click', () => {
  if (!dragged && !pickedNow) clearSelection();
  pickedNow = false;
});

// Double-click: on a station, focus it. On empty map, zoom in there.
stage.addEventListener('dblclick', (e) => {
  const id = nearestStation(e.clientX, e.clientY);
  if (id) focusNode(id);
  else { camera.zoomAt(2, e.clientX, e.clientY); wake(); }
});

// The station whose disc is under a screen point, from the camera alone.
function nearestStation(sx, sy) {
  let best = null, bestD = Infinity;
  for (const n of map.NODES) {
    const s = camera.toScreen(n.x, n.y);
    const d = Math.hypot(s.x - sx, s.y - sy);
    if (d < bestD) { bestD = d; best = n.id; }
  }
  const r = Math.max(22, 40 * camera.view().zoom);
  return bestD <= r ? best : null;
}

// Wheel, the map way. A vertical wheel zooms at the cursor. Shift + wheel,
// or a sideways trackpad scroll, slides along the belt. Ctrl + wheel is a
// trackpad pinch and zooms too.
function onWheel(e) {
  e.preventDefault();
  firstTouch();
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? camera.view().h : 1;
  const dy = e.deltaY * unit, dx = e.deltaX * unit;
  const v = camera.view(), ax = camera.axis;
  const perPx = 1 / (v.zoom * ax.len);           // belt fraction per screen px
  // Screen-down along the belt: the sign that moves s toward the lower end.
  const down = ax.uy >= 0 ? 1 : -1, right = ax.ux >= 0 ? 1 : -1;
  const inStage = e.currentTarget === stage;
  const cx = inStage ? e.clientX : v.w / 2, cy = inStage ? e.clientY : v.h / 2;
  if (e.ctrlKey) {
    camera.zoomAt(Math.exp(-clamp(dy, -50, 50) * 0.012), cx, cy);
  } else if (e.shiftKey) {
    // Chrome turns shift + wheel into deltaX. Down or right goes to the lower end.
    const d = dy || dx;
    camera.slide(down * d * perPx);
  } else if (Math.abs(dx) > Math.abs(dy)) {
    camera.slide(right * dx * perPx);
  } else if (!inStage) {
    camera.slide(down * dy * perPx);
  } else {
    camera.zoomAt(Math.exp(-clamp(dy, -120, 120) * 0.0022), cx, cy);
  }
  wake();
}
stage.addEventListener('wheel', onWheel, { passive: false });

// Safari sends gesture events for a trackpad pinch.
let gestureScale = 1;
stage.addEventListener('gesturestart', (e) => { e.preventDefault(); gestureScale = 1; });
stage.addEventListener('gesturechange', (e) => {
  e.preventDefault();
  camera.zoomAt(e.scale / gestureScale, e.clientX, e.clientY);
  gestureScale = e.scale;
  wake();
});

// ─── buttons ────────────────────────────────────────────────────────────────
function zoomBy(f) {
  const v = camera.view();
  camera.zoomAt(f, v.w / 2, v.h / 2);
  firstTouch();
  wake();
}

function toggleHelp(open = helpCard.hidden) {
  helpCard.hidden = !open;
  btn.help.setAttribute('aria-expanded', String(open));
  if (open) firstTouch();
}

btn.random.addEventListener('click', randomize);
btn.original.addEventListener('click', original);
btn.anim.addEventListener('click', () => setAnimate(!state.animate));
btn.help.addEventListener('click', () => toggleHelp());
btn.zin.addEventListener('click', () => zoomBy(1.4));
btn.zout.addEventListener('click', () => zoomBy(1 / 1.4));
btn.zfit.addEventListener('click', () => { firstTouch(); goHome(); });
seedBtn.addEventListener('click', copyLink);
$('help-close').addEventListener('click', () => toggleHelp(false));

// ─── keys ───────────────────────────────────────────────────────────────────
// KEYS  A toggles animate, so the drift keys are the side arrows only.
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return;
  const v = camera.view();
  const step = 0.06 * camera.fitZoom / v.zoom;
  const down = camera.axis.uy >= 0 ? 1 : -1;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  if (k === 'arrowup' || k === 'w') camera.slide(-down * step);
  else if (k === 'arrowdown' || k === 's') camera.slide(down * step);
  else if (k === 'arrowleft') camera.panBy(80, 0);
  else if (k === 'arrowright') camera.panBy(-80, 0);
  else if (k === '+' || k === '=') camera.zoomAt(1.25, v.w / 2, v.h / 2);
  else if (k === '-' || k === '_') camera.zoomAt(1 / 1.25, v.w / 2, v.h / 2);
  else if (k === 'h') goHome();
  else if (k === 'r') randomize();
  else if (k === 'o') original();
  else if (k === 'a') setAnimate(!state.animate);
  else if (k === '?' || k === '/') toggleHelp();
  else if (k === 'escape') {
    if (!helpCard.hidden) toggleHelp(false);
    else { clearSelection(); if (state.hover) hover(null); }
  } else return;
  // Enter and space on a focused button stay with the button.
  e.preventDefault();
  firstTouch();
  wake();
});

// ─── size ───────────────────────────────────────────────────────────────────
function applySize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  camera.resize(w, h);
  if (!sized) { goHome(true); sized = true; }
  field?.resize(w, h, window.devicePixelRatio || 1);
  dirty = true;
  wake();
}

// ─── frame loop ─────────────────────────────────────────────────────────────
// The loop runs every frame while the field is live (it drifts slowly) and
// otherwise only while the camera moves. It stops when the tab is hidden.
let raf = 0, last = 0, lastKey = '';
const t0 = performance.now();

function wake() {
  if (!raf && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(tick); }
}

function tick(now) {
  raf = 0;
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const moving = camera.step(saver ? dt * saver.camRate : dt);
  const view = camera.view();
  // Any change of view, eased or instant, gets a new overlay layout.
  const key = `${view.cx} ${view.cy} ${view.zoom} ${view.w} ${view.h}`;
  if (dirty || key !== lastKey) { overlay.update(view); drawScrub(view); dirty = false; lastKey = key; }
  if (field) {
    const h = state.hover && map.NODE_BY_ID[state.hover];
    field.render(view, (now - t0) / 1000, { hover: h ? { x: h.x, y: h.y } : null, animate: state.animate });
  }
  if (field || moving) raf = requestAnimationFrame(tick);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else wake();
});

// ─── boot ───────────────────────────────────────────────────────────────────
function showFallback(msg) {
  stage.classList.add('nogpu');
  const fb = $('fallback');
  fb.textContent = msg;
  fb.hidden = false;
}

function showHint() {
  hint.textContent = FINE.matches
    ? 'scroll to zoom · shift-scroll or drag to slide · click two stations to plot a course · ? help'
    : 'drag to slide the belt · pinch to zoom · tap two stations to plot a course';
}

async function boot() {
  const h = readHash();
  // Animate: the hash wins, then the stored choice. Reduced motion keeps
  // the stored choice off, so only an explicit hash or click turns it on.
  const stored = REDUCED.matches ? null : storedAnimate();
  state.animate = h.anim ?? stored ?? false;
  btn.anim.setAttribute('aria-pressed', String(state.animate));
  if (REDUCED.matches) btn.anim.title = 'Animate (A). Off by default: your system asks for reduced motion.';

  map = makeMap(h.seed);
  wanted = map.seed || null;
  camera = createCamera(map.RAIL, map.NODES);
  overlay = createOverlay(svg, map, { onHover: hover, onPick: pick });
  buildLegend();
  showTitles();
  showHint();
  buildScrub();
  new ResizeObserver(applySize).observe(stage);
  writeHash(false);
  sync();
  try {
    const { createField } = await import('./engine.js');
    const shown = map;
    field = await createField(canvas, map);
    if (map !== shown) field.setMap(map);
    field.resize(stage.clientWidth, stage.clientHeight, window.devicePixelRatio || 1);
    wake();
  } catch (err) {
    console.warn('[starward-belt] field off:', err);
    field = null;
    showFallback(`${err && err.message ? err.message : 'WebGPU is not available.'} The chart still works without the dust field.`);
  }
}

// ─── screensaver ────────────────────────────────────────────────────────────
// Shell saver hook (lib/screensaver.js). enter() hides every control, turns
// on the drift without a hash or storage write, and picks the map from
// opts.seed (the original map or one seeded random map, swapped once). The
// autopilot then plots a course between two seeded stations, glides to it,
// holds, clears it and glides back home, three or four times per dwell. The
// camera eases at a fraction of its normal rate (calm 1 = slowest).
// Recording: the chart is SVG over the WebGPU field, so a hidden 2D canvas
// (#saver-rec) composes both. Each frame draws the field and the last SVG
// snapshot (serialized to an image) into it. Labels in that snapshot use a
// fallback font, because an SVG image can not load the page font.
let saver = null;
window.snSaver = {
  enter(opts) {
    const calm = clamp(+opts.calm || 0, 0, 1);
    let seed = (opts.seed >>> 0) || 1;
    const rng = () => { seed = (seed + 0x6D2B79F5) >>> 0; let x = Math.imul(seed ^ seed >>> 15, 1 | seed); x ^= x + Math.imul(x ^ x >>> 7, 61 | x); return ((x ^ x >>> 14) >>> 0) / 4294967296; };
    saver = { camRate: 0.3 - 0.18 * calm };
    const st = document.createElement('style');
    st.textContent = '#title,#legend,#toolbar,#zoom,#scrub,#card,#hint,#help,#fallback,#plate{display:none!important}.stage{cursor:none!important}';
    document.head.append(st);
    toggleHelp(false);
    state.animate = true;
    state.hover = null;
    if (rng() < 0.7) { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let code = ''; for (let i = 0; i < 6; i++) code += A[(rng() * A.length) | 0]; swapTo(code); }
    else { state.selected = []; state.path = null; sync(); goHome(); }
    // Autopilot: one course per period, held for 65 percent of it.
    const period = Math.max(10, (+opts.seconds || 60) / 3.5) * 1000 * (1 + 0.3 * calm);
    let next = performance.now() + 2500, shown = false;
    // The plate: the map on screen (its own title and seed) and, while a
    // course is held, the course as the card shows it: the chain of
    // stations, the jumps, the fuel total and the tiers it needs. The
    // equation is the relaxation step of cheapest() in route.js.
    let lastPlate = 0;
    const plate = (now) => {
      if (!opts.label || !map || now - lastPlate < 1000) return;
      lastPlate = now;
      const t = map.title, N = map.NODE_BY_ID, p = state.path, [a, b] = state.selected;
      const lines = [];
      if (a && b && p) {
        lines.push('Course: ' + p.nodes.map((id) => N[id].name).join(' › '));
        lines.push(`${p.routes.length} jump${p.routes.length === 1 ? '' : 's'} · fuel −${p.cost}` + (p.routes.length > 1 ? ' = −(' + p.routes.map((ri) => map.ROUTES[ri].cost).join(' + ') + ')' : ''));
        lines.push('Needs: ' + TIERS.filter((x) => p.routes.some((ri) => map.ROUTES[ri].tier === x.id)).map((x) => x.label).join(', '));
      } else if (a && b) lines.push(`Course: ${N[a].name} › ${N[b].name} · no course under these tiers`);
      else lines.push(`${map.NODES.length} stations · ${map.ROUTES.length} routes · ${TIERS.length} tiers`);
      lines.push('Tiers: ' + TIERS.map((x) => x.label).join(' · '));
      opts.label({
        title: t.plate,
        sub: `${t.game} · ${t.vector}${map.seed && !t.game.includes(map.seed) ? ' · seed ' + map.seed : ''}`,
        lines,
        eq: ['cost(v) = min over u ( cost(u) + c(u,v) )', 'Dijkstra; on a tie, fewer jumps wins'],
      });
    };
    const auto = (now) => {
      if (!document.body.classList.contains('swapping')) plate(now);
      if (now >= next && map && map.NODES.length > 1 && !document.body.classList.contains('swapping')) {
        if (!shown) {
          const N = map.NODES, a = N[(rng() * N.length) | 0].id;
          let b = a;
          for (let i = 0; i < 8 && b === a; i++) b = N[(rng() * N.length) | 0].id;
          state.selected = [a, b]; plot(true); lastPlate = 0;
          next = now + period * 0.65;
        } else { clearSelection(); goHome(); lastPlate = 0; next = now + period * 0.35; }
        shown = !shown;
      }
      wake();
      compose();
      requestAnimationFrame(auto);
    };
    // Recorder canvas: opaque, the size of the field buffer.
    const rec = document.createElement('canvas');
    rec.id = 'saver-rec';
    rec.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;opacity:0;pointer-events:none;z-index:-1';
    document.body.append(rec);
    const g = rec.getContext('2d', { alpha: false });
    const ser = new XMLSerializer();
    let snap = null, busy = false;
    function grab() {
      busy = true;
      svg.setAttribute('width', stage.clientWidth); svg.setAttribute('height', stage.clientHeight);
      const url = URL.createObjectURL(new Blob([ser.serializeToString(svg)], { type: 'image/svg+xml' }));
      const im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); snap = im; busy = false; };
      im.onerror = () => { URL.revokeObjectURL(url); busy = false; };
      im.src = url;
    }
    function compose() {
      const dpr = window.devicePixelRatio || 1;
      const w = field ? canvas.width : Math.round(stage.clientWidth * dpr), h = field ? canvas.height : Math.round(stage.clientHeight * dpr);
      if (rec.width !== w || rec.height !== h) { rec.width = w; rec.height = h; }
      g.fillStyle = '#0b0b0b'; g.fillRect(0, 0, w, h);
      if (document.body.classList.contains('swapping')) return;
      if (field) g.drawImage(canvas, 0, 0, w, h);
      if (snap) g.drawImage(snap, 0, 0, w, h);
      if (!busy) grab();
    }
    requestAnimationFrame(auto);
    return { canvas: rec, warmupMs: 2000 };
  },
};

window.__sb = {
  get camera() { return camera; }, get map() { return map; }, state,
  get overlay() { return overlay; }, pick, wake, home: goHome, randomize, original, setAnimate, toggleHelp,
  get field() { return field; }, get input() { return { pointers: pointers.size, dragged, pickedNow }; },
};
boot();
