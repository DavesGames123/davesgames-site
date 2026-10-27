// ============================================================================
//  BREADBOARD LAB  ·  mcu/compile/errors.js — the compile error type
// ----------------------------------------------------------------------------
//  Every stage (lex, preprocess, parse, gen) throws a CErr. compileSketch
//  (mcu/compile.js) turns it into { line, col, msg } in the errors list.
//
//  grep -n targets
//    CErr ................. a compile error with a line and a column
// ============================================================================
export class CErr extends Error {
  constructor(msg, tok) { super(msg); this.line = tok ? tok.line : 0; this.col = tok ? tok.col : 0; }
}
