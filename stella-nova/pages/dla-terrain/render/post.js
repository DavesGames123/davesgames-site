// ============================================================================
//  DLA TERRAIN  ·  render/post.js — the post chain (package CORE)
// ----------------------------------------------------------------------------
//  createPost(gpu) -> post
//    post.resize(w, h, outW, outH)   render size and swap chain size (px)
//    post.run(encoder, src, out)     src = { hdrView, depthView }, out = the
//                                    swap chain view. Passes (shaders/post.wgsl):
//      1 TAA resolve into the history ping-pong (or a copy when TAA is off)
//      2 log luminance 256 x 256 -> 1 x 1, then the eased exposure 1 x 1
//      3 bloom: dual filter down 6 levels, up with additive blend
//      4 composite (AgX, grade, vignette, grain) to the swap chain, or to
//        an LDR target and then FXAA when TAA is off
//    post.settings                   { bloom, ev, key, adapt, vignette, grain,
//                                      contrast, saturation, taa, taaWeight,
//                                      minExp, maxExp, wb[3], manualExposure,
//                                      lift[3], gain[3], power }
//    post.jitter(frame) -> [jx, jy]  Halton 2,3 sub-pixel offset (px)
//    post.exposure                   the last exposure read back (async)
//    post.resetHistory()             after a cut: no history next frame
//  grep -n targets: "export async function createPost", "function run",
//  "export function halton", "export const POST_DEFAULTS", "function readback"
// ============================================================================

export const POST_DEFAULTS = Object.freeze({
  bloom: 0.04, ev: 0, key: 0.16, adapt: 0.6, vignette: 0.32, grain: 0.022,
  contrast: 1.06, saturation: 1.2, taa: true, taaWeight: 0.1,
  minExp: 0.004, maxExp: 40, wb: [1, 1, 1], manualExposure: 0,
  lift: [0.0, 0.004, 0.012], gain: [1.0, 0.99, 0.97], power: 1.15,
});

// the exposure for the bloom clamp: the last readback (or the manual
// exposure), inside the auto exposure limits
function bloomExposure(e, s) {
  const v = s.manualExposure > 0 ? s.manualExposure : e;
  return Math.min(Math.max(Number.isFinite(v) ? v : 1, s.minExp), s.maxExp) * Math.pow(2, s.ev || 0);
}

// JS twin of fs_expo (shaders/post.wgsl), for the tests: the exposure of
// the next frame from the last one, the mean log2 luminance and dt. The
// target key / 2^avg is clamped to [minExp, maxExp]; a brighter scene
// (target down) adapts at 1.6 x adapt per s, a darker one at 0.6 x.
export function exposureStep(prev, avgLog2, dt, s = POST_DEFAULTS) {
  const tgt = Math.min(Math.max(s.key / Math.pow(2, avgLog2), s.minExp), s.maxExp);
  if (!(prev > 0)) return tgt;
  const rate = tgt < prev ? s.adapt * 1.6 : s.adapt * 0.6;
  return Math.exp(Math.log(prev) + (Math.log(tgt) - Math.log(prev)) * (1 - Math.exp(-dt * rate)));
}

export function halton(i, b) {
  let f = 1, r = 0;
  while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); }
  return r;
}
export function jitterAt(frame) {
  const k = (frame % 8) + 1;
  return [halton(k, 2) - 0.5, halton(k, 3) - 0.5];
}

const BLOOM_LEVELS = 6, LUM = 256;

export async function createPost(gpu) {
  const device = gpu.device, U = GPUTextureUsage;
  const code = await gpu.loadWGSL('shaders/post.wgsl');
  const mod = device.createShaderModule({ label: 'post', code });
  const F = GPUShaderStage.FRAGMENT;
  const layout1 = device.createBindGroupLayout({
    label: 'post',
    entries: [
      { binding: 0, visibility: F, buffer: { type: 'uniform' } },
      { binding: 1, visibility: F, texture: { sampleType: 'float' } },
      { binding: 2, visibility: F, texture: { sampleType: 'float' } },
      { binding: 3, visibility: F, texture: { sampleType: 'depth' } },
      { binding: 4, visibility: F, sampler: { type: 'filtering' } },
      { binding: 5, visibility: F, texture: { sampleType: 'float' } },
    ],
  });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, layout1] });
  const pipes = {};
  const mk = async (name, entry, format, blend) => {
    pipes[name] = await device.createRenderPipelineAsync({
      label: 'post ' + name, layout: pl,
      vertex: { module: mod, entryPoint: 'vs_post' },
      fragment: { module: mod, entryPoint: entry, targets: [{ format, ...(blend ? { blend } : {}) }] },
      primitive: { topology: 'triangle-list' },
    });
  };
  const add = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };
  await Promise.all([
    mk('taa', 'fs_taa', 'rgba16float'), mk('copy', 'fs_copy', 'rgba16float'),
    mk('lum', 'fs_lum', 'rg16float'), mk('down2', 'fs_down2', 'rg16float'),
    mk('expo', 'fs_expo', 'rgba16float'),
    mk('bdown', 'fs_bdown', 'rgba16float'), mk('bup', 'fs_bup', 'rgba16float', add),
    mk('composite', 'fs_composite', gpu.canvasFormat), mk('compositeLdr', 'fs_composite', 'rgba8unorm'),
    mk('fxaa', 'fs_fxaa', gpu.canvasFormat),
  ]);
  const ubuf = device.createBuffer({ label: 'PostU', size: 7 * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const uf = new Float32Array(28);
  const dummy = device.createTexture({ size: [1, 1], format: 'rgba16float', usage: U.TEXTURE_BINDING });
  const dummyD = device.createTexture({ size: [1, 1], format: 'depth32float', usage: U.TEXTURE_BINDING | U.RENDER_ATTACHMENT });
  const dv = dummy.createView(), ddv = dummyD.createView();

  const post = {
    settings: { ...POST_DEFAULTS, wb: [...POST_DEFAULTS.wb], lift: [...POST_DEFAULTS.lift], gain: [...POST_DEFAULTS.gain] },
    exposure: 1, w: 0, h: 0, outW: 0, outH: 0, historyValid: false, frame: 0,
  };
  let T = null;
  // luminance chain: 256 -> 1 (9 levels), separate textures
  const lum = [];
  for (let s = LUM; s >= 1; s >>= 1) lum.push(device.createTexture({ label: 'lum ' + s, size: [s, s], format: 'rg16float', usage: U.RENDER_ATTACHMENT | U.TEXTURE_BINDING }));
  const lumV = lum.map(t => t.createView());
  const expo = [0, 1].map(i => device.createTexture({ label: 'exposure ' + i, size: [1, 1], format: 'rgba16float', usage: U.RENDER_ATTACHMENT | U.TEXTURE_BINDING | U.COPY_SRC }));
  const expoV = expo.map(t => t.createView());
  let expoIdx = 0;
  const rb = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  let rbBusy = false;

  const bg = (a, b, d, c) => device.createBindGroup({
    layout: layout1,
    entries: [
      { binding: 0, resource: { buffer: ubuf } },
      { binding: 1, resource: a || dv }, { binding: 2, resource: b || dv }, { binding: 3, resource: d || ddv },
      { binding: 4, resource: gpu.sLinear }, { binding: 5, resource: c || dv },
    ],
  });

  post.resize = (w, h, outW, outH) => {
    if (T && w === post.w && h === post.h && outW === post.outW && outH === post.outH) return;
    if (T) for (const t of T.all) t.destroy();
    post.w = w; post.h = h; post.outW = outW; post.outH = outH;
    const all = [];
    const tex = (label, W, H, format) => { const t = device.createTexture({ label, size: [Math.max(1, W), Math.max(1, H)], format, usage: U.RENDER_ATTACHMENT | U.TEXTURE_BINDING }); all.push(t); return t; };
    const hist = [tex('taa 0', w, h, 'rgba16float'), tex('taa 1', w, h, 'rgba16float')];
    const bloom = [];
    let bw = w >> 1, bh = h >> 1;
    for (let i = 0; i < BLOOM_LEVELS; i++) { bloom.push(tex('bloom ' + i, bw, bh, 'rgba16float')); bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1); }
    const ldr = tex('ldr', outW, outH, 'rgba8unorm');
    T = { all, hist, histV: hist.map(t => t.createView()), bloom, bloomV: bloom.map(t => t.createView()), ldr, ldrV: ldr.createView(), idx: 0 };
    post.historyValid = false;
    T.groups = null;
  };
  post.resetHistory = () => { post.historyValid = false; };
  post.jitter = frame => (post.settings.taa ? jitterAt(frame) : [0, 0]);

  function writeUniform(dt) {
    const s = post.settings;
    uf.set([s.bloom, s.ev, s.key, s.adapt,
      s.vignette, s.grain, s.contrast, s.saturation,
      s.taaWeight, post.historyValid ? 1 : 0, s.minExp, s.maxExp,
      s.wb[0], s.wb[1], s.wb[2], s.manualExposure,
      s.lift[0], s.lift[1], s.lift[2], dt,
      s.gain[0], s.gain[1], s.gain[2], s.power,
      1 / BLOOM_LEVELS, bloomExposure(post.exposure, s), post.outW, post.outH]);
    device.queue.writeBuffer(ubuf, 0, uf);
  }
  function fsPass(enc, view, pipe, group, load) {
    const p = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: load ? 'load' : 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    p.setPipeline(pipe); p.setBindGroup(0, gpu.globalsBindGroup); p.setBindGroup(1, group); p.draw(3); p.end();
  }

  function readback() {
    if (rbBusy) return;
    rbBusy = true;
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: expo[expoIdx] }, { buffer: rb, bytesPerRow: 256 }, [1, 1]);
    device.queue.submit([enc.finish()]);
    rb.mapAsync(GPUMapMode.READ).then(() => {
      const u = new Uint16Array(rb.getMappedRange().slice(0, 8));
      rb.unmap();
      const e = half(u[0]);
      if (e > 0 && Number.isFinite(e)) post.exposure = e;
      rbBusy = false;
    }).catch(() => { rbBusy = false; });
  }

  // src = { hdrView, depthView, key } (key changes when the targets change)
  post.run = (enc, src, outView, dt) => {
    post.frame++;
    writeUniform(dt);
    const s = post.settings;
    // the groups depend on the source views; rebuild when they change
    if (!T.groups || T.groups.key !== src.key || T.groups.gb !== gpu.globalsBindGroup) {
      const g = { key: src.key, gb: gpu.globalsBindGroup };
      g.taa = [0, 1].map(i => bg(src.hdrView, T.histV[1 - i], src.depthView));
      g.lum = [0, 1].map(i => bg(T.histV[i]));
      g.down = lumV.slice(0, -1).map(v => bg(v));
      g.expo = [0, 1].map(i => bg(lumV[lumV.length - 1], expoV[1 - i]));
      // the bloom reads the exposure of this frame (expoV[e], tC)
      g.bdown = [0, 1].map(i => [0, 1].map(e => [bg(T.histV[i], null, null, expoV[e]), ...T.bloomV.slice(0, -1).map(v => bg(v, null, null, expoV[e]))]));
      g.bup = T.bloomV.slice(1).map(v => bg(v));
      g.comp = [0, 1].map(i => [0, 1].map(e => bg(T.histV[i], T.bloomV[0], null, expoV[e])));
      g.fxaa = bg(T.ldrV);
      T.groups = g;
    }
    const g = T.groups;
    const i = T.idx;            // write the history i, read 1 - i
    fsPass(enc, T.histV[i], s.taa ? pipes.taa : pipes.copy, g.taa[i]);
    // exposure
    fsPass(enc, lumV[0], pipes.lum, g.lum[i]);
    for (let k = 1; k < lumV.length; k++) fsPass(enc, lumV[k], pipes.down2, g.down[k - 1]);
    const e = expoIdx;          // write e, read 1 - e
    fsPass(enc, expoV[e], pipes.expo, g.expo[e]);
    // bloom
    for (let k = 0; k < BLOOM_LEVELS; k++) fsPass(enc, T.bloomV[k], pipes.bdown, g.bdown[i][e][k]);
    for (let k = BLOOM_LEVELS - 2; k >= 0; k--) fsPass(enc, T.bloomV[k], pipes.bup, g.bup[k], true);
    // composite
    if (s.taa) fsPass(enc, outView, pipes.composite, g.comp[i][e]);
    else { fsPass(enc, T.ldrV, pipes.compositeLdr, g.comp[i][e]); fsPass(enc, outView, pipes.fxaa, g.fxaa); }
    T.idx = 1 - i;
    expoIdx = 1 - e;
    post.historyValid = true;
    post._afterSubmit = (post.frame % 15 === 0) ? readback : null;
  };
  post.afterSubmit = () => { if (post._afterSubmit) post._afterSubmit(); };
  post.dispose = () => { if (T) for (const t of T.all) t.destroy(); for (const t of lum) t.destroy(); for (const t of expo) t.destroy(); ubuf.destroy(); };
  return post;
}

// IEEE half to float
export function half(h) {
  const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}
