// ============================================================================
//  CT EXPLAINED  ·  draw helpers  (ES module)
// ----------------------------------------------------------------------------
//  Small 2D canvas helpers that every scene uses: a palette, offscreen
//  image canvases coloured with the ct-lab colour maps, line plots, text
//  and glow dots. The module needs a canvas factory only. In a browser it
//  is document.createElement; tests.mjs gives a stub document.
//
//  GREP MAP
//    grep -n 'export const PAL'        page colours (match style.css)
//    grep -n 'export function makeCanvas'  offscreen canvas factory
//    grep -n 'export class Raster'     float array -> coloured canvas (map id or theme role)
//    grep -n 'export function applyLut'  float array -> RGBA through a LUT
//    grep -n 'export function plot'    line and area plots
//    grep -n 'export function label'   text in the sans or serif face
//    grep -n 'export function glow'    soft radial dot
//    grep -n 'export function panel'   rounded frame around an image
//    grep -n 'export function layout'  split a canvas into panels
// ============================================================================
import * as CM from '../ct-lab/colormaps/maps.js';
import * as TH from './theme.js';

export { CM, TH };
export const PAL = {
  bg: '#05070c', card: '#0b0e16', line: 'rgba(255,255,255,0.09)', line2: 'rgba(255,255,255,0.18)',
  ink: '#e8eaf0', ink2: '#b9c0cf', dim: '#7c849a', faint: '#2a3142',
  ray: '#62c4ff', rayA: 'rgba(98,196,255,', amber: '#ffb35c', amberA: 'rgba(255,179,92,',
  green: '#86dc7c', pink: '#e889dc', yellow: '#ffd666', violet: '#a8a4ff', red: '#ff5a5a',
};
export const SANS = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
export const SERIF = '"STIX Two Text", "Times New Roman", serif';
export const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smooth = (k) => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
export const lerp = (a, b, t) => a + (b - a) * t;

export function makeCanvas(w, h) {
  const d = globalThis.document;
  let c;
  if (d && d.createElement) c = d.createElement('canvas');
  else if (typeof OffscreenCanvas !== 'undefined') c = new OffscreenCanvas(w, h);
  else throw new Error('makeCanvas: no canvas');
  c.width = w; c.height = h;
  return c;
}

// A float image shown through a colour map. set() recolours; draw()
// scales it into a rectangle. transpose: column-major source (sinograms
// shown with the angle along x). cmap is a map id, or a theme role
// ('@image', '@data', '@hu', '@signed', see theme.js). For a role, set()
// keeps its arguments, and draw() colours the image again when the page
// theme changed since then. Keep the source array unchanged after set().
export class Raster {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.cv = makeCanvas(w, h);
    this.g = this.cv.getContext('2d');
    this.id = this.g.createImageData(w, h);
  }
  set(data, lo, hi, cmap = 'grey', o = {}) {
    let src = data;
    if (o.transpose) {
      // data is rows = angle (h source rows = this.w), cols = det (this.h)
      src = o.tbuf && o.tbuf.length === this.w * this.h ? o.tbuf : new Float32Array(this.w * this.h);
      const W = this.w, H = this.h;
      for (let a = 0; a < W; a++) for (let i = 0; i < H; i++) src[(H - 1 - i) * W + a] = data[a * H + i];
      if (o.rows != null) for (let a = o.rows; a < W; a++) for (let i = 0; i < H; i++) src[i * W + a] = NaN;
    } else if (o.rows != null) {
      src = Float32Array.from(data);
      src.fill(NaN, o.rows * this.w);
    }
    const nan = o.nan || [0, 0, 0, 0];
    if (TH.isRole(cmap)) {
      this.args = [data, lo, hi, cmap, o];
      this.ver = TH.version();
      this.mapId = TH.idFor(cmap);
      applyLut(TH.lutFor(cmap), src, lo, hi, this.id.data, nan, o.gamma ?? 1);
    } else {
      this.args = null;
      this.mapId = CM.get(cmap).id;
      CM.apply(cmap, src, lo, hi, this.id.data, { nan, gamma: o.gamma ?? 1, reverse: !!o.reverse });
    }
    this.g.putImageData(this.id, 0, 0);
    return this;
  }
  // Colour again when the theme changed after the last set() of a role.
  fresh() {
    if (this.args && this.ver !== TH.version()) this.set(...this.args);
    return this;
  }
  draw(g, x, y, w, h, smoothIt = true) {
    this.fresh();
    g.imageSmoothingEnabled = smoothIt;
    if (smoothIt && 'imageSmoothingQuality' in g) g.imageSmoothingQuality = 'high';
    g.drawImage(this.cv, x, y, w, h);
  }
}

// Float array -> RGBA through a 768-byte LUT. Same steps as CM.apply.
// gamma bends t before the lookup (a per-figure contrast, not the theme).
export function applyLut(lut, src, lo, hi, out, nan = [0, 0, 0, 0], gamma = 1) {
  const span = hi - lo, k = span !== 0 ? 1 / span : 0;
  for (let p = 0, q = 0; p < src.length; p++, q += 4) {
    const v = src[p];
    if (v !== v) { out[q] = nan[0]; out[q + 1] = nan[1]; out[q + 2] = nan[2]; out[q + 3] = nan[3]; continue; }
    let t = (v - lo) * k;
    t = t > 0 ? (t < 1 ? t : 1) : 0;
    if (gamma !== 1) t = Math.pow(t, gamma);
    const i = ((t * 255 + 0.5) | 0) * 3;
    out[q] = lut[i]; out[q + 1] = lut[i + 1]; out[q + 2] = lut[i + 2]; out[q + 3] = 255;
  }
  return out;
}

export function minmax(a) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < a.length; i++) { const v = a[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  return [lo, hi];
}

// Plot ys (with optional xs in 0..1) into rect r = {x, y, w, h}. lo/hi is
// the value range. fill: area under the curve to `base`.
export function plot(g, r, ys, o = {}) {
  const n = o.n ?? ys.length;
  if (n < 2) return;
  const lo = o.lo ?? 0, hi = o.hi ?? 1, span = hi - lo || 1;
  const X = (k) => r.x + (o.xs ? o.xs[k] : k / (n - 1)) * r.w;
  const Y = (v) => r.y + r.h - clamp((v - lo) / span, -0.05, 1.05) * r.h;
  g.beginPath();
  for (let k = 0; k < n; k++) { const v = ys[k]; if (k) g.lineTo(X(k), Y(v)); else g.moveTo(X(k), Y(v)); }
  if (o.fill) {
    const yb = Y(o.base ?? lo);
    g.lineTo(X(n - 1), yb); g.lineTo(X(0), yb); g.closePath();
    g.fillStyle = o.fill; g.fill();
    g.beginPath();
    for (let k = 0; k < n; k++) { const v = ys[k]; if (k) g.lineTo(X(k), Y(v)); else g.moveTo(X(k), Y(v)); }
  }
  g.strokeStyle = o.color || PAL.ray; g.lineWidth = o.lw || 1.5; g.lineJoin = 'round';
  if (o.dash) g.setLineDash(o.dash);
  g.stroke();
  if (o.dash) g.setLineDash([]);
}

export function label(g, s, x, y, o = {}) {
  g.font = `${o.weight || 400} ${o.size || 12}px ${o.font || SANS}`;
  g.fillStyle = o.color || PAL.ink2;
  g.textAlign = o.align || 'left';
  g.textBaseline = o.base || 'alphabetic';
  if (o.shadow) { g.shadowColor = 'rgba(0,0,0,0.85)'; g.shadowBlur = 6; }
  g.fillText(s, x, y);
  if (o.shadow) g.shadowBlur = 0;
}

export function glow(g, x, y, r, rgb = '98,196,255', a = 1) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, `rgba(255,255,255,${a})`);
  gr.addColorStop(0.18, `rgba(${rgb},${0.85 * a})`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}

export function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r);
  g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
  g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
  g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.closePath();
}

// A thin frame and a caption above a panel.
export function panel(g, r, title, o = {}) {
  g.strokeStyle = o.stroke || PAL.line; g.lineWidth = 1;
  rrect(g, r.x - 0.5, r.y - 0.5, r.w + 1, r.h + 1, 6); g.stroke();
  if (title) label(g, title, r.x + 2, r.y - 8, { size: o.size || 12, color: o.color || PAL.dim });
}

// Split w x h into k square-ish panels with captions. Wide canvases get a
// row; narrow ones a column (or a 2-up grid when k is 4). pad is the
// outer margin; top is room for captions.
export function layout(w, h, k, o = {}) {
  const pad = o.pad ?? 14, top = o.top ?? 22, gap = o.gap ?? 16;
  const row = o.row ?? (w / h > 1.25 * k * 0.6);
  const out = [];
  if (row) {
    const cw = (w - 2 * pad - gap * (k - 1)) / k, ch = h - pad - top;
    const s = Math.min(cw, ch);
    const x0 = (w - (k * s + (k - 1) * gap)) / 2, y0 = top + (ch - s) / 2;
    for (let i = 0; i < k; i++) out.push({ x: x0 + i * (s + gap), y: y0, w: s, h: s });
  } else {
    const rows = k, ch = (h - pad - rows * top - gap * (rows - 1)) / rows, cw = w - 2 * pad;
    const s = Math.min(cw, ch);
    for (let i = 0; i < k; i++) out.push({ x: (w - s) / 2, y: top + i * (s + top + gap), w: s, h: s });
  }
  return out;
}

// World (y up) -> panel pixels for an image of world width W in rect r.
export function worldMap(r, W) {
  const k = r.w / W;
  return { k, X: (x) => r.x + r.w / 2 + x * k, Y: (y) => r.y + r.h / 2 - y * k };
}
