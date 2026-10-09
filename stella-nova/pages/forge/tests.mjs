// ============================================================================
//  PLANET FORGE  ·  tests.mjs — node tests for the pure modules
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/forge/tests.mjs
//  Each check prints one line. The process exits 1 if a check fails.
// ============================================================================
import * as N from './noise.js';
import * as PR from './presets.js';
import { craterList } from './rocky.js';
import { prepareGas, bandProfile, windProfile } from './gas.js';
import * as MP from './maps.js';
import { encodePNG, decodePNGRaw } from './png.js';
import * as BG from './budget.js';
import { packAtmo, transmittanceRef } from './atmo.js';

let fails = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!cond) fails++; };

// noise: determinism, range, gradient, seed independence
{
  const pts = []; const r = N.mulberry(99);
  for (let i = 0; i < 2000; i++) pts.push([r() * 20 - 10, r() * 20 - 10, r() * 20 - 10]);
  const a = pts.map(p => N.simplex3(p[0], p[1], p[2], 7)), b = pts.map(p => N.simplex3(p[0], p[1], p[2], 7));
  ok('noise: same seed gives same values', a.every((v, i) => v === b[i]));
  const c = pts.map(p => N.simplex3(p[0], p[1], p[2], 8));
  ok('noise: another seed gives other values', a.filter((v, i) => v !== c[i]).length > 1900);
  const mx = Math.max(...a.map(Math.abs));
  ok('noise: range within [-1, 1]', mx <= 1, `max |n| ${mx.toFixed(3)}`);
  let ge = 0; const g = [0, 0, 0], h = 1e-5;
  for (const p of pts.slice(0, 300)) {
    N.simplex3(p[0], p[1], p[2], 3, g);
    for (let k = 0; k < 3; k++) { const q = [...p], s = [...p]; q[k] += h; s[k] -= h; ge = Math.max(ge, Math.abs((N.simplex3(...q, 3) - N.simplex3(...s, 3)) / (2 * h) - g[k])); }
  }
  ok('noise: analytic gradient matches finite differences', ge < 1e-5, `max err ${ge.toExponential(1)}`);
  // continuity: no steps (kernel r^2 = 0.5 stays inside the simplex)
  let jump = 0;
  for (let i = 0; i < 200000; i++) { const x = i * 0.0001; jump = Math.max(jump, Math.abs(N.simplex3(x, 0.37, 0.71, 5) - N.simplex3(x + 0.0001, 0.37, 0.71, 5))); }
  ok('noise: continuous along a line (no kernel steps)', jump < 0.002, `max step ${jump.toExponential(1)}`);
  const o = { freq: 2, octaves: 6.5, lacunarity: 2, gain: 0.5 };
  const f1 = pts.map(p => N.fbm(p.map(v => v / 10), o, 4)), f2 = pts.map(p => N.fbm(p.map(v => v / 10), o, 4));
  ok('fbm: deterministic, bounded', f1.every((v, i) => v === f2[i] && Math.abs(v) < 1.5));
  const rr = pts.map(p => N.ridged(p.map(v => v / 10), o, 4, 2));
  ok('ridged: in [0, 1]', rr.every(v => v >= 0 && v <= 1));
  const er = pts.map(p => N.fbmEroded(p.map(v => v / 10), o, 4, 2));
  ok('eroded fbm: finite, bounded', er.every(v => Number.isFinite(v) && Math.abs(v) < 1.5));
  // curl is tangent to the sphere
  let tan = 0; const v = [0, 0, 0];
  for (let i = 0; i < 500; i++) { const p = N.onSphere(r); N.curl(p, 3, 1, v); tan = Math.max(tan, Math.abs(v[0] * p[0] + v[1] * p[1] + v[2] * p[2]) / (Math.hypot(...v) + 1e-9)); }
  ok('curl: tangent to the sphere', tan < 1e-9, `max |v.p|/|v| ${tan.toExponential(1)}`);
  // texel directions: date line columns meet, poles near +-y
  const W = 64, H = 32, L = N.texelDir(0, 10, W, H), R = N.texelDir(W - 1, 10, W, H), M = N.texelDir(W / 2, 10, W, H);
  ok('texelDir: first and last column are neighbours', Math.hypot(L[0] - R[0], L[1] - R[1], L[2] - R[2]) < Math.hypot(L[0] - M[0], L[1] - M[1], L[2] - M[2]) / 10);
  ok('texelDir: row 0 is near the north pole', N.texelDir(5, 0, W, H)[1] > 0.99);
}

// generators: every preset at 128 x 64, finite values, ranges in [0, 1]
const W = 128, H = 64, made = {};
for (const pr of PR.PRESETS) {
  const P = PR.fromPreset(pr.id), M = MP.generate(P, W);
  made[pr.id] = { P, M };
  let bad = 0;
  for (let i = 0; i < W * H; i++) if (!(M.height[i] >= 0 && M.height[i] <= 1)) bad++;
  ok(`${pr.id}: height in [0, 1], roughness/metallic/specular bytes`, bad === 0 && M.mat.length === W * H * 4 && M.ao.length === W * H);
}
{
  // roughness, metallic, specular in [0, 1] after decoding; metallic stays 0
  let rmin = 1, rmax = 0, metal = 0;
  for (const { M } of Object.values(made)) for (let i = 0; i < W * H; i++) { const r = M.mat[i * 4] / 255; rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); metal = Math.max(metal, M.mat[i * 4 + 1]); }
  ok('materials: roughness in [0, 1], metallic 0', rmin >= 0 && rmax <= 1 && metal === 0, `roughness ${rmin.toFixed(2)}..${rmax.toFixed(2)}`);
}
// seams: the first and last columns are neighbours, so they differ like any
// two neighbouring columns (not like a cut)
for (const id of ['earth', 'moon', 'jupiter', 'neptune']) {
  const { M } = made[id];
  // inner: the mean over all neighbouring column pairs (one pair alone
  // can sit on a crater rim and make the test flaky)
  let seam = 0, inner = 0;
  for (let y = 0; y < H; y++) {
    seam += Math.abs(M.height[y * W] - M.height[y * W + W - 1]);
    for (let x = 0; x < W - 1; x++) inner += Math.abs(M.height[y * W + x] - M.height[y * W + x + 1]) / (W - 1);
  }
  ok(`${id}: no seam at the date line`, seam <= inner * 1.6 + 1e-3, `seam ${(seam / H).toFixed(4)} vs inner ${(inner / H).toFixed(4)}`);
}
// normals: unit length, and they lean down the height gradient
{
  // a strong bump so 128 px texels (300 km) still tilt the normals
  const P = PR.merge(made.earth.P, { bump: 40 }), M = MP.generate(P, W);
  let worst = 0, agree = 0, tested = 0;
  for (let y = 4; y < H - 4; y++) for (let x = 0; x < W; x++) {
    const j = (y * W + x) * 4, nx = M.normal[j] / 127.5 - 1, ny = M.normal[j + 1] / 127.5 - 1, nz = M.normal[j + 2] / 127.5 - 1;
    worst = Math.max(worst, Math.abs(Math.hypot(nx, ny, nz) - 1));
    // the east difference over the row stride, as maps.js normals() takes it
    const sx = Math.max(1, Math.round(1 / Math.sin((y + 0.5) / H * Math.PI)));
    const dx = M.height[y * W + (x + sx) % W] - M.height[y * W + (x + W - sx) % W];
    if (Math.abs(dx) > 0.01 && Math.abs(nx) > 0.02) { tested++; if (Math.sign(nx) === -Math.sign(dx)) agree++; }
  }
  ok('normals: unit length (8-bit)', worst < 0.02, `max | |n| - 1 | ${worst.toFixed(4)}`);
  ok('normals: x leans against the east height slope', tested > 50 && agree / tested > 0.98, `${agree}/${tested}`);
}
// craters: power law N(>r) ~ r^-alpha
{
  const P = PR.fromPreset('moon'), rs = craterList(P).sort((a, b) => b - a);
  const lo = Math.log(P.craters.rMin * 1.5), hi = Math.log(P.craters.rMax * 0.3);
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (let k = 0; k < 12; k++) {
    const r = Math.exp(lo + (hi - lo) * k / 11), c = rs.filter(v => v > r).length;
    const x = Math.log(r), yy = Math.log(c); sx += x; sy += yy; sxx += x * x; sxy += x * yy; n++;
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  ok('craters: cumulative size distribution follows the power law', Math.abs(-slope - P.craters.slope) < 0.25, `fit alpha ${(-slope).toFixed(2)} vs ${P.craters.slope} over ${rs.length} craters`);
  ok('craters: radii inside [rMin, rMax]', rs[0] <= P.craters.rMax && rs[rs.length - 1] >= P.craters.rMin * 0.95);
}
// crater shapes (rocky.js craterProfile): simple bowls d/D = 0.2 below the
// transition, complex craters shallower with a central peak and a flat
// floor, peak rings past 10 Dt, old craters shallower
{
  const { craterProfile } = await import('./rocky.js');
  const Dt = 15, sd = -craterProfile(0, 5, Dt, 0) / 5;
  ok('craters: simple bowl depth/diameter = 0.2, rim 0.04 D', Math.abs(sd - 0.2) < 1e-9 && Math.abs(craterProfile(1, 5, Dt, 0) - 0.2) < 1e-9, `d/D ${sd.toFixed(3)}`);
  const D = 60, floor = craterProfile(0.3, D, Dt, 0), centre = craterProfile(0, D, Dt, 0), cd = -floor / D;
  ok('craters: complex crater is shallower, flat-floored, with a central peak', cd < 0.12 && centre > floor + 0.3 && Math.abs(craterProfile(0.25, D, Dt, 0) - floor) < 0.05 * -floor, `d/D ${cd.toFixed(3)}, peak ${(centre - floor).toFixed(2)} km`);
  const B = 400, ring = craterProfile(0.5 * Math.min(0.7, 0.4 + 0.08 * Math.log(B / Dt + 1)), B, Dt, 0);
  ok('craters: basins past 10 Dt get a peak ring, not a central peak', ring > craterProfile(0, B, Dt, 0) + 0.5, `ring ${ring.toFixed(2)} vs centre ${craterProfile(0, B, Dt, 0).toFixed(2)} km`);
  ok('craters: old craters are shallower and lower-rimmed', craterProfile(0, 5, Dt, 0.9) > craterProfile(0, 5, Dt, 0) * 0.6 && craterProfile(1, 5, Dt, 0.9) < craterProfile(1, 5, Dt, 0));
  // saturation: a texel inside a young crater keeps no relief from older craters
  const R = await import('./rocky.js'), P = PR.fromPreset('moon'), ctx = R.prepareRocky(P);
  const young = ctx.craters.list.filter(c => c.age < 0.3 && c.r > 0.03)[0];
  ok('craters: impact order runs oldest first', ctx.craters.list.every((c, i, a) => !i || a[i - 1].age >= c.age));
  ok('craters: a young crater exists to overprint older ones', !!young);
}

// gas giants: symmetric bands and winds when asked
{
  const P = PR.fromPreset('jupiter'); P.turbulence.amount = 0; P.storms = { spot: 0, spotLat: 0, spotLon: 0, spotSize: 0.1, ovals: 0, ovalLat: 0, small: 0, polar: 0 };
  P.bands.symmetric = 1;
  const ctx = prepareGas(P);
  let worst = 0, wworst = 0;
  for (let i = 0; i <= 90; i++) { const l = i / 90 * 1.5; worst = Math.max(worst, Math.abs(bandProfile(ctx, l) - bandProfile(ctx, -l))); wworst = Math.max(wworst, Math.abs(windProfile(ctx, l) - windProfile(ctx, -l))); }
  ok('gas: band profile mirror-symmetric', worst < 1e-9, `max diff ${worst.toExponential(1)}`);
  ok('gas: wind profile mirror-symmetric', wworst < 1e-9, `max diff ${wworst.toExponential(1)}`);
  ok('gas: edges mirror', ctx.edges.every((e, i) => Math.abs(e + ctx.edges[ctx.edges.length - 1 - i]) < 1e-12));
  const M = MP.generate(P, W);
  let rows = 0;
  for (let y = 0; y < H / 2; y++) for (let x = 0; x < W; x++) rows = Math.max(rows, Math.abs(M.albedo[(y * W + x) * 4] - M.albedo[((H - 1 - y) * W + x) * 4]));
  ok('gas: albedo rows mirror north/south (no turbulence, no storms)', rows <= 1, `max byte diff ${rows}`);
  const P2 = PR.merge(P, { bands: { symmetric: 0 } }), c2 = prepareGas(PR.normalize(P2));
  ok('gas: asymmetric bands when not asked', c2.edges.some((e, i) => Math.abs(e + c2.edges[c2.edges.length - 1 - i]) > 1e-3));
}
// JSON round trip reproduces identical maps
{
  const P = PR.fromPreset('earth', 77), h1 = MP.hashMaps(MP.generate(P, 64));
  const back = PR.fromJSON(PR.toJSON(P, 64)), h2 = MP.hashMaps(MP.generate(back.planet, back.width));
  ok('json: round trip gives the same map hash', h1 === h2, h1 + ' = ' + h2);
  const h3 = MP.hashMaps(MP.generate(PR.fromPreset('earth', 78), 64));
  ok('json: another seed gives another hash', h3 !== h1);
  // workers split rows: stripes give the same maps as one pass
  const ctx = MP.prepare(P), parts = [MP.sampleRows(ctx, 64, 16, 32), MP.sampleRows(MP.prepare(P), 64, 0, 16)];
  const M = MP.finish(MP.assemble(64, parts), P, ctx);
  ok('stripes: split rows hash the same as one pass', MP.hashMaps(M) === h1);
}
// PNG export: every map encodes and decodes to the same pixels
{
  const { M, P } = made.saturn;
  let good = 0, ids = MP.mapIds(P);
  for (const id of ids) {
    const img = MP.mapImage(M, P, id), back = await decodePNGRaw(await encodePNG(img));
    if (back.width === img.width && back.depth === img.depth && back.channels === img.channels && back.data.every((v, i) => v === img.data[i])) good++;
  }
  ok('png: every map round-trips through the encoder', good === ids.length, `${good}/${ids.length} (${ids.join(' ')})`);
  ok('png: rocky worlds have no flow or rings map', !MP.mapIds(made.earth.P).includes('flow') && !MP.mapIds(made.earth.P).includes('rings'));
}
// memory guard
{
  ok('budget: 4k fits a desktop with unknown memory', BG.pickWidth(4096, {}) === 4096);
  ok('budget: a phone gets at most 2k', BG.pickWidth(4096, { mobile: true }) <= 2048 && BG.mapBytes(BG.pickWidth(4096, { mobile: true })) <= BG.cpuBudget({ mobile: true }));
  ok('budget: 4 GB desktop drops to 2k', BG.pickWidth(4096, { deviceMemory: 4 }) === 2048);
  ok('budget: GPU textures stay under 60 MB on a phone', BG.gpuBytes(BG.gpuWidth(4096, { mobile: true })) < 60e6);
  const v = BG.viewBudget(1920, 1080, 2), ph = BG.viewBudget(430, 932, 3, { mobile: true });
  ok('budget: view px capped (desktop DPR 2, phone DPR 3)', v.px <= BG.MAX_PX * 1.01 && ph.px <= BG.PHONE_PX * 1.01 && ph.pr <= 1.5, `${v.w}x${v.h}, ${ph.w}x${ph.h}`);
  // phone profiles: 360x640 and 390x844 portrait, 844x390 landscape at DPR 3
  for (const [w, h] of [[360, 640], [390, 844], [844, 390]]) {
    const b = BG.viewBudget(w, h, 3, { mobile: true });
    ok(`budget: phone ${w}x${h}@3 renders at DPR <= 1.5 and <= 13 MB`, b.pr <= 1.5 && b.bytes <= 13e6, `${b.w}x${b.h} pr ${b.pr}, ${(b.bytes / 1e6).toFixed(1)} MB`);
  }
  const phone = { mobile: true, coarse: true }, pW = BG.pickWidth(BG.defaultWidth(phone), phone);
  ok('budget: phone default is 1k maps, 1k textures, 14 steps', pW === 1024 && BG.gpuWidth(pW, phone) === 1024 && BG.viewSteps(phone) === 14);
  // a tablet (iPad: touch, no deviceMemory in Safari) must not get 4k
  const tab = { coarse: true }, tW = BG.pickWidth(4096, tab), tv = BG.viewBudget(1024, 1366, 2, tab);
  ok('budget: a tablet gets at most 2k maps and 2k textures', tW === 2048 && BG.mapBytes(tW) <= BG.cpuBudget(tab) && BG.gpuWidth(4096, { ...tab, deviceMemory: 8 }) === 2048, `${tW}, ${(BG.mapBytes(tW) / 1e6).toFixed(0)} MB`);
  ok('budget: a 12.9 inch tablet view stays under TABLET_PX, 18 steps', tv.px <= BG.TABLET_PX * 1.01 && BG.viewSteps(tab) === 18, `${tv.w}x${tv.h} pr ${tv.pr}`);
  ok('budget: a desktop with 8 GB still gets 4k textures', BG.gpuWidth(4096, { deviceMemory: 8 }) === 4096 && BG.viewSteps({}) === 24);
}

// atmosphere: units and transmittance
{
  const U = packAtmo(PR.ATMO.earth);
  ok('atmo: Earth Rayleigh packs to 1/km', Math.abs(U[2] - 0.0331) < 1e-6 && U[16] === 6360 && U[17] === 6460);
  const z = transmittanceRef(PR.ATMO.earth, 6360, 1), h = transmittanceRef(PR.ATMO.earth, 6360, 0.02);
  ok('atmo: Earth zenith transmittance is about 0.9 red, 0.75 blue', z[0] > 0.9 && z[0] < 0.97 && z[2] > 0.7 && z[2] < 0.8, z.map(v => v.toFixed(3)).join(' '));
  ok('atmo: the horizon is redder than the zenith (sunset)', h[0] / h[2] > z[0] / z[2] * 3, h.map(v => v.toExponential(1)).join(' '));
  // Rayleigh optical depth tau = beta H against Bucholtz (1995) at the
  // 680, 550, 440 nm channels: 0.042, 0.097, 0.236
  const ER = PR.ATMO.earth, tauR = ER.rayleigh.map(b => b * 1e-3 * ER.rayleighH), real = [0.042, 0.097, 0.236];
  ok('atmo: Earth Rayleigh optical depth within 15 % of Bucholtz 1995', tauR.every((t, i) => Math.abs(t / real[i] - 1) < 0.15), tauR.map(v => v.toFixed(3)).join(' ') + ' vs ' + real.join(' '));
  const Ue = packAtmo(PR.fromPreset('earth').atmo), Uo = packAtmo(PR.fromPreset('ocean').atmo), Um = packAtmo(PR.fromPreset('moon').atmo);
  ok('atmo: Earth-like skies keep 45 % of the ground haze (view), others all', Math.abs(Ue[27] - 0.45) < 1e-6 && Math.abs(Uo[27] - 0.45) < 1e-6 && Um[27] === 1, [Ue[27], Uo[27], Um[27]].map(v => v.toFixed(2)).join(' '));
  const LA = PR.fromPreset('lava').atmo, ssa = LA.mie.map((m, i) => m / (m + LA.mieAbs[i]));
  const zl = transmittanceRef(LA, LA.radiusKm, 1);
  ok('atmo: lava haze is sooty (single-scattering albedo < 0.4, blue absorbed most, glow on)', ssa.every(v => v < 0.4) && zl[2] < zl[0] && zl[2] < z[2] && LA.glow > 0, 'ssa ' + ssa.map(v => v.toFixed(2)).join(' ') + ', T ' + zl.map(v => v.toFixed(2)).join(' '));
  const n = transmittanceRef(PR.ATMO.neptune, 7000, 1);
  ok('atmo: methane absorbs red on Neptune (blue passes)', n[2] > n[0], n.map(v => v.toFixed(3)).join(' '));
  ok('atmo: an off atmosphere packs on = 0', packAtmo(PR.ATMO.none)[23] === 0);
}

// preset families (presets.js fromPreset + vary): each seed is a new
// member, the same seed gives the same member, old ids still load
{
  const keys = P => [P.radiusKm, P.tilt, P.ocean && P.ocean.level, P.terrain && P.terrain.amp, P.craters && P.craters.density, P.volcanoes && P.volcanoes.count,
    ...(P.palette.low || P.palette.stops.flatMap(s => s[1])), P.bands && P.bands.count].filter(v => v != null);
  let varied = 0, same = 0, spread = [];
  for (const pr of PR.PRESETS) {
    const ms = [1, 2, 3, 4, 5, 6].map(s => keys(PR.fromPreset(pr.id, s)));
    const diff = ms.slice(1).filter(m => m.some((v, i) => Math.abs(v - ms[0][i]) > 1e-6)).length;
    if (diff === 5) varied++;
    if (JSON.stringify(PR.fromPreset(pr.id, 9)) === JSON.stringify(PR.fromPreset(pr.id, 9))) same++;
  }
  ok('families: every preset gives a different member for each of 6 seeds', varied === PR.PRESETS.length, `${varied}/${PR.PRESETS.length}`);
  ok('families: the same seed gives the same member', same === PR.PRESETS.length);
  // the rust family spans hues and sizes widely over 40 seeds
  const R = [...Array(40)].map((_, s) => PR.fromPreset('rust', s + 1));
  const hue = R.map(P => P.palette.low[0] / (P.palette.low[1] + P.palette.low[2])), rad = R.map(P => P.radiusKm);
  const span = a => Math.max(...a) / Math.min(...a);
  ok('families: rust worlds vary widely (red/(g+b) span, radius span)', span(hue) > 1.4 && span(rad) > 1.8 && R.some(P => P.terrain.dichotomy === 0) && R.some(P => P.terrain.dichotomy > 0) && R.some(P => P.terrain.terraces > 0),
    `hue span ${span(hue).toFixed(2)}, radius ${Math.min(...rad).toFixed(0)}..${Math.max(...rad).toFixed(0)} km`);
  const V = [...Array(40)].map((_, s) => PR.fromPreset('volcanic', s + 1)), vl = new Set(V.map(P => P.palette.ring.map(v => v.toFixed(1)).join()));
  ok('families: volcanic moons draw several deposit sets (plume ring colours)', vl.size >= 4, `${vl.size} ring colours in 40 seeds`);
  ok('families: no preset is named after a real body (Mars-like, Io-like gone)', !PR.PRESETS.some(p => /Mars|Io-like/.test(p.name)));
  const oldM = PR.fromPreset('mars', 7), oldI = PR.fromPreset('io', 7);
  ok('families: old ids mars and io map to rust and volcanic', oldM.preset === 'rust' && oldI.preset === 'volcanic' && JSON.stringify(oldM) === JSON.stringify(PR.fromPreset('rust', 7)));
  const saved = JSON.parse(PR.toJSON(PR.fromPreset('rust', 3), 512)); saved.planet.preset = 'mars'; saved.planet.name = 'Mars-like';
  const back = PR.fromJSON(JSON.stringify(saved)).planet;
  ok('families: an old saved Mars-like JSON loads as a rust world, recipe kept', back.preset === 'rust' && back.name === 'Rust world' && back.radiusKm === saved.planet.radiusKm);
}

// lava world: the crust is dark, the cracks and rivers glow, and the sky
// is dark and sooty (it absorbs more than it scatters)
{
  const P = PR.fromPreset('lava'), M = MP.generate(P, 256), n = 256 * 128;
  let dark = 0, lit = 0, eSum = 0, land = 0;
  for (let i = 0; i < n; i++) {
    const a = (M.albedo[i * 4] + M.albedo[i * 4 + 1] + M.albedo[i * 4 + 2]) / 3, e = M.emissive[i * 4];
    if (a < 60) dark++;
    if (e > 120) lit++;
    eSum += e;
  }
  ok('lava: most of the surface is dark crust (albedo byte < 60)', dark / n > 0.7, `${(100 * dark / n).toFixed(0)} % dark`);
  ok('lava: bright cracks and rivers (emissive byte > 120) cover 3-40 % (reads at night, not a lit disc)', lit / n > 0.03 && lit / n < 0.4, `${(100 * lit / n).toFixed(1)} % glowing, mean emissive byte ${(eSum / n).toFixed(1)}`);
  const A = P.atmo, ssa = A.mie.map((m, i) => m / (m + A.mieAbs[i])), rayRatio = A.rayleigh[2] / A.mie[2];
  ok('lava: ash sky is dark (ssa < 0.35), brown (red ash scatters most), little blue Rayleigh, lit from below', ssa.every(v => v < 0.35) && A.mie[0] > A.mie[2] && rayRatio < 0.5 && A.glow >= 0.8,
    'ssa ' + ssa.map(v => v.toFixed(2)).join(' ') + `, Rayleigh/Mie blue ${rayRatio.toFixed(2)}, glow ${A.glow.toFixed(2)}`);
  const L = [...Array(12)].map((_, s) => PR.fromPreset('lava', s + 1).atmo);
  ok('lava: every family member keeps a sooty sky', L.every(a => a.mie.every((m, i) => m / (m + a.mieAbs[i]) < 0.35) && a.glow > 0.5));
}

// rust worlds have real relief: basins, shields and canyons (geology.js)
// span many km, and each member draws basins
{
  const R = await import('./rocky.js');
  let basins = 0, withShield = 0, withCanyon = 0; const ranges = [];
  for (let s = 1; s <= 8; s++) {
    const P = PR.fromPreset('rust', s), ctx = R.prepareRocky(P), G = ctx.geo;
    basins += G.basins.length; if (G.shields.length) withShield++; if (G.canyon) withCanyon++;
    let lo = 9, hi = -9;
    for (const S of G.shields) { const h = ctx.heightAt(S.c); hi = Math.max(hi, h); }
    if (G.canyon) for (const sg of G.canyon.segs.slice(0, 40)) lo = Math.min(lo, ctx.heightAt(sg.m));
    for (const B of G.basins) lo = Math.min(lo, ctx.heightAt(B.c));
    ranges.push(((hi > -9 ? hi : 0.5) - lo) * P.relief);
  }
  ok('rust: every member has 1-4 impact basins; shields and rifts appear in the family', basins >= 8 && basins <= 32 && withShield >= 3 && withCanyon >= 2, `${basins} basins in 8 seeds, ${withShield} with shields, ${withCanyon} with a rift`);
  ok('rust: landform relief spans km (shield top to basin or canyon floor >= 6 km in most members)', ranges.filter(r => r >= 6).length >= 6, ranges.map(r => r.toFixed(1)).join(' ') + ' km');
  const E = R.prepareRocky(PR.fromPreset('earth'));
  ok('rust: geology stays off on other presets', !E.geo.on && !R.prepareRocky(PR.fromPreset('moon')).geo.on);
}

// lava rivers and lineae stay continuous: the river channel field
// (maps.js channels) forms long connected channels, also when the map is
// wider than the erosion grid, and the glowing lineae do not break into dots
{
  const { erode } = await import('./erode.js');
  const comps = (on, W, H) => {
    const lab = new Int32Array(W * H).fill(-1), sizes = [], st = [];
    for (let i = 0; i < W * H; i++) if (on(i) && lab[i] < 0) {
      let c = 0; st.push(i); lab[i] = sizes.length;
      while (st.length) {
        const k = st.pop(); c++; const x = k % W, y = (k - x) / W;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy; if (yy < 0 || yy >= H) continue;
          const j = yy * W + ((x + dx + W) % W); if (on(j) && lab[j] < 0) { lab[j] = sizes.length; st.push(j); }
        }
      }
      sizes.push(c);
    }
    return sizes;
  };
  const P = PR.fromPreset('lava'), W = 512, H = 256, ctx = MP.prepare(P);
  const M0 = MP.assemble(W, [MP.sampleRows(ctx, W, 0, H)]);
  const sea = (ctx.seaH - ctx.hMin) / (ctx.hMax - ctx.hMin), km = ctx.kmPerUnit * (ctx.hMax - ctx.hMin);
  const er = erode(M0.height, W, H, { reliefKm: km, radiusKm: P.radiusKm, sea, flow: P.erosion.flow, talus: P.erosion.talus });
  const stat = (on, w, h, minLen) => { const s = comps(on, w, h), tot = s.reduce((a, b) => a + b, 0); return { n: s.length, long: s.filter(v => v >= minLen).reduce((a, b) => a + b, 0) / Math.max(tot, 1), tot }; };
  const ch = MP.channels(er, W, H);
  const a = stat(i => ch[i] > 0.05, W, H, 40), old = stat(i => er.flow[i] > 0.62, W, H, 40);
  ok('lava rivers: the channel field forms long connected channels (>= 90 % of river texels in channels of >= 40 texels)', a.long > 0.9 && a.tot > 200,
    `${a.n} channels, ${(100 * a.long).toFixed(0)} % in long ones (per-texel threshold: ${old.n} pieces, ${(100 * old.long).toFixed(0)} %)`);
  const ch2 = MP.channels(er, 2 * W, 2 * H), b = stat(i => ch2[i] > 0.05, 2 * W, 2 * H, 80);
  ok('lava rivers: a map twice the erosion width keeps the channels joined', b.long > 0.9 && b.n <= a.n * 1.2, `${b.n} channels, ${(100 * b.long).toFixed(0)} % in long ones`);
  // glowing lineae: an ice world with glowing cracks has no other light, so
  // the emissive map is the line field. Joined lines make a few large
  // pieces; lines thinner than a texel fall apart into many specks.
  const Pi = PR.normalize(PR.merge(PR.fromPreset('ice'), { cracks: { glow: 0.6 } })), Mi = MP.generate(Pi, 512);
  const li = comps(i => Mi.emissive[i * 4] > 20, 512, 256), lt = li.reduce((x, y) => x + y, 0);
  ok('lineae: glowing lines stay joined (< 100 pieces, the largest > 80 % of the lit texels; 1910 pieces before)', li.length < 100 && Math.max(...li) / lt > 0.8,
    `${li.length} pieces, largest ${(100 * Math.max(...li) / lt).toFixed(0)} %, lit ${(100 * lt / (512 * 256)).toFixed(1)} %`);
}

// starfield: the shader turns a body-frame ray back to the world frame with
// the rows packView sends (View.bw0..bw2), so a star keeps its world
// direction while the planet spins and tilts
{
  const { packView, bodyFrame } = await import('./render.js');
  const P = PR.fromPreset('earth'), rnd = N.mulberry(5);
  let worst = 0;
  for (let k = 0; k < 200; k++) {
    const spin = rnd() * 40, d = N.onSphere(rnd);
    const U = packView({ pos: [0, 0, 3], target: [0, 0, 0], up: [0, 1, 0], fov: 0.6, w: 100, h: 100, sunDir: [1, 0, 0], spin }, P, 1.01);
    const rb = bodyFrame(d, P.tilt, spin);
    for (let i = 0; i < 3; i++) { const o = 40 + 4 * i; worst = Math.max(worst, Math.abs(U[o] * rb[0] + U[o + 1] * rb[1] + U[o + 2] * rb[2] - d[i])); }
  }
  ok('starfield: world directions survive any spin (body -> world rows)', worst < 1e-5, `max err ${worst.toExponential(1)}`);
  const U = packView({ pos: [0, 0, 3], target: [0, 0, 0], up: [0, 1, 0], fov: 0.6, w: 100, h: 100, sunDir: [2, 0, 0] }, P, 1.01);
  ok('sun: angular radius packs in radians, world sun direction is unit', Math.abs(U[43] - 1.6 * Math.PI / 180) < 1e-6 && Math.abs(Math.hypot(U[52], U[53], U[54]) - 1) < 1e-6);
}

// time rate (clock.js): log slider, labels, and the clock it drives
{
  const CK = await import('./clock.js');
  ok('clock: slider ends are 1 x (real time) and 4 days/s', Math.abs(CK.sliderToRate(0) - 1) < 1e-9 && Math.abs(CK.sliderToRate(1) - 4 * 86400) < 1e-6);
  let rt = 0; for (let x = 0; x <= 1; x += 0.01) rt = Math.max(rt, Math.abs(CK.rateToSlider(CK.sliderToRate(x)) - x));
  ok('clock: slider and rate invert each other', rt < 1e-9, `max err ${rt.toExponential(1)}`);
  ok('clock: labels', CK.rateLabel(1) === '1 s/s' && CK.rateLabel(360) === '6 min/s' && CK.rateLabel(3600) === '1 h/s' && CK.rateLabel(86400) === '1 day/s' && CK.rateLabel(4 * 86400) === '4 days/s',
    [1, 360, 3600, 86400, 345600].map(CK.rateLabel).join(', '));
  const c = CK.createClock({ sunAz: 0 });
  for (let i = 0; i < 100; i++) c.tick(0.01, { rate: 86400, spin: 1, sunOn: true });
  ok('clock: 1 day/s turns the planet once and the sun 12 deg in 1 s', Math.abs(c.simS - 86400) < 1e-6 && Math.min(c.spinAngle, 2 * Math.PI - c.spinAngle) < 1e-6 && Math.abs(c.sunAz - 12) < 1e-9, `simS ${c.simS.toFixed(1)}, sunAz ${c.sunAz.toFixed(3)}`);
  const g = CK.createClock(); g.tick(10, { rate: 3600, spin: 2.4, spinOn: false });
  ok('clock: spin off holds the angle, time still runs', g.spinAngle === 0 && g.hours() === 10);
}

// erosion (erode.js): the cut material stays on the map, heights stay in
// range, channels sit lower than before, and the time at 1k
{
  const { erode } = await import('./erode.js');
  const P = PR.fromPreset('earth'), ctx = MP.prepare(P), W1 = 1024;
  const M = MP.assemble(W1, [MP.sampleRows(ctx, W1, 0, W1 / 2)]);
  const sea = (ctx.seaH - ctx.hMin) / (ctx.hMax - ctx.hMin), km = ctx.kmPerUnit * (ctx.hMax - ctx.hMin);
  const t0 = Date.now(), r = erode(M.height, W1, W1 / 2, { reliefKm: km, radiusKm: P.radiusKm, sea, flow: 1, talus: 0.4 }), ms = Date.now() - t0;
  let lo = 1, hi = 0, rlo = 1, rhi = 0, dch = 0, nch = 0;
  for (let i = 0; i < M.height.length; i++) {
    lo = Math.min(lo, M.height[i]); hi = Math.max(hi, M.height[i]); rlo = Math.min(rlo, r.height[i]); rhi = Math.max(rhi, r.height[i]);
    if (r.flow[i] > 0.7 && M.height[i] > sea) { dch += (r.height[i] - M.height[i]) * km; nch++; }
  }
  ok('erosion: the cut volume is laid back on the map (mass budget)', r.cut > 0 && Math.abs(r.net) < 1e-6 * r.cut, `cut ${r.cut.toExponential(2)} km3, net ${r.net.toExponential(1)} km3`);
  ok('erosion: heights stay inside the input range', rlo >= lo - 1e-6 && rhi <= hi + 1e-6);
  ok('erosion: river channels are cut down', nch > 50 && dch / nch < -0.1, `${nch} channel texels, mean ${(dch / nch * 1000).toFixed(0)} m`);
  ok('erosion: 1k map erodes in under 2 s (one thread)', ms < 2000, `${ms} ms`);
  const er = MP.generate(P, 128);
  let seam = 0, inner = 0;
  for (let y = 0; y < 64; y++) { seam += Math.abs(er.height[y * 128] - er.height[y * 128 + 127]); inner += Math.abs(er.height[y * 128 + 40] - er.height[y * 128 + 41]); }
  ok('erosion: no seam at the date line after the pass', seam <= inner * 1.6 + 1e-3, `seam ${(seam / 64).toFixed(4)} vs inner ${(inner / 64).toFixed(4)}`);
}

// clouds (clouds.js, the CPU twin of clouds.wgsl): the field stays in
// [0, 1], changes over hours but not from one frame to the next, the
// cyclones stay bounded, and the exported map is the field at hour 0
{
  const C = await import('./clouds.js');
  const P = PR.fromPreset('earth'), su = C.cloudSetup(P), pts = N.fibonacci(3000), o = {};
  const field = h => { const cyc = C.cyclones(su, h), d = [], c = []; for (let i = 0; i < 3000; i++) { C.cloudField(su, [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]], h, cyc, o); d.push(o.deck); c.push(o.cirrus); } return { d, c }; };
  const corr = (a, b) => { const n = a.length, ma = a.reduce((x, v) => x + v) / n, mb = b.reduce((x, v) => x + v) / n; let ab = 0, aa = 0, bb = 0; for (let i = 0; i < n; i++) { ab += (a[i] - ma) * (b[i] - mb); aa += (a[i] - ma) ** 2; bb += (b[i] - mb) ** 2; } return ab / Math.sqrt(aa * bb); };
  const f0 = field(0), f1 = field(0.1), f24 = field(24), f240 = field(240);
  const all = [f0, f1, f24, f240].flatMap(f => [...f.d, ...f.c]);
  ok('clouds: deck and cirrus stay in [0, 1] over 10 days', all.every(v => v >= 0 && v <= 1));
  const c1 = corr(f0.d, f1.d), c24 = corr(f0.d, f24.d), cc = corr(f0.c, f24.c);
  ok('clouds: the field evolves (6 min: same; 1 day: changed, not replaced)', c1 > 0.99 && c24 < 0.85 && c24 > 0.2 && cc < 0.9, `corr 6 min ${c1.toFixed(3)}, 1 day ${c24.toFixed(2)}, cirrus 1 day ${cc.toFixed(2)}`);
  const cover = f => f.d.filter(v => v > 0.3).length / f.d.length;
  ok('clouds: cover stays steady while the field moves', Math.abs(cover(f0) - cover(f240)) < 0.1 && cover(f0) > 0.25 && cover(f0) < 0.75, `${cover(f0).toFixed(2)} at 0 h, ${cover(f240).toFixed(2)} at 240 h`);
  let tw = 0, unit = 0, jump = 0;
  for (let h = 0; h < 400; h += 0.5) {
    const a = C.cyclones(su, h), b = C.cyclones(su, h + 0.05);
    for (let k = 0; k < su.nCyc; k++) {
      const j = k * 8; tw = Math.max(tw, Math.abs(a[j + 4])); unit = Math.max(unit, Math.abs(Math.hypot(a[j], a[j + 1], a[j + 2]) - 1));
      if (a[j + 7] > 0.05 && b[j + 7] > 0.05) jump = Math.max(jump, Math.hypot(a[j] - b[j], a[j + 1] - b[j + 1], a[j + 2] - b[j + 2]));
    }
  }
  ok('clouds: cyclones drift smoothly, stay on the sphere, twist stays bounded', tw <= su.swirl * 6 + 0.03 * 168 && unit < 1e-6 && jump < 0.01, `max twist ${tw.toFixed(2)} rad, max 3-min move ${jump.toExponential(1)}`);
  const M = MP.generate(P, 64);
  let worst = 0; const cyc = C.cyclones(su, 0), p = [0, 0, 0];
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) { N.texelDir(x, y, 64, 32, p); C.cloudField(su, p, 0, cyc, o); worst = Math.max(worst, Math.abs(M.cloud[(y * 64 + x) * 4] - Math.round(o.deck * 255))); }
  ok('clouds: the exported cloud map is the field at hour 0', worst <= 1, `max byte diff ${worst}`);
  ok('clouds: airless and cloudless worlds get no cirrus', C.cloudSetup(PR.fromPreset('moon')).cirrus === 0);
  // calibration: cover c gives a visible fraction (deck > 0.1 or cirrus
  // opacity > 0.1) of about c, at hour 0 and two days later
  const vis = [];
  let calOk = true;
  for (const id of ['earth', 'desert', 'ocean', 'ice']) for (const c of [0.06, 0.3, 0.6]) {
    const sv = C.cloudSetup(PR.merge(PR.fromPreset(id, 5), { clouds: { cover: c } }));
    const v0 = C.visibleFraction(sv, 0, 3000), v48 = C.visibleFraction(sv, 48, 3000);
    if (Math.abs(v0 - c) > 0.02 || Math.abs(v48 - c) > 0.1) calOk = false;
    if (id === 'earth' || id === 'desert') vis.push(`${id} ${c}: ${v0.toFixed(3)}/${v48.toFixed(3)}`);
  }
  ok('clouds: cover 0.06/0.3/0.6 is the visible fraction (0 h within 0.02, 48 h within 0.1)', calOk, vis.join(', '));
  const dv = C.visibleFraction(C.cloudSetup(PR.fromPreset('desert')));
  ok('clouds: a desert world at cover 0.06 is about 6 % clouded, cirrus thinned', Math.abs(dv - 0.06) < 0.02 && C.cloudSetup(PR.fromPreset('desert')).cirrus < 0.1, `${(100 * dv).toFixed(1)} %`);
  const ev = [1, 2, 3, 4, 5].map(s => C.visibleFraction(C.cloudSetup(PR.fromPreset('earth', s))));
  ok('clouds: Earth-like members stay 40-65 % clouded (as before the calibration)', ev.every(v => v > 0.4 && v < 0.65), ev.map(v => v.toFixed(2)).join(' '));
}

// ── pool failures (pool.js) ─────────────────────────────────────────────────
// Stub workers run worker.js's work on the main thread. One kind crashes
// (an error event), one never answers. The job must still finish (other
// workers, or the main thread) with the same maps as a plain run, and it
// must not wait forever.
{
  const { createPool } = await import('./pool.js');
  const MP = await import('./maps.js'), PRM = await import('./presets.js');
  const good = () => { const w = { postMessage(m) { setTimeout(() => {
    try { const ctx = MP.prepare(m.planet);
      if (m.cmd === 'rows') w.onmessage({ data: { id: m.id, part: MP.sampleRows(ctx, m.W, m.y0, m.y1) } });
      else { const M = MP.finish(m.M, m.planet, ctx); w.onmessage({ data: { id: m.id, normal: M.normal, ao: M.ao, stats: M.stats, reliefKm: M.reliefKm, height: M.height, albedo: M.albedo, mat: M.mat, emissive: M.emissive } }); }
    } catch (e) { w.onmessage({ data: { id: m.id, error: String(e) } }); } }, 0); }, terminate() {} }; return w; };
  const crash = () => { const w = { postMessage() { setTimeout(() => w.onerror({ message: 'boom' }), 5); }, terminate() {} }; return w; };
  const silent = () => ({ postMessage() {}, terminate() {} });
  const P = PRM.fromPreset('rust'), W = 128, ref = MP.hashMaps(MP.generate(JSON.parse(JSON.stringify(P)), W));
  const warn = console.warn; console.warn = () => {};
  const t0 = Date.now();
  const mixed = await createPool(3, { stallMs: 300, makeWorker: i => (i === 0 ? crash() : i === 1 ? silent() : good()) }).generate(P, W);
  const allDead = await createPool(2, { stallMs: 300, makeWorker: i => (i ? silent() : crash()) }).generate(P, W);
  console.warn = warn;
  ok('pool: a crashed and a silent worker still give the same planet', MP.hashMaps(mixed) === ref && MP.hashMaps(allDead) === ref, `${Date.now() - t0} ms`);
}

// ── saver tour (saver.js) in a DOM-free stub ────────────────────────────────
// The tour runs the clock at 20 min/s, the lapse shot at 6 h/s, the plate
// carries no code, and exit() puts the user's rate and toggles back.
{
  const perf = globalThis.performance; let now = 0;
  Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true, writable: true });
  const rafs = []; globalThis.requestAnimationFrame = f => { rafs.push(f); return rafs.length; }; globalThis.cancelAnimationFrame = () => {};
  globalThis.innerHeight = 800; globalThis.innerWidth = 1280;
  globalThis.document = { documentElement: { classList: { add() {}, remove() {} } } };
  globalThis.window = globalThis;
  const S = { rate: 360, moveSun: true, spin: true, exposure: 0.65, clouds: false, spinAngle: 0 };
  const M = { W: 64, H: 32, height: new Float32Array(64 * 32).map((_, i) => (i * 7919 % 101) / 101) };
  globalThis.__forge = { S, ENV: { mobile: false }, pool: { generate: async () => M }, adopt() {}, clearArea: () => ({ x0: 0, x1: 900, y0: 0, y1: 700 }), canvas: {} };
  await import('./saver.js');
  const plates = [], rates = {};
  globalThis.snSaver.enter({ seed: 7, calm: 0.7, label: p => p && plates.push(p) });
  for (let k = 0; k < 4000 && Object.keys(rates).length < 4; k++) {
    await new Promise(r => setTimeout(r, 0)); now += 100;
    const f = rafs.pop(); rafs.length = 0; if (f) f();
    const d = globalThis.snSaver.debug(); if (d && d.shot) rates[d.shot] = S.rate;
  }
  globalThis.snSaver.exit();
  Object.defineProperty(globalThis, 'performance', { value: perf, configurable: true, writable: true });
  ok('saver: lapse shot at 6 h/s, other shots at 20 min/s', rates.lapse === 21600 && Object.entries(rates).every(([k, r]) => k === 'lapse' || r === 1200), JSON.stringify(rates));
  ok('saver: plates name the family and the rate, carry no code', plates.length > 0 && plates.every(p => !('code' in p) && / family · .* · \d/.test(p.sub)), `${plates.length} plates`);
  ok('saver: exit restores the rate and the toggles', S.rate === 360 && S.clouds === false && S.moveSun === true);
}

// render speed: cloud row slices and the reused view uniform
{
  const RD = await import('./render.js');
  const ks = [0.00167, 0.0167, 0.1, 1.6, 0].map(RD.cloudSlices);
  // 6 min/s, 1 h/s, 6 h/s, 4 days/s at 60 fps, and a held hour
  ok('render: cloud slices 8 at 6 min/s, 1 at 6 h/s and faster, 8 when held', ks[0] === 8 && ks[2] === 1 && ks[3] === 1 && ks[4] === 8 && ks[1] >= 1 && ks[1] <= 8, ks.join(' '));
  let gap = 0;
  for (let dh = 1e-4; dh < 2; dh *= 1.3) { const k = RD.cloudSlices(dh); if (k > 1) gap = Math.max(gap, (k - 1) * dh); }
  ok('render: rows of one cloud map differ by at most SLICE_DH hours', gap <= RD.SLICE_DH + 1e-12, `max ${gap.toFixed(4)} h`);
  const out = new Float32Array(RD.VIEW_FLOATS), cam = { pos: [0, 0, 3], fov: 1, w: 4, h: 3, sunDir: [1, 0, 0] };
  const a = RD.packView(cam, null, 1.006, undefined, out), b = RD.packView(cam, null, 1.006);
  ok('render: packView fills the given array (no new typed array per frame)', a === out && a.every((v, i) => v === b[i]));
}

// dynamic resolution: the scale falls under load, holds a floor, and
// comes back when the frames are fast again
{
  // a toy GPU: frame time = base ms x (scale^2) (cost ~ pixels), 60 Hz floor
  const run = (base, frames, rs) => { let t = 0; for (let i = 0; i < frames; i++) { const ms = Math.max(1000 / 60, base * rs.scale * rs.scale); rs.update(ms); t += ms; } return rs.scale; };
  const a = BG.createResScale();
  ok('resolution: a 60 fps machine keeps scale 1', run(12, 600, a) === 1);
  const b = BG.createResScale(), s1 = run(30, 600, b);
  ok('resolution: a 30 ms frame converges to a scale that holds 60 fps', s1 < 1 && s1 >= BG.RES_FLOOR && 30 * s1 * s1 <= 22, `scale ${s1}, ${(30 * s1 * s1).toFixed(1)} ms`);
  const s1b = run(30, 1200, b);
  ok('resolution: then it stays put (no oscillation)', s1b === s1 || Math.abs(s1b - s1) <= 0.12, `${s1} -> ${s1b}`);
  const c = BG.createResScale(), s2 = run(200, 600, c);
  ok('resolution: a very slow GPU stops at the floor', s2 === BG.RES_FLOOR, `scale ${s2}`);
  ok('resolution: fast frames bring the scale back to 1', run(8, 3000, c) === 1);
  // a GPU at the vsync edge: 15 ms at scale 1 misses vsync (33 ms), fits below
  // (each drop is a visible bounce: a short run of 30 fps frames)
  const e = BG.createResScale(); let drops = 0, prev = 1;
  for (let i = 0; i < 60 * 120; i++) { const g = 15.5 * e.scale * e.scale, ms = g > 15 ? 33.3 : 16.7; const s = e.update(ms); if (s < prev) drops++; prev = s; }
  ok('resolution: a GPU at the vsync edge settles (at most 3 drops in 2 min)', drops <= 3, `${drops} drops, scale ${e.scale}`);
  const d = BG.createResScale(); d.update(5000); d.update(5000);
  ok('resolution: long gaps (hidden tab) do not count', d.scale === 1);
}

// craters in HD: no stamped copies. Two craters of the same size have
// different profiles, rim roundness varies, some rims are polygons, some
// impacts are oblique, big craters have secondary chains.
{
  const R = await import('./rocky.js'), P = PR.fromPreset('moon', 7), ctx = R.prepareRocky(P);
  const L = ctx.craters.list, prim = L.filter(c => !c.sec && c.r > 0.02).sort((a, b) => a.r - b.r);
  let pair = null;
  for (let i = 1; i < prim.length && !pair; i++) if (prim[i].r / prim[i - 1].r < 1.02 && Math.abs(prim[i].age - prim[i - 1].age) < 0.3) pair = [prim[i - 1], prim[i]];
  // profile along 8 directions at x = 0.1..1.4 of the radius, in units of the depth
  const prof = cr => { const out = []; for (let a = 0; a < 8; a++) for (let k = 1; k <= 14; k++) {
    const th = a * Math.PI / 4, d = 0.1 * k * cr.r, dir = cr.e.map((e, j) => e * Math.cos(th) + cr.n[j] * Math.sin(th));
    const q = cr.c.map((c, j) => c * Math.cos(d) + dir[j] * Math.sin(d)); out.push(R.craterProbe(ctx, cr, q)); } return out; };
  let rel = 0;
  if (pair) { const a = prof(pair[0]), b = prof(pair[1]), dep = Math.max(...a.map(Math.abs)); rel = Math.max(...a.map((v, i) => Math.abs(v - b[i]))) / dep; }
  ok('craters: two craters of the same size do not share a profile', !!pair && rel > 0.1, pair ? `r ${pair[0].r.toFixed(4)} / ${pair[1].r.toFixed(4)}, max diff ${(100 * rel).toFixed(0)} % of the depth` : 'no pair');
  // roundness: (max - min) / mean of the rim radius over the angle
  const round = L.filter(c => !c.sec).slice(0, 2000).map(cr => { let lo = 9, hi = 0, m = 0; for (let k = 0; k < 72; k++) { const f = R.rimFactor(cr, k * Math.PI / 36); lo = Math.min(lo, f); hi = Math.max(hi, f); m += f / 72; } return (hi - lo) / m; }).sort((a, b) => a - b);
  const q10 = round[Math.floor(round.length * 0.1)], q90 = round[Math.floor(round.length * 0.9)];
  ok('craters: rim roundness varies (10th to 90th percentile spread)', q10 < 0.08 && q90 > 2 * q10 && round.every(v => v < 0.6), `${q10.toFixed(3)} .. ${q90.toFixed(3)}`);
  const polys = L.filter(c => !c.sec && c.poly > 0).length / L.filter(c => !c.sec).length, obl = L.filter(c => !c.sec && c.obl).length / L.filter(c => !c.sec).length;
  ok('craters: about a third have polygonal rims, a few are oblique', polys > 0.25 && polys < 0.45 && obl > 0.04 && obl < 0.13, `${(100 * polys).toFixed(0)} % polygons, ${(100 * obl).toFixed(1)} % oblique`);
  const sec = L.filter(c => c.sec), parents = L.filter(c => !c.sec && c.r >= 0.07).length;
  ok('craters: big craters throw chains of secondaries', parents > 0 && sec.length >= 4 * parents, `${sec.length} secondaries round ${parents} parents`);
  // micro craters: a 4k map has relief below rMin that a 2k map does not
  const rr = N.mulberry(5), pts = []; for (let i = 0; i < 3000; i++) pts.push(N.onSphere(rr));
  const share = W => pts.filter(q => Math.abs(R.microProbe(ctx, q, W)) > 1e-4).length / pts.length;
  const s2 = share(2048), s4 = share(4096);
  ok('craters: a 4k map adds small craters below rMin that 2k does not', s2 < 0.05 && s4 > 0.15 && s4 > 4 * s2, `share of points in a small crater: 2k ${(100 * s2).toFixed(0)} %, 4k ${(100 * s4).toFixed(0)} %`);
}

// seamless poles and date line, in every map
{
  const W = 256, H = 128;
  // object-space normal of texel i (mapImage normalObj decodes the frame)
  const objN = (M, P) => { const im = MP.mapImage(M, P, 'normalObj'); return i => [im.data[i * 3] / 127.5 - 1, im.data[i * 3 + 1] / 127.5 - 1, im.data[i * 3 + 2] / 127.5 - 1]; };
  const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b)))));
  const chans = (M, P) => {
    const n = objN(M, P);
    return {
      height: i => [M.height[i]], albedo: i => [M.albedo[i * 4], M.albedo[i * 4 + 1], M.albedo[i * 4 + 2]].map(v => v / 255),
      mat: i => [M.mat[i * 4], M.mat[i * 4 + 2]].map(v => v / 255), emissive: i => [M.emissive[i * 4], M.emissive[i * 4 + 1]].map(v => v / 255),
      cloud: i => [M.cloud[i * 4] / 255], ao: i => [M.ao[i] / 255], normal: n,
    };
  };
  const d = (a, b) => a.reduce((s, v, k) => Math.max(s, Math.abs(v - b[k])), 0);
  const bad = { pole: [], seam: [] };
  for (const id of ['earth', 'rust', 'moon', 'ice', 'lava', 'desert', 'titan', 'jupiter', 'neptune']) {
    // raw: the sampled rows before finish (erosion, rivers, normals, AO).
    // The sampler reads the 3D field, so its rows meet at the pole by
    // construction; finish must not add a mismatch there.
    const P = PR.fromPreset(id, 7), ctx = MP.prepare(P), raw = MP.assemble(W, [MP.sampleRows(ctx, W, 0, H)]);
    const R0 = { height: raw.height.slice(), albedo: raw.albedo.slice(), mat: raw.mat.slice(), emissive: raw.emissive.slice(), cloud: raw.cloud.slice() };
    const M = MP.finish(raw, P, ctx), C = chans(M, P), CR = chans({ ...M, ...R0 }, P);
    const across = f => { let a = 0, n = 0; for (const y of [0, H - 1]) for (let x = 0; x < W / 2; x++) { a += d(f(y * W + x), f(y * W + x + W / 2)); n++; } return a / n; };
    for (const [k, f] of Object.entries(C)) {
      // across the pole: texel x and texel x + W/2 of the first (last) row
      // are one texel apart; the reference is the step from that row to
      // the next one at the same x (the same distance, the same terrain)
      let pole = 0, pref = 0, np = 0;
      for (const [y, y2] of [[0, 1], [H - 1, H - 2]]) for (let x = 0; x < W / 2; x++) {
        pole += d(f(y * W + x), f(y * W + x + W / 2)); pref += (d(f(y * W + x), f(y2 * W + x)) + d(f(y * W + x + W / 2), f(y2 * W + x + W / 2))) / 2; np++;
      }
      pole /= np; pref = pref / np + 2e-3;
      // the date line: the first and the last column, against neighbouring
      // columns of the same rows
      let seam = 0, sref = 0;
      for (let y = 0; y < H; y++) { seam += d(f(y * W), f(y * W + W - 1)); sref += (d(f(y * W), f(y * W + 1)) + d(f(y * W + W - 2), f(y * W + W - 1))) / 2; }
      seam /= H; sref = sref / H + 2e-3;
      // channels with a raw value: no worse than the raw rows (plus 1 %);
      // normals and AO (made in finish): within 2.5 x the next-row step
      const lim = k in R0 ? across(CR[k]) * 1.25 + 0.01 : 2.5 * pref;
      if (pole > lim) bad.pole.push(`${id}.${k} ${pole.toFixed(3)} > ${lim.toFixed(3)}`);
      if (seam > 2.5 * sref) bad.seam.push(`${id}.${k} ${(seam / sref).toFixed(1)}x`);
    }
  }
  ok('poles: in every map the first and last rows match across the pole', !bad.pole.length, bad.pole.join(', ') || 'finish adds no mismatch; normals and AO within 2.5 x the next-row step');
  ok('seams: in every map the first and last columns match', !bad.seam.length, bad.seam.join(', ') || 'all within 2.5 x the next-column step');
  // normals near the poles: the object-space angle between neighbours in
  // the 4 rows round each pole is no larger than at mid latitudes
  const P = PR.fromPreset('ice', 7), M = MP.generate(P, W), n = objN(M, P);
  const step = rows => { const a = []; for (const y of rows) for (let x = 0; x < W; x++) { const i = y * W + x; a.push(ang(n(i), n(y * W + (x + 1) % W))); if (y + 1 < H) a.push(ang(n(i), n(i + W))); } a.sort((p, q) => p - q); return a[Math.floor(a.length * 0.99)]; };
  const mid = step([H / 2 - 8, H / 2, H / 2 + 8]), cap = step([0, 1, 2, 3, H - 4, H - 3, H - 2, H - 1]);
  ok('poles: normals near the poles are continuous (99th pct step)', cap <= 1.5 * mid + 0.02, `pole ${(cap * 180 / Math.PI).toFixed(1)} deg vs mid ${(mid * 180 / Math.PI).toFixed(1)} deg`);
}
// a crater near a pole stays round on the sphere: one crater alone, at
// 84 deg and at the equator, measured in its tangent plane on the map
{
  const R = await import('./rocky.js');
  const base = PR.merge(PR.fromPreset('moon', 7), { terrain: { amp: 0 }, mountains: { amp: 0 }, plates: { count: 0 }, craters: { maria: 0 } });
  const shape = lat => {
    const P = JSON.parse(JSON.stringify(base)), ctx = R.prepareRocky(P), la = lat * Math.PI / 180;
    const c = [Math.cos(la), Math.sin(la), 0], rnd = N.mulberry(3);
    const cr = R.makeCrater(c, 0.08, 0.2, rnd, P.craters, 0);
    cr.hc.fill(0); cr.hs.fill(0); cr.poly = 0; cr.ell = 1; cr.obl = 0; cr.asym = 0; cr.ord = 0; cr.fresh = false;
    ctx.craters = { list: [cr], grids: [], big: [cr] };
    const W = 512, H = 256, M = MP.assemble(W, [MP.sampleRows(ctx, W, 0, H)]);
    // texels in the bowl (below the floor + 30 % of the depth), as tangent coordinates
    let lo = Infinity; for (const v of M.height) lo = Math.min(lo, v);
    let hi = 0; for (const v of M.height) hi = Math.max(hi, v);
    const thr = lo + 0.3 * (hi - lo), p = [0, 0, 0];
    let sxx = 0, syy = 0, sxy = 0, sw = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (M.height[y * W + x] > thr) continue;
      N.texelDir(x, y, W, H, p);
      const u = p[0] * cr.e[0] + p[1] * cr.e[1] + p[2] * cr.e[2], v = p[0] * cr.n[0] + p[1] * cr.n[1] + p[2] * cr.n[2];
      const w = Math.sin((y + 0.5) / H * Math.PI);   // texel area
      sxx += w * u * u; syy += w * v * v; sxy += w * u * v; sw += w;
    }
    const a = sxx / sw, b = syy / sw, c2 = sxy / sw, tr = a + b, det = a * b - c2 * c2, l1 = tr / 2 + Math.sqrt(tr * tr / 4 - det), l2 = tr / 2 - Math.sqrt(tr * tr / 4 - det);
    return Math.sqrt(l1 / l2);
  };
  const ePole = shape(84), eEq = shape(0);
  ok('poles: a crater at 84 deg stays round on the sphere (axis ratio)', ePole < 1.08 && Math.abs(ePole - eEq) < 0.05, `84 deg ${ePole.toFixed(3)}, equator ${eEq.toFixed(3)}`);
}

// generation time at 512 (the quick preview), one thread, every preset.
// The page splits the rows over up to 8 workers, so a preview takes
// about 1/4 of this. The budget has a wide margin: other processes on a
// shared machine slow the run.
{
  const BUDGET = 6000, times = [];
  for (const pr of PR.PRESETS) {
    const t0 = performance.now(); MP.generate(PR.fromPreset(pr.id, 7), 512); times.push([pr.id, performance.now() - t0]);
  }
  const worst = times.reduce((a, b) => (b[1] > a[1] ? b : a));
  ok(`speed: every preset generates 512 in under ${BUDGET} ms on one thread`, worst[1] < BUDGET, times.map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', '));
}

// The studio and randomizer checks live in tests-studio.mjs; run them too.
{
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [new URL('./tests-studio.mjs', import.meta.url).pathname], { encoding: 'utf8' });
  ok('tests-studio.mjs passes', r.status === 0, (r.stdout + r.stderr).trim().split('\n').slice(-2).join(' | '));
}

console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
process.exit(fails ? 1 : 0);
