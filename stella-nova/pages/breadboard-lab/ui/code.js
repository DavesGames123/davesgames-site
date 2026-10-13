// ============================================================================
//  BREADBOARD LAB  ·  ui/code.js — the CODE panel (sketch editor)
// ----------------------------------------------------------------------------
//  One sketch per microcontroller part (Doc.programs[partId], CONTRACT 3.3).
//  The editor is a textarea over a highlighted <pre> (the same text, so the
//  caret and the colours line up), with a line-number gutter.
//
//    VERIFY .. compileSketch(source, { board }) here on the main thread; the
//              errors list their line numbers (click one to jump there)
//    UPLOAD .. verify, then store op { op:'program', id, program }: main.js
//              hands it to sim.loadProgram, and the board restarts (Cmd/Ctrl
//              + Enter does the same)
//  The editor also checks the sketch quietly 700 ms after typing stops, and
//  marks error lines in the gutter. A run-time error of the board (Frame
//  .mcus[id].error, 'line N: …') marks its line too.
//
//  Keys typed in the editor never reach the bench shortcuts. Tab indents by
//  two spaces; Enter keeps the indent of the line.
//
//  Drafts: an edit that is not uploaded stays in the panel per board (a dot
//  on the board selector) until UPLOAD or REVERT.
//
//  LOAD HEX (328 boards): a .hex file built elsewhere becomes the program
//  { lang:'hex', hex } and runs on the avr8js CPU (mcu/avr.js). The editor
//  then shows the HEX summary; EDIT SKETCH goes back to the sketch.
//
//  GREP MAP
//    KW / TYPES / API ..... the highlight word lists
//    highlight ............ source -> HTML (tested)
//    createCode ........... the panel
//    verify / upload ...... compile, show errors, store op
//    markLines ............ gutter numbers and error bands
// ============================================================================
import { h, makePanel, btn, sec, note } from './panels.js';
import { esc } from './format.js';
import { pickFile } from './files.js';
import { parseHex } from '../mcu/avr.js';
import { createSerial } from './serial.js';
import { SKETCHES, STARTERS } from '../mcu/sketches.js';

const KW = 'if|else|for|while|do|switch|case|default|break|continue|return|const|static|volatile|sizeof|true|false|HIGH|LOW|INPUT|OUTPUT|INPUT_PULLUP|LED_BUILTIN|CHANGE|RISING|FALLING|MSBFIRST|LSBFIRST|DEC|HEX|BIN|OCT|PI|NULL|enum';
const TYPES = 'void|int|long|unsigned|short|char|byte|word|bool|boolean|float|double|String|size_t|uint8_t|int8_t|uint16_t|int16_t|uint32_t|int32_t|signed|LiquidCrystal|Servo';
const API = 'pinMode|digitalWrite|digitalRead|analogRead|analogWrite|delay|delayMicroseconds|millis|micros|tone|noTone|pulseIn|shiftOut|shiftIn|map|constrain|min|max|abs|random|randomSeed|attachInterrupt|detachInterrupt|digitalPinToInterrupt|bitRead|bitWrite|bitSet|bitClear|Serial|setup|loop|ledcAttach|ledcWrite|sprintf|sqrt|pow|sin|cos';
const RE = new RegExp(`(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)|("(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*')|(^[ \\t]*#[^\\n]*)|\\b(0[xX][0-9a-fA-F]+|0[bB][01]+|\\d+\\.?\\d*(?:[eE][+-]?\\d+)?[uUlLfF]*)\\b|\\b(${TYPES})\\b|\\b(${KW})\\b|\\b(${API})\\b`, 'gm');

export function highlight(src) {
  let out = '', last = 0;
  src.replace(RE, (m, com, str, pre, num, ty, kw, api, off) => {
    out += esc(src.slice(last, off));
    const cls = com ? 'c' : str ? 's' : pre ? 'p' : num ? 'n' : ty ? 't' : kw ? 'k' : 'f';
    out += `<span class="${cls}">${esc(m)}</span>`;
    last = off + m.length;
    return m;
  });
  return out + esc(src.slice(last)) + '\n';
}

const BOARD_NAME = { uno328: 'Uno-layout 328', nano328: 'Nano-layout 328', esp32dev: 'ESP32 devkit' };

export function createCode(C) {
  const P = makePanel({ id: 'p-code', title: 'Code', cls: 'code-panel', onClose: () => C.panels.close('code') });
  let cur = null;                       // part id
  const drafts = new Map();             // part id -> source not yet uploaded
  let errs = [], warns = [], runErr = null, quiet = null;
  const LH = 18.75;

  const boardSel = h('select.sq.sel', { 'aria-label': 'Board' });
  boardSel.addEventListener('change', () => { select(boardSel.value); });
  const exSel = h('select.sq.sel', { 'aria-label': 'Insert an example sketch', style: { maxWidth: '150px' } });
  exSel.addEventListener('change', () => {
    const k = exSel.value; exSel.value = '';
    if (!k || !cur) return;
    const s = k === 'starter' ? STARTERS[boardOf()] : SKETCHES[k].source;
    setSource(s, true);
    C.toast('info', 'Example loaded into the editor. UPLOAD runs it.');
  });
  const verifyBtn = btn('Verify', { cls: 'small', title: 'Compile and list the errors', onClick: () => verify(true) });
  const uploadBtn = btn('Upload', { cls: 'small.primary', title: 'Compile and run it on the board (Cmd/Ctrl+Enter)', onClick: () => upload() });
  const revertBtn = btn('Revert', { cls: 'small', title: 'Back to the sketch on the board', onClick: () => { drafts.delete(cur); load(); } });
  const hexBtn = btn('Load .hex', { cls: 'small', title: 'Run a compiled .hex file (for example the Arduino IDE "Export compiled binary") on this 328 board', onClick: () => loadHex() });
  const hexBox = h('div');
  async function loadHex() {
    if (!cur) return;
    let text;
    try { text = await pickFile('.hex,.ihex,text/plain'); } catch (e) { return; }
    let info;
    try { info = parseHex(text); } catch (e) { C.toast('error', e.message); return; }
    C.store.apply({ op: 'program', id: cur, program: { lang: 'hex', hex: text } });
    C.toast('info', `Loaded ${info.size} bytes of flash onto ${C.partName(cur)}. The board restarts.`);
    load();
  }
  const gutter = h('div.gutter', { 'aria-hidden': 'true' });
  const pre = h('pre', { 'aria-hidden': 'true' });
  const bands = h('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '0' } });
  const ta = h('textarea', { spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': 'Sketch source' });
  const wrap = h('div.editor-wrap', {}, bands, pre, ta);
  const editor = h('div.sq.editor', {}, gutter, wrap);
  const status = h('div.meas');
  const errList = h('ul.errs');
  const serial = createSerial(C, () => cur);
  const empty = note('Add a microcontroller board from the LIBRARY (MCU) to write a sketch for it.');
  const body = h('div', {}, h('div.code-top', {}, boardSel, exSel, verifyBtn, uploadBtn, revertBtn, hexBtn), hexBox, editor, status, errList, sec('Serial'), serial.el);
  P.body.append(empty, body);

  const boardOf = () => { const p = C.store.doc.parts.find(q => q.id === cur); return p ? C.boardOf(p.def) : 'uno328'; };
  const mcuParts = () => C.store.doc.parts.filter(p => C.isMcu(p.def));

  function paintText() {
    const src = ta.value;
    pre.innerHTML = highlight(src);
    const n = src.split('\n').length;
    const bad = new Set(errs.map(e => e.line)), w = new Set(warns.map(e => e.line));
    const rl = runErr ? runErr.line : 0;
    let g = '';
    for (let i = 1; i <= n; i++) g += (bad.has(i) || i === rl ? `<span class="e">${i}</span>` : w.has(i) ? `<span class="w">${i}</span>` : String(i)) + '\n';
    gutter.innerHTML = g;
    markLines();
    syncScroll();
  }
  function markLines() {
    bands.innerHTML = '';
    const lines = new Set([...errs.map(e => e.line), ...(runErr ? [runErr.line] : [])].filter(Boolean));
    for (const l of lines) bands.appendChild(h('div', { style: { position: 'absolute', left: '0', right: '0', height: LH + 'px', top: (8 + (l - 1) * LH - ta.scrollTop) + 'px', background: 'rgba(226,71,78,.14)', boxShadow: 'inset 2px 0 0 var(--bad)' } }));
  }
  function syncScroll() { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; gutter.scrollTop = ta.scrollTop; markLines(); }
  ta.addEventListener('scroll', syncScroll);
  ta.addEventListener('input', () => { if (cur) drafts.set(cur, ta.value); paintText(); scheduleQuiet(); syncSel(); });
  ta.addEventListener('keydown', e => {
    e.stopPropagation();
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); upload(); return; }
    if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); upload(); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      const a = ta.selectionStart, b = ta.selectionEnd;
      ta.setRangeText('  ', a, b, 'end');
      ta.dispatchEvent(new Event('input'));
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      const a = ta.selectionStart, line = ta.value.slice(ta.value.lastIndexOf('\n', a - 1) + 1, a);
      let ind = (/^[ \t]*/.exec(line) || [''])[0];
      if (/\{\s*$/.test(line)) ind += '  ';
      e.preventDefault();
      ta.setRangeText('\n' + ind, a, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input'));
    }
  });
  function scheduleQuiet() { clearTimeout(quiet); quiet = setTimeout(() => verify(false), 700); }
  function setSource(s, asDraft) { ta.value = s; if (asDraft && cur) drafts.set(cur, s); errs = []; warns = []; paintText(); verify(false); syncSel(); }
  function verify(show) {
    if (!cur) return null;
    const r = C.mcu.compileSketch(ta.value, { board: boardOf() });
    errs = r.errors || []; warns = r.warnings || [];
    paintText();
    errList.innerHTML = '';
    const items = [...errs.map(e => ['', e]), ...warns.map(e => ['w', e])];
    if (show && !items.length) errList.appendChild(h('li.sq.ok', {}, `Compiled for the ${BOARD_NAME[boardOf()]}: no errors.`));
    for (const [cls, e] of items.slice(0, 20)) {
      const li = h(`li.sq${cls ? '.' + cls : ''}`, {}, h('b', {}, e.line ? `line ${e.line}` : 'sketch'), e.msg);
      li.addEventListener('click', () => jump(e.line));
      errList.appendChild(li);
    }
    return r;
  }
  function jump(line) {
    if (!line) return;
    const L = ta.value.split('\n');
    const a = L.slice(0, line - 1).reduce((s, x) => s + x.length + 1, 0);
    ta.focus(); ta.setSelectionRange(a, a + (L[line - 1] || '').length);
    ta.scrollTop = Math.max(0, (line - 4) * LH);
    syncScroll();
  }
  function upload() {
    if (!cur) return;
    const r = verify(true);
    if (!r || !r.ok) { C.toast('warn', `The sketch has ${errs.length} error${errs.length === 1 ? '' : 's'}; nothing was uploaded.`); return; }
    C.store.apply({ op: 'program', id: cur, program: { lang: 'sketch', source: ta.value } });
    drafts.delete(cur);
    runErr = null;
    syncSel();
    C.toast('info', `Uploaded to ${C.partName(cur)}. The board restarts.`);
  }
  function load() {
    if (!cur) return;
    const prog = C.store.doc.programs && C.store.doc.programs[cur];
    hexBtn.hidden = boardOf() === 'esp32dev';
    hexBox.innerHTML = '';
    const isHex = prog && prog.lang === 'hex' && !drafts.has(cur);
    editor.hidden = errList.hidden = verifyBtn.hidden = uploadBtn.hidden = revertBtn.hidden = exSel.hidden = !!isHex;
    if (isHex) {
      let size = 0; try { size = parseHex(prog.hex).size; } catch (e) { size = 0; }
      hexBox.append(note(`A compiled HEX program runs on this board (${size} bytes of flash, on the ATmega328P emulator).`),
        btn('Edit sketch instead', { cls: 'small', onClick: () => { drafts.set(cur, STARTERS[boardOf()]); load(); } }));
      return;
    }
    const src = drafts.has(cur) ? drafts.get(cur) : prog && prog.lang === 'sketch' ? prog.source : STARTERS[boardOf()];
    ta.value = src; errs = []; warns = []; runErr = null;
    paintText(); verify(false);
  }
  function syncSel() {
    const L = mcuParts();
    boardSel.innerHTML = '';
    for (const p of L) boardSel.appendChild(h('option', { value: p.id }, `${drafts.has(p.id) ? '● ' : ''}${C.partName(p.id)} · ${BOARD_NAME[C.boardOf(p.def)] || p.def}`));
    if (cur) boardSel.value = cur;
  }
  function fillExamples() {
    exSel.innerHTML = '';
    exSel.appendChild(h('option', { value: '' }, 'Examples…'));
    exSel.appendChild(h('option', { value: 'starter' }, 'Blink (starter)'));
    for (const [k, s] of Object.entries(SKETCHES)) if (s.board === boardOf() || (s.board !== 'esp32dev' && boardOf() !== 'esp32dev')) exSel.appendChild(h('option', { value: k }, k));
  }
  function select(id) {
    if (cur && cur !== id && ta.value !== undefined) { const prog = C.store.doc.programs && C.store.doc.programs[cur]; if (!prog || prog.source !== ta.value) drafts.set(cur, ta.value); }
    cur = id; syncSel(); fillExamples(); load(); serial.paint();
    P.setTitle(cur ? `Code · ${C.partName(cur)}` : 'Code');
  }
  function refresh() {
    const L = mcuParts();
    empty.hidden = !!L.length; body.hidden = !L.length;
    if (!L.length) { cur = null; return; }
    if (!cur || !L.some(p => p.id === cur)) select(L[0].id); else syncSel();
  }
  refresh();
  return {
    key: 'code', title: 'CODE', icon: 'code', col: 'right', el: P.el,
    show(id) { refresh(); if (id) select(id); },
    serial(mcu, text) { serial.append(mcu, text); },
    frame(F) {
      if (!cur || !F || !F.mcus || !F.mcus[cur]) { status.textContent = ''; return; }
      const m = F.mcus[cur];
      const e = m.error ? /line (\d+)/.exec(m.error) : null;
      const ne = m.error ? { line: e ? +e[1] : 0, msg: m.error } : null;
      if (JSON.stringify(ne) !== JSON.stringify(runErr)) { runErr = ne; paintText(); }
      status.innerHTML = m.error ? `<b style="color:var(--bad)">stopped</b> ${esc(m.error)}` : `<b>${m.running ? 'running' : 'idle'}</b> · millis ${m.millis}`;
    },
    update(reason) { if (reason === 'doc') { const before = cur; refresh(); if (before === cur && cur && !drafts.has(cur) && document.activeElement !== ta) { const prog = C.store.doc.programs && C.store.doc.programs[cur]; if (prog && prog.source !== ta.value) load(); } } }
  };
}
