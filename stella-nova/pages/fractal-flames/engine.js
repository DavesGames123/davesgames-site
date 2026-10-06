// ============================================================================
//  FRACTAL FLAMES  ·  engine.js — the WebGPU renderer
// ----------------------------------------------------------------------------
//  A port of flam3 by Scott Draves and the flam3 authors,
//  https://github.com/scottdraves/flam3 (flam3 is Copyright (C) 1992-2009
//  Spotworks LLC). This file ports the render loop of rect.c (camera,
//  bounds, k1 and k2, the sample count) and filters.c
//  (flam3_create_de_filters, flam3_create_spatial_filter) to WebGPU.
//
//  SPDX-License-Identifier: GPL-3.0-or-later
//  This program is free software: you can redistribute it and/or modify it
//  under the terms of the GNU General Public License as published by the
//  Free Software Foundation, either version 3 of the License, or (at your
//  option) any later version. It is distributed WITHOUT ANY WARRANTY. See
//  the file LICENSE in this directory.
//
//  Per frame: (decay) -> iterate -> de -> display.
//    iterate   flame.wgsl: nWalkers walkers, iters steps each, splat into
//              the u32 histogram (SCALE per hit).
//    decay     flame.wgsl: histogram *= decay. Only in "moving" mode (the
//              genome or the camera changes every frame).
//    de        render.wgsl: log-density scale + density estimation gather.
//    display   render.wgsl: spatial filter + tone map into the canvas.
//  In "still" mode the histogram accumulates until the sample count reaches
//  quality x (frame pixels), then the GPU idles. A change to the genome or
//  the camera clears it.
//
//  API (grep -n "^  [a-zA-Z]*(" engine.js):
//    const E = await createEngine(canvas, { mobile })   throws on no WebGPU
//    E.setGenome(g, { reset })   pack and upload; reset clears the histogram
//    E.setView(rect)             the genome frame in canvas px {x, y, w, h}
//    E.setMoving(on, decay)      decay mode on or off
//    E.resize(w, h)              canvas backing size in px
//    E.frame()                   one frame of GPU work (call from rAF)
//    E.stats                     { samples, target, density, iters, gpuMs, ... }
//    E.camera()                  { ppu, ox, oy, fit } of the current frame
//    E.onLost = info => {}
// ============================================================================
import { packGenome, MAX_XF, XF_BLOCK, DIST_GRAIN } from './genome.js';

const SCALE = 32;           // histogram fixed point: units per hit
const N_WALKERS = { desktop: 65536, mobile: 16384 };
const FUSE = 20;

async function loadText(rel) {
  const r = await fetch(new URL(rel, import.meta.url));
  if (!r.ok) throw new Error(`fetch ${rel}: ${r.status}`);
  return r.text();
}
async function compile(device, code, label) {
  device.pushErrorScope('validation');
  const module = device.createShaderModule({ code, label });
  const info = await module.getCompilationInfo();
  const err = await device.popErrorScope();
  const msgs = info.messages.filter(m => m.type === 'error');
  if (msgs.length || err) throw new Error(`${label}: ` + (msgs.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ') || err.message));
  return module;
}

// flam3_create_de_filters: one (width, 1 / kernel sum) pair per filter
// index. The gaussian constant cancels, so the sum leaves it out.
// maxRad is capped at rmax (the tile apron of render.wgsl).
export function deFilters(maxRad, minRad, curve, rmax = 9) {
  maxRad = Math.min(maxRad, rmax); minRad = Math.min(minRad, maxRad);
  if (!(maxRad > 0) || !(curve > 0)) return null;
  const keep = 100, DE_THRESH = 100;
  const cmax = maxRad + 1, cmin = minRad + 1;
  const nd = Math.pow(cmax / cmin, 1 / curve);
  if (nd > 1e7) return null;
  const nf = Math.ceil(nd);
  let maxInd, maxCounts;
  if (nf > keep) {
    maxInd = Math.ceil(DE_THRESH + Math.pow(nf - DE_THRESH, curve)) + 1;
    maxCounts = Math.trunc(Math.pow(maxInd - DE_THRESH, 1 / curve)) + DE_THRESH;
  } else { maxInd = nf; maxCounts = maxInd; }
  const half = Math.ceil(cmax) - 1;
  const tab = new Float32Array(Math.max(2, maxInd * 2));
  let maxIdx = 0;
  for (let fl = 0; fl < maxInd; fl++) {
    let h = fl < keep ? cmax / Math.pow(fl + 1, curve) : cmax / Math.pow(Math.pow(fl - keep, 1 / curve) + keep + 1, curve);
    if (h <= cmin) { h = cmin; maxIdx = fl; }
    let s = 0;
    for (let j = -half; j <= half; j++) for (let k = -half; k <= half; k++) {
      const q = Math.sqrt(j * j + k * k) / h;
      if (q <= 1) s += Math.exp(-4.5 * q * q);
    }
    tab[fl * 2] = h; tab[fl * 2 + 1] = 1 / s;
    if (maxIdx > 0) break;
  }
  if (maxIdx === 0) maxIdx = maxInd - 1;
  return { tab, maxIdx, maxCounts, R: Math.min(rmax, half) };
}
// The 1-D weights of flam3's gaussian spatial filter (oversample 1).
export function spatialWeights(radius) {
  const supp = 1.5, fw = 2 * supp * radius;
  let width = Math.trunc(fw) + 1;
  if ((width ^ 1) & 1) width++;
  width = Math.min(width, 7);
  const adjust = fw > 0 ? supp * width / fw : 1;
  const w = new Float32Array(8);
  let s = 0;
  for (let i = 0; i < width; i++) { const x = ((2 * i + 1) / width - 1) * adjust; w[i] = Math.exp(-2 * x * x); s += w[i]; }
  for (let i = 0; i < width; i++) w[i] /= s;
  return { width, w };
}

export async function createEngine(canvas, opts = {}) {
  if (!navigator.gpu) throw new Error('webgpu-unavailable');
  const mobile = !!opts.mobile;
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: mobile ? 'low-power' : 'high-performance' });
  if (!adapter) throw new Error('webgpu-unavailable');
  const device = await adapter.requestDevice();
  const ctx = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });
  const E = { onLost: null, lost: false };
  device.lost.then(info => { E.lost = true; if (E.onLost) E.onLost(info); });

  const [flameSrc, renderSrc] = await Promise.all([loadText('flame.wgsl'), loadText('render.wgsl')]);
  E.sources = { flame: flameSrc, render: renderSrc };
  const flameMod = await compile(device, flameSrc, 'flame.wgsl');
  const renderMod = await compile(device, renderSrc, 'render.wgsl');
  const iterPipe = device.createComputePipeline({ layout: 'auto', compute: { module: flameMod, entryPoint: 'iterate' } });
  const decayPipe = device.createComputePipeline({ layout: 'auto', compute: { module: flameMod, entryPoint: 'decay' } });
  const dePipe = device.createComputePipeline({ layout: 'auto', compute: { module: renderMod, entryPoint: 'de' } });
  const drawPipe = device.createRenderPipeline({ layout: 'auto', vertex: { module: renderMod, entryPoint: 'vs' },
    fragment: { module: renderMod, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });

  const S = GPUBufferUsage.STORAGE, CD = GPUBufferUsage.COPY_DST, UNI = GPUBufferUsage.UNIFORM;
  const uBuf = device.createBuffer({ size: 96, usage: UNI | CD });
  const dBuf = device.createBuffer({ size: 48, usage: UNI | CD });
  const vBuf = device.createBuffer({ size: 80, usage: UNI | CD });
  const xfBuf = device.createBuffer({ size: MAX_XF * XF_BLOCK * 4, usage: S | CD });
  const distBuf = device.createBuffer({ size: (MAX_XF + 1) * DIST_GRAIN * 4, usage: S | CD });
  const palBuf = device.createBuffer({ size: 256 * 16, usage: S | CD });
  const tabBuf = device.createBuffer({ size: 4096 * 8, usage: S | CD });
  const nWalkers = opts.walkers || (mobile ? N_WALKERS.mobile : N_WALKERS.desktop);
  const walkBuf = device.createBuffer({ size: nWalkers * 32, usage: S });
  let histBuf = null, accBuf = null, W = 0, H = 0;
  let iterBG = null, decayBG = null, deBG = null, drawBG = null;

  const st = {
    genome: null, packed: null, view: { x: 0, y: 0, w: 1, h: 1 }, cam: null,
    samples: 0, target: 1, reinit: true, moving: false, decay: 0.9, dirty: true, needDraw: true,
    iters: mobile ? 16 : 32, gpuMs: 0, drawnAt: 0, pending: false, frame: 0, de: null, deCap: mobile ? 6 : 9,
  };
  E.stats = st;

  function bindAll() {
    iterBG = device.createBindGroup({ layout: iterPipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: uBuf } }, { binding: 1, resource: { buffer: xfBuf } },
      { binding: 2, resource: { buffer: distBuf } }, { binding: 3, resource: { buffer: palBuf } },
      { binding: 4, resource: { buffer: walkBuf } }, { binding: 5, resource: { buffer: histBuf } }] });
    decayBG = device.createBindGroup({ layout: decayPipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: uBuf } }, { binding: 5, resource: { buffer: histBuf } }] });
    deBG = device.createBindGroup({ layout: dePipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: dBuf } }, { binding: 1, resource: { buffer: histBuf } },
      { binding: 2, resource: { buffer: tabBuf } }, { binding: 3, resource: { buffer: accBuf } }] });
    drawBG = device.createBindGroup({ layout: drawPipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: vBuf } }, { binding: 1, resource: { buffer: accBuf } }] });
  }

  E.resize = (w, h) => {
    w = Math.max(8, w | 0); h = Math.max(8, h | 0);
    if (w === W && h === H) return;
    W = w; H = h; canvas.width = w; canvas.height = h;
    if (histBuf) histBuf.destroy();
    if (accBuf) accBuf.destroy();
    histBuf = device.createBuffer({ size: W * H * 16, usage: S | CD });
    accBuf = device.createBuffer({ size: W * H * 16, usage: S });
    bindAll();
    E.reset();
  };
  E.size = () => [W, H];

  E.reset = () => { st.samples = 0; st.drawnAt = 0; st.reinit = true; st.dirty = true; st.clear = true; st.needDraw = true; };

  function camera() {
    const g = st.genome, v = st.view;
    const fit = Math.min(v.w / g.width, v.h / g.height);
    const ppu = g.ppu * Math.pow(2, g.zoom) * fit;
    const th = g.rotate * 2 * Math.PI / 360;
    return { fit, ppu, ox: v.x + v.w / 2, oy: v.y + v.h / 2, r00: Math.cos(th), r01: -Math.sin(th), r10: Math.sin(th), r11: Math.cos(th),
      frameW: g.width * fit, frameH: g.height * fit };
  }
  E.camera = () => (st.genome ? camera() : null);

  E.setGenome = (g, o = {}) => {
    const prev = st.genome;
    st.genome = g;
    const pk = packGenome(g);
    st.packed = pk;
    device.queue.writeBuffer(xfBuf, 0, pk.blocks);
    device.queue.writeBuffer(distBuf, 0, pk.dist);
    const pal = new Float32Array(1024);
    for (let i = 0; i < 256; i++) { pal[i * 4] = g.palette[i * 3]; pal[i * 4 + 1] = g.palette[i * 3 + 1]; pal[i * 4 + 2] = g.palette[i * 3 + 2]; pal[i * 4 + 3] = 1; }
    device.queue.writeBuffer(palBuf, 0, pal);
    const de = deFilters(g.estimator, g.estMin, g.estCurve, st.deCap);
    st.de = de;
    if (de) device.queue.writeBuffer(tabBuf, 0, de.tab.subarray(0, Math.min(de.tab.length, 8192)));
    if (o.reset !== false || !prev) E.reset();
    st.needDraw = true;
  };
  E.setView = (r, keep) => {
    const v = st.view;
    if (v.x === r.x && v.y === r.y && v.w === r.w && v.h === r.h) return;
    st.view = { x: r.x, y: r.y, w: r.w, h: r.h };
    if (!keep && !st.moving) E.reset();
  };
  E.setMoving = (on, decay = 0.9) => { st.moving = !!on; st.decay = decay; };

  function writeUniforms(c, reinit) {
    const g = st.genome, pk = st.packed;
    const b = new ArrayBuffer(96), u = new Uint32Array(b), f = new Float32Array(b), i32 = new Int32Array(b);
    u[0] = pk.nstd; i32[1] = pk.finalIndex; u[2] = pk.chaosOn ? 1 : 0; u[3] = st.iters;
    u[4] = (st.frame * 2654435761) >>> 0; u[5] = reinit ? 1 : 0; u[6] = FUSE; u[7] = W;
    u[8] = H; f[9] = SCALE; f[10] = pk.finalOpacity; f[11] = st.decay;
    f[12] = c.r00; f[13] = c.r01; f[14] = c.r10; f[15] = c.r11;
    f[16] = g.center[0]; f[17] = g.center[1]; f[18] = c.ox; f[19] = c.oy;
    f[20] = c.ppu; u[21] = nWalkers; u[22] = DIST_GRAIN; u[23] = W * H * 4;
    device.queue.writeBuffer(uBuf, 0, b);
  }
  function writeDE(c) {
    const g = st.genome, de = st.de;
    const b = new ArrayBuffer(48), u = new Uint32Array(b), f = new Float32Array(b), i32 = new Int32Array(b);
    u[0] = W; u[1] = H; i32[2] = de ? de.R : 0; u[3] = de ? de.maxIdx : 0;
    f[4] = g.contrast * g.brightness * 255 * 268 / 256;
    f[5] = c.ppu * c.ppu / (g.contrast * Math.max(1, st.samples));
    f[6] = 1 / SCALE; f[7] = g.estCurve; f[8] = de ? de.maxCounts : 0; u[9] = de ? 1 : 0;
    device.queue.writeBuffer(dBuf, 0, b);
  }
  function writeView() {
    const g = st.genome, sw = spatialWeights(g.filter);
    const b = new ArrayBuffer(80), u = new Uint32Array(b), f = new Float32Array(b);
    u[0] = W; u[1] = H; u[2] = sw.width;
    f[4] = 1 / g.gamma; f[5] = g.gamLin; f[6] = g.vibrancy; f[7] = g.highlight;
    f[8] = g.background[0]; f[9] = g.background[1]; f[10] = g.background[2]; f[11] = 1;
    f.set(sw.w, 12);
    device.queue.writeBuffer(vBuf, 0, b);
  }

  // One frame. Returns true when it sent GPU work.
  E.frame = () => {
    if (!st.genome || !histBuf || E.lost) return false;
    const c = camera();
    st.cam = c;
    st.target = st.genome.quality * c.frameW * c.frameH;
    const iterate = st.moving || st.samples < st.target;
    if (!iterate && !st.needDraw) return false;
    st.frame++;
    const enc = device.createCommandEncoder();
    if (st.clear) { enc.clearBuffer(histBuf); st.clear = false; }
    if (iterate) {
      const reinit = st.reinit; st.reinit = false;
      writeUniforms(c, reinit);
      if (st.moving && !reinit && st.samples > 0) {
        const n = W * H * 4, wg = Math.ceil(n / 256);
        const p = enc.beginComputePass(); p.setPipeline(decayPipe); p.setBindGroup(0, decayBG);
        p.dispatchWorkgroups(Math.min(wg, 65535), Math.ceil(wg / 65535)); p.end();
        st.samples *= st.decay;
      }
      const p = enc.beginComputePass(); p.setPipeline(iterPipe); p.setBindGroup(0, iterBG);
      p.dispatchWorkgroups(Math.ceil(nWalkers / 64)); p.end();
      st.samples += nWalkers * Math.max(0, st.iters - (reinit ? FUSE : 0));
    }
    // While a still flame accumulates, the density estimation and the tone
    // map run only when the sample count grew by 12% (or at the end), so
    // most of the GPU time goes to the chaos game.
    const draw = st.needDraw || st.moving || st.samples >= st.target || st.samples > st.drawnAt * 1.12;
    if (draw) {
      st.drawnAt = st.samples;
      writeDE(c); writeView();
      const p = enc.beginComputePass(); p.setPipeline(dePipe); p.setBindGroup(0, deBG);
      p.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8)); p.end();
      const rp = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
      rp.setPipeline(drawPipe); rp.setBindGroup(0, drawBG); rp.draw(3); rp.end();
    }
    const t0 = performance.now();
    device.queue.submit([enc.finish()]);
    st.needDraw = false;
    // Adapt the steps per walker to the GPU time (one probe in flight).
    if (!st.pending && iterate) {
      st.pending = true;
      device.queue.onSubmittedWorkDone().then(() => {
        st.pending = false;
        const ms = performance.now() - t0;
        st.gpuMs = st.gpuMs ? st.gpuMs * 0.8 + ms * 0.2 : ms;
        const goal = mobile ? 9 : 12;
        if (st.gpuMs > goal * 1.3 && st.iters > 4) st.iters = Math.max(4, Math.floor(st.iters * 0.8));
        else if (st.gpuMs < goal * 0.7 && st.iters < 1024) st.iters = Math.ceil(st.iters * 1.15);
      });
    }
    return true;
  };
  E.redraw = () => { st.needDraw = true; };
  E.destroy = () => { try { device.destroy(); } catch (e) {} };
  E.device = device;
  return E;
}
