// triangulate.js -- ear-clipping triangulation for one face.
//
// Port of origami src/sim/triangulate.rs. The simulator works on triangles,
// because a triangle with fixed edge lengths is rigid and a quad is not. Each
// face is cut into triangles here. The diagonals this adds become facet creases
// in the mesh builder, held flat so the face keeps its shape.
//
// grep map:
//   triangulate  -- a CCW simple polygon to a list of index triples

// Triangulate a simple CCW polygon of [x, y] points. Returns index triples. A
// polygon that cannot be reduced returns the triangles found so far.
export function triangulate(poly) {
  const n = poly.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  const out = [];
  let guard = 0;
  while (idx.length > 3) {
    const m = idx.length;
    let clipped = false;
    for (let i = 0; i < m; i++) {
      const a = idx[(i + m - 1) % m], b = idx[i], c = idx[(i + 1) % m];
      if (isEar(poly, idx, a, b, c)) {
        out.push([a, b, c]);
        idx.splice(i, 1);
        clipped = true;
        break;
      }
    }
    if (!clipped) break;
    guard += 1;
    if (guard > n) break;
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

// Twice the signed area of triangle abc, positive when CCW. The Rust source
// computes this in f32, and the ear test is a sign test, so fround keeps the
// same verdict on a near-flat corner.
export function cross(a, b, c) {
  const f = Math.fround;
  return f(f(f(b[0] - a[0]) * f(c[1] - a[1])) - f(f(b[1] - a[1]) * f(c[0] - a[0])));
}

function isEar(poly, idx, a, b, c) {
  const pa = poly[a], pb = poly[b], pc = poly[c];
  if (cross(pa, pb, pc) <= 0) return false;
  for (const k of idx) {
    if (k === a || k === b || k === c) continue;
    if (pointInTri(poly[k], pa, pb, pc)) return false;
  }
  return true;
}

// Whether p lies inside triangle abc, edges included.
function pointInTri(p, a, b, c) {
  const d1 = cross(p, a, b), d2 = cross(p, b, c), d3 = cross(p, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
