// engine3d.js — the 3D wind tunnel on WebGPU. No DOM; it draws into the
// texture view that the caller passes to frame().
//
// createEngine3D(device, code, { format, nx, ny, nz, maxParticles, K }) builds
// the D3Q19 lattice (shaders/lbm3d.wgsl) and the views (shaders/view3d.wgsl).
// code has the WGSL sources { sdf, lbm3d, view3d }; sdf is prepended to both.
//
// One frame(target, f) call, one submit:
//   1 step x f.steps   compute  lattice steps, ping-pong A <-> B; the last
//                               two measure forces and writes the macro
//                               texture (ux, uy, uz, rho - 1)
//   2 pref             compute  free-stream pressure for Cp (one group)
//   2 advect           compute  streamline particles
//   3 scene            render   ray-marched floor and object, with depth
//   4 slice            render   the field plane, blended, depth tested
//   5 lines            render   streaks, blended, depth tested
// Then a free staging buffer gets the force sums (as in engine2d.js).
//
// Camera: f.camera = { eye, target, fovY, shift: [sx, sy] }. shift moves the
// projection center in NDC, so main.js can center the tunnel in the part of
// the canvas that the panels leave clear.
//
// Memory: populations 2 x 19 x n f32 (152 bytes per cell), types n u32,
// macro texture 8 bytes per cell. The caller picks a grid that fits
// device.limits.maxStorageBufferBindingSize (see main.js TIERS).
//
// grep: function createEngine3D  function perspective  function lookAt
//       function mul4  function inv4  setShape(  setFlow(  reset(  frame(  destroy(

const FIX = 1048576;

function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  // WebGPU clip depth is 0..1. Column-major.
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, far / (near - far), -1, 0, 0, far * near / (near - far), 0];
}

function lookAt(eye, target, up) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
}

function mul4(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

function inv4(m) {
  const a = m, o = new Array(16);
  o[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  o[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  o[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  o[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  o[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  o[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  o[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  o[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  o[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  o[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  o[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  o[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  o[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  o[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  o[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  o[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  const det = a[0] * o[0] + a[1] * o[4] + a[2] * o[8] + a[3] * o[12];
  return o.map((v) => v / det);
}

export async function createEngine3D(device, code, opts) {
  const { format, nx, ny, nz } = opts;
  const n = nx * ny * nz;
  const maxParticles = opts.maxParticles || 20000;
  const K = opts.K || 18;

  const compile = async (src, label) => {
    const m = device.createShaderModule({ code: src, label });
    const info = await m.getCompilationInfo();
    const errs = info.messages.filter((x) => x.type === 'error');
    if (errs.length) throw new Error(`${label}: ` + errs.map((e) => `${e.lineNum}:${e.linePos} ${e.message}`).join('; '));
    return m;
  };
  const lbm = await compile(code.sdf + '\n' + code.lbm3d, 'lbm3d');
  const view = await compile(code.sdf + '\n' + code.view3d, 'view3d');

  const cp = (module, entryPoint) => device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint } });
  const blend = {
    color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  };
  const depthFmt = 'depth32float';
  const rpipe = (vs, fs, b, depth) => device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module: view, entryPoint: vs },
    fragment: { module: view, entryPoint: fs, targets: [b ? { format, blend: b } : { format }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: depthFmt, ...depth },
  });
  const [pVox, pMark, pInit, pStep, pArea, pAdv, pPref, pScene, pSlice, pLine] = await Promise.all([
    cp(lbm, 'voxelize'), cp(lbm, 'mark'), cp(lbm, 'initF'), cp(lbm, 'step'), cp(lbm, 'area'), cp(view, 'advect'), cp(view, 'pref'),
    rpipe('vsScene', 'fsScene', null, { depthWriteEnabled: true, depthCompare: 'always' }),
    rpipe('vsSlice', 'fsSlice', blend, { depthWriteEnabled: false, depthCompare: 'less' }),
    rpipe('vsLine', 'fsLine', blend, { depthWriteEnabled: false, depthCompare: 'less' }),
  ]);

  // ---------------------------------------------------------------- buffers
  const U = GPUBufferUsage, T = GPUTextureUsage;
  const buf = (size, usage, label) => device.createBuffer({ size, usage, label });
  const simBuf = buf(48, U.UNIFORM | U.COPY_DST, 'sim');
  const simMBuf = buf(48, U.UNIFORM | U.COPY_DST, 'simMeasure');
  const shapeBuf = buf(160, U.UNIFORM | U.COPY_DST, 'shape');
  const camBuf = buf(224, U.UNIFORM | U.COPY_DST, 'cam');
  const partUBuf = buf(64, U.UNIFORM | U.COPY_DST, 'partU');
  const fA = buf(19 * n * 4, U.STORAGE, 'fA');
  const fB = buf(19 * n * 4, U.STORAGE, 'fB');
  const types = buf(n * 4, U.STORAGE | U.COPY_DST, 'types');
  const forces = buf(64, U.STORAGE | U.COPY_SRC | U.COPY_DST, 'forces');
  const staging = [buf(64, U.MAP_READ | U.COPY_DST, 'stage0'), buf(64, U.MAP_READ | U.COPY_DST, 'stage1')];
  const stageBusy = [false, false];
  const parts = buf(maxParticles * 32, U.STORAGE | U.COPY_DST, 'parts');
  const trail = buf(maxParticles * K * 16, U.STORAGE, 'trail');
  // Free-stream rho - 1 from view3d.wgsl fn pref; the pressure colours use it.
  const prefBuf = buf(16, U.STORAGE, 'pref');
  const macro = device.createTexture({
    size: [nx, ny, nz], dimension: '3d', format: 'rgba16float', label: 'macro',
    usage: T.STORAGE_BINDING | T.TEXTURE_BINDING,
  });
  const macroView = macro.createView({ dimension: '3d' });
  const samp = device.createSampler({
    magFilter: 'linear', minFilter: 'linear',
    addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge',
  });
  let depthTex = null;

  const bg = (pipe, entries) => device.createBindGroup({
    layout: pipe.getBindGroupLayout(0),
    entries: Object.entries(entries).map(([b, r]) => ({ binding: +b, resource: r instanceof GPUBuffer ? { buffer: r } : r })),
  });
  const fPair = [[fA, fB], [fB, fA]];
  const gVox = bg(pVox, { 0: simBuf, 1: shapeBuf, 2: fA, 3: fB, 4: types });
  const gMark = bg(pMark, { 0: simBuf, 4: types });
  const gInit = bg(pInit, { 0: simBuf, 2: fA, 3: fB, 4: types });
  const gStep = fPair.map(([a, b]) => bg(pStep, { 0: simBuf, 2: a, 3: b, 4: types, 5: macroView, 6: forces }));
  const gStepM = fPair.map(([a, b]) => bg(pStep, { 0: simMBuf, 2: a, 3: b, 4: types, 5: macroView, 6: forces }));
  const gArea = bg(pArea, { 0: simBuf, 4: types, 6: forces });
  const gAdv = bg(pAdv, { 0: camBuf, 2: macroView, 3: samp, 4: types, 5: partUBuf, 6: parts, 7: trail });
  const gPref = bg(pPref, { 0: camBuf, 2: macroView, 10: prefBuf });
  const gScene = bg(pScene, { 0: camBuf, 1: shapeBuf, 2: macroView, 3: samp, 11: prefBuf });
  const gSlice = bg(pSlice, { 0: camBuf, 2: macroView, 3: samp, 4: types, 11: prefBuf });
  const gLine = bg(pLine, { 0: camBuf, 5: partUBuf, 8: parts, 9: trail });

  // ---------------------------------------------------------------- state
  const sim = new ArrayBuffer(48);
  const simF = new Float32Array(sim), simU = new Uint32Array(sim);
  simU.set([nx, ny, nz, n], 0);
  const flow = { U: 0.08, tau: 0.52, noise: 0, ground: 0, beltU: 0 };
  let parity = 0, stepCount = 0, frameNo = 0, head = 0, reseed = 1, disposed = false;
  const stats = { forces: new Float32Array(12), area: new Uint32Array(4), stamp: 0 };

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
    // Interior fluid cells get the fast pull (lbm3d.wgsl fn mark).
    const mk = enc.beginComputePass();
    mk.setPipeline(pMark); mk.setBindGroup(0, gMark);
    mk.dispatchWorkgroups(Math.ceil(n / 128));
    mk.end();
    enc.clearBuffer(forces, 48, 16);
    const a = enc.beginComputePass();
    a.setPipeline(pArea); a.setBindGroup(0, gArea);
    a.dispatchWorkgroups(Math.ceil(ny * nz / 64));
    a.end();
  }

  const cam = new Float32Array(56);

  const engine = {
    kind: '3d', nx, ny, nz, n, K, maxParticles, stats,

    setShape(bytes) {
      device.queue.writeBuffer(shapeBuf, 0, bytes);
      writeSim();
      const enc = device.createCommandEncoder();
      dispatchVoxelize(enc);
      device.queue.submit([enc.finish()]);
    },

    // { U, tau, noise, ground: 0 none | 1 fixed | 2 belt, beltU }.
    // A ground change re-voxelizes.
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

    reset() {
      writeSim();
      const enc = device.createCommandEncoder();
      enc.clearBuffer(types);
      dispatchVoxelize(enc);
      const p = enc.beginComputePass();
      p.setPipeline(pInit); p.setBindGroup(0, gInit);
      p.dispatchWorkgroups(Math.ceil(n / 128));
      p.end();
      enc.clearBuffer(forces, 0, 48);
      device.queue.submit([enc.finish()]);
      parity = 0;
      reseed = 1;
    },

    // Returns { vp, ivp } for a camera, so main.js can pick and project.
    matrices(c, w, h) {
      const P = perspective(c.fovY, w / h, 2, Math.max(nx, ny, nz) * 8);
      P[8] -= c.shift ? c.shift[0] : 0;
      P[9] -= c.shift ? c.shift[1] : 0;
      const vp = mul4(P, lookAt(c.eye, c.target, [0, 1, 0]));
      return { vp, ivp: inv4(vp) };
    },

    // f: { steps, canvas: [w, h], camera, slice: [axis, pos, field, alpha],
    //      surface, refL, ground, vortScale, presScale, lineW, lineAlpha,
    //      whiteStreaks, particles, mode, life, rakeA, rakeB, time }
    frame(target, f) {
      if (disposed) return;
      const [w, h] = f.canvas;
      if (!depthTex || depthTex.width !== w || depthTex.height !== h) {
        if (depthTex) depthTex.destroy();
        depthTex = device.createTexture({ size: [w, h], format: depthFmt, usage: T.RENDER_ATTACHMENT });
      }
      const steps = Math.max(0, Math.floor(f.steps));
      simU[8] = stepCount;
      writeSim();

      const { vp, ivp } = engine.matrices(f.camera, w, h);
      cam.set(vp, 0);
      cam.set(ivp, 16);
      cam.set([...f.camera.eye, 1], 32);
      cam.set([w, h, f.lineW, f.lineAlpha], 36);
      cam.set([nx, ny, nz, flow.U], 40);
      cam.set(f.slice, 44);
      cam.set([f.surface, f.refL, f.ground, f.vortScale], 48);
      cam.set([f.presScale, f.time, f.whiteStreaks ? 1 : 0, 0], 52);
      device.queue.writeBuffer(camBuf, 0, cam);

      const count = Math.min(f.particles | 0, maxParticles);
      head = (head + 1) % K;
      const pu = new ArrayBuffer(64);
      const pf = new Float32Array(pu), pi = new Uint32Array(pu);
      pi.set([count, K, head, (frameNo * 7919) >>> 0], 0);
      pf[4] = steps;
      pi[5] = f.mode;
      pf[6] = f.life;
      pi[7] = reseed;
      pf.set(f.rakeA || [0, 0, 0, 0], 8);
      pf.set(f.rakeB || [0, 0, 0, 0], 12);
      device.queue.writeBuffer(partUBuf, 0, pu);

      // Forces sum over the last two steps. A fluid cell shut in by solids
      // (a sliver in a wheel arch) bounces its momentum back each step, so a
      // force read on one step parity aliases that into a false mean.
      const measured = Math.min(steps, 2);
      const enc = device.createCommandEncoder();
      if (steps > 0) {
        const p = enc.beginComputePass();
        p.setPipeline(pStep);
        for (let k = 0; k < steps; k++) {
          p.setBindGroup(0, k >= steps - measured ? gStepM[parity] : gStep[parity]);
          p.dispatchWorkgroups(Math.ceil(n / 128));
          parity ^= 1;
        }
        p.end();
        stepCount += steps;
      }
      {
        const p = enc.beginComputePass();
        p.setPipeline(pPref); p.setBindGroup(0, gPref);
        p.dispatchWorkgroups(1);
        p.end();
      }
      if (count > 0) {
        const p = enc.beginComputePass();
        p.setPipeline(pAdv); p.setBindGroup(0, gAdv);
        p.dispatchWorkgroups(Math.ceil(count / 64));
        p.end();
        reseed = 0;
      }

      const rp = enc.beginRenderPass({
        colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0.016, 0.018, 0.026, 1] }],
        depthStencilAttachment: { view: depthTex.createView(), depthLoadOp: 'clear', depthStoreOp: 'discard', depthClearValue: 1 },
      });
      rp.setPipeline(pScene); rp.setBindGroup(0, gScene); rp.draw(3);
      if (f.slice[0] < 2.5 && f.slice[3] > 0) { rp.setPipeline(pSlice); rp.setBindGroup(0, gSlice); rp.draw(6); }
      if (count > 0) { rp.setPipeline(pLine); rp.setBindGroup(0, gLine); rp.draw(6, count * (K - 1)); }
      rp.end();

      let si = -1;
      if (steps > 0) {
        si = stageBusy[0] ? (stageBusy[1] ? -1 : 1) : 0;
        if (si >= 0) enc.copyBufferToBuffer(forces, 0, staging[si], 0, 64);
        enc.clearBuffer(forces, 0, 48);
      }
      device.queue.submit([enc.finish()]);
      frameNo++;

      if (si >= 0) {
        stageBusy[si] = true;
        const sb = staging[si];
        const div = measured;
        sb.mapAsync(GPUMapMode.READ).then(() => {
          const i32 = new Int32Array(sb.getMappedRange().slice(0));
          sb.unmap();
          stageBusy[si] = false;
          for (let k = 0; k < 12; k++) stats.forces[k] = i32[k] / FIX / div;
          for (let k = 0; k < 4; k++) stats.area[k] = i32[12 + k];
          stats.stamp++;
        }).catch(() => { stageBusy[si] = false; });
      }
    },

    get steps() { return stepCount; },

    destroy() {
      disposed = true;
      for (const b of [simBuf, simMBuf, shapeBuf, camBuf, partUBuf, fA, fB, types, forces, parts, trail, prefBuf, ...staging]) b.destroy();
      macro.destroy();
      if (depthTex) depthTex.destroy();
    },
  };
  return engine;
}
