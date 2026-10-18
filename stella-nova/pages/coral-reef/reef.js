// ============================================================================
//  CORAL REEF  ·  growth model v3 (DOM-free: the page, a worker, node tests)
// ----------------------------------------------------------------------------
//  All colonies of the reef grow in ONE 3D DLA model of lib/dla-engine.js
//  (a port of fogleman/dlaf, MIT). So they share one spatial index and one
//  nutrient field. Nutrient particles ("marine snow") start above the live
//  colonies and fall with the current. A walker joins the nearest coral
//  particle, of any colony, so neighbours compete: a tall colony upstream
//  shades the one behind it, branches grow round each other, and colonies
//  fuse (same species) or overgrow (other species) where they touch. The
//  growth is nutrient-limited, as in the coral models of Kaandorp (Kaandorp,
//  Lowe, Frenkel and Sloot 1996, Phys. Rev. Lett. 77, 2328). This file has
//  our own code, not theirs.
//
//  UNITS. World: metres, y up, the plot centred at the origin. The DLA model
//  works in lattice units of U metres (U = 0.01 m x fine), because the
//  engine grid cell is at least 0.5 units. R.px/py/pz are metres.
//
//  ROCK. The colonies grow on rock/index.js createRock (ROCK package):
//  rock.sdf (negative inside; a bound: steps use sdf / rock.lipschitz,
//  thresholds sdf / rock.sdfScale), rock.normal, rock.sampleSurface, and
//  rock.sand.heightAt (the sand is not in rock.sdf). Walkers that touch
//  the rock or the sand are lost, except next to the coral of a colony
//  whose species encrusts: there a walker can stick as a new root, so the
//  base creeps over the rock. No particle centre is ever inside the rock
//  or under the sand (the tests check it).
//
//  SIZE. The user said (2026-10-18): "we should be able to simulate much
//  large growing coral reef structures these are pathetically small for
//  the size of seamount we're workign iwht". Each species has a scale s
//  (coral-sdf.js SPECIES_SCALE, 1.75 to 2): its spacing and its SDF
//  lengths are s times larger, so colonies of 2 to 8 m have the particle
//  count of the old 1 to 4 m ones. More colonies (34 to 96 by quality) in
//  larger patches (7 m) meet and fuse into a reef framework.
//
//  STOP. A colony stops at its cap, at its soft size outline, when it
//  gets no join in 6000 walkers (shaded out), or when its join rate past
//  half its cap falls under 6 % (its outline is full).
//
//  API (SCENE and the worker build against this header)
//    const R = createReef({ rock, seed, quality: 'desktop'|'mid'|'phone',
//                           radius, env, budget });
//    R.populate({ preset, colonies, sites, seed })  colony seeds on exposed
//                rock (o.sites, or rock.sampleSurface), species by exposure
//                and depth, in patches over the whole plot
//    R.loadPreset(pid)                 the same, by preset id (PRESET_IDS)
//    R.addColony(id, site, o)          site { p, n } on the rock; o.size, o.cap
//    R.growColony(site, id, o)         single-colony mode (the saver): a reset,
//                                      then ONE colony that grows at R.rate
//    R.setRate(polypsPerSecond)        the rate of step()
//    R.step(dtMs, budgetMs, nowMs)     grow in a time budget -> particles added
//    R.growAll(n), R.done(), R.progress(), R.reset(seed)
//    R.setCurrent(deg, strength), R.setParams(id, p)
//    Particle data (global id g, in join order):
//      R.count, R.px/py/pz (m), R.col (colony k), R.loc (index in colony),
//      R.parent (global id or -1), R.birth (ms), R.gy (base height of colony)
//    R.colonies[k] = { k, id, sp, base, normal, plane, size, cap, count,
//                      ids, top, ext, roots, user: { bx, by, bz, normal } }
//    R.contacts: Map 'a,b' -> { a, b, kind: 'fuse'|'overgrow', n, at }
//    R.bridges: Map g -> j: particle g of a fuse touched particle j of the
//               other colony (the mesher adds a bridge cone, M.bridge)
//    createReefMirror()  the same particle arrays on the main thread, fed by
//                        the worker messages (colour.js reads either one)
//    chooseFocus(colonies, points, budgetTris)  the colonies for the fine
//                        mesh (coral-sdf.js setFocus), nearest first
//    holdFocus(colonies, points, budgetTris, held, nowMs)  the same with
//                        hysteresis and a hold time (the reef worker)
//    R.progress() -> { count, target, limit, colonies, live, fraction, done,
//                      walkers, walks, lost, fusions, overgrowths }
//
//  SPECIES (grep -n 'export const SPECIES')
//    staghorn ... tips favoured: joins on busy or lower particles refused
//    fan ........ every new particle is put in the plane across the current
//    table ...... a short stalk, then only horizontal joins: a flat plate
//    boulder .... (brain coral) high stubbornness and a dome clamp: compact
//    finger ..... low stickiness: thick soft lobes
//
//  grep -n targets
//    quality budgets ........... "export const QUALITY"
//    species table ............. "export const SPECIES"
//    species by site ........... "export function pickSpecies"
//    cached rock distance ...... "export function cachedField"
//    the reef object ........... "export function createReef"
//    one walker ................ "function walkOne"
//    spawn above the colonies .. "function spawn"
//    contacts (fuse, overgrow) . "function contact"
//    colony seeds .............. "function populate"
//    single colony mode ........ "function growColony"
//    time-budget growth ........ "function step"
//    main-thread mirror ........ "export function createReefMirror"
//    shape measures (tests) .... "export function shapeOf"
//    hook source (saver code) .. "export function speciesHook"
//    focus with hysteresis ..... "export function holdFocus"
// ============================================================================
import { createModel, rng, randomInUnitSphere } from '../../lib/dla-engine.js';
import { SPECIES_SCALE, SDF_EXP } from './coral-sdf.js';

const TAU = Math.PI * 2;

// ── quality ─────────────────────────────────────────────────────────────────
// particles: the particle budget of the reef. colonies: how many seeds.
// fine: a scale of the particle spacing and the SDF cell (1 = finest).
// polyps: a scale of the polyp density. tris: the coral triangle budget
// (coral-sdf.js reports the count; the page can stop the mesh past it).
export const QUALITY = {
  desktop: { particles: 240000, colonies: 96, fine: 1, polyps: 1, tris: 4000000 },
  mid: { particles: 140000, colonies: 66, fine: 1.2, polyps: 0.7, tris: 2600000 },
  phone: { particles: 30000, colonies: 34, fine: 1.45, polyps: 0.45, tris: 650000 },
};

// ── species ─────────────────────────────────────────────────────────────────
// params: the five dlaf parameters in metres (scaled by fine). size: the
// range of colony sizes (m). dim: the mass dimension, for the cap of a
// colony of a size (cap = fill x (size / spacing)^dim). r0, thick: the
// particle radius for the page data (polypRadius). tpp: coral triangles
// per particle (measured), for the triangle budget. encrust, roots, reach:
// a walker that hits the rock within reach x size of the base sticks as a
// new root with chance encrust, up to roots roots. base, tip: natural
// colours (linear 0..1). sway: soft corals move with the water.
export const SPECIES = {
  staghorn: {
    label: 'Staghorn coral', latin: 'Acropora cervicornis', form: 'Branching',
    params: { particleSpacing: 0.04, attractionDistance: 0.055, minMoveDistance: 0.025, stubbornness: 0, stickiness: 0.9 },
    size: [3.5, 9.0], tall: 0.7, tpp: 81, dim: 1.62, fill: 7, r0: 0.013, thick: 0.17, sway: 0, encrust: 0.3, roots: 80, reach: 0.5,
    base: [0.72, 0.56, 0.38], tip: [0.86, 0.80, 0.98],
    hooks: {
      // Tips favoured: a busy particle, or a walker from the side or below,
      // rarely sticks.
      shouldJoin(R, p, parent) {
        if (!R.dlafJoin(parent)) return false;
        const up = p[1] - R.m.pos[parent * 3 + 1];
        if (R.kids[parent] >= 1 && R.random() > (R.kids[parent] >= 2 ? 0.04 : 0.22)) return false;
        if (up < 0.3 * R.spU(parent) && R.random() > 0.2) return false;
        return true;
      },
    },
  },
  fan: {
    label: 'Sea fan', latin: 'Gorgonia ventalina', form: 'Planar fan',
    params: { particleSpacing: 0.022, attractionDistance: 0.03, minMoveDistance: 0.016, stubbornness: 0, stickiness: 0.75 },
    size: [2.4, 5.5], tall: 1, tpp: 72, dim: 1.55, fill: 2.3, r0: 0.006, thick: 0.1, sway: 1, encrust: 0,
    base: [0.62, 0.16, 0.46], tip: [0.95, 0.45, 0.62],
    hooks: {
      // The new particle goes into the vertical plane of the fan, across the
      // current, so the fan grows flat and wide; a join from below is rare.
      placeParticle(R, p, parent, out) {
        R.m.lerpFrom(parent, p, R.spU(parent), out);
        const c = R.colonies[R.col[parent]], f = c.plane, U = R.U;
        const d = (out[0] - c.base[0] / U) * f[0] + (out[2] - c.base[2] / U) * f[1];
        out[0] -= f[0] * d; out[2] -= f[1] * d;
        if (out[1] < R.m.pos[parent * 3 + 1] - 0.5 * R.spU(parent)) out[1] = R.m.pos[parent * 3 + 1] - 0.5 * R.spU(parent);
        return out;
      },
    },
  },
  table: {
    label: 'Table coral', latin: 'Acropora hyacinthus', form: 'Tabular',
    params: { particleSpacing: 0.045, attractionDistance: 0.065, minMoveDistance: 0.03, stubbornness: 1, stickiness: 0.9 },
    size: [3.0, 8.5], tall: 0.4, tpp: 25, dim: 1.6, fill: 7, r0: 0.016, thick: 0.12, sway: 0, stalkM: 0.3, encrust: 0,
    base: [0.42, 0.55, 0.42], tip: [0.75, 0.92, 0.72],
    hooks: {
      // A short stalk grows up. Past it, only horizontal joins stick.
      shouldJoin(R, p, parent) {
        if (!R.dlafJoin(parent)) return false;
        const P = R.m.pos, i = parent * 3, dy = p[1] - P[i + 1];
        const dh = Math.hypot(p[0] - P[i], p[2] - P[i + 2]);
        if (R.m.depth[parent] < R.stalkOf(parent)) return R.kids[parent] === 0 && dy > 0;
        return dh > 2.5 * Math.abs(dy) || R.random() < 0.03;
      },
      placeParticle(R, p, parent, out) {
        R.m.lerpFrom(parent, p, R.spU(parent), out);
        if (R.m.depth[parent] >= R.stalkOf(parent)) {
          const y0 = R.m.pos[parent * 3 + 1];
          out[1] = y0 + (out[1] - y0) * 0.12;
        }
        return out;
      },
    },
  },
  boulder: {
    label: 'Brain coral', latin: 'Diploria labyrinthiformis', form: 'Massive dome',
    params: { particleSpacing: 0.12, attractionDistance: 0.1, minMoveDistance: 0.05, stubbornness: 6, stickiness: 0.6 },
    size: [2.2, 5.0], tall: 0.6, tpp: 120, dim: 2.75, fill: 0.45, r0: 0.04, thick: 0.03, sway: 0, density: 0.45, encrust: 0.35, roots: 40, reach: 0.45,
    base: [0.66, 0.60, 0.30], tip: [0.86, 0.80, 0.50],
    hooks: {
      // Accretive growth: the tissue lays each new particle on the surface
      // of a compact dome of this many particles, so the colony stays a dome.
      placeParticle(R, p, parent, out) {
        R.m.lerpFrom(parent, p, R.spU(parent), out);
        const c = R.colonies[R.col[parent]], U = R.U, s = R.spU(parent);
        const dome = s / 0.9 * (Math.cbrt(3 * c.count / (TAU * c.sp.density)) + 0.3);
        const bx = c.base[0] / U, by = c.base[1] / U, bz = c.base[2] / U;
        const dx = out[0] - bx, dy = out[1] - by, dz = out[2] - bz, r = Math.hypot(dx, dy, dz);
        if (r > dome) { const k = dome / r; out[0] = bx + dx * k; out[1] = by + dy * k; out[2] = bz + dz * k; }
        return out;
      },
    },
  },
  finger: {
    label: 'Finger leather coral', latin: 'Sinularia', form: 'Soft lobes',
    params: { particleSpacing: 0.04, attractionDistance: 0.065, minMoveDistance: 0.026, stubbornness: 3, stickiness: 0.2 },
    size: [1.8, 4.5], tall: 0.7, tpp: 91, dim: 1.9, fill: 2.1, r0: 0.02, thick: 0.15, sway: 0.6, encrust: 0.05, roots: 6, reach: 0.3,
    base: [0.72, 0.48, 0.62], tip: [0.96, 0.82, 0.88],
    hooks: {
      // dlaf ShouldJoin with a low stickiness: the walkers creep into the
      // gaps before they stick, so the lobes stay thick and soft.
      shouldJoin(R, p, parent) { return R.dlafJoin(parent); },
    },
  },
};
export const SPECIES_IDS = Object.keys(SPECIES);
// The species scale (coral-sdf.js SPECIES_SCALE): the dlaf distances and
// the table stalk are s times larger (the particle radius r0 s^SDF_EXP
// times, as the SDF radii; tpp x s^(1 - SDF_EXP)), so a colony
// s times larger has the same particle count (cap = fill x (size /
// spacing)^dim). The sizes above are the scaled ones (old x 1.75 .. 2).
for (const id of SPECIES_IDS) {
  const sp = SPECIES[id], sc = SPECIES_SCALE[id] || 1;
  sp.scale = sc;
  for (const k of ['particleSpacing', 'attractionDistance', 'minMoveDistance']) sp.params[k] *= sc;
  sp.r0 *= Math.pow(sc, SDF_EXP);              // the SDF radii scale by s^SDF_EXP
  sp.tpp *= Math.pow(sc, 1 - SDF_EXP);          // longer cones, thinner than x s: more tris per particle
  if (sp.stalkM) sp.stalkM *= sc;
}

// ── presets ─────────────────────────────────────────────────────────────────
// weights: a multiplier on the site rule of each species (pickSpecies).
export const PRESETS = {
  mixed: { label: 'Mixed reef', weights: {} },
  staghorn: { label: 'Staghorn thicket', weights: { staghorn: 6, finger: 0.4, fan: 0.3, table: 0.3, boulder: 0.3 } },
  fans: { label: 'Fan garden', weights: { fan: 8, finger: 0.6, staghorn: 0.2, table: 0.2, boulder: 0.2 } },
  table: { label: 'Table reef', weights: { table: 6, boulder: 0.8, staghorn: 0.3, fan: 0.3, finger: 0.3 } },
  boulder: { label: 'Boulder field', weights: { boulder: 6, finger: 1.2, staghorn: 0.2, fan: 0.2, table: 0.2 } },
};
export const PRESET_IDS = Object.keys(PRESETS);

// ── bleaching ───────────────────────────────────────────────────────────────
// 0 below 29.5 C, 1 above 31.5 C. The page desaturates the colours by it
// and the growth rate is multiplied by 1 - b.
export function bleachLevel(tempC) {
  const t = Math.min(1, Math.max(0, (tempC - 29.5) / 2));
  return t * t * (3 - 2 * t);
}

// The radius of a particle from the size of its subtree: thick bases, thin tips.
export function polypRadius(sp, sub) {
  return sp.r0 * (1 + sp.thick * Math.log2(1 + sub));
}

// The species for a rock site { p, n, exposure, overhang }, from the
// exposure and the depth (y01: 0 deep .. 1 high in the plot). Open tops
// get staghorn and tables, walls get fans (across the current), and the
// sheltered spots get brain corals and soft fingers. Returns an id or null
// (a site under an overhang carries no colony).
export function pickSpecies(site, y01, u, weights = {}) {
  const ny = site.n[1], ex = site.exposure ?? 0.5, ov = Number(site.overhang ?? 0);
  if (ov > 0.6 || ny < -0.2) return null;
  const top = Math.max(0, (ny - 0.55) / 0.45), wall = Math.max(0, 1 - Math.abs(ny - 0.15) / 0.5), shel = 1 - ex;
  const w = {
    staghorn: top * (0.4 + ex) * (0.5 + y01),
    table: top * ex * ex * (0.4 + y01) * 0.9,
    fan: wall * (0.3 + ex) * 1.3,
    boulder: (0.25 + top * 0.5) * shel * (1.3 - y01) * 1.1,
    finger: (0.2 + wall * 0.4) * shel * 0.7,
  };
  let sum = 0;
  for (const id of SPECIES_IDS) { w[id] *= weights[id] ?? 1; sum += w[id]; }
  if (sum <= 1e-9) return null;
  let r = u * sum;
  for (const id of SPECIES_IDS) { r -= w[id]; if (r <= 0) return id; }
  return SPECIES_IDS[SPECIES_IDS.length - 1];
}

// ── cached rock distance ────────────────────────────────────────────────────
// fn sampled on a lattice of spacing h, filled on demand in bricks of 8^3
// cells (9^3 points), read with trilinear weights. A walker far from the
// rock reads the cache; near the rock (cached value < near) the walk reads
// fn itself. lip: the Lipschitz safety factor of the rock field.
export function cachedField(fn, h = 0.2, near = 0.35) {
  const bricks = new Map(), B = 8, P = B + 1;
  let evals = 0;
  function brick(bx, by, bz) {
    const key = ((bx + 2048) * 4096 + (by + 2048)) * 4096 + (bz + 2048);
    let b = bricks.get(key);
    if (!b) {
      b = new Float32Array(P * P * P);
      const x0 = bx * B * h, y0 = by * B * h, z0 = bz * B * h;
      for (let k = 0; k < P; k++) for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) b[(k * P + j) * P + i] = fn(x0 + i * h, y0 + j * h, z0 + k * h);
      evals += P * P * P;
      bricks.set(key, b);
    }
    return b;
  }
  function coarse(x, y, z) {
    const gx = x / h, gy = y / h, gz = z / h;
    const ix = Math.floor(gx), iy = Math.floor(gy), iz = Math.floor(gz);
    const bx = Math.floor(ix / B), by = Math.floor(iy / B), bz = Math.floor(iz / B);
    const b = brick(bx, by, bz);
    const lx = ix - bx * B, ly = iy - by * B, lz = iz - bz * B;
    const fx = gx - ix, fy = gy - iy, fz = gz - iz;
    const o = (lz * P + ly) * P + lx;
    const c00 = b[o] + (b[o + 1] - b[o]) * fx, c10 = b[o + P] + (b[o + P + 1] - b[o + P]) * fx;
    const c01 = b[o + P * P] + (b[o + P * P + 1] - b[o + P * P]) * fx, c11 = b[o + P * P + P] + (b[o + P * P + P + 1] - b[o + P * P + P]) * fx;
    const c0 = c00 + (c10 - c00) * fy, c1 = c01 + (c11 - c01) * fy;
    return c0 + (c1 - c0) * fz;
  }
  return {
    coarse,
    // a distance that is exact near the rock and a safe bound far from it
    dist(x, y, z) { const c = coarse(x, y, z); if (c > near) return c - h * 0.9; evals++; return fn(x, y, z); },
    get evals() { return evals; }, get bricks() { return bricks.size; },
  };
}

// h01: a hash of two ints to 0..1.
function h01(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// ── the reef ────────────────────────────────────────────────────────────────
export function createReef(opts = {}) {
  const rock = opts.rock;
  if (!rock || typeof rock.sdf !== 'function') throw new Error('coral-reef: createReef needs a rock with sdf()');
  const qid = QUALITY[opts.quality] ? opts.quality : 'desktop';
  const Q = Object.assign({}, QUALITY[qid], opts.budget || {});
  const fine = Q.fine, U = 0.01 * fine;
  const radius = opts.radius ?? 30;
  const capTotal = opts.capTotal ?? Q.particles;
  const env = Object.assign({ cur: [1, 0], strength: 0.5, temp: 27, nutrient: 1, speed: 1 }, opts.env || {});
  const params = {};   // per species: the live dlaf parameters in metres (advanced panel)
  for (const id of SPECIES_IDS) {
    const p = SPECIES[id].params;
    params[id] = { particleSpacing: p.particleSpacing * fine, attractionDistance: p.attractionDistance * fine, minMoveDistance: p.minMoveDistance * fine, stubbornness: p.stubbornness, stickiness: p.stickiness };
  }
  // the engine grid: cell = 2 x attraction >= the largest species attraction
  let maxAttrU = 0;
  for (const id of SPECIES_IDS) maxAttrU = Math.max(maxAttrU, params[id].attractionDistance / U);
  // rock.sdf may be a scaled bound (ROCK: raw x sdfScale, Lipschitz
  // rock.lipschitz). rockM: about metres, for the thresholds. rockSafe:
  // a lower bound of the true distance (sdf / lipschitz), for the steps.
  const rs = rock.sdfScale || 1, lip = rock.lipschitz || 1;
  const rockM = (x, y, z) => rock.sdf(x, y, z) / rs;
  const rockD = cachedField((x, y, z) => rock.sdf(x, y, z) / lip, Math.max(0.12, 0.16 * fine), 0.22);
  const yMin = rock.bounds ? rock.bounds.min[1] : -20;
  // the sand floor (rock.sand.heightAt): not in rock.sdf; a walker that
  // reaches it is lost, and no particle is put under it
  const sandAt = rock.sand && rock.sand.heightAt ? rock.sand.heightAt : () => -1e9;

  const R = {
    rock, env, params, quality: qid, Q, U, fine, radius, capTotal, limit: capTotal, seed: opts.seed ?? 1,
    colonies: [], contacts: new Map(), bridges: new Map(), count: 0, now: 0, joined: 0, walks: 0, walkers: 0, lost: 0,
    rate: opts.rate ?? 900, allowance: 0, single: false, preset: null,
    px: new Float32Array(capTotal), py: new Float32Array(capTotal), pz: new Float32Array(capTotal),
    col: new Uint16Array(capTotal), loc: new Int32Array(capTotal), parent: new Int32Array(capTotal),
    birth: new Float32Array(capTotal), gy: new Float32Array(capTotal), kids: new Uint8Array(capTotal),
    m: null, random: null,
    addColony, populate, loadPreset, growColony, setRate, step, growAll, reset, setCurrent, setParams, done, progress,
    dlafJoin, spU, stalkOf, walkOne, rockDist: rockD,
    get bleach() { return bleachLevel(env.temp); },
  };
  let random = rng(R.seed);
  R.random = () => random();

  // ── the shared model ──
  let rootColony = -1;
  function makeModel() {
    R.m = createModel({
      dim: 3, random: R.random, maxSteps: 4000,
      params: { particleSpacing: 1, attractionDistance: maxAttrU / 2, minMoveDistance: 1, stubbornness: 0, stickiness: 1 },
      onAdd(i, par, m) {
        const k = par >= 0 ? R.col[par] : rootColony, c = R.colonies[k];
        const x = m.pos[i * 3] * U, y = m.pos[i * 3 + 1] * U, z = m.pos[i * 3 + 2] * U;
        R.px[i] = x; R.py[i] = y; R.pz[i] = z;
        R.col[i] = k; R.loc[i] = c.count; R.parent[i] = par; R.birth[i] = R.now; R.gy[i] = c.base[1]; R.kids[i] = 0;
        if (par >= 0 && R.kids[par] < 255) R.kids[par]++;
        c.ids.push(i); c.count++; c.lastTry = c.tries;
        if (y > c.top) c.top = y;
        const e = Math.hypot(x - c.base[0], z - c.base[2]); if (e > c.ext) c.ext = e;
        R.count = m.count;
        indexContact(i);
      },
    });
  }
  makeModel();

  function spU(i) { return params[R.colonies[R.col[i]].id].particleSpacing / U; }
  function stalkOf(i) { const c = R.colonies[R.col[i]]; return c.stalk; }
  function dlafJoin(parent) {
    const p = params[R.colonies[R.col[parent]].id], ja = R.m.joinAttempts;
    ja[parent]++;
    if (ja[parent] < p.stubbornness) return false;
    return random() <= p.stickiness;
  }

  // ── contacts: a coarse grid of particle ids (cell 0.12 m) ──
  const CC = 0.25;
  let cgrid = new Map();
  const ckey = (x, y, z) => ((x + 2048) * 4096 + (y + 2048)) * 4096 + (z + 2048);
  function indexContact(i) {
    const k = ckey(Math.floor(R.px[i] / CC), Math.floor(R.py[i] / CC), Math.floor(R.pz[i] / CC));
    const a = cgrid.get(k); if (a) a.push(i); else cgrid.set(k, [i]);
    contact(i);
  }
  // A new particle i near a particle of another colony: the two touch.
  // Same species: they fuse (one surface in the shared species SDF).
  // Other species: the colony of i overgrows the other one.
  function contact(i) {
    const k = R.col[i], c = R.colonies[k];
    const lim = 1.6 * params[c.id].particleSpacing + 0.01, l2 = lim * lim;
    const cx = Math.floor(R.px[i] / CC), cy = Math.floor(R.py[i] / CC), cz = Math.floor(R.pz[i] / CC);
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const a = cgrid.get(ckey(cx + dx, cy + dy, cz + dz)); if (!a) continue;
      for (const j of a) {
        const kj = R.col[j]; if (kj === k) continue;
        const ex = R.px[j] - R.px[i], ey = R.py[j] - R.py[i], ez = R.pz[j] - R.pz[i];
        if (ex * ex + ey * ey + ez * ez > l2) continue;
        const a0 = Math.min(k, kj), b0 = Math.max(k, kj), key = a0 + ',' + b0;
        let t = R.contacts.get(key);
        if (!t) {
          t = { a: a0, b: b0, kind: R.colonies[kj].id === c.id ? 'fuse' : 'overgrow', by: k, n: 0, at: [R.px[i], R.py[i], R.pz[i]], t: R.now };
          R.contacts.set(key, t);
        }
        t.n++;
        // a fuse: a bridge cone from i to j in the SDF (coral-sdf.js
        // bridge), so the two surfaces join (the spacing is larger than
        // the branch radius, so the cones alone seldom touch)
        if (t.kind === 'fuse' && t.n <= 80) R.bridges.set(i, j);
        return;
      }
    }
  }

  function setCurrent(deg, strength) {
    const a = deg * Math.PI / 180;
    env.cur[0] = Math.cos(a); env.cur[1] = Math.sin(a);
    if (strength !== undefined) env.strength = strength;
  }
  function setRate(v) { R.rate = Math.max(0, v); }

  // The particle cap of a colony of a size: fill x (size / spacing)^dim.
  function capFor(id, size) {
    const sp = SPECIES[id];
    return Math.max(80, Math.round(sp.fill * Math.pow(size / params[id].particleSpacing, sp.dim)));
  }

  // A colony of species id on a rock site { p, n }. o.size (m), o.cap.
  // The seed sits one spacing out of the rock along the normal.
  function addColony(id, site, o = {}) {
    const sp = SPECIES[id]; if (!sp) return null;
    if (R.count >= R.limit) return null;
    const n = site.n || [0, 1, 0], s = params[id].particleSpacing;
    const base = [site.p[0] + n[0] * s * 0.6, site.p[1] + n[1] * s * 0.6, site.p[2] + n[2] * s * 0.6];
    for (let q = 0; q < 8 && rockM(base[0], base[1], base[2]) < s * 0.4; q++) { base[0] += n[0] * s * 0.3; base[1] += n[1] * s * 0.3; base[2] += n[2] * s * 0.3; }
    if (rock.sdf(base[0], base[1], base[2]) <= 0) return null;
    const size = o.size ?? (sp.size[0] + (sp.size[1] - sp.size[0]) * random());
    const k = R.colonies.length;
    const cl = Math.hypot(env.cur[0], env.cur[1]) || 1;
    const colony = {
      k, id, sp, base, normal: n.slice(), plane: [env.cur[0] / cl, env.cur[1] / cl], size,
      cap: Math.max(20, Math.min(o.cap ?? capFor(id, size), R.limit - R.count)),
      count: 0, ids: [], top: base[1], ext: 0, roots: 1, born: R.now, full: false, tries: 0, lastTry: 0, winT: 0, winN: 0,
      stalk: Math.max(3, Math.round((sp.stalkM || 0) * (0.6 + 0.5 * size / (3 * sp.scale)) / params[id].particleSpacing)),
      user: { bx: base[0], by: base[1], bz: base[2], normal: [env.cur[0] / cl, env.cur[1] / cl] },
    };
    R.colonies.push(colony);
    rootColony = k;
    R.m.add([base[0] / U, base[1] / U, base[2] / U], -1);
    return colony;
  }

  // ── colony seeds ──
  // Sites from rock.sampleSurface inside 0.92 R. Reefs grow in patches:
  // first patch centres, spread evenly over the whole plot (farthest-point
  // sampling of the sites), then the seeds of each
  // patch within PATCH m of its centre, with a gap of 0.35 x the mean size
  // of two neighbours (+ 0.25 m). So neighbours meet, compete and fuse, but
  // no two seeds clump. Species by pickSpecies, sizes by exposure. Then
  // the caps are scaled to fit the particle and triangle budgets.
  const PATCH = 7;
  function populate(o = {}) {
    reset(o.seed);
    const P = PRESETS[o.preset] || PRESETS.mixed;
    const want = o.colonies ?? Q.colonies;
    const R0 = radius * 0.92;
    const filter = s => Math.hypot(s.p[0], s.p[2]) < R0 && s.n[1] > -0.2 && Number(s.overhang ?? 0) < 0.6;
    let sites = o.sites || rock.sampleSurface(want * 24, R.random, filter) || [];
    sites = sites.filter(filter);
    let y0 = Infinity, y1 = -Infinity;
    for (const s of sites) { y0 = Math.min(y0, s.p[1]); y1 = Math.max(y1, s.p[1]); }
    // patch centres by farthest-point sampling over the sites (the first
    // one at random), so the patches cover the plot evenly
    const nPatch = Math.min(sites.length, o.patches ?? Math.max(4, Math.round(want / 5)));
    const centres = [];
    if (sites.length) {
      const dmin = new Float64Array(sites.length).fill(Infinity);
      let next = Math.floor(random() * sites.length);
      while (centres.length < nPatch) {
        const c = sites[next].p;
        centres.push([c[0], c[2]]);
        let best = -1, bd = -1;
        for (let t = 0; t < sites.length; t++) {
          const d = Math.hypot(sites[t].p[0] - c[0], sites[t].p[2] - c[2]);
          if (d < dmin[t]) dmin[t] = d;
          if (dmin[t] > bd) { bd = dmin[t]; best = t; }
        }
        if (bd <= 0) break;
        next = best;
      }
    }
    const chosen = [];
    const gapK = o.gap ?? 0.35;
    function tryAdd(s, g) {
      const y01 = (s.p[1] - y0) / Math.max(1e-6, y1 - y0);
      const id = o.species || pickSpecies(s, y01, random(), P.weights);
      if (!id) return false;
      const sp = SPECIES[id], ex = s.exposure ?? 0.5;
      const size = sp.size[0] + (sp.size[1] - sp.size[0]) * Math.min(1, Math.max(0, 0.2 + 0.7 * ex + 0.35 * (random() - 0.5)));
      for (const q of chosen) {
        const d = Math.hypot(q.s.p[0] - s.p[0], q.s.p[1] - s.p[1], q.s.p[2] - s.p[2]);
        if (d < g * (q.size + size) * 0.5 + 0.25) return false;
      }
      chosen.push({ s, id, size });
      return true;
    }
    // patch seeds, round robin over the centres, then any site
    for (let pass = 0; pass < 3 && chosen.length < want; pass++) {
      const g = gapK * (1 - pass * 0.2);
      const used = new Set();
      for (let round = 0; round < 40 && chosen.length < want; round++) {
        let added = 0;
        for (const c of centres) {
          if (chosen.length >= want) break;
          for (let t = 0; t < sites.length; t++) {
            if (used.has(t)) continue;
            const s = sites[t];
            if (Math.hypot(s.p[0] - c[0], s.p[2] - c[1]) > PATCH) continue;
            used.add(t);
            if (tryAdd(s, g)) { added++; break; }
          }
        }
        if (!added) break;
      }
    }
    for (let t = 0; t < sites.length && chosen.length < want; t++) tryAdd(sites[t], gapK * 0.6);
    // caps in the particle budget (each colony keeps at least 25% of its wish)
    let sum = 0;
    for (const q of chosen) { q.cap = capFor(q.id, q.size); sum += q.cap; }
    const k = Math.min(1, (R.limit - chosen.length) / Math.max(1, sum));
    for (const q of chosen) addColony(q.id, q.s, { size: q.size, cap: Math.max(Math.round(q.cap * 0.25), Math.floor(q.cap * k)) });
    R.preset = o.preset || 'mixed';
    R.patches = centres;
    return R;
  }
  function loadPreset(pid, o = {}) { return populate(Object.assign({}, o, { preset: pid })); }

  // ── single colony mode (the saver) ──
  // A reset, then ONE colony at site (from rock.sampleSurface, or { p, n }).
  // It grows at R.rate polyps per second in step(): setRate() changes it.
  function growColony(site, id, o = {}) {
    reset(o.seed);
    R.single = true;
    if (o.rate !== undefined) R.rate = o.rate;
    const sp = SPECIES[id] || SPECIES.staghorn;
    const size = o.size ?? sp.size[1];
    return addColony(SPECIES[id] ? id : 'staghorn', site, { size, cap: o.cap ?? Math.min(R.limit, capFor(id, size)) });
  }

  // ── the walk ──
  const P = [0, 0, 0], V = [0, 0, 0], QP = [0, 0, 0];
  let live = [], liveW = [], liveSum = 0, liveAt = -1;
  function refreshLive() {
    live = []; liveW = []; liveSum = 0;
    for (const c of R.colonies) {
      if (c.full) continue;
      if (c.count >= c.cap) { c.full = true; continue; }
      const r = discOf(c);
      // the snow disc: centre upstream of the base, radius r, height y
      const a0 = params[c.id].attractionDistance, y = c.top + 4 * a0 + LIFT * (c.top - c.base[1]) + LIFT0;
      const kx = env.strength * 0.8 / FALL, fall = y - c.base[1] + 0.3;
      c.disc = [c.base[0] - env.cur[0] * kx * fall * 0.6, c.base[2] - env.cur[1] * kx * fall * 0.6, r, y, kx * fall];
      live.push(c); liveSum += r * r; liveW.push(liveSum);
    }
    liveAt = R.count;
  }

  // Marine snow starts on a disc above a live colony (chosen by the area
  // of its disc). The disc moves upstream by the distance that the current
  // carries a walker while it falls, so the snow passes over the colony.
  // Where the discs of k colonies overlap, a start is kept with chance
  // 1 / k, so the snow is uniform over the union of the discs: two
  // neighbours share the snow over the gap between them, they do not get
  // twice as much. The walker is free: it can land on any colony.
  let spawnTop = 0, spawnX = 0, spawnZ = 0, spawnR = 0, spawnC = null, wFall = 0.85, wPlane = null;
  const FALL = 0.85, LIFT = 0.08, LIFT0 = 0;
  // the snow disc of a colony: its extent plus a few attraction distances,
  // so that a young colony (one seed) still catches some snow
  // plus the lift (the height the snow falls before it reaches the colony
  // top: about how far it moves sideways), so a colony alone gets the snow
  // from its sides too, as in open water
  function discOf(c) { const a0 = params[c.id].attractionDistance; return c.ext + 3 * a0 + 1.2 * (4 * a0 + LIFT * (c.top - c.base[1])) * Math.min(1, 0.3 + c.count / 300); }
  function pick() {
    const u = random() * liveSum;
    let lo = 0, hi = live.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (liveW[mid] < u) lo = mid + 1; else hi = mid; }
    return live[lo];
  }
  function spawn(out) {
    for (let tries = 0; ; tries++) {
      const c = pick();
      const a0 = params[c.id].attractionDistance;
      wFall = FALL; wPlane = null;
      if (c.id === 'fan') {
        // a sea fan feeds from the water that the current carries through
        // its plane: the walkers start on a half circle in the fan plane
        // and drift in it with a small fall (as the fans of the old page)
        spawnC = c; c.tries++;
        const f = c.plane, Rf = Math.max(c.top - c.base[1], c.ext) + 3 * a0 + 0.04 * c.size * Math.min(1, c.count / 300);
        const t = (random() - 0.5) * 0.9 * Math.PI, j = (random() - 0.5) * 2 * a0;
        const x = c.base[0] - f[1] * Math.sin(t) * Rf + f[0] * j, z = c.base[2] + f[0] * Math.sin(t) * Rf + f[1] * j;
        spawnX = c.base[0]; spawnZ = c.base[2]; spawnTop = c.base[1] + Rf + 0.3; spawnR = Rf + 0.6;
        wFall = 0.25; wPlane = f;
        out[0] = x / U; out[1] = (c.base[1] + Math.cos(t) * Rf) / U; out[2] = z / U;
        return out;
      }
      const D = c.disc, a = random() * TAU, rr = D[2] * Math.sqrt(random());
      const x = D[0] + Math.cos(a) * rr, z = D[1] + Math.sin(a) * rr;
      let k = 0, y = D[3];
      for (const d of live) {
        if (d.id === 'fan') continue;
        const e = d.disc, ex = x - e[0], ez = z - e[1];
        if (ex * ex + ez * ez < e[2] * e[2]) { k++; if (e[3] > y) y = e[3]; }
      }
      if (tries < 8 && random() * k > 1) continue;
      spawnC = c; c.tries++;
      spawnX = x; spawnZ = z; spawnTop = y;
      spawnR = D[2] + 0.3 + 0.2 * c.size + env.strength * D[4];
      out[0] = x / U; out[1] = y / U; out[2] = z / U;
      return out;
    }
  }

  // Can a particle of colony c be at (x, y, z) (metres)? Out of the rock,
  // in the plot, and in the size ellipsoid of the colony: a horizontal
  // radius of size / 2, from 0.2 x size x sp.tall under the base to
  // size x sp.tall over it (a round outline, not a cut).
  // Near the outline the joins thin out (a soft, ragged edge, not a rim).
  function fits(c, x, y, z) {
    const H = c.size * c.sp.tall, h = 0.5 * c.size;
    const dx = x - c.base[0], dy = y - c.base[1] - 0.4 * H, dz = z - c.base[2];
    const e = (dx * dx + dz * dz) / (h * h) + (dy * dy) / (0.36 * H * H);
    if (e > 1) return false;
    if (e > 0.6 && random() > Math.pow((1 - e) / 0.4, 1.5)) return false;
    if (x * x + z * z > radius * radius) return false;
    const s = params[c.id].particleSpacing;
    return rockM(x, y, z) > s * 0.25 && y > sandAt(x, z) + s * 0.25;
  }

  // Push a model-unit point out of the rock along the rock normal.
  function outOfRock(out, minD) {
    for (let q = 0; q < 4; q++) {
      const x = out[0] * U, y = out[1] * U, z = out[2] * U, d = rockM(x, y, z);
      if (d >= minD) return true;
      const n = rock.normal(x, y, z), s = (minD - d) * 1.05 / U;
      out[0] += n[0] * s; out[1] += n[1] * s; out[2] += n[2] * s;
    }
    return rock.sdf(out[0] * U, out[1] * U, out[2] * U) > 0;
  }

  // A walker that hits the rock next to the coral of a colony that
  // encrusts (the nearest particle is of that colony, within 0.55 m) can
  // stick there: a new root of that colony. So the base creeps over the
  // rock from the coral that is there, never into a neighbour's ground.
  function encrust(x, y, z) {
    const n0 = R.m.nearest(P);
    if (n0.id < 0 || n0.d * U > 0.55) return false;
    const c = R.colonies[R.col[n0.id]];
    if (c.full || c.count >= c.cap) return false;
    const s = c.sp; if (!s.encrust || c.roots >= s.roots) return false;
    const reach = c.size * s.reach;
    const dx = x - c.base[0], dz = z - c.base[2];
    if (dx * dx + dz * dz > reach * reach || Math.abs(y - c.base[1]) > reach) return false;
    if (random() > s.encrust) return false;
    const n = rock.normal(x, y, z), sp = params[c.id].particleSpacing;
    QP[0] = (x + n[0] * sp * 0.6) / U; QP[1] = (y + n[1] * sp * 0.6) / U; QP[2] = (z + n[2] * sp * 0.6) / U;
    if (!outOfRock(QP, sp * 0.3) || !fits(c, QP[0] * U, QP[1] * U, QP[2] * U)) return false;
    c.roots++;
    rootColony = c.k;
    R.m.add(QP, -1);
    return true;
  }

  // One walker from its start to a join, a loss (rock, plot, lid) or the
  // step limit. Returns the new particle id, or -1.
  function walkOne() {
    if (liveAt !== R.count || !live.length) refreshLive();
    if (!live.length) return -1;
    const m = R.m;
    if ((++R.walkers & 1023) === 0) { starve(); if (liveAt < 0) { refreshLive(); if (!live.length) return -1; } }
    spawn(P);
    const minMoveU = 0.6 * Math.min(params[spawnC.id].minMoveDistance, 0.03 * spawnC.sp.scale) / U;
    const AgU = maxAttrU;
    const drift = env.strength * 0.8;
    for (let steps = 0; steps < 3000; steps++) {
      const n = m.nearest(P);
      const par = n.id;
      let d = n.d, A = AgU;
      if (par >= 0) {
        const c = R.colonies[R.col[par]], pr = params[c.id];
        A = pr.attractionDistance / U;
        if (d < A) {
          if (c.full || c.count >= c.cap) { R.lost++; return -1; }      // a full colony is a sink
          const sp = c.sp, h = sp.hooks;
          if (!(h.shouldJoin ? h.shouldJoin(R, P, par) : dlafJoin(par))) {
            m.lerpFrom(par, P, A + pr.minMoveDistance / U, P);
            continue;
          }
          if (h.placeParticle) h.placeParticle(R, P, par, QP); else m.lerpFrom(par, P, pr.particleSpacing / U, QP);
          if (!outOfRock(QP, pr.particleSpacing * 0.3) || !fits(c, QP[0] * U, QP[1] * U, QP[2] * U)) { R.lost++; return -1; }
          return m.add(QP, par);
        }
      }
      const x = P[0] * U, y = P[1] * U, z = P[2] * U;
      const dr = rockD.dist(x, y, z);
      if (dr < 0.003 * R.fine + 0.001) {
        if (encrust(x, y, z)) return R.count - 1;
        R.lost++; return -1;
      }
      const step = Math.max(minMoveU, Math.min(d - A, dr * 0.9 / U));
      randomInUnitSphere(random, 3, V);
      if (wPlane) { const q = V[0] * wPlane[0] + V[2] * wPlane[1]; V[0] -= wPlane[0] * q; V[2] -= wPlane[1] * q; V[1] -= wFall; }
      else { V[0] += env.cur[0] * drift; V[1] -= wFall; V[2] += env.cur[1] * drift; }
      const l = Math.hypot(V[0], V[1], V[2]) || 1;
      P[0] += V[0] / l * step; P[1] += V[1] / l * step; P[2] += V[2] / l * step;
      R.walks++;
      const nx = P[0] * U, ny = P[1] * U, nz = P[2] * U;
      const ex = nx - spawnX, ez = nz - spawnZ;
      if (ny > spawnTop + 0.5 || ny < yMin - 1 || ex * ex + ez * ez > spawnR * spawnR || ny < sandAt(nx, nz)) { R.lost++; return -1; }
    }
    R.lost++;
    return -1;
  }

  function done() { return R.count >= R.limit || R.colonies.every(c => c.full || c.count >= c.cap); }

  // Grow for at most budgetMs, at the rate R.rate (polyps per second) x
  // speed x nutrient x (1 - bleach). dtMs is the frame time. Returns the
  // number of particles that joined.
  function step(dtMs, budgetMs = 8, now = 0, base) {
    R.now = now;
    if (base !== undefined) R.rate = base;
    const rate = R.rate * env.speed * env.nutrient * (1 - R.bleach);
    if (R.bleach > 0.98 || done()) { R.allowance = 0; return 0; }
    R.allowance = Math.min(R.allowance + rate * dtMs / 1000, rate * 0.25 + 2);
    const clock = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
    const t0 = clock(); let n = 0, tries = 0;
    while (R.allowance >= 1 && R.count < R.limit) {
      const g = walkOne(); tries++;
      if (g >= 0) { R.allowance--; n++; }
      if ((tries & 7) === 0 && clock() - t0 > budgetMs) break;
      if (!live.length) break;
    }
    R.joined += n;
    return n;
  }

  // Grow until every colony is at its cap, or n particles joined. Tests,
  // thumbnails. maxWalkers bounds the work when the colonies starve.
  function growAll(n = Infinity, maxWalkers = Infinity) {
    let k = 0, w = 0;
    while (k < n && R.count < R.limit && w < maxWalkers) {
      if (liveAt !== R.count || !live.length) refreshLive();
      if (!live.length) break;
      const g = walkOne(); w++;
      if (g >= 0) k++;
    }
    R.joined += k;
    return k;
  }
  // A colony that gets no join in STARVE walkers of its own disc stops: it
  // is shaded out, or overgrown by its neighbours. A colony past half its
  // cap whose join rate over the last WIN walkers is under SLOW stops too:
  // it has filled its outline, and more snow on it is mostly lost.
  const STARVE = 6000, WIN = 1500, SLOW = 0.06;
  function starve() {
    for (const c of R.colonies) {
      if (c.full) continue;
      if (c.tries - c.lastTry > STARVE) { c.full = true; c.starved = true; liveAt = -1; continue; }
      if (c.tries - c.winT >= WIN) {
        const rate = (c.count - c.winN) / (c.tries - c.winT);
        if (rate < SLOW && c.count >= 0.5 * c.cap) { c.full = true; c.filled = true; liveAt = -1; continue; }
        c.winT = c.tries; c.winN = c.count;
      }
    }
  }

  // Progress for SCENE: particles, target, colonies live, fraction, contacts.
  function progress() {
    let target = 0, liveN = 0;
    for (const c of R.colonies) { target += c.cap; if (!c.full && c.count < c.cap) liveN++; }
    let fuse = 0, over = 0;
    for (const t of R.contacts.values()) { if (t.kind === 'fuse') fuse++; else over++; }
    return {
      count: R.count, target, limit: R.limit, colonies: R.colonies.length, live: liveN,
      fraction: target ? Math.min(1, R.count / target) : 1, done: done(),
      walkers: R.walkers, walks: R.walks, lost: R.lost, fusions: fuse, overgrowths: over,
    };
  }

  function setParams(id, p) {
    Object.assign(params[id], p);
    let a = 0;
    for (const q of SPECIES_IDS) a = Math.max(a, params[q].attractionDistance / U);
    if (a > maxAttrU) params[id].attractionDistance = maxAttrU * U;   // the grid sets the upper limit
  }

  function reset(seed) {
    if (seed !== undefined) R.seed = seed;
    random = rng(R.seed);
    R.colonies = []; R.contacts = new Map(); R.bridges = new Map(); R.count = 0; R.joined = 0; R.walks = 0; R.walkers = 0; R.lost = 0;
    R.allowance = 0; R.single = false; R.preset = null;
    cgrid = new Map(); live = []; liveAt = -1;
    makeModel();
  }

  return R;
}

// ── fine mesh focus ─────────────────────────────────────────────────────────
// The colonies that get the fine mesh (coral-sdf.js setFocus): nearest to
// the view points first, while the estimated fine triangles (count x tpp,
// with the full cap for a colony that still grows) stay in the budget.
// colonies: R.colonies or the colonyInfo list with counts.
export function chooseFocus(colonies, points, budgetTris, maxN = Infinity) {
  if (!points || !points.length) return [];
  const list = colonies.map(c => {
    let d = Infinity;
    for (const p of points) d = Math.min(d, Math.hypot(c.base[0] - p[0], c.base[1] - p[1], c.base[2] - p[2]) - c.size * 0.5);
    return { c, d };
  }).sort((a, b) => a.d - b.d);
  const out = []; let t = 0;
  for (const { c } of list) {
    const est = Math.max(c.count || 0, (c.cap || 0) * 0.6) * SPECIES[c.id].tpp;
    if (out.length && t + est > budgetTris) break;
    if (out.length >= maxN) break;
    out.push(c.k); t += est;
  }
  return out;
}

// The focus with hysteresis (the reef worker uses it, so a grown reef does
// not change its fine meshes while the camera moves a little). held: Map
// k -> { at (ms), dIn (m) }, the colonies in the focus, changed in place.
// A held colony stays while its distance is under max(keepK x dIn, dIn +
// keepAdd), or for holdMs after it came in, and while the held set fits
// over x the budget (the nearest first). Then the nearest new colonies
// come in while the budget allows. Returns the focus list (k).
export const FOCUS_HOLD = { keepK: 1.5, keepAdd: 3, holdMs: 8000, over: 1.25 };
export function holdFocus(colonies, points, budgetTris, held, nowMs, o = FOCUS_HOLD) {
  if (!points || !points.length) return [...held.keys()];
  const dist = c => { let d = Infinity; for (const p of points) d = Math.min(d, Math.hypot(c.base[0] - p[0], c.base[1] - p[1], c.base[2] - p[2]) - c.size * 0.5); return d; };
  const est = c => Math.max(c.count || 0, (c.cap || 0) * 0.6) * SPECIES[c.id].tpp;
  const byK = new Map();
  for (const c of colonies) if (c) byK.set(c.k, c);
  const keep = [];
  for (const [k, h] of held) {
    const c = byK.get(k); if (!c) continue;
    const d = dist(c);
    if (d <= Math.max(o.keepK * h.dIn, h.dIn + o.keepAdd) || nowMs - h.at < o.holdMs) keep.push({ c, d, h });
  }
  keep.sort((a, b) => a.d - b.d);
  const out = new Map();
  let t = 0;
  for (const e of keep) {
    const s = est(e.c);
    if (out.size && t + s > budgetTris * o.over) break;
    out.set(e.c.k, e.h); t += s;
  }
  const cand = [];
  for (const c of byK.values()) if (!out.has(c.k)) cand.push({ c, d: dist(c) });
  cand.sort((a, b) => a.d - b.d);
  for (const e of cand) {
    const s = est(e.c);
    if (out.size && t + s > budgetTris) break;
    out.set(e.c.k, { at: nowMs, dIn: Math.max(0, e.d) }); t += s;
  }
  held.clear();
  for (const [k, h] of out) held.set(k, h);
  return [...out.keys()];
}

// ── main-thread mirror ──────────────────────────────────────────────────────
// The worker owns the reef. The page keeps this mirror of the particle
// arrays, fed by the worker messages, so colour.js and the data textures
// read the same fields as on a reef: count, px py pz, col, loc, parent,
// birth, gy, colonies[k].sp.
export function createReefMirror(cap = 1024) {
  const M = { count: 0, colonies: [], contacts: [], progress: null, env: { temp: 27 } };
  const names = ['px', 'py', 'pz', 'birth', 'gy'];
  function alloc(n) {
    for (const k of names) { const a = new Float32Array(n); if (M[k]) a.set(M[k].subarray(0, M.count)); M[k] = a; }
    for (const [k, T] of [['col', Uint16Array], ['loc', Int32Array], ['parent', Int32Array]]) { const a = new T(n); if (M[k]) a.set(M[k].subarray(0, M.count)); M[k] = a; }
    M.cap = n;
  }
  alloc(cap);
  M.reset = () => { M.count = 0; M.colonies = []; M.contacts = []; };
  M.setColonies = (list) => {
    for (const c of list) M.colonies[c.k] = Object.assign({}, c, { sp: SPECIES[c.id], user: { bx: c.base[0], by: c.base[1], bz: c.base[2], normal: c.plane } });
  };
  // data: Float32Array, PARTICLE_FLOATS per particle (see packParticles)
  M.addParticles = (from, data) => {
    const n = data.length / PARTICLE_FLOATS;
    if (from !== M.count) return false;
    if (from + n > M.cap) { let c = M.cap; while (c < from + n) c *= 2; alloc(c); }
    for (let q = 0; q < n; q++) {
      const o = q * PARTICLE_FLOATS, g = from + q;
      M.px[g] = data[o]; M.py[g] = data[o + 1]; M.pz[g] = data[o + 2];
      M.col[g] = data[o + 3]; M.parent[g] = data[o + 4]; M.birth[g] = data[o + 5]; M.gy[g] = data[o + 6]; M.loc[g] = data[o + 7];
    }
    M.count = from + n;
    return true;
  };
  return M;
}

// 8 floats per particle in the worker messages:
// x, y, z, colony, parent (global id or -1), birth (ms), gy, loc.
export const PARTICLE_FLOATS = 8;
export function packParticles(R, from, to) {
  const out = new Float32Array((to - from) * PARTICLE_FLOATS);
  for (let g = from, o = 0; g < to; g++, o += PARTICLE_FLOATS) {
    out[o] = R.px[g]; out[o + 1] = R.py[g]; out[o + 2] = R.pz[g]; out[o + 3] = R.col[g];
    out[o + 4] = R.parent[g]; out[o + 5] = R.birth[g]; out[o + 6] = R.gy[g]; out[o + 7] = R.loc[g];
  }
  return out;
}
// The colony list in the worker messages (plain data).
export function colonyInfo(c) {
  return { k: c.k, id: c.id, base: c.base.slice(), normal: c.normal.slice(), plane: c.plane.slice(), size: c.size, cap: c.cap, stalk: c.stalk };
}

// Size measures of one colony (metres, from its base): width (the largest
// horizontal span), height (over the base), thickness (the span along a
// horizontal direction dir, for the fan plane), size (the larger of width
// and height), the mean offset, and the fill (particles per m^3 of the
// bounding hemisphere).
export function shapeOf(R, colony, dir) {
  const n = colony.ids.length, b = colony.base;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity, sx = 0, sy = 0, sz = 0, rmax = 0, t0 = Infinity, t1 = -Infinity;
  for (const g of colony.ids) {
    const x = R.px[g] - b[0], y = R.py[g] - b[1], z = R.pz[g] - b[2];
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y); sx += x; sy += y; sz += z;
    rmax = Math.max(rmax, Math.hypot(x, y, z));
    if (dir) { const t = x * dir[0] + z * dir[1]; t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
  }
  const width = Math.max(x1 - x0, z1 - z0), height = y1 - Math.min(0, y0);
  const vol = (2 / 3) * Math.PI * rmax * rmax * rmax;
  return { n, width, height, size: Math.max(width, height, Math.hypot(x1 - x0, z1 - z0) * 0.85), thickness: dir ? t1 - t0 : 0, mean: [sx / n, sy / n, sz / n], fill: n / Math.max(1e-6, vol), rmax };
}

// The hook that makes a species, for the explainer and the saver code
// extract. Returns { name, fn }. fn.toString() is the real source text.
export function speciesHook(id, which) {
  const h = (SPECIES[id] || SPECIES.staghorn).hooks;
  const names = Object.keys(h);
  const name = which && h[which] ? which : names.includes('shouldJoin') ? 'shouldJoin' : names.includes('placeParticle') ? 'placeParticle' : names[0];
  return { name, fn: h[name] };
}
