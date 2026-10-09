// ============================================================================
//  GRAB INTERACTION  ·  pages/soft-body-interaction/shots.js — the
//  screensaver shots
// ----------------------------------------------------------------------------
//  makeShots() returns the shot list for the sim kit director: a scene on
//  top of a fresh random one, a camera (stage3d.shotCam) and one TeX line.
//  A shot with kick: 'throw' or 'burst' makes the page throw the balls
//  every few seconds (the autopilot hand). No DOM: tests.mjs checks it.
// ============================================================================
import * as S3 from '../soft-bodies/stage3d.js';

const TEX_GRAB = String.raw`\mathbf{v}_{\mathrm{throw}} = \frac{\mathbf{x}_{\mathrm{hand}}(t) - \mathbf{x}_{\mathrm{hand}}(t - \Delta t)}{\Delta t}`;
const TEX_EULER = String.raw`\mathbf{v} \leftarrow \mathbf{v} + \mathbf{g}\,\Delta t,\qquad \mathbf{x} \leftarrow \mathbf{x} + \mathbf{v}\,\Delta t`;
const TEX_BOUNCE = String.raw`v_\perp \leftarrow -e\,v_\perp,\qquad e \in [0, 1]`;
const TEX_PAIR = String.raw`j = \frac{-(1 + e)\,(\mathbf{v}_b - \mathbf{v}_a)\cdot\mathbf{n}}{1/m_a + 1/m_b},\quad m \propto r^3`;
const TEX_FALL = String.raw`h_{k+1} = e^2\,h_k`;

export function makeShots() {
  return [
    { key: 'rain', title: 'Ball rain', sub: 'Balls of mixed sizes fall into the box and scatter', tex: TEX_PAIR,
      scene: r => ({ launch: 'rain', count: r.int(10, 26), mix: 0.4 + 0.5 * r(), collide: true, e: 0.75 + 0.2 * r(), g: 9 + 3 * r() }),
      camera: r => S3.shotCam(r, 'orbit', 1.5, { target: [0, 0.4, 0] }) },
    { key: 'burst', title: 'Burst', sub: 'All at once from the centre, then the pile settles', tex: TEX_EULER,
      scene: r => ({ launch: 'burst', count: r.int(12, 28), speed: 3 + 3 * r(), collide: true, e: 0.8 + 0.15 * r() }),
      camera: r => S3.shotCam(r, 'push', 1.6, { target: [0, 0.5, 0] }), kick: 'burst' },
    { key: 'throw', title: 'Pick up and throw', sub: 'The autopilot hand flings the balls across the box', tex: TEX_GRAB,
      scene: r => ({ launch: 'throw', count: r.int(4, 10), obstacles: r.int(1, 4), collide: true }),
      camera: r => S3.shotCam(r, 'top', 1.6, { target: [0, 0.3, 0] }), kick: 'throw' },
    { key: 'decay', title: 'Losing height', sub: 'Each bounce keeps e squared of the height', tex: TEX_FALL,
      scene: r => ({ launch: 'stack', count: r.int(3, 6), radius: 0.12 + 0.08 * r(), mix: 0.2, e: 0.65 + 0.25 * r(), obstacles: 0, collide: true }),
      camera: r => S3.shotCam(r, 'low', 1.0, { target: [0, 0.5, 0] }) },
    { key: 'float', title: 'Low gravity', sub: 'Gravity near zero: the balls ricochet off walls and ceiling', tex: TEX_BOUNCE,
      scene: r => ({ launch: 'burst', g: 0.4 + 1.6 * r(), e: 0.95 + 0.04 * r(), count: r.int(8, 20), collide: true, speed: 2 + 3 * r() }),
      camera: r => S3.shotCam(r, 'crane', 1.7, { target: [0, 0.9, 0] }) },
    { key: 'pillars', title: 'Pinball pillars', sub: 'Balls ricochet through pillars and spheres', tex: TEX_BOUNCE,
      scene: r => ({ launch: 'throw', obstacles: r.int(4, 6), obKind: r.pick(['pillars', 'mixed', 'spheres']), count: r.int(6, 14), e: 0.85 + 0.1 * r(), speed: 5 + 3 * r() }),
      camera: r => S3.shotCam(r, 'orbit', 1.7, { target: [0, 0.3, 0] }), kick: 'throw' },
  ];
}
