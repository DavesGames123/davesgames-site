// ============================================================================
//  DLA TERRAIN  ·  render/weather.js — volumetric haze, rain, snow, splashes,
//  lightning bolts and rainbows (package SKY). render/sky.js makes it; CORE
//  does not import it.
// ----------------------------------------------------------------------------
//  HAZE  froxels of shaders/weather.wgsl: csFroxInject (with CORE's
//    cascaded sun shadow at group 2) then csFroxIntegrate, each frame in
//    compute(). Grid by quality: 160 x 90 x 64, 128 x 72 x 48, 96 x 54 x 32.
//    The inject target is a ping-pong pair: last frame's froxels are the
//    history of the temporal blend. A second pair holds the sun in-scatter
//    that the shadows take away; the integrate pass sums it per column into
//    a 2D texture (tLossSky), and fsHaze takes it off the sky pixels, so
//    shafts from ridges and cloud gaps cross the sky too. fsHaze applies
//    the volume in CORE's volumetric pass.
//    Group 2 for the inject pass: CORE's shadow sample bind group when it
//    is given (frame.shadowBindGroup, gpu.shadowSampleBindGroup or
//    gpu.shadows.sampleBindGroup), else a stand-in with no cascades (lit).
//    compute() runs before CORE's shadow pass, so the haze sees the shadow
//    map of the last frame (one frame late, hidden by the temporal blend).
//  PRECIPITATION  counts(wx, q, frame, stroke) sets the number of rain
//    streaks, splashes and flakes (drop k shows when the amount is over
//    k / max, so drops come and go one by one); the GPU places them
//    (vsPrecip) from precipPhases(): the drift and the fall phases worked
//    out in double precision, with no wind x time or speed x time in f32.
//    rainDropPos(k, ...) is the same placement in JS, for the tests.
//  LIGHTNING  a DLA bolt: createBoltGrower grows a 2D DLA tree with
//    lib/dla-engine.js (dlaf, MIT, Michael Fogleman) from a seed at the
//    cloud base, with walkers that start under the lowest particle, so the
//    tree reaches down toward the ground like a stepped leader. The path
//    from the lowest particle to the seed is the main channel (bright,
//    wide); side branches get a width and a brightness from their subtree
//    size. A few ms of growth per frame keeps two bolts ready. When
//    skyState gives a new cloud-to-ground stroke, the next bolt is placed
//    at its storm cell (stroke x, z; or a bearing and a distance), from the
//    cloud base to the terrain.
//
//  grep -n targets: "export function createBoltGrower", "export function boltSegments",
//  "export async function createWeather", "function gridFor", "counts(",
//  "function placeBolt", "draw(pass", "export function precipPhases",
//  "export function rainDropPos"
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

// ── precipitation phases (DOM-free) ─────────────────────────────────────────
// The rain and snow particles of shaders/weather.wgsl are placed from these
// numbers, worked out here in double precision so that nothing in the
// shader multiplies a speed by a large time:
//   rainOff, snowOff  the drift of the boxes with the wind: the sum of
//                     wind x dt (0.9 x for rain, 0.85 x for snow), wrapped
//                     by the box span 2R (the wrap in vsPrecip has the same
//                     period, so the wrap is exact and nothing jumps)
//   rainA, rainB      fall phases: a drop of speed class c (0..7) falls at
//                     8.5 + 0.25 c m/s, so its phase is fract(rainA + c x
//                     rainB) with rainA = fract(8.5 t / span), rainB =
//                     fract(0.25 t / span). c is an integer, so this equals
//                     fract(speed t / span) exactly.
//   snowA, snowB      the same for snow (0.8 + 0.075 c m/s)
//   splashT           t mod 320 s (a splash lives 0.32 s)
//   flutterT          t mod 200 pi s; the flutter frequencies are whole
//                     multiples of 0.01 rad/s, so the wrap is seamless
// st carries clock (s), rainOff, snowOff between frames.
export const RAIN_SPEED = [8.5, 0.25], SNOW_SPEED = [0.8, 0.075];
export function precipPhases(st, wind, dt, rainR, snowR) {
  const sr = 2 * rainR, ss = 2 * snowR;
  const wrap = (x, p) => ((x % p) + p) % p;
  st.rainOff = st.rainOff || [0, 0]; st.snowOff = st.snowOff || [0, 0];
  st.rainOff[0] = wrap(st.rainOff[0] + wind[0] * 0.9 * dt, sr); st.rainOff[1] = wrap(st.rainOff[1] + wind[1] * 0.9 * dt, sr);
  st.snowOff[0] = wrap(st.snowOff[0] + wind[0] * 0.85 * dt, ss); st.snowOff[1] = wrap(st.snowOff[1] + wind[1] * 0.85 * dt, ss);
  const t = st.clock || 0, fr = (x) => x - Math.floor(x);
  return {
    rainOff: st.rainOff, snowOff: st.snowOff,
    rainA: fr(RAIN_SPEED[0] * t / sr), rainB: fr(RAIN_SPEED[1] * t / sr),
    snowA: fr(SNOW_SPEED[0] * t / ss), snowB: fr(SNOW_SPEED[1] * t / ss),
    splashT: t % 320, flutterT: t % (200 * Math.PI),
  };
}

// The world position of rain drop k (the vsPrecip formula, for the tests).
export function rainDropPos(k, ph, cam, rainR, h) {
  const span = 2 * rainR, fr = (x) => x - Math.floor(x);
  const c = k % 8;
  const bx = h[0] * span * 8 + ph.rainOff[0], bz = h[2] * span * 8 + ph.rainOff[1];
  const x = cam[0] + (fr((bx - cam[0]) / span + 0.5) - 0.5) * span;
  const z = cam[2] + (fr((bz - cam[2]) / span + 0.5) - 0.5) * span;
  const y = cam[1] + (fr(h[1] - ph.rainA - c * ph.rainB - cam[1] / span + 0.5) - 0.5) * span;
  return [x, y, z];
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
      { binding: 4, visibility: ALLC, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '3d' } },
      { binding: 5, visibility: ALLC, texture: { sampleType: 'float', viewDimension: '3d' } },
    ] }),
    integ: device.createBindGroupLayout({ label: 'frox integrate', entries: [
      { binding: 2, visibility: ALLC, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 3, visibility: ALLC, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '3d' } },
      { binding: 6, visibility: ALLC, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 7, visibility: ALLC, storageTexture: { access: 'write-only', format: 'rgba16float' } },
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
  // a phone profile (gpu/budget.js) caps the grid: 64 x 36 x 32 on a phone
  const capGrid = (g) => (gpu.profile && gpu.profile.froxel ? g.map((v, i) => Math.min(v, gpu.profile.froxel[i])) : g);
  let grid = capGrid(gridFor(q));
  let vt = null, stamp = 0;
  function makeVolumes() {
    if (vt) for (const t of vt.all) t.destroy();
    const mk = (label) => device.createTexture({ label, size: grid, dimension: '3d', format: 'rgba16float', usage: TU.TEXTURE_BINDING | TU.STORAGE_BINDING });
    const lossSky = device.createTexture({ label: 'frox sky loss', size: [grid[0], grid[1]], format: 'rgba16float', usage: TU.TEXTURE_BINDING | TU.STORAGE_BINDING });
    vt = { inj: [mk('frox inject 0'), mk('frox inject 1')], loss: [mk('frox loss 0'), mk('frox loss 1')], vol: mk('frox volume'), lossSky };
    vt.all = [...vt.inj, ...vt.loss, vt.vol, lossSky];
    vt.v = { inj: vt.inj.map((t) => t.createView()), loss: vt.loss.map((t) => t.createView()), vol: vt.vol.createView(), lossSky: lossSky.createView() };
    vt.injectBG = [0, 1].map((i) => device.createBindGroup({ layout: G3.inject, entries: [
      { binding: 0, resource: vt.v.inj[i] }, { binding: 1, resource: vt.v.inj[1 - i] },
      { binding: 4, resource: vt.v.loss[i] }, { binding: 5, resource: vt.v.loss[1 - i] }] }));
    vt.integBG = [0, 1].map((i) => device.createBindGroup({ layout: G3.integ, entries: [
      { binding: 2, resource: vt.v.inj[i] }, { binding: 3, resource: vt.v.vol },
      { binding: 6, resource: vt.v.loss[i] }, { binding: 7, resource: vt.v.lossSky }] }));
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
    const top = typeof stroke.x === 'number' ? [stroke.x, info.cl.base, stroke.z]
      : [cam[0] + Math.cos(stroke.angle) * stroke.dist, info.cl.base, cam[2] + Math.sin(stroke.angle) * stroke.dist];
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
    setQuality(qq) { q = qq; const g2 = capGrid(gridFor(q)); if (g2.join() !== grid.join()) { grid = g2; makeVolumes(); } },
    resize(w, h, qq) { if (qq !== undefined) this.setQuality(qq); },

    // Particle counts. Each kind has a fixed maximum (by quality); drop k
    // shows when the amount is over k / max and fades in over 0.06 of the
    // amount (vsPrecip), so a change of the amount adds or takes away drops
    // one by one, with no pop. The drawn count covers the visible drops.
    counts(wx, qq, frame, stroke) {
      const k = 0.35 + 0.65 * clamp(qq, 0, 1);
      const coarse = frame && frame.coarse ? 0.6 : 1;
      stroke = stroke || (frame && frame.weather && frame.weather.bolt);
      const flash = frame ? frame.globals[GLOBALS.weather + 3] : 0;
      const rainMax = Math.round(42000 * k * coarse), snowMax = Math.round(30000 * k * coarse), splashMax = Math.round(5000 * k * coarse);
      const n = (amt, max) => (amt > 0.002 ? Math.min(max, Math.ceil(max * (clamp(amt, 0, 1) + 0.06))) : 0);
      return {
        rain: n(wx.rain, rainMax), splash: n(wx.rain, splashMax), snow: n(wx.snow, snowMax),
        rainMax, splashMax, snowMax,
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
      const stroke = (info.s || frame.weather || {}).bolt;
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

    drawResources() { return { volumeView: vt.v.vol, lossView: vt.v.lossSky, boltBuffer, stamp }; },

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
