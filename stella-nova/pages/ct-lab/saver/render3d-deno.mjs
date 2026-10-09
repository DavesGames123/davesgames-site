// saver/render3d-deno.mjs - Deno WebGPU check of the two 3D saver shots with the real view3d.
// Run: deno run -A stella-nova/pages/ct-lab/saver/render3d-deno.mjs [outDir]
// It plays cone-scan and cone-volume offscreen (960x600, a plate band of 150 px top and
// 165 px bottom), writes frames at 30%, 60% and 95% of each shot, and prints ok/FAIL lines.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createView3D } from '../view3d/index.js';
import { makeShot } from './shots.js';

const out = Deno.args[0];
if (out) mkdirSync(out, { recursive: true });
const ok = (c, n, i = '') => console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${i ? '  ' + i : ''}`);
const adapter = await navigator.gpu?.requestAdapter();
if (!adapter) { console.log('skip: no WebGPU adapter'); Deno.exit(0); }

const W = 960, H = 600, band = { t: 150, b: 165 };
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

for (const [kind, seed] of [['cone-scan', 3], ['cone-scan', 8], ['cone-volume', 5], ['cone-volume', 12]]) {
  const device = await adapter.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize } });
  const errs = []; device.addEventListener?.('uncapturederror', (e) => errs.push(e.error?.message));
  const target = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  let released = false, view = null;
  const env = {
    phone: false, now: () => performance.now(), lab: null, makeCanvas: null,
    make3D: async (o) => {
      view = createView3D(null, device, { ...o, width: W, height: H, format: 'rgba8unorm', interactive: false });
      const r0 = view.render.bind(view);
      view.render = (q = {}) => r0({ ...q, target: target.createView(), width: W, height: H });
      return { view, release() { view.destroy(); released = true; } };
    },
  };
  const shot = makeShot({ kind, fam: '3d', dur: 9, seed, index: 0 }, env);
  const t0 = performance.now();
  await shot.init();
  const tInit = performance.now() - t0;
  const marks = [0.3, 0.6, 0.95]; let mi = 0, lit = [], worst = 0;
  for (let t = 0; t < shot.dur; t += 1 / 30) {
    const f0 = performance.now();
    shot.tick(1 / 30);
    await new Promise((r) => setTimeout(r, 0));
    shot.render(1 / 30, band, W, H);
    worst = Math.max(worst, performance.now() - f0);
    if (mi < marks.length && t / shot.dur >= marks[mi]) {
      const rb = device.createBuffer({ size: W * H * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder();
      enc.copyTextureToBuffer({ texture: target }, { buffer: rb, bytesPerRow: W * 4 }, [W, H]);
      device.queue.submit([enc.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      const px = new Uint8Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy();
      let l = 0, yMin = H, yMax = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 150) { l++; const y = Math.floor(i / 4 / W); yMin = Math.min(yMin, y); yMax = Math.max(yMax, y); }
      lit.push(`${(100 * l / (W * H)).toFixed(1)}% y ${yMin}-${yMax}`);
      if (out) png(`${out}/${kind}-${seed}-${mi}.png`, W, H, px);
      mi++;
    }
  }
  const st = view.state;
  shot.dispose();
  await device.queue.onSubmittedWorkDone();
  ok(errs.length === 0, `${kind} seed ${seed}: no WebGPU validation errors`, errs.slice(0, 2).join(' | '));
  ok(kind === 'cone-volume' || (st.scanned === st.total && st.reconstructed === st.total), `${kind} seed ${seed}: scan ${st.scanned}/${st.total}, FDK ${st.reconstructed}, mode ${st.mode}`);
  ok(released, `${kind} seed ${seed}: dispose releases the view`, `init ${tInit.toFixed(0)} ms, worst frame ${worst.toFixed(0)} ms, lit ${lit.join(', ')}`);
  device.destroy();
}
