// ct-lab/colormaps/tests.mjs -- node checks for the colour map catalogue.
//   node tests.mjs                 run the checks
//   node tests.mjs --sheet DIR     also write DIR/contact-sheet.png
// The WGSL check runs ~/.cargo/bin/naga when it exists, and skips if not.
import * as M from './maps.js';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

let pass = 0, fail = 0;
function check(name, ok, info = '') {
  if (ok) pass++; else { fail++; console.log(`FAIL ${name} ${info}`); }
}
const Lof = (lut, i) => M.cieL(lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]);
const dE = (lut, i, j) => Math.hypot(lut[i * 3] - lut[j * 3], lut[i * 3 + 1] - lut[j * 3 + 1], lut[i * 3 + 2] - lut[j * 3 + 2]);

const maps = M.list();
check('catalogue has at least 40 maps', maps.length >= 40, maps.length);
check('ids are unique', new Set(maps.map((m) => m.id)).size === maps.length);
for (const g of M.GROUPS) check(`group ${g} has maps`, M.list(g).length > 0);

for (const m of maps) {
  const lut = m.lut;
  check(`${m.id}: lut is Uint8Array of 768`, lut instanceof Uint8Array && lut.length === 768);
  check(`${m.id}: group known`, M.GROUPS.includes(m.group), m.group);
  check(`${m.id}: kind known`, ['sequential', 'diverging', 'cyclic'].includes(m.kind), m.kind);
  check(`${m.id}: has name and use`, !!m.name && !!m.use);
  const L = Array.from({ length: 256 }, (_, i) => Lof(lut, i));
  // No dead flat runs: neighbouring steps must change in some map region.
  let flat = 0;
  for (let i = 1; i < 256; i++) if (dE(lut, i, i - 1) === 0) flat++;
  check(`${m.id}: fewer than 64 repeated steps`, flat < 64, flat);

  if (m.kind === 'sequential' && !m.wavy) {
    const dir = Math.sign(L[255] - L[0]);
    let worst = 0;
    for (let i = 1; i < 256; i++) worst = Math.max(worst, -(L[i] - L[i - 1]) * dir);
    check(`${m.id}: L* monotonic (worst backstep ${worst.toFixed(2)})`, worst < 1.0);
    check(`${m.id}: L* span > 40`, Math.abs(L[255] - L[0]) > 40, (L[255] - L[0]).toFixed(1));
  }
  if (m.kind === 'sequential' && m.wavy) {
    check(`${m.id}: wavy map is not monotonic`, L.some((v, i) => i > 0 && v < L[i - 1] - 0.5));
  }
  if (m.kind === 'cyclic') {
    check(`${m.id}: wraps (first ~ last)`, dE(lut, 0, 255) < 12, dE(lut, 0, 255).toFixed(1));
  }
  if (m.kind === 'diverging') {
    let worst = 0;
    for (let i = 0; i < 128; i++) worst = Math.max(worst, Math.abs(L[i] - L[255 - i]));
    check(`${m.id}: L* symmetric about the middle (worst ${worst.toFixed(1)})`, worst < 10);
    const mid = L[128], ends = (L[0] + L[255]) / 2;
    check(`${m.id}: middle is the lightness extreme`, Math.abs(mid - ends) > 25, (mid - ends).toFixed(1));
  }
}

// Lookups.
check('get(unknown) falls back to grey', M.get('no-such-map').id === 'grey');
check('sample grey 0 is black', M.sample('grey', 0).join() === '0,0,0');
check('sample grey 1 is white', M.sample('grey', 1).join() === '255,255,255');
check('reverse flips ends', M.sample('viridis', 0, { reverse: true }).join() === M.sample('viridis', 1).join());
check('gamma 2 darkens grey middle', M.sample('grey', 0.5, { gamma: 2 })[0] < 100);
check('contrast 2 pushes 0.75 to white', M.sample('grey', 0.75, { contrast: 2 })[0] === 255);
check('NaN sample is safe', M.sample('grey', NaN).length === 3);

// apply() matches sample() for every map and several options.
{
  const N = 1000, src = new Float32Array(N);
  for (let i = 0; i < N; i++) src[i] = -50 + (i / (N - 1)) * 300; // lo=0, hi=200 with overshoot
  let bad = 0;
  for (const m of maps) for (const opts of [{}, { reverse: true }, { gamma: 0.5 }, { gamma: 2.2, contrast: 1.5 }]) {
    const out = M.apply(m.id, src, 0, 200, null, opts);
    for (let i = 0; i < N; i += 7) {
      const s = M.sample(m.id, (src[i] - 0) / 200, opts);
      if (out[i * 4] !== s[0] || out[i * 4 + 1] !== s[1] || out[i * 4 + 2] !== s[2] || out[i * 4 + 3] !== 255) bad++;
    }
  }
  check('apply() matches sample()', bad === 0, `${bad} mismatches`);
  const out = M.apply('grey', new Float32Array([NaN, 1]), 0, 1, null, { nan: [1, 2, 3, 4] });
  check('apply() writes the nan colour', out[0] === 1 && out[3] === 4 && out[4] === 255);
  const z = M.apply('grey', new Float32Array([5]), 5, 5);
  check('apply() with lo == hi does not throw', z[3] === 255);
}

// Swatch strings.
check('cssGradient is a linear-gradient', /^linear-gradient\(90deg, #[0-9a-f]{6} 0\.00%/.test(M.cssGradient('magma')));
{
  const stops = [];
  const ctx = { createLinearGradient: () => ({ addColorStop: (o, c) => stops.push([o, c]) }) };
  M.toCanvasGradient(ctx, 'viridis', 0, 0, 100, 0);
  check('toCanvasGradient adds 33 stops', stops.length === 33 && stops[0][1] === 'rgb(68,1,84)', stops[0]);
}

// lutTexture / lutAtlasTexture with a stub device.
{
  const calls = [];
  const device = {
    createTexture: (d) => ({ desc: d }),
    queue: { writeTexture: (dst, data, layout, size) => calls.push({ dst, data, layout, size }) },
  };
  const t = M.lutTexture(device, 'inferno');
  check('lutTexture is 256x1 rgba8unorm', t.desc.size.width === 256 && t.desc.size.height === 1 && t.desc.format === 'rgba8unorm');
  check('lutTexture usage is TEXTURE_BINDING|COPY_DST', t.desc.usage === 6, t.desc.usage);
  check('lutTexture writes 1024 bytes', calls[0].data.length === 1024 && calls[0].layout.bytesPerRow === 1024);
  t.writeMap('grey', { reverse: true });
  check('writeMap rewrites the texture', calls[1].data[0] === 255 && calls[1].data[3] === 255);
  const a = M.lutAtlasTexture(device, ['grey', 'viridis', 'turbo']);
  check('atlas has one row per map', a.texture.desc.size.height === 3 && a.rows.get('turbo') === 2);
  check('atlas data is 3 rows', calls[2].data.length === 3072);
}

// WGSL snippet through naga, wrapped in a minimal module.
{
  const naga = join(homedir(), '.cargo/bin/naga');
  const mod = `${M.WGSL}
@group(0) @binding(0) var lut: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var atlas: texture_2d<f32>;
@fragment fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let t = cmap_window(p.x, 0.0, 512.0);
  let a = cmap_load(lut, t);
  let b = cmap_sample(lut, samp, t);
  let c = cmap_load_row(atlas, t, 2);
  return vec4<f32>((a + b + c) / 3.0, 1.0);
}
`;
  if (existsSync(naga)) {
    const dir = mkdtempSync(join(tmpdir(), 'cmap-wgsl-'));
    const f = join(dir, 'cmap.wgsl');
    writeFileSync(f, mod);
    let ok = true, msg = '';
    try { execFileSync(naga, [f], { stdio: 'pipe' }); } catch (e) { ok = false; msg = String(e.stderr || e.message); }
    rmSync(dir, { recursive: true, force: true });
    check('WGSL snippet passes naga', ok, msg);
  } else {
    console.log('SKIP naga not found at', naga);
  }
  // Tint refuses mixed operators without parentheses; naga does not. Guard by grep.
  check('WGSL has no && or || or ^', !/&&|\|\||\^/.test(M.WGSL));
}

// ---------------------------------------------------------------- contact sheet
function sheppLogan(n) {
  // Modified Shepp-Logan (Toft): [A, a, b, x0, y0, phi deg].
  const E = [
    [1, 0.69, 0.92, 0, 0, 0], [-0.8, 0.6624, 0.874, 0, -0.0184, 0],
    [-0.2, 0.11, 0.31, 0.22, 0, -18], [-0.2, 0.16, 0.41, -0.22, 0, 18],
    [0.1, 0.21, 0.25, 0, 0.35, 0], [0.1, 0.046, 0.046, 0, 0.1, 0],
    [0.1, 0.046, 0.046, 0, -0.1, 0], [0.1, 0.046, 0.023, -0.08, -0.605, 0],
    [0.1, 0.023, 0.023, 0, -0.606, 0], [0.1, 0.023, 0.046, 0.06, -0.605, 0],
  ];
  const img = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (2 * i) / (n - 1) - 1, y = 1 - (2 * j) / (n - 1);
    let v = 0;
    for (const [A, a, b, x0, y0, p] of E) {
      const c = Math.cos((p * Math.PI) / 180), s = Math.sin((p * Math.PI) / 180);
      const u = (x - x0) * c + (y - y0) * s, w = -(x - x0) * s + (y - y0) * c;
      if ((u * u) / (a * a) + (w * w) / (b * b) <= 1) v += A;
    }
    img[j * n + i] = v;
  }
  return img;
}

function png(w, h, rgbaBytes) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (buf) => { let c = -1; for (const b of buf) c = crcT[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgbaBytes.buffer, rgbaBytes.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const sheetAt = process.argv.indexOf('--sheet');
if (sheetAt > 0) {
  const dir = process.argv[sheetAt + 1];
  mkdirSync(dir, { recursive: true });
  const T = 128, BAR = 14, GAP = 6, LABEL = 16, COLS = 7;
  const rows = Math.ceil(maps.length / COLS);
  const W = COLS * (T + GAP) + GAP, H = rows * (T + BAR + LABEL + 2 * GAP) + GAP;
  const sheet = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { sheet[i * 4] = 24; sheet[i * 4 + 1] = 24; sheet[i * 4 + 2] = 28; sheet[i * 4 + 3] = 255; }
  const phantom = sheppLogan(T);
  // Signed test image for diverging maps: phantom minus its mirror.
  const diff = new Float32Array(T * T);
  for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) diff[j * T + i] = phantom[j * T + i] - phantom[j * T + (T - 1 - ((i + 9) % T))];
  // Angle image for cyclic maps.
  const ang = new Float32Array(T * T);
  for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) ang[j * T + i] = (Math.atan2(j - T / 2, i - T / 2) / (2 * Math.PI) + 1) % 1;
  const ramp = new Float32Array(T * BAR);
  for (let j = 0; j < BAR; j++) for (let i = 0; i < T; i++) ramp[j * T + i] = i / (T - 1);
  const layout = [];
  maps.forEach((m, k) => {
    const cx = GAP + (k % COLS) * (T + GAP), cy = GAP + Math.floor(k / COLS) * (T + BAR + LABEL + 2 * GAP) + LABEL;
    const [img, lo, hi] = m.kind === 'diverging' ? [diff, -0.4, 0.4] : m.kind === 'cyclic' ? [ang, 0, 1] : [phantom, 0, 0.45];
    const tile = M.apply(m.id, img, lo, hi);
    const bar = M.apply(m.id, ramp, 0, 1);
    for (let j = 0; j < T; j++) sheet.set(tile.subarray(j * T * 4, (j + 1) * T * 4), ((cy + j) * W + cx) * 4);
    for (let j = 0; j < BAR; j++) sheet.set(bar.subarray(j * T * 4, (j + 1) * T * 4), ((cy + T + 2 + j) * W + cx) * 4);
    layout.push({ id: m.id, x: cx, y: cy - LABEL + 2 });
  });
  writeFileSync(join(dir, 'contact-sheet.png'), png(W, H, sheet));
  writeFileSync(join(dir, 'contact-sheet.json'), JSON.stringify(layout));
  console.log(`sheet ${W}x${H} -> ${join(dir, 'contact-sheet.png')}`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
