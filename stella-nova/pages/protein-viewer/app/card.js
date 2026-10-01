// ============================================================================
//  PROTEIN VIEWER  ·  app/card.js — the residue card
// ────────────────────────────────────────────────────────────────────────────
//  The card shows the selected residue, its atom, its B-factor or pLDDT,
//  and the residues within 5 Å as buttons that select them.
//
//  GREP MAP
//    const SS_NAME                         secondary structure names
//    function showCard / hideCard          fill or hide #card
// ============================================================================
import { AA_NAME } from '../parse.js';
import { toHex, PLDDT } from '../colors.js';
import { $, PHONE_Q, esc } from './env.js';
import { S, anchorAtom, dirty, resLabel } from './state.js';
import { clearSelection, select, stepResidue } from './select.js';
import { focusSelection } from './camera.js';

const SS_NAME = { H: 'α-helix', G: '3₁₀-helix', E: 'β-strand', C: 'coil' };

// ── the card ──────────────────────────────────────────────────────────────
export const card = $('card');
export function showCard() {
  const s = S.s, sel = S.sel;
  if (!s || !sel) return hideCard();
  const a = s.atoms[sel.atom], r = s.residues[sel.res];
  const full = AA_NAME[r.name] || (r.kind === 'ligand' ? 'Ligand' : r.kind === 'ion' ? 'Ion' : r.kind === 'nucleic' ? 'Nucleotide' : r.name);
  const col = S.resColSRGB ? toHex([S.resColSRGB[3 * r.index], S.resColSRGB[3 * r.index + 1], S.resColSRGB[3 * r.index + 2]]) : '#ffd27a';
  const kind = r.kind === 'protein' ? 'protein' : r.kind;
  const ssTxt = r.kind === 'protein' ? SS_NAME[r.ss] || 'coil' : '';
  const bLabel = s.meta.af ? 'pLDDT' : 'B-factor';
  const bVal = s.meta.af ? `${a.b.toFixed(1)} · ${PLDDT.find(p => a.b > p.min || p.min < 0).label.split(' (')[0].toLowerCase()}` : `${a.b.toFixed(1)} Å²`;
  const nb = [...S.hood.entries()];
  const shown = nb.slice(0, PHONE_Q.matches ? 24 : 18);
  const chip = ([rj, d]) => {
    const q = s.residues[rj];
    const c = S.resColSRGB ? toHex([S.resColSRGB[3 * rj], S.resColSRGB[3 * rj + 1], S.resColSRGB[3 * rj + 2]]) : '#888';
    const ch = q.chain !== r.chain ? `${esc(q.chainId)}:` : '';
    return `<button type="button" data-r="${rj}"><i style="background:${c}"></i>${ch}${esc(resLabel(q))} <span style="color:var(--dim)">${d.toFixed(1)}</span></button>`;
  };
  card.innerHTML = `
    <div class="c-head"><div class="ttl">
      <div class="eyebrow" style="--gc:${col}"><i></i>Chain ${esc(r.chainId)} · ${esc(kind)}${ssTxt ? ' · ' + ssTxt : ''}</div>
      <div class="c-name">${esc(resLabel(r))}<small>${esc(full)}</small></div>
    </div><button class="c-x" type="button" data-act="close" aria-label="Clear selection">✕</button></div>
    <div class="specs">
      <span class="k">Atom</span><span class="v">${esc(a.name)} · ${esc(a.el)}</span>
      <span class="k">${bLabel}</span><span class="v">${bVal}</span>
      <span class="k">Occupancy</span><span class="v">${a.occ.toFixed(2)}</span>
      <span class="k">Atoms</span><span class="v">${r.atoms.length}</span>
    </div>
    <div class="c-sub">Within 5 Å · ${nb.length} residue${nb.length === 1 ? '' : 's'}</div>
    <div class="nb">${shown.map(chip).join('')}${nb.length > shown.length ? `<span class="more">+${nb.length - shown.length} more</span>` : ''}${nb.length ? '' : '<span class="more">none</span>'}</div>
    <div class="c-acts"><button type="button" data-act="prev" aria-label="Previous residue">‹</button><button type="button" data-act="focus">Focus</button><button type="button" data-act="next" aria-label="Next residue">›</button></div>`;
  card.hidden = false;
  document.body.classList.add('has-card');
  dirty();
}
export function hideCard() { card.hidden = true; document.body.classList.remove('has-card'); dirty(); }
card.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.r !== undefined) { select(anchorAtom(S.s.residues[+b.dataset.r]), { fly: true }); return; }
  const act = b.dataset.act;
  if (act === 'close') clearSelection();
  else if (act === 'prev') stepResidue(-1);
  else if (act === 'next') stepResidue(1);
  else if (act === 'focus') focusSelection();
});
