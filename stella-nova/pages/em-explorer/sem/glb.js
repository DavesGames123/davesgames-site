// ============================================================================
//  EM EXPLORER  ·  sem/glb.js — reads the surface scan GLB files (SEM package)
// ----------------------------------------------------------------------------
//  parseGlb(arrayBuffer) -> { json, positions, normals, colors, uvs, indices,
//                             image, sizeUm, extras, credit }
//  The reader is for the files that sem/build/build.py writes (glTF 2.0,
//  one mesh, one primitive, KHR_mesh_quantization). It also reads plain
//  FLOAT attributes, so a standard GLB with one mesh works too.
//    positions  Float32Array xyz in um (the node scale and translation are
//               applied here, so the viewer has no quantization to undo)
//    normals    Float32Array xyz, unit length
//    colors     Float32Array grey 0..1 per vertex, or null
//    uvs        Float32Array uv 0..1, or null
//    indices    Uint16Array or Uint32Array
//    image      { mimeType, bytes: Uint8Array } or null (the SEM texture)
//  No DOM and no WebGL here, so node tests use the same code.
//
//  grep -n targets: "export function parseGlb", "function readAccessor"
// ============================================================================

const MAGIC = 0x46546c67, JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942;
const COMP = {
  5120: [Int8Array, 127], 5121: [Uint8Array, 255], 5122: [Int16Array, 32767],
  5123: [Uint16Array, 65535], 5125: [Uint32Array, 0], 5126: [Float32Array, 0],
};
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readAccessor(json, bin, index, wantFloat = true) {
  const a = json.accessors[index];
  if (!a) throw new Error('GLB: no accessor ' + index);
  const view = json.bufferViews[a.bufferView];
  const [Type, norm] = COMP[a.componentType] || [];
  if (!Type) throw new Error('GLB: component type ' + a.componentType);
  const n = NCOMP[a.type];
  const size = Type.BYTES_PER_ELEMENT;
  const stride = view.byteStride || size * n;
  const start = bin.byteOffset + (view.byteOffset || 0) + (a.byteOffset || 0);
  if (start - bin.byteOffset + stride * (a.count - 1) + size * n > bin.byteLength) throw new Error('GLB: accessor ' + index + ' runs past the buffer');
  if (!wantFloat) {
    // indices: copy (the view can be unaligned for its type)
    const out = new Type(a.count * n);
    const dv = new DataView(bin.buffer, start, stride * (a.count - 1) + size * n);
    const get = size === 1 ? (o) => dv.getUint8(o) : size === 2 ? (o) => dv.getUint16(o, true) : (o) => dv.getUint32(o, true);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = get(i * stride + k * size);
    return { data: out, n, count: a.count };
  }
  const out = new Float32Array(a.count * n);
  const dv = new DataView(bin.buffer, start, stride * (a.count - 1) + size * n);
  const getter = {
    5120: (o) => dv.getInt8(o), 5121: (o) => dv.getUint8(o), 5122: (o) => dv.getInt16(o, true),
    5123: (o) => dv.getUint16(o, true), 5125: (o) => dv.getUint32(o, true), 5126: (o) => dv.getFloat32(o, true),
  }[a.componentType];
  const scale = a.normalized && norm ? 1 / norm : 1;
  const signed = a.componentType === 5120 || a.componentType === 5122;
  for (let i = 0; i < a.count; i++) {
    for (let k = 0; k < n; k++) {
      let v = getter(i * stride + k * size) * scale;
      if (signed && a.normalized && v < -1) v = -1;
      out[i * n + k] = v;
    }
  }
  return { data: out, n, count: a.count };
}

export function parseGlb(buffer) {
  const ab = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const dv = new DataView(ab);
  if (ab.byteLength < 28 || dv.getUint32(0, true) !== MAGIC) throw new Error('not a GLB file');
  if (dv.getUint32(4, true) !== 2) throw new Error('GLB version ' + dv.getUint32(4, true));
  const total = dv.getUint32(8, true);
  if (total > ab.byteLength) throw new Error('GLB is cut short (' + ab.byteLength + ' of ' + total + ' bytes)');
  let off = 12, json = null, bin = null;
  while (off + 8 <= total) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const body = new Uint8Array(ab, off + 8, len);
    if (type === JSON_CHUNK) json = JSON.parse(new TextDecoder().decode(body));
    else if (type === BIN_CHUNK) bin = body;
    off += 8 + len;
  }
  if (!json || !bin) throw new Error('GLB has no JSON or no BIN chunk');
  const prim = json.meshes && json.meshes[0] && json.meshes[0].primitives[0];
  if (!prim) throw new Error('GLB has no mesh');
  const at = prim.attributes;
  const node = (json.nodes || []).find((n) => n.mesh === 0) || {};
  const S = node.scale || [1, 1, 1], T = node.translation || [0, 0, 0];
  const pos = readAccessor(json, bin, at.POSITION).data;
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] = pos[i] * S[0] + T[0]; pos[i + 1] = pos[i + 1] * S[1] + T[1]; pos[i + 2] = pos[i + 2] * S[2] + T[2];
  }
  let normals = null;
  if (at.NORMAL != null) {
    normals = readAccessor(json, bin, at.NORMAL).data;
    for (let i = 0; i < normals.length; i += 3) {
      const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
      normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l;
    }
  }
  let colors = null;
  if (at.COLOR_0 != null) {
    const c = readAccessor(json, bin, at.COLOR_0);
    colors = new Float32Array(c.count);
    for (let i = 0; i < c.count; i++) colors[i] = (c.data[i * c.n] + c.data[i * c.n + 1] + c.data[i * c.n + 2]) / 3;
  }
  const uvs = at.TEXCOORD_0 != null ? readAccessor(json, bin, at.TEXCOORD_0).data : null;
  const indices = prim.indices != null ? readAccessor(json, bin, prim.indices, false).data : null;
  let image = null;
  if (json.images && json.images.length && json.images[0].bufferView != null) {
    const v = json.bufferViews[json.images[0].bufferView];
    image = { mimeType: json.images[0].mimeType || 'image/jpeg', bytes: new Uint8Array(bin.buffer, bin.byteOffset + (v.byteOffset || 0), v.byteLength) };
  }
  const nv = pos.length / 3;
  if (indices) for (let i = 0; i < indices.length; i++) if (indices[i] >= nv) throw new Error('GLB index ' + indices[i] + ' is past ' + nv + ' vertices');
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { const v = pos[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  const extras = (json.asset && json.asset.extras) || {};
  return {
    json, positions: pos, normals, colors, uvs, indices, image, extras,
    credit: (json.asset && json.asset.copyright) || '',
    bounds: { lo, hi }, sizeUm: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]],
    vertexCount: nv, triangleCount: indices ? indices.length / 3 : nv / 3,
  };
}
