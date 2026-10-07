// ============================================================================
//  PARTICLE COLLIDER  ·  geometry.js — the barrel detector, navigator, field
// ----------------------------------------------------------------------------
//  No DOM. One description of the detector serves the transport engine
//  (navigation, field, readout) and the diagrams (diagram.js draws the
//  same radii as outlines). The sizes are near those of a large LHC barrel detector
//  with a 3.8 T solenoid, rounded and simplified. Units: mm, T.
//
//  SHAPES
//    Every volume is a tube: rmin <= r < rmax, z0 <= z < z1, axis on z (the
//    beam). The tree has two levels under the world, as Geant4 logical
//    volumes do: the world (air) holds regions (tracker, calorimeters,
//    coil, muon system) and a region holds its daughters (silicon layers,
//    scintillator planes, iron plates, chambers). Daughters do not overlap.
//
//  NAVIGATION (grep -n 'function locate' / 'function distOut' / 'function nextBoundary')
//    locate(x, y, z) ....... the deepest volume at a point
//    nextBoundary(v, p, d) . the straight-line distance from p along d to
//                            the next boundary: the exit of v or the entry
//                            of one of its daughters
//  FIELD (grep -n 'function field')
//    Inside the coil Bz = 3.8 T, flat to |z| = 3800 mm, then a cosine taper
//    to 0 at 6400 mm, with Br = -(r/2) dBz/dz so that div B = 0. The
//    return flux runs at -1.8 T in the barrel iron and radially in the
//    endcap iron. uniformBz() gives Bz where it is constant along the
//    step's region (the helix applies), else NaN (Runge-Kutta applies).
//  READOUT
//    ECAL cells 0.0348 x 0.0348 in eta-phi (180 in phi), HCAL towers
//    0.087 x 0.087 (72 in phi), both over |eta| < 3. cellIndex() maps a
//    point to a cell.
// ============================================================================
import { MAT } from './materials.js';

export const B0 = 3.8, B_YOKE = 1.8;
export const ECAL = { deta: 0.0348, nphi: 180, etaMax: 3.0 };
export const HCAL = { deta: 0.087, nphi: 72, etaMax: 3.0 };
ECAL.neta = Math.round(2 * ECAL.etaMax / ECAL.deta); HCAL.neta = Math.round(2 * HCAL.etaMax / HCAL.deta);

let NEXT = 0;
function tube(name, sys, mat, rmin, rmax, z0, z1, o = {}) {
  return { id: NEXT++, name, sys, mat: MAT[mat], rmin, rmax, z0, z1, kids: [], parent: null, active: !!o.active, layer: o.layer ?? -1, group: o.group || sys };
}
function add(p, k) { k.parent = p; p.kids.push(k); return k; }

export function buildDetector() {
  NEXT = 0;
  const world = tube('World', 'air', 'air', 0, 7000, -7000, 7000);
  const V = [world];
  const put = (p, t) => { add(p, t); V.push(t); return t; };

  // tracker region: beam pipe, 4 pixel layers, 10 strip layers, disks
  const trk = put(world, tube('Tracker volume', 'air', 'air', 0, 1200, -2800, 2800));
  put(trk, tube('Beam vacuum', 'vac', 'vacuum', 0, 21.7, -2800, 2800));
  put(trk, tube('Beam pipe', 'pipe', 'Be', 21.7, 22.5, -2800, 2800));
  // silicon-equivalent thicknesses include the supports, cooling and cables
  const PIX = [29, 68, 109, 160], SCT = [255, 339, 418, 498, 608, 692, 780, 868, 965, 1080];
  let L = 0;
  for (const r of PIX) put(trk, tube(`Pixel layer ${L + 1}`, 'pix', 'Si', r, r + 0.8, -270, 270, { active: true, layer: L++ }));
  for (const [i, r] of SCT.entries()) put(trk, tube(`Strip layer ${i + 1}`, 'sct', 'Si', r, r + 1.6, i < 4 ? -700 : -1100, i < 4 ? 700 : 1100, { active: true, layer: L++ }));
  for (const s of [-1, 1]) {
    for (const [i, z] of [320, 395, 485].entries()) { const a = s * z; put(trk, tube(`Pixel disk ${s > 0 ? '+' : '−'}${i + 1}`, 'pix', 'Si', 45, 161, Math.min(a, a + s * 0.8), Math.max(a, a + s * 0.8), { active: true, layer: 14 + i })); }
    for (const [i, z] of [1250, 1500, 1750, 2000, 2300, 2600].entries()) { const a = s * z; put(trk, tube(`Strip disk ${s > 0 ? '+' : '−'}${i + 1}`, 'sct', 'Si', 230, 1100, Math.min(a, a + s * 1.6), Math.max(a, a + s * 1.6), { active: true, layer: 17 + i })); }
  }

  // electromagnetic calorimeter: lead tungstate, 230 mm = 25.8 X0
  put(world, tube('ECAL barrel', 'ecal', 'PbWO4', 1290, 1520, -2900, 2900, { active: true }));
  put(world, tube('ECAL endcap +', 'ecal', 'PbWO4', 320, 1520, 3000, 3230, { active: true }));
  put(world, tube('ECAL endcap −', 'ecal', 'PbWO4', 320, 1520, -3230, -3000, { active: true }));

  // hadron calorimeter: brass absorber with 18 scintillator planes
  const hb = put(world, tube('HCAL barrel', 'hcal', 'brass', 1770, 2950, -3300, 3300, { active: true }));
  for (let i = 0; i < 18; i++) put(hb, tube(`HCAL barrel plane ${i}`, 'hcalS', 'scint', 1772 + 64 * i, 1776 + 64 * i, -3300, 3300, { active: true, layer: i, group: 'hcal' }));
  for (const s of [-1, 1]) {
    const he = put(world, tube(`HCAL endcap ${s > 0 ? '+' : '−'}`, 'hcal', 'brass', 300, 2950, s > 0 ? 3300 : -4900, s > 0 ? 4900 : -3300, { active: true }));
    for (let i = 0; i < 18; i++) { const a = s * (3302 + 88 * i); put(he, tube(`HCAL endcap plane ${i}`, 'hcalS', 'scint', 300, 2950, Math.min(a, a + 4 * s), Math.max(a, a + 4 * s), { active: true, layer: i, group: 'hcal' })); }
  }

  // superconducting coil and cryostat (aluminium-equivalent)
  put(world, tube('Solenoid', 'sol', 'Al', 2980, 3300, -5000, 5000));

  // muon system: 4 chamber stations between 3 iron return-yoke layers
  const mub = put(world, tube('Muon barrel', 'air', 'air', 3400, 6500, -5000, 5000));
  const MB = [[3500, 3700], [4350, 4550], [5250, 5450], [6250, 6450]], FE = [[3750, 4300], [4600, 5200], [5500, 6200]];
  MB.forEach(([a, b], i) => put(mub, tube(`Muon station MB${i + 1}`, 'mu', 'gas', a, b, -5000, 5000, { active: true, layer: i })));
  FE.forEach(([a, b], i) => put(mub, tube(`Yoke barrel ${i + 1}`, 'yoke', 'Fe', a, b, -5000, 5000)));
  for (const s of [-1, 1]) {
    const me = put(world, tube(`Muon endcap ${s > 0 ? '+' : '−'}`, 'air', 'air', 300, 6500, s > 0 ? 5050 : -7000, s > 0 ? 7000 : -5050));
    const ME = [[5100, 5250], [5650, 5800], [6300, 6450], [6850, 6980]], FEZ = [[5300, 5600], [5850, 6250], [6500, 6800]];
    ME.forEach(([a, b], i) => put(me, tube(`Muon station ME${s > 0 ? '+' : '−'}${i + 1}`, 'mu', 'gas', 400, 6500, s > 0 ? a : -b, s > 0 ? b : -a, { active: true, layer: i })));
    FEZ.forEach(([a, b], i) => put(me, tube(`Yoke endcap ${s > 0 ? '+' : '−'}${i + 1}`, 'yoke', 'Fe', 400, 6500, s > 0 ? a : -b, s > 0 ? b : -a)));
  }
  return { world, V, regions: world.kids, PIX, SCT, MB, FE };
}

// A test bench: one block of a material (a tube r < 3000 mm from z = 0 to
// len) in an air or vacuum world, with no field. tests.mjs uses it for the
// shower profile, the Highland width and the decay length.
export function buildBlock(matKey, len, worldMat = 'air') {
  NEXT = 0;
  const world = tube('World', 'air', worldMat, 0, 4000, -100, len + 100);
  const V = [world], b = tube('Block', 'ecal', matKey, 0, 3000, 0, len, { active: true });
  add(world, b); V.push(b);
  return { world, V, regions: world.kids, PIX: [], SCT: [], MB: [], FE: [], noField: true };
}

// ── point tests and straight-line distances ───────────────────────────────
export const inside = (v, x, y, z) => { const r2 = x * x + y * y; return z >= v.z0 && z < v.z1 && r2 < v.rmax * v.rmax && r2 >= v.rmin * v.rmin; };

export function locate(D, x, y, z) {
  const w = D.world;
  if (!inside(w, x, y, z)) return null;
  for (const R of w.kids) if (inside(R, x, y, z)) {
    for (const k of R.kids) if (inside(k, x, y, z)) return k;
    return R;
  }
  return w;
}

// roots of |p_perp + t d_perp| = R
function rootsR(px, py, dx, dy, R) {
  const a = dx * dx + dy * dy;
  if (a < 1e-18) return null;
  const b = px * dx + py * dy, c = px * px + py * py - R * R, disc = b * b - a * c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  return [(-b - s) / a, (-b + s) / a];
}
// distance from a point inside v to its surface along d
export function distOut(v, px, py, pz, dx, dy, dz) {
  let t = Infinity;
  if (dz > 0) t = (v.z1 - pz) / dz; else if (dz < 0) t = (v.z0 - pz) / dz;
  const ro = rootsR(px, py, dx, dy, v.rmax);
  if (ro && ro[1] > 0) t = Math.min(t, ro[1]);
  if (v.rmin > 0) { const ri = rootsR(px, py, dx, dy, v.rmin); if (ri && ri[0] > 0) t = Math.min(t, ri[0]); }
  return Math.max(0, t);
}
// distance from a point outside v to its first entry along d (Infinity: none)
export function distIn(v, px, py, pz, dx, dy, dz) {
  const C = [];
  if (dz !== 0) { C.push((v.z0 - pz) / dz, (v.z1 - pz) / dz); }
  const ro = rootsR(px, py, dx, dy, v.rmax); if (ro) C.push(ro[0], ro[1]);
  if (v.rmin > 0) { const ri = rootsR(px, py, dx, dy, v.rmin); if (ri) C.push(ri[0], ri[1]); }
  let best = Infinity;
  for (const t of C) {
    if (!(t >= 0) || t >= best) continue;
    const e = t + 1e-6;
    if (inside(v, px + e * dx, py + e * dy, pz + e * dz)) best = t;
  }
  return best;
}
export function nextBoundary(v, px, py, pz, dx, dy, dz) {
  let t = distOut(v, px, py, pz, dx, dy, dz);
  for (const k of v.kids) { const q = distIn(k, px, py, pz, dx, dy, dz); if (q < t) t = q; }
  return t;
}

// ── magnetic field ────────────────────────────────────────────────────────
const RCOIL = 2980, ZF = 3800, ZE = 6400;
function fz(az) { return az < ZF ? 1 : az > ZE ? 0 : 0.5 * (1 + Math.cos(Math.PI * (az - ZF) / (ZE - ZF))); }
function dfz(az) { return az < ZF || az > ZE ? 0 : -0.5 * Math.PI / (ZE - ZF) * Math.sin(Math.PI * (az - ZF) / (ZE - ZF)); }
const inFe = (D, r, z) => {
  const az = Math.abs(z);
  if (az < 5000) { for (const [a, b] of D.FE) if (r >= a && r < b) return 1; return 0; }
  if (r >= 400 && r < 6500) { for (const [a, b] of [[5300, 5600], [5850, 6250], [6500, 6800]]) if (az >= a && az < b) return 2; }
  return 0;
};
// B at a point, written into out[0..2] (T)
export function field(D, x, y, z, out) {
  if (D.noField) { out[0] = out[1] = out[2] = 0; return out; }
  const r = Math.hypot(x, y), az = Math.abs(z);
  out[0] = out[1] = out[2] = 0;
  if (r < RCOIL) {
    const bz = B0 * fz(az), dbz = B0 * dfz(az) * Math.sign(z), br = -0.5 * r * dbz;
    out[2] = bz;
    if (br !== 0 && r > 0) { out[0] = br * x / r; out[1] = br * y / r; }
    return out;
  }
  const fe = inFe(D, r, z);
  if (fe === 1) out[2] = -B_YOKE * fz(az);
  else if (fe === 2 && r > 0) { const s = Math.sign(z) * 1.6; out[0] = s * x / r; out[1] = s * y / r; }
  return out;
}
// constant Bz near this point (helix region), 0 for field-free, NaN otherwise
export function uniformBz(D, x, y, z) {
  if (D.noField) return 0;
  const r = Math.hypot(x, y), az = Math.abs(z);
  if (r < RCOIL) return az < ZF ? B0 : az > ZE ? 0 : NaN;
  const fe = inFe(D, r, z);
  if (fe === 1) return az < ZF ? -B_YOKE : NaN;
  if (fe === 2) return NaN;
  return 0;
}

// ── readout cells ─────────────────────────────────────────────────────────
export function etaPhi(x, y, z) {
  const r = Math.hypot(x, y), th = Math.atan2(r, z);
  return [-Math.log(Math.tan(Math.max(1e-9, th) / 2)), Math.atan2(y, x)];
}
export function cellIndex(G, x, y, z) {
  const [eta, phi] = etaPhi(x, y, z);
  if (Math.abs(eta) >= G.etaMax) return -1;
  const ie = Math.floor((eta + G.etaMax) / G.deta), ip = ((Math.floor((phi + Math.PI) / (2 * Math.PI) * G.nphi) % G.nphi) + G.nphi) % G.nphi;
  return ie * G.nphi + ip;
}
export function cellCenter(G, idx) {
  const ie = Math.floor(idx / G.nphi), ip = idx % G.nphi;
  return [-G.etaMax + (ie + 0.5) * G.deta, -Math.PI + (ip + 0.5) * 2 * Math.PI / G.nphi];
}
