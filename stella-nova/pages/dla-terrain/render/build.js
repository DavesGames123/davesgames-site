// ============================================================================
//  DLA TERRAIN  ·  render/build.js — the "Watch it build" overlay (CORE)
// ----------------------------------------------------------------------------
//  createBuildOverlay(gpu) -> module (CONTRACT module interface, role
//  'build'). It draws shaders/build.wgsl as one full-screen triangle in the
//  water pass, after the water: the DLA tree and its walkers, the ray fans,
//  the flow, the erosion and the climate tints, and the grey veil. It reads
//  ctx.depthView (the depth copy before water) and ctx.sceneColorView.
//    setField(f | null)   f = { n, data Float32Array n*n*4 } of build.js;
//                         packed to rgba16float and uploaded once
//    setParams(p)         { mode 0..5, reveal, amount, amount2, veil, dim, time }
//    setWalkers(arr, n)   Float32Array (x, z, light, r) x n, n <= MAX_WALK
//    active()             true when there is something to draw
//  grep -n targets: "export async function createBuildOverlay", "function toHalf",
//  "MAX_WALK", "drawWater"
// ============================================================================

export const MAX_WALK = 96;
export const MODES = Object.freeze({ none: 0, tree: 1, rays: 2, flow: 3, erosion: 4, climate: 5 });

const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
export function toHalf(v) {
  F32[0] = v;
  const x = U32[0], sign = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return sign;
  if (e >= 31) return sign | 0x7c00;
  return (sign | (e << 10)) + ((m + 0x1000) >>> 13);
}
export function packHalf(data) {
  const out = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = toHalf(data[i]);
  return out;
}

export async function createBuildOverlay(gpu) {
  const device = gpu.device, queue = gpu.queue;
  const code = await gpu.loadWGSL('shaders/build.wgsl');
  const mod = device.createShaderModule({ label: 'build overlay', code });
  const FV = GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX;
  const layout = device.createBindGroupLayout({
    label: 'build overlay',
    entries: [
      { binding: 0, visibility: FV, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  });
  const pipe = await device.createRenderPipelineAsync({
    label: 'build overlay',
    layout: device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, layout, gpu.shadowSampleLayout] }),
    vertex: { module: mod, entryPoint: 'vs_build' },
    fragment: {
      module: mod, entryPoint: 'fs_build',
      targets: [{ format: gpu.hdrFormat, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }],
    },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: gpu.depthFormat || 'depth32float', depthWriteEnabled: false, depthCompare: 'always' },
  });
  const ubuf = device.createBuffer({ label: 'build u', size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const wbuf = device.createBuffer({ label: 'build walkers', size: MAX_WALK * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const sampler = gpu.sLinear || device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const blankTex = device.createTexture({ label: 'build blank', size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  queue.writeTexture({ texture: blankTex }, packHalf(new Float32Array([2, 0, 0, 0])), { bytesPerRow: 8 }, [1, 1]);
  let tex = blankTex, bg = null, bgKey = null, bgScene = null, bgTex = null, nWalk = 0;
  const u = new Float32Array(8);
  const P = { mode: 0, reveal: 1, amount: 0, amount2: 0, veil: 0, dim: 0.4, time: 0 };

  const m = {
    name: 'build', role: 'build', label: 'Build overlay',
    setField(f) {
      if (tex !== blankTex) tex.destroy();
      tex = blankTex; bg = null;
      if (!f || !f.n) return;
      tex = device.createTexture({ label: 'build field', size: [f.n, f.n], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      queue.writeTexture({ texture: tex }, packHalf(f.data), { bytesPerRow: f.n * 8 }, [f.n, f.n]);
    },
    setParams(p) { Object.assign(P, p); },
    setWalkers(arr, n) {
      nWalk = Math.min(MAX_WALK, n | 0);
      if (nWalk > 0) queue.writeBuffer(wbuf, 0, arr.buffer, arr.byteOffset, nWalk * 16);
    },
    active: () => P.mode > 0 || P.veil > 0.001,
    resize() { bg = null; },
    drawWater(pass, frame, ctx) {
      if (!m.active() || !ctx || !ctx.depthView || !ctx.sceneColorView) return;
      const key = ctx.depthView;
      if (!bg || bgKey !== key || bgScene !== ctx.sceneColorView || bgTex !== tex) {
        bg = device.createBindGroup({
          label: 'build overlay', layout,
          entries: [
            { binding: 0, resource: { buffer: ubuf } },
            { binding: 1, resource: tex.createView() },
            { binding: 2, resource: sampler },
            { binding: 3, resource: ctx.depthView },
            { binding: 4, resource: ctx.sceneColorView },
            { binding: 5, resource: { buffer: wbuf } },
          ],
        });
        bgScene = ctx.sceneColorView; bgTex = tex; bgKey = key;
      }
      u[0] = P.mode; u[1] = P.reveal; u[2] = P.amount; u[3] = P.amount2;
      u[4] = P.veil; u[5] = P.mode === 1 ? nWalk : 0; u[6] = P.time; u[7] = P.dim;
      queue.writeBuffer(ubuf, 0, u);
      pass.setPipeline(pipe);
      pass.setBindGroup(1, bg);
      pass.draw(3);
    },
    dispose() { if (tex !== blankTex) tex.destroy(); blankTex.destroy(); ubuf.destroy(); wbuf.destroy(); },
  };
  return m;
}
