// ============================================================================
//  BREADBOARD LAB  ·  mcu/compile/gen.js — the code generator, assembled
// ----------------------------------------------------------------------------
//  Gen (gen-core.js) gets the methods of the four part classes. A method
//  name that two parts define is an error at load time, not a silent
//  override.
//
//  grep -n targets
//    PARTS ................ the part classes
//    Gen .................. the export
// ============================================================================
import { Gen } from './gen-core.js';
import { GenDecls } from './gen-decls.js';
import { GenStmts } from './gen-stmts.js';
import { GenExprs } from './gen-exprs.js';
import { GenCalls } from './gen-calls.js';

const PARTS = [GenDecls, GenStmts, GenExprs, GenCalls];
for (const P of PARTS) {
  for (const name of Object.getOwnPropertyNames(P.prototype)) {
    if (name === 'constructor') continue;
    if (Object.prototype.hasOwnProperty.call(Gen.prototype, name)) throw new Error(`mcu/compile/gen.js: two parts define Gen.${name}`);
    Object.defineProperty(Gen.prototype, name, Object.getOwnPropertyDescriptor(P.prototype, name));
  }
}

export { Gen };
