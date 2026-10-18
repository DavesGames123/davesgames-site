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
//    saver ........ saver.js: the dive plan (one colony per dive, seeded,
//                   calm shots, few wide shots), each shot keeps its
//                   subject in the clear band of the plate in 16:9 and
//                   9:16, pickSite takes a feature site, clearPath keeps
//                   rock out of the camera line
//    glsl ......... every program of shaders.js passes naga (as GLSL 450)
//                   and glslangValidator as GLSL ES 3.00 with the prefix
//                   that three.js r160 adds (the browser form)
//    fade ......... water.js fadeAt and the GLSL fadeAt: 1 in the plot, 0
//                   at 1.3 R, smooth, no step
// ============================================================================
import { divePlan, shotAt, shotPose, pickSite, clearPath, frameFit, projectedBox, projectSphere, SHOT_KINDS, SAVER_GRADIENTS } from '../saver.js';
import { createStubRock } from '../rov/stub-rock.js';
import { GRADIENTS } from '../../../lib/growth-gradients.js';
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

// ── saver ───────────────────────────────────────────────────────────────────
{
  const sp = ['staghorn', 'fan', 'table', 'boulder', 'finger'];
  const a = divePlan(42, { n: 8, species: sp }), b = divePlan(42, { n: 8, species: sp }), c = divePlan(43, { n: 8, species: sp });
  ok(JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(c), 'saver: one seed gives one run, another seed another');
  ok(a.every(d => sp.includes(d.species) && GRADIENTS[d.gradient] && d.grow >= 110 && d.grow <= 200), 'saver: each dive grows one colony of a species for 110 to 200 s');
  ok(a.every((d, i) => i === 0 || d.species !== a[i - 1].species), 'saver: no species twice in a row');
  ok(new Set(a.map(d => d.seed)).size === a.length && new Set(a.map(d => d.siteKind)).size >= 4, 'saver: every dive has a new seed, and the sites vary');
  ok(SAVER_GRADIENTS.every(g => GRADIENTS[g]), 'saver: the gradients exist');
  let shots = 0, wide = 0, twice = 0, holdOk = true, calmOk = true, cover = true;
  for (const d of a) {
    const S = d.shots; shots += S.length;
    cover = cover && S[S.length - 1].t0 + S[S.length - 1].hold >= d.grow;
    for (let i = 0; i < S.length; i++) {
      if (S[i].kind === 'wide') wide++;
      if (i && S[i].kind === S[i - 1].kind) twice++;
      if (S[i].hold < 7 || S[i].hold > 14) holdOk = false;
      if (Math.abs(S[i].spin) > 0.07 || !SHOT_KINDS.includes(S[i].kind)) calmOk = false;
    }
    ok(S[0].kind === 'orbit' || S[0].kind === 'shoulder', 'saver: a dive opens on the colony, not a wide shot');
  }
  console.log(`saver: 8 dives, ${shots} shots, ${wide} wide (${(wide / shots * 100).toFixed(0)}%), kinds ${SHOT_KINDS.map(k => `${k} ${a.flatMap(d => d.shots).filter(s => s.kind === k).length}`).join(', ')}`);
  ok(twice === 0 && holdOk && calmOk && cover, 'saver: no shot kind twice in a row, 7 to 14 s holds, calm turns, shots cover the growth');
  ok(wide > 0 && wide / shots <= 0.25, 'saver: some wide shots of the ROV in the dark, at most one in four', `${wide}/${shots}`);
  ok(shotAt(a[0], 0).i === 0 && shotAt(a[0], a[0].shots[1].t0 + 0.1).i === 1 && shotAt(a[0], 1e6).u === 1, 'saver: shotAt finds the shot on at a time');

  // framing: each shot keeps its subject in the clear band (16:9, 9:16)
  const subj = { c: [2, 1.2, -1], r: 1.4, front: [2.3, 2.1, -0.8], rov: [5.5, 2.6, 1.8] };
  let worst = 0, n = 0;
  for (const [w, h, name] of [[1920, 1080, '16:9'], [1080, 1920, '9:16']]) {
    for (const band of [{ t: 0.2 * h, b: 0.27 * h }, { t: 0.3 * h, b: 0.32 * h }]) {
      const fitDist = r => frameFit({ w, h, clear: band, radius: r, fov: 40 }).dist;
      const f0 = frameFit({ w, h, clear: band, radius: 1, fov: 40 });
      for (const d of a.slice(0, 4)) for (const s of d.shots) for (const u of [0, 0.5, 1]) {
        const P = shotPose(s, u, u * s.hold, subj, fitDist);
        const box = projectSphere({ w, h, fov: 40, ox: f0.ox, oy: f0.oy }, P.pos, P.tgt, P.tgt, P.r);
        const tol = 0.03 * h;
        const inside = box && box.y0 >= band.t - tol && box.y1 <= h - band.b + tol && box.x0 >= -tol && box.x1 <= w + tol;
        n++;
        if (!inside) { worst++; if (worst < 4) console.log(`  out of band: ${name} ${s.kind} u ${u}`, JSON.stringify(box)); }
        // the colony itself is in the frame (it may be larger in a push-in)
        const cb = projectSphere({ w, h, fov: 40, ox: f0.ox, oy: f0.oy }, P.pos, P.tgt, subj.c, subj.r);
        if (!cb || (cb.x0 + cb.x1) / 2 < 0 || (cb.x0 + cb.x1) / 2 > w || (cb.y0 + cb.y1) / 2 < band.t * 0.5 || (cb.y0 + cb.y1) / 2 > h - band.b * 0.5) { worst++; if (worst < 4) console.log(`  colony off frame: ${name} ${s.kind} u ${u}`, JSON.stringify(cb)); }
      }
    }
  }
  console.log(`saver framing: ${n} poses checked, ${worst} out of the band`);
  ok(worst === 0, `saver framing: ${n} poses in 16:9 and 9:16 keep the subject in the clear band and the colony on screen`, worst);
  const fw = frameFit({ w: 1920, h: 1080, clear: { t: 216, b: 292 }, radius: 1.4 }), fv = frameFit({ w: 1080, h: 1920, clear: { t: 384, b: 518 }, radius: 1.4 });
  const bw = projectedBox({ w: 1920, h: 1080 }, fw, 1.4), bv = projectedBox({ w: 1080, h: 1920 }, fv, 1.4);
  console.log(`saver framing: a 1.4 m colony at ${fw.dist.toFixed(1)} m (16:9, box y ${bw.y0.toFixed(0)}..${bw.y1.toFixed(0)} of band 216..788), ${fv.dist.toFixed(1)} m (9:16, box x ${bv.x0.toFixed(0)}..${bv.x1.toFixed(0)} of 1080)`);
  ok(bw.y0 >= 215.5 && bw.y1 <= 788.5 && bv.x0 >= -0.5 && bv.x1 <= 1080.5, 'saver framing: frameFit puts a colony in the band at both aspects');

  // a site on the rock, and rock out of the camera line (the ROV stub rock)
  const rock = createStubRock({ seed: 3, radius: 30 });
  let r = 7; const rand = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  const arch = rock.features.find(f => f.kind === 'arch');
  const site = pickSite(rock, 'arch', 0, rand, 30);
  const dArch = site ? Math.hypot(site.p[0] - arch.center[0], site.p[1] - arch.center[1], site.p[2] - arch.center[2]) : Infinity;
  console.log(`saver site: arch site ${site ? site.p.map(v => v.toFixed(1)).join(',') : 'none'}, ${dArch.toFixed(1)} m from the arch centre, sdf ${site ? rock.sdf(...site.p).toFixed(3) : '-'}`);
  ok(site && dArch < 8 && Math.abs(rock.sdf(...site.p)) < 0.2 && site.n[1] > 0.25, 'saver: pickSite takes a site on the rock near the wanted feature');
  ok(pickSite(null, 'arch') === null && pickSite({ sampleSurface: () => [] }, 'arch') === null, 'saver: pickSite with no rock gives null');
  // a camera inside a canyon wall comes to the open side
  const tgt = [0, 2, 0], pos = [-4.2, 2, 0];
  const cp = clearPath(rock.sdf, tgt, pos, 0.5);
  let minD = Infinity; for (let i = 0; i <= 50; i++) { const t = i / 50; minD = Math.min(minD, rock.sdf(tgt[0] + (cp[0] - tgt[0]) * t, tgt[1] + (cp[1] - tgt[1]) * t, tgt[2] + (cp[2] - tgt[2]) * t)); }
  ok(rock.sdf(...pos) < 0 && minD > 0.2 && Math.hypot(...cp.map((v, i) => v - tgt[i])) >= 0.6, 'saver: clearPath moves a camera out of the rock to the open side', `${cp.map(v => v.toFixed(2))} min sdf ${minD.toFixed(2)}`);
  const free = [0, 6, 6];
  ok(JSON.stringify(clearPath(rock.sdf, [0, 6, 0], free, 0.5)) === JSON.stringify(free), 'saver: clearPath keeps a camera with a free line');
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
