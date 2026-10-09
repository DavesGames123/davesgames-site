// lab/scanner.js - the CT lab scan session: phantom, geometry, simulated scan, MAR,
// and the reconstruction that grows as views arrive. No DOM. node tests drive it.
//
// A session holds the whole measured sinogram from the start (the simulation is fast).
// The page reveals it view by view: advance(k) back-projects the next k views, so the
// reconstruction builds up in gantry order. FBP adds filtered views. The iterative
// algorithms show the plain (unfiltered) back-projection during the scan; the solvers
// run after it, in lab/jobs.js.
//
// grep handles:
//   buildPhantom, buildGeometry, deadPixelList, simulate, metalReduce, pasteMetal, Session,
//   cpuForward, fbpWeights, imageRange

import {
  phantom2D, rasterize2D, fitGeometry, forwardProject, filterSinogram, fbpBackProject,
  angleWeights, coverage, spectrum, polychromaticSinogram, transmit, poissonNoise,
  toLineIntegral, detectorDefects, psnr, ssim, emptyImage, muAt,
} from '../engine/index.js';

const DEG = Math.PI / 180;

// phantom: { image, basis, meta, shapes }. custom: { shapes, width } or { image, basis, width }.
export function buildPhantom(params, custom) {
  const n = params.n;
  if (params.phantom === 'custom') {
    const c = custom ?? { shapes: [], width: 20 };
    if (c.image) return { image: c.image, basis: c.basis, shapes: null, meta: { key: 'custom', label: 'Your picture', width: c.width, units: '1/cm at 70 keV' } };
    const r = rasterize2D(c.shapes, n, c.width);
    return { ...r, shapes: c.shapes, meta: { key: 'custom', label: 'Your phantom', width: c.width, units: '1/cm at 70 keV' } };
  }
  return phantom2D(params.phantom, n);
}

export function buildGeometry(params, image) {
  const kind = params.beam === 'fan-arc' ? 'fan-arc' : params.beam === 'fan-flat' ? 'fan' : 'parallel';
  const o = { nAngles: Math.max(1, params.views | 0), arc: params.arc * DEG };
  if (params.detectors > 0) o.nDet = params.detectors | 1;
  return fitGeometry(kind, image, o);
}

// Dead elements: fixed offsets from the centre, so a ring sits at a known radius.
const DEAD_OFFSETS = [0.11, -0.23, 0.31, -0.06, 0.19, -0.37, 0.27, -0.15];
export function deadPixelList(nDet, count) {
  const out = [];
  for (let k = 0; k < Math.min(count, DEAD_OFFSETS.length); k++) out.push(Math.round((nDet - 1) / 2 + DEAD_OFFSETS[k] * nDet));
  return out;
}

export async function cpuForward(image, geom) { return forwardProject(image, geom); }

// Simulated acquisition. forward(image, geom) -> Promise<Sinogram> (GPU or CPU).
// Motion needs the CPU projector (per-view shift).
export async function simulate(phantom, geom, params, forward = cpuForward) {
  let fwd = forward;
  let motionFn = null;
  if (params.motion > 0) {
    const amp = params.motion, n = geom.nAngles;
    motionFn = (a) => ({ dx: amp * Math.sin((2 * Math.PI * a) / n), dy: 0.35 * amp * Math.sin((4 * Math.PI * a) / n) });
    fwd = async (img, g) => forwardProject(img, g, { motion: motionFn });
  }
  let sino, spec = null;
  if (params.poly) {
    spec = spectrum(params.kVp);
    const bs = {};
    for (const k of ['water', 'bone', 'iron']) bs[k] = await fwd(phantom.basis[k], geom);
    sino = polychromaticSinogram(bs, spec);
    // First-order water calibration, as scanners do: scale so that a water path of 40% of
    // the field reads its 70 keV value. Cupping and metal streaks stay (they are not linear).
    const L = 0.4 * phantom.image.width;
    let I = 0; for (let e = 0; e < spec.keV.length; e++) I += spec.w[e] * Math.exp(-muAt('water', spec.keV[e]) * L);
    const cal = (muAt('water', 70) * L) / -Math.log(I);
    for (let i = 0; i < sino.data.length; i++) sino.data[i] *= cal;
    spec.calibration = cal;
  } else {
    sino = await fwd(phantom.image, geom);
  }
  sino = { nAngles: geom.nAngles, nDet: geom.nDet, data: sino.data };
  const clean = { ...sino, data: Float32Array.from(sino.data) };
  if (params.dose > 0) {
    const counts = transmit(sino, { I0: params.dose });
    poissonNoise(counts, { seed: params.seed });
    sino = toLineIntegral(counts, { I0: params.dose });
    sino = { nAngles: geom.nAngles, nDet: geom.nDet, data: sino.data };
  }
  const dead = deadPixelList(geom.nDet, params.deadPixels | 0);
  if (params.gain > 0 || dead.length) detectorDefects(sino, { gainSigma: params.gain, dead, seed: params.seed + 4 });
  return { sino, clean, spectrum: spec, dead, motion: motionFn };
}

export function fbpWeights(geom) {
  const w = angleWeights(geom);
  if (geom.type === 'parallel' && coverage(geom) > 1.5 * Math.PI) for (let k = 0; k < w.length; k++) w[k] *= 0.5;
  return w;
}

export function imageRange(img) {
  let lo = Infinity, hi = -Infinity;
  const d = img.data ?? img;
  for (let i = 0; i < d.length; i++) { const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  return { lo, hi };
}

// Metal artefact reduction by sinogram inpainting (linear interpolation across the metal
// trace in every view), after Kalender, Hebel and Ebersberger (1987).
// recon: a first FBP image. Returns { sino, trace, mask, threshold }.
export function metalReduce(sino, geom, recon, o = {}) {
  const thr = o.threshold ?? 1.6;              // 1/cm: above dense bone (0.5) and well below steel (6.5)
  const mask = emptyImage(recon);
  let any = 0;
  for (let j = 0; j < recon.data.length; j++) if (recon.data[j] > thr) { mask.data[j] = 1; any++; }
  if (!any) return { sino, trace: null, mask, threshold: thr, metal: 0 };
  // grow the mask by one pixel so the trace covers the blurred metal edge
  const { nx, ny } = mask, grown = Float32Array.from(mask.data);
  for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
    const k = y * nx + x;
    if (mask.data[k] || mask.data[k - 1] || mask.data[k + 1] || mask.data[k - nx] || mask.data[k + nx]) grown[k] = 1;
  }
  mask.data.set(grown);
  const trace = forwardProject(mask, geom);
  const n = geom.nDet, out = Float32Array.from(sino.data);
  const px = recon.width / recon.nx;
  for (let a = 0; a < geom.nAngles; a++) {
    const row = a * n;
    let i = 0;
    while (i < n) {
      if (trace.data[row + i] <= 0.25 * px) { i++; continue; }
      let j = i;
      while (j < n && trace.data[row + j] > 0.25 * px) j++;
      const left = i > 0 ? out[row + i - 1] : (j < n ? out[row + j] : 0);
      const right = j < n ? out[row + j] : left;
      for (let k = i; k < j; k++) {
        const t = (k - i + 1) / (j - i + 1);
        out[row + k] = left + t * (right - left);
      }
      i = j;
    }
  }
  return { sino: { ...sino, data: out }, trace, mask, threshold: thr, metal: any };
}

// Final MAR image: the reconstruction of the inpainted sinogram, with the metal pixels of
// the first reconstruction put back. Works in place on corrected.
export function pasteMetal(corrected, first, mask) {
  for (let j = 0; j < mask.data.length; j++) if (mask.data[j]) corrected.data[j] = first.data[j];
  return corrected;
}

// One scan session. opts: { phantom, geom, scan (simulate result), params }.
export class Session {
  constructor({ phantom, geom, scan, params }) {
    this.phantom = phantom;
    this.truth = phantom.image;
    this.geom = geom;
    this.params = params;
    this.raw = scan.sino;            // measured line integrals
    this.sino = scan.sino;           // the sinogram the reconstruction uses (MAR may replace it)
    this.scan = scan;
    this.dims = { nx: phantom.image.nx, ny: phantom.image.ny, width: phantom.image.width };
    this.view = 0;
    this.weights = fbpWeights(geom);
    this.recon = emptyImage(this.dims);
    this.prepare();
  }

  get views() { return this.geom.nAngles; }
  get done() { return this.view >= this.geom.nAngles; }

  // Filter (FBP) or keep the raw sinogram (plain back-projection preview for iterative runs).
  prepare() {
    const p = this.params;
    this.q = p.algo === 'fbp' ? filterSinogram(this.sino, this.geom, { filter: p.filter, cutoff: p.cutoff }) : this.sino;
    this.preview = p.algo !== 'fbp';
  }

  reset() { this.view = 0; this.recon.data.fill(0); }

  // Back-project the next k views into the running reconstruction. Returns the new view count.
  advance(k = 1) {
    const a0 = this.view, a1 = Math.min(this.geom.nAngles, a0 + Math.max(0, k | 0));
    if (a1 > a0) fbpBackProject(this.q, this.geom, this.dims, { out: this.recon, a0, a1, weights: this.weights });
    this.view = a1;
    return a1;
  }

  // The full FBP of the current sinogram (CPU). The page may use the GPU instead.
  fullFBP() {
    this.recon.data.fill(0);
    fbpBackProject(this.q, this.geom, this.dims, { out: this.recon, weights: this.weights });
    this.view = this.geom.nAngles;
    return this.recon;
  }

  angle() {
    const a = Math.min(this.geom.nAngles - 1, Math.max(0, this.view - 1));
    return this.geom.angles[a];
  }

  metrics(img = this.recon) {
    return { psnr: psnr(this.truth, img), ssim: ssim(this.truth, img) };
  }
}
