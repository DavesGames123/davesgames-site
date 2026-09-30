// colormap.js — the water temperature ramp of the Tidal Currents page.
//
// The engine and the legend use the same ramp. The engine builds a 256x1
// texture with rampAt(). main.js calls rampCSS() for the legend bar.
//
// The ramp is blue over a wide middle band. Purple is at the cold end.
// Green, yellow, orange and red are pushed into the top fifth, so typical
// water reads blue and cyan and only the warmest water is warm.
//
// STOPS holds [position, [r, g, b]] with positions in 0..1.
// RAMP holds 17 colors at equal steps (the old contract: [[r, g, b], ...]).
//
// grep: STOPS  RAMP  rampAt  rampCSS

export const STOPS = [
  [0.00, [0.42, 0.24, 0.72]],   // purple
  [0.10, [0.33, 0.30, 0.90]],   // indigo
  [0.26, [0.22, 0.46, 1.00]],   // blue
  [0.48, [0.20, 0.66, 1.00]],   // sky blue
  [0.68, [0.22, 0.86, 0.98]],   // cyan
  [0.79, [0.30, 0.94, 0.68]],   // sea green
  [0.86, [0.70, 0.95, 0.36]],   // yellow green
  [0.91, [1.00, 0.88, 0.30]],   // yellow
  [0.96, [1.00, 0.58, 0.24]],   // orange
  [1.00, [0.96, 0.30, 0.28]],   // red
];

// Return the ramp color at t in 0..1, with linear steps between stops.
export function rampAt(t) {
  const x = Math.min(Math.max(t, 0), 1);
  let i = 0;
  while (i < STOPS.length - 2 && x > STOPS[i + 1][0]) i++;
  const [p0, a] = STOPS[i], [p1, b] = STOPS[i + 1];
  const f = p1 > p0 ? (x - p0) / (p1 - p0) : 0;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export const RAMP = Array.from({ length: 17 }, (_, i) => rampAt(i / 16));

// Return a CSS linear-gradient with one color stop per ramp stop.
export function rampCSS(direction = 'to right') {
  const stops = STOPS.map(([p, [r, g, b]]) =>
    `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}) ${(p * 100).toFixed(1)}%`);
  return `linear-gradient(${direction}, ${stops.join(', ')})`;
}
