// ============================================================================
//  MATERIAL STUDIO  ·  editor/library.js — the #lib-body node list
// ────────────────────────────────────────────────────────────────────────────
//  A searchable node list in #lib-body: a Recent group, one group per
//  category, then one group per bench library under "Composition Bench".
//  The open groups stay in localStorage. A click or Enter adds the node at
//  the view center, offset in a cascade. A drag carries the type to the
//  canvas (dom.js takes the drop). When panels.js owns #lib-body (class
//  pn-lib), this library does nothing.
//
//  GREP TARGETS
//      scheduleLib ..... rebuild after 50 ms (render.js calls it on a registry change)
//      libGroups ....... category and bench groups, sorted
//      libItem ......... one draggable row
//      buildLibrary .... the search box, the tree and its listeners
//      addFromLib ...... add at the view center, select, toast
//      nextCascade ..... 0, 24, ... 120 px offset for the next center add
// ============================================================================
import { OUTPUT_TYPE } from '../contract.js';
import * as G from '../graph.js';
import { state, toast } from '../store.js';
import { LIB_KEY, catColor } from './state.js';
import { setSel } from './selection.js';
import { viewCenterG } from './view.js';
import { addFromDef } from './palette.js';
import { recent, allDefs, catRank, searchDefs } from './search.js';

let libTimer = 0, libOpen = new Set(['Recent', 'Input', 'Generator', 'Noise']);
try { const j = JSON.parse(localStorage.getItem(LIB_KEY) || 'null'); if (Array.isArray(j)) libOpen = new Set(j); } catch (e) {}
export function scheduleLib() { clearTimeout(libTimer); libTimer = setTimeout(buildLibrary, 50); }
function libGroups() {
  const groups = new Map();
  const add = (key, d, label, color) => { if (!groups.has(key)) groups.set(key, { key, label, color, defs: [] }); groups.get(key).defs.push(d); };
  for (const d of allDefs()) {
    if (d.source === 'bench' || d.type.startsWith('bench.')) {
      const lib = d.lib || d.type.split('.')[1] || 'bench';
      add('Bench/' + lib, d, lib, catColor('Bench'));
    } else add(d.category || 'Other', d, d.category || 'Other', catColor(d.category));
  }
  const arr = [...groups.values()];
  arr.sort((a, b) => {
    const ab = a.key.startsWith('Bench/'), bb = b.key.startsWith('Bench/');
    if (ab !== bb) return ab ? 1 : -1;
    return catRank(a.key) - catRank(b.key) || a.label.localeCompare(b.label);
  });
  for (const gr of arr) gr.defs.sort((a, b) => a.label.localeCompare(b.label));
  return arr;
}
function libItem(d) {
  const el = document.createElement('div');
  el.className = 'ge-lib-it'; el.draggable = true; el.dataset.type = d.type; el.tabIndex = 0;
  el.innerHTML = '<i></i><span></span><em></em>';
  el.firstChild.style.background = catColor(d.category);
  el.children[1].textContent = d.label;
  el.lastChild.textContent = (d.outputs || []).map(p => p.type[0]).join('');
  el.title = `${d.label} · ${d.type}${d.doc ? '\n' + d.doc : ''}\nClick to add · drag onto the graph`;
  return el;
}
export function buildLibrary() {
  libTimer = 0;
  const body = document.getElementById('lib-body');
  if (!body) return;
  // panels.js can own #lib-body (class pn-lib): then this library stands down
  if (body.classList.contains('pn-lib')) return;
  if (!body.querySelector('.ge-lib-q')) {
    body.innerHTML = '<div class="ge-lib-search"><input class="ge-lib-q" type="search" placeholder="Search nodes" aria-label="Search nodes" spellcheck="false"><span class="ge-lib-n"></span></div><div class="ge-lib-tree"></div>';
    const q = body.querySelector('.ge-lib-q');
    q.addEventListener('input', () => buildLibrary());
    q.addEventListener('keydown', e => {
      if (e.key === 'Enter') { const first = body.querySelector('.ge-lib-it'); if (first) addFromLib(first.dataset.type); }
      if (e.key === 'Escape') { q.value = ''; buildLibrary(); }
      e.stopPropagation();
    });
    const tree = body.querySelector('.ge-lib-tree');
    tree.addEventListener('click', e => {
      const head = e.target.closest('.ge-lib-head');
      if (head) { const k = head.dataset.key; if (libOpen.has(k)) libOpen.delete(k); else libOpen.add(k); try { localStorage.setItem(LIB_KEY, JSON.stringify([...libOpen])); } catch (er) {} buildLibrary(); return; }
      const it = e.target.closest('.ge-lib-it');
      if (it) addFromLib(it.dataset.type);
    });
    tree.addEventListener('keydown', e => { const it = e.target.closest('.ge-lib-it'); if (it && e.key === 'Enter') addFromLib(it.dataset.type); });
    tree.addEventListener('dragstart', e => {
      const it = e.target.closest('.ge-lib-it'); if (!it) return;
      e.dataTransfer.setData('application/x-material-node', it.dataset.type);
      e.dataTransfer.setData('text/plain', it.dataset.type);
      e.dataTransfer.effectAllowed = 'copy';
    });
  }
  const q = body.querySelector('.ge-lib-q').value.trim();
  const tree = body.querySelector('.ge-lib-tree');
  const frag = document.createDocumentFragment();
  const total = allDefs().length;
  if (q) {
    const res = searchDefs(q, null, 400);
    body.querySelector('.ge-lib-n').textContent = `${res.length}${res.length >= 400 ? '+' : ''}`;
    for (const r of res) frag.appendChild(libItem(r.d));
    if (!res.length) { const e = document.createElement('div'); e.className = 'ge-lib-empty'; e.textContent = 'No match'; frag.appendChild(e); }
  } else {
    body.querySelector('.ge-lib-n').textContent = String(total);
    const rec = recent().map(t => state.registry.get(t)).filter(Boolean).slice(0, 8);
    const groups = libGroups();
    if (rec.length) groups.unshift({ key: 'Recent', label: 'Recent', color: '#e8ecf4', defs: rec });
    let benchHead = false;
    for (const gr of groups) {
      if (gr.key.startsWith('Bench/') && !benchHead) {
        benchHead = true;
        const h = document.createElement('div'); h.className = 'ge-lib-sec'; h.textContent = 'Composition Bench'; frag.appendChild(h);
      }
      const open = libOpen.has(gr.key);
      const head = document.createElement('button');
      head.type = 'button'; head.className = 'ge-lib-head' + (open ? ' open' : ''); head.dataset.key = gr.key;
      head.innerHTML = '<b></b><i></i><span></span><em></em>';
      head.children[1].style.background = gr.color;
      head.children[2].textContent = gr.label;
      head.lastChild.textContent = gr.defs.length;
      frag.appendChild(head);
      if (open) { const box = document.createElement('div'); box.className = 'ge-lib-group'; for (const d of gr.defs) box.appendChild(libItem(d)); frag.appendChild(box); }
    }
  }
  tree.replaceChildren(frag);
}
let libCascade = 0;
/** The offset of the next add at the view center: 0, 24, ... 120, then 0 again. */
export function nextCascade() { return (libCascade++ % 6) * 24; }
function addFromLib(type) {
  const d = G.getDef(type); if (!d) return;
  const [gx, gy] = viewCenterG();
  const off = nextCascade();
  const id = addFromDef(d, gx - 80 + off, gy - 40 + off);
  if (id) { setSel([id]); toast(`Added ${d.label}`, 'ok', 1000); }
  else if (type === OUTPUT_TYPE) toast('The graph has one Material Output', 'warn', 1600);
  if (!libTimer) scheduleLib();
}
