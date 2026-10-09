// ============================================================================
//  CLOTH  ·  pages/cloth/shots.js — the screensaver shots
// ----------------------------------------------------------------------------
//  makeShots(H) returns the shot list for the sim kit director. Each shot
//  sets the scene keys it needs on top of a fresh random scene, a camera
//  (stage3d.shotCam) and one TeX line. H.release() lets go of the pins,
//  H.later(sec, f) runs f later. No DOM: tests.mjs checks the plan in node.
// ============================================================================
import * as S3 from '../soft-bodies/stage3d.js';

const TEX_STRETCH = String.raw`C = \lvert \mathbf{x}_1 - \mathbf{x}_0 \rvert - l_0,\qquad \Delta\mathbf{x}_i = -\,\frac{w_i\,C}{w_0 + w_1 + \alpha/\Delta t^2}\,\nabla_{\mathbf{x}_i} C`;
const TEX_BEND = String.raw`C_{\mathrm{bend}} = \lvert \mathbf{x}_2 - \mathbf{x}_3 \rvert - d_0\quad\text{(the two tips of a triangle pair)}`;
const TEX_MASS = String.raw`w_i = \sum_{t \ni i} \frac{1}{3 A_t},\qquad w_{\mathrm{pin}} = 0`;
const TEX_WIND = String.raw`\mathbf{v} \leftarrow \mathbf{v} + \Delta t\,\big(\mathbf{g} + \mathbf{a}_{\mathrm{wind}}(t, \mathbf{x})\big)`;
const TEX_HIT = String.raw`\mathbf{x} \leftarrow \mathbf{c} + (r + h)\,\frac{\mathbf{x} - \mathbf{c}}{\lvert \mathbf{x} - \mathbf{c} \rvert}`;

export function makeShots(H) {
  return [
    { key: 'hang', title: 'Hanging cloth', sub: 'Pinned at two corners, it settles into folds', tex: TEX_STRETCH,
      scene: r => ({ start: 'hang', pins: r.pick(['corners', 'three', 'one', 'top']), wind: 1.5 + 3 * r(), windDir: r.int(0, 71) * 5, gust: 0.4 + 0.5 * r(), obstacles: 0, height: 0.2 + 0.4 * r() }),
      camera: r => S3.shotCam(r, 'orbit', 1.15) },
    { key: 'drape', title: 'Drape', sub: 'A sheet falls over the obstacles and slides', tex: TEX_HIT,
      scene: r => ({ start: 'drape', pins: 'none', obstacles: r.int(1, 3), obKind: r.pick(['spheres', 'mixed', 'boxes']), wind: 0, height: 0.2 + 0.3 * r(), size: 1.2 + 0.4 * r() }),
      camera: r => S3.shotCam(r, 'crane', 0.7) },
    { key: 'flag', title: 'Flag in the wind', sub: 'Pinned on one edge, the gusts make it ripple', tex: TEX_WIND,
      scene: r => ({ start: 'flag', pins: 'left', wind: 5 + 5 * r(), windDir: r.pick([0, 0, 20, 340]), gust: 0.5 + 0.4 * r(), obstacles: 0, height: 0.6 + 0.5 * r(), bendC: 0.5 + 3 * r() }),
      camera: r => S3.shotCam(r, 'track', 1.3) },
    { key: 'release', title: 'Let go', sub: 'The pins release and the sheet drops in a heap', tex: TEX_MASS,
      scene: r => ({ start: 'hang', pins: r.pick(['corners', 'top']), height: 0.6 + 0.5 * r(), obstacles: r.int(0, 2), wind: r() * 2 }),
      camera: r => S3.shotCam(r, 'low', 0.8), start: () => H.later(2.6, H.release) },
    { key: 'stiff', title: 'Soft to stiff', sub: 'Bending compliance decides how a fabric folds', tex: TEX_BEND,
      scene: r => ({ start: r.pick(['hang', 'drape']), bendC: r.pick([0.05, 0.2, 8, 10]), obstacles: r.int(1, 2), wind: 1 + 2 * r() }),
      camera: r => S3.shotCam(r, 'push', 0.75) },
    { key: 'drop', title: 'Flat drop', sub: 'An unpinned sheet lands on the floor and the rocks', tex: TEX_STRETCH,
      scene: r => ({ start: 'drop', pins: 'none', obstacles: r.int(1, 4), obKind: r.pick(['mixed', 'pillars', 'spheres']), height: 0.4 + 0.5 * r(), size: 1.3 + 0.4 * r(), wind: r() * 1.5 }),
      camera: r => S3.shotCam(r, 'top', 0.8) },
  ];
}
