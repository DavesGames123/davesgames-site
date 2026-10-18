// ============================================================================
//  CORAL REEF  ·  fauna/build-assets.mjs  ·  the creature asset build (node)
// ----------------------------------------------------------------------------
//  This script makes the files in assets/fauna/ from the archive downloads.
//  The page does not run it. It needs glTF-Transform 4.1.1, draco3dgltf
//  1.5.7 and meshoptimizer 0.25.0 (the Permissive flag) in a scratch folder (not in the
//  repository) and ImageMagick (magick) on the PATH:
//
//    npm i --prefix <deps> @gltf-transform/core@4.1.1 \
//      @gltf-transform/functions@4.1.1 @gltf-transform/extensions@4.1.1 \
//      draco3dgltf@1.5.7 meshoptimizer@0.25.0
//    node fauna/build-assets.mjs --deps <deps> --src <downloads> [--only a,b]
//
//  For each model of fauna/sources.js MODELS:
//    1. read the GLB (Draco decoded), bake the node matrices, join the parts
//    2. turn it (rot, degrees, XYZ order) so +y is up and +z is forward,
//       move the box centre to x = z = 0 and the lowest point to y = 0
//       (base: 'bottom') or the box centre to 0 (base: 'centre'), and
//       scale it so the longest side is 1 (the page scales to the size of
//       the species)
//    3. LOD 0 and LOD 1: meshopt simplify to tris[0] and tris[1] (seamSimplify)
//    4. drop every texture; write the base colour image as two JPG files
//       (tex/<id>-512.jpg, tex/<id>-256.jpg, quality 82)
//    5. quantize (KHR_mesh_quantization: 14-bit positions, 10-bit normals,
//       12-bit UVs) and write <id>.glb and <id>-lod1.glb
//  Then it writes assets/fauna/manifest.json: the provenance and licence of
//  each model from sources.js, and the files with their bytes and tris.
//
//  Last it writes assets/fauna/CREDITS.txt from the manifest (--credits:
//  only that, with no dependencies).
//
//  grep -n targets: "function buildOne", "function writeManifest", "function writeCredits"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MODELS, SOURCES } from './sources.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'assets', 'fauna');
const arg = k => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : null; };

// assets/fauna/CREDITS.txt from the manifest (also: node fauna/build-assets.mjs --credits)
function writeCredits() {
  const mf = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));
  const L = [
    'Deep Ocean Explorer (stella-nova/pages/coral-reef) - creature models',
    '=====================================================================',
    '',
    'Every file in this folder comes from the archive named below. The',
    'licence of each model was checked before the file was added (the date',
    'and the method are in "checked"). fauna/build-assets.mjs simplified the',
    'meshes, turned them to +y up, scaled them to 1 m and re-encoded the',
    'textures; it did not change what they show. The animals that are not in',
    'this list are our own procedural models (fauna/gen/), not scans.',
    '',
  ];
  for (const m of mf.models) {
    L.push(`${m.id}`);
    L.push(`  species ..... ${m.sci}${m.common ? ' (' + m.common + ')' : ''}`);
    if (m.specimen) L.push(`  specimen .... ${m.specimen}`);
    L.push(`  archive ..... ${m.archive}`);
    L.push(`  author ...... ${m.author}`);
    L.push(`  licence ..... ${m.licence} ${m.licenceUrl}`);
    L.push(`  source ...... ${m.url}`);
    if (m.record) L.push(`  record ...... ${m.record}`);
    L.push(`  checked ..... ${m.checked}`);
    L.push(`  files ....... ${m.files.map(f => f.path).join(', ')}`);
    L.push('');
  }
  fs.writeFileSync(path.join(OUT, 'CREDITS.txt'), L.join('\n'));
}
if (process.argv.includes('--credits')) { writeCredits(); console.log('CREDITS.txt written'); process.exit(0); }

const DEPS = arg('deps'), SRC = arg('src');
const ONLY = arg('only') ? arg('only').split(',') : null;
if (!DEPS || !SRC) { console.error('use: node fauna/build-assets.mjs --deps <dir> --src <dir> [--only a,b]'); process.exit(2); }
const req = createRequire(path.resolve(DEPS) + '/');
const load = p => import(pathToFileURL(req.resolve(p)).href);
const { NodeIO } = await load('@gltf-transform/core');
const { ALL_EXTENSIONS } = await load('@gltf-transform/extensions');
const F = await load('@gltf-transform/functions');
const draco3d = (await load('draco3dgltf')).default;
const { MeshoptSimplifier } = await load('meshoptimizer');
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });

const DEG = Math.PI / 180;
function rotMatrix([ax, ay, az]) {
  const cx = Math.cos(ax * DEG), sx = Math.sin(ax * DEG), cy = Math.cos(ay * DEG), sy = Math.sin(ay * DEG), cz = Math.cos(az * DEG), sz = Math.sin(az * DEG);
  // R = Rz * Ry * Rx (X first)
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}

async function prepare(m) {
  const doc = await io.read(path.join(SRC, m.file));
  doc.setLogger({ debug() {}, info() {}, warn() {}, error: console.error });
  // the output is plain (quantized) glTF: glb-lite.js reads no Draco
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'KHR_draco_mesh_compression' || e.extensionName === 'EXT_meshopt_compression') e.dispose();
  // static pose: drop skins and animations, bake the node matrices
  for (const a of doc.getRoot().listAnimations()) a.dispose();
  for (const s of doc.getRoot().listSkins()) s.dispose();
  await doc.transform(F.dequantize(), F.flatten(), F.join({ keepNamed: false }));
  // bake every node matrix into its mesh, then one node per mesh
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const M = node.getWorldMatrix();
    for (const p of mesh.listPrimitives()) F.transformPrimitive(p, M);
    node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    if (node.getParentNode()) { node.getParentNode().removeChild(node); scene.addChild(node); }
  }
  // every primitive: rotate, then find the box
  const R = rotMatrix(m.rot || [0, 0, 0]);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  const prims = [];
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) prims.push(p);
  for (const p of prims) {
    const P = p.getAttribute('POSITION'), N = p.getAttribute('NORMAL');
    const v = [0, 0, 0];
    for (let i = 0; i < P.getCount(); i++) {
      P.getElement(i, v);
      const r = [0, 1, 2].map(k => R[k][0] * v[0] + R[k][1] * v[1] + R[k][2] * v[2]);
      P.setElement(i, r);
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], r[k]); mx[k] = Math.max(mx[k], r[k]); }
    }
    if (N) for (let i = 0; i < N.getCount(); i++) { N.getElement(i, v); N.setElement(i, [0, 1, 2].map(k => R[k][0] * v[0] + R[k][1] * v[1] + R[k][2] * v[2])); }
  }
  const ext = mx.map((a, k) => a - mn[k]), L = Math.max(...ext);
  const c = [(mn[0] + mx[0]) / 2, m.base === 'centre' ? (mn[1] + mx[1]) / 2 : mn[1], (mn[2] + mx[2]) / 2];
  for (const p of prims) {
    const P = p.getAttribute('POSITION'), v = [0, 0, 0];
    for (let i = 0; i < P.getCount(); i++) { P.getElement(i, v); P.setElement(i, [(v[0] - c[0]) / L, (v[1] - c[1]) / L, (v[2] - c[2]) / L]); }
  }
  await doc.transform(F.weld(), F.dedup(), F.prune({ keepAttributes: true }));
  return { doc, scanExtent: ext, unit: L };
}

function tris(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) { const I = p.getIndices(); n += (I ? I.getCount() : p.getAttribute('POSITION').getCount()) / 3; }
  return Math.round(n);
}

// Scans have many UV islands, and the simplifier keeps every seam vertex, so
// a plain simplify stops far above the target. seamSimplify welds by
// position only, simplifies, then gives each triangle corner the copy of
// that position whose UV is nearest to the other corners (the same island).
function seamSimplify(prim, target, err) {
  const P = prim.getAttribute('POSITION'), UV = prim.getAttribute('TEXCOORD_0'), I = prim.getIndices();
  const n = P.getCount(), pos = new Float32Array(n * 3), uv = UV ? new Float32Array(n * 2) : null, v = [0, 0, 0], w = [0, 0];
  for (let i = 0; i < n; i++) { P.getElement(i, v); pos.set(v, i * 3); if (uv) { UV.getElement(i, w); uv.set(w, i * 2); } }
  const key = i => `${Math.round(pos[i * 3] * 1e5)},${Math.round(pos[i * 3 + 1] * 1e5)},${Math.round(pos[i * 3 + 2] * 1e5)}`;
  const repOf = new Uint32Array(n), dups = new Map(), first = new Map();
  for (let i = 0; i < n; i++) { const k = key(i); if (!first.has(k)) { first.set(k, i); dups.set(i, []); } repOf[i] = first.get(k); dups.get(repOf[i]).push(i); }
  const src = I.getArray();
  const ri = new Uint32Array(src.length);
  for (let t = 0; t < src.length; t++) ri[t] = repOf[src[t]];
  const [out] = MeshoptSimplifier.simplify(ri, pos, 3, Math.max(3, Math.floor(target) * 3), err, ['Permissive']);
  const fin = new Uint32Array(out.length);
  for (let t = 0; t < out.length; t += 3) {
    const D = [dups.get(out[t]), dups.get(out[t + 1]), dups.get(out[t + 2])];
    let best = [D[0][0], D[1][0], D[2][0]], bs = Infinity;
    if (uv) for (const a of D[0]) for (const b of D[1]) for (const c of D[2]) {
      const s = Math.hypot(uv[a * 2] - uv[b * 2], uv[a * 2 + 1] - uv[b * 2 + 1]) + Math.hypot(uv[b * 2] - uv[c * 2], uv[b * 2 + 1] - uv[c * 2 + 1]) + Math.hypot(uv[c * 2] - uv[a * 2], uv[c * 2 + 1] - uv[a * 2 + 1]);
      if (s < bs) { bs = s; best = [a, b, c]; }
    }
    fin.set(best, t);
  }
  I.setArray(fin);
  return fin.length / 3;
}

async function lodDoc(doc, target) {
  const d = F.cloneDocument(doc);
  const t0 = tris(d);
  if (t0 > target) {
    const prims = [];
    for (const mesh of d.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) prims.push(p);
    for (const p of prims) {
      const share = target * (p.getIndices().getCount() / 3) / t0;
      let err = 0.01, got = Infinity;
      for (let k = 0; k < 6 && got > share * 1.15; k++, err *= 2) {
        got = seamSimplify(p, share, err);
      }
    }
    await d.transform(F.prune({ keepAttributes: true }));
    for (const mesh of d.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) F.compactPrimitive(p);
  }
  return d;
}

function writeTex(m, doc) {
  const tex = [];
  let img = null;
  for (const mat of doc.getRoot().listMaterials()) { const t = mat.getBaseColorTexture(); if (t && !img) img = t.getImage(); }
  if (img) {
    const tmp = path.join(OUT, 'tex', `.${m.id}.src`);
    fs.writeFileSync(tmp, img);
    for (const s of [512, 256]) {
      const f = path.join(OUT, 'tex', `${m.id}-${s}.jpg`);
      execFileSync('magick', [tmp, '-resize', `${s}x${s}`, '-strip', '-quality', '82', '-sampling-factor', '4:2:0', f]);
      tex.push(`tex/${m.id}-${s}.jpg`);
    }
    fs.unlinkSync(tmp);
  }
  return tex;
}

async function finish(d, file, keepUV) {
  for (const mat of d.getRoot().listMaterials()) {
    mat.setBaseColorTexture(null); mat.setNormalTexture(null); mat.setMetallicRoughnessTexture(null); mat.setOcclusionTexture(null); mat.setEmissiveTexture(null);
  }
  for (const t of d.getRoot().listTextures()) t.dispose();
  for (const mesh of d.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    for (const s of p.listSemantics()) if (!['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0'].includes(s) || (s === 'TEXCOORD_0' && !keepUV)) p.setAttribute(s, null);
  }
  await d.transform(F.prune({ keepAttributes: true }), F.quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8 }));
  const bytes = await io.writeBinary(d);
  fs.writeFileSync(path.join(OUT, file), bytes);
  return bytes.byteLength;
}

async function buildOne(m) {
  const { doc, scanExtent, unit } = await prepare(m);
  const tex = m.texture === false ? [] : writeTex(m, doc);
  const files = [];
  const t = m.tris || [3000, 600];
  const d0 = await lodDoc(doc, t[0]);
  const n0 = tris(d0);
  const b0 = await finish(d0, `${m.id}.glb`, tex.length > 0);
  files.push({ path: `${m.id}.glb`, bytes: b0, tris: n0, lod: 0 });
  const d1 = await lodDoc(doc, t[1]);
  const n1 = tris(d1);
  const b1 = await finish(d1, `${m.id}-lod1.glb`, tex.length > 0);
  files.push({ path: `${m.id}-lod1.glb`, bytes: b1, tris: n1, lod: 1 });
  for (const p of tex) files.push({ path: p, bytes: fs.statSync(path.join(OUT, p)).size, texture: true });
  return { id: m.id, files, scanExtent: scanExtent.map(v => +v.toFixed(4)), scanUnit: +unit.toFixed(4) };
}

function writeManifest(built) {
  const mf = path.join(OUT, 'manifest.json');
  let old = { models: [] };
  try { old = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { /* first build */ }
  const byId = new Map(old.models.map(x => [x.id, x]));
  for (const b of built) {
    const m = MODELS.find(x => x.id === b.id), s = SOURCES[m.source];
    byId.set(b.id, {
      id: m.id, sci: m.sci, common: m.common, source: m.source, archive: s.archive, author: m.author || s.author,
      licence: m.licence || s.licence, licenceUrl: s.licenceUrl, url: m.url, record: m.record || null, specimen: m.specimen || null,
      checked: m.checked, modified: 'Simplified (meshopt), turned to +y up and +z forward, scaled to 1 m, textures re-encoded as 512 and 256 px JPG, quantized. fauna/build-assets.mjs.',
      files: b.files, scanExtent: b.scanExtent, scanUnit: b.scanUnit,
    });
  }
  const models = [...byId.values()].filter(x => MODELS.some(m => m.id === x.id)).sort((a, b) => a.id.localeCompare(b.id));
  const bytes = models.reduce((s, x) => s + x.files.reduce((t, f) => t + f.bytes, 0), 0);
  fs.writeFileSync(mf, JSON.stringify({ about: 'Creature models of coral-reef/fauna. Every file in assets/fauna/ is listed here with its source and licence (tests/fauna.test.mjs checks it).', bytes, models }, null, 1) + '\n');
  return { count: models.length, bytes };
}

const list = MODELS.filter(m => !ONLY || ONLY.includes(m.id));
const built = [];
for (const m of list) {
  try {
    const b = await buildOne(m);
    built.push(b);
    console.log(m.id.padEnd(30), b.files.map(f => `${f.path.replace(m.id, '')}:${(f.bytes / 1024).toFixed(0)}k${f.tris ? '/' + f.tris : ''}`).join(' '));
  } catch (e) { console.error('FAIL', m.id, e.stack); }
}
const s = writeManifest(built);
writeCredits();
console.log(`manifest: ${s.count} models, ${(s.bytes / 1048576).toFixed(2)} MB; CREDITS.txt written`);
