// ============================================================================
//  PHOTON CAUSTICS 3D  ·  gl.js — small WebGL2 helpers for the pool
// ----------------------------------------------------------------------------
//  A copy of pages/photon-caustics/gl.js: each page loads alone, so each
//  page has its own copy. Keep the two copies the same.
//  The caustic image adds many small values, so it
//  needs a float target that can blend: RGBA16F. WebGL2 can render to it
//  with EXT_color_buffer_float (or the half-float extension), and can
//  filter it with no extension. With neither extension the page falls back
//  to RGBA8, and bright caustics clip sooner.
//
//  EXPORTS
//    program ...... (gl, vs, fs) -> WebGLProgram with .u (uniform locations)
//    floatCaps .... (gl) -> { internal, type, float }
//    target ....... (gl, w, h, caps, filter) -> { tex, fbo, w, h }
//    drawFull ..... (gl) one triangle that covers the viewport
// ============================================================================

export function program(gl, vs, fs) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s); gl.deleteShader(s);
      throw new Error('shader compile: ' + log);
    }
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('program link: ' + gl.getProgramInfoLog(p));
  p.u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, ''); p.u[name] = gl.getUniformLocation(p, name); }
  return p;
}

export function floatCaps(gl) {
  const f = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
  return f ? { internal: gl.RGBA16F, type: gl.HALF_FLOAT, float: true } : { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE, float: false };
}

export function target(gl, w, h, caps, filter = gl.LINEAR, wrap = gl.CLAMP_TO_EDGE) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, caps.internal, w, h, 0, gl.RGBA, caps.type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h, free() { gl.deleteTexture(tex); gl.deleteFramebuffer(fbo); } };
}

// The vertex shader for drawFull: no attributes, the vertex id makes one
// triangle that covers clip space. v_uv runs 0..1 over the viewport.
export const FULL_VS = `#version 300 es
out vec2 v_uv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

let emptyVao = null;
export function drawFull(gl) {
  if (!emptyVao) emptyVao = gl.createVertexArray();
  gl.bindVertexArray(emptyVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
