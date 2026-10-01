// solver.js -- the signed dihedral angle and its gradient.
//
// Port of origami src/sim/solver.rs, after Ghassaei's explicit compliant
// bar-and-hinge model. The fold angle across a crease is the signed dihedral
// angle between the two triangles that share it. Its gradient at the four
// vertices is the discrete-shell hinge gradient. The four vectors sum to zero,
// which is force balance. tests.mjs checks the sum and a finite difference.
//
// The live simulator in sim.js inlines the same hinge force for speed, as the
// Rust substep does. These two functions stay as the checked reference.
//
// grep map:
//   dihedralAngle -- the signed fold angle across a crease
//   dihedralGrad  -- its gradient at the four vertices, summing to zero
//   cot           -- the cotangent of a triangle corner

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.sqrt(dot(a, a));

// The signed dihedral angle across edge (v0, v1), between the triangle with apex
// v2 and the triangle with apex v3. Zero when coplanar.
export function dihedralAngle(v0, v1, v2, v3) {
  const e = sub(v1, v0);
  const n0 = crs(sub(v1, v0), sub(v2, v0));
  const n1 = crs(sub(v3, v0), sub(v1, v0));
  const el = Math.max(len(e), 1e-20);
  const s = dot(crs(n0, n1), e) / el;
  const c = dot(n0, n1);
  return Math.atan2(s, c);
}

// The cotangent of the corner at p between the edges to q and r.
function cot(p, q, r) {
  const u = sub(q, p), w = sub(r, p);
  return dot(u, w) / Math.max(len(crs(u, w)), 1e-20);
}

// The gradient of dihedralAngle at [v0, v1, v2, v3].
export function dihedralGrad(v0, v1, v2, v3) {
  const e = sub(v1, v0);
  const el = Math.max(len(e), 1e-20);
  const n0 = crs(sub(v1, v0), sub(v2, v0));
  const n1 = crs(sub(v3, v0), sub(v1, v0));
  const n0n = Math.max(dot(n0, n0), 1e-20);
  const n1n = Math.max(dot(n1, n1), 1e-20);
  const g2 = scl(n0, el / n0n);
  const g3 = scl(n1, el / n1n);
  const a0 = cot(v0, v1, v2), a1 = cot(v1, v0, v2);
  const b0 = cot(v0, v1, v3), b1 = cot(v1, v0, v3);
  const sign = (x) => (x > 0 || Object.is(x, 0) ? 1 : -1); // f32::signum: +0 is 1, -0 is -1
  const sa = Math.max(Math.abs(a0 + a1), 1e-20) * sign(a0 + a1);
  const sb = Math.max(Math.abs(b0 + b1), 1e-20) * sign(b0 + b1);
  const w0 = a1 / sa, w1 = a0 / sa;
  const z0 = b1 / sb, z1 = b0 / sb;
  const g0 = sub(scl(g2, -w0), scl(g3, z0));
  const g1 = sub(scl(g2, -w1), scl(g3, z1));
  // The apex-normal form gives the negative gradient for this sign convention.
  return [scl(g0, -1), scl(g1, -1), scl(g2, -1), scl(g3, -1)];
}
