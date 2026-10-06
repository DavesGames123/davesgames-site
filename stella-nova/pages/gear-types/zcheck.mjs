// ============================================================================
//  GEAR TYPES  ·  zcheck.mjs — node stella-nova/pages/gear-types/zcheck.mjs
// ----------------------------------------------------------------------------
//  A z-fighting audit with no browser. It builds every pair with the real
//  scene.js, poses it at three input angles, and looks for two triangles
//  in one plane that face the same way and overlap. It includes two
//  triangles of one merged mesh. TOL (mm, default 0.29) is the largest
//  plane distance that counts, so faces less than 0.3 mm apart also fail.
//  Hidden meshes and glass (the pitch cones, no depth write) are skipped.
//
//    node zcheck.mjs [unit]        TOL=0.05 node zcheck.mjs
//
//  'three' resolves to the vendored r160 through a loader hook; the kit's
//  canvas textures get a stub document.
// ============================================================================
import { register } from 'node:module';
const V = new URL('../../vendor/three@0.160.0/', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify(V)} + 'build/three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: ${JSON.stringify(V)} + 'examples/jsm/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`));
const ctx2d = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
globalThis.document = { createElement: () => ({ getContext: () => ctx2d, width: 0, height: 0 }) };
const THREE = await import('three');
const { createBuild } = await import(new URL('kit.js', import.meta.url).href);
const { build } = await import(new URL('scene.js', import.meta.url).href);
const { UNITS } = await import(new URL('mech.js', import.meta.url).href);
let total = 0;
const ids = process.argv[2] ? [process.argv[2]] : UNITS.map(u => u.id);
for (const id of ids) {
  const B = createBuild(), sc = build(B, id);
  let bad = 0, nan = 0;
  for (const th of [0, 0.7, 2.1]) {
    const Q = sc.pose(th);
    B.applyExplode(0);
    B.root.updateMatrixWorld(true);
    const tris = [];
    const meshes = [];
    B.root.traverseVisible(o => { if (o.isMesh && !(o.material.transparent && o.material.userData.op)) meshes.push(o); });
    meshes.forEach((m, mi) => {
      const pos = m.geometry.attributes.position, idx = m.geometry.index, v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      const n = idx ? idx.count : pos.count;
      for (let i = 0; i < n; i += 3) {
        for (let k = 0; k < 3; k++) { v[k].fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(m.matrixWorld); if (!isFinite(v[k].x)) nan++; }
        const e1 = v[1].clone().sub(v[0]), e2 = v[2].clone().sub(v[0]), nn = e1.cross(e2), a = nn.length();
        if (a < 1e-3) continue;
        nn.divideScalar(a);
        tris.push({ mi, part: m.userData.part, n: nn, d: nn.dot(v[0]), p: v.map(q => q.clone()), area: a / 2 });
      }
    });
    // bucket by plane
    const TOL = +(process.env.TOL || 0.29), map = new Map(), key = (n, d) => `${Math.round(n.x * 50)},${Math.round(n.y * 50)},${Math.round(n.z * 50)}`;
    for (const t of tris) { const k = key(t.n, t.d); if (!map.has(k)) map.set(k, []); map.get(k).push(t); }
    const hits = new Map();
    for (const list of map.values()) {
      if (list.length < 2) continue;
      list.sort((p, q) => p.d - q.d);
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length && list[j].d - list[i].d <= TOL; j++) {
        const a = list[i], b = list[j];

        if (Math.abs(a.d - b.d) > TOL || a.n.dot(b.n) < 0.9995) continue;
        // the two planes may cross (cone facets through one apex): the corners
        // of each must lie within 0.05 mm of the other plane
        if (b.p.some(q => Math.abs(a.n.dot(q) - a.d) > TOL) || a.p.some(q => Math.abs(b.n.dot(q) - b.d) > TOL)) continue;
        if (overlap(a, b)) { const k = `${a.part}|${b.part}`; hits.set(k, (hits.get(k) || 0) + 1); }
      }
    }
    for (const [k, c] of hits) { bad += c; console.log(`  ${id} th=${th}: coplanar overlap ${k} x${c}`); }
  }
  console.log(`${id}: meshes ok, NaN vertices ${nan}, coplanar overlapping triangle pairs ${bad}`);
  total += bad + nan;
}
console.log(total ? `FAIL: ${total} problems (TOL ${process.env.TOL || 0.29} mm)` : `zcheck passed (TOL ${process.env.TOL || 0.29} mm)`);
process.exitCode = total ? 1 : 0;
// 2D overlap of two coplanar triangles (strict interior, 0.05 mm margin)
function overlap(a, b) {
  const n = a.n, u = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const e1 = u.clone().cross(n).normalize(), e2 = n.clone().cross(e1);
  const P = t => t.p.map(q => [q.dot(e1), q.dot(e2)]);
  const A = P(a), Bq = P(b);
  const axes = [];
  for (const T of [A, Bq]) for (let i = 0; i < 3; i++) { const p = T[i], q = T[(i + 1) % 3]; axes.push([q[1] - p[1], p[0] - q[0]]); }
  for (const ax of axes) {
    const l = Math.hypot(...ax); if (l < 1e-9) continue;
    const pr = T => T.map(p => (p[0] * ax[0] + p[1] * ax[1]) / l);
    const a1 = pr(A), b1 = pr(Bq);
    if (Math.max(...a1) <= Math.min(...b1) + 0.05 || Math.max(...b1) <= Math.min(...a1) + 0.05) return false;
  }
  return true;
}
