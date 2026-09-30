// main.js — SDF Clouds page: panel, views, camera input and frame loop.
//
// The GPU work lives in engine.js; the control list lives in params.js. This
// file builds the panel from params.GROUPS, keeps the state object, lays out
// one, two or four views, and calls engine.frame() once per animation frame.
//
// Swap passes fast: every view label holds a pass <select>. A click on a view
// gives it focus; the keys then act on the focused view.
//
//   1..9, 0    set pass 1..10 on the focused view     [ ]   previous / next pass
//   Tab        focus the next view                     L     cycle 1 / 2 / 4 views
//   B          baked light on / off                    S     SDF skip on / off
//   Space      pause time                              P     panel on / off
//
// The motion groups animate the state. tick() hands animate(state, time) and
// animateCam(cam, ...) to the engine; the panel, the hash and the keys keep
// the base values. Space stops the clock, so every motion stops with it.
//
// The URL hash keeps the layout, the passes and every control that differs
// from its default, so a link reopens the same study.
//
// grep: function buildPanel  function buildViews  function viewRects  function tick  KEYS

import { loadShaders } from '../../lib/shaders.js';
import { createEngine } from './engine.js';
import { GROUPS, PASSES, CONTROLS, RECIPES, MOTION_IDS, defaults, dims, animate, animateCam } from './params.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const canvas = $('gl');
const viewsEl = $('views');
const panel = $('panel');
const pbody = $('pbody');
const hud = $('hud');

const CAM_PRESETS = {
  Ground: { az: 120, el: -10, dist: 9, target: [0, 2.6, 0] },
  Side: { az: 120, el: 3, dist: 17, target: [0, 2.5, 0] },
  Above: { az: 150, el: 55, dist: 16, target: [0, 2.0, 0] },
  Inside: { az: 60, el: 0, dist: 2.2, target: [0, 2.6, 0] },
};
const DEFAULT_PASSES = [0, 3, 5, 8];
const LEGENDS = {
  steps: () => `0 → ${state.heatMax} samples`,
  steplen: () => `min step → ${state.sdfClamp} (log)`,
  depth: () => 'near → 30 units',
  optical: () => 'τ 0 → ~10',
  slice: () => `y = ${(1 + 3 * state.sliceY).toFixed(2)}`,
  seeds: () => `y = ${(1 + 3 * state.sliceY).toFixed(2)}`,
};

let state = defaults();
let cam = structuredClone(CAM_PRESETS.Ground);
let layout = 4;
let passes = [...DEFAULT_PASSES];
let focus = 0;
let savedTimeScale = 1;
readHash();

// ─── panel ──────────────────────────────────────────────────────────────────
const inputs = {};

function fmt(c, v) {
  if (c.fmt === 'deg') return `${Math.round(v)}°`;
  if (c.step >= 1) return String(Math.round(v));
  const d = c.step < 0.01 ? 3 : 2;
  return Number(v).toFixed(d);
}

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const k of kids) e.append(k);
  return e;
}

function section(id, title, open, ...kids) {
  const s = el('section', { class: open ? '' : 'closed', 'data-g': id });
  const h = el('h2', {}, el('button', { type: 'button', onclick: () => s.classList.toggle('closed') }, title));
  s.append(h, el('div', { class: 'body' }, ...kids));
  return s;
}

function controlRow(c) {
  const row = el('div', { class: 'ctl', title: `${c.tip || ''}${c.tip ? '\n' : ''}Double-click to reset.` });
  row.append(el('span', { class: 'k' }, c.label));
  let set;
  if (c.type === 'range') {
    const inp = el('input', { type: 'range', min: c.min, max: c.max, step: c.step, 'aria-label': c.label });
    const out = el('output');
    inp.addEventListener('input', () => setValue(c.id, Number(inp.value)));
    row.append(inp, out);
    set = (v) => { inp.value = v; out.textContent = fmt(c, v); };
  } else if (c.type === 'toggle') {
    const b = el('button', { type: 'button', class: 'sw' });
    b.addEventListener('click', () => setValue(c.id, !state[c.id]));
    row.append(b);
    set = (v) => { b.classList.toggle('on', !!v); b.textContent = v ? 'on' : 'off'; };
  } else {
    const s = el('select', { 'aria-label': c.label });
    c.options.forEach((o, i) => s.append(el('option', { value: i }, o)));
    s.addEventListener('change', () => setValue(c.id, Number(s.value)));
    row.append(s);
    set = (v) => { s.value = v; };
  }
  row.addEventListener('dblclick', () => setValue(c.id, c.value));
  inputs[c.id] = (v) => { set(v); row.classList.toggle('changed', v !== c.value); };
  inputs[c.id](state[c.id]);
  return row;
}

function setValue(id, v) {
  state[id] = v;
  inputs[id]?.(v);
  if (id === 'timeScale' && v > 0) savedTimeScale = v;
  refreshLegends();
  writeHash();
}

let passInfo, viewSlots, statsEl, layoutBtns;

function buildPanel() {
  layoutBtns = [1, 2, 4].map((n) => el('button', { type: 'button', onclick: () => setLayout(n) }, `${n} view${n > 1 ? 's' : ''}`));
  viewSlots = el('div');
  passInfo = el('p', { class: 'spec' });
  const keys = el('p', { class: 'spec' });
  pbody.append(section('views', 'Views', true, el('div', { class: 'buttons' }, ...layoutBtns), viewSlots, passInfo, keys));
  keys.innerHTML =
    '<kbd>1</kbd>–<kbd>0</kbd> pass · <kbd>[</kbd> <kbd>]</kbd> cycle · <kbd>Tab</kbd> next view · ' +
    '<kbd>L</kbd> layout · <kbd>B</kbd> baked light · <kbd>S</kbd> SDF skip · <kbd>Space</kbd> pause · <kbd>P</kbd> panel';

  for (const g of GROUPS) {
    const rows = g.controls.map(controlRow);
    const extra = [];
    if (g.id === 'shape') {
      extra.push(el('div', { class: 'buttons' },
        el('button', { type: 'button', onclick: () => setValue('seed', Math.floor(Math.random() * 100)) }, 'New seed'),
        el('button', { type: 'button', onclick: () => engine?.invalidate() }, 'Rebake')));
    }
    if (g.id === 'motion') {
      extra.push(el('div', { class: 'buttons' }, ...Object.keys(RECIPES).map((k) =>
        el('button', { type: 'button', title: `Motion recipe: ${k}`, onclick: () => applyRecipe(k) }, k))));
    }
    if (g.id === 'camera') {
      extra.push(el('div', { class: 'buttons' }, ...Object.keys(CAM_PRESETS).map((k) =>
        el('button', { type: 'button', onclick: () => { cam = structuredClone(CAM_PRESETS[k]); writeHash(); } }, k))));
    }
    pbody.append(section(g.id, g.title, g.id === 'shape' || g.id === 'march' || g.id === 'motion', ...rows, ...extra));
  }

  statsEl = el('div', { class: 'stats' });
  pbody.append(section('pipe', 'Pipeline', true, statsEl,
    el('div', { class: 'buttons' },
      el('button', { type: 'button', onclick: resetAll }, 'Reset all'),
      el('button', { type: 'button', onclick: copyLink }, 'Copy link'))));

  const about = section('about', 'Core idea', false);
  about.querySelector('.body').innerHTML = `
    <p class="spec">Port of <a href="https://github.com/X13-A/SDF-clouds" target="_blank" rel="noopener">SDF Clouds</a>
    (Alex Foulon) to WebGPU. Four ideas carry it:</p>
    <p class="spec"><b>1. Voxel shape to SDF.</b> The cloud shape is a voxel volume. A bake turns it into a signed
    distance field. Upstream does a radius search; here a 3D jump flood finds each voxel's nearest sub-voxel
    zero crossing in log2 N + 1 passes. See the <code>SDF slice</code> and <code>JFA seed vectors</code> passes.</p>
    <p class="spec"><b>2. Sphere-march the air.</b> Outside a cloud the view ray steps by the SDF value, which can
    never cross a surface. Inside, it takes fixed steps and applies Beer's law per step. Toggle <code>SDF skip</code>
    and watch <code>Step cost</code>.</p>
    <p class="spec"><b>3. Bake T_light.</b> One secondary ray per voxel of a transmittance volume, not one per view
    sample. A pixel costs O(N), not O(N × M). Toggle <code>Baked light</code> to pay the nested march.</p>
    <p class="spec"><b>4. Detail only where it shows.</b> A tiling Worley texture erodes density only in a thin band
    under the surface, so the extra sample costs only on the edges. Fog is a second medium in the same march, and
    points outside the volume project toward the sun onto it for shafts and ground shadows.</p>
    <p class="spec">Changes from upstream: jump flood instead of radius search; an energy-conserving
    (1 − e<sup>−σΔs</sup>) scatter term; powder from local depth, applied in the view march.</p>
    <p class="spec"><b>Motion has three cost tiers.</b> Erosion wind, boil, lightning, fog pulse and the camera
    change only the uniform. Sun, breathe and density pulse rerun the light bake every frame. Drift, rise,
    morph and grow move the shape itself, so they rerun shape + JFA + light at <code>Shape bakes/s</code>.
    Watch <code>Last bake</code> in the Pipeline section.</p>`;
  pbody.append(about);
}

function applyRecipe(name) {
  for (const id of MOTION_IDS) setValue(id, CONTROLS[id].value);
  for (const [id, v] of Object.entries(RECIPES[name])) setValue(id, v);
  if (state.timeScale === 0) setValue('timeScale', savedTimeScale);
}

function refreshPanelViews() {
  layoutBtns.forEach((b, i) => b.classList.toggle('on', [1, 2, 4][i] === layout));
  viewSlots.replaceChildren(...[...Array(layout)].map((_, i) => {
    const s = passSelect(i);
    return el('div', { class: 'ctl', title: 'Pass of this view' }, el('span', { class: 'k' }, `View ${'ABCD'[i]}${i === focus ? ' ●' : ''}`), s);
  }));
  const p = PASSES[passes[focus]];
  passInfo.innerHTML = `<b>${p.name}.</b> ${p.desc}`;
}

function passSelect(i) {
  const s = el('select', { 'aria-label': `View ${'ABCD'[i]} pass` });
  PASSES.forEach((p, k) => s.append(el('option', { value: k }, `${k < 10 ? (k + 1) % 10 : '·'}  ${p.name}`)));
  s.value = passes[i];
  s.addEventListener('change', () => setPass(i, Number(s.value)));
  s.addEventListener('pointerdown', (e) => e.stopPropagation());
  return s;
}

// ─── views ──────────────────────────────────────────────────────────────────
let viewEls = [];

function layoutClass() {
  if (layout === 1) return 'l1';
  if (layout === 2) return canvas.clientHeight > canvas.clientWidth ? 'l2v' : 'l2';
  return 'l4';
}

function buildViews() {
  viewsEl.className = `views ${layoutClass()}`;
  viewEls = [...Array(layout)].map((_, i) => {
    const v = el('div', { class: `view${i === focus ? ' focus' : ''}` });
    const lab = el('div', { class: 'label' }, el('b', {}, 'ABCD'[i]), passSelect(i));
    lab.addEventListener('pointerdown', (e) => { e.stopPropagation(); setFocus(i); });
    v.append(lab, el('div', { class: 'legend' }));
    v.addEventListener('pointerdown', () => setFocus(i));
    return v;
  });
  viewsEl.replaceChildren(...viewEls);
  refreshLegends();
  refreshPanelViews();
}

function refreshLegends() {
  viewEls.forEach((v, i) => {
    const f = LEGENDS[PASSES[passes[i]].id];
    v.querySelector('.legend').textContent = f ? f() : '';
  });
}

function setLayout(n) { layout = n; focus = Math.min(focus, n - 1); buildViews(); writeHash(); }
function setFocus(i) {
  if (i === focus) return;
  focus = i;
  viewEls.forEach((v, k) => v.classList.toggle('focus', k === i));
  refreshPanelViews();
}
function setPass(i, p) {
  passes[i] = (p + PASSES.length) % PASSES.length;
  const s = viewEls[i]?.querySelector('select');
  if (s) s.value = passes[i];
  refreshLegends();
  refreshPanelViews();
  writeHash();
}

// Viewport rects in canvas pixels. They match the CSS grid of #views.
function viewRects() {
  const W = canvas.width, H = canvas.height;
  const g = Math.max(1, Math.round(2 * canvas.width / Math.max(canvas.clientWidth, 1)));
  const half = (n) => Math.floor((n - g) / 2);
  let r;
  if (layout === 1) r = [[0, 0, W, H]];
  else if (layout === 2 && H > W) r = [[0, 0, W, half(H)], [0, half(H) + g, W, H - half(H) - g]];
  else if (layout === 2) r = [[0, 0, half(W), H], [half(W) + g, 0, W - half(W) - g, H]];
  else {
    const w0 = half(W), h0 = half(H), w1 = W - w0 - g, h1 = H - h0 - g;
    r = [[0, 0, w0, h0], [w0 + g, 0, w1, h0], [0, h0 + g, w0, h1], [w0 + g, h0 + g, w1, h1]];
  }
  return r.map(([x, y, w, h], i) => ({ x, y, w: Math.max(w, 1), h: Math.max(h, 1), pass: passes[i] }));
}

// ─── camera input ───────────────────────────────────────────────────────────
const pointers = new Map();
let pinch = 0;
viewsEl.addEventListener('pointerdown', (e) => {
  viewsEl.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  viewsEl.classList.add('dragging');
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
});
viewsEl.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch > 0) cam.dist = clamp(cam.dist * pinch / d, 0.5, 40);
    pinch = d;
  } else if (e.shiftKey) {
    cam.target[1] = clamp(cam.target[1] + dy * 0.01, 0.2, 6);
  } else {
    cam.az = (cam.az - dx * 0.3 + 360) % 360;
    cam.el = clamp(cam.el + dy * 0.25, -60, 88);
  }
});
const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = 0;
  if (!pointers.size) { viewsEl.classList.remove('dragging'); writeHash(); }
};
viewsEl.addEventListener('pointerup', endPointer);
viewsEl.addEventListener('pointercancel', endPointer);
viewsEl.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.001), 0.5, 40);
  writeHash();
}, { passive: false });

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

// ─── keys ───────────────────────────────────────────────────────────────────
// KEYS
window.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (/^[0-9]$/.test(k)) { setPass(focus, (Number(k) + 9) % 10); }
  else if (k === '[') setPass(focus, passes[focus] - 1);
  else if (k === ']') setPass(focus, passes[focus] + 1);
  else if (k === 'tab') { e.preventDefault(); setFocus((focus + (e.shiftKey ? layout - 1 : 1)) % layout); }
  else if (k === 'l') setLayout(layout === 4 ? 1 : layout * 2);
  else if (k === 'b') setValue('baked', !state.baked);
  else if (k === 's') setValue('sdfSkip', !state.sdfSkip);
  else if (k === 'p') panel.classList.toggle('hidden');
  else if (k === ' ') { e.preventDefault(); setValue('timeScale', state.timeScale > 0 ? 0 : savedTimeScale); }
  else return;
});
$('toggle').addEventListener('click', () => panel.classList.toggle('hidden'));

// ─── hash ───────────────────────────────────────────────────────────────────
function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  for (const [k, v] of q) {
    const c = CONTROLS[k];
    if (c) state[k] = c.type === 'toggle' ? v === '1' : Number(v);
  }
  if (q.has('layout')) layout = [1, 2, 4].includes(+q.get('layout')) ? +q.get('layout') : 4;
  if (q.has('passes')) passes = q.get('passes').split('.').map(Number).map((n) => (n >= 0 && n < PASSES.length ? n : 0));
  while (passes.length < 4) passes.push(DEFAULT_PASSES[passes.length]);
  if (q.has('cam')) {
    const [az, elv, dist, ty] = q.get('cam').split('_').map(Number);
    if ([az, elv, dist, ty].every(Number.isFinite)) cam = { az, el: elv, dist, target: [0, ty, 0] };
  }
}
let hashTimer = 0;
function writeHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const q = new URLSearchParams();
    for (const [k, c] of Object.entries(CONTROLS)) {
      if (state[k] !== c.value) q.set(k, c.type === 'toggle' ? (state[k] ? '1' : '0') : String(state[k]));
    }
    q.set('layout', layout);
    q.set('passes', passes.join('.'));
    q.set('cam', [cam.az, cam.el, cam.dist, cam.target[1]].map((n) => +n.toFixed(2)).join('_'));
    history.replaceState(null, '', `#${q}`);
  }, 250);
}
function resetAll() {
  state = defaults();
  for (const id of Object.keys(inputs)) inputs[id](state[id]);
  cam = structuredClone(CAM_PRESETS.Ground);
  passes = [...DEFAULT_PASSES];
  layout = 4; focus = 0;
  buildViews();
  writeHash();
}
async function copyLink() {
  writeHash();
  await new Promise((r) => setTimeout(r, 300));
  try { await navigator.clipboard.writeText(location.href); hud.textContent = 'link copied'; } catch { /* no clipboard in this frame */ }
}

// ─── boot ───────────────────────────────────────────────────────────────────
let engine = null;
buildPanel();
buildViews();

function fail(msg) {
  stage.classList.add('nogpu');
  $('fallback').textContent = msg;
}

async function boot() {
  if (!navigator.gpu) return fail('This page needs WebGPU. Open it in a current Chrome, Edge or Safari.');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return fail('No WebGPU adapter is available on this device.');
  const device = await adapter.requestDevice();
  device.lost.then((info) => fail(`The GPU device was lost: ${info.message || info.reason}`));
  device.addEventListener('uncapturederror', (e) => console.error('[sdf-clouds]', e.error.message));
  const names = ['common', 'cloud', 'shape', 'jfa', 'worley', 'light', 'march'];
  const files = await loadShaders(import.meta.url, names.map((n) => `shaders/${n}.wgsl`));
  const SH = Object.fromEntries(names.map((n) => [n, files[`shaders/${n}.wgsl`]]));
  const format = navigator.gpu.getPreferredCanvasFormat();
  const ctx = canvas.getContext('webgpu');
  ctx.configure({ device, format, alphaMode: 'opaque' });
  engine = await createEngine(device, format, SH);

  let last = performance.now();
  let time = 0, frame = 0, fpsT = 0, fpsN = 0, fps = 0, lastBake = '—', lastLayoutClass = '';
  const tick = (now) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (state.autoOrbit) cam.az = (cam.az + state.orbitSpeed * dt + 360) % 360;
    time += dt * state.timeScale;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr * state.renderScale));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr * state.renderScale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const lc = layoutClass();
    if (lc !== lastLayoutClass) { viewsEl.className = `views ${lc}`; lastLayoutClass = lc; }

    const enc = device.createCommandEncoder();
    const info = engine.frame(enc, ctx.getCurrentTexture().createView(), viewRects(),
      { state: animate(state, time), cam: animateCam(cam, state, time), time, frame: frame++ });
    device.queue.submit([enc.finish()]);
    if (info.stages.length) lastBake = info.stages.join(' + ');

    fpsN++; fpsT += dt;
    if (fpsT > 0.5) {
      fps = fpsN / fpsT; fpsN = 0; fpsT = 0;
      showStats(info, fps, lastBake, w, h);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function showStats(info, fps, lastBake, w, h) {
  const d = info.dims;
  const n = (v) => v.reduce((a, b) => a * b, 1);
  const big = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)} M` : `${(v / 1e3).toFixed(0)} k`);
  const live = w * h * state.maxSteps;
  hud.textContent = `${fps.toFixed(0)} fps · ${(1000 / Math.max(fps, 1e-3)).toFixed(1)} ms · ${w}×${h}`;
  statsEl.innerHTML =
    `<b>SDF volume</b> ${d.vol.join('×')} = ${big(n(d.vol))} voxels<br>` +
    `<b>Light volume</b> ${d.lit.join('×')} = ${big(n(d.lit))} voxels<br>` +
    `<b>JFA passes</b> init + ${Math.ceil(Math.log2(Math.max(...d.vol))) + 1} jumps + resolve<br>` +
    `<b>Last bake</b> ${lastBake}<br>` +
    `<b>Secondary rays / bake</b> ${big(n(d.lit))} (one per light voxel)<br>` +
    `<b>Live, worst case</b> ${big(live)} per frame (pixels × max steps)<br>` +
    `<b>Frame</b> ${fps.toFixed(0)} fps at ${w}×${h}`;
}

boot().catch((e) => { console.error(e); fail(`WebGPU start failed: ${e.message}`); });
