// ============================================================================
//  DLA TERRAIN  ·  gpu/fallback.js — stand-in ground and sky modules (CORE)
// ----------------------------------------------------------------------------
//  createFallbackGround(gpu) and createFallbackSky(gpu) return modules of
//  the CONTRACT interface. main.js uses them only when render/ground.js or
//  render/sky.js is missing or fails, so a broken package never blanks the
//  page. They also let CORE test its frame graph alone (Deno render).
//  grep -n targets: "export async function createFallbackGround",
//  "export async function createFallbackSky"
// ============================================================================

async function shaderModule(gpu) {
  const code = await gpu.loadWGSL('gpu/fallback.wgsl');
  return gpu.device.createShaderModule({ label: 'fallback', code });
}

export async function createFallbackGround(gpu, opts = {}) {
  const device = gpu.device;
  const N = opts.grid || (gpu.quality >= 0.75 ? 512 : 320);
  const mod = await shaderModule(gpu);
  const ubuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(ubuf, 0, new Float32Array([N, 0, 0, 0]));
  const l1 = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
  const bg1 = device.createBindGroup({ layout: l1, entries: [{ binding: 0, resource: { buffer: ubuf } }] });
  const idx = new Uint32Array((N - 1) * (N - 1) * 6);
  let k = 0;
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  const ib = device.createBuffer({ size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(ib, 0, idx);
  const pl = device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, l1, gpu.shadowSampleLayout] });
  const plS = device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, l1, gpu.shadowPassLayout] });
  const pipe = await device.createRenderPipelineAsync({
    label: 'fallback ground', layout: pl,
    vertex: { module: mod, entryPoint: 'vs_ground' },
    fragment: { module: mod, entryPoint: 'fs_ground', targets: [{ format: gpu.hdrFormat }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: gpu.depthState(true, 'greater'),
  });
  const pipeS = await device.createRenderPipelineAsync({
    label: 'fallback ground shadow', layout: plS,
    vertex: { module: mod, entryPoint: 'vs_shadow' },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: gpu.shadowDepthState,
  });
  return {
    name: 'fallback ground',
    setTerrain() {}, update() {},
    drawShadow(pass) { pass.setPipeline(pipeS); pass.setBindGroup(1, bg1); pass.setIndexBuffer(ib, 'uint32'); pass.drawIndexed(idx.length); },
    drawOpaque(pass) { pass.setPipeline(pipe); pass.setBindGroup(1, bg1); pass.setIndexBuffer(ib, 'uint32'); pass.drawIndexed(idx.length); },
    resize() {}, dispose() { ib.destroy(); ubuf.destroy(); },
  };
}

export async function createFallbackSky(gpu) {
  const device = gpu.device;
  const mod = await shaderModule(gpu);
  const l1 = device.createBindGroupLayout({ entries: [] });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, l1, gpu.shadowSampleLayout] });
  const pipe = await device.createRenderPipelineAsync({
    label: 'fallback sky', layout: pl,
    vertex: { module: mod, entryPoint: 'vs_sky' },
    fragment: { module: mod, entryPoint: 'fs_sky', targets: [{ format: gpu.hdrFormat }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: gpu.depthState(false, 'greater-equal'),
  });
  const bg1 = device.createBindGroup({ layout: l1, entries: [] });
  return {
    name: 'fallback sky',
    setTerrain() {}, update() {},
    drawSky(pass) { pass.setPipeline(pipe); pass.setBindGroup(1, bg1); pass.draw(3); },
    resize() {}, dispose() {},
  };
}
