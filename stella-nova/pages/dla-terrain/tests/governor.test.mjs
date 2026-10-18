// ============================================================================
//  DLA TERRAIN  ·  tests/governor.test.mjs — the governor ladder (CORE)
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/dla-terrain/tests/governor.test.mjs
//  (tests.mjs runs it too). Exit code 1 on a fail. No browser, no GPU.
//
//  The user (2026-10-18, Safari on a Mac): "the zoomed in version also
//  looks awful, no shadows occluders or naything esle really to work
//  with", with "58 fps · 1036x654 · ... level 5" in the status line. The
//  checks run the real gpu/frame.js on a fake device with a fake clock
//  and fake GPU times:
//    A  steady 58 fps (desktop and Safari) from level 5 at scale 0.65: the
//       level comes back to 0 and the scale to the preset in a set time,
//       with GPU headroom and with GPU times that show no headroom
//    B  slow frames: the scale goes down first (not under 0.75), then the
//       rungs in the ladder order; the casters draw at every level under
//       the emergency level; TAA stays on
//    C  steady 30 fps on a 60 Hz budget: the level settles, no step up;
//       a cost cliff between two levels: few probes, the level holds
//    D  a heavy frame during the step up: the scale drops at once, no step
//       up in the pause after it
//    E  the upscale pass: on when the render is under the output, the mid
//       target is one texture, post writes at the render size; naga
//    F  fg.prepare: the frame fields that the modules read (ao.js aoPlan,
//       weather.js shaftPlan), frame.taa, the status text, globals frame.w
//  A to D use only the frame graph API (fg.render, fg.tick, fg.level,
//  fg.scale, drawShadow calls), so they also run on the old gpu/frame.js.
// ============================================================================
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { profileFor } from '../gpu/budget.js';

let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`ok ${pass + fail} governor: ${name}`); }
  else { fail++; console.log(`not ok ${pass + fail} governor: ${name} ${extra}`); }
}
const here = p => fileURLToPath(new URL('../' + p, import.meta.url));

let clock = 0;
Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => clock } });
globalThis.GPUTextureUsage ??= { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 4, COPY_SRC: 1, COPY_DST: 2, STORAGE_BINDING: 8 };
globalThis.GPUBufferUsage ??= { UNIFORM: 64, COPY_DST: 8, STORAGE: 128, MAP_READ: 1 };
globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
const { createFrameGraph } = await import('../gpu/frame.js');
let GOVJS = null;
try { GOVJS = await import('../gpu/governor.js'); } catch { GOVJS = null; }

// a fake device; cost(fg) is the GPU ms of the frame that is submitted now
function fakeFG(profileId, cost, opt = {}) {
  const jobs = [];
  let gpuFree = 0, pend = 0;
  const live = new Map();
  const rec = { passes: [], casts: [] };
  const pass = label => ({ label, setPipeline() {}, setBindGroup() {}, draw() {}, drawIndexed() {}, end() {}, setVertexBuffer() {}, setIndexBuffer() {} });
  let fg = null;
  const device = {
    limits: { maxTextureDimension2D: 8192 },
    createTexture: d => { const t = { d, destroy() { live.set(d.label, (live.get(d.label) || 1) - 1); }, createView: () => ({ tex: d.label }) }; live.set(d.label, (live.get(d.label) || 0) + 1); return t; },
    createBuffer: d => ({ d, destroy() {} }),
    createBindGroup: d => ({ d }),
    createCommandEncoder: () => ({
      beginRenderPass: d => { rec.passes.push(d.label || ''); return pass(d.label); },
      beginComputePass: () => pass('compute'), copyTextureToTexture() {}, finish: () => ({}),
    }),
    queue: {
      writeBuffer() {},
      submit() { const c = cost(fg); const start = Math.max(clock, gpuFree); gpuFree = start + c; pend = gpuFree; },
      onSubmittedWorkDone() { const end = pend; return new Promise(r => jobs.push({ end, r })); },
    },
  };
  if (opt.pipelines) Object.assign(device, {
    createShaderModule: d => ({ d }), createBindGroupLayout: d => ({ d }), createPipelineLayout: d => ({ d }),
    createRenderPipelineAsync: d => Promise.resolve({ d }),
  });
  const profile = profileFor(profileId);
  const gpu = {
    device, queue: device.queue, profile, profileId, qualityIndex: 3, qualityPreset: { scale: 1 },
    hdrFormat: 'rgba16float', depthFormat: 'depth32float', globalsBindGroup: {},
    canvasFormat: opt.pipelines ? 'bgra8unorm' : undefined,
    context: { getCurrentTexture: () => ({ createView: () => ({ swap: true }) }) },
  };
  const sh = {
    info: { count: 3 }, count: 3, size: 2048, layerViews: [{}, {}, {}, {}], passBindGroups: [{}, {}, {}, {}], sampleBindGroup: {},
    resize(s, c) { sh.size = s; sh.count = c; sh.info.count = c; },
  };
  const post = { settings: { taa: true }, last: null, out: null, resize(w, h, ow, oh) { post.last = [w, h, ow, oh]; }, run(enc, src, out) { post.out = out; }, afterSubmit() {} };
  const ground = { role: 'ground', drawOpaque() {}, drawShadow(p, f) { rec.casts.push(['ground', f.cascade]); } };
  const veg = { role: 'vegetation', drawOpaque() {}, drawShadow(p, f) { rec.casts.push(['veg', f.cascade]); } };
  fg = createFrameGraph(gpu, { terrain: { compute() {} }, post, shadows: sh });
  fg.modules = [ground, veg];
  const F = {
    fg, gpu, sh, post, rec, live,
    // one rAF: draw when ready, tick, move the clock, resolve done frames
    async frame(ms, frameObj = {}) {
      rec.casts.length = 0; rec.passes.length = 0;
      let drawn = false;
      if (fg.ready()) drawn = fg.render({ dt: ms / 1000, ...frameObj }) !== false;
      fg.tick(ms);
      // the done promises resolve at the GPU end time (not at the next
      // frame), so fg.gpuMs is the GPU time and not the frame time
      const target = clock + ms;
      jobs.sort((a, b) => a.end - b.end);
      while (jobs.length && jobs[0].end <= target) {
        const j = jobs.shift();
        clock = Math.max(clock, j.end);
        j.r();
        await Promise.resolve(); await Promise.resolve();
      }
      clock = target;
      return drawn;
    },
    async run(seconds, ms, each) {
      const n = Math.round(seconds * 1000 / ms);
      for (let i = 0; i < n; i++) { const d = await F.frame(ms); if (each && each(i * ms / 1000, d) === false) return i * ms / 1000; }
      return seconds;
    },
  };
  return F;
}
const FPS58 = 1000 / 58;

// ── A steady 58 fps: back to level 0 and the full scale
for (const [profileId, gpuMs, levelBy, scaleBy, why] of [
  ['desktop', 9, 30, 50, 'GPU headroom'], ['safari', 9, 30, 50, 'GPU headroom'],
  ['desktop', 16.5, 70, 120, 'no GPU headroom shown (calm frames)'], ['safari', 16.5, 70, 120, 'no GPU headroom shown (calm frames)'],
]) {
  const F = fakeFG(profileId, () => gpuMs);
  F.fg.resize(1280, 800, 1);
  F.fg.setScale(0.65); F.fg.setLevel(5);
  let tLevel = -1, tScale = -1;
  await F.run(Math.max(levelBy, scaleBy) + 5, FPS58, t => {
    if (tLevel < 0 && F.fg.level === 0) tLevel = t;
    if (tScale < 0 && F.fg.scale >= F.fg.maxScale - 1e-6 && F.fg.level === 0) tScale = t;
    if (tLevel >= 0 && tScale >= 0) return false;
  });
  ok(tLevel >= 0 && tLevel <= levelBy, `${profileId} at 58 fps, ${gpuMs} ms GPU (${why}): level 5 -> 0 in ${levelBy} s or less`, `at ${tLevel.toFixed(1)} s, level now ${F.fg.level}`);
  ok(tScale >= 0 && tScale <= scaleBy, `${profileId} at 58 fps, ${gpuMs} ms GPU: scale 0.65 -> the preset ${F.fg.maxScale} in ${scaleBy} s or less`, `at ${tScale.toFixed(1)} s, scale now ${F.fg.scale}`);
  console.log(`# ${profileId} 58 fps, GPU ${gpuMs} ms: level 0 at ${tLevel.toFixed(1)} s, full scale at ${tScale.toFixed(1)} s`);
}

// ── B slow frames: the order of what goes, the casters stay
{
  const F = fakeFG('desktop', () => 40);
  F.fg.resize(1280, 800, 1);
  const seq = [];
  let last = `${F.fg.scale}|${F.fg.level}`;
  const castAt = {}, taaAt = {};
  await F.run(60, 40, (t, drawn) => {
    const k = `${F.fg.scale}|${F.fg.level}`;
    if (k !== last) { seq.push(k); last = k; }
    if (drawn) {
      const l = F.fg.level;
      const g0 = F.rec.casts.some(c => c[0] === 'ground' && c[1] === 0), v0 = F.rec.casts.some(c => c[0] === 'veg' && c[1] === 0);
      castAt[l] = (castAt[l] ?? true) && g0 && v0;
      taaAt[l] = (taaAt[l] ?? true) && F.post.settings.taa !== false;
    }
  });
  const scales = seq.map(k => +k.split('|')[0]), levels = seq.map(k => +k.split('|')[1]);
  const firstLevel = levels.findIndex(l => l > 0);
  ok(firstLevel > 0 && scales.slice(0, firstLevel).every((s, i, a) => i === 0 || s < a[i - 1]) && scales[firstLevel - 1] === 0.75,
    'slow frames: the scale steps down first, to 0.75, before any level', seq.slice(0, 5).join(' '));
  ok(Math.min(...scales) >= 0.75, 'slow frames (not heavy): the scale does not go under 0.75', String(Math.min(...scales)));
  const lv = levels.slice(firstLevel);
  ok(lv.length === 7 && lv.every((l, i) => l === i + 1), 'slow frames: then the levels 1 to 7 one by one, never the emergency level', lv.join(','));
  const lvls = Object.keys(castAt).map(Number).sort((a, b) => a - b);
  ok(lvls.length >= 8 && lvls.every(l => castAt[l]), 'the ground and the plants cast in cascade 0 at every level under the emergency level', JSON.stringify(castAt));
  ok(lvls.every(l => taaAt[l]), 'TAA stays on at every level under the emergency level', JSON.stringify(taaAt));
  if (GOVJS) {
    const keys = GOVJS.RUNGS.map(r => r.key).join(',');
    ok(keys === 'shafts,pom,ao,grass,shadowRes,cascades2,cascade1,emergency', 'the ladder order: shafts, POM, AO, grass, shadow size, cascades, 1 cascade, emergency', keys);
    ok(F.sh.count === 1 && F.sh.size === 1024, 'at level 7: one cascade at half size (2048 -> 1024)', `count ${F.sh.count} size ${F.sh.size}`);
    for (let l = 0; l <= GOVJS.MAX_LEVEL; l++) {
      const pl = GOVJS.planOf(GOVJS.featuresOf(l), { size: 4096, count: 4, taa: true });
      if (l < GOVJS.MAX_LEVEL && !(pl.casters && pl.taa && pl.cascades >= 1)) ok(false, `plan level ${l}: casters and TAA on`);
      if (l === GOVJS.MAX_LEVEL) ok(!pl.casters && !pl.taa && !pl.clouds, 'plan of the emergency level: no casters, no TAA, no clouds');
    }
  }
  // the heavy path still reaches the emergency level: no casters there
  const H = fakeFG('safari', () => 400);
  H.fg.resize(1280, 800, 1);
  let castEm = null;
  await H.run(20, 50, (t, drawn) => { if (drawn && H.fg.level === 8) castEm = H.rec.casts.length; });
  ok(H.fg.level === 8 && castEm === 0 && H.post.settings.taa === false, 'sustained heavy frames: the emergency level (no casters, TAA off)', `level ${H.fg.level} casts ${castEm}`);
}

// ── C steady 30 fps on a 60 Hz budget; a cost cliff
{
  const F = fakeFG('desktop', () => 30);
  F.fg.resize(1280, 800, 1);
  F.fg.budgetMs = 1000 / 60;
  const changes = [];
  let last = `${F.fg.scale}|${F.fg.level}`;
  await F.run(180, 1000 / 30, t => { const k = `${F.fg.scale}|${F.fg.level}`; if (k !== last) { changes.push([t, k]); last = k; } });
  const late = changes.filter(c => c[0] > 60);
  const ups = changes.filter((c, i) => { const p = i ? changes[i - 1][1] : '1|0'; return +c[1].split('|')[1] < +p.split('|')[1] || +c[1].split('|')[0] > +p.split('|')[0]; });
  ok(late.length === 0, '30 fps on a 60 Hz budget: no change after 60 s (settled)', JSON.stringify(late.slice(0, 4)));
  ok(ups.length === 0 && F.fg.level <= 7, '30 fps: only steps down, and not to the emergency level', `ups ${ups.length} level ${F.fg.level}`);
  console.log(`# 30 fps: ${changes.length} changes, settled at scale ${F.fg.scale} level ${F.fg.level} by ${changes.length ? changes.at(-1)[0].toFixed(1) : 0} s`);
  // a cliff: under level 4 the GPU takes 24 ms, at 4 and up 10 ms
  const C = fakeFG('desktop', fg => (fg.level >= 4 ? 10 : 24));
  C.fg.resize(1280, 800, 1);
  C.fg.setScale(0.75); C.fg.setLevel(6);
  let probes = 0, held = 0, n = 0, prev = C.fg.level;
  await C.run(300, FPS58, t => {
    if (C.fg.level === 3 && prev === 4) probes++;
    prev = C.fg.level;
    if (t > 30) { n++; if (C.fg.level >= 4) held++; }
  });
  ok(probes <= 12 && held / n > 0.95, `a cost cliff at level 4: ${probes} probes of level 3 in 300 s, level 4 held ${(100 * held / n).toFixed(1)}% of the time`, `probes ${probes}`);
}

// ── D a heavy frame during the step up
{
  let heavyNext = false;
  const F = fakeFG('safari', () => { if (heavyNext) { heavyNext = false; return 70; } return 9; });
  F.fg.resize(1280, 800, 1);
  F.fg.setScale(0.75); F.fg.setLevel(5);
  // run until the first step up
  const tUp = await F.run(30, FPS58, () => (F.fg.level < 5 ? false : undefined));
  const l1 = F.fg.level, s1 = F.fg.scale;
  ok(l1 === 4, `headroom: the first step up (level 5 -> ${l1}) at ${tUp.toFixed(1)} s`);
  heavyNext = true;
  let tDrop = -1;
  await F.run(1, FPS58, t => { if (tDrop < 0 && (F.fg.scale < s1 || F.fg.level > l1)) tDrop = t; });
  ok(tDrop >= 0 && tDrop < 0.2 && F.fg.scale < s1, 'a 70 ms frame (Safari heavy limit 50 ms) drops the scale at once', `scale ${s1} -> ${F.fg.scale} at ${tDrop.toFixed(2)} s`);
  const lAfter = F.fg.level;
  let upInPause = false;
  await F.run(6, FPS58, () => { if (F.fg.level < lAfter) upInPause = true; });
  ok(!upInPause, 'no step up in the pause after the heavy frame', `level ${lAfter} -> ${F.fg.level}`);
  const tBack = await F.run(60, FPS58, () => (F.fg.level === 0 ? false : undefined));
  ok(F.fg.level === 0, `after the pause the climb goes on (level 0 after ${tBack.toFixed(1)} s more)`);
}

// ── E the upscale pass
if (GOVJS) {
  const F = fakeFG('safari', () => 9, { pipelines: true });
  F.fg.resize(2000, 1260, 2);
  await Promise.resolve(); await Promise.resolve();
  F.fg.setScale(0.75);
  ok(!!F.fg.upscaler && F.fg.upscaler.ready, 'the upscale pipeline is ready (async)');
  await F.frame(FPS58);
  ok(F.fg.w < F.fg.outW && !!F.fg.U && F.rec.passes.includes('upscale'), `render ${F.fg.w}x${F.fg.h} under the output ${F.fg.outW}x${F.fg.outH}: the upscale pass runs`, F.rec.passes.join(','));
  ok(F.post.last[2] === F.fg.w && F.post.last[3] === F.fg.h && F.post.out === F.fg.U.view, 'post writes at the render size into the mid target', JSON.stringify(F.post.last));
  F.fg.setScale(0.7); F.fg.setScale(0.8); F.fg.setScale(0.75);
  ok(F.live.get('upscale source') === 1, 'one mid target after three scale changes (the old ones destroyed)', String(F.live.get('upscale source')));
  F.fg.setScale(1);
  await F.frame(FPS58);
  ok(F.fg.w === F.fg.outW && !F.fg.U && !F.rec.passes.includes('upscale') && F.post.last[2] === F.fg.outW, 'render size = output: no upscale pass, post to the swap chain', F.rec.passes.join(','));
  ok((F.live.get('upscale source') || 0) === 0, 'no mid target at the full size');
  const { UPSCALE_WGSL } = await import('../gpu/upscale.js');
  const NAGA = join(homedir(), '.cargo/bin/naga');
  if (existsSync(NAGA)) {
    const p = join(mkdtempSync(join(tmpdir(), 'dla-up-')), 'upscale.wgsl');
    writeFileSync(p, UPSCALE_WGSL);
    const r = spawnSync(NAGA, [p], { encoding: 'utf8' });
    ok(r.status === 0 && /Validation successful/.test((r.stdout || '') + (r.stderr || '')), 'naga gpu/upscale.js UPSCALE_WGSL', (r.stdout || '') + (r.stderr || ''));
  } else console.log('# naga is not at ~/.cargo/bin/naga: the upscale WGSL check did not run');
  const bad = UPSCALE_WGSL.split('\n').filter(l => /&&/.test(l) && /\|\|/.test(l));
  ok(bad.length === 0, 'upscale WGSL: no mixed && and || (Tint)');
}

// ── F the frame fields, the status text, the TAA bit
if (GOVJS) {
  const { aoPlan } = await import('../render/ao.js');
  const { shaftPlan } = await import('../render/weather.js');
  const F = fakeFG('desktop', () => 9);
  F.fg.resize(1280, 800, 1);
  const prof = profileFor('desktop');
  const want = { 0: [0, true, 2, true], 1: [0, true, 1, true], 2: [1, true, 1, true], 3: [1, false, 1, true], 4: [1, false, 1, false], 7: [1, false, 1, false], 8: [5, false, 0, false] };
  for (const l of [0, 1, 2, 3, 4, 7, 8]) {
    F.fg.setLevel(l);
    const fr = F.fg.prepare({ quality: 1, shafts: { mode: 'auto', k: 1 }, layers: { grass: true, clouds: true } });
    const ao = aoPlan(fr, prof, 'desktop').on;
    const sm = shaftPlan(fr.shafts.mode, 1, prof, fr.govLevel).mode;   // 2 volume? (1 volume, 2 screen, 0 off)
    const shaft = sm === 1 ? 2 : sm === 2 ? 1 : 0;
    const [gl, aoOn, sh, grass] = want[l];
    ok(fr.govLevel === gl && ao === aoOn && shaft === sh && (fr.layers.grass !== false) === grass && fr.taa === (l < 8) && fr.gov.level === l,
      `level ${l}: govLevel ${gl}, AO ${aoOn ? 'on' : 'off'}, shafts ${['off', 'screen', 'volume'][sh]}, grass ${grass ? 'on' : 'off'}, TAA ${l < 8 ? 'on' : 'off'}`,
      `got govLevel ${fr.govLevel} ao ${ao} shafts ${shaft} grass ${fr.layers.grass} taa ${fr.taa}`);
  }
  const off = F.fg.prepare({ shafts: { mode: 'off' } });
  ok(off.shafts.mode === 'off', 'a user shaft mode off stays off');
  F.fg.setLevel(5); F.fg.setScale(0.75);
  const txt = F.fg.govText();
  ok(/render 75%/.test(txt) && /screen shafts/.test(txt) && /no POM/.test(txt) && /no AO/.test(txt) && /no grass/.test(txt) && /half shadow maps/.test(txt) && /^level 5: /.test(txt), 'the status text says what is lower', txt);
  F.fg.setLevel(0); F.fg.setScale(1);
  ok(F.fg.govText() === '' && F.sh.count === 3 && F.sh.size === 2048, 'at full: no status text, the shadow maps are back at the base', `${F.fg.govText()} ${F.sh.count} ${F.sh.size}`);
  const main = readFileSync(here('main.js'), 'utf8');
  ok(/fg\.prepare\(frame\);[\s\S]{0,200}for \(const md of fg\.active\(\)\) if \(md\.update\)/.test(main), 'main.js calls fg.prepare(frame) before the module updates');
  ok(/govStatus\(\)/.test(main) && /fg\.govText/.test(main) && !/' · level ' \+ fg\.level : ''\}\$\{app\.libKind/.test(main), 'main.js shows the governor text in the status line');
  ok(/fg\.rebase\(\)/.test(main), 'main.js rebases the governor after a quality change');
  const { packGlobals, GLOBALS, GLOBALS_FLOATS } = await import('../gpu/globals.js');
  const f = new Float32Array(GLOBALS_FLOATS);
  packGlobals(f, { coarse: false, taa: false });
  const a = f[GLOBALS.frame.offset + 3];
  packGlobals(f, { coarse: true });
  const b = f[GLOBALS.frame.offset + 3];
  ok(a === 2 && b === 1, 'globals frame.w: + 2 = TAA off, + 1 = coarse', `${a} ${b}`);
  const common = readFileSync(here('shaders/common.wgsl'), 'utf8');
  ok(/let taaOff = \(u32\(G\.frame\.w\) & 2u\) != 0u;[\s\S]{0,40}select\(G\.frame\.x \* 0\.6180339, 0\.0, taaOff\)/.test(common), 'common.wgsl sunShadowSoft: the PCSS noise stands still when TAA is off');
}

console.log(`# governor: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
