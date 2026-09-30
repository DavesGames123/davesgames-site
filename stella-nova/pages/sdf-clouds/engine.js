// engine.js — WebGPU core of the SDF Clouds page. No DOM.
//
// createEngine(device, format, shaders) builds every pipeline once and
// returns frame(). frame() packs the uniform, encodes the bake stages that
// the state change needs, then draws each view with its own viewport.
//
//   bake stage   program           writes          reads
//   shape        shape.wgsl main   field  r32f     -
//   jfa init     jfa.wgsl init     seedA  rgba32f  field
//   jfa jump     jfa.wgsl jump     seedA/B         seedB/A   (log2 N + 1 passes)
//   jfa resolve  jfa.wgsl resolve  sdf    rgba16f  field, seeds
//   noise        worley.wgsl       ero    rgba16f  -        (64^3, tiling)
//   light        light.wgsl        light  rgba16f  sdf, ero
//   view         march.wgsl vs/fs  canvas          sdf, ero, light, seeds
//
// sdf, ero and light are rgba16float so they filter without the
// float32-filterable feature. Seeds stay rgba32float and use textureLoad.
//
// GPU timing: when the device has timestamp-query, the bake pass and the view
// pass write timestamps. frame() copies them into a free readback buffer, and
// afterSubmit() maps that buffer after the caller submits. The map never
// blocks a frame. If no readback buffer is free, the frame is not timed.
// gpu() returns the latest times in ms, or null without the feature.
//
// grep: function createEngine  function alloc  function encodeBake  frame(
//       function makeTimer  afterSubmit(  gpu()

import { PARAM_VEC4, ERO_RES, pack, dims, bakeNeeded } from './params.js';

const ST = { C: 4, F: 2 };   // GPUShaderStage.COMPUTE / FRAGMENT, without the global

function bgl(device, entries) {
  return device.createBindGroupLayout({
    entries: entries.map(([binding, visibility, kind, format]) => {
      const e = { binding, visibility };
      if (kind === 'u') e.buffer = { type: 'uniform' };
      else if (kind === 's') e.sampler = { type: 'filtering' };
      else if (kind === 'tf') e.texture = { sampleType: 'float', viewDimension: '3d' };
      else if (kind === 'tu') e.texture = { sampleType: 'unfilterable-float', viewDimension: '3d' };
      else if (kind === 'st') e.storageTexture = { access: 'write-only', format, viewDimension: '3d' };
      return e;
    }),
  });
}

// Timestamp slots: 0, 1 bake pass begin and end; 2, 3 view pass begin and end.
function makeTimer(device) {
  if (!device.features.has('timestamp-query')) return null;
  const U = GPUBufferUsage;
  const qs = device.createQuerySet({ type: 'timestamp', count: 4 });
  const resolve = device.createBuffer({ size: 32, usage: U.QUERY_RESOLVE | U.COPY_SRC });
  const free = [...Array(3)].map(() => device.createBuffer({ size: 32, usage: U.MAP_READ | U.COPY_DST }));
  const last = { view: 0, bake: 0, bakeAt: 0 };
  let cur = null;       // readback buffer of the frame in encode
  let pending = null;   // readback buffer of the frame the caller submits next
  return {
    last,
    begin(baked) { cur = free.length ? { buf: free.pop(), baked } : null; },
    writes(pass) {
      if (!cur) return undefined;
      const i = pass === 'bake' ? 0 : 2;
      return { querySet: qs, beginningOfPassWriteIndex: i, endOfPassWriteIndex: i + 1 };
    },
    end(enc) {
      if (!cur) return;
      enc.resolveQuerySet(qs, 0, 4, resolve, 0);
      enc.copyBufferToBuffer(resolve, 0, cur.buf, 0, 32);
      pending = cur;
      cur = null;
    },
    afterSubmit() {
      const p = pending;
      pending = null;
      if (!p) return;
      p.buf.mapAsync(GPUMapMode.READ).then(() => {
        const q = new BigUint64Array(p.buf.getMappedRange());
        const ms = (a, b) => (q[b] > q[a] ? Number(q[b] - q[a]) / 1e6 : 0);
        last.view = ms(2, 3);
        if (p.baked) { last.bake = ms(0, 1); last.bakeAt = performance.now(); }
        p.buf.unmap();
        free.push(p.buf);
      }, () => {});
    },
  };
}

export async function createEngine(device, format, SH) {
  const src = (...names) => names.map((n) => SH[n]).join('\n');
  const mod = (code, label) => device.createShaderModule({ code, label });

  const mShape = mod(src('common', 'shape'), 'shape');
  const mJfa = mod(src('common', 'jfa'), 'jfa');
  const mWorley = mod(src('common', 'worley'), 'worley');
  const mLight = mod(src('common', 'cloud', 'light'), 'light');
  const mMarch = mod(src('common', 'cloud', 'march'), 'march');

  const C = ST.C, F = ST.F;
  const L = {
    shape: bgl(device, [[0, C, 'u'], [1, C, 'st', 'r32float']]),
    init: bgl(device, [[0, C, 'u'], [1, C, 'tu'], [3, C, 'st', 'rgba32float']]),
    jump: bgl(device, [[0, C, 'u'], [2, C, 'tu'], [3, C, 'st', 'rgba32float'], [4, C, 'u']]),
    resolve: bgl(device, [[0, C, 'u'], [1, C, 'tu'], [2, C, 'tu'], [5, C, 'st', 'rgba16float']]),
    worley: bgl(device, [[0, C, 'u'], [1, C, 'st', 'rgba16float']]),
    light: bgl(device, [[0, C, 'u'], [1, C, 's'], [2, C, 'tf'], [3, C, 'tf'], [6, C, 's'], [7, C, 'st', 'rgba16float']]),
    march: bgl(device, [[0, F, 'u'], [1, F, 's'], [2, F, 'tf'], [3, F, 'tf'], [4, F, 'tf'], [5, F, 'tu'], [6, F, 's']]),
    view: bgl(device, [[0, F, 'u']]),
  };
  const comp = (layouts, module, entryPoint) =>
    device.createComputePipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: layouts }),
      compute: { module, entryPoint },
    });

  const [pShape, pInit, pJump, pResolve, pWorley, pLight, pMarch] = await Promise.all([
    comp([L.shape], mShape, 'main'),
    comp([L.init], mJfa, 'init'),
    comp([L.jump], mJfa, 'jump'),
    comp([L.resolve], mJfa, 'resolve'),
    comp([L.worley], mWorley, 'main'),
    comp([L.light], mLight, 'main'),
    device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [L.march, L.view] }),
      vertex: { module: mMarch, entryPoint: 'vs' },
      fragment: { module: mMarch, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  ]);

  const U = GPUBufferUsage;
  const T = GPUTextureUsage;
  const params = new Float32Array(PARAM_VEC4 * 4);
  const paramBuf = device.createBuffer({ size: params.byteLength, usage: U.UNIFORM | U.COPY_DST });
  const MAX_VIEWS = 4;
  const viewBuf = device.createBuffer({ size: 256 * MAX_VIEWS, usage: U.UNIFORM | U.COPY_DST });
  const viewBGs = [...Array(MAX_VIEWS)].map((_, i) => device.createBindGroup({
    layout: L.view, entries: [{ binding: 0, resource: { buffer: viewBuf, offset: i * 256, size: 32 } }],
  }));
  const jumpBuf = device.createBuffer({ size: 256 * 16, usage: U.UNIFORM | U.COPY_DST });
  const sampClamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear',
    addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
  const sampRep = device.createSampler({ magFilter: 'linear', minFilter: 'linear',
    addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat' });

  const tex3 = (size, fmt) => device.createTexture({
    size, dimension: '3d', format: fmt, usage: T.STORAGE_BINDING | T.TEXTURE_BINDING,
  });
  const ero = tex3([ERO_RES, ERO_RES, ERO_RES], 'rgba16float');
  const bgWorley = device.createBindGroup({ layout: L.worley, entries: [
    { binding: 0, resource: { buffer: paramBuf } }, { binding: 1, resource: ero.createView() }] });

  // Size-dependent resources. alloc() rebuilds them on a res or light-res change.
  const R = { key: '', litKey: '' };
  function alloc(d) {
    const key = d.vol.join('x');
    if (key !== R.key) {
      for (const t of [R.field, R.seedA, R.seedB, R.sdf]) t?.destroy();
      R.field = tex3(d.vol, 'r32float');
      R.seedA = tex3(d.vol, 'rgba32float');
      R.seedB = tex3(d.vol, 'rgba32float');
      R.sdf = tex3(d.vol, 'rgba16float');
      const n = Math.max(...d.vol);
      R.jumps = [];
      for (let k = 1 << Math.ceil(Math.log2(n) - 1); k >= 1; k >>= 1) R.jumps.push(k);
      R.jumps.push(1);
      R.jumps.forEach((k, i) => device.queue.writeBuffer(jumpBuf, i * 256, new Float32Array([k, 0, 0, 0])));
      const pb = { binding: 0, resource: { buffer: paramBuf } };
      const v = (t) => t.createView();
      R.bgShape = device.createBindGroup({ layout: L.shape, entries: [pb, { binding: 1, resource: v(R.field) }] });
      R.bgInit = device.createBindGroup({ layout: L.init, entries: [pb,
        { binding: 1, resource: v(R.field) }, { binding: 3, resource: v(R.seedA) }] });
      // Pass i reads A and writes B when i is even, and the reverse when odd.
      R.bgJump = R.jumps.map((_, i) => device.createBindGroup({ layout: L.jump, entries: [pb,
        { binding: 2, resource: v(i % 2 ? R.seedB : R.seedA) },
        { binding: 3, resource: v(i % 2 ? R.seedA : R.seedB) },
        { binding: 4, resource: { buffer: jumpBuf, offset: i * 256, size: 16 } }] }));
      R.seedLast = R.jumps.length % 2 ? R.seedB : R.seedA;
      R.bgResolve = device.createBindGroup({ layout: L.resolve, entries: [pb,
        { binding: 1, resource: v(R.field) }, { binding: 2, resource: v(R.seedLast) },
        { binding: 5, resource: v(R.sdf) }] });
      R.key = key;
      R.litKey = '';
    }
    const litKey = d.lit.join('x');
    if (litKey !== R.litKey) {
      R.light?.destroy();
      R.light = tex3(d.lit, 'rgba16float');
      const pb = { binding: 0, resource: { buffer: paramBuf } };
      R.bgLight = device.createBindGroup({ layout: L.light, entries: [pb,
        { binding: 1, resource: sampClamp }, { binding: 2, resource: R.sdf.createView() },
        { binding: 3, resource: ero.createView() }, { binding: 6, resource: sampRep },
        { binding: 7, resource: R.light.createView() }] });
      R.bgMarch = device.createBindGroup({ layout: L.march, entries: [pb,
        { binding: 1, resource: sampClamp }, { binding: 2, resource: R.sdf.createView() },
        { binding: 3, resource: ero.createView() }, { binding: 4, resource: R.light.createView() },
        { binding: 5, resource: R.seedLast.createView() }, { binding: 6, resource: sampRep }] });
      R.litKey = litKey;
    }
  }

  const wg = (n) => Math.ceil(n / 4);
  function encodeBake(enc, d, stages) {
    const cp = enc.beginComputePass({ label: 'bake', timestampWrites: timer?.writes('bake') });
    const disp = (pipe, bg, size) => {
      cp.setPipeline(pipe); cp.setBindGroup(0, bg);
      cp.dispatchWorkgroups(wg(size[0]), wg(size[1]), wg(size[2]));
    };
    if (stages.has('noise')) disp(pWorley, bgWorley, [ERO_RES, ERO_RES, ERO_RES]);
    if (stages.has('shape')) {
      disp(pShape, R.bgShape, d.vol);
      disp(pInit, R.bgInit, d.vol);
      R.bgJump.forEach((bg) => disp(pJump, bg, d.vol));
      disp(pResolve, R.bgResolve, d.vol);
    }
    if (stages.has('light')) disp(pLight, R.bgLight, d.lit);
    cp.end();
  }

  let baked = null;
  const viewData = new Float32Array(8);
  const timer = makeTimer(device);

  return {
    // views: [{ x, y, w, h, pass }] in target pixels.
    frame(enc, target, views, { state, cam, time, frame }) {
      const d = dims(state);
      const need = bakeNeeded(baked, state);
      const stages = new Set();
      if (need.has('res')) { stages.add('noise'); stages.add('shape'); stages.add('light'); }
      if (need.has('shape')) { stages.add('shape'); stages.add('light'); }
      if (need.has('noise')) { stages.add('noise'); stages.add('light'); }
      if (need.has('lres') || need.has('light')) stages.add('light');
      if (state.lightErosion && state.erosion && (state.wind > 0 || state.boil > 0) && state.timeScale > 0) stages.add('light');
      alloc(d);
      device.queue.writeBuffer(paramBuf, 0, pack(params, state, cam, time, frame));
      timer?.begin(stages.size > 0);
      if (stages.size) encodeBake(enc, d, stages);
      baked = { ...state };

      views.forEach((v, i) => {
        viewData.set([v.x, v.y, v.w, v.h, v.pass, 0, 0, 0]);
        device.queue.writeBuffer(viewBuf, i * 256, viewData);
      });
      const rp = enc.beginRenderPass({ colorAttachments: [{
        view: target, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.03, g: 0.04, b: 0.07, a: 1 } }],
        timestampWrites: timer?.writes('view') });
      rp.setPipeline(pMarch);
      rp.setBindGroup(0, R.bgMarch);
      views.forEach((v, i) => {
        rp.setViewport(v.x, v.y, v.w, v.h, 0, 1);
        rp.setScissorRect(v.x, v.y, v.w, v.h);
        rp.setBindGroup(1, viewBGs[i]);
        rp.draw(3);
      });
      rp.end();
      timer?.end(enc);
      return { stages: [...stages], dims: d };
    },
    // Call after the queue submit of the frame() encoder.
    afterSubmit() { timer?.afterSubmit(); },
    // { view, bake, bakeAt } in ms, bakeAt a performance.now() stamp; null without timestamp-query.
    gpu() { return timer ? timer.last : null; },
    invalidate() { baked = null; },
  };
}
