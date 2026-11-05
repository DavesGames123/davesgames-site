// ============================================================================
//  SPECTRAL LINES  ·  tools/thumb.mjs — the home thumbnail, no browser
// ----------------------------------------------------------------------------
//  node stella-nova/pages/spectral-lines/tools/thumb.mjs [out.jpg]
//  Draws the stack of all emission spectra in data/lines.js (one row per
//  element, sorted by Z, neutral spectra, 380-750 nm) into a float buffer:
//  each line is a Gaussian core and a soft halo in its CIE colour, then a
//  bloom pass and a tone map. Writes a PNG with node:zlib and calls
//  `magick` for the 640 x 400 JPEG, quality 84.
//  Default output: stella-nova/pages/home/thumbs/spectral-lines.jpg
//
//  grep -n targets
//    line splat ........... "function splat"
//    bloom ................ "function blur"
//    PNG writer ........... "function png"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { wlRGB } from '../saver.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SPECTRA = createRequire(import.meta.url)('../data/lines.js');
const OUT = process.argv[2] || path.resolve(here, '../../home/thumbs/spectral-lines.jpg');
const W = 1280, H = 800, W0 = 380, W1 = 750;
const buf = new Float32Array(W * H * 3);

// Linear light of a display colour (undo the sRGB gamma).
const lin = v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

// One line: a Gaussian across x (sigma s, peak a) over rows y0..y1, with a
// soft fall at the top and bottom of the row.
function splat(x, y0, y1, rgb, a, s) {
  const r = Math.ceil(s * 3), c = rgb.map(lin);
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y++) {
    const fy = Math.min(1, (y - y0 + 0.5) / 1.2, (y1 - y - 0.5) / 1.2);
    if (fy <= 0) continue;
    for (let xi = Math.max(0, Math.floor(x - r)); xi <= Math.min(W - 1, Math.ceil(x + r)); xi++) {
      const d = (xi + 0.5 - x) / s, k = a * fy * Math.exp(-0.5 * d * d), o = (y * W + xi) * 3;
      buf[o] += c[0] * k; buf[o + 1] += c[1] * k; buf[o + 2] += c[2] * k;
    }
  }
}
// Separable box blur, three passes (close to a Gaussian).
function blur(src, rad) {
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < H; y++) for (let ch = 0; ch < 3; ch++) {
      let acc = 0; const row = y * W;
      for (let x = -rad; x <= rad; x++) acc += a[(row + Math.min(W - 1, Math.max(0, x))) * 3 + ch];
      for (let x = 0; x < W; x++) { b[(row + x) * 3 + ch] = acc / (2 * rad + 1); acc += a[(row + Math.min(W - 1, x + rad + 1)) * 3 + ch] - a[(row + Math.max(0, x - rad)) * 3 + ch]; }
    }
    for (let x = 0; x < W; x++) for (let ch = 0; ch < 3; ch++) {
      let acc = 0;
      for (let y = -rad; y <= rad; y++) acc += b[(Math.min(H - 1, Math.max(0, y)) * W + x) * 3 + ch];
      for (let y = 0; y < H; y++) { a[(y * W + x) * 3 + ch] = acc / (2 * rad + 1); acc += b[(Math.min(H - 1, y + rad + 1) * W + x) * 3 + ch] - b[(Math.max(0, y - rad) * W + x) * 3 + ch]; }
    }
  }
  return a;
}
function png(file, rgb8) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; rgb8.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}

// ── scene ─────────────────────────────────────────────────────────────────
const els = SPECTRA.elements;
const PAD = 22, rh = (H - 2 * PAD) / els.length, sx = nm => ((nm - W0) / (W1 - W0)) * W;
for (let i = 0; i < els.length; i++) {
  const e = els[i], s = e.I || e.II; if (!s) continue;
  const y0 = PAD + i * rh + 0.6, y1 = PAD + (i + 1) * rh - 0.6;
  for (const l of s.lines) {
    if (l[0] < W0 - 5 || l[0] > W1 + 5) continue;
    const a = Math.pow(10, 1.2 * (l[1] - 1)), c = wlRGB(Math.min(W1, Math.max(W0, l[0])));
    splat(sx(l[0]), y0, y1, c, 2.2 * a, 0.8);
    splat(sx(l[0]), y0, y1, c, 0.12 * a, 3.5);
  }
}
const bloom = blur(buf, 7);
// a faint continuous spectrum at the top and bottom edges
for (let x = 0; x < W; x++) {
  const c = wlRGB(W0 + (x / W) * (W1 - W0)).map(lin);
  for (const [ya, yb] of [[0, PAD - 8], [H - PAD + 8, H]]) for (let y = ya; y < yb; y++) { const o = (y * W + x) * 3; for (let ch = 0; ch < 3; ch++) buf[o + ch] += 0.12 * c[ch]; }
}
const out = Buffer.alloc(W * H * 3);
const gam = v => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
for (let p = 0; p < W * H; p++) {
  const y = Math.floor(p / W), x = p % W;
  const vx = (x / W - 0.5) * 1.1, vy = (y / H - 0.5) * 1.1, vig = 1 - 0.35 * (vx * vx + vy * vy);
  for (let ch = 0; ch < 3; ch++) {
    const v = (buf[p * 3 + ch] + 0.55 * bloom[p * 3 + ch]) * vig + [0.002, 0.0025, 0.006][ch];
    out[p * 3 + ch] = Math.round(255 * Math.min(1, gam(1 - Math.exp(-1.6 * v))));
  }
}
const tmp = path.join(process.env.TMPDIR || '/tmp', `spectral-thumb-${process.pid}.png`);
png(tmp, out);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
execFileSync('magick', [tmp, '-resize', '640x400', '-quality', '84', OUT]);
fs.unlinkSync(tmp);
console.log(`${els.length} elements -> ${OUT} (${fs.statSync(OUT).size} bytes)`);
