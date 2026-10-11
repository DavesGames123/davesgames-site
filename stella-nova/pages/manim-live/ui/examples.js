// ============================================================================
//  EXAMPLES  ·  the examples browser panel
// ----------------------------------------------------------------------------
//  Reads examples/catalog.js (CATALOG). When it is absent, it shows the
//  seeds of ui/seed-examples.js. Filters: topic chips, level 1-3, search
//  (ui/catalog.js filterCatalog). A card shows title, level, summary and
//  the concept chips. A click on a card loads its code (fetched from
//  examples/<file>). A click on a concept chip opens the reference panel.
//
//  EXPORTS
//    mountExamples(root, {onOpen(entry, code), onConcept(name)}) -> api
//  api: ready (Promise), entries(), openById(id)
// ============================================================================
import { normalise, topicsOf, filterCatalog } from './catalog.js';
import { SEEDS } from './seed-examples.js';
import { escapeHtml } from './markdown.js';

const LEVELS = { 1: 'First day', 2: 'Next steps', 3: 'Advanced' };

export function mountExamples(root, { onOpen, onConcept }) {
  let all = [];
  let usingSeeds = false;
  const f = { topic: '', level: 0, query: '' };
  root.innerHTML = `
    <div class="ex-tools">
      <input type="search" class="ex-q" placeholder="Search examples, for example “graph” or “ValueTracker”" aria-label="Search examples">
      <div class="seg ex-level" role="group" aria-label="Level">
        <button data-lv="0" class="on">All</button><button data-lv="1">1</button><button data-lv="2">2</button><button data-lv="3">3</button>
      </div>
    </div>
    <div class="ex-topics" role="group" aria-label="Topic"></div>
    <p class="ex-note muted" hidden></p>
    <div class="ex-list" role="list"></div>`;
  const q = root.querySelector('.ex-q');
  const topicsEl = root.querySelector('.ex-topics');
  const listEl = root.querySelector('.ex-list');
  const note = root.querySelector('.ex-note');

  q.addEventListener('input', () => { f.query = q.value; draw(); });
  root.querySelector('.ex-level').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    f.level = +b.dataset.lv;
    root.querySelectorAll('.ex-level button').forEach(x => x.classList.toggle('on', x === b));
    draw();
  });
  topicsEl.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    f.topic = f.topic === b.dataset.topic ? '' : b.dataset.topic;
    drawTopics(); draw();
  });
  listEl.addEventListener('click', async e => {
    const chip = e.target.closest('.chip');
    if (chip) { e.stopPropagation(); onConcept(chip.dataset.name); return; }
    const card = e.target.closest('.ex-card'); if (!card) return;
    api.openById(card.dataset.id);
  });
  listEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList.contains('ex-card')) api.openById(e.target.dataset.id);
  });

  function drawTopics() {
    topicsEl.innerHTML = topicsOf(all).map(t =>
      `<button class="tp${t.topic === f.topic ? ' on' : ''}" data-topic="${escapeHtml(t.topic)}">${escapeHtml(t.topic)} <span>${t.count}</span></button>`).join('');
  }
  function draw() {
    const hits = filterCatalog(all, f);
    note.hidden = !usingSeeds;
    note.textContent = usingSeeds ? 'The full example library is not loaded, so these are the starter examples.' : '';
    listEl.innerHTML = hits.length ? hits.map(e => `
      <article class="ex-card" role="listitem" tabindex="0" data-id="${escapeHtml(e.id)}">
        <header><h3>${escapeHtml(e.title)}</h3><span class="lv lv${e.level}" title="${LEVELS[e.level]}">${'●'.repeat(e.level)}${'○'.repeat(3 - e.level)}</span></header>
        <p>${escapeHtml(e.summary)}</p>
        <footer><span class="ex-topic">${escapeHtml(e.topic)}</span>${e.concepts.slice(0, 6).map(c => `<button class="chip" data-name="${escapeHtml(c)}" title="Open ${escapeHtml(c)} in the reference">${escapeHtml(c)}</button>`).join('')}</footer>
      </article>`).join('') : '<p class="muted">No example matches. Clear the search or pick another topic.</p>';
  }

  const ready = (async () => {
    try {
      const mod = await import(new URL('../examples/catalog.js', import.meta.url).href);
      const list = (mod.CATALOG || mod.default || []).map(normalise);
      if (!list.length) throw new Error('empty');
      all = list;
    } catch {
      all = SEEDS.map(normalise);
      usingSeeds = true;
    }
    drawTopics(); draw();
    return all;
  })();

  const api = {
    ready,
    entries: () => all,
    async openById(id) {
      const e = all.find(x => x.id === id);
      if (!e) return false;
      let code = e.code;
      if (!code && e.file) {
        try {
          const r = await fetch(new URL(`../examples/${e.file.replace(/^examples\//, '')}`, import.meta.url));
          if (!r.ok) throw new Error(r.status);
          code = await r.text();
        } catch { code = null; }
      }
      if (!code) { note.hidden = false; note.textContent = `Could not load ${e.file}.`; return false; }
      onOpen(e, code);
      return true;
    },
  };
  return api;
}
