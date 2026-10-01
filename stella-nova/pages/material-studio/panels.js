// ============================================================================
//  MATERIAL STUDIO  ·  panels.js — inspector, library, maps strip, light,
//                                   export, topbar and the shortcut sheet
// ────────────────────────────────────────────────────────────────────────────
//  Owner: PANELS agent. This module fills the static regions of index.html
//  that belong to no other module:
//      #inspector ....... params of the selected nodes, or Material settings
//      #lib-body ........ the node library: search, favorites, recent, tree
//      #maps-strip ...... one live thumbnail per baked map channel
//      #env-panel ....... HDRI presets, rotation, intensity, lights, view
//      #export-panel .... target cards and options; calls export.js
//      #tb-file / #tb-right  project name, File menu, bake meter, Export, ?
//
//  DATA FLOW
//      read:   state.graph, state.registry, state.selection, state.maps,
//              state.env, state.view, state.settings, state.compiled
//      write:  node params through the graph module (setParam if it exists,
//              else node.params), then emit graph:changed {reason:'param'}
//              and store.checkpoint(label, {merge}) once per frame.
//              One drag gesture is one merge key, so it is one undo step.
//      events: graph:select / graph:changed -> inspector
//              bake:done -> maps strip, bake meter, material stats
//              env:changed / view:changed -> env panel, strip solo marker
//
//  SECTIONS  (grep -n the banner to jump)
//      util ............. h(), icons, numbers, colors, localStorage
//      graph access ..... getNode, defOf, commitParam, addNodeAt, loadGraph
//      widgets .......... wSlider wColor (picker) wEnum wBool wVec2
//                         wGradient wCurve wImage wText, makeWidget
//      param rows ....... paramRow (reset + expose buttons)
//      inspector ........ renderInspector, nodeView, materialView
//      library .......... buildLibrary, renderLibrary, fuzzy, drag
//      maps strip ....... TILES, thumbnail pipeline, renderTiles, lightbox
//      env panel ........ renderEnv, light editor, view controls
//      export panel ..... renderExport, runExport
//      topbar ........... file menu, project name, bake meter
//      shortcuts ........ SHORTCUTS, overlay, key handler
//      init / api ....... init(ctx), __studio.panels, selfTest
//
//  CONTRACT ADDITIONS  (fields this module adds; see the report)
//      GraphNode.exposed  string[] of param ids shown on the Material view
//      light.az / light.el  degrees, kept beside light.dir for the editor;
//                           dir is the unit vector from the surface to the light
//      optional hooks it calls when they exist:
//        graph.getNode / graph.setParam / graph.addNode / graph.removeNode
//        editor.addNodeAt(type, clientX, clientY) | editor.screenToGraph(x, y)
//        editor.shortcuts [{keys, label}] (listed in the ? overlay)
//        env.ENV_PRESETS | env.PRESETS [{id,label,thumb?}], env.setPreset, env.loadHDR
//        export.exportPackage(target, opts), export.FORMATS
//        import.importMaps(files), import.imageToPBR(file)
//        bench.importBenchGraph(json), mobile.setSheet(name)
//      optional event it reads: 'bake:progress' {done, total}
// ============================================================================
import {
  RES_OPTIONS, EXPORT_TARGETS, MESHES, DEBUG_VIEWS, TONEMAPPERS, emptyGraph,
} from './contract.js';
import { ctx, store, state, M, $, bind } from './panels/ctx.js';
import { lsGet, lsSet, clamp, clone, slug } from './panels/util.js';
import { h, icon, ibtn, download, pickFiles, typing, isPhone } from './panels/dom.js';
import { graph, getNode, selfEmit, loadGraph, serializeGraph } from './panels/graph-access.js';
import { wSlider } from './panels/widgets/slider.js';
import { closePicker } from './panels/widgets/picker.js';
import { wColor } from './panels/widgets/color.js';
import { wEnum, wBool } from './panels/widgets/basic.js';
import { wGradient } from './panels/widgets/gradient.js';
import { WIDGETS, makeWidget } from './panels/widgets/index.js';
import { section, envRow } from './panels/rows.js';
import { insRows, renderInspector, refreshInspector } from './panels/inspector.js';
import { statsLine, ballCss, loadPreset, setName } from './panels/material-view.js';
import {
  addNodeAt, lib, buildLibrary, fuzzy, renderLibrary, initLibrary,
} from './panels/library.js';
import {
  TILES, thumbs, initThumbPipeline, initStrip, markSolo, updateStrip,
} from './panels/maps-strip.js';

// ------------------------------------------------------------ env panel
const FALLBACK_ENVS = [
  { id: 'studio', label: 'Studio', c: ['#d8dde6', '#3a3f4a'] },
];
function envPresets() {
  const e = M.env || {};
  let list = e.ENV_PRESETS || e.PRESETS || (typeof e.listPresets === 'function' ? e.listPresets() : null);
  if (list && !Array.isArray(list)) list = Object.entries(list).map(([id, v]) => ({ id, ...(typeof v === 'object' ? v : { label: String(v) }) }));
  return (list && list.length ? list : FALLBACK_ENVS).map(p => typeof p === 'string' ? { id: p, label: p } : p);
}
function envThumb(p) {
  const el = h('i', { class: 'pe-th' });
  const fill = src => { if (src) { el.style.backgroundImage = `url("${src}")`; el.classList.add('img'); } };
  if (p.thumb) fill(p.thumb);
  else if (typeof M.env?.presetThumbnail === 'function') {
    Promise.resolve().then(() => M.env.presetThumbnail(p.id)).then(r => {
      if (!r) return;
      if (typeof r === 'string') fill(r);
      else if (r instanceof HTMLCanvasElement) fill(r.toDataURL());
    }).catch(() => {});
  }
  const c = p.colors || p.c || hashColors(p.id);
  el.style.background = `linear-gradient(180deg, ${c[0]} 0%, ${c[0]} 42%, ${c[1] || c[0]} 58%, ${c[2] || '#0b0d12'} 100%)`;
  return el;
}
function hashColors(id) {
  let x = 0; for (const ch of String(id)) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  const hu = x % 360;
  return [`hsl(${hu} 40% 72%)`, `hsl(${(hu + 30) % 360} 25% 32%)`, `hsl(${(hu + 50) % 360} 20% 10%)`];
}
function setEnvPreset(id) {
  if (typeof M.env?.setPreset === 'function') {
    Promise.resolve(M.env.setPreset(id)).catch(e => store.toast('Environment failed: ' + (e.message || e), 'error'));
    if (state.env.preset !== id) store.setEnv({ preset: id });
  } else store.setEnv({ preset: id });
}
let envSelf = 0;
/** Env and view edits from this panel do not re-render it (the widget already shows the value). */
const setEnvSelf = patch => { envSelf++; try { store.setEnv(patch); } finally { envSelf--; } };
const setViewSelf = patch => { envSelf++; try { store.setView(patch); } finally { envSelf--; } };
function envSlider(key, label, min, max, step, scale = 1, title) {
  return envRow(label, wSlider({ id: key, label, kind: 'slider', min, max, step, default: min }, state.env[key] * scale, v => setEnvSelf({ [key]: v / scale })), title);
}
function viewSlider(key, label, min, max, step, title) {
  return envRow(label, wSlider({ id: key, label, kind: 'slider', min, max, step, default: min }, state.view[key], v => setViewSelf({ [key]: v })), title);
}
function renderEnv() {
  const root = $('env-panel'); if (!root) return;
  closePicker();
  const scroll = root.scrollTop;
  const env = state.env;
  const frag = document.createDocumentFragment();
  // env.js owns the environment controls (probe, presets, Poly Haven, lights)
  // through mountPanel(el). This panel then adds only the View section.
  if (typeof M.env?.mountPanel === 'function' && !envFallback) {
    if (!envHost || !root.contains(envHost)) {
      envHost = h('div', { class: 'pe-env' }); viewHost = h('div', { class: 'pe-view' });
      root.replaceChildren(envHost, viewHost);
      try { M.env.mountPanel(envHost); } catch (e) { console.warn('[panels] env.mountPanel', e); envFallback = true; return renderEnv(); }
    }
    viewHost.replaceChildren(viewSection());
    root.scrollTop = scroll;
    return;
  }
  // presets
  const grid = h('div', { class: 'pe-grid' }, envPresets().map(p => h('button', {
    type: 'button', class: 'pe-p' + (env.preset === p.id ? ' on' : ''), title: p.description || p.label || p.id, onclick: () => setEnvPreset(p.id),
  }, envThumb(p), h('span', null, p.label || p.id))));
  const hdr = h('button', { type: 'button', class: 'pn-btn', onclick: async () => {
    const [f] = await pickFiles('.hdr,.rgbe,image/vnd.radiance');
    if (!f) return;
    if (typeof M.env?.loadHDR !== 'function') { store.toast('HDR loading is not available yet', 'warn'); return; }
    try { await M.env.loadHDR(f); store.toast(`Loaded ${f.name}`, 'ok'); } catch (e) { store.toast('HDR failed: ' + (e.message || e), 'error'); }
  } }, icon('file'), 'Load .hdr…');
  frag.append(section('env-presets', 'Environment', [grid, h('div', { class: 'pn-head-a' }, hdr, h('span', { class: 'pn-sub' }, env.preset && !envPresets().some(p => p.id === env.preset) ? `custom: ${env.preset}` : ''))]));
  frag.append(section('env-light', 'Lighting', [
    envSlider('rotation', 'Rotation', 0, 360, 1, 1, 'HDRI rotation around the up axis, degrees'),
    envSlider('intensity', 'Intensity', 0, 4, 0.01, 1, 'Multiplier on the image-based light'),
    envRow('Background', wEnum({ id: 'background', label: 'Background', kind: 'enum', options: [{ value: 'hdri', label: 'HDRI' }, { value: 'blur', label: 'Blur' }, { value: 'color', label: 'Color' }] }, env.background, v => { store.setEnv({ background: v }); renderEnv(); })),
    env.background === 'blur' ? envSlider('blur', 'Blur', 0, 1, 0.01) : null,
    env.background === 'color' ? envRow('Color', wColor({ id: 'bgColor', label: 'Background' }, env.bgColor, v => setEnvSelf({ bgColor: v }))) : null,
  ]));
  // lights
  const lights = env.lights || [];
  const lrows = lights.map((L, i) => lightRow(L, i));
  const add = type => {
    const L = type === 'dir' ? { type: 'dir', color: '#fff4e0', intensity: 2, az: 45, el: 35, on: true } : { type: 'point', color: '#ffffff', intensity: 4, pos: [1.5, 1.5, 1.5], on: true };
    if (L.type === 'dir') L.dir = azElToDir(L.az, L.el);
    store.setEnv({ lights: [...lights, L] }); renderEnv();
  };
  frag.append(section('env-lights', 'Analytic lights', [
    lrows.length ? lrows : h('div', { class: 'pn-empty' }, 'No analytic lights. The HDRI lights the material alone.'),
    h('div', { class: 'pn-head-a' },
      h('button', { type: 'button', class: 'pn-btn', onclick: () => add('dir') }, icon('sun'), 'Directional'),
      h('button', { type: 'button', class: 'pn-btn', onclick: () => add('point') }, icon('bulb'), 'Point')),
  ], { extra: h('span', { class: 'pn-count' }, String(lights.length)) }));
  frag.append(viewSection());
  root.replaceChildren(frag);
  root.scrollTop = scroll;
}
let envHost = null, viewHost = null, envFallback = false;
/** Viewport controls: mesh, debug view, tonemapper, exposure, toggles. */
function viewSection() {
  const view = state.view;
  const meshGrid = h('div', { class: 'pn-seg wrap' }, MESHES.map(m => h('button', { type: 'button', class: 'pn-seg-b' + (view.mesh === m ? ' on' : ''), onclick: () => { store.setView({ mesh: m }); renderEnv(); } }, MESH_LABEL[m] || m)));
  const dbg = wEnum({ id: 'debug', label: 'Debug view', kind: 'enum', options: DEBUG_VIEWS.map(v => ({ value: v, label: VIEW_LABEL[v] || v })) }, view.debug, v => setViewSelf({ debug: v }));
  const tm = wEnum({ id: 'tonemap', label: 'Tonemapper', kind: 'enum', options: TONEMAPPERS.map(v => ({ value: v, label: TM_LABEL[v] || v })) }, view.tonemap, v => setViewSelf({ tonemap: v }));
  const tog = (key, label, title) => envRow(label, wBool({ label }, view[key], v => setViewSelf({ [key]: v })), title);
  return section('env-view', 'View', [
    h('div', { class: 'pn-prm wide' }, h('label', { class: 'pn-lbl' }, 'Mesh'), h('div', { class: 'pn-ctl' }, meshGrid)),
    envRow('Debug view', dbg), envRow('Tonemapper', tm),
    viewSlider('exposure', 'Exposure (EV)', -6, 6, 0.05),
    viewSlider('uvScale', 'UV scale', 0.25, 8, 0.05, 'Repeat the baked maps on the mesh'),
    tog('parallax', 'Parallax', 'Parallax occlusion from the height map'),
    tog('displacement', 'Displacement', 'Move vertices by the height map'),
    view.displacement ? envRow('Subdivision', wSlider({ id: 'subdiv', label: 'Subdivision', kind: 'int', min: 16, max: 512, step: 16, default: 128 }, view.subdiv, v => setViewSelf({ subdiv: v }))) : null,
    tog('wireframe', 'Wireframe'), tog('autoRotate', 'Auto rotate'),
  ]);
}
const MESH_LABEL = { sphere: 'Sphere', cube: 'Cube', roundedCube: 'Rounded', plane: 'Plane', cylinder: 'Cylinder', torus: 'Torus', shaderBall: 'Shader ball' };
const VIEW_LABEL = { lit: 'Lit', albedo: 'Base color', opacity: 'Opacity', normal: 'Normal (tangent)', worldNormal: 'Normal (world)', ao: 'AO', roughness: 'Roughness', metallic: 'Metallic', height: 'Height', emissive: 'Emissive', clearcoat: 'Clearcoat', sheen: 'Sheen', anisotropy: 'Anisotropy', uv: 'UV', diffuseOnly: 'Diffuse only', specularOnly: 'Specular only' };
const TM_LABEL = { aces: 'ACES', agx: 'AgX', khronosNeutral: 'Khronos PBR Neutral', reinhard: 'Reinhard', filmic: 'Filmic', linear: 'Linear (clip)' };
function azElToDir(az, el) {
  const a = az * Math.PI / 180, e = el * Math.PI / 180;
  return [+(Math.cos(e) * Math.sin(a)).toFixed(4), +Math.sin(e).toFixed(4), +(Math.cos(e) * Math.cos(a)).toFixed(4)];
}
function dirToAzEl(d) {
  const [x, y, z] = d || [0, 1, 0]; const l = Math.hypot(x, y, z) || 1;
  return [((Math.atan2(x, z) * 180 / Math.PI) + 360) % 360, Math.asin(clamp(y / l, -1, 1)) * 180 / Math.PI];
}
function lightRow(L, i) {
  const upd = (patch, rerender) => {
    const lights = state.env.lights.map((x, j) => j === i ? { ...x, ...patch } : x);
    const n = lights[i];
    if (n.type === 'dir' && ('az' in patch || 'el' in patch)) n.dir = azElToDir(n.az ?? 0, n.el ?? 45);
    setEnvSelf({ lights });
    if (rerender) renderEnv();
  };
  if (L.type === 'dir' && (L.az == null || L.el == null)) { const [a, e] = dirToAzEl(L.dir); L.az = Math.round(a); L.el = Math.round(e); }
  const on = L.on !== false;
  const head = h('div', { class: 'lt-h' },
    wBool({ label: 'Light on' }, on, v => upd({ on: v })).el,
    h('b', null, `${L.type === 'dir' ? 'Directional' : 'Point'} ${i + 1}`),
    h('span', { class: 'pn-sp' }),
    ibtn('copy', 'Duplicate the light', () => { store.setEnv({ lights: [...state.env.lights, clone(L)] }); renderEnv(); }),
    ibtn('trash', 'Remove the light', () => { store.setEnv({ lights: state.env.lights.filter((_, j) => j !== i) }); renderEnv(); }));
  const rows = [
    envRow('Color', wColor({ label: 'Light' }, L.color || '#ffffff', v => upd({ color: v }))),
    envRow('Intensity', wSlider({ label: 'Intensity', kind: 'slider', min: 0, max: 20, step: 0.05, default: 1 }, L.intensity ?? 1, v => upd({ intensity: v }))),
  ];
  if (L.type === 'dir') {
    rows.push(envRow('Azimuth', wSlider({ label: 'Azimuth', kind: 'slider', min: 0, max: 360, step: 1, default: 0 }, L.az, v => upd({ az: v }))));
    rows.push(envRow('Elevation', wSlider({ label: 'Elevation', kind: 'slider', min: -90, max: 90, step: 1, default: 45 }, L.el, v => upd({ el: v }))));
  } else {
    const pos = L.pos || [1, 1, 1];
    ['X', 'Y', 'Z'].forEach((ax, k) => rows.push(envRow('Pos ' + ax, wSlider({ label: ax, kind: 'slider', min: -5, max: 5, step: 0.01, default: 0 }, pos[k], v => { const p = [...(state.env.lights[i].pos || pos)]; p[k] = v; upd({ pos: p }); }))));
    rows.push(envRow('Range', wSlider({ label: 'Range', kind: 'slider', min: 0, max: 20, step: 0.1, default: 0 }, L.range ?? 0, v => upd({ range: v }), 'Zero: inverse-square falloff with no cutoff')));
  }
  return h('div', { class: 'lt' + (on ? '' : ' off') }, head, rows);
}

// ------------------------------------------------------------ export panel
const exp = { target: lsGet('exportTarget', 'unity-urp'), opts: lsGet('exportOpts', { res: 'bake', format: 'png', includeGraph: true, helpers: true, name: '' }), busy: false, last: null };
const TARGET_NOTES = {
  'unity-urp': 'Lit shader. Albedo (sRGB), Normal (OpenGL), MetallicSmoothness, Occlusion, Height, Emission. Helper: an editor script that builds the .mat.',
  'unity-hdrp': 'Lit shader. BaseColor, Normal, MaskMap (metal, AO, detail, smooth), Height, Emissive. Helper: an editor script.',
  'unity-builtin': 'Standard shader. Albedo, Normal, MetallicGloss, Occlusion, Height, Emission.',
  'unreal': 'BaseColor (sRGB), Normal (DirectX, green flipped), ORM (linear, no sRGB), Height, Emissive. Helper: a Python import script.',
  'godot': 'StandardMaterial3D. Albedo, Normal (OpenGL), ORM, Height, Emission, and a .tres material.',
  'gltf': 'One .glb: a UV sphere with the material: baseColor, metallicRoughness, normal, occlusion, emissive; KHR extensions for clearcoat, sheen, anisotropy, IOR and transmission.',
  'png': 'Every map as a 16-bit or 8-bit PNG with the channel layout of the baked maps.',
};
function renderExport() {
  const root = $('export-panel'); if (!root) return;
  // export.js builds its own panel here (class io-host). Then this is only the fallback.
  if (exp.foreign == null) exp.foreign = root.childElementCount > 0 && !root.querySelector('.ex-cards');
  if (exp.foreign) return;
  const o = exp.opts, frag = document.createDocumentFragment();
  const cards = h('div', { class: 'ex-cards', role: 'radiogroup', 'aria-label': 'Export target' }, EXPORT_TARGETS.map(t => h('button', {
    type: 'button', role: 'radio', class: 'ex-card' + (exp.target === t.id ? ' on' : ''), 'aria-checked': String(exp.target === t.id),
    onclick: () => { exp.target = t.id; lsSet('exportTarget', t.id); renderExport(); },
  }, h('b', null, t.label), h('span', { class: 'ex-tag' + (t.normalY === '-Y' ? ' dx' : '') }, t.normalY === '-Y' ? 'normal DX −Y' : 'normal GL +Y'), h('span', { class: 'ex-pack' }, t.packing))));
  frag.append(section('ex-target', 'Target', [cards, h('p', { class: 'pn-doc' }, TARGET_NOTES[exp.target] || '')]));
  const setO = (k, v) => { exp.opts = { ...exp.opts, [k]: v }; lsSet('exportOpts', exp.opts); };
  const name = h('input', { class: 'pn-name sm', type: 'text', value: o.name || graph()?.name || '', placeholder: slug(graph()?.name || 'material'), spellcheck: 'false', 'aria-label': 'Export name' });
  name.addEventListener('change', () => setO('name', name.value.trim()));
  const resOpts = [{ value: 'bake', label: `Bake (${state.settings.res})` }, ...RES_OPTIONS.map(r => ({ value: String(r), label: String(r) }))];
  const formats = M.export?.FORMATS || ['png'];
  frag.append(section('ex-opts', 'Options', [
    envRow('Name', name),
    envRow('Resolution', wEnum({ label: 'Resolution', kind: 'enum', options: resOpts }, String(o.res || 'bake'), v => setO('res', v)), 'A size other than the bake size re-bakes the graph at export time'),
    formats.length > 1 ? envRow('Format', wEnum({ label: 'Format', kind: 'enum', options: formats }, o.format || formats[0], v => setO('format', v))) : null,
    envRow('Graph JSON', wBool({ label: 'Include graph JSON' }, o.includeGraph !== false, v => setO('includeGraph', v)), 'Put the .material.json graph in the package'),
    envRow('Import helper', wBool({ label: 'Include import helper' }, o.helpers !== false, v => setO('helpers', v)), 'Engine script or material file that wires the maps'),
  ]));
  const go = h('button', { type: 'button', class: 'pn-btn pri big', disabled: exp.busy || !ctx.gpu.ok, onclick: runExport }, icon('down'), exp.busy ? 'Exporting…' : `Export ${EXPORT_TARGETS.find(t => t.id === exp.target)?.label || ''}`);
  const status = h('div', { class: 'ex-status', id: 'pn-ex-status' }, exp.last ? exp.last : (ctx.gpu.ok ? (state.maps ? `Maps ready: ${state.maps.res}²` : 'No bake yet: export waits for one') : 'WebGPU is not available, so export cannot read the maps'));
  frag.append(h('div', { class: 'ex-go' }, go, status));
  root.replaceChildren(frag);
}
async function runExport() {
  if (exp.busy) return;
  if (typeof M.export?.exportPackage !== 'function') { store.toast('Export module missing', 'error'); return; }
  const t = EXPORT_TARGETS.find(x => x.id === exp.target);
  const o = exp.opts;
  const name = slug(o.name || graph()?.name || 'material');
  const opts = { name, includeGraph: o.includeGraph !== false, helpers: o.helpers !== false, format: o.format || 'png' };
  if (o.res && o.res !== 'bake') opts.res = +o.res;
  exp.busy = true; exp.last = null; renderExport();
  const t0 = performance.now();
  try {
    const blob = await M.export.exportPackage(exp.target, opts);
    if (!(blob instanceof Blob)) throw new Error('exportPackage returned no Blob');
    const ext = blob.name ? '' : (/gltf-binary|octet-stream/.test(blob.type) && exp.target === 'gltf' ? '.glb' : (/zip/.test(blob.type) || exp.target !== 'gltf' ? '.zip' : '.glb'));
    const file = blob.name || `${name}_${exp.target}${ext}`;
    download(blob, file);
    exp.last = `${file} · ${(blob.size / 1024).toFixed(0)} KB · ${(performance.now() - t0).toFixed(0)} ms`;
    store.toast(`Exported ${t.label}: ${file}`, 'ok');
  } catch (e) {
    console.error('[panels] export', e);
    exp.last = 'Export failed: ' + (e.message || e);
    store.toast(exp.last, 'error');
  } finally { exp.busy = false; renderExport(); }
}

// ------------------------------------------------------------ topbar
const meter = { t0: 0, hist: lsGet('bakeHist', []) };
function initTopbar() {
  const file = $('tb-file'), right = $('tb-right');
  // project name + File menu
  const nm = h('input', { id: 'pn-projname', class: 'tb-name', type: 'text', spellcheck: 'false', placeholder: 'Untitled material', 'aria-label': 'Project name', value: graph()?.name || '' });
  nm.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') nm.blur(); });
  nm.addEventListener('change', () => { setName(nm.value); if (!state.selection.length) renderInspector(true); });
  const fileBtn = h('button', { type: 'button', class: 'tb-btn', 'aria-haspopup': 'menu', title: 'File' }, 'File ▾');
  fileBtn.addEventListener('click', e => { e.stopPropagation(); toggleMenu(fileBtn, fileMenuItems()); });
  file?.prepend(nm, fileBtn);
  // bake meter + export + help
  const bar = h('i', { class: 'tb-prog' }, h('i'));
  const spark = h('canvas', { class: 'tb-spark', width: 120, height: 36, title: 'Bake time, last 24 bakes' });
  meter.bar = bar; meter.spark = spark;
  $('bake-status')?.after(bar, spark);
  // export.js puts Open / Save / Import / Export buttons in #tb-file; add an
  // Export button here only when it did not.
  const ioBar = !!file?.querySelector('.io-tb');
  const exportBtn = ioBar ? null : h('button', { type: 'button', class: 'tb-btn tb-pri', title: 'Export (Ctrl+E)', onclick: openExport }, icon('down'), 'Export');
  const helpBtn = h('button', { type: 'button', class: 'tb-btn', title: 'Keyboard shortcuts (?)', 'aria-label': 'Keyboard shortcuts', onclick: toggleShortcuts }, '?');
  right?.append(...[exportBtn, helpBtn].filter(Boolean));
  drawSpark();
  // undo/redo labels
  store.on('history:changed', ({ label, canUndo, canRedo }) => {
    const u = $('btn-undo'), r = $('btn-redo');
    if (u) u.title = canUndo ? `Undo ${label || ''} (Ctrl+Z)` : 'Nothing to undo';
    if (r) r.title = canRedo ? 'Redo (Ctrl+Shift+Z)' : 'Nothing to redo';
  });
}
function openExport() {
  if (isPhone() && M.mobile?.setSheet) M.mobile.setSheet('export');
  else { document.querySelector('#side-tabs button[data-tab="export"]')?.click(); }
}
function fileMenuItems() {
  const presets = M.presets?.MATERIAL_PRESETS || [];
  const io = window.__studio?.io || {};
  const imp = M.import || {};
  const items = [
    { label: 'New material', kbd: '', run: () => loadGraph(emptyGraph(), 'New material', { keepRes: true }) },
    { label: typeof imp.pickFiles === 'function' ? 'Open project, graph, maps or zip…' : 'Open graph JSON…', kbd: 'Ctrl+O', run: () => typeof imp.pickFiles === 'function' ? imp.pickFiles() : openGraphFile() },
    typeof io.saveProject === 'function' ? { label: 'Save project (.studio.json)', kbd: 'Ctrl+S', run: () => io.saveProject().catch(e => store.toast(String(e.message || e), 'error')) } : null,
    { label: 'Save graph JSON', kbd: typeof io.saveProject === 'function' ? '' : 'Ctrl+S', run: saveGraphFile },
    { label: 'Copy graph JSON', run: async () => { try { await navigator.clipboard.writeText(JSON.stringify(serializeGraph(), null, 1)); store.toast('Graph JSON copied', 'ok'); } catch (e) { store.toast('Clipboard is blocked', 'warn'); } } },
    { label: 'Paste graph JSON', run: async () => { try { const t = await navigator.clipboard.readText(); openGraphText(t, 'clipboard'); } catch (e) { store.toast('Clipboard is blocked', 'warn'); } } },
    { sep: true },
    { label: 'Import maps / images…', disabled: typeof M.import?.importMaps !== 'function', run: async () => {
      const files = await pickFiles('image/*', true); if (!files.length) return;
      try { const r = await M.import.importMaps(files); store.toast(`Imported ${r.added.length} map(s)${r.skipped.length ? `, skipped ${r.skipped.length}` : ''}`, r.added.length ? 'ok' : 'warn'); } catch (e) { store.toast('Import failed: ' + (e.message || e), 'error'); }
    } },
    { label: 'Import Composition Bench graph…', disabled: typeof M.bench?.importBenchGraph !== 'function', run: async () => {
      const [f] = await pickFiles('.json,application/json'); if (!f) return;
      try { const g = M.bench.importBenchGraph(JSON.parse(await f.text())); loadGraph(g, 'Import bench graph', { keepRes: true }); } catch (e) { store.toast('Bench import failed: ' + (e.message || e), 'error'); }
    } },
    { label: 'Open in Composition Bench', disabled: typeof M.bench?.openInBench !== 'function', run: () => {
      try { M.bench.openInBench(serializeGraph()); } catch (e) { store.toast('Bench hand-off failed: ' + (e.message || e), 'error'); }
    } },
    { label: 'Image to PBR (server)…', disabled: typeof (imp.imageToPBR || io.imageToPBR) !== 'function', run: async () => {
      const [f] = await pickFiles('image/*'); if (!f) return;
      try { await (imp.imageToPBR || io.imageToPBR)(f); } catch (e) { store.toast('Image to PBR failed: ' + (e.message || e), 'error'); }
    } },
    { sep: true },
    { label: 'Export…', kbd: 'Ctrl+E', run: openExport },
  ];
  if (presets.length) {
    items.push({ sep: true }, { head: 'Starter materials' });
    for (const pr of presets) items.push({ label: pr.label, ball: pr.swatch, run: () => loadPreset(pr) });
  }
  return items.filter(Boolean);
}
let menuEl = null;
function toggleMenu(anchor, items) {
  if (menuEl) { const was = menuEl._anchor === anchor; closeMenu(); if (was) return; }
  menuEl = h('div', { class: 'pn-menu', role: 'menu' }, items.map(it => it.sep ? h('hr') : it.head ? h('div', { class: 'pn-menu-h' }, it.head)
    : h('button', { type: 'button', role: 'menuitem', disabled: !!it.disabled, onclick: () => { closeMenu(); it.run(); } },
      it.ball ? h('i', { class: 'pn-ball sm', style: { background: ballCss(it.ball) } }) : null, h('span', null, it.label), it.kbd ? h('kbd', null, it.kbd) : null)));
  menuEl._anchor = anchor;
  document.body.appendChild(menuEl);
  const r = anchor.getBoundingClientRect();
  menuEl.style.left = clamp(r.left, 6, window.innerWidth - menuEl.offsetWidth - 6) + 'px';
  menuEl.style.top = (r.bottom + 4) + 'px';
  menuEl.style.maxHeight = (window.innerHeight - r.bottom - 16) + 'px';
  menuEl.querySelector('button:not(:disabled)')?.focus();
}
function closeMenu() { menuEl?.remove(); menuEl = null; }
document.addEventListener('pointerdown', e => { if (menuEl && !menuEl.contains(e.target) && !menuEl._anchor.contains(e.target)) closeMenu(); });
async function openGraphFile() {
  const [f] = await pickFiles('.json,application/json'); if (!f) return;
  openGraphText(await f.text(), f.name);
}
function openGraphText(text, src) {
  let j; try { j = JSON.parse(text); } catch (e) { store.toast(`${src} is not JSON`, 'error'); return; }
  if (j && j.version === 1 && Array.isArray(j.nodes) && j.output) { if (loadGraph(j, 'Open ' + src)) store.toast(`Opened ${src}`, 'ok'); return; }
  if (typeof M.bench?.importBenchGraph === 'function') {
    try { const g = M.bench.importBenchGraph(j); if (loadGraph(g, 'Import bench graph', { keepRes: true })) store.toast(`Imported Composition Bench graph from ${src}`, 'ok'); return; }
    catch (e) { store.toast(`${src}: not a material graph, and the bench import failed: ${e.message}`, 'error'); return; }
  }
  store.toast(`${src} is not a material graph (version 1)`, 'error');
}
function saveGraphFile() {
  const j = serializeGraph();
  const blob = new Blob([JSON.stringify(j, null, 1)], { type: 'application/json' });
  download(blob, `${slug(j.name || 'material')}.material.json`);
}
function meterStart() {
  meter.t0 = performance.now();
  meter.bar?.classList.add('busy'); meter.bar?.classList.remove('err');
  if (meter.bar) meter.bar.firstChild.style.width = '0%';
}
function meterDone(maps) {
  const ms = maps && maps.ms != null ? maps.ms : performance.now() - meter.t0;
  meter.bar?.classList.remove('busy');
  if (meter.bar) meter.bar.firstChild.style.width = '100%';
  meter.hist.push(+ms.toFixed(1)); meter.hist = meter.hist.slice(-24); lsSet('bakeHist', meter.hist);
  const st = $('bake-status');
  if (st) {
    const a = meter.hist, avg = a.reduce((x, y) => x + y, 0) / a.length;
    st.title = `last ${ms.toFixed(1)} ms · avg ${avg.toFixed(1)} · min ${Math.min(...a).toFixed(1)} · max ${Math.max(...a).toFixed(1)} (${a.length} bakes)`;
  }
  drawSpark();
}
function drawSpark() {
  const cv = meter.spark; if (!cv) return;
  const c = cv.getContext('2d'), a = meter.hist, W = cv.width, H = cv.height;
  c.clearRect(0, 0, W, H);
  if (!a.length) return;
  const mx = Math.max(16, ...a);
  const bw = W / 24;
  a.forEach((v, i) => {
    const hh = Math.max(2, (v / mx) * (H - 2));
    c.fillStyle = v > 250 ? '#ff9a4a' : v > 60 ? '#ffc832' : '#64c864';
    c.globalAlpha = i === a.length - 1 ? 1 : 0.55;
    c.fillRect(W - (a.length - i) * bw + 1, H - hh, bw - 2, hh);
  });
  c.globalAlpha = 1;
}

// ------------------------------------------------------------ shortcuts
const SHORTCUTS = [
  ['General', [['?', 'Show or hide this sheet'], ['Ctrl+Z', 'Undo'], ['Ctrl+Shift+Z / Ctrl+Y', 'Redo'], ['Ctrl+S', 'Save graph JSON'], ['Ctrl+O', 'Open graph JSON'], ['Ctrl+E', 'Export panel'], ['Esc', 'Close a menu, picker or sheet']]],
  ['Library', [['/', 'Search nodes'], ['↑ ↓', 'Move in the list'], ['Enter', 'Add the node'], ['Double-click', 'Add the node'], ['Drag', 'Drop the node on the graph']]],
  ['Viewport', [['Alt+1 … Alt+9', 'Solo a map in the viewport'], ['Alt+0', 'Lit view'], ['Click a map tile', 'Solo it; click again for lit'], ['Double-click a map', 'Enlarge it with a texel readout']]],
  ['Params', [['Drag a number', 'Scrub (Shift fine, Alt coarse)'], ['↑ ↓ in a number', 'Step (Shift ×10)'], ['Type 0.5*2', 'Simple arithmetic'], ['Shift+drag a bar', 'Fine adjust'], ['Gradient: drag a stop down', 'Delete the stop'], ['Curve: double-click', 'Delete a point']]],
];
let helpEl = null;
function toggleShortcuts() {
  if (helpEl) { helpEl.remove(); helpEl = null; return; }
  const groups = [...SHORTCUTS];
  const ed = M.editor?.shortcuts || window.__studio?.editor?.shortcuts;
  if (Array.isArray(ed) && ed.length) groups.splice(1, 0, ['Graph editor', ed.map(s => Array.isArray(s) ? s : [s.keys, s.label])]);
  helpEl = h('div', { class: 'pn-modal', role: 'dialog', 'aria-label': 'Keyboard shortcuts', onclick: e => { if (e.target === helpEl) toggleShortcuts(); } },
    h('div', { class: 'pn-modal-c keys' },
      h('div', { class: 'pn-modal-h' }, icon('key'), h('b', null, 'Keyboard shortcuts'), h('span', { class: 'pn-sp' }), ibtn('close', 'Close', toggleShortcuts)),
      h('div', { class: 'keys-g' }, groups.map(([t, list]) => h('div', { class: 'keys-c' }, h('h4', null, t), list.map(([k, d]) => h('div', { class: 'keys-r' }, h('kbd', null, k), h('span', null, d))))))));
  document.body.appendChild(helpEl);
}
function onKey(e) {
  if (e.defaultPrevented) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key;
  if (k === 'Escape') { if (helpEl) { toggleShortcuts(); return; } if (menuEl) { closeMenu(); return; } }
  if (mod && !e.altKey && !window.__studio?.io) { // export.js owns these keys when it is loaded
    const kk = k.toLowerCase();
    if (kk === 's') { e.preventDefault(); saveGraphFile(); return; }
    if (kk === 'o') { e.preventDefault(); openGraphFile(); return; }
    if (kk === 'e') { e.preventDefault(); openExport(); return; }
  }
  if (typing(e.target)) return;
  if (k === '?' || (k === '/' && e.shiftKey)) { e.preventDefault(); toggleShortcuts(); return; }
  if (k === '/' && !mod) { e.preventDefault(); if (isPhone()) M.mobile?.setSheet?.('lib'); lib.searchEl?.focus(); lib.searchEl?.select(); return; }
  if (e.altKey && !mod && /^Digit\d$/.test(e.code)) {
    const d = +e.code.slice(5);
    const views = TILES.filter(t => t.view);
    e.preventDefault();
    if (d === 0) store.setView({ debug: 'lit' });
    else if (views[d - 1]) store.setView({ debug: views[d - 1].view });
  }
}

// ------------------------------------------------------------ init / api
export const api = {
  renderInspector, renderLibrary, renderEnv, renderExport, updateStrip, addNodeAt, loadGraph,
  toggleShortcuts, openExport,
  get thumbs() { return { ready: !!thumbs.pipe, rendered: thumbs.n, err: thumbs.err }; },
  async selfTest() {
    const r = {
      inspector: !!$('inspector')?.children.length,
      libEntries: lib.entries.length,
      libRows: lib.listEl ? lib.listEl.querySelectorAll('.pn-li').length : 0,
      tiles: thumbs.tiles.size, thumbPipe: !!thumbs.pipe, thumbsRendered: thumbs.n, thumbErr: thumbs.err,
      envPresets: envPresets().length,
      exportTargets: document.querySelectorAll('#export-panel .ex-card').length,
    };
    // widget round trip, detached from the document
    const got = [];
    const s = wSlider({ id: 't', label: 't', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.5 }, 0.5, v => got.push(v));
    s.set(0.25);
    const g = wGradient({ id: 'g', label: 'g', kind: 'gradient', default: [{ t: 0, color: '#000000' }, { t: 1, color: '#ffffff' }] }, null, v => got.push(v));
    void g;
    r.widgets = Object.keys(WIDGETS).every(k => { try { return !!makeWidget({ id: 'x', label: 'x', kind: k, default: k === 'color' ? '#808080' : k === 'vec2' ? [0, 0] : k === 'bool' ? false : k === 'enum' ? 'a' : 0, options: ['a', 'b'] }, undefined, () => {}).el; } catch (e) { return false; } });
    r.fuzzy = fuzzy('prln', 'perlin noise') > 0 && fuzzy('zz', 'perlin') < 0;
    r.ok = r.inspector && r.tiles === TILES.length && r.widgets && r.fuzzy && r.libEntries > 0;
    return r;
  },
};

/** @param {object} c main.js module context */
export async function init(c) {
  bind(c);
  initTopbar();
  initLibrary();
  initStrip();
  renderInspector(); renderEnv(); renderExport();
  try { await initThumbPipeline(); } catch (e) { thumbs.err = String(e.message || e); console.warn('[panels] thumbnail pipeline', e); }

  store.on('graph:select', () => renderInspector());
  store.on('graph:changed', ev => {
    const r = ev && ev.reason;
    if (r === 'boot' || r === 'load') { buildLibrary(); renderLibrary(); const nm = $('pn-projname'); if (nm) nm.value = graph()?.name || ''; }
    if (r === 'undo' || r === 'redo') { const nm = $('pn-projname'); if (nm) nm.value = graph()?.name || ''; }
    if (selfEmit) { const st = $('pn-stats'); if (st) st.replaceChildren(...statsLine().filter(Boolean)); return; }
    const alive = (state.selection || []).filter(id => getNode(id));
    if (alive.length !== (state.selection || []).length) { store.select(alive); return; }
    if (r === 'param' && insRows.length) refreshInspector(); else renderInspector(true);
  });
  store.on('bake:start', meterStart);
  store.on('bake:progress', ({ done, total } = {}) => { if (meter.bar && total) meter.bar.firstChild.style.width = (100 * done / total).toFixed(0) + '%'; });
  store.on('bake:done', maps => {
    meterDone(maps);
    updateStrip();
    const st = $('pn-stats'); if (st) st.replaceChildren(...statsLine().filter(Boolean));
    const es = $('pn-ex-status'); if (es && !exp.busy && !exp.last) es.textContent = `Maps ready: ${maps.res}²`;
  });
  store.on('bake:error', () => { meter.bar?.classList.remove('busy'); meter.bar?.classList.add('err'); });
  store.on('view:changed', () => { markSolo(); if (!envSelf && !envDragging()) renderEnvSoft(); });
  store.on('env:changed', () => { if (!envSelf && !envDragging()) renderEnvSoft(); });
  store.on('res:changed', ({ res }) => { const g = graph(); if (g?.settings) g.settings.res = res; if (!state.selection.length) renderInspector(true); renderExport(); });
  store.on('boot:done', () => { buildLibrary(); renderLibrary(); renderInspector(true); renderExport(); renderEnv(); });
  window.addEventListener('keydown', onKey);
  ctx.register('panels', api);
}
let envSoftRaf = 0;
function renderEnvSoft() { if (envSoftRaf) return; envSoftRaf = requestAnimationFrame(() => { envSoftRaf = 0; renderEnv(); }); }
const envDragging = () => document.body.classList.contains('pn-scrubbing') || !!document.querySelector('#env-panel .pn-bar:active');
