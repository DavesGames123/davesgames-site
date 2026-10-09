// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · fft.js — radix-2 FFT, magnitude spectrum, peak finder
// ────────────────────────────────────────────────────────────────────────────
//  SECTION MAP   (grep -n "<anchor>" fft.js)
//    in-place FFT ......... "export function fft"
//    spectrum ............. "export function magnitudeSpectrum"
//    peak frequency ....... "export function peakFrequency"
//    peak near a target ... "export function peakNear"
// ════════════════════════════════════════════════════════════════════════════

/** In-place complex FFT. re, im: Float64Array of length 2^m. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** Hann-windowed, zero-padded magnitude spectrum. Returns { mag, df }. */
export function magnitudeSpectrum(signal, fs, padTo = 0) {
  let n = 1;
  const want = Math.max(signal.length, padTo);
  while (n < want) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  const L = signal.length;
  for (let i = 0; i < L; i++) re[i] = signal[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (L - 1)));
  fft(re, im);
  const mag = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return { mag, df: fs / n };
}

function refine(mag, i, df) {
  const a = Math.log(mag[i - 1] + 1e-300), b = Math.log(mag[i] + 1e-300), c = Math.log(mag[i + 1] + 1e-300);
  const d = (a - 2 * b + c);
  const off = d !== 0 ? (0.5 * (a - c)) / d : 0;
  return (i + off) * df;
}

/** Strongest peak between fLo and fHi, parabolic on log magnitude. */
export function peakFrequency({ mag, df }, fLo = 20, fHi = Infinity) {
  const lo = Math.max(1, Math.floor(fLo / df));
  const hi = Math.min(mag.length - 2, Math.ceil(fHi / df));
  let best = lo;
  for (let i = lo; i <= hi; i++) if (mag[i] > mag[best]) best = i;
  return { f: refine(mag, best, df), mag: mag[best] };
}

/** Strongest peak within +-tolCents of a target frequency. */
export function peakNear(spec, f, tolCents = 50) {
  const r = 2 ** (tolCents / 1200);
  return peakFrequency(spec, f / r, f * r);
}
