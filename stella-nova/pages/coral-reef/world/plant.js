// ============================================================================
//  CORAL REEF  ·  world/plant.js  ·  plant mode: a click plants a colony (DOM-free)
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "ok my girlfriend really liked when we could
//  plant corals by clicking can we bring that back to the ROV section?"
//  In plant mode a click or a tap on the rock or the sand of the main view
//  plants one colony of the chosen species (or a random one) there.
//
//  FLOW
//    tap ...... createPlanter(o).tap(cx, cy, kind): only in plant mode and
//               only for a single tap. o.ray(cx, cy) gives the eye ray in
//               world metres; rayHit marches it on the solid (W.sdfAll:
//               rock and sand, no coral) to the first hit.
//    record ... plantRecord: { uid, p (world m), n, id, size, cap, seed }.
//               The size fills the particle cap of the profile; a site
//               near the chunk edge gets a smaller colony (corals.js EDGE).
//    grow ..... world/stream.js plant(rec): the chunk of p must show its
//               corals. A 'plant' job (world/worker.js) grows the colony
//               alone on the chunk rock, puts it after the chunk particles
//               and meshes the chunk again with fuse (world/corals.js
//               plantChunk). The page shows the new chunk mesh in one frame
//               and writes plantBirths: the particles of the new colony
//               get births over GROW_S s in join order, so it grows from
//               its root up (shaders.js hides a particle before its birth).
//               After that it is locked: no job grows it again.
//    keep ..... the streamer keeps the records for the session (world
//               metres, so a floating-origin shift does not move them).
//               A chunk that loads again grows its plants in the coral job
//               (no grow-in: they are just there), the same colony.
//    caps ..... PLANT_BUDGET per profile: max records (the oldest goes
//               first), particles per colony, and the reserve of each data
//               slab (a chunk that is full drops its oldest plant).
//
//  API
//    PLANT_BUDGET[profile] = { max, particles, reserve }
//    GROW_S                    s of the visible growth
//    rayHit(sdf, o, d, opt) -> { p, t } | null   (world metres)
//    solidNormal(sdf, p) -> [x, y, z]
//    pickPlantSpecies(choice, u) -> species id ('random': from u in 0..1)
//    plantSize(id, cap, quality) -> m (the size whose cap fills cap)
//    plantRecord({ p, n, id, B, uid, seed }) -> record
//    plantBirths(co, n, t0) -> Float32Array(n) | null (co.grow ranges)
//    createPlanter({ on, species, ray, field, streamer, rand }) -> { tap }
//
//  grep -n targets: "export const PLANT_BUDGET", "export function rayHit",
//  "export function plantRecord", "export function plantBirths",
//  "export function createPlanter"
// ============================================================================
import { SPECIES, SPECIES_IDS, QUALITY } from '../reef.js';
import { BIRTH_PAST, EDGE } from './corals.js';
import { CH } from './mesh.js';

// The budget of planted colonies per device profile (the slab reserve is
// in the data textures: world/stream.js slabOf, worldEstimate).
export const PLANT_BUDGET = {
  desktop: { max: 40, particles: 1600, reserve: 6400 },
  'laptop-low': { max: 24, particles: 1100, reserve: 4400 },
  phone: { max: 12, particles: 700, reserve: 2800 },
  'phone-min': { max: 8, particles: 500, reserve: 2000 },
};
export const GROW_S = 5;           // s from the root to the last tip

// The first hit of the ray o + t d (d unit) on the solid. sdf: a bound
// (world/field.js sdfAll), so a step of sdf / lip never passes the surface.
export function rayHit(sdf, o, d, opt = {}) {
  const lip = opt.lip || 1, maxT = opt.maxT ?? 140, eps = opt.eps ?? 2e-3, steps = opt.steps ?? 900;
  let t = opt.t0 ?? 0;
  for (let i = 0; i < steps && t < maxT; i++) {
    const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t;
    const s = sdf(x, y, z);
    if (s < eps) return { p: [x, y, z], t };
    t += Math.max(s / lip, 0.01);
  }
  return null;
}
export function solidNormal(sdf, p, e = 0.05) {
  const [x, y, z] = p;
  const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
  const l = Math.hypot(gx, gy, gz);
  return l > 1e-9 ? [gx / l, gy / l, gz / l] : [0, 1, 0];
}

export function pickPlantSpecies(choice, u = Math.random()) {
  if (choice && choice !== 'random' && SPECIES[choice]) return choice;
  return SPECIES_IDS[Math.min(SPECIES_IDS.length - 1, Math.floor(u * SPECIES_IDS.length))];
}
// The size (m) of a colony that fills cap particles (reef.js capFor
// backwards), in the size range of the species.
export function plantSize(id, cap, quality = 'mid') {
  const sp = SPECIES[id], fine = (QUALITY[quality] || QUALITY.mid).fine;
  const s = sp.params.particleSpacing * fine;
  const size = s * Math.pow(cap / Math.max(1e-6, sp.fill), 1 / sp.dim);
  return Math.min(sp.size[1], Math.max(sp.size[0], size));
}
let uidN = 1;
export function plantRecord({ p, n, id, B, uid = uidN++, seed }) {
  const pb = B.plant || PLANT_BUDGET.desktop, quality = (B.coral && B.coral.quality) || 'mid';
  const ci = Math.floor(p[0] / CH), cj = Math.floor(p[2] / CH);
  const edge = Math.min(p[0] - ci * CH, (ci + 1) * CH - p[0], p[2] - cj * CH, (cj + 1) * CH - p[2]);
  const sp = SPECIES[id];
  const size = Math.max(sp.size[0] * 0.4, Math.min(plantSize(id, pb.particles, quality), 2 * (edge + EDGE)));
  const h = Math.imul(Math.round(p[0] * 97) ^ Math.imul(Math.round(p[2] * 89), 0x9e3779b1) ^ Math.imul(uid, 0x85ebca6b), 0x2c1b3c6d) >>> 0;
  return { uid, p: p.slice(), n: (n || [0, 1, 0]).slice(), id, size, cap: pb.particles, seed: seed ?? (h || 1), key: `${ci},${cj}` };
}

// The births of a chunk result with co.grow = [{ from, to }] (a colony
// that grows in now): BIRTH_PAST for the others; t0 + GROW_S x (index in
// the colony / count) for the new ones, in join order (root first).
export function plantBirths(co, n, t0, dur = GROW_S) {
  if (!co.grow || !co.grow.length) return null;
  const b = new Float32Array(Math.max(1, n)).fill(BIRTH_PAST);
  for (const r of co.grow) {
    const m = Math.max(1, r.to - r.from);
    for (let g = r.from; g < r.to && g < n; g++) b[g] = t0 + 0.15 + dur * (g - r.from) / m;
  }
  return b;
}

// The tap rule of the page. on(): plant mode; species(): the choice;
// ray(cx, cy) -> { o, d } world metres (null: no camera); field(): the
// world field (sdfAll, lipschitz); streamer(): world/stream.js.
// tap -> null (not plant mode or not a single tap: the click keeps its
// old meaning) or { ok, why, rec, p }.
export function createPlanter(o) {
  const rand = o.rand || Math.random;
  function tap(cx, cy, kind = 'tap') {
    if (!o.on() || kind !== 'tap') return null;
    const W = o.field(), st = o.streamer(), ray = o.ray(cx, cy);
    if (!W || !st || !ray) return { ok: false, why: 'The seafloor is not there yet.' };
    const hit = rayHit(W.sdfAll, ray.o, ray.d, { lip: W.lipschitz, maxT: o.maxT ?? 140 });
    if (!hit) return { ok: false, why: 'Tap the rock or the sand, not the open water.' };
    const id = pickPlantSpecies(o.species(), rand());
    const r = st.plant({ p: hit.p, n: solidNormal(W.sdfAll, hit.p), id });
    return Object.assign({ p: hit.p, id }, r);
  }
  return { tap };
}
