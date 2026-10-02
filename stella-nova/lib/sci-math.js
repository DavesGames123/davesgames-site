// ============================================================================
//  SCI MATH  ·  color-coded TeX as MathJax SVG  (ES module)
// ----------------------------------------------------------------------------
//  Typesets TeX into inline SVG with MathJax 3 at run time. The glyphs are
//  SVG paths, so Safari and Chrome show the same shape. KaTeX HTML output
//  put subscripts and fraction denominators on the baseline in Safari.
//
//  Color coding: colorize() wraps each symbol of a rule list in
//  \class{mN}{...}. lib/sci.css gives .m1 to .m6 a color, in the SVG and in
//  HTML, so a page can give a slider label the color of its symbol.
//
//  A page with fixed formulas can still use a typeset.mjs script that
//  writes static SVG (hydrogen-table, hohmann). This module is for pages
//  that build TeX at run time, for example from a preset file.
//
//  If MathJax does not load (no network), the TeX text stays in the box
//  with the class "raw".
//
//  EXPORTS   (jump with grep -n "<anchor>" sci-math.js)
//      loadMath ....... "export function loadMath"   load MathJax once
//      colorize ....... "export function colorize"   TeX + rules -> TeX
//      typeset ........ "export async function typeset"  one box
//      typesetAll ..... "export function typesetAll"  every [data-tex] box
// ============================================================================

const SRC = 'https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js';
let loading = null;

// Load MathJax once. The promise gives window.MathJax, or null on failure.
export function loadMath() {
  if (loading) return loading;
  loading = new Promise(resolve => {
    if (window.MathJax && window.MathJax.tex2svgPromise) { resolve(window.MathJax); return; }
    window.MathJax = {
      loader: { load: ['[tex]/html', '[tex]/color'] },
      tex: { packages: { '[+]': ['html', 'color'] } },
      svg: { fontCache: 'local' },
      startup: { typeset: false, ready() { window.MathJax.startup.defaultReady(); window.MathJax.startup.promise.then(() => resolve(window.MathJax), () => resolve(null)); } },
    };
    const s = document.createElement('script');
    s.src = SRC; s.async = true;
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return loading;
}

// Control sequences whose next {group} is text or a name, not math symbols.
// colorize copies them without change.
const VERBATIM = new Set(['text', 'textrm', 'textit', 'textbf', 'mathrm', 'operatorname', 'mbox', 'begin', 'end', 'class', 'color', 'textcolor', 'label', 'tag', 'hspace', 'vspace', 'mathbf', 'boldsymbol']);

function readGroup(tex, i) {
  // tex[i] is '{'. Return the index after the matching '}'.
  let depth = 0;
  for (let j = i; j < tex.length; j++) {
    if (tex[j] === '\\') { j++; continue; }
    if (tex[j] === '{') depth++;
    else if (tex[j] === '}' && --depth === 0) return j + 1;
  }
  return tex.length;
}

// rules: [[symbolTeX, 'mN'], ...]. A symbol is TeX for one quantity, for
// example 'a', 'D_a', 'k_1', '\\mu', '\\sigma_{\\mu}'. Longer symbols match
// first. 'D_a' also matches 'D_{a}'. A rule matches only at a symbol
// boundary: a control word ('\\mu') does not match the start of '\\mut'.
export function colorize(tex, rules) {
  if (!rules || !rules.length) return tex;
  const pats = [];
  for (const [sym, cls] of rules) {
    pats.push([sym, cls]);
    const m = /^(.+)_([A-Za-z0-9])$/.exec(sym);
    if (m) pats.push([`${m[1]}_{${m[2]}}`, cls]);
    const n = /^(.+)_\{([A-Za-z0-9])\}$/.exec(sym);
    if (n) pats.push([`${n[1]}_${n[2]}`, cls]);
  }
  pats.sort((x, y) => y[0].length - x[0].length);
  let out = '', i = 0;
  while (i < tex.length) {
    let hit = null;
    for (const [p, cls] of pats) {
      if (!tex.startsWith(p, i)) continue;
      const next = tex[i + p.length] || '';
      if (/^\\[A-Za-z]+$/.test(p) && /[A-Za-z]/.test(next)) continue;
      hit = [p, cls]; break;
    }
    // Braces make the coloured symbol one argument, so an accent before it
    // (\bar Z, \hat x, \vec E) and a script after it stay valid TeX.
    if (hit) { out += `{\\class{${hit[1]}}{${hit[0]}}}`; i += hit[0].length; continue; }
    const c = tex[i];
    if (c === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(tex.slice(i));
      const name = m[1];
      out += m[0]; i += m[0].length;
      if (VERBATIM.has(name)) {
        // \class and \textcolor take two groups. \begin{env} takes one.
        const groups = name === 'class' || name === 'textcolor' ? 2 : 1;
        for (let g = 0; g < groups; g++) {
          while (tex[i] === ' ') out += tex[i++];
          if (tex[i] === '{') { const e = readGroup(tex, i); out += tex.slice(i, e); i = e; }
        }
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

// Typeset tex into el. Options: display (default true), rules (for
// colorize). Returns true when MathJax made the SVG.
export async function typeset(el, tex, { display = true, rules = null } = {}) {
  el.dataset.tex = tex;
  el.classList.remove('raw');
  const MJ = await loadMath();
  if (el.dataset.tex !== tex) return false;   // a newer call replaced it
  if (!MJ) { el.textContent = tex; el.classList.add('raw'); return false; }
  try {
    const node = await MJ.tex2svgPromise(colorize(tex, rules), { display });
    if (el.dataset.tex !== tex) return false;
    // A parse error gives merror. An undefined macro (noundefined) does not:
    // MathJax draws its name as red text, so check for red fill too.
    if (node.querySelector('[data-mjx-error], merror, [data-mml-node="merror"], [fill="red"]')) throw new Error('TeX error');
    // The hidden MathML copy needs the MathJax stylesheet to stay hidden.
    // aria-label carries the TeX, so remove the copy.
    node.querySelectorAll('mjx-assistive-mml').forEach(n => n.remove());
    el.replaceChildren(node);
    el.setAttribute('aria-label', tex);
    return true;
  } catch (e) {
    el.textContent = tex; el.classList.add('raw');
    return false;
  }
}

// Typeset every element under root with a data-tex attribute. Use
// data-inline for inline math. rules apply to all of them.
export function typesetAll(root = document, rules = null) {
  return Promise.all([...root.querySelectorAll('[data-tex]')].map(el =>
    typeset(el, el.dataset.tex, { display: !('inline' in el.dataset), rules })));
}
