
// presets.ts / profiles.ts, ported verbatim
const BASE_PROFILES = {
  globe: { latRings: 17, lonDensity: 44, rBase: 0.6, rDepth: 1.7, rBoost: 1.0, inkFar: 0.62, inkSpan: 0.54, rsPow: 0.6, rMin: 0.3 },
  orbits: { orbitN: 12, ghostN: 40, ghostR: 0.9, ghostA: 0.5, particles: 3, partR: 1.2, partRDepth: 1.6, rsPow: 0.6, rMin: 0.3 },
  rubik: { latRings: 15, lonDensity: 40, moveCount: 14, rBase: 0.6, rDepth: 1.7, rActive: 0.3, inkFar: 0.62, inkSpan: 0.54, rsPow: 0.6, rMin: 0.3 },
  wave: { rings: 15, lonDensity: 40, rBase: 0.6, rDepth: 1.7, rsPow: 0.6, rMin: 0.3 },
  ribbon: { lanes: 5, segs: 88, ghostN: 150, rBase: 1.1, rDepth: 1.7, rsPow: 0.6, rMin: 0.3 },
  morph: { rDot: 0.021, iconD: 1, rMin: 0.25 },
};
const PRESETS = {
  orbits: { 64: { speed: 1.885, count: 1, size: 1 }, 20: { speed: 3.9, count: 0.238, size: 2.4 } },
  globe: { 64: { speed: 2.015, count: 0.42, size: 1.15, extra: { scanMul: 4.08, dimBase: 0.45 } }, 20: { speed: 2.665, count: 0.105, size: 1.75, extra: { scanMul: 4.335, dimBase: 0.45 } } },
  rubik: { 64: { speed: 1.82, count: 0.35, size: 1.05 }, 20: { speed: 1.95, count: 0.088, size: 1.9 } },
  wave: { 64: { speed: 4.388, count: 0.341, size: 1 }, 20: { speed: 3.998, count: 0.105, size: 1.6 } },
  ribbon: { 64: { speed: 2.34, count: 0.25, size: 0.85, extra: { spin: 0, bandMul: 3.9, wobMul: 1 } }, 20: { speed: 3.12, count: 0.051, size: 1.073, extra: { spin: 0, bandMul: 4.94, wobMul: 1 } } },
  morph: { 64: { speed: 2.405, count: 0.54, size: 0.395, extra: { spread: 1.45 } }, 20: { speed: 2.08, count: 0.53, size: 1.011, extra: { spread: 1.45 } } },
};
const COUNT_PAIRS = [['latRings', 'lonDensity'], ['rings', 'lonDensity'], ['lanes', 'segs']], COUNT_KEYS = ['orbitN', 'ghostN'], ICON_DENSITY_KEYS = ['iconD'];
const RADIUS_KEYS = ['rBase', 'rDepth', 'rActive', 'rDot', 'ghostR', 'partR', 'partRDepth'];
function scaleCounts(opts, scale) {
  const out = { ...opts }, done = new Set(), rt = Math.sqrt(scale);
  for (const [a, b] of COUNT_PAIRS) { const va = out[a], vb = out[b]; if (va != null && vb != null && !done.has(a) && !done.has(b)) { out[a] = Math.max(2, Math.round(va * rt)); out[b] = Math.max(2, Math.round(vb * rt)); done.add(a); done.add(b); } }
  for (const k of COUNT_KEYS) { const v = out[k]; if (v != null && !done.has(k)) out[k] = Math.max(1, Math.round(v * scale)); }
  for (const k of ICON_DENSITY_KEYS) { const v = out[k]; if (v != null) out[k] = Math.max(0.02, v * scale); }
  return out;
}
function scaleRadii(opts, scale) { const out = { ...opts }; for (const k of RADIUS_KEYS) { const v = out[k]; if (v != null) out[k] = v * scale; } out.rSizeMul = (out.rSizeMul ?? 1) * scale; return out; }
const OPT_ORDER = ['latRings', 'lonDensity', 'rBase', 'rDepth', 'rBoost', 'inkFar', 'inkSpan', 'rsPow', 'orbitN', 'ghostN', 'ghostR', 'ghostA', 'particles', 'partR', 'partRDepth', 'moveCount', 'rActive', 'rings', 'lanes', 'segs', 'rDot', 'iconD', 'scanMul', 'dimBase', 'spin', 'bandMul', 'wobMul', 'spread', 'rSizeMul', 'rMin', 'size', 'waveAmp'];
const DEFAULTS = { scanMul: 1, dimBase: 1, spin: 1, bandMul: 1, wobMul: 1, spread: 1, rSizeMul: 1, waveAmp: 1, particles: 3, ghostA: 0.5, ghostR: 0.9, rBoost: 1, rActive: 0.3, inkFar: 0.62, inkSpan: 0.54, rsPow: 0.6, rMin: 0.3 };
// resolvePreset, plus the page's multipliers: k0 count, k1 dot size, k3 the mode's own knob
function resolve(t, G) {
  const s = t.s; const mode = s.mode; const k = t.knobs;
  let opts = { ...BASE_PROFILES[mode] }; let speed = 1;
  if (s.size !== 300) { const p = PRESETS[mode][s.size]; speed = p.speed; if (p.count !== 1) opts = scaleCounts(opts, p.count); if (p.size !== 1) opts = scaleRadii(opts, p.size); if (p.extra) opts = { ...opts, ...p.extra }; }
  const cm = Math.pow(4, k[0] - 0.5) * G.count, sm = Math.pow(4, k[1] - 0.5) * G.dots;
  if (cm !== 1) opts = scaleCounts(opts, cm); if (sm !== 1) opts = scaleRadii(opts, sm);
  const k3 = k[3];
  if (mode === 'orbits') opts.particles = Math.max(1, Math.round(1 + 5 * k3));
  if (mode === 'globe') opts.scanMul = (opts.scanMul ?? 1) * Math.pow(4, k3 - 0.5);
  if (mode === 'rubik') opts.moveCount = Math.max(2, Math.round(4 + 20 * k3));
  if (mode === 'wave') opts.waveAmp = 2 * k3;
  if (mode === 'ribbon') opts.wobMul = 2 * k3;
  if (mode === 'morph') opts.spread = (opts.spread ?? 1) * (0.6 + 0.8 * k3);
  opts.size = s.size;
  const o = { ...DEFAULTS, ...opts };
  const packed = new Float32Array(32); OPT_ORDER.forEach((key, i) => { packed[i] = o[key] ?? 0; });
  return { o, packed, speed: speed * Math.pow(4, k[2] - 0.5) };
}
function dotCount(mode, o) {
  const lat = (rings, ld) => { let n = 0; for (let li = 0; li <= rings; li++) { const lat = -Math.PI / 2 + (li / rings) * Math.PI; n += Math.max(1, Math.round(Math.abs(Math.cos(lat)) * ld)); } return n; };
  if (mode === 'orbits') return o.orbitN * (o.ghostN + o.particles);
  if (mode === 'globe' || mode === 'rubik') return lat(o.latRings, o.lonDensity);
  if (mode === 'wave') return lat(o.rings, o.lonDensity);
  if (mode === 'ribbon') return o.ghostN + Math.max(1, Math.round(o.lanes * o.bandMul)) * o.segs;
  return Math.max(6, Math.round(34 * o.iconD));
}
export const PAGE = {
  async init(ctx) {
    const { device, format, tiles, PACK } = ctx; this.ctx = ctx;
    this.bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [this.bgl] });
    const module = device.createShaderModule({ code: PACK });
    module.getCompilationInfo().then(info => { const errs = info.messages.filter(m => m.type === 'error'); if (errs.length) for (const t of tiles) ctx.setStatus(t, errs[0].message.slice(0, 120), true); });
    const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
    this.pipes = {};
    const mk = (mode, write) => device.createRenderPipelineAsync({ layout, vertex: { module, entryPoint: 'vs_' + mode }, fragment: { module, entryPoint: 'fs_main', targets: [{ format, blend }] }, primitive: { topology: 'triangle-list' }, depthStencil: { format: 'depth24plus', depthWriteEnabled: write, depthCompare: 'less-equal' } });
    for (const mode of ['orbits', 'globe', 'rubik', 'wave', 'ribbon', 'morph']) this.pipes[mode] = Promise.all([mk(mode, true), mk(mode, false)]);
    for (const t of tiles) this.pipes[t.s.mode].then(([a, b]) => { t.page.opaque = a; t.page.ghost = b; t.pipeline = a; t.dirty = true; }).catch(e => ctx.setStatus(t, String(e.message || e).slice(0, 120), true));
  },
  surf(surf) {
    const { device } = this.ctx; const p = surf.page; const w = surf.canvas.width, h = surf.canvas.height;
    if (!p.depth || p.w !== w || p.h !== h) { if (p.depth) p.depth.destroy(); p.depth = device.createTexture({ size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT }); p.dv = p.depth.createView(); p.w = w; p.h = h; }
    if (!p.bind) { p.buf2 = device.createBuffer({ size: 208, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); p.bind = device.createBindGroup({ layout: this.bgl, entries: [{ binding: 0, resource: { buffer: surf.buf } }] }); p.bind2 = device.createBindGroup({ layout: this.bgl, entries: [{ binding: 0, resource: { buffer: p.buf2 } }] }); }
    return p;
  },
  draw(enc, t, surf, rect, dpr, dt, now, moving) {
    const { device, G } = this.ctx; if (!t.page.opaque) return;
    const p = this.surf(surf); const r = resolve(t, G); const n = dotCount(t.s.mode, r.o);
    const d = surf.data; const cell = Math.min(rect.width, rect.height);
    d[0] = rect.width; d[1] = rect.height; d[2] = t.phase * r.speed; d[3] = dpr;
    d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); d.set([G.cream[0], G.cream[1], G.cream[2], 1], 12);
    d.set(r.packed, 16); d[48] = cell * dpr / t.s.size; d[49] = 0;
    device.queue.writeBuffer(surf.buf, 0, d); d[49] = 1; device.queue.writeBuffer(p.buf2, 0, d);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: surf.ctx.getCurrentTexture().createView(), clearValue: { r: G.ink[0], g: G.ink[1], b: G.ink[2], a: 1 }, loadOp: 'clear', storeOp: 'store' }], depthStencilAttachment: { view: p.dv, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    pass.setPipeline(t.page.opaque); pass.setBindGroup(0, p.bind); pass.draw(6, n);
    pass.setPipeline(t.page.ghost); pass.setBindGroup(0, p.bind2); pass.draw(6, n);
    pass.end();
  },
  source(t) { return this.ctx.fnSource('dot_' + t.s.mode); },
};

