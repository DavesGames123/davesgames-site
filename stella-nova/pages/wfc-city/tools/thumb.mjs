// ============================================================================
//  COLLAPSE CITY  ·  tools/thumb.mjs — the home thumbnail, no browser
// ----------------------------------------------------------------------------
//  node stella-nova/pages/wfc-city/tools/thumb.mjs [out.jpg] [seed]
//  Loads pkg/ in node, collapses the city round the origin, meshes the
//  chunks and draws them with a CPU rasteriser: z-buffer, flat sun light,
//  hemisphere ambient, a sky gradient and distance fog. Supersamples 2x,
//  writes a PNG with node:zlib and calls `magick` for the 640 x 400 JPEG,
//  quality 84. Default output: stella-nova/pages/home/thumbs/wfc-city.jpg
//
//  grep -n targets
//    camera ............... "function look"
//    triangle fill ........ "function tri"
//    PNG writer ........... "function png"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || path.resolve(here, '../../home/thumbs/wfc-city.jpg');
const SEED = Number(process.argv[3] || 31);
const pkg = await import(path.join(here, '..', 'pkg', 'wfc_city.js'));
await pkg.default({ module_or_path: fs.readFileSync(path.join(here, '..', 'pkg', 'wfc_city_bg.wasm')) });

const w = new pkg.World(SEED, 12);
for (let n = 0; n < 4000; n++) if (!w.update(0, 2, 0, 40, 2000)) break;
const pal = w.palette();
const meshes = [];
for (let cz = -6; cz <= 5; cz++) for (let cx = -6; cx <= 5; cx++) { const m = w.chunk_mesh(cx, cz); if (m.length) meshes.push(m); }

const SS = 2, W = 640 * SS, H = 400 * SS;
const col = new Float32Array(W * H * 3), zb = new Float32Array(W * H).fill(Infinity);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// camera: high three-quarter view over the city, looking at the origin
function look(eye, at) {
  const f = norm(sub(at, eye)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  return { eye, f, r, u };
}
const cam = look([-46, 42, 54], [2, 4, -4]);
const fy = 1 / Math.tan((40 * Math.PI / 180) / 2), aspect = W / H;
const sun = norm([0.55, 0.8, 0.35]);
const sky = (t) => { const a = [0.56, 0.74, 0.95], b = [0.93, 0.86, 0.76]; return [b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t, b[2] + (a[2] - b[2]) * t]; };
for (let y = 0; y < H; y++) { const c = sky(Math.min(1, Math.max(0, 1.2 - (y / H) * 1.6))); for (let x = 0; x < W; x++) col.set(c, (y * W + x) * 3); }
const fogC = [0.86, 0.85, 0.82];

function proj(p) {
  const d = sub(p, cam.eye), z = dot(d, cam.f);
  if (z < 0.1) return null;
  return [(dot(d, cam.r) / z * fy / aspect * 0.5 + 0.5) * W, (0.5 - dot(d, cam.u) / z * fy * 0.5) * H, z];
}
function tri(a, b, c, rgb) {
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < 1e-9) return;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5, py = y + 0.5;
    const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
    const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
    const w2 = 1 - w0 - w1;
    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
    const iz = w0 / a[2] + w1 / b[2] + w2 / c[2], z = 1 / iz, i = y * W + x;
    if (z >= zb[i]) continue;
    zb[i] = z;
    const fog = 1 - Math.exp(-Math.max(0, z - 40) / 90);
    col[i * 3] = rgb[0] + (fogC[0] - rgb[0]) * fog;
    col[i * 3 + 1] = rgb[1] + (fogC[1] - rgb[1]) * fog;
    col[i * 3 + 2] = rgb[2] + (fogC[2] - rgb[2]) * fog;
  }
}
let tris = 0;
for (const m of meshes) for (let t = 0; t < m.length; t += 24) {
  const pa = proj([m[t], m[t + 1], m[t + 2]]), pb = proj([m[t + 8], m[t + 9], m[t + 10]]), pc = proj([m[t + 16], m[t + 17], m[t + 18]]);
  if (!pa || !pb || !pc) continue;
  const n = [m[t + 3], m[t + 4], m[t + 5]], ci = m[t + 6] | 0;
  const base = [pal[ci * 3], pal[ci * 3 + 1], pal[ci * 3 + 2]];
  const lam = Math.max(0, dot(n, sun)), amb = 0.42 + 0.18 * n[1];
  const rgb = base.map((v, k) => v * (lam * [1.0, 0.94, 0.84][k] * 1.05 + amb * [0.62, 0.7, 0.85][k]));
  tri(pa, pb, pc, rgb); tris++;
}
// tone map, gamma and 2x box downsample
const OW = 640, OH = 400, img = Buffer.alloc(OH * (OW * 3 + 1));
const enc = v => Math.round(255 * Math.min(1, Math.pow(v / (1 + v * 0.25) * 1.25, 1 / 2.2)));
for (let y = 0; y < OH; y++) {
  img[y * (OW * 3 + 1)] = 0;
  for (let x = 0; x < OW; x++) for (let k = 0; k < 3; k++) {
    let s = 0; for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) s += col[((y * SS + dy) * W + x * SS + dx) * 3 + k];
    img[y * (OW * 3 + 1) + 1 + x * 3 + k] = enc(s / (SS * SS));
  }
}
function png(w, h, raw) {
  const crc = b => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const hd = Buffer.alloc(13); hd.writeUInt32BE(w, 0); hd.writeUInt32BE(h, 4); hd[8] = 8; hd[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', hd), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const tmp = OUT.replace(/\.jpg$/, '.tmp.png');
fs.writeFileSync(tmp, png(OW, OH, img));
execFileSync('magick', [tmp, '-quality', '84', OUT]);
fs.unlinkSync(tmp);
console.log(`thumb: ${meshes.length} chunks, ${tris} triangles, collapsed ${w.counter()} -> ${OUT}`);
