// ============================================================================
//  MATERIAL STUDIO  ·  viewport/offscreen.js — offscreen render, readback, screenshots
// ────────────────────────────────────────────────────────────────────────────
//  Renders one frame into an offscreen texture of any size with its own
//  targets, reads it back as RGBA8 and then asks for a canvas frame again.
//  screenshot() makes a PNG Blob of that frame. The HUD "PNG" button saves
//  it as a file through saveScreenshot().
//
//  GREP TARGETS
//      renderOffscreen ........ {width, height, data} RGBA8
//      readback ............... texture to RGBA8, BGRA swizzle
//      screenshot ............. PNG Blob
//      screenshotDataURL ...... PNG data URL
//      saveScreenshot ......... download the PNG
// ============================================================================
import { gpu, device, store, state, canvas, cam, clamp } from './state.js';
import { aaMode, makeTargets, destroyTargets } from './targets.js';
import { renderScene, requestRender } from './render.js';

/**
 * Render one frame into an offscreen texture and read it back.
 * @param {{width?:number, height?:number, debug?:string, set?:object, compare?:boolean}} [o]
 * @returns {Promise<{width:number, height:number, data:Uint8ClampedArray}>} RGBA8
 */
export async function renderOffscreen(o = {}) {
  if (!device) throw new Error('no WebGPU device');
  const w = clamp(Math.round(o.width || canvas.width), 1, 4096), h = clamp(Math.round(o.height || canvas.height), 1, 4096);
  const { samples, fxaa } = aaMode();
  const fmt = gpu.format;
  const T = makeTargets(w, h, samples, fxaa, fmt);
  const out = device.createTexture({ label: 'vp-shot', size: [w, h, 1], format: fmt, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const aspect = canvas.width / Math.max(1, canvas.height);
  cam.update(0, w / h);
  try { renderScene(T, out.createView(), o); }
  finally { cam.update(0, aspect); }
  const data = await readback(out, w, h, fmt);
  out.destroy(); destroyTargets(T);
  requestRender();
  return { width: w, height: h, data };
}

async function readback(tex, w, h, fmt) {
  const bpr = Math.ceil((w * 4) / 256) * 256;
  const buf = device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: h }, [w, h, 1]);
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(buf.getMappedRange());
  const data = new Uint8ClampedArray(w * h * 4);
  const bgra = fmt.startsWith('bgra');
  for (let y = 0; y < h; y++) {
    const so = y * bpr, d = y * w * 4;
    for (let x = 0; x < w; x++) {
      const s = so + x * 4, t = d + x * 4;
      data[t] = bgra ? src[s + 2] : src[s]; data[t + 1] = src[s + 1]; data[t + 2] = bgra ? src[s] : src[s + 2]; data[t + 3] = 255;
    }
  }
  buf.unmap(); buf.destroy();
  return data;
}

/**
 * PNG of the viewport. Default size: the canvas size.
 * @param {{width?:number, height?:number, debug?:string, type?:string}} [o]
 * @returns {Promise<Blob>}
 */
export async function screenshot(o = {}) {
  const img = await renderOffscreen(o);
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), o.type || 'image/png'));
}
/** Same as screenshot, as a data URL (handy for headless checks). */
export async function screenshotDataURL(o = {}) {
  const b = await screenshot(o);
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
}
export async function saveScreenshot() {
  try {
    const b = await screenshot({ width: canvas.width, height: canvas.height });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `material-${(state.graph && state.graph.name) || 'preview'}-${state.view.debug}.png`.replace(/[^\w.-]+/g, '_');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) { store.toast('Screenshot failed: ' + e.message, 'error'); }
}
