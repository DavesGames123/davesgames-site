// main.js — MarkovJunior page: panel, program tree, rule glyphs, run loop.
//
// interpreter.js runs the model; render.js draws it. This file keeps the
// page state S, builds the panel, runs a time-boxed batch of interpreter
// turns per animation frame, and hands the grid to the renderer.
//
// Passes swap per view: every view label holds a pass <select>; a click on a
// view gives it focus, and the keys act on the focused view.
//
//   1..7   pass on the focused view      [ ]    previous / next pass
//   Tab    next view                     L      cycle 1 / 2 / 4 views
//   Space  play / pause                  .      one turn
//   R      restart, same seed            N      new seed
//   M      next model                    I      incremental matching on / off
//   P      panel on / off
//
// The URL hash keeps the model, size, seed, layout, passes and every setting
// that differs from its default.
//
// grep: const PASSES  const CONTROLS  function loadModel  function restart
//       function buildTree  function drawRules  function tick  function inspect

import { loadShaders } from '../../lib/shaders.js';
import { Interpreter, SQUARE_SUBGROUPS } from './interpreter.js';
import { createRenderer } from './render.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage'), canvas = $('gl'), viewsEl = $('views'), panel = $('panel'), pbody = $('pbody'), hud = $('hud');

const PASSES = [
  { id: 'colors', name: 'Colors', desc: 'The grid in the model palette. This is what MarkovJunior saves.' },
  { id: 'age', name: 'Change age', desc: 'How recently each cell changed. Hot = within the trail window; dim = older; darkest = never written.' },
  { id: 'writer', name: 'Writer node', desc: 'Which leaf node wrote each cell last, one hue per node (see the Program tree swatches). Click a tree row to solo that node.' },
  { id: 'heat', name: 'Write heat', desc: 'How many times each cell was written, log scale up to the heat max.' },
  { id: 'matches', name: 'Match set', desc: 'Pending matches of the last rule node: each input cell of each match adds one. This is the set that incremental matching keeps between turns.' },
  { id: 'potential', name: 'Potential field', desc: 'Potential of the last rule node. Observe: turns until each cell can reach its goal value. Field: BFS distance from the field source. Dark = unreachable, or the node has no field.' },
  { id: 'isolate', name: 'Isolate value', desc: 'One value in full colour, the rest grey. Pick the value in the legend under Model.' },
];

const R = (id, label, min, max, step, value, tip, fmt) => ({ id, type: 'range', label, min, max, step, value, tip, fmt });
const B = (id, label, value, tip) => ({ id, type: 'toggle', label, value, tip });
const CONTROLS = {
  model: [
    R('size', 'Grid size', 8, 1024, 1, 0, 'Cells per side. 0 in the hash means the model default.'),
    R('seed', 'Seed', 0, 99999, 1, 1, 'Random seed for the run.'),
    B('stepLimit', 'Step limit', true, 'Stop at the models.xml step count (50000 when none is given).'),
  ],
  run: [
    R('speed', 'Turns / frame', 0, 5, 0.01, 1.7, 'Interpreter turns per animation frame, log scale.', 'pow10'),
    R('budget', 'Frame budget', 1, 40, 1, 12, 'Stop a batch after this many ms, so the page stays live on a heavy model.', 'ms'),
    B('autoRestart', 'Auto restart', true, 'When a run ends, wait, then restart with a new seed.'),
    R('hold', 'Hold', 0, 10, 0.1, 2.5, 'Seconds to show the finished grid before the restart.', 's'),
  ],
  engine: [
    B('incremental', 'Incremental', true, 'Rescan only around the cells that changed since the node last ran. Off = full rescan every turn; watch "cells scanned".'),
    R('temperature', 'Temperature', -0.5, 10, 0.05, -0.5, 'Inference nodes: -0.5 keeps the model value. 0 = follow the potential greedily; higher = looser.', 'temp'),
  ],
  view: [
    R('trail', 'Age trail', 1, 5000, 1, 200, 'Turns until a change fades out in the change-age pass.'),
    R('heatMax', 'Heat max', 2, 2000, 1, 40, 'Top of the write-heat scale.'),
    R('zoom', 'Zoom', 0.25, 16, 0.01, 1, 'Shared zoom of every view. Wheel zooms too.'),
    B('grid', 'Cell lines', true, 'Draw cell borders once a cell is 6 px or more.'),
  ],
};
const ALL = Object.values(CONTROLS).flat();
const CTRL = Object.fromEntries(ALL.map((c) => [c.id, c]));

// ─── state ──────────────────────────────────────────────────────────────────
const S = Object.fromEntries(ALL.map((c) => [c.id, c.value]));
Object.assign(S, { model: 'River', symmetry: 'model', potValue: -1, isolate: 0, playing: true, panX: 0, panY: 0 });
let layout = 1, passes = [0, 1, 2, 4], focus = 0;
let bundle = null, model = null, ip = null, customXML = null, selLeaf = null;
let potOf = -1, doneAt = 0, windowT = performance.now(), turnsPerSec = 0, scannedPerTurn = 0, lastScanned = 0, lastCounter = 0;

// ─── dom helpers ────────────────────────────────────────────────────────────
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
  s.append(el('h2', {}, el('button', { type: 'button', onclick: () => s.classList.toggle('closed') }, title)), el('div', { class: 'body' }, ...kids));
  return s;
}
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const hex2rgb = (h) => [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
const css = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
function hueRGB(h) {
  const f = (o) => clamp(Math.abs(((h + o) % 1) * 6 - 3) - 1, 0, 1);
  return [f(0), f(2 / 3), f(1 / 3)];
}

// ─── panel ──────────────────────────────────────────────────────────────────
const setters = {};
function fmt(c, v) {
  if (c.fmt === 'pow10') return String(Math.round(10 ** v));
  if (c.fmt === 'ms') return `${v} ms`;
  if (c.fmt === 's') return `${Number(v).toFixed(1)} s`;
  if (c.fmt === 'temp') return v < 0 ? 'model' : Number(v).toFixed(2);
  if (c.id === 'size') return v === 0 ? String(model?.size ?? '') : String(v);
  return c.step >= 1 ? String(Math.round(v)) : Number(v).toFixed(2);
}
function row(c) {
  const r = el('div', { class: 'ctl', title: `${c.tip}\nDouble-click to reset.` }, el('span', { class: 'k' }, c.label));
  let set;
  if (c.type === 'range') {
    const inp = el('input', { type: 'range', min: c.min, max: c.max, step: c.step, 'aria-label': c.label });
    const out = el('output');
    inp.addEventListener('input', () => setValue(c.id, Number(inp.value)));
    r.append(inp, out);
    set = (v) => { inp.value = c.id === 'size' && v === 0 ? model?.size ?? 64 : v; out.textContent = fmt(c, v); };
  } else {
    const b = el('button', { type: 'button', class: 'sw' });
    b.addEventListener('click', () => setValue(c.id, !S[c.id]));
    r.append(b);
    set = (v) => { b.classList.toggle('on', !!v); b.textContent = v ? 'on' : 'off'; };
  }
  r.addEventListener('dblclick', () => setValue(c.id, c.value));
  setters[c.id] = (v) => { set(v); r.classList.toggle('changed', v !== c.value); };
  setters[c.id](S[c.id]);
  return r;
}
function setValue(id, v) {
  S[id] = v;
  setters[id]?.(v);
  if (id === 'size' || id === 'stepLimit') loadModel();
  else if (id === 'seed') restart();
  else if (id === 'incremental' && ip) ip.incremental = v;
  else if (id === 'temperature' && ip) ip.temperature = v;
  writeHash();
}

let modelSel, symSel, potSel, legendEl, treeEl, rulesEl, statsEl, xmlEl, errEl, passInfo, viewSlots, layoutBtns, playBtn;

function buildPanel() {
  layoutBtns = [1, 2, 4].map((n) => el('button', { type: 'button', onclick: () => setLayout(n) }, `${n} view${n > 1 ? 's' : ''}`));
  viewSlots = el('div');
  passInfo = el('p', { class: 'spec' });
  const keys = el('p', { class: 'spec' });
  keys.innerHTML = '<kbd>1</kbd>–<kbd>7</kbd> pass · <kbd>[</kbd> <kbd>]</kbd> cycle · <kbd>Tab</kbd> next view · <kbd>L</kbd> layout · '
    + '<kbd>Space</kbd> play · <kbd>.</kbd> turn · <kbd>R</kbd> restart · <kbd>N</kbd> new seed · <kbd>M</kbd> next model · <kbd>I</kbd> incremental · <kbd>P</kbd> panel';
  pbody.append(section('views', 'Views', true, el('div', { class: 'buttons' }, ...layoutBtns), viewSlots, passInfo, keys));

  modelSel = el('select', { 'aria-label': 'Model' });
  modelSel.addEventListener('change', () => { S.model = modelSel.value; S.size = 0; setters.size(0); customXML = null; loadModel(); writeHash(); });
  const step = (d) => { const i = bundle.models.findIndex((m) => m.name === S.model); modelSel.value = bundle.models[(i + d + bundle.models.length) % bundle.models.length].name; modelSel.dispatchEvent(new Event('change')); };
  legendEl = el('div', { class: 'legend-swatches' });
  pbody.append(section('model', 'Model', true,
    el('div', { class: 'ctl' }, el('span', { class: 'k' }, 'Model'), modelSel),
    el('div', { class: 'buttons' },
      el('button', { type: 'button', onclick: () => step(-1) }, 'Prev'),
      el('button', { type: 'button', onclick: () => step(1) }, 'Next'),
      el('button', { type: 'button', onclick: () => step(1 + Math.floor(Math.random() * (bundle.models.length - 1))) }, 'Random')),
    ...CONTROLS.model.map(row),
    el('div', { class: 'buttons' }, el('button', { type: 'button', onclick: newSeed }, 'New seed')),
    legendEl));

  playBtn = el('button', { type: 'button', onclick: togglePlay }, 'Pause');
  pbody.append(section('run', 'Run', true,
    el('div', { class: 'buttons' }, playBtn,
      el('button', { type: 'button', onclick: stepOnce }, 'Turn'),
      el('button', { type: 'button', onclick: restart }, 'Restart')),
    ...CONTROLS.run.map(row)));

  symSel = el('select', { 'aria-label': 'Default symmetry' });
  for (const k of ['model', ...Object.keys(SQUARE_SUBGROUPS)]) symSel.append(el('option', { value: k }, k === 'model' ? 'model default (xy)' : k));
  symSel.value = S.symmetry;
  symSel.addEventListener('change', () => { S.symmetry = symSel.value; loadModel(); writeHash(); });
  const symSpec = el('p', { class: 'spec' });
  symSpec.innerHTML = 'Rules expand once, at load, into the rotations and reflections of the symmetry group. An explicit <code>symmetry</code> attribute in the model still wins. See the counts in the Program tree.';
  pbody.append(section('engine', 'Engine', false,
    ...CONTROLS.engine.map(row),
    el('div', { class: 'ctl', title: 'Default symmetry group for rules with no symmetry attribute' }, el('span', { class: 'k' }, 'Symmetry'), symSel),
    symSpec));

  treeEl = el('div', { class: 'tree' });
  pbody.append(section('tree', 'Program', true, treeEl));
  rulesEl = el('div', { class: 'rules' });
  pbody.append(section('rules', 'Rules + symmetries', false, rulesEl));

  potSel = el('select', { 'aria-label': 'Potential value' });
  potSel.addEventListener('change', () => { S.potValue = Number(potSel.value); writeHash(); });
  pbody.append(section('passes', 'Pass settings', false,
    ...CONTROLS.view.map(row),
    el('div', { class: 'ctl' }, el('span', { class: 'k' }, 'Potential of'), potSel),
    el('div', { class: 'buttons' }, el('button', { type: 'button', onclick: resetView }, 'Fit view'))));

  statsEl = el('div', { class: 'stats' });
  pbody.append(section('stats', 'Interpreter', true, statsEl));

  xmlEl = el('textarea', { class: 'xml', spellcheck: 'false', 'aria-label': 'Model XML' });
  errEl = el('div', { class: 'err' });
  pbody.append(section('xml', 'Model XML', false, xmlEl, errEl, el('div', { class: 'buttons' },
    el('button', { type: 'button', onclick: () => { customXML = xmlEl.value; loadModel(); } }, 'Run edited XML'),
    el('button', { type: 'button', onclick: () => { customXML = null; loadModel(); } }, 'Revert'))));

  const about = section('about', 'Core idea', false);
  about.querySelector('.body').innerHTML = `
    <p class="spec">Port of <a href="https://github.com/mxgmn/MarkovJunior" target="_blank" rel="noopener">MarkovJunior</a>
    (Maxim Gumin, MIT) to JavaScript. A model is a program of rewrite rules on a grid:</p>
    <p class="spec"><b>Rule nodes.</b> <code>one</code> applies one random match per turn; <code>all</code> applies every
    non-overlapping match; <code>prl</code> applies every match at once and ignores overlap.</p>
    <p class="spec"><b>Control flow.</b> <code>markov</code> goes back to its first child after any child succeeds;
    <code>sequence</code> runs each child until it is exhausted, then moves on.</p>
    <p class="spec"><b>Incremental matching.</b> A rule node keeps its match set and, each turn, rescans only around the cells
    that changed since it last ran.</p>
    <p class="spec"><b>Inference.</b> <code>field</code> and <code>observe</code> compute potentials (BFS over the rules, run
    backwards for observe) and bias match choice toward the goal, with <code>temperature</code>.</p>
    <p class="spec"><b>Symmetry.</b> Each rule expands at load into the distinct rotations and reflections of its group.</p>
    <p class="spec">Ported: one, all, prl, markov, sequence, path, convolution, field, observe (greedy), union. Not ported:
    3D grids, map, wfc, convchain, search="True", rules from image files. 92 of the upstream 2D models run.
    The random generator differs from .NET, so a seed gives a different run than upstream.</p>
    <p class="spec">MarkovJunior © 2022 Maxim Gumin, MIT License. Notice in <code>LICENSE-MarkovJunior.txt</code>.</p>`;
  pbody.append(about);
}

function refreshPanelViews() {
  layoutBtns.forEach((b, i) => b.classList.toggle('on', [1, 2, 4][i] === layout));
  viewSlots.replaceChildren(...[...Array(layout)].map((_, i) =>
    el('div', { class: 'ctl' }, el('span', { class: 'k' }, `View ${'ABCD'[i]}${i === focus ? ' ●' : ''}`), passSelect(i))));
  const p = PASSES[passes[focus]];
  passInfo.innerHTML = `<b>${p.name}.</b> ${p.desc}`;
}
function passSelect(i) {
  const s = el('select', { 'aria-label': `View ${'ABCD'[i]} pass` });
  PASSES.forEach((p, k) => s.append(el('option', { value: k }, `${k + 1}  ${p.name}`)));
  s.value = passes[i];
  s.addEventListener('change', () => setPass(i, Number(s.value)));
  return s;
}

// ─── views ──────────────────────────────────────────────────────────────────
let viewEls = [];
const layoutClass = () => (layout === 1 ? 'l1' : layout === 2 ? (canvas.clientHeight > canvas.clientWidth ? 'l2v' : 'l2') : 'l4');
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
  refreshPanelViews();
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
  refreshPanelViews();
  writeHash();
}
function viewRects() {
  const W = canvas.width, H = canvas.height;
  const g = Math.max(1, Math.round(2 * W / Math.max(canvas.clientWidth, 1)));
  const half = (n) => Math.floor((n - g) / 2);
  let r;
  if (layout === 1) r = [[0, 0, W, H]];
  else if (layout === 2 && H > W) r = [[0, 0, W, half(H)], [0, half(H) + g, W, H - half(H) - g]];
  else if (layout === 2) r = [[0, 0, half(W), H], [half(W) + g, 0, W - half(W) - g, H]];
  else {
    const w0 = half(W), h0 = half(H);
    r = [[0, 0, w0, h0], [w0 + g, 0, W - w0 - g, h0], [0, h0 + g, w0, H - h0 - g], [w0 + g, h0 + g, W - w0 - g, H - h0 - g]];
  }
  return r.map(([x, y, w, h], i) => ({ x, y, w: Math.max(w, 1), h: Math.max(h, 1), pass: passes[i] }));
}

// Canvas px per cell in view v, and the cell under a client point.
function cellPx(v) { return Math.min(v.w / ip.grid.MX, v.h / ip.grid.MY) * 0.94 * S.zoom; }
function cellAt(clientX, clientY) {
  if (!ip) return null;
  const r = canvas.getBoundingClientRect();
  const k = canvas.width / r.width;
  const px = (clientX - r.left) * k, py = (clientY - r.top) * k;
  const v = viewRects().find((q) => px >= q.x && px < q.x + q.w && py >= q.y && py < q.y + q.h);
  if (!v) return null;
  const c = cellPx(v);
  const gx = (px - v.x - v.w / 2) / c + ip.grid.MX / 2 + S.panX;
  const gy = (py - v.y - v.h / 2) / c + ip.grid.MY / 2 + S.panY;
  return { v, c, gx, gy };
}

// ─── pan / zoom / inspect ───────────────────────────────────────────────────
let drag = null;
viewsEl.addEventListener('pointerdown', (e) => {
  viewsEl.setPointerCapture(e.pointerId);
  const h = cellAt(e.clientX, e.clientY);
  drag = h ? { x: e.clientX, y: e.clientY, k: canvas.width / canvas.getBoundingClientRect().width / h.c } : null;
  viewsEl.classList.add('dragging');
});
viewsEl.addEventListener('pointermove', (e) => {
  if (drag) {
    S.panX -= (e.clientX - drag.x) * drag.k;
    S.panY -= (e.clientY - drag.y) * drag.k;
    drag.x = e.clientX; drag.y = e.clientY;
  }
  inspect(e.clientX, e.clientY);
});
const endDrag = () => { drag = null; viewsEl.classList.remove('dragging'); writeHash(); };
viewsEl.addEventListener('pointerup', endDrag);
viewsEl.addEventListener('pointercancel', endDrag);
viewsEl.addEventListener('pointerleave', () => { hoverText = ''; });
viewsEl.addEventListener('wheel', (e) => {
  e.preventDefault();
  const before = cellAt(e.clientX, e.clientY);
  S.zoom = clamp(S.zoom * Math.exp(-e.deltaY * 0.0015), CTRL.zoom.min, CTRL.zoom.max);
  const after = cellAt(e.clientX, e.clientY);
  if (before && after) { S.panX += before.gx - after.gx; S.panY += before.gy - after.gy; }
  setters.zoom(S.zoom);
  writeHash();
}, { passive: false });
function resetView() { S.zoom = 1; S.panX = 0; S.panY = 0; setters.zoom(1); writeHash(); }

let hoverText = '';
function inspect(cx, cy) {
  const h = cellAt(cx, cy);
  if (!h) { hoverText = ''; return; }
  const x = Math.floor(h.gx), y = Math.floor(h.gy), g = ip.grid;
  if (x < 0 || y < 0 || x >= g.MX || y >= g.MY) { hoverText = ''; return; }
  const i = x + y * g.MX;
  const w = ip.writer[i];
  const leaf = w ? ip.leaves[w - 1] : null;
  const pot = ip.leaf?.potentials ? ip.leaf.potentials.map((p, c) => (p[i] >= 0 ? `${g.characters[c]}:${p[i]}` : null)).filter(Boolean).slice(0, 4).join(' ') : '';
  hoverText = `(${x}, ${y}) ${g.characters[g.state[i]]} · turn ${ip.stamp[i] ? ip.stamp[i] - 1 : '—'} · by ${leaf ? `#${leaf.id} ${leaf.kind}` : '—'} · writes ${ip.heat[i]}${pot ? ` · pot ${pot}` : ''}`;
}

// ─── keys ───────────────────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (/^[1-7]$/.test(k)) setPass(focus, Number(k) - 1);
  else if (k === '[') setPass(focus, passes[focus] - 1);
  else if (k === ']') setPass(focus, passes[focus] + 1);
  else if (k === 'tab') { e.preventDefault(); setFocus((focus + (e.shiftKey ? layout - 1 : 1)) % layout); }
  else if (k === 'l') setLayout(layout === 4 ? 1 : layout * 2);
  else if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === '.') stepOnce();
  else if (k === 'r') restart();
  else if (k === 'n') newSeed();
  else if (k === 'm') { const i = bundle.models.findIndex((m) => m.name === S.model); modelSel.value = bundle.models[(i + 1) % bundle.models.length].name; modelSel.dispatchEvent(new Event('change')); }
  else if (k === 'i') setValue('incremental', !S.incremental);
  else if (k === 'p') panel.classList.toggle('hidden');
});
$('toggle').addEventListener('click', () => panel.classList.toggle('hidden'));

// ─── hash ───────────────────────────────────────────────────────────────────
function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  for (const [k, v] of q) if (CTRL[k]) S[k] = CTRL[k].type === 'toggle' ? v === '1' : Number(v);
  if (q.has('model')) S.model = q.get('model');
  if (q.has('sym')) S.symmetry = q.get('sym');
  if (q.has('layout') && [1, 2, 4].includes(+q.get('layout'))) layout = +q.get('layout');
  if (q.has('passes')) passes = q.get('passes').split('.').map((n) => clamp(Number(n) || 0, 0, PASSES.length - 1));
  while (passes.length < 4) passes.push(0);
}
let hashTimer = 0;
function writeHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const q = new URLSearchParams();
    q.set('model', S.model);
    for (const c of ALL) if (S[c.id] !== c.value) q.set(c.id, c.type === 'toggle' ? (S[c.id] ? '1' : '0') : String(+Number(S[c.id]).toFixed(3)));
    if (S.symmetry !== 'model') q.set('sym', S.symmetry);
    q.set('layout', layout);
    q.set('passes', passes.join('.'));
    history.replaceState(null, '', `#${q}`);
  }, 250);
}

// ─── model life cycle ───────────────────────────────────────────────────────
function loadModel() {
  model = bundle.models.find((m) => m.name === S.model) ?? bundle.models[0];
  S.model = model.name;
  if (modelSel) modelSel.value = model.name;
  const size = S.size > 0 ? S.size : model.size;
  const xml = customXML ?? model.xml;
  errEl.textContent = '';
  if (customXML == null) xmlEl.value = model.xml;
  try {
    ip = Interpreter.load(xml, size, size, { symmetry: S.symmetry === 'model' ? null : S.symmetry, temperature: S.temperature });
  } catch (e) {
    if (customXML == null) throw e;
    // Keep the edited text and the message; run the stock model meanwhile.
    const msg = e.message;
    customXML = null;
    const text = xmlEl.value;
    loadModel();
    xmlEl.value = text;
    errEl.textContent = `Edited XML did not load: ${msg}. Running the stock model.`;
    return;
  }
  ip.incremental = S.incremental;
  const pal = { ...bundle.palette, ...(model.colors ?? {}) };
  const colors = ip.grid.characters.map((ch) => hex2rgb(pal[ch] ?? 'ff00ff'));
  renderer?.palette(colors);
  legendEl.replaceChildren(...ip.grid.characters.map((ch, i) => {
    const s = el('span', { class: i === S.isolate ? 'on' : '', title: 'Isolate this value' }, el('i', { style: `background:${css(colors[i])}` }), ch);
    s.addEventListener('click', () => { S.isolate = i; legendEl.querySelectorAll('span').forEach((x, k) => x.classList.toggle('on', k === i)); });
    return s;
  }));
  S.isolate = Math.min(S.isolate, ip.grid.C - 1);
  potSel.replaceChildren(el('option', { value: -1 }, 'auto'), ...ip.grid.characters.map((ch, i) => el('option', { value: i }, ch)));
  potSel.value = String(S.potValue < ip.grid.C ? S.potValue : -1);
  selLeaf = null;
  buildTree();
  drawRules();
  setters.size(S.size);
  restart();
}
function restart() {
  if (!ip) return;
  ip.start(S.seed | 0, S.stepLimit ? model.steps : 0);
  doneAt = 0; lastCounter = 0; lastScanned = 0;
}
function newSeed() { setValue('seed', Math.floor(Math.random() * 100000)); }
function togglePlay() { S.playing = !S.playing; playBtn.textContent = S.playing ? 'Pause' : 'Play'; }
function stepOnce() { if (S.playing) togglePlay(); ip?.step(); }

// ─── program tree ───────────────────────────────────────────────────────────
let treeRows = [];
function describe(n) {
  if (n.nodes) return n.implicit ? 'implicit root' : `${n.nodes.length} children`;
  if (n.kind === 'path') return `${n.el.attrs.from} → ${n.el.attrs.to} on ${n.el.attrs.on}`;
  if (n.kind === 'convolution') return `${n.el.attrs.neighborhood}${n.el.attrs.steps ? ` ×${n.el.attrs.steps}` : ''}`;
  const o = n.originals ?? [];
  const f = o[0]?.rule;
  let s = f ? `${f.inString}→${f.outString}` : '';
  if (o.length > 1) s += ` +${o.length - 1}`;
  if (n.fields) s += ' · field';
  if (n.observations) s += ' · observe';
  return s;
}
function buildTree() {
  treeRows = [];
  const add = (n) => {
    const kind = el('span', { class: `kind ${n.kind}` }, n.kind === 'convolution' ? 'conv' : n.kind);
    const sw = el('span', { class: 'sw8' });
    if (!n.nodes) sw.style.background = css(hueRGB((n.id / ip.leaves.length) * 0.85));
    const meta = el('span', { class: 'meta' });
    const r = el('div', { class: 'node', style: `padding-left:${4 + n.depth * 12}px`, title: n.el ? `line ${n.el.line}` : '' },
      kind, sw, el('span', { class: 'desc' }, describe(n)), meta);
    r.addEventListener('click', () => {
      if (n.nodes) return;
      selLeaf = selLeaf === n ? null : n;
      treeRows.forEach((t) => t.row.classList.toggle('sel', t.node === selLeaf));
      drawRules();
    });
    treeRows.push({ node: n, row: r, meta });
    if (n.nodes) n.nodes.forEach(add);
  };
  add(ip.root);
  treeEl.replaceChildren(...treeRows.map((t) => t.row));
}
function updateTree() {
  const active = new Set();
  for (let b = ip.current; b; b = b.parent) { active.add(b); const c = b.nodes[b.n]; if (c) active.add(c); }
  for (const t of treeRows) {
    const n = t.node;
    t.row.classList.toggle('active', active.has(n));
    t.row.classList.toggle('leaf-on', n === ip.leaf && !ip.done);
    if (!n.nodes) {
      const parts = [];
      if (n.rules?.length) parts.push(`${n.originals?.length ?? 0}→${n.rules.length}`);
      if (n.counter !== undefined) parts.push(n.steps > 0 ? `${n.counter}/${n.steps}` : `${n.counter}`);
      t.meta.textContent = parts.join(' · ');
    }
  }
}

// ─── rule glyphs ────────────────────────────────────────────────────────────
// Each variant: input on the left, output on the right. A union draws as
// stripes of its members; a wildcard as a checker.
function drawRules() {
  const leaf = selLeaf ?? ip.leaves.find((l) => l.originals?.length);
  if (!leaf?.originals) { rulesEl.replaceChildren(el('p', { class: 'spec' }, 'Click a one / all / prl row in Program.')); return; }
  const pal = { ...bundle.palette, ...(model.colors ?? {}) };
  const cols = ip.grid.characters.map((ch) => '#' + (pal[ch] ?? 'ff00ff'));
  const wild = (1 << ip.grid.C) - 1;
  const head = el('p', { class: 'spec' });
  head.innerHTML = `<b>#${leaf.id} ${leaf.kind}</b>: ${leaf.originals.length} rule${leaf.originals.length > 1 ? 's' : ''} expand to ${leaf.rules.length} by symmetry.`;
  const blocks = leaf.originals.map((o) => {
    const variants = leaf.rules.slice(o.first, o.first + o.variants).map((r) => {
      const cs = Math.max(4, Math.min(10, Math.floor(60 / Math.max(r.IMX, r.IMY))));
      const cv = el('canvas', { width: (r.IMX + r.OMX) * cs + 10, height: Math.max(r.IMY, r.OMY) * cs });
      const g = cv.getContext('2d');
      const cell = (x0, x, y, draw) => draw(x0 + x * cs, y * cs);
      const checker = (px, py) => { g.fillStyle = '#2a3340'; g.fillRect(px, py, cs, cs); g.fillStyle = '#44505f'; g.fillRect(px, py, cs / 2, cs / 2); g.fillRect(px + cs / 2, py + cs / 2, cs / 2, cs / 2); };
      for (let y = 0; y < r.IMY; y++) for (let x = 0; x < r.IMX; x++) {
        const w = r.input[x + y * r.IMX];
        cell(0, x, y, (px, py) => {
          if (w === wild) return checker(px, py);
          const members = cols.filter((_, c) => w & (1 << c));
          members.forEach((c, k) => { g.fillStyle = c; g.fillRect(px + (k * cs) / members.length, py, Math.ceil(cs / members.length), cs); });
        });
      }
      const ox = r.IMX * cs + 10;
      g.fillStyle = '#8fa0b2'; g.fillRect(r.IMX * cs + 3, (Math.max(r.IMY, r.OMY) * cs) / 2 - 1, 4, 2);
      for (let y = 0; y < r.OMY; y++) for (let x = 0; x < r.OMX; x++) {
        const v = r.output[x + y * r.OMX];
        cell(ox, x, y, (px, py) => { if (v === 0xff) checker(px, py); else { g.fillStyle = cols[v]; g.fillRect(px, py, cs, cs); } });
      }
      return cv;
    });
    const d = el('div', {});
    const t = el('div', { class: 'orig' });
    t.innerHTML = `<b>${o.rule.inString} → ${o.rule.outString}</b>${o.rule.p !== 1 ? ` · p ${o.rule.p}` : ''} · ${o.variants} variant${o.variants > 1 ? 's' : ''}`;
    d.append(t, el('div', { class: 'variants' }, ...variants));
    return d;
  });
  rulesEl.replaceChildren(head, ...blocks);
}

// ─── stats ──────────────────────────────────────────────────────────────────
function showStats() {
  const g = ip.grid;
  const leaf = ip.leaf;
  const pending = leaf?.kind === 'prl' ? 'no kept' : (leaf?.matchCount ?? 0).toLocaleString();
  const rules = ip.leaves.reduce((a, l) => a + (l.rules?.length ?? 0), 0);
  const origs = ip.leaves.reduce((a, l) => a + (l.originals?.length ?? 0), 0);
  statsEl.innerHTML =
    `<b>Grid</b> ${g.MX}×${g.MY} · ${g.C} values (${g.characters.join('')})<br>` +
    `<b>Turn</b> ${ip.counter}${ip.steps > 0 ? ` / ${ip.steps}` : ''} ${ip.done ? '· <b>done</b>' : S.playing ? '' : '· paused'}<br>` +
    `<b>Speed</b> ${Math.round(turnsPerSec)} turns/s<br>` +
    `<b>Changes</b> ${ip.changes.length.toLocaleString()} logged<br>` +
    `<b>Last node</b> ${leaf ? `#${leaf.id} ${leaf.kind}` : '—'} · ${pending} pending matches<br>` +
    `<b>Cells scanned</b> ${Math.round(scannedPerTurn).toLocaleString()} / turn (${S.incremental ? 'incremental' : 'full rescan'})<br>` +
    `<b>Rules</b> ${origs} written → ${rules} after symmetry<br>` +
    `<b>Nodes</b> ${ip.leaves.length} leaves`;
}

// ─── boot ───────────────────────────────────────────────────────────────────
let renderer = null;
function fail(msg) { stage.classList.add('nogpu'); $('fallback').textContent = msg; }

async function boot() {
  readHash();
  buildPanel();
  buildViews();
  bundle = await (await fetch(new URL('models.json', import.meta.url))).json();
  bundle.models.sort((a, b) => a.name.localeCompare(b.name));
  for (const m of bundle.models) modelSel.append(el('option', { value: m.name }, `${m.name} · ${m.size}`));
  if (!navigator.gpu) return fail('This page needs WebGPU. Open it in a current Chrome, Edge or Safari.');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return fail('No WebGPU adapter is available on this device.');
  const device = await adapter.requestDevice();
  device.lost.then((info) => fail(`The GPU device was lost: ${info.message || info.reason}`));
  device.addEventListener('uncapturederror', (e) => console.error('[markov-junior]', e.error.message));
  const SH = await loadShaders(import.meta.url, ['shaders/grid.wgsl']);
  const format = navigator.gpu.getPreferredCanvasFormat();
  const ctx = canvas.getContext('webgpu');
  ctx.configure({ device, format, alphaMode: 'opaque' });
  renderer = await createRenderer(device, format, SH['shaders/grid.wgsl']);
  loadModel();

  let lastUI = 0, lastLC = '';
  const tick = (now) => {
    if (S.playing && !ip.done) {
      const want = Math.max(1, Math.round(10 ** S.speed));
      const t0 = performance.now();
      for (let n = 0; n < want; n++) {
        if (!ip.step()) break;
        if ((n & 7) === 7 && performance.now() - t0 > S.budget) break;
      }
    }
    if (ip.done && S.playing && S.autoRestart) {
      if (!doneAt) doneAt = now;
      else if (now - doneAt > S.hold * 1000) { S.seed = Math.floor(Math.random() * 100000); setters.seed(S.seed); restart(); writeHash(); }
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const lc = layoutClass();
    if (lc !== lastLC) { viewsEl.className = `views ${lc}`; lastLC = lc; }

    const views = viewRects();
    const shown = new Set(views.map((v) => PASSES[v.pass].id));
    const aux = { matches: shown.has('matches'), potential: shown.has('potential'), potValue: S.potValue };
    const scales = renderer.pack(ip, aux);
    potOf = scales.potOf;
    const enc = device.createCommandEncoder();
    renderer.draw(enc, ctx.getCurrentTexture().createView(), views, {
      turn: ip.counter + 1, C: ip.grid.C, zoom: S.zoom, panX: S.panX, panY: S.panY, grid: S.grid,
      trail: S.trail, heatMax: S.heatMax, isolate: S.isolate, potMax: scales.potMax,
      leaves: ip.leaves.length, matchMax: scales.matchMax, highlight: selLeaf?.id ?? 0,
    });
    device.queue.submit([enc.finish()]);

    if (now - lastUI > 150) {
      const dt = (now - windowT) / 1000;
      const dTurns = ip.counter - lastCounter;
      if (dt > 0) turnsPerSec = dTurns >= 0 ? dTurns / dt : 0;
      if (dTurns > 0) scannedPerTurn = (ip.scanned - lastScanned) / dTurns;
      lastCounter = ip.counter; lastScanned = ip.scanned; windowT = now;
      updateTree();
      showStats();
      viewEls.forEach((v, i) => {
        const id = PASSES[passes[i]].id;
        let t = '';
        if (id === 'potential') t = ip.leaf?.potentials ? `${potOf >= 0 ? `value ${ip.grid.characters[potOf]} · ` : ''}0 → ${scales.potMax} turns` : 'last node has no field';
        else if (id === 'heat') t = `1 → ${S.heatMax} writes (log)`;
        else if (id === 'age') t = `now → ${S.trail} turns ago`;
        else if (id === 'matches') t = ip.leaf?.kind === 'prl' ? 'prl keeps no match set' : `${ip.leaf?.matchCount ?? 0} pending`;
        else if (id === 'isolate') t = `value ${ip.grid.characters[S.isolate]}`;
        v.querySelector('.legend').textContent = t;
      });
      hud.textContent = hoverText || `${S.model} · turn ${ip.counter}${ip.done ? ' · done' : ''}`;
      lastUI = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

boot().catch((e) => { console.error(e); fail(`Start failed: ${e.message}`); });
