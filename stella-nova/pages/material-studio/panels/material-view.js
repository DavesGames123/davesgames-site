// ============================================================================
//  MATERIAL STUDIO  ·  panels/material-view.js — the #inspector material settings view
// ────────────────────────────────────────────────────────────────────────────
//  The view when no node is selected: material name and stats, bake
//  settings (resolution, tiling, seed), the Material Output scalars,
//  the exposed params, the starter materials and the compile errors.
//
//  GREP TARGETS
//      setGraphSetting materialView statsLine ballCss loadPreset setName
// ============================================================================
import { MATERIAL_PARAMS, RES_OPTIONS } from '../contract.js';
import { store, state, M, $ } from './ctx.js';
import { h, icon, ibtn } from './dom.js';
import {
  GA, graph, nodesOf, linksOf, defOf, outputNode, nodeLabel, queueEdit,
  editDone, loadGraph,
} from './graph-access.js';
import { numField } from './widgets/number.js';
import { wSlider } from './widgets/slider.js';
import { nextSession, paramRow, section, kv } from './rows.js';
import { insRows } from './inspector.js';

function setGraphSetting(key, v, final, session) {
  const g = graph(); if (!g) return;
  g.settings = g.settings || { ...state.settings };
  g.settings[key] = v; state.settings[key] = v;
  queueEdit([], false, key, `s:${key}:${session}`, final);
}

export function materialView() {
  const frag = document.createDocumentFragment();
  const g = graph(); const out = outputNode();
  // name + stats
  const name = h('input', { class: 'pn-name', type: 'text', value: g?.name || '', placeholder: 'Untitled material', spellcheck: 'false', 'aria-label': 'Material name' });
  name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); });
  name.addEventListener('change', () => setName(name.value));
  frag.append(h('div', { class: 'pn-head' },
    h('div', { class: 'pn-head-r' }, h('i', { class: 'pn-dot', style: { background: 'var(--yellow)' } }), name),
    h('div', { class: 'pn-type' }, 'Material settings', h('span', { class: 'pn-sub' }, ' · select a node to edit its params')),
    h('div', { class: 'pn-stats', id: 'pn-stats' }, statsLine())));
  // bake settings
  let ses = 0;
  const resSel = h('select', { class: 'pn-sel', 'aria-label': 'Bake resolution' }, RES_OPTIONS.map(r => h('option', { value: String(r) }, `${r} × ${r}`)));
  resSel.value = String(state.settings.res);
  resSel.addEventListener('change', () => { store.setRes(+resSel.value); if (g?.settings) g.settings.res = +resSel.value; });
  const til = wSlider({ id: 'tiling', label: 'Tiling', kind: 'int', min: 1, max: 16, step: 1, default: 1 }, g?.settings?.tiling ?? state.settings.tiling ?? 1, (v, f) => { if (!ses) ses = nextSession(); setGraphSetting('tiling', v, f, ses); if (f) ses = 0; });
  const seed = numField(g?.settings?.seed ?? state.settings.seed ?? 0, { step: 1, int: true, min: 0, max: 99999, sens: 0.3 }, (v, f) => { if (!ses) ses = nextSession(); setGraphSetting('seed', v, f, ses); if (f) ses = 0; });
  const dice = ibtn('dice', 'Random seed', () => { const v = Math.floor(Math.random() * 10000); seed.set(v); setGraphSetting('seed', v, true, nextSession()); });
  const row = (label, el, title) => h('div', { class: 'pn-prm' }, h('label', { class: 'pn-lbl', title: title || '' }, label), h('div', { class: 'pn-ctl' }, el), h('div', { class: 'pn-acts' }));
  frag.append(section('bake', 'Bake', [
    row('Resolution', resSel, 'Texels per side of every baked map'),
    row('Tiling', til.el, 'How many times the pattern repeats across the UV square'),
    row('Seed', h('div', { class: 'pn-inline' }, seed.el, dice), 'Global random seed; each node adds its own offset'),
  ]));
  // scalars from the Material Output node
  if (out) {
    const odef = defOf(out);
    const ps = (odef && odef.params && odef.params.length) ? odef.params : MATERIAL_PARAMS;
    frag.append(section('scalars', 'Surface', ps.map(p => { const r = paramRow([out], p); insRows.push(r); return r; })));
  }
  // exposed params
  const exp = [];
  for (const n of nodesOf()) for (const pid of n.exposed || []) {
    const p = (defOf(n)?.params || []).find(q => q.id === pid);
    if (p) { const r = paramRow([n], p, { prefix: nodeLabel(n) + ' · ', goto: true }); insRows.push(r); exp.push(r); }
  }
  frag.append(section('exposed', 'Exposed parameters', exp.length ? exp : h('div', { class: 'pn-empty' }, 'Pin a node param with ', icon('pin'), ' to put it here. Exposed params save with the graph, so a material can have one compact set of controls.'), { extra: h('span', { class: 'pn-count' }, String(exp.length)) }));
  // starter materials
  const presets = M.presets?.MATERIAL_PRESETS || [];
  if (presets.length) {
    frag.append(section('presets', 'Starter materials', h('div', { class: 'pn-presets' }, presets.map(pr => h('button', {
      type: 'button', class: 'pn-preset', title: pr.description || pr.label,
      onclick: () => loadPreset(pr),
    }, h('i', { class: 'pn-ball', style: { background: ballCss(pr.swatch) } }), h('span', null, pr.label))))));
  }
  // compile errors
  const errs = state.compiled?.errors || [];
  if (errs.length) frag.append(section('errors', 'Compile errors', errs.map(e => h('button', { type: 'button', class: 'pn-err', onclick: () => e.nodeId && store.select([e.nodeId]) }, e.nodeId ? h('b', null, e.nodeId + ': ') : null, e.message)), { extra: h('span', { class: 'pn-count bad' }, String(errs.length)) }));
  return frag;
}
export function statsLine() {
  const ns = nodesOf(), bench = ns.filter(n => defOf(n)?.source === 'bench').length;
  const c = state.compiled, m = state.maps;
  return [
    kv('nodes', String(ns.length)), kv('links', String(linksOf().length)), bench ? kv('bench', String(bench)) : null,
    c && c.passes ? kv('passes', String(c.passes.length)) : null,
    m ? kv('bake', `${m.res}² ${m.ms != null ? '· ' + m.ms.toFixed(0) + ' ms' : ''}`) : kv('bake', '—'),
  ];
}
export function ballCss(sw) {
  const c = Array.isArray(sw) ? sw : [sw || '#888888'];
  const a = c[0], b = c[1] || c[0];
  return `radial-gradient(circle at 34% 30%, rgba(255,255,255,0.75) 0, rgba(255,255,255,0) 22%), radial-gradient(circle at 40% 38%, ${a} 0, ${b} 62%, #05070b 100%)`;
}
export function loadPreset(pr) {
  const gj = typeof pr.build === 'function' ? pr.build() : pr.graph;
  if (loadGraph(gj, 'Starter: ' + pr.label, { keepRes: true })) store.toast(`Loaded "${pr.label}"`, 'ok');
}
export function setName(v) {
  const g = graph(); if (!g) return;
  v = String(v || '').trim();
  const tb = $('pn-projname'); if (tb && document.activeElement !== tb) tb.value = v;
  if (GA()?.edit) { GA().edit('Rename material', gg => { if (v) gg.name = v; else delete gg.name; return true; }, { kind: 'layout' }); return; }
  if (v) g.name = v; else delete g.name;
  editDone('Rename material', [], 'param');
}
