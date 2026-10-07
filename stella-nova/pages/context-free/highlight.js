// ============================================================================
//  CONTEXT FREE  ·  highlight.js — CFDG syntax colours and the code editor
// ----------------------------------------------------------------------------
//  Our own code (GPL-2.0-or-later, see COPYING).
//
//  tokens(src)        -> [{ t, s }]: t is a class name (tk-*), s the text
//  highlight(src)     -> HTML with one <span class="tk-*"> per token
//  createEditor(host, { onChange, onRun }) -> editor
//      editor.value            the source text (get / set)
//      editor.setDiags(list)   mark lines: [{ line, error, text }]
//      editor.goto(line)       select that line and scroll to it
//  The editor is a transparent <textarea> over a highlighted <pre>, both
//  in one grid cell, so they keep the same size. Tab puts two spaces,
//  Enter keeps the indent, Ctrl/Cmd+Enter calls onRun.
//
//  The word lists follow the CFDG 3 grammar (src-common/cfdg.l and the
//  upstream wiki). Version 2 words (rule, background, tile) are in too.
//
//  GREP MAP
//    grep -n 'const KEYWORDS'       keyword, shape, adjustment, function lists
//    grep -n 'export function tokens'
//    grep -n 'export function createEditor'
// ============================================================================
const KEYWORDS = new Set(('startshape shape rule path loop finally if else switch case import include ' +
  'let transform clone background tile size').split(' '));
const SHAPES = new Set(('CIRCLE SQUARE TRIANGLE FILL STROKE MOVETO LINETO ARCTO CURVETO MOVEREL LINEREL ' +
  'ARCREL CURVEREL CLOSEPOLY').split(' '));
const ADJUST = new Set(('x y z s size r rot rotate f flip skew h hue sat saturation b brightness a alpha ' +
  'time timescale trans param p width').split(' '));
const FUNCS = new Set(('cos sin tan cot acos asin atan acot cosh sinh tanh acosh asinh atanh log log10 sqrt ' +
  'exp abs floor ceil infinity factorial sg isNatural bitnot bitor bitand bitxor bitleft bitright atan2 ' +
  'mod divides div min max ftime frame rand rand_static randint rand+/- rand:: randint:: dot cross hsb2rgb ' +
  'rgb2hsb vec select').split(' '));

const RE = new RegExp([
  /(\/\*[\s\S]*?(?:\*\/|$))/.source,          // 1 block comment
  /((?:\/\/|#)[^\n]*)/.source,                // 2 line comment
  /("(?:[^"\\\n]|\\.)*"?)/.source,            // 3 string
  /(CF::[A-Za-z_]+)/.source,                  // 4 config name
  /(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)/.source, // 5 number
  /([A-Za-z_][\w:]*)/.source,                 // 6 word
  /([\[\]{}()])/.source,                      // 7 bracket
  /([-+*\/^<>=!&|.,%…]+)/.source,             // 8 operator
].join('|'), 'g');

export function tokens(src) {
  const out = [];
  let last = 0, m;
  RE.lastIndex = 0;
  while ((m = RE.exec(src))) {
    if (m.index > last) out.push({ t: '', s: src.slice(last, m.index) });
    let t = '';
    if (m[1] || m[2]) t = 'tk-cm';
    else if (m[3]) t = 'tk-st';
    else if (m[4]) t = 'tk-con';
    else if (m[5]) t = 'tk-num';
    else if (m[6]) {
      const w = m[6];
      if (KEYWORDS.has(w)) t = 'tk-kw';
      else if (SHAPES.has(w)) t = 'tk-ty';
      else if (ADJUST.has(w)) t = 'tk-at';
      else if (FUNCS.has(w)) t = 'tk-fn';
      else t = 'tk-id';
    } else if (m[7]) t = 'tk-br';
    else if (m[8]) t = 'tk-op';
    out.push({ t, s: m[0] });
    last = RE.lastIndex;
    if (m[0].length === 0) RE.lastIndex++;
  }
  if (last < src.length) out.push({ t: '', s: src.slice(last) });
  return out;
}

const esc = s => s.replace(/[&<>]/g, c => c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;');

export function highlight(src) {
  return tokens(src).map(k => k.t ? `<span class="${k.t}">${esc(k.s)}</span>` : esc(k.s)).join('');
}

export function createEditor(host, { onChange = () => {}, onRun = () => {} } = {}) {
  host.classList.add('ed');
  host.innerHTML = '<div class="ed-scroll"><div class="ed-gutter" aria-hidden="true"></div>' +
    '<div class="ed-body"><div class="ed-marks" aria-hidden="true"></div><pre class="ed-hl" aria-hidden="true"></pre>' +
    '<textarea class="ed-in" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" aria-label="CFDG source"></textarea></div></div>';
  const ta = host.querySelector('textarea'), pre = host.querySelector('pre'),
    gut = host.querySelector('.ed-gutter'), marks = host.querySelector('.ed-marks'), scroller = host.querySelector('.ed-scroll');
  let diags = [], lines = 0;

  function paint() {
    const v = ta.value;
    // A trailing newline keeps the pre one line taller, like the textarea.
    pre.innerHTML = highlight(v) + '\n';
    const n = v.split('\n').length;
    if (n !== lines) {
      lines = n;
      let h = '';
      for (let i = 1; i <= n; i++) h += `<span data-l="${i}">${i}</span>`;
      gut.innerHTML = h;
      markLines();
    }
  }
  function markLines() {
    gut.querySelectorAll('span.err,span.warn').forEach(s => { s.classList.remove('err', 'warn'); s.removeAttribute('title'); });
    marks.innerHTML = '';
    for (const d of diags) {
      if (!(d.line > 0)) continue;
      const g = gut.querySelector(`span[data-l="${d.line}"]`);
      if (g) { g.classList.add(d.error ? 'err' : 'warn'); g.title = d.text; }
      const bar = document.createElement('div');
      bar.className = 'mk ' + (d.error ? 'err' : 'warn');
      bar.style.top = `calc(${d.line - 1} * var(--ed-lh) + var(--ed-pad))`;
      bar.title = d.text;
      marks.append(bar);
    }
  }

  ta.addEventListener('input', () => { paint(); onChange(ta.value); });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onRun(); return; }
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      document.execCommand ? document.execCommand('insertText', false, '  ') : ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      const s = ta.selectionStart, before = ta.value.slice(0, s);
      const ind = (before.slice(before.lastIndexOf('\n') + 1).match(/^[ \t]*/) || [''])[0];
      if (ind) {
        e.preventDefault();
        const txt = '\n' + ind;
        if (document.execCommand && document.execCommand('insertText', false, txt)) return;
        ta.setRangeText(txt, s, ta.selectionEnd, 'end');
        paint(); onChange(ta.value);
      }
    }
  });

  return {
    get value() { return ta.value; },
    set value(v) { ta.value = v; diags = []; paint(); markLines(); scroller.scrollTop = 0; scroller.scrollLeft = 0; },
    setDiags(list) { diags = list || []; markLines(); },
    goto(line) {
      const ls = ta.value.split('\n');
      let a = 0;
      for (let i = 0; i < Math.min(line - 1, ls.length); i++) a += ls[i].length + 1;
      const b = a + (ls[line - 1] || '').length;
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(a, b);
      const lh = parseFloat(getComputedStyle(host).getPropertyValue('--ed-lh')) || 19;
      scroller.scrollTop = Math.max(0, (line - 4) * lh);
    },
    textarea: ta,
  };
}
