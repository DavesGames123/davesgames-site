// ============================================================================
//  MOLECULES  ·  browse.js — the library: load, search, browser, thumbnails
// ────────────────────────────────────────────────────────────────────────────
//  loadLibrary() fetches data/library.json once (the live site gzips it in
//  transit; response.json() reads the whole body, so no buffer is sized
//  from content-length). Records stay as records; decode() runs when a
//  molecule shows, and the result is cached.
//
//  search(q, n)   ranked hits by name, synonym, formula, CID or IUPAC name
//  isomers(rec)   other records with the same molecular formula
//  thumb(rec)     the small 2D SVG for a card (cached)
//  Browser        the full-screen library: category chips, a filter, and
//                 cards whose thumbnails draw when they scroll into view
//
//  grep -n targets: "export async function loadLibrary", "export function
//  search", "export class Browser", "function card"
// ============================================================================
import { decode, CATEGORIES, CAT_NAME, formulaHTML } from './chem.js';
import { render2D } from './draw2d.js';

export const LIB = { recs: [], byId: new Map(), models: new Map() };

export async function loadLibrary(url = new URL('data/library.json', import.meta.url)) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('library ' + r.status);
  const j = await r.json();
  LIB.recs = j.m;
  LIB.byId = new Map(j.m.map(x => [x.id, x]));
  // search keys, lower case, once
  for (const x of j.m) {
    x._k = [x.n, ...(x.sy || [])].map(s => s.toLowerCase());
    x._f = (x.f || '').toLowerCase();
  }
  return LIB;
}
export function addRecord(rec) {
  if (!LIB.byId.has(rec.id)) { LIB.recs.push(rec); rec._k = [rec.n, ...(rec.sy || [])].map(s => s.toLowerCase()); rec._f = (rec.f || '').toLowerCase(); }
  LIB.byId.set(rec.id, rec); LIB.models.delete(rec.id);
}
export function model(rec) {
  if (!LIB.models.has(rec.id)) LIB.models.set(rec.id, decode(rec));
  return LIB.models.get(rec.id);
}

const norm = s => s.toLowerCase().replace(/[\s,()\-–'’]+/g, '');
export function search(q, n = 30) {
  q = q.trim().toLowerCase(); if (!q) return [];
  const qn = norm(q), isF = /^([a-z][a-z]?\d*)+$/i.test(q.replace(/\s/g, '')) && /\d/.test(q);
  const hits = [];
  for (const x of LIB.recs) {
    let s = 0;
    const name = x._k[0];
    if (name === q) s = 100;
    else if (name.startsWith(q)) s = 80 - name.length * 0.1;
    else if (norm(name).startsWith(qn)) s = 70 - name.length * 0.1;
    else if (name.includes(q)) s = 55 - name.indexOf(q) * 0.2;
    for (let i = 1; i < x._k.length && s < 60; i++) {
      const k = x._k[i];
      if (k === q) s = Math.max(s, 75); else if (k.startsWith(q)) s = Math.max(s, 52); else if (k.includes(q) && q.length > 2) s = Math.max(s, 35);
    }
    if (isF && x._f === q.replace(/\s/g, '')) s = Math.max(s, 90);
    else if (isF && x._f.startsWith(q.replace(/\s/g, ''))) s = Math.max(s, 40);
    if (/^\d+$/.test(q) && String(x.cid) === q) s = 95;
    if (!s && q.length > 3 && (x.iu || '').toLowerCase().includes(q)) s = 20;
    if (!s && q.length > 3 && (x.d || '').toLowerCase().includes(q)) s = 10;
    if (s) hits.push([s + (x.fam ? 3 : 0), x]);
  }
  hits.sort((a, b) => b[0] - a[0]);
  return hits.slice(0, n).map(h => h[1]);
}
export function isomers(rec) { return LIB.recs.filter(x => x !== rec && x.f && x.f === rec.f); }

const THUMBS = new Map();
export function thumb(rec) {
  if (!THUMBS.has(rec.id)) {
    try { THUMBS.set(rec.id, render2D(model(rec), { lw: 1.7, pad: 0.45, minW: 5.5, minH: 3.6 }).svg); }
    catch (e) { THUMBS.set(rec.id, ''); }
  }
  return THUMBS.get(rec.id);
}

export class Browser {
  constructor(root, onPick) {
    this.root = root; this.onPick = onPick;
    this.grid = root.querySelector('#bwGrid'); this.cats = root.querySelector('#bwCats');
    this.q = root.querySelector('#bwq'); this.count = root.querySelector('#bwCount');
    this.cat = 'all';
    this.io = new IntersectionObserver(es => {
      for (const e of es) if (e.isIntersecting) { const th = e.target; th.innerHTML = thumb(LIB.byId.get(th.dataset.id)); this.io.unobserve(th); }
    }, { root: this.grid, rootMargin: '300px' });
    this.q.addEventListener('input', () => this.build());
    this.grid.addEventListener('click', e => { const c = e.target.closest('.card'); if (c) this.onPick(LIB.byId.get(c.dataset.id)); });
  }
  open(cat) {
    if (cat) this.cat = cat;
    this.root.hidden = false;
    this.buildCats(); this.build();
  }
  close() { this.root.hidden = true; }
  get isOpen() { return !this.root.hidden; }
  buildCats() {
    const counts = {}; for (const x of LIB.recs) { counts[x.c] = (counts[x.c] || 0) + 1; if (x.fam) counts.famous = (counts.famous || 0) + 1; }
    this.cats.innerHTML = `<button type="button" data-c="all" class="${this.cat === 'all' ? 'on' : ''}">All ${LIB.recs.length}</button>` +
      CATEGORIES.filter(([id]) => counts[id]).map(([id, name]) => `<button type="button" data-c="${id}" class="${this.cat === id ? 'on' : ''}">${name} ${counts[id]}</button>`).join('');
    this.cats.onclick = e => { const b = e.target.closest('button'); if (!b) return; this.cat = b.dataset.c; this.buildCats(); this.build(); this.grid.scrollTop = 0; };
  }
  build() {
    this.io.disconnect();
    const f = this.q.value.trim();
    let list = f ? search(f, 400) : LIB.recs;
    const inCat = (x, c) => c === 'famous' ? x.fam : x.c === c;
    if (this.cat !== 'all') list = list.filter(x => inCat(x, this.cat));
    this.count.textContent = `${list.length} of ${LIB.recs.length} molecules`;
    const sections = [];
    if (f || this.cat !== 'all') sections.push([this.cat === 'all' ? 'Matches' : CAT_NAME[this.cat], list]);
    else for (const [id, name] of CATEGORIES) { const l = list.filter(x => inCat(x, id)); if (l.length) sections.push([name, l]); }
    this.grid.innerHTML = sections.map(([name, l]) => `<div class="bw-sec">${name}<small>${l.length}</small></div><div class="bw-cards">${l.map(card).join('')}</div>`).join('');
    for (const th of this.grid.querySelectorAll('.th')) this.io.observe(th);
  }
}
function card(x) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return `<button type="button" class="card" data-id="${x.id}" title="${esc(x.d)}"><div class="th" data-id="${x.id}"></div><b>${esc(x.n)}</b><small>${formulaHTML(x.f)}</small></button>`;
}
