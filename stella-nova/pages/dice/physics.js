// ============================================================================
//  DICE LAB  ·  physics.js — the tray, the dice bodies and the throw
// ----------------------------------------------------------------------------
//  No DOM and no THREE. The caller passes the Rapier module (vendor
//  rapier3d-compat 0.21.0, Apache-2.0), so the page, the batch worker and
//  tests.mjs all run the same code. Units: cm, g, s. Gravity is 981 cm/s^2.
//
//  BODIES. Each die is one dynamic body with one convex hull collider: the
//  chamfered shape from dice.js buildDie().hull. Rapier computes the mass,
//  the centre of mass and the inertia tensor of the hull from the density
//  (resin 1.2 g/cm^3, the brass coin 8.5). CCD is on for each die, so a
//  fast die cannot pass through a wall in one step.
//
//  WORLD. Each throw builds a new Rapier world, so one seed always gives
//  the same throw. addDie() adds to the world in place (a re-roll, an
//  exploding die), so those dice land among the others.
//
//  TRAY. A felt floor (top at y = 0) and four wood walls of height WALL.
//  Clear walls continue up to 60 cm and a clear lid closes the box, so a
//  hard throw stays in the tray. Friction and restitution (average rule):
//      felt   mu 0.62  e 0.22      wood rim  mu 0.30  e 0.55
//      dice   mu 0.36  e 0.42
//  Felt also brakes a rolling die: angular damping 0.3 (the coin 2.5, so it
//  does not spin on its rim for long), linear 0.04. lengthUnit 5 keeps the
//  contact tolerance near 0.05 mm: with 100 the 1.8 mm coin sank and rocked.
//
//  THROW. throwDice() puts the dice in a loose cluster in the "hand" above
//  one end of the tray, each with a uniform random orientation, and gives
//  them a velocity towards the far end and a random spin. Every number
//  comes from the seeded generator, so one seed always gives one throw.
//  Nothing sets the result. The face reader reads it after the rest.
//
//  REST. A die is at rest when |v| < 0.6 cm/s and |w| < 0.25 rad/s for
//  0.35 s, or when it lies within 3 degrees of a face with |v| < 1.5 and
//  |w| < 1.2 (a thin coin rocks on felt), or when Rapier puts the body to
//  sleep. step() returns true when every die is at rest; a throw also
//  stops at MAX_T. The test does not force a body to sleep: a forced sleep
//  in a pile let other dice push the sleeper into the felt.
//
//  GREP MAP
//    export function createPhysics . the world, tray and step
//    function addDie ............... one body and its hull collider
//    function throwDice ............ the hand, the seed, the launch
//    function stepRest ............. the rest test per die
//    export function simulateThrow . a whole throw to rest (worker, tests)
// ============================================================================
import { buildDie, readDie, Q, mulberry32 } from './dice.js';

export const DT = 1 / 240;
export const MAX_T = 12;
export const WALL = 4.5;
export const TRAYS = { small: [24, 18], medium: [32, 22], large: [44, 30] };
const MAT = {
  felt: { mu: 0.5, e: 0.3 }, wood: { mu: 0.3, e: 0.55 }, die: { mu: 0.36, e: 0.5 },
};

export function createPhysics(R, { tray = 'medium' } = {}) {
  let world = null;
  const dice = [];
  let trayBodies = [], dims = TRAYS[tray] || TRAYS.medium;

  // a fresh world for each throw: Rapier keeps contact and arena state
  // after a body is removed, so a reused world gave a different throw for
  // the same seed (and, after many throws, a die sunk in the felt)
  function fresh() {
    if (world) try { world.free(); } catch (e) { /* freed */ }
    world = new R.World({ x: 0, y: -981, z: 0 });
    world.timestep = DT;
    try { world.lengthUnit = 5; } catch (e) { /* older builds */ }
    world.numSolverIterations = 6;
    world.maxCcdSubsteps = 3;
    dice.length = 0; trayBodies = [];
    setTray();
  }
  function setTray(name) {
    if (name) dims = TRAYS[name] || dims;
    for (const b of trayBodies) world.removeRigidBody(b);
    trayBodies = [];
    const [w, d] = dims, t = 10, H = 60;
    const fixed = (x, y, z, hx, hy, hz, m) => {
      const b = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, y, z));
      world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setFriction(m.mu).setRestitution(m.e), b);
      trayBodies.push(b);
    };
    fixed(0, -t, 0, w / 2 + t, t, d / 2 + t, MAT.felt);
    fixed(-(w / 2 + t), H / 2, 0, t, H / 2, d / 2 + t, MAT.wood);
    fixed(w / 2 + t, H / 2, 0, t, H / 2, d / 2 + t, MAT.wood);
    fixed(0, H / 2, -(d / 2 + t), w / 2 + t, H / 2, t, MAT.wood);
    fixed(0, H / 2, d / 2 + t, w / 2 + t, H / 2, t, MAT.wood);
    fixed(0, H + t, 0, w / 2 + t, t, d / 2 + t, MAT.wood);
  }
  fresh();

  function addDie(type, pos, rot) {
    const die = buildDie(type);
    const body = world.createRigidBody(R.RigidBodyDesc.dynamic()
      .setTranslation(pos[0], pos[1], pos[2]).setRotation({ x: rot[0], y: rot[1], z: rot[2], w: rot[3] })
      .setCcdEnabled(true).setAngularDamping(type === 'coin' ? 2.5 : 0.3).setLinearDamping(0.04));
    const cd = R.ColliderDesc.convexHull(die.hull);
    cd.setDensity(die.T.density).setFriction(MAT.die.mu).setRestitution(MAT.die.e);
    world.createCollider(cd, body);
    const o = { type, die, body, still: 0, rest: false };
    dice.push(o);
    return o;
  }
  function clear() { fresh(); t = 0; }

  // the hand: a cluster at x = -w/2 + 5, h 7..11 cm. dir: unit [x, z] of
  // the throw (default +x), strength 0..1 (0.5 is a normal throw).
  let t = 0;
  function throwDice(types, { seed = 1, strength = 0.5, dir = [1, 0], spin = 1, from = null } = {}) {
    clear();
    const rnd = mulberry32(seed), [w, d] = dims;
    let [dx, dz] = dir; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    // the hand sits on the side the throw comes from
    const hx = from ? from[0] : -dx * (w / 2 - 5), hz = from ? from[1] : -dz * (d / 2 - 4);
    const n = types.length, cols = Math.max(1, Math.ceil(Math.cbrt(n * 1.6))), gap = 2.9;
    types.forEach((type, i) => {
      const a = i % cols, b = Math.floor(i / cols) % cols, c = Math.floor(i / (cols * cols));
      const jit = () => (rnd() - 0.5) * 0.5;
      // the lattice turned to the throw direction: a across, b along
      const ax = (a - (cols - 1) / 2) * gap + jit(), bz = (b - (cols - 1) / 2) * gap + jit();
      const px = hx + ax * -dz + bz * dx * 0.6, pz = hz + ax * dx + bz * dz * 0.6;
      const py = 7 + c * gap + rnd() * 3;
      const lim = (v, L) => Math.max(-L, Math.min(L, v));
      const o = addDie(type, [lim(px, w / 2 - 1.6), py, lim(pz, d / 2 - 1.6)], Q.random(rnd));
      const sp = 40 + 200 * strength;                       // cm/s
      const ang = (rnd() - 0.5) * 0.5, ca = Math.cos(ang), sa = Math.sin(ang);
      const vx = (dx * ca - dz * sa) * sp * (0.85 + 0.3 * rnd()), vz = (dz * ca + dx * sa) * sp * (0.85 + 0.3 * rnd());
      o.body.setLinvel({ x: vx, y: -20 - 60 * rnd() + 40 * strength, z: vz }, true);
      const wmag = (12 + 28 * rnd()) * spin, wv = Q.rot(Q.random(rnd), [0, 0, 1]);
      o.body.setAngvel({ x: wv[0] * wmag, y: wv[1] * wmag, z: wv[2] * wmag }, true);
    });
    t = 0;
    return dice;
  }

  // re-throw some dice (a cocked die): lift each and drop it with spin
  function rethrow(list, seed) {
    const rnd = mulberry32(seed);
    list.forEach(o => {
      const p = o.body.translation();
      o.body.setTranslation({ x: p.x * 0.8, y: 6 + rnd() * 3, z: p.z * 0.8 }, true);
      const q = Q.random(rnd); o.body.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }, true);
      o.body.setLinvel({ x: (rnd() - 0.5) * 80, y: -10, z: (rnd() - 0.5) * 80 }, true);
      const wv = Q.rot(Q.random(rnd), [0, 0, 1]), m = 15 + 20 * rnd();
      o.body.setAngvel({ x: wv[0] * m, y: wv[1] * m, z: wv[2] * m }, true);
      o.rest = false; o.still = 0; o.sv = o.sw = 99;
    });
    t = 0;
  }

  function stepRest() {
    let all = true;
    for (const o of dice) {
      if (o.body.isSleeping()) { o.rest = true; continue; }
      // speeds smoothed over ~0.05 s: a contact spike in one step does not
      // reset the rest clock
      const v = o.body.linvel(), w = o.body.angvel();
      o.sv = (o.sv ?? 99) * 0.92 + Math.hypot(v.x, v.y, v.z) * 0.08;
      o.sw = (o.sw ?? 99) * 0.92 + Math.hypot(w.x, w.y, w.z) * 0.08;
      const sv = o.sv, sw = o.sw;
      // still: slow. flat: a small rock (a thin coin on felt) while it lies
      // within 3 degrees of a face; the read cannot change then.
      let calm = sv < 0.6 && sw < 0.25;
      if (!calm && sv < 1.5 && sw < 1.2) { const q = o.body.rotation(); calm = readDie(o.die, [q.x, q.y, q.z, q.w]).tilt < 3; }
      o.still = calm ? o.still + DT : 0;
      o.rest = o.still > 0.35;
      if (!o.rest) all = false;
    }
    return all;
  }
  function step() { world.step(); t += DT; return stepRest(); }

  // pack poses: [px py pz qx qy qz qw] per die
  function poses(out) {
    const a = out || new Float32Array(dice.length * 7);
    dice.forEach((o, i) => {
      const p = o.body.translation(), q = o.body.rotation();
      a.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w], i * 7);
    });
    return a;
  }
  function read() {
    return dice.map(o => { const q = o.body.rotation(); return { type: o.type, ...readDie(o.die, [q.x, q.y, q.z, q.w]) }; });
  }
  return {
    R, get world() { return world; }, dice, setTray: name => { dims = TRAYS[name] || dims; fresh(); }, addDie, clear, throwDice, rethrow, step, poses, read,
    get t() { return t; }, get dims() { return dims; },
    free() { try { world.free(); } catch (e) { /* freed */ } },
  };
}

// simulateThrow: one throw to rest. Returns the reads, the rest time and,
// with record > 0, poses every `record` steps.
export function simulateThrow(P, types, opt = {}) {
  P.throwDice(types, opt);
  const frames = [], every = opt.record || 0;
  let n = 0, rest = false;
  if (every) frames.push(P.poses());
  while (P.t < MAX_T) {
    rest = P.step(); n++;
    if (every && n % every === 0) frames.push(P.poses());
    if (rest) break;
  }
  if (every && n % every) frames.push(P.poses());
  return { reads: P.read(), t: P.t, rest, frames };
}
