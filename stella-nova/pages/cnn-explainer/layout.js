// ============================================================================
//  CNN EXPLAINER  ·  layout.js  where each feature map sits in the overview
// ----------------------------------------------------------------------------
//  DOM-free (node tests import it). The overview is one canvas. layoutNet()
//  gives the rectangle of every map and every output bar in canvas CSS px:
//
//    'h' (desktop)  the layers are columns, left to right, as in the
//                   original tool; the output bars are the last column
//    'v' (phone)    the layers are blocks, top to bottom, five maps to a
//                   row; the page scrolls through them
//
//  Map items: { li, c, x, y, s } (c = -1 is the colour picture of the input
//  column). Bars: { i, x, y, w, h }. A column: { li, label, sub, x, y, w }.
//
//  grep -n 'export function layoutNet'   the two layouts (opts.expand: a zoom)
//  grep -n 'export function zoomWidth'   the width of an open zoom column
//  grep -n 'export function zoomFrom'    the map a zoom grows from
//  grep -n 'export function lerpRect'    a rectangle between two
//  grep -n 'export function prevShown'   the layer before li in a layout
//  grep -n 'export function hitTest'     canvas point -> map, pixel or bar
//  grep -n 'export function feeders'     which maps of layer li-1 feed (li, c)
//  grep -n 'export function fieldMaps'   the maps a receptive field marks
// ============================================================================
import { ARCH } from './net.js';

const SHAPES = ['64 × 64 × 3', '62 × 62 × 10', '62 × 62 × 10', '60 × 60 × 10', '60 × 60 × 10', '30 × 30 × 10',
  '28 × 28 × 10', '28 × 28 × 10', '26 × 26 × 10', '26 × 26 × 10', '13 × 13 × 10', '10 classes'];
export const GRID = [64, 62, 62, 60, 60, 30, 28, 28, 26, 26, 13, 1];

const nMaps = li => (li === 0 ? 4 : 10);
const chanOf = (li, k) => (li === 0 ? k - 1 : k);

// opts (blocks layout): per (maps to a row, 5), skip (a Set of layer
// indices to leave out), barCols (1 or 2), title (the block title height),
// inline (the layer name at the left of its row: the 9:16 screensaver).
// opts.expand = { li, f, h } (both layouts): the zoom of one layer opens in
// place. f 0..1 is how far it is open. Columns: layer li gets wider and the
// other columns get narrower. Blocks: an area of f * h px opens under the
// block of layer li and pushes the blocks under it down. L.zoom is the
// rectangle of that area (null when f is 0).
export function layoutNet(w, h, orient = w >= 720 ? 'h' : 'v', opts = {}) {
  return orient === 'h' ? layoutH(w, h, opts) : layoutV(w, opts);
}

// the width that a zoom column takes when it is open
export function zoomWidth(w) {
  const inner = w - 28;
  return Math.max(Math.min(560, inner - 150), Math.min(980, inner * 0.72));
}

function layoutH(w, h, { expand = null } = {}) {
  const pad = 14, head = 42, outW = Math.min(210, Math.max(150, w * 0.17));
  const colW = (w - 2 * pad - outW) / 11;
  const gapR = 0.22;
  const sOf = cw => Math.max(4, Math.floor(Math.min(cw * 0.74, (h - head - pad) / (10 + 9 * gapR))));
  const s = Math.max(8, sOf(colW));
  // column widths: eleven map columns, then the output column (with its 10 px gap)
  const ws = Array.from({ length: 12 }, (_, li) => (li < 11 ? colW : outW));
  const f = expand ? Math.max(0, Math.min(1, expand.f)) : 0;
  if (f > 0) {
    const inner = w - 2 * pad, Z = zoomWidth(w), li = expand.li;
    const wl = ws[li] + (Math.max(ws[li], Z) - ws[li]) * f;
    const rest0 = inner - ws[li], k = (inner - wl) / rest0;
    for (let i = 0; i < 12; i++) ws[i] = i === li ? wl : ws[i] * k;
  }
  const cols = [], maps = [], bars = [];
  let x = pad;
  const stackH = (n, ss, g) => n * ss + (n - 1) * g;
  const top = head + Math.max(0, (h - head - pad - stackH(10, s, Math.round(s * gapR))) / 2);
  for (let li = 0; li < 11; li++) {
    const cw = ws[li], cx = x + cw / 2, n = nMaps(li);
    const ss = f > 0 ? Math.min(s, sOf(cw)) : s, gap = Math.round(ss * gapR);
    const y0 = top + (stackH(10, s, Math.round(s * gapR)) - stackH(n, ss, gap)) / 2;
    cols.push({ li, label: ARCH[li].label, sub: SHAPES[li], x, y: top, w: cw, cx });
    for (let k = 0; k < n; k++) maps.push({ li, c: chanOf(li, k), x: Math.round(cx - ss / 2), y: Math.round(y0 + k * (ss + gap)), s: ss });
    x += cw;
  }
  const ox = x + 10, ow = ws[11] - 10;
  cols.push({ li: 11, label: ARCH[11].label, sub: SHAPES[11], x: ox, y: top, w: ow, cx: ox + ow / 2 });
  const gap = Math.round(s * gapR);
  for (let i = 0; i < 10; i++) bars.push({ i, x: ox, y: Math.round(top + i * (s + gap)), w: ow, h: s });
  let zoom = null;
  if (f > 0) {
    const col = cols[expand.li], zx = expand.li === 11 ? col.x : col.x + 4, zw = expand.li === 11 ? col.w : col.w - 8;
    zoom = { li: expand.li, f, x: zx, y: 6, w: Math.max(1, zw), h: Math.max(1, h - 12) };
  }
  return { orient: 'h', w, h, s, gap, head, cols, maps, bars, zoom };
}

function layoutV(w, { per = 5, skip = null, barCols = 1, title = 34, inline = false, expand = null } = {}) {
  // inline: the layer name sits at the left of its row, not above it
  const pad = 16, gap = per > 5 ? 5 : 8, lw = inline ? 66 : 0, t = inline ? 0 : title;
  const s = Math.floor((w - 2 * pad - lw - (per - 1) * gap) / per);
  const f = expand ? Math.max(0, Math.min(1, expand.f)) : 0, zh = expand ? expand.h || 480 : 0;
  const cols = [], maps = [], bars = [];
  let y = 8, zoom = null;
  const openZoom = li => {
    if (!(f > 0) || expand.li !== li) return;
    zoom = { li, f, x: pad, y, w: w - 2 * pad, h: Math.max(1, f * zh) };
    y += f * (zh + 12);
  };
  for (let li = 0; li < 11; li++) {
    if (skip && skip.has(li)) continue;
    const n = nMaps(li), rows = Math.ceil(n / per);
    cols.push({ li, label: ARCH[li].label, sub: SHAPES[li], x: pad, y, w: w - 2 * pad, cx: w / 2, rowH: rows * (s + gap) - gap });
    for (let k = 0; k < n; k++) maps.push({ li, c: chanOf(li, k), x: pad + lw + (k % per) * (s + gap), y: y + t + Math.floor(k / per) * (s + gap), s });
    y += t + rows * (s + gap) + (inline ? 2 : per > 5 ? 6 : 14);
    openZoom(li);
  }
  const bt = inline ? 22 : title;
  cols.push({ li: 11, label: ARCH[11].label, sub: SHAPES[11], x: pad, y: y + (inline ? 6 : 0), w: w - 2 * pad, cx: w / 2 });
  if (inline) y += 6;
  const bh = 30, bc = barCols > 1 ? 2 : 1, bw = (w - 2 * pad - (bc - 1) * 16) / bc, rows = Math.ceil(10 / bc);
  for (let i = 0; i < 10; i++) bars.push({ i, x: pad + Math.floor(i / rows) * (bw + 16), y: y + bt + (i % rows) * bh, w: bw, h: bh - 6 });
  y += bt + rows * bh + 16;
  openZoom(11);
  return { orient: 'v', w, h: y, s, gap, head: 0, title: bt, inline, cols, maps, bars, zoom };
}

// -> { kind: 'map', li, c, gy, gx } (gy, gx: the cell of the map grid) or
//    { kind: 'bar', i } or null
export function hitTest(L, x, y) {
  for (const m of L.maps) {
    if (x >= m.x && x < m.x + m.s && y >= m.y && y < m.y + m.s) {
      const n = GRID[m.li];
      return { kind: 'map', li: m.li, c: m.c, gx: Math.min(n - 1, Math.floor((x - m.x) / m.s * n)), gy: Math.min(n - 1, Math.floor((y - m.y) / m.s * n)) };
    }
  }
  for (const b of L.bars) if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return { kind: 'bar', i: b.i };
  return null;
}

export function mapRect(L, li, c) { return L.maps.find(m => m.li === li && m.c === c) || null; }

// The rectangle a zoom of (li, c) grows from: the map, or the bar of class
// c for the output (the top bar when c is null), as { x, y, w, h }. When
// the layout has no row for li (the 9:16 saver), the map of the layer
// before it.
export function zoomFrom(L, li, c, top = 0) {
  if (li === 11) { const b = L.bars[c == null ? top : c] || L.bars[0]; return { x: b.x, y: b.y, w: b.w, h: b.h }; }
  for (let l = li; l >= 0; l--) {
    const m = mapRect(L, l, l === 0 ? (li === 0 ? c : -1) : (c < 0 ? 0 : c));
    if (m) return { x: m.x, y: m.y, w: m.s, h: m.s };
  }
  return { x: 0, y: 0, w: 1, h: 1 };
}

// a rectangle between a and b (e = 0..1)
export function lerpRect(a, b, e) {
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, w: a.w + (b.w - a.w) * e, h: a.h + (b.h - a.h) * e };
}

// the previous layer that has maps in L (the 9:16 saver leaves rows out)
export function prevShown(L, li) {
  for (let l = li - 1; l >= 0; l--) if (L.cols.some(c => c.li === l)) return l;
  return -1;
}

// The channels of layer li - 1 that feed map c of layer li.
export function feeders(li, c) {
  const t = ARCH[li].type;
  const prevC = li - 1 === 0 ? 3 : 10;
  if (t === 'conv' || t === 'dense') return Array.from({ length: prevC }, (_, i) => i);
  return [c];
}

// For a receptive field from map c of layer li down to layer lj < li:
// the channels of lj that it marks (all when a conv sits between them).
export function fieldMaps(li, c, lj) {
  for (let l = lj + 1; l <= li; l++) if (ARCH[l].type === 'conv') return lj === 0 ? [-1, 0, 1, 2] : Array.from({ length: 10 }, (_, i) => i);
  return lj === 0 ? [-1, c] : [c];
}
