// ============================================================================
//  CHLADNI PLATE  ·  render.js — WebGL2 renderer
// ----------------------------------------------------------------------------
//  Three textures in plate space (the grid rect of the solved plate):
//    mask ... the outline and the holes, drawn by a 2D canvas (mipmapped,
//             so a high mip level gives the soft drop shadow)
//    sand ... the grain trail: each frame it fades (fade.frag) and every
//             grain adds a little (grain.vert/.frag). Half float if the
//             device can render to it.
//    amp .... |w| / max |w| on the grid nodes, for the motion tint
//  Then the frame: the room (back.frag), the plate shadow and the plate
//  (plate.vert/.frag), and the grains in the air in 3D (hop.vert/.frag).
//
//  Views: 'top' looks straight down, 'tilt' looks from 32 degrees. fit()
//  scales and moves the projection so the plate fills the clear rect that
//  main.js gives (the part of the canvas no panel covers).
//
//  grep -n targets
//    matrices .......... "const M4"
//    setup ............. "export async function createRenderer"
//    plate textures .... "setPlate("
//    camera fit ........ "function camera"
//    frame ............. "draw("
//    screen to plate ... "pick("
// ============================================================================
import { loadShaders } from '../../lib/shaders.js';

const M4 = {
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  },
  persp(fovy, asp, n, f) {
    const t = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
    o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f);
    return o;
  },
  look(eye, at, up) {
    const z = norm(sub(eye, at)), x = norm(cross(up, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  },
  inv(m) {
    const a = m, o = new Float32Array(16);
    const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4];
    const b03 = a[1] * a[6] - a[2] * a[5], b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
    const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12], b08 = a[8] * a[15] - a[11] * a[12];
    const b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
    const d = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
    o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * d; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * d;
    o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * d; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * d;
    o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * d; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * d;
    o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * d; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * d;
    o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * d; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * d;
    o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * d; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * d;
    o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * d; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * d;
    o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * d; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * d;
    return o;
  },
};
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function xform(m, p) {
  const x = p[0], y = p[1], z = p[2];
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14], m[3] * x + m[7] * y + m[11] * z + m[15]];
}

const SH = ['fill.vert.glsl', 'fade.frag.glsl', 'back.frag.glsl', 'grain.vert.glsl', 'grain.frag.glsl',
  'plate.vert.glsl', 'plate.frag.glsl', 'hop.vert.glsl', 'hop.frag.glsl'].map(n => 'shaders/' + n);

export async function createRenderer(canvas, opt) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
  if (!gl) throw new Error('WebGL2 is not available');
  const src = await loadShaders(import.meta.url, SH);
  const S = n => src['shaders/' + n];
  function prog(vs, fs) {
    const p = gl.createProgram();
    for (const [type, code, name] of [[gl.VERTEX_SHADER, S(vs), vs], [gl.FRAGMENT_SHADER, S(fs), fs]]) {
      const s = gl.createShader(type); gl.shaderSource(s, code); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(name + ': ' + gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(vs + '+' + fs + ': ' + gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
    return { p, u };
  }
  const P = {
    fade: prog('fill.vert.glsl', 'fade.frag.glsl'),
    back: prog('fill.vert.glsl', 'back.frag.glsl'),
    grain: prog('grain.vert.glsl', 'grain.frag.glsl'),
    plate: prog('plate.vert.glsl', 'plate.frag.glsl'),
    hop: prog('hop.vert.glsl', 'hop.frag.glsl'),
  };
  const halfOK = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  const empty = gl.createVertexArray();
  const quadVao = gl.createVertexArray(), quadBuf = gl.createBuffer();
  gl.bindVertexArray(quadVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const grainVao = gl.createVertexArray(), grainBuf = gl.createBuffer();
  gl.bindVertexArray(grainVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, grainBuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  let grainCap = 0;

  const tex = (w, h, f) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f || gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  let plate = null;    // { maskTex, sandTex, fbo, ampTex, sw, sh, nx, ny, rect, cm }
  let viewPV = null, viewInv = null, plateCenterScreen = [0.5, 0.5];

  const R = {
    gl, halfOK,
    // geo: { nx, ny, x0, y0, h, mask (canvas), sandLong }
    setPlate(g) {
      if (plate) { gl.deleteTexture(plate.maskTex); gl.deleteTexture(plate.sandTex); gl.deleteTexture(plate.ampTex); gl.deleteFramebuffer(plate.fbo); }
      const gw = (g.nx - 1) * g.h, gh = (g.ny - 1) * g.h, long = g.sandLong || 1024;
      const sw = gw >= gh ? long : Math.round(long * gw / gh), sh = gw >= gh ? Math.round(long * gh / gw) : long;
      const maskTex = tex(0, 0, gl.LINEAR_MIPMAP_LINEAR);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, g.mask);
      gl.generateMipmap(gl.TEXTURE_2D);
      const sandTex = tex();
      if (halfOK) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, sw, sh, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, sw, sh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sandTex, 0);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const ampTex = tex();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, g.nx, g.ny, 0, gl.RED, gl.UNSIGNED_BYTE, null);
      const cy = g.cy;
      plate = { maskTex, sandTex, fbo, ampTex, sw, sh, nx: g.nx, ny: g.ny,
        rect: [g.x0, cy - g.y0, gw, gh], cm: [gw, gh], grid: g };
    },
    clearSand() {
      if (!plate) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, plate.fbo);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    setAmp(u8) {
      if (!plate) return;
      gl.bindTexture(gl.TEXTURE_2D, plate.ampTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, plate.nx, plate.ny, gl.RED, gl.UNSIGNED_BYTE, u8);
    },
    // grains: Float32Array of (u, v, act) in grid cells, count n
    grains(buf, n) {
      gl.bindBuffer(gl.ARRAY_BUFFER, grainBuf);
      if (n * 3 > grainCap) { grainCap = buf.length; gl.bufferData(gl.ARRAY_BUFFER, grainCap * 4, gl.DYNAMIC_DRAW); }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf, 0, n * 3);
      R.nGrains = n;
    },
    nGrains: 0,
    // Advance the trail: fade, then add every grain.
    trail(decay, weight) {
      if (!plate) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, plate.fbo);
      gl.viewport(0, 0, plate.sw, plate.sh);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
      gl.useProgram(P.fade.p); gl.uniform1f(P.fade.u.uDecay, decay);
      gl.bindVertexArray(empty); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(P.grain.p);
      gl.uniform2f(P.grain.u.uGridInv, 1 / (plate.nx - 1), 1 / (plate.ny - 1));
      gl.uniform1f(P.grain.u.uSize, Math.max(1.5, plate.sw / 470));
      gl.uniform1f(P.grain.u.uW, weight);
      gl.bindVertexArray(grainVao); gl.drawArrays(gl.POINTS, 0, R.nGrains);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    // clear: {x, y, w, h} in CSS px of the canvas; view 'top' | 'tilt'
    camera(view, clear, cssW, cssH, yaw) {
      if (!plate) return;
      const [rx, ry, rw, rh] = plate.rect;
      const tilt = view === 'tilt' ? 32 * Math.PI / 180 : 0, D = Math.max(rw, rh) * 3.2;
      const asp = cssW / cssH, cx = rx + rw / 2, cyw = ry - rh / 2;
      const yw = yaw || 0;
      const eye = [cx + D * Math.sin(tilt) * Math.sin(yw), cyw - D * Math.sin(tilt) * Math.cos(yw), D * Math.cos(tilt)];
      const up = tilt ? [0, 0, 1] : [Math.sin(yw), Math.cos(yw), 0];
      const V = M4.look(eye, [cx, cyw, 0], tilt ? up : [0, 1, 0]);
      const Pm = M4.persp(0.42, asp, D * 0.2, D * 4), PV = M4.mul(Pm, V);
      // bounds of the plate corners (and a little hop room) in NDC
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const p of [[rx, ry, 0], [rx + rw, ry, 0], [rx, ry - rh, 0], [rx + rw, ry - rh, 0], [cx, cyw, 1.5]]) {
        const c = xform(PV, p), X = c[0] / c[3], Y = c[1] / c[3];
        x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
      }
      // target rect in NDC, with a margin
      const pad = 0.94;
      const tx0 = clear.x / cssW * 2 - 1, tx1 = (clear.x + clear.w) / cssW * 2 - 1;
      const ty1 = 1 - clear.y / cssH * 2, ty0 = 1 - (clear.y + clear.h) / cssH * 2;
      const s = pad * Math.min((tx1 - tx0) / (x1 - x0), (ty1 - ty0) / (y1 - y0));
      const ox = (tx0 + tx1) / 2 - s * (x0 + x1) / 2, oy = (ty0 + ty1) / 2 - s * (y0 + y1) / 2;
      // clip' = S * clip, with x' = s x + ox w, y' = s y + oy w
      const F = new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1, 0, ox, oy, 0, 1]);
      viewPV = M4.mul(F, PV); viewInv = M4.inv(viewPV);
      const c = xform(viewPV, [cx, cyw, 0]);
      plateCenterScreen = [(c[0] / c[3] + 1) / 2, (c[1] / c[3] + 1) / 2];
    },
    draw(o) {
      const W = canvas.width, H = canvas.height;
      gl.viewport(0, 0, W, H);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(P.back.p);
      gl.uniform2f(P.back.u.uRes, W, H);
      gl.uniform2f(P.back.u.uCenter, plateCenterScreen[0], plateCenterScreen[1]);
      gl.bindVertexArray(empty); gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!plate || !viewPV) return;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const U = P.plate.u;
      gl.useProgram(P.plate.p);
      gl.uniformMatrix4fv(U.uPV, false, viewPV);
      gl.uniform4fv(U.uRect, plate.rect);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, plate.maskTex); gl.uniform1i(U.uMask, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, plate.sandTex); gl.uniform1i(U.uSand, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, plate.ampTex); gl.uniform1i(U.uAmp, 2);
      gl.uniform2f(U.uGrid, plate.nx, plate.ny);
      gl.uniform2f(U.uTexel, 1 / plate.sw, 1 / plate.sh);
      gl.uniform2f(U.uCm, plate.cm[0], plate.cm[1]);
      gl.uniform3fv(U.uSandCol, o.sandCol);
      gl.uniform1f(U.uKind, o.kind);
      gl.uniform1f(U.uShowAmp, o.showAmp);
      gl.uniform2fv(U.uDrive, o.drive);
      gl.uniform1f(U.uFade, o.fade);
      gl.uniform1f(U.uGain, o.gain);
      gl.bindVertexArray(quadVao);
      // drop shadow: below the plate, down and to the right
      gl.uniform1f(U.uShadow, 1);
      gl.uniform1f(U.uZ, -0.9);
      const sh = new Float32Array(plate.rect); sh[0] += 0.5; sh[1] -= 0.7;
      gl.uniform4fv(U.uRect, sh);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.uniform4fv(U.uRect, plate.rect);
      gl.uniform1f(U.uShadow, 0); gl.uniform1f(U.uZ, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // grains in the air
      if (R.nGrains && o.hop > 0) {
        const H2 = P.hop.u;
        gl.useProgram(P.hop.p);
        gl.uniformMatrix4fv(H2.uPV, false, viewPV);
        gl.uniform4fv(H2.uRect, plate.rect);
        gl.uniform2f(H2.uGridInv, 1 / (plate.nx - 1), 1 / (plate.ny - 1));
        gl.uniform1f(H2.uTime, o.time);
        gl.uniform1f(H2.uHop, o.hop);
        gl.uniform1f(H2.uSize, o.grainPx);
        gl.uniform3fv(H2.uSandCol, o.sandCol);
        gl.uniform1f(H2.uFade, o.fade);
        gl.bindVertexArray(grainVao); gl.drawArrays(gl.POINTS, 0, R.nGrains);
      }
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    },
    // CSS px on the canvas -> plate uv (0..1 over the grid rect), or null
    pick(px, py, cssW, cssH) {
      if (!viewInv || !plate) return null;
      const X = px / cssW * 2 - 1, Y = 1 - py / cssH * 2;
      const a = xform(viewInv, [X, Y, -1]), b = xform(viewInv, [X, Y, 1]);
      const A = [a[0] / a[3], a[1] / a[3], a[2] / a[3]], B = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
      const t = A[2] / (A[2] - B[2]);
      const wx = A[0] + (B[0] - A[0]) * t, wy = A[1] + (B[1] - A[1]) * t;
      const [rx, ry, rw, rh] = plate.rect;
      return [(wx - rx) / rw, (ry - wy) / rh];
    },
  };
  return R;
}
