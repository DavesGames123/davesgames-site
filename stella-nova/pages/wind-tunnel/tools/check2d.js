// check2d.js — headless check of the 2D tunnel (Deno has navigator.gpu).
//   deno run -A tools/check2d.js <shape> <Re> <field> <steps> [outDir]
// Env: NOISE inlet turbulence (default 0.01), NP particles, GROUND, TMIN.
// Prints Cd (mean of the second half), Cl rms, St (DFT peak of Cl), MLUPS,
// and writes w2d_<shape>_<field>.png. Reference: cylinder at Re 100 with
// 13.5% blockage gives Cd about 1.45-1.55 and St about 0.18.
import { createEngine2D } from '../engine2d.js';
import { SHAPES, packShape, defaults, commonDefaults } from '../shapes.js';
import { writePNG, readTex } from './png.js';
const D = new URL('../shaders/', import.meta.url).pathname;
const code = { sdf: Deno.readTextFileSync(D + 'sdf.wgsl'), lbm2d: Deno.readTextFileSync(D + 'lbm2d.wgsl'), view2d: Deno.readTextFileSync(D + 'view2d.wgsl') };
const adapter = await navigator.gpu.requestAdapter(); const device = await adapter.requestDevice();
device.addEventListener('uncapturederror', (e) => console.error('GPUERR', e.error.message));
const shape = Deno.args[0] || 'cylinder', Re = +(Deno.args[1] || 100), field = +(Deno.args[2] || 0), total = +(Deno.args[3] || 30000);
const nx = 768, ny = 288, W = 1152, H = 432;
const eng = await createEngine2D(device, code, { format: 'rgba8unorm', nx, ny });
const pk = packShape(shape, defaults(shape), commonDefaults(shape), { nx, ny, nz: 1, mode: '2d', view: "side", ground: Deno.env.get("GROUND") || SHAPES[shape].ground });
const U = 0.08, nu = U * pk.refCells / Re, tau = Math.max(3 * nu + 0.5, +(Deno.env.get("TMIN")||0.5005));
eng.setFlow({ U, tau, noise: +(Deno.env.get("NOISE")||0.01), ground: { none: 0, fixed: 1, belt: 2 }[Deno.env.get("GROUND") || SHAPES[shape].ground], beltU: U });
eng.setShape(pk.buf); eng.reset();
const tgt = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
const cl = []; const cd = [];
const per = 50; let t0 = performance.now();
for (let f = 0; f < total / per; f++) {
  eng.frame(tgt.createView(), { steps: per, canvas: [W, H], offset: [0, 0], cellPx: W / nx, field, refL: pk.refCells, vortScale: 0.25, presScale: 0.8, lineW: 1.5, lineAlpha: 0.8, particles: +(Deno.env.get("NP")||6000), mode: 0, life: 90, rake: [2, 60, 80, 200] });
  await device.queue.onSubmittedWorkDone(); await new Promise((r) => setTimeout(r, 0));
  const A = eng.stats.area[0] || 1, q = 0.5 * U * U * A;
  cd.push(eng.stats.forces[0] / q); cl.push(eng.stats.forces[1] / q);
}
const ms = performance.now() - t0;
const tail = Math.floor(cd.length / 2); const cdm = cd.slice(tail).reduce((a, b) => a + b) / (cd.length - tail);
const c2 = cl.slice(tail); const m = c2.reduce((a, b) => a + b) / c2.length; let zc = 0; for (let i = 1; i < c2.length; i++) if ((c2[i - 1] - m) < 0 && (c2[i] - m) >= 0) zc++;
let best=0,fr=0; for(let fq=1e-5;fq<2e-3;fq+=1e-6){let re=0,im=0;for(let i=0;i<c2.length;i++){const a=2*Math.PI*fq*i*per;re+=(c2[i]-m)*Math.cos(a);im+=(c2[i]-m)*Math.sin(a);} const p=re*re+im*im; if(p>best){best=p;fr=fq;}} const St = fr * pk.refCells / U;
console.log(`${shape} Re=${Re} tau=${tau.toFixed(4)} D=${pk.refCells.toFixed(1)} area=${eng.stats.area[0]} Cd(mean 2nd half)=${cdm.toFixed(3)} Cl rms=${Math.sqrt(c2.reduce((a,b)=>a+(b-m)**2,0)/c2.length).toFixed(3)} St=${St.toFixed(3)} MLUPS=${(nx * ny * total / ms / 1000).toFixed(0)} anyNaN=${cd.some(isNaN)}`);
await writePNG(`${Deno.args[4] || '.'}/w2d_${shape}_${field}.png`, W, H, await readTex(device, tgt, W, H));
