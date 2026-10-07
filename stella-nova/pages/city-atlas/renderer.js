// renderer.js — the City Atlas WebGPU renderer. No DOM text.
//
// createRenderer(canvas, opts) -> renderer
//   renderer.upload(city)   GPU resources for one decoded city (worker.js
//                           output). Returns a slot; uploading the next city
//                           while the current one shows makes the cut
//                           instant (the saver preloads this way).
//   renderer.show(slot)     make a slot current (frees the slot it replaces
//                           unless keep is set), hands the city to the wind
//                           solver, reseeds the tracers
//   renderer.addBuildings(slot, full)   the building mesh and raster
//                           (worker.js stage 2), after the terrain is up
//   renderer.drop(slot)     free a slot
//   renderer.frame(s)       one frame: wind steps, tracer moves, draw.
//                           s = { cam, aspect, light, exag, terrain, colourMode,
//                           ocean: { on, hour }, wind: { on, heat, ... }, dt }
//   renderer.resize(w, h)
//   renderer.info           { gpuMs, gpuHist, tris, pass, shadowDraws, shadowPending }
//                           gpuHist: submit-to-done ms of every 5th frame
//                           (main.js governor); pass: GPU ms per pass with
//                           ?gputime in the page URL (timestamp queries)
//   The ocean and wind overlays build their pipelines and buffers on first
//   use (needOcean, needWind). The wind solver steps only while its overlay
//   shows. The shadow map redraws only when the sun, the relief or the city
//   changes (shadowKey). Buildings under 2 px drop out by the LOD prefix.
//
// A shadow pass first draws the buildings from the sun (sunMatrix) into a
// depth map, which the terrain and building shaders read (shadowAt).
// Draw order in the main pass (reversed depth, 'greater'): sky (no depth),
// outer terrain, inner terrain (with its skirt), buildings, then the ocean
// and wind streaks (depth test, no depth write, additive).
//
// grep: function createRenderer  function lightFor  upload(  show(  frame(  function addBuildings
//       function needWind  function needOcean  shadowKey  LOD_SIZES  const TS
//       function sunMatrix  const LIGHTS

import { viewProj, lookAt, mul } from './camera.js';
import { createTracers } from './tracers.js';
import { createWind } from './wind.js';
import { LOD_SIZES } from './mesh.js';

export const LIGHTS = {
  day: { elev: 38, sun: [1.0, 0.95, 0.88], sunK: 1.25, amb: 0.62, hor: [0.66, 0.74, 0.84], zen: [0.20, 0.38, 0.66], night: 0 },
  golden: { elev: 11, sun: [1.0, 0.72, 0.48], sunK: 1.35, amb: 0.55, hor: [0.86, 0.71, 0.60], zen: [0.30, 0.42, 0.64], night: 0.12 },
  dusk: { elev: -4, sun: [0.85, 0.42, 0.36], sunK: 0.35, amb: 0.55, hor: [0.42, 0.30, 0.36], zen: [0.07, 0.09, 0.19], night: 0.8 },
  night: { elev: 30, sun: [0.42, 0.50, 0.70], sunK: 0.28, amb: 0.42, hor: [0.06, 0.075, 0.12], zen: [0.008, 0.012, 0.03], night: 1 },
};

// Light preset + sun bearing (degrees) -> Frame uniform parts.
export function lightFor(name, azDeg) {
  const L = LIGHTS[name] || LIGHTS.day;
  const el = (Math.max(L.elev, 3) * Math.PI) / 180;   // light from above even after sunset (sky light)
  const az = (azDeg * Math.PI) / 180;
  const sun = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
  return { sun, night: L.night, sunCol: L.sun.map((c) => c * L.sunK), amb: L.amb, hor: L.hor, zen: L.zen, skySun: L.elev };
}

export async function createRenderer(canvas, opts = {}) {
  if (!navigator.gpu) throw new Error('WebGPU not available');
  const boot = { t0: performance.now() };
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no WebGPU adapter');
  // ?gputime in the page URL: GPU timestamps per pass (debug handle perf.pass)
  const timing = !!opts.timing && adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice(timing ? { requiredFeatures: ['timestamp-query'] } : undefined);
  let lost = false;
  // 'destroyed' is the shell's release on a page swap (lib/gpu-guard.js), not a fault
  device.lost.then((i) => { lost = true; if (i?.reason !== 'destroyed') console.warn('city-atlas: device lost', i?.message); });
  const ctx = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });
  // MSAA only on low-density screens: at 2 device px per CSS px the edges
  // are already fine, and 4 samples there cost 4 times the fill.
  const sampleCount = opts.msaa ? 4 : 1;
  const depthFormat = 'depth32float';

  const base = new URL('./shaders/', import.meta.url);
  const src = async (n) => {
    const r = await fetch(new URL(n, base));
    if (!r.ok) throw new Error(`${n}: ${r.status}`);
    return r.text();
  };
  boot.device = performance.now() - boot.t0;
  const [common, terrainS, buildingsS, skyS, tracersS, linesS, lbmS] = await Promise.all(
    ['common.wgsl', 'terrain.wgsl', 'buildings.wgsl', 'sky.wgsl', 'tracers.wgsl', 'lines.wgsl', 'lbm.wgsl'].map(src));

  const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT, C = GPUShaderStage.COMPUTE;
  const VFC = V | F | C;
  const layouts = {
    scene: device.createBindGroupLayout({ label: 'scene', entries: [
      { binding: 0, visibility: VFC, buffer: { type: 'uniform' } },
      { binding: 1, visibility: VFC, sampler: { type: 'filtering' } },
      { binding: 2, visibility: VFC, texture: { sampleType: 'unfilterable-float' } },
      { binding: 3, visibility: VFC, texture: { sampleType: 'unfilterable-float' } },
      { binding: 4, visibility: VFC, texture: { sampleType: 'float' } },
      { binding: 5, visibility: VFC, texture: { sampleType: 'float' } },
      { binding: 6, visibility: VFC, texture: { sampleType: 'uint' } },
      { binding: 7, visibility: VFC, texture: { sampleType: 'uint' } },
      { binding: 8, visibility: VFC, texture: { sampleType: 'depth' } },
      { binding: 9, visibility: VFC, sampler: { type: 'comparison' } },
    ] }),
    frameOnly: device.createBindGroupLayout({ label: 'frameOnly', entries: [
      { binding: 0, visibility: V, buffer: { type: 'uniform' } },
    ] }),
    overlay: device.createBindGroupLayout({ label: 'overlay', entries: [
      { binding: 0, visibility: VFC, buffer: { type: 'uniform' } },
      { binding: 1, visibility: VFC, texture: { sampleType: 'float' } },
      { binding: 2, visibility: VFC, texture: { sampleType: 'float' } },
      { binding: 3, visibility: VFC, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 4, visibility: VFC, texture: { sampleType: 'float', viewDimension: '2d-array' } },
    ] }),
    mesh: device.createBindGroupLayout({ label: 'mesh', entries: [
      { binding: 0, visibility: V | F, buffer: { type: 'uniform' } },
    ] }),
    tCompute: device.createBindGroupLayout({ label: 'tCompute', entries: [
      { binding: 0, visibility: C, buffer: { type: 'uniform' } },
      { binding: 1, visibility: C, buffer: { type: 'storage' } },
      { binding: 2, visibility: C, buffer: { type: 'storage' } },
    ] }),
    tRender: device.createBindGroupLayout({ label: 'tRender', entries: [
      { binding: 0, visibility: V | F, buffer: { type: 'uniform' } },
      { binding: 1, visibility: V, buffer: { type: 'read-only-storage' } },
    ] }),
  };

  const mod = async (code, label) => {
    const m = device.createShaderModule({ code, label });
    const info = await m.getCompilationInfo();
    const errs = info.messages.filter((x) => x.type === 'error');
    if (errs.length) throw new Error(`${label}: ` + errs.map((e) => `${e.lineNum}:${e.linePos} ${e.message}`).join('; '));
    return m;
  };
  boot.fetch = performance.now() - boot.t0;
  const [mTerrain, mBuild, mSky] = await Promise.all([
    mod(common + '\n' + terrainS, 'terrain'), mod(common + '\n' + buildingsS, 'buildings'), mod(common + '\n' + skyS, 'sky'),
  ]);
  const ms = { count: sampleCount };
  const pl = (groups) => device.createPipelineLayout({ bindGroupLayouts: groups });
  const bVerts = [{ arrayStride: 20, attributes: [
    { shaderLocation: 0, offset: 0, format: 'sint16x4' },
    { shaderLocation: 1, offset: 8, format: 'sint16x2' },
    { shaderLocation: 2, offset: 12, format: 'snorm8x4' },
    { shaderLocation: 3, offset: 16, format: 'unorm8x4' },
  ] }];
  boot.modules = performance.now() - boot.t0;
  const [pSky, pTerrain, pBuild, pShadow] = await Promise.all([
    device.createRenderPipelineAsync({
      layout: pl([layouts.scene, layouts.overlay]),
      vertex: { module: mSky, entryPoint: 'vs' },
      fragment: { module: mSky, entryPoint: 'fs', targets: [{ format }] },
      depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'always' },
      multisample: ms,
    }),
    device.createRenderPipelineAsync({
      layout: pl([layouts.scene, layouts.overlay, layouts.mesh]),
      vertex: { module: mTerrain, entryPoint: 'vs' },
      fragment: { module: mTerrain, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' },
      multisample: ms,
    }),
    device.createRenderPipelineAsync({
      layout: pl([layouts.scene, layouts.overlay]),
      vertex: { module: mBuild, entryPoint: 'vs', buffers: bVerts },
      fragment: { module: mBuild, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      // buildings win a depth tie with the ground they stand on
      depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater', depthBias: 2, depthBiasSlopeScale: 1.0 },
      multisample: ms,
    }),
    // the sun shadow map: buildings only, normal depth (0 near the sun)
    device.createRenderPipelineAsync({
      layout: pl([layouts.frameOnly]),
      vertex: { module: mBuild, entryPoint: 'vsShadow', buffers: bVerts },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 3, depthBiasSlopeScale: 2.0 },
    }),
  ]);

  const tctx = { layouts, code: { common, tracers: tracersS, lines: linesS }, format, depthFormat, sampleCount };
  const mobile = !!opts.mobile;
  boot.pipelines = performance.now() - boot.t0;
  // The overlays compile their pipelines and make their buffers on first use,
  // so the first frame of the plain city does not wait for them.
  let ocean = null, windT = null, wind = null;
  let oceanP = null, windP = null;
  const windFlow = { dirFrom: 270, speed: 5, slice: 12, seaBreeze: 0 };
  function needOcean() {
    if (!oceanP) {
      oceanP = createTracers(device, tctx, { mode: 0, max: mobile ? 5000 : 12000, K: 26, label: 'ocean' })
        .then((t) => { ocean = t; return t; });
    }
    return oceanP;
  }
  function needWind() {
    if (!windP) {
      windP = Promise.all([
        createTracers(device, tctx, { mode: 1, max: mobile ? 7000 : 18000, K: 22, label: 'wind' }),
        createWind(device, { lbm: lbmS }, { fineN: mobile ? 384 : 640, coarseN: 256, fineSteps: mobile ? 3 : 4, coarseSteps: 2 }),
      ]).then(([t, w]) => {
        windT = t; wind = w;
        wind.set(windFlow);
        for (const s of live) { if (!s.dropped) s.gOv = overlayGroup(s); }
        if (cur) windCity(cur);
        return w;
      });
    }
    return windP;
  }

  // ---------------------------------------------------------------- shared buffers
  const U = GPUBufferUsage, T = GPUTextureUsage;
  const frameBuf = device.createBuffer({ size: 320, usage: U.UNIFORM | U.COPY_DST, label: 'frame' });
  const SHADOW_N = mobile ? 1024 : 2048;
  const shadowT = device.createTexture({ size: [SHADOW_N, SHADOW_N], format: 'depth32float', usage: T.RENDER_ATTACHMENT | T.TEXTURE_BINDING, label: 'shadow' });
  const shadowView = shadowT.createView();
  const cmpS = device.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' });
  const gFrameOnly = device.createBindGroup({ layout: layouts.frameOnly, entries: [{ binding: 0, resource: { buffer: frameBuf } }] });
  const ovBuf = device.createBuffer({ size: 80, usage: U.UNIFORM | U.COPY_DST, label: 'ov' });
  const linS = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const meshU = (half, n, level, skirt) => {
    const b = device.createBuffer({ size: 16, usage: U.UNIFORM | U.COPY_DST });
    device.queue.writeBuffer(b, 0, new Float32Array([half, n, level, skirt]));
    return b;
  };
  const gridIndex = (side) => {
    const q = side - 1;
    const a = new Uint32Array(q * q * 6);
    let k = 0;
    for (let j = 0; j < q; j++) for (let i = 0; i < q; i++) {
      const v = j * side + i;
      a[k++] = v; a[k++] = v + 1; a[k++] = v + side;
      a[k++] = v + 1; a[k++] = v + side + 1; a[k++] = v + side;
    }
    const b = device.createBuffer({ size: a.byteLength, usage: U.INDEX | U.COPY_DST });
    device.queue.writeBuffer(b, 0, a);
    return { buf: b, count: a.length };
  };
  const idxCache = new Map();
  const indexFor = (side) => { if (!idxCache.has(side)) idxCache.set(side, gridIndex(side)); return idxCache.get(side); };
  const emptyArr = device.createTexture({ size: [1, 1, 2], format: 'rg8snorm', usage: T.TEXTURE_BINDING, label: 'emptySea' });
  const emptyMacro = device.createTexture({ size: [1, 1], format: 'rgba16float', usage: T.TEXTURE_BINDING, label: 'emptyWind' });
  const live = new Set();          // uploaded slots, for the overlay group rebuild
  function overlayGroup(s) {
    return device.createBindGroup({ layout: layouts.overlay, entries: [
      { binding: 0, resource: { buffer: ovBuf } },
      { binding: 1, resource: (wind ? wind.coarseTex : emptyMacro).createView() },
      { binding: 2, resource: (wind ? wind.fineTex : emptyMacro).createView() },
      { binding: 3, resource: (s.seaIn || emptyArr).createView({ dimension: '2d-array' }) },
      { binding: 4, resource: (s.seaOut || emptyArr).createView({ dimension: '2d-array' }) },
    ] });
  }

  // ---------------------------------------------------------------- city upload
  function tex(size, format, data, bpp, label) {
    const t = device.createTexture({ size, format, usage: T.TEXTURE_BINDING | T.COPY_DST, label });
    const [w, h, l = 1] = size;
    device.queue.writeTexture({ texture: t }, data, { bytesPerRow: w * bpp, rowsPerImage: h }, [w, h, l]);
    return t;
  }
  // heights: ground and surface int16 dm, water fraction at 2x resolution u8.
  // worker.js packs them (packHeights) off the main thread; this is the fallback.
  function heightTex(ground, surf, wf, n, wn, label, packed) {
    if (packed) return tex([n, n], 'rgba32float', packed, 16, label);
    const out = new Float32Array(n * n * 4);
    const k = wn / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const o = (j * n + i) * 4, s = j * n + i;
      out[o] = ground[s] * 0.1;
      out[o + 1] = surf[s] * 0.1;
      let w = 0;
      for (let b = 0; b < k; b++) for (let a = 0; a < k; a++) w += wf[(j * k + b) * wn + i * k + a];
      out[o + 2] = w / (k * k * 255);
    }
    return tex([n, n], 'rgba32float', out, 16, label);
  }

  let slotSeq = 0;
  function upload(c) {
    const A = c.arrays, m = c.meta;
    const nIn = A.t_in.shape[0], nOut = A.t_out.shape[0];
    const wnIn = A.wf_in.shape[0], wnOut = A.wf_out.shape[0];
    const s = { id: m.id, meta: m, seq: ++slotSeq, textures: [], buffers: [] };
    const keep = (t) => { s.textures.push(t); return t; };
    s.hIn = keep(heightTex(A.t_in.data, A.s_in.data, A.wf_in.data, nIn, wnIn, 'hIn', c.hInData));
    s.hOut = keep(heightTex(A.t_out.data, A.s_out.data, A.wf_out.data, nOut, wnOut, 'hOut', c.hOutData));
    s.wIn = keep(tex([wnIn, wnIn], 'r8unorm', A.wf_in.data, 1, 'wIn'));
    s.wOut = keep(tex([wnOut, wnOut], 'r8unorm', A.wf_out.data, 1, 'wOut'));
    s.cIn = keep(tex([A.lc_in.shape[0], A.lc_in.shape[0]], 'r8uint', A.lc_in.data, 1, 'cIn'));
    s.cOut = keep(tex([A.lc_out.shape[0], A.lc_out.shape[0]], 'r8uint', A.lc_out.data, 1, 'cOut'));
    s.rough = keep(tex([A.rough.shape[0], A.rough.shape[1]], 'rg8unorm', A.rough.data, 2, 'rough'));
    const sea = (a, label) => {
      if (!a) return null;
      const [Tn, n] = a.shape;
      return keep(tex([n, n, Tn], 'rg8snorm', a.data, 2, label));
    };
    s.seaIn = sea(A.cur_in, 'seaIn');
    s.seaOut = sea(A.cur_out, 'seaOut');
    s.nIn = nIn; s.nOut = nOut;
    s.gHalfIn = m.grid.inner.half; s.gHalfOut = m.grid.outer.half;
    s.bCount = 0;          // addBuildings() fills the buildings
    if (c.mesh) addBuildings(s, c);
    s.meshOut = meshU(s.gHalfOut, nOut, 0, 0);
    s.meshIn = meshU(s.gHalfIn, nIn, 1, 4);
    s.buffers.push(s.meshOut, s.meshIn);
    s.gScene = device.createBindGroup({ layout: layouts.scene, entries: [
      { binding: 0, resource: { buffer: frameBuf } }, { binding: 1, resource: linS },
      { binding: 2, resource: s.hIn.createView() }, { binding: 3, resource: s.hOut.createView() },
      { binding: 4, resource: s.wIn.createView() }, { binding: 5, resource: s.wOut.createView() },
      { binding: 6, resource: s.cIn.createView() }, { binding: 7, resource: s.cOut.createView() },
      { binding: 8, resource: shadowView }, { binding: 9, resource: cmpS },
    ] });
    s.gOv = overlayGroup(s);
    live.add(s);
    s.gMeshOut = device.createBindGroup({ layout: layouts.mesh, entries: [{ binding: 0, resource: { buffer: s.meshOut } }] });
    s.gMeshIn = device.createBindGroup({ layout: layouts.mesh, entries: [{ binding: 0, resource: { buffer: s.meshIn } }] });
    s.layers = A.cur_out ? A.cur_out.shape[0] : (A.cur_in ? A.cur_in.shape[0] : 1);
    return s;
  }

  // The worker's second stage: the merged building mesh (one vertex and one
  // index buffer for the whole city, largest buildings first) and the
  // building height raster for the wind solver.
  function addBuildings(s, c) {
    if (s.dropped || s.bTex) return;
    const keep = (t) => { s.textures.push(t); return t; };
    s.bTex = keep(tex([c.bN, c.bN], 'r32float', c.bRaster, 4, 'bRaster'));
    s.lod = c.mesh.lod || null;
    const n = c.mesh.indices.length;
    if (n) {
      s.vb = device.createBuffer({ size: c.mesh.vertices.byteLength, usage: U.VERTEX | U.COPY_DST, label: 'bVerts' });
      device.queue.writeBuffer(s.vb, 0, c.mesh.vertices);
      s.ib = device.createBuffer({ size: Math.ceil(c.mesh.indices.byteLength / 4) * 4, usage: U.INDEX | U.COPY_DST, label: 'bIdx' });
      device.queue.writeBuffer(s.ib, 0, c.mesh.indices.buffer, c.mesh.indices.byteOffset, c.mesh.indices.byteLength);
      s.buffers.push(s.vb, s.ib);
    }
    s.bCount = n;
    if (s === cur) { shadowKey = ''; windCityId = -1; }    // new shadow casters, new wind walls
  }

  function drop(s) {
    if (!s || s.dropped) return;
    s.dropped = true;
    live.delete(s);
    for (const t of s.textures) t.destroy();
    for (const b of s.buffers) b.destroy();
  }

  // ---------------------------------------------------------------- targets
  let W = 1, H = 1, colorT = null, depthT = null;
  function resize(w, h) {
    W = Math.max(1, w); H = Math.max(1, h);
    colorT?.destroy(); depthT?.destroy();
    colorT = sampleCount > 1 ? device.createTexture({ size: [W, H], format, sampleCount, usage: T.RENDER_ATTACHMENT }) : null;
    depthT = device.createTexture({ size: [W, H], format: depthFormat, sampleCount, usage: T.RENDER_ATTACHMENT });
  }

  let cur = null;
  const frameRaw = new Float32Array(80);
  const ovRaw = new Float32Array(20);
  const info = { tris: 0, gpuMs: 0, gpuHist: [], boot, shadowDraws: 0, sampleCount };
  let frameNo = 0, gpuBusy = false;
  // GPU timestamps: pairs (begin, end) for wind, ocean streaks, wind streaks, shadow, main pass
  const TS = ['wind', 'ocean', 'windT', 'shadow', 'main'];
  let qs = null, qResolve = null, qRead = null, qBusy = false;
  const passHist = Object.fromEntries(TS.map((k) => [k, []]));
  info.pass = {};
  if (timing) {
    qs = device.createQuerySet({ type: 'timestamp', count: TS.length * 2 });
    qResolve = device.createBuffer({ size: TS.length * 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    qRead = device.createBuffer({ size: TS.length * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  }
  const tsPair = (k) => ({ querySet: qs, beginningOfPassWriteIndex: 2 * k, endOfPassWriteIndex: 2 * k + 1 });

  // Orthographic view from the sun over the building square (half side ex m),
  // centred at height z0. Depth runs 0..1 over 4 ex + 2 km along the sun ray.
  function sunMatrix(sun, ex, z0) {
    const D = 2 * ex + 1000;
    const c = [0, 0, z0];
    const eye = [sun[0] * D, sun[1] * D, z0 + sun[2] * D];
    const up = Math.abs(sun[2]) > 0.95 ? [0, 1, 0] : [0, 0, 1];
    const v = lookAt(eye, c, up);
    const n = 0, fz = 2 * D;
    const o = new Float32Array(16);
    o[0] = 1 / ex; o[5] = 1 / ex; o[10] = -1 / (fz - n); o[14] = -n / (fz - n); o[15] = 1;
    return mul(o, v);
  }

  function windCity(s) {
    wind.setCity({
      hIn: s.hIn, hOut: s.hOut, rough: s.rough, bTex: s.bTex,
      gHalfIn: s.gHalfIn, gHalfOut: s.gHalfOut, bHalf: s.meta.bHalf, fHalf: s.meta.fHalf,
      block: (s.meta.groundRef ?? 0) + 160,
    });
    windCityId = s.seq;
  }
  let windCityId = -1, shadowKey = '', shadowAt = -100;

  // A new city: the wind solver takes it the next time the wind is on.
  function show(s) {
    cur = s;
    shadowKey = '';
    windCityId = -1;
    ocean?.reseed();
    windT?.reseed();
  }

  function frame(st) {
    if (lost || !cur) return;
    const s = cur, m = s.meta;
    const { vp, eye, inv } = viewProj(st.cam, W / H, st.fovY || 0.75, st.offsetY || 0);
    info.vp = vp;
    const lt = st.light;
    const f = frameRaw;
    f.set(vp, 0);
    f.set([eye[0], eye[1], eye[2], st.time || 0], 16);
    f.set([lt.sun[0], lt.sun[1], lt.sun[2], lt.night], 20);
    f.set([lt.sunCol[0], lt.sunCol[1], lt.sunCol[2], lt.amb], 24);
    f.set([lt.hor[0], lt.hor[1], lt.hor[2], st.fog || 22000], 28);
    f.set([lt.zen[0], lt.zen[1], lt.zen[2], st.exag], 32);
    f.set([s.gHalfIn, s.gHalfOut, s.nIn, s.nOut], 36);
    f.set([W, H, st.dpr || 1, st.colourMode || 0], 40);
    f.set([st.terrain, st.contour || 20, m.r * 1000, 0], 44);
    f.set(inv, 48);
    f.set(sunMatrix(lt.sun, m.fHalf * 1.03, st.cam.target[2]), 64);
    device.queue.writeBuffer(frameBuf, 0, f);

    const oc = st.ocean, wd = st.wind;
    const layer = Math.min(Math.max(oc.hour, 0), s.layers - 1);
    // rg8snorm reads int8 / 127; curScale* is m/s per int8 unit
    ovRaw.set([oc.on, layer, s.layers, (m.curScaleIn || 0) * 127], 0);
    ovRaw.set([(m.curScaleOut || 0) * 127, m.curTop || 0.5, s.seaIn ? 1 : 0, 0], 4);
    const hasOcean = oc.on > 0 && !!(s.seaIn || s.seaOut);
    if (hasOcean && !ocean) needOcean();
    if (wd.on > 0 && !wind) needWind();
    const windOn = wd.on > 0 && !!wind;
    if (windOn && windCityId !== s.seq) windCity(s);
    const d = wind ? wind.dir : [1, 0];
    ovRaw.set([windOn ? wd.on : 0, wd.heat, d[0], d[1]], 8);
    ovRaw.set([wind ? wind.fHalf : 1, wind ? wind.cHalf : 1, wind ? wind.scale : 0, wd.slice], 12);
    ovRaw.set([wd.colourTop || Math.max(wd.speed * 2.2, 2.5), wind ? wind.fineN : 1, wind ? wind.coarseN : 1, 0], 16);
    device.queue.writeBuffer(ovBuf, 0, ovRaw);

    const enc = device.createCommandEncoder();
    const timeIt = timing && !qBusy && frameNo % 10 === 0;
    const wrote = [false, false, false, false, true];
    if (windOn) { wind.step(enc, st.windMult ?? 1, timeIt ? { querySet: qs, begin: 0, end: 1 } : null); wrote[0] = wrote[2] = true; }
    const dt = Math.min(st.dt, 0.05);
    if (hasOcean && ocean) {
      wrote[1] = true;
      ocean.update(enc, s.gScene, s.gOv, {
        count: Math.round((mobile ? 4000 : 10000) * (st.particleShare ?? 1)), nInner: Math.round((mobile ? 4000 : 10000) * (st.particleShare ?? 1) * 0.7),
        dt, speedup: (st.oceanVis ?? 300) / Math.max(m.curTop || 0.5, 0.05), lift: 2.0, lineW: mobile ? 1.1 : 1.0, alpha: 0.9,
        innerR: s.gHalfIn * 0.98, outerR: s.gHalfOut * 0.9, colourTop: m.curTop || 0.5, lifeS: 4.5,
      }, timeIt ? tsPair(1) : null);
    }
    if (windOn) {
      const cnt = Math.round((st.windCount ?? (mobile ? 6000 : 16000)) * (st.particleShare ?? 1));
      windT.update(enc, s.gScene, s.gOv, {
        count: cnt, nInner: Math.round(cnt * 0.72), dt,
        speedup: (st.windVis ?? 300) / Math.max(wd.speed, 0.5), lift: wd.slice, lineW: mobile ? 1.1 : 1.0, alpha: st.windAlpha ?? 0.7,
        innerR: m.fHalf * 0.96, outerR: s.gHalfIn * 0.97,
        colourTop: wd.colourTop || Math.max(wd.speed * 2.2, 2.5), lifeS: 3.5,
      }, timeIt ? tsPair(2) : null);
    }

    // The shadow map depends on the sun, the exaggeration and the city only,
    // not on the camera: draw it again only when one of them changes.
    const sk = `${s.seq}|${lt.sun[0].toFixed(3)},${lt.sun[1].toFixed(3)},${lt.sun[2].toFixed(3)}|${st.exag.toFixed(3)}|${st.cam.target[2].toFixed(1)}`;
    // While E eases (a terrain toggle) it changes every frame: then at most
    // every 4th frame; the settled value always draws.
    // No casters (night, or the buildings not here yet): clear the map once,
    // so no shadow of the city before stays on the terrain.
    const casters = s.bCount > 0 && lt.night < 0.6;
    const want = casters ? sk : `none|${s.seq}`;
    if (want !== shadowKey && (!casters || frameNo - shadowAt >= 4 || shadowKey === '' || shadowKey.startsWith('none'))) {
      shadowKey = want;
      shadowAt = frameNo;
      wrote[3] = true;
      info.shadowDraws++;
      const sp = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: shadowView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' }, ...(timeIt ? { timestampWrites: tsPair(3) } : {}) });
      if (casters) {
        sp.setPipeline(pShadow);
        sp.setBindGroup(0, gFrameOnly);
        sp.setVertexBuffer(0, s.vb);
        sp.setIndexBuffer(s.ib, 'uint32');
        sp.drawIndexed(s.bCount);
      }
      sp.end();
    }
    // a skipped redraw (the 4-frame limit) still owes one: main.js keeps drawing
    info.shadowPending = want !== shadowKey;
    const view = ctx.getCurrentTexture().createView();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: colorT ? colorT.createView() : view, resolveTarget: colorT ? view : undefined,
        loadOp: 'clear', storeOp: colorT ? 'discard' : 'store', clearValue: [0, 0, 0, 1],
      }],
      depthStencilAttachment: { view: depthT.createView(), depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      ...(timeIt ? { timestampWrites: tsPair(4) } : {}),
    });
    pass.setBindGroup(0, s.gScene);
    pass.setBindGroup(1, s.gOv);
    pass.setPipeline(pSky);
    pass.draw(3);
    pass.setPipeline(pTerrain);
    const io = indexFor(s.nOut);
    pass.setBindGroup(2, s.gMeshOut);
    pass.setIndexBuffer(io.buf, 'uint32');
    pass.drawIndexed(io.count);
    const ii = indexFor(s.nIn + 2);
    pass.setBindGroup(2, s.gMeshIn);
    pass.setIndexBuffer(ii.buf, 'uint32');
    pass.drawIndexed(ii.count);
    // Distance LOD: skip the buildings that would be under 2 px across at
    // the nearest edge of the building disc (largest first in the buffer).
    let bDraw = s.bCount;
    if (s.lod) {
      const fpx = (H / 2) / Math.tan((st.fovY || 0.75) / 2);
      const near = Math.max(150, st.cam.dist - m.r * 1000 * 1.1);
      const sMin = 2 * near / fpx;
      for (let k = 0; k < LOD_SIZES.length; k++) if (LOD_SIZES[k] <= sMin) { bDraw = s.lod[k]; break; }
    }
    if (bDraw) {
      pass.setPipeline(pBuild);
      pass.setVertexBuffer(0, s.vb);
      pass.setIndexBuffer(s.ib, 'uint32');
      pass.drawIndexed(bDraw);
    }
    if (hasOcean && ocean) ocean.draw(pass, s.gScene, s.gOv);
    if (windOn) windT.draw(pass, s.gScene, s.gOv);
    pass.end();
    if (timeIt) {
      enc.resolveQuerySet(qs, 0, TS.length * 2, qResolve, 0);
      enc.copyBufferToBuffer(qResolve, 0, qRead, 0, TS.length * 16);
    }
    device.queue.submit([enc.finish()]);
    if (timeIt) {
      qBusy = true;
      const wroteNow = wrote;
      qRead.mapAsync(GPUMapMode.READ).then(() => {
        const t = new BigInt64Array(qRead.getMappedRange().slice(0));
        qRead.unmap();
        TS.forEach((k, i) => {
          const a = t[2 * i], b = t[2 * i + 1];
          if (!wroteNow[i]) { passHist[k].length = 0; delete info.pass[k]; return; }   // an off pass shows no old cost
          if (a > 0n && b > a) {
            const h = passHist[k];
            h.push(Number(b - a) / 1e6); if (h.length > 30) h.shift();
            const srt = h.slice().sort((x, y) => x - y);
            info.pass[k] = srt[srt.length >> 1];
          }
        });
        qBusy = false;
      }).catch(() => { qBusy = false; });
    }
    info.tris = (io.count + ii.count + bDraw) / 3;
    // submit-to-done time of every 10th frame: about the GPU cost of a frame
    if ((++frameNo % 5) === 0 && !gpuBusy) {
      gpuBusy = true;
      const t0 = performance.now();
      device.queue.onSubmittedWorkDone().then(() => {
        info.gpuMs = performance.now() - t0;
        info.gpuHist.push(info.gpuMs); if (info.gpuHist.length > 24) info.gpuHist.shift();
        gpuBusy = false;
      });
    }
  }

  return {
    device, info, upload, addBuildings, drop, resize,
    get wind() { return wind; },
    // wind settings; kept until the solver exists, then passed on
    setWind(f) { Object.assign(windFlow, f); wind?.set(windFlow); },
    show,
    get current() { return cur; },
    get width() { return W; },
    get height() { return H; },
    frame,
    get lost() { return lost; },
    destroy() {
      try { wind?.destroy(); ocean?.destroy(); windT?.destroy(); } catch { /* */ }
      device.destroy();
    },
  };
}
