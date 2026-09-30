// ============================================================================
//  REACTION–DIFFUSION  ·  equation renderer  (ES module)
// ----------------------------------------------------------------------------
//  Renders KaTeX strings into the page. The strings for a preset come from
//  presets.json ("equations", one per chemical). If the KaTeX library did not
//  load, or a string does not parse, the plain TeX text stays on the page.
//
//  EXPORTS   (jump with grep -n "<anchor>" equations.js)
//  --------------------------------------------------------------------------
//      renderTeX ........ "export function renderTeX"      one string, one box
//      renderEquations .. "export function renderEquations" a list of boxes
//      fitEquations ..... "export function fitEquations"    render again on resize
//      GENERAL .......... "export const GENERAL"            the general form
// ============================================================================

// The general form of a two-chemical reaction–diffusion system.
export const GENERAL = String.raw`\begin{aligned}\frac{\partial a}{\partial t} &= D_a\,\nabla^2 a + f(a,b)\\[2pt] \frac{\partial b}{\partial t} &= D_b\,\nabla^2 b + g(a,b)\end{aligned}`;

const OPTS = { throwOnError: true, displayMode: true, strict: false, trust: false };

// Render one TeX string into el. Return true when KaTeX made the output.
// A display equation wider than its box is rendered again in inline mode,
// where KaTeX can break the line after a relation or an operator.
export function renderTeX(el, tex) {
  el.textContent = tex;
  el.classList.remove('wrap', 'raw');
  if (!window.katex) return false;
  try {
    window.katex.render(tex, el, OPTS);
    if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2) {
      window.katex.render(tex, el, { ...OPTS, displayMode: false });
      el.classList.add('wrap');
    }
    return true;
  } catch (e) { el.textContent = tex; el.classList.add('raw'); return false; }
}

// Replace the content of box with one .eq line per TeX string.
export function renderEquations(box, list) {
  box.textContent = '';
  for (const tex of list || []) {
    const d = document.createElement('div');
    d.className = tex.length > 90 ? 'eq long' : 'eq';
    d.dataset.tex = tex;
    box.appendChild(d);
    renderTeX(d, tex);
  }
  if (!list || !list.length) {
    const d = document.createElement('div');
    d.className = 'hint'; d.textContent = 'No equations given for this preset.';
    box.appendChild(d);
  }
}

// Render each box again with its TeX (kept in data-tex), after the width of
// the panel changes.
export function fitEquations(box) {
  for (const d of box.querySelectorAll('.eq[data-tex]')) renderTeX(d, d.dataset.tex);
}
