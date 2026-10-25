// ============================================================================
//  STRANDS · model-link.js — MODEL when it is there, a small stub until then
// ----------------------------------------------------------------------------
//  CONTRACT.md: STRANDS imports MODEL from ../model/index.js and uses a
//  local stub until that package lands. loadModel() tries the import once
//  and caches the result. The stub derives what the drawings need from the
//  slot construction (Sec. S7): the end dimensions give the letter counts
//  d² − 1 and the readout dimension N = (3²−1)(2²−1) · (3·2)² · (3·2)².
//  The stub has no record list, so the object scene shows the record count
//  only when MODEL is loaded (MODEL.buildRecords().length).
//
//  EXPORTS   (jump with grep -n "<anchor>" model-link.js)
//    STUB ......... "export const STUB"
//    loadModel .... "export function loadModel"   Promise<{ model, real }>
//    facts ........ "export function facts"       { slots, N, records|null, real }
// ============================================================================

const letters = d => d * d - 1;

export const STUB = {
  slots() {
    return [
      { id: 'Q1', d: 3, letters: letters(3) },
      { id: 'q1', d: 2, letters: letters(2) },
      { id: 'Q2', d: 3, letters: letters(3) },
      { id: 'q2', d: 2, letters: letters(2) },
    ];
  },
  // The object's readout dimension, Eq. (4): traceless part of the unread
  // link times the whole operator space at each read link.
  readoutDimension() { return letters(3) * letters(2) * (3 * 2) ** 2 * (3 * 2) ** 2; },
};

let pending = null;

export function loadModel(url = new URL('../model/index.js', import.meta.url).href) {
  if (pending) return pending;
  pending = import(url).then(
    m => (m && typeof m.slots === 'function' ? { model: m, real: true } : { model: STUB, real: false }),
    () => ({ model: STUB, real: false }),
  );
  return pending;
}

export function facts(link) {
  const m = (link && link.model) || STUB;
  const slots = m.slots();
  let N = null;
  try { N = typeof m.readoutDimension === 'function' ? m.readoutDimension() : null; } catch (e) { N = null; }
  if (typeof N !== 'number' || !(N > 0)) N = STUB.readoutDimension();
  let records = null;
  if (link && link.real && typeof m.buildRecords === 'function') {
    try { records = m.buildRecords().length; } catch (e) { records = null; }
  }
  return { slots, N, records, real: !!(link && link.real) };
}
