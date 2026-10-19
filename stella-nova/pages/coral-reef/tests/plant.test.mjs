// ============================================================================
//  CORAL REEF  ·  tests/plant.test.mjs  ·  plant mode (node, no browser)
//    node tests/plant.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "ok my girlfriend really liked when we could
//  plant corals by clicking can we bring that back to the ROV section?"
//  world/plant.js, world/stream.js plant, world/corals.js plantChunk and a
//  main-thread pool (world/worker.js runJob), with a counting view:
//    off ........ out of plant mode (and for a double tap) a tap plants
//                 nothing: no record, no job
//    plant ...... a tap that the ray takes to the rock adds ONE colony of
//                 the chosen species to the chunk of the hit, at the hit
//    grow ....... its births run from the root over GROW_S s; the other
//                 particles stay BIRTH_PAST; after GROW_S + 1.4 s every
//                 particle is grown, and no later job grows it again
//    reload ..... the chunk unloads and loads again: the same colony (the
//                 same particles) at the same world point, with no grow-in
//    origin ..... a floating-origin shift (three.js worldRoot at -O, the
//                 page frame) keeps the colony at the same world point
//    caps ....... over plant.max the oldest plant goes; a full chunk slab
//                 reserve drops the oldest plant of that chunk
// ============================================================================
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStreamer, WORLD_BUDGET, fineFor } from '../world/stream.js';
import { createPool } from '../world/pool.js';
import { worldFor } from '../world/worker.js';
import { BIRTH_PAST } from '../world/corals.js';
import { createPlanter, plantBirths, pickPlantSpecies, GROW_S } from '../world/plant.js';
import { PARTICLE_FLOATS, SPECIES } from '../reef.js';
import { CH } from '../world/mesh.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const THREE = await import(pathToFileURL(path.join(HERE, '../../../vendor/three@0.160.0/build/three.module.js')).href);
let pass = 0, fail = 0;
function ok(c, name, info = '') { if (c) { pass++; console.log(`ok   ${name}${info !== '' ? '  ' + info : ''}`); } else { fail++; console.log(`FAIL ${name}${info !== '' ? '  ' + info : ''}`); } }
const fnv = (arr) => { let h = 2166136261; const u = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619); } return h >>> 0; };

// a small budget: two colonies per chunk, three plants at most
const B = Object.assign({}, WORLD_BUDGET['phone-min'], {
  coral: Object.assign({}, WORLD_BUDGET['phone-min'].coral, { colonies: 2, particles: 1500 }),
  plant: { max: 3, particles: 400, reserve: 800 },
});
const W = worldFor(1, fineFor(B.c0));
function reefSpot() {
  let best = null;
  for (let j = -30; j <= 30; j++) for (let i = -30; i <= 30; i++) {
    const x = i * 500, z = j * 500;
    if (W.regionAt(x, z).id !== 'reef') continue;
    const s = W.habitat(x, z) - Math.hypot(i, j) * 0.002;
    if (!best || s > best.s) best = { s, x, z };
  }
  return best;
}

// the view: coral adds per chunk (a plant replaces the chunk coral)
let tS = 100;                                  // the shader clock (s)
const V = { rock: new Set(), coral: new Map(), adds: new Map(), errors: [] };
const view = {
  addRock(key) { V.rock.add(key); return 1; },
  removeRock(key) { V.rock.delete(key); },
  addCoral(key, co) {
    if (!V.rock.has(key)) V.errors.push('coral before rock ' + key);
    const n = co.particles.length / PARTICLE_FLOATS;
    V.coral.set(key, { co, birth: plantBirths(co, n, tS), at: tS });
    V.adds.set(key, (V.adds.get(key) || 0) + 1);
    return 1;
  },
  removeCoral(key) { V.coral.delete(key); },
};
const pool = createPool({ makeWorker: null, delay: () => new Promise(r => setImmediate(r)) });
let clock = 0;
const st = createStreamer({ seed: 1, budget: B, pool, view, now: () => clock });
const events = [];
st.on('plant', e => events.push(e));
async function drain() {
  for (let i = 0; i < 1e6; i++) { const s = pool.stats; if (!s.queued && !s.running) return; await new Promise(r => setImmediate(r)); }
}
async function settle(eye, n = 3) { for (let i = 0; i < n; i++) { clock += 500; st.update(eye, [eye]); await drain(); } st.update(eye, [eye]); }

const R0 = reefSpot();
const eye = [R0.x, W.ground(R0.x, R0.z) + 3, R0.z];
await settle(eye, 4);
const coralKeys = () => [...st.chunks.values()].filter(c => c.coral).map(c => c.key);
ok(coralKeys().length > 0, 'setup: the chunks round the eye show their corals', `${coralKeys().length} coral chunks at ${R0.x}, ${R0.z}`);

// a ray straight down onto chunk key at (u, v) of its square
function downRay(key, u = 0.5, v = 0.5) {
  const [i, j] = key.split(',').map(Number), x = (i + u) * CH, z = (j + v) * CH;
  return { o: [x, W.height(x, z) + 14, z], d: [0, -1, 0] };
}
let mode = false, sp = 'staghorn', nextRay = null;
const planter = createPlanter({ on: () => mode, species: () => sp, ray: () => nextRay, field: () => W, streamer: () => st, rand: () => 0.5 });

// ── off ─────────────────────────────────────────────────────────────────────
const key0 = st.chunk(`${Math.floor(eye[0] / CH)},${Math.floor(eye[2] / CH)}`).coral ? `${Math.floor(eye[0] / CH)},${Math.floor(eye[2] / CH)}` : coralKeys()[0];
nextRay = downRay(key0, 0.42, 0.55);
{
  const jobs = st.stats.plantJobs;
  const a = planter.tap(10, 10, 'tap');
  mode = true;
  const b = planter.tap(10, 10, 'double');
  mode = false;
  await drain();
  ok(a === null && b === null && st.plants().length === 0 && st.stats.plantJobs === jobs, 'off: out of plant mode (and for a double tap) a tap plants nothing', `tap ${a}, double ${b}, plants ${st.plants().length}, jobs ${st.stats.plantJobs - jobs}`);
}

// ── plant ───────────────────────────────────────────────────────────────────
mode = true;
const n0 = st.chunk(key0).coral.colonies.length, cnt0 = st.chunk(key0).coral.count;
const t0 = Date.now();
const r1 = planter.tap(10, 10, 'tap');
ok(r1 && r1.ok && r1.rec && r1.rec.key === key0 && r1.id === 'staghorn', 'plant: the tap hits the rock and makes a record in the chunk of the hit', r1 ? `${r1.ok ? '' : r1.why} hit ${r1.p && r1.p.map(v => v.toFixed(2)).join(', ')} chunk ${r1.rec && r1.rec.key}` : 'null');
tS = 200;
await drain();
const ms1 = Date.now() - t0;
const c1 = st.chunk(key0).coral, newCol = c1.colonies[c1.colonies.length - 1];
ok(c1.colonies.length === n0 + 1 && newCol.planted === r1.rec.uid && newCol.id === 'staghorn' && c1.colonies.filter(q => q.planted != null).length === 1, 'plant: one colony of the chosen species is added to that chunk', `${n0} -> ${c1.colonies.length} colonies, ${cnt0} -> ${c1.count} particles, plant job ${ms1} ms`);
const baseW = [newCol.base[0] + c1.cx, newCol.base[1] + c1.oy, newCol.base[2] + c1.cz];
const dHit = Math.hypot(baseW[0] - r1.p[0], baseW[1] - r1.p[1], baseW[2] - r1.p[2]);
ok(dHit < 0.6, 'plant: the colony root is at the hit point', `${dHit.toFixed(3)} m`);
ok(c1.coarse.staghorn && c1.coarse.staghorn.tris > 0 && events.some(e => e.ok && e.uid === r1.rec.uid && e.colony), 'plant: the chunk mesh is made again with the new colony, and the page gets the plant event', `${c1.coarse.staghorn ? c1.coarse.staghorn.tris : 0} staghorn tris`);
ok(c1.particles.subarray(0, cnt0 * PARTICLE_FLOATS).every((v, i) => v === V.coral.get(key0).co.particles[i]), 'plant: the particles of the old colonies do not change (grow once)');
ok(SPECIES[pickPlantSpecies('random', 0.37)] && pickPlantSpecies('random', 0) !== pickPlantSpecies('random', 0.99) && pickPlantSpecies('fan', 0.1) === 'fan', 'plant: Random picks a real species; a choice is kept');

// ── grow, then lock ─────────────────────────────────────────────────────────
{
  const v = V.coral.get(key0), n = c1.count, g = c1.grow[0];
  const born = t => { let k = 0; for (let q = g.from; q < g.to; q++) if (t - v.birth[q] >= 0) k++; return k / (g.to - g.from); };
  const others = [...Array(n).keys()].filter(q => q < g.from || q >= g.to).every(q => v.birth[q] === BIRTH_PAST);
  ok(v.birth && others && born(v.at) === 0 && born(v.at + GROW_S * 0.5) > 0.3 && born(v.at + GROW_S * 0.5) < 0.7, 'grow: the new colony grows in over GROW_S s; the others stay grown', `born ${(born(v.at) * 100).toFixed(0)} % at once, ${(born(v.at + GROW_S * 0.5) * 100).toFixed(0)} % at ${GROW_S / 2} s`);
  // the root first: the first births are near the base
  const P = c1.particles, near = q => Math.hypot(P[q * 8] - newCol.base[0], P[q * 8 + 1] - newCol.base[1], P[q * 8 + 2] - newCol.base[2]);
  const k = Math.max(4, (g.to - g.from) >> 3);
  let early = 0, late = 0;
  for (let q = 0; q < k; q++) { early += near(g.from + q); late += near(g.to - 1 - q); }
  ok(early < late, 'grow: it grows from the root out (the first births are nearest the root)', `mean ${(early / k).toFixed(2)} m first, ${(late / k).toFixed(2)} m last`);
  const tEnd = v.at + GROW_S + 0.15 + 1.4 + 0.01;
  let minAge = Infinity;
  for (let q = 0; q < n; q++) minAge = Math.min(minAge, tEnd - v.birth[q]);
  const jobs = st.stats.plantJobs, adds = V.adds.get(key0), h = fnv(c1.particles);
  for (let s = 0; s < 6; s++) { eye[0] += 0.5; await settle(eye, 1); }
  const c2 = st.chunk(key0).coral;
  ok(minAge >= 1.4 && st.stats.plantJobs === jobs && V.adds.get(key0) === adds && fnv(c2.particles) === h, 'grow: then it locks: every particle is grown, and no job grows it again', `youngest ${minAge.toFixed(2)} s at ${(tEnd - v.at).toFixed(2)} s, jobs +${st.stats.plantJobs - jobs}, adds +${V.adds.get(key0) - adds}`);
}

// ── reload ──────────────────────────────────────────────────────────────────
{
  const g = c1.grow[0], hCol = fnv(c1.particles.slice(g.from * PARTICLE_FLOATS, g.to * PARTICLE_FLOATS)), nCol = g.to - g.from;
  const far = [eye[0] + 20000, -10, eye[2] + 20000];
  await settle(far, 2);
  const gone = !st.chunk(key0) && !V.coral.has(key0);
  eye[0] -= 3;
  await settle(eye, 4);
  const c3 = st.chunk(key0) && st.chunk(key0).coral;
  const col = c3 && c3.colonies.find(q => q.planted === r1.rec.uid);
  let same = false, dBase = Infinity;
  if (col) {
    const ids = [];
    for (let q = 0; q < c3.count; q++) if (c3.particles[q * PARTICLE_FLOATS + 3] === col.k) ids.push(q);
    const a = c3.particles.slice(ids[0] * PARTICLE_FLOATS, (ids[ids.length - 1] + 1) * PARTICLE_FLOATS);
    // the particle ids move with the chunk start; compare the positions
    const b = c1.particles.slice(g.from * PARTICLE_FLOATS, g.to * PARTICLE_FLOATS);
    same = ids.length === nCol && a.every((v, i) => (i % PARTICLE_FLOATS === 4 ? true : i % PARTICLE_FLOATS === 3 ? true : v === b[i]));
    dBase = Math.hypot(col.base[0] + c3.cx - baseW[0], col.base[1] + c3.oy - baseW[1], col.base[2] + c3.cz - baseW[2]);
  }
  const vb = V.coral.get(key0);
  ok(gone && same && dBase < 1e-4 && hCol !== 0, 'reload: after the chunk unloads, it loads again with the same colony at the same world point', `gone ${gone}, ${nCol} particles same ${same}, base ${dBase.toExponential(1)} m`);
  ok(vb && vb.birth === null && (!c3.grow || !c3.grow.length), 'reload: the colony is just there (no grow-in after a reload)');
}

// ── origin ──────────────────────────────────────────────────────────────────
{
  const c = st.chunk(key0).coral, col = c.colonies.find(q => q.planted === r1.rec.uid);
  const worldRoot = new THREE.Group(), grp = new THREE.Group();
  worldRoot.add(grp); grp.position.set(c.cx, c.oy, c.cz);          // scene.js addWorldCoral
  const at = (ox, oz) => {
    worldRoot.position.set(-ox, 0, -oz); worldRoot.updateMatrixWorld(true);  // scene.js setOrigin
    const v = new THREE.Vector3(...col.base).applyMatrix4(grp.matrixWorld);
    return [v.x + ox, v.y, v.z + oz];                                         // render space + O = world
  };
  const a = at(0, 0), b = at(Math.round(eye[0] / 1024) * 1024, Math.round(eye[2] / 1024) * 1024 + 4096);
  const rec = st.plants().find(q => q.uid === r1.rec.uid);
  ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-3 && Math.hypot(a[0] - baseW[0], a[2] - baseW[2]) < 1e-3 && rec && rec.p.every((v, i) => v === r1.p[i]), 'origin: an origin shift keeps the planted colony at the same world point (the record is in world metres)', `shift ${Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]).toExponential(1)} m`);
}

// ── caps ────────────────────────────────────────────────────────────────────
{
  // the slab reserve (800 = 2 plants of 400): a third plant in one chunk drops the oldest there
  nextRay = downRay(key0, 0.7, 0.3); const r2 = planter.tap(0, 0, 'tap'); await drain();
  nextRay = downRay(key0, 0.25, 0.25); const r3 = planter.tap(0, 0, 'tap'); await drain();
  const inChunk = st.plants().filter(q => q.key === key0).map(q => q.uid);
  const cols = st.chunk(key0).coral.colonies.filter(q => q.planted != null).map(q => q.planted);
  ok(r2.ok && r3.ok && inChunk.length === 2 && !inChunk.includes(r1.rec.uid) && cols.length === 2 && !cols.includes(r1.rec.uid), 'caps: a full chunk reserve drops the oldest plant of that chunk', `chunk plants ${inChunk.join()} (first ${r1.rec.uid}), colonies ${cols.join()}`);
  // the global cap (3): plants in another chunk push the oldest out
  const other = coralKeys().find(k => k !== key0);
  let r4 = null, r5 = null;
  if (other) { nextRay = downRay(other, 0.5, 0.5); r4 = planter.tap(0, 0, 'tap'); await drain(); nextRay = downRay(other, 0.2, 0.8); r5 = planter.tap(0, 0, 'tap'); await drain(); }
  const all = st.plants().map(q => q.uid);
  const has = st.chunk(key0).coral.colonies.filter(q => q.planted != null).map(q => q.planted);
  ok(other && r4 && r4.ok && r5 && r5.ok && all.length === 3 && !all.includes(r2.rec.uid) && !has.includes(r2.rec.uid) && has.includes(r3.rec.uid), 'caps: over plant.max the oldest plant goes (its colony leaves its chunk)', `plants ${all.join()}, chunk ${key0}: ${has.join()}`);
  ok(st.chunk(key0).coral.count <= st.slabSize && V.errors.length === 0, 'caps: the chunk particles stay in its slab', `${st.chunk(key0).coral.count} <= ${st.slabSize}`);
}

st.dispose();
await drain();
console.log(`plant: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
