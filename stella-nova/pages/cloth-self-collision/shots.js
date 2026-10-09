// ============================================================================
//  CLOTH SELF COLLISION  ·  pages/cloth-self-collision/shots.js — the
//  screensaver shots
// ----------------------------------------------------------------------------
//  makeShots(H) returns the shot list for the sim kit director. Each shot
//  sets the scene keys it needs on top of a fresh random scene, a camera
//  (stage3d.shotCam) and one TeX line. H.lift() pulls the middle of the
//  pile up, H.later(sec, f) runs f later. No DOM: tests.mjs checks the plan.
// ============================================================================
import * as S3 from '../soft-bodies/stage3d.js';

const TEX_SELF = String.raw`\lvert \mathbf{x}_i - \mathbf{x}_j \rvert \ \ge\ h\quad \text{for } \lvert \bar{\mathbf{x}}_i - \bar{\mathbf{x}}_j \rvert \ge h`;
const TEX_HASH = String.raw`\text{cell}(\mathbf{x}) = \left\lfloor \frac{\mathbf{x}}{s} \right\rfloor,\quad \text{query radius } r = v_{\max}\,\Delta t_{\mathrm{frame}}`;
const TEX_VMAX = String.raw`\lvert \mathbf{v} \rvert \le v_{\max} = 0.2\,\frac{h}{\Delta t}`;
const TEX_FRIC = String.raw`\Delta\mathbf{v}_{i,j} = \tfrac12(\mathbf{v}_i + \mathbf{v}_j) - \mathbf{v}_{i,j}\quad\text{(the colliding pair moves together)}`;

export function makeShots(H) {
  return [
    { key: 'pile', title: 'The falling strip', sub: 'A long cloth strip folds onto itself without passing through', tex: TEX_SELF,
      scene: r => ({ start: 'strip', pins: 'none', selfColl: true, obstacles: 0, height: 0.1 + 0.3 * r(), wind: 0 }),
      camera: r => S3.shotCam(r, 'orbit', 0.36, { el: 0.4 }), start: () => H.later(6.5, H.lift) },
    { key: 'off', title: 'Without self collision', sub: 'The same fall with the hash switched off: layers pass through', tex: TEX_HASH,
      scene: r => ({ start: 'strip', pins: 'none', selfColl: false, obstacles: 0, height: 0.1 + 0.2 * r(), wind: 0 }),
      camera: r => S3.shotCam(r, 'low', 0.38) },
    { key: 'sheet', title: 'Folding sheet', sub: 'A flat sheet lands on an obstacle and stacks its folds', tex: TEX_SELF,
      scene: r => ({ start: 'sheet', pins: 'none', selfColl: true, obstacles: r.int(1, 2), obKind: r.pick(['spheres', 'boxes', 'mixed']), nx: r.int(30, 45), ny: r.int(60, 120), height: 0.2 + 0.3 * r() }),
      camera: r => S3.shotCam(r, 'crane', 0.5) },
    { key: 'spin', title: 'Spinning strip', sub: 'A twisting strip coils as it lands', tex: TEX_VMAX,
      scene: r => ({ start: 'spin', pins: 'none', selfColl: true, obstacles: 0, height: 0.1 + 0.2 * r() }),
      camera: r => S3.shotCam(r, 'top', 0.42) },
    { key: 'pillars', title: 'Over the pillars', sub: 'A tilted strip falls across pillars and drapes between them', tex: TEX_FRIC,
      scene: r => ({ start: 'tilted', pins: 'none', selfColl: true, obstacles: r.int(2, 4), obKind: 'pillars', height: 0.1 + 0.2 * r() }),
      camera: r => S3.shotCam(r, 'push', 0.7) },
    { key: 'ribbon', title: 'Ribbon in the wind', sub: 'Pinned at the top, the long strip swings and folds in gusts', tex: TEX_VMAX,
      scene: r => ({ start: 'strip', pins: r.pick(['edge', 'corners']), selfColl: true, wind: 1.5 + 2.5 * r(), windDir: r.int(0, 71) * 5, obstacles: 0, height: 0.15 }),
      camera: r => S3.shotCam(r, 'track', 0.9) },
  ];
}
