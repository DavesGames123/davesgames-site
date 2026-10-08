// ============================================================================
//  GALAXY  ·  engine.js — the WebGPU renderer (no DOM: Deno can run it)
// ----------------------------------------------------------------------------
//  Per frame:
//    volume     shaders/volume.wgsl   ray-marched light and dust -> volTex
//                                     (low res, rgba16float)
//    stars      shaders/stars.wgsl    instanced sprites, additive -> starTex
//                                     (render res, rgba16float)
//    bloom      shaders/post.wgsl     down0, down x L-1, up x L-1 (additive)
//    exposure   shaders/post.wgsl     1x1 log-average, eased (ping-pong)
//    composite  shaders/post.wgsl     mix, exposure, ACES, sRGB -> canvas
//  At start, shaders/noise.wgsl fills the 3D noise tile (compute).
//  common.wgsl is put in front of volume.wgsl and stars.wgsl.
//
//  API (grep -n "^  [a-zA-Z]*(" engine.js)
//    const E = await createEngine({ canvas | device+format, mobile })
//    E.setGalaxy(built)       built = model.buildGalaxy(...)
//    E.resize(budget)         budget = budget.galaxyBudget(...)
//    E.render(frame, view?)   frame: see "function render"; view: a
//                             GPUTextureView to draw into (Deno); else the
//                             canvas
//    E.destroy()
//    E.onLost = info => {}
// ============================================================================
import { GAL_FLOATS, OFF, STAR_FLOATS, patternSpeed } from './model.js';
import { NOISE_N, bloomLevels } from './budget.js';

const HDR = 'rgba16float';
async function text(rel) {
  const r = await fetch(new URL(rel, import.meta.url));
  if (!r.ok) throw new Error(`fetch ${rel}: ${r.status}`);
  return r.text();
}
async function compile(device, code, label) {
  device.pushErrorScope('validation');
  const module = device.createShaderModule({ code, label });
  const info = module.getCompilationInfo ? await module.getCompilationInfo() : { messages: [] };
  const err = await device.popErrorScope();
  const msgs = info.messages.filter(m => m.type === 'error');
  if (msgs.length || err) throw new Error(`${label}: ` + (msgs.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ') || err.message));
  return module;
}

export async function createEngine({ canvas = null, device = null, format = null, mobile = false } = {}) {
  if (!device) {
    if (typeof navigator === 'undefined' || !navigator.gpu) throw new Error('webgpu-unavailable');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: mobile ? 'low-power' : 'high-performance' });
    if (!adapter) throw new Error('webgpu-unavailable');
    device = await adapter.requestDevice();
  }
  let context = null;
  if (canvas) {
    context = canvas.getContext('webgpu');
    format = format || navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
  }
  format = format || 'rgba8unorm';

  const [common, volSrc, starSrc, postSrc, noiseSrc] = await Promise.all(['shaders/common.wgsl', 'shaders/volume.wgsl', 'shaders/stars.wgsl', 'shaders/post.wgsl', 'shaders/noise.wgsl'].map(text));
  const [volM, starM, postM, noiseM] = await Promise.all([
    compile(device, common + '\n' + volSrc, 'volume'),
    compile(device, common + '\n' + starSrc, 'stars'),
    compile(device, postSrc, 'post'),
    compile(device, noiseSrc, 'noise'),
  ]);

  // ── noise tile ──
  const noiseTex = device.createTexture({ size: [NOISE_N, NOISE_N, NOISE_N], dimension: '3d', format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  {
    const pipe = device.createComputePipeline({ layout: 'auto', compute: { module: noiseM, entryPoint: 'main', constants: { N: NOISE_N } } });
    const bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: noiseTex.createView() }] });
    const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
    pass.setPipeline(pipe); pass.setBindGroup(0, bg);
    const g = Math.ceil(NOISE_N / 4); pass.dispatchWorkgroups(g, g, g); pass.end();
    device.queue.submit([enc.finish()]);
  }
  const repeat = device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat', magFilter: 'linear', minFilter: 'linear' });
  const clampS = device.createSampler({ addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', magFilter: 'linear', minFilter: 'linear' });

  // ── buffers ──
  const UNI_FLOATS = 9 * 4;
  const uniBuf = device.createBuffer({ size: UNI_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const galBuf = device.createBuffer({ size: GAL_FLOATS * 2 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const uni = new Float32Array(UNI_FLOATS);
  let gals = new Float32Array(GAL_FLOATS * 2), nGal = 1, starBuf = null, starCount = 0, starCap = 0;

  // ── pipelines ──
  const volPipe = device.createRenderPipeline({
    layout: 'auto', vertex: { module: volM, entryPoint: 'vs' },
    fragment: { module: volM, entryPoint: 'fs', targets: [{ format: HDR }] }, primitive: { topology: 'triangle-list' },
  });
  const add = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };
  const starPipe = device.createRenderPipeline({
    layout: 'auto', vertex: { module: starM, entryPoint: 'vs' },
    fragment: { module: starM, entryPoint: 'fs', targets: [{ format: HDR, blend: add }] }, primitive: { topology: 'triangle-list' },
  });
  const g0 = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
  ] });
  const g1 = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
  ] });
  const postL1 = device.createPipelineLayout({ bindGroupLayouts: [g0] });
  const postL2 = device.createPipelineLayout({ bindGroupLayouts: [g0, g1] });
  const post = (entry, fmt, blend, layout = postL1) => device.createRenderPipeline({
    layout, vertex: { module: postM, entryPoint: 'vs' },
    fragment: { module: postM, entryPoint: entry, targets: [blend ? { format: fmt, blend } : { format: fmt }] }, primitive: { topology: 'triangle-list' },
  });
  const P = { down0: post('down0', HDR), down: post('down', HDR), up: post('up', HDR, add), expo: post('expo', HDR), comp: post('composite', format, null, postL2) };

  const volBG = () => device.createBindGroup({ layout: volPipe.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: uniBuf } }, { binding: 1, resource: { buffer: galBuf } },
    { binding: 2, resource: noiseTex.createView() }, { binding: 3, resource: repeat }] });
  const volBind = volBG();
  let starBind = null;

  // ── size-dependent resources ──
  let T = null;
  const expoTex = [0, 1].map(() => device.createTexture({ size: [1, 1], format: HDR, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC }));
  let expoI = 0, firstExpo = true;
  const postBuf = [];
  function ubuf(i) { if (!postBuf[i]) postBuf[i] = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); return postBuf[i]; }
  const bg0 = (i, a, b) => device.createBindGroup({ layout: g0, entries: [
    { binding: 0, resource: { buffer: ubuf(i) } }, { binding: 1, resource: clampS },
    { binding: 2, resource: a.createView() }, { binding: 3, resource: b.createView() }] });

  function resize(b) {
    if (T && T.w === b.w && T.h === b.h && T.vw === b.vw && T.vh === b.vh) { T.steps = b.steps; T.detail = b.detail; return; }
    if (T) { T.star.destroy(); T.vol.destroy(); T.bloom.forEach(t => t.destroy()); }
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
    const star = device.createTexture({ size: [b.w, b.h], format: HDR, usage });
    const vol = device.createTexture({ size: [b.vw, b.vh], format: HDR, usage });
    const lv = bloomLevels(b.w, b.h);
    const bloom = lv.map(([x, y]) => device.createTexture({ size: [x, y], format: HDR, usage }));
    // pass list: uniform slot, bind group
    const passes = { down: [], up: [] };
    passes.down0 = { u: 0, bg: bg0(0, star, vol), texel: [1 / b.w, 1 / b.h] };
    for (let i = 1; i < lv.length; i++) passes.down.push({ u: i, bg: bg0(i, bloom[i - 1], vol), dst: i, texel: [1 / lv[i - 1][0], 1 / lv[i - 1][1]] });
    for (let i = lv.length - 1; i >= 1; i--) passes.up.push({ u: 10 + i, bg: bg0(10 + i, bloom[i], vol), dst: i - 1, texel: [1 / lv[i][0], 1 / lv[i][1]] });
    passes.expo = [0, 1].map(k => ({ u: 20 + k, bg: bg0(20 + k, bloom[lv.length - 1], expoTex[1 - k]), dst: k }));
    passes.comp = { u: 22, bg: bg0(22, star, vol), bg1: [0, 1].map(k => device.createBindGroup({ layout: g1, entries: [{ binding: 0, resource: bloom[0].createView() }, { binding: 1, resource: expoTex[k].createView() }] })) };
    T = { w: b.w, h: b.h, vw: b.vw, vh: b.vh, steps: b.steps, detail: b.detail, star, vol, bloom, lv, passes };
    firstExpo = true;
  }

  function setGalaxy(built) {
    gals = new Float32Array(GAL_FLOATS * 2);
    gals.set(built.gals.subarray(0, GAL_FLOATS * built.nGal));
    nGal = built.nGal;
    starCount = built.count;
    const bytes = Math.max(64, starCount * STAR_FLOATS * 4);
    if (!starBuf || bytes > starCap) {
      if (starBuf) starBuf.destroy();
      starCap = Math.ceil(bytes * 1.15 / 64) * 64;
      starBuf = device.createBuffer({ size: starCap, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      starBind = device.createBindGroup({ layout: starPipe.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: uniBuf } }, { binding: 1, resource: { buffer: galBuf } },
        { binding: 2, resource: { buffer: starBuf } }, { binding: 3, resource: noiseTex.createView() }, { binding: 4, resource: repeat }] });
    }
    device.queue.writeBuffer(starBuf, 0, built.stars.buffer, built.stars.byteOffset, starCount * STAR_FLOATS * 4);
    firstExpo = true;
  }

  // frame = { cam: {eye, right, up, fwd, tanHalf, aspect}, off: [x, y],
  //   time (Myr), wall (s), frame, exposure, bloom, starGain, twinkle,
  //   sbRef, skyGain, autoKey, autoRate, peakClamp, vignette, snapExposure }
  function render(f, view = null) {
    if (!T || !starBind) return;
    const c = f.cam;
    const put = (i, a, b, cc, d) => { uni[i * 4] = a; uni[i * 4 + 1] = b; uni[i * 4 + 2] = cc; uni[i * 4 + 3] = d; };
    put(0, c.eye[0], c.eye[1], c.eye[2], f.time);
    put(1, c.right[0], c.right[1], c.right[2], c.tanHalf * c.aspect);
    put(2, c.up[0], c.up[1], c.up[2], c.tanHalf);
    put(3, c.fwd[0], c.fwd[1], c.fwd[2], nGal);
    put(4, f.off ? f.off[0] : 0, f.off ? f.off[1] : 0, f.frame || 0, T.steps);
    put(5, T.w, T.h, T.vw, T.vh);
    put(6, 1, f.bloom ?? 0.06, f.starGain ?? 1, f.twinkle ?? 1);
    put(7, f.sbRef || 1e-3, f.skyGain ?? 1, f.autoKey ?? 0.11, f.autoRate ?? 0.05);
    put(8, f.detail ?? T.detail, f.peakClamp ?? 400, f.wall || 0, 0);
    device.queue.writeBuffer(uniBuf, 0, uni);
    for (let g = 0; g < nGal; g++) gals[g * GAL_FLOATS + OFF.phase] = patternSpeed(gals, g) * f.time;
    device.queue.writeBuffer(galBuf, 0, gals);

    const pu = (slot, texel, mix = 1) => device.queue.writeBuffer(ubuf(slot), 0, new Float32Array([texel[0], texel[1], mix, 0, f.exposure ?? 1, f.bloom ?? 0.06, f.autoKey ?? 0.11, (firstExpo || f.snapExposure) ? 1 : (f.autoRate ?? 0.05), f.frame || 0, 0, f.vignette ?? 0.35, T.lv.length]));
    const S = T.passes;
    pu(S.down0.u, S.down0.texel);
    S.down.forEach(p => pu(p.u, p.texel));
    S.up.forEach(p => pu(p.u, p.texel));
    S.expo.forEach(p => pu(p.u, [0, 0]));
    pu(S.comp.u, [1 / T.w, 1 / T.h]);

    const enc = device.createCommandEncoder();
    const clear = { r: 0, g: 0, b: 0, a: 1 };
    const pass = (tex, load = 'clear', v = null) => enc.beginRenderPass({ colorAttachments: [{ view: v || tex.createView(), loadOp: load, storeOp: 'store', clearValue: clear }] });
    let p = pass(T.vol); p.setPipeline(volPipe); p.setBindGroup(0, volBind); p.draw(3); p.end();
    p = pass(T.star); p.setPipeline(starPipe); p.setBindGroup(0, starBind); if (starCount) p.draw(6, starCount); p.end();
    p = pass(T.bloom[0]); p.setPipeline(P.down0); p.setBindGroup(0, S.down0.bg); p.draw(3); p.end();
    for (const d of S.down) { p = pass(T.bloom[d.dst]); p.setPipeline(P.down); p.setBindGroup(0, d.bg); p.draw(3); p.end(); }
    for (const u of S.up) { p = pass(T.bloom[u.dst], 'load'); p.setPipeline(P.up); p.setBindGroup(0, u.bg); p.draw(3); p.end(); }
    expoI = 1 - expoI;
    const ex = S.expo[expoI];
    p = pass(expoTex[expoI]); p.setPipeline(P.expo); p.setBindGroup(0, ex.bg); p.draw(3); p.end();
    const out = view || context.getCurrentTexture().createView();
    p = pass(null, 'clear', out); p.setPipeline(P.comp); p.setBindGroup(0, S.comp.bg); p.setBindGroup(1, S.comp.bg1[expoI]); p.draw(3); p.end();
    device.queue.submit([enc.finish()]);
    firstExpo = false;
  }

  const E = {
    device, format,
    onLost: null,
    get count() { return starCount; },
    get targets() { return T; },
    expoTex,
    resize, setGalaxy, render,
    destroy() { try { device.destroy(); } catch (e) {} },
  };
  device.lost.then(info => { if (E.onLost) E.onLost(info); });
  return E;
}
