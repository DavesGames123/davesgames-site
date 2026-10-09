// ============================================================================
//  SOFT BODIES  ·  pages/soft-bodies/shots.js — the screensaver shots
// ----------------------------------------------------------------------------
//  makeShots(H) returns the shot list for the sim kit director. Each shot
//  sets the scene keys it needs on top of a fresh random scene, a camera
//  (stage3d.shotCam) and one TeX line. H.squash() flattens the bodies.
//  No DOM: tests.mjs checks the plan in node.
// ============================================================================
import * as S3 from './stage3d.js';

const TEX_XPBD = String.raw`\Delta\lambda = \frac{-C - \tilde\alpha\,\lambda}{\nabla C^{\top} M^{-1} \nabla C + \tilde\alpha},\qquad \tilde\alpha = \frac{\alpha}{\Delta t^2}`;
const TEX_VOL = String.raw`C_{\mathrm{vol}} = 6\,(V - V_0),\quad V = \tfrac16\,(\mathbf{x}_1-\mathbf{x}_0)\times(\mathbf{x}_2-\mathbf{x}_0)\cdot(\mathbf{x}_3-\mathbf{x}_0)`;
const TEX_EDGE = String.raw`C_{\mathrm{edge}} = \lvert \mathbf{x}_1 - \mathbf{x}_0 \rvert - l_0`;
const TEX_VEL = String.raw`\mathbf{v} \leftarrow \frac{\mathbf{x} - \mathbf{x}_{\mathrm{prev}}}{\Delta t}`;

export function makeShots(H) {
  return [
  { key: 'drop', title: 'Bunnies drop', sub: 'Tetrahedral soft bodies land and wobble', tex: TEX_XPBD,
    scene: r => ({ layout: 'drop', height: 0.8 + 1.4 * r(), count: Math.min(r.int(1, 4), 4), obstacles: r.int(0, 2) }),
    camera: r => S3.shotCam(r, 'orbit', 1.1) },
  { key: 'squash', title: 'Squash and recover', sub: 'Flattened to the floor, the volume constraint pushes back', tex: TEX_VOL,
    scene: r => ({ layout: 'ring', height: 0, count: r.int(1, 3), volC: 0, edgeC: 50 + 150 * r(), obstacles: 0, spin: 0 }),
    camera: r => S3.shotCam(r, 'low', 1.0), start: () => H.later(1.4, H.squash) },
  { key: 'toss', title: 'Thrown together', sub: 'Bunnies fly in from a ring and pass through each other', tex: TEX_VEL,
    scene: r => ({ layout: 'toss', count: r.int(2, 4), obstacles: r.int(0, 2), spin: 1 + 2 * r() }),
    camera: r => S3.shotCam(r, 'top', 1.3) },
  { key: 'jelly', title: 'Jelly', sub: 'High compliance: the bodies sag and bounce', tex: TEX_XPBD,
    scene: r => ({ layout: 'drop', count: r.int(1, 3), edgeC: 250 + 200 * r(), volC: 0.004 + 0.012 * r(), mat: 'jelly', height: 1 + r(), obstacles: r.int(1, 3) }),
    camera: r => S3.shotCam(r, 'push', 1.0), kicks: true },
  { key: 'rocks', title: 'Over the rocks', sub: 'Falling onto spheres, boxes and pillars', tex: TEX_EDGE,
    scene: r => ({ layout: 'rain', count: r.int(2, 4), obstacles: r.int(3, 5), obKind: r.pick(['mixed', 'spheres', 'pillars']), height: 1.2 + r() }),
    camera: r => S3.shotCam(r, 'crane', 1.4) },
  { key: 'tilt', title: 'Sideways gravity', sub: 'A tilted gravity slides the bunnies across the floor', tex: TEX_VEL,
    scene: r => ({ layout: 'drop', count: r.int(2, 4), tilt: 1.5 + 1.5 * r(), tiltDir: r.int(0, 71) * 5, obstacles: r.int(1, 3), fric: 0.2 + 0.3 * r() }),
    camera: r => S3.shotCam(r, 'track', 1.2), kicks: true },
  ];
}
