// ============================================================================
//  FIELD TABLE  ·  page.js — the per-page PAGE object
// ────────────────────────────────────────────────────────────────────────────
//  24 vector and scalar fields; one WGSL compute shader per cell, combed into a background flow so each reads at rest.
//  The shared table-engine drives this object through its ctx. main.js fetches
//  the data and calls bootTable(PAGE, data); the engine calls PAGE.init and
//  PAGE.draw from there.
//
//  TWO SIMULATIONS. A small tile runs t.page: 4096 particles into a 256 x 256
//  trail (shader mode 0). A large surface runs its own simulation in
//  surf.page.hr (shader mode 1). A large surface is a surf other than t.surf
//  (the screensaver canvas or the inspector) with a canvas long side more
//  than HR_MIN pixels. The inspector canvas is near 235 CSS pixels, so it
//  stays in tile mode at a pixel ratio of 2 or less. The large trail matches
//  the canvas pixels, capped at HR_CAP on the long side. Its domain covers
//  the full frame, and its particle count grows with the trail area. The
//  large surface does not step the tile simulation. A new cell or a new size
//  resets surf.page.hr.
//
//  grep -n targets: "HR_CAP", "HR_MIN", "hrState(", "fillU(", "stepSim("
// ============================================================================
const NP = 4096, TS = 256;          // the small tile simulation
const HR_CAP = 2048;                // long side of the large trail, in texels
const HR_MIN = 512;                 // a surface whose canvas long side is at most this stays in tile mode
const HR_NP_PER_TEXEL = 1 / 250, HR_NP_MAX = 65536;   // sparse enough that each streamer reads as its own line
const UB = 112;                     // FieldU bytes (spec.uniform_bytes is the same)
export const PAGE = {
  async init(ctx) {
    const { device, format, tiles, PACK, $ } = ctx; this.ctx = ctx;
    this.cbgl = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } }, { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rgba16float', access: 'write-only' } }] });
    this.pbgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }] });
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
      pg.ubuf = device.createBuffer({ size: UB, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); pg.udata = new Float32Array(UB / 4);
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
  // FieldU: w, h are the trail size for a simulation pass and the canvas size for a present pass
  fillU(d, t, w, h, dpr, mode = 0, ext = [1, 1], np = NP) {
    const { G } = this.ctx; d[0] = w; d[1] = h; d[2] = t.phase; d[3] = dpr;
    d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); d.set([G.cream[0], G.cream[1], G.cream[2], 1], 12);
    d.set(t.knobs, 16); d[20] = G.speed; d[21] = G.fade; d[22] = t.page.frame; d[23] = t.page.seed;
    d[24] = ext[0]; d[25] = ext[1]; d[26] = mode; d[27] = np;
  },
  // one simulation frame: move, fade, splat. s is t.page or a surf.page.hr state.
  stepSim(enc, t, s, w, h, mode, ext) {
    const { device } = this.ctx; const pg = t.page;
    const d = s.udata; this.fillU(d, t, w, h, 1, mode, ext, s.np); d[22] = s.frame; device.queue.writeBuffer(s.ubuf, 0, d);
    const c = enc.beginComputePass(); c.setPipeline(pg.mv); c.setBindGroup(0, s.cbind[s.cur]); c.dispatchWorkgroups(Math.ceil(s.np / 64));
    c.setPipeline(pg.fd); c.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8)); c.end();
    s.cur = 1 - s.cur;   // the faded trail is now in trail[cur]
    const rp = enc.beginRenderPass({ colorAttachments: [{ view: s.trail[s.cur].createView(), loadOp: 'load', storeOp: 'store' }] });
    rp.setPipeline(pg.pts); rp.setBindGroup(0, s.pbind); rp.draw(6, s.np); rp.end();
    s.frame++;
  },
  // the large-surface simulation for surf, sized to its canvas; rebuilt on a new size, reset on a new cell
  hrState(enc, t, surf) {
    const { device } = this.ctx;
    const cw = surf.cache.width, ch = surf.cache.height, k = Math.min(1, HR_CAP / Math.max(cw, ch));
    const w = Math.max(8, Math.round(cw * k)), h = Math.max(8, Math.round(ch * k));
    let s = surf.page.hr;
    if (!s || s.w !== w || s.h !== h) {
      if (s) { s.parts.destroy(); s.trail.forEach(x => x.destroy()); s.ubuf.destroy(); }
      const np = Math.min(HR_NP_MAX, Math.max(1024, Math.round(w * h * HR_NP_PER_TEXEL / 64) * 64));
      s = surf.page.hr = { w, h, np, t: null, frame: 0, cur: 0, lastFrame: -1, udata: new Float32Array(UB / 4) };
      s.parts = device.createBuffer({ size: np * 16, usage: GPUBufferUsage.STORAGE });
      s.trail = [0, 1].map(() => device.createTexture({ size: [w, h], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }));
      s.ubuf = device.createBuffer({ size: UB, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      s.cbind = [0, 1].map(i => device.createBindGroup({ layout: this.cbgl, entries: [{ binding: 0, resource: { buffer: s.ubuf } }, { binding: 1, resource: { buffer: s.parts } }, { binding: 2, resource: s.trail[i].createView() }, { binding: 3, resource: s.trail[1 - i].createView() }] }));
      s.pbind = device.createBindGroup({ layout: this.pbgl, entries: [{ binding: 0, resource: { buffer: s.ubuf } }, { binding: 1, resource: { buffer: s.parts } }] });
    }
    if (s.t !== t) {   // a new cell: respawn the particles and clear both trails
      s.t = t; s.frame = 0; s.lastFrame = -1;
      for (const x of s.trail) enc.beginRenderPass({ colorAttachments: [{ view: x.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] }).end();
    }
    s.ext = cw >= ch ? [cw / ch, 1] : [1, ch / cw];
    return s;
  },
  draw(enc, t, surf, rect, dpr, dt, now, moving) {
    const { device } = this.ctx; const pg = t.page; if (!pg.pr) return;
    const large = surf !== t.surf && Math.max(surf.cache.width, surf.cache.height) > HR_MIN;
    let src, mode = 0, ext = [1, 1];
    if (large) {
      const s = this.hrState(enc, t, surf); mode = 1; ext = s.ext;
      if (s.lastFrame !== this.ctx.sigTime() && (moving || s.frame === 0)) { s.lastFrame = this.ctx.sigTime(); this.stepSim(enc, t, s, s.w, s.h, 1, s.ext); }
      src = s;
    } else {
      if (pg.lastFrame !== this.ctx.sigTime() && (moving || pg.frame === 0)) { pg.lastFrame = this.ctx.sigTime(); pg.np = NP; this.stepSim(enc, t, pg, TS, TS, 0, ext); }
      src = pg;
    }
    const d = surf.data; this.fillU(d, t, rect.width, rect.height, dpr, mode, ext, src.np); device.queue.writeBuffer(surf.buf, 0, d);
    const tex = src.trail[src.cur];
    if (surf.page.tex !== tex) { surf.page.tex = tex; surf.page.bind = device.createBindGroup({ layout: this.qbgl, entries: [{ binding: 0, resource: { buffer: surf.buf } }, { binding: 1, resource: tex.createView() }] }); }
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: surf.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pg.pr); pass.setBindGroup(0, surf.page.bind); pass.draw(3); pass.end();
  },
  source(t) { return this.ctx.fnSource('v_' + t.s.name); },
};


