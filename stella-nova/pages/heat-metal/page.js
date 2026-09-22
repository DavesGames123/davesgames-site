// ============================================================================
//  HEAT METAL TABLE  ·  page.js — the per-page PAGE object (GENERATED)
// ────────────────────────────────────────────────────────────────────────────
//  60 heat-equation compute simulations; one compute kernel per cell,
//  ping-ponged across two rgba32float textures. The present pass colors the
//  temperature field through a metal palette (MODES picks it per cell). Same
//  runtime as the simulation table. Regenerate with: node build.mjs
// ============================================================================
const MODES = {"orbit":0,"orbit_fast":0,"orbit_slow":1,"lissajous":1,"drift":0,"figure8":2,"spiral":1,"comet":0,"jitter":3,"wobble_ring":7,"billet":2,"billet_pulse":2,"soak":7,"blast":6,"even_glow":2,"core_bloom":1,"ramp_soak":2,"white_hot":6,"twin":0,"triple":1,"line_sweep_h":4,"line_sweep_v":2,"rain":0,"scatter":5,"chase":4,"ring_source":7,"pulse_grid":0,"quench_fade":3,"hard_quench":3,"receding":5,"flicker_die":3,"cool_wave":5,"ember_die":3,"gutter":3,"breathe":5,"grain_h":2,"grain_v":2,"weave":5,"streaky":2,"fiber":7,"layered":5,"rolled":2,"diagonal":1,"advect_swirl":1,"vortex":0,"boil":1,"curl_drift":0,"eddies":4,"plume_rise":0,"convection":1,"storm":0,"smoke_heat":5,"combustion":0,"fire_front":2,"kpp_spread":1,"ignite_wander":0,"flare":4,"autocatalytic":6,"wildfire":0,"chain":1};
const STEPS = {"orbit":4,"orbit_fast":4,"orbit_slow":5,"lissajous":4,"drift":4,"figure8":4,"spiral":4,"comet":5,"jitter":4,"wobble_ring":4,"billet":5,"billet_pulse":5,"soak":6,"blast":5,"even_glow":6,"core_bloom":5,"ramp_soak":5,"white_hot":5,"twin":4,"triple":4,"line_sweep_h":4,"line_sweep_v":4,"rain":4,"scatter":4,"chase":4,"ring_source":4,"pulse_grid":4,"quench_fade":4,"hard_quench":4,"receding":4,"flicker_die":4,"cool_wave":4,"ember_die":4,"gutter":4,"breathe":5,"grain_h":4,"grain_v":4,"weave":4,"streaky":4,"fiber":4,"layered":4,"rolled":4,"diagonal":4,"advect_swirl":4,"vortex":4,"boil":4,"curl_drift":4,"eddies":4,"plume_rise":4,"convection":4,"storm":4,"smoke_heat":4,"combustion":6,"fire_front":6,"kpp_spread":6,"ignite_wander":6,"flare":6,"autocatalytic":6,"wildfire":6,"chain":6};
export const PAGE = {
  async init(ctx) {
    const { device, format, tiles, PACK, $ } = ctx; this.ctx = ctx; const N = 128;
    const module = device.createShaderModule({ code: PACK });
    module.getCompilationInfo().then(info => { const errs = info.messages.filter(m => m.type === 'error'); if (errs.length) for (const t of tiles) ctx.setStatus(t, errs[0].message.slice(0, 120), true); });
    this.cbgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } }, { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rgba32float', access: 'write-only' } }] });
    this.pbgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
    const clayout = device.createPipelineLayout({ bindGroupLayouts: [this.cbgl] }); const playout = device.createPipelineLayout({ bindGroupLayouts: [this.pbgl] });
    this.present = await device.createRenderPipelineAsync({ layout: playout, vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: 'fs_present', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
    for (const t of tiles) {
      const pg = t.page; pg.N = N; pg.frame = 0; pg.seed = Math.random() * 100; pg.reset = true; pg.cur = 0;
      pg.tex = [0, 1].map(() => device.createTexture({ size: [N, N], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING }));
      pg.ubufs = []; pg.cbind = []; pg.ring = 0; pg.udata = new Float32Array(24);
      for (let r = 0; r < 8; r++) { const b = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); pg.ubufs.push(b);
        pg.cbind.push([0, 1].map(i => device.createBindGroup({ layout: this.cbgl, entries: [{ binding: 0, resource: { buffer: b } }, { binding: 1, resource: pg.tex[i].createView() }, { binding: 2, resource: pg.tex[1 - i].createView() }] }))); }
      device.createComputePipelineAsync({ layout: clayout, compute: { module, entryPoint: 'cs_' + t.s.name } })
        .then(p => { pg.cpipe = p; t.pipeline = this.present; t.dirty = true; }).catch(e => ctx.setStatus(t, String(e.message || e).slice(0, 120), true));
    }
    const rb = $('resetall'); if (rb) rb.addEventListener('click', () => { for (const t of tiles) { t.page.reset = true; t.page.seed = Math.random() * 100; t.dirty = true; } });
  },
  leave(t) { t.page.pendingReset = true; t.page.acc = 0; },
  tick(dt, now) { for (const t of this.ctx.tiles) { const pg = t.page; if (pg.pendingReset && t.rate <= 0.002) { pg.pendingReset = false; pg.reset = true; t.dirty = true; } } },
  step(enc, t, reset) {
    const { device } = this.ctx; const pg = t.page; const d = pg.udata;
    d[0] = pg.N; d[1] = pg.N; d[2] = t.phase; d[3] = 1; d.set(t.knobs, 16); d[20] = pg.frame; d[21] = pg.seed; d[22] = 1 / 60; d[23] = reset ? 1 : 0;
    const r = pg.ring; pg.ring = (pg.ring + 1) % 8; device.queue.writeBuffer(pg.ubufs[r], 0, d);
    const pass = enc.beginComputePass(); pass.setPipeline(pg.cpipe); pass.setBindGroup(0, pg.cbind[r][pg.cur]); pass.dispatchWorkgroups(pg.N / 8, pg.N / 8); pass.end();
    pg.cur = 1 - pg.cur; pg.frame++;
  },
  pbind(surf, t) { const key = t.s.name + ':' + t.page.cur; if (surf.page.key !== key) { surf.page.key = key; surf.page.bind = this.ctx.device.createBindGroup({ layout: this.pbgl, entries: [{ binding: 0, resource: { buffer: surf.buf } }, { binding: 1, resource: t.page.tex[t.page.cur].createView() }] }); } return surf.page.bind; },
  draw(enc, t, surf, rect, dpr, dt, now, moving) {
    const { device, G } = this.ctx; const pg = t.page; if (!pg.cpipe) return;
    if (pg.lastFrame !== this.ctx.sigTime()) {
      pg.lastFrame = this.ctx.sigTime();
      if (pg.reset) { pg.reset = false; pg.frame = 0; this.step(enc, t, true); }
      else if (moving && !pg.pendingReset) { pg.acc = (pg.acc || 0) + dt * STEPS[t.s.name] * 12 * (G.tempo || 1) * t.rate; const n = Math.min(8, Math.floor(pg.acc)); pg.acc -= n; for (let i = 0; i < n; i++) this.step(enc, t, false); }
    }
    const d = surf.data;
    d[0] = rect.width; d[1] = rect.height; d[2] = t.phase; d[3] = dpr;
    d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); d.set([G.cream[0], G.cream[1], G.cream[2], 1], 12);
    d.set(t.knobs, 16); d[20] = pg.frame; d[21] = pg.seed; d[22] = 0; d[23] = MODES[t.s.name];
    device.queue.writeBuffer(surf.buf, 0, d);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: surf.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(this.present); pass.setBindGroup(0, this.pbind(surf, t)); pass.draw(3); pass.end();
  },
  source(t) { return this.ctx.fnSource('cs_' + t.s.name); },
};
