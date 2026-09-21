// ============================================================================
//  HEAT DIFFRACTION TABLE  ·  page.js — the per-page PAGE object (GENERATED)
// ────────────────────────────────────────────────────────────────────────────
//  60 heat operators over a shared source image. Same source-texture machinery
//  as the post-process table: a picked photo (or an uploaded/dropped image) is
//  drawn into a 512 texture that every cell samples through src(uv).
//  UNIFORM LAYOUT (96 bytes, struct HeatU in shaders/pack.wgsl)
//    0..1 size · 2 time · 3 pixelScale · 4..7 ink · 8..11 tone · 12..15 cream
//    16 energy · 17 zoom · 18 pad · 19 pad · 20..23 k
// ============================================================================
export const PAGE = {
  async init(ctx) {
    const PHOTOS = ctx.photos;
    const { device, format, tiles, PACK, $ } = ctx; this.ctx = ctx;
    this.tex = device.createTexture({ size: [512, 512], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    this.smp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'mirror-repeat', addressModeV: 'mirror-repeat' });
    this.bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} }] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [this.bgl] });
    const module = device.createShaderModule({ code: PACK });
    module.getCompilationInfo().then(info => { const errs = info.messages.filter(m => m.type === 'error'); if (errs.length) for (const t of tiles) ctx.setStatus(t, errs[0].message.slice(0, 120), true); });
    for (const t of tiles) device.createRenderPipelineAsync({ layout, vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: 'fs_' + t.s.name, targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
      .then(p => { t.pipeline = p; t.dirty = true; }).catch(e => ctx.setStatus(t, String(e.message || e).slice(0, 120), true));
    const thumbs = $('thumbs'); this.work = document.createElement('canvas'); this.work.width = this.work.height = 512; this.wctx = this.work.getContext('2d');
    const add = id => { const b = document.createElement('button'); b.type = 'button'; b.title = id.replace(/_/g, ' '); const cv = document.createElement('canvas'); cv.width = cv.height = 96; b.appendChild(cv); thumbs.appendChild(b); return { b, cv }; };
    this.photos = {}; let first = null;
    for (const [id, uri] of Object.entries(PHOTOS)) { const { cv, b } = add(id); const img = new Image(); img.onload = () => { cv.getContext('2d').drawImage(img, 0, 0, 96, 96); }; img.src = uri; this.photos[id] = img; b.addEventListener('click', () => this.select(id, b)); if (!first) first = b; }
    const up = add('upload'); const uc = up.cv.getContext('2d'); uc.fillStyle = '#1c2436'; uc.fillRect(0, 0, 96, 96); uc.fillStyle = '#96c8ff'; uc.font = '40px sans-serif'; uc.fillText('+', 34, 62); this.upBtn = up;
    up.b.addEventListener('click', () => $('upload').click());
    $('upload').addEventListener('change', e => { const f = e.target.files[0]; if (f) this.loadImage(f); });
    const side = $('side'); side.addEventListener('dragover', e => e.preventDefault()); side.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) this.loadImage(f); });
    const firstId = Object.keys(PHOTOS)[0]; this.select(firstId, first);
  },
  copyWork() { this.ctx.device.queue.copyExternalImageToTexture({ source: this.work }, { texture: this.tex }, [512, 512]); },
  tick() { if (!this.pending) return; const apply = this.pending; this.pending = null; apply(); return true; },
  select(id, btn) {
    this.ctx.$('thumbs').querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    const img = this.photos[id]; if (!img) return;
    const put = () => { this.wctx.drawImage(img, 0, 0, 512, 512); this.pending = () => this.copyWork(); };
    if (img.complete && img.naturalWidth) put(); else img.addEventListener('load', put, { once: true });
  },
  loadImage(file) {
    const img = new Image(); img.onload = () => { const s = Math.max(512 / img.width, 512 / img.height); const w = img.width * s, h = img.height * s;
      this.wctx.fillStyle = '#000'; this.wctx.fillRect(0, 0, 512, 512); this.wctx.drawImage(img, (512 - w) / 2, (512 - h) / 2, w, h);
      this.pending = () => this.copyWork();
      this.upBtn.cv.getContext('2d').drawImage(this.work, 0, 0, 96, 96);
      this.ctx.$('thumbs').querySelectorAll('button').forEach(b => b.classList.toggle('active', b === this.upBtn.b));
      URL.revokeObjectURL(img.src); };
    img.src = URL.createObjectURL(file);
  },
  bind(surf) { if (!surf.page.bind) surf.page.bind = this.ctx.device.createBindGroup({ layout: this.bgl, entries: [{ binding: 0, resource: { buffer: surf.buf } }, { binding: 1, resource: this.tex.createView() }, { binding: 2, resource: this.smp }] }); return surf.page.bind; },
  draw(enc, t, surf, rect, dpr, dt, now, moving) {
    const { device, G } = this.ctx; const d = surf.data;
    d[0] = rect.width; d[1] = rect.height; d[2] = t.phase; d[3] = dpr;
    d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); d.set([G.cream[0], G.cream[1], G.cream[2], 1], 12);
    d[16] = G.energy; d[17] = G.zoom; d[18] = 0; d[19] = 0; d.set(t.knobs, 20);
    device.queue.writeBuffer(surf.buf, 0, d);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: surf.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(t.pipeline); pass.setBindGroup(0, this.bind(surf)); pass.draw(3); pass.end();
  },
  source(t) { return this.ctx.fnSource('fs_' + t.s.name); },
};
