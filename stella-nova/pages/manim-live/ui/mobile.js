// ============================================================================
//  MOBILE  ·  phone views, the key row above the soft keyboard
// ----------------------------------------------------------------------------
//  The phone layout itself is CSS (style.css, grep -n 'PHONE'). This file
//  holds the logic that the CSS cannot do. All functions except
//  mountKeyRow and watchKeyboard are pure, so node tests can call them.
//
//  VIEWS. At phone width (PHONE_QUERY), #work shows one view at a time,
//  picked by data-mtab. tabAfterRun() gives the view after a run starts:
//  a run shows the output, except a run that a lesson starts, because
//  the lesson text stays open next to its task.
//
//  KEY ROW. A soft keyboard has no Tab key and puts brackets, quotes and
//  the colon on a second page. The key row (#keys) gives them in one tap,
//  with undo, redo, Ref (the name at the caret in the reference) and Run.
//  keyEdit() turns one key into a CodeMirror change: Tab indents to the
//  next multiple of four spaces, a bracket or quote key puts a pair
//  around the selection or the caret, and the other keys type one text.
//
//  KEYBOARD. iOS Safari does not make the layout viewport smaller when
//  the soft keyboard opens. keyboardInset() reads visualViewport and
//  gives the height that the keyboard covers. watchKeyboard() writes it to
//  --kb on <html> and sets the class kb-open, so the key row moves up to
//  the keyboard and the dock goes away. Android Chrome gets
//  interactive-widget=resizes-content in the viewport meta, and the inset
//  stays near 0.
//
//  EXPORTS
//    PHONE_QUERY, MTABS, KEYS
//    tabAfterRun(current, source)          -> view name
//    keyEdit(text, from, to, id)           -> {changes, anchor, head} | null
//    keyboardInset(innerHeight, vv)        -> px
//    mountKeyRow(el, onKey)                -> void   (DOM)
//    watchKeyboard(win, root)              -> stop() (DOM)
// ============================================================================

export const PHONE_QUERY = '(max-width: 760px)';
export const MTABS = ['code', 'output', 'learn', 'examples', 'ref', 'hood'];

// Run sources that keep the current view. All other sources show output.
const KEEP_VIEW = new Set(['lesson']);

export function tabAfterRun(current, source = 'user') {
  if (KEEP_VIEW.has(source)) return MTABS.includes(current) ? current : 'code';
  return 'output';
}

// id: what keyEdit does. label: the key text. insert: the text it types.
export const KEYS = [
  { id: 'indent', label: '⇥', title: 'Indent (Tab)' },
  { id: 'dedent', label: '⇤', title: 'Remove indent' },
  { id: '(', label: '( )', title: 'Parentheses' },
  { id: '[', label: '[ ]', title: 'Brackets' },
  { id: '{', label: '{ }', title: 'Braces' },
  { id: '"', label: '" "', title: 'Double quotes' },
  { id: "'", label: "' '", title: 'Single quotes' },
  { id: ':', label: ':', title: 'Colon' },
  { id: '=', label: '=', title: 'Equals' },
  { id: '.', label: '.', title: 'Dot' },
  { id: ',', label: ',', title: 'Comma' },
  { id: '_', label: '_', title: 'Underscore' },
  { id: 'undo', label: '↶', title: 'Undo' },
  { id: 'redo', label: '↷', title: 'Redo' },
  { id: 'doc', label: 'Ref', title: 'Open the name at the cursor in the reference' },
  { id: 'run', label: '▶ Run', title: 'Run', primary: true },
];

const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" };
const TYPE = new Set([':', '=', '.', ',', '_']);
const INDENT = 4;

function lineStart(text, pos) { return text.lastIndexOf('\n', pos - 1) + 1; }

// Start offsets of each line that the range [from, to] touches.
function linesIn(text, from, to) {
  const out = [lineStart(text, from)];
  // A selection that ends at the start of a line does not take that line.
  const end = to > from && text[to - 1] === '\n' ? to - 1 : to;
  for (let i = text.indexOf('\n', from); i >= 0 && i < end; i = text.indexOf('\n', i + 1)) out.push(i + 1);
  return out;
}

// One key -> a change in CodeMirror form. from/to and anchor/head are
// offsets in the document; anchor/head are offsets AFTER the change.
// Returns null for keys that are not edits (undo, redo, doc, run).
export function keyEdit(text, from, to, id) {
  if (from > to) [from, to] = [to, from];
  if (id === 'indent') {
    if (from === to) {
      const col = from - lineStart(text, from);
      const n = INDENT - (col % INDENT);
      const insert = ' '.repeat(n);
      return { changes: [{ from, to, insert }], anchor: from + n, head: from + n };
    }
    const starts = linesIn(text, from, to);
    const pad = ' '.repeat(INDENT);
    const changes = starts.map(s => ({ from: s, to: s, insert: pad }));
    const before = (p) => starts.filter(s => s <= p).length;
    return { changes, anchor: from + INDENT * before(from), head: to + INDENT * before(to) };
  }
  if (id === 'dedent') {
    const starts = linesIn(text, from, to);
    const changes = [];
    for (const s of starts) {
      let n = 0;
      while (n < INDENT && text[s + n] === ' ') n++;
      if (n) changes.push({ from: s, to: s + n, insert: '' });
    }
    if (!changes.length) return { changes: [], anchor: from, head: to };
    const shift = (p) => changes.reduce((d, c) => d + (c.to <= p ? c.to - c.from : (c.from < p ? p - c.from : 0)), 0);
    return { changes, anchor: from - shift(from), head: to - shift(to) };
  }
  if (PAIRS[id]) {
    const close = PAIRS[id];
    const inner = text.slice(from, to);
    const insert = id + inner + close;
    if (from === to) return { changes: [{ from, to, insert }], anchor: from + 1, head: from + 1 };
    return { changes: [{ from, to, insert }], anchor: from + 1, head: from + 1 + inner.length };
  }
  if (TYPE.has(id)) {
    return { changes: [{ from, to, insert: id }], anchor: from + id.length, head: from + id.length };
  }
  return null;
}

// Height in px that the soft keyboard covers at the base of the layout
// viewport. Less than 80 px is a toolbar change, not a keyboard: 0.
export function keyboardInset(innerHeight, vv) {
  if (!vv || !Number.isFinite(vv.height)) return 0;
  const inset = Math.round(innerHeight - vv.height - (vv.offsetTop || 0));
  return inset >= 80 ? inset : 0;
}

// ---- DOM -------------------------------------------------------------------

export function mountKeyRow(el, onKey) {
  el.innerHTML = KEYS.map(k => `<button type="button" data-key="${k.id.replace(/"/g, '&quot;')}" class="${k.primary ? 'kr-run' : ''}" title="${k.title}" aria-label="${k.title}">${k.label}</button>`).join('');
  // A tap on a key must not take the focus from the editor, or the soft
  // keyboard closes. preventDefault on pointerdown and mousedown keeps it.
  const keep = (e) => { if (e.target.closest('button')) e.preventDefault(); };
  el.addEventListener('pointerdown', keep);
  el.addEventListener('mousedown', keep);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-key]');
    if (b) onKey(b.dataset.key);
  });
}

export function watchKeyboard(win, root) {
  const vv = win.visualViewport;
  if (!vv) return () => {};
  let raf = 0;
  const apply = () => {
    raf = 0;
    const inset = keyboardInset(win.innerHeight, vv);
    root.style.setProperty('--kb', inset + 'px');
    root.classList.toggle('kb-open', inset > 0);
  };
  const queue = () => { if (!raf) raf = win.requestAnimationFrame(apply); };
  vv.addEventListener('resize', queue);
  vv.addEventListener('scroll', queue);
  apply();
  return () => { vv.removeEventListener('resize', queue); vv.removeEventListener('scroll', queue); };
}
