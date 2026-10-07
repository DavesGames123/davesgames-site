// tracers.js — one set of streak lines (shaders/tracers.wgsl moves them,
// shaders/lines.wgsl draws them). renderer.js makes one set for the ocean
// overlay and one for the wind overlay. No DOM.
//
// createTracers(device, ctx, opts) -> tracers
//   ctx   { layouts: { scene, overlay, tCompute, tRender }, code: { common,
//           tracers, lines }, format, depthFormat, sampleCount }
//   opts  { mode: 0 ocean | 1 wind, max, K, label }
//   tracers.update(enc, sceneGroup, overlayGroup, p)   p = { count, nInner,
//           dt, speedup, lift, lineW, alpha, innerR, outerR, colourTop, lifeS }
//   tracers.draw(pass, sceneGroup, overlayGroup)
//   tracers.reseed()   all particles born again on the next update
// The ring head moves 20 times a second (HEAD_HZ), so a trail of K points
// shows the last K / 20 s at any display refresh rate; between moves the
// newest point slides with its particle.
//
// grep: function createTracers  HEAD_HZ  update(  draw(

const HEAD_HZ = 20;

export async function createTracers(device, ctx, opts) {
  const max = opts.max, K = opts.K || 24;
  const U = GPUBufferUsage;
  const parts = device.createBuffer({ size: max * 16, usage: U.STORAGE, label: opts.label + 'Parts' });
  const trail = device.createBuffer({ size: max * K * 16, usage: U.STORAGE, label: opts.label + 'Trail' });
  const ubuf = device.createBuffer({ size: 64, usage: U.UNIFORM | U.COPY_DST, label: opts.label + 'U' });
  const raw = new ArrayBuffer(64), f32 = new Float32Array(raw), u32 = new Uint32Array(raw);

  const cm = device.createShaderModule({ code: ctx.code.common + '\n' + ctx.code.tracers, label: opts.label + 'Advect' });
  const rm = device.createShaderModule({ code: ctx.code.common + '\n' + ctx.code.lines, label: opts.label + 'Lines' });
  for (const m of [cm, rm]) {
    const info = await m.getCompilationInfo();
    const errs = info.messages.filter((x) => x.type === 'error');
    if (errs.length) throw new Error(`${m.label}: ` + errs.map((e) => `${e.lineNum}:${e.linePos} ${e.message}`).join('; '));
  }
  const L = ctx.layouts;
  const [pAdv, pLine] = await Promise.all([
    device.createComputePipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [L.scene, L.overlay, L.tCompute] }),
      compute: { module: cm, entryPoint: 'advect' },
    }),
    device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [L.scene, L.overlay, L.tRender] }),
      vertex: { module: rm, entryPoint: 'vsLine' },
      fragment: {
        module: rm, entryPoint: 'fsLine',
        targets: [{ format: ctx.format, blend: {
          color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
        } }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: ctx.depthFormat, depthWriteEnabled: false, depthCompare: 'greater-equal' },
      multisample: { count: ctx.sampleCount || 1 },
    }),
  ]);
  const gC = device.createBindGroup({ layout: L.tCompute, entries: [
    { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: parts } }, { binding: 2, resource: { buffer: trail } },
  ] });
  const gR = device.createBindGroup({ layout: L.tRender, entries: [
    { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: trail } },
  ] });

  let head = 0, acc = 0, reseed = 1, seed = 1, count = 0;
  return {
    K,
    reseed() { reseed = 1; },
    update(enc, gScene, gOv, p) {
      count = Math.min(max, p.count | 0);
      if (!count) return;
      acc += p.dt;
      if (acc >= 1 / HEAD_HZ) {
        acc %= 1 / HEAD_HZ;
        head = (head + 1) % K;
      }
      seed = (seed * 1664525 + 1013904223) >>> 0;
      u32.set([count, K, head, seed], 0);
      f32[4] = p.dt; u32[5] = opts.mode; u32[6] = Math.min(p.nInner | 0, count); u32[7] = reseed;
      f32.set([p.speedup, p.lift, p.lineW, p.alpha, p.innerR, p.outerR, p.colourTop, p.lifeS], 8);
      device.queue.writeBuffer(ubuf, 0, raw);
      const c = enc.beginComputePass();
      c.setPipeline(pAdv);
      c.setBindGroup(0, gScene); c.setBindGroup(1, gOv); c.setBindGroup(2, gC);
      c.dispatchWorkgroups(Math.ceil(count / 64));
      c.end();
      reseed = 0;
    },
    draw(pass, gScene, gOv) {
      if (!count) return;
      pass.setPipeline(pLine);
      pass.setBindGroup(0, gScene); pass.setBindGroup(1, gOv); pass.setBindGroup(2, gR);
      pass.draw(6 * (K - 1), count);
    },
    destroy() { parts.destroy(); trail.destroy(); ubuf.destroy(); },
  };
}
