// ============================================================================
//  PROTEIN VIEWER  ·  app/select.js — select, clear and step the residue selection
// ────────────────────────────────────────────────────────────────────────────
//  A selection sets S.sel and S.hood, rebuilds the stick overlay, repaints,
//  and updates the card and the strip. The camera flies or pans to it.
//
//  GREP MAP
//    function select                       atom index to selection
//    function clearSelection               remove the selection
//    function stepResidue                  previous or next residue in the chain
// ============================================================================
import { S, anchorAtom } from './state.js';
import { rebuildOverlay } from './layers.js';
import { paint } from './paint.js';
import { neighbours } from './pick.js';
import { hideCard, showCard } from './card.js';
import { stripMark } from './strip.js';
import { ensureVisible, focusResidues } from './camera.js';

export function select(atom, opts = {}) {
  const s = S.s;
  if (!s || atom < 0) { clearSelection(); return; }
  const ri = s.atoms[atom].res;
  S.sel = { atom, res: ri };
  S.hood = neighbours(ri);
  rebuildOverlay();
  paint();
  showCard();
  stripMark(opts.scroll !== false);
  if (opts.fly) focusResidues([ri], 10);
  else if (opts.ensure !== false) setTimeout(() => ensureVisible(ri), 60);
}
export function clearSelection() {
  if (!S.sel) return;
  S.sel = null; S.hood = new Map();
  rebuildOverlay(); paint(); hideCard(); stripMark(false);
}
export function stepResidue(dir) {
  if (!S.sel) return;
  const s = S.s, r = s.residues[S.sel.res];
  const list = s.chains[r.chain].residues;
  let k = list.indexOf(r.index);
  for (k += dir; k >= 0 && k < list.length; k += dir) {
    const q = s.residues[list[k]];
    if (q.kind !== 'water') { select(anchorAtom(q), { fly: false }); return; }
  }
}
