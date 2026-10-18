// ============================================================================
//  CORAL REEF  ·  tests/fauna.test.mjs  ·  the creatures (node, no browser)
//    node tests/fauna.test.mjs [--quick]
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "let's get a vast assortment of creatures
//  from real biological archives". Checks of fauna/ and assets/fauna/:
//    licences ...... every file in assets/fauna/ has a manifest entry with
//                    an allowed licence (no NC, no ND, no unknown), a source
//                    URL, an author and the scientific name; every scan of
//                    species.js has its files
//    sizes ......... the asset bytes in total and per profile (the files a
//                    profile fetches) are in budget
//    GLB ........... every GLB parses with lib/glb-lite.js (the page parser):
//                    triangles in budget, finite positions, the unit box,
//                    UVs when there is a texture
//    species ....... at least 40 real species (scans and procedural), ids
//                    unique, each with a WoRMS AphiaID, a depth and its
//                    reference; every generator gives a valid mesh
//    depth ......... no spawned animal is outside its depth range (60
//                    chunks over all regions, 2 seeds)
//    richness ...... the species pool and the features grow with depth
//    determinism ... one seed and chunk give the same animals; a new seed
//                    gives new ones
//    rock .......... no swimmer is ever inside the rock (the solid sdf)
//                    over a long run near rough ground
//    budgets ....... per profile: animals per chunk and in total
//    memory ........ createFauna (three, no GL) on a 1.2 km flight: the
//                    agents and the GPU bytes return after the unloads
//    lookAt ........ the HUD finds the animal on a view ray
//    shaders ....... naga reads the fauna programs (glsl-check.mjs)
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, ALLOWED_LICENCES } from '../fauna/sources.js';
import { SPECIES, FEATURES, REGIONS, generatedSpecies, ANIM } from '../fauna/species.js';
import { spawnChunk, spawnColony, poolAt, FAUNA_CH, CLEAR, gridFrom } from '../fauna/spawn.js';
import { createSim } from '../fauna/sim.js';
import { genModel } from '../fauna/models.js';
import { FAUNA_BUDGET } from '../fauna/budget.js';
import { createWorld } from '../world/field.js';
import { CH } from '../world/mesh.js';
import { parseGLB } from '../../../lib/glb-lite.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const A = path.join(HERE, '..', 'assets', 'fauna');
const QUICK = process.argv.includes('--quick');
let pass = 0, fail = 0;
function ok(c, name, info = '') { if (c) { pass++; console.log(`ok   ${name}${info !== '' ? '  ' + info : ''}`); } else { fail++; console.log(`FAIL ${name}${info !== '' ? '  ' + info : ''}`); } }
const MB = 1048576;

// ── licences and the manifest ────────────────────────────────────────────────
const manifest = JSON.parse(fs.readFileSync(path.join(A, 'manifest.json'), 'utf8'));
{
  const listed = new Map();
  for (const m of manifest.models) for (const f of m.files) listed.set(f.path, m);
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.relative(A, path.join(d, e.name))]));
  const files = walk(A).filter(f => !['manifest.json', 'CREDITS.txt'].includes(f) && !f.endsWith('.DS_Store'));
  const unlisted = files.filter(f => !listed.has(f));
  ok(unlisted.length === 0, 'every asset file has a manifest entry', unlisted.slice(0, 5).join(', '));
  const missing = [...listed.keys()].filter(f => !fs.existsSync(path.join(A, f)));
  ok(missing.length === 0, 'every manifest file exists', missing.slice(0, 5).join(', '));
  const badLic = manifest.models.filter(m => !ALLOWED_LICENCES.includes(m.licence) || /NC|ND/i.test(m.licence));
  ok(badLic.length === 0, 'licences are allowed (no NC, no ND, no unknown)', badLic.map(m => m.id + ':' + m.licence).join(', '));
  const badMeta = manifest.models.filter(m => !m.sci || !m.url || !m.author || !m.archive || !m.checked || !m.licenceUrl);
  ok(badMeta.length === 0, 'each model has the name, source URL, author, archive and licence check', badMeta.map(m => m.id).join(', '));
  const srcIds = new Set(MODELS.map(m => m.id)), manIds = new Set(manifest.models.map(m => m.id));
  ok([...srcIds].every(id => manIds.has(id)) && [...manIds].every(id => srcIds.has(id)), 'sources.js and the manifest name the same models', `${srcIds.size} models`);
  const scans = SPECIES.filter(s => s.src === 'scan');
  const noFile = scans.filter(s => !manIds.has(s.model.asset));
  ok(noFile.length === 0, 'every scan species has its model in the manifest', noFile.map(s => s.id).join(', '));
  const credits = fs.existsSync(path.join(A, 'CREDITS.txt')) ? fs.readFileSync(path.join(A, 'CREDITS.txt'), 'utf8') : '';
  ok(manifest.models.every(m => credits.includes(m.id) && credits.includes(m.url)), 'assets/fauna/CREDITS.txt names every model and its URL');
}

// ── sizes ────────────────────────────────────────────────────────────────────
{
  let total = 0; for (const m of manifest.models) for (const f of m.files) total += f.bytes;
  const real = manifest.models.reduce((s, m) => s + m.files.reduce((t, f) => t + fs.statSync(path.join(A, f.path)).size, 0), 0);
  ok(Math.abs(real - total) < 1, 'manifest bytes match the files', `${(real / MB).toFixed(2)} MB`);
  ok(total < 25 * MB, 'all fauna assets under 25 MB', `${(total / MB).toFixed(2)} MB`);
  for (const [id, B] of Object.entries(FAUNA_BUDGET)) {
    let b = 0;
    for (const m of manifest.models) for (const f of m.files) {
      if (f.texture) { if (f.path.endsWith(`-${B.tex}.jpg`)) b += f.bytes; continue; }
      if (f.lod === 1 || B.scanLod === 0) b += f.bytes;
    }
    ok(b <= B.assetMB * MB, `${id}: the scan files it can fetch are in budget`, `${(b / MB).toFixed(2)} of ${B.assetMB} MB`);
  }
}

// ── GLB parse ────────────────────────────────────────────────────────────────
{
  let bad = [], n = 0;
  for (const m of manifest.models) for (const f of m.files) {
    if (!f.path.endsWith('.glb')) continue;
    n++;
    try {
      const buf = fs.readFileSync(path.join(A, f.path));
      const sc = parseGLB(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      const me = sc.meshes[0], P = me.positions;
      let finite = true; for (let i = 0; i < P.length; i++) if (!Number.isFinite(P[i])) { finite = false; break; }
      const ext = [0, 1, 2].map(k => sc.bounds.max[k] - sc.bounds.min[k]), L = Math.max(...ext);
      const hasTex = m.files.some(x => x.texture);
      const triMax = f.lod === 1 ? 760 : 3600;
      if (!finite || L < (f.lod === 1 ? 0.8 : 0.85) || L > 1.05 || sc.triangleCount > triMax || (hasTex && !me.uvs) || sc.triangleCount !== f.tris) bad.push(`${f.path} L=${L.toFixed(3)} tris=${sc.triangleCount}/${f.tris} uv=${!!me.uvs}`);
    } catch (e) { bad.push(f.path + ' ' + e.message); }
  }
  ok(bad.length === 0, `every GLB parses with glb-lite (${n} files): unit box, tris in budget, UVs`, bad.slice(0, 4).join('; '));
}

// ── species ──────────────────────────────────────────────────────────────────
{
  const real = SPECIES.filter(s => s.src === 'scan' || s.src === 'procedural');
  ok(real.length >= 40, 'at least 40 real species', `${real.length} (${SPECIES.filter(s => s.src === 'scan').length} scans, ${SPECIES.filter(s => s.src === 'procedural').length} procedural)`);
  const ids = new Set(SPECIES.map(s => s.id));
  ok(ids.size === SPECIES.length, 'species ids are unique');
  const badD = SPECIES.filter(s => !(s.depth[0] >= 0 && s.depth[1] > s.depth[0] && s.depthRef && s.aphia > 0 && s.sci && s.size[1] >= s.size[0]));
  ok(badD.length === 0, 'each species has a depth range, its reference, an AphiaID and a size', badD.map(s => s.id).join(', '));
  for (const reg of REGIONS) {
    const n = real.filter(s => s.depth[0] <= reg.depth[1] && s.depth[1] >= reg.depth[0]).length;
    ok(n >= 12, `${reg.name}: real species that live there`, String(n));
  }
  // every generator (the procedural species and a sample of generated ones)
  const gens = [...SPECIES.filter(s => s.model.gen)];
  for (const reg of REGIONS) for (const [px, pz] of [[0, 0], [3, -2]]) gens.push(...generatedSpecies(5, px, pz, reg.id));
  const bad = [];
  let tris = 0;
  for (const s of gens) {
    try {
      const M = genModel(s);
      for (const m of [M.lod0, M.lod1]) {
        const n = m.vertexCount;
        if (!n || m.positions.length !== n * 3 || m.anim.length !== n * 4 || m.colors.length !== n * 3) { bad.push(s.id + ' sizes'); break; }
        for (let i = 0; i < m.indices.length; i++) if (m.indices[i] >= n) { bad.push(s.id + ' index'); break; }
        for (let i = 0; i < m.positions.length; i++) if (!Number.isFinite(m.positions[i]) || !Number.isFinite(m.normals[i])) { bad.push(s.id + ' NaN'); break; }
        if (Math.max(...m.bounds.max.map((v, k) => v - m.bounds.min[k])) > 4) bad.push(s.id + ' big');
      }
      if (M.tris1 > M.tris0) bad.push(s.id + ' lod1 > lod0');
      tris = Math.max(tris, M.tris0);
    } catch (e) { bad.push(s.id + ' ' + e.message); }
  }
  ok(bad.length === 0, `every generator gives a valid mesh (${gens.length} species)`, bad.slice(0, 5).join(', ') || `largest ${tris} tris`);
  const gnames = generatedSpecies(5, 0, 0, 'abyss');
  ok(gnames.every(s => s.src === 'generated' && s.sci === null && /^generated /.test(s.name)), 'generated species are named as generated, with no scientific name');
  ok(JSON.stringify(generatedSpecies(5, 1, 1, 'twilight')) === JSON.stringify(generatedSpecies(5, 1, 1, 'twilight')) && JSON.stringify(generatedSpecies(5, 1, 1, 'twilight')) !== JSON.stringify(generatedSpecies(6, 1, 1, 'twilight')), 'generated species are deterministic per seed and province');
}

// ── spawns: depth, richness, determinism ─────────────────────────────────────
ok(FAUNA_CH === CH, 'fauna chunks are the world chunks', `${FAUNA_CH} m`);
const W7 = createWorld({ seed: 7 }), W11 = createWorld({ seed: 11 });
{
  const out = [];
  let animals = 0;
  const byRegion = {};
  const nC = QUICK ? 24 : 60;
  for (const [W, seed] of [[W7, 7], [W11, 11]]) {
    for (let k = 0; k < nC / 2; k++) {
      const i = ((k * 97) % 600) - 300, j = ((k * 61) % 600) - 300;
      const c = spawnChunk({ W, seed, i, j, budget: FAUNA_BUDGET.desktop });
      byRegion[c.region] = byRegion[c.region] || { n: 0, animals: 0, species: new Set(), features: new Set() };
      byRegion[c.region].n++; byRegion[c.region].animals += c.count;
      for (const g of c.groups) {
        byRegion[c.region].species.add(g.sp.id); if (g.feature) byRegion[c.region].features.add(g.feature);
        for (const m of g.members) {
          animals++;
          const d = 55 - m.y;
          if (d < g.sp.depth[0] - 1e-6 || d > g.sp.depth[1] + 1e-6) out.push(`${g.sp.id} at ${d.toFixed(1)} m (range ${g.sp.depth})`);
        }
      }
      if (c.count > FAUNA_BUDGET.desktop.maxPerChunk) out.push(`chunk ${c.key} has ${c.count}`);
    }
  }
  ok(out.length === 0, `no spawned animal outside its depth range (${animals} animals, ${nC} chunks)`, out.slice(0, 4).join('; '));
  console.log('     by region: ' + Object.entries(byRegion).map(([r, s]) => `${r} ${s.n} chunks, ${(s.animals / s.n).toFixed(0)}/chunk, ${s.species.size} species, features ${[...s.features].join('/')}`).join(' | '));
  const a = spawnChunk({ W: W7, seed: 7, i: 3, j: -4, budget: FAUNA_BUDGET.desktop }), b = spawnChunk({ W: W7, seed: 7, i: 3, j: -4, budget: FAUNA_BUDGET.desktop });
  const c = spawnChunk({ W: W11, seed: 11, i: 3, j: -4, budget: FAUNA_BUDGET.desktop });
  const sig = r => JSON.stringify(r.groups.map(g => [g.sp.id, g.members.map(m => [m.x, m.y, m.z, m.yaw, m.size])]));
  ok(sig(a) === sig(b) && a.count > 0, 'one seed and chunk give the same animals', `${a.count} animals`);
  ok(sig(a) !== sig(c), 'a new seed gives other animals');
  // richness: the pool at depth (real and generated)
  // (the trenches past 6000 m have fewer kinds, as in the real hadal zone)
  const rows = [];
  let grows = true;
  for (const sd of [7, 3, 11]) {
    const pool = d => poolAt(sd, 100 + sd * 900, 100 - sd * 700, d).length;
    const shallow = Math.max(pool(10), pool(25)), deep = [300, 800, 1500, 2500, 4500].map(pool);
    if (!deep.every(n => n > shallow)) grows = false;
    rows.push(`seed ${sd}: 10-25 m ${shallow}, deep ${deep.join('/')}`);
  }
  ok(grows, 'the species pool grows with depth (300 to 4500 m over the shallows)', rows.join('; '));
  const featD = d => FEATURES.filter(f => d >= f.depth[0] && d <= f.depth[1]).length;
  ok(featD(500) > featD(15) && featD(2500) > featD(15), 'more kinds of features in the deep', `15 m: ${featD(15)}, 500 m: ${featD(500)}, 2500 m: ${featD(2500)}`);
}

// ── coral colony dwellers (world/stream.js 'coral' colonies) ──────────────────
{
  let n = 0, out = 0, onCol = 0, base = 0;
  const fams = new Set();
  for (let k = 0; k < 200; k++) {
    const x = (k * 37) % 2000 - 1000, z = (k * 53) % 2000 - 1000, gy = W7.ground(x, z);
    const col = { id: 'fan', base: [x, gy, z], center: [x, gy + 1.5, z], radius: 2, top: gy + 3, ext: 1.5, size: 3 };
    for (const g of spawnColony({ W: W7, seed: 7, colony: col, budget: FAUNA_BUDGET.desktop })) {
      fams.add(g.sp.family);
      for (const m of g.members) {
        n++; const d = 55 - m.y; if (d < g.sp.depth[0] || d > g.sp.depth[1]) out++;
        if (g.feature === 'colony' && m.onCoral && Math.hypot(m.x - x, m.z - z) <= 1.5 && m.y <= gy + 3 + 1e-6) onCol++;
        if (g.feature === 'colony-base') base++;
      }
    }
  }
  ok(n > 0 && out === 0 && onCol > 0 && base > 0, 'colony dwellers: on the colony (inside its extent) and at its base, in their depth', `${n} animals, ${onCol} on colonies, ${base} at bases, families ${[...fams].join('/')}`);
}

// ── rock: no swimmer in the solid over a long run ────────────────────────────
{
  const W = W7, B = FAUNA_BUDGET.desktop;
  const sim = createSim({ sdf: W.sdfAll, sdfScale: W.sdfScale, maxAgents: 3000, simEvery: B.simEvery, seed: 7 });
  // chunks with rough ground: the most relief in a sample
  const cand = [];
  for (let k = 0; k < 40; k++) { const i = ((k * 31) % 200) - 100, j = ((k * 17) % 200) - 100; const h = [0, 1, 2, 3].map(q => W.ground(i * 32 + (q & 1) * 30, j * 32 + (q >> 1) * 30)); cand.push([Math.max(...h) - Math.min(...h), i, j]); }
  cand.sort((a, b) => b[0] - a[0]);
  let swimmers = 0;
  for (const [, i, j] of cand.slice(0, QUICK ? 3 : 6)) {
    const c = spawnChunk({ W, seed: 7, i, j, budget: B });
    const grid = gridFrom(c.grid);
    for (const g of c.groups) { sim.addGroup(g, c.key, grid); if (!['crawl', 'still'].includes(g.sp.habit)) swimmers += g.members.length; }
  }
  const T = QUICK ? 40 : 120, dt = 1 / 30;
  let worst = Infinity, inside = 0, checks = 0, wander = 0;
  const p0 = Float64Array.from(sim.px), q0 = Float64Array.from(sim.pz);
  const rov = { p: [cand[0][1] * 32 + 16, W.ground(cand[0][1] * 32 + 16, cand[0][2] * 32 + 16) + 3, cand[0][2] * 32 + 16], look: [0, -0.3, 1] };
  for (let s = 0; s < T / dt; s++) {
    rov.p[0] += Math.sin(s * dt * 0.2) * 0.02; rov.p[2] += 0.02;
    sim.step(dt, { t: s * dt, rovs: [rov], current: [0.1, 0.05] });
    if (s % 6) continue;
    for (const G of sim.groups.values()) {
      if (G.habit === 'crawl' || G.habit === 'still') continue;
      for (const i of G.members) { const d = W.sdfAll(sim.px[i], sim.py[i], sim.pz[i]) / W.sdfScale; checks++; if (d < worst) worst = d; if (d < 0) inside++; }
    }
  }
  for (const G of sim.groups.values()) if (G.habit === 'school') for (const i of G.members) wander = Math.max(wander, Math.hypot(sim.px[i] - p0[i], sim.pz[i] - q0[i]));
  ok(swimmers > 50 && inside === 0, `no swimmer inside the rock over ${T} s (${swimmers} swimmers, ${checks} checks)`, `nearest ${worst.toFixed(2)} m (field bound), rock hits turned back ${sim.stats.rockHits}`);
  ok(wander > 2, 'the schools move', `farthest ${wander.toFixed(1)} m`);
}

// ── budgets per profile ──────────────────────────────────────────────────────
{
  for (const [id, B] of Object.entries(FAUNA_BUDGET)) {
    const sim = createSim({ sdf: W7.sdfAll, sdfScale: W7.sdfScale, maxAgents: B.maxAgents, seed: 7 });
    let maxChunk = 0, chunks = 0;
    const R = B.ring, cx = 40, cz = -70;
    for (let j = Math.floor((cz - R) / 32); j <= Math.floor((cz + R) / 32); j++) for (let i = Math.floor((cx - R) / 32); i <= Math.floor((cx + R) / 32); i++) {
      if (Math.hypot((i + 0.5) * 32 - cx, (j + 0.5) * 32 - cz) >= R) continue;
      const c = spawnChunk({ W: W7, seed: 7, i, j, budget: B });
      chunks++; maxChunk = Math.max(maxChunk, c.count);
      for (const g of c.groups) sim.addGroup(g, c.key, null);
    }
    ok(maxChunk <= B.maxPerChunk && sim.count <= B.maxAgents, `${id}: animals per chunk and in total in budget`, `${chunks} chunks, max ${maxChunk}/chunk, ${sim.count} of ${B.maxAgents}`);
  }
  const order = ['desktop', 'laptop-low', 'phone', 'phone-min'];
  ok(order.every((k, i) => !i || (FAUNA_BUDGET[k].maxAgents < FAUNA_BUDGET[order[i - 1]].maxAgents && FAUNA_BUDGET[k].ring <= FAUNA_BUDGET[order[i - 1]].ring)), 'phones get fewer animals and a smaller ring');
}

// ── createFauna with three (no GL): memory over a flight, lookAt ──────────────
{
  const THREE = await import('../../../vendor/three@0.160.0/build/three.module.js');
  const { createFauna } = await import('../fauna/index.js');
  // fetch from the disk (the scans); no createImageBitmap: no textures
  globalThis.fetch = async (url) => {
    const p = decodeURIComponent(new URL(url).pathname);
    const buf = fs.readFileSync(p);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString('utf8')), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), blob: async () => null };
  };
  const root = new THREE.Group();
  const cam = new THREE.PerspectiveCamera(60, 1.5, 0.1, 400);
  const W = W7;
  const F = createFauna({ THREE, root, U: null, world: W, physics: null, profile: 'phone', seed: 7, base: 'file://' + A + '/', makeWorker: null });
  const eye = [100, 0, 100];
  const at = (x, z) => [x, W.ground(x, z) + 4, z];
  let maxBytes = 0, maxAgents = 0, maxDrawn = 0, maxHalos = 0, maxSpecies = 0, t = 0;
  const frames = QUICK ? 400 : 900;
  const look = new THREE.Vector3();
  for (let f = 0; f < frames; f++) {
    const x = 100 + f * 1.4, z = 100 + Math.sin(f * 0.01) * 40, e = at(x, z);
    cam.position.set(e[0], e[1], e[2]); look.set(e[0] + 1, e[1] - 0.2, e[2]); cam.lookAt(look); cam.updateMatrixWorld(true);
    F.update(1 / 30, cam, e, [0, 0]);
    t += 1 / 30;
    if (f % 30 === 0) await new Promise(r => setTimeout(r, 0));
    const s = F.stats(); maxBytes = Math.max(maxBytes, s.bytes); maxAgents = Math.max(maxAgents, s.agents); maxDrawn = Math.max(maxDrawn, s.drawn); maxHalos = Math.max(maxHalos, s.halos); maxSpecies = Math.max(maxSpecies, s.species);
  }
  const mid = F.stats();
  // park far away for a while: the old chunks go, idle species free their meshes
  const far = at(30000, -30000);
  for (let f = 0; f < 30 * 30; f++) { cam.position.set(far[0], far[1], far[2]); cam.updateMatrixWorld(true); F.update(1 / 30, cam, far, [0, 0]); if (f % 30 === 0) await new Promise(r => setTimeout(r, 0)); }
  const end = F.stats();
  let liveCount = 0; for (const key of F.sim.byChunk.keys()) for (const id of F.sim.byChunk.get(key)) liveCount += F.sim.groups.get(id).members.length;
  ok(mid.agents > 0 && maxDrawn > 0 && maxSpecies > 0, 'createFauna spawns and draws animals on a flight', `${mid.agents} agents at the end, at most ${maxDrawn} drawn, ${maxSpecies} species meshes, ${maxHalos} halos`);
  ok(maxAgents <= FAUNA_BUDGET.phone.maxAgents, 'phone: agents in budget on the flight', `max ${maxAgents}`);
  ok(end.agents === liveCount && F.sim.freeSlots === F.sim.capacity - end.agents, 'unloaded chunks free their agents (the free list is whole)', `${end.agents} agents in ${end.chunks} chunks`);
  ok(end.freed > 0 && end.bytes <= maxBytes, 'idle species free their meshes', `${end.freed} freed, bytes ${(end.bytes / MB).toFixed(2)} MB now, ${(maxBytes / MB).toFixed(2)} MB at most`);
  ok(mid.scanFails === 0 && end.scanFails === 0, 'every scan that the flight needed loaded', `${mid.scans} scans ready at mid flight`);
  // lookAt: put a known animal in front of a camera ray
  let hit = null;
  for (let i = 0; i < F.sim.capacity && !hit; i++) {
    if (!F.sim.alive[i]) continue;
    const p = [F.sim.px[i] - 3, F.sim.py[i], F.sim.pz[i]];
    hit = F.lookAt(p, [1, 0, 0], 10);
  }
  ok(hit && hit.name && hit.dist > 0, 'lookAt finds the animal on a view ray (the ROV HUD label)', hit ? `${hit.name}${hit.sci ? ' (' + hit.sci + ')' : ''}, ${hit.src}, ${hit.dist.toFixed(1)} m` : '');
  // the saver escort: swimming groups near a point take a home by it
  let g0 = null; for (const G of F.sim.groups.values()) if (!G.benthic && G.habit !== 'still' && !G.onCoral) { g0 = G; break; }
  if (g0) {
    const pt = [g0.centre[0] + 20, g0.centre[1], g0.centre[2]];
    F.setEscort(() => pt);
    F.update(1 / 30, cam, far, [0, 0]);
    let by = 0; for (const G of F.sim.groups.values()) if (Math.hypot(G.home[0] - pt[0], G.home[2] - pt[2]) < 10) by++;
    ok(by >= 1, 'saver escort: swimming groups near the lead ROV take a home by it', `${by} groups`);
    F.setEscort(null);
  } else ok(false, 'saver escort: a swimming group to test');
  F.dispose();
  ok(root.children.length === 0, 'dispose removes every fauna mesh');
}

// ── shaders ──────────────────────────────────────────────────────────────────
{
  const { checkPrograms } = await import('../glsl-check.mjs');
  const G = await import('../fauna/glsl.js');
  const r = checkPrograms([{ name: 'fauna', vs: G.FAUNA_VS, fs: G.FAUNA_FS, instanced: true }, { name: 'gel', vs: G.FAUNA_VS, fs: G.GEL_FS, instanced: true }, { name: 'halo', vs: G.HALO_VS, fs: G.HALO_FS, instanced: true }]);
  for (const x of r) ok(x.ok !== false, `naga reads the ${x.name} program`, x.ok === null ? 'naga not found: not checked' : x.log);
  ok(Object.keys(ANIM).length === 10 && G.FAUNA_VS.includes('kind == 9'), 'every motion kind has a branch in the vertex shader');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
