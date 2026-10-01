// app/libpanel.js -- the preset library panel (app.rs draw_library).
//
// One panel, no scrim. A filter field and source chips sit over the sections.
// Each tile carries a diagram thumbnail drawn from thumbs.json, which
// tools/build-library.mjs bakes from the crease patterns themselves, so the
// library never fetches the pattern files to draw itself.
//
// grep map:
//   buildLibrary    -- the tiles, the chips and the filter field, once at boot
//   toggleLibSource -- pick or clear a source chip
//   filterLibrary   -- show the tiles that match the words and the source
//   fillThumbs      -- fetch thumbs.json and draw every tile, once

import * as patterns from '../patterns.js';
import { S, $ } from './state.js';
import { syncUI } from './readouts.js';

let libSource = '';
let thumbs = null, thumbsLoading = false;

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function buildLibrary() {
  const srcs = Object.entries(patterns.SOURCES).filter(([k]) => patterns.ALL.some((p) => p.src === k));
  const chips = srcs.map(([k, s]) => `<button class="src-chip" data-act="libsrc:${k}" data-src="${k}">${esc(s.chip)}</button>`).join('');
  const groups = patterns.GROUPS.map((g) => `<section class="lib-sec" data-sec="${g.id}"><div class="lib-cat">${esc(g.name)}<span class="n">${g.list.length}</span></div><div class="lib-grid">` +
    g.list.map((p) => {
      const s = patterns.SOURCES[p.src];
      const q = [p.label, g.name, p.author || '', s.name, s.chip, p.note || ''].join(' ').toLowerCase();
      const title = `${p.label} · ${s.name}${p.author ? ' · ' + p.author : ''}`;
      return `<button class="lib-tile" data-act="preset:${p.id}" data-id="${p.id}" data-src="${p.src}" data-q="${esc(q)}" title="${esc(title)}">` +
        `<svg viewBox="0 0 100 100" aria-hidden="true"></svg><span class="nm">${esc(p.label)}</span><span class="tag" data-src="${p.src}">${esc(s.chip)}</span></button>`;
    }).join('') + '</div></section>').join('');
  $('libBody').innerHTML = groups + '<p class="lib-none" hidden>No pattern matches.</p>';
  $('libSrc').innerHTML = chips;
  $('libFilter').placeholder = `Filter ${patterns.ALL.length} patterns`;
  $('libFilter').addEventListener('input', filterLibrary);
  $('libFilter').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); if (e.target.value) { e.target.value = ''; filterLibrary(); } else { S.libraryOpen = false; syncUI(); } }
    if (e.key === 'Enter') { const t = document.querySelector('#libBody .lib-tile:not([hidden])'); if (t) t.click(); }
  });
  filterLibrary();
}

// Pick a source chip, or clear it when it is the one already picked.
export function toggleLibSource(src) { libSource = libSource === src ? '' : src; filterLibrary(); }

// Show the tiles whose text holds every word of the filter, from the chosen
// source. A section with no tile left is hidden.
export function filterLibrary() {
  const words = $('libFilter').value.toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;
  document.querySelectorAll('#libBody .lib-sec').forEach((sec) => {
    let n = 0;
    sec.querySelectorAll('.lib-tile').forEach((t) => {
      const ok = (!libSource || t.dataset.src === libSource) && words.every((w) => t.dataset.q.includes(w));
      t.hidden = !ok;
      if (ok) n++;
    });
    sec.hidden = n === 0;
    sec.querySelector('.n').textContent = n;
    shown += n;
  });
  document.querySelector('#libBody .lib-none').hidden = shown > 0;
  document.querySelectorAll('.src-chip').forEach((c) => c.classList.toggle('on', c.dataset.src === libSource));
  $('libCount').textContent = shown === patterns.ALL.length ? `${shown}` : `${shown} / ${patterns.ALL.length}`;
}

// Draw every tile thumbnail, once, the first time the library opens.
export function fillThumbs() {
  if (thumbs || thumbsLoading) return;
  thumbsLoading = true;
  fetch(new URL('../thumbs.json', import.meta.url)).then((r) => r.json()).then((t) => {
    thumbs = t;
    document.querySelectorAll('.lib-tile').forEach((el) => {
      const d = thumbs[el.dataset.id];
      if (!d) return;
      el.querySelector('svg').innerHTML = ['f', 'b', 'v', 'm'].filter((k) => d[k]).map((k) => `<path class="${k}" d="${d[k]}"/>`).join('');
    });
  }).catch((err) => { thumbsLoading = false; console.warn('[origami] thumbnails:', err.message); });
}
