// ============================================================================
//  FIELD TABLE  ·  page.js — the per-page PAGE object
// ────────────────────────────────────────────────────────────────────────────
//  24 vector and scalar fields; one WGSL compute shader per cell, combed into a background flow so each reads at rest.
//  The shared table-engine drives this object through its ctx. main.js fetches
//  the data and calls bootTable(PAGE, data); the engine calls PAGE.init and
//  PAGE.draw from there.
// ============================================================================
export const PAGE = {
  async init(ctx) {
    const { device, format, tiles, PACK, $ } = ctx; this.ctx = ctx; const NP = 4096, TS = 256;
    this.cbgl = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } }, { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rgba16float', access: 'write-only' } }] });
    this.pbgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }] });
    this.qbgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }] });
    const cl = device.createPipelineLayout({ bindGroupLayouts: [this.cbgl] }), pl = device.createPipelineLayout({ bindGroupLayouts: [this.pbgl] }), ql = device.createPipelineLayout({ bindGroupLayouts: [this.qbgl] });
    this.modules = {};
    for (const t of tiles) {
      const pg = t.page; pg.frame = 0; pg.seed = Math.random() * 100; pg.cur = 0;
      const code = PACK.replace('__FIELD_FN__', `fn field(p: vec2f, t: f32, k: vec4f) -> vec2f { return v_${t.s.name}(p, t, k); }`);
      const module = device.createShaderModule({ code }); this.modules[t.s.name] = code;
      module.getCompilationInfo().then(info => { const errs = info.messages.filter(m => m.type === 'error'); if (errs.length) ctx.setStatus(t, errs[0].message.slice(0, 120), true); });
      pg.parts = device.createBuffer({ size: NP * 16, usage: GPUBufferUsage.STORAGE });
      pg.trail = [0, 1].map(() => device.createTexture({ size: [TS, TS], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }));
      pg.ubuf = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); pg.udata = new Float32Array(24);
      pg.cbind = [0, 1].map(i => device.createBindGroup({ layout: this.cbgl, entries: [{ binding: 0, resource: { buffer: pg.ubuf } }, { binding: 1, resource: { buffer: pg.parts } }, { binding: 2, resource: pg.trail[i].createView() }, { binding: 3, resource: pg.trail[1 - i].createView() }] }));
      pg.pbind = device.createBindGroup({ layout: this.pbgl, entries: [{ binding: 0, resource: { buffer: pg.ubuf } }, { binding: 1, resource: { buffer: pg.parts } }] });
      Promise.all([
        device.createComputePipelineAsync({ layout: cl, compute: { module, entryPoint: 'cs_move' } }),
        device.createComputePipelineAsync({ layout: cl, compute: { module, entryPoint: 'cs_fade' } }),
        device.createRenderPipelineAsync({ layout: pl, vertex: { module, entryPoint: 'vs_points' }, fragment: { module, entryPoint: 'fs_points', targets: [{ format: 'rgba16float', blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } } }] }, primitive: { topology: 'triangle-list' } }),
        device.createRenderPipelineAsync({ layout: ql, vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: 'fs_present', targets: [{ format }] }, primitive: { topology: 'triangle-list' } }),
      ]).then(([mv, fd, pts, pr]) => { pg.mv = mv; pg.fd = fd; pg.pts = pts; pg.pr = pr; t.pipeline = pr; t.dirty = true; })
        .catch(e => ctx.setStatus(t, String(e.message || e).slice(0, 120), true));
    }
  },
  fillU(d, t, w, h, dpr) {
    const { G } = this.ctx; d[0] = w; d[1] = h; d[2] = t.phase; d[3] = dpr;
    d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); d.set([G.cream[0], G.cream[1], G.cream[2], 1], 12);
    d.set(t.knobs, 16); d[20] = G.speed; d[21] = G.fade; d[22] = t.page.frame; d[23] = t.page.seed;
  },
  draw(enc, t, surf, rect, dpr, dt, now, moving) {
    const { device } = this.ctx; const pg = t.page; if (!pg.pr) return;
    if (pg.lastFrame !== this.ctx.sigTime() && (moving || pg.frame === 0)) {
      pg.lastFrame = this.ctx.sigTime();
      const d = pg.udata; this.fillU(d, t, 256, 256, 1); device.queue.writeBuffer(pg.ubuf, 0, d);
      const c = enc.beginComputePass(); c.setPipeline(pg.mv); c.setBindGroup(0, pg.cbind[pg.cur]); c.dispatchWorkgroups(4096 / 64);
      c.setPipeline(pg.fd); c.dispatchWorkgroups(256 / 8, 256 / 8); c.end();
      pg.cur = 1 - pg.cur;   // the faded trail is now in trail[cur]
      const rp = enc.beginRenderPass({ colorAttachments: [{ view: pg.trail[pg.cur].createView(), loadOp: 'load', storeOp: 'store' }] });
      rp.setPipeline(pg.pts); rp.setBindGroup(0, pg.pbind); rp.draw(6, 4096); rp.end();
      pg.frame++;
    }
    const d = surf.data; this.fillU(d, t, rect.width, rect.height, dpr); device.queue.writeBuffer(surf.buf, 0, d);
    const key = t.s.name + ':' + pg.cur;
    if (surf.page.key !== key) { surf.page.key = key; surf.page.bind = device.createBindGroup({ layout: this.qbgl, entries: [{ binding: 0, resource: { buffer: surf.buf } }, { binding: 1, resource: pg.trail[pg.cur].createView() }] }); }
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: surf.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pg.pr); pass.setBindGroup(0, surf.page.bind); pass.draw(3); pass.end();
  },
  source(t) { return this.ctx.fnSource('v_' + t.s.name); },
};


