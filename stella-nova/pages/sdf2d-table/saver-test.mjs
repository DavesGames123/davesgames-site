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
//    spread .... a lerp op (a cutter or intersector that eases its distance
//                in) shows half its change at progress 0.5: of the points
//                whose sign differs between progress 0 and 1, at least 20%
//                have flipped at 0.5. So the op grows through its step
//                and does not appear in the last few frames.
//  For each finished shape:
//    framed .... every inside point lies in the extent() circle that the
//                camera fits (radius + 0.05), so the view holds the shape
//    solid ..... some point is inside (d < 0)
//    ops ....... no more than MAX_OPS ops
//  Chain mail only:
//    woven ..... at each of the 8 crossings of the centre ring A with the
//                corner rings B, and at the same place in cells (1, 0)
//                and (1, 1) of the grid: the over wire is solid through
//                the crossing, the under wire has a gap 0.064 to each side
//                of it, and is solid again 0.12 away. The old recipe (two
//                rings in a union, then an onion) had no gap at all.
//  Phones:
//    ray ....... rayMarch (the CPU march for the sphere-tracing demo) ends
//                on the surface of every shape, with at most 16 steps, and
//                rayDemo in shaders/saver.wgsl calls no mapM (each pixel
//                used to march the ray itself: up to 14 more mapM)
//    band ...... frameView puts a shape of radius 1 inside the plate clear
//                band, at 85% of the width at most, on 360 x 640,
//                390 x 844, 844 x 390 and 1280 x 800 frames
// ============================================================================
import { SAVER } from './saver.js';
const { RECIPES, prep, steps, extent, mapM, rayMarch, frameView, MAX_OPS } = SAVER;
import { readFileSync } from 'node:fs';

const PTS = [];
for (let x = -3; x <= 3; x += 0.025) for (let y = -3; y <= 3; y += 0.025) PTS.push([x, y]);

let fails = 0;
const fail = m => { fails++; console.log('FAIL', m); };
for (const rec of RECIPES) {
  const ops = rec.ops.map(prep), ord = steps(ops);
  if (ops.length > MAX_OPS) fail(`${rec.name}: ${ops.length} ops > ${MAX_OPS}`);
  let worstPop = 0, worstSpread = 1;
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
    const op = ops.find(o => o.at === at);
    if (op.lerp) {
      set(1); const dF = PTS.map(p => mapM(ops, p));
      set(0.5); const dH = PTS.map(p => mapM(ops, p));
      let ch = 0, half = 0;
      dF.forEach((v, i) => { if ((v < 0) !== (d0[i] < 0)) { ch++; if ((dH[i] < 0) === (v < 0)) half++; } });
      const sp = ch ? half / ch : 1;
      worstSpread = Math.min(worstSpread, sp);
      if (sp < 0.2) fail(`${rec.name} step ${s} (${op.cap}): only ${(100 * sp).toFixed(1)}% of the change shows at progress 0.5`);
    }
  });
  ops.forEach(o => { o.pr = 1; });
  const ex = extent(ops, ord, -1);
  let inside = 0, outside = 0;
  for (const p of PTS) if (mapM(ops, p) < 0) { inside++; if (Math.hypot(p[0] - ex.c[0], p[1] - ex.c[1]) > ex.r + 0.05) outside++; }
  if (!inside) fail(`${rec.name}: no point is inside`);
  if (outside) fail(`${rec.name}: ${outside} inside points lie outside the camera extent`);
  console.log(`${rec.name.padEnd(18)} ops ${String(ops.length).padStart(2)}  steps ${ord.length}  worst pop ${worstPop.toFixed(4)}  spread ${worstSpread.toFixed(2)}  inside ${inside}  extent r ${ex.r.toFixed(2)}`);
}
{
  const rec = RECIPES.find(r => r.name === 'Chain mail'), ops = rec.ops.map(prep);
  ops.forEach(o => { o.pr = 1; });
  const D = Math.PI / 180, R = 0.23;
  let woven = 0;
  for (const [cx, cy] of [[0, 0], [0.6, 0], [0.6, 0.6]]) for (let k = 0; k < 4; k++) for (const [ang, aOver] of [[22.27 + 90 * k, true], [67.73 + 90 * k, false]]) {
    const P = [R * Math.cos(ang * D), R * Math.sin(ang * D)];
    const tA = [-Math.sin(ang * D), Math.cos(ang * D)];
    const rb = [P[0] - Math.sign(P[0]) * 0.3, P[1] - Math.sign(P[1]) * 0.3], lb = Math.hypot(rb[0], rb[1]), tB = [-rb[1] / lb, rb[0] / lb];
    const [tO, tU] = aOver ? [tA, tB] : [tB, tA];
    const at = (t, s) => mapM(ops, [cx + P[0] + t[0] * s, cy + P[1] + t[1] * s]);
    const ok = [0, 0.064, -0.064].every(s => at(tO, s) < 0) && [0.064, -0.064].every(s => at(tU, s) > 0) && [0.12, -0.12].every(s => at(tU, s) < 0);
    if (ok) woven++; else fail(`Chain mail: crossing at ${ang.toFixed(2)}° in cell (${cx}, ${cy}) is not woven`);
  }
  console.log(`Chain mail weave   ${woven}/24 crossings: over wire solid, under wire gapped`);
}
{
  // ray: the demo march on the CPU, as saver.js frame() runs it (14 steps
  // at most, from 1.15 r outside the shape, aimed near its centre)
  let worst = 0, most = 0;
  for (const rec of RECIPES) {
    const ops = rec.ops.map(prep); ops.forEach(o => { o.pr = 1; });
    const ex = extent(ops, steps(ops), -1);
    for (let a = 0; a < 6.28; a += 0.7) {
      const ro = [ex.c[0] + Math.cos(a) * ex.r * 1.15, ex.c[1] + Math.sin(a) * ex.r * 1.15];
      const rs = rayMarch(ops, ro, a + Math.PI + 0.1, 14), last = rs[rs.length - 1];
      most = Math.max(most, rs.length);
      const dEnd = Math.abs(mapM(ops, [ro[0] + Math.cos(a + Math.PI + 0.1) * last[3], ro[1] + Math.sin(a + Math.PI + 0.1) * last[3]]));
      if (rs.some((q, i) => i && q[3] < rs[i - 1][3])) fail(`${rec.name}: the ray reach goes back`);
      if (rs.length < 14) worst = Math.max(worst, dEnd);
    }
  }
  const wgsl = readFileSync(new URL('shaders/saver.wgsl', import.meta.url), 'utf8');
  const demo = wgsl.slice(wgsl.indexOf('fn rayDemo'), wgsl.indexOf('@fragment'));
  if (/mapM\(/.test(demo)) fail('rayDemo in saver.wgsl still calls mapM for each pixel');
  if (most > 16) fail(`rayMarch made ${most} steps (u.rs holds 16)`);
  if (worst > 0.0041) fail(`a ray that stopped early is ${worst.toFixed(4)} from the surface`);
  console.log(`Ray demo           CPU march: at most ${most} steps, stops within ${worst.toFixed(4)} of the edge; rayDemo has no mapM`);
}
{
  // band: plate bands like the shell plate on phones (t, b in CSS px)
  let ok = 0, n = 0;
  for (const [W, H, t, b] of [[360, 640, 230, 190], [390, 844, 290, 250], [844, 390, 150, 110], [1280, 800, 270, 270], [390, 844, 0, 0]]) {
    const band = t || b ? { t, b } : null, v = frameView(1, W / H, band, H);
    const cy = H / 2 * (1 - v.lift), rp = H / 2 / v.hh;
    const inBand = !band || (cy - rp >= t - 0.5 && cy + rp <= H - b + 0.5), inW = 2 * rp <= 0.85 * W + 0.5;
    n++; if (inBand && inW) ok++; else fail(`frameView ${W}x${H} band ${t}/${b}: shape ${(cy - rp).toFixed(0)}..${(cy + rp).toFixed(0)} px, width ${(2 * rp).toFixed(0)} of ${W}`);
  }
  console.log(`Clear band         ${ok}/${n} frames hold the shape in the plate clear band`);
}
console.log(fails ? `${fails} failure(s)` : 'all recipe checks pass');
process.exit(fails ? 1 : 0);
