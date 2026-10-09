// ============================================================================
//  MANY BEADS  ·  pages/many-beads/saver.js — the screensaver shots
// ----------------------------------------------------------------------------
//  installSaver(C) defines window.snSaver through the sim kit director.
//  Each cut draws a fresh guarded random scene; the shot sets what it
//  needs. TeX on the plate, no code.
//
//  grep -n targets: "const SHOTS", "export function installSaver"
// ============================================================================
import { director } from '../../widgets/sim-kit/saver.js';

const TEX_COLL = String.raw`v_1' = \frac{m_1 v_1 + m_2 v_2 - m_2 (v_1 - v_2)\,e}{m_1 + m_2}`;
const TEX_MOM = String.raw`m_1 v_1 + m_2 v_2 = m_1 v_1' + m_2 v_2',\qquad e = -\frac{v_1' - v_2'}{v_1 - v_2}`;
const TEX_WIRE = String.raw`\mathbf{x} \leftarrow \mathbf{c} + R\,\frac{\mathbf{x} - \mathbf{c}}{\lvert\mathbf{x} - \mathbf{c}\rvert}`;
const TEX_PUSH = String.raw`\Delta\mathbf{x}_{1,2} = \mp\tfrac12\,(r_1 + r_2 - d)\,\mathbf{n}`;

const SHOTS = [
  { key: 'upstream', title: 'Five beads', sub: 'The upstream scene: beads of random size on one wire', tex: TEX_COLL,
    scene: r => ({ rings: 1, count: 5, start: 'upstream', massRule: 'area', e: 1, friction: 0, tilt: 0, turn: 0, rMin: 0.05, rMax: 0.15, trail: 30 }) },
  { key: 'cradle', title: "Newton's cradle", sub: 'Equal beads in a row; one swings in', tex: TEX_MOM,
    scene: r => ({ rings: 1, count: r.int(4, 7), start: 'cradle', massRule: 'equal', e: 0.98 + 0.02 * r(), friction: 0, tilt: 0, turn: 0, rMin: 0.07, rMax: 0.09, trail: 20, colorBy: 'speed' }),
    camera: () => ({ zoom: 1.55, cx: 1.2, cy: 0.55 }) },
  { key: 'crowd', title: 'A crowded wire', sub: 'Dozens of beads, all colliding', tex: TEX_PUSH,
    scene: r => ({ rings: 1, count: 24 + r.int(0, 16), start: r.pick(['random', 'spin']), e: 0.85 + 0.15 * r(), rMin: 0.03, rMax: 0.07, trail: 10, colorBy: r.pick(['speed', 'palette']) }) },
  { key: 'rings', title: 'Three wires', sub: 'Each wire is its own world', tex: TEX_WIRE,
    scene: r => ({ rings: 3, count: 6 + r.int(0, 8), start: r.pick(['spin', 'random']), turn: (r() < 0.5 ? -1 : 1) * (10 + 20 * r()), colorBy: 'wire', trail: 40 }) },
  { key: 'inelastic', title: 'Sticky beads', sub: 'Restitution below one: the beads lose energy and bunch up', tex: TEX_MOM,
    scene: r => ({ rings: 1, count: 10 + r.int(0, 10), start: 'spin', e: 0.2 + 0.4 * r(), friction: 0, colorBy: 'speed', trail: 20 }) },
  { key: 'turn', title: 'Turning gravity', sub: 'Gravity rotates; the beads pile to one side then the other', tex: TEX_WIRE,
    scene: r => ({ rings: r.int(1, 2), count: 8 + r.int(0, 10), start: 'cluster', turn: (r() < 0.5 ? -1 : 1) * (20 + 25 * r()), trail: 30 }) },
];

export function installSaver(C) {
  return director({
    kit: C.kit,
    canvas: () => C.canvas,
    shots: SHOTS.map(s => Object.assign({ camera: () => ({ zoom: 1.08 }), params: st => [
      { sym: 'N', name: 'beads', value: String(C.S.b.length) },
      { sym: 'e', name: 'restitution', value: st.e.toFixed(2) },
      { sym: 'g', name: 'gravity', value: st.g.toFixed(1) + ' m/s²' },
    ] }, s)),
    apply(state, shot, cam) { C.rebuild(); C.P.setSaver(shot ? { x: 0, y: 0, w: innerWidth, h: innerHeight } : null, cam); },
    frame(band, cam) { C.P.setSaver(band, cam); },
    exit() { C.P.setSaver(null); },
  });
}
