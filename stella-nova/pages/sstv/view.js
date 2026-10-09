// ============================================================================
//  SSTV  ·  drawing helpers: FFT, waterfall, oscilloscope  (ES module)
// ----------------------------------------------------------------------------
//  Plain 2D-canvas code. It needs no DOM when a canvas factory is set
//  (setCanvasFactory), so node renders the same pictures for checks and
//  for the home thumbnail.
//
//  grep -n targets
//    "export function setCanvasFactory"   node: pass @napi-rs/canvas
//    "export function fft"                radix-2, in place
//    "export class Waterfall"             scrolling spectrogram
//    "export function drawScope"          oscilloscope trace with glow
//    "export const PAL"                   page colours for canvases
// ============================================================================

let factory = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
export function setCanvasFactory(fn) { factory = fn; }
export function mkCanvas(w, h) { return factory(Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); }

export const PAL = {
  bg: '#05070a', card: '#0b0e14', ink: '#e8eaf0', ink2: '#c0c6d4', dim: '#858ca2', faint: '#2a3242',
  acc: '#7fe0a8', sync: '#ff6a5c', black: '#7a8496', white: '#f2f4f8', leader: '#ffc85c', bit1: '#62c4ff', bit0: '#c490ff',
  R: '#ff6a6a', G: '#6ef08a', B: '#6aa8ff', Y: '#e8e8e8', RY: '#ff8fa8', BY: '#7fc8ff', C: '#d0a8ff', porch: '#4a5263',
};
export const SEG_COL = (g) => (g.t === 'sync' ? PAL.sync : g.t === 'porch' ? PAL.porch : PAL[g.ch.replace(/[01]/, '')] || PAL.Y);

export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// Colour map for the waterfall: black, deep blue, teal, green, amber, white.
const STOPS = [[0, 2, 4, 10], [0.25, 8, 30, 80], [0.45, 10, 120, 140], [0.65, 90, 220, 120], [0.85, 255, 200, 70], [1, 255, 250, 235]];
export const LUT = (() => {
  const L = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255; let k = 0;
    while (k < STOPS.length - 2 && t > STOPS[k + 1][0]) k++;
    const a = STOPS[k], b = STOPS[k + 1], u = (t - a[0]) / (b[0] - a[0]);
    for (let c = 0; c < 3; c++) L[i * 3 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * u;
  }
  return L;
})();

// Scrolling spectrogram, newest row at the top. Frequency runs left to
// right from f0 to f1. add(x, at) adds one row from the N samples before
// sample index at.
export class Waterfall {
  constructor(fs, { N = 512, f0 = 900, f1 = 2600, rows = 220, cols = 200 } = {}) {
    this.fs = fs; this.N = N; this.f0 = f0; this.f1 = f1;
    this.cv = mkCanvas(cols, rows); this.g = this.cv.getContext('2d');
    this.g.fillStyle = '#020306'; this.g.fillRect(0, 0, cols, rows);
    this.row = this.g.createImageData(cols, 1);
    this.re = new Float32Array(N); this.im = new Float32Array(N);
    this.win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
    this.ref = 1e-3;
  }
  add(x, at) {
    const { N, re, im, win, fs, row } = this, cols = this.cv.width, rows = this.cv.height;
    for (let i = 0; i < N; i++) { const j = at - N + i; re[i] = j >= 0 && j < x.length ? x[j] * win[i] : 0; im[i] = 0; }
    fft(re, im);
    const mag = new Float32Array(cols);
    let peak = 1e-9;
    for (let c = 0; c < cols; c++) {
      const f = this.f0 + (this.f1 - this.f0) * (c + 0.5) / cols, b = f * N / fs, i = Math.floor(b), r = b - i;
      const m0 = Math.hypot(re[i], im[i]), m1 = Math.hypot(re[i + 1] || 0, im[i + 1] || 0);
      mag[c] = m0 + (m1 - m0) * r; if (mag[c] > peak) peak = mag[c];
    }
    this.ref = Math.max(peak, this.ref * 0.995, 1e-3);
    for (let c = 0; c < cols; c++) {
      const db = 20 * Math.log10(mag[c] / this.ref + 1e-9), v = Math.max(0, Math.min(255, Math.round((db + 54) / 54 * 255)));
      row.data[c * 4] = LUT[v * 3]; row.data[c * 4 + 1] = LUT[v * 3 + 1]; row.data[c * 4 + 2] = LUT[v * 3 + 2]; row.data[c * 4 + 3] = 255;
    }
    this.g.drawImage(this.cv, 0, 0, cols, rows - 1, 0, 1, cols, rows - 1);
    this.g.putImageData(row, 0, 0);
  }
  clear() { this.g.fillStyle = '#020306'; this.g.fillRect(0, 0, this.cv.width, this.cv.height); }
  // Draw into g at (x, y, w, h) with tone marks and a frequency axis.
  draw(g, x, y, w, h, { marks = true, axis = true, font = 11 } = {}) {
    g.save();
    g.imageSmoothingEnabled = true;
    g.drawImage(this.cv, x, y, w, h);
    if (marks) {
      const M = [[1200, 'sync', PAL.sync], [1500, 'black', PAL.black], [1900, 'VIS', PAL.leader], [2300, 'white', PAL.white]];
      g.font = `500 ${font}px Inter, system-ui, sans-serif`; g.textAlign = 'center';
      for (const [f, name, col] of M) {
        const px = x + w * (f - this.f0) / (this.f1 - this.f0);
        g.strokeStyle = col; g.globalAlpha = 0.5; g.setLineDash([3, 4]); g.lineWidth = 1;
        g.beginPath(); g.moveTo(px, y); g.lineTo(px, y + h); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
        if (axis) { g.fillStyle = col; g.fillText(`${f}`, px, y + h + font + 3); g.fillStyle = PAL.dim; g.fillText(name, px, y + h + 2 * font + 5); }
      }
    }
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    g.restore();
  }
}

// Oscilloscope: samples x[at - n .. at) as a glowing trace in a graticule.
export function drawScope(g, x, y, w, h, sig, at, n, { colour = '#7fe0a8', grid = true, gain = 1 } = {}) {
  g.save();
  g.fillStyle = '#030806'; g.fillRect(x, y, w, h);
  if (grid) {
    g.strokeStyle = 'rgba(127,224,168,0.10)'; g.lineWidth = 1;
    for (let i = 1; i < 10; i++) { const px = Math.round(x + w * i / 10) + 0.5; g.beginPath(); g.moveTo(px, y); g.lineTo(px, y + h); g.stroke(); }
    for (let i = 1; i < 8; i++) { const py = Math.round(y + h * i / 8) + 0.5; g.beginPath(); g.moveTo(x, py); g.lineTo(x + w, py); g.stroke(); }
  }
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const j = at - n + i, v = j >= 0 && j < sig.length ? sig[j] * gain : 0;
    const px = x + w * i / (n - 1), py = y + h / 2 - v * h * 0.42;
    if (i) g.lineTo(px, py); else g.moveTo(px, py);
  }
  g.strokeStyle = colour; g.globalAlpha = 0.25; g.lineWidth = 5; g.stroke();
  g.globalAlpha = 1; g.lineWidth = 1.4; g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.12)'; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  g.restore();
}

export function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
