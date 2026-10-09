// ============================================================================
//  LEGGED ROBOT GYM  ·  saver-plan.js — the screensaver shot plan
// ----------------------------------------------------------------------------
//  Pure functions, no DOM and no THREE: tests.mjs runs them in node, with
//  the MuJoCo sim, to show that the plan holds its rules.
//
//  SHOTS
//    A seeded bag of shot kinds. The plan empties the bag in a random order,
//    then fills it again. A kind never follows itself, also across two bags.
//    The robots come in parade order (G1, H1, H1-2, Go2 from a seeded start),
//    two or three shots per robot. Each shot holds 6 to 12 s.
//
//  COORDINATES
//    MuJoCo world: z up, metres. A camera is { pos, target, fov } in the
//    same frame. main.js eases the real camera to it with a spring.
//
//  GREP MAP
//    export const KINDS ........ shot kinds: name, text, slow motion, robots
//    export const CMDS ......... scripted command sequences
//    export function cmdAt ..... command [vx, vy, wz] at time t of a sequence
//    export function makePlan .. the shot list for a seed
//    export function camAt ..... the camera of a shot at time t
//    export const DIM .......... robot height and radius for framing
// ============================================================================

export const PARADE = ['g1', 'h1', 'h1_2', 'go2'];

// height and footprint radius (m) of each robot, for framing and for the
// test that a camera never goes inside the robot
export const DIM = {
  g1: { h: 1.28, r: 0.32, hip: 0.72 },
  h1: { h: 1.75, r: 0.38, hip: 1.0 },
  h1_2: { h: 1.72, r: 0.38, hip: 0.98 },
  go2: { h: 0.42, r: 0.42, hip: 0.28 },
};

export const CMDS = {
  walk: { name: 'Walk', text: 'walk forward at 0.5 m/s' },
  sprint: { name: 'Sprint', text: 'ramp up to 1.0 m/s, the top of the training range' },
  turn: { name: 'Turn on the spot', text: 'yaw at 0.9 rad/s, no forward speed' },
  strafe: { name: 'Strafe', text: 'step sideways, left then right' },
  fig8: { name: 'Figure 8', text: 'walk at 0.5 m/s while the yaw command swings' },
  back: { name: 'Walk back', text: 'walk backwards at 0.4 m/s' },
};

// scripted command [vx, vy, wz] at time t (s) into the shot
export function cmdAt(name, t) {
  switch (name) {
    case 'walk': return [0.5, 0, 0];
    case 'sprint': return [Math.min(1, 0.4 + 0.15 * t), 0, 0];
    case 'turn': return [0, 0, 0.9];
    case 'strafe': return [0, Math.floor(t / 4) % 2 ? -0.35 : 0.35, 0];
    case 'fig8': return [0.5, 0, 0.8 * Math.sin(2 * Math.PI * t / 8)];
    case 'back': return [-0.4, 0, 0];
    default: return [0, 0, 0];
  }
}

// kind: { name, sub, cmds (allowed), slow (time scale), go2 (allowed on the
// scripted Go2), desk (desktop only), dur [min, max] s }
export const KINDS = {
  dolly: { name: 'Tracking dolly', sub: 'A low camera beside the legs', cmds: ['walk', 'sprint'], slow: 1, go2: true, dur: [7, 11] },
  orbit: { name: 'Orbit', sub: 'The camera circles the walking robot', cmds: ['turn', 'fig8', 'strafe'], slow: 1, go2: true, dur: [8, 12] },
  top: { name: 'Gait from above', sub: 'Top-down, with the footprints', cmds: ['fig8', 'walk', 'strafe'], slow: 1, go2: true, foot: true, dur: [8, 12] },
  strike: { name: 'Foot strike', sub: 'Slow motion, one foot at ground level', cmds: ['walk'], slow: 0.3, go2: true, dur: [6, 9] },
  push: { name: 'Push recovery', sub: 'A side push, then the replay at 0.4 speed', cmds: ['walk'], slow: 1, go2: true, dur: [10.5, 12] },
  xray: { name: 'Joint torques', sub: 'X-ray: each joint glows with its torque', cmds: ['walk', 'fig8'], slow: 1, go2: true, dur: [8, 11] },
  sees: { name: 'What the policy sees', sub: 'The observation in, the action out, each control step', cmds: ['fig8', 'walk'], slow: 1, go2: false, dur: [8, 12] },
  front: { name: 'Head on', sub: 'The camera backs away in front of the robot', cmds: ['walk', 'back'], slow: 1, go2: true, dur: [7, 10] },
  squad: { name: 'Side by side', sub: 'The robots walk abreast', cmds: ['walk'], slow: 1, go2: true, desk: true, dur: [9, 12] },
};

export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// n shots. opts: { phone } leaves out desktop-only kinds (several robots at
// once) to keep the phone saver light.
export function makePlan(seed, n = 24, opts = {}) {
  const r = rng(seed), out = [];
  const pick = a => a[Math.floor(r() * a.length) % a.length];
  const kinds = Object.keys(KINDS).filter(k => !(opts.phone && KINDS[k].desk));
  let bag = [], last = null, robotIx = Math.floor(r() * PARADE.length), left = 2 + Math.floor(r() * 2);
  while (out.length < n) {
    const robot = PARADE[robotIx];
    if (!bag.length) { bag = kinds.slice(); for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; } }
    // first kind in the bag that is not the last kind and suits the robot
    let ix = bag.findIndex(k => k !== last && (robot !== 'go2' || KINDS[k].go2));
    if (ix < 0) { bag = []; continue; }
    const kind = bag.splice(ix, 1)[0], K = KINDS[kind];
    const [d0, d1] = K.dur;
    out.push({
      i: out.length, kind, robot: kind === 'squad' ? 'all' : robot, lead: robot, cmd: pick(K.cmds),
      dur: Math.round((d0 + r() * (d1 - d0)) * 10) / 10, slow: K.slow,
      side: r() < 0.5 ? -1 : 1, phase: r() * Math.PI * 2, pushAt: 3 + r(), push: 0.45 + 0.15 * r(),
    });
    last = kind;
    if (--left <= 0) { robotIx = (robotIx + 1) % PARADE.length; left = 2 + Math.floor(r() * 2); }
  }
  return out;
}

// the camera of a shot. b = { x, y, z, yaw } of the lead robot base (for a
// squad: the middle of the group), D = DIM of the lead robot, t = seconds
// into the shot, foot = [x, y, z] of a foot (strike shot) or null.
export function camAt(shot, t, b, D, foot = null) {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw), s0 = shot.side;
  const H = D.h, at = (fx, fy, z) => [b.x + c * fx - s * fy, b.y + s * fx + c * fy, z];
  const tgt = (fx, z) => at(fx, 0, z);
  switch (shot.kind) {
    case 'dolly': { const d = 1.1 + 1.3 * H; return { pos: at(0.25 * H, s0 * d, 0.22 * H + 0.08), target: tgt(0.35 * H, 0.42 * H), fov: 34 }; }
    case 'orbit': { const a = shot.phase + s0 * t * 0.32, d = 1.6 + 1.9 * H; return { pos: [b.x + d * Math.cos(a), b.y + d * Math.sin(a), 0.55 * H + 0.3], target: [b.x, b.y, 0.5 * H], fov: 34 }; }
    case 'top': { return { pos: at(-0.4 * H - 0.3, 0.001, 3.2 + 2.2 * H), target: tgt(0.2 * H, 0), fov: 40 }; }
    case 'strike': {
      const f = foot || [b.x, b.y, 0.05], d = 0.55 + 0.6 * H;
      return { pos: [f[0] + c * 0.2 * d - s * s0 * d, f[1] + s * 0.2 * d + c * s0 * d, 0.06 + 0.08 * H], target: [f[0], f[1], 0.06 + 0.06 * H], fov: 30 };
    }
    case 'push': { const d = 1.6 + 1.8 * H; return { pos: at(-0.3 * d, -s0 * d, 0.5 * H + 0.35), target: tgt(0, 0.5 * H), fov: 36 }; }
    case 'xray': { const a = shot.phase + t * 0.12, d = 1.3 + 1.6 * H; return { pos: [b.x + d * Math.cos(a), b.y + d * Math.sin(a), 0.75 * H + 0.2], target: [b.x, b.y, 0.48 * H], fov: 32 }; }
    case 'sees': { const d = 1.6 + 2.0 * H; return { pos: at(0.15 * d, s0 * d, 0.55 * H + 0.2), target: at(0, -s0 * 0.45 * H, 0.5 * H), fov: 36 }; }
    case 'front': { const d = 1.5 + 1.6 * H; return { pos: at(d, 0.25 * s0 * d, 0.45 * H + 0.15), target: tgt(0, 0.5 * H), fov: 34 }; }
    case 'squad': { const d = 6.5; return { pos: at(0.75 * d, s0 * 0.55 * d, 1.9), target: tgt(0.2, 0.7), fov: 36 }; }
    default: return { pos: at(-3, 3, 1.5), target: tgt(0, 0.5 * H), fov: 36 };
  }
}

// lateral offsets of the robots in a squad shot (m)
export const SQUAD = { g1: -0.6, h1: 0.75, h1_2: 2.1, go2: -1.85 };

// the push of a push shot: a side push in the robot frame, away from the
// camera side, so the arrow shows between the camera and the robot
export function pushVec(shot, yaw) {
  const s = shot.side, k = shot.push;
  return [-Math.sin(yaw) * s * k, Math.cos(yaw) * s * k];
}
// replay window of a push shot (s of shot time) and its speed
export const REPLAY = { before: 0.3, after: 1.5, speed: 0.4 };
export const yawOf = q => Math.atan2(2 * (q[0] * q[3] + q[1] * q[2]), 1 - 2 * (q[2] * q[2] + q[3] * q[3]));
