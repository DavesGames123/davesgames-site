// ============================================================================
//  SPATIAL HASHING  ·  pages/spatial-hashing/saver.js — the screensaver shots
// ----------------------------------------------------------------------------
//  installSaver(P) defines window.snSaver through the sim kit director
//  (widgets/sim-kit/saver.js). Each cut draws a fresh random scene from the
//  page randomizer, the shot sets its start and look, and a camera for the
//  stage spring camera (stage3d.js): an orbit, a push-in, a close-up on
//  the probe ball and its 27-cell query, or a view that follows the
//  stirrer. Some shots swing gravity while they run. The plate shows the
//  title, the live pair counts and one TeX line; the TMP kit adds the
//  credit lines. No code.
//
//  grep -n targets: "export const SHOTS", "function camAt"
// ============================================================================
import { director } from '../../widgets/sim-kit/saver.js';

const TEX_HASH = String.raw`h = \bigl|\,x_i \cdot 92837111 \oplus y_i \cdot 689287499 \oplus z_i \cdot 283923481\,\bigr| \bmod 2N`;
const TEX_CELL = String.raw`(x_i, y_i, z_i) = \left\lfloor \frac{\mathbf{p}}{2r} \right\rfloor`;
const TEX_CONTACT = String.raw`d < 2r:\quad \mathbf{p}_{i,j} \mathrel{\pm}= \tfrac{1}{2}(2r - d)\,\mathbf{n},\quad v_{i,n} \leftrightarrow v_{j,n}`;
const TEX_COST = String.raw`\text{pairs} \approx 27\,N\,\bar{n} \ll \tfrac{1}{2}N(N-1)`;
const TEX_GRAV = String.raw`\mathbf{v} \leftarrow \mathbf{v} + \mathbf{g}\,\Delta t,\qquad \mathbf{p} \leftarrow \mathbf{p} + \mathbf{v}\,\Delta t`;

export const SHOTS = [
  { key: 'gas', title: 'A hashed gas', sub: 'Each ball checks only the 27 cells around it', tex: TEX_COST,
    scene: r => ({ start: 'gas', g: 0, colorBy: r.pick(['speed', 'collisions', 'bucket']), probeOn: false }),
    camera: r => ({ kind: 'orbit', a0: r() * 6.28, dir: r() < 0.5 ? -1 : 1, R: 1.15, el: 0.35 + 0.2 * r() }) },
  { key: 'probe', title: 'One query', sub: 'The white ball and the candidates its hash query returns', tex: TEX_CELL,
    scene: r => ({ start: r.pick(['gas', 'layers']), g: 0, probeOn: true, cells: true, colorBy: r.pick(['origin', 'palette', 'height']), speed: 0.1 + 0.15 * r() }),
    camera: r => ({ kind: 'probe', az: r() * 6.28 }) },
  { key: 'burst', title: 'Burst', sub: 'A packed cube flies apart; the hash is built again every step', tex: TEX_HASH,
    scene: r => ({ start: 'burst', g: 0, colorBy: r.pick(['speed', 'bucket', 'origin']), speed: 0.3 + 0.4 * r() }),
    camera: r => ({ kind: 'push', az: r() * 6.28 }) },
  { key: 'twin', title: 'Two clouds collide', sub: 'Two gases meet in the middle and mix', tex: TEX_CONTACT,
    scene: r => ({ start: 'twin', g: 0, colorBy: 'origin', speed: 0.4 + 0.5 * r() }),
    camera: r => ({ kind: 'orbit', a0: (r() - 0.5) * 0.6, dir: r() < 0.5 ? -1 : 1, R: 1.05, el: 0.25 }) },
  { key: 'rain', title: 'Rain into a pool', sub: 'Gravity on: a dense layer forms that never comes to rest', tex: TEX_GRAV,
    scene: r => ({ start: 'rain', g: 6 + 4 * r(), e: 0.9, eWall: 0.9, colorBy: r.pick(['height', 'speed']) }),
    camera: r => ({ kind: 'orbit', a0: r() * 6.28, dir: r() < 0.5 ? -1 : 1, R: 1.1, el: 0.18 }) },
  { key: 'slosh', title: 'Tilting gravity', sub: 'Gravity swings from side to side', tex: TEX_GRAV,
    scene: r => ({ start: 'slosh', g: 9.8, e: 0.92, colorBy: r.pick(['speed', 'height', 'origin']) }),
    camera: r => ({ kind: 'orbit', a0: r() * 0.6 - 0.3, dir: 1, R: 1.2, el: 0.3 }), swing: true },
  { key: 'stir', title: 'The stirrer', sub: 'A glass sphere ploughs through the gas', tex: TEX_CONTACT,
    scene: r => ({ start: r.pick(['gas', 'layers', 'vortex']), g: 0, stir: true, stirAuto: true, stirR: 0.22 + 0.14 * r(), count: Math.round(2500 + 3500 * r()), colorBy: r.pick(['speed', 'collisions', 'origin']), probeOn: false }),
    camera: r => ({ kind: 'stir', az: r() * 6.28 }) },
  { key: 'vortex', title: 'Vortex', sub: 'A spinning gas between the walls', tex: TEX_HASH,
    scene: r => ({ start: 'vortex', g: 0, colorBy: r.pick(['speed', 'bucket']), speed: 0.4 + 0.5 * r() }),
    camera: () => ({ kind: 'top' }) },
];

export function installSaver(P) {
  const THREE = P.THREE, stage = P.stage;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  let cam = null, t = 0, swing = false;
  const ease = u => (u < 0 ? 0 : u > 1 ? 1 : u * u * (3 - 2 * u));
  function camAt() {
    const S = P.S, b = S.bounds, cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, cz = (b[2] + b[5]) / 2;
    const ext = Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]), u = ease(t / 10);
    switch (cam.kind) {
      case 'orbit': { const a = cam.a0 + cam.dir * 0.18 * t, R = ext * 1.5 * cam.R; stage.cam.set(V(cx + Math.sin(a) * R * Math.cos(cam.el), cy + R * Math.sin(cam.el), cz + Math.cos(a) * R * Math.cos(cam.el)), V(cx, cy * 0.9, cz)); break; }
      case 'push': { const R = ext * (1.9 - 0.8 * u); stage.cam.set(V(cx + Math.sin(cam.az) * R, cy + 0.4 * R, cz + Math.cos(cam.az) * R), V(cx, cy, cz)); break; }
      case 'top': stage.cam.set(V(cx, b[4] + ext * 1.3, cz + ext * 0.35), V(cx, b[1], cz)); break;
      case 'stir': { const s = S.stirrer, a = cam.az + 0.12 * t, R = ext * 1.25; stage.cam.set(V(cx + Math.sin(a) * R, cy + ext * 0.55, cz + Math.cos(a) * R), V(s.x, s.y, s.z)); break; }
      case 'probe': default: {
        const i = S.probe; if (i < 0) break;
        const p = S.pos, x = p[3 * i], y = p[3 * i + 1], z = p[3 * i + 2], a = cam.az + 0.25 * t, R = S.radius * (30 - 12 * u);
        stage.cam.set(V(x + Math.sin(a) * R, y + 0.35 * R, z + Math.cos(a) * R), V(x, y, z));
      }
    }
  }
  return director({
    kit: P.kit,
    canvas: () => stage.canvas,
    // only the probe shot shows the query; the others draw every ball bright
    shots: SHOTS.map(s => Object.assign({}, s, { scene: (r, st) => Object.assign({ probeOn: false, cells: false }, s.scene(r, st)) }, { params: () => [
      { sym: 'N', name: 'balls', value: P.S.n.toLocaleString('en-US') },
      { sym: 'q', name: 'pairs hashed', value: P.S.stats.pairs.toLocaleString('en-US') },
      { sym: 'c', name: 'contacts', value: P.S.stats.contacts.toLocaleString('en-US') },
    ] })),
    apply(state, shot, c) {
      P.rebuild(); t = 0; cam = shot ? c : null; swing = !!(shot && shot.swing);
      if (cam) { camAt(); stage.cam.snap(); }
    },
    frame(band) { P.setBand(band ? { x: band.x, y: band.y, w: band.w, h: band.h } : null); },
    tick(dt) {
      if (!cam) return;
      t += dt; camAt();
      if (swing) P.S.P.tiltZ = 18 * Math.sin(0.7 * t);
    },
    enter() { stage.setAuto(true); },
    exit() { cam = null; swing = false; stage.setAuto(false); P.setBand(null); },
  });
}
