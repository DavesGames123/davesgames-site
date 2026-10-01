// ============================================================================
//  HUMAN SKELETON  ·  app/list.js — the bone list and search
// ────────────────────────────────────────────────────────────────────────────
//  buildList writes one group per region, with Explode and Hide buttons,
//  and one row per bone. One click listener on #list handles the rows and
//  the buttons. A click on a hidden bone shows it first. syncList marks
//  the selected row and opens its group. The search box hides the rows
//  that do not match the name, Latin name, region or side.
//
//  GREP MAP
//    const list / let rowEls                         the list and its rows
//    function buildList                              groups and rows
//    list.addEventListener                           row and group clicks
//    function setRegionHidden                        hide or show a region
//    function syncList                               mark the selection
//    $('search').addEventListener                    the search filter
// ============================================================================
import { $, PHONE_Q, esc, SIDE_NAME } from './env.js';
import { S, regionOf } from './state.js';
import { refreshVisibility } from './visibility.js';
import { toggleRegionExplode } from './layouts.js';
import { select } from './select.js';
import { panel, setOpen, setShow, syncUI } from '../main.js';

export const list = $('list');
export let rowEls = new Map();
export function buildList() {
  list.innerHTML = '';
  rowEls = new Map();
  for (const r of S.regions) {
    const bones = S.bones.filter(b => b.region === r.id);
    if (!bones.length) continue;
    const g = document.createElement('div');
    g.className = 'rg'; g.dataset.r = r.id;
    const soft = r.id === 'teeth' || r.id === 'cartilage';
    g.innerHTML = `<div class="rg-h"><button type="button" class="rg-t" aria-expanded="false">${esc(r.label)} <span class="n">${bones.length}</span><span class="car">›</span></button>` +
      (soft ? '' : `<button type="button" class="rg-b" data-x="explode" aria-label="Explode ${esc(r.label)}">Explode</button>`) +
      `<button type="button" class="rg-b" data-x="hide" aria-label="Hide ${esc(r.label)}">Hide</button></div><div class="rg-rows" role="list"></div>`;
    const rows = g.querySelector('.rg-rows');
    for (const b of bones) {
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'br'; el.dataset.i = b.i; el.setAttribute('role', 'listitem');
      el.innerHTML = `<span>${esc(b.name)}</span><i>${esc(b.latin)}</i>`;
      rows.appendChild(el); rowEls.set(b.i, el);
    }
    list.appendChild(g);
  }
}
list.addEventListener('click', e => {
  const row = e.target.closest('.br');
  if (row) {
    const i = +row.dataset.i;
    const b = S.bones[i];
    if (!S.vis[i]) {
      if (b.type === 'tooth') setShow('teeth', true);
      else if (b.type === 'cartilage') setShow('cartilage', true);
      else setRegionHidden(b.region, false);
    }
    select(i, { fly: S.iso < 0, scroll: false });
    if (PHONE_Q.matches && !matchMedia('(orientation:landscape)').matches) setOpen(false);
    return;
  }
  const g = e.target.closest('.rg');
  if (!g) return;
  const rid = g.dataset.r;
  const bx = e.target.closest('.rg-b');
  if (bx && bx.dataset.x === 'hide') { setRegionHidden(rid, !S.hiddenRegion.has(rid)); return; }
  if (bx && bx.dataset.x === 'explode') { toggleRegionExplode(rid); return; }
  if (e.target.closest('.rg-t')) {
    g.classList.toggle('open');
    g.querySelector('.rg-t').setAttribute('aria-expanded', String(g.classList.contains('open')));
  }
});
export function setRegionHidden(rid, hide) {
  if (rid === 'teeth') { setShow('teeth', !hide); return; }
  if (rid === 'cartilage') { setShow('cartilage', !hide); return; }
  if (hide) S.hiddenRegion.add(rid); else S.hiddenRegion.delete(rid);
  refreshVisibility(true);
  syncUI();
}
export function syncList(scroll) {
  for (const el of list.querySelectorAll('.br.sel')) el.classList.remove('sel');
  if (S.sel < 0) return;
  const el = rowEls.get(S.sel);
  if (!el) return;
  el.classList.add('sel');
  const g = el.closest('.rg');
  if (!g.classList.contains('open')) g.classList.add('open');
  if (scroll && panel.classList.contains('open')) el.scrollIntoView({ block: 'nearest' });
}
$('search').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  list.classList.toggle('filtering', !!q);
  for (const g of list.querySelectorAll('.rg')) {
    let any = false;
    for (const el of g.querySelectorAll('.br')) {
      const b = S.bones[+el.dataset.i];
      const hit = !q || (b.name + ' ' + b.latin + ' ' + regionOf(b).label + ' ' + SIDE_NAME[b.side]).toLowerCase().includes(q);
      el.classList.toggle('miss', !hit);
      any = any || hit;
    }
    g.classList.toggle('empty', !any);
  }
});
