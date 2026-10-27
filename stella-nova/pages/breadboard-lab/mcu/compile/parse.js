// ============================================================================
//  BREADBOARD LAB  ·  mcu/compile/parse.js — tokens -> AST (decls, statements, expressions)
// ----------------------------------------------------------------------------
//  new Parser(toks, ctx).program() -> the list of top-level decls. ctx gives
//  resolveType (types.js typeResolver), libTypes and the enum names.
//
//  grep -n targets
//    TYPEWORDS / QUALS .... the words that start a type
//    NOT_SUPPORTED ........ the stated messages for C++ features
//    BINPREC / ASSIGN ..... the binary operators
//    typeSpec ............. qualifiers + type words
//    program .............. top-level decls
//    funcDecl / varRest ... functions and variables
//    stmt ................. statements
//    binExpr .............. expressions by precedence
//    postfix / primary .... calls, indexes, members, literals
// ============================================================================
import { CErr } from './errors.js';

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
export const BINPREC = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);

export class Parser {
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
