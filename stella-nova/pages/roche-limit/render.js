// ============================================================================
//  ROCHE LIMIT  ·  render.js — the WebGPU renderer (no DOM beyond the canvas)
// ----------------------------------------------------------------------------
//  Draws one or two SimGPU satellites (engine.js) around the planet. The
//  grains are read from the simulation buffers; nothing is copied to the CPU
//  for drawing. World units are planet radii; the planet is at the origin.
//
//  FRAME
//    compute   particles.wgsl cs_smooth (the stress colour, smoothed in
//              time), ring.wgsl cs_splat for each satellite (shed grains ->
//              grid), cs_resolve (grid -> tau texture, blurred, blended)
//    scene     rgba16float, reversed-Z depth (clear 0, 'greater'): sky,
//              planet surface, grains, ring layer, field heatmap, lines,
//              atmosphere (additive). budget.js picks the sample count:
//              4x MSAA (grains by alpha-to-coverage) at a pixel ratio up
//              to 1.25, else one sample (grains blend, fs_blend)
//    bloom     6 half-size levels down (threshold on the first), then up
//    final     scene + bloom, ACES, vignette, grain, sRGB -> canvas
//  The tau texture ping-pongs: the resolve reads the texture of the frame
//  before and writes the other. Bind group 0 (camera, tau, sampler) has one
//  variant for each texture, so no pass samples the texture it writes.
//
//  grep -n targets
//    camera uniform ...... "function writeCam"
//    targets ............. "resize("
//    sample count ........ "_makeScene("
//    per-satellite ....... "addSim("
//    lines ............... "setSegments("
//    one frame ........... "render("
//    math ................ "export const M4"
// ============================================================================

const MSAA = 4;   // the most samples; resize(w, h, samples) sets the count
const HDR = 'rgba16float';
const DEPTH = 'depth32float';
const BLOOM_LEVELS = 6;

// ── 4x4 matrices, column-major (WGSL mat4x4f) ─────────────────────────────
export const M4 = {
  mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
  // reversed-Z infinite perspective: z/w = near / depth, 1 at near, 0 far
  persp(fovy, aspect, near) { const f = 1 / Math.tan(fovy / 2); const o = new Float32Array(16); o[0] = f / aspect; o[5] = f; o[11] = -1; o[14] = near; return o; },
  lookAt(eye, at, up) {
    const f = norm(sub(at, eye)), r = norm(cross(f, up)), u = cross(r, f);
    const o = new Float32Array(16);
    o[0] = r[0]; o[4] = r[1]; o[8] = r[2]; o[12] = -dot(r, eye);
    o[1] = u[0]; o[5] = u[1]; o[9] = u[2]; o[13] = -dot(u, eye);
    o[2] = -f[0]; o[6] = -f[1]; o[10] = -f[2]; o[14] = dot(f, eye);
    o[15] = 1;
    return { m: o, r, u, f };
  },
};
export function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
export function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

export async function loadRenderCode() {
  const names = ['particles', 'planet', 'ring', 'field', 'lines', 'post'];
  const out = {};
  await Promise.all(names.map(async n => {
    const r = await fetch(new URL(`./shaders/${n}.wgsl`, import.meta.url));
    if (!r.ok) throw new Error(`${n}.wgsl: HTTP ${r.status}`);
    out[n] = await r.text();
  }));
  return out;
}

export class Renderer {
  constructor(device, context, format, code, opts = {}) {
    this.dev = device; this.ctx = context; this.format = format;
    this.gridN = opts.gridN || 1024;
    this.sims = [];
    this.segCap = 0; this.segCount = 0;
    this.camData = new Float32Array(100);
    this.prevVp = null;
    this.ping = 0;
    this.W = 0; this.H = 0;
    this.modules = {};
    for (const [k, v] of Object.entries(code)) this.modules[k] = device.createShaderModule({ code: v, label: 'roche ' + k + '.wgsl' });
    this._make();
  }
  _makeBG0() {
    this.bg0 = this.tau.map(t => this.dev.createBindGroup({ layout: this.bgl0, entries: [
      { binding: 0, resource: { buffer: this.camBuf } }, { binding: 1, resource: t.createView() }, { binding: 2, resource: this.samp },
      { binding: 3, resource: this.planetTex.createView() }] }));
  }
  // A planet map (planet.wgsl style 5): levels = [ImageBitmap, ...], level
  // 0 the full size, each next level half the size. writeCam picks the mip
  // level from the size of the disc on screen.
  setPlanetTexture(levels) {
    const dev = this.dev, T = GPUTextureUsage;
    if (this.planetTex) this.planetTex.destroy();
    this.planetTex = dev.createTexture({ size: [levels[0].width, levels[0].height], mipLevelCount: levels.length, format: 'rgba8unorm', usage: T.TEXTURE_BINDING | T.COPY_DST | T.RENDER_ATTACHMENT });
    levels.forEach((b, i) => dev.queue.copyExternalImageToTexture({ source: b }, { texture: this.planetTex, mipLevel: i }, [b.width, b.height]));
    this.planetTexW = levels[0].width; this.planetMips = levels.length;
    this._makeBG0();
  }
  async compilationMessages() {
    const out = [];
    for (const [k, m] of Object.entries(this.modules)) { const info = await m.getCompilationInfo(); for (const x of info.messages) out.push(`${k}.wgsl ${x.type} ${x.lineNum}:${x.linePos} ${x.message}`); }
    return out;
  }
  _make() {
    const dev = this.dev, U = GPUBufferUsage, T = GPUTextureUsage, S = GPUShaderStage;
    const ALL = S.VERTEX | S.FRAGMENT | S.COMPUTE;
    this.camBuf = dev.createBuffer({ size: 400, usage: U.UNIFORM | U.COPY_DST });
    const n = this.gridN;
    this.grid = dev.createBuffer({ size: n * n * 4, usage: U.STORAGE | U.COPY_DST });
    this.tau = [0, 1].map(() => dev.createTexture({ size: [n, n], format: 'rgba16float', usage: T.TEXTURE_BINDING | T.STORAGE_BINDING }));
    this.bgl0 = dev.createBindGroupLayout({ entries: [
      { binding: 0, visibility: ALL, buffer: { type: 'uniform' } },
      { binding: 1, visibility: ALL, texture: { sampleType: 'float' } },
      { binding: 2, visibility: ALL, sampler: { type: 'filtering' } },
      { binding: 3, visibility: S.FRAGMENT, texture: { sampleType: 'float' } },
    ] });
    this.planetTex = dev.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: T.TEXTURE_BINDING | T.COPY_DST });
    // one sampler for the tau texture, the planet map and the post passes:
    // clamp on both axes (the planet map seam is at most half a texel)
    this.samp = dev.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.sampClamp = this.samp;
    this._makeBG0();
    const ro = { type: 'read-only-storage' };
    this.bglPart = dev.createBindGroupLayout({ entries: [
      { binding: 0, visibility: S.VERTEX, buffer: ro }, { binding: 1, visibility: S.VERTEX, buffer: ro },
      { binding: 2, visibility: S.VERTEX, buffer: ro }, { binding: 3, visibility: S.VERTEX | S.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 4, visibility: S.VERTEX, buffer: ro }] });
    this.bglSmooth = dev.createBindGroupLayout({ entries: [
      { binding: 3, visibility: S.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 5, visibility: S.COMPUTE, buffer: { type: 'storage' } }, { binding: 6, visibility: S.COMPUTE, buffer: { type: 'storage' } }] });
    this.bglSplat = dev.createBindGroupLayout({ entries: [
      { binding: 0, visibility: S.COMPUTE, buffer: ro }, { binding: 1, visibility: S.COMPUTE, buffer: ro },
      { binding: 2, visibility: S.COMPUTE, buffer: { type: 'uniform' } }, { binding: 3, visibility: S.COMPUTE, buffer: { type: 'storage' } }] });
    this.bglResolve = dev.createBindGroupLayout({ entries: [
      { binding: 4, visibility: S.COMPUTE, buffer: { type: 'storage' } },
      { binding: 5, visibility: S.COMPUTE, texture: { sampleType: 'float' } },
      { binding: 6, visibility: S.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } }] });
    this.bglSeg = dev.createBindGroupLayout({ entries: [{ binding: 0, visibility: S.VERTEX, buffer: ro }] });
    const pl = (...g) => dev.createPipelineLayout({ bindGroupLayouts: g });
    this.resolveBG = [0, 1].map(i => dev.createBindGroup({ layout: this.bglResolve, entries: [
      { binding: 4, resource: { buffer: this.grid } }, { binding: 5, resource: this.tau[1 - i].createView() }, { binding: 6, resource: this.tau[i].createView() }] }));
    const M = this.modules;
    this.pSplat = dev.createComputePipeline({ layout: pl(this.bgl0, this.bglSplat), compute: { module: M.ring, entryPoint: 'cs_splat' } });
    this.pSmooth = dev.createComputePipeline({ layout: pl(this.bgl0, this.bglSmooth), compute: { module: M.particles, entryPoint: 'cs_smooth' } });
    this.pResolve = dev.createComputePipeline({ layout: pl(this.bgl0, this.bglResolve), compute: { module: M.ring, entryPoint: 'cs_resolve' } });
    this._mods = { M, pl };
    this.samples = 0;
    this._makeScene(MSAA);
    // post
    this.bglPost = dev.createBindGroupLayout({ entries: [
      { binding: 0, visibility: S.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: S.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: S.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 3, visibility: S.FRAGMENT, texture: { sampleType: 'float' } }] });
    const pp = (fs, fmt, blend) => dev.createRenderPipeline({ layout: pl(this.bglPost), vertex: { module: M.post, entryPoint: 'vs_post' },
      fragment: { module: M.post, entryPoint: fs, targets: [blend ? { format: fmt, blend } : { format: fmt }] }, primitive: { topology: 'triangle-list' } });
    this.pDown = pp('fs_down', HDR, null);
    this.pUp = pp('fs_up', HDR, { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } });
    this.pFinal = pp('fs_final', this.format, null);
    this.postBufs = Array.from({ length: 2 * BLOOM_LEVELS + 1 }, () => dev.createBuffer({ size: 32, usage: U.UNIFORM | U.COPY_DST }));
    this.dummy = dev.createTexture({ size: [1, 1], format: HDR, usage: T.TEXTURE_BINDING });
  }
  // The scene pipelines for a sample count (4 or 1). With one sample the
  // grains cannot use alpha-to-coverage: they blend (premultiplied, depth
  // still written), from fs_blend.
  _makeScene(samples) {
    if (samples === this.samples) return;
    this.samples = samples;
    const dev = this.dev, { M, pl } = this._mods, ms = { count: samples };
    const premul = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
    const add = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } };
    const depthW = { format: DEPTH, depthWriteEnabled: true, depthCompare: 'greater' };
    const depthT = { format: DEPTH, depthWriteEnabled: false, depthCompare: 'greater' };
    const depthNone = { format: DEPTH, depthWriteEnabled: false, depthCompare: 'always' };
    const rp = (mod, vs, fs, layout, blend, depth, extra = {}) => dev.createRenderPipeline({
      layout, vertex: { module: mod, entryPoint: vs },
      fragment: { module: mod, entryPoint: fs, targets: [blend ? { format: HDR, blend } : { format: HDR }] },
      primitive: { topology: 'triangle-list' }, depthStencil: depth, multisample: Object.assign({}, ms, extra) });
    this.pSky = rp(M.planet, 'vs_full', 'fs_sky', pl(this.bgl0), null, depthNone);
    this.pSurface = rp(M.planet, 'vs_full', 'fs_surface', pl(this.bgl0), null, depthW);
    this.pAtmo = rp(M.planet, 'vs_full', 'fs_atmo', pl(this.bgl0), add, depthT);
    this.pPart = samples > 1
      ? rp(M.particles, 'vs_main', 'fs_main', pl(this.bgl0, this.bglPart), null, depthW, { alphaToCoverageEnabled: true })
      : rp(M.particles, 'vs_main', 'fs_blend', pl(this.bgl0, this.bglPart), premul, depthW);
    this.pDisk = rp(M.ring, 'vs_disk', 'fs_disk', pl(this.bgl0), premul, depthT);
    this.pField = rp(M.field, 'vs_field', 'fs_field', pl(this.bgl0), premul, depthT);
    this.pLine = rp(M.lines, 'vs_line', 'fs_line', pl(this.bgl0, this.bglSeg), premul, depthT);
  }
  // w, h: the drawing buffer; samples: 4 or 1 (budget.js renderBudget)
  resize(w, h, samples = this.samples || MSAA) {
    w = Math.max(2, Math.floor(w)); h = Math.max(2, Math.floor(h));
    if (w === this.W && h === this.H && samples === this.samples) return;
    this._makeScene(samples);
    this.W = w; this.H = h;
    const dev = this.dev, T = GPUTextureUsage;
    for (const t of [this.msaaTex, this.depthTex, this.hdrTex, ...(this.bloom || [])]) if (t) t.destroy();
    this.msaaTex = samples > 1 ? dev.createTexture({ size: [w, h], format: HDR, sampleCount: samples, usage: T.RENDER_ATTACHMENT }) : null;
    this.depthTex = dev.createTexture({ size: [w, h], format: DEPTH, sampleCount: samples, usage: T.RENDER_ATTACHMENT });
    this.hdrTex = dev.createTexture({ size: [w, h], format: HDR, usage: T.RENDER_ATTACHMENT | T.TEXTURE_BINDING });
    this.msaaView = this.msaaTex ? this.msaaTex.createView() : null; this.depthView = this.depthTex.createView(); this.hdrView = this.hdrTex.createView();
    this.bloom = [];
    let bw = w, bh = h;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
      this.bloom.push(dev.createTexture({ size: [bw, bh], format: HDR, usage: T.RENDER_ATTACHMENT | T.TEXTURE_BINDING }));
    }
    this.bloomViews = this.bloom.map(t => t.createView());
    const mk = (buf, src, bl) => dev.createBindGroup({ layout: this.bglPost, entries: [
      { binding: 0, resource: { buffer: buf } }, { binding: 1, resource: src.createView() }, { binding: 2, resource: this.sampClamp }, { binding: 3, resource: (bl || this.dummy).createView() }] });
    this.downBG = this.bloom.map((t, i) => mk(this.postBufs[i], i === 0 ? this.hdrTex : this.bloom[i - 1]));
    this.upBG = this.bloom.slice(0, -1).map((t, i) => mk(this.postBufs[BLOOM_LEVELS + i], this.bloom[i + 1]));
    this.finalBG = mk(this.postBufs[2 * BLOOM_LEVELS], this.hdrTex, this.bloom[0]);
  }
  // A satellite: per-sim tag buffer, instance uniform, bind groups.
  addSim(sim) {
    const dev = this.dev, U = GPUBufferUsage;
    const e = { sim };
    e.tagBuf = dev.createBuffer({ size: sim.np * 4, usage: U.STORAGE | U.COPY_DST });
    dev.queue.writeBuffer(e.tagBuf, 0, new Float32Array(sim.np).fill(-1));
    e.inst = dev.createBuffer({ size: 96, usage: U.UNIFORM | U.COPY_DST });
    e.stress = dev.createBuffer({ size: sim.np * 8, usage: U.STORAGE });
    e.fresh = true;   // the first smoothing pass takes the value as it is
    e.bgPart = dev.createBindGroup({ layout: this.bglPart, entries: [
      { binding: 0, resource: { buffer: sim.bufBody } }, { binding: 1, resource: { buffer: sim.bufDiag } },
      { binding: 2, resource: { buffer: e.tagBuf } }, { binding: 3, resource: { buffer: e.inst } },
      { binding: 4, resource: { buffer: e.stress } }] });
    e.bgSmooth = dev.createBindGroup({ layout: this.bglSmooth, entries: [
      { binding: 3, resource: { buffer: e.inst } },
      { binding: 5, resource: { buffer: e.stress } }, { binding: 6, resource: { buffer: sim.bufDiag } }] });
    e.bgSplat = dev.createBindGroup({ layout: this.bglSplat, entries: [
      { binding: 0, resource: { buffer: sim.bufBody } }, { binding: 1, resource: { buffer: e.tagBuf } },
      { binding: 2, resource: { buffer: e.inst } }, { binding: 3, resource: { buffer: this.grid } }] });
    this.sims.push(e);
    return e;
  }
  removeSims() { for (const e of this.sims) { e.tagBuf.destroy(); e.inst.destroy(); e.stress.destroy(); } this.sims = []; }
  setTags(e, tags) { this.dev.queue.writeBuffer(e.tagBuf, 0, tags); }
  // segs: Float32Array, 16 floats per segment (a.xyz w, b.xyz -, ca, cb)
  setSegments(segs, count) {
    if (count > this.segCap) {
      if (this.segBuf) this.segBuf.destroy();
      this.segCap = Math.max(1024, count * 1.5 | 0);
      this.segBuf = this.dev.createBuffer({ size: this.segCap * 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.segBG = this.dev.createBindGroup({ layout: this.bglSeg, entries: [{ binding: 0, resource: { buffer: this.segBuf } }] });
    }
    if (count) this.dev.queue.writeBuffer(this.segBuf, 0, segs, 0, count * 16);
    this.segCount = count;
  }
  // Fill the camera uniform. f: frame description from main.js.
  writeCam(f) {
    const d = this.camData, W = this.W, H = this.H;
    const view = M4.lookAt(f.eye, f.target, f.up || [0, 0, 1]);
    const proj = M4.persp(f.fov, W / H, f.near);
    // sub-rectangle framing (the clear band): shift the projection centre
    if (f.shift) { proj[8] = f.shift[0]; proj[9] = f.shift[1]; }
    const vp = M4.mul(proj, view.m);
    d.set(vp, 0); d.set(this.prevVp || vp, 16); d.set(view.m, 32);
    this.prevVp = vp;
    const put = (o, a, w = 0) => { d[o] = a[0]; d[o + 1] = a[1]; d[o + 2] = a[2]; d[o + 3] = w; };
    put(48, f.eye, f.time || 0);
    put(52, f.sun, f.sunI);
    d[56] = W; d[57] = H; d[58] = 1 / W; d[59] = 1 / H;
    put(60, view.r); put(64, view.u); put(68, view.f);
    d[72] = f.atm; d[73] = f.spin; d[74] = f.style; d[75] = f.shine;
    const focal = 0.5 * H / Math.tan(f.fov / 2);
    d[76] = focal; d[77] = f.time || 0; d[78] = f.exposure || 1; d[79] = f.grainR || 0;
    put(80, f.sat || [0, 0, 0], f.satR || 0);
    d[84] = f.GMs || 0; d[85] = f.GMp || 0; d[86] = f.omega || 0; d[87] = f.phiL1 || 0;
    d[88] = f.fieldMode || 0; d[89] = f.fieldExt || 4; d[90] = f.fieldScale || 1; d[91] = f.fieldAlpha || 0;
    d[92] = f.ringExt; d[93] = this.gridN; d[94] = f.ringGain; d[95] = f.ringBlend;
    // the planet map level: the texels per screen pixel across the disc
    let lod = 0;
    if (this.planetTexW) { const rpx = focal / Math.max(1e-3, Math.hypot(...f.eye)); lod = Math.max(0, Math.min(this.planetMips - 1, Math.log2(this.planetTexW / (Math.PI * 2 * rpx)))); }
    d[96] = f.flattening || 0; d[97] = lod; d[98] = f.realRings || 0; d[99] = 0;
    // vp shift is in clip space; the shaders' px math assumes a centred
    // projection, so the shift must stay 0 for grains (main.js uses a
    // target offset for framing instead)
    this.dev.queue.writeBuffer(this.camBuf, 0, d);
    this.view = view; this.vp = vp; this.focal = focal;
  }
  // Project a world point to CSS px of the canvas (for DOM labels).
  project(p, cssW, cssH) {
    const m = this.vp; if (!m) return null;
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (w <= 1e-4) return null;
    return { x: (x / w * 0.5 + 0.5) * cssW, y: (0.5 - y / w * 0.5) * cssH, w };
  }
  // One frame. f: camera and overlay state; sims: [{ e, frame:[x,y,z,k],
  // refV:[vx,vy,vz, sim time of one frame], opts:[mode, stressMix, bright,
  // vesc], tint, motion:[streaks 0/1, dim above px, stress smoothing,
  // heat decay], heatInv: 1 / the reference collision heat, simT: the sim
  // time now, flashT: how long an impact flash lasts (sim time), strain:
  // the strain share of the default colour mode }].
  // The stages of a frame, each encoded into enc. draws (optional) picks
  // the scene draws, for profiling: { sky, surface, part, disk, field,
  // lines, atmo }.
  // GPU timestamps for profiling: when this.tsw is set, every pass writes
  // its begin and end into the next two queries, tagged with a stage name.
  _tw(stage) {
    const t = this.tsw; if (!t || t.n + 2 > t.cap) return undefined;
    const i = t.n; t.n += 2; t.tags.push(stage);
    return { querySet: t.qs, beginningOfPassWriteIndex: i, endOfPassWriteIndex: i + 1 };
  }
  _uniforms(f, sims) {
    const dev = this.dev;
    this.writeCam(f);
    for (const s of sims) {
      const a = this._instData || (this._instData = new Float32Array(24));
      const m = s.motion || [0, 0, 0.1, 1];
      a.set(s.frame, 0); a.set(s.refV, 4); a.set(s.opts, 8); a.set(s.tint || [0.80, 0.88, 1.0, 1], 12);
      a[16] = m[0]; a[17] = m[1]; a[18] = s.e.fresh ? 1 : m[2]; a[19] = s.e.fresh ? 0 : (m[3] ?? 1);
      a[20] = s.heatInv || 1; a[21] = s.simT || 0; a[22] = s.flashT || 0; a[23] = s.strain ?? 1;
      s.e.fresh = false;
      dev.queue.writeBuffer(s.e.inst, 0, a);
    }
  }
  _compute(enc, f, sims) {
    const cur = this.ping = 1 - this.ping;
    enc.clearBuffer(this.grid);
    const pass = enc.beginComputePass({ timestampWrites: this._tw('ringCompute') });
    pass.setPipeline(this.pSplat); pass.setBindGroup(0, this.bg0[1 - cur]);
    for (const s of sims) { if (!s.ring) continue; pass.setBindGroup(1, s.e.bgSplat); pass.dispatchWorkgroups(Math.ceil(s.e.sim.np / 64)); }
    pass.setPipeline(this.pSmooth); pass.setBindGroup(0, this.bg0[1 - cur]);
    for (const s of sims) { pass.setBindGroup(1, s.e.bgSmooth); pass.dispatchWorkgroups(Math.ceil(s.e.sim.np / 64)); }
    pass.setPipeline(this.pResolve); pass.setBindGroup(0, this.bg0[1 - cur]); pass.setBindGroup(1, this.resolveBG[cur]);
    pass.dispatchWorkgroups(Math.ceil(this.gridN / 8), Math.ceil(this.gridN / 8));
    pass.end();
  }
  _scene(enc, f, sims, draws) {
    const on = k => !draws || draws[k];
    const pass = enc.beginRenderPass({
      colorAttachments: [this.msaaView
        ? { view: this.msaaView, resolveTarget: this.hdrView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'discard' }
        : { view: this.hdrView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: this.depthView, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      timestampWrites: this._tw('scene'),
    });
    pass.setBindGroup(0, this.bg0[this.ping]);
    if (on('sky')) { pass.setPipeline(this.pSky); pass.draw(3); }
    if (on('surface')) { pass.setPipeline(this.pSurface); pass.draw(3); }
    if (on('part')) { pass.setPipeline(this.pPart); for (const s of sims) { pass.setBindGroup(1, s.e.bgPart); pass.draw(6, s.e.sim.N); } }
    if (on('disk') && f.ringOn) { pass.setPipeline(this.pDisk); pass.draw(6); }
    if (on('field') && f.fieldMode && f.fieldAlpha > 0) { pass.setPipeline(this.pField); pass.draw(6); }
    if (on('lines') && this.segCount) { pass.setPipeline(this.pLine); pass.setBindGroup(1, this.segBG); pass.draw(6, this.segCount); }
    if (on('atmo')) { pass.setPipeline(this.pAtmo); pass.draw(3); }
    pass.end();
  }
  _bloom(enc, f) {
    const dev = this.dev, pb = this._pb || (this._pb = new Float32Array(8));
    let sw = this.W, sh = this.H;
    const levels = f.bloom > 0 ? this.bloom.length : 0;
    for (let i = 0; i < levels; i++) {
      pb[0] = 1 / sw; pb[1] = 1 / sh; pb[2] = i === 0 ? (f.bloomThreshold ?? 1.0) : 0; pb[3] = 0.5;
      dev.queue.writeBuffer(this.postBufs[i], 0, pb);
      const t = this.bloom[i];
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.bloomViews[i], loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }], timestampWrites: this._tw('bloom') });
      pass.setPipeline(this.pDown); pass.setBindGroup(0, this.downBG[i]); pass.draw(3); pass.end();
      sw = t.width; sh = t.height;
    }
    for (let i = levels - 2; i >= 0; i--) {
      const small = this.bloom[i + 1];
      pb[0] = 1 / small.width; pb[1] = 1 / small.height; pb[2] = 0; pb[3] = 0;
      dev.queue.writeBuffer(this.postBufs[BLOOM_LEVELS + i], 0, pb);
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.bloomViews[i], loadOp: 'load', storeOp: 'store' }], timestampWrites: this._tw('bloom') });
      pass.setPipeline(this.pUp); pass.setBindGroup(0, this.upBG[i]); pass.draw(3); pass.end();
    }
  }
  _final(enc, f) {
    const pb = this._pb || (this._pb = new Float32Array(8));
    pb[0] = 1 / this.W; pb[1] = 1 / this.H; pb[2] = 0; pb[3] = 0;
    pb[4] = f.bloom > 0 ? f.bloom : 0; pb[5] = f.exposure ?? 1; pb[6] = f.vignette ?? 0.35; pb[7] = (f.time || 0) % 100;
    this.dev.queue.writeBuffer(this.postBufs[2 * BLOOM_LEVELS], 0, pb);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }], timestampWrites: this._tw('final') });
    pass.setPipeline(this.pFinal); pass.setBindGroup(0, this.finalBG); pass.draw(3); pass.end();
  }
  // One frame. f: camera and overlay state; sims: [{ e, frame:[x,y,z,k],
  // refV:[vx,vy,vz, sim time of one frame], opts:[mode, stressMix, bright,
  // vesc], tint, motion:[streaks 0/1, dim above px, stress smoothing,
  // heat decay], heatInv: 1 / the reference collision heat }].
  render(f, sims) {
    this._uniforms(f, sims);
    const enc = this.dev.createCommandEncoder();
    this._compute(enc, f, sims); this._scene(enc, f, sims); this._bloom(enc, f); this._final(enc, f);
    this.dev.queue.submit([enc.finish()]);
  }
  // The same frame, one submit per stage, each timed to its completion on
  // the queue (ms). Profiling only: it stalls on the GPU after each stage.
  async renderTimed(f, sims, draws) {
    const dev = this.dev, out = {};
    this._uniforms(f, sims);
    const run = async (name, fn) => { await dev.queue.onSubmittedWorkDone(); const t0 = performance.now(); const enc = dev.createCommandEncoder(); fn(enc); dev.queue.submit([enc.finish()]); await dev.queue.onSubmittedWorkDone(); out[name] = performance.now() - t0; };
    await run('ringCompute', enc => this._compute(enc, f, sims));
    await run('scene', enc => this._scene(enc, f, sims, draws));
    await run('bloom', enc => this._bloom(enc, f));
    await run('final', enc => this._final(enc, f));
    return out;
  }
  // GPU time per stage from timestamp queries (needs the device feature
  // 'timestamp-query'). extra(enc): more passes to time in the same
  // submit (the sim), tagged through this._tw.
  async renderGPU(f, sims, draws, extra) {
    const dev = this.dev;
    if (!this.tsQS) {
      this.tsQS = dev.createQuerySet({ type: 'timestamp', count: 64 });
      this.tsBuf = dev.createBuffer({ size: 64 * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
      this.tsRead = dev.createBuffer({ size: 64 * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    }
    this.tsw = { qs: this.tsQS, n: 0, cap: 64, tags: [] };
    this._uniforms(f, sims);
    const enc = dev.createCommandEncoder();
    if (extra) extra(enc);
    this._compute(enc, f, sims); this._scene(enc, f, sims, draws); this._bloom(enc, f); this._final(enc, f);
    const t = this.tsw; this.tsw = null;
    enc.resolveQuerySet(this.tsQS, 0, t.n, this.tsBuf, 0);
    enc.copyBufferToBuffer(this.tsBuf, 0, this.tsRead, 0, t.n * 8);
    dev.queue.submit([enc.finish()]);
    await this.tsRead.mapAsync(GPUMapMode.READ);
    const v = new BigUint64Array(this.tsRead.getMappedRange().slice(0, t.n * 8)); this.tsRead.unmap();
    const out = {};
    for (let i = 0; i < t.tags.length; i++) { const ms = Number(v[2 * i + 1] - v[2 * i]) / 1e6; out[t.tags[i]] = (out[t.tags[i]] || 0) + ms; }
    return out;
  }
}
