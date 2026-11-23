// lab-zones.js: the colours of the lab look, derived from the active palette.
//
// The march of the lab look (shared/starmap-composite.hlsli, LabRecolour, LabPalIon and the rims) gives the
// gas its final colour from a few fixed zones: three stops of the ionization gradient (crimson, warm pink,
// lavender-blue), the dust colour, the warm head and skin colours, the knots, the cavity magenta and the
// rims. These zones were tuned with the nircam palette. With fixed zones, every palette gave the same colours.
//
// labZones(look, nircam) fits one 3x3 colour matrix M that takes the nircam channel colours to the channel
// colours of the active palette (least squares over the seven channels, each normalized to luma 1). Then it
// applies M to every zone and keeps the luma of each zone. For nircam, M is the identity, so the default
// view does not change. The zones keep their structure (the order of the stops and their luma); only the
// hues and saturations move with the palette.
//
// Grep targets: export const ZONES, export function labZones, function fitMatrix

const LUMA = [0.2126, 0.7152, 0.0722];
const CH = ['_PalHe', '_PalH', '_PalFront', '_PalPAH', '_PalH2', '_PalShock', '_PalEjecta'];
const PAL_KEY = { _PalHe: 'He', _PalH: 'H', _PalFront: 'Front', _PalPAH: 'PAH', _PalH2: 'H2', _PalShock: 'Shock', _PalEjecta: 'Ejecta' };

// The zones of the lab look with the nircam palette (index = row of _LabZ in the shader).
export const ZONES = [
  [1.00, 0.15, 0.20],   // 0 ion stop low U: H-alpha crimson
  [1.00, 0.36, 0.44],   // 1 ion stop mid U: warm pink
  [0.50, 0.60, 1.00],   // 2 ion stop high U: pale lavender-blue
  [1.00, 0.50, 0.22],   // 3 dust
  [1.00, 0.24, 0.07],   // 4 warm head (lit dense gas)
  [1.00, 0.30, 0.14],   // 5 warm skin
  [1.00, 0.55, 0.85],   // 6 knots
  [1.00, 0.25, 0.85],   // 7 cavity magenta
  [2.05, 0.70, 0.25],   // 8 warm rim
  [2.40, 0.62, 0.22],   // 9 warm cavity glow
  [0.55, 1.15, 1.30],   // 10 cool rim
  [0.45, 0.68, 1.00],   // 11 reflection bubble (dust-scattered starlight)
];

const luma = (c) => LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2];
const unit = (c) => { const l = luma(c) || 1; return c.map((v) => v / l); };

function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-9) return null;
  const r = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d];
  return r.map((v) => v / det);
}

// M (row major, 3x3) with M x_k ~ y_k: M = (Y X^T + l I)(X X^T + l I)^-1. The small ridge l keeps M near
// a scaled identity when the channels span a thin set of hues.
function fitMatrix(X, Y) {
  const l = 0.02;
  const XX = new Array(9).fill(0), YX = new Array(9).fill(0);
  for (let k = 0; k < X.length; k++) {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      XX[3 * r + c] += X[k][r] * X[k][c];
      YX[3 * r + c] += Y[k][r] * X[k][c];
    }
  }
  for (let d = 0; d < 3; d++) { XX[4 * d] += l; YX[4 * d] += l; }
  const iXX = inv3(XX);
  if (!iXX) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const M = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    for (let k = 0; k < 3; k++) M[3 * r + c] += YX[3 * r + k] * iXX[3 * k + c];
  }
  return M;
}

// look: the uniforms of lookOf (prelight.js), or a palette object { He, H, ... }. nircam: the nircam palette.
// Returns a Float32Array(48): 12 vec4 rows, row k = (zone k rgb, 0). Null input gives the nircam zones.
export function labZones(look, nircam) {
  const out = new Float32Array(48);
  const get = (src, k) => (src && (src[k] || src[PAL_KEY[k]])) || null;
  const X = [], Y = [];
  if (look && nircam) {
    for (const k of CH) {
      const x = get(nircam, k), y = get(look, k);
      if (x && y) { X.push(unit(x)); Y.push(unit(y)); }
    }
  }
  const same = X.every((x, k) => x.every((v, i) => Math.abs(v - Y[k][i]) < 1e-6));
  const M = X.length >= 3 && !same ? fitMatrix(X, Y) : null;
  ZONES.forEach((z, k) => {
    let c = z;
    if (M) {
      c = [0, 1, 2].map((r) => Math.max(0.02 * luma(z), M[3 * r] * z[0] + M[3 * r + 1] * z[1] + M[3 * r + 2] * z[2]));
      const s = luma(z) / (luma(c) || 1);
      c = c.map((v) => v * s);
    }
    out.set([c[0], c[1], c[2], 0], 4 * k);
  });
  return out;
}
