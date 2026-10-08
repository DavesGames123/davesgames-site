// ============================================================================
//  MAP PROJECTIONS  ·  gallery.js — the projection picker with live thumbnails
// ----------------------------------------------------------------------------
//  One button per projection: a small canvas drawn by MapView (110m land,
//  no borders) with the current centre longitude, the name and the
//  property colour. Filters by family and by property. Thumbnails draw in
//  idle slices (about 8 ms each), so the page stays responsive, and again
//  when the centre longitude changes (after 250 ms of rest).
//
//  GREP MAP
//    grep -n 'export function buildGallery'   markup, filters, events
//    grep -n 'function drawThumbs'            the idle-slice painter
// ============================================================================
import { PROJ, HOME } from './proj.js';
import { MapView } from './render.js';
import { FAMILY, PROPS } from './cards.js';

export function buildGallery(root, data, onPick) {
  const filt = { family: 'all', prop: 'all' };
  const chip = (k, v, label, cls = '') => `<button type="button" class="chip ${cls}" data-${k}="${v}">${label}</button>`;
  root.innerHTML = `
    <div class="filters" role="group" aria-label="Filter by family">${chip('family', 'all', 'All families', 'on')}${Object.entries(FAMILY).map(([k, f]) => chip('family', k, f.name)).join('')}</div>
    <div class="filters" role="group" aria-label="Filter by property">${chip('prop', 'all', 'Any property', 'on')}${Object.entries(PROPS).map(([k, p]) => chip('prop', k, `<i class="dot ${p.cls}"></i>${p.name}`)).join('')}</div>
    <p class="fam-note" id="famNote"></p>
    <div class="grid">${PROJ.map(p => `
      <button type="button" class="thumb" data-key="${p.key}" title="${p.name}">
        <canvas width="10" height="10" aria-hidden="true"></canvas>
        <span class="tn">${p.short || p.name}</span>
        <span class="tp"><i class="dot ${PROPS[p.prop].cls}"></i>${PROPS[p.prop].name}</span>
      </button>`).join('')}</div>`;
  const thumbs = [...root.querySelectorAll('.thumb')];
  const views = new Map();
  for (const t of thumbs) {
    t.addEventListener('pointerdown', e => e.preventDefault());   // no text selection on a drag
    t.addEventListener('click', () => onPick(t.dataset.key));
    t.querySelector('canvas').draggable = false;
  }
  root.querySelectorAll('.filters').forEach(g => g.addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    const k = 'family' in b.dataset ? 'family' : 'prop';
    filt[k] = b.dataset[k];
    g.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b));
    apply();
  }));
  root.querySelectorAll('.filters').forEach(g => g.addEventListener('pointerdown', e => e.preventDefault()));
  function apply() {
    for (const t of thumbs) {
      const p = PROJ.find(q => q.key === t.dataset.key);
      t.hidden = !((filt.family === 'all' || p.family === filt.family) && (filt.prop === 'all' || p.prop === filt.prop));
    }
    const fn = root.querySelector('#famNote');
    fn.textContent = filt.family !== 'all' ? FAMILY[filt.family].note : filt.prop !== 'all' ? `${PROPS[filt.prop].name}: ${PROPS[filt.prop].note}.` : '';
    fn.hidden = !fn.textContent;
    drawThumbs();
  }
  let lon = 0, job = 0, drawn = new Map();
  function drawThumbs() {
    const my = ++job;
    const todo = thumbs.filter(t => !t.hidden && drawn.get(t.dataset.key) !== lon);
    const step = () => {
      if (my !== job) return;
      const t0 = performance.now();
      while (todo.length && performance.now() - t0 < 8) {
        const t = todo.shift(), key = t.dataset.key, cv = t.querySelector('canvas');
        const r = cv.getBoundingClientRect(); if (r.width < 4) { continue; }
        let v = views.get(key);
        if (!v) { v = new MapView(cv, data); v.opts = { borders: false, graticule: true }; v.grat = v.grat.filter((_, i) => i % 2 === 0); views.set(key, v); }
        v.resize(r.width, r.height, Math.min(2, window.devicePixelRatio || 1));
        v.setBox({ x: 0, y: 0, w: r.width, h: r.height });
        const h = HOME[key] || {};
        const st = Object.assign({ key }, h);
        if (!['albers', 'lambert-conformal', 'equidistant-conic', 'bonne', 'transverse-mercator'].includes(key) && h.aspect !== 'normal') st.lon = (h.lon ?? 0) + lon;
        v.setState(st);
        v.draw('fast', { bg: 'transparent' });
        drawn.set(key, lon);
      }
      if (todo.length) (window.requestIdleCallback || setTimeout)(step, { timeout: 60 });
    };
    step();
  }
  let rest = 0;
  return {
    setActive(key) { thumbs.forEach(t => t.classList.toggle('on', t.dataset.key === key)); },
    setLon(l) { const r = Math.round(l / 5) * 5; if (r === lon) return; clearTimeout(rest); rest = setTimeout(() => { lon = r; drawThumbs(); }, 250); },
    redraw() { drawn.clear(); drawThumbs(); },
    apply,
  };
}
