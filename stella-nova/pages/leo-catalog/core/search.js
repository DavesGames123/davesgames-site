// ============================================================================
//  LEO CATALOG  ·  core/search.js — catalog search by name or NORAD id
// ----------------------------------------------------------------------------
//  Pure: records in, matches and HTML out. view/search.js runs it on input.
//    match   case-free substring of the name, or a substring of the NORAD id;
//            the first SEARCH_MAX matches in catalog order
//    order   stations, payloads, Starlink, rocket bodies, debris, storms
//            (a stable sort, so catalog order holds inside a class)
//
//  grep -n targets: "export const SEARCH_MAX", "export function searchCatalog",
//  "export function searchResultsHTML"
// ============================================================================
import { escHtml } from './format.js';

export const SEARCH_MAX = 100;
const RANK = { station: 0, starlink: 2, payload: 1, rocket: 3, debris: 4, storm: 5 };

// The matches for a query, as { idx, name, cat }. A blank query gives [].
export function searchCatalog(sats, query) {
  if (!query || !query.trim()) return [];
  const q = query.toUpperCase().trim();
  const matches = [];
  for (let i = 0; i < sats.length && matches.length < SEARCH_MAX; i++) {
    const s = sats[i];
    if (s.name.toUpperCase().includes(q) || (s.noradId && String(s.noradId).includes(q))) {
      matches.push({ idx: i, name: s.name, cat: s.cat });
    }
  }
  return matches.sort((a, b) => (RANK[a.cat] ?? 9) - (RANK[b.cat] ?? 9));
}

// The result list; each row carries its catalog index in data-idx.
export function searchResultsHTML(matches) {
  if (matches.length === 0) return `<div class="search-empty">no matches</div>`;
  return matches.map(m =>
    `<div class="search-result" data-idx="${m.idx}">
      <span class="sr-name">${escHtml(m.name)}</span>
      <span class="sr-cat">${escHtml(m.cat)}</span>
    </div>`).join('');
}
