// ============================================================================
//  TENSOR CALCULUS  ·  learn/stub.js  ·  a recording tensorPage  (LEARN)
// ----------------------------------------------------------------------------
//  DOM-free. createStubPage() gives an object with every method of
//  ui/page-api.js METHODS. Each call goes into page.calls as
//  [method, ...args] and resolves at once. tests/learn.test.mjs uses it,
//  and so can a page that has no CORE yet.
//
//  EXPORTS
//      STUB_METHODS ..... the method names (the same list as CORE METHODS)
//      createStubPage() . { calls, ...methods }
// ============================================================================
export const STUB_METHODS = Object.freeze(['openEntry', 'playTrace', 'setView', 'setScene', 'pickIndex', 'showExpr', 'seek', 'pause', 'resume', 'state', 'on']);

export function createStubPage() {
  const calls = [];
  const page = { calls, __stub: true };
  for (const m of STUB_METHODS) {
    page[m] = (...args) => {
      calls.push([m, ...args]);
      if (m === 'state') return Promise.resolve({ ready: true, stub: true });
      if (m === 'on') return () => {};
      return Promise.resolve(true);
    };
  }
  return page;
}
