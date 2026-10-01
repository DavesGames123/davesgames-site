// planarize.js -- turn a soup of drawn creases into a planar graph with faces.
//
// Port of origami src/model/planarize.rs. A person draws creases that cross, that
// meet an edge partway along, and that share endpoints only by intent. The
// simulator needs a planar graph, where two creases meet only at a shared vertex,
// and it needs the faces those creases bound. This pass splits every crossing,
// splits every point where an endpoint lands on another crease, merges
// coincident points, and then walks the graph to trace its faces.
//
// Face tracing is the standard half-edge walk. Each crease becomes two directed
// half-edges. At each vertex the outgoing half-edges are sorted by angle. The next
// half-edge around a face is the clockwise neighbour of the reverse edge. This
// traces every interior face counter-clockwise. The one outer face comes out
// clockwise, and the sign of its area drops it.
//
// grep map:
//   planarize    -- the whole pass: split, merge, then faces
//   segCross     -- where two segments meet, if they do
//   facesOf      -- the half-edge walk that traces every interior face

import { CreasePattern } from './model.js';

// A point this close to a crease, or to a split, is on it.
const SPLIT_EPS = 1.0e-5;

// Where two segments meet, as a point, or null. Parallel segments return null.
export function segCross(a0, a1, b0, b1) {
  const rx = a1[0] - a0[0], ry = a1[1] - a0[1];
  const sx = b1[0] - b0[0], sy = b1[1] - b0[1];
  const rxs = rx * sy - ry * sx;
  if (Math.abs(rxs) < 1.0e-12) return null;
  const qx = b0[0] - a0[0], qy = b0[1] - a0[1];
  const t = (qx * sy - qy * sx) / rxs;
  const u = (qx * ry - qy * rx) / rxs;
  const e = 1.0e-6;
  if (t >= -e && t <= 1 + e && u >= -e && u <= 1 + e) return [a0[0] + rx * t, a0[1] + ry * t];
  return null;
}

// The parameter of a point along a segment, 0 at a and 1 at b.
function paramOn(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const l2 = abx * abx + aby * aby;
  if (l2 < 1.0e-20) return 0;
  return ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / l2;
}

// The parameter of a vertex on the interior of a segment, or null.
function vertexOnSeg(p, a, b) {
  const t = paramOn(p, a, b);
  if (t > SPLIT_EPS && t < 1 - SPLIT_EPS) {
    const px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t;
    if (Math.hypot(px - p[0], py - p[1]) < SPLIT_EPS) return t;
  }
  return null;
}

// Split every crossing and T-junction, merge coincident points, trace the faces.
// The result is a new crease pattern. Each sub-crease keeps its parent's kind.
export function planarize(cp) {
  const n = cp.edges.length;
  const splits = [];
  for (let i = 0; i < n; i++) splits.push([0, 1]);

  // Crossings between creases.
  for (let i = 0; i < n; i++) {
    const [a0, a1] = cp.segment(i);
    for (let j = i + 1; j < n; j++) {
      const [b0, b1] = cp.segment(j);
      const p = segCross(a0, a1, b0, b1);
      if (p) {
        const ti = paramOn(p, a0, a1);
        const tj = paramOn(p, b0, b1);
        if (ti > SPLIT_EPS && ti < 1 - SPLIT_EPS) splits[i].push(ti);
        if (tj > SPLIT_EPS && tj < 1 - SPLIT_EPS) splits[j].push(tj);
      }
    }
  }

  // A vertex on the interior of a crease splits it.
  for (let i = 0; i < n; i++) {
    const [a0, a1] = cp.segment(i);
    const [ea, eb] = cp.edges[i];
    for (let vi = 0; vi < cp.vertices.length; vi++) {
      if (vi === ea || vi === eb) continue;
      const t = vertexOnSeg(cp.vertices[vi], a0, a1);
      if (t !== null) splits[i].push(t);
    }
  }

  // Build the sub-creases.
  const out = new CreasePattern();
  for (let i = 0; i < n; i++) {
    const [a0, a1] = cp.segment(i);
    const kind = cp.assignment[i];
    const sorted = splits[i].slice().sort((x, y) => x - y);
    // Rust dedup_by: drop a value within SPLIT_EPS of the last kept one.
    const ts = [];
    for (const t of sorted) {
      if (ts.length && Math.abs(t - ts[ts.length - 1]) < SPLIT_EPS) continue;
      ts.push(t);
    }
    for (let k = 0; k + 1 < ts.length; k++) {
      const p = [a0[0] + (a1[0] - a0[0]) * ts[k], a0[1] + (a1[1] - a0[1]) * ts[k]];
      const q = [a0[0] + (a1[0] - a0[0]) * ts[k + 1], a0[1] + (a1[1] - a0[1]) * ts[k + 1]];
      out.addCrease(p, q, kind);
    }
  }

  out.faces = facesOf(out);
  return out;
}

// Trace every interior face of a planar pattern as a CCW vertex loop.
// Half-edge 2e runs from the first endpoint of crease e to the second, and
// 2e + 1 is its reverse.
export function facesOf(cp) {
  const n = cp.edges.length;
  if (n === 0) return [];
  const vcount = cp.vertices.length;
  const origin = (h) => ((h & 1) === 0 ? cp.edges[h >> 1][0] : cp.edges[h >> 1][1]);
  const dest = (h) => origin(h ^ 1);

  const outH = [];
  for (let v = 0; v < vcount; v++) outH.push([]);
  for (let e = 0; e < n; e++) {
    const [a, b] = cp.edges[e];
    outH[a].push(2 * e);
    outH[b].push(2 * e + 1);
  }
  const angle = new Float64Array(2 * n);
  for (let h = 0; h < 2 * n; h++) {
    const o = cp.vertices[origin(h)], d = cp.vertices[dest(h)];
    angle[h] = Math.fround(Math.atan2(d[1] - o[1], d[0] - o[0]));
  }
  for (let v = 0; v < vcount; v++) outH[v].sort((h1, h2) => angle[h1] - angle[h2]);
  const pos = new Int32Array(2 * n);
  for (let v = 0; v < vcount; v++) outH[v].forEach((h, i) => { pos[h] = i; });

  const visited = new Uint8Array(2 * n);
  const faces = [];
  for (let start = 0; start < 2 * n; start++) {
    if (visited[start]) continue;
    const loopH = [];
    let h = start;
    for (;;) {
      visited[h] = 1;
      loopH.push(h);
      const t = h ^ 1;
      const list = outH[origin(t)];
      const idx = pos[t];
      h = list[(idx + list.length - 1) % list.length];
      if (h === start) break;
      // A malformed graph could fail to close. Drop the partial loop.
      if (loopH.length > 2 * n) break;
    }
    const vs = loopH.map(origin);
    if (signedArea(vs, cp.vertices) > SPLIT_EPS) faces.push(vs);
  }
  return faces;
}

// The signed area of a vertex loop, positive when CCW.
function signedArea(loop, verts) {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = verts[loop[i]], q = verts[loop[(i + 1) % loop.length]];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a * 0.5;
}
