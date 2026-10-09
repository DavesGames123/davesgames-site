// ============================================================================
//  PLANET FORGE  ·  deno-studio.js — the studio render path under Deno WebGPU
// ----------------------------------------------------------------------------
//  No browser: Deno has navigator.gpu (Metal on a Mac). This script drives
//  studio-core.js with the renderer of the page and the generator on the
//  main thread (maps.js generate).
//
//    deno run -A deno-studio.js check <outDir>
//        6 random planets at 1024 px (tile 512) and one at 4096 px (tile
//        1024, 16 tiles); prints the GPU errors (uncaptured and scoped)
//        and the PNG sizes; exit 1 on an error
//    deno run -A deno-studio.js sheet <mode|old-gas|old-rocky> <n> <px> <outDir> [seed]
//        n planets of a randomize.js mode (or the old gas or rocky
//        presets) at px, one PNG each, for a contact sheet
//  outDir must exist. Map width: 256 for px <= 384, else studio-core.js.
// ============================================================================
import * as SC from './studio-core.js';
import * as MP from './maps.js';
import * as PR from './presets.js';

const here = new URL('.', import.meta.url);
const loadText = name => Deno.readTextFile(new URL('shaders/' + name, here));
const [cmd, ...args] = Deno.args;

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();
const errors = [];
device.addEventListener('uncapturederror', e => errors.push(e.error.message));

async function runJobs(jobs, tile, outDir, small) {
  const run = await SC.createRun({ device, loadText, tile });
  const ctx = { run, env: { deviceMemory: 16 }, maxRes: 4096, generate: (P, W) => MP.generate(P, small ? 256 : W) };
  const out = [];
  for (let i = 0; i < jobs.length; i++) {
    const t0 = performance.now();
    try {
      const res = await SC.renderJob(ctx, jobs[i]);
      const name = `${outDir}/${String(i).padStart(3, '0')}-${jobs[i].planet.preset}.png`;
      await Deno.writeFile(name, res.png);
      out.push(res);
      console.log(`${name}  ${res.w}x${res.h}  ${(res.png.length / 1e6).toFixed(2)} MB  exposure ${res.recipe.render.exposure}  ${Math.round(performance.now() - t0)} ms`);
    } catch (e) { errors.push(`job ${i}: ${e.message}`); console.log(`job ${i} failed: ${e.message}`); }
  }
  SC.destroyRun(run);
  return out;
}

if (cmd === 'check') {
  const outDir = args[0];
  const jobs = SC.makeJobs({ source: 'random', mode: 'any', n: 6, seed: 4242, render: { res: 1024, background: 'stars' }, matchAll: false });
  jobs[1].render.background = 'transparent';
  await runJobs(jobs, 512, outDir);
  const big = SC.makeJobs({ source: 'random', mode: 'gas', n: 1, seed: 77, render: { res: 4096, framing: 'disc', background: 'black' }, matchAll: true });
  console.log('4096 tiles:', SC.planTiles(4096, 4096, 1024).length);
  await runJobs(big, 1024, outDir);
  await device.queue.onSubmittedWorkDone();
  console.log(errors.length ? 'GPU errors:\n' + errors.join('\n') : 'no GPU validation errors');
  Deno.exit(errors.length ? 1 : 0);
} else if (cmd === 'sheet') {
  const [mode, n, px, outDir, seed = '1000'] = args;
  let jobs;
  if (mode.startsWith('old-')) {
    const ids = PR.PRESETS.filter(p => p.kind === (mode === 'old-gas' ? 'gas' : 'rocky') && !p.gen).map(p => p.id);
    jobs = SC.makeJobs({ source: 'list', list: Array.from({ length: +n }, (_, i) => PR.fromPreset(ids[i % ids.length], +seed + i)), render: { res: +px }, matchAll: true });
  } else jobs = SC.makeJobs({ source: 'random', mode, n: +n, seed: +seed, render: { res: +px }, matchAll: true });
  await runJobs(jobs, 512, outDir, +px <= 384);
  console.log(errors.length ? 'GPU errors:\n' + errors.join('\n') : 'no GPU validation errors');
} else console.log('usage: check <outDir> | sheet <mode> <n> <px> <outDir> [seed]');
