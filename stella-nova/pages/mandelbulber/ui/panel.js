// ui/panel.js — Mandelbulber page: the panel sections, the formula slot editor and the peek bar.
//
// buildPanel fills #pbody once at boot: Image (progress, samples, files), Presets (a
// searchable list), Formula (the slot strip and buildSlotEditor), the main param groups
// from MAIN_UI, and About. buildSlotEditor rebuilds the slot strip and the editor of the
// active slot after a formula or a slot change. A row is left out when gen/params.json
// does not list its param. initPeek connects the peek bar of the phone sheet.
//
// grep: const MAIN_UI  const SLOT_COMMON  const CREDIT  let progressEl  function buildPanel  function buildSlotEditor
//       function markExample  function filterExamples  function initPeek

import { SLOTS, defaultScene } from '../fract.js';
import { $, pbody, el, section, clamp } from './dom.js';
import { P, EXAMPLES, COLLECTIONS, mainSpec, isNone } from './data.js';
import { scene, engine, activeSlot, setActiveSlot, currentExample, setCurrentExample, formulaAt,
  targetSamples, SAMPLES_DEFAULT, renderScale, RENDER_SCALE_DEFAULT } from './state.js';
import { ctl, refreshAll, mainBind, slotBind, kindOf } from './controls.js';
import { gradientEditor } from './gradient.js';
import { thumb, presetThumb } from './thumbs.js';
import { setMain, loadScene } from './scene.js';
import { camFromScene, camToScene, resetCamera, frameView } from './camera.js';
import { exportFract, copyLink } from './io.js';
import { presetTitle, loadExample } from './presets.js';
import { openPicker } from './picker.js';
import { openExamples, randomExample } from './preset-sheet.js';
import { resizeCanvas } from './layout.js';
import { toggleFly } from './fly.js';
import { savePng } from './loop.js';

// Main params shown in the panel. A row is skipped when gen/params.json does
// not list its name. `c` picks one component of a vector param.
export const MAIN_UI = [
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
export const SLOT_COMMON = [
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
export const CREDIT = {
  html: 'Mandelbulber by Krzysztof Marczak and the Mandelbulber team, GPL-3.0, '
    + '<a href="https://github.com/buddhi1980/mandelbulber2" target="_blank" rel="noopener">github.com/buddhi1980/mandelbulber2</a>, commit 600da8d.',
};

let slotBox, slotStrip, exList, exSearch;
export let progressEl, sampleLine;

export function buildPanel() {
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
    See <a href="${new URL('../gen/CREDITS-examples.md', import.meta.url).href}" target="_blank" rel="noopener">CREDITS-examples.md</a>.</p>
    <p class="spec">This page is a WebGPU port of that program. The formulas are translated from the upstream OpenCL
    kernels to WGSL in 32-bit floats, so deep zooms lose precision earlier than upstream's 64-bit mode.
    The license text is in <a href="${new URL('../COPYING', import.meta.url).href}" target="_blank" rel="noopener">COPYING</a>.</p>
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

export function markExample() { exList?.querySelectorAll('.ex').forEach((b) => b.classList.toggle('cur', Number(b.dataset.i) === currentExample)); }
export function filterExamples() {
  const words = exSearch.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = new Set();
  exList.querySelectorAll('.ex').forEach((b) => {
    const e = EXAMPLES[Number(b.dataset.i)];
    b.hidden = !words.every((w) => e.search.includes(w));
    if (!b.hidden) shown.add(e.group);
  });
  exList.querySelectorAll('h3').forEach((h) => { h.hidden = !shown.has(h.dataset.g); });
}

export function initPeek() {
  $('peekFormula').addEventListener('click', () => openPicker(activeSlot));
  $('peekExamples').addEventListener('click', openExamples);
  $('peekFrame').addEventListener('click', () => frameView(false));
  $('peekSave').addEventListener('click', savePng);
}
