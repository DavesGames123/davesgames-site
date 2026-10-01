// ============================================================================
//  MATERIAL STUDIO  ·  panels/export-panel.js — the #export-panel fallback export UI
// ────────────────────────────────────────────────────────────────────────────
//  Target cards, options and the Export button, which call
//  export.exportPackage. When export.js already filled #export-panel,
//  renderExport does nothing (exp.foreign).
//
//  GREP TARGETS
//      exp TARGET_NOTES renderExport runExport
// ============================================================================
import { RES_OPTIONS, EXPORT_TARGETS } from '../contract.js';
import { ctx, store, state, M, $ } from './ctx.js';
import { lsGet, lsSet, slug } from './util.js';
import { h, icon, download } from './dom.js';
import { graph } from './graph-access.js';
import { wEnum, wBool } from './widgets/basic.js';
import { section, envRow } from './rows.js';

export const exp = { target: lsGet('exportTarget', 'unity-urp'), opts: lsGet('exportOpts', { res: 'bake', format: 'png', includeGraph: true, helpers: true, name: '' }), busy: false, last: null };
const TARGET_NOTES = {
  'unity-urp': 'Lit shader. Albedo (sRGB), Normal (OpenGL), MetallicSmoothness, Occlusion, Height, Emission. Helper: an editor script that builds the .mat.',
  'unity-hdrp': 'Lit shader. BaseColor, Normal, MaskMap (metal, AO, detail, smooth), Height, Emissive. Helper: an editor script.',
  'unity-builtin': 'Standard shader. Albedo, Normal, MetallicGloss, Occlusion, Height, Emission.',
  'unreal': 'BaseColor (sRGB), Normal (DirectX, green flipped), ORM (linear, no sRGB), Height, Emissive. Helper: a Python import script.',
  'godot': 'StandardMaterial3D. Albedo, Normal (OpenGL), ORM, Height, Emission, and a .tres material.',
  'gltf': 'One .glb: a UV sphere with the material: baseColor, metallicRoughness, normal, occlusion, emissive; KHR extensions for clearcoat, sheen, anisotropy, IOR and transmission.',
  'png': 'Every map as a 16-bit or 8-bit PNG with the channel layout of the baked maps.',
};
export function renderExport() {
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
