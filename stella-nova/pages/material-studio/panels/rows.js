// ============================================================================
//  MATERIAL STUDIO  ·  panels/rows.js — labelled rows and collapsible sections
// ────────────────────────────────────────────────────────────────────────────
//  paramRow is one param control with its reset and expose buttons. It
//  writes through graph-access.commitParam. section() is a collapsible
//  block that keeps its open state in localStorage. envRow and kv are the
//  plain label + control and label + value rows.
//
//  GREP TARGETS
//      sessionSeq nextSession paramRow toggleExpose section kv envRow
// ============================================================================
import { store } from './ctx.js';
import { lsGet, lsSet, clone, same } from './util.js';
import { h, icon, ibtn } from './dom.js';
import { GA, paramVal, commitParam, editDone } from './graph-access.js';
import { WIDE, makeWidget } from './widgets/index.js';
import { renderInspector } from './inspector.js';

let sessionSeq = 1;
export const nextSession = () => sessionSeq++;
/**
 * One labelled param control. nodes: GraphNodes the edit writes to (same type).
 * opts.prefix: label prefix (exposed list); opts.noExpose hides the pin button.
 */
export function paramRow(nodes, p, opts = {}) {
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
export function section(key, title, body, { open = true, extra } = {}) {
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
export const kv = (k, v, cls) => h('div', { class: 'pn-kv' + (cls ? ' ' + cls : '') }, h('span', null, k), h('b', null, v));

export function envRow(label, w, title) { return h('div', { class: 'pn-prm' }, h('label', { class: 'pn-lbl', title: title || '' }, label), h('div', { class: 'pn-ctl' }, w.el || w), h('div', { class: 'pn-acts' })); }
