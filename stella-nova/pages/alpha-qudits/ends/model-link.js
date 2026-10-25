// ============================================================================
//  ALPHA QUDITS  ·  ends/model-link.js  ·  optional link to ../model/index.js
// ----------------------------------------------------------------------------
//  ENDS computes its own numbers in linalg.js. When the MODEL package is
//  present, the locks figure takes readCap from it, and ends/tests.mjs
//  checks that MODEL and linalg.js agree. While MODEL is absent, the import
//  fails quietly and the local numbers stand (the stub).
//
//  modelSync() -> the MODEL module, or null before it loads or without it
//  loadModel() -> Promise of the same
// ============================================================================
let M = null, p = null;
export function loadModel() {
  if (!p) p = import('../model/index.js').then(m => { M = m; return m; }, () => null);
  return p;
}
export function modelSync() { return M; }
if (typeof window !== 'undefined') loadModel();
