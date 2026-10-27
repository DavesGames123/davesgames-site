// ============================================================================
//  BREADBOARD LAB  ·  mcu/compile/gen-decls.js — top-level declarations -> JS
// ----------------------------------------------------------------------------
//  program() writes the factory body: globals, __init, the user functions as
//  generators, then setup/loop/init.
//
//  grep -n targets
//    program .............. the factory body
//    paramType ............ a parameter type
//    enumItems ............ enum values
//    globalVar ............ a global variable
//    arrayType / arrInit .. array sizes and { } lists
//    varInit .............. the JS that creates a variable
//    funcBody ............. one user function
// ============================================================================
import { isNum, isText, tName, litWrap } from './types.js';
import { BUILTINS } from './api.js';

export class GenDecls {
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
}
