// ============================================================================
//  BREADBOARD LAB  ·  mcu/compile.js — Arduino-style sketch -> JS generators
// ----------------------------------------------------------------------------
//  compileSketch(source, { board }) -> { ok, code?, errors:[{line,col,msg}],
//  warnings:[{line,col,msg}], info }. `code` is the body of a factory
//  function `($) => { setup, loop, init }`; mcu/runtime.js instantiates it.
//
//  THE IDEA (CONTRACT 6). Every user function becomes `function*`. A call to
//  a user function becomes `(yield* u_f(...))`. A blocking built-in (delay,
//  pulseIn, a full Serial buffer) is a generator in the runtime that yields
//  a wait. Each loop back-edge yields a tick (code 0) that costs simulated
//  time, so `while (digitalRead(2));` advances the clock and cannot hang.
//
//  THE TYPES. Each expression carries a C type. Integer types wrap to their
//  width after every operation and on every store (int is 16 bits on the
//  328 boards and 32 bits on the ESP32). `/` truncates for integers. The
//  usual arithmetic conversions of C decide the type of a binary operation,
//  so `millis() - last >= interval` compares as unsigned long.
//
//  NOT SUPPORTED, WITH A CLEAR MESSAGE: pointers (except `char*` and
//  `const char*`, which mean a read-only string), references, structs,
//  classes, templates, `new`/`delete`, goto, `long long`, unknown libraries.
//
//  GREP MAP
//    CErr .................. a compile error with a line and a column
//    lex ................... source text -> tokens (line, col, logical line)
//    preprocess ............ #define (object and function), #if family,
//                            #include check, macro expansion
//    Parser ................ tokens -> AST (decls, statements, expressions)
//    TYPES ................. ranges, promote, common, wrap, conv
//    Gen ................... AST -> JS (symbols, statements, expressions)
//    BUILTINS / genBuiltin . the Arduino API calls
//    SERIAL_M / LCD_M / SERVO_M / STRING_M ... the methods of the objects
//    compileSketch ......... the export
// ============================================================================
import { BOARDS } from './boards.js';

export class CErr extends Error {
  constructor(msg, tok) { super(msg); this.line = tok ? tok.line : 0; this.col = tok ? tok.col : 0; }
}

// ── lexer ────────────────────────────────────────────────────────────────────
const PUNCTS = ['<<=', '>>=', '...', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '::', '##',
  '{', '}', '(', ')', '[', ']', ';', ',', '.', '?', ':', '=', '<', '>', '+', '-', '*', '/', '%', '&', '|', '^', '!', '~', '#'];
const ESC = { n: 10, t: 9, r: 13, '0': 0, '\\': 92, "'": 39, '"': 34, a: 7, b: 8, f: 12, v: 11, '?': 63 };

export function lex(src) {
  const toks = [];
  let i = 0, line = 1, col = 1, ll = 1, bol = true, sp = false;
  const n = src.length;
  const adv = k => { for (let q = 0; q < k; q++) { if (src[i] === '\n') { line++; col = 1; } else col++; i++; } };
  const readEsc = () => {          // at the char after the backslash
    const c = src[i];
    if (c === 'x') { adv(1); let h = ''; while (/[0-9a-fA-F]/.test(src[i] || '')) { h += src[i]; adv(1); } return parseInt(h || '0', 16) & 255; }
    if (/[0-7]/.test(c)) { let o = ''; while (o.length < 3 && /[0-7]/.test(src[i] || '')) { o += src[i]; adv(1); } return parseInt(o, 8) & 255; }
    adv(1);
    return c in ESC ? ESC[c] : c.charCodeAt(0);
  };
  while (i < n) {
    const c = src[i];
    if (c === '\\' && (src[i + 1] === '\n' || (src[i + 1] === '\r' && src[i + 2] === '\n'))) { adv(src[i + 1] === '\r' ? 3 : 2); sp = true; continue; }
    if (c === '\n') { adv(1); ll++; bol = true; sp = true; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { adv(1); sp = true; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') adv(1); sp = true; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const at = { line, col };
      adv(2);
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') ll++; adv(1); }
      if (i >= n) throw new CErr('unterminated comment', at);
      adv(2); sp = true; continue;
    }
    const tok = { k: '', v: null, line, col, ll, bol, sp };
    bol = false; sp = false;
    if (/[A-Za-z_]/.test(c)) {
      let s = '';
      while (i < n && /[A-Za-z0-9_]/.test(src[i])) { s += src[i]; adv(1); }
      tok.k = 'id'; tok.v = s; toks.push(tok); continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(0[xX][0-9a-fA-F']+|0[bB][01']+|(?:[0-9][0-9']*\.?[0-9']*|\.[0-9][0-9']*)(?:[eE][+-]?[0-9]+)?)([uUlLfF]*)/.exec(src.slice(i, i + 80));
      const body = m[1].replace(/'/g, ''), suf = m[2].toLowerCase();
      adv(m[0].length);
      let v, radix = 10, isFloat = false;
      if (/^0[xX]/.test(body)) { v = parseInt(body.slice(2), 16); radix = 16; }
      else if (/^0[bB]/.test(body)) { v = parseInt(body.slice(2), 2); radix = 2; }
      else if (/[.eE]/.test(body) || (suf.includes('f') && !/^0[xX]/.test(body))) { v = parseFloat(body); isFloat = true; }
      else if (body.length > 1 && body[0] === '0') { if (/[89]/.test(body)) throw new CErr(`invalid digit in octal constant ${body}`, tok); v = parseInt(body, 8); radix = 8; }
      else v = parseInt(body, 10);
      if (/[A-Za-z_]/.test(src[i] || '')) throw new CErr(`invalid suffix on number ${m[0]}${src[i]}`, tok);
      tok.k = 'num'; tok.v = v; tok.num = { isFloat, radix, u: suf.includes('u'), l: (suf.match(/l/g) || []).length, f: suf.includes('f') && isFloat };
      if (tok.num.l >= 2) throw new CErr('long long is not supported', tok);
      toks.push(tok); continue;
    }
    if (c === '"') {
      adv(1); let s = '';
      while (i < n && src[i] !== '"') {
        if (src[i] === '\n') throw new CErr('missing terminating " character', tok);
        if (src[i] === '\\') { adv(1); s += String.fromCharCode(readEsc()); } else { s += src[i]; adv(1); }
      }
      if (i >= n) throw new CErr('missing terminating " character', tok);
      adv(1);
      tok.k = 'str'; tok.v = s; toks.push(tok); continue;
    }
    if (c === "'") {
      adv(1); let v;
      if (src[i] === '\\') { adv(1); v = readEsc(); } else { v = src.charCodeAt(i); adv(1); }
      if (src[i] !== "'") throw new CErr('a character constant holds one character; use "double quotes" for text', tok);
      adv(1);
      tok.k = 'chr'; tok.v = v > 127 ? v - 256 : v; toks.push(tok); continue;
    }
    const p = PUNCTS.find(q => src.startsWith(q, i));
    if (!p) throw new CErr(`stray '${c}' in program`, tok);
    adv(p.length);
    tok.k = 'op'; tok.v = p; toks.push(tok);
  }
  toks.push({ k: 'eof', v: null, line, col, ll: ll + 1, bol: true, sp: true });
  return toks;
}

// ── preprocessor ─────────────────────────────────────────────────────────────
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

// ── parser ───────────────────────────────────────────────────────────────────
const TYPEWORDS = new Set(['void', 'bool', 'boolean', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned', 'byte', 'word', 'size_t',
  'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t', 'uint64_t', 'int64_t', 'String', 'unsigned_char']);
const QUALS = new Set(['const', 'static', 'volatile', 'inline', 'extern', 'register', 'constexpr', 'PROGMEM']);
const NOT_SUPPORTED = {
  class: 'classes are not supported in the sketch runtime',
  struct: 'structs are not supported in the sketch runtime; use arrays',
  union: 'unions are not supported in the sketch runtime',
  template: 'templates are not supported in the sketch runtime',
  typename: 'templates are not supported in the sketch runtime',
  namespace: 'namespaces are not supported in the sketch runtime',
  using: 'namespaces are not supported in the sketch runtime',
  typedef: 'typedef is not supported in the sketch runtime; write the type itself',
  goto: 'goto is not supported in the sketch runtime',
  new: 'new and delete are not supported (no classes or pointers)',
  delete: 'new and delete are not supported (no classes or pointers)',
  auto: 'auto is not supported; write the type',
  operator: 'operator overloading is not supported (no classes)',
  this: 'classes are not supported in the sketch runtime',
  asm: 'inline assembly is not supported',
  __asm__: 'inline assembly is not supported'
};
const BINPREC = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);

class Parser {
  constructor(toks, ctx) { this.t = toks; this.p = 0; this.ctx = ctx; }
  peek(o = 0) { return this.t[Math.min(this.p + o, this.t.length - 1)]; }
  next() { return this.t[this.p++]; }
  is(v, o = 0) { const t = this.peek(o); return (t.k === 'op' || t.k === 'id') && t.v === v; }
  accept(v) { if (this.is(v)) { return this.next(); } return null; }
  expect(v, what) {
    if (this.is(v)) return this.next();
    const t = this.peek();
    throw new CErr(`expected '${v}'${what ? ' ' + what : ''} before ${t.k === 'eof' ? 'end of input' : `'${t.k === 'str' ? '"' + t.v + '"' : t.v}'`}`, t);
  }
  ident(what) {
    const t = this.peek();
    if (t.k !== 'id') throw new CErr(`expected ${what || 'a name'} before ${t.k === 'eof' ? 'end of input' : `'${t.v}'`}`, t);
    if (NOT_SUPPORTED[t.v]) throw new CErr(NOT_SUPPORTED[t.v], t);
    return this.next();
  }
  isTypeStart(o = 0) {
    const t = this.peek(o);
    if (t.k !== 'id') return false;
    return TYPEWORDS.has(t.v) || QUALS.has(t.v) || this.ctx.libTypes.has(t.v) || this.ctx.enums.has(t.v) || t.v === 'enum';
  }
  // type specifier: qualifiers + words -> { t, isConst, isStatic, tok }
  typeSpec(allowStorage = true) {
    const tok = this.peek();
    const words = []; let isConst = false, isStatic = false;
    for (;;) {
      const t = this.peek();
      if (t.k !== 'id') break;
      if (NOT_SUPPORTED[t.v] && !TYPEWORDS.has(t.v)) throw new CErr(NOT_SUPPORTED[t.v], t);
      if (QUALS.has(t.v)) {
        if (t.v === 'const' || t.v === 'constexpr') isConst = true;
        if (t.v === 'static') { if (!allowStorage) throw new CErr('static is not allowed here', t); isStatic = true; }
        this.next(); continue;
      }
      if (t.v === 'enum') { this.next(); if (this.peek().k === 'id' && this.ctx.enums.has(this.peek().v)) { this.next(); words.push('int'); continue; } throw new CErr('unknown enum type', this.peek()); }
      if (TYPEWORDS.has(t.v)) { words.push(t.v); this.next(); continue; }
      if (this.ctx.libTypes.has(t.v) || this.ctx.enums.has(t.v)) { if (words.length) break; words.push(this.ctx.enums.has(t.v) ? 'int' : t.v); this.next(); continue; }
      break;
    }
    if (!words.length) {
      const t = this.peek();
      if (t.k === 'id' && (t.v === 'LiquidCrystal' || t.v === 'Servo')) throw new CErr(`'${t.v}' does not name a type; add #include <${t.v}.h>`, t);
      throw new CErr(`expected a type before '${t.v ?? 'end of input'}'`, t);
    }
    let ty = this.ctx.resolveType(words, tok);
    // char* / const char* are read-only strings; any other pointer is an error
    if (this.is('*')) {
      if (ty !== 'char') throw new CErr('pointers are not supported in the sketch runtime (only char* text); use arrays and indexes', this.peek());
      this.next(); ty = 'cstr';
      if (this.is('const')) this.next();
      if (this.is('*')) throw new CErr('pointers to pointers are not supported', this.peek());
    }
    if (this.is('&')) throw new CErr('references are not supported in the sketch runtime; return a value or use a global', this.peek());
    return { t: ty, isConst, isStatic, tok };
  }

  program() {
    const decls = [];
    while (this.peek().k !== 'eof') {
      const t = this.peek();
      if (t.k === 'op' && t.v === ';') { this.next(); continue; }
      if (t.k === 'id' && NOT_SUPPORTED[t.v]) throw new CErr(NOT_SUPPORTED[t.v], t);
      if (t.k === 'id' && t.v === 'enum' && !(this.peek(1).k === 'id' && this.ctx.enums.has(this.peek(1).v) && this.peek(2).k === 'id')) { decls.push(this.enumDecl()); continue; }
      if (!this.isTypeStart()) {
        if (t.k === 'id' && (t.v === 'LiquidCrystal' || t.v === 'Servo')) throw new CErr(`'${t.v}' does not name a type; add #include <${t.v}.h>`, t);
        if (t.k === 'id' && this.peek(1).v === '(') throw new CErr(`'${t.v}' needs a return type (for example: void ${t.v}())`, t);
        throw new CErr(`expected a declaration before '${t.k === 'eof' ? 'end of input' : t.v}'`, t);
      }
      const spec = this.typeSpec();
      const nm = this.ident('a name');
      if (this.is('(') && !spec.t.startsWith('obj:')) { decls.push(this.funcDecl(spec, nm)); continue; }
      decls.push(...this.varRest(spec, nm, true));
    }
    return decls;
  }
  enumDecl() {
    const tok = this.next();
    if (this.is('class') || this.is('struct')) throw new CErr('enum class is not supported; use a plain enum', this.peek());
    let name = null;
    if (this.peek().k === 'id') { name = this.next().v; this.ctx.enums.add(name); }
    this.expect('{', 'to open the enum');
    const items = [];
    while (!this.is('}')) {
      const it = this.ident('an enum name');
      let value = null;
      if (this.accept('=')) value = this.assignExpr();
      items.push({ name: it.v, value, tok: it });
      if (!this.accept(',')) break;
    }
    this.expect('}', 'to close the enum');
    const vars = [];
    if (this.peek().k === 'id') {    // enum E { ... } x;
      const spec = { t: 'int', isConst: false, isStatic: false, tok };
      spec.t = this.ctx.resolveType(['int'], tok);
      const nm = this.ident();
      vars.push(...this.varRest(spec, nm, true, true));
      return { k: 'enum', items, tok, vars };
    }
    this.expect(';', 'after the enum');
    return { k: 'enum', items, tok, vars };
  }
  funcDecl(spec, nm) {
    if (spec.t.startsWith('obj:')) throw new CErr('a function cannot return a library object', nm);
    this.expect('(');
    const params = [];
    if (this.is('void') && this.peek(1).v === ')') this.next();
    while (!this.is(')')) {
      if (this.is('...')) throw new CErr('variadic functions are not supported', this.peek());
      const ps = this.typeSpec(false);
      if (ps.t.startsWith('obj:')) throw new CErr('passing a library object to a function is not supported; use a global', ps.tok);
      let pn = null;
      if (this.peek().k === 'id') pn = this.ident('a parameter name');
      const dims = [];
      while (this.accept('[')) { dims.push(this.is(']') ? null : this.condExpr()); this.expect(']'); }
      let dflt = null;
      if (this.accept('=')) dflt = this.assignExpr();
      params.push({ name: pn ? pn.v : null, t: ps.t, dims, dflt, tok: pn || ps.tok, isConst: ps.isConst });
      if (!this.accept(',')) break;
    }
    this.expect(')', 'to close the parameter list');
    if (this.accept(';')) return { k: 'proto', name: nm.v, ret: spec.t, params, tok: nm };
    if (!this.is('{')) throw new CErr(`expected '{' to start the body of ${nm.v}()`, this.peek());
    const body = this.block();
    return { k: 'func', name: nm.v, ret: spec.t, params, body, tok: nm };
  }
  // the rest of a declaration after the first name
  varRest(spec, nm, top, skipSemi = false) {
    const vars = [];
    for (;;) {
      const v = { k: 'var', name: nm.v, t: spec.t, isConst: spec.isConst, isStatic: spec.isStatic, dims: [], init: null, ctor: null, tok: nm, top };
      while (this.accept('[')) { v.dims.push(this.is(']') ? null : this.condExpr()); this.expect(']'); }
      while (this.is('PROGMEM') || this.is('const')) this.next();
      if (spec.t.startsWith('obj:') && this.is('(')) {
        this.next(); v.ctor = [];
        while (!this.is(')')) { v.ctor.push(this.assignExpr()); if (!this.accept(',')) break; }
        this.expect(')');
      } else if (this.is('(') && !v.dims.length) {
        // `int x(5);` direct initialisation
        this.next(); v.init = this.expr(); this.expect(')');
      } else if (this.accept('=')) {
        v.init = this.is('{') ? this.initList() : this.assignExpr();
      } else if (this.is('{')) {
        v.init = this.initList();
      }
      vars.push(v);
      if (!this.accept(',')) break;
      if (this.is('*')) throw new CErr('pointers are not supported in the sketch runtime', this.peek());
      nm = this.ident('a name');
    }
    if (!skipSemi) this.expect(';', 'after the declaration');
    return vars;
  }
  initList() {
    const tok = this.expect('{');
    const items = [];
    while (!this.is('}')) {
      items.push(this.is('{') ? this.initList() : this.assignExpr());
      if (!this.accept(',')) break;
    }
    this.expect('}', 'to close the initialiser list');
    return { k: 'init', items, tok };
  }

  // statements
  block() {
    const tok = this.expect('{');
    const body = [];
    while (!this.is('}')) {
      if (this.peek().k === 'eof') throw new CErr("expected '}' at end of input", this.peek());
      body.push(this.stmt());
    }
    this.next();
    return { k: 'block', body, tok };
  }
  stmt() {
    const t = this.peek();
    if (t.k === 'op' && t.v === '{') return this.block();
    if (t.k === 'op' && t.v === ';') { this.next(); return { k: 'empty', tok: t }; }
    if (t.k === 'id') {
      if (NOT_SUPPORTED[t.v]) throw new CErr(NOT_SUPPORTED[t.v], t);
      switch (t.v) {
        case 'if': {
          this.next(); this.expect('(', "after 'if'"); const c = this.expr(); this.expect(')', 'to close the condition');
          const a = this.stmt(); let b = null;
          if (this.accept('else')) b = this.stmt();
          return { k: 'if', c, a, b, tok: t };
        }
        case 'while': {
          this.next(); this.expect('(', "after 'while'"); const c = this.expr(); this.expect(')', 'to close the condition');
          return { k: 'while', c, body: this.stmt(), tok: t };
        }
        case 'do': {
          this.next(); const body = this.stmt(); this.expect('while', 'after the do body'); this.expect('(');
          const c = this.expr(); this.expect(')'); this.expect(';');
          return { k: 'do', c, body, tok: t };
        }
        case 'for': {
          this.next(); this.expect('(', "after 'for'");
          let init = null;
          if (this.accept(';')) init = null;
          else if (this.isTypeStart() && !(this.peek(1).v === '(')) {
            const spec = this.typeSpec(); const nm = this.ident(); init = { k: 'decl', vars: this.varRest(spec, nm, false), tok: nm };
          } else { init = { k: 'expr', e: this.expr(), tok: this.peek() }; this.expect(';'); }
          if (this.is(':')) throw new CErr('range-based for loops are not supported; use an index', this.peek());
          const c = this.is(';') ? null : this.expr(); this.expect(';', 'in the for header');
          const u = this.is(')') ? null : this.expr(); this.expect(')', 'to close the for header');
          return { k: 'for', init, c, u, body: this.stmt(), tok: t };
        }
        case 'switch': {
          this.next(); this.expect('('); const e = this.expr(); this.expect(')'); this.expect('{', 'to open the switch');
          const cases = []; let cur = null;
          while (!this.is('}')) {
            const ct = this.peek();
            if (ct.k === 'eof') throw new CErr("expected '}' to close the switch", ct);
            if (this.accept('case')) {
              const v = this.condExpr();
              if (this.is('...')) throw new CErr('case ranges are not supported', this.peek());
              this.expect(':', 'after the case value'); cur = { test: v, body: [], tok: ct }; cases.push(cur); continue;
            }
            if (this.accept('default')) { this.expect(':'); cur = { test: null, body: [], tok: ct }; cases.push(cur); continue; }
            if (!cur) throw new CErr('a statement in a switch must follow a case label', ct);
            cur.body.push(this.stmt());
          }
          this.next();
          return { k: 'switch', e, cases, tok: t };
        }
        case 'break': this.next(); this.expect(';'); return { k: 'break', tok: t };
        case 'continue': this.next(); this.expect(';'); return { k: 'continue', tok: t };
        case 'return': { this.next(); const e = this.is(';') ? null : this.expr(); this.expect(';', 'after return'); return { k: 'return', e, tok: t }; }
        case 'case': case 'default': throw new CErr(`'${t.v}' label outside a switch`, t);
        case 'else': throw new CErr("'else' without a previous 'if'", t);
        case 'enum': { const d = this.enumDecl(); return { k: 'enumstmt', d, tok: t }; }
      }
      if (this.isTypeStart() && !(this.peek(1).k === 'op' && this.peek(1).v === '(') && !(this.peek(1).k === 'op' && this.peek(1).v === '.')) {
        const spec = this.typeSpec();
        const nm = this.ident('a name');
        if (this.is('(') && !spec.t.startsWith('obj:') && (this.isTypeStart(1) || this.peek(1).v === ')')) throw new CErr('a function cannot be defined inside another function', nm);
        return { k: 'decl', vars: this.varRest(spec, nm, false), tok: nm };
      }
    }
    const e = this.expr();
    this.expect(';', 'after the expression');
    return { k: 'expr', e, tok: t };
  }

  // expressions
  expr() {
    let e = this.assignExpr();
    while (this.is(',')) { const t = this.next(); e = { k: 'comma', a: e, b: this.assignExpr(), tok: t }; }
    return e;
  }
  assignExpr() {
    const lhs = this.condExpr();
    const t = this.peek();
    if (t.k === 'op' && ASSIGN.has(t.v)) { this.next(); return { k: 'asg', op: t.v, a: lhs, b: this.assignExpr(), tok: t }; }
    return lhs;
  }
  condExpr() {
    const c = this.binExpr(1);
    if (this.is('?')) {
      const t = this.next(); const a = this.expr(); this.expect(':', 'in the ?: expression'); const b = this.assignExpr();
      return { k: 'cond', c, a, b, tok: t };
    }
    return c;
  }
  binExpr(min) {
    let a = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.k !== 'op' || !(t.v in BINPREC) || BINPREC[t.v] < min) return a;
      this.next();
      const b = this.binExpr(BINPREC[t.v] + 1);
      a = (t.v === '&&' || t.v === '||') ? { k: 'log', op: t.v, a, b, tok: t } : { k: 'bin', op: t.v, a, b, tok: t };
    }
  }
  unary() {
    const t = this.peek();
    if (t.k === 'op') {
      if (t.v === '++' || t.v === '--') { this.next(); return { k: 'pre', op: t.v, a: this.unary(), tok: t }; }
      if (t.v === '-' || t.v === '+' || t.v === '!' || t.v === '~') { this.next(); return { k: 'un', op: t.v, a: this.unary(), tok: t }; }
      if (t.v === '*') throw new CErr('pointers are not supported in the sketch runtime', t);
      if (t.v === '&') { this.next(); return { k: 'addr', a: this.unary(), tok: t }; }
      if (t.v === '(' && this.isTypeStart(1) && !(this.peek(2).k === 'op' && this.peek(2).v === '(' )) {
        // C cast: (type) expr — a type word directly after '(' is a cast
        const save = this.p;
        this.next();
        const spec = this.typeSpec(false);
        if (this.is(')')) { this.next(); return { k: 'cast', t: spec.t, a: this.unary(), tok: t }; }
        this.p = save;
      }
    }
    if (t.k === 'id' && t.v === 'sizeof') {
      this.next();
      if (this.is('(') && this.isTypeStart(1)) {
        this.next(); const spec = this.typeSpec(false); this.expect(')');
        return { k: 'sizeof', t: spec.t, tok: t };
      }
      return { k: 'sizeof', a: this.unary(), tok: t };
    }
    return this.postfix();
  }
  postfix() {
    let e = this.primary();
    for (;;) {
      const t = this.peek();
      if (t.k !== 'op') return e;
      if (t.v === '(') {
        this.next(); const args = [];
        while (!this.is(')')) { args.push(this.assignExpr()); if (!this.accept(',')) break; }
        this.expect(')', 'to close the call');
        e = { k: 'call', f: e, args, tok: e.tok || t };
        continue;
      }
      if (t.v === '[') { this.next(); const i = this.expr(); this.expect(']'); e = { k: 'idx', a: e, i, tok: t }; continue; }
      if (t.v === '.') {
        this.next(); const nm = this.ident('a member name');
        if (this.is('(')) {
          this.next(); const args = [];
          while (!this.is(')')) { args.push(this.assignExpr()); if (!this.accept(',')) break; }
          this.expect(')');
          e = { k: 'mcall', obj: e, name: nm.v, args, tok: nm };
        } else throw new CErr(`'${nm.v}' is not a method call; structs are not supported`, nm);
        continue;
      }
      if (t.v === '->') throw new CErr('pointers are not supported in the sketch runtime', t);
      if (t.v === '::') throw new CErr('classes and namespaces are not supported in the sketch runtime', t);
      if (t.v === '++' || t.v === '--') { this.next(); e = { k: 'post', op: t.v, a: e, tok: t }; continue; }
      return e;
    }
  }
  primary() {
    const t = this.next();
    if (t.k === 'num') return { k: 'num', v: t.v, num: t.num, tok: t };
    if (t.k === 'chr') return { k: 'chr', v: t.v, tok: t };
    if (t.k === 'str') {
      let s = t.v;
      while (this.peek().k === 'str') s += this.next().v;
      return { k: 'str', v: s, tok: t };
    }
    if (t.k === 'id') {
      if (NOT_SUPPORTED[t.v]) throw new CErr(NOT_SUPPORTED[t.v], t);
      if (t.v === 'static_cast' || t.v === 'reinterpret_cast' || t.v === 'const_cast') {
        if (t.v !== 'static_cast') throw new CErr(`${t.v} is not supported`, t);
        this.expect('<'); const spec = this.typeSpec(false); this.expect('>'); this.expect('(');
        const a = this.expr(); this.expect(')');
        return { k: 'cast', t: spec.t, a, tok: t };
      }
      if (TYPEWORDS.has(t.v) && this.is('(')) {
        // functional cast: int(x), byte(x), String(x, HEX)
        if (t.v === 'String') return { k: 'id', name: 'String', tok: t };
        const ty = this.ctx.resolveType([t.v], t);
        this.next(); const a = this.expr(); this.expect(')');
        return { k: 'cast', t: ty, a, tok: t };
      }
      return { k: 'id', name: t.v, tok: t };
    }
    if (t.k === 'op' && t.v === '(') { const e = this.expr(); this.expect(')', 'to close the parenthesis'); return e; }
    if (t.k === 'op' && t.v === '{') throw new CErr('a { } list is only allowed when an array is declared', t);
    throw new CErr(t.k === 'eof' ? 'unexpected end of input' : `expected an expression before '${t.v}'`, t);
  }
}

// ── types ────────────────────────────────────────────────────────────────────
const RANGE = { bool: [0, 1], char: [-128, 127], i8: [-128, 127], u8: [0, 255], i16: [-32768, 32767], u16: [0, 65535], i32: [-2147483648, 2147483647], u32: [0, 4294967295] };
const SIZE = { bool: 1, char: 1, i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, f32: 4, f64: 8, String: 6, cstr: 2 };
export const isInt = t => typeof t === 'string' && t in RANGE;
export const isFloat = t => t === 'f32' || t === 'f64';
export const isNum = t => isInt(t) || isFloat(t);
const isArr = t => t && typeof t === 'object' && t.k === 'arr';
const isText = t => t === 'String' || t === 'cstr';
const isCharArr = t => isArr(t) && t.el === 'char' && t.dims.length === 1;
const tName = t => isArr(t) ? `${tName(t.el)}[${t.dims.map(d => d ?? '').join('][')}]` :
  ({ bool: 'bool', char: 'char', i8: 'int8_t', u8: 'byte', i16: 'int', u16: 'unsigned int', i32: 'long', u32: 'unsigned long', f32: 'float', f64: 'double', String: 'String', cstr: 'const char*', void: 'void', fn: 'function', 'obj:Serial': 'Serial', 'obj:LCD': 'LiquidCrystal', 'obj:Servo': 'Servo' })[t] || String(t);

function wrapCode(t, c) {
  switch (t) {
    case 'char': case 'i8': return `((${c})<<24>>24)`;
    case 'u8': return `((${c})&255)`;
    case 'i16': return `((${c})<<16>>16)`;
    case 'u16': return `((${c})&65535)`;
    case 'i32': return `((${c})|0)`;
    case 'u32': return `((${c})>>>0)`;
    case 'bool': return `((${c})?1:0)`;
    case 'f32': return `Math.fround(${c})`;
    default: return c;
  }
}
// a cheap literal: the constant value of an integer or float literal
function litWrap(t, v) {
  if (isInt(t)) {
    if (t === 'bool') return v ? 1 : 0;
    const r = RANGE[t], m = r[1] - r[0] + 1;
    let x = Math.trunc(v); if (!Number.isFinite(x)) x = 0;
    x = ((x - r[0]) % m + m) % m + r[0];
    return x;
  }
  if (t === 'f32') return Math.fround(v);
  return v;
}

// ── the code generator ───────────────────────────────────────────────────────
const SERIAL_M = {
  begin: ['g', 'void', 1, 2], end: ['g', 'void', 0, 0], print: ['print'], println: ['print'], write: ['write'], printf: ['printf'],
  available: ['f', 'INT', 0, 0], availableForWrite: ['f', 'INT', 0, 0], read: ['f', 'INT', 0, 0], peek: ['f', 'INT', 0, 0],
  flush: ['g', 'void', 0, 0], parseInt: ['g', 'i32', 0, 0], parseFloat: ['g', 'f32', 0, 0], readString: ['g', 'String', 0, 0],
  readStringUntil: ['g', 'String', 1, 1], setTimeout: ['f', 'void', 1, 1], find: ['g', 'bool', 1, 1]
};
const LCD_M = {
  begin: ['g', 'void', 2, 3], clear: ['g', 'void', 0, 0], home: ['g', 'void', 0, 0], setCursor: ['g', 'void', 2, 2],
  print: ['print'], write: ['write'], cursor: ['g', 'void', 0, 0], noCursor: ['g', 'void', 0, 0], blink: ['g', 'void', 0, 0], noBlink: ['g', 'void', 0, 0],
  display: ['g', 'void', 0, 0], noDisplay: ['g', 'void', 0, 0], scrollDisplayLeft: ['g', 'void', 0, 0], scrollDisplayRight: ['g', 'void', 0, 0],
  leftToRight: ['g', 'void', 0, 0], rightToLeft: ['g', 'void', 0, 0], autoscroll: ['g', 'void', 0, 0], noAutoscroll: ['g', 'void', 0, 0],
  createChar: ['g', 'void', 2, 2], command: ['g', 'void', 1, 1]
};
const SERVO_M = {
  attach: ['g', 'u8', 1, 3], detach: ['g', 'void', 0, 0], write: ['g', 'void', 1, 1], writeMicroseconds: ['g', 'void', 1, 1],
  read: ['f', 'INT', 0, 0], readMicroseconds: ['f', 'INT', 0, 0], attached: ['f', 'bool', 0, 0]
};
// String methods: [kind, ret, min, max]; kind 'm' mutates the String in place
const STRING_M = {
  length: ['f', 'UINT', 0, 0], charAt: ['f', 'char', 1, 1], substring: ['f', 'String', 1, 2], indexOf: ['f', 'INT', 1, 2], lastIndexOf: ['f', 'INT', 1, 2],
  toInt: ['f', 'i32', 0, 0], toFloat: ['f', 'f32', 0, 0], toDouble: ['f', 'DBL', 0, 0], equals: ['f', 'bool', 1, 1], equalsIgnoreCase: ['f', 'bool', 1, 1],
  startsWith: ['f', 'bool', 1, 1], endsWith: ['f', 'bool', 1, 1], compareTo: ['f', 'INT', 1, 1], c_str: ['f', 'cstr', 0, 0], isEmpty: ['f', 'bool', 0, 0],
  concat: ['m', 'bool', 1, 1], toUpperCase: ['m', 'void', 0, 0], toLowerCase: ['m', 'void', 0, 0], trim: ['m', 'void', 0, 0],
  replace: ['m', 'void', 2, 2], remove: ['m', 'void', 1, 2], setCharAt: ['m', 'void', 2, 2], reserve: ['f', 'bool', 1, 1]
};
// Built-in functions: [kind, ret, min, max]. g: generator (yield*), f: plain.
// ret 'INT'/'UINT'/'DBL' resolve per board. Special codegen: see genBuiltin.
export const BUILTINS = {
  pinMode: ['g', 'void', 2, 2], digitalWrite: ['g', 'void', 2, 2], digitalRead: ['g', 'INT', 1, 1], analogRead: ['g', 'INT', 1, 1],
  analogWrite: ['g', 'void', 2, 2], delay: ['g', 'void', 1, 1], delayMicroseconds: ['g', 'void', 1, 1], tone: ['g', 'void', 2, 3],
  noTone: ['g', 'void', 1, 1], pulseIn: ['g', 'u32', 2, 3], pulseInLong: ['g', 'u32', 2, 3], shiftOut: ['g', 'void', 4, 4], shiftIn: ['g', 'u8', 3, 3],
  yield: ['g', 'void', 0, 0], millis: ['f', 'u32', 0, 0], micros: ['f', 'u32', 0, 0], map: ['f', 'i32', 5, 5], random: ['f', 'i32', 1, 2],
  randomSeed: ['f', 'void', 1, 1], attachInterrupt: ['f', 'void', 3, 3], detachInterrupt: ['f', 'void', 1, 1], digitalPinToInterrupt: ['f', 'INT', 1, 1],
  interrupts: ['f', 'void', 0, 0], noInterrupts: ['f', 'void', 0, 0], sei: ['f', 'void', 0, 0], cli: ['f', 'void', 0, 0],
  analogReadResolution: ['f', 'void', 1, 1], analogWriteResolution: ['f', 'void', 1, 1],
  ledcAttach: ['f', 'bool', 3, 3], ledcSetup: ['f', 'u32', 3, 3], ledcAttachPin: ['f', 'void', 2, 2], ledcWrite: ['g', 'bool', 2, 2],
  ledcWriteTone: ['g', 'u32', 2, 2], ledcDetach: ['g', 'bool', 1, 1], ledcDetachPin: ['g', 'void', 1, 1],
  word: ['f', 'u16', 1, 2], isDigit: ['f', 'bool', 1, 1], isAlpha: ['f', 'bool', 1, 1], isAlphaNumeric: ['f', 'bool', 1, 1], isSpace: ['f', 'bool', 1, 1],
  isWhitespace: ['f', 'bool', 1, 1], isUpperCase: ['f', 'bool', 1, 1], isLowerCase: ['f', 'bool', 1, 1], isPunct: ['f', 'bool', 1, 1], isHexadecimalDigit: ['f', 'bool', 1, 1],
  isPrintable: ['f', 'bool', 1, 1], toupper: ['f', 'INT', 1, 1], tolower: ['f', 'INT', 1, 1],
  strlen: ['f', 'UINT', 1, 1], strcmp: ['f', 'INT', 2, 2], sprintf: ['sprintf'], snprintf: ['sprintf'], dtostrf: ['dtostrf'],
  atoi: ['f', 'INT', 1, 1], atol: ['f', 'i32', 1, 1], atof: ['f', 'DBL', 1, 1],
  sqrt: ['math'], pow: ['math'], sin: ['math'], cos: ['math'], tan: ['math'], asin: ['math'], acos: ['math'], atan: ['math'], atan2: ['math'],
  exp: ['math'], log: ['math'], log10: ['math'], floor: ['math'], ceil: ['math'], fabs: ['math'], fmod: ['math'], fmin: ['math'], fmax: ['math'],
  trunc: ['math'], hypot: ['math'], round: ['math'], sinh: ['math'], cosh: ['math'], tanh: ['math'], cbrt: ['math'], square: ['math'],
  sqrtf: ['math'], powf: ['math'], sinf: ['math'], cosf: ['math'], fabsf: ['math'], roundf: ['math'], floorf: ['math'], ceilf: ['math'],
  isnan: ['f', 'bool', 1, 1], isinf: ['f', 'bool', 1, 1],
  min: ['macro'], max: ['macro'], constrain: ['macro'], abs: ['macro'], sq: ['macro'], bitRead: ['macro'], bitSet: ['macro'], bitClear: ['macro'],
  bitWrite: ['macro'], bit: ['macro'], lowByte: ['macro'], highByte: ['macro'], F: ['macro'], PSTR: ['macro'],
  pgm_read_byte: ['pgm'], pgm_read_word: ['pgm'], pgm_read_dword: ['pgm'], pgm_read_float: ['pgm'], pgm_read_byte_near: ['pgm'], pgm_read_word_near: ['pgm']
};
const MATH = {
  sqrt: 'Math.sqrt', pow: 'Math.pow', sin: 'Math.sin', cos: 'Math.cos', tan: 'Math.tan', asin: 'Math.asin', acos: 'Math.acos', atan: 'Math.atan', atan2: 'Math.atan2',
  exp: 'Math.exp', log: 'Math.log', log10: 'Math.log10', floor: 'Math.floor', ceil: 'Math.ceil', fabs: 'Math.abs', fmod: '$.fmod', fmin: 'Math.min', fmax: 'Math.max',
  trunc: 'Math.trunc', hypot: 'Math.hypot', round: '$.round', sinh: 'Math.sinh', cosh: 'Math.cosh', tanh: 'Math.tanh', cbrt: 'Math.cbrt', square: '$.square',
  sqrtf: 'Math.sqrt', powf: 'Math.pow', sinf: 'Math.sin', cosf: 'Math.cos', fabsf: 'Math.abs', roundf: '$.round', floorf: 'Math.floor', ceilf: 'Math.ceil'
};
const MATH_ARGS = { pow: 2, atan2: 2, fmod: 2, fmin: 2, fmax: 2, hypot: 2, powf: 2 };

class Gen {
  constructor(board, libs, warnings) {
    const B = BOARDS[board];
    this.board = board; this.B = B; this.libs = libs; this.warnings = warnings;
    this.INT = B.intBits === 16 ? 'i16' : 'i32';
    this.UINT = B.intBits === 16 ? 'u16' : 'u32';
    this.DBL = B.doubleBits === 32 ? 'f32' : 'f64';
    this.scopes = [new Map()];
    this.funcs = new Map();
    this.globalsDecl = [];   // JS lines at the top
    this.init = [];          // JS lines of __init
    this.statics = 0;
    this.fn = null;          // the current function context
    this.uses = { serial: false, lcd: false, servo: false, interrupts: false, tone: false };
    const esp = B.family === 'esp32';
    const k = (v, t) => ({ kind: 'const', v, t: t || this.INT });
    this.consts = {
      HIGH: k(1), LOW: k(0), true: k(1, 'bool'), false: k(0, 'bool'), NULL: k(0),
      INPUT: k(esp ? 1 : 0), OUTPUT: k(esp ? 3 : 1), INPUT_PULLUP: k(esp ? 5 : 2),
      LSBFIRST: k(0), MSBFIRST: k(1),
      CHANGE: k(esp ? 3 : 1), FALLING: k(2), RISING: k(esp ? 1 : 3),
      DEC: k(10), HEX: k(16), OCT: k(8), BIN: k(2),
      PI: k(Math.PI, this.DBL), HALF_PI: k(Math.PI / 2, this.DBL), TWO_PI: k(Math.PI * 2, this.DBL),
      DEG_TO_RAD: k(Math.PI / 180, this.DBL), RAD_TO_DEG: k(180 / Math.PI, this.DBL), EULER: k(Math.E, this.DBL),
      NOT_AN_INTERRUPT: k(-1), LED_BUILTIN: k(B.pins[B.led].gpio),
      SERIAL_8N1: k(0x06), INT_MAX: k(B.intBits === 16 ? 32767 : 2147483647), LONG_MAX: k(2147483647, 'i32')
    };
    if (esp) { this.consts.INPUT_PULLDOWN = k(9); this.consts.ONLOW = k(4); this.consts.ONHIGH = k(5); }
    for (const [name, g] of Object.entries(B.analog)) this.consts[name] = k(g, 'u8');
    for (const [a, name] of Object.entries(B.alias)) if (!(a in this.consts)) this.consts[a] = k(B.pins[name].gpio, 'u8');
  }
  err(msg, node) { throw new CErr(msg, node && (node.tok || node)); }
  resolveRet(r) { return r === 'INT' ? this.INT : r === 'UINT' ? this.UINT : r === 'DBL' ? this.DBL : r; }

  // ── type rules ──
  promote(t) {
    if (t === 'bool' || t === 'char' || t === 'i8' || t === 'u8') return this.INT;
    if (this.INT === 'i32' && (t === 'i16' || t === 'u16')) return 'i32';
    return t;
  }
  common(a, b, node) {
    if (!isNum(a) || !isNum(b)) this.err(`invalid operands of types '${tName(a)}' and '${tName(b)}'`, node);
    if (isFloat(a) || isFloat(b)) return (a === 'f64' || b === 'f64') ? 'f64' : 'f32';
    a = this.promote(a); b = this.promote(b);
    if (a === b) return a;
    const rank = t => (t === 'i32' || t === 'u32') ? 2 : 1, sgn = t => t[0] === 'i';
    if (sgn(a) === sgn(b)) return rank(a) >= rank(b) ? a : b;
    const [s, u] = sgn(a) ? [a, b] : [b, a];
    if (rank(u) >= rank(s)) return u;
    return s;
  }
  conv(e, to, node, explicit = false) {
    const from = e.t;
    if (from === to) return e.c;
    if (isArr(to)) {
      if (!isArr(from) || from.el !== to.el || from.dims.length !== to.dims.length) this.err(`cannot convert '${tName(from)}' to '${tName(to)}'`, node);
      return e.c;
    }
    if (to === 'String') {
      if (isText(from)) return e.c;
      if (isCharArr(from)) return `$.cstr(${e.c})`;
      if (isNum(from)) {
        if (!explicit && from !== 'char') return `$.str(${e.c},'${from}')`;
        return `$.str(${e.c},'${from}')`;
      }
      this.err(`cannot convert '${tName(from)}' to 'String'`, node);
    }
    if (to === 'cstr') {
      if (from === 'cstr') return e.c;
      if (from === 'String') return e.c;
      if (isCharArr(from)) return `$.cstr(${e.c})`;
      if (e.isZero) return '""';
      this.err(`cannot convert '${tName(from)}' to 'const char*'`, node);
    }
    if (isNum(to)) {
      if (!isNum(from)) {
        if (from === 'String' || from === 'cstr') this.err(`cannot convert '${tName(from)}' to '${tName(to)}'${from === 'String' ? '; use .toInt() or .toFloat()' : ''}`, node);
        if (from === 'fn') this.err('a function name is not a number; did you forget the ()?', node);
        if (from === 'obj:Serial' && to === 'bool') return '1';
        this.err(`cannot convert '${tName(from)}' to '${tName(to)}'`, node);
      }
      if (e.k === 'lit') return String(litWrap(to, e.v));
      if (isInt(to) && isInt(from)) {
        const rf = RANGE[from], rt = RANGE[to];
        if (rf[0] >= rt[0] && rf[1] <= rt[1]) return e.c;
      }
      if (to === 'f64') return e.c;
      if (to === 'f32' && isInt(from) && !from.endsWith('32')) return e.c;
      return wrapCode(to, e.c);
    }
    if (to === 'void') return e.c;
    this.err(`cannot convert '${tName(from)}' to '${tName(to)}'`, node);
  }

  // ── symbols ──
  lookup(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) { const s = this.scopes[i].get(name); if (s) return s; }
    return null;
  }
  declare(name, sym, node) {
    const top = this.scopes[this.scopes.length - 1];
    if (top.has(name)) this.err(`redeclaration of '${name}'`, node);
    if (this.consts[name] || name === 'Serial') this.err(`'${name}' is already defined by the Arduino core`, node);
    if (BUILTINS[name]) this.err(`'${name}' is the name of an Arduino function`, node);
    if (this.scopes.length === 1 && this.funcs.has(name)) this.err(`'${name}' is already the name of a function`, node);
    top.set(name, sym);
  }
  tmp() { const n = '__t' + (++this.fn.tmps); return n; }

  // ── constant evaluation (array sizes, case labels, enum values) ──
  constEval(node) {
    const e = this.expr(node);
    if (e.k === 'lit') return e.v;
    this.err('this needs a constant value', node);
  }

  // ── program ──
  program(decls) {
    // pass 1: function signatures (Arduino allows a call before the definition)
    for (const d of decls) {
      if (d.k !== 'func' && d.k !== 'proto') continue;
      const prev = this.funcs.get(d.name);
      const sig = { name: d.name, ret: d.ret, params: d.params.map(p => this.paramType(p)), js: 'u_' + d.name, defined: d.k === 'func', node: d, dflts: d.params.map(p => p.dflt) };
      if (prev) {
        const same = prev.params.length === sig.params.length && prev.params.every((p, i) => JSON.stringify(p) === JSON.stringify(sig.params[i]));
        if (!same) this.err(`overloaded functions are not supported ('${d.name}' is declared twice with different parameters)`, d);
        if (prev.defined && sig.defined) this.err(`redefinition of '${d.name}'`, d);
        if (sig.defined) { prev.defined = true; prev.node = d; }
        if (d.params.some(p => p.dflt)) prev.dflts = sig.dflts;
        continue;
      }
      if (BUILTINS[d.name] || this.consts[d.name]) this.err(`'${d.name}' is the name of an Arduino function`, d);
      this.funcs.set(d.name, sig);
    }
    for (const [name, f] of this.funcs) if (!f.defined) this.err(`'${name}' is declared but never defined`, f.node);
    if (!this.funcs.has('setup')) this.err('the sketch needs a setup() function', { line: 1, col: 1 });
    if (!this.funcs.has('loop')) this.err('the sketch needs a loop() function', { line: 1, col: 1 });
    const parts = [];
    this.fn = { tmps: 0, vars: 0, ret: 'void', name: '__init', loops: 0, sw: 0 };
    const initBody = [];
    const fnCode = [];
    for (const d of decls) {
      if (d.k === 'enum') { this.enumItems(d); for (const v of d.vars) initBody.push(...this.globalVar(v)); continue; }
      if (d.k === 'var') { initBody.push(...this.globalVar(d)); continue; }
      if (d.k === 'func') {
        // globals are visible in order; functions are visible everywhere
        const save = this.fn;
        fnCode.push(this.funcBody(d));
        this.fn = save;
      }
    }
    const initTmps = this.fn.tmps;
    parts.push('"use strict";');
    parts.push('const B = $.B, S = $.Serial;');
    if (this.globalsDecl.length) parts.push('let ' + this.globalsDecl.join(', ') + ';');
    parts.push(...fnCode);
    parts.push(`function* __init() {${initTmps ? ' let ' + Array.from({ length: initTmps }, (_, i) => '__t' + (i + 1)).join(', ') + ';' : ''}\n${initBody.join('\n')}\n}`);
    const fns = [...this.funcs.values()].map(f => `${JSON.stringify(f.name)}: ${f.js}`).join(', ');
    parts.push(`return { init: __init, setup: u_setup, loop: u_loop, fns: { ${fns} } };`);
    return parts.join('\n');
  }
  paramType(p) {
    if (p.t === 'void') this.err('a parameter cannot be void', p);
    if (p.dims.length) {
      const dims = p.dims.map((d, i) => d === null ? (i === 0 ? null : this.err('only the first array size of a parameter may be empty', p)) : this.constEval(d));
      return { k: 'arr', el: p.t, dims };
    }
    return p.t;
  }
  enumItems(d) {
    let v = 0;
    for (const it of d.items) {
      if (it.value) v = this.constEval(it.value);
      this.declare(it.name, { kind: 'const', v, t: this.INT }, it.tok);
      v++;
    }
  }
  globalVar(v) {
    const js = 'u_' + v.name;
    this.globalsDecl.push(`${js} = ${this.zeroOf(v)}`);
    const lines = this.varInit(v, js, true);
    return lines;
  }
  zeroOf(v) {
    if (v.dims.length || v.t.startsWith('obj:')) return 'null';
    if (v.t === 'String' || v.t === 'cstr') return '""';
    return '0';
  }
  arrayType(v) {
    const dims = v.dims.map((d, i) => {
      if (d === null) {
        if (i !== 0) this.err('only the first array size may be left out', v);
        if (!v.init) this.err(`the size of array '${v.name}' is unknown; give a size or an initialiser`, v);
        if (v.init.k === 'init') return v.init.items.length;
        if (v.init.k === 'str') return v.init.v.length + 1;
        this.err('an array needs a { } list', v);
      }
      const n = this.constEval(d);
      if (!Number.isInteger(n) || n <= 0) this.err(`array size of '${v.name}' must be a positive integer`, v);
      if (n > 65536) this.err(`array '${v.name}' is too large`, v);
      return n;
    });
    return { k: 'arr', el: v.t, dims };
  }
  // JS lines that create/initialise a variable (local `let` decl or a global store)
  varInit(v, js, isGlobal) {
    const lineMark = `$.ln=${v.tok.line};`;
    if (v.t === 'void') this.err(`variable '${v.name}' declared void`, v);
    if (v.t.startsWith('obj:')) {
      const kind = v.t.slice(4);
      if (kind === 'Serial') this.err('Serial is already defined', v);
      if (v.init) this.err(`a ${tName(v.t)} cannot be assigned`, v);
      let mk;
      if (kind === 'LCD') {
        const args = (v.ctor || []).map(a => this.conv(this.expr(a), this.INT, a));
        if (![6, 7, 10, 11].includes(args.length)) this.err('LiquidCrystal takes 6 pins (rs, en, d4..d7), 7, 10 or 11 pins', v);
        mk = `$.newLCD([${args.join(', ')}])`;
        this.uses.lcd = true;
      } else {
        if (v.ctor && v.ctor.length) this.err('Servo takes no constructor arguments; use attach(pin)', v);
        mk = '$.newServo()';
        this.uses.servo = true;
      }
      const sym = { kind: 'obj', t: v.t, js };
      if (v.dims.length) {
        const at = this.arrayType({ ...v, t: v.t });
        sym.kind = 'var'; sym.t = { k: 'arr', el: v.t, dims: at.dims };
        this.declare(v.name, sym, v);
        return [`${lineMark}${isGlobal ? '' : 'let '}${js} = $.mkObjArr(() => ${mk}, ${JSON.stringify(at.dims)});`];
      }
      this.declare(v.name, sym, v);
      return [`${lineMark}${isGlobal ? '' : 'let '}${js} = ${mk};`];
    }
    if (v.dims.length) {
      const at = this.arrayType(v);
      let initCode = 'null';
      if (v.init) initCode = this.arrInit(v.init, at, 0, v);
      const sym = { kind: 'var', t: at, js, isConst: v.isConst };
      this.declare(v.name, sym, v);
      return [`${lineMark}${isGlobal ? '' : 'let '}${js} = $.mkArr('${at.el}', ${JSON.stringify(at.dims)}, ${initCode});`];
    }
    if (v.init && v.init.k === 'init') {
      if (v.init.items.length !== 1) this.err(`'${v.name}' is not an array; a { } list needs one value`, v);
      v.init = v.init.items[0];
    }
    let code = this.zeroOf(v), lit = null;
    if (v.init) {
      const e = this.expr(v.init);
      code = this.conv(e, v.t, v.init);
      if (e.k === 'lit' && isNum(v.t)) lit = litWrap(v.t, e.v);
      if (e.k === 'lit' && isText(v.t) && typeof e.v === 'string') lit = e.v;
    } else if (v.isConst) this.err(`uninitialized const '${v.name}'`, v);
    const sym = { kind: 'var', t: v.t, js, isConst: v.isConst };
    if (v.isConst && lit !== null) sym.constVal = lit;
    this.declare(v.name, sym, v);
    return [`${lineMark}${isGlobal ? '' : 'let '}${js} = ${code};`];
  }
  arrInit(init, at, depth, v) {
    const el = at.el, rest = at.dims.slice(depth);
    if (init.k === 'str') {
      if (el !== 'char' && el !== 'u8' && el !== 'i8') this.err(`a string can only fill a char array, not '${tName(el)}'`, init);
      if (rest.length !== 1) this.err('a string fills one row of a char array', init);
      if (init.v.length + 1 > rest[0] && init.v.length > rest[0]) this.err(`initializer-string for '${v.name}' is too long`, init);
      return JSON.stringify(init.v);
    }
    if (init.k !== 'init') {
      if (rest.length > 1 || el === 'char') {
        // char rows may be given as strings: char names[3][8] = {"a", "bb"}
        this.err('expected a { } list', init);
      }
      this.err('expected a { } list', init);
    }
    if (init.items.length > rest[0]) this.err(`too many initializers for '${v.name}'`, init);
    if (rest.length === 1) {
      return '[' + init.items.map(it => {
        if (it.k === 'init') this.err('too many braces in the initializer', it);
        const e = this.expr(it);
        if (el.startsWith && el.startsWith('obj:')) this.err('library objects cannot be listed', it);
        return this.conv(e, el, it);
      }).join(', ') + ']';
    }
    return '[' + init.items.map(it => {
      if (it.k === 'str' && rest.length === 2) return this.arrInit(it, at, depth + 1, v);
      if (it.k !== 'init') this.err('expected a { } list for the inner array', it);
      return this.arrInit(it, at, depth + 1, v);
    }).join(', ') + ']';
  }

  funcBody(d) {
    const sig = this.funcs.get(d.name);
    this.fn = { tmps: 0, vars: 0, ret: d.ret, name: d.name, loops: 0, sw: 0, hasReturn: false };
    this.scopes.push(new Map());
    const params = d.params.map((p, i) => {
      if (!p.name) this.err('a parameter needs a name', p);
      const js = 'p_' + p.name;
      this.declare(p.name, { kind: 'var', t: sig.params[i], js }, p);
      const dflt = sig.dflts[i];
      return dflt ? `${js} = ${this.conv(this.expr(dflt), sig.params[i], dflt)}` : js;
    });
    // convert scalar params on entry (callers pass converted values already)
    const body = this.blockBody(d.body.body);
    this.scopes.pop();
    if (d.ret !== 'void' && !this.fn.hasReturn && d.name !== 'main') this.warnings.push({ line: d.tok.line, col: d.tok.col, msg: `no return statement in function returning '${tName(d.ret)}'` });
    const tmps = this.fn.tmps ? ` let ${Array.from({ length: this.fn.tmps }, (_, i) => '__t' + (i + 1)).join(', ')};` : '';
    return `function* ${sig.js}(${params.join(', ')}) {${tmps}\n${body}\n}`;
  }
  blockBody(stmts) { return stmts.map(s => this.stmt(s)).join('\n'); }
  scoped(fn) { this.scopes.push(new Map()); try { return fn(); } finally { this.scopes.pop(); } }
  asBlock(s) { return this.scoped(() => s.k === 'block' ? `{\n${this.blockBody(s.body)}\n}` : `{\n${this.stmt(s)}\n}`); }
  cond(node) {
    const e = this.expr(node);
    if (e.t === 'void') this.err('a void value cannot be tested', node);
    if (e.t === 'String') this.err('a String cannot be tested as true/false; compare it or test .length()', node);
    if (isArr(e.t)) this.err('an array cannot be tested as true/false', node);
    return e.c;
  }
  stmt(s) {
    const L = s.tok ? `$.ln=${s.tok.line};` : '';
    switch (s.k) {
      case 'block': return this.asBlock(s);
      case 'empty': return ';';
      case 'expr': return `${L}${this.expr(s.e, true).c};`;
      case 'decl': return s.vars.map(v => this.localVar(v)).join('\n');
      case 'enumstmt': this.enumItems(s.d); return s.d.vars.map(v => this.localVar(v)).join('\n');
      case 'if': {
        const c = this.cond(s.c);
        return `${L}if (${c}) ${this.asBlock(s.a)}${s.b ? ' else ' + this.asBlock(s.b) : ''}`;
      }
      case 'while': {
        const c = this.cond(s.c);
        this.fn.loops++; const b = this.asBlock(s.body); this.fn.loops--;
        return `${L}while (((yield 0), ${c})) ${b}`;
      }
      case 'do': {
        this.fn.loops++; const b = this.asBlock(s.body); this.fn.loops--;
        const c = this.cond(s.c);
        return `${L}do ${b} while (((yield 0), ${c}));`;
      }
      case 'for': return this.scoped(() => {
        let init = '';
        if (s.init && s.init.k === 'decl') init = s.init.vars.map(v => this.localVar(v)).join('\n');
        else if (s.init) init = `${this.expr(s.init.e, true).c};`;
        const c = s.c ? this.cond(s.c) : '';
        const u = s.u ? this.expr(s.u, true).c : '';
        this.fn.loops++; const b = this.asBlock(s.body); this.fn.loops--;
        return `${L}{ ${init}\nfor (; ${c}; ${u ? `${u}, ` : ''}(yield 0)) ${b} }`;
      });
      case 'switch': {
        const e = this.expr(s.e);
        if (!isInt(e.t)) this.err('switch needs an integer value', s.e);
        const seen = new Set();
        this.fn.sw++;
        const cases = this.scoped(() => s.cases.map(c => {
          let head;
          if (c.test) {
            const v = this.constEval(c.test);
            if (!Number.isInteger(v)) this.err('case label does not reduce to an integer constant', c.test);
            if (seen.has(v)) this.err(`duplicate case value ${v}`, c.test);
            seen.add(v); head = `case ${v}:`;
          } else { if (seen.has('default')) this.err('multiple default labels in one switch', c); seen.add('default'); head = 'default:'; }
          return `${head}\n${c.body.map(x => this.stmt(x)).join('\n')}`;
        }).join('\n'));
        this.fn.sw--;
        return `${L}switch (${this.conv(e, this.promote(e.t), s.e)}) {\n${cases}\n}`;
      }
      case 'break': if (!this.fn.loops && !this.fn.sw) this.err('break statement not within loop or switch', s); return 'break;';
      case 'continue': if (!this.fn.loops) this.err('continue statement not within a loop', s); return 'continue;';
      case 'return': {
        this.fn.hasReturn = true;
        if (!s.e) { if (this.fn.ret !== 'void') this.warnings.push({ line: s.tok.line, col: s.tok.col, msg: `return with no value in function returning '${tName(this.fn.ret)}'` }); return `${L}return${this.fn.ret === 'void' ? '' : ' 0'};`; }
        const e = this.expr(s.e);
        if (this.fn.ret === 'void') { if (e.t !== 'void') this.err("return with a value in a function returning 'void'", s); return `${L}${e.c}; return;`; }
        return `${L}return ${this.conv(e, this.fn.ret, s.e)};`;
      }
    }
    this.err('unknown statement', s);
  }
  localVar(v) {
    if (v.isStatic) {
      // a static local lives in a global slot; it initialises the first time through
      const n = ++this.statics, js = `s_${n}_${v.name}`;
      this.globalsDecl.push(`${js} = ${this.zeroOf(v)}`, `${js}_i = 0`);
      const lines = this.varInit(v, js, true);
      return `if (!${js}_i) { ${js}_i = 1; ${lines.join(' ')} }`;
    }
    return this.varInit(v, 'u_' + v.name + '_' + (++this.fn.vars), false).join('\n');
  }

  // ── expressions: return { c, t, k?:'lit', v? } ──
  lit(v, t) { return { c: (typeof v === 'string' ? JSON.stringify(v) : (Object.is(v, -0) ? '0' : String(v))), t, k: 'lit', v }; }
  numLit(node) {
    const { v, num } = node;
    if (num.isFloat) return this.lit(num.f ? Math.fround(v) : v, num.f ? 'f32' : this.DBL);
    const dec = num.radix === 10;
    let cands;
    if (num.u && num.l) cands = ['u32'];
    else if (num.u) cands = [this.UINT, 'u32'];
    else if (num.l) cands = dec ? ['i32'] : ['i32', 'u32'];
    else cands = dec ? [this.INT, 'i32'] : [this.INT, this.UINT, 'i32', 'u32'];
    for (const t of cands) if (v >= RANGE[t][0] && v <= RANGE[t][1]) return this.lit(v, t);
    if (v <= 4294967295) return this.lit(v, 'u32');
    this.warnings.push({ line: node.tok.line, col: node.tok.col, msg: 'integer constant is too large; it wraps' });
    return this.lit(litWrap('u32', v), 'u32');
  }
  // fold two literal operands where the result is a plain literal
  fold(op, a, b, T) {
    if (a.k !== 'lit' || b.k !== 'lit' || typeof a.v !== 'number' || typeof b.v !== 'number') return null;
    const x = isInt(T) ? litWrap(T, a.v) : a.v, y = isInt(T) ? litWrap(T, b.v) : b.v;
    let r;
    switch (op) {
      case '+': r = x + y; break; case '-': r = x - y; break; case '*': r = isInt(T) && T.endsWith('32') ? (T === 'i32' ? Math.imul(x, y) : Math.imul(x, y) >>> 0) : x * y; break;
      case '/': if (y === 0) return null; r = isInt(T) ? Math.trunc(x / y) : x / y; break;
      case '%': if (y === 0 || !isInt(T)) return null; r = x % y; break;
      case '&': r = x & y; break; case '|': r = x | y; break; case '^': r = x ^ y; break;
      case '<<': r = x << y; break; case '>>': r = T[0] === 'u' ? (x >>> y) : (x >> y); break;
      default: return null;
    }
    if (T === 'u32' && (op === '&' || op === '|' || op === '^' || op === '<<')) r = r >>> 0;
    return this.lit(isInt(T) ? litWrap(T, r) : r, T);
  }
  arith(op, a, b, T, node) {
    const f = this.fold(op, a, b, T);
    if (f) return f;
    const A = this.conv(a, T, node), Bc = this.conv(b, T, node);
    let c;
    if (isFloat(T)) {
      if (op === '%') this.err("invalid operands to '%' (float); use fmod()", node);
      if ('&|^<<>>'.includes(op)) this.err(`invalid operands of type '${tName(T)}' to '${op}'`, node);
      c = `(${A} ${op} ${Bc})`;
      if (T === 'f32') c = `Math.fround${c}`;
      return { c, t: T };
    }
    switch (op) {
      case '+': case '-': c = wrapCode(T, `${A} ${op} ${Bc}`); break;
      case '*': c = T === 'i32' ? `Math.imul(${A}, ${Bc})` : T === 'u32' ? `(Math.imul(${A}, ${Bc})>>>0)` : wrapCode(T, `${A} * ${Bc}`); break;
      case '/': c = wrapCode(T, `$.div(${A}, ${Bc})`); break;
      case '%': c = `$.mod(${A}, ${Bc})`; break;
      case '&': case '|': case '^': c = T === 'u32' ? `((${A} ${op} ${Bc})>>>0)` : `(${A} ${op} ${Bc})`; break;
      default: this.err('bad operator ' + op, node);
    }
    return { c, t: T };
  }
  shift(op, a, b, node) {
    if (!isInt(a.t) || !isInt(b.t)) this.err(`invalid operands of types '${tName(a.t)}' and '${tName(b.t)}' to '${op}'`, node);
    const T = this.promote(a.t);
    const f = this.fold(op, a, { ...b, v: b.v }, T);
    if (f && b.k === 'lit') return f;
    const A = this.conv(a, T, node), Bc = this.conv(b, this.promote(b.t), node);
    if (op === '<<') return { c: wrapCode(T, `${A} << ${Bc}`), t: T };
    return { c: T[0] === 'u' ? `(${A} >>> ${Bc})` : `(${A} >> ${Bc})`, t: T };
  }
  // lvalue: { t, prep, get, set(v) }
  lvalue(node) {
    if (node.k === 'id') {
      const s = this.lookup(node.name);
      if (!s) {
        if (this.consts[node.name]) this.err(`'${node.name}' is a constant and cannot be assigned`, node);
        this.err(`'${node.name}' was not declared in this scope`, node);
      }
      if (s.kind === 'const') this.err(`'${node.name}' is a constant and cannot be assigned`, node);
      if (s.kind === 'obj') this.err(`a ${tName(s.t)} cannot be assigned`, node);
      if (isArr(s.t)) this.err(`array '${node.name}' cannot be assigned as a whole; assign its elements`, node);
      if (s.isConst) this.err(`assignment of read-only variable '${node.name}'`, node);
      return { t: s.t, prep: '', get: s.js, set: v => `${s.js} = ${v}` };
    }
    if (node.k === 'idx') {
      const base = this.expr(node.a);
      if (base.t === 'String') this.err('a String character cannot be assigned with [ ]; use setCharAt()', node);
      if (!isArr(base.t)) this.err(`'${tName(base.t)}' is not an array`, node);
      if (base.t.dims.length > 1) this.err('assign to one element: give every index', node);
      if (base.sym && base.sym.isConst) this.err('assignment of a read-only array', node);
      const i = this.expr(node.i);
      if (!isInt(i.t)) this.err('array index is not an integer', node.i);
      const ta = this.tmp(), ti = this.tmp();
      return { t: base.t.el, prep: `${ta} = ${base.c}, ${ti} = $.ix(${ta}, ${i.c})`, get: `${ta}[${ti}]`, set: v => `${ta}[${ti}] = ${v}` };
    }
    if (node.k === 'cast') this.err('a cast is not assignable', node);
    this.err('lvalue required as the left operand of an assignment', node);
  }
  expr(node, discard = false) {
    switch (node.k) {
      case 'num': return this.numLit(node);
      case 'chr': return this.lit(node.v, 'char');
      case 'str': return this.lit(node.v, 'cstr');
      case 'id': return this.ident(node);
      case 'comma': { const a = this.expr(node.a, true), b = this.expr(node.b, discard); return { c: `(${a.c}, ${b.c})`, t: b.t }; }
      case 'cast': {
        const e = this.expr(node.a);
        if (node.t === 'void') return { c: e.c, t: 'void' };
        if (node.t.startsWith && node.t.startsWith('obj:')) this.err('cannot cast to a library object', node);
        if (node.t === 'cstr' && !isText(e.t) && !isCharArr(e.t)) this.err('pointers are not supported in the sketch runtime', node);
        const c = this.conv(e, node.t, node, true);
        if (e.k === 'lit' && isNum(node.t) && typeof e.v === 'number') return this.lit(litWrap(node.t, e.v), node.t);
        return { c, t: node.t };
      }
      case 'sizeof': {
        const t = node.t || this.expr(node.a).t;
        const sz = ty => isArr(ty) ? ty.dims.reduce((m, d) => m * (d ?? 0), 1) * sz(ty.el) : ty === 'i16' && this.INT === 'i32' ? 2 : (SIZE[ty] ?? 2);
        if (isArr(t) && t.dims[0] === null) this.warnings.push({ line: node.tok.line, col: node.tok.col, msg: 'sizeof on an array parameter gives the pointer size' });
        return this.lit(isArr(t) && t.dims[0] === null ? 2 : sz(t), this.UINT);
      }
      case 'un': {
        const a = this.expr(node.a);
        if (node.op === '!') {
          if (a.k === 'lit' && typeof a.v === 'number') return this.lit(a.v ? 0 : 1, 'bool');
          if (a.t === 'obj:Serial') return { c: '0', t: 'bool' };
          if (!isNum(a.t)) this.err(`no match for 'operator!' on '${tName(a.t)}'`, node);
          return { c: `(+!${a.c})`, t: 'bool' };
        }
        if (!isNum(a.t)) this.err(`wrong type argument to unary '${node.op}'`, node);
        const T = isFloat(a.t) ? a.t : this.promote(a.t);
        if (node.op === '~') {
          if (isFloat(T)) this.err("wrong type argument to bit-complement", node);
          if (a.k === 'lit') return this.lit(litWrap(T, ~litWrap(T, a.v)), T);
          return { c: wrapCode(T, `~${this.conv(a, T, node)}`), t: T };
        }
        if (node.op === '+') return a.k === 'lit' ? this.lit(litWrap(T, a.v), T) : { c: this.conv(a, T, node), t: T };
        if (a.k === 'lit') return this.lit(isInt(T) ? litWrap(T, -a.v) : -a.v, T);
        return { c: isFloat(T) ? `(-${a.c})` : wrapCode(T, `-${this.conv(a, T, node)}`), t: T };
      }
      case 'addr': this.err('pointers are not supported in the sketch runtime (the & operator)', node); break;
      case 'bin': return this.binary(node);
      case 'log': {
        const a = this.cond(node.a), b = this.cond(node.b);
        return { c: `(+(!!(${a}) ${node.op} !!(${b})))`, t: 'bool' };
      }
      case 'cond': {
        const c = this.cond(node.c), a = this.expr(node.a), b = this.expr(node.b);
        let T;
        if (isNum(a.t) && isNum(b.t)) T = a.t === b.t ? a.t : this.common(a.t, b.t, node);
        else if (a.t === b.t) T = a.t;
        else if (isText(a.t) && isText(b.t)) T = 'String';
        else if (a.t === 'void' || b.t === 'void') T = 'void';
        else this.err(`operands to ?: have different types '${tName(a.t)}' and '${tName(b.t)}'`, node);
        return { c: `(${c} ? ${this.conv(a, T, node)} : ${this.conv(b, T, node)})`, t: T };
      }
      case 'asg': return this.assign(node);
      case 'pre': case 'post': return this.incdec(node, discard);
      case 'idx': {
        const base = this.expr(node.a), i = this.expr(node.i);
        if (!isInt(i.t)) this.err('array index is not an integer', node.i);
        if (isText(base.t)) return { c: `$.sAt(${base.c}, ${i.c})`, t: 'char' };
        if (!isArr(base.t)) this.err(`'${tName(base.t)}' is not an array`, node);
        const rest = base.t.dims.slice(1);
        const t = rest.length ? { k: 'arr', el: base.t.el, dims: rest } : base.t.el;
        if (base.c.match(/^[A-Za-z_$][\w$]*$/)) return { c: `${base.c}[$.ix(${base.c}, ${i.c})]`, t, sym: base.sym };
        const ta = this.tmp();
        return { c: `(${ta} = ${base.c})[$.ix(${ta}, ${i.c})]`, t, sym: base.sym };
      }
      case 'call': return this.call(node);
      case 'mcall': return this.mcall(node);
    }
    this.err('unknown expression', node);
  }
  ident(node) {
    const s = this.lookup(node.name);
    if (s) {
      if (s.kind === 'const') return this.lit(s.v, s.t);
      if (s.constVal !== undefined) return { ...this.lit(s.constVal, s.t), c: s.js, k: 'lit' };
      return { c: s.js, t: s.t, sym: s };
    }
    if (this.consts[node.name]) { const k = this.consts[node.name]; return this.lit(k.v, k.t); }
    if (node.name === 'Serial') { this.uses.serial = true; return { c: 'S', t: 'obj:Serial' }; }
    if (/^B[01]{1,8}$/.test(node.name)) return this.lit(parseInt(node.name.slice(1), 2), this.INT);
    const f = this.funcs.get(node.name);
    if (f) return { c: f.js, t: 'fn', fn: f };
    if (BUILTINS[node.name]) this.err(`'${node.name}' is a function; call it with ( )`, node);
    if (node.name === 'Serial1' || node.name === 'Serial2') this.err(`${node.name} is not available in the simulator; use Serial`, node);
    if (node.name === 'Wire' || node.name === 'SPI' || node.name === 'WiFi' || node.name === 'EEPROM') this.err(`the ${node.name} library is not available in this simulator`, node);
    this.err(`'${node.name}' was not declared in this scope`, node);
  }
  binary(node) {
    const a = this.expr(node.a), b = this.expr(node.b), op = node.op;
    if (op === '<<' || op === '>>') return this.shift(op, a, b, node);
    if (['==', '!=', '<', '>', '<=', '>='].includes(op)) {
      if (isText(a.t) || isText(b.t) || isCharArr(a.t) || isCharArr(b.t)) {
        const sa = this.conv(a, 'String', node), sb = this.conv(b, 'String', node);
        if (a.t === 'cstr' && b.t === 'cstr') this.warnings.push({ line: node.tok.line, col: node.tok.col, msg: 'comparing two string literals compares addresses in C; this simulator compares the text' });
        return { c: `(+(${sa} ${op === '==' ? '===' : op === '!=' ? '!==' : op} ${sb}))`, t: 'bool' };
      }
      const T = this.common(a.t, b.t, node);
      if (a.k === 'lit' && b.k === 'lit') {
        const x = isInt(T) ? litWrap(T, a.v) : a.v, y = isInt(T) ? litWrap(T, b.v) : b.v;
        return this.lit(({ '==': x === y, '!=': x !== y, '<': x < y, '>': x > y, '<=': x <= y, '>=': x >= y })[op] ? 1 : 0, 'bool');
      }
      if (isInt(a.t) && isInt(b.t) && (a.t[0] === 'i' || a.t === 'char') !== (b.t[0] === 'i' || b.t === 'char') && T[0] === 'u') {
        const lit = a.k === 'lit' ? a : b.k === 'lit' ? b : null;
        if (!lit || lit.v < 0) this.warnings.push({ line: node.tok.line, col: node.tok.col, msg: 'comparison of integers of different signs' });
      }
      return { c: `(+(${this.conv(a, T, node)} ${op === '==' ? '===' : op === '!=' ? '!==' : op} ${this.conv(b, T, node)}))`, t: 'bool' };
    }
    if (op === '+' && (a.t === 'String' || b.t === 'String')) {
      return { c: `(${this.conv(a, 'String', node)} + ${this.conv(b, 'String', node)})`, t: 'String' };
    }
    if (op === '+' && (a.t === 'cstr' || b.t === 'cstr')) {
      this.err(a.t === 'cstr' && b.t === 'cstr' ? 'cannot add two string literals; write String("...") + "..."' : 'adding a number to a string literal moves a pointer in C; use String("...") + value', node);
    }
    if (isArr(a.t) || isArr(b.t)) this.err('arithmetic on an array is not supported (no pointers); index it', node);
    const T = this.common(a.t, b.t, node);
    return this.arith(op, a, b, T, node);
  }
  assign(node) {
    const lv = this.lvalue(node.a);
    const pre = lv.prep ? lv.prep + ', ' : '';
    const wrapP = c => lv.prep ? `(${pre}${c})` : `(${c})`;
    if (node.op === '=') {
      const e = this.expr(node.b);
      if (e.t === 'void') this.err('a void value cannot be assigned', node.b);
      return { c: wrapP(lv.set(this.conv(e, lv.t, node.b))), t: lv.t };
    }
    const op = node.op.slice(0, -1);
    const b = this.expr(node.b);
    const cur = { c: lv.get, t: lv.t };
    if (lv.t === 'String') {
      if (op !== '+') this.err(`operator ${node.op} is not defined for String`, node);
      return { c: wrapP(lv.set(`${lv.get} + ${this.conv(b, 'String', node.b)}`)), t: 'String' };
    }
    if (lv.t === 'cstr') this.err('a string literal cannot be changed; use a String', node);
    let r;
    if (op === '<<' || op === '>>') r = this.shift(op, cur, b, node);
    else r = this.arith(op, cur, b, this.common(lv.t, b.t, node), node);
    return { c: wrapP(lv.set(this.conv(r, lv.t, node))), t: lv.t };
  }
  incdec(node, discard) {
    const lv = this.lvalue(node.a);
    if (!isNum(lv.t)) this.err(`cannot apply ${node.op} to '${tName(lv.t)}'`, node);
    const d = node.op === '++' ? '+' : '-';
    const T = isFloat(lv.t) ? lv.t : this.promote(lv.t);
    const step = v => this.conv({ c: isFloat(T) ? `(${v} ${d} 1)` : wrapCode(T, `${v} ${d} 1`), t: T }, lv.t, node);
    const pre = lv.prep ? lv.prep + ', ' : '';
    if (node.k === 'pre' || discard) return { c: `(${pre}${lv.set(step(lv.get))})`, t: lv.t };
    const t = this.tmp();
    return { c: `(${pre}${t} = ${lv.get}, ${lv.set(step(t))}, ${t})`, t: lv.t };
  }
  args(node, min, max, name) {
    const n = node.args.length;
    if (n < min) this.err(`too few arguments to '${name}' (needs ${min})`, node);
    if (n > max) this.err(`too many arguments to '${name}' (takes ${max === min ? max : `${min} to ${max}`})`, node);
  }
  num(node) {
    const e = this.expr(node);
    if (!isNum(e.t)) this.err(`expected a number, got '${tName(e.t)}'`, node);
    return e;
  }
  call(node) {
    if (node.f.k !== 'id') this.err('only named functions can be called (no pointers)', node);
    const name = node.f.name;
    const local = this.lookup(name);
    if (local) this.err(`'${name}' is not a function`, node);
    if (name === 'String') return this.stringCtor(node);
    const f = this.funcs.get(name);
    if (f) {
      const need = f.params.length, required = f.dflts.findIndex(x => x) >= 0 ? f.dflts.findIndex(x => x) : need;
      this.args(node, required, need, name);
      const args = node.args.map((a, i) => {
        const e = this.expr(a);
        if (e.t === 'void') this.err('a void value cannot be passed', a);
        return this.conv(e, f.params[i], a);
      });
      return { c: `(yield* ${f.js}(${args.join(', ')}))`, t: f.ret };
    }
    const bi = BUILTINS[name];
    if (!bi) {
      if (/^(malloc|free|memcpy|memset|strcpy|strcat)$/.test(name)) this.err(`${name}() needs pointers, which are not supported in the sketch runtime`, node);
      if (/^(Wire|SPI|WiFi|EEPROM)/.test(name)) this.err(`the ${name} library is not available in this simulator`, node);
      this.err(`'${name}' was not declared in this scope`, node);
    }
    return this.builtin(name, bi, node);
  }
  stringCtor(node) {
    this.args(node, 0, 2, 'String');
    if (!node.args.length) return { c: '""', t: 'String' };
    const e = this.expr(node.args[0]);
    const extra = node.args[1] ? this.conv(this.num(node.args[1]), this.INT, node.args[1]) : 'undefined';
    if (isText(e.t)) return { c: e.c, t: 'String' };
    if (isCharArr(e.t)) return { c: `$.cstr(${e.c})`, t: 'String' };
    if (!isNum(e.t)) this.err(`cannot make a String from '${tName(e.t)}'`, node);
    return { c: `$.str(${e.c}, '${e.t}', ${extra}, 1)`, t: 'String' };
  }
  textArg(a) {
    const e = this.expr(a);
    if (isText(e.t)) return e.c;
    if (isCharArr(e.t)) return `$.cstr(${e.c})`;
    this.err(`expected text, got '${tName(e.t)}'`, a);
  }
  printArgs(node, name, newline) {
    this.args(node, newline ? 0 : 1, 2, name);
    if (!node.args.length) return `"", 'cstr', undefined`;
    const e = this.expr(node.args[0]);
    let tag;
    if (isCharArr(e.t)) tag = 'chararr';
    else if (isNum(e.t) || isText(e.t)) tag = e.t;
    else if (e.t === 'obj:Serial') this.err('cannot print Serial', node);
    else this.err(`cannot print a value of type '${tName(e.t)}'`, node.args[0]);
    const fmt = node.args[1] ? this.conv(this.num(node.args[1]), this.INT, node.args[1]) : 'undefined';
    if (node.args[1] && isText(e.t)) this.err('print(text, format) takes a number as the first argument', node);
    return `${e.c}, '${tag}', ${fmt}`;
  }
  varArgs(list) {
    return list.map(a => {
      const e = this.expr(a);
      if (isCharArr(e.t)) return `$.cstr(${e.c})`;
      if (isNum(e.t) || isText(e.t)) return e.c;
      this.err(`cannot format a value of type '${tName(e.t)}'`, a);
    }).join(', ');
  }
  builtin(name, bi, node) {
    const kind = bi[0];
    if (kind === 'math') {
      const n = MATH_ARGS[name] || 1;
      this.args(node, n, n, name);
      const args = node.args.map(a => this.conv(this.num(a), 'f64', a));
      const T = /f$/.test(name) && name !== 'fmodf' ? 'f32' : this.DBL;
      if (args.every((_, i) => this.expr(node.args[i]).k === 'lit') && MATH[name].startsWith('Math.')) {
        const v = Math[MATH[name].slice(5)](...node.args.map(a => this.expr(a).v));
        return this.lit(T === 'f32' ? Math.fround(v) : v, T);
      }
      const c = `${MATH[name]}(${args.join(', ')})`;
      return { c: T === 'f32' ? `Math.fround(${c})` : c, t: T };
    }
    if (kind === 'macro') return this.macro(name, node);
    if (kind === 'pgm') {
      this.args(node, 1, 1, name);
      const a = node.args[0];
      if (a.k !== 'addr') this.err(`${name} expects &array[index]`, node);
      return this.expr(a.a);
    }
    if (kind === 'sprintf') {
      const isN = name === 'snprintf';
      if (node.args.length < (isN ? 3 : 2)) this.err(`too few arguments to '${name}'`, node);
      const buf = this.expr(node.args[0]);
      if (!isCharArr(buf.t)) this.err(`${name} writes into a char array`, node.args[0]);
      const size = isN ? this.conv(this.num(node.args[1]), this.INT, node.args[1]) : 'Infinity';
      const fmt = this.textArg(node.args[isN ? 2 : 1]);
      const rest = this.varArgs(node.args.slice(isN ? 3 : 2));
      return { c: `$.sprintf(${buf.c}, ${size}, ${fmt}${rest ? ', ' + rest : ''})`, t: this.INT };
    }
    if (kind === 'dtostrf') {
      this.args(node, 4, 4, name);
      const buf = this.expr(node.args[3]);
      if (!isCharArr(buf.t)) this.err('dtostrf writes into a char array (the 4th argument)', node.args[3]);
      const [v, w, p] = node.args.slice(0, 3).map(a => this.num(a).c);
      return { c: `$.dtostrf(${v}, ${w}, ${p}, ${buf.c})`, t: 'cstr' };
    }
    const [, ret, min, max] = bi;
    this.args(node, min, max, name);
    let args;
    if (name === 'attachInterrupt') {
      const f = this.expr(node.args[1]);
      if (f.t !== 'fn') this.err('attachInterrupt needs the name of a function (without ())', node.args[1]);
      if (f.fn.params.length) this.err('an interrupt handler takes no parameters', node.args[1]);
      this.uses.interrupts = true;
      args = [this.num(node.args[0]).c, f.c, this.num(node.args[2]).c];
    } else if (name === 'strlen' || name === 'atoi' || name === 'atol' || name === 'atof') {
      args = [this.textArg(node.args[0])];
    } else if (name === 'strcmp') {
      args = node.args.map(a => this.textArg(a));
    } else {
      args = node.args.map(a => { const e = this.num(a); return e.c; });
    }
    if (name === 'tone' || name === 'noTone') this.uses.tone = true;
    if (/^ledc/.test(name) && this.B.family !== 'esp32') this.err(`${name} is only available on the ESP32`, node);
    if ((name === 'analogReadResolution' || name === 'analogWriteResolution') && this.B.family !== 'esp32') this.err(`${name} is not available on this board`, node);
    const T = this.resolveRet(ret);
    if (kind === 'g') return { c: `(yield* B.${name}(${args.join(', ')}))`, t: T };
    return { c: `B.${name}(${args.join(', ')})`, t: T };
  }
  macro(name, node) {
    const A = i => this.num(node.args[i]);
    switch (name) {
      case 'F': case 'PSTR': {
        this.args(node, 1, 1, name);
        const e = this.expr(node.args[0]);
        if (e.t !== 'cstr') this.err(`${name}() takes a string literal`, node);
        return e;
      }
      case 'min': case 'max': {
        this.args(node, 2, 2, name);
        const a = A(0), b = A(1), T = this.common(a.t, b.t, node);
        if (a.k === 'lit' && b.k === 'lit') return this.lit(Math[name](litWrap(T, a.v), litWrap(T, b.v)), T);
        return { c: `Math.${name}(${this.conv(a, T, node)}, ${this.conv(b, T, node)})`, t: T };
      }
      case 'constrain': {
        this.args(node, 3, 3, name);
        const x = A(0), lo = A(1), hi = A(2);
        const T = this.common(this.common(x.t, lo.t, node), hi.t, node);
        return { c: `$.constrain(${this.conv(x, T, node)}, ${this.conv(lo, T, node)}, ${this.conv(hi, T, node)})`, t: T };
      }
      case 'abs': {
        this.args(node, 1, 1, name);
        const a = A(0), T = isFloat(a.t) ? a.t : this.promote(a.t);
        if (a.k === 'lit') return this.lit(isInt(T) ? litWrap(T, Math.abs(a.v)) : Math.abs(a.v), T);
        return { c: isFloat(T) ? `Math.abs(${a.c})` : wrapCode(T, `Math.abs(${this.conv(a, T, node)})`), t: T };
      }
      case 'sq': {
        this.args(node, 1, 1, name);
        const a = A(0); const ta = this.tmp();
        return this.arith('*', { c: `(${ta} = ${a.c})`, t: a.t }, { c: ta, t: a.t }, isFloat(a.t) ? a.t : this.promote(a.t), node);
      }
      case 'bit': {
        this.args(node, 1, 1, name);
        const a = A(0);
        if (a.k === 'lit') return this.lit((1 << a.v) >>> 0, 'u32');
        return { c: `((1 << ${a.c})>>>0)`, t: 'u32' };
      }
      case 'lowByte': this.args(node, 1, 1, name); return { c: `((${A(0).c})&255)`, t: 'u8' };
      case 'highByte': this.args(node, 1, 1, name); return { c: `(((${A(0).c})>>8)&255)`, t: 'u8' };
      case 'bitRead': {
        this.args(node, 2, 2, name);
        return { c: `((${A(0).c} >>> ${A(1).c}) & 1)`, t: this.INT };
      }
      case 'bitSet': case 'bitClear': case 'bitWrite': {
        this.args(node, name === 'bitWrite' ? 3 : 2, name === 'bitWrite' ? 3 : 2, name);
        const lv = this.lvalue(node.args[0]);
        if (!isInt(lv.t)) this.err(`${name} needs an integer variable`, node.args[0]);
        const n = A(1).c;
        const set = this.conv({ c: `(${lv.get} | (1 << ${n}))`, t: 'i32' }, lv.t, node);
        const clr = this.conv({ c: `(${lv.get} & ~(1 << ${n}))`, t: 'i32' }, lv.t, node);
        const pre = lv.prep ? lv.prep + ', ' : '';
        if (name === 'bitSet') return { c: `(${pre}${lv.set(set)})`, t: lv.t };
        if (name === 'bitClear') return { c: `(${pre}${lv.set(clr)})`, t: lv.t };
        const b = A(2).c;
        return { c: `(${pre}${lv.set(`(${b}) ? ${set} : ${clr}`)})`, t: lv.t };
      }
    }
    this.err('unknown macro ' + name, node);
  }
  mcall(node) {
    const o = this.expr(node.obj);
    const name = node.name;
    if (o.t === 'obj:Serial') return this.objCall('S', SERIAL_M, 'Serial', name, node);
    if (o.t === 'obj:LCD') return this.objCall(o.c, LCD_M, 'LiquidCrystal', name, node);
    if (o.t === 'obj:Servo') return this.objCall(o.c, SERVO_M, 'Servo', name, node);
    if (o.t === 'String' || o.t === 'cstr') {
      const m = STRING_M[name];
      if (!m) this.err(`'String' has no member named '${name}'`, node);
      const [kind, ret, min, max] = m;
      this.args(node, min, max, name);
      if (o.t === 'cstr' && name !== 'c_str' && name !== 'length') this.err(`a string literal has no method ${name}(); wrap it in String("...")`, node);
      const args = node.args.map((a, i) => {
        const e = this.expr(a);
        if (['concat', 'equals', 'equalsIgnoreCase', 'startsWith', 'endsWith', 'compareTo', 'replace'].includes(name) || ((name === 'indexOf' || name === 'lastIndexOf') && i === 0)) {
          if (isNum(e.t) && e.t !== 'char' && (name === 'indexOf' || name === 'lastIndexOf')) this.err(`${name} takes a char or a String`, a);
          return isNum(e.t) ? this.conv(e, 'String', a) : this.conv(e, 'String', a);
        }
        if (name === 'setCharAt' && i === 1) return this.conv(e, 'char', a);
        return this.conv(this.num(a), 'i32', a);
      });
      if (kind === 'm') {
        const lv = this.lvalue(node.obj);
        const pre = lv.prep ? lv.prep + ', ' : '';
        const r = name === 'concat' ? ', 1' : '';
        return { c: `(${pre}${lv.set(`$.sm.${name}(${lv.get}${args.length ? ', ' + args.join(', ') : ''})`)}${r})`, t: this.resolveRet(ret) };
      }
      return { c: `$.sm.${name}(${o.c}${args.length ? ', ' + args.join(', ') : ''})`, t: this.resolveRet(ret) };
    }
    if (isArr(o.t)) this.err('arrays have no methods; use sizeof(a) / sizeof(a[0]) for the length', node);
    this.err(`request for member '${name}' in a value of type '${tName(o.t)}'`, node);
  }
  objCall(objCode, table, cls, name, node) {
    const m = table[name];
    if (!m) this.err(`'${cls}' has no member named '${name}'`, node);
    if (cls === 'Serial') this.uses.serial = true;
    const kind = m[0];
    if (kind === 'print') return { c: `(yield* ${objCode}.${name}(${this.printArgs(node, `${cls}.${name}`, name === 'println')}))`, t: this.UINT };
    if (kind === 'write') {
      this.args(node, 1, 2, `${cls}.write`);
      const e = this.expr(node.args[0]);
      let a;
      if (isNum(e.t)) a = this.conv(e, 'i32', node.args[0]);
      else if (isText(e.t) || isCharArr(e.t)) a = this.conv(e, 'String', node.args[0]);
      else this.err('write takes a byte or text', node);
      if (node.args[1]) {
        if (!isArr(e.t)) this.err('write(buffer, length) needs an array', node);
        return { c: `(yield* ${objCode}.writeBuf(${e.c}, ${this.num(node.args[1]).c}))`, t: this.UINT };
      }
      return { c: `(yield* ${objCode}.write(${a}))`, t: this.UINT };
    }
    if (kind === 'printf') {
      if (this.B.family !== 'esp32') this.err('Serial.printf is not available on the 328 boards; use sprintf into a char array, then Serial.print', node);
      if (!node.args.length) this.err('printf needs a format', node);
      const fmt = this.textArg(node.args[0]);
      const rest = this.varArgs(node.args.slice(1));
      return { c: `(yield* S.printf(${fmt}${rest ? ', ' + rest : ''}))`, t: this.UINT };
    }
    const [, ret, min, max] = m;
    this.args(node, min, max, `${cls}.${name}`);
    let args;
    if (cls === 'LiquidCrystal' && name === 'createChar') {
      const arr = this.expr(node.args[1]);
      if (!isArr(arr.t)) this.err('createChar needs a byte array of 8 rows', node.args[1]);
      args = [this.num(node.args[0]).c, arr.c];
    } else if (cls === 'Serial' && (name === 'readStringUntil' || name === 'find')) {
      const e = this.expr(node.args[0]);
      args = [isNum(e.t) ? `String.fromCharCode(${e.c} & 255)` : this.conv(e, 'String', node.args[0])];
    } else args = node.args.map(a => this.num(a).c);
    const T = this.resolveRet(ret);
    if (kind === 'g') return { c: `(yield* ${objCode}.${name}(${args.join(', ')}))`, t: T };
    return { c: `${objCode}.${name}(${args.join(', ')})`, t: T };
  }
}

// ── the export ──────────────────────────────────────────────────────────────
export function compileSketch(source, { board = 'uno328' } = {}) {
  const errors = [], warnings = [];
  if (!BOARDS[board]) return { ok: false, errors: [{ line: 0, col: 0, msg: `unknown board '${board}'` }], warnings, info: null };
  if (typeof source !== 'string') return { ok: false, errors: [{ line: 0, col: 0, msg: 'the sketch has no source text' }], warnings, info: null };
  try {
    const toks = lex(source);
    const { toks: pp, libs } = preprocess(toks, board, warnings);
    const B = BOARDS[board];
    const libTypes = new Set();
    if (libs.has('LiquidCrystal')) libTypes.add('LiquidCrystal');
    if (libs.has('Servo')) libTypes.add('Servo');
    const enums = new Set();
    const ctx = {
      libTypes, enums,
      resolveType(words, tok) {
        const has = w => words.includes(w);
        const intT = B.intBits === 16 ? 'i16' : 'i32', uintT = B.intBits === 16 ? 'u16' : 'u32';
        const w = words.filter(x => x !== 'signed');
        const map = {
          void: 'void', bool: 'bool', boolean: 'bool', char: 'char', byte: 'u8', word: 'u16', size_t: uintT,
          uint8_t: 'u8', int8_t: 'i8', uint16_t: 'u16', int16_t: 'i16', uint32_t: 'u32', int32_t: 'i32', String: 'String',
          float: 'f32', double: B.doubleBits === 32 ? 'f32' : 'f64', LiquidCrystal: 'obj:LCD', Servo: 'obj:Servo', unsigned_char: 'u8'
        };
        if (has('uint64_t') || has('int64_t')) throw new CErr('64-bit integers are not supported', tok);
        const longs = w.filter(x => x === 'long').length;
        if (longs >= 2) throw new CErr('long long is not supported', tok);
        const uns = has('unsigned');
        if (has('double') && longs) return map.double;
        if (has('char')) return uns ? 'u8' : (has('signed') ? 'i8' : 'char');
        if (has('short')) return uns ? 'u16' : 'i16';
        if (longs) return uns ? 'u32' : 'i32';
        if (has('int') || (uns && w.length === 1) || (has('signed') && w.length === 0)) return uns ? uintT : intT;
        if (w.length !== 1) {
          if (uns) throw new CErr(`'unsigned ${w.filter(x => x !== 'unsigned').join(' ')}' is not a type`, tok);
          throw new CErr(`'${words.join(' ')}' is not a type`, tok);
        }
        if (map[w[0]]) return map[w[0]];
        if (w[0] === 'int') return intT;
        throw new CErr(`'${w[0]}' is not a type`, tok);
      }
    };
    const parser = new Parser(pp, ctx);
    const decls = parser.program();
    const gen = new Gen(board, libs, warnings);
    const code = gen.program(decls);
    // a syntax check of the output: a bug in the generator shows here, not at run time
    try { new Function('$', code); } catch (e) { return { ok: false, errors: [{ line: 0, col: 0, msg: 'internal compiler error: ' + e.message }], warnings, info: null, code }; }
    return { ok: true, code, errors, warnings, info: { board, libs: [...libs], uses: gen.uses, functions: [...gen.funcs.keys()] } };
  } catch (e) {
    if (e instanceof CErr) errors.push({ line: e.line, col: e.col, msg: e.message });
    else errors.push({ line: 0, col: 0, msg: 'internal compiler error: ' + (e && e.message) });
    return { ok: false, errors, warnings, info: null };
  }
}
