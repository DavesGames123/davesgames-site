// ============================================================================
//  JULIA FRACTALS  ·  pages/julia-fractals/gl.js — the WebGL2 renderer
// ----------------------------------------------------------------------------
//  Our code (davesgames.io). One full-screen triangle pair and the fragment
//  shader FRAG of fractal.js. Single precision: good to a pixel size near
//  1e-6 of the coordinates; main.js switches to the CPU renderer (double
//  precision, progressive) for deeper views.
//
//  createGL(canvas) -> { draw(V, P, lutBytes), destroy() } or null
//  grep -n targets: "export function createGL"
// ============================================================================
import { FRAG, VERT } from './fractal.js';

const COLOR = { mono: 0, gradient: 1, smooth: 2, bands: 3 };
export function createGL(canvas) {
  let gl = null;
  try { gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, alpha: false }); } catch (e) { gl = null; }
  if (!gl) return null;
  const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('julia shader:', gl.getShaderInfoLog(s)); return null; } return s; };
  const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn('julia link:', gl.getProgramInfoLog(prog)); return null; }
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const U = {}; for (const n of ['uRes', 'uCenter', 'uScale', 'uC', 'uIters', 'uMandel', 'uPower', 'uColor', 'uDensity', 'uOffset', 'uMirror', 'uInside', 'uLut']) U[n] = gl.getUniformLocation(prog, n);
  let lastLut = null; const rgba = new Uint8Array(256 * 4);
  return {
    gl,
    draw(V, P, lut) {
      const w = canvas.width, h = canvas.height;
      gl.viewport(0, 0, w, h); gl.useProgram(prog);
      if (lut !== lastLut) { for (let i = 0; i < 256; i++) { rgba[4 * i] = lut[3 * i]; rgba[4 * i + 1] = lut[3 * i + 1]; rgba[4 * i + 2] = lut[3 * i + 2]; rgba[4 * i + 3] = 255; } gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba); lastLut = lut; }
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U.uLut, 0);
      gl.uniform2f(U.uRes, w, h); gl.uniform2f(U.uCenter, V.cx, V.cy); gl.uniform1f(U.uScale, V.scale);
      gl.uniform2f(U.uC, V.c[0], V.c[1]); gl.uniform1i(U.uIters, V.iters); gl.uniform1i(U.uMandel, V.mandel ? 1 : 0); gl.uniform1f(U.uPower, V.power);
      gl.uniform1i(U.uColor, COLOR[P.color] ?? 2); gl.uniform1f(U.uDensity, P.density); gl.uniform1f(U.uOffset, P.offset); gl.uniform1i(U.uMirror, P.mirror ? 1 : 0);
      gl.uniform3f(U.uInside, P.inside[0] / 255, P.inside[1] / 255, P.inside[2] / 255);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    destroy() { try { const e = gl.getExtension('WEBGL_lose_context'); if (e) e.loseContext(); } catch (e) { /* gone */ } },
  };
}
