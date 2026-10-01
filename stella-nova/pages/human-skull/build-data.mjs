#!/usr/bin/env node
// ============================================================================
//  HUMAN SKULL  ·  build-data.mjs — BodyParts3D meshes to data/skull.{bin,json}
// ────────────────────────────────────────────────────────────────────────────
//  Run once, offline:   node build-data.mjs <raw-dir>
//  <raw-dir> holds the two BodyParts3D 4.0 archives from
//  https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html
//      partof_BP3D_4.0_obj_99.zip   the bones (part-of tree)
//      isa_BP3D_4.0_obj_99.zip      the teeth (is-a tree)
//  The script reads each OBJ with `unzip -p`, so nothing is unpacked on disk.
//
//  STEPS
//    1. select   PARTS below: 23 bones and 28 teeth, each an FJ element file
//    2. convert  BP3D mm (x left, y back, z up) to three.js (x left, y up,
//                z front), centred on the skull box
//    3. weld     merge equal positions, drop zero-area triangles
//    4. decimate quadric edge collapse (Garland-Heckbert) to the part budget
//    5. normals  smooth, angle-weighted
//    6. AO       two baked channels per vertex, by BVH ray casts:
//                  .x self  (the part alone; true in any arrangement)
//                  .y whole (every part assembled; true at home)
//    7. pack     per part: Uint16 position (quantized in the part box),
//                Int16 oct normal, Uint8 AO pair, Uint16 index
//
//  OUTPUT
//    data/skull.bin   all parts, 4-byte aligned blocks
//    data/skull.json  manifest: per part name, Latin, group, side, pair,
//                     FMA id, fact, byte offsets, box, centre
//
//  GREP MAP
//    const PARTS ........... the selection, the Latin names and the facts
//    function decimate ..... quadric edge collapse
//    function buildBVH ..... the ray-cast tree for the AO bake
//    function bakeAO ....... the hemisphere sampler
//    function pack ......... the binary layout
// ============================================================================
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = process.argv[2];
if (!RAW) { console.error('usage: node build-data.mjs <raw-dir with the two BP3D zips>'); process.exit(1); }
const ZIP = { partof: join(RAW, 'partof_BP3D_4.0_obj_99.zip'), isa: join(RAW, 'isa_BP3D_4.0_obj_99.zip') };
for (const z of Object.values(ZIP)) if (!existsSync(z)) { console.error('missing ' + z); process.exit(1); }

// ── 1. the selection ────────────────────────────────────────────────────────
// [key, FJ file, zip, FMA, English, Latin, group, side, budget (triangles), fact]
const BONES = [
  ['frontal', 'FJ3200', 'partof', 'FMA52734', 'Frontal bone', 'Os frontale', 'cranial', 'mid', 12000,
    'Forms the forehead and the roofs of both orbits; it starts as two halves that usually fuse by age two.'],
  ['parietal-r', 'FJ3380', 'partof', 'FMA52788', 'Right parietal bone', 'Os parietale dextrum', 'cranial', 'right', 11000,
    'A curved square plate that makes most of the side and roof of the cranial vault.'],
  ['parietal-l', 'FJ3274', 'partof', 'FMA52789', 'Left parietal bone', 'Os parietale sinistrum', 'cranial', 'left', 11000,
    'Meets its twin at the sagittal suture, along the top of the head.'],
  ['temporal-r', 'FJ3386', 'partof', 'FMA52738', 'Right temporal bone', 'Os temporale dextrum', 'cranial', 'right', 6000,
    'Holds the organs of hearing and balance inside its dense petrous part.'],
  ['temporal-l', 'FJ3281', 'partof', 'FMA52739', 'Left temporal bone', 'Os temporale sinistrum', 'cranial', 'left', 6000,
    'Carries the socket of the jaw joint and the mastoid process behind the ear.'],
  ['occipital', 'FJ3309', 'partof', 'FMA52735', 'Occipital bone', 'Os occipitale', 'cranial', 'mid', 11000,
    'The spinal cord passes through its foramen magnum; its condyles rest on the atlas.'],
  ['sphenoid', 'FJ3394', 'partof', 'FMA52736', 'Sphenoid bone', 'Os sphenoidale', 'cranial', 'mid', 8000,
    'The keystone of the cranial base, shaped like a moth; it touches every other cranial bone.'],
  ['ethmoid', 'FJ3199', 'partof', 'FMA52740', 'Ethmoid bone', 'Os ethmoidale', 'cranial', 'mid', 9000,
    'A light, sieve-like bone between the orbits; smell nerves pass through its cribriform plate.'],
  ['mandible', 'FJ3289', 'partof', 'FMA52748', 'Mandible', 'Mandibula', 'facial', 'mid', 6000,
    'The only movable bone of the skull, and the largest and strongest bone of the face.'],
  ['maxilla-r', 'FJ3375', 'partof', 'FMA53649', 'Right maxilla', 'Maxilla dextra', 'facial', 'right', 5400,
    'Holds the upper teeth and the largest of the paranasal sinuses.'],
  ['maxilla-l', 'FJ3269', 'partof', 'FMA53650', 'Left maxilla', 'Maxilla sinistra', 'facial', 'left', 5400,
    'The two maxillae fuse at the midline to form most of the hard palate.'],
  ['zygomatic-r', 'FJ3392', 'partof', 'FMA52892', 'Right zygomatic bone', 'Os zygomaticum dextrum', 'facial', 'right', 1600,
    'The cheekbone; it makes the prominence of the cheek and part of the orbit wall.'],
  ['zygomatic-l', 'FJ3287', 'partof', 'FMA52893', 'Left zygomatic bone', 'Os zygomaticum sinistrum', 'facial', 'left', 1600,
    'Joins the temporal bone to form the zygomatic arch.'],
  ['nasal-r', 'FJ3378', 'partof', 'FMA53647', 'Right nasal bone', 'Os nasale dextrum', 'facial', 'right', 500,
    'A small oblong plate that forms the bridge of the nose with its twin.'],
  ['nasal-l', 'FJ3272', 'partof', 'FMA53648', 'Left nasal bone', 'Os nasale sinistrum', 'facial', 'left', 500,
    'Below it, cartilage, not bone, gives the nose its shape.'],
  ['lacrimal-r', 'FJ3371', 'partof', 'FMA53645', 'Right lacrimal bone', 'Os lacrimale dextrum', 'facial', 'right', 800,
    'The smallest and most fragile bone of the face; the tear duct runs along it.'],
  ['lacrimal-l', 'FJ3265', 'partof', 'FMA53646', 'Left lacrimal bone', 'Os lacrimale sinistrum', 'facial', 'left', 800,
    'About the size of a fingernail, in the inner wall of the orbit.'],
  ['palatine-r', 'FJ3379', 'partof', 'FMA53655', 'Right palatine bone', 'Os palatinum dextrum', 'facial', 'right', 1800,
    'An L-shaped bone that closes the back of the hard palate.'],
  ['palatine-l', 'FJ3273', 'partof', 'FMA53656', 'Left palatine bone', 'Os palatinum sinistrum', 'facial', 'left', 1800,
    'It reaches from the roof of the mouth up to the floor of the orbit.'],
  ['concha-r', 'FJ3369', 'partof', 'FMA54737', 'Right inferior nasal concha', 'Concha nasalis inferior dextra', 'facial', 'right', 700,
    'A scroll of bone in the nasal cavity that warms and moistens the air you breathe.'],
  ['concha-l', 'FJ3263', 'partof', 'FMA54738', 'Left inferior nasal concha', 'Concha nasalis inferior sinistra', 'facial', 'left', 700,
    'Unlike the upper conchae, it is a separate bone, not part of the ethmoid.'],
  ['vomer', 'FJ3395', 'partof', 'FMA9710', 'Vomer', 'Vomer', 'facial', 'mid', 3000,
    'A thin plough-shaped plate that forms the back and lower part of the nasal septum.'],
  ['hyoid', 'FJ3201', 'partof', 'FMA52749', 'Hyoid bone', 'Os hyoideum', 'hyoid', 'mid', 1100,
    'The only bone in the body that does not touch another bone; it anchors the tongue.'],
];
// teeth: FDI-style key, FJ file, FMA, and the parts of the name
const TEETH = [
  // upper right (FDI 11..17)
  ['11', 'FJ1279', 'FMA55681', 'upper', 'right', 'central incisor'],
  ['12', 'FJ1280', 'FMA55680', 'upper', 'right', 'lateral incisor'],
  ['13', 'FJ1281', 'FMA55798', 'upper', 'right', 'canine'],
  ['14', 'FJ1277', 'FMA55689', 'upper', 'right', 'first premolar'],
  ['15', 'FJ1278', 'FMA55688', 'upper', 'right', 'second premolar'],
  ['16', 'FJ1276', 'FMA55698', 'upper', 'right', 'first molar'],
  ['17', 'FJ1275', 'FMA55697', 'upper', 'right', 'second molar'],
  // upper left (21..27)
  ['21', 'FJ1265', 'FMA55682', 'upper', 'left', 'central incisor'],
  ['22', 'FJ1266', 'FMA55683', 'upper', 'left', 'lateral incisor'],
  ['23', 'FJ1267', 'FMA55799', 'upper', 'left', 'canine'],
  ['24', 'FJ1262', 'FMA55690', 'upper', 'left', 'first premolar'],
  ['25', 'FJ1264', 'FMA55691', 'upper', 'left', 'second premolar'],
  ['26', 'FJ1261', 'FMA55699', 'upper', 'left', 'first molar'],
  ['27', 'FJ1263', 'FMA55700', 'upper', 'left', 'second molar'],
  // lower left (31..37)
  ['31', 'FJ1258', 'FMA57143', 'lower', 'left', 'central incisor'],
  ['32', 'FJ1259', 'FMA57141', 'lower', 'left', 'lateral incisor'],
  ['33', 'FJ1260', 'FMA55687', 'lower', 'left', 'canine'],
  ['34', 'FJ1255', 'FMA55693', 'lower', 'left', 'first premolar'],
  ['35', 'FJ1257', 'FMA55692', 'lower', 'left', 'second premolar'],
  ['36', 'FJ1254', 'FMA55704', 'lower', 'left', 'first molar'],
  ['37', 'FJ1256', 'FMA55703', 'lower', 'left', 'second molar'],
  // lower right (41..47)
  ['41', 'FJ1272', 'FMA57142', 'lower', 'right', 'central incisor'],
  ['42', 'FJ1273', 'FMA57140', 'lower', 'right', 'lateral incisor'],
  ['43', 'FJ1274', 'FMA55686', 'lower', 'right', 'canine'],
  ['44', 'FJ1269', 'FMA55694', 'lower', 'right', 'first premolar'],
  ['45', 'FJ1271', 'FMA55695', 'lower', 'right', 'second premolar'],
  ['46', 'FJ1268', 'FMA55705', 'lower', 'right', 'first molar'],
  ['47', 'FJ1270', 'FMA55706', 'lower', 'right', 'second molar'],
];
const LAT_TYPE = {
  'central incisor': 'Dens incisivus medialis', 'lateral incisor': 'Dens incisivus lateralis', canine: 'Dens caninus',
  'first premolar': 'Dens premolaris primus', 'second premolar': 'Dens premolaris secundus',
  'first molar': 'Dens molaris primus', 'second molar': 'Dens molaris secundus',
};
const TOOTH_FACT = {
  'upper central incisor': 'The widest incisor; its flat blade cuts food like a chisel.',
  'upper lateral incisor': 'Smaller than its neighbour, and the tooth most often missing from birth.',
  'upper canine': 'The longest tooth in the mouth, with a root that can reach 17 mm.',
  'upper first premolar': 'Usually has two roots, one to the cheek and one to the palate.',
  'upper second premolar': 'Its two cusps are close to equal in height.',
  'upper first molar': 'The largest upper tooth, with three roots and four cusps.',
  'upper second molar': 'Erupts at about age twelve, so it is called the twelve-year molar.',
  'lower central incisor': 'The smallest permanent tooth, and often the first to erupt, at about six.',
  'lower lateral incisor': 'Slightly wider than the central incisor next to it.',
  'lower canine': 'Its single root is the longest in the lower jaw.',
  'lower first premolar': 'Has a large cheek cusp and a very small tongue cusp.',
  'lower second premolar': 'Often has three cusps, which makes it look like a small molar.',
  'lower first molar': 'Usually the first permanent tooth to erupt, at about age six.',
  'lower second molar': 'Has four cusps in a cross pattern and two roots.',
};
const BUDGET_TOOTH = 2200;
const PARTS = [
  ...BONES.map(([key, fj, zip, fma, name, latin, group, side, budget, fact]) => ({ key, fj, zip, fma, name, latin, group, side, budget, fact })),
  ...TEETH.map(([fdi, fj, fma, jaw, side, type]) => ({
    key: 'tooth-' + fdi, fj, zip: 'isa', fma, fdi, jaw, type,
    name: `${side[0].toUpperCase() + side.slice(1)} ${jaw} ${type}`,
    latin: `${LAT_TYPE[type]} ${jaw === 'upper' ? 'superior' : 'inferior'} ${side === 'right' ? 'dexter' : 'sinister'}`,
    group: 'dentition', side, budget: BUDGET_TOOTH, fact: TOOTH_FACT[`${jaw} ${type}`],
  })),
];
// mirror pairs: same key with -r / -l, or the FDI quadrant pair 1<->2, 3<->4
for (const p of PARTS) {
  let q = null;
  if (p.key.endsWith('-r')) q = p.key.slice(0, -2) + '-l';
  else if (p.key.endsWith('-l')) q = p.key.slice(0, -2) + '-r';
  else if (p.fdi) q = 'tooth-' + ({ 1: 2, 2: 1, 3: 4, 4: 3 }[p.fdi[0]]) + p.fdi[1];
  p.pair = q && PARTS.some(o => o.key === q) ? q : null;
}

// ── 2. read the OBJ files ───────────────────────────────────────────────────
function readObj(zip, fj) {
  const dir = zip === 'partof' ? 'partof_BP3D_4.0_obj_99' : 'isa_BP3D_4.0_obj_99';
  const txt = execFileSync('unzip', ['-p', ZIP[zip], `${dir}/${fj}.obj`], { maxBuffer: 1 << 28 }).toString();
  const v = [], f = [];
  for (const line of txt.split('\n')) {
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.trim().split(/\s+/).map(Number);
      v.push(x, z, -y);                          // BP3D (x left, y back, z up) -> (x left, y up, z front)
    } else if (line.startsWith('f ')) {
      const idx = line.trim().split(/\s+/).slice(1).map(s => parseInt(s, 10) - 1);
      for (let i = 1; i + 1 < idx.length; i++) f.push(idx[0], idx[i], idx[i + 1]);
    }
  }
  if (!v.length || !f.length) throw new Error(`${fj}: empty mesh`);
  return { pos: Float64Array.from(v), tri: Int32Array.from(f) };
}

// ── 3. weld ─────────────────────────────────────────────────────────────────
function weld(m) {
  const map = new Map(), remap = new Int32Array(m.pos.length / 3), out = [];
  for (let i = 0; i < remap.length; i++) {
    const k = `${Math.round(m.pos[3 * i] * 1e4)},${Math.round(m.pos[3 * i + 1] * 1e4)},${Math.round(m.pos[3 * i + 2] * 1e4)}`;
    let j = map.get(k);
    if (j === undefined) { j = out.length / 3; map.set(k, j); out.push(m.pos[3 * i], m.pos[3 * i + 1], m.pos[3 * i + 2]); }
    remap[i] = j;
  }
  const tri = [];
  for (let t = 0; t < m.tri.length; t += 3) {
    const a = remap[m.tri[t]], b = remap[m.tri[t + 1]], c = remap[m.tri[t + 2]];
    if (a !== b && b !== c && a !== c) tri.push(a, b, c);
  }
  return { pos: Float64Array.from(out), tri: Int32Array.from(tri) };
}

// ── 4. quadric edge collapse ────────────────────────────────────────────────
// Each vertex holds the sum of the plane quadrics of its triangles (area
// weighted). Boundary edges add a stiff plane at right angles, so open
// rims keep their outline. A collapse that flips a triangle is refused.
function decimate(m, target) {
  const nv = m.pos.length / 3, P = Float64Array.from(m.pos);
  let T = Int32Array.from(m.tri); const nt = T.length / 3;
  if (nt <= target) return m;
  const Q = new Float64Array(nv * 10), dead = new Uint8Array(nt), vdead = new Uint8Array(nv), ver = new Uint32Array(nv);
  const vf = Array.from({ length: nv }, () => []);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) vf[T[3 * t + k]].push(t);
  const addQ = (i, a, b, c, d, w) => {
    const o = i * 10;
    Q[o] += w * a * a; Q[o + 1] += w * a * b; Q[o + 2] += w * a * c; Q[o + 3] += w * a * d;
    Q[o + 4] += w * b * b; Q[o + 5] += w * b * c; Q[o + 6] += w * b * d;
    Q[o + 7] += w * c * c; Q[o + 8] += w * c * d; Q[o + 9] += w * d * d;
  };
  const triN = (a, b, c, pa = P, pb = P, pc = P) => {
    const ux = pb[3 * b] - pa[3 * a], uy = pb[3 * b + 1] - pa[3 * a + 1], uz = pb[3 * b + 2] - pa[3 * a + 2];
    const vx = pc[3 * c] - pa[3 * a], vy = pc[3 * c + 1] - pa[3 * a + 1], vz = pc[3 * c + 2] - pa[3 * a + 2];
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  };
  const edgeCount = new Map();
  const ek = (a, b) => a < b ? a * nv + b : b * nv + a;
  for (let t = 0; t < nt; t++) {
    const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2];
    const n = triN(a, b, c), len = Math.hypot(...n) || 1e-12;
    const nx = n[0] / len, ny = n[1] / len, nz = n[2] / len, d = -(nx * P[3 * a] + ny * P[3 * a + 1] + nz * P[3 * a + 2]);
    for (const i of [a, b, c]) addQ(i, nx, ny, nz, d, len / 2);
    for (const [x, y] of [[a, b], [b, c], [c, a]]) edgeCount.set(ek(x, y), (edgeCount.get(ek(x, y)) || 0) + 1);
  }
  // boundary planes
  for (let t = 0; t < nt; t++) {
    const tri = [T[3 * t], T[3 * t + 1], T[3 * t + 2]], n = triN(...tri);
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3];
      if (edgeCount.get(ek(a, b)) !== 1) continue;
      const ex = P[3 * b] - P[3 * a], ey = P[3 * b + 1] - P[3 * a + 1], ez = P[3 * b + 2] - P[3 * a + 2];
      let px = ey * n[2] - ez * n[1], py = ez * n[0] - ex * n[2], pz = ex * n[1] - ey * n[0];
      const l = Math.hypot(px, py, pz) || 1e-12; px /= l; py /= l; pz /= l;
      const d = -(px * P[3 * a] + py * P[3 * a + 1] + pz * P[3 * a + 2]), w = 1000 * Math.hypot(ex, ey, ez);
      addQ(a, px, py, pz, d, w); addQ(b, px, py, pz, d, w);
    }
  }
  const S = new Float64Array(10);
  function best(a, b) {
    for (let k = 0; k < 10; k++) S[k] = Q[a * 10 + k] + Q[b * 10 + k];
    const [a11, a12, a13, , a22, a23, , a33] = S, b1 = -S[3], b2 = -S[6], b3 = -S[8];
    const det = a11 * (a22 * a33 - a23 * a23) - a12 * (a12 * a33 - a23 * a13) + a13 * (a12 * a23 - a22 * a13);
    const cand = [];
    if (Math.abs(det) > 1e-9) {
      cand.push([
        (b1 * (a22 * a33 - a23 * a23) - a12 * (b2 * a33 - a23 * b3) + a13 * (b2 * a23 - a22 * b3)) / det,
        (a11 * (b2 * a33 - b3 * a23) - b1 * (a12 * a33 - a23 * a13) + a13 * (a12 * b3 - b2 * a13)) / det,
        (a11 * (a22 * b3 - a23 * b2) - a12 * (a12 * b3 - b2 * a13) + b1 * (a12 * a23 - a22 * a13)) / det,
      ]);
      // reject a solve far from the edge (near-singular quadric)
      const mx = (P[3 * a] + P[3 * b]) / 2, my = (P[3 * a + 1] + P[3 * b + 1]) / 2, mz = (P[3 * a + 2] + P[3 * b + 2]) / 2;
      const el = Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]);
      const c = cand[0]; if (Math.hypot(c[0] - mx, c[1] - my, c[2] - mz) > 2 * el + 1e-6) cand.pop();
    }
    cand.push([P[3 * a], P[3 * a + 1], P[3 * a + 2]], [P[3 * b], P[3 * b + 1], P[3 * b + 2]],
      [(P[3 * a] + P[3 * b]) / 2, (P[3 * a + 1] + P[3 * b + 1]) / 2, (P[3 * a + 2] + P[3 * b + 2]) / 2]);
    let bc = Infinity, bp = null;
    for (const c of cand) {
      const e = S[0] * c[0] * c[0] + 2 * S[1] * c[0] * c[1] + 2 * S[2] * c[0] * c[2] + 2 * S[3] * c[0] + S[4] * c[1] * c[1]
        + 2 * S[5] * c[1] * c[2] + 2 * S[6] * c[1] + S[7] * c[2] * c[2] + 2 * S[8] * c[2] + S[9];
      if (e < bc) { bc = e; bp = c; }
    }
    return [Math.max(0, bc), bp];
  }
  // binary min-heap of [cost, a, b, verA, verB]
  const heap = [];
  const push = e => { heap.push(e); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < heap.length && heap[l][0] < heap[s][0]) s = l; if (r < heap.length && heap[r][0] < heap[s][0]) s = r; if (s === i) break; [heap[s], heap[i]] = [heap[i], heap[s]]; i = s; } }
    return top;
  };
  const queueEdge = (a, b) => { const [c, p] = best(a, b); push([c, a, b, ver[a], ver[b], p]); };
  for (const k of edgeCount.keys()) queueEdge(Math.floor(k / nv), k % nv);
  let live = nt;
  const tmp = new Float64Array(3);
  while (live > target && heap.length) {
    const [, a, b, va, vb, p] = pop();
    if (vdead[a] || vdead[b] || ver[a] !== va || ver[b] !== vb) continue;
    // flip test on every live face of a or b that survives
    let ok = true;
    for (const v of [a, b]) for (const t of vf[v]) {
      if (dead[t]) continue;
      const tri = [T[3 * t], T[3 * t + 1], T[3 * t + 2]];
      if (tri.includes(a) && tri.includes(b)) continue;
      const n0 = triN(...tri);
      const pts = tri.map(i => (i === a || i === b) ? -1 : i);
      tmp[0] = p[0]; tmp[1] = p[1]; tmp[2] = p[2];
      const arr = pts.map(i => i < 0 ? [tmp, 0] : [P, i]);
      const n1 = triN(arr[0][1], arr[1][1], arr[2][1], arr[0][0], arr[1][0], arr[2][0]);
      const l0 = Math.hypot(...n0), l1 = Math.hypot(...n1);
      if (l1 < 1e-12 || (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]) < 0.25 * l0 * l1) { ok = false; break; }
    }
    if (!ok) continue;                          // a later collapse next to it queues the edge again
    // collapse b into a
    P[3 * a] = p[0]; P[3 * a + 1] = p[1]; P[3 * a + 2] = p[2];
    for (let k = 0; k < 10; k++) Q[a * 10 + k] += Q[b * 10 + k];
    vdead[b] = 1;
    for (const t of vf[b]) {
      if (dead[t]) continue;
      const tri = [T[3 * t], T[3 * t + 1], T[3 * t + 2]];
      if (tri.includes(a)) { dead[t] = 1; live--; continue; }
      for (let k = 0; k < 3; k++) if (T[3 * t + k] === b) T[3 * t + k] = a;
      vf[a].push(t);
    }
    vf[a] = vf[a].filter(t => !dead[t]);
    ver[a]++;
    const nbr = new Set();
    for (const t of vf[a]) for (let k = 0; k < 3; k++) { const v = T[3 * t + k]; if (v !== a) nbr.add(v); }
    for (const v of nbr) queueEdge(a, v);          // edges between other vertices keep their cost
  }
  // compact
  const remap = new Int32Array(nv).fill(-1), pos = [], tri = [];
  for (let t = 0; t < nt; t++) {
    if (dead[t]) continue;
    for (let k = 0; k < 3; k++) {
      const v = T[3 * t + k];
      if (remap[v] < 0) { remap[v] = pos.length / 3; pos.push(P[3 * v], P[3 * v + 1], P[3 * v + 2]); }
      tri.push(remap[v]);
    }
  }
  return { pos: Float64Array.from(pos), tri: Int32Array.from(tri) };
}

// ── 5. smooth normals, angle weighted ───────────────────────────────────────
function normals(m) {
  const n = new Float64Array(m.pos.length), P = m.pos;
  for (let t = 0; t < m.tri.length; t += 3) {
    const ids = [m.tri[t], m.tri[t + 1], m.tri[t + 2]];
    const e = [];
    for (let k = 0; k < 3; k++) {
      const i = ids[k], j = ids[(k + 1) % 3];
      e.push([P[3 * j] - P[3 * i], P[3 * j + 1] - P[3 * i + 1], P[3 * j + 2] - P[3 * i + 2]]);
    }
    const [u, , w] = e, cx = u[1] * -w[2] - u[2] * -w[1], cy = u[2] * -w[0] - u[0] * -w[2], cz = u[0] * -w[1] - u[1] * -w[0];
    const cl = Math.hypot(cx, cy, cz) || 1e-12;
    for (let k = 0; k < 3; k++) {
      const a = e[k], b = e[(k + 2) % 3];
      const la = Math.hypot(...a) || 1e-12, lb = Math.hypot(...b) || 1e-12;
      const ang = Math.acos(Math.max(-1, Math.min(1, -(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb))));
      const i = ids[k];
      n[3 * i] += cx / cl * ang; n[3 * i + 1] += cy / cl * ang; n[3 * i + 2] += cz / cl * ang;
    }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}

// ── 6. BVH and the AO bake ──────────────────────────────────────────────────
function buildBVH(tris) {          // tris: Float64Array, 9 floats per triangle
  const n = tris.length / 9, idx = new Int32Array(n), cen = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    idx[i] = i;
    for (let k = 0; k < 3; k++) cen[3 * i + k] = (tris[9 * i + k] + tris[9 * i + 3 + k] + tris[9 * i + 6 + k]) / 3;
  }
  const nodes = [];                // [minx,miny,minz,maxx,maxy,maxz,left,right,start,count]
  function build(s, e) {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = s; i < e; i++) for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) {
      const x = tris[9 * idx[i] + 3 * v + k]; if (x < b[k]) b[k] = x; if (x > b[3 + k]) b[3 + k] = x;
    }
    const id = nodes.length; nodes.push(null);
    if (e - s <= 4) { nodes[id] = [...b, -1, -1, s, e - s]; return id; }
    const ax = [b[3] - b[0], b[4] - b[1], b[5] - b[2]], k = ax.indexOf(Math.max(...ax));
    const sub = Array.from(idx.subarray(s, e)).sort((p, q) => cen[3 * p + k] - cen[3 * q + k]);
    idx.set(sub, s);
    const m = (s + e) >> 1, l = build(s, m), r = build(m, e);
    nodes[id] = [...b, l, r, s, 0];
    return id;
  }
  build(0, n);
  return { tris, idx, nodes };
}
function rayHit(B, ox, oy, oz, dx, dy, dz, tmax) {
  const stack = [0], ix = 1 / dx, iy = 1 / dy, iz = 1 / dz, T = B.tris;
  let best = tmax;
  while (stack.length) {
    const nd = B.nodes[stack.pop()];
    let t0 = (nd[0] - ox) * ix, t1 = (nd[3] - ox) * ix; if (t0 > t1) [t0, t1] = [t1, t0];
    let u0 = (nd[1] - oy) * iy, u1 = (nd[4] - oy) * iy; if (u0 > u1) [u0, u1] = [u1, u0];
    let w0 = (nd[2] - oz) * iz, w1 = (nd[5] - oz) * iz; if (w0 > w1) [w0, w1] = [w1, w0];
    const tn = Math.max(t0, u0, w0, 0), tf = Math.min(t1, u1, w1, best);
    if (tn > tf) continue;
    if (nd[6] < 0) {
      for (let i = nd[8]; i < nd[8] + nd[9]; i++) {
        const o = 9 * B.idx[i];
        const e1x = T[o + 3] - T[o], e1y = T[o + 4] - T[o + 1], e1z = T[o + 5] - T[o + 2];
        const e2x = T[o + 6] - T[o], e2y = T[o + 7] - T[o + 1], e2z = T[o + 8] - T[o + 2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det, sx = ox - T[o], sy = oy - T[o + 1], sz = oz - T[o + 2];
        const u = (sx * px + sy * py + sz * pz) * inv; if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv; if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (t > 1e-4 && t < best) best = t;
      }
    } else stack.push(nd[6], nd[7]);
  }
  return best;
}
// fixed cosine-weighted directions (Fibonacci hemisphere), turned per vertex
const NRAY = 56;
const DIRS = Array.from({ length: NRAY }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / NRAY), phi = i * 2.399963229728653;
  return [r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(Math.max(0, 1 - r * r))];
});
function bakeAO(pos, nrm, B, range) {
  const ao = new Float64Array(pos.length / 3);
  for (let i = 0; i < ao.length; i++) {
    const nx = nrm[3 * i], ny = nrm[3 * i + 1], nz = nrm[3 * i + 2];
    // tangent frame, turned by a hash of the index to break up banding
    let tx = Math.abs(nx) < 0.9 ? 1 : 0, ty = tx ? 0 : 1, tz = 0;
    let bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    let l = Math.hypot(bx, by, bz); bx /= l; by /= l; bz /= l;
    tx = by * nz - bz * ny; ty = bz * nx - bx * nz; tz = bx * ny - by * nx;
    const rot = ((i * 2654435761) >>> 0) / 4294967296 * Math.PI * 2, cr = Math.cos(rot), sr = Math.sin(rot);
    const ox = pos[3 * i] + nx * 0.05, oy = pos[3 * i + 1] + ny * 0.05, oz = pos[3 * i + 2] + nz * 0.05;
    let occ = 0;
    for (const [a0, b0, c] of DIRS) {
      const a = a0 * cr - b0 * sr, b = a0 * sr + b0 * cr;
      const dx = tx * a + bx * b + nx * c, dy = ty * a + by * b + ny * c, dz = tz * a + bz * b + nz * c;
      const t = rayHit(B, ox, oy, oz, dx, dy, dz, range);
      if (t < range) { const f = t / range; occ += 1 - f * f; }
    }
    ao[i] = 1 - occ / NRAY;
  }
  return ao;
}

// ── 7. pack ─────────────────────────────────────────────────────────────────
function octEncode(x, y, z) {
  const s = Math.abs(x) + Math.abs(y) + Math.abs(z);
  let u = x / s, v = y / s;
  if (z < 0) { const pu = u; u = (1 - Math.abs(v)) * Math.sign(pu || 1); v = (1 - Math.abs(pu)) * Math.sign(v || 1); }
  return [Math.round(u * 32767), Math.round(v * 32767)];
}
function pack(parts) {
  const blocks = []; let off = 0;
  const add = (ta) => { const pad = (4 - (off % 4)) % 4; if (pad) { blocks.push(new Uint8Array(pad)); off += pad; } const o = off; blocks.push(new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength)); off += ta.byteLength; return o; };
  for (const p of parts) {
    const V = p.pos.length / 3;
    const qp = new Uint16Array(V * 3), qn = new Int16Array(V * 2), qa = new Uint8Array(V * 2), qi = new Uint16Array(p.tri.length);
    for (let i = 0; i < V; i++) {
      for (let k = 0; k < 3; k++) qp[3 * i + k] = Math.round((p.pos[3 * i + k] - p.min[k]) / (p.ext[k] || 1) * 65535);
      const [u, v] = octEncode(p.nrm[3 * i], p.nrm[3 * i + 1], p.nrm[3 * i + 2]); qn[2 * i] = u; qn[2 * i + 1] = v;
      qa[2 * i] = Math.round(Math.max(0, Math.min(1, p.aoSelf[i])) * 255);
      qa[2 * i + 1] = Math.round(Math.max(0, Math.min(1, p.aoAll[i])) * 255);
    }
    qi.set(p.tri);
    p.off = { pos: add(qp), nrm: add(qn), ao: add(qa), idx: add(qi) };
  }
  const bin = new Uint8Array(off); let o = 0;
  for (const b of blocks) { bin.set(b, o); o += b.length; }
  return bin;
}

// ── run ─────────────────────────────────────────────────────────────────────
const t0 = Date.now();
const built = [];
let rawTri = 0;
for (const p of PARTS) {
  const raw = weld(readObj(p.zip, p.fj));
  rawTri += raw.tri.length / 3;
  const m = decimate(raw, p.budget);
  built.push({ ...p, pos: m.pos, tri: m.tri, rawTri: raw.tri.length / 3 });
  process.stdout.write(`  ${p.key.padEnd(14)} ${String(raw.tri.length / 3).padStart(6)} -> ${String(m.tri.length / 3).padStart(5)} tris\n`);
}
// centre on the skull box (all parts except the hyoid, which hangs below)
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (const p of built) if (p.key !== 'hyoid') for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p.pos[i + k]); hi[k] = Math.max(hi[k], p.pos[i + k]); }
const C0 = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2);
for (const p of built) for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) p.pos[i + k] -= C0[k];
for (const p of built) p.nrm = normals(p);
// AO: self (each part alone, range 14 mm) and whole (all parts, range 42 mm)
const allTris = [];
for (const p of built) for (let t = 0; t < p.tri.length; t++) { const v = p.tri[t]; allTris.push(p.pos[3 * v], p.pos[3 * v + 1], p.pos[3 * v + 2]); }
const Ball = buildBVH(Float64Array.from(allTris));
for (const p of built) {
  const own = new Float64Array(p.tri.length * 3);
  for (let t = 0; t < p.tri.length; t++) { const v = p.tri[t]; own.set([p.pos[3 * v], p.pos[3 * v + 1], p.pos[3 * v + 2]], 3 * t); }
  p.aoSelf = bakeAO(p.pos, p.nrm, buildBVH(own), 14);
  p.aoAll = bakeAO(p.pos, p.nrm, Ball, 42);
  for (let i = 0; i < p.aoAll.length; i++) p.aoAll[i] = Math.min(p.aoAll[i], p.aoSelf[i]);
}
// boxes, centres, and the local frame (each part is stored about its own centre)
for (const p of built) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p.pos[i + k]); mx[k] = Math.max(mx[k], p.pos[i + k]); }
  p.center = mn.map((v, k) => (v + mx[k]) / 2);
  for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) p.pos[i + k] -= p.center[k];
  p.min = mn.map((v, k) => v - p.center[k]); p.ext = mn.map((v, k) => mx[k] - v);
  // surface area, for sorting by size
  let area = 0;
  for (let t = 0; t < p.tri.length; t += 3) {
    const a = p.tri[t], b = p.tri[t + 1], c = p.tri[t + 2];
    const ux = p.pos[3 * b] - p.pos[3 * a], uy = p.pos[3 * b + 1] - p.pos[3 * a + 1], uz = p.pos[3 * b + 2] - p.pos[3 * a + 2];
    const vx = p.pos[3 * c] - p.pos[3 * a], vy = p.pos[3 * c + 1] - p.pos[3 * a + 1], vz = p.pos[3 * c + 2] - p.pos[3 * a + 2];
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  p.area = area;
  // teeth: the crown end along y (upper teeth point down, lower teeth up)
  if (p.group === 'dentition') p.crown = p.jaw === 'upper' ? -1 : 1;
}
const bin = pack(built);
const r3 = v => v.map(x => +x.toFixed(3));
const manifest = {
  version: 1,
  title: 'Human skull',
  units: 'mm',
  axes: 'x = left of the subject, y = up, z = front',
  source: {
    name: 'BodyParts3D, (c) The Database Center for Life Science',
    url: 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html',
    licence: 'CC BY 4.0 (database licence since 2025-02-27); the 2011 OBJ headers state CC BY-SA 2.1 JP. These derived meshes are shared under CC BY-SA 4.0.',
    files: ['partof_BP3D_4.0_obj_99.zip', 'isa_BP3D_4.0_obj_99.zip'],
  },
  center: r3(C0),
  bounds: { min: r3(lo.map((v, k) => v - C0[k])), max: r3(hi.map((v, k) => v - C0[k])) },
  bytes: bin.length,
  parts: built.map(p => ({
    key: p.key, name: p.name, latin: p.latin, group: p.group, side: p.side, pair: p.pair,
    fma: p.fma, bp3d: p.fj, fdi: p.fdi || null, fact: p.fact,
    v: p.pos.length / 3, t: p.tri.length / 3, off: p.off,
    min: r3(p.min), ext: r3(p.ext), center: r3(p.center), area: Math.round(p.area), crown: p.crown || 0,
  })),
};
mkdirSync(join(HERE, 'data'), { recursive: true });
writeFileSync(join(HERE, 'data/skull.bin'), bin);
writeFileSync(join(HERE, 'data/skull.json'), JSON.stringify(manifest, null, 1));
const T = built.reduce((s, p) => s + p.tri.length / 3, 0), V = built.reduce((s, p) => s + p.pos.length / 3, 0);
console.log(`parts ${built.length} · triangles ${rawTri} -> ${T} · vertices ${V} · skull.bin ${(bin.length / 1024).toFixed(0)} KB · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
