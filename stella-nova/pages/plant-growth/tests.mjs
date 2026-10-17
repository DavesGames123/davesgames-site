// ============================================================================
//  PLANT GROWTH  ·  node tests for the DOM-free modules
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/plant-growth/tests.mjs   (exit 1 on a failure)
//  Covers grow.js (colonisation step, pipe model, species envelopes,
//  flowers), roots.js (DLA roots grow down), pose.js (colour modes, the
//  frame pass) and saver.js (shot list, framing maths, code extract).
// ============================================================================
import { SPECIES, SPECIES_IDS, createPlant, growFull, envelopeBounds, envelopeSphere, insideEnvelope, plantSegments, LEAF_STRIDE } from './grow.js';
import { createRoots } from './roots.js';
import { COLOUR_MODES, COLOUR_IDS, colourT, plantView, rootsView, createPoser } from './pose.js';
import { makeShots, shotRate, bandFrame, fitDistance, projectedRadius, codeExtract } from './saver.js';
import { rng } from '../../lib/dla-engine.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const finite = a => { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; };

// --- colonisation step ------------------------------------------------------
{
  const p = createPlant({ species: 'oak', seed: 11 });
  const a0 = p.aliveCount;
  let guard = 0;
  while (!p.reached && guard++ < 100) p.step();
  ok(p.reached, 'the trunk reaches the crown');
  // the node with the most pulls: its next child points along the mean pull
  let best = -1, pulls = [];
  for (let v = 0; v < p.count; v++) { const q = p.pullsOf(v); if (q.length > pulls.length) { pulls = q; best = v; } }
  ok(best >= 0 && pulls.length > 0, 'some node has attractors in its influence radius');
  const m = [0, 0, 0];
  for (const a of pulls) {
    const dx = p.attractors[a * 3] - p.pos[best * 3], dy = p.attractors[a * 3 + 1] - p.pos[best * 3 + 1], dz = p.attractors[a * 3 + 2] - p.pos[best * 3 + 2];
    const l = Math.hypot(dx, dy, dz); m[0] += dx / l; m[1] += dy / l; m[2] += dz / l;
  }
  const ml = Math.hypot(...m);
  const n0 = p.count; p.step();
  let child = -1; for (let i = n0; i < p.count; i++) if (p.parent[i] === best) child = i;
  ok(child > 0, 'the pulled node grows a child');
  if (child > 0) {
    const cx = p.pos[child * 3] - p.pos[best * 3], cy = p.pos[child * 3 + 1] - p.pos[best * 3 + 1], cz = p.pos[child * 3 + 2] - p.pos[best * 3 + 2];
    const cl = Math.hypot(cx, cy, cz);
    ok(Math.abs(cl - p.D) < 1e-4 || cy === 0, `the child is D away (${cl.toFixed(4)} vs ${p.D})`);
    const dot = (cx * m[0] + cy * m[1] + cz * m[2]) / (cl * ml);
    ok(dot > 0.8, `the child grows toward its attractors (cos ${dot.toFixed(3)})`);
  }
  while (!p.done && guard++ < 1000) p.step();
  ok(p.done, 'the oak finishes');
  ok(p.aliveCount < a0 * 0.1, `attractors are consumed (${a0} -> ${p.aliveCount})`);
  ok(finite(p.pos.subarray(0, p.count * 3)) && finite(p.radius.subarray(0, p.count)), 'no NaN in positions or radii');
  let mono = true, tipsOk = true;
  for (let i = 1; i < p.count; i++) {
    const q = p.parent[i];
    if (p.radius[q] + 1e-7 < p.radius[i]) mono = false;
    if (p.tips[q] < p.tips[i]) tipsOk = false;
  }
  ok(mono, 'pipe radius never falls toward the root');
  ok(tipsOk, 'tip counts never fall toward the root');
  ok(p.tips[0] === p.tipCount, `the root carries every tip (${p.tips[0]} = ${p.tipCount})`);
  const expect = Math.pow(p.tipCount * Math.pow(p.r0, SPECIES.oak.pipe), 1 / SPECIES.oak.pipe);
  ok(Math.abs(p.radius[0] - expect) / expect < 1e-4, `root radius follows r^p = N r0^p (${p.radius[0].toFixed(4)})`);
  // a node is never on top of another
  let minD = Infinity;
  for (let i = 1; i < Math.min(p.count, 600); i++) for (let j = 0; j < i; j++) {
    const d = Math.hypot(p.pos[i * 3] - p.pos[j * 3], p.pos[i * 3 + 1] - p.pos[j * 3 + 1], p.pos[i * 3 + 2] - p.pos[j * 3 + 2]);
    if (d < minD) minD = d;
  }
  ok(minD > 0.3 * p.D, `nodes keep apart (min ${minD.toFixed(3)})`);
  const b = createPlant({ species: 'oak', seed: 11 }); while (!b.done) b.step();
  ok(b.count === p.count && b.pos[b.count * 3 - 1] === p.pos[p.count * 3 - 1], 'the same seed gives the same plant');
}

// --- species presets --------------------------------------------------------
for (const id of SPECIES_IDS) {
  const p = growFull(id, { seed: 5 });
  const B = envelopeBounds(p.env), m = p.di + p.D;
  let inside = true, attrIn = true;
  for (let i = 0; i < p.count; i++) {
    const x = p.pos[i * 3], y = p.pos[i * 3 + 1], z = p.pos[i * 3 + 2];
    const stem = Math.hypot(x, z) < 2 * p.D * 3 && y <= B[4];
    if (!stem && (x < B[0] - m || x > B[3] + m || z < B[2] - m || z > B[5] + m || y > B[4] + m || y < 0)) inside = false;
  }
  for (let a = 0; a < p.nAttractors; a++) if (!insideEnvelope(p.env, p.attractors[a * 3], p.attractors[a * 3 + 1], p.attractors[a * 3 + 2])) attrIn = false;
  ok(attrIn, `${id}: attractors are in the envelope`);
  ok(inside, `${id}: nodes stay within the envelope plus di + D`);
  ok(p.done && p.count > 150 && p.count <= p.maxNodes, `${id}: grows and stops (${p.count} nodes, ${p.iter} steps)`);
  ok(p.maxY > B[4] * 0.75, `${id}: fills the crown height (${p.maxY.toFixed(2)} of ${B[4].toFixed(2)})`);
  ok(p.leafCount > 50, `${id}: has leaves (${p.leafCount})`);
  let flowers = 0;
  for (let k = 0; k < p.leafCount; k++) if (p.leaves[k * LEAF_STRIDE + 5] === 1) flowers++;
  ok(SPECIES[id].flower ? flowers > 5 : flowers === 0, `${id}: flowers ${flowers}`);
  const S = envelopeSphere(p.env);
  let out = 0;
  for (let i = 0; i < p.count; i++) if (Math.hypot(p.pos[i * 3] - S.c[0], p.pos[i * 3 + 1] - S.c[1], p.pos[i * 3 + 2] - S.c[2]) > S.r + p.di + p.D) out++;
  ok(out === 0, `${id}: the framing sphere holds the plant (${out} out)`);
  const est = p.estIters();
  ok(est > p.iter * 0.5 && est < p.iter * 3, `${id}: step estimate ${est} near ${p.iter}`);
}
{
  // form checks: the conifer is slender, the willow hangs, the fern is a tuft
  const width = p => { let w = 0; for (let i = 0; i < p.count; i++) w = Math.max(w, Math.hypot(p.pos[i * 3], p.pos[i * 3 + 2])); return w; };
  const c = growFull('conifer', { seed: 2 }), o = growFull('oak', { seed: 2 }), w = growFull('willow', { seed: 2 }), f = growFull('fern', { seed: 2 });
  ok(c.maxY / width(c) > o.maxY / width(o) * 1.4, 'conifer is more slender than oak');
  let low = 0; for (let i = 0; i < w.count; i++) if (w.pos[i * 3 + 1] < 2.5 && Math.hypot(w.pos[i * 3], w.pos[i * 3 + 2]) > 2) low++;
  ok(low > 50, `willow shoots hang low at the rim (${low} nodes)`);
  let stems = 0; for (let i = 1; i < f.count; i++) if (f.parent[i] === 0) stems++;
  ok(stems >= 6, `fern grows from ${stems} stems`);
  const fl = createPlant({ species: 'oak', seed: 3, flat: true }); while (!fl.done) fl.step();
  let z0 = true; for (let i = 0; i < fl.count; i++) if (fl.pos[i * 3 + 2] !== 0) z0 = false;
  ok(z0 && fl.count > 50, 'a flat plant stays in z = 0');
  const segs = plantSegments(o, i => o.radius[i]);
  ok(segs.segments.length === o.count - 1 && segs.leaves.length === o.leafCount, 'plantSegments gives one segment per node');
}

// --- roots by DLA -----------------------------------------------------------
{
  const r = createRoots({ seed: 4, max: 900, scale: 0.08 });
  r.grow(900); r.stamp(3);
  const m = r.model;
  let maxY = -Infinity, depth = 0, lat = 0;
  for (let i = 1; i < m.count; i++) {
    maxY = Math.max(maxY, m.pos[i * 3 + 1]); depth = Math.max(depth, -m.pos[i * 3 + 1]); lat = Math.max(lat, Math.hypot(m.pos[i * 3], m.pos[i * 3 + 2]));
  }
  ok(m.count === 900, 'roots reach the cap');
  ok(maxY < 0, `roots stay under the ground (top ${maxY.toFixed(2)})`);
  ok(depth > lat * 1.2, `roots grow down (depth ${depth.toFixed(1)} vs lateral ${lat.toFixed(1)})`);
  let mono = true; for (let i = 1; i < m.count; i++) if (r.radius[m.parent[i]] < r.radius[i]) mono = false;
  ok(mono, 'root radius never falls toward the crown');
  ok(Math.abs(r.depth - depth * 0.08) < 1e-6, 'depth in metres');
  ok(r.grow(10) === 0, 'roots stop at the cap');
}

// --- colour modes -----------------------------------------------------------
{
  const p = growFull('bush', { seed: 9 }), v = plantView(p), clock = p.iter;
  const range = { yMin: -1, yMax: p.maxY };
  ok(COLOUR_IDS[0] === 'natural' && COLOUR_MODES.length === 6, 'six colour modes, natural first');
  for (const mode of COLOUR_IDS) {
    let lo = Infinity, hi = -Infinity, bad = false;
    for (let i = 0; i < p.count; i++) { const t = colourT(v, i, mode, clock, range); if (!(t >= 0 && t <= 1)) bad = true; lo = Math.min(lo, t); hi = Math.max(hi, t); }
    ok(!bad, `${mode}: t in 0..1`);
    if (mode !== 'natural' && mode !== 'light') ok(hi - lo > 0.3, `${mode}: spans the gradient (${lo.toFixed(2)}..${hi.toFixed(2)})`);
  }
  let newest = 0; for (let i = 0; i < p.count; i++) if (p.born[i] > p.born[newest]) newest = i;
  ok(Math.abs(colourT(v, newest, 'age', p.born[newest]) - 1) < 1e-9, 'age: the newest node is at the hot end');
  ok(colourT(v, 0, 'age', clock) === 0, 'age: the seed node is at the cold end');
  ok(colourT(v, 0, 'flow', clock) === 1, 'flow: the root node carries the most');
  let top = 0; for (let i = 0; i < p.count; i++) if (p.pos[i * 3 + 1] > p.pos[top * 3 + 1]) top = i;
  ok(Math.abs(colourT(v, top, 'height', clock, range) - 1) < 1e-6, 'height: the top node is 1');
  let lmin = 1; for (let i = 0; i < p.count; i++) lmin = Math.min(lmin, p.light[i]);
  ok(lmin < 0.6 && p.light[top] > 0.9, `light: shade inside the crown (${lmin.toFixed(2)}), sun at the top (${p.light[top].toFixed(2)})`);
  const r = createRoots({ seed: 2, max: 300, scale: 0.05 }); r.grow(300); r.stamp(5);
  const rv = rootsView(r);
  ok(colourT(rv, 10, 'light', 5) === 0 && colourT(rv, 0, 'flow', 5) === 1, 'roots: no light, the crown carries the flow');
  ok(colourT(rv, 299, 'height', 5, { yMin: -r.depth, yMax: 2 }) < colourT(v, top, 'height', clock, { yMin: -r.depth, yMax: 2 }), 'roots sit under the crown in height');
}

// --- frame pass -------------------------------------------------------------
{
  const p = createPlant({ species: 'sapling', seed: 3 });
  for (let k = 0; k < 12; k++) p.step();
  const v = plantView(p), ps = createPoser();
  const P = new Float32Array(p.count * 4), C = new Float32Array(p.count * 4);
  const last = p.count - 1, clock = p.born[last];       // the newest segment has length 0
  ps.fill(v, { clock, time: 3, dt: 0.016, wind: 0, mode: 'age', range: { yMin: 0, yMax: 4 } }, P, C);
  ok(finite(P) && finite(C), 'pose: no NaN');
  const q = p.parent[last];
  ok(Math.hypot(P[last * 4] - P[q * 4], P[last * 4 + 1] - P[q * 4 + 1], P[last * 4 + 2] - P[q * 4 + 2]) < 1e-6, 'pose: a new segment starts at its parent');
  ok(C[last * 4 + 2] === q && C[last * 4 + 3] === 0, 'pose: col row holds the parent id and growth 0');
  ps.fill(v, { clock: clock + 1, time: 3, dt: 0.016, wind: 0, mode: 'age' }, P, C);
  const L = Math.hypot(P[last * 4] - P[q * 4], P[last * 4 + 1] - P[q * 4 + 1], P[last * 4 + 2] - P[q * 4 + 2]);
  ok(Math.abs(L - p.D) < 1e-5 && C[last * 4 + 3] === 1, `pose: grown after one step (${L.toFixed(4)})`);
  ps.fill(v, { clock: clock + 20, time: 3, dt: 0.016, wind: 0, mode: 'age', ageRef: clock }, P, C);
  ok(Math.abs(C[last * 4] - 1) < 1e-6, 'pose: ageRef keeps the newest node at the hot end after the clock runs on');
  ps.fill(v, { clock: clock + 1, time: 3, dt: 0.016, wind: 0, mode: 'age' }, P, C);
  const still = P.slice();
  ps.fill(v, { clock: clock + 1, time: 3, dt: 0.016, wind: 1, mode: 'age' }, P, C);
  let d0 = Math.hypot(P[0] - still[0], P[1] - still[1], P[2] - still[2]), tipMove = 0;
  for (let i = 1; i < p.count; i++) if (p.kids[i] === 0) tipMove = Math.max(tipMove, Math.hypot(P[i * 4] - still[i * 4], P[i * 4 + 2] - still[i * 4 + 2]));
  ok(d0 === 0 && tipMove > 0.005, `wind: the root stays, tips move (${tipMove.toFixed(3)} m)`);
}

// --- saver ------------------------------------------------------------------
{
  const a = makeShots(rng(42), 18), b = makeShots(rng(42), 18), c = makeShots(rng(43), 18);
  ok(JSON.stringify(a) === JSON.stringify(b), 'shots: the same seed gives the same list');
  ok(JSON.stringify(a) !== JSON.stringify(c), 'shots: another seed gives another list');
  ok(a.every(s => s.dur >= 5 && s.dur <= 12), 'shots: 5 to 12 s each');
  ok(a.every((s, i) => i === 0 || s.species !== a[i - 1].species), 'shots: no species twice in a row');
  ok(new Set(a.slice(0, 6).map(s => s.species)).size === 6, 'shots: every species in the first round');
  ok(new Set(a.map(s => s.mode)).size >= 3 && new Set(a.map(s => s.gradient)).size >= 3, 'shots: modes and gradients vary');
  ok(shotRate(40, 10) > 5 && shotRate(40, 10) < 6 && shotRate(1, 10) === 3 && shotRate(1e4, 5) === 40, 'shot rate');
  const fov = 40;
  for (const [w, h] of [[1920, 1080], [1080, 1920], [390, 844]]) {
    const band = { t: h * 0.24, b: h * 0.3, w };
    const f = bandFrame(band, w, h);
    ok(Math.abs(f.offY - (band.b - band.t) / 2) < 1e-9 && f.offY > 0, `${w}x${h}: offset puts the band centre at the image centre`);
    for (const id of SPECIES_IDS) {
      const S = envelopeSphere(growFull(id, { seed: 1 }).env);
      const d = fitDistance(S.r, fov, w / h, f.hFrac, f.wFrac, 0.82);
      const pr = projectedRadius(S.r, d, fov, h);
      const bandH = h - f.t - f.b;
      ok(2 * pr <= bandH * 0.83 + 1e-6 && 2 * pr <= w * 0.83 + 1e-6 && 2 * pr > Math.min(bandH, w) * 0.7, `${w}x${h} ${id}: fits the band (${(2 * pr).toFixed(0)} px of ${bandH.toFixed(0)} x ${w})`);
    }
  }
  ok(bandFrame(null, 100, 100).hFrac === 1, 'no band: the full frame');
  const big = bandFrame({ t: 900, b: 900 }, 1000, 1000);
  ok(big.hFrac >= 0.16 && big.t <= 420, 'a tall plate keeps a band');
  const src = createPlant({ species: 'oak' }).step.toString(), code = codeExtract(src);
  ok(code.startsWith('// 1. each live attractor') && code.includes('nearestNode') && code.includes('dk') && code.split('\n').length === 12, 'code extract is the real colonisation step');
}

console.log(`plant-growth tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
