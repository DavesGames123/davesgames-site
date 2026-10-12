// ============================================================================
//  FLY DUEL  ·  scorecard neural panel, 2D raster  (ES module, DOM optional)
// ----------------------------------------------------------------------------
//  A small, live picture of one fly's mushroom body for its scorecard. It
//  is the stand-in when ui/fly3d/brain3d.js gives no createBrainCard. All
//  of it comes from the decision trace of brain/agent.js buildTrace():
//      trace.kc        indices of the active Kenyon cells (KCs)
//      trace.kcRate    their graded rates (optional)
//      trace.mbon      MBON output rates (one per MBON)
//      trace.valence   +1 approach, -1 avoid, 0 other (per MBON)
//      trace.danCompartment   DAN signal per compartment (the TD error
//                      split to PAM, reward, and PPL1, punishment)
//      trace.delta     the TD error, trace.value the MB value
//
//  The panel has three parts, left to right:
//      KC raster  time runs to the right (one column per decision, the
//                 newest at the right edge). One row is a bin of KCs in
//                 index order. The cell brightness is the share of the bin
//                 that is active. About 5 to 10% of KCs fire (APL
//                 inhibition), so most cells stay dark: that is the
//                 sparse code, not a fault.
//      MBON bars  one bar per MBON of the newest decision, green for an
//                 approach MBON, red for an avoid MBON, grey for others.
//      DAN strip  one cell per compartment under the bars: green for a
//                 PAM burst (delta > 0), red for PPL1 (delta < 0).
//  Hard edges only: fillRect on whole pixels, no blur, no glow.
//
//  GREP MAP
//      grep -n 'export function kcBins'       trace -> bin shares
//      grep -n 'export function mbonBars'     trace -> bar rows
//      grep -n 'export function danCells'     trace -> compartment cells
//      grep -n 'export function createRasterModel'  history of columns
//      grep -n 'export function drawRaster'   the canvas painter
//      grep -n 'export function createRaster' canvas + model, for the DOM
// ============================================================================
import { TOKENS, rgb } from '../tokens.js';

// Share of active KCs per bin. rows bins over nKC cells in index order.
export function kcBins(trace, nKC, rows) {
  const out = new Float32Array(rows);
  if (!trace || !trace.kc || !nKC) return out;
  const per = nKC / rows;
  const rate = trace.kcRate;
  let rmax = 0;
  if (rate) for (let i = 0; i < rate.length; i++) rmax = Math.max(rmax, rate[i]);
  for (let j = 0; j < trace.kc.length; j++) {
    const r = Math.min(rows - 1, Math.floor(trace.kc[j] / per));
    out[r] += rate && rmax > 0 ? rate[j] / rmax : 1;
  }
  for (let r = 0; r < rows; r++) out[r] = Math.min(1, out[r] / Math.max(1, per) * 6);   // x6: a bin at ~17% reads full
  return out;
}

// MBON bars of one trace: [{ v (0..1), valence }]. v is the rate over the
// largest rate of this trace.
export function mbonBars(trace) {
  if (!trace || !trace.mbon) return [];
  const m = trace.mbon;
  let max = 0;
  for (let i = 0; i < m.length; i++) max = Math.max(max, Math.abs(m[i]));
  const val = trace.valence || [];
  const out = [];
  for (let i = 0; i < m.length; i++) out.push({ v: max > 0 ? Math.abs(m[i]) / max : 0, valence: Math.sign(val[i] || 0) });
  return out;
}

// DAN cells: [{ v (0..1), sign }] per compartment.
export function danCells(trace) {
  const d = trace && trace.danCompartment;
  if (!d) return [];
  let max = 0;
  for (let i = 0; i < d.length; i++) max = Math.max(max, Math.abs(d[i]));
  const out = [];
  for (let i = 0; i < d.length; i++) out.push({ v: max > 0 ? Math.abs(d[i]) / max : 0, sign: Math.sign(d[i]) });
  return out;
}

// The rolling history of KC columns. cols: how many decisions to keep.
export function createRasterModel({ nKC = 2000, rows = 32, cols = 40 } = {}) {
  const hist = [];
  let last = null;
  return {
    rows, cols, nKC,
    push(trace) {
      if (!trace) return;
      const n = trace.kcLive || nKC;
      hist.push(kcBins(trace, Math.max(n, nKC), rows));
      if (hist.length > cols) hist.shift();
      last = trace;
    },
    clear() { hist.length = 0; last = null; },
    get columns() { return hist; },
    get last() { return last; },
  };
}

const mix = (a, b, t) => {
  const A = rgb(a), B = rgb(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
};
// Five steps from silent to active: fewer fill styles, crisp steps.
const KC_STEPS = [0, 0.25, 0.5, 0.75, 1].map(t => mix(TOKENS['kc-off'], TOKENS['kc-on'], t));

// Paint the raster on a 2D context. w, h in device pixels.
// accent: the fly colour for the frame line of the newest column.
export function drawRaster(g, model, { w, h, accent = TOKENS.flyA } = {}) {
  w = Math.max(8, Math.floor(w)); h = Math.max(8, Math.floor(h));
  g.fillStyle = TOKENS.fig;
  g.fillRect(0, 0, w, h);
  const barsW = Math.max(24, Math.floor(w * 0.3));
  const gap = Math.max(2, Math.round(w / 120));
  const rasterW = w - barsW - gap;
  const cols = model.cols, rows = model.rows;
  const cw = Math.max(1, Math.floor(rasterW / cols));
  const ch = Math.max(1, Math.floor(h / rows));
  const x0 = rasterW - cw * cols;
  const y0 = Math.floor((h - ch * rows) / 2);
  const hist = model.columns;
  // silent ground
  g.fillStyle = KC_STEPS[0];
  g.fillRect(x0, y0, cw * cols, ch * rows);
  const off = cols - hist.length;
  for (let c = 0; c < hist.length; c++) {
    const col = hist[c];
    const x = x0 + (off + c) * cw;
    for (let r = 0; r < rows; r++) {
      const s = col[r];
      if (s <= 0.02) continue;
      g.fillStyle = KC_STEPS[Math.min(4, 1 + Math.floor(s * 3.999))];
      g.fillRect(x, y0 + r * ch, Math.max(1, cw - (cw > 2 ? 1 : 0)), Math.max(1, ch - (ch > 2 ? 1 : 0)));
    }
  }
  // the newest column: a 1 px fly-colour line on its left edge
  if (hist.length) {
    g.fillStyle = accent;
    g.fillRect(x0 + (cols - 1) * cw - 1, y0, 1, ch * rows);
  }
  // MBON bars
  const t = model.last;
  const bars = mbonBars(t);
  const dan = danCells(t);
  const bx = rasterW + gap;
  const danH = dan.length ? Math.max(3, Math.floor(h * 0.14)) : 0;
  const bh = h - danH - (danH ? 2 : 0);
  if (bars.length) {
    const bw = Math.max(1, Math.floor(barsW / bars.length));
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const hh = Math.max(1, Math.round(b.v * bh));
      g.fillStyle = b.valence > 0 ? TOKENS.app : b.valence < 0 ? TOKENS.avoid : TOKENS.dim;
      g.fillRect(bx + i * bw, bh - hh, Math.max(1, bw - (bw > 2 ? 1 : 0)), hh);
    }
  } else {
    g.fillStyle = TOKENS.faint;
    g.fillRect(bx, bh - 1, barsW, 1);
  }
  // DAN strip
  if (danH) {
    const dw = Math.max(1, Math.floor(barsW / dan.length));
    for (let i = 0; i < dan.length; i++) {
      const d = dan[i];
      g.fillStyle = d.v < 0.05 ? TOKENS['kc-off'] : d.sign > 0 ? TOKENS.app : TOKENS.avoid;
      g.fillRect(bx + i * dw, h - danH, Math.max(1, dw - (dw > 2 ? 1 : 0)), danH);
    }
  }
}

// A canvas with its model, for the DOM. opts: { nKC, rows, cols, accent }.
export function createRaster(canvas, opts = {}) {
  const model = createRasterModel(opts);
  const dpr = () => Math.min(2, (globalThis.devicePixelRatio || 1));
  function draw() {
    if (!canvas.getContext) return;
    const r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: canvas.width, height: canvas.height };
    const k = dpr();
    const W = Math.max(8, Math.round(r.width * k)), H = Math.max(8, Math.round(r.height * k));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.imageSmoothingEnabled = false;
    drawRaster(g, model, { w: W, h: H, accent: opts.accent });
  }
  return {
    model,
    fire(trace) { model.push(trace); draw(); },
    redraw: draw,
    resize: draw,
    clear() { model.clear(); draw(); },
    dispose() { model.clear(); },
  };
}
