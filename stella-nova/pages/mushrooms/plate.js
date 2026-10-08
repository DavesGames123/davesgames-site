// ============================================================================
//  MUSHROOM DRAW  ·  plate.js — paper themes, page sizes, the plate layout
// ----------------------------------------------------------------------------
//  Original code (davesgames.io). No DOM. render.js draws a layout on a
//  canvas, svg.js writes it as SVG, and tests.mjs checks it.
//
//  UNITS. A plate is in millimetres. The page 'screen' is the view itself:
//  main.js gives its size in CSS px times MM_PER_PX (1 CSS px = 1/96 in).
//
//  LAYOUT. layoutPlate() returns { w, h, rules, texts, cells, content }:
//    rules   [{ x, y, w, h, lw }]    the border rectangles
//    texts   [{ x, y, text, size, style, align, role }]   baselines in mm
//    cells   [{ i, x, y, w, h, ax, ay, aw, ah, lx, ly, ls }]
//            x..h the cell; ax..ah the art box (the cell less its label);
//            lx, ly the label baseline; ls the label size (mm)
//  fitSpec(spec, cell) puts the bbox of a specimen (engine units) in the
//  art box: { k (mm per unit), ox, oy (mm) }.
//
//  GREP MAP
//    grep -n 'export const THEMES'       paper, ink, text, rule colours
//    grep -n 'export const STYLES'       pen, ink brush, colour wash
//    grep -n 'export const PAGES'        paper sizes in mm
//    grep -n 'export function layoutPlate' the layout
//    grep -n 'export function fitSpec'   a specimen in its cell
//    grep -n 'export function scaleBar'  a round length for the scale bar
//    grep -n 'export const CREDIT_LINE'  the credit on every plate
// ============================================================================
import { UNIT_MM } from './engine.js';

export const MM_PER_PX = 25.4 / 96;
export const CREDIT_LINE = 'Mushroom Draw, davesgames.io · after fishdraw and shan-shui-inf by Lingdong Huang';
export function withCredit(L) {
  if (L.texts.some(t => t.role === 'foot')) return L;
  const size = Math.min(5, Math.max(1.2, Math.min(L.w, L.h) * 0.011));
  return Object.assign({}, L, { texts: L.texts.concat([{ x: L.w - size * 1.4, y: L.h - size * 0.9, text: CREDIT_LINE, size, style: 'italic', align: 'right', role: 'foot' }]) });
}

export const THEMES = {
  cream:     { label: 'Specimen cream', paper: '#f2e9d4', ink: '#2a2118', text: '#3b2e20', rule: '#3b2e20', grain: 0.55, vignette: 0.16 },
  white:     { label: 'White', paper: '#ffffff', ink: '#111111', text: '#222222', rule: '#222222', grain: 0, vignette: 0 },
  rice:      { label: 'Rice paper', paper: '#ebe4d6', ink: '#161514', text: '#2c2a27', rule: '#2c2a27', grain: 0.75, vignette: 0.1 },
  sepia:     { label: 'Old sepia', paper: '#e7d6b0', ink: '#4a2c17', text: '#4a2c17', rule: '#5a3a20', grain: 0.8, vignette: 0.32 },
  moss:      { label: 'Moss green', paper: '#dfe5d3', ink: '#1f3324', text: '#24382a', rule: '#2f4a36', grain: 0.45, vignette: 0.12 },
  blueprint: { label: 'Blueprint', paper: '#1d4b86', ink: '#eef5ff', text: '#dce9ff', rule: '#cfe0ff', grain: 0.25, vignette: 0.2, grid: 'rgba(206,224,255,0.16)' },
  gold:      { label: 'Black and gold', paper: '#0f0e0c', ink: '#d9b765', text: '#cfae5e', rule: '#b8964a', grain: 0.3, vignette: 0.25 },
  night:     { label: 'Night', paper: '#10161f', ink: '#cfe2ff', text: '#a9bfdc', rule: '#7f97b8', grain: 0.2, vignette: 0.2 },
  spore:     { label: 'Spore print', paper: '#2a211b', ink: '#efe6d6', text: '#e2d6c2', rule: '#bfae94', grain: 0.4, vignette: 0.3 },
};
export const THEME_KEYS = Object.keys(THEMES);
export function isDark(t) {
  const lum = h => { const n = parseInt(h.slice(1), 16); return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11; };
  return lum(t.paper) < lum(t.ink);
}

// pen: plain lines; brush: tapered ink strokes and a pale ink wash;
// wash: plain lines over watercolour washes.
export const STYLES = {
  pen: { label: 'Pen' },
  brush: { label: 'Ink brush' },
  wash: { label: 'Colour wash' },
};
export const STYLE_KEYS = Object.keys(STYLES);

export const PAGES = {
  screen: { label: 'Fit the view' },
  a4:     { label: 'A4', w: 210, h: 297 },
  a3:     { label: 'A3', w: 297, h: 420 },
  letter: { label: 'US Letter', w: 215.9, h: 279.4 },
  square: { label: 'Square 30 cm', w: 300, h: 300 },
  phone:  { label: 'Phone wallpaper', w: 1170 * MM_PER_PX, h: 2532 * MM_PER_PX },
};
export const GRID_PRESETS = [
  { id: '2x2', rows: 2, cols: 2 },
  { id: '2x3', rows: 2, cols: 3 },
  { id: '3x3', rows: 3, cols: 3 },
  { id: '3x4', rows: 3, cols: 4 },
  { id: 'plate', label: 'Specimen plate', rows: 4, cols: 3, page: 'a3', orient: 'portrait', plate: true },
  { id: 'wall', label: 'Phone wallpaper', rows: 4, cols: 2, page: 'phone', orient: 'portrait', plate: false },
];
export function pageSize(key, orient, view) {
  const p = PAGES[key] || PAGES.screen;
  if (!p.w) return { w: view.w, h: view.h };
  return orient === 'landscape' ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
}
export function roman(n) {
  const t = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = ''; n = Math.max(1, Math.floor(n));
  for (const [v, r] of t) while (n >= v) { s += r; n -= v; }
  return s;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ── layoutPlate ─────────────────────────────────────────────────────────────
// o = { w, h, rows, cols, border, title, labels, titleText, subText,
//       plateNo, foot, footRight, screen, fig, names: [..] }
export function layoutPlate(o) {
  const W = o.w, H = o.h, rows = Math.max(1, o.rows | 0), cols = Math.max(1, o.cols | 0);
  const S = Math.min(W, H);
  const out = { w: W, h: H, rules: [], texts: [], cells: [], content: null };
  const m = S * (o.screen ? 0.035 : 0.06);
  let x0 = m, y0 = m, x1 = W - m, y1 = H - m;
  if (o.border) {
    const lw0 = clamp(S * 0.0026, 0.3, 1.2), lw1 = lw0 * 0.4, gap = clamp(S * 0.008, 0.8, 3.5);
    out.rules.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, lw: lw0 });
    out.rules.push({ x: x0 + gap, y: y0 + gap, w: x1 - x0 - 2 * gap, h: y1 - y0 - 2 * gap, lw: lw1 });
    const pad = gap + S * 0.022;
    x0 += pad; y0 += pad; x1 -= pad; y1 -= pad;
  }
  if (o.title) {
    const tSize = clamp(S * 0.042, 3, 30), nSize = tSize * 0.42, sSize = tSize * 0.5, cx = W / 2;
    let y = y0 + nSize;
    out.texts.push({ x: cx, y, text: 'Plate ' + roman(o.plateNo || 1) + '.', size: nSize, style: 'normal', align: 'center', role: 'plate' });
    y += tSize * 1.12;
    out.texts.push({ x: cx, y, text: o.titleText || 'Fungi fictae', size: tSize, style: 'normal', align: 'center', role: 'title' });
    if (o.subText) { y += sSize * 1.55; out.texts.push({ x: cx, y, text: o.subText, size: sSize, style: 'italic', align: 'center', role: 'sub' }); }
    y0 = y + tSize * 0.7;
    const fSize = clamp(S * 0.012, 1.4, 7);
    out.texts.push({ x: x0, y: y1, text: o.foot || CREDIT_LINE, size: fSize, style: 'italic', align: 'left', role: 'foot' });
    if (o.footRight) out.texts.push({ x: x1, y: y1, text: o.footRight, size: fSize, style: 'italic', align: 'right', role: 'foot' });
    y1 -= fSize * 2.2;
  }
  const C = { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  out.content = C;
  const g = Math.min(C.w, C.h) * (rows * cols > 1 ? 0.03 : 0);
  const cw = (C.w - g * (cols - 1)) / cols, chh = (C.h - g * (rows - 1)) / rows;
  const ls = o.labels ? clamp(Math.min(chh * 0.07, cw * 0.05), 1.3, S * 0.03) : 0;
  const lh = o.labels ? ls * 2.2 : 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, x = C.x + c * (cw + g), y = C.y + r * (chh + g);
    const ah = Math.max(1, chh - lh);
    const cell = { i, r, c, x, y, w: cw, h: chh, ax: x, ay: y, aw: cw, ah, lx: x + cw / 2, ly: y + ah + ls * 1.4, ls };
    out.cells.push(cell);
    if (o.labels) out.texts.push({ x: cell.lx, y: cell.ly, text: (o.fig ? 'Fig. ' : '') + (i + 1) + '.', size: ls, style: 'normal', align: 'num', role: 'num', cell: i, name: (o.names && o.names[i]) || '' });
  }
  return out;
}
export function cellAt(L, x, y) {
  for (const c of L.cells) if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return c.i;
  return -1;
}

// ── fitSpec ─────────────────────────────────────────────────────────────────
// fill: the share of the art box the bbox may take.
export function fitSpec(f, c, fill = 0.92) {
  const b = f.bbox, bw = Math.max(1, b.w), bh = Math.max(1, b.h);
  const k = Math.min(c.aw / bw, c.ah / bh) * fill;
  return { k, ox: c.ax + c.aw / 2 - (b.x + bw / 2) * k, oy: c.ay + c.ah / 2 - (b.y + bh / 2) * k };
}
// A round length in mm of real mushroom (1, 2, 5, 10, 20, 50, 100) whose
// plate length is near `target` mm, for k mm of plate per engine unit.
export function scaleBar(k, target) {
  const opts = [1, 2, 5, 10, 20, 50, 100, 200];
  let best = opts[0];
  for (const mm of opts) if (Math.abs(mm / UNIT_MM * k - target) < Math.abs(best / UNIT_MM * k - target)) best = mm;
  return { mm: best, len: best / UNIT_MM * k, text: best >= 10 ? (best / 10) + ' cm' : best + ' mm' };
}

// ── pngSize ─────────────────────────────────────────────────────────────────
// Safari refuses a canvas of more than 16 777 216 px (4096 x 4096). The DPI
// steps down until the plate fits. { w, h, dpi, clamped } in px.
const MAX_AREA = 16777216, MAX_SIDE = 16384;
export function pngSize(L, dpi) {
  let d = dpi;
  const px = v => Math.round(v / 25.4 * d);
  while (d > 24 && (px(L.w) * px(L.h) > MAX_AREA || px(L.w) > MAX_SIDE || px(L.h) > MAX_SIDE)) d = Math.floor(d * 0.9);
  return { w: px(L.w), h: px(L.h), dpi: d, clamped: d !== dpi };
}

// ── specExtras ──────────────────────────────────────────────────────────────
// Where the scale bar and a single figure label go: just under the drawn
// specimen, not at the base of a tall cell. Returns plate mm.
export function specExtras(f, c, fit) {
  const b = f.bbox, x0 = fit.ox + b.x * fit.k, bottom = fit.oy + (b.y + b.h) * fit.k;
  const fs = Math.max(1.6, Math.min(c.aw, c.ah) * 0.03);
  return { barX: Math.max(c.ax + c.aw * 0.03, x0), barY: Math.min(c.ay + c.ah - c.ah * 0.02, bottom + fs * 1.2), fs,
    labelY: Math.min(c.ly, bottom + fs * 1.2 + c.ls * 2.2) };
}
