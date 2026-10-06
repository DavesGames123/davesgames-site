// ============================================================================
//  HALFTONE  ·  gpu.js — device, source texture, pipelines, readback
// ----------------------------------------------------------------------------
//  This module owns every WebGPU object of the page. It has no DOM code
//  except the canvas context and the image and video copies. main.js calls
//  it; saver.js does not.
//
//  SHADERS (shaders/, fetched as text)
//    halftone.wgsl  the upstream port (snoise, aastep, halftone)
//    extended.wgsl  this page's extensions (struct Ext, halftone_ext)
//    present.wgsl   the view pass        -> module halftone + extended + present
//    scene.wgsl     the procedural scenes -> its own module
//
//  SOURCE TEXTURE. One rgba8unorm texture. A photo gets a full mip chain
//  (each level a high-quality resize by createImageBitmap), so a zoomed-out
//  view samples a smooth level and the dots do not take the film grain as
//  noise. The webcam and the scenes get one level, written each frame.
//
//  UNIFORMS. present.wgsl struct U: UNI_FLOATS floats. main.js writes them
//  (see writeUniforms there); render() and renderImage() upload them.
//
//  grep -n: "export async function createGPU"  "setBitmap("  "setVideo("
//           "drawScene("  "render("  "async renderImage("  "async readSource("
// ============================================================================

export const UNI_FLOATS = 56;
const SCENE_W = 1600, SCENE_H = 1000;
export const SCENE_SIZE = [SCENE_W, SCENE_H];

async function loadText(name) {
  const r = await fetch(new URL('./shaders/' + name, import.meta.url));
  if (!r.ok) throw new Error('shader ' + name + ': HTTP ' + r.status);
  return r.text();
}

async function checkModule(mod, label) {
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
  for (const n of ['halftone', 'extended', 'present', 'scene']) src[n] = await loadText(n + '.wgsl');
  const errors = [];
  device.addEventListener('uncapturederror', e => { errors.push(String(e.error && e.error.message || e.error)); console.error('WebGPU:', e.error && e.error.message); });
  const g = new HalftoneGPU(device, ctx, format, src);
  g.errors = errors;
  await g.build();
  return g;
}

class HalftoneGPU {
  constructor(device, ctx, format, src) {
    Object.assign(this, { device, ctx, format, src });
    this.tex = null; this.texW = 0; this.texH = 0; this.texKind = '';
    this.bg = null;
  }

  async build() {
    const d = this.device;
    const viewCode = this.src.halftone + '\n' + this.src.extended + '\n' + this.src.present;
    const viewMod = d.createShaderModule({ label: 'halftone view', code: viewCode });
    const sceneMod = d.createShaderModule({ label: 'halftone scenes', code: this.src.scene });
    await checkModule(viewMod, 'present'); await checkModule(sceneMod, 'scene');
    this.bgl = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ] });
    const layout = d.createPipelineLayout({ bindGroupLayouts: [this.bgl] });
    const pipe = fmt => d.createRenderPipeline({ layout, vertex: { module: viewMod, entryPoint: 'vs_main' },
      fragment: { module: viewMod, entryPoint: 'fs_main', targets: [{ format: fmt }] }, primitive: { topology: 'triangle-list' } });
    this.pView = pipe(this.format);
    this.pOff = this.format === 'rgba8unorm' ? this.pView : pipe('rgba8unorm');
    this.pScene = d.createRenderPipeline({ layout: 'auto', vertex: { module: sceneMod, entryPoint: 'vs_scene' },
      fragment: { module: sceneMod, entryPoint: 'fs_scene', targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list' } });
    this.uni = d.createBuffer({ size: UNI_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.uniOff = d.createBuffer({ size: UNI_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sceneUni = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sceneBG = d.createBindGroup({ layout: this.pScene.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.sceneUni } }] });
    this.smp = d.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.ensureTexture(SCENE_W, SCENE_H, 1, 'scene');
  }

  ensureTexture(w, h, levels, kind) {
    if (this.tex && this.texW === w && this.texH === h && this.tex.mipLevelCount === levels) { this.texKind = kind; return; }
    if (this.tex) this.tex.destroy();
    this.tex = this.device.createTexture({ size: [w, h], format: 'rgba8unorm', mipLevelCount: levels,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT });
    this.texW = w; this.texH = h; this.texKind = kind;
    const view = this.tex.createView();
    const bg = buf => this.device.createBindGroup({ layout: this.bgl, entries: [
      { binding: 0, resource: { buffer: buf } }, { binding: 1, resource: view }, { binding: 2, resource: this.smp }] });
    this.bg = bg(this.uni); this.bgOff = bg(this.uniOff);
  }

  get maxSize() { return Math.min(4096, this.device.limits.maxTextureDimension2D); }

  /** A photo or a user image (ImageBitmap) with a full mip chain. */
  async setBitmap(bmp, kind = 'image') {
    const w = bmp.width, h = bmp.height;
    const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    const mips = [bmp];
    for (let l = 1; l < levels; l++) {
      const lw = Math.max(1, w >> l), lh = Math.max(1, h >> l);
      mips.push(await createImageBitmap(bmp, { resizeWidth: lw, resizeHeight: lh, resizeQuality: 'high' }));
    }
    this.ensureTexture(w, h, levels, kind);
    mips.forEach((m, l) => {
      this.device.queue.copyExternalImageToTexture({ source: m }, { texture: this.tex, mipLevel: l }, [m.width, m.height]);
      if (l) m.close();
    });
  }

  /** One webcam frame (one level). */
  setVideo(video) {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return false;
    this.ensureTexture(w, h, 1, 'camera');
    this.device.queue.copyExternalImageToTexture({ source: video }, { texture: this.tex }, [w, h]);
    return true;
  }

  /** Draw procedural scene id at time t into the source texture. */
  drawScene(id, t) {
    this.ensureTexture(SCENE_W, SCENE_H, 1, 'scene');
    this.device.queue.writeBuffer(this.sceneUni, 0, new Float32Array([SCENE_W, SCENE_H, t, id]));
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.tex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    pass.setPipeline(this.pScene); pass.setBindGroup(0, this.sceneBG); pass.draw(3); pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  render(uni) {
    this.device.queue.writeBuffer(this.uni, 0, uni);
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    pass.setPipeline(this.pView); pass.setBindGroup(0, this.bg); pass.draw(3); pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  /**
   * Render at w x h into an rgba8unorm target and read it back:
   * { w, h, data } with data tightly packed RGBA, row 0 at the top.
   */
  async renderImage(uni, w, h) {
    const d = this.device;
    const tgt = d.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    d.queue.writeBuffer(this.uniOff, 0, uni);
    const enc = d.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: tgt.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    pass.setPipeline(this.pOff); pass.setBindGroup(0, this.bgOff); pass.draw(3); pass.end();
    d.queue.submit([enc.finish()]);
    const out = await this.readTexture(tgt, w, h);
    tgt.destroy();
    return out;
  }

  /** Level 0 of the source texture: { w, h, data }. */
  readSource() { return this.readTexture(this.tex, this.texW, this.texH); }

  async readTexture(tex, w, h) {
    const d = this.device;
    const bpr = Math.ceil(w * 4 / 256) * 256;
    const buf = d.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = d.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
    d.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const raw = new Uint8Array(buf.getMappedRange());
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) data.set(raw.subarray(y * bpr, y * bpr + w * 4), y * w * 4);
    buf.unmap(); buf.destroy();
    return { w, h, data };
  }
}
