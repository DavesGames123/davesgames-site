// ============================================================================
//  LENIA RENDER BUDGET  ·  pages/lenia/budget.js
// ----------------------------------------------------------------------------
//  One pure function that sets the canvas pixel ratio and the cell size at
//  which the render pass starts the bicubic sample (engine.js sampleAt).
//  main.js observeSize() calls it. tests.mjs tests it with node.
//
//  renderBudget({ dpr, cssW, cssH, saver, phone }) -> { dpr, cubicMin, px }
//    dpr       the canvas px per CSS px
//    cubicMin  the cell size in device px under which the shader takes the
//              bilinear path (2 x 2 reads, not 4 x 4)
//    px        the canvas size in device px (for the tests)
//
//  Desktop: the page draws at the device ratio up to 2. The saver also
//  draws at the device ratio up to 2, held to 8.3 M px (a 4K frame), because
//  each frame is copied into #saver-cv. The cubic starts at 3 device px.
//  Phone or tablet (a touch screen or the PHONE_Q layout): a 3x screen at
//  dpr 2 gives about 1.3 M px, and the cubic costs 16 reads per px. So the
//  saver draws at dpr 1.5 at most, held to 1.2 M px. The page keeps dpr 2
//  (held to 2 M px). On both, the cubic starts at 6 device px: a phone
//  cell at zoom 1 is about 5 px, where the cubic shows nothing more than
//  the bilinear sample.
// ============================================================================
export const BUDGET = {
  desk: { page: { dpr: 2, px: Infinity }, saver: { dpr: 2, px: 8.3e6 }, cubicMin: 3 },
  phone: { page: { dpr: 2, px: 2.0e6 }, saver: { dpr: 1.5, px: 1.2e6 }, cubicMin: 6 },
};

export function renderBudget({ dpr = 1, cssW = 1, cssH = 1, saver = false, phone = false } = {}) {
  const prof = phone ? BUDGET.phone : BUDGET.desk, cap = saver ? prof.saver : prof.page;
  const w = Math.max(1, cssW), h = Math.max(1, cssH);
  // The pixel cap never takes the ratio under 1: a canvas under 1 px per
  // CSS px is soft at every zoom.
  const r = Math.min(dpr || 1, cap.dpr, Math.max(1, Math.sqrt(cap.px / (w * h))));
  return { dpr: r, cubicMin: prof.cubicMin, px: Math.round(w * r) * Math.round(h * r) };
}
