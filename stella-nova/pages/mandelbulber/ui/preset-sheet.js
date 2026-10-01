// ui/preset-sheet.js — Mandelbulber page: the full-screen preset browser and Random.
//
// buildExamples makes the sheet on the first open: source and family chips over a grid
// with one heading per source group (per collection author, with the licence). Search,
// chips and Random work together: randomExample picks from the tiles that the filters
// show while the sheet is open, and from all presets when it is closed.
//
// grep: function randomExample  let exTiles  const exFilter  function buildExamples  function filterExSheet
//       function openExamples  function closeExamples  function initPresetSheet

import { $, exSheet, el } from './dom.js';
import { EXAMPLES, COLLECTIONS } from './data.js';
import { currentExample } from './state.js';
import { presetThumb } from './thumbs.js';
import { SOURCES, FAMILIES, presetTitle, loadExample } from './presets.js';
import { openSheet, closeSheet } from './sheets.js';
import { L, snapTo } from '../main.js';

// A random preset from the ones the sheet filters show (all presets when the sheet is closed).
export function randomExample() {
  const open = !exSheet.classList.contains('hidden') && exTiles;
  const pool = open ? exTiles.filter((x) => !x.t.hidden).map((x) => x.i) : EXAMPLES.map((_, i) => i);
  if (!pool.length) return;
  let i = pool[Math.floor(Math.random() * pool.length)];
  if (i === currentExample && pool.length > 1) i = pool[(pool.indexOf(i) + 1) % pool.length];
  if (open) { closeExamples(); if (L.mode === 'sheet' && L.snap === 'full') snapTo('half'); }
  loadExample(i);
}

// The sheet: source and family chips over a grid with one heading per source group
// (per collection author, with the licence). Search, chips and Random work together.
let exTiles = null, exGroups = [];
const exFilter = { src: 'all', family: 'all' };

function buildExamples() {
  exTiles = [];
  exGroups = [];
  const body = [];
  let g = null;
  EXAMPLES.forEach((e, i) => {
    if (!g || g.name !== e.group) {
      const c = e.src === 'c' ? COLLECTIONS[e.collection] : null;
      const head = el('h3', {}, c ? `${c.author} collection` : e.group,
        c?.subject ? el('small', {}, c.subject) : '',
        c ? el('a', { class: 'lic', href: c.licenceUrl, target: '_blank', rel: 'noopener', title: `${c.licence}: credit ${c.author}` }, c.licence) : '',
        el('small', { class: 'n' }, ''));
      g = { name: e.group, head, grid: el('div', { class: 'grid' }), tiles: [] };
      exGroups.push(g);
      body.push(head, g.grid);
    }
    const t = el('button', { type: 'button', class: 'tile', title: presetTitle(e), 'data-i': i }, presetThumb(e, 64), el('span', {}, e.name));
    t.addEventListener('click', () => {
      closeExamples();
      loadExample(i);
      if (L.mode === 'sheet' && L.snap === 'full') snapTo('half');
    });
    const x = { t, i, e, key: e.search };
    g.grid.append(t);
    g.tiles.push(x);
    exTiles.push(x);
  });
  const chip = (kind, val, label) => el('button', { type: 'button', class: 'chip', 'data-k': kind, 'data-v': val,
    onclick: () => { exFilter[kind] = val; filterExSheet(); $('exBody').scrollTop = 0; } }, label);
  const fams = FAMILIES.filter((f) => EXAMPLES.some((e) => e.family === f));
  $('exChips').replaceChildren(
    el('div', { class: 'chips' }, ...SOURCES.map(([v, l]) => chip('src', v, l)), el('span', { class: 'count', id: 'exCount' })),
    el('div', { class: 'chips' }, chip('family', 'all', 'Any family'), ...fams.map((f) => chip('family', f, f))));
  $('exBody').replaceChildren(...body, el('p', { class: 'empty', hidden: true }, 'No preset matches.'));
}

function filterExSheet() {
  const words = $('exSearch').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let any = 0;
  for (const g of exGroups) {
    let n = 0;
    for (const x of g.tiles) {
      const ok = (exFilter.src === 'all' || x.e.src === exFilter.src) && (exFilter.family === 'all' || x.e.family === exFilter.family)
        && words.every((w) => x.key.includes(w));
      x.t.hidden = !ok; n += ok;
    }
    g.head.hidden = g.grid.hidden = n === 0;
    g.head.querySelector('.n').textContent = `${n}`;
    any += n;
  }
  $('exChips').querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', exFilter[c.dataset.k] === c.dataset.v));
  $('exCount').textContent = `${any} of ${EXAMPLES.length}`;
  $('exBody').querySelector('.empty').hidden = any > 0;
}

export function openExamples() {
  if (!exTiles) buildExamples();
  for (const x of exTiles) x.t.classList.toggle('cur', x.i === currentExample);
  $('exSearch').value = '';
  filterExSheet();
  openSheet(exSheet);
  exTiles.find((x) => x.i === currentExample)?.t.scrollIntoView({ block: 'center' });
  if (matchMedia('(pointer: fine)').matches) $('exSearch').focus();
}

export function closeExamples() { closeSheet(exSheet); }

export function initPresetSheet() {
  $('exSearch').addEventListener('input', filterExSheet);
  $('exSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const x = exTiles.find((y) => !y.t.hidden); if (x) x.t.click(); }
    if (e.key === 'Escape') closeExamples();
  });
  $('exClose').addEventListener('click', closeExamples);
  $('exRandom').addEventListener('click', randomExample);
}
