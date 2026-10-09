// ============================================================================
//  THREAD ART  ·  gpu-check.mjs — the WGSL step against the CPU step (Deno)
// ----------------------------------------------------------------------------
//  Run: deno run -A gpu-check.mjs   (tests.mjs runs it when deno is there)
//  Deno has navigator.gpu. For each case, the script runs the greedy step
//  on the CPU (engine.js) and on the GPU (gpu.js + thread.wgsl) from the
//  same start, then compares the peg sequence and the residual. It prints
//  one JSON line per case and exits 1 on a mismatch.
// ============================================================================
import { createRun, targetFrom, shapeImage, stepRun, frameMask, PALETTES } from './engine.js';
import { createThreadGPU } from './gpu.js';

const adapter = await navigator.gpu?.requestAdapter();
if (!adapter) { console.log(JSON.stringify({ skip: 'no WebGPU adapter' })); Deno.exit(0); }
const device = await adapter.requestDevice();
device.addEventListener?.('uncapturederror', e => { console.error('GPU error', e.error?.message); });
const wgsl = await Deno.readTextFile(new URL('./thread.wgsl', import.meta.url));
const gpu = await createThreadGPU(device, wgsl);

const CASES = [
  { name: 'mono-circle', res: 64, shape: 'circle', P: 48, color: false, dark: false, img: 'eye', steps: 120, seed: 3 },
  { name: 'colour-square', res: 72, shape: 'square', P: 56, color: true, dark: false, img: 'star', steps: 150, seed: 11 },
  { name: 'colour-hex-dark', res: 80, shape: 'hexagon', P: 60, color: true, dark: true, img: 'rings', steps: 150, seed: 5 },
  { name: 'mono-to-done', res: 40, shape: 'circle', P: 30, color: false, dark: false, img: 'moon', steps: 4000, seed: 9, alpha: 0.15 },
];
let bad = 0;
for (const c of CASES) {
  const mask = frameMask(c.shape, c.res);
  const T = targetFrom(shapeImage(c.img, c.res), c.res, { color: c.color, dark: c.dark, mask });
  const cfg = { res: c.res, shape: c.shape, P: c.P, color: c.color, dark: c.dark, alpha: c.alpha || 0.25, seed: c.seed, maxLines: c.steps,
    colors: c.color ? PALETTES.cmyk[c.dark ? 'dark' : 'light'] : PALETTES.mono[c.dark ? 'dark' : 'light'] };
  const cpu = createRun(cfg, T);
  while (stepRun(cpu));
  const g = createRun(cfg, T);
  gpu.load(g);
  let left = c.steps;
  while (left > 0 && !g.done) {
    const n = gpu.steps(Math.min(37, left));
    left -= n;
    await gpu.sync();
    if (!n) break;
  }
  await gpu.sync();
  const resid = await gpu.readResidual();
  let seqSame = cpu.lines.length === g.lines.length, firstDiff = -1;
  for (let i = 0; i < Math.min(cpu.lines.length, g.lines.length); i++) {
    const a = cpu.lines[i], b = g.lines[i];
    if (a.k !== b.k || a.a !== b.a || a.b !== b.b) { seqSame = false; firstDiff = i; break; }
  }
  let residDiff = 0;
  for (let i = 0; i < resid.length; i++) if (resid[i] !== cpu.residual[i]) residDiff++;
  const ok = seqSame && residDiff === 0;
  if (!ok) bad++;
  console.log(JSON.stringify({ case: c.name, ok, cpuLines: cpu.lines.length, gpuLines: g.lines.length, cpuDone: cpu.done, gpuDone: g.done, firstDiff, residDiff }));
}
gpu.destroy();
Deno.exit(bad ? 1 : 0);
