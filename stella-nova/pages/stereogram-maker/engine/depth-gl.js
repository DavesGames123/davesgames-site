// ============================================================================
//  STEREOGRAM ENGINE  ·  engine/depth-gl.js — the WebGL2 depth fast path
// ----------------------------------------------------------------------------
//  depthFromMeshGL(mesh, opts) gives the same DepthMap as depthFromMesh
//  (depth.js), but the GPU does the z-buffer. The CPU still projects the
//  vertices (projectMesh), so both paths share one camera. The fragment
//  shader writes the depth key, scaled to 0..1 over the key range of the
//  mesh, as 16 bits in the red and green bytes. The GL depth test keeps
//  the nearest surface. 16 bits give steps of 1/65535 of the range.
//  Returns null when OffscreenCanvas or WebGL2 is not there (node, an
//  old browser), so a caller falls back to the CPU path.
//
//  grep -n targets: "export function depthFromMeshGL", "const FS"
// ============================================================================
import { projectMesh, finish, seqIndex } from './depth.js';

const VS = `#version 300 es
in vec3 a; uniform vec2 size; out float k;
void main() { k = a.z; gl_Position = vec4(a.x / size.x * 2.0 - 1.0, 1.0 - a.y / size.y * 2.0, 1.0 - a.z * 2.0, 1.0); }`;
const FS = `#version 300 es
precision highp float; in float k; out vec4 o;
void main() { float v = floor(clamp(k, 0.0, 1.0) * 65535.0 + 0.5); o = vec4(floor(v / 256.0) / 255.0, mod(v, 256.0) / 255.0, 0.0, 1.0); }`;

let ctx = null;
function context(w, h) {
  if (typeof OffscreenCanvas === 'undefined') return null;
  if (!ctx) {
    const cv = new OffscreenCanvas(w, h), gl = cv.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) return null;
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(pr, 0, 'a'); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
    ctx = { cv, gl, pr, size: gl.getUniformLocation(pr, 'size'), vb: gl.createBuffer(), ib: gl.createBuffer() };
  }
  if (ctx.cv.width !== w || ctx.cv.height !== h) { ctx.cv.width = w; ctx.cv.height = h; }
  return ctx;
}

export function depthFromMeshGL(mesh, opts = {}) {
  let C;
  try { C = context(opts.w || 512, opts.h || 512); } catch { return null; }
  if (!C) return null;
  const { sx, sy, q, V, o } = projectMesh(mesh, opts), w = o.w | 0, h = o.h | 0, n = sx.length;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { if (q[i] < lo) lo = q[i]; if (q[i] > hi) hi = q[i]; }
  const span = hi - lo || 1, buf = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { buf[3 * i] = sx[i]; buf[3 * i + 1] = sy[i]; buf[3 * i + 2] = (q[i] - lo) / span; }
  const { gl } = C, idx = mesh.indices || seqIndex(n);
  gl.viewport(0, 0, w, h);
  gl.useProgram(C.pr); gl.uniform2f(C.size, w, h);
  gl.bindBuffer(gl.ARRAY_BUFFER, C.vb); gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STREAM_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, C.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx instanceof Uint32Array ? idx : Uint32Array.from(idx), gl.STREAM_DRAW);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.disable(gl.CULL_FACE);
  gl.clearColor(0, 0, 1, 1); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  // GL rows run bottom-up. Blue 255 marks the background.
  const zb = new Float32Array(w * h).fill(-Infinity);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = 4 * ((h - 1 - y) * w + x);
    if (px[j + 2] === 255) continue;
    const key = lo + (px[j] * 256 + px[j + 1]) / 65535 * span;
    zb[y * w + x] = V.persp ? V.D - 1 / key : key;
  }
  return finish(zb, w, h, o, o.norm === 'sphere');
}
