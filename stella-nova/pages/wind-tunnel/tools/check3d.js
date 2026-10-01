// check3d.js — headless check of the 3D tunnel (Deno has navigator.gpu).
//   deno run -A tools/check3d.js <shape> <Re> <steps> [outDir]
// Env: NOISE inlet turbulence (default 0.005), NP particles, GRID nx,ny,nz,
//      SLICE axis (0 x, 1 y, 2 z, 3 off), FIELD slice field, SURF 1 = Cp.
// Prints Cd, Cl (means of the second half), MLUPS, and writes w3d_<shape>.png.
// Reference: a sphere at Re 100 has Cd about 1.1 (unconfined, fine grid).
import { createEngine3D } from '../engine3d.js';
import { SHAPES, packShape, defaults, commonDefaults } from '../shapes.js';
import { writePNG, readTex } from './png.js';
const D = new URL('../shaders/', import.meta.url).pathname;
const code = { sdf: Deno.readTextFileSync(D + 'sdf.wgsl'), lbm3d: Deno.readTextFileSync(D + 'lbm3d.wgsl'), view3d: Deno.readTextFileSync(D + 'view3d.wgsl') };
const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize } });
device.addEventListener('uncapturederror', (e) => console.error('GPUERR', e.error.message));
const shape = Deno.args[0] || 'sphere', Re = +(Deno.args[1] || 100), total = +(Deno.args[2] || 8000), out = Deno.args[3] || '.';
const [nx, ny, nz] = (Deno.env.get('GRID') || '160,64,80').split(',').map(Number);
const Wd = 1200, Ht = 700;
const eng = await createEngine3D(device, code, { format: 'rgba8unorm', nx, ny, nz });
const g = Deno.env.get('GROUND') || SHAPES[shape].ground;
const pk = packShape(shape, defaults(shape), commonDefaults(shape), { nx, ny, nz, mode: '3d', ground: g });
const U = 0.08, nu = U * pk.refCells / Re, tau = Math.max(3 * nu + 0.5, +(Deno.env.get('TMIN') || 0.505));
eng.setFlow({ U, tau, noise: +(Deno.env.get('NOISE') || 0.005), ground: { none: 0, fixed: 1, belt: 2 }[g], beltU: U });
eng.setShape(pk.buf); eng.reset();
const tgt = device.createTexture({ size: [Wd, Ht], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
const c = [pk.origin[0] + 10, pk.origin[1] + 8, nz / 2];
const camera = { eye: [c[0] - 45, c[1] + 22, c[2] + 55], target: c, fovY: 0.75 };
const sl = +(Deno.env.get('SLICE') ?? 2);
const cd = [], cl = []; const per = 20; const t0 = performance.now();
const L = pk.scale * SHAPES[shape].fit[0];
for (let f = 0; f < total / per; f++) {
  eng.frame(tgt.createView(), { steps: per, canvas: [Wd, Ht], camera, slice: [sl, sl === 1 ? 6 : nz / 2, +(Deno.env.get('FIELD') || 0), 0.85], surface: +(Deno.env.get('SURF') || 0), refL: pk.refCells, ground: { none: 0, fixed: 1, belt: 2 }[g], vortScale: 0.15, presScale: 1, lineW: 1.6, lineAlpha: 0.9, whiteStreaks: false, particles: +(Deno.env.get('NP') || 8000), mode: 1, life: 400, rakeA: [2, 6, 2, pk.origin[1] + L * 0.8], rakeB: [nz / 2 - L * 0.4, nz / 2 + L * 0.4], time: f / 60 });
  await device.queue.onSubmittedWorkDone(); await new Promise((r) => setTimeout(r, 0));
  const A = eng.stats.area[0] || 1, q = 0.5 * U * U * A;
  cd.push(eng.stats.forces[0] / q); cl.push(eng.stats.forces[1] / q);
}
const ms = performance.now() - t0;
const h = Math.floor(cd.length / 2), mean = (a) => a.reduce((x, y) => x + y) / a.length;
console.log(`${shape} 3D ${nx}x${ny}x${nz} Re=${Re} tau=${tau.toFixed(4)} D=${pk.refCells.toFixed(1)} area=${eng.stats.area[0]} Cd=${mean(cd.slice(h)).toFixed(3)} Cl=${mean(cl.slice(h)).toFixed(3)} MLUPS=${(nx * ny * nz * total / ms / 1000).toFixed(0)} NaN=${cd.some(isNaN)}`);
await writePNG(`${out}/w3d_${shape}.png`, Wd, Ht, await readTex(device, tgt, Wd, Ht));
