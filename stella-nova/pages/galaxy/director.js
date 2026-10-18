// ============================================================================
//  GALAXY  ·  director.js — the shot director for an interacting pair (no DOM)
// ----------------------------------------------------------------------------
//  The camera follows the action of the recorded encounter (encounter.js)
//  and picks its shot from the phase that the run measures:
//    approach  both galaxies, an oblique view that shows the two disks
//    peri      in on the two cores and the bridge between them
//    tails     back, to hold the full tails (a trimmed percentile of the
//              action weight, so escaping stars do not pull it out)
//    merger    the remnant
//  Each phase gives a centre, a radius and a height above the orbit plane.
//  The director eases its phase weights (time constant TAU s), so a shot
//  change is a slow blend, never a cut. lib/action-camera.js follow() then
//  puts a dead zone, critically damped springs and a zoom cap on the
//  blended centre and radius. A cut happens only on snap() (the saver).
//
//  USE
//    const d = createDirector({ fov: 40 });
//    each frame: const c = d.update({ enc, t, dt, aspect, band, viewPx, nStars, yawRate? })
//      c = { target, yaw, pitch, dist, fov, phase, weights, radius, gain }
//    d.snap({ side, jitter })   the next update jumps to its goal (a cut);
//                      the yaw is side x (yawOffset + jitter) from the line
//                      of the cores, so the two disks never stack in view
//    d.adopt({ yaw, pitch })   take over a view the user left
//
//  The camera is the orbit camera of camera.js: yaw turns round world z
//  (the orbit normal of the pair), pitch is the height above the orbit plane.
//
//  grep -n targets
//    shot table ........ "const SHOTS"
//    per-phase goal .... "function shotGoal"
//    density gain ...... "function coreGain"
//    view share ........ "function viewShare"
// ============================================================================
import { createActionCamera } from '../../lib/action-camera.js';
import { fitDistance, spring, DEG } from './camera.js';
import { sampleAt, phaseAt } from './encounter.js';

export const PHASES = ['approach', 'peri', 'tails', 'merger'];
// pitch: deg above the orbit plane; yaw: offset from the line of the cores
export const SHOTS = {
  approach: { pitch: 32 },
  peri: { pitch: 46 },
  tails: { pitch: 60 },
  merger: { pitch: 40 },
};
export const FILL = 0.55, TAU = 1.8, MIN_R = 8, MAX_R = 140;

// The centre and the radius that phase `ph` wants, from the sample s.
// m = action-camera measure of the test stars (trimmed centre, the radius
// that holds 85 % of their action weight).
export function shotGoal(ph, s, m, rDisk) {
  const [a, b] = s.cores, sep = s.sep;
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  switch (ph) {
    case 'approach': return { c: mid, r: 0.5 * sep + 0.75 * rDisk };
    case 'peri': return { c: mid, r: Math.max(0.5 * sep + 0.6 * rDisk, 1.1 * rDisk) };
    case 'tails': return { c: m.c, r: Math.max(m.r, 0.5 * sep + 0.9 * rDisk) };
    default: return { c: mid, r: 1.4 * rDisk };
  }
}

// Brightness hint of the action camera, for the dense cores: the stars that
// sit in `cores` discs of radius rc, against the pixels those discs cover.
// Gives 0.3 .. 1 (1: sparse, no change; low: dense, compress the cores).
export function coreGain(goal, { viewPx, nStars, coreShare = 0.45, rc = 2.5, cores = 2 }) {
  if (!goal) return 1;
  const k = Math.min(1, cores * (rc / Math.max(1e-6, goal.radius)) ** 2);
  const h = goal.brightness(viewPx * k, nStars * coreShare);
  return Math.max(0.3, Math.min(1, Math.sqrt(h)));
}

export function createDirector({ fov = 40, yawRate = 0.025, yawOffset = 60 } = {}) {
  const ac = createActionCamera({ fill: FILL, minRadius: MIN_R, maxRadius: MAX_R, halfLife: 1.1, maxZoomRate: 0.3, deadZone: 0.15, radiusBand: 0.1 });
  let w = null, yaw = 0, pitch = 30 * DEG, pv = 0, cut = null, last = null, sample = null, sampleT = -1e9, sampleAge = 1e9, tails = null, meas = null;

  function update({ enc, t, dt = 1 / 60, aspect = 16 / 9, band = 1, viewPx = 2e6, nStars = 1e5, resample = 0.05, yawRate: yr = yawRate }) {
    dt = Math.min(0.25, Math.max(0, dt));
    sampleAge += dt;
    if (!sample || sampleAge >= resample || Math.abs(t - sampleT) > 40) { sample = sampleAt(enc, t, { out: sample }); sampleT = t; sampleAge = 0; }
    if (sampleAge === 0) {
      // the tails measure: the test stars by their action, the hosts light
      // (15 % each), so the percentile radius holds the tails, not the cores
      const n = sample.nStars, mt = tails && tails.mass.length >= sample.count ? tails.mass : new Float64Array(sample.count);
      for (let i = 0; i < n; i++) mt[i] = 1;
      mt[n] = mt[n + 1] = 0.15 * n;
      tails = { pos: sample.pos, vel: sample.vel, mass: mt, count: sample.count, stride: 3 };
      meas = ac.measure(tails);
    }
    const ph = phaseAt(enc, t), m = meas;
    const first = !w || cut !== null;
    if (first) { w = {}; for (const p of PHASES) w[p] = p === ph.phase ? 1 : 0; }
    else { const k = 1 - Math.exp(-dt / TAU); for (const p of PHASES) w[p] += ((p === ph.phase ? 1 : 0) - w[p]) * k; }
    // blend the goals: centre linear, radius in log, pitch linear
    const c = [0, 0, 0]; let lr = 0, pt = 0, sw = 0;
    for (const p of PHASES) {
      if (w[p] < 1e-4) continue;
      const g = shotGoal(p, sample, m, enc.rDisk);
      for (let k = 0; k < 3; k++) c[k] += w[p] * g.c[k];
      lr += w[p] * Math.log(Math.max(1e-3, g.r)); pt += w[p] * SHOTS[p].pitch * DEG; sw += w[p];
    }
    for (let k = 0; k < 3; k++) c[k] /= sw;
    const goal = { c, r: Math.exp(lr / sw), n: nStars };
    if (first) {
      ac.reset();
      const [a, b] = sample.cores, axis = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const sd = cut || { side: 1, jitter: 0 };
      yaw = axis + sd.side * (yawOffset * DEG + sd.jitter); pitch = pt / sw; pv = 0; cut = null;
    } else {
      yaw += yr * dt;
      [pitch, pv] = spring(pitch, pv, pt / sw, 1.1, dt);
    }
    const G = ac.follow(goal, first ? 0 : dt);
    const gain = coreGain(G, { viewPx, nStars, coreShare: 0.45, rc: 0.3 * enc.rDisk, cores: ph.phase === 'merger' ? 1 : 2 });
    last = {
      target: G.center.slice(), yaw, pitch, fov, dist: fitDistance(G.radius, fov, aspect, band, FILL),
      phase: ph.phase, sep: ph.sep, weights: Object.assign({}, w), radius: G.radius, gain, sample,
    };
    return last;
  }

  return {
    update,
    snap({ side = 1, jitter = 0 } = {}) { cut = { side: side < 0 ? -1 : 1, jitter }; sample = null; },
    adopt({ yaw: y, pitch: p }) { if (Number.isFinite(y)) yaw = y; if (Number.isFinite(p)) { pitch = p; pv = 0; } },
    get last() { return last; },
    camera: ac,
  };
}

// The share of the weight w (per body) whose projection falls inside the
// view: |x| < tanHalf * aspect, |y| < tanHalf * band (the band centred).
// The pure test of "the framing never loses the main body of mass".
export function viewShare(cam, basisOf, s, w, aspect, band = 1) {
  const b = basisOf(cam), th = Math.tan(cam.fov * DEG / 2);
  let inside = 0, all = 0;
  for (let i = 0; i < s.count; i++) {
    const o = i * 3, v = [s.pos[o] - b.eye[0], s.pos[o + 1] - b.eye[1], s.pos[o + 2] - b.eye[2]];
    const z = v[0] * b.fwd[0] + v[1] * b.fwd[1] + v[2] * b.fwd[2];
    all += w[i];
    if (z <= 0) continue;
    const x = (v[0] * b.right[0] + v[1] * b.right[1] + v[2] * b.right[2]) / (z * th * aspect);
    const y = (v[0] * b.up[0] + v[1] * b.up[1] + v[2] * b.up[2]) / (z * th * band);
    if (Math.abs(x) <= 1 && Math.abs(y) <= 1) inside += w[i];
  }
  return all > 0 ? inside / all : 1;
}
