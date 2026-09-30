// main.js — Starward Belt page: wiring, input, legend, card and frame loop.
//
// camera.js holds the view. overlay.js draws the SVG chart and reports hover
// and pick. engine.js draws the WebGPU field under it. This file owns the
// page state, turns input into camera moves, plots a course with route.js,
// and writes the legend and the readout card.
//
// Without WebGPU the page still works: the SVG overlay draws over the flat
// black stage and a short note shows in #fallback.
//
//   wheel        slide along the belt           ctrl + wheel, pinch   zoom
//   drag         pan (the rail clamps it)       click two stations    plot a course
//   arrows, WASD slide and drift                + / -                 zoom
//   H            home                           Escape                clear the course
//
// grep: function buildLegend  function goHome  function pick  function plot  function frameCourse  function renderCard  function tick  function wake  KEYS

import { TIERS, ROUTES, NODE_BY_ID, TIER_BY_ID, RAIL } from './data.js';
import { createCamera, AXIS } from './camera.js';
import { createOverlay } from './overlay.js';
import { cheapest } from './route.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const canvas = $('field');
const svg = $('overlay');
const legend = $('legend');
const card = $('card');
const hint = $('hint');

const SHORT = { none: 'None', haznav: 'Haznav', engine: 'Engine', spoof: 'Spoof' };
const DRAG_PX = 5;          // a press that moves more than this is a drag, not a click
const RING_PAD = 90;        // world units of margin around a framed course

const state = {
  hover: null,
  selected: [],
  path: null,
  tiers: new Set(TIERS.map((t) => t.id)),
};

const camera = createCamera();
const overlay = createOverlay(svg, { onHover: hover, onPick: pick });
let field = null;
let dirty = true;             // the overlay needs a new layout
let sized = false;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

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
  if (dragged || !NODE_BY_ID[id]) return;
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
  state.path = a && b ? cheapest(a, b, state.tiers) : null;
  sync();
  if (frame && b) frameCourse(state.path ? state.path.nodes : [a, b]);
}

// Glide the camera so that the listed nodes fit in the part of the viewport
// that the legend and the card leave clear.
function frameCourse(ids) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) {
    const n = NODE_BY_ID[id];
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
function goHome(instant = false) {
  const v = camera.view();
  let sx = 0;
  if (v.w > 600) {
    const home = { cx: (RAIL.a.x + RAIL.b.x) / 2, cy: (RAIL.a.y + RAIL.b.y) / 2, zoom: camera.fitZoom, w: v.w, h: v.h };
    const lg = legend.getBoundingClientRect();
    const e = overlay.extent(home, [lg.top - 8, lg.bottom + 8]);
    const all = overlay.extent(home);
    sx = Math.max(0, Math.min(lg.right + 16 - e.x0, v.w - 16 - all.x1));
  }
  camera.home(instant, sx, 0);
}

function focusNode(id) {
  const n = NODE_BY_ID[id];
  camera.focus(n.x, n.y, camera.fitZoom * 2.6);
  wake();
}

// Push the state to the overlay and the card.
function sync() {
  overlay.setState({ hover: state.hover, selected: state.selected, path: state.path, tiers: state.tiers });
  renderCard();
  wake();
}

// ─── card ───────────────────────────────────────────────────────────────────
function costTag(tier, cost) {
  return `<span class="cost" style="--c:${TIER_BY_ID[tier].color}">-${cost}</span>`;
}

function stationCard(id, note) {
  const n = NODE_BY_ID[id];
  const rows = ROUTES
    .filter((r) => r.from === id || r.to === id)
    .sort((p, q) => p.cost - q.cost)
    .map((r) => {
      const other = NODE_BY_ID[r.from === id ? r.to : r.from];
      const off = state.tiers.has(r.tier) ? '' : ' off';
      return `<div class="row${off}"><span class="to">› ${esc(other.name)}</span>${costTag(r.tier, r.cost)}</div>`;
    }).join('');
  return `<div class="kind">${n.size === 'l' ? 'Hub station' : 'Station'}</div>` +
    `<div class="name">${esc(n.name)}</div><div class="rows">${rows}</div>` +
    (note ? `<div class="note">${note}</div>` : '');
}

function courseCard() {
  const [a, b] = state.selected;
  const p = state.path;
  const head = `<div class="kind">Plotted course</div>`;
  if (!p) {
    return head + `<div class="chain"><span>${esc(NODE_BY_ID[a].name)}</span> <i>›</i> <span>${esc(NODE_BY_ID[b].name)}</span></div>` +
      `<div class="none">No course — enable more upgrades</div>`;
  }
  const chain = p.nodes.map((id) => `<span>${esc(NODE_BY_ID[id].name)}</span>`).join(' <i>›</i> ');
  const legs = p.routes.map((ri, k) => {
    const r = ROUTES[ri];
    return `<div class="row"><span class="to">${esc(NODE_BY_ID[p.nodes[k]].name)} › ${esc(NODE_BY_ID[p.nodes[k + 1]].name)}</span>${costTag(r.tier, r.cost)}</div>`;
  }).join('');
  const used = TIERS.filter((t) => p.routes.some((ri) => ROUTES[ri].tier === t.id))
    .map((t) => `<span data-tier="${t.id}" style="--c:${t.color}">${esc(t.label)}</span>`).join('');
  return head + `<div class="chain">${chain}</div><div class="rows">${legs}</div>` +
    `<div class="total"><span>${p.routes.length} jump${p.routes.length === 1 ? '' : 's'}</span><b>-${p.cost}</b></div>` +
    `<div class="used">${used}</div>`;
}

function renderCard() {
  let html = '';
  if (state.hover) html = stationCard(state.hover);
  else if (state.selected.length === 2) html = courseCard();
  else if (state.selected.length === 1) html = stationCard(state.selected[0], 'Pick a destination');
  card.hidden = !html;
  // A hover readout can open under the cursor. It must not take the click.
  card.classList.toggle('passive', !!state.hover);
  if (html) card.innerHTML = html;
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

stage.addEventListener('dblclick', (e) => {
  const id = nearestStation(e.clientX, e.clientY);
  if (id) focusNode(id);
});

// The station whose disc is under a screen point, from the camera alone.
function nearestStation(sx, sy) {
  let best = null, bestD = Infinity;
  for (const id in NODE_BY_ID) {
    const n = NODE_BY_ID[id];
    const s = camera.toScreen(n.x, n.y);
    const d = Math.hypot(s.x - sx, s.y - sy);
    if (d < bestD) { bestD = d; best = id; }
  }
  const r = Math.max(22, 40 * camera.view().zoom);
  return bestD <= r ? best : null;
}

// Wheel: slide along the belt. Scroll down goes toward the lower end of the
// belt, like reading down the chart. Ctrl + wheel (and trackpad pinch) zooms.
stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  firstTouch();
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? camera.view().h : 1;
  const dy = e.deltaY * unit, dx = e.deltaX * unit;
  if (e.ctrlKey) {
    camera.zoomAt(Math.exp(-clamp(dy, -60, 60) * 0.008), e.clientX, e.clientY);
  } else {
    camera.slide(-dy / (camera.view().zoom * AXIS.len));
    if (dx) camera.panBy(-dx, 0);
  }
  wake();
}, { passive: false });

// Safari sends gesture events for a trackpad pinch.
let gestureScale = 1;
stage.addEventListener('gesturestart', (e) => { e.preventDefault(); gestureScale = 1; });
stage.addEventListener('gesturechange', (e) => {
  e.preventDefault();
  camera.zoomAt(e.scale / gestureScale, e.clientX, e.clientY);
  gestureScale = e.scale;
  wake();
});

// ─── keys ───────────────────────────────────────────────────────────────────
// KEYS
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const v = camera.view();
  const step = 0.06 * camera.fitZoom / v.zoom;
  const k = e.key.toLowerCase();
  if (k === 'arrowup' || k === 'w') camera.slide(step);
  else if (k === 'arrowdown' || k === 's') camera.slide(-step);
  else if (k === 'arrowleft' || k === 'a') camera.panBy(80, 0);
  else if (k === 'arrowright' || k === 'd') camera.panBy(-80, 0);
  else if (k === '+' || k === '=') camera.zoomAt(1.25, v.w / 2, v.h / 2);
  else if (k === '-' || k === '_') camera.zoomAt(1 / 1.25, v.w / 2, v.h / 2);
  else if (k === 'h') goHome();
  else if (k === 'escape') { clearSelection(); if (state.hover) hover(null); }
  else return;
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
new ResizeObserver(applySize).observe(stage);

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
  const moving = camera.step(dt);
  const view = camera.view();
  // Any change of view, eased or instant, gets a new overlay layout.
  const key = `${view.cx} ${view.cy} ${view.zoom} ${view.w} ${view.h}`;
  if (dirty || key !== lastKey) { overlay.update(view); dirty = false; lastKey = key; }
  if (field) {
    const h = state.hover && NODE_BY_ID[state.hover];
    field.render(view, (now - t0) / 1000, { hover: h ? { x: h.x, y: h.y } : null });
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

async function boot() {
  buildLegend();
  sync();
  try {
    const { createField } = await import('./engine.js');
    field = await createField(canvas);
    field.resize(stage.clientWidth, stage.clientHeight, window.devicePixelRatio || 1);
    wake();
  } catch (err) {
    console.warn('[starward-belt] field off:', err);
    field = null;
    showFallback(`${err && err.message ? err.message : 'WebGPU is not available.'} The chart still works without the dust field.`);
  }
}

window.__sb = { camera, state, overlay, pick, wake, home: goHome, get field() { return field; }, get input() { return { pointers: pointers.size, dragged, pickedNow }; } };
boot();
