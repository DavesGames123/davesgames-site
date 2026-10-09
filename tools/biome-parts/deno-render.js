// ============================================================================
//  tools/biome-parts/deno-render.js — render biome-parts scenes without a browser
// ----------------------------------------------------------------------------
//  Deno has navigator.gpu. This script builds parts with the page's own
//  modules (the clean expert path, or Taiga-S1 when --model is given), packs
//  the tape, compiles the page's one shader (SDF lab FRAME + WGSL_PART) and
//  renders fs_view into an rgba8unorm texture, then writes PNG files.
//  It also probes mapD on the GPU at sample points and compares the values
//  with the CPU field (part.fieldWorld).
//
//    deno run -A tools/biome-parts/deno-render.js <out dir> [w h] [--only=key] [--yaw=38] [--pitch=30] [--mode=1] [--fill=1.25]
// ============================================================================
const P = new URL('../../stella-nova/pages/biome-parts/', import.meta.url);
const { SHADER, packUniform, P_FLOATS, UNIFORM_FLOATS } = await import(new URL('js/gpu.js', P));
const { packTape, fieldWorld, MM } = await import(new URL('js/part.js', P));
const { buildTarget } = await import(new URL('js/fcsim.js', P));
const { GALLERY } = await import(new URL('js/gallery.js', P));
const { frameFor } = await import(new URL('js/view.js', P));

const pos = Deno.args.filter(a => !a.startsWith('--'));
const opt = k => { const a = Deno.args.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : null; };
const out = pos[0] || '.';
const W = +(pos[1] || 1280), H = +(pos[2] || 800);
const ONLY = opt('only'), YAW = +(opt('yaw') ?? 38), PITCH = +(opt('pitch') ?? 30), MODE = +(opt('mode') ?? 1), FILL = +(opt('fill') ?? 1.25);
const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();
const bgl = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
  { binding: 1, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }] });
const module = device.createShaderModule({ code: SHADER });
const info = await module.getCompilationInfo();
for (const m of info.messages) console.log('wgsl', m.type, m.lineNum, m.message);
const pipe = device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
  vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: 'fs_view', targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list' } });
const ubuf = device.createBuffer({ size: UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const pbuf = device.createBuffer({ size: P_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
const bind = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: pbuf } }] });

async function crc32(buf) { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let crc = 0xffffffff; for (const b of buf) crc = t[(crc ^ b) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
async function png(rgba, w, h) {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1); }
  const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const chunk = async (type, data) => { const b = new Uint8Array(12 + data.length); const dv = new DataView(b.buffer); dv.setUint32(0, data.length); b.set(new TextEncoder().encode(type), 4); b.set(data, 8); dv.setUint32(8 + data.length, await crc32(b.subarray(4, 8 + data.length))); return b; };
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), await chunk('IHDR', ihdr), await chunk('IDAT', z), await chunk('IEND', new Uint8Array())];
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}
async function render(Pk, cam, opts, file) {
  device.queue.writeBuffer(pbuf, 0, Pk);
  device.queue.writeBuffer(ubuf, 0, packUniform(new Float32Array(UNIFORM_FLOATS), cam, W, H, opts));
  const tex = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const bpr = Math.ceil(W * 4 / 256) * 256;
  const rb = device.createBuffer({ size: bpr * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
  pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: rb, bytesPerRow: bpr }, [W, H]);
  device.queue.submit([enc.finish()]);
  await rb.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(rb.getMappedRange()), rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) rgba.set(src.subarray(y * bpr, y * bpr + W * 4), y * W * 4);
  rb.unmap(); rb.destroy(); tex.destroy();
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  await Deno.writeFile(file, await png(rgba, W, H));
}

// GPU probe vs CPU field
const probeModule = device.createShaderModule({ code: SHADER.replace(/@fragment[\s\S]*$/, '') + `
@group(0) @binding(2) var<storage, read> pts: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> outv: array<f32>;
@compute @workgroup_size(64) fn cs(@builtin(global_invocation_id) g: vec3u) { let i = g.x; if (i >= arrayLength(&outv)) { return; } outv[i] = mapD(pts[i].xyz); }` });
const pinfo = await probeModule.getCompilationInfo();
for (const m of pinfo.messages) if (m.type === 'error') console.log('probe wgsl', m.lineNum, m.message);

let worst = 0;
for (const [key, g] of Object.entries(GALLERY)) {
  if (ONLY && key !== ONLY) continue;
  const goal = JSON.parse(JSON.stringify(g.goal));
  const t = buildTarget(goal);
  const Pk = packTape(t.ops, undefined, { colourOf: (i, op) => i % 8 });
  const { cam, scene } = frameFor(t.A, { yaw: YAW, pitch: PITCH, fill: FILL });
  await render(Pk, cam, { mode: MODE, scene, grid: true }, `${out}/${key}.png`);
  // probe 512 points around the part
  const f = fieldWorld(Pk), n = 512, pts = new Float32Array(n * 4), cpu = [];
  for (let i = 0; i < n; i++) {
    const p = [scene[0] + (Math.sin(i * 12.9898) * 0.5) * scene[3] * 2, scene[1] + (Math.sin(i * 78.233) * 0.5) * scene[3] * 2, scene[2] + (Math.sin(i * 37.719) * 0.5) * scene[3] * 2];
    pts.set([...p, 0], i * 4); cpu.push(f(...p));
  }
  const pb = device.createBuffer({ size: pts.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const ob = device.createBuffer({ size: n * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const rb = device.createBuffer({ size: n * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeBuffer(pb, 0, pts);
  const cp = device.createComputePipeline({ layout: 'auto', compute: { module: probeModule, entryPoint: 'cs' } });
  const bg = device.createBindGroup({ layout: cp.getBindGroupLayout(0), entries: [{ binding: 1, resource: { buffer: pbuf } }, { binding: 2, resource: { buffer: pb } }, { binding: 3, resource: { buffer: ob } }] });
  const enc = device.createCommandEncoder(); const cpass = enc.beginComputePass(); cpass.setPipeline(cp); cpass.setBindGroup(0, bg); cpass.dispatchWorkgroups(Math.ceil(n / 64)); cpass.end();
  enc.copyBufferToBuffer(ob, 0, rb, 0, n * 4); device.queue.submit([enc.finish()]);
  await rb.mapAsync(GPUMapMode.READ);
  const gpu = new Float32Array(rb.getMappedRange().slice(0)); rb.unmap();
  let m = 0; for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(gpu[i] - cpu[i]));
  worst = Math.max(worst, m);
  console.log(key.padEnd(16), 'ops', t.ops.length, 'gpu-cpu max |d|', m.toExponential(2), 'units (1 unit =', MM, 'mm)');
}
console.log('worst', worst.toExponential(2));
