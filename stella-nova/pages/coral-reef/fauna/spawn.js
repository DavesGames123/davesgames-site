// ============================================================================
//  CORAL REEF  ·  fauna/spawn.js  ·  the animals of one world chunk
// ----------------------------------------------------------------------------
//  DOM-free and deterministic: the same seed and chunk give the same
//  animals in node and on the page (tests/fauna.test.mjs).
//
//    spawnChunk({ W, seed, i, j, budget, sdf }) -> {
//      key, i, j, depth, region, count, grid ({ h, sand, x0, z0 }: the ground
//      on a 2 m grid; gridFrom(grid) gives its accessors),
//      groups: [{ sp (species object), feature (id | null), centre [x, y, z],
//                 members: [{ x, y, z, yaw, size }] }] }
//    spawnColony({ W, seed, colony, budget }) -> groups on and round one
//      coral colony (the 'coral' place: basket stars and brittle stars on
//      the colony, damselfish round it; crabs, lobsters or sea stars at its
//      base)
//    poolAt(seed, x, z, depth) -> the species alive at that depth there
//      (the real ones and the generated ones of the province)
//
//  RULES
//    - an animal is only put where its depth range holds: the ground depth
//      for the benthic ones, the depth of the animal for the swimmers
//    - a swimmer keeps clear of the rock (sdf >= CLEAR m) or is not put
//    - features (FEATURES of species.js) come first, then the background
//      groups; the count is capped by budget.maxPerChunk
//    - richness grows with depth (BASE groups per chunk), as the user asked
//  W: world/field.js (ground, sdfAll, normal, sandAt, habitat, surfaceY).
//  sdf (optional): the solid with the coral (world/physics.js P.sdf in field
//  units), else W.sdfAll.
//
//  grep -n targets: "export function spawnChunk", "export function spawnColony",
//  "export function poolAt", "const BASE"
// ============================================================================
import { SPECIES, SPECIES_BY_ID, FEATURES, PROVINCE, generatedSpecies, regionOfDepth, hashInts } from './species.js';

export const FAUNA_CH = 32;                 // = world/mesh.js CH (tests check it)
export const CLEAR = 0.6;                   // m, swimmers keep this from the rock
const BASE = { shallows: 5, reef: 7, twilight: 8, abyss: 9 };   // background groups per chunk
const SURF = 55;

export function rngOf(seed) { let a = seed >>> 0 || 1; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const inDepth = (sp, d) => d >= sp.depth[0] && d <= sp.depth[1];

// generated species cache: province key -> list (deterministic, so a cache is safe)
const genCache = new Map();
function genPool(seed, x, z, region) {
  const px = Math.floor(x / PROVINCE), pz = Math.floor(z / PROVINCE), k = `${seed}|${px}|${pz}|${region}`;
  let l = genCache.get(k);
  if (!l) { l = generatedSpecies(seed, px, pz, region); genCache.set(k, l); if (genCache.size > 64) genCache.delete(genCache.keys().next().value); }
  return l;
}
export function poolAt(seed, x, z, depth) {
  const reg = regionOfDepth(depth);
  const gen = genPool(seed, x, z, reg).filter(s => inDepth(s, depth));
  return [...SPECIES.filter(s => inDepth(s, depth)), ...gen];
}
export function speciesById(seed, id, x, z) {
  if (SPECIES_BY_ID.has(id)) return SPECIES_BY_ID.get(id);
  return null;
}

function weighted(R, list) {
  let t = 0; for (const s of list) t += s.w || 1;
  let r = R() * t;
  for (const s of list) { r -= s.w || 1; if (r <= 0) return s; }
  return list[list.length - 1];
}
const ri = (R, [a, b]) => a + Math.floor(R() * (b - a + 1));

// The ground of a chunk on a 2 m grid (W.ground costs a column of noise):
// spawnChunk reads heights with a bilinear blend. 17 x 17 samples. "Sand"
// is the flat ground (slope under 0.3): W.sandAt costs about 1 ms a call.
const GN = 17, GS = FAUNA_CH / (GN - 1);
export function groundGrid(W, x0, z0) {
  const h = new Float32Array(GN * GN), sand = new Uint8Array(GN * GN);
  for (let b = 0; b < GN; b++) for (let a = 0; a < GN; a++) {
    const x = x0 + a * GS, z = z0 + b * GS, gy = W.ground(x, z);
    h[b * GN + a] = gy;
  }
  for (let b = 0; b < GN; b++) for (let a = 0; a < GN; a++) {
    const k = b * GN + a, dx = h[b * GN + Math.min(GN - 1, a + 1)] - h[b * GN + Math.max(0, a - 1)], dz = h[Math.min(GN - 1, b + 1) * GN + a] - h[Math.max(0, b - 1) * GN + a];
    sand[k] = Math.hypot(dx, dz) / (2 * GS) < 0.3 ? 1 : 0;
  }
  return gridFrom({ h, sand, x0, z0 });
}
// The accessors of a ground grid ({ h, sand, x0, z0 }, also after a worker
// posted it): ground(x, z) bilinear, isSand(x, z) nearest.
export function gridFrom(G) {
  const { h, sand, x0, z0 } = G;
  const at = (x, z) => {
    const u = Math.min(GN - 1.001, Math.max(0, (x - x0) / GS)), v = Math.min(GN - 1.001, Math.max(0, (z - z0) / GS));
    const a = Math.floor(u), b = Math.floor(v), fu = u - a, fv = v - b, k = b * GN + a;
    return (h[k] * (1 - fu) + h[k + 1] * fu) * (1 - fv) + (h[k + GN] * (1 - fu) + h[k + GN + 1] * fu) * fv;
  };
  const isSand = (x, z) => { const a = Math.round(Math.min(GN - 1, Math.max(0, (x - x0) / GS))), b = Math.round(Math.min(GN - 1, Math.max(0, (z - z0) / GS))); return sand[b * GN + a] === 1; };
  return { ground: at, isSand, x0, z0, h, sand };
}

function placeMember(W, sdf, sp, R, cx, cz, spread, opt = {}) {
  const sY = W.surfaceY ?? SURF, GR = opt.grid;
  const ground = GR ? (x, z) => (x >= GR.x0 && x <= GR.x0 + FAUNA_CH && z >= GR.z0 && z <= GR.z0 + FAUNA_CH ? GR.ground(x, z) : W.ground(x, z)) : W.ground;
  for (let tries = 0; tries < 6; tries++) {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * spread;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const gy = ground(x, z), gd = sY - gy;
    const size = sp.size[0] + (sp.size[1] - sp.size[0]) * R(), yaw = R() * Math.PI * 2;
    const benthic = sp.habit === 'crawl' || sp.habit === 'still';
    if (benthic) {
      if (!inDepth(sp, gd)) continue;
      if (sp.place === 'sand' && GR && !GR.isSand(x, z)) continue;
      return { x, y: gy, z, yaw, size };
    }
    // a swimmer: an altitude over the ground, inside its depth, clear of rock
    const alt = sp.alt || [1, 6];
    let y = gy + alt[0] + (alt[1] - alt[0]) * (opt.altK ?? R());
    const yTop = sY - sp.depth[0], yBot = sY - sp.depth[1];
    if (y > yTop) y = yTop - 0.2;
    if (y < yBot) y = yBot + 0.2;
    if (y > sY - 0.5 || y < gy + 0.2) continue;
    const d = sdf(x, y, z);
    if (d < CLEAR) continue;
    return { x, y, z, yaw, size };
  }
  return null;
}

function addGroup(out, W, sdf, sp, R, cx, cz, count, feature, budgetLeft, grid) {
  const n = Math.min(count, budgetLeft);
  if (n <= 0) return 0;
  const spread = sp.habit === 'school' ? 3 + Math.sqrt(n) * 0.6 : sp.habit === 'still' && feature ? 7 : feature ? 9 : 4;
  const members = [];
  // a school shares one altitude band, so it forms a layer, not a column
  const altK = R();
  for (let k = 0; k < n; k++) {
    const m = placeMember(W, sdf, sp, R, cx, cz, spread, sp.habit === 'school' ? { grid, altK: Math.min(1, Math.max(0, altK + (R() - 0.5) * 0.25)) } : { grid });
    if (m) members.push(m);
  }
  if (!members.length) return 0;
  const c = [0, 0, 0]; for (const m of members) { c[0] += m.x; c[1] += m.y; c[2] += m.z; }
  out.push({ sp, feature, centre: c.map(v => v / members.length), members });
  return members.length;
}

export function spawnChunk({ W, seed = 1, i, j, budget, sdf = null }) {
  const S = sdf ? (x, y, z) => sdf(x, y, z) / (W.sdfScale || 0.4) : (x, y, z) => W.sdfAll(x, y, z) / (W.sdfScale || 0.4);
  const R = rngOf(hashInts(seed, i, j, 0xFA05));
  const x0 = i * FAUNA_CH, z0 = j * FAUNA_CH, cx = x0 + FAUNA_CH / 2, cz = z0 + FAUNA_CH / 2;
  const sY = W.surfaceY ?? SURF;
  const GR = groundGrid(W, x0, z0);
  const depth = sY - GR.ground(cx, cz), region = regionOfDepth(depth);
  const out = [];
  let left = budget.maxPerChunk;
  const K = budget.groupK ?? 1;
  // features first (their members may be generated families)
  for (const f of FEATURES) {
    if (depth < f.depth[0] || depth > f.depth[1]) continue;
    if (R() >= f.chance) continue;
    const fx = x0 + 6 + R() * (FAUNA_CH - 12), fz = z0 + 6 + R() * (FAUNA_CH - 12);
    const pool = poolAt(seed, fx, fz, depth);
    if (f.landmark) { const lm = SPECIES_BY_ID.get(f.landmark); if (lm && inDepth(lm, depth)) left -= addGroup(out, W, S, lm, R, fx, fz, 1, f.id, left, GR); }
    for (const [id, cnt] of f.members) {
      let sp = null;
      if (id.startsWith('generated:')) { const fam = id.slice(10); const c = pool.filter(s => s.src === 'generated' && s.family === fam); sp = c.length ? c[Math.floor(R() * c.length)] : null; }
      else sp = SPECIES_BY_ID.get(id);
      if (!sp || !inDepth(sp, depth)) continue;
      const n = Math.max(1, Math.round(ri(R, cnt) * K));
      left -= addGroup(out, W, S, sp, R, fx + (R() - 0.5) * 6, fz + (R() - 0.5) * 6, n, f.id, left, GR);
    }
  }
  // background groups
  const nG = Math.max(1, Math.round((BASE[region] || 5) * (0.5 + 0.5 * K)));
  for (let k = 0; k < nG && left > 0; k++) {
    const sx = x0 + R() * FAUNA_CH, sz = z0 + R() * FAUNA_CH, d = sY - GR.ground(sx, sz);
    const pool = poolAt(seed, sx, sz, d).filter(s => s.place !== 'vent' && s.place !== 'fall' && (s.w || 0) > 0);
    if (!pool.length) continue;
    const sp = weighted(R, pool);
    const n = Math.max(1, Math.round(ri(R, sp.group || [1, 1]) * (sp.habit === 'school' || (sp.group && sp.group[1] > 4) ? K : 1)));
    left -= addGroup(out, W, S, sp, R, sx, sz, n, null, left, GR);
  }
  let count = 0; for (const gr of out) count += gr.members.length;
  return { key: `${i},${j}`, i, j, depth, region, groups: out, count, grid: { h: GR.h, sand: GR.sand, x0, z0 } };
}

// Dwellers of one coral colony (the 'coral' place): on the colony (basket
// stars, brittle stars, coral scale worms) and round it (damselfish).
export function spawnColony({ W, seed = 1, colony, budget }) {
  const c = colony.center || colony.base, top = colony.top ?? c[1] + (colony.size || 2);
  const R = rngOf(hashInts(seed, Math.round(c[0] * 10), Math.round(c[2] * 10), 0xC0A1));
  const sY = W.surfaceY ?? SURF, depth = sY - (colony.base ? colony.base[1] : c[1]);
  const pool = poolAt(seed, c[0], c[2], depth).filter(s => s.place === 'coral');
  const out = [];
  if (!pool.length || R() > 0.75) return out;
  const K = budget.groupK ?? 1, rad = Math.max(0.6, colony.radius || 1.5);
  for (let k = 0; k < 2 && pool.length; k++) {
    const sp = weighted(R, pool), benthic = sp.habit !== 'school' && sp.habit !== 'swim' && sp.habit !== 'hover';
    const n = Math.max(1, Math.round(ri(R, sp.group || [1, 2]) * (benthic ? 1 : K)));
    const members = [];
    for (let m = 0; m < n; m++) {
      const a = R() * Math.PI * 2, size = sp.size[0] + (sp.size[1] - sp.size[0]) * R();
      if (benthic) {
        // on the colony: high on its crown (the fan edge is the best feeding place)
        const y = top - R() * (top - c[1]) * 0.4, r = rad * (0.3 + 0.6 * R());
        const p = { x: c[0] + Math.cos(a) * r, y, z: c[2] + Math.sin(a) * r, yaw: R() * Math.PI * 2, size, onCoral: true };
        if (inDepth(sp, sY - p.y)) members.push(p);
      } else {
        const r = rad * (0.8 + R()), y = c[1] + (top - c[1]) * (0.3 + R() * 0.9);
        const p = { x: c[0] + Math.cos(a) * r, y, z: c[2] + Math.sin(a) * r, yaw: a, size };
        if (inDepth(sp, sY - p.y) && W.sdfAll(p.x, p.y, p.z) / (W.sdfScale || 0.4) > CLEAR) members.push(p);
      }
    }
    if (members.length) out.push({ sp, feature: 'colony', centre: [c[0], (c[1] + top) / 2, c[2]], members });
  }
  // crabs, lobsters or sea stars at the base of the colony
  const basePool = poolAt(seed, c[0], c[2], depth).filter(s => (s.family === 'crab' || s.family === 'squat lobster' || s.family === 'lobster' || s.family === 'sea star') && s.habit === 'crawl');
  if (basePool.length && R() < 0.7) {
    const sp = weighted(R, basePool), members = [];
    for (let m = 0, n = 1 + Math.floor(R() * 3); m < n; m++) {
      const a = R() * Math.PI * 2, r = rad * (0.9 + 0.5 * R()), x = c[0] + Math.cos(a) * r, z = c[2] + Math.sin(a) * r, gy = W.ground(x, z);
      if (inDepth(sp, sY - gy)) members.push({ x, y: gy, z, yaw: a + Math.PI, size: sp.size[0] + (sp.size[1] - sp.size[0]) * R() });
    }
    if (members.length) out.push({ sp, feature: 'colony-base', centre: [c[0], W.ground(c[0], c[2]), c[2]], members });
  }
  return out;
}
