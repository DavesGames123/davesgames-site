// ============================================================================
//  PLANET COLLISION  ·  render.js — the WebGPU renderer (no DOM beyond the
//  canvas context)
// ----------------------------------------------------------------------------
//  Draws the particles of one SphGPU (engine.js) straight from its buffers;
//  nothing goes through the CPU. World units are the solver's code units
//  (Earth radii), the frame is the centre of mass of the collision.
//
//  FRAME (render(f), one command encoder)
//    centres   centres.wgsl: the mean position of each body (for the
//              atmospheres and the shadows)
//    depth     fluid.wgsl fs_depth: fluid particles as spheres -> view depth
//              (rg32float: depth, cut-face flag) + reversed-Z depth
//    fields    fluid.wgsl fs_attr: T, material, start position, body, speed,
//              mixing, weighted to the front layer (3 x rgba16float, additive)
//    vapour    fluid.wgsl fs_thick: the chord through vapour particles in
//              front of the surface (rg16float, half size, additive)
//    smooth    smooth.wgsl: bilateral filter on the depth and a blur of the
//              coverage (the outline), X then Y, f.smooth times (rg32float
//              ping-pong)
//    scene     rgba16float + depth: sky, the lit surface with atmospheres
//              (shade.wgsl), debris fragments and their streaks
//              (debris.wgsl), the vapour, the impact flashes
//    bloom     post.wgsl (the roche-limit chain, a copy): only light above
//              f.bloomThreshold (hot melt, the sun) blooms
//    final     exposure, ACES, vignette, sRGB -> canvas
//
//  PARTICLE CLASSES (common.wgsl fn klass): fluid -> the surface, debris
//  (a summed density far under the reference: a free fragment) ->
//  rock fragments and streaks, vapour (Tillotson blend weight) -> the
//  vapour layer. The test in tests.mjs (section R) checks that a contact
//  run makes all three.
//
//  API (CONTRACT.md "Render")
//    const ren = new Renderer(device, context, format, await loadRenderCode())
//    ren.attach(sim, setup)       after every sim.upload (start positions)
//    ren.setMaps(bitmaps)         6 equirectangular maps (loadMaps)
//    ren.resize(w, h)             the drawing buffer size
//    ren.render(frame)            one frame (fields: "function defaultFrame")
//    ren.project(p, cssW, cssH)   world -> CSS px, for labels
//    ren.destroy()
//
//  grep -n targets
//    looks of the bodies .. "export const BODY_LOOK"
//    frame defaults ....... "export function defaultFrame"
//    uniform layout ....... "writeFrame("
//    pipelines ............ "_make("
//    targets .............. "resize("
//    particle bindings .... "attach("
//    one frame ............ "render("
//    maps ................. "export async function loadMaps", "setMaps("
//    classes on the CPU ... "export function classify"
// ============================================================================
import { MATERIALS, MAT_LIST, UNIT } from './data.js';
import { ETA_H } from './build.js';

const HDR = 'rgba16float';
const DEPTH = 'depth32float';
const BLOOM_LEVELS = 6;
const FRAME_BYTES = 544;
export const MAP_LAYERS = ['earth', 'earth_clouds', 'moon', 'mars', 'mercury', 'venus'];
export const MAP_SIZE = [1024, 512];

// The look of each data.js body: style (common.wgsl fn planetAlbedo), the
// atmosphere colour and shell thickness (share of the radius; drawn, not
// simulated, and thicker than real so it reads at this scale). 0: none.
export const BODY_LOOK = {
  earth:      { style: 0, atm: [0.35, 0.60, 1.00], th: 0.035 },
  protoEarth: { style: 1, atm: [0, 0, 0], th: 0 },
  theia:      { style: 2, atm: [0, 0, 0], th: 0 },
  moon:       { style: 3, atm: [0, 0, 0], th: 0 },
  mars:       { style: 4, atm: [0.90, 0.58, 0.42], th: 0.015 },
  venus:      { style: 5, atm: [0.95, 0.85, 0.62], th: 0.05 },
  mercury:    { style: 6, atm: [0, 0, 0], th: 0 },
  ceres:      { style: 7, atm: [0, 0, 0], th: 0 },
  pluto:      { style: 8, atm: [0.45, 0.62, 1.00], th: 0.012 },
  charon:     { style: 9, atm: [0, 0, 0], th: 0 },
  vesta:      { style: 10, atm: [0, 0, 0], th: 0 },
};
// sphere radius of a fluid particle over its spacing (m / rho0)^(1/3)
export const SPHERE_K = 0.62;

// ── 4x4 matrices, column-major (a copy of roche-limit render.js M4) ───────
export const M4 = {
  mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
  // reversed-Z infinite perspective: z/w = near / depth
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

const SHADERS = ['common', 'fluid', 'smooth', 'shade', 'debris', 'centres', 'post'];
export async function loadRenderCode(read) {
  const out = {};
  await Promise.all(SHADERS.map(async n => {
    const url = new URL(`./shaders/${n}.wgsl`, import.meta.url);
    if (read) { out[n] = await read(url); return; }
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${n}.wgsl: HTTP ${r.status}`);
    out[n] = await r.text();
  }));
  return out;
}
// The surface maps as ImageBitmaps (MAP_LAYERS order, MAP_SIZE). Missing
// maps stay grey (the renderer starts with a 1 x 1 grey array).
export async function loadMaps() {
  return Promise.all(MAP_LAYERS.map(async n => {
    const r = await fetch(new URL(`./tex/${n}.jpg`, import.meta.url));
    if (!r.ok) throw new Error(`tex/${n}.jpg: HTTP ${r.status}`);
    return createImageBitmap(await r.blob(), { resizeWidth: MAP_SIZE[0], resizeHeight: MAP_SIZE[1] });
  }));
}

// Every field render(f) reads, with its default. The page overrides them.
export function defaultFrame() {
  return {
    eye: [0, -8, 2], target: [0, 0, 0], up: [0, 0, 1], fov: 0.7, near: 0.01, time: 0,
    sun: norm([0.55, -0.35, 0.45]), sunI: 1.3,
    mode: 0,                      // 0 real, 1 temperature, 2 origin body, 3 speed, 4 material
    cut: { on: false, n: [0, -1, 0], d: 0 },
    streakT: 0,                   // sim time of one frame (code), for motion streaks
    frags: 3,                     // fragments drawn per debris particle (1-4)
    smooth: 2,                    // bilateral X+Y iterations
    debrisQ: 1.6,                 // h / h0 over this (or h at h_max): debris
    vapK: 1.5, vapGlow: 0.15, xvLo: 0.3, xvHi: 0.5,
    glowGain: 0.6, ambient: 0.012,
    bodies: [{ atm: 1, shadow: 1 }, { atm: 1, shadow: 1 }, { atm: 0, shadow: 0 }, { atm: 0, shadow: 0 }],
    flashes: [],                  // [{ p, r, I, T }]
    exposure: 1.0, bloom: 0.035, bloomThreshold: 2.0, vignette: 0.3,
    coolH: -1,                    // sim hours since the first contact (< 0 before): the skin cools
  };
}

export class Renderer {
  constructor(device, context, format, code, opts = {}) {
    this.dev = device; this.ctx = context; this.format = format;
    this.W = 0; this.H = 0; this.sim = null; this.setup = null;
    this.frame = new Float32Array(FRAME_BYTES / 4);
    this.modules = {};
    const pre = code.common;
    for (const k of ['fluid', 'smooth', 'shade', 'debris']) this.modules[k] = device.createShaderModule({ code: pre + '\n' + code[k], label: 'pc ' + k + '.wgsl' });
    for (const k of ['centres', 'post']) this.modules[k] = device.createShaderModule({ code: code[k], label: 'pc ' + k + '.wgsl' });
    this.look = { surf: [SPHERE_K, 0.05, 1, 1.6], bodies: [], speed: 1, unit: 1 };
    this._make();
  }
  async compilationMessages() {
    const out = [];
    for (const [k, m] of Object.entries(this.modules)) { const info = await m.getCompilationInfo(); for (const x of info.messages) out.push(`${k}.wgsl ${x.type} ${x.lineNum}:${x.linePos} ${x.message}`); }
    return out;
  }
  _make() {
    const dev = this.dev, U = GPUBufferUsage, T = GPUTextureUsage, S = GPUShaderStage;
    const ALL = S.VERTEX | S.FRAGMENT | S.COMPUTE, VF = S.VERTEX | S.FRAGMENT;
    const ro = { type: 'read-only-storage' };
    this.frameBuf = dev.createBuffer({ size: FRAME_BYTES, usage: U.UNIFORM | U.COPY_DST, label: 'pc frame' });
    this.centresBuf = dev.createBuffer({ size: 64, usage: U.STORAGE | U.COPY_DST, label: 'pc centres' });
    this.cpBuf = dev.createBuffer({ size: 16, usage: U.UNIFORM | U.COPY_DST, label: 'pc centres params' });
    this.samp = dev.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'clamp-to-edge' });
    this.sampClamp = dev.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.bgl0 = dev.createBindGroupLayout({ label: 'pc g0', entries: [
      { binding: 0, visibility: ALL, buffer: { type: 'uniform' } },
      { binding: 1, visibility: ALL, buffer: ro },
      { binding: 2, visibility: ALL, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 3, visibility: ALL, sampler: { type: 'filtering' } }] });
    this.bgl1 = dev.createBindGroupLayout({ label: 'pc g1', entries: [0, 1, 2, 3, 4, 5].map(b => ({ binding: b, visibility: VF, buffer: ro })) });
    this.bglZ = dev.createBindGroupLayout({ label: 'pc gZ', entries: [{ binding: 0, visibility: VF, texture: { sampleType: 'unfilterable-float' } }] });
    this.bglSm = dev.createBindGroupLayout({ label: 'pc gSm', entries: [
      { binding: 0, visibility: S.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 1, visibility: S.COMPUTE, storageTexture: { access: 'write-only', format: 'rg32float' } }] });
    this.bglShade = dev.createBindGroupLayout({ label: 'pc gShade', entries: [
      ...[0, 1, 2, 3].map(b => ({ binding: b, visibility: S.FRAGMENT, texture: { sampleType: 'unfilterable-float' } })),
      { binding: 4, visibility: S.FRAGMENT, texture: { sampleType: 'float' } }] });
    this.bglC = dev.createBindGroupLayout({ label: 'pc gC', entries: [
      { binding: 0, visibility: S.COMPUTE, buffer: { type: 'uniform' } }, { binding: 1, visibility: S.COMPUTE, buffer: ro },
      { binding: 2, visibility: S.COMPUTE, buffer: ro }, { binding: 3, visibility: S.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: S.COMPUTE, buffer: { type: 'storage' } }] });
    this.mapTex = dev.createTexture({ size: [1, 1, MAP_LAYERS.length], format: 'rgba8unorm', usage: T.TEXTURE_BINDING | T.COPY_DST, label: 'pc maps' });
    dev.queue.writeTexture({ texture: this.mapTex }, new Uint8Array(4 * MAP_LAYERS.length).fill(110), { bytesPerRow: 4, rowsPerImage: 1 }, [1, 1, MAP_LAYERS.length]);
    this._makeBG0();
    const M = this.modules, pl = (...g) => dev.createPipelineLayout({ bindGroupLayouts: g });
    const add = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
    const premul = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
    const tgt = (format, blend) => blend ? { format, blend } : { format };
    const rp = (mod, vs, fs, layout, targets, depth, label) => dev.createRenderPipeline({ label: 'pc ' + label,
      layout, vertex: { module: mod, entryPoint: vs }, fragment: { module: mod, entryPoint: fs, targets },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: depth });
    const dW = { format: DEPTH, depthWriteEnabled: true, depthCompare: 'greater' };
    const dT = { format: DEPTH, depthWriteEnabled: false, depthCompare: 'greater' };
    const dAlwaysW = { format: DEPTH, depthWriteEnabled: true, depthCompare: 'always' };
    const dNone = { format: DEPTH, depthWriteEnabled: false, depthCompare: 'always' };
    const L01 = pl(this.bgl0, this.bgl1), L01Z = pl(this.bgl0, this.bgl1, this.bglZ), LS = pl(this.bgl0, this.bgl1, this.bglShade);
    this.pDepth = rp(M.fluid, 'vs_sphere', 'fs_depth', L01, [tgt('rg32float')], dW, 'depth');
    this.pAttr = rp(M.fluid, 'vs_sphereWide', 'fs_attr', L01Z, [tgt(HDR, add), tgt(HDR, add), tgt(HDR, add)], undefined, 'fields');
    this.pThick = rp(M.fluid, 'vs_thick', 'fs_thick', L01Z, [tgt('rg16float', add)], undefined, 'vapour');
    const LSm = pl(this.bgl0, this.bgl1, this.bglSm);
    this.pSmX0 = dev.createComputePipeline({ label: 'pc smoothX0', layout: LSm, compute: { module: M.smooth, entryPoint: 'cs_smoothX0' } });
    this.pSmX = dev.createComputePipeline({ label: 'pc smoothX', layout: LSm, compute: { module: M.smooth, entryPoint: 'cs_smoothX' } });
    this.pSmY = dev.createComputePipeline({ label: 'pc smoothY', layout: LSm, compute: { module: M.smooth, entryPoint: 'cs_smoothY' } });
    this.pSky = rp(M.shade, 'vs_full', 'fs_sky', LS, [tgt(HDR)], dNone, 'sky');
    this.pSurf = rp(M.shade, 'vs_full', 'fs_surface', LS, [tgt(HDR, premul)], dAlwaysW, 'surface');
    this.pVap = rp(M.shade, 'vs_full', 'fs_vapour', LS, [tgt(HDR, premul)], dNone, 'vapour composite');
    this.pRock = rp(M.debris, 'vs_rock', 'fs_rock', LS, [tgt(HDR)], dW, 'rocks');
    this.pStreak = rp(M.debris, 'vs_streak', 'fs_streak', LS, [tgt(HDR, add)], dT, 'streaks');
    this.pFlash = rp(M.debris, 'vs_flash', 'fs_flash', LS, [tgt(HDR, add)], dNone, 'flash');
    const LC = pl(this.bglC);
    this.pCPart = dev.createComputePipeline({ label: 'pc centres partial', layout: LC, compute: { module: M.centres, entryPoint: 'cs_partial' } });
    this.pCFinal = dev.createComputePipeline({ label: 'pc centres final', layout: LC, compute: { module: M.centres, entryPoint: 'cs_final' } });
    // post (the roche-limit bloom chain)
    this.bglPost = dev.createBindGroupLayout({ entries: [
      { binding: 0, visibility: S.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: S.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: S.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 3, visibility: S.FRAGMENT, texture: { sampleType: 'float' } }] });
    const pp = (fs, fmt, blend) => dev.createRenderPipeline({ layout: pl(this.bglPost), vertex: { module: M.post, entryPoint: 'vs_post' },
      fragment: { module: M.post, entryPoint: fs, targets: [tgt(fmt, blend)] }, primitive: { topology: 'triangle-list' } });
    this.pDown = pp('fs_down', HDR, null);
    this.pUp = pp('fs_up', HDR, { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } });
    this.pFinal = pp('fs_final', this.format, null);
    this.postBufs = Array.from({ length: 2 * BLOOM_LEVELS + 1 }, () => dev.createBuffer({ size: 32, usage: U.UNIFORM | U.COPY_DST }));
    this.dummy = dev.createTexture({ size: [1, 1], format: HDR, usage: T.TEXTURE_BINDING });
  }
  _makeBG0() {
    this.bg0 = this.dev.createBindGroup({ layout: this.bgl0, label: 'pc g0', entries: [
      { binding: 0, resource: { buffer: this.frameBuf } }, { binding: 1, resource: { buffer: this.centresBuf } },
      { binding: 2, resource: this.mapTex.createView({ dimension: '2d-array' }) }, { binding: 3, resource: this.samp }] });
  }
  // bitmaps: MAP_LAYERS order, all MAP_SIZE. Mip levels are made here by
  // halving (createImageBitmap resize) down to 16 px wide.
  async setMaps(bitmaps) {
    const dev = this.dev, T = GPUTextureUsage, [w, h] = MAP_SIZE;
    const mips = Math.log2(w / 16) + 1;
    const tex = dev.createTexture({ size: [w, h, bitmaps.length], mipLevelCount: mips, format: 'rgba8unorm', usage: T.TEXTURE_BINDING | T.COPY_DST | T.RENDER_ATTACHMENT, label: 'pc maps' });
    for (let l = 0; l < bitmaps.length; l++) {
      let lw = w, lh = h;
      for (let m = 0; m < mips; m++) {
        const b = m === 0 ? bitmaps[l] : await createImageBitmap(bitmaps[l], { resizeWidth: lw, resizeHeight: lh, resizeQuality: 'high' });
        dev.queue.copyExternalImageToTexture({ source: b }, { texture: tex, mipLevel: m, origin: [0, 0, l] }, [lw, lh]);
        if (m > 0) b.close();
        lw >>= 1; lh >>= 1;
      }
    }
    this.mapTex.destroy(); this.mapTex = tex;
    this._makeBG0();
  }
  // A solver and the setup it runs (build.js buildScenario). Call after
  // every sim.upload: writes the start positions (body frame, over the
  // body radius) and the per-body looks.
  attach(sim, setup) {
    const dev = this.dev, U = GPUBufferUsage;
    if (this.sim !== sim) {
      if (this.origBuf) this.origBuf.destroy();
      if (this.partBuf) this.partBuf.destroy();
      this.origBuf = dev.createBuffer({ size: sim.np * 16, usage: U.STORAGE | U.COPY_DST, label: 'pc orig' });
      this.nwg = Math.ceil(sim.np / 256);
      this.partBuf = dev.createBuffer({ size: this.nwg * 64, usage: U.STORAGE, label: 'pc centres partial' });
      const b = sim.buf;
      this.bg1 = dev.createBindGroup({ layout: this.bgl1, label: 'pc g1', entries: [b.pos, b.vel, b.aux, b.tag, this.origBuf, b.th].map((x, i) => ({ binding: i, resource: { buffer: x } })) });
      this.bgC = dev.createBindGroup({ layout: this.bglC, label: 'pc gC', entries: [this.cpBuf, b.pos, b.tag, this.partBuf, this.centresBuf].map((x, i) => ({ binding: i, resource: { buffer: x } })) });
      this.sim = sim;
    }
    this.setup = setup;
    const N = setup.N, o = new Float32Array(sim.np * 4);
    for (let i = 0; i < N; i++) {
      const B = setup.bodies[setup.body[i]];
      for (let c = 0; c < 3; c++) o[4 * i + c] = (setup.pos[3 * i + c] - B.X[c]) / B.R;
      o[4 * i + 3] = B.R;
    }
    dev.queue.writeBuffer(this.origBuf, 0, o);
    dev.queue.writeBuffer(this.cpBuf, 0, new Uint32Array([N, Math.ceil(N / 256), 0, 0]));
    this.look = lookOf(setup);
  }
  // w, h: the drawing buffer
  resize(w, h) {
    w = Math.max(2, Math.floor(w)); h = Math.max(2, Math.floor(h));
    if (w === this.W && h === this.H) return;
    this.W = w; this.H = h;
    const dev = this.dev, T = GPUTextureUsage;
    for (const t of this.targets || []) t.destroy();
    const mk = (fmt, usage, size = [w, h], label) => dev.createTexture({ size, format: fmt, usage, label: 'pc ' + label });
    const RT = T.RENDER_ATTACHMENT | T.TEXTURE_BINDING;
    this.rawZ = mk('rg32float', RT | T.COPY_SRC, [w, h], 'raw depth');
    this.depthTex = mk(DEPTH, T.RENDER_ATTACHMENT, [w, h], 'depth');
    this.smA = mk('rg32float', T.STORAGE_BINDING | T.TEXTURE_BINDING, [w, h], 'smooth A');
    this.smB = mk('rg32float', T.STORAGE_BINDING | T.TEXTURE_BINDING | T.COPY_SRC, [w, h], 'smooth B');
    this.attr = [0, 1, 2].map(k => mk(HDR, RT, [w, h], 'field ' + k));
    this.thick = mk('rg16float', RT, [Math.max(1, w >> 1), Math.max(1, h >> 1)], 'vapour');
    this.hdr = mk(HDR, RT, [w, h], 'hdr');
    this.bloom = [];
    let bw = w, bh = h;
    for (let i = 0; i < BLOOM_LEVELS; i++) { bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1); this.bloom.push(mk(HDR, RT, [bw, bh], 'bloom ' + i)); }
    this.targets = [this.rawZ, this.depthTex, this.smA, this.smB, ...this.attr, this.thick, this.hdr, ...this.bloom];
    this.v = { rawZ: this.rawZ.createView(), depth: this.depthTex.createView(), smA: this.smA.createView(), smB: this.smB.createView(),
      attr: this.attr.map(t => t.createView()), thick: this.thick.createView(), hdr: this.hdr.createView(), bloom: this.bloom.map(t => t.createView()) };
    this.bgZ = dev.createBindGroup({ layout: this.bglZ, entries: [{ binding: 0, resource: this.v.rawZ }] });
    const sm = (a, b) => dev.createBindGroup({ layout: this.bglSm, entries: [{ binding: 0, resource: a }, { binding: 1, resource: b }] });
    this.bgSm = { rawA: sm(this.v.rawZ, this.v.smA), AB: sm(this.v.smA, this.v.smB), BA: sm(this.v.smB, this.v.smA) };
    this.bgShade = dev.createBindGroup({ layout: this.bglShade, entries: [
      { binding: 0, resource: this.v.smB }, ...this.v.attr.map((v, i) => ({ binding: 1 + i, resource: v })), { binding: 4, resource: this.v.thick }] });
    const pg = (buf, src, bl) => dev.createBindGroup({ layout: this.bglPost, entries: [
      { binding: 0, resource: { buffer: buf } }, { binding: 1, resource: src.createView() }, { binding: 2, resource: this.sampClamp }, { binding: 3, resource: (bl || this.dummy).createView() }] });
    this.downBG = this.bloom.map((t, i) => pg(this.postBufs[i], i === 0 ? this.hdr : this.bloom[i - 1]));
    this.upBG = this.bloom.slice(0, -1).map((t, i) => pg(this.postBufs[BLOOM_LEVELS + i], this.bloom[i + 1]));
    this.finalBG = pg(this.postBufs[2 * BLOOM_LEVELS], this.hdr, this.bloom[0]);
  }
  // Fill the frame uniform (common.wgsl struct U). f: defaultFrame() fields.
  writeFrame(f) {
    const d = this.frame, W = this.W, H = this.H, lk = this.look;
    const view = M4.lookAt(f.eye, f.target, f.up || [0, 0, 1]);
    const proj = M4.persp(f.fov, W / H, f.near);
    const vp = M4.mul(proj, view.m);
    const focal = 0.5 * H / Math.tan(f.fov / 2);
    const put = (o, a, w = 0) => { d[o] = a[0]; d[o + 1] = a[1]; d[o + 2] = a[2]; d[o + 3] = w; };
    d.set(vp, 0);
    put(16, f.eye, f.time || 0); put(20, view.r); put(24, view.u); put(28, view.f, focal);
    d[32] = W; d[33] = H; d[34] = 1 / W; d[35] = 1 / H;
    put(36, norm(f.sun), f.sunI);
    const cut = f.cut || {};
    d[40] = f.mode || 0; d[41] = cut.on ? 1 : 0; d[42] = f.streakT || 0; d[43] = Math.max(1, Math.min(4, f.frags | 0 || 1));
    put(44, norm(cut.n || [0, -1, 0]), cut.d || 0);
    d[48] = lk.surf[0]; d[49] = lk.surf[1]; d[50] = lk.surf[2]; d[51] = f.debrisQ ?? 1.6;
    d[52] = (f.vapK ?? 1.5) / lk.unit; d[53] = f.xvLo ?? 0.3; d[54] = f.xvHi ?? 0.5; d[55] = f.vapGlow ?? 0.15;
    d[56] = f.near; d[57] = lk.speed; d[58] = f.glowGain ?? 0.6; d[59] = f.ambient ?? 0.012;
    for (let m = 0; m < 4; m++) { const M = MAT_LIST[m]; d.set([M.rho0 / UNIT.RHO, M.Tmelt, ETA_H, 0], 60 + 4 * m); }
    for (let b = 0; b < 4; b++) {
      const L = lk.bodies[b], fb = (f.bodies || [])[b] || {};
      d.set(L ? [L.style, L.R, (fb.atm ?? 1) * (L.th > 0 ? 1 : 0), fb.shadow ?? 1] : [0, 0, 0, 0], 76 + 4 * b);
      d.set(L ? [...L.atm, L.th] : [0, 0, 0, 0], 92 + 4 * b);
    }
    for (let k = 0; k < 4; k++) {
      const fl = (f.flashes || [])[k];
      d.set(fl ? [fl.p[0], fl.p[1], fl.p[2], fl.I] : [0, 0, 0, 0], 108 + 4 * k);
      d[124 + k] = fl ? fl.r : 0; d[128 + k] = fl ? (fl.T || 6000) : 6000;
    }
    d[132] = this.sim && this.sim.prm ? this.sim.prm.hmax : 1e9;
    d[133] = Math.max(f.near, dot(sub(f.target, f.eye), view.f));
    d[134] = f.coolH ?? -1;
    this.dev.queue.writeBuffer(this.frameBuf, 0, d);
    this.view = view; this.vp = vp; this.focal = focal;
  }
  // world point -> CSS px of the canvas (null behind the eye)
  project(p, cssW, cssH) {
    const m = this.vp; if (!m) return null;
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (w <= 1e-4) return null;
    return { x: (x / w * 0.5 + 0.5) * cssW, y: (0.5 - y / w * 0.5) * cssH, w };
  }
  render(f) {
    if (!this.sim || !this.W) return;
    const dev = this.dev, n = this.sim.n, enc = dev.createCommandEncoder({ label: 'pc frame' });
    this.writeFrame(f);
    // centres
    { const p = enc.beginComputePass(); p.setBindGroup(0, this.bgC);
      p.setPipeline(this.pCPart); p.dispatchWorkgroups(Math.max(1, Math.ceil(n / 256)));
      p.setPipeline(this.pCFinal); p.dispatchWorkgroups(1); p.end(); }
    const clear0 = { r: 0, g: 0, b: 0, a: 0 };
    // depth of the fluid spheres
    { const p = enc.beginRenderPass({ colorAttachments: [{ view: this.v.rawZ, loadOp: 'clear', storeOp: 'store', clearValue: clear0 }],
        depthStencilAttachment: { view: this.v.depth, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' } });
      p.setBindGroup(0, this.bg0); p.setBindGroup(1, this.bg1);
      p.setPipeline(this.pDepth); p.draw(6, n); p.end(); }
    // the fields of the front layer
    { const p = enc.beginRenderPass({ colorAttachments: this.v.attr.map(view => ({ view, loadOp: 'clear', storeOp: 'store', clearValue: clear0 })) });
      p.setBindGroup(0, this.bg0); p.setBindGroup(1, this.bg1); p.setBindGroup(2, this.bgZ);
      p.setPipeline(this.pAttr); p.draw(6, n); p.end(); }
    // vapour thickness
    { const p = enc.beginRenderPass({ colorAttachments: [{ view: this.v.thick, loadOp: 'clear', storeOp: 'store', clearValue: clear0 }] });
      p.setBindGroup(0, this.bg0); p.setBindGroup(1, this.bg1); p.setBindGroup(2, this.bgZ);
      p.setPipeline(this.pThick); p.draw(6, n); p.end(); }
    // bilateral smoothing: raw -> A -> B (-> A -> B ...); the result is in B
    { const p = enc.beginComputePass(); p.setBindGroup(0, this.bg0); p.setBindGroup(1, this.bg1);
      const gx = Math.ceil(this.W / 8), gy = Math.ceil(this.H / 8), it = Math.max(1, Math.min(4, f.smooth ?? 2));
      for (let k = 0; k < it; k++) {
        p.setPipeline(k === 0 ? this.pSmX0 : this.pSmX); p.setBindGroup(2, k === 0 ? this.bgSm.rawA : this.bgSm.BA); p.dispatchWorkgroups(gx, gy);
        p.setPipeline(this.pSmY); p.setBindGroup(2, this.bgSm.AB); p.dispatchWorkgroups(gx, gy);
      }
      p.end(); }
    // the scene
    { const p = enc.beginRenderPass({ colorAttachments: [{ view: this.v.hdr, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
        depthStencilAttachment: { view: this.v.depth, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' } });
      p.setBindGroup(0, this.bg0); p.setBindGroup(1, this.bg1); p.setBindGroup(2, this.bgShade);
      p.setPipeline(this.pSky); p.draw(3);
      p.setPipeline(this.pSurf); p.draw(3);
      const F = Math.max(1, Math.min(4, f.frags | 0 || 1));
      p.setPipeline(this.pRock); p.draw(24, n * F);
      if (f.streakT > 0) { p.setPipeline(this.pStreak); p.draw(6, n); }
      p.setPipeline(this.pVap); p.draw(3);
      if (f.flashes && f.flashes.length) { p.setPipeline(this.pFlash); p.draw(6, Math.min(4, f.flashes.length)); }
      p.end(); }
    this._bloom(enc, f); this._final(enc, f);
    dev.queue.submit([enc.finish()]);
  }
  _bloom(enc, f) {
    const dev = this.dev, pb = this._pb || (this._pb = new Float32Array(8));
    let sw = this.W, sh = this.H;
    const levels = f.bloom > 0 ? this.bloom.length : 0;
    for (let i = 0; i < levels; i++) {
      pb[0] = 1 / sw; pb[1] = 1 / sh; pb[2] = i === 0 ? (f.bloomThreshold ?? 1.6) : 0; pb[3] = 0.5;
      dev.queue.writeBuffer(this.postBufs[i], 0, pb);
      const p = enc.beginRenderPass({ colorAttachments: [{ view: this.v.bloom[i], loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
      p.setPipeline(this.pDown); p.setBindGroup(0, this.downBG[i]); p.draw(3); p.end();
      sw = this.bloom[i].width; sh = this.bloom[i].height;
    }
    for (let i = levels - 2; i >= 0; i--) {
      const small = this.bloom[i + 1];
      pb[0] = 1 / small.width; pb[1] = 1 / small.height; pb[2] = 0; pb[3] = 0;
      dev.queue.writeBuffer(this.postBufs[BLOOM_LEVELS + i], 0, pb);
      const p = enc.beginRenderPass({ colorAttachments: [{ view: this.v.bloom[i], loadOp: 'load', storeOp: 'store' }] });
      p.setPipeline(this.pUp); p.setBindGroup(0, this.upBG[i]); p.draw(3); p.end();
    }
  }
  _final(enc, f) {
    const pb = new Float32Array(8);
    pb[0] = 1 / this.W; pb[1] = 1 / this.H;
    pb[4] = f.bloom > 0 ? f.bloom : 0; pb[5] = f.exposure ?? 1; pb[6] = f.vignette ?? 0.3; pb[7] = (f.time || 0) % 100;
    this.dev.queue.writeBuffer(this.postBufs[2 * BLOOM_LEVELS], 0, pb);
    const p = enc.beginRenderPass({ colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    p.setPipeline(this.pFinal); p.setBindGroup(0, this.finalBG); p.draw(3); p.end();
  }
  destroy() {
    for (const t of this.targets || []) t.destroy();
    for (const b of [this.frameBuf, this.centresBuf, this.cpBuf, this.origBuf, this.partBuf, ...this.postBufs]) if (b) b.destroy();
    this.mapTex.destroy(); this.dummy.destroy();
    this.targets = null; this.sim = null;
  }
}

// The per-body numbers of a setup: style, drawn radius, atmosphere; the
// sphere size and depth band of the surface; the speed of the colour scale.
export function lookOf(setup) {
  const bodies = setup.bodies.map(B => {
    const L = BODY_LOOK[B.key] || BODY_LOOK.theia;
    // the outer layer's material sets the surface spacing
    const top = B.profile.layers[B.profile.layers.length - 1].key;
    const s0 = Math.cbrt(B.mp / (MATERIALS[top].rho0 / UNIT.RHO));
    return { style: L.style, atm: L.atm, th: L.th, R: B.R + SPHERE_K * s0, s0 };
  });
  const s0 = bodies[0].s0;
  return {
    bodies,
    // depth band: about one sphere; filter: one sphere diameter in px
    surf: [SPHERE_K, 1.6 * SPHERE_K * s0, 1.0, 1.6],
    speed: 1.5 * setup.impact.vesc,
    unit: 1,
  };
}

// The particle classes of common.wgsl fn klass, on the CPU, from a
// sim.readback(['aux', 'tag', 'th']): { fluid, debris, vapour } counts.
// The tests use it. (hmax is not used; the argument stays for the callers.)
export function classify(rb, n, hmax, f = {}) {
  const q = f.debrisQ ?? 1.6, xvHi = f.xvHi ?? 0.5, out = { fluid: 0, debris: 0, vapour: 0 };
  for (let i = 0; i < n; i++) {
    if (rb.aux[4 * i + 3] > xvHi) { out.vapour++; continue; }
    const M = MAT_LIST[rb.tag[i] & 3];
    if (rb.th[4 * i] * q * q * q < M.rho0 / UNIT.RHO) out.debris++; else out.fluid++;
  }
  return out;
}
