// ============================================================================
//  ALPHA FROM ENTANGLED QUDITS  ·  story/inline.js  (CORE, DOM-free)
// ----------------------------------------------------------------------------
//  m(key) gives the HTML of one inline math box. key is a key of INLINE in
//  ../equations.js, or raw TeX. main.js typesets the box (data-inline) with
//  ../../lib/sci-math.js. A separate file, so that the chapter modules do
//  not import story/index.js (an import cycle).
// ============================================================================
import { INLINE } from '../equations.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function m(key) {
  const tex = INLINE[key] ?? key;
  return `<span class="im" data-inline data-tex="${esc(tex)}"></span>`;
}
