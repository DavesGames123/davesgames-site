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
//  GREP MAP  (each stage is a module in mcu/compile/)
//    compile/errors.js ..... CErr, a compile error with a line and a column
//    compile/lex.js ........ source text -> tokens (line, col, logical line)
//    compile/preprocess.js . #define (object and function), #if family,
//                            #include check, macro expansion
//    compile/parse.js ...... Parser: tokens -> AST (decls, statements, expressions)
//    compile/types.js ...... ranges, wrap, tName, typeResolver
//    compile/api.js ........ BUILTINS, SERIAL_M / LCD_M / SERVO_M / STRING_M, MATH
//    compile/gen*.js ....... Gen: AST -> JS (core, decls, stmts, exprs, calls)
//    compileSketch ......... the export (this file): runs the stages in order
// ============================================================================
import { BOARDS } from './boards.js';
import { CErr } from './compile/errors.js';
import { lex } from './compile/lex.js';
import { preprocess } from './compile/preprocess.js';
import { Parser } from './compile/parse.js';
import { typeResolver } from './compile/types.js';
import { Gen } from './compile/gen.js';

// the names that this file exported before the split
export { CErr, lex };
export { LIBS } from './compile/preprocess.js';
export { isInt, isFloat, isNum } from './compile/types.js';
export { BUILTINS } from './compile/api.js';

// ── the export ──────────────────────────────────────────────────────────────
export function compileSketch(source, { board = 'uno328' } = {}) {
  const errors = [], warnings = [];
  if (!BOARDS[board]) return { ok: false, errors: [{ line: 0, col: 0, msg: `unknown board '${board}'` }], warnings, info: null };
  if (typeof source !== 'string') return { ok: false, errors: [{ line: 0, col: 0, msg: 'the sketch has no source text' }], warnings, info: null };
  try {
    const toks = lex(source);
    const { toks: pp, libs } = preprocess(toks, board, warnings);
    // the parser knows the library classes that #include made available
    const libTypes = new Set(['LiquidCrystal', 'Servo'].filter(l => libs.has(l)));
    const decls = new Parser(pp, { libTypes, enums: new Set(), resolveType: typeResolver(BOARDS[board]) }).program();
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
