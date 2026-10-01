// engine-gpu.js - the WebGPU engine for the Game of Life page.
//
// The world is two storage buffers of W x H cell words (see life.js). One
// generation is one compute dispatch that reads one buffer and writes the
// other. step(n) records n dispatches in one compute pass, and the two
// buffers swap roles after each one. Only the last dispatch of a batch runs
// step_stats, which also counts population, births and deaths. The counts go
// to a small buffer, and a map buffer reads them back without a stall.
//
// This module has no DOM code apart from the canvas. A canvas of null gives
// an engine with no render, for the parity test.
//
// API (engine-cpu.js has the same one):
//   const e = await createGpuEngine(canvas | null)   throws 'webgpu-unavailable'
//   e.kind                       'gpu'
//   e.setWorld(W, H)             new empty world
//   e.setRule(birth, survive)    masks, see life.js
//   e.setWrap(bool)
//   e.clear()
//   e.write(Uint32Array)         the whole world
//   e.paint(edits)               Uint32Array of (index, word) pairs
//   e.step(n)                    n generations, the last one with stats
//   e.count()                    population of the world as it is now
//   e.stats                      {pop, births, deaths, gen, step} from the last
//                                readback. step false: a count() with no births
//                                or deaths (0)
//   e.onStats = s => {}          runs when a readback arrives
//   e.readCell(x, y)             Promise<word>
//   e.read()                     Promise<Uint32Array>
//   e.render(view)               view {cx, cy, cell, ox, oy, mode, trails, grid}
//                                cell, ox, oy in device px
//   e.resize(pixelW, pixelH)
//   e.lost, e.onLost
//   e.destroy()
import { TRAIL } from './life.js';

const src = name => fetch(new URL(name, import.meta.url)).then(r => { if (!r.ok) throw new Error(name + ' ' + r.status); return r.text(); });

async function compile(device, code, label) {
  const module = device.createShaderModule({ code, label });
  const info = await module.getCompilationInfo();
  const errs = info.messages.filter(m => m.type === 'error');
  if (errs.length) throw new Error(errs.map(m => `${label}:${m.lineNum}:${m.linePos}: ${m.message}`).join('\n'));
  return module;
}

export async function createGpuEngine(canvas, { lowPower = false } = {}) {
  if (typeof navigator === 'undefined' || !navigator.gpu) throw new Error('webgpu-unavailable');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: lowPower ? 'low-power' : 'high-performance' });
  if (!adapter) throw new Error('webgpu-unavailable');
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, 256 * 1024 * 1024),
      maxBufferSize: Math.min(adapter.limits.maxBufferSize, 256 * 1024 * 1024),
    },
  });
  let context = null, format = null;
  if (canvas) {
    context = canvas.getContext('webgpu');
    if (!context) { device.destroy(); throw new Error('webgpu-unavailable'); }
    format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
  }

  const e = { kind: 'gpu', lost: false, stats: { pop: 0, births: 0, deaths: 0, gen: 0 }, onStats: null, onLost: null };
  device.lost.then(info => {
    e.lost = true;
    if (info.reason !== 'destroyed') console.error('[life] GPU device lost:', info.reason, info.message);
    if (typeof e.onLost === 'function' && info.reason !== 'destroyed') e.onLost(info);
  });

  const [lifeCode, paintCode, renderCode] = await Promise.all([src('life.wgsl'), src('paint.wgsl'), src('render.wgsl')]);
  const [lifeMod, paintMod, renderMod] = await Promise.all([
    compile(device, lifeCode, 'life.wgsl'), compile(device, paintCode, 'paint.wgsl'), compile(device, renderCode, 'render.wgsl'),
  ]);

  const C = GPUShaderStage.COMPUTE, F = GPUShaderStage.FRAGMENT;
  const SU = GPUBufferUsage.STORAGE, CD = GPUBufferUsage.COPY_DST, CS = GPUBufferUsage.COPY_SRC, UN = GPUBufferUsage.UNIFORM;
  const lifeBGL = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: C, buffer: { type: 'uniform' } },
    { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: C, buffer: { type: 'storage' } },
    { binding: 3, visibility: C, buffer: { type: 'storage' } },
  ] });
  const lifeLayout = device.createPipelineLayout({ bindGroupLayouts: [lifeBGL] });
  const pipe = entryPoint => device.createComputePipeline({ layout: lifeLayout, compute: { module: lifeMod, entryPoint } });
  const stepPipe = pipe('step'), statsPipe = pipe('step_stats'), countPipe = pipe('count');
  const paintPipe = device.createComputePipeline({ layout: 'auto', compute: { module: paintMod, entryPoint: 'paint' } });
  let renderPipe = null;
  if (context) {
    renderPipe = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: renderMod, entryPoint: 'vs' },
      fragment: { module: renderMod, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
  }

  const ruleBuf = device.createBuffer({ size: 32, usage: UN | CD });
  const viewBuf = device.createBuffer({ size: 64, usage: UN | CD });
  const statsBuf = device.createBuffer({ size: 16, usage: SU | CD | CS });
  const statsRead = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | CD });
  const paintN = device.createBuffer({ size: 16, usage: UN | CD });
  const cellRead = device.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ | CD });
  let editBuf = null, editCap = 0;

  let W = 0, H = 0, wrap = 1, birth = 1 << 3, survive = (1 << 2) | (1 << 3);
  let A = [null, null], lifeBG = [null, null], renderBG = [null, null], paintBG = [null, null];
  let cur = 0;                 // A[cur] holds the current generation
  let gen = 0;                 // dispatches since setWorld, for the stats tag
  let statsBusy = false, cellBusy = Promise.resolve();

  function writeRule() {
    device.queue.writeBuffer(ruleBuf, 0, new Uint32Array([W, H, birth, survive, wrap, TRAIL, 0, 0]));
  }
  function bindAll() {
    for (let k = 0; k < 2; k++) {
      lifeBG[k] = device.createBindGroup({ layout: lifeBGL, entries: [
        { binding: 0, resource: { buffer: ruleBuf } },
        { binding: 1, resource: { buffer: A[k] } },
        { binding: 2, resource: { buffer: A[1 - k] } },
        { binding: 3, resource: { buffer: statsBuf } },
      ] });
      if (renderPipe) renderBG[k] = device.createBindGroup({ layout: renderPipe.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: viewBuf } },
        { binding: 1, resource: { buffer: A[k] } },
      ] });
    }
    paintBG = [null, null];
  }

  e.setWorld = (w, h) => {
    for (const b of A) if (b) b.destroy();
    W = w; H = h; cur = 0; gen = 0;
    A = [0, 1].map(k => device.createBuffer({ size: W * H * 4, usage: SU | CD | CS, label: 'world' + k }));
    writeRule();
    bindAll();
    e.stats = { pop: 0, births: 0, deaths: 0, gen: 0 };
  };
  e.size = () => ({ W, H });
  e.setRule = (b, s) => { birth = b; survive = s; writeRule(); };
  e.setWrap = on => { wrap = on ? 1 : 0; writeRule(); };
  e.clear = () => {
    const enc = device.createCommandEncoder();
    enc.clearBuffer(A[0]); enc.clearBuffer(A[1]);
    device.queue.submit([enc.finish()]);
  };
  e.write = data => {
    device.queue.writeBuffer(A[cur], 0, data);
  };

  // edits: Uint32Array of (index, word) pairs.
  e.paint = edits => {
    const n = edits.length >> 1;
    if (!n || e.lost) return;
    if (n * 8 > editCap) {
      if (editBuf) editBuf.destroy();
      editCap = Math.max(4096, 1 << Math.ceil(Math.log2(n * 8)));
      editBuf = device.createBuffer({ size: editCap, usage: SU | CD });
      paintBG = [null, null];
    }
    if (!paintBG[cur]) paintBG[cur] = device.createBindGroup({ layout: paintPipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: editBuf } },
      { binding: 1, resource: { buffer: A[cur] } },
      { binding: 2, resource: { buffer: paintN } },
    ] });
    device.queue.writeBuffer(editBuf, 0, edits.buffer, edits.byteOffset, n * 8);
    device.queue.writeBuffer(paintN, 0, new Uint32Array([n, 0, 0, 0]));
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(paintPipe);
    pass.setBindGroup(0, paintBG[cur]);
    pass.dispatchWorkgroups(Math.ceil(n / 64));
    pass.end();
    device.queue.submit([enc.finish()]);
  };

  // Copy the stats to the map buffer, unless a readback is still in flight.
  // A skipped readback costs nothing: the next batch sends new counts.
  function readStats(enc, tag) {
    if (statsBusy) return false;
    enc.copyBufferToBuffer(statsBuf, 0, statsRead, 0, 16);
    return () => {
      statsBusy = true;
      statsRead.mapAsync(GPUMapMode.READ).then(() => {
        const s = new Uint32Array(statsRead.getMappedRange().slice(0));
        statsRead.unmap();
        statsBusy = false;
        e.stats = { pop: s[0], births: tag.births ? s[1] : 0, deaths: tag.births ? s[2] : 0, gen: tag.gen, step: tag.births };
        if (typeof e.onStats === 'function') e.onStats(e.stats);
      }, () => { statsBusy = false; });
    };
  }

  e.step = n => {
    if (!A[0] || e.lost || n <= 0) return;
    const enc = device.createCommandEncoder();
    const wantStats = !statsBusy;
    if (wantStats) enc.clearBuffer(statsBuf);
    const pass = enc.beginComputePass();
    const gx = Math.ceil(W / 16), gy = Math.ceil(H / 16);
    for (let k = 0; k < n; k++) {
      pass.setPipeline(wantStats && k === n - 1 ? statsPipe : stepPipe);
      pass.setBindGroup(0, lifeBG[cur]);
      pass.dispatchWorkgroups(gx, gy);
      cur = 1 - cur;
    }
    pass.end();
    gen += n;
    const after = wantStats ? readStats(enc, { gen, births: true }) : null;
    device.queue.submit([enc.finish()]);
    if (after) after();
  };

  e.count = () => {
    if (!A[0] || e.lost || statsBusy) return false;
    const enc = device.createCommandEncoder();
    enc.clearBuffer(statsBuf);
    const pass = enc.beginComputePass();
    pass.setPipeline(countPipe);
    pass.setBindGroup(0, lifeBG[cur]);
    pass.dispatchWorkgroups(Math.ceil(W / 16), Math.ceil(H / 16));
    pass.end();
    const after = readStats(enc, { gen, births: false });
    device.queue.submit([enc.finish()]);
    if (after) after();
    return true;
  };

  // One cell. The reads queue up, so two calls never map the buffer at once.
  e.readCell = (x, y) => {
    const job = cellBusy.then(async () => {
      if (e.lost || !A[0]) return 0;
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(A[cur], (y * W + x) * 4, cellRead, 0, 4);
      device.queue.submit([enc.finish()]);
      await cellRead.mapAsync(GPUMapMode.READ);
      const v = new Uint32Array(cellRead.getMappedRange().slice(0))[0];
      cellRead.unmap();
      return v;
    });
    cellBusy = job.catch(() => 0);
    return job;
  };

  e.read = async () => {
    const rb = device.createBuffer({ size: W * H * 4, usage: GPUBufferUsage.MAP_READ | CD });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(A[cur], 0, rb, 0, W * H * 4);
    device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const out = new Uint32Array(rb.getMappedRange().slice(0));
    rb.unmap(); rb.destroy();
    return out;
  };

  let pw = 1, ph = 1;
  e.resize = (w, h) => {
    pw = Math.max(1, w | 0); ph = Math.max(1, h | 0);
    if (canvas && (canvas.width !== pw || canvas.height !== ph)) { canvas.width = pw; canvas.height = ph; }
  };
  const viewData = new ArrayBuffer(64), vf = new Float32Array(viewData), vu = new Uint32Array(viewData);
  e.render = v => {
    if (!context || !A[0] || e.lost) return;
    vf[0] = pw; vf[1] = ph; vf[2] = v.cx; vf[3] = v.cy;
    vf[4] = v.cell; vf[5] = v.ox || 0; vf[6] = v.oy || 0; vf[7] = W;
    vf[8] = H; vu[9] = v.mode === 'plain' ? 0 : 1; vu[10] = v.trails ? 1 : 0; vu[11] = v.grid ? 1 : 0;
    vf[12] = TRAIL;
    device.queue.writeBuffer(viewBuf, 0, viewData);
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{
      view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 },
    }] });
    pass.setPipeline(renderPipe);
    pass.setBindGroup(0, renderBG[cur]);
    pass.draw(3);
    pass.end();
    device.queue.submit([enc.finish()]);
  };

  e.destroy = () => {
    for (const b of [A[0], A[1], ruleBuf, viewBuf, statsBuf, statsRead, paintN, cellRead, editBuf]) { try { if (b) b.destroy(); } catch (_) {} }
    try { if (context) context.unconfigure(); } catch (_) {}
    device.destroy();
  };
  return e;
}
