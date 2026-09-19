// ============================================================================
//  PRESENCE ORBS  ·  gpu.js — WebGPU device, surfaces, tiles and pipelines
// ----------------------------------------------------------------------------
//  initGPU(styles, packs) sets up the device, builds one surface per tile, and
//  compiles one render pipeline per species. Each surface owns a canvas
//  context, a 176-byte uniform buffer and a bind group. Each pack (one family)
//  compiles once; every species in that family draws with entry point
//  fs_<name>. The compile is async, so stats.compiled counts the pipelines as
//  they finish and main.js reads it for the FPS line.
//
//  When WebGPU is absent, initGPU shows the #nogpu note, writes the FPS line
//  and returns false. On a missing device it returns false without a loop, so
//  the caller stops. The exported device / msurf / visible bindings go live
//  after a true return.
//
//  EXPORTS
//      device .... the GPUDevice (null until initGPU succeeds)
//      msurf ..... the inspector surface (the big modal orb)
//      visible ... the set of on-screen tiles, kept by an IntersectionObserver
//      stats ..... { compiled } — the pipeline count for the FPS line
//      makeSurface(canvas) .... build a surface record for a canvas
//      initGPU(styles, packs) . async setup; true on success
// ============================================================================
import { $, G, tiles, stage } from './state.js';
import { tickSignals } from './signals.js';

export let device = null;
export let msurf = null;
export const visible = new Set();
export const stats = { compiled: 0 };

let format = null, bgl = null, layout = null, blend = null;

export function makeSurface(canvas) {
  const ctx = canvas.getContext('webgpu');
  ctx.configure({ device, format, alphaMode: 'premultiplied' });
  const buf = device.createBuffer({ size: 176, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bind = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: buf } }] });
  return { canvas, ctx, buf, bind, data: new Float32Array(44) };
}

export async function initGPU(styles, packs) {
  if (!navigator.gpu) { $('nogpu').hidden = false; $('fps').textContent = 'no WebGPU'; (function loop() { requestAnimationFrame(loop); tickSignals(); })(); return false; }
  try { const adapter = await navigator.gpu.requestAdapter(); device = await adapter.requestDevice(); }
  catch (e) { $('nogpu').hidden = false; $('fps').textContent = 'no WebGPU device'; return false; }
  format = navigator.gpu.getPreferredCanvasFormat();
  bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
  layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
  blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
  for (const s of styles) {
    const el = $('tile-' + s.name);
    const t = { s, el, canvas: el.querySelector('canvas'), status: el.querySelector('.orb-status'),
      prev: G.state, cur: G.state, changedAt: 0, phase: 0, sig: new Float32Array(7), knobs: s.knobs.map(k => k[1]), pipeline: null };
    t.surf = makeSurface(t.canvas);
    tiles.push(t);
  }
  msurf = makeSurface($('m-orb'));
  const io = new IntersectionObserver(es => { for (const e of es) { const t = e.target._tile; if (e.isIntersecting) visible.add(t); else visible.delete(t); } }, { root: stage, rootMargin: '100px' });
  for (const t of tiles) { t.el._tile = t; io.observe(t.el); }
  for (const fam of Object.keys(packs)) {
    const module = device.createShaderModule({ code: packs[fam] });
    module.getCompilationInfo().then(info => {
      const errs = info.messages.filter(m => m.type === 'error');
      if (errs.length) for (const t of tiles) if (t.s.family === fam) { t.status.textContent = errs[0].message.slice(0, 120); t.status.classList.add('err'); }
    });
    for (const t of tiles) if (t.s.family === fam) {
      device.createRenderPipelineAsync({ layout, vertex: { module, entryPoint: 'vs_main' },
        fragment: { module, entryPoint: 'fs_' + t.s.name, targets: [{ format, blend }] }, primitive: { topology: 'triangle-list' } })
        .then(p => { t.pipeline = p; stats.compiled++; })
        .catch(e => { t.status.textContent = String(e.message || e).slice(0, 120); t.status.classList.add('err'); });
    }
  }
  return true;
}
