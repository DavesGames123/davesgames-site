// ============================================================================
//  PLANET FORGE  ·  tests-gpu.mjs — WebGPU checks of render.js (Deno)
// ----------------------------------------------------------------------------
//  Run: deno run -A stella-nova/pages/forge/tests-gpu.mjs
//  Needs navigator.gpu (Deno has it). Each check prints one line; the
//  process exits 1 if a check fails.
//    1. 100 frames create no GPU buffer, bind group or texture.
//    2. The cloud map that render() builds in row slices while the hour
//       moves equals one full dispatch at the final hour.
// ============================================================================
import { createRenderer } from './render.js';
import * as PR from './presets.js';
import { generate } from './maps.js';

let fails = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!cond) fails++; };
const here = new URL('.', import.meta.url);
const loadText = n => Deno.readTextFile(new URL('shaders/' + n, here));
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) { console.log('skip  no WebGPU adapter'); Deno.exit(0); }
const device = await adapter.requestDevice();
let gpuErr = '';
device.addEventListener?.('uncapturederror', e => { gpuErr += e.error.message + '\n'; });
const cnt = { buf: 0, bg: 0, tex: 0 };
for (const [k, f] of [['buf', 'createBuffer'], ['bg', 'createBindGroup'], ['tex', 'createTexture']]) {
  const o = device[f].bind(device); device[f] = d => { cnt[k]++; return o(d); };
}
const W = 640, H = 400;
const tgt = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT });
const view = tgt.createView();
const P = PR.fromPreset('earth', 7), M = generate(P, 256);
const cam = h => ({ pos: [2.6, 0.7, 1.8], target: [0, 0, 0], up: [0, 1, 0], fov: 0.6, w: W, h: H, t: h, exposure: 0.65, sunDir: [1, 0.3, 0.6], spin: h * 0.1, steps: 24, quality: 2, hours: h, cloudsOn: true });

const readMap = async tex => {
  const bpr = Math.ceil(tex.width * 4 / 256) * 256;
  const b = device.createBuffer({ size: bpr * tex.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const e = device.createCommandEncoder(); e.copyTextureToBuffer({ texture: tex }, { buffer: b, bytesPerRow: bpr }, [tex.width, tex.height]);
  device.queue.submit([e.finish()]); await b.mapAsync(GPUMapMode.READ);
  const d = new Uint8Array(b.getMappedRange().slice(0)); b.unmap(); b.destroy(); return d;
};

// 1. no allocation per frame
{
  const R = await createRenderer({ device, format: 'rgba8unorm', loadText });
  R.setPlanet(P, M, {});
  R.render(cam(0), view);
  const c0 = { ...cnt };
  for (let f = 1; f <= 100; f++) R.render(cam(f * 0.0017), view);
  await device.queue.onSubmittedWorkDone();
  const d = { buf: cnt.buf - c0.buf, bg: cnt.bg - c0.bg, tex: cnt.tex - c0.tex };
  ok('render: 100 frames create no buffer, bind group or texture', !d.buf && !d.bg && !d.tex, JSON.stringify(d));

  // 2. slices converge: move the hour for 30 frames, hold it, then compare
  for (let f = 0; f < 30; f++) R.render(cam(5 + f * 0.0017), view);
  const hEnd = 5 + 29 * 0.0017;
  for (let f = 0; f < 10; f++) R.render(cam(hEnd), view);
  const a = await readMap(R.cloudMap);
  const R2 = await createRenderer({ device, format: 'rgba8unorm', loadText });
  R2.setPlanet(P, M, {});
  R2.render(cam(hEnd), view);
  const b = await readMap(R2.cloudMap);
  let diff = 0; for (let i = 0; i < a.length; i++) diff = Math.max(diff, Math.abs(a[i] - b[i]));
  ok('render: the sliced cloud map equals one full dispatch at the final hour', diff === 0, `max byte diff ${diff}`);
  R.destroy(); R2.destroy();
}
ok('render: no GPU validation errors', !gpuErr, gpuErr.trim());
console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
Deno.exit(fails ? 1 : 0);
