// ============================================================================
//  JOINT SIMULATION  ·  pages/joints/saver.js — the screensaver shots
// ----------------------------------------------------------------------------
//  installSaver(P) defines window.snSaver through the sim kit director
//  (widgets/sim-kit/saver.js). Each cut draws a fresh random scene from the
//  page randomizer; the shot picks the scene (an upstream file or a made
//  one), the drive, and a camera path for the stage spring camera
//  (stage3d.js: an orbit, a front view, a chase of the fastest body). Some
//  shots use an autopilot hand that pulls a body with the upstream drag
//  joint and lets go; the frames shot shows the joint frames. The plate
//  shows the title, the scene values and one TeX line; the TMP kit adds
//  the credit lines. No code.
//
//  grep -n targets: "export const SHOTS", "function camAt"
// ============================================================================
import { director } from '../../widgets/sim-kit/saver.js';
import { rng } from '../../widgets/sim-kit/core.js';

const TEX_XPBD = String.raw`\Delta\lambda = \frac{-C - \tilde\alpha\,\lambda}{\sum_i w_i + \tilde\alpha},\qquad \tilde\alpha = \frac{\alpha}{\Delta t^2}`;
const TEX_HINGE = String.raw`\Delta\mathbf{q} = \mathbf{a}_1 \times \mathbf{a}_2:\quad \text{align the hinge axes } \mathbf{a}_1, \mathbf{a}_2`;
const TEX_MOTOR = String.raw`\theta_{\text{target}} \leftarrow \theta_{\text{target}} + \omega\,\Delta t`;
const TEX_LIMIT = String.raw`\phi = \operatorname{asin}\bigl((\mathbf{a}\times\mathbf{b})\cdot\mathbf{n}\bigr),\qquad \phi \in [\phi_{\min}, \phi_{\max}]`;
const TEX_SLIDE = String.raw`\Delta\mathbf{x} = \bigl(\mathbf{d} - (\mathbf{d}\cdot\mathbf{e}_x)\,\mathbf{e}_x\bigr):\ \text{slide along } \mathbf{e}_x \text{ only}`;
const TEX_W = String.raw`w = \frac{1}{m} + (\mathbf{r}\times\mathbf{n})^{T} I^{-1} (\mathbf{r}\times\mathbf{n})`;

export const SHOTS = [
  { key: 'basic', title: 'Basic joints', sub: 'The upstream test bench: a hand pulls the bodies and lets go', tex: TEX_XPBD,
    scene: () => ({ scene: 'basic', frames: false, auto: true, slow: 1 }), camera: r => ({ kind: 'orbit', a0: r() * 6.28, dir: r() < 0.5 ? -1 : 1, el: 0.35 }), hand: true },
  { key: 'steering', title: 'Steering', sub: 'Motors drive the wheels; a servo turns the front axle', tex: TEX_MOTOR,
    scene: r => ({ scene: 'steering', frames: false, auto: true, throttle: 0.5 + 0.4 * r(), steer: 0.4 + 0.5 * r(), rate: 0.2 + 0.2 * r(), slow: 1 }), camera: r => ({ kind: 'chase', az: r() * 6.28, zoom: 1.2 }) },
  { key: 'pendulum', title: 'Pendulums', sub: 'The upstream pendulum scene, pulled and released', tex: TEX_W,
    scene: () => ({ scene: 'pendulum', frames: false, slow: 1 }), camera: () => ({ kind: 'front', el: 0.15 }), hand: true },
  { key: 'hinges', title: 'Hinge chain', sub: 'Links on hinges: a chaotic multiple pendulum', tex: TEX_HINGE,
    scene: r => ({ scene: 'hinges', count: 2 + Math.floor(4 * r()), angle: 80 + 40 * r(), bend: 0.5 + r(), limit: 0, damping: 0.05 * r(), frames: false }), camera: () => ({ kind: 'front', el: 0.1, zoom: 1.1 }) },
  { key: 'rope', title: 'Ball-joint rope', sub: 'Beads on ball joints with a swing limit, let go from the side', tex: TEX_LIMIT,
    scene: r => ({ scene: 'rope', count: 6 + Math.floor(7 * r()), angle: 70 + 40 * r(), limit: 30 + 60 * r(), frames: false }), camera: r => ({ kind: 'orbit', a0: r() * 6.28, dir: r() < 0.5 ? -1 : 1, el: 0.25, zoom: 1.2 }) },
  { key: 'arm', title: 'Robot arm', sub: 'Hinge joints chase moving target angles', tex: TEX_HINGE,
    scene: r => ({ scene: 'arm', count: 6 + Math.floor(4 * r()), auto: true, steer: 0.6 + 0.4 * r(), rate: 0.25 + 0.25 * r(), frames: false }), camera: r => ({ kind: 'orbit', a0: r() * 6.28, dir: r() < 0.5 ? -1 : 1, el: 0.3 }) },
  { key: 'windmill', title: 'Windmill', sub: 'A motor joint turns the rotor; chains swing from the blades', tex: TEX_MOTOR,
    scene: r => ({ scene: 'windmill', count: 6 + Math.floor(6 * r()), auto: true, throttle: 0.5 + 0.5 * r(), steer: 0, frames: false }), camera: () => ({ kind: 'front', el: 0.1, zoom: 1.15 }) },
  { key: 'cartpole', title: 'Cart-poles', sub: 'Prismatic carts shake on their rails; the poles swing', tex: TEX_SLIDE,
    scene: r => ({ scene: 'cartpole', count: 4 + Math.floor(9 * r()), auto: true, steer: 0.6 + 0.4 * r(), rate: 0.3 + 0.4 * r(), frames: false }), camera: r => ({ kind: 'orbit', a0: -0.5 + r(), dir: r() < 0.5 ? -1 : 1, el: 0.45 }) },
  { key: 'frames', title: 'Joint frames', sub: 'The simulation view: each joint draws its two frames', tex: TEX_XPBD,
    scene: r => ({ scene: r.pick(['basic', 'pendulum', 'hinges', 'rope']), frames: true }), camera: r => ({ kind: 'orbit', a0: r() * 6.28, dir: r() < 0.5 ? -1 : 1, el: 0.3, zoom: 0.9 }), hand: true },
];

export function installSaver(P) {
  const THREE = P.THREE, stage = P.stage;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  let cam = null, t = 0;
  // The scene bounds: centre and radius of the dynamic bodies (the static
  // anchors count for the centre only), so every scene fills the frame.
  function bounds() {
    const sim = P.sim; if (!sim || !sim.rigidBodies.length) return { c: V(0, 0.45, 0), rad: 0.5 };
    const lo = V(1e9, 1e9, 1e9), hi = V(-1e9, -1e9, -1e9);
    for (const b of sim.rigidBodies) { const s = Math.max(b.size.x, b.size.y, b.size.z) * 0.5; lo.min(V(b.pos.x - s, b.pos.y - s, b.pos.z - s)); hi.max(V(b.pos.x + s, b.pos.y + s, b.pos.z + s)); }
    const c = lo.clone().add(hi).multiplyScalar(0.5), rad = Math.max(0.25, hi.clone().sub(lo).length() * 0.5);
    return { c, rad };
  }
  let B = null, bt = 0;
  function camAt(dt) {
    bt -= dt || 0; if (!B || bt <= 0) { const nb = bounds(); B = B ? { c: B.c.lerp(nb.c, 0.3), rad: B.rad + (nb.rad - B.rad) * 0.3 } : nb; bt = 0.5; }
    const c = B.c, R = B.rad * 1.9 * (cam.zoom || 1);
    switch (cam.kind) {
      case 'orbit': { const a = cam.a0 + cam.dir * 0.18 * t; stage.cam.set(V(c.x + Math.sin(a) * R, c.y + R * cam.el, c.z + Math.cos(a) * R), c); break; }
      case 'front': stage.cam.set(V(c.x + 0.15 * R * Math.sin(0.25 * t), c.y + R * cam.el, c.z + R * (1 - 0.015 * t)), c); break;
      case 'chase': default: { const a = cam.az + 0.15 * t; stage.cam.set(V(c.x + Math.sin(a) * R, c.y + R * 0.45, c.z + Math.cos(a) * R), c); }
    }
  }
  return director({
    kit: P.kit,
    canvas: () => stage.canvas,
    shots: SHOTS.map(s => Object.assign({ params: st => [
      { sym: 'n', name: 'bodies', value: String(P.sim ? P.sim.rigidBodies.length : 0) },
      { sym: 'j', name: 'joints', value: String(P.sim ? P.sim.joints.length : 0) },
      { sym: 'g', name: 'gravity', value: st.g.toFixed(2) + ' m/s²' },
    ] }, s)),
    apply(state, shot, c) {
      P.rebuild(); t = 0; cam = shot ? c : null; B = null;
      P.setHand(shot && shot.hand ? { r: rng((P.kit.seed ^ 0x2f1) >>> 0), dur: 0.9, rest: 2.0 } : null);
      if (cam) { camAt(); stage.cam.snap(); }
    },
    frame(band) { P.setBand(band ? { x: band.x, y: band.y, w: band.w, h: band.h } : null); },
    tick(dt) { if (cam) { t += dt; camAt(dt); } },
    enter() { stage.setAuto(true); },
    exit() { cam = null; P.setHand(null); stage.setAuto(false); P.setBand(null); },
  });
}
