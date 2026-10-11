// ============================================================================
//  EDITOR  ·  CodeMirror 6 for manim code
// ----------------------------------------------------------------------------
//  One EditorView with Python mode, line numbers, bracket match, search
//  (Mod-F), Tab indent, comment toggle (Mod-/), and Mod-Enter to run.
//  Completion asks the worker (engine.complete), so the names come from the
//  real manim modules. Hover asks engine.introspect for the real signature
//  and docstring. While the worker is busy with a render, a call waits at
//  most TIMEOUT_MS. Then the editor uses the name list it kept from the
//  last good answer.
//
//  Three marks come from the run:
//    error line     a lint diagnostic + red line (markError)
//    play gutter    a triangle on each line that made an animation;
//                   a click on it calls onLineClick(line)
//    active line    the line of the animation under the player head
//  Ctrl-click or Cmd-click on a name calls onDoc(name) (reference panel).
//
//  EXPORTS
//    createEditor(parent, opts) -> api   (grep -n "export function createEditor")
//  api: view, getCode, setCode, markError, clearError, setActiveLine,
//       setAnimLines, gotoLine, focus, setNames
// ============================================================================
import {
  EditorView, EditorState, StateField, StateEffect, Prec, keymap, lineNumbers,
  highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor,
  rectangularSelection, crosshairCursor, highlightSpecialChars, hoverTooltip,
  Decoration, gutter, GutterMarker, defaultKeymap, history, historyKeymap,
  indentWithTab, python, syntaxHighlighting, classHighlighter, bracketMatching,
  indentOnInput, foldGutter, foldKeymap, indentUnit, autocompletion,
  completionKeymap, closeBrackets, closeBracketsKeymap, search, searchKeymap,
  highlightSelectionMatches, lintGutter, setDiagnostics,
} from '../vendor-editor/codemirror@6.bundle.js';
import { dottedAt } from './pysource.js';

const TIMEOUT_MS = 900;

function withTimeout(p, ms) {
  return Promise.race([Promise.resolve(p), new Promise(r => setTimeout(() => r(null), ms))]).catch(() => null);
}

const KIND = { class: 'class', function: 'function', method: 'method', builtin: 'function', module: 'namespace', property: 'property', attribute: 'property', constant: 'constant', keyword: 'keyword', instance: 'variable', variable: 'variable', statement: 'keyword', param: 'variable' };

// ---- marks -----------------------------------------------------------------
const setActive = StateEffect.define();
const activeField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setActive)) {
      const line = e.value;
      if (!line || line < 1 || line > tr.state.doc.lines) deco = Decoration.none;
      else deco = Decoration.set([Decoration.line({ class: 'cm-anim-line' }).range(tr.state.doc.line(line).from)]);
    }
    return deco;
  },
  provide: f => EditorView.decorations.from(f),
});

const setErrLine = StateEffect.define();
const errField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setErrLine)) {
      const line = e.value;
      deco = (!line || line > tr.state.doc.lines) ? Decoration.none
        : Decoration.set([Decoration.line({ class: 'cm-err-line' }).range(tr.state.doc.line(line).from)]);
    }
    return deco;
  },
  provide: f => EditorView.decorations.from(f),
});

class PlayMarker extends GutterMarker {
  toDOM() { const s = document.createElement('span'); s.className = 'cm-play-mark'; s.textContent = '▶'; s.title = 'Show this animation'; return s; }
}
const playMarker = new PlayMarker();
const setAnim = StateEffect.define();
const animField = StateField.define({
  create: () => new Set(),
  update(v, tr) { for (const e of tr.effects) if (e.is(setAnim)) v = e.value; return v; },
});

export function createEditor(parent, opts = {}) {
  const { doc = '', onRun = () => {}, onChange = () => {}, onLineClick = () => {}, onDoc = () => {} } = opts;
  let complete = opts.complete || null;      // (code, line, col) -> Promise<list>
  let introspect = opts.introspect || null;  // (name) -> Promise<info>
  let names = [];                            // fallback completion list

  const source = async (ctx) => {
    const word = ctx.matchBefore(/[\w.]*/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    const head = ctx.state.doc.lineAt(ctx.pos);
    const line = head.number, col = ctx.pos - head.from;
    let list = complete ? await withTimeout(complete(ctx.state.doc.toString(), line, col), TIMEOUT_MS) : null;
    if (ctx.aborted) return null;
    const dot = word.text.lastIndexOf('.');
    const from = dot >= 0 ? word.from + dot + 1 : word.from;
    if (!Array.isArray(list) || !list.length) {
      if (dot >= 0) return null;
      list = names;
    }
    return {
      from,
      options: list.slice(0, 400).map(c => ({
        label: c.name,
        type: KIND[c.kind] || 'variable',
        detail: c.signature ? String(c.signature).slice(0, 80) : undefined,
        info: introspect && /^(class|function|method)$/.test(c.kind) ? async () => {
          const prefix = dot >= 0 ? word.text.slice(0, dot + 1) : '';
          const r = await withTimeout(introspect(prefix + c.name), TIMEOUT_MS);
          if (!r || !r.doc) return null;
          const d = document.createElement('div');
          d.className = 'cm-doc-info';
          d.textContent = firstPara(r.doc);
          return d;
        } : undefined,
      })),
      validFor: /^\w*$/,
    };
  };

  const hover = hoverTooltip(async (view, pos) => {
    if (!introspect) return null;
    const line = view.state.doc.lineAt(pos);
    const name = dottedAt(line.text, pos - line.from);
    if (!name || /^(self|def|class|return|import|from|for|in|if|else|elif|while|and|or|not|with|as|lambda|True|False|None)$/.test(name)) return null;
    let info = await withTimeout(introspect(name), TIMEOUT_MS);
    let shown = name;
    if ((!info || info.error) && name.includes('.')) {
      shown = name.split('.').pop();
      info = await withTimeout(introspect(shown), TIMEOUT_MS);
    }
    if (!info || info.error || (!info.doc && !info.signature)) return null;
    const start = line.from + line.text.indexOf(name.split('.')[0], Math.max(0, pos - line.from - name.length));
    return {
      pos: Math.max(line.from, start), end: pos, above: true,
      create() {
        const d = document.createElement('div');
        d.className = 'cm-hover-doc';
        const sig = document.createElement('div');
        sig.className = 'hd-sig';
        sig.textContent = `${info.name || shown}${info.signature || ''}`;
        const kind = document.createElement('span');
        kind.className = 'hd-kind';
        kind.textContent = info.kind || '';
        sig.prepend(kind);
        const body = document.createElement('div');
        body.className = 'hd-doc';
        body.textContent = firstPara(info.doc || '');
        const more = document.createElement('button');
        more.className = 'hd-more';
        more.textContent = 'Open in reference';
        more.onclick = () => onDoc(info.qualname || info.name || shown);
        d.append(sig, body, more);
        return { dom: d };
      },
    };
  }, { hoverTime: 450 });

  const animGutter = gutter({
    class: 'cm-play-gutter',
    lineMarker(view, line) {
      const n = view.state.doc.lineAt(line.from).number;
      return view.state.field(animField).has(n) ? playMarker : null;
    },
    lineMarkerChange: u => u.transactions.some(t => t.effects.some(e => e.is(setAnim))),
    domEventHandlers: {
      mousedown(view, line) {
        const n = view.state.doc.lineAt(line.from).number;
        if (view.state.field(animField).has(n)) { onLineClick(n, { gutter: true }); return true; }
        return false;
      },
    },
  });

  const runKeys = Prec.highest(keymap.of([
    { key: 'Mod-Enter', run: () => { onRun(); return true; } },
    { key: 'Shift-Enter', run: () => { onRun(); return true; } },
    { key: 'Mod-s', run: () => { onRun(); return true; }, preventDefault: true },
  ]));

  const state = EditorState.create({
    doc,
    extensions: [
      runKeys,
      lineNumbers(), animGutter, foldGutter(), lintGutter(),
      highlightSpecialChars(), history(), drawSelection(), dropCursor(),
      EditorState.allowMultipleSelections.of(true), indentOnInput(), indentUnit.of('    '),
      syntaxHighlighting(classHighlighter), bracketMatching(), closeBrackets(),
      autocompletion({ override: [source], activateOnTyping: true, maxRenderedOptions: 80 }),
      rectangularSelection(), crosshairCursor(), highlightActiveLine(), highlightActiveLineGutter(),
      highlightSelectionMatches(), search({ top: true }),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
      python(), hover, activeField, errField, animField,
      EditorView.lineWrapping,
      // Ctrl-click or Cmd-click on a name opens it in the reference panel.
      EditorView.domEventHandlers({
        mousedown(e, view) {
          if (!(e.metaKey || e.ctrlKey) || e.button !== 0) return false;
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos == null) return false;
          const line = view.state.doc.lineAt(pos);
          const name = dottedAt(line.text, pos - line.from);
          if (!name) return false;
          e.preventDefault();
          onDoc(name);
          return true;
        },
      }),
      EditorView.contentAttributes.of({ 'aria-label': 'Manim code', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
      EditorView.updateListener.of(u => {
        if (u.docChanged) onChange(u.state.doc.toString());
        if (u.selectionSet && !u.docChanged && u.transactions.some(t => t.isUserEvent('select.pointer'))) {
          const n = u.state.doc.lineAt(u.state.selection.main.head).number;
          if (u.state.field(animField).has(n)) onLineClick(n, { pointer: true });
        }
      }),
    ],
  });
  const view = new EditorView({ state, parent });

  const api = {
    view,
    getCode: () => view.state.doc.toString(),
    setCode(code) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code }, selection: { anchor: 0 }, effects: [setAnim.of(new Set()), setActive.of(null), setErrLine.of(null)] });
      view.dispatch(setDiagnostics(view.state, []));
      view.scrollDOM.scrollTop = 0;
    },
    markError(line, message) {
      if (!line || line < 1 || line > view.state.doc.lines) return;
      const l = view.state.doc.line(line);
      view.dispatch(setDiagnostics(view.state, [{ from: l.from, to: l.to, severity: 'error', message: message || 'Error' }]));
      view.dispatch({ effects: [setErrLine.of(line), EditorView.scrollIntoView(l.from, { y: 'center' })] });
    },
    clearError() {
      view.dispatch(setDiagnostics(view.state, []));
      view.dispatch({ effects: setErrLine.of(null) });
    },
    setActiveLine(line, scroll = false) {
      const effects = [setActive.of(line)];
      if (scroll && line && line <= view.state.doc.lines) effects.push(EditorView.scrollIntoView(view.state.doc.line(line).from, { y: 'nearest' }));
      view.dispatch({ effects });
    },
    setAnimLines(set) { view.dispatch({ effects: setAnim.of(new Set(set)) }); },
    gotoLine(line) {
      if (!line || line > view.state.doc.lines) return;
      const l = view.state.doc.line(line);
      view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
      view.focus();
    },
    focus: () => view.focus(),
    setNames(list) { names = (list || []).filter(x => x && x.name && !x.name.startsWith('_')); },
    setBackends({ complete: c, introspect: i }) { if (c) complete = c; if (i) introspect = i; },
  };
  return api;
}

function firstPara(doc) {
  const t = String(doc || '').trim().split(/\n\s*\n/)[0] || '';
  return t.length > 600 ? t.slice(0, 600) + '…' : t;
}
