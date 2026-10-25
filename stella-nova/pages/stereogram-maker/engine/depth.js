// ============================================================================
//  STEREOGRAM ENGINE  ·  engine/depth.js — depth maps from meshes, images
//  and closed-form shapes (no DOM)
// ----------------------------------------------------------------------------
//  The CPU rasteriser is a z-buffer with edge functions. It samples each
//  pixel at its centre, keeps the nearest surface, and draws both faces
//  of each triangle, so an open scan mesh has no holes. A perspective
//  view interpolates 1 / (D - z) in screen space, which is linear there,
//  so the depth is correct inside each triangle.
//
//  The view: the mesh centre (the bounding-box centre) goes to the origin
//  and the bounding sphere radius goes to 1. R = Rz(roll) Rx(pitch)
//  Ry(yaw) turns the mesh. +z points to the viewer, +y up.
//
//  grep -n targets
//    view setup ........... "function viewOf"
//    rasteriser ........... "function raster"
//    depth map from mesh .. "export function depthFromMesh"
//    turntable ............ "export function turntable"
//    image to depth ....... "export function depthFromImage"
//    closed-form shapes ... "export function depthFromSDF"
//    blur ................. "export function boxBlur"
// ============================================================================
const DEG = Math.PI / 180;

export function emptyDepth(w, h) {
  return { w, h, data: new Float32Array(w * h), mask: new Uint8Array(w * h) };
}

// Bounding-box centre and the bounding-sphere radius about it.
export function meshBounds(positions) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  let r2 = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const dx = positions[i] - c[0], dy = positions[i + 1] - c[1], dz = positions[i + 2] - c[2];
    const d = dx * dx + dy * dy + dz * dz; if (d > r2) r2 = d;
  }
  return { min: [x0, y0, z0], max: [x1, y1, z1], center: c, radius: Math.sqrt(r2) || 1 };
}

// The 3x3 turn matrix (row-major) R = Rz(roll) Rx(pitch) Ry(yaw).
export function turnMatrix(yaw = 0, pitch = 0, roll = 0) {
  const a = yaw * DEG, b = pitch * DEG, c = roll * DEG;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  const Ry = [ca, 0, sa, 0, 1, 0, -sa, 0, ca];
  const Rx = [1, 0, 0, 0, cb, -sb, 0, sb, cb];
  const Rz = [cc, -sc, 0, sc, cc, 0, 0, 0, 1];
  return mul3(Rz, mul3(Rx, Ry));
}
function mul3(A, B) {
  const C = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j];
  return C;
}

// The view for a mesh and the options: unit-sphere coordinates in view
// space and the projection to pixels.
function viewOf(mesh, o) {
  const b = mesh.bounds && mesh.bounds.center ? mesh.bounds : meshBounds(mesh.positions);
  const R = turnMatrix(o.yaw, o.pitch, o.roll);
  const s = (o.fit ?? 0.9) * Math.min(o.w, o.h) / 2;
  const fov = o.fov ?? 22;
  const persp = fov > 0.01;
  const D = persp ? 1 / Math.sin(Math.min(fov, 170) * DEG / 2) : 0;
  const f = persp ? s * Math.sqrt(D * D - 1) : s;
  return { b, R, s, persp, D, f, cx: o.w / 2, cy: o.h / 2 };
}

// Project every vertex: sx, sy in pixels, q the interpolated depth key
// (z for orthographic, 1 / (D - z) for perspective), z the view z.
function project(mesh, V) {
  const P = mesh.positions, n = P.length / 3;
  const sx = new Float32Array(n), sy = new Float32Array(n), q = new Float32Array(n), vz = new Float32Array(n);
  const { R, b, persp, D, f, cx, cy } = V, k = 1 / b.radius;
  for (let i = 0; i < n; i++) {
    const x = (P[3 * i] - b.center[0]) * k, y = (P[3 * i + 1] - b.center[1]) * k, z = (P[3 * i + 2] - b.center[2]) * k;
    const X = R[0] * x + R[1] * y + R[2] * z, Y = R[3] * x + R[4] * y + R[5] * z, Z = R[6] * x + R[7] * y + R[8] * z;
    vz[i] = Z;
    if (persp) { const iz = 1 / (D - Z); sx[i] = cx + X * f * iz; sy[i] = cy - Y * f * iz; q[i] = iz; }
    else { sx[i] = cx + X * f; sy[i] = cy - Y * f; q[i] = Z; }
  }
  return { sx, sy, q, vz };
}

// The z-buffer pass. zb holds the largest key (the nearest surface).
function raster(idx, sx, sy, q, w, h) {
  const zb = new Float32Array(w * h).fill(-Infinity);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ax = sx[a], ay = sy[a], bx = sx[b], by = sy[b], cx = sx[c], cy = sy[c];
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (!(Math.abs(area) > 1e-12)) continue;
    let x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
    let y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
    if (x0 > x1 || y0 > y1) continue;
    const ia = 1 / area, qa = q[a], qb = q[b], qc = q[c];
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        // Barycentric weights from the edge functions.
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * ia;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * ia;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-7 || w1 < -1e-7 || w2 < -1e-7) continue;
        const z = w0 * qa + w1 * qb + w2 * qc, i = y * w + x;
        if (z > zb[i]) zb[i] = z;
      }
    }
  }
  return zb;
}

// Map view z values in zb to depth. zb holds view z here.
export function finish(zb, w, h, o, sphere) {
  const near = o.near ?? 1, far = o.far ?? 0.2;
  const out = emptyDepth(w, h);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < zb.length; i++) if (zb[i] > -Infinity) { if (zb[i] < lo) lo = zb[i]; if (zb[i] > hi) hi = zb[i]; }
  if (sphere) { lo = -1; hi = 1; }
  const span = hi - lo > 1e-9 ? hi - lo : 1;
  for (let i = 0; i < zb.length; i++) {
    if (zb[i] === -Infinity) continue;
    let t = (zb[i] - lo) / span; t = t < 0 ? 0 : t > 1 ? 1 : t;
    out.data[i] = far + (near - far) * t; out.mask[i] = 1;
  }
  return out;
}

// A depth map of a mesh (see index.js for the options).
export function depthFromMesh(mesh, opts = {}) {
  const o = Object.assign({ w: 512, h: 512, yaw: 0, pitch: 0, roll: 0 }, opts);
  const w = o.w | 0, h = o.h | 0;
  const V = viewOf(mesh, o);
  const { sx, sy, q } = project(mesh, V);
  const idx = mesh.indices || seqIndex(mesh.positions.length / 3);
  const zb = raster(idx, sx, sy, q, w, h);
  if (V.persp) for (let i = 0; i < zb.length; i++) if (zb[i] > -Infinity) zb[i] = V.D - 1 / zb[i];
  return finish(zb, w, h, o, o.norm === 'sphere');
}
// The projection only (for the WebGL2 path in depth-gl.js).
export function projectMesh(mesh, opts) {
  const o = Object.assign({ w: 512, h: 512, yaw: 0, pitch: 0, roll: 0 }, opts);
  const V = viewOf(mesh, o);
  return Object.assign(project(mesh, V), { V, o });
}
export function seqIndex(n) { const a = new Uint32Array(n); for (let i = 0; i < n; i++) a[i] = i; return a; }

// n views of a turning mesh, with a depth scale that stays the same.
export function turntable(mesh, n = 24, opts = {}) {
  const y0 = opts.yaw ?? 0, out = [];
  for (let k = 0; k < n; k++) out.push(depthFromMesh(mesh, Object.assign({}, opts, { yaw: y0 + 360 * k / n, norm: 'sphere' })));
  return out;
}

// ── images ─────────────────────────────────────────────────────────────────
// A separable box blur of radius r (three passes are close to a Gaussian).
export function boxBlur(a, w, h, r, passes = 3) {
  r = Math.max(0, Math.round(r));
  if (!r) return a;
  let src = Float32Array.from(a), tmp = new Float32Array(a.length);
  const n = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      let s = 0; const row = y * w;
      for (let k = -r; k <= r; k++) s += src[row + clampI(k, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = s / n;
        s += src[row + clampI(x + r + 1, 0, w - 1)] - src[row + clampI(x - r, 0, w - 1)];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[clampI(k, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        src[y * w + x] = s / n;
        s += tmp[clampI(y + r + 1, 0, h - 1) * w + x] - tmp[clampI(y - r, 0, h - 1) * w + x];
      }
    }
  }
  return src;
}
const clampI = (v, a, b) => v < a ? a : v > b ? b : v;

// Bilinear luminance (0..1) of an RGBA Image at (u, v) in pixels.
function lumAt(img, u, v) {
  const x = clampI(u - 0.5, 0, img.w - 1), y = clampI(v - 0.5, 0, img.h - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(img.w - 1, x0 + 1), y1 = Math.min(img.h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0, d = img.data;
  const L = (xx, yy) => { const i = 4 * (yy * img.w + xx); return (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255; };
  return (L(x0, y0) * (1 - fx) + L(x1, y0) * fx) * (1 - fy) + (L(x0, y1) * (1 - fx) + L(x1, y1) * fx) * fy;
}

// A depth map from an Image: a grey depth map, or a photo by luminance.
export function depthFromImage(img, opts = {}) {
  const mode = opts.mode || 'depth';
  const w = (opts.w || img.w) | 0, h = (opts.h || img.h) | 0;
  let a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = lumAt(img, (x + 0.5) * img.w / w, (y + 0.5) * img.h / h);
  const blur = opts.blur ?? (mode === 'photo' ? 3 : 0);
  if (blur > 0) a = boxBlur(a, w, h, blur);
  const gamma = opts.gamma ?? (mode === 'photo' ? 1.4 : 1);
  const out = emptyDepth(w, h);
  for (let i = 0; i < a.length; i++) {
    let v = opts.invert ? 1 - a[i] : a[i];
    v = Math.pow(clampI(v, 0, 1), gamma);
    out.data[i] = v; out.mask[i] = v > 0.02 ? 1 : 0;
  }
  return out;
}

// ── closed-form shapes ─────────────────────────────────────────────────────
// Each shape gives a height 0..1 (or -1 for no object) at (x, y) in units
// of half the short side, viewed from +z with an orthographic camera.
export const SDF_SHAPES = ['sphere', 'torus', 'steps', 'cone', 'ripple', 'pyramid'];
const SHAPES = {
  sphere: (x, y, p) => { const r = p.r ?? 0.8, d = r * r - x * x - y * y; return d >= 0 ? Math.sqrt(d) / r : -1; },
  torus: (x, y, p) => {
    const R = p.R ?? 0.55, r = p.r ?? 0.25, d = r * r - (Math.hypot(x, y) - R) ** 2;
    return d >= 0 ? Math.sqrt(d) / r : -1;
  },
  steps: (x, y, p) => {
    const n = p.n ?? 4, r = p.r ?? 0.85, m = Math.max(Math.abs(x), Math.abs(y));
    return m <= r ? Math.ceil((1 - m / r) * n) / n : -1;
  },
  cone: (x, y, p) => { const r = p.r ?? 0.8, d = Math.hypot(x, y); return d <= r ? 1 - d / r : -1; },
  pyramid: (x, y, p) => { const r = p.r ?? 0.8, m = Math.max(Math.abs(x), Math.abs(y)); return m <= r ? 1 - m / r : -1; },
  ripple: (x, y, p) => {
    const k = p.k ?? 5, d = Math.hypot(x, y), r = p.r ?? 1.2;
    return d <= r ? (0.5 + 0.5 * Math.cos(k * Math.PI * d)) * (1 - d / r) : -1;
  },
};
// A depth map of a closed-form shape. opts: { w, h, near, far, ...shape
// params (sphere r; torus R, r; steps n, r; cone r; pyramid r; ripple k, r) }.
export function depthFromSDF(shape, opts = {}) {
  const fn = SHAPES[shape];
  if (!fn) throw new Error('depthFromSDF: unknown shape ' + shape);
  const w = (opts.w || 512) | 0, h = (opts.h || 512) | 0, near = opts.near ?? 1, far = opts.far ?? 0.2;
  const s = Math.min(w, h) / 2, out = emptyDepth(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = fn((x + 0.5 - w / 2) / s, (h / 2 - y - 0.5) / s, opts);
    if (v < 0) continue;
    const i = y * w + x; out.data[i] = far + (near - far) * v; out.mask[i] = 1;
  }
  return out;
}
