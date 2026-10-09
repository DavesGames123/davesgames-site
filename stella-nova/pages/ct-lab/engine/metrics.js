// metrics.js - image quality metrics for the CT engine.
// rmse, psnr (peak = range of the reference), ssim (Wang et al. 2004, box window).
//
// grep handles: rmse, psnr, ssim

const arr = (a) => (a && a.data ? a.data : a);

export function rmse(ref, img) {
  const a = arr(ref), b = arr(img);
  let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s / a.length);
}

function range(a) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < a.length; i++) { if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i]; }
  return hi - lo;
}

export function psnr(ref, img, peak) {
  const a = arr(ref), e = rmse(a, arr(img)), L = peak ?? range(a);
  return e === 0 ? Infinity : 20 * Math.log10(L / e);
}

// Mean SSIM over all windows of size w x w (box window, stride 1, via summed-area tables).
export function ssim(ref, img, o = {}) {
  const A = arr(ref), Bv = arr(img);
  const nx = ref.nx ?? Math.round(Math.sqrt(A.length)), ny = A.length / nx;
  const L = o.range ?? range(A), w = o.window ?? 7;
  const C1 = (0.01 * L) ** 2, C2 = (0.03 * L) ** 2;
  const W = nx + 1, sat = () => new Float64Array(W * (ny + 1));
  const Sa = sat(), Sb = sat(), Saa = sat(), Sbb = sat(), Sab = sat();
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const a = A[y * nx + x], b = Bv[y * nx + x], k = (y + 1) * W + x + 1, k1 = y * W + x + 1, k2 = (y + 1) * W + x, k3 = y * W + x;
    Sa[k] = a + Sa[k1] + Sa[k2] - Sa[k3];
    Sb[k] = b + Sb[k1] + Sb[k2] - Sb[k3];
    Saa[k] = a * a + Saa[k1] + Saa[k2] - Saa[k3];
    Sbb[k] = b * b + Sbb[k1] + Sbb[k2] - Sbb[k3];
    Sab[k] = a * b + Sab[k1] + Sab[k2] - Sab[k3];
  }
  const box = (S, x0, y0) => S[(y0 + w) * W + x0 + w] - S[y0 * W + x0 + w] - S[(y0 + w) * W + x0] + S[y0 * W + x0];
  const n = w * w;
  let sum = 0, cnt = 0;
  for (let y = 0; y + w <= ny; y++) for (let x = 0; x + w <= nx; x++) {
    const ma = box(Sa, x, y) / n, mb = box(Sb, x, y) / n;
    const va = box(Saa, x, y) / n - ma * ma, vb = box(Sbb, x, y) / n - mb * mb, cab = box(Sab, x, y) / n - ma * mb;
    sum += ((2 * ma * mb + C1) * (2 * cab + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
    cnt++;
  }
  return sum / cnt;
}
