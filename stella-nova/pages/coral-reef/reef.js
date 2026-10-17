// ============================================================================
//  CORAL REEF  ·  growth model (DOM-free: the page, a worker and node tests)
// ----------------------------------------------------------------------------
//  Each coral colony is one 3D DLA model of lib/dla-engine.js (a port of
//  fogleman/dlaf, MIT). The five dlaf hooks define the species. Nutrient
//  particles ("marine snow") start on a disc above the colony and fall
//  with a current. A walker that comes near the colony can join it. A
//  walker that reaches the seabed or leaves the reef box starts again.
//  So the growth is nutrient-limited, as in the coral models of Kaandorp
//  (Kaandorp, Lowe, Frenkel and Sloot 1996, Phys. Rev. Lett. 77, 2328):
//  the tips are the first parts that the falling particles touch, so the
//  tips catch more and grow more. This file has our own code, not theirs.
//
//  FRAMES. A colony model has its seed at its local origin, on the top of
//  its rock. World = local + (bx, by, bz). y is up. The seabed is
//  terrain.js: real lidar relief (groundY, also exported as sandY) and a
//  rock SDF under each colony. Walkers that enter the solid start again,
//  or stick to the rock as a new root (encrust). No particle is placed
//  inside the solid (outOfSolid).
//
//  SPECIES (grep -n 'export const SPECIES')
//    staghorn ... low attraction, high stickiness, joins on busy or lower
//                 particles refused: tips grow up into branches
//    fan ........ the walk stays in a vertical plane across the current
//    table ...... a short stalk, then only horizontal joins: a flat plate
//    boulder .... high stubbornness: walkers fill the gaps, a compact dome
//    finger ..... low stickiness and short fall: thick soft lobes
//
//  USE
//    const reef = createReef({ seed: 3, capTotal: 16000 });
//    reef.loadPreset('mixed');            // rocks and colony seeds
//    reef.step(dtMs, budgetMs, nowMs);    // grow in a time budget
//    reef.count, reef.px/py/pz, reef.col, reef.loc, reef.birth
//    growPreset('table', 7) -> a reef grown to its caps (thumbnails, tests)
//
//  grep -n targets
//    seabed height .............. "export const sandY"
//    the solid near a colony ..... "function solidLocal"
//    roots on the rock ........... "function encrust"
//    shared hooks ............... "function snowStart"
//    species table .............. "export const SPECIES"
//    presets .................... "export const PRESETS"
//    the reef object ............ "export function createReef"
//    time-budget growth ......... "function step"
//    bleaching .................. "export function bleachLevel"
//    shape measures (tests) ..... "export function shapeOf"
//    polyp radius ............... "export function polypRadius"
//    grow to the end ............ "export function growPreset"
//    hook source (saver code) ... "export function speciesHook"
// ============================================================================
import { createModel, rng, randomInUnitSphere } from '../../lib/dla-engine.js';
import { groundY, makeRock, rockSdf, rockTopY, solidAt, pushOut, knollSites } from './terrain.js';

const TAU = Math.PI * 2;

// ── seabed ──────────────────────────────────────────────────────────────────
// The floor is terrain.js: the real lidar relief of the Buck Island lagoon
// (scaled) and a rock SDF under each colony. The page mesh, the hooks and
// the tests use the same functions, so a walker meets the floor that the
// eye sees. sandY is the old name of the ground height.
export const sandY = groundY;

// The solid around a colony in its local frame: the ground or its rock.
// Cheap above u.solidTop (the highest solid point near the colony).
function solidLocal(u, p) {
  if (p[1] > u.solidTop) return false;
  return solidAt(u.bx + p[0], u.by + p[1], u.bz + p[2], u.solids);
}

// Move a local point out of the solid (pushOut in world space).
const WP = [0, 0, 0];
function outOfSolid(u, out) {
  if (out[1] > u.solidTop) return out;
  WP[0] = u.bx + out[0]; WP[1] = u.by + out[1]; WP[2] = u.bz + out[2];
  pushOut(WP, u.solids, 0.06);
  out[0] = WP[0] - u.bx; out[1] = WP[1] - u.by; out[2] = WP[2] - u.bz;
  return out;
}

// ── shared hooks ────────────────────────────────────────────────────────────
// m.user: { sp (species), env (current, temperature), bx by bz, rock,
// top, ext, kids, normal (fan) }.

// Marine snow starts on a disc above the colony. The disc moves upstream
// by the distance that the current carries a particle while it falls, so
// the snow passes over the colony.
function snowStart(m, out) {
  const u = m.user, s = u.sp, e = u.env;
  const y = u.top + s.lift + m.params.attractionDistance;
  const R = u.ext + s.spread;
  const a = m.random() * TAU, r = R * Math.sqrt(m.random());
  const k = e.strength * s.drift / s.fall;          // sideways run per unit of fall
  out[0] = Math.cos(a) * r - e.cur[0] * k * y * 0.75;
  out[1] = y;
  out[2] = Math.sin(a) * r - e.cur[1] * k * y * 0.75;
  return out;
}

// Start again under the floor, over the snow disc, or out of the reef box.
function snowReset(m, p) {
  const u = m.user, s = u.sp, e = u.env;
  if (solidLocal(u, p)) { encrust(m, p); return true; }
  const lid = u.top + s.lift + m.params.attractionDistance + 6;
  if (p[1] > lid) return true;
  const R = u.ext + s.spread + 8 + e.strength * s.drift / s.fall * lid;
  return p[0] * p[0] + p[2] * p[2] > R * R;
}

// A walker that hits the rock or the ground near the base of the colony
// can stick there: a new root (parent -1) of the same colony. So the
// colony spreads over its rock (sp.encrust is the chance per hit, up to
// sp.roots roots, inside sp.reach x the rock radius).
const EQ = [0, 0, 0];
function encrust(m, p) {
  const u = m.user, s = u.sp;
  if (!s.encrust || u.roots >= s.roots || !u.room()) return;
  const rr = Math.max(u.rock.rx, u.rock.rz) * s.reach;
  if (p[0] * p[0] + p[2] * p[2] > rr * rr) return;
  if (m.random() > s.encrust) return;
  EQ[0] = p[0]; EQ[1] = p[1]; EQ[2] = p[2];
  outOfSolid(u, EQ);
  if (EQ[1] > u.solidTop + 1) return;
  u.roots++;
  m.add(EQ, -1);
}

// A random step plus the fall and the current. The engine normalises it.
function snowMotion(m, p, out) {
  const u = m.user, s = u.sp, e = u.env, k = e.strength * s.drift;
  randomInUnitSphere(m.random, 3, out);
  out[0] += e.cur[0] * k; out[1] -= s.fall; out[2] += e.cur[1] * k;
  return out;
}

// dlaf ShouldJoin: stubbornness first, then stickiness.
function dlafJoin(m, parent) {
  m.joinAttempts[parent]++;
  if (m.joinAttempts[parent] < m.params.stubbornness) return false;
  return m.random() <= m.params.stickiness;
}

// dlaf PlaceParticle, then out of the rock and the ground.
function placeAbove(m, p, parent, out) {
  m.lerpFrom(parent, p, m.params.particleSpacing, out);
  return outOfSolid(m.user, out);
}

const BASE = { randomStartingPosition: snowStart, shouldReset: snowReset, shouldJoin: (m, p, parent) => dlafJoin(m, parent), placeParticle: placeAbove, motionVector: snowMotion };

// ── species ─────────────────────────────────────────────────────────────────
// params: the five dlaf parameters. fall: the downward bias of the walk.
// drift: how much the current moves the walk. lift: the height of the snow
// disc over the top of the colony. spread: the disc radius past the colony.
// cap: the most polyps in one colony. r0, thick: polyp radius (polypRadius).
// sway: soft corals and fans move with the water. encrust, roots, reach:
// a walker that hits the rock near the base sticks as a new root with
// chance encrust, up to roots roots, inside reach x the rock radius.
// base, tip: natural colours (linear 0..1), tip at the growing ends.
export const SPECIES = {
  staghorn: {
    label: 'Staghorn coral', latin: 'Acropora cervicornis', form: 'Branching',
    params: { particleSpacing: 1, attractionDistance: 1.5, minMoveDistance: 0.8, stubbornness: 0, stickiness: 0.9 },
    fall: 1.1, drift: 0.9, lift: 5, spread: 3, cap: 2200, r0: 0.5, thick: 0.17, sway: 0, encrust: 0.03, roots: 6, reach: 0.9,
    base: [0.72, 0.56, 0.38], tip: [0.86, 0.80, 0.98],
    hooks: {
      // Tips favoured: a busy particle, or a walker from the side or below,
      // rarely sticks.
      shouldJoin(m, p, parent) {
        if (!dlafJoin(m, parent)) return false;
        const up = p[1] - m.pos[parent * 3 + 1];
        if (m.user.kids[parent] >= 2 && m.random() > 0.12) return false;
        if (up < 0.3 && m.random() > 0.2) return false;
        return true;
      },
    },
  },
  fan: {
    label: 'Sea fan', latin: 'Gorgonia ventalina', form: 'Planar fan',
    params: { particleSpacing: 0.5, attractionDistance: 0.9, minMoveDistance: 0.45, stubbornness: 0, stickiness: 0.7 },
    fall: 0.12, drift: 0, lift: 5, spread: 4, cap: 850, r0: 0.2, thick: 0.1, sway: 1, encrust: 0,
    base: [0.62, 0.16, 0.46], tip: [0.95, 0.45, 0.62],
    hooks: {
      // The walk stays in the vertical plane across the current. The snow
      // comes in on a half circle in that plane, so the fan grows wide.
      randomStartingPosition(m, out) {
        const u = m.user, n = u.normal, R = Math.max(u.top, u.ext) + u.sp.spread;
        const a = (m.random() - 0.5) * 0.9 * Math.PI;
        out[0] = -n[1] * Math.sin(a) * R; out[1] = Math.cos(a) * R; out[2] = n[0] * Math.sin(a) * R;
        return out;
      },
      shouldReset(m, p) {
        const u = m.user, R = Math.max(u.top, u.ext) + u.sp.spread + 6;
        return solidLocal(u, p) || p[0] * p[0] + p[1] * p[1] + p[2] * p[2] > R * R;
      },
      motionVector(m, p, out) {
        const n = m.user.normal;
        randomInUnitSphere(m.random, 3, out);
        const d = out[0] * n[0] + out[2] * n[1];
        out[0] -= n[0] * d; out[2] -= n[1] * d;
        out[1] -= m.user.sp.fall;
        return out;
      },
    },
  },
  table: {
    label: 'Table coral', latin: 'Acropora hyacinthus', form: 'Tabular',
    params: { particleSpacing: 1, attractionDistance: 2, minMoveDistance: 0.8, stubbornness: 1, stickiness: 0.9 },
    fall: 1.2, drift: 0.6, lift: 4, spread: 6, cap: 2400, r0: 0.5, thick: 0.12, sway: 0, stalk: 7, encrust: 0,
    base: [0.42, 0.55, 0.42], tip: [0.75, 0.92, 0.72],
    hooks: {
      // A short stalk grows up. Past it, only horizontal joins stick.
      shouldJoin(m, p, parent) {
        if (!dlafJoin(m, parent)) return false;
        const i = parent * 3, dy = p[1] - m.pos[i + 1];
        const dh = Math.hypot(p[0] - m.pos[i], p[2] - m.pos[i + 2]);
        if (m.depth[parent] < m.user.sp.stalk) return m.user.kids[parent] === 0 && dy > 0;
        return dh > 2.5 * Math.abs(dy) || m.random() < 0.03;
      },
      placeParticle(m, p, parent, out) {
        placeAbove(m, p, parent, out);
        if (m.depth[parent] >= m.user.sp.stalk) {
          const y0 = m.pos[parent * 3 + 1];
          out[1] = y0 + (out[1] - y0) * 0.12;
          outOfSolid(m.user, out);
        }
        return out;
      },
    },
  },
  boulder: {
    label: 'Brain coral', latin: 'Diploria labyrinthiformis', form: 'Massive dome',
    params: { particleSpacing: 0.9, attractionDistance: 2.4, minMoveDistance: 0.7, stubbornness: 14, stickiness: 0.5 },
    fall: 0.6, drift: 0.5, lift: 4, spread: 4, cap: 2600, r0: 0.62, thick: 0.03, sway: 0, density: 0.45, encrust: 0,
    base: [0.66, 0.60, 0.30], tip: [0.86, 0.80, 0.50],
    hooks: {
      // Accretive growth: the tissue lays each new polyp on the surface of
      // a compact dome of this many polyps, so the colony stays a dome.
      placeParticle(m, p, parent, out) {
        placeAbove(m, p, parent, out);
        const dome = Math.cbrt(3 * m.count / (TAU * m.user.sp.density)) + 0.3;
        const r = Math.hypot(out[0], out[1], out[2]);
        if (r > dome) { const k = dome / r; out[0] *= k; out[1] *= k; out[2] *= k; }
        return outOfSolid(m.user, out);
      },
    },
  },
  finger: {
    label: 'Finger leather coral', latin: 'Sinularia', form: 'Soft lobes',
    params: { particleSpacing: 1, attractionDistance: 2.6, minMoveDistance: 0.8, stubbornness: 3, stickiness: 0.2 },
    fall: 0.5, drift: 0.7, lift: 4, spread: 3, cap: 1100, r0: 0.75, thick: 0.15, sway: 0.6, encrust: 0.05, roots: 5, reach: 0.8,
    base: [0.72, 0.48, 0.62], tip: [0.96, 0.82, 0.88],
    hooks: {},
  },
};
export const SPECIES_IDS = Object.keys(SPECIES);

// ── presets ─────────────────────────────────────────────────────────────────
// mix: the species of the colonies, in order. R: the radius of the reef
// disc. gap: the least distance between two colony rocks.
export const PRESETS = {
  mixed: { label: 'Mixed reef', R: 52, gap: 24, mix: ['staghorn', 'table', 'fan', 'boulder', 'finger', 'staghorn', 'fan', 'boulder', 'finger'] },
  staghorn: { label: 'Staghorn thicket', R: 44, gap: 20, mix: ['staghorn', 'staghorn', 'staghorn', 'staghorn', 'staghorn', 'staghorn', 'finger'] },
  fans: { label: 'Fan garden', R: 46, gap: 21, mix: ['fan', 'fan', 'fan', 'fan', 'fan', 'fan', 'finger', 'finger'] },
  table: { label: 'Table reef', R: 50, gap: 30, mix: ['table', 'table', 'table', 'table', 'boulder', 'boulder', 'finger'] },
  boulder: { label: 'Boulder field', R: 44, gap: 22, mix: ['boulder', 'boulder', 'boulder', 'boulder', 'boulder', 'boulder', 'finger', 'finger'] },
};
export const PRESET_IDS = Object.keys(PRESETS);

// ── bleaching ───────────────────────────────────────────────────────────────
// 0 below 29.5 C, 1 above 31.5 C. The page desaturates the colours by it
// and multiplies the growth rate by 1 - b.
export function bleachLevel(tempC) {
  const t = Math.min(1, Math.max(0, (tempC - 29.5) / 2));
  return t * t * (3 - 2 * t);
}

// The radius of a polyp from the size of its subtree: thick bases, thin tips.
export function polypRadius(sp, sub) {
  return sp.r0 * (1 + sp.thick * Math.log2(1 + sub));
}

// ── the reef ────────────────────────────────────────────────────────────────
export function createReef(opts = {}) {
  const capTotal = opts.capTotal ?? 16000;
  const env = Object.assign({ cur: [1, 0], strength: 0.5, temp: 27, nutrient: 1, speed: 1 }, opts.env || {});
  const params = {};   // per species: the live dlaf parameters (advanced panel)
  for (const id of SPECIES_IDS) params[id] = Object.assign({}, SPECIES[id].params);
  const R = {
    env, params, capTotal, limit: capTotal, rocks: [], colonies: [], seed: opts.seed ?? 1,
    count: 0, now: 0, joined: 0, walks: 0,
    px: new Float32Array(capTotal), py: new Float32Array(capTotal), pz: new Float32Array(capTotal),
    col: new Uint16Array(capTotal), loc: new Int32Array(capTotal), birth: new Float32Array(capTotal),
    addColony, loadPreset, step, growAll, reset, setCurrent, setParams, colonyCap, done,
    get bleach() { return bleachLevel(env.temp); },
    allowance: 0,
  };
  let random = rng(R.seed);

  function setCurrent(deg, strength) {
    const a = deg * Math.PI / 180;
    env.cur[0] = Math.cos(a); env.cur[1] = Math.sin(a);
    if (strength !== undefined) env.strength = strength;
  }

  // The cap of one colony: its species cap, and a fair share of the total.
  // R.limit (<= capTotal) is the live cap: the saver grows smaller reefs.
  function colonyCap(sp, n) { return Math.max(60, Math.min(sp.cap, Math.floor(R.limit / Math.max(1, n)))); }

  // A colony of species id at world (x, z), on a new rock (or o.rock).
  // o.at = [x, y, z] puts the seed at that surface point (tap to plant on
  // a rock). The seed sits on the top of the rock.
  function addColony(id, x, z, o = {}) {
    const sp = SPECIES[id]; if (!sp) return null;
    if (R.count >= R.limit) return null;
    const rock = o.rock || makeRock(random, x, z, { r: o.rockR ?? 5 + random() * 2 });
    if (!o.rock) R.rocks.push(rock);
    // the seed: on the top of the rock (or at o.at), out of every solid near
    const solids = [rock].concat(R.rocks.filter(q => q !== rock && Math.hypot(q.x - x, q.z - z) < q.R + 45));
    const seed = pushOut([x, o.at ? o.at[1] : rockTopY(rock, x, z), z], solids, 0.06);
    const by = seed[1];
    const k = R.colonies.length;
    // the highest solid point near the colony: the walkers test the solid only below it
    let solidTop = 1;
    for (let a = 0; a < 96; a++) {
      const r = Math.sqrt((a + 0.5) / 96) * 42, t = a * 2.39996;
      solidTop = Math.max(solidTop, groundY(x + Math.cos(t) * r, z + Math.sin(t) * r) + 0.5 - by);
    }
    for (const q of solids) solidTop = Math.max(solidTop, q.y + q.ry * (1 + q.ov) + q.amp * 1.2 + 1 - by);
    const user = {
      sp, env, bx: x, by, bz: z, rock, solids, top: 0, ext: 0, kids: [], roots: 1, solidTop,
      // a fan grows across the current: its plane normal is the current
      normal: [env.cur[0], env.cur[1]],
      room: () => R.count < R.limit - 1 && colony.count < colony.cap - 1,
    };
    const colony = { k, id, sp, user, model: null, cap: o.cap ?? colonyCap(sp, o.share ?? Math.max(1, R.colonies.length + 1)), born: R.now, count: 0, ids: [] };
    colony.model = createModel({
      dim: 3, random, params: params[id], hooks: Object.assign({}, BASE, sp.hooks), maxSteps: 6000, user,
      onAdd(i, par, m) {
        const u = m.user, x0 = m.pos[i * 3], y0 = m.pos[i * 3 + 1], z0 = m.pos[i * 3 + 2];
        u.kids.push(0); if (par >= 0) u.kids[par]++;
        if (y0 > u.top) u.top = y0;
        const e = Math.hypot(x0, z0); if (e > u.ext) u.ext = e;
        const g = R.count++;
        R.px[g] = x0 + u.bx; R.py[g] = y0 + u.by; R.pz[g] = z0 + u.bz;
        R.col[g] = k; R.loc[g] = i; R.birth[g] = R.now;
        colony.ids.push(g); colony.count++;
      },
    });
    R.colonies.push(colony);
    colony.model.add([0, 0, 0]);
    return colony;
  }

  // Rocks and colony seeds of a preset, placed by the seed of the reef.
  // The colonies take the knolls of the real seabed first (their rock is
  // large and sits on the knoll top), then open sand.
  function loadPreset(pid, o = {}) {
    reset();
    const P = PRESETS[pid] || PRESETS.mixed;
    const n = P.mix.length, pts = [];
    const sites = knollSites(P.R);
    const off = Math.floor(random() * 3);
    for (let i = 0; i < sites.length && pts.length < Math.ceil(n * 0.7); i++) {
      const s = sites[(i + off) % sites.length];
      if (pts.every(q => Math.hypot(q[0] - s.x, q[1] - s.z) >= P.gap)) pts.push([s.x, s.z, 7 + random() * 2.5]);
    }
    for (let tries = 0; pts.length < n && tries < 4000; tries++) {
      const a = random() * TAU, r = P.R * Math.sqrt(random()) * (pts.length === 0 ? 0.3 : 1);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (pts.every(q => Math.hypot(q[0] - x, q[1] - z) >= P.gap)) pts.push([x, z, 5 + random() * 2]);
    }
    // the colony rocks, then loose rocks with no coral, then the colonies
    // (each colony knows every rock near it)
    const own = pts.map(q => { const rk = makeRock(random, q[0], q[1], { r: q[2] }); R.rocks.push(rk); return rk; });
    for (let i = 0; i < (o.loose ?? 10); i++) {
      const a = random() * TAU, r = (0.4 + 0.9 * random()) * P.R * 1.25;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (R.rocks.some(q => Math.hypot(q.x - x, q.z - z) < Math.max(q.rx, q.rz) + 4)) continue;
      R.rocks.push(makeRock(random, x, z, { r: 2 + random() * 3.5, loose: true, holes: 0 }));
    }
    pts.forEach((q, i) => addColony(P.mix[i], q[0], q[1], { share: n, rock: own[i] }));
    R.preset = pid;
    return R;
  }

  function done() { return R.colonies.every(c => c.count >= c.cap) || R.count >= R.limit; }

  // Grow for at most budgetMs, at the rate of env (polyps per second:
  // 900 x speed x nutrient x (1 - bleach)). dtMs is the frame time. The
  // colonies take turns, so each gets the same share of the snow.
  function step(dtMs, budgetMs = 8, now = 0, base = 900) {
    R.now = now;
    const rate = base * env.speed * env.nutrient * (1 - R.bleach);
    if (R.bleach > 0.98) { R.allowance = 0; return 0; }
    R.allowance = Math.min(R.allowance + rate * dtMs / 1000, rate * 0.25 + 2);
    const clock = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
    const t0 = clock(); let n = 0, turn = R.turn || 0;
    const live = R.colonies.filter(c => c.count < c.cap);
    while (R.allowance >= 1 && live.length && R.count < R.limit) {
      const c = live[turn++ % live.length];
      const w0 = c.model.walks;
      c.model.addParticle();
      R.walks += c.model.walks - w0;
      R.allowance--; n++;
      if (c.count >= c.cap) live.splice(live.indexOf(c), 1);
      if (clock() - t0 > budgetMs) break;
    }
    R.turn = turn; R.joined += n;
    return n;
  }

  // Grow all colonies to their caps (or n polyps). Node tests, thumbnails.
  function growAll(n = Infinity) {
    let k = 0;
    const live = R.colonies.filter(c => c.count < c.cap);
    while (live.length && k < n && R.count < R.limit) {
      for (let j = live.length - 1; j >= 0; j--) {
        const c = live[j];
        c.model.addParticle(); k++;
        if (c.count >= c.cap) live.splice(j, 1);
      }
    }
    return k;
  }

  function setParams(id, p) {
    Object.assign(params[id], p);
    for (const c of R.colonies) if (c.id === id) c.model.setParams(params[id]);
  }

  function reset(seed) {
    if (seed !== undefined) R.seed = seed;
    random = rng(R.seed);
    R.rocks = []; R.colonies = []; R.count = 0; R.joined = 0; R.walks = 0; R.allowance = 0; R.turn = 0;
  }

  return R;
}

// Grow a preset to its caps. Returns the reef. Thumbnails and tests use it.
export function growPreset(pid, seed = 1, o = {}) {
  const reef = createReef({ seed, capTotal: o.capTotal ?? 16000, env: o.env });
  reef.loadPreset(pid);
  reef.growAll(o.n);
  return reef;
}

// Size measures of one colony in its local frame: width (the largest
// horizontal span), height, thickness (the span along a direction, for
// the fan plane), the mean offset, and the fill (polyps per unit volume
// of the bounding hemisphere).
export function shapeOf(colony, dir) {
  const m = colony.model, n = m.count, P = m.pos;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = 0, sx = 0, sy = 0, sz = 0, rmax = 0, t0 = Infinity, t1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    y1 = Math.max(y1, y); sx += x; sy += y; sz += z;
    rmax = Math.max(rmax, Math.hypot(x, y, z));
    if (dir) { const t = x * dir[0] + z * dir[1]; t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
  }
  const width = Math.max(x1 - x0, z1 - z0);
  const vol = (2 / 3) * Math.PI * rmax * rmax * rmax;
  return { n, width, height: y1, thickness: dir ? t1 - t0 : 0, mean: [sx / n, sy / n, sz / n], fill: n / Math.max(1, vol), rmax };
}

// The hook that makes a species, for the explainer and the saver code
// extract: its own hook if it has one, else the shared snow motion.
// Returns { name, fn }. fn.toString() is the real source text.
export function speciesHook(id, which) {
  const h = (SPECIES[id] || SPECIES.staghorn).hooks;
  const names = Object.keys(h);
  const name = which && h[which] ? which : names.includes('shouldJoin') ? 'shouldJoin' : names.includes('placeParticle') ? 'placeParticle' : names[0];
  if (name) return { name, fn: h[name] };
  return { name: 'motionVector', fn: snowMotion };
}
