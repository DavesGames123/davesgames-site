// ============================================================================
//  JULIA FRACTALS  ·  pages/julia-fractals/saver.js — the screensaver shots
// ----------------------------------------------------------------------------
//  installSaver(P) defines window.snSaver through the sim kit director. Each
//  cut draws a fresh random scene; the shot picks the set, the path of c,
//  a dive spot and a colouring, and the clock restarts at a random phase so
//  no two runs show the same frames. Plate: title, c and one TeX line;
//  credit lines from the TMP kit. No code. Our code (davesgames.io).
//  grep -n targets: "const SHOTS"
// ============================================================================
import { director } from '../../widgets/sim-kit/saver.js';
import { SPOTS } from './fractal.js';

const TEX_Z = String.raw`z_{n+1} = z_n^2 + c,\qquad \lvert z_n \rvert > 2 \Rightarrow \text{escape}`;
const TEX_MU = String.raw`\mu = n + 1 - \log_2 \log \lvert z_n \rvert`;
const TEX_CARD = String.raw`c(\theta) = \tfrac{1}{2}e^{i\theta} - \tfrac{1}{4}e^{2i\theta}`;
const TEX_BULB = String.raw`c(\theta) = -1 + \tfrac{1}{4}e^{i\theta}`;
const TEX_M = String.raw`M = \{\, c : z_n \not\to \infty,\ z_0 = 0 \,\}`;
const TEX_D = String.raw`z_{n+1} = z_n^{\,d} + c`;

const SHOTS = [
  { key: 'cardioid', title: 'Around the main cardioid', sub: 'c walks the edge of the Mandelbrot set', tex: TEX_CARD,
    scene: r => ({ mode: 'julia', path: 'cardioid', pathK: 0.97 + 0.05 * r(), pathSpeed: 1.2 + r(), power: 2, color: 'smooth', inset: true }) },
  { key: 'bulb', title: 'The period-2 bulb', sub: 'Julia sets of c near −1', tex: TEX_BULB,
    scene: r => ({ mode: 'julia', path: 'bulb', pathK: 0.96 + 0.08 * r(), pathSpeed: 1.5 + r(), power: 2, inset: true }) },
  { key: 'wander', title: 'Wandering c', sub: 'In and out of M: connected sets and dust', tex: TEX_Z,
    scene: r => ({ mode: 'julia', path: 'wander', pathK: 0.98 + 0.05 * r(), pathSpeed: 0.8 + r(), power: 2, inset: r() < 0.6 }) },
  { key: 'circle', title: 'A circle of c', sub: '|c| = 0.7885 sweeps the classic Julia sets', tex: TEX_MU,
    scene: r => ({ mode: 'julia', path: 'circle', pathK: 0.98 + 0.04 * r(), pathSpeed: 1 + r(), power: 2, color: r() < 0.5 ? 'smooth' : 'bands' }) },
  { key: 'dive', title: 'Mandelbrot dive', sub: 'Into a named spot and back out', tex: TEX_M,
    scene: r => ({ mode: 'mandel', dive: true, spot: r.pick(SPOTS).id, power: 2, color: 'smooth', iters: 250 + Math.floor(150 * r()), inset: false }) },
  { key: 'multibrot', title: 'Multibrot', sub: 'Higher powers: d-fold symmetric sets', tex: TEX_D,
    scene: r => ({ mode: r() < 0.5 ? 'julia' : 'mandel', path: 'wander', power: r.pick([3, 4, 5, 2.5, 3.5]), dive: false, inset: false, zoom: 0.45, cx: 0, cy: 0 }) },
  { key: 'upstream', title: 'Upstream views', sub: 'The Mono and Gradient views of the original demo', tex: TEX_Z,
    scene: r => ({ mode: 'julia', path: 'still', cRe: -0.6258, cIm: 0.4025, color: r.pick(['mono', 'gradient']), power: 2, iters: 100, inset: false, cycle: 0 }) },
];

export function installSaver(P) {
  return director({
    kit: P.kit,
    canvas: () => P.canvas,
    shots: SHOTS.map(s => Object.assign({ params: st => [
      { sym: 'd', name: 'power', value: st.power.toFixed(2) },
      { sym: 'n', name: 'iterations', value: String(st.iters) },
    ] }, s)),
    apply(state, shot, cam) { P.t = Math.random() * 40; P.setView(shot ? { x: 0, y: 0, w: innerWidth, h: innerHeight } : null); },
    frame(band) { P.setView(band ? Object.assign({}, band) : null); },
    exit() { P.setView(null); },
  });
}
export { SHOTS };
