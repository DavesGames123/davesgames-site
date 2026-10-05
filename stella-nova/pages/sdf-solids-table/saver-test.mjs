// ============================================================================
//  SDF SOLIDS TABLE  ·  saver-test.mjs — checks for the build-up saver recipes
// ----------------------------------------------------------------------------
//  Run: node saver-test.mjs   (exit code 1 on a failure)
//  It uses the JS port of mapM in saver.js, on a grid of points in the view
//  region (|p| < 2.4, above the floor). For each recipe and each step:
//    identity .. the step at progress 0 gives the same field as the state
//                before it (exact: an op at 0 is skipped)
//    no pop .... at progress 0.01 the surface moves by at most 0.03 from
//                progress 0: for each point whose sign flips, |d| at 0 is
//                below 0.03. So a cutter starts outside the solid and a
//                modifier starts small. (Empty space may change: a union
//                that grows in changes d far from the surface.)
//  For each finished solid:
//    bound ..... no surface reaches the bound sphere (radius 2.6) of the shader
//    floor ..... nothing goes below the floor (y = -1.25) by more than 0.02
//    solid ..... some point is inside (d < 0)
//    ops ....... no more than MAX_OPS ops
// ============================================================================
import { SAVER } from './saver.js';
const { RECIPES, prep, steps, mapM, MAX_OPS } = SAVER;

const PTS = [];
for (let x = -2.4; x <= 2.4; x += 0.15) for (let y = -1.25; y <= 2.4; y += 0.15) for (let z = -2.4; z <= 2.4; z += 0.15)
  if (Math.hypot(x, y, z) < 2.4) PTS.push([x, y, z]);
const SPH = [];
for (let i = 0; i < 2000; i++) { const u = Math.random() * 2 - 1, a = Math.random() * 2 * Math.PI, s = Math.sqrt(1 - u * u); SPH.push([2.6 * s * Math.cos(a), 2.6 * u, 2.6 * s * Math.sin(a)]); }
const FLOOR = [];
for (let x = -2.4; x <= 2.4; x += 0.05) for (let z = -2.4; z <= 2.4; z += 0.05) FLOOR.push([x, -1.27, z]);

let fails = 0;
const fail = m => { fails++; console.log('FAIL', m); };
for (const rec of RECIPES) {
  const ops = rec.ops.map(prep), ord = steps(ops);
  if (ops.length > MAX_OPS) fail(`${rec.name}: ${ops.length} ops > ${MAX_OPS}`);
  let worstPop = 0;
  ord.forEach((at, s) => {
    const set = pr => ops.forEach(o => { const k = ord.indexOf(o.at); o.pr = k < s ? 1 : k === s ? pr : 0; });
    set(0); const d0 = PTS.map(p => mapM(ops, p));
    // the state before this step, with this step's ops removed
    const before = ops.filter(o => ord.indexOf(o.at) < s);
    before.forEach(o => { o.pr = 1; });
    const db = PTS.map(p => mapM(before, p));
    const id = Math.max(...d0.map((v, i) => Math.abs(v - db[i])));
    if (id > 0) fail(`${rec.name} step ${s}: progress 0 differs from the state before by ${id}`);
    set(0.01); const d1 = PTS.map(p => mapM(ops, p));
    const pop = Math.max(0, ...d1.map((v, i) => (v < 0) !== (d0[i] < 0) ? Math.min(Math.abs(v), Math.abs(d0[i])) : 0));
    worstPop = Math.max(worstPop, pop);
    if (pop > 0.03) fail(`${rec.name} step ${s} (${ops.find(o => o.at === at).cap}): progress 0.01 moves the field by ${pop.toFixed(3)}`);
  });
  ops.forEach(o => { o.pr = 1; });
  const bound = Math.min(...SPH.map(p => mapM(ops, p)));
  const floor = Math.min(...FLOOR.map(p => mapM(ops, p)));
  const inside = PTS.some(p => mapM(ops, p) < 0);
  if (bound < 0.02) fail(`${rec.name}: the solid reaches the bound sphere (min d ${bound.toFixed(3)})`);
  if (floor < -0.02) fail(`${rec.name}: the solid goes below the floor (min d ${floor.toFixed(3)})`);
  if (!inside) fail(`${rec.name}: no point is inside`);
  console.log(`${rec.name.padEnd(16)} ops ${String(ops.length).padStart(2)}  steps ${ord.length}  worst pop ${worstPop.toFixed(4)}  bound gap ${bound.toFixed(3)}  floor gap ${floor.toFixed(3)}`);
}
console.log(fails ? `${fails} failure(s)` : 'all recipe checks pass');
process.exit(fails ? 1 : 0);
