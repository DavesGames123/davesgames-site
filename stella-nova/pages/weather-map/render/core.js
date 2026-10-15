// ============================================================================
//  WEATHER MAP  ·  render/core.js — WebGPU device, frame uniform, layer list
// ----------------------------------------------------------------------------
//  createCore(canvas, { loadText, quality, baseUrl, fovY }) -> Promise<core>
//    loadText(path)  text of a page-relative file ('shaders/frame.wgsl',
//                    '../forge/shaders/sky.wgsl'); default: fetch next to
//                    the page. baseUrl: the page folder (for tex/).
//  core:
//    device, context, format, depthFormat ('depth24plus'), quality, fovY
//    frameLayout / frameGroup   group(0) binding(0) = struct Frame
//                    (shaders/frame.wgsl). Layers prepend frame.wgsl.
//    frameWGSL       the frame.wgsl text (layers may use it, no refetch)
//    addLayer(layer) / removeLayer(layer)   layer = { name, order,
//                    update(frame, app), encode(pass, frame), destroy() }
//    encoderHooks    [fn(encoder, frame)]: compute work before the pass
//    setCloudMap(view, bounds)  see render/globe.js
//    textures        Promise of the tex/ load status (started at boot)
//    render(cam, app) -> frame   one frame; resize(); destroy()
//    lastFrame       the frame of the last render (m: camera.js matrices in
//                    CSS px, for project / pick)
//    LAYER_DEPTH, PREMUL_BLEND  the pipeline states layers use
//
//  One render pass per frame: the globe (opaque, writes depth), the layers
//  by order ascending (depth test less-equal, no depth write, premultiplied
//  alpha), then the limb veil. No MSAA, no HDR target: the globe pass tone
//  maps, so layer colours are display-referred sRGB.
//
//  app fields read: t (epoch ms), lightMode ('real' | 'day'), exposure
//  (optional), focus ({ lat, lon } optional; else the camera target).
//
//  grep -n targets: "export async function createCore", "export function packFrame",
//  "export function frameSun", "export function backingSize", "export function qualityFor",
//  "render(cam, app)", "export const FRAME_FLOATS"
// ============================================================================
import { viewProj, FOV_Y } from '../camera.js';
import { sunDir, latLonToXYZ } from '../astro.js';
import { createGlobe } from './globe.js';

export const FRAME_FLOATS = 52;      // 208 bytes, struct Frame
export const DEPTH_FORMAT = 'depth24plus';
export const MAX_BACKING = { long: 2560, short: 1440 };
export const LAYER_DEPTH = { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'less-equal' };
export const PREMUL_BLEND = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};
export const DEFAULT_EXPOSURE = 1.1;

// 0 phone, 1 tablet, 2 desktop
export function qualityFor({ coarse, minSide }) {
  if (coarse && minSide < 600) return 0;
  if (coarse) return 1;
  return 2;
}

// Backing store in device px: dpr capped at 2 (1.5 on a phone), the long
// side at 2560 and the short side at 1440.
export function backingSize(cssW, cssH, dpr, quality = 2) {
  const d = Math.min(dpr || 1, quality === 0 ? 1.5 : 2);
  let w = Math.max(1, cssW * d), h = Math.max(1, cssH * d);
  const k = Math.min(1, MAX_BACKING.long / Math.max(w, h), MAX_BACKING.short / Math.min(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), scale: d * k };
}

// The light: the real sun at app.t, or the news 'day' sun that sits 22 deg
// south and 12 deg east of the camera target, so the whole view is lit.
export function frameSun(app, cam) {
  if ((app.lightMode || 'day') === 'real') return sunDir(app.t || Date.now());
  const lat = Math.max(-60, Math.min(60, cam.lat - 22));
  return latLonToXYZ(lat, cam.lon + 12, 1);
}

// frame: { m, sun, time, t, w, h, dpr, quality, exposure, lightMode, cam, focus, now }
export function packFrame(f, out = new Float32Array(FRAME_FLOATS)) {
  out.set(f.m.viewProj, 0);
  out.set(f.m.invViewProj, 16);
  const e = f.m.eye, s = f.sun, fo = f.focus || f.cam;
  const tanH = Math.tan(f.m.fovY / 2);
  out.set([
    e[0], e[1], e[2], f.time,
    s[0], s[1], s[2], f.lightMode === 'real' ? 0 : 1,
    f.w, f.h, f.dpr, f.quality,
    f.exposure, f.cam.alt, fo.lat, fo.lon,
    ((f.t || 0) - (f.now ?? f.t ?? 0)) / 3.6e6, (((f.t || 0) / 3.6e6) % 24 + 24) % 24, tanH, f.w / Math.max(f.h, 1),
  ], 32);
  return out;
}

const defaultLoadText = base => async path => {
  const r = await fetch(new URL(path, base));
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.text();
};

function detectQuality() {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const minSide = typeof screen !== 'undefined' ? Math.min(screen.width, screen.height) : 1080;
  return qualityFor({ coarse, minSide });
}

export async function createCore(canvas, opts = {}) {
  if (!navigator.gpu) throw new Error('WebGPU is not available');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice({
    requiredLimits: { maxTextureDimension2D: Math.min(8192, adapter.limits.maxTextureDimension2D) },
  });
  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  const baseUrl = opts.baseUrl || new URL('../', import.meta.url);
  const loadText = opts.loadText || defaultLoadText(baseUrl);
  const quality = opts.quality ?? detectQuality();

  const frameLayout = device.createBindGroupLayout({ label: 'weather frame', entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }] });
  const frameBuf = device.createBuffer({ label: 'weather frame', size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const frameGroup = device.createBindGroup({ label: 'weather frame', layout: frameLayout, entries: [{ binding: 0, resource: { buffer: frameBuf } }] });
  const framePack = new Float32Array(FRAME_FLOATS);
  const layers = [];
  const t0 = performance.now();
  let depth = null, cssW = 0, cssH = 0, lastNow = 0, destroyed = false;

  const core = {
    device, context, format, depthFormat: DEPTH_FORMAT, quality, baseUrl, loadText,
    fovY: opts.fovY || FOV_Y,
    frameLayout, frameGroup, frameWGSL: await loadText('shaders/frame.wgsl'),
    encoderHooks: [], layers, lastFrame: null, lost: false,
    LAYER_DEPTH, PREMUL_BLEND,
    addLayer(layer) {
      if (!layers.includes(layer)) layers.push(layer);
      layers.sort((a, b) => (a.order || 0) - (b.order || 0));
      return layer;
    },
    removeLayer(layer) {
      const i = layers.indexOf(layer);
      if (i >= 0) layers.splice(i, 1);
    },
    setCloudMap(view, bounds) { core.globe.setCloudMap(view, bounds); },
    resize() {
      cssW = Math.max(1, canvas.clientWidth || canvas.width || 1);
      cssH = Math.max(1, canvas.clientHeight || canvas.height || 1);
      const b = backingSize(cssW, cssH, globalThis.devicePixelRatio || 1, quality);
      if (canvas.width !== b.w || canvas.height !== b.h || !depth) {
        canvas.width = b.w; canvas.height = b.h;
        if (depth) depth.destroy();
        depth = device.createTexture({ label: 'weather depth', size: [b.w, b.h], format: DEPTH_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT });
      }
    },
    render(cam, app) {
      if (destroyed || core.lost) return null;
      if (!depth || canvas.clientWidth !== cssW || canvas.clientHeight !== cssH) core.resize();
      const now = performance.now();
      const dt = lastNow ? Math.min(0.25, (now - lastNow) / 1000) : 0;
      lastNow = now;
      const m = viewProj(cam, cssW, cssH, core.fovY);
      const focus = app.focus && Number.isFinite(app.focus.lat) && Number.isFinite(app.focus.lon) ? app.focus : cam;
      const frame = {
        cam, m, sun: frameSun(app, cam), t: app.t || Date.now(), now: Date.now(), time: (now - t0) / 1000, dt,
        w: canvas.width, h: canvas.height, cssW, cssH, dpr: canvas.width / cssW, quality,
        exposure: app.exposure ?? DEFAULT_EXPOSURE, lightMode: app.lightMode || 'day', focus,
      };
      device.queue.writeBuffer(frameBuf, 0, packFrame(frame, framePack));
      core.globe.update(frame, app);
      for (const l of layers) if (l.update) l.update(frame, app);
      const enc = device.createCommandEncoder();
      for (const hook of core.encoderHooks) hook(enc, frame);
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
        depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      });
      core.globe.encode(pass);
      for (const l of layers) {
        pass.setBindGroup(0, frameGroup);
        l.encode(pass, frame);
      }
      core.globe.encodeVeil(pass);
      pass.end();
      device.queue.submit([enc.finish()]);
      core.lastFrame = frame;
      return frame;
    },
    destroy() {
      destroyed = true;
      for (const l of layers.slice()) { try { l.destroy && l.destroy(); } catch { /* layer cleanup */ } }
      layers.length = 0;
      core.globe.destroy();
      if (depth) depth.destroy();
      frameBuf.destroy();
      device.destroy();
    },
  };
  device.lost.then(info => { core.lost = true; core.lostReason = info && info.message; });
  core.globe = await createGlobe(core);
  core.resize();
  // the tex/ maps stream in after boot; flat fallbacks draw until then
  core.textures = core.globe.loadTextures();
  return core;
}
