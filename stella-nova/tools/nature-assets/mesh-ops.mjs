// Geometry steps of the nature asset build (DOM-free, no dependencies).
// grep -n names: gltfToGLB, collectVariants, weld, islands, decimateIslands,
// compact, bounds, baseCentre, writeGLB.
//
// A "part" is the geometry of one material in one variant:
//   { material (glb-lite Material), positions, normals, uvs, indices (Uint32Array) }

// Pack a .gltf JSON + its single .bin into one GLB buffer in memory, so
// lib/glb-lite.js can read Poly Haven sources. Images stay as uri.
export function gltfToGLB(json, bin) {
  const j = structuredClone(json);
  if (j.buffers.length !== 1) throw new Error('gltfToGLB: expects one buffer');
  delete j.buffers[0].uri;
  j.buffers[0].byteLength = bin.byteLength;
  const js = new TextEncoder().encode(JSON.stringify(j));
  const jpad = (4 - (js.length & 3)) & 3, bpad = (4 - (bin.byteLength & 3)) & 3;
  const total = 12 + 8 + js.length + jpad + 8 + bin.byteLength + bpad;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.length + jpad, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(js, 20); out.fill(0x20, 20 + js.length, 20 + js.length + jpad);
  const b0 = 20 + js.length + jpad;
  dv.setUint32(b0, bin.byteLength + bpad, true); dv.setUint32(b0 + 4, 0x004e4942, true);
  out.set(bin, b0 + 8);
  return out.buffer;
}

// Group glb-lite meshes (parsed with merge: false) into variants by top
// level node, then merge each variant's meshes by material.
export function collectVariants(scene, mode) {
  const by = new Map();
  for (const m of scene.meshes) {
    const key = mode === 'nodes' ? m.root : 0;
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(m);
  }
  const variants = [];
  for (const [root, list] of by) {
    const mats = new Map();
    for (const m of list) {
      const k = m.material;
      if (!mats.has(k)) mats.set(k, []);
      mats.get(k).push(m);
    }
    const parts = [];
    for (const [material, ms] of mats) parts.push(mergeParts(material, ms));
    const name = scene.json.nodes[root] ? scene.json.nodes[root].name : 'all';
    variants.push({ root, name, parts });
  }
  return variants;
}

function mergeParts(material, ms) {
  let vc = 0, ic = 0;
  for (const m of ms) { vc += m.vertexCount; ic += m.indices.length; }
  const p = { material, positions: new Float32Array(vc * 3), normals: new Float32Array(vc * 3), uvs: new Float32Array(vc * 2), indices: new Uint32Array(ic) };
  let vo = 0, io = 0;
  for (const m of ms) {
    p.positions.set(m.positions, vo * 3);
    if (m.normals) p.normals.set(m.normals, vo * 3);
    if (m.uvs) p.uvs.set(m.uvs, vo * 2);
    for (let k = 0; k < m.indices.length; k++) p.indices[io + k] = m.indices[k] + vo;
    vo += m.vertexCount; io += m.indices.length;
  }
  if (ms.some((m) => !m.normals)) computeNormals(p);
  return p;
}

export function computeNormals(p) {
  const P = p.positions, N = new Float32Array(P.length), I = p.indices;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { N[v] += nx; N[v + 1] += ny; N[v + 2] += nz; }
  }
  for (let k = 0; k < N.length; k += 3) { const l = Math.hypot(N[k], N[k + 1], N[k + 2]) || 1; N[k] /= l; N[k + 1] /= l; N[k + 2] /= l; }
  p.normals = N;
}

// Merge vertices with equal position, normal and uv (after rounding).
// Drops degenerate triangles and unused vertices.
export function weld(p) {
  const P = p.positions, N = p.normals, U = p.uvs;
  const vc = P.length / 3;
  const map = new Map();
  const remap = new Uint32Array(vc);
  const keep = [];
  const q = (x, s) => Math.round(x * s);
  for (let v = 0; v < vc; v++) {
    const key = q(P[v * 3], 1e5) + ',' + q(P[v * 3 + 1], 1e5) + ',' + q(P[v * 3 + 2], 1e5) + ',' +
      q(N[v * 3], 1e3) + ',' + q(N[v * 3 + 1], 1e3) + ',' + q(N[v * 3 + 2], 1e3) + ',' +
      q(U[v * 2], 1e5) + ',' + q(U[v * 2 + 1], 1e5);
    let r = map.get(key);
    if (r === undefined) { r = keep.length; keep.push(v); map.set(key, r); }
    remap[v] = r;
  }
  const I = [];
  for (let t = 0; t < p.indices.length; t += 3) {
    const a = remap[p.indices[t]], b = remap[p.indices[t + 1]], c = remap[p.indices[t + 2]];
    if (a !== b && b !== c && a !== c) I.push(a, b, c);
  }
  return compact({ ...p, indices: Uint32Array.from(I) }, keep);
}

// Keep only the vertices that the index buffer uses (or the given list).
export function compact(p, order) {
  let keep = order;
  if (!keep) {
    const used = new Int32Array(p.positions.length / 3).fill(-1);
    keep = [];
    for (const v of p.indices) if (used[v] < 0) { used[v] = keep.length; keep.push(v); }
    const I = new Uint32Array(p.indices.length);
    for (let k = 0; k < I.length; k++) I[k] = used[p.indices[k]];
    p = { ...p, indices: I };
  }
  const n = keep.length;
  const out = { ...p, positions: new Float32Array(n * 3), normals: new Float32Array(n * 3), uvs: new Float32Array(n * 2) };
  for (let i = 0; i < n; i++) {
    const v = keep[i];
    out.positions[i * 3] = p.positions[v * 3]; out.positions[i * 3 + 1] = p.positions[v * 3 + 1]; out.positions[i * 3 + 2] = p.positions[v * 3 + 2];
    out.normals[i * 3] = p.normals[v * 3]; out.normals[i * 3 + 1] = p.normals[v * 3 + 1]; out.normals[i * 3 + 2] = p.normals[v * 3 + 2];
    out.uvs[i * 2] = p.uvs[v * 2]; out.uvs[i * 2 + 1] = p.uvs[v * 2 + 1];
  }
  return out;
}

// Connected components by shared position (union find over triangles).
export function islands(p) {
  const vc = p.positions.length / 3;
  const P = p.positions;
  // Position ids so that uv seams do not split an island.
  const pid = new Uint32Array(vc);
  const m = new Map();
  for (let v = 0; v < vc; v++) {
    const k = Math.round(P[v * 3] * 1e5) + ',' + Math.round(P[v * 3 + 1] * 1e5) + ',' + Math.round(P[v * 3 + 2] * 1e5);
    let r = m.get(k); if (r === undefined) { r = m.size; m.set(k, r); } pid[v] = r;
  }
  const parent = new Uint32Array(m.size);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const I = p.indices;
  for (let t = 0; t < I.length; t += 3) {
    const a = find(pid[I[t]]), b = find(pid[I[t + 1]]), c = find(pid[I[t + 2]]);
    if (a !== b) parent[a] = b;
    const b2 = find(b);
    if (find(c) !== b2) parent[find(c)] = b2;
  }
  const tri = new Uint32Array(I.length / 3);
  const ids = new Map();
  for (let t = 0; t < tri.length; t++) {
    const r = find(pid[I[t * 3]]);
    let id = ids.get(r); if (id === undefined) { id = ids.size; ids.set(r, id); }
    tri[t] = id;
  }
  return { count: ids.size, triIsland: tri };
}

// Foliage LOD: keep a seeded random share of the islands (leaves, twig
// cards, grass blades) and scale each kept island about its centre so
// the crown keeps its cover. scaleCap limits the growth.
// box (optional { min, max }): no island grows out of it, so the height,
// footprint and base of the asset stay the same.
export function decimateIslands(p, keepFrac, seed = 1, scaleCap = 1.8, box = null) {
  if (keepFrac >= 1) return p;
  const { count, triIsland } = islands(p);
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const keep = new Uint8Array(count);
  for (let i = 0; i < count; i++) keep[i] = rnd() < keepFrac ? 1 : 0;
  // Always keep the island with the top vertex, so the height stays.
  let top = 0, topY = -Infinity;
  for (let t = 0; t < triIsland.length; t++) for (let k = 0; k < 3; k++) {
    const y = p.positions[p.indices[t * 3 + k] * 3 + 1];
    if (y > topY) { topY = y; top = triIsland[t]; }
  }
  keep[top] = 1;
  const scale = Math.min(scaleCap, 1 / Math.sqrt(Math.max(keepFrac, 1e-3)));
  const I = [];
  for (let t = 0; t < triIsland.length; t++) if (keep[triIsland[t]]) I.push(p.indices[t * 3], p.indices[t * 3 + 1], p.indices[t * 3 + 2]);
  const out = compact({ ...p, indices: Uint32Array.from(I) });
  // Scale each kept island about its centroid.
  const isl = islands(out);
  const cx = new Float64Array(isl.count * 4);
  const vIsl = new Int32Array(out.positions.length / 3).fill(-1);
  for (let t = 0; t < isl.triIsland.length; t++) for (let k = 0; k < 3; k++) vIsl[out.indices[t * 3 + k]] = isl.triIsland[t];
  for (let v = 0; v < vIsl.length; v++) {
    const i = vIsl[v]; cx[i * 4] += out.positions[v * 3]; cx[i * 4 + 1] += out.positions[v * 3 + 1]; cx[i * 4 + 2] += out.positions[v * 3 + 2]; cx[i * 4 + 3]++;
  }
  const sIsl = new Float64Array(isl.count).fill(scale);
  if (box) {
    for (let v = 0; v < vIsl.length; v++) {
      const i = vIsl[v], n = cx[i * 4 + 3];
      for (let c = 0; c < 3; c++) {
        const m = cx[i * 4 + c] / n, d = out.positions[v * 3 + c] - m;
        if (d > 1e-9) sIsl[i] = Math.min(sIsl[i], Math.max(1, (box.max[c] - m) / d));
        else if (d < -1e-9) sIsl[i] = Math.min(sIsl[i], Math.max(1, (box.min[c] - m) / d));
      }
    }
  }
  for (let v = 0; v < vIsl.length; v++) {
    const i = vIsl[v], n = cx[i * 4 + 3];
    for (let c = 0; c < 3; c++) {
      const m = cx[i * 4 + c] / n;
      out.positions[v * 3 + c] = m + (out.positions[v * 3 + c] - m) * sIsl[i];
    }
  }
  return out;
}

export function bounds(parts) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    const P = p.positions;
    for (let k = 0; k < P.length; k += 3) for (let c = 0; c < 3; c++) {
      if (P[k + c] < min[c]) min[c] = P[k + c];
      if (P[k + c] > max[c]) max[c] = P[k + c];
    }
  }
  return { min, max };
}

// The base centre: for upright plants and trees, the mean xz of the
// vertices in the lowest slice (the trunk or stem foot); for the rest,
// the centre of the xz box. y = 0 at the lowest vertex.
export function baseCentre(parts, upright) {
  const b = bounds(parts);
  let x = (b.min[0] + b.max[0]) / 2, z = (b.min[2] + b.max[2]) / 2;
  if (upright) {
    const h = b.max[1] - b.min[1];
    const lim = b.min[1] + 0.04 * h;
    let sx = 0, sz = 0, n = 0;
    for (const p of parts) {
      const P = p.positions;
      for (let k = 0; k < P.length; k += 3) if (P[k + 1] <= lim) { sx += P[k]; sz += P[k + 2]; n++; }
    }
    if (n > 8) { x = sx / n; z = sz / n; }
  }
  return [x, b.min[1], z];
}

export function translate(parts, o) {
  for (const p of parts) {
    const P = p.positions;
    for (let k = 0; k < P.length; k += 3) { P[k] -= o[0]; P[k + 1] -= o[1]; P[k + 2] -= o[2]; }
  }
}

// Write a GLB: one mesh, one primitive per part. Positions float32,
// normals int8 normalized (KHR_mesh_quantization), uvs float32, indices
// uint16 or uint32. Materials point at external WebP files by uri
// (EXT_texture_webp). mats[i] = { name, alphaMode, alphaCutoff,
// doubleSided, baseColorFactor, maps: { baseColor, normal, orm } uri }.
export function writeGLB(parts, mats, extras = {}) {
  const chunks = []; let off = 0;
  const views = [], accessors = [];
  const push = (arr, target) => {
    const b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (off & 3)) & 3;
    if (pad) { chunks.push(new Uint8Array(pad)); off += pad; }
    chunks.push(b);
    views.push({ buffer: 0, byteOffset: off, byteLength: b.byteLength, ...(target ? { target } : {}) });
    off += b.byteLength;
    return views.length - 1;
  };
  const prims = [];
  parts.forEach((p, i) => {
    const vc = p.positions.length / 3;
    const b = bounds([p]);
    const pos = push(p.positions, 34962);
    accessors.push({ bufferView: pos, componentType: 5126, count: vc, type: 'VEC3', min: b.min, max: b.max });
    const nq = new Int8Array(vc * 4);
    for (let v = 0; v < vc; v++) for (let c = 0; c < 3; c++) nq[v * 4 + c] = Math.max(-127, Math.min(127, Math.round(p.normals[v * 3 + c] * 127)));
    const nv = push(nq, 34962); views[nv].byteStride = 4;
    accessors.push({ bufferView: nv, componentType: 5120, normalized: true, count: vc, type: 'VEC3' });
    const uv = push(p.uvs, 34962);
    accessors.push({ bufferView: uv, componentType: 5126, count: vc, type: 'VEC2' });
    const idx = vc < 65536 ? Uint16Array.from(p.indices) : p.indices;
    const iv = push(idx, 34963);
    accessors.push({ bufferView: iv, componentType: idx instanceof Uint16Array ? 5123 : 5125, count: p.indices.length, type: 'SCALAR' });
    const a0 = accessors.length - 4;
    prims.push({ attributes: { POSITION: a0, NORMAL: a0 + 1, TEXCOORD_0: a0 + 2 }, indices: a0 + 3, material: i });
  });
  const images = [], textures = [], imgIndex = new Map();
  const tex = (uri) => {
    if (!uri) return undefined;
    if (!imgIndex.has(uri)) {
      images.push({ uri, mimeType: 'image/webp' });
      textures.push({ extensions: { EXT_texture_webp: { source: images.length - 1 } } });
      imgIndex.set(uri, textures.length - 1);
    }
    return { index: imgIndex.get(uri) };
  };
  const materials = mats.map((m) => {
    const o = {
      name: m.name,
      pbrMetallicRoughness: { baseColorFactor: m.baseColorFactor || [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
      doubleSided: !!m.doubleSided,
    };
    if (m.maps.baseColor) o.pbrMetallicRoughness.baseColorTexture = tex(m.maps.baseColor);
    if (m.maps.orm) { o.pbrMetallicRoughness.metallicRoughnessTexture = tex(m.maps.orm); o.occlusionTexture = tex(m.maps.orm); }
    if (m.maps.normal) o.normalTexture = tex(m.maps.normal);
    if (m.alphaMode && m.alphaMode !== 'OPAQUE') { o.alphaMode = m.alphaMode; o.alphaCutoff = m.alphaCutoff ?? 0.5; }
    if (m.extras) o.extras = m.extras;
    return o;
  });
  const binLen = off;
  const json = {
    asset: { version: '2.0', generator: 'davesgames.io nature-assets build', extras },
    extensionsUsed: ['KHR_mesh_quantization', 'EXT_texture_webp'],
    extensionsRequired: ['KHR_mesh_quantization', 'EXT_texture_webp'],
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: extras.id || 'asset' }],
    meshes: [{ name: extras.id || 'asset', primitives: prims }],
    materials, textures, images, accessors, bufferViews: views, buffers: [{ byteLength: binLen }],
  };
  const js = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (js.length & 3)) & 3, bpad = (4 - (binLen & 3)) & 3;
  const total = 12 + 8 + js.length + jpad + 8 + binLen + bpad;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.length + jpad, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(js, 20); out.fill(0x20, 20 + js.length, 20 + js.length + jpad);
  const b0 = 20 + js.length + jpad;
  dv.setUint32(b0, binLen + bpad, true); dv.setUint32(b0 + 4, 0x004e4942, true);
  let o = b0 + 8;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}
