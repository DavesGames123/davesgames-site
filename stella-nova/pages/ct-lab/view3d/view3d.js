// view3d/view3d.js - createView3D: a WebGPU scene of a cone-beam CT scan.
// The CT engine does the physics (phantom3D, forwardProjectCone, fdkFilter, GPU FDK
// back-projection). This file owns the GPU scene, the scan and reconstruction state,
// the orbit camera and the pointer input. API: README.md.
//
// grep handles:
//   createView3D, MODES, setPhantom3D, setVolume, scanStep, reconstructStep, setMode,
//   setCamera, setSlices, setWindow, setIso, setShow, setGantryAngle, setColormap,
//   render, resize, destroy, writeFrame, uploadVolume, updateDetector, bindInput

import * as CT from '../engine/index.js';
import * as CM from '../colormaps/maps.js';
import {
  VERT_FLOATS, LINE_FLOATS, cameraMatrices, unproject, projectPoint, pickSlice,
  toHalf, volumeStats, smooth3, TF_PRESETS, buildLut, gantryLayout, buildMeshes, buildGlass,
  staticLines, coneLines, sampleRays,
} from './scene.js';
import { FRAME_BYTES, BG_WGSL, MESH_WGSL, LINE_WGSL, VOLUME_WGSL } from './wgsl.js';

export const MODES = ['mip', 'dvr', 'iso', 'slices'];
const MODE_ID = { mip: 0, dvr: 1, iso: 2, slices: 3 };
const RAYS = 13;

export function createView3D(canvas, device, opts = {}) {
  if (!device) throw new Error('createView3D: WebGPU device required (see README, drawSlices2D)');
  const GBU = globalThis.GPUBufferUsage, GTU = globalThis.GPUTextureUsage;
  const format = opts.format ?? globalThis.navigator?.gpu?.getPreferredCanvasFormat?.() ?? 'bgra8unorm';
  let ctx = null;
  if (canvas && canvas.getContext) {
    ctx = canvas.getContext('webgpu');
    ctx.configure({ device, format, alphaMode: 'opaque' });
  }
  const dprCap = opts.dprCap ?? 2;
  let W = opts.width ?? 16, H = opts.height ?? 16;

  const st = {
    phantom: null, n: opts.n ?? 96, nAngles: opts.nAngles ?? 180, mode: opts.mode ?? 'dvr',
    volume: null, recon: null, reconSum: null, geom: null, L: null, preset: TF_PRESETS.head,
    proj: null, q: null, scanned: 0, reconstructed: 0, angle: 0, time: 0,
    window: [0, 1], iso: [0.2, 0.6], slices: { x: 0.5, y: 0.5, z: 0.5 }, cmap: opts.colormap ?? 'bone', cmapOpts: opts.colormapOpts ?? {}, tfFromMap: !!opts.tfFromMap,
    show: { gantry: true, rays: true, table: true, detector: true, volume: 'auto' },
    cam: { yaw: 0.75, pitch: 0.32, dist: 10.5, fov: 0.62, target: [0, 0, 0], offset: [0, 0], autoRotate: opts.autoRotate ?? 0 },
    detScale: 1, lastView: -1, dirtyLines: true, steps: opts.steps ?? 256, ghost: 0.3,
    cutaway: opts.cutaway ?? true,
  };
  const gpuCT = CT.createGpuCT(device);

  // ---------- GPU resources ----------
  const frameBuf = device.createBuffer({ size: FRAME_BYTES, usage: GBU.UNIFORM | GBU.COPY_DST });
  const samp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
  const lutTex = device.createTexture({ size: [256, 2], format: 'rgba8unorm', usage: GTU.TEXTURE_BINDING | GTU.COPY_DST });
  let detTex = null, volTex = null, recTex = null, depthTex = null, offColor = null;
  let meshBuf = null, meshCount = 0, glassBuf = null, glassCount = 0, lineBuf = null, lineCount = 0, lineCap = 0;
  let bgBG = null, meshBG = null, volBG = null, volBGr = null;

  const mod = (code) => device.createShaderModule({ code });
  const bgMod = mod(BG_WGSL), meshMod = mod(MESH_WGSL), lineMod = mod(LINE_WGSL), volMod = mod(VOLUME_WGSL);
  const depthFmt = 'depth24plus';
  const add = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };
  const over = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
  const meshLayout = [{
    arrayStride: VERT_FLOATS * 4, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'float32x4' }, { shaderLocation: 3, offset: 40, format: 'float32x2' },
      { shaderLocation: 4, offset: 48, format: 'float32x2' }],
  }];
  const bgPipe = device.createRenderPipeline({
    layout: 'auto', vertex: { module: bgMod, entryPoint: 'vs' }, fragment: { module: bgMod, entryPoint: 'fs', targets: [{ format }] },
    depthStencil: { format: depthFmt, depthWriteEnabled: false, depthCompare: 'always' },
  });
  const meshPipe = device.createRenderPipeline({
    layout: 'auto', vertex: { module: meshMod, entryPoint: 'vs', buffers: meshLayout },
    fragment: { module: meshMod, entryPoint: 'fs', targets: [{ format }] },
    primitive: { cullMode: 'none' }, depthStencil: { format: depthFmt, depthWriteEnabled: true, depthCompare: 'less' },
  });
  const glassPipe = device.createRenderPipeline({
    layout: 'auto', vertex: { module: meshMod, entryPoint: 'vs', buffers: meshLayout },
    fragment: { module: meshMod, entryPoint: 'fsGlass', targets: [{ format, blend: add }] },
    primitive: { cullMode: 'none' }, depthStencil: { format: depthFmt, depthWriteEnabled: false, depthCompare: 'less' },
  });
  const linePipe = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: lineMod, entryPoint: 'vs', buffers: [{
        arrayStride: LINE_FLOATS * 4, stepMode: 'instance', attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
          { shaderLocation: 2, offset: 24, format: 'float32x4' }, { shaderLocation: 3, offset: 40, format: 'float32x2' }],
      }],
    },
    fragment: { module: lineMod, entryPoint: 'fs', targets: [{ format, blend: add }] },
    depthStencil: { format: depthFmt, depthWriteEnabled: false, depthCompare: 'less' },
  });
  const volPipe = device.createRenderPipeline({
    layout: 'auto', vertex: { module: volMod, entryPoint: 'vs' },
    fragment: { module: volMod, entryPoint: 'fs', targets: [{ format, blend: over }] },
  });
  bgBG = device.createBindGroup({ layout: bgPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: frameBuf } }] });
  const lineBG = device.createBindGroup({ layout: linePipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: frameBuf } }] });

  function makeMeshBG() {
    // The glass entry point reads only the frame, so its auto layout has one binding.
    meshBG = [
      device.createBindGroup({
        layout: meshPipe.getBindGroupLayout(0), entries: [
          { binding: 0, resource: { buffer: frameBuf } }, { binding: 1, resource: detTex.createView() }, { binding: 2, resource: samp }],
      }),
      device.createBindGroup({ layout: glassPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: frameBuf } }] }),
    ];
  }
  function makeVolBG() {
    if (!depthTex || !volTex) return;
    const mk = (t) => device.createBindGroup({
      layout: volPipe.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: frameBuf } }, { binding: 1, resource: t.createView({ dimension: '3d' }) },
        { binding: 2, resource: samp }, { binding: 3, resource: lutTex.createView() }, { binding: 4, resource: depthTex.createView() }],
    });
    volBG = mk(volTex); volBGr = recTex ? mk(recTex) : null;
  }

  function uploadLut() {
    device.queue.writeTexture({ texture: lutTex }, buildLut(st.preset, CM.rgba(st.cmap, st.cmapOpts), { tfFromMap: st.tfFromMap }), { bytesPerRow: 1024, rowsPerImage: 2 }, [256, 2]);
  }

  function make3D(vol) {
    return device.createTexture({ size: [vol.nx, vol.ny, vol.nz], dimension: '3d', format: 'r16float', usage: GTU.TEXTURE_BINDING | GTU.COPY_DST });
  }
  function uploadVolume(tex, vol, scale = 1) {
    device.queue.writeTexture({ texture: tex }, toHalf(vol.data, undefined, scale), { bytesPerRow: vol.nx * 2, rowsPerImage: vol.ny }, [vol.nx, vol.ny, vol.nz]);
  }

  function rebuildMeshes() {
    meshBuf?.destroy(); glassBuf?.destroy();
    const m = buildMeshes(st.L, st.show), g = buildGlass(st.L);
    meshBuf = device.createBuffer({ size: Math.max(64, m.byteLength), usage: GBU.VERTEX | GBU.COPY_DST });
    if (m.length) device.queue.writeBuffer(meshBuf, 0, m); meshCount = m.length / VERT_FLOATS;
    glassBuf = device.createBuffer({ size: Math.max(64, g.byteLength), usage: GBU.VERTEX | GBU.COPY_DST });
    device.queue.writeBuffer(glassBuf, 0, g); glassCount = g.length / VERT_FLOATS;
    st.dirtyLines = true;
  }

  function rebuildLines() {
    const L = st.L, arr = staticLines(L, st.show);
    if (st.show.gantry !== false) arr.push(...coneLines(L));
    if (st.show.rays !== false) {
      const a = st.lastView, P = st.proj, nu = st.geom.nu, nv = st.geom.nv;
      arr.push(...sampleRays(L, RAYS, (i, f) => {
        if (a < 0 || !P) return 1;
        const iu = Math.round(((f * 0.94 + 1) / 2) * (nu - 1)), iv = (nv - 1) >> 1;
        return Math.exp(-2.2 * P.data[(a * nv + iv) * nu + iu] * st.detScale);
      }));
    }
    const data = new Float32Array(arr);
    if (data.byteLength > lineCap) {
      lineBuf?.destroy(); lineCap = Math.max(4096, data.byteLength * 2);
      lineBuf = device.createBuffer({ size: lineCap, usage: GBU.VERTEX | GBU.COPY_DST });
    }
    if (data.length) device.queue.writeBuffer(lineBuf, 0, data); lineCount = data.length / LINE_FLOATS;
    st.dirtyLines = false;
  }

  // Detector image for view a: radiograph style 1 - exp(-k p), xray-blue colour map.
  const detLut = CM.variant('xray-blue');
  function updateDetector(a) {
    const g = st.geom, nu = g.nu, nv = g.nv, px = new Uint8Array(nu * nv * 4);
    if (a >= 0) {
      const base = a * nu * nv, d = st.proj.data;
      for (let r = 0; r < nv; r++) {
        const iv = nv - 1 - r;
        for (let iu = 0; iu < nu; iu++) {
          const t = Math.pow(Math.max(0, d[base + iv * nu + iu] * st.detScale), 0.7);
          const k = Math.max(0, Math.min(255, Math.round(t * 255))), o = (r * nu + iu) * 4;
          px[o] = detLut[k * 3]; px[o + 1] = detLut[k * 3 + 1]; px[o + 2] = detLut[k * 3 + 2]; px[o + 3] = 255;
        }
      }
    } else {
      for (let i = 0; i < nu * nv; i++) { px[i * 4] = 6; px[i * 4 + 1] = 9; px[i * 4 + 2] = 16; px[i * 4 + 3] = 255; }
    }
    device.queue.writeTexture({ texture: detTex }, px, { bytesPerRow: nu * 4, rowsPerImage: nv }, [nu, nv]);
  }

  function ensureTargets() {
    if (canvas && canvas.getContext) {
      const dpr = Math.min(opts.dpr ?? globalThis.devicePixelRatio ?? 1, dprCap);
      const cw = Math.max(1, Math.round((canvas.clientWidth || canvas.width) * dpr));
      const ch = Math.max(1, Math.round((canvas.clientHeight || canvas.height) * dpr));
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      W = cw; H = ch;
    }
    if (!depthTex || depthTex.width !== W || depthTex.height !== H) {
      depthTex?.destroy();
      depthTex = device.createTexture({ size: [W, H], format: depthFmt, usage: GTU.RENDER_ATTACHMENT | GTU.TEXTURE_BINDING });
      makeVolBG();
    }
  }

  // ---------- state changes ----------

  function setGeometryFor(vol, nAngles) {
    st.geom = CT.fitGeometry('cone', vol, { nAngles });
    st.L = gantryLayout(st.geom, vol.width, vol.nz / vol.nx);
    st.proj = CT.emptyCone(st.geom);
    st.q = null; st.scanned = 0; st.reconstructed = 0; st.lastView = -1; st.angle = 0;
    detTex?.destroy();
    detTex = device.createTexture({ size: [st.geom.nu, st.geom.nv], format: 'rgba8unorm', usage: GTU.TEXTURE_BINDING | GTU.COPY_DST });
    makeMeshBG(); updateDetector(-1); rebuildMeshes();
  }

  function setVolume(vol, o = {}) {
    const as = o.as ?? 'phantom';
    if (as === 'recon') {
      if (!st.volume || vol.nx !== st.volume.nx || vol.ny !== st.volume.ny || vol.nz !== st.volume.nz) throw new Error('setVolume: recon must match the phantom size');
      if (!recTex) recTex = make3D(vol);
      st.recon = vol; uploadVolume(recTex, vol); st.reconstructed = Math.max(st.reconstructed, 1);
      if (o.window) st.window = o.window.slice();
      makeVolBG(); return;
    }
    volTex?.destroy(); recTex?.destroy(); recTex = null; st.recon = null; st.reconSum = null;
    st.volume = vol; volTex = make3D(vol);
    uploadVolume(volTex, o.smooth === false ? vol : smooth3(vol)); // display copy only; the scan uses vol
    if (o.window) st.window = o.window.slice();
    else { const s = volumeStats(vol.data); st.window = [Math.min(0, s.min), s.max * 1.02 || 1]; }
    setGeometryFor(vol, o.nAngles ?? st.nAngles);
    makeVolBG();
  }

  function setPhantom3D(name, o = {}) {
    const n = o.n ?? st.n;
    const ph = CT.phantom3D(name, n, { supersample: o.supersample ?? 2 });
    st.phantom = name; st.n = n;
    st.preset = TF_PRESETS[name] ?? TF_PRESETS.head;
    st.iso = [st.preset.skin, st.preset.iso];
    uploadLut();
    setVolume(ph.volume, { window: st.preset.window, nAngles: o.nAngles });
    st.shapes = ph.shapes;
    return { volume: ph.volume, geom: st.geom };
  }

  function gantryToView(a) { st.angle = st.geom.angles[a]; }

  function scanStep(o = {}) {
    const g = st.geom, total = g.nAngles;
    if (!g || st.scanned >= total) return { done: st.scanned, total, angle: st.angle };
    const t0 = performance.now(), budget = o.budgetMs ?? 0;
    let k = 0;
    const want = o.views ?? 1;
    while (st.scanned < total && (k < want || (budget > 0 && performance.now() - t0 < budget))) {
      const a = st.scanned;
      CT.forwardProjectCone(st.volume, g, { out: st.proj, a0: a, a1: a + 1 });
      if (a === 0) {
        let mx = 0; const d = st.proj.data, n = g.nu * g.nv;
        for (let i = 0; i < n; i++) if (d[i] > mx) mx = d[i];
        st.detScale = mx > 0 ? 1 / mx : 1;
      }
      st.scanned++; k++;
      if (budget > 0 && k >= want && performance.now() - t0 >= budget) break;
    }
    st.lastView = st.scanned - 1;
    gantryToView(st.lastView); updateDetector(st.lastView); st.dirtyLines = true;
    return { done: st.scanned, total, angle: st.angle };
  }

  // FDK on the next chunk of scanned views. The partial sum is shown scaled by total/done.
  async function reconstructStep(o = {}) {
    const g = st.geom, total = g.nAngles;
    const a0 = st.reconstructed, a1 = Math.min(st.scanned, a0 + (o.views ?? 8));
    if (a1 <= a0) return { done: st.reconstructed, total, rmse: st.rmse ?? NaN };
    const vol = st.volume, nv = g.nv, nu = g.nu, per = nu * nv;
    if (!st.reconSum) { st.reconSum = new Float32Array(vol.data.length); st.weights = CT.angleWeights(g); }
    const k = a1 - a0;
    const sub = { ...g, angles: g.angles.slice(a0, a1), nAngles: k };
    const chunk = { nAngles: k, nu, nv, data: st.proj.data.slice(a0 * per, a1 * per) };
    const q = CT.fdkFilter(chunk, sub, { filter: o.filter ?? 'shepp-logan' });
    const dims = { nx: vol.nx, ny: vol.ny, nz: vol.nz, width: vol.width };
    const part = await gpuCT.backProjectCone(q, sub, dims, { weights: st.weights.slice(a0, a1) });
    const S = st.reconSum, P = part.data;
    for (let i = 0; i < S.length; i++) S[i] += P[i];
    st.reconstructed = a1;
    if (!recTex) recTex = make3D(vol);
    const scale = total / a1;
    uploadVolume(recTex, { ...dims, data: S }, scale);
    st.recon = { ...dims, data: S, scale };
    makeVolBG();
    // rmse against the phantom (volume units), sampled on a stride for speed
    let e = 0, c = 0;
    for (let i = 0; i < S.length; i += 7) { const d = S[i] * scale - vol.data[i]; e += d * d; c++; }
    st.rmse = Math.sqrt(e / c);
    return { done: a1, total, rmse: st.rmse };
  }

  // ---------- frame ----------

  const frame = new Float32Array(FRAME_BYTES / 4);
  function writeFrame(M) {
    frame.set(M.viewProj, 0); frame.set(M.invViewProj, 16);
    const c = Math.cos(st.angle), s = Math.sin(st.angle);
    frame.set([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 32);
    const h = st.L ? st.L.half : [0.5, 0.5, 0.5];
    frame.set([M.eye[0], M.eye[1], M.eye[2], st.time], 48);
    frame.set([h[0], h[1], h[2], st.steps], 52);
    const useRecon = showRecon();
    frame.set([st.window[0], st.window[1], MODE_ID[st.mode] ?? 1, 1], 56);
    frame.set([st.slices.x, st.slices.y, st.slices.z, st.iso[0]], 60);
    frame.set([W, H, 1 / W, 1 / H], 64);
    frame.set([st.iso[1], useRecon ? 1.15 : 1, st.show.volume === 'none' ? 0 : 1, st.mode === 'slices' ? st.ghost : 0], 68);
    const cut = st.cutaway && (st.mode === 'dvr' || st.mode === 'iso');
    frame.set([0, 0, 0, cut ? 1 : 0], 72);
    frame.set([Math.sign(M.eye[0]) || 1, Math.sign(M.eye[1]) || 1, Math.sign(M.eye[2]) || 1, 0], 76);
    device.queue.writeBuffer(frameBuf, 0, frame);
  }
  function showRecon() {
    const v = st.show.volume;
    return !!recTex && st.reconstructed > 0 && (v === 'recon' || v === 'auto');
  }

  function matrices() {
    return cameraMatrices(st.cam, W / H);
  }

  function render(o = {}) {
    if (!st.volume) return;
    const dt = o.dt ?? 0;
    st.time += dt;
    if (st.cam.autoRotate) st.cam.yaw += st.cam.autoRotate * dt;
    if (o.width && o.height) { W = o.width; H = o.height; }
    ensureTargets();
    if (st.dirtyLines) rebuildLines();
    const M = matrices();
    writeFrame(M);
    let view;
    if (o.target) view = o.target;
    else if (ctx) view = ctx.getCurrentTexture().createView();
    else {
      if (!offColor || offColor.width !== W || offColor.height !== H) {
        offColor?.destroy();
        offColor = device.createTexture({ size: [W, H], format, usage: GTU.RENDER_ATTACHMENT | GTU.COPY_SRC });
      }
      view = offColor.createView();
    }
    const enc = device.createCommandEncoder();
    // pass 1: background and opaque meshes
    let p = enc.beginRenderPass({
      colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: depthTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    p.setPipeline(bgPipe); p.setBindGroup(0, bgBG); p.draw(3);
    if (meshCount) { p.setPipeline(meshPipe); p.setBindGroup(0, meshBG[0]); p.setVertexBuffer(0, meshBuf); p.draw(meshCount); }
    p.end();
    // pass 2: the volume, stopped by the opaque depth
    p = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }] });
    p.setPipeline(volPipe); p.setBindGroup(0, showRecon() && volBGr ? volBGr : volBG); p.draw(3);
    p.end();
    // pass 3: additive glass cone and glow lines
    p = enc.beginRenderPass({
      colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: depthTex.createView(), depthReadOnly: true },
    });
    if (st.show.gantry !== false && st.show.rays !== false && glassCount) {
      p.setPipeline(glassPipe); p.setBindGroup(0, meshBG[1]); p.setVertexBuffer(0, glassBuf); p.draw(glassCount);
    }
    if (lineCount) { p.setPipeline(linePipe); p.setBindGroup(0, lineBG); p.setVertexBuffer(0, lineBuf); p.draw(6, lineCount); }
    p.end();
    device.queue.submit([enc.finish()]);
    return offColor;
  }

  // ---------- input ----------

  const listeners = [];
  function on(el, ev, fn, o2) { el.addEventListener(ev, fn, o2); listeners.push([el, ev, fn, o2]); }
  function bindInput() {
    if (!canvas || !canvas.addEventListener || opts.interactive === false) return;
    const pts = new Map();
    let drag = null, pinch0 = 0;
    const ndcOf = (e) => {
      const r = canvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2, r];
    };
    on(canvas, 'pointerdown', (e) => {
      canvas.setPointerCapture?.(e.pointerId);
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); drag = null; return; }
      const [nx, ny] = ndcOf(e);
      drag = { kind: 'orbit', x: e.clientX, y: e.clientY };
      if (st.mode === 'slices' && st.L) {
        const M = matrices(), r = unproject(M.invViewProj, nx, ny);
        const hit = pickSlice(r.o, r.d, st.L.half, st.slices);
        if (hit) {
          const ax = [0, 0, 0]; ax[hit.axis] = 1;
          const q = [r.o[0] + hit.t * r.d[0], r.o[1] + hit.t * r.d[1], r.o[2] + hit.t * r.d[2]];
          const s0 = projectPoint(M.viewProj, q), s1 = projectPoint(M.viewProj, q.map((v, k) => v + ax[k] * 0.1));
          const rect = canvas.getBoundingClientRect();
          const sx = ((s1[0] - s0[0]) * rect.width) / 2, sy = (-(s1[1] - s0[1]) * rect.height) / 2;
          drag = { kind: 'slice', axis: hit.axis, x: e.clientX, y: e.clientY, sx, sy, start: st.slices[['x', 'y', 'z'][hit.axis]] };
        }
      }
    });
    on(canvas, 'pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch0 > 0) st.cam.dist = Math.min(30, Math.max(1.6, st.cam.dist * (pinch0 / d)));
        pinch0 = d; return;
      }
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (drag.kind === 'orbit') {
        st.cam.yaw -= dx * 0.008; st.cam.pitch = Math.max(-1.45, Math.min(1.45, st.cam.pitch + dy * 0.008));
        drag.x = e.clientX; drag.y = e.clientY;
      } else {
        const l2 = drag.sx * drag.sx + drag.sy * drag.sy;
        if (l2 > 1e-6) {
          const key = ['x', 'y', 'z'][drag.axis];
          // 0.1 world units of axis motion = (sx, sy) pixels; one volume width = 1 fraction (y is flipped).
          let df = ((dx * drag.sx + dy * drag.sy) / l2) * 0.1 / (2 * st.L.half[drag.axis]);
          if (drag.axis === 1) df = -df;
          st.slices[key] = Math.min(1, Math.max(0, drag.start + df));
        }
      }
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch0 = 0; if (!pts.size) drag = null; };
    on(canvas, 'pointerup', up); on(canvas, 'pointercancel', up);
    on(canvas, 'wheel', (e) => { e.preventDefault(); st.cam.dist = Math.min(30, Math.max(1.6, st.cam.dist * Math.exp(e.deltaY * 0.0012))); }, { passive: false });
    if (canvas.style) canvas.style.touchAction = 'none';
  }
  bindInput();

  // ---------- public object ----------

  const api = {
    setPhantom3D, setVolume, scanStep, reconstructStep, render,
    setMode(m) { if (!MODES.includes(m)) throw new Error('setMode: ' + m); st.mode = m; },
    setCamera(c) { for (const k of ['yaw', 'pitch', 'dist', 'fov', 'autoRotate']) if (c[k] !== undefined) st.cam[k] = c[k]; if (c.target) st.cam.target = c.target.slice(); if (c.offset) st.cam.offset = c.offset.slice(); },
    getCamera() { return { ...st.cam, target: st.cam.target.slice(), offset: st.cam.offset.slice() }; },
    setSlices(s) { for (const k of ['x', 'y', 'z']) if (s[k] !== undefined) st.slices[k] = Math.min(1, Math.max(0, s[k])); },
    setWindow(lo, hi) { st.window = [lo, hi]; },
    setIso(skin, bone) { if (skin !== undefined) st.iso[0] = skin; if (bone !== undefined) st.iso[1] = bone; },
    setShow(s) {
      const meshKeys = ['gantry', 'table', 'detector'].some((k) => s[k] !== undefined && s[k] !== st.show[k]);
      Object.assign(st.show, s);
      if (meshKeys && st.L) rebuildMeshes();
      st.dirtyLines = true;
    },
    setGantryAngle(r) { st.angle = r; },
    setCutaway(on) { st.cutaway = !!on; },
    // o: { reverse, gamma, lut (a 768-byte LUT, for example CM.blend), tf (true: dvr colour from the map) }
    setColormap(id, o = {}) {
      st.cmap = CM.has(id) ? id : 'bone';
      st.cmapOpts = { reverse: !!o.reverse, gamma: o.gamma > 0 ? +o.gamma : 1, lut: o.lut };
      if (o.tf !== undefined) st.tfFromMap = !!o.tf;
      uploadLut();
    },
    get colormap() { return { id: st.cmap, reverse: !!st.cmapOpts.reverse, gamma: st.cmapOpts.gamma ?? 1, tf: st.tfFromMap }; },
    setSteps(n) { st.steps = n; },
    resize() { ensureTargets(); },
    get state() {
      return { phantom: st.phantom, n: st.n, mode: st.mode, scanned: st.scanned, reconstructed: st.reconstructed, total: st.geom?.nAngles ?? 0, angle: st.angle, rmse: st.rmse, window: st.window.slice() };
    },
    get geometry() { return st.geom; },
    get volume() { return st.volume; },
    get recon() { return st.recon; },
    get projections() { return st.proj; },
    destroy() {
      for (const [el, ev, fn, o2] of listeners) el.removeEventListener(ev, fn, o2);
      listeners.length = 0;
      for (const t of [detTex, volTex, recTex, depthTex, offColor, lutTex]) t?.destroy();
      for (const b of [frameBuf, meshBuf, glassBuf, lineBuf]) b?.destroy();
      gpuCT.destroy();
      try { ctx?.unconfigure(); } catch { /* already gone */ }
      st.volume = null;
    },
  };
  uploadLut();
  setPhantom3D(opts.phantom ?? 'head', { n: st.n, nAngles: st.nAngles });
  if (opts.camera) api.setCamera(opts.camera);
  return api;
}
