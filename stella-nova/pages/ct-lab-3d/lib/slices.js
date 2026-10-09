// ============================================================================
//  CT LAB 3D  ·  lib/slices.js — slice views, crosshairs, HU and distances
// ----------------------------------------------------------------------------
//  DOM-free maths for the explore views. A cursor { ix, iy, iz } in voxels
//  links the three orthogonal views: each view shows the slice through the
//  cursor and draws the other two planes as crosshair lines. The oblique view
//  samples a plane through the cursor, turned by yaw and pitch.
//
//  Volume layout is the engine one: data[(iz*ny + iy)*nx + ix], iy = 0 at the
//  top (largest y), iz = 0 at the bottom. Views put the top of the object at
//  the top of the image:
//    axial    (looking down z)  image x = ix, image y = iy
//    coronal  (looking along y) image x = ix, image y = nz-1-iz
//    sagittal (looking along x) image x = iy, image y = nz-1-iz
//
//  GREP MAP
//    export const VIEWS ........... axial, coronal, sagittal
//    export function sliceOf ...... one orthogonal slice as Float32 + size
//    export function cursorFromPixel  view pixel -> cursor (keeps the depth)
//    export function crosshair .... crosshair lines of a view, image coordinates
//    export function obliqueOf .... a turned plane through the cursor (trilinear)
//    export function toRGBA ....... values + window + LUT -> RGBA bytes
//    export function diffOf ....... recon - truth
//    export function distanceCm ... distance between two view points
//    export function valueAt ...... mu at the cursor
// ============================================================================

export const VIEWS = ['axial', 'coronal', 'sagittal'];

export function sliceOf(vol, view, c) {
  const { nx, ny, nz, data } = vol;
  if (view === 'axial') {
    const k = clamp(c.iz, nz), out = new Float32Array(nx * ny);
    out.set(data.subarray(k * nx * ny, (k + 1) * nx * ny));
    return { w: nx, h: ny, data: out };
  }
  if (view === 'coronal') {
    const j = clamp(c.iy, ny), out = new Float32Array(nx * nz);
    for (let z = 0; z < nz; z++) {
      const r = nz - 1 - z, src = (z * ny + j) * nx;
      for (let x = 0; x < nx; x++) out[r * nx + x] = data[src + x];
    }
    return { w: nx, h: nz, data: out };
  }
  const i = clamp(c.ix, nx), out = new Float32Array(ny * nz);
  for (let z = 0; z < nz; z++) {
    const r = nz - 1 - z;
    for (let y = 0; y < ny; y++) out[r * ny + y] = data[(z * ny + y) * nx + i];
  }
  return { w: ny, h: nz, data: out };
}
const clamp = (v, n) => Math.max(0, Math.min(n - 1, Math.round(v)));

// A pixel (px, py) of a view (image coordinates) moves the cursor in that view's plane.
export function cursorFromPixel(vol, view, px, py, c) {
  const o = { ...c };
  if (view === 'axial') { o.ix = clamp(px, vol.nx); o.iy = clamp(py, vol.ny); }
  else if (view === 'coronal') { o.ix = clamp(px, vol.nx); o.iz = clamp(vol.nz - 1 - py, vol.nz); }
  else { o.iy = clamp(px, vol.ny); o.iz = clamp(vol.nz - 1 - py, vol.nz); }
  return o;
}

// Crosshair of a view: { x, y } image position of the cursor (vertical and horizontal line).
export function crosshair(vol, view, c) {
  if (view === 'axial') return { x: c.ix + 0.5, y: c.iy + 0.5 };
  if (view === 'coronal') return { x: c.ix + 0.5, y: vol.nz - 1 - c.iz + 0.5 };
  return { x: c.iy + 0.5, y: vol.nz - 1 - c.iz + 0.5 };
}

// Oblique slice: a size x size plane through the cursor, as wide as the largest volume side.
// yaw turns about z, pitch tilts it.
// The plane's u axis and v axis are unit vectors in voxel space; the plane spans the cube.
export function obliqueOf(vol, c, yaw, pitch, size = 160) {
  const { nx, ny, nz, data } = vol;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  // u: horizontal in the plane (turned by yaw); v: up, tilted by pitch toward the normal
  const u = [cy, -sy, 0], v = [sy * sp, cy * sp, cp];
  const span = Math.max(nx, ny, nz) * 1.05, step = span / size, out = new Float32Array(size * size);
  const ox = c.ix + 0.5, oy = c.iy + 0.5, oz = c.iz + 0.5;
  for (let r = 0; r < size; r++) {
    const b = (size / 2 - r - 0.5) * step;
    for (let q = 0; q < size; q++) {
      const a = (q - size / 2 + 0.5) * step;
      // voxel coordinates; y in data grows downward (canvas order) so subtract the y part
      const x = ox + a * u[0] + b * v[0] - 0.5, y = oy - (a * u[1] + b * v[1]) - 0.5, z = oz + a * u[2] + b * v[2] - 0.5;
      out[r * size + q] = tri(data, nx, ny, nz, x, y, z);
    }
  }
  return { w: size, h: size, data: out, u, v };
}
function tri(d, nx, ny, nz, x, y, z) {
  if (x < -0.5 || y < -0.5 || z < -0.5 || x > nx - 0.5 || y > ny - 0.5 || z > nz - 0.5) return NaN;
  const x0 = Math.max(0, Math.min(nx - 2, Math.floor(x))), y0 = Math.max(0, Math.min(ny - 2, Math.floor(y))), z0 = Math.max(0, Math.min(nz - 2, Math.floor(z)));
  const tx = Math.max(0, Math.min(1, x - x0)), ty = Math.max(0, Math.min(1, y - y0)), tz = Math.max(0, Math.min(1, z - z0));
  const g = (i, j, k) => d[(k * ny + j) * nx + i];
  const a = g(x0, y0, z0) * (1 - tx) + g(x0 + 1, y0, z0) * tx, b = g(x0, y0 + 1, z0) * (1 - tx) + g(x0 + 1, y0 + 1, z0) * tx;
  const e = g(x0, y0, z0 + 1) * (1 - tx) + g(x0 + 1, y0, z0 + 1) * tx, f = g(x0, y0 + 1, z0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1, z0 + 1) * tx;
  return (a * (1 - ty) + b * ty) * (1 - tz) + (e * (1 - ty) + f * ty) * tz;
}

// values -> RGBA (Uint8ClampedArray) through a window [lo, hi] and a 256 x 3 or 256 x 4 LUT.
// NaN (outside the volume on an oblique plane) draws as the background colour.
export function toRGBA(img, lo, hi, lut, stride = 3, bg = [6, 9, 15]) {
  const n = img.data.length, out = new Uint8ClampedArray(n * 4), k = 255 / Math.max(1e-9, hi - lo);
  for (let i = 0; i < n; i++) {
    const v = img.data[i], o = i * 4;
    if (Number.isNaN(v)) { out[o] = bg[0]; out[o + 1] = bg[1]; out[o + 2] = bg[2]; out[o + 3] = 255; continue; }
    let t = Math.round((v - lo) * k); t = t < 0 ? 0 : t > 255 ? 255 : t;
    out[o] = lut[t * stride]; out[o + 1] = lut[t * stride + 1]; out[o + 2] = lut[t * stride + 2]; out[o + 3] = 255;
  }
  return out;
}

export function diffOf(rec, truth) {
  const d = new Float32Array(rec.data.length);
  for (let i = 0; i < d.length; i++) d[i] = rec.data[i] - truth.data[i];
  return { ...rec, data: d };
}

// Distance in cm between two image points of a view (voxel size = width / nx).
export function distanceCm(vol, a, b) {
  const px = vol.width / vol.nx;
  return Math.hypot(a.x - b.x, a.y - b.y) * px;
}

export function valueAt(vol, c) {
  return vol.data[(clamp(c.iz, vol.nz) * vol.ny + clamp(c.iy, vol.ny)) * vol.nx + clamp(c.ix, vol.nx)];
}
