// engine.js — WebGPU renderer of the Tidal Currents page. No DOM beyond the
// canvas, and no libraries.
//
// loadDataset(baseUrl) fetches meta.json and the PNG textures of one location.
// createEngine(canvas, { mobile }) makes the device, the pipelines and the
// per-size resources. The engine gets one dataset at a time with setDataset()
// and one view rect at a time with setView().
//
// One render(hour, dt) call does these GPU passes:
//   1 field    compute  EOF textures + coefficient rows -> field (u, v, T, cov)
//   2 advect   compute  RK2 step of every particle, in screen space, through
//                       the field (sampled through the view rect)
//   3 trail    render   fade the trail texture in place, then add one line
//                       segment (prev -> pos) per particle
//   4 bright   render   lit image at 1/bloomDiv res, soft threshold -> bloom A
//   5 blur     render   separable Gaussian, A -> B -> A (twice on desktop)
//   6 final    render   lit image + bloom, tone map, coast line, vignette -> canvas
//
// The view rect {x0, y0, x1, y1} is in normalized extent coordinates (the
// raster of the dataset). Its aspect matches the canvas. Particles live in
// screen coordinates, so the advection speed in screen pixels does not change
// with the view.
//
// Coverage: mask.png (v2, 2x field res) sets the visible coast. base.R (field
// res) sets where particles respawn. A v1 dataset has no mask.png, so the
// engine uses base.png for both.
//
// Resources and their owners:
//   per device   pipelines, sampler, ramp texture, uniform buffers
//   per dataset  base, vel (2d array), temp, mask, field textures
//   per size     trail texture (r16float, canvas size), particle buffer,
//                two bloom textures (rgba16float, canvas size / bloomDiv)
//
// The CPU interpolates the coefficient rows with Catmull-Rom over hours
// (see function coefRows). The textures do not change with time.
//
// grep: function loadDataset  function createEngine  function coefRows
//       function particleCount  function waterFraction  TUNE  BLOOM  buildDevice  buildDataset
//       buildSize  render(  resize(  setView(  setDataset(  destroy(  readField(

import { rampAt } from './colormap.js';

// Visual constants. Change these to tune the look.
const TUNE = {
  particlesPerWater: 0.38,   // live particles per canvas pixel of visible water
  minParticles: 20000,
  maxParticles: 1600000,     // buffer cap (desktop)
  maxParticlesMobile: 700000,
  stepPxPer1080: 2.4,        // px per 60 fps frame at speedRef, per 1080 px of short side
  gamma: 0.6,                // step length = stepPx * (speed / speedRef)^gamma
  minLife: 40,               // frames at 60 fps
  maxLife: 150,
  fade: 0.955,               // trail kept per 60 fps frame
  lineGain: 0.14,            // density per segment
  lenRef: 1.5,               // segment px with full weight
  trailGain: 1.3,            // density -> 1 - exp(-d * gain)
  hairGain: 1.9,             // weight of the trail density in the lit image
  baseGlow: 0.12,            // water light without trails
  brightFloor: 0.4,          // brightness of still water (0..1)
  brightGamma: 0.8,          // brightness = floor + (1 - floor) * (speed / speedRef)^gamma
  hairWhite: 0.1,            // how far a dense trail moves toward white
  pastel: 0.04,              // how far every water color moves toward white
  speedWhite: 0.12,          // extra move toward white, times (speed / speedRef)^2
  white: 0.2,                // how far the brightest water moves toward white
  exposure: 1.8,
  bloom: 1.1,                // bloom strength
  bloomThreshold: 0.7,       // lit luminance below this adds no bloom
  bloomLand: 0.5,            // bloom kept over land (0..1), a soft halo at the coast
  coast: 0.17,               // coast line gray level
  vignette: 1.0,
};

// Bloom cost per device class. div: bloom texture = canvas / div.
// radius: Gaussian taps each side. passes: blur iterations (H + V each).
const BLOOM = {
  desktop: { div: 4, radius: 6, passes: 2 },
  mobile: { div: 6, radius: 4, passes: 1 },
};

const SHADERS = ['field', 'advect', 'trail', 'composite', 'blur'];

// Fetch one dataset. baseUrl is the folder of meta.json ('data/sf-bay/').
export async function loadDataset(baseUrl) {
  let base = String(baseUrl);
  if (!base.endsWith('/')) base += '/';
  const root = new URL(base, location.href);
  const metaRes = await fetch(new URL('meta.json', root));
  if (!metaRes.ok) throw new Error(`meta.json fetch failed (${metaRes.status}) at ${root}`);
  const meta = await metaRes.json();
  const img = async (name) => {
    const res = await fetch(new URL(name, root));
    if (!res.ok) throw new Error(`${name} fetch failed (${res.status})`);
    return createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  };
  const nVel = Math.ceil((meta.velModes || 12) / 2);
  const hasMask = (meta.version || 1) >= 2;
  const [b, t, mask, ...vel] = await Promise.all([
    img('base.png'), img('temp.png'), hasMask ? img('mask.png') : Promise.resolve(null),
    ...Array.from({ length: nVel }, (_, i) => img(`vel${i}.png`)),
  ]);
  return { meta, images: { base: b, vel, temp: t, mask } };
}

// Catmull-Rom interpolation of the coefficient rows at a fractional hour.
// Writes 16 velocity and 4 temperature coefficients into out.
function coefRows(meta, hour, out) {
  const n = meta.velCoef.length;
  const h = Math.min(Math.max(hour, 0), n - 1);
  const i = Math.min(Math.floor(h), n - 2);
  const t = h - i;
  const r = (k) => Math.min(Math.max(i + k, 0), n - 1);
  const t2 = t * t, t3 = t2 * t;
  const w0 = -0.5 * t3 + t2 - 0.5 * t;
  const w1 = 1.5 * t3 - 2.5 * t2 + 1;
  const w2 = -1.5 * t3 + 2 * t2 + 0.5 * t;
  const w3 = 0.5 * t3 - 0.5 * t2;
  const mix = (rows, dst, off, count) => {
    const a = rows[r(-1)], b = rows[r(0)], c = rows[r(1)], d = rows[r(2)];
    for (let k = 0; k < count; k++) {
      dst[off + k] = k < a.length ? w0 * a[k] + w1 * b[k] + w2 * c[k] + w3 * d[k] : 0;
    }
  };
  mix(meta.velCoef, out, 0, 16);
  mix(meta.tempCoef, out, 16, 4);
  return out;
}

// Particle count for a canvas of w x h pixels with water fraction frac.
// The live count follows the visible water, so the trail density per water
// pixel does not change with the view or the location.
function particleCount(w, h, frac, cap) {
  const n = Math.round(w * h * frac * TUNE.particlesPerWater);
  return Math.min(Math.max(n, TUNE.minParticles), cap);
}

// A small CPU copy of the coverage (mask.png) for the water fraction of a view.
function coverageGrid(bmp) {
  if (!bmp || typeof OffscreenCanvas === 'undefined') return null;
  const gw = 256, gh = Math.max(1, Math.round(256 * bmp.height / bmp.width));
  const cv = new OffscreenCanvas(gw, gh);
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, gw, gh);
  const px = g.getImageData(0, 0, gw, gh).data;
  const cov = new Float32Array(gw * gh);
  for (let i = 0; i < cov.length; i++) cov[i] = px[i * 4] / 255;
  return { gw, gh, cov };
}

// Mean coverage inside the view rect. Without a grid, assume a typical 0.25.
function waterFraction(grid, v) {
  if (!grid) return 0.25;
  const { gw, gh, cov } = grid;
  const x0 = Math.max(0, Math.floor(v[0] * gw)), x1 = Math.min(gw, Math.max(x0 + 1, Math.ceil(v[2] * gw)));
  const y0 = Math.max(0, Math.floor(v[1] * gh)), y1 = Math.min(gh, Math.max(y0 + 1, Math.ceil(v[3] * gh)));
  let sum = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += cov[y * gw + x];
  return Math.max(sum / ((x1 - x0) * (y1 - y0)), 0.01);
}

async function fetchShaders() {
  const pairs = await Promise.all(SHADERS.map(async (name) => {
    const res = await fetch(new URL(`shaders/${name}.wgsl`, import.meta.url));
    if (!res.ok) throw new Error(`shader fetch failed (${res.status}): ${name}.wgsl`);
    return [name, await res.text()];
  }));
  return Object.fromEntries(pairs);
}

export async function createEngine(canvas, opts = {}) {
  if (!navigator.gpu) throw new Error('webgpu-unavailable');
  const code = await fetchShaders();
  const ctx = canvas.getContext('webgpu');
  if (!ctx) throw new Error('webgpu-unavailable');
  const format = navigator.gpu.getPreferredCanvasFormat();
  const U = GPUBufferUsage, T = GPUTextureUsage;
  const bloomCfg = opts.mobile ? BLOOM.mobile : BLOOM.desktop;
  const cap = opts.mobile ? TUNE.maxParticlesMobile : TUNE.maxParticles;
  let grid = null;         // coverage grid of the current dataset
  let active = 0;          // live particles (<= sizeGpu.count)

  // State that lives across device rebuilds.
  let dev = null;          // per-device objects
  let dsGpu = null;        // per-dataset objects
  let sizeGpu = null;      // per-size objects
  let binds = null;        // bind groups that join the three
  let ds = null;           // current dataset (CPU side)
  let view = [0, 0, 1, 1]; // x0, y0, x1, y1 in extent coordinates
  let width = Math.max(1, canvas.width | 0), height = Math.max(1, canvas.height | 0);
  let reseed = true, clearTrail = true, frame = 0;
  let destroyed = false, rebuilding = false, lostOnce = false;
  let fpsEma = 60;
  const coefs = new Float32Array(20);
  const fieldU = new Float32Array(24);
  const advU = new ArrayBuffer(64);
  const advF = new Float32Array(advU), advI = new Uint32Array(advU);
  const trailU = new Float32Array(4);
  const compU = new Float32Array(28);

  async function buildDevice() {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('webgpu-unavailable');
    const device = await adapter.requestDevice();
    ctx.configure({ device, format, alphaMode: 'opaque' });

    const mod = {};
    for (const name of SHADERS) {
      mod[name] = device.createShaderModule({ code: code[name], label: name });
      const info = await mod[name].getCompilationInfo();
      const errs = info.messages.filter((m) => m.type === 'error');
      if (errs.length) throw new Error(`${name}.wgsl: ` + errs.map((m) => `${m.lineNum}: ${m.message}`).join('; '));
    }
    const screen = (module, fs, fmt, blend) => device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module, entryPoint: module === mod.trail ? 'vsFade' : 'vs' },
      fragment: { module, entryPoint: fs, targets: [blend ? { format: fmt, blend } : { format: fmt }] },
      primitive: { topology: 'triangle-list' },
    });
    const [fieldPipe, advectPipe, fadePipe, linePipe, brightPipe, blurPipe, finalPipe] = await Promise.all([
      device.createComputePipelineAsync({ layout: 'auto', compute: { module: mod.field, entryPoint: 'main' } }),
      device.createComputePipelineAsync({ layout: 'auto', compute: { module: mod.advect, entryPoint: 'main' } }),
      screen(mod.trail, 'fsFade', 'r16float', {
        color: { srcFactor: 'zero', dstFactor: 'constant', operation: 'add' },
        alpha: { srcFactor: 'zero', dstFactor: 'constant', operation: 'add' },
      }),
      device.createRenderPipelineAsync({
        layout: 'auto',
        vertex: { module: mod.trail, entryPoint: 'vsLine' },
        fragment: { module: mod.trail, entryPoint: 'fsLine', targets: [{
          format: 'r16float',
          blend: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                   alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } },
        }] },
        primitive: { topology: 'line-list' },
      }),
      screen(mod.composite, 'fsBright', 'rgba16float'),
      screen(mod.blur, 'fs', 'rgba16float'),
      screen(mod.composite, 'fsFinal', format),
    ]);

    // 256x1 ramp texture from colormap.js.
    const ramp = device.createTexture({ size: [256, 1], format: 'rgba8unorm', usage: T.TEXTURE_BINDING | T.COPY_DST });
    const px = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const c = rampAt(i / 255);
      px.set([c[0] * 255, c[1] * 255, c[2] * 255, 255].map(Math.round), i * 4);
    }
    device.queue.writeTexture({ texture: ramp }, px, { bytesPerRow: 1024 }, [256, 1]);

    const linear = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    const buf = (size) => device.createBuffer({ size, usage: U.UNIFORM | U.COPY_DST });
    const d = {
      device, fieldPipe, advectPipe, fadePipe, linePipe, brightPipe, blurPipe, finalPipe, ramp, linear,
      fieldBuf: buf(96), advBuf: buf(64), trailBuf: buf(16), compBuf: buf(112),
      blurBufs: [buf(16), buf(16)],   // 0: horizontal, 1: vertical
    };
    device.addEventListener('uncapturederror', (e) => console.error('tidal-currents: GPU error:', e.error.message));
    device.lost.then((info) => onLost(d, info));
    return d;
  }

  function buildDataset() {
    const { device } = dev;
    const { meta, images } = ds;
    const w = meta.width, h = meta.height;
    const usage = T.TEXTURE_BINDING | T.COPY_DST | T.RENDER_ATTACHMENT;
    const up = (bmp, tex, z = 0) => device.queue.copyExternalImageToTexture(
      { source: bmp }, { texture: tex, origin: [0, 0, z], premultipliedAlpha: false }, [bmp.width, bmp.height]);
    const base = device.createTexture({ size: [w, h], format: 'rgba8unorm', usage });
    const temp = device.createTexture({ size: [w, h], format: 'rgba8unorm', usage });
    const vel = device.createTexture({ size: [w, h, images.vel.length], format: 'rgba8unorm', usage });
    up(images.base, base);
    up(images.temp, temp);
    images.vel.forEach((bmp, i) => up(bmp, vel, i));
    let mask = null;
    if (images.mask) {
      mask = device.createTexture({ size: [images.mask.width, images.mask.height], format: 'rgba8unorm', usage });
      up(images.mask, mask);
    }
    const field = device.createTexture({ size: [w, h], format: 'rgba16float',
      usage: T.STORAGE_BINDING | T.TEXTURE_BINDING | T.COPY_SRC });
    const fieldBind = device.createBindGroup({
      layout: dev.fieldPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: dev.fieldBuf } },
        { binding: 1, resource: base.createView() },
        { binding: 2, resource: vel.createView({ dimension: '2d-array' }) },
        { binding: 3, resource: temp.createView() },
        { binding: 4, resource: field.createView() },
      ],
    });
    return { base, temp, vel, mask, field, fieldBind, w, h, maskW: mask ? images.mask.width : w };
  }

  function buildSize() {
    const { device } = dev;
    const count = particleCount(width, height, 1, cap);   // buffer for a view full of water
    const particles = device.createBuffer({ size: count * 32, usage: U.STORAGE });
    const trail = device.createTexture({ size: [width, height], format: 'r16float',
      usage: T.RENDER_ATTACHMENT | T.TEXTURE_BINDING });
    const bw = Math.max(1, Math.ceil(width / bloomCfg.div)), bh = Math.max(1, Math.ceil(height / bloomCfg.div));
    const bloomTex = () => device.createTexture({ size: [bw, bh], format: 'rgba16float',
      usage: T.RENDER_ATTACHMENT | T.TEXTURE_BINDING });
    const bloomA = bloomTex(), bloomB = bloomTex();
    device.queue.writeBuffer(dev.blurBufs[0], 0, new Float32Array([1 / bw, 0, bloomCfg.radius, 0]));
    device.queue.writeBuffer(dev.blurBufs[1], 0, new Float32Array([0, 1 / bh, bloomCfg.radius, 0]));
    return {
      count, particles, trail, trailView: trail.createView(), w: width, h: height,
      bloomA, bloomB, viewA: bloomA.createView(), viewB: bloomB.createView(), bw, bh,
    };
  }

  function updateActive() {
    if (!sizeGpu) return;
    active = Math.min(particleCount(width, height, waterFraction(grid, view), cap), sizeGpu.count);
    engine.info.particles = active;
  }

  // Bind groups that join the dataset, the size resources and the device.
  function buildBinds() {
    if (!dsGpu || !sizeGpu) return null;
    const { device } = dev;
    const fieldView = dsGpu.field.createView();
    const maskView = (dsGpu.mask || dsGpu.base).createView();
    const comp = (pipe, withBloom) => device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: dev.compBuf } },
      { binding: 1, resource: fieldView },
      { binding: 2, resource: dev.linear },
      { binding: 3, resource: sizeGpu.trailView },
      { binding: 4, resource: dev.ramp.createView() },
      { binding: 5, resource: maskView },
      ...(withBloom ? [{ binding: 6, resource: sizeGpu.viewA }] : []),
    ] });
    const blur = (i, src) => device.createBindGroup({ layout: dev.blurPipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: dev.blurBufs[i] } },
      { binding: 1, resource: src },
      { binding: 2, resource: dev.linear },
    ] });
    return {
      advect: device.createBindGroup({ layout: dev.advectPipe.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: dev.advBuf } },
        { binding: 1, resource: { buffer: sizeGpu.particles } },
        { binding: 2, resource: fieldView },
        { binding: 3, resource: dev.linear },
      ] }),
      line: device.createBindGroup({ layout: dev.linePipe.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: dev.trailBuf } },
        { binding: 1, resource: { buffer: sizeGpu.particles } },
      ] }),
      bright: comp(dev.brightPipe, false),
      final: comp(dev.finalPipe, true),
      blurH: blur(0, sizeGpu.viewA),   // A -> B
      blurV: blur(1, sizeGpu.viewB),   // B -> A
    };
  }

  function freeDataset() {
    if (!dsGpu) return;
    for (const k of ['base', 'temp', 'vel', 'mask', 'field']) if (dsGpu[k]) dsGpu[k].destroy();
    dsGpu = null;
  }
  function freeSize() {
    if (!sizeGpu) return;
    for (const k of ['particles', 'trail', 'bloomA', 'bloomB']) sizeGpu[k].destroy();
    sizeGpu = null;
  }

  async function onLost(d, info) {
    if (destroyed || d !== dev || info.reason === 'destroyed') return;
    console.warn('tidal-currents: GPU device lost:', info.message);
    dev = null; dsGpu = null; sizeGpu = null; binds = null;
    if (lostOnce) return;
    lostOnce = true;
    rebuilding = true;
    try {
      dev = await buildDevice();
      sizeGpu = buildSize();
      if (ds) dsGpu = buildDataset();
      binds = buildBinds();
      updateActive();
      reseed = true; clearTrail = true;
      console.warn('tidal-currents: GPU device rebuilt');
    } catch (e) {
      console.error('tidal-currents: GPU rebuild failed:', e);
      dev = null;
    } finally {
      rebuilding = false;
    }
  }

  dev = await buildDevice();
  sizeGpu = buildSize();
  active = sizeGpu.count;

  const engine = {
    info: { particles: sizeGpu.count, fpsHint: 60 },

    // Swap the dataset. Frees the old textures and reseeds the particles.
    setDataset(next) {
      ds = next;
      grid = coverageGrid(next.images.mask);
      updateActive();
      if (!dev) return;
      freeDataset();
      dsGpu = buildDataset();
      binds = buildBinds();
      reseed = true; clearTrail = true;
    },

    // Set the view rect {x0, y0, x1, y1} in normalized extent coordinates.
    // A new rect reseeds the particles, because they live in screen space.
    setView(rect) {
      const next = rect ? [rect.x0, rect.y0, rect.x1, rect.y1].map(Number) : [0, 0, 1, 1];
      if (next.some((v) => !Number.isFinite(v))) return;
      if (next.every((v, i) => Math.abs(v - view[i]) < 1e-6)) return;
      view = next;
      updateActive();
      reseed = true; clearTrail = true;
    },

    // Set the canvas backing size in device pixels.
    resize(pixelW, pixelH) {
      const w = Math.max(1, Math.round(pixelW)), h = Math.max(1, Math.round(pixelH));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      if (w === width && h === height && sizeGpu) return;
      width = w; height = h;
      if (!dev) return;
      freeSize();
      sizeGpu = buildSize();
      binds = buildBinds();
      updateActive();
      reseed = true; clearTrail = true;
    },

    // Advect and draw one frame. hour is a float in 0..hours-1.
    render(hour, dtSeconds = 1 / 60) {
      if (destroyed || rebuilding || !dev || !binds || !ds) return;
      const { device } = dev;
      const meta = ds.meta;
      const dt = Math.min(Math.max(dtSeconds || 0, 0), 0.1);
      if (dt > 0) fpsEma += (1 / dt - fpsEma) * 0.05;
      engine.info.fpsHint = Math.round(fpsEma);
      const dtScale = dt * 60;
      frame = (frame + 1) >>> 0;

      coefRows(meta, hour, coefs);
      fieldU.set(coefs.subarray(0, 20), 0);
      fieldU.set([meta.meanVelScale, meta.tempC.min, meta.tempC.max, meta.velModes || 12], 20);
      device.queue.writeBuffer(dev.fieldBuf, 0, fieldU);

      const short = Math.min(width, height);
      advF.set([width, height, TUNE.stepPxPer1080 * short / 1080, meta.speedRef, dtScale, TUNE.gamma,
        TUNE.minLife, TUNE.maxLife], 0);
      advI.set([active, reseed ? 1 : 0, frame, 0], 8);
      advF.set(view, 12);
      device.queue.writeBuffer(dev.advBuf, 0, advU);
      // Scale the deposit by the frame time, so the trail density does not change with the refresh rate.
      trailU.set([width, height, TUNE.lineGain * Math.max(dtScale, 0.25), TUNE.lenRef]);
      device.queue.writeBuffer(dev.trailBuf, 0, trailU);
      compU.set([width, height, meta.legendF.min, meta.legendF.max,
        meta.speedRef, TUNE.trailGain, TUNE.baseGlow, TUNE.exposure,
        frame % 64, TUNE.coast, TUNE.vignette, TUNE.brightFloor,
        TUNE.brightGamma, TUNE.white, TUNE.hairWhite, TUNE.pastel,
        TUNE.speedWhite, dsGpu.maskW, TUNE.hairGain, TUNE.bloom,
        TUNE.bloomThreshold, bloomCfg.div, TUNE.bloomLand, 0], 0);
      compU.set(view, 24);
      device.queue.writeBuffer(dev.compBuf, 0, compU);

      const enc = device.createCommandEncoder();
      const cp = enc.beginComputePass();
      cp.setPipeline(dev.fieldPipe);
      cp.setBindGroup(0, dsGpu.fieldBind);
      cp.dispatchWorkgroups(Math.ceil(dsGpu.w / 8), Math.ceil(dsGpu.h / 8));
      cp.setPipeline(dev.advectPipe);
      cp.setBindGroup(0, binds.advect);
      cp.dispatchWorkgroups(Math.ceil(active / 256));   // maxParticles keeps this under 65535
      cp.end();

      const fade = clearTrail ? 0 : Math.pow(TUNE.fade, dtScale);
      const tp = enc.beginRenderPass({ colorAttachments: [{
        view: sizeGpu.trailView, loadOp: clearTrail ? 'clear' : 'load', storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }] });
      if (!clearTrail) {
        tp.setPipeline(dev.fadePipe);
        tp.setBlendConstant({ r: fade, g: fade, b: fade, a: fade });
        tp.draw(3);
      }
      tp.setPipeline(dev.linePipe);
      tp.setBindGroup(0, binds.line);
      tp.draw(active * 2);
      tp.end();

      // One fullscreen triangle into target with the given pipeline and bind group.
      const screenPass = (target, pipe, bind) => {
        const p = enc.beginRenderPass({ colorAttachments: [{
          view: target, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }] });
        p.setPipeline(pipe);
        p.setBindGroup(0, bind);
        p.draw(3);
        p.end();
      };
      screenPass(sizeGpu.viewA, dev.brightPipe, binds.bright);
      for (let i = 0; i < bloomCfg.passes; i++) {
        screenPass(sizeGpu.viewB, dev.blurPipe, binds.blurH);
        screenPass(sizeGpu.viewA, dev.blurPipe, binds.blurV);
      }
      screenPass(ctx.getCurrentTexture().createView(), dev.finalPipe, binds.final);
      device.queue.submit([enc.finish()]);
      reseed = false; clearTrail = false;
    },

    // Debug: read back the field texel at data pixel (x, y) as [u, v, T, cov].
    async readField(x, y) {
      if (!dev || !dsGpu) return null;
      const { device } = dev;
      const out = device.createBuffer({ size: 256, usage: U.COPY_DST | U.MAP_READ });
      const enc = device.createCommandEncoder();
      enc.copyTextureToBuffer({ texture: dsGpu.field, origin: [x, y] }, { buffer: out, bytesPerRow: 256 }, [1, 1]);
      device.queue.submit([enc.finish()]);
      await out.mapAsync(GPUMapMode.READ);
      const h = new Uint16Array(out.getMappedRange().slice(0, 8));
      out.destroy();
      const half = (b) => {
        const s = b & 0x8000 ? -1 : 1, e = (b >> 10) & 31, m = b & 1023;
        if (e === 0) return s * m * 2 ** -24;
        if (e === 31) return m ? NaN : s * Infinity;
        return s * (1 + m / 1024) * 2 ** (e - 15);
      };
      return Array.from(h, half);
    },

    destroy() {
      destroyed = true;
      freeDataset();
      freeSize();
      if (dev) {
        dev.ramp.destroy();
        for (const b of ['fieldBuf', 'advBuf', 'trailBuf', 'compBuf']) dev[b].destroy();
        dev.blurBufs.forEach((b) => b.destroy());
        dev.device.destroy();
      }
      dev = null; binds = null;
    },
  };
  engine._tune = TUNE;   // debug handle for look tuning from the console
  engine._gpuDone = () => (dev ? dev.device.queue.onSubmittedWorkDone() : Promise.resolve());
  return engine;
}
