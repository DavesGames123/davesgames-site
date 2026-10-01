// ============================================================================
//  PROTEIN VIEWER  ·  app/strip.js — the sequence strip
// ────────────────────────────────────────────────────────────────────────────
//  One cell per polymer residue, by chain, then one cell per het group.
//  A tap selects the residue. A mouse hover lights it in the 3D view.
//
//  GREP MAP
//    function buildStrip / stripColors     cells and their colours
//    function stripMark                    mark the selection and the 5 Å set
//    function markHoverCell                mark the hover residue
// ============================================================================
import { residueColors, toHex } from '../colors.js';
import { $, HOVER, REDUCED, esc } from './env.js';
import { ADDITIVES, S, anchorAtom, isPolymer } from './state.js';
import { paint } from './paint.js';
import { select } from './select.js';
import { addMeasureAtom } from './measure.js';

// ── sequence strip ────────────────────────────────────────────────────────
const seq = $('seq');
export function buildStrip() {
  const s = S.s;
  let html = '';
  s.chains.forEach((ch, ci) => {
    const pol = ch.residues.filter(i => isPolymer(s.residues[i]));
    if (!pol.length) return;
    html += `<div class="chn" data-c="${ci}"><span class="chl">${esc(ch.id)}</span>`;
    let last = null;
    for (const ri of pol) {
      const r = s.residues[ri];
      const ssc = r.ss === 'H' || r.ss === 'G' ? ' h' : r.ss === 'E' ? ' e' : '';
      const n = r.seq % 10 === 0 || last === null ? ` data-n="${r.seq}"` : '';
      html += `<span class="aa${ssc}" data-r="${ri}"${n}>${r.code || 'X'}</span>`;
      last = r;
    }
    html += '</div>';
  });
  const het = s.residues.filter(r => r.kind === 'ligand' && !ADDITIVES.has(r.name));
  if (het.length) {
    html += '<div class="chn het"><span class="chl">Het</span>';
    const seen = new Set();
    for (const r of het) {
      const k = r.name + r.chainId;
      if (seen.has(k) || seen.size >= 40) continue;
      seen.add(k);
      html += `<span class="aa lig" data-r="${r.index}" style="width:auto;padding:0 4px">${esc(r.name)}</span>`;
    }
    html += '</div>';
  }
  seq.innerHTML = html;
  S.cells = new Map();
  seq.querySelectorAll('.aa').forEach(el => S.cells.set(+el.dataset.r, el));
  stripColors();
  seq.scrollLeft = 0;
}
export function stripColors() {
  const s = S.s;
  const col = residueColors(s, S.color);
  for (const [ri, el] of S.cells) {
    el.style.setProperty('--c', toHex([col[3 * ri], col[3 * ri + 1], col[3 * ri + 2]]));
    el.classList.toggle('off', !S.chainOn[s.residues[ri].chain]);
  }
}
let markedCells = [];
export function stripMark(scroll) {
  for (const el of markedCells) el.classList.remove('sel', 'hood');
  markedCells = [];
  if (!S.sel) return;
  const el = S.cells.get(S.sel.res);
  if (el) { el.classList.add('sel'); markedCells.push(el); }
  for (const ri of S.hood.keys()) { const c = S.cells.get(ri); if (c) { c.classList.add('hood'); markedCells.push(c); } }
  if (el && scroll) {
    const sr = seq.getBoundingClientRect(), er = el.getBoundingClientRect();
    if (er.left < sr.left + 40 || er.right > sr.right - 20) seq.scrollTo({ left: seq.scrollLeft + (er.left - sr.left) - sr.width / 2, behavior: REDUCED ? 'auto' : 'smooth' });
  }
}
let seqDown = null;
seq.addEventListener('pointerdown', e => { seqDown = { x: e.clientX, y: e.clientY, sl: seq.scrollLeft }; });
seq.addEventListener('pointerup', e => {
  if (!seqDown) return;
  const moved = Math.abs(e.clientX - seqDown.x) + Math.abs(seq.scrollLeft - seqDown.sl);
  seqDown = null;
  if (moved > 8) return;
  const el = e.target.closest('.aa');
  if (!el) return;
  const r = S.s.residues[+el.dataset.r];
  if (S.measure) { addMeasureAtom(anchorAtom(r)); return; }
  select(anchorAtom(r), { fly: true, scroll: false });
});
seq.addEventListener('pointercancel', () => { seqDown = null; });
seq.addEventListener('wheel', e => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { seq.scrollLeft += e.deltaY; e.preventDefault(); }
}, { passive: false });
if (HOVER) {
  seq.addEventListener('pointerover', e => {
    const el = e.target.closest('.aa');
    const ri = el ? +el.dataset.r : -1;
    if (ri !== S.hoverRes) { S.hoverRes = ri; paint(); }
  });
  seq.addEventListener('pointerleave', () => { if (S.hoverRes >= 0) { S.hoverRes = -1; paint(); } });
}

let hovCell = null;
export function markHoverCell() {
  if (hovCell) hovCell.classList.remove('hov');
  hovCell = S.hoverRes >= 0 ? S.cells.get(S.hoverRes) : null;
  if (hovCell) hovCell.classList.add('hov');
}
