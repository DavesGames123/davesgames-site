// ============================================================================
//  SCIENCE TOOLKIT  ·  pad.js  ·  the scratchpad (a notebook of lines)
// ----------------------------------------------------------------------------
//  The main surface of the page. Each line is one text input. After each
//  edit (debounced) every line goes through intent.js again, because a
//  variable on one line changes the lines below it. Only the answer
//  blocks that changed are drawn again, so focus and inline forms stay.
//
//  Under a line:
//    value   "= answer", the method line, [copy] and [method]. [method]
//            opens the full method of the tool behind the answer: result
//            rows, plots, TeX, the method text and the references.
//    form    the tool form, live, when the line needs more inputs or is
//            a tool name. Its values stay with the line.
//    error   the message and buttons for the tools that match the words.
//
//  KEYS  Enter: new line below (or take the marked suggestion).
//        Backspace on an empty line: delete it. Up and Down: move between
//        lines (or through the suggestions). Tab: take a suggestion.
//        Esc: close the suggestions.
//
//  STORE  localStorage "sci-tools.pad.v1" (in try/catch) keeps the lines
//         and the form values. main.js puts the line text in the URL
//         hash (#pad=...) for a link. Nothing leaves the device.
//
//  GREP MAP
//    grep -n "export function initPad"   the API for main.js and sheet.js
//    grep -n "function evaluate"         all lines through intent.js
//    grep -n "function answerHTML"       the block under a line
//    grep -n "function openForm"         a tool form under a line
//    grep -n "function openMethod"       the full method under a line
//    grep -n "function showSuggest"      suggestions while typing
//    grep -n "function onKey"            keys in a line
//    grep -n "function insert"           text into the current line (tables)
// ============================================================================
import { evalNotebook, suggest, EXAMPLES, STARTER, DEFS, toolVals } from './intent.js';
import { BY_ID } from './registry.js';
import { esc } from './kit.js';
import { field, valueOf, rowsHTML, texInto, copyText } from './view.js';

const KEY = 'sci-tools.pad.v1';
const PLACEHOLDER = 'Type here: 500 nm photon in eV · molar mass NaCl · 3 ft to m';
const TRY = ['500 nm photon in eV', 'molar mass CuSO4·5H2O', 'dilute 2 M HCl to 0.5 M, 50 mL', 'pH of 0.1 M acetic acid', 'balance Fe + O2 -> Fe2O3', 'h*c/500 nm in eV', 'mean 5.1 4.9 6.2 5.8 6.0', 'ideal gas 1 mol, 0 degC, 1 atm'];

let uid = 0;
const mk = (t = '', f = null) => ({ id: ++uid, t, f, sig: '', res: null, open: false });

function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && Array.isArray(s.lines)) return s.lines.map(l => mk(String(l.t ?? ''), l.f && typeof l.f === 'object' ? l.f : null));
  } catch (e) { /* storage blocked */ }
  return null;
}

export function initPad({ root, onOpenTool, onChange }) {
  const list = root.querySelector('#lines');
  let lines = [];
  let focusId = null, timer = 0;
  let sug = { id: null, items: [], sel: -1 };

  const byId = (id) => lines.find(l => l.id === id);
  const liOf = (l) => list.querySelector(`li[data-id="${l.id}"]`);
  const inputOf = (l) => liOf(l)?.querySelector('input.src');

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, lines: lines.map(l => (l.f ? { t: l.t, f: l.f } : { t: l.t })) })); }
    catch (e) { /* storage blocked */ }
  }
  const textOf = () => lines.map(l => l.t).join('\n').replace(/\n+$/, '');

  // Keep exactly one empty line at the end, for typing.
  function ensureTail() {
    if (!lines.length || lines[lines.length - 1].t) lines.push(mk());
  }

  function lineLI(l, i) {
    const li = document.createElement('li');
    li.className = 'ln'; li.dataset.id = l.id;
    li.innerHTML = `<div class="row"><span class="gut" aria-hidden="true">${i + 1}</span><input class="src" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Line ${i + 1}"><button class="del" type="button" data-del aria-label="Delete line ${i + 1}">×</button></div><div class="ans"></div>`;
    const inp = li.querySelector('input');
    inp.value = l.t;
    return li;
  }

  // Draw the list again (after lines are added or removed).
  function rebuild() {
    ensureTail();
    const keepFocus = byId(focusId);
    const caret = keepFocus && document.activeElement === inputOf(keepFocus) ? inputOf(keepFocus).selectionStart : null;
    list.replaceChildren(...lines.map((l, i) => { l.sig = ''; return lineLI(l, i); }));
    lines.forEach((l, i) => { const inp = inputOf(l); inp.placeholder = i === lines.length - 1 ? PLACEHOLDER : ''; });
    evaluate();
    if (keepFocus && caret != null) focusLine(keepFocus, caret);
  }

  function renumber() {
    [...list.children].forEach((li, i) => {
      li.querySelector('.gut').textContent = i + 1;
      const inp = li.querySelector('input');
      inp.setAttribute('aria-label', `Line ${i + 1}`);
      inp.placeholder = i === list.children.length - 1 ? PLACEHOLDER : '';
    });
  }

  function focusLine(l, pos = null) {
    const inp = inputOf(l);
    if (!inp) return;
    inp.focus();
    const p = pos == null ? inp.value.length : pos;
    try { inp.setSelectionRange(p, p); } catch (e) { /* jsdom */ }
    focusId = l.id;
  }

  // ── evaluation ──────────────────────────────────────────────────────────
  function evaluate() {
    const res = evalNotebook(lines.map(l => l.t));
    lines.forEach((l, i) => {
      const r = res[i];
      const sig = JSON.stringify([r.kind, r.answer, r.method, r.error, r.note, r.tool, r.vals, r.alt]);
      l.res = r;
      const li = liOf(l);
      if (!li) return;
      li.classList.toggle('note', r.kind === 'note');
      li.classList.toggle('bad', r.kind === 'error');
      if (sig === l.sig) return;
      // A form for other values starts again from the line's values.
      if (l.f && (r.kind !== 'form' || l.f.tool !== r.tool || JSON.stringify(l.f.base) !== JSON.stringify(r.vals))) l.f = null;
      l.sig = sig;
      l.open = l.open && r.kind === 'value';
      drawAnswer(l);
    });
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => { evaluate(); save(); onChange && onChange(textOf()); }, 90);
  }

  function answerHTML(l) {
    const r = l.res;
    if (!r || r.kind === 'blank' || r.kind === 'note') return '';
    if (r.kind === 'error') {
      const alt = (r.alt || []).filter(id => BY_ID[id]);
      return `<div class="msg">${esc(r.error)}</div>${alt.length ? `<div class="alt"><span class="dim">Open a tool:</span> ${alt.map(id => `<button type="button" class="chip" data-tool="${id}">${esc(BY_ID[id].name)}</button>`).join('')}</div>` : ''}`;
    }
    if (r.kind === 'form') {
      return `<div class="msg form-note">${esc(r.note || '')}</div><div class="inl"><form class="iform" autocomplete="off" onsubmit="return false"></form><div class="ierr" hidden></div><div class="iout"></div><div class="actions"><button type="button" class="mini" data-full>open full tool</button></div></div>`;
    }
    const copy = r.answer || '';
    return `<div class="a"><span class="eq" aria-hidden="true">=</span><output class="v">${esc(r.answer || '')}</output><span class="btns"><button type="button" class="mini" data-copy="${esc(copy)}" aria-label="Copy the answer">copy</button>${r.tool ? `<button type="button" class="mini" data-more aria-expanded="${l.open}">method</button>` : ''}</span></div>${r.method ? `<div class="how">${esc(r.method)}</div>` : ''}<div class="more" ${l.open ? '' : 'hidden'}></div>`;
  }

  function drawAnswer(l) {
    const li = liOf(l);
    if (!li) return;
    const box = li.querySelector('.ans');
    box.innerHTML = answerHTML(l);
    box.className = `ans k-${l.res ? l.res.kind : 'blank'}`;
    if (l.res && l.res.kind === 'form') openForm(l);
    if (l.open) openMethod(l);
  }

  // ── a tool form under a line ────────────────────────────────────────────
  function openForm(l) {
    const r = l.res, def = DEFS[r.tool];
    const li = liOf(l), formEl = li.querySelector('.iform');
    if (!l.f) l.f = { tool: r.tool, base: r.vals, vals: { ...r.vals } };
    const els = {};
    formEl.replaceChildren();
    for (const inp of def.inputs) {
      const [w, el] = field(inp, l.f.vals[inp.k] ?? inp.def ?? '', `p${l.id}-`);
      els[inp.k] = el;
      formEl.append(w);
    }
    const run = () => {
      for (const inp of def.inputs) l.f.vals[inp.k] = valueOf(els[inp.k], inp);
      const err = li.querySelector('.ierr'), out = li.querySelector('.iout');
      try {
        const res = def.run(toolVals(r.tool, l.f.vals)) || {};
        err.hidden = true;
        out.innerHTML = rowsHTML((res.rows || []).slice(0, 8)) + [].concat(res.svg || []).slice(0, 1).map(s => `<div class="fig">${s}</div>`).join('');
      } catch (e) { err.textContent = e.message || String(e); err.hidden = false; out.innerHTML = ''; }
    };
    let t = 0;
    const later = () => { clearTimeout(t); t = setTimeout(() => { run(); save(); }, 120); };
    formEl.addEventListener('input', later);
    formEl.addEventListener('change', later);
    run();
  }

  // ── the full method under a line ────────────────────────────────────────
  function openMethod(l) {
    const r = l.res, def = DEFS[r.tool];
    const box = liOf(l)?.querySelector('.more');
    if (!box || !def) return;
    let res = null, err = '';
    try { res = def.run(toolVals(r.tool, r.vals)) || {}; } catch (e) { err = e.message; }
    const parts = [];
    if (err) parts.push(`<div class="msg">${esc(err)}</div>`);
    if (res) {
      parts.push(rowsHTML(res.rows));
      for (const s of [].concat(res.svg || [])) parts.push(`<div class="fig">${s}</div>`);
      if (res.html) parts.push(`<div class="scroll">${res.html}</div>`);
    }
    parts.push(`<h4>${esc(BY_ID[r.tool].name)}: method</h4><div class="eqs">${(def.tex || []).map(() => '<div class="sci-eq"></div>').join('')}</div><p class="howto">${esc(def.how || '')}</p>`);
    parts.push(`<h4>References</h4><ol class="refs">${(def.refs || []).map(x => `<li>${esc(x)}</li>`).join('')}</ol><div class="actions"><button type="button" class="mini" data-full>open full tool</button></div>`);
    box.innerHTML = parts.join('');
    box.hidden = false;
    [...box.querySelectorAll('.eqs .sci-eq')].forEach((el, i) => texInto(el, def.tex[i], true));
    box.querySelectorAll('[data-tex]').forEach(el => texInto(el, el.dataset.tex, !('inline' in el.dataset)));
  }

  // ── suggestions ─────────────────────────────────────────────────────────
  function hideSuggest() {
    sug = { id: null, items: [], sel: -1 };
    list.querySelectorAll('.sugg').forEach(x => x.remove());
  }
  function showSuggest(l) {
    const items = l.t.trim().length >= 2 && !/=/.test(l.t) ? suggest(l.t, 6) : [];
    list.querySelectorAll('.sugg').forEach(x => x.remove());
    if (!items.length || (l.res && l.res.kind === 'value' && items.every(it => !it.text.toLowerCase().startsWith(l.t.trim().toLowerCase())))) { sug = { id: null, items: [], sel: -1 }; return; }
    sug = { id: l.id, items, sel: sug.id === l.id ? Math.min(sug.sel, items.length - 1) : -1 };
    const ul = document.createElement('ul');
    ul.className = 'sugg'; ul.setAttribute('role', 'listbox');
    ul.innerHTML = items.map((it, i) => `<li role="option" data-s="${i}" aria-selected="${i === sug.sel}">${esc(it.text)}${it.kind === 'tool' ? ' <em>tool</em>' : ''}</li>`).join('') + '<li class="hint dim" aria-hidden="true">Tab takes the first · ↓ then Enter takes one</li>';
    liOf(l).querySelector('.row').after(ul);
  }
  function takeSuggest(i) {
    const l = byId(sug.id), it = sug.items[i];
    if (!l || !it) return;
    l.t = it.text;
    inputOf(l).value = it.text;
    hideSuggest();
    focusLine(l);
    evaluate(); save(); onChange && onChange(textOf());
  }

  // ── keys and events ─────────────────────────────────────────────────────
  function onKey(e) {
    const inp = e.target.closest('input.src');
    if (!inp) return;
    const l = byId(Number(inp.closest('li').dataset.id));
    const i = lines.indexOf(l);
    const open = sug.id === l.id && sug.items.length;
    if (open && e.key === 'ArrowDown') { sug.sel = Math.min(sug.items.length - 1, sug.sel + 1); showSuggest(l); e.preventDefault(); return; }
    if (open && e.key === 'ArrowUp' && sug.sel >= 0) { sug.sel -= 1; showSuggest(l); e.preventDefault(); return; }
    if (open && e.key === 'Tab' && !e.shiftKey) { takeSuggest(Math.max(0, sug.sel)); e.preventDefault(); return; }
    if (open && e.key === 'Enter' && sug.sel >= 0) { takeSuggest(sug.sel); e.preventDefault(); return; }
    if (e.key === 'Escape' && open) { hideSuggest(); e.preventDefault(); e.stopPropagation(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      hideSuggest();
      const pos = inp.selectionStart ?? inp.value.length;
      const rest = inp.value.slice(pos);
      if (rest) { l.t = inp.value.slice(0, pos); inp.value = l.t; }
      const n = mk(rest);
      lines.splice(i + 1, 0, n);
      focusId = n.id;
      rebuild();
      focusLine(n, 0);
      save(); onChange && onChange(textOf());
      return;
    }
    if (e.key === 'Backspace' && inp.selectionStart === 0 && inp.selectionEnd === 0 && i > 0) {
      e.preventDefault();
      const prev = lines[i - 1], at = prev.t.length;
      prev.t += l.t;
      lines.splice(i, 1);
      focusId = prev.id;
      rebuild();
      focusLine(prev, at);
      save(); onChange && onChange(textOf());
      return;
    }
    if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); hideSuggest(); focusLine(lines[i - 1]); return; }
    if (e.key === 'ArrowDown' && i < lines.length - 1) { e.preventDefault(); hideSuggest(); focusLine(lines[i + 1]); }
  }

  list.addEventListener('keydown', onKey);
  list.addEventListener('input', (e) => {
    const inp = e.target.closest('input.src');
    if (!inp) return;
    const l = byId(Number(inp.closest('li').dataset.id));
    l.t = inp.value;
    focusId = l.id;
    if (l === lines[lines.length - 1] && l.t) { lines.push(mk()); const li = lineLI(lines[lines.length - 1], lines.length - 1); list.append(li); renumber(); }
    evaluateSoon(l);
  });
  // Evaluate the edited line at once for the suggestions; all lines later.
  function evaluateSoon(l) {
    schedule();
    showSuggest(l);
  }
  list.addEventListener('focusin', (e) => {
    const inp = e.target.closest('input.src');
    if (inp) focusId = Number(inp.closest('li').dataset.id);
  });
  list.addEventListener('focusout', (e) => {
    if (e.target.closest('input.src')) setTimeout(() => { if (!list.contains(document.activeElement) || !document.activeElement.closest('input.src')) hideSuggest(); }, 160);
  });
  list.addEventListener('paste', (e) => {
    const inp = e.target.closest('input.src');
    const text = e.clipboardData && e.clipboardData.getData('text');
    if (!inp || !text || !/\n/.test(text)) return;
    e.preventDefault();
    const l = byId(Number(inp.closest('li').dataset.id));
    const parts = text.replace(/\r/g, '').split('\n');
    // A column of numbers is one data line; other text is one line per row.
    if (parts.every(p => /^\s*[-+−\d.eE,;\s]*$/.test(p))) insert(parts.join(' ').replace(/\s+/g, ' ').trim());
    else {
      const pos = inp.selectionStart ?? inp.value.length;
      const head = inp.value.slice(0, pos), tail = inp.value.slice(inp.selectionEnd ?? pos);
      l.t = head + parts[0];
      const i = lines.indexOf(l);
      const added = parts.slice(1).map((p, k) => mk(k === parts.length - 2 ? p + tail : p));
      lines.splice(i + 1, 0, ...added);
      rebuild();
      focusLine(added.length ? added[added.length - 1] : l);
      save(); onChange && onChange(textOf());
    }
  });
  list.addEventListener('mousedown', (e) => { if (e.target.closest('.sugg li[data-s]')) e.preventDefault(); });
  list.addEventListener('click', (e) => {
    const s = e.target.closest('.sugg li[data-s]');
    if (s) { takeSuggest(Number(s.dataset.s)); return; }
    const li = e.target.closest('li.ln');
    if (!li) return;
    const l = byId(Number(li.dataset.id));
    const c = e.target.closest('[data-copy]');
    if (c) { copyText(c.dataset.copy, c); return; }
    if (e.target.closest('[data-del]')) {
      if (lines.length > 1) { lines.splice(lines.indexOf(l), 1); rebuild(); }
      else { l.t = ''; l.f = null; rebuild(); }
      save(); onChange && onChange(textOf());
      return;
    }
    const m = e.target.closest('[data-more]');
    if (m) {
      l.open = !l.open;
      m.setAttribute('aria-expanded', String(l.open));
      if (l.open) openMethod(l); else li.querySelector('.more').hidden = true;
      return;
    }
    const full = e.target.closest('[data-full]');
    if (full) { const r = l.res; onOpenTool && onOpenTool(r.tool, r.kind === 'form' && l.f ? l.f.vals : r.vals); return; }
    const tool = e.target.closest('[data-tool]');
    if (tool) { l.t = BY_ID[tool.dataset.tool].name.toLowerCase(); inputOf(l).value = l.t; evaluate(); save(); onChange && onChange(textOf()); }
  });

  // ── insertion from the tables ───────────────────────────────────────────
  // Text goes in at the caret of the current line, with a space on each
  // side when it touches a word.
  function insert(text) {
    let l = byId(focusId);
    if (!l) l = lines[lines.length - 1];
    const inp = inputOf(l);
    const a = inp.selectionStart ?? inp.value.length, b = inp.selectionEnd ?? a;
    const before = inp.value.slice(0, a), after = inp.value.slice(b);
    const pre = before && !/[\s(]$/.test(before) ? ' ' : '', post = after && !/^[\s)]/.test(after) ? ' ' : '';
    inp.value = before + pre + text + post + after;
    l.t = inp.value;
    if (l === lines[lines.length - 1]) { lines.push(mk()); list.append(lineLI(lines[lines.length - 1], lines.length - 1)); renumber(); }
    focusLine(l, (before + pre + text).length);
    evaluate(); save(); onChange && onChange(textOf());
    return `line ${lines.indexOf(l) + 1}`;
  }

  function setLines(texts, forms = null) {
    lines = texts.map((t, i) => mk(t, forms ? forms[i] || null : null));
    focusId = null;
    rebuild();
  }

  // Starter text: the URL hash wins, then the store, then the examples.
  function boot(hashText) {
    if (hashText != null) { setLines(hashText.split('\n')); return 'hash'; }
    const st = loadStore();
    if (st && st.length) { lines = st; rebuild(); return 'store'; }
    setLines(STARTER.slice());
    return 'starter';
  }

  const tryRow = root.querySelector('#tryRow');
  if (tryRow) {
    tryRow.innerHTML = '<span class="dim">Try:</span> ' + TRY.map(t => `<button type="button" data-try="${esc(t)}">${esc(t)}</button>`).join('');
    tryRow.addEventListener('click', (e) => {
      const b = e.target.closest('[data-try]');
      if (!b) return;
      const last = lines[lines.length - 1];
      last.t = b.dataset.try;
      lines.push(mk());
      rebuild();
      focusLine(lines[lines.length - 1]);
      save(); onChange && onChange(textOf());
    });
  }

  return {
    boot, insert, setLines, evaluate,
    get text() { return textOf(); },
    get lines() { return lines; },
    clear() { setLines(['']); save(); onChange && onChange(''); },
    focusLast() { focusLine(lines[lines.length - 1]); },
    EXAMPLES,
  };
}
