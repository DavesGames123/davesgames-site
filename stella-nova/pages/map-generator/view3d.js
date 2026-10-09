// view3d.js — the 3D view of the generated city (WebGPU), in the look of
// City Atlas: the same light presets, sky, fog, building colours and
// orbit camera. main.js loads it on the first switch to 3D.
//
// createView3D(canvas, { phone, onInput }) -> view
//   view.setCity(city, tl, mesh, field)   mesh: mesh3d.js buildMesh(); field:
//                                         mesh3d.js fieldLines() (line list)
//   view.frame({ T, dt, light, field, saver })   one frame at playback time T
//   view.resize()
//   view.cam          { target: [x, y, z], yaw, pitch, dist } (radians, metres)
//   view.goal(cam, k) ease the camera to cam (k: share per second, default 2.5)
//   view.home()       the camera of the first view of a city
//   view.auto         false stops the idle orbit (the saver drives the camera)
//   view.project(p)   world point -> CSS px, or null
//   view.info         { tris, w, h, msaa }
//
// Passes per frame: the shadow map (the buildings from the sun)
// when the time, the light or the city changed; then the main pass: sky,
// opaque layers (ground, water, parks, blocks, buildings), roads (depth
// test, no depth write, minor first), field crosses (blended).
//
// grep: export async function createView3D  const LIGHTS  function lightFor  function sunMatrix
//       function bindOrbit  function frame  function setCity  function size

import { viewProj, lookAt, mul, project as proj, orbitEye } from './camera.js';
import { STRIDE } from './mesh3d.js';

// The light presets of City Atlas (pages/city-atlas/renderer.js LIGHTS).
export const LIGHTS = {
  day: { elev: 38, sun: [1.0, 0.95, 0.88], sunK: 1.25, amb: 0.62, hor: [0.66, 0.74, 0.84], zen: [0.20, 0.38, 0.66], night: 0 },
  golden: { elev: 11, sun: [1.0, 0.72, 0.48], sunK: 1.35, amb: 0.55, hor: [0.86, 0.71, 0.60], zen: [0.30, 0.42, 0.64], night: 0.12 },
  dusk: { elev: -4, sun: [0.85, 0.42, 0.36], sunK: 0.35, amb: 0.55, hor: [0.42, 0.30, 0.36], zen: [0.07, 0.09, 0.19], night: 0.8 },
  night: { elev: 30, sun: [0.42, 0.50, 0.70], sunK: 0.28, amb: 0.42, hor: [0.06, 0.075, 0.12], zen: [0.008, 0.012, 0.03], night: 1 },
};
export function lightFor(name, azDeg) {
  const L = LIGHTS[name] || LIGHTS.day;
  const el = (Math.max(L.elev, 3) * Math.PI) / 180;
  const az = (azDeg * Math.PI) / 180;
  const sun = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
  return { sun, night: L.night, sunCol: L.sun.map((c) => c * L.sunK), amb: L.amb, hor: L.hor, zen: L.zen };
}

// Orthographic view from the sun over a square of half side ex (m).
function sunMatrix(sun, ex) {
  const D = 2 * ex + 1000;
  const eye = [sun[0] * D, sun[1] * D, sun[2] * D];
  const up = Math.abs(sun[2]) > 0.95 ? [0, 1, 0] : [0, 0, 1];
  const v = lookAt(eye, [0, 0, 0], up);
  const fz = 2 * D;
  const o = new Float32Array(16);
  o[0] = 1 / ex; o[5] = 1 / ex; o[10] = -1 / fz; o[14] = 0; o[15] = 1;
  return mul(o, v);
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export async function createView3D(canvas, opts = {}) {
  if (!navigator.gpu) throw new Error('WebGPU not available');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no WebGPU adapter');
  const device = await adapter.requestDevice();
  device.lost.then((i) => { if (i?.reason !== 'destroyed') console.warn('map-generator: device lost', i?.message); });
  const ctx = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });
  const phone = !!opts.phone;
  const dpr0 = Math.min(window.devicePixelRatio || 1, 2);
  const sampleCount = !phone && dpr0 < 2 ? 4 : 1;
  const SHADOW_N = phone ? 1024 : 2048;

  const code = await fetch(new URL('./shaders/city.wgsl', import.meta.url)).then((r) => { if (!r.ok) throw new Error('city.wgsl ' + r.status); return r.text(); });
  const mod = device.createShaderModule({ code, label: 'city' });
  const info0 = await mod.getCompilationInfo();
  const errs = info0.messages.filter((m) => m.type === 'error');
  if (errs.length) throw new Error('city.wgsl: ' + errs.map((e) => `${e.lineNum}:${e.linePos} ${e.message}`).join('; '));

  const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
  const bgl = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: V | F, buffer: { type: 'uniform' } },
    { binding: 1, visibility: F, texture: { sampleType: 'depth' } },
    { binding: 2, visibility: F, sampler: { type: 'comparison' } },
  ] });
  const bglShadow = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: V, buffer: { type: 'uniform' } }] });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
  const layoutShadow = device.createPipelineLayout({ bindGroupLayouts: [bglShadow] });
  const vbuf = [{ arrayStride: STRIDE, attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'snorm8x4' },
    { shaderLocation: 2, offset: 16, format: 'unorm8x4' },
    { shaderLocation: 3, offset: 20, format: 'float32x4' },
    { shaderLocation: 4, offset: 36, format: 'float32x4' },
  ] }];
  const depthFormat = 'depth32float';
  const ms = { count: sampleCount };
  const [pSky, pOpaque, pRoads, pField, pShadow] = await Promise.all([
    device.createRenderPipelineAsync({ layout, vertex: { module: mod, entryPoint: 'vsSky' }, fragment: { module: mod, entryPoint: 'fsSky', targets: [{ format }] },
      depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'always' }, multisample: ms }),
    device.createRenderPipelineAsync({ layout, vertex: { module: mod, entryPoint: 'vs', buffers: vbuf }, fragment: { module: mod, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: ms }),
    device.createRenderPipelineAsync({ layout, vertex: { module: mod, entryPoint: 'vs', buffers: vbuf }, fragment: { module: mod, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater-equal' }, multisample: ms }),
    device.createRenderPipelineAsync({ layout, vertex: { module: mod, entryPoint: 'vsField', buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
      fragment: { module: mod, entryPoint: 'fsField', targets: [{ format, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] },
      primitive: { topology: 'line-list' },
      depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater-equal' }, multisample: ms }),
    device.createRenderPipelineAsync({ layout: layoutShadow, vertex: { module: mod, entryPoint: 'vsShadow', buffers: vbuf },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 1.5 } }),
  ]);

  const T_ = GPUTextureUsage;
  const frameBuf = device.createBuffer({ size: 72 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const frameRaw = new Float32Array(72);
  const shadowT = device.createTexture({ size: [SHADOW_N, SHADOW_N], format: 'depth32float', usage: T_.RENDER_ATTACHMENT | T_.TEXTURE_BINDING });
  const shadowView = shadowT.createView();
  const cmp = device.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });
  const group = device.createBindGroup({ layout: bgl, entries: [
    { binding: 0, resource: { buffer: frameBuf } }, { binding: 1, resource: shadowView }, { binding: 2, resource: cmp },
  ] });
  const groupShadow = device.createBindGroup({ layout: bglShadow, entries: [{ binding: 0, resource: { buffer: frameBuf } }] });
  // vsShadow reads G.lightVP, so one uniform buffer serves both passes.

  let W = 1, H = 1, colorT = null, depthT = null;
  function size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const budget = phone ? 1.3e6 : 2.4e6;
    let w = Math.max(1, Math.round(window.innerWidth * dpr)), h = Math.max(1, Math.round(window.innerHeight * dpr));
    const k = Math.min(1, Math.sqrt(budget / (w * h)));
    w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
    if (w === W && h === H && depthT) return;
    W = w; H = h;
    canvas.width = W; canvas.height = H;
    colorT?.destroy(); depthT?.destroy();
    colorT = sampleCount > 1 ? device.createTexture({ size: [W, H], format, sampleCount, usage: T_.RENDER_ATTACHMENT }) : null;
    depthT = device.createTexture({ size: [W, H], format: depthFormat, sampleCount, usage: T_.RENDER_ATTACHMENT });
  }
  size();

  // ─── city ──────────────────────────────────────────────────────────────────
  let cur = null;          // { vb, ib, ranges, fb, nField, R, mesh }
  function setCity(_city, tl, mesh, field) {
    if (cur) { cur.vb.destroy(); cur.ib.destroy(); cur.fb?.destroy(); }
    const vb = device.createBuffer({ size: Math.max(4, mesh.vertices.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(vb, 0, mesh.vertices);
    const ib = device.createBuffer({ size: Math.max(4, mesh.indices.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(ib, 0, mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength);
    let fb = null;
    if (field && field.length) {
      fb = device.createBuffer({ size: field.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(fb, 0, field);
    }
    const R = Math.hypot(mesh.domain.w, mesh.domain.h) / 2;
    const fresh = !cur;
    cur = { vb, ib, fb, nField: field ? field.length / 3 : 0, ranges: mesh.ranges, R, half: mesh.half, tl, dur: tl.dur, tallest: mesh.tallest };
    shadowKey = '';
    if (fresh) Object.assign(cam, home());
  }

  // ─── camera ────────────────────────────────────────────────────────────────
  const cam = { target: [0, 0, 0], yaw: 200 * Math.PI / 180, pitch: 0.55, dist: 2000 };
  let goalCam = null, goalK = 2.5;
  let lastInput = -1e9;
  const view = { cam, auto: true };
  function home() {
    const R = cur ? Math.max(cur.half[0], cur.half[1]) : 900;
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const k = Math.max(1, Math.pow(1.4 / aspect, 0.75));
    return { target: [0, 0, 0], yaw: 200 * Math.PI / 180, pitch: 0.55, dist: R * 1.9 * k };
  }
  function bindOrbit() {
    const pts = new Map();
    let last = null;
    const note = () => { lastInput = performance.now(); goalCam = null; opts.onInput?.(); };
    const pan = (dx, dy) => {
      const k = cam.dist / Math.max(window.innerHeight, 1) * 1.1;
      const s = Math.sin(cam.yaw), c = Math.cos(cam.yaw);
      cam.target[0] -= (-c * dx + s * dy) * k;
      cam.target[1] -= (s * dx + c * dy) * k;
      const lim = cur ? Math.max(cur.half[0], cur.half[1]) * 1.3 : 2000;
      cam.target[0] = clamp(cam.target[0], -lim, lim);
      cam.target[1] = clamp(cam.target[1], -lim, lim);
    };
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      try { canvas.setPointerCapture(e.pointerId); } catch { /* */ }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      last = null;
      note();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      note();
      if (pts.size === 1) {
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        if (e.buttons & 2 || e.shiftKey) pan(dx, dy);
        else {
          cam.yaw -= dx * 0.0055;
          cam.pitch = clamp(cam.pitch + dy * 0.004, 0.06, 1.52);
        }
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d = Math.hypot(a.x - b.x, a.y - b.y);
        if (last) {
          cam.dist = clamp(cam.dist * last.d / Math.max(d, 1), 40, 9000);
          pan(mid.x - last.mid.x, mid.y - last.mid.y);
        }
        last = { mid, d };
      }
    });
    const up = (e) => { pts.delete(e.pointerId); last = null; };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      note();
      const k = Math.exp(clamp(e.deltaY, -200, 200) * (e.ctrlKey ? 0.01 : 0.0015));
      cam.dist = clamp(cam.dist * k, 40, 9000);
    }, { passive: false });
    canvas.addEventListener('dblclick', () => { goalCam = home(); goalK = 2.5; });
  }
  bindOrbit();

  // ─── frame ─────────────────────────────────────────────────────────────────
  let shadowKey = '';
  const info = { tris: 0, w: 0, h: 0, msaa: sampleCount };
  let clock = 0;
  function frame(st) {
    if (!cur) return;
    size();
    const dt = st.dt || 0;
    clock += dt;
    if (goalCam) {
      const k = 1 - Math.exp(-dt * goalK);
      for (let i = 0; i < 3; i++) cam.target[i] += (goalCam.target[i] - cam.target[i]) * k;
      let dy = goalCam.yaw - cam.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      cam.yaw += dy * k;
      cam.pitch += (goalCam.pitch - cam.pitch) * k;
      cam.dist *= Math.pow(goalCam.dist / cam.dist, k);
      if (Math.abs(dy) < 1e-3 && Math.abs(goalCam.dist / cam.dist - 1) < 1e-3) goalCam = null;
    } else if (view.auto && performance.now() - lastInput > 6000) {
      cam.yaw += dt * 0.035;
    }
    const lt = lightFor(st.light || 'golden', 210);
    const aspect = W / H;
    const { vp, eye, inv } = viewProj(cam, aspect, 0.75, st.offsetY || 0);
    view.vp = vp;
    const f = frameRaw;
    f.set(vp, 0);
    f.set([eye[0], eye[1], eye[2], st.T], 16);
    f.set([lt.sun[0], lt.sun[1], lt.sun[2], lt.night], 20);
    f.set([lt.sunCol[0], lt.sunCol[1], lt.sunCol[2], lt.amb], 24);
    const fog = Math.max(cur.R * 3.2, cam.dist * 2.2);
    f.set([lt.hor[0], lt.hor[1], lt.hor[2], fog], 28);
    f.set([lt.zen[0], lt.zen[1], lt.zen[2], clamp(st.field || 0, 0, 1)], 32);
    f.set([clock, 1, 0, 0], 36);
    f.set(inv, 40);
    f.set(sunMatrix(lt.sun, cur.R * 1.08), 56);
    device.queue.writeBuffer(frameBuf, 0, f);

    const enc = device.createCommandEncoder();
    const sk = `${Math.min(st.T, cur.dur + 1).toFixed(3)}|${st.light}`;
    const b = cur.ranges.buildings;
    if (sk !== shadowKey) {
      shadowKey = sk;
      const sp = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: shadowView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
      sp.setPipeline(pShadow);
      sp.setBindGroup(0, groupShadow);
      sp.setVertexBuffer(0, cur.vb);
      sp.setIndexBuffer(cur.ib, 'uint32');
      sp.drawIndexed(b[1], 1, b[0]);
      sp.end();
    }
    const tex = ctx.getCurrentTexture().createView();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: colorT ? colorT.createView() : tex, resolveTarget: colorT ? tex : undefined, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: colorT ? 'discard' : 'store' }],
      depthStencilAttachment: { view: depthT.createView(), depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' },
    });
    pass.setBindGroup(0, group);
    pass.setPipeline(pSky);
    pass.draw(3);
    pass.setVertexBuffer(0, cur.vb);
    pass.setIndexBuffer(cur.ib, 'uint32');
    const o = cur.ranges.opaque, r = cur.ranges.roads;
    pass.setPipeline(pOpaque);
    pass.drawIndexed(o[1], 1, o[0]);
    if (r[1]) { pass.setPipeline(pRoads); pass.drawIndexed(r[1], 1, r[0]); }
    if (cur.fb && st.field > 0.01) {
      pass.setPipeline(pField);
      pass.setVertexBuffer(0, cur.fb);
      pass.draw(cur.nField);
    }
    pass.end();
    device.queue.submit([enc.finish()]);
    info.tris = (o[1] + r[1]) / 3; info.w = W; info.h = H;
  }

  return Object.assign(view, {
    setCity, frame, home,
    resize: () => size(),
    goal: (c, k = 2.5) => { goalCam = { target: [...c.target], yaw: c.yaw, pitch: c.pitch, dist: c.dist }; goalK = k; },
    project: (p) => (view.vp ? proj(view.vp, p, window.innerWidth, window.innerHeight) : null),
    eye: () => orbitEye(cam),
    info,
    device,
  });
}
