// ============================================================================
//  MOBILE TESTS  ·  phone layout rules and touch logic, in node (no browser)
// ----------------------------------------------------------------------------
//  Run:  node --test stella-nova/pages/manim-live/tests/mobile.test.mjs
//  Covers: the view after a run, the key row edits (indent, pairs, type),
//  the soft keyboard inset, the share-sheet choice of an export, and the
//  phone rules that a read of style.css and index.html can check: one
//  view at a time, 16 px fields, 44 px targets, 100dvh, safe-area insets,
//  overflow-x on html only, and the [hidden] rule.
//  A real phone run is not part of these tests.
// ============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MTABS, KEYS, PHONE_QUERY, tabAfterRun, keyEdit, keyboardInset, mountKeyRow } from '../ui/mobile.js';
import { useShareSheet } from '../ui/export.js';

const PAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = fs.readFileSync(path.join(PAGE, 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const HTML = fs.readFileSync(path.join(PAGE, 'index.html'), 'utf8');
const MAIN = fs.readFileSync(path.join(PAGE, 'main.js'), 'utf8');

// Body of the first @media block whose condition contains `cond`.
function mediaBlock(cond) {
  const at = CSS.indexOf(`@media ${cond}`);
  assert.ok(at >= 0, `no @media ${cond}`);
  let i = CSS.indexOf('{', at) + 1, depth = 1;
  const start = i;
  for (; depth && i < CSS.length; i++) { if (CSS[i] === '{') depth++; else if (CSS[i] === '}') depth--; }
  return CSS.slice(start, i - 1);
}
// Declarations of the rule with exactly this selector list, in a block.
function rule(block, selector) {
  const re = new RegExp('(?:^|[}\\s])' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = re.exec(block);
  assert.ok(m, `no rule ${selector}`);
  return m[1];
}
const px = (decl, prop) => {
  const m = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*(\\d+(?:\\.\\d+)?)px').exec(decl);
  return m ? +m[1] : null;
};

// ---- logic -------------------------------------------------------------------

test('mobile: a run shows the output view, a lesson run keeps its view', () => {
  for (const t of MTABS) assert.equal(tabAfterRun(t, 'user'), 'output');
  assert.equal(tabAfterRun('examples', 'example'), 'output');
  assert.equal(tabAfterRun('ref', 'ref'), 'output');
  assert.equal(tabAfterRun('code'), 'output');
  assert.equal(tabAfterRun('learn', 'lesson'), 'learn');
  assert.equal(tabAfterRun('code', 'lesson'), 'code');
  assert.equal(tabAfterRun('nonsense', 'lesson'), 'code');
});

test('mobile: Tab key indents to the next multiple of four', () => {
  assert.deepEqual(keyEdit('x', 0, 0, 'indent'), { changes: [{ from: 0, to: 0, insert: '    ' }], anchor: 4, head: 4 });
  const e = keyEdit('ab', 2, 2, 'indent');
  assert.equal(e.changes[0].insert, '  ');
  assert.equal(e.anchor, 4);
  // a selection over two lines indents both lines and keeps the selection
  const text = 'a = 1\nb = 2\nc = 3';
  const m = keyEdit(text, 0, 9, 'indent');
  assert.deepEqual(m.changes.map(c => c.from), [0, 6]);
  assert.equal(m.anchor, 4);
  assert.equal(m.head, 17);
  // a selection that ends at the start of a line does not take that line
  assert.equal(keyEdit(text, 0, 6, 'indent').changes.length, 1);
});

test('mobile: dedent key takes up to four spaces from each line', () => {
  const text = '      a\n  b\nc';
  const e = keyEdit(text, 0, text.length, 'dedent');
  assert.deepEqual(e.changes, [{ from: 0, to: 4, insert: '' }, { from: 8, to: 10, insert: '' }]);
  assert.equal(e.anchor, 0);
  assert.equal(e.head, text.length - 6);
  assert.deepEqual(keyEdit('abc', 1, 1, 'dedent'), { changes: [], anchor: 1, head: 1 });
});

test('mobile: bracket and quote keys put a pair at the caret or around a selection', () => {
  assert.deepEqual(keyEdit('Circle', 6, 6, '('), { changes: [{ from: 6, to: 6, insert: '()' }], anchor: 7, head: 7 });
  assert.deepEqual(keyEdit('x = hi', 4, 6, '"'), { changes: [{ from: 4, to: 6, insert: '"hi"' }], anchor: 5, head: 7 });
  assert.equal(keyEdit('', 0, 0, '[').changes[0].insert, '[]');
  assert.equal(keyEdit('', 0, 0, '{').changes[0].insert, '{}');
  assert.equal(keyEdit('', 0, 0, "'").changes[0].insert, "''");
  assert.deepEqual(keyEdit('def f()', 7, 7, ':'), { changes: [{ from: 7, to: 7, insert: ':' }], anchor: 8, head: 8 });
  for (const id of ['undo', 'redo', 'doc', 'run']) assert.equal(keyEdit('x', 0, 0, id), null);
});

test('mobile: key row has Tab, brackets, quotes, colon and Run, and keeps the focus', () => {
  const ids = KEYS.map(k => k.id);
  for (const id of ['indent', 'dedent', '(', '[', '{', '"', "'", ':', 'undo', 'redo', 'doc', 'run']) assert.ok(ids.includes(id), id);
  const listeners = {};
  const el = { innerHTML: '', addEventListener: (n, f) => { listeners[n] = f; } };
  const got = [];
  mountKeyRow(el, k => got.push(k));
  assert.equal((el.innerHTML.match(/<button /g) || []).length, KEYS.length);
  let prevented = false;
  const btn = { dataset: { key: ':' } };
  const target = { closest: (sel) => (sel.startsWith('button') ? btn : null) };
  listeners.pointerdown({ target, preventDefault: () => { prevented = true; } });
  assert.ok(prevented, 'pointerdown on a key must not move the focus');
  listeners.click({ target });
  assert.deepEqual(got, [':']);
});

test('mobile: keyboard inset from visualViewport', () => {
  assert.equal(keyboardInset(800, { height: 800, offsetTop: 0 }), 0);
  assert.equal(keyboardInset(800, { height: 760, offsetTop: 0 }), 0);      // toolbar, not a keyboard
  assert.equal(keyboardInset(800, { height: 460, offsetTop: 0 }), 340);
  assert.equal(keyboardInset(800, { height: 460, offsetTop: 100 }), 240);  // iOS moved the page up
  assert.equal(keyboardInset(800, null), 0);
});

test('mobile: exports use the share sheet only on touch, with a recent tap', () => {
  const file = { name: 'a.png' };
  const canShare = () => true;
  assert.equal(useShareSheet({ coarse: true, canShare, activation: true, file }), true);
  assert.equal(useShareSheet({ coarse: true, canShare, activation: undefined, file }), true);
  assert.equal(useShareSheet({ coarse: true, canShare, activation: false, file }), false);
  assert.equal(useShareSheet({ coarse: false, canShare, activation: true, file }), false);
  assert.equal(useShareSheet({ coarse: true, canShare: undefined, activation: true, file }), false);
  assert.equal(useShareSheet({ coarse: true, canShare: () => { throw new Error('x'); }, activation: true, file }), false);
});

// ---- layout rules ------------------------------------------------------------

test('phone css: one view at a time, so code and output are never side by side', () => {
  assert.equal(PHONE_QUERY, '(max-width: 760px)');
  const phone = mediaBlock('(max-width:760px){');
  assert.match(phone, /#work\s*>\s*\*\s*\{display:none!important\}/);
  assert.match(rule(phone, '#work[data-mtab=code] #codePane'), /display:flex!important/);
  assert.match(rule(phone, '#work[data-mtab=output] #outPane'), /display:flex!important/);
  assert.match(phone, /#layoutSeg/);   // the desktop split control is gone on phones
  assert.match(rule(phone, '#dock'), /position:fixed/);
  for (const t of MTABS) assert.match(HTML, new RegExp(`data-mtab="${t}"`), t);
  assert.match(HTML, /id="dockRun"/);
  assert.match(MAIN, /\$\('dockRun'\)\.onclick/);
});

test('phone css: fields and the editor use 16 px text (no iOS zoom on focus)', () => {
  const touch = mediaBlock('(max-width:760px),(pointer:coarse)');
  assert.equal(px(rule(touch, 'input,select,textarea,.rf-q,.rf-mf,.ex-q,.cm-panel.cm-search input'), 'font-size'), 16);
  assert.equal(px(rule(touch, '.cm-editor,#codePane .cm-editor'), 'font-size'), 16);
  // no rule after the touch block sets a smaller editor size on phones
  const phone = mediaBlock('(max-width:760px){');
  assert.doesNotMatch(phone, /\.cm-editor\{font-size:1[0-5]px/);
  assert.match(HTML, /name="viewport"[^>]*width=device-width/);
  assert.doesNotMatch(HTML, /maximum-scale|user-scalable\s*=\s*no/, 'pinch zoom must stay on');
});

test('phone css: touch targets are 44 px or more', () => {
  const coarse = mediaBlock('(pointer:coarse){');
  for (const sel of ['.btn', '.btn.small', '.seg button', 'select', '#track']) {
    assert.ok(px(rule(coarse, sel), 'height') >= 44, sel);
  }
  const icon = rule(coarse, '.icon');
  assert.ok(px(icon, 'width') >= 44 && px(icon, 'height') >= 44);
  for (const sel of ['.chip', '.tp', '.rf-m', '.ln-back,.hd-more', '.tog', '.ex-card,.ln-item']) {
    assert.ok(px(rule(coarse, sel), 'min-height') >= 44, sel);
  }
  assert.ok(px(rule(coarse, '.ln-dots button'), 'height') >= 44);
  const touch = mediaBlock('(max-width:760px),(pointer:coarse)');
  const key = rule(touch, '#keys button');
  assert.ok(px(key, 'min-width') >= 44 && px(key, 'height') >= 44);
});

test('phone css: 100dvh, safe-area insets, no 100vh, overflow-x on html only', () => {
  assert.doesNotMatch(CSS, /100vh/);
  assert.match(rule(CSS, 'body'), /height:100dvh/);
  for (const side of ['top', 'right', 'bottom', 'left']) assert.match(CSS, new RegExp(`env\\(safe-area-inset-${side}\\)`), side);
  assert.match(HTML, /viewport-fit=cover/);
  assert.match(rule(CSS, 'html'), /overflow-x:hidden/);
  assert.doesNotMatch(rule(CSS, 'body'), /overflow-x/);
  assert.match(HTML, /\[hidden\]\{display:none!important\}/);
  // the phone gutters are 16 px
  const phone = mediaBlock('(max-width:760px){');
  assert.match(rule(phone, '.panel'), /max\(16px,env\(safe-area-inset-right\)\)/);
  assert.match(rule(phone, '#bar'), /max\(16px,env\(safe-area-inset-left\)\)/);
});

test('phone html: key row, full screen and the soft keyboard hooks are in place', () => {
  assert.match(HTML, /<div id="keys"[^>]*role="toolbar"/);
  assert.match(HTML, /id="fullBtn"/);
  assert.match(HTML, /interactive-widget=resizes-content/);
  assert.match(MAIN, /mountKeyRow\(\$\('keys'\)/);
  assert.match(MAIN, /watchKeyboard\(window/);
  assert.match(CSS, /html\.kb-open #keys\{position:fixed;[^}]*bottom:var\(--kb\)/);
  assert.match(CSS, /#outPane\.pseudo-full\{position:fixed;inset:0/);
});
