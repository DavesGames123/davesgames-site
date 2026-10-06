// ============================================================================
//  FISHDRAW  ·  plate.js — paper themes, page sizes and the plate layout
// ----------------------------------------------------------------------------
//  Our own code around fishdraw by Lingdong Huang (MIT, LICENSE-fishdraw.txt).
//  No DOM. render.js draws a layout on a canvas, export.js writes it as SVG,
//  and tests.mjs checks it.
//
//  UNITS. A plate is in millimetres. A paper size is a real size. The page
//  'screen' is the view itself: main.js gives its size in CSS px times
//  MM_PER_PX, so 1 CSS px is 1/96 inch, as in CSS.
//
//  FISH BOX. reframe() in fishdraw.js puts each fish in a 500 x 300 unit
//  box (20 units of pad, the Hershey name at the base). A cell keeps that
//  5:3 box and scales it: fish unit to mm is cell.k.
//
//  LAYOUT. layoutPlate() returns { w, h, rules, texts, cells, content }:
//    rules   [{ x, y, w, h, lw }]    the border rectangles (outer, inner)
//    texts   [{ x, y, text, size, style, align, role }]   baselines in mm
//    cells   [{ i, x, y, w, h, fx, fy, fw, fh, k, lx, ly, ls }]
//            x..h the cell; fx..fh the 5:3 fish box; k = fw / 500;
//            lx, ly the label baseline; ls the label size (mm)
//    content { x, y, w, h }          the area the cells share
//
//  GREP MAP
//    grep -n 'export const THEMES'      paper, ink, label and rule colors
//    grep -n 'export const PAGES'       paper sizes in mm
//    grep -n 'export const GRID_PRESETS' the grid buttons
//    grep -n 'export function pageSize' a page key and orientation to mm
//    grep -n 'export function layoutPlate' the layout
//    grep -n 'export function roman'    plate numbers
// ============================================================================

export const MM_PER_PX = 25.4 / 96;
export const FISH_W = 500, FISH_H = 300;

// paper: the sheet; ink: the fish; label: type; rule: the border.
// grain 0..1: paper fibre strength; vignette 0..1; grid: a blueprint grid.
export const THEMES = {
  cream:     { label: 'Specimen cream', paper: '#f2e9d4', ink: '#2a2118', text: '#3b2e20', rule: '#3b2e20', grain: 0.55, vignette: 0.16 },
  white:     { label: 'White', paper: '#ffffff', ink: '#111111', text: '#222222', rule: '#222222', grain: 0, vignette: 0 },
  floral:    { label: 'Upstream', paper: '#fffaf0', ink: '#000000', text: '#000000', rule: '#000000', grain: 0, vignette: 0 },
  sepia:     { label: 'Old sepia', paper: '#e7d6b0', ink: '#4a2c17', text: '#4a2c17', rule: '#5a3a20', grain: 0.8, vignette: 0.32 },
  rice:      { label: 'Rice paper', paper: '#ebe6dc', ink: '#161514', text: '#2c2a27', rule: '#2c2a27', grain: 0.7, vignette: 0.08 },
  blueprint: { label: 'Blueprint', paper: '#1d4b86', ink: '#eef5ff', text: '#dce9ff', rule: '#cfe0ff', grain: 0.25, vignette: 0.2, grid: 'rgba(206,224,255,0.16)' },
  gold:      { label: 'Black and gold', paper: '#0f0e0c', ink: '#d9b765', text: '#cfae5e', rule: '#b8964a', grain: 0.3, vignette: 0.25 },
  night:     { label: 'Night', paper: '#10161f', ink: '#cfe2ff', text: '#a9bfdc', rule: '#7f97b8', grain: 0.2, vignette: 0.2 },
  verdigris: { label: 'Verdigris', paper: '#dfe7df', ink: '#1f4a45', text: '#24413c', rule: '#2f5a54', grain: 0.45, vignette: 0.12 },
};
export const THEME_KEYS = Object.keys(THEMES);
// A theme is dark when its paper is darker than its ink.
export function isDark(t) {
  const lum = h => { const n = parseInt(h.slice(1), 16); return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11; };
  return lum(t.paper) < lum(t.ink);
}

// Sizes in mm, portrait. 'screen' has no size: the view sets it.
export const PAGES = {
  screen: { label: 'Fit the view' },
  a4:     { label: 'A4', w: 210, h: 297 },
  a3:     { label: 'A3', w: 297, h: 420 },
  letter: { label: 'US Letter', w: 215.9, h: 279.4 },
  square: { label: 'Square 30 cm', w: 300, h: 300 },
  phone:  { label: 'Phone wallpaper', w: 1170 * MM_PER_PX, h: 2532 * MM_PER_PX },
};

// rows x cols; plate: true turns on the border and the title block.
export const GRID_PRESETS = [
  { id: '2x2', rows: 2, cols: 2 },
  { id: '3x3', rows: 3, cols: 3 },
  { id: '3x4', rows: 3, cols: 4 },
  { id: '4x6', rows: 4, cols: 6 },
  { id: '5x8', rows: 5, cols: 8 },
  { id: 'plate', label: 'Specimen plate', rows: 5, cols: 3, page: 'a3', orient: 'portrait', plate: true },
  { id: 'wall', label: 'Phone wallpaper', rows: 5, cols: 2, page: 'phone', orient: 'portrait', plate: false },
];

// mm size of a page key. orient 'landscape' swaps w and h of a paper size.
// view: { w, h } in mm, used by 'screen'.
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
// fig: true labels a cell "Fig. 1." (single mode) instead of "1.".
// screen: true for the 'screen' page (thinner margins).
// names: the label text of each cell (the number is added in front).
export function layoutPlate(o) {
  const W = o.w, H = o.h, rows = Math.max(1, o.rows | 0), cols = Math.max(1, o.cols | 0);
  const S = Math.min(W, H);
  const out = { w: W, h: H, rules: [], texts: [], cells: [], content: null };
  // Margin: the space between the paper edge and the border (or content).
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
    // The title block at the top: plate number, title, subtitle.
    const tSize = clamp(S * 0.042, 3, 30), nSize = tSize * 0.42, sSize = tSize * 0.5;
    const cx = W / 2;
    let y = y0 + nSize;
    out.texts.push({ x: cx, y, text: 'Plate ' + roman(o.plateNo || 1) + '.', size: nSize, style: 'normal', align: 'center', role: 'plate' });
    y += tSize * 1.12;
    out.texts.push({ x: cx, y, text: o.titleText || 'Pisces fictae', size: tSize, style: 'normal', align: 'center', role: 'title' });
    if (o.subText) { y += sSize * 1.55; out.texts.push({ x: cx, y, text: o.subText, size: sSize, style: 'italic', align: 'center', role: 'sub' }); }
    y0 = y + tSize * 0.7;
    // The foot: credit at the left, the page note at the right.
    const fSize = clamp(S * 0.012, 1.4, 7);
    out.texts.push({ x: x0, y: y1, text: o.foot || 'Drawn with fishdraw, by Lingdong Huang', size: fSize, style: 'italic', align: 'left', role: 'foot' });
    if (o.footRight) out.texts.push({ x: x1, y: y1, text: o.footRight, size: fSize, style: 'italic', align: 'right', role: 'foot' });
    y1 -= fSize * 2.2;
  }
  const C = { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  out.content = C;
  // Gutters between cells.
  const g = Math.min(C.w, C.h) * (rows * cols > 1 ? 0.025 : 0);
  const cw = (C.w - g * (cols - 1)) / cols, chh = (C.h - g * (rows - 1)) / rows;
  // Label size: a share of the cell height, in a sane range for print.
  const ls = o.labels ? clamp(Math.min(chh * 0.075, cw * 0.05), 1.3, S * 0.03) : 0;
  const lh = o.labels ? ls * 2.1 : 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    const x = C.x + c * (cw + g), y = C.y + r * (chh + g);
    const aw = cw, ah = Math.max(1, chh - lh);
    const k = Math.min(aw / FISH_W, ah / FISH_H);
    const fw = FISH_W * k, fh = FISH_H * k;
    const fx = x + (aw - fw) / 2, fy = y + (ah - fh) / 2 + (o.labels ? (ah - fh) / 2 : 0);
    const cell = { i, r, c, x, y, w: cw, h: chh, fx, fy, fw, fh, k, lx: x + cw / 2, ly: fy + fh + ls * 1.25, ls };
    out.cells.push(cell);
    if (o.labels) {
      const nm = o.names && o.names[i];
      out.texts.push({ x: cell.lx, y: cell.ly, text: (o.fig ? 'Fig. ' : '') + (i + 1) + '.', size: ls, style: 'normal', align: 'num', role: 'num', cell: i, name: nm || '' });
    }
  }
  return out;
}

// The cell under a plate point (mm), or -1.
export function cellAt(L, x, y) {
  for (const c of L.cells) if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return c.i;
  return -1;
}
