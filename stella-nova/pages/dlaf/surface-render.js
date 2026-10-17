// ============================================================================
//  DLAF PAGE  ·  surface-render.js — WebGL2 draw of the SDF surface
// ----------------------------------------------------------------------------
//  Shares the context of render.js. All brick meshes live in one vertex
//  buffer (8 floats a vertex: position, normal, particle id, AO) and one
//  Uint32 index buffer, with slots from arena.js, so the surface is one
//  draw call in each pass. A brick update frees its old slots (the old
//  index range becomes zeros: degenerate triangles) and writes new ones.
//
//  Passes, in order:
//    0 shadow  depth of the surface from the key light (2048^2, phone 1024^2)
//    1 below   depth of the surface from under the ground (512^2): the
//              height of the lowest surface over each ground point
//    2 back    the backdrop gradient
//    3 ground  floor (3D) or relief slab (2D), key shadow and contact shadow
//    4 surface the mesh, shaded (surface-shaders.js)
//  Colour values: an R32F texture, 2048 wide, one texel a particle, read
//  from render.js vals over the dirty id range only.
//
//  grep -n targets
//    buffers and slots ..... "function upload"
//    buffer growth ......... "function grow"
//    colour values ......... "function syncValues"
//    frame ................. "function draw"
// ============================================================================
import { createArena } from './arena.js';
import { SURF_VS, SURF_FS, GROUND_VS, GROUND_FS, DEPTH_VS, DEPTH_FS, BACK_VS, BACK_FS, materialById } from './surface-shaders.js';

const VW = 2048;                       // width of the value texture
const STRIDE = 32;                     // bytes a vertex

function compile(gl, vs, fs) {
  const mk = (type, s) => {
    const sh = gl.createShader(type); gl.shaderSource(sh, s); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, a.name); }
  return { p, u };
}

export function createSurfaceRenderer(R, o = {}) {
  const gl = R.gl;
  const SHADOW = o.phone ? 1024 : 2048, BELOW = o.phone ? 256 : 512;
  const surf = compile(gl, SURF_VS, SURF_FS), ground = compile(gl, GROUND_VS, GROUND_FS);
  const depth = compile(gl, DEPTH_VS, DEPTH_FS), back = compile(gl, BACK_VS, BACK_FS);

  // ── arena buffers ──────────────────────────────────────────────────────
  const VA = createArena(1 << 16), IA = createArena(1 << 18);
  let vbo = gl.createBuffer(), ibo = gl.createBuffer(), vCap = 0, iCap = 0;
  const vao = gl.createVertexArray();
  const slots = new Map();
  let scratchV = new Float32Array(8 * 1024), scratchI = new Uint32Array(4096), zeros = new Uint32Array(4096);

  function bindLayout() {
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, STRIDE, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, STRIDE, 28);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bindVertexArray(null);
  }

  // Grow a buffer to the arena cap: a new buffer (zero filled by WebGL),
  // then a GPU copy of the old contents.
  function grow() {
    if (VA.cap * STRIDE > vCap) {
      const nb = gl.createBuffer(), bytes = VA.cap * STRIDE;
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, nb); gl.bufferData(gl.COPY_WRITE_BUFFER, bytes, gl.DYNAMIC_DRAW);
      if (vCap) { gl.bindBuffer(gl.COPY_READ_BUFFER, vbo); gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, vCap); }
      gl.deleteBuffer(vbo); vbo = nb; vCap = bytes;
      bindLayout();
    }
    if (IA.cap * 4 > iCap) {
      // an index buffer must be bound to ELEMENT_ARRAY_BUFFER first (WebGL 2
      // sets the buffer type on the first bind); the copy targets are free
      const nb = gl.createBuffer(), bytes = IA.cap * 4;
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, nb); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, bytes, gl.DYNAMIC_DRAW);
      if (iCap) {
        gl.bindBuffer(gl.COPY_READ_BUFFER, ibo); gl.bindBuffer(gl.COPY_WRITE_BUFFER, nb);
        gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, iCap);
      }
      gl.deleteBuffer(ibo); ibo = nb; iCap = bytes;
      bindLayout();
    }
  }
  grow();

  // index writes go through ELEMENT_ARRAY_BUFFER with no VAO bound
  function bindIndex() { gl.bindVertexArray(null); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); }

  function release(key) {
    const s = slots.get(key); if (!s) return;
    VA.free(s.v); IA.free(s.i); slots.delete(key);
    if (zeros.length < s.i.size) zeros = new Uint32Array(s.i.size);
    bindIndex();
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, s.i.off * 4, zeros, 0, s.i.size);
  }

  // Write the brick records from surface.js. A record with no indices
  // removes its brick.
  function upload(list) {
    for (const r of list) {
      release(r.key);
      const ni = r.indices.length, nv = r.positions.length / 3;
      if (!ni) continue;
      const v = VA.alloc(nv), i = IA.alloc(ni);
      grow();
      if (scratchV.length < nv * 8) scratchV = new Float32Array(nv * 16);
      const P = r.positions, N = r.normals, D = r.ids, A = r.ao;
      for (let k = 0; k < nv; k++) {
        const o8 = k * 8, o3 = k * 3;
        scratchV[o8] = P[o3]; scratchV[o8 + 1] = P[o3 + 1]; scratchV[o8 + 2] = P[o3 + 2];
        scratchV[o8 + 3] = N[o3]; scratchV[o8 + 4] = N[o3 + 1]; scratchV[o8 + 5] = N[o3 + 2];
        scratchV[o8 + 6] = D[k]; scratchV[o8 + 7] = A && A.length === nv ? A[k] : 1;
      }
      if (scratchI.length < i.size) scratchI = new Uint32Array(i.size * 2);
      const I = r.indices;
      for (let k = 0; k < ni; k++) scratchI[k] = I[k] + v.off;
      scratchI.fill(0, ni, i.size);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferSubData(gl.ARRAY_BUFFER, v.off * STRIDE, scratchV, 0, nv * 8);
      bindIndex(); gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, i.off * 4, scratchI, 0, i.size);
      slots.set(r.key, { v, i, nv, ni });
    }
  }

  function clear() {
    VA.reset(); IA.reset(); slots.clear();
    // fresh zero-filled buffers at the old size
    bindIndex(); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, iCap, gl.DYNAMIC_DRAW);
    valsN = 0;
  }

  // ── colour values texture ──────────────────────────────────────────────
  const valTex = gl.createTexture();
  let valRows = 0, valsN = 0, valBuf = new Float32Array(VW);
  gl.bindTexture(gl.TEXTURE_2D, valTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, VW, 1, 0, gl.RED, gl.FLOAT, valBuf);
  valRows = 1;

  // Copy the changed ids of render.js vals into the texture (whole rows).
  function syncValues() {
    const d = R.valDirty, n = R.synced;
    if (d.hi <= d.lo && valsN >= n) return;
    const rows = Math.max(1, Math.ceil(n / VW));
    gl.bindTexture(gl.TEXTURE_2D, valTex);
    if (rows > valRows) {
      let r2 = valRows; while (r2 < rows) r2 *= 2;
      valBuf = new Float32Array(r2 * VW);
      valBuf.set(R.vals.subarray(0, Math.min(n, R.vals.length)));
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, VW, r2, 0, gl.RED, gl.FLOAT, valBuf);
      valRows = r2;
    } else {
      const lo = Math.max(0, Math.min(d.lo, valsN)), hi = Math.min(n, Math.max(d.hi, n));
      if (hi > lo) {
        const r0 = Math.floor(lo / VW), r1 = Math.ceil(hi / VW);
        valBuf.set(R.vals.subarray(r0 * VW, Math.min(hi, r1 * VW)), r0 * VW);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r0, VW, r1 - r0, gl.RED, gl.FLOAT, valBuf, r0 * VW);
      }
    }
    d.lo = Infinity; d.hi = 0; valsN = n;
  }

  // ── depth targets ──────────────────────────────────────────────────────
  function depthTarget(size, compare) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, compare ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, compare ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (compare) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    }
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, t, 0);
    gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { t, fb, size, ok };
  }
  const shadowT = depthTarget(SHADOW, true), belowT = depthTarget(BELOW, false);

  // ground quad (4 vertices, rewritten each frame)
  const gbuf = gl.createBuffer(), gvao = gl.createVertexArray();
  gl.bindVertexArray(gvao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gbuf); gl.bufferData(gl.ARRAY_BUFFER, 48, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
  gl.bindVertexArray(null);
  const bvao = gl.createVertexArray();
  const gq = new Float32Array(12);

  function drawMesh() {
    if (!IA.top) return;
    gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, IA.top, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  function depthPass(T, M) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb);
    gl.viewport(0, 0, T.size, T.size);
    gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(depth.p); gl.uniformMatrix4fv(depth.u.u_mvp, false, M);
    drawMesh();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  const setLights = (u, f) => {
    gl.uniform3fv(u.u_L, f.L); gl.uniform3fv(u.u_up, f.up);
    gl.uniform3fv(u.u_keyCol, f.keyCol); gl.uniform3fv(u.u_skyCol, f.skyCol); gl.uniform3fv(u.u_gndCol, f.gndCol);
    gl.uniform1f(u.u_shadowTexel, 1 / SHADOW); gl.uniform1i(u.u_shadowOn, shadowT.ok ? 1 : 0);
    gl.uniform1i(u.u_shadow, 1);
    gl.uniform3fv(u.u_eye, f.eye); gl.uniform3fv(u.u_viewDir, f.viewDir); gl.uniform1i(u.u_ortho, f.ortho ? 1 : 0);
    gl.uniform1f(u.u_exposure, f.exposure);
  };

  // f = { mat, light, below, L, up, eye, viewDir, ortho, keyCol, skyCol,
  //   gndCol, exposure, material, dim, k, count, max, floor, gamma, glowN,
  //   glowStr, ground: { corners Float32Array(12), center, fade, range,
  //   contact, contactR }, bgTop, bgBot, bg, w, h }
  function draw(f) {
    syncValues();
    const M = materialById(f.material), G = f.dim === 3 ? M.g3 : M.g2;
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CCW);
    if (shadowT.ok) depthPass(shadowT, f.light);
    gl.disable(gl.CULL_FACE);
    if (belowT.ok) depthPass(belowT, f.below);

    gl.viewport(0, 0, f.w, f.h);
    gl.clearColor(f.bg[0], f.bg[1], f.bg[2], 1); gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // backdrop
    gl.depthMask(false);
    gl.useProgram(back.p);
    gl.uniform3fv(back.u.u_bgTop, f.bgTop); gl.uniform3fv(back.u.u_bgBot, f.bgBot);
    gl.bindVertexArray(bvao); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
    gl.depthMask(true);

    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, shadowT.t);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, belowT.t);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, valTex);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.lut());

    // ground
    const g = f.ground;
    gq.set(g.corners);
    gl.bindBuffer(gl.ARRAY_BUFFER, gbuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, gq);
    gl.useProgram(ground.p);
    const gu = ground.u;
    setLights(gu, f);
    gl.uniformMatrix4fv(gu.u_mvp, false, f.mat); gl.uniformMatrix4fv(gu.u_light, false, f.light); gl.uniformMatrix4fv(gu.u_below, false, f.below);
    gl.uniform1i(gu.u_belowMap, 2);
    gl.uniform3fv(gu.u_gbase, G.base);
    gl.uniform4f(gu.u_gmat, G.metal, G.rough, belowT.ok ? g.contact : 0, g.contactR);
    gl.uniform3fv(gu.u_center, g.center); gl.uniform2fv(gu.u_fade, g.fade);
    gl.uniform1f(gu.u_belowRange, g.range);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(gvao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.bindVertexArray(null);
    gl.disable(gl.BLEND);

    // surface
    gl.enable(gl.CULL_FACE);
    gl.useProgram(surf.p);
    const u = surf.u;
    setLights(u, f);
    gl.uniformMatrix4fv(u.u_mvp, false, f.mat); gl.uniformMatrix4fv(u.u_light, false, f.light);
    gl.uniform1i(u.u_lut, 0); gl.uniform1i(u.u_vals, 3);
    gl.uniform1f(u.u_max, f.max || 1); gl.uniform1f(u.u_floor, f.floor); gl.uniform1f(u.u_gamma, f.gamma);
    gl.uniform1f(u.u_count, f.count); gl.uniform1f(u.u_glowN, f.glowN); gl.uniform1f(u.u_glowStr, f.glowStr);
    gl.uniform1f(u.u_k, f.k);
    gl.uniform3fv(u.u_base, M.base);
    gl.uniform4f(u.u_mat, M.metal, M.rough, M.sss, M.lutMix);
    gl.uniform4f(u.u_mat2, M.emissive, M.rim, M.coat, M.glass);
    drawMesh();
    gl.disable(gl.CULL_FACE); gl.disable(gl.DEPTH_TEST);
  }

  return {
    upload, clear, draw, syncValues,
    get verts() { let n = 0; for (const s of slots.values()) n += s.nv; return n; },
    get bricks() { return slots.size; },
    get arena() { return { vTop: VA.top, iTop: IA.top, vCap: VA.cap, iCap: IA.cap }; },
    shadowOk: shadowT.ok, belowOk: belowT.ok,
  };
}
