// ============================================================================
//  ULAM SPIRAL  ·  layouts.js — the shapes: n <-> position, in closed form
// ----------------------------------------------------------------------------
//  Each shape puts the numbers n = start, start + 1, ... on the plane (or
//  in space). The index is k = n - start. No shape walks the spiral: each
//  map goes from k to the cell, and from the cell to k, by formula (a
//  square root and a few comparisons, or a bit loop for Hilbert and
//  Z-order). So the page can draw any region at once.
//
//  KINDS
//    sq    a square lattice cell (x, y), integers; drawn per pixel
//    hex   a hexagonal lattice cell, axial (q, r); world x = q + r/2,
//          y = r * sqrt(3)/2; drawn per pixel
//    pt    a point in the plane (world units); drawn as GPU points
//    3d    a point in space (x, y, z); drawn as GPU points, orbit camera
//
//  The GPU twins of these maps are in glsl.js (same names with a "g"
//  prefix). The page self-test (main.js "selfTest") reads the GPU maps
//  back with transform feedback and compares them with this file.
//
//  P (the shape parameters), with the defaults in DEFAULT_P:
//    start  the first number (index 0)      cw   true: clockwise turns
//    rot    the start direction, 0..3 (x 90 deg)
//    w      width / numbers per turn         L    rectangle core length
//    cut    octagon corner cut, 0..8 (eighths)
//    K      Sacks turns per square           ang  Fermat angle, degrees
//    g      log spiral growth per turn
//
//  GREP MAP
//    grep -n 'export const SHAPES'         the list (id, key, name, kind)
//    grep -n 'function sqPos'              square spiral, both directions
//    grep -n 'function rectPos'            rectangular spiral (core L)
//    grep -n 'function octPos'             octagonal / stepped spiral
//    grep -n 'function hexPos'             hexagonal spiral
//    grep -n 'function triPos'             triangular spiral
//    grep -n 'function hilbertPos'         Hilbert curve
//    grep -n 'export function posOf'       n -> position, any shape
//    grep -n 'export function nAt'         position -> n, any shape
//    grep -n 'export function worldOf'     lattice cell -> world xy
// ============================================================================

export const SQ3 = Math.sqrt(3) / 2;
export const DEFAULT_P = { start: 1, cw: false, rot: 0, w: 30, L: 8, cut: 4, K: 1, ang: 137.50776405003785, g: 2 };
const isqrt = v => { let s = Math.floor(Math.sqrt(v)); while (s * s > v) s--; while ((s + 1) * (s + 1) <= v) s++; return s; };

// --- orientation for the square family --------------------------------------
// cw mirrors y; rot turns the result by rot x 90 degrees, counter-clockwise.
export function orient(x, y, P) {
  if (P.cw) y = -y;
  for (let i = 0; i < (P.rot & 3); i++) [x, y] = [-y, x];
  return [x, y];
}
export function unorient(x, y, P) {
  for (let i = 0; i < (P.rot & 3); i++) [x, y] = [y, -x];
  if (P.cw) y = -y;
  return [x, y];
}

// --- square spiral ----------------------------------------------------------
// k = 0 at the origin, k = 1 at (1, 0), then counter-clockwise. Ring r
// (Chebyshev distance r) holds k = (2r-1)^2 .. (2r+1)^2 - 1 and starts at
// (r, -r+1) on the right side.
export function sqRing(k) { let r = Math.ceil((Math.sqrt(k + 1) - 1) / 2); while ((2 * r + 1) ** 2 <= k) r++; while (r > 0 && (2 * r - 1) ** 2 > k) r--; return r; }
export function sqPos(k) {
  if (k === 0) return [0, 0];
  const r = sqRing(k), t = k - (2 * r - 1) ** 2, s = 2 * r;
  if (t < s) return [r, -r + 1 + t];
  if (t < 2 * s) return [r - 1 - (t - s), r];
  if (t < 3 * s) return [-r, r - 1 - (t - 2 * s)];
  return [-r + 1 + (t - 3 * s), -r];
}
export function sqIdx(x, y) {
  const r = Math.max(Math.abs(x), Math.abs(y));
  if (r === 0) return 0;
  const m = (2 * r - 1) ** 2;
  if (x === r && y > -r) return m + y + r - 1;
  if (y === r) return m + 2 * r + (r - 1 - x);
  if (x === -r) return m + 4 * r + (r - 1 - y);
  return m + 6 * r + (x + r - 1);
}
// The position t (0 .. 8r-1) of a cell on its square ring, and back.
function sqRingT(x, y, r) { return sqIdx(x, y) - (2 * r - 1) ** 2; }
function sqRingCell(r, t) { return sqPos((2 * r - 1) ** 2 + t); }

// --- rectangular spiral -----------------------------------------------------
// A core of L cells (0..L-1, 0), then rings around it. Ring r spans
// x in [-r, L-1+r], y in [-r, r]: (L+2r)(2r+1) cells inside it.
function rectCount(L, r) { return r < 0 ? 0 : (L + 2 * r) * (2 * r + 1); }
export function rectPos(k, L) {
  if (k < L) return [k, 0];
  let r = Math.max(1, Math.floor((-(2 * L + 2) + Math.sqrt((2 * L + 2) ** 2 - 16 * (L - k))) / 8));
  while (rectCount(L, r) <= k) r++;
  while (r > 1 && rectCount(L, r - 1) > k) r--;
  const t = k - rectCount(L, r - 1), xr = L - 1 + r, side = 2 * r, top = L + 2 * r - 1;
  if (t < side) return [xr, -r + 1 + t];
  if (t < side + top) return [xr - 1 - (t - side), r];
  if (t < 2 * side + top) return [-r, r - 1 - (t - side - top)];
  return [-r + 1 + (t - 2 * side - top), -r];
}
export function rectIdx(x, y, L) {
  if (y === 0 && x >= 0 && x < L) return x;
  const r = Math.max(Math.abs(y), x < 0 ? -x : x - (L - 1));
  if (r <= 0) return -1;
  const m = rectCount(L, r - 1), xr = L - 1 + r, side = 2 * r, top = L + 2 * r - 1;
  if (x === xr && y > -r) return m + y + r - 1;
  if (y === r) return m + side + (xr - 1 - x);
  if (x === -r) return m + side + top + (r - 1 - y);
  return m + 2 * side + top + (x + r - 1);
}

// --- diamond spiral ---------------------------------------------------------
// Ring r is |x| + |y| = r (4r cells); 1 + 2r(r-1) cells come before it.
export function diaPos(k) {
  if (k === 0) return [0, 0];
  let r = Math.max(1, Math.floor((1 + Math.sqrt(Math.max(0, 2 * k - 1))) / 2));
  while (1 + 2 * r * (r + 1) <= k) r++;
  while (r > 1 && 1 + 2 * (r - 1) * r > k) r--;
  const t = k - (1 + 2 * r * (r - 1)), i = Math.floor(t / r), j = t % r;
  if (i === 0) return [r - j, j];
  if (i === 1) return [-j, r - j];
  if (i === 2) return [-r + j, -j];
  return [j, -r + j];
}
export function diaIdx(x, y) {
  const r = Math.abs(x) + Math.abs(y);
  if (r === 0) return 0;
  const m = 1 + 2 * r * (r - 1);
  if (x > 0 && y >= 0) return m + y;
  if (x <= 0 && y > 0) return m + r - x;
  if (x < 0 && y <= 0) return m + 2 * r - y;
  return m + 3 * r + x;
}

// --- octagonal / stepped spiral ---------------------------------------------
// S_r = { |x| <= r, |y| <= r, |x| + |y| <= m_r }, m_r = r + floor(cut r / 8).
// Ring r = S_r minus S_(r-1). The ring is four copies of one quarter
// (x > 0, y >= 0) turned by 90 degrees. Inside a quarter the cells go in
// the order of d = y - x (each d once): the right edge x = r, the stepped
// band of the diagonal lines s = x + y in (m_(r-1), m_r], then the top
// edge y = r. cut 0 gives the diamond, cut 8 the square.
const octM = (r, c) => r + Math.floor(c * r / 8);
export function octCount(r, c) {                      // |S_r|
  if (r < 0) return 0;
  const e = 2 * r - octM(r, c);
  return (2 * r + 1) ** 2 - 2 * e * (e + 1);
}
// The number of cells of the quarter of ring r with d' < d.
function octCnt(r, c, d) {
  const m = octM(r, c), m0 = octM(r - 1, c);
  const lenA = m - r + 1, topN = Math.min(m - r, r - 1), topLo = r - topN;
  let n = Math.min(Math.max(d + r, 0), lenA) + Math.min(Math.max(d - topLo, 0), topN);
  for (let s = m0 + 1; s <= m; s++) {
    const len = 2 * r - 1 - s, lo = s - 2 * r + 2;
    if (len > 0 && d > lo) n += Math.min(len, Math.floor((d - lo + 1) / 2));
  }
  return n;
}
// The cell of quarter index j (0-based) on ring r.
function octQuarterCell(r, c, j) {
  let lo = -r, hi = r;                                // smallest d with cnt(d + 1) > j
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (octCnt(r, c, mid + 1) > j) hi = mid; else lo = mid + 1; }
  const d = lo, m = octM(r, c);
  if (d <= m - 2 * r) return [r, d + r];               // right edge
  const topN = Math.min(m - r, r - 1);
  if (topN > 0 && d >= r - topN) return [r - d, r];   // top edge
  const s = ((m - d) & 1) === 0 ? m : m - 1;          // the band line of d's parity
  return [(s - d) / 2, (s + d) / 2];
}
export function octPos(k, c) {
  if (k === 0) return [0, 0];
  const A = 4 - 2 * (1 - c / 8) ** 2;
  let r = Math.max(1, Math.floor(Math.sqrt(k / A)) - 1);
  while (octCount(r, c) <= k) r++;
  while (r > 1 && octCount(r - 1, c) > k) r--;
  const t = k - octCount(r - 1, c), q = (octCount(r, c) - octCount(r - 1, c)) / 4;
  const qi = Math.floor(t / q);
  let [x, y] = octQuarterCell(r, c, t - qi * q);
  for (let i = 0; i < qi; i++) [x, y] = [-y, x];
  return [x, y];
}
export function octIdx(x, y, c) {
  const r0 = Math.max(Math.abs(x), Math.abs(y));
  if (r0 === 0) return 0;
  // the ring: the smallest r with the cell in S_r
  let r = r0;
  while (Math.abs(x) + Math.abs(y) > octM(r, c)) r++;
  let qi = 0;
  while (!(x > 0 && y >= 0)) { [x, y] = [y, -x]; qi++; }
  const q = (octCount(r, c) - octCount(r - 1, c)) / 4;
  return octCount(r - 1, c) + qi * q + octCnt(r, c, y - x);
}

// --- concentric squares -----------------------------------------------------
// Square rings as in the Ulam spiral, but each ring starts at (r, 0).
export function conPos(k) {
  if (k === 0) return [0, 0];
  const r = sqRing(k), t = k - (2 * r - 1) ** 2;
  return sqRingCell(r, (t + r - 1) % (8 * r));
}
export function conIdx(x, y) {
  const r = Math.max(Math.abs(x), Math.abs(y));
  if (r === 0) return 0;
  return (2 * r - 1) ** 2 + (sqRingT(x, y, r) - (r - 1) + 8 * r) % (8 * r);
}

// --- Klauber triangle -------------------------------------------------------
// Row j (0, 1, 2, ... downwards) holds the 2j + 1 numbers k = j^2 .. j^2 + 2j.
export function klaPos(k) { const j = isqrt(k); return [k - j * j - j, -j]; }
export function klaIdx(x, y) { const j = -y; if (j < 0 || Math.abs(x) > j) return -1; return j * j + j + x; }

// --- Cantor diagonals -------------------------------------------------------
// The quadrant x, y >= 0 by anti-diagonals: k = (x+y)(x+y+1)/2 + y.
export function canPos(k) { let w = Math.floor((Math.sqrt(8 * k + 1) - 1) / 2); while (w * (w + 1) / 2 > k) w--; while ((w + 1) * (w + 2) / 2 <= k) w++; const y = k - w * (w + 1) / 2; return [w - y, y]; }
export function canIdx(x, y) { if (x < 0 || y < 0) return -1; return (x + y) * (x + y + 1) / 2 + y; }

// --- rows and snake rows of width w -----------------------------------------
export function rowPos(k, w) { return [k % w, -Math.floor(k / w)]; }
export function rowIdx(x, y, w) { if (x < 0 || x >= w || y > 0) return -1; return -y * w + x; }
export function snkPos(k, w) { const j = Math.floor(k / w), i = k % w; return [j & 1 ? w - 1 - i : i, -j]; }
export function snkIdx(x, y, w) { if (x < 0 || x >= w || y > 0) return -1; const j = -y; return j * w + (j & 1 ? w - 1 - x : x); }

// --- Hilbert curve and Z-order (side 2^16) ----------------------------------
const HN = 65536;
export function hilbertPos(d) {
  let x = 0, y = 0, t = d;
  for (let s = 1; s < HN; s *= 2) {
    const rx = Math.floor(t / 2) % 2, ry = (t % 2) ^ rx;
    if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } [x, y] = [y, x]; }
    x += s * rx; y += s * ry; t = Math.floor(t / 4);
  }
  return [x, y];
}
export function hilbertIdx(x, y) {
  if (x < 0 || y < 0 || x >= HN || y >= HN) return -1;
  let d = 0;
  for (let s = HN / 2; s > 0; s = Math.floor(s / 2)) {
    const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { x = HN - 1 - x; y = HN - 1 - y; } [x, y] = [y, x]; }
  }
  return d;
}
export function zPos(d) {
  let x = 0, y = 0;
  for (let b = 0; b < 16; b++) { const q = Math.floor(d / 4 ** b) % 4; x += (q & 1) << b; y += (q >> 1) << b; }
  return [x, y];
}
export function zIdx(x, y) {
  if (x < 0 || y < 0 || x >= HN || y >= HN) return -1;
  let d = 0;
  for (let b = 0; b < 16; b++) d += (((x >> b) & 1) + 2 * ((y >> b) & 1)) * 4 ** b;
  return d;
}

// --- hexagonal spiral (axial q, r) ------------------------------------------
// Directions: E, NE, NW, W, SW, SE. Ring R (hex distance R) has 6R cells,
// 1 + 3R(R-1) before it. Side i runs from R*D[i] along D[i+2]. A ring
// starts one cell after the corner R*D[0], so that it joins the ring before.
export const HD = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
export function hexPos(k) {
  if (k === 0) return [0, 0];
  let R = Math.max(1, Math.floor(Math.sqrt(k / 3)));
  while (1 + 3 * R * (R + 1) <= k) R++;
  while (R > 1 && 1 + 3 * R * (R - 1) > k) R--;
  const t = (k - (1 + 3 * R * (R - 1)) + 1) % (6 * R), i = Math.floor(t / R), j = t % R;
  const a = HD[i], b = HD[(i + 2) % 6];
  return [R * a[0] + j * b[0], R * a[1] + j * b[1]];
}
export function hexIdx(q, r) {
  const R = (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
  if (R === 0) return 0;
  for (let i = 0; i < 6; i++) {
    const a = HD[i], b = HD[(i + 2) % 6], dq = q - R * a[0], dr = r - R * a[1];
    const j = b[0] !== 0 ? dq / b[0] : dr / b[1];
    if (j >= 0 && j < R && dq === j * b[0] && dr === j * b[1]) return 1 + 3 * R * (R - 1) + (i * R + j - 1 + 6 * R) % (6 * R);
  }
  return -1;
}

// --- triangular spiral (axial q, r) -----------------------------------------
// Leg j = 1, 2, 3, ... is j steps along e[(j-1) mod 3]: E, NW, SW. The
// three directions sum to zero, so three legs (3t+1, 3t+2, 3t+3) move by
// e1 + 2 e2 whatever t is. The start of leg 3T + u + 1 is T*A[u] + B[u].
const TE = [HD[0], HD[2], HD[4]];
const TA = [[-1, -1], [2, -1], [-1, 2]], TB = [[0, 0], [1, 0], [-1, 2]];
export function triPos(k) {
  if (k === 0) return [0, 0];
  let j = Math.max(1, Math.floor((Math.sqrt(8 * k + 1) - 1) / 2));
  while (j * (j + 1) / 2 < k) j++;
  while (j > 1 && (j - 1) * j / 2 >= k) j--;
  const s = k - (j - 1) * j / 2, u = (j - 1) % 3, T = Math.floor((j - 1) / 3);
  return [T * TA[u][0] + TB[u][0] + s * TE[u][0], T * TA[u][1] + TB[u][1] + s * TE[u][1]];
}
export function triIdx(q, r) {
  if (q === 0 && r === 0) return 0;
  for (let u = 0; u < 3; u++) {
    const e = TE[u], vq = q - TB[u][0], vr = r - TB[u][1];
    const T = vq * e[1] - vr * e[0];                   // cross(v, e); cross(A, e) = 1
    if (T < 0) continue;
    const wq = vq - T * TA[u][0], wr = vr - T * TA[u][1];
    const s = e[0] !== 0 ? wq / e[0] : wr / e[1];
    const j = 3 * T + u + 1;
    if (s >= 1 && s <= j && wq === s * e[0] && wr === s * e[1]) return (j - 1) * j / 2 + s;
  }
  return -1;
}

// --- the shape list -----------------------------------------------------------
// id is the number the shader switches on (glsl.js "SHAPE_"). params: the
// controls the panel shows for the shape.
export const SHAPES = [
  { id: 0, key: 'square', name: 'Ulam square', kind: 'sq', params: ['start', 'cw', 'rot'], note: 'The classic: 1 in the centre, then out in square rings. Primes gather on diagonals, the lines of quadratics 4n² + bn + c.' },
  { id: 1, key: 'rect', name: 'Rectangle', kind: 'sq', params: ['start', 'cw', 'rot', 'L'], note: 'A square spiral around a core row of L cells. The diagonals bend into the core.' },
  { id: 2, key: 'diamond', name: 'Diamond', kind: 'sq', params: ['start', 'cw', 'rot'], note: 'Rings |x| + |y| = r. The prime lines now run along the axes.' },
  { id: 3, key: 'octagon', name: 'Octagon', kind: 'sq', params: ['start', 'cw', 'rot', 'cut'], note: 'Rings with cut corners and stepped sides: cut 0 is the diamond, cut 8/8 the square.' },
  { id: 4, key: 'rings', name: 'Concentric squares', kind: 'sq', params: ['start', 'cw', 'rot'], note: 'The square rings again, but each ring starts on the x axis.' },
  { id: 5, key: 'klauber', name: 'Klauber triangle', kind: 'sq', params: ['start'], note: 'Row j holds j² + 1 .. (j + 1)². Klauber (1932) saw the prime columns before Ulam.' },
  { id: 6, key: 'cantor', name: 'Cantor diagonals', kind: 'sq', params: ['start'], note: 'The quadrant by anti-diagonals: k = (x + y)(x + y + 1)/2 + y.' },
  { id: 7, key: 'rows', name: 'Rows', kind: 'sq', params: ['start', 'w'], note: 'Plain rows of width w. Primes stack in the columns coprime to w.' },
  { id: 8, key: 'snake', name: 'Snake rows', kind: 'sq', params: ['start', 'w'], note: 'Boustrophedon rows of width w: every other row runs back.' },
  { id: 9, key: 'hilbert', name: 'Hilbert curve', kind: 'sq', params: ['start'], note: 'The space-filling Hilbert curve keeps near numbers near.' },
  { id: 10, key: 'zorder', name: 'Z-order', kind: 'sq', params: ['start'], note: 'Morton order: the bits of k split into x and y.' },
  { id: 11, key: 'gauss', name: 'Gaussian lattice', kind: 'sq', params: [], lattice: 'gauss', note: 'Each cell is a + bi. Lit cells are the Gaussian primes.' },
  { id: 12, key: 'hex', name: 'Hexagonal', kind: 'hex', params: ['start'], note: 'Hexagon rings of 6R cells. Six prime spokes and their neighbours.' },
  { id: 13, key: 'tri', name: 'Triangular spiral', kind: 'hex', params: ['start'], note: 'Legs of 1, 2, 3, ... cells at 120 degrees on the triangular lattice.' },
  { id: 14, key: 'eisen', name: 'Eisenstein lattice', kind: 'hex', params: [], lattice: 'eisen', note: 'Each cell is a + bω, ω a cube root of 1. Lit cells are the Eisenstein primes.' },
  { id: 15, key: 'sacks', name: 'Sacks spiral', kind: 'pt', params: ['start', 'K'], note: 'n at radius √n, one turn per square. Squares sit on the x axis, n² + n + 41 on a curve.' },
  { id: 16, key: 'archi', name: 'Archimedean', kind: 'pt', params: ['start', 'w'], note: 'w numbers per turn on r = θ/2π. Primes form spokes and curved arms mod w.' },
  { id: 17, key: 'fermat', name: 'Golden angle', kind: 'pt', params: ['start', 'ang'], note: 'n at radius √n and angle n × 137.5°: a sunflower. Primes pick out its spirals.' },
  { id: 18, key: 'log', name: 'Logarithmic', kind: 'pt', params: ['start', 'g'], note: 'Radius √n, one turn per factor g: n, gn, g²n on one ray.' },
  { id: 19, key: 'helix', name: 'Helix (3D)', kind: '3d', params: ['start', 'w'], note: 'w numbers per turn up a cylinder: the prime columns mod w become stripes.' },
  { id: 20, key: 'pyramid', name: 'Ulam pyramid (3D)', kind: '3d', params: ['start'], note: 'The square spiral, each ring one step lower.' },
  { id: 21, key: 'cone', name: 'Sacks cone (3D)', kind: '3d', params: ['start', 'K'], note: 'The Sacks spiral lifted by √n into a cone.' },
];
export const SHAPE = Object.fromEntries(SHAPES.map(s => [s.key, s]));
export const isLattice = s => s.kind === 'sq' || s.kind === 'hex';

// The lattice cell of index k (lattice shapes), canonical before orient.
function latPos(s, k, P) {
  switch (s.key) {
    case 'square': case 'gauss': return orient(...sqPos(k), s.key === 'gauss' ? {} : P);
    case 'rect': return orient(...rectPos(k, P.L), P);
    case 'diamond': return orient(...diaPos(k), P);
    case 'octagon': return orient(...octPos(k, P.cut), P);
    case 'rings': return orient(...conPos(k), P);
    case 'klauber': return klaPos(k);
    case 'cantor': return canPos(k);
    case 'rows': return rowPos(k, P.w);
    case 'snake': return snkPos(k, P.w);
    case 'hilbert': return hilbertPos(k);
    case 'zorder': return zPos(k);
    case 'hex': case 'eisen': return hexPos(k);
    case 'tri': return triPos(k);
  }
  return [0, 0];
}
// The index k of a lattice cell, or -1 when no number sits there.
function latIdx(s, x, y, P) {
  switch (s.key) {
    case 'square': return sqIdx(...unorient(x, y, P));
    case 'gauss': return sqIdx(x, y);
    case 'rect': return rectIdx(...unorient(x, y, P), P.L);
    case 'diamond': return diaIdx(...unorient(x, y, P));
    case 'octagon': return octIdx(...unorient(x, y, P), P.cut);
    case 'rings': return conIdx(...unorient(x, y, P));
    case 'klauber': return klaIdx(x, y);
    case 'cantor': return canIdx(x, y);
    case 'rows': return rowIdx(x, y, P.w);
    case 'snake': return snkIdx(x, y, P.w);
    case 'hilbert': return hilbertIdx(x, y);
    case 'zorder': return zIdx(x, y);
    case 'hex': case 'eisen': return hexIdx(x, y);
    case 'tri': return triIdx(x, y);
  }
  return -1;
}
// The first number of a shape: lattice shapes number from 0.
export const startOf = (s, P) => (s.lattice ? 0 : Math.max(0, Math.floor(P.start)));

// --- continuous and 3D shapes -----------------------------------------------
const TAU = Math.PI * 2;
export const FERMAT_C = 0.62;
function ptPos(s, n, k, P) {
  switch (s.key) {
    case 'sacks': { const q = Math.sqrt(n), a = TAU * P.K * q; return [q * Math.cos(a), q * Math.sin(a), 0]; }
    case 'archi': { const a = TAU * k / P.w, r = k / P.w; return [r * Math.cos(a), r * Math.sin(a), 0]; }
    case 'fermat': { const r = FERMAT_C * Math.sqrt(n), a = n * P.ang * Math.PI / 180; return [r * Math.cos(a), r * Math.sin(a), 0]; }
    case 'log': { const r = Math.sqrt(n), a = n > 0 ? TAU * Math.log(n) / Math.log(P.g) : 0; return [r * Math.cos(a), r * Math.sin(a), 0]; }
    case 'helix': { const a = TAU * k / P.w, R = P.w / TAU; return [R * Math.cos(a), R * Math.sin(a), k / P.w]; }
    case 'pyramid': { const [x, y] = sqPos(k); return [x, y, -0.5 * Math.max(Math.abs(x), Math.abs(y))]; }
    case 'cone': { const q = Math.sqrt(n), a = TAU * P.K * q; return [q * Math.cos(a), q * Math.sin(a), -0.7 * q]; }
  }
  return [0, 0, 0];
}

// n -> position. Lattice shapes give the cell (x, y) (axial q, r for hex);
// point shapes give world (x, y, z). null when n < start.
export function posOf(s, n, P) {
  const st = startOf(s, P), k = n - st;
  if (k < 0) return null;
  return isLattice(s) ? latPos(s, k, P) : ptPos(s, n, k, P);
}
// The world xy of a lattice cell (hex: axial -> plane).
export function worldOf(s, x, y) { return s.kind === 'hex' ? [x + y / 2, y * SQ3] : [x, y]; }
// The lattice cell under a world point.
export function cellAt(s, wx, wy) {
  if (s.kind !== 'hex') return [Math.round(wx), Math.round(wy)];
  // axial from the plane, then cube rounding
  const r = wy / SQ3, q = wx - r / 2, c = -q - r;
  let rq = Math.round(q), rr = Math.round(r); const rc = Math.round(c);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), dc = Math.abs(rc - c);
  if (dq > dr && dq > dc) rq = -rr - rc; else if (dr > dc) rr = -rq - rc;
  return [rq, rr];
}

// The n range [lo, hi] of point-shape numbers whose radius lies within
// [r0, r1] of the axis (2D shapes and the cone; the helix by its height).
export function nRange(s, P, r0, r1) {
  r0 = Math.max(0, r0);
  const st = startOf(s, P);
  let lo, hi;
  switch (s.key) {
    case 'sacks': case 'log': case 'cone': lo = r0 * r0; hi = r1 * r1; break;
    case 'fermat': lo = (r0 / FERMAT_C) ** 2; hi = (r1 / FERMAT_C) ** 2; break;
    case 'archi': lo = st + r0 * P.w; hi = st + r1 * P.w; break;
    default: lo = st; hi = st + 1e6;
  }
  return [Math.max(st, Math.floor(lo) - 2), Math.max(st, Math.ceil(hi) + 2)];
}

// position -> n. Lattice: the cell (x, y) gives start + k, or -1. Point
// shapes: the nearest number to world (x, y[, z]) within rad, or -1.
export function nAt(s, P, x, y, z = 0, rad = 0.9) {
  const st = startOf(s, P);
  if (isLattice(s)) { const k = latIdx(s, x, y, P); return k < 0 ? -1 : st + k; }
  if (s.key === 'helix') { const n = st + Math.round(z * P.w); const p = ptPos(s, n, n - st, P); return n >= st && Math.hypot(p[0] - x, p[1] - y, p[2] - z) <= rad ? n : -1; }
  if (s.key === 'pyramid') { const k = sqIdx(Math.round(x), Math.round(y)); return st + k; }
  const r = Math.hypot(x, y);
  let best = -1, bd = rad * rad;
  const test = n => {
    if (n < st) return;
    const p = ptPos(s, n, n - st, P), d = (p[0] - x) ** 2 + (p[1] - y) ** 2;
    if (d <= bd) { bd = d; best = n; }
  };
  if (s.key === 'sacks' || s.key === 'cone') {
    // K sqrt(n) = m + theta / 2pi for an integer turn m: two candidates per m.
    let th = Math.atan2(y, x) / TAU; if (th < 0) th += 1;
    for (let m = Math.floor(P.K * (r - rad) - th) - 1; m <= Math.ceil(P.K * (r + rad) - th) + 1; m++) {
      const q = (m + th) / P.K; if (q < 0) continue;
      const n0 = Math.round(q * q);
      for (let n = n0 - 3; n <= n0 + 3; n++) test(n);
    }
    return best;
  }
  const [lo, hi] = nRange(s, P, r - rad, r + rad);
  for (let n = lo; n <= Math.min(hi, lo + 400000); n++) test(n);
  return best;
}

// The lattice coordinates the user sees for a cell: Gaussian a + bi,
// Eisenstein a + b w (a = q + r, b = r).
export function latticeNumber(s, x, y) {
  if (s.lattice === 'gauss') return [x, y];
  if (s.lattice === 'eisen') return [x + y, y];
  return null;
}
