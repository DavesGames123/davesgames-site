// ============================================================================
//  PLANT GROWTH  ·  a triangle mesh of a plant at one moment (DOM-free)
// ----------------------------------------------------------------------------
//  The CPU twin of the render.js shaders, for a render with no GPU (a home
//  thumbnail in node, the tests). It uses the same pack (pose.js) and the
//  same rules (season.js), so it shows what the page shows, less the wind.
//
//    import { growLife } from './grow.js';
//    import { plantMesh } from './mesh.js';
//    const sim = growLife('oak', { seed: 7 });
//    const m = plantMesh(sim, { t: sim.years - 0.5 });   // midsummer of the last year
//    m.branches: { pos, nrm, uv, idx, layer }   (bark uv in tiles, layer per vertex)
//    m.leaves:   { pos, nrm, uv, idx, tint, info }  (uv in the leaf atlas;
//                 info per vertex: autumn mix, litter, kind, species)
//    m.box:      [x0, y0, z0, x1, y1, z1] of the plant
//
//  grep -n targets
//    from a sim ............. "export function plantMesh"
//    tubes .................. "function tubes"
//    leaf quads ............. "function leafQuads"
// ============================================================================
import { createHistory, addToHistory, packYear, nodeShown, nodeFrame, leafPose, CELLS, SPECIES_TABLE } from './pose.js';
import { LOOK, BARKS } from './look.js';
import { SPECIES_IDS } from './grow.js';
import { groundY } from './ground.js';

// opts: t (clock in years), radial (ring vertices), keep (leaf share),
// rings (rings per segment, 1 = one straight piece)
export function plantMesh(sim, opts = {}) {
  const snap = sim.snapshot ? sim.snapshot() : sim;
  const hist = createHistory();
  if (sim.radHist) for (let y = 0; y < sim.radHist.length; y++) addToHistory(hist, { year: y, radius: sim.radHist[y], light: sim.lightHist[y], vigor: sim.vigorHist[y], tips: sim.tipsHist[y] });
  else addToHistory(hist, snap);
  const t = opts.t ?? (snap.year + 0.55);
  const pk = packYear(snap, hist, Math.floor(t), { keep: opts.keep ?? 1 });
  return { branches: tubes(pk, t, opts), leaves: leafQuads(pk, t, opts), box: pk.box, pack: pk, t };
}

function tubes(pk, t, opts) {
  const R = opts.radial ?? 10;
  const pos = [], nrm = [], uv = [], idx = [], layer = [];
  const A = [0, 0, 0, 0], B = [0, 0, 0, 0];
  const fa = { t: [0, 1, 0], n: [1, 0, 0], b: [0, 0, 1] }, fb = { t: [0, 1, 0], n: [1, 0, 0], b: [0, 0, 1] };
  const T1 = pk.T[1], T3 = pk.T[3], T4 = pk.T[4];
  for (let j = 0; j < pk.n; j++) {
    const o = j * 4, pe = T1[o + 2], q = pe >= 0 ? pe : -pe - 1, main = pe >= 0;
    if (q === j) continue;
    nodeShown(pk, j, t, null, B);
    if (B[3] <= 0) continue;
    nodeShown(pk, q, t, null, A);
    const sx = B[0] - A[0], sy = B[1] - A[1], sz = B[2] - A[2], L = Math.hypot(sx, sy, sz);
    if (L < 1e-5) continue;
    const sd = [sx / L, sy / L, sz / L];
    nodeFrame(pk, q, fa); nodeFrame(pk, j, fb);
    const sp = T4[o] | 0, look = LOOK[SPECIES_IDS[sp]], tile = look.tile, lay = Math.max(0, BARKS.indexOf(look.bark));
    // ring at the base: the parent frame on the main axis, the segment on a lateral
    const tA = main ? fa.t : sd, rA = main ? A[3] : B[3];
    const gc = Math.min(1, Math.max(0, (t - T3[o + 1]) / SPECIES_TABLE.pheno2[sp * 4 + 1]));
    const tB = norm([sd[0] + (fb.t[0] - sd[0]) * gc, sd[1] + (fb.t[1] - sd[1]) * gc, sd[2] + (fb.t[2] - sd[2]) * gc]);
    const nA = perp(fa.n, tA), nB = perp(fb.n, tB);
    const bA = cross(tA, nA), bB = cross(tB, nB);
    const rings = [[A, tA, nA, bA, rA, T3[q * 4]], [B, tB, nB, bB, B[3], T3[q * 4] + L]];
    const around = Math.max(1, Math.round(2 * Math.PI * Math.max(rA, 0.01) / tile * 2) / 2);
    const trunk = (T4[o + 3] & 2) !== 0;
    const base = pos.length / 3;
    for (const [C, tt, nn, bb, r, s] of rings) {
      for (let k = 0; k <= R; k++) {
        const a = k / R * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        let rr = r;
        if (trunk && s < 1.2) rr *= 1 + 0.5 * Math.exp(-s / 0.28) * Math.min(1, r / 0.04) * (1 + 0.35 * Math.max(0, Math.sin(5 * a)));
        const nx = ca * nn[0] + sa * bb[0], ny = ca * nn[1] + sa * bb[1], nz = ca * nn[2] + sa * bb[2];
        pos.push(C[0] + nx * rr, C[1] + ny * rr, C[2] + nz * rr);
        nrm.push(nx, ny, nz);
        uv.push(k / R * around, s / tile);
        layer.push(lay);
      }
    }
    for (let k = 0; k < R; k++) {
      const a = base + k, b = base + k + 1, c = base + R + 1 + k, d = base + R + 2 + k;
      idx.push(a, b, c, b, d, c);
    }
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(uv), idx: new Uint32Array(idx), layer: new Uint8Array(layer) };
}

function leafQuads(pk, t, opts) {
  const NX = 2, NY = 3;
  opts = Object.assign({ groundY }, opts);
  const pos = [], nrm = [], uv = [], idx = [], info = [];
  for (let k = 0; k < pk.leafN; k++) {
    const lp = leafPose(pk, k, t, opts);
    if (!lp || lp.len < 1e-4) continue;
    const C = CELLS[lp.cell], base = pos.length / 3;
    const flower = lp.kind === 1;
    for (let iy = 0; iy <= NY; iy++) for (let ix = 0; ix <= NX; ix++) {
      const x = ix / NX - 0.5, y = iy / NY;
      const fold = lp.fall >= 1 ? 0.05 : lp.fold, curl = lp.fall >= 1 ? 0.02 : lp.curl;
      const ax = x * lp.w * Math.cos(fold), ay = y * lp.len;
      const az = Math.abs(x) * lp.w * Math.sin(fold) - curl * y * y * lp.len + (flower ? (x * x) * lp.w * 0.5 * (1 - lp.show) : 0);
      pos.push(lp.o[0] + lp.dL[0] * ay + lp.wid[0] * ax + lp.nL[0] * az,
        lp.o[1] + lp.dL[1] * ay + lp.wid[1] * ax + lp.nL[1] * az,
        lp.o[2] + lp.dL[2] * ay + lp.wid[2] * ax + lp.nL[2] * az);
      nrm.push(lp.nL[0], lp.nL[1], lp.nL[2]);
      uv.push(C[0] + (C[2] - C[0]) * (x + 0.5), C[1] + (C[3] - C[1]) * y);
      info.push(lp.colour, lp.fall >= 1 ? lp.litter : 1, lp.kind, lp.sp, lp.rand, pk.T[3][lp.node * 4 + 2]);
    }
    for (let iy = 0; iy < NY; iy++) for (let ix = 0; ix < NX; ix++) {
      const a = base + iy * (NX + 1) + ix, b = a + 1, c = a + NX + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(uv), idx: new Uint32Array(idx), info: new Float32Array(info), infoStride: 6 };
}

function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; return v; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function perp(n, t) {
  const k = n[0] * t[0] + n[1] * t[1] + n[2] * t[2];
  const v = [n[0] - k * t[0], n[1] - k * t[1], n[2] - k * t[2]];
  if (Math.hypot(v[0], v[1], v[2]) < 1e-4) return norm([-t[2], 0, t[0]]);
  return norm(v);
}
