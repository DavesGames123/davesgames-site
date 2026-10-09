// ============================================================================
//  CANNONBALL 2D  ·  pages/cannonball-2d/saver.js — the screensaver shots
// ----------------------------------------------------------------------------
//  installSaver(C) defines window.snSaver through the sim kit director
//  (widgets/sim-kit/saver.js). Each cut draws a fresh random scene with the
//  page guard, then the shot sets what it needs and a camera. The plate
//  shows the title, the scene values and one TeX line; no code.
//
//  grep -n targets: "const SHOTS", "export function installSaver"
// ============================================================================
import { director } from '../../widgets/sim-kit/saver.js';

const TEX_EULER = String.raw`\mathbf{v} \leftarrow \mathbf{v} + \mathbf{g}\,\Delta t,\qquad \mathbf{x} \leftarrow \mathbf{x} + \mathbf{v}\,\Delta t`;
const TEX_APEX = String.raw`h_{\max} = \frac{v_0^2 \sin^2\theta}{2g},\qquad R = \frac{v_0^2 \sin 2\theta}{g}`;
const TEX_BOUNCE = String.raw`v_n' = -e\,v_n,\qquad h_{k+1} = e^2\, h_k`;
const TEX_GALTON = String.raw`P(k) = \binom{n}{k}\,2^{-n}\ \longrightarrow\ \mathcal{N}\!\left(\tfrac{n}{2},\ \tfrac{n}{4}\right)`;
const TEX_DRAG = String.raw`\dot{\mathbf{v}} = \mathbf{g} - k\,\mathbf{v},\qquad v_\infty = \frac{g}{k}`;
const TEX_IMPULSE = String.raw`J = \frac{-(1+e)\,v_{\mathrm{rel}}\cdot\mathbf{n}}{1/m_1 + 1/m_2}`;

const SHOTS = [
  { key: 'arc', title: 'Cannonball', sub: 'Gravity and one explicit Euler step per frame', tex: TEX_EULER,
    scene: r => ({ pegs: 'none', side: 'left', g: 10, wind: 0, drag: 0, e: 0.9 + 0.08 * r(), rate: 0.8 + r(), count: 12, collide: false, trail: 200 }) },
  { key: 'moon', title: 'On the Moon', sub: 'g = 1.62 m/s²: wide, slow arcs', tex: TEX_APEX,
    scene: r => ({ pegs: 'none', g: 1.62, wind: 0, drag: 0, e: 0.85 + 0.1 * r(), rate: 0.6 + 0.6 * r(), count: 10, angle: 50 + 25 * r(), speed: 5 + 2 * r(), trail: 220 }) },
  { key: 'galton', title: 'Galton board', sub: 'Balls fall through rows of pegs', tex: TEX_GALTON,
    scene: r => ({ pegs: 'galton', nPegs: 30 + Math.floor(25 * r()), pegR: 0.14, rate: 4 + 3 * r(), count: 110, collide: true, r: 0.14, rVar: 0.1, e: 0.45 + 0.15 * r(), drag: 0.1, trail: 30, wind: 0 }),
    camera: () => ({ zoom: 1 }) },
  { key: 'bumpers', title: 'Bumpers', sub: 'Pegs that kick back harder than they are hit', tex: TEX_BOUNCE,
    scene: r => ({ pegs: r.pick(['wall', 'ring', 'scatter']), kick: 1.15 + 0.15 * r(), e: 0.8, rate: 1.5 + r(), count: 30, collide: true, colorBy: 'speed', trail: 120 }) },
  { key: 'wind', title: 'A side wind', sub: 'Gravity gets an x part; every arc leans', tex: TEX_DRAG,
    scene: r => ({ pegs: 'none', wind: (r() < 0.5 ? -1 : 1) * (1.5 + 2 * r()), drag: 0.05 + 0.15 * r(), rate: 1.5, count: 24, trail: 200, colorBy: 'height' }) },
  { key: 'crowd', title: 'A crowded box', sub: 'Many balls, colliding with each other', tex: TEX_IMPULSE,
    scene: r => ({ pegs: r.pick(['none', 'scatter']), side: 'both', rate: 4 + 3 * r(), count: 90, collide: true, rVar: 0.4 + 0.3 * r(), e: 0.7 + 0.2 * r(), colorBy: r.pick(['speed', 'energy']), trail: 30 }) },
  { key: 'close', title: 'Close up', sub: 'The cannon and the first bounces', tex: TEX_EULER,
    scene: r => ({ pegs: 'none', side: 'left', rate: 1.2 + r(), count: 16, trail: 160, glow: true }),
    camera: r => ({ zoom: 1.9, cx: 4 + 2 * r(), cy: 2.6 }) },
];

export function installSaver(C) {
  return director({
    kit: C.kit,
    canvas: () => C.canvas,
    shots: SHOTS.map(s => Object.assign({ params: st => [
      { sym: 'g', name: 'gravity', value: st.g.toFixed(2) + ' m/s²' },
      { sym: 'e', name: 'bounce', value: st.e.toFixed(2) },
      { sym: 'N', name: 'balls', value: String(C.S.n) },
    ] }, s)),
    apply(state, shot, cam) { C.rebuild(); C.P.setSaver(shot ? { x: 0, y: 0, w: innerWidth, h: innerHeight } : null, cam); },
    frame(band, cam) { C.P.setSaver(band, cam); },
    exit() { C.P.setSaver(null); },
  });
}
