#!/usr/bin/env node
// ============================================================================
//  dla-terrain-check.mjs  ·  checks for lib/dla-terrain.js and its twins
// ----------------------------------------------------------------------------
//  node stella-nova/tools/dla-terrain-check.mjs [--quick] [--png DIR] [--n N]
//  deno run -A stella-nova/tools/dla-terrain-check.mjs --gpu
//
//  CPU checks (node):
//    api        BIOMES (16, contract keys), OPTIONS groups, PRESETS ids
//    stages     progress stage order, snapshot shapes, frac rises
//    determin.  the same seed gives the same bytes; another seed does not
//    sanity     no NaN; land fraction near the sea fraction; relief; rivers
//    rivers     every river polyline runs downhill (texel heights along the
//               path) and ends at the sea, a lake, the edge or a join
//    presets    every preset at n 512
//    random     30 random worlds (randomOptions) at n 256
//    detail     detailHeight has no seams across texel edges
//    worker     the worker protocol with a fake self (progress ... done)
//    wgsl       naga validates lib/dla-terrain-detail.wgsl after a stub of
//               the contract's common.wgsl (~/.cargo/bin/naga)
//    timing     n 1024 default (and n 2048 without --quick)
//  GPU check (deno, navigator.gpu): detailHeight in WGSL against the JS at
//  sample points on a generated terrain.
//  --png DIR writes hillshade + biome + river previews of each preset.
//
//  Exit code 1 when a check fails. Prints the real numbers.
//
//  grep -n targets: "const COMMON_STUB", "function check", "async function gpuCompare",
//  "function renderPreview", "function writePNG"
// ============================================================================

import { BIOMES, OPTIONS, PRESETS, OPTION_GROUPS, STAGE_IDS, defaults, randomOptions, generateTerrain,
  detailHeight, sampleHeight, normalizeOptions } from '../lib/dla-terrain.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(HERE, '..', 'lib');
const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const QUICK = flag('--quick'), GPU = flag('--gpu'), PNG = arg('--png', null);
const isDeno = typeof globalThis.Deno !== 'undefined';

let fails = 0, passes = 0;
function check(name, ok, info = '') {
  if (ok) passes++; else fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`);
}
const t0 = performance.now();
const ms = (t) => `${Math.round(performance.now() - t)} ms`;

function hashArrays(t) {
  let h = 2166136261 >>> 0;
  for (const k of ['height', 'river', 'water', 'moisture', 'biome']) {
    const b = new Uint8Array(t[k].buffer, t[k].byteOffset, t[k].byteLength);
    for (let i = 0; i < b.length; i += 7) { h ^= b[i]; h = Math.imul(h, 16777619) >>> 0; }
  }
  return h.toString(16);
}
function hasNaN(t) {
  for (const k of ['height', 'flow', 'river', 'water', 'moisture', 'temperature', 'sediment', 'channel']) {
    const a = t[k];
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return k;
  }
  for (const r of t.rivers) for (const a of [r.pts, r.width, r.flow]) for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return 'rivers';
  return null;
}
// Height of the texel nearest to a world point.
function texelH(t, x, z) {
  const n = t.n, i = Math.min(n - 1, Math.max(0, Math.floor((x - t.origin) / t.texel)));
  const j = Math.min(n - 1, Math.max(0, Math.floor((z - t.origin) / t.texel)));
  return t.height[j * n + i];
}
// Rivers: rises along the path, and how they end.
function riverStats(t) {
  let segs = 0, rises = 0, maxRise = 0, bilRises = 0;
  const ends = { sea: 0, lake: 0, edge: 0, join: 0 };
  for (const r of t.rivers) {
    ends[r.end] = (ends[r.end] || 0) + 1;
    const L = r.pts.length / 2;
    let prev = Infinity, prevB = Infinity;
    for (let k = 0; k < L; k++) {
      // the raw path is texel centres; the smoothing moves a point under half a texel
      const h = t.height[r.cells[k]];
      const hb = sampleHeight(t, r.pts[k * 2], r.pts[k * 2 + 1]);
      if (k > 0) {
        segs++;
        if (h > prev + 0.5) { rises++; maxRise = Math.max(maxRise, h - prev); }
        if (hb > prevB + 2) bilRises++;
      }
      prev = Math.min(prev, h); prevB = Math.min(prevB, hb);
    }
  }
  return { segs, rises, maxRise, bilRises, ends };
}
function sanity(t, o, label) {
  const st = t.stats, bad = hasNaN(t);
  const relief = st.maxHeight - Math.max(st.minHeight, st.seaLevel);
  const biomes = st.biomeFractions.filter((f) => f > 0.005).length;
  const wantLand = 1 - o.seaFraction;
  const landOk = o.seaFraction > 0.005 ? Math.abs(st.landFraction - wantLand) < 0.12 : st.landFraction > 0.97;
  const reliefOk = relief > 0.35 * o.heightScale;
  // a flat world: most land in a thin height band
  let flat = 0, land = 0;
  for (let i = 0; i < t.height.length; i += 3) if (t.height[i] >= st.seaLevel) { land++; if (t.height[i] - st.seaLevel < 0.02 * o.heightScale) flat++; }
  const flatFrac = land ? flat / land : 1;
  const rs = riverStats(t);
  const ok = !bad && landOk && reliefOk && biomes >= 3 && flatFrac < 0.6 && rs.rises === 0 && (o.rainfall < 0.15 || st.riverCount > 0);
  return { ok, info: `${label}: land ${st.landFraction.toFixed(2)} (want ${wantLand.toFixed(2)}) relief ${relief.toFixed(0)} m of ${o.heightScale} flat ${(flatFrac * 100).toFixed(0)}% biomes ${biomes} rivers ${st.riverCount} (${st.riverLengthKm.toFixed(0)} km, rises ${rs.rises}) lakes ${st.lakeCount}${bad ? ' NaN in ' + bad : ''} ${st.ms} ms` };
}

// ── PNG preview ────────────────────────────────────────────────────────
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc(b) { let c = -1; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function writePNG(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
// Hillshade (sun from the north-west) times the biome colour, sea by
// depth, rivers and lakes in blue.
function renderPreview(t, s) {
  const n = t.n, k = n / s, out = new Uint8Array(s * s * 3), H = t.height, tex = t.texel * k;
  const L = [-0.55, 0.62, -0.55], ll = Math.hypot(...L);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const ix = Math.min(n - 1 - Math.ceil(k), Math.max(Math.ceil(k), Math.floor((x + 0.5) * k)));
    const iy = Math.min(n - 1 - Math.ceil(k), Math.max(Math.ceil(k), Math.floor((y + 0.5) * k)));
    const i = iy * n + ix, kk = Math.max(1, Math.round(k));
    const gx = (H[i + kk] - H[i - kk]) / (2 * t.texel * kk), gz = (H[i + kk * n] - H[i - kk * n]) / (2 * t.texel * kk);
    const nl = Math.hypot(gx, 1, gz);
    const sh = 0.3 + 0.95 * Math.max(0, (-gx * L[0] + L[1] - gz * L[2]) / (nl * ll));
    let c = BIOMES[t.biome[i]].color, r = c[0] * sh, g = c[1] * sh, b = c[2] * sh;
    if (H[i] < t.seaLevel) {
      const d = Math.min(1, (t.seaLevel - H[i]) / (0.12 * t.heightScale));
      r = 0.16 - 0.1 * d; g = 0.4 - 0.24 * d; b = 0.55 - 0.22 * d; r *= 0.7 + 0.3 * sh; g *= 0.7 + 0.3 * sh; b *= 0.7 + 0.3 * sh;
    } else if (t.water[i] > 0.3 && t.biome[i] === 13) { r = 0.2; g = 0.42; b = 0.6; }
    if (t.river[i] > 0.4 && H[i] >= t.seaLevel) { r = 0.22; g = 0.45; b = 0.72; }
    const j = (y * s + x) * 3;
    out[j] = Math.min(255, r * 255); out[j + 1] = Math.min(255, g * 255); out[j + 2] = Math.min(255, b * 255);
  }
  for (const rv of t.rivers) {
    const L2 = rv.pts.length / 2;
    for (let p = 0; p < L2; p++) {
      const x = Math.floor((rv.pts[p * 2] - t.origin) / t.worldSize * s), y = Math.floor((rv.pts[p * 2 + 1] - t.origin) / t.worldSize * s);
      if (x < 0 || y < 0 || x >= s || y >= s) continue;
      const j = (y * s + x) * 3, w = Math.min(1, rv.width[p] / (t.worldSize / s) + 0.35);
      out[j] = out[j] * (1 - w) + 50 * w; out[j + 1] = out[j + 1] * (1 - w) + 115 * w; out[j + 2] = out[j + 2] * (1 - w) + 200 * w;
    }
  }
  return out;
}

// ── WGSL ───────────────────────────────────────────────────────────────
// The contract's common.wgsl bindings (pages/dla-terrain/CONTRACT.md).
const COMMON_STUB = `
struct Globals {
  viewProj: mat4x4f, invViewProj: mat4x4f, view: mat4x4f, proj: mat4x4f,
  prevViewProj: mat4x4f,
  camPos: vec4f, sunDir: vec4f, sunColor: vec4f, moonDir: vec4f, ambient: vec4f, fog: vec4f,
  wind: vec4f, weather: vec4f, weather2: vec4f, terrain: vec4f, terrainOrigin: vec4f, screen: vec4f, frame: vec4f,
};
@group(0) @binding(0) var<uniform> G: Globals;
@group(0) @binding(1) var tHeight: texture_2d<f32>;
@group(0) @binding(2) var tNormal: texture_2d<f32>;
@group(0) @binding(3) var tAux: texture_2d<f32>;
@group(0) @binding(4) var tBiome: texture_2d<u32>;
@group(0) @binding(5) var sLinear: sampler;
`;
const PROBE = `
@group(1) @binding(0) var<storage, read> probePts: array<vec2f>;
@group(1) @binding(1) var<storage, read_write> probeOut: array<f32>;
@compute @workgroup_size(64)
fn probeMain(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&probePts)) { return; }
  probeOut[id.x] = detailHeight(probePts[id.x]);
}
`;
function wgslSource() { return COMMON_STUB + fs.readFileSync(path.join(LIB, 'dla-terrain-detail.wgsl'), 'utf8') + PROBE; }

function f32ToF16(v) {
  const f = new Float32Array([v]), u = new Uint32Array(f.buffer)[0];
  const s = (u >>> 16) & 0x8000, e = ((u >>> 23) & 0xff) - 112, m = u & 0x7fffff;
  if (e <= 0) return s;
  if (e >= 31) return s | 0x7c00;
  return s | (e << 10) | ((m + 0x1000) >>> 13);
}
function f16ToF32(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >>> 10) & 31, m = h & 1023;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

async function gpuCompare() {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const t = await generateTerrain({ ...PRESETS.alpine.opts, n: 256, worldSize: 24000 });
  const n = t.n;
  // the GPU sees river and water as f16: quantise the JS copy the same way
  const aux = new Uint16Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    aux[i * 4] = f32ToF16(Math.log1p(t.flow[i])); aux[i * 4 + 1] = f32ToF16(t.river[i]);
    aux[i * 4 + 2] = f32ToF16(t.moisture[i]); aux[i * 4 + 3] = f32ToF16(t.water[i]);
    t.river[i] = f16ToF32(aux[i * 4 + 1]); t.water[i] = f16ToF32(aux[i * 4 + 3]);
  }
  const mod = device.createShaderModule({ code: wgslSource() });
  const info = await mod.getCompilationInfo();
  for (const m of info.messages) console.log('  wgsl', m.type, m.lineNum, m.message);
  const pipe = device.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'probeMain' } });
  const G = new Float32Array(132);
  // Globals: 5 mat4 (80 floats) then vec4s: camPos 80, sunDir 84, sunColor 88, moonDir 92,
  // ambient 96, fog 100, wind 104, weather 108, weather2 112, terrain 116, terrainOrigin 120
  G.set([t.worldSize, t.heightScale, t.seaLevel, t.texel], 116);
  G.set([t.origin, t.origin, t.stats.minHeight, t.stats.maxHeight], 120);
  const ub = device.createBuffer({ size: G.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(ub, 0, G);
  const th = device.createTexture({ size: [n, n], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: th }, t.height, { bytesPerRow: n * 4 }, [n, n]);
  const ta = device.createTexture({ size: [n, n], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: ta }, aux, { bytesPerRow: n * 8 }, [n, n]);
  // sample points: random, texel edges, corners, steep ground, rivers
  const pts = [];
  let s = 12345;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let k = 0; k < 2000; k++) pts.push(t.origin + rnd() * t.worldSize, t.origin + rnd() * t.worldSize);
  for (let k = 0; k < 200; k++) { const i = Math.floor(rnd() * n), j = Math.floor(rnd() * n); pts.push(t.origin + i * t.texel + 1e-3, t.origin + j * t.texel + 1e-3); }
  for (const r of t.rivers.slice(0, 20)) for (let k = 0; k < r.pts.length; k += 2) pts.push(r.pts[k], r.pts[k + 1]);
  pts.push(t.origin, t.origin, -t.origin, -t.origin, t.origin - 50, 0);
  const P = new Float32Array(pts);
  const np = P.length / 2;
  const pb = device.createBuffer({ size: P.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(pb, 0, P);
  const ob = device.createBuffer({ size: np * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const rb = device.createBuffer({ size: np * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const bg0 = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: ub } }, { binding: 1, resource: th.createView() }, { binding: 3, resource: ta.createView() }] });
  const bg1 = device.createBindGroup({ layout: pipe.getBindGroupLayout(1), entries: [
    { binding: 0, resource: { buffer: pb } }, { binding: 1, resource: { buffer: ob } }] });
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipe); pass.setBindGroup(0, bg0); pass.setBindGroup(1, bg1);
  pass.dispatchWorkgroups(Math.ceil(np / 64)); pass.end();
  enc.copyBufferToBuffer(ob, 0, rb, 0, np * 4);
  device.queue.submit([enc.finish()]);
  await rb.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(rb.getMappedRange().slice(0));
  let maxErr = 0, maxAbs = 0, worst = -1;
  for (let k = 0; k < np; k++) {
    const js = detailHeight(P[k * 2], P[k * 2 + 1], t);
    const e = Math.abs(js - out[k]);
    if (e > maxErr) { maxErr = e; worst = k; }
    maxAbs = Math.max(maxAbs, Math.abs(js));
  }
  check('gpu detailHeight WGSL = JS', maxErr < 0.01 + 1e-3 * maxAbs,
    `${np} points, max |WGSL - JS| ${maxErr.toExponential(2)} m, max |detail| ${maxAbs.toFixed(2)} m, texel ${t.texel.toFixed(1)} m${worst >= 0 ? `, worst at (${P[worst * 2].toFixed(1)}, ${P[worst * 2 + 1].toFixed(1)})` : ''}`);
}

// ── main ───────────────────────────────────────────────────────────────
if (GPU) {
  if (!isDeno || !globalThis.navigator?.gpu) { console.log('FAIL  --gpu needs deno run -A (navigator.gpu)'); process.exit(1); }
  await gpuCompare();
  console.log(`\n${passes} passed, ${fails} failed, ${ms(t0)}`);
  process.exit(fails ? 1 : 0);
}

// api
{
  const keys = ['ocean', 'beach', 'desert', 'savanna', 'grassland', 'temperate-forest', 'rainforest', 'boreal-forest', 'tundra',
    'bare-rock', 'snow', 'wetland', 'river', 'lake', 'scree', 'alpine-meadow'];
  check('api BIOMES', BIOMES.length === 16 && BIOMES.every((b, i) => b.id === i && b.key === keys[i] && b.name && b.color.length === 3),
    `${BIOMES.length} biomes`);
  const groups = new Set(OPTIONS.map((o) => o.group));
  const okOpt = OPTIONS.every((o) => o.key && o.label && OPTION_GROUPS.includes(o.group) && ['range', 'select', 'bool'].includes(o.type)
    && (o.type !== 'range' || (o.min <= o.def && o.def <= o.max && o.step > 0)) && (o.type !== 'select' || o.choices.includes(o.def)));
  check('api OPTIONS', okOpt && OPTION_GROUPS.every((g) => groups.has(g)), `${OPTIONS.length} options in ${groups.size} groups`);
  const need = ['alpine', 'archipelago', 'canyonlands', 'river-delta', 'fjords', 'volcanic-isles', 'highlands', 'mesa-desert', 'rift-valley'];
  const presetKeysOk = Object.values(PRESETS).every((p) => p.label && Object.keys(p.opts).every((k) => OPTIONS.some((o) => o.key === k)));
  check('api PRESETS', need.every((k) => PRESETS[k]) && presetKeysOk, `${Object.keys(PRESETS).length} presets: ${Object.keys(PRESETS).join(', ')}`);
  const d = defaults(), r1 = randomOptions(5, d), r2 = randomOptions(5, d), r3 = randomOptions(6, d), rg = randomOptions(9, d, 'Climate');
  const onlyClimate = OPTIONS.every((o) => o.group === 'Climate' || JSON.stringify(rg[o.key]) === JSON.stringify(d[o.key]));
  check('api randomOptions', JSON.stringify(r1) === JSON.stringify(r2) && JSON.stringify(r1) !== JSON.stringify(r3) && onlyClimate,
    'same seed same dice, group dice keeps other groups');
  const nz = normalizeOptions({ n: '512', stickiness: 9, mask: 'nope' });
  check('api normalizeOptions', nz.n === 512 && nz.stickiness === 1 && nz.mask === d.mask, 'clamps and checks');
}

// stages, snapshots, determinism
{
  const events = [];
  const tt = performance.now();
  const a = await generateTerrain({ seed: 7, n: 256 }, (p) => { events.push(p); });
  const order = [...new Set(events.map((e) => e.stage))];
  const fracUp = events.every((e, i) => i === 0 || e.frac >= events[i - 1].frac - 1e-9);
  const snapOk = events.every((e) => !e.snapshot || (e.snapshot.height instanceof Float32Array && e.snapshot.height.length === e.snapshot.n * e.snapshot.n));
  check('stages order', JSON.stringify(order) === JSON.stringify(STAGE_IDS) && JSON.stringify(a.stages.map((s) => s.id)) === JSON.stringify(STAGE_IDS),
    `${order.join(' > ')}; ${events.length} events`);
  check('stages frac and snapshots', fracUp && snapOk && events.at(-1).frac === 1, `snapshots ${events.filter((e) => e.snapshot).length}, n ${[...new Set(events.map((e) => e.snapshot?.n).filter(Boolean))].join('/')}`);
  const b = await generateTerrain({ seed: 7, n: 256 });
  const c = await generateTerrain({ seed: 8, n: 256 });
  check('determinism', hashArrays(a) === hashArrays(b) && hashArrays(a) !== hashArrays(c), `seed 7 ${hashArrays(a)} twice, seed 8 ${hashArrays(c)} (${ms(tt)})`);
  const shapes = ['height', 'flow', 'river', 'water', 'moisture', 'temperature', 'sediment', 'biome'].every((k) => a[k].length === a.n * a.n);
  check('terrain shape', shapes && a.dla.count > 0 && a.dla.pos.length === a.dla.count * 2 && a.ridges.length > 0 && a.biome instanceof Uint8Array,
    `rivers ${a.rivers.length}, lakes ${a.lakes.length}, ridges ${a.ridges.length}, dla ${a.dla.count}`);
}

// detail: no seams across texel edges, zero under water
{
  const t = await generateTerrain({ ...PRESETS.alpine.opts, n: 256 });
  let maxJump = 0, maxD = 0;
  for (let k = 0; k < 4000; k++) {
    const i = 2 + (k * 37) % (t.n - 4), j = 2 + (k * 91) % (t.n - 4);
    const x = t.origin + (i + 0.5) * t.texel + (k % 2 ? t.texel * 0.5 : 0), z = t.origin + (j + 0.5) * t.texel + (k % 2 ? 0 : t.texel * 0.5);
    const e = 1e-4;
    const a = detailHeight(x - e, z - e, t), b = detailHeight(x + e, z + e, t);
    maxJump = Math.max(maxJump, Math.abs(a - b)); maxD = Math.max(maxD, Math.abs(a));
  }
  let wet = 0, wetMax = 0;
  for (let i = 0; i < t.n * t.n; i += 11) if (t.water[i] > 2 && t.river[i] > 0.7) {
    const x = t.origin + ((i % t.n) + 0.5) * t.texel, z = t.origin + (((i / t.n) | 0) + 0.5) * t.texel;
    wet++; wetMax = Math.max(wetMax, Math.abs(detailHeight(x, z, t)));
  }
  check('detail seams', maxJump < 0.02 && maxD > 0.2, `max jump over texel edges ${maxJump.toExponential(2)} m, max detail ${maxD.toFixed(2)} m (texel ${t.texel.toFixed(1)} m)`);
  check('detail flat under water', wetMax < 1e-6, `${wet} wet river texels, max |detail| ${wetMax}`);
}

// worker protocol with a fake self
{
  const msgs = [];
  globalThis.self = { postMessage: (m, tr) => msgs.push({ m, tr: tr ? tr.length : 0 }) };
  await import('../lib/dla-terrain-worker.js');
  await new Promise((res) => {
    const iv = setInterval(() => { if (msgs.some((x) => x.m.type === 'done' || x.m.type === 'error')) { clearInterval(iv); res(); } }, 20);
    globalThis.self.onmessage({ data: { type: 'generate', id: 3, opts: { n: 256, seed: 2 } } });
  });
  const prog = msgs.filter((x) => x.m.type === 'progress'), done = msgs.find((x) => x.m.type === 'done');
  check('worker protocol', prog.length > 5 && done && done.m.id === 3 && done.tr > 8 && prog.every((x) => x.m.id === 3),
    `${prog.length} progress, done with ${done ? done.tr : 0} transferred buffers`);
  msgs.length = 0;
  await new Promise((res) => {
    const iv = setInterval(() => { if (msgs.some((x) => x.m.type === 'done' || x.m.type === 'error')) { clearInterval(iv); res(); } }, 5);
    globalThis.self.onmessage({ data: { type: 'generate', id: 4, opts: { n: 256, seed: 3 } } });
    setTimeout(() => globalThis.self.onmessage({ data: { type: 'cancel', id: 4 } }), 0);
  });
  const er = msgs.find((x) => x.m.type === 'error');
  check('worker cancel', er && er.m.message === 'cancelled' && er.m.id === 4, er ? `error '${er.m.message}' after ${msgs.length - 1} progress` : 'no error');
}

// wgsl syntax (naga)
{
  const naga = path.join(os.homedir(), '.cargo', 'bin', 'naga');
  if (fs.existsSync(naga)) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlat-'));
    const f = path.join(dir, 'detail.wgsl');
    fs.writeFileSync(f, wgslSource());
    let out = '', ok = true;
    try { out = execFileSync(naga, [f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { ok = false; out = String(e.stderr || e.message); }
    fs.rmSync(dir, { recursive: true, force: true });
    check('wgsl naga', ok, ok ? 'common stub + detail + probe validate' : out.slice(0, 400));
  } else check('wgsl naga', false, 'naga not found at ~/.cargo/bin/naga');
}

// presets at n 512 (and previews)
if (PNG) fs.mkdirSync(PNG, { recursive: true });
{
  for (const [id, p] of Object.entries(PRESETS)) {
    const o = normalizeOptions({ ...p.opts, n: QUICK ? 256 : 512 });
    const t = await generateTerrain(o);
    const s = sanity(t, o, id);
    const rs = riverStats(t);
    check(`preset ${id}`, s.ok, s.info + ` ends ${JSON.stringify(rs.ends)}`);
    if (PNG) writePNG(path.join(PNG, `preset-${id}.png`), t.n, t.n, renderPreview(t, t.n));
  }
}

// random worlds
{
  const N = QUICK ? 10 : 30;
  let okc = 0;
  const bad = [];
  const tt = performance.now();
  for (let s = 1; s <= N; s++) {
    const o = normalizeOptions({ ...randomOptions(s * 7919, defaults()), n: 256 });
    const t = await generateTerrain(o);
    const r = sanity(t, o, `random ${s}`);
    if (r.ok) okc++; else bad.push(r.info);
    if (PNG && s <= 12) writePNG(path.join(PNG, `random-${s}.png`), 256, 256, renderPreview(t, 256));
  }
  for (const b of bad) console.log('      ' + b);
  check('random worlds', okc === N, `${okc} of ${N} sane at n 256 (${ms(tt)})`);
}

// rivers on a big map, timing
{
  const sizes = QUICK ? [1024] : [1024, 2048];
  for (const n of sizes) {
    const tt = performance.now();
    const t = await generateTerrain({ n });
    const total = performance.now() - tt;
    const rs = riverStats(t);
    check(`timing n ${n}`, n === 1024 ? total < 6000 : total < 30000, `${Math.round(total)} ms: ${t.stages.map((s) => `${s.id} ${s.ms}`).join(', ')}`);
    check(`rivers downhill n ${n}`, rs.rises === 0, `${t.rivers.length} rivers, ${rs.segs} segments, ${rs.rises} texel rises > 0.5 m (max ${rs.maxRise.toFixed(2)}), ${rs.bilRises} bilinear rises > 2 m, ends ${JSON.stringify(rs.ends)}`);
    if (PNG) writePNG(path.join(PNG, `default-${n}.png`), 1024, 1024, renderPreview(t, 1024));
  }
}

console.log(`\n${passes} passed, ${fails} failed, ${ms(t0)}`);
process.exit(fails ? 1 : 0);
