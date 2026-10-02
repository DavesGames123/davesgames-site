// ============================================================================
//  SIMULATION TABLE  ·  page.js — the per-page PAGE object
// ────────────────────────────────────────────────────────────────────────────
//  24 cellular automata, reaction-diffusion systems and PDEs; one WGSL compute shader per cell, ping-ponged across two textures.
//  The shared table-engine drives this object through its ctx. main.js fetches
//  the data and calls bootTable(PAGE, data); the engine calls PAGE.init and
//  PAGE.draw from there.
//  SCREENSAVER: spec.saver lists calm sims. saver(t) runs each time the
//  table-engine saver puts a cell on (behind its fade). It reseeds the cell,
//  so a sim that converged or died starts again at each dwell.
//  saverLabel(t, info) adds the live model parameters to the saver plate:
//  SAVER_PARAMS maps each knob to the value its cs_* kernel computes with
//  mix(lo, hi, k), and the line ends with the step count.
// ============================================================================
const MODES = {"life": 0, "brain": 0, "excitable": 1, "cyclic": 1, "forest": 8, "ising": 2, "rps": 7, "schelling": 2, "sandpile": 10, "dla": 11, "majority": 2, "hodgepodge": 1, "gray_scott": 3, "fitzhugh": 9, "mitosis": 3, "lenia": 4, "smoothlife": 4, "eden": 14, "heat": 16, "wave": 9, "advect": 4, "lbm": 5, "sand": 15, "erosion": 4, "highlife": 0, "daynight": 0, "seeds": 0, "maze": 0, "coral": 0, "replicator": 0, "anneal": 0, "gnarl": 0, "move": 0, "stains": 0, "amoeba": 0, "diamoeba": 0, "worms": 3, "waves_rd": 3, "labyrinth": 3, "solitons": 3, "holes": 3, "bz_spiral": 9, "fisher_kpp": 4, "allen_cahn": 9, "burgers": 9, "telegraph": 9, "perona_malik": 4, "ginzburg_landau": 9, "fog_reveal_memory": 17}; const STEPS = {"life": 1, "brain": 1, "excitable": 1, "cyclic": 1, "forest": 1, "ising": 2, "rps": 1, "schelling": 1, "sandpile": 4, "dla": 4, "majority": 1, "hodgepodge": 1, "gray_scott": 8, "fitzhugh": 4, "mitosis": 8, "lenia": 1, "smoothlife": 1, "eden": 2, "heat": 4, "wave": 2, "advect": 1, "lbm": 2, "sand": 3, "erosion": 2, "highlife": 1, "daynight": 1, "seeds": 1, "maze": 1, "coral": 1, "replicator": 1, "anneal": 1, "gnarl": 1, "move": 1, "stains": 1, "amoeba": 1, "diamoeba": 1, "worms": 8, "waves_rd": 8, "labyrinth": 8, "solitons": 8, "holes": 8, "bz_spiral": 4, "fisher_kpp": 4, "allen_cahn": 4, "burgers": 2, "telegraph": 2, "perona_malik": 4, "ginzburg_landau": 2, "fog_reveal_memory": 1};
// [symbol, knob index, lo, hi, decimals]: the mix() calls of the saver cells in shaders/pack.wgsl
const GS = (f0, f1, k0, k1) => [['F', 0, f0, f1, 4], ['k', 1, k0, k1, 4]];
const SAVER_PARAMS = {
  hodgepodge: [['k₁', 0, 1, 4, 2], ['k₂', 1, 1, 4, 2], ['g', 2, 5, 40, 1]],
  gray_scott: GS(0.010, 0.070, 0.045, 0.070), mitosis: GS(0.030, 0.045, 0.060, 0.068),
  waves_rd: GS(0.010, 0.020, 0.042, 0.050), labyrinth: GS(0.026, 0.034, 0.055, 0.062),
  solitons: GS(0.028, 0.034, 0.058, 0.062), holes: GS(0.036, 0.042, 0.056, 0.060),
  fitzhugh: [['a', 0, -0.1, 0.2, 3], ['ε', 1, 0.01, 0.1, 3], ['D_v', 2, 5, 60, 1]],
  lenia: [['μ', 0, 0.10, 0.20, 3], ['σ', 1, 0.010, 0.030, 4]],
  smoothlife: [['b₁', 0, 0.25, 0.30, 3], ['d₂', 1, 0.40, 0.50, 3], ['r', 2, 0.2, 1.0, 2]],
  heat: [['D', 0, 0.05, 0.24, 3], ['r', 1, 0.06, 0.13, 3], ['κ', 2, 0.01, 0.06, 3]],
  wave: [['c²', 0, 0.05, 0.45, 3], ['γ', 1, 0, 0.02, 4], ['p', 2, 0.01, 0.08, 3]],
  allen_cahn: [['ε', 0, 0.5, 1.8, 2]],
  ginzburg_landau: [['α', 0, 0, 1.4, 2], ['β', 1, -1.4, 1.4, 2]],
};
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
      // a ring of uniform buffers so several steps in one frame each carry their own frame number
      pg.ubufs = []; pg.cbind = []; pg.ring = 0; pg.udata = new Float32Array(24);
      for (let r = 0; r < 8; r++) { const b = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); pg.ubufs.push(b);
        pg.cbind.push([0, 1].map(i => device.createBindGroup({ layout: this.cbgl, entries: [{ binding: 0, resource: { buffer: b } }, { binding: 1, resource: pg.tex[i].createView() }, { binding: 2, resource: pg.tex[1 - i].createView() }] }))); }
      device.createComputePipelineAsync({ layout: clayout, compute: { module, entryPoint: 'cs_' + t.s.name } })
        .then(p => { pg.cpipe = p; t.pipeline = this.present; t.dirty = true; }).catch(e => ctx.setStatus(t, String(e.message || e).slice(0, 120), true));
    }
    $('resetall').addEventListener('click', () => { for (const t of tiles) { t.page.reset = true; t.page.seed = Math.random() * 100; t.dirty = true; } });
  },
  leave(t) { t.page.pendingReset = true; t.page.acc = 0; },
  saver(t) { const pg = t.page; pg.pendingReset = false; pg.reset = true; pg.seed = Math.random() * 100; pg.acc = 0; t.dirty = true; },
  saverLabel(t, info) {
    const ps = SAVER_PARAMS[t.s.name];
    if (ps) info.lines.push(ps.map(([n, i, lo, hi, dp]) => `${n} = ${(lo + (hi - lo) * t.knobs[i]).toFixed(dp)}`).join(' · '));
    info.lines.push(`step ${t.page.frame} · 128² grid`);
    return info;
  },
  tick(dt, now) { for (const t of this.ctx.tiles) { const pg = t.page; if (pg.pendingReset && t.rate <= 0.002) { pg.pendingReset = false; pg.reset = true; t.dirty = true; } } },
  knob(t, i) { if (i === 0 && ['life', 'brain', 'excitable', 'cyclic', 'majority', 'dla', 'ising'].includes(t.s.name)) t.page.reset = true; },
  step(enc, t, reset) {
    const { device, G } = this.ctx; const pg = t.page; const d = pg.udata;
    d[0] = pg.N; d[1] = pg.N; d[2] = t.phase; d[3] = 1; d.set(t.knobs, 16); d[20] = pg.frame; d[21] = pg.seed; d[22] = 1 / 60; d[23] = reset ? 1 : 0;
    const r = pg.ring; pg.ring = (pg.ring + 1) % 8; device.queue.writeBuffer(pg.ubufs[r], 0, d);
    const pass = enc.beginComputePass(); pass.setPipeline(pg.cpipe); pass.setBindGroup(0, pg.cbind[r][pg.cur]); pass.dispatchWorkgroups(pg.N / 8, pg.N / 8); pass.end();
    pg.cur = 1 - pg.cur; pg.frame++;
  },
  pbind(surf, t) { const key = t.s.name + ':' + t.page.cur; if (surf.page.key !== key) { surf.page.key = key; surf.page.bind = this.ctx.device.createBindGroup({ layout: this.pbgl, entries: [{ binding: 0, resource: { buffer: surf.buf } }, { binding: 1, resource: t.page.tex[t.page.cur].createView() }] }); } return surf.page.bind; },
  draw(enc, t, surf, rect, dpr, dt, now, moving) {
    const { device, G } = this.ctx; const pg = t.page; if (!pg.cpipe) return;
    // the compute steps happen once per frame per tile (the inspector's canvas shares the state)
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


