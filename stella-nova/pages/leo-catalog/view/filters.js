// ============================================================================
//  LEO CATALOG  ·  view/filters.js — class filters, highlight, overlay boxes
// ----------------------------------------------------------------------------
//  The left-panel rows:
//    .filter-row[data-cat]      the checkbox sets FILTER[cat]. A row click
//                               locks or unlocks the class highlight; a
//                               hover previews it while nothing is locked.
//                               highlightCat (a live export) is the class
//                               that view/sat-cloud.js keeps bright.
//    .filter-row[data-overlay]  the checkbox sets OVERLAY[key] and clears the
//                               layer at once when it goes off
//    #cnt-<class>, #stat-count, #acq-count   per-class and total counters,
//                               tweened; a changed row bumps (updateCounts)
//
//  grep -n targets: "export let highlightCat", "export function initFilters",
//  "export function updateCounts"
// ============================================================================
import { tweenNumber, retrigger, acqCountEl } from './boot-ui.js';
import { hideCityLabels, clearSatLabels } from './labels.js';
import { maybeRebuildTrail } from './trails.js';
import { setWeatherVisible } from './weather.js';

// Category filter rows: the checkbox toggles visibility; clicking the row locks
// or unlocks a highlight, and hovering previews it while nothing is locked.
export let highlightCat = null;
let lockedHighlight = null;
export function initFilters({ FILTER, OVERLAY }) {
  document.querySelectorAll('.filter-row[data-cat]').forEach(row => {
    const cat = row.dataset.cat;
    const cb = row.querySelector('input[type=checkbox]');
    cb.addEventListener('change', () => { FILTER[cat] = cb.checked; });
    cb.addEventListener('click', (e) => e.stopPropagation());
    row.addEventListener('click', (e) => {
      if (e.target.matches('input')) return;
      if (lockedHighlight === cat) {
        lockedHighlight = null;
        highlightCat = null;
      } else {
        lockedHighlight = cat;
        highlightCat = cat;
      }
      document.querySelectorAll('.filter-row[data-cat]').forEach(r => {
        r.classList.toggle('locked', r.dataset.cat === lockedHighlight);
      });
    });
    row.addEventListener('pointerenter', () => {
      if (!lockedHighlight) highlightCat = cat;
    });
    row.addEventListener('pointerleave', () => {
      if (!lockedHighlight) highlightCat = null;
    });
  });
  // Overlay checkboxes: toggle each optional layer and do any layer-specific
  // cleanup when it is switched off.
  document.querySelectorAll('.filter-row[data-overlay]').forEach(row => {
    const k = row.dataset.overlay;
    const cb = row.querySelector('input[type=checkbox]');
    cb.addEventListener('change', () => {
      OVERLAY[k] = cb.checked;
      if (k === 'weather') setWeatherVisible(cb.checked);
      if (k === 'cities' && !cb.checked) hideCityLabels();
      if (k === 'trails') maybeRebuildTrail();
      if (k === 'satlabels' && !cb.checked) clearSatLabels();
    });
  });
}

// Recount objects per category and update the panel counters.
export function updateCounts(sats) {
  const c = {starlink:0, payload:0, station:0, rocket:0, debris:0, storm:0};
  for (const s of sats) c[s.cat]++;
  for (const k of Object.keys(c)) {
    const el = document.getElementById('cnt-'+k);
    if (!el) continue;
    if (el.textContent !== c[k].toLocaleString()) retrigger(el.closest('.filter-row'), 'bump');
    tweenNumber(el, c[k]);
  }
  tweenNumber(document.getElementById('stat-count'), sats.length);
  tweenNumber(acqCountEl, sats.length);
}
