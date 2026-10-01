// ============================================================================
//  MATERIAL STUDIO  ·  nodes/bench/runner.js — GPU runner and the pass entry points
// ────────────────────────────────────────────────────────────────────────────
//  def.pass.run and def.pass.prepare. One BenchRunner per GPUDevice holds
//  the layouts, samplers, pipeline cache and texture pool. run() renders
//  the cell (or steps a sim) and then the frame pass into job.target.
//
//  GREP TARGETS  (grep -n the name to jump)
//      TEX_USE / viewOf / hash
//      BenchRunner (destroy, flush, trim, tex, module, frame, pipeline, run, runInner, runSim)
//      runners / runnerFor / trimBench
//      runBenchPass / prepareBenchPass / renderBenchNode
// ============================================================================
import { BENCH_UBYTES, BENCH_BGL_ENTRIES, BENCH_CBGL_ENTRIES, BENCH_PBGL_ENTRIES } from '../../../../lib/bench-wgsl.js';
import { CAT, catalog, benchDef } from './catalog.js';
import { withDefaults, nodeOf, paletteOf } from './values.js';
import { cellSource } from './cell-wgsl.js';
import { FRAME_WGSL, frameUniform } from './frame-wgsl.js';

const TEX_USE = () => GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT;
export const viewOf = t => (t && typeof t.createView === 'function' ? t.createView() : t);
const hash = s => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(36); };

/**
 * One runner per GPUDevice: layouts, samplers, pipeline caches and a small
 * texture pool. Run calls are serialized on device.queue in submit order, so
 * the pooled intermediate textures are safe to reuse from node to node.
 */
class BenchRunner {
  constructor(device) {
    this.device = device; this.dead = false;
    const d = device;
    this.bgl = d.createBindGroupLayout({ label: 'bench cell', entries: BENCH_BGL_ENTRIES() });
    this.layout = d.createPipelineLayout({ bindGroupLayouts: [this.bgl] });
    this.cbgl = d.createBindGroupLayout({ label: 'bench sim step', entries: BENCH_CBGL_ENTRIES() });
    this.clayout = d.createPipelineLayout({ bindGroupLayouts: [this.cbgl] });
    this.pbgl = d.createBindGroupLayout({ label: 'bench sim present', entries: BENCH_PBGL_ENTRIES() });
    this.playout = d.createPipelineLayout({ bindGroupLayouts: [this.pbgl] });
    const F = GPUShaderStage.FRAGMENT;
    this.fbgl = d.createBindGroupLayout({ label: 'bench frame', entries: [
      { binding: 0, visibility: F, buffer: { type: 'uniform' } }, { binding: 1, visibility: F, texture: {} }, { binding: 2, visibility: F, sampler: {} }] });
    this.flayout = d.createPipelineLayout({ bindGroupLayouts: [this.fbgl] });
    const S = (filter, mode) => d.createSampler({ magFilter: filter, minFilter: filter, addressModeU: mode, addressModeV: mode });
    // smp in the cell: mirror-repeat, as on the bench
    this.smpCell = S('linear', 'mirror-repeat');
    this.smp = { 'linear:mirror': this.smpCell, 'linear:repeat': S('linear', 'repeat'), 'nearest:mirror': S('nearest', 'mirror-repeat'), 'nearest:repeat': S('nearest', 'repeat') };
    this.dummy = d.createTexture({ label: 'bench dummy', size: [1, 1], format: 'rgba16float', usage: TEX_USE() });
    this.dummyView = this.dummy.createView();
    this.ubuf = d.createBuffer({ label: 'bench cell U', size: BENCH_UBYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.bbuf = d.createBuffer({ label: 'bench BenchB', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.fbuf = d.createBuffer({ label: 'bench frame U', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.simU = Array.from({ length: 8 }, (_, i) => d.createBuffer({ label: 'bench sim U' + i, size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    this.simP = d.createBuffer({ label: 'bench sim present U', size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.udata = new Float32Array(BENCH_UBYTES / 4);
    this.pipes = new Map();      // key -> Promise<pipeline | {compute, present}>
    this.pool = new Map();       // key -> GPUTexture
    this.stale = [];             // pooled textures to destroy when no run is busy
    this.busy = 0;               // run() calls in flight
    this.framePipe = null;
    this.stats = { runs: 0, compiles: 0, ms: 0 };
  }
  destroy() {
    this.dead = true;
    for (const t of this.pool.values()) try { t.destroy(); } catch (e) {}
    this.pool.clear(); this.pipes.clear();
    for (const b of [this.ubuf, this.bbuf, this.fbuf, this.simP, ...this.simU]) try { b.destroy(); } catch (e) {}
    try { this.dummy.destroy(); } catch (e) {}
  }
  /** Destroy the stale textures, but only when no run can still bind them. */
  flush() {
    if (this.busy) return;
    for (const t of this.stale.splice(0)) try { t.destroy(); } catch (e) {}
  }
  /** Release all pooled textures (after an export, or a res change). */
  trim() {
    for (const t of this.pool.values()) this.stale.push(t);
    this.pool.clear();
    this.flush();
  }
  tex(key, w, h, format = 'rgba16float', usage = TEX_USE()) {
    const k = `${key}:${w}x${h}:${format}`;
    // One texture per pool key: a new size makes the old size stale.
    for (const [pk, pt] of this.pool) if (pk !== k && pk.startsWith(key + ':')) { this.pool.delete(pk); this.stale.push(pt); }
    let t = this.pool.get(k);
    if (!t) { t = this.device.createTexture({ label: 'bench ' + k, size: [w, h], format, usage }); this.pool.set(k, t); }
    return t;
  }
  async module(code, label) {
    const m = this.device.createShaderModule({ label, code });
    const info = await m.getCompilationInfo();
    const e = info.messages.find(x => x.type === 'error');
    if (e) throw new Error(`${label}: WGSL line ${e.lineNum}: ${e.message.slice(0, 240)}`);
    return m;
  }
  frame() {
    if (!this.framePipe) this.framePipe = this.module(FRAME_WGSL, 'bench frame').then(m => this.device.createRenderPipelineAsync({
      label: 'bench frame', layout: this.flayout, vertex: { module: m, entryPoint: 'vs_frame' },
      fragment: { module: m, entryPoint: 'fs_frame', targets: [{ format: 'rgba16float' }] }, primitive: { topology: 'triangle-list' } }));
    return this.framePipe;
  }
  /** Compile (once) the pipelines of a node. Sim nodes get {compute, present, N}. */
  pipeline(def, n, v) {
    const B = def.bench;
    const L = B.lib ? CAT.LIBS[B.lib] : null;
    if (L && L.sim) {
      const N = Math.max(8, +v.grid || 128);
      const key = `sim:${B.lib}:${B.cell}:${N}`;
      if (!this.pipes.has(key)) {
        const core = L.core.replace(/const N: i32 = \d+;/, `const N: i32 = ${N};`);
        const p = (async () => {
          const m = await this.module(core + '\n' + n.code, def.type);
          const pm = await this.module(core, def.type + ' present');
          const [compute, present] = await Promise.all([
            this.device.createComputePipelineAsync({ label: def.type, layout: this.clayout, compute: { module: m, entryPoint: CAT.entryOf(n) } }),
            this.device.createRenderPipelineAsync({ label: def.type + ' present', layout: this.playout, vertex: { module: pm, entryPoint: 'vs_main' },
              fragment: { module: pm, entryPoint: 'fs_present', targets: [{ format: 'rgba16float' }] }, primitive: { topology: 'triangle-list' } }),
          ]);
          this.stats.compiles++;
          return { compute, present, N };
        })();
        p.catch(() => this.pipes.delete(key));
        this.pipes.set(key, p);
      }
      return this.pipes.get(key);
    }
    const code = cellSource(def, n);
    const key = `cell:${def.type}:${hash(code)}`;
    if (!this.pipes.has(key)) {
      const p = (async () => {
        const m = await this.module(code, def.type);
        const pipe = await this.device.createRenderPipelineAsync({ label: def.type, layout: this.layout, vertex: { module: m, entryPoint: 'vs_main' },
          fragment: { module: m, entryPoint: CAT.entryOf(n), targets: [{ format: 'rgba16float' }] }, primitive: { topology: 'triangle-list' } });
        this.stats.compiles++;
        return pipe;
      })();
      p.catch(() => this.pipes.delete(key));
      this.pipes.set(key, p);
    }
    return this.pipes.get(key);
  }
  /** Render one node into job.target. See PASS PROTOCOL in the header. */
  async run(def, job) {
    this.busy++;
    try { return await this.runInner(def, job); } finally { this.busy--; this.flush(); }
  }
  async runInner(def, job) {
    const t0 = performance.now();
    const d = this.device, B = def.bench;
    await catalog(); if (B.lib) await CAT.ensureLib(B.lib);
    const v = withDefaults(def, job.values || {});
    const n = nodeOf(def, v);
    const res = Math.max(1, job.res | 0 || 1024);
    const target = viewOf(job.target); if (!target) throw new Error(def.type + ': job.target is missing');
    const G = paletteOf(v);
    const L = B.lib ? CAT.LIBS[B.lib] : null;
    const pipe = await this.pipeline(def, n, v);
    if (this.dead) return { ms: 0 };
    let cellView, samplerKey;
    if (L && L.sim) {
      cellView = this.runSim(def, n, v, pipe, G, job);
      samplerKey = (v.filter === 'nearest' ? 'nearest' : 'linear') + ':' + (v.tile === 'repeat' ? 'repeat' : 'mirror');
    } else {
      const maxDim = d.limits.maxTextureDimension2D || 8192;
      const S = Math.min(maxDim, res * (v.quality === '2' ? 2 : 1));
      const cell = this.tex('cell', S, S);
      this.udata.fill(0);
      CAT.fillUniform(n, this.udata, { T: +v.time || 0, TEX: S, G });
      d.queue.writeBuffer(this.ubuf, 0, this.udata);
      const ins = B.inputs;
      const inView = i => { const p = ins[i]; const t = p && job.inputs ? job.inputs[p.name] : null; return t ? viewOf(t) : null; };
      const v0 = inView(0), v1 = inView(1);
      const pad = ins.some(p => p.type === 'coord') && v.coordSpace !== 'bench' ? (+v.coordScale || 1) : 0;
      const view = L ? L.view : CAT.GENERIC[B.gen].view;
      d.queue.writeBuffer(this.bbuf, 0, new Float32Array([v0 ? 1 : 0, v1 ? 1 : 0, view, pad]));
      const bind = d.createBindGroup({ layout: this.bgl, entries: [
        { binding: 0, resource: { buffer: this.ubuf } }, { binding: 1, resource: v0 || this.dummyView }, { binding: 2, resource: this.smpCell },
        { binding: 3, resource: v1 || this.dummyView }, { binding: 4, resource: { buffer: this.bbuf } }] });
      const enc = d.createCommandEncoder({ label: def.type });
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: cell.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
      d.queue.submit([enc.finish()]);
      cellView = cell.createView();
      samplerKey = 'linear:' + (v.tile === 'repeat' ? 'repeat' : 'mirror');
    }
    // frame pass
    const fp = await this.frame();
    // A generator (no linked input) repeats with the graph tiling. A cell that
    // reads an input keeps the texel uv, because its input is already tiled.
    const linked = Object.values(job.inputs || {}).some(Boolean);
    const tiling = linked ? 1 : Math.max(1, Math.round(+job.tiling || 1));
    d.queue.writeBuffer(this.fbuf, 0, frameUniform(def, v, res, tiling));
    const fbind = d.createBindGroup({ layout: this.fbgl, entries: [
      { binding: 0, resource: { buffer: this.fbuf } }, { binding: 1, resource: cellView }, { binding: 2, resource: this.smp[samplerKey] }] });
    const enc = d.createCommandEncoder({ label: def.type + ' frame' });
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: target, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(fp); pass.setBindGroup(0, fbind); pass.draw(3); pass.end();
    d.queue.submit([enc.finish()]);
    const ms = performance.now() - t0;
    this.stats.runs++; this.stats.ms += ms;
    return { ms };
  }
  /** Step a simulation cell from reset, then present its state. Returns the present view (N x N). */
  runSim(def, n, v, pipe, G, job) {
    const d = this.device, c = CAT.cellOf(n), N = pipe.N;
    const state = [0, 1].map(i => this.tex('sim' + i, N, N, 'rgba32float', GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING));
    const views = state.map(t => t.createView());
    const cb = [0, 1].map(i => this.simU.map(buf => d.createBindGroup({ layout: this.cbgl, entries: [
      { binding: 0, resource: { buffer: buf } }, { binding: 1, resource: views[i] }, { binding: 2, resource: views[1 - i] }] })));
    const seed = ((+v.simSeed || 0) * 7.31 + (+job.seed || 0) * 13.7) % 100;
    const steps = Math.max(1, (+v.steps | 0) + 1);
    const dT = 1 / Math.max(1, (c.steps || 1) * 12);
    let cur = 0, T = Math.max(0, (+v.time || 0) - steps * dT);
    const sd = new Float32Array(24);
    const head = () => { sd.fill(0); sd[0] = N; sd[1] = N; sd[3] = 1; sd.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); sd.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); sd.set([G.cream[0], G.cream[1], G.cream[2], 1], 12); sd.set(n.k, 16); };
    for (let s0 = 0; s0 < steps; s0 += 8) {
      const enc = d.createCommandEncoder({ label: def.type + ' steps' });
      for (let r = 0; r < 8 && s0 + r < steps; r++) {
        const s = s0 + r; head(); sd[2] = T; sd[20] = s; sd[21] = seed; sd[22] = 1 / 60; sd[23] = s === 0 ? 1 : 0;
        d.queue.writeBuffer(this.simU[r], 0, sd);
        const p = enc.beginComputePass(); p.setPipeline(pipe.compute); p.setBindGroup(0, cb[cur][r]); p.dispatchWorkgroups(Math.ceil(N / 8), Math.ceil(N / 8)); p.end();
        cur = 1 - cur; T += dT;
      }
      d.queue.submit([enc.finish()]);
    }
    // present at grid size: the frame pass filters and tiles it
    head(); sd[2] = T; sd[20] = steps; sd[21] = seed; sd[22] = 0; sd[23] = c.mode || 0;
    d.queue.writeBuffer(this.simP, 0, sd);
    const out = this.tex('simOut', N, N);
    const pb = d.createBindGroup({ layout: this.pbgl, entries: [{ binding: 0, resource: { buffer: this.simP } }, { binding: 1, resource: views[cur] }] });
    const enc = d.createCommandEncoder({ label: def.type + ' present' });
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: out.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipe.present); pass.setBindGroup(0, pb); pass.draw(3); pass.end();
    d.queue.submit([enc.finish()]);
    return out.createView();
  }
}
export const runners = new WeakMap();
export function runnerFor(device) {
  if (!device) throw new Error('bench pass: no GPUDevice');
  let r = runners.get(device);
  if (!r || r.dead) { r = new BenchRunner(device); runners.set(device, r); }
  return r;
}

/** Release the pooled cell textures of the runner of a device (bake.js calls
 *  it after an export bake at another res). */
export function trimBench(device) { const r = device && runners.get(device); if (r) r.trim(); }

/** def.pass.run: render a bench node into job.target. Resolves {ms}. */
export async function runBenchPass(def, job) {
  await catalog();
  return runnerFor(job.device).run(def, job);
}
/** def.pass.prepare: load the library and compile the node's pipelines. */
export async function prepareBenchPass(def, device, values = {}) {
  await catalog(); if (def.bench.lib) await CAT.ensureLib(def.bench.lib);
  const v = withDefaults(def, values); const r = runnerFor(device);
  await Promise.all([r.pipeline(def, nodeOf(def, v), v), r.frame()]);
  return true;
}
/**
 * Render a bench node into a new texture (the caller owns and destroys it).
 * @param {string|object} typeOrDef  'bench.<lib>.<cell>' or a def
 * @returns {Promise<GPUTexture>}  rgba16float res x res (TEXTURE_BINDING | COPY_SRC | RENDER_ATTACHMENT)
 */
export async function renderBenchNode(device, typeOrDef, { values = {}, res = 512, inputs = {}, seed = 0 } = {}) {
  const def = typeof typeOrDef === 'string' ? benchDef(typeOrDef) : typeOrDef;
  if (!def) throw new Error('no bench node ' + typeOrDef);
  const target = device.createTexture({ label: def.type, size: [res, res], format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT });
  await runBenchPass(def, { device, target, res, values, inputs, seed });
  return target;
}
