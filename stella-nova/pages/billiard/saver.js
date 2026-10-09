// ============================================================================
//  BILLIARD  ·  pages/billiard/saver.js — the screensaver shots
// ----------------------------------------------------------------------------
//  installSaver(C) defines window.snSaver through the sim kit director.
//  Each cut draws a fresh guarded random scene; the shot sets what it
//  needs. TeX on the plate, no code.
//
//  grep -n targets: "const SHOTS", "export function installSaver"
// ============================================================================
import { director } from '../../widgets/sim-kit/saver.js';

const TEX_COLL = String.raw`v_1' = \frac{m_1 v_1 + m_2 v_2 - m_2 (v_1 - v_2)\,e}{m_1 + m_2}`;
const TEX_MB = String.raw`f(v) = \frac{m v}{k T}\,e^{-m v^2 / 2kT}\quad(\text{2D})`;
const TEX_BROWN = String.raw`\langle \lvert\Delta\mathbf{x}\rvert^2\rangle \approx 4 D t`;
const TEX_MIX = String.raw`\Delta S = -N k \sum_i x_i \ln x_i > 0`;
const TEX_MOM = String.raw`\sum_i m_i \mathbf{v}_i = \text{const},\qquad \tfrac12\sum_i m_i v_i^2 = \text{const}\ (e = 1)`;

const SHOTS = [
  { key: 'random', title: 'Billiard', sub: 'The upstream scene: balls of random size in a box', tex: TEX_COLL,
    scene: r => ({ layout: 'random', table: 'box', count: 20 + r.int(0, 20), rMin: 0.04, rMax: 0.12, e: 1, eWall: 1, roll: 0, g: 0, bumpers: r.int(0, 3), trail: 30 }) },
  { key: 'break', title: 'The break', sub: 'A cue ball into a racked triangle', tex: TEX_MOM,
    scene: r => ({ layout: 'break', table: 'pool', count: 16, rMin: 0.035, rMax: 0.035, e: 0.95, eWall: 0.8, roll: 0.25 + 0.2 * r(), g: 0, bumpers: 0, trail: 60, colorBy: 'pool', hist: false }) },
  { key: 'gas', title: 'A gas', sub: 'Many small balls settle into the Maxwell–Boltzmann speeds', tex: TEX_MB,
    scene: r => ({ layout: 'gas', table: r.pick(['box', 'round']), count: 160 + r.int(0, 100), rMin: 0.015, rMax: 0.022, e: 1, eWall: 1, roll: 0, g: 0, speed: 2, colorBy: 'speed', hist: true, trail: 0, bumpers: 0 }) },
  { key: 'mixing', title: 'Two gases mixing', sub: 'A divider lifts; the colours spread into each other', tex: TEX_MIX,
    scene: r => ({ layout: 'mixing', table: 'box', count: 140 + r.int(0, 80), rMin: 0.016, rMax: 0.028, e: 1, eWall: 1, roll: 0, g: 0, speed: 1.6, colorBy: 'side', trail: 0, bumpers: 0 }) },
  { key: 'brownian', title: 'Brownian motion', sub: 'One large ball, jostled by many small ones', tex: TEX_BROWN,
    scene: r => ({ layout: 'brownian', table: 'box', count: 160 + r.int(0, 80), rMin: 0.012, rMax: 0.02, e: 1, eWall: 1, roll: 0, g: 0, speed: 2.5, colorBy: 'speed', trail: 400, bumpers: 0 }) },
  { key: 'lattice', title: 'A struck lattice', sub: 'One ball fired into a still grid', tex: TEX_COLL,
    scene: r => ({ layout: 'lattice', table: 'box', count: 80 + r.int(0, 80), rMin: 0.03, rMax: 0.035, e: 0.9 + 0.1 * r(), eWall: 1, roll: 0, g: 0, colorBy: 'speed', trail: 20, bumpers: 0 }) },
  { key: 'rain', title: 'Balls under gravity', sub: 'Gravity on, the balls pile up and bounce', tex: TEX_COLL,
    scene: r => ({ layout: 'random', table: r.pick(['box', 'round']), count: 60 + r.int(0, 60), rMin: 0.03, rMax: 0.07, e: 0.85, eWall: 0.85, roll: 0, g: 2 + 3 * r(), colorBy: r.pick(['speed', 'palette']), trail: 10, bumpers: r.int(0, 4) }) },
];

export function installSaver(C) {
  return director({
    kit: C.kit,
    canvas: () => C.canvas,
    shots: SHOTS.map(s => Object.assign({ camera: () => ({ zoom: 1.04 }), params: st => [
      { sym: 'N', name: 'balls', value: String(C.S.n - C.S.potted) },
      { sym: 'e', name: 'restitution', value: st.e.toFixed(2) },
      { sym: 'g', name: 'gravity', value: st.g.toFixed(1) + ' m/s²' },
    ] }, s)),
    apply(state, shot, cam) { C.rebuild(); C.P.setSaver(shot ? { x: 0, y: 0, w: innerWidth, h: innerHeight } : null, cam); },
    frame(band, cam) { C.P.setSaver(band, cam); },
    exit() { C.P.setSaver(null); },
  });
}
