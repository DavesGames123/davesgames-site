// wind.js — the wind overlay solver: two nested D2Q9 lattices on WebGPU
// (shaders/lbm.wgsl). No DOM. renderer.js owns the device and calls it.
//
//   coarse  CN x CN cells over the inner terrain square (12 km), terrain
//           above the block level is a wall, land cover adds drag, and an
//           optional sea breeze pushes from the sea toward land
//   fine    FN x FN cells over the building disc, buildings taller than
//           the slice height are walls; its inflow and side cells take the
//           coarse velocity at the same place (one-way nesting)
// Both lattices turn with the wind (lattice +x = the direction the wind
// blows to). A new direction, slice or city re-voxelizes both, starts them
// at the free stream, and runs a burst of steps so the wakes form during
// the fade.
//
// createWind(device, code, opts) -> wind
//   wind.setCity(city)        city = { hIn, hOut, rough (GPUTexture rg8unorm),
//                             bTex (r32float), gHalfIn, gHalfOut, bHalf, fHalf, block }
//   wind.set({ dirFrom, speed, slice, seaBreeze })   degrees, m/s, m, 0..1
//   wind.step(enc, frames)    lattice steps for one frame into enc
//   wind.coarseView / fineView   macro textures (ux, uy, rho - 1, solid)
//   wind.params               fine half, coarse half, m/s per lattice unit, flow-to dir
//   wind.massTest(...)        closed-box check (tests)
//   wind.destroy()
//
// grep: function createWind  function lattice  setCity(  set(  step(  burst

const U_LAT = 0.07;          // free-stream lattice speed
const TAU = 0.51;            // molecular relaxation time (Smagorinsky adds the rest)
const BURST_COARSE = 700;    // steps after a reset, spread over the first frames
const BURST_FINE = 900;

export async function createWind(device, code, opts = {}) {
  const CN = opts.coarseN || 256;
  const FN = opts.fineN || 640;
  const stepsPerFrame = { coarse: opts.coarseSteps || 3, fine: opts.fineSteps || 6 };

  const module = device.createShaderModule({ code: code.lbm, label: 'lbm' });
  const info = await module.getCompilationInfo();
  const errs = info.messages.filter((m) => m.type === 'error');
  if (errs.length) throw new Error('lbm.wgsl: ' + errs.map((e) => `${e.lineNum}:${e.linePos} ${e.message}`).join('; '));
  const cp = (entryPoint) => device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint } });
  const [pVox, pInit, pStep, pMass] = await Promise.all([cp('voxelize'), cp('initF'), cp('step'), cp('massSum')]);
  const samp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const U = GPUBufferUsage, T = GPUTextureUsage;
  const dummy = device.createTexture({ size: [1, 1], format: 'rgba16float', usage: T.TEXTURE_BINDING, label: 'dummy' });
  const dummyR = device.createTexture({ size: [1, 1], format: 'r32float', usage: T.TEXTURE_BINDING, label: 'dummyR' });

  function lattice(N, fine, label) {
    const n = N * N;
    const L = {
      N, n, fine, label,
      sim: device.createBuffer({ size: 96, usage: U.UNIFORM | U.COPY_DST, label: label + 'Sim' }),
      simM: device.createBuffer({ size: 96, usage: U.UNIFORM | U.COPY_DST, label: label + 'SimM' }),
      fA: device.createBuffer({ size: 9 * n * 4, usage: U.STORAGE, label: label + 'fA' }),
      fB: device.createBuffer({ size: 9 * n * 4, usage: U.STORAGE, label: label + 'fB' }),
      types: device.createBuffer({ size: n * 4, usage: U.STORAGE | U.COPY_DST, label: label + 'Types' }),
      aux: device.createBuffer({ size: n * 16, usage: U.STORAGE | U.COPY_SRC | U.COPY_DST, label: label + 'Aux' }),
      macro: device.createTexture({ size: [N, N], format: 'rgba16float', usage: T.STORAGE_BINDING | T.TEXTURE_BINDING | T.COPY_SRC, label: label + 'Macro' }),
      raw: new ArrayBuffer(96),
      parity: 0,
      stepNo: 0,
      burst: 0,
      groups: null,
    };
    L.f32 = new Float32Array(L.raw);
    L.u32 = new Uint32Array(L.raw);
    L.u32.set([N, N, n, fine ? 1 : 0], 0);
    return L;
  }
  const coarse = lattice(CN, false, 'coarse');
  const fine = lattice(FN, true, 'fine');
  let city = null;
  const flow = { dirFrom: 270, speed: 5, slice: 12, seaBreeze: 0, closed: 0, noise: 0.04 };
  let dir = [1, 0];

  function bg(pipe, entries) {
    return device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: Object.entries(entries).map(([b, r]) => ({
        binding: +b,
        resource: r instanceof GPUBuffer ? { buffer: r } : r instanceof GPUTexture ? r.createView() : r,
      })),
    });
  }

  function makeGroups(L, c) {
    const coarseIn = L.fine ? coarse.macro : dummy;
    const bTex = L.fine && c?.bTex ? c.bTex : dummyR;
    const hIn = c?.hIn || dummy, hOut = c?.hOut || dummy, rough = c?.rough || dummy;
    const vox = bg(pVox, { 0: L.sim, 3: L.types, 4: L.aux, 7: hIn, 8: hOut, 9: bTex, 10: rough });
    const init = bg(pInit, { 0: L.sim, 1: L.fA, 2: L.fB, 3: L.types, 6: coarseIn, 11: samp });
    const stepG = [[L.fA, L.fB], [L.fB, L.fA]].map(([a, b]) => [
      bg(pStep, { 0: L.sim, 1: a, 2: b, 3: L.types, 4: L.aux, 5: L.macro, 6: coarseIn, 11: samp }),
      bg(pStep, { 0: L.simM, 1: a, 2: b, 3: L.types, 4: L.aux, 5: L.macro, 6: coarseIn, 11: samp }),
    ]);
    const mass = [bg(pMass, { 0: L.sim, 1: L.fA, 3: L.types, 4: L.aux }), bg(pMass, { 0: L.sim, 1: L.fB, 3: L.types, 4: L.aux })];
    L.groups = { vox, init, step: stepG, mass };
  }

  function writeSim(L) {
    const f = L.f32, u = L.u32;
    f[4] = U_LAT; f[5] = TAU; f[6] = L.fine ? 0 : flow.noise; u[7] = L.stepNo >>> 0;
    f[8] = dir[0]; f[9] = dir[1];
    f[10] = L.fine ? (city?.fHalf || 2500) : (city?.gHalfIn || 6000);
    f[11] = city?.gHalfIn || 6000;
    f[12] = city?.gHalfIn || 6000;
    f[13] = city?.gHalfOut || 32000;
    f[14] = city?.bHalf || 2500;
    f[15] = flow.slice;
    f[16] = (city?.block ?? 150) + flow.slice;
    // sea breeze: the land-share gradient per coarse cell is about 0.02 at a coast
    f[17] = L.fine ? 0 : flow.seaBreeze * 0.0012;
    f[18] = L.fine ? 0.0002 : 0.003;
    u[19] = flow.closed; u[20] = 0;
    device.queue.writeBuffer(L.sim, 0, L.raw);
    u[20] = 1;
    device.queue.writeBuffer(L.simM, 0, L.raw);
  }

  function reset(L, enc) {
    writeSim(L);
    const p = enc.beginComputePass();
    p.setPipeline(pVox); p.setBindGroup(0, L.groups.vox); p.dispatchWorkgroups(Math.ceil(L.n / 128));
    p.setPipeline(pInit); p.setBindGroup(0, L.groups.init); p.dispatchWorkgroups(Math.ceil(L.n / 128));
    p.end();
    L.parity = 0;
    L.burst = L.fine ? BURST_FINE : BURST_COARSE;
  }

  function run(L, enc, steps) {
    if (steps <= 0) return;
    L.stepNo += steps;
    writeSim(L);
    const p = enc.beginComputePass();
    p.setPipeline(pStep);
    for (let k = 0; k < steps; k++) {
      p.setBindGroup(0, L.groups.step[L.parity][k === steps - 1 ? 1 : 0]);
      p.dispatchWorkgroups(Math.ceil(L.n / 128));
      L.parity ^= 1;
    }
    p.end();
  }

  function resetAll() {
    const rad = (flow.dirFrom * Math.PI) / 180;
    dir = [-Math.sin(rad), -Math.cos(rad)];       // the wind blows to the opposite bearing
    const enc = device.createCommandEncoder();
    reset(coarse, enc);
    // the fine lattice starts from the coarse field: run a short coarse burst first
    run(coarse, enc, 200);
    coarse.burst -= 200;
    reset(fine, enc);
    device.queue.submit([enc.finish()]);
  }

  const wind = {
    U: U_LAT,
    get coarseTex() { return coarse.macro; },
    get fineTex() { return fine.macro; },
    get dir() { return dir; },
    get flow() { return { ...flow }; },
    fineN: FN,
    coarseN: CN,

    setCity(c) {
      city = c;
      makeGroups(coarse, c);
      makeGroups(fine, c);
      resetAll();
    },

    set(f) {
      const turn = (f.dirFrom !== undefined && f.dirFrom !== flow.dirFrom)
        || (f.slice !== undefined && f.slice !== flow.slice)
        || (f.seaBreeze !== undefined && f.seaBreeze !== flow.seaBreeze)
        || (f.closed !== undefined && f.closed !== flow.closed);
      Object.assign(flow, f);
      if (!city && !flow.closed) return;
      if (turn) resetAll();
    },

    // m/s per lattice speed unit, for the renderer and the tracers
    get scale() { return flow.speed / U_LAT; },
    get fHalf() { return city?.fHalf || 2500; },
    get cHalf() { return city?.gHalfIn || 6000; },

    // One frame of steps. A burst after a reset runs more.
    step(enc, mult = 1) {
      if (!city && !flow.closed) return;
      const bc = Math.min(coarse.burst, 120), bf = Math.min(fine.burst, 120);
      coarse.burst -= bc; fine.burst -= bf;
      run(coarse, enc, Math.round(stepsPerFrame.coarse * mult) + bc);
      run(fine, enc, Math.round(stepsPerFrame.fine * mult) + bf);
    },

    // Test hook: total mass of the coarse lattice after `steps` steps in a
    // closed box. Returns [before, after].
    async massTest(steps) {
      flow.closed = 1;
      makeGroups(coarse, city);
      const enc = device.createCommandEncoder();
      reset(coarse, enc);
      device.queue.submit([enc.finish()]);
      const sum = async () => {
        const e = device.createCommandEncoder();
        const p = e.beginComputePass();
        p.setPipeline(pMass); p.setBindGroup(0, coarse.groups.mass[coarse.parity]);
        const wg = Math.ceil(coarse.n / 128);
        p.dispatchWorkgroups(wg);
        p.end();
        const rb = device.createBuffer({ size: wg * 16, usage: U.MAP_READ | U.COPY_DST });
        e.copyBufferToBuffer(coarse.aux, 0, rb, 0, wg * 16);
        device.queue.submit([e.finish()]);
        await rb.mapAsync(GPUMapMode.READ);
        const a = new Float32Array(rb.getMappedRange().slice(0));
        rb.unmap(); rb.destroy();
        let s = 0;
        for (let i = 0; i < wg; i++) s += a[i * 4];
        return s;
      };
      const before = await sum();
      // massSum wrote into aux; the closed box ignores aux, so stepping is safe
      const e = device.createCommandEncoder();
      run(coarse, e, steps);
      device.queue.submit([e.finish()]);
      const after = await sum();
      return [before, after];
    },

    destroy() {
      for (const L of [coarse, fine]) {
        for (const b of [L.sim, L.simM, L.fA, L.fB, L.types, L.aux]) b.destroy();
        L.macro.destroy();
      }
      dummy.destroy(); dummyR.destroy();
    },
  };
  return wind;
}
