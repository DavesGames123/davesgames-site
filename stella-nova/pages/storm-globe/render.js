// ============================================================================
//  STORM GLOBE  ·  render.js  ·  the WebGPU globe, particles and overlays
// ----------------------------------------------------------------------------
//  One canvas, one device (shared with the solver). Per frame:
//    compute  "advance"   particles move in the solver wind (overlay.wgsl)
//    render   globe.wgsl  full-screen ray-cast Earth + field + sky
//             overlay.wgsl particles, tracks, markers (alpha blend, no depth)
//  Surface layers are textures: land.png-like canvas (land, coast,
//  graticule) and the cone canvas, both equirectangular, north up. They
//  are drawn with Canvas 2D from world.json and the storm cones.
//
//  createRenderer({ device, canvas, solver, lite }) -> R
//    R.setWorld(world)            Natural Earth land (data/world.json)
//    R.setCones(storms, selId)    forecast cones
//    R.setTracks(segs)            [{ a, b: [x,y,z], col: [r,g,b,a], w px }]
//    R.setMarkers(marks)          [{ p, size, col, shape, spin, ring, alpha }]
//    R.draw(basis, look, pv)      one frame (see FRAME_DOC)
//    R.resize(w, h, dpr), R.destroy()
//
//  grep -n targets: "function drawLand", "function drawCones",
//                   "function writeFrame", "draw(", "PARTICLES"
// ============================================================================
import { lutBytes } from './colour.js';

// PARTICLES: the buffer size and the trail length (positions per particle;
// 11 since the streaks move at 2/3 of the old speed, main.js WIND_VIS)
export const P_MAX = 26000, P_MAX_LITE = 11000, P_H = 11;

async function shader(device, name) {
  const r = await fetch(new URL('shaders/' + name, import.meta.url));
  if (!r.ok) throw new Error(name + ' ' + r.status);
  const code = await r.text();
  const m = device.createShaderModule({ code, label: name });
  if (m.getCompilationInfo) {
    const info = await m.getCompilationInfo(), errs = info.messages.filter(x => x.type === 'error');
    if (errs.length) throw new Error(name + ': ' + errs.map(x => `${x.lineNum}:${x.linePos} ${x.message}`).join('; '));
  }
  return m;
}

// Equirectangular canvas helpers. Rings are flat [lon*s, lat*s, ...].
function ringPath(g, ring, s, W, H, dx) {
  g.moveTo((ring[0] / s + 180 + dx) / 360 * W, (90 - ring[1] / s) / 180 * H);
  for (let k = 2; k < ring.length; k += 2) g.lineTo((ring[k] / s + 180 + dx) / 360 * W, (90 - ring[k + 1] / s) / 180 * H);
  g.closePath();
}
// The globe shader reads u = lon / 360 from lon 0 (east), so the canvas
// starts at lon 0: x = (lon mod 360) / 360. ringPath uses lon + 180 + dx,
// so dx = -180 puts lon 0 at x = 0; dx = +180 draws the wrapped copy.
export function drawLand(world, W, H) {
  const cv = new OffscreenCanvas(W, H), g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'lighter';
  const s = world.scale || 10;
  for (const dx of [-180, 180]) {
    g.beginPath(); for (const r of world.land) ringPath(g, r, s, W, H, dx);
    g.fillStyle = 'rgb(255,0,0)'; g.fill('evenodd');
    g.beginPath(); for (const r of world.lakes || []) ringPath(g, r, s, W, H, dx);
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = 'rgba(0,0,0,1)'; g.fill('evenodd');
    g.globalCompositeOperation = 'lighter';
  }
  // coast: a thin green stroke on its own canvas, added
  const cc = new OffscreenCanvas(W, H), q = cc.getContext('2d');
  q.strokeStyle = 'rgb(0,255,0)'; q.lineWidth = Math.max(1, W / 3600); q.lineJoin = 'round';
  for (const dx of [-180, 180]) { q.beginPath(); for (const r of world.land) ringPath(q, r, s, W, H, dx); q.stroke(); }
  // graticule every 30 deg, blue
  q.strokeStyle = 'rgb(0,0,255)'; q.lineWidth = Math.max(1, W / 4096);
  q.beginPath();
  for (let lo = 0; lo < 360; lo += 30) { const x = lo / 360 * W; q.moveTo(x, 0); q.lineTo(x, H); }
  for (let la = -60; la <= 60; la += 30) { const y = (90 - la) / 180 * H; q.moveTo(0, y); q.lineTo(W, y); }
  q.stroke();
  g.drawImage(cc, 0, 0);
  return cv;
}
export function drawCones(storms, selId, W, H) {
  const cv = new OffscreenCanvas(W, H), g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'lighter';
  for (const s of storms) {
    if (!s.cone || s.cone.length < 3) continue;
    // unwrap longitudes so a ring that crosses 180 deg stays connected
    const ring = []; let prev = null;
    for (const [lo, la] of s.cone) { let l = lo; if (prev != null) { while (l - prev > 180) l -= 360; while (l - prev < -180) l += 360; } ring.push(l, la); prev = l; }
    for (const dx of [-360, 0, 360]) {
      g.beginPath(); ringPath(g, ring, 1, W, H, dx - 180);
      g.fillStyle = s.id === selId ? 'rgb(0,255,0)' : 'rgb(255,0,0)'; g.fill();
    }
  }
  return cv;
}

export async function createRenderer({ device, canvas, solver, lite = false }) {
  const ctx = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });
  const [gm, om] = await Promise.all([shader(device, 'globe.wgsl'), shader(device, 'overlay.wgsl')]);
  const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
  const [globeP, partP, segP, markP, advP] = await Promise.all([
    device.createRenderPipelineAsync({ layout: 'auto', vertex: { module: gm, entryPoint: 'vs' }, fragment: { module: gm, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } }),
    device.createRenderPipelineAsync({ layout: 'auto', vertex: { module: om, entryPoint: 'pvs' }, fragment: { module: om, entryPoint: 'pfs', targets: [{ format, blend }] } }),
    device.createRenderPipelineAsync({ layout: 'auto', vertex: { module: om, entryPoint: 'svs' }, fragment: { module: om, entryPoint: 'sfs', targets: [{ format, blend }] } }),
    device.createRenderPipelineAsync({ layout: 'auto', vertex: { module: om, entryPoint: 'mvs' }, fragment: { module: om, entryPoint: 'mfs', targets: [{ format, blend }] } }),
    device.createComputePipelineAsync({ layout: 'auto', compute: { module: om, entryPoint: 'advance' } }),
  ]);
  const U = GPUBufferUsage;
  const frameBuf = device.createBuffer({ size: 128, usage: U.UNIFORM | U.COPY_DST });
  const puBuf = device.createBuffer({ size: 64, usage: U.UNIFORM | U.COPY_DST });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'clamp-to-edge' });
  const tex = (w, h, label) => device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT, label });
  const LW = lite ? 2048 : 4096, CW = lite ? 1024 : 2048;
  const landT = tex(LW, LW / 2, 'land'), coneT = tex(CW, CW / 2, 'cones'), lutT = tex(256, 4, 'lut');
  device.queue.writeTexture({ texture: lutT }, lutBytes(), { bytesPerRow: 1024 }, [256, 4]);
  const blank = (t, w, h) => device.queue.writeTexture({ texture: t }, new Uint8Array(w * h * 4), { bytesPerRow: w * 4 }, [w, h]);
  blank(landT, LW, LW / 2); blank(coneT, CW, CW / 2);
  const globeBG = device.createBindGroup({
    layout: globeP.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: frameBuf } }, { binding: 1, resource: sampler }, { binding: 2, resource: solver.diagView },
      { binding: 3, resource: landT.createView() }, { binding: 4, resource: coneT.createView() }, { binding: 5, resource: lutT.createView() },
    ],
  });
  // particles
  const NMAX = lite ? P_MAX_LITE : P_MAX, H = P_H;
  const part = device.createBuffer({ size: NMAX * 16, usage: U.STORAGE | U.COPY_DST });
  const hist = device.createBuffer({ size: NMAX * H * 16, usage: U.STORAGE | U.COPY_DST });
  { const init = new Float32Array(NMAX * 4); for (let i = 0; i < NMAX; i++) init.set([0, 0, 0, 1e9], i * 4); device.queue.writeBuffer(part, 0, init); }
  const fr0 = n => device.createBindGroup({ layout: n.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: frameBuf } }] });
  const advBG1 = device.createBindGroup({
    layout: advP.getBindGroupLayout(1), entries: [
      { binding: 0, resource: { buffer: puBuf } }, { binding: 1, resource: { buffer: solver.state } },
      { binding: 2, resource: { buffer: part } }, { binding: 3, resource: { buffer: hist } },
    ],
  });
  const partBG0 = fr0(partP);
  const advBG0 = device.createBindGroup({ layout: advP.getBindGroupLayout(0), entries: [] });
  const partBG1 = device.createBindGroup({
    layout: partP.getBindGroupLayout(1), entries: [
      { binding: 0, resource: { buffer: puBuf } }, { binding: 8, resource: { buffer: hist } },
      { binding: 4, resource: lutT.createView() }, { binding: 5, resource: sampler },
    ],
  });
  // tracks and markers: storage buffers that grow on demand
  let segBuf = null, segN = 0, segBG = null, markBuf = null, markN = 0, markBG = null;
  const segBG0 = fr0(segP), markBG0 = fr0(markP);
  const grow = (old, bytes) => { if (old && old.size >= bytes) return old; old && old.destroy(); return device.createBuffer({ size: Math.max(256, bytes * 1.5 | 0), usage: U.STORAGE | U.COPY_DST }); };

  let head = 0, frameNo = 0, live = NMAX, W = canvas.width, Hh = canvas.height, dpr = 1;
  const R = {
    format, nmax: NMAX, H,
    setWorld(world) {
      const cv = drawLand(world, LW, LW / 2);
      device.queue.copyExternalImageToTexture({ source: cv }, { texture: landT }, [LW, LW / 2]);
    },
    setCones(storms, selId) {
      const cv = drawCones(storms, selId, CW, CW / 2);
      device.queue.copyExternalImageToTexture({ source: cv }, { texture: coneT }, [CW, CW / 2]);
    },
    setTracks(segs) {
      segN = segs.length; if (!segN) return;
      const d = new Float32Array(segN * 12);
      segs.forEach((s, i) => d.set([...s.a, s.w, ...s.b, 0, ...s.col], i * 12));
      const nb = grow(segBuf, d.byteLength);
      if (nb !== segBuf) { segBuf = nb; segBG = device.createBindGroup({ layout: segP.getBindGroupLayout(1), entries: [{ binding: 6, resource: { buffer: segBuf } }] }); }
      device.queue.writeBuffer(segBuf, 0, d);
    },
    setMarkers(marks) {
      markN = marks.length; if (!markN) return;
      const d = new Float32Array(markN * 12);
      marks.forEach((m, i) => d.set([...m.p, m.size, ...m.col, m.shape, m.spin || 0, m.ring || 0, m.alpha ?? 1], i * 12));
      const nb = grow(markBuf, d.byteLength);
      if (nb !== markBuf) { markBuf = nb; markBG = device.createBindGroup({ layout: markP.getBindGroupLayout(1), entries: [{ binding: 7, resource: { buffer: markBuf } }] }); }
      device.queue.writeBuffer(markBuf, 0, d);
    },
    setParticleShare(f) { live = Math.max(0, Math.min(NMAX, Math.round(NMAX * f))); },
    resize(w, h, r) { W = w; Hh = h; dpr = r; },
    // FRAME_DOC: b = camera.basis(); look = { mode, strength, dye, cones,
    // grid, coast, fade, sun: [x,y,z], night }; pv = { on, colour, cap:
    // [x,y,z,cos], secPerFrame, life, alpha }. enc: an open command
    // encoder that holds the solver steps of this frame (or null).
    draw(b, look, pv, enc = null) {
      const f = new Float32Array(32);
      f.set([...b.eye, performance.now() / 1000, ...b.right, b.tanX, ...b.up, b.tanY, ...b.fwd, dpr,
        b.off.x, b.off.y, W, Hh, ...look.sun, look.night ?? 0.22,
        look.mode, look.strength, look.dye, look.cones, look.grid, look.coast, 0, look.fade ?? 1]);
      device.queue.writeBuffer(frameBuf, 0, f);
      const e = enc || device.createCommandEncoder();
      const showP = pv.on && live > 0;
      if (showP) {
        head = (head + 1) % H; frameNo++;
        const pu = new ArrayBuffer(64), u32 = new Uint32Array(pu), f32 = new Float32Array(pu);
        u32.set([solver.nx, solver.ny, NMAX, H, head, frameNo, live, pv.colour ? 1 : 0]);
        f32.set([...pv.cap, pv.secPerFrame, 6.371e6, pv.life, pv.alpha], 8);
        device.queue.writeBuffer(puBuf, 0, pu);
        const cp = e.beginComputePass(); cp.setPipeline(advP); cp.setBindGroup(0, advBG0); cp.setBindGroup(1, advBG1);
        cp.dispatchWorkgroups(Math.ceil(NMAX / 64)); cp.end();
      }
      const rp = e.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
      rp.setPipeline(globeP); rp.setBindGroup(0, globeBG); rp.draw(3);
      if (showP) { rp.setPipeline(partP); rp.setBindGroup(0, partBG0); rp.setBindGroup(1, partBG1); rp.draw((H - 1) * 6, live); }
      if (segN && look.tracks !== false) { rp.setPipeline(segP); rp.setBindGroup(0, segBG0); rp.setBindGroup(1, segBG); rp.draw(6, segN); }
      if (markN && look.markers !== false) { rp.setPipeline(markP); rp.setBindGroup(0, markBG0); rp.setBindGroup(1, markBG); rp.draw(6, markN); }
      rp.end();
      device.queue.submit([e.finish()]);
    },
    destroy() { for (const t of [landT, coneT, lutT]) t.destroy(); for (const b of [frameBuf, puBuf, part, hist, segBuf, markBuf]) b && b.destroy(); },
  };
  return R;
}
