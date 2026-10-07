// ============================================================================
//  ANTENNA FIELDS  ·  field-gl.js — the GPU field on a plane (WebGL2)
// ----------------------------------------------------------------------------
//  Two fragment passes on one WebGL2 context.
//
//  PHASOR PASS (only when the antenna or the view changes). Each pixel of the
//  view plane sums the exact Hertzian element fields of em.js (near,
//  intermediate and far terms) over the element texture, and writes the
//  complex phasors to four RGBA32F targets (multiple render targets):
//      T0 = Ex re, Ex im, Ey re, Ey im      T1 = Ez re, Ez im, Hx re, Hx im
//      T2 = Hy re, Hy im, Hz re, Hz im      T3 = psi re, psi im
//  psi is a flux function. Its contours are exact field lines:
//      psiMode 1  z currents, side plane:  E lines = contours of Re{-j x H_y e^{jwt}}
//                 (x H_y = rho H_phi; E = curl(H)/(j w eps) for an axial source)
//      psiMode 2  uniform loop, side plane: B lines = contours of Re{x A_y e^{jwt}}
//      psiMode 3  z currents, top plane:   B lines = contours of Re{A_z e^{jwt}}
//  The same pass also renders a small probe grid that the CPU reads back
//  (readProbe) for the field-line tracer, the Poynting arrows and the
//  colour scale.
//
//  DISPLAY PASS (every frame). Re{F e^{jwt}} = F_re cos wt - F_im sin wt,
//  then a colour map (signed component, in-plane magnitude, or the
//  instantaneous or the time-average Poynting magnitude), the psi contours,
//  a faint wavelength grid, and, in the screensaver, the 2D overlay canvas as
//  a texture so the returned canvas holds the whole picture.
//  The float targets are read with texelFetch and a manual bilinear filter,
//  because iOS has no OES_texture_float_linear.
//
//  grep -n: "const PHASOR_FS"  "const DISPLAY_FS"  "export function createField"
//           "function phasorPass"  "readProbe"  "draw(p)"
// ============================================================================

const VS = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

// The element texture: column i, row 0 = position xyz + moment re;
// row 1 = unit direction xyz + moment im.
const PHASOR_FS = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uElems;
uniform int uN;
uniform vec2 uOrigin;   // plane coords of pixel (0, 0) centre
uniform vec2 uStep;     // plane units per pixel
uniform vec3 uAxU;
uniform vec3 uAxV;
uniform float uSoft;
uniform int uPsi;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3;
const float K = 6.283185307179586;
const float ETA = 376.730313668;
const float FOUR_PI = 12.566370614359172;
void main(){
  vec2 uv = uOrigin + (gl_FragCoord.xy - 0.5) * uStep;
  vec3 p = uv.x * uAxU + uv.y * uAxV;
  vec3 Er = vec3(0.0), Ei = vec3(0.0), Hr = vec3(0.0), Hi = vec3(0.0), Ar = vec3(0.0), Ai = vec3(0.0);
  for (int i = 0; i < 1024; i++) {
    if (i >= uN) break;
    vec4 a = texelFetch(uElems, ivec2(i, 0), 0);
    vec4 b = texelFetch(uElems, ivec2(i, 1), 0);
    vec3 d = p - a.xyz;
    float dl = length(d);
    float R = sqrt(dl * dl + uSoft * uSoft);
    vec3 rh = d / max(dl, 1e-7);
    vec3 u = b.xyz;
    float x = K * R, ix = 1.0 / x;
    float c = cos(x), s = -sin(x);
    float er = a.w * c - b.w * s, ei = a.w * s + b.w * c;
    float kr = K / (FOUR_PI * R);
    float p2 = 1.0 - ix * ix;
    float A_r = ETA * kr * (ix * er - p2 * ei), A_i = ETA * kr * (ix * ei + p2 * er);
    float bq = 2.0 * ETA * kr * ix;
    float B_r = bq * (er + ix * ei), B_i = bq * (ei - ix * er);
    float C_r = kr * (ix * er - ei), C_i = kr * (ix * ei + er);
    float ud = dot(u, rh);
    Er += (B_r + A_r) * ud * rh - A_r * u;
    Ei += (B_i + A_i) * ud * rh - A_i * u;
    vec3 cr = cross(u, rh);
    Hr += C_r * cr;
    Hi += C_i * cr;
    float ia = 1.0 / (FOUR_PI * R);
    Ar += er * ia * u;
    Ai += ei * ia * u;
  }
  o0 = vec4(Er.x, Ei.x, Er.y, Ei.y);
  o1 = vec4(Er.z, Ei.z, Hr.x, Hi.x);
  o2 = vec4(Hr.y, Hi.y, Hr.z, Hi.z);
  vec2 psi = vec2(0.0);
  if (uPsi == 1) psi = vec2(p.x * Hi.y, -p.x * Hr.y);
  else if (uPsi == 2) psi = vec2(p.x * Ar.y, p.x * Ai.y);
  else if (uPsi == 3) psi = vec2(Ar.z, Ai.z);
  o3 = vec4(psi, 0.0, 1.0);
}`;

const DISPLAY_FS = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uP0;
uniform highp sampler2D uP1;
uniform highp sampler2D uP2;
uniform highp sampler2D uP3;
uniform sampler2D uOverlay;
uniform vec2 uPhSize;      // the used part of the phasor textures
uniform vec2 uRatio;       // phasor px per canvas px
uniform vec2 uOrigin;      // plane coords of canvas pixel (0, 0) centre
uniform vec2 uStep;        // plane units per canvas pixel
uniform vec3 uAxU;
uniform vec3 uAxV;
uniform vec3 uCentre;
uniform float uPhase;
uniform int uMode;         // 0 E, 1 H, 2 S(t), 3 <S>, 4 lines on dark
uniform vec4 uComp;        // xyz: signed component axis; w > 0.5: in-plane magnitude
uniform float uGain;
uniform int uLog;
uniform int uRcomp;
uniform float uRref;
uniform int uPsiOn;
uniform float uPsiScale;
uniform int uPsiLog;
uniform float uLineAlpha;
uniform float uGrid;       // grid spacing in plane units (0 = off)
uniform float uOverlayOn;
uniform float uFade;
out vec4 frag;

vec4 bil(highp sampler2D t, vec2 tc) {
  vec2 f = fract(tc);
  ivec2 i0 = ivec2(floor(tc));
  ivec2 mx = ivec2(uPhSize) - 1;
  ivec2 a = clamp(i0, ivec2(0), mx), b = clamp(i0 + ivec2(1, 0), ivec2(0), mx);
  ivec2 c = clamp(i0 + ivec2(0, 1), ivec2(0), mx), d = clamp(i0 + ivec2(1, 1), ivec2(0), mx);
  return mix(mix(texelFetch(t, a, 0), texelFetch(t, b, 0), f.x), mix(texelFetch(t, c, 0), texelFetch(t, d, 0), f.x), f.y);
}
float compress(float v) {
  // signed log or a soft linear clip, both to [-1, 1]
  if (uLog == 1) return sign(v) * log(1.0 + 40.0 * abs(v)) / log(41.0);
  return v / (1.0 + abs(v)) * 1.6;
}
vec3 bg = vec3(0.016, 0.02, 0.035);
vec3 diverge(float v, vec3 neg, vec3 pos) {
  float a = clamp(abs(v), 0.0, 1.0);
  vec3 c = v < 0.0 ? neg : pos;
  vec3 col = mix(bg, c, pow(a, 0.85));
  col = mix(col, vec3(1.0, 0.97, 0.92), smoothstep(0.72, 1.05, a) * 0.55);
  return col;
}
vec3 inferno(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.0002, 0.0016, -0.0194), c1 = vec3(0.1065, 0.5640, 3.9327), c2 = vec3(11.6024, -3.9728, -15.9423);
  vec3 c3 = vec3(-41.7039, 17.4364, 44.3541), c4 = vec3(77.1629, -33.4023, -81.8073), c5 = vec3(-71.3194, 32.6260, 73.2095), c6 = vec3(25.1311, -12.2426, -23.0703);
  return clamp(c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6))))), 0.0, 1.0);
}
void main(){
  vec2 tc = gl_FragCoord.xy * uRatio - 0.5;
  vec4 p0 = bil(uP0, tc), p1 = bil(uP1, tc), p2 = bil(uP2, tc), p3 = bil(uP3, tc);
  vec3 Er = vec3(p0.x, p0.z, p1.x), Ei = vec3(p0.y, p0.w, p1.y);
  vec3 Hr = vec3(p1.z, p2.x, p2.z), Hi = vec3(p1.w, p2.y, p2.w);
  float c = cos(uPhase), s = sin(uPhase);
  vec3 E = Er * c - Ei * s, H = Hr * c - Hi * s;
  vec2 uv = uOrigin + (gl_FragCoord.xy - 0.5) * uStep;
  vec3 P = uv.x * uAxU + uv.y * uAxV;
  float r = length(P - uCentre);
  float w = uRcomp == 1 ? max(r, 0.12) / uRref : 1.0;
  vec3 col;
  if (uMode <= 1) {
    vec3 F = uMode == 0 ? E : H;
    vec3 neg = uMode == 0 ? vec3(0.22, 0.78, 0.93) : vec3(0.45, 0.42, 1.0);
    vec3 pos = uMode == 0 ? vec3(1.0, 0.62, 0.32) : vec3(1.0, 0.36, 0.66);
    if (uComp.w > 0.5) {
      float m = length(vec2(dot(F, uAxU), dot(F, uAxV))) * uGain * w;
      float t = compress(m);
      col = mix(bg, pos, pow(clamp(t, 0.0, 1.0), 0.9));
      col = mix(col, vec3(1.0, 0.97, 0.92), smoothstep(0.75, 1.05, t) * 0.5);
    } else {
      float v = dot(F, uComp.xyz) * uGain * w;
      col = diverge(compress(v), neg, pos);
    }
  } else if (uMode <= 3) {
    vec3 S = uMode == 2 ? cross(E, H) : 0.5 * (cross(Er, Hr) + cross(Ei, Hi));
    float m = length(S) * uGain * w * w;
    float t = uLog == 1 ? log(1.0 + 60.0 * m) / log(61.0) : m / (1.0 + m) * 1.4;
    col = inferno(t * 0.95);
  } else {
    float m = length(E) * uGain * w;
    float t = compress(m);
    col = mix(bg, vec3(0.10, 0.22, 0.32), clamp(t, 0.0, 1.0));
  }
  // faint wavelength grid
  if (uGrid > 0.0) {
    vec2 g = abs(fract(uv / uGrid + 0.5) - 0.5) / (fwidth(uv) / uGrid);
    float gl = 1.0 - smoothstep(0.0, 1.2, min(g.x, g.y));
    vec2 ax = abs(uv) / fwidth(uv);
    float al = 1.0 - smoothstep(0.0, 1.4, min(ax.x, ax.y));
    col += vec3(0.5, 0.6, 0.7) * (gl * 0.045 + al * 0.06);
  }
  // flux-function contours: exact field lines
  if (uPsiOn == 1) {
    float ps = (p3.x * c - p3.y * s) * uPsiScale;
    float f = uPsiLog == 1 ? asinh(ps) * 1.25 : ps;
    float fw = fwidth(f);
    float d = abs(fract(f + 0.5) - 0.5) / max(fw, 1e-6);
    float line = 1.0 - smoothstep(0.35, 1.35, d);
    float glow = 1.0 - smoothstep(0.0, 5.0, d);
    float dense = 1.0 - smoothstep(0.22, 0.55, fw);
    vec3 lc = ps >= 0.0 ? vec3(1.0, 0.93, 0.84) : vec3(0.86, 0.95, 1.0);
    col += lc * glow * glow * dense * uLineAlpha * 0.16;
    col = mix(col, lc, line * dense * uLineAlpha);
  }
  // grain against banding
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) / 255.0;
  if (uOverlayOn > 0.5) {
    vec4 o = texture(uOverlay, vec2(gl_FragCoord.x, gl_FragCoord.y) / vec2(textureSize(uOverlay, 0)));
    col = col * (1.0 - o.a) + o.rgb;
  }
  frag = vec4(col * uFade, 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(sh); gl.deleteShader(sh); throw new Error('shader: ' + log); }
  return sh;
}
function program(gl, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

// Field renderer on a canvas. Returns null (with .reason on the thrown error)
// when WebGL2 or float render targets are missing.
export function createField(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 is not available');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('float render targets (EXT_color_buffer_float) are not available');
  const ph = program(gl, PHASOR_FS), disp = program(gl, DISPLAY_FS);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const elemTex = gl.createTexture();
  let nElem = 0;
  const overlayTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, overlayTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  function makeTarget(w, h) {
    const fb = gl.createFramebuffer(), tex = [];
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    for (let i = 0; i < 4; i++) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
      tex.push(t);
    }
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('float framebuffer incomplete: 0x' + st.toString(16));
    return { fb, tex, w, h };
  }
  function freeTarget(t) { if (!t) return; gl.deleteFramebuffer(t.fb); t.tex.forEach(x => gl.deleteTexture(x)); }
  let main = null, probe = null;

  // View: plane axes and the plane rectangle the canvas shows.
  const view = { axU: [1, 0, 0], axV: [0, 0, 1], u0: -2, v0: -1.25, u1: 2, v1: 1.25, centre: [0, 0, 0], psi: 0, soft: 0.004 };

  function setElems(L, soft) {
    nElem = Math.min(1024, L.n);
    const w = Math.max(1, nElem), data = new Float32Array(w * 2 * 4);
    for (let i = 0; i < nElem; i++) {
      const o = i * 8;
      data.set([L.d[o], L.d[o + 1], L.d[o + 2], L.d[o + 6]], i * 4);
      data.set([L.d[o + 3], L.d[o + 4], L.d[o + 5], L.d[o + 7]], (w + i) * 4);
    }
    gl.bindTexture(gl.TEXTURE_2D, elemTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, 2, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    if (soft != null) view.soft = soft;
  }

  // Render into the lower-left vw x vh texels of target t.
  function phasorPass(t, vw = t.w, vh = t.h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3]);
    gl.viewport(0, 0, vw, vh);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.CULL_FACE);
    gl.useProgram(ph.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, elemTex);
    gl.uniform1i(ph.u.uElems, 0);
    gl.uniform1i(ph.u.uN, nElem);
    const su = (view.u1 - view.u0) / vw, sv = (view.v1 - view.v0) / vh;
    gl.uniform2f(ph.u.uOrigin, view.u0 + 0.5 * su, view.v0 + 0.5 * sv);
    gl.uniform2f(ph.u.uStep, su, sv);
    gl.uniform3fv(ph.u.uAxU, view.axU);
    gl.uniform3fv(ph.u.uAxV, view.axV);
    gl.uniform1f(ph.u.uSoft, view.soft);
    gl.uniform1i(ph.u.uPsi, view.psi);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // Phasor field at scale x the canvas size. The targets have the canvas
  // size and are made again only when the canvas size changes; a lower scale
  // renders into the lower-left part. (A new 65 MB target set for each new
  // scale ran the GPU process out of memory in a morph shot.)
  let used = [8, 8];
  function compute(scale) {
    const W = Math.max(8, canvas.width), H = Math.max(8, canvas.height);
    if (!main || main.w !== W || main.h !== H) { freeTarget(main); main = null; main = makeTarget(W, H); }
    const sc = Math.min(1, Math.max(0.1, scale || 1));
    used = [Math.max(8, Math.round(W * sc)), Math.max(8, Math.round(H * sc))];
    phasorPass(main, used[0], used[1]);
  }

  // Small grid for the CPU: returns Float32Arrays T0..T3 (RGBA per texel,
  // row 0 = the bottom of the view).
  function readProbe(w, h) {
    if (!probe || probe.w !== w || probe.h !== h) { freeTarget(probe); probe = makeTarget(w, h); }
    phasorPass(probe);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, probe.fb);
    const out = [];
    for (let i = 0; i < 4; i++) {
      gl.readBuffer(gl.COLOR_ATTACHMENT0 + i);
      const a = new Float32Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, a);
      out.push(a);
    }
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    return { w, h, T: out };
  }

  let ovSize = '';
  function uploadOverlay(c2d) {
    gl.bindTexture(gl.TEXTURE_2D, overlayTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    // Same size: write into the old storage, no new allocation each frame.
    const key = c2d.width + 'x' + c2d.height;
    if (key === ovSize) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, c2d);
    else { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c2d); ovSize = key; }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  // p: { phase, mode, comp [x y z w], gain, log, rcomp, rref, psiOn, psiScale,
  //      psiLog, lineAlpha, grid, overlay (bool), fade }
  function draw(p) {
    if (!main) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.CULL_FACE);
    gl.useProgram(disp.p);
    const U = disp.u;
    for (let i = 0; i < 4; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, main.tex[i]); }
    gl.uniform1i(U.uP0, 0); gl.uniform1i(U.uP1, 1); gl.uniform1i(U.uP2, 2); gl.uniform1i(U.uP3, 3);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, overlayTex); gl.uniform1i(U.uOverlay, 4);
    gl.uniform2f(U.uPhSize, used[0], used[1]);
    gl.uniform2f(U.uRatio, used[0] / canvas.width, used[1] / canvas.height);
    const su = (view.u1 - view.u0) / canvas.width, sv = (view.v1 - view.v0) / canvas.height;
    gl.uniform2f(U.uOrigin, view.u0 + 0.5 * su, view.v0 + 0.5 * sv);
    gl.uniform2f(U.uStep, su, sv);
    gl.uniform3fv(U.uAxU, view.axU); gl.uniform3fv(U.uAxV, view.axV); gl.uniform3fv(U.uCentre, view.centre);
    gl.uniform1f(U.uPhase, p.phase);
    gl.uniform1i(U.uMode, p.mode);
    gl.uniform4fv(U.uComp, p.comp);
    gl.uniform1f(U.uGain, p.gain);
    gl.uniform1i(U.uLog, p.log ? 1 : 0);
    gl.uniform1i(U.uRcomp, p.rcomp ? 1 : 0);
    gl.uniform1f(U.uRref, p.rref || 1);
    gl.uniform1i(U.uPsiOn, p.psiOn ? 1 : 0);
    gl.uniform1f(U.uPsiScale, p.psiScale || 1);
    gl.uniform1i(U.uPsiLog, p.psiLog ? 1 : 0);
    gl.uniform1f(U.uLineAlpha, p.lineAlpha ?? 0.85);
    gl.uniform1f(U.uGrid, p.grid || 0);
    gl.uniform1f(U.uOverlayOn, p.overlay ? 1 : 0);
    gl.uniform1f(U.uFade, p.fade ?? 1);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  function destroy() {
    try { freeTarget(main); freeTarget(probe); const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (e) { /* already lost */ }
  }

  return { gl, canvas, view, setElems, compute, readProbe, uploadOverlay, draw, destroy, get size() { return main ? used.slice() : [0, 0]; } };
}
