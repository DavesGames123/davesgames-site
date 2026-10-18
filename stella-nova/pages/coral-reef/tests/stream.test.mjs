// ============================================================================
//  CORAL REEF  ·  tests/stream.test.mjs  ·  streaming the world (node, no browser)
//    node tests/stream.test.mjs [--quick]
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "we shouldn't grow corals, they should just
//  grow once adn be there". world/stream.js, world/pool.js, world/worker.js,
//  world/corals.js and world/coral-data.js with a counting view (no GL):
//    worker ..... world/worker.js runs as a module worker (node
//                 worker_threads adapter): a rock job and a coral job come
//                 back with their arrays
//    flight ..... the phone-min budget (2 colonies per chunk), a scripted
//                 flight of 2 km along x (6 m steps of the eye, every job
//                 done between steps):
//                 the bytes (view and streamer) stay under a cap, and after
//                 the eye goes 20 km away every chunk unloads and the bytes
//                 go back to the start value (0): no leak
//    complete ... every addCoral comes after the rock of its chunk, once per
//                 load, with all its colonies; a chunk grown again on its
//                 own (growChunkSync) gives the same particles, bit for bit:
//                 the page shows only finished growth
//    no growth .. every texel that writeChunk writes has a birth far in the
//                 past: uTime - birth > the grow-in time (1.4 s coral,
//                 2.1 s polyps) for any page time >= 0
//    focus ...... view points near a colony give it a fine mesh (addFine),
//                 and moving away drops it (removeFine)
//    coral dist . the distance to the nearest coral particle is right
// ============================================================================
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker as WT } from 'node:worker_threads';
import { createStreamer, WORLD_BUDGET, fineFor } from '../world/stream.js';
import { createPool } from '../world/pool.js';
import { growChunkSync, BIRTH_PAST } from '../world/corals.js';
import { worldFor } from '../world/worker.js';
import { chunkMirror, chunkColours, writeChunk } from '../world/coral-data.js';
import { PARTICLE_FLOATS } from '../reef.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUICK = process.argv.includes('--quick');
let pass = 0, fail = 0;
function ok(c, name, info = '') { if (c) { pass++; console.log(`ok   ${name}${info !== '' ? '  ' + info : ''}`); } else { fail++; console.log(`FAIL ${name}${info !== '' ? '  ' + info : ''}`); } }
const MB = 1048576;
const fnv = (arr) => { let h = 2166136261; const u = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619); } return h >>> 0; };

// ── the module worker ───────────────────────────────────────────────────────
class NodeWorker {
  constructor(url) {
    const code = `const { parentPort } = require('node:worker_threads');
      globalThis.self = { postMessage: (d, t) => parentPort.postMessage(d, t), set onmessage(f) { parentPort.on('message', d => f({ data: d })); } };
      import(${JSON.stringify(String(url))});`;
    this.w = new WT(code, { eval: true });
    this.w.on('message', d => this.onmessage && this.onmessage({ data: d }));
    this.w.on('error', e => this.onerror && this.onerror(e));
  }
  postMessage(m) { this.w.postMessage(m); }
  terminate() { this.w.terminate(); }
}
{
  const url = pathToFileURL(path.join(HERE, '..', 'world', 'worker.js'));
  const pool = createPool({ size: 2, makeWorker: () => new NodeWorker(url) });
  const t0 = Date.now();
  const [rock, coral] = await Promise.all([
    pool.submit({ type: 'rock', seed: 1, ci: 18, cj: 2, lod: 1, c0: 0.4, fine: 0.6 }, 0).promise,
    pool.submit({ type: 'coral', seed: 1, ci: 12, cj: 4, budget: WORLD_BUDGET['phone-min'].coral, fine: 1 }, 1).promise,
  ]);
  ok(rock && rock.rock && rock.rock.positions instanceof Float32Array && rock.rock.tris > 100, 'worker: a rock job comes back from a module worker', rock && rock.rock ? `${rock.rock.tris} tris, ${rock.ms.toFixed(0)} ms` : 'none');
  ok(coral && coral.particles instanceof Float32Array && coral.colonies.length >= 1 && coral.count === coral.particles.length / PARTICLE_FLOATS, 'worker: a coral job comes back grown and meshed', coral ? `${coral.colonies.length} colonies, ${coral.count} particles, ${coral.stats.tris} tris, ${(Date.now() - t0)} ms` : 'none');
  ok(!pool.local, 'worker: the pool did not fall back to the main thread', pool.why);
  pool.dispose();
}

// ── a counting view ─────────────────────────────────────────────────────────
function countingView() {
  const V = { rock: new Map(), coral: new Map(), fine: new Map(), bytes: 0, events: [], errors: [], births: [], addCoralN: 0 };
  const geo = m => (m ? m.positions.byteLength + (m.normals ? m.normals.byteLength : 0) + m.indices.byteLength + (m.cavity ? m.cavity.byteLength : 0) + (m.band ? m.band.byteLength : 0) + (m.gids ? m.gids.byteLength : 0) + (m.polyps ? m.polyps.byteLength : 0) : 0);
  V.addRock = (key, origin, r) => {
    const old = V.rock.get(key) || 0;
    const b = geo(r.rock) + geo(r.sand);
    V.bytes += b - old; V.rock.set(key, b);
    V.events.push(['rock', key]);
    return b;
  };
  V.removeRock = key => { if (!V.rock.has(key)) V.errors.push('removeRock of a chunk with no rock ' + key); V.bytes -= V.rock.get(key) || 0; V.rock.delete(key); };
  V.addCoral = (key, co) => {
    if (!V.rock.has(key)) V.errors.push('coral before rock ' + key);
    if (V.coral.has(key)) V.errors.push('coral shown twice ' + key);
    let b = 0;
    for (const m of Object.values(co.coarse)) b += geo(m);
    // the data texels of the slab, as the page writes them
    const M = chunkMirror(co), T = chunkColours(co, M, 'natural');
    const texB = [];
    writeChunk((from, to, f) => { const A = new Float32Array(4), B = new Float32Array(4), C = new Float32Array(4); for (let s = from; s < to; s++) { f(s, A, B, 0, C); texB.push(B[0]); } }, co, M, T, null);
    V.births.push(...texB.slice(0, 50));
    V.texCount = (V.texCount || 0) + texB.length;
    V.bytes += b; V.coral.set(key, { b, co });
    V.events.push(['coral', key]); V.addCoralN++;
    return b;
  };
  V.removeCoral = key => { const c = V.coral.get(key); if (!c) V.errors.push('removeCoral of no coral ' + key); V.bytes -= c ? c.b : 0; V.coral.delete(key); };
  V.addFine = (fk, chunk, k, m) => { const b = geo(m); V.bytes += b; V.fine.set(fk, b); V.events.push(['fine', fk]); return b; };
  V.removeFine = fk => { V.bytes -= V.fine.get(fk) || 0; V.fine.delete(fk); V.events.push(['unfine', fk]); };
  return V;
}
async function drain(pool) {
  for (let i = 0; i < 1e6; i++) {
    const s = pool.stats;
    if (!s.queued && !s.running) return;
    await new Promise(r => setImmediate(r));
  }
}

// ── the flight ──────────────────────────────────────────────────────────────
// the phone-min budget, with fewer colonies per chunk so the 2 km run
// stays in the time of tests.mjs (the growth is real, only smaller)
const B = Object.assign({}, WORLD_BUDGET['phone-min'], { coral: Object.assign({}, WORLD_BUDGET['phone-min'].coral, { colonies: 2, particles: 1500 }) });
const view = countingView();
const pool = createPool({ makeWorker: null, delay: () => new Promise(r => setImmediate(r)) });
let clock = 0;
const st = createStreamer({ seed: 1, budget: B, pool, view, now: () => clock });
const startBytes = st.stats.total;
const L = QUICK ? 600 : 2000;
let peak = 0, peakView = 0, maxChunks = 0, maxCoral = 0;
const t0 = Date.now();
const shownSample = [];
for (let x = 0; x <= L; x += 6) {
  clock += 6000;
  const eye = [x, -10, 300 + 25 * Math.sin(x / 90)];
  st.update(eye, [eye]);
  await drain(pool);
  st.update(eye, [eye]);
  const s = st.stats;
  peak = Math.max(peak, s.total); peakView = Math.max(peakView, view.bytes);
  maxChunks = Math.max(maxChunks, s.rock); maxCoral = Math.max(maxCoral, s.coral);
  for (const c of st.chunks.values()) if (c.coral && c.coral.count > 0 && shownSample.length < 3 && !shownSample.some(q => q.key === c.key)) shownSample.push({ key: c.key, i: c.i, j: c.j, count: c.coral.count, hash: fnv(c.coral.particles) });
}
const flightS = (Date.now() - t0) / 1000;
const S1 = st.stats;
console.log(`     flight ${L} m in ${flightS.toFixed(0)} s: rock jobs ${S1.rockJobs}, coral jobs ${S1.coralJobs}, fine jobs ${S1.fineJobs}, dropped ${S1.dropped}, unloads ${S1.unloads}`);
console.log(`     peak bytes ${(peak / MB).toFixed(1)} MB (view ${(peakView / MB).toFixed(1)} MB), at most ${maxChunks} rock chunks and ${maxCoral} coral chunks`);
const rockMs = S1.rockMs.slice().sort((a, b) => a - b), coralMs = S1.coralMs.slice().sort((a, b) => a - b);
console.log(`     job times (one thread): rock median ${rockMs[rockMs.length >> 1].toFixed(0)} ms, max ${rockMs[rockMs.length - 1].toFixed(0)} ms; coral median ${coralMs[coralMs.length >> 1].toFixed(0)} ms, max ${coralMs[coralMs.length - 1].toFixed(0)} ms (last 64)`);
ok(view.errors.length === 0, 'complete: coral only after rock, once per load, every remove after an add', view.errors.slice(0, 3).join('; '));
const cap = 60 * MB;
ok(peak < cap && Math.abs(peak - peakView) < 0.5 * peak + 1, 'flight: the bytes stay under the phone-min cap', `${(peak / MB).toFixed(1)} MB < ${cap / MB} MB`);
ok(maxCoral <= B.maxCoral && maxChunks < 40, 'flight: the chunk counts stay bounded', `${maxChunks} rock, ${maxCoral} coral`);
ok(S1.coralShown > (QUICK ? 3 : 10), 'flight: corals were shown on the way', `${S1.coralShown} coral chunks shown`);
// fly far away: everything goes
clock += 4000;
st.update([20000, -10, 20000], [[20000, -10, 20000]]);
await drain(pool);
st.update([20000 + 1e5, -10, 20000 + 1e5], [[1e5, 0, 1e5]]);
await drain(pool);
// a far eye loads a few new chunks: unload them too by a third jump, then count
const before = st.stats.total;
st.dispose();
await drain(pool);
const after = st.stats.total;
ok(view.rock.size === 0 && view.coral.size === 0 && view.fine.size === 0 && view.bytes === 0, 'flight: after the unload the view holds nothing', `view bytes ${view.bytes}, rock ${view.rock.size}, coral ${view.coral.size}, fine ${view.fine.size}`);
ok(after === startBytes && Math.abs(after) < 1, 'flight: the streamer bytes go back to the start value (no leak)', `start ${startBytes}, before dispose ${(before / MB).toFixed(1)} MB, after ${after}`);

// ── complete: the shown corals are the fully grown ones ─────────────────────
{
  let same = 0;
  for (const s of shownSample) {
    const r = growChunkSync(worldFor(1, fineFor(B.c0)), s.i, s.j, B.coral, { seed: 1 });
    if (r.count === s.count && fnv(r.particles) === s.hash) same++;
  }
  ok(shownSample.length >= 1 && same === shownSample.length, 'complete: a shown coral chunk equals the chunk grown to its end on its own', `${same} of ${shownSample.length} chunks (${shownSample.map(s => s.count).join(', ')} particles)`);
}

// ── no growth animation ─────────────────────────────────────────────────────
{
  const GROW_IN = 1.4, POLYP_IN = 0.6 + 1.5;
  const worst = Math.max(...view.births);
  ok(view.births.length > 0 && view.births.every(b => b === BIRTH_PAST) && 0 - worst > Math.max(GROW_IN, POLYP_IN) * 1000, 'no growth: every written birth is far in the past (no grow-in at any page time)', `${view.texCount} texels, birth ${worst} s`);
}

// ── focus: fine meshes near the view points ─────────────────────────────────
{
  const V2 = countingView();
  const pool2 = createPool({ makeWorker: null, delay: () => new Promise(r => setImmediate(r)) });
  let clk = 0;
  const st2 = createStreamer({ seed: 1, budget: B, pool: pool2, view: V2, now: () => clk });
  // a rich chunk: find one with colonies near (400, 140)
  let eye = [400, -10, 140];
  for (let k = 0; k < 4; k++) { clk += 1000; st2.update(eye, null); await drain(pool2); }
  const cols = st2.colonies();
  ok(cols.length > 0, 'focus: the shown chunks list their colonies (world frame)', `${cols.length} colonies`);
  if (cols.length) {
    const c = cols[0];
    const p = [c.center[0] + 2, c.center[1] + 1, c.center[2] + 2];
    for (let k = 0; k < 4; k++) { clk += 1000; st2.update(eye, [p]); await drain(pool2); }
    const gotFine = [...V2.fine.keys()].includes(c.key);
    ok(gotFine, 'focus: a colony near the view point gets its fine mesh', `${V2.fine.size} fine, ${[...V2.fine.keys()].slice(0, 3).join(' ')}`);
    // the coral distance: at a particle 0, 1 m off it about 1
    const ch = st2.chunk(c.chunk), P = ch.coral.particles;
    const q = [P[0] + ch.coral.cx, P[1] + ch.coral.oy, P[2] + ch.coral.cz];
    const d0 = st2.coralDist(q[0], q[1], q[2]), d1 = st2.coralDist(q[0], q[1] + 5, q[2] + 30);
    ok(d0 < 0.01 && d1 >= 2.4, 'coral dist: 0 at a particle, the reach far from coral', `${d0.toFixed(3)}, ${d1.toFixed(2)} m`);
    // far away: the fine mesh goes
    for (let k = 0; k < 30; k++) { clk += 1000; st2.update([eye[0] + 300, -10, eye[2]], [[eye[0] + 300, -10, eye[2]]]); await drain(pool2); }
    ok(V2.fine.size === 0 && V2.events.some(e => e[0] === 'unfine'), 'focus: far view points drop the fine mesh', `${V2.fine.size} left`);
  }
  st2.dispose(); await drain(pool2);
}

console.log(`stream: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
