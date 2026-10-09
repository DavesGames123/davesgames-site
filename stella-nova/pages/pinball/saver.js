// ============================================================================
//  PINBALL  ·  pages/pinball/saver.js — the screensaver shots
// ----------------------------------------------------------------------------
//  installSaver(C) defines window.snSaver through the sim kit director.
//  Each cut draws a fresh guarded random table; the autopilot plays it.
//  TeX on the plate, no code.
//
//  grep -n targets: "const SHOTS", "export function installSaver"
// ============================================================================
import { director } from '../../widgets/sim-kit/saver.js';

const TEX_BUMP = String.raw`v_n' = v_{\mathrm{push}}\quad\text{(the bumper sets the normal speed)}`;
const TEX_FLIP = String.raw`\mathbf{v}_{\mathrm{surf}} = \omega\,\mathbf{r}^{\perp},\qquad v_n' = \mathbf{v}_{\mathrm{surf}}\cdot\mathbf{n}`;
const TEX_BORDER = String.raw`\mathbf{n} = \frac{\mathbf{x} - \mathbf{c}}{\lvert\mathbf{x} - \mathbf{c}\rvert},\qquad v_n' = e\,\lvert v_n\rvert`;
const TEX_BALL = String.raw`v_1' = \frac{m_1 v_1 + m_2 v_2 - m_2 (v_1 - v_2)\,e}{m_1 + m_2}`;

const SHOTS = [
  { key: 'play', title: 'Pinball', sub: 'The upstream table: four bumpers and two flippers', tex: TEX_BUMP,
    scene: r => ({ layout: 'upstream', balls: 2, auto: true, drain: false, trail: 40 }) },
  { key: 'multiball', title: 'Multiball', sub: 'Six balls at once: ball-ball hits with restitution', tex: TEX_BALL,
    scene: r => ({ layout: r.pick(['random', 'triangle']), balls: 6, auto: true, trail: 30, colorBy: 'palette' }) },
  { key: 'hot', title: 'Hot bumpers', sub: 'A strong push and a crowded field', tex: TEX_BUMP,
    scene: r => ({ layout: 'random', nBump: 8 + r.int(0, 3), push: 2.6 + 0.4 * r(), g: 3.2 + r(), balls: r.int(2, 4), auto: true, trail: 60, colorBy: 'speed' }) },
  { key: 'flipper', title: 'Flipper contact', sub: 'The moving flipper surface sets the ball speed', tex: TEX_FLIP,
    scene: r => ({ layout: r.pick(['upstream', 'triangle']), balls: 1, auto: true, trail: 80 }),
    camera: () => ({ zoom: 2.0, cx: 0.5, cy: 0.42 }) },
  { key: 'pachinko', title: 'Pachinko', sub: 'A field of posts, one bumper on top', tex: TEX_BORDER,
    scene: r => ({ layout: 'pachinko', balls: r.int(3, 5), auto: true, trail: 50, push: 2.4 }) },
  { key: 'ring', title: 'Bumper ring', sub: 'A ring of bumpers in the middle of the table', tex: TEX_BUMP,
    scene: r => ({ layout: 'ring', nBump: r.int(5, 8), balls: r.int(2, 4), auto: true, trail: 50 }) },
];

export function installSaver(C) {
  return director({
    kit: C.kit,
    canvas: () => C.canvas,
    shots: SHOTS.map(s => Object.assign({ params: st => [
      { sym: 'N', name: 'balls', value: String(C.S.balls.length) },
      { sym: 'v_{push}', name: 'bumper push', value: st.push.toFixed(2) + ' m/s' },
      { sym: 'g', name: 'table tilt', value: st.g.toFixed(1) + ' m/s²' },
    ] }, s)),
    apply(state, shot, cam) { C.rebuild(); C.P.setSaver(shot ? { x: 0, y: 0, w: innerWidth, h: innerHeight } : null, cam); },
    frame(band, cam) { C.P.setSaver(band, cam); },
    exit() { C.P.setSaver(null); },
  });
}
