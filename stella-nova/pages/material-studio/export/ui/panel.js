// ============================================================================
//  MATERIAL STUDIO  ·  export/ui/panel.js — the export panel
// ────────────────────────────────────────────────────────────────────────────
//  mountExportUI builds the panel into a host. Full mode has the target
//  cards, options, flags, channel table, Export button, project buttons
//  and the import section. Extra mode (panels.js owns the target cards and
//  the Export button) has the package details, the channel table, the
//  last export, the project buttons and the import section. refresh
//  follows the active target. refreshTable draws the plan as a table.
//
//  GREP TARGETS
//      mountExportUI  refresh  refreshTable  UI.specific  io-table
// ============================================================================
import { EXPORT_TARGETS, RES_OPTIONS } from '../../contract.js';
import * as IMP from '../../import.js';
import { S, UI, err } from '../ctx.js';
import { graphJSON, scalarsNow, materialName } from '../graph-access.js';
import { chLabel } from '../pack.js';
import { PLAIN_MAPS, FORMATS, resolvePlan } from '../plans.js';
import { DEFAULT_OPTS, OPTS, saveOpts } from '../options.js';
import { saveProject, copyMaterialJSON } from '../project.js';
import { h, sel, row, chk } from './dom.js';
import { activeTarget, runExport } from './run.js';

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

export function refresh() {
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
export function refreshTable() {
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
