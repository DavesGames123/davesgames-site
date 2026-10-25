// ============================================================================
//  STEREOGRAM MODELS  ·  models/build/build.mjs — the model build (node only)
// ----------------------------------------------------------------------------
//  Downloads each source model, keeps only the triangles, welds them,
//  decimates them with meshoptimizer to a triangle budget, centres them in
//  a unit box (the largest half side is 1), and writes a GLB with int16
//  positions (KHR_mesh_quantization) and an index buffer, no normals, no
//  UVs, no textures. A depth map needs only the surface.
//
//  The pages do not load this file. It writes:
//    models/<id>.glb ......... the meshes
//    models/list.js .......... MODELS (models/index.js imports it)
//    models/build/report.json  source URL, licence, triangle counts, bytes
//    ../CREDITS.md ........... the credit list (from report.json)
//
//  RUN (needs the npm packages in a scratch folder on NODE_PATH):
//    npm i @gltf-transform/core@4.1.1 @gltf-transform/extensions@4.1.1 \
//          meshoptimizer@0.22.0 draco3dgltf@1.5.7       (in <scratch>/tools)
//    NODE_PATH=<scratch>/tools/node_modules node models/build/build.mjs \
//          <scratch>/dl [ids...]
//  Raw downloads go to <scratch>/dl/<id>/; the build deletes each one
//  after use. Requests send a site User-Agent and nothing personal.
//
//  LICENCES. Only CC0 sources, CC BY 4.0 sources, and the site's own
//  CC BY-SA 4.0 skull. The Stanford 3D Scanning Repository models are
//  not used: its terms forbid use in a product for sale without
//  permission, and this site promotes a game for sale (see CREDITS.md).
//  Smithsonian items were checked against the Open Access API
//  (usage.access = CC0) on the date in SOURCES.
//
//  grep -n targets: "const SOURCES", "async function fetchSource", "function writeCredits",
//    "function collect", "function decimate", "function writeGLB"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const NP = (process.env.NODE_PATH || '').split(':').filter(Boolean);
const req = name => require(require.resolve(name, { paths: NP }));
const { NodeIO } = req('@gltf-transform/core');
const { ALL_EXTENSIONS } = req('@gltf-transform/extensions');
const draco3d = req('draco3dgltf');
const { MeshoptSimplifier, MeshoptDecoder } = req('meshoptimizer');

const HERE = path.dirname(new URL(import.meta.url).pathname);
const MODELS_DIR = path.resolve(HERE, '..');
const SITE = path.resolve(MODELS_DIR, '../../..');          // stella-nova/
const UA = { 'User-Agent': 'davesgames-site-asset-build/1.0 (+https://davesgames.io)' };

const PH = (id, name, kind, author, view, tris = 40000) => ({ id: id.replace(/_/g, '-'), name, kind, src: 'polyhaven', ref: id, tris, view,
  credit: author + ', Poly Haven', licence: 'CC0-1.0', url: 'https://polyhaven.com/a/' + id });
const KH = (ref, name, kind, credit, licence, view, tris = 40000) => ({ id: ref.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(), name, kind, src: 'khronos', ref, tris, view,
  credit: credit + ', Khronos glTF Sample Assets', licence, url: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/' + ref });
const SI = (id, name, kind, pkg, file, record, view, tris = 50000, checked = '2026-10-24 Open Access API: access CC0') => ({ id, name, kind, src: 'smithsonian', ref: pkg, file, tris, view,
  credit: 'Smithsonian Institution, Smithsonian 3D Digitization (Open Access)', licence: 'CC0-1.0', url: 'https://3d-api.si.edu/voyager/' + pkg, record, checked });
// Specimens that pages/coral-reef already uses; its CREDITS.txt holds the
// licence check. This build takes the 150k source mesh, not the reef LOD.
const REEF = (id, name, pkg, file, record, view) => SI(id, name, 'animal', pkg, file, record, view, 40000,
  '2026-10-18 Open Access API: access CC0 (pages/coral-reef/assets/fauna/CREDITS.txt)');

// view: the default { yaw, pitch } in degrees for the depth map.
export const SOURCES = [
  // statues and busts
  PH('marble_bust_01', 'Marble bust', 'statue', 'Rico Cilliers', { yaw: 20, pitch: 0 }),
  PH('lion_head', 'Lion head', 'statue', 'Rico Cilliers', { yaw: 0, pitch: 0 }),
  PH('horse_head', 'Horse head', 'statue', 'Rico Cilliers', { yaw: 60, pitch: 0 }),
  PH('concrete_cat_statue', 'Concrete cat', 'statue', 'Rico Cilliers', { yaw: 30, pitch: 0 }),
  PH('garden_gnome', 'Garden gnome', 'statue', 'Rico Cilliers', { yaw: 15, pitch: 0 }),
  PH('gothic_statue', 'Gothic statue', 'statue', 'Benny Weimer', { yaw: 0, pitch: 0 }),
  PH('bull_head', 'Bull head', 'statue', 'Tina', { yaw: 30, pitch: 0 }),
  SI('lincoln-life-mask', 'Abraham Lincoln life mask', 'statue', '3d_package:2b4a081a-9ea1-4b0c-b1c3-6f5389da3244',
    'p0-Part-100k-1024.glb', 'https://npg.si.edu/object/npg_NPG.71.24', { yaw: 0, pitch: 90 }),
  // skulls and fossils
  KH('ScatteringSkull', 'Human skull (scan)', 'skull', 'Vladimir Petkovic', 'CC0-1.0', { yaw: 25, pitch: 0 }),
  { id: 'human-skull', name: 'Human skull (BodyParts3D)', kind: 'skull', src: 'skull', ref: 'pages/human-skull/data', tris: 60000, view: { yaw: 20, pitch: 0 },
    credit: 'Human skull meshes adapted from BodyParts3D, (c) The Database Center for Life Science, CC BY 4.0 / CC BY-SA 2.1 JP; adaptation by davesgames.io',
    licence: 'CC-BY-SA-4.0', url: 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html' },
  SI('diplocaulus-skull', 'Diplocaulus skull (fossil)', 'fossil', '3d_package:23a3cd17-8526-4b30-80e7-fdae0ecdd36a',
    'Diplocaulus_magnicornis-150k-1024-low.glb', 'http://n2t.net/ark:/65665/37c497201-5f67-4f76-8459-39ad82a45682', { yaw: 0, pitch: 0 }),
  SI('trilobite', 'Trilobite fossil, Psychopyge elegans', 'fossil', '3d_package:e4518faa-9603-4e1b-8375-e62d1fda079b',
    'Psychopyge_elegans_Termier_-_Termier__1950-150k-1024-low.glb', 'http://n2t.net/ark:/65665/38feef8a9-c39d-4a7c-a0bb-47fc82ca5f17', { yaw: 180, pitch: 0 }),
  // animals
  KH('BarramundiFish', 'Barramundi fish', 'animal', 'Microsoft', 'CC0-1.0', { yaw: 90, pitch: 0 }),
  PH('lambis_shell', 'Spider conch shell', 'animal', 'Rico Cilliers', { yaw: 0, pitch: -90 }),
  REEF('conus-gloriamaris', 'Glory-of-the-sea cone shell', '3d_package:0dff6ec4-bbff-4231-b0aa-2cb00e6dd643', 'Conus_gloriamaris-150k-1024-low.glb',
    'http://n2t.net/ark:/65665/34fa7cdb0-c6f1-45ad-88ba-aedd5cfae36a', { yaw: 0, pitch: 0, roll: 90 }),
  REEF('charybdis-lucifera', 'Swimming crab', '3d_package:28a32285-db66-420a-bc26-70577cdf0a23', 'Goniosoma_quadrimaculatum-150k-1024-low.glb',
    'http://n2t.net/ark:/65665/3e5f2bcd9-110b-435c-b570-ebcc8d486d14', { yaw: 0, pitch: 70 }),
  REEF('acanthaster-brevispinus', 'Sea star', '3d_package:50a5728c-75c3-4341-80b8-e08764f37ed9', 'Acanthaster_brevispinus-150k-1024-low.glb',
    'http://n2t.net/ark:/65665/387fbf7e1-ea40-44c8-9e13-c30338a024f5', { yaw: 0, pitch: 0 }),
  REEF('chicoreus-cervicornis', 'Murex shell', '3d_package:78dbfa2e-f031-4d60-a447-d61415823149', 'Chicoreus_cervicornis-150k-1024-low.glb',
    'http://n2t.net/ark:/65665/3313c3ffc-cc09-44c5-831e-f974e4ab3673', { yaw: 0, pitch: 0, roll: 90 }),
  // tools and machines
  KH('AntiqueCamera', 'Antique camera', 'machine', 'Maximilian Kamps, UX3D', 'CC0-1.0', { yaw: 30, pitch: 0 }),
  KH('Lantern', 'Street lantern', 'machine', 'Microsoft', 'CC0-1.0', { yaw: 30, pitch: 0 }),
  PH('vintage_microscope', 'Brass microscope', 'machine', 'Poly Haven', { yaw: 30, pitch: 0 }),
  PH('hand_plane_no4', 'Hand plane', 'tool', 'Poly Haven', { yaw: 40, pitch: 30 }),
  PH('pocket_watch', 'Pocket watch', 'tool', 'Poly Haven', { yaw: 0, pitch: 0 }),
  PH('binoculars', 'Binoculars', 'tool', 'Derek Wight', { yaw: 20, pitch: 40 }),
  SI('apollo-11-command-module', 'Apollo 11 command module', 'machine', '3d_package:d8c63e8a-4ebc-11ea-b77f-2e728ce88125',
    'x3d-cm-interior-hull-uvs-150k-1024-low.glb', 'http://n2t.net/ark:/65665/nv9ce74610f-62de-46b6-904f-58abfecb555c', { yaw: 45, pitch: 15 }),
  // food
  PH('food_apple_01', 'Apple', 'food', 'Poly Haven', { yaw: 0, pitch: 10 }),
  PH('strawberry_chocolate_cake', 'Strawberry chocolate cake', 'food', 'Kuutti Siitonen', { yaw: 0, pitch: 35 }),
  PH('food_pomegranate_01', 'Pomegranate', 'food', 'Poly Haven', { yaw: 0, pitch: 10 }),
  { ...PH('bananas', 'Bunch of bananas', 'food', 'Poly Haven', { yaw: 0, pitch: 30 }), root: 0 },
  // plants
  SI('lycaste-orchid', 'Orchid bloom, Lycaste virginalis', 'plant', '3d_package:5ff6e90a-4ddb-4eea-a69c-40970f85fbcb',
    'Lycaste_virginalis-150k-1024-low.glb', 'https://collections.si.edu/ (Lycaste virginalis, 3D)', { yaw: 0, pitch: 0 }),
  { ...PH('cheiridopsis_succulent', 'Succulent', 'plant', 'James Ray Cock, Jenelle van Heerden', { yaw: 0, pitch: 40 }), root: 0 },
  PH('tree_stump_01', 'Tree stump', 'plant', 'Poly Haven', { yaw: 0, pitch: 15 }),
  { ...PH('calathea_orbifolia_01', 'Calathea plant', 'plant', 'Rob Tuytel, Rico Cilliers', { yaw: 0, pitch: 20 }), root: 0 },
  // historical artefacts
  PH('antique_ceramic_vase_01', 'Antique ceramic vase', 'artefact', 'Poly Haven', { yaw: 0, pitch: 0 }),
  { ...PH('tea_set_01', 'Teapot', 'artefact', 'James Ray Cock, Rico Cilliers, Jurita Burger', { yaw: 30, pitch: 15 }), id: 'teapot', root: [5, 9] },
  PH('sungka_board', 'Sungka board', 'artefact', 'Ulan Cabanilla', { yaw: 90, pitch: 70 }),
  KH('Corset', 'Corset on a mannequin', 'artefact', 'Microsoft, UX3D', 'CC0-1.0', { yaw: 20, pitch: 0 }),
  // test models
  KH('Suzanne', 'Suzanne (Blender test model)', 'test', 'Norbert Nopper, UX3D', 'CC0-1.0', { yaw: 0, pitch: 0 }),
  PH('rubber_duck_toy', 'Rubber duck', 'test', 'Poly Haven', { yaw: 50, pitch: 0 }),
];

// ── download ───────────────────────────────────────────────────────────────
async function get(url, file) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(r.status + ' ' + url);
  const b = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, b);
  return b.length;
}
// Strip images, textures and samplers, so a .gltf reads with no texture files.
function stripTextures(json) {
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials || []) {
    const pbr = m.pbrMetallicRoughness || {};
    delete pbr.baseColorTexture; delete pbr.metallicRoughnessTexture;
    delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture; m.extensions = {};
  }
  json.extensionsUsed = (json.extensionsUsed || []).filter(e => /draco|meshopt|quantization|texture_transform/i.test(e) && !/texture/i.test(e));
  json.extensionsRequired = (json.extensionsRequired || []).filter(e => json.extensionsUsed.includes(e));
  return json;
}
async function fetchSource(s, dir) {
  fs.mkdirSync(dir, { recursive: true });
  if (s.src === 'polyhaven') {
    const files = await (await fetch('https://api.polyhaven.com/files/' + s.ref, { headers: UA })).json();
    const info = await (await fetch('https://api.polyhaven.com/info/' + s.ref, { headers: UA })).json();
    s.credit = Object.keys(info.authors || {}).join(', ') + ', Poly Haven';
    const res = files.gltf['1k'].gltf;
    const json = await (await fetch(res.url, { headers: UA })).json();
    let bytes = 0;
    for (const [rel, inc] of Object.entries(res.include)) if (rel.endsWith('.bin')) bytes += await get(inc.url, path.join(dir, rel));
    fs.writeFileSync(path.join(dir, 'model.gltf'), JSON.stringify(stripTextures(json)));
    return { file: path.join(dir, 'model.gltf'), bytes, from: res.url };
  }
  if (s.src === 'khronos') {
    const base = `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/${s.ref}/glTF-Binary/${s.ref}.glb`;
    const f = path.join(dir, s.ref + '.glb');
    try { return { file: f, bytes: await get(base, f), from: base }; }
    catch {
      const g = `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/${s.ref}/glTF/${s.ref}.gltf`;
      const json = await (await fetch(g, { headers: UA })).json();
      let bytes = 0;
      for (const b of json.buffers || []) if (b.uri && !b.uri.startsWith('data:')) bytes += await get(new URL(b.uri, g).href, path.join(dir, decodeURIComponent(b.uri)));
      fs.writeFileSync(path.join(dir, 'model.gltf'), JSON.stringify(stripTextures(json)));
      return { file: path.join(dir, 'model.gltf'), bytes, from: g };
    }
  }
  if (s.src === 'smithsonian') {
    const u = `https://3d-api.si.edu/content/document/${s.ref}/${s.file}`, f = path.join(dir, 'model.glb');
    return { file: f, bytes: await get(u, f), from: u };
  }
  if (s.src === 'skull') return { file: null, bytes: fs.statSync(path.join(SITE, s.ref, 'skull.bin')).size, from: 'stella-nova/' + s.ref + '/skull.bin', local: true };
  throw new Error('unknown src ' + s.src);
}

// ── geometry ───────────────────────────────────────────────────────────────
// root: keep only the subtrees of these top-level scene nodes (index or list) (a Poly Haven
// file can hold several variants side by side).
async function collect(file, root = null) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(), 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(file);
  const P = [], I = [];
  let nodes = doc.getRoot().listNodes();
  if (root != null) {
    const kids = doc.getRoot().listScenes()[0].listChildren(), keep = [];
    for (const r of [].concat(root)) kids[r].traverse(n => keep.push(n));
    nodes = keep;
  }
  for (const node of nodes) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const pa = prim.getAttribute('POSITION'); if (!pa) continue;
      const base = P.length / 3, n = pa.getCount(), v = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        pa.getElement(i, v);
        P.push(m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]);
      }
      const ix = prim.getIndices();
      if (ix) for (let i = 0; i < ix.getCount(); i++) I.push(base + ix.getScalar(i)); else for (let i = 0; i < n; i++) I.push(base + i);
    }
  }
  return { positions: Float32Array.from(P), indices: Uint32Array.from(I) };
}
function collectSkull() {
  const dir = path.join(SITE, 'pages/human-skull/data');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'skull.json'), 'utf8')), raw = fs.readFileSync(path.join(dir, 'skull.bin'));
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), P = [], I = [];
  for (const p of meta.parts) {
    if (p.key === 'hyoid') continue;
    const qp = new Uint16Array(buf, p.off.pos, p.v * 3), qi = new Uint16Array(buf, p.off.idx, p.t * 3), base = P.length / 3;
    // Part vertices are local to the part centre (pages/human-skull/skull.js).
    for (let i = 0; i < p.v; i++) for (let k = 0; k < 3; k++) P.push(p.center[k] + p.min[k] + qp[3 * i + k] / 65535 * p.ext[k]);
    for (let i = 0; i < qi.length; i++) I.push(base + qi[i]);
  }
  return { positions: Float32Array.from(P), indices: Uint32Array.from(I) };
}
// Weld equal positions, decimate to about tris triangles, drop unused
// vertices and degenerate triangles.
async function decimate(g, tris) {
  await MeshoptSimplifier.ready;
  const n = g.positions.length / 3, key = new Map(), remap = new Uint32Array(n), P = [];
  for (let i = 0; i < n; i++) {
    const k = g.positions[3 * i].toFixed(5) + ',' + g.positions[3 * i + 1].toFixed(5) + ',' + g.positions[3 * i + 2].toFixed(5);
    let j = key.get(k);
    if (j === undefined) { j = P.length / 3; key.set(k, j); P.push(g.positions[3 * i], g.positions[3 * i + 1], g.positions[3 * i + 2]); }
    remap[i] = j;
  }
  let idx = new Uint32Array(g.indices.length);
  for (let i = 0; i < idx.length; i++) idx[i] = remap[g.indices[i]];
  const pos = Float32Array.from(P), before = idx.length / 3;
  if (before > tris) {
    let out = MeshoptSimplifier.simplify(idx, pos, 3, tris * 3, 0.01)[0];
    if (out.length / 3 > tris * 1.25) out = MeshoptSimplifier.simplifySloppy(idx, pos, 3, null, tris * 3, 0.02)[0];
    idx = out;
  }
  const used = new Int32Array(pos.length / 3).fill(-1), Q = [], J = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (a === b || b === c || a === c) continue;
    for (const v of [a, b, c]) { if (used[v] < 0) { used[v] = Q.length / 3; Q.push(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]); } J.push(used[v]); }
  }
  return { positions: Float32Array.from(Q), indices: Uint32Array.from(J), before, after: J.length / 3 };
}
// Centre in the box and scale so the largest half side is 1. Returns the
// source size (the largest side, in source units).
function unitBox(g) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < g.positions.length; i += 3) for (let k = 0; k < 3; k++) { const v = g.positions[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  const c = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2), h = Math.max(...[0, 1, 2].map(k => (hi[k] - lo[k]) / 2)) || 1;
  for (let i = 0; i < g.positions.length; i += 3) for (let k = 0; k < 3; k++) g.positions[i + k] = (g.positions[i + k] - c[k]) / h;
  return 2 * h;
}

// ── GLB ────────────────────────────────────────────────────────────────────
export function writeGLB(g, meta) {
  const nv = g.positions.length / 3, nt = g.indices.length / 3;
  const q = new Int16Array(nv * 4);                      // 4-byte aligned stride (xyz + pad)
  const lo = [32767, 32767, 32767], hi = [-32767, -32767, -32767];
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) {
    const v = Math.max(-32767, Math.min(32767, Math.round(g.positions[3 * i + k] * 32767)));
    q[4 * i + k] = v; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v;
  }
  const small = nv < 65536, ib = small ? Uint16Array.from(g.indices) : g.indices;
  const posBytes = q.byteLength, idxBytes = ib.byteLength, idxPad = (4 - idxBytes % 4) % 4;
  const bin = Buffer.alloc(posBytes + idxBytes + idxPad);
  Buffer.from(q.buffer).copy(bin, 0); Buffer.from(ib.buffer, ib.byteOffset, idxBytes).copy(bin, posBytes);
  const json = {
    asset: { version: '2.0', generator: 'stereogram-maker models/build/build.mjs' },
    extensionsUsed: ['KHR_mesh_quantization'], extensionsRequired: ['KHR_mesh_quantization'],
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: meta.id }],
    meshes: [{ name: meta.id, primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: posBytes, byteStride: 8, target: 34962 },
                  { buffer: 0, byteOffset: posBytes, byteLength: idxBytes, target: 34963 }],
    accessors: [{ bufferView: 0, componentType: 5122, normalized: true, count: nv, type: 'VEC3', min: lo.map(v => v / 32767), max: hi.map(v => v / 32767) },
                { bufferView: 1, componentType: small ? 5123 : 5125, count: nt * 3, type: 'SCALAR' }],
    extras: { name: meta.name, credit: meta.credit, licence: meta.licence, url: meta.url },
  };
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]);
  const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jh, js, bh, bin]);
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  const scratch = process.argv[2];
  if (!scratch) throw new Error('usage: build.mjs <scratch dl dir> [ids...]');
  const only = new Set(process.argv.slice(3));
  const reportFile = path.join(HERE, 'report.json');
  const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : {};
  for (const s of SOURCES) {
    if (only.size && !only.has(s.id)) continue;
    const dir = path.join(scratch, s.id);
    try {
      const src = await fetchSource(s, dir);
      const g0 = s.src === 'skull' ? collectSkull() : await collect(src.file, s.root ?? null);
      const g = await decimate(g0, s.tris);
      const size = unitBox(g);
      const glb = writeGLB(g, s);
      fs.writeFileSync(path.join(MODELS_DIR, s.id + '.glb'), glb);
      report[s.id] = { name: s.name, kind: s.kind, source: src.from, page: s.url, record: s.record || null, licence: s.licence, credit: s.credit,
        checked: s.checked || '2026-10-24 licence read from the source page', downloadBytes: src.bytes, trianglesIn: g.before, trianglesOut: g.after,
        vertices: g.positions.length / 3, sourceSize: +size.toFixed(4), glbBytes: glb.length, sha256: crypto.createHash('sha256').update(glb).digest('hex'),
        decimation: `weld, meshopt simplify to ${s.tris} triangles (error 0.01, sloppy fallback), unit box, int16 positions` };
      console.log(s.id.padEnd(28), String(g.before).padStart(8), '->', String(g.after).padStart(6), 'tris', (glb.length / 1024).toFixed(0).padStart(5), 'KB');
    } catch (e) {
      console.log(s.id.padEnd(28), 'FAILED', e.message);
    } finally {
      if (s.src !== 'skull') fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 1) + '\n');
  writeCredits(report);
  // models/list.js: the records of the models that built.
  const list = SOURCES.filter(s => report[s.id] && fs.existsSync(path.join(MODELS_DIR, s.id + '.glb'))).map(s => ({
    id: s.id, name: s.name, kind: s.kind, file: s.id + '.glb', credit: s.credit, licence: s.licence, url: s.record || s.url, view: s.view,
    triangles: report[s.id].trianglesOut }));
  fs.writeFileSync(path.join(MODELS_DIR, 'list.js'),
    '// Generated by models/build/build.mjs. Do not edit by hand; edit SOURCES there.\n' +
    'export const MODEL_LIST = ' + JSON.stringify(list, null, 1).replace(/\n\s*/g, ' ') .replace(/\}, \{/g, '},\n  {').replace(/^\[ /, '[\n  ').replace(/ \]$/, '\n]') + ';\n');
}
// CREDITS.md in the page folder: every model, its source and licence.
function writeCredits(report) {
  const L = [];
  L.push('# Stereogram Maker credits', '',
    'Generated by `models/build/build.mjs` from `models/build/report.json`. Edit the',
    'SOURCES list in the build script, not this file.', '',
    '## 3D models', '',
    'Each file in `models/` is a processed copy of the source below: only the',
    'triangles were kept (no textures, normals or UVs), then welded, decimated',
    'with meshoptimizer, centred in a unit box and stored as int16 positions.',
    'The processing does not change what the object is.', '',
    '| Model | Kind | Source and author | Licence | Link | Triangles |', '|---|---|---|---|---|---|');
  for (const s of SOURCES) {
    const r = report[s.id]; if (!r) continue;
    L.push(`| ${r.name} (\`${s.id}.glb\`) | ${r.kind} | ${r.credit} | ${r.licence} | ${r.record || r.page} | ${r.trianglesIn} -> ${r.trianglesOut} |`);
  }
  L.push('', '### Licence notes', '',
    '- CC0-1.0: https://creativecommons.org/publicdomain/zero/1.0/ . Poly Haven: all assets CC0 (https://polyhaven.com/license).',
    '  Khronos glTF Sample Assets: the licence is in each model\'s metadata.json; only CC0 models are used here.',
    '- Smithsonian: each item was checked in the Open Access API (usage.access = CC0) on the date in report.json',
    '  (`checked`). The coral-reef specimens were checked on 2026-10-18 for pages/coral-reef.',
    '- `human-skull.glb`: adapted from BodyParts3D, (c) The Database Center for Life Science, CC BY 4.0',
    '  (database licence since 2025-02-27) / CC BY-SA 2.1 JP (2011 OBJ headers), through the site\'s own',
    '  pages/human-skull data. This derived mesh is shared under CC BY-SA 4.0',
    '  (https://creativecommons.org/licenses/by-sa/4.0/), the same as that data.',
    '',
    '### Not used', '',
    '- The Stanford 3D Scanning Repository (bunny, dragon, Buddha). Its page says: "You are welcome to use',
    '  the data and models for research purposes. You are also welcome to mirror or redistribute them for',
    '  free. ... However, such models or images are not to be used for commercial purposes, nor should they',
    '  appear in a product for sale (with the exception of scholarly journals or books), without our',
    '  permission." (graphics.stanford.edu/data/3Dscanrep, read through the Internet Archive on 2026-10-24;',
    '  the live server did not answer). This site promotes a game for sale, so these models are left out.',
    '  The Khronos DragonAttenuation model is the Stanford dragon under the same terms and is left out too.',
    '- The Khronos Duck (SCEA Shared Source licence) and CC BY models are not used.',
    '- No ossicles (their licence is non-commercial).',
    '',
    '## Pattern tiles', '',
    'The pattern tiles are drawn at run time by `engine/tiles.js` from the site\'s own pattern-designer',
    'engine (`pages/pattern-designer`). They are original work of this site.',
    '',
    '## Algorithm', '',
    'The single-image stereogram code (`engine/sirds.js`) is our own code of the method in H. W. Thimbleby,',
    'S. Inglis and I. H. Witten, "Displaying 3D images: algorithms for single-image random-dot stereograms",',
    'IEEE Computer 27(10):38-48, 1994.', '');
  fs.writeFileSync(path.join(MODELS_DIR, '..', 'CREDITS.md'), L.join('\n'));
}

if (import.meta.url === 'file://' + process.argv[1]) main();
