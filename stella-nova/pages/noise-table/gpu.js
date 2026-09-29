// ============================================================================
//  NOISE TABLE  ·  gpu.js — WebGPU device, surfaces, tiles and pipelines
// ----------------------------------------------------------------------------
//  initGPU(styles, pack) sets up the device, builds one surface per tile, and
//  compiles one render pipeline per cell from the single WGSL pack. Each
//  surface owns a canvas context, a 96-byte uniform buffer, a bind group and
//  a persistent cache texture. A cell draws into its cache; present() copies
//  the cache into the canvas. main.js presents every visible surface on each
//  active frame, so Safari never composites a canvas buffer that was not
//  drawn in that frame (it shows a stale or cleared buffer as a flash).
//  The whole pack compiles once as one shader module; every cell draws with
//  entry point fs_<name>. The compile is async, so stats.compiled counts the
//  pipelines as they finish and main.js reads it for the FPS line. Each tile
//  gets pointerenter / pointerleave listeners that set t.hover.
//
//  When WebGPU is absent, initGPU shows the #nogpu note, writes the FPS line,
//  runs the signal loop and returns false. On a missing device it returns
//  false without a loop. The exported device / msurf / visible bindings go
//  live after a true return.
//
//  EXPORTS
//      device .... the GPUDevice (null until initGPU succeeds)
//      msurf ..... the inspector surface (the big modal cell)
//      visible ... the set of on-screen tiles, kept by an IntersectionObserver
//      stats ..... { compiled } — the pipeline count for the FPS line
//      makeSurface(canvas) .... build a surface record for a canvas
//      sizeSurface(surf,w,h) .. match canvas and cache to w x h; true on a change
//      present(enc, surf) ..... copy a drawn cache into its canvas
//      initGPU(styles, pack) .. async setup; true on success
// ============================================================================
import { $, tiles, stage } from './state.js';
import { tickSignals } from './signals.js';

export let device = null;
export let msurf = null;
export const visible = new Set();
export const stats = { compiled: 0 };

let format = null, bgl = null, layout = null;

export function makeSurface(canvas) {
  const gpu = canvas.getContext('webgpu'); gpu.configure({ device, format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST });
  const buf = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bind = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: buf } }] });
  return { canvas, gpu, cache: null, drawn: false, buf, bind, data: new Float32Array(24), w: 0, h: 0 };
}

export function sizeSurface(surf, w, h) {
  if (surf.cache && surf.canvas.width === w && surf.canvas.height === h) return false;
  surf.canvas.width = w; surf.canvas.height = h;
  if (surf.cache) surf.cache.destroy();
  surf.cache = device.createTexture({ size: [w, h], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  surf.drawn = false; return true;
}

export function present(enc, surf) {
  if (!surf.drawn) return;
  enc.copyTextureToTexture({ texture: surf.cache }, { texture: surf.gpu.getCurrentTexture() }, [surf.cache.width, surf.cache.height]);
}

export async function initGPU(styles, pack) {
  if (!navigator.gpu) { $('nogpu').hidden = false; $('fps').textContent = 'no WebGPU'; (function loop() { requestAnimationFrame(loop); tickSignals(); })(); return false; }
  try { const adapter = await navigator.gpu.requestAdapter(); device = await adapter.requestDevice(); }
  catch (e) { $('nogpu').hidden = false; $('fps').textContent = 'no WebGPU device'; return false; }
  format = navigator.gpu.getPreferredCanvasFormat();
  bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
  layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
  const io = new IntersectionObserver(es => { for (const e of es) { const t = e.target._tile; if (e.isIntersecting) visible.add(t); else visible.delete(t); } }, { root: stage, rootMargin: '100px' });
  for (const s of styles) {
    const el = $('tile-' + s.name);
    const t = { s, el, canvas: el.querySelector('canvas'), status: el.querySelector('.orb-status'), phase: 0, rate: 0, hover: false, dirty: true, knobs: s.knobs.map(k => k[1]), pipeline: null };
    t.surf = makeSurface(t.canvas); el._tile = t; io.observe(el); tiles.push(t);
    el.addEventListener('pointerenter', () => { t.hover = true; }); el.addEventListener('pointerleave', () => { t.hover = false; });
  }
  msurf = makeSurface($('m-orb'));
  const module = device.createShaderModule({ code: pack });
  module.getCompilationInfo().then(info => { const errs = info.messages.filter(m => m.type === 'error'); if (errs.length) for (const t of tiles) { t.status.textContent = errs[0].message.slice(0, 120); t.status.classList.add('err'); } });
  for (const t of tiles) device.createRenderPipelineAsync({ layout, vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: 'fs_' + t.s.name, targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
    .then(p => { t.pipeline = p; t.dirty = true; stats.compiled++; }).catch(e => { t.status.textContent = String(e.message || e).slice(0, 120); t.status.classList.add('err'); });
  return true;
}
