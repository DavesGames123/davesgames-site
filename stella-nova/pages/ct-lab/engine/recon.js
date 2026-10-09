// recon.js - reconstruction for the CT engine.
// FBP (parallel; fan direct for flat and equiangular detectors, Kak and Slaney ch. 3),
// fan-to-parallel rebinning, FDK (Feldkamp, Davis and Kress 1984), and the iterative
// methods ART (Kaczmarz), SART (Andersen and Kak 1984), SIRT and CGLS, with optional
// nonnegativity and a few total-variation descent steps per iteration.
//
// grep handles:
//   fft, FILTERS, filterWindow, filterResponse, filterSinogram, fbp, rebinFanToParallel,
//   fdkFilter, coneBackProjectFDK, fdk, createSolver, runIterative, tvDenoise, makeSIRT, makeSART, makeART, makeCGLS

import { angleWeights, coverage, rayFor } from './geometry.js';
import {
  forwardProject, backProject, fbpBackProject, emptyImage, emptySino, emptyVolume,
  josephRay2D, josephScatter2D, josephRowNorm2,
} from './project.js';
import { mulberry32 } from './physics.js';

// ---------- FFT (radix 2, in place) ----------

export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

const nextPow2 = (n) => { let p = 1; while (p < n) p <<= 1; return p; };

// ---------- filters ----------

export const FILTERS = ['ram-lak', 'shepp-logan', 'cosine', 'hamming', 'hann'];

// Window at normalised frequency nu in [0, 1] (1 = Nyquist), cutoff c in (0, 1].
export function filterWindow(name, nu, c = 1) {
  if (nu > c) return 0;
  const x = nu / c;
  switch (name) {
    case 'ram-lak': return 1;
    case 'shepp-logan': { const t = (Math.PI * x) / 2; return t === 0 ? 1 : Math.sin(t) / t; }
    case 'cosine': return Math.cos((Math.PI * x) / 2);
    case 'hamming': return 0.54 + 0.46 * Math.cos(Math.PI * x);
    case 'hann': return 0.5 + 0.5 * Math.cos(Math.PI * x);
    default: throw new Error('unknown filter ' + name);
  }
}

// Frequency response of the discrete ramp kernel (Kak and Slaney eq. 3.61) times a window.
// kind: 'ramp' | 'half' (fan flat / cone, h/2) | 'arc' (equiangular, alpha = tau).
export function filterResponse(name, P, tau, cutoff = 1, kind = 'ramp') {
  const re = new Float64Array(P), im = new Float64Array(P);
  re[0] = 1 / (4 * tau * tau);
  for (let k = 1; k <= P / 2; k++) {
    let h = k & 1 ? -1 / (Math.PI * Math.PI * k * k * tau * tau) : 0;
    if (kind === 'arc') { const g = k * tau; h *= (g / Math.sin(g)) ** 2; }
    re[k] = h; if (k < P / 2) re[P - k] = h;
  }
  if (kind !== 'ramp') for (let k = 0; k < P; k++) re[k] *= 0.5;
  fft(re, im);
  const H = new Float64Array(P);
  for (let k = 0; k < P; k++) {
    const nu = Math.min(k, P - k) / (P / 2);
    H[k] = re[k] * tau * filterWindow(name, nu, cutoff);
  }
  return H;
}

function filterRows(data, nRows, n, H, out) {
  const P = H.length, re = new Float64Array(P), im = new Float64Array(P);
  for (let r = 0; r < nRows; r++) {
    re.fill(0); im.fill(0);
    const off = r * n;
    for (let i = 0; i < n; i++) re[i] = data[off + i];
    fft(re, im);
    for (let k = 0; k < P; k++) { re[k] *= H[k]; im[k] *= H[k]; }
    fft(re, im, true);
    for (let i = 0; i < n; i++) out[off + i] = re[i];
  }
}

// Pre-weight and filter a sinogram for FBP. Returns a new sinogram.
export function filterSinogram(sino, geom, o = {}) {
  const name = o.filter ?? 'ram-lak', cutoff = o.cutoff ?? 1;
  const n = geom.nDet, P = nextPow2(2 * n), out = new Float32Array(sino.data.length);
  const pre = new Float32Array(sino.data.length);
  let H;
  if (geom.type === 'parallel') {
    pre.set(sino.data);
    H = filterResponse(name, P, geom.du, cutoff, 'ramp');
  } else if (geom.detector === 'arc') {
    const alpha = geom.du / geom.sdd;
    for (let a = 0; a < geom.nAngles; a++) for (let i = 0; i < n; i++) {
      const g = ((i - (n - 1) / 2) * geom.du + (geom.offset ?? 0)) / geom.sdd;
      pre[a * n + i] = sino.data[a * n + i] * geom.sod * Math.cos(g);
    }
    H = filterResponse(name, P, alpha, cutoff, 'arc');
  } else {
    const m = geom.sod / geom.sdd;
    for (let a = 0; a < geom.nAngles; a++) for (let i = 0; i < n; i++) {
      const p = ((i - (n - 1) / 2) * geom.du + (geom.offset ?? 0)) * m;
      pre[a * n + i] = (sino.data[a * n + i] * geom.sod) / Math.sqrt(geom.sod * geom.sod + p * p);
    }
    H = filterResponse(name, P, geom.du * m, cutoff, 'half');
  }
  filterRows(pre, geom.nAngles, n, H, out);
  return { nAngles: sino.nAngles, nDet: n, data: out };
}

// Filtered back-projection. dims: { nx, ny, width }.
export function fbp(sino, geom, dims, o = {}) {
  const q = filterSinogram(sino, geom, o);
  const w = angleWeights(geom);
  if (geom.type === 'parallel' && coverage(geom) > 1.5 * Math.PI) for (let k = 0; k < w.length; k++) w[k] *= 0.5;
  return fbpBackProject(q, geom, dims, { weights: w });
}

// Resample a fan sinogram onto a parallel grid (theta in [0, pi)). Needs pi + fan angle of data.
export function rebinFanToParallel(sino, geom, o = {}) {
  const nA = o.nAngles ?? geom.nAngles >> 1, n = geom.nDet;
  const duP = o.du ?? (geom.du * geom.sod) / geom.sdd, nP = o.nDet ?? n;
  const pg = { type: 'parallel', angles: new Float32Array(nA), nAngles: nA, nDet: nP, du: duP, offset: 0 };
  for (let k = 0; k < nA; k++) pg.angles[k] = (Math.PI * k) / nA;
  const out = new Float32Array(nA * nP);
  const A = geom.angles, nB = geom.nAngles, b0 = A[0], db = (A[nB - 1] - A[0]) / (nB - 1);
  const full = coverage(geom) > 1.99 * Math.PI;
  for (let k = 0; k < nA; k++) for (let j = 0; j < nP; j++) {
    const s = (j - (nP - 1) / 2) * duP;
    if (Math.abs(s) >= geom.sod) continue;
    const g = Math.asin(s / geom.sod);
    const u = geom.detector === 'arc' ? geom.sdd * g : geom.sdd * Math.tan(g);
    const beta = pg.angles[k] + g;
    let val = 0, ok = false;
    for (let flip = 0; flip < 2 && !ok; flip++) {
      // the same line seen from the opposite side: (theta + pi, -s)
      const bb = flip ? beta + Math.PI - 2 * g : beta, uu = flip ? -u : u;
      const TAU = 2 * Math.PI;
      let fb = ((((bb - b0) % TAU) + TAU) % TAU) / db;
      if (full) { fb = ((fb % nB) + nB) % nB; }
      if (fb < 0 || fb > nB - 1 + (full ? 1 : 0)) continue;
      const fi = (uu - (geom.offset ?? 0)) / geom.du + (n - 1) / 2;
      if (fi < 0 || fi > n - 1) continue;
      const b0i = Math.floor(fb), tb = fb - b0i, i0 = Math.min(n - 2, Math.floor(fi)), ti = fi - i0;
      const b1i = full ? (b0i + 1) % nB : Math.min(nB - 1, b0i + 1);
      const r0 = b0i * n, r1 = b1i * n, d = sino.data;
      val = (1 - tb) * ((1 - ti) * d[r0 + i0] + ti * d[r0 + i0 + 1]) + tb * ((1 - ti) * d[r1 + i0] + ti * d[r1 + i0 + 1]);
      ok = true;
    }
    out[k * nP + j] = val;
  }
  return { sino: { nAngles: nA, nDet: nP, data: out }, geom: pg };
}

// FDK step 1: cosine pre-weight and row-wise ramp filter (h/2) on the virtual detector.
export function fdkFilter(proj, geom, o = {}) {
  const { nu, nv, sod, sdd } = geom, m = sod / sdd;
  const P = nextPow2(2 * nu);
  const H = filterResponse(o.filter ?? 'ram-lak', P, geom.du * m, o.cutoff ?? 1, 'half');
  const pre = new Float32Array(proj.data.length), q = new Float32Array(proj.data.length);
  for (let a = 0; a < geom.nAngles; a++) for (let iv = 0; iv < nv; iv++) {
    const qv = (iv - (nv - 1) / 2) * geom.dv * m, row = (a * nv + iv) * nu;
    for (let iu = 0; iu < nu; iu++) {
      const pu = (iu - (nu - 1) / 2) * geom.du * m;
      pre[row + iu] = (proj.data[row + iu] * sod) / Math.sqrt(sod * sod + pu * pu + qv * qv);
    }
  }
  filterRows(pre, geom.nAngles * nv, nu, H, q);
  return { ...proj, data: q };
}

// FDK for a flat detector and a full circular orbit. dims: { nx, ny, nz, width }.
export function fdk(proj, geom, dims, o = {}) {
  const q = fdkFilter(proj, geom, o);
  return coneBackProjectFDK(q, geom, dims, { weights: angleWeights(geom), a0: o.a0, a1: o.a1, out: o.out });
}

// Voxel-driven FDK back-projection with bilinear detector interpolation.
export function coneBackProjectFDK(q, geom, dims, o = {}) {
  const vol = o.out ?? emptyVolume(dims);
  const { nx, ny, nz, data } = vol, px = vol.width / nx;
  const { nu, nv, sod, sdd } = geom, cu = (nu - 1) / 2, cv = (nv - 1) / 2;
  const a0 = o.a0 ?? 0, a1 = o.a1 ?? geom.nAngles;
  for (let a = a0; a < a1; a++) {
    const b = geom.angles[a], c = Math.cos(b), s = Math.sin(b), wa = o.weights ? o.weights[a] : 1;
    const base = a * nv * nu;
    for (let iy = 0; iy < ny; iy++) {
      const y = 0.5 * ny * px - (iy + 0.5) * px;
      for (let ix = 0; ix < nx; ix++) {
        const x = (ix + 0.5) * px - 0.5 * nx * px;
        const L = sod - x * s + y * c, xn = x * c + y * s;
        const mag = sdd / L, fu = (mag * xn) / geom.du + cu;
        if (fu < 0 || fu > nu - 1) continue;
        const w = (wa * sod * sod) / (L * L);
        const i0 = Math.min(nu - 2, Math.floor(fu)), tu = fu - i0;
        for (let iz = 0; iz < nz; iz++) {
          const z = (iz + 0.5) * px - 0.5 * nz * px;
          const fv = (mag * z) / geom.dv + cv;
          if (fv < 0 || fv > nv - 1) continue;
          const j0 = Math.min(nv - 2, Math.floor(fv)), tv = fv - j0;
          const r0 = base + j0 * nu + i0, r1 = r0 + nu;
          const v = (1 - tv) * ((1 - tu) * q.data[r0] + tu * q.data[r0 + 1]) + tv * ((1 - tu) * q.data[r1] + tu * q.data[r1 + 1]);
          data[(iz * ny + iy) * nx + ix] += w * v;
        }
      }
    }
  }
  return vol;
}

// ---------- total variation ----------

// A few steps of gradient descent on smoothed isotropic TV, in place.
// weight: step as a fraction of the image range (0.002 - 0.05 is a useful range).
export function tvDenoise(img, o = {}) {
  const { nx, ny, data } = img, steps = o.steps ?? 5, eps = o.eps ?? 1e-8;
  let mx = 0; for (let i = 0; i < data.length; i++) if (data[i] > mx) mx = data[i];
  const g = new Float32Array(data.length);
  for (let it = 0; it < steps; it++) {
    g.fill(0);
    for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
      const k = y * nx + x;
      const dx = data[k + 1] - data[k], dy = data[k + nx] - data[k];
      const m = Math.sqrt(dx * dx + dy * dy + eps * mx * mx + 1e-30);
      g[k] -= (dx + dy) / m; g[k + 1] += dx / m; g[k + nx] += dy / m;
    }
    let gm = 0; for (let i = 0; i < g.length; i++) gm = Math.max(gm, Math.abs(g[i]));
    if (gm === 0) break;
    const step = ((o.weight ?? 0.01) * mx) / gm;
    for (let i = 0; i < data.length; i++) data[i] -= step * g[i];
  }
  return img;
}

// ---------- iterative solvers ----------

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
function clampPos(d) { for (let i = 0; i < d.length; i++) if (d[i] < 0) d[i] = 0; }

function after(img, o) {
  if (o.nonneg !== false) clampPos(img.data);
  if (o.tv && o.tv.weight > 0) { tvDenoise(img, o.tv); if (o.nonneg !== false) clampPos(img.data); }
}

function makeSIRT(sino, geom, dims, o) {
  const x = o.x0 ? { ...emptyImage(dims), data: Float32Array.from(o.x0.data) } : emptyImage(dims);
  const ones = emptyImage(dims); ones.data.fill(1);
  const rowSum = forwardProject(ones, geom).data;
  const colSum = backProject({ ...emptySino(geom), data: new Float32Array(geom.nAngles * geom.nDet).fill(1) }, geom, dims).data;
  const R = rowSum.map((v) => (v > 1e-8 ? 1 / v : 0)), Cw = colSum.map((v) => (v > 1e-8 ? 1 / v : 0));
  const lam = o.relax ?? 1;
  const fp = emptySino(geom), bp = emptyImage(dims);
  let iter = 0;
  return {
    image: x,
    step() {
      fp.data.fill(0); forwardProject(x, geom, { out: fp });
      let res = 0;
      for (let i = 0; i < fp.data.length; i++) { const r = sino.data[i] - fp.data[i]; res += r * r; fp.data[i] = r * R[i]; }
      bp.data.fill(0); backProject(fp, geom, dims, { out: bp });
      for (let j = 0; j < x.data.length; j++) x.data[j] += lam * Cw[j] * bp.data[j];
      after(x, o);
      iter++;
      return { iter, residual: Math.sqrt(res), image: x };
    },
  };
}

function makeSART(sino, geom, dims, o) {
  const x = o.x0 ? { ...emptyImage(dims), data: Float32Array.from(o.x0.data) } : emptyImage(dims);
  const ones = emptyImage(dims); ones.data.fill(1);
  const rowSum = forwardProject(ones, geom).data;
  const lam = o.relax ?? 0.5, rng = mulberry32(o.seed ?? 1);
  const n = geom.nDet, fp = emptySino(geom), bp = emptyImage(dims), cs = emptyImage(dims);
  const onesRow = emptySino(geom);
  let iter = 0;
  return {
    image: x,
    step() {
      const order = Array.from({ length: geom.nAngles }, (_, k) => k);
      for (let k = order.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; }
      let res = 0;
      for (const a of order) {
        forwardProject(x, geom, { out: fp, a0: a, a1: a + 1 });
        const row = a * n;
        for (let i = 0; i < n; i++) {
          const r = sino.data[row + i] - fp.data[row + i]; res += r * r;
          const rs = rowSum[row + i];
          fp.data[row + i] = rs > 1e-8 ? r / rs : 0;
          onesRow.data[row + i] = 1;
        }
        bp.data.fill(0); cs.data.fill(0);
        backProject(fp, geom, dims, { out: bp, a0: a, a1: a + 1 });
        backProject(onesRow, geom, dims, { out: cs, a0: a, a1: a + 1 });
        for (let j = 0; j < x.data.length; j++) if (cs.data[j] > 1e-8) x.data[j] += (lam * bp.data[j]) / cs.data[j];
        if (o.nonneg !== false) clampPos(x.data);
      }
      after(x, o);
      iter++;
      return { iter, residual: Math.sqrt(res), image: x };
    },
  };
}

function makeART(sino, geom, dims, o) {
  const x = o.x0 ? { ...emptyImage(dims), data: Float32Array.from(o.x0.data) } : emptyImage(dims);
  const { nx, ny } = x, px = x.width / nx, lam = o.relax ?? 0.25, rng = mulberry32(o.seed ?? 1);
  const M = geom.nAngles * geom.nDet, norms = new Float32Array(M), rays = new Float32Array(M * 4), R = {};
  for (let a = 0; a < geom.nAngles; a++) for (let i = 0; i < geom.nDet; i++) {
    const k = a * geom.nDet + i; rayFor(geom, a, i, R);
    rays[4 * k] = R.ox; rays[4 * k + 1] = R.oy; rays[4 * k + 2] = R.dx; rays[4 * k + 3] = R.dy;
    norms[k] = josephRowNorm2(nx, ny, px, R.ox, R.oy, R.dx, R.dy);
  }
  const order = new Uint32Array(M); for (let k = 0; k < M; k++) order[k] = k;
  let iter = 0;
  return {
    image: x,
    step() {
      for (let k = M - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); const t = order[k]; order[k] = order[j]; order[j] = t; }
      let res = 0;
      for (let q = 0; q < M; q++) {
        const k = order[q]; if (norms[k] < 1e-12) continue;
        const ox = rays[4 * k], oy = rays[4 * k + 1], dx = rays[4 * k + 2], dy = rays[4 * k + 3];
        const r = sino.data[k] - josephRay2D(x.data, nx, ny, px, ox, oy, dx, dy);
        res += r * r;
        josephScatter2D(x.data, nx, ny, px, ox, oy, dx, dy, (lam * r) / norms[k]);
      }
      after(x, o);
      iter++;
      return { iter, residual: Math.sqrt(res), image: x };
    },
  };
}

function makeCGLS(sino, geom, dims, o) {
  const x = emptyImage(dims);
  const r = Float32Array.from(sino.data);
  if (o.x0) { x.data.set(o.x0.data); const ax = forwardProject(x, geom).data; for (let i = 0; i < r.length; i++) r[i] -= ax[i]; }
  const s = backProject({ ...emptySino(geom), data: r }, geom, dims).data;
  const p = Float32Array.from(s);
  let gamma = dot(s, s), iter = 0;
  const q = emptySino(geom), sImg = emptyImage(dims);
  return {
    image: x,
    step() {
      if (gamma > 0) {
        q.data.fill(0); forwardProject({ ...x, data: p }, geom, { out: q });
        const qq = dot(q.data, q.data);
        const alpha = qq > 0 ? gamma / qq : 0;
        for (let j = 0; j < p.length; j++) x.data[j] += alpha * p[j];
        for (let i = 0; i < r.length; i++) r[i] -= alpha * q.data[i];
        sImg.data.fill(0); backProject({ ...q, data: r }, geom, dims, { out: sImg });
        const gNew = dot(sImg.data, sImg.data), beta = gNew / gamma;
        for (let j = 0; j < p.length; j++) p[j] = sImg.data[j] + beta * p[j];
        gamma = gNew;
      }
      iter++;
      return { iter, residual: Math.sqrt(dot(r, r)), image: x };
    },
  };
}

const MAKERS = { sirt: makeSIRT, sart: makeSART, art: makeART, cgls: makeCGLS };

export function createSolver(method, sino, geom, dims, o = {}) {
  const mk = MAKERS[method];
  if (!mk) throw new Error('createSolver: unknown method ' + method);
  return mk(sino, geom, dims, o);
}

export function runIterative(method, sino, geom, dims, o = {}) {
  const s = createSolver(method, sino, geom, dims, o);
  const n = o.iterations ?? 20;
  for (let k = 0; k < n; k++) {
    const r = s.step();
    if (o.onIter && o.onIter(r) === false) break;
  }
  return s.image;
}

export { makeSIRT, makeSART, makeART, makeCGLS };
