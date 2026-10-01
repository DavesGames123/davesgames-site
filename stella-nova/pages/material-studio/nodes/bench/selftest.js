// ============================================================================
//  MATERIAL STUDIO  ·  nodes/bench/selftest.js — GPU self test of the bench nodes
// ────────────────────────────────────────────────────────────────────────────
//  selfTest runs one cell per library through pass.run and through the
//  contract fallback in a minimal host, and compares the means. selfTestAll
//  runs every cell through pass.run. Both need a GPUDevice.
//
//  GREP TARGETS  (grep -n the name to jump)
//      f16 / readStats
//      fallbackHost / runFallback
//      PICK / selfTest / selfTestAll
// ============================================================================
import { CAT, catalog, DEFS, GEN_KINDS, benchDef } from './catalog.js';
import { loadBenchNodes } from './defs.js';
import { lit, fallbackWGSL } from './fallback.js';
import { viewOf, runnerFor, renderBenchNode } from './runner.js';

// Decode rgba16float texels to numbers (no Float16Array dependency).
function f16(h) {
  const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}
/** Read back an rgba16float texture: per-channel mean, NaN/Inf count, min/max. */
async function readStats(device, tex, res) {
  const bpr = Math.ceil(res * 8 / 256) * 256;
  const buf = device.createBuffer({ size: bpr * res, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [res, res]);
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const u16 = new Uint16Array(buf.getMappedRange());
  const sum = [0, 0, 0, 0]; let bad = 0, lo = Infinity, hi = -Infinity;
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) for (let c = 0; c < 4; c++) {
    const val = f16(u16[(y * bpr) / 2 + x * 4 + c]);
    if (!Number.isFinite(val)) { bad++; continue; }
    sum[c] += val; if (c < 3) { lo = Math.min(lo, val); hi = Math.max(hi, val); }
  }
  buf.unmap(); buf.destroy();
  const n = res * res;
  return { mean: sum.map(s => +(s / n).toFixed(4)), bad, min: +lo.toFixed(3), max: +hi.toFixed(3) };
}
// A minimal contract host for the fallback: the shape a compiler wraps pass_main in.
function fallbackHost(src, res) {
  return `@group(0) @binding(0) var t_in0: texture_2d<f32>;
@group(0) @binding(1) var t_in1: texture_2d<f32>;
@group(0) @binding(2) var s_rep: sampler;
${src}
@vertex fn host_vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}
@fragment fn host_fs(@builtin(position) fp: vec4f) -> @location(0) vec4f { return pass_main(fp.xy / ${lit(res)}); }
`;
}
async function runFallback(device, def, res, values, inputs) {
  const tex = {}, linked = {};
  def.bench.inputs.forEach((p, i) => { if (inputs[p.name]) { tex[p.name] = i ? 't_in1' : 't_in0'; linked[p.name] = true; } });
  const src = fallbackWGSL(def, { values, res: String(res), tex, samp: 's_rep', linked, inputs: {}, params: {}, sample: {}, seed: '0.0', uid: 'n0' });
  const r = runnerFor(device);
  const m = await r.module(fallbackHost(src, res), def.type + ' fallback');
  const F = GPUShaderStage.FRAGMENT;
  const bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: F, texture: {} }, { binding: 1, visibility: F, texture: {} }, { binding: 2, visibility: F, sampler: {} }] });
  const pipe = await device.createRenderPipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }), vertex: { module: m, entryPoint: 'host_vs' },
    fragment: { module: m, entryPoint: 'host_fs', targets: [{ format: 'rgba16float' }] }, primitive: { topology: 'triangle-list' } });
  const out = device.createTexture({ size: [res, res], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING });
  const iv = i => { const p = def.bench.inputs[i]; const t = p && inputs[p.name]; return t ? viewOf(t) : r.dummyView; };
  const bind = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: iv(0) }, { binding: 1, resource: iv(1) }, { binding: 2, resource: r.smp['linear:repeat'] }] });
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({ colorAttachments: [{ view: out.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
  pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
  device.queue.submit([enc.finish()]);
  return out;
}

// One representative cell per library: a source cell, or for an operator
// library a cell fed by a noise source.
const PICK = { noise: 'fbm', field: 'vortex', postfx: 'gaussian', color: 'magma', heat_haze: 'rising_haze', refraction: null, sampling: 'poisson_disc', sim: 'life', heat_metal: 'orbit' };

/**
 * Instantiate one cell of every library (and every generic kind) as a studio
 * node, run it through pass.run at `res`, and (for non-sim nodes) through the
 * contract fallback in a minimal host; compare the two means.
 * @param {{device?:GPUDevice, res?:number, libs?:string[]}} [opts]
 */
export async function selfTest(opts = {}) {
  const device = opts.device || (typeof window !== 'undefined' && window.__studio && window.__studio.gpu && window.__studio.gpu.device);
  if (!device) return { ok: false, error: 'no GPUDevice' };
  await catalog(); if (!DEFS.size) await loadBenchNodes();
  const res = opts.res || 128;
  const src = await renderBenchNode(device, 'bench.noise.fbm', { res });
  const coordSrc = await renderBenchNode(device, 'bench.field.vortex', { res });
  const rows = []; let fails = 0;
  const libs = opts.libs || Object.keys(CAT.LIBS);
  const targets = libs.map(key => {
    const L = CAT.LIBS[key]; const name = PICK[key] && L.cells.some(c => c.name === PICK[key]) ? PICK[key] : L.cells[0].name; return `bench.${key}.${name}`;
  });
  if (!opts.libs) for (const k of GEN_KINDS) targets.push('bench.gen.' + k);
  for (const type of targets) {
    const def = benchDef(type); const row = { type };
    const inputs = {};
    for (const p of def.bench.inputs) inputs[p.name] = p.type === 'coord' ? coordSrc : src;
    device.pushErrorScope('validation');
    try {
      const t = await renderBenchNode(device, def, { res, inputs, values: def.bench.sim ? { steps: 60 } : {} });
      row.run = await readStats(device, t, res); t.destroy();
      if (!def.bench.sim) {
        const fb = await runFallback(device, def, res, {}, inputs);
        row.fallback = await readStats(device, fb, res); fb.destroy();
        row.meanDiff = +Math.max(...row.run.mean.map((m, i) => Math.abs(m - row.fallback.mean[i]))).toFixed(4);
      }
    } catch (e) { row.error = String(e.message || e).slice(0, 300); }
    const ve = await device.popErrorScope(); if (ve) row.validation = ve.message.slice(0, 300);
    if (row.error || row.validation || (row.run && row.run.bad) || (row.fallback && row.fallback.bad)) { row.fail = true; fails++; }
    rows.push(row);
  }
  src.destroy(); coordSrc.destroy();
  return { ok: fails === 0, defs: DEFS.size, libs: Object.keys(CAT.LIBS).length, cells: CAT.cellCount(), tested: rows.length, fails, rows };
}

/** Run every cell of the given libraries (default all) through pass.run at res. */
export async function selfTestAll(opts = {}) {
  const device = opts.device || window.__studio.gpu.device;
  await catalog(); if (!DEFS.size) await loadBenchNodes();
  const res = opts.res || 64; const libs = opts.libs || Object.keys(CAT.LIBS);
  const src = await renderBenchNode(device, 'bench.noise.fbm', { res });
  const out = {}; let pass = 0, fail = 0; const t0 = performance.now();
  for (const key of libs) {
    const L = await CAT.ensureLib(key); const r = { pass: 0, fail: [] };
    for (const c of L.cells) {
      const def = benchDef(`bench.${key}.${c.name}`);
      const inputs = {}; for (const p of def.bench.inputs) if (p.type === 'img') inputs[p.name] = src;
      device.pushErrorScope('validation');
      let err = null;
      try {
        const t = await renderBenchNode(device, def, { res, inputs, values: L.sim ? { steps: 16 } : {} });
        if (opts.fallback && !L.sim) { const fb = await runFallback(device, def, res, {}, inputs); fb.destroy(); }
        t.destroy();
      } catch (e) { err = String(e.message || e).slice(0, 200); }
      const ve = await device.popErrorScope(); if (ve) err = (err ? err + ' | ' : '') + ve.message.slice(0, 200);
      if (err) { r.fail.push({ cell: c.name, err }); fail++; } else { r.pass++; pass++; }
    }
    out[key] = r;
  }
  src.destroy();
  return { pass, fail, s: +((performance.now() - t0) / 1000).toFixed(1), libs: out };
}
