// phantoms.js - test objects for the CT engine.
// Shepp-Logan 2D (original 1974 and the Toft "modified" contrast), Shepp-Logan 3D
// (ellipsoid table after Kak and Slaney / Schabel, z rotation only), and our own
// procedural phantoms built from painted shapes of named materials.
// Values are linear attenuation mu: 1/cm at 70 keV for procedural phantoms,
// dimensionless for Shepp-Logan.
//
// grep handles:
//   SHEPP_LOGAN_2D, SHEPP_LOGAN_2D_MODIFIED, SHEPP_LOGAN_3D, PHANTOMS_2D, PHANTOMS_3D,
//   rasterize2D, rasterize3D, phantom2D, phantom3D, analyticSinogram, analyticConeProjections,
//   buildHead, buildChest, buildSuitcase, buildBars, buildContrastDetail, buildWalnut, buildMetal

import { COMPOSITIONS, muOfComposition, mulberry32 } from './physics.js';
import { rayFor, rayFor3D } from './geometry.js';

// [A, a, b, x0, y0, phi(deg)] in the unit square [-1, 1]^2, y up.
const SL_GEOM = [
  [0.69, 0.92, 0, 0, 0], [0.6624, 0.874, 0, -0.0184, 0], [0.11, 0.31, 0.22, 0, -18],
  [0.16, 0.41, -0.22, 0, 18], [0.21, 0.25, 0, 0.35, 0], [0.046, 0.046, 0, 0.1, 0],
  [0.046, 0.046, 0, -0.1, 0], [0.046, 0.023, -0.08, -0.605, 0], [0.023, 0.023, 0, -0.606, 0],
  [0.023, 0.046, 0.06, -0.605, 0],
];
const SL_A = [2, -0.98, -0.02, -0.02, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01];
const SL_A_MOD = [1, -0.8, -0.2, -0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
const toShapes = (A) => SL_GEOM.map((g, i) => ({ t: 'e', A: A[i], a: g[0], b: g[1], x: g[2], y: g[3], phi: g[4] }));
export const SHEPP_LOGAN_2D = toShapes(SL_A);
export const SHEPP_LOGAN_2D_MODIFIED = toShapes(SL_A_MOD);

// [A, a, b, c, x0, y0, z0, phi(deg)] modified contrast. The published table also tilts
// ellipsoids 3 and 4 by 10 deg about a second axis; we keep only the z rotation.
export const SHEPP_LOGAN_3D = [
  [1, 0.69, 0.92, 0.81, 0, 0, 0, 0], [-0.8, 0.6624, 0.874, 0.78, 0, -0.0184, 0, 0],
  [-0.2, 0.11, 0.31, 0.22, 0.22, 0, 0, -18], [-0.2, 0.16, 0.41, 0.28, -0.22, 0, 0, 18],
  [0.1, 0.21, 0.25, 0.41, 0, 0.35, -0.15, 0], [0.1, 0.046, 0.046, 0.05, 0, 0.1, 0.25, 0],
  [0.1, 0.046, 0.046, 0.05, 0, -0.1, 0.25, 0], [0.1, 0.046, 0.023, 0.05, -0.08, -0.605, 0, 0],
  [0.1, 0.023, 0.023, 0.02, 0, -0.606, 0, 0], [0.1, 0.023, 0.046, 0.02, 0.06, -0.605, 0, 0],
].map((r) => ({ t: 'E', A: r[0], a: r[1], b: r[2], c: r[3], x: r[4], y: r[5], z: r[6], phi: r[7] }));

export const PHANTOMS_2D = [
  { key: 'shepp-logan', label: 'Shepp-Logan', width: 2, blurb: 'The 1974 head phantom: ten ellipses, low contrast.' },
  { key: 'shepp-logan-modified', label: 'Shepp-Logan (modified)', width: 2, blurb: 'Same ellipses with higher contrast for display.' },
  { key: 'head', label: 'Head', width: 24, blurb: 'Skull with diploe, brain, ventricles, sinuses, a bleed.' },
  { key: 'chest', label: 'Chest', width: 40, blurb: 'Lungs with vessels, heart, aorta, spine, ribs, a nodule.' },
  { key: 'suitcase', label: 'Suitcase', width: 60, blurb: 'Clothes, a bottle, a laptop with cells, keys, coins.' },
  { key: 'bars', label: 'Resolution bars', width: 20, blurb: 'Bar groups from 1 to 8 line pairs per cm, plus a bead.' },
  { key: 'contrast-detail', label: 'Contrast-detail', width: 20, blurb: 'Discs from 0.5% to 8% contrast and 2 mm to 15 mm.' },
  { key: 'walnut', label: 'Walnut', width: 5, blurb: 'A wrinkled shell and kernel with air gaps.' },
  { key: 'metal-implant', label: 'Hip implant', width: 40, blurb: 'Pelvis with a steel femoral head and titanium cup.' },
];
export const PHANTOMS_3D = [
  { key: 'shepp-logan', label: 'Shepp-Logan 3D', width: 2 },
  { key: 'head', label: 'Head 3D', width: 24 },
  { key: 'chest', label: 'Chest 3D', width: 40 },
];

// ---------- shape geometry ----------

const D2R = Math.PI / 180;

function prep(s) {
  const p = { ...s };
  p.c = Math.cos((s.phi || 0) * D2R); p.s = Math.sin((s.phi || 0) * D2R);
  if (s.t === 'e') p.R = Math.max(s.a, s.b);
  else if (s.t === 'r') p.R = 0.5 * Math.hypot(s.w, s.h);
  else if (s.t === 'b') { let m = 1; for (const h of s.harm || []) m += Math.abs(h[1]); p.R = s.r * m; }
  else if (s.t === 'E') p.R = Math.max(s.a, s.b, s.c);
  return p;
}

function inside2(p, x, y) {
  const dx = x - p.x, dy = y - p.y;
  const lx = dx * p.c + dy * p.s, ly = -dx * p.s + dy * p.c;
  if (p.t === 'e') { const u = lx / p.a, v = ly / p.b; return u * u + v * v <= 1; }
  if (p.t === 'r') return Math.abs(lx) <= p.w / 2 && Math.abs(ly) <= p.h / 2;
  if (p.t === 'b') {
    const rr = Math.hypot(lx, ly), th = Math.atan2(ly, lx);
    let r = 1; for (const h of p.harm || []) r += h[1] * Math.cos(h[0] * th + (h[2] || 0));
    return rr <= p.r * r;
  }
  return false;
}

function inside3(p, x, y, z) {
  const dx = x - p.x, dy = y - p.y, dz = z - p.z;
  const lx = dx * p.c + dy * p.s, ly = -dx * p.s + dy * p.c;
  const u = lx / p.a, v = ly / p.b, w = dz / p.c3;
  return u * u + v * v + w * w <= 1;
}

// Paint (mode 'paint', shape has mat) or add (shape has A) shapes into an image.
// Returns { image, basis } where basis holds water/bone/iron density fractions.
export function rasterize2D(shapes, n, width, o = {}) {
  const ss = o.supersample ?? 3, px = width / n, N = n * n;
  const img = new Float32Array(N);
  const bw = new Float32Array(N), bb = new Float32Array(N), bi = new Float32Array(N);
  const keV = o.keV ?? 70;
  for (const s0 of shapes) {
    const p = prep(s0);
    const comp = p.mat ? COMPOSITIONS[p.mat] : null;
    if (p.mat && !comp) throw new Error('unknown material ' + p.mat);
    const val = comp ? muOfComposition(comp, keV) : p.A;
    const ix0 = Math.max(0, Math.floor((p.x - p.R + width / 2) / px) - 1);
    const ix1 = Math.min(n - 1, Math.ceil((p.x + p.R + width / 2) / px) + 1);
    const iy0 = Math.max(0, Math.floor((width / 2 - p.y - p.R) / px) - 1);
    const iy1 = Math.min(n - 1, Math.ceil((width / 2 - p.y + p.R) / px) + 1);
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        let hit = 0;
        for (let sy = 0; sy < ss; sy++) {
          const y = width / 2 - (iy + (sy + 0.5) / ss) * px;
          for (let sx = 0; sx < ss; sx++) {
            const x = (ix + (sx + 0.5) / ss) * px - width / 2;
            if (inside2(p, x, y)) hit++;
          }
        }
        if (!hit) continue;
        const f = hit / (ss * ss), k = iy * n + ix;
        if (comp) {
          img[k] += f * (val - img[k]);
          bw[k] += f * (comp[0] - bw[k]); bb[k] += f * (comp[1] - bb[k]); bi[k] += f * (comp[2] - bi[k]);
        } else {
          img[k] += f * val; bw[k] += f * val;
        }
      }
    }
  }
  const mk = (d) => ({ nx: n, ny: n, width, data: d });
  return { image: mk(img), basis: { water: mk(bw), bone: mk(bb), iron: mk(bi) } };
}

export function rasterize3D(shapes, n, width, o = {}) {
  const ss = o.supersample ?? 2, px = width / n, nz = o.nz ?? n, depth = nz * px;
  const data = new Float32Array(n * n * nz);
  const keV = o.keV ?? 70;
  for (const s0 of shapes) {
    const p = prep(s0); p.c3 = s0.c; p.z = s0.z || 0;
    const val = p.mat ? muOfComposition(p.mat, keV) : p.A;
    const ix0 = Math.max(0, Math.floor((p.x - p.R + width / 2) / px) - 1), ix1 = Math.min(n - 1, Math.ceil((p.x + p.R + width / 2) / px) + 1);
    const iy0 = Math.max(0, Math.floor((width / 2 - p.y - p.R) / px) - 1), iy1 = Math.min(n - 1, Math.ceil((width / 2 - p.y + p.R) / px) + 1);
    const iz0 = Math.max(0, Math.floor((p.z - p.c3 + depth / 2) / px) - 1), iz1 = Math.min(nz - 1, Math.ceil((p.z + p.c3 + depth / 2) / px) + 1);
    for (let iz = iz0; iz <= iz1; iz++) for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) {
      let hit = 0;
      for (let sz = 0; sz < ss; sz++) {
        const z = (iz + (sz + 0.5) / ss) * px - depth / 2;
        for (let sy = 0; sy < ss; sy++) {
          const y = width / 2 - (iy + (sy + 0.5) / ss) * px;
          for (let sx = 0; sx < ss; sx++) {
            if (inside3(p, (ix + (sx + 0.5) / ss) * px - width / 2, y, z)) hit++;
          }
        }
      }
      if (!hit) continue;
      const f = hit / (ss * ss * ss), k = (iz * n + iy) * n + ix;
      if (p.mat) data[k] += f * (val - data[k]); else data[k] += f * val;
    }
  }
  return { nx: n, ny: n, nz, width, data };
}

// ---------- procedural 2D phantoms (world unit = cm, y = anterior/up) ----------

const E = (x, y, a, b, mat, phi = 0) => ({ t: 'e', x, y, a, b, mat, phi });
const C = (x, y, r, mat) => ({ t: 'e', x, y, a: r, b: r, mat });
const Rr = (x, y, w, h, mat, phi = 0) => ({ t: 'r', x, y, w, h, mat, phi });
const B = (x, y, r, harm, mat, phi = 0) => ({ t: 'b', x, y, r, harm, mat, phi });

export function buildHead() {
  const s = [
    E(0, 0, 8.0, 9.8, 'soft'),
    E(0, 0, 7.6, 9.4, 'bone'), E(0, 0, 7.3, 9.1, 'spongy'), E(0, 0, 7.02, 8.8, 'bone'),
    E(-0.85, 8.9, 0.85, 0.36, 'air'), E(0.9, 8.88, 0.75, 0.34, 'air'),
    E(0, 0, 6.78, 8.56, 'gray'),
    B(0, 0.2, 5.6, [[2, 0.18, 0], [5, 0.035, 0.4], [9, 0.025, 1.3], [13, 0.02, 0.2]], 'white'),
    E(-1.15, 1.6, 0.62, 2.5, 'csf', -14), E(1.15, 1.6, 0.62, 2.5, 'csf', 14),
    E(-0.75, 3.8, 0.45, 0.9, 'csf', 25), E(0.75, 3.8, 0.45, 0.9, 'csf', -25),
    E(-1.6, -1.7, 0.42, 1.1, 'csf', 30), E(1.6, -1.7, 0.42, 1.1, 'csf', -30),
    E(0, -0.7, 0.16, 0.95, 'csf'),
    C(0, -2.2, 0.17, 'bone'),
    E(0, 6.1, 0.06, 2.2, 'bone'), E(0, -6.6, 0.07, 1.6, 'bone'),
    E(2.9, 3.6, 1.35, 1.1, 'infarct', 30),
    E(2.9, 3.6, 0.95, 0.75, 'bleed', 30),
    E(-3.4, -3.8, 1.0, 1.3, 'infarct', -20),
  ];
  return s;
}

export function buildChest(seed = 3) {
  const rng = mulberry32(seed);
  const lungL = B(-7.0, 0.6, 5.7, [[2, 0.22, 0], [3, 0.05, 1.0], [4, 0.04, 2.0]], 'lung', 85);
  const lungR = B(7.3, 0.4, 5.3, [[2, 0.22, 0], [3, -0.06, 0.7], [4, 0.04, 1.6]], 'lung', 95);
  const s = [E(0, -0.5, 17, 11.5, 'fat'), E(0, -0.6, 16.1, 10.6, 'muscle')];
  for (const sg of [-1, 1]) s.push(E(sg * 10.2, -7.6, 4.3, 0.5, 'bone', sg * 22));
  for (const sg of [-1, 1]) s.push(E(sg * 10.2, -6.9, 4.4, 1.0, 'muscle', sg * 22));
  s.push(E(0, -0.3, 14.6, 9.5, 'fat'));
  // ribs: cross sections along an ellipse, skipping the front middle and the spine
  for (const deg of [12, 34, 56, 124, 146, 168, 196, 218, 238, 302, 322, 344]) {
    const t = deg * D2R;
    s.push(E(14.4 * Math.cos(t), -0.4 + 9.4 * Math.sin(t), 0.95, 0.42, 'bone', deg + 90));
    s.push(E(14.4 * Math.cos(t), -0.4 + 9.4 * Math.sin(t), 0.6, 0.2, 'spongy', deg + 90));
  }
  s.push(E(0, -0.3, 13.6, 8.6, 'muscle'));
  s.push(lungL, lungR);
  // vessels and bronchi
  const lungs = [prep(lungL), prep(lungR)];
  let tries = 0, made = 0;
  while (made < 70 && tries < 2000) {
    tries++;
    const L = lungs[made % 2];
    const x = L.x + (rng() * 2 - 1) * L.R, y = L.y + (rng() * 2 - 1) * L.R;
    if (!inside2(L, x, y)) continue;
    const dHilum = Math.hypot(x - L.x * 0.55, y - 0.5);
    const r = Math.max(0.08, 0.42 - 0.05 * dHilum + 0.08 * rng());
    let ok = true;
    for (const dx of [-r, r]) for (const dy of [-r, r]) if (!inside2(L, x + dx * 1.5, y + dy * 1.5)) ok = false;
    if (!ok) continue;
    if (rng() < 0.25 && r > 0.2) { s.push(C(x, y, r, 'soft')); s.push(C(x, y, r * 0.6, 'air')); }
    else s.push(E(x, y, r, r * (1 + rng() * 0.8), 'blood', rng() * 180));
    made++;
  }
  s.push(C(-8.4, 3.4, 0.62, 'soft'));
  s.push(E(1.9, 2.4, 4.8, 3.9, 'blood', 32));
  s.push(E(1.9, 2.4, 4.8, 3.9, 'muscle', 32), E(2.1, 2.5, 3.6, 2.8, 'blood', 32));
  s.push(E(-1.6, 3.0, 0.4, 2.2, 'fat', 45));
  s.push(C(1.9, -4.7, 1.25, 'blood'), C(-0.9, 4.2, 1.3, 'blood'));
  s.push(C(0.4, -3.3, 0.6, 'soft'), C(0.4, -3.3, 0.18, 'air'));
  s.push(E(0, 9.3, 1.5, 0.6, 'bone'), E(0, 9.3, 1.2, 0.38, 'spongy'));
  // spine
  s.push(E(-2.3, -8.5, 1.5, 0.55, 'bone', 20), E(2.3, -8.5, 1.5, 0.55, 'bone', -20));
  s.push(E(0, -8.7, 1.7, 1.35, 'bone'), Rr(0, -10.4, 0.7, 2.0, 'bone'));
  s.push(C(0, -6.2, 2.0, 'bone'), C(0, -6.2, 1.75, 'spongy'));
  s.push(C(0, -8.6, 0.85, 'csf'));
  return s;
}

export function buildSuitcase(seed = 5) {
  const rng = mulberry32(seed);
  const s = [Rr(0, 0, 54, 36, 'plastic'), Rr(0, 0, 52.6, 34.6, 'air')];
  s.push(Rr(0, 19.0, 15, 1.4, 'plastic'), Rr(0, 19.0, 12, 0.6, 'air'));
  for (const sg of [-1, 1]) s.push(C(sg * 7, -15.6, 0.9, 'aluminium'), C(sg * 7, -15.6, 0.72, 'air'));
  for (let k = 0; k < 9; k++) {
    s.push(B(-12 + rng() * 24, -6 + rng() * 14, 5 + rng() * 4, [[2, 0.2 + rng() * 0.15, rng() * 6], [3, 0.08, rng() * 6], [7, 0.03, rng() * 6]], 'fabric', rng() * 180));
  }
  for (let k = 0; k < 14; k++) s.push(Rr(-10 + rng() * 20, -4 + rng() * 12, 9 + rng() * 6, 0.25, 'paper', -20 + rng() * 40));
  // bottle
  s.push(C(16, 8, 3.7, 'glass'), C(16, 8, 3.35, 'water'), C(17.6, 9.6, 0.5, 'air'));
  // laptop with battery cells
  s.push(Rr(-9, -7, 26, 13, 'aluminium', 3), Rr(-9, -7, 25.4, 12.4, 'plastic', 3), Rr(-12, -6, 14, 7, 'air', 3));
  for (let k = 0; k < 6; k++) {
    const x = -20 + k * 2.1, y = -11.6 + k * 0.11;
    s.push(C(x, y, 0.92, 'steel'), C(x, y, 0.82, 'aluminium'), C(x, y, 0.15, 'steel'));
  }
  for (let k = 0; k < 5; k++) s.push(Rr(-6 + k * 2.6, -2.4, 1.6, 0.9, 'copper', 3));
  // keys on a ring
  s.push(C(18, -9, 1.0, 'steel'), C(18, -9, 0.86, 'air'));
  s.push(Rr(19.9, -11.4, 0.55, 3.6, 'steel', 30), C(19.1, -10.0, 0.9, 'steel'), C(19.1, -10.0, 0.25, 'air'));
  s.push(Rr(15.9, -11.6, 0.5, 3.2, 'steel', -35), C(16.8, -10.2, 0.8, 'steel'), C(16.8, -10.2, 0.22, 'air'));
  // coins
  for (const [x, y, r] of [[8, -12, 1.2], [10.6, -12.6, 1.0], [9.2, -14.4, 1.3], [11.8, -14.9, 0.9]]) s.push(C(x, y, r, 'copper'));
  // shoe
  s.push(B(-17, 10, 6.5, [[2, 0.45, 0], [3, 0.08, 0.5]], 'rubber', 10), B(-17, 10, 5.8, [[2, 0.45, 0], [3, 0.08, 0.5]], 'air', 10));
  s.push(E(-21.5, 9.2, 1.6, 1.8, 'rubber', 10));
  // tin can
  s.push(C(5, 11, 3.6, 'steel'), C(5, 11, 3.45, 'water'));
  for (let k = 0; k < 7; k++) s.push(C(3.6 + k * 0.45, 9.5 + rng() * 3, 0.2 + rng() * 0.25, 'fat'));
  return s;
}

export function buildBars() {
  const s = [C(0, 0, 9.5, 'plastic'), C(0, 0, 9.0, 'water')];
  const lpcm = [1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8];
  lpcm.forEach((lp, g) => {
    const th = (g / lpcm.length) * 2 * Math.PI + Math.PI / 2;
    const w = 0.5 / lp, cx = 5.6 * Math.cos(th), cy = 5.6 * Math.sin(th);
    const tx = -Math.sin(th), ty = Math.cos(th);
    for (let k = -2; k <= 2; k++) {
      s.push(Rr(cx + tx * k * 2 * w, cy + ty * k * 2 * w, 2.4, w, 'aluminium', (th * 180) / Math.PI));
    }
  });
  s.push(C(0, 0, 0.05, 'steel'), C(2.2, 0, 0.6, 'bone'), C(-2.2, 0, 0.6, 'lung'), C(0, -2.2, 0.6, 'fat'), C(0, 2.2, 0.6, 'plastic'));
  return s;
}

export function buildContrastDetail() {
  const s = [C(0, 0, 9.5, 'plastic'), C(0, 0, 9.1, 'water')];
  const contrast = [0.08, 0.04, 0.02, 0.01, 0.005];
  const diam = [1.5, 1.1, 0.8, 0.55, 0.35, 0.2];
  contrast.forEach((cc, r) => diam.forEach((d, c) => {
    const x = -5.6 + c * 2.24, y = 4.8 - r * 2.4;
    COMPOSITIONS['cd' + r] = [1 + cc, 0, 0];
    s.push(C(x, y, d / 2, 'cd' + r));
  }));
  return s;
}

export function buildWalnut(seed = 9) {
  const rng = mulberry32(seed);
  const shellH = [[2, 0.07, 0.3], [5, 0.025, 1], [11, 0.018, 2], [17, 0.012, 0.4], [23, 0.008, 1.7]];
  const s = [B(0, 0, 1.75, shellH, 'shell', 8), B(0, 0, 1.53, shellH, 'air', 8)];
  s.push(E(1.71, 0.24, 0.08, 0.14, 'air', 8), E(-1.71, -0.24, 0.08, 0.14, 'air', 8));
  s.push(Rr(0, 0, 0.11, 2.8, 'shell', 8), B(0, 0, 0.3, [[4, 0.4, 0]], 'shell', 8));
  for (let q = 0; q < 4; q++) {
    const th = (q + 0.5) * (Math.PI / 2) + 8 * D2R;
    const cx = 0.72 * Math.cos(th), cy = 0.72 * Math.sin(th);
    const harm = [[2, 0.12, rng() * 6], [7, 0.06 + rng() * 0.03, rng() * 6], [13, 0.05, rng() * 6], [19, 0.03, rng() * 6]];
    s.push(B(cx, cy, 0.6, harm, 'kernel', rng() * 180));
    s.push(B(cx * 1.04, cy * 1.04, 0.18, [[3, 0.3, rng() * 6]], 'air', rng() * 180));
    s.push(B(cx * 0.9, cy * 0.9, 0.12, [[2, 0.3, 0]], 'pith', rng() * 180));
  }
  return s;
}

export function buildMetal() {
  const s = [E(0, -0.6, 18, 12, 'fat'), E(0, -0.6, 17, 11, 'muscle')];
  s.push(E(0, 2.6, 3.6, 2.7, 'water'));
  s.push(C(0, -5.4, 1.35, 'soft'), C(0, -5.4, 0.7, 'air'));
  s.push(E(0, -8.4, 3.2, 1.2, 'bone'), E(0, -8.4, 2.8, 0.85, 'spongy'));
  for (const sg of [-1, 1]) {
    s.push(E(sg * 8.7, -1.2, 3.6, 3.4, 'bone'), E(sg * 8.7, -1.2, 3.2, 3.0, 'spongy'));
    s.push(C(sg * 6.9, 4.3, 0.65, 'blood'), C(sg * 5.5, 4.0, 0.55, 'blood'));
    s.push(E(sg * 12.4, -0.6, 2.4, 1.8, 'bone', sg * 30), E(sg * 12.4, -0.6, 2.0, 1.4, 'spongy', sg * 30));
  }
  // patient right (image left): implant. Patient left: native joint.
  s.push(C(-8.4, -1.2, 2.8, 'titanium'), C(-8.4, -1.2, 2.5, 'soft'), C(-8.4, -1.2, 2.25, 'steel'));
  s.push(C(8.4, -1.2, 2.75, 'soft'), C(8.4, -1.2, 2.45, 'bone'), C(8.4, -1.2, 2.15, 'spongy'));
  return s;
}

const BUILDERS = {
  head: buildHead, chest: buildChest, suitcase: buildSuitcase, bars: buildBars,
  'contrast-detail': buildContrastDetail, walnut: buildWalnut, 'metal-implant': buildMetal,
};

export function phantom2D(name, n = 256, o = {}) {
  const meta = PHANTOMS_2D.find((p) => p.key === name);
  if (!meta) throw new Error('phantom2D: unknown phantom ' + name);
  let shapes;
  if (name === 'shepp-logan') shapes = SHEPP_LOGAN_2D;
  else if (name === 'shepp-logan-modified') shapes = SHEPP_LOGAN_2D_MODIFIED;
  else shapes = BUILDERS[name](o.seed);
  const r = rasterize2D(shapes, n, meta.width, o);
  return { ...r, shapes, meta: { ...meta, units: name.startsWith('shepp') ? 'arbitrary' : '1/cm at 70 keV' } };
}

// ---------- 3D ----------

const El = (x, y, z, a, b, c, mat, phi = 0) => ({ t: 'E', x, y, z, a, b, c, mat, phi });

function head3D() {
  const s = [
    El(0, 0, 0, 8.0, 9.8, 10.6, 'soft'), El(0, 0, 0, 7.6, 9.4, 10.2, 'bone'),
    El(0, 0, 0, 7.3, 9.1, 9.9, 'spongy'), El(0, 0, 0, 7.02, 8.8, 9.6, 'bone'),
    El(0, 0, 0.3, 6.78, 8.56, 9.3, 'gray'), El(0, 0.2, 0.8, 5.5, 7.0, 7.2, 'white'),
    El(-1.15, 1.4, 1.5, 0.62, 2.6, 1.6, 'csf', -14), El(1.15, 1.4, 1.5, 0.62, 2.6, 1.6, 'csf', 14),
    El(0, -0.6, -0.5, 0.18, 1.0, 1.4, 'csf'), El(0, -2.2, 0, 0.18, 0.18, 0.18, 'bone'),
    El(2.9, 3.6, 3.0, 0.95, 0.75, 0.9, 'bleed', 30),
    El(0, 7.9, -4.2, 1.6, 1.0, 1.4, 'air'),
    El(-3.0, 7.0, -6.6, 1.35, 1.35, 1.35, 'fat'), El(3.0, 7.0, -6.6, 1.35, 1.35, 1.35, 'fat'),
    El(-3.0, 7.3, -6.6, 1.15, 1.15, 1.15, 'water'), El(3.0, 7.3, -6.6, 1.15, 1.15, 1.15, 'water'),
    El(-3.0, 7.9, -6.6, 0.45, 0.25, 0.45, 'soft'), El(3.0, 7.9, -6.6, 0.45, 0.25, 0.45, 'soft'),
  ];
  return s;
}

function chest3D() {
  const s = [
    El(0, -0.5, 0, 17, 11.5, 60, 'fat'), El(0, -0.6, 0, 16.1, 10.6, 60, 'muscle'),
    El(-7.0, 0.6, 2, 5.6, 8.2, 13, 'lung'), El(7.3, 0.4, 2, 5.2, 8.0, 13, 'lung'),
    El(1.9, 2.4, -3, 4.8, 3.9, 6, 'blood', 32), El(1.9, -4.7, 0, 1.25, 1.25, 60, 'blood'),
    El(-8.4, 3.4, 4, 0.62, 0.62, 0.62, 'soft'),
    El(0, -6.2, 0, 2.0, 2.0, 60, 'bone'), El(0, -6.2, 0, 1.75, 1.75, 60, 'spongy'),
    El(0, -8.6, 0, 0.85, 0.85, 60, 'csf'), El(0, 9.3, 0, 1.5, 0.6, 60, 'bone'),
  ];
  for (let k = -3; k <= 3; k++) {
    for (const sg of [-1, 1]) s.push(El(sg * 13.8, -4 + 2 * Math.abs(k) * 0, k * 3.2, 0.9, 6.0, 0.45, 'bone', sg * 20));
  }
  return s;
}

export function phantom3D(name, n = 128, o = {}) {
  const meta = PHANTOMS_3D.find((p) => p.key === name);
  if (!meta) throw new Error('phantom3D: unknown phantom ' + name);
  const shapes = name === 'shepp-logan' ? SHEPP_LOGAN_3D : name === 'head' ? head3D() : chest3D();
  return { volume: rasterize3D(shapes, n, meta.width, o), shapes, meta };
}

// ---------- analytic projections (additive shape lists only: Shepp-Logan) ----------

function chord2(p, ox, oy, dx, dy) {
  const X = ox - p.x, Y = oy - p.y;
  const lx = (X * p.c + Y * p.s) / p.a, ly = (-X * p.s + Y * p.c) / p.b;
  const ux = (dx * p.c + dy * p.s) / p.a, uy = (-dx * p.s + dy * p.c) / p.b;
  const A = ux * ux + uy * uy, Bq = 2 * (lx * ux + ly * uy), Cq = lx * lx + ly * ly - 1;
  const disc = Bq * Bq - 4 * A * Cq;
  return disc > 0 ? Math.sqrt(disc) / A : 0;
}

export function analyticSinogram(shapes, geom) {
  const ps = shapes.map(prep), out = new Float32Array(geom.nAngles * geom.nDet), R = {};
  for (let a = 0; a < geom.nAngles; a++) for (let i = 0; i < geom.nDet; i++) {
    rayFor(geom, a, i, R);
    let v = 0;
    for (const p of ps) v += p.A * chord2(p, R.ox, R.oy, R.dx, R.dy);
    out[a * geom.nDet + i] = v;
  }
  return { nAngles: geom.nAngles, nDet: geom.nDet, data: out };
}

export function analyticConeProjections(shapes, geom) {
  const ps = shapes.map((s) => { const p = prep(s); p.c3 = s.c; p.z = s.z || 0; return p; });
  const out = new Float32Array(geom.nAngles * geom.nu * geom.nv), R = {};
  for (let a = 0; a < geom.nAngles; a++) for (let iv = 0; iv < geom.nv; iv++) for (let iu = 0; iu < geom.nu; iu++) {
    rayFor3D(geom, a, iu, iv, R);
    let v = 0;
    for (const p of ps) {
      const X = R.ox - p.x, Y = R.oy - p.y, Z = R.oz - p.z;
      const lx = (X * p.c + Y * p.s) / p.a, ly = (-X * p.s + Y * p.c) / p.b, lz = Z / p.c3;
      const ux = (R.dx * p.c + R.dy * p.s) / p.a, uy = (-R.dx * p.s + R.dy * p.c) / p.b, uz = R.dz / p.c3;
      const A = ux * ux + uy * uy + uz * uz, Bq = 2 * (lx * ux + ly * uy + lz * uz), Cq = lx * lx + ly * ly + lz * lz - 1;
      const disc = Bq * Bq - 4 * A * Cq;
      if (disc > 0) v += p.A * (Math.sqrt(disc) / A);
    }
    out[(a * geom.nv + iv) * geom.nu + iu] = v;
  }
  return { nAngles: geom.nAngles, nu: geom.nu, nv: geom.nv, data: out };
}
