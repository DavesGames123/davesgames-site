// ============================================================================
//  TENSOR CALCULUS  ·  ui/tex-color.js  ·  index colours in TeX  (CORE)
// ----------------------------------------------------------------------------
//  DOM-free. lib/sci-math.js colorize() colours every copy of a symbol, so
//  it would also colour the letter "i" in a name or the "d" of "dx". Here
//  only the index slots are coloured: the argument of each ^ and _, and
//  only the letters in it. For example R^{\rho}{}_{\sigma\mu\nu} gives
//  R^{\class{i2}{\rho}}{}_{\class{i3}{\sigma}\class{i0}{\mu}...}.
//  Digits, commas, semicolons, primes and \prime stay as they are.
//
//  When the TeX already holds \class{iN} (MATH toTex with colours), the
//  functions keep it.
//
//  expandSumTex() writes out an Einstein sum for the TeX view: each term
//  that holds the dummy letter becomes a sum over its values, with the
//  value in the same colour as the letter. A long sum shows the first two
//  terms, \cdots and the last term.
//
//  EXPORTS   (grep -n "export" ui/tex-color.js)
//      scriptIndices(tex)       index syms in script slots, in order
//      colorIndexTex(tex, cls)  TeX with \class{iN}{..}; cls(sym) -> 'iN'
//      expandSumTex(tex, sym, n, cls)
//      substituteIndex(tex, sym, value, cls)
// ============================================================================

const NOT_INDEX = new Set(['prime', 'cdots', 'ldots', 'dots', 'cdot', 'quad', 'qquad', ',', ';', ' ', '!', 'circ', 'ast', 'star', 'dagger', 'top', 'infty', 'partial', 'nabla']);
const VERBATIM = new Set(['text', 'textrm', 'mathrm', 'operatorname', 'mathbf', 'mathcal', 'mathsf', 'boldsymbol', 'class', 'color', 'textcolor', 'hspace', 'vspace']);

function groupEnd(tex, i) {
  let depth = 0;
  for (let j = i; j < tex.length; j++) {
    const c = tex[j];
    if (c === '\\') { j++; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return j + 1;
  }
  return tex.length;
}

// Read one token at i: a control word, a control symbol, a group or a char.
function token(tex, i) {
  if (tex[i] === '\\') {
    const m = /^\\([A-Za-z]+|.)/.exec(tex.slice(i));
    return { kind: 'cmd', name: m[1], end: i + m[0].length };
  }
  if (tex[i] === '{') return { kind: 'group', end: groupEnd(tex, i) };
  return { kind: 'char', name: tex[i], end: i + 1 };
}

// Walk the inside of a script and call onIndex(sym, start, end) for each
// index letter. Returns nothing; used by the three exports.
function walkScript(src, onIndex, offset = 0) {
  let i = 0;
  while (i < src.length) {
    const tk = token(src, i);
    if (tk.kind === 'cmd') {
      if (VERBATIM.has(tk.name)) {
        // \class{iN}{\mu}: the index inside is already coloured. Report it,
        // so scriptIndices still finds it, but do not wrap it again.
        let j = tk.end;
        const nGroups = tk.name === 'class' || tk.name === 'textcolor' ? 2 : 1;
        let last = null;
        for (let g = 0; g < nGroups; g++) {
          while (src[j] === ' ') j++;
          if (src[j] === '{') { const e = groupEnd(src, j); last = [j + 1, e - 1]; j = e; }
        }
        if (tk.name === 'class' && last) {
          const inner = src.slice(last[0], last[1]).trim();
          const m = /^\\?([A-Za-z]+)$/.exec(inner);
          if (m) onIndex(m[1], -1, -1);
        }
        i = j; continue;
      }
      if (/^[A-Za-z]+$/.test(tk.name) && !NOT_INDEX.has(tk.name)) onIndex(tk.name, offset + i, offset + tk.end);
      i = tk.end; continue;
    }
    if (tk.kind === 'group') { walkScript(src.slice(i + 1, tk.end - 1), onIndex, offset + i + 1); i = tk.end; continue; }
    if (/[A-Za-z]/.test(tk.name)) onIndex(tk.name, offset + i, offset + tk.end);
    i = tk.end;
  }
}

// Find each script argument in tex: calls fn(start, end) for the source
// span of the argument (inside the braces when there are braces).
function eachScript(tex, fn) {
  let i = 0;
  while (i < tex.length) {
    const c = tex[i];
    if (c === '\\') {
      const tk = token(tex, i);
      if (VERBATIM.has(tk.name)) {
        let j = tk.end;
        const nGroups = tk.name === 'class' || tk.name === 'textcolor' ? 2 : 1;
        for (let g = 0; g < nGroups; g++) { while (tex[j] === ' ') j++; if (tex[j] === '{') j = groupEnd(tex, j); }
        // A coloured index outside a script is still an index of the class.
        i = j; continue;
      }
      i = tk.end; continue;
    }
    if (c === '^' || c === '_') {
      let j = i + 1;
      while (tex[j] === ' ') j++;
      const tk = token(tex, j);
      if (tk.kind === 'group') fn(j + 1, tk.end - 1);
      else fn(j, tk.end);
      i = tk.end; continue;
    }
    i++;
  }
}

export function scriptIndices(tex) {
  const out = [];
  eachScript(tex, (a, b) => walkScript(tex.slice(a, b), s => { if (!out.includes(s)) out.push(s); }));
  return out;
}

// Replace spans in tex. spans: [[start, end, text]] in any order.
function splice(tex, spans) {
  spans.sort((x, y) => y[0] - x[0]);
  let out = tex;
  for (const [a, b, t] of spans) out = out.slice(0, a) + t + out.slice(b);
  return out;
}

// only: an optional list of syms; other letters stay plain (e^{i\theta}).
export function colorIndexTex(tex, cls, only = null) {
  const spans = [];
  eachScript(tex, (a, b) => walkScript(tex.slice(a, b), (sym, s, e) => {
    if (s < 0 || (only && !only.includes(sym))) return;
    const src = tex.slice(a + s, a + e);
    spans.push([a + s, a + e, `{\\class{${cls(sym)}}{${src}}}`]);
  }));
  return splice(tex, spans);
}

export function substituteIndex(tex, sym, value, cls) {
  const spans = [];
  eachScript(tex, (a, b) => walkScript(tex.slice(a, b), (s, st, en) => {
    if (s !== sym || st < 0) return;
    spans.push([a + st, a + en, cls ? `{\\class{${cls(sym)}}{${value}}}` : `{${value}}`]);
  }));
  // \class{iN}{\mu} written by MATH: change the inside too.
  const re = new RegExp(`\\\\class\\{(i\\d)\\}\\{\\s*\\\\?${sym}\\s*\\}`, 'g');
  return splice(tex, spans).replace(re, (m, c) => `\\class{${c}}{${value}}`);
}

// Split at top-level + and - (not inside groups), keeping the signs.
function splitTerms(tex) {
  const terms = [];
  let depth = 0, start = 0;
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i];
    if (c === '\\') { i++; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if ((c === '+' || c === '-') && depth === 0 && i > start && !/[\^_]$/.test(tex.slice(start, i).trim())) {
      terms.push(tex.slice(start, i)); start = i;
    }
  }
  terms.push(tex.slice(start));
  return terms.filter(t => t.trim());
}

function topEquals(tex) {
  let depth = 0;
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i];
    if (c === '\\') { i++; continue; }
    if (c === '{') depth++; else if (c === '}') depth--;
    else if (c === '=' && depth === 0) return i;
  }
  return -1;
}

export function expandSumTex(tex, sym, n, cls) {
  const eq = topEquals(tex);
  if (eq >= 0) {
    const l = tex.slice(0, eq), r = tex.slice(eq + 1);
    return `${expandSide(l, sym, n, cls)} = ${expandSide(r, sym, n, cls)}`;
  }
  return expandSide(tex, sym, n, cls);
}

function expandSide(tex, sym, n, cls) {
  const N = Math.max(1, n | 0);
  const vals = N <= 4 ? [...Array(N).keys()] : [0, 1, null, N - 1];
  const out = splitTerms(tex).map(term => {
    if (!scriptIndices(term).includes(sym)) return term;
    let sign = '';
    let body = term.trim();
    if (body[0] === '+' || body[0] === '-') { sign = body[0] + ' '; body = body.slice(1); }
    const parts = vals.map(v => v === null ? '\\cdots' : substituteIndex(body, sym, v, cls));
    return `${sign}\\left(${parts.join(' + ')}\\right)`;
  });
  return out.join(' ').trim();
}
