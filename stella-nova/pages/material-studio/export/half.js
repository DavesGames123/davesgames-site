// ============================================================================
//  MATERIAL STUDIO  ·  export/half.js — half-float lookup tables
// ────────────────────────────────────────────────────────────────────────────
//  The baked maps leave the GPU as half-float bits. luts() fills three
//  65536-entry tables once: half bits to float, to 8-bit linear and to 8-bit
//  sRGB. NaN becomes 0, and the 8-bit tables clamp to 0..1. Call luts()
//  before you read H2F, H2L8 or H2S8. The names are live bindings.
//
//  GREP TARGETS
//      H2F  H2L8  H2S8  luts  linToSrgb  clamp01
// ============================================================================
import { f16ToF32 } from '../zip.js';

export let H2F = null, H2L8 = null, H2S8 = null;
export function luts() {
  if (H2F) return;
  H2F = new Float32Array(65536); H2L8 = new Uint8Array(65536); H2S8 = new Uint8Array(65536);
  for (let h = 0; h < 65536; h++) {
    let v = f16ToF32(h);
    if (!(v === v)) v = 0;
    H2F[h] = v;
    const c = v < 0 ? 0 : v > 1 ? 1 : v;
    H2L8[h] = Math.round(c * 255);
    H2S8[h] = Math.round(linToSrgb(c) * 255);
  }
}
/** Linear 0..1 to sRGB 0..1 (IEC 61966-2-1). */
export function linToSrgb(c) { return c <= 0.0031308 ? c * 12.92 : (1.055 * Math.pow(c, 1 / 2.4)) - 0.055; }
export const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : (v === v ? v : 0));
