// ============================================================================
//  ULAM SPIRAL  ·  diagonals.js — prime-rich lines and their quadratics
// ----------------------------------------------------------------------------
//  On the square spiral a diagonal half-line, once it leaves the centre,
//  stays on one side of the rings. One step along it moves out by one
//  ring, so its numbers are a quadratic 4m^2 + bm + c in the step m.
//  On the Klauber triangle a column is a quadratic m^2 + bm + c in the
//  same way. This module finds those half-lines, fits each quadratic,
//  and ranks the lines by their prime density against the density of
//  random numbers of the same size (sum of 1 / ln v).
//
//  The work is in canonical square coordinates (layouts.js sqIdx, before
//  orient); main.js turns the result with the shape orientation.
//
//  GREP MAP
//    grep -n 'export function rayQuadratic'   fit one half-line
//    grep -n 'export function densestRays'    rank the lines of a region
//    grep -n 'export function cellFamilies'   the lines through one cell
// ============================================================================
import { sqIdx, klaIdx } from './layouts.js';

const DIRS = { ne: [1, 1], sw: [-1, -1], nw: [-1, 1], se: [1, -1], s: [0, -1] };

// The cell of a line nearest the origin: x - y = c (fam 'a') or
// x + y = c (fam 'b'); the Klauber column x = c (fam 'k').
function lineStart(fam, c) {
  if (fam === 'k') return [c, -Math.abs(c)];
  const h = Math.ceil(c / 2);
  return fam === 'a' ? [h, h - c] : [h, c - h];
}
// The value at step t along a half-line from p0 (step 0 = p0).
function valueAt(fam, p0, d, t, start) {
  const x = p0[0] + d[0] * t, y = p0[1] + d[1] * t;
  return start + (fam === 'k' ? klaIdx(x, y) : sqIdx(x, y));
}

// Fit v(t) = A t^2 + B t + C from three far steps, then walk back to the
// first step t0 where the fit still holds. The quadratic is given in
// m = t - t0: a m^2 + b m + c.
export function rayQuadratic(fam, c, dirKey, start = 1) {
  const p0 = lineStart(fam, c), d = DIRS[dirKey];
  const t1 = Math.abs(c) + 4;
  const v = t => valueAt(fam, p0, d, t, start);
  const v1 = v(t1), v2 = v(t1 + 1), v3 = v(t1 + 2);
  const A = (v3 - 2 * v2 + v1) / 2, B = v2 - v1 - A * (2 * t1 + 1), C = v1 - A * t1 * t1 - B * t1;
  const f = t => A * t * t + B * t + C;
  // The half towards sw (line a) or nw (line b) starts one step out: p0
  // belongs to the other half.
  const tMin = dirKey === 'sw' || dirKey === 'nw' ? 1 : 0;
  let t0 = t1;
  while (t0 > tMin && v(t0 - 1) === f(t0 - 1)) t0--;
  return { fam, c: c, dir: dirKey, p0, d, t0, a: A, b: 2 * A * t0 + B, c0: f(t0), at: m => f(t0 + m), start: [p0[0] + d[0] * t0, p0[1] + d[1] * t0] };
}

// Rank the half-lines with |offset| <= C over M steps each.
// prime(n): the primality oracle. shape: 'square' or 'klauber'.
// Returns the lines with at least minSteps numbers, densest first.
export function densestRays({ C = 40, M = 400, start = 1, prime, shape = 'square', top = 8 }) {
  const rays = [];
  const fams = shape === 'klauber' ? [['k', ['s']]] : [['a', ['ne', 'sw']], ['b', ['nw', 'se']]];
  for (const [fam, dirs] of fams) {
    for (let c = -C; c <= C; c++) {
      for (const dk of dirs) {
        const q = rayQuadratic(fam, c, dk, start);
        let obs = 0, exp = 0, n = 0;
        for (let m = 0; m < M; m++) {
          const v = q.at(m);
          if (v < 2) continue;
          n++;
          if (prime(v)) obs++;
          exp += 1 / Math.log(v);
        }
        if (n < 20 || exp <= 0) continue;
        rays.push({ ...q, obs, exp, steps: n, ratio: obs / exp });
      }
    }
  }
  rays.sort((x, y) => y.ratio - x.ratio);
  // keep one ray per quadratic (the same quadratic can lie on two lines)
  const seen = new Set(), out = [];
  for (const r of rays) {
    const key = `${r.a},${r.b},${r.c0}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push(r);
    if (out.length >= top) break;
  }
  return out;
}

// The two diagonal half-lines through a square-spiral cell (canonical
// coordinates), with the step m of the cell on each.
export function cellFamilies(x, y, start = 1) {
  const out = [];
  for (const fam of ['a', 'b']) {
    const c = fam === 'a' ? x - y : x + y, p0 = lineStart(fam, c);
    const t = x - p0[0];
    const dk = fam === 'a' ? (t >= 0 ? 'ne' : 'sw') : (t >= 0 ? 'se' : 'nw');
    const q = rayQuadratic(fam, c, dk, start);
    const m = Math.abs(t) - q.t0;
    if (m >= 0 && q.at(m) === start + sqIdx(x, y)) out.push({ a: q.a, b: q.b, c: q.c0, m, dir: dk });
  }
  return out;
}
