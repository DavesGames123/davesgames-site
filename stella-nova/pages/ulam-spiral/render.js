// ============================================================================
//  ULAM SPIRAL  ·  render.js — the WebGL2 renderer
// ----------------------------------------------------------------------------
//  One frame:
//    1. scene FBO (RGBA16F when the GPU can render to it, else RGBA8):
//       lattice shapes  FIELD_FS, one full-screen pass; each pixel finds
//                       its cell, the number and its class. Zoomed out
//                       it box-filters the cells under it; past
//                       s.boxMax cells per pixel it reads the pyramid
//       pyramid         PYR_FS: the mean colour of each B0 x B0 block of
//                       the region with known numbers, drawn in bands
//                       over a few frames, then mip levels (exact 2 x 2
//                       means). Built again when the shape, the mode or
//                       the colours change, not when the camera moves.
//       point shapes    POINT_VS / POINT_FS, n = n0 + gl_VertexID, additive
//       morphs          points for every shape, two maps mixed per n
//       path            the same vertex shader as a LINE_STRIP
//    2. bloom: scene -> 1/2 -> 1/4 (blur) -> 1/8 (blur)
//    3. COMP_FS mixes the background, the scene and the two bloom levels
//       into the canvas.
//  Nothing is cached as an image between frames: each frame draws the
//  view at its own zoom (no upscaled raster).
//
//  Textures:
//    uPrimes  R32UI, the odd-only prime bitset (numtheory.js sieveOdd)
//    uArith   R8, the class bytes of one arithmetic mode for n < 2^23
//    uTile    RG8, a CPU tile (worker.js): class byte and quadratic flag
//             per cell, for regions past the bitset (Miller-Rabin)
//    uPyr     R16F (density modes, the light only) or RGBA16F, with mips:
//             the block means of the pyramid
//
//  GREP MAP
//    grep -n 'export function createRenderer'
//    grep -n 'function draw'          one frame (state -> canvas)
//    grep -n 'function sceneInto'     the scene pass only
//    grep -n 'function shapeUniforms' the uniforms every pass shares
//    grep -n 'function tfPositions'   transform feedback (self-test)
//    grep -n 'function readIndex'     the debug index pass (self-test)
//    grep -n 'function pyrPlan'       pyramid block size and texture size
//    grep -n 'function pyrEnsure'     build the pyramid (a cell budget)
//    grep -n 'function pyrUsable'     may this frame read the pyramid
//    grep -n 'function renderMini'    the minimap image
// ============================================================================
import * as G from './glsl.js';

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) return null;
  const half = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);

  // --- programs -------------------------------------------------------------
  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      const lines = src.split('\n'), m = /0:(\d+)/.exec(log || '');
      const at = m ? lines.slice(Math.max(0, +m[1] - 3), +m[1] + 2).join('\n') : '';
      throw new Error('shader compile: ' + log + '\n' + at);
    }
    return s;
  }
  function program(vs, fs, tf) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    if (tf) gl.transformFeedbackVaryings(p, tf, gl.SEPARATE_ATTRIBS);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const loc = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const u = gl.getActiveUniform(p, i), name = u.name.replace(/\[0\]$/, '');
      loc[name] = gl.getUniformLocation(p, u.name);
    }
    return { p, loc };
  }
  const P = {
    field: program(G.FULL_VS, G.FIELD_FS),
    point: program(G.POINT_VS, G.POINT_FS),
    down: program(G.FULL_VS, G.DOWN_FS),
    blur: program(G.FULL_VS, G.BLUR_FS),
    comp: program(G.FULL_VS, G.COMP_FS),
    pyr: program(G.FULL_VS, G.PYR_FS),
  };
  let tfProg = null;
  const vao = gl.createVertexArray();

  // --- textures and targets ---------------------------------------------------
  function tex(internal, format, type, w, h, data, filter = gl.NEAREST) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  const primes = { t: tex(gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, 1, 1, new Uint32Array(1)), W: 1, limit: 0 };
  const arith = { t: tex(gl.R8, gl.RED, gl.UNSIGNED_BYTE, 1, 1, new Uint8Array(1)), W: 1, N: 0, mode: -1 };
  const tile = { t: tex(gl.RG8, gl.RG, gl.UNSIGNED_BYTE, 1, 1, new Uint8Array(2)), on: false, org: [0, 0], size: [1, 1] };
  const dummy = tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, 1, 1, new Uint8Array(4));
  let primesVer = 0, arithVer = 0;

  function target(w, h, fmt) {
    const hf = fmt === 'half' && half;
    const t = tex(hf ? gl.RGBA16F : gl.RGBA8, gl.RGBA, hf ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, w, h, null, gl.LINEAR);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { t, f, w, h };
  }
  function freeTarget(x) { if (x) { gl.deleteTexture(x.t); gl.deleteFramebuffer(x.f); } }
  let T = null, TW = 0, TH = 0;
  function ensureTargets(w, h) {
    if (T && TW === w && TH === h) return;
    if (T) Object.values(T).forEach(freeTarget);
    TW = w; TH = h;
    const h2 = [Math.max(1, w >> 1), Math.max(1, h >> 1)], h4 = [Math.max(1, w >> 2), Math.max(1, h >> 2)], h8 = [Math.max(1, w >> 3), Math.max(1, h >> 3)];
    T = { scene: target(w, h, 'half'), d2: target(...h2, 'half'), d4: target(...h4, 'half'), d4b: target(...h4, 'half'), d8: target(...h8, 'half'), d8b: target(...h8, 'half') };
  }

  // --- uploads ----------------------------------------------------------------
  function setPrimes(bits, limit) {
    let W = 2048;
    while (Math.ceil(bits.length / W) > maxTex && W < maxTex) W *= 2;
    const H = Math.ceil(bits.length / W);
    const data = bits.length === W * H ? bits : (() => { const d = new Uint32Array(W * H); d.set(bits); return d; })();
    gl.deleteTexture(primes.t);
    primes.t = tex(gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, W, H, data);
    primes.W = W; primes.limit = limit; primesVer++;
  }
  function setArith(bytes, mode) {
    const W = 4096, H = Math.ceil(bytes.length / W);
    const data = bytes.length === W * H ? bytes : (() => { const d = new Uint8Array(W * H); d.set(bytes); return d; })();
    gl.deleteTexture(arith.t);
    arith.t = tex(gl.R8, gl.RED, gl.UNSIGNED_BYTE, W, H, data);
    arith.W = W; arith.N = bytes.length; arith.mode = mode; arithVer++;
  }
  function setTile(data, org, size) {
    gl.deleteTexture(tile.t);
    tile.t = tex(gl.RG8, gl.RG, gl.UNSIGNED_BYTE, size[0], size[1], data);
    tile.org = org; tile.size = size; tile.on = true;
  }
  function clearTile() { tile.on = false; }

  // --- uniforms -----------------------------------------------------------------
  const u1i = (pr, n, v) => { const l = pr.loc[n]; if (l) gl.uniform1i(l, v); };
  const u1u = (pr, n, v) => { const l = pr.loc[n]; if (l) gl.uniform1ui(l, v >>> 0); };
  const u1f = (pr, n, v) => { const l = pr.loc[n]; if (l) gl.uniform1f(l, v); };
  const u2f = (pr, n, a, b) => { const l = pr.loc[n]; if (l) gl.uniform2f(l, a, b); };
  const u3f = (pr, n, a, b, c) => { const l = pr.loc[n]; if (l) gl.uniform3f(l, a, b, c); };
  const u2i = (pr, n, a, b) => { const l = pr.loc[n]; if (l) gl.uniform2i(l, a, b); };
  // A fraction 0 <= f < 1 as 64-bit fixed point [hi, lo] (glsl gFracMul).
  function fixed64(f) {
    const a = f * 4294967296, hi = Math.floor(a);
    return [hi >>> 0, Math.floor((a - hi) * 4294967296) >>> 0];
  }
  // The uniforms of the shape maps and the classes, shared by every pass.
  function shapeUniforms(pr, s) {
    const p = s.P;
    u1u(pr, 'uStart', Math.min(4294967295, Math.max(0, Math.floor(p.start))));
    u1i(pr, 'uCw', p.cw ? 1 : 0); u1i(pr, 'uRot', p.rot & 3); u1i(pr, 'uW', Math.max(1, p.w | 0));
    u1i(pr, 'uL', Math.max(1, p.L | 0)); u1i(pr, 'uCut', p.cut | 0);
    u1f(pr, 'uK', p.K); u1f(pr, 'uAng', p.ang); u1f(pr, 'uG', p.g);
    if (pr.loc.uKFx) gl.uniform2ui(pr.loc.uKFx, ...fixed64(p.K - Math.floor(p.K)));
    if (pr.loc.uAngFx) gl.uniform2ui(pr.loc.uAngFx, ...fixed64(p.ang / 360 - Math.floor(p.ang / 360)));
    if (!pr.loc.uMode) return;
    u1i(pr, 'uMode', s.mode);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, primes.t); u1i(pr, 'uPrimes', 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, arith.t); u1i(pr, 'uArith', 1);
    u1i(pr, 'uPrimesW', primes.W); u1u(pr, 'uLimit', primes.limit);
    u1i(pr, 'uArithW', arith.W); u1u(pr, 'uArithN', arith.mode === s.mode ? arith.N : 0);
    const q = s.quad;
    if (pr.loc.uQuad) gl.uniform3i(pr.loc.uQuad, q ? q.a : 0, q ? q.b : 0, q ? q.c : 0);
    u1i(pr, 'uQuadOn', q && q.on ? 1 : 0); u1f(pr, 'uQuadMax', q && q.max != null ? q.max : 1e9);
    if (pr.loc.uPal) gl.uniform3fv(pr.loc.uPal, s.palA);
    if (pr.loc.uPalB) gl.uniform3fv(pr.loc.uPalB, s.palB || s.palA);
    u3f(pr, 'uQuadCol', ...s.quadCol);
    u1f(pr, 'uCompA', s.compA); u1f(pr, 'uGain', s.gain || 1);
    const sw = s.sweep || [0, 0, 0];
    u3f(pr, 'uSweep', sw[0], sw[1], sw[2]); u1f(pr, 'uSweepW', s.sweepW || 1);
    u1f(pr, 'uWalk', s.walk == null ? -1 : s.walk); u1f(pr, 'uIgnite', s.ignite || 30);
  }

  // --- the scene ------------------------------------------------------------------
  // s: the frame state. dw, dh: the target size in device px.
  function sceneInto(s, fb, dw, dh) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, dw, dh);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(vao);
    const pxW = 1 / (s.cam.z * s.dpr);
    if (s.renderer === 'field') {
      const pr = P.field; gl.useProgram(pr.p);
      gl.disable(gl.BLEND);
      shapeUniforms(pr, s);
      u1i(pr, 'uShape', s.shape.id);
      u2i(pr, 'uBase', s.base.x, s.base.y);
      u2f(pr, 'uLocal', s.cam.x - s.base.wx, s.cam.y - s.base.wy);
      u2f(pr, 'uCenter', s.center[0], s.center[1]);
      u1f(pr, 'uPxW', pxW);
      u1f(pr, 'uBoxMax', s.boxMax || 6);
      u1i(pr, 'uStyle', s.style); u1f(pr, 'uDotR', s.dotR);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tile.t); u1i(pr, 'uTile', 2);
      u1i(pr, 'uTileOn', s.tileOn && tile.on ? 1 : 0);
      u2i(pr, 'uTileOrg', tile.org[0], tile.org[1]); u2i(pr, 'uTileSize', tile.size[0], tile.size[1]);
      u1i(pr, 'uDebug', s.debug | 0);
      const on = pyrUsable(s);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, on ? pyr.t : dummy); u1i(pr, 'uPyr', 3);
      u1i(pr, 'uPyrOn', on ? 1 : 0);
      if (on) {
        u1i(pr, 'uPyrAlpha', pyr.alpha ? 1 : 0); u1i(pr, 'uPyrB0', pyr.B0); u1i(pr, 'uPyrLevels', pyr.levels);
        u2i(pr, 'uPyrOrg', pyr.org[0], pyr.org[1]); u2i(pr, 'uPyrSize', pyr.w, pyr.h);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (s.points) drawPoints(s, s.points, dw, dh, pxW, false);
    if (s.path) drawPoints(s, s.path, dw, dh, pxW, true);
  }
  function drawPoints(s, pts, dw, dh, pxW, path) {
    const pr = P.point; gl.useProgram(pr.p);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    shapeUniforms(pr, s);
    u1i(pr, 'uShape', pts.shapeA); u1i(pr, 'uShapeB', pts.shapeB == null ? pts.shapeA : pts.shapeB);
    u1u(pr, 'uN0', pts.n0); u1u(pr, 'uStep', pts.step || 1); u1u(pr, 'uSpan', pts.count * (pts.step || 1));
    u1f(pr, 'uMorph', pts.morph || 0); u1f(pr, 'uStagger', pts.stagger == null ? 0.6 : pts.stagger);
    u1i(pr, 'uStyle', s.style); u1i(pr, 'uPath', path ? 1 : 0);
    u1f(pr, 'uPt', s.ptSize);
    let M;
    if (s.cam3) {
      M = s.cam3.mvp; u3f(pr, 'uOrigin', 0, 0, 0); u1i(pr, 'uPersp', 1); u1f(pr, 'uPxPerW', s.cam3.focal);
    } else {
      const sx = 2 / (pxW * dw), sy = 2 / (pxW * dh);
      const tx = 2 * s.center[0] / dw - 1, ty = 2 * s.center[1] / dh - 1;
      M = new Float32Array([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, 1, 0, tx, ty, 0, 1]);
      u3f(pr, 'uOrigin', s.cam.x, s.cam.y, 0); u1i(pr, 'uPersp', 0); u1f(pr, 'uPxPerW', 1 / pxW);
    }
    gl.uniformMatrix4fv(pr.loc.uM, false, M);
    gl.drawArrays(path ? gl.LINE_STRIP : gl.POINTS, 0, pts.count);
    gl.disable(gl.BLEND);
  }

  // --- the density pyramid ---------------------------------------------------------
  // s.pyr = { box: [x0, y0, x1, y1] lattice cells with known numbers,
  // alpha: the density modes (only the light is read), cap: the texture
  // side for RGBA (R16F gets twice the side, the same bytes) }. The key
  // holds every input of cellColor that PYR_FS reads, so a change of
  // shape, mode, quadratic, colours or sieve starts a new build.
  const pyr = { key: null, t: null, f: null, w: 0, h: 0, B0: 1, org: [0, 0], levels: 1, alpha: true, row: 0, done: false, ms: 0 };
  const pow2 = n => 2 ** Math.ceil(Math.log2(Math.max(1, n)));
  function pyrPlan(box, alpha, cap) {
    const sx = box[2] - box[0] + 1, sy = box[3] - box[1] + 1;
    const side = alpha ? 2 * cap : cap, maxSide = Math.min(maxTex, 16384);
    for (let B0 = 1; B0 <= 32; B0 *= 2) {
      const w = pow2(Math.ceil(sx / B0)), h = pow2(Math.ceil(sy / B0));
      if (w * h <= side * side && w <= maxSide && h <= maxSide) return { B0, w, h, org: [box[0] - Math.floor((w * B0 - sx) / 2), box[1] - Math.floor((h * B0 - sy) / 2)] };
    }
    return null;
  }
  function pyrKey(s) {
    const p = s.pyr, q = s.quad || {};
    return [s.shape.id, JSON.stringify(s.P), s.mode, q.on ? [q.a, q.b, q.c, q.max] : 0, s.compA, primesVer, primes.limit,
      arith.mode === s.mode ? arithVer : 0, p.alpha ? 1 : [...s.palA, ...s.quadCol].map(v => v.toFixed(3)), p.box, p.cap].join('|');
  }
  const pxWOf = s => 1 / (s.cam.z * s.dpr);
  // Does this frame want the pyramid (lattice field, footprint past boxMax)?
  function pyrWants(s) { return half && s.renderer === 'field' && !!s.pyr && !s.tileOn && pxWOf(s) > (s.boxMax || 6); }
  // May it read the pyramid? Not with the walk (it hides cells past the
  // front), and not with the palette sweep for an RGBA pyramid.
  function pyrUsable(s) {
    return pyrWants(s) && pyr.done && pyr.key === pyrKey(s) && s.walk == null && (pyr.alpha || !s.sweep);
  }
  function pyrFree() { if (pyr.t) { gl.deleteTexture(pyr.t); gl.deleteFramebuffer(pyr.f); } pyr.t = pyr.f = null; pyr.done = false; pyr.key = null; }
  // Build (or go on with) the pyramid for s, at most `budget` cell
  // evaluations in this call. Returns true when it is ready.
  function pyrEnsure(s, budget = 2e7) {
    if (!pyrWants(s)) return false;
    const key = pyrKey(s);
    if (pyr.key !== key) {
      pyrFree();
      pyr.key = key;
      const pl = pyrPlan(s.pyr.box, !!s.pyr.alpha, s.pyr.cap || 1024);
      if (!pl) return false;
      Object.assign(pyr, pl, { alpha: !!s.pyr.alpha, row: 0, done: false, ms: 0, levels: Math.log2(Math.max(pl.w, pl.h)) + 1 });
      pyr.t = tex(pyr.alpha ? gl.R16F : gl.RGBA16F, pyr.alpha ? gl.RED : gl.RGBA, gl.HALF_FLOAT, pl.w, pl.h, null);
      pyr.f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, pyr.f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pyr.t, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { gl.deleteTexture(pyr.t); gl.deleteFramebuffer(pyr.f); pyr.t = pyr.f = null; return false; }
    }
    if (!pyr.t) return false;
    const t0 = performance.now();
    const pr = P.pyr;
    while (!pyr.done && budget > 0) {
      const perRow = pyr.w * pyr.B0 * pyr.B0, rows = Math.max(1, Math.min(pyr.h - pyr.row, Math.floor(Math.min(budget, 4e7) / perRow)));
      gl.bindFramebuffer(gl.FRAMEBUFFER, pyr.f);
      gl.viewport(0, 0, pyr.w, pyr.h);
      gl.enable(gl.SCISSOR_TEST); gl.scissor(0, pyr.row, pyr.w, rows);
      gl.disable(gl.BLEND); gl.useProgram(pr.p); gl.bindVertexArray(vao);
      shapeUniforms(pr, s);
      u1i(pr, 'uShape', s.shape.id); u1i(pr, 'uStyle', s.style); u1f(pr, 'uDotR', s.dotR);
      u1f(pr, 'uWalk', -1); u1i(pr, 'uTileOn', 0);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tile.t); u1i(pr, 'uTile', 2);
      u2i(pr, 'uPyrOrg', pyr.org[0], pyr.org[1]); u1i(pr, 'uPyrB0', pyr.B0); u1i(pr, 'uPyrAlpha', pyr.alpha ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.SCISSOR_TEST);
      pyr.row += rows; budget -= rows * perRow;
      if (pyr.row >= pyr.h) {
        gl.bindTexture(gl.TEXTURE_2D, pyr.t);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
        pyr.done = true;
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    pyr.ms += performance.now() - t0;
    return pyr.done;
  }
  // true while a frame wants the pyramid and it is not ready (main.js
  // keeps drawing frames until it is)
  let pyrBusy = false;

  // --- one frame --------------------------------------------------------------------
  function pass(pr, dst, w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.f : null);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function bindSrc(pr, name, t, unit) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); u1i(pr, name, unit); }
  function draw(s) {
    const dw = canvas.width, dh = canvas.height;
    ensureTargets(dw, dh);
    pyrBusy = false;
    if (s.pyrBuild && pyrWants(s)) pyrBusy = !pyrEnsure(s, s.pyrBudget || 2e7) && !!pyr.t;
    sceneInto(s, T.scene.f, dw, dh);
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    // bloom chain
    let pr = P.down; gl.useProgram(pr.p);
    bindSrc(pr, 'uSrc', T.scene.t, 0); u2f(pr, 'uTexel', 1 / dw, 1 / dh); pass(pr, T.d2, T.d2.w, T.d2.h);
    bindSrc(pr, 'uSrc', T.d2.t, 0); u2f(pr, 'uTexel', 1 / T.d2.w, 1 / T.d2.h); pass(pr, T.d4, T.d4.w, T.d4.h);
    pr = P.blur; gl.useProgram(pr.p);
    bindSrc(pr, 'uSrc', T.d4.t, 0); u2f(pr, 'uDir', 1 / T.d4.w, 0); pass(pr, T.d4b, T.d4.w, T.d4.h);
    bindSrc(pr, 'uSrc', T.d4b.t, 0); u2f(pr, 'uDir', 0, 1 / T.d4.h); pass(pr, T.d4, T.d4.w, T.d4.h);
    pr = P.down; gl.useProgram(pr.p);
    bindSrc(pr, 'uSrc', T.d4.t, 0); u2f(pr, 'uTexel', 1 / T.d4.w, 1 / T.d4.h); pass(pr, T.d8, T.d8.w, T.d8.h);
    pr = P.blur; gl.useProgram(pr.p);
    for (let i = 0; i < 2; i++) {
      bindSrc(pr, 'uSrc', T.d8.t, 0); u2f(pr, 'uDir', (1 + i) / T.d8.w, 0); pass(pr, T.d8b, T.d8.w, T.d8.h);
      bindSrc(pr, 'uSrc', T.d8b.t, 0); u2f(pr, 'uDir', 0, (1 + i) / T.d8.h); pass(pr, T.d8, T.d8.w, T.d8.h);
    }
    // final mix
    pr = P.comp; gl.useProgram(pr.p);
    bindSrc(pr, 'uScene', T.scene.t, 0); bindSrc(pr, 'uB1', T.d4.t, 1); bindSrc(pr, 'uB2', T.d8.t, 2);
    u3f(pr, 'uBg0', ...s.bg[0]); u3f(pr, 'uBg1', ...s.bg[1]);
    u1f(pr, 'uBloom', s.bloom); u1f(pr, 'uExposure', s.exposure || 1); u1f(pr, 'uBloomT', s.bloomT || 0);
    u2f(pr, 'uRes', dw, dh); u2f(pr, 'uCenterUv', s.center[0] / dw, s.center[1] / dh);
    pass(pr, null, dw, dh);
  }

  // --- the minimap image: the scene and the mix at w x h, read back --------------
  let mini = null;
  function renderMini(s, w, h) {
    if (!mini || mini.w !== w || mini.h !== h) { freeTarget(mini && mini.scene); freeTarget(mini && mini.out); mini = { w, h, scene: target(w, h, 'half'), out: target(w, h, 'byte') }; }
    sceneInto(s, mini.scene.f, w, h);
    gl.bindVertexArray(vao); gl.disable(gl.BLEND);
    const pr = P.comp; gl.useProgram(pr.p);
    bindSrc(pr, 'uScene', mini.scene.t, 0); bindSrc(pr, 'uB1', mini.scene.t, 1); bindSrc(pr, 'uB2', mini.scene.t, 2);
    u3f(pr, 'uBg0', ...s.bg[0]); u3f(pr, 'uBg1', ...s.bg[1]);
    u1f(pr, 'uBloom', 0); u1f(pr, 'uExposure', 1.15); u1f(pr, 'uBloomT', 0);
    u2f(pr, 'uRes', w, h); u2f(pr, 'uCenterUv', 0.5, 0.5);
    pass(pr, mini.out, w, h);
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return px;
  }

  // --- self-test hooks ------------------------------------------------------------------
  // GPU positions of n = n0 + i * step, i < count, from gPos (glsl.js).
  function tfPositions(s, shapeId, n0, step, count) {
    if (!tfProg) tfProg = program(G.TF_VS, G.TF_FS, ['vPos']);
    const pr = tfProg; gl.useProgram(pr.p);
    shapeUniforms(pr, s);
    u1i(pr, 'uShape', shapeId); u1u(pr, 'uN0', n0); u1u(pr, 'uStep', step);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, buf);
    gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, count * 12, gl.STREAM_READ);
    const tfo = gl.createTransformFeedback();
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tfo);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buf);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.bindVertexArray(vao);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    const out = new Float32Array(count * 3);
    gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, out);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.deleteBuffer(buf); gl.deleteTransformFeedback(tfo);
    return out;
  }
  // The index k per pixel of the field pass in debug mode (k = -1 -> 2^24-1).
  function readIndex(s, w, h) {
    const t = target(w, h, 'byte');
    sceneInto({ ...s, debug: 1, points: null, path: null }, t.f, w, h);
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    freeTarget(t);
    const k = new Int32Array(w * h);
    for (let i = 0; i < w * h; i++) { const v = px[4 * i] | (px[4 * i + 1] << 8) | (px[4 * i + 2] << 16); k[i] = v === 16777215 ? -1 : v; }
    return k;
  }

  // The class byte and the quadratic flag per pixel (debug pass 2).
  function readClass(s, w, h) {
    const t = target(w, h, 'byte');
    sceneInto({ ...s, debug: s.debug || 2, points: null, path: null }, t.f, w, h);
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    freeTarget(t);
    return px;
  }

  const pyrInfo = () => ({ done: pyr.done, B0: pyr.B0, w: pyr.w, h: pyr.h, org: pyr.org, alpha: pyr.alpha, levels: pyr.levels, ms: +pyr.ms.toFixed(1), busy: pyrBusy });
  return { gl, half, readClass, maxTex, setPrimes, setArith, setTile, clearTile, draw, renderMini, tfPositions, readIndex, primes, arith, tile, pyrEnsure, pyrInfo, pyrBusy: () => pyrBusy };
}
