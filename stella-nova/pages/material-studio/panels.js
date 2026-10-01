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
  OUTPUT_TYPE, MATERIAL_PARAMS, PORT_COLORS, NODE_CATEGORIES, RES_OPTIONS,
  EXPORT_TARGETS, MESHES, DEBUG_VIEWS, TONEMAPPERS, emptyGraph,
} from './contract.js';
import { ctx, store, state, M, $, bind } from './panels/ctx.js';
import { lsGet, lsSet, clamp, clone, same, slug } from './panels/util.js';
import { rgbToHex } from './panels/color.js';
import { capture, h, icon, ibtn, download, pickFiles, typing, isPhone } from './panels/dom.js';
import {
  GA, graph, nodesOf, linksOf, getNode, defOf, outputNode, nodeLabel, paramVal,
  catColor, selfEmit, queueEdit, writeParam, commitParam, editDone, loadGraph,
  serializeGraph,
} from './panels/graph-access.js';
import { numField } from './panels/widgets/number.js';
import { wSlider } from './panels/widgets/slider.js';
import { closePicker } from './panels/widgets/picker.js';
import { wColor } from './panels/widgets/color.js';
import { wEnum, wBool } from './panels/widgets/basic.js';
import { wGradient } from './panels/widgets/gradient.js';
import { WIDGETS, WIDE, makeWidget } from './panels/widgets/index.js';

// ------------------------------------------------------------ graph access
let cascade = 0;
/** Add a node from the library. With clientX/Y it goes under the pointer. */
function addNodeAt(type, clientX, clientY) {
  const def = state.registry.get(type); if (!def || !graph()) return null;
  const ed = window.__studio?.editor || M.editor?.api || {};
  if (typeof ed.addNodeAt === 'function') {
    const r = ed.addNodeAt(type, clientX, clientY);
    pushRecent(type);
    return r;
  }
  // editor.js api: toGraph(canvasX, canvasY) -> [gx, gy]; addFromDef(type, gx, gy) -> id
  if (typeof ed.addFromDef === 'function' && typeof ed.toGraph === 'function') {
    const cv = $('graph-wrap')?.querySelector('canvas') || $('graph-wrap');
    const r = cv.getBoundingClientRect();
    let off = 0;
    if (clientX == null) { clientX = r.left + r.width / 2; clientY = r.top + r.height / 2; off = (cascade++ % 6) * 24; }
    const [gx, gy] = ed.toGraph(clientX - r.left, clientY - r.top);
    const id = ed.addFromDef(type, Math.round(gx - 80 + off), Math.round(gy - 20 + off));
    if (id) { pushRecent(type); store.select([id]); }
    return id;
  }
  let x, y;
  const s2g = ed.screenToGraph || window.__studio?.editor?.screenToGraph;
  if (clientX == null) { const r = $('graph-wrap').getBoundingClientRect(); clientX = r.left + r.width / 2; clientY = r.top + r.height / 2; }
  if (typeof s2g === 'function') { try { ({ x, y } = s2g(clientX, clientY)); } catch (e) { x = undefined; } }
  if (!Number.isFinite(x)) {
    const out = outputNode();
    const k = nodesOf().length;
    x = (out ? out.x : 600) - 260 - (k % 4) * 30; y = (out ? out.y : 120) + (k % 8) * 40;
  }
  if (typeof M.graph?.addNode !== 'function') { store.toast('The graph module cannot add nodes', 'error'); return null; }
  const node = M.graph.addNode(graph(), type, Math.round(x), Math.round(y), {});
  pushRecent(type);
  editDone('Add ' + def.label, [node.id]);
  store.select([node.id]);
  return node;
}

// ------------------------------------------------------------ param rows
let sessionSeq = 1;
/**
 * One labelled param control. nodes: GraphNodes the edit writes to (same type).
 * opts.prefix: label prefix (exposed list); opts.noExpose hides the pin button.
 */
function paramRow(nodes, p, opts = {}) {
  const n0 = nodes[0];
  let session = 0;
  const val = paramVal(n0, p);
  const mixed = nodes.some(n => !same(paramVal(n, p), val));
  const row = h('div', { class: 'pn-prm' + (WIDE.has(p.kind) ? ' wide' : '') + (mixed ? ' mixed' : ''), dataset: { pid: p.id } });
  const isDef = v => same(v, p.default);
  const w = makeWidget(p, val, (v, final) => {
    if (!session) session = sessionSeq++;
    commitParam(nodes, p, v, final, session);
    row.classList.toggle('mod', !isDef(v)); row.classList.remove('mixed');
    if (final) session = 0;
  });
  const lbl = h('label', { class: 'pn-lbl', title: (p.doc ? p.doc + '\n' : '') + `${p.id} · ${p.kind}${p.min != null ? ` · ${p.min}..${p.max}` : ''}` }, (opts.prefix ? h('span', { class: 'pn-pre' }, opts.prefix) : null), p.label || p.id);
  const rst = ibtn('reset', 'Reset to default', () => {
    const d = clone(p.default);
    commitParam(nodes, p, d, true, sessionSeq++);
    w.set(d); row.classList.remove('mod', 'mixed');
  }, 'pn-rst');
  const exposed = !opts.noExpose && nodes.length === 1 && (n0.exposed || []).includes(p.id);
  const exp = opts.noExpose ? null : ibtn('pin', 'Expose on the Material panel', () => toggleExpose(nodes, p.id), 'pn-exp' + (exposed ? ' on' : ''));
  if (opts.goto) lbl.append(ibtn('link', 'Select the node', () => store.select([n0.id]), 'pn-goto'));
  row.append(lbl, h('div', { class: 'pn-ctl' }, w.el), h('div', { class: 'pn-acts' }, rst, exp));
  row.classList.toggle('mod', !mixed && !isDef(val));
  row._w = w; row._p = p; row._nodes = nodes;
  return row;
}
function toggleExpose(nodes, pid) {
  const flip = n => {
    const e = new Set(n.exposed || []);
    if (e.has(pid)) e.delete(pid); else e.add(pid);
    if (e.size) n.exposed = [...e]; else delete n.exposed;
  };
  if (GA()?.edit) { GA().edit('Expose ' + pid, () => { nodes.forEach(flip); return true; }, { kind: 'layout', nodeIds: nodes.map(n => n.id) }); renderInspector(true); return; }
  for (const n of nodes) {
    const e = new Set(n.exposed || []);
    if (e.has(pid)) e.delete(pid); else e.add(pid);
    n.exposed = [...e];
    if (!n.exposed.length) delete n.exposed;
  }
  editDone('Expose ' + pid, nodes.map(n => n.id), 'param');
  renderInspector(true);
}

/** Collapsible section with a remembered state. */
function section(key, title, body, { open = true, extra } = {}) {
  const st = lsGet('sec', {});
  const isOpen = st[key] ?? open;
  const head = h('button', { type: 'button', class: 'pn-sec-h', 'aria-expanded': String(isOpen) }, icon('chev', 'pn-chev'), h('span', null, title), extra || null);
  const el = h('section', { class: 'pn-sec' + (isOpen ? ' open' : ''), dataset: { sec: key } }, head, h('div', { class: 'pn-sec-b' }, body));
  head.addEventListener('click', e => {
    if (e.target.closest('.pn-sec-x')) return;
    const o = !el.classList.contains('open'); el.classList.toggle('open', o); head.setAttribute('aria-expanded', o);
    const s = lsGet('sec', {}); s[key] = o; lsSet('sec', s);
  });
  return el;
}
const kv = (k, v, cls) => h('div', { class: 'pn-kv' + (cls ? ' ' + cls : '') }, h('span', null, k), h('b', null, v));

// ------------------------------------------------------------ inspector
let insKey = '';
let insRows = [];
function renderInspector(keepScroll) {
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
function refreshInspector() {
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

function setGraphSetting(key, v, final, session) {
  const g = graph(); if (!g) return;
  g.settings = g.settings || { ...state.settings };
  g.settings[key] = v; state.settings[key] = v;
  queueEdit([], false, key, `s:${key}:${session}`, final);
}

function materialView() {
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
  const til = wSlider({ id: 'tiling', label: 'Tiling', kind: 'int', min: 1, max: 16, step: 1, default: 1 }, g?.settings?.tiling ?? state.settings.tiling ?? 1, (v, f) => { if (!ses) ses = sessionSeq++; setGraphSetting('tiling', v, f, ses); if (f) ses = 0; });
  const seed = numField(g?.settings?.seed ?? state.settings.seed ?? 0, { step: 1, int: true, min: 0, max: 99999, sens: 0.3 }, (v, f) => { if (!ses) ses = sessionSeq++; setGraphSetting('seed', v, f, ses); if (f) ses = 0; });
  const dice = ibtn('dice', 'Random seed', () => { const v = Math.floor(Math.random() * 10000); seed.set(v); setGraphSetting('seed', v, true, sessionSeq++); });
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
function statsLine() {
  const ns = nodesOf(), bench = ns.filter(n => defOf(n)?.source === 'bench').length;
  const c = state.compiled, m = state.maps;
  return [
    kv('nodes', String(ns.length)), kv('links', String(linksOf().length)), bench ? kv('bench', String(bench)) : null,
    c && c.passes ? kv('passes', String(c.passes.length)) : null,
    m ? kv('bake', `${m.res}² ${m.ms != null ? '· ' + m.ms.toFixed(0) + ' ms' : ''}`) : kv('bake', '—'),
  ];
}
function ballCss(sw) {
  const c = Array.isArray(sw) ? sw : [sw || '#888888'];
  const a = c[0], b = c[1] || c[0];
  return `radial-gradient(circle at 34% 30%, rgba(255,255,255,0.75) 0, rgba(255,255,255,0) 22%), radial-gradient(circle at 40% 38%, ${a} 0, ${b} 62%, #05070b 100%)`;
}
function loadPreset(pr) {
  const gj = typeof pr.build === 'function' ? pr.build() : pr.graph;
  if (loadGraph(gj, 'Starter: ' + pr.label, { keepRes: true })) store.toast(`Loaded "${pr.label}"`, 'ok');
}
function setName(v) {
  const g = graph(); if (!g) return;
  v = String(v || '').trim();
  const tb = $('pn-projname'); if (tb && document.activeElement !== tb) tb.value = v;
  if (GA()?.edit) { GA().edit('Rename material', gg => { if (v) gg.name = v; else delete gg.name; return true; }, { kind: 'layout' }); return; }
  if (v) g.name = v; else delete g.name;
  editDone('Rename material', [], 'param');
}

// ------------------------------------------------------------ library
const lib = { entries: [], q: '', cursor: null, src: 'all', open: lsGet('libOpen', { Favorites: true, Recent: true, 'c:Input': true, 'c:Generator': true, 'c:Noise': true, 'c:Pattern': true }), fav: new Set(lsGet('fav', [])), recent: lsGet('recent', []) };
function pushRecent(type) {
  lib.recent = [type, ...lib.recent.filter(t => t !== type)].slice(0, 12);
  lsSet('recent', lib.recent);
  if (!lib.q) renderLibrary();
}
function benchGroup(def) {
  const seg = def.type.split('.');
  return def.benchLibLabel || def.libLabel || def.lib || seg[1] || 'bench';
}
function buildLibrary() {
  lib.entries = [];
  for (const def of state.registry.values()) {
    if (def.type === OUTPUT_TYPE) continue;
    const bench = def.source === 'bench' || def.type.startsWith('bench.');
    const cat = bench ? 'Bench' : (def.category || 'Utility');
    const hay = [def.label, def.type, cat, ...(def.tags || []), bench ? benchGroup(def) : ''].join(' ').toLowerCase();
    lib.entries.push({ def, cat, group: bench ? benchGroup(def) : null, bench, hay, doc: String(def.doc || '').toLowerCase(), label: String(def.label || def.type).toLowerCase() });
  }
  const order = c => { const i = NODE_CATEGORIES.indexOf(c); return i < 0 ? 99 : i; };
  lib.entries.sort((a, b) => order(a.cat) - order(b.cat) || (a.group || '').localeCompare(b.group || '') || a.def.label.localeCompare(b.def.label));
}
/** Subsequence score: higher is better, -1 is no match. Word starts and runs score more. */
function fuzzy(q, s) {
  if (!q) return 0;
  let i = 0, score = 0, run = 0, last = -2;
  for (let j = 0; j < s.length && i < q.length; j++) {
    if (s[j] === q[i]) {
      const start = j === 0 || /[\s._\-&]/.test(s[j - 1]);
      run = last === j - 1 ? run + 1 : 0;
      score += 1 + run * 2 + (start ? 3 : 0);
      last = j; i++;
    }
  }
  if (i < q.length) return -1;
  return score - (s.length * 0.01);
}
function scoreEntry(e, toks) {
  let total = 0;
  for (const t of toks) {
    const inLabel = e.label.includes(t) ? 12 + (e.label.startsWith(t) ? 10 : 0) : -1;
    const f = fuzzy(t, e.label);
    const hy = e.hay.includes(t) ? 6 : -1;
    const dc = e.doc.includes(t) ? 2 : -1;
    const best = Math.max(inLabel, f, hy, dc);
    if (best < 0) return -1;
    total += best;
  }
  return total + (lib.fav.has(e.def.type) ? 3 : 0) - (e.bench ? 1 : 0);
}
function libRow(e, hint) {
  const d = e.def;
  const outT = (d.outputs && d.outputs[0] && d.outputs[0].type) || 'float';
  const fav = lib.fav.has(d.type);
  return h('div', { class: 'pn-li' + (lib.cursor === d.type ? ' cur' : ''), dataset: { type: d.type }, role: 'option', title: d.doc || d.label },
    h('button', { type: 'button', class: 'pn-star' + (fav ? ' on' : ''), 'aria-label': fav ? 'Remove from favorites' : 'Add to favorites', dataset: { star: d.type } }, icon('star')),
    h('i', { class: 'pn-sock', style: { background: PORT_COLORS[outT] || '#888' } }),
    h('span', { class: 'pn-li-l' }, d.label),
    hint ? h('span', { class: 'pn-li-h' }, hint) : (d.pass ? h('span', { class: 'pn-li-h' }, 'pass') : null));
}
function libGroup(key, title, count, rows, depth = 0) {
  const open = lib.q ? true : !!lib.open[key];
  const head = h('button', { type: 'button', class: 'pn-lg-h' + (depth ? ' sub' : ''), dataset: { group: key }, 'aria-expanded': String(open) },
    icon('chev', 'pn-chev'), h('span', null, title), h('span', { class: 'pn-count' }, String(count)));
  const body = h('div', { class: 'pn-lg-b' });
  if (open) body.append(...(typeof rows === 'function' ? rows() : rows));
  return h('div', { class: 'pn-lg' + (open ? ' open' : '') + (depth ? ' sub' : '') }, head, body);
}
function renderLibrary() {
  const list = lib.listEl; if (!list) return;
  const src = lib.src;
  const pool = lib.entries.filter(e => src === 'all' || (src === 'bench' ? e.bench : !e.bench));
  const q = lib.q.trim().toLowerCase();
  const out = [];
  if (q) {
    const toks = q.split(/\s+/).filter(Boolean);
    const hits = [];
    for (const e of pool) { const s = scoreEntry(e, toks); if (s >= 0) hits.push([s, e]); }
    hits.sort((a, b) => b[0] - a[0]);
    lib.flat = hits.slice(0, 250).map(x => x[1]);
    if (!lib.flat.length) out.push(h('div', { class: 'pn-empty' }, `No node matches "${lib.q}".`));
    out.push(...lib.flat.map(e => libRow(e, e.bench ? `bench · ${e.group}` : e.cat)));
    lib.countEl.textContent = `${hits.length} match${hits.length === 1 ? '' : 'es'}`;
  } else {
    lib.flat = [];
    const byType = new Map(pool.map(e => [e.def.type, e]));
    const favs = [...lib.fav].map(t => byType.get(t)).filter(Boolean);
    const rec = lib.recent.map(t => byType.get(t)).filter(Boolean);
    if (favs.length) { out.push(libGroup('Favorites', 'Favorites', favs.length, () => favs.map(e => libRow(e, e.bench ? e.group : e.cat)))); if (lib.open.Favorites) lib.flat.push(...favs); }
    if (rec.length) { out.push(libGroup('Recent', 'Recent', rec.length, () => rec.map(e => libRow(e, e.bench ? e.group : e.cat)))); if (lib.open.Recent) lib.flat.push(...rec); }
    const cats = new Map();
    for (const e of pool) { if (!cats.has(e.cat)) cats.set(e.cat, []); cats.get(e.cat).push(e); }
    for (const [cat, es] of cats) {
      if (cat !== 'Bench') {
        out.push(libGroup('c:' + cat, cat, es.length, () => es.map(e => libRow(e))));
        if (lib.open['c:' + cat]) lib.flat.push(...es);
      } else {
        const groups = new Map();
        for (const e of es) { if (!groups.has(e.group)) groups.set(e.group, []); groups.get(e.group).push(e); }
        out.push(libGroup('c:Bench', 'Composition Bench', es.length, () => [...groups].map(([gname, ge]) => {
          if (lib.open['c:Bench'] && lib.open['b:' + gname]) lib.flat.push(...ge);
          return libGroup('b:' + gname, gname, ge.length, () => ge.map(e => libRow(e)), 1);
        })));
      }
    }
    lib.countEl.textContent = `${pool.length} nodes`;
  }
  const top = list.scrollTop;
  list.replaceChildren(...out);
  list.scrollTop = top;
  renderLibInfo();
}
function renderLibInfo() {
  const box = lib.infoEl; if (!box) return;
  const d = lib.cursor && state.registry.get(lib.cursor);
  if (!d) { box.replaceChildren(h('div', { class: 'pn-sub' }, isPhone() ? 'Tap a node for details, then Add.' : 'Drag a node onto the graph, or double-click it.')); return; }
  const ports = (arr) => (arr || []).map(p => h('span', { class: 'pn-pt', title: p.type }, h('i', { class: 'pn-sock', style: { background: PORT_COLORS[p.type] || '#888' } }), p.label || p.id));
  // Optional rows are null. replaceChildren turns null into the text "null", so filter them.
  box.replaceChildren(...[
    h('div', { class: 'pn-li-info-h' }, h('b', null, d.label), h('button', { type: 'button', class: 'pn-btn pri', onclick: () => { addNodeAt(d.type); if (isPhone()) M.mobile?.setSheet?.('graph'); } }, icon('plus'), 'Add')),
    h('div', { class: 'pn-type mono' }, d.type),
    d.doc ? h('p', { class: 'pn-doc' }, d.doc) : null,
    (d.inputs || []).length ? h('div', { class: 'pn-pts' }, h('span', { class: 'pn-sub' }, 'in'), ports(d.inputs)) : null,
    (d.outputs || []).length ? h('div', { class: 'pn-pts' }, h('span', { class: 'pn-sub' }, 'out'), ports(d.outputs)) : null,
  ].filter(Boolean));
}
function initLibrary() {
  const body = $('lib-body'); if (!body) return;
  const search = h('input', { class: 'pn-search', type: 'search', placeholder: 'Search nodes  ( / )', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Search nodes' });
  const srcSel = h('div', { class: 'pn-seg sm' }, [['all', 'All'], ['core', 'Core'], ['bench', 'Bench']].map(([s, l]) => h('button', { type: 'button', class: 'pn-seg-b' + (s === 'all' ? ' on' : ''), dataset: { v: s } }, l)));
  const count = h('span', { class: 'pn-count' });
  const list = h('div', { class: 'pn-lib-list', role: 'listbox', 'aria-label': 'Node library' });
  const info = h('div', { class: 'pn-lib-info' });
  lib.listEl = list; lib.infoEl = info; lib.countEl = count; lib.searchEl = search;
  // editor.js also has a #lib-body library. Its buildLibrary() rebuilds only
  // when .ge-lib-q is missing, so this hidden sentinel keeps it from replacing
  // this library when the registry size changes (it writes into the sentinel).
  const sentinel = h('div', { class: 'pn-lib-sentinel', hidden: true, 'aria-hidden': 'true' }, h('input', { class: 'ge-lib-q', type: 'hidden' }), h('span', { class: 'ge-lib-n' }), h('div', { class: 'ge-lib-tree' }));
  body.replaceChildren(sentinel, h('div', { class: 'pn-lib-top' }, h('div', { class: 'pn-search-w' }, icon('search'), search), h('div', { class: 'pn-lib-f' }, srcSel, count)), list, info);
  body.classList.add('pn-lib');
  let t = 0;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { lib.q = search.value; lib.cursor = null; renderLibrary(); if (lib.flat[0] && lib.q) { lib.cursor = lib.flat[0].def.type; markCursor(); } }, 60); });
  search.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveCursor(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Enter' && lib.cursor) { e.preventDefault(); addNodeAt(lib.cursor); }
    else if (e.key === 'Escape') { search.value = ''; lib.q = ''; renderLibrary(); search.blur(); }
  });
  srcSel.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; lib.src = b.dataset.v; srcSel.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); renderLibrary(); });
  list.addEventListener('click', e => {
    const st = e.target.closest('[data-star]');
    if (st) { const ty = st.dataset.star; if (lib.fav.has(ty)) lib.fav.delete(ty); else lib.fav.add(ty); lsSet('fav', [...lib.fav]); renderLibrary(); return; }
    const g = e.target.closest('[data-group]');
    if (g) { const k = g.dataset.group; lib.open[k] = !lib.open[k]; lsSet('libOpen', lib.open); renderLibrary(); return; }
    const r = e.target.closest('.pn-li');
    if (r) { lib.cursor = r.dataset.type; markCursor(); renderLibInfo(); }
  });
  list.addEventListener('dblclick', e => { const r = e.target.closest('.pn-li'); if (r && !e.target.closest('[data-star]')) addNodeAt(r.dataset.type); });
  list.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveCursor(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Enter' && lib.cursor) addNodeAt(lib.cursor);
  });
  list.tabIndex = 0;
  // pointer drag to the graph (mouse, pen and touch)
  list.addEventListener('pointerdown', e => {
    const r = e.target.closest('.pn-li'); if (!r || e.target.closest('[data-star]') || e.button !== 0) return;
    const type = r.dataset.type, x0 = e.clientX, y0 = e.clientY;
    let ghost = null;
    const touch = e.pointerType === 'touch';
    const mv = ev => {
      if (!ghost) {
        const dx = ev.clientX - x0, dy = ev.clientY - y0;
        if (Math.hypot(dx, dy) < 8) return;
        if (touch && Math.abs(dy) > Math.abs(dx)) { cleanup(); return; } // vertical swipe scrolls the list
        ghost = h('div', { class: 'pn-ghost' }, state.registry.get(type)?.label || type);
        document.body.appendChild(ghost);
        try { capture(list, ev); } catch (er) { /* ok */ }
        document.body.classList.add('pn-dragging');
      }
      ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 8}px)`;
      const over = document.elementFromPoint(ev.clientX, ev.clientY);
      $('graph-wrap')?.classList.toggle('pn-drop', !!over && !!over.closest('#graph-wrap'));
    };
    const up = ev => {
      if (ghost) {
        const over = document.elementFromPoint(ev.clientX, ev.clientY);
        if (over && over.closest('#graph-wrap')) addNodeAt(type, ev.clientX, ev.clientY);
      }
      cleanup();
    };
    const cleanup = () => {
      ghost?.remove(); ghost = null; document.body.classList.remove('pn-dragging'); $('graph-wrap')?.classList.remove('pn-drop');
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cleanup);
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cleanup);
  });
  buildLibrary(); renderLibrary();
}
function markCursor() {
  lib.listEl.querySelectorAll('.pn-li.cur').forEach(x => x.classList.remove('cur'));
  const el = lib.cursor && lib.listEl.querySelector(`.pn-li[data-type="${CSS.escape(lib.cursor)}"]`);
  if (el) { el.classList.add('cur'); el.scrollIntoView({ block: 'nearest' }); }
}
function moveCursor(d) {
  const flat = lib.flat.length ? lib.flat : [];
  if (!flat.length) return;
  let i = flat.findIndex(e => e.def.type === lib.cursor);
  i = clamp(i + d, 0, flat.length - 1);
  lib.cursor = flat[i].def.type; markCursor(); renderLibInfo();
}

// ------------------------------------------------------------ maps strip
// One tile per map channel. `view` is the viewport debug view the tile solos.
const TILES = [
  { id: 'albedo', label: 'Base Color', slot: 'albedo', mode: 0, view: 'albedo' },
  { id: 'opacity', label: 'Opacity', slot: 'albedo', mode: 2, mask: [0, 0, 0, 1], view: 'opacity' },
  { id: 'normal', label: 'Normal', slot: 'normal', mode: 1, view: 'normal' },
  { id: 'ao', label: 'AO', slot: 'orm', mode: 2, mask: [1, 0, 0, 0], view: 'ao' },
  { id: 'roughness', label: 'Roughness', slot: 'orm', mode: 2, mask: [0, 1, 0, 0], view: 'roughness' },
  { id: 'metallic', label: 'Metallic', slot: 'orm', mode: 2, mask: [0, 0, 1, 0], view: 'metallic' },
  { id: 'height', label: 'Height', slot: 'height', mode: 2, mask: [1, 0, 0, 0], view: 'height' },
  { id: 'emissive', label: 'Emissive', slot: 'emissive', mode: 3, view: 'emissive' },
  { id: 'clearcoat', label: 'Clearcoat', slot: 'extra', mode: 2, mask: [1, 0, 0, 0], view: 'clearcoat' },
  { id: 'ccRough', label: 'Coat Rough', slot: 'extra', mode: 2, mask: [0, 1, 0, 0], view: null },
  { id: 'sheen', label: 'Sheen', slot: 'extra', mode: 2, mask: [0, 0, 1, 0], view: 'sheen' },
  { id: 'anisotropy', label: 'Anisotropy', slot: 'extra', mode: 2, mask: [0, 0, 0, 1], view: 'anisotropy' },
];
const THUMB = 128;
const thumbs = { pipe: null, samp: null, ubufs: [], tiles: new Map(), busy: false, again: false, n: 0, err: null };
async function initThumbPipeline() {
  const g = ctx.gpu; if (!g.ok) return;
  let code;
  try { code = await (await fetch(new URL('./shaders/panels-thumb.wgsl', import.meta.url))).text(); }
  catch (e) { thumbs.err = 'shader fetch failed'; return; }
  const d = g.device;
  const mod = d.createShaderModule({ code, label: 'panels-thumb' });
  thumbs.pipe = await d.createRenderPipelineAsync({
    label: 'panels-thumb', layout: 'auto',
    vertex: { module: mod, entryPoint: 'vs' },
    fragment: { module: mod, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' },
  });
  thumbs.samp = d.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' });
}
/** Uniform for one tile: mask vec4f, mode u32, gain f32, footprint f32, pad. */
function tileUniform(t, size, res, gain) {
  const d = ctx.gpu.device;
  const buf = d.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const ab = new ArrayBuffer(32), f = new Float32Array(ab), u = new Uint32Array(ab);
  f.set(t.mask || [1, 1, 1, 1], 0); u[4] = t.mode; f[5] = gain; f[6] = 1 / size; f[7] = res / size;
  d.queue.writeBuffer(buf, 0, ab);
  return buf;
}
/**
 * Render the given tiles of `maps` to rgba8 images. All GPU work is submitted
 * before the first await, so the bake may recycle the maps afterwards.
 * @returns {Promise<ImageData[]>|null}
 */
function renderTiles(maps, list, size) {
  const d = ctx.gpu.device; if (!thumbs.pipe || !maps) return null;
  const W = size * list.length, bpr = Math.ceil((W * 4) / 256) * 256;
  const tgt = d.createTexture({ size: [W, size], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const rb = d.createBuffer({ size: bpr * size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const gain = maps.scalars?.emissiveStrength ?? state.scalars?.emissiveStrength ?? 1;
  const ubs = [];
  const enc = d.createCommandEncoder({ label: 'panels-thumbs' });
  const pass = enc.beginRenderPass({ colorAttachments: [{ view: tgt.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.05, g: 0.06, b: 0.08, a: 1 } }] });
  pass.setPipeline(thumbs.pipe);
  list.forEach((t, i) => {
    const tex = maps[t.slot]; if (!tex) return;
    const ub = tileUniform(t, size, maps.res || tex.width || 1024, gain); ubs.push(ub);
    const bg = d.createBindGroup({ layout: thumbs.pipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: tex.createView() }, { binding: 1, resource: thumbs.samp }, { binding: 2, resource: { buffer: ub } }] });
    pass.setViewport(i * size, 0, size, size, 0, 1);
    pass.setBindGroup(0, bg); pass.draw(3);
  });
  pass.end();
  enc.copyTextureToBuffer({ texture: tgt }, { buffer: rb, bytesPerRow: bpr }, [W, size]);
  d.queue.submit([enc.finish()]);
  return rb.mapAsync(GPUMapMode.READ).then(() => {
    const src = new Uint8Array(rb.getMappedRange());
    const imgs = list.map((t, i) => {
      const img = new ImageData(size, size);
      for (let y = 0; y < size; y++) img.data.set(src.subarray(y * bpr + i * size * 4, y * bpr + (i + 1) * size * 4), y * size * 4);
      return img;
    });
    rb.unmap(); rb.destroy(); tgt.destroy(); ubs.forEach(b => b.destroy());
    return imgs;
  }, e => { rb.destroy(); tgt.destroy(); ubs.forEach(b => b.destroy()); throw e; });
}
function initStrip() {
  const strip = $('maps-strip'); if (!strip) return;
  strip.classList.add('pn-strip');
  strip.replaceChildren(...TILES.map(t => {
    const cv = h('canvas', { width: THUMB, height: THUMB, class: 'mt-cv' });
    const stat = h('span', { class: 'mt-stat' }, '—');
    const el = h('button', { type: 'button', class: 'mt', dataset: { tile: t.id }, title: `${t.label}${t.view ? ': click to solo in the viewport' : ''}. Double-click to enlarge.` },
      cv, h('span', { class: 'mt-l' }, t.label), stat);
    el.addEventListener('click', () => {
      if (!t.view) return;
      store.setView({ debug: state.view.debug === t.view ? 'lit' : t.view });
    });
    el.addEventListener('dblclick', () => openLightbox(t));
    thumbs.tiles.set(t.id, { el, cv, stat, t });
    return el;
  }));
  markSolo();
}
function markSolo() { for (const { el, t } of thumbs.tiles.values()) el.classList.toggle('on', !!t.view && state.view.debug === t.view); }
async function updateStrip() {
  if (!thumbs.pipe || !state.maps) return;
  if (thumbs.busy) { thumbs.again = true; return; }
  thumbs.busy = true;
  try {
    const p = renderTiles(state.maps, TILES, THUMB);
    if (!p) return;
    const imgs = await p;
    imgs.forEach((img, i) => {
      const tl = thumbs.tiles.get(TILES[i].id); if (!tl) return;
      tl.cv.getContext('2d').putImageData(img, 0, 0);
      tl.stat.textContent = tileStat(img, TILES[i]);
      tl.el.classList.toggle('flat', /^flat/.test(tl.stat.textContent));
    });
    thumbs.n++;
  } catch (e) { console.warn('[panels] thumbnails', e); thumbs.err = String(e.message || e); }
  finally {
    thumbs.busy = false;
    if (thumbs.again) { thumbs.again = false; updateStrip(); }
  }
}
/** Min/max of a gray tile (display value), or 'flat x' when constant. */
function tileStat(img, t) {
  const d = img.data; let mn = 255, mx = 0;
  const step = 4 * 7;
  for (let i = 0; i < d.length; i += step) { const v = t.mode === 2 ? d[i] : Math.max(d[i], d[i + 1], d[i + 2]); if (v < mn) mn = v; if (v > mx) mx = v; }
  if (mx - mn <= 1) return t.mode === 2 ? `flat ${(mn / 255).toFixed(2)}` : `flat ${rgbToHex([d[0] / 255, d[1] / 255, d[2] / 255])}`;
  return t.mode === 2 ? `${(mn / 255).toFixed(2)}–${(mx / 255).toFixed(2)}` : '';
}
async function openLightbox(t) {
  if (!state.maps || !thumbs.pipe) return;
  const S = 512;
  const cv = h('canvas', { width: S, height: S, class: 'lb-cv' });
  const read = h('span', { class: 'mono pn-sub' }, 'hover to read texels');
  const sel = h('select', { class: 'pn-sel', 'aria-label': 'Channel' }, TILES.map(x => h('option', { value: x.id }, x.label)));
  sel.value = t.id;
  const close = () => box.remove();
  const box = h('div', { class: 'pn-modal', role: 'dialog', 'aria-label': 'Map preview', onclick: e => { if (e.target === box) close(); } },
    h('div', { class: 'pn-modal-c lb' },
      h('div', { class: 'pn-modal-h' }, h('b', null, 'Map preview'), sel, h('span', { class: 'pn-sub' }, `${state.maps.res}² source`), ibtn('close', 'Close', close)),
      cv, read));
  document.body.appendChild(box);
  const draw = async id => {
    const tile = TILES.find(x => x.id === id);
    const p = renderTiles(state.maps, [tile], S); if (!p) return;
    const [img] = await p; cv.getContext('2d').putImageData(img, 0, 0); cv._img = img;
  };
  sel.addEventListener('change', () => draw(sel.value));
  cv.addEventListener('pointermove', e => {
    const r = cv.getBoundingClientRect(), x = Math.floor((e.clientX - r.left) / r.width * S), y = Math.floor((e.clientY - r.top) / r.height * S);
    const img = cv._img; if (!img || x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    read.textContent = `uv ${(x / S).toFixed(3)}, ${(y / S).toFixed(3)}  ·  ${[0, 1, 2].map(k => (img.data[i + k] / 255).toFixed(3)).join('  ')}  (display)`;
  });
  box.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  box.tabIndex = -1; box.focus();
  await draw(t.id);
}

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
function envRow(label, w, title) { return h('div', { class: 'pn-prm' }, h('label', { class: 'pn-lbl', title: title || '' }, label), h('div', { class: 'pn-ctl' }, w.el || w), h('div', { class: 'pn-acts' })); }
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
