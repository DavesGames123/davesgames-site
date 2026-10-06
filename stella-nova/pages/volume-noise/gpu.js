// ============================================================================
//  VOLUME NOISE  ·  gpu.js — device, noise textures, view pipelines, readback
// ----------------------------------------------------------------------------
//  This module owns every WebGPU object of the page. It has no DOM code
//  except the canvas context. main.js calls it; saver.js does not.
//
//  TEXTURES  (all rgba8unorm, written by shaders/gen.wgsl)
//    shape ..... res^3 (32, 64 or 128; main.cpp uses 128)  PerlinWorley + Worley FBM
//    parts ..... res^3  the parts of shape R, and the packed shape in A
//    detail .... 32^3   Worley FBM erosion, packed detail in A
//    weather ... 256^2  this page's coverage and cloud type map
//
//  GENERATION. generate(prm) uploads the hash table (noise-ref.js
//  hashTable) and the GenParams uniform, then dispatches gen_shape in slabs
//  of SLAB z slices, one submit per slab. A long single dispatch can trip
//  the GPU watchdog on a slow device.
//
//  RENDER. One uniform buffer of UNI_FLOATS floats (shaders/common.wgsl
//  struct Uni). One pipeline per view: slice, tiles, volume (views.wgsl).
//  All use one explicit bind group layout.
//
//  grep -n: "export async function createGPU"  "async generate"  "render("
//           "async readTexture"  "export const CHANNELS"
// ============================================================================
import { hashTable, perlinW, TABLE_LEN, RECIPE } from './noise-ref.js';

/** Channel list: index = u.view.x in the shaders. tex is the texture readTexture takes. */
export const CHANNELS = [
  { id: 'shape.r', tex: 'shape', c: 0, name: 'Perlin-Worley', note: 'shape R: Perlin FBM remapped between the Worley FBM and 1' },
  { id: 'shape.g', tex: 'shape', c: 1, name: 'Worley FBM 0', note: 'shape G: Worley at 8, 16, 32 cells' },
  { id: 'shape.b', tex: 'shape', c: 2, name: 'Worley FBM 1', note: 'shape B: Worley at 16, 32, 64 cells' },
  { id: 'shape.a', tex: 'shape', c: 3, name: 'Worley FBM 2', note: 'shape A: Worley at 32, 64 cells' },
  { id: 'parts.r', tex: 'parts', c: 0, name: 'Perlin FBM', note: 'periodic Perlin, 3 octaves from frequency 8' },
  { id: 'parts.g', tex: 'parts', c: 1, name: 'PW Worley FBM', note: 'Worley at 8, 32, 56 cells: the floor of R' },
  { id: 'parts.b', tex: 'parts', c: 2, name: 'Worley', note: 'one tileable Worley octave, 4 cells' },
  { id: 'parts.a', tex: 'parts', c: 3, name: 'Shape packed', note: 'R cut by the low-frequency FBM of G, B, A' },
  { id: 'detail.r', tex: 'detail', c: 0, name: 'Detail FBM 0', note: 'erosion R: Worley at 2, 4, 8 cells' },
  { id: 'detail.g', tex: 'detail', c: 1, name: 'Detail FBM 1', note: 'erosion G: Worley at 4, 8, 16 cells' },
  { id: 'detail.b', tex: 'detail', c: 2, name: 'Detail FBM 2', note: 'erosion B: Worley at 8, 16 cells' },
  { id: 'detail.a', tex: 'detail', c: 3, name: 'Detail packed', note: 'erosion packed: the three FBMs summed' },
];

/** Start values of the cube threshold per channel; main.js replaces them with the 72nd percentile after each generation. */
export const CUBE_THR = [0.62, 0.7, 0.74, 0.78, 0.52, 0.74, 0.72, 0.8, 0.62, 0.68, 0.72, 0.62];

export const UNI_FLOATS = 13 * 4;
const SLAB = 16;
const WEATHER_RES = 256;

async function loadText(name) {
  const r = await fetch(new URL('./shaders/' + name, import.meta.url));
  if (!r.ok) throw new Error('shader ' + name + ': HTTP ' + r.status);
  return r.text();
}

async function checkModule(device, mod, label) {
  if (!mod.getCompilationInfo) return;
  const info = await mod.getCompilationInfo();
  const errs = info.messages.filter(m => m.type === 'error');
  if (errs.length) throw new Error(label + ': ' + errs.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('; '));
}

export async function createGPU(canvas) {
  if (!navigator.gpu) throw new Error('no-webgpu');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no-webgpu');
  const device = await adapter.requestDevice();
  const ctx = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });
  const src = {};
  for (const n of ['noise', 'gen', 'common', 'views']) src[n] = await loadText(n + '.wgsl');
  const errors = [];
  device.addEventListener('uncapturederror', e => { errors.push(String(e.error && e.error.message || e.error)); console.error('WebGPU:', e.error && e.error.message); });
  const g = new VolumeGPU(device, ctx, format, src);
  g.errors = errors;
  await g.build();
  return g;
}

class VolumeGPU {
  constructor(device, ctx, format, src) {
    this.device = device; this.ctx = ctx; this.format = format; this.src = src;
    this.res = 0; this.tex = {}; this.genMs = 0; this.generating = null;
    this.uni = new Float32Array(UNI_FLOATS);
  }

  async build() {
    const d = this.device;
    const genMod = d.createShaderModule({ label: 'gen', code: this.src.noise + '\n' + this.src.gen });
    const viewMod = d.createShaderModule({ label: 'views', code: this.src.common + '\n' + this.src.views });
    await checkModule(d, genMod, 'gen.wgsl'); await checkModule(d, viewMod, 'views.wgsl');
    const cp = entry => d.createComputePipelineAsync({ layout: 'auto', compute: { module: genMod, entryPoint: entry } });
    [this.pShape, this.pDetail, this.pWeather] = await Promise.all([cp('gen_shape'), cp('gen_detail'), cp('gen_weather')]);
    this.hashBuf = d.createBuffer({ size: TABLE_LEN * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.genBuf = d.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.uniBuf = d.createBuffer({ size: UNI_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat' });
    const F = GPUShaderStage.FRAGMENT;
    this.bgl = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: F, buffer: { type: 'uniform' } },
      { binding: 1, visibility: F, sampler: { type: 'filtering' } },
      { binding: 2, visibility: F, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 3, visibility: F, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 4, visibility: F, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 5, visibility: F, texture: { sampleType: 'float', viewDimension: '2d' } },
    ] });
    const layout = d.createPipelineLayout({ bindGroupLayouts: [this.bgl] });
    const rp = (mod, fs) => d.createRenderPipelineAsync({ layout, vertex: { module: mod, entryPoint: 'vs_main' }, fragment: { module: mod, entryPoint: fs, targets: [{ format: this.format }] }, primitive: { topology: 'triangle-list' } });
    const [slice, tiles, volume] = await Promise.all([rp(viewMod, 'fs_slice'), rp(viewMod, 'fs_tiles'), rp(viewMod, 'fs_volume')]);
    this.pipes = { slice, tiles, volume };
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
    this.tex.detail = d.createTexture({ size: [32, 32, 32], dimension: '3d', format: 'rgba8unorm', usage });
    this.tex.weather = d.createTexture({ size: [WEATHER_RES, WEATHER_RES], format: 'rgba8unorm', usage });
  }

  // Make the shape and parts textures for edge n (new textures, new bind group).
  ensureRes(n) {
    if (this.res === n) return;
    const d = this.device;
    for (const k of ['shape', 'parts']) if (this.tex[k]) this.tex[k].destroy();
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
    this.tex.shape = d.createTexture({ size: [n, n, n], dimension: '3d', format: 'rgba8unorm', usage });
    this.tex.parts = d.createTexture({ size: [n, n, n], dimension: '3d', format: 'rgba8unorm', usage });
    this.res = n;
    this.bg = d.createBindGroup({ layout: this.bgl, entries: [
      { binding: 0, resource: { buffer: this.uniBuf } },
      { binding: 1, resource: this.sampler },
      { binding: 2, resource: this.tex.shape.createView() },
      { binding: 3, resource: this.tex.parts.createView() },
      { binding: 4, resource: this.tex.detail.createView() },
      { binding: 5, resource: this.tex.weather.createView() },
    ] });
  }

  // Fill all four textures for prm (RECIPE fields, and an optional offset
  // [x, y, z] in texture units that the tests use). Resolves when the GPU is done.
  async generate(prm) {
    const run = async () => {
      const d = this.device, q = d.queue, p = Object.assign({}, RECIPE, prm);
      const t0 = performance.now();
      this.ensureRes(p.shapeRes);
      q.writeBuffer(this.hashBuf, 0, hashTable(p.seed));
      const o = p.offset || [0, 0, 0];
      const params = (res, z0) => new Float32Array([p.perlinFreq, p.perlinOct, p.pwCells, p.gbaCells, p.detailCells, perlinW(p.seed), res, z0, o[0], o[1], o[2], 0]);
      const bind = (pipe, extra) => d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.hashBuf } }, { binding: 1, resource: { buffer: this.genBuf } }, ...extra] });
      const pass = (pipe, bg, x, y, z) => {
        const enc = d.createCommandEncoder(); const cp = enc.beginComputePass();
        cp.setPipeline(pipe); cp.setBindGroup(0, bg); cp.dispatchWorkgroups(x, y, z); cp.end(); q.submit([enc.finish()]);
      };
      const n = p.shapeRes;
      const bShape = bind(this.pShape, [{ binding: 2, resource: this.tex.shape.createView() }, { binding: 3, resource: this.tex.parts.createView() }]);
      for (let z0 = 0; z0 < n; z0 += SLAB) {
        q.writeBuffer(this.genBuf, 0, params(n, z0));
        pass(this.pShape, bShape, n / 4, n / 4, Math.min(SLAB, n - z0) / 4);
        // writeBuffer before the next submit is ordered after this one.
        if (z0 % 64 === 48) await q.onSubmittedWorkDone();
      }
      q.writeBuffer(this.genBuf, 0, params(32, 0));
      pass(this.pDetail, bind(this.pDetail, [{ binding: 4, resource: this.tex.detail.createView() }]), 8, 8, 8);
      q.writeBuffer(this.genBuf, 0, params(WEATHER_RES, 0));
      pass(this.pWeather, bind(this.pWeather, [{ binding: 5, resource: this.tex.weather.createView() }]), WEATHER_RES / 8, WEATHER_RES / 8, 1);
      await q.onSubmittedWorkDone();
      this.genMs = performance.now() - t0;
      this.prm = p;
      return this.genMs;
    };
    // Calls queue up: a new generate waits for the one in flight.
    const prev = this.generating || Promise.resolve();
    const job = prev.catch(() => {}).then(run);
    this.generating = job;
    return job;
  }

  // Draw one view. uni: Float32Array(UNI_FLOATS).
  render(view, uni) {
    if (!this.bg) return;
    const d = this.device;
    d.queue.writeBuffer(this.uniBuf, 0, uni);
    const enc = d.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    pass.setPipeline(this.pipes[view]); pass.setBindGroup(0, this.bg); pass.draw(3); pass.end();
    d.queue.submit([enc.finish()]);
  }

  // Read a texture back: { data: Uint8Array of w*h*d*4 bytes, x fastest, then y, then z; w, h, d }.
  async readTexture(name) {
    const t = this.tex[name], d = this.device;
    const w = t.width, h = t.height, depth = t.depthOrArrayLayers;
    const row = Math.ceil(w * 4 / 256) * 256;
    const buf = d.createBuffer({ size: row * h * depth, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = d.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: t }, { buffer: buf, bytesPerRow: row, rowsPerImage: h }, [w, h, depth]);
    d.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange()), out = new Uint8Array(w * h * depth * 4);
    for (let z = 0; z < depth; z++) for (let y = 0; y < h; y++) out.set(src.subarray((z * h + y) * row, (z * h + y) * row + w * 4), ((z * h + y) * w) * 4);
    buf.unmap(); buf.destroy();
    return { data: out, w, h, d: depth };
  }
}
