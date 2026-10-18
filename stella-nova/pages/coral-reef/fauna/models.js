// ============================================================================
//  CORAL REEF  ·  fauna/models.js  ·  a species to its meshes (DOM-free)
// ----------------------------------------------------------------------------
//  genModel(sp) runs the generator of a procedural or generated species
//  (fauna/gen/*.js) and gives { lod0, lod1 } builder meshes. lod1 is the
//  same generator at a lower ring count where the generator has one, or
//  lod0 with every second triangle of the thin parts dropped.
//  The scans load in fauna/assets.js (they need fetch).
//
//    GENERATORS ....... name -> fn(params) (the model.gen of species.js)
//    genModel(sp, lowRes?) -> { lod0, lod1, tris0, tris1 }
//    scanAnim(mesh, sp) -> Float32Array the animation channels of a scan
//                       (s along z, w from the distance off the body axis)
//
//  grep -n targets: "export const GENERATORS", "export function genModel",
//  "export function scanAnim"
// ============================================================================
import { fishMesh, rayMesh, turtleMesh } from './gen/fish.js';
import { cephMesh } from './gen/ceph.js';
import { medusaMesh, ctenoMesh, siphoMesh } from './gen/jelly.js';
import { starMesh, brittleMesh, urchinMesh, cucumberMesh } from './gen/echino.js';
import { crabMesh, shrimpMesh, isopodMesh } from './gen/crust.js';
import { tubeWormMesh, musselMesh, whaleFallMesh } from './gen/sessile.js';
import { ANIM } from './species.js';

export const GENERATORS = {
  fish: fishMesh, ray: rayMesh, turtle: turtleMesh, ceph: cephMesh, medusa: medusaMesh, cteno: ctenoMesh, sipho: siphoMesh,
  star: starMesh, brittle: brittleMesh, urchin: urchinMesh, cucumber: cucumberMesh, crab: crabMesh, shrimp: shrimpMesh, isopod: isopodMesh,
  tubeworm: tubeWormMesh, mussel: musselMesh, whalefall: whaleFallMesh,
};

// lower ring counts for the far model (only the params that the generators read)
const LOW = { fish: { ns: 12, nu: 8 } };

// Drop small triangles to make a cheap far mesh: keep a triangle when its
// area is in the top part, or every other one of the rest.
function thin(m, keep = 0.45) {
  const I = m.indices, P = m.positions, n = I.length / 3, areas = new Float32Array(n);
  for (let t = 0; t < n; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    areas[t] = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  const sorted = Float32Array.from(areas).sort(), cut = sorted[Math.floor(n * (1 - keep))] || 0;
  const out = [];
  for (let t = 0; t < n; t++) if (areas[t] >= cut || (t & 3) === 0) out.push(I[t * 3], I[t * 3 + 1], I[t * 3 + 2]);
  return Object.assign({}, m, { indices: m.vertexCount < 65536 ? new Uint16Array(out) : new Uint32Array(out), tris: out.length / 3 });
}

export function genModel(sp) {
  const fn = GENERATORS[sp.model.gen];
  if (!fn) throw new Error('fauna: no generator ' + sp.model.gen);
  const lod0 = fn(sp.model.p || {});
  const low = LOW[sp.model.gen];
  const lod1 = low ? fn(Object.assign({}, sp.model.p || {}, low)) : thin(lod0);
  return { lod0, lod1, tris0: lod0.tris, tris1: lod1.tris };
}

// The animation channels of a scanned model (no generator gave them):
// s = 0.5 - z (head at +z), w = how far the vertex is from the body axis
// (arms of a star, legs of a crab), ph from the angle round the axis.
export function scanAnim(positions, sp) {
  const n = positions.length / 3, a = new Float32Array(n * 4);
  let rMax = 1e-6;
  for (let i = 0; i < n; i++) rMax = Math.max(rMax, Math.hypot(positions[i * 3], positions[i * 3 + 2]));
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2], r = Math.hypot(x, z) / rMax;
    let s = 0.5 - z, w = 0, ph = (Math.atan2(z, x) / (Math.PI * 2) + 1) % 1, f = 0;
    if (sp.anim === ANIM.ARMS || sp.anim === ANIM.WALK) { w = Math.max(0, (r - 0.35) / 0.65); f = r; }
    if (sp.anim === ANIM.FISH || sp.anim === ANIM.EEL || sp.anim === ANIM.CRAWL) { w = 0; f = 0; }
    if (sp.anim === ANIM.STILL) { s = y; }
    a[i * 4] = s; a[i * 4 + 1] = w; a[i * 4 + 2] = ph; a[i * 4 + 3] = f;
  }
  return a;
}
