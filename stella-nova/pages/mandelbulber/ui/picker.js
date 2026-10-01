// ui/picker.js — Mandelbulber page: the full-screen formula picker.
//
// buildPicker makes one tile per formula, grouped as in gen/catalog.json, on the first
// open. The search field filters the tiles by words; Enter picks the exact name, then a
// name prefix, then the first tile. choose writes the formula of the slot, and for slot
// 1 with no preset loaded it also frames the view.
//
// grep: function buildPicker  function filterPicker  function openPicker  function closePicker  function choose
//       function initPicker

import { $, picker, el } from './dom.js';
import { CAT, fnum, groupName, isNone } from './data.js';
import { scene, currentExample } from './state.js';
import { thumb } from './thumbs.js';
import { setMain } from './scene.js';
import { frameView } from './camera.js';
import { openSheet, closeSheet } from '../main.js';

let pickerSlot = 0;
let pickerTiles = null;

function buildPicker() {
  const body = $('pickerBody');
  pickerTiles = [];
  const groups = new Map();
  for (const g of CAT.groups || []) groups.set(typeof g === 'string' ? g : g.name ?? g.id, []);
  for (const f of CAT.formulas) {
    if (isNone(f)) continue;
    const g = groupName(f);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(f);
  }
  const none = { id: 'none', name: 'None', enumId: 0 };
  const mk = (f) => {
    const t = el('button', { type: 'button', class: 'tile', title: `${f.name} (${f.id})` }, thumb(f, 64), el('span', {}, f.name));
    t.addEventListener('click', () => choose(f));
    pickerTiles.push({ t, f, key: `${f.name} ${f.id}`.toLowerCase() });
    return t;
  };
  const blocks = [];
  blocks.push({ h: el('h3', {}, 'None'), grid: el('div', { class: 'grid' }, mk(none)) });
  for (const [g, list] of groups) {
    if (!list.length) continue;
    list.sort((a, b) => a.name.localeCompare(b.name));
    blocks.push({ h: el('h3', {}, g, el('small', {}, String(list.length))), grid: el('div', { class: 'grid' }, ...list.map(mk)) });
  }
  body.replaceChildren(...blocks.flatMap((b) => [b.h, b.grid]), el('p', { class: 'empty', hidden: true }, 'No formula matches.'));
  pickerTiles.blocks = blocks;
}

function filterPicker() {
  const q = $('pickerSearch').value.trim().toLowerCase();
  let any = 0;
  for (const { t, key } of pickerTiles) { const ok = !q || q.split(/\s+/).every((w) => key.includes(w)); t.hidden = !ok; any += ok; }
  for (const b of pickerTiles.blocks) {
    const n = [...b.grid.children].filter((c) => !c.hidden).length;
    b.h.hidden = !n;
    const small = b.h.querySelector('small');
    if (small) small.textContent = String(n);
  }
  $('pickerBody').querySelector('.empty').hidden = any > 0;
}

export function openPicker(s) {
  if (!pickerTiles) buildPicker();
  pickerSlot = s;
  const cur = scene.main[`formula_${s + 1}`];
  for (const { t, f } of pickerTiles) t.classList.toggle('cur', fnum(f) === cur);
  openSheet(picker);
  $('pickerSearch').value = '';
  filterPicker();
  const c = pickerTiles.find((p) => fnum(p.f) === cur);
  c?.t.scrollIntoView({ block: 'center' });
  if (matchMedia('(pointer: fine)').matches) $('pickerSearch').focus();
}

export function closePicker() { closeSheet(picker); }
export function choose(f) {
  closePicker();
  setMain(`formula_${pickerSlot + 1}`, fnum(f));
  // a new shape in slot 1 can enclose the camera: fit the view, unless an example sets it
  if (pickerSlot === 0 && currentExample < 0 && !isNone(f)) frameView(true);
}

export function initPicker() {
  $('pickerSearch').addEventListener('input', filterPicker);
  $('pickerSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {                           // exact name, then name prefix, then first match
      const q = e.target.value.trim().toLowerCase();
      const vis = pickerTiles.filter((p) => !p.t.hidden);
      const t = vis.find((p) => p.f.name.toLowerCase() === q) || vis.find((p) => p.f.name.toLowerCase().startsWith(q)) || vis[0];
      if (t) choose(t.f);
    }
    if (e.key === 'Escape') closePicker();
  });
  $('pickerClose').addEventListener('click', closePicker);
}
