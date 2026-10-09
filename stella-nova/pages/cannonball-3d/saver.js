// ============================================================================
//  CANNONBALL 3D  ·  pages/cannonball-3d/saver.js — the screensaver shots
// ----------------------------------------------------------------------------
//  installSaver(P) defines window.snSaver through the sim kit director
//  (widgets/sim-kit/saver.js). Each cut draws a fresh random scene from the
//  page randomizer, the shot sets what it needs (a start, a gravity, the
//  cannon), and a camera: a path for the spring camera of the stage
//  (stage3d.js cam), as a push-in, an orbit, a top view, a chase of one
//  ball, or a view down the cannon. The plate shows the title, the scene
//  values and one TeX line; the TMP kit adds the credit lines. No code.
//  cannonball-vr uses the same shots (it calls app.start too).
//
//  grep -n targets: "const SHOTS", "function camAt"
// ============================================================================
import { director } from '../../widgets/sim-kit/saver.js';

const TEX_STEP = String.raw`\mathbf{v} \leftarrow \mathbf{v} + \mathbf{g}\,\Delta t,\qquad \mathbf{x} \leftarrow \mathbf{x} + \mathbf{v}\,\Delta t`;
const TEX_WALL = String.raw`x < -w_x \;\Rightarrow\; x = -w_x,\;\; v_x \leftarrow -e\,v_x`;
const TEX_IMPULSE = String.raw`J = \frac{-(1+e)\,(\mathbf{v}_b-\mathbf{v}_a)\cdot\mathbf{n}}{1/m_a + 1/m_b}`;
const TEX_ARC = String.raw`h_{\max} = \frac{v_y^2}{2g},\qquad R = \frac{v^2 \sin 2\theta}{g}`;
const TEX_DRAG = String.raw`\mathbf{v} \leftarrow \mathbf{w} + (\mathbf{v}-\mathbf{w})\,(1 - c_d\,\Delta t)`;

// shot camera kinds: push (a -> b), orbit, top, chase (one ball), muzzle
export const SHOTS = [
  { key: 'push', title: 'A box of cannonballs', sub: 'Gravity, bounces and ball-ball impulses', tex: TEX_STEP,
    scene: r => ({ start: r.pick(['drop', 'fountain', 'burst']), cannon: false }),
    camera: r => ({ kind: 'push', side: r() < 0.5 ? -1 : 1, h: 1.6 + 1.6 * r() }) },
  { key: 'chase', title: 'Chase camera', sub: 'The camera rides along with one ball', tex: TEX_WALL,
    scene: r => ({ start: r.pick(['fountain', 'billiard', 'burst']), cannon: false, trails: true, count: Math.max(6, Math.round(20 * r())) }),
    camera: r => ({ kind: 'chase', az: r() * 6.28 }) },
  { key: 'orbit', title: 'Low orbit', sub: 'Round the box at floor height', tex: TEX_IMPULSE,
    scene: r => ({ start: r.pick(['drop', 'rain', 'billiard']), collide: true }),
    camera: r => ({ kind: 'orbit', a0: r() * 6.28, dir: r() < 0.5 ? -1 : 1, R: 1.5, y: 0.35 + 0.5 * r() }) },
  { key: 'top', title: 'From above', sub: 'In plan the motion is a billiard in x and z', tex: TEX_WALL,
    scene: r => ({ start: 'billiard', g: 10, trails: true, bumpers: Math.round(2 + 3 * r()), crates: Math.round(3 * r()) }),
    camera: () => ({ kind: 'top' }) },
  { key: 'cannon', title: 'Cannon', sub: 'Shots across the box, one every second or so', tex: TEX_ARC,
    scene: r => ({ start: 'cannon', cannon: true, cannonRate: 1 + 2 * r(), cannonSpeed: 6 + 4 * r(), crates: Math.round(4 * r()), bumpers: Math.round(3 * r()), tiltX: 0, tiltZ: 0, windX: 0, windZ: 0 }),
    camera: r => ({ kind: 'muzzle', side: r() < 0.5 ? -1 : 1 }) },
  { key: 'moon', title: 'Moon gravity', sub: 'g = 1.62 m/s²: slow, high arcs', tex: TEX_ARC,
    scene: r => ({ start: r.pick(['fountain', 'burst']), g: 1.62, drag: 0, windX: 0, windZ: 0, tiltX: 0, tiltZ: 0, speed: 3 + 3 * r() }),
    camera: r => ({ kind: 'push', side: r() < 0.5 ? -1 : 1, h: 0.8 + r() }) },
  { key: 'storm', title: 'Wind and a tilted floor', sub: 'Drag pulls every ball toward the wind', tex: TEX_DRAG,
    scene: r => ({ start: 'rain', drag: 0.3 + 0.4 * r(), windX: (r() - 0.5) * 8, windZ: (r() - 0.5) * 8, tiltX: (r() - 0.5) * 24, tiltZ: (r() - 0.5) * 24 }),
    camera: r => ({ kind: 'orbit', a0: r() * 6.28, dir: r() < 0.5 ? -1 : 1, R: 1.8, y: 2.2 }) },
  { key: 'upstream', title: 'The upstream scene', sub: 'One ball, restitution 1, the box of Ten Minute Physics #02', tex: TEX_STEP,
    scene: () => ({ start: 'upstream', trails: true }),
    camera: r => ({ kind: 'chase', az: r() * 6.28 }) },
];

export function installSaver(P) {
  const THREE = P.THREE, stage = P.stage;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  let shot = null, t = 0;
  const ease = u => (u < 0 ? 0 : u > 1 ? 1 : u * u * (3 - 2 * u));
  // The camera goal at time t of a shot (spring camera follows it).
  function camAt(cam, dt) {
    const S = P.S, hx = S.P.hx, hz = S.P.hz, ext = Math.max(hx, hz);
    const u = ease(t / 10);
    switch (cam.kind) {
      case 'push': stage.cam.set(V(cam.side * (ext * 1.2 - ext * 0.5 * u), cam.h - 0.5 * u, ext * 1.9 - ext * 0.8 * u), V(0, 0.55, 0)); break;
      case 'orbit': { const a = cam.a0 + cam.dir * 0.22 * t; stage.cam.set(V(Math.sin(a) * ext * 1.25 * cam.R, cam.y, Math.cos(a) * ext * 1.25 * cam.R), V(0, 0.45, 0)); break; }
      case 'top': stage.cam.set(V(0, ext * 2.5 - 0.4 * u, ext * 0.55), V(0, 0, 0)); break;
      case 'muzzle': { const c = S.P; stage.cam.set(V(cam.side * 1.1, 1.0, -c.hz - 1.4), V(0, 0.9, c.hz * 0.4)); break; }
      case 'chase': default: {
        const b = S.balls.reduce((m, x) => (!m || x.r > m.r ? x : m), null);
        if (!b) break;
        const a = cam.az + 0.15 * t;
        stage.cam.set(V(b.x + Math.sin(a) * 3.2, 1.0 + 0.5 * b.y, b.z + Math.cos(a) * 3.2), V(b.x * 0.6, 0.3 + 0.6 * b.y, b.z * 0.6));
      }
    }
  }
  return director({
    kit: P.kit,
    canvas: () => stage.canvas,
    shots: SHOTS.map(s => Object.assign({ params: st => [
      { sym: 'N', name: 'balls', value: String(P.S.balls.length) },
      { sym: 'g', name: 'gravity', value: st.g.toFixed(2) + ' m/s²' },
      { sym: 'e', name: 'restitution', value: st.e.toFixed(2) },
    ] }, s)),
    apply(state, sh, cam) {
      P.rebuild(); t = 0; shot = sh ? cam : null;
      if (shot) { camAt(shot, 0); stage.cam.snap(); }
    },
    frame(band) { P.setBand(band ? { x: band.x, y: band.y, w: band.w, h: band.h } : null); },
    tick(dt) { if (shot) { t += dt; camAt(shot, dt); } },
    enter() { stage.setAuto(true); },
    exit() { shot = null; stage.setAuto(false); P.setBand(null); },
  });
}
