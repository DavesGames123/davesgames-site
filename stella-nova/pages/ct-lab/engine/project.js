// project.js - CPU projectors for the CT engine.
// Joseph (1982) ray-driven projector with linear (2D) or bilinear (3D) interpolation.
// backProject / backProjectCone are the exact transposes of the forward projectors.
// fbpBackProject is the pixel-driven, interpolating back-projector that FBP uses.
//
// grep handles:
//   josephRay2D, josephScatter2D, forwardProject, backProject, forwardProjectSteps,
//   fbpBackProject, josephRay3D, forwardProjectCone, backProjectCone, drive, emptyImage

import { rayFor, rayFor3D } from './geometry.js';

export function emptyImage(d) {
  return { nx: d.nx, ny: d.ny ?? d.nx, width: d.width ?? 2, data: new Float32Array(d.nx * (d.ny ?? d.nx)) };
}
export function emptySino(geom) {
  return { nAngles: geom.nAngles, nDet: geom.nDet, data: new Float32Array(geom.nAngles * geom.nDet) };
}

// Line integral of one ray (Joseph). (ox, oy) on the line, (dx, dy) unit direction.
export function josephRay2D(data, nx, ny, px, ox, oy, dx, dy) {
  const f0x = (ox + 0.5 * nx * px) / px - 0.5, f0y = (0.5 * ny * px - oy) / px - 0.5;
  const gx = dx / px, gy = -dy / px;
  let acc = 0;
  if (Math.abs(gx) >= Math.abs(gy)) {
    const sl = gy / gx;
    for (let ix = 0; ix < nx; ix++) {
      const fy = f0y + (ix - f0x) * sl;
      if (fy <= -1 || fy >= ny) continue;
      const i0 = Math.floor(fy), w = fy - i0;
      if (i0 >= 0) acc += (1 - w) * data[i0 * nx + ix];
      if (i0 + 1 < ny) acc += w * data[(i0 + 1) * nx + ix];
    }
    return acc / Math.abs(gx);
  }
  const sl = gx / gy;
  for (let iy = 0; iy < ny; iy++) {
    const fx = f0x + (iy - f0y) * sl;
    if (fx <= -1 || fx >= nx) continue;
    const i0 = Math.floor(fx), w = fx - i0, row = iy * nx;
    if (i0 >= 0) acc += (1 - w) * data[row + i0];
    if (i0 + 1 < nx) acc += w * data[row + i0 + 1];
  }
  return acc / Math.abs(gy);
}

// Transpose of josephRay2D: adds val * weights into data.
export function josephScatter2D(data, nx, ny, px, ox, oy, dx, dy, val) {
  const f0x = (ox + 0.5 * nx * px) / px - 0.5, f0y = (0.5 * ny * px - oy) / px - 0.5;
  const gx = dx / px, gy = -dy / px;
  if (Math.abs(gx) >= Math.abs(gy)) {
    const sl = gy / gx, v = val / Math.abs(gx);
    for (let ix = 0; ix < nx; ix++) {
      const fy = f0y + (ix - f0x) * sl;
      if (fy <= -1 || fy >= ny) continue;
      const i0 = Math.floor(fy), w = fy - i0;
      if (i0 >= 0) data[i0 * nx + ix] += (1 - w) * v;
      if (i0 + 1 < ny) data[(i0 + 1) * nx + ix] += w * v;
    }
    return;
  }
  const sl = gx / gy, v = val / Math.abs(gy);
  for (let iy = 0; iy < ny; iy++) {
    const fx = f0x + (iy - f0y) * sl;
    if (fx <= -1 || fx >= nx) continue;
    const i0 = Math.floor(fx), w = fx - i0, row = iy * nx;
    if (i0 >= 0) data[row + i0] += (1 - w) * v;
    if (i0 + 1 < nx) data[row + i0 + 1] += w * v;
  }
}

// Sum of squared weights of one ray (row norm for ART).
export function josephRowNorm2(nx, ny, px, ox, oy, dx, dy) {
  const f0x = (ox + 0.5 * nx * px) / px - 0.5, f0y = (0.5 * ny * px - oy) / px - 0.5;
  const gx = dx / px, gy = -dy / px;
  const major = Math.abs(gx) >= Math.abs(gy);
  const n = major ? nx : ny, m = major ? ny : nx;
  const sl = major ? gy / gx : gx / gy, f0a = major ? f0x : f0y, f0b = major ? f0y : f0x;
  const inv = 1 / (major ? Math.abs(gx) : Math.abs(gy));
  let acc = 0;
  for (let k = 0; k < n; k++) {
    const f = f0b + (k - f0a) * sl;
    if (f <= -1 || f >= m) continue;
    const i0 = Math.floor(f), w = f - i0;
    if (i0 >= 0) acc += (1 - w) * (1 - w);
    if (i0 + 1 < m) acc += w * w;
  }
  return acc * inv * inv;
}

const RAY = {};

export function forwardProject(image, geom, o = {}) {
  const sino = o.out ?? emptySino(geom);
  const a0 = o.a0 ?? 0, a1 = o.a1 ?? geom.nAngles;
  const { nx, ny, data } = image, px = image.width / nx;
  for (let a = a0; a < a1; a++) {
    let mx = 0, my = 0;
    if (o.motion) { const m = o.motion(a); mx = m.dx || 0; my = m.dy || 0; }
    const row = a * geom.nDet;
    for (let i = 0; i < geom.nDet; i++) {
      rayFor(geom, a, i, RAY);
      sino.data[row + i] = josephRay2D(data, nx, ny, px, RAY.ox - mx, RAY.oy - my, RAY.dx, RAY.dy);
    }
  }
  return sino;
}

export function backProject(sino, geom, dims, o = {}) {
  const img = o.out ?? emptyImage(dims);
  const a0 = o.a0 ?? 0, a1 = o.a1 ?? geom.nAngles;
  const { nx, ny, data } = img, px = img.width / nx;
  for (let a = a0; a < a1; a++) {
    const row = a * geom.nDet;
    for (let i = 0; i < geom.nDet; i++) {
      const v = sino.data[row + i];
      if (v === 0) continue;
      rayFor(geom, a, i, RAY);
      josephScatter2D(data, nx, ny, px, RAY.ox, RAY.oy, RAY.dx, RAY.dy, v);
    }
  }
  return img;
}

// Generator: one view per step. Yields { done, total, sino }.
export function* forwardProjectSteps(image, geom, o = {}) {
  const sino = o.out ?? emptySino(geom);
  for (let a = 0; a < geom.nAngles; a++) {
    forwardProject(image, geom, { ...o, out: sino, a0: a, a1: a + 1 });
    yield { done: a + 1, total: geom.nAngles, sino };
  }
  return { done: geom.nAngles, total: geom.nAngles, sino };
}

// Pixel-driven back-projection with linear interpolation along the detector.
// Fan beam: distance weight (sod/L)^2 (flat) or 1/L^2 (arc) when distanceWeight is true.
// weights: per-view factor (for example the angle quadrature weights).
export function fbpBackProject(filtered, geom, dims, o = {}) {
  const img = o.out ?? emptyImage(dims);
  const a0 = o.a0 ?? 0, a1 = o.a1 ?? geom.nAngles;
  const { nx, ny, data } = img, px = img.width / nx;
  const nDet = geom.nDet, c0 = (nDet - 1) / 2, inv = 1 / geom.du, off = geom.offset ?? 0;
  const dw = o.distanceWeight !== false;
  const xs = new Float32Array(nx), ys = new Float32Array(ny);
  for (let ix = 0; ix < nx; ix++) xs[ix] = (ix + 0.5) * px - 0.5 * nx * px;
  for (let iy = 0; iy < ny; iy++) ys[iy] = 0.5 * ny * px - (iy + 0.5) * px;
  const q = filtered.data;
  for (let a = a0; a < a1; a++) {
    const b = geom.angles[a], c = Math.cos(b), s = Math.sin(b);
    const wa = o.weights ? o.weights[a] : 1;
    const row = a * nDet;
    for (let iy = 0; iy < ny; iy++) {
      const y = ys[iy], rowI = iy * nx;
      for (let ix = 0; ix < nx; ix++) {
        const x = xs[ix];
        const xn = x * c + y * s;          // x . n
        let u, w = wa;
        if (geom.type === 'parallel') u = xn;
        else {
          const L = geom.sod + (-x * s + y * c); // (x - S) . d
          if (geom.detector === 'arc') {
            u = geom.sdd * Math.atan2(xn, L);
            if (dw) w *= 1 / (L * L + xn * xn);
          } else {
            u = (geom.sdd * xn) / L;
            if (dw) w *= (geom.sod * geom.sod) / (L * L);
          }
        }
        const f = (u - off) * inv + c0;
        if (f <= -1 || f >= nDet) continue;
        const i0 = Math.floor(f), t = f - i0;
        let v = 0;
        if (i0 >= 0) v += (1 - t) * q[row + i0];
        if (i0 + 1 < nDet) v += t * q[row + i0 + 1];
        data[rowI + ix] += w * v;
      }
    }
  }
  return img;
}

// ---------- 3D (cone beam) ----------

export function emptyVolume(d) {
  const ny = d.ny ?? d.nx, nz = d.nz ?? d.nx;
  return { nx: d.nx, ny, nz, width: d.width ?? 2, data: new Float32Array(d.nx * ny * nz) };
}
export function emptyCone(geom) {
  return { nAngles: geom.nAngles, nu: geom.nu, nv: geom.nv, data: new Float32Array(geom.nAngles * geom.nu * geom.nv) };
}

// One 3D Joseph ray. If scatter is non-zero, it adds scatter*weights and returns 0.
export function josephRay3D(vol, px, ox, oy, oz, dx, dy, dz, scatter = 0) {
  const { nx, ny, nz, data } = vol;
  const f0 = [(ox + 0.5 * nx * px) / px - 0.5, (0.5 * ny * px - oy) / px - 0.5, (oz + 0.5 * nz * px) / px - 0.5];
  const g = [dx / px, -dy / px, dz / px];
  const N = [nx, ny, nz], S = [1, nx, nx * ny];
  const ag = [Math.abs(g[0]), Math.abs(g[1]), Math.abs(g[2])];
  const m = ag[0] >= ag[1] ? (ag[0] >= ag[2] ? 0 : 2) : (ag[1] >= ag[2] ? 1 : 2);
  const p = m === 0 ? 1 : 0, q = m === 2 ? 1 : 2;
  const sp = g[p] / g[m], sq = g[q] / g[m], Np = N[p], Nq = N[q], Sp = S[p], Sq = S[q], Sm = S[m];
  const inv = 1 / ag[m];
  let acc = 0;
  const v = scatter * inv;
  for (let k = 0; k < N[m]; k++) {
    const dt = k - f0[m];
    const fp = f0[p] + dt * sp, fq = f0[q] + dt * sq;
    if (fp <= -1 || fp >= Np || fq <= -1 || fq >= Nq) continue;
    const p0 = Math.floor(fp), q0 = Math.floor(fq), wp = fp - p0, wq = fq - q0;
    const base = k * Sm;
    const ok0p = p0 >= 0, ok1p = p0 + 1 < Np, ok0q = q0 >= 0, ok1q = q0 + 1 < Nq;
    const i00 = base + p0 * Sp + q0 * Sq;
    if (scatter) {
      if (ok0p && ok0q) data[i00] += (1 - wp) * (1 - wq) * v;
      if (ok1p && ok0q) data[i00 + Sp] += wp * (1 - wq) * v;
      if (ok0p && ok1q) data[i00 + Sq] += (1 - wp) * wq * v;
      if (ok1p && ok1q) data[i00 + Sp + Sq] += wp * wq * v;
    } else {
      if (ok0p && ok0q) acc += (1 - wp) * (1 - wq) * data[i00];
      if (ok1p && ok0q) acc += wp * (1 - wq) * data[i00 + Sp];
      if (ok0p && ok1q) acc += (1 - wp) * wq * data[i00 + Sq];
      if (ok1p && ok1q) acc += wp * wq * data[i00 + Sp + Sq];
    }
  }
  return acc * inv;
}

export function forwardProjectCone(vol, geom, o = {}) {
  const proj = o.out ?? emptyCone(geom);
  const a0 = o.a0 ?? 0, a1 = o.a1 ?? geom.nAngles, px = vol.width / vol.nx;
  for (let a = a0; a < a1; a++) {
    for (let iv = 0; iv < geom.nv; iv++) {
      const row = (a * geom.nv + iv) * geom.nu;
      for (let iu = 0; iu < geom.nu; iu++) {
        rayFor3D(geom, a, iu, iv, RAY);
        proj.data[row + iu] = josephRay3D(vol, px, RAY.ox, RAY.oy, RAY.oz, RAY.dx, RAY.dy, RAY.dz);
      }
    }
  }
  return proj;
}

export function backProjectCone(proj, geom, dims, o = {}) {
  const vol = o.out ?? emptyVolume(dims);
  const a0 = o.a0 ?? 0, a1 = o.a1 ?? geom.nAngles, px = vol.width / vol.nx;
  for (let a = a0; a < a1; a++) {
    for (let iv = 0; iv < geom.nv; iv++) {
      const row = (a * geom.nv + iv) * geom.nu;
      for (let iu = 0; iu < geom.nu; iu++) {
        const val = proj.data[row + iu];
        if (val === 0) continue;
        rayFor3D(geom, a, iu, iv, RAY);
        josephRay3D(vol, px, RAY.ox, RAY.oy, RAY.oz, RAY.dx, RAY.dy, RAY.dz, val);
      }
    }
  }
  return vol;
}

// Run a generator in time slices so a page stays responsive.
export async function drive(gen, o = {}) {
  const budget = o.budgetMs ?? 12;
  const now = () => (globalThis.performance ? performance.now() : Date.now());
  let last;
  for (;;) {
    const t0 = now();
    for (;;) {
      if (o.signal && o.signal.aborted) throw new Error('aborted');
      const r = gen.next();
      if (r.done) return r.value ?? last;
      last = r.value;
      if (now() - t0 > budget) break;
    }
    if (o.onYield) o.onYield(last);
    await new Promise((res) => setTimeout(res, 0));
  }
}

