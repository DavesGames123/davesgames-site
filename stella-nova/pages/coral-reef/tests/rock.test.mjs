// ============================================================================
//  CORAL REEF  ·  tests/rock.test.mjs  ·  node checks of the ROCK package
// ----------------------------------------------------------------------------
//    node pages/coral-reef/tests/rock.test.mjs [--quick]
//  It exits with code 1 when a check fails. No browser.
//  Checks: determinism, arches (a vertical ray from the sand goes through
//  open water, then rock, then open water), canyons (open floor, walls on
//  both sides, undercut), the mesh and the SDF agree, the mesh is closed,
//  sampleSurface points sit on the surface with outward normals, the plot
//  fades past R, textures exist, and the build time (module workers through
//  a node worker_threads adapter, budget 2.5 s; ROCK_BUDGET_MS changes it).
//  When the load average is over 0.75 x the core count and the build is
//  over budget, the time check prints SKIP (not ok): set ROCK_BUDGET_STRICT
//  to make it fail then.
// ============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker as WT } from 'node:worker_threads';
import { createRock, createRockAsync } from '../rock/index.js';
import { makeGeology } from '../rock/geology.js';
import { meshStats } from '../../../lib/dla-sdf.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.resolve(HERE, '..');
const QUICK = process.argv.includes('--quick');
let fails = 0, passes = 0;
function ok(cond, name, info = '') {
  if (cond) { passes++; console.log(`ok   ${name}${info ? '  ' + info : ''}`); }
  else { fails++; console.log(`FAIL ${name}${info ? '  ' + info : ''}`); }
}

const SEEDS = QUICK ? [1, 2, 3] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// Vertical ray from the sand up: the run of open / rock / open states.
function rayPattern(sdf, x, z, y0, y1, step = 0.05) {
  const runs = [];
  for (let y = y0; y <= y1; y += step) {
    const s = sdf(x, y, z) < 0 ? 'R' : 'o';
    if (runs[runs.length - 1] !== s) runs.push(s);
  }
  return runs.join('');
}

// ── determinism ───────────────────────────────────────────────────────────
{
  const a = createRock({ seed: 7, quality: 'low' }), b = createRock({ seed: 7, quality: 'low' });
  let same = a.meshes.length === b.meshes.length;
  for (let i = 0; same && i < a.meshes.length; i++) {
    const p = a.meshes[i].positions, q = b.meshes[i].positions;
    if (p.length !== q.length) { same = false; break; }
    for (let k = 0; k < p.length; k++) if (p[k] !== q[k]) { same = false; break; }
  }
  ok(same, 'determinism: same seed gives the same mesh', `${a.meshes.length} chunks, ${a.stats.tris} tris`);
  ok(JSON.stringify(a.features) === JSON.stringify(b.features), 'determinism: same features');
  const c = makeGeology({ seed: 8 });
  let diff = 0;
  for (let i = 0; i < 200; i++) { const x = (i % 20) * 2.5 - 25, z = Math.floor(i / 20) * 5 - 25; if (Math.sign(a.sdf(x, 2, z)) !== Math.sign(c.sdf(x, 2, z))) diff++; }
  ok(diff > 20, 'determinism: another seed gives other rock', `${diff}/200 sign changes`);
}

// ── arches and canyons on every seed ──────────────────────────────────────
{
  const rows = [];
  let archFail = [], canyonFail = [], undercutSum = 0, undercutN = 0;
  for (const seed of SEEDS) {
    const g = makeGeology({ seed, radius: 30 });
    const kinds = {};
    for (const f of g.features) kinds[f.kind] = (kinds[f.kind] || 0) + 1;
    // arches: open, rock, open on a vertical ray at the centre of the gap
    let arches = 0;
    for (const f of g.features) {
      if (f.kind !== 'arch') continue;
      const [x, , z] = f.center;
      const s = g.sandAt(x, z);
      const pat = rayPattern(g.sdf, x, z, s + 0.15, f.top + 2.5);
      if (/^oR+o$/.test(pat) || /^oRo/.test(pat)) arches++;
    }
    if (arches < 2) archFail.push(`${seed}:${arches}`);
    // canyons: the trunk has an open floor and walls on both sides
    const trunk = g.features.find(f => f.kind === 'canyon' && f.id === 0);
    let floor = 0, walls = 0, n = 0;
    if (trunk) {
      const P = trunk.path;
      for (let i = 1; i < P.length - 1; i++) {
        const [x, s, z] = P[i];
        if (Math.hypot(x, z) > 0.8 * g.R) continue;
        n++;
        if (g.sdf(x, s + 0.7, z) > 0) floor++;
        const dx = P[i + 1][0] - P[i - 1][0], dz = P[i + 1][2] - P[i - 1][2], l = Math.hypot(dx, dz);
        const px = -dz / l, pz = dx / l;
        const hit = (side, y) => { for (let d = 0.2; d < 9; d += 0.1) if (g.sdf(x + px * side * d, y, z + pz * side * d) < 0) return d; return Infinity; };
        const a = hit(1, s + 2.5), b = hit(-1, s + 2.5);
        if (a < 9 && b < 9) {
          walls++;
          const lo = Math.min(hit(1, s + 0.8), 9) + Math.min(hit(-1, s + 0.8), 9);
          undercutSum += lo - (a + b); undercutN++;
        }
      }
    }
    if (!trunk || floor < 0.85 * n || walls < 0.6 * n) canyonFail.push(`${seed}:${floor}/${walls}/${n}`);
    rows.push(`${seed}: ${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(', ')}; arches pass ${arches}; trunk floor ${floor}/${n} walls ${walls}/${n}`);
  }
  for (const r of rows) console.log('     seed ' + r);
  ok(!archFail.length, `arches: at least 2 arches with an open gap under rock, ${SEEDS.length} seeds`, archFail.join(' '));
  ok(!canyonFail.length, `canyons: trunk floor open and walls on both sides, ${SEEDS.length} seeds`, canyonFail.join(' '));
  ok(undercutN > 0 && undercutSum / undercutN > 0.15, 'canyons: walls are undercut (wider at 0.8 m than at 2.5 m)', `mean ${(undercutSum / Math.max(1, undercutN)).toFixed(2)} m`);
  // other feature kinds appear over the seeds
  const all = new Set();
  for (const seed of SEEDS) for (const f of makeGeology({ seed }).features) all.add(f.kind);
  ok(['arch', 'canyon', 'pinnacle', 'overhang', 'cave', 'ledge'].every(k => all.has(k)), 'features: every kind appears', [...all].join(' '));
}

// ── no floating rock ──────────────────────────────────────────────────────
// Flood fill the solid lattice (0.3 m) from the voxels at or under the sand.
// What the fill does not reach floats in the water.
function floating(geo, h = 0.3) {
  const E = 1.32 * geo.R, n = Math.ceil(2 * E / h), ny = Math.ceil((geo.yMax + 2.5) / h);
  const solid = new Uint8Array(n * n * ny), seen = new Uint8Array(n * n * ny), st = [];
  for (let k = 0; k < n; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < n; i++) if (geo.sdf(-E + i * h, -2.4 + j * h, -E + k * h) < 0) solid[(k * ny + j) * n + i] = 1;
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
    const sy = geo.sandAt(-E + i * h, -E + k * h);
    for (let j = 0; j < ny && -2.4 + j * h < sy + 0.25; j++) { const q = (k * ny + j) * n + i; if (solid[q]) { seen[q] = 1; st.push(q); } }
  }
  const nb = [1, -1, n, -n, n * ny, -n * ny];
  const walk = (stack) => { let c = 0; while (stack.length) { const q = stack.pop(); c++; const i = q % n, j = Math.floor(q / n) % ny, k = Math.floor(q / (n * ny)); for (let t = 0; t < 6; t++) { if ((t === 0 && i === n - 1) || (t === 1 && i === 0) || (t === 2 && j === ny - 1) || (t === 3 && j === 0) || (t === 4 && k === n - 1) || (t === 5 && k === 0)) continue; const p = q + nb[t]; if (solid[p] && !seen[p]) { seen[p] = 1; stack.push(p); } } } return c; };
  walk(st);
  const comps = [];
  for (let q = 0; q < solid.length; q++) if (solid[q] && !seen[q]) { seen[q] = 1; comps.push(walk([q]) * h ** 3); }
  return comps.sort((a, b) => b - a);
}
for (const seed of QUICK ? [1] : [1, 5, 9]) {
  const comps = floating(makeGeology({ seed, quality: 'medium' }));
  const tot = comps.reduce((a, b) => a + b, 0);
  ok((comps[0] || 0) < 0.5 && tot < 3, `no floating rock, seed ${seed} (0.3 m lattice)`, `${comps.length} loose voxel groups, largest ${(comps[0] || 0).toFixed(2)} m3, total ${tot.toFixed(2)} m3`);
}

// ── mesh and SDF agree, closed mesh, samples ──────────────────────────────
{
  const rock = createRock({ seed: 3, quality: QUICK ? 'low' : 'medium' });
  const cell = rock.stats.cell;
  // Surface nets puts a vertex at the mean of the edge crossings in its
  // cell, so at creases it sits up to about half a cell off the zero level.
  const ds = [];
  for (const m of rock.meshes) {
    const P = m.positions;
    for (let i = 0; i < P.length; i += 9) ds.push(Math.abs(rock.sdf(P[i], P[i + 1], P[i + 2])));
  }
  ds.sort((a, b) => a - b);
  const mean = ds.reduce((a, b) => a + b, 0) / ds.length, p99 = ds[Math.floor(ds.length * 0.99)], worst = ds[ds.length - 1];
  ok(mean < 0.15 * cell && p99 < 0.6 * cell && worst < 1.5 * cell, 'mesh vertices lie on the SDF zero level', `mean |sdf| ${mean.toFixed(3)}, p99 ${p99.toFixed(3)}, max ${worst.toFixed(3)} m over ${ds.length} vertices (cell ${cell} m)`);
  let flip = 0, nn = 0;
  for (const m of rock.meshes) for (let i = 0; i < m.positions.length; i += 27) {
    const P = m.positions, N = m.normals;
    const g = rock.normal(P[i], P[i + 1], P[i + 2], cell * 0.5);
    if (g[0] * N[i] + g[1] * N[i + 1] + g[2] * N[i + 2] < 0.5) flip++;
    nn++;
  }
  ok(flip / nn < 0.02, 'mesh normals follow the SDF gradient', `${flip}/${nn} off by more than 60 degrees`);
  const st = meshStats(rock.meshes.map(m => ({ positions: m.positions, indices: m.indices })));
  ok(st.boundaryEdges === 0, 'mesh is closed (no boundary edges after a weld)', `${st.tris} tris, ${st.boundaryEdges} boundary edges, ${st.nonManifold} non-manifold`);
  const R = rock.radius;
  ok(rock.meshes.every(m => Math.hypot(m.bounds.min[0], m.bounds.min[2]) > 0 && m.bounds.max[1] <= rock.bounds.max[1] + 1e-3), 'chunk bounds inside rock.bounds');
  // fade: no rock past 1.32 R, less rock in the ring R..1.3R than inside
  let past = 0, inner = 0, ring = 0, ni = 0, nr = 0;
  for (let a = 0; a < 360; a += 3) for (const y of [0.5, 2, 4]) {
    const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180);
    if (rock.sdf(c * 1.33 * R, y, s * 1.33 * R) < 0) past++;
    for (const f of [0.3, 0.5, 0.7, 0.9]) { ni++; if (rock.sdf(c * f * R, y, s * f * R) < 0) inner++; }
    for (const f of [1.1, 1.2, 1.28]) { nr++; if (rock.sdf(c * f * R, y, s * f * R) < 0) ring++; }
  }
  ok(past === 0 && ring / nr < 0.6 * inner / ni, 'rock thins past R and ends by 1.32 R', `inside ${(inner / ni).toFixed(2)}, ring ${(ring / nr).toFixed(2)}, past ${past}`);
  // sand
  let sandOk = true;
  for (let i = 0; i < 100; i++) { const h = rock.sand.heightAt(i * 0.7 - 35, 20 - i * 0.4); if (!Number.isFinite(h) || Math.abs(h) > 3) sandOk = false; }
  const sm = rock.sand.mesh;
  ok(sandOk && sm.indices.length % 3 === 0 && Math.max(...sm.indices.subarray(0, 600)) < sm.positions.length / 3, 'sand heightAt is finite and the sand mesh is valid', `${sm.indices.length / 3} tris`);
  // samples
  const S = rock.sampleSurface(400);
  let on = 0, outw = 0, above = 0;
  for (const s of S) {
    const [x, y, z] = s.p, n = s.n;
    if (Math.abs(rock.sdf(x, y, z)) < 0.01) on++;
    if (rock.sdf(x + n[0] * 0.1, y + n[1] * 0.1, z + n[2] * 0.1) > 0.02 && rock.sdf(x - n[0] * 0.1, y - n[1] * 0.1, z - n[2] * 0.1) < -0.02) outw++;
    if (y >= rock.sand.heightAt(x, z) && Math.hypot(x, z) <= R) above++;
  }
  ok(S.length === 400 && on === S.length, 'sampleSurface: points on the surface', `${on}/${S.length} within 1 cm`);
  ok(outw >= 0.95 * S.length, 'sampleSurface: normals point out of the rock', `${outw}/${S.length}`);
  ok(above === S.length, 'sampleSurface: above the sand, inside R');
  const ex = S.map(s => s.exposure);
  ok(Math.min(...ex) >= 0 && Math.max(...ex) <= 1 && S.some(s => s.overhang) && S.some(s => !s.overhang), 'sampleSurface: exposure in 0..1, both overhang states', `mean exposure ${(ex.reduce((a, b) => a + b, 0) / ex.length).toFixed(2)}, overhang ${S.filter(s => s.overhang).length}`);
  const up = rock.sampleSurface(50, null, s => s.exposure > 0.7);
  ok(up.length === 50 && up.every(s => s.exposure > 0.7), 'sampleSurface: the filter works');
}

// ── textures and credits ──────────────────────────────────────────────────
{
  const rock = createRock({ seed: 1, mesh: false });
  const files = Object.values(rock.textures).map(p => path.join(PAGE, p));
  ok(files.every(f => fs.existsSync(f) && fs.statSync(f).size > 50000), 'rock textures exist', Object.values(rock.textures).join(', '));
  const cr = fs.readFileSync(path.join(PAGE, 'rock', 'CREDITS.txt'), 'utf8');
  ok(/rock_3/.test(cr) && /CC0/.test(cr), 'rock/CREDITS.txt names the texture source and licence');
}

// ── build time with module workers (node adapter) ─────────────────────────
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
  const cores = os.cpus().length;
  const workers = Math.max(2, Math.min(12, cores - 1));
  const budget = +(process.env.ROCK_BUDGET_MS || 2500);
  const t0 = performance.now();
  const rock = await createRockAsync({ seed: 5, quality: 'high' }, { Worker: NodeWorker, workers, workerUrl: pathToFileURL(path.join(PAGE, 'rock', 'worker.js')) });
  const ms = performance.now() - t0;
  const sync = createRock({ seed: 5, quality: 'low' });
  ok(rock.meshes.length > 50 && rock.stats.tris > 300000, 'worker build gives the high quality mesh', `${rock.stats.tris} tris, ${rock.meshes.length} chunks`);
  const load = os.loadavg()[0];
  const info = `${ms.toFixed(0)} ms (plan ${rock.stats.planMs.toFixed(0)} ms); low quality on one thread ${(sync.stats.planMs + sync.stats.meshMs).toFixed(0)} ms, ${sync.stats.tris} tris; load ${load.toFixed(1)} on ${cores} cores`;
  if (load > cores * 0.75 && ms >= budget && !process.env.ROCK_BUDGET_STRICT) console.log(`SKIP build time, high quality, ${workers} workers, under ${budget} ms (machine busy)  ${info}`);
  else ok(ms < budget, `build time, high quality, ${workers} workers, under ${budget} ms`, info);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
