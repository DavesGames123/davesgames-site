// ============================================================================
//  LEO CATALOG  ·  view/search.js — the search box and quick tags
// ----------------------------------------------------------------------------
//  #search-input runs core/search.js 150 ms after the last key; Escape
//  clears it. Each .qtag button runs its data-q preset. A result click flies
//  the camera to the object and, on a phone, closes the left panel.
//
//  initSearch(ctx) wires it: ctx = { sats(), flyToSat(idx), isMobile }
//
//  grep -n targets: "export function initSearch", "function doSearch"
// ============================================================================
import { searchCatalog, searchResultsHTML } from '../core/search.js';

const searchInput   = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
let ctx = null;
let searchTimer = null;

// Search the catalog by name or NORAD id, rank stations and payloads first, and
// render clickable results that fly the camera to the chosen object.
function doSearch(query) {
  if (!searchResults) return;
  if (!query || !query.trim()) { searchResults.innerHTML = ''; return; }
  searchResults.innerHTML = searchResultsHTML(searchCatalog(ctx.sats(), query));
  searchResults.querySelectorAll('.search-result').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx, 10);
      if (!Number.isFinite(idx)) return;
      ctx.flyToSat(idx);
      if (ctx.isMobile) document.getElementById('leftpanel').classList.remove('open');
    });
  });
}

export function initSearch(c) {
  ctx = c;
  // Debounce typing before searching; Escape clears the box and results.
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => doSearch(searchInput.value), 150);
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { searchInput.value = ''; searchResults.innerHTML = ''; }
    });
  }
  // Quick-tag buttons run a preset search query.
  document.querySelectorAll('.qtag').forEach(b => {
    b.addEventListener('click', () => {
      if (!searchInput) return;
      searchInput.value = b.dataset.q;
      doSearch(b.dataset.q);
      searchInput.focus();
    });
  });
}
