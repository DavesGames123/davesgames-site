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
//   renderer.drop(slot)     free a slot
//   renderer.frame(s)       one frame: wind steps, tracer moves, draw.
//                           s = { cam, aspect, light, exag, terrain, colourMode,
//                           ocean: { on, hour }, wind: { on, heat, ... }, dt }
//   renderer.resize(w, h)
//   renderer.info           { gpuMs?, tris }
//
// A shadow pass first draws the buildings from the sun (sunMatrix) into a
// depth map, which the terrain and building shaders read (shadowAt).
// Draw order in the main pass (reversed depth, 'greater'): sky (no depth),
// outer terrain, inner terrain (with its skirt), buildings, then the ocean
// and wind streaks (depth test, no depth write, additive).
//
// grep: function createRenderer  function lightFor  upload(  show(  frame(
//       function sunMatrix  const LIGHTS

import { viewProj, lookAt, mul } from './camera.js';
import { createTracers } from './tracers.js';
import { createWind } from './wind.js';

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
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no WebGPU adapter');
  const device = await adapter.requestDevice();
  let lost = false;
  // 'destroyed' is the shell's release on a page swap (lib/gpu-guard.js), not a fault
  device.lost.then((i) => { lost = true; if (i?.reason !== 'destroyed') console.warn('city-atlas: device lost', i?.message); });
  const ctx = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });
  const sampleCount = opts.mobile ? 1 : 4;
  const depthFormat = 'depth32float';

  const base = new URL('./shaders/', import.meta.url);
  const src = async (n) => {
    const r = await fetch(new URL(n, base));
    if (!r.ok) throw new Error(`${n}: ${r.status}`);
    return r.text();
  };
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
  const [ocean, windT] = await Promise.all([
    createTracers(device, tctx, { mode: 0, max: mobile ? 5000 : 12000, K: 26, label: 'ocean' }),
    createTracers(device, tctx, { mode: 1, max: mobile ? 7000 : 18000, K: 22, label: 'wind' }),
  ]);
  const wind = await createWind(device, { lbm: lbmS }, { fineN: mobile ? 384 : 640, coarseN: 256, fineSteps: mobile ? 4 : 6, coarseSteps: 3 });

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

  // ---------------------------------------------------------------- city upload
  function tex(size, format, data, bpp, label) {
    const t = device.createTexture({ size, format, usage: T.TEXTURE_BINDING | T.COPY_DST, label });
    const [w, h, l = 1] = size;
    device.queue.writeTexture({ texture: t }, data, { bytesPerRow: w * bpp, rowsPerImage: h }, [w, h, l]);
    return t;
  }
  // heights: ground and surface int16 dm, water fraction at 2x resolution u8
  function heightTex(ground, surf, wf, n, wn, label) {
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
    s.hIn = keep(heightTex(A.t_in.data, A.s_in.data, A.wf_in.data, nIn, wnIn, 'hIn'));
    s.hOut = keep(heightTex(A.t_out.data, A.s_out.data, A.wf_out.data, nOut, wnOut, 'hOut'));
    s.wIn = keep(tex([wnIn, wnIn], 'r8unorm', A.wf_in.data, 1, 'wIn'));
    s.wOut = keep(tex([wnOut, wnOut], 'r8unorm', A.wf_out.data, 1, 'wOut'));
    s.cIn = keep(tex([A.lc_in.shape[0], A.lc_in.shape[0]], 'r8uint', A.lc_in.data, 1, 'cIn'));
    s.cOut = keep(tex([A.lc_out.shape[0], A.lc_out.shape[0]], 'r8uint', A.lc_out.data, 1, 'cOut'));
    s.rough = keep(tex([A.rough.shape[0], A.rough.shape[1]], 'rg8unorm', A.rough.data, 2, 'rough'));
    s.bTex = keep(tex([c.bN, c.bN], 'r32float', c.bRaster, 4, 'bRaster'));
    const sea = (a, label) => {
      if (!a) return null;
      const [Tn, n] = a.shape;
      return keep(tex([n, n, Tn], 'rg8snorm', a.data, 2, label));
    };
    s.seaIn = sea(A.cur_in, 'seaIn');
    s.seaOut = sea(A.cur_out, 'seaOut');
    s.nIn = nIn; s.nOut = nOut;
    s.gHalfIn = m.grid.inner.half; s.gHalfOut = m.grid.outer.half;
    // buildings
    s.bCount = c.mesh.indices.length;
    if (s.bCount) {
      s.vb = device.createBuffer({ size: c.mesh.vertices.byteLength, usage: U.VERTEX | U.COPY_DST, label: 'bVerts' });
      device.queue.writeBuffer(s.vb, 0, c.mesh.vertices);
      s.ib = device.createBuffer({ size: Math.ceil(c.mesh.indices.byteLength / 4) * 4, usage: U.INDEX | U.COPY_DST, label: 'bIdx' });
      device.queue.writeBuffer(s.ib, 0, c.mesh.indices.buffer, c.mesh.indices.byteOffset, c.mesh.indices.byteLength);
      s.buffers.push(s.vb, s.ib);
    }
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
    s.gOv = device.createBindGroup({ layout: layouts.overlay, entries: [
      { binding: 0, resource: { buffer: ovBuf } },
      { binding: 1, resource: wind.coarseTex.createView() }, { binding: 2, resource: wind.fineTex.createView() },
      { binding: 3, resource: (s.seaIn || emptyArr).createView({ dimension: '2d-array' }) },
      { binding: 4, resource: (s.seaOut || emptyArr).createView({ dimension: '2d-array' }) },
    ] });
    s.gMeshOut = device.createBindGroup({ layout: layouts.mesh, entries: [{ binding: 0, resource: { buffer: s.meshOut } }] });
    s.gMeshIn = device.createBindGroup({ layout: layouts.mesh, entries: [{ binding: 0, resource: { buffer: s.meshIn } }] });
    s.layers = A.cur_out ? A.cur_out.shape[0] : (A.cur_in ? A.cur_in.shape[0] : 1);
    return s;
  }

  function drop(s) {
    if (!s || s.dropped) return;
    s.dropped = true;
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
  const info = { tris: 0, gpuMs: 0 };
  let frameNo = 0, gpuBusy = false;

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

  function show(s) {
    cur = s;
    wind.setCity({
      hIn: s.hIn, hOut: s.hOut, rough: s.rough, bTex: s.bTex,
      gHalfIn: s.gHalfIn, gHalfOut: s.gHalfOut, bHalf: s.meta.bHalf, fHalf: s.meta.fHalf,
      block: (s.meta.groundRef ?? 0) + 160,
    });
    ocean.reseed();
    windT.reseed();
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
    const d = wind.dir;
    ovRaw.set([wd.on, wd.heat, d[0], d[1]], 8);
    ovRaw.set([wind.fHalf, wind.cHalf, wind.scale, wd.slice], 12);
    ovRaw.set([wd.colourTop || Math.max(wd.speed * 2.2, 2.5), wind.fineN, wind.coarseN, 0], 16);
    device.queue.writeBuffer(ovBuf, 0, ovRaw);

    const enc = device.createCommandEncoder();
    if (wd.on > 0) wind.step(enc, st.windMult ?? 1);
    const dt = Math.min(st.dt, 0.05);
    if (oc.on > 0 && (s.seaIn || s.seaOut)) {
      ocean.update(enc, s.gScene, s.gOv, {
        count: st.oceanCount ?? (mobile ? 4000 : 10000), nInner: Math.round((st.oceanCount ?? (mobile ? 4000 : 10000)) * 0.7),
        dt, speedup: (st.oceanVis ?? 300) / Math.max(m.curTop || 0.5, 0.05), lift: 2.0, lineW: mobile ? 1.1 : 1.0, alpha: 0.9,
        innerR: s.gHalfIn * 0.98, outerR: s.gHalfOut * 0.9, colourTop: m.curTop || 0.5, lifeS: 4.5,
      });
    }
    if (wd.on > 0) {
      const cnt = st.windCount ?? (mobile ? 6000 : 16000);
      windT.update(enc, s.gScene, s.gOv, {
        count: cnt, nInner: Math.round(cnt * 0.72), dt,
        speedup: (st.windVis ?? 300) / Math.max(wd.speed, 0.5), lift: wd.slice, lineW: mobile ? 1.1 : 1.0, alpha: st.windAlpha ?? 0.7,
        innerR: m.fHalf * 0.96, outerR: s.gHalfIn * 0.97,
        colourTop: wd.colourTop || Math.max(wd.speed * 2.2, 2.5), lifeS: 3.5,
      });
    }

    if (s.bCount && lt.night < 0.6) {
      const sp = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: shadowView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
      sp.setPipeline(pShadow);
      sp.setBindGroup(0, gFrameOnly);
      sp.setVertexBuffer(0, s.vb);
      sp.setIndexBuffer(s.ib, 'uint32');
      sp.drawIndexed(s.bCount);
      sp.end();
    }
    const view = ctx.getCurrentTexture().createView();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: colorT ? colorT.createView() : view, resolveTarget: colorT ? view : undefined,
        loadOp: 'clear', storeOp: colorT ? 'discard' : 'store', clearValue: [0, 0, 0, 1],
      }],
      depthStencilAttachment: { view: depthT.createView(), depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' },
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
    if (s.bCount) {
      pass.setPipeline(pBuild);
      pass.setVertexBuffer(0, s.vb);
      pass.setIndexBuffer(s.ib, 'uint32');
      pass.drawIndexed(s.bCount);
    }
    if (oc.on > 0 && (s.seaIn || s.seaOut)) ocean.draw(pass, s.gScene, s.gOv);
    if (wd.on > 0) windT.draw(pass, s.gScene, s.gOv);
    pass.end();
    device.queue.submit([enc.finish()]);
    info.tris = (io.count + ii.count + s.bCount) / 3;
    // submit-to-done time of every 10th frame: about the GPU cost of a frame
    if ((++frameNo % 10) === 0 && !gpuBusy) {
      gpuBusy = true;
      const t0 = performance.now();
      device.queue.onSubmittedWorkDone().then(() => { info.gpuMs = performance.now() - t0; gpuBusy = false; });
    }
  }

  return {
    device, info, wind, upload, drop, resize,
    show,
    get current() { return cur; },
    frame,
    get lost() { return lost; },
    destroy() {
      try { wind.destroy(); ocean.destroy(); windT.destroy(); } catch { /* */ }
      device.destroy();
    },
  };
}
