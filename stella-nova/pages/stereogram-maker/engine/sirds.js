// ============================================================================
//  STEREOGRAM ENGINE  ·  engine/sirds.js — single-image stereograms
// ----------------------------------------------------------------------------
//  The constraint step of Thimbleby, Inglis and Witten, "Displaying 3D
//  images: algorithms for single-image random-dot stereograms", IEEE
//  Computer 27(10), 1994. This is our own code of the method that the
//  paper describes.
//
//  GEOMETRY. The eyes are E px apart (E = eyeSep * dpi), at distance D
//  from the image plane. The far plane is D behind the image plane and
//  the near plane is (1 - mu) D behind it. A point at depth z (0 far,
//  1 near) is seen through two image points that are
//      s(z) = round((1 - mu z) E / (2 - mu z))
//  px apart. Those two pixels must have the same colour: a constraint.
//  The array same[] links each pixel to a pixel on its right with the
//  same colour. Then a pass from right to left gives each free pixel a
//  colour from the source and each linked pixel the colour of its link.
//
//  HIDDEN SURFACES. A point makes a constraint only when both eyes see
//  it: the ray to each eye must pass over the depth of the row in
//  between (the 'visible' test in constrainRow).
//
//  CROSS-EYED. A cross-eyed viewer converges in front of the image, so
//  a larger separation looks nearer. The cross mode uses 1 - z for the
//  separation and turns hidden-surface removal off (its geometry is for
//  wall-eyed viewing).
//
//  grep -n targets
//    separation ........... "export function separation"
//    one row .............. "function constrainRow"
//    main entry ........... "export function sirds"
//    tile entry ........... "export function autostereogram"
//    guide dots ........... "function drawGuides"
//    hash dots ............ "export function hash3"
// ============================================================================
export const DEFAULTS = { eyeSep: 2.5, dpi: 72, mu: 1 / 3, mode: 'wall', oversample: 1, guides: true, source: 'dots', density: 0.5, seed: 1, dot: 1 };
export const DOT_PALETTE = ['#ff3b6b', '#ffd23f', '#2bd9a8', '#3a7bff', '#b45cff'];

export function separation(z, mu, E) { return Math.round((1 - mu * z) * E / (2 - mu * z)); }
export function farSeparation(opts = {}) { const o = Object.assign({}, DEFAULTS, opts); return separation(0, o.mu, Math.round(o.eyeSep * o.dpi)); }
export function nearSeparation(opts = {}) { const o = Object.assign({}, DEFAULTS, opts); return separation(1, o.mu, Math.round(o.eyeSep * o.dpi)); }

// A stateless hash of (x, y, seed) to [0, 2^32). The dot at a pixel does
// not depend on the other pixels, so animation frames keep their dots.
export function hash3(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ h >>> 15, 0x85ebca6b); h = Math.imul(h ^ h >>> 13, 0xc2b2ae35);
  return (h ^ h >>> 16) >>> 0;
}
const hex = c => { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };

// Link the pixels of one row. Z: depth per pixel (already in the
// separation sense), same: Int32Array output. Returns the link count.
function constrainRow(Z, same, y, mu, E, hsr) {
  const W = Z.length; let links = 0;
  for (let x = 0; x < W; x++) same[x] = x;
  for (let x = 0; x < W; x++) {
    const z = Z[x], s = separation(z, mu, E);
    let left = x - ((s + (s & y & 1)) >> 1), right = left + s;
    if (left < 0 || right >= W) continue;
    if (hsr) {
      let visible = true, t = 1, zt;
      do {
        zt = z + 2 * (2 - mu * z) * t / (mu * E);
        const a = x - t, b = x + t;
        visible = (a < 0 || Z[a] < zt) && (b >= W || Z[b] < zt);
        t++;
      } while (visible && zt < 1);
      if (!visible) continue;
    }
    // Join the chains of left and right, so the links stay sorted.
    for (let k = same[left]; k !== left && k !== right; k = same[left]) {
      if (k < right) left = k; else { left = right; right = k; }
    }
    same[left] = right; links++;
  }
  return links;
}

// Resample a tile with nearest neighbour to tw x th.
function fitTile(tile, tw, th) {
  if (tile.w === tw && tile.h === th) return tile;
  const d = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const sx = Math.min(tile.w - 1, Math.floor((x + 0.5) * tile.w / tw)), sy = Math.min(tile.h - 1, Math.floor((y + 0.5) * tile.h / th));
    const i = 4 * (y * tw + x), j = 4 * (sy * tile.w + sx);
    d[i] = tile.data[j]; d[i + 1] = tile.data[j + 1]; d[i + 2] = tile.data[j + 2]; d[i + 3] = 255;
  }
  return { w: tw, h: th, data: d };
}

function drawGuides(img, sepFar) {
  const { w, h, data } = img, r = Math.max(3, Math.round(Math.min(w, h) / 120)), cy = Math.max(r * 2 + 2, Math.round(h * 0.04));
  for (const cx of [w / 2 - sepFar / 2, w / 2 + sepFar / 2]) {
    for (let y = cy - 2 * r; y <= cy + 2 * r; y++) for (let x = Math.floor(cx - 2 * r); x <= cx + 2 * r; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy), i = 4 * (y * w + x);
      if (d <= r) { data[i] = data[i + 1] = data[i + 2] = 0; }
      else if (d <= r * 1.8) { data[i] = data[i + 1] = data[i + 2] = 255; }
    }
  }
}

// The stereogram of a DepthMap. See index.js for opts.
export function sirds(depth, opts = {}) {
  const o = Object.assign({}, DEFAULTS, opts);
  const ov = Math.max(1, Math.min(4, o.oversample | 0)), cross = o.mode === 'cross';
  const hsr = o.hsr ?? !cross;
  const w = depth.w, h = depth.h, W = w * ov, mu = o.mu;
  const E = Math.round(o.eyeSep * o.dpi) * ov;
  const sepFar = separation(0, mu, E) / ov, sepNear = separation(1, mu, E) / ov;
  const out = new Uint8ClampedArray(w * h * 4);
  const Z = new Float32Array(W), same = new Int32Array(W), row = new Uint8ClampedArray(W * 3);
  // The colour source for a free pixel at (x, y) of the wide row.
  let src;
  if (o.source === 'tile' && o.tile) {
    const tw = Math.max(1, Math.round(sepFar)), th = Math.max(1, Math.round(o.tile.h * tw / o.tile.w));
    const T = fitTile(o.tile, tw, th);
    src = (x, y, c) => { const i = 4 * ((y % th) * tw + (Math.floor(x / ov) % tw)); c[0] = T.data[i]; c[1] = T.data[i + 1]; c[2] = T.data[i + 2]; };
  } else if (o.source === 'color') {
    const pal = (o.palette && o.palette.length ? o.palette : DOT_PALETTE).map(hex), dot = Math.max(1, o.dot | 0);
    src = (x, y, c) => { const p = pal[hash3(Math.floor(x / ov / dot), Math.floor(y / dot), o.seed) % pal.length]; c[0] = p[0]; c[1] = p[1]; c[2] = p[2]; };
  } else {
    const dot = Math.max(1, o.dot | 0), th = o.density * 4294967296;
    src = (x, y, c) => { const v = hash3(Math.floor(x / ov / dot), Math.floor(y / dot), o.seed) < th ? 0 : 255; c[0] = c[1] = c[2] = v; };
  }
  const c = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    const dr = y * w;
    for (let x = 0; x < W; x++) { const z = depth.data[dr + Math.floor(x / ov)]; Z[x] = cross ? 1 - z : z; }
    constrainRow(Z, same, y, mu, E, hsr);
    for (let x = W - 1; x >= 0; x--) {
      if (same[x] === x) { src(x, y, c); row[3 * x] = c[0]; row[3 * x + 1] = c[1]; row[3 * x + 2] = c[2]; }
      else { const j = 3 * same[x]; row[3 * x] = row[j]; row[3 * x + 1] = row[j + 1]; row[3 * x + 2] = row[j + 2]; }
    }
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < ov; k++) { const j = 3 * (x * ov + k); r += row[j]; g += row[j + 1]; b += row[j + 2]; }
      const i = 4 * (dr + x); out[i] = r / ov; out[i + 1] = g / ov; out[i + 2] = b / ov; out[i + 3] = 255;
    }
  }
  const img = { w, h, data: out, sepFar, sepNear };
  if (o.guides) drawGuides(img, sepFar);
  return img;
}

// The texture form: free pixels take the colour of a repeating tile.
export function autostereogram(depth, tile, opts = {}) {
  return sirds(depth, Object.assign({}, opts, { source: 'tile', tile }));
}

// The links of one row, for the tests and the history figures.
export function rowLinks(zRow, y = 0, opts = {}) {
  const o = Object.assign({}, DEFAULTS, opts);
  const E = Math.round(o.eyeSep * o.dpi), same = new Int32Array(zRow.length);
  constrainRow(Float32Array.from(zRow), same, y, o.mu, E, o.hsr ?? true);
  return same;
}
