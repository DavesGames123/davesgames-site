// ============================================================================
//  CNN EXPLAINER  ·  playground.js  the maths of the explainer widgets
// ----------------------------------------------------------------------------
//  DOM-free (node tests import it). explain.js draws the widgets.
//
//  KERNEL PLAYGROUND. A small n x n input, a k x k kernel, a stride s and a
//  padding p. The output side is o = floor((n + 2p - k) / s) + 1. When
//  (n + 2p - k) is not a multiple of s, the last rows and columns of the
//  input are never under the kernel: `exact` is false.
//
//  ACTIVATIONS. The functions of the activation picker. The network of the
//  page uses ReLU only; the others show what a different choice would do.
//
//  grep -n 'export function playSize'    o, and whether the fit is exact
//  grep -n 'export function tinyConv'    one convolution on the small grid
//  grep -n 'export const ACTIVATIONS'    relu, leaky, sigmoid, tanh, none
//  grep -n 'export function demoInput'   the input pattern of the widget
// ============================================================================

export function playSize(n, k, s = 1, p = 0) {
  const span = n + 2 * p - k;
  if (span < 0 || s < 1) return { o: 0, exact: false, valid: false, span };
  return { o: Math.floor(span / s) + 1, exact: span % s === 0, valid: true, span };
}

// grid: n x n numbers (row major). kernel: k x k. Returns the output grid,
// its side o, and the top-left corner of each window in padded coordinates
// (py, px) and in input coordinates (iy, ix = py - p, px - p).
export function tinyConv(grid, n, kernel, k, s = 1, p = 0) {
  const { o } = playSize(n, k, s, p);
  const out = new Float64Array(o * o), windows = [];
  for (let y = 0; y < o; y++) for (let x = 0; x < o; x++) {
    let sum = 0;
    const py = y * s, px = x * s;
    for (let ky = 0; ky < k; ky++) for (let kx = 0; kx < k; kx++) {
      const iy = py + ky - p, ix = px + kx - p;
      const v = iy >= 0 && iy < n && ix >= 0 && ix < n ? grid[iy * n + ix] : 0;
      sum += v * kernel[ky * k + kx];
    }
    out[y * o + x] = sum;
    windows.push({ y, x, py, px, iy: py - p, ix: px - p });
  }
  return { out, o, windows };
}

// A soft diagonal stroke on an n x n grid, values 0..1: something for an
// edge kernel to find.
export function demoInput(n) {
  const g = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = Math.abs(x - y - 0.5 * (n % 2 === 0 ? 1 : 0));
    g[y * n + x] = d < 0.75 ? 1 : d < 1.75 ? 0.5 : 0;
  }
  return g;
}

// A k x k kernel that answers to a vertical edge (left minus right). For an
// odd k the middle column is 0.
export function edgeKernel(k) {
  const w = new Float64Array(k * k);
  for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) {
    const c = x - (k - 1) / 2;
    w[y * k + x] = c < 0 ? 1 : c > 0 ? -1 : 0;
  }
  return w;
}

export const ACTIVATIONS = {
  relu: { label: 'ReLU', f: x => (x > 0 ? x : 0), tex: '\\mathrm{ReLU}(x) = \\max(0,\\, x)', note: 'Keeps a positive value, makes a negative value zero. This network uses it after each convolution.' },
  leaky: { label: 'Leaky ReLU', f: x => (x > 0 ? x : 0.1 * x), tex: 'f(x) = \\max(0.1x,\\, x)', note: 'Lets a small part of a negative value through, so the unit never goes fully silent.' },
  sigmoid: { label: 'Sigmoid', f: x => 1 / (1 + Math.exp(-x)), tex: '\\sigma(x) = \\frac{1}{1 + e^{-x}}', note: 'Squeezes every value into 0 to 1. Large values all look the same, so deep networks learn slowly with it.' },
  tanh: { label: 'Tanh', f: x => Math.tanh(x), tex: '\\tanh(x) = \\frac{e^{x} - e^{-x}}{e^{x} + e^{-x}}', note: 'Squeezes every value into -1 to 1 and keeps the sign.' },
  none: { label: 'None', f: x => x, tex: 'f(x) = x', note: 'No activation. Two convolutions in a row are then one bigger linear filter: depth gives nothing new.' },
};
export const ACTIVATION_IDS = Object.keys(ACTIVATIONS);
