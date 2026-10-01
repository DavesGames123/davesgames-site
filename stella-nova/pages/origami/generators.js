// generators.js -- classic crease patterns the page builds from a rule.
//
// Original code for this page. Each function returns a CreasePattern on the
// centred unit square. A generator draws its lines as long as it likes, and
// clipSeg cuts each one to the sheet. planarize.js then splits the crossings,
// so a generator never has to find them itself.
//
// The patterns are classics of origami mathematics. The design credit for each
// is in library.js (for example, the Resch pattern is Ron Resch's). The
// simulator folds every mountain and valley to 180 degrees, so a pattern that
// is not flat-foldable (Resch, the hypars, the circular pleat) reads best part
// folded.
//
// grep map:
//   clipSeg / clipLine -- cut a segment or an endless line to the sheet
//   yoshimura / kresling / resch / waterbombTess / squareTwist
//   accordion / diagonalPleats / gradedPleats / fanPleat
//   spiralFlasher / circularPleat / polygonHypar / miuraSheared
//   GENERATORS -- name to function, the table library.js points into

import { Assignment, CreasePattern } from './model.js';

const { Mountain: M, Valley: V, Flat: F } = Assignment;
const H = 0.5;

// Cut segment a-b to the sheet (Liang-Barsky). Returns [a, b] or null.
export function clipSeg(a, b) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const sides = [[-dx, a[0] + H], [dx, H - a[0]], [-dy, a[1] + H], [dy, H - a[1]]];
  for (const [p, q] of sides) {
    if (Math.abs(p) < 1e-15) { if (q < -1e-12) return null; continue; }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
    if (t0 > t1 - 1e-9) return null;
  }
  return [[a[0] + dx * t0, a[1] + dy * t0], [a[0] + dx * t1, a[1] + dy * t1]];
}

// Cut the endless line through p along d to the sheet.
export function clipLine(p, d) {
  const L = 4 / Math.hypot(d[0], d[1]);
  return clipSeg([p[0] - d[0] * L, p[1] - d[1] * L], [p[0] + d[0] * L, p[1] + d[1] * L]);
}

function put(cp, seg, kind) {
  if (seg && Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]) > 2e-4) cp.addCrease(seg[0], seg[1], kind);
}
const line = (cp, p, d, kind) => put(cp, clipLine(p, d), kind);
const seg = (cp, a, b, kind) => put(cp, clipSeg(a, b), kind);

// Yoshimura (diamond) pattern: mountain rows, valley diagonals. Every pair of
// diagonals meets on a row line, so each row is a strip of triangles.
export function yoshimura(n = 6, m = 4) {
  const cp = CreasePattern.newSquare(H);
  const w = 1 / n, h = 1 / m;
  for (let j = 1; j < m; j++) line(cp, [0, -H + j * h], [1, 0], M);
  for (let i = -2 * m; i <= n + 2 * m; i++) {
    const p = [-H + i * w, -H];
    line(cp, p, [w / 2, h], V);
    line(cp, p, [-w / 2, h], V);
  }
  return cp;
}

// Kresling pattern: mountain rows, a mountain family of steep diagonals, and a
// valley family of shallow ones. `twist` sets the shift per row in cells.
export function kresling(n = 6, m = 4, twist = 0.5) {
  const cp = CreasePattern.newSquare(H);
  const w = 1 / n, h = 1 / m;
  for (let j = 1; j < m; j++) line(cp, [0, -H + j * h], [1, 0], M);
  for (let i = -3 * n; i <= 2 * n; i++) {
    const p = [-H + i * w, -H];
    line(cp, p, [twist * w, h], M);
    line(cp, p, [(1 + twist) * w, h], V);
  }
  return cp;
}

// Ron Resch's triangle pattern. A triangular lattice of mountains. In each
// upward triangle the centroid joins the three corners with valleys. In each
// downward triangle it joins the three edge midpoints with mountains.
export function resch(n = 4) {
  const cp = CreasePattern.newSquare(H);
  const L = 1 / n, rh = L * Math.sqrt(3) / 2;
  const P = (i, j) => [-H + i * L + j * L / 2 - L, -H + j * rh];
  const rows = Math.ceil(1 / rh) + 1;
  for (let j = 0; j < rows; j++) {
    for (let i = -rows; i <= n + 2; i++) {
      const up = [P(i, j), P(i + 1, j), P(i, j + 1)];
      const dn = [P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
      for (const t of [up, dn]) for (let k = 0; k < 3; k++) seg(cp, t[k], t[(k + 1) % 3], M);
      const cu = centroid(up), cd = centroid(dn);
      for (const v of up) seg(cp, cu, v, V);
      for (let k = 0; k < 3; k++) seg(cp, cd, mid(dn[k], dn[(k + 1) % 3]), M);
    }
  }
  return cp;
}
const centroid = (t) => [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3];
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

// Waterbomb tessellation: mountain columns every cell, mountain rows every
// two cells, and valley diagonals that cross at the centre of each waterbomb
// base. Alternate rows of bases are offset by one cell.
export function waterbombTess(cols = 8) {
  const cp = CreasePattern.newSquare(H);
  const u = 1 / cols;
  for (let i = 1; i < cols; i++) line(cp, [-H + i * u, 0], [0, 1], M);
  for (let j = 2; j < cols; j += 2) line(cp, [0, -H + j * u], [1, 0], M);
  for (let k = -cols; k <= 2 * cols; k += 2) {
    line(cp, [-H + k * u, -H], [1, 1], V);
    line(cp, [-H + k * u, -H], [-1, 1], V);
  }
  return cp;
}

// A single square twist on a square sheet. The four sides of the central
// square run on to the paper edge. Past one corner a side line is a valley,
// past the other a mountain, so each corner has three valleys and a mountain.
export function squareTwist(side = 0.3, deg = 26.565) {
  const cp = CreasePattern.newSquare(H);
  const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  const P = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => [(x * c - y * s) * side / 2, (x * s + y * c) * side / 2]);
  for (let k = 0; k < 4; k++) {
    const a = P[k], b = P[(k + 1) % 4];
    const d = [b[0] - a[0], b[1] - a[1]];
    cp.addCrease(a, b, V);
    seg(cp, b, [b[0] + d[0] * 9, b[1] + d[1] * 9], M);
    seg(cp, a, [a[0] - d[0] * 9, a[1] - d[1] * 9], V);
  }
  return cp;
}

// Accordion: n - 1 parallel creases, mountain and valley in turn.
export function accordion(n = 16) {
  const cp = CreasePattern.newSquare(H);
  for (let i = 1; i < n; i++) line(cp, [-H + i / n, 0], [0, 1], i % 2 ? M : V);
  return cp;
}

// Diagonal pleats: the accordion turned 45 degrees.
export function diagonalPleats(n = 12) {
  const cp = CreasePattern.newSquare(H);
  for (let i = 1; i < n; i++) line(cp, [-H + 2 * i / n, -H], [-1, 1], i % 2 ? M : V);
  return cp;
}

// Graded pleats: each pleat is `ratio` times the width of the one before.
export function gradedPleats(n = 14, ratio = 0.84) {
  const cp = CreasePattern.newSquare(H);
  let total = 0;
  for (let i = 0; i < n; i++) total += ratio ** i;
  let x = -H;
  for (let i = 0; i < n - 1; i++) {
    x += ratio ** i / total;
    line(cp, [x, 0], [0, 1], i % 2 ? V : M);
  }
  return cp;
}

// Fan pleat: n rays from the middle of the lower edge, at equal angles.
export function fanPleat(n = 14) {
  const cp = CreasePattern.newSquare(H);
  const o = [0, -H];
  for (let i = 1; i < n; i++) {
    const a = Math.PI * i / n;
    seg(cp, o, [Math.cos(a) * 3, -H + Math.sin(a) * 3], i % 2 ? M : V);
  }
  return cp;
}

// A simple spiral flasher: a central polygon, and rings of the same polygon
// that grow and turn. Spokes join ring to ring as mountains, and one diagonal
// per cell is a valley, so the sheet wraps round the hub as it folds.
export function spiralFlasher(sides = 4, rings = 5, grow = 0.55, turnDeg = 14) {
  const cp = CreasePattern.newSquare(H);
  const r0 = 0.09;
  const P = (i, k) => {
    const rad = r0 * (1 + grow * k) ** 1.35;
    const a = 2 * Math.PI * i / sides + Math.PI / sides + k * turnDeg * Math.PI / 180;
    return [rad * Math.cos(a), rad * Math.sin(a)];
  };
  for (let k = 0; k <= rings; k++) {
    for (let i = 0; i < sides; i++) {
      seg(cp, P(i, k), P(i + 1, k), k === 0 ? V : M);
      if (k < rings) {
        seg(cp, P(i, k), P(i, k + 1), M);
        seg(cp, P(i, k), P(i + 1, k + 1), V);
      } else {
        // The last ring: run each spoke on to the paper edge.
        const a = P(i, k - 1), b = P(i, k);
        seg(cp, b, [b[0] + (b[0] - a[0]) * 20, b[1] + (b[1] - a[1]) * 20], M);
      }
    }
  }
  return cp;
}

// Circular pleat, as a polygon: concentric rings, mountain and valley in turn.
// Flat radial lines cut each ring into flat quads the simulator can bend.
export function circularPleat(rings = 8, sides = 24) {
  const cp = CreasePattern.newSquare(H);
  const r0 = 0.06, r1 = 0.46;
  const R = (k) => r0 + (r1 - r0) * k / rings;
  const pt = (i, r) => { const a = 2 * Math.PI * i / sides; return [r * Math.cos(a), r * Math.sin(a)]; };
  for (let k = 0; k <= rings; k++) {
    for (let i = 0; i < sides; i++) cp.addCrease(pt(i, R(k)), pt(i + 1, R(k)), k % 2 ? M : V);
  }
  for (let i = 0; i < sides; i++) {
    cp.addCrease(pt(i, R(0)), pt(i, R(rings)), F);
    seg(cp, pt(i, R(rings)), pt(i, 3), F);
  }
  return cp;
}

// A pleated polygon (the hypar family): concentric polygons, mountain and
// valley in turn, with flat lines from the centre through each corner.
export function polygonHypar(sides = 6, rings = 8) {
  const cp = CreasePattern.newSquare(H);
  const pt = (i, r) => { const a = 2 * Math.PI * i / sides + Math.PI / 2; return [r * Math.cos(a), r * Math.sin(a)]; };
  const R = (k) => 0.48 * k / rings;
  for (let k = 1; k <= rings; k++) {
    for (let i = 0; i < sides; i++) seg(cp, pt(i, R(k)), pt(i + 1, R(k)), k % 2 ? V : M);
  }
  for (let i = 0; i < sides; i++) seg(cp, [0, 0], pt(i, 3), F);
  return cp;
}

// A Miura-ori with a chosen shear. miuraOri in patterns.js keeps the native
// rule, for parity with the Rust app. This one takes the shear as a parameter.
export function miuraSheared(n = 8, m = 6, shear = 0.6) {
  const cp = CreasePattern.newSquare(H);
  const cw = 1 / n, ch = 1 / m, sh = cw * shear * 0.5;
  const xAt = (i, row) => -H + i * cw + (row % 2 === 0 ? sh : -sh);
  const yAt = (row) => -H + row * ch;
  for (let row = 1; row < m; row++) line(cp, [0, yAt(row)], [1, 0], M);
  for (let i = 1; i < n; i++) {
    for (let row = 0; row < m; row++) {
      seg(cp, [xAt(i, row), yAt(row)], [xAt(i, row + 1), yAt(row + 1)], row % 2 === 0 ? M : V);
    }
  }
  return cp;
}

export const GENERATORS = {
  yoshimura, kresling, resch, waterbombTess, squareTwist, accordion, diagonalPleats,
  gradedPleats, fanPleat, spiralFlasher, circularPleat, polygonHypar, miuraSheared,
};
