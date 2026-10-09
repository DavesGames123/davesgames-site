// ============================================================================
//  THREAD ART  ·  draw.js — thread lines as hairline vectors on a 2D context
// ----------------------------------------------------------------------------
//  No DOM: the function takes any CanvasRenderingContext2D (the page, the
//  saver, and @napi-rs/canvas in node checks). main.js, saver.js and the
//  node contact sheets use it, so all of them draw the same line.
//
//  strokeLines(g, piece, x, y, s, from, to, opts)
//    piece  { res, pegs: { x, y }, cfg: { alpha, dark }, colHex: [..],
//             lines: [{ k, a, b }] or L: Int32Array of k, a, b triples }
//    x, y, s  the piece square on g, device px (s at the current zoom)
//    opts   { zoom = 1, scale = 1, batch = 1, colour: override colour,
//             only: draw the lines of this thread only, op: composite,
//             index: Int32Array of line numbers (from..to index into it),
//             cull: { x, y, w, h } skips lines with both ends on one
//             outer side of that rect (a zoomed view draws fewer lines),
//             alphaK: opacity factor }
//  The width and the opacity come from engine.js hairline(), so the mean
//  darkening equals the model's. The composite is the model's: multiply
//  on a white board, screen on a black board.
//  batch > 1 puts up to that many lines of one thread in one path. Lines
//  of one path do not darken each other where they cross. Consecutive
//  greedy lines cross at a few pixels only, so a batch of 48 is near the
//  per-line picture at a fraction of the stroke calls (the saver uses it).
//
//  errorView(...)  the error view at display resolution (see the function)
//
//  grep -n: "export function strokeLines"  "export function lineAt"  "export function errorView"
// ============================================================================
import { hairline } from './engine.js';

/** Line i of a piece as [k, a, b]; out is reused. */
export function lineAt(piece, i, out) {
  if (piece.L) { out[0] = piece.L[3 * i]; out[1] = piece.L[3 * i + 1]; out[2] = piece.L[3 * i + 2]; }
  else { const l = piece.lines[i]; out[0] = l.k; out[1] = l.a; out[2] = l.b; }
  return out;
}

const T = [0, 0, 0];
export function strokeLines(g, piece, x, y, s, from, to, opts = {}) {
  if (!(to > from)) return;
  const zoom = opts.zoom || 1, res = piece.res, k = s / res;
  const hl = hairline(piece.cfg.alpha, k / zoom, { zoom, scale: opts.scale || 1 });
  const px = piece.pegs.x, py = piece.pegs.y, batch = Math.max(1, opts.batch | 0 || 1);
  g.save();
  g.globalCompositeOperation = opts.op || (piece.cfg.dark ? 'screen' : 'multiply');
  g.globalAlpha = Math.min(1, hl.q * (opts.alphaK ?? 1));
  g.lineWidth = hl.w;
  g.lineCap = 'round';
  let open = 0, curK = -1;
  const only = opts.only ?? -1, cull = opts.cull || null;
  const cx0 = cull ? cull.x - 2 : 0, cy0 = cull ? cull.y - 2 : 0, cx1 = cull ? cull.x + cull.w + 2 : 0, cy1 = cull ? cull.y + cull.h + 2 : 0;
  const idx = opts.index || null;
  for (let i = from; i < to; i++) {
    lineAt(piece, idx ? idx[i] : i, T);
    if (only >= 0 && T[0] !== only) continue;
    if (cull) {
      const ax = x + (px[T[1]] + 0.5) * k, ay = y + (py[T[1]] + 0.5) * k, bx = x + (px[T[2]] + 0.5) * k, by = y + (py[T[2]] + 0.5) * k;
      if ((ax < cx0 && bx < cx0) || (ax > cx1 && bx > cx1) || (ay < cy0 && by < cy0) || (ay > cy1 && by > cy1)) continue;
    }
    if (open && (T[0] !== curK || open >= batch)) { g.stroke(); open = 0; }
    if (!open) { curK = T[0]; g.strokeStyle = opts.colour || piece.colHex[curK]; g.beginPath(); }
    g.moveTo(x + (px[T[1]] + 0.5) * k, y + (py[T[1]] + 0.5) * k);
    g.lineTo(x + (px[T[2]] + 0.5) * k, y + (py[T[2]] + 0.5) * k);
    open++;
  }
  if (open) g.stroke();
  g.restore();
}

/**
 * The error view at display resolution, never an upscaled model grid.
 * "What each pixel still lacks" is the source divided by the laid thread
 * (in light): residual light = V_src / V_laid. The 2D canvas does that
 * divide with color-dodge (dst / (1 - src)) and src = 1 - V_laid.
 *   V_src    the full resolution source image (grey for a mono run)
 *   V_laid   the hairline render (art), box-averaged to model pixels and
 *            smoothed back to the view: the laid light the model sees.
 *            It is a smooth field, so the detail of the view is the
 *            source's own. A sharp hairline would divide to white lines.
 * On a black board the same steps run on the inverse images.
 *   g, tmp   2D contexts of two canvases of the view size (w x h)
 *   small    2D context of a third canvas (any size; it is resized)
 *   src      the source image; sr = [sx, sy, ss] its square crop
 *   pr       [x, y, s] the piece square in the view (device px)
 *   art      the canvas with the thread render; ar = [x, y] of the view's
 *            top-left corner on art (the same scale)
 *   o        { dark, mono, res }
 */
export function errorView(g, tmp, small, w, h, src, sr, pr, art, ar, o) {
  const dark = !!o.dark;
  const inv = c => { c.globalCompositeOperation = 'difference'; c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h); };
  g.save(); tmp.save();
  g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, w, h);
  g.fillStyle = dark ? '#000000' : '#ffffff'; g.fillRect(0, 0, w, h);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  if (src) g.drawImage(src, sr[0], sr[1], sr[2], sr[2], pr[0], pr[1], pr[2], pr[2]);
  if (o.mono) { g.globalCompositeOperation = 'saturation'; g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); }
  if (dark) inv(g);
  // The laid light at model scale: art -> model px (box average) -> view.
  const f = Math.min(1, (o.res || 384) / pr[2]);
  const sw = Math.max(1, Math.round(w * f)), sh = Math.max(1, Math.round(h * f));
  const sc = small.canvas;
  if (sc.width !== sw || sc.height !== sh) { sc.width = sw; sc.height = sh; }
  small.save();
  small.globalCompositeOperation = 'source-over';
  small.fillStyle = dark ? '#000000' : '#ffffff'; small.fillRect(0, 0, sw, sh);
  small.imageSmoothingEnabled = true; small.imageSmoothingQuality = 'high';
  small.drawImage(art, ar[0], ar[1], w, h, 0, 0, sw, sh);
  small.restore();
  tmp.globalCompositeOperation = 'source-over'; tmp.clearRect(0, 0, w, h);
  tmp.imageSmoothingEnabled = true; tmp.imageSmoothingQuality = 'high';
  tmp.drawImage(sc, 0, 0, sw, sh, 0, 0, w, h);
  if (!dark) inv(tmp);
  g.globalCompositeOperation = 'color-dodge';
  g.drawImage(tmp.canvas, 0, 0);
  if (dark) inv(g);
  g.restore(); tmp.restore();
}
