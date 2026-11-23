// ============================================================================
//  THUNDER ACOUSTICS  ·  fdtd.js — the 2D acoustic solver
// ----------------------------------------------------------------------------
//  Pure module (no DOM). Linear acoustics on a staggered grid (Yee):
//      dv/dt = -(1/rho) grad p          dp/dt = -rho c(z)^2 div v
//  p sits at cell centres, vx on the vertical faces, vz on the horizontal
//  faces. Leapfrog in time; the step is dt = CFL dx / c_max with CFL 0.5
//  (the 2D limit is 1/sqrt 2).
//
//  Boundaries. A face next to a solid cell (ground, terrain, a building)
//  has v = 0: a rigid wall that reflects. The left, right and top edges
//  have a sponge layer of SPONGE cells that damps p and v, so the waves
//  leave the domain with a small reflection.
//
//  Source. inject() adds the initial overpressure of the channel: a
//  Gaussian ridge of width 1.5 dx along every segment, weighted by the
//  energy per unit length. The grid cannot hold the 2 m channel, so the
//  field is a low-pass copy of the real one, valid below fMax = c/(6 dx).
//  The cross-section is 2D: the channel acts as a sheet across the plane,
//  so the spreading is cylindrical (1/sqrt r), the same as a long channel
//  seen from closer than its length.
//
//  grep -n: "export function createGrid"  "export function setScene"
//           "export function inject"  "export function step"
//           "export function probe"  "export function energy"
// ============================================================================
import { solidAt, cAt } from './scene.js';

export const RHO = 1.2, SPONGE = 36, CFL = 0.5;

export function createGrid(sc, dx) {
  const nx = Math.round(sc.W / dx), nz = Math.round(sc.H / dx);
  const N = nx * nz;
  const g = {
    nx, nz, dx, W: sc.W, H: sc.H,
    p: new Float32Array(N), e: new Float32Array(N),
    vx: new Float32Array((nx + 1) * nz), vz: new Float32Array(nx * (nz + 1)),
    mx: new Float32Array((nx + 1) * nz), mz: new Float32Array(nx * (nz + 1)),
    solid: new Uint8Array(N), K: new Float32Array(nz), dampP: new Float32Array(N),
    top: new Float32Array(nx), dt: 0, t: 0, steps: 0, cMax: 0, fMax: 0,
  };
  setScene(g, sc);
  return g;
}

// Masks, sound speed per row, the sponge and the time step.
export function setScene(g, sc) {
  const { nx, nz, dx } = g;
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) g.solid[i + k * nx] = solidAt(sc, (i + 0.5) * dx, (k + 0.5) * dx) ? 1 : 0;
  for (let i = 0; i < nx; i++) { let k = 0; while (k < nz && g.solid[i + k * nx]) k++; g.top[i] = k; }
  let cMax = 0, cMin = 1e9;
  for (let k = 0; k < nz; k++) { const c = cAt(sc, (k + 0.5) * dx); g.K[k] = RHO * c * c; cMax = Math.max(cMax, c); cMin = Math.min(cMin, c); }
  g.cMax = cMax; g.fMax = cMin / (6 * dx);
  g.dt = CFL * dx / cMax;
  for (let k = 0; k < nz; k++) for (let i = 0; i <= nx; i++) {
    const a = i > 0 ? g.solid[i - 1 + k * nx] : 1, b = i < nx ? g.solid[i + k * nx] : 1;
    g.mx[i + k * (nx + 1)] = a || b ? 0 : 1;
  }
  for (let k = 0; k <= nz; k++) for (let i = 0; i < nx; i++) {
    const a = k > 0 ? g.solid[i + (k - 1) * nx] : 1, b = k < nz ? g.solid[i + k * nx] : 0;
    g.mz[i + k * nx] = a || b ? 0 : 1;
  }
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const d = Math.max(SPONGE - i, i - (nx - 1 - SPONGE), k - (nz - 1 - SPONGE), 0) / SPONGE;
    g.dampP[i + k * nx] = 1 - 0.22 * d * d;
  }
  for (let j = 0; j < g.p.length; j++) if (g.solid[j]) g.p[j] = 0;
}

export function clear(g) { g.p.fill(0); g.vx.fill(0); g.vz.fill(0); g.e.fill(0); g.t = 0; g.steps = 0; }

// Initial overpressure of the channel. amp is the peak of the ridge for
// w = 1; each segment uses amp * sqrt(w).
export function inject(g, segs, amp = 1) {
  const { nx, nz, dx, p } = g;
  const s = 1.5 * dx, R = 3 * s, inv = 1 / (2 * s * s);
  // max over segments, so overlapping segments do not stack at the joints
  const tmp = new Float32Array(nx * nz);
  for (const sg of segs) {
    const a = amp * Math.sqrt(sg.w);
    const x0 = Math.min(sg.x0, sg.x1) - R, x1 = Math.max(sg.x0, sg.x1) + R;
    const z0 = Math.min(sg.z0, sg.z1) - R, z1 = Math.max(sg.z0, sg.z1) + R;
    const i0 = Math.max(0, Math.floor(x0 / dx)), i1 = Math.min(nx - 1, Math.ceil(x1 / dx));
    const k0 = Math.max(0, Math.floor(z0 / dx)), k1 = Math.min(nz - 1, Math.ceil(z1 / dx));
    const ex = sg.x1 - sg.x0, ez = sg.z1 - sg.z0, L2 = ex * ex + ez * ez || 1;
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const px = (i + 0.5) * dx - sg.x0, pz = (k + 0.5) * dx - sg.z0;
      const u = Math.max(0, Math.min(1, (px * ex + pz * ez) / L2));
      const qx = px - u * ex, qz = pz - u * ez, d2 = qx * qx + qz * qz;
      if (d2 > R * R) continue;
      const v = a * Math.exp(-d2 * inv), j = i + k * nx;
      if (v > tmp[j]) tmp[j] = v;
    }
  }
  for (let j = 0; j < p.length; j++) if (!g.solid[j]) p[j] += tmp[j];
}

// One leapfrog step. eDecay sets the time window of the energy view.
export function step(g, eDecay = 0.985) {
  const { nx, nz, dx, dt, p, vx, vz, mx, mz, K, dampP, e } = g;
  const cv = dt / (RHO * dx), nx1 = nx + 1;
  for (let k = 0; k < nz; k++) {
    const rp = k * nx, rv = k * nx1;
    for (let i = 1; i < nx; i++) vx[rv + i] = (vx[rv + i] - cv * (p[rp + i] - p[rp + i - 1])) * mx[rv + i];
  }
  for (let k = 1; k < nz; k++) {
    const rp = k * nx, rq = (k - 1) * nx;
    for (let i = 0; i < nx; i++) vz[rp + i] = (vz[rp + i] - cv * (p[rp + i] - p[rq + i])) * mz[rp + i];
  }
  for (let k = 0; k < nz; k++) {
    const cp = K[k] * dt / dx, rp = k * nx, rv = k * nx1, ru = (k + 1) * nx;
    for (let i = 0; i < nx; i++) {
      const j = rp + i;
      const div = vx[rv + i + 1] - vx[rv + i] + vz[ru + i] - vz[j];
      const d = dampP[j];
      const pv = (p[j] - cp * div) * d;
      p[j] = pv;
      e[j] = e[j] * eDecay + pv * pv;
      if (d < 1) { vx[rv + i] *= d; vz[j] *= d; }
    }
  }
  g.t += dt; g.steps++;
}

// Bilinear pressure at (x, z) metres.
export function probe(g, x, z) {
  const { nx, nz, dx, p } = g;
  const fx = Math.max(0, Math.min(nx - 1.001, x / dx - 0.5)), fz = Math.max(0, Math.min(nz - 1.001, z / dx - 0.5));
  const i = Math.floor(fx), k = Math.floor(fz), u = fx - i, v = fz - k;
  const at = (a, b) => g.solid[a + b * nx] ? 0 : p[a + b * nx];
  return (at(i, k) * (1 - u) + at(i + 1, k) * u) * (1 - v) + (at(i, k + 1) * (1 - u) + at(i + 1, k + 1) * u) * v;
}

// Acoustic energy (per unit depth) in the interior, J/m.
export function energy(g) {
  const { nx, nz, dx, p, vx, vz, K } = g;
  let E = 0;
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const j = i + k * nx;
    if (g.solid[j]) continue;
    const ux = 0.5 * (vx[i + k * (nx + 1)] + vx[i + 1 + k * (nx + 1)]);
    const uz = 0.5 * (vz[j] + vz[j + nx]);
    E += 0.5 * p[j] * p[j] / K[k] + 0.5 * RHO * (ux * ux + uz * uz);
  }
  return E * dx * dx;
}
