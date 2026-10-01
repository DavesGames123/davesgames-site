// ============================================================================
//  MATERIAL STUDIO  ·  panels/inspector.js — the #inspector panel for selected nodes
// ────────────────────────────────────────────────────────────────────────────
//  renderInspector rebuilds #inspector: nodeView for a selection, or the
//  material view when nothing is selected. refreshInspector updates the
//  shown values in place after an edit from another module. insRows holds
//  the live param rows for that refresh.
//
//  GREP TARGETS
//      insKey insRows renderInspector refreshInspector nodeView deleteNodes
//      duplicateNodes resetAll
// ============================================================================
import { OUTPUT_TYPE, PORT_COLORS } from '../contract.js';
import { store, state, M, $ } from './ctx.js';
import { clone, same } from './util.js';
import { h, icon } from './dom.js';
import {
  GA, graph, linksOf, getNode, defOf, nodeLabel, paramVal, catColor, writeParam,
  editDone,
} from './graph-access.js';
import { closePicker } from './widgets/picker.js';
import { paramRow, section } from './rows.js';
import { materialView } from './material-view.js';

let insKey = '';
export let insRows = [];
export function renderInspector(keepScroll) {
  const root = $('inspector'); if (!root) return;
  closePicker();
  const sel = (state.selection || []).map(getNode).filter(Boolean);
  const key = sel.map(n => n.id).join(',');
  const scroll = root.scrollTop;
  insRows = [];
  root.replaceChildren(sel.length ? nodeView(sel) : materialView());
  root.scrollTop = (keepScroll || key === insKey) ? scroll : 0;
  insKey = key;
}
/** Update the shown values in place (an edit from elsewhere, same selection). */
export function refreshInspector() {
  for (const r of insRows) {
    if (!r.isConnected || !r._w) continue;
    if (r.contains(document.activeElement) && document.activeElement !== document.body) continue;
    r._w.set(paramVal(r._nodes[0], r._p));
    r.classList.toggle('mod', !same(paramVal(r._nodes[0], r._p), r._p.default));
  }
}

function nodeView(nodes) {
  const n = nodes[0], def = defOf(n);
  const frag = document.createDocumentFragment();
  const allSame = nodes.every(m => m.type === n.type);
  if (nodes.length > 1) {
    frag.append(h('div', { class: 'pn-head' },
      h('div', { class: 'pn-head-t' }, h('b', null, `${nodes.length} nodes`), h('span', { class: 'pn-sub' }, allSame ? `all ${def?.label || n.type}: edits apply to each` : 'mixed types: pick one')),
      h('div', { class: 'pn-chips' }, nodes.map(m => h('button', { type: 'button', class: 'pn-chip', style: { '--c': catColor(defOf(m)?.category) }, onclick: () => store.select([m.id]) }, nodeLabel(m)))),
      h('div', { class: 'pn-head-a' },
        h('button', { type: 'button', class: 'pn-btn', onclick: () => deleteNodes(nodes) }, icon('trash'), 'Delete'),
        h('button', { type: 'button', class: 'pn-btn', onclick: () => duplicateNodes(nodes) }, icon('copy'), 'Duplicate'))));
    if (!allSame || !def) return frag;
  }
  if (!def) {
    frag.append(h('div', { class: 'pn-empty warn' }, `Unknown node type "${n.type}". The registry has no definition for it, so it cannot bake. Delete it or load the module that defines it.`));
    frag.append(h('div', { class: 'pn-head-a' }, h('button', { type: 'button', class: 'pn-btn', onclick: () => deleteNodes(nodes) }, icon('trash'), 'Delete')));
    return frag;
  }
  const isOut = n.type === OUTPUT_TYPE;
  if (nodes.length === 1) {
    const name = h('input', { class: 'pn-name', type: 'text', value: n.label || def.label, spellcheck: 'false', 'aria-label': 'Node name', placeholder: def.label });
    name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); if (e.key === 'Escape') { name.value = n.label || def.label; name.blur(); } });
    name.addEventListener('change', () => {
      const t = name.value.trim();
      if (GA()?.rename) { GA().rename(n.id, (!t || t === def.label) ? null : t); return; }
      if (!t || t === def.label) delete n.label; else n.label = t;
      editDone('Rename node', [n.id], 'param');
    });
    frag.append(h('div', { class: 'pn-head' },
      h('div', { class: 'pn-head-r' }, h('i', { class: 'pn-dot', style: { background: catColor(def.category) } }), name,
        h('span', { class: 'pn-badge' + (def.source === 'bench' ? ' bench' : '') }, def.source || 'core')),
      h('div', { class: 'pn-type mono' }, def.type, h('span', { class: 'pn-sub' }, ` · ${def.category}${def.pass ? ' · pass' : ' · fused'} · ${n.id}`)),
      def.doc ? h('p', { class: 'pn-doc' }, def.doc) : null,
      isOut ? null : h('div', { class: 'pn-head-a' },
        h('button', { type: 'button', class: 'pn-btn', title: 'Duplicate (keeps params)', onclick: () => duplicateNodes(nodes) }, icon('copy'), 'Duplicate'),
        h('button', { type: 'button', class: 'pn-btn', title: 'Reset every param to its default', onclick: () => resetAll(nodes, def) }, icon('reset'), 'Reset all'),
        h('button', { type: 'button', class: 'pn-btn danger', title: 'Delete the node', onclick: () => deleteNodes(nodes) }, icon('trash'), 'Delete'))));
  }
  const params = (def.params || []);
  if (params.length) {
    const rows = params.map(p => { const r = paramRow(nodes, p, { noExpose: nodes.length > 1 }); insRows.push(r); return r; });
    const modded = params.filter(p => !same(paramVal(n, p), p.default)).length;
    frag.append(section('params', isOut ? 'Material scalars' : 'Parameters', rows, { extra: h('span', { class: 'pn-count' }, `${modded}/${params.length} set`) }));
  } else frag.append(h('div', { class: 'pn-empty' }, 'This node has no parameters.'));
  if (nodes.length === 1) {
    const ins = (def.inputs || []).map(inp => {
      const l = linksOf().find(k => k.to[0] === n.id && k.to[1] === inp.id);
      const src = l && getNode(l.from[0]);
      const dflt = inp.default ?? (inp.type === 'float' ? 0 : null);
      return h('div', { class: 'pn-port' },
        h('i', { class: 'pn-sock', style: { background: PORT_COLORS[inp.type] || '#888' }, title: inp.type }),
        h('span', { class: 'pn-port-l' }, inp.label || inp.id),
        src ? h('button', { type: 'button', class: 'pn-port-src', title: 'Select the source node', onclick: () => store.select([src.id]) }, `${nodeLabel(src)}.${l.from[1]}`)
          : h('span', { class: 'pn-port-d mono' }, dflt == null ? '—' : Array.isArray(dflt) ? dflt.map(x => +(+x).toFixed(3)).join(', ') : String(dflt)));
    });
    if (ins.length) frag.append(section('inputs', 'Inputs', ins, { open: true, extra: h('span', { class: 'pn-count' }, `${linksOf().filter(k => k.to[0] === n.id).length}/${ins.length} linked`) }));
    const outs = (def.outputs || []).map(o => {
      const cnt = linksOf().filter(k => k.from[0] === n.id && k.from[1] === o.id);
      return h('div', { class: 'pn-port' },
        h('i', { class: 'pn-sock', style: { background: PORT_COLORS[o.type] || '#888' }, title: o.type }),
        h('span', { class: 'pn-port-l' }, o.label || o.id), h('span', { class: 'pn-port-d mono' }, o.type),
        h('span', { class: 'pn-port-n' }, cnt.length ? cnt.map(k => nodeLabel(getNode(k.to[0])) + '.' + k.to[1]).join(', ') : 'unused'));
    });
    if (outs.length) frag.append(section('outputs', 'Outputs', outs, { open: false }));
    const err = (state.compiled?.errors || []).filter(e => e.nodeId === n.id);
    if (err.length) frag.append(h('div', { class: 'pn-empty warn' }, err.map(e => h('div', null, e.message))));
  }
  return frag;
}

function deleteNodes(nodes) {
  if (GA()?.remove) { GA().remove(nodes.map(n => n.id).filter(id => id !== graph().output)); store.select([]); return; }
  if (typeof M.graph?.removeNode !== 'function') return;
  const ids = nodes.map(n => n.id).filter(id => id !== graph().output);
  ids.forEach(id => M.graph.removeNode(graph(), id));
  store.select([]);
  editDone(`Delete ${ids.length} node${ids.length === 1 ? '' : 's'}`, ids);
}
function duplicateNodes(nodes) {
  if (GA()?.duplicate) {
    const r = GA().duplicate(nodes.filter(n => n.type !== OUTPUT_TYPE).map(n => n.id), 40, 40);
    const ids = Array.isArray(r) ? r : (r && r.nodeIds) || [];
    if (ids.length) store.select(ids.map(x => typeof x === 'string' ? x : x.id));
    return;
  }
  if (typeof M.graph?.addNode !== 'function') return;
  const made = nodes.filter(n => n.type !== OUTPUT_TYPE).map(n => {
    const m = M.graph.addNode(graph(), n.type, n.x + 40, n.y + 40, clone(n.params || {}));
    if (n.label) m.label = n.label + ' copy';
    if (n.exposed) m.exposed = [...n.exposed];
    return m;
  });
  editDone('Duplicate', made.map(m => m.id));
  store.select(made.map(m => m.id));
}
function resetAll(nodes, def) {
  for (const n of nodes) for (const p of def.params || []) writeParam(n, p.id, clone(p.default));
  editDone('Reset params', nodes.map(n => n.id), 'param');
  renderInspector(true);
}
