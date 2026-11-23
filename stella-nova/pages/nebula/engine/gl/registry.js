// registry.js: the GPU texture registry of the bake. It counts bytes and holds the FBOs.
// Owner: row A3. Spec: nebula-spec.md 7.4.3, 2.14, 3.7.
//
// Exports (grep -n "^export"):
//   FORMATS                               internal format table: { gl enum key, bytes per texel }
//   createRegistry(gl, caps?) -> registry
//
// registry (grep -n "^    [a-zA-Z0-9]*(" registry.js):
//   tex3D(name, [w, h, d], internalFormat, { filter, wrapX })   TEXTURE_3D
//   tex2D(name, w, h, internalFormat, opts)                      TEXTURE_2D
//   tex2DArray(name, w, h, layers, internalFormat, opts)         TEXTURE_2D_ARRAY
//   get(name), release(name), releasePrefix(prefix), releaseAll()
//   bytesLive(), bytesPeak(), live3D(), list() -> [{ name, bytes, kind }]
//
// internalFormat is a string ('RGBA32F', 'RGBA16F', 'RG16F', 'R16F', and so on) or the GL enum.
// opts = { filter: 'linear' | 'nearest', wrapX: 'repeat' | 'clamp', data: TypedArray }.
// y and z (or layers) always clamp. The storage is immutable (texStorage), with one level and no mips.
//
// Filter rule (7.4.3): WebGL2 cannot filter a 32F texture LINEAR without OES_texture_float_linear.
// Such a texture is incomplete and samples as (0, 0, 0, 1) with no error. So the registry forces
// NEAREST for every 32F format when caps.floatLinear is false, and logs the change.
//
// FBOs (2.14): the registry makes one FBO for each (texture, layer) pair when it makes the texture.
// passes.js only binds them, so no draw changes an attachment. entry.fbos[layer] holds them.
// passes.js can add more FBOs (MRT sets) to entry.onRelease, so release() deletes them too.
//
// Entry fields: { name, kind: '3d' | '2d' | '2darray', target, tex, w, h, d, internalFormat,
//                 format, type, bytesPerTexel, bytes, filter, wrapX, filterForced, fbos, onRelease }.
// d is 1 for '2d' and the layer count for '2darray'.

export const FORMATS = {
  RGBA32F: { bpt: 16, format: 'RGBA', type: 'FLOAT', f32: true },
  RG32F:   { bpt: 8,  format: 'RG',   type: 'FLOAT', f32: true },
  R32F:    { bpt: 4,  format: 'RED',  type: 'FLOAT', f32: true },
  RGBA16F: { bpt: 8,  format: 'RGBA', type: 'HALF_FLOAT', f32: false },
  RG16F:   { bpt: 4,  format: 'RG',   type: 'HALF_FLOAT', f32: false },
  R16F:    { bpt: 2,  format: 'RED',  type: 'HALF_FLOAT', f32: false },
  RGBA8:   { bpt: 4,  format: 'RGBA', type: 'UNSIGNED_BYTE', f32: false },
  RG8:     { bpt: 2,  format: 'RG',   type: 'UNSIGNED_BYTE', f32: false },
  R8:      { bpt: 1,  format: 'RED',  type: 'UNSIGNED_BYTE', f32: false },
};

function formatName(gl, internalFormat) {
  if (typeof internalFormat === 'string') {
    if (!FORMATS[internalFormat]) throw new Error(`[registry] unknown format ${internalFormat}`);
    return internalFormat;
  }
  for (const k of Object.keys(FORMATS)) if (gl[k] === internalFormat) return k;
  throw new Error(`[registry] unknown format enum ${internalFormat}`);
}

export function createRegistry(gl, caps) {
  // Without caps, ask the context. getExtension returns the same object that createGL enabled.
  const floatLinear = caps ? !!caps.floatLinear : !!gl.getExtension('OES_texture_float_linear');
  const renderable = caps ? !!caps.colorBufferFloat : !!gl.getExtension('EXT_color_buffer_float');
  const entries = new Map();
  let live = 0;
  let peak = 0;

  function makeFbo(entry, layer) {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    if (entry.kind === '2d') {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, entry.tex, 0);
    } else {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, entry.tex, 0, layer);
    }
    return fbo;
  }

  function alloc(kind, name, w, h, d, internalFormat, opts) {
    opts = opts || {};
    if (entries.has(name)) {
      console.info(`[registry] ${name} exists: release it and make it again`);
      release(name);
    }
    const fname = formatName(gl, internalFormat);
    const f = FORMATS[fname];
    const target = kind === '3d' ? gl.TEXTURE_3D : kind === '2darray' ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D;

    let filter = opts.filter === 'linear' ? 'linear' : 'nearest';
    let filterForced = false;
    if (filter === 'linear' && f.f32 && !floatLinear) {
      filter = 'nearest';
      filterForced = true;
      console.info(`[registry] ${name}: ${fname} with LINEAR is not complete without OES_texture_float_linear; NEAREST is used`);
    }
    const wrapX = opts.wrapX === 'repeat' ? 'repeat' : 'clamp';

    const tex = gl.createTexture();
    gl.bindTexture(target, tex);
    if (kind === '2d') gl.texStorage2D(target, 1, gl[fname], w, h);
    else gl.texStorage3D(target, 1, gl[fname], w, h, d);
    const glFilter = filter === 'linear' ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, glFilter);
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, glFilter);
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, wrapX === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (kind !== '2d') gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_BASE_LEVEL, 0);
    gl.texParameteri(target, gl.TEXTURE_MAX_LEVEL, 0);
    if (opts.data) {
      if (kind === '2d') gl.texSubImage2D(target, 0, 0, 0, w, h, gl[f.format], gl[f.type], opts.data);
      else gl.texSubImage3D(target, 0, 0, 0, 0, w, h, d, gl[f.format], gl[f.type], opts.data);
    }
    gl.bindTexture(target, null);

    const bytes = w * h * d * f.bpt;
    const entry = {
      name, kind, target, tex, w, h, d, internalFormat: fname, format: gl[f.format], type: gl[f.type],
      bytesPerTexel: f.bpt, bytes, filter, wrapX, filterForced, fbos: [], onRelease: [],
    };

    // Float formats render only with EXT_color_buffer_float. 8-bit formats always render.
    if (renderable || !(f.type === 'FLOAT' || f.type === 'HALF_FLOAT')) {
      const n = kind === '2d' ? 1 : d;
      for (let z = 0; z < n; z++) entry.fbos.push(makeFbo(entry, z));
      // Check one FBO only. A check makes the driver validate the FBO, and every layer is the same.
      gl.bindFramebuffer(gl.FRAMEBUFFER, entry.fbos[0]);
      const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (st !== gl.FRAMEBUFFER_COMPLETE) console.warn(`[registry] ${name}: FBO status 0x${st.toString(16)}`);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    entries.set(name, entry);
    live += bytes;
    if (live > peak) peak = live;
    return entry;
  }

  function release(name) {
    const e = entries.get(name);
    if (!e) return false;
    for (const cb of e.onRelease) { try { cb(e); } catch (err) { console.error(err); } }
    for (const fbo of e.fbos) gl.deleteFramebuffer(fbo);
    gl.deleteTexture(e.tex);   // on a lost context this does nothing, and that is correct
    e.fbos.length = 0;
    e.tex = null;
    entries.delete(name);
    live -= e.bytes;
    return true;
  }

  return {
    tex3D(name, dims, internalFormat, opts) {
      return alloc('3d', name, dims[0], dims[1], dims[2], internalFormat, opts);
    },
    tex2D(name, w, h, internalFormat, opts) {
      return alloc('2d', name, w, h, 1, internalFormat, opts);
    },
    tex2DArray(name, w, h, layers, internalFormat, opts) {
      return alloc('2darray', name, w, h, layers, internalFormat, opts);
    },
    get(name) { return entries.get(name) || null; },
    release,
    releasePrefix(prefix) {
      let n = 0;
      for (const name of [...entries.keys()]) if (name.startsWith(prefix)) { release(name); n++; }
      return n;
    },
    releaseAll() {
      for (const name of [...entries.keys()]) release(name);
      live = 0;
    },
    bytesLive() { return live; },
    bytesPeak() { return peak; },
    live3D() {
      let n = 0;
      for (const e of entries.values()) if (e.kind === '3d') n++;
      return n;
    },
    list() {
      return [...entries.values()].map((e) => ({ name: e.name, bytes: e.bytes, kind: e.kind }));
    },
  };
}
