// ============================================================================
//  CORAL REEF  ·  a small software rasteriser (DOM-free, node)
// ----------------------------------------------------------------------------
//  For the node checks and the home thumbnail (thumb.mjs): it draws
//  indexed triangle meshes with a z-buffer, per-vertex normals and
//  colours, a sun, a sky and ground light, an underwater fog, and writes a
//  PNG with node:zlib. It is not the page renderer (scene.js, three.js):
//  it shows the shapes, not the shaders.
//
//  USE
//    const R = createRaster(w, h, { ss: 2, bg: [r, g, b], fog: [r, g, b], fogDen });
//    R.camera(eye, target, fovDeg);
//    R.mesh({ positions, normals, indices, color: [r, g, b] | colors (Float32 rgb per vertex) });
//    R.points(list of [x, y, z, radius, r, g, b]) (small spheres)
//    const png = R.png();   // Uint8Array (a PNG file)
//
//  grep -n targets
//    the triangle loop ...... "function tri"
//    shading ................ "function shade"
//    PNG writer ............. "export function encodePNG"
// ============================================================================

export function createRaster(W, H, o = {}) {
  const ss = o.ss ?? 2, w = W * ss, h = H * ss;
  const col = new Float32Array(w * h * 3), zb = new Float32Array(w * h).fill(Infinity);
  const bg = o.bg || [0.04, 0.18, 0.24], fog = o.fog || bg, fogDen = o.fogDen ?? 0.004;
  const sun = norm(o.sun || [0.3, 1, 0.25]);
  for (let y = 0; y < h; y++) {
    const t = y / h;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      col[i] = bg[0] * (1.3 - 0.6 * t); col[i + 1] = bg[1] * (1.3 - 0.6 * t); col[i + 2] = bg[2] * (1.3 - 0.6 * t);
    }
  }
  let V = null, eye = [0, 0, 0], f = 1;

  function camera(e, target, fov = 40) {
    eye = e;
    const zf = norm(sub(e, target)), xr = norm(cross([0, 1, 0], zf)), yu = cross(zf, xr);
    V = [xr, yu, zf];
    f = 1 / Math.tan(fov * Math.PI / 360);
  }

  // world -> [sx, sy, depth]
  function proj(p, out) {
    const d = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
    const x = dot(d, V[0]), y = dot(d, V[1]), z = -dot(d, V[2]);
    out[0] = w / 2 + x / z * f * h / 2; out[1] = h / 2 - y / z * f * h / 2; out[2] = z;
    return out;
  }

  function shade(p, n, c, out) {
    const nd = Math.max(0, dot(n, sun));
    const sky = 0.5 + 0.5 * n[1];
    const vdir = norm(sub(eye, p));
    const rim = Math.pow(1 - Math.max(0, dot(n, vdir)), 3);
    for (let k = 0; k < 3; k++) {
      const amb = [0.10, 0.16, 0.20][k] * (0.5 + sky) + [0.02, 0.03, 0.035][k];
      out[k] = c[k] * (amb + nd * [0.95, 1.0, 0.98][k]) + rim * [0.05, 0.12, 0.14][k] * (o.rim ?? 1);
    }
    const dist = Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
    const a = [0.55, 0.2, 0.12];
    const fk = Math.exp(-dist * fogDen);
    for (let k = 0; k < 3; k++) out[k] = out[k] * Math.exp(-dist * fogDen * a[k]) * fk + fog[k] * (1 - fk);
    return out;
  }

  const A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0];
  const ca = [0, 0, 0], cb = [0, 0, 0], cc = [0, 0, 0];
  function tri(pa, pb, pc, na, nb, nc, ka, kb, kc) {
    proj(pa, A); proj(pb, B); proj(pc, C);
    if (A[2] < 0.5 || B[2] < 0.5 || C[2] < 0.5) return;
    const area = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    if (o.cull !== false && area >= 0) return;    // counter-clockwise in world = clockwise on a y-down screen
    if (Math.abs(area) < 1e-9) return;
    shade(pa, na, ka, ca); shade(pb, nb, kb, cb); shade(pc, nc, kc, cc);
    const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]))), x1 = Math.min(w - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
    const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))), y1 = Math.min(h - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
    const ia = 1 / A[2], ib = 1 / B[2], ic = 1 / C[2];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((B[0] - px) * (C[1] - py) - (B[1] - py) * (C[0] - px)) / area;
      const w1 = ((C[0] - px) * (A[1] - py) - (C[1] - py) * (A[0] - px)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const iz = w0 * ia + w1 * ib + w2 * ic, z = 1 / iz;
      const j = y * w + x;
      if (z >= zb[j]) continue;
      zb[j] = z;
      const q0 = w0 * ia * z, q1 = w1 * ib * z, q2 = w2 * ic * z;
      col[j * 3] = ca[0] * q0 + cb[0] * q1 + cc[0] * q2;
      col[j * 3 + 1] = ca[1] * q0 + cb[1] * q1 + cc[1] * q2;
      col[j * 3 + 2] = ca[2] * q0 + cb[2] * q1 + cc[2] * q2;
    }
  }

  function mesh(m) {
    const P = m.positions, N = m.normals, I = m.indices, K = m.colors, c0 = m.color || [0.8, 0.6, 0.5];
    const g = (a, i) => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      tri(g(P, a), g(P, b), g(P, c), g(N, a), g(N, b), g(N, c), K ? g(K, a) : c0, K ? g(K, b) : c0, K ? g(K, c) : c0);
    }
  }

  // small spheres as octahedra (dots for polyps and particles)
  function points(list) {
    const D = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const F = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
    for (const p of list) {
      const v = D.map(d => [p[0] + d[0] * p[3], p[1] + d[1] * p[3], p[2] + d[2] * p[3]]);
      const c = [p[4], p[5], p[6]];
      for (const f2 of F) tri(v[f2[0]], v[f2[2]], v[f2[1]], D[f2[0]], D[f2[2]], D[f2[1]], c, c, c);
    }
  }

  function png() {
    const out = new Uint8Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      for (let k = 0; k < 3; k++) {
        let s = 0;
        for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) s += col[((y * ss + sy) * w + x * ss + sx) * 3 + k];
        let v = s / (ss * ss);
        v = 1 - Math.exp(-v * 1.6);                         // soft tone map
        v = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
        out[(y * W + x) * 3 + k] = Math.max(0, Math.min(255, Math.round(v * 255)));
      }
    }
    return encodePNG(out, W, H);
  }

  return { camera, mesh, points, png, proj, get zb() { return zb; } };
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

// RGB8 -> PNG bytes. node only (node:zlib), imported on demand.
let zlib = null;
export async function loadZlib() { if (!zlib) zlib = await import('node:zlib'); return zlib; }
export function encodePNG(rgb, W, H) {
  if (!zlib) throw new Error('raster: await loadZlib() first (node only)');
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
let CRC = null;
function crc32(b) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
