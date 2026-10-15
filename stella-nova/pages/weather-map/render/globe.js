// ============================================================================
//  WEATHER MAP  ·  render/globe.js — the Earth pass and its textures
// ----------------------------------------------------------------------------
//  createGlobe(core) -> globe   (render/core.js calls it; layers do not)
//    encode(pass)        the globe: ground, ocean, night lights, atmosphere,
//                        stars (fsGlobe, writes depth)
//    encodeVeil(pass)    the limb haze over the layers (fsVeil)
//    update(frame, app)  writes the Globe uniform
//    setCloudMap(view, bounds)  rgba16float lat/lon map (r optical depth,
//                        g precip); null restores the empty 1x1 map
//    loadTextures()      starts the tex/ loads (manifest, day 2k then 8k,
//                        US crop, night, height, water). Each load that fails
//                        keeps a flat fallback; nothing throws.
//    status              { day, detail, night, height, water } loaded file names
//    destroy()
//
//  Shader module: frame.wgsl + forge atmo-common.wgsl (atmo.common) + forge
//  sky.wgsl + globe.wgsl, in GLOBE_SHADERS order. The atmosphere LUTs come
//  from ../../forge/atmo.js (createAtmo) with Earth's air (ATMO_EARTH, the
//  forge presets.js Earth block on a 6371 km radius).
//  Mip chains are made on the GPU (MIP_WGSL, one blit per level).
//
//  grep -n targets: "export async function createGlobe", "export const ATMO_EARTH",
//  "export function packGlobe", "export const MIP_WGSL", "export const TEX",
//  "function loadTex", "function makeMips", "export function texPlan"
// ============================================================================
import { createAtmo } from '../../forge/atmo.js';
import { gmstRad } from '../astro.js';

// Page-relative shader paths, joined in this order (the forge atmo-common
// text comes from createAtmo, which loads it once for the LUT passes too).
export const GLOBE_SHADERS = ['shaders/frame.wgsl', '../forge/shaders/atmo-common.wgsl', '../forge/shaders/sky.wgsl', 'shaders/globe.wgsl'];

// forge presets.js ATMO.earth, on Earth's mean radius (top 1.0157 radii)
export const ATMO_EARTH = {
  on: 1, radiusKm: 6371, heightKm: 100, rayleigh: [5.802, 13.558, 33.1], rayleighH: 8,
  mie: [3.996, 3.996, 3.996], mieAbs: [4.4, 4.4, 4.4], mieH: 1.2, mieG: 0.8,
  absorb: [0.65, 1.881, 0.085], absorbC: 25, absorbW: 15, density: 1, sun: 10, ground: 0.3, clarity: 0.35,
};

// tex/ file names (CONTRACT.md, package ASSETS). bounds: default US crop.
export const TEX = {
  manifest: 'tex/manifest.json',
  day: ['tex/day-8k.jpg'], dayLow: 'tex/day-2k.jpg', detail: 'tex/us-day.jpg',
  night: 'tex/night-4k.jpg', height: ['tex/height-4k.png', 'tex/height-4k.jpg'], water: 'tex/water-2k.png',
  detailBounds: { lat0: 15, lat1: 60, lon0: -170, lon1: -50 },
};

// Which files to load and the widest size to keep, per quality.
export function texPlan(quality, maxDim = 8192) {
  const cap = w => Math.min(w, maxDim);
  return {
    dayHigh: quality >= 1 ? { files: TEX.day, maxW: cap(quality >= 2 ? 8192 : 4096) } : null,
    detail: { file: TEX.detail, maxW: cap(quality >= 2 ? 8192 : 4096) },
    night: { file: TEX.night, maxW: cap(quality >= 1 ? 4096 : 2048) },
    height: { files: TEX.height, maxW: cap(quality >= 1 ? 4096 : 2048) },
    water: { file: TEX.water, maxW: cap(2048) },
  };
}

export const GLOBE_FLOATS = 24;
// state: { has: {day, detail, night, height, water, cloud}, detailB, cloudB }
export function packGlobe(state, frame, out = new Float32Array(GLOBE_FLOATS)) {
  const h = state.has, d = state.detailB, c = state.cloudB || { lat0: 0, lat1: 1, lon0: 0, lon1: 1 };
  const q = frame.quality ?? 2, g = gmstRad(frame.t || 0);
  out.set([
    d.lat0, d.lat1, d.lon0, d.lon1,
    c.lat0, c.lat1, c.lon0, c.lon1,
    h.day ? 1 : 0, h.detail ? 1 : 0, h.night ? 1 : 0, h.height ? 1 : 0,
    h.water ? 1 : 0, h.cloud ? 1 : 0, frame.lightMode === 'real' ? 1 : 0, ATMO_EARTH.clarity,
    // relief: height (0..1 after the manifest curve) as 0..6.5 km, drawn 25x for legibility
    6.5 / 6371 * 25, 1.0, 1.1, q >= 2 ? 24 : q >= 1 ? 16 : 12,
    Math.cos(g), Math.sin(g), 1.0, 0.27 * Math.PI / 180 * 3,
  ]);
  return out;
}

export const MIP_WGSL = `
@group(0) @binding(0) var mipSrc: texture_2d<f32>;
@group(0) @binding(1) var mipSmp: sampler;
struct MipV { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex
fn vsMip(@builtin(vertex_index) i: u32) -> MipV {
  var o: MipV;
  let x = f32((i << 1u) & 2u);
  let y = f32(i & 2u);
  o.pos = vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  o.uv = vec2f(x, y);
  return o;
}
@fragment
fn fsMip(v: MipV) -> @location(0) vec4f { return textureSampleLevel(mipSrc, mipSmp, v.uv, 0.0); }
`;

const mipCount = (w, h) => Math.floor(Math.log2(Math.max(w, h))) + 1;

export async function createGlobe(core) {
  const { device, format, depthFormat, loadText, frameLayout } = core;
  const atmo = await createAtmo(device, name => loadText('../forge/shaders/' + name));
  atmo.update(ATMO_EARTH, ATMO_EARTH.ground, [0, 0, 0]);
  const [frameTxt, skyTxt, globeTxt] = await Promise.all([core.frameWGSL || loadText(GLOBE_SHADERS[0]), loadText(GLOBE_SHADERS[2]), loadText(GLOBE_SHADERS[3])]);
  const code = [frameTxt, atmo.common, skyTxt, globeTxt].join('\n');
  const module = device.createShaderModule({ label: 'weather globe', code });

  const tex = { binding: 'float' };
  const F = GPUShaderStage.FRAGMENT;
  const layout = device.createBindGroupLayout({ label: 'weather globe', entries: [
    { binding: 0, visibility: F, buffer: { type: 'uniform' } },
    { binding: 1, visibility: F, buffer: { type: 'uniform' } },
    ...[2, 3, 4, 5, 6, 7, 8, 9].map(b => ({ binding: b, visibility: F, texture: { sampleType: tex.binding } })),
    { binding: 10, visibility: F, sampler: { type: 'filtering' } },
    { binding: 11, visibility: F, sampler: { type: 'filtering' } },
  ] });
  const pLayout = device.createPipelineLayout({ bindGroupLayouts: [frameLayout, layout] });
  const pipe = await device.createRenderPipelineAsync({
    label: 'weather globe', layout: pLayout,
    vertex: { module, entryPoint: 'vsFull' },
    fragment: { module, entryPoint: 'fsGlobe', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'always' },
  });
  const veil = await device.createRenderPipelineAsync({
    label: 'weather veil', layout: pLayout,
    vertex: { module, entryPoint: 'vsFull' },
    fragment: { module, entryPoint: 'fsVeil', targets: [{ format, blend: {
      color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'always' },
  });

  const gBuf = device.createBuffer({ label: 'weather globe uniform', size: GLOBE_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const gPack = new Float32Array(GLOBE_FLOATS);
  const sWrap = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'clamp-to-edge', maxAnisotropy: 8 });
  const sClamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });

  // ── textures ──
  const flat = (rgba, fmt) => {
    const t = device.createTexture({ size: [1, 1], format: fmt, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: t }, new Uint8Array(rgba), { bytesPerRow: 4 }, [1, 1]);
    return t;
  };
  const emptyCloud = device.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: emptyCloud }, new Uint16Array(4), { bytesPerRow: 8 }, [1, 1]);
  const T = {
    day: flat([9, 18, 34, 255], 'rgba8unorm-srgb'),
    detail: flat([9, 18, 34, 255], 'rgba8unorm-srgb'),
    night: flat([0, 0, 0, 255], 'rgba8unorm-srgb'),
    height: flat([0, 0, 0, 255], 'rgba8unorm'),
    water: flat([255, 255, 255, 255], 'rgba8unorm'),
  };
  const state = { has: { day: false, detail: false, night: false, height: false, water: false, cloud: false }, detailB: { ...TEX.detailBounds }, cloudB: null };
  const status = {};
  let cloudView = emptyCloud.createView(), bind = null, dead = false;

  function rebind() {
    bind = device.createBindGroup({ label: 'weather globe', layout, entries: [
      { binding: 0, resource: { buffer: atmo.ubuf } }, { binding: 1, resource: { buffer: gBuf } },
      { binding: 2, resource: T.day.createView() }, { binding: 3, resource: T.detail.createView() },
      { binding: 4, resource: T.night.createView() }, { binding: 5, resource: T.height.createView() },
      { binding: 6, resource: T.water.createView() }, { binding: 7, resource: cloudView },
      { binding: 8, resource: atmo.trans.createView() }, { binding: 9, resource: atmo.multi.createView() },
      { binding: 10, resource: sWrap }, { binding: 11, resource: sClamp },
    ] });
  }
  rebind();

  // GPU mip chains: one blit pipeline per texture format
  const mipModule = device.createShaderModule({ label: 'weather mips', code: MIP_WGSL });
  const mipPipes = new Map();
  const mipSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  function makeMips(t) {
    let p = mipPipes.get(t.format);
    if (!p) {
      p = device.createRenderPipeline({ layout: 'auto', vertex: { module: mipModule, entryPoint: 'vsMip' },
        fragment: { module: mipModule, entryPoint: 'fsMip', targets: [{ format: t.format }] }, primitive: { topology: 'triangle-list' } });
      mipPipes.set(t.format, p);
    }
    const enc = device.createCommandEncoder();
    for (let i = 1; i < t.mipLevelCount; i++) {
      const bg = device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [
        { binding: 0, resource: t.createView({ baseMipLevel: i - 1, mipLevelCount: 1 }) }, { binding: 1, resource: mipSampler }] });
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: t.createView({ baseMipLevel: i, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(p); pass.setBindGroup(0, bg); pass.draw(3); pass.end();
    }
    device.queue.submit([enc.finish()]);
  }

  async function loadTex(path, srgb, maxW) {
    const res = await fetch(new URL(path, core.baseUrl));
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    const blob = await res.blob();
    let bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    if (bmp.width > maxW) {
      const w = maxW, h = Math.max(1, Math.round(bmp.height * maxW / bmp.width));
      bmp.close();
      bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none', resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    }
    if (dead) { bmp.close(); throw new Error('globe destroyed'); }
    const w = bmp.width, h = bmp.height;
    const t = device.createTexture({ label: path, size: [w, h], mipLevelCount: mipCount(w, h), format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    device.queue.copyExternalImageToTexture({ source: bmp }, { texture: t }, [w, h]);
    bmp.close();
    makeMips(t);
    return t;
  }

  function put(key, t, file) {
    if (dead) { t.destroy(); return; }
    const old = T[key];
    T[key] = t; state.has[key] = true; status[key] = file;
    rebind();
    old.destroy();
  }

  async function first(files, srgb, maxW) {
    let err = null;
    for (const f of files) {
      try { return { t: await loadTex(f, srgb, maxW), f }; } catch (e) { err = e; }
    }
    throw err || new Error('no file');
  }

  async function loadTextures() {
    const maxDim = device.limits.maxTextureDimension2D;
    const plan = texPlan(core.quality, maxDim);
    try {
      const r = await fetch(new URL(TEX.manifest, core.baseUrl));
      if (r.ok) {
        const m = await r.json();
        const e = m && m[TEX.detail.replace('tex/', '')];
        const b = e && e.bounds;
        if (b && [b.lat0, b.lat1, b.lon0, b.lon1].every(Number.isFinite)) state.detailB = { lat0: b.lat0, lat1: b.lat1, lon0: b.lon0, lon1: b.lon1 };
      }
    } catch { /* no manifest yet: the default crop bounds */ }
    const jobs = [];
    const job = (key, files, srgb, maxW) => jobs.push(first(files, srgb, maxW).then(r => put(key, r.t, r.f), e => { status[key + 'Error'] = String(e.message || e); }));
    // the 2k day map first (fast), then the large one replaces it
    const day = first([TEX.dayLow], true, Math.min(2048, maxDim)).then(r => put('day', r.t, r.f), e => { status.dayError = String(e.message || e); });
    jobs.push(day);
    if (plan.dayHigh) jobs.push(day.then(() => first(plan.dayHigh.files, true, plan.dayHigh.maxW)).then(r => put('day', r.t, r.f), e => { status.dayHighError = String(e.message || e); }));
    job('detail', [plan.detail.file], true, plan.detail.maxW);
    job('night', [plan.night.file], true, plan.night.maxW);
    job('height', plan.height.files, false, plan.height.maxW);
    job('water', [plan.water.file], false, plan.water.maxW);
    await Promise.all(jobs);
    return status;
  }

  return {
    atmo, status, state,
    setCloudMap(view, bounds) {
      cloudView = view || emptyCloud.createView();
      state.has.cloud = !!view;
      state.cloudB = view && bounds ? { ...bounds } : null;
      rebind();
    },
    update(frame) {
      device.queue.writeBuffer(gBuf, 0, packGlobe(state, frame, gPack));
    },
    encode(pass) {
      pass.setPipeline(pipe); pass.setBindGroup(0, core.frameGroup); pass.setBindGroup(1, bind); pass.draw(3);
    },
    encodeVeil(pass) {
      pass.setPipeline(veil); pass.setBindGroup(0, core.frameGroup); pass.setBindGroup(1, bind); pass.draw(3);
    },
    loadTextures,
    destroy() {
      dead = true;
      for (const k in T) T[k].destroy();
      emptyCloud.destroy(); gBuf.destroy(); atmo.destroy();
    },
  };
}
