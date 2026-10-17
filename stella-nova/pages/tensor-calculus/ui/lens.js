// ============================================================================
//  TENSOR CALCULUS  ·  ui/lens.js  ·  the Indices lens  (CORE)
// ----------------------------------------------------------------------------
//  The lens is a row of chips, one for each index letter of the expression
//  on screen, each in its palette colour. A tap on a chip, on an index in
//  the TeX, on a diagram leg or on a 3D glyph calls tensorPage.pickIndex,
//  and every view highlights that letter. A second tap on the same letter
//  clears the lens.
//
//  symLabel() gives the Unicode letter for a TeX name, for HTML labels
//  (chips, the step list, the index line under the equation).
//
//  EXPORTS   (grep -n "export" ui/lens.js)
//      GREEK_CHAR, symLabel(sym), renderLens(host, syms, picked, onPick),
//      symsFromSlot(slot) -> the active syms that use that slot
// ============================================================================
import { indexClass, indexSlot, activeSyms, norm } from '../palette.js';

export const GREEK_CHAR = Object.freeze({
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', tau: 'τ',
  upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
});

export function symLabel(sym) {
  const raw = String(sym || '');
  const primes = (/['′]+$/.exec(raw) || [''])[0].replace(/'/g, '′');
  const s = norm(raw);
  return (GREEK_CHAR[s] || s) + primes;
}

export function symsFromSlot(slot) {
  return activeSyms().filter(s => indexSlot(s) === slot);
}

export function renderLens(host, syms, picked, onPick) {
  if (!host) return;
  const doc = host.ownerDocument;
  host.replaceChildren();
  const p = picked ? norm(picked) : null;
  for (const s of syms) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'lens-chip ' + indexClass(s) + (p === s ? ' on' : '');
    b.textContent = symLabel(s);
    b.dataset.sym = s;
    b.setAttribute('aria-pressed', String(p === s));
    b.setAttribute('aria-label', `Highlight the index ${s}`);
    b.addEventListener('click', () => onPick(p === s ? null : s));
    host.appendChild(b);
  }
  if (!syms.length) {
    const e = doc.createElement('span');
    e.className = 'lens-empty';
    e.textContent = 'none yet';
    host.appendChild(e);
  }
}
