// ============================================================================
//  RIGID BODIES  ·  pages/rigid-bodies/saver.js — the screensaver shots
// ----------------------------------------------------------------------------
//  installSaver(P) defines window.snSaver through the sim kit director
//  (widgets/sim-kit/saver.js). Each cut draws a fresh random scene from the
//  page randomizer; the shot picks the scene and its start, a camera path
//  for the stage spring camera (stage3d.js: an orbit, a front view, a
//  chase of the lowest body, a slow push-in) and, for some shots, an
//  autopilot hand that pulls a body with the upstream drag constraint and
//  lets go. The plate shows the title, the scene values and one TeX line;
//  the TMP kit adds the credit lines. No code.
//
//  grep -n targets: "export const SHOTS", "function camAt"
// ============================================================================
import { director } from '../../widgets/sim-kit/saver.js';
import { rng } from '../../widgets/sim-kit/core.js';

const TEX_XPBD = String.raw`\lambda = \frac{-C}{w_1 + w_2 + \tilde\alpha},\quad \tilde\alpha = \frac{\alpha}{\Delta t^2},\quad \Delta\mathbf{x}_i = \lambda\, w_i\, \mathbf{n}`;
const TEX_W = String.raw`w = \frac{1}{m} + (\mathbf{r}\times\mathbf{n})^{T} I^{-1} (\mathbf{r}\times\mathbf{n})`;
const TEX_PEND = String.raw`T_k = 2\pi\sqrt{\frac{L_k}{g}} = \frac{T}{N_0 + k}`;
const TEX_MOBILE = String.raw`V_{\text{sphere},\,k} = 2\,V_{\text{tree},\,k-1} + V_{\text{bar}}`;
const TEX_CHAIN = String.raw`m_{k+1} = 2\,m_k,\qquad F_k = g \sum_{j \ge k} m_j`;
const TEX_ROT = String.raw`\mathbf{q} \leftarrow \mathbf{q} + \tfrac{1}{2}\,\Delta t\,[\boldsymbol{\omega}, 0]\,\mathbf{q}`;

export const SHOTS = [
  { key: 'mobile', title: 'Crib mobile', sub: 'Every sphere balances the tree that hangs from the other end of its bar', tex: TEX_MOBILE,
    scene: r => ({ scene: 'mobile', spin: (r() < 0.5 ? -1 : 1) * (0.3 + 0.6 * r()), windX: 0, windZ: 0, gust: 0 }),
    camera: r => ({ kind: 'orbit', a0: r() * 6.28, dir: r() < 0.5 ? -1 : 1, R: 3.2, y: 1.9, ty: 1.75, tx: -0.7 }) },
  { key: 'chain', title: 'Mass chain', sub: 'The mass doubles per link; the labels read force and stretch', tex: TEX_CHAIN,
    scene: r => ({ scene: 'chain', growth: 2, links: 4, labels: true, density: 1000, compliance: 0.001, damping: 5, g: 10, windX: 0, windZ: 0, gust: 0 }),
    camera: () => ({ kind: 'front', z: 3.1, y: 1.55, ty: 1.4 }), hand: 'yank' },
  { key: 'pendulums', title: 'Pendulum wave', sub: 'Each thread fits one more swing in the cycle', tex: TEX_PEND,
    scene: r => ({ scene: 'pendulums', count: 10 + Math.floor(5 * r()), angle: 20 + 20 * r(), g: 10, windX: 0, windZ: 0, gust: 0 }),
    camera: r => ({ kind: 'front', z: 1.9, y: 2.25, ty: 2.0, x: (r() - 0.5) * 0.8 }) },
  { key: 'chandelier', title: 'Chandelier', sub: 'A turning hub with chains and drops', tex: TEX_ROT,
    scene: r => ({ scene: 'chandelier', count: 6 + Math.floor(7 * r()), spin: 0.8 + 1.2 * r(), windX: 0, windZ: 0 }),
    camera: r => ({ kind: 'orbit', a0: r() * 6.28, dir: r() < 0.5 ? -1 : 1, R: 2.2, y: 1.5, ty: 2.0 }) },
  { key: 'bridge', title: 'Rope bridge', sub: 'Planks on two ropes; a hand pulls one up and lets go', tex: TEX_XPBD,
    scene: r => ({ scene: 'bridge', count: 7 + Math.floor(6 * r()), windX: 0, windZ: 0, gust: 0 }),
    camera: r => ({ kind: 'orbit', a0: 0.5 + 0.8 * r(), dir: r() < 0.5 ? -1 : 1, R: 2.4, y: 2.4, ty: 1.7 }), hand: 'lift' },
  { key: 'net', title: 'Net in the wind', sub: 'A grid of beads on threads billows in gusts', tex: TEX_XPBD,
    scene: r => ({ scene: 'net', count: 7 + Math.floor(5 * r()), windZ: 1 + 1.5 * r(), windX: (r() - 0.5) * 1.5, gust: 0.4 + 0.5 * r() }),
    camera: r => ({ kind: 'orbit', a0: 0.6 + 0.6 * r(), dir: r() < 0.5 ? -1 : 1, R: 2.4, y: 1.8, ty: 1.85 }) },
  { key: 'wrecking', title: 'Wrecking ball', sub: 'A heavy sphere on a chain of links', tex: TEX_W,
    scene: r => ({ scene: 'wrecking', count: 6 + Math.floor(6 * r()), angle: 40 + 35 * r(), windX: 0, windZ: 0, gust: 0 }),
    camera: r => ({ kind: 'chase', az: r() * 6.28 }) },
];

export function installSaver(P) {
  const THREE = P.THREE, stage = P.stage;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  let cam = null, t = 0;
  function camAt() {
    switch (cam.kind) {
      case 'orbit': { const a = cam.a0 + cam.dir * 0.16 * t, tx = cam.tx || 0; stage.cam.set(V(tx + Math.sin(a) * cam.R, cam.y, Math.cos(a) * cam.R), V(tx, cam.ty, 0)); break; }
      case 'front': stage.cam.set(V((cam.x || 0) + 0.3 * Math.sin(0.2 * t), cam.y, cam.z - 0.04 * t), V(0, cam.ty, 0)); break;
      case 'chase': default: {
        const sim = P.sim; if (!sim) break;
        const b = sim.rigidBodies.reduce((m, x) => (!m || x.pos.y < m.pos.y ? x : m), null); if (!b) break;
        const a = cam.az + 0.12 * t;
        stage.cam.set(V(b.pos.x * 0.5 + Math.sin(a) * 2.4, 1.4, b.pos.z * 0.5 + Math.cos(a) * 2.4), V(b.pos.x * 0.6, Math.max(0.8, b.pos.y), b.pos.z * 0.6));
      }
    }
  }
  return director({
    kit: P.kit,
    canvas: () => stage.canvas,
    shots: SHOTS.map(s => Object.assign({ params: st => [
      { sym: 'n', name: 'bodies', value: String(P.sim ? P.sim.rigidBodies.length : 0) },
      { sym: 'g', name: 'gravity', value: st.g.toFixed(1) + ' m/s²' },
      { sym: '\\alpha', name: 'compliance', value: st.compliance.toExponential(1) },
    ] }, s)),
    apply(state, shot, c) {
      P.rebuild(); t = 0; cam = shot ? c : null;
      if (shot && shot.hand) {
        const r = rng((P.kit.seed ^ 0x51ab) >>> 0);
        P.setHand(shot.hand === 'lift'
          ? { pick: bs => bs[Math.floor(bs.length / 2)], dir: () => V(0, 0.45, 0.25), dur: 1.4, rest: 2.2 }
          : { pick: bs => bs[bs.length - 1], dir: () => V((r() < 0.5 ? -1 : 1) * (0.2 + 0.15 * r()), 0.1 * r(), 0.15 * (r() - 0.5)), dur: 1.1, rest: 2.6, soft: 0.02 });
      } else P.setHand(null);
      if (cam) { camAt(); stage.cam.snap(); }
    },
    frame(band) { P.setBand(band ? { x: band.x, y: band.y, w: band.w, h: band.h } : null); },
    tick(dt) { if (cam) { t += dt; camAt(); } },
    enter() { stage.setAuto(true); },
    exit() { cam = null; P.setHand(null); stage.setAuto(false); P.setBand(null); },
  });
}
