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
  let seam = 0, inner = 0;
  for (let y = 0; y < H; y++) { seam += Math.abs(M.height[y * W] - M.height[y * W + W - 1]); inner += Math.abs(M.height[y * W + 40] - M.height[y * W + 41]); }
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
    const dx = M.height[y * W + (x + 1) % W] - M.height[y * W + (x + W - 1) % W];
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
      else { const M = MP.finish(m.M, m.planet, ctx); w.onmessage({ data: { id: m.id, normal: M.normal, ao: M.ao, stats: M.stats, reliefKm: M.reliefKm } }); }
    } catch (e) { w.onmessage({ data: { id: m.id, error: String(e) } }); } }, 0); }, terminate() {} }; return w; };
  const crash = () => { const w = { postMessage() { setTimeout(() => w.onerror({ message: 'boom' }), 5); }, terminate() {} }; return w; };
  const silent = () => ({ postMessage() {}, terminate() {} });
  const P = PRM.fromPreset('mars'), W = 128, ref = MP.hashMaps(MP.generate(JSON.parse(JSON.stringify(P)), W));
  const warn = console.warn; console.warn = () => {};
  const t0 = Date.now();
  const mixed = await createPool(3, { stallMs: 300, makeWorker: i => (i === 0 ? crash() : i === 1 ? silent() : good()) }).generate(P, W);
  const allDead = await createPool(2, { stallMs: 300, makeWorker: i => (i ? silent() : crash()) }).generate(P, W);
  console.warn = warn;
  ok('pool: a crashed and a silent worker still give the same planet', MP.hashMaps(mixed) === ref && MP.hashMaps(allDead) === ref, `${Date.now() - t0} ms`);
}

console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
process.exit(fails ? 1 : 0);
