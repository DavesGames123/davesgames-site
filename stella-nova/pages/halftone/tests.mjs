// ============================================================================
//  HALFTONE  ·  tests.mjs — the WGSL port against the CPU port and the GLSL
// ----------------------------------------------------------------------------
//  node stella-nova/pages/halftone/tests.mjs [--port 9852]
//       [--server http://127.0.0.1:8963] [--cpu-only]
//
//  CPU part (Node only, halftone-ref.js):
//    cpu.noise.ref .... snoise at 12 points equals the values that the
//                       upstream GLSL snoise gave in WebGL 2 (GLSL_NOISE
//                       below, read back as float32 from Chrome on Metal)
//    cpu.noise.range .. snoise stays in -1..1 and has a mean near 0
//    cpu.tone ......... the halftone of a flat grey gets darker as the grey
//                       gets darker (the mean over a 96 x 96 pixel patch)
//  GPU part (headless Chrome over CDP; a static server must serve the repo
//  root at --server, and --port must be a free Chrome debug port). The
//  harness runs in a page of that origin and compiles shaders/halftone.wgsl
//  with a small wrapper, as the upstream README example does:
//    gpu.noise ........ snoise of the WGSL port, of the upstream GLSL (WebGL
//                       2, highp, RGBA32F) and of halftone-ref.js at 2048
//                       points out to |p| = 1200 (st * 800)
//    gpu.port f30 ..... a 640 x 480 test image through halftone30 (WGSL) and
//                       through the two-argument upstream halftone (GLSL in
//                       WebGL 1 with OES_standard_derivatives): every pixel;
//                       and 3000 sample pixels against halftone-ref.js
//    gpu.port f75 ..... the same with the three-argument form, frequency 75
//    gpu.noerrors ..... no console, exception or WebGPU validation error
//  Page part (when index.html is there; the same Chrome, a new navigation):
//    page.load ........ the page boots with no exception, console error or
//                       WebGPU validation error
//    page.upstream .... the page's own view pipeline (present.wgsl, upstream
//                       path) renders the source at its own size; 3000
//                       sample pixels against halftone-ref.js on the source
//                       bytes that the page read back. Sources: Spectrum
//                       (a procedural scene) and Aldrin (a photo, mip chain)
//  The GLSL below is the upstream code (glsl-halftone index.glsl, glsl-noise
//  simplex/2d, glsl-aastep), put together as glslify does. MIT: see
//  LICENSE-glsl-halftone.txt and LICENSE-webgl-noise.txt.
//  Exit code 0 when every test passes.
// ============================================================================
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as R from './halftone-ref.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const PORT = +opt('port', 9852);
const SERVER = opt('server', 'http://127.0.0.1:8963');
const BASE = `${SERVER}/stella-nova/pages/halftone/`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = [];
const report = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };
const lcg = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };

// ── the upstream GLSL ─────────────────────────────────────────────────────
const GLSL_NOISE = `
vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}
vec2 mod289(vec2 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}
vec3 permute(vec3 x) {
  return mod289(((x*34.0)+1.0)*x);
}
float snoise(vec2 v)
  {
  const vec4 C = vec4(0.211324865405187,  // (3.0-sqrt(3.0))/6.0
                      0.366025403784439,  // 0.5*(sqrt(3.0)-1.0)
                     -0.577350269189626,  // -1.0 + 2.0 * C.x
                      0.024390243902439); // 1.0 / 41.0
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i); // Avoid truncation effects in permutation
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
    + i.x + vec3(0.0, i1.x, 1.0 ));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m ;
  m = m*m ;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
`;
const GLSL_HALFTONE = GLSL_NOISE + `
float aastep(float threshold, float value) {
  #ifdef GL_OES_standard_derivatives
    float afwidth = length(vec2(dFdx(value), dFdy(value))) * 0.70710678118654757;
    return smoothstep(threshold-afwidth, threshold+afwidth, value);
  #else
    return step(threshold, value);
  #endif
}
vec3 halftone(vec3 texcolor, vec2 st, float frequency) {
  float n = 0.1*snoise(st*200.0); // Fractal noise
  n += 0.05*snoise(st*400.0);
  n += 0.025*snoise(st*800.0);
  vec3 white = vec3(n*0.2 + 0.97);
  vec3 black = vec3(n + 0.1);
  vec4 cmyk;
  cmyk.xyz = 1.0 - texcolor;
  cmyk.w = min(cmyk.x, min(cmyk.y, cmyk.z)); // Create K
  cmyk.xyz -= cmyk.w; // Subtract K equivalent from CMY
  vec2 Kst = frequency*mat2(0.707, -0.707, 0.707, 0.707)*st;
  vec2 Kuv = 2.0*fract(Kst)-1.0;
  float k = aastep(0.0, sqrt(cmyk.w)-length(Kuv)+n);
  vec2 Cst = frequency*mat2(0.966, -0.259, 0.259, 0.966)*st;
  vec2 Cuv = 2.0*fract(Cst)-1.0;
  float c = aastep(0.0, sqrt(cmyk.x)-length(Cuv)+n);
  vec2 Mst = frequency*mat2(0.966, 0.259, -0.259, 0.966)*st;
  vec2 Muv = 2.0*fract(Mst)-1.0;
  float m = aastep(0.0, sqrt(cmyk.y)-length(Muv)+n);
  vec2 Yst = frequency*st; // 0 deg
  vec2 Yuv = 2.0*fract(Yst)-1.0;
  float y = aastep(0.0, sqrt(cmyk.z)-length(Yuv)+n);
  vec3 rgbscreen = 1.0 - 0.9*vec3(c,m,y) + n;
  return mix(rgbscreen, black, 0.85*k + 0.3*n);
}
vec3 halftone(vec3 texcolor, vec2 st) {
  return halftone(texcolor, st, 30.0);
}
`;

// snoise of the upstream GLSL at these points: WebGL 2, highp, read back as
// float32 (Chrome 154, ANGLE on Metal, Apple GPU). See cpu.noise.ref.
const NOISE_PTS = [[0, 0], [0.5, 0.25], [1.7, -3.2], [12.34, 56.78], [-7.5, 2.25], [100.1, 200.2],
  [255.5, 31.25], [288.9, 289.1], [600.3, 412.7], [999.99, 1000.01], [1150.25, 803.5], [-640.5, 1199.75]];
const GLSL_NOISE_REF = [0.0000000, -0.21835580, -0.56729913, -0.56397891, 0.47094738, 0.19476946,
  -0.29987493, 0.58978665, -0.41558358, -0.20606011, -0.24766660, -0.33365583];

// ── CPU ────────────────────────────────────────────────────────────────────
function cpuTests() {
  if (GLSL_NOISE_REF) {
    let worst = 0;
    NOISE_PTS.forEach((p, i) => { worst = Math.max(worst, Math.abs(R.snoise(...p) - GLSL_NOISE_REF[i])); });
    report('cpu.noise.ref', worst < 1e-3, `max |js - glsl| = ${worst.toExponential(2)} over ${NOISE_PTS.length} points`);
  } else report('cpu.noise.ref', false, 'GLSL_NOISE_REF is not filled in');
  {
    const rnd = lcg(5);
    let lo = Infinity, hi = -Infinity, sum = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) { const v = R.snoise((rnd() - 0.5) * 2400, (rnd() - 0.5) * 2400); lo = Math.min(lo, v); hi = Math.max(hi, v); sum += v; }
    report('cpu.noise.range', lo >= -1 && hi <= 1 && Math.abs(sum / N) < 0.02, `min ${lo.toFixed(4)}, max ${hi.toFixed(4)}, mean ${(sum / N).toFixed(4)} over ${N} points`);
  }
  {
    // Flat greys: a 96 x 96 patch of a 960 x 960 image, frequency 30.
    const means = [];
    for (const g of [1, 0.85, 0.7, 0.55, 0.4, 0.25, 0.1, 0]) {
      let s = 0, n = 0;
      for (let y = 300; y < 396; y++) for (let x = 300; x < 396; x++) {
        const o = R.halftonePixel(() => [g, g, g], 960, 960, x, y, 30).fine;
        s += (o[0] + o[1] + o[2]) / 3; n++;
      }
      means.push(+(s / n).toFixed(3));
    }
    const mono = means.every((v, i) => !i || v < means[i - 1]);
    report('cpu.tone', mono, `mean output for grey 1 .. 0: ${means.join(', ')}`);
  }
}

// ── the in-page harness (runs in Chrome; serialised with toString) ────────
function harness() {
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const T = window.__T = { errors: [] };
  // The test image: smooth colour fields, a grey ramp, hard edges, flat patches.
  T.image = (W, H) => {
    const d = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H, o = (y * W + x) * 4;
      let r = 0.5 + 0.5 * Math.sin(6.283 * (u * 1.3 + v * 0.4)), g = 0.5 + 0.5 * Math.sin(6.283 * (v * 1.1 - u * 0.3) + 1), b = 0.5 + 0.5 * Math.cos(6.283 * (u * 0.7 + v * 0.9));
      if (v > 0.8) r = g = b = u;                                   // grey ramp
      if (u > 0.62 && u < 0.8 && v > 0.15 && v < 0.45) { r = 0.9; g = 0.2; b = 0.1; }   // flat red
      if (u > 0.05 && u < 0.2 && v > 0.5 && v < 0.75) { r = g = b = 0.03; }              // near black
      d[o] = Math.round(r * 255); d[o + 1] = Math.round(g * 255); d[o + 2] = Math.round(b * 255); d[o + 3] = 255;
    }
    return d;
  };
  T.setup = async (wgsl) => {
    const ad = await navigator.gpu.requestAdapter();
    const dev = T.dev = await ad.requestDevice();
    dev.addEventListener('uncapturederror', e => T.errors.push(String(e.error && e.error.message)));
    const check = async (m, l) => { const i = await m.getCompilationInfo(); const e = i.messages.filter(q => q.type === 'error'); if (e.length) throw new Error(l + ': ' + e.map(q => q.lineNum + ':' + q.message).join('; ')); };
    const frag = wgsl + `
@group(0) @binding(0) var img: texture_2d<f32>;
@group(0) @binding(1) var<uniform> P: vec4f;   // W, H, frequency, two-argument form (1)
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let texcolor = textureLoad(img, vec2i(pos.xy), 0);
  let uv = pos.xy / P.xy;
  let st = vec2f(uv.x * (P.x / P.y), 1.0 - uv.y);
  var rgb: vec3f;
  if (P.w > 0.5) { rgb = halftone30(texcolor.rgb, st); } else { rgb = halftone(texcolor.rgb, st, P.z); }
  return vec4f(rgb, 1.0);
}`;
    const comp = wgsl + `
@group(0) @binding(0) var<storage, read> pts: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> outv: array<f32>;
@compute @workgroup_size(64) fn cs(@builtin(global_invocation_id) id: vec3u) {
  if (id.x < arrayLength(&pts)) { outv[id.x] = snoise(pts[id.x]); }
}`;
    const fm = dev.createShaderModule({ code: frag }), cm = dev.createShaderModule({ code: comp });
    await check(fm, 'wrapper'); await check(cm, 'noise');
    T.pRender = dev.createRenderPipeline({ layout: 'auto', vertex: { module: fm, entryPoint: 'vs' }, fragment: { module: fm, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } });
    T.pNoise = dev.createComputePipeline({ layout: 'auto', compute: { module: cm, entryPoint: 'cs' } });
    return true;
  };
  T.read = async (buf, size) => {
    const dev = T.dev, rd = dev.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = dev.createCommandEncoder(); enc.copyBufferToBuffer(buf, 0, rd, 0, size); dev.queue.submit([enc.finish()]);
    await rd.mapAsync(GPUMapMode.READ); const out = new Uint8Array(rd.getMappedRange().slice(0)); rd.unmap(); return out;
  };
  T.noiseWGSL = async pts => {
    const dev = T.dev, n = pts.length;
    const a = dev.createBuffer({ size: n * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const b = dev.createBuffer({ size: n * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    dev.queue.writeBuffer(a, 0, new Float32Array(pts.flat()));
    const bg = dev.createBindGroup({ layout: T.pNoise.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: a } }, { binding: 1, resource: { buffer: b } }] });
    const enc = dev.createCommandEncoder(); const p = enc.beginComputePass(); p.setPipeline(T.pNoise); p.setBindGroup(0, bg); p.dispatchWorkgroups(Math.ceil(n / 64)); p.end(); dev.queue.submit([enc.finish()]);
    return Array.from(new Float32Array((await T.read(b, n * 4)).buffer));
  };
  T.noiseGLSL = (pts, noiseSrc) => {
    const n = pts.length, W = 64, H = Math.ceil(n / W);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const gl = cv.getContext('webgl2'); if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('no EXT_color_buffer_float');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;\nprecision highp sampler2D;\nuniform sampler2D pts;\nout vec4 o;\n' + noiseSrc +
      '\nvoid main(){ vec2 p = texelFetch(pts, ivec2(gl_FragCoord.xy), 0).xy; o = vec4(snoise(p), 0.0, 0.0, 1.0); }'));
    gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const pt = new Float32Array(W * H * 4); pts.forEach((p, i) => { pt[i * 4] = p[0]; pt[i * 4 + 1] = p[1]; });
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, pt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const rt = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, rt); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, null);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rt, 0);
    gl.viewport(0, 0, W, H); gl.useProgram(prog); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(gl.getUniformLocation(prog, 'pts'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const out = new Float32Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, out);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return pts.map((_, i) => out[i * 4]);
  };
  T.renderWGSL = async (W, H, freq, two) => {
    const dev = T.dev, img = T.image(W, H);
    const tex = dev.createTexture({ size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    dev.queue.writeTexture({ texture: tex }, img, { bytesPerRow: W * 4 }, [W, H]);
    const tgt = dev.createTexture({ size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const ub = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(ub, 0, new Float32Array([W, H, freq, two ? 1 : 0]));
    const bg = dev.createBindGroup({ layout: T.pRender.getBindGroupLayout(0), entries: [{ binding: 0, resource: tex.createView() }, { binding: 1, resource: { buffer: ub } }] });
    const bpr = Math.ceil(W * 4 / 256) * 256, buf = dev.createBuffer({ size: bpr * H, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    const enc = dev.createCommandEncoder();
    const p = enc.beginRenderPass({ colorAttachments: [{ view: tgt.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    p.setPipeline(T.pRender); p.setBindGroup(0, bg); p.draw(3); p.end();
    enc.copyTextureToBuffer({ texture: tgt }, { buffer: buf, bytesPerRow: bpr }, [W, H]);
    dev.queue.submit([enc.finish()]);
    const raw = await T.read(buf, bpr * H), out = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) out.set(raw.subarray(y * bpr, y * bpr + W * 4), y * W * 4);
    return { img: b64(img), out: b64(out) };
  };
  // The upstream README example: WebGL 1, OES_standard_derivatives, uv from
  // gl_FragCoord (origin bottom left). Rows come back top first.
  T.renderGLSL = (W, H, freq, two, src) => {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const gl = cv.getContext('webgl', { antialias: false, preserveDrawingBuffer: true });
    if (!gl.getExtension('OES_standard_derivatives')) throw new Error('no OES_standard_derivatives');
    const sh = (type, s) => { const q = gl.createShader(type); gl.shaderSource(q, s); gl.compileShader(q); if (!gl.getShaderParameter(q, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(q)); return q; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `precision highp float;
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
uniform vec2 iResolution;
uniform sampler2D u_sampler;
uniform float u_freq;
uniform float u_two;
${src}
void main() {
  vec2 uv = gl_FragCoord.xy / iResolution;
  vec4 texcolor = texture2D(u_sampler, uv);
  vec2 st = uv;
  st.x *= iResolution.x / iResolution.y;
  gl_FragColor.rgb = u_two > 0.5 ? halftone(texcolor.rgb, st) : halftone(texcolor.rgb, st, u_freq);
  gl_FragColor.a = 1.0;
}`));
    gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const img = T.image(W, H), flip = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) flip.set(img.subarray(y * W * 4, (y + 1) * W * 4), (H - 1 - y) * W * 4);
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, flip);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.uniform2f(gl.getUniformLocation(prog, 'iResolution'), W, H);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_freq'), freq);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_two'), two ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_sampler'), 0);
    gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const out = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) out.set(px.subarray(y * W * 4, (y + 1) * W * 4), (H - 1 - y) * W * 4);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return b64(out);
  };
}

// ── GPU (headless Chrome) ──────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const unb64 = s => new Uint8Array(Buffer.from(s, 'base64'));

export async function withChrome(fn, { width = 1280, height = 800, args = [] } = {}) {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'ht-test-'));
  const chrome = spawn(CHROME, ['--headless=new', '--enable-unsafe-webgpu', '--use-angle=metal', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${prof}`, `--window-size=${width},${height}`, ...args, 'about:blank'], { stdio: 'ignore' });
  const log = [];
  let ws;
  try {
    let list = null;
    for (let i = 0; i < 60 && !list; i++) { try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch (e) { await sleep(250); } }
    if (!list) throw new Error('chrome did not start on port ' + PORT);
    ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
    let id = 0; const pend = new Map();
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') log.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
      if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) log.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') log.push('log: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
      if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) log.push('http ' + m.params.response.status + ' ' + m.params.response.url);
    };
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed'); return r && r.result ? r.result.value : r; };
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Log.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    return await fn({ send, ev, log });
  } finally {
    try { ws && ws.close(); } catch (e) {}
    chrome.kill('SIGKILL');
    await sleep(300);
    fs.rmSync(prof, { recursive: true, force: true });
  }
}

// Compare two RGBA byte images; returns the share of pixels with every
// channel within tol, the max difference and the count over 16.
function diffStats(a, b, tol = 2) {
  let n = 0, ok = 0, max = 0, big = 0;
  for (let i = 0; i < a.length; i += 4) {
    let m = 0; for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(a[i + c] - b[i + c]));
    n++; if (m <= tol) ok++; if (m > 16) big++; max = Math.max(max, m);
  }
  return { n, share: ok / n, max, big };
}

// CPU halftone at sample pixels of a W x H RGBA image; the best of 'fine'
// and 'coarse' derivatives per pixel against got.
function cpuSamples(img, got, W, H, freq, count, seed) {
  const tex = (x, y) => { x = Math.min(W - 1, Math.max(0, x)); y = Math.min(H - 1, Math.max(0, y)); const o = (y * W + x) * 4; return [img[o] / 255, img[o + 1] / 255, img[o + 2] / 255]; };
  const rnd = lcg(seed);
  let ok = 0, max = 0;
  const worst = [];
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rnd() * W), y = Math.floor(rnd() * H), o = (y * W + x) * 4;
    const r = R.halftonePixel(tex, W, H, x, y, freq);
    const d = mode => Math.max(...[0, 1, 2].map(c => Math.abs(R.q8(r[mode][c]) - got[o + c])));
    const m = Math.min(d('fine'), d('coarse'));
    if (m <= 2) ok++; else worst.push([x, y, m]);
    max = Math.max(max, m);
  }
  return { n: count, share: ok / count, max, worst: worst.sort((a, b) => b[2] - a[2]).slice(0, 3) };
}

async function gpuTests() {
  await withChrome(async ({ send, ev, log }) => {
    await send('Page.navigate', { url: BASE + 'CREDITS.txt' });
    await sleep(800);
    await ev(`(${harness.toString()})(); true`);
    const wgsl = fs.readFileSync(path.join(HERE, 'shaders/halftone.wgsl'), 'utf8');
    await ev(`__T.setup(${JSON.stringify(wgsl)})`);

    // Noise: WGSL, GLSL, JS.
    const rnd = lcg(21), pts = NOISE_PTS.slice();
    while (pts.length < 2048) { const s = [2, 20, 300, 1200][pts.length % 4]; pts.push([(rnd() - 0.5) * 2 * s, (rnd() - 0.5) * 2 * s]); }
    const w = await ev(`__T.noiseWGSL(${JSON.stringify(pts)})`);
    const g = await ev(`__T.noiseGLSL(${JSON.stringify(pts)}, ${JSON.stringify(GLSL_NOISE)})`);
    let wg = 0, wj = 0, gj = 0;
    pts.forEach((p, i) => { const j = R.snoise(...p); wg = Math.max(wg, Math.abs(w[i] - g[i])); wj = Math.max(wj, Math.abs(w[i] - j)); gj = Math.max(gj, Math.abs(g[i] - j)); });
    report('gpu.noise', wg < 2e-3 && wj < 2e-3, `${pts.length} points: max |wgsl - glsl| ${wg.toExponential(2)}, |wgsl - js| ${wj.toExponential(2)}, |glsl - js| ${gj.toExponential(2)}`);
    console.log('INFO  glsl snoise at NOISE_PTS: [' + g.slice(0, NOISE_PTS.length).map(v => v.toPrecision(8)).join(', ') + ']');

    // The halftone, 640 x 480.
    const W = 640, H = 480;
    for (const [freq, two] of [[30, true], [75, false]]) {
      const r = await ev(`__T.renderWGSL(${W}, ${H}, ${freq}, ${two})`);
      const img = unb64(r.img), out = unb64(r.out);
      const gl = unb64(await ev(`__T.renderGLSL(${W}, ${H}, ${freq}, ${two}, ${JSON.stringify(GLSL_HALFTONE)})`));
      const s = diffStats(out, gl);
      const c = cpuSamples(img, out, W, H, freq, 3000, freq);
      const ok = s.share >= 0.99 && c.share >= 0.99;
      report(`gpu.port f${freq}`, ok, `${two ? 'halftone30' : 'halftone(.., ' + freq + ')'}: wgsl vs glsl ${(100 * s.share).toFixed(3)}% of ${s.n} pixels within 2/255 (max ${s.max}, ${s.big} over 16); ` +
        `wgsl vs halftone-ref.js ${(100 * c.share).toFixed(2)}% of ${c.n} samples within 2/255 (max ${c.max}${c.worst.length ? ', worst ' + JSON.stringify(c.worst) : ''})`);
    }
    const late = await ev('__T.errors');
    report('gpu.noerrors', !log.length && !late.length, log.length || late.length ? JSON.stringify({ log, late }) : 'no console, exception or WebGPU errors');
    if (fs.existsSync(path.join(HERE, 'index.html'))) { log.length = 0; await pageTests({ send, ev, log }); }
  });
}

async function pageTests({ send, ev, log }) {
  await send('Page.navigate', { url: BASE + 'index.html' });
  let st = null;
  for (let i = 0; i < 120; i++) { await sleep(250); st = await ev('window.__ht ? { ready: __ht.ready, failed: __ht.failed } : null'); if (st && (st.ready || st.failed)) break; }
  await sleep(600);
  const gpuErr = await ev('__ht.errors');
  const ok = st && st.ready && !st.failed && !log.length && !gpuErr.length;
  report('page.load', ok, ok ? 'ready' : JSON.stringify({ st, log, gpuErr }));
  if (!st || !st.ready) return;
  for (const [key, freq] of [['spectrum', 30], ['aldrin', 30], ['aldrin', 90]]) {
    const size = await ev(`__ht.setSource(${JSON.stringify(key)}, ${freq})`);
    const r = await ev('__ht.exact()');
    const out = unb64(r.out), src = unb64(r.src);
    const c = cpuSamples(src, out, r.w, r.h, freq, 3000, 7 + freq);
    report(`page.upstream ${key} f${freq}`, c.share >= 0.99, `${size.join(' x ')}: ${(100 * c.share).toFixed(2)}% of ${c.n} samples within 2/255 of halftone-ref.js (max ${c.max}${c.worst.length ? ', worst ' + JSON.stringify(c.worst) : ''})`);
  }
  const late = await ev('__ht.errors');
  report('page.noerrors', !log.length && !late.length, log.length || late.length ? JSON.stringify({ log, late }) : 'no console, exception or WebGPU errors');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  cpuTests();
  if (!argv.includes('--cpu-only')) {
    try { await gpuTests(); } catch (e) { report('gpu', false, String(e && e.stack || e)); }
  }
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
