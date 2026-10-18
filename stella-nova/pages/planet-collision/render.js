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
//    volume    vol.wgsl (fn _volume): a cube of f.grid^3 cells round the
//              framed matter (f.vol { c, r }, or the view at the target);
//              each fluid and debris particle adds a smooth kernel; the
//              field and its gradient go to a 3D texture, with brick
//              marks for empty-space skips. Rebuilt only when the solver
//              stepped or the cube moved.
//    depth     march.wgsl fs_march: the iso surface of the volume (one
//              liquid surface: the bodies, the neck, the splash), and
//              fluid.wgsl fs_depth: fluid particles outside the cube as
//              spheres -> view depth (rg32float: depth, cut-face flag),
//              normal (rgba16float) + reversed-Z depth
//    fields    fluid.wgsl fs_attr: T, material, start position, body, speed,
//              mixing, weighted to the front layer (3 x rgba16float, additive)
//    smoke     smoke.wgsl (fn _smoke, "_smokeBox"): a second cube of
//              f.smoke.grid^3 cells, 1.3 x the framed sphere. The gas and
//              dust share of each particle (optics.js smokeWeights) is
//              splatted into it with its temperature, velocity and iron
//              share; a light pass finds the optical depth to the sun and
//              the body shadow per cell. Rebuilt with the density volume.
//              Skipped while f.smokeLive is false (before contact).
//    smooth    smooth.wgsl: bilateral filter on the depth and a blur of the
//              coverage (the outline), X then Y, f.smooth times (rg32float
//              ping-pong)
//    march     smoke.wgsl fs_smokeMarch (half size): the ray march of the
//              smoke to the smoothed surface depth; fs_smokeTAA blends it
//              with the reprojected history (ping-pong smHist)
//    scene     rgba16float + depth: sky, the lit surface with atmospheres
//              and shadows (shade.wgsl, scene.wgsl fn sunAt), the impact
//              flashes, the smoke (fs_smokeComp, a depth-aware upsample),
//              debris droplets (under the smoke when behind its 0.5
//              depth) and their streaks (debris.wgsl)
//    bloom     post.wgsl (the roche-limit chain, a copy): only light above
//              f.bloomThreshold (hot melt, the sun) blooms
//    expose    post.wgsl cs_expose: the exposure adapts to the lit pixels
//    final     exposure, the hue-keeping ACES tone map (optics.js toneMap),
//              vignette -> canvas
//
//  PARTICLE CLASSES (common.wgsl fn klass): fluid -> the surface, debris
//  (a summed density far under the reference: a free fragment) ->
//  droplets and streaks, vapour (Tillotson blend weight) -> the
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
//  VOLUME SIZE (f.grid, budget.js GRID): desktop 144^3 cells: 11.9 MB of
//  u32 sums + 23.9 MB of rgba16float field; phones 96^3: 3.5 + 7.1 MB.
//  The cell is 2.2 r / (G - 1), never under 0.3 of the finest particle
//  spacing (that caps the scatter cost), and snapped to steps of 2^(1/4)
//  and to the cell lattice, so the surface does not shimmer as the camera
//  moves. f.grid 0 turns the volume off (all spheres: the old look).
//
//  SMOKE SIZE (f.smoke, budget.js SMOKE_TIERS): desktop 80^3 cells
//  (16.4 MB of i32 sums + 12.3 MB in three rgba16float textures), 56 march
//  steps; phones 48^3 (3.5 + 2.7 MB), 24 steps, one octave of detail.
//  Plus a 64^3 noise and a 32^3 curl texture (1.3 MB), made once.
//
//  grep -n targets
//    volume ............... "_volume(", "_makeVolume(", "export const VOL_K"
//    smoke ................ "_smoke(", "_smokeBox(", "_makeSmoke(", "export const SMOKE_K", "_shadeBG("
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
import { blackbodyLUT, BB_N, PHASE, SMOKE, vapourCap, EXPOSE } from './optics.js';

const HDR = 'rgba16float';
const DEPTH = 'depth32float';
const BLOOM_LEVELS = 6;
const FRAME_BYTES = 752;
export const MAP_LAYERS = ['earth', 'earth_clouds', 'moon', 'mars', 'mercury', 'venus'];
export const MAP_SIZE = [1024, 512];

// The look of each data.js body: style (common.wgsl fn planetAlbedo), the
// atmosphere colour and shell thickness (share of the radius; drawn, not
// simulated, and thicker than real so it reads at this scale). 0: none.
export const BODY_LOOK = {
  earth:      { style: 0, atm: [0.35, 0.60, 1.00], th: 0.035 },
  protoEarth: { style: 1, atm: [0.55, 0.66, 0.92], th: 0.03 },
  theia:      { style: 2, atm: [0.80, 0.66, 0.52], th: 0.012 },
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
// the volume kernel radius over the spacing and the iso level of the
// field (tests.mjs 12: the iso surface of a settled body sits 0.62
// spacing out, like the spheres, with a radius spread of 0.01 spacing)
export const VOL_K = 1.8, VOL_ISO = 1.1;
// debris droplets: at most DROPS_MAX per particle, radius 0.55 DROP_K to
// 1.45 DROP_K spacings (debris.wgsl "const DROP_K")
export const DROPS_MAX = 16, DROP_K = 0.13;
// the smoke optics in code units: extinction per unit of gas and dust
// density (code mass per code volume), the emission gain, the detail
// cycles across the smoke cube, the flow period of the detail (code time)
export const SMOKE_K = { gas: 500, dust: 400, emit: 1.0, cycles: 9, flowT: 0.25 };

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

const SHADERS = ['common', 'scene', 'fluid', 'smooth', 'shade', 'debris', 'centres', 'post', 'vol', 'march', 'smoke'];
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
    frags: 10,                    // droplets drawn per debris particle (1-16)
    smooth: 2,                    // bilateral X+Y iterations
    debrisQ: 1.6,                 // h / h0 over this (or h at h_max): debris
    vapK: 1.5, vapGlow: 1.0, xvLo: 0.05, xvHi: 0.5,
    glowGain: 0.6, ambient: 0.012,
    bodies: [{ atm: 1, shadow: 1 }, { atm: 1, shadow: 1 }, { atm: 0, shadow: 0 }, { atm: 0, shadow: 0 }],
    flashes: [],                  // [{ p, r, I, T }]
    exposure: 1.0, bloom: 0.035, bloomThreshold: 2.0, vignette: 0.3,
    adapt: true,                  // the exposure adapts (post.wgsl cs_expose; false: held at 1)
    coolH: -1,                    // sim hours since the first contact (< 0 before): the skin cools
    grid: 144,                    // volume cells per side (0: no volume, particle spheres)
    vol: null,                    // { c, r }: the sphere the volume must hold (default: the view at the target)
    // the smoke volume (smoke.wgsl): cells per side (0 off), march and
    // light steps, detail strength 0..1 (budget.js renderBudget sets them)
    smoke: { grid: 80, steps: 56, light: 20, detail: 1 },
    simT: null,                   // sim time (code): the smoke detail flows with it (default: wall time)
    smokeLive: true,              // false: skip the smoke passes (main.js: before contact, no gas or dust)
  };
}

export class Renderer {
  constructor(device, context, format, code, opts = {}) {
    this.dev = device; this.ctx = context; this.format = format;
    this.W = 0; this.H = 0; this.sim = null; this.setup = null;
    this.frame = new Float32Array(FRAME_BYTES / 4);
    this.modules = {};
    const pre = code.common;
    for (const k of ['fluid', 'smooth', 'vol', 'march', 'smoke']) this.modules[k] = device.createShaderModule({ code: pre + '\n' + code[k], label: 'pc ' + k + '.wgsl' });
    // the scene pass: common + scene (its bindings and light helpers) + the pass
    for (const k of ['shade', 'debris']) this.modules[k] = device.createShaderModule({ code: pre + '\n' + code.scene + '\n' + code[k], label: 'pc ' + k + '.wgsl' });
    for (const k of ['centres', 'post']) this.modules[k] = device.createShaderModule({ code: code[k], label: 'pc ' + k + '.wgsl' });
    this.look = { surf: [SPHERE_K, 0.05, 1, 1.6], bodies: [], speed: 1, unit: 1, s0min: 0 };
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
    this.sampC = dev.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
    this.sampR = dev.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat' });
    this.samp = dev.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'clamp-to-edge' });
    this.sampClamp = dev.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.bgl0 = dev.createBindGroupLayout({ label: 'pc g0', entries: [
      { binding: 0, visibility: ALL, buffer: { type: 'uniform' } },
      { binding: 1, visibility: ALL, buffer: ro },
      { binding: 2, visibility: ALL, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 3, visibility: ALL, sampler: { type: 'filtering' } },
      { binding: 4, visibility: ALL, texture: { sampleType: 'float' } },
      { binding: 5, visibility: ALL, sampler: { type: 'filtering' } },
      { binding: 6, visibility: ALL, sampler: { type: 'filtering' } }] });
    this.bgl1 = dev.createBindGroupLayout({ label: 'pc g1', entries: [0, 1, 2, 3, 4, 5].map(b => ({ binding: b, visibility: VF, buffer: ro })) });
    // the volume compute: the particle buffers it reads (8 storage buffers at most per stage)
    this.bgl1c = dev.createBindGroupLayout({ label: 'pc g1 volume', entries: [0, 1, 2, 3, 5].map(b => ({ binding: b, visibility: S.COMPUTE, buffer: ro })) });
    this.bglZ = dev.createBindGroupLayout({ label: 'pc gZ', entries: [{ binding: 0, visibility: VF, texture: { sampleType: 'unfilterable-float' } }] });
    this.bglSm = dev.createBindGroupLayout({ label: 'pc gSm', entries: [
      { binding: 0, visibility: S.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 1, visibility: S.COMPUTE, storageTexture: { access: 'write-only', format: 'rg32float' } }] });
    this.bglShade = dev.createBindGroupLayout({ label: 'pc gShade', entries: [
      ...[0, 1, 2, 3].map(b => ({ binding: b, visibility: VF, texture: { sampleType: 'unfilterable-float' } })),
      { binding: 4, visibility: VF, texture: { sampleType: 'unfilterable-float' } },
      { binding: 5, visibility: VF, texture: { sampleType: 'unfilterable-float' } },
      { binding: 6, visibility: VF, texture: { sampleType: 'unfilterable-float' } },
      { binding: 7, visibility: VF, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 8, visibility: VF, texture: { sampleType: 'float', viewDimension: '3d' } }] });
    // the smoke (smoke.wgsl): one group-2 layout per stage
    const st = (b, format, dim = '3d') => ({ binding: b, visibility: S.COMPUTE, storageTexture: { access: 'write-only', format, viewDimension: dim } });
    const t3 = (b, vis = S.FRAGMENT) => ({ binding: b, visibility: vis, texture: { sampleType: 'float', viewDimension: '3d' } });
    const rw = b => ({ binding: b, visibility: S.COMPUTE, buffer: { type: 'storage' } });
    this.bglSmS = dev.createBindGroupLayout({ label: 'pc smoke scatter', entries: [rw(0)] });
    this.bglSmR = dev.createBindGroupLayout({ label: 'pc smoke resolve', entries: [rw(0), rw(1), st(2, 'rgba16float'), st(3, 'rgba16float')] });
    this.bglSmL = dev.createBindGroupLayout({ label: 'pc smoke light', entries: [t3(4, S.COMPUTE), st(6, 'rgba16float'), t3(10, S.COMPUTE)] });
    this.bglSmN = dev.createBindGroupLayout({ label: 'pc smoke noise', entries: [st(13, 'rgba8unorm'), st(14, 'rgba16float')] });
    this.bglSmM = dev.createBindGroupLayout({ label: 'pc smoke march', entries: [t3(4), t3(5), t3(7), t3(8), t3(9),
      { binding: 11, visibility: S.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }, { binding: 12, visibility: S.FRAGMENT, buffer: ro }] });
    this.bglSmT = dev.createBindGroupLayout({ label: 'pc smoke taa', entries: [
      { binding: 15, visibility: S.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 16, visibility: S.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 17, visibility: S.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
    this.bglVolC = dev.createBindGroupLayout({ label: 'pc gVolC', entries: [
      { binding: 0, visibility: S.COMPUTE, buffer: { type: 'storage' } }, { binding: 1, visibility: S.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: S.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '3d' } }] });
    this.bglMarch = dev.createBindGroupLayout({ label: 'pc gMarch', entries: [
      { binding: 0, visibility: S.FRAGMENT, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 1, visibility: S.FRAGMENT, buffer: ro }, { binding: 2, visibility: S.FRAGMENT, sampler: { type: 'filtering' } }] });
    this.bglC = dev.createBindGroupLayout({ label: 'pc gC', entries: [
      { binding: 0, visibility: S.COMPUTE, buffer: { type: 'uniform' } }, { binding: 1, visibility: S.COMPUTE, buffer: ro },
      { binding: 2, visibility: S.COMPUTE, buffer: ro }, { binding: 3, visibility: S.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: S.COMPUTE, buffer: { type: 'storage' } }] });
    this.mapTex = dev.createTexture({ size: [1, 1, MAP_LAYERS.length], format: 'rgba8unorm', usage: T.TEXTURE_BINDING | T.COPY_DST, label: 'pc maps' });
    dev.queue.writeTexture({ texture: this.mapTex }, new Uint8Array(4 * MAP_LAYERS.length).fill(110), { bytesPerRow: 4, rowsPerImage: 1 }, [1, 1, MAP_LAYERS.length]);
    // the black-body colours (optics.js), linear, 8 bits
    this.bbTex = dev.createTexture({ size: [BB_N, 1], format: 'rgba8unorm', usage: T.TEXTURE_BINDING | T.COPY_DST, label: 'pc black body' });
    dev.queue.writeTexture({ texture: this.bbTex }, Uint8Array.from(blackbodyLUT(), v => Math.round(255 * Math.min(1, Math.max(0, v)))), { bytesPerRow: 4 * BB_N }, [BB_N, 1]);
    // the noise of the smoke detail (made once, at the first frame)
    this.noiseTex = dev.createTexture({ size: [64, 64, 64], dimension: '3d', format: 'rgba8unorm', usage: T.STORAGE_BINDING | T.TEXTURE_BINDING, label: 'pc smoke noise' });
    this.curlTex = dev.createTexture({ size: [32, 32, 32], dimension: '3d', format: 'rgba16float', usage: T.STORAGE_BINDING | T.TEXTURE_BINDING, label: 'pc smoke curl' });
    this.noiseMade = false;
    // stand-ins for a volume that is off (all zero, light 1)
    this.dummy3 = dev.createTexture({ size: [1, 1, 1], dimension: '3d', format: 'rgba16float', usage: T.TEXTURE_BINDING | T.COPY_DST, label: 'pc 3d zero' });
    this.light1 = dev.createTexture({ size: [1, 1, 1], dimension: '3d', format: 'rgba16float', usage: T.TEXTURE_BINDING | T.COPY_DST, label: 'pc 3d light 1' });
    dev.queue.writeTexture({ texture: this.light1 }, new Uint16Array([0, 0x3c00, 0, 0]), { bytesPerRow: 8, rowsPerImage: 1 }, [1, 1, 1]);
    this.frameNo = 0; this.vpPrev = null; this.histValid = false;
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
    this.pDepth = rp(M.fluid, 'vs_sphere', 'fs_depth', L01, [tgt('rg32float'), tgt(HDR)], dW, 'depth');
    this.pMarch = rp(M.march, 'vs_march', 'fs_march', pl(this.bgl0, this.bgl1, this.bglMarch), [tgt('rg32float'), tgt(HDR)], dW, 'march');
    const LV = pl(this.bgl0, this.bgl1c, this.bglVolC);
    this.pVolScatter = dev.createComputePipeline({ label: 'pc volScatter', layout: LV, compute: { module: M.vol, entryPoint: 'cs_volScatter' } });
    this.pVolResolve = dev.createComputePipeline({ label: 'pc volResolve', layout: LV, compute: { module: M.vol, entryPoint: 'cs_volResolve' } });
    this.pAttr = rp(M.fluid, 'vs_sphereWide', 'fs_attr', L01Z, [tgt(HDR, add), tgt(HDR, add), tgt(HDR, add)], undefined, 'fields');
    const LSm = pl(this.bgl0, this.bgl1, this.bglSm);
    this.pSmX0 = dev.createComputePipeline({ label: 'pc smoothX0', layout: LSm, compute: { module: M.smooth, entryPoint: 'cs_smoothX0' } });
    this.pSmX = dev.createComputePipeline({ label: 'pc smoothX', layout: LSm, compute: { module: M.smooth, entryPoint: 'cs_smoothX' } });
    this.pSmY = dev.createComputePipeline({ label: 'pc smoothY', layout: LSm, compute: { module: M.smooth, entryPoint: 'cs_smoothY' } });
    this.pSky = rp(M.shade, 'vs_full', 'fs_sky', LS, [tgt(HDR)], dNone, 'sky');
    this.pSurf = rp(M.shade, 'vs_full', 'fs_surface', LS, [tgt(HDR, premul)], dAlwaysW, 'surface');
    this.pSmComp = rp(M.shade, 'vs_full', 'fs_smokeComp', LS, [tgt(HDR, premul)], dNone, 'smoke composite');
    const cp = (layout, entryPoint, label) => dev.createComputePipeline({ label: 'pc ' + label, layout, compute: { module: M.smoke, entryPoint } });
    this.pSmNoise = cp(pl(this.bgl0, this.bgl1c, this.bglSmN), 'cs_noise', 'smoke noise');
    this.pSmScatter = cp(pl(this.bgl0, this.bgl1c, this.bglSmS), 'cs_smokeScatter', 'smoke scatter');
    this.pSmResolve = cp(pl(this.bgl0, this.bgl1c, this.bglSmR), 'cs_smokeResolve', 'smoke resolve');
    this.pSmLight = cp(pl(this.bgl0, this.bgl1c, this.bglSmL), 'cs_smokeLight', 'smoke light');
    this.pSmMarch = rp(M.smoke, 'vs_smokeFull', 'fs_smokeMarch', pl(this.bgl0, this.bgl1, this.bglSmM), [tgt(HDR), tgt('rgba32float')], undefined, 'smoke march');
    this.pSmTAA = rp(M.smoke, 'vs_smokeFull', 'fs_smokeTAA', pl(this.bgl0, this.bgl1, this.bglSmT), [tgt(HDR)], undefined, 'smoke taa');
    this.pDrop = rp(M.debris, 'vs_drop', 'fs_drop', LS, [tgt(HDR)], dW, 'droplets');
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
      { binding: 3, visibility: S.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 4, visibility: S.FRAGMENT, buffer: ro }] });
    // the exposure (post.wgsl cs_expose): state x exposure, y mean lum
    this.expoBuf = dev.createBuffer({ size: 16, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC, label: 'pc exposure' });
    dev.queue.writeBuffer(this.expoBuf, 0, new Float32Array([1, EXPOSE.key, 1, 0]));
    this.expoPrm = dev.createBuffer({ size: 32, usage: U.UNIFORM | U.COPY_DST, label: 'pc exposure params' });
    this.bglExpo = dev.createBindGroupLayout({ label: 'pc expose', entries: [
      { binding: 5, visibility: S.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 6, visibility: S.COMPUTE, buffer: { type: 'storage' } }, { binding: 7, visibility: S.COMPUTE, buffer: { type: 'uniform' } }] });
    this.pExpose = dev.createComputePipeline({ label: 'pc expose', layout: pl(this.bglExpo), compute: { module: M.post, entryPoint: 'cs_expose' } });
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
      { binding: 2, resource: this.mapTex.createView({ dimension: '2d-array' }) }, { binding: 3, resource: this.samp },
      { binding: 4, resource: this.bbTex.createView() }, { binding: 5, resource: this.sampC }, { binding: 6, resource: this.sampR }] });
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
      this.bg1c = dev.createBindGroup({ layout: this.bgl1c, label: 'pc g1 volume', entries: [[0, b.pos], [1, b.vel], [2, b.aux], [3, b.tag], [5, b.th]].map(([i, x]) => ({ binding: i, resource: { buffer: x } })) });
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
    this.nrm = mk(HDR, RT | T.COPY_SRC, [w, h], 'normal');
    this.depthTex = mk(DEPTH, T.RENDER_ATTACHMENT, [w, h], 'depth');
    this.smA = mk('rg32float', T.STORAGE_BINDING | T.TEXTURE_BINDING, [w, h], 'smooth A');
    this.smB = mk('rg32float', T.STORAGE_BINDING | T.TEXTURE_BINDING | T.COPY_SRC, [w, h], 'smooth B');
    this.attr = [0, 1, 2].map(k => mk(HDR, RT, [w, h], 'field ' + k));
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    this.smCur = mk(HDR, RT, [hw, hh], 'smoke');
    this.smAux = mk('rgba32float', RT, [hw, hh], 'smoke aux');
    this.smHist = [0, 1].map(k => mk(HDR, RT, [hw, hh], 'smoke history ' + k));
    this.histValid = false;
    this.hdr = mk(HDR, RT | T.COPY_SRC, [w, h], 'hdr');
    this.bloom = [];
    let bw = w, bh = h;
    for (let i = 0; i < BLOOM_LEVELS; i++) { bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1); this.bloom.push(mk(HDR, RT, [bw, bh], 'bloom ' + i)); }
    this.targets = [this.rawZ, this.nrm, this.depthTex, this.smA, this.smB, ...this.attr, this.smCur, this.smAux, ...this.smHist, this.hdr, ...this.bloom];
    this.v = { rawZ: this.rawZ.createView(), nrm: this.nrm.createView(), depth: this.depthTex.createView(), smA: this.smA.createView(), smB: this.smB.createView(),
      attr: this.attr.map(t => t.createView()), smCur: this.smCur.createView(), smAux: this.smAux.createView(), smHist: this.smHist.map(t => t.createView()),
      hdr: this.hdr.createView(), bloom: this.bloom.map(t => t.createView()) };
    this.bgZ = dev.createBindGroup({ layout: this.bglZ, entries: [{ binding: 0, resource: this.v.rawZ }] });
    const sm = (a, b) => dev.createBindGroup({ layout: this.bglSm, entries: [{ binding: 0, resource: a }, { binding: 1, resource: b }] });
    this.bgSm = { rawA: sm(this.v.rawZ, this.v.smA), AB: sm(this.v.smA, this.v.smB), BA: sm(this.v.smB, this.v.smA) };
    this.bgShade = null; this.shadeKey = '';
    this.bgSmT = [0, 1].map(k => dev.createBindGroup({ layout: this.bglSmT, entries: [
      { binding: 15, resource: this.v.smHist[1 - k] }, { binding: 16, resource: this.v.smCur }, { binding: 17, resource: this.v.smAux }] }));
    this.bgSmM = null;
    const pg = (buf, src, bl) => dev.createBindGroup({ layout: this.bglPost, entries: [
      { binding: 0, resource: { buffer: buf } }, { binding: 1, resource: src.createView() }, { binding: 2, resource: this.sampClamp }, { binding: 3, resource: (bl || this.dummy).createView() },
      { binding: 4, resource: { buffer: this.expoBuf } }] });
    this.downBG = this.bloom.map((t, i) => pg(this.postBufs[i], i === 0 ? this.hdr : this.bloom[i - 1]));
    this.upBG = this.bloom.slice(0, -1).map((t, i) => pg(this.postBufs[BLOOM_LEVELS + i], this.bloom[i + 1]));
    this.finalBG = pg(this.postBufs[2 * BLOOM_LEVELS], this.hdr, this.bloom[0]);
    this.expoBG = dev.createBindGroup({ layout: this.bglExpo, entries: [{ binding: 5, resource: this.v.hdr }, { binding: 6, resource: { buffer: this.expoBuf } }, { binding: 7, resource: { buffer: this.expoPrm } }] });
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
    d[40] = f.mode || 0; d[41] = cut.on ? 1 : 0; d[42] = f.streakT || 0; d[43] = Math.max(1, Math.min(DROPS_MAX, f.frags | 0 || 1));
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
    d.set(this.vpPrev || vp, 172);
    const vb = this.volBox;
    d.set(vb ? [vb.o[0], vb.o[1], vb.o[2], vb.cell, vb.G, VOL_ISO, VOL_K, 0] : [0, 0, 0, 0, 0, VOL_ISO, VOL_K, 0], 136);
    const sb = this.smBox, sm = f.smoke || {};
    d.set(sb ? [sb.o[0], sb.o[1], sb.o[2], sb.cell] : [0, 0, 0, 0], 144);
    d.set([sb ? sb.G : 0, sm.steps || 56, sm.light || 20, this.frameNo % 1024], 148);
    const vk = (f.vapK ?? 1.5) / 1.5;
    d.set([SMOKE_K.gas * vk, SMOKE_K.dust * vk, (f.vapGlow ?? 1) * SMOKE_K.emit, sb ? SMOKE_K.cycles / (sb.cell * sb.G) : 1], 152);
    d.set([SMOKE.boilLo, SMOKE.boilHi, SMOKE.rhoLo, SMOKE.rhoHi], 156);
    d.set([SMOKE.condLo, SMOKE.condHi, vapourCap(f.coolH ?? -1), SMOKE.dustShed], 160);
    const flow = f.simT != null ? f.simT / SMOKE_K.flowT : (f.time || 0) * 0.08;
    d.set([PHASE.g1, PHASE.g2, PHASE.w, flow % 4096], 164);
    d.set([this.histValid ? 1 : 0, 0, sm.detail ?? 1, 0], 168);
    this.dev.queue.writeBuffer(this.frameBuf, 0, d);
    this.view = view; this.vp = vp; this.focal = focal;
    this.vpPrev = vp;
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
    const rebuild = this._volBox(f);
    const smRebuild = this._smokeBox(f);
    // the smoke history is good while the eye moves a little
    const eyeK = f.eye.join();
    if (this.lastEye) { const de = Math.hypot(...sub(f.eye, this.lastEye)), dd = Math.hypot(...sub(f.target, f.eye)); if (de > 0.2 * dd) this.histValid = false; }
    if (!this.smBox) this.histValid = false;
    this.lastEye = f.eye.slice();
    this.frameNo++;
    this.writeFrame(f);
    // centres
    { const p = enc.beginComputePass(); p.setBindGroup(0, this.bgC);
      p.setPipeline(this.pCPart); p.dispatchWorkgroups(Math.max(1, Math.ceil(n / 256)));
      p.setPipeline(this.pCFinal); p.dispatchWorkgroups(1); p.end(); }
    const clear0 = { r: 0, g: 0, b: 0, a: 0 };
    if (rebuild) this._volume(enc);
    if (this.smBox && (smRebuild || rebuild)) this._smoke(enc);
    // depth: the iso surface of the volume, and the fluid spheres outside it
    { const p = enc.beginRenderPass({ colorAttachments: [{ view: this.v.rawZ, loadOp: 'clear', storeOp: 'store', clearValue: clear0 }, { view: this.v.nrm, loadOp: 'clear', storeOp: 'store', clearValue: clear0 }],
        depthStencilAttachment: { view: this.v.depth, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' } });
      p.setBindGroup(0, this.bg0); p.setBindGroup(1, this.bg1);
      p.setPipeline(this.pDepth); p.draw(6, n);
      if (this.volBox) { p.setBindGroup(2, this.bgMarch); p.setPipeline(this.pMarch); p.draw(3); }
      p.end(); }
    // the fields of the front layer
    { const p = enc.beginRenderPass({ colorAttachments: this.v.attr.map(view => ({ view, loadOp: 'clear', storeOp: 'store', clearValue: clear0 })) });
      p.setBindGroup(0, this.bg0); p.setBindGroup(1, this.bg1); p.setBindGroup(2, this.bgZ);
      p.setPipeline(this.pAttr); p.draw(6, n); p.end(); }
    // bilateral smoothing: raw -> A -> B (-> A -> B ...); the result is in B
    { const p = enc.beginComputePass(); p.setBindGroup(0, this.bg0); p.setBindGroup(1, this.bg1);
      const gx = Math.ceil(this.W / 8), gy = Math.ceil(this.H / 8), it = Math.max(1, Math.min(4, f.smooth ?? 2));
      for (let k = 0; k < it; k++) {
        p.setPipeline(k === 0 ? this.pSmX0 : this.pSmX); p.setBindGroup(2, k === 0 ? this.bgSm.rawA : this.bgSm.BA); p.dispatchWorkgroups(gx, gy);
        p.setPipeline(this.pSmY); p.setBindGroup(2, this.bgSm.AB); p.dispatchWorkgroups(gx, gy);
      }
      p.end(); }
    // the smoke: the march (half size) and the temporal pass
    const hk = this.frameNo & 1;
    if (this.smBox) {
      this._smokeBG();
      { const p = enc.beginRenderPass({ colorAttachments: [{ view: this.v.smCur, loadOp: 'clear', storeOp: 'store', clearValue: clear0 }, { view: this.v.smAux, loadOp: 'clear', storeOp: 'store', clearValue: clear0 }] });
        p.setBindGroup(0, this.bg0); p.setBindGroup(1, this.bg1); p.setBindGroup(2, this.bgSmM);
        p.setPipeline(this.pSmMarch); p.draw(3); p.end(); }
      { const p = enc.beginRenderPass({ colorAttachments: [{ view: this.v.smHist[hk], loadOp: 'clear', storeOp: 'store', clearValue: clear0 }] });
        p.setBindGroup(0, this.bg0); p.setBindGroup(1, this.bg1); p.setBindGroup(2, this.bgSmT[hk]);
        p.setPipeline(this.pSmTAA); p.draw(3); p.end(); }
      this.histValid = true;
    }
    this._shadeBG(hk);
    // the scene
    { const p = enc.beginRenderPass({ colorAttachments: [{ view: this.v.hdr, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
        depthStencilAttachment: { view: this.v.depth, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' } });
      p.setBindGroup(0, this.bg0); p.setBindGroup(1, this.bg1); p.setBindGroup(2, this.bgShade);
      p.setPipeline(this.pSky); p.draw(3);
      p.setPipeline(this.pSurf); p.draw(3);
      if (f.flashes && f.flashes.length) { p.setPipeline(this.pFlash); p.draw(6, Math.min(4, f.flashes.length)); }
      if (this.smBox) { p.setPipeline(this.pSmComp); p.draw(3); }
      const F = Math.max(1, Math.min(DROPS_MAX, f.frags | 0 || 1));
      p.setPipeline(this.pDrop); p.draw(6, n * F);
      if (f.streakT > 0) { p.setPipeline(this.pStreak); p.draw(6, n); }
      p.end(); }
    this._bloom(enc, f); this._expose(enc, f); this._final(enc, f);
    dev.queue.submit([enc.finish()]);
  }
  // The volume of G^3 cells: sums, field texture, brick marks.
  _makeVolume(G) {
    const dev = this.dev, U = GPUBufferUsage, T = GPUTextureUsage, NB = G / 8;
    this._dropVolume();
    this.vol = {
      G,
      acc: dev.createBuffer({ size: G * G * G * 4, usage: U.STORAGE | U.COPY_DST, label: 'pc volume sums' }),
      bricks: dev.createBuffer({ size: Math.max(16, NB * NB * NB * 4), usage: U.STORAGE | U.COPY_DST, label: 'pc volume bricks' }),
      tex: dev.createTexture({ size: [G, G, G], dimension: '3d', format: 'rgba16float', usage: T.STORAGE_BINDING | T.TEXTURE_BINDING, label: 'pc volume field' }),
    };
    const v = this.vol, view = v.tex.createView({ dimension: '3d' });
    v.view = view;
    this.bgVolC = dev.createBindGroup({ layout: this.bglVolC, entries: [
      { binding: 0, resource: { buffer: v.acc } }, { binding: 1, resource: { buffer: v.bricks } }, { binding: 2, resource: view }] });
    this.bgMarch = dev.createBindGroup({ layout: this.bglMarch, entries: [
      { binding: 0, resource: view }, { binding: 1, resource: { buffer: v.bricks } }, { binding: 2, resource: this.sampClamp }] });
    this.volKey = '';
  }
  _dropVolume() {
    if (!this.vol) return;
    this.vol.acc.destroy(); this.vol.bricks.destroy(); this.vol.tex.destroy();
    this.vol = null; this.volBox = null;
  }
  // The cube of this frame (this.volBox: { o, cell, G }, or null) and
  // whether its field must be built again.
  _volBox(f) {
    const G = Math.max(0, Math.floor((f.grid ?? 144) / 8) * 8);
    if (!G) { this._dropVolume(); return false; }
    if (!this.vol || this.vol.G !== G) this._makeVolume(G);
    const c = f.vol && f.vol.c ? f.vol.c : f.target;
    const r = f.vol && f.vol.r > 0 ? f.vol.r : Math.hypot(...sub(f.target, f.eye)) * Math.tan(f.fov / 2);
    let cell = Math.max(2.2 * r / (G - 1), 0.3 * (this.look.s0min || 0));
    cell = Math.pow(2, Math.round(4 * Math.log2(cell)) / 4);
    const o = c.map(x => (Math.round(x / cell) - (G - 1) / 2) * cell);
    this.volBox = { o, cell, G };
    const key = [G, cell, ...o].join();
    const k = this.sim.k, again = key !== this.volKey || k !== this.volK || k === 0 || this.volSim !== this.sim || this.volSetup !== this.setup;
    this.volKey = key; this.volK = k; this.volSim = this.sim; this.volSetup = this.setup;
    return again;
  }
  _volume(enc) {
    const v = this.vol, G = v.G, NB = G / 8, np = this.sim.np;
    enc.clearBuffer(v.acc); enc.clearBuffer(v.bricks);
    const p = enc.beginComputePass({ label: 'pc volume' });
    p.setBindGroup(0, this.bg0); p.setBindGroup(1, this.bg1c); p.setBindGroup(2, this.bgVolC);
    p.setPipeline(this.pVolScatter); p.dispatchWorkgroups(Math.min(np, 65535), Math.ceil(np / 65535));
    p.setPipeline(this.pVolResolve); const w = Math.ceil(G / 4); p.dispatchWorkgroups(w, w, w);
    p.end();
    return NB;
  }
  // The smoke cube of this frame (this.smBox: { o, cell, G }, or null) and
  // whether it moved. It holds 1.3 x the framed sphere; the cell snaps
  // like the body volume's, so the smoke does not shimmer.
  _smokeBox(f) {
    const sm = f.smoke || {}, G = Math.max(0, Math.floor((sm.grid ?? 80) / 8) * 8);
    if (!G) { this._dropSmoke(); return false; }
    // nothing to draw (the page: before contact): no smoke passes at all
    if (f.smokeLive === false) { this.smBox = null; return false; }
    if (!this.smVol || this.smVol.G !== G) this._makeSmoke(G);
    const c = f.vol && f.vol.c ? f.vol.c : f.target;
    const r = 1.3 * (f.vol && f.vol.r > 0 ? f.vol.r : Math.hypot(...sub(f.target, f.eye)) * Math.tan(f.fov / 2));
    let cell = 2.2 * r / (G - 1);
    cell = Math.pow(2, Math.round(4 * Math.log2(cell)) / 4);
    const o = c.map(x => (Math.round(x / cell) - (G - 1) / 2) * cell);
    this.smBox = { o, cell, G };
    const key = [G, cell, ...o, ...(f.sun || [])].join();
    const again = key !== this.smKey;
    this.smKey = key;
    return again;
  }
  _makeSmoke(G) {
    const dev = this.dev, U = GPUBufferUsage, T = GPUTextureUsage, NB = G / 8;
    this._dropSmoke();
    const t3 = label => dev.createTexture({ size: [G, G, G], dimension: '3d', format: 'rgba16float', usage: T.STORAGE_BINDING | T.TEXTURE_BINDING, label: 'pc smoke ' + label });
    this.smVol = { G,
      acc: dev.createBuffer({ size: G * G * G * 32, usage: U.STORAGE | U.COPY_DST, label: 'pc smoke sums' }),
      bricks: dev.createBuffer({ size: Math.max(16, NB * NB * NB * 4), usage: U.STORAGE | U.COPY_DST, label: 'pc smoke bricks' }),
      med: t3('medium'), vel: t3('velocity'), light: t3('light') };
    const v = this.smVol;
    this.bgSmS = dev.createBindGroup({ layout: this.bglSmS, entries: [{ binding: 0, resource: { buffer: v.acc } }] });
    this.bgSmR = dev.createBindGroup({ layout: this.bglSmR, entries: [{ binding: 0, resource: { buffer: v.acc } }, { binding: 1, resource: { buffer: v.bricks } },
      { binding: 2, resource: v.med.createView() }, { binding: 3, resource: v.vel.createView() }] });
    this.smKey = ''; this.bgSmM = null; this.smLightBody = null; this.histValid = false;
  }
  _dropSmoke() {
    if (!this.smVol) return;
    for (const k of ['acc', 'bricks', 'med', 'vel', 'light']) this.smVol[k].destroy();
    this.smVol = null; this.smBox = null; this.bgSmM = null;
  }
  _smoke(enc) {
    const v = this.smVol, G = v.G, np = this.sim.np;
    const bodyView = this.vol ? this.vol.view : (this.dummy3View || (this.dummy3View = this.dummy3.createView({ dimension: '3d' })));
    if (this.smLightBody !== bodyView) {
      this.smLightBody = bodyView;
      this.bgSmL = this.dev.createBindGroup({ layout: this.bglSmL, entries: [{ binding: 4, resource: v.med.createView() }, { binding: 6, resource: v.light.createView() }, { binding: 10, resource: bodyView }] });
    }
    enc.clearBuffer(v.acc); enc.clearBuffer(v.bricks);
    const p = enc.beginComputePass({ label: 'pc smoke' });
    p.setBindGroup(0, this.bg0); p.setBindGroup(1, this.bg1c);
    if (!this.noiseMade) {
      this.bgSmN = this.bgSmN || this.dev.createBindGroup({ layout: this.bglSmN, entries: [{ binding: 13, resource: this.noiseTex.createView() }, { binding: 14, resource: this.curlTex.createView() }] });
      p.setBindGroup(2, this.bgSmN); p.setPipeline(this.pSmNoise); p.dispatchWorkgroups(16, 16, 16); this.noiseMade = true;
    }
    p.setBindGroup(2, this.bgSmS); p.setPipeline(this.pSmScatter); p.dispatchWorkgroups(Math.min(np, 65535), Math.ceil(np / 65535));
    const w = Math.ceil(G / 4);
    p.setBindGroup(2, this.bgSmR); p.setPipeline(this.pSmResolve); p.dispatchWorkgroups(w, w, w);
    p.setBindGroup(2, this.bgSmL); p.setPipeline(this.pSmLight); p.dispatchWorkgroups(w, w, w);
    p.end();
  }
  _smokeBG() {
    if (this.bgSmM && this.bgSmMKey === this.smVol && this.bgSmMZ === this.v.smB) return;
    const v = this.smVol;
    this.bgSmM = this.dev.createBindGroup({ layout: this.bglSmM, entries: [
      { binding: 4, resource: v.med.createView() }, { binding: 5, resource: v.vel.createView() }, { binding: 7, resource: v.light.createView() },
      { binding: 8, resource: this.noiseTex.createView() }, { binding: 9, resource: this.curlTex.createView() },
      { binding: 11, resource: this.v.smB }, { binding: 12, resource: { buffer: v.bricks } }] });
    this.bgSmMKey = this.smVol; this.bgSmMZ = this.v.smB;
  }
  // the scene pass group 2: the targets, the smoke result, the volumes
  _shadeBG(hk) {
    const body = this.vol ? this.vol.view : null, light = this.smVol || null;
    const key = [this.W, this.H, hk, !!this.smBox].join();
    if (this.bgShade && key === this.shadeKey && this.shadeBody === body && this.shadeLight === light) return;
    const z3 = this.dummy3.createView({ dimension: '3d' }), l1 = this.light1.createView({ dimension: '3d' });
    this.bgShade = this.dev.createBindGroup({ layout: this.bglShade, entries: [
      { binding: 0, resource: this.v.smB }, ...this.v.attr.map((v, i) => ({ binding: 1 + i, resource: v })),
      { binding: 4, resource: this.v.smHist[hk] }, { binding: 5, resource: this.v.nrm }, { binding: 6, resource: this.v.smAux },
      { binding: 7, resource: body || z3 }, { binding: 8, resource: light ? light.light.createView() : l1 }] });
    this.shadeKey = key; this.shadeBody = body; this.shadeLight = light;
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
  // the exposure moves toward key / the mean log luminance of the lit
  // pixels at the rate of the wall time since the last frame (f.time);
  // f.adapt false holds it at 1
  _expose(enc, f) {
    const t = f.time || 0, dt = this.lastT == null ? 0 : Math.min(0.25, Math.max(0, t - this.lastT));
    this.lastT = t;
    if (f.adapt === false) { this.dev.queue.writeBuffer(this.expoBuf, 0, new Float32Array([1, EXPOSE.key, 1, 0])); return; }
    this.dev.queue.writeBuffer(this.expoPrm, 0, new Float32Array([EXPOSE.key, EXPOSE.min, EXPOSE.max, 1 - Math.exp(-dt / EXPOSE.tau), EXPOSE.litLum, 0, 0, 0]));
    const p = enc.beginComputePass({ label: 'pc expose' }); p.setPipeline(this.pExpose); p.setBindGroup(0, this.expoBG); p.dispatchWorkgroups(1); p.end();
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
    for (const b of [this.frameBuf, this.centresBuf, this.cpBuf, this.origBuf, this.partBuf, this.expoBuf, this.expoPrm, ...this.postBufs]) if (b) b.destroy();
    this.mapTex.destroy(); this.dummy.destroy(); this._dropVolume(); this._dropSmoke();
    for (const t of [this.bbTex, this.noiseTex, this.curlTex, this.dummy3, this.light1]) t.destroy();
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
  // the finest spacing: iron (the densest material) of the lightest particles
  const s0min = Math.min(...setup.bodies.map(B => Math.cbrt(B.mp / (MATERIALS.iron.rho0 / UNIT.RHO))));
  return {
    bodies, s0min,
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
