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
//  the rock or the sand are lost. No particle centre is ever inside the
//  rock or under the sand (the tests check it).
//
//  ONE ROOT. The user said (2026-10-18): "real coral start with one root
//  and branch futher and further out, not multiple roots like a piece of
//  grass". Each colony has one root particle (its seed, parent -1). Every
//  other particle of the colony joins a particle of that colony, so its
//  parent chain ends at that root (tests/form.test.mjs). No walker starts
//  a new root on the rock. Two colonies can still meet and fuse
//  (R.bridges), but each keeps its own root.
//
//  SIZE. The user said (2026-10-18): "we should be able to simulate much
//  large growing coral reef structures these are pathetically small for
//  the size of seamount we're workign iwht". Each species has a scale s
//  (coral-sdf.js SPECIES_SCALE, 1.75 to 2): its spacing and its SDF
//  lengths are s times larger, so colonies of 2 to 8 m have the particle
//  count of the old 1 to 4 m ones. More colonies (34 to 96 by quality) in
//  larger patches (7 m) meet and fuse into a reef framework.
//
//  APEX. The branching species (staghorn, fan, table, finger) grow at
//  their tips: a walker near the coral feeds the nearest live tip, and
//  the new particle continues that branch; sometimes a particle under a
//  tip forks at the species angle (grep -n 'apical growth'). So branches
//  extend and fork further and further out; they do not get random side
//  stubs. A sea fan feeds through its plane (the current carries the food
//  across it) and joins its own near branches (bridges), so it grows a
//  flat net. The brain coral grows as one dome from its seed.
//
//  STOP. A colony stops at its cap, at its soft size outline, when it
//  gets no join in 6000 walkers (shaded out), or when its join rate past
//  60 % of its cap falls under 0.3 x its best rate (its outline is full).
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
//  SPECIES (grep -n 'export const SPECIES'): 39 species in six groups
//  (SPECIES_GROUPS: branching, plating, massive, soft, fans, deep). The
//  user asked to "create a lot more coral species" and for "generative
//  species like massive filter feeding fan corals" in the deep. Each has
//  names, form, depth [min, max] m, habitat, fact, colours and morphs,
//  site weights, and one growth form (the hooks at the top of the file):
//    branch ... apex tip growth (staghorn, elkhorn, Pocillopora,
//               Stylophora, Seriatopora, pillar, soft trees, gorgonians,
//               black and bamboo corals, Desmophyllum, Madrepora, sea pen,
//               sea lily). apex.whorl: a crown of branches at the stalk
//               top (whorlFirst: before the walk goes on); apex.len: a
//               length limit per branch order; apex.maxOrder; apex.forkH;
//               apex.planar (true, or 0..1); apex.flatK; apex.net
//    fan ...... branch + every particle in the colony plane (Gorgonia,
//               Annella); feed 'plane': the snow crosses the plane
//    plate .... a stalk, then plates that rise by c.tilt (table, Montipora,
//               Turbinaria, Pachyseris, Echinopora, Merulina, leather)
//    mound .... a dome of the particle count, mound.flat, mound.lobes,
//               mound.oval (brain, Porites, Favites, Lobophyllia,
//               encrusting Montipora, mushroom coral)
//    shell .... a sponge wall round the axis (Euplectella, glass vase,
//               cloud sponge, barrel sponge)
//  Per colony (vary, from the seed): c.ap (the apex rule with the angles
//  and rates changed by up to sp.vary), c.tilt, c.lobes, c.bend, c.morph
//  (the colour variant; colonyInfo carries tilt and morph).
//  R.ord, R.run: the branch order and the hops since the branch began.
//
//  grep -n targets
//    quality budgets ........... "export const QUALITY"
//    species table ............. "export const SPECIES"
//    species by site ........... "export function pickSpecies"
//    cached rock distance ...... "export function cachedField"
//    the reef object ........... "export function createReef"
//    one walker ................ "function walkOne"
//    spawn above the colonies .. "function spawn"
//    apical growth ............. "function apexPick", "function apexPlace"
//    contacts (fuse, overgrow) . "function contact"
//    colony seeds .............. "function populate"
//    single colony mode ........ "function growColony"
//    time-budget growth ........ "function step"
//    main-thread mirror ........ "export function createReefMirror"
//    shape measures (tests) .... "export function shapeOf"
//    hook source (saver code) .. "export function speciesHook"
//    focus with hysteresis ..... "export function holdFocus"
//    growth form hooks ......... "const BRANCH_HOOKS", "PLATE_HOOKS", "MOUND_HOOKS", "SHELL_HOOKS"
//    per-colony rule ........... "function vary"
//    colony colours ............ "export function colourMorph"
//    shape descriptor .......... "export function silhouetteOf"
// ============================================================================
import { createModel, rng, randomInUnitSphere } from '../../lib/dla-engine.js';
import { SPECIES_SCALE, SDF_EXP, noise3 } from './coral-sdf.js';

const TAU = Math.PI * 2;

// ── growth forms (the hooks that several species share) ─────────────────────
// branch: the apex tip growth (apexPick, apexPlace) and the dlaf join.
// fan: each new particle goes into the vertical plane of the colony.
// plate: a short stalk, then plates; c.tilt > 0 lifts the plate edge (a
//   whorl, a funnel or a vase). mound: a dome of the particle count,
//   flattened by mound.flat, with lobes. shell: the wall of a tube, a vase
//   or a barrel (a profile of the height), with a floor at the base.
const BRANCH_HOOKS = {
  // The tips grow (apex, in createReef): the walker feeds the nearest
  // live tip, and the new particle continues that branch.
  shouldJoin(R, p, parent) { return R.dlafJoin(parent); },
};
const FAN_HOOKS = {
  // The new particle goes into the vertical plane of the fan, across the
  // current, so the fan grows flat and wide; a join from below is rare.
  placeParticle(R, p, parent, out) {
    const c = R.colonies[R.col[parent]], f = c.plane, U = R.U;
    const d = (out[0] - c.base[0] / U) * f[0] + (out[2] - c.base[2] / U) * f[1];
    out[0] -= f[0] * d; out[2] -= f[1] * d;
    if (out[1] < R.m.pos[parent * 3 + 1] - 0.5 * R.spU(parent)) out[1] = R.m.pos[parent * 3 + 1] - 0.5 * R.spU(parent);
    return out;
  },
};
// the horizontal distance of a model point from the colony axis
const radU = (R, c, x, z) => Math.hypot(x - c.base[0] / R.U, z - c.base[2] / R.U);
const PLATE_HOOKS = {
  // A short stalk grows up. Past it, only joins along the plate stick
  // (the plate rises by c.tilt per unit of radius).
  shouldJoin(R, p, parent) {
    if (!R.dlafJoin(parent)) return false;
    const P = R.m.pos, i = parent * 3, dy = p[1] - P[i + 1];
    const dh = Math.hypot(p[0] - P[i], p[2] - P[i + 2]);
    if (R.m.depth[parent] < R.stalkOf(parent)) return R.kids[parent] === 0 && dy > 0;
    const c = R.colonies[R.col[parent]], t = c.tilt || 0;
    const dr = t ? radU(R, c, p[0], p[2]) - radU(R, c, P[i], P[i + 2]) : 0;
    return dh > 2.5 * Math.abs(dy - t * dr) || R.random() < 0.03;
  },
  placeParticle(R, p, parent, out) {
    if (R.m.depth[parent] >= R.stalkOf(parent)) {
      const P = R.m.pos, i = parent * 3, y0 = P[i + 1], c = R.colonies[R.col[parent]], t = c.tilt || 0;
      out[1] = y0 + (out[1] - y0) * 0.12 + (t ? t * (radU(R, c, out[0], out[2]) - radU(R, c, P[i], P[i + 2])) : 0);
    }
    return out;
  },
};
const MOUND_HOOKS = {
  // Accretive growth: the tissue lays each new particle on the surface
  // of a compact dome of this many particles, so the colony stays a dome
  // (mound.flat < 1: a low mound or a crust; mound.lobes: lumps).
  placeParticle(R, p, parent, out) {
    const c = R.colonies[R.col[parent]], U = R.U, s = R.spU(parent), md = c.sp.mound || {};
    const f = md.flat ?? 1, ov = md.oval ?? 1;
    const dome = s / 0.9 * (Math.cbrt(3 * c.count / (TAU * c.sp.density * f * ov)) + 0.3);
    const bx = c.base[0] / U, by = c.base[1] / U, bz = c.base[2] / U;
    const dx = out[0] - bx, dy = out[1] - by, dz = out[2] - bz;
    const r = Math.hypot(dx * c.plane[0] + dz * c.plane[1], dy / f, (dz * c.plane[0] - dx * c.plane[1]) / ov);
    let lim = dome;
    if (c.lobes && r > 1e-9) { const l = Math.hypot(dx, dy, dz) || 1; lim *= 1 + c.lobes * noise3(dx / l * 1.9 + c.lobeSeed, dy / l * 1.9, dz / l * 1.9 - c.lobeSeed); }
    if (r > lim) { const k = lim / r; out[0] = bx + dx * k; out[1] = by + dy * k; out[2] = bz + dz * k; }
    return out;
  },
};
const SHELL_HOOKS = {
  // A sponge wall: the new particle goes onto a surface of revolution of
  // radius r(y) round the colony axis (shell r0 .. r1 over the height,
  // power p), in a wall of shell.wall spacings, over a floor of
  // shell.floor spacings at the base. c.bend leans the axis.
  placeParticle(R, p, parent, out) {
    const c = R.colonies[R.col[parent]], U = R.U, s = R.spU(parent), sh = c.sp.shell;
    const by = c.base[1] / U, H = c.size * c.sp.tall / U, half = 0.5 * c.size / U;
    const dy = Math.max(0, out[1] - by), yn = Math.min(1, dy / H);
    const lean = (c.bend || 0) * yn * yn * H;
    const ax = c.base[0] / U + c.plane[0] * lean, az = c.base[2] / U + c.plane[1] * lean;
    const dx = out[0] - ax, dz = out[2] - az, r = Math.hypot(dx, dz);
    const rp = half * (sh.r0 + (sh.r1 - sh.r0) * Math.pow(yn, sh.p ?? 1)), w = sh.wall * s;
    let rt = r;
    if (r > rp) rt = rp;
    else if (r < rp - w && dy > sh.floor * s) rt = rp - 0.5 * w;
    if (rt !== r && r > 1e-9) { out[0] = ax + dx / r * rt; out[2] = az + dz / r * rt; }
    return out;
  },
};

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
// per particle (measured), for the triangle budget. base, tip: natural
// colours (linear 0..1). sway: soft corals move with the water. apex:
// the tip growth (axis: the share of the branch direction in a new
// particle, up: a pull up, split: the fork chance near a tip, side: the
// fork chance on an old branch, every: hops between forks, angle and
// sideAngle: fork angles (degrees), kids, rootKids, whorl: children per
// particle, planar: in the colony plane, net: self-bridge reach in
// spacings).
// SPECIES metadata (the coral-species page card, the WORLD placement):
// common and latin names, form (the growth form in words), group (the
// picker group: branching, plating, massive, soft, fans, deep), depth
// [min, max] (m, the usual range in life), habitat and fact (one line
// each), morphs (colour variants [base, tip]: a colony takes one from its
// seed), site (pickSpecies weights of a new species: any, top, wall, shel
// (sheltered), open (exposed)), vary (the per-colony change of the growth
// rule, from the seed). core: the five first species, whose site rules
// and tests come from the old reef page.
export const SPECIES = {
  staghorn: {
    label: 'Staghorn coral', latin: 'Acropora cervicornis', form: 'Branching', group: 'branching', core: true,
    depth: [1, 30], habitat: 'Clear fore-reef slopes and back-reef lagoons of the Caribbean, in thickets',
    fact: 'Its branches can extend 10 to 20 cm a year, among the fastest of all stony corals.',
    params: { particleSpacing: 0.04, attractionDistance: 0.055, minMoveDistance: 0.025, stubbornness: 0, stickiness: 0.9 },
    size: [3.5, 9.0], tall: 0.7, tpp: 81, dim: 1.62, fill: 2.2, r0: 0.013, thick: 0.17, sway: 0,
    base: [0.72, 0.56, 0.38], tip: [0.86, 0.80, 0.98],
    morphs: [[[0.72, 0.56, 0.38], [0.86, 0.80, 0.98]], [[0.66, 0.52, 0.34], [0.92, 0.86, 0.74]], [[0.6, 0.5, 0.42], [0.78, 0.74, 0.96]]],
    apex: { axis: 0.85, up: 0.06, split: 0.35, side: 0.2, every: 3, angle: 50, kids: 2, rootKids: 3 },
    hooks: BRANCH_HOOKS,
  },
  fan: {
    label: 'Common sea fan', latin: 'Gorgonia ventalina', form: 'Planar fan', group: 'fans', core: true, feed: 'plane',
    depth: [1, 30], habitat: 'Caribbean reef walls and channels, the fan across the current',
    fact: 'A gorgonian: a horny skeleton of gorgonin, with polyps that sieve plankton from the water that crosses the fan.',
    params: { particleSpacing: 0.022, attractionDistance: 0.03, minMoveDistance: 0.016, stubbornness: 0, stickiness: 0.75 },
    size: [2.4, 5.5], tall: 1, tpp: 72, dim: 1.55, fill: 3.2, r0: 0.006, thick: 0.1, sway: 1,
    base: [0.62, 0.16, 0.46], tip: [0.95, 0.45, 0.62],
    morphs: [[[0.62, 0.16, 0.46], [0.95, 0.45, 0.62]], [[0.5, 0.18, 0.55], [0.8, 0.52, 0.86]], [[0.72, 0.6, 0.3], [0.92, 0.82, 0.5]]],
    apex: { axis: 0.75, up: 0.3, split: 0.3, side: 0.35, every: 3, angle: 24, sideAngle: 75, kids: 2, rootKids: 2, planar: true, net: 3 },
    hooks: FAN_HOOKS,
  },
  table: {
    label: 'Table coral', latin: 'Acropora hyacinthus', form: 'Tabular', group: 'plating', core: true,
    depth: [1, 25], habitat: 'Indo-Pacific reef crests and upper slopes, in strong light',
    fact: 'A short central stalk carries a flat plate of fused, fine branches that shades the reef under it.',
    params: { particleSpacing: 0.045, attractionDistance: 0.065, minMoveDistance: 0.03, stubbornness: 1, stickiness: 0.9 },
    size: [3.0, 8.0], tall: 0.4, tpp: 25, dim: 1.6, fill: 3.6, r0: 0.016, thick: 0.12, sway: 0, stalkM: 0.3,
    base: [0.42, 0.55, 0.42], tip: [0.75, 0.92, 0.72],
    morphs: [[[0.42, 0.55, 0.42], [0.75, 0.92, 0.72]], [[0.5, 0.48, 0.36], [0.82, 0.78, 0.6]], [[0.44, 0.46, 0.56], [0.7, 0.78, 0.92]]],
    apex: { axis: 0.8, up: 0, split: 0.35, side: 0.1, every: 3, angle: 32, kids: 2, rootKids: 1, whorl: 7 },
    hooks: PLATE_HOOKS,
  },
  boulder: {
    label: 'Grooved brain coral', latin: 'Diploria labyrinthiformis', form: 'Massive dome', group: 'massive', core: true,
    depth: [1, 30], habitat: 'Caribbean fore reefs and patch reefs',
    fact: 'The valleys are rows of polyps that share walls; a dome grows a few millimetres a year and can live for centuries.',
    params: { particleSpacing: 0.12, attractionDistance: 0.1, minMoveDistance: 0.05, stubbornness: 6, stickiness: 0.6 },
    size: [2.2, 5.0], tall: 0.6, tpp: 120, dim: 2.75, fill: 0.3, r0: 0.04, thick: 0.03, sway: 0, density: 0.45,
    base: [0.66, 0.60, 0.30], tip: [0.86, 0.80, 0.50],
    morphs: [[[0.66, 0.60, 0.30], [0.86, 0.80, 0.50]], [[0.58, 0.5, 0.34], [0.8, 0.72, 0.5]], [[0.56, 0.6, 0.36], [0.76, 0.84, 0.52]]],
    mound: { flat: 1 },
    hooks: MOUND_HOOKS,
  },
  finger: {
    label: 'Finger leather coral', latin: 'Sinularia flexibilis', form: 'Soft lobes', group: 'soft', core: true,
    depth: [1, 30], habitat: 'Indo-Pacific reef flats and lagoons',
    fact: 'A soft coral: no stony skeleton, only small calcite spicules in a leathery tissue that bends in the surge.',
    params: { particleSpacing: 0.04, attractionDistance: 0.065, minMoveDistance: 0.026, stubbornness: 1, stickiness: 0.5 },
    size: [1.8, 4.5], tall: 0.7, tpp: 91, dim: 1.9, fill: 1.4, r0: 0.02, thick: 0.15, sway: 0.6,
    base: [0.72, 0.48, 0.62], tip: [0.96, 0.82, 0.88],
    morphs: [[[0.72, 0.48, 0.62], [0.96, 0.82, 0.88]], [[0.62, 0.6, 0.42], [0.88, 0.86, 0.66]], [[0.6, 0.56, 0.5], [0.86, 0.84, 0.78]]],
    apex: { axis: 0.75, up: 0.1, split: 0.5, side: 0.35, every: 2, angle: 38, kids: 2, rootKids: 4 },
    hooks: {
      // dlaf ShouldJoin with a low stickiness: the walkers creep into the
      // gaps before they stick, so the lobes stay thick and soft.
      shouldJoin(R, p, parent) { return R.dlafJoin(parent); },
    },
  },

  // ── branching stony corals ──
  elkhorn: {
    label: 'Elkhorn coral', latin: 'Acropora palmata', form: 'Branching, flattened', group: 'branching',
    depth: [0.5, 12], habitat: 'Caribbean reef crests in the surf zone, branches into the waves',
    fact: 'Broad flat branches like moose antlers; it built the Caribbean reef crests for thousands of years.',
    params: { particleSpacing: 0.05, attractionDistance: 0.07, minMoveDistance: 0.03, stubbornness: 0, stickiness: 0.9 },
    size: [3.0, 8.0], tall: 0.45, tpp: 169, dim: 1.6, fill: 1.8, r0: 0.02, thick: 0.2, sway: 0,
    base: [0.72, 0.52, 0.30], tip: [0.92, 0.84, 0.62],
    morphs: [[[0.72, 0.52, 0.30], [0.92, 0.84, 0.62]], [[0.66, 0.46, 0.28], [0.9, 0.76, 0.5]]],
    stalkM: 0.12, apex: { axis: 0.85, up: 0, split: 0.5, side: 0.3, every: 3, angle: 44, kids: 2, rootKids: 1, whorl: 4, whorlAngle: 70, whorlFirst: true, flatK: 0.65 },
    site: { top: 1.6, open: 1.2 }, hooks: BRANCH_HOOKS,
  },
  pocillopora: {
    label: 'Cauliflower coral', latin: 'Pocillopora verrucosa', form: 'Branching, compact', group: 'branching',
    depth: [1, 30], habitat: 'Indo-Pacific reef flats and exposed slopes',
    fact: 'Short stout branches covered in warts (verrucae); crabs and gobies live between them and defend it.',
    params: { particleSpacing: 0.03, attractionDistance: 0.045, minMoveDistance: 0.02, stubbornness: 0, stickiness: 0.9 },
    size: [1.6, 3.4], tall: 0.75, tpp: 87, dim: 1.85, fill: 1.4, r0: 0.014, thick: 0.2, sway: 0,
    base: [0.74, 0.56, 0.5], tip: [0.95, 0.74, 0.74],
    morphs: [[[0.74, 0.56, 0.5], [0.95, 0.74, 0.74]], [[0.62, 0.6, 0.42], [0.86, 0.84, 0.64]], [[0.7, 0.46, 0.5], [0.98, 0.64, 0.7]]],
    apex: { axis: 0.7, up: 0.18, split: 0.6, side: 0.35, every: 2, angle: 34, kids: 2, rootKids: 3 },
    site: { top: 1.2, open: 0.8, any: 0.1 }, hooks: BRANCH_HOOKS,
  },
  stylophora: {
    label: 'Hood coral', latin: 'Stylophora pistillata', form: 'Branching, blunt', group: 'branching',
    depth: [1, 40], habitat: 'Red Sea and Indo-Pacific reefs, shallow and sheltered',
    fact: 'Thick blunt branch tips; a lab model of coral biology, since its larvae settle readily.',
    params: { particleSpacing: 0.035, attractionDistance: 0.05, minMoveDistance: 0.022, stubbornness: 0, stickiness: 0.85 },
    size: [1.4, 3.0], tall: 0.6, tpp: 95, dim: 1.75, fill: 1.6, r0: 0.02, thick: 0.14, sway: 0,
    base: [0.82, 0.64, 0.6], tip: [0.96, 0.82, 0.86],
    morphs: [[[0.82, 0.64, 0.6], [0.96, 0.82, 0.86]], [[0.6, 0.62, 0.5], [0.8, 0.9, 0.7]], [[0.66, 0.56, 0.7], [0.86, 0.76, 0.96]]],
    apex: { axis: 0.8, up: 0.08, split: 0.45, side: 0.22, every: 3, angle: 48, kids: 2, rootKids: 4 },
    site: { top: 1, shel: 0.6 }, hooks: BRANCH_HOOKS,
  },
  seriatopora: {
    label: "Bird's nest coral", latin: 'Seriatopora hystrix', form: 'Branching, fine and fused', group: 'branching',
    depth: [3, 40], habitat: 'Sheltered Indo-Pacific slopes and lagoons',
    fact: 'Thin pointed branches fork and fuse into a tangled nest; corallites sit in neat rows along each twig.',
    params: { particleSpacing: 0.025, attractionDistance: 0.036, minMoveDistance: 0.017, stubbornness: 0, stickiness: 0.9 },
    size: [1.4, 3.0], tall: 0.8, tpp: 77, dim: 1.7, fill: 1.8, r0: 0.006, thick: 0.12, sway: 0,
    base: [0.86, 0.72, 0.66], tip: [0.98, 0.86, 0.9],
    morphs: [[[0.86, 0.72, 0.66], [0.98, 0.86, 0.9]], [[0.74, 0.7, 0.5], [0.92, 0.9, 0.72]], [[0.84, 0.6, 0.66], [0.98, 0.76, 0.86]]],
    apex: { axis: 0.72, up: 0.2, split: 0.55, side: 0.3, every: 2, angle: 30, kids: 2, rootKids: 4, net: 2 },
    site: { top: 0.8, shel: 0.8 }, hooks: BRANCH_HOOKS,
  },
  pillar: {
    label: 'Pillar coral', latin: 'Dendrogyra cylindrus', form: 'Columnar', group: 'branching',
    depth: [1, 20], habitat: 'Caribbean fore reefs on flat or gently sloping ground',
    fact: 'Round pillars up to 3 m rise from one base; its polyps stay out by day, so the pillars look furry.',
    params: { particleSpacing: 0.06, attractionDistance: 0.08, minMoveDistance: 0.035, stubbornness: 1, stickiness: 0.8 },
    size: [1.6, 3.6], tall: 1.5, tpp: 149, dim: 1.45, fill: 2.6, r0: 0.05, thick: 0.08, sway: 0, stalkM: 0.02,
    base: [0.7, 0.6, 0.42], tip: [0.88, 0.8, 0.6],
    morphs: [[[0.7, 0.6, 0.42], [0.88, 0.8, 0.6]], [[0.62, 0.56, 0.44], [0.84, 0.78, 0.66]]],
    apex: { axis: 0.9, up: 0.35, split: 0.7, side: 0.6, every: 2, angle: 30, kids: 1, rootKids: 1, whorl: 5, whorlAngle: 82, whorlFirst: true, maxOrder: 1 },
    site: { top: 1.2, open: 0.4 }, hooks: BRANCH_HOOKS,
  },

  // ── plating and foliose stony corals ──
  montipora: {
    label: 'Plate montipora', latin: 'Montipora capricornis', form: 'Plates in whorls', group: 'plating',
    depth: [3, 40], habitat: 'Indo-Pacific slopes, plates tilted to the light',
    fact: 'Thin plates grow in whorls and tiers, like a stack of tilted saucers; small polyps give a fine pored skin.',
    params: { particleSpacing: 0.04, attractionDistance: 0.06, minMoveDistance: 0.026, stubbornness: 1, stickiness: 0.9 },
    size: [1.8, 4.5], tall: 0.55, tpp: 63, dim: 1.6, fill: 3.4, r0: 0.012, thick: 0.1, sway: 0, stalkM: 0.06,
    base: [0.56, 0.36, 0.3], tip: [0.86, 0.6, 0.5],
    morphs: [[[0.56, 0.36, 0.3], [0.86, 0.6, 0.5]], [[0.42, 0.5, 0.36], [0.7, 0.86, 0.6]], [[0.46, 0.34, 0.5], [0.76, 0.6, 0.86]]],
    apex: { axis: 0.8, up: 0, split: 0.4, side: 0.12, every: 3, angle: 30, kids: 2, rootKids: 1, whorl: 6, whorlAngle: 78 },
    plate: { tilt: 0.38 }, site: { wall: 0.8, top: 0.5, any: 0.1 }, hooks: PLATE_HOOKS,
  },
  turbinaria: {
    label: 'Scroll coral', latin: 'Turbinaria reniformis', form: 'Vase and scroll', group: 'plating',
    depth: [2, 30], habitat: 'Indo-Pacific reefs, often in turbid water',
    fact: 'A plate that rolls up into a vase or scroll; it copes with murky water better than most stony corals.',
    params: { particleSpacing: 0.04, attractionDistance: 0.06, minMoveDistance: 0.026, stubbornness: 1, stickiness: 0.9 },
    size: [1.4, 3.2], tall: 0.85, tpp: 71, dim: 1.62, fill: 3.2, r0: 0.013, thick: 0.1, sway: 0, stalkM: 0.14,
    base: [0.62, 0.62, 0.3], tip: [0.88, 0.88, 0.52],
    morphs: [[[0.62, 0.62, 0.3], [0.88, 0.88, 0.52]], [[0.5, 0.52, 0.36], [0.76, 0.82, 0.6]], [[0.6, 0.5, 0.32], [0.86, 0.72, 0.46]]],
    apex: { axis: 0.82, up: 0, split: 0.4, side: 0.1, every: 3, angle: 26, kids: 2, rootKids: 1, whorl: 7, whorlAngle: 60 },
    plate: { tilt: 1.05 }, site: { top: 0.6, shel: 0.8 }, hooks: PLATE_HOOKS,
  },
  pachyseris: {
    label: 'Elephant skin coral', latin: 'Pachyseris speciosa', form: 'Thin leaves in tiers', group: 'plating',
    depth: [5, 70], habitat: 'Shaded Indo-Pacific slopes, down into the mesophotic zone',
    fact: 'Thin horizontal leaves with concentric ridges, like a fingerprint; it collects the dim light of deep slopes.',
    params: { particleSpacing: 0.042, attractionDistance: 0.062, minMoveDistance: 0.028, stubbornness: 1, stickiness: 0.9 },
    size: [1.8, 4.5], tall: 0.3, tpp: 50, dim: 1.6, fill: 3.4, r0: 0.012, thick: 0.08, sway: 0, stalkM: 0.02,
    base: [0.5, 0.44, 0.32], tip: [0.76, 0.7, 0.52],
    morphs: [[[0.5, 0.44, 0.32], [0.76, 0.7, 0.52]], [[0.42, 0.42, 0.36], [0.68, 0.7, 0.6]]],
    apex: { axis: 0.84, up: 0, split: 0.38, side: 0.1, every: 3, angle: 40, kids: 2, rootKids: 1, whorl: 5, whorlAngle: 86 },
    plate: { tilt: 0.06 }, site: { wall: 1, shel: 0.8 }, hooks: PLATE_HOOKS,
  },
  echinopora: {
    label: 'Hedgehog coral', latin: 'Echinopora lamellosa', form: 'Foliose, cupped', group: 'plating',
    depth: [3, 30], habitat: 'Indo-Pacific slopes, in tiers of cupped plates',
    fact: 'Leafy plates with spiny corallites; the plates curl up at the edge and stack into tiers.',
    params: { particleSpacing: 0.04, attractionDistance: 0.06, minMoveDistance: 0.026, stubbornness: 1, stickiness: 0.9 },
    size: [1.2, 3.0], tall: 0.8, tpp: 60, dim: 1.62, fill: 3.2, r0: 0.013, thick: 0.1, sway: 0, stalkM: 0.06,
    base: [0.46, 0.4, 0.3], tip: [0.72, 0.7, 0.46],
    morphs: [[[0.46, 0.4, 0.3], [0.72, 0.7, 0.46]], [[0.5, 0.36, 0.32], [0.82, 0.6, 0.5]]],
    apex: { axis: 0.75, up: 0.04, split: 0.55, side: 0.18, every: 2, angle: 34, kids: 2, rootKids: 1, whorl: 5, whorlAngle: 70 },
    plate: { tilt: 0.8 }, site: { top: 0.6, wall: 0.6 }, hooks: PLATE_HOOKS,
  },
  merulina: {
    label: 'Merulina coral', latin: 'Merulina ampliata', form: 'Foliose, ridged', group: 'plating',
    depth: [2, 30], habitat: 'Indo-Pacific reef slopes',
    fact: 'Spreading plates with short valleys that fan out from the centre to the edge.',
    params: { particleSpacing: 0.042, attractionDistance: 0.062, minMoveDistance: 0.028, stubbornness: 1, stickiness: 0.9 },
    size: [1.8, 4.2], tall: 0.45, tpp: 55, dim: 1.6, fill: 3.4, r0: 0.013, thick: 0.1, sway: 0, stalkM: 0.04,
    base: [0.6, 0.48, 0.34], tip: [0.86, 0.74, 0.56],
    morphs: [[[0.6, 0.48, 0.34], [0.86, 0.74, 0.56]], [[0.5, 0.52, 0.42], [0.74, 0.8, 0.66]]],
    apex: { axis: 0.78, up: 0, split: 0.5, side: 0.14, every: 2, angle: 28, kids: 2, rootKids: 1, whorl: 4, whorlAngle: 84 },
    plate: { tilt: 0.2 }, site: { top: 0.6, wall: 0.5 }, hooks: PLATE_HOOKS,
  },

  // ── massive, encrusting and free-living stony corals ──
  porites: {
    label: 'Lobe coral', latin: 'Porites lobata', form: 'Massive, lobed boulder', group: 'massive',
    depth: [0.5, 30], habitat: 'Indo-Pacific reef flats and slopes',
    fact: 'Lumpy boulders that can pass 5 m and 500 years; its bands of skeleton record the past sea temperature.',
    params: { particleSpacing: 0.11, attractionDistance: 0.095, minMoveDistance: 0.05, stubbornness: 6, stickiness: 0.6 },
    size: [2.2, 5.5], tall: 0.6, tpp: 72, dim: 2.7, fill: 0.3, r0: 0.04, thick: 0.03, sway: 0, density: 0.45,
    base: [0.72, 0.62, 0.36], tip: [0.86, 0.78, 0.5],
    morphs: [[[0.72, 0.62, 0.36], [0.86, 0.78, 0.5]], [[0.56, 0.5, 0.56], [0.74, 0.66, 0.82]], [[0.6, 0.62, 0.42], [0.76, 0.84, 0.56]]],
    mound: { flat: 0.78, lobes: 0.3 }, site: { top: 0.8, any: 0.3 }, hooks: MOUND_HOOKS,
  },
  favites: {
    label: 'Larger star coral', latin: 'Favites abdita', form: 'Massive dome, cells', group: 'massive',
    depth: [1, 30], habitat: 'Indo-Pacific reefs, on most reef zones',
    fact: 'Each polyp sits in its own walled cell, and neighbours share walls, like a honeycomb.',
    params: { particleSpacing: 0.1, attractionDistance: 0.09, minMoveDistance: 0.045, stubbornness: 6, stickiness: 0.6 },
    size: [1.2, 3.0], tall: 0.6, tpp: 88, dim: 2.7, fill: 0.32, r0: 0.035, thick: 0.03, sway: 0, density: 0.45,
    base: [0.56, 0.5, 0.3], tip: [0.76, 0.84, 0.46],
    morphs: [[[0.56, 0.5, 0.3], [0.76, 0.84, 0.46]], [[0.56, 0.38, 0.32], [0.82, 0.58, 0.46]]],
    mound: { flat: 0.85, lobes: 0.08 }, site: { top: 0.6, shel: 0.6, any: 0.2 }, hooks: MOUND_HOOKS,
  },
  lobophyllia: {
    label: 'Lobed brain coral', latin: 'Lobophyllia hemprichii', form: 'Massive, fleshy lobes', group: 'massive',
    depth: [1, 40], habitat: 'Indo-Pacific slopes, often in sheltered water',
    fact: 'Large fleshy polyps in long lobed valleys; at night they stretch out sweeper tentacles.',
    params: { particleSpacing: 0.1, attractionDistance: 0.09, minMoveDistance: 0.045, stubbornness: 5, stickiness: 0.6 },
    size: [1.2, 3.0], tall: 0.55, tpp: 83, dim: 2.7, fill: 0.32, r0: 0.04, thick: 0.03, sway: 0, density: 0.4,
    base: [0.46, 0.5, 0.3], tip: [0.66, 0.82, 0.44],
    morphs: [[[0.46, 0.5, 0.3], [0.66, 0.82, 0.44]], [[0.56, 0.3, 0.3], [0.86, 0.46, 0.4]], [[0.5, 0.42, 0.26], [0.84, 0.72, 0.38]]],
    mound: { flat: 0.62, lobes: 0.42 }, site: { shel: 1, any: 0.1 }, hooks: MOUND_HOOKS,
  },
  encrusting: {
    label: 'Encrusting montipora', latin: 'Montipora undata', form: 'Encrusting', group: 'massive',
    depth: [1, 30], habitat: 'Indo-Pacific reef flats, over dead coral and rock',
    fact: 'A thin crust that spreads out from one point over the rock, a few centimetres thick, with low bumps.',
    params: { particleSpacing: 0.09, attractionDistance: 0.085, minMoveDistance: 0.04, stubbornness: 5, stickiness: 0.6 },
    size: [1.6, 4.0], tall: 0.16, tpp: 58, dim: 2.2, fill: 1.0, r0: 0.03, thick: 0.03, sway: 0, density: 0.5,
    base: [0.56, 0.34, 0.42], tip: [0.84, 0.56, 0.7],
    morphs: [[[0.56, 0.34, 0.42], [0.84, 0.56, 0.7]], [[0.4, 0.5, 0.4], [0.6, 0.82, 0.62]], [[0.62, 0.46, 0.3], [0.9, 0.7, 0.42]]],
    mound: { flat: 0.18, lobes: 0.22 }, site: { top: 0.5, wall: 0.5, any: 0.3 }, hooks: MOUND_HOOKS,
  },
  mushroom: {
    label: 'Mushroom coral', latin: 'Fungia fungites', form: 'Free-living, solitary', group: 'massive',
    depth: [1, 30], habitat: 'Indo-Pacific reef sand and rubble, loose on the ground',
    fact: 'One single giant polyp with radial walls (septa); an adult lies free on the sand and can right itself.',
    params: { particleSpacing: 0.02, attractionDistance: 0.024, minMoveDistance: 0.01, stubbornness: 5, stickiness: 0.6 },
    size: [0.3, 0.5], tall: 0.22, tpp: 60, dim: 2.2, fill: 0.6, r0: 0.008, thick: 0.03, sway: 0, density: 0.5,
    base: [0.66, 0.54, 0.4], tip: [0.86, 0.76, 0.6],
    morphs: [[[0.66, 0.54, 0.4], [0.86, 0.76, 0.6]], [[0.5, 0.56, 0.44], [0.74, 0.86, 0.62]], [[0.64, 0.42, 0.5], [0.9, 0.64, 0.76]]],
    mound: { flat: 0.24, oval: 1.35 }, site: { top: 0.6, any: 0.2 }, hooks: MOUND_HOOKS,
  },

  // ── soft corals ──
  leather: {
    label: 'Toadstool leather coral', latin: 'Sarcophyton glaucum', form: 'Soft, mushroom cap', group: 'soft',
    depth: [1, 25], habitat: 'Indo-Pacific reef flats and lagoons',
    fact: 'A stalk carries a folded leathery cap; it sheds a waxy skin now and then to clean itself.',
    params: { particleSpacing: 0.04, attractionDistance: 0.06, minMoveDistance: 0.026, stubbornness: 1, stickiness: 0.85 },
    size: [1.0, 2.4], tall: 0.75, tpp: 65, dim: 1.65, fill: 3.2, r0: 0.02, thick: 0.12, sway: 0.25, stalkM: 0.28,
    base: [0.82, 0.76, 0.56], tip: [0.94, 0.9, 0.72],
    morphs: [[[0.82, 0.76, 0.56], [0.94, 0.9, 0.72]], [[0.62, 0.66, 0.5], [0.8, 0.88, 0.66]], [[0.84, 0.66, 0.6], [0.96, 0.84, 0.8]]],
    apex: { axis: 0.78, up: 0.02, split: 0.45, side: 0.14, every: 2, angle: 34, kids: 2, rootKids: 1, whorl: 9, whorlAngle: 76 },
    plate: { tilt: 0.3 }, site: { top: 0.6, shel: 0.6 }, hooks: PLATE_HOOKS,
  },
  carnation: {
    label: 'Carnation tree coral', latin: 'Dendronephthya hemprichi', form: 'Soft, branched tree', group: 'soft',
    depth: [5, 60], habitat: 'Indo-Pacific walls and overhangs in a strong current',
    fact: 'It has no algae and feeds on plankton only; it swells with water to open, and shrinks when the current stops.',
    params: { particleSpacing: 0.03, attractionDistance: 0.042, minMoveDistance: 0.02, stubbornness: 0, stickiness: 0.85 },
    size: [0.8, 1.8], tall: 1.1, tpp: 103, dim: 1.7, fill: 1.8, r0: 0.01, thick: 0.25, sway: 1,
    base: [0.94, 0.86, 0.9], tip: [0.95, 0.3, 0.5],
    morphs: [[[0.94, 0.86, 0.9], [0.95, 0.3, 0.5]], [[0.95, 0.9, 0.86], [0.98, 0.58, 0.18]], [[0.9, 0.86, 0.95], [0.64, 0.34, 0.9]]],
    apex: { axis: 0.72, up: 0.25, split: 0.5, side: 0.3, every: 2, angle: 42, kids: 2, rootKids: 2, maxOrder: 4, len: [99, 12, 7, 4, 3] },
    site: { wall: 1.2, open: 0.6 }, deepColour: false, hooks: BRANCH_HOOKS,
  },
  xenia: {
    label: 'Pulse coral', latin: 'Xenia umbellata', form: 'Soft, stalks with crowns', group: 'soft',
    depth: [1, 30], habitat: 'Red Sea and Indo-Pacific reef flats',
    fact: 'Its feathery polyps open and close in a steady beat, about once a second, which stirs the water.',
    params: { particleSpacing: 0.016, attractionDistance: 0.022, minMoveDistance: 0.01, stubbornness: 0, stickiness: 0.8 },
    size: [0.3, 0.7], tall: 0.9, tpp: 70, dim: 1.7, fill: 0.6, r0: 0.007, thick: 0.18, sway: 0.75, stalkM: 0.02,
    base: [0.86, 0.82, 0.78], tip: [0.92, 0.92, 0.96],
    morphs: [[[0.86, 0.82, 0.78], [0.92, 0.92, 0.96]], [[0.7, 0.66, 0.84], [0.86, 0.84, 0.98]], [[0.62, 0.74, 0.7], [0.82, 0.94, 0.88]]],
    apex: { axis: 0.85, up: 0.35, split: 0.6, side: 0.4, every: 2, angle: 32, kids: 2, rootKids: 1, whorl: 6, whorlAngle: 40, whorlFirst: true, maxOrder: 3, len: [99, 10, 5, 3] },
    site: { top: 0.8, shel: 0.6 }, hooks: BRANCH_HOOKS,
  },

  // ── gorgonians and sea fans ──
  seawhip: {
    label: 'Sea whip', latin: 'Ellisella elongata', form: 'Whips, few branches', group: 'fans',
    depth: [10, 80], habitat: 'Indo-Pacific walls and sand slopes in a current',
    fact: 'Long thin rods that branch only at the base; the polyps catch plankton along the whole whip.',
    params: { particleSpacing: 0.03, attractionDistance: 0.04, minMoveDistance: 0.02, stubbornness: 0, stickiness: 0.85 },
    size: [1.2, 3.0], tall: 1.4, tpp: 106, dim: 1.2, fill: 3, r0: 0.006, thick: 0.06, sway: 1, stalkM: 0.02,
    base: [0.86, 0.36, 0.2], tip: [0.98, 0.62, 0.36],
    morphs: [[[0.86, 0.36, 0.2], [0.98, 0.62, 0.36]], [[0.9, 0.84, 0.76], [0.98, 0.94, 0.88]], [[0.84, 0.66, 0.2], [0.98, 0.84, 0.42]]],
    apex: { axis: 0.94, up: 0.45, split: 0.6, side: 0.4, every: 3, angle: 18, kids: 1, rootKids: 1, whorl: 3, whorlAngle: 55, whorlFirst: true, maxOrder: 1 },
    site: { wall: 0.8, open: 0.8 }, hooks: BRANCH_HOOKS,
  },
  searod: {
    label: 'Sea rod', latin: 'Plexaura homomalla', form: 'Bushy candelabra', group: 'fans',
    depth: [1, 30], habitat: 'Caribbean reef flats and fore reefs',
    fact: 'Round rods in a loose candelabra; the polyps give it a fuzzy look, and the rods bend with the surge.',
    params: { particleSpacing: 0.032, attractionDistance: 0.045, minMoveDistance: 0.02, stubbornness: 0, stickiness: 0.85 },
    size: [1.0, 2.4], tall: 1.2, tpp: 85, dim: 1.45, fill: 2.6, r0: 0.012, thick: 0.1, sway: 0.8,
    base: [0.42, 0.3, 0.22], tip: [0.66, 0.54, 0.4],
    morphs: [[[0.42, 0.3, 0.22], [0.66, 0.54, 0.4]], [[0.52, 0.44, 0.34], [0.82, 0.72, 0.56]], [[0.48, 0.3, 0.42], [0.74, 0.52, 0.7]]],
    apex: { axis: 0.9, up: 0.42, split: 0.28, side: 0.14, every: 4, angle: 28, kids: 2, rootKids: 2 },
    site: { top: 1, open: 0.8 }, hooks: BRANCH_HOOKS,
  },
  annella: {
    label: 'Giant sea fan', latin: 'Annella mollis', form: 'Planar fan, fine net', group: 'fans', feed: 'plane',
    depth: [5, 40], habitat: 'Indo-Pacific walls and channels, across the current',
    fact: 'Fans up to 3 m wide with a very fine net; the whole fan is one colony from one holdfast.',
    params: { particleSpacing: 0.02, attractionDistance: 0.027, minMoveDistance: 0.014, stubbornness: 0, stickiness: 0.75 },
    size: [3.0, 6.5], tall: 0.9, tpp: 86, dim: 1.6, fill: 2.4, r0: 0.005, thick: 0.1, sway: 0.6,
    base: [0.82, 0.46, 0.22], tip: [0.96, 0.66, 0.36],
    morphs: [[[0.82, 0.46, 0.22], [0.96, 0.66, 0.36]], [[0.72, 0.2, 0.22], [0.92, 0.4, 0.36]], [[0.86, 0.76, 0.56], [0.96, 0.9, 0.72]]],
    apex: { axis: 0.7, up: 0.18, split: 0.35, side: 0.42, every: 2, angle: 30, sideAngle: 80, kids: 2, rootKids: 2, planar: true, net: 2.4 },
    site: { wall: 1.4, open: 0.5 }, hooks: FAN_HOOKS,
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
  if (sp.vary === undefined) sp.vary = sp.core ? 0.06 : 0.12;
  if (!sp.morphs) sp.morphs = [[sp.base, sp.tip]];
}
export const SPECIES_GROUPS = [
  { id: 'branching', label: 'Branching' }, { id: 'plating', label: 'Plates and leaves' },
  { id: 'massive', label: 'Massive and encrusting' }, { id: 'soft', label: 'Soft corals' },
  { id: 'fans', label: 'Sea fans and whips' }, { id: 'deep', label: 'Deep sea' },
];

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
  // a new species: its own site weights, and 0 unless the weights name it
  // (so the old plot and the presets keep their five species)
  for (const id of SPECIES_IDS) {
    if (w[id] !== undefined) continue;
    const q = SPECIES[id].site || {};
    w[id] = weights[id] === undefined ? 0 : (q.any || 0) + (q.top || 0) * top + (q.wall || 0) * wall + (q.shel || 0) * shel + (q.open || 0) * ex;
  }
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
    child: new Int32Array(capTotal), sib: new Int32Array(capTotal), dead: new Uint8Array(capTotal),
    ord: new Uint8Array(capTotal), run: new Uint16Array(capTotal),
    forks: 0, tipJoins: 0, nets: 0,
    m: null, random: null,
    addColony, populate, loadPreset, growColony, setRate, step, growAll, reset, setCurrent, setParams, done, progress,
    dlafJoin, spU, stalkOf, walkOne, apexPick, rockDist: rockD,
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
        // branch order and the hops since the branch began: a root child
        // continues order 0; a second child (a fork) or a child of the
        // whorl top starts a branch of the next order
        let o = 0, rn = 0;
        if (par >= 0) {
          if (R.parent[par] < 0) rn = 1;
          else if (R.kids[par] > 0 || (c.ap && c.ap.whorl && m.depth[par] === c.stalk)) { o = Math.min(255, R.ord[par] + 1); rn = 1; }
          else { o = R.ord[par]; rn = Math.min(65535, R.run[par] + 1); }
        }
        R.ord[i] = o; R.run[i] = rn;
        if (c.ap && c.ap.whorl && m.depth[i] === c.stalk) c.whorlTop = i;
        if (par >= 0 && R.kids[par] < 255) R.kids[par]++;
        R.child[i] = -1; R.dead[i] = 0; R.sib[i] = -1;
        // a branch of an order with a length limit (apex.len, hops) stops
        if (c.ap && c.ap.len && rn >= c.ap.len[Math.min(o, c.ap.len.length - 1)]) R.dead[i] = 1;
        if (par >= 0) { R.sib[i] = R.child[par]; R.child[par] = i; }
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

  // ── apical growth ──
  // The user said (2026-10-18): "real coral start with one root and branch
  // futher and further out". A walker that comes near the coral of a
  // branching species (sp.apex) feeds a branch TIP: the nearest live tip
  // (a particle with no child) near the walker gets the new particle, and
  // the new particle continues the branch (most of the parent direction,
  // some of the walker direction, a little up). Sometimes (apex.split) a
  // particle just under a tip forks instead: a new branch at apex.angle
  // to the old one, on the side of the walker. A fork needs apex.every
  // hops of plain branch above and below it, so branches fork at
  // intervals, not at every particle. Where no tip is near, an old branch
  // side forks seldom (apex.side) and the walker otherwise goes on. So
  // branches extend and fork; they do not thicken with random stubs.
  // The DLA walk still picks WHICH tip grows (the snow reaches the open
  // tips first), as in dlaf.
  // apex: axis, up, split, side, every (hops), angle (deg), kids (max
  // per particle), rootKids (max at the seed), whorl (table: the kids at
  // the top of the stalk), planar (fan: in the plane of the colony).
  const BQ = new Int32Array(96), BD = new Int8Array(96);
  let apexFork = false, apexSide = false;
  const LEAN = 0.3;
  function kidsMax(c, i) {
    const ap = c.ap;
    if (R.parent[i] < 0) return ap.rootKids;
    if (ap.whorl && R.m.depth[i] === c.stalk) return ap.whorl;
    if (ap.whorl && R.m.depth[i] < c.stalk) return 1;
    return ap.kids;
  }
  // i can take one more child as a fork: room for a kid, and no fork in
  // apex.every hops above it or (along its one child) below it
  function forkable(c, i) {
    const ap = c.ap, kn = R.kids[i];
    if (kn < 1 || kn >= kidsMax(c, i)) return false;
    // apex.maxOrder: no fork past that branch order; apex.forkH [lo, hi]:
    // forks only in that part of the colony height (size x tall)
    if (ap.maxOrder !== undefined && R.ord[i] >= ap.maxOrder && !(ap.whorl && R.m.depth[i] === c.stalk)) return false;
    if (ap.forkH) { const h = (R.py[i] - c.base[1]) / (c.size * c.sp.tall); if (h < ap.forkH[0] || h > ap.forkH[1]) return false; }
    if (R.parent[i] < 0 || (ap.whorl && R.m.depth[i] === c.stalk)) return true;
    let a = i;
    for (let h = 0; h < ap.every; h++) { a = R.parent[a]; if (a < 0 || R.kids[a] >= 2) return false; }
    if (kn >= 2) return false;
    a = R.child[i];
    for (let h = 0; h < ap.every - 1 && a >= 0; h++) { if (R.kids[a] >= 2) return false; a = R.child[a]; }
    return true;
  }
  // The particle that gets the walker at P, caught by particle par of
  // colony c: a live tip (apexFork false) or a fork (apexFork true), or -1.
  function apexPick(c, par, P) {
    const ap = c.ap, pos = R.m.pos, pr = params[c.id];
    const reach = pr.attractionDistance / U + 1.5 * pr.particleSpacing / U, r2 = reach * reach;
    // apex.whorlFirst: the whorl at the stalk top takes its branches
    // first (pillar columns, elkhorn arms), before the walk goes on
    if (ap.whorlFirst && c.whorlTop >= 0 && R.kids[c.whorlTop] >= 1 && R.kids[c.whorlTop] < ap.whorl) { apexFork = true; apexSide = false; return c.whorlTop; }
    let top = par;
    for (let u = 0; u < 2 && R.parent[top] >= 0; u++) top = R.parent[top];
    let h = 0, t = 1, tip = -1, tipD = r2, fk = -1, fkD = r2, deadNear = false;
    BQ[0] = top; BD[0] = 0;
    while (h < t) {
      const i = BQ[h], dep = BD[h]; h++;
      const dx = pos[i * 3] - P[0], dy = pos[i * 3 + 1] - P[1], dz = pos[i * 3 + 2] - P[2], d2 = dx * dx + dy * dy + dz * dz;
      if (R.kids[i] === 0) { if (R.dead[i]) { if (d2 < r2) deadNear = true; } else if (d2 < tipD) { tipD = d2; tip = i; } }
      else if (d2 < fkD && forkable(c, i)) { fkD = d2; fk = i; }
      if (dep >= 7) continue;
      for (let k = R.child[i]; k >= 0 && t < BQ.length; k = R.sib[k]) { BQ[t] = k; BD[t] = dep + 1; t++; }
    }
    // a tip at the outline (dead) does not go on: the crown then fills in
    // with forks at the split rate, so a colony at its size grows denser
    if (fk >= 0 && random() < (tip >= 0 || deadNear ? ap.split : ap.side)) { apexFork = true; apexSide = tip < 0 && !deadNear; return fk; }
    apexFork = false;
    return tip;
  }
  // The new particle of target t (model units into out): a tip goes on
  // along its branch; a fork turns apex.angle off the branch axis, away
  // from the child that t has.
  const AX = [0, 0, 0], WV = [0, 0, 0], LV = [0, 0, 0];
  function apexPlace(c, t, fork, P, out) {
    const ap = c.ap, pos = R.m.pos, s = spU(t), pl = ap.planar ? c.plane : null, pw = ap.planar === true ? 1 : +ap.planar || 0;
    // planar: true or 1 keeps the branch in the colony plane; 0..1 a part
    const flat = v => { if (pl) { const q = (v[0] * pl[0] + v[2] * pl[1]) * pw; v[0] -= pl[0] * q; v[2] -= pl[1] * q; } };
    const unit = v => { const l = Math.hypot(v[0], v[1], v[2]); if (l > 1e-9) { v[0] /= l; v[1] /= l; v[2] /= l; } return l; };
    const p = R.parent[t];
    if (p >= 0) { AX[0] = pos[t * 3] - pos[p * 3]; AX[1] = pos[t * 3 + 1] - pos[p * 3 + 1]; AX[2] = pos[t * 3 + 2] - pos[p * 3 + 2]; }
    else { AX[0] = c.normal[0]; AX[1] = c.normal[1] + 1; AX[2] = c.normal[2]; }
    if (ap.whorl && R.m.depth[t] < c.stalk) { AX[0] = 0; AX[1] = 1; AX[2] = 0; }
    flat(AX); if (unit(AX) < 1e-9) { AX[0] = 0; AX[1] = 1; AX[2] = 0; }
    WV[0] = P[0] - pos[t * 3]; WV[1] = P[1] - pos[t * 3 + 1]; WV[2] = P[2] - pos[t * 3 + 2];
    flat(WV); unit(WV);
    let dx, dy, dz;
    if (!fork) {
      const k = ap.whorl && R.m.depth[t] < c.stalk ? 1 : ap.axis;
      dx = AX[0] * k + WV[0] * (1 - k); dy = AX[1] * k + WV[1] * (1 - k) + ap.up; dz = AX[2] * k + WV[2] * (1 - k);
      // after a contact: a lean away from the neighbour colonies
      if (c.away && !pl) { dx += c.away[0] * LEAN; dz += c.away[1] * LEAN; }
    } else {
      // the side: the walker direction off the axis, turned away from the
      // child that t has (so the two branches spread)
      const w = WV[0] * AX[0] + WV[1] * AX[1] + WV[2] * AX[2];
      LV[0] = WV[0] - AX[0] * w; LV[1] = WV[1] - AX[1] * w; LV[2] = WV[2] - AX[2] * w;
      const k0 = R.child[t];
      if (k0 >= 0) {
        let ex = pos[k0 * 3] - pos[t * 3], ey = pos[k0 * 3 + 1] - pos[t * 3 + 1], ez = pos[k0 * 3 + 2] - pos[t * 3 + 2];
        const e = ex * AX[0] + ey * AX[1] + ez * AX[2]; ex -= AX[0] * e; ey -= AX[1] * e; ez -= AX[2] * e;
        const el = Math.hypot(ex, ey, ez);
        if (el > 1e-6) { ex /= el; ey /= el; ez /= el; const q = LV[0] * ex + LV[1] * ey + LV[2] * ez; if (q > -0.3) { LV[0] -= ex * (q + 0.6); LV[1] -= ey * (q + 0.6); LV[2] -= ez * (q + 0.6); } }
      }
      flat(LV);
      if (unit(LV) < 1e-6) {
        // no side from the walker: any direction across the axis
        if (pl) { LV[0] = -pl[1]; LV[1] = 0; LV[2] = pl[0]; } else { LV[0] = AX[1]; LV[1] = -AX[0]; LV[2] = 0; if (unit(LV) < 1e-6) { LV[0] = 1; LV[1] = 0; LV[2] = 0; } }
        if (random() < 0.5) { LV[0] = -LV[0]; LV[1] = -LV[1]; LV[2] = -LV[2]; }
      }
      const a = (ap.whorl && R.m.depth[t] === c.stalk ? ap.whorlAngle ?? 84 : apexSide && ap.sideAngle ? ap.sideAngle : ap.angle) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      dx = AX[0] * ca + LV[0] * sa; dy = AX[1] * ca + LV[1] * sa + ap.up * 0.5; dz = AX[2] * ca + LV[2] * sa;
      // apex.flatK: a fork spreads more to the sides than up (elkhorn)
      if (ap.flatK) dy *= 1 - ap.flatK;
    }
    const l = Math.hypot(dx, dy, dz) || 1;
    out[0] = pos[t * 3] + dx / l * s; out[1] = pos[t * 3 + 1] + dy / l * s; out[2] = pos[t * 3 + 2] + dz / l * s;
    return out;
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
  // A sea fan (apex.net) also joins itself: a new particle next to another
  // branch of its own colony (in 1.25 spacings, and more than 2 x 8 hops
  // away along the branches) fuses with it (a bridge) and that tip stops.
  // So the fan grows a net with closed meshes, as a Gorgonia, not a loose
  // bush.
  const NEAR = [];
  function lean(c, o) {
    let x = c.base[0] - o.base[0], z = c.base[2] - o.base[2];
    const l = Math.hypot(x, z); if (l < 1e-6) return;
    x = x / l + (c.away ? c.away[0] : 0); z = z / l + (c.away ? c.away[1] : 0);
    const m = Math.hypot(x, z) || 1;
    c.away = [x / m, z / m];
  }
  function nearInTree(i, j, hops) {
    NEAR.length = 0;
    for (let a = i, h = 0; a >= 0 && h <= hops; a = R.parent[a], h++) NEAR.push(a);
    for (let a = j, h = 0; a >= 0 && h <= hops; a = R.parent[a], h++) if (NEAR.includes(a)) return true;
    return false;
  }
  function contact(i) {
    const k = R.col[i], c = R.colonies[k];
    const lim = 1.6 * params[c.id].particleSpacing + 0.01, l2 = lim * lim;
    const net = c.ap && c.ap.net, ln = net * params[c.id].particleSpacing, n2 = ln * ln;
    let self = !net;
    // one rung per 4 hops of a branch: no bridge on the 3 nearest ancestors
    if (net) for (let a = R.parent[i], h = 0; a >= 0 && h < 3; a = R.parent[a], h++) if (R.bridges.has(a)) { self = true; break; }
    const cx = Math.floor(R.px[i] / CC), cy = Math.floor(R.py[i] / CC), cz = Math.floor(R.pz[i] / CC);
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const a = cgrid.get(ckey(cx + dx, cy + dy, cz + dz)); if (!a) continue;
      for (const j of a) {
        const kj = R.col[j];
        if (kj === k) {
          if (self || j === i) continue;
          const ex = R.px[j] - R.px[i], ey = R.py[j] - R.py[i], ez = R.pz[j] - R.pz[i];
          if (ex * ex + ey * ey + ez * ez > n2 || nearInTree(i, j, 8)) continue;
          R.bridges.set(i, j); R.nets++; self = true;
          continue;
        }
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
        // the branch tip met a neighbour colony: the space is taken, so
        // that tip stops (the colonies compete for the gap), and both
        // colonies lean their new growth away from each other (c.away)
        if (c.ap) R.dead[i] = 1;
        if (t.n === 1) { lean(c, R.colonies[kj]); lean(R.colonies[kj], c); }
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
    colony.whorlTop = -1;
    vary(colony);
    R.colonies.push(colony);
    rootColony = k;
    R.m.add([base[0] / U, base[1] / U, base[2] / U], -1);
    return colony;
  }

  // The per-colony rule, from the seed (the reef seed, the colony index
  // and its base): fork angles, split rates and the lift of the tips change
  // by up to sp.vary, the plate tilt and the lobes by 2 x vary, and the
  // colony takes one of the species colour morphs. So two colonies of one
  // species differ, inside the species.
  function vary(c) {
    const sp = c.sp, v = sp.vary || 0;
    const q = Math.round(c.base[0] * 997) ^ Math.round(c.base[2] * 1009) ^ Math.round(c.base[1] * 1013);
    const u = j => h01((R.seed | 0) * 131 + c.k * 7 + j, q + j * 7919) * 2 - 1;
    if (sp.apex) {
      const a = Object.assign({}, sp.apex);
      a.angle = sp.apex.angle * (1 + v * u(1));
      if (a.sideAngle) a.sideAngle = sp.apex.sideAngle * (1 + v * u(2));
      a.split = Math.min(0.95, sp.apex.split * (1 + v * u(3)));
      a.side = Math.min(0.95, sp.apex.side * (1 + v * u(4)));
      a.up = sp.apex.up + 0.5 * v * u(5) * Math.max(0.05, sp.apex.up);
      c.ap = a;
    } else c.ap = null;
    c.tilt = sp.plate ? Math.max(0, sp.plate.tilt * (1 + 2 * v * u(6))) : 0;
    c.lobes = sp.mound && sp.mound.lobes ? sp.mound.lobes * (1 + 2 * v * u(7)) : 0;
    c.lobeSeed = 10 * (u(8) + 1);
    c.bend = (sp.bend || 0) * (1 + 2 * v * u(9));
    c.morph = Math.floor((u(10) * 0.5 + 0.5) * sp.morphs.length * 0.9999);
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
  const FALL = 0.85, LIFT = 0.08, LIFT0 = 0, AIM = 0.4;
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
      if (c.sp.feed === 'plane') {
        // a sea fan feeds from the water that the current carries THROUGH
        // its plane (the fan stands across the current), so the food comes
        // to every part of the fan, not only to the outer tips: a walker
        // starts at a uniform point of a half disc in the fan plane (the fan
        // and a margin round it) and walks in the plane with a small fall.
        // So the holes of the net fill with side branches, as on a
        // Gorgonia, and the top does not get sparse
        spawnC = c; c.tries++;
        const f = c.plane, Rf = Math.max(c.top - c.base[1], c.ext) + 3 * a0 + 0.04 * c.size * Math.min(1, c.count / 300);
        const t = (random() - 0.5) * 0.9 * Math.PI, rr = Rf * Math.sqrt(random()), j = (random() - 0.5) * 2 * a0;
        const x = c.base[0] - f[1] * Math.sin(t) * rr + f[0] * j, z = c.base[2] + f[0] * Math.sin(t) * rr + f[1] * j;
        spawnX = c.base[0]; spawnZ = c.base[2]; spawnTop = c.base[1] + Rf + 0.3; spawnR = Rf + 0.6;
        wFall = 0.25; wPlane = f;
        out[0] = x / U; out[1] = (c.base[1] + Math.cos(t) * rr) / U; out[2] = z / U;
        return out;
      }
      const D = c.disc;
      if (c.ap && c.count > 24 && random() < AIM) {
        // snow near the growing front: over one of the last particles of
        // the colony (most are at or near a tip), upstream by the drift of
        // its fall. A branching colony is mostly open water, so snow from
        // the whole disc mostly falls through to the rock; this half of
        // the snow is the part that reaches the branches.
        // (a few tries for a particle that is not a stopped tip: the snow
        // over a tip that met a neighbour goes to the live front)
        let g = -1;
        for (let q = 0; q < 4 && (g < 0 || R.dead[g]); q++) g = c.ids[c.count - 1 - Math.floor(random() * random() * Math.min(c.count, 400))];
        const pr = params[c.id], h = 4 * pr.attractionDistance + 2 * pr.particleSpacing, ra = 3 * pr.attractionDistance + 2 * pr.particleSpacing;
        const a = random() * TAU, rr = ra * Math.sqrt(random()), kx = env.strength * 0.8 / FALL * h;
        spawnC = c; c.tries++;
        const x = R.px[g] + Math.cos(a) * rr - env.cur[0] * kx, z = R.pz[g] + Math.sin(a) * rr - env.cur[1] * kx;
        spawnX = D[0]; spawnZ = D[1]; spawnTop = Math.max(D[3], R.py[g] + h);
        spawnR = D[2] + 0.3 + 0.2 * c.size + env.strength * D[4];
        out[0] = x / U; out[1] = (R.py[g] + h) / U; out[2] = z / U;
        return out;
      }
      const a = random() * TAU, rr = D[2] * Math.sqrt(random());
      const x = D[0] + Math.cos(a) * rr, z = D[1] + Math.sin(a) * rr;
      let k = 0, y = D[3];
      for (const d of live) {
        if (d.sp.feed === 'plane') continue;
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
  // fitHard: the last false of fits() was a hard limit (the outline, the
  // plot, the rock), not the random thin-out of the soft edge.
  let fitHard = false;
  function fits(c, x, y, z) {
    const H = c.size * c.sp.tall, h = 0.5 * c.size;
    const dx = x - c.base[0], dy = y - c.base[1] - 0.4 * H, dz = z - c.base[2];
    const e = (dx * dx + dz * dz) / (h * h) + (dy * dy) / (0.36 * H * H);
    fitHard = true;
    if (e > 1) return false;
    if (e > 0.6 && random() > Math.pow((1 - e) / 0.4, 1.5)) { fitHard = false; return false; }
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
    let miss = 0;
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
          // apical species: the walker feeds a tip or a fork near it (apexPick)
          const tg = sp.apex ? apexPick(c, par, P) : par, fork = sp.apex ? apexFork : false;
          // no tip and no fork near: the walker goes on (it can still find
          // a tip); the third time the old tissue takes the food, no growth
          if (tg < 0 && ++miss > 2) { R.lost++; return -1; }
          if (tg < 0 || !(h.shouldJoin ? h.shouldJoin(R, P, tg) : dlafJoin(tg))) {
            m.lerpFrom(par, P, A + pr.minMoveDistance / U, P);
            continue;
          }
          if (sp.apex) apexPlace(c, tg, fork, P, QP); else m.lerpFrom(tg, P, pr.particleSpacing / U, QP);
          if (h.placeParticle) {
            h.placeParticle(R, P, tg, QP);
            // a hook that moved the particle past one spacing from its
            // parent (a tilted plate, a sponge wall): back to one spacing,
            // so the cones of a branch always touch
            const ps = pr.particleSpacing / U, o3 = tg * 3;
            const ex = QP[0] - m.pos[o3], ey = QP[1] - m.pos[o3 + 1], ez = QP[2] - m.pos[o3 + 2], el = Math.hypot(ex, ey, ez);
            if (el > ps * 1.02) { QP[0] = m.pos[o3] + ex / el * ps; QP[1] = m.pos[o3 + 1] + ey / el * ps; QP[2] = m.pos[o3 + 2] + ez / el * ps; }
          }
          fitHard = true;
          if (!outOfRock(QP, pr.particleSpacing * 0.3) || !fits(c, QP[0] * U, QP[1] * U, QP[2] * U)) {
            // a tip that cannot go on (rock, outline, plot) stops for good
            if (sp.apex && !fork && fitHard) R.dead[tg] = 1;
            R.lost++; return -1;
          }
          if (fork) R.forks++; else if (R.kids[tg] === 0) R.tipJoins++;
          return m.add(QP, tg);
        }
      }
      const x = P[0] * U, y = P[1] * U, z = P[2] * U;
      const dr = rockD.dist(x, y, z);
      if (dr < 0.003 * R.fine + 0.001) {
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
  // is shaded out, or overgrown by its neighbours. A colony past 60 % of its
  // cap whose join rate over the last WIN walkers is under SLOW x its best
  // rate (c.peak, per WIN walkers) stops too: it has filled its outline,
  // and more snow on it is mostly lost. (A branching colony feeds only at
  // its tips, so its join rate is low from the start: the test is against
  // its own best rate, not a fixed rate.)
  const STARVE = 6000, WIN = 1500, SLOW = 0.3;
  function starve() {
    for (const c of R.colonies) {
      if (c.full) continue;
      if (c.tries - c.lastTry > STARVE) { c.full = true; c.starved = true; liveAt = -1; continue; }
      if (c.tries - c.winT >= WIN) {
        const rate = (c.count - c.winN) / (c.tries - c.winT);
        if (c.count >= 0.6 * c.cap && rate < Math.max(0.004, SLOW * (c.peak || 0))) { c.full = true; c.filled = true; liveAt = -1; continue; }
        if (rate > (c.peak || 0)) c.peak = rate;
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
    R.colonies = []; R.contacts = new Map(); R.bridges = new Map(); R.count = 0; R.joined = 0; R.walks = 0; R.walkers = 0; R.lost = 0; R.forks = 0; R.tipJoins = 0; R.nets = 0;
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
// come in while the budget allows. Last, a held colony that the distance
// rule lets go, but that is small (under small x the budget), stays while
// the set fits over x the budget: a small colony at the edge of the
// budget does not go out and in again as the cameras move (each change
// meshes its fine field again). It never keeps a nearer new colony out.
// Returns the focus list (k).
export const FOCUS_HOLD = { keepK: 1.5, keepAdd: 3, holdMs: 8000, over: 1.25, small: 0.08 };
export function holdFocus(colonies, points, budgetTris, held, nowMs, o = FOCUS_HOLD) {
  if (!points || !points.length) return [...held.keys()];
  const dist = c => { let d = Infinity; for (const p of points) d = Math.min(d, Math.hypot(c.base[0] - p[0], c.base[1] - p[1], c.base[2] - p[2]) - c.size * 0.5); return d; };
  const est = c => Math.max(c.count || 0, (c.cap || 0) * 0.6) * SPECIES[c.id].tpp;
  const byK = new Map();
  for (const c of colonies) if (c) byK.set(c.k, c);
  const keep = [], spare = [];
  for (const [k, h] of held) {
    const c = byK.get(k); if (!c) continue;
    const d = dist(c);
    if (d <= Math.max(o.keepK * h.dIn, h.dIn + o.keepAdd) || nowMs - h.at < o.holdMs) keep.push({ c, d, h });
    else if (est(c) < (o.small || 0) * budgetTris) spare.push({ c, d, h });
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
  const spareK = new Set(spare.map(e => e.c.k));
  for (const c of byK.values()) if (!out.has(c.k) && !spareK.has(c.k)) cand.push({ c, d: dist(c) });
  cand.sort((a, b) => a.d - b.d);
  for (const e of cand) {
    const s = est(e.c);
    if (out.size && t + s > budgetTris) break;
    out.set(e.c.k, { at: nowMs, dIn: Math.max(0, e.d) }); t += s;
  }
  spare.sort((a, b) => a.d - b.d);
  for (const e of spare) {
    const s = est(e.c);
    if (t + s > budgetTris * o.over) break;
    out.set(e.c.k, e.h); t += s;
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
  return { k: c.k, id: c.id, base: c.base.slice(), normal: c.normal.slice(), plane: c.plane.slice(), size: c.size, cap: c.cap, stalk: c.stalk, tilt: c.tilt || 0, morph: c.morph || 0 };
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

// The colours of a colony: the species morph that its seed chose
// (colonyInfo morph; colour.js naturalRGB). Returns [base, tip].
export function colourMorph(sp, c) {
  const M = sp.morphs || [[sp.base, sp.tip]];
  return M[Math.min(M.length - 1, Math.max(0, (c && c.morph) | 0))];
}

// A shape descriptor of one colony (the species tests: no two species
// near-identical). aspect: height / width. tips: the share of particles
// with no child (open branch ends), forks: the share with two or more.
// planarity: the thickness across the colony plane / the width in it
// (0 for a flat fan). flat: height / horizontal span (a plate is low).
// hollow: the share of the particle mass far from the axis (a tube or a
// vase is high). spread: the mean distance from the base / the size.
export function silhouetteOf(R, c) {
  const b = c.base, f = c.plane, n = c.ids.length;
  let kids = new Map(), y1 = 0, a0 = Infinity, a1 = -Infinity, t0 = Infinity, t1 = -Infinity, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, sd = 0;
  for (const g of c.ids) { const p = R.parent[g]; if (p >= 0) kids.set(p, (kids.get(p) || 0) + 1); }
  let tips = 0, forks = 0;
  for (const g of c.ids) {
    const k = kids.get(g) || 0; if (!k) tips++; else if (k >= 2) forks++;
    const x = R.px[g] - b[0], y = R.py[g] - b[1], z = R.pz[g] - b[2];
    y1 = Math.max(y1, y);
    const along = -x * f[1] + z * f[0], across = x * f[0] + z * f[1];
    a0 = Math.min(a0, along); a1 = Math.max(a1, along); t0 = Math.min(t0, across); t1 = Math.max(t1, across);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    sd += Math.hypot(x, y, z);
  }
  const width = Math.max(x1 - x0, z1 - z0, 1e-6), inPlane = Math.max(a1 - a0, 1e-6);
  // hollow: particles in the outer 40 % of the radius at their height band
  const bands = 8, rmax = new Float64Array(bands);
  for (const g of c.ids) { const k = Math.min(bands - 1, Math.floor(bands * (R.py[g] - b[1]) / Math.max(1e-6, y1))); rmax[k] = Math.max(rmax[k], Math.hypot(R.px[g] - b[0], R.pz[g] - b[2])); }
  let outer = 0;
  for (const g of c.ids) { const k = Math.min(bands - 1, Math.floor(bands * (R.py[g] - b[1]) / Math.max(1e-6, y1))); if (Math.hypot(R.px[g] - b[0], R.pz[g] - b[2]) > 0.6 * rmax[k]) outer++; }
  let my = 0; for (const g of c.ids) my += R.py[g] - b[1];
  return { n, lift: my / n / Math.max(1e-6, y1), aspect: y1 / width, tips: tips / n, forks: forks / n, planarity: (t1 - t0) / inPlane, hollow: outer / n, spread: sd / n / Math.max(width, y1), width, height: y1 };
}
