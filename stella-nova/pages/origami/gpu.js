// gpu.js -- the WebGPU device, the canvas, and the multisampled colour target.
//
// Replaces the native src/gpu.rs. The native layer also carried the forge quad
// GUI and its glyph atlas (gui.rs, font.rs, gui.wgsl). The web page draws its
// controls in the DOM instead, so only the device, the surface, and the MSAA
// target are kept here.
//
// Colour: the native surface is Bgra8UnormSrgb and the theme is linear. Here
// the canvas is configured with an sRGB view format when the browser allows it,
// so blending happens in linear light as in the app. When it does not, the
// shaders encode to sRGB themselves (screen.size.z = 1).
//
// Every colour target is multisampled at SAMPLES, as in the native app. The
// native depth attachment is dropped: no native pipeline tests or writes depth.
//
// grep map:
//   initGpu      -- adapter, device, canvas context, sRGB probe; null on failure
//   SAMPLES      -- the MSAA sample count, named once
//   Gpu.resize   -- size the canvas and the MSAA texture
//   Gpu.frame    -- one pass: clear, then each pane's fills and lines, scissored

import { TriPass } from './tris.js';
import { LinePass } from './lines.js';

export const SAMPLES = 4;

// Linear to sRGB, for the clear colour when the shaders encode.
function encodeSrgb(x) { return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; }

// Returns { gpu } on success, or { error } with a message for the page.
export async function initGpu(canvas, shaderText) {
  if (!navigator.gpu) return { error: 'This page needs WebGPU. Open it in a current Chrome, Edge or Safari.' };
  let adapter = null;
  try { adapter = await navigator.gpu.requestAdapter(); } catch { adapter = null; }
  if (!adapter) return { error: 'No WebGPU adapter is available on this device.' };
  const device = await adapter.requestDevice();
  const ctx = canvas.getContext('webgpu');
  if (!ctx) return { error: 'The browser has WebGPU but gave no WebGPU canvas context.' };
  const format = navigator.gpu.getPreferredCanvasFormat();
  const srgb = format + '-srgb';

  // Probe the sRGB view. A failed configure or view is a validation error, so
  // catch it in an error scope rather than as an exception.
  let viewFormat = srgb;
  device.pushErrorScope('validation');
  try {
    ctx.configure({ device, format, viewFormats: [srgb], alphaMode: 'opaque' });
    ctx.getCurrentTexture().createView({ format: srgb });
  } catch { viewFormat = format; }
  const err = await device.popErrorScope();
  if (err) viewFormat = format;
  if (viewFormat === format) ctx.configure({ device, format, alphaMode: 'opaque' });

  const gpu = new Gpu(device, ctx, canvas, format, viewFormat, shaderText);
  return { gpu };
}

export class Gpu {
  constructor(device, ctx, canvas, format, viewFormat, shaders) {
    this.device = device;
    this.ctx = ctx;
    this.canvas = canvas;
    this.format = format;
    this.viewFormat = viewFormat;
    // 1 when the shaders must encode to sRGB themselves.
    this.encode = viewFormat === format ? 1 : 0;
    this.msaa = null;
    this.fills = new TriPass(device, viewFormat, shaders.tris);
    this.lines = new LinePass(device, viewFormat, shaders.lines);
  }

  // Size the canvas backing store and the MSAA target, in physical pixels.
  resize(w, h) {
    w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
    if (this.canvas.width === w && this.canvas.height === h && this.msaa) return;
    this.canvas.width = w;
    this.canvas.height = h;
    if (this.msaa) this.msaa.destroy();
    this.msaa = this.device.createTexture({
      size: [w, h], sampleCount: SAMPLES, format: this.viewFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  // One frame. `panes` is a list of { rect, tris, lines, over } in physical
  // pixels. Each pane draws clipped to its own rect, as in app.rs frame: the
  // fills, then the lines, then `over`, the fills the native quad pass drew on
  // top (the vertex dots).
  frame(clear, panes) {
    const w = this.canvas.width, h = this.canvas.height;
    const triLists = [];
    for (const p of panes) triLists.push(p.tris, p.over || []);
    const triOff = this.fills.upload(triLists, w, h, this.encode);
    const lnOff = this.lines.upload(panes.map((p) => p.lines), w, h, this.encode);
    const c = this.encode ? clear.map(encodeSrgb) : clear;

    const view = this.ctx.getCurrentTexture().createView({ format: this.viewFormat });
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: this.msaa.createView(), resolveTarget: view,
        clearValue: { r: c[0], g: c[1], b: c[2], a: 1 },
        loadOp: 'clear', storeOp: 'discard',
      }],
    });
    panes.forEach((p, i) => {
      const r = p.rect;
      const x0 = Math.min(Math.max(r[0], 0), w), y0 = Math.min(Math.max(r[1], 0), h);
      const x1 = Math.min(Math.max(r[2], 0), w), y1 = Math.min(Math.max(r[3], 0), h);
      if (x1 - x0 < 1 || y1 - y0 < 1) return;
      pass.setScissorRect(Math.floor(x0), Math.floor(y0), Math.max(1, Math.floor(x1 - x0)), Math.max(1, Math.floor(y1 - y0)));
      this.fills.draw(pass, triOff[2 * i], p.tris.length / TriPass.FLOATS);
      this.lines.draw(pass, lnOff[i], p.lines.length / LinePass.FLOATS);
      if (p.over && p.over.length) this.fills.draw(pass, triOff[2 * i + 1], p.over.length / TriPass.FLOATS);
    });
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }
}
