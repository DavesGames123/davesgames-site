// ============================================================================
//  BREADBOARD LAB  ·  mcu/compile/gen-calls.js — calls -> JS: user functions, the Arduino API, object methods
// ----------------------------------------------------------------------------
//  A call to a user function becomes (yield* u_f(...)). A blocking built-in
//  is a generator in the runtime, so it is called with yield* too.
//
//  grep -n targets
//    args / num ........... argument checks
//    call ................. a call
//    stringCtor / textArg . String values
//    printArgs ............ print and println
//    builtin .............. BUILTINS codegen
//    macro ................ the macro-like built-ins
//    mcall / objCall ...... Serial, lcd, servo, String methods
// ============================================================================
import { isInt, isFloat, isNum, isArr, isText, isCharArr, tName, wrapCode, litWrap } from './types.js';
import { SERIAL_M, LCD_M, SERVO_M, STRING_M, BUILTINS, MATH, MATH_ARGS } from './api.js';

export class GenCalls {
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
