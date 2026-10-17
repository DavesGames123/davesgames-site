// ============================================================================
//  DLA TERRAIN  ·  gpu/globals.js — the CPU side of shaders/common.wgsl (no DOM)
// ----------------------------------------------------------------------------
//  GLOBALS lists the fields of struct Globals in order, with the float
//  offset and size of each. packGlobals writes one frame into a
//  Float32Array(GLOBALS_FLOATS). tests/core.test.mjs parses common.wgsl and
//  checks that these offsets agree with the WGSL layout rules.
//
//  CASCADE_FLOATS, packCascades(f32, c) and packShadowPass(f32, c, i) do the
//  same for struct CascadeInfo and struct ShadowPass.
//
//  applyWxOver(f, over) puts the weather sliders of the page on top of the
//  SKY values in a packed Globals; wxFromGlobals(f) reads them back.
//
//  grep -n targets: "export const GLOBALS", "export function packGlobals", "export function applyWxOver",
//  "export function packCascades", "export function globalsView"
// ============================================================================

const M = 16, V = 4;
const FIELDS = [
  ['viewProj', M], ['invViewProj', M], ['view', M], ['proj', M], ['prevViewProj', M],
  ['camPos', V], ['sunDir', V], ['sunColor', V], ['moonDir', V], ['ambient', V], ['fog', V],
  ['wind', V], ['weather', V], ['weather2', V], ['terrain', V], ['terrainOrigin', V],
  ['screen', V], ['frame', V],
];
export const GLOBALS = (() => {
  const out = {}; let o = 0;
  for (const [k, n] of FIELDS) { out[k] = { offset: o, size: n }; o += n; }
  return Object.freeze(out);
})();
export const GLOBALS_FLOATS = FIELDS.reduce((s, f) => s + f[1], 0);   // 132
export const GLOBALS_BYTES = GLOBALS_FLOATS * 4;                       // 528

// A named view of each field into one Float32Array (for modules that read
// frame.globals): g.sunDir[0..3], g.viewProj[0..15], and so on.
export function globalsView(f32) {
  const v = {};
  for (const k in GLOBALS) v[k] = f32.subarray(GLOBALS[k].offset, GLOBALS[k].offset + GLOBALS[k].size);
  return v;
}

const put = (f, k, a) => {
  const o = GLOBALS[k].offset, n = GLOBALS[k].size;
  for (let i = 0; i < n; i++) f[o + i] = a && a[i] !== undefined ? +a[i] : 0;
};

// s = { viewProj, invViewProj, view, proj, prevViewProj (16 each, column
// major), camPos, time, sky {sunDir, sunIlluminance, sunColor, tod, moonDir,
// moonIlluminance, ambient, fog, fogDensity, wind, gust, windPhase, cover,
// rain, snow, lightning, wetness, snowCover, storminess, season}, exposure,
// terrain {worldSize, heightScale, seaLevel, n, minH, maxH}, width, height,
// frame, dt, quality, coarse }. Missing values pack as 0.
export function packGlobals(f, s) {
  const sky = s.sky || {}, t = s.terrain || {};
  put(f, 'viewProj', s.viewProj); put(f, 'invViewProj', s.invViewProj);
  put(f, 'view', s.view); put(f, 'proj', s.proj); put(f, 'prevViewProj', s.prevViewProj || s.viewProj);
  const cp = s.camPos || [0, 0, 0];
  put(f, 'camPos', [cp[0], cp[1], cp[2], s.time || 0]);
  const sd = sky.sunDir || [0, 1, 0], sc = sky.sunColor || [0, 0, 0];
  put(f, 'sunDir', [sd[0], sd[1], sd[2], sky.sunIlluminance ?? 1]);
  put(f, 'sunColor', [sc[0], sc[1], sc[2], sky.tod ?? 0.5]);
  const md = sky.moonDir || [0, -1, 0];
  put(f, 'moonDir', [md[0], md[1], md[2], sky.moonIlluminance ?? 0]);
  const am = sky.ambient || [0, 0, 0];
  put(f, 'ambient', [am[0], am[1], am[2], s.exposure ?? 1]);
  const fg = sky.fog || [0, 0, 0];
  put(f, 'fog', [fg[0], fg[1], fg[2], sky.fogDensity ?? 0]);
  const w = sky.wind || [0, 0];
  put(f, 'wind', [w[0], w[1], sky.gust ?? 0, sky.windPhase ?? 0]);
  put(f, 'weather', [sky.cover ?? 0, sky.rain ?? 0, sky.snow ?? 0, sky.lightning ?? 0]);
  put(f, 'weather2', [sky.wetness ?? 0, sky.snowCover ?? 0, sky.storminess ?? 0, sky.season ?? 0]);
  const ws = t.worldSize || 1, n = t.n || 1;
  put(f, 'terrain', [ws, t.heightScale || 0, t.seaLevel || 0, ws / n]);
  put(f, 'terrainOrigin', [-ws / 2, -ws / 2, t.minH || 0, t.maxH || 0]);
  const W = s.width || 1, H = s.height || 1;
  put(f, 'screen', [W, H, 1 / W, 1 / H]);
  put(f, 'frame', [s.frame || 0, s.dt || 0, s.quality ?? 1, s.coarse ? 1 : 0]);
  return f;
}

// struct CascadeInfo: viewProj array<mat4x4f, 4>, splits, texel, params.
export const CASCADE_FLOATS = 4 * 16 + 12;   // 76 floats = 304 bytes
// c = { count, size, mats: [Float32Array(16) x count], splits: [], texel: [],
//       depthBias, normalBias }
export function packCascades(f, c) {
  f.fill(0);
  for (let i = 0; i < 4; i++) {
    const m = c.mats[Math.min(i, c.mats.length - 1)];
    if (m) f.set(m, i * 16);
  }
  for (let i = 0; i < 4; i++) {
    f[64 + i] = c.splits[Math.min(i, c.splits.length - 1)] || 0;
    f[68 + i] = c.texel[Math.min(i, c.texel.length - 1)] || 0;
  }
  f[72] = c.count; f[73] = c.size; f[74] = c.depthBias ?? 0; f[75] = c.normalBias ?? 0;
  return f;
}
// struct ShadowPass: viewProj, info (cascade, texel m, count, size).
export const SHADOWPASS_FLOATS = 20;
export function packShadowPass(f, c, i) {
  f.set(c.mats[i], 0);
  f[16] = i; f[17] = c.texel[i]; f[18] = c.count; f[19] = c.size;
  return f;
}

// the weather sliders on top of the preset (fog 0..1 -> 1.5e-5 .. 6e-3 per m)
export function applyWxOver(f, over) {
  const W = GLOBALS.weather.offset, W2 = GLOBALS.weather2.offset, F = GLOBALS.fog.offset, WI = GLOBALS.wind.offset;
  if (over.cover !== undefined) f[W] = over.cover;
  if (over.rain !== undefined) { f[W + 1] = over.rain; f[W2] = Math.max(f[W2], Math.min(1, over.rain * 1.2)); }
  if (over.snow !== undefined) { f[W + 2] = over.snow; f[W2 + 1] = Math.max(f[W2 + 1], over.snow); }
  if (over.fog !== undefined) f[F + 3] = 1.5e-5 * Math.pow(400, over.fog);
  if (over.wind !== undefined) {
    const l = Math.hypot(f[WI], f[WI + 1]);
    if (l < 1e-6) { f[WI] = over.wind; f[WI + 1] = 0; }
    else { f[WI] = f[WI] / l * over.wind; f[WI + 1] = f[WI + 1] / l * over.wind; }
  }
  return f;
}
export function wxFromGlobals(f) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const W = GLOBALS.weather.offset, F = GLOBALS.fog.offset, WI = GLOBALS.wind.offset;
  return { cover: f[W], rain: f[W + 1], snow: f[W + 2], fog: clamp(Math.log(Math.max(f[F + 3], 1.5e-5) / 1.5e-5) / Math.log(400), 0, 1), wind: Math.hypot(f[WI], f[WI + 1]) };
}

