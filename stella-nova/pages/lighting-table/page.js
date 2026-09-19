// ============================================================================
//  LIGHTING TABLE  ·  page.js — the per-page PAGE object
// ────────────────────────────────────────────────────────────────────────────
//  30 lighting models on an analytic sphere; one WGSL fragment per cell. Drag a cell to orbit the key light; the light also orbits while a cell is hovered.
//  The shared table-engine drives this object through its ctx. main.js fetches
//  the data and calls bootTable(PAGE, data); the engine calls PAGE.init and
//  PAGE.draw from there.
// ============================================================================
export const PAGE = {
  async init(ctx) {
    const { device, format, tiles, PACK } = ctx; this.ctx = ctx;
    this.bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [this.bgl] });
    const module = device.createShaderModule({ code: PACK });
    module.getCompilationInfo().then(info => { const errs = info.messages.filter(m => m.type === 'error'); if (errs.length) for (const t of tiles) ctx.setStatus(t, errs[0].message.slice(0, 120), true); });
    ctx.$('orbit').addEventListener('click', () => { this.lightPx = null; ctx.$('orbit').classList.add('on'); ctx.markAllDirty(); });
    for (const t of tiles) device.createRenderPipelineAsync({ layout, vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: 'fs_' + t.s.name, targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
      .then(p => { t.pipeline = p; t.dirty = true; }).catch(e => ctx.setStatus(t, String(e.message || e).slice(0, 120), true));
  },
  orbit(t) { const a = t.phase * 0.55 + 0.9; return [Math.cos(a) * 0.85, 0.55 + 0.25 * Math.sin(a * 0.7)]; },
  pointer(t, phase, e, el) {
    if (phase === 'up') return;
    this.lightPx = [e.clientX, e.clientY]; this.ctx.markAllDirty(); this.ctx.$('orbit').classList.remove('on');
  },
  // the light is a point above the table: each cell looks toward it from its own center
  lightFor(t, el) {
    if (!this.lightPx) return this.orbit(t);
    const r = el.getBoundingClientRect(); const sz = Math.min(r.width, r.height) / 2;
    const dx = (this.lightPx[0] - (r.left + r.width / 2)) / sz, dy = -(this.lightPx[1] - (r.top + r.height / 2)) / sz;
    const H = 1.7; const n = Math.hypot(dx, dy, H); return [dx / n, dy / n];
  },
  bind(surf) { if (!surf.page.bind) surf.page.bind = this.ctx.device.createBindGroup({ layout: this.bgl, entries: [{ binding: 0, resource: { buffer: surf.buf } }] }); return surf.page.bind; },
  draw(enc, t, surf, rect, dpr, dt, now, moving) {
    const { device, G } = this.ctx; const d = surf.data;
    d[0] = rect.width; d[1] = rect.height; d[2] = t.phase; d[3] = dpr;
    d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); d.set([G.cream[0], G.cream[1], G.cream[2], 1], 12);
    let L = this.lightFor(t, surf.canvas); { const m = Math.hypot(L[0], L[1]); if (m > 0.995) L = [L[0] / m * 0.995, L[1] / m * 0.995]; } d[16] = G.exposure; d[17] = G.ambient; d[18] = L[0]; d[19] = L[1]; d.set(t.knobs, 20);
    device.queue.writeBuffer(surf.buf, 0, d);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: surf.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(t.pipeline); pass.setBindGroup(0, this.bind(surf)); pass.draw(3); pass.end();
  },
};


