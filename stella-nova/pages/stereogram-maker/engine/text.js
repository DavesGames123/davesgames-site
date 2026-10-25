// ============================================================================
//  STEREOGRAM ENGINE  ·  engine/text.js — depth maps of text (no DOM)
// ----------------------------------------------------------------------------
//  With OffscreenCanvas (a browser page or worker) the text is drawn in
//  the requested font. Without it (node) a built-in 5x7 block font draws
//  the text, so the tests and the worker give the same shape of result.
//  The letter mask gets a bevel from a chamfer distance transform: the
//  depth rises from the far value at the letter edge to the level value
//  at bevel px inside.
//
//  grep -n targets: "export function depthFromText", "FONT5x7",
//                   "function chamfer", "function maskFromCanvas"
// ============================================================================
import { emptyDepth } from './depth.js';

// 5x7 capitals, digits and some marks. Each glyph is 7 rows of 5 bits.
export const FONT5x7 = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30], E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16], Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4], U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31],
  3: [31, 2, 4, 2, 1, 17, 14], 4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14],
  6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8], 8: [14, 17, 17, 14, 17, 17, 14],
  9: [14, 17, 17, 15, 1, 2, 12], ' ': [0, 0, 0, 0, 0, 0, 0], '!': [4, 4, 4, 4, 4, 0, 4],
  '?': [14, 17, 1, 2, 4, 0, 4], '.': [0, 0, 0, 0, 0, 12, 12], ',': [0, 0, 0, 0, 12, 4, 8],
  '-': [0, 0, 0, 31, 0, 0, 0], '+': [0, 4, 4, 31, 4, 4, 0], ':': [0, 12, 12, 0, 12, 12, 0],
  "'": [4, 4, 8, 0, 0, 0, 0], '&': [12, 18, 20, 8, 21, 18, 13], '#': [10, 10, 31, 10, 31, 10, 10],
  '*': [0, 4, 21, 14, 21, 4, 0], '/': [0, 1, 2, 4, 8, 16, 0], '=': [0, 0, 31, 0, 31, 0, 0],
  '(': [2, 4, 8, 8, 8, 4, 2], ')': [8, 4, 2, 2, 2, 4, 8], '<': [2, 4, 8, 16, 8, 4, 2], '>': [8, 4, 2, 1, 2, 4, 8],
};

// The block-font mask: lines split on '\n', centred, cap height size*h.
function maskFromFont(text, w, h, size) {
  const lines = String(text).toUpperCase().split('\n');
  const cols = Math.max(1, ...lines.map(l => l.length * 6 - 1)), rows = lines.length * 9 - 2;
  const px = Math.max(1, Math.min(size * h / 7 / lines.length * (lines.length > 1 ? 1.2 : 1), w * 0.92 / cols, h * 0.92 / rows));
  const m = new Uint8Array(w * h);
  const x0 = (w - cols * px) / 2, y0 = (h - rows * px) / 2;
  lines.forEach((line, li) => {
    const lx = x0 + (cols - (line.length * 6 - 1)) * px / 2;
    for (let c = 0; c < line.length; c++) {
      const g = FONT5x7[line[c]] || FONT5x7['?'];
      for (let r = 0; r < 7; r++) for (let b = 0; b < 5; b++) {
        if (!(g[r] >> (4 - b) & 1)) continue;
        const X0 = Math.round(lx + (c * 6 + b) * px), Y0 = Math.round(y0 + (li * 9 + r) * px);
        const X1 = Math.round(lx + (c * 6 + b + 1) * px), Y1 = Math.round(y0 + (li * 9 + r + 1) * px);
        for (let y = Math.max(0, Y0); y < Math.min(h, Y1); y++) for (let x = Math.max(0, X0); x < Math.min(w, X1); x++) m[y * w + x] = 1;
      }
    }
  });
  return m;
}

function maskFromCanvas(text, w, h, o) {
  const cv = new OffscreenCanvas(w, h), g = cv.getContext('2d');
  if (!g) return null;
  const lines = String(text).split('\n');
  const font = o.font || 'Inter, Helvetica, Arial, sans-serif', weight = o.weight || 800;
  let px = (o.size ?? 0.5) * h / lines.length / 0.72;
  g.font = `${weight} ${px}px ${font}`;
  const widest = Math.max(1, ...lines.map(l => g.measureText(l).width));
  if (widest > w * 0.92) { px *= w * 0.92 / widest; g.font = `${weight} ${px}px ${font}`; }
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const lh = px * 1.05;
  lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * lh));
  const d = g.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = d[4 * i] > 127 ? 1 : 0;
  return m;
}

// Two-pass chamfer distance (3-4 weights / 3) to the nearest 0 pixel.
function chamfer(m, w, h) {
  const INF = 1e9, d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = m[i] ? INF : 0;
  const at = (x, y) => x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 4 / 3, at(x + 1, y - 1) + 4 / 3);
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 4 / 3, at(x - 1, y + 1) + 4 / 3);
  }
  return d;
}

// A depth map of text. opts: { w, h, size, weight, font, bevel, level,
// far, block } (block true forces the built-in font).
export function depthFromText(text, opts = {}) {
  const w = (opts.w || 640) | 0, h = (opts.h || 320) | 0;
  let m = null;
  if (!opts.block && typeof OffscreenCanvas !== 'undefined') { try { m = maskFromCanvas(text, w, h, opts); } catch { m = null; } }
  if (!m) m = maskFromFont(text, w, h, opts.size ?? 0.5);
  const bevel = Math.max(0, opts.bevel ?? 4), level = opts.level ?? 1, far = opts.far ?? 0.25;
  const dist = bevel > 0 ? chamfer(m, w, h) : null;
  const out = emptyDepth(w, h);
  for (let i = 0; i < m.length; i++) {
    if (!m[i]) continue;
    let t = dist ? Math.min(1, dist[i] / bevel) : 1;
    t = t * t * (3 - 2 * t);
    out.data[i] = far + (level - far) * t; out.mask[i] = 1;
  }
  return out;
}
