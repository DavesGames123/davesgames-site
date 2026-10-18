// ============================================================================
//  CORAL SPECIES  ·  base.js  ·  the small rock and the sand under one colony
// ----------------------------------------------------------------------------
//  DOM-free (the page, the worker and the node tests import it).
//  createBase() gives the "rock" object that pages/coral-reef/reef.js
//  createReef needs (see the ROCK section of its header): a signed
//  distance field (negative inside the rock), its normal, the bounds, the
//  sand height and meshes for scene.js setRock. The page and the worker
//  build the same base from the same seed, so the colony grows on the
//  rock that the page draws.
//
//  THE BASE. One low, rounded rock that sits half in the sand: an
//  ellipsoid with two octaves of value noise on it, and two pebbles. The
//  sand is a gentle height field with ripples. The sand is not in sdf():
//  reef.js reads sand.heightAt and loses a walker that reaches it.
//
//  API
//    const B = createBase({ seed, quality: 'high' | 'low' });
//    B.sdf(x, y, z) -> d (m), B.normal(x, y, z) -> [nx, ny, nz]
//    B.sdfScale = 1, B.lipschitz (a safe bound of |grad sdf|)
//    B.bounds { min, max }, B.sand { heightAt(x, z), mesh }
//    B.meshes [{ positions, normals, indices, material: 'rock' }]
//    B.site { p, n }      the seed point on the top of the rock
//    B.sampleSurface(n, rand, filter)   points on the rock top (reef.js API)
//    B.textures           the coral-reef CC0 stone set (page paths)
//    B.top                the height of the rock top (m)
//
//  grep -n targets
//    noise ................ "function vnoise"
//    the rock field ....... "function rockField"
//    the sand ............. "function sandAt"
//    the sand mesh ........ "function sandMesh"
//    the base object ...... "export function createBase"
// ============================================================================
import { meshField } from '../../lib/dla-sdf.js';

export const PLOT_R = 5.5;           // the plot fade radius of scene.js (setPlot): the sand goes black past 1.3 x this
export const SAND_R = 9;             // the sand disc radius (m)

// hash of three ints to 0..1
function h3(x, y, z, s) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// 3D value noise in -1..1 (quintic fade)
function vnoise(x, y, z, s) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10), w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => h3(ix + i, iy + j, iz + k, s);
  return 2 * L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v),
    L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w) - 1;
}

// An ellipsoid distance (a bound, exact on the axes).
function ellipsoid(x, y, z, a, b, c) {
  const k0 = Math.hypot(x / a, y / b, z / c), k1 = Math.hypot(x / (a * a), y / (b * b), z / (c * c));
  return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(a, b, c);
}
function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }

// The rock: a low boulder (1.6 x 0.75 x 1.4 m, its centre 0.12 m under the
// sand line), two octaves of noise (6 cm and 2 cm), two pebbles.
// form: per seed, the size and the turn of the boulder.
function rockField(form) {
  const { a, b, c, yc, ca, sa, s, peb } = form;
  return (x, y, z) => {
    const rx = x * ca - z * sa, rz = x * sa + z * ca, ry = y - yc;
    let d = ellipsoid(rx, ry, rz, a, b, c);
    d += 0.06 * vnoise(x * 2.3, y * 2.3, z * 2.3, s) + 0.022 * vnoise(x * 6.1, y * 6.1, z * 6.1, s + 7);
    // a flatter top: a soft cap at the top plane
    d = Math.max(d, y - (yc + b * 0.82));
    for (const p of peb) d = smin(d, Math.hypot(x - p[0], (y - p[1]) * 1.5, z - p[2]) / 1.5 - p[3], 0.08);
    return d;
  };
}

function sandAt(x, z) {
  return 0.025 * Math.sin(x * 2.1 + 0.6 * Math.sin(z * 1.3)) * Math.min(1, Math.hypot(x, z) / 2) - 0.02;
}

// A polar grid of the sand: rings closer near the rock.
function sandMesh(R, rings, segs) {
  const pos = [], nrm = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const r = i === 0 ? 0 : R * Math.pow(i / rings, 1.6);
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r, e = 0.02;
      pos.push(x, sandAt(x, z), z);
      const gx = (sandAt(x + e, z) - sandAt(x - e, z)) / (2 * e), gz = (sandAt(x, z + e) - sandAt(x, z - e)) / (2 * e), l = Math.hypot(gx, 1, gz);
      nrm.push(-gx / l, 1 / l, -gz / l);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = i * segs + j, b = i * segs + (j + 1) % segs, c = (i + 1) * segs + j, d = (i + 1) * segs + (j + 1) % segs;
    idx.push(a, b, c, b, d, c);   // counter-clockwise from above: the normal is +y (three.js FrontSide)
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), indices: new Uint32Array(idx) };
}

function mulberry(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function createBase({ seed = 1, quality = 'high', mesh = true } = {}) {
  const r = mulberry(seed * 7919 + 13);
  const ang = r() * Math.PI * 2;
  const form = {
    a: 0.72 + 0.16 * r(), b: 0.36 + 0.08 * r(), c: 0.6 + 0.14 * r(), yc: -0.1, ca: Math.cos(ang), sa: Math.sin(ang), s: (seed * 31 + 5) | 0,
    peb: [],
  };
  for (let i = 0; i < 2; i++) {
    const t = ang + 1.4 + i * 2.6 + r() * 0.6, d = 0.95 + 0.35 * r();
    form.peb.push([Math.cos(t) * d, -0.02, Math.sin(t) * d, 0.07 + 0.06 * r()]);
  }
  const sdf = rockField(form);
  const e = 0.004;
  function normal(x, y, z) {
    const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    return [gx / l, gy / l, gz / l];
  }
  // the top of the rock over (x, z): march down from 1 m
  function topAt(x, z) {
    let y = 1;
    for (let i = 0; i < 80; i++) { const d = sdf(x, y, z); if (d < 0.002) return y; y -= Math.max(0.004, d * 0.7); if (y < -0.3) return null; }
    return y;
  }
  const top = topAt(0, 0) ?? 0.3;
  const B = {
    seed, quality, sdf, normal, sdfScale: 1, lipschitz: 1.8, detail: 1, top,
    bounds: { min: [-SAND_R, -0.6, -SAND_R], max: [SAND_R, 0.8, SAND_R] },
    sand: { heightAt: sandAt, mesh: null },
    meshes: [],
    site: { p: [0, top, 0], n: normal(0, top + 0.01, 0) },
    textures: {
      albedo: '../coral-reef/assets/tex/rock/reef_rock_albedo.webp',
      normal: '../coral-reef/assets/tex/rock/reef_rock_normal.webp',
      orm: '../coral-reef/assets/tex/rock/reef_rock_orm.webp',
    },
    material: { triplanar: { scale: 1 / 0.9 } },
    features: [],
    topAt,
    // points on the rock top (reef.js populate API; the page plants only B.site)
    sampleSurface(n = 16, rand = Math.random, filter = null) {
      const out = [];
      for (let t = 0; t < n * 6 && out.length < n; t++) {
        const x = (rand() - 0.5) * 1.2, z = (rand() - 0.5) * 1.0, y = topAt(x, z);
        if (y === null || y < sandAt(x, z) + 0.05) continue;
        const s = { p: [x, y, z], n: normal(x, y + 0.01, z), exposure: 0.8, overhang: 0 };
        if (!filter || filter(s)) out.push(s);
      }
      return out;
    },
  };
  if (mesh) {
    const cell = quality === 'low' ? 0.035 : 0.022;
    const x0 = -1.5, y0 = -0.08, z0 = -1.5;
    const m = meshField(sdf, { x0, y0, z0, nx: Math.ceil(3 / cell), ny: Math.ceil(0.72 / cell), nz: Math.ceil(3 / cell), cell });
    m.material = 'rock';
    B.meshes.push(m);
    B.sand.mesh = sandMesh(SAND_R, quality === 'low' ? 36 : 60, quality === 'low' ? 72 : 120);
  }
  return B;
}
