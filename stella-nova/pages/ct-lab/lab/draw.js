// lab/draw.js - the "draw your own" phantom: a list of painted shapes of named materials,
// and the conversion of an uploaded picture into a phantom. No DOM except the picture
// decode in imageToPhantom, which takes RGBA pixels the page has already read.
//
// Shapes use the engine's paint format: { t: 'e', x, y, a, b, phi, mat } in cm, y up.
// The first shape is the body (a water cylinder) so new shapes sit in tissue.
//
// grep handles: MATERIAL_CHOICES, DRAW_WIDTH, starterShapes, shapeFromDrag, hitShape, imageToPhantom

import { muOfComposition } from '../engine/index.js';

export const DRAW_WIDTH = 20;      // cm across the drawing area

export const MATERIAL_CHOICES = [
  ['air', 'Air'], ['lung', 'Lung'], ['fat', 'Fat'], ['water', 'Water'], ['soft', 'Soft tissue'],
  ['blood', 'Blood'], ['spongy', 'Spongy bone'], ['bone', 'Bone'], ['aluminium', 'Aluminium'],
  ['titanium', 'Titanium'], ['steel', 'Steel'],
];

export function starterShapes() {
  return [
    { t: 'e', x: 0, y: 0, a: 8.6, b: 7.2, phi: 0, mat: 'soft' },
    { t: 'e', x: -3.2, y: 1.2, a: 2.2, b: 3.0, phi: 15, mat: 'lung' },
    { t: 'e', x: 3.1, y: 1.0, a: 1.4, b: 1.4, phi: 0, mat: 'bone' },
    { t: 'e', x: 0.4, y: -3.6, a: 0.5, b: 0.5, phi: 0, mat: 'steel' },
  ];
}

// From a drag in world coordinates (cm): start (x0, y0), end (x1, y1).
// kind 'disc': centre at the start, radius to the end. 'ellipse': the drag box.
export function shapeFromDrag(kind, x0, y0, x1, y1, mat) {
  if (kind === 'disc') {
    const r = Math.max(0.15, Math.hypot(x1 - x0, y1 - y0));
    return { t: 'e', x: x0, y: y0, a: r, b: r, phi: 0, mat };
  }
  const a = Math.max(0.15, Math.abs(x1 - x0) / 2), b = Math.max(0.15, Math.abs(y1 - y0) / 2);
  return { t: 'e', x: (x0 + x1) / 2, y: (y0 + y1) / 2, a, b, phi: 0, mat };
}

// Index of the top shape under (x, y), or -1.
export function hitShape(shapes, x, y) {
  for (let k = shapes.length - 1; k >= 0; k--) {
    const s = shapes[k], c = Math.cos((s.phi || 0) * Math.PI / 180), sn = Math.sin((s.phi || 0) * Math.PI / 180);
    const dx = x - s.x, dy = y - s.y, lx = dx * c + dy * sn, ly = -dx * sn + dy * c;
    if ((lx / s.a) ** 2 + (ly / s.b) ** 2 <= 1) return k;
  }
  return -1;
}

// RGBA pixels (n x n, already fitted) -> { image, basis, width }.
// Brightness 0..1 maps to mu 0..mu(bone) at 70 keV. The basis split is a coarse stand-in:
// dark to mid grey is water-like, bright is bone-like, so beam hardening still acts.
export function imageToPhantom(rgba, n, width = DRAW_WIDTH) {
  const N = n * n, img = new Float32Array(N), bw = new Float32Array(N), bb = new Float32Array(N), bi = new Float32Array(N);
  const muW = muOfComposition('water'), muB = muOfComposition('bone');
  for (let k = 0; k < N; k++) {
    const r = rgba[4 * k], g = rgba[4 * k + 1], b = rgba[4 * k + 2], al = rgba[4 * k + 3] / 255;
    const L = (al * (0.2126 * r + 0.7152 * g + 0.0722 * b)) / 255;
    const mu = L * muB;
    img[k] = mu;
    if (mu <= muW) bw[k] = mu / muW;
    else { const f = (mu - muW) / (muB - muW); bw[k] = 1 - f; bb[k] = f; }
  }
  const mk = (d) => ({ nx: n, ny: n, width, data: d });
  return { image: mk(img), basis: { water: mk(bw), bone: mk(bb), iron: mk(bi) }, width };
}
