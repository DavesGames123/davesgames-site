// colormaps.js - colormaps for the reaction-diffusion page.
// DOM-free ES module. The engine builds its colormap texture from COLORMAPS.
// The UI uses cssGradient() for the legend swatches.
//
// Exports (grep -n "^export" colormaps.js):
//   COLORMAPS            {name: [[pos, [r, g, b]], ...]}  pos in [0,1], r g b in 0..255
//   COLORMAP_LABELS      {name: display label}
//   sampleColormap(name, t)        [r, g, b] in 0..255, linear between stops
//   cssGradient(name, dir, steps)  CSS linear-gradient() string
//   colormapRows(size)   {names, data: Uint8Array(size * names.length * 4)}, one row per map

export const COLORMAPS = {
  // Cool spectral: deep violet-blue through teal and pale yellow to red.
  spectral: [
    [0.00, [48, 18, 90]], [0.12, [62, 74, 168]], [0.28, [50, 136, 189]], [0.42, [102, 194, 165]],
    [0.55, [230, 245, 152]], [0.68, [254, 224, 139]], [0.82, [244, 109, 67]], [1.00, [158, 1, 66]],
  ],
  magma: [
    [0.00, [0, 0, 4]], [0.13, [28, 16, 68]], [0.25, [79, 18, 123]], [0.38, [129, 37, 129]],
    [0.50, [181, 54, 122]], [0.63, [229, 80, 100]], [0.75, [251, 135, 97]], [0.88, [254, 194, 135]],
    [1.00, [252, 253, 191]],
  ],
  viridis: [
    [0.00, [68, 1, 84]], [0.25, [59, 82, 139]], [0.50, [33, 145, 140]], [0.75, [94, 201, 98]],
    [1.00, [253, 231, 37]],
  ],
  ice: [
    [0.00, [4, 6, 19]], [0.22, [30, 40, 92]], [0.45, [55, 100, 164]], [0.70, [118, 178, 212]],
    [0.88, [190, 232, 240]], [1.00, [246, 255, 255]],
  ],
  // Two tones with a short, sharp step in the middle: cream coat, dark spots.
  leopard: [
    [0.00, [250, 232, 190]], [0.30, [238, 196, 124]], [0.44, [212, 150, 70]], [0.50, [120, 70, 32]],
    [0.56, [48, 28, 16]], [1.00, [14, 9, 6]],
  ],
  coral: [
    [0.00, [8, 24, 44]], [0.30, [18, 92, 110]], [0.55, [240, 236, 214]], [0.78, [242, 138, 102]],
    [1.00, [178, 36, 56]],
  ],
  grey: [[0.00, [0, 0, 0]], [1.00, [255, 255, 255]]],
};

export const COLORMAP_LABELS = {
  spectral: 'Spectral', magma: 'Magma', viridis: 'Viridis', ice: 'Ice', leopard: 'Leopard',
  coral: 'Coral', grey: 'Grey',
};

export function sampleColormap(name, t) {
  const stops = COLORMAPS[name] || COLORMAPS.spectral;
  t = Math.min(1, Math.max(0, +t || 0));
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i];
    if (t <= p1) {
      const [p0, c0] = stops[i - 1];
      const k = p1 > p0 ? (t - p0) / (p1 - p0) : 0;
      return [0, 1, 2].map(j => c0[j] + (c1[j] - c0[j]) * k);
    }
  }
  return stops[stops.length - 1][1].slice();
}

export function cssGradient(name, dir = 'to right', steps = 0) {
  const stops = COLORMAPS[name] || COLORMAPS.spectral;
  const parts = steps > 1
    ? Array.from({ length: steps }, (_, i) => {
        const t = i / (steps - 1), c = sampleColormap(name, t).map(Math.round);
        return `rgb(${c.join(',')}) ${(t * 100).toFixed(1)}%`;
      })
    : stops.map(([p, c]) => `rgb(${c.join(',')}) ${(p * 100).toFixed(1)}%`);
  return `linear-gradient(${dir}, ${parts.join(', ')})`;
}

export function colormapRows(size = 256) {
  const names = Object.keys(COLORMAPS);
  const data = new Uint8Array(size * names.length * 4);
  names.forEach((n, row) => {
    for (let i = 0; i < size; i++) {
      const c = sampleColormap(n, i / (size - 1));
      const o = (row * size + i) * 4;
      data[o] = Math.round(c[0]); data[o + 1] = Math.round(c[1]); data[o + 2] = Math.round(c[2]); data[o + 3] = 255;
    }
  });
  return { names, data, size };
}
