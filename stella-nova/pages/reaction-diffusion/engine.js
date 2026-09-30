// engine.js - WebGPU engine for the reaction-diffusion page.
//
// The state is W x H cells, four chemicals a b c d packed in one rgba32float
// texture. Two textures ping-pong. Each substep is one compute dispatch of the
// step program that shadergen.js builds from the preset formula. All substeps
// of one call to step(n) go in one compute pass and one command buffer.
// rgba32float is not filterable, so render() first runs prep.wgsl. That pass
// writes an rgba16float field (normalized value + gradient) that render.wgsl
// samples with a linear sampler.
//
// API (grep -n "^  async \|^  [a-zA-Z]*(" engine.js):
//   const engine = await createEngine(canvas, {mobile})   throws Error('webgpu-unavailable')
//   await engine.setPreset(preset)     compile (cached), size textures, apply init, set view
//   engine.reset(seed? | {seed})       apply init again
//   engine.setParam(name, value)       live uniform update
//   engine.getParams()                 {name: value} for the current preset slots
//   engine.step(n)                     n substeps; returns the number run (mobile/desktop cap)
//   engine.render()                    draw to the canvas
//   engine.resize(pixelW, pixelH)      set the canvas backing size
//   engine.paint(u, v, radius, chem, value | 'noise', soft?)
//                                      u, v in [0,1] grid coords (u right, v down);
//                                      radius is a fraction of the grid width
//   engine.setView({colormap, chem, low, high, height, lightAngle, heightScale, zoom, tile, background})
//                                      lightAngle in degrees, counterclockwise from +x (135 = upper left).
//                                      null or undefined keys keep the current value.
//   engine.view                        the current view settings
//   engine.displayRect()               one grid copy in canvas CSS px {x, y, w, h}
//   engine.canvasToGrid(cx, cy)        cx, cy in [0,1] of the canvas -> {u, v, inside}
//   engine.gridRect()                  where grid [0,1]^2 sits, in [0,1] canvas coords
//   await engine.readState()           Float32Array(W*H*4) of the current state
//   engine.info                        {stepsPerSecond, fps, width, height, steps, maxStepsPerFrame, lost}
//   engine.colormaps                   names of the colormaps
//   engine.onLost = (info) => {}       called when the GPU device is lost
//   engine.destroy()
//
// A compile error in a formula throws an Error with the WGSL messages. The old
// preset keeps running, so the page does not stop.
// The init op list is applied on the CPU (buildInitState in shadergen.js) and
// uploaded with writeTexture. The op list is documented there.

import { buildStepShader, paramSlots, packParams, buildInitState, MAX_PARAMS } from './shadergen.js';
import { colormapRows } from './colormaps.js';

const CHEM_INDEX = { a: 0, b: 1, c: 2, d: 3 };
// Cell-steps per frame. On a phone the cap protects the battery.
const WORK_CAP = { mobile: 8e6, desktop: 1.2e8 };

async function loadText(rel) {
  const r = await fetch(new URL(rel, import.meta.url));
  if (!r.ok) throw new Error(`fetch ${rel}: ${r.status}`);
  return r.text();
}

async function compileModule(device, code, label) {
  device.pushErrorScope('validation');
  const module = device.createShaderModule({ code, label });
  const info = await module.getCompilationInfo();
  const scopeErr = await device.popErrorScope();
  const errs = info.messages.filter(m => m.type === 'error');
  if (errs.length || scopeErr) {
    const lines = code.split('\n');
    const msg = errs.map(m => {
      const src = m.lineNum ? `\n    ${(lines[m.lineNum - 1] || '').trim()}` : '';
      return `${label}:${m.lineNum}:${m.linePos}: ${m.message}${src}`;
    }).join('\n') || (scopeErr && scopeErr.message) || 'shader error';
    const e = new Error(msg);
    e.wgsl = code;
    throw e;
  }
  return module;
}

export async function createEngine(canvas, { mobile = false } = {}) {
  if (!('gpu' in navigator) || !navigator.gpu) throw new Error('webgpu-unavailable');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: mobile ? 'low-power' : 'high-performance' });
  if (!adapter) throw new Error('webgpu-unavailable');
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('webgpu-unavailable');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  let lost = false;
  const engine = {};
  device.lost.then(info => {
    lost = true;
    console.error('[reaction-diffusion] GPU device lost:', info.reason, info.message);
    if (typeof engine.onLost === 'function') engine.onLost(info);
  });
  device.addEventListener('uncapturederror', ev => console.error('[reaction-diffusion] GPU error:', ev.error.message));

  const [prepCode, renderCode, paintCode] = await Promise.all(
    ['shaders/prep.wgsl', 'shaders/render.wgsl', 'shaders/paint.wgsl'].map(loadText));

  // Layout shared by the step, prep, and paint programs: uniform, source, storage out.
  const simLayout = fmt => device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: fmt } },
    ],
  });
  const stepBGL = simLayout('rgba32float');
  const prepBGL = simLayout('rgba16float');
  const stepPL = device.createPipelineLayout({ bindGroupLayouts: [stepBGL] });
  const prepPipe = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [prepBGL] }),
    compute: { module: await compileModule(device, prepCode, 'prep.wgsl'), entryPoint: 'prep' },
  });
  const paintPipe = device.createComputePipeline({
    layout: stepPL,
    compute: { module: await compileModule(device, paintCode, 'paint.wgsl'), entryPoint: 'paint' },
  });
  const renderBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ],
  });
  const renderModule = await compileModule(device, renderCode, 'render.wgsl');
  const renderPipe = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [renderBGL] }),
    vertex: { module: renderModule, entryPoint: 'vs' },
    fragment: { module: renderModule, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });

  // Colormap texture: one 256-texel row per colormap.
  const cm = colormapRows(256);
  const cmTex = device.createTexture({
    size: [cm.size, cm.names.length], format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture({ texture: cmTex }, cm.data, { bytesPerRow: cm.size * 4 }, [cm.size, cm.names.length]);
  const fieldSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' });
  const cmSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

  const stepUBO = device.createBuffer({ size: 16 + MAX_PARAMS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const prepUBO = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const paintUBO = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const renderUBO = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const pipeCache = new Map();   // WGSL code -> compute pipeline
  let W = 0, H = 0;
  let tex = [null, null], field = null;
  let stepBG = [null, null], paintBG = [null, null], prepBG = [null, null], renderBG = null;
  let cur = 0;
  let preset = null, slots = [], values = {}, stepPipe = null;
  const paramData = new Float32Array(MAX_PARAMS);
  const header = new Uint32Array(4);
  let totalSteps = 0, seedCounter = 1;
  const view = {
    colormap: 'spectral', chem: 'b', low: 0, high: 1, height: false,
    lightAngle: 135, heightScale: 6, zoom: 1, tile: null, background: [0.04, 0.05, 0.07],
  };

  // Rates, from completed GPU work and from render calls.
  let rateT0 = performance.now(), rateSteps = 0, rateFrames = 0;
  let stepsPerSecond = 0, fps = 0, pending = 0;
  const tickRates = () => {
    const now = performance.now(), dt = now - rateT0;
    if (dt >= 500) {
      stepsPerSecond = rateSteps * 1000 / dt; fps = rateFrames * 1000 / dt;
      rateT0 = now; rateSteps = 0; rateFrames = 0;
    }
  };

  function sizeTextures(w, h) {
    if (w === W && h === H && tex[0]) return;
    for (const t of tex) t && t.destroy();
    field && field.destroy();
    W = w; H = h;
    const mk = () => device.createTexture({
      size: [W, H], format: 'rgba32float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
    tex = [mk(), mk()];
    field = device.createTexture({
      size: [W, H], format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    const views = tex.map(t => t.createView());
    const bg = (layout, ubo, i, out) => device.createBindGroup({
      layout, entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: views[i] }, { binding: 2, resource: out }],
    });
    stepBG = [bg(stepBGL, stepUBO, 0, views[1]), bg(stepBGL, stepUBO, 1, views[0])];
    paintBG = [bg(stepBGL, paintUBO, 0, views[1]), bg(stepBGL, paintUBO, 1, views[0])];
    const fv = field.createView();
    prepBG = [bg(prepBGL, prepUBO, 0, fv), bg(prepBGL, prepUBO, 1, fv)];
    renderBG = device.createBindGroup({
      layout: renderBGL,
      entries: [
        { binding: 0, resource: { buffer: renderUBO } }, { binding: 1, resource: fv },
        { binding: 2, resource: fieldSampler }, { binding: 3, resource: cmTex.createView() },
        { binding: 4, resource: cmSampler },
      ],
    });
  }

  function writeStepUniforms() {
    header[0] = W; header[1] = H; header[2] = totalSteps >>> 0; header[3] = 0;
    device.queue.writeBuffer(stepUBO, 0, header);
    packParams(slots, values, paramData);
    device.queue.writeBuffer(stepUBO, 16, paramData);
  }

  function applyInit(seed) {
    const data = buildInitState(preset, W, H, seed);
    device.queue.writeTexture({ texture: tex[0] }, data, { bytesPerRow: W * 16, rowsPerImage: H }, [W, H]);
    cur = 0;
    totalSteps = 0;
  }

  engine.setPreset = async function setPreset(p, opts = {}) {
    const code = buildStepShader(p, { paramMap: opts.paramMap !== undefined ? opts.paramMap : p.paramMap });
    let pipe = pipeCache.get(code);
    if (!pipe) {
      const module = await compileModule(device, code, `step:${p.id || 'preset'}`);
      try {
        pipe = await device.createComputePipelineAsync({ layout: stepPL, compute: { module, entryPoint: 'step' } });
      } catch (err) {
        const e = new Error(`step:${p.id || 'preset'}: ${err.message}`);
        e.wgsl = code;
        throw e;
      }
      pipeCache.set(code, pipe);
    }
    // Compile passed. Now switch to the new preset.
    preset = p;
    stepPipe = pipe;
    slots = paramSlots(p);
    values = {};
    for (const s of slots) values[s.name] = s.value;
    sizeTextures(Math.max(8, p.width | 0 || 256), Math.max(8, p.height | 0 || p.width | 0 || 256));
    writeStepUniforms();
    const r = p.render || {};
    engine.setView({
      chem: r.chem || 'a',
      low: r.low != null ? r.low : 0,
      high: r.high != null ? r.high : 1,
      colormap: r.colormap && cm.names.includes(r.colormap) ? r.colormap : view.colormap,
      height: r.height != null ? !!r.height : view.height,
      tile: null,
    });
    applyInit(opts.seed != null ? opts.seed : seedCounter++);
    return { code, slots: slots.map(s => ({ ...s })) };
  };

  engine.reset = function reset(seed) {
    if (!preset) return;
    if (seed && typeof seed === 'object') seed = seed.seed;
    applyInit(seed != null ? seed >>> 0 : seedCounter++);
  };

  engine.setParam = function setParam(name, value) {
    if (!(name in values)) return false;
    values[name] = +value;
    writeStepUniforms();
    return true;
  };

  engine.getParams = () => ({ ...values });

  engine.maxStepsPerFrame = () => Math.max(1, Math.floor((mobile ? WORK_CAP.mobile : WORK_CAP.desktop) / Math.max(1, W * H)));

  engine.step = function step(n) {
    if (!stepPipe || lost) return 0;
    const cap = engine.maxStepsPerFrame();
    n = Math.min(Math.max(0, n | 0), cap);
    // Back-pressure: if the GPU is more than a few frames behind, skip this call.
    if (!n || pending > 4 * cap) return 0;
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(stepPipe);
    const gx = Math.ceil(W / 8), gy = Math.ceil(H / 8);
    for (let i = 0; i < n; i++) {
      pass.setBindGroup(0, stepBG[cur]);
      pass.dispatchWorkgroups(gx, gy);
      cur ^= 1;
    }
    pass.end();
    device.queue.submit([enc.finish()]);
    totalSteps += n;
    pending += n;
    const done = n;
    device.queue.onSubmittedWorkDone().then(() => { rateSteps += done; pending -= done; tickRates(); });
    return n;
  };

  // Brush. Each call is one small compute pass, in queue order with the steps.
  const paintData = new ArrayBuffer(48);
  const paintU32 = new Uint32Array(paintData), paintF32 = new Float32Array(paintData);
  engine.paint = function paint(u, v, radius, chem, value, soft = 0) {
    if (!preset || lost) return;
    paintU32[0] = W; paintU32[1] = H;
    paintU32[2] = CHEM_INDEX[chem] != null ? CHEM_INDEX[chem] : (chem | 0);
    paintU32[3] = preset.wrap !== false ? 1 : 0;
    paintF32[4] = u * W; paintF32[5] = v * H;
    paintF32[6] = Math.max(0.5, radius * W);
    const noise = value === 'noise' || (typeof value === 'object' && value && value.noise != null);
    paintF32[7] = value === 'noise' ? 1 : noise ? +value.noise : +value;
    paintU32[8] = noise ? 1 : 0;
    paintU32[9] = (Math.random() * 4294967296) >>> 0;
    paintF32[10] = soft * W;
    device.queue.writeBuffer(paintUBO, 0, paintData);
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(paintPipe);
    pass.setBindGroup(0, paintBG[cur]);
    pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
    pass.end();
    device.queue.submit([enc.finish()]);
    cur ^= 1;
  };

  engine.setView = function setView(v = {}) {
    for (const k of Object.keys(v)) if (v[k] != null && k in view) view[k] = v[k];
    if ('tile' in v && v.tile === null) view.tile = null;
    if (!cm.names.includes(view.colormap)) view.colormap = 'spectral';
  };
  Object.defineProperty(engine, 'view', { get: () => ({ ...view }) });

  const tiled = () => (view.tile != null ? !!view.tile : !!preset && preset.wrap !== false && !preset.paramMap);

  // Grid placement in canvas pixels: fit, aspect kept, centered, times zoom.
  function layout() {
    const cw = canvas.width, ch = canvas.height;
    const scale = Math.min(cw / W, ch / H) * (view.zoom || 1);
    return { cw, ch, scale, ox: (cw - W * scale) / 2, oy: (ch - H * scale) / 2 };
  }

  engine.gridRect = function gridRect() {
    if (!W) return { x0: 0, y0: 0, x1: 1, y1: 1 };
    const L = layout();
    return { x0: L.ox / L.cw, y0: L.oy / L.ch, x1: (L.ox + W * L.scale) / L.cw, y1: (L.oy + H * L.scale) / L.ch };
  };

  // One copy of the grid in canvas CSS pixels: {x, y, w, h}. The UI uses it for
  // pointer mapping and for the parameter-map axes.
  engine.displayRect = function displayRect() {
    const r = engine.gridRect();
    const cw = canvas.clientWidth || canvas.width, ch = canvas.clientHeight || canvas.height;
    return { x: r.x0 * cw, y: r.y0 * ch, w: (r.x1 - r.x0) * cw, h: (r.y1 - r.y0) * ch };
  };

  engine.canvasToGrid = function canvasToGrid(cx, cy) {
    if (!W) return { u: 0, v: 0, inside: false };
    const L = layout();
    let u = (cx * L.cw - L.ox) / (W * L.scale), v = (cy * L.ch - L.oy) / (H * L.scale);
    const inside = u >= 0 && u <= 1 && v >= 0 && v <= 1;
    if (tiled()) { u -= Math.floor(u); v -= Math.floor(v); return { u, v, inside: true }; }
    return { u, v, inside };
  };

  const prepData = new ArrayBuffer(32), prepU32 = new Uint32Array(prepData), prepF32 = new Float32Array(prepData);
  const renderData = new Float32Array(16);
  engine.render = function render() {
    if (!field || lost || !canvas.width || !canvas.height) return;
    prepU32[0] = W; prepU32[1] = H;
    prepU32[2] = CHEM_INDEX[view.chem] != null ? CHEM_INDEX[view.chem] : (view.chem | 0);
    prepU32[3] = preset && preset.wrap !== false ? 1 : 0;
    prepF32[4] = +view.low; prepF32[5] = +view.high;
    device.queue.writeBuffer(prepUBO, 0, prepData);
    const L = layout();
    const row = Math.max(0, cm.names.indexOf(view.colormap));
    renderData.set([
      L.cw, L.ch, W, H,
      L.ox, L.oy, L.scale, tiled() ? 1 : 0,
      view.height ? 1 : 0, (row + 0.5) / cm.names.length, (+view.lightAngle || 0) * Math.PI / 180, +view.heightScale,
      view.background[0], view.background[1], view.background[2], L.scale > 2 ? 1 : 0,
    ]);
    device.queue.writeBuffer(renderUBO, 0, renderData);
    const enc = device.createCommandEncoder();
    const cp = enc.beginComputePass();
    cp.setPipeline(prepPipe);
    cp.setBindGroup(0, prepBG[cur]);
    cp.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
    cp.end();
    const rp = enc.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    rp.setPipeline(renderPipe);
    rp.setBindGroup(0, renderBG);
    rp.draw(3);
    rp.end();
    device.queue.submit([enc.finish()]);
    rateFrames++;
    tickRates();
  };

  engine.resize = function resize(pw, ph) {
    const w = Math.max(1, Math.round(pw)), h = Math.max(1, Math.round(ph));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  };

  engine.readState = async function readState() {
    const bpr = Math.ceil(W * 16 / 256) * 256;
    const buf = device.createBuffer({ size: bpr * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: tex[cur] }, { buffer: buf, bytesPerRow: bpr }, [W, H]);
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange());
    const out = new Float32Array(W * H * 4);
    const outBytes = new Uint8Array(out.buffer);
    for (let j = 0; j < H; j++) outBytes.set(src.subarray(j * bpr, j * bpr + W * 16), j * W * 16);
    buf.unmap();
    buf.destroy();
    return out;
  };

  Object.defineProperty(engine, 'info', {
    get: () => ({
      stepsPerSecond, fps, width: W, height: H, steps: totalSteps, pending,
      maxStepsPerFrame: W ? engine.maxStepsPerFrame() : 0, lost, mobile,
    }),
  });
  engine.colormaps = cm.names.slice();
  engine.device = device;
  Object.defineProperty(engine, 'preset', { get: () => preset });

  engine.destroy = function destroy() {
    for (const t of tex) t && t.destroy();
    field && field.destroy();
    cmTex.destroy();
    for (const b of [stepUBO, prepUBO, paintUBO, renderUBO]) b.destroy();
    context.unconfigure();
    device.destroy();
  };

  return engine;
}
