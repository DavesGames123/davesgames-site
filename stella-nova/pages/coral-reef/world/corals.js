// ============================================================================
//  CORAL REEF  ·  world/corals.js  ·  the corals of one world chunk (DOM-free)
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "we shouldn't grow corals, they should just
//  grow once adn be there". A coral job grows ALL the colonies of a chunk
//  to their end (reef.js, the GROWTH package, through its exports only),
//  meshes them (coral-sdf.js) and gives back one finished result. The page
//  shows the corals of a chunk only from that result, in one frame, so no
//  colony shows half grown. The births do not matter any more: the page
//  writes a birth far in the past (BIRTH_PAST), so the shaders do no
//  grow-in.
//
//  FRAME. The colonies grow in chunk-local metres: x and z from the chunk
//  centre (cx, cz), y from oy (the middle of the chunk surface range), so
//  the cached fields of reef.js and the brick keys of coral-sdf.js stay
//  in range. world/field.js localRock gives the field in that frame.
//
//  SITES. Rays onto the rock of the chunk (from above and from the sides;
//  the method of rock/index.js sampleSurface): exposed rock above the
//  sand, not under a roof. The colony count comes from the habitat
//  (W.habitat: depth, rock or sand, a slow noise) and the profile budget.
//  Sites are taken in patches (farthest-point centres, then near seeds),
//  with a gap between colonies. A colony stays inside its chunk square
//  plus EDGE m, so two colonies of two chunks (grown apart) do not cross:
//  a site near the chunk edge gets a smaller colony.
//
//  API
//    chunkSites(W, ci, cj, n, rand) -> [{ p, n, exposure, overhang }] (world)
//    planColonies(W, ci, cj, budget, seed) -> { oy, sites: [{ id, site (local), size }] }
//    growChunk(W, ci, cj, budget, o) -> result (below); o.quality ('mid' |
//        'phone'), o.seed (world seed), o.slice (main thread: a generator
//        that yields between time slices)
//    meshCoarse(colonies, particles, bridges, Q) -> { sp: merged } per species
//    meshFine(colony, particles, bridges, Q) -> merged fine mesh + polyps of
//        one colony (meshed in colony metres, given back in the chunk frame)
//    result = { key, ci, cj, cx, cz, oy, colonies: [colonyInfo + count, top,
//        ext], count, particles (PARTICLE_FLOATS each), bridges (Int32 pairs),
//        coarse: { [sp]: { positions, normals, gids, indices, tris } },
//        stats: { growMs, meshMs, tris } }
//
//  grep -n targets: "export function chunkSites", "export function planColonies",
//  "export function growChunk", "export function meshCoarse",
//  "export function meshFine", "function merge("
// ============================================================================
import { createReef, colonyInfo, packParticles, PARTICLE_FLOATS, SPECIES, pickSpecies, QUALITY } from '../reef.js';
import { createCoralMesher } from '../coral-sdf.js';
import { mulberry32 } from '../rock/noise.js';
import { hash3 } from './field.js';
import { CH } from './mesh.js';

export const BIRTH_PAST = -1e5;     // s: the birth the page writes (uTime - birth >> grow-in)
export const EDGE = 1.5;            // m: a colony may reach this far past its chunk square
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// The coral budgets of a profile id (CONTRACT-V4.md table).
export const CORAL_BUDGET = {
  desktop: { colonies: 8, particles: 12000, quality: 'mid' },
  'laptop-low': { colonies: 6, particles: 8000, quality: 'phone' },
  phone: { colonies: 4, particles: 4500, quality: 'phone' },
  'phone-min': { colonies: 3, particles: 3000, quality: 'phone' },
};

// ── sites ───────────────────────────────────────────────────────────────────
export function chunkSites(W, ci, cj, n, rand) {
  const x0 = ci * CH, z0 = cj * CH, out = [];
  const sdf = W.sdf, LIP = W.lipschitz, ls = W.sdfScale;
  const dirs = [[0, 1, 0], [0.7, 0.7, 0], [-0.7, 0.7, 0], [0, 0.7, 0.7], [0, 0.7, -0.7]];
  for (let tries = 0; out.length < n && tries < n * 30; tries++) {
    const ox = x0 + rand() * CH, oz = z0 + rand() * CH, top = W.height(ox, oz) + 16;
    let dx, dy, dz, oy;
    if (rand() < 0.6) { oy = top; dx = (rand() - 0.5) * 0.7; dy = -1; dz = (rand() - 0.5) * 0.7; }
    else {
      const s = W.sandAt(ox, oz);
      oy = s + 0.5 + rand() * 6;
      if (sdf(ox, oy, oz) < 0.1) continue;
      const b = rand() * 6.283;
      dx = Math.cos(b); dy = (rand() - 0.5) * 0.6; dz = Math.sin(b);
    }
    const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
    let t = 0, hit = null;
    for (let i = 0; i < 260; i++) {
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      if (y < W.sandAt(x, z) || t > 40) break;
      const d = sdf(x, y, z);
      if (d < 2e-3) { hit = [x, y, z]; break; }
      t += Math.max(d / LIP, 0.005);
    }
    if (!hit) continue;
    let [x, y, z] = hit;
    if (x < x0 || x >= x0 + CH || z < z0 || z >= z0 + CH) continue;
    if (y < W.sandAt(x, z) + 0.1) continue;
    const nn = W.normal(x, y, z, 0.08);
    let open = 0;
    for (const dv of dirs) {
      let ax = dv[0] + nn[0], ay = dv[1] + nn[1], az = dv[2] + nn[2];
      const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
      if (sdf(x + ax * 1.5, y + ay * 1.5, z + az * 1.5) > 0.4 * ls && sdf(x + ax * 3.5, y + ay * 3.5, z + az * 3.5) > 0.6 * ls) open++;
    }
    open /= dirs.length;
    let roof = false;
    for (let h = 0.6; h < 5 && !roof; h += 0.5) if (sdf(x + nn[0] * 0.3, y + 0.3 * nn[1] + h, z + nn[2] * 0.3) < 0) roof = true;
    out.push({ p: [x, y, z], n: nn, exposure: open * (0.3 + 0.7 * Math.max(0, nn[1])), overhang: nn[1] < -0.25 || roof });
  }
  return out;
}

// ── the colony plan of a chunk ──────────────────────────────────────────────
// The local frame: x - cx, y - oy, z - cz.
export function planColonies(W, ci, cj, budget, seed) {
  const rand = mulberry32(hash3(ci, cj, seed ^ 0xc0a1) || 1);
  const cx = (ci + 0.5) * CH, cz = (cj + 0.5) * CH;
  let hab = 0;
  for (const [u, v] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75], [0.5, 0.5]]) hab += W.habitat(ci * CH + u * CH, cj * CH + v * CH) / 5;
  const want = clamp(Math.round(budget.colonies * hab * (0.75 + 0.5 * rand())), 0, budget.colonies);
  const res = { cx, cz, oy: 0, hab, want, sites: [] };
  if (!want) return res;
  const raw = chunkSites(W, ci, cj, want * 12, rand).filter(s => s.n[1] > -0.2 && !s.overhang);
  if (!raw.length) return res;
  let y0 = Infinity, y1 = -Infinity;
  for (const s of raw) { y0 = Math.min(y0, s.p[1]); y1 = Math.max(y1, s.p[1]); }
  res.oy = Math.round((y0 + y1) / 2);
  // patch centres by farthest-point sampling, then seeds near each centre
  const nPatch = Math.max(1, Math.min(raw.length, Math.round(want / 3)));
  const centres = [], dmin = new Float64Array(raw.length).fill(Infinity);
  let next = Math.floor(rand() * raw.length);
  while (centres.length < nPatch) {
    const c = raw[next].p; centres.push(c);
    let best = -1, bd = -1;
    for (let t = 0; t < raw.length; t++) { const d = Math.hypot(raw[t].p[0] - c[0], raw[t].p[2] - c[2]); if (d < dmin[t]) dmin[t] = d; if (dmin[t] > bd) { bd = dmin[t]; best = t; } }
    if (bd <= 0) break;
    next = best;
  }
  const chosen = [];
  const tryAdd = (s, gap) => {
    const y01 = (s.p[1] - y0) / Math.max(1e-6, y1 - y0);
    const id = pickSpecies(s, y01, rand(), {});
    if (!id) return false;
    const sp = SPECIES[id], ex = s.exposure ?? 0.5;
    let size = sp.size[0] + (sp.size[1] - sp.size[0]) * clamp(0.2 + 0.7 * ex + 0.35 * (rand() - 0.5), 0, 1);
    // stay in the chunk square (+ EDGE): a site near the edge gets a smaller colony
    const edge = Math.min(s.p[0] - ci * CH, (ci + 1) * CH - s.p[0], s.p[2] - cj * CH, (cj + 1) * CH - s.p[2]);
    size = Math.min(size, 2 * (edge + EDGE));
    if (size < sp.size[0] * 0.45) return false;
    for (const q of chosen) {
      const d = Math.hypot(q.p[0] - s.p[0], q.p[1] - s.p[1], q.p[2] - s.p[2]);
      if (d < gap * (q.size + size) * 0.5 + 0.3) return false;
    }
    chosen.push({ p: s.p, n: s.n, exposure: s.exposure, id, size });
    return true;
  };
  for (let pass = 0; pass < 3 && chosen.length < want; pass++) {
    const gap = 0.4 * (1 - pass * 0.2);
    for (const c of centres) {
      if (chosen.length >= want) break;
      const near = raw.filter(s => Math.hypot(s.p[0] - c[0], s.p[2] - c[2]) < 8);
      for (const s of near) if (tryAdd(s, gap)) break;
    }
  }
  for (let t = 0; t < raw.length && chosen.length < want; t++) tryAdd(raw[t], 0.3);
  res.sites = chosen.map(q => ({ id: q.id, size: q.size, site: { p: [q.p[0] - cx, q.p[1] - res.oy, q.p[2] - cz], n: q.n, exposure: q.exposure } }));
  return res;
}

// ── merge bricks into one array set per key ─────────────────────────────────
function merge(list, withPolyps) {
  let nv = 0, ni = 0, np = 0;
  for (const b of list) { nv += b.positions.length / 3; ni += b.indices.length; np += withPolyps && b.polyps ? b.polyps.length : 0; }
  if (!nv) return null;
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), G = new Float32Array(nv), I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const PP = withPolyps ? new Float32Array(np) : null;
  let ov = 0, oi = 0, op = 0;
  for (const b of list) {
    P.set(b.positions, ov * 3); N.set(b.normals, ov * 3); G.set(b.gids, ov);
    for (let i = 0; i < b.indices.length; i++) I[oi + i] = b.indices[i] + ov;
    ov += b.positions.length / 3; oi += b.indices.length;
    if (PP && b.polyps) { PP.set(b.polyps, op); op += b.polyps.length; }
  }
  return { positions: P, normals: N, gids: G, indices: I, polyps: PP, tris: ni / 3 };
}

// colony list items: { k, id, base, plane, stalk, ... }; particles:
// PARTICLE_FLOATS per particle (packParticles); bridges: Int32 pairs g, j.
export function meshCoarse(colonies, particles, bridges, Q) {
  const M = createCoralMesher({ polyps: Q.polyps, fine: Q.fine, radius: 44, lod: true });
  for (const c of colonies) M.addColony(c);
  const n = particles.length / PARTICLE_FLOATS;
  for (let g = 0; g < n; g++) { const o = g * PARTICLE_FLOATS; M.add(g, particles[o + 4], particles[o], particles[o + 1], particles[o + 2], particles[o + 3]); }
  if (bridges) for (let q = 0; q < bridges.length; q += 2) M.bridge(bridges[q], bridges[q + 1]);
  const by = {};
  for (const b of M.meshAll(1)) if (b.indices && b.indices.length) (by[b.sp] || (by[b.sp] = [])).push(b);
  const out = {};
  for (const sp of Object.keys(by)) out[sp] = merge(by[sp], false);
  return out;
}

// One colony (k) in its own frame (metres from colony.base): the fine
// SDF mesh (coral-sdf.js lod: false) and its polyps. gids are the chunk
// particle ids (g), so the page reads the same data texels.
export function meshFine(colony, particles, bridges, Q) {
  const n = particles.length / PARTICLE_FLOATS, ids = [], local = new Map();
  for (let g = 0; g < n; g++) if (particles[g * PARTICLE_FLOATS + 3] === colony.k) { local.set(g, ids.length); ids.push(g); }
  if (!ids.length) return null;
  const b = colony.base;
  const M = createCoralMesher({ polyps: Q.polyps, fine: Q.fine, radius: Math.max(4, colony.size * 1.2), lod: false });
  M.addColony({ k: 0, id: colony.id, base: [0, 0, 0], plane: colony.plane, stalk: colony.stalk });
  for (let q = 0; q < ids.length; q++) {
    const o = ids[q] * PARTICLE_FLOATS, par = particles[o + 4];
    M.add(q, par >= 0 && local.has(par) ? local.get(par) : -1, particles[o] - b[0], particles[o + 1] - b[1], particles[o + 2] - b[2], 0);
  }
  if (bridges) for (let q = 0; q < bridges.length; q += 2) { const g = local.get(bridges[q]), j = local.get(bridges[q + 1]); if (g !== undefined && j !== undefined) M.bridge(g, j); }
  const list = M.meshAll().filter(r => r.indices && r.indices.length);
  const m = merge(list, true);
  if (!m) return null;
  // back to chunk particle ids, and to the chunk frame (the coarse mesh and
  // the fine mesh then have the same local positions: the surface detail
  // of shaders.js, which reads the mesh position, does not jump at a swap)
  for (let v = 0; v < m.gids.length; v++) m.gids[v] = m.gids[v] >= 0 ? ids[m.gids[v]] : -1;
  for (let p = 6; p < m.polyps.length; p += 8) m.polyps[p] = ids[m.polyps[p]] ?? 0;
  for (let v = 0; v < m.positions.length; v += 3) { m.positions[v] += b[0]; m.positions[v + 1] += b[1]; m.positions[v + 2] += b[2]; }
  for (let p = 0; p < m.polyps.length; p += 8) { m.polyps[p] += b[0]; m.polyps[p + 1] += b[1]; m.polyps[p + 2] += b[2]; }
  m.k = colony.k; m.sp = colony.id; m.polypN = m.polyps.length / 8;
  return m;
}

// ── a chunk job ─────────────────────────────────────────────────────────────
// o.slice: an object { budgetMs, wait() } for the main thread: the growth
// then runs in slices of budgetMs (R.step), and growChunk is async.
export function growChunkSync(W, ci, cj, budget, o = {}) {
  const it = growSteps(W, ci, cj, budget, o);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}
export async function growChunkAsync(W, ci, cj, budget, o = {}) {
  const it = growSteps(W, ci, cj, budget, o);
  let r = it.next();
  while (!r.done) { await o.wait(); r = it.next(); }
  return r.value;
}
function* growSteps(W, ci, cj, budget, o) {
  const t0 = now();
  const seed = o.seed ?? W.seed ?? 1;
  const plan = planColonies(W, ci, cj, budget, seed);
  const key = `${ci},${cj}`;
  const empty = { key, ci, cj, cx: plan.cx, cz: plan.cz, oy: plan.oy, colonies: [], count: 0, particles: new Float32Array(0), bridges: new Int32Array(0), coarse: {}, stats: { growMs: 0, meshMs: 0, tris: 0, hab: plan.hab, want: plan.want } };
  if (!plan.sites.length) return empty;
  const quality = budget.quality || o.quality || 'mid';
  const Q = Object.assign({}, QUALITY[quality] || QUALITY.mid);
  const rock = W.localRock(plan.cx, plan.oy, plan.cz, { half: CH / 2 + 8 });
  const R = createReef({ rock, seed: hash3(ci, cj, seed ^ 0x5eed), quality, radius: 1e4, budget: { particles: budget.particles, colonies: budget.colonies } });
  // the current of the chunk: a slow field over the world (the fans face it)
  const cur = Math.atan2(W.height(plan.cx + 200, plan.cz) - W.height(plan.cx - 200, plan.cz), 1) * 57.3 * 4 + 20 + 160 * Math.sin(plan.cx / 3000 + plan.cz / 4100);
  R.setCurrent(cur, 0.5);
  for (const s of plan.sites) R.addColony(s.id, s.site, { size: s.size });
  // caps in the particle budget (each colony keeps at least 25 % of its wish)
  let sum = 0;
  for (const c of R.colonies) sum += c.cap;
  const k = Math.min(1, (R.limit - R.colonies.length) / Math.max(1, sum));
  for (const c of R.colonies) c.cap = Math.max(20, Math.max(Math.round(c.cap * 0.25), Math.floor(c.cap * k)));
  if (o.slice) { R.setRate(Infinity); while (!R.done()) { const before = R.count; R.step(16, o.slice.budgetMs || 6, 0); if (R.count === before && R.progress().live === 0) break; yield; } }
  else R.growAll();
  const growMs = now() - t0;
  const t1 = now();
  const colonies = R.colonies.map(c => Object.assign(colonyInfo(c), { count: c.count, top: c.top, ext: c.ext }));
  const particles = packParticles(R, 0, R.count);
  const br = [];
  for (const [g, j] of R.bridges) br.push(g, j);
  const bridges = Int32Array.from(br);
  if (o.slice) yield;
  const coarse = meshCoarse(colonies, particles, bridges, Q);
  let tris = 0;
  for (const sp of Object.keys(coarse)) tris += coarse[sp].tris;
  return { key, ci, cj, cx: plan.cx, cz: plan.cz, oy: plan.oy, colonies, count: R.count, particles, bridges, coarse, quality,
    stats: { growMs, meshMs: now() - t1, tris, hab: plan.hab, want: plan.want } };
}
export const growChunk = growChunkSync;

// The transferable buffers of a result (worker postMessage).
export function transfers(r) {
  const out = [];
  const add = a => { if (a && a.buffer && !out.includes(a.buffer)) out.push(a.buffer); };
  if (!r) return out;
  add(r.particles); add(r.bridges);
  if (r.coarse) for (const m of Object.values(r.coarse)) if (m) { add(m.positions); add(m.normals); add(m.gids); add(m.indices); }
  for (const k of ['positions', 'normals', 'gids', 'indices', 'polyps', 'cavity', 'band']) add(r[k]);
  return out;
}
