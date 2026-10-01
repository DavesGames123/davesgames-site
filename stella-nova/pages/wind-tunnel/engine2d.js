// engine2d.js — the 2D wind tunnel on WebGPU. No DOM; it draws into the
// texture view that the caller passes to frame().
//
// createEngine2D(device, code, { format, nx, ny, maxParticles, K }) builds the
// lattice (shaders/lbm2d.wgsl) and the views (shaders/view2d.wgsl). code has
// the WGSL sources { sdf, lbm2d, view2d }; sdf is prepended to both.
//
// One frame(target, f) call, one submit:
//   1 step x f.steps   compute  D2Q9 lattice steps, ping-pong A <-> B; the
//                               last one measures forces and writes the macro
//                               texture (ux, uy, rho, solid)
//   2 dye              compute  smoke advection, only when the smoke field shows
//   3 advect           compute  streamline particles
//   4 field + lines    render   into target
// After the submit, a free staging buffer gets the force sums, and mapAsync
// fills engine.stats (forces per copy, frontal cells per copy).
//
// Resources: populations 2 x 9 x n f32; types n u32; macro and two smoke
// textures rgba16float nx x ny; particles maxParticles vec4f; trail
// maxParticles x K vec4f.
//
// grep: function createEngine2D  setShape(  setFlow(  reset(  frame(  readForces
//       destroy(  FIX

const FIX = 1048576;

export async function createEngine2D(device, code, opts) {
  const { format, nx, ny } = opts;
  const n = nx * ny;
  const maxParticles = opts.maxParticles || 30000;
  const K = opts.K || 20;

  const compile = async (src, label) => {
    const m = device.createShaderModule({ code: src, label });
    const info = await m.getCompilationInfo();
    const errs = info.messages.filter((x) => x.type === 'error');
    if (errs.length) throw new Error(`${label}: ` + errs.map((e) => `${e.lineNum}:${e.linePos} ${e.message}`).join('; '));
    return m;
  };
  const lbm = await compile(code.sdf + '\n' + code.lbm2d, 'lbm2d');
  const view = await compile(code.sdf + '\n' + code.view2d, 'view2d');

  const cp = (module, entryPoint) => device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint } });
  const blend = {
    color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  };
  const [pVox, pInit, pStep, pArea, pDye, pAdv, pField, pLine] = await Promise.all([
    cp(lbm, 'voxelize'), cp(lbm, 'initF'), cp(lbm, 'step'), cp(lbm, 'area'),
    cp(view, 'dye'), cp(view, 'advect'),
    device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module: view, entryPoint: 'vsField' },
      fragment: { module: view, entryPoint: 'fsField', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
    device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module: view, entryPoint: 'vsLine' },
      fragment: { module: view, entryPoint: 'fsLine', targets: [{ format, blend }] },
      primitive: { topology: 'triangle-list' },
    }),
  ]);

  // ---------------------------------------------------------------- buffers
  const U = GPUBufferUsage, T = GPUTextureUsage;
  const buf = (size, usage, label) => device.createBuffer({ size, usage, label });
  const simBuf = buf(48, U.UNIFORM | U.COPY_DST, 'sim');
  const simMBuf = buf(48, U.UNIFORM | U.COPY_DST, 'simMeasure');
  const shapeBuf = buf(160, U.UNIFORM | U.COPY_DST, 'shape');
  const viewBuf = buf(64, U.UNIFORM | U.COPY_DST, 'view');
  const partUBuf = buf(48, U.UNIFORM | U.COPY_DST, 'partU');
  const fA = buf(9 * n * 4, U.STORAGE, 'fA');
  const fB = buf(9 * n * 4, U.STORAGE, 'fB');
  const types = buf(n * 4, U.STORAGE | U.COPY_DST, 'types');
  const forces = buf(64, U.STORAGE | U.COPY_SRC | U.COPY_DST, 'forces');
  const staging = [buf(64, U.MAP_READ | U.COPY_DST, 'stage0'), buf(64, U.MAP_READ | U.COPY_DST, 'stage1')];
  const stageBusy = [false, false];
  const parts = buf(maxParticles * 16, U.STORAGE | U.COPY_DST, 'parts');
  const trail = buf(maxParticles * K * 16, U.STORAGE, 'trail');

  const tex = (label) => device.createTexture({
    size: [nx, ny], format: 'rgba16float', label,
    usage: T.STORAGE_BINDING | T.TEXTURE_BINDING | T.RENDER_ATTACHMENT,
  });
  const macro = tex('macro');
  const dye = [tex('dyeA'), tex('dyeB')];
  const samp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });

  // ---------------------------------------------------------------- bind groups
  const bg = (pipe, entries) => device.createBindGroup({
    layout: pipe.getBindGroupLayout(0),
    entries: Object.entries(entries).map(([b, r]) => ({
      binding: +b,
      resource: r instanceof GPUBuffer ? { buffer: r } : r,
    })),
  });
  const fPair = [[fA, fB], [fB, fA]];
  const gVox = bg(pVox, { 0: simBuf, 1: shapeBuf, 2: fA, 3: fB, 4: types });
  const gInit = bg(pInit, { 0: simBuf, 2: fA, 3: fB, 4: types });
  const gStep = fPair.map(([a, b]) => bg(pStep, { 0: simBuf, 2: a, 3: b, 4: types, 5: macro.createView(), 6: forces }));
  const gStepM = fPair.map(([a, b]) => bg(pStep, { 0: simMBuf, 2: a, 3: b, 4: types, 5: macro.createView(), 6: forces }));
  const gArea = bg(pArea, { 0: simBuf, 4: types, 6: forces });
  const gDye = [0, 1].map((i) => bg(pDye, {
    0: viewBuf, 2: macro.createView(), 3: samp, 4: dye[i].createView(), 5: dye[1 - i].createView(), 6: partUBuf,
  }));
  const gAdv = bg(pAdv, { 0: viewBuf, 2: macro.createView(), 3: samp, 6: partUBuf, 7: parts, 8: trail });
  const gField = [0, 1].map((i) => bg(pField, {
    0: viewBuf, 1: shapeBuf, 2: macro.createView(), 3: samp, 4: dye[i].createView(),
  }));
  const gLine = bg(pLine, { 0: viewBuf, 6: partUBuf, 9: parts, 10: trail });

  // ---------------------------------------------------------------- state
  const sim = new ArrayBuffer(48);
  const simF = new Float32Array(sim), simU = new Uint32Array(sim);
  simU.set([nx, ny, 1, n], 0);
  const flow = { U: 0.08, tau: 0.52, noise: 0.0, ground: 0, beltU: 0 };
  let parity = 0;     // which of fA / fB holds the current populations
  let dyeCur = 0;
  let stepCount = 0;
  let frameNo = 0;
  let head = 0;
  let reseed = 1;
  let disposed = false;
  const stats = { forces: new Float32Array(8), area: new Uint32Array(4), stamp: 0 };

  function writeSim() {
    simF[4] = flow.U; simF[5] = flow.tau; simF[6] = flow.noise; simF[7] = flow.beltU;
    simU[8] = stepCount; simU[9] = 0; simU[10] = flow.ground;
    device.queue.writeBuffer(simBuf, 0, sim);
    simU[9] = 1;
    device.queue.writeBuffer(simMBuf, 0, sim);
  }

  function dispatchVoxelize(enc) {
    const p = enc.beginComputePass();
    p.setPipeline(pVox); p.setBindGroup(0, gVox);
    p.dispatchWorkgroups(Math.ceil(n / 128));
    p.end();
    enc.clearBuffer(forces, 32, 16);
    const a = enc.beginComputePass();
    a.setPipeline(pArea); a.setBindGroup(0, gArea);
    a.dispatchWorkgroups(Math.ceil(ny / 64));
    a.end();
  }

  function clearDye(enc) {
    for (const t of dye) {
      enc.beginRenderPass({ colorAttachments: [{ view: t.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] }).end();
    }
  }

  const engine = {
    kind: '2d', nx, ny, n, K, maxParticles, stats,

    // Shape bytes from shapes.js packShape(). Re-voxelizes in place, so the
    // flow keeps going around the new shape.
    setShape(bytes) {
      device.queue.writeBuffer(shapeBuf, 0, bytes);
      writeSim();
      const enc = device.createCommandEncoder();
      dispatchVoxelize(enc);
      device.queue.submit([enc.finish()]);
    },

    // { U, tau, noise, ground: 0|1|2, beltU }. A ground change re-voxelizes.
    setFlow(f) {
      const groundChanged = f.ground !== undefined && f.ground !== flow.ground;
      Object.assign(flow, f);
      writeSim();
      if (groundChanged) {
        const enc = device.createCommandEncoder();
        dispatchVoxelize(enc);
        device.queue.submit([enc.finish()]);
      }
    },

    // Uniform flow everywhere, no smoke, fresh particles.
    reset() {
      writeSim();
      const enc = device.createCommandEncoder();
      enc.clearBuffer(types);
      dispatchVoxelize(enc);
      const p = enc.beginComputePass();
      p.setPipeline(pInit); p.setBindGroup(0, gInit);
      p.dispatchWorkgroups(Math.ceil(n / 128));
      p.end();
      enc.clearBuffer(forces, 0, 32);
      clearDye(enc);
      device.queue.submit([enc.finish()]);
      parity = 0;
      reseed = 1;
    },

    // f: { steps, canvas: [w, h], offset: [x, y], cellPx, field, refL,
    //      vortScale, presScale, lineW, lineAlpha, particles, mode, life, rake }
    frame(target, f) {
      if (disposed) return;
      const steps = Math.max(0, Math.floor(f.steps));
      simU[8] = stepCount;
      writeSim();

      const v = new ArrayBuffer(64);
      const vf = new Float32Array(v), vu = new Uint32Array(v);
      vf.set([f.canvas[0], f.canvas[1], f.offset[0], f.offset[1], nx, ny, f.cellPx], 0);
      vu[7] = f.field;
      vf.set([flow.U, f.refL, frameNo / 60, f.lineW, f.vortScale, f.presScale, f.lineAlpha], 8);
      device.queue.writeBuffer(viewBuf, 0, v);

      const count = Math.min(f.particles | 0, maxParticles);
      head = (head + 1) % K;
      const pu = new ArrayBuffer(48);
      const pf = new Float32Array(pu), pi = new Uint32Array(pu);
      pi.set([count, K, head, (frameNo * 7919) >>> 0], 0);
      pf[4] = Math.max(steps, 0.0);
      pi[5] = f.mode;
      pf[6] = f.life;
      pi[7] = reseed;
      pf.set(f.rake || [0, 0, 0, 0], 8);
      device.queue.writeBuffer(partUBuf, 0, pu);

      const enc = device.createCommandEncoder();
      if (steps > 0) {
        const p = enc.beginComputePass();
        p.setPipeline(pStep);
        for (let k = 0; k < steps; k++) {
          p.setBindGroup(0, k === steps - 1 ? gStepM[parity] : gStep[parity]);
          p.dispatchWorkgroups(Math.ceil(n / 128));
          parity ^= 1;
        }
        p.end();
        stepCount += steps;
      }
      if (f.field === 3 && steps > 0) {
        const p = enc.beginComputePass();
        p.setPipeline(pDye); p.setBindGroup(0, gDye[dyeCur]);
        p.dispatchWorkgroups(Math.ceil(nx / 8), Math.ceil(ny / 8));
        p.end();
        dyeCur ^= 1;
      }
      if (count > 0) {
        const p = enc.beginComputePass();
        p.setPipeline(pAdv); p.setBindGroup(0, gAdv);
        p.dispatchWorkgroups(Math.ceil(count / 64));
        p.end();
        reseed = 0;
      }

      const rp = enc.beginRenderPass({ colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0.018, 0.02, 0.03, 1] }] });
      rp.setPipeline(pField); rp.setBindGroup(0, gField[dyeCur]); rp.draw(3);
      if (count > 0) { rp.setPipeline(pLine); rp.setBindGroup(0, gLine); rp.draw(6, count * (K - 1)); }
      rp.end();

      let si = -1;
      if (steps > 0) {
        si = stageBusy[0] ? (stageBusy[1] ? -1 : 1) : 0;
        if (si >= 0) enc.copyBufferToBuffer(forces, 0, staging[si], 0, 64);
        enc.clearBuffer(forces, 0, 32);
      }
      device.queue.submit([enc.finish()]);
      frameNo++;

      if (si >= 0) {
        stageBusy[si] = true;
        const sb = staging[si];
        sb.mapAsync(GPUMapMode.READ).then(() => {
          const i32 = new Int32Array(sb.getMappedRange().slice(0));
          sb.unmap();
          stageBusy[si] = false;
          for (let k = 0; k < 8; k++) stats.forces[k] = i32[k] / FIX;
          for (let k = 0; k < 4; k++) stats.area[k] = i32[8 + k];
          stats.stamp++;
        }).catch(() => { stageBusy[si] = false; });
      }
    },

    get steps() { return stepCount; },

    destroy() {
      disposed = true;
      for (const b of [simBuf, simMBuf, shapeBuf, viewBuf, partUBuf, fA, fB, types, forces, parts, trail, ...staging]) b.destroy();
      for (const t of [macro, ...dye]) t.destroy();
    },
  };
  return engine;
}
