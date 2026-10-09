// ============================================================================
//  MUJOCO LAB  ·  saver-plan.js — the screensaver shot plan (no DOM)
// ----------------------------------------------------------------------------
//  saver.js runs the shots that this module plans. The module has no DOM
//  and no MuJoCo calls, so tests.mjs checks the plan in node.
//
//  makePlan(seed, n, { phone }) -> [shot]
//      A seeded bag of the shot kinds. The bag is shuffled again when it is
//      empty, and the same kind never comes twice in a row. Each shot gets
//      a length of 6 to 12 s, a source (a library model or a generated
//      scene), a seed, and a camera offset. A phone gets no heavy models.
//  camAt(shot, t, base, focus, calm) -> { azimuth, elevation, distance, lookat }
//      The camera mark at shot time t. base is the camera of the loaded
//      model; focus is the point that the shot follows (MuJoCo world).
//  actionCentre(xipos, cvel, nbody, out) -> out
//      The mean of the body centres, weighted by body speed: the place
//      where things move. With nothing in motion it is the plain mean.
//  bandFrame(h, band) -> { k, dy }
//      The distance factor and the view offset that put the subject in
//      the clear band of the label plate (lib/saver-clear.js plateBand).
//
//  GREP MAP
//    export const KINDS ....... shot kinds: source, length, camera, flags, TeX
//    export const TEX ......... the two plate equations
//    export function makePlan . seeded bag, no back-to-back repeats
//    export function camAt .... the camera mark of a shot
// ============================================================================
import { rng } from './core/procedural.js';

// The equation of motion (MuJoCo docs, Computation) and the soft
// constraint law: the constraint acceleration a1 moves from the
// unconstrained a0 toward the spring-damper reference, by the impedance d.
export const TEX = {
  eom: String.raw`M(q)\,\dot v + c(q, v) = \tau + J^{T} f`,
  soft: String.raw`a_1 + d\,\big(b\,(J v) + k\,r\big) = (1 - d)\,a_0`,
};

// One entry per kind. src(r, phone) gives the load source; dur is the
// range of the shot length (s); zoom is the distance factor at the start
// and at the end (dist: the distance in metres instead); az is the orbit rate (deg/s); el is the elevation (deg);
// focus: 'action' (actionCentre), 'base' (the model camera look-at point)
// or a body name. flags are renderer flags (render/README.md).
export const KINDS = {
  dominoes: { name: 'Domino run', sub: 'the falling front, tracked', dur: [9, 12], zoom: [0.55, 0.42], dist: [1.0, 0.75], az: 5, el: -34, focus: 'action', tex: 'eom',
    src: r => ({ kind: 'dominoes', seed: seedOf(r) }) },
  rain: { name: 'Ragdoll rain', sub: 'capsule figures fall on a pile', dur: [7, 10], zoom: [0.38, 0.3], az: 6, el: -16, focus: 'action', tex: 'soft',
    src: r => ({ kind: 'ragdolls', seed: seedOf(r) }) },
  tumble: { name: 'Humanoid', sub: 'thrown up with a spin, no control: it falls and tumbles', dur: [6, 9], zoom: [0.38, 0.3], az: 8, el: -12, focus: 'torso', tex: 'eom',
    src: () => ({ model: 'humanoid' }), setup: 'throw' },
  arm: { name: 'Robot arm', sub: 'random controls inside the joint limits', dur: [8, 12], zoom: [0.42, 0.34], az: 9, el: -18, focus: 'base', tex: 'eom',
    src: () => ({ model: 'panda' }), driver: ['random', { amp: 0.85, freq: 0.35 }] },
  drape: { name: 'Cloth and rope', sub: 'a flexible body drapes and settles', dur: [8, 11], zoom: [0.55, 0.45], az: 7, el: -20, focus: 'action', tex: 'soft',
    src: (r, phone) => { const v = phone ? ['rope', 'chains'] : ['cloth', 'rope', 'chains', 'cloth']; const k = v[Math.floor(r() * v.length)]; return k === 'chains' ? { kind: 'chains', seed: seedOf(r) } : { model: k }; } },
  cradle: { name: "Newton's cradle", sub: 'momentum passes along the row', dur: [6, 9], zoom: [0.42, 0.36], az: 3, el: -6, focus: 'base', tex: 'soft',
    src: () => ({ model: 'newtons-cradle' }) },
  tippe: { name: 'Tippe top', sub: 'friction at the contact turns the top over onto its stem', dur: [9, 12], zoom: [0.4, 0.3], az: 10, el: -16, focus: 'top', tex: 'eom',
    src: () => ({ model: 'tippe-top' }) },
  collapse: { name: 'Stacks', sub: 'a push, then the towers fall: contact forces shown', dur: [8, 11], zoom: [0.5, 0.4], az: 6, el: -18, focus: 'action', tex: 'soft',
    src: r => ({ kind: 'stacks', seed: seedOf(r) }), setup: 'push', flags: { contactForces: true, contactPoints: true } },
  replay: { name: 'Impact replay', sub: 'live, then the hardest impact again at 0.25×', dur: [11, 11], zoom: [0.5, 0.36], az: 4, el: -14, focus: 'action', tex: 'soft',
    src: r => (r() < 0.6 ? { kind: 'mixed', seed: seedOf(r) } : { kind: 'ragdolls', seed: seedOf(r) }), setup: 'replay' },
  xray: { name: 'X-ray', sub: 'joint axes and centres of mass through clear bodies', dur: [7, 10], zoom: [0.45, 0.35], az: 12, el: -16, focus: 'action', tex: 'eom',
    src: (r, phone) => { const v = phone ? ['humanoid', 'quadruped', 'tendon-arm', 'go2'] : ['humanoid', 'quadruped', 'shadow-hand', 'go2', 'tendon-arm']; return { model: v[Math.floor(r() * v.length)] }; },
    driver: ['sine', { amp: 0.6, freq: 0.4 }], flags: { transparent: true, jointAxes: true, com: true } },
};
// every flag a shot can set: a cut turns the others off
export const SHOT_FLAGS = ['contactForces', 'contactPoints', 'transparent', 'jointAxes', 'com'];
// the replay: live part (shot s), lead before the impact and tail after it (sim s), speed
export const REPLAY = { live: 4, before: 0.55, after: 0.85, speed: 0.25 };
export const PUSH = { at: [1.0, 3.6], len: 0.18, acc: 45 };

function seedOf(r) { return 1 + Math.floor(r() * 999998); }

export function makePlan(seed, n = 200, { phone = false } = {}) {
  const r = rng((seed >>> 0) || 1), keys = Object.keys(KINDS), out = [];
  let bag = [];
  while (out.length < n) {
    if (!bag.length) {
      bag = keys.slice();
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      const last = out.length ? out[out.length - 1].kind : null;
      if (bag[bag.length - 1] === last) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];   // pop() takes from the end
    }
    const kind = bag.pop(), K = KINDS[kind];
    const dur = Math.min(12, Math.max(6, K.dur[0] + r() * (K.dur[1] - K.dur[0])));
    out.push({ kind, dur: +dur.toFixed(2), src: K.src(r, phone), az0: (r() * 2 - 1) * 40, dir: r() < 0.5 ? -1 : 1, el: K.el + (r() * 2 - 1) * 5, seed: seedOf(r) });
  }
  return out;
}

const lerp = (a, b, s) => a + (b - a) * s;
export function camAt(shot, t, base, focus, calm = 0.7) {
  const K = KINDS[shot.kind], s = Math.min(1, Math.max(0, t / shot.dur));
  const e = s * s * (3 - 2 * s);
  return {
    azimuth: base.azimuth + shot.az0 + shot.dir * K.az * (1 - 0.45 * calm) * t,
    elevation: Math.max(-60, Math.min(-3, shot.el)),
    distance: K.dist ? lerp(K.dist[0], K.dist[1], e) : base.distance * lerp(K.zoom[0], K.zoom[1], e),
    lookat: [focus[0], focus[1], focus[2]],
  };
}

export function actionCentre(xipos, cvel, nbody, out = [0, 0, 0]) {
  let sx = 0, sy = 0, sz = 0, sw = 0, mx = 0, my = 0, mz = 0, n = 0, vmax = 0;
  for (let b = 1; b < nbody; b++) {
    const v = Math.hypot(cvel[6 * b + 3], cvel[6 * b + 4], cvel[6 * b + 5]);
    if (v > vmax && Number.isFinite(v)) vmax = v;
  }
  for (let b = 1; b < nbody; b++) {
    const x = xipos[3 * b], y = xipos[3 * b + 1], z = xipos[3 * b + 2];
    if (!Number.isFinite(x + y + z)) continue;
    mx += x; my += y; mz += z; n++;
    const v = Math.hypot(cvel[6 * b + 3], cvel[6 * b + 4], cvel[6 * b + 5]);
    const w = Number.isFinite(v) ? v * v : 0;
    sx += w * x; sy += w * y; sz += w * z; sw += w;
  }
  if (!n) { out[0] = out[1] = out[2] = 0; return out; }
  // speeds under 5 cm/s count as rest: the plain mean
  const k = vmax < 0.05 ? 0 : Math.min(1, vmax / 0.3);
  const ax = sw > 0 ? sx / sw : mx / n, ay = sw > 0 ? sy / sw : my / n, az = sw > 0 ? sz / sw : mz / n;
  out[0] = lerp(mx / n, ax, k); out[1] = lerp(my / n, ay, k); out[2] = lerp(mz / n, az, k);
  return out;
}

// h: canvas CSS height; band: plateBand(h) or null
export function bandFrame(h, band) {
  if (!band || !(h > 0)) return { k: 1, dy: 0 };
  const clear = Math.max(h * 0.3, h - band.t - band.b);
  return { k: Math.min(2.2, Math.max(1, h / clear)), dy: (band.b - band.t) / 2 };
}
