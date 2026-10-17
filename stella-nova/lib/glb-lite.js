// glb-lite.js: a small DOM-free GLB (binary glTF 2.0) parser and the
// browser loader for the nature asset pack (stella-nova/assets/nature).
//
// The parser reads the JSON and BIN chunks, walks the default scene,
// bakes each node's world matrix into the vertex data, and merges the
// primitives that use the same material. It reads accessors with
// byteStride and normalized integer types. It does not read sparse
// accessors, Draco or meshopt compression (the asset build does not use
// them). It applies KHR_texture_transform to the base colour UVs when it
// is present. It ignores the other KHR_materials_* extensions.
//
// API (grep -n these names):
//   parseGLB(arrayBuffer, opts?) -> GLBScene
//     opts.bake (default true): apply node matrices to the vertex data.
//     opts.merge (default true): merge primitives by material.
//   GLBScene = {
//     meshes: [{ name, positions: Float32Array (xyz), normals: Float32Array|null,
//                uvs: Float32Array|null (uv), tangents: Float32Array|null (xyzw),
//                colors: Float32Array|null (rgba), indices: Uint32Array,
//                vertexCount, triangleCount, bounds: { min, max },
//                material: Material }],
//     bounds: { min: [x,y,z], max: [x,y,z] }, triangleCount, vertexCount,
//     images: [{ bytes: Uint8Array, mime }], json, extras }
//   Material = { name, baseColor: Image|null, normal: Image|null,
//                orm: Image|null (r occlusion, g roughness, b metallic),
//                occlusion: Image|null (only when it is not the orm image),
//                emissive: Image|null, baseColorFactor: [r,g,b,a],
//                metallicFactor, roughnessFactor, normalScale,
//                occlusionStrength, alphaMode: 'OPAQUE'|'MASK'|'BLEND',
//                alphaCutoff, doubleSided, extras }
//   Image = { bytes: Uint8Array, mime, index }  (index into GLBScene.images)
//   sceneBounds(scene) -> { min, max }
//
// Browser loader (needs only fetch and createImageBitmap):
//   loadNatureManifest(baseUrl) -> NatureLib
//   NatureLib = { baseUrl, manifest, assets (Map id -> record),
//                 byKind(kind), byBiome(biome), defaults(),
//                 loadAsset(id, lod = 0) -> { record, lod, scene, bitmaps },
//                 loadImpostor(id) -> { record, albedo, normal } | null,
//                 loadGround(ids?) -> [{ record, albedo, normal, orm }],
//                 url(path) }
//   loadAsset(id, lod) -> as NatureLib.loadAsset, on the last manifest that
//     loadNatureManifest loaded.
//   bitmaps = Map image index -> ImageBitmap (sRGB conversion off, no
//     premultiply). Upload base colour as rgba8unorm-srgb and the other
//     maps as rgba8unorm.
//
// The node tests for this file are tools/nature-assets/glb-lite.test.mjs.

const MAGIC = 0x46546c67;     // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const TYPE_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

function readComponent(dv, off, ct) {
  switch (ct) {
    case 5120: return dv.getInt8(off);
    case 5121: return dv.getUint8(off);
    case 5122: return dv.getInt16(off, true);
    case 5123: return dv.getUint16(off, true);
    case 5125: return dv.getUint32(off, true);
    case 5126: return dv.getFloat32(off, true);
  }
  throw new Error('glb-lite: unknown componentType ' + ct);
}

function normalize(v, ct) {
  switch (ct) {
    case 5120: return Math.max(v / 127, -1);
    case 5121: return v / 255;
    case 5122: return Math.max(v / 32767, -1);
    case 5123: return v / 65535;
    default: return v;
  }
}

// Read an accessor into a typed array. Floats come back as Float32Array
// (normalized ints become floats); asIndex gives a Uint32Array.
function readAccessor(json, bin, index, asIndex = false) {
  const acc = json.accessors[index];
  if (!acc) throw new Error('glb-lite: missing accessor ' + index);
  if (acc.sparse) throw new Error('glb-lite: sparse accessors are not supported');
  const nc = COMPONENTS[acc.type];
  const ct = acc.componentType;
  const cb = TYPE_BYTES[ct];
  const count = acc.count;
  const out = asIndex ? new Uint32Array(count * nc) : new Float32Array(count * nc);
  if (acc.bufferView === undefined) return out; // all zeros by spec
  const bv = json.bufferViews[acc.bufferView];
  if ((bv.buffer || 0) !== 0) throw new Error('glb-lite: only buffer 0 (the BIN chunk) is supported');
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = bv.byteStride || nc * cb;
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  if (base + stride * (count - 1) + nc * cb > bin.byteLength) {
    throw new Error('glb-lite: accessor ' + index + ' runs past the BIN chunk');
  }
  // Fast path: tightly packed float32 at an aligned offset.
  if (!asIndex && ct === 5126 && stride === nc * 4 && ((bin.byteOffset + base) & 3) === 0) {
    out.set(new Float32Array(bin.buffer, bin.byteOffset + base, count * nc));
    return out;
  }
  const norm = !!acc.normalized && !asIndex;
  let o = 0;
  for (let i = 0; i < count; i++) {
    const p = base + i * stride;
    for (let c = 0; c < nc; c++) {
      const v = readComponent(dv, p + c * cb, ct);
      out[o++] = norm ? normalize(v, ct) : v;
    }
  }
  return out;
}

// ---- 4x4 column-major matrices -------------------------------------------
function mIdentity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
function mMul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
function mTRS(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
function nodeMatrix(n) {
  if (n.matrix) return n.matrix.slice();
  return mTRS(n.translation, n.rotation, n.scale);
}
// Normal matrix: inverse transpose of the upper 3x3 (row-major 9 out).
function normalMatrix(m) {
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1;
  const inv = 1 / det;
  // cofactor matrix / det, which is the inverse transpose
  return [
    A * inv, B * inv, C * inv,
    -(b * i - c * h) * inv, (a * i - c * g) * inv, -(a * h - b * g) * inv,
    (b * f - c * e) * inv, -(a * f - c * d) * inv, (a * e - b * d) * inv,
  ];
}
function isIdentity(m) {
  const I = mIdentity();
  for (let k = 0; k < 16; k++) if (Math.abs(m[k] - I[k]) > 1e-9) return false;
  return true;
}

function transformAttrs(prim, m) {
  if (isIdentity(m)) return;
  const P = prim.positions;
  for (let k = 0; k < P.length; k += 3) {
    const x = P[k], y = P[k + 1], z = P[k + 2];
    P[k] = m[0] * x + m[4] * y + m[8] * z + m[12];
    P[k + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    P[k + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  const nm = normalMatrix(m);
  const xf = (A, step) => {
    if (!A) return;
    for (let k = 0; k < A.length; k += step) {
      const x = A[k], y = A[k + 1], z = A[k + 2];
      let X = nm[0] * x + nm[1] * y + nm[2] * z;
      let Y = nm[3] * x + nm[4] * y + nm[5] * z;
      let Z = nm[6] * x + nm[7] * y + nm[8] * z;
      const l = Math.hypot(X, Y, Z) || 1;
      A[k] = X / l; A[k + 1] = Y / l; A[k + 2] = Z / l;
    }
  };
  xf(prim.normals, 3);
  // Tangents transform with the model matrix (they lie in the surface).
  if (prim.tangents) {
    const T = prim.tangents;
    for (let k = 0; k < T.length; k += 4) {
      const x = T[k], y = T[k + 1], z = T[k + 2];
      const X = m[0] * x + m[4] * y + m[8] * z;
      const Y = m[1] * x + m[5] * y + m[9] * z;
      const Z = m[2] * x + m[6] * y + m[10] * z;
      const l = Math.hypot(X, Y, Z) || 1;
      T[k] = X / l; T[k + 1] = Y / l; T[k + 2] = Z / l;
    }
  }
  // A mirror matrix flips the winding.
  const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
  if (det < 0) {
    const I = prim.indices;
    for (let k = 0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; }
  }
}

function texTransformUV(uvs, tex) {
  const ext = tex && tex.extensions && tex.extensions.KHR_texture_transform;
  if (!ext || !uvs) return;
  const [ox, oy] = ext.offset || [0, 0];
  const r = ext.rotation || 0;
  const [sx, sy] = ext.scale || [1, 1];
  const c = Math.cos(r), s = Math.sin(r);
  for (let k = 0; k < uvs.length; k += 2) {
    const u = uvs[k] * sx, v = uvs[k + 1] * sy;
    uvs[k] = c * u + s * v + ox;
    uvs[k + 1] = -s * u + c * v + oy;
  }
}

function imageOf(json, bin, images, texInfo) {
  if (!texInfo || texInfo.index === undefined) return null;
  const tex = json.textures && json.textures[texInfo.index];
  if (!tex) return null;
  const ext = tex.extensions || {};
  let src = tex.source;
  if (ext.EXT_texture_webp && ext.EXT_texture_webp.source !== undefined) src = ext.EXT_texture_webp.source;
  if (src === undefined && ext.KHR_texture_basisu) return null;
  if (src === undefined) return null;
  if (!images[src]) {
    const im = json.images[src];
    if (im.bufferView === undefined) throw new Error('glb-lite: image ' + src + ' is not embedded (uri images are not supported)');
    const bv = json.bufferViews[im.bufferView];
    const bytes = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    images[src] = { bytes, mime: im.mimeType || sniffMime(bytes), index: src };
  }
  return images[src];
}

function sniffMime(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  return 'application/octet-stream';
}

function readMaterial(json, bin, images, mi) {
  const m = (mi !== undefined && json.materials && json.materials[mi]) || {};
  const pbr = m.pbrMetallicRoughness || {};
  const baseColor = imageOf(json, bin, images, pbr.baseColorTexture);
  const orm = imageOf(json, bin, images, pbr.metallicRoughnessTexture);
  const occ = imageOf(json, bin, images, m.occlusionTexture);
  return {
    name: m.name || '',
    baseColor,
    normal: imageOf(json, bin, images, m.normalTexture),
    orm: orm || occ,
    occlusion: occ && orm && occ !== orm ? occ : null,
    emissive: imageOf(json, bin, images, m.emissiveTexture),
    baseColorFactor: pbr.baseColorFactor ? pbr.baseColorFactor.slice() : [1, 1, 1, 1],
    metallicFactor: pbr.metallicFactor ?? 1,
    roughnessFactor: pbr.roughnessFactor ?? 1,
    normalScale: (m.normalTexture && m.normalTexture.scale) ?? 1,
    occlusionStrength: (m.occlusionTexture && m.occlusionTexture.strength) ?? 1,
    alphaMode: m.alphaMode || 'OPAQUE',
    alphaCutoff: m.alphaCutoff ?? 0.5,
    doubleSided: !!m.doubleSided,
    extras: m.extras || null,
    _baseTex: pbr.baseColorTexture || null,
  };
}

function readPrimitive(json, bin, p) {
  const mode = p.mode ?? 4;
  if (mode !== 4) return null; // triangles only
  const a = p.attributes;
  if (a.POSITION === undefined) return null;
  const positions = readAccessor(json, bin, a.POSITION);
  const vc = positions.length / 3;
  const prim = {
    positions,
    normals: a.NORMAL !== undefined ? readAccessor(json, bin, a.NORMAL) : null,
    uvs: a.TEXCOORD_0 !== undefined ? readAccessor(json, bin, a.TEXCOORD_0) : null,
    tangents: a.TANGENT !== undefined ? readAccessor(json, bin, a.TANGENT) : null,
    colors: null,
    indices: null,
    materialIndex: p.material,
  };
  if (a.COLOR_0 !== undefined) {
    const c = readAccessor(json, bin, a.COLOR_0);
    const nc = COMPONENTS[json.accessors[a.COLOR_0].type];
    if (nc === 4) prim.colors = c;
    else {
      prim.colors = new Float32Array(vc * 4);
      for (let i = 0; i < vc; i++) {
        prim.colors[i * 4] = c[i * 3]; prim.colors[i * 4 + 1] = c[i * 3 + 1];
        prim.colors[i * 4 + 2] = c[i * 3 + 2]; prim.colors[i * 4 + 3] = 1;
      }
    }
  }
  if (p.indices !== undefined) prim.indices = readAccessor(json, bin, p.indices, true);
  else { prim.indices = new Uint32Array(vc); for (let i = 0; i < vc; i++) prim.indices[i] = i; }
  return prim;
}

function boundsOf(P) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < P.length; k += 3) {
    for (let c = 0; c < 3; c++) {
      const v = P[k + c];
      if (v < min[c]) min[c] = v;
      if (v > max[c]) max[c] = v;
    }
  }
  return { min, max };
}

function mergePrims(list) {
  if (list.length === 1) return list[0];
  let vc = 0, ic = 0;
  const has = { normals: true, uvs: true, tangents: true, colors: true };
  for (const p of list) {
    vc += p.positions.length / 3; ic += p.indices.length;
    for (const k in has) if (!p[k]) has[k] = false;
  }
  const out = {
    positions: new Float32Array(vc * 3),
    normals: has.normals ? new Float32Array(vc * 3) : null,
    uvs: has.uvs ? new Float32Array(vc * 2) : null,
    tangents: has.tangents ? new Float32Array(vc * 4) : null,
    colors: has.colors ? new Float32Array(vc * 4) : null,
    indices: new Uint32Array(ic),
    materialIndex: list[0].materialIndex,
  };
  let vo = 0, io = 0;
  for (const p of list) {
    const n = p.positions.length / 3;
    out.positions.set(p.positions, vo * 3);
    if (out.normals) out.normals.set(p.normals, vo * 3);
    if (out.uvs) out.uvs.set(p.uvs, vo * 2);
    if (out.tangents) out.tangents.set(p.tangents, vo * 4);
    if (out.colors) out.colors.set(p.colors, vo * 4);
    for (let k = 0; k < p.indices.length; k++) out.indices[io + k] = p.indices[k] + vo;
    vo += n; io += p.indices.length;
  }
  return out;
}

export function parseGLB(buffer, opts = {}) {
  const bake = opts.bake !== false;
  const merge = opts.merge !== false;
  const ab = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const dv = new DataView(ab);
  if (ab.byteLength < 20 || dv.getUint32(0, true) !== MAGIC) throw new Error('glb-lite: not a GLB file');
  if (dv.getUint32(4, true) !== 2) throw new Error('glb-lite: only glTF 2.0 is supported');
  const total = dv.getUint32(8, true);
  let off = 12, json = null, bin = new Uint8Array(0);
  while (off + 8 <= Math.min(total, ab.byteLength)) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const body = new Uint8Array(ab, off + 8, len);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(body));
    else if (type === CHUNK_BIN && bin.byteLength === 0) bin = body;
    off += 8 + len + ((4 - (len & 3)) & 3);
  }
  if (!json) throw new Error('glb-lite: no JSON chunk');
  const req = json.extensionsRequired || [];
  for (const e of req) {
    if (e === 'KHR_draco_mesh_compression' || e === 'EXT_meshopt_compression' || e === 'KHR_mesh_quantization') {
      throw new Error('glb-lite: unsupported required extension ' + e);
    }
  }

  const images = [];
  const matCache = new Map();
  const material = (mi) => {
    const key = mi ?? -1;
    if (!matCache.has(key)) matCache.set(key, readMaterial(json, bin, images, mi));
    return matCache.get(key);
  };

  // Collect primitives with world matrices from the scene graph.
  const prims = [];
  const scene = json.scenes ? json.scenes[json.scene ?? 0] : null;
  const roots = scene ? scene.nodes : (json.nodes || []).map((_, i) => i);
  const visit = (ni, parent) => {
    const n = json.nodes[ni];
    const m = mMul(parent, nodeMatrix(n));
    if (n.mesh !== undefined) {
      const mesh = json.meshes[n.mesh];
      for (const p of mesh.primitives) {
        const prim = readPrimitive(json, bin, p);
        if (!prim) continue;
        prim.name = mesh.name || n.name || '';
        if (bake) transformAttrs(prim, m);
        else prim.matrix = m;
        prims.push(prim);
      }
    }
    for (const c of n.children || []) visit(c, m);
  };
  if (json.nodes) for (const r of roots) visit(r, mIdentity());
  else if (json.meshes) { // meshes with no nodes: read them as is
    for (const mesh of json.meshes) for (const p of mesh.primitives) {
      const prim = readPrimitive(json, bin, p); if (prim) { prim.name = mesh.name || ''; prims.push(prim); }
    }
  }

  let groups;
  if (merge && bake) {
    const by = new Map();
    for (const p of prims) {
      const k = p.materialIndex ?? -1;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(p);
    }
    groups = [...by.values()].map((list) => { const g = mergePrims(list); g.name = list[0].name; return g; });
  } else groups = prims;

  const meshes = groups.map((p) => {
    const mat = material(p.materialIndex);
    if (mat._baseTex) texTransformUV(p.uvs, mat._baseTex);
    return {
      name: p.name,
      positions: p.positions, normals: p.normals, uvs: p.uvs, tangents: p.tangents, colors: p.colors,
      indices: p.indices,
      vertexCount: p.positions.length / 3,
      triangleCount: p.indices.length / 3,
      bounds: boundsOf(p.positions),
      matrix: p.matrix,
      material: mat,
    };
  });
  for (const m of matCache.values()) delete m._baseTex;

  const out = {
    meshes,
    images: images.filter(Boolean),
    json,
    extras: (scene && scene.extras) || json.asset?.extras || null,
    triangleCount: meshes.reduce((s, m) => s + m.triangleCount, 0),
    vertexCount: meshes.reduce((s, m) => s + m.vertexCount, 0),
  };
  out.bounds = sceneBounds(out);
  return out;
}

export function sceneBounds(scene) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const m of scene.meshes) for (let c = 0; c < 3; c++) {
    min[c] = Math.min(min[c], m.bounds.min[c]); max[c] = Math.max(max[c], m.bounds.max[c]);
  }
  return { min, max };
}

// ---- browser loader --------------------------------------------------------

let lastLib = null;

async function fetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('glb-lite: ' + r.status + ' ' + url);
  return r.arrayBuffer(); // never size from content-length (the site gzips)
}

async function bitmapFrom(bytes, mime) {
  const blob = new Blob([bytes], { type: mime });
  return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

export async function loadNatureManifest(baseUrl) {
  const base = String(baseUrl).replace(/\/?$/, '/');
  const r = await fetch(base + 'manifest.json');
  if (!r.ok) throw new Error('glb-lite: manifest ' + r.status);
  const manifest = await r.json();
  const assets = new Map(manifest.assets.map((a) => [a.id, a]));
  const cache = new Map();
  const url = (p) => new URL(p, new URL(base, typeof location !== 'undefined' ? location.href : undefined)).href;
  const lib = {
    baseUrl: base,
    manifest,
    assets,
    url,
    byKind: (kind) => manifest.assets.filter((a) => a.kind === kind),
    byBiome: (b) => manifest.assets.filter((a) => (a.biomes || []).includes(b)),
    defaults: () => manifest.assets.filter((a) => a.default),
    async loadAsset(id, lod = 0) {
      const rec = assets.get(id);
      if (!rec) throw new Error('glb-lite: unknown asset ' + id);
      if (!rec.lods || !rec.lods.length) throw new Error('glb-lite: asset ' + id + ' has no models');
      const li = Math.max(0, Math.min(rec.lods.length - 1, lod | 0));
      const key = id + '#' + li;
      if (!cache.has(key)) {
        cache.set(key, (async () => {
          const scene = parseGLB(await fetchBytes(url(rec.lods[li].file)));
          const bitmaps = new Map();
          await Promise.all(scene.images.map(async (im) => {
            bitmaps.set(im.index, await bitmapFrom(im.bytes, im.mime));
          }));
          return { record: rec, lod: li, scene, bitmaps };
        })());
        cache.get(key).catch(() => cache.delete(key));
      }
      return cache.get(key);
    },
    async loadImpostor(id) {
      const rec = assets.get(id);
      if (!rec || !rec.impostor) return null;
      const im = rec.impostor;
      const [a, n] = await Promise.all([im.albedo, im.normal].map(async (p) => p ? bitmapFrom(await fetchBytes(url(p)), 'image/webp') : null));
      return { record: rec, impostor: im, albedo: a, normal: n };
    },
    async loadGround(ids) {
      const list = (ids || manifest.groundLayers || []).map((g) => assets.get(g)).filter(Boolean);
      return Promise.all(list.map(async (rec) => {
        const t = rec.textures;
        const get = async (p) => p ? bitmapFrom(await fetchBytes(url(p)), 'image/webp') : null;
        const [albedo, normal, orm] = await Promise.all([get(t.albedo), get(t.normal), get(t.orm)]);
        return { record: rec, albedo, normal, orm };
      }));
    },
  };
  lastLib = lib;
  return lib;
}

export function loadAsset(id, lod = 0) {
  if (!lastLib) return Promise.reject(new Error('glb-lite: call loadNatureManifest first'));
  return lastLib.loadAsset(id, lod);
}
