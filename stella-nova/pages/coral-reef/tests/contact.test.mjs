// ============================================================================
//  CORAL REEF  ·  tests/contact.test.mjs  ·  where two colonies touch
// ----------------------------------------------------------------------------
//    node pages/coral-reef/tests/contact.test.mjs [--quick]
//  It exits with code 1 when a check fails. No browser.
//  The user said: "the fused region where two corals intersect often looks
//  like it's covered in mesh errors considerably". Two colonies grow into
//  contact on a flat rock (same species and two species). Each fine mesh
//  comes from world/corals.js meshFine with the chunk colony list (the
//  contact guests of coral-sdf.js fuse), as the page makes it. Checks:
//    inside ...... no face of colony A in the field of colony B by more
//                  than a cell, and none by more than half a cell that is
//                  not under the fused surface (and the other way)
//    polyps ...... no polyp of A in the cones of B
//    closed ...... each fine mesh has no open edge (the walls close it)
//    z-fight ..... no visible face of A (over the rock, not in B, not a
//                  wall inside the fused surface) on a visible face of B
//                  that looks the same way (< 0.25 mm apart): the area
//    normals ..... at the seam each normal is the gradient of the fused
//                  surface U (99% under 5 deg), and where the two visible
//                  meshes meet (vertices < 0.75 cell apart, one sheet) the
//                  angle of the two normals less the turn of the seen
//                  surface between them (its gradient with the mesher
//                  step; old: the union of A and B) is under 10 deg (95%)
//    coarse ...... the coarse meshes of two species (meshCoarse): no face
//                  of A in the coarse field of B
//    rock ........ (the Coral Species base) every colony reaches into the
//                  rock (no gap under the root); no polyp in the rock
//  Each line gives the old mesh (no contact term, no foot) as "before".
// ============================================================================
import { createReef, colonyInfo, packParticles, QUALITY, SPECIES_IDS } from '../reef.js';
import { createCoralMesher, SHAPES } from '../coral-sdf.js';
import { fineMesher, meshFine, coarseMesher } from '../world/corals.js';
import { meshStats } from '../../../lib/dla-sdf.js';
import { createBase, PLOT_R } from '../../coral-species/base.js';
import { sizeFor } from '../../coral-species/species.js';

const QUICK = process.argv.includes('--quick');
let fails = 0, passes = 0;
function ok(cond, name, info = '') {
  if (cond) { passes++; console.log(`ok   ${name}${info ? '  ' + info : ''}`); }
  else { fails++; console.log(`FAIL ${name}${info ? '  ' + info : ''}`); }
}
const f1 = v => (+v).toFixed(1), f2 = v => (+v).toFixed(2);

const flat = {
  sdf: (x, y) => y, normal: () => [0, 1, 0], radius: 30, sand: { heightAt: () => -50 },
  bounds: { min: [-30, -3, -30], max: [30, 8, 30] }, sampleSurface: () => [], features: [],
};
const site = (x, z) => ({ p: [x, 0, z], n: [0, 1, 0], exposure: 1, overhang: false });

function grow(a, b, gap, cap) {
  const R = createReef({ rock: flat, seed: 33, quality: 'desktop', env: { strength: 0 } });
  R.reset(33);
  R.addColony(a, site(-gap / 2, 0), { size: 2.6, cap });
  R.addColony(b, site(gap / 2, 0), { size: 2.6, cap });
  R.growAll(Infinity, 3e6);
  const bridges = [];
  for (const [g, j] of R.bridges) bridges.push(g, j);
  return { R, cols: R.colonies.map(colonyInfo), particles: packParticles(R, 0, R.count), bridges: new Int32Array(bridges), Q: Object.assign({}, QUALITY[R.quality] || QUALITY.mid, { fine: R.fine, polyps: 1 }) };
}

// the meshed field of colony c (its fine mesher, as meshFine), at world p
function fieldOf(X, c, fused) {
  const { M } = fineMesher(c, X.particles, X.bridges, X.Q, fused ? X.cols : null);
  const F = [...M.fields.values()][0], b = c.base;
  return { cell: F.cell, at: (x, y, z) => M.contactAt(F, x - b[0], y - b[1], z - b[2]) };
}

// triangles of a mesh (world): centroids, normals, areas
function tris(m) {
  const P = m.positions, I = m.indices, out = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz); if (!(l > 0)) continue;
    nx /= l; ny /= l; nz /= l;
    out.push({ a: [P[a], P[a + 1], P[a + 2]], b: [P[b], P[b + 1], P[b + 2]], c: [P[c], P[c + 1], P[c + 2]], n: [nx, ny, nz], area: l / 2,
      x: (P[a] + P[b] + P[c]) / 3, y: (P[a + 1] + P[b + 1] + P[c + 1]) / 3, z: (P[a + 2] + P[b + 2] + P[c + 2]) / 3 });
  }
  return out;
}
function grid(list, h) {
  const G = new Map(), key = (i, j, k) => `${i},${j},${k}`;
  for (const t of list) { const k = key(Math.floor(t.x / h), Math.floor(t.y / h), Math.floor(t.z / h)); const a = G.get(k); if (a) a.push(t); else G.set(k, [t]); }
  return (x, y, z, f) => {
    const i = Math.floor(x / h), j = Math.floor(y / h), k = Math.floor(z / h);
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const a = G.get(key(i + dx, j + dy, k + dz)); if (a) for (const t of a) f(t); }
  };
}
// p strictly inside triangle t (barycentric margin m), projected on its plane
function inTri(p, t, m = 0.02) {
  const v0 = [t.b[0] - t.a[0], t.b[1] - t.a[1], t.b[2] - t.a[2]], v1 = [t.c[0] - t.a[0], t.c[1] - t.a[1], t.c[2] - t.a[2]], v2 = [p[0] - t.a[0], p[1] - t.a[1], p[2] - t.a[2]];
  const d = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const d00 = d(v0, v0), d01 = d(v0, v1), d11 = d(v1, v1), d20 = d(v2, v0), d21 = d(v2, v1), den = d00 * d11 - d01 * d01;
  if (!(Math.abs(den) > 0)) return false;
  const v = (d11 * d20 - d01 * d21) / den, w = (d00 * d21 - d01 * d20) / den;
  return v > m && w > m && 1 - v - w > m;
}

// The numbers of one grown pair X, colony A against B and B against A:
// fused (meshFine with the colony list, as the page) or not (the old mesh).
function measure(X, fused) {
  const mesh = c => meshFine(c, X.particles, X.bridges, X.Q, fused ? X.cols : null);
  const [cA, cB] = X.cols, ms = [mesh(cA), mesh(cB)];
  const own = [fieldOf(X, cA, fused), fieldOf(X, cB, fused)];
  const raw = [fieldOf(X, cA, false), fieldOf(X, cB, false)];
  const eps = 0.5 * Math.max(own[0].cell, own[1].cell);
  const res = { inside: 0, deep: 0, polyps: 0, polypN: 0, open: 0, nonManifold: 0, fight: 0, angles: [], dev: [], tris: 0 };
  const visible = [[], []];
  for (const s of [0, 1]) {
    const m = ms[s], o = 1 - s;
    const st = meshStats([m]);
    res.open += st.boundaryEdges; res.nonManifold += st.nonManifold;
    for (const T of tris(m)) {
      res.tris++;
      const fo = own[o].at(T.x, T.y, T.z).f;
      // visible: over the rock (y > 0), not in the other colony, not a
      // wall inside the fused U
      const u = own[s].at(T.x, T.y, T.z).u;
      // inside: in the other colony by more than half a cell and not under
      // the fused surface (a wall face of surface nets can lean half a cell)
      if (fo < -eps && !(u < -eps)) res.inside++;
      if (fo < -2 * eps) res.deep++;
      if (T.y > 0 && fo > -eps && !(u < -eps)) visible[s].push(T);
    }
    const P = m.polyps;
    for (let p = 0; p < P.length; p += 8) { res.polypN++; if (raw[o].at(P[p], P[p + 1], P[p + 2]).d < 0) res.polyps++; }
  }
  // z-fight: a visible face of A on a visible face of B, same facing
  const zeps = 2.5e-4, near = grid(visible[1], 4 * Math.max(own[0].cell, own[1].cell));
  for (const T of visible[0]) {
    let hit = false;
    const P = [T.x, T.y, T.z];
    near(T.x, T.y, T.z, U => {
      if (hit || T.n[0] * U.n[0] + T.n[1] * U.n[1] + T.n[2] * U.n[2] < 0.95) return;
      const dz = (P[0] - U.a[0]) * U.n[0] + (P[1] - U.a[1]) * U.n[1] + (P[2] - U.a[2]) * U.n[2];
      if (Math.abs(dz) < zeps && inTri(P, U)) hit = true;
    });
    if (hit) res.fight += T.area;
  }
  // normals at the seam: the visible vertices of A and B that meet (under
  // 0.75 cell apart, the midpoint on the surface: one sheet, not the two
  // sides of a narrow gap): the angle of the two normals. Fused, the seam
  // vertices (|w| under a cell, outer: U is the active term) also give
  // the angle of the normal to the gradient of U there (dev).
  const vtx = (m, s) => {
    const out = [], P = m.positions, N = m.normals;
    for (let v = 0; v < P.length; v += 3) {
      const x = P[v], y = P[v + 1], z = P[v + 2];
      if (y <= 0 || own[1 - s].at(x, y, z).f < -eps) continue;
      const me = own[s].at(x, y, z);
      if (fused && !(Math.abs(me.f - me.u) < 1e-9 && Math.abs(me.w) < 2 * eps)) continue;
      out.push({ x, y, z, s, n: [N[v], N[v + 1], N[v + 2]] });
    }
    return out;
  };
  const r = 0.75 * Math.min(own[0].cell, own[1].cell);
  const vA = vtx(ms[0], 0), vB = vtx(ms[1], 1), gB = grid(vB, Math.max(r, 1e-3));
  const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI;
  // the surface a viewer sees: the fused U, or (old) the union of the two
  const surf = (x, y, z, s = 0) => fused ? own[s].at(x, y, z).u : Math.min(own[0].at(x, y, z).d, own[1].at(x, y, z).d);
  // the gradient with the step of the mesher (half a cell of the field of
  // the vertex)
  const gradS = (p, s) => {
    const h = 0.5 * own[s].cell, S = (x, y, z) => surf(x, y, z, s);
    const g = [S(p.x + h, p.y, p.z) - S(p.x - h, p.y, p.z), S(p.x, p.y + h, p.z) - S(p.x, p.y - h, p.z), S(p.x, p.y, p.z + h) - S(p.x, p.y, p.z - h)];
    const l = Math.hypot(...g) || 1; return g.map(v => v / l);
  };
  for (const p of vA) {
    let best = null, bd = r * r;
    gB(p.x, p.y, p.z, q => {
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (q.z - p.z) ** 2;
      if (d < bd && Math.abs(surf((p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2)) < 0.25 * own[0].cell) { bd = d; best = q; }
    });
    if (!best) continue;
    // the excess: the angle of the two vertex normals less the turn of the
    // seen surface itself between the two points (a fillet turns fast)
    res.angles.push(ang(p.n, best.n) - ang(gradS(p, 0), gradS(best, 1)));
  }
  if (fused) for (const p of vA.concat(vB)) {
    const o = own[p.s], h = 0.5 * o.cell, u = (x, y, z) => o.at(x, y, z).u;
    const g = [u(p.x + h, p.y, p.z) - u(p.x - h, p.y, p.z), u(p.x, p.y + h, p.z) - u(p.x, p.y - h, p.z), u(p.x, p.y, p.z + h) - u(p.x, p.y, p.z - h)];
    const l = Math.hypot(...g); if (l > 0) res.dev.push(ang(p.n, g.map(v => v / l)));
  }
  const pct = (a, q) => { a.sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : 0; };
  res.p95 = pct(res.angles, 0.95); res.d99 = pct(res.dev, 0.99); res.dmax = pct(res.dev, 1);
  return res;
}

const cap = QUICK ? 700 : 1500;
const PAIRS = [['staghorn', 'staghorn'], ['finger', 'finger'], ['pillar', 'finger'], ['boulder', 'boulder'], ['pillar', 'boulder'], ['boulder', 'finger']];
const sums = { before: { inside: 0, polyps: 0, fight: 0 }, after: { inside: 0, polyps: 0, fight: 0 } };
const t0 = performance.now();
for (const [a, b] of PAIRS) {
  const X = grow(a, b, 0.6, cap), t = [...X.R.contacts.values()][0];
  const B0 = measure(X, false), A1 = measure(X, true);
  for (const [k, v] of [['before', B0], ['after', A1]]) { sums[k].inside += v.inside + v.deep; sums[k].polyps += v.polyps; sums[k].fight += v.fight; }
  const tag = `${a} + ${b} (${t ? `${t.kind} x${t.n}` : 'no contact'})`;
  ok(A1.inside === 0 && A1.deep === 0, `inside: ${tag}: no face in the other colony`, `faces in the other colony (half a cell, seen / a cell, any): before ${B0.inside} / ${B0.deep} of ${B0.tris}, now ${A1.inside} / ${A1.deep} of ${A1.tris}`);
  ok(A1.polyps === 0, `polyps: ${tag}: no polyp in the other colony`, `before ${B0.polyps} of ${B0.polypN}, now ${A1.polyps} of ${A1.polypN}`);
  ok(A1.open === 0, `closed: ${tag}: no open edge`, `${A1.open} open (before ${B0.open}); edges of 3+ faces (surface nets saddles): ${A1.nonManifold} (before ${B0.nonManifold})`);
  ok(A1.fight < 1e-4, `z-fight: ${tag}: no coplanar visible face pair`, `before ${f2(B0.fight * 1e4)} cm^2, now ${f2(A1.fight * 1e4)} cm^2`);
  ok(!A1.dev.length || A1.d99 < 5, `normals: ${tag}: seam normals are the gradient of the fused surface`, `${A1.dev.length} seam vertices, angle to grad U: 99% ${f1(A1.d99)} deg, max ${f1(A1.dmax)} deg`);
  ok(!A1.angles.length || A1.p95 < 10, `normals: ${tag}: no hard seam where the meshes meet`, `95% angle of the two normals over the turn of the seen surface: before ${f1(B0.p95)} deg (${B0.angles.length} pairs), now ${f1(A1.p95)} deg (${A1.angles.length} pairs)`);
  // coarse: two species, the coarse field of B at the faces of A
  if (a !== b) {
    const cnt = fuse => {
      const M = coarseMesher(X.cols, X.particles, X.bridges, X.Q, fuse);
      const FA = M.fields.get(a + '|1'), FB = M.fields.get(b + '|1'), eps = 0.5 * Math.max(FA.cell, FB.cell);
      let inside = 0, nt = 0;
      for (const m of M.meshAll(1)) { const G = m.sp === a ? FB : FA; for (const T of tris(m)) { nt++; if (M.contactAt(G, T.x, T.y, T.z).f < -eps) inside++; } }
      return [inside, nt];
    };
    const c0 = cnt(false), c1 = cnt(true);
    ok(c1[0] === 0, `coarse: ${tag}: no coarse face in the other species`, `before ${c0[0]} of ${c0[1]}, now ${c1[0]} of ${c1[1]}`);
  }
}
console.log(`sum before: inside ${sums.before.inside}, polyps ${sums.before.polyps}, z-fight ${f2(sums.before.fight * 1e4)} cm^2; now: inside ${sums.after.inside}, polyps ${sums.after.polyps}, z-fight ${f2(sums.after.fight * 1e4)} cm^2  (${((performance.now() - t0) / 1000).toFixed(1)} s)`);

// ── the Coral Species base: the root on the rock ────────────────────────────
// before: no foot, no rock test for the polyps (the old mesh)
{
  const B = createBase({ seed: 1, mesh: false });
  const ids = QUICK ? ['staghorn', 'fan', 'encrusting', 'porites'] : ['staghorn', 'fan', 'table', 'boulder', 'finger', 'encrusting', 'porites', 'mushroom', 'leather', 'seawhip'];
  const st = { before: { gaps: 0, polIn: 0, polN: 0, low: [] }, after: { gaps: 0, polIn: 0, polN: 0, low: [] } };
  for (const id of ids.filter(i => SPECIES_IDS.includes(i))) {
    const R = createReef({ rock: B, seed: 5, quality: 'desktop', radius: PLOT_R, rate: 0, budget: { particles: 20000 } });
    const c = R.growColony(B.site, id, { size: sizeFor(id), seed: 5, rate: 0 });
    R.setRate(1e9);
    for (let t = 0; !R.done() && t < 4e5; t += 16) R.step(16, 200, t);
    for (const k of ['before', 'after']) {
      const now = k === 'after', S = st[k];
      const M = createCoralMesher({ fine: R.fine, radius: PLOT_R, polyps: 1, lod: false, solid: now ? B.sdf : null });
      M.addColony(now ? colonyInfo(c) : Object.assign(colonyInfo(c), { foot: 0 }));
      for (let g = 0; g < R.count; g++) M.add(g, R.parent[g], R.px[g], R.py[g], R.pz[g], R.col[g]);
      for (const [g, j] of R.bridges) M.bridge(g, j);
      let mn = Infinity;
      for (const m of M.meshAll()) {
        const P = m.positions;
        for (let v = 0; v < P.length; v += 3) mn = Math.min(mn, B.sdf(P[v], P[v + 1], P[v + 2]));
        for (let p = 0; p < m.polyps.length; p += 8) { S.polN++; if (B.sdf(m.polyps[p], m.polyps[p + 1], m.polyps[p + 2]) < SHAPES[id].polyp.size) S.polIn++; }
      }
      if (mn > 0) S.gaps++;
      S.low.push(`${id} ${(mn * 100).toFixed(1)}`);
    }
  }
  ok(st.after.gaps === 0, 'rock: every colony reaches into the rock (no gap under the root)', `floating colonies: before ${st.before.gaps}, now ${st.after.gaps}; lowest vertex over the rock (cm) before: ${st.before.low.join(', ')}; now: ${st.after.low.join(', ')}`);
  ok(st.after.polIn === 0, 'rock: no polyp in the rock', `polyps within their size of the rock: before ${st.before.polIn} of ${st.before.polN}, now ${st.after.polIn} of ${st.after.polN}`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
