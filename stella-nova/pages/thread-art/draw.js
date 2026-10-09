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
//    opts   { zoom = 1, scale = 1, batch = 1, colour: override colour }
//  The width and the opacity come from engine.js hairline(), so the mean
//  darkening equals the model's. The composite is the model's: multiply
//  on a white board, screen on a black board.
//  batch > 1 puts up to that many lines of one thread in one path. Lines
//  of one path do not darken each other where they cross. Consecutive
//  greedy lines cross at a few pixels only, so a batch of 48 is near the
//  per-line picture at a fraction of the stroke calls (the saver uses it).
//
//  grep -n: "export function strokeLines"  "export function lineAt"
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
  g.globalAlpha = hl.q * (opts.alphaK ?? 1);
  g.lineWidth = hl.w;
  g.lineCap = 'round';
  let open = 0, curK = -1;
  for (let i = from; i < to; i++) {
    lineAt(piece, i, T);
    if (open && (T[0] !== curK || open >= batch)) { g.stroke(); open = 0; }
    if (!open) { curK = T[0]; g.strokeStyle = opts.colour || piece.colHex[curK]; g.beginPath(); }
    g.moveTo(x + (px[T[1]] + 0.5) * k, y + (py[T[1]] + 0.5) * k);
    g.lineTo(x + (px[T[2]] + 0.5) * k, y + (py[T[2]] + 0.5) * k);
    open++;
  }
  if (open) g.stroke();
  g.restore();
}
