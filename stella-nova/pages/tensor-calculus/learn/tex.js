// ============================================================================
//  TENSOR CALCULUS  ·  learn/tex.js  ·  index colours for chapter TeX  (LEARN)
// ----------------------------------------------------------------------------
//  DOM-free. The chapter text is plain TeX. This module finds the index
//  letters in it and wraps each one in \class{iN}{...}, so the letter gets
//  the colour that palette.js gives it in every view.
//
//  WHAT IS AN INDEX. A letter or a Greek control word in a superscript or a
//  subscript group: x^{\mu}, g_{\mu\nu}, \partial_i, R^\rho{}_{\sigma\mu\nu}.
//  An author can also mark an index in running text with \I{\mu}.
//  These are not indices, and stay plain:
//    - letters in \text{}, \mathrm{}, \mathbf{}, \operatorname{} groups.
//      Write r_{\mathrm{s}} for a label that is not an index.
//    - digits, primes, commas, semicolons, brackets in the group.
//    - the upper limit of \sum and both limits of \int, \lim, \max, \min.
//
//  EXPORTS   (grep -n "export" tex.js)
//      GREEK ............ Greek control words that can be indices
//      indexSyms(tex) ... index names in order of first use ('mu', 'i')
//      colorIndices(tex, classOf) ... TeX with \class{iN}{} on each index
//      splitProse(text) . [{ text } | { tex }] from prose with $...$
//      proseTex(text) ... every $...$ piece of prose, as a list of TeX
// ============================================================================

export const GREEK = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta',
  'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'phi', 'chi', 'psi', 'omega']);

const VERB = new Set(['text', 'mathrm', 'mathbf', 'operatorname', 'textrm', 'textit', 'mbox', 'boldsymbol', 'mathcal', 'mathbb', 'texttt', 'begin', 'end', 'hspace', 'color']);
const NOLIMIT = new Set(['int', 'oint', 'lim', 'max', 'min', 'sup', 'inf']);

// tex[i] is '{'. Index after the matching '}'.
function groupEnd(tex, i) {
  let d = 0;
  for (let j = i; j < tex.length; j++) {
    if (tex[j] === '\\') { j++; continue; }
    if (tex[j] === '{') d++;
    else if (tex[j] === '}' && --d === 0) return j + 1;
  }
  return tex.length;
}

// One token at i: a group, a control word or one char. Returns [src, end].
function token(tex, i) {
  while (tex[i] === ' ') i++;
  if (tex[i] === '{') { const e = groupEnd(tex, i); return [tex.slice(i, e), e]; }
  if (tex[i] === '\\') { const m = /^\\([A-Za-z]+|.)/.exec(tex.slice(i)); return [m[0], i + m[0].length]; }
  return [tex[i] || '', i + 1];
}

// Walk tex. inIdx: we are in a script group. visit(sym, src) gives the new
// src for one index token. Returns the new TeX.
function walk(tex, inIdx, visit) {
  let out = '', i = 0, lastCs = '';
  while (i < tex.length) {
    const c = tex[i];
    if (c === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(tex.slice(i));
      const name = m[1];
      i += m[0].length;
      if (name === 'I') {                     // explicit index marker
        const [src, e] = token(tex, i);
        const inner = src[0] === '{' ? src.slice(1, -1) : src;
        out += walk(inner, true, visit); i = e; lastCs = ''; continue;
      }
      if (name === 'class') {                 // already coloured: copy
        let [a, e] = token(tex, i); let [b, e2] = token(tex, e);
        out += m[0] + a + b; i = e2; continue;
      }
      if (VERB.has(name)) {
        out += m[0];
        while (tex[i] === ' ') out += tex[i++];
        if (tex[i] === '{') { const e = groupEnd(tex, i); out += tex.slice(i, e); i = e; }
        lastCs = ''; continue;
      }
      if (inIdx && GREEK.has(name)) { out += visit(name, m[0]); lastCs = ''; continue; }
      out += m[0]; lastCs = name; continue;
    }
    if (c === '^' || c === '_') {
      const [src, e] = token(tex, i + 1);
      const limitOf = lastCs;
      const skip = NOLIMIT.has(limitOf) || ((limitOf === 'sum' || limitOf === 'prod') && c === '^');
      out += c;
      if (skip) out += src;
      else if (src[0] === '{') out += '{' + walk(src.slice(1, -1), true, visit) + '}';
      else out += walk(src, true, visit);
      i = e;
      // a limits pair: \sum_{i}^{n} keeps the \sum context for the second script
      if (!(limitOf === 'sum' || limitOf === 'prod' || NOLIMIT.has(limitOf))) lastCs = '';
      continue;
    }
    if (c === '{') {
      const e = groupEnd(tex, i);
      out += '{' + walk(tex.slice(i + 1, e - 1), inIdx, visit) + '}';
      i = e; lastCs = ''; continue;
    }
    if (inIdx && /[A-Za-z]/.test(c)) { out += visit(c, c); i++; continue; }
    if (c !== ' ') lastCs = c === '\'' ? lastCs : '';
    out += c; i++;
  }
  return out;
}

export function indexSyms(tex) {
  const seen = [];
  walk(String(tex || ''), false, (sym, src) => { if (!seen.includes(sym)) seen.push(sym); return src; });
  return seen;
}

// classOf(sym) -> 'iN'. palette.js indexClass is the normal choice.
export function colorIndices(tex, classOf) {
  return walk(String(tex || ''), false, (sym, src) => `{\\class{${classOf(sym)}}{${src}}}`);
}

// Prose with $...$ inline TeX. \$ is a literal dollar sign.
export function splitProse(text) {
  const out = [];
  const s = String(text || '');
  let buf = '', i = 0;
  while (i < s.length) {
    if (s[i] === '\\' && s[i + 1] === '$') { buf += '$'; i += 2; continue; }
    if (s[i] === '$') {
      const j = s.indexOf('$', i + 1);
      if (j < 0) { buf += s.slice(i); break; }
      if (buf) out.push({ text: buf });
      out.push({ tex: s.slice(i + 1, j) });
      buf = ''; i = j + 1; continue;
    }
    buf += s[i++];
  }
  if (buf) out.push({ text: buf });
  return out;
}

export function proseTex(text) {
  return splitProse(text).filter(p => 'tex' in p).map(p => p.tex);
}
