// ============================================================================
//  CT LAB 3D  ·  lib/session.js — one cone-beam scan of one object (no DOM)
// ----------------------------------------------------------------------------
//  createSession(entry, volume, settings) makes the cone geometry and scans
//  the object view by view with the engine's Joseph cone projector. The
//  physics per view:
//    mono   p = integral mu dl at 70 keV
//    poly   (beam hardening, metal streaks) the water, bone and iron path
//           lengths, then p = -ln sum_E w(E) exp(-sum_m mu_m(E) L_m) for the
//           kVp spectrum (engine polychromaticSinogram)
//    dose   counts = I0 exp(-p), Poisson noise, p = -ln(I / I0)
//  Then FDK on the CPU (chunked by view, so a page can spread it over frames)
//  or SIRT (a few iterations, exact adjoint pair) for the iterative option.
//  The page feeds the same projections to view3d for the GPU FDK.
//
//  settings: { nViews = 180, detector = 1 (0.5 coarse .. 2 fine), dose = Infinity
//    (photons per detector element without the object), kVp = 120, poly = false,
//    seed = 1, filter = 'shepp-logan', geom (use this geometry), out (projections
//    to write into, for example view3d's, so the GPU FDK reads the same data) }
//
//  GREP MAP
//    export const DEFAULTS ........ the settings defaults
//    export function makeGeometry . cone geometry with a detector factor
//    export function createSession  the scan session object
//    scan(a0, a1) ................. project views [a0, a1) with the physics
//    fdkStep(k) ................... CPU FDK on the next k scanned views
//    sirtStep() ................... one SIRT iteration on the scanned views
//    metrics(vol) ................. rmse, psnr against the object
// ============================================================================
import * as CT from '../../ct-lab/engine/index.js';
import { basisOf } from './objects.js';

export const DEFAULTS = { nViews: 180, detector: 1, dose: Infinity, kVp: 120, poly: false, seed: 1, filter: 'shepp-logan' };

export function makeGeometry(vol, nViews, detector = 1) {
  const g = CT.fitGeometry('cone', vol, { nAngles: nViews });
  if (detector === 1) return g;
  const nu = Math.max(16, Math.round(g.nu * detector)), nv = Math.max(16, Math.round(g.nv * detector));
  return CT.coneGeometry({ nAngles: nViews, nu, nv, du: (g.du * g.nu) / nu, dv: (g.dv * g.nv) / nv, sod: g.sod, sdd: g.sdd });
}

export function createSession(entry, vol, settings = {}) {
  const S = { ...DEFAULTS, ...settings };
  const geom = S.geom ?? makeGeometry(vol, S.nViews, S.detector);
  // out: write into a caller's projections (view3d.projections), same geometry
  const proj = S.out ?? CT.emptyCone(geom);
  const per = geom.nu * geom.nv;
  let basis = null, bproj = null, spec = null, rng = null;
  if (S.poly) {
    basis = basisOf(entry, vol);
    bproj = { water: CT.emptyCone(geom), bone: CT.emptyCone(geom), iron: CT.emptyCone(geom) };
    spec = CT.spectrum(S.kVp);
  }
  if (Number.isFinite(S.dose)) rng = CT.mulberry32(S.seed);
  let scanned = 0, fdkDone = 0, fdkSum = null, q = null, weights = null, sirt = null;

  function physics(a0, a1) {
    const o0 = a0 * per, o1 = a1 * per, d = proj.data;
    if (S.poly) {
      for (const m of ['water', 'bone', 'iron']) CT.forwardProjectCone(basis[m], geom, { out: bproj[m], a0, a1 });
      const view = (c) => ({ data: c.data.subarray(o0, o1) });
      const p = CT.polychromaticSinogram({ water: view(bproj.water), bone: view(bproj.bone), iron: view(bproj.iron) }, spec).data;
      d.set(p, o0);
    }
    if (rng) {
      const I0 = S.dose;
      for (let i = o0; i < o1; i++) {
        const lam = I0 * Math.exp(-d[i]);
        const I = poisson(lam, rng);
        d[i] = -Math.log(Math.max(I, 0.5) / I0);
      }
    }
  }

  const api = {
    settings: S, geom, proj, volume: vol, entry,
    get scanned() { return scanned; },
    get total() { return geom.nAngles; },
    // project views [scanned, scanned + k) and return the new count
    scan(k = 1) {
      const a0 = scanned, a1 = Math.min(geom.nAngles, scanned + k);
      if (a1 <= a0) return scanned;
      if (!S.poly) CT.forwardProjectCone(vol, geom, { out: proj, a0, a1 });
      physics(a0, a1);
      scanned = a1;
      return scanned;
    },
    scanAll() { while (scanned < geom.nAngles) api.scan(16); return proj; },
    // CPU FDK over the next k scanned views; returns { done, total, volume }
    fdkStep(k = 12) {
      if (!fdkSum) { fdkSum = new Float32Array(vol.data.length); weights = CT.angleWeights(geom); }
      const a0 = fdkDone, a1 = Math.min(scanned, a0 + k);
      if (a1 > a0) {
        const sub = { ...geom, angles: geom.angles.slice(a0, a1), nAngles: a1 - a0 };
        const chunk = { nAngles: a1 - a0, nu: geom.nu, nv: geom.nv, data: proj.data.slice(a0 * per, a1 * per) };
        const qq = CT.fdkFilter(chunk, sub, { filter: S.filter });
        const part = CT.coneBackProjectFDK(qq, sub, { nx: vol.nx, ny: vol.ny, nz: vol.nz, width: vol.width }, { weights: weights.slice(a0, a1) });
        const P = part.data;
        for (let i = 0; i < fdkSum.length; i++) fdkSum[i] += P[i];
        fdkDone = a1;
      }
      const sc = fdkDone ? geom.nAngles / fdkDone : 0, out = new Float32Array(fdkSum.length);
      for (let i = 0; i < out.length; i++) out[i] = fdkSum[i] * sc;
      return { done: fdkDone, total: geom.nAngles, volume: { nx: vol.nx, ny: vol.ny, nz: vol.nz, width: vol.width, data: out } };
    },
    fdk() { let r; do r = api.fdkStep(30); while (r.done < scanned); return r.volume; },
    // SIRT: x += C A^T R (b - A x), R = 1/(A 1), C = 1/(A^T 1), x >= 0.
    sirtStep(relax = 1) {
      const dims = { nx: vol.nx, ny: vol.ny, nz: vol.nz, width: vol.width };
      if (!sirt) {
        const ones = { ...dims, data: new Float32Array(vol.data.length).fill(1) };
        const R = CT.forwardProjectCone(ones, geom).data;
        for (let i = 0; i < R.length; i++) R[i] = R[i] > 1e-6 ? 1 / R[i] : 0;
        const onesP = CT.emptyCone(geom); onesP.data.fill(1);
        const C = CT.backProjectCone(onesP, geom, dims).data;
        for (let i = 0; i < C.length; i++) C[i] = C[i] > 1e-6 ? 1 / C[i] : 0;
        sirt = { R, C, x: { ...dims, data: new Float32Array(vol.data.length) }, iter: 0 };
      }
      const Ax = CT.forwardProjectCone(sirt.x, geom).data, b = proj.data;
      let res = 0;
      for (let i = 0; i < Ax.length; i++) { const r = b[i] - Ax[i]; res += r * r; Ax[i] = r * sirt.R[i]; }
      const up = CT.backProjectCone({ ...proj, data: Ax }, geom, dims).data, x = sirt.x.data;
      for (let i = 0; i < x.length; i++) { const v = x[i] + relax * sirt.C[i] * up[i]; x[i] = v > 0 ? v : 0; }
      sirt.iter++;
      return { iter: sirt.iter, residual: Math.sqrt(res), volume: sirt.x };
    },
    metrics(rec) { return { rmse: CT.rmse(vol.data, rec.data), psnr: CT.psnr(vol.data, rec.data) }; },
  };
  return api;
}

// Poisson sample: exact (Knuth) for small means, normal approximation above 50.
function poisson(lam, rng) {
  if (lam <= 0) return 0;
  if (lam > 50) {
    const u1 = Math.max(1e-12, rng()), u2 = rng();
    return Math.max(0, Math.round(lam + Math.sqrt(lam) * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)));
  }
  const L = Math.exp(-lam);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L);
  return k - 1;
}
