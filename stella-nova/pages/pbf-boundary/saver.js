// ============================================================================
//  PBF BOUNDARIES  ·  pages/pbf-boundary/saver.js — the screensaver shots
// ----------------------------------------------------------------------------
//  installSaver(P) defines window.snSaver through the sim kit director
//  (widgets/sim-kit/saver.js). Each cut draws a fresh random scene from the
//  page randomizer, then the shot sets what it needs (a container, a fill,
//  bodies, a colour mode) and a camera: { zoom, cx, cy } in world metres,
//  with a slow spring drift. The plate shows the shot title, the scene and
//  one TeX line; the credit lines come from the TMP kit. No code.
//
//  grep -n targets
//    shot list ............ "const SHOTS"
//    camera drift ......... "function tick"
// ============================================================================
import { director } from '../../widgets/sim-kit/saver.js';

const TEX_DENSITY = String.raw`C_i = \frac{\rho_i}{\rho_0} - 1 = 0,\quad \lambda_i = -\frac{C_i}{\sum_k \lvert\nabla_{p_k} C_i\rvert^2 + \varepsilon}`;
const TEX_DELTA = String.raw`\Delta\mathbf{p}_i = \frac{1}{\rho_0}\sum_j\left(\lambda_i + \lambda_j + s_{\mathrm{corr}}\right)\nabla W(\mathbf{p}_i - \mathbf{p}_j, h)`;
const TEX_PSI = String.raw`\Psi_{b}(\rho_0) = \frac{\rho_0}{\sum_k W_{bk}},\quad \rho_i = \sum_j W_{ij} + \sum_b \Psi_b W_{ib}`;
const TEX_BUOY = String.raw`F_b = \rho_{\mathrm{w}}\, g\, A_{\mathrm{sub}}\quad\Rightarrow\quad \frac{A_{\mathrm{sub}}}{A} = \frac{\rho_{\mathrm{body}}}{\rho_{\mathrm{w}}}`;
const TEX_FRICTION = String.raw`\lvert\Delta\mathbf{x}_\perp\rvert < \mu_s d \;\Rightarrow\; \text{stick},\quad \Delta\mathbf{x}_\perp \leftarrow \min\!\left(\frac{\mu_k d}{\lvert\Delta\mathbf{x}_\perp\rvert}, 1\right)\Delta\mathbf{x}_\perp`;
const TEX_VORT = String.raw`\omega_i = \nabla\times\mathbf{v},\quad \mathbf{f}_i^{\mathrm{vort}} = \varepsilon\,(\mathbf{N}\times\omega_i),\ \mathbf{N} = \frac{\nabla\lvert\omega\rvert}{\lvert\nabla\lvert\omega\rvert\rvert}`;

const SHOTS = [
  { key: 'dam', title: 'Dam break', sub: 'A wall of water and floating bodies', tex: TEX_DENSITY,
    scene: r => ({ fill: 'dam', container: r.pick(['tank', 'tank', 'steps', 'beach']), material: 'water', nBodies: r.int(2, 6), bodySet: r.pick(['floaters', 'boats', 'mixed']), tilt: 0, spin: 0, shakeA: 0 }),
    camera: () => ({ zoom: 1 }) },
  { key: 'harbour', title: 'Harbour', sub: 'Boats and ducks on a paddle swell', tex: TEX_BUOY,
    scene: r => ({ fill: 'pool', container: 'tank', paddle: true, material: 'water', nBodies: r.int(4, 8), bodySet: r.pick(['boats', 'ducks', 'floaters']), colorBy: 'water', tilt: 0, spin: 0 }),
    camera: r => ({ zoom: 1.6, cx: 0.7 + 0.6 * r(), cy: 0.42, drift: 0.05 }) },
  { key: 'sink', title: 'Floats and sinks', sub: 'Light bodies ride the surface; stone goes down', tex: TEX_BUOY,
    scene: r => ({ fill: 'drop', container: r.pick(['tank', 'bowl']), material: 'water', nBodies: r.int(4, 8), bodySet: 'mixed', tilt: 0, spin: 0 }),
    camera: () => ({ zoom: 1.15 }) },
  { key: 'drum', title: 'Rotating drum', sub: 'Gravity turns; the water rolls over', tex: TEX_VORT,
    scene: r => ({ container: 'drum', fill: 'pool', material: 'water', spin: (r() < 0.5 ? -1 : 1) * (14 + 16 * r()), colorBy: r.pick(['speed', 'depth', 'water']), cmap: r.pick(['viridis', 'plasma', 'turbo', 'ice', 'aurora', 'glacier']), nBodies: r.int(0, 3) }),
    camera: () => ({ zoom: 1.05 }) },
  { key: 'mixer', title: 'The upstream mixer', sub: 'Grains in a round container, five turning disks', tex: TEX_FRICTION,
    scene: r => ({ container: 'mixer', fill: 'pool', material: 'granular', emitters: 0, nBodies: 0, render: 'particles', colorBy: r.pick(['speed', 'depth']), mixer: (r() < 0.5 ? -1 : 1) * (90 + 90 * r()), tilt: 0, spin: 0, mu_s: 0.2 + 0.6 * r(), mu_k: 0.2 + 0.5 * r() }),
    camera: () => ({ zoom: 1.05 }) },
  { key: 'pour', title: 'Pouring in', sub: 'Emitters fill an empty vessel', tex: TEX_DELTA,
    scene: r => ({ fill: 'empty', container: r.pick(['funnel', 'bowl', 'twin', 'steps']), material: 'water', emitters: r.int(1, 3), nBodies: r.int(0, 3), tilt: 0, spin: 0 }),
    camera: () => ({ zoom: 1 }) },
  { key: 'splash', title: 'Splash', sub: 'A column drops into the pool', tex: TEX_DELTA,
    scene: r => ({ fill: 'drop', container: 'tank', material: 'water', foam: true, render: 'smooth', colorBy: r.pick(['water', 'speed']), nBodies: r.int(0, 2), tilt: 0, spin: 0, shakeA: 0 }),
    camera: r => ({ zoom: 2.0, cx: 1.0, cy: 0.38, drift: 0.03 }) },
  { key: 'slosh', title: 'Slosh', sub: 'A shaking tank and a tilted gravity', tex: TEX_PSI,
    scene: r => ({ fill: 'pool', container: r.pick(['tank', 'beach', 'twin']), material: 'water', shakeA: 0.02 + 0.03 * r(), shakeF: 0.8 + 0.8 * r(), tilt: (r() - 0.5) * 20, spin: 0, nBodies: r.int(2, 6), bodySet: 'floaters' }),
    camera: () => ({ zoom: 1 }) },
];

export function installSaver(P) {
  let drift = 0;
  const D = director({
    kit: P.kit,
    canvas: () => P.canvas,
    shots: SHOTS.map(s => Object.assign({ params: st => [
      { sym: 'N', name: 'particles', value: String(P.S.n) },
      { sym: 'B', name: 'bodies', value: String(P.S.bodies.length) },
      { sym: 'g', name: 'gravity', value: st.g.toFixed(1) + ' m/s²' },
    ] }, s)),
    apply(state, shot, cam) { P.rebuild(); drift = 0; P.setView(shot ? { x: 0, y: 0, w: innerWidth, h: innerHeight, cam } : null); },
    frame(band, cam) { P.setView(band ? Object.assign({}, band, { cam }) : null); },
    tick(dt, ctx) {
      const cam = ctx.cam; if (!cam || !cam.drift) return;
      drift += dt;
      const v = Object.assign({}, cam, { cx: cam.cx + cam.drift * Math.sin(drift * 0.35), cy: cam.cy + cam.drift * 0.4 * Math.sin(drift * 0.5) });
      ctx.cam = cam; if (P.view) P.view.cam = v;
      P.setView(Object.assign({}, P.viewBand || { x: 0, y: 0, w: innerWidth, h: innerHeight }, { cam: v }));
    },
    exit() { P.setView(null); },
  });
  return D;
}
