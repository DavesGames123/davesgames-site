// ============================================================================
//  CORRUPTION  ·  tools/render-check.mjs — render frames offscreen in Deno
// ----------------------------------------------------------------------------
//  Deno has navigator.gpu (wgpu, not a browser). This script builds the
//  real renderer from gpu.js, draws one frame per case into an rgba8unorm
//  texture and writes PNG files. It also prints the mean colour and the
//  share of red pixels of each frame, so a black or a clean frame shows as a
//  number. wgpu validates with naga, not Tint: a pass here does not prove
//  that Chrome or Safari accept the shader.
//
//  Run:  deno run -A stella-nova/pages/corruption/tools/render-check.mjs <outDir> [w] [h]
// ============================================================================
import { buildModule, createRenderer } from '../gpu.js';
import { MODELS, torusKnot, hullPod, bench, fitMesh, sampleSurface } from '../models.js';
import { defaults, shuffle, packUniforms, rng } from '../params.js';
import { orbitCamera } from '../camera.js';

const here = new URL('../', import.meta.url);
const out = Deno.args[0] || '.';
const W = +(Deno.args[1] || 640), H = +(Deno.args[2] || 400);
const pack = await Deno.readTextFile(new URL('../sdf-solids-table/shaders/pack.wgsl', here));
const page = await Deno.readTextFile(new URL('shaders/corruption.wgsl', here));

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();
device.addEventListener?.('uncapturederror', e => console.log('GPU error:', e.error.message));
const R = await createRenderer(device, { code: buildModule(pack, page), format: 'rgba8unorm' });
R.resize(W, H);
const tex = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
const bpr = Math.ceil(W * 4 / 256) * 256;
const rb = device.createBuffer({ size: bpr * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
async function png(rgba, w, h) {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1); }
  const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const chunk = (t, d) => { const b = new Uint8Array(12 + d.length), v = new DataView(b.buffer); v.setUint32(0, d.length); b.set(new TextEncoder().encode(t), 4); b.set(d, 8); v.setUint32(8 + d.length, crc(b.subarray(4, 8 + d.length))); return b; };
  const ih = new Uint8Array(13), iv = new DataView(ih.buffer); iv.setUint32(0, w); iv.setUint32(4, h); ih[8] = 8; ih[9] = 6;
  return new Uint8Array(await new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', z), chunk('IEND', new Uint8Array())]).arrayBuffer());
}

const meshes = { knot: torusKnot, pod: hullPod, bench };
async function shot(name, modelId, P, t, cam) {
  const m = MODELS.find(x => x.id === modelId);
  let bound = m.bound;
  if (m.kind === 'mesh') {
    const fm = fitMesh(meshes[modelId](), modelId === 'knot' ? 1.9 : 2.0);
    bound = fm.bound;
    R.setMesh(fm.mesh); R.setSamples(sampleSurface(fm.mesh, 4096, rng(5)));
  } else { R.setMesh(null); R.requestSdfSamples(); }
  const c = orbitCamera({ target: bound.c, dist: bound.r * 3.6, ...cam });
  const U = packUniforms(P, c.viewState(W, H), { time: t, amount: P.spread, kind: m.kind === 'mesh' ? 1 : 0, sdfId: m.sdf ?? 0, samples: 0, bound, mat: m.mat, mat2: m.mat2, seed: 11 });
  const t0 = performance.now();
  R.frame(U, tex.createView());
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: rb, bytesPerRow: bpr }, [W, H]);
  device.queue.submit([enc.finish()]);
  await rb.mapAsync(GPUMapMode.READ);
  const ms = performance.now() - t0;
  const src = new Uint8Array(rb.getMappedRange()), px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) px.set(src.subarray(y * bpr, y * bpr + W * 4), y * W * 4);
  rb.unmap();
  let s = [0, 0, 0], red = 0;
  for (let i = 0; i < px.length; i += 4) { s[0] += px[i]; s[1] += px[i + 1]; s[2] += px[i + 2]; if (px[i] > 120 && px[i] > 2.2 * px[i + 1]) red++; }
  const n = W * H;
  await Deno.writeFile(`${out}/${name}.png`, await png(px, W, H));
  console.log(`${name.padEnd(18)} mean ${s.map(v => (v / n).toFixed(1)).join(' ')}  red ${(100 * red / n).toFixed(2)}%  ${ms.toFixed(0)} ms`);
}

const D = defaults();
const cases = (Deno.env.get('CASES') || 'trooper,reactor,crates,relic,knot,pod,bench,shuffle').split(',');
for (const k of cases) {
  if (k === 'shuffle') { const P = shuffle(424242, { c: [0, 1, 0], r: 1.05 }); await shot('shuffle-trooper', 'trooper', P, 7.3, {}); continue; }
  if (k === 'clean') { await shot('clean-trooper', 'trooper', { ...D, spread: 0 }, 3, {}); continue; }
  await shot(k, k, D, 6.1, {});
}
