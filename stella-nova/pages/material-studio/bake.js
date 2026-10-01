// ============================================================================
//  MATERIAL STUDIO  ·  bake.js — run the compiled passes into MaterialMaps
// ────────────────────────────────────────────────────────────────────────────
//  Listens to graph:changed, res:changed and view-independent settings,
//  compiles the graph (compile.js), runs the passes on the shared device,
//  builds the mip chains of the six maps, sets state.maps, state.compiled,
//  state.scalars, and emits bake:start, then bake:done or bake:error.
//  After each bake it renders node thumbnails into one atlas and emits
//  'bake:thumbs'.
//
//  INCREMENTAL BAKE
//      Each pass gets a content key: hash(WGSL hash, target format, size,
//      uniform bytes, content keys of its input textures). A pass whose key
//      is in the texture cache is not run again. Thus a param edit re-runs
//      only the passes downstream of the edited node, and an edit in the
//      fused output code re-runs only the output passes. Textures that the
//      new bake does not use are destroyed 2 frames after bake:done.
//
//  INTERACTIVE PREVIEW
//      graph:changed {reason:'param'} (a slider drag) bakes at most
//      PREVIEW_RES first, then the full resolution after IDLE_MS of quiet.
//
//  PIPELINES
//      Cached by WGSL hash + target formats + texture count. Creation is
//      async (createRenderPipelineAsync). Shader compile messages map back
//      to node ids through compile.lineToNode.
//
//  EVENTS OUT (contract EVENTS plus two extensions)
//      bake:start {res}  bake:done MaterialMaps  bake:error {message, nodeId}
//      compile:errors {errors:[{nodeId, message}]}   after every compile (empty clears badges)
//      bake:thumbs {ids:string[]}                    thumbnails changed for these node ids
//
//  DEBUG HOOK  __studio.bake  (grep -n 'register(' to jump)
//      bake(force?) readback(map, opts) readTexture(tex, opts) bakeOnce(res, opts)
//      thumb(nodeId, opts) thumbs (Map) thumbCanvas(nodeId) setTime(t) setPrecision(p)
//      stats wgsl(passIndex) selfTest(opts)
//
//  SECTIONS  (grep -n the banner to jump)
//      state ........... module state and caches
//      half floats ..... f16 encode/decode tables, sRGB tables
//      gpu objects ..... samplers, layouts, pipelines, const and image textures
//      run passes ...... runPasses: key, cache, encode one bake
//      mips ............ generateMips
//      schedule ........ the bake loop, preview res, idle full bake
//      thumbnails ...... renderThumbs atlas
//      readback ........ readTexture / readback
//      bakeOnce ........ a private bake for export at any resolution
//      self test ....... every core node alone and chained
// ============================================================================
import { MAP_NAMES, MAP_FORMAT, MAP_SLOTS, OUTPUT_TYPE } from './contract.js';
import { compileGraph, prepareGraph, loadLib, lineToNode, hashStr, graphJSON, testGraph } from './compile.js';

// ------------------------------------------------------------ state
const PREVIEW_RES = 512;
const IDLE_MS = 260;
const THUMB = 128;
const PIPE_LIMIT = 768;

let store = null, gpuMod = null, modules = null, device = null;
let utilModule = null;
let sampler = null;
const layouts = new Map();       // texture count -> {bgl, layout}
const pipes = new Map();         // key -> Promise<{pipeline, errors}>
const constTex = new Map();      // value key -> GPUTexture (1x1)
const imageTex = new Map();      // image key -> {tex, w, h}
let defaultImage = null;
const live = { cache: new Map(), results: new Map(), keys: new Map() };   // the interactive bake context
let precision = 'auto';          // 'auto' | 'half' | 'full'
let time = 0;
let gen = 0;                     // bake generation
let running = false, pending = null, idleTimer = 0, lastFull = true, loopP = Promise.resolve();
const thumbs = new Map();        // nodeId -> {key, image: ImageData, out}
const stats = { bakes: 0, passesRun: 0, passesCached: 0, pipelines: 0, lastMs: 0, lastRes: 0, thumbMs: 0, errors: 0 };
let currentMaps = null;

// ------------------------------------------------------------ half floats
const F16_TO_F32 = new Float32Array(65536);
(() => {
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
    F16_TO_F32[h] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
  }
})();
let LUT8_LIN = null, LUT8_SRGB = null, LUT16_LIN = null, LUT16_SRGB = null;
function luts() {
  if (LUT8_LIN) return;
  LUT8_LIN = new Uint8Array(65536); LUT8_SRGB = new Uint8Array(65536);
  LUT16_LIN = new Uint16Array(65536); LUT16_SRGB = new Uint16Array(65536);
  for (let h = 0; h < 65536; h++) {
    let x = F16_TO_F32[h];
    if (!(x > 0)) x = 0; else if (x > 1) x = 1;
    const s = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    LUT8_LIN[h] = Math.round(x * 255); LUT8_SRGB[h] = Math.round(s * 255);
    LUT16_LIN[h] = Math.round(x * 65535); LUT16_SRGB[h] = Math.round(s * 65535);
  }
}
const f32buf = new Float32Array(1), u32buf = new Uint32Array(f32buf.buffer);
/** f32 -> f16 bits (round to nearest, no denormal care needed for constants). */
function toHalf(v) {
  f32buf[0] = v;
  const x = u32buf[0], s = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return s;
  if (e >= 31) return s | 0x7c00;
  m += 0x1000;
  if (m & 0x800000) { m = 0; e++; if (e >= 31) return s | 0x7c00; }
  return s | (e << 10) | (m >>> 13);
}

// ------------------------------------------------------------ gpu objects
function interFormat(res) {
  const full = precision === 'full' || (precision === 'auto' && res <= 1024);
  return full && gpuMod.features.float32Filterable ? 'rgba32float' : 'rgba16float';
}
function maxMRT() {
  const lim = device.limits;
  return lim.maxColorAttachments >= 6 && lim.maxColorAttachmentBytesPerSample >= 48 ? 6 : 3;
}

function layoutFor(n) {
  if (layouts.has(n)) return layouts.get(n);
  const entries = [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
  ];
  for (let i = 0; i < n; i++) entries.push({ binding: i + 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } });
  const bgl = device.createBindGroupLayout({ label: `ms-bake-bgl-${n}`, entries });
  const v = { bgl, layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }) };
  layouts.set(n, v);
  return v;
}

/** Map GPU compile messages to [{nodeId, message}]. */
function messagesToErrors(spec, msgs) {
  return msgs.map(m => ({ nodeId: lineToNode(spec, m.lineNum || 0), message: `WGSL ${m.lineNum || 0}:${m.linePos || 0} ${m.message}` }));
}

function getPipeline(spec, formats) {
  const key = spec.hash + '|' + formats.join(',') + '|' + spec.textures.length;
  if (pipes.has(key)) { const p = pipes.get(key); pipes.delete(key); pipes.set(key, p); return p; }
  const prom = (async () => {
    device.pushErrorScope('validation');
    const module = device.createShaderModule({ code: spec.wgsl, label: spec.label });
    const scopeP = device.popErrorScope();
    const info = await module.getCompilationInfo();
    const errs = info.messages.filter(m => m.type === 'error');
    const scopeErr = await scopeP;
    if (errs.length) return { pipeline: null, errors: messagesToErrors(spec, errs) };
    if (scopeErr) return { pipeline: null, errors: [{ nodeId: spec.nodeId, message: scopeErr.message }] };
    try {
      const pipeline = await device.createRenderPipelineAsync({
        label: spec.label, layout: layoutFor(spec.textures.length).layout,
        vertex: { module, entryPoint: 'ms_vs' },
        fragment: { module, entryPoint: 'ms_fs', targets: formats.map(format => ({ format })) },
        primitive: { topology: 'triangle-list' },
      });
      stats.pipelines++;
      return { pipeline, errors: null };
    } catch (e) {
      return { pipeline: null, errors: [{ nodeId: spec.nodeId, message: 'pipeline: ' + (e && e.message || e) }] };
    }
  })();
  pipes.set(key, prom);
  while (pipes.size > PIPE_LIMIT) pipes.delete(pipes.keys().next().value);
  return prom;
}

function getConstTex(v) {
  const k = v.map(x => toHalf(x)).join(',');
  if (constTex.has(k)) return constTex.get(k);
  const tex = device.createTexture({ label: 'ms-const', size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: tex }, new Uint16Array(v.map(toHalf)), { bytesPerRow: 8 }, [1, 1]);
  constTex.set(k, tex);
  if (constTex.size > 512) { const [k0, t0] = constTex.entries().next().value; constTex.delete(k0); later(() => t0.destroy()); }
  return tex;
}

const bitmapIds = new WeakMap();
let bitmapSeq = 0;
function imageKey(ref) {
  const v = ref.value;
  if (!v) return 'none';
  let id = v.url || v.src || '';
  const b = v.bitmap || (typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap ? v : null);
  if (b) { if (!bitmapIds.has(b)) bitmapIds.set(b, ++bitmapSeq); id = 'bmp' + bitmapIds.get(b); }
  if (!id && typeof v === 'string') id = v;
  return id ? id + (ref.srgb ? '|s' : '|l') : 'none';
}

async function loadImageTex(ref) {
  const key = imageKey(ref);
  if (key === 'none') return { tex: defaultImage, key };
  if (imageTex.has(key)) return { tex: imageTex.get(key).tex, key };
  const v = ref.value;
  let bmp = v.bitmap || (typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap ? v : null);
  if (!bmp) {
    const url = v.url || v.src || (typeof v === 'string' ? v : null);
    const blob = await (await fetch(url)).blob();
    bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
  }
  const fmt = ref.srgb ? 'rgba8unorm-srgb' : 'rgba8unorm';
  const tex = device.createTexture({
    label: 'ms-image ' + key, size: [bmp.width, bmp.height], format: fmt,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: bmp }, { texture: tex }, [bmp.width, bmp.height]);
  imageTex.set(key, { tex, w: bmp.width, h: bmp.height });
  return { tex, key };
}

/** Run fn after two animation frames (or 50 ms without rAF). */
function later(fn) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(fn));
  else setTimeout(fn, 50);
}

// ------------------------------------------------------------ run passes
/**
 * Run the compiled passes. ctx = {cache, results, keys}: cache maps a content
 * key to {texs, used}; results maps a pass id to its texture after this run.
 * @returns {Promise<{maps:object|null, errors:Array, ran:number, cached:number}>}
 */
async function runPasses(compiled, res, ctx, opts = {}) {
  const errors = [];
  const inter = opts.interFormat || interFormat(res);
  const header = [res, Number(compiled.settings.seed) || 0, Number(compiled.settings.tiling) || 1, time];
  const formatsOf = spec => spec.targets.map(t => (t === 'inter' ? inter : t === 'map' ? MAP_FORMAT : t));

  // Images first (async), then pipelines in parallel.
  const imgKeys = new Map();
  for (const spec of compiled.passes) {
    for (const t of spec.textures) {
      if (t.kind !== 'image') continue;
      try { const r = await loadImageTex(t); imgKeys.set(t, r); }
      catch (e) { errors.push({ nodeId: t.nodeId, message: 'image load failed: ' + e.message }); imgKeys.set(t, { tex: defaultImage, key: 'none' }); }
    }
  }
  const pipeRes = await Promise.all(compiled.passes.map(s => (s.external ? { pipeline: null, errors: null } : getPipeline(s, formatsOf(s)))));

  const results = new Map(), keys = new Map(), used = new Set();
  let enc = device.createCommandEncoder({ label: 'ms-bake' });
  const ubufs = [], newMaps = [];
  let ran = 0, cached = 0;
  device.pushErrorScope('validation');
  for (let i = 0; i < compiled.passes.length; i++) {
    const spec = compiled.passes[i], pr = pipeRes[i];
    const size = spec.size || res;
    const formats = formatsOf(spec);
    const u = spec.uniforms.slice();
    u.set(header, 0); u[0] = size;
    u.set([0, 0, size, 0], 4);
    const inKeys = spec.textures.map(t => (t.kind === 'pass' ? keys.get(t.pass) || 'missing' : t.kind === 'const' ? 'c' + t.value.join(',') : 'i' + (imgKeys.get(t) || {}).key));
    const key = hashStr([spec.hash, formats.join(','), size, Array.from(new Uint32Array(u.buffer)).join(','), inKeys.join(';'), pr.errors ? 'err' : '', spec.external ? spec.seed : ''].join('|'));
    keys.set(spec.id, key);
    if (pr.errors) for (const e of pr.errors) errors.push(e);
    let entry = ctx.cache.get(key);
    if (entry) {
      cached++;
      used.add(key);
      results.set(spec.id, spec.kind === 'out' ? entry.texs : entry.texs[0]);
      continue;
    }
    if (spec.external) {
      // A node with its own GPU work (pass.run): flush what feeds it, then run.
      const def = store.state.registry.get(spec.nodeType);
      const target = device.createTexture({
        label: `ms-ext ${spec.label}`, size: [size, size], format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      ctx.cache.set(key, { texs: [target], kind: 'node' });
      used.add(key);
      results.set(spec.id, target);
      device.queue.submit([enc.finish()]);
      const inputs = {};
      for (const [inId, j] of Object.entries(spec.inputs || {})) {
        const t = j === null || j === undefined ? null : spec.textures[j];
        inputs[inId] = t && t.kind === 'pass' ? results.get(t.pass) || null : null;
      }
      try {
        await def.pass.run({ device, target, res: size, values: { ...spec.values }, inputs, seed: header[1] + spec.seed, time, tiling: header[2] });
        ran++;
      } catch (e) {
        errors.push({ nodeId: spec.nodeId, message: 'run failed: ' + (e && e.message || e) });
        const ce = device.createCommandEncoder();
        ce.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 1, g: 0, b: 1, a: 1 } }] }).end();
        device.queue.submit([ce.finish()]);
      }
      enc = device.createCommandEncoder({ label: 'ms-bake' });
      continue;
    }
    const isMap = spec.kind === 'out';
    const mips = isMap ? Math.floor(Math.log2(size)) + 1 : 1;
    const texs = formats.map(f => device.createTexture({
      label: `ms-${spec.kind} ${spec.label}`, size: [size, size], format: f, mipLevelCount: mips,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    }));
    entry = { texs, kind: spec.kind };
    ctx.cache.set(key, entry);
    used.add(key);
    results.set(spec.id, isMap ? texs : texs[0]);
    if (isMap) newMaps.push(...texs.map((t, j) => ({ tex: t, normal: spec.slots[j] === 'normal' })));
    const views = texs.map(t => t.createView({ baseMipLevel: 0, mipLevelCount: 1 }));
    if (!pr.pipeline) {
      const pass = enc.beginRenderPass({ colorAttachments: views.map(view => ({ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 1, g: 0, b: 1, a: 1 } })) });
      pass.end();
      continue;
    }
    const ubuf = device.createBuffer({ label: 'ms-u ' + spec.label, size: u.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(ubuf, 0, u);
    ubufs.push(ubuf);
    const bgEntries = [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: sampler }];
    spec.textures.forEach((t, j) => {
      let tex;
      if (t.kind === 'pass') tex = results.get(t.pass);
      else if (t.kind === 'const') tex = getConstTex(t.value);
      else tex = (imgKeys.get(t) || {}).tex || defaultImage;
      if (!tex || Array.isArray(tex)) tex = getConstTex([1, 0, 1, 1]);
      bgEntries.push({ binding: j + 2, resource: tex.createView({ baseMipLevel: 0, mipLevelCount: 1 }) });
    });
    const bg = device.createBindGroup({ layout: layoutFor(spec.textures.length).bgl, entries: bgEntries });
    const pass = enc.beginRenderPass({ label: spec.label, colorAttachments: views.map(view => ({ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } })) });
    pass.setPipeline(pr.pipeline);
    pass.setBindGroup(0, bg);
    pass.draw(3);
    pass.end();
    ran++;
  }
  for (const m of newMaps) generateMips(enc, m.tex, m.normal);
  device.queue.submit([enc.finish()]);
  const vErr = await device.popErrorScope();
  if (vErr) errors.push({ nodeId: null, message: 'GPU validation: ' + vErr.message });
  await device.queue.onSubmittedWorkDone();
  for (const b of ubufs) b.destroy();

  // Evict textures this run did not use (after consumers switch).
  const dead = [];
  for (const [k, e] of ctx.cache) if (!used.has(k)) { dead.push(e); ctx.cache.delete(k); }
  if (dead.length) later(() => { for (const e of dead) for (const t of e.texs) t.destroy(); });
  ctx.results = results; ctx.keys = keys;

  let maps = null;
  if (compiled.output && Object.keys(compiled.outputs).length === MAP_NAMES.length) {
    maps = { res, scalars: { ...compiled.scalars } };
    for (const n of MAP_NAMES) {
      const o = compiled.outputs[n];
      const t = results.get(o.pass);
      maps[n] = Array.isArray(t) ? t[o.index] : null;
    }
    if (MAP_NAMES.some(n => !maps[n])) maps = null;
  }
  stats.passesRun += ran; stats.passesCached += cached;
  return { maps, errors, ran, cached };
}

// ------------------------------------------------------------ mips
const mipPipes = {};
function mipPipeline(normal) {
  const k = normal ? 'n' : 'c';
  if (mipPipes[k]) return mipPipes[k];
  const bgl = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }] });
  const pipeline = device.createRenderPipeline({
    label: 'ms-mip-' + k, layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
    vertex: { module: utilModule, entryPoint: 'vs' },
    fragment: { module: utilModule, entryPoint: normal ? 'fs_mipn' : 'fs_mip', targets: [{ format: MAP_FORMAT }] },
    primitive: { topology: 'triangle-list' },
  });
  mipPipes[k] = { pipeline, bgl };
  return mipPipes[k];
}

/** Encode the mip chain of one map texture (level 0 must be rendered). */
function generateMips(enc, tex, normal) {
  const { pipeline, bgl } = mipPipeline(normal);
  for (let l = 1; l < tex.mipLevelCount; l++) {
    const bg = device.createBindGroup({ layout: bgl, entries: [
      { binding: 0, resource: tex.createView({ baseMipLevel: l - 1, mipLevelCount: 1 }) },
      { binding: 1, resource: sampler }] });
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView({ baseMipLevel: l, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bg);
    pass.draw(3);
    pass.end();
  }
}

// ------------------------------------------------------------ schedule
async function compileLive() {
  const state = store.state;
  const g = graphJSON(state, modules);
  if (!g) return null;
  const loadErrors = await prepareGraph(g, state.registry);
  const c = compileGraph(g, state.registry, { maxMRT: device ? maxMRT() : 3 });
  c.errors.push(...loadErrors);
  c.settings = { ...c.settings, tiling: state.settings.tiling ?? c.settings.tiling, seed: state.settings.seed ?? c.settings.seed };
  if (g.settings) {
    if (g.settings.tiling !== undefined) c.settings.tiling = g.settings.tiling;
    if (g.settings.seed !== undefined) c.settings.seed = g.settings.seed;
  }
  return c;
}

function reportErrors(errors) {
  store.emit('compile:errors', { errors });
  stats.errors = errors.length;
  for (const e of errors.slice(0, 8)) store.emit('bake:error', { message: e.message, nodeId: e.nodeId || undefined });
}

/** Ask for a bake. reason 'param' bakes a preview resolution first. */
function schedule(reason) {
  const preview = reason === 'param' && store.state.settings.res > PREVIEW_RES;
  pending = { preview: preview || (pending && pending.preview && reason !== 'force') };
  if (preview) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => schedule('idle'), IDLE_MS);
  }
  if (!running) loopP = loop();
}

async function loop() {
  running = true;
  try {
    while (pending) {
      const job = pending; pending = null;
      await bakeLive(job.preview);
    }
  } finally { running = false; }
}

async function bakeLive(preview) {
  const state = store.state;
  const my = ++gen;
  let compiled;
  try { compiled = await compileLive(); } catch (e) {
    console.error('[bake] compile', e);
    store.emit('bake:error', { message: 'compile: ' + e.message });
    return;
  }
  if (!compiled) return;
  state.compiled = compiled;
  state.scalars = { ...compiled.scalars };
  if (!device || !gpuMod.ok) { reportErrors(compiled.errors); return; }
  const res = preview ? Math.min(PREVIEW_RES, state.settings.res) : state.settings.res;
  store.emit('bake:start', { res });
  const t0 = performance.now();
  let out;
  try { out = await runPasses(compiled, res, live); } catch (e) {
    console.error('[bake] run', e);
    store.emit('bake:error', { message: 'bake: ' + e.message });
    return;
  }
  const errors = [...compiled.errors, ...out.errors];
  reportErrors(errors);
  stats.bakes++; stats.lastMs = performance.now() - t0; stats.lastRes = res;
  lastFull = !preview;
  if (out.maps) {
    out.maps.ms = stats.lastMs;
    out.maps.id = my;
    out.maps.preview = !!preview;
    currentMaps = out.maps;
    state.maps = out.maps;
    store.emit('bake:done', out.maps);
  } else if (!compiled.output) {
    store.emit('bake:error', { message: 'no Material Output node' });
  }
  // A readback that the page teardown aborts is not an error: stay quiet.
  if (!preview && !pending) renderThumbs(compiled, my).catch(e => { if (e?.name === 'AbortError' || gpuMod?.lost || gpuMod?.reason === 'torn down') return; console.warn('[bake] thumbs', e); });
}

// ------------------------------------------------------------ thumbnails
async function renderThumbs(compiled, my) {
  const t0 = performance.now();
  const res = live.lastRes || store.state.settings.res;
  const list = [];
  for (const t of compiled.thumbTargets()) {
    let spec = null;
    try { spec = compiled.thumbSpec(t.id, t.out); } catch (e) { continue; }
    if (!spec) continue;
    const u = spec.uniforms;
    const inKeys = spec.textures.map(x => (x.kind === 'pass' ? live.keys.get(x.pass) || 'missing' : x.kind === 'const' ? x.value.join(',') : 'img'));
    const key = hashStr([spec.hash, Array.from(new Uint32Array(u.buffer, 32)).join(','), inKeys.join(';'), stats.lastRes, compiled.settings.seed, compiled.settings.tiling, time].join('|'));
    const prev = thumbs.get(t.id);
    if (prev && prev.key === key) continue;
    list.push({ id: t.id, out: t.out, spec, key });
  }
  const live2 = new Set(compiled.thumbTargets().map(t => t.id));
  for (const id of [...thumbs.keys()]) if (!live2.has(id)) thumbs.delete(id);
  if (!list.length) return;
  const pr = await Promise.all(list.map(x => getPipeline(x.spec, ['rgba8unorm'])));
  if (my !== gen) return;   // a newer bake started: its textures replace ours
  const cols = Math.min(list.length, 16), rows = Math.ceil(list.length / cols);
  const W = cols * THUMB, H = rows * THUMB;
  const atlas = device.createTexture({ label: 'ms-thumbs', size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const enc = device.createCommandEncoder({ label: 'ms-thumbs' });
  const pass = enc.beginRenderPass({ colorAttachments: [{ view: atlas.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.1, g: 0.1, b: 0.12, a: 1 } }] });
  const ubufs = [];
  const header = [stats.lastRes || res, Number(compiled.settings.seed) || 0, Number(compiled.settings.tiling) || 1, time];
  list.forEach((x, i) => {
    const p = pr[i];
    if (!p.pipeline) return;
    const ox = (i % cols) * THUMB, oy = Math.floor(i / cols) * THUMB;
    const u = x.spec.uniforms.slice();
    u.set(header, 0); u.set([ox, oy, THUMB, 0], 4);
    const ubuf = device.createBuffer({ size: u.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(ubuf, 0, u);
    ubufs.push(ubuf);
    const entries = [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: sampler }];
    let ok = true;
    x.spec.textures.forEach((t, j) => {
      let tex = t.kind === 'pass' ? live.results.get(t.pass) : t.kind === 'const' ? getConstTex(t.value) : (imageTex.get(imageKey(t)) || {}).tex || defaultImage;
      if (!tex || Array.isArray(tex)) { ok = false; tex = getConstTex([1, 0, 1, 1]); }
      entries.push({ binding: j + 2, resource: tex.createView({ baseMipLevel: 0, mipLevelCount: 1 }) });
    });
    if (!ok) return;
    pass.setViewport(ox, oy, THUMB, THUMB, 0, 1);
    pass.setScissorRect(ox, oy, THUMB, THUMB);
    pass.setPipeline(p.pipeline);
    pass.setBindGroup(0, device.createBindGroup({ layout: layoutFor(x.spec.textures.length).bgl, entries }));
    pass.draw(3);
  });
  pass.end();
  const bpr = W * 4;
  const buf = device.createBuffer({ size: bpr * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  enc.copyTextureToBuffer({ texture: atlas }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: H }, [W, H]);
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const all = new Uint8ClampedArray(buf.getMappedRange().slice(0));
  buf.unmap(); buf.destroy(); atlas.destroy();
  for (const b of ubufs) b.destroy();
  const ids = [];
  list.forEach((x, i) => {
    if (!pr[i].pipeline) return;
    const ox = (i % cols) * THUMB, oy = Math.floor(i / cols) * THUMB;
    const px = new Uint8ClampedArray(THUMB * THUMB * 4);
    for (let y = 0; y < THUMB; y++) px.set(all.subarray(((oy + y) * W + ox) * 4, ((oy + y) * W + ox + THUMB) * 4), y * THUMB * 4);
    const image = typeof ImageData === 'function' ? new ImageData(px, THUMB, THUMB) : { data: px, width: THUMB, height: THUMB };
    thumbs.set(x.id, { key: x.key, image, out: x.out });
    ids.push(x.id);
  });
  stats.thumbMs = performance.now() - t0;
  if (ids.length) store.emit('bake:thumbs', { ids });
}

// ------------------------------------------------------------ readback
/**
 * Read a texture (mip 0) back to the CPU.
 * @param {GPUTexture} tex  rgba16float, rgba32float or rgba8unorm
 * @param {{format?:'f32'|'rgba8'|'u16'|'half', srgb?:boolean}} [opts]
 * @returns {Promise<{width:number, height:number, data:Float32Array|Uint8ClampedArray|Uint16Array, format:string}>}
 */
export async function readTexture(tex, opts = {}) {
  const w = tex.width, h = tex.height, fmt = tex.format;
  const bpp = fmt === 'rgba32float' ? 16 : fmt === 'rgba16float' ? 8 : 4;
  const bpr = Math.ceil((w * bpp) / 256) * 256;
  const buf = device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex, mipLevel: 0 }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: h }, [w, h]);
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const raw = new Uint8Array(buf.getMappedRange());
  const want = opts.format || 'f32';
  const n = w * h * 4;
  let data;
  if (fmt === 'rgba16float') {
    const halves = new Uint16Array(n);
    for (let y = 0; y < h; y++) halves.set(new Uint16Array(raw.buffer, raw.byteOffset + y * bpr, w * 4), y * w * 4);
    if (want === 'half') data = halves;
    else if (want === 'rgba8' || want === 'u16') {
      luts();
      const eight = want === 'rgba8';
      const out = eight ? new Uint8ClampedArray(n) : new Uint16Array(n);
      const C = opts.srgb ? (eight ? LUT8_SRGB : LUT16_SRGB) : (eight ? LUT8_LIN : LUT16_LIN);
      const A = eight ? LUT8_LIN : LUT16_LIN;
      for (let i = 0; i < n; i += 4) { out[i] = C[halves[i]]; out[i + 1] = C[halves[i + 1]]; out[i + 2] = C[halves[i + 2]]; out[i + 3] = A[halves[i + 3]]; }
      data = out;
    } else {
      data = new Float32Array(n);
      for (let i = 0; i < n; i++) data[i] = F16_TO_F32[halves[i]];
    }
  } else if (fmt === 'rgba32float') {
    const f = new Float32Array(n);
    for (let y = 0; y < h; y++) f.set(new Float32Array(raw.buffer, raw.byteOffset + y * bpr, w * 4), y * w * 4);
    data = f;
  } else {
    const b = new Uint8ClampedArray(n);
    for (let y = 0; y < h; y++) b.set(new Uint8Array(raw.buffer, raw.byteOffset + y * bpr, w * 4), y * w * 4);
    data = b;
  }
  buf.unmap(); buf.destroy();
  return { width: w, height: h, data, format: want };
}

/**
 * Read one baked map. Albedo and emissive get sRGB encoding for 8/16-bit
 * output unless opts.srgb is false.
 * @param {string} mapName  one of MAP_NAMES
 * @param {{format?:'f32'|'rgba8'|'u16'|'half', srgb?:boolean, maps?:object}} [opts]
 */
export async function readback(mapName, opts = {}) {
  const maps = opts.maps || currentMaps;
  if (!maps) throw new Error('no baked maps yet');
  const tex = maps[mapName];
  if (!tex) throw new Error('unknown map ' + mapName);
  const srgb = opts.srgb !== undefined ? opts.srgb : !!(MAP_SLOTS[mapName] && MAP_SLOTS[mapName].srgbOnExport);
  const r = await readTexture(tex, { format: opts.format || 'f32', srgb });
  r.name = mapName; r.srgb = srgb && (r.format === 'rgba8' || r.format === 'u16');
  return r;
}

// ------------------------------------------------------------ bakeOnce
/**
 * Bake the current (or a given) graph at any resolution into a private
 * texture set, for export. The caller owns the result and must call
 * destroy(). Nothing is emitted and the live caches are not touched.
 * @param {number} res
 * @param {{graph?:object, precision?:'half'|'full'}} [opts]
 * @returns {Promise<object>} MaterialMaps plus readback(name, opts) and destroy()
 */
export async function bakeOnce(res, opts = {}) {
  if (!device) throw new Error('no GPU device');
  const state = store.state;
  const g = opts.graph || graphJSON(state, modules);
  const loadErrors = await prepareGraph(g, state.registry);
  const compiled = compileGraph(g, state.registry, { prune: true, maxMRT: maxMRT() });
  compiled.errors.push(...loadErrors);
  compiled.settings = { ...compiled.settings, ...(g.settings || {}) };
  const ctx = { cache: new Map(), results: new Map(), keys: new Map() };
  const inter = opts.precision === 'half' ? 'rgba16float' : opts.precision === 'full' && gpuMod.features.float32Filterable ? 'rgba32float' : interFormat(res);
  const t0 = performance.now();
  const out = await runPasses(compiled, res, ctx, { interFormat: inter });
  if (!out.maps) {
    for (const e of ctx.cache.values()) for (const t of e.texs) t.destroy();
    throw new Error('bake failed: ' + (out.errors[0] || compiled.errors[0] || { message: 'no output' }).message);
  }
  const maps = out.maps;
  maps.ms = performance.now() - t0;
  maps.errors = [...compiled.errors, ...out.errors];
  maps.readback = (name, o = {}) => readback(name, { ...o, maps });
  maps.destroy = () => {
    for (const e of ctx.cache.values()) for (const t of e.texs) t.destroy();
    ctx.cache.clear();
    // An export at another res leaves bench cell textures of that size in
    // the bench pool: release them (the live bake makes its own again).
    if (res !== (stats.lastRes || state.settings.res)) { try { modules?.bench?.trimBench?.(device); } catch (e) {} }
  };
  return maps;
}

// ------------------------------------------------------------ public api
/** Force a full bake of the live graph now. Resolves after bake:done. */
export async function bake(force = true) {
  if (force) clearTimeout(idleTimer);
  pending = { preview: false };
  if (!running) loopP = loop();
  await loopP;   // the loop runs until no request is pending, so this covers ours
  return currentMaps;
}

/** Thumbnail ImageData of a node (cached after each bake). */
export async function thumb(nodeId, opts = {}) {
  const t = thumbs.get(nodeId);
  if (t && (!opts.out || opts.out === t.out)) return t.image;
  const compiled = store.state.compiled;
  if (!compiled || !device) return null;
  const spec = compiled.thumbSpec(nodeId, opts.out);
  if (!spec) return null;
  const p = await getPipeline(spec, ['rgba8unorm']);
  if (!p.pipeline) return null;
  const size = opts.size || THUMB;
  const tex = device.createTexture({ size: [size, size], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const u = spec.uniforms.slice();
  u.set([stats.lastRes || store.state.settings.res, Number(compiled.settings.seed) || 0, Number(compiled.settings.tiling) || 1, time], 0);
  u.set([0, 0, size, 0], 4);
  const ubuf = device.createBuffer({ size: u.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(ubuf, 0, u);
  const entries = [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: sampler }];
  for (const [j, t2] of spec.textures.entries()) {
    let tx = t2.kind === 'pass' ? live.results.get(t2.pass) : t2.kind === 'const' ? getConstTex(t2.value) : (imageTex.get(imageKey(t2)) || {}).tex || defaultImage;
    if (!tx || Array.isArray(tx)) tx = getConstTex([1, 0, 1, 1]);
    entries.push({ binding: j + 2, resource: tx.createView({ baseMipLevel: 0, mipLevelCount: 1 }) });
  }
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(), loadOp: 'clear', storeOp: 'store' }] });
  pass.setPipeline(p.pipeline);
  pass.setBindGroup(0, device.createBindGroup({ layout: layoutFor(spec.textures.length).bgl, entries }));
  pass.draw(3);
  pass.end();
  device.queue.submit([enc.finish()]);
  const r = await readTexture(tex, {});
  tex.destroy(); ubuf.destroy();
  return typeof ImageData === 'function' ? new ImageData(r.data, size, size) : { data: r.data, width: size, height: size };
}

/** Draw a node thumbnail into a new canvas (or null). */
export async function thumbCanvas(nodeId, opts) {
  const img = await thumb(nodeId, opts);
  if (!img) return null;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(img, 0, 0);
  return c;
}

/** Set the bake time (seconds) for Time nodes and re-bake. */
export function setTime(t) { time = Number(t) || 0; schedule('force'); }
/** Intermediate precision: 'auto' (32-bit up to 1024 when filterable), 'half' or 'full'. */
export function setPrecision(p) { precision = ['auto', 'half', 'full'].includes(p) ? p : 'auto'; live.cache.forEach(e => later(() => e.texs.forEach(t => t.destroy()))); live.cache.clear(); schedule('force'); }

// ------------------------------------------------------------ self test
/**
 * Compile and bake every core node type alone and in a chain at 256 px.
 * Collects compile errors, WGSL messages and GPU validation errors.
 * @param {{types?:string[], chain?:boolean, alone?:boolean, res?:number, all?:boolean}} [opts]
 */
export async function selfTest(opts = {}) {
  if (!device) return { ok: false, reason: 'no device' };
  const reg = store.state.registry;
  const res = opts.res || 256;
  const types = opts.types || [...reg.keys()].filter(t => {
    const d = reg.get(t);
    return t !== OUTPUT_TYPE && (d.outputs || []).length && (opts.all || d.source === 'core' || !d.source);
  });
  const fails = [];
  let graphs = 0, passes = 0;
  const t0 = performance.now();
  let uncaptured = 0;
  const onErr = () => { uncaptured++; };
  device.addEventListener('uncapturederror', onErr);
  for (const type of types) {
    const d = reg.get(type);
    for (const chain of [false, true]) {
      if (chain && opts.chain === false) continue;
      if (!chain && opts.alone === false) continue;
      const g = testGraph(type, d, chain);
      const ctx = { cache: new Map(), results: new Map(), keys: new Map() };
      try {
        const le = await prepareGraph(g, reg);
        const c = compileGraph(g, reg, { prune: true, maxMRT: maxMRT() });
        c.errors.push(...le);
        const out = await runPasses(c, res, ctx, { interFormat: 'rgba16float' });
        graphs++; passes += c.passes.length;
        const errs = [...c.errors, ...out.errors];
        if (errs.length || !out.maps) fails.push({ type, chain, errors: errs.map(e => `${e.nodeId || ''}: ${e.message}`).slice(0, 4) });
      } catch (e) { fails.push({ type, chain, errors: ['throw: ' + e.message] }); }
      for (const e of ctx.cache.values()) for (const t of e.texs) t.destroy();
    }
  }
  device.removeEventListener('uncapturederror', onErr);
  return { ok: fails.length === 0 && uncaptured === 0, types: types.length, graphs, passes, uncaptured, failed: fails.length, failures: fails.slice(0, 30), ms: Math.round(performance.now() - t0) };
}

// ------------------------------------------------------------ init
/** @param {object} ctx main.js module context */
export async function init(ctx) {
  store = ctx.store; gpuMod = ctx.gpu; modules = ctx.modules;
  await loadLib();
  const api = {
    bake, bakeOnce, readback, readTexture, thumb, thumbCanvas, thumbs, setTime, setPrecision, selfTest, stats,
    get maps() { return currentMaps; },
    get compiled() { return store.state.compiled; },
    get precision() { return precision; },
    get time() { return time; },
    /** WGSL of pass i of the last compile (debug). */
    wgsl(i) { const c = store.state.compiled; return c && c.passes[i] ? c.passes[i].wgsl : null; },
    PREVIEW_RES, THUMB,
  };
  ctx.register('bake', api);
  if (gpuMod.ok && gpuMod.device) {
    device = gpuMod.device;
    sampler = device.createSampler({ label: 'ms-repeat', addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
    const utilSrc = await (await fetch(new URL('shaders/bake-util.wgsl', import.meta.url))).text();
    utilModule = device.createShaderModule({ label: 'ms-bake-util', code: utilSrc });
    defaultImage = device.createTexture({ label: 'ms-image-default', size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: defaultImage }, new Uint8Array([128, 128, 128, 255]), { bytesPerRow: 4 }, [1, 1]);
    gpuMod.onTeardown(() => {
      gen++; pending = null; clearTimeout(idleTimer);
      for (const e of live.cache.values()) for (const t of e.texs) { try { t.destroy(); } catch (x) {} }
      live.cache.clear();
    });
  }
  store.on('graph:changed', p => schedule(p && p.reason));
  store.on('res:changed', () => schedule('res'));
}
