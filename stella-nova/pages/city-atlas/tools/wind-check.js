// wind-check.js — headless checks of the wind solver (wind.js + shaders/lbm.wgsl).
// Deno has navigator.gpu, so the real WGSL runs on the real GPU.
//   deno run -A tools/wind-check.js [--json]
//
// 1. Mass: the coarse lattice as a closed box (every edge cell a wall, no
//    force, no sponge), started with a swirl. Total mass after 3000 steps
//    must equal the start within 1e-4 (relative). Halfway bounce-back and
//    BGK collision both keep the population sum per cell pair, so only the
//    float rounding is left.
// 2. Wake: flat ground, one square block 100 m wide and 60 m tall in the
//    middle of the fine lattice, wind 5 m/s from the west. After the start
//    burst and 4000 more steps, the mean streamwise speed from 1 to 3 block
//    widths behind the block must be under 0.6 of the free stream, and the
//    cross-stream speed 3 widths behind it must swing (vortex shedding):
//    its standard deviation over the last 2000 steps above 0.03 U.
// Prints the numbers, and a JSON line with --json (tests.mjs reads it).
//
// grep: async function massCheck  async function wakeCheck  function half2f

import { createWind } from '../wind.js';

const D = new URL('../shaders/', import.meta.url).pathname;
const code = { lbm: Deno.readTextFileSync(D + 'lbm.wgsl') };
const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();
const gpuErrors = [];
device.addEventListener('uncapturederror', (e) => { gpuErrors.push(e.error.message); console.error('GPUERR', e.error.message); });
const T = GPUTextureUsage;

function tex(w, h, format, data, bpp) {
  const t = device.createTexture({ size: [w, h], format, usage: T.TEXTURE_BINDING | T.COPY_DST });
  device.queue.writeTexture({ texture: t }, data, { bytesPerRow: w * bpp }, [w, h]);
  return t;
}

function half2f(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

async function readMacro(t, N) {
  const bpr = Math.ceil(N * 8 / 256) * 256;
  const b = device.createBuffer({ size: bpr * N, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const e = device.createCommandEncoder();
  e.copyTextureToBuffer({ texture: t }, { buffer: b, bytesPerRow: bpr }, [N, N]);
  device.queue.submit([e.finish()]);
  await b.mapAsync(GPUMapMode.READ);
  const u16 = new Uint16Array(b.getMappedRange().slice(0));
  b.unmap(); b.destroy();
  const out = new Float32Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N * 4; x++) out[y * N * 4 + x] = half2f(u16[y * bpr / 2 + x]);
  return out;
}

function flatCity(bN, bHalf, block) {
  const hIn = tex(64, 64, 'rgba32float', new Float32Array(64 * 64 * 4), 16);
  const hOut = tex(32, 32, 'rgba32float', new Float32Array(32 * 32 * 4), 16);
  const rough = tex(64, 64, 'rg8unorm', new Uint8Array(64 * 64 * 2), 2);
  const b = new Float32Array(bN * bN);
  if (block) {
    const cell = 2 * bHalf / bN;
    for (let j = 0; j < bN; j++) for (let i = 0; i < bN; i++) {
      const x = -bHalf + (i + 0.5) * cell, y = -bHalf + (j + 0.5) * cell;
      if (Math.abs(x) < block.w / 2 && Math.abs(y) < block.w / 2) b[j * bN + i] = block.h;
    }
  }
  const bTex = tex(bN, bN, 'r32float', b, 4);
  return { hIn, hOut, rough, bTex, gHalfIn: 6000, gHalfOut: 32000, bHalf, fHalf: 1000, block: 150 };
}

async function massCheck() {
  const wind = await createWind(device, code, { coarseN: 128, fineN: 64 });
  wind.setCity(flatCity(64, 1000, null));
  await device.queue.onSubmittedWorkDone();
  const [before, after] = await wind.massTest(3000);
  wind.destroy();
  return { before, after, rel: Math.abs(after - before) / before };
}

async function wakeCheck() {
  const FN = 192;
  const wind = await createWind(device, code, { coarseN: 128, fineN: FN, fineSteps: 10, coarseSteps: 4 });
  const blockW = 100;
  wind.setCity(flatCity(512, 1000, { w: blockW, h: 60 }));
  wind.set({ dirFrom: 270, speed: 5, slice: 12, seaBreeze: 0 });
  // the start burst (spread over frames in the page) plus 4000 steps: 400 frames of 10
  const probes = [];
  const cell = 2000 / FN;
  const px = Math.round((1000 + 3 * blockW) / cell), py = Math.round(1000 / cell);
  for (let f = 0; f < 420; f++) {
    const e = device.createCommandEncoder();
    wind.step(e);
    device.queue.submit([e.finish()]);
    if (f >= 220 && f % 4 === 0) {
      const m = await readMacro(wind.fineTex, FN);
      probes.push(m[(py * FN + px) * 4 + 1]);
    } else if (f % 20 === 0) await device.queue.onSubmittedWorkDone();
  }
  const m = await readMacro(wind.fineTex, FN);
  const U = wind.U;
  let free = 0, nf = 0, wake = 0, nw = 0, nan = 0;
  for (let j = 0; j < FN; j++) for (let i = 0; i < FN; i++) {
    const x = -1000 + (i + 0.5) * cell, y = -1000 + (j + 0.5) * cell;
    const ux = m[(j * FN + i) * 4];
    if (!Number.isFinite(ux)) nan++;
    if (x > -800 && x < -500 && Math.abs(y) < 300) { free += ux; nf++; }
    if (x > blockW * 1.0 && x < blockW * 3.0 && Math.abs(y) < blockW * 0.4) { wake += ux; nw++; }
  }
  const mean = probes.reduce((a, b) => a + b, 0) / probes.length;
  const sd = Math.sqrt(probes.reduce((a, b) => a + (b - mean) ** 2, 0) / probes.length);
  wind.destroy();
  return { free: free / nf / U, wake: wake / nw / U, ratio: (wake / nw) / (free / nf), shedSd: sd / U, nan, samples: probes.length };
}

const mass = await massCheck();
const wake = await wakeCheck();
console.log(`mass: before ${mass.before.toFixed(3)} after ${mass.after.toFixed(3)} relative change ${mass.rel.toExponential(2)} (limit 1e-4)`);
console.log(`wake: free stream ${wake.free.toFixed(3)} U, wake ${wake.wake.toFixed(3)} U, ratio ${wake.ratio.toFixed(3)} (limit 0.6), cross-stream sd ${wake.shedSd.toFixed(3)} U (limit 0.03) over ${wake.samples} samples, NaN cells ${wake.nan}`);
const ok = mass.rel < 1e-4 && wake.ratio < 0.6 && wake.shedSd > 0.03 && wake.nan === 0 && !gpuErrors.length;
if (Deno.args.includes('--json')) console.log(JSON.stringify({ ok, mass, wake, gpuErrors }));
Deno.exit(ok ? 0 : 1);
