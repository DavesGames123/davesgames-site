// ============================================================================
//  CORAL REEF  ·  SEAMS tests (node, pure):  node tests/seams.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "we should seamlessly render tiles at a
//  distance". Two chunks of different LOD (world/mesh.js meshChunk, cells
//  0.5 m and 1 m: the desktop L1 and L2) meet on a border. Rays go down
//  and across that border (vertical and 45 degrees). A ray is a crack ray
//  when it passes more than TOL under the true surface (a march of the
//  field: the rock SDF and the sand height) with no hit on the meshes.
//    skirts .... with the skirts (addSkirt) no ray is a crack ray
//    repro ..... with the skirts taken off, some rays are crack rays (the
//                test sees the crack)
//    same LOD .. two chunks of one LOD: no crack ray
// ============================================================================
import { createWorld, SDF_SCALE } from '../world/field.js';
import { meshChunk, meshRock, meshSand, CH } from '../world/mesh.js';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${name}${info !== '' ? ' ' + info : ''}`); } };
const TOL = 1.0;

// world triangles of a chunk mesh in the band |x - X| < 8
function tris(m, ci, cj, X, out) {
  if (!m) return;
  const cx = (ci + 0.5) * CH, cz = (cj + 0.5) * CH, P = m.positions, I = m.indices;
  for (let t = 0; t < I.length; t += 3) {
    const v = [0, 1, 2].map(e => [P[I[t + e] * 3] + cx, P[I[t + e] * 3 + 1], P[I[t + e] * 3 + 2] + cz]);
    if (Math.min(...v.map(p => Math.abs(p[0] - X))) > 8) continue;
    out.push(v);
  }
}
function hit(o, d, T) {
  let best = Infinity;
  for (const [a, b, c] of T) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2]; if (Math.abs(det) < 1e-12) continue;
    const s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]], u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det; if (u < -1e-6 || u > 1 + 1e-6) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det; if (v < -1e-6 || u + v > 1 + 1e-6) continue;
    const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det; if (t > 1e-4 && t < best) best = t;
  }
  return best;
}
const solid = (W, x, y, z) => Math.min(W.sdf(x, y, z) / SDF_SCALE, y - W.sandAt(x, z));
function march(W, o, d, tMax) { let prev = solid(W, ...o); for (let t = 0.05; t < tMax; t += 0.05) { const f = solid(W, o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t); if (f < 0 && prev >= 0) return t; prev = f; } return Infinity; }

function cracks(W, A, B, X, T) {
  let n = 0, rays = 0;
  for (let z = A[1] * CH + 2; z < A[1] * CH + CH - 2; z += 0.4) for (const dx of [-0.6, -0.2, 0.2, 0.6]) for (const d of [[0, -1, 0], [0.7071, -0.7071, 0], [-0.7071, -0.7071, 0], [0.9397, -0.342, 0], [-0.9397, -0.342, 0]]) {
    // the ray reaches the sand height at (x0, z), next to the border
    const x0 = X + dx, L = 20, o = [x0 - d[0] * L, W.sandAt(x0, z) - d[1] * L, z];
    if (solid(W, ...o) < 1) continue;                // the eye is in the water
    const tr = march(W, o, d, 80); if (!isFinite(tr)) continue;
    const p = [o[0] + d[0] * tr, o[1] + d[1] * tr, o[2] + d[2] * tr];
    if (Math.abs(p[0] - X) > 2) continue;               // the true hit is at the border
    // a thin crag or a ledge under 1 m thick is a matter of the mesh cell,
    // not of the seam: only rays that hit thick ground count
    if (solid(W, p[0] + d[0], p[1] + d[1], p[2] + d[2]) > -0.3) continue;
    rays++;
    const tm = hit(o, d, T);
    if (!(tm <= tr + TOL)) n++;
  }
  return { n, rays };
}

const W = createWorld({ seed: 2, fine: 0.5 });
const strip = (m) => { if (!m || !m.skirt) return m; const nv = m.positions.length / 3 - m.skirt; const I = m.indices, out = []; for (let t = 0; t < I.length; t += 3) if (I[t] < nv && I[t + 1] < nv && I[t + 2] < nv) out.push(I[t], I[t + 1], I[t + 2]); return Object.assign({}, m, { indices: Uint32Array.from(out) }); };
let tested = 0;
for (const [ci, cj] of [[3, 11], [9, 9], [-4, 2], [12, -7]]) {
  const A = [ci, cj], B = [ci + 1, cj], X = B[0] * CH;
  const a = meshChunk(W, ...A, 1, 0.25), b = meshChunk(W, ...B, 2, 0.25);
  if (!a.rock && !b.rock && !a.sand) continue;
  tested++;
  const T = []; for (const [m, c] of [[a.rock, A], [a.sand, A], [b.rock, B], [b.sand, B]]) tris(m, c[0], c[1], X, T);
  const r = cracks(W, A, B, X, T);
  ok(r.n === 0 && r.rays > 200, `skirts: chunks ${A} (L1) and ${B} (L2): no crack ray`, `${r.n} of ${r.rays}`);
  const T0 = []; for (const [m, c] of [[strip(a.rock), A], [strip(a.sand), A], [strip(b.rock), B], [strip(b.sand), B]]) tris(m, c[0], c[1], X, T0);
  const r0 = cracks(W, A, B, X, T0);
  console.log(`     ${A}|${B}: crack rays ${r0.n} without skirts, ${r.n} with, of ${r.rays}; skirt tris ${(a.rock ? a.rock.skirtTris || 0 : 0) + (b.rock ? b.rock.skirtTris || 0 : 0)}`);
  ok(a.rock ? a.rock.skirt > 0 : true, `skirts: chunk ${A} has a rock skirt`);
  globalThis.__r0 = (globalThis.__r0 || 0) + r0.n;
  // one LOD
  const b1 = meshChunk(W, ...B, 1, 0.25), T1 = []; for (const [m, c] of [[a.rock, A], [a.sand, A], [b1.rock, B], [b1.sand, B]]) tris(m, c[0], c[1], X, T1);
  const r1 = cracks(W, A, B, X, T1);
  ok(r1.n === 0, `same LOD: chunks ${A} and ${B} (L1): no crack ray`, `${r1.n} of ${r1.rays}`);
}
ok(tested >= 2, 'at least two chunk pairs have ground at the border', tested);
ok((globalThis.__r0 || 0) > 0, 'repro: with no skirts some rays go through the LOD crack', globalThis.__r0);
console.log(`seams: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
