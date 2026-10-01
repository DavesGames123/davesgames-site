// ============================================================================
//  MATERIAL STUDIO  ·  export.js — engine packages, project files, export UI
// ────────────────────────────────────────────────────────────────────────────
//  Owner: IO agent. Reads the baked MaterialMaps back from the GPU, packs the
//  channels the way each engine wants them, encodes the images and writes a
//  zip (or a .glb for glTF). It also saves the studio project.
//
//  UI PLACEMENT  (placeUI runs on boot:done, after panels.js init)
//      panels.js owns #export-panel: this module appends an .io-extra block
//      (package details, channel layout, last export, project, import) and a
//      MutationObserver puts it back after each panels re-render. Without
//      panels.js it mounts the full panel and the Open/Save/Import/Export
//      buttons in #tb-file. Ctrl+S (project with images) and Ctrl+O (any file)
//      are captured on window before the panels.js graph-JSON shortcuts.
//
//  DATA FLOW
//      state.maps (rgba16float GPUTextures, linear)            contract.js
//        └─ withMaps(res)  same res: use state.maps; other res: bake.bakeAt(res)
//           or bake.bakeOnce(res) if the bake module has one, else swap the
//           preview res and wait for bake:done, then restore it
//        └─ MapSource.get(slot)  __studio.bake.readback(slot, {maps}) or own
//           copyTextureToBuffer ─▶ Uint16Array of half bits, res*res*4
//        └─ computeStats  min/max/mean per channel ─▶ "used" flags, constant
//           folding, emissive peak normalization
//        └─ plan(target)  file list: per file the channel sources and ops
//           (srgb, invert, DirectX green flip, gain), bit depth, format
//        └─ packImage ─▶ encodePNG / encodeTGA / encodeEXR (zip.js)
//        └─ text files  Unity .mat + .meta, Unreal import .py, Godot .tres,
//           README.txt, project .studio.json
//        └─ makeZip (zip.js) or buildGLB (glb.js) ─▶ Blob ─▶ download
//
//  CHANNEL PACKING  (all normals leave the bake as OpenGL +Y, n*0.5+0.5)
//      Unity URP      _BaseMap rgba | _MetallicGlossMap R metal A smooth |
//                     _BumpMap +Y | _OcclusionMap | _ParallaxMap | _EmissionMap
//                     | _ClearCoatMap R mask G smooth (Complex Lit)
//      Unity HDRP     _BaseColorMap | _MaskMap R metal G ao B detail A smooth |
//                     _NormalMap +Y | _HeightMap | _EmissiveColorMap | _CoatMaskMap
//      Unity Built-in _MainTex | _MetallicGlossMap R metal A smooth | _BumpMap
//                     | _OcclusionMap | _ParallaxMap | _EmissionMap
//      Unreal         BC (A opacity) | N  -Y (green flipped) | ORM | H | E | CC
//      Godot 4        albedo | normal +Y | orm | height | emission | clearcoat
//      glTF 2.0       baseColor | ORM shared by occlusion + metallicRoughness |
//                     normal | emissive | KHR clearcoat, sheen, anisotropy,
//                     ior, transmission, emissive_strength, texture_transform
//      PNG            one file per chosen map, naming template
//
//  SECTIONS  (grep -n the banner to jump)
//      half LUTs ........ half bits -> float / 8-bit linear / 8-bit sRGB
//      graph access ..... graphJSON, outputParams, scalarsNow, materialName
//      readback ......... readTexture, MapSource
//      maps at res ...... withMaps, waitBake
//      stats ............ computeStats, usedFlags
//      packing .......... packImage, ch() channel spec helpers
//      plans ............ PLANS: one planner per EXPORT_TARGETS id
//      unity yaml ....... unityGuid, unityMat, unityTexMeta
//      unreal py ........ unrealScript
//      godot tres ....... godotTres
//      gltf ............. gltfPackage
//      readme ........... readmeText
//      exportPackage .... the public entry
//      project .......... projectJSON, saveProject, copyMaterialJSON
//      ui ............... mountExportUI, placeUI, layout table, progress, topbar, keys
//      selfTest / init
// ============================================================================
import {
  EXPORT_TARGETS, MAP_SLOTS, MAP_NAMES, DEFAULT_SCALARS, RES_OPTIONS, GRAPH_VERSION,
} from './contract.js';
import { makeZip, encodePNG, crc32, decodePNG, readZip } from './zip.js';
import { buildGLB, uvSphere, parseGLB } from './glb.js';
import * as IMP from './import.js';

import { C, S, UI, last, bind, setLast, err } from './export/ctx.js';
import { linToSrgb } from './export/half.js';
import { fmtSize } from './export/format.js';
import { graphJSON, scalarsNow, sanitize, materialName } from './export/graph-access.js';
import { readTexture, MapSource } from './export/readback.js';
import { withMaps } from './export/maps.js';
import { computeStats, usedFlags } from './export/stats.js';
import { ch, chLabel, packImage } from './export/pack.js';
import { PLANS, PLAIN_MAPS, FORMATS, resolvePlan, baseRGB, gray } from './export/plans.js';
import { DEFAULT_OPTS, OPTS, saveOpts } from './export/options.js';
import { unityGuid, unityTexMeta, matMeta, unityMat } from './export/engines/unity.js';
import { unrealScript } from './export/engines/unreal.js';
import { godotTres } from './export/engines/godot.js';
import { gltfPackage } from './export/engines/gltf.js';
import { readmeText } from './export/engines/readme.js';

export { linToSrgb, scalarsNow, readTexture, PLAIN_MAPS, FORMATS, unityGuid };
let busy = false;

// ------------------------------------------------------------ exportPackage
/**
 * Build an export package.
 * @param {string} target an EXPORT_TARGETS id
 * @param {object} [opts] overrides of the panel options:
 *   {res, name, fmt:'png'|'tga', heightFmt:'png16'|'png8'|'exr', normalBits:8|16,
 *    template, maps:[PLAIN_MAPS keys], includeGraph, readme, fold, displaceMesh,
 *    unityShaderGuid, godotRoot, unrealDest, compress, onProgress(stage, frac)}
 * @returns {Promise<Blob>} zip (or .glb for 'gltf'); blob.fileName and
 *   blob.entries [{name, size}] describe it.
 */
export async function exportPackage(target, opts = {}) {
  if (!PLANS[target]) throw new Error('Unknown export target ' + target);
  if (!C.gpu.ok) throw new Error('Export needs WebGPU');
  const o = { ...OPTS, ...opts, target };
  if (opts.format && !opts.fmt) o.fmt = FORMATS.includes(opts.format) ? opts.format : 'png'; // panels.js name
  if (opts.helpers !== undefined) o.helpers = !!opts.helpers;
  o.name = sanitize(opts.name || materialName());
  o.uvScale = +(opts.uvScale ?? S.view.uvScale ?? 1) || 1;
  o.normalBits = +o.normalBits === 16 ? 16 : 8;
  const progress = o.onProgress;
  const res = +o.res || 0;
  return withMaps(res, async maps => {
    const src = new MapSource(maps);
    o.resolved = src.res;
    const sc = scalarsNow(maps);
    const st = await computeStats(src, MAP_NAMES, progress);
    const u = usedFlags(st, sc);
    u.emissiveScale = u.emissivePeak > 1 ? u.emissivePeak : 1;
    u.emissiveGain = 1 / u.emissiveScale;
    const full = PLANS[target](o, null, sc).map(x => x.file);
    const plan = resolvePlan(target, o, u, sc);
    const skipped = full.filter(fl => !plan.some(p => p.file === fl));
    const files = [];
    const root = target === 'png' || target === 'gltf' ? '' : `${o.name}/`;
    if (target === 'gltf') {
      const { glb, images } = await gltfPackage(o, src, sc, u, st, plan, progress);
      const blob = new Blob([glb], { type: 'model/gltf-binary' });
      blob.fileName = blob.name = `${o.name}.glb`;
      blob.entries = [{ name: blob.fileName, size: glb.byteLength }, ...images.map(i => ({ name: '  ' + i.name + '.png', size: i.data.length }))];
      finish(target, o, blob, sc, u);
      return blob;
    }
    const meta = [];
    for (let i = 0; i < plan.length; i++) {
      const img = plan[i];
      progress?.(`encoding ${img.file}`, 0.32 + (0.55 * (i / plan.length)));
      const data = await packImage(img, src);
      const name = `${img.file}.${img.ext}`;
      files.push({ name: root + name, data });
      meta.push({ key: img.key, name, bits: img.bits, fmt: img.fmt || img.ext, color: img.color, role: img.role, chans: img.chans });
    }
    progress?.('writing helper files', 0.9);
    if (!o.helpers) { /* helper files off: maps, README and graph only */ }
    else if (target.startsWith('unity-')) {
      const texGuid = {};
      for (const m of meta) {
        const guid = unityGuid(`${o.name}/${m.name}`);
        texGuid[m.key] = guid;
        files.push({ name: `${root}${m.name}.meta`, data: unityTexMeta(guid, { srgb: m.color === 'sRGB', normal: m.key === 'normal', alpha: m.chans.length === 4 && m.key === 'base' }) });
      }
      const mg = unityGuid(`${o.name}/${o.name}.mat`);
      files.push({ name: `${root}${o.name}.mat`, data: unityMat(target, o, sc, u, texGuid, o.unityShaderGuid) });
      files.push({ name: `${root}${o.name}.mat.meta`, data: matMeta(mg) });
    } else if (target === 'unreal') {
      files.push({ name: `${root}import_${o.name}.py`, data: unrealScript(o, sc, u, meta) });
    } else if (target === 'godot') {
      files.push({ name: `${root}${o.name}.tres`, data: godotTres(o, sc, u, meta, st) });
    }
    if (o.readme) files.push({ name: `${root}README.txt`, data: readmeText(target, o, sc, meta, { emissiveScale: u.emissiveScale, skipped }) });
    if (o.includeGraph && S.graph) files.push({ name: `${root}${o.name}.studio.json`, data: JSON.stringify(await projectJSON({ embed: true, name: o.name }), null, 1) });
    progress?.('zipping', 0.95);
    const blob = await makeZip(files, { compress: o.compress, comment: `Stella Nova PBR Material Studio · ${target}` });
    blob.fileName = blob.name = `${o.name}_${target}.zip`;
    blob.entries = await Promise.all(files.map(async x => ({ name: x.name, size: typeof x.data === 'string' ? new TextEncoder().encode(x.data).length : x.data.length })));
    finish(target, o, blob, sc, u);
    return blob;
  }, progress);
}
function finish(target, o, blob, sc, u) {
  setLast({ target, name: blob.fileName, size: blob.size, entries: blob.entries, res: o.resolved, at: Date.now() });
  o.onProgress?.('done', 1);
  if (UI.box && !o.onProgress) { setProgress('done', 1); showResult(blob); }
}

/** Save a Blob as a download. */
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name || blob.fileName || 'download';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * Export one baked map slot as a PNG (for the map strip). Linear except the
 * sRGB color slots; normal stays OpenGL.
 * @param {string} slot a MAP_NAMES entry @returns {Promise<Blob>}
 */
export async function exportMapPNG(slot, { res = 0, bits = 8 } = {}) {
  return withMaps(res, async maps => {
    const src = new MapSource(maps);
    const srgb = !!MAP_SLOTS[slot]?.srgbOnExport;
    const chans = slot === 'height' ? gray('height', 0) : slot === 'albedo' ? baseRGB(true)
      : [0, 1, 2, 3].map(c => (srgb && c < 3 ? ch.srgb(slot, c) : ch.s(slot, c)));
    const png = await packImage({ chans: slot === 'normal' || slot === 'orm' || slot === 'emissive' ? chans.slice(0, 3) : chans, bits: slot === 'height' ? 16 : bits, srgbChunk: srgb }, src);
    const b = new Blob([png], { type: 'image/png' });
    b.fileName = `${materialName()}_${slot}.png`;
    return b;
  });
}

// ------------------------------------------------------------ project
/**
 * The studio project as JSON: graph, settings, view, env and the images the
 * graph uses. embed true writes image assets as data URLs.
 */
export async function projectJSON({ embed = true, name } = {}) {
  const graph = graphJSON();
  const assets = {};
  if (graph) {
    for (const n of graph.nodes || []) {
      for (const [k, v] of Object.entries(n.params || {})) {
        if (!v || typeof v !== 'object' || typeof v.url !== 'string') continue;
        if (!/^(blob:|data:)/.test(v.url)) continue;
        const id = v.asset || IMP.assetIdForUrl(v.url) || ('a' + crc32(new TextEncoder().encode(v.url)).toString(16));
        if (!assets[id]) {
          assets[id] = { name: v.name || id, mime: v.mime || '' };
          if (embed) { try { const { dataURL, mime } = await IMP.assetDataURL(v.url); assets[id].data = dataURL; assets[id].mime = mime; } catch (e) { assets[id].error = String(e.message || e); } }
        }
        const { url, bitmap, ...rest } = v;
        n.params[k] = { ...rest, asset: id };
      }
    }
    if (name) graph.name = name;
  }
  return {
    format: 'stella-material-studio', version: 1, graphVersion: GRAPH_VERSION,
    saved: new Date().toISOString(), name: name || graph?.name || materialName(),
    graph, settings: { ...S.settings }, view: { ...S.view }, env: JSON.parse(JSON.stringify(S.env)),
    scalars: scalarsNow(), assets,
  };
}
/** Download the project as <name>.studio.json. */
export async function saveProject() {
  const j = await projectJSON({ embed: true });
  const blob = new Blob([JSON.stringify(j)], { type: 'application/json' });
  download(blob, `${sanitize(j.name)}.studio.json`);
  C.store.toast(`Saved ${sanitize(j.name)}.studio.json (${fmtSize(blob.size)})`, 'ok');
  return blob;
}
/** Copy the material (graph, scalars, settings, no embedded images) to the clipboard. */
export async function copyMaterialJSON() {
  const j = await projectJSON({ embed: false });
  delete j.view; delete j.env;
  const text = JSON.stringify(j, null, 2);
  try { await navigator.clipboard.writeText(text); C.store.toast('Material JSON copied', 'ok'); }
  catch (e) { C.store.toast('Clipboard is blocked: the JSON is in the console', 'warn'); console.log(text); }
  return text;
}

// ------------------------------------------------------------ ui
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
function sel(id, options, value, on) {
  const s = h('select', { class: 'io-sel', id });
  for (const op of options) s.add(new Option(op.label ?? op, String(op.value ?? op)));
  s.value = String(value);
  s.addEventListener('change', () => on(s.value));
  return s;
}
function row(label, ctl, hint) {
  return h('label', { class: 'io-row' }, h('span', { class: 'io-k' }, label), ctl, hint ? h('span', { class: 'io-hint' }, hint) : null);
}
function chk(label, value, on) {
  const c = h('input', { type: 'checkbox' }); c.checked = !!value;
  c.addEventListener('change', () => on(c.checked));
  return h('label', { class: 'io-chk' }, c, h('span', {}, label));
}

/**
 * Build the export UI into `host`.
 *   full mode: target cards, options, details, channel layout, run, project, import.
 *   extra mode (panels.js already owns the target cards, options and the Export
 *   button): details, channel layout, last export, project and import only.
 *   The target then follows the panels card that is on.
 */
export function mountExportUI(host, { mode = 'full' } = {}) {
  const box = h('div', { class: 'io' + (mode === 'extra' ? ' io-extra' : '') });
  UI.mode = mode;
  // target cards (full mode)
  if (mode === 'full') {
    const targets = h('div', { class: 'io-targets', role: 'radiogroup', 'aria-label': 'Export target' });
    for (const t of EXPORT_TARGETS) {
      const b = h('button', { type: 'button', class: 'io-target', 'data-target': t.id, role: 'radio', title: t.packing },
        h('b', {}, t.label), h('span', {}, t.normalY === '-Y' ? 'DX normal' : 'GL normal'));
      b.addEventListener('click', () => { OPTS.target = t.id; saveOpts(); refresh(); });
      targets.append(b);
    }
    UI.targets = targets;
    UI.packing = h('div', { class: 'io-pack' });
    box.append(h('section', { class: 'io-sec' }, h('h4', {}, 'Target'), targets, UI.packing));
  }
  // options
  UI.name = h('input', { class: 'io-in', type: 'text', placeholder: 'Material', spellcheck: 'false', maxlength: '64' });
  UI.name.addEventListener('input', () => refreshTable());
  const resOpts = [{ value: 0, label: 'Preview res' }, ...RES_OPTIONS.map(r => ({ value: r, label: `${r} px` }))];
  UI.res = sel('io-res', resOpts, OPTS.res, v => { OPTS.res = +v; saveOpts(); });
  UI.fmt = sel('io-fmt', FORMATS.map(v => ({ value: v, label: v === 'tga' ? 'TGA (RLE)' : 'PNG' })), OPTS.fmt, v => { OPTS.fmt = v; saveOpts(); refreshTable(); });
  UI.hfmt = sel('io-hfmt', [{ value: 'png16', label: 'PNG 16-bit' }, { value: 'png8', label: 'PNG 8-bit' }, { value: 'exr', label: 'EXR half' }], OPTS.heightFmt, v => { OPTS.heightFmt = v; saveOpts(); refreshTable(); });
  UI.nbits = sel('io-nbits', [{ value: 8, label: '8-bit' }, { value: 16, label: '16-bit' }], OPTS.normalBits, v => { OPTS.normalBits = +v; saveOpts(); refreshTable(); });
  const optRows = mode === 'full'
    ? h('div', { class: 'io-grid' }, row('Name', UI.name), row('Res', UI.res), row('Format', UI.fmt), row('Height', UI.hfmt), row('Normal', UI.nbits))
    : h('div', { class: 'io-grid' }, row('Height', UI.hfmt), row('Normal', UI.nbits));
  // target-specific
  const txt = (key, fallback) => {
    const el = h('input', { class: 'io-in mono', type: 'text', spellcheck: 'false' });
    el.value = OPTS[key]; el.addEventListener('change', () => { OPTS[key] = el.value.trim() || fallback; el.value = OPTS[key]; saveOpts(); refreshTable(); });
    return el;
  };
  UI.tUnity = txt('unityShaderGuid', ''); UI.tUnity.placeholder = 'blank = the default Lit GUID';
  UI.tGodot = txt('godotRoot', DEFAULT_OPTS.godotRoot);
  UI.tUnreal = txt('unrealDest', DEFAULT_OPTS.unrealDest);
  UI.tTemplate = txt('template', DEFAULT_OPTS.template);
  UI.tTemplate.addEventListener('input', () => { OPTS.template = UI.tTemplate.value || DEFAULT_OPTS.template; refreshTable(); });
  UI.mapsBox = h('div', { class: 'io-maps' });
  for (const [k, m] of Object.entries(PLAIN_MAPS)) {
    UI.mapsBox.append(chk(m.label, OPTS.maps.includes(k), on => {
      OPTS.maps = Object.keys(PLAIN_MAPS).filter(x => (x === k ? on : OPTS.maps.includes(x)));
      saveOpts(); refreshTable();
    }));
  }
  UI.specific = {
    unity: h('div', { class: 'io-spec', 'data-for': 'unity' }, row('Shader', UI.tUnity, 'GUID; only when your pipeline differs')),
    unreal: h('div', { class: 'io-spec', 'data-for': 'unreal' }, row('Dest', UI.tUnreal, 'content folder; {name} expands')),
    godot: h('div', { class: 'io-spec', 'data-for': 'godot' }, row('Path', UI.tGodot, 'res:// folder of the textures')),
    gltf: h('div', { class: 'io-spec', 'data-for': 'gltf' },
      chk('Fold constant maps into factors', OPTS.fold, v => { OPTS.fold = v; saveOpts(); }),
      chk('Bake height into the mesh', OPTS.displaceMesh, v => { OPTS.displaceMesh = v; saveOpts(); })),
    png: h('div', { class: 'io-spec', 'data-for': 'png' }, row('Names', UI.tTemplate, '{name} {map} {res}'), UI.mapsBox),
  };
  const flags = mode === 'full' ? h('div', { class: 'io-flags' },
    chk('Project graph', OPTS.includeGraph, v => { OPTS.includeGraph = v; saveOpts(); }),
    chk('Helper files', OPTS.helpers, v => { OPTS.helpers = v; saveOpts(); }),
    chk('README', OPTS.readme, v => { OPTS.readme = v; saveOpts(); }),
    chk('Deflate', OPTS.compress !== 'store', v => { OPTS.compress = v ? 'auto' : 'store'; saveOpts(); }))
    : h('div', { class: 'io-flags' },
      chk('README', OPTS.readme, v => { OPTS.readme = v; saveOpts(); }),
      chk('Deflate', OPTS.compress !== 'store', v => { OPTS.compress = v ? 'auto' : 'store'; saveOpts(); }));
  box.append(h('section', { class: 'io-sec' }, h('h4', {}, mode === 'full' ? 'Options' : 'Package details'), optRows, ...Object.values(UI.specific), flags));
  UI.table = h('table', { class: 'io-table' });
  UI.tableHead = h('h4', {}, 'Channel layout');
  box.append(h('section', { class: 'io-sec' }, UI.tableHead, h('div', { class: 'io-tablewrap' }, UI.table)));
  // run (full) or the result list only (extra)
  UI.bar = h('div', { class: 'io-bar' }, h('i'));
  UI.stage = h('div', { class: 'io-stage mono' });
  UI.result = h('div', { class: 'io-result' });
  if (mode === 'full') {
    UI.go = h('button', { type: 'button', class: 'io-go' }, 'Export');
    UI.go.addEventListener('click', () => runExport());
    box.append(h('section', { class: 'io-sec io-run' }, UI.go, UI.bar, UI.stage, UI.result));
  } else box.append(h('section', { class: 'io-sec io-run' }, UI.bar, UI.stage, UI.result));
  // project
  box.append(h('section', { class: 'io-sec' }, h('h4', {}, 'Project'), h('div', { class: 'io-btns' },
    h('button', { type: 'button', class: 'io-btn', title: 'Graph, settings, view, light and the imported images (Ctrl+S)', onclick: () => saveProject().catch(err) }, 'Save project'),
    h('button', { type: 'button', class: 'io-btn', onclick: () => IMP.pickFiles('.json,application/json,.zip') }, 'Open project'),
    h('button', { type: 'button', class: 'io-btn', onclick: () => copyMaterialJSON().catch(err) }, 'Copy JSON'),
    h('button', { type: 'button', class: 'io-btn', title: 'Every baked map as PNG in one zip', onclick: () => runExport('png') }, 'All maps .zip'))));
  const impSec = h('section', { class: 'io-sec', id: 'io-import' });
  box.append(impSec);
  IMP.mountImportUI?.(impSec);
  UI.box = box;
  host.append(box);
  refresh();
  return box;
}

/** The active target: the panels card that is on (extra mode) or OPTS.target. */
function activeTarget() {
  if (UI.mode === 'extra') {
    const cards = [...document.querySelectorAll('#export-panel .ex-card')];
    const i = cards.findIndex(c => c.classList.contains('on'));
    if (i >= 0 && EXPORT_TARGETS[i]) return EXPORT_TARGETS[i].id;
  }
  return OPTS.target;
}

function refresh() {
  if (!UI.box) return;
  const target = activeTarget();
  if (UI.targets) for (const b of UI.targets.children) { const on = b.dataset.target === target; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }
  const t = EXPORT_TARGETS.find(x => x.id === target);
  if (UI.packing) UI.packing.textContent = t ? `${t.packing} · normal ${t.normalY}` : '';
  const fam = target.startsWith('unity') ? 'unity' : target;
  for (const [k, el] of Object.entries(UI.specific)) el.hidden = k !== fam;
  UI.fmt.disabled = target === 'gltf';
  UI.hfmt.disabled = target === 'gltf';
  if (UI.go) UI.go.textContent = target === 'gltf' ? 'Export .glb' : `Export ${t ? t.label : ''} .zip`;
  if (!UI.name.value) UI.name.placeholder = graphJSON()?.name || 'Material';
  refreshTable();
}
function refreshTable() {
  if (!UI.table) return;
  const target = activeTarget();
  const o = { ...OPTS, name: materialName(), uvScale: S.view.uvScale || 1, normalBits: +OPTS.normalBits };
  const plan = resolvePlan(target, o, null, scalarsNow());
  const t = UI.table;
  UI.tableHead.textContent = `Channel layout · ${EXPORT_TARGETS.find(x => x.id === target)?.label || target}`;
  t.textContent = '';
  t.append(h('tr', {}, h('th', {}, 'File'), h('th', {}, 'R'), h('th', {}, 'G'), h('th', {}, 'B'), h('th', {}, 'A'), h('th', {}, 'Bits')));
  for (const img of plan) {
    const cells = [0, 1, 2, 3].map(i => {
      const c = img.chans.length === 1 ? (i < 3 ? img.chans[0] : null) : img.chans[i];
      return h('td', { class: c ? (c.inv ? 'inv' : c.v !== undefined ? 'k' : '') : 'none' }, c ? chLabel(c).replace(' (sRGB)', '') : '—');
    });
    t.append(h('tr', { title: img.role },
      h('td', { class: 'f' }, `${img.file}.${img.ext}`, img.optional || img.fold ? h('em', {}, img.fold ? ' if varied' : ' if used') : null, h('small', {}, img.role)),
      ...cells, h('td', { class: 'b' }, img.fmt === 'exr' ? 'half' : `${img.bits}${img.color === 'sRGB' ? ' sRGB' : ''}`)));
  }
}

function setProgress(stage, frac) {
  if (!UI.bar) return;
  UI.bar.firstChild.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
  UI.stage.textContent = stage;
}
function showResult(blob, ms) {
  if (!UI.result) return;
  UI.result.textContent = '';
  UI.result.append(h('div', { class: 'io-res-head' }, h('b', {}, blob.fileName), ` ${fmtSize(blob.size)} · ${last.res}²${ms ? ` · ${(ms / 1000).toFixed(1)} s` : ''}`),
    h('ul', {}, blob.entries.map(e => h('li', {}, h('span', {}, e.name), h('i', {}, fmtSize(e.size))))));
}
/** Export with the panel options and download the result. */
async function runExport(target = activeTarget()) {
  if (busy) return;
  busy = true;
  document.body.classList.add('io-busy');
  if (UI.go) UI.go.disabled = true;
  const t0 = performance.now();
  try {
    const blob = await exportPackage(target, { onProgress: setProgress });
    download(blob, blob.fileName);
    const ms = performance.now() - t0;
    C.store.toast(`Exported ${blob.fileName} · ${fmtSize(blob.size)} · ${(ms / 1000).toFixed(1)} s`, 'ok');
    showResult(blob, ms);
  } catch (e) { err(e); setProgress('failed: ' + (e.message || e), 0); }
  finally { busy = false; document.body.classList.remove('io-busy'); if (UI.go) UI.go.disabled = false; }
}

function topbar() {
  const tb = C.$('tb-file');
  if (!tb) return;
  tb.append(h('span', { class: 'io-tb' },
    h('button', { type: 'button', class: 'tb-btn', title: 'Open a project, graph, maps or a zip (Ctrl+O)', onclick: () => IMP.pickFiles() }, 'Open'),
    h('button', { type: 'button', class: 'tb-btn', title: 'Save the project as .studio.json (Ctrl+S)', onclick: () => saveProject().catch(err) }, 'Save'),
    h('button', { type: 'button', class: 'tb-btn', title: 'Import texture maps as image nodes', onclick: () => IMP.pickFiles('image/*,.zip,.tga') }, 'Import'),
    h('button', { type: 'button', class: 'tb-btn', title: 'Export with the Export tab options (Ctrl+E)', onclick: () => { showExportTab(); runExport(); } }, 'Export')));
}
function showExportTab() { C.$('side-tabs')?.querySelector('button[data-tab="export"]')?.click(); }

/**
 * Put the UI in place after every module ran init. panels.js may own
 * #export-panel (target cards) and #tb-file (File menu). Then this module
 * adds only the extra block, and a MutationObserver puts it back each time
 * panels re-renders the pane with replaceChildren.
 */
function placeUI() {
  const host = C.$('export-panel');
  if (!host || UI.box) return;
  const panelsOwns = !!host.querySelector('.ex-cards') || typeof C.modules.panels?.api?.renderExport === 'function';
  host.classList.add('io-host');
  mountExportUI(host, { mode: panelsOwns ? 'extra' : 'full' });
  if (panelsOwns) {
    new MutationObserver(() => {
      if (!host.contains(UI.box)) host.append(UI.box);
      refresh();
    }).observe(host, { childList: true });
  }
  const tb = C.$('tb-file');
  if (tb && !tb.children.length) topbar();
}

// ------------------------------------------------------------ selfTest / init
/** Quick checks that need no bake: codecs, zip, glb, GUIDs, plans. */
export async function selfTest() {
  const out = { ok: true, checks: {} };
  const ok = (k, v) => { out.checks[k] = v; if (!v) out.ok = false; };
  ok('crc32', crc32(new TextEncoder().encode('123456789')) === 0xcbf43926);
  const px = new Uint8Array([0, 0, 0, 0, 255, 128, 7, 3, 1, 2, 3, 255, 9, 9, 9, 9]);
  const png = await encodePNG({ width: 2, height: 2, channels: 4, data: px });
  const back = await decodePNG(png);
  ok('png8 alpha 0 keeps rgb', back.data.every((v, i) => v === px[i]));
  const zipped = await makeZip([{ name: 'a.txt', data: 'x'.repeat(500) }, { name: 'b.png', data: png }]);
  const entries = await readZip(zipped);
  ok('zip roundtrip', entries.length === 2 && entries[0].data.length === 500);
  const glb = buildGLB({ mesh: uvSphere(8), images: [{ data: png }], material: { name: 't', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } } });
  const pg = parseGLB(glb);
  ok('glb parse', pg.json.asset.version === '2.0' && pg.json.images.length === 1);
  ok('unity guid', /^[0-9a-f]{32}$/.test(unityGuid('x')) && unityGuid('x') === unityGuid('x'));
  ok('plans', EXPORT_TARGETS.every(t => PLANS[t.id] && resolvePlan(t.id, { ...OPTS, name: 'T', uvScale: 1 }, null, DEFAULT_SCALARS).length > 0));
  out.maps = !!S.maps;
  out.last = last && { target: last.target, name: last.name, size: last.size };
  return out;
}

/** @param {object} ctx main.js module context */
export async function init(ctx) {
  bind(ctx);
  // panels.js inits after this module, so place the UI once every init ran
  ctx.store.on('boot:done', () => { try { placeUI(); } catch (e) { console.error('[export] UI', e); } });
  ctx.store.on('graph:changed', () => { if (UI.name && !UI.name.value) UI.name.placeholder = graphJSON()?.name || 'Material'; });
  ctx.store.on('view:changed', () => refreshTable());
  // Capture phase on window: Ctrl+S saves the full project (graph plus the
  // embedded images) and Ctrl+O opens any file kind. Both are supersets of the
  // panels.js graph-JSON shortcuts, which skip a defaultPrevented event.
  window.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.defaultPrevented) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); saveProject().catch(err); }
    else if (k === 'o') { e.preventDefault(); IMP.pickFiles(); }
    else if (k === 'e' && UI.mode === 'full') { e.preventDefault(); showExportTab(); }
  }, true);
  ctx.register('io', {
    exportPackage, exportMapPNG, download, saveProject, copyMaterialJSON, projectJSON, scalarsNow,
    readTexture, runExport, unityGuid, PLAIN_MAPS, FORMATS, mountExportUI,
    options: () => ({ ...OPTS }), setOptions: p => { Object.assign(OPTS, p); saveOpts(); refresh(); },
    get last() { return last; },
    importFiles: IMP.importFiles, importMaps: IMP.importMaps, loadProject: IMP.loadProject,
    roleFromName: IMP.roleFromName, detectNormalConvention: IMP.detectNormalConvention,
    serverStatus: IMP.serverStatus, imageToPBR: IMP.imageToPBR,
    async selfTest() { const a = await selfTest(); const b = await IMP.selfTest(); return { ok: a.ok && b.ok, export: a, import: b }; },
  });
}
