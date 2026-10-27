// ============================================================================
//  BREADBOARD LAB  ·  mcu/compile/gen-exprs.js — expressions -> JS
// ----------------------------------------------------------------------------
//  Each method returns { c, t, k?: "lit", v? }: the JS code, the C type, and
//  the value when the expression is a literal.
//
//  grep -n targets
//    lit / numLit / fold .. literals and constant folding
//    arith / shift ........ arithmetic with width wrap
//    lvalue ............... a store target
//    expr ................. the dispatch
//    ident ................ a name
//    binary ............... binary operators
//    assign / incdec ...... stores
// ============================================================================
import { RANGE, SIZE, isInt, isFloat, isNum, isArr, isText, isCharArr, tName, wrapCode, litWrap } from './types.js';
import { BUILTINS } from './api.js';

export class GenExprs {
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
}
