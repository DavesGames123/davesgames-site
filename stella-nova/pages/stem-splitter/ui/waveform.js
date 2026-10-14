// ============================================================================
//  STEM SPLITTER  ·  ui/waveform.js — min/max peaks and the canvas draw
// ----------------------------------------------------------------------------
//  computePeaks is pure. Column c covers the samples
//  floor(c * N / columns) .. floor((c + 1) * N / columns) - 1. When a column
//  has no sample (N < columns), it takes the sample at floor(c * N / columns).
//  With an array of channels, each column gives the min and max over all
//  channels.
//
//  drawWaveform draws the peaks on a canvas at devicePixelRatio, one pixel
//  column per peak column. The mixer computes the peaks once per stem for
//  the canvas width in device pixels, and again only when the width changes.
//  The play head is a separate element over the canvas (mixer.js), so a
//  play head move does not draw the canvas again.
//
//  GREP MAP
//    computePeaks ...... data (or [L, R]) + columns -> { min, max }
//    canvasColumns ..... canvas CSS width x devicePixelRatio -> columns
//    drawWaveform ...... peaks -> canvas pixels
// ============================================================================

export function computePeaks(data, columns) {
  const chans = Array.isArray(data) ? data : [data];
  const n = chans[0].length;
  columns = Math.max(1, Math.floor(columns));
  const min = new Float32Array(columns), max = new Float32Array(columns);
  for (let c = 0; c < columns; c++) {
    let a = Math.floor((c * n) / columns), b = Math.floor(((c + 1) * n) / columns);
    if (b <= a) b = Math.min(n, a + 1);
    let lo = Infinity, hi = -Infinity;
    for (const ch of chans) for (let i = a; i < b; i++) { const x = ch[i]; if (x < lo) lo = x; if (x > hi) hi = x; }
    if (lo === Infinity) { lo = 0; hi = 0; }
    min[c] = lo; max[c] = hi;
  }
  return { min, max };
}

export function canvasColumns(canvas, dpr = (globalThis.devicePixelRatio || 1)) {
  const w = canvas.clientWidth || canvas.width || 300;
  return Math.max(1, Math.round(w * dpr));
}

// The canvas gets width = peaks length and height = CSS height x dpr.
// gain: vertical zoom (1 = full scale fills the half height).
export function drawWaveform(canvas, peaks, { color = '#9aa3b2', dpr = (globalThis.devicePixelRatio || 1), gain = 1, dim = false } = {}) {
  const cols = peaks.min.length;
  const h = Math.max(1, Math.round((canvas.clientHeight || 48) * dpr));
  if (canvas.width !== cols) canvas.width = cols;
  if (canvas.height !== h) canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, cols, h);
  g.globalAlpha = dim ? 0.35 : 1;
  g.fillStyle = color;
  const mid = h / 2, half = h / 2 - 1;
  for (let c = 0; c < cols; c++) {
    const top = mid - Math.min(1, peaks.max[c] * gain) * half;
    const bot = mid - Math.max(-1, peaks.min[c] * gain) * half;
    g.fillRect(c, top, 1, Math.max(1, bot - top));
  }
  g.globalAlpha = 1;
}
