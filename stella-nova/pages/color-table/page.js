// ============================================================================
//  COLOR & TONE TABLE  ·  page.js — the per-page PAGE object
// ────────────────────────────────────────────────────────────────────────────
//  Color and tone operators applied to a source field the sidebar picks; a fragment shader per cell reads a shared source texture.
//  The shared table-engine drives this object through its ctx. main.js fetches
//  the data and calls bootTable(PAGE, data); the engine calls PAGE.init and
//  PAGE.draw from there. The noise pack arrives as ctx.noisePack.
// ============================================================================
const FIELDS = ["ramp", "radial", "fbm", "warp", "marble", "voronoi_id", "sum_sines", "plasma", "worley_f1", "caustics"];
export const PAGE = {
  async init(ctx) {
    const NOISE_PACK = ctx.noisePack;
    const { device, format, tiles, PACK, $ } = ctx; this.ctx = ctx;
    this.tex = device.createTexture({ size: [512, 512], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    this.smp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} }] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [this.bgl] });
    const module = device.createShaderModule({ code: PACK });
    module.getCompilationInfo().then(info => { const errs = info.messages.filter(m => m.type === 'error'); if (errs.length) for (const t of tiles) ctx.setStatus(t, errs[0].message.slice(0, 120), true); });
    for (const t of tiles) device.createRenderPipelineAsync({ layout, vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: 'fs_' + t.s.name, targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
      .then(p => { t.pipeline = p; t.dirty = true; }).catch(e => ctx.setStatus(t, String(e.message || e).slice(0, 120), true));
    const nbgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
    const nmod = device.createShaderModule({ code: NOISE_PACK }); const nlayout = device.createPipelineLayout({ bindGroupLayouts: [nbgl] });
    this.nbuf = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.nbind = device.createBindGroup({ layout: nbgl, entries: [{ binding: 0, resource: { buffer: this.nbuf } }] });
    this.npipes = {};
    for (const n of FIELDS) if (n !== 'ramp' && n !== 'radial') this.npipes[n] = device.createRenderPipeline({ layout: nlayout, vertex: { module: nmod, entryPoint: 'vs_main' }, fragment: { module: nmod, entryPoint: 'fs_' + n, targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list' } });
    const thumbs = $('thumbs'); this.work = document.createElement('canvas'); this.work.width = this.work.height = 512; this.wctx = this.work.getContext('2d');
    for (const n of FIELDS) {
      const b = document.createElement('button'); b.type = 'button'; b.title = n.replace(/_/g, ' '); const cv = document.createElement('canvas'); cv.width = cv.height = 96; b.appendChild(cv); thumbs.appendChild(b);
      if (n === 'ramp' || n === 'radial') this.draw2d(n, cv.getContext('2d'), 96);
      else { const c2 = cv.getContext('webgpu'); c2.configure({ device, format: 'rgba8unorm', alphaMode: 'opaque' }); this.renderNoise(n, c2.getCurrentTexture().createView(), 96); }
      b.addEventListener('click', () => this.select(n, b));
    }
    this.select('fbm', thumbs.children[FIELDS.indexOf('fbm')]);
  },
  draw2d(n, c, W) {
    const im = c.createImageData(W, W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const v = n === 'ramp' ? x / (W - 1) : Math.max(0, 1 - Math.hypot(x - W / 2, y - W / 2) / (W * 0.5)); const i = (y * W + x) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = Math.round(v * 255); im.data[i + 3] = 255; }
    c.putImageData(im, 0, 0);
  },
  renderNoise(n, view, size) {
    const { device } = this.ctx; const d = new Float32Array(24);
    // grey palette so .r is the field itself
    d[0] = size; d[1] = size; d[2] = 3.0; d[3] = 1; d.set([0, 0, 0, 1], 4); d.set([0.62, 0.62, 0.62, 1], 8); d.set([1, 1, 1, 1], 12); d[16] = 1; d[17] = 1; d.set([0.5, 0.5, 0.5, 0.5], 20);
    device.queue.writeBuffer(this.nbuf, 0, d);
    const enc = device.createCommandEncoder(); const pass = enc.beginRenderPass({ colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(this.npipes[n]); pass.setBindGroup(0, this.nbind); pass.draw(3); pass.end(); device.queue.submit([enc.finish()]);
  },
  copyWork() { this.ctx.device.queue.copyExternalImageToTexture({ source: this.work }, { texture: this.tex }, [512, 512]); },
  // A source click records only the latest pending write. tick() applies one write
  // per frame, before the grid draws, so rapid switching can neither stack GPU work
  // nor let a cell read the source texture while that texture is being written.
  tick() { if (!this.pending) return; const apply = this.pending; this.pending = null; apply(); return true; },
  select(n, btn) {
    this.ctx.$('thumbs').querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    if (n === 'ramp' || n === 'radial') { this.draw2d(n, this.wctx, 512); this.pending = () => this.copyWork(); }
    else this.pending = () => this.renderNoise(n, this.tex.createView(), 512);
  },
  bind(surf) { if (!surf.page.bind) surf.page.bind = this.ctx.device.createBindGroup({ layout: this.bgl, entries: [{ binding: 0, resource: { buffer: surf.buf } }, { binding: 1, resource: this.tex.createView() }, { binding: 2, resource: this.smp }] }); return surf.page.bind; },
  draw(enc, t, surf, rect, dpr, dt, now, moving) {
    const { device, G } = this.ctx; const d = surf.data;
    d[0] = rect.width; d[1] = rect.height; d[2] = t.phase; d[3] = dpr;
    d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); d.set([G.cream[0], G.cream[1], G.cream[2], 1], 12);
    d[16] = G.exposure; d[17] = G.contrast; d[18] = 0; d[19] = 0; d.set(t.knobs, 20);
    device.queue.writeBuffer(surf.buf, 0, d);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: surf.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(t.pipeline); pass.setBindGroup(0, this.bind(surf)); pass.draw(3); pass.end();
  },
};


