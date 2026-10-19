// ============================================================================
//  CORAL REEF  ·  SCENE tests (node, no browser):  node tests/scene.test.mjs
// ----------------------------------------------------------------------------
//  tests.mjs in the page folder runs this file with the other packages'
//  tests/*.test.mjs files.
//    caustics ..... water.js: the caustic pattern has no strong periodic
//                   peak (autocorrelation by FFT, power spectrum), a mean
//                   near 1, patches of contrast that differ, and it moves.
//                   The old 6-wave tile pattern fails the same test, so
//                   the test can see a regular net.
//    glsl ......... every program of shaders.js passes naga (as GLSL 450)
//                   and glslangValidator as GLSL ES 3.00 with the prefix
//                   that three.js r160 adds (the browser form)
//    boot ......... mobile-check.mjs: main.js boots in jsdom at five phone
//                   sizes and a desktop (dock, sheet, feed card, controls);
//                   it needs jsdom (JSDOM_DIR or NODE_PATH), else it skips
//    fade ......... water.js fadeAt and the GLSL fadeAt: 1 in the plot, 0
//                   at 1.3 R, smooth, no step
//    squad saver .. saver.js squadPlan and squadShotPose: seeded, calm, few
//                   wide shots; the subject in the clear band (16:9, 9:16)
//  Retired (2026-10-18, CONTRACT-V4.md: "we shouldn't grow corals, they
//  should just grow once"): the dive plan of one growing colony, the
//  growth meter and the single-colony saver reef. The squad saver tests
//  come with the v4 page.
// ============================================================================
import * as SH from '../shaders.js';
import { BEAM_SNOW_VS } from '../beam-snow.js';
import { squadPlan, squadShotPose, frameFit, projectSphere } from '../saver.js';
import { checkPrograms } from '../glsl-check.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { waveSpectrum, causticField, causticPattern, autocorrPeak, fadeAt, FADE_K, surfaceAt, N_WAVES, causticMips, causticView, warpAt } from '../water.js';

let pass = 0, fail = 0;
export function ok(cond, name, info = '') {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name}${info !== '' ? ' ' + info : ''}`); }
}
const f3 = v => (+v).toFixed(3);

// Sample a pattern function on n x n points over a square of side size.
function sampleImg(fn, n, size, cx = 0, cz = 0) {
  const img = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) img[y * n + x] = fn(cx - size / 2 + (x + 0.5) / n * size, cz - size / 2 + (y + 0.5) / n * size);
  return img;
}
const stats = a => { let m = 0; for (const v of a) m += v; m /= a.length; let s = 0; for (const v of a) s += (v - m) ** 2; return { mean: m, std: Math.sqrt(s / a.length) }; };

// ── caustics ────────────────────────────────────────────────────────────────
{
  const n = 256, size = 64, t0 = Date.now();
  for (const seed of [1, 7, 42]) {
    const W = waveSpectrum(seed);
    const F = causticField({ waves: W, t: 3, x0: -36, z0: -36, size: 72, res: 288, sub: 3 });
    const img = sampleImg((x, z) => causticPattern(F, x, z, 3), n, size);
    const a = autocorrPeak(img, n), s = stats(img);
    console.log(`caustics seed ${seed}: mean ${f3(s.mean)} std ${f3(s.std)}, autocorr peak past the lobe ${f3(a.peak)} at ${a.lag.toFixed(1)} px (lobe ${a.corrLen} px), top spectrum bin ${(a.specPeak * 100).toFixed(2)}% of the power`);
    ok(W.length === N_WAVES && new Set(W.map(w => Math.hypot(w[0], w[1]).toFixed(4))).size === N_WAVES, `caustics seed ${seed}: ${N_WAVES} waves, all of other lengths`);
    ok(a.peak < 0.3, `caustics seed ${seed}: no strong periodic peak in the autocorrelation`, f3(a.peak));
    ok(a.specPeak < 0.01, `caustics seed ${seed}: no frequency bin holds 1% of the power`, f3(a.specPeak));
    ok(Math.abs(s.mean - 1) < 0.15 && s.std > 0.12, `caustics seed ${seed}: mean light near 1 and a visible pattern`, `${f3(s.mean)} ${f3(s.std)}`);
    // patches: the contrast in 8 m blocks differs much (the net breaks up)
    const B = 32, cs = [];
    for (let by = 0; by < n; by += B) for (let bx = 0; bx < n; bx += B) {
      const blk = []; for (let y = by; y < by + B; y++) for (let x = bx; x < bx + B; x++) blk.push(img[y * n + x]);
      cs.push(stats(blk).std);
    }
    cs.sort((p, q) => p - q);
    ok(cs[cs.length - 4] > 2.5 * cs[3], `caustics seed ${seed}: patches of strong and weak caustics (8 m block contrast spread)`, `${f3(cs[3])}..${f3(cs[cs.length - 4])}`);
  }
  // the pattern moves, and changes over seconds but not frame to frame
  {
    const W = waveSpectrum(5), box = { x0: -20, z0: -20, size: 40, res: 160, sub: 3 };
    const at = t => { const F = causticField({ waves: W, t, ...box }); return sampleImg((x, z) => causticPattern(F, x, z, t), 64, 32); };
    const a = at(2), b = at(2.05), c = at(6);
    const corr = (p, q) => { const sp = stats(p), sq = stats(q); let s = 0; for (let i = 0; i < p.length; i++) s += (p[i] - sp.mean) * (q[i] - sq.mean); return s / p.length / sp.std / sq.std; };
    const c1 = corr(a, b), c4 = corr(a, c);
    console.log(`caustics motion: correlation over 0.05 s ${f3(c1)}, over 4 s ${f3(c4)}`);
    ok(c1 > 0.6 && c4 < 0.35, 'caustics: smooth from frame to frame, a new pattern after seconds', `${f3(c1)} ${f3(c4)}`);
  }
  // the detector: the old pattern (6 waves on a 48 m tile) has a strong peak
  {
    const L = 48, A = 0.13, k = 2 * Math.PI / L;
    const old = [[3, 1, A, 0.3], [-1, 3, A * 0.9, 1.7], [2, -3, A * 0.7, 4.1], [4, 2, A * 0.45, 2.2], [-3, -2, A * 0.5, 5.3], [1, 5, A * 0.3, 0.9]].map(w => [w[0] * k, w[1] * k, w[2], w[3]]);
    const F = causticField({ waves: old, t: 3, x0: -60, z0: -60, size: 120, res: 240, sub: 2, D: 110 });
    const img = sampleImg((x, z) => {
      const u = Math.min(239, Math.max(0, Math.round((x + 60) / 120 * 240 - 0.5))), v = Math.min(239, Math.max(0, Math.round((z + 60) / 120 * 240 - 0.5)));
      return Math.min(3.2, Math.log2(1 + F.E[v * 240 + u]));
    }, 128, 96);
    const a = autocorrPeak(img, 128);
    console.log(`caustics detector: the old 48 m tile pattern has a peak ${f3(a.peak)} at ${a.lag.toFixed(1)} px (${(a.lag / 128 * 96).toFixed(1)} m)`);
    ok(a.peak > 0.4, 'caustics: the test sees the period of the old tiled pattern', f3(a.peak));
  }
  // the surface: slopes stay gentle (no breaking sea)
  {
    const W = waveSpectrum(9); let mx = 0;
    for (let i = 0; i < 400; i++) { const s = surfaceAt(W, i * 0.37, i * 0.91, i * 0.1); mx = Math.max(mx, Math.hypot(s[1], s[2])); }
    ok(mx < 0.6, 'caustics: the wave slope stays under 0.6', f3(mx));
  }
  // The user said (2026-10-18): "the caustics in the water seem to be
  // glitching at a distance". The map is a 96 m square round the eye: past
  // its edge the old look-up clamped to the edge texels (streaks), it had
  // no mips (far texels alias), and the noise used render coordinates (an
  // origin shift moved the pattern). causticView is the CPU copy of the new
  // shaders.js causticAtF: a floor ray out to the fog distance.
  {
    const W = waveSpectrum(5), size = 96, eye = [3000.3, 46, -2047.6], floorY = 43, t = 7;
    const O1 = [2048, -2048], O2 = [3072, -2048];
    const cen = O => [Math.round((eye[0] - O[0]) / 4) * 4, Math.round((eye[2] - O[1]) / 4) * 4];
    const C1 = cen(O1), wc = [C1[0] + O1[0], C1[1] + O1[1]];
    const F = causticMips(causticField({ waves: W, t, x0: wc[0] - size / 2, z0: wc[1] - size / 2, size, res: 1024, sub: 1 }));
    const pix = 2 * Math.tan(25 * Math.PI / 180) / 1080, dir = [0.6, 0.8], h = eye[1] - floorY;
    const at = (r, O, lod = true) => {
      const d = Math.hypot(r, h), fp = d * pix / Math.max(h / d, 0.15);
      return causticView(F, { origin: O, centre: cen(O), x: eye[0] + dir[0] * r - O[0], z: eye[2] + dir[1] * r - O[1], fp, t, depth: 55 - floorY }, lod);
    };
    // continuity along the ray, fine steps (0.02 m) to 150 m
    let jump = 0, jumpAt = 0, past = 0, prev = at(1, O1);
    for (let r = 1.02; r < 150; r += 0.02) { const v = at(r, O1); if (Math.abs(v - prev) > jump) { jump = Math.abs(v - prev); jumpAt = r; } if (r > 62) past = Math.max(past, Math.abs(v - 1)); prev = v; }
    console.log(`caustics far: largest step ${f3(jump)} at ${jumpAt.toFixed(1)} m on a 0.02 m ray step; past the map |factor - 1| <= ${past}`);
    ok(jump < 0.2 && past === 0, 'caustics far: the factor along a ray to the fog is continuous, no box edge (exactly 1 past the map)', `${f3(jump)} ${past}`);
    // high-frequency energy: the step from one screen pixel to the next,
    // and the alias error: a pixel against the mean of 16 old look-ups
    // over its footprint (the true filtered value)
    const hf = (lod) => {
      const B = [2, 10, 25, 40, 60], E = B.slice(1).map(() => [0, 0, 0]);
      let r = 2, pv = at(r, O1, lod);
      while (r < 60) {
        const d = Math.hypot(r, h), fp = d * pix / Math.max(h / d, 0.15);
        r += fp; const v = at(r, O1, lod), b = r < 10 ? 0 : r < 25 ? 1 : r < 40 ? 2 : 3;
        let ref = 0; if (b === 2) { for (let j = 0; j < 16; j++) ref += at(r + ((j + 0.5) / 16 - 0.5) * fp, O1, false); ref /= 16; }
        E[b][0] += (v - pv) ** 2; E[b][1]++; E[b][2] += (v - ref) ** 2; pv = v;
      }
      return { hf: E.map(([e, n]) => e / Math.max(1, n)), alias: E[2][2] / E[2][1] };
    };
    const nw = hf(true), od = hf(false);
    console.log(`caustics far: pixel-to-pixel energy at 2-10, 10-25, 25-40, 40-60 m: new ${nw.hf.map(f3).join(' ')}, old look-up ${od.hf.map(f3).join(' ')}; alias error 25-40 m new ${nw.alias.toExponential(2)} old ${od.alias.toExponential(2)}`);
    ok(nw.hf[3] < nw.hf[2] * 0.5 && nw.hf[3] < od.hf[3] * 0.2, 'caustics far: the high-frequency energy falls off at a distance, the old look-up keeps it', `${nw.hf.map(f3)} vs ${od.hf.map(f3)}`);
    // inside the square the footprint stays under about 3 texels (desktop),
    // so the mips change little there: the error stays small (rms < 3%)
    ok(nw.alias < 1e-3, 'caustics far: the pixel value stays near the filtered value (rms alias error under 3%)', `${nw.alias} (old ${od.alias})`);
    // the same world points under two floating origins
    let dmax = 0, oldD = 0;
    for (let i = 0; i < 300; i++) {
      const r = 1 + (i * 0.61803) % 1 * 28, v1 = at(r, O1), v2 = at(r, O2);
      dmax = Math.max(dmax, Math.abs(v1 - v2));
      const x1 = eye[0] + dir[0] * r - O1[0], x2 = eye[0] + dir[0] * r - O2[0], z = eye[2] + dir[1] * r - O1[1];
      oldD = Math.max(oldD, Math.abs(warpAt(x1, z, t)[0] - warpAt(x2, z, t)[0]));
    }
    console.log(`caustics far: across a 1024 m origin shift the factor moves ${dmax.toExponential(1)} (the old render-space warp moved ${f3(oldD)} m)`);
    ok(dmax < 2e-3 && oldD > 0.1, 'caustics far: the pattern is stable across an origin shift', `${dmax} ${oldD}`);
  }
  console.log(`caustics: ${Date.now() - t0} ms`);
}

// ── plot fade ───────────────────────────────────────────────────────────────
{
  for (const R of [20, 30, 45]) {
    ok(fadeAt(0, R) === 1 && fadeAt(R, R) === 1 && fadeAt(FADE_K * R, R) === 0 && fadeAt(2 * R, R) === 0, `fade R ${R}: 1 in the plot, 0 past ${FADE_K} R`);
    let mono = true, jump = 0;
    for (let i = 0; i < 400; i++) { const r = R * (0.9 + i * 0.002), a = fadeAt(r, R), b = fadeAt(r + R * 0.002, R); if (b > a) mono = false; jump = Math.max(jump, a - b); }
    ok(mono && jump < 0.02, `fade R ${R}: falls smoothly, no step (largest step ${f3(jump)} per 0.2% of R)`);
    ok(fadeAt(R * 1.005, R) > 0.998 && fadeAt(R * 1.295, R) < 0.002, `fade R ${R}: no edge at R or at ${FADE_K} R (the slope is 0 at both ends)`);
  }
}

// ── the squad saver (v4) ─────────────────────────────────────────────────────
{
  const a = squadPlan(42, 40), b = squadPlan(42, 40), c = squadPlan(43, 40);
  ok(JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(c), 'squad saver: one seed gives one plan, another seed another');
  const wide = a.filter(s => s.kind === 'wide').length, twice = a.filter((s, i) => i && s.kind === a[i - 1].kind).length;
  ok(twice === 0 && a.every(s => s.hold >= 8 && s.hold <= 14 && Math.abs(s.spin) <= 0.05) && wide > 0 && wide / a.length <= 0.25, 'squad saver: no kind twice in a row, 8 to 14 s holds, calm turns, at most one wide shot in four', `${wide}/${a.length} wide`);
  // each shot keeps its subject in the clear band of the plate (16:9, 9:16)
  const subjects = [
    { lead: [2, -10, 3], yaw: 0.7, c: [0, -10.3, 1], r: 4.5, colony: null },
    { lead: [2, -10, 3], yaw: 2.2, c: [0.5, -10, 2], r: 3, colony: { center: [6, -11, 5], radius: 2.4 } },
  ];
  let n = 0, out = 0;
  for (const [w, h] of [[1920, 1080], [1080, 1920]]) for (const band of [{ t: 0.2 * h, b: 0.27 * h }, { t: 0.3 * h, b: 0.32 * h }]) {
    const fit = r => frameFit({ w, h, clear: band, radius: r, fov: 40 }).dist, f0 = frameFit({ w, h, clear: band, radius: 1, fov: 40 });
    for (const subj of subjects) for (const s0 of a.slice(0, 12)) for (const kind of [s0.kind, 'colony']) for (const ts of [0, 5, 12]) {
      const s = Object.assign({}, s0, { kind });
      const P = squadShotPose(s, ts, subj, fit);
      const box = projectSphere({ w, h, fov: 40, ox: f0.ox, oy: f0.oy }, P.pos, P.tgt, P.tgt, P.r * 0.8);
      const tol = 0.04 * h;
      n++;
      if (!box || box.y0 < band.t - tol || box.y1 > h - band.b + tol || box.x0 < -tol || box.x1 > w + tol) out++;
    }
  }
  ok(out <= n * 0.02, 'squad saver: the shots keep the squad (or the colony) in the clear band in 16:9 and 9:16', `${out} of ${n} poses out of the band`);
}

// ── glsl ────────────────────────────────────────────────────────────────────
// The prefix of three.js r160 for a GLSL3 ShaderMaterial (WebGLProgram),
// cut to what these programs use. Raw programs get the version line only.
const PREC = 'precision highp float;\nprecision highp int;\nprecision highp sampler2D;\n';
const VS_PRE = '#version 300 es\n#define attribute in\n#define varying out\n#define texture2D texture\n' + PREC +
  'uniform mat4 modelMatrix;\nuniform mat4 modelViewMatrix;\nuniform mat4 projectionMatrix;\nuniform mat4 viewMatrix;\nuniform mat3 normalMatrix;\nuniform vec3 cameraPosition;\nuniform bool isOrthographic;\n' +
  'in vec3 position;\nin vec3 normal;\nin vec2 uv;\n';
const FS_PRE = '#version 300 es\n#define varying in\n#define texture2D texture\n' + PREC +
  'uniform mat4 viewMatrix;\nuniform vec3 cameraPosition;\nuniform bool isOrthographic;\n' +
  'vec4 sRGBTransferOETF( in vec4 value ) { return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a ); }\n' +
  'vec4 linearToOutputTexel( vec4 value ) { return sRGBTransferOETF( value ); }\n';
const GLSLANG = ['/opt/homebrew/bin/glslangValidator', '/usr/local/bin/glslangValidator'].find(p => fs.existsSync(p));
function checkES(progs) {
  if (!GLSLANG) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coral-es-'));
  const out = [];
  try {
    for (const p of progs) {
      const logs = [];
      for (const [st, src] of [['vert', p.vs], ['frag', p.fs]]) {
        const f = path.join(dir, `${p.name}.${st}`);
        fs.writeFileSync(f, p.raw ? '#version 300 es\n' + src : (st === 'vert' ? VS_PRE : FS_PRE) + src);
        try { execFileSync(GLSLANG, [f], { stdio: 'pipe' }); } catch (e) { logs.push(`${st}: ${String(e.stdout || e.stderr || e.message).trim().split('\n').slice(0, 8).join('\n')}`); }
      }
      out.push({ name: p.name, ok: !logs.length, log: logs.join('\n') });
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  return out;
}
{
  const progs = [
    { name: 'coral', vs: SH.CORAL_VS, fs: SH.CORAL_FS },
    { name: 'polyp', vs: SH.POLYP_VS, fs: SH.POLYP_FS },
    { name: 'coral-depth', vs: SH.CORAL_DEPTH_VS, fs: SH.DEPTH_FS },
    { name: 'polyp-depth', vs: SH.POLYP_DEPTH_VS, fs: SH.DEPTH_FS },
    { name: 'rock', vs: SH.ROCK_VS, fs: SH.ROCK_FS },
    { name: 'sand', vs: SH.SURF_VS, fs: SH.SAND_FS },
    { name: 'snow', vs: SH.SNOW_VS, fs: SH.SNOW_FS },
    { name: 'beam-snow', vs: BEAM_SNOW_VS, fs: SH.SNOW_FS },
    { name: 'caustic', vs: SH.CAUSTIC_VS, fs: SH.CAUSTIC_FS, raw: true },
    { name: 'volume', vs: SH.FULL_VS, fs: SH.VOL_FS, raw: true },
    { name: 'volume-history', vs: SH.FULL_VS, fs: SH.VOL_TAA_FS, raw: true },
    { name: 'composite', vs: SH.FULL_VS, fs: SH.COMP_FS, raw: true },
    { name: 'luminance', vs: SH.FULL_VS, fs: SH.LUM_FS, raw: true },
  ];
  const nr = checkPrograms(progs);
  if (nr[0].ok === null) console.log('glsl: naga not found, the naga check did not run');
  else { console.log('glsl naga: ' + nr.map(r => `${r.name} ${r.ok ? 'ok' : 'FAIL'}`).join(', ')); for (const r of nr) ok(r.ok, `glsl: ${r.name} passes naga`, r.log); }
  const er = checkES(progs);
  if (!er) console.log('glsl: glslangValidator not found, the GLSL ES check did not run');
  else { console.log('glsl ES 3.00: ' + er.map(r => `${r.name} ${r.ok ? 'ok' : 'FAIL'}`).join(', ')); for (const r of er) ok(r.ok, `glsl: ${r.name} compiles as GLSL ES 3.00 with the three.js prefix`, r.log); }
  // the GLSL noise is the water.js noise (the CPU tests measure the screen)
  ok(SH.NOISE2.includes('374761393u') && SH.NOISE2.includes('668265263u') && SH.NOISE2.includes('1274126177u') && SH.NOISE2.includes('2.03') && SH.WATER.includes('4.4') && SH.WATER.includes('0.026'), 'glsl: NOISE2 and causticAt use the water.js hash, warp and patch numbers');
  ok(SH.WATER.includes('0.30 * uR') && SH.WATER.includes('length(w.xz) - uR'), 'glsl: fadeAt is the water.js plot fade');
}

// ── boot in jsdom (mobile-check.mjs) ──────────────────────────────────────
{
  const mc = new URL('../mobile-check.mjs', import.meta.url).pathname;
  let out = '', code = 0;
  try { out = execFileSync(process.execPath, [mc], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 240000 }); }
  catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); code = e.status || 1; }
  const last = out.trim().split('\n').filter(l => /^mobile-check:/.test(l)).pop() || out.trim().split('\n').pop();
  console.log(`boot: ${last}`);
  if (/SKIPPED/.test(last)) console.log('boot: jsdom not found, the jsdom boot did not run');
  else ok(code === 0 && / 0 failed/.test(last), 'boot: main.js boots in jsdom at 360x740, 390x844, 430x932, 768x1024, 844x390 and 1440x900 with the dock, sheet and feed card', out.split('\n').filter(l => /^FAIL/.test(l)).slice(0, 5).join('\n'));
}

export function done(tag = 'scene') {
  console.log(`${tag}: ${pass} passed, ${fail} failed`);
  return fail;
}
if (import.meta.url === `file://${process.argv[1]}`) process.exit(done() ? 1 : 0);
