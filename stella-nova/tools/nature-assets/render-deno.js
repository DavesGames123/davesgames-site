// Offscreen WebGPU renderer for the nature asset build (Deno only).
// Run: deno run -A stella-nova/tools/nature-assets/render-deno.js <job.json>
// impostor.mjs writes the job and reads the results; this file does no
// image coding. Textures come in as raw RGBA files and the views go out
// as raw RGBA files (see the job format below).
//
// job = {
//   textures: { "<uri as in the GLB>": { file, w, h } },   // per model, below
//   renders: [{
//     models: [{ glb, textures: {uri: {file, w, h}}, offset: [x, y, z], yaw }],
//     mode: 'impostor' | 'beauty',
//     size,                       // pixels of one view (square)
//     views: [{ eye, target, up, ortho: halfWidth | null, orthoY: halfHeight, fov, near, far }],
//     out: { albedo, normal } (impostor) or { color } (beauty), raw RGBA files,
//     views side by side in one row (width = size * views.length)
//   }]
// }
// impostor mode: albedo = sRGB base colour with alpha mask coverage,
// normal = world normal * 0.5 + 0.5 in rgb and linear depth (1 near ..
// 0 far within the view box) in a.
// beauty mode: a simple sun + sky light with a ground plane, for looks.
import { parseGLB } from '../../lib/glb-lite.js';

const job = JSON.parse(await Deno.readTextFile(Deno.args[0]));
const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();
device.addEventListener?.('uncapturederror', (e) => console.error('GPU error', e.error?.message));

const WGSL = /* wgsl */`
struct U { viewProj: mat4x4f, view: mat4x4f, model: mat4x4f, params: vec4f, sun: vec4f, eye: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@group(1) @binding(0) var tBase: texture_2d<f32>;
@group(1) @binding(1) var tNorm: texture_2d<f32>;
@group(1) @binding(2) var tOrm: texture_2d<f32>;
@group(1) @binding(3) var samp: sampler;
@group(1) @binding(4) var<uniform> mat: vec4f; // x cutoff, y has normal map, z alpha masked
struct VO { @builtin(position) pos: vec4f, @location(0) wpos: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f, @location(3) vz: f32 };
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f) -> VO {
  var o: VO;
  let w = u.model * vec4f(p, 1.0);
  o.pos = u.viewProj * w;
  o.wpos = w.xyz;
  o.n = (u.model * vec4f(n, 0.0)).xyz;
  o.uv = uv;
  o.vz = (u.view * w).z;
  return o;
}
fn perturb(n: vec3f, p: vec3f, uv: vec2f, tn: vec3f) -> vec3f {
  let dp1 = dpdx(p); let dp2 = dpdy(p); let du1 = dpdx(uv); let du2 = dpdy(uv);
  let dp2perp = cross(dp2, n); let dp1perp = cross(n, dp1);
  let t = dp2perp * du1.x + dp1perp * du2.x;
  let b = dp2perp * du1.y + dp1perp * du2.y;
  let inv = inverseSqrt(max(max(dot(t, t), dot(b, b)), 1e-20));
  return normalize(mat3x3f(t * inv, b * inv, n) * tn);
}
struct FO { @location(0) a: vec4f, @location(1) b: vec4f };
@fragment fn fs(i: VO, @builtin(front_facing) ff: bool) -> FO {
  let base = textureSample(tBase, samp, i.uv);
  let tn = textureSample(tNorm, samp, i.uv).xyz * 2.0 - 1.0;
  let orm = textureSample(tOrm, samp, i.uv);
  if (mat.z > 0.5 && base.a < mat.x) { discard; }
  var n = normalize(i.n);
  if (!ff) { n = -n; }
  if (mat.y > 0.5) { n = perturb(n, i.wpos, i.uv, normalize(tn)); }
  var o: FO;
  if (u.params.x < 0.5) {
    // impostor: albedo, world normal + depth
    o.a = vec4f(base.rgb, 1.0);
    let d = clamp((-i.vz - u.params.y) / max(u.params.z - u.params.y, 1e-4), 0.0, 1.0);
    o.b = vec4f(n * 0.5 + 0.5, 1.0 - d);
  } else {
    let l = normalize(u.sun.xyz);
    let ndl = max(dot(n, l), 0.0);
    let wrap = select(0.0, 0.35 * max(-dot(n, l), 0.0), mat.z > 0.5); // light through leaves
    let sky = vec3f(0.35, 0.45, 0.6) * (0.55 + 0.45 * n.y) * orm.r;
    let c = base.rgb * (vec3f(1.0, 0.95, 0.85) * 2.4 * (ndl + wrap) + sky);
    let v = normalize(u.eye.xyz - i.wpos);
    let h = normalize(l + v);
    let spec = pow(max(dot(n, h), 0.0), mix(64.0, 4.0, orm.g)) * (1.0 - orm.g) * 0.3 * ndl;
    let col = c + vec3f(spec);
    o.a = vec4f(col / (col + vec3f(1.0)) * 1.25, 1.0);
    o.b = vec4f(0.0);
  }
  return o;
}
@vertex fn vsGround(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var q = array<vec2f, 6>(vec2f(-1,-1), vec2f(1,-1), vec2f(1,1), vec2f(-1,-1), vec2f(1,1), vec2f(-1,1));
  let p = q[vi] * 200.0;
  return u.viewProj * vec4f(p.x, 0.0, p.y, 1.0);
}
@fragment fn fsGround(@builtin(position) fp: vec4f) -> FO {
  var o: FO;
  let c = vec3f(0.30, 0.27, 0.20) * (vec3f(1.0, 0.95, 0.85) * 2.4 * max(normalize(u.sun.xyz).y, 0.0) + vec3f(0.35, 0.45, 0.6));
  o.a = vec4f(c / (c + vec3f(1.0)) * 1.25, 1.0);
  o.b = vec4f(0.0);
  return o;
}
`;

const module = device.createShaderModule({ code: WGSL });
const info = await module.getCompilationInfo?.();
if (info) for (const m of info.messages) if (m.type === 'error') { console.error('WGSL', m.lineNum, m.message); Deno.exit(1); }

const bgl0 = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }] });
const bgl1 = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
  { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
  { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
  { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
  { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
] });
const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl0, bgl1] });
const layout0 = device.createPipelineLayout({ bindGroupLayouts: [bgl0] });
const targets = (albedoFmt) => [{ format: albedoFmt }, { format: 'rgba8unorm' }];
const pipes = new Map();
function pipeline(albedoFmt) {
  if (pipes.has(albedoFmt)) return pipes.get(albedoFmt);
  const p = device.createRenderPipeline({
    layout,
    vertex: { module, entryPoint: 'vs', buffers: [
      { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
      { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
      { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] },
    ] },
    fragment: { module, entryPoint: 'fs', targets: targets(albedoFmt) },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
  });
  const g = device.createRenderPipeline({
    layout: layout0,
    vertex: { module, entryPoint: 'vsGround' },
    fragment: { module, entryPoint: 'fsGround', targets: targets(albedoFmt) },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
  });
  pipes.set(albedoFmt, { p, g });
  return pipes.get(albedoFmt);
}
const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', maxAnisotropy: 8 });

// ---- math
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function lookAt(eye, target, up) {
  const z = norm(sub(eye, target)), x = norm(cross(up, z)), y = cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
}
function ortho(h, near, far, hy = h) { // WebGPU depth 0..1; h = half width, hy = half height
  return [1 / h, 0, 0, 0, 0, 1 / hy, 0, 0, 0, 0, -1 / (far - near), 0, 0, 0, -near / (far - near), 1];
}
function persp(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, far / (near - far), -1, 0, 0, (near * far) / (near - far), 0];
}
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
function modelMatrix(off = [0, 0, 0], yaw = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, off[0], off[1], off[2], 1];
}

// ---- resources
const texCache = new Map();
function mipCount(w, h) { return Math.floor(Math.log2(Math.max(w, h))) + 1; }
async function loadTexture(t, srgb) {
  const key = t.file + (srgb ? ':s' : '');
  if (texCache.has(key)) return texCache.get(key);
  const data = await Deno.readFile(t.file);
  const levels = mipCount(t.w, t.h);
  const tex = device.createTexture({ size: [t.w, t.h], format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm', mipLevelCount: levels, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  // CPU box mips (alpha kept as is; good enough for bakes and checks).
  let w = t.w, h = t.h, cur = data;
  for (let l = 0; l < levels; l++) {
    device.queue.writeTexture({ texture: tex, mipLevel: l }, cur, { bytesPerRow: w * 4 }, [w, h]);
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
    const nx = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < 4; c++) {
      let s = 0, n = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const sx = Math.min(w - 1, x * 2 + dx), sy = Math.min(h - 1, y * 2 + dy);
        s += cur[(sy * w + sx) * 4 + c]; n++;
      }
      nx[(y * nw + x) * 4 + c] = s / n;
    }
    cur = nx; w = nw; h = nh;
  }
  texCache.set(key, tex);
  return tex;
}
let white, flat;
function solid(rgba) {
  const t = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: t }, new Uint8Array(rgba), { bytesPerRow: 4 }, [1, 1]);
  return t;
}
white = solid([255, 255, 255, 255]); flat = solid([128, 128, 255, 255]);

async function loadModel(m) {
  const bytes = await Deno.readFile(m.glb);
  const scene = parseGLB(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const draws = [];
  for (const mesh of scene.meshes) {
    const buf = (arr, usage) => { const b = device.createBuffer({ size: Math.ceil(arr.byteLength / 4) * 4, usage: usage | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, arr); return b; };
    const mt = mesh.material;
    const tx = (im, srgb, fallback) => im && m.textures[im.uri] ? loadTexture(m.textures[im.uri], srgb) : fallback;
    const matBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(matBuf, 0, new Float32Array([mt.alphaCutoff, mt.normal ? 1 : 0, mt.alphaMode === 'MASK' ? 1 : 0, 0]));
    const bg = device.createBindGroup({ layout: bgl1, entries: [
      { binding: 0, resource: (await tx(mt.baseColor, true, white)).createView() },
      { binding: 1, resource: (await tx(mt.normal, false, flat)).createView() },
      { binding: 2, resource: (await tx(mt.orm, false, white)).createView() },
      { binding: 3, resource: sampler },
      { binding: 4, resource: { buffer: matBuf } },
    ] });
    draws.push({ pos: buf(mesh.positions, GPUBufferUsage.VERTEX), nrm: buf(mesh.normals, GPUBufferUsage.VERTEX), uv: buf(mesh.uvs, GPUBufferUsage.VERTEX), idx: buf(mesh.indices, GPUBufferUsage.INDEX), count: mesh.indices.length, bg });
  }
  return { draws, model: modelMatrix(m.offset, m.yaw || 0) };
}

async function readback(tex, w, h) {
  const bpr = Math.ceil(w * 4 / 256) * 256;
  const b = device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: b, bytesPerRow: bpr }, [w, h]);
  device.queue.submit([enc.finish()]);
  await b.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(b.getMappedRange());
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) out.set(src.subarray(y * bpr, y * bpr + w * 4), y * w * 4);
  b.unmap(); b.destroy();
  return out;
}

for (const r of job.renders) {
  const models = [];
  for (const m of r.models) models.push(await loadModel(m));
  const size = r.size, nv = r.views.length;
  const W = size * nv, H = size;
  const albedoFmt = r.mode === 'impostor' ? 'rgba8unorm-srgb' : 'rgba8unorm';
  const { p, g } = pipeline(albedoFmt);
  const ta = device.createTexture({ size: [W, H], format: albedoFmt, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const tb = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const td = device.createTexture({ size: [W, H], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT });
  const ubufs = [];
  const enc = device.createCommandEncoder();
  const clear = r.mode === 'impostor' ? { r: 0, g: 0, b: 0, a: 0 } : { r: 0.55, g: 0.68, b: 0.85, a: 1 };
  const pass = enc.beginRenderPass({
    colorAttachments: [
      { view: ta.createView(), loadOp: 'clear', storeOp: 'store', clearValue: clear },
      { view: tb.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.5, g: 0.5, b: 1, a: 0 } },
    ],
    depthStencilAttachment: { view: td.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
  });
  r.views.forEach((v, vi) => {
    pass.setViewport(vi * size, 0, size, size, 0, 1);
    pass.setScissorRect(vi * size, 0, size, size);
    const view = lookAt(v.eye, v.target, v.up || [0, 1, 0]);
    const near = v.near ?? 0.01, far = v.far ?? 1000;
    const proj = v.ortho ? ortho(v.ortho, near, far, v.orthoY || v.ortho) : persp(v.fov || 0.6, 1, near, far);
    const vp = mul(proj, view);
    const sun = r.sun || [0.5, 0.8, 0.3];
    const mk = (model) => {
      const ub = device.createBuffer({ size: 64 * 3 + 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(ub, 0, new Float32Array([...vp, ...view, ...model, r.mode === 'impostor' ? 0 : 1, near, far, 0, ...sun, 0, ...v.eye, 1]));
      ubufs.push(ub);
      return device.createBindGroup({ layout: bgl0, entries: [{ binding: 0, resource: { buffer: ub } }] });
    };
    if (r.mode === 'beauty' && r.ground !== false) {
      pass.setPipeline(g);
      pass.setBindGroup(0, mk(modelMatrix()));
      pass.draw(6);
    }
    pass.setPipeline(p);
    for (const m of models) {
      pass.setBindGroup(0, mk(m.model));
      for (const d of m.draws) {
        pass.setBindGroup(1, d.bg);
        pass.setVertexBuffer(0, d.pos); pass.setVertexBuffer(1, d.nrm); pass.setVertexBuffer(2, d.uv);
        pass.setIndexBuffer(d.idx, 'uint32');
        pass.drawIndexed(d.count);
      }
    }
  });
  pass.end();
  device.queue.submit([enc.finish()]);
  const a = await readback(ta, W, H);
  if (r.mode === 'impostor') {
    const b = await readback(tb, W, H);
    await Deno.writeFile(r.out.albedo, a);
    await Deno.writeFile(r.out.normal, b);
  } else {
    await Deno.writeFile(r.out.color, a);
  }
  for (const u of ubufs) u.destroy();
  ta.destroy(); tb.destroy(); td.destroy();
  console.log('rendered', r.out.albedo || r.out.color, W + 'x' + H);
}
