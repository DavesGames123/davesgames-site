// ============================================================================
//  MATERIAL STUDIO  ·  panels/library.js — the #lib-body node library
// ────────────────────────────────────────────────────────────────────────────
//  Search with a fuzzy score, favorites, recent, and a category tree
//  (bench nodes go under their library). Click shows the node details,
//  double-click or Enter adds the node, and a pointer drag drops it on
//  #graph-wrap. addNodeAt is also the add path for the rest of the page.
//
//  GREP TARGETS
//      cascade addNodeAt lib pushRecent benchGroup buildLibrary fuzzy
//      scoreEntry libRow libGroup renderLibrary renderLibInfo initLibrary
//      markCursor moveCursor
// ============================================================================
import { OUTPUT_TYPE, PORT_COLORS, NODE_CATEGORIES } from '../contract.js';
import { store, state, M, $ } from './ctx.js';
import { lsGet, lsSet, clamp } from './util.js';
import { capture, h, icon, isPhone } from './dom.js';
import { graph, nodesOf, outputNode, editDone } from './graph-access.js';

let cascade = 0;
/** Add a node from the library. With clientX/Y it goes under the pointer. */
export function addNodeAt(type, clientX, clientY) {
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

export const lib = { entries: [], q: '', cursor: null, src: 'all', open: lsGet('libOpen', { Favorites: true, Recent: true, 'c:Input': true, 'c:Generator': true, 'c:Noise': true, 'c:Pattern': true }), fav: new Set(lsGet('fav', [])), recent: lsGet('recent', []) };
function pushRecent(type) {
  lib.recent = [type, ...lib.recent.filter(t => t !== type)].slice(0, 12);
  lsSet('recent', lib.recent);
  if (!lib.q) renderLibrary();
}
export function benchGroup(def) {
  const seg = def.type.split('.');
  return def.benchLibLabel || def.libLabel || def.lib || seg[1] || 'bench';
}
export function buildLibrary() {
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
export function fuzzy(q, s) {
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
export function renderLibrary() {
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
export function initLibrary() {
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
