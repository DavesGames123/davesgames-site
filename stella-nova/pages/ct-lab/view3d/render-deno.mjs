// view3d/render-deno.mjs - Deno WebGPU render check for the 3D cone-beam view.
// Run: deno run -A render-deno.mjs [outDir]
// It renders each mode to PNG files in outDir (when given), checks that the chunked
// GPU FDK matches the engine's CPU FDK, and prints "ok"/"FAIL" lines.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import * as CT from '../engine/index.js';
import { createView3D } from './index.js';

const out = Deno.args[0];
if (out) mkdirSync(out, { recursive: true });
const ok = (c, n, i = '') => console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${i ? '  ' + i : ''}`);

const adapter = await navigator.gpu?.requestAdapter();
if (!adapter) { console.log('skip: no WebGPU adapter'); Deno.exit(0); }
const device = await adapter.requestDevice({
  requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize },
});
const errs = [];
device.addEventListener?.('uncapturederror', (e) => errs.push(e.error?.message));

const W = 960, H = 600;
const T = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(t, d) {
  const b = new Uint8Array(12 + d.length), v = new DataView(b.buffer);
  v.setUint32(0, d.length); b.set(new TextEncoder().encode(t), 4); b.set(d, 8);
  v.setUint32(8 + d.length, crc(b.subarray(4, 8 + d.length))); return b;
}
function png(path, w, h, rgba) {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const ih = new Uint8Array(13), v = new DataView(ih.buffer);
  v.setUint32(0, w); v.setUint32(4, h); ih[8] = 8; ih[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array(0))];
  const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  writeFileSync(path, all);
}

const target = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
async function shot(view, name) {
  view.render({ target: target.createView(), width: W, height: H, dt: 0 });
  const rb = device.createBuffer({ size: W * H * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: target }, { buffer: rb, bytesPerRow: W * 4 }, [W, H]);
  device.queue.submit([enc.finish()]);
  await rb.mapAsync(GPUMapMode.READ);
  const px = new Uint8Array(rb.getMappedRange().slice(0));
  rb.unmap(); rb.destroy();
  let lit = 0, sum = 0;
  for (let i = 0; i < px.length; i += 4) { const l = px[i] + px[i + 1] + px[i + 2]; sum += l; if (l > 150) lit++; }
  if (out) png(`${out}/${name}.png`, W, H, px);
  return { lit: lit / (W * H), mean: sum / (3 * W * H) };
}

const t0 = performance.now();
const view = createView3D(null, device, { width: W, height: H, format: 'rgba8unorm', phantom: 'head', n: 96, nAngles: 180 });
console.log(`time create + head phantom 96^3: ${(performance.now() - t0).toFixed(0)} ms`);
let t = performance.now();
for (let k = 0; k < 40; k++) view.scanStep();
console.log(`time scan 40 views at 96^3 (CPU): ${(performance.now() - t).toFixed(0)} ms`);
view.setCamera({ yaw: 0.85, pitch: 0.3, dist: 10.5 });
const stats = {};
for (const m of ['dvr', 'iso', 'mip', 'slices']) { view.setMode(m); stats['scan-' + m] = await shot(view, `head-scan-${m}`); }
view.setCamera({ dist: 2.6, pitch: 0.25 });
view.setShow({ gantry: false, table: false, rays: false, detector: false });
for (const m of ['dvr', 'iso', 'mip', 'slices']) { view.setMode(m); stats['close-' + m] = await shot(view, `head-close-${m}`); }
for (const [k, s] of Object.entries(stats)) ok(s.lit > 0.002 && s.mean > 2, `render ${k} has content`, `lit ${(100 * s.lit).toFixed(2)}%, mean ${s.mean.toFixed(1)}`);

// full scan and chunked GPU FDK, then compare with the engine's CPU FDK
t = performance.now();
while (view.scanStep({ views: 10 }).done < view.state.total);
console.log(`time scan 180 views at 96^3 (CPU): ${(performance.now() - t).toFixed(0)} ms`);
t = performance.now();
let r;
const mid = [];
while ((r = await view.reconstructStep({ views: 12 })).done < r.total) { mid.push(r.rmse); if (r.done === 36) { view.setMode('slices'); await shot(view, 'head-recon-partial-slices'); } }
console.log(`time reconstruct 180 views at 96^3 (GPU, 12 per step): ${(performance.now() - t).toFixed(0)} ms`);
ok(r.rmse < mid[0], 'rmse falls as views are added', `first ${mid[0].toFixed(4)}, final ${r.rmse.toFixed(4)} /cm`);
const g = view.geometry, vol = view.volume;
const cpu = CT.fdk(view.projections, g, { nx: vol.nx, ny: vol.ny, nz: vol.nz, width: vol.width }, { filter: 'shepp-logan' });
const rec = view.recon;
let mx = 0, ref = 0;
for (let i = 0; i < cpu.data.length; i++) { mx = Math.max(mx, Math.abs(cpu.data[i] - rec.data[i] * rec.scale)); ref = Math.max(ref, Math.abs(cpu.data[i])); }
ok(mx / ref < 1e-3, 'chunked GPU FDK matches the CPU fdk()', `max rel err ${(mx / ref).toExponential(2)}`);
ok(r.rmse < 0.05, 'FDK rmse against the phantom', `${r.rmse.toFixed(4)} /cm (soft tissue ~0.19)`);
view.setShow({ gantry: true, table: true, rays: true, detector: true });
view.setCamera({ dist: 10.5, yaw: 2.3, pitch: 0.4 });
for (const m of ['dvr', 'iso']) { view.setMode(m); await shot(view, `head-recon-${m}`); }
view.setShow({ gantry: false, table: false, rays: false, detector: false });
view.setCamera({ dist: 2.6, yaw: 0.6, pitch: 0.25 });
for (const m of ['dvr', 'slices', 'mip']) { view.setMode(m); await shot(view, `head-recon-close-${m}`); }

// colour maps: the recon in two maps, mip and dvr with the transfer function colour from the map
for (const [id, o] of [['magma', {}], ['ice', { reverse: false, gamma: 0.8 }]]) {
  view.setColormap(id, { ...o, tf: true });
  const c = view.colormap;
  ok(c.id === id && c.tf === true, `setColormap(${id}) sets the map and tf`);
  for (const m of ['mip', 'dvr']) { view.setMode(m); stats[`map-${id}-${m}`] = await shot(view, `head-recon-map-${id}-${m}`); }
}
{
  const a = stats['map-magma-dvr'], b = stats['map-ice-dvr'];
  ok(a && b && Math.abs(a.mean - b.mean) > 0.5, 'dvr colour changes with the map', `mean ${a?.mean.toFixed(1)} vs ${b?.mean.toFixed(1)}`);
}
view.setColormap('bone', { tf: false });

for (const ph of ['chest', 'shepp-logan']) {
  view.setPhantom3D(ph, { n: 96 });
  for (let k = 0; k < 60; k++) view.scanStep();
  view.setShow({ gantry: true, table: true, rays: true, detector: true });
  view.setCamera({ dist: 10.5, yaw: 0.9, pitch: 0.35 });
  view.setMode('dvr'); await shot(view, `${ph}-scan-dvr`);
  view.setShow({ gantry: false, table: false, rays: false, detector: false });
  view.setCamera({ dist: 2.6, yaw: 0.7, pitch: 0.3 });
  view.setMode('iso'); await shot(view, `${ph}-close-iso`);
  view.setMode('dvr'); await shot(view, `${ph}-close-dvr`);
}
await device.queue.onSubmittedWorkDone();
ok(errs.length === 0, 'no WebGPU validation errors', errs.slice(0, 3).join('; '));
view.destroy();
target.destroy();
device.destroy();
