// main.js — Mandelbulber page: panel, formula slots, camera input, frame loop.
//
// Part of a port of Mandelbulber2 (Mandelbulber Team, github.com/buddhi1980/
// mandelbulber2, GPL-3.0, see COPYING). The camera math follows upstream
// cCameraTarget (src/camera_target.cpp); the slot and render param names are
// the upstream ones, so the scene object stays in upstream units (contract C5).
//
// The GPU work lives in engine.js (contract C6). This file keeps one scene
// object, builds the panel from gen/catalog.json and gen/params.json, and calls
// engine.frame() once per animation frame until the target sample count.
//
//   drag        orbit around the target       wheel        dolly
//   right drag  pan (or Shift + drag)         F            fly mode on / off
//   V           frame the surface (also runs when slot 1 changes with no example loaded)
//   W A S D     fly: move (Shift = fast)      Q E          fly: down / up
//   P           panel on / off                Esc          close the formula list
//
// Touch: one finger orbits (with inertia), two fingers pinch to dolly and drag to pan,
// a double tap runs Frame, a long press opens a menu (Frame, Reset view, Fly). In fly mode
// two thumbsticks move and look. On a phone the panel is a bottom sheet (peek, half, full)
// or, in landscape, a right drawer. The canvas then covers only the free area, so the
// camera target and Frame center in the part of the screen the user sees.
//
// The URL hash holds the scene diff against the defaults as deflated .fract
// text (#s=...), so a link reopens the same scene.
//
// grep: function boot  function buildPanel  function buildSlotEditor  function openPicker  function ctl
//       function gradientEditor  function loadScene  function exportFract  function writeHash  function readHash
//       function camFromScene  function camToScene  function frameView  function pushScene  function tick
//       function savePng  const MAIN_UI  const SLOT_COMMON  const CREDIT
//       function applyLayout  function pickMode  function snapTo  function sheetDrag  function syncViewport
//       function openExamples  function openCtx  function showTip  function stick  function inertiaStep
//       function renderPaused  const pixelRatio  const renderScale
//       function prepareExamples  function presetFamily  function presetThumb  function randomExample
//       function buildExamples  function filterExSheet  const SOURCES  const FAMILIES

import { SLOTS, defaultScene, fillDefaults, parseFract, serialiseFract, parseValue } from './fract.js';
import { $, stage, canvas, panel, pbody, picker, exSheet, root, el, section, clamp, px, download } from './ui/dom.js';
import { P, CAT, EXAMPLES, COLLECTIONS, byEnum, fnum, groupName, mainSpec, isNone, loadData } from './ui/data.js';
import { scene, activeSlot, engine, currentExample, info, setScene, setActiveSlot, setEngine, setCurrentExample, setInfo, formulaAt,
  touchSeen, noteTouch, touchUI, coarseMQ, targetSamples, SAMPLES_DEFAULT, renderScale, RENDER_SCALE_DEFAULT, pixelRatio } from './ui/state.js';
import { compileStatus, setStatus, flash, msPerSample, setMsPerSample, showHud, fail } from './ui/hud.js';
import { V, camFromScene, camBasis, camToScene, resetCamera, frameView, panBy, orbitBy, lookBy } from './ui/camera.js';
import { sceneDirty, setMain, setSlot, loadScene, pushScene } from './ui/scene.js';
import { ctl, refreshAll, mainBind, slotBind, kindOf, hideTip, initTip } from './ui/controls.js';
import { gradientEditor } from './ui/gradient.js';
import { thumb, presetThumb } from './ui/thumbs.js';

// ─── data ───────────────────────────────────────────────────────────────────
// ─── panel specs ────────────────────────────────────────────────────────────
// Main params shown in the panel. A row is skipped when gen/params.json does
// not list its name. `c` picks one component of a vector param.
const MAIN_UI = [
  { id: 'fractal', title: 'Fractal', open: true, rows: [
    { name: 'N', label: 'Iterations', kind: 'int', min: 1, max: 500 },
    { name: 'bailout', label: 'Bailout', min: 1, max: 1e6, log: true },
    { name: 'DE_factor', label: 'DE factor', min: 0.01, max: 2, log: true, tip: 'Ray step factor. Lower it when the surface shows holes or overstep bands.' },
    { name: 'detail_level', label: 'Detail level', min: 0.05, max: 50, log: true },
    { name: 'repeat_from', label: 'Repeat from', kind: 'int', min: 1, max: 9, tip: 'Hybrid: slot where the sequence repeats after the last slot.' },
  ] },
  { id: 'camera', title: 'Camera', open: false, rows: [
    { name: 'fov', label: 'Field of view', min: 5, max: 160 },
    { name: 'camera_distance_to_target', label: 'Distance', min: 1e-5, max: 50, log: true, cam: true },
  ] },
  { id: 'light', title: 'Light', open: true, rows: [
    { name: 'light1_rotation', c: 'x', label: 'Alpha', min: -180, max: 180, tip: 'Main light horizontal angle, degrees.' },
    { name: 'light1_rotation', c: 'y', label: 'Beta', min: -90, max: 90, tip: 'Main light vertical angle, degrees.' },
    { name: 'light1_intensity', label: 'Intensity', min: 0, max: 5 },
    { name: 'light1_color', label: 'Color' },
    { name: 'light1_cast_shadows', label: 'Shadows' },
    { name: 'light1_soft_shadow_cone', label: 'Softness', min: 0, max: 20, tip: 'Soft shadow cone angle, degrees.' },
  ] },
  { id: 'shading', title: 'Shading', open: false, rows: [
    { name: 'ambient_occlusion_enabled', label: 'AO' },
    { name: 'ambient_occlusion', label: 'AO strength', min: 0, max: 3 },
    { name: 'mat1_shading', label: 'Shading', min: 0, max: 1 },
    { name: 'mat1_specular', label: 'Specular', min: 0, max: 10 },
    { name: 'mat1_specular_width', label: 'Spec. width', min: 0.01, max: 1, log: true },
    { name: 'mat1_use_colors_from_palette', label: 'Use gradient' },
    { gradient: 'mat1_surface_color_gradient' },
    { name: 'mat1_coloring_speed', label: 'Color speed', min: 0.01, max: 50, log: true },
    { name: 'mat1_coloring_palette_offset', label: 'Color offset', min: 0, max: 256 },
    { name: 'mat1_surface_color', label: 'Surface color' },
  ] },
  { id: 'fog', title: 'Fog & glow', open: false, rows: [
    { name: 'basic_fog_enabled', label: 'Fog' },
    { name: 'basic_fog_visibility', label: 'Visibility', min: 0.01, max: 1000, log: true },
    { name: 'basic_fog_color', label: 'Fog color' },
    { name: 'glow_enabled', label: 'Glow' },
    { name: 'glow_intensity', label: 'Glow', min: 0, max: 5 },
    { name: 'glow_color_1', label: 'Glow color 1' },
    { name: 'glow_color_2', label: 'Glow color 2' },
  ] },
  { id: 'background', title: 'Background', open: false, rows: [
    { name: 'background_color_1', label: 'Top' },
    { name: 'background_color_2', label: 'Middle' },
    { name: 'background_color_3', label: 'Bottom' },
  ] },
  { id: 'adjust', title: 'Image adjust', open: false, rows: [
    { name: 'brightness', label: 'Brightness', min: 0, max: 3 },
    { name: 'contrast', label: 'Contrast', min: 0, max: 3 },
    { name: 'gamma', label: 'Gamma', min: 0.1, max: 3 },
    { name: 'saturation', label: 'Saturation', min: 0, max: 3 },
    { name: 'hdr', label: 'HDR' },
  ] },
];

// Per-slot params that upstream shows for every formula (qt/fractal_object.ui
// and qt/fractal_calculation_parameters.ui).
const SLOT_COMMON = [
  { name: 'formula_weight', label: 'Weight', min: 0, max: 1 },
  { name: 'formula_start_iteration', label: 'Start iter.', kind: 'int', min: 0, max: 250 },
  { name: 'formula_stop_iteration', label: 'Stop iter.', kind: 'int', min: 0, max: 250 },
  { name: 'check_for_bailout', label: 'Check bailout' },
  { name: 'dont_add_c_constant', label: "Don't add C" },
  { name: 'julia_mode', label: 'Julia mode' },
  { name: 'julia_c', label: 'Julia C', min: -5, max: 5 },
  { name: 'fractal_constant_factor', label: 'Constant factor', min: -5, max: 5 },
  { name: 'initial_waxis', label: 'Initial w', min: -5, max: 5 },
  { name: 'formula_maxiter', label: 'Max iter.', kind: 'int', min: 1, max: 1000 },
];

// Upstream credit: the same text is in the header comment of index.html.
const CREDIT = {
  html: 'Mandelbulber by Krzysztof Marczak and the Mandelbulber team, GPL-3.0, '
    + '<a href="https://github.com/buddhi1980/mandelbulber2" target="_blank" rel="noopener">github.com/buddhi1980/mandelbulber2</a>, commit 600da8d.',
};

// ─── small DOM helpers ──────────────────────────────────────────────────────
// ─── thumbnails ─────────────────────────────────────────────────────────────
// ─── control rows ───────────────────────────────────────────────────────────
// ─── scene changes ──────────────────────────────────────────────────────────
// ─── panel ──────────────────────────────────────────────────────────────────
export let slotBox, slotStrip, progressEl, sampleLine, exList, exSearch;
let resizeCanvas = null, resizePending = false;      // set in boot once the engine runs

function buildPanel() {
  // Image: progress, target samples, file actions
  progressEl = el('div', { class: 'progress' }, el('i'));
  sampleLine = el('p', { class: 'spec' });
  const tsRow = ctl({ label: 'Target samples', kind: 'int', min: 1, max: 4096, log: true, tip: 'Stop when this many samples have accumulated.' },
    { get: () => targetSamples.value, set: (v) => { targetSamples.value = clamp(Math.round(v), 1, 65536); engine?.setMaxSamples?.(targetSamples.value); refreshAll(); }, def: SAMPLES_DEFAULT });
  const prRow = ctl({ label: 'Pixel ratio', kind: 'double', min: 0.5, max: 2, tip: 'Render pixels per CSS pixel, capped at the device ratio. Lower is faster.' },
    { get: () => renderScale.value, set: (v) => { renderScale.value = clamp(Math.round(v * 4) / 4, 0.5, 2); refreshAll(); resizeCanvas?.(); }, def: RENDER_SCALE_DEFAULT });
  pbody.append(section('image', 'Image', true, progressEl, sampleLine, tsRow, prRow,
    el('div', { class: 'buttons' },
      el('button', { type: 'button', class: 'primary', onclick: savePng, title: 'Save the accumulated image as PNG' }, 'Render PNG'),
      el('button', { type: 'button', onclick: exportFract, title: 'Download the scene as a .fract file' }, 'Export .fract'),
      el('button', { type: 'button', onclick: () => $('file').click(), title: 'Load a .fract file (or drop one on the page)' }, 'Import'),
      el('button', { type: 'button', onclick: copyLink, title: 'Copy a link that holds the scene' }, 'Copy link'),
      el('button', { type: 'button', onclick: () => { setCurrentExample(-1); markExample(); loadScene(defaultScene(P), 'scene reset'); } }, 'Reset'))));

  // Presets: upstream examples, upstream collections, site originals
  exSearch = el('input', { class: 'exsearch', type: 'search', placeholder: `Search ${EXAMPLES.length} presets`, 'aria-label': 'Search presets' });
  exList = el('div', { class: 'exlist' });
  exSearch.addEventListener('input', filterExamples);
  let lastGroup = null;
  EXAMPLES.forEach((e, i) => {
    if (e.group !== lastGroup) { lastGroup = e.group; exList.append(el('h3', { 'data-g': e.group }, e.group)); }
    const b = el('button', { type: 'button', class: 'ex', title: presetTitle(e), 'data-i': i }, presetThumb(e, 32), el('span', {}, e.name));
    b.addEventListener('click', () => loadExample(i));
    exList.append(b);
  });
  const browse = el('div', { class: 'buttons exbrowse' },
    el('button', { type: 'button', onclick: openExamples }, `Browse ${EXAMPLES.length} presets`),
    el('button', { type: 'button', onclick: randomExample, title: 'Load a random preset' }, 'Random'));
  pbody.append(section('examples', 'Presets', false, browse, exSearch, exList));

  // Formula slots
  slotStrip = el('div', { class: 'slots' });
  slotBox = el('div');
  const hyb = P.main.hybrid_fractal_enable ? ctl({ label: 'Hybrid', kind: 'bool', name: 'hybrid_fractal_enable', tip: 'Chain the formulas of slots 1 to 9.' }, mainBind('hybrid_fractal_enable')) : null;
  pbody.append(section('formula', 'Formula', true, hyb, slotStrip, slotBox));
  buildSlotEditor();

  // Main param groups
  for (const g of MAIN_UI) {
    const rows = [];
    for (const r of g.rows) {
      if (r.gradient) { if (mainSpec(r.gradient)) rows.push(gradientEditor(r.gradient)); continue; }
      const b = mainBind(r.name, r.c);
      if (!b) continue;
      const type = r.c ? 'double' : mainSpec(r.name).type;
      const bind = r.cam ? { ...b, set: (v) => { const c = camFromScene(); c.dist = v; camToScene(c); } } : b;
      rows.push(ctl({ kind: r.kind || (mainSpec(r.name).options && !r.c ? 'list' : kindOf(type)), options: mainSpec(r.name).options, ...r }, bind));
    }
    if (g.id === 'camera') {
      rows.push(el('div', { class: 'buttons' },
        el('button', { type: 'button', onclick: resetCamera }, 'Reset view'),
        el('button', { type: 'button', onclick: () => frameView(false), title: 'Move the camera so that the whole surface fits the view (V)' }, 'Frame'),
        el('button', { type: 'button', onclick: toggleFly, id: 'flyBtn2' }, 'Fly mode')));
      const keysHelp = el('p', { class: 'spec' });
      rows.push(keysHelp);
      keysHelp.innerHTML = '<kbd>drag</kbd> orbit · <kbd>wheel</kbd> dolly · <kbd>right drag</kbd> or <kbd>Shift</kbd> pan · ' +
        '<kbd>F</kbd> fly: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move, <kbd>Q</kbd><kbd>E</kbd> down / up, drag to look · <kbd>V</kbd> frame · <kbd>P</kbd> panel';
    }
    if (rows.length) pbody.append(section(g.id, g.title, g.open, ...rows));
  }

  const about = section('about', 'About / credits', false);
  about.querySelector('.body').innerHTML = `
    <p class="spec credit">${CREDIT.html}</p>
    <p class="spec"><b>Presets.</b> The upstream examples come with Mandelbulber. The upstream collections are by
    ${COLLECTIONS.filter((c) => c.allowed).map((c) => `${c.author} (<a href="${c.licenceUrl}" target="_blank" rel="noopener">${c.licence}</a>)`).join(', ') || 'none loaded'};
    the scenes are migrated to the current settings and not changed. The site originals are made for this page.
    See <a href="${new URL('gen/CREDITS-examples.md', import.meta.url).href}" target="_blank" rel="noopener">CREDITS-examples.md</a>.</p>
    <p class="spec">This page is a WebGPU port of that program. The formulas are translated from the upstream OpenCL
    kernels to WGSL in 32-bit floats, so deep zooms lose precision earlier than upstream's 64-bit mode.
    The license text is in <a href="${new URL('COPYING', import.meta.url).href}" target="_blank" rel="noopener">COPYING</a>.</p>
    <p class="spec"><b>Hybrid slots.</b> With <code>Hybrid</code> on, each iteration runs the slot formulas in order, each for its
    own iteration count, then repeats from <code>Repeat from</code>.</p>
    <p class="spec"><b>Files.</b> Import reads upstream <code>.fract</code> files (drop one on the page). Export writes only the
    params that differ from the defaults, as upstream does. <code>Copy link</code> puts the same diff in the URL.</p>`;
  pbody.append(about);
}

export function buildSlotEditor() {
  if (!slotStrip) return;
  const hybrid = !!scene.main.hybrid_fractal_enable;
  if (!hybrid) setActiveSlot(0);
  slotStrip.replaceChildren(...[...Array(SLOTS)].map((_, s) => {
    const f = formulaAt(s);
    const b = el('button', { type: 'button', class: `slot${s === activeSlot ? ' active' : ''}${!hybrid && s > 0 ? ' off' : ''}`,
      title: `Slot ${s + 1}: ${isNone(f) ? 'none' : f.name}${!hybrid && s > 0 ? ' (turn on Hybrid to use it)' : ''}` },
    thumb(f, null), el('b', {}, String(s + 1)));
    b.addEventListener('click', () => {
      if (!hybrid && s > 0) setMain('hybrid_fractal_enable', true);
      setActiveSlot(s); buildSlotEditor();
    });
    return b;
  }));

  const s = activeSlot;
  const f = formulaAt(s);
  const kids = [];
  const pick = el('button', { type: 'button', class: 'formula-pick', title: 'Choose the formula of this slot' },
    thumb(f, 52),
    el('span', {}, el('strong', {}, isNone(f) ? 'None' : f.name), el('small', {}, `Slot ${s + 1}${isNone(f) ? '' : ` · ${f.id}`}`)),
    el('em', {}, 'Change'));
  pick.addEventListener('click', () => openPicker(s));
  kids.push(pick);

  const itName = `formula_iterations_${s + 1}`;
  if (P.main[itName]) kids.push(ctl({ label: 'Slot iterations', kind: 'int', min: 1, max: 20, name: itName, tip: 'Iterations of this slot before the next slot runs (hybrid).' }, mainBind(itName)));
  else if (P.fractal.formula_iterations) kids.push(ctl({ label: 'Slot iterations', kind: 'int', min: 1, max: 20 }, slotBind(s, 'formula_iterations')));

  if (!isNone(f)) {
    const groups = new Map();
    for (const p of f.params || []) {
      if (!P.fractal[p.name]) continue;
      const g = p.group || 'Params';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(p);
    }
    let first = true;
    for (const [g, list] of groups) {
      const d = el('details', { open: first || undefined });
      d.append(el('summary', {}, g, el('small', {}, String(list.length))));
      for (const p of list) {
        const kind = p.kind === 'list' ? 'list' : p.kind || kindOf(P.fractal[p.name].type);
        const gate = p.enabledBy && P.fractal[p.enabledBy] ? () => !scene.fractal[s][p.enabledBy] : null;
        d.append(ctl({ ...p, kind, label: p.label || p.name, options: p.options || P.fractal[p.name].options, dimIf: gate }, slotBind(s, p.name)));
      }
      kids.push(d);
      first = false;
    }
    if (!groups.size) kids.push(el('p', { class: 'spec' }, 'This formula has no params of its own.'));
  }

  const common = el('details', {});
  common.append(el('summary', {}, 'Slot common', el('small', {}, 'weight, iterations, Julia')));
  for (const c of SLOT_COMMON) {
    const key = P.main[`${c.name}_${s + 1}`] ? `${c.name}_${s + 1}` : null;   // per-slot general params live in main as <base>_<k>
    const bind = key ? mainBind(key) : slotBind(s, c.name);
    if (!bind) continue;
    const type = (key ? P.main[key] : P.fractal[c.name]).type;
    common.append(ctl({ ...c, name: key || c.name, kind: c.kind || kindOf(type) }, bind));
  }
  if (common.children.length > 1) kids.push(common);
  if (!hybrid) kids.push(el('p', { class: 'spec' }, 'Turn on Hybrid to chain formulas in slots 2 to 9.'));
  slotBox.replaceChildren(...kids);
}

// ─── formula picker ─────────────────────────────────────────────────────────
let pickerSlot = 0;
let pickerTiles = null;

function buildPicker() {
  const body = $('pickerBody');
  pickerTiles = [];
  const groups = new Map();
  for (const g of CAT.groups || []) groups.set(typeof g === 'string' ? g : g.name ?? g.id, []);
  for (const f of CAT.formulas) {
    if (isNone(f)) continue;
    const g = groupName(f);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(f);
  }
  const none = { id: 'none', name: 'None', enumId: 0 };
  const mk = (f) => {
    const t = el('button', { type: 'button', class: 'tile', title: `${f.name} (${f.id})` }, thumb(f, 64), el('span', {}, f.name));
    t.addEventListener('click', () => choose(f));
    pickerTiles.push({ t, f, key: `${f.name} ${f.id}`.toLowerCase() });
    return t;
  };
  const blocks = [];
  blocks.push({ h: el('h3', {}, 'None'), grid: el('div', { class: 'grid' }, mk(none)) });
  for (const [g, list] of groups) {
    if (!list.length) continue;
    list.sort((a, b) => a.name.localeCompare(b.name));
    blocks.push({ h: el('h3', {}, g, el('small', {}, String(list.length))), grid: el('div', { class: 'grid' }, ...list.map(mk)) });
  }
  body.replaceChildren(...blocks.flatMap((b) => [b.h, b.grid]), el('p', { class: 'empty', hidden: true }, 'No formula matches.'));
  pickerTiles.blocks = blocks;
}

function filterPicker() {
  const q = $('pickerSearch').value.trim().toLowerCase();
  let any = 0;
  for (const { t, key } of pickerTiles) { const ok = !q || q.split(/\s+/).every((w) => key.includes(w)); t.hidden = !ok; any += ok; }
  for (const b of pickerTiles.blocks) {
    const n = [...b.grid.children].filter((c) => !c.hidden).length;
    b.h.hidden = !n;
    const small = b.h.querySelector('small');
    if (small) small.textContent = String(n);
  }
  $('pickerBody').querySelector('.empty').hidden = any > 0;
}

function openPicker(s) {
  if (!pickerTiles) buildPicker();
  pickerSlot = s;
  const cur = scene.main[`formula_${s + 1}`];
  for (const { t, f } of pickerTiles) t.classList.toggle('cur', fnum(f) === cur);
  openSheet(picker);
  $('pickerSearch').value = '';
  filterPicker();
  const c = pickerTiles.find((p) => fnum(p.f) === cur);
  c?.t.scrollIntoView({ block: 'center' });
  if (matchMedia('(pointer: fine)').matches) $('pickerSearch').focus();
}
function closePicker() { closeSheet(picker); }
function choose(f) {
  closePicker();
  setMain(`formula_${pickerSlot + 1}`, fnum(f));
  // a new shape in slot 1 can enclose the camera: fit the view, unless an example sets it
  if (pickerSlot === 0 && currentExample < 0 && !isNone(f)) frameView(true);
}
$('pickerSearch').addEventListener('input', filterPicker);
$('pickerSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {                           // exact name, then name prefix, then first match
    const q = e.target.value.trim().toLowerCase();
    const vis = pickerTiles.filter((p) => !p.t.hidden);
    const t = vis.find((p) => p.f.name.toLowerCase() === q) || vis.find((p) => p.f.name.toLowerCase().startsWith(q)) || vis[0];
    if (t) choose(t.f);
  }
  if (e.key === 'Escape') closePicker();
});
$('pickerClose').addEventListener('click', closePicker);

// ─── gradient editor (mat1_surface_color_gradient) ──────────────────────────
// ─── presets ────────────────────────────────────────────────────────────────
// Three sources, in this order: the upstream examples (gen/examples.json), the upstream
// collections whose licence allows commercial use (gen/collections.json, one group per author,
// with the author and the licence shown), and the site originals (gen/originals.json).
// Each preset gets a key ("e:<file>", "c:<folder>/<file>", "o:<id>") for its thumbnail in
// gen/preset-thumbs.jpg, and a formula family for the filter chips.
const SOURCES = [['all', 'All'], ['e', 'Upstream examples'], ['c', 'Upstream collections'], ['o', 'Site originals']];
const FAMILIES = ['Bulbs', 'Boxes', 'IFS & kaleidoscopic', '4D & quaternion', 'Kleinian', 'dIFS', 'Hybrids', 'Other'];

// Family from the formulas in use. Two or more formulas, or a formula with a transform, is a hybrid.
function presetFamily(e) {
  const m = e.main || {};
  const hybrid = !!m.hybrid_fractal_enable;
  const used = [];
  for (let k = 1; k <= SLOTS; k++) {
    const n = m[`formula_${k}`] ?? (k === 1 ? P.main.formula_1?.default : 0);
    if (!n || (k > 1 && !hybrid)) continue;
    const f = byEnum.get(n);
    if (f && !used.includes(f)) used.push(f);
  }
  const shapes = used.filter((f) => groupName(f) !== 'Transforms');
  if (shapes.length > 1 || (shapes.length && used.length > shapes.length)) return 'Hybrids';
  const f = shapes[0] || used[0];
  if (!f) return 'Other';
  const id = `${f.file} ${f.name}`.toLowerCase(), g = groupName(f).toLowerCase();
  if (g.includes('kleinian') || id.includes('kleinian')) return 'Kleinian';
  if (g.includes('difs') || /^difs/.test(f.file)) return 'dIFS';
  if (/4d|quaternion|quat\b|hypercomplex|aexion|bristorbrot|hopf/.test(id)) return '4D & quaternion';
  if (/box|surf|kali|mandalay|pseudo|tglad/.test(id)) return 'Boxes';
  if (/menger|sierpinski|ifs|octahedron|icosa|dodeca|tetra|vicsek|koch|spheretree|knot|polyhedr|fold_cut|kaleid|platonic|prism|cross/.test(id)) return 'IFS & kaleidoscopic';
  if (/bulb|bar|riemann|cup|torus|benesi|msltoe|xenodreamie|lkmitch|makin|quadrat|kosalos|lambda|power|mandel|julia/.test(id)) return 'Bulbs';
  return 'Other';
}

export function prepareExamples(raw, col, orig) {
  const list = (r) => (Array.isArray(r) ? r : r?.examples || r?.presets || []);
  const out = [];
  const add = (e, src, extra) => {
    const name = e.name || e.title || e.file || e.id || 'preset';
    const x = { ...e, ...extra, src, name, _formula: e.formula_1 ?? e.main?.formula_1 ?? P.main.formula_1?.default };
    x.family = presetFamily(x);
    x.key = src === 'o' ? `o:${e.id}` : `${src}:${e.file}`;
    const f = byEnum.get(x._formula);
    x.search = `${name} ${f?.name || ''} ${f?.file || ''} ${x.family} ${x.group} ${x.author || ''}`.toLowerCase();
    out.push(x);
  };
  for (const e of list(raw)) add(e, 'e', { group: 'Upstream examples' });
  for (const e of list(col)) {
    const c = COLLECTIONS[e.collection];
    if (!c) continue;
    add(e, 'c', { group: `${c.author}${c.subject ? ` (${c.subject})` : ''} · ${c.licence}`, author: c.author, licence: c.licence, licenceUrl: c.licenceUrl });
  }
  for (const e of list(orig)) add(e, 'o', { group: 'Site originals' });
  return out;
}

function presetTitle(e) {
  const f = byEnum.get(e._formula);
  return `${e.name}${f ? ` · ${f.name}` : ''} · ${e.family}${e.author ? ` · by ${e.author}, ${e.licence}` : e.src === 'o' ? ' · site original' : ''}`;
}

// A random preset from the ones the sheet filters show (all presets when the sheet is closed).
function randomExample() {
  const open = !exSheet.classList.contains('hidden') && exTiles;
  const pool = open ? exTiles.filter((x) => !x.t.hidden).map((x) => x.i) : EXAMPLES.map((_, i) => i);
  if (!pool.length) return;
  let i = pool[Math.floor(Math.random() * pool.length)];
  if (i === currentExample && pool.length > 1) i = pool[(pool.indexOf(i) + 1) % pool.length];
  if (open) { closeExamples(); if (L.mode === 'sheet' && L.snap === 'full') snapTo('half'); }
  loadExample(i);
}

function exampleScene(e) {
  if (typeof e.text === 'string') return parseFract(e.text, P).scene;
  // gen/examples.json holds only the params each file sets, already migrated.
  const src = e.scene || e.params || { main: e.main, fractal: e.fractal };
  const val = (d, v) => (typeof v === 'string' && d.type !== 'string' ? parseValue(d, v) : structuredClone(v));
  const part = { main: {}, fractal: [] };
  for (const [k, v] of Object.entries(src.main || {})) { const d = mainSpec(k); if (d && v !== null && v !== undefined) part.main[k] = val(d, v); }
  const fr = src.fractal || [];
  const entries = Array.isArray(fr) ? fr.map((f, i) => [i, f]) : Object.entries(fr).map(([k, f]) => [Number(k) - 1, f]);
  for (const [i, f] of entries) {
    if (!(i >= 0 && i < SLOTS)) continue;
    while (part.fractal.length <= i) part.fractal.push({});
    for (const [k, v] of Object.entries(f || {})) if (P.fractal[k] && v !== null && v !== undefined) part.fractal[i][k] = val(P.fractal[k], v);
  }
  return fillDefaults(part, P);
}

function loadExample(i) {
  const e = EXAMPLES[i];
  if (!e) return;
  setCurrentExample(i);
  markExample();
  loadScene(exampleScene(e), `${e.src === 'o' ? 'site original' : 'example'}: ${e.name}${e.author ? ` · by ${e.author} (${e.licence})` : ''}`);
}
function markExample() { exList?.querySelectorAll('.ex').forEach((b) => b.classList.toggle('cur', Number(b.dataset.i) === currentExample)); }
function filterExamples() {
  const words = exSearch.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = new Set();
  exList.querySelectorAll('.ex').forEach((b) => {
    const e = EXAMPLES[Number(b.dataset.i)];
    b.hidden = !words.every((w) => e.search.includes(w));
    if (!b.hidden) shown.add(e.group);
  });
  exList.querySelectorAll('h3').forEach((h) => { h.hidden = !shown.has(h.dataset.g); });
}

// ─── import / export / share ────────────────────────────────────────────────
function loadText(text, name = 'file') {
  const { scene: sc, meta } = parseFract(text, P);
  setCurrentExample(-1);
  markExample();
  loadScene(sc, `${name}: loaded${meta.skipped.length ? `, ${meta.skipped.length} params not supported` : ''}`);
  if (meta.skipped.length) console.info('[mandelbulber] params not supported:', meta.skipped.join(' '));
  return meta;
}

function exportText() { return serialiseFract(scene, P); }

function exportFract() {
  const f = formulaAt(0);
  const base = currentExample >= 0 ? EXAMPLES[currentExample].name : (isNone(f) ? 'scene' : f.id);
  download(new Blob([exportText()], { type: 'text/plain' }), `${base}.fract`);
}

$('file').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (f) loadText(await f.text(), f.name);
  e.target.value = '';
});
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; stage.classList.add('dropping'); } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; stage.classList.remove('dropping'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  stage.classList.remove('dropping');
  const f = e.dataTransfer?.files?.[0];
  if (f) loadText(await f.text(), f.name);
});

// Share: the .fract diff text, deflated, base64url, in #s=
const b64url = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }

async function shareHash(sc = scene) {
  const body = (x) => serialiseFract(x, P).split('\n').filter((l) => l && !l.startsWith('#')).join('\n');
  const text = body(sc);
  if (text === body(defaultScene(P))) return '';
  return `s=${b64url(await pipe(new TextEncoder().encode(text), new CompressionStream('deflate-raw')))}`;
}
async function decodeShare(hash) {
  const m = String(hash).match(/(?:^|[#&])s=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  const text = new TextDecoder().decode(await pipe(unb64url(m[1]), new DecompressionStream('deflate-raw')));
  return parseFract(`# version 2.33\n${text}`, P).scene;
}

let hashTimer = 0;
export function writeHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(async () => {
    const h = await shareHash();
    history.replaceState(null, '', h ? `#${h}` : location.pathname + location.search);
  }, 400);
}
async function readHash() {
  try { return await decodeShare(location.hash); } catch (e) { console.warn('[mandelbulber] bad share link', e); return null; }
}
async function copyLink() {
  clearTimeout(hashTimer);
  const h = await shareHash();
  history.replaceState(null, '', h ? `#${h}` : location.pathname + location.search);
  try { await navigator.clipboard.writeText(location.href); flash('link copied'); } catch { flash('copy the link from the address bar'); }
}

// ─── camera (upstream cCameraTarget) ────────────────────────────────────────
// ─── camera input ───────────────────────────────────────────────────────────
// Mouse: drag orbit, right or Shift drag pan, wheel dolly. Touch: one finger orbit, two
// fingers pinch (dolly) and drag (pan), double tap Frame, long press menu. A touch orbit
// keeps turning after release and slows down (inertia); any new input stops it.
let flying = false;
const keys = new Set();
const pointers = new Map();
let dragCam = null, gest = null, lastTap = null, lpTimer = 0;
const inertia = { on: false, vx: 0, vy: 0, cam: null };
const fly = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 } };   // thumbstick values, -1..1

function toggleFly() {
  stopInertia();
  flying = !flying;
  document.body.classList.toggle('flying', flying);
  $('flyBtn').classList.toggle('on', flying);
  $('flyBtn2')?.classList.toggle('on', flying);
  if (flying && L.mode === 'sheet' && L.snap !== 'peek') snapTo('peek');
  flash(flying ? (touchUI() ? 'fly mode: left stick moves, right stick looks' : 'fly mode: W A S D move, Q E down / up, drag to look') : 'orbit mode');
}
$('flyBtn').addEventListener('click', toggleFly);

const two = () => { const [a, b] = [...pointers.values()]; return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d: Math.hypot(a.x - b.x, a.y - b.y) }; };

window.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch' && !touchSeen) { noteTouch(); applyLayout(); }
  if (!e.target.closest?.('#ctx')) hideCtx();
  if (!e.target.closest?.('#tip, .ctl .k')) hideTip();
}, true);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  stopInertia();
  canvas.setPointerCapture(e.pointerId);
  const now = performance.now();
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: now, button: e.button, type: e.pointerType, hist: [{ x: e.clientX, y: e.clientY, t: now }] });
  canvas.classList.add('dragging');
  dragCam = camFromScene();
  if (pointers.size === 1) {
    gest = { multi: false, moved: false, lp: false };
    if (e.pointerType !== 'mouse') {
      lpTimer = setTimeout(() => {
        if (pointers.size === 1 && gest && !gest.moved) { gest.lp = true; openCtx(e.clientX, e.clientY); }
      }, 520);
    }
  } else if (gest) {
    clearTimeout(lpTimer);
    gest.multi = true; gest.moved = true;
    const t = two(); gest.mid = t.mid; gest.d = t.d;
  }
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p || !dragCam || !gest) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  const now = performance.now();
  p.hist.push({ x: p.x, y: p.y, t: now });
  if (p.hist.length > 8) p.hist.shift();
  if (!gest.moved && Math.hypot(p.x - p.x0, p.y - p.y0) > 8) { gest.moved = true; clearTimeout(lpTimer); }
  if (gest.lp) return;
  const c = dragCam;
  if (pointers.size >= 2) {                              // pinch = dolly, midpoint drag = pan
    const t = two();
    if (gest.d > 0 && t.d > 0) c.dist = clamp(c.dist * gest.d / t.d, 1e-6, 1e6);
    panBy(c, t.mid.x - gest.mid.x, t.mid.y - gest.mid.y);
    gest.mid = t.mid; gest.d = t.d;
  } else if (gest.multi) return;                         // one finger left after a pinch: wait
  else if (p.button === 2 || e.shiftKey) panBy(c, dx, dy);
  else if (flying) lookBy(c, dx * 0.004, dy * 0.004);
  else orbitBy(c, dx, dy);
  camToScene(c, true);
});
const endPointer = (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  pointers.delete(e.pointerId);
  clearTimeout(lpTimer);
  const now = performance.now();
  const g = gest;
  if (e.type === 'pointerup' && p.type !== 'mouse' && g && !g.multi && !g.lp && !g.moved && now - p.t0 < 300) {
    if (lastTap && now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) { lastTap = null; frameView(false); }
    else lastTap = { t: now, x: e.clientX, y: e.clientY };
  }
  if (pointers.size) return;
  if (e.type === 'pointerup' && p.type !== 'mouse' && !flying && g && g.moved && !g.multi && !g.lp && dragCam) {
    p.hist.push({ x: e.clientX, y: e.clientY, t: now });
    const h = p.hist.filter((q) => now - q.t < 90);
    if (h.length >= 2) {
      const a = h[0], b = h[h.length - 1], dt = Math.max(b.t - a.t, 8);
      const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;   // CSS px per ms
      if (Math.hypot(vx, vy) > 0.25) Object.assign(inertia, { on: true, vx, vy, cam: dragCam });
    }
  }
  canvas.classList.remove('dragging');
  dragCam = null; gest = null;
  if (!inertia.on) refreshAll();
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  stopInertia();
  const c = camFromScene();
  c.dist = clamp(c.dist * Math.exp(e.deltaY * 0.0015), 1e-6, 1e6);
  camToScene(c, true);
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(refreshAll, 200);
}, { passive: false });
let wheelTimer = 0;

function inertiaStep(dt) {
  if (!inertia.on) return;
  orbitBy(inertia.cam, inertia.vx * 1000 * dt, inertia.vy * 1000 * dt);
  const k = Math.exp(-dt * 3.5);
  inertia.vx *= k; inertia.vy *= k;
  camToScene(inertia.cam, true);
  if (Math.hypot(inertia.vx, inertia.vy) < 0.02) stopInertia();
}
export function stopInertia() {
  if (!inertia.on) return;
  inertia.on = false; inertia.cam = null;
  refreshAll();
}

// Fly step: keys and thumbsticks. Speed follows the distance estimate when the engine reports one.
function flyStep(dt) {
  if (!flying) return;
  const mag = (v) => Math.hypot(v.x, v.y);
  const sticks = mag(fly.move) > 0.04 || mag(fly.look) > 0.04;
  if (!keys.size && !sticks) return;
  const c = camFromScene();
  if (mag(fly.look) > 0.04) lookBy(c, fly.look.x * Math.abs(fly.look.x) * 1.8 * dt, fly.look.y * Math.abs(fly.look.y) * 1.4 * dt);
  const { fwd, right, top } = camBasis(c);
  let mv = { x: 0, y: 0, z: 0 };
  if (keys.has('w')) mv = V.add(mv, fwd);
  if (keys.has('s')) mv = V.sub(mv, fwd);
  if (keys.has('d')) mv = V.add(mv, right);
  if (keys.has('a')) mv = V.sub(mv, right);
  if (keys.has('e')) mv = V.add(mv, top);
  if (keys.has('q')) mv = V.sub(mv, top);
  let amount = V.len(mv) ? 1 : 0;
  if (mag(fly.move) > 0.04) {
    mv = V.add(mv, V.add(V.mul(fwd, -fly.move.y), V.mul(right, fly.move.x)));
    amount = Math.max(amount, Math.min(1, mag(fly.move)));
  }
  if (V.len(mv)) {
    const de = Number(engine?.distanceEstimate?.() ?? info?.distance ?? NaN);
    const scale = Number.isFinite(de) && de > 0 ? de : c.dist;
    const speed = scale * 0.6 * (keys.has('shift') ? 4 : 1) * amount;
    c.target = V.add(c.target, V.mul(V.norm(mv), speed * dt));
  }
  camToScene(c, true);
}

// One thumbstick: writes -1..1 into out while a finger holds it.
function stick(elm, out) {
  const knob = elm.querySelector('i');
  let id = null;
  const update = (e) => {
    const r = elm.getBoundingClientRect(), R = r.width / 2, m = R * 0.62;
    let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R);
    const l = Math.hypot(dx, dy);
    if (l > m) { dx *= m / l; dy *= m / l; }
    out.x = dx / m; out.y = dy / m;
    knob.style.setProperty('--kx', `${dx}px`); knob.style.setProperty('--ky', `${dy}px`);
  };
  elm.addEventListener('pointerdown', (e) => { e.preventDefault(); stopInertia(); id = e.pointerId; elm.setPointerCapture(id); update(e); });
  elm.addEventListener('pointermove', (e) => { if (e.pointerId === id) update(e); });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null; out.x = 0; out.y = 0;
    knob.style.setProperty('--kx', '0px'); knob.style.setProperty('--ky', '0px');
    refreshAll();
  };
  elm.addEventListener('pointerup', end);
  elm.addEventListener('pointercancel', end);
}
stick($('stickL'), fly.move);
stick($('stickR'), fly.look);

// Long-press menu on the canvas.
const ctxMenu = $('ctx');
function openCtx(x, y) {
  ctxMenu.querySelector('[data-a=fly]').textContent = flying ? 'Leave fly mode' : 'Fly mode';
  ctxMenu.hidden = false;
  const w = ctxMenu.offsetWidth, h = ctxMenu.offsetHeight;
  ctxMenu.style.left = `${clamp(x - w / 2, 8, innerWidth - w - 8)}px`;
  ctxMenu.style.top = `${clamp(y - h - 16, 8, innerHeight - h - 8)}px`;
  navigator.vibrate?.(8);
}
function hideCtx() { ctxMenu.hidden = true; }
ctxMenu.addEventListener('click', (e) => {
  const a = e.target.closest('button')?.dataset.a;
  hideCtx();
  if (a === 'frame') frameView(false);
  else if (a === 'reset') resetCamera();
  else if (a === 'fly') toggleFly();
});

initTip();

// ─── layout: floating panel, bottom sheet, right drawer ─────────────────────
// float: fine pointer and a wide window. sheet: portrait phone. drawer: landscape phone
// or tablet. In sheet and drawer mode the canvas shrinks to the free area (--cover-b,
// --cover-r), so the camera target, orbit and Frame center where the user can see them.
// A snap to another sheet height resizes the canvas once; a drag only stretches it.
const L = { mode: '', snap: 'peek', y: 0, full: 0, peek: 88, half: 320, drawerW: 340, drag: null, focusSnap: null };
let sheetDragging = false;
const safeProbe = el('div', { style: 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;'
  + 'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)' });
document.body.append(safeProbe);
function safeInsets() {
  const cs = getComputedStyle(safeProbe);
  return { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
}

function pickMode() {
  const w = innerWidth, h = innerHeight;
  const phone = w <= 720 || (coarseMQ.matches && Math.min(w, h) < 720);
  if (phone) return w > h ? 'drawer' : 'sheet';
  return coarseMQ.matches ? 'drawer' : 'float';
}
const snapH = (s) => (s === 'full' ? L.full : s === 'half' ? L.half : L.peek);
function setSheetY(y, dragging) {
  L.y = y;
  root.style.setProperty('--sheet-y', px(y));
  if (!dragging) root.style.setProperty('--sheet-hidden', px(Math.max(0, y)));
}

function applyLayout() {
  const mode = pickMode();
  if (mode !== L.mode) {
    document.body.classList.remove('mode-float', 'mode-sheet', 'mode-drawer');
    document.body.classList.add(`mode-${mode}`);
    L.mode = mode;
  }
  document.body.classList.toggle('touchfly', touchUI());
  const ins = safeInsets();
  const hidden = panel.classList.contains('hidden');
  let coverB = 0, coverR = 0;
  if (mode === 'sheet') {
    L.full = Math.round(innerHeight - ins.top - 8);
    root.style.setProperty('--sheet-full', px(L.full));
    const pk = $('peek');
    L.peek = Math.round(pk.offsetTop + pk.offsetHeight + ins.bottom);
    L.half = Math.round(clamp(innerHeight * 0.5, L.peek + 120, L.full));
    if (!L.drag) setSheetY(L.full - snapH(L.snap));
    coverB = hidden ? 0 : Math.min(snapH(L.snap), L.half);
  } else if (mode === 'drawer') {
    L.drawerW = Math.round(clamp(innerWidth * 0.42, 280, 360) + ins.right);
    root.style.setProperty('--drawer-w', px(L.drawerW));
    coverR = hidden ? 0 : L.drawerW;
  }
  root.style.setProperty('--cover-b', px(coverB));
  root.style.setProperty('--cover-r', px(coverR));
  syncViewport();
}
let layoutQueued = false;
function queueLayout() { if (layoutQueued) return; layoutQueued = true; requestAnimationFrame(() => { layoutQueued = false; applyLayout(); }); }
window.addEventListener('resize', queueLayout);
window.addEventListener('orientationchange', queueLayout);
coarseMQ.addEventListener?.('change', queueLayout);

function snapTo(s) {
  L.snap = s;
  panel.classList.remove('hidden');
  applyLayout();
}
function togglePanel() { panel.classList.toggle('hidden'); applyLayout(); }

// Sheet drag: from the grab handle, the header and the peek bar (pointer events), and from
// the panel body when it is scrolled to the top and the finger pulls down (touch events).
function sheetDragBegin(y) {
  L.drag = { y0: y, h0: L.full - L.y, samples: [{ y, t: performance.now() }] };
  sheetDragging = true;
  stopInertia();
  panel.classList.add('dragging');
}
function sheetDragMove(y) {
  const d = L.drag;
  const vis = clamp(d.h0 - (y - d.y0), L.peek * 0.6, L.full);
  d.samples.push({ y, t: performance.now() });
  if (d.samples.length > 6) d.samples.shift();
  setSheetY(L.full - vis, true);
  root.style.setProperty('--cover-b', px(Math.min(vis, L.half)));   // the canvas stretches until the snap
}
function sheetDragEnd() {
  const d = L.drag;
  if (!d) return;
  const now = performance.now();
  d.samples.push({ y: d.samples[d.samples.length - 1].y, t: now });   // a finger that stopped has no speed
  const recent = d.samples.filter((q) => now - q.t < 100);
  const a = recent[0], b = recent[recent.length - 1];
  const v = recent.length > 1 ? (b.y - a.y) / Math.max(b.t - a.t, 8) : 0;   // px per ms, + is down
  const vis = L.full - L.y;
  const order = ['peek', 'half', 'full'];
  let s = order.reduce((best, k) => (Math.abs(snapH(k) - (vis - v * 160)) < Math.abs(snapH(best) - (vis - v * 160)) ? k : best), 'peek');
  if (Math.abs(v) > 0.5) {                                           // a flick moves at least one step
    const cur = order.reduce((best, k) => (Math.abs(snapH(k) - vis) < Math.abs(snapH(best) - vis) ? k : best), 'peek');
    const i = order.indexOf(cur) + (v > 0 ? -1 : 1);
    if (order.indexOf(s) === order.indexOf(cur)) s = order[clamp(i, 0, 2)];
  }
  L.drag = null;
  sheetDragging = false;
  panel.classList.remove('dragging');
  snapTo(s);
  if (resizePending) { resizePending = false; resizeCanvas?.(); }
}
const dragZone = (t) => t.closest?.('#grab, #panel > header, #peek');
let sheetPtr = null;
panel.addEventListener('pointerdown', (e) => {
  if (L.mode !== 'sheet' || !dragZone(e.target) || L.drag) return;
  sheetPtr = { id: e.pointerId, y0: e.clientY, moved: false, grab: !!e.target.closest('#grab') };
});
panel.addEventListener('pointermove', (e) => {
  if (!sheetPtr || e.pointerId !== sheetPtr.id) return;
  if (!sheetPtr.moved && Math.abs(e.clientY - sheetPtr.y0) > 6) {
    sheetPtr.moved = true;
    panel.setPointerCapture(e.pointerId);                          // capture only now, so a tap still clicks
    sheetDragBegin(sheetPtr.y0);
  }
  if (sheetPtr.moved) sheetDragMove(e.clientY);
});
const sheetPtrEnd = (e) => {
  if (!sheetPtr || e.pointerId !== sheetPtr.id) return;
  const p = sheetPtr;
  sheetPtr = null;
  if (p.moved) {
    sheetDragEnd();
    const eat = (ev) => { ev.stopPropagation(); ev.preventDefault(); };   // the drag is not a click
    window.addEventListener('click', eat, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', eat, true), 80);
  } else if (p.grab && e.type === 'pointerup') snapTo(L.snap === 'peek' ? 'half' : L.snap === 'half' ? 'full' : 'half');
};
panel.addEventListener('pointerup', sheetPtrEnd);
panel.addEventListener('pointercancel', sheetPtrEnd);

let bodyTouch = null;
pbody.addEventListener('touchstart', (e) => {
  if (L.mode !== 'sheet' || e.touches.length !== 1) { bodyTouch = null; return; }
  bodyTouch = { y0: e.touches[0].clientY, top: pbody.scrollTop <= 0, on: false };
}, { passive: true });
pbody.addEventListener('touchmove', (e) => {
  if (!bodyTouch) return;
  const y = e.touches[0].clientY;
  if (!bodyTouch.on) {
    if (bodyTouch.top && pbody.scrollTop <= 0 && y - bodyTouch.y0 > 8) { bodyTouch.on = true; sheetDragBegin(bodyTouch.y0); } else return;
  }
  e.preventDefault();
  sheetDragMove(y);
}, { passive: false });
const bodyTouchEnd = () => { if (bodyTouch?.on) sheetDragEnd(); bodyTouch = null; };
pbody.addEventListener('touchend', bodyTouchEnd);
pbody.addEventListener('touchcancel', bodyTouchEnd);

// A text field in the sheet opens the sheet to full, so the keyboard does not cover it.
const typing = (t) => t instanceof HTMLInputElement && /^(text|search|number)$/.test(t.type);
panel.addEventListener('focusin', (e) => {
  if (L.mode !== 'sheet' || !typing(e.target) || !touchUI() || L.snap === 'full') return;
  L.focusSnap = L.snap; snapTo('full');
});
panel.addEventListener('focusout', () => {
  setTimeout(() => {
    if (L.focusSnap && !(panel.contains(document.activeElement) && typing(document.activeElement))) { const s = L.focusSnap; L.focusSnap = null; snapTo(s); }
  }, 60);
});

// ─── full-screen sheets: formula picker and examples ────────────────────────
// On a phone they fill the visual viewport, so the search field stays above the keyboard.
// Swipe down on the head, or on the list when it is scrolled to the top, to close.
function syncViewport() {
  const vv = window.visualViewport;
  root.style.setProperty('--vv-top', px(vv ? vv.offsetTop : 0));
  root.style.setProperty('--vv-h', px(vv ? vv.height : innerHeight));
}
window.visualViewport?.addEventListener('resize', () => { syncViewport(); queueLayout(); });
window.visualViewport?.addEventListener('scroll', syncViewport);

function openSheet(s) { syncViewport(); s.style.transform = ''; s.classList.remove('hidden'); }
function closeSheet(s) {
  if (s.contains(document.activeElement)) document.activeElement.blur();
  s.classList.add('hidden'); s.style.transform = '';
}
function swipeToClose(s, close) {
  const body = s.querySelector('.pbody');
  let t = null;
  s.addEventListener('touchstart', (e) => {
    if (L.mode === 'float' || e.touches.length !== 1) { t = null; return; }
    t = { y0: e.touches[0].clientY, t0: performance.now(), ok: !!e.target.closest('.phead') || body.scrollTop <= 0, on: false, dy: 0 };
  }, { passive: true });
  s.addEventListener('touchmove', (e) => {
    if (!t?.ok) return;
    const dy = e.touches[0].clientY - t.y0;
    if (!t.on) { if (dy > 10 && (body.scrollTop <= 0 || e.target.closest('.phead'))) { t.on = true; s.classList.add('dragging'); } else return; }
    e.preventDefault();
    t.dy = Math.max(0, dy);
    s.style.transform = `translateY(${t.dy}px)`;
  }, { passive: false });
  const end = () => {
    if (!t?.on) { t = null; return; }
    s.classList.remove('dragging');
    const v = t.dy / Math.max(performance.now() - t.t0, 1);
    if (t.dy > 110 || v > 0.6) close(); else s.style.transform = '';
    t = null;
  };
  s.addEventListener('touchend', end);
  s.addEventListener('touchcancel', end);
}
swipeToClose(picker, closePicker);
swipeToClose(exSheet, () => closeExamples());

// The sheet: source and family chips over a grid with one heading per source group
// (per collection author, with the licence). Search, chips and Random work together.
let exTiles = null, exGroups = [];
const exFilter = { src: 'all', family: 'all' };
function buildExamples() {
  exTiles = [];
  exGroups = [];
  const body = [];
  let g = null;
  EXAMPLES.forEach((e, i) => {
    if (!g || g.name !== e.group) {
      const c = e.src === 'c' ? COLLECTIONS[e.collection] : null;
      const head = el('h3', {}, c ? `${c.author} collection` : e.group,
        c?.subject ? el('small', {}, c.subject) : '',
        c ? el('a', { class: 'lic', href: c.licenceUrl, target: '_blank', rel: 'noopener', title: `${c.licence}: credit ${c.author}` }, c.licence) : '',
        el('small', { class: 'n' }, ''));
      g = { name: e.group, head, grid: el('div', { class: 'grid' }), tiles: [] };
      exGroups.push(g);
      body.push(head, g.grid);
    }
    const t = el('button', { type: 'button', class: 'tile', title: presetTitle(e), 'data-i': i }, presetThumb(e, 64), el('span', {}, e.name));
    t.addEventListener('click', () => {
      closeExamples();
      loadExample(i);
      if (L.mode === 'sheet' && L.snap === 'full') snapTo('half');
    });
    const x = { t, i, e, key: e.search };
    g.grid.append(t);
    g.tiles.push(x);
    exTiles.push(x);
  });
  const chip = (kind, val, label) => el('button', { type: 'button', class: 'chip', 'data-k': kind, 'data-v': val,
    onclick: () => { exFilter[kind] = val; filterExSheet(); $('exBody').scrollTop = 0; } }, label);
  const fams = FAMILIES.filter((f) => EXAMPLES.some((e) => e.family === f));
  $('exChips').replaceChildren(
    el('div', { class: 'chips' }, ...SOURCES.map(([v, l]) => chip('src', v, l)), el('span', { class: 'count', id: 'exCount' })),
    el('div', { class: 'chips' }, chip('family', 'all', 'Any family'), ...fams.map((f) => chip('family', f, f))));
  $('exBody').replaceChildren(...body, el('p', { class: 'empty', hidden: true }, 'No preset matches.'));
}
function filterExSheet() {
  const words = $('exSearch').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let any = 0;
  for (const g of exGroups) {
    let n = 0;
    for (const x of g.tiles) {
      const ok = (exFilter.src === 'all' || x.e.src === exFilter.src) && (exFilter.family === 'all' || x.e.family === exFilter.family)
        && words.every((w) => x.key.includes(w));
      x.t.hidden = !ok; n += ok;
    }
    g.head.hidden = g.grid.hidden = n === 0;
    g.head.querySelector('.n').textContent = `${n}`;
    any += n;
  }
  $('exChips').querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', exFilter[c.dataset.k] === c.dataset.v));
  $('exCount').textContent = `${any} of ${EXAMPLES.length}`;
  $('exBody').querySelector('.empty').hidden = any > 0;
}
function openExamples() {
  if (!exTiles) buildExamples();
  for (const x of exTiles) x.t.classList.toggle('cur', x.i === currentExample);
  $('exSearch').value = '';
  filterExSheet();
  openSheet(exSheet);
  exTiles.find((x) => x.i === currentExample)?.t.scrollIntoView({ block: 'center' });
  if (matchMedia('(pointer: fine)').matches) $('exSearch').focus();
}
function closeExamples() { closeSheet(exSheet); }
$('exSearch').addEventListener('input', filterExSheet);
$('exSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { const x = exTiles.find((y) => !y.t.hidden); if (x) x.t.click(); }
  if (e.key === 'Escape') closeExamples();
});
$('exClose').addEventListener('click', closeExamples);
$('exRandom').addEventListener('click', randomExample);

$('peekFormula').addEventListener('click', () => openPicker(activeSlot));
$('peekExamples').addEventListener('click', openExamples);
$('peekFrame').addEventListener('click', () => frameView(false));
$('peekSave').addEventListener('click', savePng);

applyLayout();
syncViewport();

// No render work while nobody can see it: a sheet drag, a full sheet, a full-screen list.
export function renderPaused() {
  if (saveRequested) return false;
  if (sheetDragging) return true;
  if (L.mode === 'sheet' && L.snap === 'full' && !panel.classList.contains('hidden')) return true;
  return L.mode !== 'float' && (!picker.classList.contains('hidden') || !exSheet.classList.contains('hidden'));
}

// ─── keys ───────────────────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  const t = e.target;
  if (e.key === 'Escape' && !picker.classList.contains('hidden')) { closePicker(); return; }
  if (e.key === 'Escape' && !exSheet.classList.contains('hidden')) { closeExamples(); return; }
  if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (flying && 'wasdqe'.includes(k) && k.length === 1) { keys.add(k); e.preventDefault(); return; }
  if (k === 'shift') { keys.add('shift'); return; }
  if (k === 'p') togglePanel();
  else if (k === 'f') toggleFly();
  else if (k === 'v') frameView(false);
});
window.addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); if (!keys.size) refreshAll(); });
window.addEventListener('blur', () => keys.clear());
$('toggle').addEventListener('click', togglePanel);

// ─── status ─────────────────────────────────────────────────────────────────
// ─── frame loop ─────────────────────────────────────────────────────────────
let saveRequested = false;
function savePng() { if (!engine) return flash('no renderer: nothing to save'); saveRequested = true; }

let lastT = performance.now(), lastFrameT = 0, hudT = 0;
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min((now - lastT) / 1000, 0.1);
  lastT = now;
  if (document.hidden || !engine) return;
  flyStep(dt);
  inertiaStep(dt);
  if (now - hudT > 150) { hudT = now; showHud(); }
  if (renderPaused()) { lastFrameT = 0; return; }
  if (sceneDirty) pushScene();
  const want = !info || info.compiling || (info.samples < targetSamples.value && !info.done);
  if (want || saveRequested) {
    try {
      const t0 = performance.now();
      const r = engine.frame();
      if (r) setInfo(r);
      const st = engine.stats?.();
      if (st && Number.isFinite(st.lastSampleMs) && st.lastSampleMs > 0) setMsPerSample(st.lastSampleMs);
      else if (lastFrameT && !info?.compiling) setMsPerSample(msPerSample ? msPerSample * 0.85 + (t0 - lastFrameT) * 0.15 : t0 - lastFrameT);
      lastFrameT = t0;
    } catch (e) { setStatus(`error: ${e.message}`); console.error(e); }
    if (saveRequested && (info?.samples ?? 0) > 0) {   // wait for one full sample; the canvas keeps the last presented image
      saveRequested = false;
      const f = formulaAt(0);
      const name = `mandelbulber-${isNone(f) ? 'scene' : f.id}-${info?.samples ?? 0}spp.png`;
      canvas.toBlob((b) => (b ? (download(b, name), flash(`saved ${name}`)) : flash('save failed')), 'image/png');
    }
  } else lastFrameT = 0;
}

// ─── boot ───────────────────────────────────────────────────────────────────
async function boot() {
  await loadData();
  $('subtitle').textContent = `${CAT.formulas.filter((f) => !isNone(f)).length} formulas · ${EXAMPLES.length} presets`;

  setScene((await readHash()) || defaultScene(P));
  buildPanel();
  applyLayout();
  showHud();

  try {
    const { createEngine } = await import('./engine.js');
    setEngine(await createEngine(canvas));
  } catch (e) {
    console.error(e);
    fail(e?.message?.includes('WebGPU') ? e.message : `The renderer did not start: ${e.message}. This page needs WebGPU (a current Chrome, Edge or Safari).`);
    return;
  }
  engine.onStatus((s) => { setStatus(String(s)); showHud(); });
  engine.setMaxSamples?.(targetSamples.value);
  engine.setFrameBudget?.(33);                         // about 30 fps while the user drags
  // Resize only when the pixel size changes, so a layout pass keeps the accumulated image.
  // During a sheet drag the canvas only stretches (object-fit); the resize waits for the snap.
  const resize = () => {
    if (sheetDragging) { resizePending = true; return; }
    const w0 = canvas.width, h0 = canvas.height;
    engine.resize(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight), pixelRatio());
    if (canvas.width !== w0 || canvas.height !== h0) setInfo(null);
  };
  resizeCanvas = resize;
  new ResizeObserver(resize).observe(canvas);
  resize();
  requestAnimationFrame(tick);
}

// Test hooks for the headless check.
window.__mb = {
  get scene() { return scene; }, get P() { return P; }, get catalog() { return CAT; }, get info() { return info; },
  get examples() { return EXAMPLES; }, get collections() { return COLLECTIONS; }, randomExample,
  loadPreset: (key) => loadExample(EXAMPLES.findIndex((e) => e.key === key)), get activeSlot() { return activeSlot; }, get status() { return compileStatus; },
  loadPartial: (part, label) => loadScene(exampleScene(part), label),
  defaultScene: () => defaultScene(P), parseFract: (t) => parseFract(t, P), exportText, loadText, loadExample,
  shareHash, decodeShare, setMain, setSlot, openPicker, choose, targetSamples, toggleFly, camFromScene, camToScene,
  frameView, get engine() { return engine; },
  layout: L, snapTo, openExamples, closeExamples, fly, inertia, renderScale, pixelRatio, togglePanel,
};

boot().catch((e) => console.error('[mandelbulber]', e));
