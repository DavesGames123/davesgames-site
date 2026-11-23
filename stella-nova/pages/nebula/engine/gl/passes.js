// passes.js: draw passes on registry textures, with cached FBOs.
// Owner: row A3. Spec: nebula-spec.md 7.4 (table), 2.14, 2.13.2 (WebGL2 shell).
//
// Exports (grep -n "^export"):
//   runSlicePass(ctx, prog, { targets, dims, uniforms, textures, layers })
//       one draw per z-layer into 3D (or 2D array) targets; MRT when targets has more than one name
//   runQuadPass(ctx, prog, { target, layer, rect, uniforms, textures })
//       one draw into one layer of one target; target null draws to the canvas; an array target is an
//       MRT set (the same layer of each member, attachment i = member i)
//   readFloat(ctx, tex, layer, rect) -> Float32Array   4 floats per texel (RGBA), rows from the bottom
//   copyToLayer(ctx, src, dst, layer)                  blit src (layer 0) into one layer of dst
//   setUniforms(gl, prog, uniforms), bindTextures(ctx, prog, textures)   helpers
//
// ctx = { gl, caps, registry, tier, timer }. prog is the object that context.program() returns.
// A target or texture is a registry name or a registry entry.
// The slice pass sets the int uniform _Slice to the layer index before each draw.
// In the shader, the texel of a slice draw is ivec3(ivec2(gl_FragCoord.xy), _Slice).
//
// FBO rule (2.14): a single target uses entry.fbos[layer], which the registry made at allocation.
// An MRT set uses one FBO for each (set, layer). passes.js makes it on the first draw and keeps it.
// The drawBuffers list is FBO state, so it is set once, when the FBO is made.
// When the registry releases a member of a set, the FBOs of that set are deleted.

import { fullscreenTriangle } from './context.js';

const triangles = new WeakMap();   // gl -> fullscreenTriangle
const mrtCaches = new WeakMap();   // registry -> Map(key -> fbo)

function tri(gl) {
  let t = triangles.get(gl);
  if (!t) { t = fullscreenTriangle(gl); triangles.set(gl, t); }
  return t;
}

function entryOf(ctx, t) {
  if (t == null) return null;
  const e = typeof t === 'string' ? ctx.registry.get(t) : t;
  if (!e || !e.tex) throw new Error(`[passes] no live texture ${typeof t === 'string' ? t : t.name}`);
  return e;
}

function mrtFbo(ctx, entries, layer) {
  const { gl, registry } = ctx;
  let cache = mrtCaches.get(registry);
  if (!cache) { cache = new Map(); mrtCaches.set(registry, cache); }
  const key = entries.map((e) => e.name).join('|') + '@' + layer;
  let fbo = cache.get(key);
  if (fbo) return fbo;
  fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const bufs = [];
  entries.forEach((e, i) => {
    const att = gl.COLOR_ATTACHMENT0 + i;
    if (e.kind === '2d') gl.framebufferTexture2D(gl.FRAMEBUFFER, att, gl.TEXTURE_2D, e.tex, 0);
    else gl.framebufferTextureLayer(gl.FRAMEBUFFER, att, e.tex, 0, layer);
    bufs.push(att);
  });
  gl.drawBuffers(bufs);
  if (layer === 0) {
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) console.warn(`[passes] MRT ${key}: FBO status 0x${st.toString(16)}`);
  }
  cache.set(key, fbo);
  const drop = () => {
    if (cache.get(key) === fbo) { cache.delete(key); gl.deleteFramebuffer(fbo); }
  };
  for (const e of entries) e.onRelease.push(drop);
  return fbo;
}

function fboFor(ctx, entries, layer) {
  if (entries.length === 1) {
    const f = entries[0].fbos[entries[0].kind === '2d' ? 0 : layer];
    if (!f) throw new Error(`[passes] ${entries[0].name}: no FBO for layer ${layer} (EXT_color_buffer_float missing?)`);
    return f;
  }
  return mrtFbo(ctx, entries, layer);
}

// Set uniforms by the type that the program reports. Names the program does not use are skipped,
// because the compiler removes unused uniforms.
export function setUniforms(gl, prog, uniforms) {
  if (!uniforms) return;
  for (const name in uniforms) {
    const u = prog.uniforms.get(name);
    if (!u) continue;
    const v = uniforms[name];
    const a = typeof v === 'number' || typeof v === 'boolean' ? [Number(v)] : v;
    switch (u.type) {
      case gl.FLOAT: gl.uniform1fv(u.loc, a); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, a); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, a); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, a); break;
      case gl.INT: case gl.BOOL: gl.uniform1iv(u.loc, a); break;
      case gl.INT_VEC2: case gl.BOOL_VEC2: gl.uniform2iv(u.loc, a); break;
      case gl.INT_VEC3: case gl.BOOL_VEC3: gl.uniform3iv(u.loc, a); break;
      case gl.INT_VEC4: case gl.BOOL_VEC4: gl.uniform4iv(u.loc, a); break;
      case gl.UNSIGNED_INT: gl.uniform1uiv(u.loc, a); break;
      case gl.UNSIGNED_INT_VEC2: gl.uniform2uiv(u.loc, a); break;
      case gl.UNSIGNED_INT_VEC3: gl.uniform3uiv(u.loc, a); break;
      case gl.UNSIGNED_INT_VEC4: gl.uniform4uiv(u.loc, a); break;
      default: throw new Error(`[passes] ${prog.name}.${name}: uniform type 0x${u.type.toString(16)} is not supported`);
    }
  }
}

// Bind textures to units 0, 1, 2, ... and set each sampler uniform to its unit.
export function bindTextures(ctx, prog, textures) {
  const { gl } = ctx;
  if (!textures) return;
  let unit = 0;
  for (const name in textures) {
    const u = prog.uniforms.get(name);
    if (!u) continue;
    const e = entryOf(ctx, textures[name]);
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(e.target, e.tex);
    gl.uniform1i(u.loc, unit);
    unit++;
  }
  gl.activeTexture(gl.TEXTURE0);
}

// Unbind the units after a pass, so a later pass that renders into one of these textures
// does not make a feedback loop with a stale binding.
function unbindTextures(ctx, prog, textures) {
  const { gl } = ctx;
  if (!textures) return;
  let unit = 0;
  for (const name in textures) {
    if (!prog.uniforms.get(name)) continue;
    const e = entryOf(ctx, textures[name]);
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(e.target, null);
    unit++;
  }
  gl.activeTexture(gl.TEXTURE0);
}

export function runSlicePass(ctx, prog, { targets, dims, uniforms, textures, layers }) {
  const { gl } = ctx;
  const list = (Array.isArray(targets) ? targets : [targets]).map((t) => entryOf(ctx, t));
  if (list.length > ctx.caps.maxDrawBuffers) throw new Error(`[passes] ${list.length} targets > MAX_DRAW_BUFFERS`);
  const w = dims ? dims[0] : list[0].w;
  const h = dims ? dims[1] : list[0].h;
  const d = dims ? dims[2] : list[0].d;
  const z0 = layers ? layers[0] : 0;
  const z1 = layers ? layers[1] : d;
  const slice = prog.uniforms.get('_Slice');

  gl.useProgram(prog.prog);
  setUniforms(gl, prog, uniforms);
  bindTextures(ctx, prog, textures);
  gl.viewport(0, 0, w, h);
  gl.disable(gl.SCISSOR_TEST);
  const t = tri(gl);
  gl.bindVertexArray(t.vao);
  for (let z = z0; z < z1; z++) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboFor(ctx, list, z));
    if (slice) gl.uniform1i(slice.loc, z);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  gl.bindVertexArray(null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  unbindTextures(ctx, prog, textures);
}

export function runQuadPass(ctx, prog, { target, layer, rect, uniforms, textures }) {
  const { gl } = ctx;
  const z = layer || 0;
  let w, h;
  if (target == null) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    w = gl.drawingBufferWidth; h = gl.drawingBufferHeight;
  } else {
    const es = (Array.isArray(target) ? target : [target]).map((t) => entryOf(ctx, t));
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboFor(ctx, es, z));
    w = es[0].w; h = es[0].h;
  }
  gl.useProgram(prog.prog);
  setUniforms(gl, prog, uniforms);
  const slice = prog.uniforms.get('_Slice');
  if (slice) gl.uniform1i(slice.loc, z);
  bindTextures(ctx, prog, textures);
  if (rect) {
    gl.viewport(rect[0], rect[1], rect[2], rect[3]);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(rect[0], rect[1], rect[2], rect[3]);
  } else {
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
  }
  tri(gl).draw();
  gl.bindVertexArray(null);
  gl.disable(gl.SCISSOR_TEST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  unbindTextures(ctx, prog, textures);
}

// Read one layer back as floats. rect = [x, y, w, h] in texels; the default is the whole layer.
// readPixels waits for the GPU. Use it only for diagnostics and the small readbacks of the bake.
export function readFloat(ctx, tex, layer, rect) {
  const { gl } = ctx;
  const e = entryOf(ctx, tex);
  const [x, y, w, h] = rect || [0, 0, e.w, e.h];
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fboFor(ctx, [e], layer || 0));
  gl.readBuffer(gl.COLOR_ATTACHMENT0);
  let out;
  if (e.type === gl.UNSIGNED_BYTE) {
    const b = new Uint8Array(w * h * 4);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b);
    out = new Float32Array(b.length);
    for (let i = 0; i < b.length; i++) out[i] = b[i] / 255;
  } else {
    // RGBA + FLOAT is always a valid read of a float colour buffer with EXT_color_buffer_float.
    out = new Float32Array(w * h * 4);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, out);
  }
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  return out;
}

// Copy src (a 2D texture, or layer 0 of an array or 3D texture) into one layer of dst.
// The blit uses NEAREST, because WebGL2 does not blit float buffers LINEAR. If the sizes differ,
// the blit scales src to the full dst layer.
export function copyToLayer(ctx, src, dst, layer) {
  const { gl } = ctx;
  const s = entryOf(ctx, src);
  const d = entryOf(ctx, dst);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fboFor(ctx, [s], 0));
  gl.readBuffer(gl.COLOR_ATTACHMENT0);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fboFor(ctx, [d], layer || 0));
  gl.disable(gl.SCISSOR_TEST);
  gl.blitFramebuffer(0, 0, s.w, s.h, 0, 0, d.w, d.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
}
