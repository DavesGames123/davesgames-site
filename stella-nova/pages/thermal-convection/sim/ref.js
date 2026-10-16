// THERMAL CONVECTION · sim/ref.js — the CPU reference of the 3D Boussinesq
// solver. No DOM. It is the spec of the numerics: shaders/sim-*.wgsl run the
// same scheme in the same order, pass for pass.
//
// Equations (free-fall units, CONTRACT.md "Physics"):
//   du/dt + (u . grad) u = - grad p + nu lap u + T z_hat,  nu = sqrt(Pr / Ra)
//   div u = 0
//   dT/dt + u . grad T   = kappa lap T,                    kappa = 1 / sqrt(Ra Pr)
//
// Grid. x in [0, Lx), y in [0, Ly) periodic; z in [0, 1]; dx = dy = dz = 1 / nz,
// so Lx = nx / nz. Cell index c = i + nx * (j + ny * k), k = 0 at the bottom.
// Staggered (MAC) velocity:
//   U[c] at x = i dx,         y = (j + .5) dx,  z = (k + .5) dx   (x face)
//   V[c] at x = (i + .5) dx,  y = j dx,         z = (k + .5) dx   (y face)
//   W[c] at x = (i + .5) dx,  y = (j + .5) dx,  z = k dx          (z face, W = 0 at k = 0 and k = nz)
//   T[c] at the cell centre.  vel[4c..] = cell-centred (u, v, w, 0), the mean of the two faces.
//
// One step of dt (ref.step) does these passes. The WGSL kernel of each pass is named.
//   1 advA  (sim-advect.wgsl)  MacCormack forward: hat = SL(phi), for U, V, W, T.
//           SL = semi-Lagrangian. The departure point is an RK2 trace in the
//           cell-centred vel field; the field is sampled trilinearly with the
//           boundary ghosts of fetch() below.
//   2 advB  (sim-advect.wgsl)  MacCormack back trace and correction:
//           phi* = hat + (phi - SL_back(hat)) / 2, clamped to the min / max of
//           the 8 cells around the forward departure point (Selle et al. 2008).
//           Then the explicit sources go into the right side:
//             U,V += dt nu s / dz in the top cell, pan mode only  Marangoni:
//                    s = du/dz = -Ma_eff dT_s/dx, Ma_eff = Ma / sqrt(Ra Pr)
//             T   += 2 dt kappa T_bottom / dz^2 in the bottom cell (Dirichlet)
//             T   += -dt kappa g h / dz^2 in the top cell (Robin top)
//             T   += dt / tau in the sun heating zone (heat bath, see below)
//   3 fwdX, fwdY (sim-fft.wgsl)  real-to-half-complex FFT along x (nx / 2 + 1
//           modes), complex FFT along y. Mixed-radix Stockham (radix 4, 2, 3).
//   4 tri   (sim-tri.wgsl)  one thread per (mx, my) mode column. In Fourier
//           space the xy Laplacian is the number lam = -4 (sin^2(pi mx / nx) +
//           sin^2(pi my / ny)) / dx^2 and z stays tridiagonal, so each solve is
//           exact (Thomas algorithm):
//             a. implicit diffusion (backward Euler) (1 - dt D L) phi = phi*
//                for U, V (nu) and T (kappa); then W* += dt T_new at the
//                face (buoyancy, semi-implicit: it uses the T just solved);
//                then W (nu, faces 1..nz-1)
//             b. incremental projection: before a., u* -= dt grad p_old;
//                after a., div in Fourier space, solve L phi = div with
//                Neumann ends, u -= grad phi, p += phi / dt. p stays in
//                Fourier space between steps (its own buffer), so the steady
//                state of the split scheme is the steady state of the PDE
//                (no O(dt) shift of the onset Ra).
//                Mode (0, 0): W = 0 (mass), and U = V = 0 in every layer: no
//                mean horizontal wind. Without this rule the semi-Lagrangian
//                momentum error fed a wall jet that blew up at Ra 1e7
//                (no pressure acts on that mode, and the viscosity is small).
//           The discrete div of the result is zero to round-off.
//   5 invY, invX (sim-fft.wgsl)  inverse FFTs back to U, V, W, T (scale 1 / (nx ny)).
//   6 tracers (sim-misc.wgsl)   RK2 in vel (the vel of the step start), age += dt,
//           respawn at a hashed random point when age > life or z leaves [0, 1].
//   7 vel   (sim-misc.wgsl)     cell-centred vel from U, V, W.
// Implicit diffusion has no step limit; the step is set by CFL (params.js).
//
// Boundary conditions (ghost values, used by the advection samples and by the
// tridiagonal rows; e is the ghost coefficient: ghost = e * phi_edge + data):
//   U, V bottom no-slip           ghost = -phi                  e = -1
//   U, V top rigid / free         ghost = -phi / +phi           e = -1 / +1
//        (pan mode is always free, with the Marangoni stress as data)
//   W    faces 0 and nz           W = 0 (Dirichlet on the face)
//   T    bottom Dirichlet Tb      ghost = 2 Tb - T              e = -1
//   T    bottom insulating (sun)  ghost = T                     e = +1
//   T    top Dirichlet 0          ghost = -T          (plate, burner)
//   T    top Robin  dT/dz = -B T_s - h on the surface value T_s = (T + ghost) / 2
//        ghost = r T - g h, a = B dz / 2, r = (1 - a) / (1 + a), g = dz / (1 + a),
//        e = r                                                     (sun, pan)
//        pan: B = 0.3 cool (Biot), h = 1, so the conduction state is 1 - z.
//        sun: B = 5 cool, h = 0: the surface loses heat in proportion to its
//             temperature. This is the radiative T^4 flux linearized with a
//             constant coefficient, so the implicit row stays exact. A true
//             T^4 row needs a large constant B for stability and then
//             overshot to T < 0 in the top cells (tested, dropped).
//   T    sun heating: Q = (1 - T) / tau, tau = 1, in the bottom zh = 0.25 of
//        the layer (a heat bath; the -T / tau part is implicit in tri), over
//        an insulating bottom wall.
//   p    Neumann at both walls.
//   Why sun mode heats a bottom zone and not the wall: with a hot wall the
//   Boussinesq layer is up-down symmetric (as wide hot plumes as cold ones).
//   With the heat made in the volume there is no hot boundary layer, and
//   the cold top boundary layer sinks in narrow lanes between broad warm
//   upflows, as in solar granulation (measured on 48 x 48 x 16 at Ra 1e6:
//   46 % of the cells at z = 0.8 sink, and faster than the rising ones;
//   plate mode gives 51 %). Nu for sun mode is the heat taken in
//   by the zone over the heat it takes in the conduction state (the bottom
//   wall flux is zero there); the other modes use the bottom wall flux.
//   Burner Tb(x, y) = 0.1 + 0.6 power exp(-rho^2 / r^2), rho the periodic
//   distance from the burner centre; Tb = 1 in the other modes.
//
// Listing (grep -n "^export" sim/ref.js):
//   createRefSim(opts, params) -> ref     the CPU solver
//   derived(P, dims)           -> {...}   coefficients shared with gpu.js
//   bottomT(D, x, y)                      Tb at a point (box units)
//   initialState(dims, P, seed)           {U, V, W, T} start state (gpu.js uploads it)
//   initTracers(count, dims, seed)        Float32Array(4 count)
//   radices(N), fftLine(...)              the Stockham FFT
//   mulberry32(seed), pcg(v), u01(h)      RNGs (pcg, u01 match the WGSL ones)
//   PAN_BI, SUN_ZH, SUN_TAU, SUN_BI       boundary constants
import { clampParams, planFrame, TRACER_LIFE } from './params.js';

export const PAN_BI = 0.3;
export const SUN_ZH = 0.25;
export const SUN_TAU = 1;
export const SUN_BI = 5;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pcg(v) {
  const s = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}

// [0, 1) from a hash, exact in f32 (WGSL u01 is the same).
export const u01 = h => (h >>> 8) / 16777216;

export function radices(N) {
  const r = [];
  let n = N;
  while (n % 4 === 0) { r.push(4); n /= 4; }
  while (n % 2 === 0) { r.push(2); n /= 2; }
  while (n % 3 === 0) { r.push(3); n /= 3; }
  if (n !== 1) throw new Error(`grid size ${N} must factor into 2 and 3`);
  return r;
}

// Forward DFT X[m] = sum x[i] e^(-2 pi i m i / N), Stockham autosort.
// Stage with radix r, p = product of the earlier radices, thread i < N / r:
//   k = i % p, a_q = x[i + q N / r] * w^(q k), w = e^(-2 pi i / (p r)),
//   b = DFT_r(a), y[(i - k) r + k + q p] = b_q.
// Returns the pair of arrays that holds the result (input or scratch).
export function fftLine(re, im, sre, sim, N, rads) {
  let xr = re, xi = im, yr = sre, yi = sim, p = 1;
  const S3 = -0.8660254037844386;
  for (let s = 0; s < rads.length; s++) {
    const r = rads[s], m = N / r;
    for (let i = 0; i < m; i++) {
      const k = i % p;
      const ang = (-2 * Math.PI * k) / (p * r);
      const w1r = Math.cos(ang), w1i = Math.sin(ang);
      const j = (i - k) * r + k;
      const a0r = xr[i], a0i = xi[i];
      let a1r = xr[i + m], a1i = xi[i + m];
      let t = a1r * w1r - a1i * w1i; a1i = a1r * w1i + a1i * w1r; a1r = t;
      if (r === 2) {
        yr[j] = a0r + a1r; yi[j] = a0i + a1i;
        yr[j + p] = a0r - a1r; yi[j + p] = a0i - a1i;
      } else if (r === 3) {
        const w2r = w1r * w1r - w1i * w1i, w2i = 2 * w1r * w1i;
        let a2r = xr[i + 2 * m], a2i = xi[i + 2 * m];
        t = a2r * w2r - a2i * w2i; a2i = a2r * w2i + a2i * w2r; a2r = t;
        const t1r = a1r + a2r, t1i = a1i + a2i;
        const t2r = a0r - 0.5 * t1r, t2i = a0i - 0.5 * t1i;
        const t3r = S3 * (a1r - a2r), t3i = S3 * (a1i - a2i);
        yr[j] = a0r + t1r; yi[j] = a0i + t1i;
        yr[j + p] = t2r - t3i; yi[j + p] = t2i + t3r;         // t2 + i t3
        yr[j + 2 * p] = t2r + t3i; yi[j + 2 * p] = t2i - t3r; // t2 - i t3
      } else {
        const w2r = w1r * w1r - w1i * w1i, w2i = 2 * w1r * w1i;
        const w3r = w2r * w1r - w2i * w1i, w3i = w2r * w1i + w2i * w1r;
        let a2r = xr[i + 2 * m], a2i = xi[i + 2 * m];
        t = a2r * w2r - a2i * w2i; a2i = a2r * w2i + a2i * w2r; a2r = t;
        let a3r = xr[i + 3 * m], a3i = xi[i + 3 * m];
        t = a3r * w3r - a3i * w3i; a3i = a3r * w3i + a3i * w3r; a3r = t;
        const s02r = a0r + a2r, s02i = a0i + a2i, d02r = a0r - a2r, d02i = a0i - a2i;
        const s13r = a1r + a3r, s13i = a1i + a3i, d13r = a1r - a3r, d13i = a1i - a3i;
        yr[j] = s02r + s13r; yi[j] = s02i + s13i;
        yr[j + p] = d02r + d13i; yi[j + p] = d02i - d13r;         // d02 - i d13
        yr[j + 2 * p] = s02r - s13r; yi[j + 2 * p] = s02i - s13i;
        yr[j + 3 * p] = d02r - d13i; yi[j + 3 * p] = d02i + d13r; // d02 + i d13
      }
    }
    [xr, yr] = [yr, xr]; [xi, yi] = [yi, xi];
    p *= r;
  }
  return [xr, xi];
}

// Coefficients that both solvers use. gpu.js packs these into the uniform.
export function derived(Pin, dims) {
  const P = clampParams(Pin);
  const { nx, ny, nz } = dims;
  const dz = 1 / nz, Lx = nx * dz, Ly = ny * dz;
  const pan = P.mode === 'pan', sun = P.mode === 'sun', burner = P.mode === 'burner';
  const nu = Math.sqrt(P.Pr / P.Ra), kappa = 1 / Math.sqrt(P.Ra * P.Pr);
  const D = {
    P, nx, ny, nz, dz, Lx, Ly, nu, kappa,
    mode: ['plate', 'burner', 'sun', 'pan'].indexOf(P.mode),
    topFree: pan || P.top === 'free',
    tRobin: pan || sun,
    maEff: pan ? P.Ma / Math.sqrt(P.Ra * P.Pr) : 0,
    B: 0, hConst: 0, rTop: -1, gTop: 0,
    botNeumann: false, nHeat: 0, relax: 0, heatCond: 1, Tcond: null,
    bx: P.burner.x * Lx, by: P.burner.y * Ly, br: P.burner.r * Math.min(Lx, Ly), bpow: P.burner.power,
    fluxRef: 1,
  };
  if (pan) { D.B = PAN_BI * P.cool; D.hConst = 1; }
  if (sun) {
    D.B = SUN_BI * P.cool; D.hConst = 0;
    D.botNeumann = true;
    D.nHeat = Math.max(1, Math.round(nz * SUN_ZH));
    D.relax = 1 / SUN_TAU; // heat bath: Q = (1 - T) / tau in the zone
  }
  if (D.tRobin) { // Robin on the surface value T_s = (T + ghost) / 2
    const a = (D.B * dz) / 2;
    D.rTop = (1 - a) / (1 + a); D.gTop = dz / (1 + a);
  }
  if (burner) {
    let s = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) s += bottomT(D, (i + 0.5) * dz, (j + 0.5) * dz);
    D.fluxRef = s / (nx * ny);
  }
  if (sun) {
    // Discrete conduction state: the steady 1D form of the same rows.
    const Tc = new Float64Array(nz), cpv = new Float64Array(nz), dv = new Float64Array(nz);
    const c = kappa / (dz * dz);
    {
      const h = D.hConst;
      let prev = 0, dprev = 0;
      for (let k = 0; k < nz; k++) {
        const e = (k === 0 ? 1 : 0) + (k === nz - 1 ? D.rTop : 0);
        const q = k < D.nHeat ? D.relax : 0;
        let rhs = q;
        if (k === nz - 1) rhs += (-kappa * h * D.gTop) / (dz * dz);
        const den = c * (2 - e) + q + c * prev;
        cpv[k] = -c / den; dv[k] = (rhs + c * dprev) / den;
        prev = cpv[k]; dprev = dv[k];
      }
      Tc[nz - 1] = dv[nz - 1];
      for (let k = nz - 2; k >= 0; k--) Tc[k] = dv[k] - cpv[k] * Tc[k + 1];
    }
    let hin = 0;
    for (let k = 0; k < D.nHeat; k++) hin += 1 - Tc[k];
    D.Tcond = Tc; D.heatCond = hin; D.fluxRef = 1;
  }
  return D;
}

function bisect(f, a, b) {
  let fa = f(a);
  for (let it = 0; it < 80; it++) {
    const m = 0.5 * (a + b), fm = f(m);
    if ((fm > 0) === (fa > 0)) { a = m; fa = fm; } else b = m;
  }
  return 0.5 * (a + b);
}

export function bottomT(D, x, y) {
  if (D.mode !== 1) return 1;
  let ddx = x - D.bx; ddx -= D.Lx * Math.round(ddx / D.Lx);
  let ddy = y - D.by; ddy -= D.Ly * Math.round(ddy / D.Ly);
  return 0.1 + 0.6 * D.bpow * Math.exp(-(ddx * ddx + ddy * ddy) / (D.br * D.br));
}

// Ghost temperature above the top cell (value Tc).
function topGhostT(D, Tc) {
  return D.tRobin ? D.rTop * Tc - D.gTop * D.hConst : -Tc;
}

export function initialState(dims, Pin, seed) {
  const D = derived(Pin, dims);
  const { nx, ny, nz, dz } = D, n = nx * ny * nz;
  const U = new Float32Array(n), V = new Float32Array(n), W = new Float32Array(n), T = new Float32Array(n);
  const rnd = mulberry32(seed);
  const amp = D.P.noise;
  for (let k = 0; k < nz; k++) {
    const z = (k + 0.5) * dz;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      let T0;
      if (D.mode === 1) T0 = bottomT(D, (i + 0.5) * dz, (j + 0.5) * dz) * (1 - z);
      else if (D.mode === 2) T0 = D.Tcond[k];
      else T0 = 1 - z;
      T[i + nx * (j + ny * k)] = T0 + amp * (2 * rnd() - 1) * Math.sin(Math.PI * z);
    }
  }
  return { U, V, W, T };
}

export function initTracers(count, dims, seed) {
  const { nx, ny, nz } = dims, Lx = nx / nz, Ly = ny / nz;
  const out = new Float32Array(4 * count);
  const rnd = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  for (let t = 0; t < count; t++) {
    out[4 * t] = rnd() * Lx; out[4 * t + 1] = rnd() * Ly; out[4 * t + 2] = rnd();
    out[4 * t + 3] = rnd() * TRACER_LIFE * 0.6;
  }
  return out;
}

export function createRefSim(opts = {}, params = {}) {
  const nx = opts.nx | 0, ny = opts.ny | 0, nz = opts.nz | 0;
  if (nx < 4 || ny < 4 || nz < 2 || nx % 2) throw new Error('bad grid');
  if (nz > 64) throw new Error('nz > 64 is not supported (tri kernel arrays)');
  const dims = { nx, ny, nz };
  const n = nx * ny * nz, nxy = nx * ny, nh = nx / 2 + 1, S = nh * ny * nz;
  const dz = 1 / nz, dx = dz, dz2 = dz * dz;
  const radX = radices(nx), radY = radices(ny);
  let seed = (opts.seed ?? 1) >>> 0;
  let D = derived(params, dims);
  let P = D.P;

  const U = new Float32Array(n), V = new Float32Array(n), W = new Float32Array(n), T = new Float32Array(n);
  const F = [U, V, W, T];
  const hat = [0, 1, 2, 3].map(() => new Float32Array(n));
  const rhs = [0, 1, 2, 3].map(() => new Float32Array(n));
  const vel = new Float32Array(4 * n);
  const Tb = new Float64Array(nxy);
  const sr = new Float64Array(4 * S), si = new Float64Array(4 * S);
  const psr = new Float64Array(S), psi = new Float64Array(S); // pressure, Fourier space
  const NM = Math.max(nx, ny);
  const lr = new Float64Array(NM), li = new Float64Array(NM), tr = new Float64Array(NM), ti = new Float64Array(NM);
  let tracers = new Float32Array(0), tracerCount = 0, stepCount = 0;

  const refreshTb = () => {
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) Tb[i + nx * j] = bottomT(D, (i + 0.5) * dx, (j + 0.5) * dx);
  };
  refreshTb();

  const OX = [0, 0.5, 0.5, 0.5], OY = [0.5, 0, 0.5, 0.5], OZ = [0.5, 0.5, 0, 0.5];
  const wrap = (a, m) => ((a % m) + m) % m;

  // Value of field f (array A) at integer cell (i, j wrapped; k may be -1 or nz).
  function fetch(f, A, i, j, k) {
    if (f === 2) return k <= 0 || k >= nz ? 0 : A[i + nx * (j + ny * k)];
    if (k < 0) {
      const v = A[i + nx * j];
      if (f === 3) return D.botNeumann ? v : 2 * Tb[i + nx * j] - v;
      return -v;
    }
    if (k >= nz) {
      const v = A[i + nx * (j + ny * (nz - 1))];
      if (f === 3) return topGhostT(D, v);
      return D.topFree ? v : -v;
    }
    return A[i + nx * (j + ny * k)];
  }
  // Trilinear sample of field f at p; mm[0], mm[1] get the corner min / max.
  function sample(f, A, px, py, pz, mm) {
    const gx = px / dx - OX[f], gy = py / dx - OY[f], gz = pz / dx - OZ[f];
    const fx0 = Math.floor(gx), fy0 = Math.floor(gy), fz0 = Math.floor(gz);
    const fx = gx - fx0, fy = gy - fy0, fz = gz - fz0;
    const i0 = wrap(fx0, nx), i1 = i0 + 1 === nx ? 0 : i0 + 1;
    const j0 = wrap(fy0, ny), j1 = j0 + 1 === ny ? 0 : j0 + 1;
    const k0 = fz0, k1 = fz0 + 1;
    const c000 = fetch(f, A, i0, j0, k0), c100 = fetch(f, A, i1, j0, k0);
    const c010 = fetch(f, A, i0, j1, k0), c110 = fetch(f, A, i1, j1, k0);
    const c001 = fetch(f, A, i0, j0, k1), c101 = fetch(f, A, i1, j0, k1);
    const c011 = fetch(f, A, i0, j1, k1), c111 = fetch(f, A, i1, j1, k1);
    if (mm) {
      mm[0] = Math.min(c000, c100, c010, c110, c001, c101, c011, c111);
      mm[1] = Math.max(c000, c100, c010, c110, c001, c101, c011, c111);
    }
    const a0 = c000 + fx * (c100 - c000), a1 = c010 + fx * (c110 - c010);
    const b0 = c001 + fx * (c101 - c001), b1 = c011 + fx * (c111 - c011);
    const z0 = a0 + fy * (a1 - a0), z1 = b0 + fy * (b1 - b0);
    return z0 + fz * (z1 - z0);
  }
  // Cell-centred velocity at p (z clamped to the centre range).
  const vo = new Float64Array(3);
  function velAt(px, py, pz) {
    const gx = px / dx - 0.5, gy = py / dx - 0.5;
    let gz = pz / dx - 0.5;
    if (gz < 0) gz = 0; else if (gz > nz - 1) gz = nz - 1;
    const fx0 = Math.floor(gx), fy0 = Math.floor(gy);
    let k0 = Math.floor(gz); if (k0 > nz - 2) k0 = nz - 2;
    const fx = gx - fx0, fy = gy - fy0, fz = gz - k0;
    const i0 = wrap(fx0, nx), i1 = i0 + 1 === nx ? 0 : i0 + 1;
    const j0 = wrap(fy0, ny), j1 = j0 + 1 === ny ? 0 : j0 + 1;
    const b = nx * ny * k0, up = nxy;
    const w000 = (1 - fx) * (1 - fy) * (1 - fz), w100 = fx * (1 - fy) * (1 - fz);
    const w010 = (1 - fx) * fy * (1 - fz), w110 = fx * fy * (1 - fz);
    const w001 = (1 - fx) * (1 - fy) * fz, w101 = fx * (1 - fy) * fz;
    const w011 = (1 - fx) * fy * fz, w111 = fx * fy * fz;
    const c000 = 4 * (i0 + nx * j0 + b), c100 = 4 * (i1 + nx * j0 + b);
    const c010 = 4 * (i0 + nx * j1 + b), c110 = 4 * (i1 + nx * j1 + b);
    const c001 = c000 + 4 * up, c101 = c100 + 4 * up, c011 = c010 + 4 * up, c111 = c110 + 4 * up;
    for (let q = 0; q < 3; q++) {
      vo[q] = w000 * vel[c000 + q] + w100 * vel[c100 + q] + w010 * vel[c010 + q] + w110 * vel[c110 + q]
        + w001 * vel[c001 + q] + w101 * vel[c101 + q] + w011 * vel[c011 + q] + w111 * vel[c111 + q];
    }
    return vo;
  }
  // RK2 trace from p over s * dt (s = -1 back, +1 forward); z clamped to [0, 1].
  const tp = new Float64Array(3);
  function trace(px, py, pz, h) {
    let v = velAt(px, py, pz);
    const mx = px + 0.5 * h * v[0], my = py + 0.5 * h * v[1], mz = pz + 0.5 * h * v[2];
    v = velAt(mx, my, mz);
    tp[0] = px + h * v[0]; tp[1] = py + h * v[1];
    const z = pz + h * v[2];
    tp[2] = z < 0 ? 0 : z > 1 ? 1 : z;
    return tp;
  }

  function computeVel() {
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = i + nx * (j + ny * k);
      const ci = (i + 1 === nx ? 0 : i + 1) + nx * (j + ny * k);
      const cj = i + nx * ((j + 1 === ny ? 0 : j + 1) + ny * k);
      const wUp = k + 1 < nz ? W[c + nxy] : 0;
      vel[4 * c] = 0.5 * (U[c] + U[ci]);
      vel[4 * c + 1] = 0.5 * (V[c] + V[cj]);
      vel[4 * c + 2] = 0.5 * (W[c] + wUp);
      vel[4 * c + 3] = 0;
    }
  }

  const mm = new Float64Array(2);
  function advect(dt) {
    // pass 1 (advA)
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = i + nx * (j + ny * k);
      for (let f = 0; f < 4; f++) {
        if (f === 2 && k === 0) { hat[2][c] = 0; continue; }
        const p = trace((i + OX[f]) * dx, (j + OY[f]) * dx, (k + OZ[f]) * dx, -dt);
        hat[f][c] = sample(f, F[f], p[0], p[1], p[2], null);
      }
    }
    // pass 2 (advB)
    const cnu = dt * D.nu, ckap = dt * D.kappa;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = i + nx * (j + ny * k);
      for (let f = 0; f < 4; f++) {
        if (f === 2 && k === 0) { rhs[2][c] = 0; continue; }
        const px = (i + OX[f]) * dx, py = (j + OY[f]) * dx, pz = (k + OZ[f]) * dx;
        const pb = trace(px, py, pz, -dt);
        sample(f, F[f], pb[0], pb[1], pb[2], mm);
        const lo = mm[0], hi = mm[1];
        const pf = trace(px, py, pz, dt);
        const back = sample(f, hat[f], pf[0], pf[1], pf[2], null);
        let v = hat[f][c] + 0.5 * (F[f][c] - back);
        if (v < lo) v = lo; else if (v > hi) v = hi;
        // explicit sources
        if (f < 2 && D.maEff !== 0 && k === nz - 1) {
          const cm = f === 0 ? (i === 0 ? nx - 1 : i - 1) + nx * (j + ny * k)
            : i + nx * ((j === 0 ? ny - 1 : j - 1) + ny * k);
          const ts = 0.5 * (T[c] + topGhostT(D, T[c])), tsm = 0.5 * (T[cm] + topGhostT(D, T[cm]));
          const s = -D.maEff * (ts - tsm) / dx;
          v += (cnu * s) / dz;
        }
        if (f === 3) {
          if (k === 0 && !D.botNeumann) v += (2 * ckap * Tb[i + nx * j]) / dz2;
          if (k < D.nHeat) v += dt * D.relax; // heat bath; its -T / tau part is implicit in tri
          if (k === nz - 1 && D.tRobin) v += (-ckap * D.hConst * D.gTop) / dz2;
        }
        rhs[f][c] = v;
      }
    }
  }

  // Spectral layout: field f, mode (mx, my), layer k at f * S + mx + nh * (my + ny * k).
  function fwdX() {
    for (let f = 0; f < 4; f++) for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
      const row = nx * (j + ny * k), srow = f * S + nh * (j + ny * k), A = rhs[f];
      for (let i = 0; i < nx; i++) { lr[i] = A[row + i]; li[i] = 0; }
      const [or, oi] = fftLine(lr, li, tr, ti, nx, radX);
      for (let m = 0; m < nh; m++) { sr[srow + m] = or[m]; si[srow + m] = oi[m]; }
    }
  }
  function lineY(conj) {
    const sg = conj ? -1 : 1;
    for (let f = 0; f < 4; f++) for (let k = 0; k < nz; k++) for (let m = 0; m < nh; m++) {
      const b = f * S + m + nh * ny * k;
      for (let q = 0; q < ny; q++) { lr[q] = sr[b + nh * q]; li[q] = sg * si[b + nh * q]; }
      const [or, oi] = fftLine(lr, li, tr, ti, ny, radY);
      for (let q = 0; q < ny; q++) { sr[b + nh * q] = or[q]; si[b + nh * q] = sg * oi[q]; }
    }
  }
  function invX() {
    const sc = 1 / (nx * ny);
    for (let f = 0; f < 4; f++) for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
      const row = nx * (j + ny * k), srow = f * S + nh * (j + ny * k), A = F[f];
      for (let m = 0; m < nx; m++) {
        if (m < nh) { lr[m] = sr[srow + m]; li[m] = -si[srow + m]; } else { lr[m] = sr[srow + nx - m]; li[m] = si[srow + nx - m]; }
      }
      const [or] = fftLine(lr, li, tr, ti, nx, radX);
      const zero = f === 2 && k === 0;
      for (let i = 0; i < nx; i++) A[row + i] = zero ? 0 : or[i] * sc;
    }
  }

  // Thomas on rows k = k0..k1 of field f at mode base b; diag(k), off constant.
  const cp = new Float64Array(64), pr = new Float64Array(64), pi = new Float64Array(64);
  function thomas(fs, b, st, k0, k1, diag, off) {
    let prev = 0;
    for (let k = k0; k <= k1; k++) {
      const den = diag(k) - off * prev;
      const c = off / den;
      for (const f of fs) {
        const ix = f * S + b + st * k, ip = ix - st;
        const dpr = k === k0 ? 0 : sr[ip], dpi = k === k0 ? 0 : si[ip];
        sr[ix] = (sr[ix] - off * dpr) / den; si[ix] = (si[ix] - off * dpi) / den;
      }
      cp[k] = c; prev = c;
    }
    for (let k = k1 - 1; k >= k0; k--) {
      for (const f of fs) {
        const ix = f * S + b + st * k, iu = ix + st;
        sr[ix] -= cp[k] * sr[iu]; si[ix] -= cp[k] * si[iu];
      }
    }
  }
  function tri(dt) {
    const st = nh * ny;
    const cv = (dt * D.nu) / dz2, ck = (dt * D.kappa) / dz2;
    const eTopU = D.topFree ? 1 : -1, eTopT = D.tRobin ? D.rTop : -1, eBotT = D.botNeumann ? 1 : -1;
    for (let my = 0; my < ny; my++) for (let mx = 0; mx < nh; mx++) {
      const b = mx + nh * my;
      const sx = Math.sin((Math.PI * mx) / nx), sy = Math.sin((Math.PI * my) / ny);
      const lam = (-4 * (sx * sx + sy * sy)) / dz2;
      const thx = (2 * Math.PI * mx) / nx, thy = (2 * Math.PI * my) / ny;
      // gradient factors g = (1 - e^(-i th)) / dx = (1 - cos th + i sin th) / dx
      const gxr = (1 - Math.cos(thx)) / dx, gxi = Math.sin(thx) / dx;
      const gyr = (1 - Math.cos(thy)) / dx, gyi = Math.sin(thy) / dx;
      const zero = mx === 0 && my === 0;
      // incremental pressure: u* -= dt grad p_old (p kept in Fourier space)
      if (!zero) {
        for (let k = 0; k < nz; k++) {
          const iu = b + st * k, iv = S + iu, iw = 2 * S + iu, ip = b + st * k;
          const qr = dt * psr[ip], qi = dt * psi[ip];
          sr[iu] -= gxr * qr - gxi * qi; si[iu] -= gxr * qi + gxi * qr;
          sr[iv] -= gyr * qr - gyi * qi; si[iv] -= gyr * qi + gyi * qr;
          if (k > 0) { sr[iw] -= (qr - dt * psr[ip - st]) / dz; si[iw] -= (qi - dt * psi[ip - st]) / dz; }
        }
      }
      const eU = k => (k === 0 ? -1 : 0) + (k === nz - 1 ? eTopU : 0);
      thomas([0, 1], b, st, 0, nz - 1, k => 1 - dt * D.nu * lam + cv * (2 - eU(k)), -cv);
      const eT = k => (k === 0 ? eBotT : 0) + (k === nz - 1 ? eTopT : 0);
      const rl = dt * D.relax;
      thomas([3], b, st, 0, nz - 1, k => 1 - dt * D.kappa * lam + ck * (2 - eT(k)) + (k < D.nHeat ? rl : 0), -ck);
      // buoyancy from the new T (semi-implicit), then the W solve
      sr[2 * S + b] = 0; si[2 * S + b] = 0;
      for (let k = 1; k < nz; k++) {
        const iw = 2 * S + b + st * k, it = 3 * S + b + st * k;
        sr[iw] += 0.5 * dt * (sr[it] + sr[it - st]); si[iw] += 0.5 * dt * (si[it] + si[it - st]);
      }
      thomas([2], b, st, 1, nz - 1, () => 1 - dt * D.nu * lam + 2 * cv, -cv);
      // projection
      if (zero) { // no mean vertical flow, no mean horizontal wind (see the header)
        for (let k = 0; k < nz; k++) {
          const i0 = b + st * k;
          sr[i0] = si[i0] = sr[S + i0] = si[S + i0] = sr[2 * S + i0] = si[2 * S + i0] = 0;
        }
        continue;
      }
      const axr = (Math.cos(thx) - 1) / dx, axi = Math.sin(thx) / dx;
      const ayr = (Math.cos(thy) - 1) / dx, ayi = Math.sin(thy) / dx;
      // forward sweep of (lam + Lz) phi = div, Neumann ends (e = +1), into pr/pi
      let prev = 0;
      const off = 1 / dz2;
      for (let k = 0; k < nz; k++) {
        const iu = b + st * k, iv = S + iu, iw = 2 * S + iu;
        const wUr = k + 1 < nz ? sr[iw + st] : 0, wUi = k + 1 < nz ? si[iw + st] : 0;
        const dvr = axr * sr[iu] - axi * si[iu] + ayr * sr[iv] - ayi * si[iv] + (wUr - sr[iw]) / dz;
        const dvi = axr * si[iu] + axi * sr[iu] + ayr * si[iv] + ayi * sr[iv] + (wUi - si[iw]) / dz;
        const e = (k === 0 ? 1 : 0) + (k === nz - 1 ? 1 : 0);
        const den = lam + (e - 2) / dz2 - off * prev;
        const c = off / den;
        pr[k] = (dvr - off * (k ? pr[k - 1] : 0)) / den;
        pi[k] = (dvi - off * (k ? pi[k - 1] : 0)) / den;
        cp[k] = c; prev = c;
      }
      for (let k = nz - 2; k >= 0; k--) { pr[k] -= cp[k] * pr[k + 1]; pi[k] -= cp[k] * pi[k + 1]; }
      // subtract grad phi; the pressure takes the increment p += phi / dt
      for (let k = 0; k < nz; k++) {
        psr[b + st * k] += pr[k] / dt; psi[b + st * k] += pi[k] / dt;
        const iu = b + st * k, iv = S + iu, iw = 2 * S + iu;
        sr[iu] -= gxr * pr[k] - gxi * pi[k]; si[iu] -= gxr * pi[k] + gxi * pr[k];
        sr[iv] -= gyr * pr[k] - gyi * pi[k]; si[iv] -= gyr * pi[k] + gyi * pr[k];
        if (k > 0) { sr[iw] -= (pr[k] - pr[k - 1]) / dz; si[iw] -= (pi[k] - pi[k - 1]) / dz; }
      }
    }
  }

  function tracerStep(dt) {
    const Lx = D.Lx, Ly = D.Ly;
    for (let t = 0; t < tracerCount; t++) {
      const o = 4 * t;
      const v1 = velAt(tracers[o], tracers[o + 1], tracers[o + 2]);
      const mx = tracers[o] + 0.5 * dt * v1[0], my = tracers[o + 1] + 0.5 * dt * v1[1], mz = tracers[o + 2] + 0.5 * dt * v1[2];
      const v2 = velAt(mx, my, mz);
      let x = tracers[o] + dt * v2[0], y = tracers[o + 1] + dt * v2[1];
      const z = tracers[o + 2] + dt * v2[2], age = tracers[o + 3] + dt;
      x -= Lx * Math.floor(x / Lx); y -= Ly * Math.floor(y / Ly);
      const life = TRACER_LIFE * (0.6 + 0.4 * u01(pcg((t ^ seed) >>> 0)));
      if (z < 0 || z > 1 || age > life) {
        let h = pcg((t + pcg((stepCount ^ seed) >>> 0)) >>> 0);
        tracers[o] = u01(h) * Lx; h = pcg(h);
        tracers[o + 1] = u01(h) * Ly; h = pcg(h);
        tracers[o + 2] = u01(h); tracers[o + 3] = 0;
      } else {
        tracers[o] = x; tracers[o + 1] = y; tracers[o + 2] = z; tracers[o + 3] = age;
      }
    }
  }

  const ref = {
    dims: { nx, ny, nz, Lx: D.Lx, Ly: D.Ly, dx },
    T, vel, U, V, W,
    get time() { return ref.simTime; },
    simTime: 0,
    get params() { return P; },
    get derived() { return D; },
    get tracers() { return tracers.subarray(0, 4 * tracerCount); },
    get tracerCount() { return tracerCount; },
    set(p) {
      const b = Object.assign({}, P.burner, (p && p.burner) || {});
      D = derived(Object.assign({}, P, p, { burner: b }), dims); P = D.P; refreshTb();
    },
    reset(s = seed) {
      seed = s >>> 0;
      const st = initialState(dims, P, seed);
      U.set(st.U); V.set(st.V); W.set(st.W); T.set(st.T);
      psr.fill(0); psi.fill(0);
      computeVel(); ref.simTime = 0; stepCount = 0;
      if (tracerCount) tracers = initTracers(tracerCount, dims, seed);
    },
    // Replace the state (any of U, V, W, T), clear the pressure, refresh vel.
    load(st) {
      if (st.U) U.set(st.U); if (st.V) V.set(st.V); if (st.W) W.set(st.W); if (st.T) T.set(st.T);
      psr.fill(0); psi.fill(0); computeVel();
    },
    setTracers(count) { tracerCount = Math.max(0, count | 0); tracers = initTracers(tracerCount, dims, seed); },
    step(dt) {
      advect(dt);
      fwdX(); lineY(false); tri(dt); lineY(true); invX();
      if (tracerCount) tracerStep(dt);
      computeVel();
      ref.simTime += dt; stepCount++;
    },
    // Mirror of gpu.js sim.step for one display frame (vmax is exact here).
    frame(frameDt, maxSub = 3) {
      const plan = planFrame(frameDt, P.speed, ref.stats().vmax, dx, maxSub);
      for (let s = 0; s < plan.n; s++) ref.step(plan.dt);
      return plan;
    },
    stats() {
      let ke = 0, Ts = 0, vmax = 0, flux = 0, divMax = 0, zone = 0, tTop = 0;
      let hotV = -Infinity, hotI = 0, coldV = Infinity, coldI = 0, plV = -Infinity, plI = 0;
      const kTop = nz - 1, kMid = nz >> 1;
      for (let c = 0; c < n; c++) {
        const u = vel[4 * c], v = vel[4 * c + 1], w = vel[4 * c + 2];
        const q = u * u + v * v + w * w;
        ke += q; Ts += T[c];
        if (q > vmax) vmax = q;
      }
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const col = i + nx * j;
        flux += ((Tb[col] - T[col]) * 2) / dz;
        const tt = T[col + nxy * kTop];
        tTop += tt;
        for (let k = 0; k < D.nHeat; k++) zone += 1 - T[col + nxy * k];
        if (tt > hotV) { hotV = tt; hotI = col; }
        if (tt < coldV) { coldV = tt; coldI = col; }
        const wm = vel[4 * (col + nxy * kMid) + 2];
        if (wm > plV) { plV = wm; plI = col; }
        for (let k = 0; k < nz; k++) {
          const c = col + nxy * k;
          const ci = (i + 1 === nx ? 0 : i + 1) + nx * j + nxy * k, cj = i + nx * (j + 1 === ny ? 0 : j + 1) + nxy * k;
          const wUp = k + 1 < nz ? W[c + nxy] : 0;
          const dv = Math.abs((U[ci] - U[c] + V[cj] - V[c] + wUp - W[c]) / dx);
          if (dv > divMax) divMax = dv;
        }
      }
      const pos = col => [((col % nx) + 0.5) * dx, (Math.floor(col / nx) + 0.5) * dx];
      return {
        simTime: ref.simTime,
        Nu: D.botNeumann ? zone / nxy / D.heatCond : flux / nxy / D.fluxRef,
        Ttop: [coldV, hotV, tTop / nxy],
        vmax: Math.sqrt(vmax), Tmean: Ts / n, ke: (0.5 * ke) / n, divMax,
        hot: pos(hotI), cold: pos(coldI), plume: pos(plI),
      };
    },
  };
  ref.reset(seed);
  return ref;
}
