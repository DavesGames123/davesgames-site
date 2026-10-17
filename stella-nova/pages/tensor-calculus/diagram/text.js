// ============================================================================
//  DIAGRAM TEXT  ·  TeX names to SVG text, coefficients, einsum  (DOM-free)
// ----------------------------------------------------------------------------
//  The diagram draws plain SVG text, not MathJax, so that labels can move
//  every frame. These helpers turn the restricted TeX of a TensorExpr into
//  Unicode: index symbols ('\mu', 'mu', "a'"), factor names ('\Gamma',
//  '\dot{x}', '\mathrm{tr}'), and term coefficients (0.5, '-\frac{1}{2}',
//  '8\pi G'). einsumOf() writes the einsum string of a term for the network
//  style.
//
//  EXPORTS   (jump with grep -n "<anchor>" text.js)
//      GREEK ........... "export const GREEK"
//      symText ......... "export function symText"     index sym -> text
//      symBase ......... "export function symBase"     sym without primes
//      nameText ........ "export function nameText"    factor name -> text
//      texText ......... "export function texText"     small TeX -> text
//      coeffParts ...... "export function coeffParts"  { sign, text }
//      textWidth ....... "export function textWidth"   width estimate
//      einsumOf ........ "export function einsumOf"    term -> 'ab,b->a'
// ============================================================================

export const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
  tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', partial: '∂', nabla: '∇',
  hbar: 'ℏ', infty: '∞', ell: 'ℓ',
};
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' };
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
const VULGAR = { '1/2': '½', '1/3': '⅓', '2/3': '⅔', '1/4': '¼', '3/4': '¾', '1/6': '⅙', '1/8': '⅛', '1/5': '⅕' };

export function symBase(sym) {
  return String(sym).replace(/['′]+$/g, '').replace(/^\\/, '');
}

export function symText(sym) {
  const s = String(sym);
  const m = s.match(/^\\?([A-Za-z]+)(.*)$/);
  let out = s;
  if (m) {
    const g = GREEK[m[1]];
    out = (g && (s.startsWith('\\') || m[1].length > 1) ? g : m[1]) + m[2];
  }
  return out.replace(/'/g, '′').replace(/_\{?(\d+)\}?/g, (_, d) => [...d].map(c => SUB[c]).join(''));
}

// Small TeX to Unicode: greek, \frac, \dot, \mathrm, sub and superscript
// digits. Unknown commands lose their backslash.
export function texText(tex) {
  let s = String(tex);
  s = s.replace(/\\[,;:! ]/g, ' ').replace(/\\(?:left|right)/g, '');
  s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_, a, b) => {
    const k = `${texText(a)}/${texText(b)}`;
    return VULGAR[k] || k;
  });
  s = s.replace(/\\ddot\s*\{([^{}]*)\}/g, (_, a) => texText(a) + '̈');
  s = s.replace(/\\dot\s*\{([^{}]*)\}/g, (_, a) => texText(a) + '̇');
  s = s.replace(/\\tilde\s*\{([^{}]*)\}/g, (_, a) => texText(a) + '̃');
  s = s.replace(/\\(?:bar|overline)\s*\{([^{}]*)\}/g, (_, a) => texText(a) + '̄');
  s = s.replace(/\\hat\s*\{([^{}]*)\}/g, (_, a) => texText(a) + '̂');
  s = s.replace(/\\(?:mathrm|operatorname|text|mathbf|mathcal|mathit)\s*\{([^{}]*)\}/g, '$1');
  s = s.replace(/\^\{?(-?\d+)\}?/g, (_, d) => [...d].map(c => SUP[c]).join(''));
  s = s.replace(/_\{?(\d+)\}?/g, (_, d) => [...d].map(c => SUB[c]).join(''));
  s = s.replace(/\\([A-Za-z]+)/g, (_, w) => GREEK[w] || (w === 'det' || w === 'tr' ? w + ' ' : w));
  s = s.replace(/[{}]/g, '').replace(/\*/g, '·').replace(/-/g, '−');
  return s.replace(/\s+/g, ' ').trim();
}

export function nameText(name) {
  return texText(name || '');
}

function rational(x) {
  for (let d = 1; d <= 12; d++) {
    const n = Math.round(x * d);
    if (Math.abs(n / d - x) < 1e-9) return [n, d];
  }
  return null;
}

// Coefficient of a term -> { sign: 1 | -1, text } where text is '' for 1.
export function coeffParts(c) {
  if (c === undefined || c === null || c === '') return { sign: 1, text: '' };
  if (typeof c === 'number') {
    const sign = c < 0 ? -1 : 1, a = Math.abs(c);
    if (Math.abs(a - 1) < 1e-12) return { sign, text: '' };
    const r = rational(a);
    if (r) {
      if (r[1] === 1) return { sign, text: String(r[0]) };
      const k = `${r[0]}/${r[1]}`;
      return { sign, text: VULGAR[k] || k };
    }
    return { sign, text: String(+a.toPrecision(4)) };
  }
  let s = String(c).trim();
  let sign = 1;
  while (s.startsWith('-') || s.startsWith('+')) { if (s[0] === '-') sign = -sign; s = s.slice(1).trim(); }
  if (s === '1') s = '';
  return { sign, text: texText(s) };
}

export function textWidth(s, size = 15) {
  let w = 0;
  for (const ch of String(s)) {
    if (/[̀-ͯ]/.test(ch)) continue;
    w += /[ilj.,′'|]/.test(ch) ? 0.32 : /[mwMWΣΩ]/.test(ch) ? 0.82 : /[0-9a-z]/.test(ch) ? 0.52 : 0.62;
  }
  return w * size;
}

// Letters for einsum: keep single Latin letters, map the rest in order.
export function einsumOf(term, isDeriv) {
  const used = new Map(), taken = new Set();
  const pool = 'ijklmnopqrstuvwxyzabcdefgh'.split('');
  const ops = [], names = [];
  for (const f of term.factors || []) {
    for (const ix of [...(f.indices || []), ...(f.deriv || [])]) {
      const b = String(ix.sym);
      if (/^[a-zA-Z]$/.test(b)) taken.add(b);
    }
  }
  const letter = sym => {
    const s = String(sym);
    if (used.has(s)) return used.get(s);
    let L = /^[a-zA-Z]$/.test(s) ? s : pool.find(c => !taken.has(c));
    taken.add(L); used.set(s, L);
    return L;
  };
  const counts = new Map();
  const all = [];
  for (const f of term.factors || []) {
    const ix = [...(f.indices || []), ...(f.deriv || [])];
    for (const i of ix) counts.set(String(i.sym), (counts.get(String(i.sym)) || 0) + 1);
    all.push({ f, ix });
  }
  let pendingD = '';
  for (const { f, ix } of all) {
    const str = ix.map(i => letter(i.sym)).join('');
    if (isDeriv(f)) { pendingD += str; continue; }
    if (!str && !pendingD) continue; // a scalar factor only scales
    ops.push(pendingD + str);
    names.push((pendingD ? '∂' : '') + nameText(f.tex || f.name));
    pendingD = '';
  }
  if (pendingD) { ops.push(pendingD); names.push('∂'); }
  const out = [];
  for (const [s, n] of counts) if (n === 1) out.push(letter(s));
  if (!ops.length) return null;
  return { spec: `${ops.join(',')}->${out.join('')}`, names };
}
