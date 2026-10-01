// foldability.js -- local flat-foldability checks, one report per interior vertex.
//
// Port of origami src/model/foldability.rs. A crease pattern that folds flat must
// meet three local conditions at every interior vertex. The checks are necessary,
// not sufficient: the global layer order is left to the simulator to show.
//
// Maekawa counts folds: mountains and valleys differ by exactly two. Kawasaki
// measures angles: the alternating sum of the sector angles is zero.
// Big-Little-Big: a strict local-minimum sector is bounded by one mountain and
// one valley. Borders and auxiliary lines are not counted. A vertex that touches
// the paper boundary is not checked.
//
// The native app computes these but does not draw them. The web page draws them
// in the diagram pane (see drawFoldability in main.js).
//
// grep map:
//   checkVertex     -- one vertex's verdict, or null
//   report          -- every interior vertex, checked
//   isFlatFoldable  -- the whole-pattern summary over the local checks
//   reportOk        -- whether one report passes every decidable check

import { Assignment } from './model.js';

// Within this many degrees of the ideal, an angle condition counts as met.
const ANGLE_TOL_DEG = 0.75;
const TAU = Math.PI * 2;

// Whether a report passes every check that could be evaluated.
export function reportOk(r) {
  return r.kawasakiOk && (r.maekawa === null ? true : r.maekawaOk) && (r.blbOk === null ? true : r.blbOk);
}

// The folding creases at a vertex, [angle, kind], sorted by angle. Null at a
// paper-edge vertex.
function foldCreases(cp, v) {
  const out = [];
  for (const [edge, other] of cp.neighbors(v)) {
    const a = cp.assignment[edge];
    if (a === Assignment.Border) return null;
    if (a === Assignment.Flat) continue;
    const d = [cp.vertices[other][0] - cp.vertices[v][0], cp.vertices[other][1] - cp.vertices[v][1]];
    out.push([Math.atan2(d[1], d[0]), a]);
  }
  out.sort((x, y) => x[0] - y[0]);
  return out;
}

// The sector angles between consecutive sorted creases, in radians.
function sectors(creases) {
  const n = creases.length;
  const s = [];
  for (let i = 0; i < n; i++) {
    let gap = creases[(i + 1) % n][0] - creases[i][0];
    if (gap <= 0) gap += TAU;
    s.push(gap);
  }
  return s;
}

// Check one vertex, or null when it is not an interior folding vertex.
export function checkVertex(cp, v) {
  const creases = foldCreases(cp, v);
  if (!creases) return null;
  const n = creases.length;
  if (n < 3) return null;

  const s = sectors(creases);
  let kawasakiResidual, kawasakiOk;
  if (n % 2 !== 0) {
    kawasakiResidual = 180;
    kawasakiOk = false;
  } else {
    let alt = 0;
    s.forEach((sec, k) => { alt += k % 2 === 0 ? sec : -sec; });
    kawasakiResidual = Math.abs(alt) * 180 / Math.PI;
    kawasakiOk = kawasakiResidual <= ANGLE_TOL_DEG;
  }

  const hasUnassigned = creases.some((c) => c[1] === Assignment.Unassigned);
  let maekawa = null, maekawaOk = false;
  if (!hasUnassigned) {
    const m = creases.filter((c) => c[1] === Assignment.Mountain).length;
    const val = creases.filter((c) => c[1] === Assignment.Valley).length;
    maekawa = m - val;
    maekawaOk = Math.abs(maekawa) === 2;
  }

  const blbOk = bigLittleBig(creases, s);
  return { vertex: v, degree: n, kawasakiResidual, kawasakiOk, maekawa, maekawaOk, blbOk };
}

// Whether every strict local-minimum sector has one mountain and one valley.
// Null when an undecided crease sits on such a sector.
function bigLittleBig(creases, s) {
  const n = s.length;
  let decidable = true;
  for (let i = 0; i < n; i++) {
    const prev = s[(i + n - 1) % n];
    const next = s[(i + 1) % n];
    if (s[i] < prev - 1e-4 && s[i] < next - 1e-4) {
      const a = creases[i][1];
      const b = creases[(i + 1) % n][1];
      if (a === Assignment.Unassigned || b === Assignment.Unassigned) { decidable = false; continue; }
      const oneEach = (a === Assignment.Mountain && b === Assignment.Valley) ||
        (a === Assignment.Valley && b === Assignment.Mountain);
      if (!oneEach) return false;
    }
  }
  return decidable ? true : null;
}

// Check every interior vertex.
export function report(cp) {
  const out = [];
  for (let v = 0; v < cp.vertices.length; v++) {
    const r = checkVertex(cp, v);
    if (r) out.push(r);
  }
  return out;
}

// Whether every interior vertex passes every decidable check.
export function isFlatFoldable(cp) {
  return report(cp).every(reportOk);
}
