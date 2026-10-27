// ============================================================================
//  BREADBOARD LAB  ·  mcu/compile/gen-core.js — the code generator state, type rules and symbols
// ----------------------------------------------------------------------------
//  new Gen(board, libs, warnings). gen.js adds the methods of gen-decls.js,
//  gen-stmts.js, gen-exprs.js and gen-calls.js to this class.
//
//  grep -n targets
//    constructor .......... board widths, the Arduino constants
//    promote / common ..... the usual arithmetic conversions
//    conv ................. convert an expression to a type
//    lookup / declare ..... scopes
//    constEval ............ a constant value
// ============================================================================
import { BOARDS } from '../boards.js';
import { CErr } from './errors.js';
import { RANGE, isInt, isFloat, isNum, isArr, isText, isCharArr, tName, wrapCode, litWrap } from './types.js';
import { BUILTINS } from './api.js';

export class Gen {
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
}
