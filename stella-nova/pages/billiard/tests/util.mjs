// ============================================================================
//  POOL PHYSICS  ·  tests/util.mjs — the small test kit of the page
// ----------------------------------------------------------------------------
//  ok(cond, name, info) prints PASS or FAIL with the measured numbers;
//  done() prints the count line that tests.mjs reads and sets the exit code.
// ============================================================================
let pass = 0, fail = 0;
export function ok(c, name, info = '') {
  if (c) pass++; else fail++;
  console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`);
  return !!c;
}
export function done() {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
export const D = 180 / Math.PI;
