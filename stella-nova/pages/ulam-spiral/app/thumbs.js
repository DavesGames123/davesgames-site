// ============================================================================
//  ULAM SPIRAL  ·  app/thumbs.js — the gallery thumbnails and the minimap
// ----------------------------------------------------------------------------
//  Both render off screen with render.js renderMini and copy the pixels
//  (bottom row first) into a 2D canvas. The thumbnails redo a few shapes a
//  frame after rt.thumbsDirty; the minimap redraws at most every 300 ms
//  (rt.miniAt) and only when its key changes, then strokes the view box.
//
//  The 2D contexts of the thumbnails (thumbCtx) and the minimap are taken
//  once when each canvas is made. The shell (index.html releaseFrame)
//  calls getContext('webgpu') on every canvas of a released page; a canvas
//  with no context yet would then give null for '2d'.
//
//  GREP MAP
//    grep -n 'export const THUMB'          thumbnail size, and thumbCtx
//    grep -n 'function thumbCam'           the 2D camera of one thumbnail
//    grep -n 'export function renderThumbs' a few thumbnails a frame
//    grep -n 'function putFlipped'         GL pixels -> 2D canvas
//    grep -n 'export function renderMini'  the minimap and the view box
// ============================================================================
import * as T from '../numtheory.js';
import * as L from '../layouts.js';
import { S, rt } from './state.js';
import { $, miniCtx } from './dom.js';
import { is3D, cam3Mats, worldRect } from './camera.js';
import { startOf, bboxOf, fitCam, homeCount, home3 } from './framing.js';
import { frameState } from './frame.js';

const M = T.MODE;
export const THUMB = 112;
export const thumbCtx = {};
let thumbQ = [];
function thumbCam(sh) {
  const st = L.startOf(sh, S.P), n = sh.kind === 'pt' ? (sh.key === 'archi' ? S.P.w * 22 : 5000) : sh.key === 'rows' || sh.key === 'snake' ? S.P.w * Math.min(60, S.P.w) : sh.key === 'hilbert' || sh.key === 'zorder' ? 4096 : 2600;
  return fitCam(bboxOf(sh, st, st + n, 300), 0.94, { cw: THUMB, ch: THUMB });
}
export function renderThumbs(budget = 3) {
  const R = rt.R;
  if (!R || !S.bits) return;
  if (rt.thumbsDirty) { thumbQ = L.SHAPES.slice(); rt.thumbsDirty = false; }
  const v = { w: THUMB, h: THUMB, cx: THUMB / 2, cy: THUMB / 2, cw: THUMB, ch: THUMB };
  while (budget-- > 0 && thumbQ.length) {
    const sh = thumbQ.shift();
    const mode = sh.lattice === 'gauss' ? M.gauss : sh.lattice === 'eisen' ? M.eisen : (S.mode === M.gauss || S.mode === M.eisen) ? M.primes : S.mode;
    const opts = { shape: sh, mode, dpr: 1, thumb: true, tileOn: false, walk: null, cap: 200000 };
    if (is3D(sh)) { const c3 = home3(sh); c3.dist *= 0.55; opts.cam3 = c3; opts.cam = S.cam; }
    else opts.cam = thumbCam(sh);
    const fs = frameState(v, opts);
    fs.bloom = Math.min(0.6, S.bloom); fs.style = S.style === 0 && sh.kind !== 'pt' && !is3D(sh) ? 0 : 2;
    fs.dotR = 0.42; fs.ptSize = 0.9;
    if (is3D(sh)) { fs.cam3 = cam3Mats(opts.cam3, v); fs.points.count = Math.min(fs.points.count, 30000); }
    const px = R.renderMini(fs, THUMB, THUMB);
    putFlipped(thumbCtx[sh.key], px, THUMB, THUMB);
  }
}
function putFlipped(ctx, px, w, h) {
  if (!ctx || !px) return;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  ctx.putImageData(img, 0, 0);
}
const MINI = 160;
export function renderMini(v) {
  const R = rt.R;
  if (!R || !S.bits || !S.mini || is3D(S.shape) || S.saver || S.morph) return;
  const now = performance.now();
  if (now - rt.miniAt < 300) return;
  rt.miniAt = now;
  const st = startOf(), b = bboxOf(S.shape, st, st + homeCount(S.shape) * 4, 300);
  const span0 = Math.max(b[2] - b[0], b[3] - b[1]) * 1.1, viewSpan = Math.max(v.w, v.h) / S.cam.z * 2.5;
  const span = Math.max(span0, viewSpan);
  const inside = Math.abs(S.cam.x - (b[0] + b[2]) / 2) < span / 2 && Math.abs(S.cam.y - (b[1] + b[3]) / 2) < span / 2;
  const mc = inside && span === span0 ? { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2, span } : { x: S.cam.x, y: S.cam.y, span };
  const key = `${S.shape.key}|${JSON.stringify(S.P)}|${S.mode}|${S.pal}|${S.bg}|${mc.x.toFixed(1)}|${mc.y.toFixed(1)}|${mc.span.toPrecision(3)}|${S.quad.on}`;
  S.miniCam = mc;
  const mini = $('mini'), ctx = miniCtx;
  if (!ctx) return;
  if (key !== S.miniKey) {
    S.miniKey = key;
    const vv = { w: MINI, h: MINI, cx: MINI / 2, cy: MINI / 2, cw: MINI, ch: MINI };
    const fs = frameState(vv, { cam: { x: mc.x, y: mc.y, z: MINI / mc.span }, dpr: 1, thumb: true, tileOn: false, walk: null, cap: 300000 });
    fs.style = 2; fs.bloom = 0.4;
    S.miniPx = R.renderMini(fs, MINI, MINI);
  }
  if (mini.width !== MINI) { mini.width = MINI; mini.height = MINI; }
  putFlipped(ctx, S.miniPx, MINI, MINI);
  // the view rectangle
  const r = worldRect(v), k = MINI / mc.span;
  const x0 = MINI / 2 + (r[0] - mc.x) * k, x1 = MINI / 2 + (r[2] - mc.x) * k, y0 = MINI / 2 - (r[3] - mc.y) * k, y1 = MINI / 2 - (r[1] - mc.y) * k;
  ctx.strokeStyle = 'rgba(255,196,107,0.95)'; ctx.lineWidth = 1.5;
  ctx.strokeRect(Math.max(-2, x0), Math.max(-2, y0), Math.max(2, Math.min(MINI + 4, x1) - Math.max(-2, x0)), Math.max(2, Math.min(MINI + 4, y1) - Math.max(-2, y0)));
}
