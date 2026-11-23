// prelight.js: the pre-light stage of the bake (spec 2.13.6, 3.2, 3.2.2) and the Preview kernel (2.12).
// Row A7. Revision 3: it replaces slabs.js.
//
// WHAT: after the light stage, the jump flood and the strand trace, it writes the pre-lit volume:
//   Vol (RGBA16F: emission j x VolScale, extinction sigma_V x SigScale), SkinD (R8: the code of the
//   signed distance d to the ionization front) and SkinA (RGBA8, half grid: log2 codes of the skin
//   amplitudes). Stats first: every 4th voxel per axis, read back, for VolScale, SigScale and the log
//   ranges. Then Prelight (one draw per z-layer, two targets) and SkinPack. It also uploads the 3D strand
//   store (StrandSeg, StrandBin) from binStrands3D (strands.js). No light ray runs at draw time.
//
// EXPORTS (grep -n "^export"):
//   function* prelightChunks(ctx, state, comp, { palette, channelMask, sources, inputs })
//        -> state.Vol, state.SkinD, state.SkinA (3D), state.volMeta, state.diag.prelight
//   uploadStrandStore(ctx, state, store) -> state.StrandSeg (RGBA16F), state.StrandBin (RGBA8)
//   function* previewChunks(ctx, state, comp, { palette, channelMask, sources, inputs, debug })
//        -> state.preview (RGBA16F 2D, 1920 x 360, exposure 1), state.diag.preview
//   CHANNELS, channelMaskOf(m), lookOf(comp, palette, channelMask), lightSources(comp, extra),
//   jetBoxes(comp), prelightPrograms(gl), VOLUME_NAMES
//
// INPUTS (registry names or entries in state): Opt, S, LA, LB, Amb, Jd, Jr. For a ping-pong pair the
//   module takes, in order: opts.inputs[key], state.cur[key], state[key], then the one live copy of
//   key + '0' / key + '1'.
// SOURCES: the dominant index in LA.w points into the light source list of the light stage.
//   The module takes opts.sources, else state.lightSources, else lightSources(comp).
// It never writes report (A8 owns it). It releases only its own scratch textures.

import { program } from '../gl/context.js';
import { runQuadPass, runSlicePass, readFloat } from '../gl/passes.js';
import { STATS_FS, PRELIGHT_FS, SKINPACK_FS, PREVIEW_FS } from './shaders/prelight.glsl.js';
import { TIERS, CONTENT_W, CONTENT_H, DEPTH, depthOf } from '../params.js';

export const CHANNELS = ['He', 'H', 'Front', 'PAH', 'H2', 'Shock', 'Ejecta', 'Scatter'];
export const VOLUME_NAMES = ['Vol', 'SkinD', 'SkinA'];
const Q_NORM = 1.2156e45;            // 4 pi alpha_B n0^2 l^3 (2.1)
const MAX_SOURCES = 24;
const MAX_JETS = 4;
const JET_HALF_WIDTH = 40;           // px (2.11.2)
const PREVIEW_DIMS = [1920, 360];
const PREVIEW_TILE = [480, 180];
const STORE_TARGET = 2048;           // 3.2: the 99.99th percentile of a stored value
const LAYERS_PER_CHUNK = 4;

const programCache = new WeakMap();
// Lab nest (LAB-DESIGN 3.7): the fine-box variants. VoxelCentre gives world px; UvwOf maps world px into the box.
function nestPre(fs) {
  const rep = (t, a, b) => { if (t.split(a).length !== 2) throw new Error('[prelight] nest text: ' + a.slice(0, 50)); return t.replace(a, () => b); };
  let t = rep(fs, 'float3 UvwOf(float3 p) { return p / _BoxPx; }', 'uniform vec3 _Origin;\nfloat3 UvwOf(float3 p) { return (p - _Origin) / _BoxPx; }');
  t = rep(t, 'return (id * _Step + float3(0.5, 0.5, 0.5) * _Step) * _CellPx;', 'return (id * _Step + float3(0.5, 0.5, 0.5) * _Step) * _CellPx + _Origin;');
  return t;
}
const nestCache = new WeakMap();
function nestPrelightPrograms(gl) {
  let p = nestCache.get(gl);
  if (!p) {
    p = {
      stats: program(gl, 'nest.prelight.stats', null, nestPre(STATS_FS)),
      prelight: program(gl, 'nest.prelight', null, nestPre(PRELIGHT_FS)),
      skinPack: program(gl, 'nest.prelight.skinPack', null, nestPre(SKINPACK_FS)),
    };
    nestCache.set(gl, p);
  }
  return p;
}

export function prelightPrograms(gl) {
  let p = programCache.get(gl);
  if (!p) {
    p = {
      stats: program(gl, 'prelight.stats', null, STATS_FS),
      prelight: program(gl, 'prelight', null, PRELIGHT_FS),
      skinPack: program(gl, 'prelight.skinPack', null, SKINPACK_FS),
      preview: program(gl, 'preview', null, PREVIEW_FS),
    };
    programCache.set(gl, p);
  }
  return p;
}

// Channel mask as 8 numbers in CHANNELS order. Accepts null (all on), a channel name (solo),
// 'channel:<Name>', an array of 8, or an object { He: true, ... } (missing keys are on).
export function channelMaskOf(m) {
  if (m == null || m === 'all') return CHANNELS.map(() => 1);
  if (typeof m === 'string') {
    const name = m.startsWith('channel:') ? m.slice(8) : m;
    if (!CHANNELS.includes(name)) throw new Error(`[prelight] unknown channel ${name}`);
    return CHANNELS.map((c) => (c === name ? 1 : 0));
  }
  if (Array.isArray(m) || ArrayBuffer.isView(m)) {
    if (m.length !== 8) throw new Error('[prelight] channel mask needs 8 values');
    return Array.from(m, (v) => (v ? Number(v) : 0));
  }
  return CHANNELS.map((c) => (m[c] === undefined ? 1 : (m[c] ? Number(m[c]) : 0)));
}

// Palette, dust band, weights and mask as uniforms. palette: 'nircam' (default), 'sho' or an object.
export function lookOf(comp, palette, channelMask) {
  const pal = typeof palette === 'object' && palette ? palette : comp.palette[palette || 'nircam'];
  if (!pal) throw new Error(`[prelight] unknown palette ${palette}`);
  const w = comp.weights;
  const mask = channelMaskOf(channelMask);
  const dustBand = pal.dustBand !== undefined ? pal.dustBand : comp.dustBand;
  return {
    dustBand,
    mask,
    uniforms: {
      _PalHe: pal.He, _PalH: pal.H, _PalFront: pal.Front, _PalPAH: pal.PAH, _PalH2: pal.H2,
      _PalShock: pal.Shock, _PalEjecta: pal.Ejecta, _ScatterBias: pal.scatterBias, _CIsrf: w.cIsrf,
      _MaskA: mask.slice(0, 4), _MaskB: mask.slice(4, 8),
      _WVolA: [w.eH, w.eHe, w.eSh, w.eH2s], _WVolB: [w.eEj, w.ePv, w.eH2v, w.albedo],
      _WSkinA: [w.eRim, w.eSt, w.eFr, w.ePAH], _WSkinB: [w.eH2, w.iIsrf, 0, 0],
    },
  };
}

// Phase-B duration in px of motion per unit speed (the same at both tiers: dt x 2, steps / 2).
function phaseBPx(comp) {
  const st = comp.steps.U;
  return st.B * st.dtB * comp.units.pxPerL;
}
function qhatOf(s) {
  if (s.qMode === 'qhat') return s.qhat;
  if (s.qMode === 'logQ0') return Math.pow(10, s.logQ0) / Q_NORM;
  return 0;
}
// Light sources of the light stage, as { id, posPx: [x, y, z], qhat, qhatFuv }.
export function lightSources(comp, extra) {
  const list = comp.sources.filter((s) => s.qMode && s.qMode !== 'none').concat(extra || []);
  return list.map((s) => toLight(comp, s));
}
function toLight(comp, s) {
  if (s.posPx && s.qhatFuv !== undefined && s.qhat !== undefined && !s.qMode) return s;
  let posPx = s.posPx ? s.posPx.slice() : [s.pos[0], s.pos[1], depthOf(s.pos[2])];
  if (!s.posPx && s.move) {
    const bpx = phaseBPx(comp);
    posPx = posPx.map((v, i) => v + s.move.dir[i] * s.move.v * bpx);   // ro at its end position (2.4)
  }
  const qhatFuv = s.qhatFuv !== undefined ? s.qhatFuv
    : (s.logQfuv !== undefined ? Math.pow(10, s.logQfuv) / Q_NORM : 0);
  const qhat = s.qMode ? qhatOf(s) : (s.qhat || 0);
  return { id: s.id, posPx, qhat, qhatFuv };
}
// Jet lobe boxes for mJet (2.11.2, 4.4): axis a = (cos A cos T, sin A cos T, -sin T).
export function jetBoxes(comp) {
  return comp.sources.filter((s) => s.jet).map((s) => {
    const A = s.jet.axisDeg * Math.PI / 180, T = s.jet.tiltDeg * Math.PI / 180;
    return {
      id: s.id, posPx: [s.pos[0], s.pos[1], depthOf(s.pos[2])],
      axis: [Math.cos(A) * Math.cos(T), Math.sin(A) * Math.cos(T), -Math.sin(T)],
      lobePx: s.jet.lobePx, halfWidth: JET_HALF_WIDTH,
    };
  });
}
function sourceUniforms(sources, jets) {
  if (sources.length > MAX_SOURCES) throw new Error(`[prelight] ${sources.length} sources > ${MAX_SOURCES}`);
  if (jets.length > MAX_JETS) throw new Error(`[prelight] ${jets.length} jets > ${MAX_JETS}`);
  const sp = new Float32Array(MAX_SOURCES * 4), sq = new Float32Array(MAX_SOURCES * 4);
  sources.forEach((s, i) => { sp.set([s.posPx[0], s.posPx[1], s.posPx[2], s.qhat], 4 * i); sq.set([s.qhatFuv, 0, 0, 0], 4 * i); });
  const jp = new Float32Array(MAX_JETS * 4), ja = new Float32Array(MAX_JETS * 4);
  jets.forEach((j, i) => { jp.set([j.posPx[0], j.posPx[1], j.posPx[2], j.lobePx], 4 * i); ja.set([j.axis[0], j.axis[1], j.axis[2], j.halfWidth], 4 * i); });
  return { _SrcPos: sp, _SrcQ: sq, _SrcCount: sources.length, _JetPos: jp, _JetAxis: ja, _JetCount: jets.length };
}
function entryOf(registry, v) {
  if (!v) return null;
  if (typeof v === 'string') return registry.get(v);
  return v.tex ? v : null;
}
function inputOf(ctx, state, opts, key) {
  const r = ctx.registry;
  const named = (opts.inputs && opts.inputs[key]) || (state.cur && state.cur[key]) || state[key];
  const e = entryOf(r, named) || r.get(key);
  if (e) return e;
  const e0 = r.get(key + '0'), e1 = r.get(key + '1');
  if (e0 && e1) console.warn(`[prelight] ${key}0 and ${key}1 are both live and state.cur.${key} is not set: ${key}0 is used`);
  const pick = e0 || e1;
  if (!pick) throw new Error(`[prelight] input ${key} is not live`);
  return pick;
}
function sampleTextures(ctx, state, opts) {
  const t = {};
  for (const k of ['Opt', 'S', 'LA', 'LB', 'Amb', 'Jd', 'Jr']) t['_' + k] = inputOf(ctx, state, opts, k);
  return t;
}
function sampleUniforms(state, comp, opts, look, textures) {
  const given = opts.sources || state.lightSources;
  const sources = given ? given.map((s) => toLight(comp, s)) : lightSources(comp, state.seatSources || null);
  const la = textures._LA;
  return {
    ...look.uniforms, ...sourceUniforms(sources, jetBoxes(comp)),
    _BoxPx: state.nest ? state.nest.ext : [CONTENT_W, CONTENT_H, DEPTH], _LADims: [la.w, la.h, la.d], _sourceCount: sources.length,
    ...(state.nest ? { _Origin: state.nest.origin } : {}),
  };
}

// ---- Percentiles of the Stats readback (3.2) ----
function pct(arr, p) {
  if (!arr.length) return 0;
  const a = Float32Array.from(arr).sort();
  return a[Math.min(a.length - 1, Math.max(0, Math.floor((p / 100) * a.length)))];
}
function pow2Scale(p9999) {
  if (!(p9999 > 0)) return 1;
  return Math.pow(2, Math.round(Math.log2(STORE_TARGET / p9999)));
}
function logRange(values) {
  if (values.length < 16) return [0, 1];
  let lo = pct(values, 0.1), hi = pct(values, 99.9);
  if (!(hi - lo > 1e-3)) hi = lo + 1;
  return [lo, hi];
}

// The pre-light stage. Yields after each group of z-layers.
export function* prelightChunks(ctx, state, comp, opts = {}) {
  const { gl, registry } = ctx;
  const t0 = performance.now();
  const tier = state.nest ? state.nest.tier : (TIERS[ctx.tier] || TIERS.W);
  const [W, H, D] = tier.dims;
  const cell = state.nest ? tier.cell : [CONTENT_W / W, CONTENT_H / H, DEPTH / D];
  const progs = state.nest ? nestPrelightPrograms(gl) : prelightPrograms(gl);
  const look = lookOf(comp, opts.palette, opts.channelMask);
  const textures = sampleTextures(ctx, state, opts);
  const su = sampleUniforms(state, comp, opts, look, textures);

  // 1. Stats: every 4th voxel per axis.
  const sd = [Math.ceil(W / 4), Math.ceil(H / 4), Math.ceil(D / 4)];
  const sV = registry.tex3D('prelight.statsV', sd, 'RGBA32F', { filter: 'nearest' });
  const sA = registry.tex3D('prelight.statsA', sd, 'RGBA32F', { filter: 'nearest' });
  const jMax = [], sig = [], aE = [], aP = [], a2 = [];
  try {
    for (let z = 0; z < sd[2]; z += LAYERS_PER_CHUNK) {
      runSlicePass(ctx, progs.stats, { targets: [sV, sA], dims: sd, layers: [z, Math.min(sd[2], z + LAYERS_PER_CHUNK)],
        uniforms: { ...su, _CellPx: cell, _Step: 4 }, textures });
      yield { stage: 'prelight', part: 'stats', layer: z };
    }
    for (let z = 0; z < sd[2]; z++) {
      const v = readFloat(ctx, sV, z), a = readFloat(ctx, sA, z);
      for (let i = 0; i < sd[0] * sd[1]; i++) {
        jMax.push(Math.max(v[4 * i], v[4 * i + 1], v[4 * i + 2]));
        sig.push(v[4 * i + 3]);
        if (Math.abs(a[4 * i + 3]) < 95) {
          if (a[4 * i] > 0) aE.push(Math.log2(a[4 * i]));
          if (a[4 * i + 1] > 0) aP.push(Math.log2(a[4 * i + 1]));
          if (a[4 * i + 2] > 0) a2.push(Math.log2(a[4 * i + 2]));
        }
      }
    }
  } finally {
    registry.release('prelight.statsV');
    registry.release('prelight.statsA');
  }
  const jP = pct(jMax, 99.99), sP = pct(sig, 99.99);
  const volScale = pow2Scale(jP), sigScale = pow2Scale(sP);
  const rE = logRange(aE), rP = logRange(aP), r2 = logRange(a2);
  const meta = {
    dims: [W, H, D], volScale, sigScale, skinLo: [rE[0], rP[0], r2[0]], skinHi: [rE[1], rP[1], r2[1]],
    p9999: { j: jP, sigma: sP }, skinDims: [Math.ceil(W / 2), Math.ceil(H / 2), Math.ceil(D / 2)],
  };
  yield { stage: 'prelight', part: 'scales', meta };

  // 2. Prelight: Vol and SkinD.
  for (const n of VOLUME_NAMES) if (registry.get(n)) registry.release(n);
  const vol = registry.tex3D('Vol', [W, H, D], 'RGBA16F', { filter: 'linear', wrapX: 'repeat' });
  const skinD = registry.tex3D('SkinD', [W, H, D], 'R8', { filter: 'linear', wrapX: 'repeat' });
  // Filaments (pass3-filaments.md F4.6): the tubes take their share of the volume emission and dust.
  // No TubeLen (pass 1, or no strands): a 1 x 1 x 1 zero texture, so nothing is taken.
  const tubeLen = registry.get('TubeLen') || registry.tex3D('TubeLen', [1, 1, 1], 'RGBA8', { filter: 'linear', data: new Uint8Array(4) });
  for (let z = 0; z < D; z += LAYERS_PER_CHUNK) {
    runSlicePass(ctx, progs.prelight, { targets: [vol, skinD], dims: [W, H, D], layers: [z, Math.min(D, z + LAYERS_PER_CHUNK)],
      uniforms: { ...su, _CellPx: cell, _Step: 1, _VolScale: volScale, _SigScale: sigScale }, textures: { ...textures, _TubeLen: tubeLen } });
    yield { stage: 'prelight', part: 'vol', layer: z };
  }
  registry.release('TubeLen');
  // 3. SkinPack on the half grid.
  const ad = meta.skinDims;
  const skinA = registry.tex3D('SkinA', ad, 'RGBA8', { filter: 'linear', wrapX: 'repeat' });
  for (let z = 0; z < ad[2]; z += LAYERS_PER_CHUNK) {
    runSlicePass(ctx, progs.skinPack, { targets: [skinA], dims: ad, layers: [z, Math.min(ad[2], z + LAYERS_PER_CHUNK)],
      uniforms: { ...su, _CellPx: cell, _Step: 2, _SkinLo: meta.skinLo, _SkinHi: meta.skinHi }, textures });
    yield { stage: 'prelight', part: 'skinA', layer: z };
  }
  state.Vol = vol; state.SkinD = skinD; state.SkinA = skinA; state.volMeta = meta;
  state.diag = state.diag || {};
  state.diag.prelight = {
    tier: tier.name, ms: performance.now() - t0, ...meta, dustBand: look.dustBand, channelMask: look.mask,
    palette: typeof opts.palette === 'string' ? opts.palette : (opts.palette ? 'custom' : 'nircam'),
    sources: su._sourceCount, bytes: vol.bytes + skinD.bytes + skinA.bytes,
  };
  return state.diag.prelight;
}

// ---- Strand store upload (3.2.2) ----
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function toHalf(v) {
  f32[0] = v;
  const x = u32[0];
  const s = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xff) - 112;
  let m = x & 0x7fffff;
  if (e <= 0) {
    if (e < -10) return s;
    m = (m | 0x800000) >>> (1 - e);
    return s | ((m + 0x1000) >>> 13);
  }
  if (e >= 31) return s | 0x7c00;
  const h = s | (e << 10) | (m >>> 13);
  return h + ((m >>> 12) & 1);
}

// store = binStrands3D result: { seg: Float32Array(8 n), bin: Uint8Array(512 x 729 x 4), tube, stats }.
export function uploadStrandStore(ctx, state, store) {
  const { registry } = ctx;
  const n = store.seg.length / 8;
  const rows = Math.max(1, Math.ceil((2 * n) / 1024));
  const half = new Uint16Array(1024 * rows * 4);
  for (let i = 0; i < store.seg.length; i++) half[i] = toHalf(store.seg[i]);
  for (const k of ['StrandSeg', 'StrandBin']) if (registry.get(k)) registry.release(k);
  state.StrandSeg = registry.tex2D('StrandSeg', 1024, rows, 'RGBA16F', { filter: 'nearest', data: half });
  state.StrandBin = registry.tex2D('StrandBin', 512, store.bin.length / (4 * 512), 'RGBA8', { filter: 'nearest', data: store.bin });
  // Pass 3 filaments: the share of each 20 x 20 x 40 px cell that the tubes take (strands.js step 4).
  // Prelight reads it and releases it.
  if (registry.get('TubeLen')) registry.release('TubeLen');
  if (store.tube) registry.tex3D('TubeLen', [288, 54, 48], 'RGBA8', { filter: 'linear', wrapX: 'repeat', data: store.tube });
  return { entries: n, bytes: state.StrandSeg.bytes + state.StrandBin.bytes };
}

function tilesOf(w, h, tile) {
  const out = [];
  for (let y = 0; y < h; y += tile[1]) for (let x = 0; x < w; x += tile[0]) out.push([x, y, Math.min(tile[0], w - x), Math.min(tile[1], h - y)]);
  return out;
}

// Preview kernel (2.12): full depth at 1920 x 360, mid-scroll, exposure 1. The pipeline bisects E0 on it.
export function* previewChunks(ctx, state, comp, opts = {}) {
  const { gl, registry } = ctx;
  const t0 = performance.now();
  const progs = prelightPrograms(gl);
  const look = lookOf(comp, opts.palette, opts.channelMask);
  const textures = sampleTextures(ctx, state, opts);
  const su = sampleUniforms(state, comp, opts, look, textures);
  const dbg = opts.debug || {};
  const out = registry.tex2D('preview', PREVIEW_DIMS[0], PREVIEW_DIMS[1], 'RGBA16F', { filter: 'linear' });
  state.preview = out;
  const u = { ...su, _OutDims: PREVIEW_DIMS, _Exposure: dbg.exposure !== undefined ? dbg.exposure : 1, _DustBand: look.dustBand };
  let draws = 0;
  for (const rect of tilesOf(PREVIEW_DIMS[0], PREVIEW_DIMS[1], PREVIEW_TILE)) {
    runQuadPass(ctx, progs.preview, { target: out, layer: 0, rect, uniforms: u, textures });
    draws++;
    yield { stage: 'preview', rect, draw: draws };
  }
  state.diag = state.diag || {};
  state.diag.preview = { dims: PREVIEW_DIMS.slice(), draws, ms: performance.now() - t0, dustBand: look.dustBand };
  return state.diag.preview;
}
