// ============================================================================
//  THREAD ART  ·  gpu.js — the WebGPU runner of the greedy step
// ----------------------------------------------------------------------------
//  This module has no DOM: main.js and the Deno check (gpu-check.mjs) both
//  use it. The caller gives the device and the text of thread.wgsl.
//
//  createThreadGPU(device, wgsl) -> runner
//    runner.load(run)      upload a CPU run (engine.js createRun): the
//                          residual, the pegs, the thread deltas and the
//                          thread pegs. Lines that the run already holds
//                          stay on the CPU side; the GPU continues from them.
//    runner.steps(n)       encode n greedy steps (3 dispatches each) in one
//                          compute pass and submit them
//    runner.sync()         read back the state and the new peg sequence;
//                          resolves to { lines: [{k, a, b}], done, step }
//                          and appends the lines to run.lines
//    runner.readResidual() resolves to an Int32Array copy of the residual
//    runner.destroy()
//
//  grep -n: "export async function createThreadGPU"  "function load"
//           "function steps"  "async function sync"  "async function readResidual"
// ============================================================================
import { RFLOOR } from './engine.js';

const STATE_BYTES = 64;

export async function createThreadGPU(device, wgsl) {
  const module = device.createShaderModule({ code: wgsl, label: 'thread.wgsl' });
  if (module.getCompilationInfo) {
    const info = await module.getCompilationInfo();
    const errs = info.messages.filter(m => m.type === 'error');
    if (errs.length) throw new Error('thread.wgsl: ' + errs.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('; '));
  }
  const S = GPUShaderStage.COMPUTE;
  const layout = device.createBindGroupLayout({
    label: 'thread-art',
    entries: [
      { binding: 0, visibility: S, buffer: { type: 'uniform' } },
      { binding: 1, visibility: S, buffer: { type: 'storage' } },
      { binding: 2, visibility: S, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: S, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: S, buffer: { type: 'storage' } },
      { binding: 5, visibility: S, buffer: { type: 'storage' } },
      { binding: 6, visibility: S, buffer: { type: 'storage' } },
    ],
  });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const mk = entryPoint => device.createComputePipeline({ layout: pl, compute: { module, entryPoint } });
  const pipes = { score: mk('score'), pick: mk('pick'), apply: mk('apply') };

  let B = null, run = null, bind = null, readFrom = 0, encoded = 0, busy = false;
  const U = GPUBufferUsage;

  function free() {
    if (B) for (const b of Object.values(B)) b.destroy();
    B = null;
  }

  function load(r) {
    free();
    run = r;
    const res = r.res, P = r.P, K = r.K, maxLines = Math.max(1, r.cfg.maxLines || 20000);
    const buf = (size, usage, label) => device.createBuffer({ size: Math.max(16, Math.ceil(size / 16) * 16), usage, label });
    B = {
      prm: buf(32, U.UNIFORM | U.COPY_DST, 'params'),
      resid: buf(r.residual.byteLength, U.STORAGE | U.COPY_DST | U.COPY_SRC, 'residual'),
      pegs: buf(P * 16, U.STORAGE | U.COPY_DST, 'pegs'),
      deltas: buf(K * 16, U.STORAGE | U.COPY_DST, 'deltas'),
      st: buf(STATE_BYTES, U.STORAGE | U.COPY_DST | U.COPY_SRC, 'state'),
      scores: buf(K * P * 4, U.STORAGE, 'scores'),
      seq: buf(maxLines * 4, U.STORAGE | U.COPY_SRC, 'seq'),
      stage: buf(STATE_BYTES + maxLines * 4, U.MAP_READ | U.COPY_DST, 'readback'),
    };
    const prm = new ArrayBuffer(32), pu = new Uint32Array(prm), pi = new Int32Array(prm);
    pu[0] = res; pu[1] = P; pu[2] = K; pu[3] = r.C; pu[4] = r.gap; pu[5] = maxLines; pi[6] = RFLOOR;
    device.queue.writeBuffer(B.prm, 0, prm);
    device.queue.writeBuffer(B.resid, 0, r.residual);
    const pg = new Int32Array(P * 4);
    for (let i = 0; i < P; i++) { pg[4 * i] = r.pegs.x[i]; pg[4 * i + 1] = r.pegs.y[i]; pg[4 * i + 2] = r.pegs.side[i]; }
    device.queue.writeBuffer(B.pegs, 0, pg);
    const dl = new Int32Array(K * 4);
    for (let k = 0; k < K; k++) for (let c = 0; c < 3; c++) dl[4 * k + c] = r.delta[3 * k + c];
    device.queue.writeBuffer(B.deltas, 0, dl);
    const st = new ArrayBuffer(STATE_BYTES), si = new Int32Array(st), su = new Uint32Array(st);
    for (let k = 0; k < K; k++) si[k] = r.cur[k];
    su[8] = r.lines.length; su[9] = r.done ? 1 : 0;
    device.queue.writeBuffer(B.st, 0, st);
    bind = device.createBindGroup({ layout, entries: ['prm', 'resid', 'pegs', 'deltas', 'st', 'scores', 'seq'].map((k, i) => ({ binding: i, resource: { buffer: B[k] } })) });
    readFrom = r.lines.length; encoded = 0;
  }

  function steps(n) {
    if (!run || run.done || n <= 0) return 0;
    const room = (run.cfg.maxLines || 20000) - (readFrom + encoded);
    n = Math.min(n, Math.max(0, room));
    if (!n) return 0;
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, bind);
    for (let s = 0; s < n; s++) {
      pass.setPipeline(pipes.score); pass.dispatchWorkgroups(run.P, run.K);
      pass.setPipeline(pipes.pick); pass.dispatchWorkgroups(1);
      pass.setPipeline(pipes.apply); pass.dispatchWorkgroups(1);
    }
    pass.end();
    device.queue.submit([enc.finish()]);
    encoded += n;
    return n;
  }

  async function sync() {
    if (!run) return { lines: [], done: true, step: 0 };
    if (busy) throw new Error('sync while a sync runs');
    busy = true;
    const myRun = run, myB = B;
    const n = encoded;
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(myB.st, 0, myB.stage, 0, STATE_BYTES);
    if (n) enc.copyBufferToBuffer(myB.seq, readFrom * 4, myB.stage, STATE_BYTES, n * 4);
    device.queue.submit([enc.finish()]);
    try {
      await myB.stage.mapAsync(GPUMapMode.READ, 0, STATE_BYTES + n * 4);
    } catch (e) { busy = false; if (run !== myRun) return { lines: [], done: true, step: 0, stale: true }; throw e; }
    const ab = myB.stage.getMappedRange(0, STATE_BYTES + n * 4);
    const su = new Uint32Array(ab.slice(0));
    myB.stage.unmap();
    busy = false;
    if (run !== myRun) return { lines: [], done: true, step: 0, stale: true };
    const step = su[8], done = su[9] === 1;
    const got = Math.max(0, Math.min(n, step - readFrom));
    const lines = [];
    for (let i = 0; i < got; i++) {
      const v = su[16 + i], k = v >>> 16, b = v & 0xffff;
      const l = { k, a: run.cur[k], b };
      run.cur[k] = b; run.lines.push(l); lines.push(l);
    }
    readFrom += got; encoded = 0;
    if (done || run.lines.length >= (run.cfg.maxLines || 20000)) run.done = true;
    return { lines, done, step };
  }

  async function readResidual() {
    if (!run) return null;
    const myB = B, bytes = run.residual.byteLength;
    const st = device.createBuffer({ size: bytes, usage: U.MAP_READ | U.COPY_DST });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(myB.resid, 0, st, 0, bytes);
    device.queue.submit([enc.finish()]);
    await st.mapAsync(GPUMapMode.READ);
    const out = new Int32Array(st.getMappedRange().slice(0));
    st.unmap(); st.destroy();
    return out;
  }

  return { load, steps, sync, readResidual, destroy() { free(); run = null; }, get busy() { return busy; }, pipes };
}
