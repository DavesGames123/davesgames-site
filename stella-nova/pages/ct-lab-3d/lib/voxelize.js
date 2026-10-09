// ============================================================================
//  CT LAB 3D  ·  lib/voxelize.js — triangle meshes to attenuation volumes
// ----------------------------------------------------------------------------
//  The data tool (tools/ct-lab-3d/build-meshes.mjs) uses this module to turn
//  the parts of a glTF model into a CT object: a volume of linear attenuation
//  mu (1/cm at 70 keV). The node tests use it too. No DOM.
//
//  Each part gets a material (an engine COMPOSITIONS name) and a fill mode:
//    solid  the inside of a closed mesh. Parity of ray crossings along x, y
//           and z, and a 2-of-3 vote, so a few open edges do not leak.
//    shell  a surface with a thickness, for open meshes (a car body, a watch
//           band, a glass face with no thickness). Dense surface samples,
//           then a box dilation to the thickness.
//    hollow a closed mesh as a wall of a given thickness under its surface
//           (a skull is a bone wall around air, not a solid lump).
//  The tool fills a grid ss times finer than the output (default 2), then
//  averages ss^3 blocks. The result is a partial-volume fraction per part.
//  Parts paint in list order, so a later part replaces an earlier one where
//  they overlap: a mosquito inside its amber block, coals inside a pot.
//
//  Axes: glTF is y-up. The engine volume is z-up (z is the scanner's
//  rotation axis). A glTF point (x, y, z) goes to engine (x, -z, y).
//  Volume layout is the engine one: data[(iz*ny + iy)*nx + ix], iz = 0 is
//  the lowest z, iy = 0 is the largest y (canvas order).
//
//  GREP MAP
//    export function parseGltf ....... glTF JSON + buffers -> parts
//    export function meshInfo ........ triangle count, open edges, volume
//    export function toEngine ........ glTF axes -> engine axes
//    export function fitBox .......... the cube the object fits in
//    export function solidMask ....... 3-axis parity fill on a grid
//    export function shellMask ....... surface samples + dilation
//    export function hollowMask ...... solid minus its erosion (a wall)
//    export function dilate .......... separable box dilation
//    export function downsample ...... fine grid -> fraction volume
//    export function voxelizeObject .. parts + materials -> mu volume
// ============================================================================

const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function accessor(g, bufs, i) {
  const a = g.accessors[i], bv = g.bufferViews[a.bufferView], T = COMP[a.componentType], k = NCOMP[a.type];
  const buf = bufs[bv.buffer], off = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const stride = bv.byteStride || T.BYTES_PER_ELEMENT * k;
  const out = new T(a.count * k);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const get = { 1: 'getInt8', 2: 'getUint16', 4: T === Float32Array ? 'getFloat32' : 'getUint32' }[T.BYTES_PER_ELEMENT];
  const signed = T === Int8Array || T === Int16Array;
  for (let e = 0; e < a.count; e++) for (let c = 0; c < k; c++) {
    const p = off + e * stride + c * T.BYTES_PER_ELEMENT;
    let v;
    if (T === Uint8Array) v = dv.getUint8(p);
    else if (T === Int16Array) v = dv.getInt16(p, true);
    else if (signed) v = dv.getInt8(p);
    else v = dv[get](p, true);
    out[e * k + c] = v;
  }
  return out;
}

function quatMat(q) {
  const [x, y, z, w] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1];
}
// column-major 4x4
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function localMat(n) {
  if (n.matrix) return n.matrix.slice();
  const t = n.translation || [0, 0, 0], s = n.scale || [1, 1, 1];
  const R = n.rotation ? quatMat(n.rotation) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const S = [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, 0, 0, 0, 1];
  const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1];
  return mul(T, mul(R, S));
}

// json: the parsed .gltf; buffers: Uint8Array per glTF buffer.
// Returns [{ name, material, pos: Float32Array(3n) in world space, tri: Uint32Array(3m) }].
export function parseGltf(json, buffers) {
  const g = json, parts = [];
  const walk = (i, M) => {
    const node = g.nodes[i], W = mul(M, localMat(node));
    if (node.mesh !== undefined) {
      const mesh = g.meshes[node.mesh];
      mesh.primitives.forEach((prim) => {
        if ((prim.mode ?? 4) !== 4) return;
        if (prim.extensions && prim.extensions.KHR_draco_mesh_compression) throw new Error('Draco is not supported');
        const p = accessor(g, buffers, prim.attributes.POSITION);
        const nv = p.length / 3, pos = new Float32Array(p.length);
        for (let v = 0; v < nv; v++) {
          const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
          pos[v * 3] = W[0] * x + W[4] * y + W[8] * z + W[12];
          pos[v * 3 + 1] = W[1] * x + W[5] * y + W[9] * z + W[13];
          pos[v * 3 + 2] = W[2] * x + W[6] * y + W[10] * z + W[14];
        }
        let tri;
        if (prim.indices !== undefined) tri = Uint32Array.from(accessor(g, buffers, prim.indices));
        else { tri = new Uint32Array(nv); for (let v = 0; v < nv; v++) tri[v] = v; }
        const mat = prim.material !== undefined ? (g.materials[prim.material].name || 'mat' + prim.material) : '';
        parts.push({ name: node.name || mesh.name || 'node' + i, material: mat, pos, tri });
      });
    }
    (node.children || []).forEach((c) => walk(c, W));
  };
  const scene = g.scenes[g.scene || 0];
  scene.nodes.forEach((r) => walk(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
  return parts;
}

// Open (used once) edges after a weld, and the signed volume.
export function meshInfo(part) {
  const { pos, tri } = part, nv = pos.length / 3;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) { const x = pos[v * 3 + k]; if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; }
  const eps = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-9) * 1e-6;
  const keyOf = new Map(), id = new Int32Array(nv);
  for (let v = 0; v < nv; v++) {
    const k = Math.round(pos[v * 3] / eps) + ',' + Math.round(pos[v * 3 + 1] / eps) + ',' + Math.round(pos[v * 3 + 2] / eps);
    let j = keyOf.get(k); if (j === undefined) { j = keyOf.size; keyOf.set(k, j); } id[v] = j;
  }
  const edges = new Map();
  let vol = 0;
  for (let t = 0; t < tri.length; t += 3) {
    const a = id[tri[t]], b = id[tri[t + 1]], c = id[tri[t + 2]];
    if (a === b || b === c || a === c) continue;
    for (const [u, w] of [[a, b], [b, c], [c, a]]) { const k = u < w ? u * 4294967296 + w : w * 4294967296 + u; edges.set(k, (edges.get(k) || 0) + 1); }
    const A = tri[t] * 3, B = tri[t + 1] * 3, C = tri[t + 2] * 3;
    vol += (pos[A] * (pos[B + 1] * pos[C + 2] - pos[B + 2] * pos[C + 1]) - pos[A + 1] * (pos[B] * pos[C + 2] - pos[B + 2] * pos[C]) + pos[A + 2] * (pos[B] * pos[C + 1] - pos[B + 1] * pos[C])) / 6;
  }
  let open = 0, nonManifold = 0;
  for (const c of edges.values()) { if (c === 1) open++; else if (c > 2) nonManifold++; }
  return { tris: tri.length / 3, open, nonManifold, volume: vol, lo, hi };
}

// glTF (y-up) -> engine (z-up): (x, y, z) -> (x, -z, y). Determinant +1.
export function toEngine(pos) {
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) { out[i] = pos[i]; out[i + 1] = -pos[i + 2]; out[i + 2] = pos[i + 1]; }
  return out;
}

// The cube (centre, edge) that holds every part, with a margin fraction.
export function fitBox(parts, margin = 0.06) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) {
    const x = p.pos[i + k]; if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x;
  }
  const c = lo.map((l, k) => (l + hi[k]) / 2), edge = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * (1 + 2 * margin);
  return { c, edge, lo, hi };
}

// Grid coordinates g = (p - c)/edge*S + S/2, in engine axes, with x -> ix, y -> row from the
// top (iy = S - 1 - floor(...)) handled at write time. Here we keep plain axis order
// (gx, gy, gz) with gy growing with world y; downsample() flips y into canvas order.
function toGrid(pos, box, S) {
  const g = new Float32Array(pos.length), k = S / box.edge;
  for (let i = 0; i < pos.length; i += 3) {
    g[i] = (pos[i] - box.c[0]) * k + S / 2;
    g[i + 1] = (pos[i + 1] - box.c[1]) * k + S / 2;
    g[i + 2] = (pos[i + 2] - box.c[2]) * k + S / 2;
  }
  return g;
}

// Parity along one axis. ax = 2: rays along z through cell centres (x, y).
// Returns Uint8Array(S^3) in [x][y][z]-major order idx = (x*S + y)*S + z, 1 = inside.
function parityAxis(g, tri, S, ax) {
  const u = (ax + 1) % 3, v = (ax + 2) % 3;
  const flips = new Uint8Array(S * S * (S + 1));
  // tiny irrational offsets so a ray never hits an edge or a vertex exactly
  const eu = 0.5 + 1.3e-4 * Math.SQRT2, ev = 0.5 + 0.7e-4 * Math.PI;
  for (let t = 0; t < tri.length; t += 3) {
    const A = tri[t] * 3, B = tri[t + 1] * 3, C = tri[t + 2] * 3;
    const au = g[A + u], av = g[A + v], bu = g[B + u], bv = g[B + v], cu = g[C + u], cv = g[C + v];
    const den = (bv - cv) * (au - cu) + (cu - bu) * (av - cv);
    if (Math.abs(den) < 1e-12) continue;
    const i0 = Math.max(0, Math.floor(Math.min(au, bu, cu) - eu) + 1), i1 = Math.min(S - 1, Math.floor(Math.max(au, bu, cu) - eu));
    const j0 = Math.max(0, Math.floor(Math.min(av, bv, cv) - ev) + 1), j1 = Math.min(S - 1, Math.floor(Math.max(av, bv, cv) - ev));
    for (let i = i0; i <= i1; i++) {
      const pu = i + eu;
      for (let j = j0; j <= j1; j++) {
        const pv = j + ev;
        const l1 = ((bv - cv) * (pu - cu) + (cu - bu) * (pv - cv)) / den;
        const l2 = ((cv - av) * (pu - cu) + (au - cu) * (pv - cv)) / den;
        const l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        const w = l1 * g[A + ax] + l2 * g[B + ax] + l3 * g[C + ax];
        // the crossing lies below every cell centre k + 0.5 > w
        let c = Math.ceil(w - 0.5); if (c < 0) c = 0; if (c > S) c = S;
        const ray = ax === 2 ? (i * S + j) : ax === 0 ? (j * S + i) : (i * S + j);
        flips[ray * (S + 1) + c] ^= 1;
      }
    }
  }
  // prefix parity along the ray, then scatter into [x][y][z]
  const inside = new Uint8Array(S * S * S);
  for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) {
    const ray = ax === 2 ? (i * S + j) : ax === 0 ? (j * S + i) : (i * S + j);
    let p = 0;
    for (let k = 0; k < S; k++) {
      p ^= flips[ray * (S + 1) + k];
      if (!p) continue;
      // axis coordinates: ax gets k, u gets i, v gets j
      const c3 = [0, 0, 0]; c3[ax] = k; c3[u] = i; c3[v] = j;
      inside[(c3[0] * S + c3[1]) * S + c3[2]] = 1;
    }
  }
  return inside;
}

// Inside mask of a mesh on an S^3 grid: parity along x, y and z, then a 2-of-3 vote.
export function solidMask(gridPos, tri, S) {
  const a = parityAxis(gridPos, tri, S, 0), b = parityAxis(gridPos, tri, S, 1), c = parityAxis(gridPos, tri, S, 2);
  for (let i = 0; i < a.length; i++) a[i] = (a[i] + b[i] + c[i]) >= 2 ? 1 : 0;
  return a;
}

// Surface mask: dense samples on every triangle (spacing <= 0.4 cell), then a box
// dilation of r cells (r = 0: the surface cells only).
export function shellMask(gridPos, tri, S, r = 1) {
  const m = new Uint8Array(S * S * S), h = 0.4;
  const mark = (x, y, z) => {
    const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
    if (i < 0 || j < 0 || k < 0 || i >= S || j >= S || k >= S) return;
    m[(i * S + j) * S + k] = 1;
  };
  for (let t = 0; t < tri.length; t += 3) {
    const A = tri[t] * 3, B = tri[t + 1] * 3, C = tri[t + 2] * 3;
    const ab = Math.hypot(gridPos[B] - gridPos[A], gridPos[B + 1] - gridPos[A + 1], gridPos[B + 2] - gridPos[A + 2]);
    const ac = Math.hypot(gridPos[C] - gridPos[A], gridPos[C + 1] - gridPos[A + 1], gridPos[C + 2] - gridPos[A + 2]);
    const bc = Math.hypot(gridPos[C] - gridPos[B], gridPos[C + 1] - gridPos[B + 1], gridPos[C + 2] - gridPos[B + 2]);
    const nS = Math.max(1, Math.ceil(Math.max(ab, ac, bc) / h));
    for (let a = 0; a <= nS; a++) for (let b = 0; a + b <= nS; b++) {
      const s = a / nS, q = b / nS, w = 1 - s - q;
      mark(w * gridPos[A] + s * gridPos[B] + q * gridPos[C], w * gridPos[A + 1] + s * gridPos[B + 1] + q * gridPos[C + 1], w * gridPos[A + 2] + s * gridPos[B + 2] + q * gridPos[C + 2]);
    }
  }
  if (r <= 0) return m;
  return dilate(m, S, r);
}

// Hollow solid: the inside of a closed mesh minus its erosion by r cells, so a
// wall of about r cells under the surface. A skull scan is a bone wall, not a lump.
export function hollowMask(gridPos, tri, S, r = 2) {
  const solid = solidMask(gridPos, tri, S);
  const outside = new Uint8Array(solid.length);
  for (let i = 0; i < solid.length; i++) outside[i] = solid[i] ? 0 : 1;
  const grown = dilate(outside, S, r);
  for (let i = 0; i < solid.length; i++) if (grown[i] === 0) solid[i] = 0;   // deep inside: not wall
  return solid;
}

// Box dilation, separable (three 1D max passes).
export function dilate(m, S, r) {
  let src = m, dst = new Uint8Array(m.length);
  for (let ax = 0; ax < 3; ax++) {
    const stride = ax === 0 ? S * S : ax === 1 ? S : 1;
    dst.fill(0);
    for (let idx = 0; idx < src.length; idx++) {
      if (!src[idx]) continue;
      const c = ax === 0 ? Math.floor(idx / (S * S)) : ax === 1 ? Math.floor(idx / S) % S : idx % S;
      const k0 = Math.max(0, c - r), k1 = Math.min(S - 1, c + r);
      const base = idx - c * stride;
      for (let k = k0; k <= k1; k++) dst[base + k * stride] = 1;
    }
    const t = src === m ? new Uint8Array(m.length) : src; src = dst; dst = t;
  }
  return src;
}

// Fine mask [x][y][z] (S = n*ss) -> fraction volume in engine layout
// data[(iz*n + iy)*n + ix] with iy = 0 at the top (largest y).
export function downsample(mask, n, ss) {
  const S = n * ss, out = new Float32Array(n * n * n), w = 1 / (ss * ss * ss);
  for (let x = 0; x < S; x++) {
    const ix = (x / ss) | 0;
    for (let y = 0; y < S; y++) {
      const iy = n - 1 - ((y / ss) | 0), row = (x * S + y) * S;
      for (let z = 0; z < S; z++) if (mask[row + z]) out[(((z / ss) | 0) * n + iy) * n + ix] += w;
    }
  }
  return out;
}

// parts: parseGltf parts. spec(part, index) -> null (skip) | { mu, mode: 'solid'|'shell', thick }
//   mu: attenuation in 1/cm, thick: shell thickness in output voxels (default 1).
// o: { n = 128, ss = 2, margin = 0.06, widthCm }
// Returns { volume: { nx, ny, nz, width, data }, box, parts: [{ name, mode, mu, filled }] }.
export function voxelizeObject(parts, spec, o = {}) {
  const n = o.n ?? 128, ss = o.ss ?? 2, S = n * ss;
  const eng = parts.map((p) => ({ ...p, pos: toEngine(p.pos) }));
  const used = eng.map((p, i) => ({ p, s: spec(parts[i], i) })).filter((x) => x.s);
  const box = fitBox(used.map((x) => x.p), o.margin ?? 0.06);
  const data = new Float32Array(n * n * n), report = [];
  for (const { p, s } of used) {
    const gp = toGrid(p.pos, box, S);
    const r = Math.max(0, Math.round((s.thick ?? 1) * ss / 2));
    const mask = s.mode === 'shell' ? shellMask(gp, p.tri, S, r)
      : s.mode === 'hollow' ? hollowMask(gp, p.tri, S, Math.max(1, Math.round((s.thick ?? 2) * ss)))
        : solidMask(gp, p.tri, S);
    const f = downsample(mask, n, ss);
    let filled = 0;
    for (let i = 0; i < data.length; i++) if (f[i] > 0) { data[i] = data[i] * (1 - f[i]) + s.mu * f[i]; filled += f[i]; }
    report.push({ name: p.name, mode: s.mode, mu: s.mu, filled: Math.round(filled) });
  }
  return { volume: { nx: n, ny: n, nz: n, width: o.widthCm ?? box.edge, data }, box, parts: report };
}
