// ============================================================================
//  DLA TERRAIN  ·  render/weather.js — volumetric haze, rain, snow, splashes,
//  lightning bolts and rainbows (package SKY). render/sky.js makes it; CORE
//  does not import it.
// ----------------------------------------------------------------------------
//  HAZE  froxels of shaders/weather.wgsl: csFroxInject (with CORE's
//    cascaded sun shadow at group 2) then csFroxIntegrate, each frame in
//    compute(). Grid by quality: 160 x 90 x 64, 128 x 72 x 48, 96 x 54 x 32.
//    The inject target is a ping-pong pair: last frame's froxels are the
//    history of the temporal blend. fsHaze applies the volume in CORE's
//    volumetric pass.
//    Group 2 for the inject pass: CORE's shadow sample bind group when it
//    is given (frame.shadowBindGroup, gpu.shadowSampleBindGroup or
//    gpu.shadows.sampleBindGroup), else a stand-in with no cascades (lit).
//    compute() runs before CORE's shadow pass, so the haze sees the shadow
//    map of the last frame (one frame late, hidden by the temporal blend).
//  PRECIPITATION  counts(wx, q) sets the number of rain streaks, splashes
//    and flakes; the GPU places them (vsPrecip).
//  LIGHTNING  a DLA bolt: createBoltGrower grows a 2D DLA tree with
//    lib/dla-engine.js (dlaf, MIT, Michael Fogleman) from a seed at the
//    cloud base, with walkers that start under the lowest particle, so the
//    tree reaches down toward the ground like a stepped leader. The path
//    from the lowest particle to the seed is the main channel (bright,
//    wide); side branches get a width and a brightness from their subtree
//    size. A few ms of growth per frame keeps two bolts ready. When
//    skyState gives a new cloud-to-ground stroke, the next bolt is placed
//    at its bearing and distance, from the cloud base to the terrain.
//
//  grep -n targets: "export function createBoltGrower", "export function boltSegments",
//  "export async function createWeather", "function gridFor", "counts(",
//  "function placeBolt", "draw(pass"
// ============================================================================
import { createModel } from '../../../lib/dla-engine.js';
import { GLOBALS } from '../sky-state.js';

const BU = (typeof GPUBufferUsage !== 'undefined') ? GPUBufferUsage : { UNIFORM: 64, COPY_DST: 8, STORAGE: 128 };
const TU = (typeof GPUTextureUsage !== 'undefined') ? GPUTextureUsage : { TEXTURE_BINDING: 4, STORAGE_BINDING: 8, COPY_DST: 2, RENDER_ATTACHMENT: 16 };
const SS = (typeof GPUShaderStage !== 'undefined') ? GPUShaderStage : { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
export const MAX_BOLT_SEGS = 3000;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// ── the DLA bolt (DOM-free) ──────────────────────────────────────────────────
// Grows down to y = -depth (model units). step(ms) -> true when finished.
export function createBoltGrower(seed, depth = 150) {
  const user = { minY: 0, W: 30 };
  const m = createModel({
    dim: 2, seed, user,
    params: { stickiness: 0.55, attractionDistance: 2.2, particleSpacing: 1, minMoveDistance: 1 },
    hooks: {
      randomStartingPosition(mm, out) {
        const U = mm.user;
        out[0] = (mm.random() * 2 - 1) * U.W;
        out[1] = U.minY - 10 - mm.random() * 6;
        out[2] = 0;
        return out;
      },
      shouldReset(mm, p) {
        const U = mm.user;
        return p[1] > 12 || p[1] < U.minY - 50 || Math.abs(p[0]) > U.W * 1.7;
      },
      motionVector(mm, p, out) {
        const a = mm.random() * Math.PI * 2;
        out[0] = Math.cos(a); out[1] = Math.sin(a) + 0.45; out[2] = 0;   // drift up toward the tree
        return out;
      },
    },
    onAdd(i, par, mm) {
      const y = mm.pos[i * 3 + 1];
      if (y < mm.user.minY) { mm.user.minY = y; mm.user.W = 26 + 0.3 * -y; }
    },
  });
  m.add([0, 0, 0]);
  let done = false;
  return {
    model: m,
    get done() { return done; },
    // chunks of 40 particles, so the stop point does not depend on the clock
    step(ms) {
      if (done) return true;
      const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
      const t0 = now();
      do {
        m.grow(40);
        if (m.user.minY <= -depth || m.count > 4500) { done = true; break; }
      } while (now() - t0 < ms);
      return done;
    },
    finish() { while (!this.step(50)); return this; },
  };
}

// Segments of a grown bolt in model units: Float32Array of 8 floats each
// (ax, ay, 0, width, bx, by, 0, brightness), main channel first.
export function boltSegments(model, maxSegs = 900) {
  const n = model.count, pos = model.pos, par = model.parent;
  const size = model.subtreeSizes();
  let low = 0;
  for (let i = 1; i < n; i++) if (pos[i * 3 + 1] < pos[low * 3 + 1]) low = i;
  const main = new Uint8Array(n);
  for (let i = low; i >= 0; i = par[i]) main[i] = 1;
  let maxS = 1;
  for (let i = 1; i < n; i++) if (!main[i]) maxS = Math.max(maxS, size[i]);
  const out = [];
  const pushSeg = (i) => {
    const p = par[i];
    const m = main[i];
    const k = m ? 1 : Math.log(1 + size[i]) / Math.log(1 + maxS);
    out.push(pos[p * 3], pos[p * 3 + 1], 0, m ? 1 : 0.18 + 0.45 * k, pos[i * 3], pos[i * 3 + 1], 0, m ? 1 : 0.05 + 0.4 * k * k);
  };
  for (let i = 1; i < n; i++) if (main[i] && par[i] >= 0) pushSeg(i);
  const mainCount = out.length / 8;
  // side branches: the biggest first, prune the twigs
  const side = [];
  for (let i = 1; i < n; i++) if (!main[i] && par[i] >= 0 && size[i] >= 7) side.push(i);
  side.sort((a, b) => size[b] - size[a]);
  for (const i of side) { if (out.length / 8 >= maxSegs) break; pushSeg(i); }
  return { segs: new Float32Array(out), count: out.length / 8, mainCount, minY: pos[low * 3 + 1] };
}

// ── GPU part ────────────────────────────────────────────────────────────────
function gridFor(q) {
  if (q >= 0.75) return [160, 90, 64];
  if (q >= 0.4) return [128, 72, 48];
  return [96, 54, 32];
}

export async function createWeather(gpu, shared) {
  const { device, queue } = gpu;
  const L = shared.layouts;
  const module = device.createShaderModule({ label: 'weather.wgsl', code: shared.weatherText });
  const ALLC = SS.COMPUTE;

  // group 2: CORE's shadow sample layout, or a stand-in with the same shape
  const shadowLayout = gpu.shadowSampleLayout || device.createBindGroupLayout({
    label: 'sky shadow stand-in', entries: [
      { binding: 0, visibility: SS.VERTEX | SS.FRAGMENT | SS.COMPUTE, texture: { sampleType: 'depth', viewDimension: '2d-array' } },
      { binding: 1, visibility: SS.VERTEX | SS.FRAGMENT | SS.COMPUTE, sampler: { type: 'comparison' } },
      { binding: 2, visibility: SS.VERTEX | SS.FRAGMENT | SS.COMPUTE, buffer: { type: 'uniform' } },
    ],
  });
  const dummyDepth = device.createTexture({ size: [1, 1, 1], format: 'depth32float', usage: TU.TEXTURE_BINDING | TU.RENDER_ATTACHMENT });
  const dummyCasc = device.createBuffer({ size: 304, usage: BU.UNIFORM | BU.COPY_DST });   // params.x = 0 cascades: lit
  const dummyShadowBG = device.createBindGroup({
    label: 'sky shadow stand-in', layout: shadowLayout, entries: [
      { binding: 0, resource: dummyDepth.createView({ dimension: '2d-array' }) },
      { binding: 1, resource: device.createSampler({ compare: 'greater-equal' }) },
      { binding: 2, resource: { buffer: dummyCasc } },
    ],
  });

  const G3 = {
    inject: device.createBindGroupLayout({ label: 'frox inject', entries: [
      { binding: 0, visibility: ALLC, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '3d' } },
      { binding: 1, visibility: ALLC, texture: { sampleType: 'float', viewDimension: '3d' } },
    ] }),
    integ: device.createBindGroupLayout({ label: 'frox integrate', entries: [
      { binding: 2, visibility: ALLC, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 3, visibility: ALLC, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '3d' } },
    ] }),
  };
  const premul = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
  const add = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } };
  const drawLayout = device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, L.draw] });
  const draw = (label, vs, fs, blend) => device.createRenderPipelineAsync({
    label, layout: drawLayout,
    vertex: { module, entryPoint: vs },
    fragment: { module, entryPoint: fs, targets: [{ format: gpu.hdrFormat, blend }] },
    primitive: { topology: 'triangle-list' },
  });
  const [pInject, pInteg, pHaze, pPrecip, pBolt] = await Promise.all([
    device.createComputePipelineAsync({ label: 'csFroxInject', compute: { module, entryPoint: 'csFroxInject' },
      layout: device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, L.read, shadowLayout, G3.inject] }) }),
    device.createComputePipelineAsync({ label: 'csFroxIntegrate', compute: { module, entryPoint: 'csFroxIntegrate' },
      layout: device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, L.read, L.empty, G3.integ] }) }),
    draw('haze', 'vsHaze', 'fsHaze', premul),
    draw('precip', 'vsPrecip', 'fsPrecip', premul),
    draw('bolt', 'vsBolt', 'fsBolt', add),
  ]);
  const emptyBG = device.createBindGroup({ layout: L.empty, entries: [] });
  const boltBuffer = device.createBuffer({ label: 'bolt segs', size: MAX_BOLT_SEGS * 32, usage: BU.STORAGE | BU.COPY_DST });

  let q = gpu.quality ?? 1;
  let grid = gridFor(q);
  let vt = null, stamp = 0;
  function makeVolumes() {
    if (vt) for (const t of vt.all) t.destroy();
    const mk = (label) => device.createTexture({ label, size: grid, dimension: '3d', format: 'rgba16float', usage: TU.TEXTURE_BINDING | TU.STORAGE_BINDING });
    vt = { inj: [mk('frox inject 0'), mk('frox inject 1'), ], vol: mk('frox volume') };
    vt.all = [...vt.inj, vt.vol];
    vt.v = { inj: vt.inj.map((t) => t.createView()), vol: vt.vol.createView() };
    vt.injectBG = [0, 1].map((i) => device.createBindGroup({ layout: G3.inject, entries: [
      { binding: 0, resource: vt.v.inj[i] }, { binding: 1, resource: vt.v.inj[1 - i] }] }));
    vt.integBG = [0, 1].map((i) => device.createBindGroup({ layout: G3.integ, entries: [
      { binding: 2, resource: vt.v.inj[i] }, { binding: 3, resource: vt.v.vol }] }));
    vt.ping = 0;
    stamp++;
  }
  makeVolumes();

  // ── lightning state ───────────────────────────────────────────────────────
  const bolts = { pool: [], growing: null, seed: 1, strokeId: null, segCount: 0, terrain: null };
  function placeBolt(frame, info, stroke) {
    const ready = bolts.pool.shift();
    if (!ready) { bolts.segCount = 0; return; }
    const g = frame.globals;
    const cam = info.cam;
    const top = [cam[0] + Math.cos(stroke.angle) * stroke.dist, info.cl.base, cam[2] + Math.sin(stroke.angle) * stroke.dist];
    let ground = g[GLOBALS.terrain + 2];
    const t = bolts.terrain;
    if (t && t.cpu && t.cpu.height) {
      const n = t.n, ws = t.worldSize;
      const i = clamp(Math.floor(((top[0] + ws / 2) / ws) * n), 0, n - 1), j = clamp(Math.floor(((top[2] + ws / 2) / ws) * n), 0, n - 1);
      ground = Math.max(t.cpu.height[j * n + i], t.seaLevel ?? ground);
    }
    const hgt = Math.max(top[1] - ground, 200);
    const s = hgt / Math.max(-ready.minY, 1);
    // the plane of the bolt faces the camera
    const dx = top[0] - cam[0], dz = top[2] - cam[2], dl = Math.hypot(dx, dz) || 1;
    const ax = -dz / dl, az = dx / dl;
    const segs = ready.segs, n = ready.count, out = new Float32Array(n * 8);
    const flip = (stroke.id & 1) ? -1 : 1;
    for (let k = 0; k < n; k++) {
      for (let e = 0; e < 2; e++) {
        const o = k * 8 + e * 4;
        const x = segs[o] * s * flip, y = segs[o + 1] * s;
        out[o] = top[0] + ax * x; out[o + 1] = top[1] + y; out[o + 2] = top[2] + az * x;
      }
      out[k * 8 + 3] = segs[k * 8 + 3] * (k < ready.mainCount ? 3.5 : 1.6);
      out[k * 8 + 7] = segs[k * 8 + 7];
    }
    queue.writeBuffer(boltBuffer, 0, out);
    bolts.segCount = n;
  }

  return {
    get grid() { return grid; },
    setTerrain(t) { bolts.terrain = t; },
    setQuality(qq) { q = qq; const g2 = gridFor(q); if (g2.join() !== grid.join()) { grid = g2; makeVolumes(); } },
    resize(w, h, qq) { if (qq !== undefined) this.setQuality(qq); },

    counts(wx, qq, frame) {
      const k = 0.35 + 0.65 * clamp(qq, 0, 1);
      const coarse = frame && frame.coarse ? 0.6 : 1;
      const stroke = frame && frame.weather && frame.weather.bolt;
      const flash = frame ? frame.globals[GLOBALS.weather + 3] : 0;
      return {
        rain: Math.round(clamp(wx.rain, 0, 1) * 42000 * k * coarse),
        splash: Math.round(clamp(wx.rain, 0, 1) * 5000 * k * coarse),
        snow: Math.round(clamp(wx.snow, 0, 1) * 30000 * k * coarse),
        bolt: stroke && stroke.visible && stroke.cloudToGround && flash > 0.02 ? bolts.segCount : 0,
      };
    },

    update(frame, info) {
      const storm = info.wx.storm ?? 0;
      if (storm > 0.3) {
        if (!bolts.growing && bolts.pool.length < 2) bolts.growing = createBoltGrower(bolts.seed++ * 7919 + 13, 140 + (bolts.seed % 3) * 25);
        if (bolts.growing && bolts.growing.step(3)) {
          bolts.pool.push(boltSegments(bolts.growing.model));
          bolts.growing = null;
        }
      }
      const stroke = frame.weather && frame.weather.bolt;
      if (stroke && stroke.id !== bolts.strokeId && stroke.visible) {
        if (!stroke.cloudToGround) bolts.strokeId = stroke.id;
        else if (bolts.pool.length) { bolts.strokeId = stroke.id; placeBolt(frame, info, stroke); }
      }
    },

    compute(enc, frame) {
      const sbg = frame.shadowBindGroup || gpu.shadowSampleBindGroup || (gpu.shadows && gpu.shadows.sampleBindGroup) || (gpu.shadowSampleLayout ? null : dummyShadowBG);
      const pass = enc.beginComputePass({ label: 'froxels' });
      pass.setBindGroup(0, gpu.globalsBindGroup);
      pass.setBindGroup(1, shared.readBindGroup);
      vt.ping = 1 - vt.ping;
      pass.setPipeline(pInject);
      pass.setBindGroup(2, sbg || dummyShadowBG);
      pass.setBindGroup(3, vt.injectBG[vt.ping]);
      pass.dispatchWorkgroups(Math.ceil(grid[0] / 8), Math.ceil(grid[1] / 8), grid[2]);
      pass.setPipeline(pInteg);
      pass.setBindGroup(2, emptyBG);
      pass.setBindGroup(3, vt.integBG[vt.ping]);
      pass.dispatchWorkgroups(Math.ceil(grid[0] / 8), Math.ceil(grid[1] / 8), 1);
      pass.end();
    },

    drawResources() { return { volumeView: vt.v.vol, boltBuffer, stamp }; },

    draw(pass, frame, g1) {
      pass.setPipeline(pHaze);
      pass.setBindGroup(1, g1);
      pass.draw(3);
      const u = shared.u, C = shared.SKYU.counts;
      const nP = u[C] + u[C + 1] + u[C + 2];
      if (nP > 0) {
        pass.setPipeline(pPrecip);
        pass.draw(6, nP);
      }
      if (u[C + 3] > 0) {
        pass.setPipeline(pBolt);
        pass.draw(6, u[C + 3] * 2);
      }
    },

    dispose() {
      for (const t of vt.all) t.destroy();
      boltBuffer.destroy(); dummyDepth.destroy(); dummyCasc.destroy();
    },
  };
}
