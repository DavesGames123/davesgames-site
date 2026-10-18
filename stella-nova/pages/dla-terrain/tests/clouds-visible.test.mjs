// ============================================================================
//  DLA TERRAIN  ·  tests/clouds-visible.test.mjs — the clouds that cast a
//  shadow are also drawn (node, a recording mock device, no GPU)
//  Run: node stella-nova/pages/dla-terrain/tests/clouds-visible.test.mjs
// ----------------------------------------------------------------------------
//  Why (2026-10-18, the user, Safari on a Mac): "clouds are casting
//  atmospheric shadows on the ground at a distance. that is the only thing
//  i see of the clouds though". The governor sat at its emergency level,
//  which turned the cloud layer off (frame.layers.clouds false), while
//  render/sky.js still made the cloud shadow map. This test runs the real
//  gpu/frame.js plan (fg.prepare) and the real render/sky.js on a mock
//  device at every governor level, and records the passes: each frame
//  that dispatches csCloudShadow must also dispatch csClouds and draw the
//  cloud composite. It also checks that the march steps follow
//  frame.gov.cloudK and never go under 16.
// ============================================================================
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const page = join(here, '..');
let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log('  ok   clouds-visible: ' + name); }
  catch (e) { fail++; console.log('  FAIL clouds-visible: ' + name + '\n       ' + (e && e.message)); }
}
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
globalThis.GPUBufferUsage = { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };
globalThis.GPUTextureUsage = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };

// a recording mock device: pipelines carry their label, passes record
// what they dispatch and draw
const rec = [];
const obj = (extra = {}) => ({ createView: () => obj(), destroy() {}, ...extra });
const passRec = () => {
  let cur = null;
  return { setPipeline(p) { cur = p.label; }, setBindGroup() {}, dispatchWorkgroups() { rec.push('dispatch:' + cur); }, draw() { rec.push('draw:' + cur); }, end() {} };
};
const device = {
  features: new Set(),
  limits: { maxTextureDimension2D: 8192 },
  createBindGroupLayout: (d) => ({ entries: d.entries }), createPipelineLayout: (d) => ({ groups: d.bindGroupLayouts }),
  createShaderModule: (d) => ({ label: d.label }),
  createComputePipelineAsync: async (d) => ({ label: d.label }),
  createRenderPipelineAsync: async (d) => ({ label: d.label }),
  createBuffer: (d) => obj({ size: d.size }), createTexture: (d) => obj({ size: d.size }), createSampler: () => obj(),
  createBindGroup: (d) => ({ entries: d.entries }),
  createCommandEncoder: () => ({ beginComputePass: () => passRec(), beginRenderPass: () => passRec(), copyTextureToTexture() {}, finish: () => ({}) }),
};
const queue = { writeBuffer() {}, writeTexture() {}, submit() {}, onSubmittedWorkDone: () => new Promise(() => {}) };
device.queue = queue;
const COMMON = readFileSync(join(page, 'shaders/common.wgsl'), 'utf8');
const lay = device.createBindGroupLayout({ entries: [] });
const gpu = {
  device, queue, hdrFormat: 'rgba16float', depthFormat: 'depth32float', globalsLayout: lay, shadowSampleLayout: lay,
  quality: 1, profile: null, qualityIndex: 3, qualityPreset: { scale: 1 }, globalsBindGroup: {},
  loadWGSL: async (f) => COMMON + '\n' + readFileSync(join(page, f), 'utf8'),
  loadRawWGSL: async (f) => readFileSync(join(page, f), 'utf8'),
  context: { getCurrentTexture: () => obj() },
};
const { createSky, SKYU } = await import('../render/sky.js');
const { GLOBALS } = await import('../sky-state.js');
const { createFrameGraph, MAX_LEVEL } = await import('../gpu/frame.js');

const sky = await createSky(gpu);
const sh = { info: { count: 3 }, count: 3, size: 2048, layerViews: [{}, {}, {}], passBindGroups: [{}, {}, {}], sampleBindGroup: {}, resize(s, c) { sh.size = s; sh.count = c; sh.info.count = c; } };
const post = { settings: { taa: true }, resize() {}, run() {}, afterSubmit() {} };
const fg = createFrameGraph(gpu, { terrain: { compute() {} }, post, shadows: sh });
fg.resize(640, 400, 1);

function globals() {
  const g = new Float32Array(GLOBALS.floats + 4);
  g.set([0, 900, 0], GLOBALS.camPos);
  g.set([0.3, 0.6, 0.2, 1], GLOBALS.sunDir);
  g.set([1, 1, 1, 0.45], GLOBALS.sunColor);
  g.set([0.5, 0.5, 0.6, 1], GLOBALS.ambient);
  g.set([0.6, 0, 0, 0], GLOBALS.weather);
  g.set([640, 400, 1 / 640, 1 / 400], GLOBALS.screen);
  g.set([0, 0, 1, 0], GLOBALS.frame);
  g.set([-8000, 8000, 0, 3000], GLOBALS.terrainOrigin);
  return g;
}
const wx = { cover: 0.6, rain: 0, snow: 0, storm: 0.05, fog: 5.5e-5, cumulus: 0.75, cirrus: 0.5, mie: 1.3, wind: 6 };
const ctx = { depthView: obj(), width: 640, height: 400 };

async function frames(level, n) {
  fg.setLevel(level);
  const out = [];
  for (let i = 0; i < n; i++) {
    rec.length = 0;
    const frame = fg.prepare({ globals: globals(), quality: 1, dt: 1 / 60, frameIndex: i, layers: { clouds: true, rain: true, grass: true }, shafts: { mode: 'auto', k: 1 }, weather: { wx, tod: 0.45, season: 0.3 } });
    sky.update(frame);
    const enc = device.createCommandEncoder();
    sky.compute(enc, frame);
    sky.volumetricPrep(enc, frame, ctx);
    sky.drawVolumetric(passRec(), frame, ctx);
    out.push({ ops: rec.slice(), steps: sky._debug.u[SKYU.cloud2 + 3], layers: frame.layers });
  }
  return out;
}

const steps = {};
for (let l = 0; l <= MAX_LEVEL; l++) {
  const fr = await frames(l, 4);
  steps[l] = fr[3].steps;
  await check(`level ${l}: every frame with the cloud shadow also marches and draws the clouds`, () => {
    for (const [i, f] of fr.entries()) {
      if (i === 0) continue;   // the first frame marches in compute, before the depth
      const shadow = f.ops.includes('dispatch:csCloudShadow');
      const march = f.ops.includes('dispatch:csClouds');
      const comp = f.ops.includes('draw:cloud composite');
      assert.ok(!shadow || (march && comp), `frame ${i}: shadow ${shadow} march ${march} composite ${comp} (layers ${JSON.stringify(f.layers)})`);
      assert.ok(shadow, `frame ${i}: no cloud shadow dispatch`);
    }
  });
}
await check('the march steps follow frame.gov.cloudK and stay at 16 or more', () => {
  assert.ok(steps[0] >= steps[1] && steps[1] >= steps[MAX_LEVEL] && steps[MAX_LEVEL] >= 16 && steps[0] > steps[MAX_LEVEL], JSON.stringify(steps));
});
console.log('# cloud march steps by governor level: ' + JSON.stringify(steps));
console.log(`clouds-visible: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
