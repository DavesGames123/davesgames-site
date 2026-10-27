// ============================================================================
//  BREADBOARD LAB  ·  mcu/compile/gen-stmts.js — statements -> JS
// ----------------------------------------------------------------------------
//  Each loop back-edge yields a tick (code 0), so a busy loop costs
//  simulated time and cannot hang the page.
//
//  grep -n targets
//    blockBody / scoped ... blocks and scopes
//    cond ................. a condition
//    stmt ................. one statement
//    localVar ............. local and static variables
// ============================================================================
import { isInt, isArr, tName } from './types.js';

export class GenStmts {
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
}
