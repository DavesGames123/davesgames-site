// engine.js — WebGPU field layer of the Starward Belt page. No DOM beyond
// the canvas.
//
// createField(canvas) compiles shaders/field.wgsl, writes the scene buffer
// (rail frame, dust clouds, hatch discs) once, and returns resize() and
// render(). render() writes one 64-byte frame uniform and draws one
// fullscreen triangle. All of the dust, rails, contours and hatch come from
// the fragment shader, in world coordinates.
//
//   binding  buffer   size   written
//   0        frame    64 B   every render(): camera, viewport, time, hover
//   1        scene    736 B  once: RAIL, CLOUDS, HATCH from data.js
//
// grep: function createField  function packScene  resize(  render(

import { RAIL, CLOUDS, HATCH } from './data.js';

const MAX_CLOUDS = 12, MAX_REGIONS = 4, MAX_DISCS = 16;
const SCENE_FLOATS = 8 + MAX_CLOUDS * 8 + MAX_REGIONS * 4 + MAX_DISCS * 4;

// Pack the fixed chart data into the Scene struct layout of field.wgsl.
function packScene() {
  const f = new Float32Array(SCENE_FLOATS);
  const ax = RAIL.b.x - RAIL.a.x, ay = RAIL.b.y - RAIL.a.y;
  const len = Math.hypot(ax, ay);
  const clouds = CLOUDS.slice(0, MAX_CLOUDS);
  const regions = HATCH.slice(0, MAX_REGIONS);
  f.set([RAIL.a.x, RAIL.a.y, ax / len, ay / len, len, RAIL.spacing, clouds.length, regions.length], 0);
  clouds.forEach((c, i) => f.set([c.x, c.y, c.rx, c.ry, c.w, 0, 0, 0], 8 + i * 8));
  const regOff = 8 + MAX_CLOUDS * 8, discOff = regOff + MAX_REGIONS * 4;
  let n = 0;
  regions.forEach((r, i) => {
    const discs = r.discs.slice(0, MAX_DISCS - n);
    f.set([n, discs.length, r.k, 0], regOff + i * 4);
    discs.forEach(([x, y, rad]) => { f.set([x, y, rad, 0], discOff + n * 4); n++; });
  });
  return f;
}

export async function createField(canvas) {
  if (!navigator.gpu) throw new Error('This browser has no WebGPU. Try a recent Chrome, Edge or Safari.');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('WebGPU is present, but no GPU adapter is available.');
  const device = await adapter.requestDevice();
  const ctx = canvas.getContext('webgpu');
  if (!ctx) throw new Error('The canvas could not get a WebGPU context.');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  const res = await fetch(new URL('shaders/field.wgsl', import.meta.url));
  if (!res.ok) throw new Error(`Could not load the field shader (${res.status}).`);
  const module = device.createShaderModule({ code: await res.text(), label: 'field' });
  const info = await module.getCompilationInfo();
  const errs = info.messages.filter((m) => m.type === 'error');
  if (errs.length) throw new Error('Field shader error: ' + errs.map((m) => `${m.lineNum}: ${m.message}`).join('; '));

  const pipeline = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });

  const U = GPUBufferUsage;
  const frameBuf = device.createBuffer({ size: 64, usage: U.UNIFORM | U.COPY_DST });
  const scene = packScene();
  const sceneBuf = device.createBuffer({ size: scene.byteLength, usage: U.UNIFORM | U.COPY_DST });
  device.queue.writeBuffer(sceneBuf, 0, scene);
  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: frameBuf } },
      { binding: 1, resource: { buffer: sceneBuf } },
    ],
  });

  device.lost.then((e) => console.warn('starward-belt: GPU device lost:', e.message));

  const frame = new Float32Array(16);
  let cssW = 1;

  return {
    // Size the canvas backing store in device pixels. dpr stops at 2.
    resize(w, h, dpr = 1) {
      const d = Math.min(Math.max(dpr || 1, 1), 2);
      cssW = Math.max(1, w);
      canvas.width = Math.max(1, Math.round(w * d));
      canvas.height = Math.max(1, Math.round(h * d));
    },
    // Draw one frame. view comes from camera.view(); fx.hover is a world point or null.
    render(view, timeSec = 0, fx = {}) {
      const scale = canvas.width / (view.w || cssW);   // exact device px per css px
      const fit = Math.min(view.w / 900, view.h / 1750);
      const hv = fx && fx.hover;
      frame.set([
        view.cx, view.cy, view.zoom, scale,
        view.w, view.h, timeSec, fit,
        hv ? hv.x : 0, hv ? hv.y : 0, hv ? 1 : 0, 0,
      ]);
      device.queue.writeBuffer(frameBuf, 0, frame);
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({ colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.043, g: 0.043, b: 0.043, a: 1 },
      }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind);
      pass.draw(3);
      pass.end();
      device.queue.submit([enc.finish()]);
    },
  };
}
