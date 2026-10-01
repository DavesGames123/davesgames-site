// sim.js -- the folding simulation: a CPU port of Amanda Ghassaei's Origami Simulator.
//
// Port of origami src/sim/mod.rs, which is itself a port of
// github.com/amandaghassaei/OrigamiSimulator (MIT, (c) 2018 Amanda Ghassaei;
// Ghassaei, Demaine, Gershenfeld, "Fast, Interactive Origami Simulation using
// GPU Computation," 7OSME 2018). The constants, the build order, and the pass
// order per sub-step are the same as the Rust source.
//
// The model is three kinds of soft constraint over a triangulated sheet. Axial
// springs hold every edge to its rest length. Crease springs drive the fold
// angle across a mountain or valley toward a target. Face springs hold each
// triangle's corner angles. A global fold fraction scales every crease target,
// and semi-implicit Euler relaxes the sheet toward the targets.
//
// Four details keep a full fold stable:
//   1. The fold angle is unwrapped across steps, so it passes plus or minus pi
//      without the force reversing.
//   2. The geometry is normalized to a unit bounding sphere.
//   3. The timestep is nine tenths of the critical step of the stiffest bar.
//   4. A crease whose moment arm collapses is skipped for that step.
//
// Precision: the Rust source is f32. The node, velocity, force, normal, and
// angle state here live in Float32Array, so each stored value rounds to f32 as
// in the native app. The arithmetic between two stores runs in f64.
//
// grep map:
//   SimParams   -- the Ghassaei constants
//   build       -- a planarized crease pattern to a FoldMesh, normalized and flat
//   FoldMesh    -- nodes, rest positions, and the constraint lists
//   setFraction / step / substep -- scale the targets, then relax
//   resetFlat / recenter / maxResidual -- the helpers the interface calls
//   flatNoise   -- the f32 hash that breaks the flat degeneracy

import { Assignment } from './model.js';
import { triangulate } from './triangulate.js';

const f32 = Math.fround;
const TAU = f32(Math.PI * 2);
const PI = f32(Math.PI);

// The Ghassaei constants. They assume a unit bounding sphere, which build makes.
export const SimParams = Object.freeze({
  axial: 20.0, crease: 0.7, panel: 0.7, face: 0.2, dampingRatio: 0.45, substeps: 45,
});

// The z nudge for node i, the same f32 hash as the Rust source:
//   ((i as f32 * 12.9898).sin() * 43758.547).fract() - 0.5, times 1e-3.
export function flatNoise(i) {
  const a = f32(f32(i) * f32(12.9898));
  const s = f32(Math.sin(a));
  const m = f32(s * f32(43758.547));
  const fr = f32(m - Math.trunc(m));
  return f32(f32(fr - 0.5) * f32(1.0e-3));
}

// The unordered key for an edge, packed into one number. The sort order of the
// packed key is the tuple order of (min, max).
const KEY_SPAN = 1 << 20;
function key(a, b) { return a < b ? a * KEY_SPAN + b : b * KEY_SPAN + a; }

// Build a folding mesh from a planarized crease pattern.
export function build(cp) {
  const params = SimParams;
  const n = cp.vertices.length;
  const nodes = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { nodes[3 * i] = cp.vertices[i][0]; nodes[3 * i + 1] = cp.vertices[i][1]; }

  // Normalize to a unit bounding sphere.
  if (n > 0) {
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      cx = f32(cx + nodes[3 * i]); cy = f32(cy + nodes[3 * i + 1]); cz = f32(cz + nodes[3 * i + 2]);
    }
    cx = f32(cx / f32(n)); cy = f32(cy / f32(n)); cz = f32(cz / f32(n));
    let r = 0;
    for (let i = 0; i < n; i++) {
      const d = f32(Math.hypot(nodes[3 * i] - cx, nodes[3 * i + 1] - cy, nodes[3 * i + 2] - cz));
      if (d > r) r = d;
    }
    r = Math.max(r, f32(1e-6));
    for (let i = 0; i < n; i++) {
      nodes[3 * i] = f32(nodes[3 * i] - cx) / r;
      nodes[3 * i + 1] = f32(nodes[3 * i + 1] - cy) / r;
      nodes[3 * i + 2] = f32(nodes[3 * i + 2] - cz) / r;
    }
  }
  const orig = new Float32Array(nodes);

  // Break the flat degeneracy with a nudge smaller than any feature.
  for (let i = 0; i < n; i++) nodes[3 * i + 2] = flatNoise(i);

  // Triangulate faces. A diagonal the triangulation adds is a facet crease.
  const trisIdx = [];
  const faceOf = [];
  cp.faces.forEach((face, fi) => {
    const poly = face.map((vi) => cp.vertices[vi]);
    for (const t of triangulate(poly)) {
      trisIdx.push([face[t[0]], face[t[1]], face[t[2]]]);
      faceOf.push(fi);
    }
  });

  // Rest corner angles for the face springs.
  const P = (i) => [orig[3 * i], orig[3 * i + 1], orig[3 * i + 2]];
  const ang = (p, q, r) => {
    const u = norm0([q[0] - p[0], q[1] - p[1], q[2] - p[2]]);
    const w = norm0([r[0] - p[0], r[1] - p[1], r[2] - p[2]]);
    return f32(Math.acos(clamp(f32(u[0] * w[0] + u[1] * w[1] + u[2] * w[2]), -1, 1)));
  };
  const tris = trisIdx.map((t) => {
    const a = P(t[0]), b = P(t[1]), c = P(t[2]);
    return { v: t, nominal: [ang(a, b, c), ang(b, a, c), ang(c, a, b)] };
  });

  // Original crease kinds, keyed by unordered endpoint pair.
  const creaseKind = new Map();
  cp.edges.forEach((e, i) => creaseKind.set(key(e[0], e[1]), cp.assignment[i]));

  // Each triangle edge, with the triangles that use it and how they wind it.
  const edgeUse = new Map();
  trisIdx.forEach((t, ti) => {
    for (const [a, b, apex] of [[t[0], t[1], t[2]], [t[1], t[2], t[0]], [t[2], t[0], t[1]]]) {
      const k = key(a, b);
      let list = edgeUse.get(k);
      if (!list) { list = []; edgeUse.set(k, list); }
      list.push({ tri: ti, apex, forward: a < b });
    }
  });

  // A fixed edge order, as the Rust build sorts its hash-map keys.
  const edgeKeys = Array.from(edgeUse.keys()).sort((x, y) => x - y);

  const beams = [];
  const creases = [];
  for (const k of edgeKeys) {
    const u = Math.floor(k / KEY_SPAN), v = k % KEY_SPAN;
    const uses = edgeUse.get(k);
    const rest = Math.max(f32(Math.hypot(orig[3 * u] - orig[3 * v], orig[3 * u + 1] - orig[3 * v + 1],
      orig[3 * u + 2] - orig[3 * v + 2])), f32(1e-6));
    const kk = f32(params.axial / rest);
    const d = f32(f32(params.dampingRatio * 2.0) * f32(Math.sqrt(kk)));
    beams.push({ a: u, b: v, rest, k: kk, d });

    if (uses.length !== 2) continue;
    const [fwd, rev] = uses[0].forward ? [uses[0], uses[1]] : [uses[1], uses[0]];
    const kind = creaseKind.get(k);
    let isFold = false, target = 0, stiff = params.panel;
    if (kind === Assignment.Mountain) { isFold = true; target = -PI; stiff = params.crease; }
    else if (kind === Assignment.Valley) { isFold = true; target = PI; stiff = params.crease; }
    creases.push({
      apex0: fwd.apex, apex1: rev.apex, e0: u, e1: v, f0: fwd.tri, f1: rev.tri,
      target, k: f32(f32(stiff) * rest), isFold,
    });
  }

  // Timestep: nine tenths of the critical step of the stiffest bar.
  let maxFreq = 0;
  for (const b of beams) maxFreq = Math.max(maxFreq, f32(Math.sqrt(b.k)));
  maxFreq = Math.max(maxFreq, f32(1e-6));
  const dt = f32(f32(0.9) / f32(TAU * maxFreq));

  return new FoldMesh({ nodes, orig, beams, creases, tris, faceOf, params, dt });
}

function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

// glam normalize_or_zero: zero when the length is zero or not finite.
function norm0(v) {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  const r = 1 / l;
  if (!Number.isFinite(r) || r <= 0) return [0, 0, 0];
  return [v[0] * r, v[1] * r, v[2] * r];
}

export class FoldMesh {
  constructor({ nodes, orig, beams, creases, tris, faceOf, params, dt }) {
    this.nodes = nodes;                         // live positions, xyz per node
    this.orig = orig;                           // flat rest positions
    this.vel = new Float32Array(nodes.length);
    this.beams = beams;
    this.creases = creases;
    this.tris = tris;
    this.faceOf = faceOf;                       // crease-pattern face per triangle
    this.normals = new Float32Array(3 * tris.length);
    for (let i = 0; i < tris.length; i++) this.normals[3 * i + 2] = 1;
    this.theta = new Float32Array(creases.length);
    this.force = new Float32Array(nodes.length);
    this.params = params;
    this.fraction = 0;
    this.dt = dt;
  }

  get nodeCount() { return this.nodes.length / 3; }

  // Set the global fold fraction. Zero is flat, one is fully folded.
  setFraction(fraction) { this.fraction = f32(fraction); }

  // Relax the sheet toward the current targets by `substeps` sub-steps.
  step() {
    for (let s = 0; s < this.params.substeps; s++) this.substep();
  }

  // One sub-step: face normals, then forces, then semi-implicit Euler.
  substep() {
    const P = this.nodes, V = this.vel, N = this.normals, F = this.force, TH = this.theta;
    const tris = this.tris;

    // Face normals from current positions.
    for (let i = 0; i < tris.length; i++) {
      const [a, b, c] = tris[i].v;
      const abx = P[3 * b] - P[3 * a], aby = P[3 * b + 1] - P[3 * a + 1], abz = P[3 * b + 2] - P[3 * a + 2];
      const acx = P[3 * c] - P[3 * a], acy = P[3 * c + 1] - P[3 * a + 1], acz = P[3 * c + 2] - P[3 * a + 2];
      const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const r = 1 / l;
      if (Number.isFinite(r) && r > 0) { N[3 * i] = nx * r; N[3 * i + 1] = ny * r; N[3 * i + 2] = nz * r; }
      else { N[3 * i] = 0; N[3 * i + 1] = 0; N[3 * i + 2] = 0; }
    }

    F.fill(0);

    // Axial springs, damped on the relative velocity of the two ends.
    for (const bm of this.beams) {
      const a = 3 * bm.a, b = 3 * bm.b;
      const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2];
      const len = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 1e-9);
      const s = 1 - bm.rest / len;
      const fx = dx * s * bm.k + (V[b] - V[a]) * bm.d;
      const fy = dy * s * bm.k + (V[b + 1] - V[a + 1]) * bm.d;
      const fz = dz * s * bm.k + (V[b + 2] - V[a + 2]) * bm.d;
      F[a] += fx; F[a + 1] += fy; F[a + 2] += fz;
      F[b] -= fx; F[b + 1] -= fy; F[b + 2] -= fz;
    }

    // Crease hinges, with the fold angle unwrapped against the last step.
    const frac = this.fraction;
    const cs = this.creases;
    for (let ci = 0; ci < cs.length; ci++) {
      const cr = cs[ci];
      const f0 = 3 * cr.f0, f1 = 3 * cr.f1;
      const n0x = N[f0], n0y = N[f0 + 1], n0z = N[f0 + 2];
      const n1x = N[f1], n1y = N[f1 + 1], n1z = N[f1 + 2];
      const e0 = 3 * cr.e0, e1 = 3 * cr.e1;
      const cvx = P[e1] - P[e0], cvy = P[e1 + 1] - P[e0 + 1], cvz = P[e1 + 2] - P[e0 + 2];
      const clen = Math.sqrt(cvx * cvx + cvy * cvy + cvz * cvz);
      if (clen < 1e-6) continue;
      const cux = cvx / clen, cuy = cvy / clen, cuz = cvz / clen;

      const x = clamp(n0x * n1x + n0y * n1y + n0z * n1z, -1, 1);
      // (n0 x cu) . n1
      const y = (n0y * cuz - n0z * cuy) * n1x + (n0z * cux - n0x * cuz) * n1y + (n0x * cuy - n0y * cux) * n1z;
      const raw = Math.atan2(y, x);
      let diff = raw - TH[ci];
      if (diff < -5.0) diff += TAU;
      else if (diff > 5.0) diff -= TAU;
      TH[ci] = TH[ci] + diff;
      const theta = TH[ci];

      // Moment arms: the distance from each apex to the crease line.
      const a0 = 3 * cr.apex0, a1 = 3 * cr.apex1;
      const v0x = P[a0] - P[e0], v0y = P[a0 + 1] - P[e0 + 1], v0z = P[a0 + 2] - P[e0 + 2];
      const v1x = P[a1] - P[e0], v1y = P[a1 + 1] - P[e0 + 1], v1z = P[a1 + 2] - P[e0 + 2];
      const proj0 = cux * v0x + cuy * v0y + cuz * v0z;
      const proj1 = cux * v1x + cuy * v1y + cuz * v1z;
      const h0 = Math.sqrt(Math.max(v0x * v0x + v0y * v0y + v0z * v0z - proj0 * proj0, 0));
      const h1 = Math.sqrt(Math.max(v1x * v1x + v1y * v1y + v1z * v1z - proj1 * proj1, 0));
      if (h0 < 1e-6 || h1 < 1e-6) continue;
      const coef0 = proj0 / clen, coef1 = proj1 / clen;

      const target = cr.isFold ? cr.target * frac : 0;
      const angF = cr.k * (target - theta);

      F[a0] += n0x * (angF / h0); F[a0 + 1] += n0y * (angF / h0); F[a0 + 2] += n0z * (angF / h0);
      F[a1] += n1x * (angF / h1); F[a1 + 1] += n1y * (angF / h1); F[a1 + 2] += n1z * (angF / h1);
      const w00 = (1 - coef0) / h0, w01 = (1 - coef1) / h1;
      F[e0] -= (n0x * w00 + n1x * w01) * angF;
      F[e0 + 1] -= (n0y * w00 + n1y * w01) * angF;
      F[e0 + 2] -= (n0z * w00 + n1z * w01) * angF;
      const w10 = coef0 / h0, w11 = coef1 / h1;
      F[e1] -= (n0x * w10 + n1x * w11) * angF;
      F[e1 + 1] -= (n0y * w10 + n1y * w11) * angF;
      F[e1 + 2] -= (n0z * w10 + n1z * w11) * angF;
    }

    // Face springs: hold each triangle's corner angles.
    const fk = this.params.face;
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      const nx = N[3 * i], ny = N[3 * i + 1], nz = N[3 * i + 2];
      const A = 3 * t.v[0], B = 3 * t.v[1], C = 3 * t.v[2];
      const abx = P[B] - P[A], aby = P[B + 1] - P[A + 1], abz = P[B + 2] - P[A + 2];
      const acx = P[C] - P[A], acy = P[C + 1] - P[A + 1], acz = P[C + 2] - P[A + 2];
      const bcx = P[C] - P[B], bcy = P[C + 1] - P[B + 1], bcz = P[C + 2] - P[B + 2];
      const lab = Math.sqrt(abx * abx + aby * aby + abz * abz);
      const lac = Math.sqrt(acx * acx + acy * acy + acz * acz);
      const lbc = Math.sqrt(bcx * bcx + bcy * bcy + bcz * bcz);
      if (lab < 1e-7 || lac < 1e-7 || lbc < 1e-7) continue;
      const ux = abx / lab, uy = aby / lab, uz = abz / lab;   // abu
      const wx = acx / lac, wy = acy / lac, wz = acz / lac;   // acu
      const qx = bcx / lbc, qy = bcy / lbc, qz = bcz / lbc;   // bcu
      const an0 = Math.acos(clamp(ux * wx + uy * wy + uz * wz, -1, 1));
      const an1 = Math.acos(clamp(-(ux * qx + uy * qy + uz * qz), -1, 1));
      const an2 = Math.acos(clamp(wx * qx + wy * qy + wz * qz, -1, 1));
      const d0 = (t.nominal[0] - an0) * fk, d1 = (t.nominal[1] - an1) * fk, d2 = (t.nominal[2] - an2) * fk;
      // normal x unit edge, over the edge length
      const abX = (ny * uz - nz * uy) / lab, abY = (nz * ux - nx * uz) / lab, abZ = (nx * uy - ny * ux) / lab;
      const acX = (ny * wz - nz * wy) / lac, acY = (nz * wx - nx * wz) / lac, acZ = (nx * wy - ny * wx) / lac;
      const bcX = (ny * qz - nz * qy) / lbc, bcY = (nz * qx - nx * qz) / lbc, bcZ = (nx * qy - ny * qx) / lbc;
      F[A] += acX * d2 - abX * d1 - (acX - abX) * d0;
      F[A + 1] += acY * d2 - abY * d1 - (acY - abY) * d0;
      F[A + 2] += acZ * d2 - abZ * d1 - (acZ - abZ) * d0;
      F[B] += (abX + bcX) * d1 - abX * d0 - bcX * d2;
      F[B + 1] += (abY + bcY) * d1 - abY * d0 - bcY * d2;
      F[B + 2] += (abZ + bcZ) * d1 - abZ * d0 - bcZ * d2;
      F[C] += (bcX - acX) * d2 + acX * d0 - bcX * d1;
      F[C + 1] += (bcY - acY) * d2 + acY * d0 - bcY * d1;
      F[C + 2] += (bcZ - acZ) * d2 + acZ * d0 - bcZ * d1;
    }

    // Semi-implicit Euler: velocity from force, then position. Mass is one.
    const dt = this.dt;
    for (let i = 0; i < P.length; i++) {
      V[i] += F[i] * dt;
      P[i] += V[i] * dt;
    }
  }

  // The largest crease-angle error against the current targets, in radians.
  maxResidual() {
    let worst = 0;
    this.creases.forEach((cr, ci) => {
      if (!cr.isFold) return;
      worst = Math.max(worst, Math.abs(this.theta[ci] - cr.target * this.fraction));
    });
    return worst;
  }

  // Hard-reset the sheet to flat, with the same z nudge as build.
  resetFlat() {
    const n = this.nodeCount;
    for (let i = 0; i < n; i++) {
      this.nodes[3 * i] = this.orig[3 * i];
      this.nodes[3 * i + 1] = this.orig[3 * i + 1];
      this.nodes[3 * i + 2] = flatNoise(i);
    }
    this.vel.fill(0);
    this.theta.fill(0);
  }

  // Move the mesh so its centroid sits at the origin.
  recenter() {
    const n = this.nodeCount;
    if (n === 0) return;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      cx = f32(cx + this.nodes[3 * i]); cy = f32(cy + this.nodes[3 * i + 1]); cz = f32(cz + this.nodes[3 * i + 2]);
    }
    cx = f32(cx / f32(n)); cy = f32(cy / f32(n)); cz = f32(cz / f32(n));
    for (let i = 0; i < n; i++) {
      this.nodes[3 * i] -= cx; this.nodes[3 * i + 1] -= cy; this.nodes[3 * i + 2] -= cz;
    }
  }

  // One node as [x, y, z].
  node(i) { return [this.nodes[3 * i], this.nodes[3 * i + 1], this.nodes[3 * i + 2]]; }
}
