// ============================================================================
//  MATERIAL STUDIO  ·  export/pack.js — channel packing and image encode
// ────────────────────────────────────────────────────────────────────────────
//  A plan entry lists one channel spec per output channel. ch.s, ch.srgb,
//  ch.inv and ch.k make the specs: a slot channel, the same in sRGB, one
//  minus the channel, or a constant. A spec can also carry gain or fn.
//  packImage fills the channels at 8 bit, 16 bit or half, then encodes
//  PNG, TGA or EXR. chLabel gives the channel name for the table and
//  the README.
//
//  GREP TARGETS
//      ch  SLOT_CH  chLabel  packImage  pad3  expandGA
// ============================================================================
import { encodePNG, encodeTGA, encodeEXR, f32ToF16 } from '../zip.js';
import { H2F, H2L8, H2S8, luts, linToSrgb, clamp01 } from './half.js';

/** Channel source helpers for plan entries. */
export const ch = {
  s: (slot, c, label) => ({ slot, c, label: label || `${slot}.${'rgba'[c]}` }),
  srgb: (slot, c, label) => ({ slot, c, srgb: true, label: label || `${slot}.${'rgba'[c]} sRGB` }),
  inv: (slot, c, label) => ({ slot, c, inv: true, label: label || `1 - ${slot}.${'rgba'[c]}` }),
  k: (v, label) => ({ v, label: label || String(v) }),
};
const SLOT_CH = { // friendly labels
  'albedo.0': 'base R', 'albedo.1': 'base G', 'albedo.2': 'base B', 'albedo.3': 'opacity',
  'normal.0': 'normal X', 'normal.1': 'normal Y', 'normal.2': 'normal Z',
  'orm.0': 'AO', 'orm.1': 'roughness', 'orm.2': 'metallic', 'height.0': 'height',
  'emissive.0': 'emissive R', 'emissive.1': 'emissive G', 'emissive.2': 'emissive B',
  'extra.0': 'clearcoat', 'extra.1': 'clearcoat rough', 'extra.2': 'sheen', 'extra.3': 'anisotropy',
};
export function chLabel(c) {
  if (c.v !== undefined) return c.label || String(c.v);
  const base = SLOT_CH[`${c.slot}.${c.c}`] || `${c.slot}.${'rgba'[c.c]}`;
  if (c.label && !/^(albedo|normal|orm|height|emissive|extra)\./.test(c.label) && !/^1 - /.test(c.label)) return c.label;
  return (c.inv ? (c.slot === 'orm' && c.c === 1 ? 'smoothness' : c.slot === 'normal' && c.c === 1 ? 'normal -Y' : `1-${base}`) : base) + (c.srgb ? ' (sRGB)' : '') + (c.gain && c.gain !== 1 ? ` x${c.gain.toFixed(3)}` : '');
}

/**
 * Pack one plan image into channel data, then encode it.
 * @param {object} img plan entry {file, chans, bits, fmt, srgbChunk}
 * @param {import('./readback.js').MapSource} src
 * @returns {Promise<Uint8Array>}
 */
export async function packImage(img, src) {
  luts();
  const res = src.res, n = res * res, chs = img.chans, k = chs.length;
  const fmt = img.fmt || img.ext || 'png', bits = fmt === 'exr' ? 'half' : (img.bits || 8);
  const out = bits === 'half' ? new Uint16Array(n * k) : bits === 16 ? new Uint16Array(n * k) : new Uint8Array(n * k);
  for (let j = 0; j < k; j++) {
    const c = chs[j];
    if (c.v !== undefined) {
      const val = bits === 'half' ? f32ToF16(c.v) : bits === 16 ? Math.round(clamp01(c.v) * 65535) : Math.round(clamp01(c.v) * 255);
      for (let i = 0; i < n; i++) out[(i * k) + j] = val;
      continue;
    }
    const a = await src.get(c.slot), sc = c.c;
    const gain = c.gain ?? 1;
    if (c.fn) { // custom per-texel function of the whole texel (anisotropy direction)
      for (let i = 0; i < n; i++) {
        const v = clamp01(c.fn(H2F[a[i * 4]], H2F[a[(i * 4) + 1]], H2F[a[(i * 4) + 2]], H2F[a[(i * 4) + 3]]));
        out[(i * k) + j] = bits === 16 ? Math.round(v * 65535) : bits === 'half' ? f32ToF16(v) : Math.round(v * 255);
      }
      continue;
    }
    if (bits === 8 && !c.inv && gain === 1) {
      const L = c.srgb ? H2S8 : H2L8;
      for (let i = 0; i < n; i++) out[(i * k) + j] = L[a[(i * 4) + sc]];
    } else if (bits === 8) {
      for (let i = 0; i < n; i++) {
        let v = clamp01(H2F[a[(i * 4) + sc]] * gain);
        if (c.inv) v = 1 - v;
        out[(i * k) + j] = Math.round((c.srgb ? linToSrgb(v) : v) * 255);
      }
    } else if (bits === 16) {
      for (let i = 0; i < n; i++) {
        let v = clamp01(H2F[a[(i * 4) + sc]] * gain);
        if (c.inv) v = 1 - v;
        out[(i * k) + j] = Math.round((c.srgb ? linToSrgb(v) : v) * 65535);
      }
    } else { // half: copy bits unless an op applies
      for (let i = 0; i < n; i++) {
        const hb = a[(i * 4) + sc];
        out[(i * k) + j] = (!c.inv && gain === 1) ? hb : f32ToF16(c.inv ? 1 - (H2F[hb] * gain) : H2F[hb] * gain);
      }
    }
  }
  if (fmt === 'exr') return encodeEXR({ width: res, height: res, channels: k === 2 ? 3 : k, data: k === 2 ? pad3(out, n) : out });
  if (fmt === 'tga' && bits === 8) return encodeTGA({ width: res, height: res, channels: k, data: k === 2 ? expandGA(out, n) : out });
  return encodePNG({ width: res, height: res, channels: k, bitDepth: bits === 16 ? 16 : 8, data: out, srgb: !!img.srgbChunk, text: { Software: 'Stella Nova PBR Material Studio' } });
}
function pad3(a, n) { const o = new Uint16Array(n * 3); for (let i = 0; i < n; i++) { o[i * 3] = a[i * 2]; o[(i * 3) + 1] = a[(i * 2) + 1]; } return o; }
function expandGA(a, n) { const o = new Uint8Array(n * 4); for (let i = 0; i < n; i++) { o[i * 4] = o[(i * 4) + 1] = o[(i * 4) + 2] = a[i * 2]; o[(i * 4) + 3] = a[(i * 2) + 1]; } return o; }
