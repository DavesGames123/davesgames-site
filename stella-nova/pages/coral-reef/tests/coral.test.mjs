// ============================================================================
//  CORAL REEF  ·  tests/coral.test.mjs  ·  node checks of the CORAL package
// ----------------------------------------------------------------------------
//    node pages/coral-reef/tests/coral.test.mjs [--quick]
//  It exits with code 1 when a check fails. No browser.
//  Checks (reef.js, coral-sdf.js, mesh-worker.js, colour.js):
//    seeds ......... colony counts by quality (30..80), spread over the plot,
//                    no clumping, species by site (tops, walls, shelter)
//    sizes ......... each species grows a colony of 1 to 4 m
//    thickness ..... branch thickness measured on the fine mesh, against
//                    the colony size, finer than the old page (2fdd58cf);
//                    brain coral valleys 7 to 20 cm apart
//    interference .. two close seeds compete (each grows less toward the
//                    other than alone), fuse (one surface) at contact, and
//                    two species overgrow
//    polyps ........ polyps per m^2 of the fine mesh, against the old page
//    rock .......... no particle centre in the rock (rock.sdf > 0) or sand
//    determinism ... same seed, same reef, for any time budget
//    lod ........... the coarse mesh is much smaller; a focus change
//                    removes and adds fine bricks
//    worker ........ the reef worker messages (createReefRunner)
//    colour ........ every colour mode on the page mirror
//    timings ....... growth and mesh rates, the desktop projection
//  The old page values (OLD) come from a run of the code of commit
//  2fdd58cf (2200 particles per colony): colony size, tip radius, polyp
//  density and polyp size, in its own units.
// ============================================================================
import os from 'node:os';
import { createRock } from '../rock/index.js';
import {
  createReef, SPECIES, SPECIES_IDS, QUALITY, PRESETS, shapeOf, pickSpecies, chooseFocus,
  createReefMirror, colonyInfo, PARTICLE_FLOATS, speciesHook, polypRadius,
} from '../reef.js';
import { createCoralMesher, SHAPES, LOD_K, groove } from '../coral-sdf.js';
import { createReefRunner } from '../mesh-worker.js';
import { MODES, colourT, naturalRGB, radiiOf } from '../colour.js';
import { meshStats } from '../../../lib/dla-sdf.js';

const QUICK = process.argv.includes('--quick');
let fails = 0, passes = 0;
function ok(cond, name, info = '') {
  if (cond) { passes++; console.log(`ok   ${name}${info ? '  ' + info : ''}`); }
  else { fails++; console.log(`FAIL ${name}${info ? '  ' + info : ''}`); }
}
const f2 = v => (+v).toFixed(2), f3 = v => (+v).toFixed(3), f4 = v => (+v).toFixed(4);
const now = () => performance.now();

// the old page (2fdd58cf), measured at 2200 particles per colony
// thick: the median branch thickness / colony size, measured on the old
// mesh as below (2 x the median distance of a vertex to its cone axis; for
// the table, 2 x the median height of a vertex over its plate particle;
// for the fan, 2 x the median distance of a vertex to the fan plane)
const OLD = {
  staghorn: { size: 39.18, rTip: 0.42, density: 0.9, psize: 0.2, thick: 0.0731 },
  fan: { size: 67.87, rTip: 0.2, density: 3.2, psize: 0.1, thick: 0.00466 },
  table: { size: 46.44, rTip: 0.6, density: 1.8, psize: 0.17, thick: 0.0163 },
  boulder: { size: 24.82, rTip: 1.0, density: 0.25, psize: 0.16, thick: 0.2030 },
  finger: { size: 46.73, rTip: 0.6, density: 2.0, psize: 0.24, thick: 0.0758 },
};

// A flat rock (y < 0 is rock) with sites on its top and the sand far
// below: a clean floor for the controlled tests.
function flatRock(R0 = 30) {
  return {
    sdf: (x, y) => y, normal: () => [0, 1, 0], radius: R0,
    sand: { heightAt: () => -50 },
    bounds: { min: [-R0, -3, -R0], max: [R0, 8, R0] },
    sampleSurface(n, rng) { const out = []; for (let i = 0; i < n; i++) { const a = rng() * 6.283, r = R0 * Math.sqrt(rng()); out.push({ p: [Math.cos(a) * r, 0, Math.sin(a) * r], n: [0, 1, 0], exposure: 1, overhang: false }); } return out; },
    features: [],
  };
}
const site = (x, z) => ({ p: [x, 0, z], n: [0, 1, 0], exposure: 1, overhang: false });

// every particle of a reef against its rock: inside counts and the worst value
function rockCheck(R, rock) {
  let inside = 0, under = 0, worst = Infinity;
  for (let g = 0; g < R.count; g++) {
    const d = rock.sdf(R.px[g], R.py[g], R.pz[g]);
    if (d <= 0) inside++;
    if (rock.sand && R.py[g] < rock.sand.heightAt(R.px[g], R.pz[g])) under++;
    worst = Math.min(worst, d);
  }
  return { inside, under, worst };
}

function hashReef(R, n = R.count) {
  let h = 2166136261;
  for (let g = 0; g < n; g++) for (const v of [R.px[g], R.py[g], R.pz[g], R.parent[g], R.col[g]]) { h ^= Math.round(v * 1e5) | 0; h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function meshOf(R, lod = false, focus) {
  const M = createCoralMesher({ fine: R.fine, radius: R.radius, polyps: 1, lod });
  for (const c of R.colonies) M.addColony(colonyInfo(c));
  for (let g = 0; g < R.count; g++) M.add(g, R.parent[g], R.px[g], R.py[g], R.pz[g], R.col[g]);
  if (focus) M.setFocus(focus);
  return M;
}

// distance from p to the segment a-b
function segDist(px, py, pz, ax, ay, az, bx, by, bz) {
  const ux = bx - ax, uy = by - ay, uz = bz - az, l2 = ux * ux + uy * uy + uz * uz;
  let t = l2 > 0 ? ((px - ax) * ux + (py - ay) * uy + (pz - az) * uz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - ax - ux * t, py - ay - uy * t, pz - az - uz * t);
}
const median = a => { const b = Float64Array.from(a).sort(); return b.length ? b[b.length >> 1] : NaN; };

const realRock = createRock({ seed: 3, radius: 30, quality: 'low' });

// ── seeds ───────────────────────────────────────────────────────────────────
{
  for (const q of ['phone', 'mid', 'desktop']) {
    const R = createReef({ rock: realRock, seed: 7, quality: q });
    R.populate();
    const n = R.colonies.length, Q = QUALITY[q];
    ok(n >= Math.min(Q.colonies, 30) && n <= 80 && n >= 0.9 * Q.colonies, `seeds: ${q} quality gives about ${Q.colonies} colonies (30..80)`, `${n}`);
    if (q !== 'desktop') continue;
    // spread: all quadrants, far out, no clumps
    const quad = [0, 0, 0, 0];
    let rmax = 0, rsum = 0, dmin = Infinity, nnSum = 0, crowd = 0;
    for (const c of R.colonies) {
      const [x, , z] = c.base, r = Math.hypot(x, z);
      quad[(x >= 0 ? 1 : 0) + (z >= 0 ? 2 : 0)]++; rmax = Math.max(rmax, r); rsum += r;
      let nn = Infinity, near = 0;
      for (const d of R.colonies) if (d !== c) { const e = Math.hypot(d.base[0] - x, d.base[1] - c.base[1], d.base[2] - z); nn = Math.min(nn, e); if (e < 3) near++; }
      dmin = Math.min(dmin, nn); nnSum += nn; crowd = Math.max(crowd, near);
    }
    ok(Math.min(...quad) >= 0.12 * n, 'seeds: every quadrant of the plot has colonies', quad.join(' '));
    ok(rmax > 0.75 * R.radius && rsum / n > 0.35 * R.radius, 'seeds: the colonies spread out to the edge of the plot', `max r ${f2(rmax)} m, mean r ${f2(rsum / n)} m of R ${R.radius}`);
    ok(dmin >= 0.6, 'seeds: no two seeds closer than 0.6 m (no clumping)', `min ${f2(dmin)} m, mean nearest ${f2(nnSum / n)} m`);
    ok(crowd <= 7, 'seeds: at most 7 neighbours within 3 m of any seed', `${crowd}`);
    ok(nnSum / n < 4.5, 'seeds: neighbours are near enough to meet (patches)', `mean nearest ${f2(nnSum / n)} m`);
    // species by site
    const by = {};
    for (const c of R.colonies) (by[c.id] = by[c.id] || []).push(c);
    const mean = (L, f) => L && L.length ? L.reduce((a, c) => a + f(c), 0) / L.length : NaN;
    ok(Object.keys(by).length >= 4, 'seeds: a mixed reef has four or more species', Object.entries(by).map(([k, v]) => `${k} ${v.length}`).join(', '));
    const upTop = mean([...(by.staghorn || []), ...(by.table || [])], c => c.normal[1]);
    const upFan = mean(by.fan, c => c.normal[1]);
    ok(upTop > 0.6 && (isNaN(upFan) || upFan < upTop - 0.2), 'seeds: staghorn and tables on tops, fans on walls', `normal y: tops ${f2(upTop)}, fans ${f2(upFan)}`);
    ok(R.colonies.every(c => c.size >= 1 && c.size <= 4), 'seeds: every colony size is 1 to 4 m', `${f2(Math.min(...R.colonies.map(c => c.size)))} .. ${f2(Math.max(...R.colonies.map(c => c.size)))}`);
    const R80 = createReef({ rock: realRock, seed: 7, quality: 'desktop' });
    R80.populate({ colonies: 80 });
    ok(R80.colonies.length >= 72, 'seeds: 80 colonies on request', `${R80.colonies.length}`);
  }
  const s = { p: [0, 0, 0], n: [0, 1, 0], exposure: 0.9, overhang: false };
  ok(pickSpecies({ ...s, n: [0, -1, 0], overhang: true }, 0.5, 0.5) === null, 'seeds: no colony under an overhang');
  const tally = {};
  for (let i = 0; i < 400; i++) { const id = pickSpecies({ ...s, n: [0.95, 0.3, 0], exposure: 0.5 }, 0.5, (i + 0.5) / 400); tally[id] = (tally[id] || 0) + 1; }
  ok((tally.fan || 0) > 200, 'seeds: a wall site gets mostly sea fans', JSON.stringify(tally));
  const t2 = {};
  for (let i = 0; i < 400; i++) { const id = pickSpecies({ ...s, exposure: 0.05 }, 0.1, (i + 0.5) / 400); t2[id] = (t2[id] || 0) + 1; }
  ok((t2.boulder || 0) + (t2.finger || 0) > 200, 'seeds: a sheltered deep site gets mostly brain and finger corals', JSON.stringify(t2));
  ok(Object.keys(PRESETS).length === 5, 'seeds: five presets');
}

// ── sizes, thickness, polyps: one colony of each species ────────────────────
const single = {};
{
  const rock = flatRock();
  for (const id of SPECIES_IDS) {
    const R = createReef({ rock, seed: 21, quality: 'desktop', env: { strength: 0.3 } });
    const sp = SPECIES[id];
    const c = R.growColony(site(0, 0), id, { size: sp.size[1] });
    const t0 = now();
    R.growAll(Infinity, 2e6);
    const ms = now() - t0;
    const s = shapeOf(R, c, c.plane);
    const M = meshOf(R, false);
    const t1 = now();
    const list = M.meshAll();
    const mms = now() - t1;
    single[id] = { R, c, s, M, list, ms, mms };
    ok(s.size >= 1 && s.size <= 4.05, `sizes: ${id} colony is 1 to 4 m`, `size ${f2(s.size)} m (w ${f2(s.width)}, h ${f2(s.height)}), ${c.count} particles, target ${f2(c.size)}`);
  }
  ok(single.staghorn.s.size > 1.5, 'sizes: staghorn grows past 1.5 m', f2(single.staghorn.s.size));
  ok(single.fan.s.thickness < 0.06 * single.fan.s.width, 'sizes: the sea fan is planar across the current', `thick ${f3(single.fan.s.thickness)} m, wide ${f2(single.fan.s.width)} m`);
  ok(single.table.s.width > 4 * single.table.s.height, 'sizes: the table coral is a wide plate', `w ${f2(single.table.s.width)} h ${f2(single.table.s.height)}`);
  const fillS = id => single[id].s.fill * Math.pow(single[id].R.params[id].particleSpacing, 3);
  ok(fillS('boulder') > 5 * fillS('staghorn'), 'sizes: the brain coral is compact (particles per spacing^3)', `${f3(fillS('boulder'))} vs staghorn ${f3(fillS('staghorn'))}`);
}

// ── thickness: measured on the fine mesh ────────────────────────────────────
// 2 x the median distance of a mesh vertex to the axis of its cone (the
// smoothed points of the fine field); for the table plate, 2 x the median
// height of a vertex over its plate particle; for the sea fan, 2 x the
// median distance of a vertex to the fan plane (the sheet thickness).
{
  for (const id of SPECIES_IDS.filter(q => q !== 'boulder')) {
    const { M, s, list, c } = single[id];
    const F = [...M.fields.values()].find(f => f.id === id && f.lev === 0), O = F.origin, S = F.SM;
    const d = [];
    for (const m of list) {
      const P = m.positions, G = m.gids;
      for (let v = 0; v < G.length; v += 3) {
        const g = G[v]; if (g < 0) continue;
        const i = F.localOf.get(g); if (i === undefined) continue;
        if (id === 'table') { d.push(Math.abs(P[v * 3 + 1] - F.Y[i])); continue; }
        if (id === 'fan') { d.push(Math.abs((P[v * 3] - c.base[0]) * c.plane[0] + (P[v * 3 + 2] - c.base[2]) * c.plane[1])); continue; }
        const p = F.tree.parent(i); if (p < 0) continue;
        const x = P[v * 3] - O[0], y = P[v * 3 + 1] - O[1], z = P[v * 3 + 2] - O[2];
        d.push(segDist(x, y, z, S[p * 3], S[p * 3 + 1], S[p * 3 + 2], S[i * 3], S[i * 3 + 1], S[i * 3 + 2]));
      }
    }
    const thick = 2 * median(d), rel = thick / s.size, old = OLD[id].thick;
    const need = id === 'finger' ? 0.8 : 0.6;
    const what = id === 'table' ? 'plate is' : id === 'fan' ? 'sheet is' : 'branches are';
    ok(rel < need * old, `thickness: ${id} ${what} finer than before (measured)`, `${f3(thick * 100)} cm on a ${f2(s.size)} m colony = ${f4(rel)} of its size; old page ${f4(old)} (x${f2(rel / old)})`);
    if (id === 'staghorn' || id === 'fan' || id === 'table') ok(thick < 0.045, `thickness: ${id} median under 4.5 cm`, `${f3(thick * 100)} cm`);
  }
}

// the brain coral: its fine structure is the groove, valleys about 10 cm
// apart that meander (count the valleys along lines over the dome)
{
  let valleys = 0, len = 0;
  for (let k = 0; k < 12; k++) {
    const a = k * 0.52, dx = Math.cos(a), dz = Math.sin(a), y0 = 0.3 * k / 12;
    let prev = groove(0, y0, 0) > 0.5;
    for (let t = 0.005; t <= 2; t += 0.005) { const v = groove(dx * t, y0, dz * t) > 0.5; if (v && !prev) valleys++; prev = v; }
    len += 2;
  }
  const per = valleys / len;
  ok(per > 5 && per < 14, 'thickness: brain coral valleys are 7 to 20 cm apart', `${f2(per)} valleys per m (${f2(100 / per)} cm apart)`);
}

// ── polyps per m^2 ──────────────────────────────────────────────────────────
{
  for (const id of SPECIES_IDS) {
    const { list, s } = single[id];
    const area = meshStats(list).area;
    let n = 0; for (const m of list) n += m.polyps.length / 8;
    const dens = n / Math.max(1e-9, area), sh = SHAPES[id].polyp;
    const rel = dens * s.size * s.size, oldRel = OLD[id].density * OLD[id].size * OLD[id].size;
    const br = dens * SHAPES[id].rTip * SHAPES[id].rTip, oldBr = OLD[id].density * OLD[id].rTip * OLD[id].rTip;
    ok(dens >= 0.85 * sh.density, `polyps: ${id} density per m^2 meets its table value`, `${Math.round(dens)} /m^2 (table ${sh.density}), ${n} polyps on ${f2(area)} m^2`);
    ok(rel > 3 * oldRel, `polyps: ${id} has several times more polyps per colony area than before`, `x${f2(rel / oldRel)}; per branch radius^2 x${f2(br / oldBr)}`);
    ok(br >= 0.95 * oldBr, `polyps: ${id} polyps per branch radius^2 at least as dense as before`, `${f3(br)} vs ${f3(oldBr)}`);
  }
  // polyps sit on the surface with unit normals, and rand is uniform
  const P = single.staghorn.list.flatMap(m => Array.from(m.polyps));
  let bad = 0, rs = 0;
  for (let i = 0; i < P.length; i += 8) { if (Math.abs(Math.hypot(P[i + 3], P[i + 4], P[i + 5]) - 1) > 1e-3) bad++; rs += P[i + 7]; }
  ok(bad === 0 && Math.abs(rs / (P.length / 8) - 0.5) < 0.03, 'polyps: unit normals and a uniform LOD rand', `mean rand ${f3(rs / (P.length / 8))}`);
}

// ── interference ────────────────────────────────────────────────────────────
{
  const rock = flatRock();
  const cap = QUICK ? 900 : 1500, size = 2.6, gap = 0.6;
  function grow(seeds) {
    const R = createReef({ rock, seed: 33, quality: 'desktop', env: { strength: 0 } });
    R.reset(33);
    for (const [id, x] of seeds) R.addColony(id, site(x, 0), { size, cap });
    R.growAll(Infinity, 3e6);
    return R;
  }
  // competition: the same snow (walkers per colony) for a colony alone and
  // for two neighbours 0.6 m apart, over three seeds. With a neighbour, a
  // colony puts a smaller share of its mass past the middle of the gap,
  // reaches less far toward it, and more away from it.
  const W = QUICK ? 9000 : 16000;
  function snow(seed, seeds) {
    const R = createReef({ rock, seed, quality: 'desktop', env: { strength: 0 } });
    for (const [id, x] of seeds) R.addColony(id, site(x, 0), { size, cap: 1e6 });
    R.growAll(Infinity, W * seeds.length);
    return R;
  }
  const stats = (R, c, dir) => {
    const u = c.ids.map(g => (R.px[g] - c.base[0]) * dir).sort((a, b) => a - b);
    return [u.filter(v => v > gap / 2).length / u.length, u[Math.floor(u.length * 0.95)], u[Math.floor(u.length * 0.05)]];
  };
  const A = [0, 0, 0], P = [0, 0, 0];
  let n = 0, fused = 0, AB = null;
  for (const sd of [1, 2, 3]) {
    const a = snow(sd, [['staghorn', -gap / 2]]), b = snow(sd + 100, [['staghorn', gap / 2]]), p = snow(sd, [['staghorn', -gap / 2], ['staghorn', gap / 2]]);
    for (const v of [stats(a, a.colonies[0], 1), stats(b, b.colonies[0], -1)]) for (let k = 0; k < 3; k++) A[k] += v[k];
    for (const v of [stats(p, p.colonies[0], 1), stats(p, p.colonies[1], -1)]) for (let k = 0; k < 3; k++) P[k] += v[k];
    n += 2;
    const t = p.contacts.get('0,1');
    if (t && t.kind === 'fuse' && t.n > 0) { fused++; if (!AB || !AB.contacts.get('0,1') || t.n > AB.contacts.get('0,1').n) AB = p; }
    if (!AB) AB = p;
  }
  for (let k = 0; k < 3; k++) { A[k] /= n; P[k] /= n; }
  ok(P[0] < 0.75 * A[0], 'interference: neighbours compete: each puts less of its mass toward the other', `share past mid-gap: alone ${f3(A[0])}, with a neighbour ${f3(P[0])} (3 seeds, ${W} walkers each)`);
  ok(P[1] < A[1] - 0.05 && P[2] < A[2], 'interference: each reaches less far toward the other and further away', `95% reach toward ${f2(A[1])} -> ${f2(P[1])} m, away ${f2(-A[2])} -> ${f2(-P[2])} m`);
  ok(fused >= 2, 'interference: two staghorn colonies fuse where they touch', `${fused} of 3 pairs; ${AB.contacts.get('0,1') ? AB.contacts.get('0,1').n + ' contacts at ' + AB.contacts.get('0,1').at.map(f2).join(',') : ''}`);
  // shading: a grown table plate over a staghorn seed takes its snow
  function shade(withTable) {
    const R = createReef({ rock, seed: 41, quality: 'desktop', env: { strength: 0 } });
    if (withTable) { R.addColony('table', site(0, 0), { size: 3, cap: QUICK ? 1500 : 2500 }); R.growAll(Infinity, 1e6); }
    const c = R.addColony('staghorn', site(0.6, 0.3), { size: 2, cap: 1e6 });
    R.growAll(Infinity, 5000);
    return c.count;
  }
  const s0 = shade(false), s1 = shade(true);
  ok(s1 < 0.3 * s0, 'interference: a table plate above shades the colony under it', `staghorn particles from the same snow: open ${s0}, under the plate ${s1}`);
  // one surface: a welded component of the fine mesh holds vertices of both colonies
  const M = meshOf(AB, false);
  const list = M.meshAll();
  const key = (x, y, z) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
  const id = new Map(), par = [];
  const find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const vtx = [];
  for (const m of list) {
    const P = m.positions, loc = [];
    for (let v = 0; v < P.length / 3; v++) {
      const k = key(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      let q = id.get(k); if (q === undefined) { q = par.length; par.push(q); id.set(k, q); vtx.push(m.gids[v]); }
      loc.push(q);
    }
    for (let t3 = 0; t3 < m.indices.length; t3 += 3) {
      const a = find(loc[m.indices[t3]]), b = find(loc[m.indices[t3 + 1]]), c = find(loc[m.indices[t3 + 2]]);
      par[b] = a; par[find(c)] = a;
    }
  }
  const comp = new Map();
  for (let q = 0; q < par.length; q++) { const r = find(q), g = vtx[q]; if (g < 0) continue; const s = comp.get(r) || new Set(); s.add(AB.col[g]); comp.set(r, s); }
  ok([...comp.values()].some(s => s.size === 2), 'interference: the fused colonies share one surface (a welded mesh part holds both)', `${comp.size} mesh parts`);
  const X = grow([['staghorn', -gap / 2], ['table', gap / 2]]);
  const tx = X.contacts.get('0,1');
  ok(tx && tx.kind === 'overgrow', 'interference: staghorn and table overgrow where they meet', tx ? `${tx.n} contacts, by colony ${tx.by}` : 'no contact');
  const progress = AB.progress();
  ok(progress.fusions >= 1, 'interference: progress counts the fusions', `${progress.fusions} fusions, ${progress.overgrowths} overgrowths`);
}

// ── the real rock: growth over time, nothing in the rock ────────────────────
let rockReef;
{
  const R = createReef({ rock: realRock, seed: 5, quality: 'phone' });
  R.populate();
  const t0 = now();
  const n = QUICK ? 4000 : 10000;
  R.growAll(n, 2e6);
  const ms = now() - t0;
  rockReef = { R, ms };
  const r = rockCheck(R, realRock);
  ok(r.inside === 0 && r.under === 0, 'rock: no particle inside the rock or under the sand', `${R.count} particles, inside ${r.inside}, under sand ${r.under}, least sdf ${f4(r.worst)} m`);
  const grown = R.colonies.filter(c => c.count > 20).length;
  ok(grown > 0.8 * R.colonies.length, 'rock: most colonies grow on the real rock', `${grown} of ${R.colonies.length}`);
  ok(R.count >= n, 'rock: the reef grows to the asked count', `${R.count} in ${(ms / 1000).toFixed(1)} s`);
}

// ── determinism ─────────────────────────────────────────────────────────────
{
  const mk = () => { const R = createReef({ rock: realRock, seed: 12, quality: 'phone' }); R.populate(); return R; };
  const a = mk(), b = mk(), c = createReef({ rock: realRock, seed: 13, quality: 'phone' });
  c.populate();
  const N = 2500;
  a.growAll(N);
  let t = 0;
  while (b.count < a.count && t < 5000) { b.step(16, 1 + (t % 5), t * 16); t++; }
  c.growAll(N);
  ok(hashReef(a, a.count) === hashReef(b, a.count), 'determinism: the same seed grows the same reef, for any time budget', `hash ${hashReef(a)} (${a.count} particles, ${t} steps)`);
  ok(hashReef(a, N) !== hashReef(c, N), 'determinism: another seed grows another reef');
  ok(speciesHook('fan').fn.toString().includes('plane'), 'determinism: the saver code extract is real hook source');
}

// ── LOD and focus ───────────────────────────────────────────────────────────
{
  const { R } = single.staghorn;
  const M = meshOf(R, true, []);
  M.meshAll();
  const coarse = M.stats().trisCoarse;
  const fine = single.staghorn.M.stats().tris;
  ok(coarse < 0.3 * fine, `lod: the coarse mesh (cell x${LOD_K}) is much smaller`, `coarse ${coarse} vs fine ${fine} tris`);
  M.setFocus([0]);
  let out = M.update(1e9);
  const st1 = M.stats();
  ok(st1.trisFine > 0.9 * fine && out.some(r => r.lod === 0 && r.polyps.length), 'lod: a focus colony gets the fine mesh with polyps', `${st1.trisFine} fine tris`);
  M.setFocus([]);
  out = M.update(1e9);
  ok(out.filter(r => r.lod === 0).every(r => r.indices.length === 0) && M.stats().trisFine === 0, 'lod: dropping the focus removes the fine bricks', `${out.length} removals`);
  const ks = chooseFocus(rockReef.R.colonies, [rockReef.R.colonies[0].base], 300000);
  ok(ks[0] === 0 && ks.length >= 1, 'lod: chooseFocus starts at the nearest colony and keeps the budget', `${ks.length} colonies`);
}

// ── worker ──────────────────────────────────────────────────────────────────
{
  const msgs = [];
  const mirror = createReefMirror();
  let contiguous = true, typed = true;
  const run = createReefRunner({
    post(m) {
      msgs.push(m);
      if (m.type === 'colonies') mirror.setColonies(m.list);
      if (m.type === 'particles') { if (!mirror.addParticles(m.from, m.data) || m.data.length % PARTICLE_FLOATS) contiguous = false; }
      if (m.type === 'bricks') for (const b of m.list) if (!(b.positions instanceof Float32Array) || !(b.gids instanceof Float32Array) || !(b.lod === 0 || b.lod === 1)) typed = false;
    },
    makeRock: () => realRock,
  });
  const wait = (pred, ms = 60000) => new Promise((res) => { const t0 = now(); const iv = setInterval(() => { if (pred() || now() - t0 > ms) { clearInterval(iv); res(); } }, 20); });
  const t0 = now();
  await run.onMessage({ type: 'init', seed: 4, quality: 'phone', radius: 30, sites: realRock.sampleSurface(30 * 24, null) });
  await run.onMessage({ type: 'view', points: [[0, 2, 0]] });
  await wait(() => mirror.count >= 1500);
  const types = new Set(msgs.map(m => m.type));
  ok(['ready', 'colonies', 'particles', 'bricks', 'progress'].every(t => types.has(t)), 'worker: ready, colonies, particles, bricks and progress messages', [...types].join(' '));
  ok(contiguous && mirror.count >= 1500, 'worker: particle messages are contiguous and fill the mirror', `${mirror.count} particles in ${((now() - t0) / 1000).toFixed(1)} s`);
  ok(typed, 'worker: brick meshes carry typed arrays and a lod');
  const prog = msgs.filter(m => m.type === 'progress').pop();
  ok(prog && prog.target > 0 && prog.fraction > 0 && prog.focus > 0 && typeof prog.trisFine === 'number', 'worker: progress has the counts, the budget and the focus', prog ? `count ${prog.count}/${prog.target}, focus ${prog.focus}, tris ${prog.tris}, polyps ${prog.polyps}` : '');
  ok(msgs.some(m => m.type === 'bricks' && m.list.some(b => b.lod === 0 && b.polyps.length)), 'worker: the focus colonies come with fine bricks and polyps');
  // colour modes on the mirror
  let range = true;
  for (const md of MODES) { const t = colourT(mirror, md.id); for (let g = 0; g < mirror.count; g++) if (!(t[g] >= 0 && t[g] <= 1)) { range = false; break; } }
  const rgb = naturalRGB(mirror), rad = radiiOf(mirror);
  ok(range && rgb[0] > 0 && rad[0] > 0, 'colour: every mode gives t in 0..1 on the mirror', MODES.map(m => m.id).join(' '));
  // single-colony mode (the saver), at a controlled rate
  const g0 = run.gen;
  await run.onMessage({ type: 'play', on: true });
  await run.onMessage({ type: 'single', site: realRock.sampleSurface(1, null)[0], species: 'staghorn', rate: 0 });
  await wait(() => false, 300);
  const R = run.reef;
  ok(run.gen === g0 + 1 && R.colonies.length === 1 && R.count === 1, 'worker: single mode grows one colony; rate 0 holds it at its seed', `gen ${run.gen}, colonies ${R.colonies.length}, particles ${R.count}`);
  await run.onMessage({ type: 'rate', value: 400 });
  const tr = now();
  await wait(() => R.count >= 200, 20000);
  const rate = R.count / ((now() - tr) / 1000);
  ok(R.count >= 200 && rate < 600, 'worker: the single colony grows at about the set rate', `${R.count} particles at ${Math.round(rate)} /s (set 400)`);
  await run.onMessage({ type: 'play', on: false });
  await wait(() => false, 100);
  const sing = msgs.filter(m => m.type === 'colonies').pop();
  ok(sing.gen === run.gen && sing.list.length === 1, 'worker: the colonies message of the new gen lists one colony');
}

// ── timings ─────────────────────────────────────────────────────────────────
{
  const R = createReef({ rock: realRock, seed: 9, quality: 'desktop' });
  R.populate();
  const N = QUICK ? 4000 : 8000;
  let t0 = now();
  R.growAll(N);
  const gs = (now() - t0) / 1000, rate = R.count / gs;
  const M = createCoralMesher({ fine: R.fine, radius: R.radius, polyps: 1, lod: true });
  for (const c of R.colonies) M.addColony(colonyInfo(c));
  t0 = now();
  for (let g = 0; g < R.count; g++) M.add(g, R.parent[g], R.px[g], R.py[g], R.pz[g], R.col[g]);
  M.setFocus(chooseFocus(R.colonies, [R.colonies[0].base], R.Q.tris * 0.7));
  M.meshAll();
  const ms = (now() - t0) / 1000, st = M.stats();
  const full = R.Q.particles * (1 / rate + ms / R.count);
  console.log(`     load average ${os.loadavg().map(v => v.toFixed(1)).join(' ')} (timings are wall clock)`);
  console.log(`     growth ${Math.round(rate)} particles/s, mesh ${(ms / R.count * 1000).toFixed(2)} ms/particle (coarse all + fine focus ${st.focus}), ${st.trisFine} fine + ${st.trisCoarse} coarse tris, ${st.polyps} polyps`);
  ok(rate > 500, 'timings: desktop growth on the real rock is over 500 particles/s on one thread', `${Math.round(rate)} /s`);
  ok(full < 240, 'timings: a full desktop reef (120k) grows and meshes in under 4 minutes in the worker', `${full.toFixed(0)} s projected`);
  ok(rockReef.ms / rockReef.R.count < 5, 'timings: phone reef growth under 5 ms per particle', `${(rockReef.ms / rockReef.R.count).toFixed(2)} ms`);
  ok(single.staghorn.mms < 6000, 'timings: a 2 m staghorn meshes (fine) in under 6 s', `${(single.staghorn.mms / 1000).toFixed(2)} s, ${single.staghorn.M.stats().tris} tris`);
}
ok(polypRadius(SPECIES.staghorn, 1) > 0 && polypRadius(SPECIES.staghorn, 1000) > polypRadius(SPECIES.staghorn, 1), 'colour: particle radius grows with the subtree');

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
