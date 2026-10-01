// ============================================================================
//  MATERIAL STUDIO  ·  glb.js — glTF 2.0 binary (.glb) writer
// ────────────────────────────────────────────────────────────────────────────
//  Owner: IO agent. Imported by export.js, not by main.js. No DOM code, so
//  Node can import it for tests.
//
//  DATA FLOW
//      export.js ─▶ buildGLB({mesh, images, material})
//        mesh      MeshData from mesh.js (or uvSphere below when mesh.js has
//                  no data), tangents added by computeTangents when missing
//        images    encoded PNG bytes; image i becomes texture i (one shared
//                  repeat sampler), so material textureInfo.index = image index
//        material  a glTF material object, extensions included
//      ─▶ one BIN buffer (indices, attributes, images, each 4-byte aligned)
//      ─▶ GLB header + JSON chunk + BIN chunk ─▶ ArrayBuffer
//
//  CONVENTIONS
//      glTF uv (0,0) is the top-left of the image, the same as the bake
//      texture space in contract.js, so uvs pass through unchanged.
//      extensionsUsed is collected from the material automatically.
//
//  CONTENTS  (grep -n the name to jump)
//      uvSphere ............ fallback preview mesh (positions, normals, uvs)
//      computeTangents ..... MikkTSpace-like per-vertex tangents from uvs
//      collectExtensions ... walk the material for KHR_* names
//      buildGLB ............ assemble the .glb
//      parseGLB ............ split a .glb into {json, bin} (tests and import)
// ============================================================================

/**
 * A UV sphere of radius 1. uv.x follows longitude, uv.y goes from the north
 * pole (0) to the south pole (1).
 * @param {number} [seg] longitude segments (latitude uses seg/2)
 * @returns {{positions:Float32Array, normals:Float32Array, uvs:Float32Array, indices:Uint32Array}}
 */
export function uvSphere(seg = 64) {
  const rings = Math.max(4, seg >> 1), cols = Math.max(8, seg);
  const nv = (rings + 1) * (cols + 1);
  const positions = new Float32Array(nv * 3), normals = new Float32Array(nv * 3), uvs = new Float32Array(nv * 2);
  let v = 0;
  for (let r = 0; r <= rings; r++) {
    const th = (r / rings) * Math.PI, st = Math.sin(th), ct = Math.cos(th);
    for (let c = 0; c <= cols; c++, v++) {
      const ph = (c / cols) * Math.PI * 2;
      const x = -Math.cos(ph) * st, z = Math.sin(ph) * st, y = ct;
      positions.set([x, y, z], v * 3); normals.set([x, y, z], v * 3); uvs.set([c / cols, r / rings], v * 2);
    }
  }
  const idx = [];
  for (let r = 0; r < rings; r++) for (let c = 0; c < cols; c++) {
    const a = r * (cols + 1) + c, b = a + cols + 1;
    if (r > 0) idx.push(a, b, a + 1);
    if (r < rings - 1) idx.push(a + 1, b, b + 1);
  }
  return { positions, normals, uvs, indices: new Uint32Array(idx) };
}

/**
 * Per-vertex tangents (vec4, w = bitangent sign) from positions, normals and
 * uvs, Gram-Schmidt against the normal. glTF rebuilds the bitangent as
 * cross(normal, tangent.xyz) * w, and that bitangent must point up the image.
 * @param {{positions:Float32Array, normals:Float32Array, uvs:Float32Array, indices:Uint32Array|Uint16Array}} m
 * @returns {Float32Array}
 */
export function computeTangents(m) {
  const n = m.positions.length / 3;
  const t1 = new Float64Array(n * 3), t2 = new Float64Array(n * 3);
  const P = m.positions, U = m.uvs, I = m.indices;
  for (let i = 0; i < I.length; i += 3) {
    const a = I[i], b = I[i + 1], c = I[i + 2];
    const x1 = P[b * 3] - P[a * 3], y1 = P[b * 3 + 1] - P[a * 3 + 1], z1 = P[b * 3 + 2] - P[a * 3 + 2];
    const x2 = P[c * 3] - P[a * 3], y2 = P[c * 3 + 1] - P[a * 3 + 1], z2 = P[c * 3 + 2] - P[a * 3 + 2];
    const s1 = U[b * 2] - U[a * 2], v1 = U[b * 2 + 1] - U[a * 2 + 1];
    const s2 = U[c * 2] - U[a * 2], v2 = U[c * 2 + 1] - U[a * 2 + 1];
    const d = (s1 * v2) - (s2 * v1);
    if (Math.abs(d) < 1e-12) continue;
    const r = 1 / d;
    const sx = ((v2 * x1) - (v1 * x2)) * r, sy = ((v2 * y1) - (v1 * y2)) * r, sz = ((v2 * z1) - (v1 * z2)) * r;
    const tx = ((s1 * x2) - (s2 * x1)) * r, ty = ((s1 * y2) - (s2 * y1)) * r, tz = ((s1 * z2) - (s2 * z1)) * r;
    for (const k of [a, b, c]) {
      t1[k * 3] += sx; t1[k * 3 + 1] += sy; t1[k * 3 + 2] += sz;
      t2[k * 3] += tx; t2[k * 3 + 1] += ty; t2[k * 3 + 2] += tz;
    }
  }
  const out = new Float32Array(n * 4), N = m.normals;
  for (let k = 0; k < n; k++) {
    const nx = N[k * 3], ny = N[k * 3 + 1], nz = N[k * 3 + 2];
    let tx = t1[k * 3], ty = t1[k * 3 + 1], tz = t1[k * 3 + 2];
    const dn = (nx * tx) + (ny * ty) + (nz * tz);
    tx -= nx * dn; ty -= ny * dn; tz -= nz * dn;
    let len = Math.hypot(tx, ty, tz);
    if (len < 1e-8) { // any vector orthogonal to n
      if (Math.abs(nx) < 0.9) { tx = 0; ty = -nz; tz = ny; } else { tx = nz; ty = 0; tz = -nx; }
      len = Math.hypot(tx, ty, tz) || 1;
    }
    tx /= len; ty /= len; tz /= len;
    // glTF v grows down the image, and a normal map has +Y up the image. So
    // the bitangent cross(n, t) * w must point along -dP/dv (image up). t2
    // holds dP/dv, so w is -1 when cross(n, t) already points along +dP/dv.
    const bx = (ny * tz) - (nz * ty), by = (nz * tx) - (nx * tz), bz = (nx * ty) - (ny * tx);
    const w = ((bx * t2[k * 3]) + (by * t2[k * 3 + 1]) + (bz * t2[k * 3 + 2])) > 0 ? -1 : 1;
    out.set([tx, ty, tz, w], k * 4);
  }
  return out;
}

/** Collect every KHR_/EXT_ extension name used inside a glTF object tree. */
export function collectExtensions(obj, set = new Set()) {
  if (!obj || typeof obj !== 'object') return set;
  if (Array.isArray(obj)) { for (const v of obj) collectExtensions(v, set); return set; }
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'extensions' && v && typeof v === 'object') for (const name of Object.keys(v)) set.add(name);
    collectExtensions(v, set);
  }
  return set;
}

const align4 = n => (n + 3) & ~3;

/**
 * Build a .glb.
 * @param {{
 *   mesh:{positions:Float32Array, normals?:Float32Array, uvs?:Float32Array, tangents?:Float32Array, indices?:Uint32Array|Uint16Array},
 *   images?:Array<{name?:string, mime?:string, data:Uint8Array}>,
 *   material:object, name?:string, generator?:string, copyright?:string,
 *   extras?:object, nodeScale?:number
 * }} opts
 * @returns {ArrayBuffer}
 */
export function buildGLB(opts) {
  const m = opts.mesh;
  if (!m || !m.positions) throw new Error('glb: mesh.positions is missing');
  const nv = m.positions.length / 3;
  const name = opts.name || 'material';
  let indices = m.indices;
  if (!indices) { indices = new Uint32Array(nv); for (let i = 0; i < nv; i++) indices[i] = i; }
  let maxIdx = 0; for (let i = 0; i < indices.length; i++) if (indices[i] > maxIdx) maxIdx = indices[i];
  if (maxIdx >= nv) throw new Error(`glb: index ${maxIdx} is out of range (${nv} vertices)`);
  const idx = maxIdx < 65536 ? Uint16Array.from(indices) : (indices instanceof Uint32Array ? indices : Uint32Array.from(indices));
  const tangents = m.tangents || (m.normals && m.uvs ? computeTangents({ ...m, indices }) : null);

  const parts = [], bufferViews = [], accessors = [];
  let byteLength = 0;
  const addView = (bytes, target) => {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const view = { buffer: 0, byteOffset: byteLength, byteLength: u8.length };
    if (target) view.target = target;
    parts.push({ offset: byteLength, u8 });
    byteLength = align4(byteLength + u8.length);
    bufferViews.push(view);
    return bufferViews.length - 1;
  };
  const addAccessor = (arr, type, compType, target, withMinMax) => {
    const view = addView(arr, target);
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    const acc = { bufferView: view, componentType: compType, count: arr.length / comps, type };
    if (withMinMax) {
      const min = new Array(comps).fill(Infinity), max = new Array(comps).fill(-Infinity);
      for (let i = 0; i < arr.length; i++) { const c = i % comps; if (arr[i] < min[c]) min[c] = arr[i]; if (arr[i] > max[c]) max[c] = arr[i]; }
      acc.min = min; acc.max = max;
    }
    accessors.push(acc);
    return accessors.length - 1;
  };

  const attributes = {};
  const iAcc = addAccessor(idx, 'SCALAR', idx instanceof Uint16Array ? 5123 : 5125, 34963, false);
  attributes.POSITION = addAccessor(m.positions, 'VEC3', 5126, 34962, true);
  if (m.normals) attributes.NORMAL = addAccessor(m.normals, 'VEC3', 5126, 34962, false);
  if (tangents) attributes.TANGENT = addAccessor(tangents, 'VEC4', 5126, 34962, false);
  if (m.uvs) attributes.TEXCOORD_0 = addAccessor(m.uvs, 'VEC2', 5126, 34962, false);

  const images = (opts.images || []).map((im, i) => ({
    name: im.name || `image${i}`, mimeType: im.mime || 'image/png', bufferView: addView(im.data),
  }));
  const textures = images.map((_, i) => ({ sampler: 0, source: i }));

  const json = {
    asset: { version: '2.0', generator: opts.generator || 'Stella Nova PBR Material Studio' },
    scene: 0,
    scenes: [{ name, nodes: [0] }],
    nodes: [{ name, mesh: 0, ...(opts.nodeScale && opts.nodeScale !== 1 ? { scale: [opts.nodeScale, opts.nodeScale, opts.nodeScale] } : {}) }],
    meshes: [{ name, primitives: [{ attributes, indices: iAcc, material: 0, mode: 4 }] }],
    materials: [opts.material],
    accessors, bufferViews,
    buffers: [{ byteLength }],
  };
  if (opts.copyright) json.asset.copyright = opts.copyright;
  if (opts.extras) json.asset.extras = opts.extras;
  if (images.length) {
    json.images = images; json.textures = textures;
    json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
  }
  const ext = [...collectExtensions(json.materials)];
  if (ext.length) json.extensionsUsed = ext;

  const bin = new Uint8Array(byteLength);
  for (const p of parts) bin.set(p.u8, p.offset);
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = align4(jsonBytes.length);
  const total = 12 + 8 + jsonLen + 8 + byteLength;
  const out = new ArrayBuffer(total), dv = new DataView(out), u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4E4F534A, true);
  u8.set(jsonBytes, 20); u8.fill(0x20, 20 + jsonBytes.length, 20 + jsonLen);
  dv.setUint32(20 + jsonLen, byteLength, true); dv.setUint32(24 + jsonLen, 0x004E4942, true);
  u8.set(bin, 28 + jsonLen);
  return out;
}

/** Split a .glb. @param {ArrayBuffer|Uint8Array} buf @returns {{json:object, bin:Uint8Array|null, version:number}} */
export function parseGLB(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('glb: bad magic');
  const version = dv.getUint32(4, true), total = dv.getUint32(8, true);
  if (total !== u8.byteLength) throw new Error(`glb: header length ${total} is not the file length ${u8.byteLength}`);
  let p = 12, json = null, bin = null;
  while (p < total) {
    const len = dv.getUint32(p, true), type = dv.getUint32(p + 4, true);
    const body = u8.subarray(p + 8, p + 8 + len);
    if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(body));
    else if (type === 0x004E4942) bin = body;
    p += 8 + len;
  }
  if (!json) throw new Error('glb: no JSON chunk');
  return { json, bin, version };
}
