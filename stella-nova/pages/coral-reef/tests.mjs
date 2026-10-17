// ============================================================================
//  CORAL REEF  ·  node tests (no browser):  node tests.mjs
// ----------------------------------------------------------------------------
//  The DOM-free modules: reef.js (growth), colour.js (colour by) and
//  saver.js (shots and camera fit).
//    forms ........ each species grows its form (fan planar, table wide,
//                   staghorn tall, brain compact)
//    floor ........ no polyp is under the sand or its rock, in any preset
//    current ...... a current skews the growth upstream
//    budget ....... step() keeps to its time budget; bleaching stops growth
//    colour ....... t of each mode, natural colours, gradient data
//    saver ........ the shot list and the framing for 16:9 and 9:16
//    sdf .......... lib/dla-sdf.js: a closed sphere, incremental growth =
//                   full rebuild (bit for bit), unit normals, timings
//    shapes ....... coral-sdf.js: each species meshes closed, the fan mesh
//                   is thin across its plane, polyps are denser at tips
//    terrain ...... the lidar crop, the ground, knolls, rock SDFs
//    assets ....... the CRM1 models parse; models keep off rocks
//    glsl ......... every program of shaders.js passes naga (GLSL 450 form)
//    worker ....... mesh-worker.js in this process: messages cloned with
//                   their transfer lists, bricks and a rock come back
// ============================================================================
import { createReef, growPreset, shapeOf, SPECIES, SPECIES_IDS, PRESETS, PRESET_IDS, sandY, bleachLevel, speciesHook } from './reef.js';
import { groundY, rockSdf } from './terrain.js';
import { MODES, MODE_IDS, colourT, naturalRGB, fieldsOf, polypData } from './colour.js';
import { shotList, frameFit, projectedBox, SAVER_GRADIENTS } from './saver.js';
import { sample, GRADIENTS } from '../../lib/growth-gradients.js';
import { createSdf, createTreeSdf, meshStats, pipeRadius } from '../../lib/dla-sdf.js';
import { createModel } from '../../lib/dla-engine.js';
import { createCoralMesher, SHAPES } from './coral-sdf.js';
import { SEABED_CM, SEABED_META } from './seabed-data.js';
import { knollSites, makeRock, rockTopY, pushOut, solidAt, meshRock, groundGrid } from './terrain.js';
import { DECOR, parseCRM, scatterDecor } from './assets.js';
import * as SH from './shaders.js';
import { checkPrograms } from './glsl-check.mjs';
import fs from 'node:fs';
import { rng } from '../../lib/dla-engine.js';

let pass = 0, fail = 0;
function ok(cond, name, info = '') {
  if (cond) { pass++; } else { fail++; console.log(`FAIL ${name} ${info}`); }
}
const f2 = v => (+v).toFixed(2);

function colony(id, o = {}) {
  const r = createReef({ seed: o.seed ?? 5, env: { strength: o.strength ?? 0.3 } });
  if (o.dir !== undefined) r.setCurrent(o.dir, o.strength ?? 0.3);
  const c = r.addColony(id, 0, 0, { cap: o.cap ?? 1200 });
  r.growAll();
  return { r, c, s: shapeOf(c, c.user.normal) };
}

// ── forms ───────────────────────────────────────────────────────────────────
{
  const st = colony('staghorn'), fan = colony('fan'), tab = colony('table'), bo = colony('boulder'), fi = colony('finger');
  console.log(`forms: staghorn w ${f2(st.s.width)} h ${f2(st.s.height)} | fan w ${f2(fan.s.width)} h ${f2(fan.s.height)} thick ${f2(fan.s.thickness)} | table w ${f2(tab.s.width)} h ${f2(tab.s.height)} | brain w ${f2(bo.s.width)} h ${f2(bo.s.height)} fill ${bo.s.fill.toFixed(3)} vs staghorn ${st.s.fill.toFixed(4)}`);
  for (const [id, x] of [['staghorn', st], ['fan', fan], ['table', tab], ['boulder', bo], ['finger', fi]]) ok(x.c.count === 1200, `${id} grows to its cap`, x.c.count);
  ok(st.s.height > 1.2 * st.s.width, 'staghorn is taller than wide', `${f2(st.s.height)} vs ${f2(st.s.width)}`);
  ok(fan.s.thickness < 0.01 * fan.s.width, 'sea fan is planar (thin across its plane)', `${fan.s.thickness} vs ${f2(fan.s.width)}`);
  ok(fan.s.width > 0.6 * fan.s.height, 'sea fan spreads wide in its plane', `${f2(fan.s.width)} vs ${f2(fan.s.height)}`);
  // the fan plane is across the current: its normal is the current direction
  const fn = colony('fan', { dir: 90 }); const n = fn.c.user.normal;
  ok(Math.abs(n[0]) < 1e-9 && Math.abs(n[1] - 1) < 1e-9, 'fan normal follows the current direction', n.join(','));
  ok(shapeOf(fn.c, [0, 1]).thickness < 0.01 * fn.s.width, 'fan across a current at 90 degrees is planar in x-y');
  ok(tab.s.width > 3 * tab.s.height, 'table coral is wider than tall', `${f2(tab.s.width)} vs ${f2(tab.s.height)}`);
  ok(bo.s.fill > 10 * st.s.fill, 'brain coral is compact (fill of its hemisphere)', `${bo.s.fill.toFixed(3)} vs ${st.s.fill.toFixed(4)}`);
  ok(bo.s.height < bo.s.width, 'brain coral is a dome (lower than wide)', `${f2(bo.s.height)} vs ${f2(bo.s.width)}`);
  ok(fi.s.height > 0 && fi.c.sp.r0 > st.c.sp.r0, 'finger coral grows with thicker polyps than staghorn');
  // a seed gives the same colony
  const a = colony('staghorn', { cap: 300 }), b = colony('staghorn', { cap: 300 });
  ok(a.c.model.toCSV() === b.c.model.toCSV(), 'the same seed grows the same colony');
}

// ── floor ───────────────────────────────────────────────────────────────────
{
  let worst = Infinity, worstRock = Infinity, total = 0, roots = 0;
  for (const pid of PRESET_IDS) {
    const r = growPreset(pid, 11, { capTotal: 6000 });
    total += r.count;
    for (let g = 0; g < r.count; g++) {
      const c = r.colonies[r.col[g]], x = r.px[g], y = r.py[g], z = r.pz[g];
      worst = Math.min(worst, y - groundY(x, z));
      for (const rk of r.rocks) worstRock = Math.min(worstRock, rockSdf(rk, x, y, z));
    }
    for (const c of r.colonies) for (let i = 0; i < c.count; i++) if (c.model.parent[i] < 0) roots++;
    ok(r.colonies.length === PRESETS[pid].mix.length, `${pid}: one colony per mix entry`, `${r.colonies.length}`);
  }
  console.log(`floor: ${total} polyps in ${PRESET_IDS.length} presets, least height over the ground ${worst.toFixed(3)}, least rock distance ${worstRock.toFixed(3)}, ${roots} roots`);
  ok(worst > -1e-3, 'no polyp is under the ground', worst);
  ok(worstRock > -1e-3, 'no polyp is inside a rock', worstRock);
}

// ── current ─────────────────────────────────────────────────────────────────
{
  const east = colony('staghorn', { dir: 0, strength: 1, cap: 1500 }).s.mean[0];
  const west = colony('staghorn', { dir: 180, strength: 1, cap: 1500 }).s.mean[0];
  const calm = colony('staghorn', { dir: 0, strength: 0, cap: 1500 }).s.mean[0];
  const north = colony('boulder', { dir: 90, strength: 1, cap: 1500 }).s.mean[2];
  console.log(`current: mean x with the current to +x ${f2(east)}, to -x ${f2(west)}, none ${f2(calm)}; brain mean z with the current to +z ${f2(north)}`);
  ok(east < -2, 'a current toward +x grows the colony toward -x (upstream)', east);
  ok(west > 2, 'a current toward -x grows the colony toward +x (upstream)', west);
  ok(Math.abs(calm) < Math.min(-east, west) / 2, 'no current: no strong skew', calm);
  ok(north < 0, 'a current toward +z skews a brain coral toward -z', north);
}

// ── budget and bleaching ───────────────────────────────────────────────────
{
  const r = createReef({ seed: 2 }); r.loadPreset('mixed');
  const t0 = performance.now(); const n = r.step(1000, 6, 0, 1e6); const dt = performance.now() - t0;
  console.log(`budget: step(budget 6 ms) grew ${n} polyps in ${dt.toFixed(1)} ms`);
  ok(dt < 6 + 25 && n > 0, 'step keeps to its time budget', dt);
  ok(bleachLevel(27) === 0 && bleachLevel(32) === 1 && bleachLevel(30.5) > 0.3 && bleachLevel(30.5) < 0.7, 'bleach level is 0 cool, 1 hot');
  r.env.temp = 32; const c0 = r.count;
  ok(r.step(100, 6, 1) === 0 && r.count === c0, 'a bleached reef does not grow');
  r.env.temp = 27; ok(r.step(100, 6, 2) > 0, 'cool water: growth starts again');
}

// ── colour ──────────────────────────────────────────────────────────────────
{
  const r = growPreset('mixed', 4, { capTotal: 5000 });
  const n = r.count, F = fieldsOf(r);
  for (const m of MODE_IDS) {
    const t = colourT(r, m);
    let lo = Infinity, hi = -Infinity; for (let i = 0; i < n; i++) { lo = Math.min(lo, t[i]); hi = Math.max(hi, t[i]); }
    ok(lo >= 0 && hi <= 1 + 1e-6 && Number.isFinite(lo), `colour ${m}: t in 0..1`, `${lo} ${hi}`);
  }
  const age = colourT(r, 'age'); let mono = true; for (let i = 1; i < n; i++) if (age[i] < age[i - 1]) mono = false;
  ok(mono && age[n - 1] === 1, 'age: the newest polyp is at the hot end');
  const dep = colourT(r, 'depth'), flow = colourT(r, 'flow'), col = colourT(r, 'colony'), hgt = colourT(r, 'height');
  const seeds = r.colonies.map(c => c.ids[0]);
  ok(seeds.every(g => dep[g] === 0), 'depth: seeds are 0');
  ok(seeds.every(g => Math.abs(flow[g] - 1) < 1e-6), 'flow: seeds (whole colony subtree) are 1');
  let tipFlow = 0, tips = 0; for (let i = 0; i < n; i++) if (F.sub[i] === 1) { tipFlow += flow[i]; tips++; }
  ok(tips > 0 && tipFlow === 0, 'flow: tips are 0');
  ok(r.colonies.every(c => c.ids.every(g => col[g] === col[c.ids[0]])), 'colony: one t per colony');
  ok(new Set(seeds.map(g => col[g].toFixed(4))).size === r.colonies.length, 'colony: each colony a different t');
  ok(Math.abs(Math.max(...hgt.subarray(0, n)) - 1) < 1e-6, 'height: the top polyp is 1');
  const nat = naturalRGB(r); let natOk = true; for (let i = 0; i < n * 3; i++) if (!(nat[i] >= 0 && nat[i] <= 1)) natOk = false;
  ok(natOk, 'natural colours are in 0..1');
  const d = polypData(r, 'flow', 'viridis'), c = sample('viridis', d.t[7]);
  ok(d.n === n && d.pos.length === n * 3 && d.radius.every(v => v > 0), 'polypData: positions and radii');
  ok(Math.abs(d.rgb[21] - c[0]) < 1e-6 && Math.abs(d.rgb[23] - c[2]) < 1e-6, 'polypData: the rgb is the gradient sample of t');
  ok(MODES[0].id === 'natural' && MODES.length === 7, 'seven colour modes, natural first');
}

// ── saver ───────────────────────────────────────────────────────────────────
{
  const a = shotList(42, 30), b = shotList(42, 30), c = shotList(43, 30);
  ok(JSON.stringify(a) === JSON.stringify(b), 'shot list: the same seed gives the same shots');
  ok(JSON.stringify(a) !== JSON.stringify(c), 'shot list: another seed gives other shots');
  ok(a.every(s => s.hold >= 5 && s.hold <= 12), 'shot list: each shot holds 5 to 12 s');
  ok(a.every(s => PRESET_IDS.includes(s.preset) && SPECIES_IDS.includes(s.species) && GRADIENTS[s.gradient] && MODE_IDS.includes(s.mode)), 'shot list: valid presets, species, gradients and modes');
  ok(a.every((s, i) => i === 0 || (s.preset !== a[i - 1].preset && s.mode !== a[i - 1].mode)), 'shot list: no preset or mode twice in a row');
  ok(new Set(a.map(s => s.seed)).size === a.length, 'shot list: every shot grows from a new seed');
  ok(a.some(s => s.kind === 'colony') && a.some(s => s.kind === 'reef'), 'shot list: reef shots and colony shots');
  ok(a.every(s => Math.abs(s.spin) < 0.07 && s.elev > 0.15 && s.elev < 0.5), 'shot list: calm camera moves');
  ok(a.every(s => s.kind === 'colony' ? s.zoom >= 0.5 && s.zoom <= 0.8 : s.zoom >= 0.92 && s.zoom <= 1), 'shot list: colony shots come closer, reef shots keep the fit');
  ok(SAVER_GRADIENTS.every(g => GRADIENTS[g]), 'saver gradients exist');

  const R = PRESETS.mixed.R + 18;
  for (const [w, h, name] of [[1920, 1080, '16:9'], [1080, 1920, '9:16'], [390, 844, 'phone 9:19.5']]) {
    for (const band of [null, { t: 0.2 * h, b: 0.26 * h }, { t: 0.4 * h, b: 0.3 * h }]) {
      const clear = band ? { t: band.t, b: band.b } : {};
      const fit = frameFit({ w, h, clear, radius: R, fov: 40 });
      const box = projectedBox({ w, h, fov: 40 }, fit, R);
      const t = clear.t || 0, bb = clear.b || 0;
      const inside = box.y0 >= t - 0.5 && box.y1 <= h - bb + 0.5 && box.x0 >= -0.5 && box.x1 <= w + 0.5;
      const centred = Math.abs((box.y0 + box.y1) / 2 - (t + (h - t - bb) / 2)) < 0.5 && Math.abs((box.x0 + box.x1) / 2 - w / 2) < 0.5;
      const full = Math.max((box.y1 - box.y0) / (h - t - bb), (box.x1 - box.x0) / w);
      ok(inside && centred, `framing ${name} band ${band ? `${(band.t / h).toFixed(2)}/${(band.b / h).toFixed(2)}` : 'none'}: the reef is in the clear band and centred`, JSON.stringify(box));
      ok(full > 0.7 && full < 0.9, `framing ${name}: the reef fills the band (wide, not tiny)`, full.toFixed(3));
    }
  }
  // the reef as a wide, low ellipse (rx, ry), as main.js frames it
  for (const [w, h, name] of [[1920, 1080, '16:9'], [1080, 1920, '9:16']]) {
    const clear = { t: 0.22 * h, b: 0.27 * h }, rx = R, ry = 0.62 * R;
    const fit = frameFit({ w, h, clear, rx, ry, fov: 40 }), box = projectedBox({ w, h, fov: 40 }, fit, undefined, rx, ry);
    const inside = box.y0 >= clear.t - 0.5 && box.y1 <= h - clear.b + 0.5 && box.x0 >= -0.5 && box.x1 <= w + 0.5;
    const full = Math.max((box.y1 - box.y0) / (h - clear.t - clear.b), (box.x1 - box.x0) / w);
    ok(inside && Math.abs(full - 0.84) < 0.01, `framing ${name} ellipse: inside the band, 84% of the tighter side`, `${JSON.stringify(box)} ${full.toFixed(3)}`);
    console.log(`framing ${name} ellipse rx ${rx} ry ${ry.toFixed(1)}: distance ${fit.dist.toFixed(1)}, box y ${box.y0.toFixed(0)}..${box.y1.toFixed(0)} of band ${clear.t.toFixed(0)}..${(h - clear.b).toFixed(0)}, x ${box.x0.toFixed(0)}..${box.x1.toFixed(0)} of ${w}`);
  }
  const side = frameFit({ w: 1400, h: 900, clear: { l: 300 }, radius: R });
  ok(Math.abs((900 / 2 - side.oy) - 450) < 1e-9 && Math.abs((1400 / 2 - side.ox) - (300 + 550)) < 1e-9, 'framing: a left panel moves the reef to the centre of the clear part');
  console.log(`framing: 16:9 with a 0.20/0.26 band: distance ${frameFit({ w: 1920, h: 1080, clear: { t: 216, b: 281 }, radius: R }).dist.toFixed(1)}; 9:16: ${frameFit({ w: 1080, h: 1920, clear: { t: 384, b: 499 }, radius: R }).dist.toFixed(1)}`);
}

// ── hook source for the saver code extract ──────────────────────────────────
{
  for (const id of SPECIES_IDS) {
    const h = speciesHook(id), src = h.fn.toString();
    ok(typeof h.fn === 'function' && (src.includes(h.name) || src.startsWith('function snowMotion')) && src.length > 60 && src.split('\n').length <= 14, `${id}: hook extract ${h.name} (${src.split('\n').length} lines)`);
  }
  ok(speciesHook('fan', 'motionVector').fn.toString().includes('normal'), 'fan extract keeps the walk in the plane');
}

// ── sdf (lib/dla-sdf.js) ───────────────────────────────────────────────────
{
  const sp = createSdf({ cell: 0.25 });
  sp.setPrim(0, 0.1, 0.2, 0.3, 2, 0.1, 0.2, 0.3, 2);
  const st = meshStats(sp.update());
  ok(st.boundaryEdges === 0 && st.nonManifold === 0 && Math.abs(st.area / (16 * Math.PI) - 1) < 0.02, 'sdf: a sphere meshes closed with the right area', JSON.stringify(st));
  const model = createModel({ dim: 3, seed: 3, params: { attractionDistance: 1.5, stickiness: 0.9 } }); model.add([0, 0, 0]); model.grow(900);
  const o = { cell: 0.3, k: 0.6, rTip: 0.45, pipe: 3, rMax: 1.6, quant: 0.16, sub0: 2 };
  const A = createTreeSdf(o);
  const meshes = new Map();
  let t0 = performance.now();
  for (let i = 0; i < model.count; i++) {
    A.add(i, model.pos[i * 3], model.pos[i * 3 + 1], model.pos[i * 3 + 2], model.parent[i]);
    if (i % 10 === 0) for (const m of A.update(6)) meshes.set(m.key, m);
  }
  while (A.sdf.dirtyCount) for (const m of A.update(6)) meshes.set(m.key, m);
  const tInc = performance.now() - t0;
  t0 = performance.now();
  const B = createTreeSdf(o);
  for (let i = 0; i < model.count; i++) B.add(i, model.pos[i * 3], model.pos[i * 3 + 1], model.pos[i * 3 + 2], model.parent[i]);
  B.sdf.rebuildAll();
  const full = B.sdf.meshAll();
  const tFull = performance.now() - t0;
  let diff = 0, cmp = 0;
  for (const key of new Set([...A.sdf.bricks.keys(), ...B.sdf.bricks.keys()])) {
    const r = A.sdf.bricks.get(key) || B.sdf.bricks.get(key);
    for (let j = 0; j < 512; j++) {
      const ix = r.bx * 8 + (j & 7), iy = r.by * 8 + ((j >> 3) & 7), iz = r.bz * 8 + (j >> 6);
      cmp++; if (A.sdf.valueAt(ix, iy, iz) !== B.sdf.valueAt(ix, iy, iz)) diff++;
    }
  }
  const inc = [...meshes.values()].filter(m => m.indices.length);
  const si = meshStats(inc), sf = meshStats(full);
  console.log(`sdf: ${model.count} particles, incremental (10 per frame, 6 ms) ${tInc.toFixed(0)} ms, full ${tFull.toFixed(0)} ms, ${cmp} lattice points, ${diff} differ; ${si.tris} triangles, boundary ${si.boundaryEdges}, non-manifold ${si.nonManifold}`);
  ok(diff === 0, 'sdf: incremental growth gives the lattice of a full rebuild, bit for bit', diff);
  ok(si.tris === sf.tris && Math.abs(si.area - sf.area) < 1e-6 * sf.area, 'sdf: incremental and full meshes match', `${si.tris} ${sf.tris}`);
  ok(si.boundaryEdges === 0, 'sdf: the brick meshes meet with no cracks (no boundary edges after a weld)', si.boundaryEdges);
  ok(si.nonManifold < si.edges * 0.002, 'sdf: few non-manifold edges', si.nonManifold);
  let bad = 0; for (const m of inc) for (let v = 0; v < m.normals.length; v += 3) if (Math.abs(Math.hypot(m.normals[v], m.normals[v + 1], m.normals[v + 2]) - 1) > 1e-4) bad++;
  ok(bad === 0, 'sdf: normals are unit length', bad);
  ok(pipeRadius(1, 0.5, 3, 2, 0.12, 2) === 0.5 && pipeRadius(1e6, 0.5, 3, 2, 0.12, 2) <= 2 && pipeRadius(1e6, 0.5, 3, 2, 0.12, 2) > 1.8 && Math.abs(pipeRadius(64, 0.5, 3, 2, 0, 1) - 2) < 1e-9, 'sdf: the pipe rule (tip, cap, cube root)');
}

// ── coral shapes (coral-sdf.js) ─────────────────────────────────────────────
{
  const rows = [];
  for (const id of SPECIES_IDS) {
    const r = createReef({ seed: 5, env: { strength: 0.3 } });
    const c = r.addColony(id, 0, 0, { cap: id === 'fan' ? 420 : 520 });
    r.growAll();
    const M = createCoralMesher();
    M.addColony({ k: 0, id, normal: c.user.normal, stalk: c.sp.stalk });
    const t0 = performance.now();
    for (let i = 0; i < c.count; i++) M.add(0, i, c.model.parent[i], c.model.pos[i * 3], c.model.pos[i * 3 + 1], c.model.pos[i * 3 + 2], c.ids[i]);
    const ms = M.meshColony(0), dt = performance.now() - t0;
    const st = meshStats(ms.map(m => ({ positions: m.positions, indices: m.indices })));
    let npol = 0, tipP = 0, nv = 0, tipV = 0, gidBad = 0, thick0 = Infinity, thick1 = -Infinity, w0 = Infinity, w1 = -Infinity;
    const tree = M.cols.get(0).tree, tipOf = (gid) => { const s2 = tree.sub(c.ids.indexOf(gid)); return s2 <= 1 ? 1 : Math.max(0, 1 - Math.log2(s2) / 5); };
    const n = c.user.normal;
    for (const m of ms) {
      for (let v = 0; v < m.gids.length; v++) {
        if (m.gids[v] < 0) gidBad++; else if (v % 7 === 0) { tipV += tipOf(m.gids[v]); nv++; }
        const x = m.positions[v * 3], z = m.positions[v * 3 + 2], d = x * n[0] + z * n[1], a = -x * n[1] + z * n[0];
        thick0 = Math.min(thick0, d); thick1 = Math.max(thick1, d); w0 = Math.min(w0, a); w1 = Math.max(w1, a);
      }
      for (let q = 0; q < m.polyps.length; q += 8) { npol++; tipP += tipOf(m.polyps[q + 6]); }
    }
    rows.push(`${id} ${c.count} p, ${st.tris} tris, ${npol} polyps, ${dt.toFixed(0)} ms`);
    ok(st.tris > 500 && st.boundaryEdges === 0, `shapes: ${id} meshes closed`, JSON.stringify(st));
    ok(gidBad === 0, `shapes: ${id} every vertex has a particle id`, gidBad);
    if (SHAPES[id].polyp.density > 0.5) ok(npol > 50 && tipP / npol > tipV / Math.max(1, nv), `shapes: ${id} polyps are denser at the tips`, `${npol} polyps, tip ${(tipP / npol).toFixed(2)} vs surface ${(tipV / nv).toFixed(2)}`);
    if (id === 'fan') ok((thick1 - thick0) < 0.12 * (w1 - w0), 'shapes: the fan mesh is thin across its plane', `${(thick1 - thick0).toFixed(2)} vs ${(w1 - w0).toFixed(2)}`);
  }
  console.log('shapes: ' + rows.join(' | '));
}

// ── terrain ─────────────────────────────────────────────────────────────────
{
  let lo = Infinity, hi = -Infinity; for (const v of SEABED_CM) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  ok(SEABED_CM.length === SEABED_META.w * SEABED_META.h && Math.abs(lo / 100 - SEABED_META.min) < 0.01 && Math.abs(hi / 100 - SEABED_META.max) < 0.01, 'terrain: the lidar crop is 160 x 160 in its stated range', `${lo} ${hi}`);
  const g = groundGrid(40, 300, 2);
  let fin = true; for (const v of g.positions) if (!Number.isFinite(v)) fin = false;
  ok(fin && g.indices.length === 40 * 40 * 6, 'terrain: the ground grid is finite');
  const ks = knollSites(80);
  ok(ks.length >= 6, 'terrain: knolls of the real seabed near the reef', ks.length);
  const rand = rng(9), rk = makeRock(rand, ks[0].x, ks[0].z, { r: 5 });
  const top = rockTopY(rk, rk.x, rk.z);
  ok(solidAt(rk.x, top - 0.3, rk.z, rk) && !solidAt(rk.x, top + 0.3, rk.z, rk), 'terrain: the rock top is the solid surface');
  let out = true;
  for (let i = 0; i < 200; i++) { const p = pushOut([rk.x + (rand() - 0.5) * 12, top - rand() * 6, rk.z + (rand() - 0.5) * 12], rk, 0.05); if (solidAt(p[0], p[1], p[2], rk) && solidAt(p[0], p[1] + 0.001, p[2], rk)) out = false; }
  ok(out, 'terrain: pushOut moves points out of the rock and the ground');
  const rm = meshStats(meshRock(rk, 0.45));
  console.log(`terrain: ${ks.length} knolls within 80, rock mesh ${rm.tris} tris, boundary ${rm.boundaryEdges}`);
  ok(rm.boundaryEdges === 0 && rm.tris > 1000, 'terrain: a rock meshes closed', JSON.stringify(rm));
}

// ── assets ──────────────────────────────────────────────────────────────────
{
  const here = new URL('.', import.meta.url).pathname;
  let okAll = true, tris = 0, bytes = 0;
  for (const d of DECOR) {
    const b = fs.readFileSync(here + 'assets/models/' + d.id + '.bin'); bytes += b.length;
    const m = parseCRM(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
    tris += m.indices.length / 3;
    let maxI = 0; for (const i of m.indices) maxI = Math.max(maxI, i);
    if (maxI >= m.positions.length / 3 || m.json.tris * 3 !== m.indices.length || (d.kind === 'shell') !== !!m.uv) okAll = false;
  }
  console.log(`assets: ${DECOR.length} models, ${tris} triangles, ${(bytes / 1024).toFixed(0)} KB`);
  ok(okAll, 'assets: every CRM1 model parses with valid indices');
  const rocks = [{ x: 0, z: 0, rx: 10, rz: 10 }];
  const keep = (x, z, r) => !rocks.some(q => Math.hypot(q.x - x, q.z - z) < q.rx + r);
  const pl = scatterDecor(4, keep, 1);
  const all = Object.values(pl).flat();
  ok(all.length > 60 && all.every(p => Math.hypot(p.x, p.z) > 10), 'assets: the models keep off the rocks', all.length);
  ok(JSON.stringify(scatterDecor(4, keep, 1)) === JSON.stringify(pl), 'assets: the same seed gives the same places');
}

// ── glsl (naga) ─────────────────────────────────────────────────────────────
{
  const res = checkPrograms([
    { name: 'coral', vs: SH.CORAL_VS, fs: SH.CORAL_FS },
    { name: 'polyp', vs: SH.POLYP_VS, fs: SH.POLYP_FS },
    { name: 'ground', vs: SH.GROUND_VS, fs: SH.GROUND_FS },
    { name: 'rock', vs: SH.ROCK_VS, fs: SH.ROCK_FS },
    { name: 'decor', vs: SH.DECOR_VS, fs: SH.DECOR_FS, instanced: true },
    { name: 'caustic', vs: SH.CAUSTIC_VS, fs: SH.CAUSTIC_FS, raw: true },
  ]);
  if (res[0].ok === null) console.log('glsl: naga not found, the check did not run');
  else {
    console.log('glsl: ' + res.map(r => `${r.name} ${r.ok ? 'ok' : 'FAIL'}`).join(', '));
    for (const r of res) ok(r.ok, `glsl: ${r.name} passes naga`, r.log);
  }
}

// ── worker (mesh-worker.js, in this process) ────────────────────────────────
{
  const out = [];
  globalThis.self = globalThis;
  globalThis.postMessage = (m, tr) => { out.push(structuredClone(m, { transfer: tr || [] })); };
  await import('./mesh-worker.js');
  const r = createReef({ seed: 4 }); r.loadPreset('mixed'); r.growAll(800);
  const send = (m, tr) => self.onmessage({ data: structuredClone(m, { transfer: tr || [] }) });
  send({ type: 'reset', polyps: 1 });
  for (const c of r.colonies) send({ type: 'colony', k: c.k, id: c.id, normal: c.user.normal, stalk: c.sp.stalk });
  const d = new Float32Array(r.count * 7);
  for (let g = 0; g < r.count; g++) { const c = r.colonies[r.col[g]], i = r.loc[g]; d.set([c.k, i, c.model.parent[i], c.model.pos[i * 3], c.model.pos[i * 3 + 1], c.model.pos[i * 3 + 2], g], g * 7); }
  send({ type: 'add', data: d }, [d.buffer]);
  send({ type: 'rock', id: 7, rock: r.rocks[0], cell: 0.5 });
  const t0 = Date.now();
  await new Promise(res => { const iv = setInterval(() => { if (out.some(m => m.type === 'idle') || Date.now() - t0 > 90000) { clearInterval(iv); res(); } }, 20); });
  const list = out.filter(m => m.type === 'bricks').flatMap(m => m.list), rock = out.find(m => m.type === 'rock');
  const gids = new Set(); for (const b of list) for (const g of b.gids) gids.add(g);
  console.log(`worker: ${r.count} particles -> ${list.length} brick meshes, ${list.reduce((a, b) => a + b.indices.length / 3, 0)} triangles, ${list.reduce((a, b) => a + b.polyps.length / 8, 0)} polyps, rock ${rock ? rock.indices.length / 3 : 0} tris, ${Date.now() - t0} ms`);
  ok(out.some(m => m.type === 'idle') && list.length > 50 && list.every(b => b.positions.length === b.normals.length && b.gids.length * 3 === b.positions.length), 'worker: brick meshes come back whole, then idle');
  ok(list.every(b => b.indices.length === 0 || b.indices.length % 3 === 0) && gids.size > r.count * 0.5, 'worker: the meshes carry the particle ids', gids.size);
  ok(rock && rock.id === 7 && rock.indices.length > 300, 'worker: a rock mesh comes back with its id');
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
