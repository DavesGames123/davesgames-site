// ============================================================================
//  SDF 2D TABLE  ·  saver-test.mjs — checks for the build-up saver recipes
// ----------------------------------------------------------------------------
//  Run: node saver-test.mjs   (exit code 1 on a failure)
//  It uses the JS port of mapM in saver.js, on a grid of points (|x|, |y|
//  < 3). For each recipe and each step:
//    identity .. the step at progress 0 gives the same field as the state
//                before it (exact: an op at 0 is skipped)
//    no pop .... at progress 0.01 the edge moves by at most 0.03 from
//                progress 0: for each point whose sign flips, |d| at 0 is
//                below 0.03. So a cutter starts outside the shape and a
//                modifier starts small.
//  For each finished shape:
//    framed .... every inside point lies in the extent() circle that the
//                camera fits (radius + 0.05), so the view holds the shape
//    solid ..... some point is inside (d < 0)
//    ops ....... no more than MAX_OPS ops
// ============================================================================
import { SAVER } from './saver.js';
const { RECIPES, prep, steps, extent, mapM, MAX_OPS } = SAVER;

const PTS = [];
for (let x = -3; x <= 3; x += 0.025) for (let y = -3; y <= 3; y += 0.025) PTS.push([x, y]);

let fails = 0;
const fail = m => { fails++; console.log('FAIL', m); };
for (const rec of RECIPES) {
  const ops = rec.ops.map(prep), ord = steps(ops);
  if (ops.length > MAX_OPS) fail(`${rec.name}: ${ops.length} ops > ${MAX_OPS}`);
  let worstPop = 0;
  ord.forEach((at, s) => {
    const set = pr => ops.forEach(o => { const k = ord.indexOf(o.at); o.pr = k < s ? 1 : k === s ? pr : 0; });
    set(0); const d0 = PTS.map(p => mapM(ops, p));
    const before = ops.filter(o => ord.indexOf(o.at) < s);
    const db = PTS.map(p => mapM(before, p));
    const id = Math.max(...d0.map((v, i) => Math.abs(v - db[i])));
    if (id > 0) fail(`${rec.name} step ${s}: progress 0 differs from the state before by ${id}`);
    set(0.01); const d1 = PTS.map(p => mapM(ops, p));
    const pop = Math.max(0, ...d1.map((v, i) => (v < 0) !== (d0[i] < 0) ? Math.min(Math.abs(v), Math.abs(d0[i])) : 0));
    worstPop = Math.max(worstPop, pop);
    if (pop > 0.03) fail(`${rec.name} step ${s} (${ops.find(o => o.at === at).cap}): progress 0.01 moves the edge by ${pop.toFixed(3)}`);
  });
  ops.forEach(o => { o.pr = 1; });
  const ex = extent(ops, ord, -1);
  let inside = 0, outside = 0;
  for (const p of PTS) if (mapM(ops, p) < 0) { inside++; if (Math.hypot(p[0] - ex.c[0], p[1] - ex.c[1]) > ex.r + 0.05) outside++; }
  if (!inside) fail(`${rec.name}: no point is inside`);
  if (outside) fail(`${rec.name}: ${outside} inside points lie outside the camera extent`);
  console.log(`${rec.name.padEnd(18)} ops ${String(ops.length).padStart(2)}  steps ${ord.length}  worst pop ${worstPop.toFixed(4)}  inside ${inside}  extent r ${ex.r.toFixed(2)}`);
}
console.log(fails ? `${fails} failure(s)` : 'all recipe checks pass');
process.exit(fails ? 1 : 0);
