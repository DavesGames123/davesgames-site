// ============================================================================
//  COLLAPSE CITY  ·  tests.mjs — node checks, no browser
// ----------------------------------------------------------------------------
//  Run:  NODE_PATH=<dir with jsdom 24> node stella-nova/pages/wfc-city/tests.mjs
//  Exit code 1 when a check fails. V=1 prints each passed check.
//  Without jsdom, the page boot sections print SKIP (not a pass).
//  Without ~/.cargo/bin/naga, the WGSL section prints SKIP.
//
//  GREP MAP
//    section('world ......... the World API on the mock AND on pkg/ (when
//                             pkg/wfc_city_bg.wasm is there): mesh layout,
//                             births, determinism, move_body, forget_far
//    section('gpu ........... gpu.js with a stub WebGPU device: stride 32,
//                             attribute offsets, uploads, culling, frames
//                             in flight capped at 2, destroy
//    section('wgsl .......... naga on common + each shader; the Chrome lint
//                             (no * with ^, no && with || at one level)
//    section('saver ......... the shot plan varies by seed, durations,
//                             director poses in 16:9 and 9:16, band shift
//    section('clock ......... the display clock
//    section('page .......... head order, [hidden] rule, the ids main.js
//                             and saver.js bind exist, credits
//    section('boot ......... main.js + saver.js in jsdom with the stub GPU:
//                             mock run (badge on) and pkg run (badge off)
// ============================================================================
import { readFile, writeFile, mkdtemp, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import * as Mock from './mock-world.js';
import { createRenderer, VERTEX_STRIDE, VERTEX_ATTRS, UNIFORM_BYTES, M4, skyState, glossOf, materialOf } from './gpu.js';
import { makePlan, startSaver, bandShift, KEYS } from './saver.js';
import { clockStep, focusAhead, speedBudget } from './main.js';

const here = new URL('./', import.meta.url);
let fails = 0, passes = 0, skips = 0;
const ok = (c, msg) => { if (c) { passes++; if (process.env.V) console.log('  ok', msg); } else { fails++; console.log('  FAIL', msg); } };
const skip = msg => { skips++; console.log('  SKIP', msg); };
const section = n => console.log(`\n── ${n}`);
const exists = async u => { try { await access(u); return true; } catch (e) { return false; } };
const finite = a => { for (const v of a) if (!Number.isFinite(v)) return false; return true; };
const fnv = arr => { const b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); let h = 2166136261; for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 16777619); } return h >>> 0; };

const pkgJs = new URL('pkg/wfc_city.js', here), pkgWasm = new URL('pkg/wfc_city_bg.wasm', here);
const hasPkg = await exists(pkgJs) && await exists(pkgWasm);
let Pkg = null, wasmBytes = null;
if (hasPkg) {
  wasmBytes = await readFile(pkgWasm);
  Pkg = await import(pkgJs.href);
  await Pkg.default({ module_or_path: wasmBytes });
}

// ---------------------------------------------------------------------------------
async function worldChecks(name, mod) {
  section(`world: ${name}`);
  const H = 12, w = new mod.World(42, H);
  ok(typeof mod.version === 'function' && typeof mod.version() === 'string', `${name}: version() is a string (${mod.version()})`);
  let total = 0, calls = 0, t0 = performance.now();
  for (; calls < 200; calls++) { const n = w.update(1, 2, 1, 20, 400); total += n; if (!n) break; }
  const genMs = performance.now() - t0;
  ok(total > 0 && w.counter() >= total, `${name}: update() collapses slots, counter() >= sum of returns (backtracks collapse again) (${total} in ${calls} calls, ${genMs.toFixed(0)} ms)`);
  ok(calls < 200, `${name}: update() reaches 0 when the area is done`);
  const d = w.dirty_chunks();
  ok(d instanceof Int32Array && d.length > 0 && d.length % 2 === 0, `${name}: dirty_chunks() is an Int32Array of pairs (${d.length / 2} chunks)`);
  ok(w.dirty_chunks().length === 0, `${name}: dirty_chunks() clears the list`);
  let verts = 0, maxV = 0, badLen = 0, badN = 0, badC = 0, badB = 0, badP = 0, nonEmpty = 0, maxMs = 0;
  const cnt = w.counter();
  for (let n = 0; n < d.length; n += 2) {
    const cx = d[n], cz = d[n + 1], ts = performance.now();
    const m = w.chunk_mesh(cx, cz);
    maxMs = Math.max(maxMs, performance.now() - ts);
    if (!(m instanceof Float32Array) || m.length % 8 || (m.length / 8) % 3) { badLen++; continue; }
    const nv = m.length / 8; verts += nv; maxV = Math.max(maxV, nv); if (nv) nonEmpty++;
    for (let v = 0; v < nv; v++) {
      const o = v * 8;
      const nl = Math.hypot(m[o + 3], m[o + 4], m[o + 5]);
      if (!(Math.abs(nl - 1) < 0.03)) badN++;
      const ci = m[o + 6];
      if (!(ci >= 0 && ci <= 15 && Math.round(ci) === ci)) badC++;
      if (!(m[o + 7] >= 0 && m[o + 7] <= cnt)) badB++;
      const x = m[o], y = m[o + 1], z = m[o + 2];
      if (!(x >= cx * 16 - 2.5 && x <= cx * 16 + 18.5 && z >= cz * 16 - 2.5 && z <= cz * 16 + 18.5 && y >= -3 && y <= H * 2 + 6)) badP++;
    }
  }
  ok(badLen === 0, `${name}: chunk_mesh length is a whole number of 8-float vertices and triangles`);
  ok(nonEmpty > 0 && verts > 0, `${name}: meshes have vertices (${verts} in ${nonEmpty} chunks, max ${maxV}, slowest ${maxMs.toFixed(2)} ms)`);
  ok(maxV < 60000, `${name}: each chunk is under 60k vertices`);
  ok(badN === 0, `${name}: normals are unit length (${badN} bad)`);
  ok(badC === 0, `${name}: colour index is an integer 0..15 (${badC} bad)`);
  ok(badB === 0, `${name}: birth is in 0..counter() (${badB} bad)`);
  ok(badP === 0, `${name}: positions are in the chunk box (${badP} bad)`);
  // births of one triangle are equal (the shader hides a slot as one)
  {
    const m = w.chunk_mesh(d[0], d[1]); let mixed = 0;
    for (let t = 0; t < m.length / 24; t++) { const b = m[t * 24 + 7]; if (m[t * 24 + 15] !== b || m[t * 24 + 23] !== b) mixed++; }
    ok(mixed === 0, `${name}: the 3 vertices of a triangle have one birth (${mixed} mixed)`);
  }
  // determinism
  const a = new mod.World(7, H), b = new mod.World(7, H), c = new mod.World(8, H);
  for (let n = 0; n < 12; n++) { a.update(5, 2, 5, 16, 300); b.update(5, 2, 5, 16, 300); c.update(5, 2, 5, 16, 300); }
  const ha = fnv(a.chunk_mesh(0, 0)), hb = fnv(b.chunk_mesh(0, 0)), hc = fnv(c.chunk_mesh(0, 0));
  ok(ha === hb, `${name}: same seed + same updates = same mesh`);
  ok(ha !== hc, `${name}: another seed gives another mesh`);
  // body
  const st = new Float32Array([3, 40, 3, 0, 0, 0, 0, 0]);
  for (let n = 0; n < 240; n++) w.move_body(st, 1 / 60, 0.32, 1.75, false);
  ok(finite(st) && st[6] === 1, `${name}: move_body falls and lands (y ${st[1].toFixed(2)}, grounded ${st[6]})`);
  ok(st[1] > -1 && st[1] < H * 2 + 2, `${name}: the body lands on the city, not under it`);
  const fast = new Float32Array([3, 30, 3, 0, -30, 0, 0, 0]); let low = Infinity;
  for (let n = 0; n < 60; n++) { w.move_body(fast, 1 / 30, 0.32, 1.75, false); low = Math.min(low, fast[1]); fast[4] = Math.min(fast[4], -30); }
  ok(low > -0.6, `${name}: no tunnelling at 30 m/s, dt 1/30 (lowest y ${low.toFixed(2)})`);
  const fl = new Float32Array([3, 30, 3, 0, 0, 0, 0, 0]);
  for (let n = 0; n < 60; n++) w.move_body(fl, 1 / 60, 0.32, 1.75, true);
  ok(Math.abs(fl[1] - 30) < 0.01, `${name}: fly mode has no gravity`);
  const gh = w.ground_height(3, 3);
  ok(Number.isFinite(gh) && gh >= -1, `${name}: ground_height is finite (${gh.toFixed(2)})`);
  // the rest of the API
  const s = w.stats();
  ok(s.length === 8 && finite(s) && s[0] <= w.counter(), `${name}: stats() has 8 finite values, [0] <= counter`);
  const pal = w.palette();
  ok(pal.length === 48 && [...pal].every(v => v >= 0 && v <= 1), `${name}: palette() is 16 x rgb in 0..1`);
  {
    const mats = []; for (let i = 0; i < 16; i++) mats.push(materialOf(pal[i * 3], pal[i * 3 + 1], pal[i * 3 + 2]));
    ok(mats.filter(m => m === 0.9).length >= 1 && mats.filter(m => m === 0).length >= 8, `${name}: the palette has a glass colour for the night windows (materials ${mats.join(' ')})`);
  }
  ok(w.module_count() > 0 && typeof w.prototype_name(0) === 'string' && w.prototype_name(0).length > 0, `${name}: ${w.module_count()} modules, prototype 0 = "${w.prototype_name(0)}"`);
  const si = w.slot_info(0, 0, 0);
  ok(si.length === 4 && si[0] === 2, `${name}: slot_info at the focus is collapsed`);
  const far = w.slot_info(5000, 0, 5000);
  ok(far[0] !== 2, `${name}: slot_info far away is not collapsed`);
  const gone = w.forget_far(4000, 4000, 10);
  ok(gone.length > 0 && gone.length % 2 === 0, `${name}: forget_far drops chunks out of range (${gone.length / 2})`);
  ok(w.stats()[4] === 0 || w.stats()[4] < s[4], `${name}: live chunks fall after forget_far`);
  // a walk: generation moves with the focus
  const wk = new mod.World(3, H); let z = 0, tw = performance.now(), worst = 0;
  for (let n = 0; n < 120; n++) { z -= 0.8; const t1 = performance.now(); wk.update(0, 2, z, 24, 300); worst = Math.max(worst, performance.now() - t1); wk.dirty_chunks(); }
  ok(wk.counter() > 0, `${name}: a walk of 96 m keeps the solver busy (${wk.counter()} slots, ${(performance.now() - tw).toFixed(0)} ms, worst call ${worst.toFixed(1)} ms)`);
  for (const x of [w, a, b, c, wk]) x.free();
}

await worldChecks('mock', Mock);
if (Pkg) await worldChecks('pkg', Pkg);
else { section('world: pkg'); skip('pkg/wfc_city.js or pkg/wfc_city_bg.wasm is missing: the real solver was not tested'); }

// ---------------------------------------------------------------------------------
function gpuStub() {
  const log = { pipelines: [], buffers: 0, destroyed: 0, submits: 0, draws: 0, writes: 0, devDestroyed: false, passes: [] };
  const pend = [];
  const device = {
    lost: new Promise(() => {}),
    queue: {
      writeBuffer(b, off, data, doff = 0, size) {
        const n = size ?? (data.byteLength - doff);
        if (off + n > b.size) throw new Error(`writeBuffer past the end: ${off}+${n} > ${b.size}`);
        if (n % 4) throw new Error('writeBuffer size not a multiple of 4');
        log.writes++;
      },
      submit() { log.submits++; },
      onSubmittedWorkDone() { return new Promise(r => pend.push(r)); },
    },
    createShaderModule: d => ({ code: d.code }),
    createBindGroupLayout: d => d, createPipelineLayout: d => d,
    createRenderPipeline: d => { log.pipelines.push(d); return d; },
    createBuffer: d => { log.buffers++; if (!(d.size > 0) || d.size % 4) throw new Error('bad buffer size ' + d.size); return { size: d.size, destroy() { log.destroyed++; } }; },
    createTexture: d => ({ ...d, createView: () => ({}), destroy() {} }),
    createSampler: () => ({}), createBindGroup: d => d,
    createCommandEncoder: () => ({
      beginRenderPass(d) {
        log.passes.push(d.label);
        let pipe = null;
        return {
          setPipeline(p) { pipe = p; }, setBindGroup() {},
          setVertexBuffer(s, b) { if (!b) throw new Error('no vertex buffer'); },
          draw(n) { if (!(n > 0) || !pipe) throw new Error('bad draw ' + n); log.draws++; },
          end() {},
        };
      },
      finish: () => ({}),
    }),
    destroy() { log.devDestroyed = true; },
  };
  const gpu = { requestAdapter: async () => ({ requestDevice: async () => device }), getPreferredCanvasFormat: () => 'bgra8unorm' };
  const ctx = { configure() {}, unconfigure() {}, getCurrentTexture: () => ({ createView: () => ({}) }) };
  return { gpu, device, ctx, log, flush() { while (pend.length) pend.shift()(); } };
}
const loadText = p => readFile(new URL(p, here), 'utf8');

section('gpu: gpu.js with a stub device');
{
  ok(VERTEX_STRIDE === 32, 'VERTEX_STRIDE is 32 bytes');
  ok(JSON.stringify(VERTEX_ATTRS.map(a => [a.shaderLocation, a.offset, a.format])) === JSON.stringify([[0, 0, 'float32x3'], [1, 12, 'float32x3'], [2, 24, 'float32'], [3, 28, 'float32']]), 'attributes: pos @0, normal @12, colour @24, birth @28');
  const S = gpuStub();
  const canvas = { width: 0, height: 0, getContext: () => S.ctx };
  const R = await createRenderer(canvas, { gpu: S.gpu, loadText });
  const vb = S.log.pipelines.filter(p => p.vertex.buffers && p.vertex.buffers.length);
  ok(vb.length === 2 && vb.every(p => p.vertex.buffers[0].arrayStride === 32), 'city and shadow pipelines read a 32-byte stride');
  ok(S.log.pipelines.every(p => !p.depthStencil || p.depthStencil.format === 'depth32float'), 'depth32float in every pass');
  const city = S.log.pipelines.find(p => p.label === 'city');
  ok(city.depthStencil.depthCompare === 'greater' && city.multisample.count === 4, 'main pass: reversed depth (greater), 4x MSAA');
  R.resize(800, 600, 2);
  ok(canvas.width === 1600 && canvas.height === 1200, 'resize applies the pixel ratio');
  R.resize(3840, 2160, 2);
  ok(canvas.width * canvas.height <= 4.7e6, `resize caps the pixel count (${canvas.width}x${canvas.height})`);
  R.resize(800, 600, 1);
  // upload the mock chunks
  const w = new Mock.World(9, 12);
  for (let n = 0; n < 20; n++) w.update(0, 2, 0, 20, 500);
  const d = w.dirty_chunks();
  for (let n = 0; n < d.length; n += 2) R.uploadChunk(d[n], d[n + 1], w.chunk_mesh(d[n], d[n + 1]));
  ok(R.chunkCount > 4, `uploadChunk keeps one buffer per chunk (${R.chunkCount})`);
  const before = S.log.buffers;
  R.uploadChunk(d[0], d[1], w.chunk_mesh(d[0], d[1]));
  ok(S.log.buffers === before, 'a second upload of the same size reuses the buffer');
  R.uploadChunk(d[0], d[1], new Float32Array(0));
  ok(!R.hasChunk(d[0], d[1]), 'an empty mesh drops the chunk');
  R.setPalette(w.palette());
  const proj = M4.perspective(1.05, 800 / 600, 0.12), view = M4.viewYawPitch([0, 30, 40], 0, -0.4), vp = M4.mul(proj, view);
  const F = { viewProj: vp, invViewProj: M4.invert(vp), eye: [0, 30, 40], sky: skyState(16.5), clock: w.counter(), span: 400, drop: 7, fogStart: 20, fogEnd: 40, haze: 0.002, worldH: 24, shadowCentre: [0, 0, 20], shadowHalf: 60 };
  const r1 = R.render(F), draws1 = S.log.draws;
  ok(r1 && draws1 > 2, `render() draws chunks, the ground and the sky (${draws1} draws, ${R.stats.draws} chunks in view, ${R.stats.shadowDraws} in the sun box)`);
  {
    const v2 = M4.viewYawPitch([0, 30, 90], Math.PI, -0.3), vp2 = M4.mul(proj, v2);
    await S.flush(); await new Promise(r => setTimeout(r, 0));
    R.render({ ...F, viewProj: vp2, invViewProj: M4.invert(vp2), eye: [0, 30, 90] });
    ok(R.stats.draws === 0 && R.chunkCount > 4, `frustum culling: a camera that looks away draws no chunks (${R.stats.draws} of ${R.chunkCount})`);
    await S.flush(); await new Promise(r => setTimeout(r, 0));
  }
  ok(R.render(F) === true && R.render(F) === true && R.render(F) === false, 'a third frame waits: at most 2 frames in flight');
  await S.flush(); await new Promise(r => setTimeout(r, 0));
  ok(R.inFlight === 0 && R.render(F) === true, 'frames go on after the GPU work is done');
  // inverse and planes
  const I = M4.mul(vp, M4.invert(vp));
  ok([...I].every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-3), 'M4.invert of the reversed infinite projection');
  const behind = M4.boxVisible(M4.sidePlanes(vp), -8, 0, 200, 8, 24, 216);
  ok(!behind, 'a box behind the eye is culled');
  // sky states
  const hours = [0, 5, 6.5, 9, 12, 16.5, 18, 19.5, 22];
  ok(hours.every(h => { const s = skyState(h); return finite(s.sunDir) && finite(s.sunColor) && finite(s.skyTop) && Math.abs(Math.hypot(...s.sunDir) - 1) < 1e-6; }), 'skyState is finite with a unit light direction at every hour');
  ok(skyState(12).night === 0 && skyState(0).night === 1, 'noon is day, midnight is night');
  ok(skyState(16.5).elev > 15 && skyState(16.5).elev < 35, `the default hour 16.5 has a low warm sun (${skyState(16.5).elev.toFixed(1)} deg)`);
  const pal = w.palette();
  ok(glossOf(pal[21], pal[22], pal[23]) > 0.55 && glossOf(pal[0], pal[1], pal[2]) === 0, 'glossOf: mock glass is glossy, paving is not');
  {
    // the lane A palette as written in crate/src/modules.rs (PALETTE_SRGB) on 2026-11-05
    const A = [0x2d2b2e, 0x9d9386, 0xc69b6a, 0xe2d1ad, 0x8f3c2b, 0xb4532d, 0x404b58, 0x4f9a86, 0x2e5b2a, 0x60903b, 0x1f5c73, 0x6b4429, 0x1c2938, 0xffc45c, 0xede6d6, 0x1c1d21];
    const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const m = A.map(c => materialOf(lin((c >> 16) & 255), lin((c >> 8) & 255), lin(c & 255)));
    ok(m[12] === 0.9 && m[10] === 0.5 && m[13] === 2 && m[6] === 0 && m.filter(x => x).length === 3, `materialOf on the lane A colours: glass 12, water 10, lamp 13, slate 6 matte (${m.join(' ')})`);
  }
  R.destroy();
  ok(S.log.devDestroyed && R.render(F) === false, 'destroy() frees the device and stops render');
  ok(UNIFORM_BYTES === 608, 'the uniform is 608 bytes (common.wgsl Frame)');
  w.free();
}

// ---------------------------------------------------------------------------------
section('wgsl: naga and the Chrome lint');
{
  const naga = join(homedir(), '.cargo/bin/naga');
  const common = await loadText('shaders/common.wgsl');
  const files = { common: common, city: common + '\n' + await loadText('shaders/city.wgsl'), sky: common + '\n' + await loadText('shaders/sky.wgsl') };
  // Chrome (Tint) rejects a * b ^ c and a && b || c without brackets.
  function lint(src) {
    const s = src.replace(/\/\/.*$/gm, '');
    const bad = [];
    let stack = [new Set()];
    for (let i = 0; i < s.length; i++) {
      const ch = s[i], two = s.slice(i, i + 2);
      if (ch === '(' || ch === '[') { stack.push(new Set()); continue; }
      if (ch === ')' || ch === ']') { stack.pop(); if (!stack.length) stack = [new Set()]; continue; }
      if (ch === ';' || ch === '{' || ch === '}' || ch === ',') { stack[stack.length - 1] = new Set(); continue; }
      const top = stack[stack.length - 1];
      if (two === '&&' || two === '||') { top.add(two); i++; if (top.has('&&') && top.has('||')) bad.push('&& with || near ' + s.slice(Math.max(0, i - 30), i + 10).replace(/\s+/g, ' ')); continue; }
      if (ch === '^' || (ch === '*' && s[i + 1] !== '=')) { top.add(ch); if (top.has('^') && top.has('*')) bad.push('* with ^ near ' + s.slice(Math.max(0, i - 30), i + 10).replace(/\s+/g, ' ')); }
    }
    return bad;
  }
  for (const [n, src] of Object.entries(files)) { const b = lint(src); ok(b.length === 0, `${n}.wgsl: Chrome lint clean${b.length ? ' — ' + b.join('; ') : ''}`); }
  ok(lint('let a = b * c ^ d;').length === 1 && lint('let a = (b && c) || d;').length === 0, 'the lint finds * with ^ and passes brackets');
  if (await exists(naga)) {
    const dir = await mkdtemp(join(tmpdir(), 'wfc-wgsl-'));
    for (const [n, src] of Object.entries(files)) {
      const f = join(dir, n + '.wgsl'); await writeFile(f, src);
      const r = spawnSync(naga, [f], { encoding: 'utf8' });
      ok(r.status === 0, `naga ${n}.wgsl: ${(r.stdout + r.stderr).trim().split('\n').pop()}`);
    }
    const entries = files.city.match(/@(vertex|fragment)\s+fn\s+(\w+)/g).map(x => x.split(/\s+/).pop());
    ok(['vs_city', 'fs_city', 'vs_shadow'].every(e => entries.includes(e)), 'city.wgsl has vs_city, fs_city, vs_shadow');
  } else skip('~/.cargo/bin/naga is missing: WGSL not validated');
}

// ---------------------------------------------------------------------------------
section('saver: the plan and the director');
{
  const seqs = [1, 2, 3, 99, 123456].map(s => makePlan(s, 160));
  ok(new Set(seqs.map(p => p.slice(0, 10).map(s => s.key).join(','))).size === seqs.length, 'the first 10 shots differ for 5 seeds');
  ok(seqs.every(p => KEYS.every(k => p.slice(0, 10).some(s => s.key === k))), 'every shot key is in the first 10 shots');
  ok(seqs.every(p => p.every((s, i) => i === 0 || s.key !== p[i - 1].key)), 'never the same shot twice in a row');
  ok(seqs.every(p => p.every(s => s.dur >= 6 && s.dur <= 12)), 'each shot lasts 6 to 12 s');
  ok(JSON.stringify(makePlan(5, 20)) === JSON.stringify(makePlan(5, 20)), 'one seed gives one plan');
  ok(Math.abs(bandShift(1000, { t: 100, b: 200 }) - 0.1) < 1e-9 && bandShift(1000, null) === 0, 'bandShift moves the centre into the plate band');
  // a city of towers: 16 m blocks, streets every 16 m
  const heightAt = (x, z) => { const i = Math.floor(x / 2), k = Math.floor(z / 2); if (((i % 8) + 8) % 8 === 0 || ((k % 8) + 8) % 8 === 0) return 0.1; return 4 + (((i >> 3) * 7 + (k >> 3) * 13) & 7) * 2; };
  for (const aspect of [16 / 9, 9 / 16]) {
    let labels = 0;
    const dir = startSaver({ heightAt, stats: () => Float32Array.from([1000, 2, 0, 900, 40, 150, 45, 1]), aspect: () => aspect, height: () => 900, band: () => ({ t: 160, b: 220 }) }, { seed: 77, calm: 0.5, label: () => labels++ });
    const seen = new Set(); let bad = 0, inside = 0, steps = 0, watchRate = false, low = 0;
    for (let n = 0; n < 30 * 120; n++) {
      const p = dir.tick(1 / 30);
      seen.add(p.shot);
      if (!finite(p.eye) || !Number.isFinite(p.yaw) || !Number.isFinite(p.pitch) || !finite(p.focus) || !(p.fov > 0.5 && p.fov < 1.6)) bad++;
      if (p.shot === 'watch' && p.rate > 0) watchRate = true;
      if (p.phase === 'run' && (p.shot === 'street' || p.shot === 'bridge' || p.shot === 'rooftop')) { steps++; if (p.eye[1] < heightAt(p.eye[0], p.eye[2]) + 0.3) inside++; if (p.eye[1] < 4) low++; }
    }
    const tag = aspect > 1 ? '16:9' : '9:16';
    ok(bad === 0, `${tag}: every pose is finite`);
    ok(seen.size >= 4, `${tag}: 120 s shows ${seen.size} shot kinds (${[...seen].join(', ')})`);
    ok(inside <= steps * 0.03, `${tag}: low shots stay out of the towers (${inside} of ${steps} frames under a roof)`);
    ok(low > 0, `${tag}: the street shot goes down to street level`);
    ok(watchRate, `${tag}: the watch shot runs a slow clock`);
    ok(labels > 10, `${tag}: the plate label updates (${labels} calls)`);
    const p0 = dir.tick(1 / 30);
    ok(Math.abs(p0.oy - bandShift(900, { t: 160, b: 220 })) < 1e-9, `${tag}: oy follows the plate band`);
    dir.cut('watch');
    let k = null; for (let n = 0; n < 60; n++) k = dir.tick(1 / 30).shot;
    ok(k === 'watch', `${tag}: cut('watch') goes to the watch shot`);
    const pl = dir.plate();
    ok(pl && pl.title === 'Collapse City' && pl.params.length === 3 && /marian42/.test(pl.lines.join(' ')), `${tag}: plate has the title, 3 values and the credit`);
    ok(dir.debug().seed === 77, `${tag}: debug() has the seed`);
  }
}

// ---------------------------------------------------------------------------------
section('clock: the display clock and the helpers');
{
  let c = 0, r = 0, t = 0;
  for (; t < 3; t += 1 / 60) { const s = clockStep(c, 20000, r, 1 / 60, null); if (s.clock < c) { ok(false, 'clock went back'); break; } c = s.clock; r = s.rate; }
  ok(c >= 19000 && c <= 20000, `the clock catches up 20000 slots in 3 s (${Math.round(c)})`);
  let c2 = 0, r2 = 0;
  for (let n = 0; n < 120; n++) { const s = clockStep(c2, 50000, r2, 1 / 60, 80); c2 = s.clock; r2 = s.rate; }
  ok(c2 > 100 && c2 < 200, `a fixed rate of 80 slots/s holds the clock back (${c2.toFixed(0)} after 2 s)`);
  ok(clockStep(500, 100, 10, 0.016, null).clock === 100, 'a new world (counter under the clock) resets the clock');
  const f = focusAhead([0, 40, 0], 0, 30, 0.3);
  ok(f[2] < 0 && f[0] === 0 && f[1] <= 20, 'focusAhead is ahead of the camera on -z at yaw 0');
  ok(speedBudget(1).budget < speedBudget(10).budget && speedBudget(5).ms < 8, 'speedBudget rises with the slider');
}

// ---------------------------------------------------------------------------------
section('page: html, css, ids');
const html = await loadText('index.html');
{
  const head = html.slice(0, html.indexOf('</head>'));
  const srcs = [...head.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  ok(srcs.slice(0, 3).join() === '../../lib/gpu-guard.js,../../lib/wishlist.js,../../lib/stats-beacon.js', 'head: gpu-guard, wishlist, stats-beacon first');
  ok(head.indexOf('gpu-guard.js') < head.indexOf('<meta charset'), 'head: gpu-guard before everything');
  ok(/lib\/sci\.css/.test(head), 'head: lib/sci.css');
  const css = await loadText('style.css');
  ok(/\[hidden\]\{display:none!important\}/.test(css.replace(/\s/g, '')), 'style.css: [hidden]{display:none!important}');
  const main = await loadText('main.js'), saver = await loadText('saver.js');
  const ids = new Set([...main.matchAll(/\$\('([\w-]+)'\)/g), ...main.matchAll(/getElementById\('([\w-]+)'\)/g), ...saver.matchAll(/getElementById\('([\w-]+)'\)/g)].map(m => m[1]));
  const missing = [...ids].filter(id => !new RegExp(`id="${id}"`).test(html));
  ok(missing.length === 0, `the ${ids.size} ids main.js and saver.js bind are in index.html${missing.length ? ' — missing: ' + missing.join(', ') : ''}`);
  for (const id of ['radius', 'speed', 'anim', 'hour']) ok(html.includes(`id="${id}V"`), `#${id} has a readout #${id}V`);
  ok(/<script type="module" src="saver.js"><\/script>\s*<script type="module" src="main.js">/.test(html), 'saver.js loads before main.js');
  const hiddenEls = [...html.matchAll(/id="(\w+)"[^>]*\shidden/g)].map(m => m[1]);
  ok(hiddenEls.includes('mockBadge'), '#mockBadge starts hidden');
  const cr = await loadText('CREDITS.md').catch(() => '');
  ok(/marian42\/wavefunctioncollapse/.test(cr) && /Gumin/.test(cr), 'CREDITS.md names marian42 and Maxim Gumin');
  ok(/marian42/.test(html) && /Gumin/.test(html), 'the page credits name marian42 and Maxim Gumin');
  ok(!/(from\s+|import\()['"][^'"]*three/.test(main + await loadText('gpu.js')), 'no three.js import in main.js or gpu.js');
}

// ---------------------------------------------------------------------------------
async function bootRun(tag, { pkg, phone }) {
  section(`boot: main.js + saver.js in jsdom (${tag})`);
  let JSDOM;
  try { JSDOM = createRequire(import.meta.url)('jsdom').JSDOM; } catch (e) { skip('jsdom is not on NODE_PATH: the boot checks did not run'); return; }
  const S = gpuStub();
  const dom = new JSDOM(html, { url: 'http://localhost/stella-nova/pages/wfc-city/index.html?seed=31', pretendToBeVisual: false });
  const win = dom.window;
  const raf = [];
  const saved = {};
  const set = (k, v) => { saved[k] = Object.getOwnPropertyDescriptor(globalThis, k); Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); };
  win.matchMedia = q => ({ matches: !!phone && /max-width|coarse/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  win.requestAnimationFrame = cb => { raf.push(cb); return raf.length; };
  win.cancelAnimationFrame = () => {};
  win.HTMLCanvasElement.prototype.getContext = function (k) { return k === 'webgpu' ? S.ctx : null; };
  for (const k of ['clientWidth', 'clientHeight']) Object.defineProperty(win.HTMLElement.prototype, k, { configurable: true, get() { return this.id === 'view' ? (k === 'clientWidth' ? (phone ? 390 : 1280) : (phone ? 780 : 720)) : 0; } });
  win.HTMLCanvasElement.prototype.requestPointerLock = function () { win.document.pointerLockElement = this; };
  set('window', win); set('document', win.document); set('location', win.location); set('history', win.history);
  set('navigator', { gpu: S.gpu, userAgent: 'node' });
  set('matchMedia', win.matchMedia); set('requestAnimationFrame', win.requestAnimationFrame); set('cancelAnimationFrame', win.cancelAnimationFrame);
  set('Event', win.Event); set('CustomEvent', win.CustomEvent); set('KeyboardEvent', win.KeyboardEvent);
  const realFetch = globalThis.fetch;
  set('fetch', async u => { const url = new URL(String(u)); if (url.protocol === 'file:') { const t = await readFile(url, 'utf8'); return { ok: true, status: 200, text: async () => t }; } return realFetch(u); });
  set('__WFC_WASM__', pkg ? wasmBytes : undefined);
  set('__WFC_PKG_BASE__', pkg ? './' : './__no_pkg__/');
  const errs = [];
  const cerr = console.error; console.error = (...a) => { errs.push(a.map(String).join(' ')); };
  try {
    await import(new URL('saver.js?' + tag, here).href);
    await import(new URL('main.js?' + tag, here).href);
    const api = await Promise.race([win.__wfc.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('boot timeout')), 15000))]);
    const doc = win.document;
    ok(!!api && !!api.world, `${tag}: the page boots`);
    ok(api.mock === !pkg, `${tag}: ${pkg ? 'the real pkg is used' : 'the mock is used when pkg/ is missing'}`);
    ok(doc.getElementById('mockBadge').hidden === !!pkg, `${tag}: #mockBadge is ${pkg ? 'hidden' : 'shown'}`);
    ok(doc.getElementById('boot').hidden, `${tag}: the boot line is gone`);
    ok(doc.getElementById('seedInput').value === '31', `${tag}: ?seed=31 sets the seed`);
    let t = 1000;
    // one frame: the rAF callbacks, then the GPU work done (a microtask)
    const run = async n => { for (let i = 0; i < n; i++) { const cbs = raf.splice(0); t += 1000 / 60; for (const cb of cbs) cb(t); S.flush(); await null; await null; } };
    await run(90);
    ok(api.world.counter() > 500, `${tag}: fly-over: the solver collapses slots (${api.world.counter()})`);
    ok(api.renderer.chunkCount > 3, `${tag}: chunks on the GPU (${api.renderer.chunkCount})`);
    ok(S.log.draws > 100, `${tag}: frames draw (${S.log.draws} draws)`);
    ok(api.clock > 0 && api.clock <= api.world.counter(), `${tag}: the display clock runs under the counter`);
    const z0 = api.cam.eye[2];
    await run(60);
    ok(api.cam.eye[2] < z0 - 5, `${tag}: the drone glides forward (z ${z0.toFixed(1)} -> ${api.cam.eye[2].toFixed(1)})`);
    // walk
    doc.querySelector('#modeSeg [data-mode="walk"]').click();
    ok(api.mode === 'walk' && doc.body.classList.contains('mode-walk'), `${tag}: Walk from the mode buttons`);
    await run(120);
    const b = api.body, y0 = b[1], p0 = [b[0], b[2]];
    ok(finite(b) && b[6] === 1, `${tag}: walk: the body stands on the ground (y ${b[1].toFixed(2)})`);
    win.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'KeyW' }));
    await run(60);
    win.dispatchEvent(new win.KeyboardEvent('keyup', { code: 'KeyW' }));
    const moved = Math.hypot(b[0] - p0[0], b[2] - p0[1]);
    ok(moved > 1, `${tag}: W moves the body (${moved.toFixed(2)} m)`);
    win.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Space' }));
    await run(6);
    win.dispatchEvent(new win.KeyboardEvent('keyup', { code: 'Space' }));
    ok(b[1] > y0 + 0.2 || b[4] > 0, `${tag}: Space jumps (y ${y0.toFixed(2)} -> ${b[1].toFixed(2)}, vy ${b[4].toFixed(2)})`);
    await run(90);
    win.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'KeyF' }));
    win.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Space' }));
    const yf = b[1]; await run(60);
    win.dispatchEvent(new win.KeyboardEvent('keyup', { code: 'Space' }));
    ok(b[1] > yf + 1.5, `${tag}: F then Space flies up (a bridge or a walkway can stop it) (${yf.toFixed(1)} -> ${b[1].toFixed(1)})`);
    win.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'KeyF' }));
    // touch stick
    if (phone) {
      ok(doc.body.classList.contains('touch-walk'), `${tag}: the walk pad shows on a touch screen`);
      const st = doc.getElementById('stick');
      const ev = (type, x, y) => { const e = new win.Event(type, { bubbles: true }); e.pointerId = 7; e.clientX = x; e.clientY = y; st.dispatchEvent(e); };
      ev('pointerdown', 0, 0); ev('pointermove', 0, -80);
      ok(api.app.stick[1] < -0.5, `${tag}: the stick reads forward`);
      ev('pointerup', 0, -80);
      ok(api.app.stick[0] === 0 && api.app.stick[1] === 0, `${tag}: the stick lets go`);
    }
    // watch
    doc.querySelector('#dockMode [data-mode="watch"]').click();
    ok(api.mode === 'watch', `${tag}: Watch from the dock`);
    await run(150);
    const cw = api.world.counter();
    ok(cw > 0 && api.clock < cw, `${tag}: watch: the display clock runs behind the solver (${Math.round(api.clock)} of ${cw})`);
    // keys
    win.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Digit2' }));
    ok(api.mode === 'fly', `${tag}: key 2 gives Fly-over`);
    win.dispatchEvent(new win.KeyboardEvent('keyup', { code: 'Digit2' }));
    const seedA = doc.getElementById('seedInput').value;
    doc.getElementById('btnNew').click();
    ok(doc.getElementById('seedInput').value !== seedA, `${tag}: New city takes a new seed`);
    await run(30);
    // saver
    let lab = null;
    const ret = win.snSaver.enter({ seed: 4242, calm: 0.5, label: x => { lab = x; } });
    ok(ret && ret.canvas === doc.getElementById('view') && doc.contains(ret.canvas), `${tag}: snSaver.enter gives the page canvas, in the document`);
    for (let n = 0; n < 100 && !api.app.saver; n++) await new Promise(r => setTimeout(r, 20));
    ok(!!api.app.saver, `${tag}: the director attaches`);
    await run(30 * 60);
    const dbg = win.snSaver.debug();
    ok(dbg && dbg.n >= 3, `${tag}: the saver cuts (${dbg && dbg.n} shots in 30 s, now ${dbg && dbg.key})`);
    ok(lab && lab.title === 'Collapse City', `${tag}: the saver sets the plate label`);
    win.snSaver.cut('flyover'); await run(90);
    ok(win.snSaver.debug().key === 'flyover', `${tag}: snSaver.cut('flyover')`);
    ok(finite(api.cam.eye), `${tag}: saver camera is finite`);
    win.snSaver.exit();
    ok(!api.app.saver && api.mode === 'fly' && !doc.documentElement.classList.contains('wfc-saver'), `${tag}: exit gives the page back in Fly-over`);
    await run(10);
    // release
    win.dispatchEvent(new win.Event('pagehide'));
    ok(S.log.devDestroyed, `${tag}: pagehide destroys the device`);
    const real = errs.filter(e => !/Not implemented/.test(e));
    ok(real.length === 0, `${tag}: no console errors${real.length ? ' — ' + real.slice(0, 3).join(' | ') : ''}`);
  } catch (e) {
    ok(false, `${tag}: boot threw ${e && e.stack || e}`);
  } finally {
    console.error = cerr;
    for (const k of Object.keys(saved)) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
    win.close();
  }
}

await bootRun('mock', { pkg: false, phone: false });
await bootRun('mock-phone', { pkg: false, phone: true });
if (Pkg) await bootRun('pkg', { pkg: true, phone: false });
else { section('boot: pkg'); skip('pkg/ is missing: the page was not booted on the real solver'); }

console.log(`\n${passes} passed, ${fails} failed, ${skips} skipped`);
process.exit(fails ? 1 : 0);
