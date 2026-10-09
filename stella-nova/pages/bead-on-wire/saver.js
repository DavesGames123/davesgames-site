// ============================================================================
//  BEAD ON A WIRE  ·  pages/bead-on-wire/saver.js — the screensaver shots
// ----------------------------------------------------------------------------
//  installSaver(C) defines window.snSaver through the sim kit director.
//  Each cut draws a fresh guarded random scene; the shot sets what it
//  needs. TeX on the plate, no code.
//
//  grep -n targets: "const SHOTS", "export function installSaver"
// ============================================================================
import { director } from '../../widgets/sim-kit/saver.js';

const TEX_PROJ = String.raw`\mathbf{x} \leftarrow \mathbf{c} + R\,\frac{\mathbf{x} - \mathbf{c}}{\lvert\mathbf{x} - \mathbf{c}\rvert},\qquad F = \frac{\lambda}{\Delta t^2}`;
const TEX_ANA = String.raw`\ddot\theta = -\frac{g}{R}\sin\theta,\qquad N = m\left(\omega^2 R + g\cos\theta\right)`;
const TEX_LOOP = String.raw`v_{\mathrm{bottom}} > 2\sqrt{gR}\ \Rightarrow\ \text{over the top}`;
const TEX_SMALL = String.raw`T \approx 2\pi\sqrt{R/g}\quad(\theta \ll 1)`;
const TEX_CURVE = String.raw`t^\ast = \arg\min_t \lvert\mathbf{x} - \mathbf{w}(t)\rvert,\qquad \mathbf{x} \leftarrow \mathbf{w}(t^\ast)`;

const SHOTS = [
  { key: 'drop', title: 'Released from rest', sub: 'Red: PBD, 1000 substeps. Green: the analytic solution', tex: TEX_ANA,
    scene: r => ({ shape: 'circle', beads: 1, start: 60 + 110 * r(), v0: 0, analytic: true, tilt: 0, friction: 0, sub: '1000', arrows: true, trail: 200 }) },
  { key: 'loop', title: 'Looping the wire', sub: 'Fast enough at the bottom, the bead goes over the top', tex: TEX_LOOP,
    scene: r => ({ shape: 'circle', beads: 1, start: 0, v0: 9 + 2 * r(), analytic: true, tilt: 0, friction: 0, sub: '1000', g: 10, trail: 300 }) },
  { key: 'small', title: 'Small swings', sub: 'Near the bottom the bead is a simple pendulum', tex: TEX_SMALL,
    scene: r => ({ shape: 'circle', beads: 1, start: 12 + 10 * r(), v0: 0, analytic: true, tilt: 0, friction: 0, sub: '1000', trail: 120 }),
    camera: () => ({ zoom: 1.9, cx: 1.2, cy: 0.45 }) },
  { key: 'onestep', title: 'One step per frame', sub: 'With one PBD step per frame the red bead loses energy', tex: TEX_PROJ,
    scene: r => ({ shape: 'circle', beads: 1, start: 90 + 60 * r(), v0: 0, analytic: true, tilt: 0, friction: 0, sub: '1', trail: 300 }) },
  { key: 'shapes', title: 'Other wires', sub: 'The bead follows the closest point of any curve', tex: TEX_CURVE,
    scene: r => ({ shape: r.pick(['ellipse', 'squircle', 'heart', 'wave']), beads: r.int(2, 6), v0: 1 + 3 * r(), sub: '200', trail: 300, colorBy: r.pick(['palette', 'speed']) }) },
  { key: 'necklace', title: 'A necklace', sub: 'Several beads on one wire, each on its own', tex: TEX_PROJ,
    scene: r => ({ shape: r.pick(['circle', 'ellipse']), beads: r.int(5, 8), v0: 2 + 4 * r(), analytic: false, sub: '200', trail: 400, colorBy: 'speed' }) },
];

export function installSaver(C) {
  return director({
    kit: C.kit,
    canvas: () => C.canvas,
    shots: SHOTS.map(s => Object.assign({ camera: () => ({ zoom: 1.05 }), params: st => [
      { sym: 'g', name: 'gravity', value: st.g.toFixed(1) + ' m/s²' },
      { sym: 'n_{sub}', name: 'substeps', value: st.sub },
      { sym: 'F', name: 'PBD force', value: C.S.beads[0] ? C.S.beads[0].force.toFixed(1) + ' N' : '' },
    ] }, s)),
    apply(state, shot, cam) { C.rebuild(); C.P.setSaver(shot ? { x: 0, y: 0, w: innerWidth, h: innerHeight } : null, cam); },
    frame(band, cam) { C.P.setSaver(band, cam); },
    exit() { C.P.setSaver(null); },
  });
}
