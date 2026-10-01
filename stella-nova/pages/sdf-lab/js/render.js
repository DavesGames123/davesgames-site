// ============================================================================
//  SDF FORGE  ·  render.js — WebGPU: one device, one canvas per pane
// ----------------------------------------------------------------------------
//  EVERY PANE RENDERS TO ITS OWN TARGET (Forge decision 1). Here a target is
//  a canvas with its own context; all of them share one device, one
//  parameter buffer P and the current pipelines. A pane drawn at lower
//  resolution is a smaller canvas that CSS stretches.
//
//  A STRUCTURE CHANGE COMPILES IN THE BACKGROUND. setStructure builds the new
//  module and both pipelines with createRenderPipelineAsync. Until they are
//  ready the old pipelines keep drawing with the old layout, and the caller
//  keeps packing P in the old layout. ready() hands over the new layout, so a
//  frame never reads a buffer packed for a different shader.
//
//  GREP MAP
//    createRenderer ....... adapter, device, explicit bind group layout
//    setStructure ......... the generated module and its two pipelines
//    writeParams .......... P (grows by doubling)
//    addPane / drawPanes .. per-pane uniform buffers, one encoder per frame
//    probe ................ mapD at points on the GPU, read back (tests)
//    destroy .............. pagehide: release the device
// ============================================================================
import { genWGSL } from './codegen.js';
import { FRAME, PROBE } from './shader.js';

export const UNIFORM_FLOATS = 14 * 4;

export async function createRenderer(onLost) {
  if (!navigator.gpu) throw new Error('no-webgpu');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no-adapter');
  const device = await adapter.requestDevice();
  const format = navigator.gpu.getPreferredCanvasFormat();
  const R = new Renderer(device, format);
  device.lost.then(info => { if (!R.destroyed && onLost) onLost(info); });
  return R;
}

class Renderer {
  constructor(device, format) {
    this.device = device; this.format = format; this.destroyed = false;
    this.bgl = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ] });
    this.layout = device.createPipelineLayout({ bindGroupLayouts: [this.bgl] });
    this.pcap = 0; this.pbuf = null; this.panes = [];
    this.ensureP(256);
    this.pipe = null;         // { view, slice, sig, code, ms }
    this.pending = null;
    this.gen = 0;
    this.lastError = null;
  }
  ensureP(vec4s) {
    if (vec4s <= this.pcap) return;
    let cap = Math.max(256, this.pcap);
    while (cap < vec4s) cap *= 2;
    if (this.pbuf) this.pbuf.destroy();
    this.pbuf = this.device.createBuffer({ size: cap * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.pcap = cap;
    for (const p of this.panes) p.bind = null;
  }
  writeParams(P) {
    this.ensureP(P.length / 4);
    this.device.queue.writeBuffer(this.pbuf, 0, P.buffer, P.byteOffset, P.byteLength);
  }
  // Compile a document's structure. Resolves true when the new pipelines are
  // live, false when a newer request replaced this one, and rejects on error.
  async setStructure(doc, L) {
    const gen = ++this.gen;
    const code = genWGSL(doc, L) + FRAME;
    const t0 = performance.now();
    const dev = this.device;
    dev.pushErrorScope('validation');
    const module = dev.createShaderModule({ code, label: 'sdf ' + L.sig.length });
    const info = await module.getCompilationInfo();
    const errs = info.messages.filter(m => m.type === 'error');
    const scoped = await dev.popErrorScope();
    if (errs.length || scoped) {
      this.lastError = errs.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('\n') || String(scoped && scoped.message);
      throw new Error('shader: ' + this.lastError);
    }
    const desc = entry => ({
      layout: this.layout,
      vertex: { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: entry, targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
    const [view, slice] = await Promise.all([dev.createRenderPipelineAsync(desc('fs_view')), dev.createRenderPipelineAsync(desc('fs_slice'))]);
    if (gen !== this.gen || this.destroyed) return false;
    this.pipe = { view, slice, sig: L.sig, code, ms: performance.now() - t0, lines: code.split('\n').length };
    return true;
  }
  addPane(canvas) {
    const ctx = canvas.getContext('webgpu');
    ctx.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
    const ubuf = this.device.createBuffer({ size: UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const p = { canvas, ctx, ubuf, bind: null };
    this.panes.push(p);
    return p;
  }
  // jobs: [{ pane, u: Float32Array, kind: 'view' | 'slice' }]
  drawPanes(jobs) {
    if (!this.pipe || !jobs.length) return false;
    const dev = this.device, enc = dev.createCommandEncoder();
    for (const j of jobs) {
      const p = j.pane;
      if (!p.bind) p.bind = dev.createBindGroup({ layout: this.bgl, entries: [{ binding: 0, resource: { buffer: p.ubuf } }, { binding: 1, resource: { buffer: this.pbuf } }] });
      dev.queue.writeBuffer(p.ubuf, 0, j.u.buffer, j.u.byteOffset, j.u.byteLength);
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: p.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.1, g: 0.1, b: 0.11, a: 1 } }] });
      pass.setPipeline(j.kind === 'slice' ? this.pipe.slice : this.pipe.view);
      pass.setBindGroup(0, p.bind);
      pass.draw(3);
      pass.end();
    }
    dev.queue.submit([enc.finish()]);
    return true;
  }
  done() { return this.device.queue.onSubmittedWorkDone(); }
  // mapD on the GPU at a list of [x, y, z] points, for the CDP check.
  async probe(doc, L, P, pts) {
    const dev = this.device;
    const module = dev.createShaderModule({ code: genWGSL(doc, L) + PROBE });
    const pipe = await dev.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'cs_probe' } });
    const n = pts.length;
    const inb = dev.createBuffer({ size: n * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const outb = dev.createBuffer({ size: n * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const rb = dev.createBuffer({ size: n * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const pb = dev.createBuffer({ size: Math.max(P.byteLength, 16), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const flat = new Float32Array(n * 4);
    pts.forEach((p, i) => flat.set([p[0], p[1], p[2], 0], i * 4));
    dev.queue.writeBuffer(inb, 0, flat);
    dev.queue.writeBuffer(pb, 0, P.buffer, P.byteOffset, P.byteLength);
    const bg = dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
      { binding: 1, resource: { buffer: pb } }, { binding: 2, resource: { buffer: inb } }, { binding: 3, resource: { buffer: outb } }] });
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(Math.ceil(n / 64)); pass.end();
    enc.copyBufferToBuffer(outb, 0, rb, 0, n * 4);
    dev.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const out = Array.from(new Float32Array(rb.getMappedRange().slice(0)));
    rb.unmap();
    [inb, outb, rb, pb].forEach(b => b.destroy());
    return out;
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const p of this.panes) { try { p.ctx.unconfigure(); } catch (e) { /* already gone */ } p.ubuf.destroy(); }
    if (this.pbuf) this.pbuf.destroy();
    this.device.destroy();
  }
}
