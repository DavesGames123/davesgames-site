// ============================================================================
//  PARTICLE COLLIDER  ·  lightfield.js — trails as branched light filaments
// ----------------------------------------------------------------------------
//  The 2D detector diagrams draw their tracks through this module. It
//  follows the look of the Branched Flow page (pages/cube_branched_flow):
//  many thin ribbons summed with additive blending into a light buffer, so
//  where rays bunch (a shower, a jet, the vertex) they form bright
//  filaments that branch and fork, with a soft glow, on a dark field.
//
//  PIPELINE (WebGL2, one context per view)
//    1. ribbons -> accum (RGBA16F, blend ONE ONE). Across a ribbon the
//       light is a core-plus-glow falloff (p = 1 - |edge|, s = p^2,
//       h = s^2 p, as the branched-flow filament shader); along it the
//       brightness goes from the value at its start to the value at its
//       end (the caller gives a hot head and a dim tail: the long-exposure
//       persistence), and the hue drifts from the particle colour toward
//       the branched-flow tip hue.
//    2. accum -> half-size glow (box downsample, then a 9-tap Gaussian,
//       horizontal and vertical).
//    3. accum + glow -> canvas: a soft clip that keeps the hue,
//       o / (1 + max(o) / K), a warm tint where the light is hottest, and
//       the dark field colour behind.
//  Without WebGL2 the ribbons draw as canvas 2D 'lighter' strokes.
//
//  createLight(canvas) -> { ok, resize(w, h), draw(buf, n, o), clear() }
//    buf: Float32Array, 12 floats per ribbon:
//      x0 y0 x1 y1 (device px), r g b (linear 0..1), width (px),
//      b0 b1 (brightness at each end), hue drift (0..1), unused
//    o: { gain, K, glow, bg: [r, g, b] }
//
//  GREP MAP  const RIB_VS / RIB_FS / BLUR_FS / OUT_FS · function createLight
// ============================================================================
const RIB_VS = `#version 300 es
in vec2 aCorner;
in vec4 aSeg; in vec4 aCol; in vec4 aB;
uniform vec2 uRes;
out float vEdge, vAlong, vB0, vB1, vDrift; out vec3 vCol;
void main(){
  vec2 a = aSeg.xy, b = aSeg.zw, d = b - a; float L = length(d);
  vec2 dir = L > 1e-4 ? d / L : vec2(1.0, 0.0), nrm = vec2(-dir.y, dir.x);
  float hw = max(aCol.w, 1.0) * 0.5 + 1.0;
  vec2 p = mix(a, b, aCorner.x) + dir * (aCorner.x * 2.0 - 1.0) * hw * 0.6 + nrm * aCorner.y * hw;
  vEdge = aCorner.y; vAlong = aCorner.x; vB0 = aB.x; vB1 = aB.y; vDrift = aB.z; vCol = aCol.rgb;
  gl_Position = vec4(p / uRes * 2.0 - 1.0, 0.0, 1.0) * vec4(1.0, -1.0, 1.0, 1.0);
}`;
const RIB_FS = `#version 300 es
precision highp float;
in float vEdge, vAlong, vB0, vB1, vDrift; in vec3 vCol;
uniform float uGain;
out vec4 o;
void main(){
  float p = 1.0 - abs(vEdge); if (p <= 0.0) discard;
  float s = p * p, h = s * s * p;
  float br = mix(vB0, vB1, clamp(vAlong, 0.0, 1.0));
  // the branched-flow drift: toward a pale cyan-violet at the far end
  vec3 tip = vec3(0.55, 0.62, 1.0), c = mix(vCol, tip, vDrift * vAlong * 0.55);
  o = vec4(c * br * uGain * (0.12 * s + 1.0 * h), 1.0);
}`;
const QUAD_VS = `#version 300 es
in vec2 aCorner; out vec2 vUv;
void main(){ vUv = aCorner * 0.5 + 0.5; gl_Position = vec4(aCorner, 0.0, 1.0); }`;
const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uTex; uniform vec2 uStep; out vec4 o;
void main(){
  const float w[5] = float[5](0.2270, 0.1945, 0.1216, 0.0540, 0.0162);
  vec3 c = texture(uTex, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) { c += texture(uTex, vUv + uStep * float(i)).rgb * w[i]; c += texture(uTex, vUv - uStep * float(i)).rgb * w[i]; }
  o = vec4(c, 1.0);
}`;
const OUT_FS = `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uAcc, uGlow; uniform float uK, uGlowK; uniform vec3 uBg; out vec4 o;
void main(){
  vec3 c = texture(uAcc, vUv).rgb + texture(uGlow, vUv).rgb * uGlowK;
  float m = max(max(c.r, c.g), c.b);
  vec3 t = c / (1.0 + m / uK);
  // hot: where the light bunches, a warm tint (the branched-flow hot core)
  float heat = smoothstep(0.55, 1.4, m);
  t = mix(t, vec3(1.0, 0.93, 0.82) * max(max(t.r, t.g), t.b), heat * 0.45);
  vec3 col = uBg + t;
  o = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}`;

export function createLight(canvas) {
  let gl = null;
  try { gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true }); } catch (e) { gl = null; }
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) return fallback(canvas);
  const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = (vs, fs) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; };
  const pR = prog(RIB_VS, RIB_FS), pB = prog(QUAD_VS, BLUR_FS), pO = prog(QUAD_VS, OUT_FS);
  const U = (p, n) => gl.getUniformLocation(p, n);
  // geometry: a ribbon quad (instanced) and a full-screen quad
  const corner = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, corner);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1]), gl.STATIC_DRAW);
  const fsq = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, fsq);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
  const inst = gl.createBuffer();
  const vaoR = gl.createVertexArray(); gl.bindVertexArray(vaoR);
  gl.bindBuffer(gl.ARRAY_BUFFER, corner); let l = gl.getAttribLocation(pR, 'aCorner'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  for (const [n, off] of [['aSeg', 0], ['aCol', 16], ['aB', 32]]) { l = gl.getAttribLocation(pR, n); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 4, gl.FLOAT, false, 48, off); gl.vertexAttribDivisor(l, 1); }
  const vaoQ = (p) => { const v = gl.createVertexArray(); gl.bindVertexArray(v); gl.bindBuffer(gl.ARRAY_BUFFER, fsq); const a = gl.getAttribLocation(p, 'aCorner'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0); return v; };
  const vaoB = vaoQ(pB), vaoO = vaoQ(pO);
  gl.bindVertexArray(null);
  const target = (w, h) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { t, f, w, h };
  };
  let A = null, G1 = null, G2 = null, W = 0, H = 0;
  const free = q => { if (q) { gl.deleteTexture(q.t); gl.deleteFramebuffer(q.f); } };
  function resize(w, h) {
    w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
    if (w === W && h === H) return;
    W = w; H = h; canvas.width = w; canvas.height = h;
    free(A); free(G1); free(G2);
    A = target(w, h); G1 = target(w >> 1 || 1, h >> 1 || 1); G2 = target(w >> 1 || 1, h >> 1 || 1);
  }
  function draw(buf, n, o = {}) {
    if (!W) return;
    // 1. ribbons
    gl.bindFramebuffer(gl.FRAMEBUFFER, A.f); gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (n > 0) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(pR); gl.uniform2f(U(pR, 'uRes'), W, H); gl.uniform1f(U(pR, 'uGain'), o.gain ?? 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, inst); gl.bufferData(gl.ARRAY_BUFFER, buf.subarray(0, n * 12), gl.DYNAMIC_DRAW);
      gl.bindVertexArray(vaoR); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
      gl.disable(gl.BLEND);
    }
    // 2. glow: accum -> G1 (h blur) -> G2 (v blur), at half size
    gl.useProgram(pB); gl.bindVertexArray(vaoB);
    gl.bindFramebuffer(gl.FRAMEBUFFER, G1.f); gl.viewport(0, 0, G1.w, G1.h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, A.t); gl.uniform1i(U(pB, 'uTex'), 0); gl.uniform2f(U(pB, 'uStep'), 1.3 / G1.w, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, G2.f); gl.bindTexture(gl.TEXTURE_2D, G1.t); gl.uniform2f(U(pB, 'uStep'), 0, 1.3 / G1.h);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    // 3. out
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
    gl.useProgram(pO); gl.bindVertexArray(vaoO);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, A.t); gl.uniform1i(U(pO, 'uAcc'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, G2.t); gl.uniform1i(U(pO, 'uGlow'), 1);
    gl.uniform1f(U(pO, 'uK'), o.K ?? 1.3); gl.uniform1f(U(pO, 'uGlowK'), o.glow ?? 1.4);
    const bg = o.bg || [0.004, 0.006, 0.012]; gl.uniform3f(U(pO, 'uBg'), bg[0], bg[1], bg[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }
  return { ok: true, gl: true, canvas, resize, draw, clear() { draw(new Float32Array(12), 0); } };
}

// canvas 2D fallback: the same ribbons as 'lighter' strokes
function fallback(canvas) {
  const g = canvas.getContext('2d');
  let W = 0, H = 0;
  return {
    ok: true, gl: false, canvas,
    resize(w, h) { W = canvas.width = Math.max(2, Math.round(w)); H = canvas.height = Math.max(2, Math.round(h)); },
    draw(buf, n, o = {}) {
      g.globalCompositeOperation = 'source-over'; g.fillStyle = '#05070c'; g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
      const gain = o.gain ?? 1;
      for (let i = 0; i < n; i++) {
        const k = i * 12, br = Math.min(1, (buf[k + 8] + buf[k + 9]) * 0.5 * gain);
        if (br < 0.01) continue;
        const c = [buf[k + 4], buf[k + 5], buf[k + 6]].map(v => Math.round(255 * Math.pow(Math.min(1, v), 1 / 2.2)));
        g.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${(0.35 * br).toFixed(3)})`; g.lineWidth = Math.max(1, buf[k + 7] * 0.6);
        g.beginPath(); g.moveTo(buf[k], buf[k + 1]); g.lineTo(buf[k + 2], buf[k + 3]); g.stroke();
      }
      g.globalCompositeOperation = 'source-over';
    },
    clear() { g.fillStyle = '#05070c'; g.fillRect(0, 0, W, H); },
  };
}
