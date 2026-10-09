// ============================================================================
//  SCIENCE TOOLKIT  ·  core/signal.js  ·  FFT, interpolation, smoothing
// ----------------------------------------------------------------------------
//  fft()       radix-2 Cooley–Tukey for a power-of-two length; Bluestein's
//              chirp-z transform for any other length, so the DFT is exact
//              for every N (no silent zero padding)
//  spectrum()  one-sided amplitude spectrum with an optional Hann window
//              (amplitude corrected by the coherent gain 0.5) and peaks
//              refined by parabolic interpolation of the log magnitude
//  spline()    natural cubic spline (second derivative 0 at both ends)
//  linear()    piecewise linear interpolation
//  movingAvg() centred moving average (the window shrinks at the edges)
//  savgol()    Savitzky–Golay smoothing; the edges use a polynomial fitted
//              to the first or last window, as SciPy's mode="interp"
//
//  GREP MAP
//    grep -n "export function fft"
//    grep -n "export function spectrum"
//    grep -n "export function spline"
//    grep -n "export function savgol"
// ============================================================================
import { lstsq } from './linalg.js';

function fft2(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const a = i + k, b = a + len / 2;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// DFT X_k = Σ x_n e^{−2πi kn/N} of real or complex input.
export function fft(xr, xi = null) {
  const n = xr.length;
  const re = Float64Array.from(xr), im = xi ? Float64Array.from(xi) : new Float64Array(n);
  if (n <= 1) return { re, im };
  if ((n & (n - 1)) === 0) { fft2(re, im); return { re, im }; }
  // Bluestein: chirp w_k = e^{−πi k²/N}.
  let m = 1;
  while (m < 2 * n - 1) m <<= 1;
  const cr = new Float64Array(n), ci = new Float64Array(n);
  for (let k = 0; k < n; k++) { const a = Math.PI * ((k * k) % (2 * n)) / n; cr[k] = Math.cos(a); ci[k] = -Math.sin(a); }
  const ar = new Float64Array(m), ai = new Float64Array(m), br = new Float64Array(m), bi = new Float64Array(m);
  for (let k = 0; k < n; k++) { ar[k] = re[k] * cr[k] - im[k] * ci[k]; ai[k] = re[k] * ci[k] + im[k] * cr[k]; }
  br[0] = cr[0]; bi[0] = -ci[0];
  for (let k = 1; k < n; k++) { br[k] = br[m - k] = cr[k]; bi[k] = bi[m - k] = -ci[k]; }
  fft2(ar, ai); fft2(br, bi);
  for (let k = 0; k < m; k++) { const r = ar[k] * br[k] - ai[k] * bi[k], i = ar[k] * bi[k] + ai[k] * br[k]; ar[k] = r; ai[k] = i; }
  fft2(ar, ai, true);
  for (let k = 0; k < n; k++) { re[k] = ar[k] * cr[k] - ai[k] * ci[k]; im[k] = ar[k] * ci[k] + ai[k] * cr[k]; }
  return { re, im };
}

export function spectrum(x, fs = 1, { window = 'none', detrend = true } = {}) {
  const n = x.length;
  if (n < 4) throw new Error('Enter at least 4 samples.');
  const mean = x.reduce((a, b) => a + b, 0) / n;
  const w = window === 'hann' ? x.map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n)) : x.map(() => 1);
  const cg = w.reduce((a, b) => a + b, 0) / n;
  const y = x.map((v, i) => (detrend ? v - mean : v) * w[i]);
  const { re, im } = fft(y);
  const half = Math.floor(n / 2);
  const f = [], amp = [];
  for (let k = 0; k <= half; k++) {
    const mag = Math.hypot(re[k], im[k]) / (n * cg);
    f.push(k * fs / n);
    amp.push(k === 0 || (n % 2 === 0 && k === half) ? mag : 2 * mag);
  }
  // Peaks: local maxima, parabolic interpolation on log magnitude.
  const peaks = [];
  for (let k = 1; k < amp.length - 1; k++) {
    if (amp[k] > amp[k - 1] && amp[k] >= amp[k + 1] && amp[k] > 1e-12 * Math.max(...amp)) {
      const a = Math.log(amp[k - 1] || 1e-300), b = Math.log(amp[k]), c = Math.log(amp[k + 1] || 1e-300);
      const d = a - 2 * b + c;
      // A tone on a bin has near-zero neighbours: no interpolation then.
      const flat = Math.min(amp[k - 1], amp[k + 1]) < 1e-9 * amp[k];
      const p = d !== 0 && !flat ? 0.5 * (a - c) / d : 0;
      peaks.push({ f: (k + p) * fs / n, amp: Math.exp(b - 0.25 * (a - c) * p), bin: k });
    }
  }
  peaks.sort((u, v) => v.amp - u.amp);
  return { f, amp, peaks, mean, df: fs / n, re, im };
}

export function linear(x, y, t) {
  if (t <= x[0]) return y[0] + (y[1] - y[0]) * (t - x[0]) / (x[1] - x[0]);
  let i = 1;
  while (i < x.length - 1 && x[i] < t) i++;
  return y[i - 1] + (y[i] - y[i - 1]) * (t - x[i - 1]) / (x[i] - x[i - 1]);
}

// Natural cubic spline. Returns an evaluator.
export function spline(x, y) {
  const n = x.length;
  if (n < 3) throw new Error('A cubic spline needs at least 3 points.');
  for (let i = 1; i < n; i++) if (!(x[i] > x[i - 1])) throw new Error('x must increase strictly for interpolation.');
  const h = x.slice(1).map((v, i) => v - x[i]);
  const a = new Float64Array(n), b = new Float64Array(n), c = new Float64Array(n), d = new Float64Array(n);
  b[0] = 1; b[n - 1] = 1;
  for (let i = 1; i < n - 1; i++) { a[i] = h[i - 1]; b[i] = 2 * (h[i - 1] + h[i]); c[i] = h[i]; d[i] = 6 * ((y[i + 1] - y[i]) / h[i] - (y[i] - y[i - 1]) / h[i - 1]); }
  // Thomas algorithm for the second derivatives M.
  for (let i = 1; i < n; i++) { const m = a[i] / b[i - 1]; b[i] -= m * c[i - 1]; d[i] -= m * d[i - 1]; }
  const M = new Float64Array(n);
  M[n - 1] = d[n - 1] / b[n - 1];
  for (let i = n - 2; i >= 0; i--) M[i] = (d[i] - c[i] * M[i + 1]) / b[i];
  return (t) => {
    let i = 0;
    if (t >= x[n - 1]) i = n - 2;
    else if (t > x[0]) { let lo = 0, hi = n - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (x[mid] <= t) lo = mid; else hi = mid; } i = lo; }
    const hi = h[i], A = (x[i + 1] - t) / hi, B = (t - x[i]) / hi;
    return A * y[i] + B * y[i + 1] + ((A ** 3 - A) * M[i] + (B ** 3 - B) * M[i + 1]) * hi * hi / 6;
  };
}

export function movingAvg(y, w) {
  const h = Math.floor(w / 2);
  return y.map((_, i) => { const a = Math.max(0, i - h), b = Math.min(y.length - 1, i + h); let s = 0; for (let k = a; k <= b; k++) s += y[k]; return s / (b - a + 1); });
}

// Savitzky–Golay on equally spaced samples. w odd, order < w.
export function savgol(y, w, order) {
  const n = y.length;
  if (w % 2 === 0 || w < 3) throw new Error('The window must be odd and at least 3.');
  if (order >= w) throw new Error('The polynomial order must be less than the window.');
  if (w > n) throw new Error('The window is longer than the data.');
  const h = (w - 1) / 2;
  const A = Array.from({ length: w }, (_, i) => Array.from({ length: order + 1 }, (_, k) => (i - h) ** k));
  // Row 0 of (AᵀA)⁻¹Aᵀ gives the weights for the centre value.
  const coef = Array.from({ length: w }, (_, j) => lstsq(A, A.map((_, i) => +(i === j))).x[0]);
  const out = new Float64Array(n);
  for (let i = h; i < n - h; i++) { let s = 0; for (let j = 0; j < w; j++) s += coef[j] * y[i - h + j]; out[i] = s; }
  const edge = (from, idx) => {
    const B = Array.from({ length: w }, (_, i) => Array.from({ length: order + 1 }, (_, k) => i ** k));
    const p = lstsq(B, y.slice(from, from + w)).x;
    for (const i of idx) out[i] = p.reduce((s, c, k) => s + c * (i - from) ** k, 0);
  };
  edge(0, Array.from({ length: h }, (_, i) => i));
  edge(n - w, Array.from({ length: h }, (_, i) => n - h + i));
  return Array.from(out);
}
