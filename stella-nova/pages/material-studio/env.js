// ============================================================================
//  MATERIAL STUDIO  ·  env.js — HDRI environment, IBL precompute and lights
// ────────────────────────────────────────────────────────────────────────────
//  Owner: ENVIRONMENT agent. This module makes the lighting environment of
//  the viewport. It draws procedural HDRI presets on the GPU, loads .hdr and
//  8-bit images, and fetches CC0 Poly Haven HDRIs. Then it prefilters the
//  result for split-sum image-based lighting and writes the analytic lights.
//
//  DATA FLOW
//      source (preset shader | .hdr upload | image | Poly Haven .hdr)
//        -> envTex   2048x1024 rgba16float equirect, 11 box mips
//        -> specTex  1024x512  rgba16float, 7 mips, mip i = roughness i/6
//        -> shBuf    9 x vec4f, irradiance/pi SH9 (from envTex mip 4)
//      lutTex 256x256 rg16float BRDF LUT is computed once at init.
//      state.env (rotation, intensity, exposure, tint, saturation,
//      background, blur, bgColor, bgIntensity, lights) -> uBuf (EnvU, 192 B).
//      The GPU objects are made once. A new source only rewrites their
//      contents, so a consumer bind group stays valid for the page life.
//
//  EVENTS
//      listens  env:changed  -> write uBuf; load a new source when
//                               state.env.preset changed; redraw the probe
//               view:changed -> redraw the probe (exposure)
//               boot:done    -> mount the panel into #env-panel if it is empty
//      emits    env:changed  (state.env) after each new source is ready
//
//  CONSUMER API  (the viewport)
//      getEnvBindings()               GPU resources, null before the first source
//      envWGSL({group, binding})      WGSL: the 6 bindings plus helper functions
//      envBindGroupLayoutEntries(b,v) matching GPUBindGroupLayoutEntry[]
//      envBindGroupEntries(b)         matching GPUBindGroupEntry[]
//
//  SECTIONS  (grep -n the banner to jump)
//      constants ........ sizes, PRESETS, PH_PRESETS
//      helpers .......... color, half floats, readback
//      hdr parser ....... parseHDR (Radiance RGBE, new RLE and flat)
//      gpu setup ........ createResources / createPipelines / bakeLUT
//      sources .......... drawPreset / uploadFloat / uploadImage / fetchPolyHaven
//      process .......... buildMipsAndIBL (mips, prefilter, SH)
//      uniform .......... writeUniform (EnvU layout)
//      public api ....... setPreset / loadFile / loadHDR / getEnvBindings / envWGSL
//      thumbs ........... thumbs() / sourceThumb() / presetThumbnail(id)
//      analysis ......... findSun / readEnvTexels
//      probe ............ the 3-sphere preview canvas
//      panel ............ mountPanel (presets, sliders, background, lights)
//      self test ........ selfTest
//      init ............. init(ctx)
//
//  NOT SUPPORTED  OpenEXR upload. A correct reader needs PIZ/ZIP/DWAA
//  decompression (several hundred lines), so .exr files show a toast that
//  asks for a .hdr file instead.
// ============================================================================
import { state, on, emit, setEnv, toast } from './store.js';
import { gpu, onTeardown, configureCanvas } from './gpu.js';

// ------------------------------------------------------------ constants
export const ENV_W = 2048, ENV_H = 1024, ENV_MIPS = 11;
export const SPEC_W = 1024, SPEC_H = 512, SPEC_MIPS = 7;
export const LUT_SIZE = 256;
export const SH_MIP = 4;                 // 128x64 level feeds the SH projection
export const MAX_LIGHTS = 4;
export const ENV_UNIFORM_SIZE = 192;     // EnvU in env-lib.wgsl
const TONE_MIP = 3;                      // 256x128 level feeds source thumbs
const THUMB_W = 256, THUMB_H = 128;
const SLOT = 256;                        // uniform slot stride (dynamic-offset alignment)
const PREFILTER_SAMPLES = [0, 128, 192, 256, 256, 256, 256];
const MAX_HALF = 60000;

/** Procedural presets. `idx` is the case in env-presets.wgsl presetRadiance. */
export const PRESETS = [
  { id: 'studio',     idx: 0,  label: 'Studio Softbox', group: 'Studio',   ev: 2.0 },
  { id: 'studioRim',  idx: 1,  label: 'Studio Rim',     group: 'Studio',   ev: 4.0 },
  { id: 'overcast',   idx: 2,  label: 'Overcast',       group: 'Outdoor',  ev: 0.6 },
  { id: 'clearNoon',  idx: 3,  label: 'Clear Noon',     group: 'Outdoor',  ev: 0.5 },
  { id: 'goldenHour', idx: 4,  label: 'Golden Hour',    group: 'Outdoor',  ev: 0.9 },
  { id: 'blueHour',   idx: 5,  label: 'Blue Hour',      group: 'Outdoor',  ev: 3.0 },
  { id: 'forest',     idx: 8,  label: 'Forest Canopy',  group: 'Outdoor',  ev: 1.2 },
  { id: 'snowField',  idx: 10, label: 'Snow Field',     group: 'Outdoor',  ev: 0.35 },
  { id: 'desert',     idx: 11, label: 'Desert',         group: 'Outdoor',  ev: 0.45 },
  { id: 'warehouse',  idx: 7,  label: 'Warehouse',      group: 'Interior', ev: 2.0 },
  { id: 'nightCity',  idx: 6,  label: 'Night City',     group: 'Night',    ev: 4.0 },
  { id: 'neon',       idx: 9,  label: 'Neon',           group: 'Stylized', ev: 3.0 },
];

/** CC0 HDRIs from Poly Haven, fetched at 1k on demand (CORS: access-control-allow-origin *). */
export const PH_PRESETS = [
  ['studio_small_09', 'Studio Small 09'],
  ['brown_photostudio_02', 'Brown Photostudio'],
  ['kloofendal_48d_partly_cloudy_puresky', 'Kloofendal Sky'],
  ['venice_sunset', 'Venice Sunset'],
  ['empty_warehouse_01', 'Empty Warehouse'],
  ['forest_slope', 'Forest Slope'],
  ['potsdamer_platz', 'Potsdamer Platz'],
  ['qwantani_dusk_2', 'Qwantani Dusk'],
  ['snowy_park_01', 'Snowy Park'],
  ['moonless_golf', 'Moonless Golf'],
].map(([slug, label]) => ({
  id: 'ph:' + slug, slug, label, group: 'Poly Haven CC0',
  url: `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/${slug}_1k.hdr`,
  thumb: `https://cdn.polyhaven.com/asset_img/thumbs/${slug}.png?width=256&height=128`,
  page: `https://polyhaven.com/a/${slug}`,
}));

/**
 * Every selectable environment as one live array (the panels module reads
 * it): procedural presets, then Poly Haven, then files loaded this session.
 * Entries: {id, label, group, description, thumb?}. thumb is set for Poly
 * Haven (CDN image) and for loaded files; procedural thumbs come from
 * presetThumbnail(id).
 */
export const ENV_PRESETS = [
  ...PRESETS.map(p => ({ id: p.id, label: p.label, group: p.group, description: `${p.label} (procedural, ${p.group})` })),
  ...PH_PRESETS.map(p => ({ id: p.id, label: p.label, group: p.group, thumb: p.thumb, description: `${p.label} (CC0, polyhaven.com, fetched at 1k on click)` })),
];

/** Default values for the state.env fields that this module adds. */
export const ENV_DEFAULTS = { exposure: 0, tint: '#ffffff', saturation: 1, bgIntensity: 1 };

// ------------------------------------------------------------ module state
let D = null;                 // GPUDevice
const R = {};                 // GPU resources
const P = {};                 // pipelines
const W = {};                 // WGSL sources
let ready = false;
let version = 0;
let current = { id: '', label: '', kind: '', w: 0, h: 0, ms: 0, avg: 0 };
let pending = null;           // {id, promise}
let thumbCache = null;
const sourceThumbs = new Map();   // id -> dataURL of loaded (non-procedural) sources
const floatCache = new Map();     // id -> {data:Float32Array, w, h, label, kind}
const FLOAT_CACHE_MAX = 4;
const listeners = { panel: null, probe: null };

// ------------------------------------------------------------ helpers
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const srgbToLin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** '#rrggbb' -> linear [r,g,b]. */
export function hexToLinear(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1], 16);
  return [srgbToLin(((n >> 16) & 255) / 255), srgbToLin(((n >> 8) & 255) / 255), srgbToLin((n & 255) / 255)];
}

const HALF_EXP = new Float32Array(32);
for (let e = 0; e < 32; e++) HALF_EXP[e] = Math.pow(2, e - 15);
/** IEEE half bits -> number. */
export function halfToFloat(h) {
  const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
  if (e === 0) return s * f * Math.pow(2, -24);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * HALF_EXP[e] * (1 + f / 1024);
}

/** Directions use the map convention of env-common.wgsl: u=0.5 is -Z, v=0 is up. */
export function uvToDir(u, v) {
  const lon = (u - 0.5) * 2 * Math.PI, lat = (0.5 - v) * Math.PI, c = Math.cos(lat);
  return [c * Math.sin(lon), Math.sin(lat), -c * Math.cos(lon)];
}

/** Map direction -> world direction for a rotation in degrees (inverse of envLocal). */
function mapToWorld(d, deg) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  // envLocal: l = (c x - s z, y, s x + c z). Inverse: x = c lx + s lz, z = -s lx + c lz.
  return [c * d[0] + s * d[2], d[1], -s * d[0] + c * d[2]];
}

/**
 * Read a region of an rgba16float or rg16float texture mip as numbers.
 * @returns {Promise<{data:Float32Array, w:number, h:number, ch:number}>} ch = channels per texel
 */
async function readHalfTexture(tex, mip, x, y, w, h, ch = 4) {
  const bpt = ch * 2;
  const bpr = Math.ceil((w * bpt) / 256) * 256;
  const buf = D.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ, label: 'env-readback' });
  const enc = D.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex, mipLevel: mip, origin: { x, y } }, { buffer: buf, bytesPerRow: bpr }, { width: w, height: h });
  D.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const u16 = new Uint16Array(buf.getMappedRange());
  const out = new Float32Array(w * h * ch);
  for (let j = 0; j < h; j++) {
    const row = (j * bpr) / 2;
    for (let i = 0; i < w * ch; i++) out[j * w * ch + i] = halfToFloat(u16[row + i]);
  }
  buf.unmap(); buf.destroy();
  return { data: out, w, h, ch };
}

async function readSH() {
  const buf = D.createBuffer({ size: 144, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ, label: 'env-sh-read' });
  const enc = D.createCommandEncoder();
  enc.copyBufferToBuffer(R.shBuf, 0, buf, 0, 144);
  D.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const f = new Float32Array(buf.getMappedRange().slice(0));
  buf.unmap(); buf.destroy();
  const sh = [];
  for (let k = 0; k < 9; k++) sh.push([f[k * 4], f[k * 4 + 1], f[k * 4 + 2]]);
  return sh;
}

// ------------------------------------------------------------ hdr parser
const RGBE_SCALE = new Float32Array(256);
for (let e = 1; e < 256; e++) RGBE_SCALE[e] = Math.pow(2, e - 136);

/**
 * Parse a Radiance .hdr (RGBE) file. Handles new-style RLE scanlines and
 * flat scanlines, the -Y/+Y and +X/-X orientations, and EXPOSURE headers.
 * Old-style (1,1,1,n) RLE and rotated (X-major) files are rejected.
 * @param {ArrayBuffer|Uint8Array} buf
 * @returns {{width:number, height:number, data:Float32Array}} rgba, top row first
 */
export function parseHDR(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let pos = 0;
  const line = () => {
    let s = '';
    while (pos < u8.length) { const c = u8[pos++]; if (c === 10) break; s += String.fromCharCode(c); }
    return s;
  };
  const magic = line();
  if (!/^#\?(RADIANCE|RGBE)/.test(magic)) throw new Error('not a Radiance .hdr file');
  let format = '', exposure = 1;
  for (;;) {
    if (pos >= u8.length) throw new Error('.hdr header has no end');
    const l = line().trim();
    if (l === '') break;
    if (l.startsWith('FORMAT=')) format = l.slice(7).trim();
    else if (l.startsWith('EXPOSURE=')) exposure *= parseFloat(l.slice(9)) || 1;
  }
  if (format && format !== '32-bit_rle_rgbe') throw new Error('unsupported .hdr format: ' + format);
  const res = line().trim().split(/\s+/);
  if (res.length !== 4 || res[0][1] !== 'Y' || res[2][1] !== 'X') throw new Error('unsupported .hdr orientation: ' + res.join(' '));
  const H = parseInt(res[1], 10), Wd = parseInt(res[3], 10);
  if (!(H > 0 && Wd > 0) || H * Wd > 64e6) throw new Error(`bad .hdr size ${Wd}x${H}`);
  const flipY = res[0] === '+Y', flipX = res[2] === '-X';
  const data = new Float32Array(Wd * H * 4);
  const scan = new Uint8Array(Wd * 4);
  const inv = 1 / exposure;
  for (let y = 0; y < H; y++) {
    if (pos + 4 > u8.length) throw new Error('truncated .hdr at row ' + y);
    if (Wd >= 8 && Wd < 32768 && u8[pos] === 2 && u8[pos + 1] === 2 && !(u8[pos + 2] & 0x80)) {
      const w = (u8[pos + 2] << 8) | u8[pos + 3];
      if (w !== Wd) throw new Error('.hdr scanline width mismatch');
      pos += 4;
      for (let ch = 0; ch < 4; ch++) {
        let x = 0;
        while (x < Wd) {
          if (pos >= u8.length) throw new Error('truncated .hdr scanline');
          let n = u8[pos++];
          if (n > 128) {
            n -= 128;
            if (x + n > Wd) throw new Error('bad .hdr run');
            const v = u8[pos++];
            for (let k = 0; k < n; k++) scan[(x++) * 4 + ch] = v;
          } else {
            if (n === 0 || x + n > Wd) throw new Error('bad .hdr dump');
            for (let k = 0; k < n; k++) scan[(x++) * 4 + ch] = u8[pos++];
          }
        }
      }
    } else {
      if (u8[pos] === 1 && u8[pos + 1] === 1 && u8[pos + 2] === 1) throw new Error('old-style RLE .hdr is not supported');
      if (pos + Wd * 4 > u8.length) throw new Error('truncated flat .hdr');
      scan.set(u8.subarray(pos, pos + Wd * 4)); pos += Wd * 4;
    }
    const row = flipY ? H - 1 - y : y;
    for (let x = 0; x < Wd; x++) {
      const e = scan[x * 4 + 3];
      const o = (row * Wd + (flipX ? Wd - 1 - x : x)) * 4;
      if (e === 0) { data[o] = data[o + 1] = data[o + 2] = 0; }
      else {
        const f = RGBE_SCALE[e] * inv;
        data[o] = (scan[x * 4] + 0.5) * f;
        data[o + 1] = (scan[x * 4 + 1] + 0.5) * f;
        data[o + 2] = (scan[x * 4 + 2] + 0.5) * f;
      }
      data[o + 3] = 1;
    }
  }
  return { width: Wd, height: H, data };
}

// ------------------------------------------------------------ gpu setup
async function loadWGSL() {
  const base = new URL('./shaders/', import.meta.url);
  const names = ['env-common', 'env-presets', 'env-filter', 'env-lib', 'env-probe'];
  const texts = await Promise.all(names.map(n => fetch(new URL(n + '.wgsl', base)).then(r => {
    if (!r.ok) throw new Error(`fetch ${n}.wgsl: ${r.status}`);
    return r.text();
  })));
  names.forEach((n, i) => { W[n] = texts[i]; });
}

function createResources() {
  const T = GPUTextureUsage;
  R.envTex = D.createTexture({ label: 'env-src', size: [ENV_W, ENV_H], format: 'rgba16float', mipLevelCount: ENV_MIPS,
    usage: T.TEXTURE_BINDING | T.RENDER_ATTACHMENT | T.COPY_SRC });
  R.specTex = D.createTexture({ label: 'env-spec', size: [SPEC_W, SPEC_H], format: 'rgba16float', mipLevelCount: SPEC_MIPS,
    usage: T.TEXTURE_BINDING | T.RENDER_ATTACHMENT | T.COPY_SRC });
  R.lutTex = D.createTexture({ label: 'env-brdf-lut', size: [LUT_SIZE, LUT_SIZE], format: 'rg16float',
    usage: T.TEXTURE_BINDING | T.RENDER_ATTACHMENT | T.COPY_SRC });
  R.toneTex = D.createTexture({ label: 'env-tone', size: [THUMB_W, THUMB_H], format: 'rgba8unorm',
    usage: T.RENDER_ATTACHMENT | T.COPY_SRC });
  R.envView = R.envTex.createView();
  R.envMipViews = Array.from({ length: ENV_MIPS }, (_, i) => R.envTex.createView({ baseMipLevel: i, mipLevelCount: 1 }));
  R.specView = R.specTex.createView();
  R.specMipViews = Array.from({ length: SPEC_MIPS }, (_, i) => R.specTex.createView({ baseMipLevel: i, mipLevelCount: 1 }));
  R.lutView = R.lutTex.createView();
  R.shBuf = D.createBuffer({ label: 'env-sh9', size: 144, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  R.uBuf = D.createBuffer({ label: 'env-uniform', size: ENV_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  R.passBuf = D.createBuffer({ label: 'env-pass-uniforms', size: SLOT * 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  R.sampler = D.createSampler({ label: 'env-sampler', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
    addressModeU: 'repeat', addressModeV: 'clamp-to-edge' });
  // A neutral grey sky until the first source is ready, so a bind group never sees garbage.
  const sh0 = new Float32Array(36); sh0[0] = sh0[1] = sh0[2] = 0.5 / 0.282095;
  D.queue.writeBuffer(R.shBuf, 0, sh0);
}

function createPipelines() {
  const common = W['env-common'];
  const mod = (label, code) => D.createShaderModule({ label, code });
  const presetMod = mod('env-presets', common + '\n' + W['env-presets']);
  const filterMod = mod('env-filter', common + '\n' + W['env-filter']);
  const frag = (label, module, entry, format) => D.createRenderPipeline({
    label, layout: 'auto',
    vertex: { module, entryPoint: 'vs_full' },
    fragment: { module, entryPoint: entry, targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  P.preset = frag('env-preset', presetMod, 'fs_preset', 'rgba16float');
  P.presetThumb = frag('env-preset-thumb', presetMod, 'fs_preset', 'rgba8unorm');
  P.resample = frag('env-resample', filterMod, 'fs_resample', 'rgba16float');
  P.down = frag('env-down', filterMod, 'fs_down', 'rgba16float');
  P.prefilter = frag('env-prefilter', filterMod, 'fs_prefilter', 'rgba16float');
  P.brdf = frag('env-brdf', filterMod, 'fs_brdf', 'rg16float');
  P.tone = frag('env-tone', filterMod, 'fs_tone', 'rgba8unorm');
  P.sh = D.createComputePipeline({ label: 'env-sh', layout: 'auto', compute: { module: filterMod, entryPoint: 'cs_sh' } });
}

function fullscreen(enc, view, pipeline, bindGroup, label) {
  const pass = enc.beginRenderPass({ label, colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3);
  pass.end();
}

function bakeLUT() {
  const enc = D.createCommandEncoder({ label: 'env-lut' });
  const bg = D.createBindGroup({ layout: P.brdf.getBindGroupLayout(0), entries: [] });
  fullscreen(enc, R.lutView, P.brdf, bg, 'env-brdf-lut');
  D.queue.submit([enc.finish()]);
}

// ------------------------------------------------------------ sources
/** Uniform slot `i` of R.passBuf as a binding resource. */
const slot = (i, size = 32) => ({ buffer: R.passBuf, offset: i * SLOT, size });

function writePU(i, preset, mode, exposure, w, h) {
  const b = new ArrayBuffer(32), dv = new DataView(b);
  dv.setFloat32(0, w, true); dv.setFloat32(4, h, true);
  dv.setUint32(8, preset, true); dv.setUint32(12, mode, true);
  dv.setFloat32(16, exposure, true);
  D.queue.writeBuffer(R.passBuf, i * SLOT, b);
}

function encodePreset(enc, idx) {
  writePU(0, idx, 0, 1, ENV_W, ENV_H);
  const bg = D.createBindGroup({ layout: P.preset.getBindGroupLayout(0), entries: [{ binding: 0, resource: slot(0) }] });
  fullscreen(enc, R.envMipViews[0], P.preset, bg, 'env-preset');
}

/** Encode a resample of an uploaded texture into envTex mip 0. */
function encodeResample(enc, upTex, srgb, gain) {
  const b = new ArrayBuffer(32), dv = new DataView(b);
  dv.setFloat32(0, ENV_W, true); dv.setFloat32(4, ENV_H, true);
  dv.setUint32(8, srgb ? 1 : 0, true);
  dv.setFloat32(16, gain, true); dv.setFloat32(20, MAX_HALF, true);
  D.queue.writeBuffer(R.passBuf, 1 * SLOT, b);
  const bg = D.createBindGroup({ layout: P.resample.getBindGroupLayout(0), entries: [
    { binding: 0, resource: slot(1) }, { binding: 1, resource: upTex.createView() }] });
  fullscreen(enc, R.envMipViews[0], P.resample, bg, 'env-resample');
}

function uploadFloatTexture(data, w, h) {
  const tex = D.createTexture({ label: 'env-upload-f32', size: [w, h], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  // Clean the data: NaN or Inf in a file must not reach the half-float chain.
  for (let i = 0; i < data.length; i++) { const v = data[i]; if (!(v >= 0)) data[i] = 0; else if (v > MAX_HALF) data[i] = MAX_HALF; }
  D.queue.writeTexture({ texture: tex }, data, { bytesPerRow: w * 16, rowsPerImage: h }, { width: w, height: h });
  return tex;
}

// ------------------------------------------------------------ process
/** Encode mips, prefilter and SH for whatever is in envTex mip 0. */
function encodeIBL(enc) {
  for (let l = 1; l < ENV_MIPS; l++) {
    const bg = D.createBindGroup({ layout: P.down.getBindGroupLayout(0), entries: [{ binding: 2, resource: R.envMipViews[l - 1] }] });
    fullscreen(enc, R.envMipViews[l], P.down, bg, 'env-mip-' + l);
  }
  const texelSA = (4 * Math.PI) / (ENV_W * ENV_H);
  for (let i = 0; i < SPEC_MIPS; i++) {
    const w = SPEC_W >> i, h = SPEC_H >> i;
    const b = new ArrayBuffer(32), dv = new DataView(b);
    dv.setFloat32(0, w, true); dv.setFloat32(4, h, true);
    dv.setFloat32(8, i / (SPEC_MIPS - 1), true);
    dv.setFloat32(12, texelSA, true);
    dv.setFloat32(16, ENV_MIPS, true);
    dv.setUint32(20, PREFILTER_SAMPLES[i] || 256, true);
    dv.setFloat32(24, Math.log2(ENV_W / SPEC_W), true);
    D.queue.writeBuffer(R.passBuf, (4 + i) * SLOT, b);
    const bg = D.createBindGroup({ layout: P.prefilter.getBindGroupLayout(0), entries: [
      { binding: 3, resource: slot(4 + i) }, { binding: 4, resource: R.envView }, { binding: 5, resource: R.sampler }] });
    fullscreen(enc, R.specMipViews[i], P.prefilter, bg, 'env-prefilter-' + i);
  }
  const cp = enc.beginComputePass({ label: 'env-sh9' });
  cp.setPipeline(P.sh);
  cp.setBindGroup(0, D.createBindGroup({ layout: P.sh.getBindGroupLayout(0), entries: [
    { binding: 6, resource: R.envMipViews[SH_MIP] }, { binding: 7, resource: { buffer: R.shBuf } }] }));
  cp.dispatchWorkgroups(1);
  cp.end();
}

/**
 * Run one source through the chain and publish it.
 * @param {(enc:GPUCommandEncoder)=>void} encodeSource writes envTex mip 0
 * @param {{id:string,label:string,kind:string,w:number,h:number}} info
 */
let chain = Promise.resolve();
function processSource(encodeSource, info) {
  // One source at a time: the chain shares envTex, specTex and shBuf.
  const job = chain.then(() => runSource(encodeSource, info));
  chain = job.catch(() => {});
  return job;
}

async function runSource(encodeSource, info) {
  const t0 = performance.now();
  D.pushErrorScope('validation');
  const enc = D.createCommandEncoder({ label: 'env-process' });
  encodeSource(enc);
  encodeIBL(enc);
  D.queue.submit([enc.finish()]);
  const err = await D.popErrorScope();
  if (err) throw new Error('env GPU validation: ' + err.message);
  await D.queue.onSubmittedWorkDone();
  const sh = await readSH();
  const avg = (0.2126 * sh[0][0] + 0.7152 * sh[0][1] + 0.0722 * sh[0][2]) / 3.5449077;
  current = { ...info, ms: performance.now() - t0, avg, sh };
  version++;
  ready = true;
  writeUniform();
  if (info.kind !== 'procedural') {
    try {
      const url = await sourceThumb();
      sourceThumbs.set(info.id, url);
      const entry = ENV_PRESETS.find(p => p.id === info.id);
      if (entry && info.id.startsWith('custom:')) entry.thumb = url;
    } catch (e) { /* thumbnail is optional */ }
  }
  emit('env:changed', state.env);
  return current;
}

async function loadProcedural(p) {
  return processSource(enc => encodePreset(enc, p.idx), { id: p.id, label: p.label, kind: 'procedural', w: ENV_W, h: ENV_H });
}

async function loadFloatSource(id, entry) {
  const tex = uploadFloatTexture(entry.data, entry.w, entry.h);
  try {
    return await processSource(enc => encodeResample(enc, tex, false, 1), { id, label: entry.label, kind: entry.kind, w: entry.w, h: entry.h });
  } finally { tex.destroy(); }
}

function cachePut(id, entry) {
  if (id.startsWith('custom:') && !ENV_PRESETS.some(p => p.id === id)) {
    ENV_PRESETS.push({ id, label: entry.label, group: 'Loaded', description: `${entry.label} (${entry.kind}, ${entry.w}x${entry.h})` });
  }
  floatCache.delete(id);
  floatCache.set(id, entry);
  while (floatCache.size > FLOAT_CACHE_MAX) floatCache.delete(floatCache.keys().next().value);
}

async function fetchPolyHaven(p, onProgress) {
  const res = await fetch(p.url, { mode: 'cors' });
  if (!res.ok) throw new Error(`Poly Haven fetch failed: HTTP ${res.status}`);
  const total = +res.headers.get('content-length') || 0;
  let buf;
  if (res.body && onProgress) {
    const reader = res.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); got += value.length;
      if (total) onProgress(Math.min(1, got / total));
    }
    buf = new Uint8Array(got);
    let o = 0;
    for (const p of parts) { buf.set(p, o); o += p.length; }
  } else buf = new Uint8Array(await res.arrayBuffer());
  const hdr = parseHDR(buf);
  return { data: hdr.data, w: hdr.width, h: hdr.height, label: p.label, kind: 'Poly Haven CC0' };
}

/** Resolve a preset id to a loaded source. Same id twice shares the promise. */
function ensureSource(id) {
  if (!D) return Promise.resolve(null);
  if (pending && pending.id === id) return pending.promise;
  if (ready && current.id === id && !pending) return Promise.resolve(current);
  const run = async () => {
    const proc = PRESETS.find(p => p.id === id);
    if (proc) return loadProcedural(proc);
    if (floatCache.has(id)) return loadFloatSource(id, floatCache.get(id));
    const ph = PH_PRESETS.find(p => p.id === id);
    if (ph) {
      setBusy(id, 0);
      const entry = await fetchPolyHaven(ph, f => setBusy(id, f));
      cachePut(id, entry);
      return loadFloatSource(id, entry);
    }
    throw new Error('unknown environment ' + id);
  };
  const promise = run().catch(e => {
    console.error('[env]', e);
    toast('Environment: ' + e.message, 'error');
    // Fall back to the last good source, so state.env.preset never lies.
    if (state.env.preset === id) {
      state.env.preset = ready ? current.id : 'studio';
      if (!ready) return ensureSource('studio');
      emit('env:changed', state.env);
    }
    return null;
  }).finally(() => {
    if (pending && pending.id === id) pending = null;
    setBusy(null);
    // A newer request may have come in while this one ran.
    if (state.env.preset !== current.id && !pending) ensureSource(state.env.preset);
  });
  pending = { id, promise };
  return promise;
}

// ------------------------------------------------------------ uniform
/**
 * Write state.env into uBuf. Layout (EnvU in env-lib.wgsl, floats):
 *   0  rot   cos(rot), sin(rot), spec max lod, intensity * 2^exposure
 *   4  tint  linear rgb, saturation
 *   8  bg    linear background rgb, mode (0 hdri, 1 blur, 2 color)
 *  12  misc  blur, light count, background intensity, src max lod
 *  16  lights[4] { posType vec4 (xyz, w: 0 dir | 1 + range point), color vec4 (rgb * intensity, on) }
 * Light fields read: type 'dir'|'point', color hex, intensity, on (false = off),
 * dir (unit vector toward the light), pos (point position; else dir * dist),
 * dist (default 3), range (point cutoff; 0 = pure inverse square).
 */
export function writeUniform() {
  if (!D) return;
  const e = state.env, f = new Float32Array(ENV_UNIFORM_SIZE / 4);
  const rot = (+e.rotation || 0) * Math.PI / 180;
  f[0] = Math.cos(rot); f[1] = Math.sin(rot); f[2] = SPEC_MIPS - 1;
  f[3] = Math.max(0, +e.intensity || 0) * Math.pow(2, +e.exposure || 0);
  const t = hexToLinear(e.tint || '#ffffff');
  f[4] = t[0]; f[5] = t[1]; f[6] = t[2]; f[7] = e.saturation ?? 1;
  const b = hexToLinear(e.bgColor || '#1a1f2a');
  f[8] = b[0]; f[9] = b[1]; f[10] = b[2];
  f[11] = e.background === 'color' ? 2 : e.background === 'blur' ? 1 : 0;
  const lights = (e.lights || []).slice(0, MAX_LIGHTS);
  f[12] = clamp(+e.blur || 0, 0, 1); f[13] = lights.length; f[14] = e.bgIntensity ?? 1; f[15] = ENV_MIPS - 1;
  lights.forEach((l, i) => {
    const o = 16 + i * 8;
    const dir = normDir(l.dir);
    if (l.type === 'point') {
      const pos = l.pos || dir.map(v => v * (l.dist || 3));
      f[o] = pos[0]; f[o + 1] = pos[1]; f[o + 2] = pos[2]; f[o + 3] = 1 + Math.max(0, +l.range || 0);
    } else { f[o] = dir[0]; f[o + 1] = dir[1]; f[o + 2] = dir[2]; f[o + 3] = 0; }
    const c = hexToLinear(l.color || '#ffffff'), k = Math.max(0, +l.intensity || 0);
    f[o + 4] = c[0] * k; f[o + 5] = c[1] * k; f[o + 6] = c[2] * k; f[o + 7] = l.on === false ? 0 : 1;
  });
  D.queue.writeBuffer(R.uBuf, 0, f);
}

function normDir(d) {
  const v = Array.isArray(d) && d.length >= 3 ? d.map(Number) : [0.4, 0.7, 0.6];
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

// ------------------------------------------------------------ public api
/** Select a preset (procedural id, 'ph:<slug>' or a loaded custom id) and wait for it. */
export async function setPreset(id) {
  if (state.env.preset !== id) setEnv({ preset: id });
  return ensureSource(id);
}

/**
 * Load an environment file: .hdr (Radiance), or an 8-bit image (png, jpg,
 * webp, avif) as a low dynamic range sky. .exr is not supported (see header).
 * @param {File|Blob} file @param {{gain?:number}} [opts] gain scales an 8-bit image
 */
export async function loadFile(file, opts = {}) {
  const name = file.name || 'environment';
  if (/\.exr$/i.test(name)) { toast('OpenEXR is not supported. Convert the file to .hdr (Radiance).', 'warn', 6000); return null; }
  if (/\.hdr$/i.test(name) || file.type === 'image/vnd.radiance') return loadHDR(file);
  return loadImage(file, opts.gain ?? 1);
}

/** Load a user .hdr (Radiance RGBE) file. @param {File|Blob} file */
export async function loadHDR(file) {
  if (!D) return null;
  const name = file.name || 'upload.hdr';
  const hdr = parseHDR(new Uint8Array(await file.arrayBuffer()));
  if (Math.abs(hdr.width / hdr.height - 2) > 0.05) toast(`${name} is ${hdr.width}x${hdr.height}, not 2:1. It is stretched as an equirect.`, 'warn');
  if (hdr.width > (gpu.limits.maxTextureDimension2D || 8192)) throw new Error(`${name} is wider than the GPU texture limit`);
  const id = 'custom:' + name;
  cachePut(id, { data: hdr.data, w: hdr.width, h: hdr.height, label: name.replace(/\.hdr$/i, ''), kind: '.hdr upload' });
  return setPreset(id);
}

/**
 * Load an 8-bit image as an LDR environment. The image is decoded on a 2D
 * canvas, made linear, and then follows the float path, so it is cached and
 * can be selected again from the "Loaded" group.
 * @param {File|Blob} file @param {number} gain
 */
export async function loadImage(file, gain = 1) {
  if (!D) return null;
  const name = file.name || 'image';
  const bmp = await createImageBitmap(file);
  const w = bmp.width, hgt = bmp.height;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = hgt;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  bmp.close?.();
  const px = g.getImageData(0, 0, w, hgt).data;
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = srgbToLin(i / 255) * gain;
  const data = new Float32Array(w * hgt * 4);
  for (let i = 0; i < w * hgt; i++) {
    data[i * 4] = lut[px[i * 4]]; data[i * 4 + 1] = lut[px[i * 4 + 1]]; data[i * 4 + 2] = lut[px[i * 4 + 2]]; data[i * 4 + 3] = 1;
  }
  toast(`${name}: an 8-bit image has no HDR range, so highlights stay weak. Use .hdr for real light.`, 'warn', 5000);
  const id = 'custom:' + name;
  cachePut(id, { data, w, h: hgt, label: name.replace(/\.[a-z0-9]+$/i, ''), kind: '8-bit image' });
  return setPreset(id);
}

/**
 * GPU resources for the viewport IBL. null before the first source. The
 * objects stay the same for the page life; their contents change.
 */
export function getEnvBindings() {
  if (!ready) return null;
  return {
    specTex: R.specTex, specView: R.specView,
    srcTex: R.envTex, srcView: R.envView,
    irradianceSH: R.shBuf,
    brdfLut: R.lutTex, brdfView: R.lutView,
    sampler: R.sampler,
    uniform: R.uBuf,
    mipCount: SPEC_MIPS, srcMipCount: ENV_MIPS,
    rotation: (+state.env.rotation || 0) * Math.PI / 180,
    intensity: (+state.env.intensity || 0) * Math.pow(2, +state.env.exposure || 0),
    version,
    source: { id: current.id, label: current.label, kind: current.kind, w: current.w, h: current.h, ms: current.ms, avg: current.avg },
  };
}

/**
 * The consumer WGSL: the six env bindings plus the helper functions of
 * shaders/env-lib.wgsl. Bindings use `binding` .. `binding+5` in `group`.
 * @param {{group?:number, binding?:number}} [o]
 */
export function envWGSL({ group = 0, binding = 0 } = {}) {
  if (!W['env-lib']) throw new Error('env.js is not initialized');
  let s = W['env-lib'].replace(/\$G/g, String(group));
  for (let i = 0; i < 6; i++) s = s.replace(new RegExp('\\$B' + i, 'g'), String(binding + i));
  return s;
}

/** GPUBindGroupLayoutEntry[] for envWGSL. @param {number} [base] @param {number} [visibility] */
export function envBindGroupLayoutEntries(base = 0, visibility = GPUShaderStage.FRAGMENT) {
  return [
    { binding: base, visibility, texture: { sampleType: 'float' } },
    { binding: base + 1, visibility, texture: { sampleType: 'float' } },
    { binding: base + 2, visibility, texture: { sampleType: 'float' } },
    { binding: base + 3, visibility, sampler: { type: 'filtering' } },
    { binding: base + 4, visibility, buffer: { type: 'uniform' } },
    { binding: base + 5, visibility, buffer: { type: 'uniform' } },
  ];
}

/** GPUBindGroupEntry[] for envWGSL. Valid before the first source (grey SH, empty maps). */
export function envBindGroupEntries(base = 0) {
  return [
    { binding: base, resource: R.specView },
    { binding: base + 1, resource: R.envView },
    { binding: base + 2, resource: R.lutView },
    { binding: base + 3, resource: R.sampler },
    { binding: base + 4, resource: { buffer: R.shBuf } },
    { binding: base + 5, resource: { buffer: R.uBuf } },
  ];
}

/** Info about the live source. */
export function getSource() { return { ...current, ready, version }; }

/** Every selectable environment: procedural, Poly Haven, and loaded custom files. */
export function listPresets() {
  const custom = [...floatCache.entries()].filter(([id]) => id.startsWith('custom:'))
    .map(([id, e]) => ({ id, label: e.label, group: 'Loaded' }));
  if (current.id.startsWith('custom:') && !custom.some(c => c.id === current.id)) custom.push({ id: current.id, label: current.label, group: 'Loaded' });
  return [...PRESETS.map(p => ({ id: p.id, label: p.label, group: p.group })), ...PH_PRESETS.map(p => ({ id: p.id, label: p.label, group: p.group })), ...custom];
}

// ------------------------------------------------------------ thumbs
async function readRGBA8(tex, w, h) {
  const bpr = Math.ceil((w * 4) / 256) * 256;
  const buf = D.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = D.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, { width: w, height: h });
  D.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(buf.getMappedRange());
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) px.set(src.subarray(y * bpr, y * bpr + w * 4), y * w * 4);
  buf.unmap(); buf.destroy();
  return px;
}

function pixelsToURL(px, w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0);
  return cv.toDataURL('image/png');
}

/** Tone-mapped thumbnail of the live source (envTex mip 3), auto exposure. */
async function sourceThumb() {
  const b = new Float32Array(4);
  b[0] = 0.5 / Math.max(current.avg || 0.1, 1e-4);
  D.queue.writeBuffer(R.passBuf, 20 * SLOT, b);
  const enc = D.createCommandEncoder();
  const bg = D.createBindGroup({ layout: P.tone.getBindGroupLayout(0), entries: [
    { binding: 8, resource: R.envMipViews[TONE_MIP] }, { binding: 9, resource: slot(20, 16) }] });
  fullscreen(enc, R.toneTex.createView(), P.tone, bg, 'env-tone');
  D.queue.submit([enc.finish()]);
  return pixelsToURL(await readRGBA8(R.toneTex, THUMB_W, THUMB_H), THUMB_W, THUMB_H);
}

/**
 * Tiny tone-mapped previews (256x128 PNG data URLs).
 * @returns {Promise<Array<{id,label,group,url,remote?:boolean}>>}
 *   Procedural presets are rendered on the GPU. Poly Haven entries carry their
 *   CDN thumbnail URL (remote: true) until they are loaded. Loaded files use
 *   a thumbnail of their own data.
 */
export async function thumbs() {
  if (!D) return [];
  if (!thumbCache) {
    const tex = D.createTexture({ label: 'env-thumb', size: [THUMB_W, THUMB_H], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const out = [];
    for (let i = 0; i < PRESETS.length; i++) {
      const p = PRESETS[i];
      writePU(8 + i, p.idx, 1, p.ev, THUMB_W, THUMB_H);
      const enc = D.createCommandEncoder();
      const bg = D.createBindGroup({ layout: P.presetThumb.getBindGroupLayout(0), entries: [{ binding: 0, resource: slot(8 + i) }] });
      fullscreen(enc, tex.createView(), P.presetThumb, bg, 'env-thumb-' + p.id);
      D.queue.submit([enc.finish()]);
      out.push({ id: p.id, label: p.label, group: p.group, url: pixelsToURL(await readRGBA8(tex, THUMB_W, THUMB_H), THUMB_W, THUMB_H) });
    }
    tex.destroy();
    thumbCache = out;
  }
  const ph = PH_PRESETS.map(p => sourceThumbs.has(p.id)
    ? { id: p.id, label: p.label, group: p.group, url: sourceThumbs.get(p.id) }
    : { id: p.id, label: p.label, group: p.group, url: p.thumb, remote: true });
  const custom = listPresets().filter(p => p.group === 'Loaded').map(p => ({ ...p, url: sourceThumbs.get(p.id) || '' }));
  return [...thumbCache, ...ph, ...custom];
}

/**
 * One preview for one environment id: a PNG data URL (procedural, loaded) or
 * the Poly Haven CDN URL. Results are cached; null for an unknown id.
 * @param {string} id @returns {Promise<string|null>}
 */
export async function presetThumbnail(id) {
  if (sourceThumbs.has(id)) return sourceThumbs.get(id);
  const ph = PH_PRESETS.find(p => p.id === id);
  if (ph) return ph.thumb;
  if (!PRESETS.some(p => p.id === id) || !D) return null;
  const list = await thumbs();
  return (list.find(t => t.id === id) || {}).url || null;
}

// ------------------------------------------------------------ analysis
/**
 * Find the brightest region of the live source (the sun or the key light).
 * Reads envTex mip 5 (64x32). Returns world direction (rotation applied),
 * a linear color, and the irradiance above the median as `intensity`.
 */
export async function findSun() {
  if (!ready) return null;
  const mip = 5, w = ENV_W >> mip, h = ENV_H >> mip;
  const { data } = await readHalfTexture(R.envTex, mip, 0, 0, w, h);
  let best = -1, bi = 0;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const l = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
    lum[i] = l;
    if (l > best) { best = l; bi = i; }
  }
  const sorted = Float32Array.from(lum).sort();
  const median = sorted[sorted.length >> 1];
  const x = bi % w, y = (bi / w) | 0;
  // The peak can fall across texel edges: sum the 3x3 block above the median.
  let E = 0;
  for (let j = Math.max(0, y - 1); j <= Math.min(h - 1, y + 1); j++) {
    const lat = (0.5 - (j + 0.5) / h) * Math.PI;
    const sa = Math.cos(lat) * (2 * Math.PI / w) * (Math.PI / h);
    for (let di = -1; di <= 1; di++) E += Math.max(0, lum[j * w + ((x + di + w) % w)] - median) * sa;
  }
  const mapDir = uvToDir((x + 0.5) / w, (y + 0.5) / h);
  const c = [data[bi * 4], data[bi * 4 + 1], data[bi * 4 + 2]];
  const m = Math.max(c[0], c[1], c[2]) || 1;
  const toHex = v => Math.round(255 * Math.pow(clamp(v / m, 0, 1), 1 / 2.2)).toString(16).padStart(2, '0');
  return {
    dir: mapToWorld(mapDir, +state.env.rotation || 0),
    color: '#' + toHex(c[0]) + toHex(c[1]) + toHex(c[2]),
    intensity: E,
    peak: best, median,
  };
}

/**
 * Read texels for checks. which: 'src' | 'spec' | 'lut'.
 * @returns {Promise<{data:Float32Array,w:number,h:number,ch:number}>}
 */
export async function readEnvTexels(which = 'src', mip = 0, x = 0, y = 0, w = 16, h = 1) {
  if (which === 'lut') return readHalfTexture(R.lutTex, 0, x, y, w, h, 2);
  return readHalfTexture(which === 'spec' ? R.specTex : R.envTex, mip, x, y, w, h, 4);
}

// ------------------------------------------------------------ probe
const probe = { canvas: null, ctx: null, pipeline: null, bg: null, ubuf: null, yaw: 0, raf: 0 };

function createProbe(canvas) {
  probe.canvas = canvas;
  probe.ctx = configureCanvas(canvas);
  if (!probe.ctx) return;
  const module = D.createShaderModule({ label: 'env-probe', code: envWGSL({ group: 0, binding: 0 }) + '\n' + W['env-probe'] });
  const layout = D.createBindGroupLayout({ label: 'env-probe-bgl', entries: [
    ...envBindGroupLayoutEntries(0, GPUShaderStage.FRAGMENT),
    { binding: 6, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
  probe.pipeline = D.createRenderPipeline({
    label: 'env-probe', layout: D.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'probeVS' },
    fragment: { module, entryPoint: 'fs_probe', targets: [{ format: gpu.format }] },
  });
  probe.ubuf = D.createBuffer({ label: 'env-probe-u', size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  probe.bg = D.createBindGroup({ layout, entries: [...envBindGroupEntries(0), { binding: 6, resource: { buffer: probe.ubuf } }] });
  let drag = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, yaw: probe.yaw }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (drag) { probe.yaw = drag.yaw - (e.clientX - drag.x) * 0.01; drawProbe(); } });
  const end = () => { drag = null; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('dblclick', () => { probe.yaw = 0; drawProbe(); });
  new ResizeObserver(() => drawProbe()).observe(canvas);
}

/** Redraw the probe on the next frame (coalesced). */
export function drawProbe() {
  if (!probe.ctx || probe.raf) return;
  probe.raf = requestAnimationFrame(() => {
    probe.raf = 0;
    const c = probe.canvas;
    const w = Math.round(c.clientWidth * Math.min(devicePixelRatio, 2)), h = Math.round(c.clientHeight * Math.min(devicePixelRatio, 2));
    if (w < 2 || h < 2 || !gpu.ok) return;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const u = new Float32Array(8);
    u[0] = w; u[1] = h; u[2] = Math.pow(2, +state.view?.exposure || 0); u[3] = w / h; u[4] = probe.yaw;
    D.queue.writeBuffer(probe.ubuf, 0, u);
    const enc = D.createCommandEncoder({ label: 'env-probe' });
    fullscreen(enc, probe.ctx.getCurrentTexture().createView(), probe.pipeline, probe.bg, 'env-probe');
    D.queue.submit([enc.finish()]);
  });
}

// ------------------------------------------------------------ panel
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

/** A label + range + number row. `get`/`set` work on display units. */
function sliderRow(label, { min, max, step, get, set, fmt, title }) {
  const range = h('input', { type: 'range', min, max, step, 'aria-label': label });
  const num = h('input', { type: 'number', min, max, step, class: 'env-num', 'aria-label': label + ' value' });
  const sync = () => { const v = get(); range.value = v; num.value = fmt ? fmt(v) : v; };
  range.addEventListener('input', () => { set(+range.value); num.value = fmt ? fmt(+range.value) : range.value; });
  num.addEventListener('change', () => { const v = clamp(+num.value, +min, +max); set(v); sync(); });
  range.addEventListener('dblclick', () => { if (range.dataset.def != null) { set(+range.dataset.def); sync(); } });
  sync();
  const row = h('div', { class: 'env-row', title: title || '' }, h('label', {}, label), range, num);
  row.sync = sync;
  row.range = range;
  return row;
}

function colorRow(label, get, set) {
  const inp = h('input', { type: 'color', value: get(), 'aria-label': label });
  inp.addEventListener('input', () => set(inp.value));
  const row = h('div', { class: 'env-row env-row-c' }, h('label', {}, label), inp);
  row.sync = () => { inp.value = get(); };
  return row;
}

function seg(options, get, set, label) {
  const box = h('div', { class: 'env-seg', role: 'radiogroup', 'aria-label': label });
  const sync = () => { for (const b of box.children) b.classList.toggle('on', b.dataset.v === get()); };
  for (const [v, text] of options) box.append(h('button', { type: 'button', 'data-v': v, onclick: () => { set(v); sync(); } }, text));
  sync();
  box.sync = sync;
  return box;
}

let panelEl = null;
const busy = { id: null, frac: 0 };
function setBusy(id, frac = 0) {
  busy.id = id; busy.frac = frac;
  if (!panelEl) return;
  for (const b of panelEl.querySelectorAll('.env-tile')) {
    const on = b.dataset.id === id;
    b.classList.toggle('busy', on);
    if (on) b.style.setProperty('--p', Math.round(frac * 100) + '%');
  }
}

/** Light direction picker: a shaded ball seen from the default camera (+Z toward the viewer). */
function spherePicker(light, onChange) {
  const size = 68;
  const cv = h('canvas', { class: 'env-pick', width: size * 2, height: size * 2, title: 'Drag to aim the light. Double-click to flip to the back hemisphere.' });
  const draw = () => {
    const g = cv.getContext('2d'), n = cv.width, r = n / 2 - 3, cx = n / 2;
    const img = g.createImageData(n, n), L = normDir(light.dir);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const nx = (x - cx) / r, ny = -(y - cx) / r, rr = nx * nx + ny * ny, o = (y * n + x) * 4;
      if (rr > 1) { img.data[o + 3] = 0; continue; }
      const nz = Math.sqrt(1 - rr);
      const d = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      const v = 22 + 200 * Math.pow(d, 0.8) + 30 * Math.pow(d, 40);
      img.data[o] = v * 0.92; img.data[o + 1] = v * 0.96; img.data[o + 2] = v; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const mx = cx + L[0] * r, my = cx - L[1] * r;
    g.lineWidth = 3; g.strokeStyle = L[2] >= 0 ? '#ffc832' : '#ff6a6a';
    g.beginPath(); g.arc(mx, my, 7, 0, Math.PI * 2);
    if (L[2] >= 0) { g.fillStyle = '#ffc832'; g.fill(); } else g.stroke();
    g.strokeStyle = 'rgba(150,200,255,0.3)'; g.lineWidth = 2;
    g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.stroke();
  };
  let down = false;
  const aim = e => {
    const b = cv.getBoundingClientRect();
    let x = ((e.clientX - b.left) / b.width) * 2 - 1, y = -(((e.clientY - b.top) / b.height) * 2 - 1);
    x *= 1.06; y *= 1.06;
    const rr = x * x + y * y;
    if (rr > 1) { const k = 1 / Math.sqrt(rr); x *= k; y *= k; }
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y)) * (light.back ? -1 : 1);
    light.dir = normDir([x, y, z]);
    draw(); onChange();
  };
  cv.addEventListener('pointerdown', e => { down = true; cv.setPointerCapture(e.pointerId); aim(e); });
  cv.addEventListener('pointermove', e => { if (down) aim(e); });
  cv.addEventListener('pointerup', () => { down = false; });
  cv.addEventListener('pointercancel', () => { down = false; });
  cv.addEventListener('dblclick', () => {
    light.back = !light.back;
    const d = normDir(light.dir); d[2] = -d[2]; light.dir = d;
    draw(); onChange();
  });
  draw();
  cv.redraw = draw;
  return cv;
}

function azEl(d) {
  const v = normDir(d);
  const az = Math.atan2(v[0], v[2]) * 180 / Math.PI, el = Math.asin(clamp(v[1], -1, 1)) * 180 / Math.PI;
  return `az ${az.toFixed(0)}° el ${el.toFixed(0)}°`;
}

function lightCard(light, i, rebuild) {
  const commit = () => { setEnv({ lights: state.env.lights }); info.textContent = azEl(light.dir); };
  const info = h('span', { class: 'env-azel' }, azEl(light.dir));
  const type = h('select', { 'aria-label': 'Light type' }, h('option', { value: 'dir' }, 'Directional'), h('option', { value: 'point' }, 'Point'));
  type.value = light.type === 'point' ? 'point' : 'dir';
  type.addEventListener('change', () => {
    light.type = type.value;
    if (light.type === 'point' && !(light.dist > 0)) light.dist = 3;
    delete light.pos;
    light.intensity = light.type === 'point' ? 25 : 3;
    commit(); rebuild();
  });
  const onBox = h('input', { type: 'checkbox', 'aria-label': 'Light on', title: 'On' });
  onBox.checked = light.on !== false;
  onBox.addEventListener('change', () => { light.on = onBox.checked; commit(); });
  const color = h('input', { type: 'color', value: light.color || '#ffffff', 'aria-label': 'Light color' });
  color.addEventListener('input', () => { light.color = color.value; commit(); });
  const del = h('button', { type: 'button', class: 'env-x', title: 'Remove light', 'aria-label': 'Remove light',
    onclick: () => { state.env.lights.splice(i, 1); commit(); rebuild(); } }, '×');
  const pick = spherePicker(light, () => { if (light.type === 'point') delete light.pos; commit(); });
  const rows = [
    sliderRow('Intensity', { min: 0, max: light.type === 'point' ? 400 : 30, step: 0.05,
      get: () => light.intensity ?? 3, set: v => { light.intensity = v; commit(); }, fmt: v => (+v).toFixed(2) }),
  ];
  if (light.type === 'point') rows.push(sliderRow('Distance', { min: 0.3, max: 12, step: 0.05,
    get: () => light.dist ?? 3, set: v => { light.dist = v; delete light.pos; commit(); }, fmt: v => (+v).toFixed(2) }));
  return h('div', { class: 'env-light' + (light.on === false ? ' off' : '') },
    h('div', { class: 'env-light-head' }, onBox, h('b', {}, 'L' + (i + 1)), type, color, del),
    h('div', { class: 'env-light-body' }, pick, h('div', { class: 'env-light-rows' }, ...rows, info)));
}

/**
 * Build the environment panel into `el` (normally #env-panel). The panels
 * module may call this itself; otherwise env.js mounts it at boot:done when
 * #env-panel is still empty.
 * @param {HTMLElement} el
 */
export function mountPanel(el) {
  if (!el) return null;
  if (!document.getElementById('env-css')) {
    document.head.append(h('link', { id: 'env-css', rel: 'stylesheet', href: new URL('./env/panel.css', import.meta.url).href }));
  }
  el.textContent = '';
  panelEl = h('div', { class: 'env-ui' });
  el.append(panelEl);
  const e = state.env;

  // probe + source line
  const probeCv = h('canvas', { class: 'env-probe', title: 'Drag to turn the probe camera. Double-click resets it.' });
  const srcLine = h('div', { class: 'env-src mono' });
  const updateSrc = () => {
    const s = current;
    srcLine.textContent = s.id ? `${s.label} · ${s.kind} · ${s.w}×${s.h} → ${ENV_W}×${ENV_H} · ${s.ms.toFixed(0)} ms · avg ${s.avg.toFixed(2)}` : 'no environment yet';
  };
  updateSrc();
  panelEl.append(h('div', { class: 'env-probe-wrap' }, probeCv, srcLine));
  if (D) createProbe(probeCv);

  // presets
  const grid = h('div', { class: 'env-grid' });
  const fileIn = h('input', { type: 'file', accept: '.hdr,.exr,image/png,image/jpeg,image/webp,image/avif', hidden: true });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files && fileIn.files[0];
    fileIn.value = '';
    if (f) { try { await loadFile(f); } catch (err) { toast('Environment: ' + err.message, 'error'); } }
  });
  const renderGrid = async () => {
    const list = await thumbs();
    grid.textContent = '';
    let group = '';
    for (const t of list) {
      if (t.group !== group) { group = t.group; grid.append(h('div', { class: 'env-group' }, group)); }
      const img = t.url ? h('img', { src: t.url, alt: '', loading: 'lazy', draggable: 'false' }) : h('div', { class: 'env-noimg' });
      grid.append(h('button', { type: 'button', class: 'env-tile' + (t.id === state.env.preset ? ' on' : '') + (t.remote ? ' remote' : ''),
        'data-id': t.id, title: t.remote ? `${t.label} (CC0, polyhaven.com; fetched at 1k on click)` : t.label,
        onclick: () => setPreset(t.id) }, img, h('span', {}, t.label)));
    }
    setBusy(busy.id, busy.frac);
  };
  const markOn = () => { for (const b of grid.querySelectorAll('.env-tile')) b.classList.toggle('on', b.dataset.id === state.env.preset); };
  panelEl.append(h('section', {},
    h('h4', {}, 'Environment'),
    grid,
    h('div', { class: 'env-row env-actions' },
      h('button', { type: 'button', onclick: () => fileIn.click(), title: 'Radiance .hdr, or a png/jpg equirect' }, 'Load .hdr / image…'),
      h('span', { class: 'env-hint' }, 'or drop a file on this panel'), fileIn)));

  // light controls
  const rows = [
    sliderRow('Rotation', { min: -180, max: 180, step: 1, get: () => +e.rotation || 0, set: v => setEnv({ rotation: v }), fmt: v => Math.round(v) }),
    sliderRow('Intensity', { min: 0, max: 8, step: 0.01, get: () => e.intensity ?? 1, set: v => setEnv({ intensity: v }), fmt: v => (+v).toFixed(2) }),
    sliderRow('Exposure', { min: -6, max: 6, step: 0.1, get: () => +e.exposure || 0, set: v => setEnv({ exposure: v }), fmt: v => (+v).toFixed(1), title: 'Environment EV offset (2^EV times the intensity)' }),
    sliderRow('Saturation', { min: 0, max: 2, step: 0.01, get: () => e.saturation ?? 1, set: v => setEnv({ saturation: v }), fmt: v => (+v).toFixed(2) }),
  ];
  rows[0].range.dataset.def = 0; rows[1].range.dataset.def = 1; rows[2].range.dataset.def = 0; rows[3].range.dataset.def = 1;
  const tint = colorRow('Tint', () => e.tint || '#ffffff', v => setEnv({ tint: v }));
  panelEl.append(h('section', {}, h('h4', {}, 'Lighting'), ...rows, tint));

  // background
  const bgSeg = seg([['hdri', 'HDRI'], ['blur', 'Blur'], ['color', 'Color']], () => e.background || 'blur', v => { setEnv({ background: v }); syncBg(); }, 'Background');
  const blurRow = sliderRow('Blur', { min: 0, max: 1, step: 0.01, get: () => +e.blur || 0, set: v => setEnv({ blur: v }), fmt: v => (+v).toFixed(2) });
  const bgInt = sliderRow('Bg level', { min: 0, max: 2, step: 0.01, get: () => e.bgIntensity ?? 1, set: v => setEnv({ bgIntensity: v }), fmt: v => (+v).toFixed(2) });
  const bgCol = colorRow('Color', () => e.bgColor || '#1a1f2a', v => setEnv({ bgColor: v }));
  const syncBg = () => { blurRow.hidden = e.background !== 'blur'; bgCol.hidden = e.background !== 'color'; };
  syncBg();
  panelEl.append(h('section', {}, h('h4', {}, 'Background'), h('div', { class: 'env-row' }, h('label', {}, 'Mode'), bgSeg), blurRow, bgCol, bgInt));

  // analytic lights
  const lightBox = h('div', { class: 'env-lights' });
  const count = h('span', { class: 'env-count mono' });
  const addBtns = h('div', { class: 'env-row env-actions' });
  const add = l => { if (state.env.lights.length >= MAX_LIGHTS) return; state.env.lights.push(l); setEnv({ lights: state.env.lights }); rebuildLights(); };
  addBtns.append(
    h('button', { type: 'button', onclick: () => add({ type: 'dir', color: '#ffffff', intensity: 3, dir: normDir([0.5, 0.6, 0.6]), on: true }) }, '+ Directional'),
    h('button', { type: 'button', onclick: () => add({ type: 'point', color: '#ffe2c0', intensity: 25, dir: normDir([-0.6, 0.4, 0.7]), dist: 3, on: true }) }, '+ Point'),
    h('button', { type: 'button', title: 'Add a directional light at the brightest part of the environment', onclick: async () => {
      const s = await findSun();
      if (!s) return;
      add({ type: 'dir', color: s.color, intensity: +Math.min(30, s.intensity).toFixed(2), dir: s.dir, on: true, back: s.dir[2] < 0 });
      toast('Added a light at the environment peak. The HDRI still has that light too: lower Intensity to avoid double light.', 'info', 5000);
    } }, 'From env'));
  const rebuildLights = () => {
    lightBox.textContent = '';
    (state.env.lights || []).forEach((l, i) => lightBox.append(lightCard(l, i, rebuildLights)));
    count.textContent = `${state.env.lights.length}/${MAX_LIGHTS}`;
    for (const b of addBtns.querySelectorAll('button')) b.disabled = state.env.lights.length >= MAX_LIGHTS;
  };
  rebuildLights();
  panelEl.append(h('section', {}, h('h4', {}, 'Analytic lights ', count), lightBox, addBtns));

  // drag and drop
  el.addEventListener('dragover', ev => { ev.preventDefault(); el.classList.add('env-drop'); });
  el.addEventListener('dragleave', () => el.classList.remove('env-drop'));
  el.addEventListener('drop', async ev => {
    ev.preventDefault(); el.classList.remove('env-drop');
    const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (f) { try { await loadFile(f); } catch (err) { toast('Environment: ' + err.message, 'error'); } }
  });

  // keep the panel in sync with outside changes (presets, undo of a scene, other panels)
  let lastVersion = version, lastLights = state.env.lights.length;
  if (listeners.panel) listeners.panel();
  listeners.panel = on('env:changed', () => {
    for (const r of [...rows, tint, blurRow, bgInt, bgCol]) r.sync();
    bgSeg.sync(); syncBg(); markOn(); updateSrc();
    if (state.env.lights.length !== lastLights) { lastLights = state.env.lights.length; rebuildLights(); }
    if (version !== lastVersion) { lastVersion = version; if (!current.id || current.kind !== 'procedural') renderGrid(); }
  });
  renderGrid().catch(err => console.error('[env] thumbs', err));
  drawProbe();
  return panelEl;
}

// ------------------------------------------------------------ self test
function scan(arr, ch = 4) {
  let bad = 0, neg = 0, max = 0, sum = 0, n = 0;
  for (let i = 0; i < arr.length; i++) {
    if (ch === 4 && i % 4 === 3) continue;
    const v = arr[i];
    if (!Number.isFinite(v)) { bad++; continue; }
    if (v < 0) neg++;
    if (v > max) max = v;
    sum += v; n++;
  }
  return { bad, neg, max, mean: n ? sum / n : 0 };
}

/**
 * Render every procedural preset and read back texels of each stage:
 * envTex mip 0 (4 rows of 256 texels), mip 6, specTex mips 0/3/6, SH9.
 * Checks finite and non-negative values. Also checks the BRDF LUT and that
 * the probe pipeline (which compiles env-lib.wgsl) exists. Restores the
 * preset that was live before.
 */
export async function selfTest({ presets = PRESETS.map(p => p.id) } = {}) {
  if (!D) return { ok: false, reason: 'no GPU' };
  const prev = state.env.preset;
  const out = { ok: true, presets: {}, lut: null, probe: !!probe.pipeline, helperBytes: envWGSL().length };
  for (const id of presets) {
    try {
      await setPreset(id);
      const rowsData = [];
      for (const y of [64, 400, 520, 900]) rowsData.push((await readEnvTexels('src', 0, 0, y, 256, 1)).data);
      const m0 = scan(Float32Array.from(rowsData.flatMap(a => [...a])));
      const m6 = scan((await readEnvTexels('src', 6, 0, 0, 32, 16)).data);
      const s0 = scan((await readEnvTexels('spec', 0, 0, 128, 256, 1)).data);
      const s3 = scan((await readEnvTexels('spec', 3, 0, 0, 128, 64)).data);
      const s6 = scan((await readEnvTexels('spec', 6, 0, 0, 16, 8)).data);
      const sh = current.sh || [];
      const shBad = sh.flat().filter(v => !Number.isFinite(v)).length;
      const bad = m0.bad + m6.bad + s0.bad + s3.bad + s6.bad + shBad;
      const neg = m0.neg + m6.neg + s0.neg + s3.neg + s6.neg;
      const ok = bad === 0 && neg === 0 && sh.length === 9 && sh[0][1] > 0;
      if (!ok) out.ok = false;
      out.presets[id] = { ok, ms: +current.ms.toFixed(1), avg: +current.avg.toFixed(3), srcMax: +m0.max.toFixed(1),
        mip6Max: +m6.max.toFixed(2), spec0Mean: +s0.mean.toFixed(3), spec6Mean: +s6.mean.toFixed(3), sh0: sh[0] && sh[0].map(v => +v.toFixed(3)), bad, neg };
    } catch (e) { out.ok = false; out.presets[id] = { ok: false, error: String(e.message || e) }; }
  }
  const lut = (await readEnvTexels('lut', 0, 0, 0, LUT_SIZE, LUT_SIZE)).data;
  const at = (x, y) => [lut[(y * LUT_SIZE + x) * 2], lut[(y * LUT_SIZE + x) * 2 + 1]];
  const ls = scan(lut, 2);
  const smooth = at(255, 0), rough = at(128, 255), grazing = at(0, 128);
  out.lut = { bad: ls.bad, neg: ls.neg, max: +ls.max.toFixed(3), smoothNV1: smooth.map(v => +v.toFixed(3)), rough: rough.map(v => +v.toFixed(3)), grazing: grazing.map(v => +v.toFixed(3)) };
  if (ls.bad || ls.neg || ls.max > 1.05 || Math.abs(smooth[0] + smooth[1] - 1) > 0.05) out.ok = false;
  await setPreset(prev);
  return out;
}

// ------------------------------------------------------------ init
/** @param {object} ctx main.js module context */
export async function init(ctx) {
  for (const [k, v] of Object.entries(ENV_DEFAULTS)) if (state.env[k] === undefined) state.env[k] = v;
  if (!Array.isArray(state.env.lights)) state.env.lights = [];
  const api = {
    setPreset, loadFile, loadHDR, loadImage, getEnvBindings, envWGSL, envBindGroupLayoutEntries, envBindGroupEntries,
    thumbs, presetThumbnail, findSun, readEnvTexels, getSource, listPresets, mountPanel, drawProbe, writeUniform, parseHDR,
    PRESETS, PH_PRESETS, ENV_PRESETS, selfTest,
  };
  ctx.register('env', api);
  if (!ctx.gpu.ok) return;
  D = ctx.gpu.device;
  await loadWGSL();
  D.pushErrorScope('validation');
  createResources();
  createPipelines();
  bakeLUT();
  const err = await D.popErrorScope();
  if (err) throw new Error('env pipelines: ' + err.message);
  writeUniform();
  onTeardown(() => {
    for (const k of ['envTex', 'specTex', 'lutTex', 'toneTex']) { try { R[k]?.destroy(); } catch (e) {} }
    for (const k of ['shBuf', 'uBuf', 'passBuf']) { try { R[k]?.destroy(); } catch (e) {} }
    ready = false;
  });
  on('env:changed', env => {
    writeUniform();
    if (env.preset && env.preset !== current.id && (!pending || pending.id !== env.preset)) ensureSource(env.preset);
    drawProbe();
  });
  on('view:changed', () => drawProbe());
  on('boot:done', () => {
    const el = document.getElementById('env-panel');
    if (el && !el.childElementCount && !panelEl) mountPanel(el);
  });
  const first = PRESETS.some(p => p.id === state.env.preset) || PH_PRESETS.some(p => p.id === state.env.preset) ? state.env.preset : 'studio';
  state.env.preset = first;
  // Procedural presets are fast; wait for the first so the viewport starts lit.
  // A Poly Haven first preset loads in the background behind the studio.
  if (first.startsWith('ph:')) { await ensureSource('studio'); state.env.preset = first; ensureSource(first); }
  else await ensureSource(first);
}
