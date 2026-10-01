// ============================================================================
//  MATERIAL STUDIO  ·  editor/palette.js — the add-node palette
// ────────────────────────────────────────────────────────────────────────────
//  A search box over the node defs (search.js) at a screen point. When a
//  wire drag drops on empty space, the palette shows only defs that take the
//  wire, and the new node connects its best port and lines up on the drop
//  point. On a phone (canvas under 520 px) the palette centers at the top.
//
//  GREP TARGETS
//      export let pal ... {gx, gy, wire, items, idx} while open
//      openPalette / closePalette / fillPalette / markPal
//      choosePal ........ add the chosen def, select it
//      addFromDef ....... add a node (and connect a wire); one undo step
//      onPalKey ......... arrows, page keys, Enter, Escape, Tab
// ============================================================================
import * as G from '../graph.js';
import { cv, palEl, W, H, catColor, typeColor, prefs, SNAP } from './state.js';
import { layout } from './layout.js';
import { setSel } from './selection.js';
import { bestPortOn } from './wire.js';
import { closeMenu } from './menu.js';
import { searchDefs, pushRecent } from './search.js';

export let pal = null;  // {gx, gy, wire, items, idx}

export function openPalette({ sx, sy, gx, gy, wire }) {
  closeMenu();
  pal = { gx, gy, wire, items: [], idx: 0 };
  palEl.hidden = false;
  const phone = W < 520;
  const pw = Math.min(300, W - 16), ph = Math.min(380, H - 50);
  palEl.style.width = pw + 'px';
  palEl.style.left = (phone ? (W - pw) / 2 : Math.max(8, Math.min(W - pw - 8, sx))) + 'px';
  palEl.style.top = (phone ? 34 : Math.max(32, Math.min(H - ph - 8, sy))) + 'px';
  palEl.style.maxHeight = ph + 'px';
  const head = palEl.querySelector('.ge-pal-head');
  head.textContent = wire ? `${wire.dir === 'out' ? 'Feed' : 'Take'} ${wire.type} · ${wire.src.join('.')}` : 'Add node';
  const q = palEl.querySelector('input');
  q.value = '';
  fillPalette();
  setTimeout(() => q.focus({ preventScroll: true }), 0);
}
export function closePalette() { if (!palEl || palEl.hidden) return; palEl.hidden = true; pal = null; if (cv) cv.focus({ preventScroll: true }); }
export function fillPalette() {
  if (!pal) return;
  const q = palEl.querySelector('input').value;
  pal.items = searchDefs(q, pal.wire, 250);
  pal.idx = 0;
  const list = palEl.querySelector('.ge-pal-list');
  const frag = document.createDocumentFragment();
  let lastCat = null;
  pal.items.forEach((it, i) => {
    const d = it.d;
    const cat = it.recent ? 'Recent' : (q.trim() ? null : d.category);
    if (cat && cat !== lastCat) { const h = document.createElement('div'); h.className = 'ge-pal-cat'; h.textContent = cat; frag.appendChild(h); lastCat = cat; }
    const el = document.createElement('div');
    el.className = 'ge-pal-it'; el.dataset.i = i;
    el.innerHTML = `<i style="background:${catColor(d.category)}"></i><b></b><span class="ge-pal-types"></span><em></em>`;
    el.querySelector('b').textContent = d.label;
    el.querySelector('em').textContent = d.source === 'bench' ? d.type.split('.')[1] || 'bench' : d.category;
    const tps = el.querySelector('.ge-pal-types');
    for (const p of (d.outputs || []).slice(0, 3)) { const s = document.createElement('u'); s.style.background = typeColor(p.type); s.title = `${p.label}: ${p.type}`; tps.appendChild(s); }
    el.title = `${d.type}${d.doc ? '\n' + d.doc : ''}`;
    frag.appendChild(el);
  });
  if (!pal.items.length) { const e = document.createElement('div'); e.className = 'ge-pal-empty'; e.textContent = 'No matching node'; frag.appendChild(e); }
  list.replaceChildren(frag);
  markPal();
}
export function markPal() {
  const list = palEl.querySelector('.ge-pal-list');
  for (const el of list.querySelectorAll('.ge-pal-it.on')) el.classList.remove('on');
  const el = list.querySelector(`.ge-pal-it[data-i="${pal.idx}"]`);
  if (el) { el.classList.add('on'); el.scrollIntoView({ block: 'nearest' }); }
  const d = pal.items[pal.idx]?.d;
  palEl.querySelector('.ge-pal-doc').textContent = d ? (d.doc || d.type) : '';
}
export function choosePal(i) {
  const it = pal?.items[i];
  if (!it) return;
  const { gx, gy, wire } = pal;
  closePalette();
  const id = addFromDef(it.d, gx, gy, wire);
  if (id) setSel([id]);
}
/** Add a node of def at (gx, gy); with a wire, connect its best port and line it up. @returns {string|null} id */
export function addFromDef(d, gx, gy, wire) {
  pushRecent(d.type);
  const r = G.actions.edit(`Add ${d.label}`, g => {
    const n = G.addNode(g, d.type, gx, gy);
    if (!n) return null;
    const L = layout(n);
    if (wire) {
      const ok = new Set();
      for (const pid of (wire.dir === 'out' ? L.ins : L.outs).keys()) {
        const okk = wire.dir === 'out' ? G.canLink(g, wire.src, [n.id, pid]).ok : G.canLink(g, [n.id, pid], wire.src).ok;
        if (okk) ok.add(n.id + '\u0000' + pid);
      }
      const pid = bestPortOn(n, wire.dir, wire.type, ok);
      if (pid) {
        const pp = (wire.dir === 'out' ? L.ins : L.outs).get(pid);
        n.x = Math.round(gx - pp.x + (wire.dir === 'out' ? 0 : 0)); n.y = Math.round(gy - pp.y);
        if (wire.dir === 'out') G.connect(g, wire.src, [n.id, pid]); else G.connect(g, [n.id, pid], wire.src);
      }
    } else if (prefs.snap) { n.x = Math.round(n.x / SNAP) * SNAP; n.y = Math.round(n.y / SNAP) * SNAP; }
    return n;
  }, { nodeIds: [] });
  return r ? r.id : null;
}
export function onPalKey(e) {
  if (!pal) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); pal.idx = Math.min(pal.items.length - 1, pal.idx + 1); markPal(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); pal.idx = Math.max(0, pal.idx - 1); markPal(); }
  else if (e.key === 'PageDown') { e.preventDefault(); pal.idx = Math.min(pal.items.length - 1, pal.idx + 10); markPal(); }
  else if (e.key === 'PageUp') { e.preventDefault(); pal.idx = Math.max(0, pal.idx - 10); markPal(); }
  else if (e.key === 'Enter') { e.preventDefault(); choosePal(pal.idx); }
  else if (e.key === 'Escape' || (e.key === 'Tab' && !palEl.querySelector('input').value)) { e.preventDefault(); closePalette(); }
  e.stopPropagation();
}
