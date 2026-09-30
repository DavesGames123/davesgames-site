// colormap.js — the water temperature ramp of the Tidal Currents page.
//
// The engine and the legend use the same ramp. The engine builds a 256x1
// texture from RAMP. main.js calls rampCSS() for the legend bar.
// The stops go purple, blue, cyan, green, yellow, orange, red. The stops are
// pastel, because the composite pass makes fast water brighter and whiter.
//
// grep: RAMP  rampCSS  rampAt

export const RAMP = [
  [0.40, 0.27, 0.66],   // purple
  [0.33, 0.38, 0.88],   // indigo blue
  [0.30, 0.58, 0.97],   // blue
  [0.32, 0.80, 0.93],   // cyan
  [0.42, 0.88, 0.64],   // sea green
  [0.66, 0.91, 0.42],   // yellow green
  [0.97, 0.88, 0.40],   // yellow
  [0.98, 0.63, 0.33],   // orange
  [0.93, 0.36, 0.31],   // red
];

// Return the ramp color at t in 0..1, with linear steps between stops.
export function rampAt(t) {
  const n = RAMP.length - 1;
  const x = Math.min(Math.max(t, 0), 1) * n;
  const i = Math.min(Math.floor(x), n - 1), f = x - i;
  const a = RAMP[i], b = RAMP[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

// Return a CSS linear-gradient (left to right) with one color stop per ramp stop.
export function rampCSS(direction = 'to right') {
  const n = RAMP.length - 1;
  const stops = RAMP.map(([r, g, b], i) =>
    `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}) ${((i / n) * 100).toFixed(1)}%`);
  return `linear-gradient(${direction}, ${stops.join(', ')})`;
}
