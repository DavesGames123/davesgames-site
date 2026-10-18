// ============================================================================
//  DLA TERRAIN  ·  tests/skylimits.test.mjs — SKY pipeline layouts against
//  the WebGPU default limits (node only, a recording mock device, no GPU).
//  Run: node pages/dla-terrain/tests/skylimits.test.mjs
// ----------------------------------------------------------------------------
//  Why: a compute pipeline of the light shafts had 17 sampled textures in
//  one stage (the limit is 16 on Chrome, Safari and Deno on a Mac). Pipeline
//  creation failed, so the whole SKY module did not load and the page drew
//  the fallback sky: a flat gradient, a square sun and no clouds. This test
//  makes createSky with a mock device that records every bind group layout
//  and pipeline layout, then counts each binding kind per shader stage.
//  Limits: the WebGPU defaults (a phone asks for no more).
// ============================================================================
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const page = join(here, '..');
let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log('  ok   skylimits: ' + name); }
  catch (e) { fail++; console.log('  FAIL skylimits: ' + name + '\n       ' + (e && e.message)); }
}

const STAGE = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
globalThis.GPUShaderStage = STAGE;
globalThis.GPUBufferUsage = { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };
globalThis.GPUTextureUsage = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
const LIMITS = { maxSampledTexturesPerShaderStage: 16, maxSamplersPerShaderStage: 16, maxStorageTexturesPerShaderStage: 4, maxStorageBuffersPerShaderStage: 8, maxUniformBuffersPerShaderStage: 12, maxBindGroups: 4 };

const pipes = [];
const obj = (extra = {}) => ({ createView: () => obj(), destroy() {}, ...extra });
const device = {
  createBindGroupLayout: (d) => ({ entries: d.entries, label: d.label }),
  createPipelineLayout: (d) => ({ groups: d.bindGroupLayouts }),
  createShaderModule: (d) => ({ code: d.code, label: d.label }),
  createComputePipelineAsync: async (d) => { pipes.push({ label: d.label, stages: [STAGE.COMPUTE], layout: d.layout }); return obj(); },
  createRenderPipelineAsync: async (d) => { pipes.push({ label: d.label, stages: [STAGE.VERTEX, STAGE.FRAGMENT], layout: d.layout }); return obj(); },
  createBuffer: (d) => obj({ size: d.size }),
  createTexture: (d) => obj({ size: d.size }),
  createSampler: () => obj(),
  createBindGroup: (d) => ({ layout: d.layout, entries: d.entries }),
};
const queue = { writeBuffer() {}, writeTexture() {} };
const ALL = 7;
const globalsLayout = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: ALL, buffer: { type: 'uniform' } },
  { binding: 1, visibility: ALL, texture: {} }, { binding: 2, visibility: ALL, texture: {} },
  { binding: 3, visibility: ALL, texture: {} }, { binding: 4, visibility: ALL, texture: {} },
  { binding: 5, visibility: ALL, sampler: {} }] });
const shadowSampleLayout = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: ALL, texture: { sampleType: 'depth', viewDimension: '2d-array' } },
  { binding: 1, visibility: ALL, sampler: { type: 'comparison' } },
  { binding: 2, visibility: ALL, buffer: { type: 'uniform' } }] });
const COMMON = readFileSync(join(page, 'shaders/common.wgsl'), 'utf8');
const gpu = {
  device, queue, hdrFormat: 'rgba16float', depthFormat: 'depth32float', globalsLayout, shadowSampleLayout,
  quality: 1, profile: null,
  loadWGSL: async (f) => COMMON + '\n' + readFileSync(join(page, f), 'utf8'),
  loadRawWGSL: async (f) => readFileSync(join(page, f), 'utf8'),
};

function count(layout, stage) {
  const c = { sampled: 0, samplers: 0, storageTex: 0, storageBuf: 0, uniform: 0 };
  for (const g of layout.groups) {
    for (const e of g.entries) {
      if (!(e.visibility & stage)) continue;
      if (e.texture) c.sampled++;
      else if (e.sampler) c.samplers++;
      else if (e.storageTexture) c.storageTex++;
      else if (e.buffer && (e.buffer.type === 'storage' || e.buffer.type === 'read-only-storage')) c.storageBuf++;
      else if (e.buffer) c.uniform++;
    }
  }
  return c;
}

const { createSky } = await import('../render/sky.js');
let sky = null;
await check('createSky builds every pipeline on the mock device', async () => {
  sky = await createSky(gpu);
  assert.ok(sky && pipes.length >= 15, 'pipelines ' + pipes.length);
});

await check('no SKY pipeline is over a WebGPU default limit in any stage', () => {
  const bad = [];
  for (const p of pipes) {
    if (p.layout.groups.length > LIMITS.maxBindGroups) bad.push(p.label + ' groups ' + p.layout.groups.length);
    for (const s of p.stages) {
      const c = count(p.layout, s);
      if (c.sampled > LIMITS.maxSampledTexturesPerShaderStage) bad.push(`${p.label} stage ${s} sampled ${c.sampled}`);
      if (c.samplers > LIMITS.maxSamplersPerShaderStage) bad.push(`${p.label} stage ${s} samplers ${c.samplers}`);
      if (c.storageTex > LIMITS.maxStorageTexturesPerShaderStage) bad.push(`${p.label} stage ${s} storage textures ${c.storageTex}`);
      if (c.storageBuf > LIMITS.maxStorageBuffersPerShaderStage) bad.push(`${p.label} stage ${s} storage buffers ${c.storageBuf}`);
    }
  }
  assert.equal(bad.length, 0, bad.join('; '));
});

await check('the shaft passes use the small group 1 (no noise, no weather model)', () => {
  const sh = pipes.filter((p) => /Shaft/.test(p.label));
  assert.equal(sh.length, 3, 'shaft pipelines ' + sh.length);
  for (const p of sh) {
    const b = p.layout.groups[1].entries.map((e) => e.binding);
    for (const no of [6, 7, 9, 16]) assert.ok(!b.includes(no), p.label + ' has binding ' + no);
  }
});

console.log(`skylimits: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
