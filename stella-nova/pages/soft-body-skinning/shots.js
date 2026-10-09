// ============================================================================
//  SOFT BODY SKINNING  ·  pages/soft-body-skinning/shots.js — the
//  screensaver shots
// ----------------------------------------------------------------------------
//  makeShots(H) returns the shot list for the sim kit director: a scene on
//  top of a fresh random one, a camera (stage3d.shotCam) and one TeX line.
//  H.squash() flattens the dragons; H.later(sec, f) runs f later. A shot
//  with kicks: true makes the page flick a dragon every few seconds.
// ============================================================================
import * as S3 from '../soft-bodies/stage3d.js';

const TEX_SKIN = String.raw`\mathbf{x}_{\mathrm{vis}} = \sum_{k=0}^{3} b_k\,\mathbf{x}_{t_k},\qquad \sum_k b_k = 1`;
const TEX_BARY = String.raw`(b_1, b_2, b_3) = M^{-1}(\mathbf{p} - \mathbf{x}_0),\quad M = [\,\mathbf{x}_1 - \mathbf{x}_0\ \ \mathbf{x}_2 - \mathbf{x}_0\ \ \mathbf{x}_3 - \mathbf{x}_0\,]`;
const TEX_VOL = String.raw`C_{\mathrm{vol}} = 6\,(V - V_0)`;
const TEX_XPBD = String.raw`\Delta\lambda = \frac{-C - \tilde\alpha\,\lambda}{\nabla C^{\top} M^{-1} \nabla C + \tilde\alpha},\qquad \tilde\alpha = \frac{\alpha}{\Delta t^2}`;

export function makeShots(H) {
  return [
    { key: 'drop', title: 'The dragon lands', sub: 'A fine surface rides on a coarse tetrahedral cage', tex: TEX_SKIN,
      scene: r => ({ layout: 'drop', count: 1, height: 0.6 + 1.2 * r(), tumble: r() < 0.5, obstacles: r.int(0, 2), tets: false }),
      camera: r => S3.shotCam(r, 'orbit', 1.4, { target: [0, 0.5, 0] }) },
    { key: 'cage', title: 'The tet cage', sub: 'The coarse mesh the physics moves, drawn over the skin', tex: TEX_BARY,
      scene: r => ({ layout: 'drop', count: 1, height: 0.4 + 0.8 * r(), tets: true, mat: r.pick(['jelly', 'satin']), obstacles: 0 }),
      camera: r => S3.shotCam(r, 'push', 1.2, { target: [0, 0.6, 0] }) },
    { key: 'squash', title: 'Squash and recover', sub: 'Flattened, the volume constraint brings the dragon back', tex: TEX_VOL,
      scene: r => ({ layout: 'ring', count: r.int(1, 2), height: 0, edgeC: 5 + 25 * r(), volC: 0, obstacles: 0, tets: false }),
      camera: r => S3.shotCam(r, 'low', 1.3, { target: [0, 0.4, 0] }), start: () => H.later(1.4, H.squash) },
    { key: 'toss', title: 'Dragons thrown together', sub: 'Thrown in from a ring, they tumble and pass through each other', tex: TEX_XPBD,
      scene: r => ({ layout: 'toss', count: r.int(2, 3), spin: 1 + r(), obstacles: r.int(0, 2), tets: false }),
      camera: r => S3.shotCam(r, 'top', 1.25) },
    { key: 'rocks', title: 'Over the rocks', sub: 'Draped over spheres and boxes', tex: TEX_SKIN,
      scene: r => ({ layout: 'drop', count: 1, height: 0.8 + 0.8 * r(), obstacles: r.int(2, 4), obKind: r.pick(['spheres', 'mixed']), edgeC: 10 + 40 * r(), tets: false }),
      camera: r => S3.shotCam(r, 'crane', 1.5, { target: [0, 0.4, 0] }), kicks: true },
  ];
}
