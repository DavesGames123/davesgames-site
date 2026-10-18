// ============================================================================
//  CORAL REEF  ·  GPU path tests (node, no browser):  node tests/gpu.test.mjs
// ----------------------------------------------------------------------------
//  The main view path of scene.js on a recording WebGL2 stand-in
//  (tests/fake-gl.mjs) with the real three r160:
//    passes ...... the volume and composite passes draw (three r160 skips a
//                  geometry with no index and no 'position': the bug that
//                  made the main view black, 2026-10-17)
//    order ....... per frame: the scene into the float target, the volume,
//                  the composite into the canvas (framebuffer 0) last
//    formats ..... targetPlan for float, half-only and no float colour
//    sentinel .... the first-frame check falls back to the direct path
//                  when the composite does not draw
//    exposure .... exposureFrom maps the 95th percentile to the key
//    safari ...... static WebGL2 rules: 16 samplers, uniform vectors,
//                  constant loop bounds, highp int in raw shaders with
//                  int maths, texelFetch only on the NEAREST float
//                  textures, float targets gated by the extensions
//  Set CORAL_OLD_SCENE to a folder with an older scene.js to see the old
//  path fail (the repro).
// ============================================================================
import { installThree, installDom, fakeCanvas } from './fake-gl.mjs';
installThree(); installDom();
const THREE = await import('three');
const { fullTri, drawCountR160, targetPlan, isSentinel, SENTINEL, exposureFrom } = await import('../gpu-safe.js');
const sceneDir = process.env.CORAL_OLD_SCENE ? new URL('file://' + process.env.CORAL_OLD_SCENE.replace(/\/?$/, '/')) : new URL('../', import.meta.url);
const { createScene } = await import(new URL('scene.js', sceneDir).href);
import fs from 'node:fs';

let pass = 0, fail = 0;
function ok(cond, name, info = '') { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${info !== '' ? ' ' + info : ''}`); } }

// ── the three r160 draw rule ──────────────────────────────────────────────
{
  const src = fs.readFileSync(new URL('../../../vendor/three@0.160.0/build/three.module.js', import.meta.url), 'utf8');
  ok(src.includes('if ( drawCount < 0 || drawCount === Infinity ) return;'), 'three r160 still returns on an Infinity draw count');
  const raw = new THREE.BufferGeometry();
  raw.setAttribute('aPos', new THREE.BufferAttribute(new Float32Array([-1, -1, 3, -1, -1, 3]), 2));
  ok(drawCountR160(raw) === 0, 'an aPos-only geometry with no draw range draws 0 vertices (the old passes)', drawCountR160(raw));
  ok(drawCountR160(fullTri(THREE)) === 3, 'fullTri draws 3 vertices', drawCountR160(fullTri(THREE)));
  console.log(`draw rule: aPos only ${drawCountR160(raw)} vertices, fullTri ${drawCountR160(fullTri(THREE))}`);
}

// ── formats ────────────────────────────────────────────────────────────────
{
  const a = targetPlan({ webgl2: true, colorBufferFloat: true }), b = targetPlan({ webgl2: true, colorBufferHalf: true }), c = targetPlan({ webgl2: true }), d = targetPlan({ webgl2: false, colorBufferFloat: true });
  ok(a.post && a.type === 'half', 'EXT_color_buffer_float: post chain on half float');
  ok(b.post && b.type === 'half', 'EXT_color_buffer_half_float only: post chain on half float');
  ok(!c.post && c.type === 'byte', 'no float colour buffer: no post chain, RGBA8');
  ok(!d.post, 'WebGL1: no post chain');
  console.log(`formats: float ${a.type}/${a.post}, half ${b.type}/${b.post}, none ${c.type}/${c.post}`);
}

// ── the frame on the fake context ─────────────────────────────────────────
function runFrames(f, n = 6) {
  const S = createScene({ canvas: f.canvas, coarse: false, R: 30, maxParticles: 4096 });
  if (!S) return null;
  S.resize();
  for (let i = 0; i < n; i++) S.render(1 / 60, i * 16);
  return S;
}
{
  const f = fakeCanvas({ w: 900, h: 1900 });
  const S = runFrames(f);
  ok(!!S, 'createScene runs on the fake WebGL2');
  if (S) {
    const fb0 = f.log.filter(e => e.op === 'draw' && e.fb === 0);
    const tail = f.log.slice(-12).map(e => `${e.op}@${e.fb}${e.n ? ':' + e.n : ''}`).join(' ');
    ok(fb0.length >= 4, 'the composite draws into the canvas each frame', `${fb0.length} draws on fb 0; tail ${tail}`);
    ok(fb0.every(e => e.n === 3), 'the canvas draws are the full-frame triangle (3 vertices)', fb0.map(e => e.n).join(','));
    // the order of the last frame: a draw into a target, then the canvas last
    const lastClear0 = f.log.map(e => e.op === 'clear' && e.fb === 0).lastIndexOf(true);
    const before = f.log.slice(0, lastClear0).filter(e => e.op === 'draw' && e.fb !== 0);
    ok(before.length > 0 && f.log[f.log.length - 1].op === 'draw' && f.log[f.log.length - 1].fb === 0, 'the scene and volume draw into targets, the composite into the canvas last');
    ok(S.post ? S.post.on && !S.post.failed : false, 'the first-frame check passes with a working composite', JSON.stringify(S.post || null));
    console.log(`frame 900x1900: ${fb0.length} canvas draws in 6 frames; post ${S.post ? JSON.stringify({ on: S.post.on, failed: S.post.failed, checks: S.post.checks }) : 'none'}; tail ${tail}`);
  }
}
// no float colour buffer: the scene goes straight to the canvas
{
  const f = fakeCanvas({ w: 390, h: 844, ext: [] });
  const S = runFrames(f, 3);
  const fb0 = f.log.filter(e => e.op === 'draw' && e.fb === 0);
  ok(S && !S.passes && fb0.length > 0, 'no EXT_color_buffer_float: the scene draws straight into the canvas', `${fb0.length}`);
}

// ── the sentinel ───────────────────────────────────────────────────────────
{
  ok(isSentinel([255, 0, 255, 255]) && !isSentinel([20, 30, 40, 255]) && !isSentinel([255, 0, 200, 255]), 'isSentinel finds only the sentinel colour');
  ok(SENTINEL.join() === '1,0,1', 'the sentinel is magenta');
  // a composite that does not draw: the old triangle (no draw range) in a scene of its own
  const f = fakeCanvas({ w: 640, h: 400 });
  const S = runFrames(f, 1);
  if (S && S.post) {
    const mesh = S.passes.compScene.children[0];
    const bad = new THREE.BufferGeometry(); bad.setAttribute('aPos', new THREE.BufferAttribute(new Float32Array([-1, -1, 3, -1, -1, 3]), 2));
    mesh.geometry = bad;
    for (let i = 0; i < 6; i++) S.render(1 / 60, 100 + i * 16);
    ok(S.post.failed && !S.post.on, 'a composite that draws nothing fails the check and the page falls back', JSON.stringify(S.post));
    const last = f.log.slice(-3).filter(e => e.op === 'draw' && e.fb === 0);
    ok(last.length > 0, 'after the fall back the scene draws into the canvas');
    console.log(`sentinel: a blank composite -> ${S.post.reason}, ${S.post.misses} misses`);
  } else ok(false, 'the sentinel test needs the post chain');
}

// ── exposure ───────────────────────────────────────────────────────────────
{
  const enc = L => Math.round(Math.max(0, Math.min(1, (Math.log2(L) + 16) / 20)) * 255);
  const img = (Ls) => { const b = new Uint8Array(Ls.length * 4); Ls.forEach((L, i) => { b[i * 4] = enc(L); }); return b; };
  // a dark frame: water 0.004, 6 % lit rock at 0.03
  const Ls = Array.from({ length: 1024 }, (_, i) => (i < 62 ? 0.03 : 0.004));
  let e = 4;
  for (let i = 0; i < 40; i++) e = exposureFrom(img(Ls), e);
  const p95 = 0.03;          // the top 6 % is lit rock
  ok(Math.abs(e * p95 - 0.25) / 0.25 < 0.1 || e >= 23.9, 'exposure: the 95th percentile goes to the key 0.25 (or the cap)', `e ${e.toFixed(2)}`);
  let e2 = 4; const bright = Array.from({ length: 1024 }, () => 2);
  for (let i = 0; i < 40; i++) e2 = exposureFrom(img(bright), e2);
  ok(e2 >= 1 && e2 < 1.05, 'exposure: a bright frame clamps to 1', e2.toFixed(3));
  ok(exposureFrom(new Uint8Array(0), 3) === 3, 'exposure: no data keeps the last value');
  console.log(`exposure: dark frame ${e.toFixed(2)}, bright frame ${e2.toFixed(2)}`);
}

// ── Safari WebGL2 rules (static checks of shaders.js, rock/material.js) ─────
{
  const SH = await import('../shaders.js');
  const progs = [
    ['coral', SH.CORAL_VS, SH.CORAL_FS, false], ['polyp', SH.POLYP_VS, SH.POLYP_FS, false], ['rock', SH.ROCK_VS, SH.ROCK_FS, false],
    ['sand', SH.SURF_VS, SH.SAND_FS, false], ['snow', SH.SNOW_VS, SH.SNOW_FS, false], ['caustic', SH.CAUSTIC_VS, SH.CAUSTIC_FS, true],
    ['volume', SH.FULL_VS, SH.VOL_FS, true], ['composite', SH.FULL_VS, SH.COMP_FS, true], ['luminance', SH.FULL_VS, SH.LUM_FS, true],
  ];
  const samplers = src => new Set([...src.matchAll(/uniform\s+(?:(?:highp|mediump|lowp)\s+)?sampler2D\s+([^;]+);/g)].flatMap(m => m[1].split(',').map(x => x.trim())));
  // uniform vectors: float/vec = 1 slot, mat4 = 4, arrays x n (a high estimate: no packing)
  const slots = src => {
    let n = 0;
    for (const m of src.matchAll(/uniform\s+(?:(?:highp|mediump|lowp)\s+)?(float|int|vec[234]|ivec[234]|mat[34])\s+([^;]+);/g)) {
      const per = m[1].startsWith('mat') ? +m[1][3] : 1;
      for (const v of m[2].split(',')) { const a = v.match(/\[(\d+)\]/); n += per * (a ? +a[1] : 1); }
    }
    return n;
  };
  const rows = [];
  for (const [name, vs, fs, raw] of progs) {
    const sv = samplers(vs), sf = samplers(fs), all = new Set([...sv, ...sf]);
    ok(sf.size <= 16 && sv.size <= 16 && all.size <= 16, `safari: ${name} uses at most 16 samplers (MAX_TEXTURE_IMAGE_UNITS)`, `${sv.size} vs, ${sf.size} fs`);
    ok(slots(fs) <= 221 && slots(vs) <= 221, `safari: ${name} has under 224 uniform vectors per stage`, `${slots(vs)} vs, ${slots(fs)} fs`);
    // loops: constant bounds only (a uniform bound needs a break inside)
    const loops = [...(vs + fs).matchAll(/for \(int \w+ = (-?\d+); \w+ (<=?) ([^;]+);/g)];
    ok(loops.every(m => /^(-?\d+|\$\{\w+\})$/.test(m[3].trim()) || /^\d+$/.test(m[3].trim())), `safari: ${name} loops have constant bounds`, loops.map(m => m[3]).join(','));
    // int and uint maths in a raw fragment shader needs precision highp int
    const fsInt = /\buint\b|\bivec[234]\b|>>|<</.test(fs);
    if (raw && fsInt) ok(/precision highp int;/.test(fs), `safari: raw ${name} fragment shader with int maths declares highp int`);
    if (raw) ok(/precision highp float;/.test(vs) && /precision highp float;/.test(fs), `safari: raw ${name} declares highp float in both stages`);
    // texelFetch only on the particle textures (RGBA32F, NEAREST: no filtering needed)
    const tf = [...(vs + fs).matchAll(/texelFetch\((\w+)/g)].map(m => m[1]);
    ok(tf.every(t => t === 'uPartA' || t === 'uPartB'), `safari: ${name} texelFetch only on uPartA / uPartB`, tf.join());
    rows.push(`${name} ${all.size} samplers, ${slots(fs)} fs vectors, ${loops.length} loops`);
  }
  const sc = fs.readFileSync(new URL('../scene.js', import.meta.url), 'utf8');
  ok(/mkPart = \(data\) => \{ const t = new THREE\.DataTexture\(data, PART_W, PH, THREE\.RGBAFormat, THREE\.FloatType\); t\.magFilter = THREE\.NearestFilter; t\.minFilter = THREE\.NearestFilter;/.test(sc), 'safari: the float particle textures use NEAREST filters (float32 is not filterable without OES_texture_float_linear)');
  ok(/const half = renderer\.extensions\.has\('EXT_color_buffer_float'\) \|\| renderer\.extensions\.has\('EXT_color_buffer_half_float'\);/.test(sc) && /HalfFloatType : THREE\.UnsignedByteType/.test(sc) && /if \(!fl\) return null;/.test(sc), 'safari: the float targets need EXT_color_buffer_float or _half_float, else RGBA8 caustics and no post chain');
  const rts = [sc, fs.readFileSync(new URL('../rov/feed.js', import.meta.url), 'utf8')].flatMap(t => t.split('\n').filter(l => /WebGLRenderTarget\(/.test(l)));
  ok(rts.length >= 4 && rts.every(l => !/\b(THREE|T)\.FloatType\b/.test(l)), 'safari: no RGBA32F render target in scene.js and rov/feed.js (blending on it needs EXT_float_blend)', rts.filter(l => /\.FloatType\b/.test(l)).join(' | '));
  ok(rts.filter(l => /HalfFloatType/.test(l)).every(l => /half \?|HalfFloatType, depth/.test(l)), 'safari: each half float target is gated (half ? ... : RGBA8, or inside the post chain)');
  console.log('safari: ' + rows.join('; '));
}

console.log(`gpu: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
