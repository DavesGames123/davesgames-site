// ============================================================================
//  STEREOGRAM HISTORY  ·  geometry.js — the closed forms of the figures
// ----------------------------------------------------------------------------
//  Pure functions, no DOM. tests.mjs checks each one against a closed
//  form. Units: any length unit, used the same for all inputs. Angles
//  are in radians unless a name ends in Deg or Arcmin.
//
//  TOP VIEW (chapter 01). The eyes are at (-I/2, 0) and (+I/2, 0). The
//  z axis points away from the face. vergence(I, x, z) is the angle
//  between the two lines of sight to the point (x, z). The disparity of a
//  point P against the fixation point F is vergence(P) - vergence(F):
//  positive is crossed (P is nearer than F), negative is uncrossed.
//  Points on the Vieth-Mueller circle (the circle through the two eyes
//  and F) have zero disparity: an inscribed angle on one chord.
//
//  FREE FUSION (chapters 02, 04, 07). Two equal marks at a distance s
//  apart on a plane at distance D fuse at fusedDistance(s, e, D, mode).
//  Wall-eyed: Z = e D / (e - s). Cross-eyed: Z = e D / (e + s). With
//  s = e / 2 (wall-eyed) the marks fuse at 2 D: the far plane of
//  Thimbleby, Inglis and Witten (1994).
//
//  ROWS (chapter 04 and 07). separation(z, mu, E) is the formula of
//  Thimbleby, Inglis and Witten: round((1 - mu z) E / (2 - mu z)).
//  lookBackRow is the look-back rule as Tyler (2014) describes it: each
//  pixel copies the pixel one repeat to its left. symmetricRow is the
//  constraint rule of the 1994 paper, without hidden-surface removal.
//  Both return same[], where same[x] = x means a free pixel. rowColours
//  fills a row from same[].
//
//  grep -n targets
//    "export function vergence"       angle at the eyes
//    "export function disparity"      P against F, exact
//    "export function disparityApprox" I dz / d^2
//    "export function viethMuller"    circle through eyes and F
//    "export function fusedDistance"  free-fusion depth of a repeat
//    "export function separation"     TIW formula
//    "export function lookBackRow"    Tyler and Clarke look-back
//    "export function symmetricRow"   TIW symmetric links
//    "export function rowColours"     colours from links
//    "export function gratingDepth"   a disparity grating depth map
//    "export function cyclesPerDegree" grating frequency on the retina
// ============================================================================

export const ARCMIN = 180 * 60 / Math.PI;

// The angle between the lines of sight from the two eyes to (x, z).
export function vergence(I, x, z) {
  const a = Math.atan2(x + I / 2, z), b = Math.atan2(x - I / 2, z);
  return a - b;
}

// Exact disparity of P against F (radians). > 0: crossed (nearer).
export function disparity(I, P, F) {
  return vergence(I, P.x, P.z) - vergence(I, F.x, F.z);
}

// The small-angle form for points on the midline: I/dP - I/dF, that is
// I (dF - dP) / (dP dF), close to I dz / d^2.
export function disparityApprox(I, dP, dF) {
  return I * (dF - dP) / (dP * dF);
}

// The circle through (-I/2, 0), (I/2, 0) and F. Returns { cx, cz, r }.
export function viethMuller(I, F) {
  // Centre on the x = 0 line: cz from |C - eye| = |C - F|.
  const h = I / 2;
  const cz = (F.x * F.x + F.z * F.z - h * h) / (2 * F.z);
  return { cx: 0, cz, r: Math.hypot(h, cz) };
}

// Where two equal marks s apart on a plane at D fuse (see header).
export function fusedDistance(s, e, D, mode = 'wall') {
  if (mode === 'cross') return e * D / (e + s);
  return s >= e ? Infinity : e * D / (e - s);
}

// Thimbleby, Inglis and Witten (1994), Figure 3 line 7.
export function separation(z, mu, E) {
  return Math.round((1 - mu * z) * E / (2 - mu * z));
}

// Tyler and Clarke (1979) as described in Tyler (2014): the colour of a
// pixel is the colour of the pixel one repeat to its left, the repeat
// set by the depth at the pixel. same[x] < x, or x for the seed strip.
export function lookBackRow(z, E, mu) {
  const n = z.length, same = new Int32Array(n);
  for (let x = 0; x < n; x++) {
    const s = separation(z[x], mu, E);
    same[x] = x - s >= 0 ? x - s : x;
  }
  return same;
}

// The symmetric rule of the 1994 paper, without hidden-surface removal.
// A point at depth z links the pixels left = x - s/2 and right = left + s.
// Links chain, so same[] points from a pixel to a pixel on its right.
export function symmetricRow(z, E, mu, y = 0) {
  const n = z.length, same = new Int32Array(n);
  for (let x = 0; x < n; x++) same[x] = x;
  for (let x = 0; x < n; x++) {
    const s = separation(z[x], mu, E);
    let left = x - ((s + (s & y & 1)) >> 1), right = left + s;
    if (left < 0 || right >= n) continue;
    for (let k = same[left]; k !== left && k !== right; k = same[left]) {
      if (k < right) left = k; else { left = right; right = k; }
    }
    same[left] = right;
  }
  return same;
}

// Colours of a row from its links. pick(x) gives a new colour for a
// free pixel. lookBack rows run left to right; symmetric rows right to
// left. Returns an Array of colours.
export function rowColours(same, pick, symmetric = true) {
  const n = same.length, out = new Array(n);
  if (symmetric) for (let x = n - 1; x >= 0; x--) out[x] = same[x] === x ? pick(x) : out[same[x]];
  else for (let x = 0; x < n; x++) out[x] = same[x] === x ? pick(x) : out[same[x]];
  return out;
}

// A disparity grating: depth z = base + amp/2 sin(2 pi cycles t), where t
// runs down the image (horizontal furrows) or across it ('vertical').
export function gratingDepth(w, h, cycles, amp = 0.8, orient = 'horizontal', base = 0.5) {
  const data = new Float32Array(w * h), mask = new Uint8Array(w * h).fill(1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = orient === 'vertical' ? (x + 0.5) / w : (y + 0.5) / h;
    data[y * w + x] = base + amp / 2 * Math.sin(2 * Math.PI * cycles * t);
  }
  return { w, h, data, mask };
}

// The grating frequency at the eye: cycles over a length L seen from D.
export function cyclesPerDegree(cycles, L, D) {
  const deg = 2 * Math.atan(L / (2 * D)) * 180 / Math.PI;
  return cycles / deg;
}

// A depth row from a DepthMap (a copy).
export function depthRow(depth, y) {
  const yy = Math.max(0, Math.min(depth.h - 1, y | 0));
  return Float32Array.from(depth.data.subarray(yy * depth.w, (yy + 1) * depth.w));
}

// A seeded random generator (mulberry32).
export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// A seeded shuffle (Fisher-Yates), a copy.
export function shuffle(arr, seed) {
  const a = arr.slice(), r = rng(seed);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
