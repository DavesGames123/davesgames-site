// ============================================================================
//  PENDULUM IN 100 LINES  ·  pages/pendulum-short/saver.js — screensaver shots
// ----------------------------------------------------------------------------
//  installSaver(C) defines window.snSaver through the sim kit director.
//  Each cut draws a fresh guarded random scene, then the shot sets what it
//  needs and a camera. TeX on the plate, no code.
//
//  grep -n targets: "const SHOTS", "export function installSaver"
// ============================================================================
import { director } from '../../widgets/sim-kit/saver.js';

const TEX_PBD = String.raw`\tilde{\mathbf{x}} = \mathbf{x} + \Delta t\,\mathbf{v} + \Delta t^2\,\mathbf{g},\qquad \mathbf{v} \leftarrow \frac{\mathbf{x} - \mathbf{x}_{\mathrm{prev}}}{\Delta t}`;
const TEX_LINK = String.raw`\Delta\mathbf{x}_{i} = \frac{w_i}{w_{i-1} + w_i}\,(l_i - d)\,\frac{\mathbf{x}_i - \mathbf{x}_{i-1}}{d},\qquad w = \frac{1}{m}`;
const TEX_CHAOS = String.raw`\lvert\delta\theta(t)\rvert \approx \lvert\delta\theta_0\rvert\,e^{\lambda t},\qquad \lambda > 0`;
const TEX_DRIVE = String.raw`x_0(t) = A\sin(2\pi f t)`;
const TEX_ENERGY = String.raw`E = \sum_i m_i\left(\tfrac12\lvert\mathbf{v}_i\rvert^2 + g\,y_i\right)`;

const SHOTS = [
  { key: 'triple', title: 'Triple pendulum', sub: 'The upstream demo: three links, a hundred lines', tex: TEX_PBD,
    scene: r => ({ links: 3, massMode: 'upstream', start: r.pick(['upstream', 'random', 'up']), copies: 1, driveA: 0, damp: 0, trail: 1200, trailAll: r() < 0.4 }), camera: () => ({ zoom: 1.25 }) },
  { key: 'double', title: 'Double pendulum', sub: 'Two links are enough for chaos', tex: TEX_ENERGY,
    scene: r => ({ links: 2, massMode: r.pick(['equal', 'falling']), start: r.pick(['up', 'random', 'side']), copies: 1, driveA: 0, damp: 0, trail: 1600 }), camera: () => ({ zoom: 1.2 }) },
  { key: 'fan', title: 'The chaos fan', sub: 'Copies that start a hair apart', tex: TEX_CHAOS,
    scene: r => ({ links: r.pick([2, 3]), copies: 8 + r.int(0, 6), delta: -4 + 1.5 * r(), start: r.pick(['up', 'side']), colorBy: 'copy', trail: 500, driveA: 0, damp: 0, rods: true }) },
  { key: 'chain', title: 'A heavy chain', sub: 'The same loop with many links', tex: TEX_LINK,
    scene: r => ({ links: 10 + r.int(0, 6), massMode: r.pick(['equal', 'falling']), start: r.pick(['side', 'curl', 'random']), copies: 1, trail: 300, trailAll: true, damp: 0.01 }), camera: () => ({ zoom: 1.15 }) },
  { key: 'driven', title: 'A driven pivot', sub: 'The top shakes from side to side', tex: TEX_DRIVE,
    scene: r => ({ links: r.int(2, 5), driveA: 0.02 + 0.03 * r(), driveF: 0.6 + 1.6 * r(), start: 'side', copies: 1, damp: 0.02, trail: 1200 }) },
  { key: 'ratio', title: 'Light and heavy', sub: 'A light bob whips round its heavy neighbours', tex: TEX_LINK,
    scene: r => ({ links: r.int(3, 6), massMode: r.pick(['falling', 'random']), start: 'random', copies: 1, trailAll: true, trail: 800, colorBy: 'speed' }), camera: () => ({ zoom: 1.2 }) },
  { key: 'close', title: 'Close up', sub: 'The last bob and its trail', tex: TEX_PBD,
    scene: r => ({ links: 3, start: 'random', copies: 1, trail: 1600 }),
    camera: r => ({ zoom: 1.7, cx: 0.65 + (r() - 0.5) * 0.3, cy: 0.42 }) },
];

export function installSaver(C) {
  return director({
    kit: C.kit,
    canvas: () => C.canvas,
    shots: SHOTS.map(s => Object.assign({ params: st => [
      { sym: 'n', name: 'links', value: String(st.links) },
      { sym: 'g', name: 'gravity', value: st.g.toFixed(1) + ' m/s²' },
      { sym: 'N', name: 'copies', value: String(C.S.chains.length) },
    ] }, s)),
    apply(state, shot, cam) { C.rebuild(); C.P.setSaver(shot ? { x: 0, y: 0, w: innerWidth, h: innerHeight } : null, cam); },
    frame(band, cam) { C.P.setSaver(band, cam); },
    exit() { C.P.setSaver(null); },
  });
}
