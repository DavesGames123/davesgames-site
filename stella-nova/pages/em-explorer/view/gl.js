// ============================================================================
//  VIEW GL  ·  WebGL2 tile renderer: one R8 texture per tile, one quad each
// ----------------------------------------------------------------------------
//  Each tile is an R8 texture with mipmaps. A quad is placed in nm and the
//  vertex shader maps it to the view: px = focus + (nm - centre) / nmPerPx.
//  The fragment shader applies the window (lo, hi), gamma and invert, and
//  an alpha for the fade-in of new tiles. A solid mode draws flat rects
//  (volume ground, minimap frame, crosshair).
//
//  GREP MAP
//    grep -n 'const VS'           vertex shader
//    grep -n 'const FS'           fragment shader, contrast and gamma
//    grep -n 'texture('           tile upload (R8, mipmaps)
//    grep -n 'beginView('         viewport and scissor for one view
//    grep -n 'drawTile('          one textured quad
//    grep -n 'drawRect('          one solid quad
// ============================================================================

const VS = `#version 300 es
precision highp float;
uniform vec4 uRect;     // nm: u0 v0 u1 v1
uniform vec4 uUV;       // texture coords at the corners
uniform vec2 uCenter;   // nm at the focus
uniform vec2 uFocus;    // focus, CSS px from the viewport origin
uniform vec2 uVp;       // viewport, CSS px
uniform float uNpp;     // nm per CSS px
out vec2 vUV;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 nm = mix(uRect.xy, uRect.zw, c);
  vUV = mix(uUV.xy, uUV.zw, c);
  vec2 px = uFocus + (nm - uCenter) / uNpp;
  gl_Position = vec4(px.x / uVp.x * 2.0 - 1.0, 1.0 - px.y / uVp.y * 2.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uLo, uHi, uGamma, uInvert, uAlpha, uSolid;
uniform vec4 uColor;
in vec2 vUV;
out vec4 o;
void main() {
  if (uSolid > 0.5) { o = vec4(uColor.rgb * uColor.a * uAlpha, uColor.a * uAlpha); return; }
  float x = texture(uTex, vUV).r;
  x = clamp((x - uLo) / max(uHi - uLo, 1e-4), 0.0, 1.0);
  x = pow(x, uGamma);
  x = mix(x, 1.0 - x, uInvert);
  o = vec4(vec3(x) * uAlpha, uAlpha);
}`;

export function createRenderer(gl) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(prog));
  const U = {};
  for (const n of ['uRect', 'uUV', 'uCenter', 'uFocus', 'uVp', 'uNpp', 'uTex', 'uLo', 'uHi', 'uGamma', 'uInvert', 'uAlpha', 'uSolid', 'uColor']) U[n] = gl.getUniformLocation(prog, n);
  const vao = gl.createVertexArray();
  let texBytes = 0;
  // The view centre stays in JS doubles: rects go to the GPU relative to it,
  // so float32 keeps sub-px precision at 1.7 mm extents (minnie65).
  let cu = 0, cv = 0;

  const r = {
    gl,
    get texBytes() { return texBytes; },
    texture(data, w, h) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const bytes = Math.round(w * h * 4 / 3);
      texBytes += bytes;
      return { t, w, h, bytes };
    },
    freeTexture(x) { if (x && x.t) { gl.deleteTexture(x.t); texBytes -= x.bytes; x.t = null; } },
    // Start a frame: canvas size in device px, a clear colour.
    begin(wDev, hDev, bg) {
      gl.disable(gl.SCISSOR_TEST);
      gl.viewport(0, 0, wDev, hDev);
      gl.clearColor(bg[0], bg[1], bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.uniform1i(U.uTex, 0);
      gl.activeTexture(gl.TEXTURE0);
    },
    // vp in CSS px, focus in CSS px from vp origin, dpr, canvas height in device px
    beginView(vp, fx, fy, center2, npp, dpr, hDev, bg) {
      const x = Math.round(vp.x * dpr), w = Math.round(vp.w * dpr), h = Math.round(vp.h * dpr);
      const y = hDev - Math.round(vp.y * dpr) - h;
      gl.viewport(x, y, w, h);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(x, y, w, h);
      if (bg) { gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.uniform2f(U.uVp, vp.w, vp.h);
      gl.uniform2f(U.uFocus, fx, fy);
      cu = center2[0]; cv = center2[1];
      gl.uniform2f(U.uCenter, 0, 0);
      gl.uniform1f(U.uNpp, npp);
    },
    setWindow(lo, hi, gamma, invert) {
      gl.uniform1f(U.uLo, lo); gl.uniform1f(U.uHi, hi);
      gl.uniform1f(U.uGamma, gamma); gl.uniform1f(U.uInvert, invert ? 1 : 0);
    },
    drawTile(tex, nmRect, alpha = 1, uv = null) {
      if (!tex || !tex.t) return;
      gl.bindTexture(gl.TEXTURE_2D, tex.t);
      gl.uniform1f(U.uSolid, 0);
      gl.uniform1f(U.uAlpha, alpha);
      gl.uniform4f(U.uRect, nmRect[0] - cu, nmRect[1] - cv, nmRect[2] - cu, nmRect[3] - cv);
      if (uv) gl.uniform4f(U.uUV, uv[0], uv[1], uv[2], uv[3]); else gl.uniform4f(U.uUV, 0, 0, 1, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    drawRect(nmRect, rgba, alpha = 1) {
      gl.uniform1f(U.uSolid, 1);
      gl.uniform1f(U.uAlpha, alpha);
      gl.uniform4f(U.uColor, rgba[0], rgba[1], rgba[2], rgba[3]);
      gl.uniform4f(U.uRect, nmRect[0] - cu, nmRect[1] - cv, nmRect[2] - cu, nmRect[3] - cv);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose() { gl.deleteProgram(prog); gl.deleteVertexArray(vao); },
  };
  return r;
}
