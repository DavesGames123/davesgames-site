// ============================================================================
//  PLANET COLLISION  ·  analysis.js — what the collision made, from one
//  particle readback (no DOM, no GPU)
// ----------------------------------------------------------------------------
//  main.js reads the particles back every few seconds after contact
//  (sim.readback(['pos', 'vel', 'grav', 'aux'])) and calls outcome(). The
//  numbers panel and the saver plate show the result.
//
//  METHOD (after Canup 2004, Icarus 168, 433, section 2.2):
//    1  the bound set: sph.js boundMass (energy 1/2 v^2 + phi < 0 against
//       the centre of the bound set, phi from the solver's gravity sum).
//    2  the largest body: start from the bound set; its radius Rp is the
//       radius of a sphere of mass Mp at the mean density of the start
//       bodies. Each other particle moves on a two-body orbit about the
//       largest body (mass Mp, centre X, velocity V):
//         e = 1/2 |v - V|^2 - Mp / r      specific orbital energy
//         a = -Mp / (2 e),  ecc = sqrt(1 + 2 e h^2 / Mp^2),  q = a (1 - ecc)
//       r < Rp, or e < 0 with periapsis q < Rp: part of the largest body
//       (it falls back); e < 0 with q > Rp: the disk; e >= 0: escaping.
//       Five passes update Mp, Rp, X and V.
//    3  a hot tail: the 99th percentile of the particle temperatures (the
//       hottest single particle is SPH wall heating, CONTRACT.md).
//  A body that runs on after a hit-and-run counts as escaping: it is not
//  bound to the largest body.
//
//  The mean-density radius is a simplification: a hot remnant is larger
//  than that, so a few disk particles near the surface count as falling
//  back (the disk mass is a lower bound).
//
//  grep -n targets: "export function outcome", "export function percentile",
//  "export const M_MOON"
// ============================================================================
import { boundMass } from './sph.js';
import { UNIT } from './data.js';

export const M_MOON = 7.346e22 / UNIT.M;   // the Moon's mass in code units

// The p-quantile (0..1) of the first n values of a, by a sort of a copy.
export function percentile(a, n, p) {
  if (!n) return 0;
  const b = Float32Array.from(a.subarray ? a.subarray(0, n) : a.slice(0, n)).sort();
  return b[Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))))];
}

// rb: { pos, vel, grav, aux } Float32Arrays (CONTRACT.md "GPU buffers":
// vec4 rows, grav two vec4 rows per particle); n: live particles;
// bodies: setup.bodies (M, R). Returns code units:
// { Mtot, Mp, Md, Me, Rp, X, T99, nP, nD, nE }.
export function outcome(rb, n, bodies) {
  const x = new Float64Array(3 * n), v = new Float64Array(3 * n), m = new Float64Array(n), phi = new Float64Array(n);
  let Mtot = 0;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) { x[3 * i + c] = rb.pos[4 * i + c]; v[3 * i + c] = rb.vel[4 * i + c]; }
    m[i] = rb.vel[4 * i + 3]; phi[i] = rb.grav[8 * i + 3]; Mtot += m[i];
  }
  const bm = boundMass(x, v, m, phi, n);
  let vol = 0, mass = 0;
  for (const b of bodies) { vol += b.R ** 3; mass += b.M; }
  const rhoK = mass / vol;                      // M / R^3 of the start bodies
  const mem = Uint8Array.from(bm.members);      // 1 = part of the largest body
  const cls = new Uint8Array(n);                // 0 largest body, 1 disk, 2 escaping
  let Mp = bm.M, X = bm.X, V = bm.V, Rp = Math.cbrt(Mp / rhoK);
  for (let pass = 0; pass < 5; pass++) {
    let M2 = 0; const X2 = [0, 0, 0], V2 = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const rx = x[3 * i] - X[0], ry = x[3 * i + 1] - X[1], rz = x[3 * i + 2] - X[2];
      const ux = v[3 * i] - V[0], uy = v[3 * i + 1] - V[1], uz = v[3 * i + 2] - V[2];
      const r = Math.hypot(rx, ry, rz), e = 0.5 * (ux * ux + uy * uy + uz * uz) - Mp / Math.max(r, 1e-9);
      let k;
      if (r < Rp) k = 0;
      else if (e >= 0) k = 2;
      else {
        const hx = ry * uz - rz * uy, hy = rz * ux - rx * uz, hz = rx * uy - ry * ux, h2 = hx * hx + hy * hy + hz * hz;
        const a = -Mp / (2 * e), ecc = Math.sqrt(Math.max(0, 1 + 2 * e * h2 / (Mp * Mp)));
        k = a * (1 - ecc) > Rp ? 1 : 0;
      }
      cls[i] = k; mem[i] = k === 0 ? 1 : 0;
      if (k === 0) { M2 += m[i]; for (let c = 0; c < 3; c++) { X2[c] += m[i] * x[3 * i + c]; V2[c] += m[i] * v[3 * i + c]; } }
    }
    if (!(M2 > 0)) break;
    Mp = M2; X = X2.map(s => s / M2); V = V2.map(s => s / M2); Rp = Math.cbrt(Mp / rhoK);
  }
  let Md = 0, Me = 0, nP = 0, nD = 0, nE = 0;
  for (let i = 0; i < n; i++) {
    if (cls[i] === 1) { Md += m[i]; nD++; } else if (cls[i] === 2) { Me += m[i]; nE++; } else nP++;
  }
  const T = new Float32Array(n);
  if (rb.aux) for (let i = 0; i < n; i++) T[i] = rb.aux[4 * i];
  return { Mtot, Mp, Md, Me, Rp, X, V, T99: rb.aux ? percentile(T, n, 0.99) : 0, nP, nD, nE };
}
