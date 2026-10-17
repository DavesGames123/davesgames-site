// Node tests for lib/glb-lite.js and for every model in the nature pack.
// Run: node stella-nova/tools/nature-assets/glb-lite.test.mjs
// Part 1 builds GLB files by hand (interleaved byteStride, normalized
// ints, node matrices, KHR_texture_transform, an embedded image) and
// checks the parser output. Part 2 parses each LOD file in
// assets/nature/manifest.json and checks the triangle counts, the
// bounds against the real height (10 %), the base centre origin and
// that each image file is the WebP that the manifest says. Part 3
// checks the fields VEG reads (wind, sink, materials[].coverage,
// impostor.sideHalfSize, snake case biome keys), the provenance of the
// second pack (Mantissa, OpenGameArt, procedural) and CREDITS.txt.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseGLB } from '../../lib/glb-lite.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../assets/nature');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL ' + msg); } };
const near = (a, b, e = 1e-5) => Math.abs(a - b) <= e;

// ---- hand-built GLB --------------------------------------------------------
function buildGLB(json, bin) {
  const enc = new TextEncoder();
  let js = enc.encode(JSON.stringify(json));
  const jpad = (4 - (js.length & 3)) & 3;
  const bpad = (4 - (bin.length & 3)) & 3;
  const total = 12 + 8 + js.length + jpad + 8 + bin.length + bpad;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.length + jpad, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(js, 20); for (let i = 0; i < jpad; i++) out[20 + js.length + i] = 0x20;
  const b0 = 20 + js.length + jpad;
  dv.setUint32(b0, bin.length + bpad, true); dv.setUint32(b0 + 4, 0x004e4942, true);
  out.set(bin, b0 + 8);
  return out.buffer;
}

{
  // One quad, interleaved: position f32x3, normal i8x4 normalized (pad), uv u16x2 normalized.
  // stride = 12 + 4 + 4 = 20 bytes.
  const verts = [
    [0, 0, 0, 0, 127, 0, 0, 0],
    [1, 0, 0, 0, 127, 0, 65535, 0],
    [1, 0, 1, 0, 127, 0, 65535, 65535],
    [0, 0, 1, 0, 127, 0, 0, 65535],
  ];
  const stride = 20;
  const vbuf = new ArrayBuffer(verts.length * stride);
  const vdv = new DataView(vbuf);
  verts.forEach((v, i) => {
    const o = i * stride;
    vdv.setFloat32(o, v[0], true); vdv.setFloat32(o + 4, v[1], true); vdv.setFloat32(o + 8, v[2], true);
    vdv.setInt8(o + 12, v[3]); vdv.setInt8(o + 13, v[4]); vdv.setInt8(o + 14, v[5]); vdv.setInt8(o + 15, 0);
    vdv.setUint16(o + 16, v[6], true); vdv.setUint16(o + 18, v[7], true);
  });
  const idx = new Uint16Array([0, 2, 1, 0, 3, 2]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const parts = [new Uint8Array(vbuf), new Uint8Array(idx.buffer), new Uint8Array(4), png];
  const bin = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0; const offs = parts.map((p) => { const r = o; bin.set(p, o); o += p.length; return r; });
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { mesh: 0, translation: [10, 0, 0], scale: [2, 2, 2] },
      { mesh: 0, rotation: [0, 0, 1, 0], children: [2] }, // 180 deg about z
      { mesh: 0, translation: [0, 5, 0] },
    ],
    meshes: [{ name: 'quad', primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{
      name: 'leaf', alphaMode: 'MASK', alphaCutoff: 0.4, doubleSided: true,
      pbrMetallicRoughness: { baseColorFactor: [0.5, 1, 1, 1], baseColorTexture: { index: 0, extensions: { KHR_texture_transform: { scale: [0.5, 0.5], offset: [0.25, 0] } } } },
    }],
    textures: [{ source: 0 }],
    images: [{ bufferView: 2, mimeType: 'image/png' }],
    accessors: [
      { bufferView: 0, byteOffset: 0, componentType: 5126, count: 4, type: 'VEC3', min: [0, 0, 0], max: [1, 0, 1] },
      { bufferView: 0, byteOffset: 12, componentType: 5120, normalized: true, count: 4, type: 'VEC3' },
      { bufferView: 0, byteOffset: 16, componentType: 5123, normalized: true, count: 4, type: 'VEC2' },
      { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: offs[0], byteLength: vbuf.byteLength, byteStride: stride },
      { buffer: 0, byteOffset: offs[1], byteLength: idx.byteLength },
      { buffer: 0, byteOffset: offs[3], byteLength: png.length },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  const glb = buildGLB(json, bin);
  const s = parseGLB(glb);
  ok(s.meshes.length === 1, 'synthetic: three nodes with one material merge to one mesh');
  const m = s.meshes[0];
  ok(m.vertexCount === 12 && m.triangleCount === 6, 'synthetic: 12 vertices, 6 triangles');
  ok(m.indices instanceof Uint32Array, 'synthetic: indices are Uint32Array');
  ok(near(m.positions[3], 12) && near(m.positions[5], 0), 'synthetic: node 0 TRS baked (x = 10 + 2*1)');
  ok(near(m.positions[4 * 3 + 3], -1), 'synthetic: node 1 rotation baked (x = -1)');
  ok(near(m.positions[8 * 3 + 4], -5), 'synthetic: child of rotated node gets parent * child (y = -5)');
  ok(near(m.normals[1], 1) && near(m.normals[4 * 3 + 1], -1), 'synthetic: normals normalized and rotated');
  ok(near(m.uvs[2], 0.75) && near(m.uvs[3], 0), 'synthetic: normalized u16 uv + KHR_texture_transform (1*0.5+0.25)');
  // node 1 mirrors nothing (rotation), so the winding stays; check triangle 0 of node 0
  ok(m.indices[0] === 0 && m.indices[1] === 2 && m.indices[2] === 1, 'synthetic: winding kept with no mirror');
  ok(m.material.alphaMode === 'MASK' && near(m.material.alphaCutoff, 0.4) && m.material.doubleSided, 'synthetic: alpha mode, cutoff, double sided');
  ok(m.material.baseColor && m.material.baseColor.mime === 'image/png' && m.material.baseColor.bytes.length === 12, 'synthetic: embedded image bytes and mime');
  ok(m.material.baseColorFactor[0] === 0.5, 'synthetic: base colour factor');
  ok(near(s.bounds.min[0], -1) && near(s.bounds.max[0], 12), 'synthetic: scene bounds');

  // Mirror check: negative scale flips the winding.
  json.scenes[0].nodes = [0];
  json.nodes[0] = { mesh: 0, scale: [-1, 1, 1] };
  const s2 = parseGLB(buildGLB(json, bin));
  ok(s2.meshes[0].indices[1] === 1 && s2.meshes[0].indices[2] === 2, 'synthetic: mirror matrix flips the winding');
  // No merge, no bake.
  json.scenes[0].nodes = [0, 1];
  const s3 = parseGLB(buildGLB(json, bin), { bake: false });
  ok(s3.meshes.length === 3 && s3.meshes[0].matrix && near(s3.meshes[0].positions[3], 1), 'synthetic: bake:false keeps local data and gives matrices');
  // Bad input.
  let threw = false; try { parseGLB(new ArrayBuffer(32)); } catch { threw = true; }
  ok(threw, 'synthetic: a non-GLB buffer throws');
  json.extensionsRequired = ['KHR_draco_mesh_compression'];
  threw = false; try { parseGLB(buildGLB(json, bin)); } catch { threw = true; }
  ok(threw, 'synthetic: required Draco throws');
}

// ---- writer round trip (KHR_mesh_quantization normals, uri WebP images) ----
{
  const { writeGLB } = await import('./mesh-ops.mjs');
  const part = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0.6, 0, 0.8]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
  };
  const glb = writeGLB([part], [{ name: 'leaf', alphaMode: 'MASK', alphaCutoff: 0.5, doubleSided: true, maps: { baseColor: '../tex/x/leaf_albedo_512.webp', normal: '../tex/x/leaf_normal_512.webp', orm: '../tex/x/leaf_orm_512.webp' } }], { id: 't' });
  const s = parseGLB(glb.buffer);
  const m = s.meshes[0];
  ok(s.json.extensionsRequired.includes('KHR_mesh_quantization'), 'writer: requires KHR_mesh_quantization');
  ok(m.triangleCount === 1 && near(m.positions[7], 2), 'writer: positions round trip');
  ok(near(m.normals[6], 0.6, 0.01) && near(m.normals[8], 0.8, 0.01), 'writer: int8 normals round trip (0.01)');
  ok(m.material.baseColor.uri === '../tex/x/leaf_albedo_512.webp' && m.material.baseColor.bytes === null && m.material.baseColor.mime === 'image/webp', 'writer: base colour is an external WebP uri');
  ok(m.material.orm === m.material.baseColor ? false : m.material.orm.uri.endsWith('orm_512.webp') && !m.material.occlusion, 'writer: one ORM image for occlusion + metal/rough');
  ok(m.material.alphaMode === 'MASK' && m.material.doubleSided, 'writer: material flags');
}

// ---- the real pack -----------------------------------------------------------
const mfile = path.join(root, 'manifest.json');
const isWebp = (b) => !!b && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45;
if (!existsSync(mfile)) {
  console.log('note: no assets/nature/manifest.json yet, pack checks skipped');
} else {
  const man = JSON.parse(readFileSync(mfile, 'utf8'));
  ok(Array.isArray(man.assets) && man.assets.length > 0, 'manifest: has assets');
  const ids = new Set();
  const seen = new Map(); // abs path -> default
  let models = 0;
  const credited = [];
  const need = ['id', 'name', 'kind', 'biomes', 'licence', 'author', 'source'];
  const touch = (abs, a, what) => {
    if (!existsSync(abs)) { ok(false, `${a.id}: ${what} ${path.relative(root, abs)} exists`); return null; }
    seen.set(abs, (seen.get(abs) || false) || !!a.default);
    const b = readFileSync(abs);
    ok(b.length < 15e6, `${a.id}: ${path.relative(root, abs)} under 15 MB`);
    return b;
  };
  for (const a of man.assets) {
    for (const k of need) ok(a[k] !== undefined && a[k] !== '' && a[k] !== null, `${a.id}: field ${k}`);
    ok(!ids.has(a.id), `${a.id}: unique id`); ids.add(a.id);
    ok(a.licence === 'CC0-1.0' || /^CC-BY-[34]\.0$/.test(a.licence), `${a.id}: licence is CC0 or CC-BY (${a.licence})`);
    for (const b of a.biomes) ok((man.biomeKeys || []).includes(b) && /^[a-z]+(_[a-z]+)*$/.test(b), `${a.id}: biome ${b} is a known snake case key`);
    if (a.kind === 'ground texture') {
      for (const k of ['albedo', 'normal', 'orm']) ok(isWebp(touch(path.join(root, a.textures[k]), a, k)), `${a.id}: ${k} is WebP`);
      continue;
    }
    models++;
    ok(a.height > 0 && a.footprint > 0, `${a.id}: height and footprint`);
    ok(Array.isArray(a.lods) && a.lods.length === 3, `${a.id}: three LODs`);
    let prevTris = Infinity;
    for (const [li, lod] of (a.lods || []).entries()) {
      const abs = path.join(root, lod.file);
      const b = touch(abs, a, 'model');
      if (!b) continue;
      ok(b.length === lod.bytes, `${a.id} lod${li}: bytes match the manifest`);
      let s;
      try { s = parseGLB(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); } catch (e) { ok(false, `${a.id} lod${li}: parses (${e.message})`); continue; }
      ok(s.triangleCount === lod.tris, `${a.id} lod${li}: tris ${s.triangleCount} = manifest ${lod.tris}`);
      ok(s.triangleCount <= prevTris, `${a.id} lod${li}: not more tris than the LOD before`);
      prevTris = s.triangleCount;
      const h = s.bounds.max[1] - s.bounds.min[1];
      ok(Math.abs(h - a.height) <= 0.1 * a.height, `${a.id} lod${li}: bounds height ${h.toFixed(3)} m within 10 % of ${a.height} m`);
      ok(Math.abs(s.bounds.min[1]) <= 0.05 * a.height + 0.01, `${a.id} lod${li}: base at y = 0 (min y ${s.bounds.min[1].toFixed(3)})`);
      const cx = (s.bounds.min[0] + s.bounds.max[0]) / 2, cz = (s.bounds.min[2] + s.bounds.max[2]) / 2;
      // A leaning tree (bent palm) has its trunk base far from the box centre.
      ok(Math.hypot(cx, cz) <= Math.max(0.5 * a.footprint, 0.05), `${a.id} lod${li}: origin near the base centre (box centre ${cx.toFixed(2)}, ${cz.toFixed(2)})`);
      for (const m of s.meshes) {
        ok(m.normals && m.normals.length === m.positions.length, `${a.id} lod${li}: normals present`);
        ok(m.uvs && m.uvs.length * 3 === m.positions.length * 2, `${a.id} lod${li}: uvs present`);
        let bad = 0; for (let k = 0; k < m.indices.length; k++) if (m.indices[k] >= m.vertexCount) bad++;
        ok(bad === 0, `${a.id} lod${li}: indices in range`);
        ok(!!m.material.baseColor, `${a.id} lod${li}: has a base colour texture`);
        for (const im of [m.material.baseColor, m.material.normal, m.material.orm]) {
          if (!im) continue;
          const f = path.resolve(path.dirname(abs), im.uri || '');
          ok(!!im.uri && lod.textures.includes(path.relative(root, f).split(path.sep).join('/')), `${a.id} lod${li}: texture ${im.uri} is listed in lod.textures`);
          ok(isWebp(touch(f, a, 'texture')), `${a.id} lod${li}: texture ${im.uri} is WebP`);
        }
      }
    }
    // Fields VEG reads.
    ok(typeof a.wind === 'number' && a.wind >= 0 && a.wind <= 1, `${a.id}: wind in 0..1`);
    ok(typeof a.sink === 'number' && a.sink >= 0 && a.sink < 0.5, `${a.id}: sink in 0..0.5`);
    ok(Array.isArray(a.materials) && a.materials.length > 0 && a.materials.every((m) => typeof m.coverage === 'number' && m.coverage > 0 && m.coverage <= 1), `${a.id}: materials[].coverage in (0, 1]`);
    if (a.sourceName !== 'Poly Haven') {
      ok(typeof a.provenance === 'string' && a.provenance.length > 10, `${a.id}: second pack asset has a provenance`);
      ok(/^https:\/\//.test(a.source), `${a.id}: source is a URL`);
      if (/procedural/.test(a.sourceName)) ok(/^procedural/.test(a.provenance), `${a.id}: procedural asset says so in provenance`);
      credited.push(a);
    }
    if (a.wantImpostor !== undefined) ok(false, `${a.id}: wantImpostor removed from the manifest`);
    if (a.impostor) {
      ok(Array.isArray(a.impostor.sideHalfSize) && a.impostor.sideHalfSize.length === 2 && a.impostor.sideHalfSize.every((x) => x > 0), `${a.id}: impostor.sideHalfSize`);
      ok(Math.min(...a.impostor.coverage) >= 0.01, `${a.id}: no empty impostor view`);
      for (const k of ['albedo', 'normal']) ok(isWebp(touch(path.join(root, a.impostor[k]), a, 'impostor ' + k)), `${a.id}: impostor ${k} is WebP`);
    }
  }
  for (const g of man.groundLayers || []) ok(ids.has(g), `groundLayers: ${g} is an asset`);
  let bytes = 0, defBytes = 0;
  for (const [f, def] of seen) { const n = statSync(f).size; bytes += n; if (def) defBytes += n; }
  ok(bytes < 160e6, `pack: ${(bytes / 1e6).toFixed(1)} MB under 160 MB`);
  ok(defBytes < 45e6, `pack: default view ${(defBytes / 1e6).toFixed(1)} MB under 45 MB`);
  // Every second pack source is in CREDITS.txt with its author and link.
  const credits = existsSync(path.join(root, 'CREDITS.txt')) ? readFileSync(path.join(root, 'CREDITS.txt'), 'utf8') : '';
  for (const a of credited) ok(credits.includes(a.sourceAsset) && credits.includes(a.source) && credits.includes(a.id), `${a.id}: in CREDITS.txt with source and link`);
  const kinds = new Set(man.assets.map((a) => a.kind));
  for (const k of ['tree', 'bush', 'grass', 'reed', 'cactus', 'mushroom']) ok(kinds.has(k), `pack: has kind ${k}`);
  for (const w of ['birch', 'maple', 'palm', 'willow']) ok(man.assets.some((a) => a.kind === 'tree' && (a.sub + ' ' + a.name).toLowerCase().includes(w)), `pack: has a ${w} tree`);
  if (man.totals) ok(man.totals.bytes === bytes && man.totals.files === seen.size, `manifest totals (${man.totals.files} files, ${man.totals.bytes} B) = files on disk (${seen.size}, ${bytes} B)`);
  console.log(`pack: ${man.assets.length} assets (${models} models), ${seen.size} files, ${(bytes / 1e6).toFixed(1)} MB, default ${(defBytes / 1e6).toFixed(1)} MB`);
}

console.log(`glb-lite tests: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
