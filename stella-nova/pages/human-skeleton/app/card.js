// ============================================================================
//  HUMAN SKELETON  ·  app/card.js — the bone card
// ────────────────────────────────────────────────────────────────────────────
//  showCard writes the card of the selected bone: number, region, name,
//  Latin name, type, side, length, FMA link, the bones it articulates
//  with, a fact, and the previous / isolate / zoom / next buttons. One
//  click listener on #card handles all the buttons.
//
//  GREP MAP
//    const card                                      the #card element
//    function cardNumber / zoomLabel                 card text
//    function showCard / hideCard                    open and close
//    card.addEventListener                           card buttons
// ============================================================================
import { $, COARSE, esc, TYPE_NAME, SIDE_NAME } from './env.js';
import { S, dirty, regionOf } from './state.js';
import { select, clearSelection, step } from './select.js';
import { isolate, exitIsolate, focusBone, focusRegion } from '../main.js';

export const card = $('card');
function cardNumber(b) {
  const counted = S.bones.filter(x => x.counted);
  const k = counted.indexOf(b);
  return k >= 0 ? `No. ${String(k + 1).padStart(3, '0')}` : b.type === 'tooth' ? 'Tooth' : 'Cartilage';
}
function zoomLabel(b) {
  if (/^hand/.test(b.region)) return 'Zoom to hand';
  if (/^foot/.test(b.region)) return 'Zoom to foot';
  if (b.region === 'skull' || b.region === 'teeth' || b.region === 'hyoid') return 'Zoom to skull';
  return 'Focus';
}
export function showCard() {
  const b = S.bones[S.sel];
  if (!b) return;
  const reg = regionOf(b);
  const arts = b.art.map(id => S.P.byId.get(id)).filter(Boolean);
  const artName = a => (a.side && a.side !== b.side ? `${SIDE_NAME[a.side]} ${a.name.toLowerCase()}` : a.name);
  card.innerHTML = `
    <div class="c-head"><div class="ttl">
      <div class="eyebrow"><span class="no">${cardNumber(b)}</span><span>${esc(reg.label)}${b.side ? ' · ' + SIDE_NAME[b.side] : ''}</span></div>
      <div class="c-name">${esc(b.side && /pelvis|thorax|skull|teeth|cartilage/.test(b.region) ? SIDE_NAME[b.side] + ' ' + b.name.toLowerCase() : b.name)}</div>
      <div class="c-lat">${esc(b.latin)}</div>
    </div><button class="c-x" type="button" aria-label="Close">✕</button></div>
    <div class="specs">
      <span class="k">Type</span><span class="v">${TYPE_NAME[b.type]}</span>
      <span class="k">Side</span><span class="v">${SIDE_NAME[b.side]}</span>
      <span class="k">Length</span><span class="v">${b.len >= 100 ? Math.round(b.len) : b.len.toFixed(1)} mm</span>
      <span class="k">FMA</span><span class="v">${b.fma ? `<a href="https://bioportal.bioontology.org/ontologies/FMA?p=classes&conceptid=http%3A%2F%2Fpurl.org%2Fsig%2Font%2Ffma%2Ffma${b.fma}" target="_blank" rel="noopener">${b.fma}</a>` : '—'}</span>
    </div>
    <div class="c-sub">${b.type === 'tooth' ? 'Set in' : b.type === 'cartilage' ? 'Joins' : 'Articulates with'}</div>
    <div class="nb">${arts.length ? arts.map(a => `<button type="button" data-i="${a.i}">${esc(artName(a))}</button>`).join('') : '<span class="none">No other bone: muscles and ligaments hold it.</span>'}</div>
    <p class="c-fact">${esc(b.fact)}</p>
    <div class="c-acts">
      <button type="button" data-act="prev" aria-label="Previous bone">‹</button>
      <button type="button" data-act="iso" class="${S.iso >= 0 ? 'on' : ''}">${S.iso >= 0 ? 'Show all' : 'Isolate'}</button>
      <button type="button" data-act="zoom">${zoomLabel(b)}</button>
      <button type="button" data-act="next" aria-label="Next bone">›</button>
    </div>
    <div class="c-foot"><span>${esc(reg.label)} · ${reg.count} ${reg.count === 1 ? 'piece' : 'pieces'}</span><span>${COARSE ? 'Drag it out' : 'Drag it out · ← → step'}</span></div>`;
  card.hidden = false;
  document.body.classList.add('has-card');
  card.scrollTop = 0;
}
export function hideCard() { card.hidden = true; document.body.classList.remove('has-card'); dirty(); }
card.addEventListener('click', e => {
  const x = e.target.closest('button');
  if (!x) return;
  if (x.classList.contains('c-x')) { if (S.iso >= 0) exitIsolate(true); clearSelection(); return; }
  if (x.dataset.i) { select(+x.dataset.i, { fly: S.iso < 0 }); return; }
  const act = x.dataset.act;
  if (act === 'prev') step(-1);
  else if (act === 'next') step(1);
  else if (act === 'iso') { if (S.iso >= 0) exitIsolate(true); else isolate(S.sel); }
  else if (act === 'zoom') {
    const b = S.bones[S.sel];
    if (/^(hand|foot)/.test(b.region)) focusRegion(b.region);
    else if (/skull|teeth|hyoid/.test(b.region)) focusRegion('skull');
    else focusBone(S.sel);
  }
});
