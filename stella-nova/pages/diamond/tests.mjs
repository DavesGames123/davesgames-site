// ============================================================================
//  DIAMOND LAB  ·  tests.mjs — node checks (no browser)
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/diamond/tests.mjs
//  Groups:
//    geometry   every cut at its defaults and at every corner of the
//               slider ranges is closed (each directed edge has one
//               reverse), Euler V - E + F = 2, convex (every vertex in
//               every half-space), every plane has a face, the vector
//               areas add to zero, plane count fits the GPU buffer
//    brilliant  the round cut has 57 facets and Tolkowsky proportions
//    optics     Snell, TIR past the critical angle, Fresnel limits,
//               Cauchy reproduces n_d and the Abbe number, B-G dispersion
//               matches the gem tables, spectral weights add to white
//    tracer     the CPU copy of the shader loop: energy is conserved, an
//               ideal diamond returns more light than a deep one or glass
//    saver      the hook shape, the director over 3 simulated minutes, the
//               plate payload (title, TeX, no code)
//    page       main.js and saver.js link in node (no SyntaxError); the
//               WGSL validates in naga when ~/.cargo/bin/naga exists
// ============================================================================
import { buildCut, CUTS, CUT_KEYS, RANGES, MAX_PLANES, topology, polyAreaVec } from './cuts.js';
import * as O from './optics.js';
import { makeSaver, plateFor, SHOT_KEYS, bag, makeRng } from './saver.js';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

let pass = 0, fail = 0;
function ok(cond, name, extra = '') { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } }
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ── geometry ────────────────────────────────────────────────────────────────
function checkSolid(g, tag) {
  const T = topology(g.faces);
  ok(T.bad.length === 0, tag + ' closed and oriented', T.bad.length + ' bad edges');
  ok(T.euler === 2, tag + ' Euler V-E+F=2', `V${T.V} E${T.E} F${T.F}`);
  ok(g.faces.every(f => f.plane >= 0), tag + ' bounded by its own planes (no box face left)');
  ok(g.planes.length <= MAX_PLANES, tag + ' fits the plane buffer', String(g.planes.length));
  const used = new Set(g.faces.map(f => f.plane));
  ok(used.size === g.planes.length, tag + ' every plane has a face');
  let worst = 0, flat = 0;
  for (const v of T.verts) for (const p of g.planes) worst = Math.max(worst, p.n[0] * v[0] + p.n[1] * v[1] + p.n[2] * v[2] - p.d);
  for (const f of g.faces) { const p = g.planes[f.plane]; for (const v of f.verts) flat = Math.max(flat, Math.abs(p.n[0] * v[0] + p.n[1] * v[1] + p.n[2] * v[2] - p.d)); }
  ok(worst < 1e-6, tag + ' convex: every vertex inside every half-space', worst.toExponential(2));
  ok(flat < 1e-6, tag + ' faces lie on their planes', flat.toExponential(2));
  const s = [0, 0, 0]; for (const f of g.faces) { const a = polyAreaVec(f.verts); for (let i = 0; i < 3; i++) s[i] += a[i]; }
  ok(Math.hypot(...s) < 1e-6, tag + ' vector areas add to zero (closed)', Math.hypot(...s).toExponential(2));
  // each face is wound counter-clockwise about its outward normal
  ok(g.faces.every(f => { const a = polyAreaVec(f.verts), n = g.planes[f.plane].n; return a[0] * n[0] + a[1] * n[1] + a[2] * n[2] > 0; }), tag + ' faces wound outward');
}
for (const k of CUT_KEYS) {
  const g = buildCut(k);
  checkSolid(g, k);
  ok(g.faces.some(f => f.kind === 'table'), k + ' has a table');
  ok(g.stats.radius > 0.9 && g.stats.radius < 1.6, k + ' radius in range', g.stats.radius.toFixed(3));
}
let corners = 0;
for (const k of CUT_KEYS) for (const t of RANGES.table) for (const c of RANGES.crown) for (const p of RANGES.pav) for (const gd of RANGES.girdle) {
  const g = buildCut(k, { table: t, crown: c, pav: p, girdle: gd }), T = topology(g.faces);
  corners++;
  ok(T.bad.length === 0 && T.euler === 2 && g.planes.length <= MAX_PLANES, `${k} closed at table ${t} crown ${c} pav ${p} girdle ${gd}`);
}

// ── round brilliant ─────────────────────────────────────────────────────────
{
  const g = buildCut('round'), kinds = {};
  for (const f of g.faces) kinds[f.kind] = (kinds[f.kind] || 0) + 1;
  ok(g.stats.facets === 58 && kinds.culet === 1, 'round brilliant has 57 facets and a culet', String(g.stats.facets));
  ok(kinds.star === 8 && kinds['upper girdle'] === 16 && kinds['lower girdle'] === 16 && kinds['crown main'] === 8 && kinds['pavilion main'] === 8, 'round brilliant facet families 8/8/16/8/16', JSON.stringify(kinds));
  const w = g.stats.width;
  ok(near(g.stats.tableW / w, 0.56, 0.015), 'table is 56% of the width', (g.stats.tableW / w).toFixed(3));
  ok(near(g.stats.crownH / w, 0.15, 0.015), 'crown height about 15% (Tolkowsky 16.2%)', (g.stats.crownH / w).toFixed(3));
  ok(near(g.stats.pavD / w, 0.42, 0.02), 'pavilion depth about 43% (Tolkowsky 43.1%)', (g.stats.pavD / w).toFixed(3));
  const deep = buildCut('round', { pav: 46 });
  ok(deep.stats.pavD > g.stats.pavD, 'a larger pavilion angle makes a deeper pavilion');
  const bigT = buildCut('round', { table: 0.68 });
  ok(bigT.stats.tableW > g.stats.tableW && bigT.stats.crownH < g.stats.crownH, 'a larger table makes a lower crown');
}

// ── optics ──────────────────────────────────────────────────────────────────
{
  const n = 2.417, deg = Math.PI / 180;
  for (const a of [5, 20, 45, 70, 85]) {
    const d = [Math.sin(a * deg), -Math.cos(a * deg), 0], t = O.refract(d, [0, 1, 0], 1 / n);
    const s2 = Math.hypot(t[0], t[2]);
    ok(near(Math.sin(a * deg), n * s2, 1e-9), `Snell n1 sin a1 = n2 sin a2 at ${a}°`);
    ok(near(Math.hypot(...t), 1, 1e-9), `refracted ray is unit length at ${a}°`);
  }
  const tc = O.criticalAngle(n);
  ok(near(tc / deg, 24.44, 0.05), 'diamond critical angle 24.4°', (tc / deg).toFixed(2));
  ok(near(O.criticalAngle(1.517) / deg, 41.25, 0.1), 'crown glass critical angle 41.2°');
  const inside = a => [Math.sin(a), Math.cos(a), 0];   // inside the stone, toward the facet at y = 0 with normal +y
  ok(O.refract(inside(tc - 0.01), [0, -1, 0], n) !== null, 'below the critical angle the ray leaves');
  ok(O.refract(inside(tc + 0.01), [0, -1, 0], n) === null, 'past the critical angle: total internal reflection');
  ok(O.fresnel(Math.cos(tc + 0.01), n, 1) === 1, 'Fresnel R = 1 past the critical angle');
  ok(near(O.fresnel(1, 1, n), O.reflectance0(n), 1e-12), 'Fresnel at normal incidence = ((n-1)/(n+1))^2');
  ok(near(O.reflectance0(n), 0.172, 0.002), 'diamond reflects 17.2% straight on', O.reflectance0(n).toFixed(4));
  ok(O.fresnel(1e-6, 1, n) > 0.999, 'Fresnel R -> 1 at grazing incidence');
  let mono = true, prev = 0; for (let a = 0; a < 89; a++) { const r = O.fresnel(Math.cos(a * deg), 1, n); if (r < prev - 1e-12 && a > 70) mono = false; if (r < 0 || r > 1) mono = false; prev = r; }
  ok(mono, 'Fresnel R stays in [0, 1] and rises toward grazing');
  ok(near(O.fresnel(Math.cos(30 * deg), 1, 1.5), O.fresnel(Math.cos(Math.asin(Math.sin(30 * deg) / 1.5)), 1.5, 1), 1e-12), 'Fresnel is the same both ways (reciprocity)');
  for (const [k, m] of Object.entries(O.MATERIALS)) {
    ok(near(O.indexAt(m.nd, m.abbe, O.LAMBDA.d), m.nd, 1e-12), k + ': n(587.6 nm) = n_d');
    const nF = O.indexAt(m.nd, m.abbe, O.LAMBDA.F), nC = O.indexAt(m.nd, m.abbe, O.LAMBDA.C);
    ok(near((m.nd - 1) / (nF - nC), m.abbe, 1e-9), k + ': Abbe number from n_F, n_C');
    ok(O.indexAt(m.nd, m.abbe, 0.45) > O.indexAt(m.nd, m.abbe, 0.65), k + ': blue bends more than red');
  }
  const BG = { diamond: 0.044, moissanite: 0.104, cz: 0.060, sapphire: 0.018, ruby: 0.018, emerald: 0.014, amethyst: 0.013 };
  for (const [k, v] of Object.entries(BG)) { const d = O.dispersionBG(O.MATERIALS[k].nd, O.MATERIALS[k].abbe); ok(near(d, v, v * 0.06), `${k} B-G dispersion ${v}`, d.toFixed(4)); }
  ok(near(O.indexAt(2.417, 55, 0.45, 0), 2.417, 1e-12), 'fire 0 removes dispersion');
  for (const c of [1, 3, 6, 9, 12]) {
    const s = O.spectralSamples(c), sum = [0, 1, 2].map(i => s.reduce((a, o) => a + o.w[i], 0));
    ok(s.length === c && sum.every(v => near(v, 1, 1e-9)) && s.every(o => o.w.every(v => v >= 0)), `${c} wavelength weights are >= 0 and add to white`);
  }
  const s3 = O.spectralSamples(3);
  ok(s3[0].w[2] > s3[0].w[0] && s3[2].w[0] > s3[2].w[2], 'short wavelengths weigh blue, long ones red');
}

// ── tracer ──────────────────────────────────────────────────────────────────
function tableReturn(g, n, rays = 15) {
  // vertical rays down through the inner table, the mean light return
  let sum = 0, cnt = 0;
  const top = Math.max(...g.faces.flatMap(f => f.verts.map(v => v[1]))) + 1;
  for (let i = 0; i < rays; i++) for (let j = 0; j < rays; j++) {
    const x = (i / (rays - 1) - 0.5) * g.stats.tableW * 0.8, z = (j / (rays - 1) - 0.5) * g.stats.tableW * 0.8;
    const ex = O.traceRay(g.planes, [x, top, z], [0, -1, 0], n, 16);
    if (!ex) continue;
    sum += O.lightReturn(ex); cnt++;
    const tot = ex.reduce((a, e) => a + e.w, 0);
    if (!near(tot, 1, 1e-9)) ok(false, 'energy conserved for one ray', tot);
  }
  return sum / Math.max(1, cnt);
}
{
  const ideal = buildCut('round'), deep = buildCut('round', { pav: 56 });
  const rI = tableReturn(ideal, 2.417), rD = tableReturn(deep, 2.417), rG = tableReturn(ideal, 1.517);
  ok(rI > 0.8, 'ideal round diamond returns > 80% of table light upward', rI.toFixed(3));
  ok(rI > rD, 'a 56° pavilion leaks more than the ideal 40.75° (nailhead: 180° - 3 x 56° < 24.4°)', rI.toFixed(3) + ' vs ' + rD.toFixed(3));
  ok(rI > rG + 0.2, 'glass in the same cut leaks far more than diamond', rI.toFixed(3) + ' vs ' + rG.toFixed(3));
  const ex = O.traceRay(ideal.planes, [0.05, 3, 0.02], [0, -1, 0], 2.417, 16);
  ok(ex && near(ex.reduce((a, e) => a + e.w, 0), 1, 1e-9), 'energy is conserved along a traced ray');
  ok(O.traceRay(ideal.planes, [5, 3, 0], [0, -1, 0], 2.417) === null, 'a ray beside the stone misses it');
}

// ── saver ───────────────────────────────────────────────────────────────────
{
  const calls = [], ticks = new Set();
  const S = { cut: 'round', prop: {}, mat: 'diamond', fire: 1, bounces: 8, samples: 2, env: 0, rig: 0, sweep: false, sweepAz: 0, exposure: 1, spark: 1, mode: 0, spin: true, cam: { yaw: 0, pitch: 0.5, zoom: 1 }, fade: 0, saver: false, band: null };
  let geom = buildCut('round'); const seenCuts = new Set(), seenMats = new Set();
  const app = {
    S, canvas: { id: 'view' }, cuts: CUT_KEYS, materials: Object.keys(O.MATERIALS),
    setCut(k) { S.cut = k; geom = buildCut(k); seenCuts.add(k); }, setMaterial(k) { S.mat = k; seenMats.add(k); },
    anchor: () => ({ x: 400, y: 300, r: 120 }), geom: () => geom,
    onTick(f) { ticks.add(f); return () => ticks.delete(f); }, band: () => ({ t: 120, b: 160 }), hideUI() { app.hidden = true; },
  };
  const sv = makeSaver(app);
  ok(typeof sv.enter === 'function' && typeof sv.exit === 'function', 'snSaver has enter and exit');
  const r = sv.enter({ calm: 0.7, seconds: 120, caption: true, seed: 1234, label: info => calls.push(info) });
  ok(r && r.canvas === app.canvas && r.warmupMs > 0, 'enter returns { canvas, warmupMs }');
  ok(app.hidden && S.saver, 'enter hides the GUI and sets saver mode');
  let fades = 0, wasDark = false, minPitch = 9, maxPitch = -9, fadeOk = true;
  for (let i = 0; i < 180 * 60; i++) {
    for (const f of ticks) f(1 / 60, i * 16.7);
    if (S.fade >= 1 && !wasDark) fades++;
    wasDark = S.fade >= 1;
    minPitch = Math.min(minPitch, S.cam.pitch); maxPitch = Math.max(maxPitch, S.cam.pitch);
    if (!(S.fade >= 0 && S.fade <= 1)) fadeOk = false;
  }
  ok(fadeOk, 'fade stays in [0, 1]');
  ok(fades >= 10, '3 minutes give at least 10 faded cuts', String(fades));
  ok(seenCuts.size >= 6, 'the run shows at least 6 cuts', String(seenCuts.size));
  ok(seenMats.size >= 5, 'the run shows at least 5 stones', String(seenMats.size));
  ok(minPitch < 0.2 && maxPitch > 1.2, 'camera goes from side views to face-up views', minPitch.toFixed(2) + '..' + maxPitch.toFixed(2));
  ok(calls.length > 0 && calls.every(c => c.title && c.sub && c.tex.length >= 2 && c.params.length >= 4 && !('code' in c)), 'plate: title, sub, TeX, params and no code');
  ok(calls.every(c => typeof c.anchor === 'function' && c.anchor().r > 0), 'plate anchor is the stone on screen');
  ok(S.band && S.band.t === 120, 'the saver frames the stone in the plate band');
  sv.exit();
  ok(ticks.size === 0 && !S.saver, 'exit stops the director');
  // two seeds give two orders
  const order = seed => { const r = makeRng(seed), b = bag(SHOT_KEYS, r); return Array.from({ length: 8 }, b).join(); };
  ok(order(1) !== order(2), 'different seeds give different shot orders');
  const b = bag([1, 2, 3], makeRng(5)); let prev = null, rep = false; for (let i = 0; i < 300; i++) { const v = b(); if (v === prev) rep = true; prev = v; }
  ok(!rep, 'a bag never repeats an item back to back');
  const p = plateFor(app, 'fire');
  ok(p.title.includes(CUTS[S.cut].name) && p.tex.some(t => t.includes('lambda')), 'the fire plate carries the dispersion equation');
}

// ── inspect: loupe and grading views ────────────────────────────────────────
{
  const I = await import('./inspect.js');
  const c = [300, 200];
  ok(I.loupeMap(c, c, 100, 10).every((v, i) => v === c[i]), 'the loupe centre traces itself');
  const m = I.loupeMap([350, 200], c, 100, 10);
  ok(near(m[0], 305, 1e-9) && m[1] === 200, 'a point 50 px out traces 5 px out at 10x', m.join());
  ok(I.loupeMap([450, 200], c, 100, 10)[0] === 450, 'a point outside the lens does not move');
  ok(I.loupeMap([350, 200], c, 100, 0)[0] === 350, 'a loupe of power 0 is off');
  ok(I.LOUPE_MAGS[0] === 0 && I.LOUPE_MAGS.includes(10), 'loupe powers: off and the standard 10x');
  ok(I.loupeRadius(390, 844) >= 70 && I.loupeRadius(2560, 1440) <= 190, 'the lens fits phone and desktop', I.loupeRadius(390, 844) + ', ' + I.loupeRadius(2560, 1440));
  ok(I.VIEWS.faceup.pitch > 1.4 && I.VIEWS.tabledown.pitch < -1.4 && I.VIEWS.profile.pitch === 0, 'face up, table down and profile pitches');
  ok(I.clampPitch(-1.5) === -1.5 && I.clampPitch(2) === 1.5, 'a drag reaches the table-down view');
  const wgsl = (await import('node:fs')).readFileSync(new URL('./shaders/gem.wgsl', import.meta.url), 'utf8');
  ok(/px = u\.scr\.zw \+ dl \/ u\.mat\.w/.test(wgsl), 'fs_gem maps the lens like loupeMap');
}

// ── page ────────────────────────────────────────────────────────────────────
{
  let err = null;
  try { await import('./main.js'); } catch (e) { err = e; }
  ok(!(err instanceof SyntaxError), 'main.js links in node (no SyntaxError)', err ? err.name + ': ' + err.message : 'loaded');
  const naga = homedir() + '/.cargo/bin/naga';
  const wgsl = fileURLToPath(new URL('./shaders/gem.wgsl', import.meta.url));
  if (existsSync(naga)) {
    let out = ''; try { out = execFileSync(naga, [wgsl], { encoding: 'utf8' }); } catch (e) { out = String(e.stdout || e.message); }
    ok(/Validation successful/.test(out), 'gem.wgsl validates in naga', out.trim().split('\n').pop());
  } else console.log('skip: naga not found');
  // Tint rejects mixed && and || (and mixed bit and arithmetic ops) without
  // parentheses; naga does not. A crude line check:
  const src = (await import('node:fs')).readFileSync(wgsl, 'utf8');
  const bad = src.split('\n').filter(l => !l.trim().startsWith('//') && /&&/.test(l) && /\|\|/.test(l));
  ok(bad.length === 0, 'no line mixes && and ||', bad.join(' | '));
}

console.log(`\n${pass} passed, ${fail} failed (${corners} proportion corners)`);
process.exit(fail ? 1 : 0);
