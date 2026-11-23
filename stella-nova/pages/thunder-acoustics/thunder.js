// ============================================================================
//  THUNDER ACOUSTICS  ·  thunder.js — the thunder at the microphone
// ----------------------------------------------------------------------------
//  Pure module (no DOM). Builds the pressure p(t) at the microphone from
//  the channel, in 3D, with straight rays. The 2D grid (fdtd.js) cannot
//  carry audible frequencies, so the sound you hear comes from this model.
//
//  1. The channel is cut into pieces of length dl <= PIECE_M. The return
//     stroke heats the whole channel within about 50 us, so every piece
//     starts at t = 0.
//  2. Each piece sends an N-wave of length T_N = 0.66 / f_m (its spectrum
//     peaks at f_m, Few 1969). The amplitude is K sqrt(w E_l/E_REF) dl / r.
//     Pieces of a straight segment seen from the side arrive together and
//     add up: a loud clap. Seen end-on, they arrive one after another: a
//     long low rumble. No extra directivity term is needed.
//  3. The delay is r times the mean slowness 1/c(z) along the ray.
//  4. Air absorption (ISO 9613-1) filters each N-wave for its distance:
//     the crack goes first, the low rumble stays.
//  5. The ground under the microphone reflects (image source, R_G).
//  6. A ridge or a building on the ray diffracts the sound over its top:
//     the extra path delta sets a Maekawa loss 10 log10(3 + 20 N),
//     N = 2 delta f_m / c, at most 24 dB.
//  7. Slopes and building walls scatter the sound back (first order,
//     diffuse): late echoes, amplitude SIGMA_S L_f cos cos / (r1 r2).
//  K is set so that a straight 2 km channel seen side-on from 1 km gives a
//  peak P_REF at E_l = E_REF. That level is an assumption of this page.
//
//  grep -n: "export function synthesize"  "export function nKernel"
//           "export function pieces"  "export const P_REF"
// ============================================================================
import { fewFrequency } from './channel.js';
import { isoAlpha, slowness, surfaceAt, groundAt, cAt, TERRAIN_DX } from './scene.js';
import { fft, nextPow2 } from './fft.js';

export const P_REF = 5, E_REF = 5e5, R_REF = 1000;
export const PIECE_M = 2, R_G = 0.8, SIGMA_S = 0.35;
const PRE = 256;               // samples of kernel before the arrival
const NB = 44, RB0 = 15, RB1 = 60000;
const bucketR = b => RB0 * Math.pow(RB1 / RB0, b / (NB - 1));
const bucketOf = r => Math.max(0, Math.min(NB - 1, Math.round((NB - 1) * Math.log(Math.max(RB0, r) / RB0) / Math.log(RB1 / RB0))));

// The N-wave of one piece after absorption over r metres, peak 1 before
// absorption. Returns { k: Float32Array, pre } (arrival at index pre).
export function nKernel(fm, r, fs, Tc, RH) {
  const T = 0.66 / fm, nT = Math.max(2, Math.round(T * fs));
  const n = nextPow2(PRE + nT + 1024);
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i <= nT; i++) re[PRE + i] = 1 - 2 * i / nT;
  if (r > 0) {
    fft(re, im);
    for (let i = 0; i <= n / 2; i++) {
      const f = i * fs / n;
      const g = Math.pow(10, -isoAlpha(f, Tc, RH) * r / 20);
      re[i] *= g; im[i] *= g;
      if (i > 0 && i < n / 2) { re[n - i] *= g; im[n - i] *= g; }
    }
    fft(re, im, true);
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(re[i]));
  let a = 0, b = n - 1;
  while (a < PRE && Math.abs(re[a]) < 1e-4 * peak) a++;
  while (b > PRE + nT && Math.abs(re[b]) < 1e-4 * peak) b--;
  return { k: Float32Array.from(re.subarray(a, b + 1)), pre: PRE - a };
}

// Cut the channel into pieces { x, z, dl, w }.
export function pieces(segs, dlMax = PIECE_M) {
  const out = [];
  for (const s of segs) {
    const L = Math.hypot(s.x1 - s.x0, s.z1 - s.z0), n = Math.max(1, Math.ceil(L / dlMax));
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      out.push({ x: s.x0 + (s.x1 - s.x0) * u, z: s.z0 + (s.z1 - s.z0) * u, dl: L / n, w: s.w, order: s.order });
    }
  }
  return out;
}

// Scattering facets: sloped ground and building walls.
function facets(sc) {
  const F = [];
  const step = 50;
  for (let x = step / 2; x < sc.W; x += step) {
    const z0 = groundAt(sc, x - step / 2), z1 = groundAt(sc, x + step / 2);
    const s = (z1 - z0) / step;
    if (Math.abs(s) < 0.04) continue;
    const L = Math.hypot(step, z1 - z0);
    F.push({ x, z: (z0 + z1) / 2, nx: -(z1 - z0) / L, nz: step / L, L });
  }
  for (const b of sc.buildings) {
    const top = b.base + b.h, zc = b.base + b.h / 2;
    F.push({ x: b.x - b.w / 2, z: zc, nx: -1, nz: 0, L: b.h });
    F.push({ x: b.x + b.w / 2, z: zc, nx: 1, nz: 0, L: b.h });
    F.push({ x: b.x, z: top, nx: 0, nz: 1, L: b.w * 0.5 });
  }
  return F;
}

// A fast sight test over a sampled surface. Returns the worst block.
function makeSight(sc) {
  const n = Math.round(sc.W / TERRAIN_DX) + 1, surf = new Float32Array(n);
  for (let i = 0; i < n; i++) surf[i] = surfaceAt(sc, i * TERRAIN_DX);
  const at = x => { const f = Math.max(0, Math.min(n - 1.001, x / TERRAIN_DX)), i = f | 0, u = f - i; return surf[i] * (1 - u) + surf[i + 1] * u; };
  return function sight(ax, az, bx, bz, worst = true) {
    const L = Math.hypot(bx - ax, bz - az), m = Math.max(2, Math.ceil(L / 40));
    let wx = 0, wz = 0, wh = 0;
    for (let i = 1; i < m; i++) {
      const u = i / m, x = ax + (bx - ax) * u, z = az + (bz - az) * u, s = at(x);
      if (s > z + 0.5) { if (!worst) return 1; if (s - z > wh) { wh = s - z; wx = x; wz = s; } }
    }
    if (wh === 0) return 0;
    return Math.hypot(wx - ax, wz - az) + Math.hypot(bx - wx, bz - wz) - L;
  };
}

let K_CAL = 0;
function calibrate() {
  if (K_CAL) return K_CAL;
  const segs = [{ x0: 0, z0: 0, x1: 0, z1: 2000, w: 1, order: 0 }];
  const sc = { W: 4000, H: 4000, terrain: new Float32Array(401), buildings: [], atm: { profile: 'isothermal', T0: 20, RH: 50 } };
  const res = core({ segs, El: E_REF, sc, mic: [R_REF, 1000], fs: 22050, K: 1, image: false, absorb: false, scatter: false });
  K_CAL = P_REF / res.peak;
  return K_CAL;
}

// opt: { segs, El, sc, mic:[x,z], fs, dur?, image, absorb, scatter }
export function synthesize(opt) {
  return core({ image: true, absorb: true, scatter: true, ...opt, K: calibrate() });
}

function core({ segs, El, sc, mic, fs = 22050, dur, K, image, absorb, scatter }) {
  const [mx, mz] = mic;
  const Tc = sc.atm.T0, RH = sc.atm.RH ?? 60;
  const c0 = cAt(sc, mz), fm = fewFrequency(El, c0);
  const P = pieces(segs);
  const sight = makeSight(sc);
  const gm = surfaceAt(sc, mx), imz = 2 * gm - mz;
  const ampE = Math.sqrt(El / E_REF);
  const ev = [];   // [t, amp, bucket]
  let tFirst = Infinity, tLast = 0, rMin = Infinity, rMax = 0, nShadow = 0;
  const loss = (d) => { const N = 2 * d * fm / c0; return Math.pow(10, -Math.min(24, 10 * Math.log10(3 + 20 * N)) / 20) / Math.pow(10, -10 * Math.log10(3) / 20); };
  for (const q of P) {
    const a0 = K * ampE * Math.sqrt(q.w) * q.dl;
    const r = Math.hypot(q.x - mx, q.z - mz);
    const d = sight(q.x, q.z, mx, mz);
    const rr = r + d, t = rr * slowness(sc, q.z, mz);
    const a = a0 / Math.max(rr, 1) * (d > 0 ? loss(d) : 1);
    if (d > 0) nShadow++;
    ev.push(t, a, bucketOf(rr));
    if (t < tFirst) { tFirst = t; rMin = r; }
    if (t > tLast) tLast = t;
    rMax = Math.max(rMax, r);
    if (image && mz - gm < 200) {
      const ri = Math.hypot(q.x - mx, q.z - imz) + d;
      ev.push(ri * slowness(sc, q.z, gm), R_G * a0 / Math.max(ri, 1) * (d > 0 ? loss(d) : 1), bucketOf(ri));
    }
  }
  if (scatter) {
    const F = facets(sc).filter(f => f.nx * (mx - f.x) + f.nz * (mz - f.z) > 0 && !sight(f.x + f.nx * 2, f.z + f.nz * 2, mx, mz, false));
    // chunks of the channel about 50 m long
    const ch = [];
    let acc = null;
    for (const q of P) {
      if (!acc || acc.n >= 25) { acc = { x: 0, z: 0, m: 0, n: 0 }; ch.push(acc); }
      const m = Math.sqrt(q.w) * q.dl;
      acc.x += q.x * m; acc.z += q.z * m; acc.m += m; acc.n++;
    }
    for (const c of ch) { c.x /= c.m; c.z /= c.m; }
    for (const f of F) {
      const r2 = Math.hypot(mx - f.x, mz - f.z), cs = (f.nx * (mx - f.x) + f.nz * (mz - f.z)) / r2;
      for (const c of ch) {
        const ux = c.x - f.x, uz = c.z - f.z, r1 = Math.hypot(ux, uz), ci = (f.nx * ux + f.nz * uz) / r1;
        if (ci <= 0) continue;
        if (sight(f.x + f.nx * 2, f.z + f.nz * 2, c.x, c.z, false)) continue;
        const a = K * ampE * c.m * SIGMA_S * f.L * ci * cs / (r1 * r2);
        if (a < 1e-5) continue;
        ev.push((r1 * slowness(sc, c.z, f.z) + r2 * slowness(sc, f.z, mz)), a, bucketOf(r1 + r2));
      }
    }
  }
  const T = dur ?? Math.min(60, (isFinite(tLast) ? tLast : 0) + 2.5);
  const n = Math.ceil(T * fs);
  const out = new Float32Array(n);
  const kern = new Array(NB);
  for (let i = 0; i < ev.length; i += 3) {
    const b = ev[i + 2];
    const kb = kern[b] || (kern[b] = nKernel(fm, absorb ? bucketR(b) : 0, fs, Tc, RH));
    const pos = ev[i] * fs - kb.pre, i0 = Math.floor(pos), u = pos - i0, a = ev[i + 1];
    const k = kb.k, a0 = a * (1 - u), a1 = a * u;
    const lim = Math.min(k.length, n - i0 - 1);
    for (let j = Math.max(0, -i0); j < lim; j++) { out[i0 + j] += a0 * k[j]; out[i0 + j + 1] += a1 * k[j]; }
  }
  let peak = 0, sum2 = 0;
  for (let i = 0; i < n; i++) { const v = out[i]; peak = Math.max(peak, Math.abs(v)); sum2 += v * v; }
  const tEnd = Math.max(tLast, tFirst + 0.5);
  const Leq = sum2 > 0 ? 10 * Math.log10(sum2 / Math.max(1, (tEnd - tFirst + 0.5) * fs) / 4e-10) : -Infinity;
  return {
    signal: out, fs, dur: T, peak, splPeak: peak > 0 ? 20 * Math.log10(peak / 2e-5) : -Infinity, Leq,
    tFirst, tLast, rMin, rMax, fm, c0, nPieces: P.length, nShadow, nEvents: ev.length / 3,
  };
}
