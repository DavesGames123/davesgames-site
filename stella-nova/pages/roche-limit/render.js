// ============================================================================
//  ROCHE LIMIT  ·  render.js — the WebGPU renderer (no DOM beyond the canvas)
// ----------------------------------------------------------------------------
//  Draws one or two SimGPU satellites (engine.js) around the planet. The
//  grains are read from the simulation buffers; nothing is copied to the CPU
//  for drawing. World units are planet radii; the planet is at the origin.
//
//  FRAME
//    compute   ring.wgsl cs_splat for each satellite (shed grains -> grid),
//              cs_resolve (grid -> tau texture, blurred, time-blended)
//    scene     4x MSAA, rgba16float, reversed-Z depth (clear 0, 'greater'):
//              sky, planet surface, grains (alpha-to-coverage), ring layer,
//              field heatmap, lines, atmosphere (additive)
//    bloom     6 half-size levels down (threshold on the first), then up
//    final     scene + bloom, ACES, vignette, grain, sRGB -> canvas
//  The tau texture ping-pongs: the resolve reads the texture of the frame
//  before and writes the other. Bind group 0 (camera, tau, sampler) has one
//  variant for each texture, so no pass samples the texture it writes.
//
//  grep -n targets
//    camera uniform ...... "function writeCam"
//    targets ............. "resize("
//    per-satellite ....... "addSim("
//    lines ............... "setSegments("
//    one frame ........... "render("
//    math ................ "export const M4"
// ============================================================================

const MSAA = 4;
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
    this.camData = new Float32Array(96);
    this.prevVp = null;
    this.ping = 0;
    this.W = 0; this.H = 0;
    this.modules = {};
    for (const [k, v] of Object.entries(code)) this.modules[k] = device.createShaderModule({ code: v, label: 'roche ' + k + '.wgsl' });
    this._make();
  }
  async compilationMessages() {
    const out = [];
    for (const [k, m] of Object.entries(this.modules)) { const info = await m.getCompilationInfo(); for (const x of info.messages) out.push(`${k}.wgsl ${x.type} ${x.lineNum}:${x.linePos} ${x.message}`); }
    return out;
  }
  _make() {
    const dev = this.dev, U = GPUBufferUsage, T = GPUTextureUsage, S = GPUShaderStage;
    const ALL = S.VERTEX | S.FRAGMENT | S.COMPUTE;
    this.camBuf = dev.createBuffer({ size: 384, usage: U.UNIFORM | U.COPY_DST });
    this.samp = dev.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    const n = this.gridN;
    this.grid = dev.createBuffer({ size: n * n * 4, usage: U.STORAGE | U.COPY_DST });
    this.tau = [0, 1].map(() => dev.createTexture({ size: [n, n], format: 'rgba16float', usage: T.TEXTURE_BINDING | T.STORAGE_BINDING }));
    this.bgl0 = dev.createBindGroupLayout({ entries: [
      { binding: 0, visibility: ALL, buffer: { type: 'uniform' } },
      { binding: 1, visibility: ALL, texture: { sampleType: 'float' } },
      { binding: 2, visibility: ALL, sampler: { type: 'filtering' } },
    ] });
    this.bg0 = this.tau.map(t => dev.createBindGroup({ layout: this.bgl0, entries: [
      { binding: 0, resource: { buffer: this.camBuf } }, { binding: 1, resource: t.createView() }, { binding: 2, resource: this.samp }] }));
    const ro = { type: 'read-only-storage' };
    this.bglPart = dev.createBindGroupLayout({ entries: [
      { binding: 0, visibility: S.VERTEX, buffer: ro }, { binding: 1, visibility: S.VERTEX, buffer: ro },
      { binding: 2, visibility: S.VERTEX, buffer: ro }, { binding: 3, visibility: S.VERTEX | S.FRAGMENT, buffer: { type: 'uniform' } }] });
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
    this.pResolve = dev.createComputePipeline({ layout: pl(this.bgl0, this.bglResolve), compute: { module: M.ring, entryPoint: 'cs_resolve' } });
    const ms = { count: MSAA };
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
    this.pPart = rp(M.particles, 'vs_main', 'fs_main', pl(this.bgl0, this.bglPart), null, depthW, { alphaToCoverageEnabled: true });
    this.pDisk = rp(M.ring, 'vs_disk', 'fs_disk', pl(this.bgl0), premul, depthT);
    this.pField = rp(M.field, 'vs_field', 'fs_field', pl(this.bgl0), premul, depthT);
    this.pLine = rp(M.lines, 'vs_line', 'fs_line', pl(this.bgl0, this.bglSeg), premul, depthT);
    // post
    this.bglPost = dev.createBindGroupLayout({ entries: [
      { binding: 0, visibility: S.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: S.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: S.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 3, visibility: S.FRAGMENT, texture: { sampleType: 'float' } }] });
    const pp = (fs, fmt, blend) => dev.createRenderPipeline({ layout: pl(this.bglPost), vertex: { module: M.post, entryPoint: 'vs_post' },
      fragment: { module: M.post, entryPoint: fs, targets: [blend ? { format: fmt, blend } : { format: fmt }] }, primitive: { topology: 'triangle-list' } });
    this.pDown = pp('fs_down', HDR, null);
    this.pUp = pp('fs_up', HDR, add);
    this.pFinal = pp('fs_final', this.format, null);
    this.postBufs = Array.from({ length: 2 * BLOOM_LEVELS + 1 }, () => dev.createBuffer({ size: 32, usage: U.UNIFORM | U.COPY_DST }));
    this.dummy = dev.createTexture({ size: [1, 1], format: HDR, usage: T.TEXTURE_BINDING });
  }
  resize(w, h) {
    w = Math.max(2, Math.floor(w)); h = Math.max(2, Math.floor(h));
    if (w === this.W && h === this.H) return;
    this.W = w; this.H = h;
    const dev = this.dev, T = GPUTextureUsage;
    for (const t of [this.msaaTex, this.depthTex, this.hdrTex, ...(this.bloom || [])]) if (t) t.destroy();
    this.msaaTex = dev.createTexture({ size: [w, h], format: HDR, sampleCount: MSAA, usage: T.RENDER_ATTACHMENT });
    this.depthTex = dev.createTexture({ size: [w, h], format: DEPTH, sampleCount: MSAA, usage: T.RENDER_ATTACHMENT });
    this.hdrTex = dev.createTexture({ size: [w, h], format: HDR, usage: T.RENDER_ATTACHMENT | T.TEXTURE_BINDING });
    this.bloom = [];
    let bw = w, bh = h;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
      this.bloom.push(dev.createTexture({ size: [bw, bh], format: HDR, usage: T.RENDER_ATTACHMENT | T.TEXTURE_BINDING }));
    }
    const mk = (buf, src, bl) => dev.createBindGroup({ layout: this.bglPost, entries: [
      { binding: 0, resource: { buffer: buf } }, { binding: 1, resource: src.createView() }, { binding: 2, resource: this.samp }, { binding: 3, resource: (bl || this.dummy).createView() }] });
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
    e.inst = dev.createBuffer({ size: 64, usage: U.UNIFORM | U.COPY_DST });
    e.bgPart = dev.createBindGroup({ layout: this.bglPart, entries: [
      { binding: 0, resource: { buffer: sim.bufBody } }, { binding: 1, resource: { buffer: sim.bufDiag } },
      { binding: 2, resource: { buffer: e.tagBuf } }, { binding: 3, resource: { buffer: e.inst } }] });
    e.bgSplat = dev.createBindGroup({ layout: this.bglSplat, entries: [
      { binding: 0, resource: { buffer: sim.bufBody } }, { binding: 1, resource: { buffer: e.tagBuf } },
      { binding: 2, resource: { buffer: e.inst } }, { binding: 3, resource: { buffer: this.grid } }] });
    this.sims.push(e);
    return e;
  }
  removeSims() { for (const e of this.sims) { e.tagBuf.destroy(); e.inst.destroy(); } this.sims = []; }
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
  // refV:[vx,vy,vz,blurT], opts:[mode, stressMix, bright, vesc], tint }].
  render(f, sims) {
    const dev = this.dev;
    this.writeCam(f);
    for (const s of sims) {
      const a = new Float32Array(16);
      a.set(s.frame, 0); a.set(s.refV, 4); a.set(s.opts, 8); a.set(s.tint || [0.80, 0.88, 1.0, 1], 12);
      dev.queue.writeBuffer(s.e.inst, 0, a);
    }
    const enc = dev.createCommandEncoder();
    // ring optical depth
    const cur = this.ping = 1 - this.ping;
    enc.clearBuffer(this.grid);
    {
      const pass = enc.beginComputePass();
      pass.setPipeline(this.pSplat); pass.setBindGroup(0, this.bg0[1 - cur]);
      for (const s of sims) { if (!s.ring) continue; pass.setBindGroup(1, s.e.bgSplat); pass.dispatchWorkgroups(Math.ceil(s.e.sim.np / 64)); }
      pass.setPipeline(this.pResolve); pass.setBindGroup(0, this.bg0[1 - cur]); pass.setBindGroup(1, this.resolveBG[cur]);
      pass.dispatchWorkgroups(Math.ceil(this.gridN / 8), Math.ceil(this.gridN / 8));
      pass.end();
    }
    const bg0 = this.bg0[cur];
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: this.msaaTex.createView(), resolveTarget: this.hdrTex.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'discard' }],
        depthStencilAttachment: { view: this.depthTex.createView(), depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      });
      pass.setBindGroup(0, bg0);
      pass.setPipeline(this.pSky); pass.draw(3);
      pass.setPipeline(this.pSurface); pass.draw(3);
      pass.setPipeline(this.pPart);
      for (const s of sims) { pass.setBindGroup(1, s.e.bgPart); pass.draw(6, s.e.sim.N); }
      if (f.ringOn) { pass.setPipeline(this.pDisk); pass.draw(6); }
      if (f.fieldMode && f.fieldAlpha > 0) { pass.setPipeline(this.pField); pass.draw(6); }
      if (this.segCount) { pass.setPipeline(this.pLine); pass.setBindGroup(1, this.segBG); pass.draw(6, this.segCount); }
      pass.setPipeline(this.pAtmo); pass.draw(3);
      pass.end();
    }
    // bloom
    const pb = new Float32Array(8);
    let sw = this.W, sh = this.H;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      pb.set([1 / sw, 1 / sh, i === 0 ? (f.bloomThreshold ?? 1.0) : 0, 0.5, 0, 0, 0, 0]);
      dev.queue.writeBuffer(this.postBufs[i], 0, pb);
      const t = this.bloom[i];
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: t.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
      pass.setPipeline(this.pDown); pass.setBindGroup(0, this.downBG[i]); pass.draw(3); pass.end();
      sw = t.width; sh = t.height;
    }
    for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
      const small = this.bloom[i + 1];
      pb.set([1 / small.width, 1 / small.height, 0, 0, 0, 0, 0, 0]);
      dev.queue.writeBuffer(this.postBufs[BLOOM_LEVELS + i], 0, pb);
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.bloom[i].createView(), loadOp: 'load', storeOp: 'store' }] });
      pass.setPipeline(this.pUp); pass.setBindGroup(0, this.upBG[i]); pass.draw(3); pass.end();
    }
    pb.set([1 / this.W, 1 / this.H, 0, 0, f.bloom ?? 0.08, f.exposure ?? 1, f.vignette ?? 0.35, (f.time || 0) % 100]);
    dev.queue.writeBuffer(this.postBufs[2 * BLOOM_LEVELS], 0, pb);
    {
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
      pass.setPipeline(this.pFinal); pass.setBindGroup(0, this.finalBG); pass.draw(3); pass.end();
    }
    dev.queue.submit([enc.finish()]);
  }
}
