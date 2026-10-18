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
//  grep -n 'export function layoutNet'   the two layouts
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

// opts (blocks layout only): per (maps to a row, 5), skip (a Set of layer
// indices to leave out), barCols (1 or 2), title (the block title height),
// inline (the layer name at the left of its row: the 9:16 screensaver).
export function layoutNet(w, h, orient = w >= 720 ? 'h' : 'v', opts = {}) {
  return orient === 'h' ? layoutH(w, h) : layoutV(w, opts);
}

function layoutH(w, h) {
  const pad = 14, head = 42, outW = Math.min(210, Math.max(150, w * 0.17));
  const colW = (w - 2 * pad - outW) / 11;
  const gapR = 0.22;
  const s = Math.max(8, Math.floor(Math.min(colW * 0.74, (h - head - pad) / (10 + 9 * gapR))));
  const gap = Math.round(s * gapR);
  const stackH = n => n * s + (n - 1) * gap;
  const top = head + Math.max(0, (h - head - pad - stackH(10)) / 2);
  const cols = [], maps = [], bars = [];
  for (let li = 0; li < 11; li++) {
    const cx = pad + colW * (li + 0.5), n = nMaps(li);
    const y0 = top + (stackH(10) - stackH(n)) / 2;
    cols.push({ li, label: ARCH[li].label, sub: SHAPES[li], x: cx - colW / 2, y: top, w: colW, cx });
    for (let k = 0; k < n; k++) maps.push({ li, c: chanOf(li, k), x: Math.round(cx - s / 2), y: Math.round(y0 + k * (s + gap)), s });
  }
  const ox = pad + colW * 11 + 10, ow = w - ox - pad;
  cols.push({ li: 11, label: ARCH[11].label, sub: SHAPES[11], x: ox, y: top, w: ow, cx: ox + ow / 2 });
  for (let i = 0; i < 10; i++) bars.push({ i, x: ox, y: Math.round(top + i * (s + gap)), w: ow, h: s });
  return { orient: 'h', w, h, s, gap, head, cols, maps, bars };
}

function layoutV(w, { per = 5, skip = null, barCols = 1, title = 34, inline = false } = {}) {
  // inline: the layer name sits at the left of its row, not above it
  const pad = 16, gap = per > 5 ? 5 : 8, lw = inline ? 66 : 0, t = inline ? 0 : title;
  const s = Math.floor((w - 2 * pad - lw - (per - 1) * gap) / per);
  const cols = [], maps = [], bars = [];
  let y = 8;
  for (let li = 0; li < 11; li++) {
    if (skip && skip.has(li)) continue;
    const n = nMaps(li), rows = Math.ceil(n / per);
    cols.push({ li, label: ARCH[li].label, sub: SHAPES[li], x: pad, y, w: w - 2 * pad, cx: w / 2, rowH: rows * (s + gap) - gap });
    for (let k = 0; k < n; k++) maps.push({ li, c: chanOf(li, k), x: pad + lw + (k % per) * (s + gap), y: y + t + Math.floor(k / per) * (s + gap), s });
    y += t + rows * (s + gap) + (inline ? 2 : per > 5 ? 6 : 14);
  }
  const bt = inline ? 22 : title;
  cols.push({ li: 11, label: ARCH[11].label, sub: SHAPES[11], x: pad, y: y + (inline ? 6 : 0), w: w - 2 * pad, cx: w / 2 });
  if (inline) y += 6;
  const bh = 30, bc = barCols > 1 ? 2 : 1, bw = (w - 2 * pad - (bc - 1) * 16) / bc, rows = Math.ceil(10 / bc);
  for (let i = 0; i < 10; i++) bars.push({ i, x: pad + Math.floor(i / rows) * (bw + 16), y: y + bt + (i % rows) * bh, w: bw, h: bh - 6 });
  y += bt + rows * bh + 16;
  return { orient: 'v', w, h: y, s, gap, head: 0, title: bt, inline, cols, maps, bars };
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
