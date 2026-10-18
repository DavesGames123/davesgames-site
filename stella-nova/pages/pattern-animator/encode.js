// ============================================================================
//  ANIMATED PATTERN DESIGNER  ·  encode.js — loop timing, GIF and ZIP (no DOM)
// ----------------------------------------------------------------------------
//  framePlan(L, fps, loops) gives the frame times of an export. n frames
//  cover loops x L seconds at equal steps; frame n would be frame 0 again,
//  so it is not in the file and the file loops with no seam. The GIF
//  delays are in 1/100 s; they add up to the exact length (each delay is
//  the difference of two rounded marks, so no error builds up).
//
//  GIF. GifWriter writes GIF89a with one global colour table, a NETSCAPE
//  loop block (loop for ever) and LZW image data. gifPalette makes the
//  table from the frame colours: the paper, every colour position of the
//  palette (motion.js colourTable) and two paper mixes of each, for the
//  soft edges. quantize maps RGBA pixels to the nearest entry, with a
//  15-bit cache.
//
//  ZIP. zipStore writes a stored (no compression) ZIP of named files with
//  CRC-32, for a PNG frame sequence. PNG data is compressed already.
//
//  grep -n targets: "export function framePlan", "export class GifWriter",
//                   "export function gifPalette", "export function quantize",
//                   "export function zipStore", "export function crc32"
// ============================================================================
import { hexToRgb } from '../pattern-designer/color.js';

export function framePlan(L, fps, loops = 1) {
  const len = L * loops, n = Math.max(1, Math.round(len * fps)), dt = len / n;
  const times = new Float64Array(n), delays = new Uint16Array(n), total = Math.round(len * 100);
  for (let i = 0; i < n; i++) {
    times[i] = (i * dt) % L;
    delays[i] = Math.round((i + 1) * total / n) - Math.round(i * total / n);
  }
  return { n, dt, len, times, delays, total };
}

// ── bytes ──────────────────────────────────────────────────────────────────
class Bytes {
  constructor(n = 1 << 16) { this.b = new Uint8Array(n); this.n = 0; }
  need(k) { if (this.n + k <= this.b.length) return; let m = this.b.length * 2; while (m < this.n + k) m *= 2; const c = new Uint8Array(m); c.set(this.b.subarray(0, this.n)); this.b = c; }
  u8(v) { this.need(1); this.b[this.n++] = v & 255; }
  u16(v) { this.need(2); this.b[this.n++] = v & 255; this.b[this.n++] = (v >>> 8) & 255; }
  u32(v) { this.u16(v & 0xffff); this.u16((v >>> 16) & 0xffff); }
  put(a) { this.need(a.length); this.b.set(a, this.n); this.n += a.length; }
  str(s) { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); }
  done() { return this.b.slice(0, this.n); }
}

// ── GIF ────────────────────────────────────────────────────────────────────
// The colour table: [r, g, b] x 256 in a Uint8Array, and the count used.
export function gifPalette(lut, paper) {
  const seen = new Set(), list = [];
  const add = c => { const k = c[0] << 16 | c[1] << 8 | c[2]; if (seen.has(k) || list.length >= 256) return; seen.add(k); list.push(c); };
  const P = hexToRgb(paper).map(v => Math.round(v * 255));
  const inks = lut.map(h => hexToRgb(h).map(v => Math.round(v * 255)));
  add(P);
  for (const c of inks) add(c);
  for (const u of [1 / 3, 2 / 3]) for (const c of inks) add(c.map((v, i) => Math.round(v + (P[i] - v) * u)));
  const rgb = new Uint8Array(768);
  list.forEach((c, i) => { rgb[3 * i] = c[0]; rgb[3 * i + 1] = c[1]; rgb[3 * i + 2] = c[2]; });
  return { rgb, n: list.length };
}
// RGBA -> table index. cache: an Int16Array(32768) filled with -1, kept
// over the frames of one export.
export function quantize(rgba, pal, cache, out) {
  const T = pal.rgb, N = pal.n;
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], key = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
    let c = cache[key];
    if (c < 0) {
      let best = 1e9;
      for (let k = 0; k < N; k++) { const dr = r - T[3 * k], dg = g - T[3 * k + 1], db = b - T[3 * k + 2], d = 2 * dr * dr + 4 * dg * dg + 3 * db * db; if (d < best) { best = d; c = k; } }
      cache[key] = c;
    }
    out[j] = c;
  }
  return out;
}
export class GifWriter {
  constructor(w, h, pal) {
    this.w = w; this.h = h; this.o = new Bytes(1 << 20); this.frames = 0;
    const o = this.o;
    o.str('GIF89a'); o.u16(w); o.u16(h);
    o.u8(0xf7); o.u8(0); o.u8(0);              // global table of 256, 8 bits
    o.put(pal.rgb);
    o.u8(0x21); o.u8(0xff); o.u8(11); o.str('NETSCAPE2.0'); o.u8(3); o.u8(1); o.u16(0); o.u8(0);
    this.stamp = new Int32Array(1 << 20); this.code = new Int16Array(1 << 20); this.gen = 0;
  }
  frame(idx, delayCs) {
    const o = this.o;
    o.u8(0x21); o.u8(0xf9); o.u8(4); o.u8(0x04); o.u16(Math.max(2, delayCs)); o.u8(0); o.u8(0);
    o.u8(0x2c); o.u16(0); o.u16(0); o.u16(this.w); o.u16(this.h); o.u8(0);
    o.u8(8);
    this.lzw(idx);
    this.frames++;
  }
  lzw(idx) {
    const o = this.o, CLEAR = 256, EOI = 257;
    let size = 9, next = 258, acc = 0, bits = 0, block = new Uint8Array(255), bn = 0;
    const stamp = this.stamp, code = this.code;
    const out = c => {
      acc |= c << bits; bits += size;
      while (bits >= 8) { block[bn++] = acc & 255; acc >>>= 8; bits -= 8; if (bn === 255) { o.u8(255); o.put(block); bn = 0; } }
    };
    const clear = () => { this.gen++; size = 9; next = 258; };
    clear(); out(CLEAR);
    let pre = idx[0];
    for (let i = 1; i < idx.length; i++) {
      const k = idx[i], key = pre << 8 | k;
      if (stamp[key] === this.gen) { pre = code[key]; continue; }
      out(pre);
      if (next < 4096) { stamp[key] = this.gen; code[key] = next++; if (next > (1 << size) && size < 12) size++; }
      else { out(CLEAR); clear(); }
      pre = k;
    }
    out(pre); out(EOI);
    if (bits > 0) { block[bn++] = acc & 255; if (bn === 255) { o.u8(255); o.put(block); bn = 0; } }
    if (bn) { o.u8(bn); o.put(block.subarray(0, bn)); }
    o.u8(0);
  }
  end() { this.o.u8(0x3b); return this.o.done(); }
}

// ── ZIP ────────────────────────────────────────────────────────────────────
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
// files: [{ name, data: Uint8Array }]. A fixed date keeps the bytes the
// same for the same frames.
export function zipStore(files) {
  const o = new Bytes(1 << 20), dir = [], T = 0, D = (2026 - 1980) << 9 | 1 << 5 | 1;
  for (const f of files) {
    const name = Array.from(f.name, ch => ch.charCodeAt(0) & 127), crc = crc32(f.data), at = o.n;
    o.u32(0x04034b50); o.u16(20); o.u16(0); o.u16(0); o.u16(T); o.u16(D); o.u32(crc); o.u32(f.data.length); o.u32(f.data.length); o.u16(name.length); o.u16(0);
    o.put(name); o.put(f.data);
    dir.push({ name, crc, size: f.data.length, at });
  }
  const cd = o.n;
  for (const d of dir) {
    o.u32(0x02014b50); o.u16(20); o.u16(20); o.u16(0); o.u16(0); o.u16(T); o.u16(D); o.u32(d.crc); o.u32(d.size); o.u32(d.size);
    o.u16(d.name.length); o.u16(0); o.u16(0); o.u16(0); o.u16(0); o.u32(0); o.u32(d.at); o.put(d.name);
  }
  const cdLen = o.n - cd;
  o.u32(0x06054b50); o.u16(0); o.u16(0); o.u16(dir.length); o.u16(dir.length); o.u32(cdLen); o.u32(cd); o.u16(0);
  return o.done();
}
export const fmtBytes = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(b < 10240 ? 1 : 0) + ' KB' : (b / 1048576).toFixed(b < 10485760 ? 2 : 1) + ' MB';
