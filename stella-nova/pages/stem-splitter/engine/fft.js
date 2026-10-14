// ============================================================================
//  FFT  ·  stem-splitter/engine/fft.js — radix-2 complex FFT, float64
// ----------------------------------------------------------------------------
//  makeFFT(n) gives an in-place complex FFT of size n (a power of 2) on two
//  Float64Array (re, im). The twiddles and the bit-reverse table are made
//  once per size and kept in a small cache.
//    forward(re, im)   X[k] = sum x[j] exp(-2 pi i j k / n)   (no scale)
//    inverse(re, im)   x[j] = 1/n sum X[k] exp(+2 pi i j k / n)
//  dsp.js uses it for the STFT and the iSTFT of CONTRACT 3.4. It is our
//  own code (no library), as CONTRACT 3.4 asks.
//
//  GREP MAP
//    size check / cache ..... "export function makeFFT"
//    butterflies ............ "function transform"
// ============================================================================

const CACHE = new Map();

export function makeFFT(n) {
  if (!Number.isInteger(n) || n < 2 || (n & (n - 1)) !== 0) throw new Error('makeFFT: n must be a power of 2, got ' + n);
  if (CACHE.has(n)) return CACHE.get(n);
  const bits = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >>> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  // cos and sin of 2 pi k / n for k < n/2. Computed directly (not by a
  // recurrence) so each twiddle has full float64 accuracy.
  const half = n >> 1;
  const cs = new Float64Array(half), sn = new Float64Array(half);
  for (let k = 0; k < half; k++) { const a = 2 * Math.PI * k / n; cs[k] = Math.cos(a); sn[k] = Math.sin(a); }

  function transform(re, im, sign) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const h = size >> 1, step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0, t = 0; k < h; k++, t += step) {
          const wr = cs[t], wi = sign * sn[t];
          const a = start + k, b = a + h;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  }

  const fft = {
    n,
    forward(re, im) { transform(re, im, -1); },
    inverse(re, im) {
      transform(re, im, 1);
      const s = 1 / n;
      for (let i = 0; i < n; i++) { re[i] *= s; im[i] *= s; }
    },
  };
  CACHE.set(n, fft);
  return fft;
}
