// ============================================================================
//  SCORE  ·  five metric families for a 4D world against a reference (no DOM)
// ----------------------------------------------------------------------------
//  This module gives a submission world a score against a reference world.
//  It uses original, simplified versions of the five metric families of
//  4DCodeBench (Sec. 2.4 and App. D of the paper). The paper uses large
//  vision models and alignment steps. This module uses small CPU methods
//  that run in the browser and in Node.
//
//  Families and their metrics (each metric is 0..1, higher is better):
//    perceptual  appearance     SSIM of low-res CPU renders. A stand-in for
//                               the DINOv3 similarity of the paper.
//    dyn2d       dynamicIoU     IoU of moving-object silhouettes per frame,
//                               a thin edge band of the reference removed.
//    geom25      depth          relative disparity error of CPU depth maps.
//    geom3d      scene3d        symmetric Chamfer distance at frame 0.
//    dyn3d       trajectoryDTW  DTW of matched 3D paths (Lagrangian).
//                emdStep        sliced Wasserstein of one-step displacements
//                               (Eulerian, no correspondence).
//
//  Simplifications (the page says them too):
//    - 2D metrics render each world from its own camera on a fixed floor
//      plane y = 0, at RES x RES pixels, flat shading, one light.
//    - 3D metrics compare world coordinates directly. The page gives the
//      submission the reference camera and units, so no ICP alignment.
//    - Frames are matched by time (frame / fps), not by index.
//    - Frames and points are subsampled (see DEFAULTS) for speed.
//
//  Scale. L is the diagonal of the reference bounds over the scored frames
//  (at least 0.5 m). Distances in metres map to 0..1 as exp(-d / tau):
//    scene3d        tau = 0.05 * L   (Chamfer, metres)
//    trajectoryDTW  tau = 0.10 * L   (DTW step cost of each matched path,
//                                     metres; the metric is the mean score)
//    depth          tau = 0.10       (relative disparity error, no unit)
//  appearance, dynamicIoU and emdStep are bounded ratios and need no tau.
//  A perfect match gives distance 0 and so score 1.
//
//  EXPORTS   (grep -n "<anchor>" score.js)
//    metric text ...... "export const METRIC_INFO"
//    defaults ......... "export const DEFAULTS"
//    main entry ....... "export function scoreWorld"
//    CPU rasteriser ... "function renderInto"
//    surface samples .. "function sampleSurface"
//    Chamfer .......... "function chamfer"
//    DTW .............. "function dtw"
//    assignment ....... "function hungarian"
//    sliced W1 ........ "function slicedW1"
// ============================================================================

import { validate, storedFrames } from './world.js';

export const METRIC_INFO = {
  appearance: {
    family: 'perceptual', label: 'Appearance',
    what: 'How alike the two videos look. Both worlds are drawn small (96 px) in grey-shaded colour, and windows around the objects are compared with SSIM. This is a simple stand-in for the DINOv3 feature similarity of the paper.',
    paperName: 'DINOv3 similarity',
  },
  dynamicIoU: {
    family: 'dyn2d', label: 'Dynamic IoU',
    what: 'In each frame, the pixels covered by moving objects in the reference and in the submission: overlap divided by union, with a one-pixel edge of the reference ignored.',
    paperName: 'Dynamic IoU',
  },
  depth: {
    family: 'geom25', label: 'Depth',
    what: 'Per-pixel depth seen from the camera. The error is the relative difference in disparity (1 / depth) on pixels that show an object in either world.',
    paperName: 'Depth error',
  },
  scene3d: {
    family: 'geom3d', label: 'Scene 3D',
    what: 'Points on all surfaces at frame 0 (particle centres for grains and fluids). The mean distance from each point to the nearest point of the other world, both ways (Chamfer).',
    paperName: 'Scene 3D (Chamfer)',
  },
  trajectoryDTW: {
    family: 'dyn3d', label: 'Trajectory DTW',
    what: 'Points stuck to moving matter are followed through time. Each reference path is paired with one submission path (optimal assignment), and the paths are compared with dynamic time warping.',
    paperName: 'Trajectory DTW',
  },
  emdStep: {
    family: 'dyn3d', label: 'EMD step',
    what: 'The spread of frame-to-frame movements of moving matter, compared as unordered sets with the sliced Wasserstein distance. It checks speeds and directions, not which point is which.',
    paperName: 'EMD step',
  },
};

export const DEFAULTS = {
  res: 96,          // render size, pixels
  frames2d: 24,     // reference frames rendered for 2D metrics
  frames3d: 30,     // reference frames on each 3D path
  chamferPts: 1200, // frame-0 surface samples per world
  paths: 64,        // paths for Trajectory DTW
  stepPts: 192,     // samples for EMD step
  dirs: 24,         // projection directions for sliced Wasserstein
};

const FAMILY_OF = { perceptual: 'appearance', dyn2d: 'dynamicIoU', geom25: 'depth', geom3d: 'scene3d' };
const LIGHT = norm3([0.4, 0.9, 0.3]);
const FLOOR_RGB = [0.42, 0.42, 0.44];
const SKY_RGB = [0.06, 0.07, 0.09];
const FAR = 60;     // floor pixels farther than this show sky
const NEAR = 0.05;  // triangles with a vertex nearer than this are skipped

// ---------------------------------------------------------------------------
//  Small vector helpers
// ---------------------------------------------------------------------------
function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

// Deterministic random numbers (xorshift32). Same seed, same sequence.
function rng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// Frame of world w that shows the same time as frame k of the reference.
function frameAtTime(w, k, refFps) {
  const f = Math.round(k / refFps * w.fps);
  return Math.max(0, Math.min(w.frames - 1, f));
}
function frameList(T, n) {
  const m = Math.max(1, Math.min(T, n)), out = [];
  for (let i = 0; i < m; i++) out.push(m === 1 ? 0 : Math.round(i * (T - 1) / (m - 1)));
  return [...new Set(out)];
}
function posAt(o, f) { return storedFrames(o) === 1 ? 0 : f * o.count * 3; }

// ---------------------------------------------------------------------------
//  CPU rasteriser: triangles and point discs with a disparity buffer
// ---------------------------------------------------------------------------
function makeView(cam, res) {
  const eye = cam.eye, fw = norm3([cam.target[0] - eye[0], cam.target[1] - eye[1], cam.target[2] - eye[2]]);
  let rt = cross(fw, [0, 1, 0]);
  if (Math.hypot(rt[0], rt[1], rt[2]) < 1e-6) rt = [1, 0, 0];
  rt = norm3(rt);
  const up = cross(rt, fw);
  const F = (res / 2) / Math.tan((cam.fovY || 45) * Math.PI / 360);
  return { eye, fw, rt, up, F, res };
}

function makeTarget(res) {
  const n = res * res;
  return { disp: new Float32Array(n), id: new Int16Array(n), rgb: new Float32Array(n * 3),
    bgDisp: new Float32Array(n), bgRgb: new Float32Array(n * 3) };
}

// Floor and sky for one camera. Computed once per world.
function paintBackground(tg, v) {
  const { res, F, eye, fw, rt, up } = v;
  const fl = (0.3 + 0.7 * Math.max(0, LIGHT[1]));
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const a = (i + 0.5 - res / 2) / F, b = (res / 2 - (j + 0.5)) / F;
    const dy = fw[1] + rt[1] * a + up[1] * b;
    const p = j * res + i;
    let t = Infinity;
    if (dy < -1e-9 && eye[1] > 0) t = -eye[1] / dy;   // view depth, since d . fw = 1
    if (t < FAR) {
      tg.bgDisp[p] = 1 / t;
      const fade = 1 - 0.5 * t / FAR;
      for (let c = 0; c < 3; c++) tg.bgRgb[p * 3 + c] = FLOOR_RGB[c] * fl * fade;
    } else {
      tg.bgDisp[p] = 0;
      for (let c = 0; c < 3; c++) tg.bgRgb[p * 3 + c] = SKY_RGB[c];
    }
  }
}

// Render world w at its frame f into tg. id: object index, -1 background.
function renderInto(tg, w, f, v, scratch) {
  const { res, F, eye, fw, rt, up } = v;
  tg.disp.set(tg.bgDisp); tg.rgb.set(tg.bgRgb); tg.id.fill(-1);
  const half = res / 2;
  for (let oi = 0; oi < w.objects.length; oi++) {
    const o = w.objects[oi], base = posAt(o, f), P = o.pos, n = o.count;
    // Project every vertex once: sx, sy, view depth z.
    if (scratch.length < n * 3) scratch = new Float64Array(n * 3 * 2);
    for (let i = 0; i < n; i++) {
      const k = base + i * 3;
      const dx = P[k] - eye[0], dy = P[k + 1] - eye[1], dz = P[k + 2] - eye[2];
      const z = dx * fw[0] + dy * fw[1] + dz * fw[2];
      const x = dx * rt[0] + dy * rt[1] + dz * rt[2];
      const y = dx * up[0] + dy * up[1] + dz * up[2];
      scratch[i * 3] = half + x / z * F; scratch[i * 3 + 1] = half - y / z * F; scratch[i * 3 + 2] = z;
    }
    const col = o.color;
    if (o.kind === 'mesh') {
      const fc = o.faces;
      for (let t = 0; t < fc.length; t += 3) {
        const a = fc[t], b = fc[t + 1], c = fc[t + 2];
        const za = scratch[a * 3 + 2], zb = scratch[b * 3 + 2], zc = scratch[c * 3 + 2];
        if (za < NEAR || zb < NEAR || zc < NEAR) continue;
        const x0 = scratch[a * 3], y0 = scratch[a * 3 + 1], x1 = scratch[b * 3], y1 = scratch[b * 3 + 1], x2 = scratch[c * 3], y2 = scratch[c * 3 + 1];
        const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
        if (Math.abs(area) < 1e-9) continue;
        let minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(res - 1, Math.ceil(Math.max(x0, x1, x2)));
        let minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(res - 1, Math.ceil(Math.max(y0, y1, y2)));
        if (minX > maxX || minY > maxY) continue;
        // Flat shade from the world-space face normal, two-sided.
        const ka = base + a * 3, kb = base + b * 3, kc = base + c * 3;
        const ux = P[kb] - P[ka], uy = P[kb + 1] - P[ka + 1], uz = P[kb + 2] - P[ka + 2];
        const vx = P[kc] - P[ka], vy = P[kc + 1] - P[ka + 1], vz = P[kc + 2] - P[ka + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        const sh = 0.3 + 0.7 * Math.abs((nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / nl);
        const wa = 1 / za, wb = 1 / zb, wc = 1 / zc, inv = 1 / area;
        for (let py = minY; py <= maxY; py++) {
          const cy = py + 0.5;
          for (let px = minX; px <= maxX; px++) {
            const cx = px + 0.5;
            const l0 = ((x1 - cx) * (y2 - cy) - (x2 - cx) * (y1 - cy)) * inv;
            const l1 = ((x2 - cx) * (y0 - cy) - (x0 - cx) * (y2 - cy)) * inv;
            const l2 = 1 - l0 - l1;
            if (l0 < 0 || l1 < 0 || l2 < 0) continue;
            const d = l0 * wa + l1 * wb + l2 * wc, p = py * res + px;
            if (d <= tg.disp[p]) continue;
            tg.disp[p] = d; tg.id[p] = oi;
            tg.rgb[p * 3] = col[0] * sh; tg.rgb[p * 3 + 1] = col[1] * sh; tg.rgb[p * 3 + 2] = col[2] * sh;
          }
        }
      }
    } else {
      const r = o.radius;
      for (let i = 0; i < n; i++) {
        const z = scratch[i * 3 + 2];
        if (z < NEAR + r) continue;
        const sx = scratch[i * 3], sy = scratch[i * 3 + 1], rp = r * F / z;
        if (rp < 0.71) {   // Smaller than a pixel: cover the nearest pixel.
          const px = Math.floor(sx), py = Math.floor(sy);
          if (px < 0 || py < 0 || px >= res || py >= res) continue;
          const p = py * res + px, d = 1 / (z - r);
          if (d <= tg.disp[p]) continue;
          const sh = 0.3 + 0.7 * Math.max(0, -(fw[0] * LIGHT[0] + fw[1] * LIGHT[1] + fw[2] * LIGHT[2]));
          tg.disp[p] = d; tg.id[p] = oi;
          tg.rgb[p * 3] = col[0] * sh; tg.rgb[p * 3 + 1] = col[1] * sh; tg.rgb[p * 3 + 2] = col[2] * sh;
          continue;
        }
        const minX = Math.max(0, Math.floor(sx - rp)), maxX = Math.min(res - 1, Math.ceil(sx + rp));
        const minY = Math.max(0, Math.floor(sy - rp)), maxY = Math.min(res - 1, Math.ceil(sy + rp));
        for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
          const ex = (px + 0.5 - sx) / rp, ey = (py + 0.5 - sy) / rp, q = ex * ex + ey * ey;
          if (q > 1) continue;
          const nz = Math.sqrt(1 - q), p = py * res + px, d = 1 / (z - r * nz);
          if (d <= tg.disp[p]) continue;
          // Sphere normal in world space: right * ex + up * (-ey) - forward * nz.
          const wx = rt[0] * ex - up[0] * ey - fw[0] * nz, wy = rt[1] * ex - up[1] * ey - fw[1] * nz, wz = rt[2] * ex - up[2] * ey - fw[2] * nz;
          const sh = 0.3 + 0.7 * Math.max(0, wx * LIGHT[0] + wy * LIGHT[1] + wz * LIGHT[2]);
          tg.disp[p] = d; tg.id[p] = oi;
          tg.rgb[p * 3] = col[0] * sh; tg.rgb[p * 3 + 1] = col[1] * sh; tg.rgb[p * 3 + 2] = col[2] * sh;
        }
      }
    }
  }
  return scratch;
}

// ---------------------------------------------------------------------------
//  2D metrics on one pair of renders
// ---------------------------------------------------------------------------
// SSIM over 8 x 8 windows (stride 4) that hold an object pixel in either
// render, mean of the three colour channels. Returns { sum, n }.
function ssimFrame(A, B, res) {
  const C1 = 0.01 * 0.01, C2 = 0.03 * 0.03, W = 8, S = 4;
  let sum = 0, cnt = 0;
  for (let y0 = 0; y0 + W <= res; y0 += S) for (let x0 = 0; x0 + W <= res; x0 += S) {
    let has = false;
    for (let y = y0; y < y0 + W && !has; y++) for (let x = x0; x < x0 + W; x++) {
      const p = y * res + x;
      if (A.id[p] >= 0 || B.id[p] >= 0) { has = true; break; }
    }
    if (!has) continue;
    let s3 = 0;
    for (let c = 0; c < 3; c++) {
      let ma = 0, mb = 0, va = 0, vb = 0, cv = 0;
      for (let y = y0; y < y0 + W; y++) for (let x = x0; x < x0 + W; x++) {
        const p = (y * res + x) * 3 + c; ma += A.rgb[p]; mb += B.rgb[p];
      }
      ma /= W * W; mb /= W * W;
      for (let y = y0; y < y0 + W; y++) for (let x = x0; x < x0 + W; x++) {
        const p = (y * res + x) * 3 + c, da = A.rgb[p] - ma, db = B.rgb[p] - mb;
        va += da * da; vb += db * db; cv += da * db;
      }
      const n1 = W * W - 1; va /= n1; vb /= n1; cv /= n1;
      s3 += ((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
    }
    sum += s3 / 3; cnt++;
  }
  return { sum, n: cnt };
}

// Dynamic IoU of one frame. Returns { iou, valid }.
function iouFrame(A, B, dynA, dynB, res) {
  let inter = 0, uni = 0;
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const p = y * res + x;
    const a = A.id[p] >= 0 && dynA[A.id[p]], b = B.id[p] >= 0 && dynB[B.id[p]];
    if (!a && !b) continue;
    if (a) {   // Skip the inner edge of the reference mask.
      let edge = false;
      if (x === 0 || y === 0 || x === res - 1 || y === res - 1) edge = true;
      else for (const q of [p - 1, p + 1, p - res, p + res]) { const iq = A.id[q]; if (!(iq >= 0 && dynA[iq])) { edge = true; break; } }
      if (edge) continue;
    }
    uni++; if (a && b) inter++;
  }
  return uni ? { iou: inter / uni, valid: true } : { iou: 1, valid: false };
}

// Relative disparity error on pixels with an object in either render.
function depthFrame(A, B, res) {
  let s = 0, n = 0;
  for (let p = 0; p < res * res; p++) {
    if (A.id[p] < 0 && B.id[p] < 0) continue;
    const a = A.disp[p], b = B.disp[p], m = Math.max(a, b);
    s += m > 0 ? Math.abs(a - b) / m : 0; n++;
  }
  return { sum: s, n };
}

// ---------------------------------------------------------------------------
//  3D samples
// ---------------------------------------------------------------------------
// Draw n samples on the surfaces of the chosen objects at frame 0, area
// weighted. A sample is a face with barycentric weights (mesh) or one
// particle (points). The same world always gives the same samples.
function sampleSurface(w, objIdx, n, seed) {
  const R = rng(seed), items = [];
  let total = 0;
  for (const oi of objIdx) {
    const o = w.objects[oi], P = o.pos;
    if (o.kind === 'mesh') {
      const fc = o.faces, cum = new Float64Array(fc.length / 3);
      let acc = 0;
      for (let t = 0; t < fc.length; t += 3) {
        const a = fc[t] * 3, b = fc[t + 1] * 3, c = fc[t + 2] * 3;
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
        const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        acc += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
        cum[t / 3] = acc;
      }
      if (acc > 0) { items.push({ oi, cum, area: acc }); total += acc; }
    } else {
      const area = o.count * Math.PI * o.radius * o.radius;
      if (area > 0) { items.push({ oi, cum: null, area }); total += area; }
    }
  }
  const out = [];
  if (!(total > 0)) return out;
  for (let s = 0; s < n; s++) {
    let u = R() * total, it = items[items.length - 1];
    for (const c of items) { if (u < c.area) { it = c; break; } u -= c.area; }
    const o = w.objects[it.oi];
    if (!it.cum) { out.push({ oi: it.oi, i: Math.min(o.count - 1, Math.floor(R() * o.count)) }); continue; }
    const q = R() * it.area;
    let lo = 0, hi = it.cum.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (it.cum[m] < q) lo = m + 1; else hi = m; }
    const r1 = Math.sqrt(R()), r2 = R();
    out.push({ oi: it.oi, a: o.faces[lo * 3], b: o.faces[lo * 3 + 1], c: o.faces[lo * 3 + 2], wa: 1 - r1, wb: r1 * (1 - r2), wc: r1 * r2 });
  }
  return out;
}

// Position of sample s of world w at frame f, written to out at offset k.
function samplePos(w, s, f, out, k) {
  const o = w.objects[s.oi], P = o.pos, base = posAt(o, f);
  if (s.i !== undefined) { const j = base + s.i * 3; out[k] = P[j]; out[k + 1] = P[j + 1]; out[k + 2] = P[j + 2]; return; }
  const a = base + s.a * 3, b = base + s.b * 3, c = base + s.c * 3;
  for (let d = 0; d < 3; d++) out[k + d] = s.wa * P[a + d] + s.wb * P[b + d] + s.wc * P[c + d];
}

// Objects that move: the dynamic flag. With no dynamic object, use all.
function movingObjects(w) {
  const dyn = [];
  w.objects.forEach((o, i) => { if (o.dynamic) dyn.push(i); });
  return dyn.length ? dyn : w.objects.map((_, i) => i);
}

// Symmetric Chamfer distance (mean of the two one-way means), metres.
function chamfer(A, B) {
  const one = (X, Y) => {
    let s = 0;
    for (let i = 0; i < X.length; i += 3) {
      let best = Infinity;
      for (let j = 0; j < Y.length; j += 3) {
        const dx = X[i] - Y[j], dy = X[i + 1] - Y[j + 1], dz = X[i + 2] - Y[j + 2], d = dx * dx + dy * dy + dz * dz;
        if (d < best) best = d;
      }
      s += Math.sqrt(best);
    }
    return s / (X.length / 3);
  };
  if (!A.length || !B.length) return Infinity;
  return 0.5 * (one(A, B) + one(B, A));
}

// DTW of two 3D paths (F points each, flat arrays at offsets), divided by F.
function dtw(A, ao, B, bo, F, row0, row1) {
  for (let j = 0; j <= F; j++) row0[j] = Infinity;
  row0[0] = 0;
  for (let i = 1; i <= F; i++) {
    row1[0] = Infinity;
    const ai = ao + (i - 1) * 3;
    for (let j = 1; j <= F; j++) {
      const bj = bo + (j - 1) * 3;
      const d = Math.hypot(A[ai] - B[bj], A[ai + 1] - B[bj + 1], A[ai + 2] - B[bj + 2]);
      const m = Math.min(row0[j], row0[j - 1], row1[j - 1]);
      row1[j] = d + m;
    }
    for (let j = 0; j <= F; j++) row0[j] = row1[j];
  }
  return row0[F] / F;
}

// Minimum-cost one-to-one assignment on an n x n cost matrix (shortest
// augmenting paths with row and column potentials). Returns col: col[i]
// is the column given to row i.
function hungarian(C, n) {
  const u = new Float64Array(n + 1), v = new Float64Array(n + 1);
  const match = new Int32Array(n + 1), way = new Int32Array(n + 1);
  const minv = new Float64Array(n + 1), used = new Uint8Array(n + 1);
  for (let i = 1; i <= n; i++) {
    match[0] = i; let j0 = 0;
    minv.fill(Infinity); used.fill(0);
    do {
      used[j0] = 1;
      const i0 = match[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = C[(i0 - 1) * n + (j - 1)] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[match[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (match[j0] !== 0);
    do { const j1 = way[j0]; match[j0] = match[j1]; j0 = j1; } while (j0);
  }
  const col = new Int32Array(n);
  for (let j = 1; j <= n; j++) col[match[j] - 1] = j - 1;
  return col;
}

// Fixed, evenly spread unit directions (golden-angle spiral).
function directions(m) {
  const out = [], g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < m; i++) {
    const y = 1 - 2 * (i + 0.5) / m, r = Math.sqrt(1 - y * y), a = i * g;
    out.push([r * Math.cos(a), y, r * Math.sin(a)]);
  }
  return out;
}

// Sliced W1 between two equal-size sets of 3D vectors. Also returns the
// sliced W1 of each set against zero (its mean projected size), so that
// sw <= mA + mB always holds (triangle inequality).
function slicedW1(U, V, n, dirs, pa, pb) {
  let sw = 0, mA = 0, mB = 0;
  for (const d of dirs) {
    for (let i = 0; i < n; i++) {
      pa[i] = U[i * 3] * d[0] + U[i * 3 + 1] * d[1] + U[i * 3 + 2] * d[2];
      pb[i] = V[i * 3] * d[0] + V[i * 3 + 1] * d[1] + V[i * 3 + 2] * d[2];
    }
    pa.subarray(0, n).sort(); pb.subarray(0, n).sort();
    for (let i = 0; i < n; i++) { sw += Math.abs(pa[i] - pb[i]); mA += Math.abs(pa[i]); mB += Math.abs(pb[i]); }
  }
  const k = dirs.length * n;
  return { sw: sw / k, mA: mA / k, mB: mB / k };
}

// Reference scale L: diagonal of the bounds over the given frames.
function sceneScale(w, frames) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const o of w.objects) {
    const step = Math.max(1, Math.floor(o.count / 400));
    const fs = storedFrames(o) === 1 ? [0] : frames;
    for (const f of fs) for (let i = 0; i < o.count; i += step) {
      const k = posAt(o, f) + i * 3;
      for (let a = 0; a < 3; a++) { const x = o.pos[k + a]; if (x < mn[a]) mn[a] = x; if (x > mx[a]) mx[a] = x; }
    }
  }
  const d = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
  return Math.max(0.5, Number.isFinite(d) ? d : 0.5);
}

function now() { return (globalThis.performance && performance.now) ? performance.now() : Date.now(); }

// ---------------------------------------------------------------------------
//  Main entry
// ---------------------------------------------------------------------------
export function scoreWorld(ref, sub, opts = {}) {
  const t0 = now();
  const o = { ...DEFAULTS, ...opts };
  const rv = validate(ref);
  if (!rv.ok) throw new Error('reference world is not valid: ' + rv.errors[0]);
  const sv = validate(sub);
  if (!sv.ok) {   // Like the paper: a failed run gets the worst value.
    const z = { perceptual: 0, dyn2d: 0, geom25: 0, geom3d: 0, dyn3d: 0 };
    return { families: z, overall: 0,
      metrics: { appearance: 0, dynamicIoU: 0, depth: 0, scene3d: 0, trajectoryDTW: 0, emdStep: 0 },
      raw: { invalid: sv.errors }, ms: now() - t0 };
  }
  const raw = {};
  const f3 = frameList(ref.frames, o.frames3d);
  const L = sceneScale(ref, f3);
  raw.scale = L;

  // 2D and 2.5D: render both worlds from their own cameras.
  const res = o.res, vR = makeView(ref.camera, res), vS = makeView(sub.camera, res);
  const A = makeTarget(res), B = makeTarget(res);
  paintBackground(A, vR); paintBackground(B, vS);
  const dynA = ref.objects.map(x => !!x.dynamic), dynB = sub.objects.map(x => !!x.dynamic);
  let scratch = new Float64Array(3 * 1024);
  let ssS = 0, ssN = 0, iouS = 0, iouN = 0, dS = 0, dN = 0;
  for (const k of frameList(ref.frames, o.frames2d)) {
    scratch = renderInto(A, ref, k, vR, scratch);
    scratch = renderInto(B, sub, frameAtTime(sub, k, ref.fps), vS, scratch);
    const s = ssimFrame(A, B, res); ssS += s.sum; ssN += s.n;
    const q = iouFrame(A, B, dynA, dynB, res); if (q.valid) { iouS += q.iou; iouN++; }
    const d = depthFrame(A, B, res); if (d.n) { dS += d.sum / d.n; dN++; }
  }
  raw.ssim = ssN ? ssS / ssN : 1;
  raw.dynamicIoU = iouN ? iouS / iouN : 1;
  raw.depthRelErr = dN ? dS / dN : 0;
  const appearance = Math.max(0, Math.min(1, raw.ssim));
  const dynamicIoU = raw.dynamicIoU;
  const depth = Math.exp(-raw.depthRelErr / 0.1);

  // 3D geometry at frame 0.
  const allR = ref.objects.map((_, i) => i), allS = sub.objects.map((_, i) => i);
  const cloud = (w, idx, f) => {
    const ss = sampleSurface(w, idx, o.chamferPts, 1234567), out = new Float64Array(ss.length * 3);
    ss.forEach((s, i) => samplePos(w, s, f, out, i * 3));
    return out;
  };
  raw.chamfer = chamfer(cloud(ref, allR, 0), cloud(sub, allS, frameAtTime(sub, 0, ref.fps)));
  const scene3d = Number.isFinite(raw.chamfer) ? Math.exp(-raw.chamfer / (0.05 * L)) : 0;

  // 3D dynamics: paths of samples on moving matter.
  const nS = o.stepPts, nP = Math.min(o.paths, nS), F = f3.length;
  const smR = sampleSurface(ref, movingObjects(ref), nS, 7654321);
  const smS = sampleSurface(sub, movingObjects(sub), nS, 7654321);
  let trajectoryDTW = 0, emdStep = 0;
  if (smR.length && smS.length) {
    const pR = new Float64Array(nS * F * 3), pS = new Float64Array(nS * F * 3);
    for (let i = 0; i < nS; i++) for (let fi = 0; fi < F; fi++) {
      samplePos(ref, smR[i], f3[fi], pR, (i * F + fi) * 3);
      samplePos(sub, smS[i], frameAtTime(sub, f3[fi], ref.fps), pS, (i * F + fi) * 3);
    }
    const C = new Float64Array(nP * nP), r0 = new Float64Array(F + 1), r1 = new Float64Array(F + 1);
    for (let i = 0; i < nP; i++) for (let j = 0; j < nP; j++) C[i * nP + j] = dtw(pR, i * F * 3, pS, j * F * 3, F, r0, r1);
    const col = hungarian(C, nP), tau = 0.1 * L;
    // Score each matched pair, then take the mean. A lost path costs at
    // most 1 / nP of the metric, like the cap of the paper.
    let dSum = 0, sSum = 0;
    for (let i = 0; i < nP; i++) { const d = C[i * nP + col[i]]; dSum += d; sSum += Math.exp(-d / tau); }
    raw.trajectoryDTW = dSum / nP;
    trajectoryDTW = sSum / nP;

    // One-step displacements at each scored frame (reference frame units).
    const dirs = directions(o.dirs), U = new Float64Array(nS * 3), V = new Float64Array(nS * 3);
    const pa = new Float64Array(nS), pb = new Float64Array(nS), a = new Float64Array(3), b = new Float64Array(3);
    const rate = ref.fps / sub.fps;
    let swS = 0, mS = 0;
    for (const k of f3) {
      if (k >= ref.frames - 1) continue;
      const fs = frameAtTime(sub, k, ref.fps), fs1 = Math.min(sub.frames - 1, fs + 1);
      for (let i = 0; i < nS; i++) {
        samplePos(ref, smR[i], k, a, 0); samplePos(ref, smR[i], k + 1, b, 0);
        U[i * 3] = b[0] - a[0]; U[i * 3 + 1] = b[1] - a[1]; U[i * 3 + 2] = b[2] - a[2];
        samplePos(sub, smS[i], fs, a, 0); samplePos(sub, smS[i], fs1, b, 0);
        const sc = fs1 > fs ? rate : 0;
        V[i * 3] = (b[0] - a[0]) * sc; V[i * 3 + 1] = (b[1] - a[1]) * sc; V[i * 3 + 2] = (b[2] - a[2]) * sc;
      }
      const r = slicedW1(U, V, nS, dirs, pa, pb);
      swS += r.sw; mS += r.mA + r.mB;
    }
    raw.emdRatio = mS > 1e-12 ? swS / mS : 0;
    emdStep = Math.max(0, 1 - raw.emdRatio);
  } else {
    raw.trajectoryDTW = Infinity; raw.emdRatio = 1;
  }

  const metrics = { appearance, dynamicIoU, depth, scene3d, trajectoryDTW, emdStep };
  const families = {};
  for (const [fam, key] of Object.entries(FAMILY_OF)) families[fam] = metrics[key];
  families.dyn3d = 0.5 * (trajectoryDTW + emdStep);
  const overall = (families.perceptual + families.dyn2d + families.geom25 + families.geom3d + families.dyn3d) / 5;
  return { families, overall, metrics, raw, ms: now() - t0 };
}
