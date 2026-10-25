// ============================================================================
//  STEREOGRAM ENGINE  ·  engine/pairs.js — two-image forms (no DOM)
// ----------------------------------------------------------------------------
//  The forms before the single-image stereogram, for the history page.
//    wheatstonePair: two views of a textured depth map, as a mirror
//      stereoscope (Wheatstone 1838) or a lens stereoscope shows them.
//    randomDotStereogram: the two-image random-dot form of Julesz
//      (1960). Each image alone is plain random dots; the object exists
//      only in the difference between the two images.
//    anaglyph: one image for red-cyan glasses.
//
//  VIEWS. Each view moves a surface point at depth z by +-d z / 2 px,
//  where d is the disparity. The left-eye view moves near points right,
//  the right-eye view moves them left (crossed disparity: the object
//  comes out of the page). The pass writes source pixels from far to
//  near with a z-test, at 2x width, so near surfaces cover far ones.
//  Pixels that no source covers (the gaps that a near edge leaves) take
//  the background texture, or new dots in the Julesz form.
//
//  grep -n targets: "function shiftView", "export function wheatstonePair",
//    "export function randomDotStereogram", "export function anaglyph"
// ============================================================================
import { hash3 } from './sirds.js';

function texAt(tex, x, y, c) {
  const tx = ((x % tex.w) + tex.w) % tex.w, ty = ((y % tex.h) + tex.h) % tex.h, i = 4 * (ty * tex.w + tx);
  c[0] = tex.data[i]; c[1] = tex.data[i + 1]; c[2] = tex.data[i + 2];
}
function dotTexture(w, h, seed, density = 0.5) {
  const d = new Uint8ClampedArray(w * h * 4), th = density * 4294967296;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = hash3(x, y, seed) < th ? 0 : 255, i = 4 * (y * w + x);
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  return { w, h, data: d };
}

// One view. dir +1 (left eye) or -1 (right eye). shift(z) -> px.
// fill(x, y, c) gives the colour of a pixel that no source covers.
function shiftView(depth, tex, dir, shift, fill) {
  const { w, h } = depth, out = new Uint8ClampedArray(w * h * 4);
  const W2 = 2 * w, zb = new Float32Array(W2), col = new Int32Array(W2), c = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    zb.fill(-1); col.fill(-1);
    for (let x = 0; x < w; x++) {
      const i = y * w + x, z = depth.data[i], s = dir * shift(z);
      // The source pixel covers [x + s, x + s + 1) in the view.
      const a = Math.max(0, Math.round(2 * (x + s))), b = Math.min(W2, Math.round(2 * (x + s + 1)));
      for (let k = a; k < b; k++) if (z >= zb[k]) { zb[k] = z; col[k] = x; }
    }
    for (let x = 0; x < w; x++) {
      const i = 4 * (y * w + x), sx = col[2 * x] >= 0 ? col[2 * x] : col[2 * x + 1];
      if (sx >= 0) texAt(tex, sx, y, c); else fill(x, y, c);
      out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255;
    }
  }
  return { w, h, data: out };
}

// Two views for a stereoscope. texture: an Image (it repeats) or null.
// opts: { disparity (px, default w / 40), mode 'wall' | 'cross', seed }.
// Returns { left, right }: the image for the left side and for the
// right side. In 'cross' mode the right-eye view is on the left.
export function wheatstonePair(depth, texture = null, opts = {}) {
  const d = opts.disparity ?? Math.max(2, depth.w / 40);
  const tex = texture || dotTexture(depth.w, depth.h, opts.seed ?? 7, opts.density ?? 0.5);
  const shift = z => d * z / 2;
  const fill = (x, y, c) => texAt(tex, x, y, c);
  const L = shiftView(depth, tex, +1, shift, fill), R = shiftView(depth, tex, -1, shift, fill);
  return opts.mode === 'cross' ? { left: R, right: L } : { left: L, right: R };
}

// The Julesz two-image form. The left image is plain random dots. In
// the right image the object region moves left by its disparity (in
// whole px, levels steps), and the gap that it leaves gets new dots.
export function randomDotStereogram(depth, opts = {}) {
  const { w, h } = depth, seed = opts.seed ?? 11, density = opts.density ?? 0.5;
  const d = opts.disparity ?? Math.max(2, Math.round(w / 40)), levels = opts.levels ?? 0;
  const tex = dotTexture(w, h, seed, density), th = density * 4294967296;
  const q = z => levels > 0 ? Math.round(z * levels) / levels : z;
  const left = { w, h, data: Uint8ClampedArray.from(tex.data) };
  const right = shiftView(depth, tex, -1, z => Math.round(d * q(z)), (x, y, c) => {
    const v = hash3(x, y, seed + 9973) < th ? 0 : 255; c[0] = c[1] = c[2] = v;
  });
  return opts.mode === 'cross' ? { left: right, right: left } : { left, right };
}

// A red-cyan anaglyph of two views (the left-eye view through red).
// Pass the views of a 'wall' pair. opts.mode 'red-cyan' or 'gray'.
export function anaglyph(left, right, opts = {}) {
  if (left && left.left && left.right && !right?.data) { opts = right || {}; right = left.right; left = left.left; }
  const { w, h } = left, out = new Uint8ClampedArray(w * h * 4), gray = opts.mode === 'gray';
  const L = left.data, R = right.data;
  for (let i = 0; i < out.length; i += 4) {
    if (gray) {
      out[i] = 0.299 * L[i] + 0.587 * L[i + 1] + 0.114 * L[i + 2];
      out[i + 1] = out[i + 2] = 0.299 * R[i] + 0.587 * R[i + 1] + 0.114 * R[i + 2];
    } else { out[i] = L[i]; out[i + 1] = R[i + 1]; out[i + 2] = R[i + 2]; }
    out[i + 3] = 255;
  }
  return { w, h, data: out };
}
