// tests/core.test.mjs — CORE package checks (node, no GPU, no browser).
// Run alone: node stella-nova/pages/dla-terrain/tests/core.test.mjs
// CORE's tests.mjs also runs it with every other file in tests/.
//
// What it checks: the Globals, CascadeInfo and ShadowPass offsets against
// the WGSL layout rules of shaders/common.wgsl (and SKY's own table in
// sky-state.js), the matrix maths (reverse-Z), the cascade split and texel
// snapping, the camera collision and the drone spline, the saver plan, the
// saver framing for 16:9 and 9:16, the poster code extracts, the option
// grouping (LIB OPTIONS, else the stub), the map pixels, the weather
// slider round trip, the dynamic resolution step and the TAA jitter.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GLOBALS, GLOBALS_FLOATS, packGlobals, CASCADE_FLOATS, SHADOWPASS_FLOATS, applyWxOver, wxFromGlobals } from '../gpu/globals.js';
import { perspectiveRZ, orthoRZ, lookAt, mul, invert, project, xform } from '../gpu/mat.js';
import { cascadeSplits, computeCascades, lightBasis } from '../gpu/shadows.js';
import { sampleHeight, packAux, biomeRows } from '../gpu/terrain-gpu.js';
import { createGovernor, governorStep } from '../gpu/governor.js';
import { createCamera, dronePath, bandShift, CLEAR } from '../camera.js';
import { buildShotPlan, framing, subjectScreenY, shotLabel, extractFn, SHOT_CODE, SHOT_KINDS, shotTod } from '../saver.js';
import { groupOptions, GROUP_ORDER, mapPixels, todRate, fmtValue, STAGES } from '../ui.js';
import { jitterAt, halton } from '../render/post.js';
import * as Stub from '../gpu/stub-terrain.js';

const here = p => fileURLToPath(new URL('../' + p, import.meta.url));
let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`ok ${pass + fail} core: ${name}`); }
  else { fail++; console.log(`not ok ${pass + fail} core: ${name} ${extra}`); }
}
const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e;

// ── WGSL struct layout (uniform address space: mat4x4f 64/16, vec4f 16/16,
//    array<mat4x4f, N> 64 N / 16)
function structOffsets(src, name) {
  const m = new RegExp('struct\\s+' + name + '\\s*\\{([\\s\\S]*?)\\};').exec(src);
  if (!m) return null;
  const body = m[1].replace(/\/\/[^\n]*/g, '');
  const out = {}; let off = 0;
  const re = /(\w+)\s*:\s*(array<[^>]+>|\w+)/g;
  let q;
  while ((q = re.exec(body))) {
    const ty = q[2].replace(/\s/g, '');
    let size;
    if (ty === 'mat4x4f') size = 64;
    else if (ty === 'vec4f') size = 16;
    else if (/^array<mat4x4f,(\d+)>$/.test(ty)) size = 64 * +/^array<mat4x4f,(\d+)>$/.exec(ty)[1];
    else return { error: 'type ' + ty };
    off = Math.ceil(off / 16) * 16;
    out[q[1]] = { offset: off / 4, size: size / 4 };
    off += size;
  }
  out.__floats = Math.ceil(off / 16) * 4;
  return out;
}
const common = readFileSync(here('shaders/common.wgsl'), 'utf8');
const so = structOffsets(common, 'Globals');
let same = !!so && !so.error;
for (const k in GLOBALS) if (!so || !so[k] || so[k].offset !== GLOBALS[k].offset || so[k].size !== GLOBALS[k].size) { same = false; console.log('  mismatch', k, so && so[k], GLOBALS[k]); }
ok(same && so.__floats === GLOBALS_FLOATS && GLOBALS_FLOATS === 132, 'Globals offsets match common.wgsl (132 floats, 528 bytes)');
ok(Object.keys(so).length - 1 === Object.keys(GLOBALS).length, 'Globals has the same field count in JS and WGSL');
const ci = structOffsets(common, 'CascadeInfo');
ok(ci && ci.viewProj.offset === 0 && ci.splits.offset === 64 && ci.texel.offset === 68 && ci.params.offset === 72 && ci.__floats === CASCADE_FLOATS, 'CascadeInfo layout matches packCascades');
const sp = structOffsets(common, 'ShadowPass');
ok(sp && sp.viewProj.offset === 0 && sp.info.offset === 16 && sp.__floats === SHADOWPASS_FLOATS, 'ShadowPass layout matches packShadowPass');
// the contract block is in the file word for word (field names and order)
const contractFields = ['viewProj', 'invViewProj', 'view', 'proj', 'prevViewProj', 'camPos', 'sunDir', 'sunColor', 'moonDir', 'ambient', 'fog', 'wind', 'weather', 'weather2', 'terrain', 'terrainOrigin', 'screen', 'frame'];
ok(JSON.stringify(Object.keys(GLOBALS)) === JSON.stringify(contractFields), 'Globals fields in contract order');
for (const b of ['@group(0) @binding(1) var tHeight: texture_2d<f32>', '@group(0) @binding(4) var tBiome: texture_2d<u32>', '@group(2) @binding(0) var tShadow: texture_depth_2d_array']) ok(common.includes(b), 'common.wgsl declares ' + b.split(' var ')[1]);
for (const f of ['fn terrainHeight(', 'fn terrainNormal(', 'fn terrainAux(', 'fn biomeAt(', 'fn worldToUV(', 'fn sunShadow(']) ok(common.includes(f), 'common.wgsl has ' + f);
if (existsSync(here('sky-state.js'))) {
  const sky = await import('../sky-state.js');
  const SG = sky.GLOBALS;
  let agree = true;
  for (const k of ['camPos', 'sunDir', 'sunColor', 'moonDir', 'ambient', 'fog', 'wind', 'weather', 'weather2', 'terrain', 'terrainOrigin', 'screen', 'frame']) if (SG[k] !== GLOBALS[k].offset) agree = false;
  ok(agree && SG.floats === GLOBALS_FLOATS, 'sky-state.js GLOBALS offsets agree with gpu/globals.js');
}
// packGlobals puts each field at its offset
{
  const f = new Float32Array(GLOBALS_FLOATS);
  const I = Float32Array.from({ length: 16 }, (_, i) => i + 1);
  packGlobals(f, { viewProj: I, camPos: [1, 2, 3], time: 9, sky: { sunDir: [0, 1, 0], sunIlluminance: 5, cover: 0.7, season: 0.25 }, terrain: { worldSize: 16000, n: 1024, seaLevel: 3 }, width: 800, height: 400, frame: 12, dt: 0.016, quality: 0.75, coarse: true });
  ok(f[GLOBALS.viewProj.offset + 15] === 16 && f[GLOBALS.camPos.offset + 3] === 9 && f[GLOBALS.sunDir.offset + 3] === 5
    && near(f[GLOBALS.weather.offset], 0.7) && near(f[GLOBALS.weather2.offset + 3], 0.25)
    && f[GLOBALS.terrain.offset] === 16000 && near(f[GLOBALS.terrain.offset + 3], 16000 / 1024) && f[GLOBALS.terrainOrigin.offset] === -8000
    && f[GLOBALS.screen.offset] === 800 && near(f[GLOBALS.screen.offset + 3], 1 / 400) && f[GLOBALS.frame.offset + 3] === 1, 'packGlobals writes each field at its offset');
  const w = applyWxOver(f, { cover: 0.2, rain: 0.5, fog: 0.5, wind: 12 });
  const back = wxFromGlobals(w);
  ok(near(back.cover, 0.2) && near(back.rain, 0.5) && near(back.fog, 0.5, 1e-3) && near(back.wind, 12, 1e-3), 'weather sliders round trip through Globals');
}

// ── matrices (reverse-Z)
{
  const P = perspectiveRZ(Math.PI / 3, 1.5, 0.5);
  const a = xform(P, [0, 0, -0.5, 1]), b = xform(P, [0, 0, -1000, 1]);
  ok(near(a[2] / a[3], 1) && b[2] / b[3] > 0 && b[2] / b[3] < 1e-3, 'perspectiveRZ: near -> depth 1, far -> depth near 0');
  ok(near(0.5 / (b[2] / b[3]), 1000, 1e-2), 'linearDepth = near / depth (common.wgsl rule)');
  const O = orthoRZ(-1, 1, -1, 1, 2, 10);
  ok(near(xform(O, [0, 0, -2, 1])[2], 1) && near(xform(O, [0, 0, -10, 1])[2], 0), 'orthoRZ maps z = -n to 1 and z = -f to 0');
  const V = lookAt([10, 20, 30], [0, 0, 0], [0, 1, 0]);
  const VP = mul(P, V), I = mul(invert(VP), VP);
  let id = true;
  for (let i = 0; i < 16; i++) if (!near(I[i], i % 5 === 0 ? 1 : 0, 1e-3)) id = false;
  ok(id, 'invert(viewProj) * viewProj = identity');
  ok(near(xform(V, [0, 0, 0, 1])[2], -Math.hypot(10, 20, 30), 1e-3), 'lookAt puts the target on -z');
}

// ── cascades
{
  const splits = cascadeSplits(0.5, 9000, 4, 0.82);
  ok(splits.length === 4 && splits.every((v, i) => i === 0 || v > splits[i - 1]) && near(splits[3], 9000, 1e-2), 'cascade splits rise to the far distance');
  const camA = { pos: [100, 600, 200], forward: [0.6, -0.3, -0.74], fovY: 0.9, aspect: 16 / 9, near: 0.5 };
  const sun = [0.4, 0.6, -0.69].map((v, _, a) => v / Math.hypot(...a));
  const opt = { count: 4, size: 2048, far: 9000, bounds: { min: [-8000, -50, -8000], max: [8000, 3000, 8000] } };
  const c1 = computeCascades(camA, sun, opt);
  const camB = { ...camA, pos: [103.3, 600, 199.1] };
  const c2 = computeCascades(camB, sun, opt);
  // texel snapping: the ortho x offset of each cascade is a whole texel apart between two nearby cameras
  let snapped = true;
  for (let i = 0; i < 4; i++) {
    // VP = ortho * L and L has no translation, so VP[12] = ortho[12] = -cx / r
    const dx = (c1.mats[i][12] - c2.mats[i][12]) * c1.radii[i] / c1.texel[i];
    if (Math.abs(dx - Math.round(dx)) > 1e-2) snapped = false;
    if (!near(c1.radii[i], c2.radii[i])) snapped = false;
  }
  ok(snapped, 'cascade centres snap to whole shadow texels and the radii do not change with the camera position');
  // the terrain box is inside the depth range of every cascade
  let inZ = true;
  for (let i = 0; i < 4; i++) for (const p of [[-8000, -50, -8000], [8000, 3000, 8000], [0, 0, 0]]) { const q = project(c1.mats[i], p); if (q[2] < 0 || q[2] > 1) inZ = false; }
  ok(inZ, 'the whole terrain box is in the shadow depth range of each cascade');
  // the slice of each cascade is inside its sphere
  const th = Math.tan(camA.fovY / 2), tw = th * camA.aspect;
  const f = camA.forward, up0 = [0, 1, 0];
  const r = [f[1] * up0[2] - f[2] * up0[1], f[2] * up0[0] - f[0] * up0[2], f[0] * up0[1] - f[1] * up0[0]];
  const rl = Math.hypot(...r); r.forEach((v, i) => { r[i] = v / rl; });
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  let inside = true, prev = 0.5;
  for (let i = 0; i < 4; i++) {
    for (const d of [prev, c1.splits[i]]) for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const p = [0, 1, 2].map(k => camA.pos[k] + f[k] * d + r[k] * d * tw * sx + u[k] * d * th * sy);
      const q = project(c1.mats[i], p);
      if (Math.abs(q[0]) > 1.001 || Math.abs(q[1]) > 1.001) inside = false;
    }
    prev = c1.splits[i];
  }
  ok(inside, 'each view slice projects inside its cascade map');
  ok(Math.abs(lightBasis([0, 1, 0])[0]) <= 1, 'light basis works with the sun at the zenith');
}

// ── terrain helpers
{
  const n = 4, ws = 400, h = Float32Array.from({ length: 16 }, (_, i) => i * 10);
  ok(near(sampleHeight(h, n, ws, -200 + 50, -200 + 50), 0) && near(sampleHeight(h, n, ws, -200 + 150, -200 + 50), 10) && near(sampleHeight(h, n, ws, -200 + 100, -200 + 50), 5), 'sampleHeight is bilinear on cell centres');
  ok(packAux({ n: 2, height: new Float32Array(4) }) === null && packAux({ n: 2, flow: Float32Array.of(0, Math.E - 1, 0, 0) })[4] === 1, 'aux packs log(1 + flow) into r');
  const b = biomeRows(Uint8Array.of(1, 2, 3, 4), 2, 4);
  ok(b.bytesPerRow === 256 && b.data[0] === 1 && b.data[3] === 2 && b.data[256 * 3 + 3] === 4, 'biome rows resample and pad to 256 bytes');
}

// ── camera
{
  const hill = (x, z) => 300 + 200 * Math.sin(x / 500) * Math.cos(z / 700);
  const world = { heightAt: hill, size: 8000, seaLevel: 0 };
  const cam = createCamera();
  cam.frameWorld({ size: 8000, midH: 300 });
  cam.orbit.pitch = -0.02; cam.orbit.dist = 50;
  for (let i = 0; i < 30; i++) cam.update(1 / 30, {}, world);
  ok(cam.pos[1] >= hill(cam.pos[0], cam.pos[2]) + CLEAR - 1e-6, 'orbit eye stays over the ground');
  cam.setMode('fly', world);
  cam.fly.pos = [0, hill(0, 0) + 5, 0]; cam.fly.pitch = -1.2;
  for (let i = 0; i < 60; i++) cam.update(1 / 30, { move: [0, 0, 1], boost: true }, world);
  ok(cam.pos[1] >= hill(cam.pos[0], cam.pos[2]) + CLEAR - 1e-6, 'fly into the ground stops at the clearance');
  const m = cam.matrices(800, 450, { shift: [0, 0.3] });
  const q = project(m.viewProj, [cam.pos[0] + cam.forward[0] * 100, cam.pos[1] + cam.forward[1] * 100, cam.pos[2] + cam.forward[2] * 100]);
  ok(near(q[1], 0.3, 1e-3) && near(q[0], 0, 1e-3), 'the band shift moves the view axis to the NDC y it names');
  const mj = cam.matrices(800, 450, { jitter: [0.5, -0.25] });
  const qj = project(mj.viewProj, [cam.pos[0] + cam.forward[0] * 100, cam.pos[1] + cam.forward[1] * 100, cam.pos[2] + cam.forward[2] * 100]);
  ok(near(qj[0] * 400, 0.5, 1e-2) && near(qj[1] * 225, -0.25, 1e-2), 'TAA jitter moves the image by the jitter in px');
  // drone spline
  const poly = new Float32Array(200);
  for (let i = 0; i < 100; i++) { poly[i * 2] = -3000 + i * 60; poly[i * 2 + 1] = 400 * Math.sin(i / 12); }
  const d = dronePath(poly, world, { clearance: 80 });
  let above = true, smooth = true, last = null, lastDir = null;
  for (let s = 0; s <= d.len; s += 25) {
    const a = d.at(s);
    if (a.pos[1] < hill(a.pos[0], a.pos[2]) + 40) above = false;
    if (last) {
      const step = Math.hypot(a.pos[0] - last[0], a.pos[1] - last[1], a.pos[2] - last[2]);
      if (step > 40) smooth = false;
      const dir = [a.pos[0] - last[0], a.pos[2] - last[2]].map(v => v / (Math.hypot(a.pos[0] - last[0], a.pos[2] - last[2]) || 1));
      if (lastDir && dir[0] * lastDir[0] + dir[1] * lastDir[1] < 0.8) smooth = false;
      lastDir = dir;
    }
    last = a.pos;
  }
  ok(d.len > 5000 && above, 'drone path keeps clear of the ground along the ridge');
  ok(smooth, 'drone path moves at an even pace with no sharp turn');
  ok(near(bandShift({ t: 100, b: 100 }, 800), 0) && bandShift({ t: 300, b: 100 }, 800) < 0, 'bandShift: centred band -> 0, a low band -> a negative NDC y');
}

// ── saver
{
  const a = buildShotPlan(42, 24), b = buildShotPlan(42, 24), c = buildShotPlan(43, 24);
  ok(JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(c), 'shot plan is seeded: same seed same plan, new seed new plan');
  ok(a[0].kind === 'forming', 'the first shot grows a new terrain from DLA');
  ok(a.every(s => s.dur >= 5 && s.dur <= 12), 'every shot lasts 5 to 12 s');
  ok(a.every((s, i) => i === 0 || s.kind !== a[i - 1].kind), 'no kind twice in a row');
  const kinds = new Set(a.map(s => s.kind));
  ok(Object.keys(SHOT_KINDS).every(k => kinds.has(k)), 'every shot kind is in 24 shots: ' + [...kinds].join(', '));
  ok(a.every(s => s.tod >= 0 && s.tod < 1 && s.weather && s.cam), 'each shot has a time, a weather and a camera');
  const sr = a.find(s => s.kind === 'sunrise');
  ok(sr && shotTod(sr, 0) < 0.25 && shotTod(sr, sr.dur) > 0.3, 'the sunrise shot is a time-lapse through the dawn');
  const st = a.find(s => s.kind === 'storm');
  ok(st && st.weatherEnd === 'thunderstorm' && st.skySpeed > 1, 'the storm shot rolls a thunderstorm in');
  for (const [W, H, name] of [[1920, 1080, '16:9'], [1080, 1920, '9:16']]) {
    const band = { t: H * 0.22, b: H * 0.3 };
    const fr = framing(W, H, band);
    const y = subjectScreenY(fr, H);
    ok(y > band.t && y < H - band.b && near(y, band.t + (H - band.t - band.b) / 2, 1e-6), `${name}: the subject sits in the middle of the clear band`);
    const fr0 = framing(W, H, null);
    ok(near(subjectScreenY(fr0, H), H / 2), `${name}: no plate -> the subject in the frame centre`);
    if (H > W) ok(fr.fovY > framing(H, W, band).fovY && fr.distK > 1, '9:16 gets a wider lens and a farther camera');
  }
  let codeOK = true;
  for (const [kind, [file, fn]] of Object.entries(SHOT_CODE)) {
    const src = readFileSync(here(file), 'utf8');
    const x = extractFn(src, fn);
    if (!x || !x.includes(fn) || !x.trim().endsWith('}') || x.split('\n').length < 2) { codeOK = false; console.log('  no extract', kind, file, fn); }
  }
  ok(codeOK, 'every shot names a real function extract for the poster');
  const L = shotLabel(a[0], { preset: 'Alpine', seed: 9, worldSize: 16000, n: 1024, tod: 0.3, weather: 'Fair' }, { lang: 'wgsl', name: 'x', text: 'fn a() {}' });
  ok(L.title && L.sub && L.params.length >= 5 && L.params.every(p => p.sym && p.name && p.value) && L.code, 'shotLabel fills title, sub, params and code');
}

// ── options and UI maths
{
  let lib = Stub, which = 'stub';
  const libPath = fileURLToPath(new URL('../../../lib/dla-terrain.js', import.meta.url));
  if (existsSync(libPath)) { try { lib = await import('../../../lib/dla-terrain.js'); which = 'lib'; } catch (e) { console.log('  lib import failed', e.message); } }
  for (const L of which === 'lib' ? [lib, Stub] : [Stub]) {
    const groups = groupOptions(L.OPTIONS);
    const seen = groups.flatMap(g => g.items.map(i => i.key));
    const keys = L.OPTIONS.filter(o => o.key !== 'seed').map(o => o.key);
    ok(seen.length === keys.length && new Set(seen).size === keys.length, `${L === Stub ? 'stub' : 'lib'}: every option is in exactly one group`);
    const order = groups.map(g => g.group).filter(g => GROUP_ORDER.includes(g));
    ok(JSON.stringify(order) === JSON.stringify(GROUP_ORDER.filter(g => order.includes(g))), `${L === Stub ? 'stub' : 'lib'}: groups in contract order`);
    if (L !== Stub) ok(GROUP_ORDER.every(g => groups.some(x => x.group === g)), 'lib: all seven groups have options');
    ok(Object.keys(L.PRESETS).length >= 9, `${L === Stub ? 'stub' : 'lib'}: nine presets or more`);
    ok(L.BIOMES.length === 16, `${L === Stub ? 'stub' : 'lib'}: 16 biomes`);
  }
  ok(fmtValue({ type: 'range', step: 0.01 }, 0.123) === '0.12' && fmtValue({ type: 'range', step: 1 }, 7.4) === '7', 'fmtValue follows the step');
  ok(todRate(0) === 0 && todRate(1) > todRate(0.5) && 1440 / todRate(0.25) > 60, 'day speed: 0 is still, the default day lasts minutes');
  ok(STAGES.map(s => s[0]).join() === 'dla,upscale,shape,flow,rivers,erosion,climate,biomes', 'stage bar has the eight LIB stages in order');
  const n = 64, h = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) h[i] = (i % n) * 10 - 100;
  const px = mapPixels({ n, height: h, seaLevel: 0, worldSize: 6400 }, 32, Stub.BIOMES);
  ok(px.length === 32 * 32 * 4 && px[3] === 255 && px[2] > px[0] && px[(31 * 4) + 1] > px[(31 * 4) + 2] - 60, 'map pixels: sea on the low side, land on the high side');
}

// ── post and resolution
{
  const j = Array.from({ length: 8 }, (_, i) => jitterAt(i));
  ok(j.every(([x, y]) => Math.abs(x) <= 0.5 && Math.abs(y) <= 0.5) && new Set(j.map(v => v.join())).size === 8, 'TAA jitter: 8 distinct offsets in the pixel');
  ok(near(halton(1, 2), 0.5) && near(halton(2, 3), 2 / 3), 'Halton sequence');
  const s = createGovernor(1, 0), cfg = { budget: 1000 / 60, maxScale: 1, floor: 0.75 };
  let ch = false;
  for (let i = 0; i < 80; i++) ch = !!governorStep(s, { ms: 30 }, cfg) || ch;
  ok(ch && s.scale < 1 && s.scale >= 0.75, 'dynamic resolution drops when frames are slow (not under the 0.75 floor)', String(s.scale));
  const before = s.scale;
  for (let i = 0; i < 1200; i++) governorStep(s, { ms: 6 }, cfg);
  ok(s.scale > before && s.scale <= 1, 'dynamic resolution climbs back when frames are fast');
}

console.log(`# core: ${pass} pass, ${fail} fail`);
if (fail) process.exitCode = 1;
export default { pass, fail };
