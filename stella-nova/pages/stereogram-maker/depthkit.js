// ============================================================================
//  STEREOGRAM MAKER  ·  depthkit.js — depth tools for the page (no DOM)
// ----------------------------------------------------------------------------
//  Pure functions on the engine shapes (engine/index.js header):
//    DepthMap = { w, h, data: Float32Array 0 far..1 near, mask: Uint8Array }
//    Image    = { w, h, data: Uint8ClampedArray RGBA }
//  The worker, the saver and the node tests use them. Nothing here reads
//  the DOM, so each function runs in a module worker and in node.
//
//  RELIEF. reliefImage shades a depth map as a lit plaster cast, so the
//  hidden object reads as a real 3D thing in the thumbnails and in the
//  Reveal view. The normal comes from the depth gradient. The light is a
//  key from the upper left, a cool fill from the right and a rim term at
//  grazing angles. The albedo goes from a warm ivory at the near points
//  to a cooler stone at the far points, and a cavity term darkens creases.
//
//  DEPTH SHAPING. shapeDepth maps the object depth d (0..1) to
//  lift + (1 - lift) * relief * d inside the mask and keeps the wall at
//  0. relief sets how far the object comes out of the wall; lift sets
//  how far its farthest point stands off the wall.
//
//  grep -n targets
//    shading .............. "export function reliefImage"
//    depth shaping ........ "export function shapeDepth"
//    practice depth ....... "export function practiceDepth"
//    tiles from images .... "export function mirrorTile", "export function cropSquare"
//    tile colours ......... "export function recolour", "export function repeatTile"
//    resample ............. "export function resizeImage"
//    sizes and DPI ........ "export function fitBox", "export function screenDpi", "SIZES"
//    turntable budget ..... "export function turntableSize"
// ============================================================================

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// ── relief shading ─────────────────────────────────────────────────────────
// opts: { bg: [r,g,b] top colour, bg2: [r,g,b] bottom colour, zscale,
//         tint: 0..1 how much the depth colours the cast }
const NEAR_ALB = [238, 228, 210], FAR_ALB = [150, 158, 170];
export function reliefImage(dm, opts = {}) {
  const { w, h, mask } = dm;
  // A mesh depth map is flat on each triangle, so the normals of a scan
  // show its facets. A masked blur of a few px smooths the normals; the
  // wall never bleeds into the object.
  const sr = opts.smooth ?? Math.max(1, Math.round(Math.min(w, h) / 260));
  const z = sr > 0 ? maskedBlur(dm.data, mask, w, h, sr) : dm.data;
  const out = new Uint8ClampedArray(w * h * 4);
  const bg = opts.bg || [24, 26, 31], bg2 = opts.bg2 || [11, 12, 15];
  const tint = opts.tint ?? 1;
  // zscale: the height in px of a depth step of 1. A fifth of the short
  // side gives a firm relief without a cliff at each silhouette.
  const zs = opts.zscale ?? Math.min(w, h) * 0.22;
  // Light directions (x right, y down, z toward the viewer), unit length.
  const L1 = norm3([-0.55, -0.62, 0.56]), L2 = norm3([0.75, 0.15, 0.64]);
  const cx = (w - 1) / 2, cy = (h - 1) / 2, rr = 1 / Math.max(1, Math.hypot(cx, cy));
  const at = (x, y) => z[(y < 0 ? 0 : y >= h ? h - 1 : y) * w + (x < 0 ? 0 : x >= w ? w - 1 : x)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4;
      if (!mask[i]) {
        // The wall: a soft vertical gradient with a slight vignette.
        const t = y / Math.max(1, h - 1), v = 1 - 0.35 * Math.hypot(x - cx, y - cy) * rr;
        out[o] = (bg[0] + (bg2[0] - bg[0]) * t) * v;
        out[o + 1] = (bg[1] + (bg2[1] - bg[1]) * t) * v;
        out[o + 2] = (bg[2] + (bg2[2] - bg[2]) * t) * v;
        out[o + 3] = 255;
        continue;
      }
      const d = z[i];
      // Central differences, but a step off the mask uses the one-sided
      // difference, so the silhouette does not get a false cliff.
      const l = mask[i - 1] && x > 0 ? at(x - 1, y) : d, r = x < w - 1 && mask[i + 1] ? at(x + 1, y) : d;
      const u = y > 0 && mask[i - w] ? at(x, y - 1) : d, b = y < h - 1 && mask[i + w] ? at(x, y + 1) : d;
      let nx = -(r - l) * 0.5 * zs, ny = -(b - u) * 0.5 * zs, nz = 1;
      const nl = 1 / Math.hypot(nx, ny, nz); nx *= nl; ny *= nl; nz *= nl;
      const k1 = Math.max(0, nx * L1[0] + ny * L1[1] + nz * L1[2]);
      const k2 = Math.max(0, nx * L2[0] + ny * L2[1] + nz * L2[2]);
      // Half-vector specular for the key light (viewer on +z), broad.
      const hx = L1[0], hy = L1[1], hz = L1[2] + 1, hl = 1 / Math.hypot(hx, hy, hz);
      const sp = Math.pow(Math.max(0, (nx * hx + ny * hy + nz * hz) * hl), 24) * 0.18;
      const rim = Math.pow(1 - nz, 2.2) * 0.22;
      // Cavity: a point lower than the mean of its neighbours is a crease.
      const cav = clamp(((l + r + u + b) * 0.25 - d) * zs * 0.9, 0, 0.45);
      const t = clamp(d, 0, 1) * tint + (1 - tint) * 0.8;
      const ar = FAR_ALB[0] + (NEAR_ALB[0] - FAR_ALB[0]) * t;
      const ag = FAR_ALB[1] + (NEAR_ALB[1] - FAR_ALB[1]) * t;
      const ab = FAR_ALB[2] + (NEAR_ALB[2] - FAR_ALB[2]) * t;
      const lit = (0.16 + 0.78 * k1) * (1 - cav), fill = 0.16 * k2;
      out[o] = ar * lit + 120 * fill + 255 * (sp + rim * 0.9);
      out[o + 1] = ag * lit + 140 * fill + 255 * (sp + rim * 0.95);
      out[o + 2] = ab * lit + 175 * fill + 255 * (sp + rim);
      out[o + 3] = 255;
    }
  }
  return { w, h, data: out };
}
// A box blur (two passes) of a over the pixels where mask is 1. Pixels
// off the mask keep their value.
export function maskedBlur(a, mask, w, h, r) {
  let num = new Float32Array(w * h), den = new Float32Array(w * h);
  for (let i = 0; i < a.length; i++) if (mask[i]) { num[i] = a[i]; den[i] = 1; }
  for (let pass = 0; pass < 2; pass++) {
    num = boxH(boxV(num, w, h, r), w, h, r); den = boxH(boxV(den, w, h, r), w, h, r);
  }
  const out = Float32Array.from(a);
  for (let i = 0; i < a.length; i++) if (mask[i] && den[i] > 1e-6) out[i] = num[i] / den[i];
  return out;
}
function boxH(a, w, h, r) {
  const o = new Float32Array(w * h), k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w; let s = 0;
    for (let x = -r; x <= r; x++) s += a[row + clampI(x, w)];
    for (let x = 0; x < w; x++) { o[row + x] = s * k; s += a[row + clampI(x + r + 1, w)] - a[row + clampI(x - r, w)]; }
  }
  return o;
}
function boxV(a, w, h, r) {
  const o = new Float32Array(w * h), k = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += a[clampI(y, h) * w + x];
    for (let y = 0; y < h; y++) { o[y * w + x] = s * k; s += a[clampI(y + r + 1, h) * w + x] - a[clampI(y - r, h) * w + x]; }
  }
  return o;
}
const clampI = (i, n) => i < 0 ? 0 : i >= n ? n - 1 : i;
function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }

// ── depth shaping ──────────────────────────────────────────────────────────
export function shapeDepth(dm, relief = 1, lift = 0) {
  const n = dm.w * dm.h, out = new Float32Array(n);
  const k = (1 - lift) * relief;
  for (let i = 0; i < n; i++) out[i] = dm.mask[i] ? clamp(lift + k * dm.data[i], 0, 1) : 0;
  return { w: dm.w, h: dm.h, data: out, mask: dm.mask };
}

// The practice image of the help dialog: a raised rounded square with a
// ring in front of it, both flat, so the first fusion shows two clear
// planes. Units are parts of the short side.
export function practiceDepth(w, h) {
  const data = new Float32Array(w * h), mask = new Uint8Array(w * h);
  const s = Math.min(w, h), cx = w / 2, cy = h / 2;
  const half = 0.3 * s, rad = 0.07 * s, r0 = 0.15 * s, r1 = 0.23 * s;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = Math.abs(x + 0.5 - cx), dy = Math.abs(y + 0.5 - cy), i = y * w + x;
    const qx = Math.max(dx - half + rad, 0), qy = Math.max(dy - half + rad, 0);
    const inSq = Math.hypot(qx, qy) <= rad && dx <= half && dy <= half;
    const rr = Math.hypot(dx, dy);
    if (rr >= r0 && rr <= r1) { data[i] = 1; mask[i] = 1; }
    else if (inSq) { data[i] = 0.5; mask[i] = 1; }
  }
  return { w, h, data, mask };
}

// ── tiles from images ──────────────────────────────────────────────────────
// The centre square of an Image, resampled to side px (bilinear).
export function cropSquare(img, side) {
  const s = Math.min(img.w, img.h), x0 = (img.w - s) / 2, y0 = (img.h - s) / 2;
  return resizeImage(img, side, side, { x: x0, y: y0, w: s, h: s });
}
// A 2 x 2 mirror of an Image: the right half is the left half flipped, the
// bottom half the top half flipped. The result wraps with no seam.
export function mirrorTile(img) {
  const W = img.w * 2, H = img.h * 2, out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const sy = y < img.h ? y : H - 1 - y;
    for (let x = 0; x < W; x++) {
      const sx = x < img.w ? x : W - 1 - x, s = (sy * img.w + sx) * 4, o = (y * W + x) * 4;
      out[o] = img.data[s]; out[o + 1] = img.data[s + 1]; out[o + 2] = img.data[s + 2]; out[o + 3] = 255;
    }
  }
  return { w: W, h: H, data: out };
}
// Bilinear resample of an Image (or of the rect src of it) to w x h.
export function resizeImage(img, w, h, src) {
  const sx0 = src ? src.x : 0, sy0 = src ? src.y : 0, sw = src ? src.w : img.w, sh = src ? src.h : img.h;
  const out = new Uint8ClampedArray(w * h * 4), d = img.data, iw = img.w, ih = img.h;
  for (let y = 0; y < h; y++) {
    const fy = clamp(sy0 + (y + 0.5) * sh / h - 0.5, 0, ih - 1), y0 = Math.floor(fy), y1 = Math.min(ih - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = clamp(sx0 + (x + 0.5) * sw / w - 0.5, 0, iw - 1), x0 = Math.floor(fx), x1 = Math.min(iw - 1, x0 + 1), tx = fx - x0;
      const a = (y0 * iw + x0) * 4, b = (y0 * iw + x1) * 4, c = (y1 * iw + x0) * 4, e = (y1 * iw + x1) * 4, o = (y * w + x) * 4;
      for (let k = 0; k < 3; k++) {
        const top = d[a + k] + (d[b + k] - d[a + k]) * tx, bot = d[c + k] + (d[e + k] - d[c + k]) * tx;
        out[o + k] = top + (bot - top) * ty;
      }
      out[o + 3] = 255;
    }
  }
  return { w, h, data: out };
}

// ── sizes ──────────────────────────────────────────────────────────────────
// Output sizes. 'fit' takes the size of the print on screen. The others
// are files: dpi is the print or screen density the repeat is made for.
export const SIZES = [
  { id: 'fit', name: 'Fit the screen' },
  { id: 'hd', name: 'Desktop 1920 × 1080', w: 1920, h: 1080, dpi: 96 },
  { id: 'phone', name: 'Phone 1170 × 2532', w: 1170, h: 2532, dpi: 300 },
  { id: 'square', name: 'Square 2400', w: 2400, h: 2400, dpi: 200 },
  { id: 'a4', name: 'A4 print 300 DPI', w: 3508, h: 2480, dpi: 300 },
  { id: 'banner', name: 'Banner 3 : 1', w: 2700, h: 900, dpi: 120 },
];
export const sizeById = id => SIZES.find(s => s.id === id) || SIZES[0];

// The largest w x h of aspect a (w / h) that fits in W x H.
export function fitBox(W, H, a) {
  if (!(a > 0)) return { w: W, h: H };
  return W / H > a ? { w: H * a, h: H } : { w: W, h: W / a };
}
// The DPI that the engine gets for a screen render. A desktop CSS px is
// near 1/96 inch. A phone CSS px is near 1/150 inch, but people hold a
// phone closer, and a repeat of half the eye separation leaves only two
// repeats across the screen. 120 gives about three, which fuses more
// easily. scale is the device px per CSS px of the render.
export function screenDpi(scale, phone) { return (phone ? 120 : 96) * scale; }

// The frame size for a turntable of n frames inside budget pixels in all,
// with the aspect of w x h and no larger than w x h.
export function turntableSize(w, h, n, budget) {
  const per = budget / Math.max(1, n), k = Math.min(1, Math.sqrt(per / Math.max(1, w * h)));
  return { w: Math.max(64, Math.round(w * k)), h: Math.max(48, Math.round(h * k)) };
}

// ── tile colours and density ───────────────────────────────────────────────
const hexRGB = h => { const n = parseInt(String(h).replace('#', ''), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
// Recolour a tile drawn in the colours from (hex list: paper first, then
// the inks) to the colours to, slot by slot: the paper to the paper, ink
// k to ink k mod the number of inks. Each pixel is a blend of its two
// nearest source colours, so the anti-aliased edges stay soft.
export function recolour(img, from, to) {
  const F = from.map(hexRGB), T = from.map((_, k) => hexRGB(k === 0 ? to[0] : to[1 + (k - 1) % Math.max(1, to.length - 1)] || to[0]));
  const out = new Uint8ClampedArray(img.data.length), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let a = 0, b = -1, da = Infinity, db = Infinity;
    for (let k = 0; k < F.length; k++) {
      const e = (d[i] - F[k][0]) ** 2 + (d[i + 1] - F[k][1]) ** 2 + (d[i + 2] - F[k][2]) ** 2;
      if (e < da) { db = da; b = a; da = e; a = k; } else if (e < db) { db = e; b = k; }
    }
    let wa = 1;
    if (b >= 0 && da > 0) { const sa = Math.sqrt(da), sb = Math.sqrt(db); wa = sb / (sa + sb); }
    const B = b >= 0 ? T[b] : T[a];
    out[i] = T[a][0] * wa + B[0] * (1 - wa); out[i + 1] = T[a][1] * wa + B[1] * (1 - wa); out[i + 2] = T[a][2] * wa + B[2] * (1 - wa); out[i + 3] = 255;
  }
  return Object.assign({}, img, { data: out });
}
// k x k copies of a tile in one tile: the motif gets k times smaller in a
// repeat of the same width.
export function repeatTile(img, k) {
  if (k <= 1) return img;
  const W = img.w * k, H = img.h * k, out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = ((y % img.h) * img.w + (x % img.w)) * 4, o = (y * W + x) * 4;
    out[o] = img.data[s]; out[o + 1] = img.data[s + 1]; out[o + 2] = img.data[s + 2]; out[o + 3] = 255;
  }
  return Object.assign({}, img, { w: W, h: H, data: out });
}
