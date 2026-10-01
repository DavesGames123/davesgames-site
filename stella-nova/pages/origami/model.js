// model.js -- the crease pattern: the one graph the whole page reads and writes.
//
// Port of origami src/model/mod.rs. A crease pattern is a set of vertices in the
// plane, a set of creases between them, and, after planarize, a set of faces.
// Every crease carries an assignment: mountain, valley, boundary, auxiliary, or
// unassigned. The editor changes this structure, the simulator folds a mesh from
// it, and foldio writes it as FOLD. One graph, read three ways.
//
// The arrays are index-parallel, as in FOLD: crease i is edges[i], its kind is
// assignment[i], and its target angle is foldAngle[i].
//
// Coordinates live in a centred unit square, -0.5 to 0.5 on each axis. The Rust
// source stores f32. This port stores each vertex through Math.fround, so the
// merge and split tests see the same numbers as the native app.
//
// grep map:
//   Assignment      -- the five crease kinds, the FOLD letter, the target angle
//   CreasePattern   -- the vertices, the creases, and the faces
//   newSquare       -- the starting sheet: four corners and four boundary creases
//   addVertex       -- add a point, or return an existing one within MERGE_EPS
//   addCrease       -- add a crease between two points, snap the endpoints
//   neighbors       -- the creases and vertices around one vertex
//   MERGE_EPS       -- how close two points must be to count as the same vertex

const f32 = Math.fround;

// Two points within this distance are the same vertex. The paper is one unit
// across, so this is a ten-thousandth of the sheet.
export const MERGE_EPS = f32(1.0e-4);

// The five crease kinds. The values are the FOLD edges_assignment letters.
export const Assignment = Object.freeze({
  Border: 'B',
  Mountain: 'M',
  Valley: 'V',
  Flat: 'F',
  Unassigned: 'U',
});

// The assignment for a FOLD letter. An unknown letter reads as unassigned.
export function fromLetter(c) {
  switch (String(c || 'U').charAt(0).toUpperCase()) {
    case 'B': return Assignment.Border;
    case 'M': return Assignment.Mountain;
    case 'V': return Assignment.Valley;
    case 'F': return Assignment.Flat;
    default: return Assignment.Unassigned;
  }
}

// The fully folded angle in degrees: a valley is positive, a mountain negative.
export function targetAngle(a) {
  if (a === Assignment.Mountain) return -180;
  if (a === Assignment.Valley) return 180;
  return 0;
}

// Whether this crease folds. A border and an auxiliary line do not.
export function isFold(a) {
  return a === Assignment.Mountain || a === Assignment.Valley;
}

export class CreasePattern {
  constructor() {
    this.vertices = [];   // vertices_coords, [x, y] per vertex
    this.edges = [];      // edges_vertices, [a, b] per crease
    this.assignment = []; // edges_assignment, one letter per crease
    this.foldAngle = [];  // edges_foldAngle, degrees
    this.faces = [];      // faces_vertices, CCW loops, empty until planarize
  }

  // A blank sheet: a square of side 2 * half, centred on the origin.
  static newSquare(half) {
    const cp = new CreasePattern();
    const h = f32(half);
    cp.vertices.push([-h, -h], [h, -h], [h, h], [-h, h]);
    for (let i = 0; i < 4; i++) {
      cp.edges.push([i, (i + 1) % 4]);
      cp.assignment.push(Assignment.Border);
      cp.foldAngle.push(0);
    }
    return cp;
  }

  clone() {
    const cp = new CreasePattern();
    cp.vertices = this.vertices.map((v) => [v[0], v[1]]);
    cp.edges = this.edges.map((e) => [e[0], e[1]]);
    cp.assignment = this.assignment.slice();
    cp.foldAngle = this.foldAngle.slice();
    cp.faces = this.faces.map((f) => f.slice());
    return cp;
  }

  edgeCount() { return this.edges.length; }

  // Add a point, or return the index of an existing vertex within MERGE_EPS.
  addVertex(p) {
    const x = f32(p[0]), y = f32(p[1]);
    const e2 = f32(MERGE_EPS * MERGE_EPS);
    for (let i = 0; i < this.vertices.length; i++) {
      const v = this.vertices[i];
      const dx = f32(v[0] - x), dy = f32(v[1] - y);
      if (f32(dx * dx + dy * dy) <= e2) return i;
    }
    this.vertices.push([x, y]);
    return this.vertices.length - 1;
  }

  // Add a crease between two points and snap each endpoint to an existing vertex.
  // A zero-length crease is rejected (null). A crease that already joins the two
  // vertices gets the new kind, and no second crease is added.
  addCrease(a, b, kind) {
    const ia = this.addVertex(a);
    const ib = this.addVertex(b);
    if (ia === ib) return null;
    for (let i = 0; i < this.edges.length; i++) {
      const e = this.edges[i];
      if ((e[0] === ia && e[1] === ib) || (e[0] === ib && e[1] === ia)) {
        this.assignment[i] = kind;
        return i;
      }
    }
    this.edges.push([ia, ib]);
    this.assignment.push(kind);
    this.foldAngle.push(0);
    return this.edges.length - 1;
  }

  // Remove one crease. The vertices stay, as in the native erase.
  removeCrease(i) {
    this.edges.splice(i, 1);
    this.assignment.splice(i, 1);
    this.foldAngle.splice(i, 1);
  }

  // The world-space endpoints of a crease.
  segment(edge) {
    const [a, b] = this.edges[edge];
    return [this.vertices[a], this.vertices[b]];
  }

  // The creases and neighbour vertices at one vertex, each as [edge, other].
  neighbors(vertex) {
    const out = [];
    for (let i = 0; i < this.edges.length; i++) {
      const e = this.edges[i];
      if (e[0] === vertex) out.push([i, e[1]]);
      else if (e[1] === vertex) out.push([i, e[0]]);
    }
    return out;
  }

  // The bounding box of every vertex, as [min, max]. Empty returns the unit square.
  bounds() {
    if (this.vertices.length === 0) return [[-0.5, -0.5], [0.5, 0.5]];
    let lx = Infinity, ly = Infinity, hx = -Infinity, hy = -Infinity;
    for (const v of this.vertices) {
      if (v[0] < lx) lx = v[0];
      if (v[1] < ly) ly = v[1];
      if (v[0] > hx) hx = v[0];
      if (v[1] > hy) hy = v[1];
    }
    return [[lx, ly], [hx, hy]];
  }
}
