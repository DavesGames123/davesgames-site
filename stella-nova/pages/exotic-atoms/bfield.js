// ============================================================================
//  EXOTIC ATOMS  ·  bfield.js — the magnetic field of the state's current
// ----------------------------------------------------------------------------
//  The probability current of a state is j = (hbar/m) Im(psi* grad psi).
//  For |n l m> (and every other state with e^{i m phi}) it is azimuthal:
//      j = (m / rho) |psi|^2  phi-hat
//  so it is zero for m = 0 and the charge current J = g j (g = the
//  two-body moment factor of physics.js orbitalG: -1 for hydrogen, 0 for
//  positronium, +1 for antihydrogen) is a nest of coaxial current loops.
//
//  ORBITAL FIELD, AXISYMMETRIC STATES (solveAxisym)
//    1. |psi|^2 on a source grid of (rho, z) cells, normalized to 1.
//    2. each cell is a current loop, I = J_phi d(rho) dz.
//    3. B of each loop at each target is the closed form with complete
//       elliptic integrals K and E (AGM), mu0 = 4 pi alpha^2 in atomic
//       units (B in units of B0 = 2.35e5 T):
//         Bz = 2/sqrt(D) [K + (a^2 - rho^2 - dz^2)/Q E]
//         Br = 2 dz/(rho sqrt(D)) [-K + (a^2 + rho^2 + dz^2)/Q E]
//         D = (a + rho)^2 + dz^2,  Q = (a - rho)^2 + dz^2
//    4. outside the target grid: the point dipole of the total moment.
//    The orbital moment is the sum of I pi a^2 = g m / 2 (g m mu_B).
//  SPIN LAYER
//    The spin moment mu_s = q g_s m_s mu_B spread over |psi|^2 is a
//    magnetization M = mu_s |psi|^2 z-hat. Its bound current is
//    J_b = curl M, J_phi = -mu_s d|psi|^2/d(rho): the same loop solver.
//  NON-AXISYMMETRIC STATES (solvePoints, the circular wave packet)
//    Biot-Savart summed over importance-sampled points on a 3D grid:
//    B(x) = alpha^2 (1/N) sum_i J_i x (x - x_i) / |x - x_i|^3 / q_i.
//
//  GREP MAP
//    export const ALPHA2 .......... alpha^2, mu0 / 4 pi in atomic units
//    export function ellipKE ...... complete elliptic integrals K, E
//    export function loopB ........ field of one unit current loop
//    export function solveAxisym .. orbital (+ spin) field on a grid
//    export function fieldAt ...... interpolate, dipole outside
//    export function fieldLines ... streamlines in the meridional plane
//    export function solvePoints .. 3D Biot-Savart from point samples
//    export function trace3D ...... streamlines in a 3D grid field
// ============================================================================
export const ALPHA2 = 7.2973525693e-3 ** 2;

export function ellipKE(m) {
  if (m >= 1) m = 1 - 1e-12;
  let a = 1, b = Math.sqrt(1 - m), c = Math.sqrt(m), sum = 0.5 * m, pow = 0.5;
  for (let i = 0; i < 12 && Math.abs(c) > 1e-14; i++) {
    const a1 = 0.5 * (a + b); c = 0.5 * (a - b); b = Math.sqrt(a * b); a = a1;
    pow *= 2; sum += pow * c * c;
  }
  const K = Math.PI / (2 * a);
  return [K, K * (1 - sum)];
}

// field (Br, Bz) at (rho, z) of a loop of radius a at height z0, unit
// current, mu0 / 2 pi = 2 (times ALPHA2 later). eps2 softens the wire.
export function loopB(a, z0, rho, z, eps2 = 0) {
  const dz = z - z0;
  if (rho < 1e-12) { const d = a * a + dz * dz + eps2; return [0, 2 * Math.PI * a * a / (d * Math.sqrt(d))]; }
  const D = (a + rho) ** 2 + dz * dz + eps2, Q = (a - rho) ** 2 + dz * dz + eps2;
  const [K, E] = ellipKE(4 * a * rho / D), sD = Math.sqrt(D);
  return [2 * dz / (rho * sD) * (-K + (a * a + rho * rho + dz * dz) / Q * E), 2 / sD * (K + (a * a - rho * rho - dz * dz) / Q * E)];
}

// Solve on a target grid. rhoz = { f(rho, z), m, ext } from states.js;
// opts: g (moment factor), spin (0 or mu_s, a.u.), ext (target half-size),
// ns (source cells per side), nt (target points per side), symmetric
// (|psi|^2 even in z: solve z >= 0 only), budget (ms per slice; 0 = sync).
// Returns a job { done, progress, result } or, when budget = 0, the result.
export function solveAxisym(rhoz, opts = {}) {
  const g = opts.g == null ? -1 : opts.g, spin = opts.spin || 0, E = opts.ext || rhoz.ext;
  const SE = opts.sext || Math.max(E, rhoz.ext || E);
  const nr = opts.ns || 56, nz = 2 * nr, dr = SE / nr, dzc = 2 * SE / nz;
  // sources
  const dens = new Float64Array(nr * nz);
  let tot = 0;
  for (let i = 0; i < nr; i++) for (let j = 0; j < nz; j++) {
    const rho = (i + 0.5) * dr, z = -SE + (j + 0.5) * dzc, v = rhoz.f(rho, z);
    dens[i * nz + j] = v; tot += v * 2 * Math.PI * rho * dr * dzc;
  }
  for (let k = 0; k < dens.length; k++) dens[k] /= tot || 1;
  // loop currents: orbital g m |psi|^2 / rho, spin -mu_s d|psi|^2/d(rho)
  const Jo = new Float64Array(nr * nz), Js = new Float64Array(nr * nz);
  let mOrb = 0, mSpin = 0;
  for (let i = 0; i < nr; i++) for (let j = 0; j < nz; j++) {
    const rho = (i + 0.5) * dr, d = dens[i * nz + j], a = Math.PI * rho * rho * dr * dzc;
    if (rhoz.m) { Jo[i * nz + j] = g * rhoz.m * d / rho; mOrb += Jo[i * nz + j] * a; }
    if (spin) {
      const dp = i < nr - 1 ? dens[(i + 1) * nz + j] : 0, dm = i > 0 ? dens[(i - 1) * nz + j] : d;
      Js[i * nz + j] = -spin * (dp - dm) / ((i > 0 ? 2 : 1) * dr); mSpin += Js[i * nz + j] * a;
    }
  }
  // the discrete curl leaks a few per cent of the spin moment at the
  // nucleus cusp and the grid edge: rescale the spin loops so it is exact
  const ks = spin && mSpin ? spin / mSpin : 0;
  if (spin) mSpin = spin;
  const moment = mOrb + mSpin, src = [];
  let Imax = 0;
  for (let i = 0; i < nr; i++) for (let j = 0; j < nz; j++) {
    const I = (Jo[i * nz + j] + ks * Js[i * nz + j]) * dr * dzc;
    if (I) { src.push((i + 0.5) * dr, -SE + (j + 0.5) * dzc, I); Imax = Math.max(Imax, Math.abs(I)); }
  }
  // drop negligible loops
  const S = [];
  for (let k = 0; k < src.length; k += 3) if (Math.abs(src[k + 2]) > Imax * 1e-5) S.push(src[k], src[k + 1], src[k + 2]);
  const nt = opts.nt || 44, ntz = 2 * nt - 1, hr = E / (nt - 1), hz = 2 * E / (ntz - 1);
  const Br = new Float64Array(nt * ntz), Bz = new Float64Array(nt * ntz), eps2 = (0.6 * dr) ** 2;
  const sym = !!opts.symmetric, rows = [];
  for (let l = 0; l < ntz; l++) { const z = -E + l * hz; if (!sym || z >= -1e-9) rows.push(l); }
  const res = { nt, ntz, E, hr, hz, Br, Bz, moment, mOrb, mSpin, m: rhoz.m, g, loops: S.length / 3 };
  let row = 0;
  const step = () => {
    const l = rows[row++], z = -E + l * hz;
    for (let k = 0; k < nt; k++) {
      const rho = k * hr; let br = 0, bz = 0;
      for (let s = 0; s < S.length; s += 3) { const [a, b] = loopB(S[s], S[s + 1], rho, z, eps2); br += S[s + 2] * a; bz += S[s + 2] * b; }
      Br[k * ntz + l] = ALPHA2 * br; Bz[k * ntz + l] = ALPHA2 * bz;
      if (sym) { const lm = ntz - 1 - l; Br[k * ntz + lm] = -ALPHA2 * br; Bz[k * ntz + lm] = ALPHA2 * bz; }
    }
  };
  if (!opts.budget) { while (row < rows.length) step(); return res; }
  const job = { done: false, progress: 0, result: res, cancel() { this.cancelled = true; } };
  const run = () => {
    if (job.cancelled) return;
    const t0 = performance.now();
    while (row < rows.length && performance.now() - t0 < opts.budget) step();
    job.progress = row / rows.length;
    if (row < rows.length) setTimeout(run, 0); else { job.done = true; if (opts.onDone) opts.onDone(res); }
  };
  setTimeout(run, 0);
  return job;
}

// B (Br, Bz) at (rho, z) in a.u. Bilinear inside the grid, dipole outside.
// A negative rho is the opposite half-plane: Br changes sign.
export function fieldAt(F, rho, z) {
  const sg = rho < 0 ? -1 : 1; rho = Math.abs(rho);
  if (rho <= F.E && Math.abs(z) <= F.E) {
    const u = rho / F.hr, v = (z + F.E) / F.hz, i = Math.min(F.nt - 2, Math.floor(u)), j = Math.min(F.ntz - 2, Math.floor(v)), fu = u - i, fv = v - j;
    const at = (A, ii, jj) => A[ii * F.ntz + jj];
    const lerp = A => (at(A, i, j) * (1 - fu) + at(A, i + 1, j) * fu) * (1 - fv) + (at(A, i, j + 1) * (1 - fu) + at(A, i + 1, j + 1) * fu) * fv;
    return [sg * lerp(F.Br), lerp(F.Bz)];
  }
  const r2 = rho * rho + z * z, r5 = r2 * r2 * Math.sqrt(r2), mu = F.moment;
  return [sg * ALPHA2 * 3 * mu * z * rho / r5, ALPHA2 * mu * (3 * z * z - r2) / r5];
}

// Streamlines in the meridional half-plane, seeded on the equator (and
// near the axis). Returns [[rho0, z0, rho1, z1, ...], ...] polylines with
// a magnitude per vertex in .mag. lines: seed count.
export function fieldLines(F, { lines = 8, reach = 1.45, steps = 900 } = {}) {
  const E = F.E, h = E / 140, out = [];
  if (!F.moment && !F.mSpin && !F.loops) return out;
  const dirAt = (r, z) => { const [a, b] = fieldAt(F, r, z); const m = Math.hypot(a, b); return m > 0 ? [a / m, b / m, m] : [0, 0, 0]; };
  for (let s = 0; s < lines; s++) {
    const r0 = E * (0.14 + 0.74 * Math.pow((s + 0.5) / lines, 1.25));
    const pts = [], mag = [];
    for (const dir of [1, -1]) {
      let r = r0, z = 0; const seg = [], sm = [];
      for (let k = 0; k < steps; k++) {
        const [a, b, m] = dirAt(r, z); if (!m) break;
        const [a2, b2] = dirAt(r + dir * 0.5 * h * a, z + dir * 0.5 * h * b);
        r += dir * h * a2; z += dir * h * b2;
        seg.push(r, z); sm.push(m);
        if (Math.hypot(r, z) > reach * E) break;
        if (k > 20 && Math.abs(z) < h * 0.7 && Math.abs(r - r0) < h * 1.5) break;   // closed
      }
      if (dir === 1) { for (let k = seg.length - 2; k >= 0; k -= 2) { pts.push(seg[k], seg[k + 1]); mag.push(sm[k / 2]); } pts.push(r0, 0); mag.push(dirAt(r0, 0)[2]); }
      else { for (let k = 0; k < seg.length; k += 2) { pts.push(seg[k], seg[k + 1]); mag.push(sm[k / 2]); } }
    }
    const line = Float32Array.from(pts); line.mag = Float32Array.from(mag); out.push(line);
  }
  return out;
}

// 3D Biot-Savart from weighted point currents on a G^3 grid of half-size
// E. src: Float32Array [x, y, z, Jx, Jy, Jz] already divided by N q_i.
export function solvePoints(src, E, G = 14, eps = E / 25) {
  const B = new Float32Array(G * G * G * 3), h = 2 * E / (G - 1), e2 = eps * eps;
  let k = 0;
  for (let a = 0; a < G; a++) for (let b = 0; b < G; b++) for (let c = 0; c < G; c++, k += 3) {
    const x = -E + a * h, y = -E + b * h, z = -E + c * h;
    let bx = 0, by = 0, bz = 0;
    for (let s = 0; s < src.length; s += 6) {
      const dx = x - src[s], dy = y - src[s + 1], dz = z - src[s + 2], d2 = dx * dx + dy * dy + dz * dz + e2, i3 = 1 / (d2 * Math.sqrt(d2));
      const jx = src[s + 3], jy = src[s + 4], jz = src[s + 5];
      bx += (jy * dz - jz * dy) * i3; by += (jz * dx - jx * dz) * i3; bz += (jx * dy - jy * dx) * i3;
    }
    B[k] = ALPHA2 * bx; B[k + 1] = ALPHA2 * by; B[k + 2] = ALPHA2 * bz;
  }
  return { B, G, E, h };
}
function at3(F, x, y, z) {
  const u = (x + F.E) / F.h, v = (y + F.E) / F.h, w = (z + F.E) / F.h, G = F.G;
  if (u < 0 || v < 0 || w < 0 || u > G - 1 || v > G - 1 || w > G - 1) return null;
  const i = Math.min(G - 2, u | 0), j = Math.min(G - 2, v | 0), k = Math.min(G - 2, w | 0), fu = u - i, fv = v - j, fw = w - k, o = [0, 0, 0];
  for (let c = 0; c < 8; c++) {
    const di = c & 1, dj = (c >> 1) & 1, dk = (c >> 2) & 1, wt = (di ? fu : 1 - fu) * (dj ? fv : 1 - fv) * (dk ? fw : 1 - fw), q = (((i + di) * G + j + dj) * G + k + dk) * 3;
    o[0] += wt * F.B[q]; o[1] += wt * F.B[q + 1]; o[2] += wt * F.B[q + 2];
  }
  return o;
}
export function trace3D(F, seeds, steps = 260) {
  const h = F.h * 0.45, out = [];
  for (const s of seeds) {
    const pts = [], mag = [];
    for (const dir of [1, -1]) {
      let [x, y, z] = s; const seg = [], sm = [];
      for (let k = 0; k < steps; k++) {
        const b = at3(F, x, y, z); if (!b) break;
        const m = Math.hypot(b[0], b[1], b[2]); if (!m) break;
        x += dir * h * b[0] / m; y += dir * h * b[1] / m; z += dir * h * b[2] / m; seg.push(x, y, z); sm.push(m);
      }
      if (dir === 1) { for (let k = seg.length - 3; k >= 0; k -= 3) { pts.push(seg[k], seg[k + 1], seg[k + 2]); mag.push(sm[k / 3]); } pts.push(...s); mag.push(sm[0] || 0); }
      else { for (let k = 0; k < seg.length; k += 3) { pts.push(seg[k], seg[k + 1], seg[k + 2]); mag.push(sm[k / 3]); } }
    }
    const line = Float32Array.from(pts); line.mag = Float32Array.from(mag); line.is3D = true; out.push(line);
  }
  return out;
}
// sources of a circular packet at time t: a subsample of its points with
// J = g j / (N q), for solvePoints; also returns the moment (a.u.)
export function packetSources(pk, t, g = -1, count = 900) {
  const N = pk.pts.length / 4, step = Math.max(1, Math.floor(N / count)), n = Math.floor(N / step), out = new Float32Array(n * 6);
  let mz = 0, mx = 0, my = 0;
  for (let s = 0, i = 0; s < n; s++, i += step) {
    const [, jx, jy, jz] = pk.current(i, t), q = pk.q[i];
    if (!(q > 0)) continue;
    const f = g / (n * q), x = pk.pts[i * 4], y = pk.pts[i * 4 + 1], z = pk.pts[i * 4 + 2];
    out.set([x, y, z, jx * f, jy * f, jz * f], s * 6);
    mx += 0.5 * (y * jz - z * jy) * f; my += 0.5 * (z * jx - x * jz) * f; mz += 0.5 * (x * jy - y * jx) * f;
  }
  return { src: out, moment: [mx, my, mz] };
}
