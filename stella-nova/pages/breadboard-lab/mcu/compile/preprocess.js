// ============================================================================
//  BREADBOARD LAB  ·  mcu/compile/preprocess.js — #define, #if family, #include check, macro expansion
// ----------------------------------------------------------------------------
//  preprocess(toks, board, warnings) -> { toks, libs }. libs holds the
//  library classes that #include made available (LiquidCrystal, Servo).
//
//  grep -n targets
//    LIBS ................. the headers a sketch can #include
//    preprocess ........... the export
//    collectArgs .......... the args of a function-like macro
//    substitute ........... # and ## and parameter replacement
//    expandOne ............ expand one macro use
//    evalIf ............... the #if expression
//    directive ............ one # line
// ============================================================================
import { BOARDS } from '../boards.js';
import { CErr } from './errors.js';
import { lex } from './lex.js';

export const LIBS = {
  'Arduino.h': null, 'math.h': null, 'stdint.h': null, 'stdlib.h': null, 'string.h': null, 'stdio.h': null,
  'inttypes.h': null, 'avr/pgmspace.h': null, 'pgmspace.h': null, 'stdbool.h': null, 'ctype.h': null,
  'LiquidCrystal.h': 'LiquidCrystal', 'Servo.h': 'Servo', 'ESP32Servo.h': 'Servo'
};
const LIB_LIST = 'LiquidCrystal.h, Servo.h (ESP32Servo.h on the ESP32), and the C headers math.h, stdint.h, stdlib.h, string.h';

function preprocess(toks, board, warnings) {
  const B = BOARDS[board];
  const macros = new Map();
  const def = (name, v) => macros.set(name, { params: null, body: [{ k: 'num', v, num: { isFloat: false, radix: 10, u: false, l: v > 32767 ? 1 : 0 } }] });
  def('ARDUINO', 10819);
  for (const d of B.defines) def(d, 1);
  def('F_CPU', B.family === 'avr' ? 16000000 : 240000000);
  const libs = new Set();
  const out = [];
  const conds = [];          // { on, taken, outer }
  const active = () => conds.every(c => c.on);
  const relocate = (t, at, hide) => ({ ...t, line: at.line, col: at.col, ll: at.ll, hide });
  const isMacro = t => t.k === 'id' && macros.has(t.v) && !(t.hide && t.hide.has(t.v));

  // collect the args of a function-like macro: list[k] is '('; returns [args, kAfter]
  function collectArgs(list, k, at) {
    const args = [[]]; let depth = 0; k++;
    for (; k < list.length; k++) {
      const t = list[k];
      if (t.k === 'eof') break;
      if (t.k === 'op' && (t.v === '(' || t.v === '[' || t.v === '{')) depth++;
      if (t.k === 'op' && (t.v === ')' || t.v === ']' || t.v === '}')) { if (depth === 0) return [args, k + 1]; depth--; }
      if (t.k === 'op' && t.v === ',' && depth === 0) { args.push([]); continue; }
      args[args.length - 1].push(t);
    }
    throw new CErr('unterminated argument list of a macro', at);
  }
  function substitute(M, args, at, hide) {
    const body = [];
    for (let q = 0; q < M.body.length; q++) {
      const b = M.body[q];
      if (b.k === 'op' && b.v === '#' && M.body[q + 1] && M.body[q + 1].k === 'id' && M.params.includes(M.body[q + 1].v)) {
        const a = args[M.params.indexOf(M.body[q + 1].v)] || [];
        body.push({ k: 'str', v: a.map(t => t.k === 'str' ? JSON.stringify(t.v) : String(t.v)).join(' '), line: at.line, col: at.col, ll: at.ll });
        q++; continue;
      }
      if (b.k === 'op' && b.v === '##') {
        const left = body.pop(), r = M.body[++q];
        if (!left || !r) throw new CErr('## at the edge of a macro', at);
        const rt = r.k === 'id' && M.params.includes(r.v) ? (args[M.params.indexOf(r.v)] || [])[0] : r;
        const txt = String(left.v) + String(rt ? rt.v : '');
        const re = lex(txt);
        for (const t of re) if (t.k !== 'eof') body.push(relocate(t, at, hide));
        continue;
      }
      if (b.k === 'id' && M.params.includes(b.v)) {
        for (const t of expandList(args[M.params.indexOf(b.v)] || [])) body.push(relocate(t, at, t.hide));
        continue;
      }
      body.push(relocate(b, at, hide));
    }
    return body;
  }
  function expandOne(list, k) {          // list[k] is a macro name; returns [tokens, kAfter] or null
    const t = list[k], M = macros.get(t.v);
    const hide = new Set(t.hide || []); hide.add(t.v);
    if (M.params === null) return [expandList(M.body.map(b => relocate(b, t, hide))), k + 1];
    const nx = list[k + 1];
    if (!nx || nx.k !== 'op' || nx.v !== '(') return null;
    const [args, after] = collectArgs(list, k + 1, t);
    if (args.length === 1 && args[0].length === 0 && M.params.length === 0) args.length = 0;
    if (args.length !== M.params.length) throw new CErr(`macro "${t.v}" takes ${M.params.length} argument${M.params.length === 1 ? '' : 's'}, given ${args.length}`, t);
    return [expandList(substitute(M, args, t, hide)), after];
  }
  function expandList(list) {
    const res = [];
    for (let k = 0; k < list.length;) {
      if (isMacro(list[k])) { const r = expandOne(list, k); if (r) { res.push(...r[0]); k = r[1]; continue; } }
      res.push(list[k]); k++;
    }
    return res;
  }
  function evalIf(dir, at) {
    const pre = [];
    for (let q = 0; q < dir.length; q++) {
      const t = dir[q];
      if (t.k === 'id' && t.v === 'defined') {
        let name;
        if (dir[q + 1] && dir[q + 1].v === '(') { name = dir[q + 2] && dir[q + 2].v; q += 3; } else { name = dir[q + 1] && dir[q + 1].v; q += 1; }
        pre.push({ k: 'num', v: macros.has(name) ? 1 : 0 });
        continue;
      }
      pre.push(t);
    }
    const ex = expandList(pre).map(t => t.k === 'id' ? { k: 'num', v: t.v === 'true' ? 1 : 0 } : t);
    let p = 0;
    const peek = () => ex[p] || { k: 'eof' };
    const PREC = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
    const unary = () => {
      const t = ex[p++] || { k: 'eof' };
      if (t.k === 'num' || t.k === 'chr') return t.v;
      if (t.k === 'op' && t.v === '(') { const v = bin(0); if (!(ex[p] && ex[p].v === ')')) throw new CErr('missing ) in #if', at); p++; return v; }
      if (t.k === 'op' && t.v === '!') return unary() ? 0 : 1;
      if (t.k === 'op' && t.v === '-') return -unary();
      if (t.k === 'op' && t.v === '~') return ~unary();
      throw new CErr('#if needs an integer expression', at);
    };
    const bin = min => {
      let a = unary();
      for (;;) {
        const t = peek();
        if (t.k !== 'op' || !(t.v in PREC) || PREC[t.v] < min) break;
        p++;
        const b = bin(PREC[t.v] + 1);
        a = ({ '||': a || b ? 1 : 0, '&&': a && b ? 1 : 0, '|': a | b, '^': a ^ b, '&': a & b, '==': +(a === b), '!=': +(a !== b), '<': +(a < b), '>': +(a > b), '<=': +(a <= b), '>=': +(a >= b), '<<': a << b, '>>': a >> b, '+': a + b, '-': a - b, '*': a * b, '/': b ? Math.trunc(a / b) : 0, '%': b ? a % b : 0 })[t.v];
      }
      return a;
    };
    if (peek().v === '?') throw new CErr('#if ?: is not supported', at);
    const v = bin(0);
    return v ? 1 : 0;
  }
  function directive(hash, dir) {
    const name = dir[0] ? String(dir[0].v) : '';
    const rest = dir.slice(1);
    const on = active();
    if (name === 'ifdef' || name === 'ifndef') {
      const has = rest[0] && macros.has(rest[0].v);
      const v = name === 'ifdef' ? has : !has;
      conds.push({ on: !!v, taken: !!v }); return;
    }
    if (name === 'if') { const v = on ? !!evalIf(rest, hash) : false; conds.push({ on: v, taken: v }); return; }
    if (name === 'elif') {
      const c = conds[conds.length - 1]; if (!c) throw new CErr('#elif without #if', hash);
      if (c.taken) { c.on = false; return; }
      conds.pop(); const v = active() ? !!evalIf(rest, hash) : false; conds.push({ on: v, taken: v }); return;
    }
    if (name === 'else') { const c = conds[conds.length - 1]; if (!c) throw new CErr('#else without #if', hash); c.on = !c.taken; c.taken = true; return; }
    if (name === 'endif') { if (!conds.length) throw new CErr('#endif without #if', hash); conds.pop(); return; }
    if (!on) return;
    if (name === 'define') {
      const nm = rest[0];
      if (!nm || nm.k !== 'id') throw new CErr('macro names must be identifiers', hash);
      let params = null, body = rest.slice(1);
      if (rest[1] && rest[1].k === 'op' && rest[1].v === '(' && !rest[1].sp) {
        params = []; let q = 2;
        for (; q < rest.length && rest[q].v !== ')'; q++) {
          if (rest[q].k === 'id') params.push(rest[q].v);
          else if (rest[q].v === '...') throw new CErr('variadic macros are not supported', rest[q]);
          else if (rest[q].v !== ',') throw new CErr('bad macro parameter list', rest[q]);
        }
        body = rest.slice(q + 1);
      }
      macros.set(nm.v, { params, body });
      return;
    }
    if (name === 'undef') { if (rest[0]) macros.delete(rest[0].v); return; }
    if (name === 'include') {
      let file;
      if (rest[0] && rest[0].k === 'str') file = rest[0].v;
      else if (rest[0] && rest[0].v === '<') file = rest.slice(1, rest.findIndex(t => t.v === '>')).map(t => t.v).join('');
      else throw new CErr('#include expects "FILE" or <FILE>', hash);
      if (!(file in LIBS)) throw new CErr(`library ${file} is not available in this simulator. Supported: ${LIB_LIST}`, hash);
      if (file === 'ESP32Servo.h' && B.family !== 'esp32') throw new CErr('ESP32Servo.h is for the ESP32; use Servo.h on this board', hash);
      if (LIBS[file]) libs.add(LIBS[file]);
      return;
    }
    if (name === 'pragma' || name === 'line' || name === '') return;
    if (name === 'error') throw new CErr('#error ' + rest.map(t => t.v).join(' '), hash);
    if (name === 'warning') { warnings.push({ line: hash.line, col: hash.col, msg: '#warning ' + rest.map(t => t.v).join(' ') }); return; }
    throw new CErr(`unknown directive #${name}`, hash);
  }

  for (let i = 0; i < toks.length;) {
    const t = toks[i];
    if (t.k === 'op' && t.v === '#' && t.bol) {
      let j = i + 1;
      while (toks[j].k !== 'eof' && toks[j].ll === t.ll) j++;
      directive(t, toks.slice(i + 1, j));
      i = j; continue;
    }
    if (t.k === 'eof') { if (conds.length) throw new CErr('unterminated #if', t); out.push(t); break; }
    if (!active()) { i++; continue; }
    if (isMacro(t)) {
      // a function-like macro may take args that span the rest of the stream
      const r = expandOne(toks, i);
      if (r) { out.push(...r[0]); i = r[1]; continue; }
    }
    out.push(t); i++;
  }
  return { toks: out, libs };
}
