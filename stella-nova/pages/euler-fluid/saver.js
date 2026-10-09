// ============================================================================
//  EULER FLUID  ·  pages/euler-fluid/saver.js — the screensaver shots
// ----------------------------------------------------------------------------
//  installSaver(P) defines window.snSaver through the sim kit director
//  (widgets/sim-kit/saver.js). Each cut draws a fresh random scene from the
//  page randomizer, the shot sets what it needs, and the sim runs ahead a
//  little so the shot opens on a developed flow. The plate shows the title,
//  live values and one TeX line; the credit lines come from the TMP kit.
//  No code. Our code (davesgames.io).
//
//  grep -n targets: "const SHOTS", "function warm"
// ============================================================================
import { director } from '../../widgets/sim-kit/saver.js';
import * as SV from './solver.js';

const TEX_NS = String.raw`\frac{\partial \mathbf{u}}{\partial t} + (\mathbf{u}\cdot\nabla)\mathbf{u} = -\frac{\nabla p}{\rho} + \mathbf{g},\qquad \nabla\cdot\mathbf{u} = 0`;
const TEX_DIV = String.raw`d = u_{i+1,j} - u_{i,j} + v_{i,j+1} - v_{i,j},\qquad p_{i,j} \mathrel{+}= \frac{\rho h}{\Delta t}\,\omega\,\frac{-d}{s}`;
const TEX_ADV = String.raw`\mathbf{u}^{n+1}(\mathbf{x}) = \mathbf{u}^{n}\!\left(\mathbf{x} - \Delta t\,\mathbf{u}^{n}(\mathbf{x})\right)`;
const TEX_HYD = String.raw`p = \rho\, g\, h`;
const TEX_VORT = String.raw`\omega = \frac{\partial v}{\partial x} - \frac{\partial u}{\partial y}`;
const TEX_STROUHAL = String.raw`\mathrm{St} = \frac{f\,D}{U} \approx 0.2`;

const SHOTS = [
  { key: 'street', title: 'Vortex street', sub: 'Smoke shows the wake behind a body in a wind tunnel', tex: TEX_STROUHAL,
    scene: r => ({ kind: 'tunnel', nObs: 1, shapes: r.pick(['circles', 'foils', 'squares']), motion: 'static', colorBy: 'smoke', streaks: r.int(1, 7), stream: false, vel: false }), warm: 160,
    camera: () => ({ zoom: 1 }) },
  { key: 'pressure', title: 'Pressure around bodies', sub: 'High pressure in front, low pressure in the wake', tex: TEX_DIV,
    scene: r => ({ kind: 'tunnel', nObs: r.int(1, 3), colorBy: r.pick(['pressure', 'pressmoke']), cmap: r.pick(['coolwarm', 'berlin', 'vanimo', 'turbo', 'plasma']), stream: r() < 0.5 }), warm: 120,
    camera: () => ({ zoom: 1 }) },
  { key: 'vorticity', title: 'Vorticity', sub: 'Spin of the flow: red one way, blue the other', tex: TEX_VORT,
    scene: r => ({ kind: r.pick(['tunnel', 'tunnel', 'cavity', 'jets']), colorBy: 'vorticity', cmap: r.pick(['coolwarm', 'berlin', 'vanimo', 'twilight']), nObs: r.int(1, 4), motion: r.pick(['mixed', 'static', 'orbit']) }), warm: 140,
    camera: () => ({ zoom: 1 }) },
  { key: 'paint', title: 'Paint', sub: 'Moving bodies stir coloured dye', tex: TEX_ADV,
    scene: r => ({ kind: 'paint', nObs: r.int(1, 3), motion: r.pick(['orbit', 'mixed', 'sweep']), colorBy: 'smoke', cmap: r.pick(['turbo', 'twilight', 'synthwave', 'nebula', 'aurora', 'phase-wheel']), over: false, speed: 0.15 + 0.2 * r() }), warm: 200,
    camera: () => ({ zoom: 1 }) },
  { key: 'tank', title: 'Pressure in a tank', sub: 'Gravity on: pressure rises with depth', tex: TEX_HYD,
    scene: r => ({ kind: 'tank', colorBy: 'pressure', nObs: r.int(0, 2), motion: 'bob', cmap: r.pick(['ocean', 'ice', 'viridis', 'mako']), g: 9.81 }), warm: 60,
    camera: () => ({ zoom: 1 }) },
  { key: 'cavity', title: 'Lid-driven cavity', sub: 'A moving lid drives a big vortex and corner eddies', tex: TEX_NS,
    scene: r => ({ kind: 'cavity', nObs: r.int(0, 1), colorBy: r.pick(['speed', 'vorticity']), stream: true, aspect: 1.2 + 0.4 * r(), cmap: r.pick(['magma', 'inferno', 'mako', 'rocket', 'glacier']) }), warm: 240,
    camera: () => ({ zoom: 1 }) },
  { key: 'jets', title: 'Colliding jets', sub: 'Dye jets meet and roll up', tex: TEX_ADV,
    scene: r => ({ kind: 'jets', nObs: r.int(0, 2), colorBy: 'smoke', cmap: r.pick(['turbo', 'twilight', 'phase-wheel', 'synthwave', 'nebula']) }), warm: 160,
    camera: () => ({ zoom: 1 }) },
  { key: 'close', title: 'Close up on the wake', sub: 'Shear layers roll up into vortices', tex: TEX_VORT,
    scene: r => ({ kind: 'tunnel', nObs: 1, shapes: r.pick(['circles', 'plates', 'foils']), motion: 'static', colorBy: r.pick(['smoke', 'vorticity']), streaks: r.int(3, 9), streakW: 0.04 }), warm: 220,
    camera: r => ({ zoom: 1.9, cx: 0.75 + 0.35 * r(), cy: 0.5 }) },
];

export function installSaver(P) {
  const warm = n => { for (let k = 0; k < n; k++) SV.step(P.S); };
  return director({
    kit: P.kit,
    canvas: () => P.canvas,
    shots: SHOTS.map(s => Object.assign({ params: st => [
      { sym: 'U', name: 'inflow', value: st.inVel.toFixed(1) + ' m/s' },
      { sym: 'N', name: 'cells', value: P.S.f ? `${P.S.f.numX - 2} × ${P.S.f.numY - 2}` : '' },
      { sym: 'n', name: 'obstacles', value: String(P.S.obstacles.length) },
    ] }, s)),
    apply(state, shot, cam) { P.rebuild(); if (shot && shot.warm) warm(Math.round(shot.warm * (P.kit.phone ? 0.5 : 1))); P.setView(shot ? { x: 0, y: 0, w: innerWidth, h: innerHeight, cam } : null); },
    frame(band, cam) { P.setView(band ? Object.assign({}, band, { cam }) : null); },
    exit() { P.setView(null); },
  });
}
export { SHOTS };
