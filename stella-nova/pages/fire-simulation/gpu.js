// ============================================================================
//  FIRE SIMULATION  ·  pages/fire-simulation/gpu.js — the GPU engine
// ----------------------------------------------------------------------------
//  Our code (davesgames.io). Runs the solver.js passes on the GPU:
//  WebGPU compute (wgsl.js) where the browser has it, else WebGL2 fragment
//  passes (glsl.js), else null (the page runs the CPU solver).
//
//  The CPU keeps the burners, the swirls and the source mask (solver.js
//  buildSources). Per step it uploads the dirty rect of the mask and one
//  uniform block, then encodes all passes in one go. No readback in the
//  frame. Per frame: an emit pass (glow light at sim size) and one
//  full-screen pass that upsamples T with a B-spline bicubic.
//
//  makePlan(NX, NY, cycles, r, par)   the pass list of one step, shared by
//                both backends: logical state A B C rotate over S0 S1 S2
//                (r), the fine pressure pair flips (par)
//  createEngine(canvas, {prefer})     -> engine | null
//  engine: kind, setGrid(f, {resample}), step(S, P, dirty), render(S, look,
//          view, w, h, target?), readTexture(name) (tests), destroy(),
//          lost, onLost
//  grep -n targets: "export function makePlan", "export function packStep",
//  "async function webgpu", "function webgl2", "export async function createEngine"
// ============================================================================
import { WGSL } from './wgsl.js';
import { GLSL } from './glsl.js';
import { mgSizes, mgGhost, MG_COARSE, MG_OMEGA, MG_OMEGA_COARSE, SPIN, FLAME_T, MAX_SWIRLS } from './solver.js';

const COMPUTE = ['curl', 'force', 'div', 'smooth', 'restrict', 'prolong', 'project', 'advect', 'mac', 'resample', 'emit'];
// texture inputs per pass, in binding order (after the uniform at binding 0)
const INPUTS = { curl: ['A'], force: ['A', 'W', 'SRC'], div: ['B', 'Q'], smooth: ['X'], restrict: ['X'], prolong: ['X', 'C'],
  project: ['B', 'Q'], advect: ['A'], mac: ['A', 'B', 'SRC'], resample: ['A'], emit: ['A', 'LUT'], render: ['A', 'EM', 'LUT'] };

// ---- the pass plan (pure, tested in node) ---------------------------------
export function makePlan(NX, NY, cycles, r = 0, par = 0) {
  const lv = mgSizes(NX, NY), N = lv.length, Sx = k => `S${(r + k) % 3}`;
  const A = Sx(0), B = Sx(1), C = Sx(2), P = [], cur = lv.map(() => 0);
  const L = (l, k) => `L${l}_${k}`;
  cur[0] = par;
  P.push({ k: 'curl', in: [A], out: 'W', w: NX, h: NY });
  P.push({ k: 'force', in: [A, 'W', 'SRC'], out: B, w: NX, h: NY });
  P.push({ k: 'div', in: [B, L(0, cur[0])], out: L(0, 1 - cur[0]), w: NX, h: NY }); cur[0] ^= 1;
  const lvU = (l, a, b, c, d, e, f, g) => [lv[l].W, lv[l].H, a, b, mgGhost(l), c, d, e].concat(f || [], g || []).slice(0, 8);
  const smooth = (l, color, coarse) => {
    const om = coarse ? MG_OMEGA_COARSE : MG_OMEGA;
    P.push({ k: 'smooth', in: [L(l, cur[l])], out: L(l, 1 - cur[l]), w: lv[l].W, h: lv[l].H, lv: lvU(l, color, om, 0, 0, 0), key: `s${l}:${color}:${om}` });
    cur[l] ^= 1;
  };
  for (let c = 0; c < cycles; c++) {
    for (let l = 0; l < N - 1; l++) {
      smooth(l, 0); smooth(l, 1);
      P.push({ k: 'restrict', in: [L(l, cur[l])], out: L(l + 1, 0), w: lv[l + 1].W, h: lv[l + 1].H, lv: lvU(l, 0, 0, lv[l + 1].W, lv[l + 1].H, 0), key: `r${l}` });
      cur[l + 1] = 0;
    }
    for (let s = 0; s < MG_COARSE; s++) { smooth(N - 1, 0, true); smooth(N - 1, 1, true); }
    for (let l = N - 2; l >= 0; l--) {
      P.push({ k: 'prolong', in: [L(l, cur[l]), L(l + 1, cur[l + 1])], out: L(l, 1 - cur[l]), w: lv[l].W, h: lv[l].H, lv: lvU(l, 0, 0, lv[l + 1].W, lv[l + 1].H, 0), key: `p${l}` });
      cur[l] ^= 1;
      smooth(l, 0); smooth(l, 1);
    }
  }
  P.push({ k: 'project', in: [B, L(0, cur[0])], out: A, w: NX, h: NY });
  P.push({ k: 'advect', in: [A], out: B, w: NX, h: NY });
  P.push({ k: 'mac', in: [A, B, 'SRC'], out: C, w: NX, h: NY });
  return { passes: P, levels: lv, next: { r: (r + 2) % 3, par: cur[0] } };
}

// Step uniform: 20 floats (wgsl.js STEP_FIELDS), then MAX_SWIRLS x vec4.
export const STEP_FLOATS = 20 + 4 * MAX_SWIRLS;
export function packStep(out, S, P) {
  out[0] = P.dt; out[1] = P.h; out[2] = P.NX; out[3] = P.NY;
  out[4] = P.lift; out[5] = P.accel; out[6] = P.gravity; out[7] = P.eps;
  out[8] = P.visc; out[9] = P.drag; out[10] = P.wind; out[11] = P.floorH;
  out[12] = P.pertX; out[13] = P.pertY; out[14] = P.kappa; out[15] = P.fireCool;
  const sw = S.swirls || [], n = Math.min(MAX_SWIRLS, sw.length);
  out[16] = P.smokeCool; out[17] = n; out[18] = SPIN; out[19] = FLAME_T;
  for (let q = 0; q < n; q++) { const s = sw[q], o = 20 + 4 * q; out[o] = s.x; out[o + 1] = s.y; out[o + 2] = s.w; out[o + 3] = s.R; }
  return out;
}
const hexRGB = h => { const n = parseInt(String(h || '#000').slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
// LUT texels (n x 2, rgba8): palette LUT {n, rgba, glow} or a 768-byte map
export function lutTexels(lut) {
  if (lut && lut.rgba) { const n = lut.n, d = new Uint8Array(n * 8); d.set(lut.rgba.subarray(0, n * 4), 0); d.set(lut.glow.subarray(0, n * 4), n * 4); return { n, d, mode: 0 }; }
  const n = 256, d = new Uint8Array(n * 8);
  for (let k = 0; k < n; k++) { d[k * 4] = lut[k * 3]; d[k * 4 + 1] = lut[k * 3 + 1]; d[k * 4 + 2] = lut[k * 3 + 2]; d[k * 4 + 3] = 255; }
  return { n, d, mode: 1 };
}
// render uniform: view (ox, oy, s, h), dom (W, H, nx, ny), bg, bg2, opt
// (glow, mode, veil, 1 / vmax), aux (lut n)
function packRender(out, S, look, view, ch, mode, n) {
  const bg = hexRGB(look.bg), bg2 = hexRGB(look.bg2), C = S.cfg;
  out[0] = view.ox; out[1] = view.oy; out[2] = view.s; out[3] = ch;
  out[4] = S.W; out[5] = S.H; out[6] = S.f.NX; out[7] = S.f.NY;
  out[8] = bg[0]; out[9] = bg[1]; out[10] = bg[2]; out[11] = 1;
  out[12] = bg2[0]; out[13] = bg2[1]; out[14] = bg2[2]; out[15] = 1;
  out[16] = look.glow; out[17] = mode; out[18] = look.veil || 0; out[19] = 1 / Math.max(0.5, 1.2 * Math.max(C.lift, C.torch || 0));
  out[20] = n; out[21] = 0; out[22] = 0; out[23] = 0;
  return out;
}
const modeOf = (look, lm) => (look.colorBy === 'speed' ? 2 : lm);

// ---- WebGPU ---------------------------------------------------------------
async function webgpu(canvas) {
  const gpu = globalThis.navigator && navigator.gpu;
  if (!gpu) return null;
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const format = canvas ? gpu.getPreferredCanvasFormat() : 'rgba8unorm';
  device.pushErrorScope('validation');
  const pipe = {};
  for (const k of COMPUTE) pipe[k] = device.createComputePipeline({ label: 'fire-' + k, layout: 'auto', compute: { module: device.createShaderModule({ code: WGSL[k], label: 'fire-' + k }), entryPoint: 'main' } });
  const rmod = device.createShaderModule({ code: WGSL.render, label: 'fire-render' });
  const rpipe = device.createRenderPipeline({ label: 'fire-render', layout: 'auto', vertex: { module: rmod, entryPoint: 'vs' }, fragment: { module: rmod, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
  const err = await device.popErrorScope();
  if (err) { console.warn('fire: WebGPU pipelines failed', err.message); device.destroy(); return null; }
  let ctx = null;
  if (canvas) { ctx = canvas.getContext('webgpu'); if (!ctx) { device.destroy(); return null; } ctx.configure({ device, format, alphaMode: 'opaque' }); }
  const U = GPUBufferUsage, TU = GPUTextureUsage;
  const ubuf = (bytes, label) => device.createBuffer({ size: Math.max(16, Math.ceil(bytes / 16) * 16), usage: U.UNIFORM | U.COPY_DST, label });
  const stepBuf = ubuf(STEP_FLOATS * 4, 'fire-step'), renderBuf = ubuf(96, 'fire-view'), emitBuf = ubuf(16, 'fire-emit'), resBuf = ubuf(16, 'fire-resample');
  const stepData = new Float32Array(STEP_FLOATS), renderData = new Float32Array(24), emitData = new Float32Array(4), resData = new Float32Array(4);
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  let G = null, lutTex = null, lutKey = null, lutN = 0, lutMode = 0;
  const E = { kind: 'webgpu', device, lost: false, onLost: null };
  device.lost.then(info => { if (info.reason === 'destroyed') return; E.lost = true; if (E.onLost) E.onLost(info); });

  function tex(w, h, fmt, label) { return device.createTexture({ size: [w, h], format: fmt, label, usage: TU.TEXTURE_BINDING | TU.STORAGE_BINDING | TU.COPY_SRC | TU.COPY_DST }); }
  function makeGrid(NX, NY) {
    const g = { NX, NY, T: {}, V: {}, lists: new Map(), mg: new Map(), r: 0, par: 0, emitBG: [], renderBG: [] };
    const add = (name, w, h, fmt) => { g.T[name] = tex(w, h, fmt, 'fire-' + name); g.V[name] = g.T[name].createView(); };
    for (const s of ['S0', 'S1', 'S2']) add(s, NX, NY, 'rgba16float');
    add('W', NX, NY, 'r32float'); add('SRC', NX, NY, 'rgba32float'); add('EM', NX, NY, 'rgba16float');
    mgSizes(NX, NY).forEach((q, l) => { add(`L${l}_0`, q.W, q.H, 'rg32float'); add(`L${l}_1`, q.W, q.H, 'rg32float'); });
    return g;
  }
  function destroyGrid(g) { if (g) for (const k in g.T) g.T[k].destroy(); }
  function mgBuf(g, p) {
    if (!g.mg.has(p.key)) { const b = ubuf(32, 'fire-lv-' + p.key); device.queue.writeBuffer(b, 0, new Float32Array(p.lv)); g.mg.set(p.key, b); }
    return g.mg.get(p.key);
  }
  function list(g, cycles) {
    const key = `${g.r}:${g.par}:${cycles}`;
    if (g.lists.has(key)) return g.lists.get(key);
    const plan = makePlan(g.NX, g.NY, cycles, g.r, g.par), out = [];
    for (const p of plan.passes) {
      const pl = pipe[p.k], u = p.lv ? mgBuf(g, p) : stepBuf;
      const entries = [{ binding: 0, resource: { buffer: u } }];
      p.in.forEach((n, i) => entries.push({ binding: i + 1, resource: g.V[n] }));
      entries.push({ binding: p.in.length + 1, resource: g.V[p.out] });
      out.push({ pl, bg: device.createBindGroup({ layout: pl.getBindGroupLayout(0), entries }), x: Math.ceil(p.w / 8), y: Math.ceil(p.h / 8) });
    }
    const L = { passes: out, next: plan.next };
    g.lists.set(key, L);
    return L;
  }
  E.setGrid = (f, opt = {}) => {
    const old = G;
    G = makeGrid(f.NX, f.NY);
    stepData.fill(0); stepData[0] = 1 / 60; stepData[1] = f.h; stepData[2] = f.NX; stepData[3] = f.NY;
    device.queue.writeBuffer(stepBuf, 0, stepData);
    if (opt.resample && old) {
      resData[0] = old.NX; resData[1] = old.NY; resData[2] = old.h; resData[3] = 0;
      device.queue.writeBuffer(resBuf, 0, resData);
      const bg = device.createBindGroup({ layout: pipe.resample.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: stepBuf } }, { binding: 1, resource: old.V[`S${old.r}`] }, { binding: 2, resource: { buffer: resBuf } }, { binding: 3, resource: G.V.S0 }] });
      const enc = device.createCommandEncoder(), cp = enc.beginComputePass();
      cp.setPipeline(pipe.resample); cp.setBindGroup(0, bg); cp.dispatchWorkgroups(Math.ceil(f.NX / 8), Math.ceil(f.NY / 8)); cp.end();
      device.queue.submit([enc.finish()]);
    }
    G.h = f.h;
    if (old) device.queue.onSubmittedWorkDone().then(() => destroyGrid(old));
  };
  E.step = (S, P, dirty) => {
    const f = S.f;
    if (dirty) {
      const w = dirty.i1 - dirty.i0 + 1, h = dirty.j1 - dirty.j0 + 1;
      device.queue.writeTexture({ texture: G.T.SRC, origin: { x: dirty.i0, y: dirty.j0 } }, f.src, { offset: (dirty.j0 * f.NX + dirty.i0) * 16, bytesPerRow: f.NX * 16, rowsPerImage: h }, { width: w, height: h });
    }
    device.queue.writeBuffer(stepBuf, 0, packStep(stepData, S, P));
    const L = list(G, P.iters), enc = device.createCommandEncoder(), cp = enc.beginComputePass();
    for (const p of L.passes) { cp.setPipeline(p.pl); cp.setBindGroup(0, p.bg); cp.dispatchWorkgroups(p.x, p.y); }
    cp.end();
    device.queue.submit([enc.finish()]);
    G.r = L.next.r; G.par = L.next.par;
  };
  function setLut(lut) {
    if (lut === lutKey) return;
    const t = lutTexels(lut);
    if (!lutTex || lutN !== t.n) { if (lutTex) lutTex.destroy(); lutTex = device.createTexture({ size: [t.n, 2], format: 'rgba8unorm', usage: TU.TEXTURE_BINDING | TU.COPY_DST, label: 'fire-lut' }); if (G) { G.emitBG = []; G.renderBG = []; } }
    device.queue.writeTexture({ texture: lutTex }, t.d, { bytesPerRow: t.n * 4, rowsPerImage: 2 }, { width: t.n, height: 2 });
    lutKey = lut; lutN = t.n; lutMode = t.mode;
  }
  E.render = (S, look, view, cw, ch, target) => {
    if (!G) return;
    setLut(look.lut);
    const mode = modeOf(look, lutMode), r = G.r, cur = G.V[`S${r}`];
    const enc = device.createCommandEncoder();
    if (look.glow > 0 && mode < 2) {
      emitData[0] = mode; emitData[1] = lutN; device.queue.writeBuffer(emitBuf, 0, emitData);
      if (!G.emitBG[r]) G.emitBG[r] = device.createBindGroup({ layout: pipe.emit.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: stepBuf } }, { binding: 1, resource: cur }, { binding: 2, resource: lutTex.createView() }, { binding: 3, resource: { buffer: emitBuf } }, { binding: 4, resource: G.V.EM }] });
      const cp = enc.beginComputePass(); cp.setPipeline(pipe.emit); cp.setBindGroup(0, G.emitBG[r]); cp.dispatchWorkgroups(Math.ceil(G.NX / 8), Math.ceil(G.NY / 8)); cp.end();
    }
    device.queue.writeBuffer(renderBuf, 0, packRender(renderData, S, look, view, ch, mode, lutN));
    if (!G.renderBG[r]) G.renderBG[r] = device.createBindGroup({ layout: rpipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: renderBuf } }, { binding: 1, resource: cur }, { binding: 2, resource: G.V.EM }, { binding: 3, resource: lutTex.createView() }, { binding: 4, resource: sampler }] });
    const rp = enc.beginRenderPass({ colorAttachments: [{ view: target || ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    rp.setPipeline(rpipe); rp.setBindGroup(0, G.renderBG[r]); rp.draw(3); rp.end();
    device.queue.submit([enc.finish()]);
  };
  // tests only: read a texture back as floats (4 per texel for state)
  E.readTexture = async (name) => {
    const t = name === 'state' ? G.T[`S${G.r}`] : G.T[name], fmt = t.format;
    const bpp = fmt === 'rgba16float' ? 8 : fmt === 'rg32float' ? 8 : fmt === 'rgba32float' ? 16 : 4;
    const W = t.width, H = t.height, row = Math.ceil(W * bpp / 256) * 256;
    const buf = device.createBuffer({ size: row * H, usage: U.COPY_DST | U.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: t }, { buffer: buf, bytesPerRow: row }, { width: W, height: H });
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const raw = buf.getMappedRange(), ch = fmt === 'rgba16float' || fmt === 'rgba32float' ? 4 : fmt === 'rg32float' ? 2 : 1;
    const out = new Float32Array(W * H * ch);
    for (let j = 0; j < H; j++) {
      if (fmt === 'rgba16float') { const u = new Uint16Array(raw, j * row, W * 4); for (let k = 0; k < W * 4; k++) out[j * W * 4 + k] = half(u[k]); }
      else out.set(new Float32Array(raw, j * row, W * ch), j * W * ch);
    }
    buf.unmap(); buf.destroy();
    return { W, H, ch, data: out };
  };
  E.destroy = () => { destroyGrid(G); G = null; if (lutTex) lutTex.destroy(); device.destroy(); };
  return E;
}
function half(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
  if (e === 0) return s * m * Math.pow(2, -24);
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * Math.pow(2, e - 15);
}

// ---- WebGL2 -----------------------------------------------------------------
function webgl2(canvas) {
  if (!canvas) return null;
  let gl = null;
  try { gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' }); } catch (e) { gl = null; }
  if (!gl || typeof gl.createShader !== 'function') return null;
  const f32 = !!gl.getExtension('EXT_color_buffer_float'), f16 = f32 || !!gl.getExtension('EXT_color_buffer_half_float');
  if (!f16) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('fire: GLSL', gl.getShaderInfoLog(s)); return null; } return s; };
  const vs = sh(gl.VERTEX_SHADER, GLSL.vs);
  if (!vs) return null;
  const prog = {};
  for (const k of COMPUTE.concat(['render'])) {
    const fs = sh(gl.FRAGMENT_SHADER, GLSL[k]); if (!fs) return null;
    const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.warn('fire: link', k, gl.getProgramInfoLog(p)); return null; }
    const loc = n => gl.getUniformLocation(p, n);
    prog[k] = { p, uP: loc('uP'), uSw: loc('uSw'), uL: loc('uL'), uR: loc('uR'), uE: loc('uE'), uV: loc('uV') };
    gl.useProgram(p);
    INPUTS[k].forEach((n, i) => { const l = loc(n); if (l) gl.uniform1i(l, i); });
  }
  const vao = gl.createVertexArray();
  const F = { rgba16: [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT], r: f32 ? [gl.R32F, gl.RED, gl.FLOAT] : [gl.R16F, gl.RED, gl.HALF_FLOAT],
    rg: f32 ? [gl.RG32F, gl.RG, gl.FLOAT] : [gl.RG16F, gl.RG, gl.HALF_FLOAT], rgba32: [gl.RGBA32F, gl.RGBA, gl.FLOAT] };
  const stepData = new Float32Array(STEP_FLOATS), renderData = new Float32Array(24), emitData = new Float32Array(4), resData = new Float32Array(4);
  let G = null, lutTex = null, lutKey = null, lutN = 0, lutMode = 0;
  const E = { kind: 'webgl2', gl, lost: false, onLost: null, f32 };
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); E.lost = true; if (E.onLost) E.onLost({ reason: 'webgl context lost' }); });

  function tex(w, h, f, linear, fbo) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, f[0], w, h);
    const flt = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, flt); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, flt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const o = { t, w, h, fb: null };
    if (fbo) {
      o.fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, o.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    }
    return o;
  }
  function makeGrid(NX, NY, h) {
    const g = { NX, NY, h, T: {}, lists: new Map(), r: 0, par: 0 };
    for (const s of ['S0', 'S1', 'S2']) g.T[s] = tex(NX, NY, F.rgba16, true, true);
    g.T.W = tex(NX, NY, F.r, false, true); g.T.EM = tex(NX, NY, F.rgba16, true, true);
    g.T.SRC = tex(NX, NY, F.rgba32, false, false);
    gl.bindTexture(gl.TEXTURE_2D, g.T.SRC.t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, NX, NY, gl.RGBA, gl.FLOAT, new Float32Array(NX * NY * 4));
    mgSizes(NX, NY).forEach((q, l) => { g.T[`L${l}_0`] = tex(q.W, q.H, F.rg, false, true); g.T[`L${l}_1`] = tex(q.W, q.H, F.rg, false, true); });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return g;
  }
  function destroyGrid(g) { if (!g) return; for (const k in g.T) { gl.deleteTexture(g.T[k].t); if (g.T[k].fb) gl.deleteFramebuffer(g.T[k].fb); } }
  function list(g, cycles) {
    const key = `${g.r}:${g.par}:${cycles}`;
    if (g.lists.has(key)) return g.lists.get(key);
    const plan = makePlan(g.NX, g.NY, cycles, g.r, g.par);
    const L = { passes: plan.passes.map(p => ({ pr: prog[p.k], ins: p.in.map(n => g.T[n].t), out: g.T[p.out], lv: p.lv ? new Float32Array(p.lv) : null })), next: plan.next };
    g.lists.set(key, L);
    return L;
  }
  function run(pr, ins, out, lv) {
    gl.useProgram(pr.p);
    if (lv) gl.uniform4fv(pr.uL, lv);
    else { gl.uniform4fv(pr.uP, stepData, 0, 20); if (pr.uSw) gl.uniform4fv(pr.uSw, stepData, 20, 4 * MAX_SWIRLS); }
    for (let i = 0; i < ins.length; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, ins[i]); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fb); gl.viewport(0, 0, out.w, out.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
  E.setGrid = (f, opt = {}) => {
    const old = G;
    G = makeGrid(f.NX, f.NY, f.h);
    stepData.fill(0); stepData[0] = 1 / 60; stepData[1] = f.h; stepData[2] = f.NX; stepData[3] = f.NY;
    gl.bindVertexArray(vao);
    if (opt.resample && old) {
      resData[0] = old.NX; resData[1] = old.NY; resData[2] = old.h;
      gl.useProgram(prog.resample.p); gl.uniform4fv(prog.resample.uR, resData);
      run(prog.resample, [old.T[`S${old.r}`].t], G.T.S0, null);
    }
    destroyGrid(old);
  };
  E.step = (S, P, dirty) => {
    const f = S.f;
    gl.bindVertexArray(vao);
    if (dirty) {
      gl.bindTexture(gl.TEXTURE_2D, G.T.SRC.t);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, f.NX); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, dirty.i0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, dirty.j0);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, dirty.i0, dirty.j0, dirty.i1 - dirty.i0 + 1, dirty.j1 - dirty.j0 + 1, gl.RGBA, gl.FLOAT, f.src);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    }
    packStep(stepData, S, P);
    const L = list(G, P.iters);
    for (const p of L.passes) run(p.pr, p.ins, p.out, p.lv);
    G.r = L.next.r; G.par = L.next.par;
  };
  function setLut(lut) {
    if (lut === lutKey) return;
    const t = lutTexels(lut);
    if (!lutTex || lutN !== t.n) {
      if (lutTex) gl.deleteTexture(lutTex);
      lutTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, lutTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, t.n, 2);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    gl.bindTexture(gl.TEXTURE_2D, lutTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, t.n, 2, gl.RGBA, gl.UNSIGNED_BYTE, t.d);
    lutKey = lut; lutN = t.n; lutMode = t.mode;
  }
  E.render = (S, look, view, cw, ch) => {
    if (!G) return;
    gl.bindVertexArray(vao);
    setLut(look.lut);
    const mode = modeOf(look, lutMode), cur = G.T[`S${G.r}`].t;
    if (look.glow > 0 && mode < 2) {
      emitData[0] = mode; emitData[1] = lutN;
      gl.useProgram(prog.emit.p); gl.uniform4fv(prog.emit.uE, emitData);
      run(prog.emit, [cur, lutTex], G.T.EM, null);
    }
    packRender(renderData, S, look, view, ch, mode, lutN);
    gl.useProgram(prog.render.p); gl.uniform4fv(prog.render.uV, renderData);
    const ins = [cur, G.T.EM.t, lutTex];
    for (let i = 0; i < 3; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, ins[i]); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, cw, ch);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  E.destroy = () => { destroyGrid(G); G = null; const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); };
  return E;
}

// WebGPU first, then WebGL2, else null. prefer: 'webgpu' | 'webgl2' | 'cpu'.
export async function createEngine(canvas, opt = {}) {
  const prefer = opt.prefer || 'auto';
  if (prefer === 'cpu') return null;
  if (prefer !== 'webgl2') { try { const e = await webgpu(canvas); if (e) return e; } catch (err) { console.warn('fire: WebGPU unavailable', err && err.message); } }
  try { return webgl2(canvas); } catch (err) { console.warn('fire: WebGL2 unavailable', err && err.message); return null; }
}
