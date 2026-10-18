// ============================================================================
//  DLA TERRAIN  ·  render/ao.js — screen-space ambient occlusion (NEAR)
// ----------------------------------------------------------------------------
//  createAO(gpu) -> ao = { prep(enc, frame, ctx), draw(pass, frame, ctx),
//                          plan(frame), stats(), setEnabled(on), dispose() }
//  render/ground.js owns one and calls it from its volumetricPrep and
//  drawVolumetric hooks (gpu/frame.js pass 6), so the AO covers every
//  opaque surface (ground, plants, rocks) and goes on before SKY's haze.
//    prep  after the water pass: cs_ao at half size into texture A, then
//          the bilateral blur A -> B -> A (shaders/ao.wgsl).
//    draw  in the volumetric pass: fs_apply multiplies the HDR target by
//          the upsampled AO (blend dst x src). No depth attachment.
//  aoPlan(frame, profile, profileId) -> { on, radius, strength, maxPx, fadeStart,
//  fadeEnd }: off on a phone profile, under quality 0.5 (no TAA to resolve
//  the noise) and at governor level 2 and up (TAA off). The cost does not
//  depend on the zoom: a fixed 16 depth loads (+ 4 for the normal) per
//  half-size pixel, 2 x 8 for the blur, 6 per full-size pixel.
//  Memory: two rgba16float targets at half size (1280 x 800: 4 MB).
//
//  grep -n targets: "export function aoPlan", "export async function createAO",
//  "function targets", "prep(", "draw("
// ============================================================================

export const AO_RADIUS = 1.1;        // m: the reach of the occlusion
export const AO_STRENGTH = 0.85;
export const AO_MAX_PX = 56;         // full-size px: the largest screen radius
export const AO_FADE = [90, 160];    // m: the AO fades out over this range

export function aoPlan(frame = {}, profile = null, profileId = '') {
  const q = frame.quality ?? 0.75;
  const pf = profile || {};
  const phone = pf.taa === false || /^phone/.test(profileId || pf.id || '');
  const on = !phone && q >= 0.5 && (frame.govLevel | 0) < 2 && frame.ao !== false;
  return { on, radius: AO_RADIUS, strength: AO_STRENGTH * (q >= 0.75 ? 1 : 0.85), maxPx: AO_MAX_PX, fadeStart: AO_FADE[0], fadeEnd: AO_FADE[1] };
}

export async function createAO(gpu) {
  const device = gpu.device, queue = gpu.queue;
  const code = await gpu.loadWGSL(new URL('../shaders/ao.wgsl', import.meta.url).href);
  const mod = device.createShaderModule({ label: 'ao', code });
  const C = GPUShaderStage.COMPUTE, F = GPUShaderStage.FRAGMENT;
  const csL = device.createBindGroupLayout({ label: 'ao compute', entries: [
    { binding: 0, visibility: C, buffer: { type: 'uniform' } },
    { binding: 1, visibility: C, texture: { sampleType: 'depth' } },
    { binding: 2, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
    { binding: 3, visibility: C, texture: { sampleType: 'unfilterable-float' } },
  ] });
  const fsL = device.createBindGroupLayout({ label: 'ao apply', entries: [
    { binding: 0, visibility: F, buffer: { type: 'uniform' } },
    { binding: 1, visibility: F, texture: { sampleType: 'depth' } },
    { binding: 3, visibility: F, texture: { sampleType: 'unfilterable-float' } },
    { binding: 4, visibility: F, texture: { sampleType: 'depth' } },
  ] });
  const plC = device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, csL] });
  const plF = device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, fsL] });
  const cp = (e) => device.createComputePipelineAsync({ label: 'ao ' + e, layout: plC, compute: { module: mod, entryPoint: e } });
  const [pAO, pH, pV, pApply] = await Promise.all([cp('cs_ao'), cp('cs_blurH'), cp('cs_blurV'),
    device.createRenderPipelineAsync({ label: 'ao apply', layout: plF,
      vertex: { module: mod, entryPoint: 'vs_apply' },
      fragment: { module: mod, entryPoint: 'fs_apply', targets: [{ format: gpu.hdrFormat,
        blend: { color: { srcFactor: 'zero', dstFactor: 'src', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } } }] },
      primitive: { topology: 'triangle-list' } })]);
  const uBuf = device.createBuffer({ label: 'ao params', size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const u = new Float32Array(8);
  let T = null, ran = false, plan = { on: false }, enabled = true;
  const st = { w: 0, h: 0, bytes: 0, on: false };

  function targets(w, h, ctx) {
    const hw = Math.max(1, Math.ceil(w / 2)), hh = Math.max(1, Math.ceil(h / 2));
    if (T && T.hw === hw && T.hh === hh && T.depthView === ctx.depthView && T.preView === ctx.sceneDepthView) return T;
    if (T && (T.hw !== hw || T.hh !== hh)) { T.a.destroy(); T.b.destroy(); T = null; }
    const mk = (l) => device.createTexture({ label: l, size: [hw, hh], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    const a = T ? T.a : mk('ao A'), b = T ? T.b : mk('ao B');
    const av = a.createView(), bv = b.createView();
    const bg = (out, inn) => device.createBindGroup({ layout: csL, entries: [
      { binding: 0, resource: { buffer: uBuf } }, { binding: 1, resource: ctx.depthView },
      { binding: 2, resource: out }, { binding: 3, resource: inn }] });
    T = { hw, hh, a, b, depthView: ctx.depthView, preView: ctx.sceneDepthView,
      bgAO: bg(av, bv), bgH: bg(bv, av), bgV: bg(av, bv),
      bgF: device.createBindGroup({ layout: fsL, entries: [
        { binding: 0, resource: { buffer: uBuf } }, { binding: 1, resource: ctx.depthView },
        { binding: 3, resource: av }, { binding: 4, resource: ctx.sceneDepthView || ctx.depthView }] }) };
    st.w = hw; st.h = hh; st.bytes = hw * hh * 8 * 2;
    return T;
  }

  return {
    plan: (frame) => aoPlan(frame, gpu.profile, gpu.profileId),
    prep(enc, frame, ctx) {
      ran = false;
      plan = aoPlan(frame, gpu.profile, gpu.profileId);
      plan.on = plan.on && enabled;
      st.on = plan.on;
      if (!plan.on || !ctx || !ctx.depthView || !gpu.globalsBindGroup) return;
      const t = targets(ctx.width || 16, ctx.height || 16, ctx);
      u.set([plan.radius, plan.strength, plan.maxPx, (frame.frameIndex | 0) % 4096, plan.fadeStart, plan.fadeEnd, 0.002, 0]);
      queue.writeBuffer(uBuf, 0, u);
      const c = enc.beginComputePass({ label: 'ao' });
      c.setBindGroup(0, gpu.globalsBindGroup);
      const gx = Math.ceil(t.hw / 8), gy = Math.ceil(t.hh / 8);
      c.setPipeline(pAO); c.setBindGroup(1, t.bgAO); c.dispatchWorkgroups(gx, gy);
      c.setPipeline(pH); c.setBindGroup(1, t.bgH); c.dispatchWorkgroups(gx, gy);
      c.setPipeline(pV); c.setBindGroup(1, t.bgV); c.dispatchWorkgroups(gx, gy);
      c.end();
      ran = true;
    },
    draw(pass) {
      if (!ran || !T) return;
      pass.setPipeline(pApply);
      pass.setBindGroup(0, gpu.globalsBindGroup);
      pass.setBindGroup(1, T.bgF);
      pass.draw(3);
    },
    stats: () => ({ ...st }),
    // tests and A/B checks: AO off
    setEnabled(on) { enabled = !!on; },
    dispose() { if (T) { T.a.destroy(); T.b.destroy(); } uBuf.destroy(); },
  };
}
