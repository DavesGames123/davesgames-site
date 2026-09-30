// glow-lines.js — draw many additive line segments in one WebGL2 call.
//
// A classic script (not a module), for the 2D-canvas physics pages. It
// replaces a loop of ctx.stroke() calls, one per segment, with
// globalCompositeOperation 'lighter' and lineCap 'round'. That loop costs
// about 1 us per stroke on the CPU: 2000 tracers x 35 segments x 2 passes is
// 140 000 strokes and 30 fps. Here each segment is one instance of a quad,
// and the fragment program keeps the pixels inside a capsule (a segment with
// round caps). Blending is additive, so overlaps add up as they did with
// 'lighter'.
//
//   const GL = GlowLines.create();         // null when WebGL2 is not available
//   GL.begin(ctx);                         // take the transform and size of ctx
//   GL.seg(x0, y0, x1, y1, r, g, b, w);    // user units of ctx; r g b = the
//                                          // additive color, 0..1; w = width
//   GL.flush(ctx);                         // draw all, add the result onto ctx
//
// begin() reads ctx.getTransform(), so the camera and the device pixel ratio
// of the page apply to the segments as they did to the strokes. flush() draws
// the WebGL canvas onto ctx with 'lighter' at the identity transform and
// restores ctx. A lost context makes create() objects return false from
// begin(); the page then uses its 2D path.
//
//   grep -n 'VS\b\|FS\b'   the shader sources
//   grep -n 'seg('         the instance layout (x0 y0 x1 y1 | r g b w)
(function () {
  'use strict';

  const VS = `#version 300 es
in vec2 aCorner;            // x: 0 or 1 along the segment, y: -1 or 1 across
in vec4 aSeg;               // x0 y0 x1 y1, user units
in vec4 aCol;               // r g b, width in user units
uniform mat3 uM;            // user units -> device px
uniform vec2 uRes;          // device px
uniform float uScale;       // device px per user unit
out vec2 vP;                // this pixel, device px
out vec4 vAB;               // segment ends, device px
out float vHw;              // half width, device px
out vec3 vCol;
out float vThin;            // coverage factor for lines under 1 px
void main() {
  vec2 a = (uM * vec3(aSeg.xy, 1.0)).xy;
  vec2 b = (uM * vec3(aSeg.zw, 1.0)).xy;
  float w = aCol.w * uScale;
  vHw = max(w, 1.0) * 0.5;
  vThin = min(w, 1.0);
  vec2 d = b - a;
  float L = length(d);
  vec2 dir = L > 1e-4 ? d / L : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float pad = vHw + 1.0;    // 1 px more for the antialias edge
  vec2 p = mix(a, b, aCorner.x) + dir * (aCorner.x * 2.0 - 1.0) * pad + nrm * aCorner.y * pad;
  vP = p; vAB = vec4(a, b); vCol = aCol.rgb;
  gl_Position = vec4(p / uRes * 2.0 - 1.0, 0.0, 1.0) * vec4(1.0, -1.0, 1.0, 1.0);
}`;

  const FS = `#version 300 es
precision highp float;
in vec2 vP; in vec4 vAB; in float vHw; in vec3 vCol; in float vThin;
out vec4 o;
void main() {
  vec2 pa = vP - vAB.xy, ba = vAB.zw - vAB.xy;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  float d = length(pa - ba * h);
  float cov = clamp(vHw + 0.5 - d, 0.0, 1.0) * vThin;
  if (cov <= 0.0) discard;
  o = vec4(vCol * cov, cov);   // premultiplied, as the 2D canvas expects
}`;

  function create() {
    const cv = document.createElement('canvas');
    let gl;
    try {
      gl = cv.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false });
    } catch (e) { gl = null; }
    if (!gl) return null;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    let prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (e) {
      console.warn('[glow-lines] WebGL2 program failed, 2D path in use.', e);
      return null;
    }
    gl.useProgram(prog);
    const loc = n => gl.getAttribLocation(prog, n);
    const uM = gl.getUniformLocation(prog, 'uM'), uRes = gl.getUniformLocation(prog, 'uRes'), uScale = gl.getUniformLocation(prog, 'uScale');
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const cb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc('aCorner'));
    gl.vertexAttribPointer(loc('aCorner'), 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ib);
    for (const [name, off] of [['aSeg', 0], ['aCol', 16]]) {
      const l = loc(name);
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, 4, gl.FLOAT, false, 32, off);
      gl.vertexAttribDivisor(l, 1);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    let lost = false;
    cv.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; });

    let data = new Float32Array(8 * 4096), n = 0, M = null;
    const api = {
      canvas: cv,
      begin(ctx) {
        if (lost) return false;
        const t = ctx.getTransform();
        M = t;
        const W = ctx.canvas.width, H = ctx.canvas.height;
        if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
        n = 0;
        return true;
      },
      seg(x0, y0, x1, y1, r, g, b, w) {
        if ((n + 1) * 8 > data.length) { const d = new Float32Array(data.length * 2); d.set(data); data = d; }
        const o = n * 8;
        data[o] = x0; data[o + 1] = y0; data[o + 2] = x1; data[o + 3] = y1;
        data[o + 4] = r; data[o + 5] = g; data[o + 6] = b; data[o + 7] = w;
        n++;
      },
      count() { return n; },
      flush(ctx) {
        if (lost || !M) return;
        gl.viewport(0, 0, cv.width, cv.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (n) {
          gl.useProgram(prog);
          gl.bindVertexArray(vao);
          gl.bindBuffer(gl.ARRAY_BUFFER, ib);
          gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * 8), gl.STREAM_DRAW);
          // DOMMatrix (a b c d e f) maps x' = a x + c y + e, y' = b x + d y + f.
          gl.uniformMatrix3fv(uM, false, [M.a, M.b, 0, M.c, M.d, 0, M.e, M.f, 1]);
          gl.uniform2f(uRes, cv.width, cv.height);
          gl.uniform1f(uScale, Math.sqrt(Math.abs(M.a * M.d - M.b * M.c)));
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
        }
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1;
        ctx.drawImage(cv, 0, 0);
        ctx.restore();
        n = 0;
      },
    };
    return api;
  }

  window.GlowLines = { create };
})();
