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
//    fade ......... water.js fadeAt and the GLSL fadeAt: 1 in the plot, 0
//                   at 1.3 R, smooth, no step
// ============================================================================
import * as SH from '../shaders.js';
import { checkPrograms } from '../glsl-check.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { waveSpectrum, causticField, causticPattern, autocorrPeak, fadeAt, FADE_K, surfaceAt, N_WAVES } from '../water.js';

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
    { name: 'rock', vs: SH.ROCK_VS, fs: SH.ROCK_FS },
    { name: 'sand', vs: SH.SURF_VS, fs: SH.SAND_FS },
    { name: 'snow', vs: SH.SNOW_VS, fs: SH.SNOW_FS },
    { name: 'caustic', vs: SH.CAUSTIC_VS, fs: SH.CAUSTIC_FS, raw: true },
    { name: 'volume', vs: SH.FULL_VS, fs: SH.VOL_FS, raw: true },
    { name: 'composite', vs: SH.FULL_VS, fs: SH.COMP_FS, raw: true },
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

export function done(tag = 'scene') {
  console.log(`${tag}: ${pass} passed, ${fail} failed`);
  return fail;
}
if (import.meta.url === `file://${process.argv[1]}`) process.exit(done() ? 1 : 0);
