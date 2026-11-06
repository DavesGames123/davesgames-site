// COLLAPSE CITY · tools/check-pkg.mjs — load pkg/ in node and run a walk.
//
// Usage: node pages/wfc-city/tools/check-pkg.mjs
// It loads pkg/wfc_city.js with the wasm bytes, moves a focus point along a
// line with update(.., 24, 300), meshes the dirty chunks, drops far chunks,
// and drops a body onto the ground. It prints the wasm size, the median and
// p95 times of update and chunk_mesh, the move_body time and stats().
// Exit 1 when a check fails: wasm under 400 KB, mesh length a multiple of
// 24 floats, under 96k vertices per chunk, the body comes to rest.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, '..', 'pkg', 'wfc_city_bg.wasm');
const bytes = readFileSync(wasmPath);
const { default: init, World, version } = await import(join(here, '..', 'pkg', 'wfc_city.js'));
await init({ module_or_path: bytes });

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] || 0; };

console.log(`wfc-city ${version()}  wasm ${bytes.length} bytes`);
check(bytes.length < 400 * 1024, `wasm under 400 KB (${(bytes.length / 1024).toFixed(1)} KB)`);

const w = new World(7, 12);
check(w.module_count() > 0, `modules ${w.module_count()}, prototypes ${w.prototype_count()}`);
const tu = [], tm = [];
let maxV = 0, badLen = 0, meshes = 0, dropped = 0;
for (let s = 0; s < 240; s++) {
  const x = s * 0.5, z = Math.sin(s * 0.03) * 20;
  let t = performance.now();
  w.update(x, 1.7, z, 24, 300);
  tu.push(performance.now() - t);
  const d = w.dirty_chunks();
  for (let i = 0; i < d.length; i += 2) {
    t = performance.now();
    const m = w.chunk_mesh(d[i], d[i + 1]);
    tm.push(performance.now() - t);
    meshes++;
    if (m.length % 24) badLen++;
    maxV = Math.max(maxV, m.length / 8);
  }
  if (s % 30 === 29) dropped += w.forget_far(x, z, 48).length / 2;
}
console.log(`update  median ${q(tu, .5).toFixed(2)} ms  p95 ${q(tu, .95).toFixed(2)} ms  (${tu.length} calls, budget 300)`);
console.log(`mesh    median ${q(tm, .5).toFixed(2)} ms  p95 ${q(tm, .95).toFixed(2)} ms  (${meshes} meshes, max ${maxV} vertices)`);
check(meshes > 0 && badLen === 0, `mesh lengths are whole triangles (${badLen} bad)`);
check(maxV < 96000, `under 96k vertices per chunk (max ${maxV})`);
check(dropped > 0, `forget_far dropped ${dropped} chunks`);

const x = 120, z = Math.sin(239 * 0.03) * 20;
const gh = w.ground_height(x, z);
const st = new Float32Array([x, gh + 8, z, 0, 0, 0, 0, 0]);
const tb = [];
for (let i = 0; i < 300; i++) { const t = performance.now(); w.move_body(st, 1 / 60, 0.3, 1.7, false); tb.push(performance.now() - t); }
console.log(`body    median ${(q(tb, .5) * 1000).toFixed(1)} us  rest y ${st[1].toFixed(2)} (ground_height ${gh.toFixed(2)})`);
check(st[6] > 0.5 && Math.abs(st[4]) < 1e-3, 'the body comes to rest on a surface');

const s = w.stats();
console.log(`stats   collapsed ${s[0]}  backtracks ${s[1]}  contradictions ${s[2]}  slots ${s[3]}  chunks ${s[4]}  modules ${s[5]}  prototypes ${s[6]}  last ${s[7].toFixed(2)} ms`);
w.free();
console.log(fails ? `${fails} failed` : 'all checks passed');
process.exit(fails ? 1 : 0);
