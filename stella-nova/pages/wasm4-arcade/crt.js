// ============================================================================
//  WASM-4 ARCADE  ·  crt.js — the CRT tube: WebGPU, or the SSTV 2D tube
// ----------------------------------------------------------------------------
//  createCRT(canvas) -> a tube object with one interface for both paths:
//    tube.kind            'webgpu' or '2d'
//    tube.setFrame(rgba)  the 160 x 160 RGBA picture of this frame
//    tube.render(o)       draw. o: { time (s), fx 0..1 (0 = CRT off),
//                         stat 0..1 (static), power 0..1, box (the
//                         cabinet rect in CSS px, default: the canvas) }
//    tube.layout()        the glass rect in CSS px inside the canvas
//    tube.destroy()
//
//  WEBGPU PATH. shaders/crt.wgsl draws the bezel and the glass in one
//  pass over the whole canvas (see its header). The picture is a 160 x 160
//  rgba8unorm texture, written each frame. Phosphor persistence runs on the
//  CPU before the upload: a lit pixel fades over a few frames instead of
//  going dark at once (persist()).
//
//  2D PATH (no WebGPU, or a device error). The 2D tube of the SSTV page
//  (pages/sstv/crt.js, class CRT) draws the same 160 x 160 picture with
//  its bare bezel: barrel warp, scanlines, shadow mask, bloom, flicker,
//  snow. With the CRT off it draws the plain pixels.
//
//  grep -n targets  "export async function createCRT"  "function persist"
//                   "class GPUTube"  "class CanvasTube"  "export function glassRect"
// ============================================================================
import { CRT as SSTVTube } from '../sstv/crt.js';

const N = 160;

// The glass rect in px for a canvas of w x h px: a square, centred, with a
// bezel margin. The same in both paths, so pointer mapping matches.
export function glassRect(w, h, ox = 0, oy = 0) {
  const m = Math.round(Math.min(w, h) * 0.075);
  const s = Math.max(16, Math.min(w, h) - 2 * m);
  return { x: ox + Math.round((w - s) / 2), y: oy + Math.round((h - s) / 2), w: s, h: s };
}

// The cabinet box in CSS px: o.box, or the whole canvas.
function boxOf(o, cw, ch) { return o && o.box ? o.box : { x: 0, y: 0, w: cw, h: ch }; }

// Phosphor persistence: out = max(new, prev * decay), per channel.
export function persist(prev, rgba, out, decay) {
  for (let i = 0; i < rgba.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = Math.max(rgba[i + c], prev[i + c] * decay);
      prev[i + c] = v; out[i + c] = v;
    }
    out[i + 3] = 255;
  }
  return out;
}

export async function createCRT(canvas, { force2d = false } = {}) {
  if (!force2d && typeof navigator !== 'undefined' && navigator.gpu) {
    try { return await GPUTube.create(canvas); } catch (e) { console.warn('wasm4-arcade: WebGPU tube failed, 2D tube used', e); }
  }
  // A canvas that had a webgpu context cannot give a 2d one: use a twin.
  let cv = canvas;
  if (canvas.__gpuTried) {
    cv = canvas.cloneNode(false); canvas.replaceWith(cv);
  }
  return new CanvasTube(cv);
}

function sizeCanvas(cv) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = cv.getBoundingClientRect();
  const w = Math.max(32, Math.round(r.width * dpr)), h = Math.max(32, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  return { w, h, dpr, cw: r.width, ch: r.height };
}

class GPUTube {
  static async create(canvas) {
    canvas.__gpuTried = true;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('no adapter');
    const device = await adapter.requestDevice();
    const ctx = canvas.getContext('webgpu');
    if (!ctx) throw new Error('no webgpu context');
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: 'premultiplied' });
    const code = await (await fetch(new URL('./shaders/crt.wgsl', import.meta.url))).text();
    const mod = device.createShaderModule({ label: 'wasm4 crt', code });
    if (mod.getCompilationInfo) {
      const info = await mod.getCompilationInfo();
      const errs = info.messages.filter(m => m.type === 'error');
      if (errs.length) throw new Error('crt.wgsl: ' + errs.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('; '));
    }
    const t = new GPUTube();
    Object.assign(t, { canvas, device, ctx, format, kind: 'webgpu', lost: false });
    device.lost.then(() => { t.lost = true; });
    t.pipe = device.createRenderPipeline({ layout: 'auto', vertex: { module: mod, entryPoint: 'vs_main' },
      fragment: { module: mod, entryPoint: 'fs_main', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
    t.tex = device.createTexture({ size: [N, N], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    t.uni = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    t.smp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    t.bg = device.createBindGroup({ layout: t.pipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: t.uni } }, { binding: 1, resource: t.tex.createView() }, { binding: 2, resource: t.smp }] });
    t.prev = new Float32Array(N * N * 4); t.buf = new Uint8Array(N * N * 4); t.u = new Float32Array(16);
    return t;
  }
  setFrame(rgba, fx = 1) {
    if (this.lost) return;
    const out = fx > 0 ? persist(this.prev, rgba, this.buf, 0.5 * fx) : rgba;
    this.device.queue.writeTexture({ texture: this.tex }, out, { bytesPerRow: N * 4 }, [N, N]);
  }
  layout() {
    const r = this.canvas.getBoundingClientRect(), b = this.box || { x: 0, y: 0, w: r.width, h: r.height };
    return glassRect(b.w, b.h, b.x, b.y);
  }
  render(o = {}) {
    if (this.lost) return;
    const { w, h, dpr, cw, ch } = sizeCanvas(this.canvas), u = this.u;
    const b = boxOf(o, cw, ch), B = [b.x * dpr, b.y * dpr, b.w * dpr, b.h * dpr];
    const g = glassRect(B[2], B[3], B[0], B[1]);
    this.box = b;
    u.set([w, h, o.time || 0, o.fx == null ? 1 : o.fx, g.x, g.y, g.w, g.h, o.stat || 0, o.power == null ? 1 : o.power, Math.min(B[2], B[3]) * 0.06, dpr, B[0], B[1], B[2], B[3]]);
    this.device.queue.writeBuffer(this.uni, 0, u);
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
    pass.setPipeline(this.pipe); pass.setBindGroup(0, this.bg); pass.draw(3); pass.end();
    this.device.queue.submit([enc.finish()]);
  }
  destroy() { try { this.device.destroy(); } catch (e) { /* ignore */ } }
}

class CanvasTube {
  constructor(canvas) {
    this.canvas = canvas; this.kind = '2d';
    this.g = canvas.getContext('2d');
    this.tube = new SSTVTube(); this.tube.setPicture(N, N, 1);
    this.pic = document.createElement('canvas'); this.pic.width = N; this.pic.height = N;
    this.pg = this.pic.getContext('2d'); this.img = this.pg.createImageData(N, N);
  }
  setFrame(rgba) { this.tube.paintAll(rgba); this.img.data.set(rgba); this.pg.putImageData(this.img, 0, 0); }
  layout() { const r = this.canvas.getBoundingClientRect(), b = this.box || { x: 0, y: 0, w: r.width, h: r.height }; return glassRect(b.w, b.h, b.x, b.y); }
  render(o = {}) {
    const { w, h, dpr, cw, ch } = sizeCanvas(this.canvas), g = this.g, fx = o.fx == null ? 1 : o.fx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cw, ch);
    const bx = boxOf(o, cw, ch); this.box = bx;
    const G = glassRect(bx.w, bx.h, bx.x, bx.y), pad = (G.x - bx.x) * 0.6;
    if (fx > 0) {
      // The SSTV tube, bare (bezel and glass only), sized so its glass is G.
      // bare layout: glass = box inset by 3.5 % of the box (sstv/crt.js layout)
      const B = G.w / 0.93, q = (B - G.w) / 2;
      const box = { x: G.x - q, y: G.y - q, w: B, h: B };
      this.tube.render(g, { box, dpr, t: o.time || 0, bare: true, curve: fx, bloom: fx, flicker: fx, snow: (o.stat || 0) * 3, on: (o.power == null ? 1 : o.power) > 0.05 });
    } else {
      g.fillStyle = '#1b1a18'; g.fillRect(G.x - pad, G.y - pad, G.w + 2 * pad, G.h + 2 * pad);
      g.imageSmoothingEnabled = false; g.drawImage(this.pic, G.x, G.y, G.w, G.h);
      if (o.stat > 0) { g.fillStyle = `rgba(128,128,128,${o.stat})`; g.fillRect(G.x, G.y, G.w, G.h); }
    }
    void w; void h;
  }
  destroy() {}
}
