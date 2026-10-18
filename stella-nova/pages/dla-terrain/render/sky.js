// ============================================================================
//  DLA TERRAIN  ·  render/sky.js — the SKY module: atmosphere, sun, moon,
//  stars, volumetric clouds and (through render/weather.js) haze, rain,
//  snow, lightning and rainbows. Raw WebGPU, no DOM.
// ----------------------------------------------------------------------------
//  createSky(gpu) -> module (CONTRACT.md "Module interface"). CORE imports
//  only this file; it makes the weather part itself.
//
//  PER FRAME
//    update(frame)       fills the SkyU uniform (shaders/sky.wgsl "struct
//                        SkyU") from frame.globals and frame.weather (the
//                        skyState result), grows lightning bolts
//    compute(enc, frame) LUTs (transmittance and multiple scattering when
//                        the haze changes; the sky view each frame), the
//                        cloud shadow map, the cloud raymarch at half or a
//                        third of the render size, the temporal resolve,
//                        then the froxel haze of render/weather.js
//    drawSky(pass)       in CORE's opaque pass, at depth 0
//    drawVolumetric(pass, frame, ctx)
//                        cloud composite, haze, rain and snow, the bolt
//
//  WEATHER MODEL  frame.weather.sim (sky-state.js createSky) runs
//    weather-model.js. update() gives it the camera and the final terrain,
//    and uploads the two snapshots round the weather time into tWx
//    (binding 16, N x 6N rgba16float) when the pair changes; the shaders
//    blend them by S.wx0.z (wx_tile in sky.wgsl). Without a sim (a
//    stateless sky state) this module runs its own inline createSky.
//  CLOCK  every motion here uses the sum of frame.dt (st.clock), not the
//    wall clock G.camPos.w. Cloud noise moves with the upper wind over the
//    model's weather time (S.cloud1.zw; the step of the frame, S.anim0.xy,
//    is the motion vector of the cloud reprojection). Haze banks drift
//    with the low wind (S.anim1.xy). Rain and snow use the exact phases of
//    render/weather.js precipPhases (S.anim2 .. S.anim4).
//  DYNAMIC RESOLUTION  the cloud targets keep their size (and history)
//    unless the render size changes by more than a quarter.
//
//  WGSL. gpu.loadWGSL('shaders/sky.wgsl') gives common + detail + sky.
//  The text above the line "// @@SKY-ENTRY" is the SKY library. clouds.wgsl
//  and weather.wgsl compile as library + their own text (wgslFor).
//
//  BIND GROUPS (group 0 is CORE's globals, group 2 CORE's shadow sample)
//    group 1 READ   bindings 0..9 of sky.wgsl (uniform, LUTs, cloud shadow,
//                   noise, samplers): the compute passes that only read
//    group 1 READ   also 16: the weather model texture (weather-model.js)
//    group 1 DRAW   READ less 6, 7, 9, 16 (noise and model: the draw passes
//                   do not read them; a stage samples at most 16 textures)
//                   + 10 scene depth, 11 cloud accum, 12 cloud depth,
//                   13 froxel volume, 14 bolt segments, 15 sky shaft loss:
//                   the draw passes.
//                   Draw pipelines use 2 groups only, so CORE's group 2 in
//                   the volumetric pass stays as it is.
//    group 1 small  per writer pass, only what it reads (no usage clash)
//    group 3        the outputs of each compute pass
//
//  CLOUD SHADOW FOR OTHER PACKAGES: module.cloudShadow = { view, sampler,
//    rect () -> [x0, z0, size], base () -> cloud base y }. In WGSL see
//    "fn cloudShadow" in shaders/sky.wgsl: project p along the sun to the
//    cloud base, uv = (q - rect.xy) / rect.z, sample r. NOTES.md has the
//    copy-paste version.
//
//  grep -n targets: "export async function createSky", "function wgslFor",
//  "function makeLayouts", "function fillUniform", "function cloudLayer",
//  "function makeTargets", "compute(enc", "drawSky(", "drawVolumetric(",
//  "export const SKYU_FLOATS"
// ============================================================================
import { ATMO, SUN_ILLUM, SUN_RADIUS, GLOBALS, createSky as createSkyState } from '../sky-state.js';
import { CH as WX_CH, N as WX_N } from '../weather-model.js';
import { createWeather, precipPhases } from './weather.js';

// CHILL (the user: "it feels so computer generated with no CHILL to the
// dynamics"): the visible motion of the sky is capped in real time.
export const CLOUD_DRIFT_RATE = 6;     // cloud shapes: at most 6 x the upper wind
export const CLOUD_RISE = [1.2, 3.0];  // m/s: shape and detail noise rise (evolution)
export const HAZE_DRIFT_RATE = 6;      // haze banks: at most 6 x the low wind
export const SKYU_FLOATS = 26 * 4;   // struct SkyU: 26 vec4 (416 bytes)
const U = (typeof GPUBufferUsage !== 'undefined') ? GPUBufferUsage : { UNIFORM: 64, COPY_DST: 8, STORAGE: 128 };
const T = (typeof GPUTextureUsage !== 'undefined') ? GPUTextureUsage : { COPY_SRC: 1, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, COPY_DST: 2, RENDER_ATTACHMENT: 16 };
const SS = (typeof GPUShaderStage !== 'undefined') ? GPUShaderStage : { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
const ALL = SS.VERTEX | SS.FRAGMENT | SS.COMPUTE;

// SkyU field offsets (floats), in the order of the WGSL struct.
export const SKYU = Object.freeze({
  rayleigh: 0, mieS: 4, mieA: 8, ozone: 12, radii: 16, sun: 20, moon: 24,
  cloud0: 28, cloud1: 32, cloud2: 36, bolt: 40, vol0: 44, vol1: 48, vol2: 52,
  shadow: 56, misc: 60, counts: 64, precip: 68, prevCam: 72,
  wx0: 76, wx1: 80, anim0: 84, anim1: 88, anim2: 92, anim3: 96, anim4: 100,
});

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
// float32 -> float16 bits (round to nearest, clamp to the f16 range)
const f32b = new Float32Array(1), u32b = new Uint32Array(f32b.buffer);
export function f16(v) {
  f32b[0] = Number.isFinite(v) ? v : 0;
  const x = u32b[0], sign = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
  if (e >= 31) return sign | 0x7bff;
  if (e <= 0) { if (e < -10) return sign; m |= 0x800000; const sh = 14 - e; return sign | ((m + (1 << (sh - 1))) >> sh); }
  const r = sign | (e << 10) | (m >> 13);
  return (m & 0x1000) ? r + 1 : r;
}

// The SKY library cut from the joined sky.wgsl text, and a joined module
// text for clouds.wgsl or weather.wgsl.
export function splitSkyLibrary(joined) {
  const m = joined.match(/^\/\/ @@SKY-ENTRY.*$/m);
  if (!m) throw new Error('sky.wgsl: no // @@SKY-ENTRY line');
  return joined.slice(0, m.index);
}
async function wgslFor(gpu, lib, file) {
  if (gpu.loadRawWGSL) return lib + await gpu.loadRawWGSL(file);
  const url = new URL('../' + file, import.meta.url);
  const r = await fetch(url);
  if (!r.ok) throw new Error('sky: cannot load ' + file);
  return lib + await r.text();
}

// Cloud heights from the terrain: the base sits a little above the high
// valleys, so that the high peaks stand in and over the deck.
export function cloudLayer(terrain, wx) {
  const sea = terrain ? terrain.seaLevel || 0 : 0;
  const hs = terrain ? terrain.heightScale || 1500 : 1500;
  const base = sea + clamp(0.42 * hs + 700, 900, 2600) - 250 * (wx.fog > 1e-3 ? 1 : 0)
    - 350 * clamp(wx.storm ?? 0, 0, 1) - 200 * clamp(wx.rain ?? 0, 0, 1);
  // the slab holds the tallest cloud type of the weather: decks use its
  // lower part, cumulus cores grow toward the top (shaders/clouds.wgsl)
  const thick = 900 + 3400 * clamp(wx.cumulus, 0, 1) * Math.pow(clamp(wx.cover, 0, 1), 1.5);
  return { base, top: base + thick, anvil: base + 9500 };
}

// The floor of cloud cover from the air mass: scattered stratocumulus and
// altocumulus where the model has made no cloud yet (shaders/clouds.wgsl
// cl_wx). Without it, a fair sky before the cumulus grow was empty.
export function coverFloor(wx) {
  const air = clamp(wx.coverAir ?? wx.cover ?? 0, 0, 1);
  return clamp(0.6 * air, 0, 0.6);
}
// View steps of the cloud march (clouds.wgsl CL_STEPS_MAX caps them).
export const CLOUD_STEPS_MAX = 128;
export function cloudSteps(q, profile) {
  const n = Math.round(48 + 48 * clamp(q, 0, 1));
  // a phone profile (gpu/budget.js gives it a cloudK) marches fewer steps
  const cap = profile && profile.cloudK ? (profile.cloudK < 0.3 ? 40 : 56) : CLOUD_STEPS_MAX;
  return Math.min(n, cap, CLOUD_STEPS_MAX);
}

const DRAW_SKIP = [6, 7, 9, 16];
function makeLayouts(device, gpu) {
  const tex = (b, extra = {}) => ({ binding: b, visibility: ALL, texture: { sampleType: 'float', ...extra } });
  const read = [
    { binding: 0, visibility: ALL, buffer: { type: 'uniform' } },
    tex(1), tex(2), tex(3),
    { binding: 4, visibility: ALL, sampler: { type: 'filtering' } },
    tex(5), tex(6, { viewDimension: '3d' }), tex(7, { viewDimension: '3d' }),
    { binding: 8, visibility: ALL, sampler: { type: 'filtering' } },
    tex(9), tex(16),
  ];
  // the draw passes do not read the cloud noise or the weather model: keep
  // them out (a stage may sample at most 16 textures, group 0 has 4)
  const draw = read.filter((e) => !DRAW_SKIP.includes(e.binding)).concat([
    { binding: 10, visibility: SS.VERTEX | SS.FRAGMENT, texture: { sampleType: 'depth' } },
    tex(11), tex(12), tex(13, { viewDimension: '3d' }),
    { binding: 14, visibility: SS.VERTEX | SS.FRAGMENT, buffer: { type: 'read-only-storage' } },
    tex(15),
    // SHAFTS: the resolved shaft target of render/weather.js
    tex(17),
  ]);
  const sub = (ids) => device.createBindGroupLayout({ label: 'sky g1 ' + ids.join(','), entries: read.filter((e) => ids.includes(e.binding)) });
  return {
    read: device.createBindGroupLayout({ label: 'sky g1 read', entries: read }),
    draw: device.createBindGroupLayout({ label: 'sky g1 draw', entries: draw }),
    uOnly: sub([0]),
    multi: sub([0, 1, 4]),
    skyView: sub([0, 1, 2, 4]),
    shadow: sub([0, 4, 6, 7, 8, 9, 16]),
    // the shaft passes read the uniform, the LUTs and the cloud shadow
    // only. With all of READ, their compute stage had 17 sampled textures
    // (group 0: 4, READ: 8, shadow: 1, shaft: 4): over the limit of 16, so
    // the whole SKY module failed and the page showed the fallback sky.
    shaft: sub([0, 1, 2, 3, 4, 5]),
    empty: gpu.emptyLayout || device.createBindGroupLayout({ entries: [] }),
  };
}

export async function createSky(gpu) {
  const { device, queue } = gpu;
  const L = makeLayouts(device, gpu);
  const ubo = device.createBuffer({ label: 'SkyU', size: SKYU_FLOATS * 4, usage: U.UNIFORM | U.COPY_DST });
  const u = new Float32Array(SKYU_FLOATS);
  const sClamp = gpu.sLinear || device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
  const sRepeat = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat' });

  const tex2 = (w, h, format, label, extra = 0) => device.createTexture({ label, size: [w, h], format, usage: T.TEXTURE_BINDING | T.STORAGE_BINDING | T.COPY_SRC | extra });
  const tex3 = (n, format, label, extra = 0) => device.createTexture({ label, size: [n, n, n], dimension: '3d', format, usage: T.TEXTURE_BINDING | T.STORAGE_BINDING | T.COPY_SRC | extra });
  // a phone profile (gpu/budget.js) gives smaller noise volumes and maps;
  // the shaders take the size from textureDimensions
  const cn = (gpu.profile && gpu.profile.cloudNoise) || {};
  const SH = cn.shadow || 512, NB = cn.base || 128, ND = cn.detail || 32, N2 = cn.n2d || 512;
  const lut = {
    trans: tex2(256, 64, 'rgba16float', 'sky trans'),
    multi: tex2(32, 32, 'rgba16float', 'sky multi'),
    view: tex2(192, 108, 'rgba16float', 'sky view'),
    shadow: tex2(SH, SH, 'rgba16float', 'cloud shadow'),
    base: tex3(NB, 'rgba8unorm', 'cloud base noise'),
    detail: tex3(ND, 'rgba8unorm', 'cloud detail noise'),
    n2d: tex2(N2, N2, 'rgba8unorm', 'cloud 2d noise'),
    // the weather model: 6 tiles of N x N (snapshot a: A B C, snapshot b:
    // A B C), stacked in y; the shaders interpolate a to b (S.wx0.z)
    wx: device.createTexture({ label: 'weather model', size: [WX_N, WX_N * 6], format: 'rgba16float', usage: T.TEXTURE_BINDING | T.COPY_DST }),
  };
  const V = {};
  for (const k in lut) V[k] = lut[k].createView();

  // ── WGSL ──────────────────────────────────────────────────────────────────
  const skyText = await gpu.loadWGSL('shaders/sky.wgsl');
  const lib = splitSkyLibrary(skyText);
  const [cloudText, weatherText] = await Promise.all([
    wgslFor(gpu, lib, 'shaders/clouds.wgsl'), wgslFor(gpu, lib, 'shaders/weather.wgsl'),
  ]);
  const mSky = device.createShaderModule({ label: 'sky.wgsl', code: skyText });
  const mCloud = device.createShaderModule({ label: 'clouds.wgsl', code: cloudText });

  const bgl3 = (label, entries) => device.createBindGroupLayout({ label, entries: entries.map((e, i) => ({ visibility: SS.COMPUTE, ...e })) });
  const st2 = (b, format = 'rgba16float') => ({ binding: b, storageTexture: { access: 'write-only', format } });
  const st3 = (b, format) => ({ binding: b, storageTexture: { access: 'write-only', format, viewDimension: '3d' } });
  const tx = (b, extra = {}) => ({ binding: b, texture: { sampleType: 'float', ...extra } });
  const G3 = {
    lut: bgl3('sky out lut', [st2(0)]),
    vol: bgl3('cloud out vol', [st3(0, 'rgba8unorm')]),
    n2d: bgl3('cloud out 2d', [st2(1, 'rgba8unorm')]),
    shadow: bgl3('cloud out shadow', [st2(2)]),
    march: bgl3('cloud out march', [st2(3), st2(4)]),
    resolve: bgl3('cloud resolve', [tx(5), tx(6), tx(7), st2(8)]),
  };
  const comp = (module, entry, g1, g3) => device.createComputePipelineAsync({
    label: entry, compute: { module, entryPoint: entry },
    layout: device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, g1, L.empty, g3] }),
  });
  const blendPremul = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
  const P = {};
  [P.trans, P.multi, P.view, P.base, P.detail, P.n2d, P.shadow, P.march, P.resolve, P.sky, P.comp] = await Promise.all([
    comp(mSky, 'csTrans', L.uOnly, G3.lut),
    comp(mSky, 'csMulti', L.multi, G3.lut),
    comp(mSky, 'csSkyView', L.skyView, G3.lut),
    comp(mCloud, 'csNoiseBase', L.uOnly, G3.vol),
    comp(mCloud, 'csNoiseDetail', L.uOnly, G3.vol),
    comp(mCloud, 'csNoise2D', L.uOnly, G3.n2d),
    comp(mCloud, 'csCloudShadow', L.shadow, G3.shadow),
    comp(mCloud, 'csClouds', L.read, G3.march),
    comp(mCloud, 'csCloudResolve', L.read, G3.resolve),
    device.createRenderPipelineAsync({
      label: 'sky', layout: device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, L.read] }),
      vertex: { module: mSky, entryPoint: 'vsSky' },
      fragment: { module: mSky, entryPoint: 'fsSky', targets: [{ format: gpu.hdrFormat }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: gpu.depthFormat, depthWriteEnabled: false, depthCompare: 'greater-equal' },
    }),
    device.createRenderPipelineAsync({
      label: 'cloud composite', layout: device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, L.draw] }),
      vertex: { module: mCloud, entryPoint: 'vsCloudComp' },
      fragment: { module: mCloud, entryPoint: 'fsCloudComp', targets: [{ format: gpu.hdrFormat, blend: blendPremul }] },
      primitive: { topology: 'triangle-list' },
    }),
  ]);

  // ── bind groups that do not change ──────────────────────────────────────
  const bg = (layout, entries, label) => device.createBindGroup({ label, layout, entries: entries.map(([binding, resource]) => ({ binding, resource })) });
  const ub = { buffer: ubo };
  const BG = {
    uOnly: bg(L.uOnly, [[0, ub]], 'sky u'),
    multi: bg(L.multi, [[0, ub], [1, V.trans], [4, sClamp]], 'sky multi'),
    skyView: bg(L.skyView, [[0, ub], [1, V.trans], [2, V.multi], [4, sClamp]], 'sky view'),
    shadowRead: bg(L.shadow, [[0, ub], [4, sClamp], [6, V.base], [7, V.detail], [8, sRepeat], [9, V.n2d], [16, V.wx]], 'cloud shadow in'),
    read: bg(L.read, [[0, ub], [1, V.trans], [2, V.multi], [3, V.view], [4, sClamp], [5, V.shadow], [6, V.base], [7, V.detail], [8, sRepeat], [9, V.n2d], [16, V.wx]], 'sky read'),
    shaft: bg(L.shaft, [[0, ub], [1, V.trans], [2, V.multi], [3, V.view], [4, sClamp], [5, V.shadow]], 'sky shaft read'),
    empty: bg(L.empty, [], 'empty'),
    outTrans: bg(G3.lut, [[0, V.trans]]), outMulti: bg(G3.lut, [[0, V.multi]]), outView: bg(G3.lut, [[0, V.view]]),
    outBase: bg(G3.vol, [[0, V.base]]), outDetail: bg(G3.vol, [[0, V.detail]]), outN2d: bg(G3.n2d, [[1, V.n2d]]),
    outShadow: bg(G3.shadow, [[2, V.shadow]]),
  };
  const readEntries = [[0, ub], [1, V.trans], [2, V.multi], [3, V.view], [4, sClamp], [5, V.shadow], [6, V.base], [7, V.detail], [8, sRepeat], [9, V.n2d], [16, V.wx]];

  const weather = await createWeather(gpu, {
    lib, weatherText, layouts: L, readBindGroup: BG.read, shaftBindGroup: BG.shaft, ubo, u, SKYU, sClamp,
  });

  // ── size dependent targets ──────────────────────────────────────────────
  let tg = null;
  function makeTargets(w, h, q, force) {
    const k = Math.min(q >= 0.5 ? 0.5 : 0.34, (gpu.profile && gpu.profile.cloudK) || 1);
    const cw = Math.max(8, Math.round(w * k)), ch = Math.max(8, Math.round(h * k));
    // dynamic resolution changes the render size in steps of 5 to 10 %:
    // keep the cloud targets (and their history) unless the size changes
    // by more than a quarter or the aspect changes. The march works in uv,
    // so the targets need not match the render size.
    if (tg && !force && tg.k === k && Math.abs(cw / tg.cw - 1) < 0.25 && Math.abs(ch / tg.ch - 1) < 0.25 && Math.abs((cw / ch) / (tg.cw / tg.ch) - 1) < 0.02) {
      tg.w = w; tg.h = h;
      return;
    }
    if (tg) for (const t of tg.all) t.destroy();
    const mk = (label) => tex2(cw, ch, 'rgba16float', label);
    tg = { w, h, cw, ch, k, raw: mk('cloud raw'), rawZ: mk('cloud raw z'), acc: [mk('cloud acc 0'), mk('cloud acc 1')], all: [] };
    tg.all = [tg.raw, tg.rawZ, ...tg.acc];
    tg.v = { raw: tg.raw.createView(), rawZ: tg.rawZ.createView(), acc: tg.acc.map((t) => t.createView()) };
    tg.march = bg(G3.march, [[3, tg.v.raw], [4, tg.v.rawZ]], 'cloud march out');
    tg.resolve = [0, 1].map((i) => bg(G3.resolve, [[5, tg.v.raw], [6, tg.v.rawZ], [7, tg.v.acc[1 - i]], [8, tg.v.acc[i]]], 'cloud resolve ' + i));
    tg.ping = 0;
    tg.drawBG = new Map();
    tg.fresh = true;
    weather.resize(w, h, q);
  }

  // cached per depth view, shaft view and cloud ping (the cloud and the
  // shaft targets ping-pong, so a steady frame makes no bind group)
  function drawGroup(depthView) {
    const vb = weather.drawResources();
    let byShaft = tg.drawBG.get(depthView);
    if (!byShaft) { byShaft = new Map(); tg.drawBG.set(depthView, byShaft); }
    let pair = byShaft.get(vb.shaftKey);
    if (!pair) { pair = [null, null]; byShaft.set(vb.shaftKey, pair); if (byShaft.size > 4) byShaft.delete(byShaft.keys().next().value); }
    let g = pair[tg.ping];
    if (g && g.stamp === vb.stamp) return g.bg;
    const e = readEntries.filter(([b]) => !DRAW_SKIP.includes(b)).concat([[10, depthView], [11, tg.v.acc[tg.ping]], [12, tg.v.rawZ], [13, vb.volumeView], [14, { buffer: vb.boltBuffer }], [15, vb.lossView], [17, vb.shaftView]]);
    g = { bg: bg(L.draw, e, 'sky draw'), stamp: vb.stamp };
    pair[tg.ping] = g;
    if (tg.drawBG.size > 8) tg.drawBG.delete(tg.drawBG.keys().next().value);
    return g.bg;
  }

  // ── per frame state ─────────────────────────────────────────────────────
  const st = {
    clock: 0, cloudOff: [0, 0], cloudPrev: [0, 0], hazeOff: [0, 0], rainOff: [0, 0], snowOff: [0, 0], wxKey: null, own: null,
    terrain: null, frameNo: 0, lutMie: -1, noiseDone: false, windOff: [0, 0], prevCam: [0, 0, 0],
    q: gpu.quality ?? 1, lastT: null, haveFrame: false,
  };

  // ── the weather model texture ─────────────────────────────────────────
  // Two snapshots (a, b) of weather-model.js, 3 tiles each (A cover, type,
  // top, precip; B storm, fog, base, cirrus; C fog top, wind x, wind z,
  // freezing level), as rgba16float. Uploaded only when the pair changes
  // (a few times a second at most); the shaders blend a to b by S.wx0.z.
  const wxHalf = new Uint16Array(WX_N * WX_N * 6 * 4);
  function uploadWx(br) {
    const n = WX_N, nn = n * n;
    for (let s2 = 0; s2 < 2; s2++) {
      const d = (s2 ? br.b : br.a).data;
      for (let tile = 0; tile < 3; tile++) {
        const o = ((s2 * 3 + tile) * nn) * 4;
        for (let k = 0; k < nn; k++) for (let c = 0; c < 4; c++) wxHalf[o + k * 4 + c] = f16(d[k * WX_CH + tile * 4 + c]);
      }
    }
    queue.writeTexture({ texture: lut.wx }, wxHalf, { bytesPerRow: n * 8, rowsPerImage: n * 6 }, [n, n * 6, 1]);
  }

  function fillUniform(frame) {
    const g = frame.globals;
    let s = frame.weather || {};
    // the clock of every motion here: the sum of the frame steps, not the
    // wall clock (G.camPos.w), so a late frame moves things by its dt only
    const rdt = clamp(Number.isFinite(frame.dt) ? frame.dt : 1 / 60, 0, 0.1);
    st.clock += rdt;
    const cam = [g[GLOBALS.camPos], g[GLOBALS.camPos + 1], g[GLOBALS.camPos + 2]];
    // the weather model: the state of sky-state.js createSky carries it
    // (s.sim); without it (a stateless sky state) this module runs its own
    let sim = s.sim;
    if (!sim && s.weatherId) {
      st.own = st.own || createSkyState({ worker: false });
      const o = st.own.update(s.tod ?? 0.5, s.weatherId, s.season ?? 0.3, s.latitude ?? 46, st.clock);
      sim = o.sim;
      s = { ...o, ...s, wx: { ...o.wx, ...(s.wx || {}) }, gameT: o.gameT, upperWind: o.upperWind, local: o.local };
    }
    if (sim) {
      sim.setCamera(cam);
      if (st.terrain && st.terrain.cpu && st.terrain.cpu.height) sim.setTerrain(st.terrain.cpu);
    }
    const wx = s.wx || { cover: g[GLOBALS.weather], rain: g[GLOBALS.weather + 1], snow: g[GLOBALS.weather + 2], storm: g[GLOBALS.weather2 + 2], fog: g[GLOBALS.fog + 3], cumulus: 0.7, cirrus: 0.3, mie: 1, wind: 5 };
    const q = frame.quality ?? g[GLOBALS.frame + 2] ?? 1;
    const terr = st.terrain;
    const sea = g[GLOBALS.terrain + 2];
    const sunY = g[GLOBALS.sunDir + 1];
    const mie = clamp(wx.mie ?? 1, 0.3, 6);
    const put = (o, a, b, c, d) => { u[o] = a; u[o + 1] = b; u[o + 2] = c; u[o + 3] = d; };
    put(SKYU.rayleigh, ATMO.rayleigh[0], ATMO.rayleigh[1], ATMO.rayleigh[2], ATMO.rayleighH);
    put(SKYU.mieS, ATMO.mieS * mie, ATMO.mieS * mie, ATMO.mieS * mie, ATMO.mieH);
    put(SKYU.mieA, ATMO.mieA * mie, ATMO.mieA * mie, ATMO.mieA * mie, ATMO.mieG);
    put(SKYU.ozone, ATMO.ozone[0], ATMO.ozone[1], ATMO.ozone[2], ATMO.ozoneC);
    put(SKYU.radii, ATMO.bottom, ATMO.top, ATMO.ozoneW, ATMO.bottom + Math.max(cam[1] - sea, 2) / 1000);
    const tod = s.tod ?? g[GLOBALS.sunColor + 3];
    const season = s.season ?? g[GLOBALS.weather2 + 3];
    const lat = (s.latitude ?? 46) * Math.PI / 180;
    put(SKYU.sun, SUN_RADIUS, SUN_ILLUM, 2 * Math.PI * (tod + season), smooth(0.06, -0.16, sunY));
    const md = s.moonDir || [g[GLOBALS.moonDir], g[GLOBALS.moonDir + 1], g[GLOBALS.moonDir + 2]];
    put(SKYU.moon, md[0], md[1], md[2], s.moonScale ?? g[GLOBALS.moonDir + 3]);

    // the model snapshots and the cloud slab of the whole domain
    const br = sim ? sim.bracket : null;
    const cl = cloudLayer(terr, wx);
    // the direction of the upper wind for the cirrus streaks, turned slowly
    const upw = s.upperWind || [1, 0], ul = Math.hypot(upw[0], upw[1]) || 1;
    st.ciDir = st.ciDir || [upw[0] / ul, upw[1] / ul];
    const kd = 1 - Math.exp(-rdt / 4);
    st.ciDir[0] += (upw[0] / ul - st.ciDir[0]) * kd; st.ciDir[1] += (upw[1] / ul - st.ciDir[1]) * kd;
    if (br) {
      const key = br.a.epoch + ':' + br.a.t + ':' + br.b.t;
      if (key !== st.wxKey) { uploadWx(br); st.wxKey = key; }
      const lo = Math.min(br.a.minBase, br.b.minBase), hi = Math.max(br.a.maxTop, br.b.maxTop);
      put(SKYU.wx0, br.a.x0, br.a.D, br.w, WX_N);
      put(SKYU.wx1, lo - 50, Math.max(hi + 300, lo + 800), st.ciDir[0], st.ciDir[1]);
      if (s.local) { cl.base = s.local[6]; cl.top = s.local[2]; }
    } else {
      // no snapshot yet: a uniform field from the preset values
      if (st.wxKey !== 'flat') {
        const fake = new Float32Array(WX_N * WX_N * WX_CH);
        for (let k = 0; k < WX_N * WX_N; k++) fake.set([wx.cover, wx.cumulus ?? 0.7, cl.top, wx.rain + wx.snow, wx.storm ?? 0, 0, cl.base, wx.cirrus ?? 0.3, sea, 0, 0, 3000], k * WX_CH);
        uploadWx({ a: { data: fake }, b: { data: fake } });
        st.wxKey = 'flat';
      }
      put(SKYU.wx0, -1e6, 2e6, 0, WX_N);
      put(SKYU.wx1, cl.base - 50, cl.anvil, st.ciDir[0], st.ciDir[1]);
    }
    put(SKYU.cloud0, cl.base, cl.top, clamp(wx.cover, 0, 1), clamp(wx.cumulus ?? 0.7, 0, 1));
    // cloud motion: the upper wind over the weather time of the model, so
    // the noise moves with the model's cloud masses. The step of the frame
    // is the motion vector of the cloud reprojection.
    const gdt = (typeof s.gameT === 'number' && typeof st.lastGameT === 'number' && s.gameT >= st.lastGameT && s.gameT - st.lastGameT < 3600) ? s.gameT - st.lastGameT : rdt * 60;
    st.lastGameT = s.gameT;
    const up = s.upperWind || [g[GLOBALS.wind] * 2.5, g[GLOBALS.wind + 1] * 2.5];
    st.cloudPrev[0] = st.cloudOff[0]; st.cloudPrev[1] = st.cloudOff[1];
    // CHILL: the cloud shapes drift at most CLOUD_DRIFT_RATE x real time
    // (a 15 m/s upper wind moves them 90 m/s: a cloud 3 km away crosses
    // about 2 deg a second); the model's cover moves at the weather rate,
    // so clouds form and fade as it passes, slowly
    const cdt = Math.min(gdt, rdt * CLOUD_DRIFT_RATE);
    st.cloudOff[0] += up[0] * cdt; st.cloudOff[1] += up[1] * cdt;
    // the shapes evolve (rise and boil) in real time, slowly
    st.evolve = (st.evolve || 0) + rdt;
    put(SKYU.cloud1, clamp(wx.storm ?? 0, 0, 1), clamp(wx.cirrus ?? 0.3, 0, 1), -st.cloudOff[0], -st.cloudOff[1]);
    put(SKYU.anim0, st.cloudOff[0] - st.cloudPrev[0], st.cloudOff[1] - st.cloudPrev[1], (st.evolve * CLOUD_RISE[0]) % 3000, (st.evolve * CLOUD_RISE[1]) % 520);
    // haze banks drift with the low wind (at most HAZE_DRIFT_RATE x real time)
    const lw = s.local ? [s.local[9], s.local[10]] : [g[GLOBALS.wind], g[GLOBALS.wind + 1]];
    const hdt = Math.min(gdt, rdt * HAZE_DRIFT_RATE);
    st.hazeOff[0] = (st.hazeOff[0] + lw[0] * hdt) % 1400; st.hazeOff[1] = (st.hazeOff[1] + lw[1] * hdt) % 1400;
    // rain and snow: real time and the gusty ground wind, wrapped exactly
    // by the box spans (render/weather.js precipPhases)
    const wv = [g[GLOBALS.wind], g[GLOBALS.wind + 1]];
    const ph = precipPhases(st, wv, rdt, 32, 26);
    put(SKYU.anim2, ph.rainOff[0], ph.rainOff[1], ph.snowOff[0], ph.snowOff[1]);
    put(SKYU.anim3, ph.rainA, ph.rainB, ph.snowA, ph.snowB);
    put(SKYU.cloud2, coverFloor(wx), 1.0, cl.anvil, cloudSteps(st.q ?? q, gpu.profile));
    // the bolt: at the stroke's cell (x, z) or a bearing and a distance
    const flash = g[GLOBALS.weather + 3];
    const b = s.bolt;
    if (b && typeof b.x === 'number') put(SKYU.bolt, b.x, cl.base, b.z, flash);
    else if (b) put(SKYU.bolt, cam[0] + Math.cos(b.angle) * b.dist, cl.base, cam[2] + Math.sin(b.angle) * b.dist, flash);
    else put(SKYU.bolt, cam[0], cl.base + 2000, cam[2], flash);
    // froxel haze
    const ws = terr ? terr.worldSize : 16000;
    const minH = g[GLOBALS.terrainOrigin + 2], maxH = g[GLOBALS.terrainOrigin + 3];
    const span = Math.max(maxH - minH, 50);
    const fogTop = Math.max(minH + 0.12 * span + 30, sea + 40);
    const far = clamp(ws * 1.3, 24000, 90000);
    put(SKYU.vol0, 1.0, far, clamp(s.valleyFog ?? 0, 0, 1.5), fogTop);
    const jit = ((st.frameNo * 0.618034) % 1);
    put(SKYU.vol1, clamp(wx.rain, 0, 1), clamp(wx.snow, 0, 1), wx.fog ?? 2e-5, jit);
    const grid = weather.grid;
    // a jump of the light (a new time of day or weather from the UI): drop
    // the history of the froxels and the clouds for one frame, no ghosts
    const sig = Math.log(1e-5 + g[GLOBALS.ambient + 1] + 0.05 * g[GLOBALS.sunColor + 1]) + 3 * wx.cover + 40 * (wx.fog ?? 0);
    const jump = st.sig !== undefined && Math.abs(sig - st.sig) > 0.25;
    st.sig = sig;
    put(SKYU.vol2, grid[0], grid[1], grid[2], st.haveFrame && !tg.fresh && !jump ? 0.88 : 0);
    // cloud shadow square round the camera, snapped to its texels
    const size = clamp(ws * 1.4, 30000, 90000), texel = size / SH;
    const x0 = Math.floor((cam[0] - size / 2) / texel) * texel, z0 = Math.floor((cam[2] - size / 2) / texel) * texel;
    // SHAFTS: the mode (0 off, 1 volumetric, 2 screen) and the range m
    const shf = weather.shaftFrame(frame);
    put(SKYU.shadow, x0, z0, size, shf.mode);
    // rainbow: rain in the air and a sun lower than 42 deg that the deck lets through
    const sunEl = Math.asin(clamp(sunY, -1, 1)) * 180 / Math.PI;
    const rainbow = (s.rainbow ?? 1) * smooth(0.02, 0.25, wx.rain) * smooth(-1, 4, sunEl) * smooth(42, 30, sunEl) * (1 - smooth(0.88, 1.0, wx.cover) * 0.8);
    put(SKYU.misc, lat, s.moonPhase ?? 0.5, st.clock % 3600, rainbow);
    const cnt = st.rain === false ? { rain: 0, splash: 0, snow: 0, bolt: 0, rainMax: 1, splashMax: 1, snowMax: 1 } : weather.counts(wx, q, frame, s.bolt);
    put(SKYU.counts, cnt.rain, cnt.splash, cnt.snow, cnt.bolt);
    put(SKYU.anim1, st.hazeOff[0], st.hazeOff[1], cnt.splashMax, shf.range);
    put(SKYU.anim4, ph.splashT, ph.flutterT, cnt.rainMax, cnt.snowMax);
    put(SKYU.precip, 32, 26, 1.8 / 60, 0.0026);
    put(SKYU.prevCam, st.prevCam[0], st.prevCam[1], st.prevCam[2], tg ? tg.k : 0.5);
    st.prevCam = cam;
    return { wx, cl, cam, q, s };
  }

  const mod = {
    name: 'sky', role: 'SKY',
    cloudShadow: {
      view: V.shadow, sampler: sClamp,
      rect: () => [u[SKYU.shadow], u[SKYU.shadow + 1], u[SKYU.shadow + 2]],
      base: () => u[SKYU.cloud0],
    },
    // the Hillaire sky-view LUT (192 x 108, radiance per unit sun), for
    // reflections: see NOTES.md for the uv mapping; multiply by scale
    skyView: { view: V.view, sampler: sClamp, scale: SUN_ILLUM },
    get uniformBuffer() { return ubo; },
    get readLayout() { return L.read; },
    get readBindGroup() { return BG.read; },
    weather,
    _debug: { lut, targets: () => tg },

    setTerrain(t) { st.terrain = t; weather.setTerrain(t); },

    update(frame) {
      // a phone (coarse pointer) runs the low path: a third-size cloud
      // target and the small froxel grid
      const qe = Math.min(frame.quality ?? st.q, frame.coarse ? 0.3 : 1);
      if (tg && Math.abs(qe - st.q) > 1e-3) mod.setQuality(qe);
      else st.q = qe;
      st.clouds = !(frame.layers && frame.layers.clouds === false);
      st.rain = !(frame.layers && frame.layers.rain === false);
      if (!tg) {
        const g = frame.globals;
        makeTargets(Math.max(16, g[GLOBALS.screen] | 0), Math.max(16, g[GLOBALS.screen + 1] | 0), frame.quality ?? 1);
      }
      const info = fillUniform(frame);
      weather.update(frame, info);
      queue.writeBuffer(ubo, 0, u);
    },

    compute(enc, frame) {
      if (!tg) mod.update(frame);
      const pass = enc.beginComputePass({ label: 'sky compute' });
      pass.setBindGroup(0, gpu.globalsBindGroup);
      pass.setBindGroup(2, BG.empty);
      const run = (p, g1, g3, x, y = 1, z = 1) => {
        pass.setPipeline(p); pass.setBindGroup(1, g1); pass.setBindGroup(3, g3); pass.dispatchWorkgroups(x, y, z);
      };
      if (!st.noiseDone) {
        run(P.base, BG.uOnly, BG.outBase, NB / 4, NB / 4, NB / 4);
        run(P.detail, BG.uOnly, BG.outDetail, ND / 4, ND / 4, ND / 4);
        run(P.n2d, BG.uOnly, BG.outN2d, N2 / 8, N2 / 8);
        st.noiseDone = true;
      }
      const mie = u[SKYU.mieS];
      if (Math.abs(mie - st.lutMie) > st.lutMie * 0.02) {
        run(P.trans, BG.uOnly, BG.outTrans, 32, 8);
        pass.end();
        // a new pass, so that the multi pass reads the finished trans LUT
        const p2 = enc.beginComputePass({ label: 'sky multi' });
        p2.setBindGroup(0, gpu.globalsBindGroup); p2.setBindGroup(2, BG.empty);
        p2.setPipeline(P.multi); p2.setBindGroup(1, BG.multi); p2.setBindGroup(3, BG.outMulti); p2.dispatchWorkgroups(32, 32);
        p2.end();
        st.lutMie = mie;
        return mod.compute2(enc, frame);
      }
      pass.end();
      return mod.compute2(enc, frame);
    },

    compute2(enc, frame) {
      const pass = enc.beginComputePass({ label: 'clouds' });
      pass.setBindGroup(0, gpu.globalsBindGroup);
      pass.setBindGroup(2, BG.empty);
      const run = (p, g1, g3, x, y = 1, z = 1) => {
        pass.setPipeline(p); pass.setBindGroup(1, g1); pass.setBindGroup(3, g3); pass.dispatchWorkgroups(x, y, z);
      };
      run(P.view, BG.skyView, BG.outView, 24, 14);
      run(P.shadow, BG.shadowRead, BG.outShadow, SH / 8, SH / 8);
      if (st.clouds) {
        run(P.march, BG.read, tg.march, Math.ceil(tg.cw / 8), Math.ceil(tg.ch / 8));
        tg.ping = 1 - tg.ping;
        run(P.resolve, BG.read, tg.resolve[tg.ping], Math.ceil(tg.cw / 8), Math.ceil(tg.ch / 8));
      }
      pass.end();
      weather.compute(enc, frame);
      st.frameNo++;
      st.haveFrame = true;
      tg.fresh = false;
    },

    drawSky(pass) {
      pass.setPipeline(P.sky);
      pass.setBindGroup(0, gpu.globalsBindGroup);
      pass.setBindGroup(1, BG.read);
      pass.draw(3);
    },

    // SHAFTS: CORE calls this after its water pass, before the volumetric
    // pass (gpu/frame.js), with the depth and the shadow map of this frame
    volumetricPrep(enc, frame, ctx) {
      if (!tg) return;
      weather.prep(enc, frame, ctx, st.clouds ? tg.v.acc[tg.ping] : null);
    },

    drawVolumetric(pass, frame, ctx) {
      if (!tg || !ctx || !ctx.depthView) return;
      const g1 = drawGroup(ctx.depthView);
      pass.setBindGroup(0, gpu.globalsBindGroup);
      pass.setBindGroup(1, g1);
      if (st.clouds) { pass.setPipeline(P.comp); pass.draw(3); }
      weather.draw(pass, frame, g1);
    },

    resize(w, h) { makeTargets(w, h, st.q); },
    setQuality(q) { st.q = q; if (tg) makeTargets(tg.w, tg.h, q); weather.setQuality(q); },

    dispose() {
      if (tg) for (const t of tg.all) t.destroy();
      for (const k in lut) lut[k].destroy();
      ubo.destroy();
      weather.dispose();
    },
  };
  return mod;
}
