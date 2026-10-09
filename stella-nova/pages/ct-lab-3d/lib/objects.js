// ============================================================================
//  CT LAB 3D  ·  lib/objects.js — the real objects: load, decode, resample
// ----------------------------------------------------------------------------
//  data/objects.json lists the objects. Each one has a uint8 volume file of
//  attenuation codes (code = round(255 mu / muMax), mu in 1/cm at 70 keV),
//  its size in cm, anchors [code, composition, [water, bone, iron]] for the
//  basis split, and its credit. tools/ct-lab-3d/ makes the files.
//
//  The live site gzips files on the wire. loadCodes() reads the whole body
//  with arrayBuffer() and checks its length against dims; it never sizes a
//  buffer from content-length (memory note gzip-content-length).
//
//  No DOM. The page, the saver, the tests and the worker import this file.
//
//  GREP MAP
//    export async function loadManifest . the object list
//    export async function loadCodes .... fetch one object's code volume
//    export function toVolume ........... codes -> engine Volume of mu at n^3
//    export function resample ........... trilinear resample of a volume
//    export function basisOf ............ mu volume -> water/bone/iron volumes
//    export function huOf / MU_WATER .... Hounsfield units
//    export function presetsFor ......... transfer-function presets per object
// ============================================================================
import { muAt } from '../../ct-lab/engine/physics.js';

export const MU_WATER = muAt('water', 70);
export const huOf = (mu) => (1000 * (mu - MU_WATER)) / MU_WATER;

export async function loadManifest(base, fetchFn = globalThis.fetch) {
  const r = await fetchFn(new URL('objects.json', base));
  if (!r.ok) throw new Error('objects.json ' + r.status);
  const m = await r.json();
  return m.objects;
}

export async function loadCodes(entry, base, fetchFn = globalThis.fetch) {
  const r = await fetchFn(new URL(entry.file, base));
  if (!r.ok) throw new Error(entry.file + ' ' + r.status);
  const buf = new Uint8Array(await r.arrayBuffer());
  const [nx, ny, nz] = entry.dims;
  if (buf.length !== nx * ny * nz) throw new Error(`${entry.file}: ${buf.length} bytes, want ${nx * ny * nz}`);
  return buf;
}

// Trilinear resample of an engine-layout Float32 volume (sx, sy, sz) to (n, n, nz').
// A cube stays a cube; a box keeps its aspect (nz scales with nz/nx).
export function resample(data, sx, sy, sz, n) {
  if (n === sx && sy === sx && sz === sx) return data;
  const k = n / sx, mx = n, my = Math.max(1, Math.round(sy * k)), mz = Math.max(1, Math.round(sz * k));
  const out = new Float32Array(mx * my * mz);
  const down = k < 1;
  for (let z = 0; z < mz; z++) {
    const fz = (z + 0.5) / k - 0.5;
    for (let y = 0; y < my; y++) {
      const fy = (y + 0.5) / k - 0.5;
      for (let x = 0; x < mx; x++) {
        const fx = (x + 0.5) / k - 0.5;
        out[(z * my + y) * mx + x] = down ? boxAt(data, sx, sy, sz, fx, fy, fz, 1 / k) : triAt(data, sx, sy, sz, fx, fy, fz);
      }
    }
  }
  out.dims = [mx, my, mz];
  return out;
}
function triAt(d, sx, sy, sz, x, y, z) {
  const x0 = Math.max(0, Math.min(sx - 1, Math.floor(x))), y0 = Math.max(0, Math.min(sy - 1, Math.floor(y))), z0 = Math.max(0, Math.min(sz - 1, Math.floor(z)));
  const x1 = Math.min(sx - 1, x0 + 1), y1 = Math.min(sy - 1, y0 + 1), z1 = Math.min(sz - 1, z0 + 1);
  const tx = Math.max(0, Math.min(1, x - x0)), ty = Math.max(0, Math.min(1, y - y0)), tz = Math.max(0, Math.min(1, z - z0));
  const g = (i, j, k) => d[(k * sy + j) * sx + i];
  const c00 = g(x0, y0, z0) * (1 - tx) + g(x1, y0, z0) * tx, c10 = g(x0, y1, z0) * (1 - tx) + g(x1, y1, z0) * tx;
  const c01 = g(x0, y0, z1) * (1 - tx) + g(x1, y0, z1) * tx, c11 = g(x0, y1, z1) * (1 - tx) + g(x1, y1, z1) * tx;
  return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
}
// mean over the source box that one output voxel covers (no aliasing when shrinking)
function boxAt(d, sx, sy, sz, x, y, z, f) {
  const h = f / 2;
  const i0 = Math.max(0, Math.ceil(x - h + 0.5 - 1e-6)), i1 = Math.min(sx - 1, Math.floor(x + h + 0.5 - 1e-6));
  const j0 = Math.max(0, Math.ceil(y - h + 0.5 - 1e-6)), j1 = Math.min(sy - 1, Math.floor(y + h + 0.5 - 1e-6));
  const k0 = Math.max(0, Math.ceil(z - h + 0.5 - 1e-6)), k1 = Math.min(sz - 1, Math.floor(z + h + 0.5 - 1e-6));
  let s = 0, c = 0;
  for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { s += d[(k * sy + j) * sx + i]; c++; }
  return c ? s / c : triAt(d, sx, sy, sz, x, y, z);
}

// codes -> engine Volume { nx, ny, nz, width (cm), data: mu 1/cm }, resampled to n on x.
export function toVolume(entry, codes, n = entry.dims[0]) {
  const [sx, sy, sz] = entry.dims, s = entry.muMax / 255;
  const mu = new Float32Array(codes.length);
  for (let i = 0; i < codes.length; i++) mu[i] = codes[i] * s;
  const r = resample(mu, sx, sy, sz, n);
  const [nx, ny, nz] = r.dims || [sx, sy, sz];
  return { nx, ny, nz, width: entry.widthCm, data: r };
}

// Basis split for polychromatic scans: the water, bone and iron density fractions of each
// voxel, interpolated between the object's anchors by the voxel's code.
export function basisOf(entry, vol) {
  const A = entry.anchors, n = vol.data.length, s = 255 / entry.muMax;
  const w = new Float32Array(n), b = new Float32Array(n), f = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = vol.data[i] * s;
    let k = 0; while (k < A.length - 2 && c > A[k + 1][0]) k++;
    const [c0, , p0] = A[k], [c1, , p1] = A[Math.min(A.length - 1, k + 1)];
    const t = c1 > c0 ? Math.max(0, Math.min(1, (c - c0) / (c1 - c0))) : 0;
    // a voxel above the top anchor scales the top composition
    const top = c > A[A.length - 1][0] && A[A.length - 1][0] > 0 ? c / A[A.length - 1][0] : 1;
    w[i] = (p0[0] + t * (p1[0] - p0[0])) * top; b[i] = (p0[1] + t * (p1[1] - p0[1])) * top; f[i] = (p0[2] + t * (p1[2] - p0[2])) * top;
  }
  const mk = (data) => ({ nx: vol.nx, ny: vol.ny, nz: vol.nz, width: vol.width, data });
  return { water: mk(w), bone: mk(b), iron: mk(f) };
}

// Transfer-function presets (view3d TF_PRESETS shape; fractions of the window) from the
// object's materials. Keys: everything, soft, bone, metal (metal only when it has one).
export function presetsFor(entry) {
  const mus = entry.anchors.map((a) => (a[0] / 255) * entry.muMax).filter((m) => m > 0).sort((a, b) => a - b);
  const top = mus[mus.length - 1] || entry.muMax, metal = entry.anchors.some((a) => a[2][2] > 0.2);
  const light = mus.filter((m) => m < 0.45), dense = mus.filter((m) => m >= 0.45 && m < 3);
  const lightTop = light.length ? light[light.length - 1] : 0.25;
  const P = {};
  const everyHi = metal ? (dense.length ? dense[dense.length - 1] * 1.25 : lightTop * 2.2) : top * 1.05;
  P.everything = { label: 'Everything', window: [0, everyHi], air: null, soft: [0.06, 0.5], bone: 0.55, skin: 0.08, iso: 0.55 };
  P.soft = { label: 'Soft and light', window: [0, lightTop * 1.6], air: null, soft: [0.12, 0.7], bone: 0.8, skin: 0.14, iso: 0.75 };
  if (dense.length || !metal) P.bone = { label: 'Bone and dense', window: [0, (dense.length ? dense[dense.length - 1] : top) * 1.2], air: null, soft: [0.25, 0.38], bone: 0.45, skin: 0.3, iso: 0.5 };
  if (metal) P.metal = { label: 'Metal', window: [0, top * 1.05], air: null, soft: [0.012, 0.03], bone: 0.18, skin: 0.03, iso: 0.3 };
  return P;
}
