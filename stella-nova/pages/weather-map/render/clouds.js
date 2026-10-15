// ============================================================================
//  WEATHER MAP  ·  render/clouds.js — satellite-style cloud deck (package SKY)
// ----------------------------------------------------------------------------
//  createClouds(core, opts) -> Promise<layer>
//    layer = { name: 'clouds', order: 10, update, encode, destroy,
//              setGrid(grid), set({ visible, opacity, detail }), map, bounds }
//    setGrid(grid)  data/grid.js loadGrid() result. The layer packs the grid
//                   into a storage buffer and gives the cloud map to the globe
//                   (core.setCloudMap) for cloud shadows and wet ground.
//    set({ visible:false })  stops the compute pass and removes the map from
//                   the globe (no shadows without clouds).
//
//  Each frame (every 1, 2 or 3 frames by quality) a compute pass (csCloud in
//  shaders/clouds.wgsl, core.encoderHooks) writes the cloud map: rgba16float,
//  CLOUD_MAP_BOUNDS, row 0 = north edge. The coarse grid cover (total, low,
//  high, precip; Catmull-Rom in space, linear in time) sets where the clouds
//  are. Noise sets how they look: fBm plus Worley cells for low and middle
//  cloud, wind-stretched fBm for cirrus, cell puffs where it rains. The noise
//  flows with the 10 m wind (two-phase flow, FLOW_PERIOD_H). A quantile table
//  (LOW_Q, HIGH_Q) turns a cover fraction into a noise threshold, so the
//  cloudy area matches the model cover. Outside the grid, a climatological
//  cover (storm track, ITCZ, subtropical clear belt) fades in.
//    map r  opacity 0..1 (the globe reads it as optical depth)
//    map g  precipitation 0..1 (1 - exp(-mm per 3 h / 2.5))
//    map b  cirrus opacity
//    map a  cloud-top height 0..1 (low 0.3, cirrus 0.95, storm tops 1)
//  The draw pass (fsCloud) ray-traces the shell at CLOUD_SHELL, adds fine
//  detail noise when the camera is low, bumps the tops from map a, casts
//  self-shadow toward the sun, tints the terminator and writes frag_depth.
//
//  The noise functions below mirror the WGSL (same integer hash), so node
//  tests can check the coverage calibration against the real noise.
//
//  grep -n targets: "export async function createClouds", "export const CLOUD_MAP_BOUNDS",
//  "export function packGridGPU", "export function fillNaN", "export function gridSlices",
//  "export function midCloud", "export function pcg", "export function vnoise3",
//  "export function fbm3", "export function worley3", "export function lowNoise",
//  "export function cirrusNoise", "export const LOW_Q", "export function coverThreshold",
//  "export function flowPhases", "export function packSky", "export function cloudMapSize"
// ============================================================================
import { timeBracket } from '../data/grid.js';

export const CLOUD_SHELL = 1.0018;
export const CLOUD_MAP_BOUNDS = Object.freeze({ lat0: 5, lat1: 72, lon0: -175, lon1: -45 });
export const FLOW_PERIOD_H = 4;        // hours of flow per noise phase
export const DRIFT_H_PER_S = 1 / 60;   // clouds drift 1 h of flow per wall minute
export const GP_FLOATS = 8;            // per grid point and time: cloud, low, high, precip, u, v, t2m, snow
export const SKY_FLOATS = 24;

export function cloudMapSize(quality = 2) {
  if (quality >= 2) return { w: 1024, h: 528, stride: 1 };
  if (quality >= 1) return { w: 768, h: 396, stride: 2 };
  return { w: 512, h: 264, stride: 3 };
}

// Fill NaN cells (missing model points) from valid neighbours, in passes;
// cells with no valid value at all get `fallback`.
export function fillNaN(a, nLat, nLon, fallback = 0) {
  const out = Float32Array.from(a);
  let missing = 0;
  for (let p = 0; p < out.length; p++) if (!Number.isFinite(out[p])) missing++;
  for (let pass = 0; missing && pass < nLat + nLon; pass++) {
    const prev = Float32Array.from(out);
    for (let i = 0; i < nLat; i++) for (let j = 0; j < nLon; j++) {
      const p = i * nLon + j;
      if (Number.isFinite(prev[p])) continue;
      let s = 0, n = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nLat || jj >= nLon) continue;
        const v = prev[ii * nLon + jj];
        if (Number.isFinite(v)) { s += v; n++; }
      }
      if (n) { out[p] = s / n; missing--; }
    }
  }
  if (missing) for (let p = 0; p < out.length; p++) if (!Number.isFinite(out[p])) out[p] = fallback;
  return out;
}

// The grid as one Float32Array for the GPU: [time][point] x GP_FLOATS.
// Shared by render/fields.js.
export function packGridGPU(grid) {
  const nPts = grid.nLat * grid.nLon, nt = grid.times.length;
  const data = new Float32Array(Math.max(1, nt * nPts) * GP_FLOATS);
  const f = grid.fields;
  const order = [['cloud', 0], ['cloudLow', 0], ['cloudHigh', 0], ['precip', 0], ['u10', 0], ['v10', 0], ['t2m', 15], ['snow', 0]];
  for (let k = 0; k < nt; k++) {
    order.forEach(([name, fb], c) => {
      const src = f[name] && f[name][k];
      if (!src) return;
      const a = fillNaN(src, grid.nLat, grid.nLon, fb);
      const base = k * nPts * GP_FLOATS;
      for (let p = 0; p < nPts; p++) data[base + p * GP_FLOATS + c] = a[p];
    });
  }
  return { data, nPts, nt };
}

// The two time slices around t, as point offsets into the packed buffer.
export function gridSlices(grid, t) {
  const { k0, k1, u } = timeBracket(grid.times, t);
  const n = grid.nLat * grid.nLon;
  return { k0, k1, u, off0: k0 * n, off1: k1 * n };
}

// Middle-cloud fraction from total, low and high cover (random overlap):
// 1 - total = (1 - low)(1 - mid)(1 - high).
export function midCloud(total, low, high) {
  const d = Math.max((1 - low) * (1 - high), 1e-3);
  return Math.min(1, Math.max(0, 1 - (1 - total) / d));
}

// ── noise (mirrors shaders/clouds.wgsl) ─────────────────────────────────
export function pcg(v) {
  const s = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}
export function hash3(x, y, z) {
  return pcg((Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0);
}
const h01 = h => (h >>> 8) / 16777216;
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const mix = (a, b, t) => a + (b - a) * t;

export function vnoise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fade(fx), uy = fade(fy), uz = fade(fz);
  const c = (a, b, d) => h01(hash3(ix + a, iy + b, iz + d));
  const x00 = mix(c(0, 0, 0), c(1, 0, 0), ux), x10 = mix(c(0, 1, 0), c(1, 1, 0), ux);
  const x01 = mix(c(0, 0, 1), c(1, 0, 1), ux), x11 = mix(c(0, 1, 1), c(1, 1, 1), ux);
  return mix(mix(x00, x10, uy), mix(x01, x11, uy), uz);
}

export function fbm3(x, y, z, oct) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise3(x, y, z); n += a;
    x = x * 2.03 + 17.1; y = y * 2.03 + 31.7; z = z * 2.03 + 7.3; a *= 0.5;
  }
  return s / n;
}

// Worley F1 distance (cell units), 27 neighbours.
export function worley3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let d = 9;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const h1 = hash3(ix + dx, iy + dy, iz + dz), h2 = pcg(h1), h3 = pcg(h2);
    const px = ix + dx + h01(h1) - x, py = iy + dy + h01(h2) - y, pz = iz + dz + h01(h3) - z;
    d = Math.min(d, px * px + py * py + pz * pz);
  }
  return Math.sqrt(d);
}

// Low and middle cloud texture at globe-space point q (unit sphere): fBm
// clumps with a Worley cell texture (a strong Worley share gives evenly
// spread round dots at low cover, which real cumulus fields do not show).
export const LOW_FREQ = 24, LOW_CELL = 90, LOW_CELL_W = 0.18;
export function lowNoise(qx, qy, qz) {
  const f = fbm3(qx * LOW_FREQ, qy * LOW_FREQ, qz * LOW_FREQ, 5);
  const w = Math.min(worley3(qx * LOW_CELL, qy * LOW_CELL, qz * LOW_CELL), 1);
  return (1 - LOW_CELL_W) * f + LOW_CELL_W * (1 - w);
}

// Cirrus: fBm smeared along the wind direction w (unit, tangent at q) by
// five taps, so the streaks follow the flow.
export const HIGH_FREQ = 30, HIGH_SMEAR = 0.012;
const SMEAR_W = [0.1, 0.2, 0.4, 0.2, 0.1];
export function cirrusNoise(qx, qy, qz, wx, wy, wz) {
  let s = 0;
  for (let k = -2; k <= 2; k++) {
    const d = k * HIGH_SMEAR;
    s += SMEAR_W[k + 2] * fbm3((qx + wx * d) * HIGH_FREQ, (qy + wy * d) * HIGH_FREQ, (qz + wz * d) * HIGH_FREQ, 4);
  }
  return s;
}

// Noise value thresholds by cover: LOW_Q[i] is the noise level that a share
// i / 16 of points exceed (index 0: nothing exceeds, 16: everything does).
// Measured from lowNoise / cirrusNoise over the sphere (tests/sky.test.mjs
// checks the cloudy share against the cover). Keep in step with clouds.wgsl.
export const LOW_Q = [0.89, 0.6569, 0.6191, 0.5923, 0.5699, 0.5498, 0.5312, 0.5136, 0.4964, 0.4791, 0.4612, 0.4429, 0.4235, 0.4014, 0.3744, 0.338, 0.09];
export const HIGH_Q = [0.89, 0.6451, 0.6132, 0.5895, 0.5691, 0.5505, 0.5334, 0.5168, 0.5002, 0.4839, 0.4673, 0.4499, 0.4311, 0.4106, 0.3865, 0.3529, 0.12];
export const LOW_SOFT = 0.035, HIGH_SOFT = 0.07;

export function coverThreshold(table, cover) {
  const x = Math.min(1, Math.max(0, cover)) * (table.length - 1);
  const i = Math.min(table.length - 2, Math.floor(x));
  return mix(table[i], table[i + 1], x - i);
}

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// density of a cloud layer at noise value n for cover c
export function layerDensity(table, soft, cover, n) {
  const thr = coverThreshold(table, cover);
  return smoothstep(thr - soft, thr + soft, n);
}

// Two-phase flow: phase offsets in hours and weights (w1 + w2 = 1), so the
// noise moves with the wind but never shears for more than one period.
export function flowPhases(hours, period = FLOW_PERIOD_H) {
  const f1 = ((hours / period) % 1 + 1) % 1, f2 = (f1 + 0.5) % 1;
  const w1 = 1 - Math.abs(2 * f1 - 1);
  return { t1: f1 * period, t2: f2 * period, w1, w2: 1 - w1 };
}

// Sky uniform (struct Sky in clouds.wgsl).
// s: { mapB, grid, slices, flowH, hasGrid, opacity, w, h, detail, alt, quality }
export function packSky(s, out = new Float32Array(SKY_FLOATS)) {
  const g = s.grid || { lat0: 0, dLat: 1, lon0: 0, dLon: 1, nLat: 1, nLon: 1 };
  const sl = s.slices || { u: 0, off0: 0, off1: 0 };
  const b = s.mapB;
  out.set([
    b.lat0, b.lat1, b.lon0, b.lon1,
    g.lat0, g.dLat, g.lon0, g.dLon,
    g.nLat, g.nLon, sl.off0, sl.off1,
    sl.u, s.flowH, s.hasGrid ? 1 : 0, s.opacity ?? 1,
    s.w, s.h, 1 / s.w, 1 / s.h,
    s.detail ?? 1, s.alt ?? 1, s.quality ?? 2, FLOW_PERIOD_H,
  ]);
  return out;
}

// ── GPU layer ───────────────────────────────────────────────────────────
export async function createClouds(core, opts = {}) {
  const { device, format, frameLayout } = core;
  const code = core.frameWGSL + '\n' + await core.loadText('shaders/clouds.wgsl');
  const module = device.createShaderModule({ label: 'weather clouds', code });
  const size = cloudMapSize(opts.quality ?? core.quality);
  const bounds = { ...CLOUD_MAP_BOUNDS };
  const C = GPUShaderStage.COMPUTE, V = GPUShaderStage.VERTEX, Fr = GPUShaderStage.FRAGMENT;

  const map = device.createTexture({ label: 'weather cloud map', size: [size.w, size.h], format: 'rgba16float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  const mapView = map.createView();
  const skyBuf = device.createBuffer({ label: 'weather sky', size: SKY_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const skyPack = new Float32Array(SKY_FLOATS);
  let gridBuf = device.createBuffer({ label: 'weather cloud grid', size: GP_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

  const cLayout = device.createBindGroupLayout({ label: 'weather clouds compute', entries: [
    { binding: 0, visibility: C, buffer: { type: 'uniform' } },
    { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
  ] });
  const dLayout = device.createBindGroupLayout({ label: 'weather clouds draw', entries: [
    { binding: 0, visibility: V | Fr, buffer: { type: 'uniform' } },
    { binding: 3, visibility: Fr, texture: { sampleType: 'float' } },
    { binding: 4, visibility: Fr, sampler: { type: 'filtering' } },
  ] });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const [cPipe, dPipe] = await Promise.all([
    device.createComputePipelineAsync({ label: 'weather clouds compute',
      layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, cLayout] }),
      compute: { module, entryPoint: 'csCloud' } }),
    device.createRenderPipelineAsync({ label: 'weather clouds draw',
      layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, dLayout] }),
      vertex: { module, entryPoint: 'vsCloud' },
      fragment: { module, entryPoint: 'fsCloud', targets: [{ format, blend: core.PREMUL_BLEND }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: core.LAYER_DEPTH }),
  ]);
  const dGroup = device.createBindGroup({ label: 'weather clouds draw', layout: dLayout, entries: [
    { binding: 0, resource: { buffer: skyBuf } }, { binding: 3, resource: mapView }, { binding: 4, resource: sampler }] });
  let cGroup = null;
  const rebindCompute = () => {
    cGroup = device.createBindGroup({ label: 'weather clouds compute', layout: cLayout, entries: [
      { binding: 0, resource: { buffer: skyBuf } }, { binding: 1, resource: { buffer: gridBuf } }, { binding: 2, resource: mapView }] });
  };
  rebindCompute();

  let grid = null, visible = true, opacity = 1, detail = 1, frameNo = 0, lastT = NaN, run = false, shown = false, dead = false;
  const showMap = on => {
    if (on === shown || dead) return;
    shown = on;
    core.setCloudMap(on ? mapView : null, bounds);
  };

  const hook = enc => {
    if (!run) return;
    const pass = enc.beginComputePass({ label: 'weather clouds' });
    pass.setPipeline(cPipe);
    pass.setBindGroup(0, core.frameGroup);
    pass.setBindGroup(1, cGroup);
    pass.dispatchWorkgroups(Math.ceil(size.w / 8), Math.ceil(size.h / 8));
    pass.end();
  };
  core.encoderHooks.push(hook);

  const layer = {
    name: 'clouds', order: 10, map, mapView, bounds, size,
    setGrid(g) {
      if (!g || !g.times || !g.times.length || !g.fields || !g.fields.cloud) return;
      grid = g;
      const packed = packGridGPU(g);
      gridBuf.destroy();
      gridBuf = device.createBuffer({ label: 'weather cloud grid', size: packed.data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(gridBuf, 0, packed.data);
      rebindCompute();
      lastT = NaN;
    },
    set(o = {}) {
      if ('visible' in o) visible = !!o.visible;
      if (Number.isFinite(o.opacity)) opacity = Math.max(0, Math.min(1, o.opacity));
      if (Number.isFinite(o.detail)) detail = Math.max(0, o.detail);
    },
    get visible() { return visible; },
    update(frame, app) {
      frameNo++;
      const t = (app && app.t) || frame.t;
      const on = visible && !!grid;
      showMap(on);
      // the compute pass runs every `stride` frames, and at once when the
      // forecast time jumps (scrubber) by more than 5 min
      run = on && (frameNo % size.stride === 0 || !(Math.abs(t - lastT) < 3e5));
      if (!on) return;
      if (run) lastT = t;
      const flowH = (t - grid.times[0]) / 3.6e6 + frame.time * DRIFT_H_PER_S;
      device.queue.writeBuffer(skyBuf, 0, packSky({
        mapB: bounds, grid, slices: gridSlices(grid, t), flowH, hasGrid: true, opacity,
        w: size.w, h: size.h, detail, alt: frame.cam.alt, quality: frame.quality,
      }, skyPack));
    },
    encode(pass) {
      if (!visible || !grid) return;
      pass.setPipeline(dPipe);
      pass.setBindGroup(0, core.frameGroup);
      pass.setBindGroup(1, dGroup);
      pass.draw(3);
    },
    destroy() {
      dead = true;
      const i = core.encoderHooks.indexOf(hook);
      if (i >= 0) core.encoderHooks.splice(i, 1);
      if (shown) core.setCloudMap(null);
      core.removeLayer(layer);
      map.destroy(); skyBuf.destroy(); gridBuf.destroy();
    },
  };
  return layer;
}
