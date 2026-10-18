// tests/rivers.test.mjs — rivers carved finer than the height map (node,
// no GPU, no browser).
// Run alone: node stella-nova/pages/dla-terrain/tests/rivers.test.mjs
//
// Why (2026-10-18, the user): "the rivers arent carving out something high
// res enough", "rivers aren't rendered high0-enough resolution". What it
// checks on a generated world (default options, n 512, 16 km: 31 m texels):
//   1 the network (render/river-net.js buildRiverNet): rows follow the
//     WATER ribbons, the step along the river, no jumps, the depth from
//     hydraulic geometry
//   2 the grid (rasterNearest + carveAt) names the true nearest segment
//   3 a narrow stream is carved at its own width (the wet width, where the
//     carved ground is under the water), not at the texel trench width
//   4 the GPU twin in shaders/ground.wgsl has the same constants
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as lib from '../../../lib/dla-terrain.js';
import { buildRiverNet, rasterNearest, carveAt, segmentAt, carveProfile, riverGridN, RV, NONE, REACH_TEXELS, BANK_LIP, FLOOD_RISE, hydraulicDepth, reachOf } from '../render/river-net.js';
import { sampleHeight } from '../render/water.js';

const here = (p) => fileURLToPath(new URL('../' + p, import.meta.url));
let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`ok ${pass + fail} rivers: ${name}`); }
  else { fail++; console.log(`not ok ${pass + fail} rivers: ${name} ${extra}`); }
}

const t = await lib.generateTerrain({ ...lib.defaults(), n: 512, seed: 1 }, () => {});
const ws = t.worldSize, origin = -ws / 2, texel = ws / t.n;
const heightAt = (x, z) => sampleHeight(t, x, z) + lib.detailHeight(x, z, t);
const net = buildRiverNet(t, { heightAt });
const V = net.verts;
console.log(`# world ${ws} m, n ${t.n}, texel ${texel.toFixed(1)} m, ${t.rivers.length} LIB rivers, ${net.rivers} carved, ${net.count} rows`);

// 1 the network
{
  ok(net.count > 100 && net.rivers > 5, `rows ${net.count}, rivers ${net.rivers}`);
  let maxStep = 0, sumStep = 0, nStep = 0, badDepth = 0, up = 0;
  for (let i = 0; i + 1 < net.count; i++) {
    if (V[i * RV + 7] >= 0.5) continue;
    const d = Math.hypot(V[(i + 1) * RV] - V[i * RV], V[(i + 1) * RV + 1] - V[i * RV + 1]);
    maxStep = Math.max(maxStep, d); sumStep += d; nStep++;
    if (V[(i + 1) * RV + 2] > V[i * RV + 2] + 1e-3) up++;
  }
  for (let i = 0; i < net.count; i++) { const D = V[i * RV + 4]; if (!(D >= 0.3 && D <= 6)) badDepth++; }
  ok(maxStep < texel * 1.2, `step along the river: mean ${(sumStep / nStep).toFixed(1)} m, max ${maxStep.toFixed(1)} m (texel ${texel.toFixed(1)} m)`);
  let monoUp = 0;
  for (let i = 0; i + 1 < net.count; i++) if (V[i * RV + 7] < 0.5 && net.monoY[i + 1] > net.monoY[i] + 1e-6) monoUp++;
  ok(monoUp === 0, `net.monoY never rises downstream (the WATER ribbon rises at ${net.ribbonRises} rows, ${up} carved rows rise)`);
  ok(badDepth === 0, `depth in 0.3 .. 6 m everywhere (${badDepth} out)`);
  ok(Math.abs(hydraulicDepth(100) / hydraulicDepth(1) - (0.35 + 0.42 * 100 ** 0.4) / (0.35 + 0.42)) < 1e-9 && hydraulicDepth(1e6) === 6, 'depth ~ Q^0.4, capped at 6 m');
  // continuity of the centre line: the turn per row is small (no kinks)
  let maxTurn = 0, sharp = 0, nT = 0;
  for (let i = 1; i + 1 < net.count; i++) {
    if (V[(i - 1) * RV + 7] >= 0.5 || V[i * RV + 7] >= 0.5) continue;
    const ax = V[i * RV] - V[(i - 1) * RV], az = V[i * RV + 1] - V[(i - 1) * RV + 1];
    const bx = V[(i + 1) * RV] - V[i * RV], bz = V[(i + 1) * RV + 1] - V[i * RV + 1];
    const c = (ax * bx + az * bz) / ((Math.hypot(ax, az) * Math.hypot(bx, bz)) || 1);
    const a = Math.acos(Math.max(-1, Math.min(1, c)));
    maxTurn = Math.max(maxTurn, a); nT++; if (a > Math.PI / 4) sharp++;
  }
  ok(sharp / nT < 0.01, `the centre line turns over 45 deg at ${sharp} of ${nT} rows (max ${(maxTurn * 180 / Math.PI).toFixed(0)} deg)`);
}

// 2 the grid names the true nearest segment
const gridN = riverGridN(t.n, false);
const t0 = Date.now();
const ids = rasterNearest(net, gridN, ws, origin);
const rasterMs = Date.now() - t0;
{
  let set = 0; for (let k = 0; k < ids.length; k++) if (ids[k] !== NONE) set++;
  ok(gridN === 1024 && rasterMs < 4000, `grid ${gridN}^2 (${(gridN * gridN * 4 / 1048576).toFixed(0)} MB) in ${rasterMs} ms, ${(100 * set / ids.length).toFixed(1)} % of cells near a river`);
  for (const gN of [gridN, t.n]) {
    const idsG = gN === gridN ? ids : rasterNearest(net, gN, ws, origin);
    let s = 12345, same = 0, tried = 0;
    const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
    for (let k = 0; k < 3000; k++) {
      const i = Math.floor(rnd() * (net.count - 1));
      if (V[i * RV + 7] >= 0.5) continue;
      // points on and near the segment (its middle is the hard case: a
      // short segment may be named by no cell)
      const u = rnd();
      const x = V[i * RV] + (V[(i + 1) * RV] - V[i * RV]) * u + (rnd() - 0.5) * 40, z = V[i * RV + 1] + (V[(i + 1) * RV + 1] - V[i * RV + 1]) * u + (rnd() - 0.5) * 40;
      let bs = Infinity;
      for (let j = 0; j + 1 < net.count; j++) { if (V[j * RV + 7] >= 0.5) continue; const sa = segmentAt(net, j, x, z); if (sa.s < bs) bs = sa.s; }
      if (bs > reachOf(V[i * RV + 3], texel) * 0.9) continue;
      const c = carveAt(net, idsG, gN, ws, origin, x, z, 0);
      tried++;
      if (Math.abs(c.s - bs) < 1e-6) same++;
    }
    ok(same / tried > 0.995, `grid ${gN}: the cells and RIVER_WIN neighbours hold the true nearest segment: ${same} of ${tried}`);
    // the centre line is under the water at every row and mid row
    let above = 0, n2 = 0;
    for (let i = 0; i + 1 < net.count; i++) {
      if (V[i * RV + 7] >= 0.5) continue;
      for (const u of [0, 0.5]) {
        const x = V[i * RV] + (V[(i + 1) * RV] - V[i * RV]) * u, z = V[i * RV + 1] + (V[(i + 1) * RV + 1] - V[i * RV + 1]) * u, y = V[i * RV + 2] + (V[(i + 1) * RV + 2] - V[i * RV + 2]) * u;
        n2++;
        if (carveAt(net, idsG, gN, ws, origin, x, z, heightAt(x, z)).h > y - 0.1) above++;
      }
    }
    ok(above === 0, `grid ${gN}: the carved centre line is under the water at all ${n2} rows and mid rows (${above} above)`);
  }
}

// 3 narrow streams at their own width
{
  // the wet width across the row: where the ground lies under the water
  const wetWidth = (hAt, x, z, nx, nz, y) => {
    let w = 0;
    for (let k = -400; k <= 400; k++) { const o = k * 0.1; if (hAt(x + nx * o, z + nz * o) < y) w += 0.1; }
    return w;
  };
  const rows = [];
  for (let i = 1; i + 1 < net.count; i++) {
    if (V[(i - 1) * RV + 7] >= 0.5 || V[i * RV + 7] >= 0.5) continue;
    if (V[i * RV + 3] * 2 <= 7 && Math.abs(V[i * RV + 5]) < 0.002) rows.push(i);
  }
  ok(rows.length > 20, `${rows.length} straight rows of streams under 7 m wide`);
  let nGood = 0, before = [], after = [], depthOk = 0;
  const pick = rows.filter((_, k) => k % Math.max(1, Math.floor(rows.length / 60)) === 0).slice(0, 60);
  for (const i of pick) {
    const x = V[i * RV], z = V[i * RV + 1], y = V[i * RV + 2], hw = V[i * RV + 3];
    const tx = V[(i + 1) * RV] - V[(i - 1) * RV], tz = V[(i + 1) * RV + 1] - V[(i - 1) * RV + 1], tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl, nz = tx / tl;
    const wb = wetWidth(heightAt, x, z, nx, nz, y);
    const carved = (px, pz) => carveAt(net, ids, gridN, ws, origin, px, pz, heightAt(px, pz)).h;
    const wa = wetWidth(carved, x, z, nx, nz, y);
    before.push(wb); after.push(wa);
    if (Math.abs(wa - 2 * hw) < Math.max(1.0, 0.25 * 2 * hw)) nGood++;
    if (carved(x, z) < y - 0.25) depthOk++;
  }
  const med = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
  console.log(`# wet width of ${pick.length} streams (channel ${med(pick.map((i) => 2 * V[i * RV + 3])).toFixed(1)} m median): before ${med(before).toFixed(1)} m, after ${med(after).toFixed(1)} m`);
  ok(nGood / pick.length > 0.85, `the wet width matches the channel width (+-25 %) on ${nGood} of ${pick.length} streams`);
  ok(med(after) < texel * 0.5, `median wet width ${med(after).toFixed(1)} m is under half a texel (${(texel / 2).toFixed(1)} m)`);
  ok(depthOk / pick.length > 0.95, `the bed lies under the water at the centre on ${depthOk} of ${pick.length}`);
  // the 3 m stream: a profile alone, with a coarse trench 20 m wide
  const v = [100, 1.5, 0.8, 0, 2];
  let w3 = 0;
  for (let k = -300; k <= 300; k++) { const sd = k * 0.05; const trench = 100 - 2 * Math.max(0, 1 - Math.abs(sd) / 20); if (carveProfile(sd, v, trench, 20).h < 100) w3 += 0.05; }
  ok(Math.abs(w3 - 3) < 0.4, `a 3 m stream in a 40 m trench: wet width ${w3.toFixed(2)} m`);
  // a bend: the deepest line moves to the outside, the inside rises as a bar
  const bendV = [100, 5, 2, 0.05, 30];
  const outside = carveProfile(-3, bendV, 90, 20).h, inside = carveProfile(3, bendV, 90, 20).h;
  ok(outside < inside, `bend to the left: outside (right) deeper ${outside.toFixed(2)} < inside ${inside.toFixed(2)}`);
}

// 4 the GPU twin
{
  const g = readFileSync(here('shaders/ground.wgsl'), 'utf8');
  ok(/fn riverProfile\(/.test(g) && /fn riverCarve\(/.test(g), 'ground.wgsl has fn riverProfile and fn riverCarve');
  ok(new RegExp(`const RIVER_REACH_TEXELS: f32 = ${REACH_TEXELS.toFixed(1)}`).test(g) && new RegExp(`const RIVER_LIP: f32 = ${BANK_LIP}`).test(g) && new RegExp(`const RIVER_RISE: f32 = ${FLOOD_RISE}`).test(g), 'WGSL constants equal river-net.js');
  ok(/const RIVER_RV: u32 = 2u;/.test(g), 'two vec4 per row on the GPU (RV 8 floats)');
  ok(reachOf(5, 20) === 5 * 1.4 + REACH_TEXELS * 20, 'the reach rule');
}
console.log(`# rivers: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
