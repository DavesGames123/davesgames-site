// ============================================================================
//  TRIPLE PENDULUM  ·  pages/triple-pendulum/saver.js — screensaver shots
// ----------------------------------------------------------------------------
//  installSaver(C) defines window.snSaver through the sim kit director.
//  Each cut draws a fresh guarded random scene, then the shot sets what it
//  needs. TeX on the plate, no code.
//
//  grep -n targets: "const SHOTS", "export function installSaver"
// ============================================================================
import { director } from '../../widgets/sim-kit/saver.js';

const TEX_PBD = String.raw`\mathbf{v} \leftarrow \frac{\mathbf{x} - \mathbf{x}_{\mathrm{prev}}}{\Delta t},\qquad \Delta t = \frac{0.01\,\mathrm{s}}{n_{\mathrm{sub}}}`;
const TEX_LAG = String.raw`\frac{d}{dt}\frac{\partial \mathcal{L}}{\partial \dot\theta_i} - \frac{\partial \mathcal{L}}{\partial \theta_i} = 0,\qquad \mathcal{L} = T - V`;
const TEX_CHAOS = String.raw`\lvert\delta\theta(t)\rvert \approx \lvert\delta\theta_0\rvert\,e^{\lambda t}`;
const TEX_MASS = String.raw`\Delta\mathbf{x}_0 : \Delta\mathbf{x}_1 = w_0 : w_1,\qquad w = \frac{1}{m}`;

const SHOTS = [
  { key: 'analytic', title: 'PBD against the analytic solution', sub: 'Red: PBD. Green: the Lagrange equations. They agree until chaos parts them', tex: TEX_LAG,
    scene: r => ({ preset: r.pick(['equal', 'growing', 'shrinking']), start: 'upstream', analytic: true, twin: false, subIdx: '4', trail: 900, palette: 'harbour' }) },
  { key: 'butterfly', title: 'Two pendulums a hair apart', sub: 'The same PBD pendulum, started 10⁻⁴ rad apart', tex: TEX_CHAOS,
    scene: r => ({ preset: r.pick(['equal', 'lightMid', 'random']), start: r.pick(['upstream', 'up']), analytic: false, twin: true, delta: -4 - 2 * r(), subIdx: '4', trail: 900, palette: r.pick(['neon', 'toybox', 'sunset']), colorBy: 'palette' }) },
  { key: 'five', title: 'Five links', sub: 'No analytic solution here: PBD only', tex: TEX_PBD,
    scene: r => ({ preset: 'five', start: r.pick(['upstream', 'random', 'side']), twin: false, subIdx: '4', trail: 1200 }) },
  { key: 'substeps', title: 'Few substeps', sub: 'PBD stays stable with large steps; it is only less exact', tex: TEX_PBD,
    scene: r => ({ preset: r.pick(['equal', 'growing']), start: 'upstream', analytic: false, twin: false, subIdx: r.pick(['0', '1', '2']), trail: 900 }) },
  { key: 'masses', title: 'Uneven masses', sub: 'A light middle mass or light ends', tex: TEX_MASS,
    scene: r => ({ preset: r.pick(['lightMid', 'lightEnds']), start: r.pick(['upstream', 'random']), analytic: true, twin: false, subIdx: '4', trail: 900, colorBy: 'speed' }) },
  { key: 'random', title: 'A random chain', sub: 'Random masses and lengths, PBD', tex: TEX_PBD,
    scene: r => ({ preset: 'random', links: r.int(3, 6), start: 'random', twin: r() < 0.3, subIdx: '4', trail: 1400 }) },
];

export function installSaver(C) {
  return director({
    kit: C.kit,
    canvas: () => C.canvas,
    shots: SHOTS.map(s => Object.assign({ camera: () => ({ zoom: 1.3 }), params: st => [
      { sym: 'n', name: 'links', value: String(C.S.list[0] ? C.S.list[0].x.length - 1 : 3) },
      { sym: 'n_{sub}', name: 'substeps', value: ['1', '5', '10', '100', '1000', '10000'][+st.subIdx] },
      { sym: 'g', name: 'gravity', value: st.g.toFixed(1) + ' m/s²' },
    ] }, s)),
    apply(state, shot, cam) { C.rebuild(); C.P.setSaver(shot ? { x: 0, y: 0, w: innerWidth, h: innerHeight } : null, cam); },
    frame(band, cam) { C.P.setSaver(band, cam); },
    exit() { C.P.setSaver(null); },
  });
}
