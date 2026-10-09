// view3d/scene.js - DOM-free maths and mesh builders for the 3D cone-beam view.
// Scene units: the volume width is 1. World axes follow the engine: x right, y up
// (anterior), z along the rotation axis. The camera up vector is +y.
//
// grep handles:
//   mat4Mul, mat4Inv, perspective, lookAt, orbitEye, cameraMatrices, unproject, projectPoint
//   rayBox, pickSlice, smooth3, toHalf, halfToFloat, volumeStats, TF_PRESETS, buildLut
//   gantryLayout, buildMeshes, buildGlass, coneLines, sampleRays, VERT_FLOATS, LINE_FLOATS

export const VERT_FLOATS = 14; // pos3 normal3 color4 uv2 texMix rot
export const LINE_FLOATS = 12; // a3 b3 color4 width rot

// ---------- mat4 (column-major, WebGPU clip z in 0..1) ----------

export function mat4Mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

export function mat4Inv(m) {
  const a = Array.from(m), inv = new Array(16);
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  let det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  det = det ? 1 / det : 0;
  return Float32Array.from(inv, (v) => v * det);
}

export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2), o = new Float32Array(16);
  o[0] = f / aspect; o[5] = f; o[10] = far / (near - far); o[11] = -1; o[14] = (near * far) / (near - far);
  return o;
}

export function lookAt(eye, target, up) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const zA = norm(sub(eye, target)), xA = norm(cross(up, zA)), yA = cross(zA, xA);
  return Float32Array.from([xA[0], yA[0], zA[0], 0, xA[1], yA[1], zA[1], 0, xA[2], yA[2], zA[2], 0,
    -dot(xA, eye), -dot(yA, eye), -dot(zA, eye), 1]);
}

export function orbitEye(cam) {
  const t = cam.target ?? [0, 0, 0], cp = Math.cos(cam.pitch);
  return [t[0] + cam.dist * cp * Math.sin(cam.yaw), t[1] + cam.dist * Math.sin(cam.pitch), t[2] + cam.dist * cp * Math.cos(cam.yaw)];
}

// View, projection (with an NDC offset) and their product and inverse.
export function cameraMatrices(cam, aspect) {
  const eye = orbitEye(cam);
  const view = lookAt(eye, cam.target ?? [0, 0, 0], [0, 1, 0]);
  const proj = perspective(cam.fov ?? 0.6, aspect, Math.max(0.01, cam.dist * 0.05), cam.dist * 8 + 20);
  const off = cam.offset ?? [0, 0];
  const shift = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, off[0], off[1], 0, 1]);
  const vp = mat4Mul(mat4Mul(shift, proj), view);
  return { eye, view, proj, viewProj: vp, invViewProj: mat4Inv(vp) };
}

export function transform(m, p) {
  const x = p[0], y = p[1], z = p[2], w = p[3] ?? 1;
  return [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w, m[3] * x + m[7] * y + m[11] * z + m[15] * w];
}

// Ray through NDC point (nx, ny): origin and unit direction.
export function unproject(invViewProj, nx, ny) {
  const a = transform(invViewProj, [nx, ny, 0, 1]), b = transform(invViewProj, [nx, ny, 1, 1]);
  const o = [a[0] / a[3], a[1] / a[3], a[2] / a[3]], f = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
  const d = [f[0] - o[0], f[1] - o[1], f[2] - o[2]], l = Math.hypot(...d);
  return { o, d: d.map((v) => v / l) };
}

export function projectPoint(viewProj, p) {
  const c = transform(viewProj, [p[0], p[1], p[2], 1]);
  return [c[0] / c[3], c[1] / c[3], c[3]];
}

// Slab test. Returns [t0, t1] or null.
export function rayBox(o, d, half) {
  let t0 = -Infinity, t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-12) { if (Math.abs(o[k]) > half[k]) return null; continue; }
    let a = (-half[k] - o[k]) / d[k], b = (half[k] - o[k]) / d[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
  }
  return t1 > Math.max(t0, 0) ? [Math.max(t0, 0), t1] : null;
}

// Nearest slice plane hit by a ray. slices: {x,y,z} in 0..1. y fraction 0 = top (canvas order).
// Returns { axis: 0|1|2, t } or null. The same rule is in the volume shader.
export function slicePlanePos(slices, half) {
  return [(slices.x - 0.5) * 2 * half[0], (0.5 - slices.y) * 2 * half[1], (slices.z - 0.5) * 2 * half[2]];
}
export function pickSlice(o, d, half, slices) {
  const hit = rayBox(o, d, half);
  if (!hit) return null;
  const P = slicePlanePos(slices, half);
  let best = null;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-9) continue;
    const t = (P[k] - o[k]) / d[k];
    if (t < hit[0] || t > hit[1]) continue;
    const q = [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]];
    let inside = true;
    for (let j = 0; j < 3; j++) if (j !== k && Math.abs(q[j]) > half[j] + 1e-6) inside = false;
    if (inside && (!best || t < best.t)) best = { axis: k, t };
  }
  return best;
}

// ---------- half floats ----------

const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
export function toHalf(src, out = new Uint16Array(src.length), scale = 1) {
  for (let i = 0; i < src.length; i++) {
    F32[0] = src[i] * scale;
    const x = U32[0], sign = (x >>> 16) & 0x8000;
    let e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
    if (e >= 31) { out[i] = sign | 0x7bff; continue; }        // clamp to the largest finite half
    if (e <= 0) {
      if (e < -10) { out[i] = sign; continue; }
      m = (m | 0x800000) >> (1 - e);
      out[i] = sign | ((m + 0x1000) >> 13);
      continue;
    }
    const h = sign | (e << 10) | (m >> 13);
    out[i] = (m & 0x1000) ? h + 1 : h;                        // round half up on the mantissa
  }
  return out;
}

export function halfToFloat(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

// Display copy smoothed with a separable [1 2 1]/4 kernel (edges clamp). Removes voxel steps.
export function smooth3(vol) {
  const { nx, ny, nz } = vol, src = vol.data;
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  const strides = [[1, nx, (i) => i % nx], [nx, ny, (i) => Math.floor(i / nx) % ny], [nx * ny, nz, (i) => Math.floor(i / (nx * ny))]];
  for (const [st, n, idx] of strides) {
    for (let i = 0; i < a.length; i++) {
      const k = idx(i), l = k > 0 ? a[i - st] : a[i], r = k < n - 1 ? a[i + st] : a[i];
      b[i] = 0.25 * l + 0.5 * a[i] + 0.25 * r;
    }
    [a, b] = [b, a];
  }
  return { ...vol, data: a };
}

export function volumeStats(data) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < data.length; i++) { const v = data[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  return { min: mn, max: mx };
}

// ---------- transfer functions ----------

// Normalised value s = (v - lo) / (hi - lo). air: faint lung tint; soft: translucent tissue; bone: bright.
export const TF_PRESETS = {
  'shepp-logan': { window: [0, 1.02], air: null, soft: [0.08, 0.45], bone: 0.6, skin: 0.1, iso: 0.6 },
  head: { window: [0, 0.56], air: null, soft: [0.27, 0.42], bone: 0.5, skin: 0.2, iso: 0.6 },
  chest: { window: [0, 0.56], air: [0.04, 0.22], soft: [0.27, 0.42], bone: 0.5, skin: 0.2, iso: 0.58 },
};

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 256 x 2 RGBA8 texture data. Row 0: transfer function (rgb, opacity per reference step).
// Row 1: colour map for mip and slices (alpha 255).
export function buildLut(preset, cmapRgba) {
  const p = preset, out = new Uint8Array(256 * 2 * 4);
  for (let i = 0; i < 256; i++) {
    const s = i / 255;
    const air = p.air ? smooth(p.air[0], p.air[0] + 0.02, s) * (1 - smooth(p.air[1] - 0.03, p.air[1], s)) : 0;
    const soft = smooth(p.soft[0], p.soft[0] + 0.05, s) * (1 - smooth(p.soft[1], p.soft[1] + 0.06, s));
    const bone = smooth(p.bone - 0.06, p.bone + 0.12, s);
    const g = smooth(p.bone, 1, s);
    // colours (linear-ish sRGB): lung teal, tissue rose to peach, bone ivory
    let r = 0.25 * air + soft * (0.95 + 0.05 * s) + bone * (0.98 + 0.02 * g);
    let gg = 0.75 * air + soft * (0.42 + 0.35 * s) + bone * (0.9 + 0.08 * g);
    let b = 0.85 * air + soft * (0.36 + 0.2 * s) + bone * (0.78 + 0.2 * g);
    const wsum = air + soft + bone || 1;
    r /= wsum; gg /= wsum; b /= wsum;
    const a = 0.01 * air + 0.028 * soft + bone * (0.35 + 0.5 * g);
    const k = i * 4;
    out[k] = Math.round(255 * Math.min(1, r)); out[k + 1] = Math.round(255 * Math.min(1, gg));
    out[k + 2] = Math.round(255 * Math.min(1, b)); out[k + 3] = Math.round(255 * Math.min(1, a));
  }
  for (let i = 0; i < 256; i++) {
    const k = (256 + i) * 4;
    out[k] = cmapRgba[i * 4]; out[k + 1] = cmapRgba[i * 4 + 1]; out[k + 2] = cmapRgba[i * 4 + 2]; out[k + 3] = 255;
  }
  return out;
}

// ---------- gantry layout and meshes ----------

// Gantry sizes in scene units (volume width = 1) from an engine cone geometry.
export function gantryLayout(geom, width, nz = 1) {
  const s = 1 / width;
  const sod = geom.sod * s, sdd = geom.sdd * s;
  const hu = 0.5 * (geom.nu - 1) * geom.du * s, hv = 0.5 * (geom.nv - 1) * geom.dv * s;
  const detDist = sdd - sod;
  const rIn = Math.max(sod + 0.18, Math.hypot(detDist + 0.08, hu)) * 1.06;
  return { sod, sdd, hu, hv, detDist, rIn, rOut: rIn * 1.14, depth: 0.22, half: [0.5, 0.5, 0.5 * nz] };
}

function pushV(arr, p, n, c, uv = [0, 0], tex = 0, rot = 0) {
  arr.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], c[3], uv[0], uv[1], tex, rot);
}

// Axis-aligned box as 12 triangles with flat normals.
function box(arr, c, h, col, rot = 0) {
  const F = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  for (const [n, u, v] of F) {
    const q = (a, b) => [0, 1, 2].map((k) => c[k] + (n[k] + a * u[k] + b * v[k]) * h[k]);
    const p00 = q(-1, -1), p10 = q(1, -1), p11 = q(1, 1), p01 = q(-1, 1);
    for (const p of [p00, p10, p11, p00, p11, p01]) pushV(arr, p, n, col, [0, 0], 0, rot);
  }
}

// Annular gantry housing: outer and inner cylinder walls plus two face rings.
function housing(arr, L, seg = 96) {
  const col = [0.10, 0.11, 0.14, 0.0], face = [0.13, 0.14, 0.18, 0.0];
  const zf = L.depth;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const quad = (p00, p10, p11, p01, n0, n1, c) => {
      pushV(arr, p00, n0, c); pushV(arr, p10, n1, c); pushV(arr, p11, n1, c);
      pushV(arr, p00, n0, c); pushV(arr, p11, n1, c); pushV(arr, p01, n0, c);
    };
    const R = L.rOut, r = L.rIn;
    quad([R * c0, R * s0, -zf], [R * c1, R * s1, -zf], [R * c1, R * s1, zf], [R * c0, R * s0, zf], [c0, s0, 0], [c1, s1, 0], col);
    quad([r * c0, r * s0, zf], [r * c1, r * s1, zf], [r * c1, r * s1, -zf], [r * c0, r * s0, -zf], [-c0, -s0, 0], [-c1, -s1, 0], col);
    for (const sz of [1, -1]) {
      const n = [0, 0, sz];
      if (sz > 0) quad([r * c0, r * s0, zf], [R * c0, R * s0, zf], [R * c1, R * s1, zf], [r * c1, r * s1, zf], n, n, face);
      else quad([r * c1, r * s1, -zf], [R * c1, R * s1, -zf], [R * c0, R * s0, -zf], [r * c0, r * s0, -zf], n, n, face);
    }
  }
}

// Opaque meshes. Parts with rot = 1 turn with the gantry; they are built at angle 0
// (source on -y, detector on +y, detector u along +x, v along +z).
export function buildMeshes(L, show = {}) {
  const v = [];
  if (show.gantry !== false) housing(v, L);
  if (show.table !== false) {
    const top = -0.5 * 1.08 - 0.03;
    box(v, [0, top, -0.3], [0.42, 0.025, 2.6], [0.16, 0.17, 0.2, 0.0]);
    box(v, [0, top - 0.04, -0.3], [0.36, 0.02, 2.5], [0.05, 0.45, 0.6, 0.6]); // lit edge strip
  }
  if (show.gantry !== false) {
    // X-ray tube housing behind the focal spot, and the detector frame.
    box(v, [0, -L.sod - 0.11, 0], [0.12, 0.09, 0.16], [0.2, 0.21, 0.26, 0.0], 1);
    box(v, [0, -L.sod - 0.01, 0], [0.03, 0.02, 0.03], [1.0, 0.75, 0.35, 1.0], 1);
    box(v, [0, L.detDist + 0.045, 0], [L.hu + 0.04, 0.03, L.hv + 0.04], [0.14, 0.15, 0.19, 0.0], 1);
  }
  // Detector panel (textured), facing the source (-y).
  if (show.detector !== false) {
    const y = L.detDist + 0.012, n = [0, -1, 0], c = [0.04, 0.05, 0.07, 0.0];
    const P = (u, w) => [u * L.hu, y, w * L.hv];
    const UV = (u, w) => [(u + 1) / 2, (1 - w) / 2];
    const tri = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
    for (const [u, w] of tri) pushV(v, P(u, w), n, c, UV(u, w), 1, 1);
  }
  return new Float32Array(v);
}

// Translucent cone of rays (four faces of the pyramid), drawn additively. rot = 1.
export function buildGlass(L) {
  const v = [], S = [0, -L.sod, 0], y = L.detDist;
  const C = [[-L.hu, y, -L.hv], [L.hu, y, -L.hv], [L.hu, y, L.hv], [-L.hu, y, L.hv]];
  const col = [0.35, 0.7, 1.0, 0.06];
  for (let i = 0; i < 4; i++) {
    const a = C[i], b = C[(i + 1) % 4];
    const e1 = a.map((x, k) => x - S[k]), e2 = b.map((x, k) => x - S[k]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(...n); n.forEach((x, k) => (n[k] = x / l));
    pushV(v, S, n, col, [0, 0], 0, 1); pushV(v, a, n, col, [1, 0], 0, 1); pushV(v, b, n, col, [1, 1], 0, 1);
  }
  return new Float32Array(v);
}

function seg(arr, a, b, col, width, rot = 0) { arr.push(a[0], a[1], a[2], b[0], b[1], b[2], col[0], col[1], col[2], col[3], width, rot); }

// Static glow lines: volume box edges, orbit circle, housing rims.
export function staticLines(L, show = {}) {
  const v = [], h = L.half;
  const corners = [];
  for (let i = 0; i < 8; i++) corners.push([(i & 1 ? 1 : -1) * h[0], (i & 2 ? 1 : -1) * h[1], (i & 4 ? 1 : -1) * h[2]]);
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (const [i, j] of edges) seg(v, corners[i], corners[j], [0.4, 0.75, 1.0, 0.35], 1.5);
  if (show.gantry !== false) {
    const N = 128;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      const P = (r, a, z) => [r * Math.cos(a), r * Math.sin(a), z];
      seg(v, P(L.sod, a0, 0), P(L.sod, a1, 0), [1.0, 0.6, 0.25, 0.22], 1.2);
      for (const z of [L.depth, -L.depth]) seg(v, P(L.rIn, a0, z), P(L.rIn, a1, z), [0.3, 0.8, 1.0, 0.55], 2.0);
    }
  }
  return v;
}

// Rotating lines: cone edges and detector rim (rot = 1).
export function coneLines(L) {
  const v = [], S = [0, -L.sod, 0], y = L.detDist;
  const C = [[-L.hu, y, -L.hv], [L.hu, y, -L.hv], [L.hu, y, L.hv], [-L.hu, y, L.hv]];
  for (let i = 0; i < 4; i++) {
    seg(v, S, C[i], [0.45, 0.8, 1.0, 0.5], 1.6, 1);
    seg(v, C[i], C[(i + 1) % 4], [0.45, 0.85, 1.0, 0.9], 2.2, 1);
  }
  return v;
}

// Fan of sample rays in the mid-plane at angle 0. trans(i) in 0..1 gives the transmitted
// fraction for ray i (exp(-p)). Each ray is two segments: before and after the object.
export function sampleRays(L, count, trans) {
  const v = [], S = [0, -L.sod, 0], y = L.detDist;
  for (let i = 0; i < count; i++) {
    const f = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
    const D = [f * L.hu * 0.94, y, 0];
    const d = [D[0] - S[0], D[1] - S[1], 0], len = Math.hypot(d[0], d[1]);
    const hit = rayBox(S, [d[0] / len, d[1] / len, 0], L.half);
    const t = trans ? trans(i, f) : 1;
    const hot = [1.0, 0.82, 0.45, 0.85];
    if (!hit) { seg(v, S, D, hot, 2.2, 1); continue; }
    const P = (tt) => [S[0] + (tt * d[0]) / len, S[1] + (tt * d[1]) / len, 0];
    seg(v, S, P(hit[0]), hot, 2.2, 1);
    seg(v, P(hit[0]), P(hit[1]), [1.0, 0.7, 0.4, 0.25 + 0.5 * t], 1.6, 1);
    seg(v, P(hit[1]), D, [0.35 + 0.65 * t, 0.65 + 0.2 * t, 1.0, 0.15 + 0.75 * t], 1.4 + 1.2 * t, 1);
  }
  return v;
}
