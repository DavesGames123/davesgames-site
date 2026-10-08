// ============================================================================
//  LINE ART  ·  geom.js — the draw order and the view framing (no DOM)
// ----------------------------------------------------------------------------
//  Pure functions. plotter.js, worker.js and tests.mjs import them.
//
//  DRAW ORDER. The engine gives a depth for each path (crate wasm.rs
//  Job::depths: the mean distance of its points along the view axis).
//  orderPaths sorts the paths of a sheet by that depth, near paths first,
//  and sets the pen cost of each path again (the pen-up travel from the
//  end of the path before it).
//
//  FRAMING. The engine image is the whole view (the window), so the ln
//  clip box (clip space -1..1) is the whole view and no line stops at a
//  box in the center. viewFit puts the example view (its ln aspect and
//  fovy) in the clear rectangle of the page (the frame): it touches the
//  full frame width or the full frame height and keeps the aspect. To do
//  that it widens fovy to the view height and moves the view axis to the
//  frame center with a lens shift (camera array items 10 and 11).
//
//  GREP MAP
//    grep -n 'function depthOrder'   indices by depth, stable
//    grep -n 'function orderPaths'   sort a sheet and set the pen costs
//    grep -n 'function viewFit'      fovy and lens shift for a frame
//    grep -n 'function clampPan'     keep the image over the whole view
// ============================================================================

export const TRAVEL_SPEEDUP = 6;    // pen-up moves are this much faster
export const DOT_COST = 1.5;        // pen time of a path of zero length, image units

// The indices of `depths`, near first. Equal depths keep their order. A
// depth that is not a finite number goes last.
export function depthOrder(depths) {
  const n = depths.length, idx = new Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  const key = i => { const d = depths[i]; return Number.isFinite(d) ? d : Infinity; };
  idx.sort((a, b) => (key(a) - key(b)) || (a - b));
  return idx;
}

// The pen cost of path p after path q (q may be null): its ink length (at
// least DOT_COST) and the pen-up travel from the end of q.
export function penCost(p, q) {
  let tc = 0;
  if (q) { const l = q.pts.length - 2; tc = Math.hypot(p.pts[0] - q.pts[l], p.pts[1] - q.pts[l + 1]) / TRAVEL_SPEEDUP; }
  return Math.max(p.len, DOT_COST) + tc;
}

// Sort paths ({ pts, len, depth, ... }) near first. Returns the new array
// and the total pen cost.
export function orderPaths(paths) {
  const out = depthOrder(paths.map(p => p.depth)).map(i => paths[i]);
  let total = 0;
  for (let i = 0; i < out.length; i++) { out[i].cost = penCost(out[i], i ? out[i - 1] : null); total += out[i].cost; }
  return { paths: out, total };
}

const RAD = Math.PI / 180;
export const MAX_FOVY = 160;

// view: { w, h } the engine image (CSS px). frame: { x, y, w, h } the clear
// rectangle in the same px, y down. aspect0, fovy0: the ln image aspect and
// fovy (degrees) of the example camera. Returns:
//   fovy     the vertical fovy of the whole view, degrees
//   sx, sy   the lens shift in clip units (y up)
//   rect     the example view on the screen { x, y, w, h }
//   clip     the part of the screen that the ln clip box keeps
export function viewFit(view, frame, aspect0, fovy0) {
  const W = Math.max(1, view.w), H = Math.max(1, view.h);
  const f = frame && frame.w > 0 && frame.h > 0 ? frame : { x: 0, y: 0, w: W, h: H };
  const aF = f.w / f.h, a0 = aspect0 > 0 ? aspect0 : 1;
  const tan0 = Math.tan(fovy0 * RAD / 2);
  // the frame height in tan units: a narrow frame widens the lens so the
  // example width fits the frame width
  const tanF = tan0 * Math.max(1, a0 / aF);
  let tanW = tanF * H / f.h;
  const tanMax = Math.tan(MAX_FOVY * RAD / 2);
  if (tanW > tanMax) tanW = tanMax;
  const fovy = 2 * Math.atan(tanW) / RAD;
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
  const sx = (cx - W / 2) / (W / 2), sy = (H / 2 - cy) / (H / 2);
  // the example view: half height tan0 in tan units, H/2 px per tanW
  const hh = H / 2 * tan0 / tanW, hw = hh * a0;
  return { fovy, sx, sy, rect: { x: cx - hw, y: cy - hh, w: 2 * hw, h: 2 * hh }, clip: { x: 0, y: 0, w: W, h: H } };
}

// The pan (CSS px, from the view center) that keeps an image of size
// imgW x imgH (on screen, after zoom) over the whole view, nearest to pan.
// When the image is smaller than the view on one axis, that axis centers.
export function clampPan(panX, panY, imgW, imgH, viewW, viewH) {
  const mx = (imgW - viewW) / 2, my = (imgH - viewH) / 2;
  return [mx > 0 ? Math.max(-mx, Math.min(mx, panX)) : 0, my > 0 ? Math.max(-my, Math.min(my, panY)) : 0];
}

// '#rrggbb' -> 'rgba(r,g,b,a)'
export function hexA(hex, a) {
  const n = parseInt(String(hex).slice(1, 7), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}
