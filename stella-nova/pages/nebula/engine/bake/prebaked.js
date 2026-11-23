// prebaked.js: the shipped tier W volume set (data/volume-w.smv, format SMV1) and its loader.
// Owner: row P3B-5. Spec: nebula-spec.md 11.1, pass3-bake-speed.md B4 (container), B5 (boot), 11.5 items 8-9.
//
// WHY: the bake is a pure function of (composition, seed, tier, site set, look options). So its output is a
// cache entry, and a cache entry can ship. tools/prebake.mjs bakes tier W once in headless Edge, reads every
// texture of the volume set back, and writes this container. The page draws it with no bake at page load.
// The decoded textures are the bake's own bits (lossless), so the march sees no new error.
//
// FILE: one gzip member. Payload: "SMV1", u32 LE header length H, H bytes of UTF-8 JSON, zero pad to 4 bytes,
// then the sections back to back (each 4-byte aligned; header.sections[k].offset is relative to the pad end).
// Section codecs (C channels, N = w h d texels, texel i = x + w (y + h z), rows of length w):
//   f16-planar-split-dx  per channel a plane of half-float bits; x delta mod 2^16 in each row (the first
//                        texel of a row keeps its value); all high bytes of the C planes, then all low bytes
//   f16-planar-split-med the same planes and byte split, but the delta is from the median edge predictor
//                        (LOCO-I) in the x-y plane: med(a, b, a + b - c) of a = x - 1, b = y - 1, c = both.
//                        The first texel of a row and the first row of a z slice use the x delta. Volume body
//                        (pass 3): Vol is 140 kB smaller in gzip than with the x delta.
//   u8-planar-dx         the same with bytes, mod 256, no byte split
//   u8-planar            planes only
// STALE GUARD: header.inputs holds the SHA-256 of the composition and of the shader text that the bake and
// the compositor compile (volumeInputs below). A difference logs "[prebaked] stale: <field>" and the page
// bakes live. A stale file is never drawn. A change in bake JS code only (not shader text, not composition)
// is not seen by the guard: run tools/prebake.mjs after such a change.
//
// Exports (grep -n "^export"):
//   SMV_URL                                     'data/volume-w.smv'
//   bakePrograms() -> [[name, fsSource]]        every bake program with its exact text (L2 precompile, hash)
//   volumeInputs() -> Promise<{ compositionSha256, shaderSha256 }>
//   encodeSection(kind, codec, data, C, w) -> Uint8Array;  decodeSection(s, bytes) -> Uint16Array | Uint8Array
//   packPayload(header, sections) -> Uint8Array; unpackPayload(bytes) -> { head, P }
//   captureVolumeSet(ctx, layers) -> { sections, layersHead }   read back the live volume set (prebake)
//   loadPrebaked(ctx, comp, sites, { url, palette }) -> Promise<{ layers, head, info } | { fail }>

import { compositionSha256 } from '../data/composition.js';
import { NEBULA_MATH } from '../shaders/nebula-math.glsl.js';
import { COMPOSITE } from '../shaders/composite.glsl.js';
import { HYDRO_FS } from './shaders/hydro.glsl.js';
import { RAYS_HALF_FS, RAYS_FULL_FS, AMB_FS } from './shaders/radiation.glsl.js';
import { JFA_INIT_FS, JFA_JUMP_FS, JFA_RESOLVE_FS, JFA_CURV_FS } from './shaders/jfa.glsl.js';
import { STRAND_SEED_FS, STRAND_S_FS, STRAND_F_FS } from './shaders/strands.glsl.js';
import { STATS_FS, PRELIGHT_FS, SKINPACK_FS, PREVIEW_FS } from './shaders/prelight.glsl.js';
import { compositorSource } from '../render/shaders/compositor.glsl.js';

export const SMV_URL = 'data/volume-w.smv';

// The program names are the names that the bake modules give program(), so program() adopts them.
export function bakePrograms() {
  const list = Object.keys(HYDRO_FS).map((k) => ['hydro.' + k, HYDRO_FS[k]]);
  list.push(['StarRaysHalf', RAYS_HALF_FS], ['StarRaysFull', RAYS_FULL_FS], ['AmbientScan', AMB_FS],
    ['JfaInit', JFA_INIT_FS], ['JfaJump', JFA_JUMP_FS], ['JfaResolve', JFA_RESOLVE_FS], ['JfaCurv', JFA_CURV_FS],
    ['strands.seed', STRAND_SEED_FS], ['strands.s', STRAND_S_FS], ['strands.f', STRAND_F_FS],
    ['prelight.stats', STATS_FS], ['prelight', PRELIGHT_FS], ['prelight.skinPack', SKINPACK_FS], ['preview', PREVIEW_FS]);
  return list;
}

async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function volumeInputs() {
  const parts = [NEBULA_MATH, COMPOSITE, compositorSource([]), ...bakePrograms().map(([n, s]) => n + '\n' + s)];
  return { compositionSha256, shaderSha256: await sha256Hex(parts.join('\n\u0000\n')) };
}

// ---- Codecs (B4.1) ----

// Prediction of texel i of channel c from texels before it (f16 codecs). med: the median edge predictor in
// the x-y plane of a slice of h rows; else the x delta (0 at the first texel of a row).
function predict16(v, C, c, i, w, h, med) {
  const x = i % w;
  if (x === 0) return 0;
  const a = v[C * (i - 1) + c];
  if (!med || ((i / w) | 0) % h === 0) return a;
  const b = v[C * (i - w) + c], q = v[C * (i - w - 1) + c];
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), a + b - q));
}

export function encodeSection(codec, data, C, w, h = 1) {
  const M = data.length, N = M / C;
  if (codec === 'f16-planar-split-dx' || codec === 'f16-planar-split-med') {
    const med = codec === 'f16-planar-split-med';
    const out = new Uint8Array(2 * M);
    for (let c = 0; c < C; c++) {
      for (let i = 0; i < N; i++) {
        const d = (data[C * i + c] - predict16(data, C, c, i, w, h, med)) & 0xffff;
        out[c * N + i] = d >> 8; out[M + c * N + i] = d & 255;
      }
    }
    return out;
  }
  const out = new Uint8Array(M);
  const dx = codec === 'u8-planar-dx';
  for (let c = 0; c < C; c++) {
    for (let r = 0; r < N / w; r++) {
      let prev = 0;
      for (let x = 0; x < w; x++) {
        const i = r * w + x, v = data[C * i + c];
        out[c * N + i] = dx ? (v - prev) & 255 : v; prev = v;
      }
    }
  }
  return out;
}

export function decodeSection(s, bytes) {
  const C = s.channels, w = s.dims[0];
  const N = s.dims.reduce((a, b) => a * b, 1), M = C * N;
  if (s.codec === 'f16-planar-split-dx' || s.codec === 'f16-planar-split-med') {
    const med = s.codec === 'f16-planar-split-med', h = s.dims.length > 2 ? s.dims[1] : 1;
    const out = new Uint16Array(M);
    for (let c = 0; c < C; c++) {
      for (let i = 0; i < N; i++) {
        out[C * i + c] = (predict16(out, C, c, i, w, h, med) + ((bytes[c * N + i] << 8) | bytes[M + c * N + i])) & 0xffff;
      }
    }
    return out;
  }
  const out = new Uint8Array(M);
  const dx = s.codec === 'u8-planar-dx';
  for (let c = 0; c < C; c++) {
    for (let r = 0; r < N / w; r++) {
      let prev = 0;
      for (let x = 0; x < w; x++) {
        const i = r * w + x, v = dx ? (prev + bytes[c * N + i]) & 255 : bytes[c * N + i];
        out[C * i + c] = v; prev = v;
      }
    }
  }
  return out;
}

// ---- Container (B4.1) ----

export function packPayload(header, sections) {
  let off = 0;
  header.sections = sections.map((s) => {
    const e = { name: s.name, kind: s.kind, dims: s.dims, format: s.format, channels: s.channels, codec: s.codec,
      offset: off, bytes: s.encoded.length, sha256: s.sha256 };
    off += (s.encoded.length + 3) & ~3;
    return e;
  });
  const hb = new TextEncoder().encode(JSON.stringify(header));
  const P = (8 + hb.length + 3) & ~3;
  const out = new Uint8Array(P + off);
  out.set([0x53, 0x4d, 0x56, 0x31], 0);
  new DataView(out.buffer).setUint32(4, hb.length, true);
  out.set(hb, 8);
  sections.forEach((s, k) => out.set(s.encoded, P + header.sections[k].offset));
  return out;
}

export function unpackPayload(bytes) {
  if (bytes.length < 8 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'SMV1') return null;
  const H = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + H)));
  return { head, P: (8 + H + 3) & ~3 };
}

// ---- Read back (tools/prebake.mjs runs this in the page after a live tier W bake) ----

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function toHalf(v) {   // exact for values that are half floats already (RGBA16F read back as float)
  f32[0] = v; const x = u32[0];
  const s = (x >>> 16) & 0x8000; let e = ((x >>> 23) & 0xff) - 127 + 15; let m = x & 0x7fffff;
  if (((x >>> 23) & 0xff) === 0xff) return s | 0x7c00 | (m ? 0x200 : 0);
  if (e <= 0) { if (e < -10) return s; m |= 0x800000; const sh = 14 - e; let h = m >> sh; if ((m >> (sh - 1)) & 1) h++; return s | h; }
  if (e >= 31) return s | 0x7c00;
  let h = s | (e << 10) | (m >> 13); if (m & 0x1000) h++; return h;
}

const SECTIONS = [
  { name: 'Vol', key: 'vol', format: 'RGBA16F', channels: 4, codec: 'f16-planar-split-med' },
  { name: 'SkinD', key: 'skinD', format: 'R8', channels: 1, codec: 'u8-planar-dx' },
  { name: 'SkinA', key: 'skinA', format: 'RGBA8', channels: 4, codec: 'u8-planar-dx' },
  { name: 'StrandSeg', key: 'strandSeg', format: 'RGBA16F', channels: 4, codec: 'f16-planar-split-dx' },
  { name: 'StrandBin', key: 'strandBin', format: 'RGBA8', channels: 4, codec: 'u8-planar' },
];

export async function texelSha(data) {
  const d = await crypto.subtle.digest('SHA-256', new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

// readFloat(ctx, name, layer) gives RGBA float32 for every format. Half floats round-trip exactly; 8-bit
// values come back as k / 255 and round back to k.
export async function readSection(ctx, readFloat, def) {
  const e = ctx.registry.get(def.name);
  if (!e) return null;
  const depth = e.kind === '3d' ? e.d : 1, wh = e.w * e.h, C = def.channels;
  const half = def.format === 'RGBA16F';
  const data = half ? new Uint16Array(wh * depth * C) : new Uint8Array(wh * depth * C);
  for (let z = 0; z < depth; z++) {
    const L = readFloat(ctx, def.name, z);
    for (let i = 0; i < wh; i++) {
      for (let c = 0; c < C; c++) {
        const v = L[4 * i + c];
        data[(z * wh + i) * C + c] = half ? toHalf(v) : Math.max(0, Math.min(255, Math.round(v * 255)));
      }
    }
  }
  return { name: def.name, kind: e.kind === '3d' ? '3d' : '2d', dims: e.kind === '3d' ? [e.w, e.h, e.d] : [e.w, e.h],
    format: def.format, channels: C, codec: def.codec, data, sha256: await texelSha(data) };
}

const plain = (v) => (v && typeof v === 'object' && typeof v.length === 'number' ? Array.from(v) : v);

export async function captureVolumeSet(ctx, readFloat, layers) {
  const sections = [];
  for (const def of SECTIONS) {
    const s = await readSection(ctx, readFloat, def);
    if (!s) continue;
    s.encoded = encodeSection(def.codec, s.data, s.channels, s.dims[0], s.dims.length > 2 ? s.dims[1] : 1);
    sections.push(s);
  }
  const vm = layers.volMeta || {};
  const volMeta = {};
  for (const k of Object.keys(vm)) volMeta[k] = plain(vm[k]);
  const layersHead = {
    volMeta, strandFamily: plain(layers.strandFamily), strandAbsorb: layers.strandAbsorb, lmax: layers.lmax,
    exposure: layers.exposure, exposureTrimEv: layers.exposureTrimEv,
  };
  return { sections, layersHead };
}

// ---- Loader (B4.3, B5.1) ----

const fail = (why) => { console.warn('[prebaked] ' + why + ': the page bakes live'); return { fail: why }; };

export async function loadPrebaked(ctx, comp, sites, { url = SMV_URL, palette = 'nircam', lookOf, buildCatalogue } = {}) {
  const t0 = performance.now();
  let bytes, fetched = 0;
  try {
    if (typeof DecompressionStream === 'undefined') return fail('no DecompressionStream');
    // The claude.ai host serves no .smv type, so the published copy carries a .wasm suffix.
    let res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) res = await fetch(url + '.wasm', { cache: 'force-cache' });
    if (!res.ok) return fail('fetch ' + res.status);
    const gz = new Uint8Array(await res.arrayBuffer());
    fetched = gz.length;
    var tFetch = performance.now();
    const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (e) { return fail('fetch or gunzip failed (' + (e && e.message ? e.message : e) + ')'); }
  const tGunzip = performance.now();
  const u = unpackPayload(bytes);
  if (!u) return fail('not an SMV1 file');
  const { head, P } = u;
  let inputs;
  try { inputs = await volumeInputs(); } catch (e) { return fail('no crypto.subtle for the stale guard'); }
  for (const k of ['compositionSha256', 'shaderSha256']) {
    if (!head.inputs || head.inputs[k] !== inputs[k]) return fail('stale: ' + k);
  }
  if (head.look && head.look.palette !== palette) return fail('stale: look.palette');
  const tex = {};
  let decodeMs = 0;
  const tUp0 = performance.now();
  for (const s of head.sections) {
    const d0 = performance.now();
    const data = decodeSection(s, bytes.subarray(P + s.offset, P + s.offset + s.bytes));
    decodeMs += performance.now() - d0;
    const opts = s.kind === '3d' ? { filter: 'linear', wrapX: 'repeat', data } : { filter: 'nearest', data };
    tex[s.name] = s.kind === '3d' ? ctx.registry.tex3D(s.name, s.dims, s.format, opts)
      : ctx.registry.tex2D(s.name, s.dims[0], s.dims[1], s.format, opts);
  }
  const uploadSubmitMs = performance.now() - tUp0 - decodeMs;
  const L = head.layers;
  const look = lookOf(comp, palette, 'all');
  const layers = {
    vol: tex.Vol, skinD: tex.SkinD, skinA: tex.SkinA, strandSeg: tex.StrandSeg || null, strandBin: tex.StrandBin || null,
    volMeta: L.volMeta, look: look.uniforms, dustBand: look.dustBand, strandFamily: L.strandFamily, strandAbsorb: L.strandAbsorb,
    lmax: L.lmax, exposure: L.exposure, exposureTrimEv: L.exposureTrimEv,
    fine: L.fine || null, fineAtlas: tex.Fine || null,   // the fine box atlas (bake/nest.js packAtlas)
  };
  const kept = (head.seats || []).map((s) => ({ id: s.id, x: s.x, y: s.y }));
  layers.catalogue = buildCatalogue(comp, sites, layers, { fluxScale: L.exposure, seats: kept, palette, cepheids: false });
  const info = {
    file: url, bytes: fetched, payloadBytes: bytes.length, fetchMs: tFetch - t0, gunzipMs: tGunzip - tFetch,
    decodeMs, uploadSubmitMs, totalMs: performance.now() - t0, bake: head.bake,
  };
  // totalMs is null, so the stats panel shows the load time; the prebake run's bake time is bakeTotalMs.
  layers.report = { ...(head.report || {}), totalMs: null, bakeTotalMs: head.report ? head.report.totalMs : null, source: 'prebaked', prebaked: info };
  return { layers, head, info };
}
