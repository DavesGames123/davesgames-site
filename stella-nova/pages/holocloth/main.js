// ============================================================================
//  HOLOCLOTH  ·  main.js
//  Ported from upstream src/App.tsx and src/main.tsx
//  (github.com/dmitrykurash/holocloth).
//  Copyright (c) 2026 Dmitry Kurash, MIT License, see LICENSE.
//  Port changes:
//    - React, react-dom, motion and DialKit are removed. buildPanel() makes
//      the same controls, defaults, ranges and actions in plain DOM.
//    - Versions: DialKit kept versions in memory. The port saves the panel
//      values of each version in localStorage. Images stay per session, in a
//      side table keyed by version, as upstream.
//    - Startup assets: upstream downloads holo-bg-2.jpg (cloth art) and
//      bump-scratches.jpg (bump). The port draws both on a canvas
//      (textures.js), so the loader ring shows the three.js load only.
//    - Phone: a dock, a bottom sheet, the Medium performance profile on a
//      coarse pointer, a wider start view on a narrow screen, and camera
//      framing that keeps the cloth out from under the sheet and the dock.
//
//    grep -n 'RENDER_DEFAULTS'      shared render settings
//    grep -n 'PRESET_VALUES'        the Holo / Chrome / Black Cloth bundles
//    grep -n 'SCHEMA'               every panel control, default and range
//    grep -n 'function buildPanel'  the panel construction
//    grep -n 'VERSIONS'             saved versions in localStorage
//    grep -n 'function occlusion'   the phone framing margins
// ============================================================================
import { HoloApp } from './scene.js';
import { makeScratchHeight, makePosterCanvas } from './textures.js';

/** Shared renderer settings — identical across every preset. */
const RENDER_DEFAULTS = {
  background: '#0b0c12',
  exposure: 0.5,
  environment: 0.73,
  bloom: 0.05,
  bloomThreshold: 1.41,
  noise: 0.345,
  toneMapping: 'Neutral',
  occlusion: true,
  occlusionStrength: 1,
  dof: false,
  dofAperture: 40,
  dofBlur: 0.04,
  dofRange: 0.3,
};

/** finish → surface response; presets reference these by name */
const FINISH_VALUES = {
  Glossy: { roughness: 0.1, clearcoat: 1.0, coatRoughness: 0.08 },
  Satin: { roughness: 0.3, clearcoat: 0.45, coatRoughness: 0.3 },
  Matte: { roughness: 0.62, clearcoat: 0.06, coatRoughness: 0.7 },
};

const PRESET_VALUES = {
  Holo: {
    material: {
      finish: 'Matte',
      baseColor: '#20242d',
      holoIntensity: 3.78,
      holoScale: 400,
      bandFreq: 1.1,
      saturation: 1.0,
      hueShift: 0.37,
      sparkle: 0.73,
      specTint: 0.33,
      iridescence: 0.81,
      metalness: 1.0,
      sheen: 0,
      bump: 3.0,
      bumpTiling: 3,
      ...FINISH_VALUES.Matte,
    },
    render: { ...RENDER_DEFAULTS },
  },
  Chrome: {
    material: {
      finish: 'Glossy',
      baseColor: '#dfe3e8',
      holoIntensity: 0,
      sparkle: 0.2,
      specTint: 0,
      iridescence: 0,
      metalness: 1,
      sheen: 0,
      bump: 0.05,
      ...FINISH_VALUES.Glossy,
      roughness: 0.04,
      coatRoughness: 0.04,
    },
    render: { ...RENDER_DEFAULTS },
  },
  'Black Cloth': {
    material: {
      finish: 'Satin',
      baseColor: '#101114',
      holoIntensity: 0.1,
      holoScale: 8,
      bandFreq: 0.2,
      saturation: 0,
      hueShift: 0,
      sparkle: 0,
      specTint: 0.82,
      iridescence: 0,
      metalness: 0.43,
      sheen: 0.08,
      bump: 0,
      ...FINISH_VALUES.Satin,
      roughness: 0.83,
      clearcoat: 0.22,
      coatRoughness: 0.32,
    },
    render: { ...RENDER_DEFAULTS },
  },
};

const COARSE = matchMedia('(pointer:coarse)').matches;
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');

// SCHEMA: the upstream DialKit config, one entry per control.
//   slider  [key, label, default, min, max, step]
//   select  { key, label, options, default }
//   color / toggle / action / chips
const SCHEMA = [
  { type: 'select', path: 'performance', label: 'Performance', options: ['High', 'Medium', 'Low'], def: COARSE ? 'Medium' : 'High' },
  { type: 'folder', key: 'material', label: 'Material', open: true, items: [
    { type: 'select', key: 'preset', label: 'Preset', options: ['Holo', 'Chrome', 'Black Cloth'], def: 'Holo' },
    { type: 'select', key: 'finish', label: 'Finish', options: ['Glossy', 'Satin', 'Matte'], def: 'Matte' },
    { type: 'color', key: 'baseColor', label: 'Base Color', def: '#20242d' },
    { type: 'slider', key: 'holoIntensity', label: 'Holo Intensity', def: 3.78, min: 0, max: 4, step: 0.01 },
    { type: 'slider', key: 'holoScale', label: 'Holo Scale', def: 400, min: 8, max: 400, step: 1 },
    { type: 'slider', key: 'bandFreq', label: 'Band Freq', def: 1.1, min: 0.2, max: 10, step: 0.05 },
    { type: 'slider', key: 'saturation', label: 'Saturation', def: 1, min: 0, max: 1, step: 0.01 },
    { type: 'slider', key: 'hueShift', label: 'Hue Shift', def: 0.37, min: 0, max: 1, step: 0.01 },
    { type: 'slider', key: 'sparkle', label: 'Sparkle', def: 0.73, min: 0, max: 2, step: 0.01 },
    { type: 'slider', key: 'specTint', label: 'Spec Tint', def: 0.33, min: 0, max: 1, step: 0.01 },
    { type: 'slider', key: 'iridescence', label: 'Iridescence', def: 0.81, min: 0, max: 1, step: 0.01 },
    { type: 'slider', key: 'roughness', label: 'Roughness', def: 0.62, min: 0, max: 1, step: 0.01 },
    { type: 'slider', key: 'metalness', label: 'Metalness', def: 1, min: 0, max: 1, step: 0.01 },
    { type: 'slider', key: 'clearcoat', label: 'Clearcoat', def: 0.06, min: 0, max: 1, step: 0.01 },
    { type: 'slider', key: 'coatRoughness', label: 'Coat Roughness', def: 0.7, min: 0, max: 1, step: 0.01 },
    { type: 'slider', key: 'sheen', label: 'Sheen', def: 0, min: 0, max: 1, step: 0.01 },
    { type: 'slider', key: 'bump', label: 'Bump', def: 3, min: 0, max: 3, step: 0.01 },
    { type: 'slider', key: 'bumpTiling', label: 'Bump Tiling', def: 3, min: 1, max: 12, step: 0.5 },
    { type: 'action', key: 'uploadBump', label: 'Upload bump map' },
    { type: 'chips', key: 'bumpChips' },
  ] },
  { type: 'folder', key: 'physics', label: 'Physics', open: false, items: [
    { type: 'slider', key: 'viscosity', label: 'Viscosity', def: 0.6, min: 0, max: 0.6, step: 0.005 },
    { type: 'slider', key: 'stiffness', label: 'Stiffness', def: 1, min: 0.2, max: 1, step: 0.01 },
    { type: 'slider', key: 'iterations', label: 'Iterations', def: 14, min: 1, max: 14, step: 1 },
    { type: 'slider', key: 'smoothing', label: 'Smoothing', def: 0.045, min: 0, max: 0.3, step: 0.005 },
    { type: 'slider', key: 'grabRadius', label: 'Grab Radius', def: 0.27, min: 0.05, max: 1.2, step: 0.01 },
  ] },
  { type: 'folder', key: 'images', label: 'Images', open: false, items: [
    { type: 'toggle', key: 'useImage', label: 'Use Image', def: false },
    { type: 'toggle', key: 'edit', label: 'Edit', def: false },
    { type: 'slider', key: 'scale', label: 'Scale', def: 0.35, min: 0.02, max: 2.5, step: 0.01 },
    { type: 'slider', key: 'rotation', label: 'Rotation', def: 0, min: -180, max: 180, step: 1 },
    { type: 'slider', key: 'opacity', label: 'Opacity', def: 1, min: 0, max: 1, step: 0.01 },
    { type: 'slider', key: 'cornerRadius', label: 'Corner Radius', def: 0, min: 0, max: 1, step: 0.01 },
    { type: 'action', key: 'addImage', label: 'Add image / SVG' },
    { type: 'chips', key: 'decalChips' },
    { type: 'action', key: 'makeCloth', label: 'Image as cloth…' },
    { type: 'chips', key: 'clothChips' },
    { type: 'action', key: 'clearImages', label: 'Clear images' },
  ] },
  { type: 'folder', key: 'render', label: 'Render', open: false, items: [
    { type: 'color', key: 'background', label: 'Background', def: RENDER_DEFAULTS.background },
    { type: 'slider', key: 'exposure', label: 'Exposure', def: RENDER_DEFAULTS.exposure, min: 0.2, max: 2.5, step: 0.01 },
    { type: 'slider', key: 'environment', label: 'Environment', def: RENDER_DEFAULTS.environment, min: 0, max: 3, step: 0.01 },
    { type: 'slider', key: 'bloom', label: 'Bloom', def: RENDER_DEFAULTS.bloom, min: 0, max: 1.2, step: 0.01 },
    { type: 'slider', key: 'bloomThreshold', label: 'Bloom Threshold', def: RENDER_DEFAULTS.bloomThreshold, min: 0, max: 2, step: 0.01 },
    { type: 'slider', key: 'noise', label: 'Noise', def: RENDER_DEFAULTS.noise, min: 0, max: 0.6, step: 0.005 },
    { type: 'select', key: 'toneMapping', label: 'Tone Mapping', options: ['AgX', 'ACES', 'Neutral'], def: RENDER_DEFAULTS.toneMapping },
    { type: 'toggle', key: 'occlusion', label: 'Occlusion', def: RENDER_DEFAULTS.occlusion },
    { type: 'slider', key: 'occlusionStrength', label: 'Occlusion Strength', def: RENDER_DEFAULTS.occlusionStrength, min: 0, max: 1, step: 0.01 },
    { type: 'toggle', key: 'dof', label: 'Dof', def: RENDER_DEFAULTS.dof },
    { type: 'slider', key: 'dofAperture', label: 'Dof Aperture', def: RENDER_DEFAULTS.dofAperture, min: 1, max: 150, step: 1 },
    { type: 'slider', key: 'dofBlur', label: 'Dof Blur', def: RENDER_DEFAULTS.dofBlur, min: 0, max: 0.15, step: 0.001 },
    { type: 'slider', key: 'dofRange', label: 'Dof Range', def: RENDER_DEFAULTS.dofRange, min: 0, max: 3, step: 0.01 },
    { type: 'action', key: 'pickFocus', label: 'Pick focus point' },
    { type: 'action', key: 'autoFocus', label: 'Auto focus' },
  ] },
  { type: 'action', path: 'exportPNG', label: 'Export PNG' },
  { type: 'action', path: 'exportPNGClear', label: 'Export PNG (no background)' },
  { type: 'action', path: 'resetCloth', label: 'Reset cloth' },
  { type: 'action', path: 'poke', label: 'Poke' },
];

/** Default values from the schema, in the DialKit value shape. */
function defaults() {
  const v = {};
  for (const e of SCHEMA) {
    if (e.type === 'folder') {
      v[e.key] = {};
      for (const it of e.items) if ('def' in it) v[e.key][it.key] = it.def;
    } else if ('def' in e) {
      v[e.path] = e.def;
    }
  }
  return v;
}

/** Deep merge of plain objects (b wins), used for setValues and loads. */
function merge(a, b) {
  const out = { ...a };
  for (const k in b) {
    const bv = b[k];
    out[k] = bv && typeof bv === 'object' && !Array.isArray(bv) && a[k] && typeof a[k] === 'object'
      ? merge(a[k], bv) : bv;
  }
  return out;
}

function decimals(step) {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

function loadImageFile(file, onLoad) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    // decoded pixels stay usable for canvas drawing after revocation
    URL.revokeObjectURL(url);
    onLoad(img);
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

// ---------------------------------------------------------------- VERSIONS
// Saved in localStorage as { active, list: [{ id, name, values }] }. Every
// access sits in try/catch, because storage can be absent or blocked.
const STORE_KEY = 'holocloth.versions.v1';
function readStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.list) || s.list.length === 0) return null;
    return s;
  } catch (err) {
    return null;
  }
}
function writeStore(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (err) { /* storage off */ }
}

// ------------------------------------------------------------------- state
const DEFAULTS = defaults();
let store = readStore() || { active: 'v1', list: [{ id: 'v1', name: 'Version 1', values: DEFAULTS }] };
let values = merge(DEFAULTS, (store.list.find((x) => x.id === store.active) || store.list[0]).values);
// the performance profile follows the device, not the saved version
values.performance = DEFAULTS.performance;

const stage = document.getElementById('stage');
const app = new HoloApp(stage, { performance: values.performance });
const controls = new Map(); // "folder.key" -> { set(value) }

function get(path) {
  const [a, b] = path.split('.');
  return b === undefined ? values[a] : values[a][b];
}

/** Write a partial value tree, refresh the matching controls, and apply. */
function setValues(partial) {
  values = merge(values, partial);
  for (const [path, c] of controls) c.set(get(path));
  syncDock();
  apply();
}

let saveTimer = 0;
function apply() {
  app.applyParams(values);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const cur = store.list.find((x) => x.id === store.active);
    if (cur) { cur.values = values; writeStore(store); }
  }, 300);
}

// --------------------------------------------------------------- actions
const fileDecal = document.getElementById('fileDecal');
const fileCloth = document.getElementById('fileCloth');
const fileBump = document.getElementById('fileBump');

function onAction(name) {
  if (name === 'resetCloth') app.resetCloth();
  else if (name === 'poke') app.poke();
  else if (name === 'exportPNG') app.exportPNG(false);
  else if (name === 'exportPNGClear') app.exportPNG(true);
  else if (name === 'addImage') fileDecal.click();
  else if (name === 'makeCloth') fileCloth.click();
  else if (name === 'uploadBump') fileBump.click();
  else if (name === 'pickFocus') {
    app.startPickFocus();
    // on a phone the sheet covers the cloth: close it for the pick tap
    if (PHONE_Q.matches) setOpen(false);
  } else if (name === 'autoFocus') app.clearPickFocus();
  else if (name === 'clearImages') {
    app.clearImages();
    setValues({ images: { useImage: false } });
  }
}

fileDecal.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) loadImageFile(file, (img) => app.addDecal(img));
  e.target.value = '';
});
fileCloth.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) {
    loadImageFile(file, (img) => {
      app.setClothImage(img);
      setValues({ images: { useImage: true } });
    });
  }
  e.target.value = '';
});
fileBump.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) loadImageFile(file, (img) => app.setBumpMap(img));
  e.target.value = '';
});

// ----------------------------------------------------------------- panel
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** Called when the user changes one control. */
function onUserChange(path, value) {
  const [a, b] = path.split('.');
  if (b === undefined) { setValues({ [a]: value }); return; }
  if (path === 'material.preset') {
    // a preset bundle already carries its finish response, so it never
    // triggers the finish rule below
    const bundle = PRESET_VALUES[value];
    setValues({ material: { preset: value } });
    if (bundle) setValues({ material: bundle.material, render: bundle.render });
    return;
  }
  if (path === 'material.finish') {
    setValues({ material: { finish: value, ...(FINISH_VALUES[value] || {}) } });
    return;
  }
  setValues({ [a]: { [b]: value } });
}

function sliderRow(path, it) {
  const row = el('label', 'ctl slider');
  const fill = el('span', 'fill');
  const name = el('span', 'name', it.label);
  const val = el('span', 'val');
  const input = document.createElement('input');
  input.type = 'range';
  input.min = it.min; input.max = it.max; input.step = it.step;
  input.setAttribute('aria-label', it.label);
  row.append(fill, name, val, input);
  const dp = decimals(it.step);
  const show = (v) => {
    const t = (v - it.min) / (it.max - it.min);
    fill.style.width = `${Math.max(0, Math.min(1, t)) * 100}%`;
    val.textContent = Number(v).toFixed(dp);
  };
  input.addEventListener('input', () => { show(+input.value); onUserChange(path, +input.value); });
  controls.set(path, { set: (v) => { input.value = v; show(v); } });
  return row;
}

function selectRow(path, it) {
  const row = el('label', 'ctl select');
  row.append(el('span', 'name', it.label));
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', it.label);
  for (const o of it.options) {
    const opt = el('option', null, o);
    opt.value = o;
    sel.append(opt);
  }
  row.append(sel);
  sel.addEventListener('change', () => onUserChange(path, sel.value));
  controls.set(path, { set: (v) => { sel.value = v; } });
  return row;
}

function colorRow(path, it) {
  const row = el('label', 'ctl color');
  const hex = el('span', 'val');
  const input = document.createElement('input');
  input.type = 'color';
  input.setAttribute('aria-label', it.label);
  row.append(el('span', 'name', it.label), hex, input);
  input.addEventListener('input', () => { hex.textContent = input.value.toUpperCase(); onUserChange(path, input.value); });
  controls.set(path, { set: (v) => { input.value = v; hex.textContent = String(v).toUpperCase(); } });
  return row;
}

function toggleRow(path, it) {
  const row = el('label', 'ctl toggle');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.setAttribute('aria-label', it.label);
  const knob = el('span', 'switch');
  row.append(el('span', 'name', it.label), input, knob);
  input.addEventListener('change', () => onUserChange(path, input.checked));
  controls.set(path, { set: (v) => { input.checked = !!v; } });
  return row;
}

function actionRow(name, label) {
  const b = el('button', 'ctl action', label);
  b.type = 'button';
  b.addEventListener('click', () => onAction(name));
  return b;
}

const chipHosts = {};
function buildPanel() {
  const body = document.getElementById('panelBody');
  for (const e of SCHEMA) {
    if (e.type === 'folder') {
      const f = el('section', 'folder' + (e.open ? ' open' : ''));
      const head = el('button', 'folder-head');
      head.type = 'button';
      head.setAttribute('aria-expanded', String(!!e.open));
      head.append(el('span', null, e.label), el('span', 'chev', '⌄'));
      const inner = el('div', 'folder-body');
      head.addEventListener('click', () => {
        const open = !f.classList.contains('open');
        f.classList.toggle('open', open);
        head.setAttribute('aria-expanded', String(open));
      });
      for (const it of e.items) {
        const path = `${e.key}.${it.key}`;
        if (it.type === 'slider') inner.append(sliderRow(path, it));
        else if (it.type === 'select') inner.append(selectRow(path, it));
        else if (it.type === 'color') inner.append(colorRow(path, it));
        else if (it.type === 'toggle') inner.append(toggleRow(path, it));
        else if (it.type === 'action') inner.append(actionRow(it.key, it.label));
        else if (it.type === 'chips') { const c = el('div', 'chips'); chipHosts[it.key] = c; inner.append(c); }
      }
      f.append(head, inner);
      body.append(f);
    } else if (e.type === 'select') {
      body.append(selectRow(e.path, e));
    } else if (e.type === 'action') {
      body.append(actionRow(e.path, e.label));
    }
  }
}

/** One uploaded-image row with a thumbnail and a remove button. */
function chipRow(thumb, label, onRemove) {
  const row = el('div', 'chip');
  const img = document.createElement('img');
  img.src = thumb; img.alt = label;
  const x = el('button', 'chip-x', '✕');
  x.type = 'button';
  x.title = `Remove ${label}`;
  x.setAttribute('aria-label', `Remove ${label}`);
  x.addEventListener('click', onRemove);
  row.append(img, el('span', 'chip-name', label), x);
  return row;
}

function refreshChips() {
  const cloth = app.getClothThumbnail();
  const decals = app.getDecalThumbnails();
  const bump = app.getBumpThumbnail();
  chipHosts.clothChips.replaceChildren(...(cloth
    ? [chipRow(cloth, 'Cloth image', () => setValues({ images: { useImage: false } }))] : []));
  chipHosts.decalChips.replaceChildren(...decals.map((t, i) =>
    chipRow(t, `Image ${i + 1}`, () => app.removeDecal(i))));
  chipHosts.bumpChips.replaceChildren(...(bump
    ? [chipRow(bump, 'Bump map', () => app.setBumpMap(null))] : []));
}

// ---------------------------------------------------- versions (VERSIONS)
const verSelect = document.getElementById('verSelect');
const imageStates = new Map(); // version id -> images snapshot (session only)

function renderVersions() {
  verSelect.replaceChildren(...store.list.map((v) => {
    const o = el('option', null, v.name);
    o.value = v.id;
    return o;
  }));
  verSelect.value = store.active;
  document.getElementById('verDel').disabled = store.list.length < 2;
}

function switchVersion(id) {
  if (id === store.active) return;
  imageStates.set(store.active, app.snapshotImages());
  const next = store.list.find((x) => x.id === id);
  if (!next) return;
  store.active = id;
  writeStore(store);
  const perf = values.performance;
  values = merge(DEFAULTS, next.values);
  values.performance = perf;
  // a version with no entry yet inherits the current images
  const saved = imageStates.get(id);
  if (saved) app.restoreImages(saved);
  setValues({});
}

verSelect.addEventListener('change', () => switchVersion(verSelect.value));
document.getElementById('verAdd').addEventListener('click', () => {
  imageStates.set(store.active, app.snapshotImages());
  let n = store.list.length + 1;
  while (store.list.some((x) => x.name === `Version ${n}`)) n++;
  const id = `v${Date.now().toString(36)}`;
  store.list.push({ id, name: `Version ${n}`, values: JSON.parse(JSON.stringify(values)) });
  store.active = id;
  writeStore(store);
  renderVersions();
});
document.getElementById('verDel').addEventListener('click', () => {
  if (store.list.length < 2) return;
  const i = store.list.findIndex((x) => x.id === store.active);
  const gone = store.list.splice(i, 1)[0];
  imageStates.delete(gone.id);
  const next = store.list[Math.max(0, i - 1)];
  store.active = '';
  switchVersion(next.id);
  renderVersions();
});

// ------------------------------------------------- panel open / phone dock
const panel = document.getElementById('panel');
const dockPanel = document.getElementById('dockPanel');
function setOpen(open) {
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  dockPanel.classList.toggle('on', open);
  dockPanel.setAttribute('aria-expanded', String(open));
}
dockPanel.addEventListener('click', () => setOpen(!panel.classList.contains('open')));
document.getElementById('panelClose').addEventListener('click', () => setOpen(false));
document.getElementById('panelOpen').addEventListener('click', () => setOpen(true));
setOpen(!PHONE_Q.matches); // start closed on phones
PHONE_Q.addEventListener('change', (e) => setOpen(!e.matches));

// The grip of the phone sheet. A tap switches half and full height. A drag
// up gives full height. A drag down gives half height, then closes.
const grip = document.getElementById('sheetGrip');
let gripY = null;
grip.addEventListener('pointerdown', (e) => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (err) { /* no capture */ } });
grip.addEventListener('pointerup', (e) => {
  if (gripY === null) return;
  const dy = e.clientY - gripY; gripY = null;
  if (Math.abs(dy) < 8) panel.classList.toggle('full');
  else if (dy < -40) panel.classList.add('full');
  else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
});
grip.addEventListener('pointercancel', () => { gripY = null; });

const dockBtns = document.querySelectorAll('#dockPresets button');
function syncDock() {
  for (const b of dockBtns) b.classList.toggle('on', b.dataset.preset === values.material.preset);
}
for (const b of dockBtns) b.addEventListener('click', () => onUserChange('material.preset', b.dataset.preset));
document.getElementById('dockReset').addEventListener('click', () => app.resetCloth());
document.getElementById('dockPoke').addEventListener('click', () => app.poke());

const hint = document.getElementById('hint');
stage.addEventListener('pointerdown', () => hint.classList.add('gone'), { once: true });
setTimeout(() => hint.classList.add('gone'), 7000);

// Occlusion framing (phone layout only). The sheet, the drawer and the dock
// cover part of the canvas. An overlay that is wider than tall covers the
// top or the base, any other one covers a side, and it counts only when it
// spans half of that edge. The desktop card floats over the canvas as the
// upstream DialKit panel does, so the desktop view keeps the upstream framing.
const OVERLAYS = [panel, document.getElementById('dock')];
function occlusion(w, h) {
  const o = { l: 0, r: 0, t: 0, b: 0 };
  if (!PHONE_Q.matches) return o;
  for (const node of OVERLAYS) {
    const q = node.getBoundingClientRect();
    const x0 = Math.max(0, q.left), x1 = Math.min(w, q.right);
    const y0 = Math.max(0, q.top), y1 = Math.min(h, q.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
    if (fw >= fh) {
      if (fw < 0.5) continue;
      if (y0 + y1 > h) o.b = Math.max(o.b, h - y0); else o.t = Math.max(o.t, y1);
    } else {
      if (fh < 0.5) continue;
      if (x0 + x1 < w) o.l = Math.max(o.l, x1); else o.r = Math.max(o.r, w - x0);
    }
  }
  return o;
}
app.setViewInsets(occlusion);

// ------------------------------------------------------------------ boot
buildPanel();
renderVersions();
app.onDecalSelect = (scale, rotation) => setValues({ images: { scale, rotation } });
app.onImagesChanged = refreshChips;

// startup assets: the procedural poster (cloth art) and scratch bump map
app.setBumpMap(makeScratchHeight());
app.setClothImage(makePosterCanvas());
values.images.useImage = true;
setValues({});
// a narrow screen starts with the camera further back, so the whole drape fits
app.fitStartView();
refreshChips();
app.reveal();
stage.classList.add('ready');
const loader = document.getElementById('loader');
loader.classList.add('hiding');
setTimeout(() => loader.remove(), 600);

// test hooks for the headless render check (read-only probes)
window.__holoProbe = () => app.probePoint();
window.__holoState = () => ({
  perf: values.performance,
  segments: `${app.sim.cols}x${app.sim.rows}`,
  pixelRatio: app.renderer.getPixelRatio(),
  canvas: [app.renderer.domElement.width, app.renderer.domElement.height],
  panelOpen: panel.classList.contains('open'),
  insets: app.insets,
  camDist: +app.camera.position.distanceTo(app.controls.target).toFixed(3),
});
