// ============================================================================
//  FIRE SIMULATION  ·  pages/fire-simulation/saver.js — the screensaver shots
// ----------------------------------------------------------------------------
//  installSaver(P) defines window.snSaver through the sim kit director. Each
//  cut draws a fresh random scene, the shot sets its burners and look, and
//  the sim runs ahead so the shot opens on flames. Plate: title, values and
//  one TeX line; credit lines from the TMP kit. No code. Our code.
//  grep -n targets: "const SHOTS"
// ============================================================================
import { director } from '../../widgets/sim-kit/saver.js';
import * as SV from './solver.js';

const TEX_HEAT = String.raw`\frac{\partial T}{\partial t} + (\mathbf{u}\cdot\nabla)T = -k(T),\quad k = \begin{cases} k_{\mathrm{fire}} & T \ge 0.3 \\ k_{\mathrm{smoke}} & T < 0.3 \end{cases}`;
const TEX_LIFT = String.raw`\Delta v = \left(T\,v_{\mathrm{lift}} - v\right) a\,\Delta t`;
const TEX_SWIRL = String.raw`\mathbf{u} \leftarrow \mathbf{u}_{\mathrm{swirl}} + \omega \times \mathbf{r},\quad \omega \in [-\omega_0, \omega_0],\ \tau = 1\,\mathrm{s}`;
const TEX_DIV = String.raw`\nabla\cdot\mathbf{u} = 0`;

const SHOTS = [
  { key: 'ring', title: 'Burning ring', sub: 'Hot cells rise, cool and turn to smoke', tex: TEX_HEAT,
    scene: r => ({ preset: 'ring', nBurn: 1, motion: r.pick(['sweep', 'orbit']), fire: r.pick(['upstream', 'campfire']), colorBy: 'flame', showBurners: true }), warm: 120 },
  { key: 'floor', title: 'Burning floor', sub: 'The whole floor burns; an unlit ring stirs the air', tex: TEX_LIFT,
    scene: r => ({ preset: 'floor', floor: true, fireCool: 1.2 + 0.6 * r(), lift: 2.5 + r(), smokeCool: 0.4, motion: 'orbit', fire: r.pick(['upstream', 'campfire', 'blue', 'violet']), colorBy: 'flame' }), warm: 120 },
  { key: 'campfire', title: 'Campfire', sub: 'Logs side by side feed one plume', tex: TEX_LIFT,
    scene: r => ({ preset: 'campfire', nBurn: r.int(2, 4), motion: 'static', fire: 'campfire', wind: (r() - 0.5) * 0.6, colorBy: 'flame', theme: r.pick(['night', 'ember', 'abyss']) }), warm: 150,
    camera: () => ({ zoom: 1.35, cx: 0.5, cy: 0.4 }) },
  { key: 'torches', title: 'Torches', sub: 'Jets of hot gas in a row', tex: TEX_LIFT,
    scene: r => ({ preset: 'torches', nBurn: r.int(3, 6), motion: r.pick(['static', 'bob']), fire: r.pick(['blue', 'green', 'violet', 'white', 'ghost']), colorBy: 'flame' }), warm: 120 },
  { key: 'swirls', title: 'Swirls', sub: 'Random vortices start in the flame and decay in one second', tex: TEX_SWIRL,
    scene: r => ({ preset: 'ring', floor: false, prob: 100, showSwirls: true, swirlW: 25 + 10 * r(), motion: 'sweep', colorBy: 'flame' }), warm: 120 },
  { key: 'laminar', title: 'No swirls', sub: 'Swirl probability 0: a smooth, laminar plume', tex: TEX_DIV,
    scene: r => ({ preset: r.pick(['ring', 'torches']), prob: 0, motion: 'sweep', colorBy: r.pick(['flame', 'map']), cmap: r.pick(['inferno', 'magma', 'ember', 'gold-leaf']) }), warm: 140 },
  { key: 'wind', title: 'In the wind', sub: 'A side draft bends the plume', tex: TEX_LIFT,
    scene: r => ({ preset: r.pick(['mixed', 'campfire']), wind: (r() < 0.5 ? -1 : 1) * (0.5 + 0.5 * r()), lift: 3 + 2 * r(), colorBy: 'flame' }), warm: 160 },
  { key: 'blaze', title: 'Ring over fire', sub: 'The floor and a fast ring both burn', tex: TEX_HEAT,
    scene: r => ({ preset: 'both', floor: true, fireCool: 1.3 + 0.5 * r(), lift: 2.5 + r(), smokeCool: 0.4, motion: 'orbit', speed: 0.25 + 0.1 * r(), fire: r.pick(['upstream', 'campfire', 'violet']), colorBy: 'flame', glow: 0.8 }), warm: 120 },
];

export function installSaver(P) {
  const warm = n => { for (let k = 0; k < n; k++) SV.step(P.S); };
  return director({
    kit: P.kit,
    canvas: () => P.canvas,
    shots: SHOTS.map(s => Object.assign({ params: st => [
      { sym: 'v', name: 'lift', value: st.lift.toFixed(1) + ' m/s' },
      { sym: 'k', name: 'fire cooling', value: st.fireCool.toFixed(2) + ' /s' },
      { sym: 'p', name: 'swirls', value: String(st.prob) },
    ] }, s)),
    apply(state, shot, cam) { P.rebuild(); if (shot && shot.warm) warm(Math.round(shot.warm * (P.kit.phone ? 0.5 : 1))); P.setView(shot ? { x: 0, y: 0, w: innerWidth, h: innerHeight, cam } : null); },
    frame(band, cam) { P.setView(band ? Object.assign({}, band, { cam }) : null); },
    exit() { P.setView(null); },
  });
}
export { SHOTS };
