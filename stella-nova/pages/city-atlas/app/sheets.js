// ============================================================================
//  SHEETS  ·  city-atlas/app/sheets.js — the about sheet, the atlas, the scrim
// ----------------------------------------------------------------------------
//  The three sheets: the about sheet (caption), the atlas (city menu with
//  thumbnails, grouped by region) and the overlay settings drawer (layers;
//  its content is app/drawer.js). One sheet at a time on a phone; the scrim
//  covers the map while a sheet is modal. A sheet closes when its grip is
//  dragged down more than 70 px.
//
//  grep -n targets
//    about sheet .......... "export function setCaption"
//    atlas thumbnail ...... "function thumbFor"
//    atlas grid ........... "function buildAtlas"
//    atlas current city ... "export function markAtlas"
//    atlas open/close ..... "export function setAtlas"
//    drawer open/close .... "export function setLayers"
//    scrim ................ "export function syncScrim"
//    grip drag ............ "export function bindSheetDrag"
// ============================================================================

import { S, pageUrl } from './state.js';
import { $, el, device, captionEl, atlasEl, layersEl, scrim } from './dom.js';
import { esc, fmt, latLon } from './text.js';
import { captionHTML } from './sources.js';
import { forgetBoxes } from './foot.js';
import { syncLayers } from './drawer.js';
import { switchTo } from './switch.js';

export function setCaption(open) {
  if (open) { setAtlas(false); if (device().phone) setLayers(false); }
  captionEl.hidden = !open;
  $('info').setAttribute('aria-pressed', String(open));
  const meta = S.meta;
  if (open && meta) {
    $('capTitle').innerHTML = `${esc(meta.title)}<small>${esc(meta.country)} · ${latLon(meta, 3)}</small>`;
    $('capBody').innerHTML = captionHTML(meta);
  }
  syncScrim();
}

function thumbFor(c) {
  const img = el('img', 'a-thumb');
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.onerror = () => img.replaceWith(el('div', 'a-thumb none'));
  img.src = pageUrl(`data/thumbs/${c.id}.webp`).href;
  return img;
}

let atlasBuilt = false;
function buildAtlas() {
  const body = $('atlasBody');
  $('atlasCount').textContent = `${S.cities.length} cities`;
  const groups = new Map();
  S.cities.forEach((c, i) => {
    if (!groups.has(c.region)) groups.set(c.region, []);
    groups.get(c.region).push({ ...c, i });
  });
  body.textContent = '';
  for (const [region, items] of groups) {
    const sec = el('section', 'a-group');
    sec.appendChild(el('h3', null, `${esc(region)}<small>${items.length}</small>`));
    const grid = el('div', 'a-grid');
    for (const it of items) {
      const b = el('button', 'a-item');
      b.type = 'button';
      b.dataset.index = String(it.i);
      b.appendChild(thumbFor(it));
      const cap = el('span', 'a-cap');
      cap.append(el('span', 'a-title', esc(it.title)), el('span', 'a-model', esc(`${it.country} · ${fmt(it.buildings)} buildings`)));
      b.appendChild(cap);
      b.addEventListener('click', () => { setAtlas(false); if (it.i !== S.locIndex) switchTo(it.i); });
      grid.appendChild(b);
    }
    sec.appendChild(grid);
    body.appendChild(sec);
  }
  atlasBuilt = true;
  markAtlas();
}
// Before the atlas is built it has no items, so this does nothing.
export function markAtlas() {
  for (const b of atlasEl.querySelectorAll('.a-item')) b.setAttribute('aria-current', String(+b.dataset.index === S.locIndex));
}
export function setAtlas(open) {
  if (open) { setCaption(false); if (device().phone) setLayers(false); }
  atlasEl.hidden = !open;
  $('where').setAttribute('aria-expanded', String(open));
  if (open) {
    if (!atlasBuilt) buildAtlas(); else markAtlas();
    requestAnimationFrame(() => atlasEl.querySelector('.a-item[aria-current="true"]')?.scrollIntoView({ block: 'nearest' }));
  }
  syncScrim();
}
export function setLayers(open) {
  if (open && device().phone) { setCaption(false); setAtlas(false); }
  layersEl.hidden = !open;
  $('layersBtn').setAttribute('aria-expanded', String(open));
  if (open) syncLayers();
  syncScrim();
}
export function syncScrim() {
  forgetBoxes();
  const phone = document.body.classList.contains('phone');
  scrim.hidden = atlasEl.hidden && (captionEl.hidden || !phone) && (layersEl.hidden || !phone);
}

export function bindSheetDrag(sheet, grip, close) {
  let y0 = null;
  grip.addEventListener('pointerdown', (e) => { y0 = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch { /* */ } });
  grip.addEventListener('pointermove', (e) => { if (y0 != null) sheet.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`; });
  const end = (e) => {
    if (y0 == null) return;
    const dy = e.clientY - y0;
    y0 = null;
    sheet.style.transform = '';
    if (dy > 70) close();
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}
