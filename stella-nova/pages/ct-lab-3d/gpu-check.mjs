// ============================================================================
//  CT LAB 3D  ·  gpu-check.mjs — Deno WebGPU check of the page's 3D path
// ----------------------------------------------------------------------------
//  Run: deno run --allow-read --allow-write --unstable-webgpu gpu-check.mjs [pngDir] [ids...]
//  tests.mjs runs it when deno is on PATH. For two objects (or the given ids):
//    1. scan with lib/session.js into view3d's projections (setScanned), then
//       GPU FDK through view3d.reconstructStep; compare with the CPU FDK of
//       the same projections (lib/session.js fdk) -> relative rmse
//    2. render view3d in each look (volume, MIP, planes, scan with gantry) and
//       check the frame is not empty; write PNGs to pngDir when given
//  Prints ok / FAIL / SKIP lines.
// ============================================================================
import { deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { toVolume, presetsFor } from './lib/objects.js';
import { createSession, makeGeometry } from './lib/session.js';
import { createView3D } from '../ct-lab/view3d/index.js';

const here = new URL('.', import.meta.url).pathname;
const out = Deno.args[0] && !Deno.args[0].match(/^[a-z]+$/) ? Deno.args[0] : null;
const ids = Deno.args.filter((a) => /^[a-z]+$/.test(a));
if (out) mkdirSync(out, { recursive: true });
const ok = (c, n, i = '') => console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${i ? '  ' + i : ''}`);
const adapter = await navigator.gpu?.requestAdapter();
if (!adapter) { console.log('SKIP no WebGPU adapter'); Deno.exit(0); }
const device = await adapter.requestDevice();
const errs = [];
device.addEventListener?.('uncapturederror', (e) => errs.push(e.error?.message));

const T = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(t, d) { const b = new Uint8Array(12 + d.length), v = new DataView(b.buffer); v.setUint32(0, d.length); b.set(new TextEncoder().encode(t), 4); b.set(d, 8); v.setUint32(8 + d.length, crc(b.subarray(4, 8 + d.length))); return b; }
function png(path, w, h, rgba) {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const ih = new Uint8Array(13), v = new DataView(ih.buffer); v.setUint32(0, w); v.setUint32(4, h); ih[8] = 8; ih[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array(0))];
  const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  writeFileSync(path, all);
}
const W = 1024, H = 640;   // W*4 must be a multiple of 256 for the read-back copy
const target = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
async function frame(view, name) {
  view.render({ target: target.createView(), width: W, height: H, dt: 0 });
  const rb = device.createBuffer({ size: W * H * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: target }, { buffer: rb, bytesPerRow: W * 4 }, [W, H]);
  device.queue.submit([enc.finish()]);
  await rb.mapAsync(GPUMapMode.READ);
  const px = new Uint8Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy();
  let lit = 0; for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 90) lit++;
  if (out) png(`${out}/${name}.png`, W, H, px);
  return lit / (W * H);
}

const man = JSON.parse(readFileSync(here + 'data/objects.json', 'utf8')).objects;
const pick = ids.length ? man.filter((o) => ids.includes(o.id)) : [man.find((o) => o.id === 'walnut') || man[0], man.find((o) => o.id === 'watch') || man[1]];
let view = null;
for (const o of pick) {
  const vol = toVolume(o, new Uint8Array(readFileSync(here + 'data/' + o.file)), 64);
  const P = presetsFor(o), geom = makeGeometry(vol, 90, 1);
  if (!view) view = createView3D(null, device, { width: W, height: H, format: 'rgba8unorm', volume: vol, preset: P.everything, geom, nAngles: 90, n: 64, colormap: 'bone' });
  else { view.setPreset(P.everything); view.setVolume(vol, { geom, window: P.everything.window }); }
  const s = createSession(o, vol, { nViews: 90, geom, out: view.projections });
  while (s.scanned < 45) s.scan(5);
  view.setScanned(s.scanned);
  view.setShow({ gantry: true, rays: true, table: true, detector: true, volume: 'phantom' });
  view.setCamera({ dist: 9.5, pitch: 0.28, yaw: 0.8 });
  const litScan = await frame(view, `${o.id}-scan`);
  s.scanAll(); view.setScanned(s.scanned);
  let r; do r = await view.reconstructStep({ views: 15 }); while (r.done < r.total);
  const g = view.recon, gpu = new Float32Array(g.data.length); for (let i = 0; i < gpu.length; i++) gpu[i] = g.data[i] * (g.scale || 1);
  const cpu = s.fdk().data;
  let e = 0, m = 0; for (let i = 0; i < cpu.length; i++) { e += (gpu[i] - cpu[i]) ** 2; m = Math.max(m, Math.abs(cpu[i])); }
  const rel = Math.sqrt(e / cpu.length) / (m || 1);
  ok(rel < 1e-3, `${o.id}: GPU FDK = CPU FDK on the page's own projections`, `rmse/peak ${rel.toExponential(2)}`);
  view.setShow({ gantry: false, rays: false, table: false, detector: false, volume: 'auto' });
  view.setCamera({ dist: 2.7, pitch: 0.25, yaw: 0.6 });
  const lits = [litScan];
  for (const mode of ['dvr', 'mip', 'slices']) { view.setMode(mode); lits.push(await frame(view, `${o.id}-${mode}`)); }
  view.setMode('dvr'); if (P.metal) { view.setPreset(P.metal); lits.push(await frame(view, `${o.id}-metal`)); }
  ok(lits.every((l) => l > 0.004), `${o.id}: every view draws something`, lits.map((l) => (l * 100).toFixed(1) + '%').join(' '));
}
ok(errs.length === 0, 'no WebGPU validation errors', errs.slice(0, 2).join(' | '));
view && view.destroy();
device.destroy();
