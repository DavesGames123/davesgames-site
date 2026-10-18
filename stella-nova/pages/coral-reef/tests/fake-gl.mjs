// ============================================================================
//  CORAL REEF  ·  tests/fake-gl.mjs  ·  a recording WebGL2 stand-in (node)
// ----------------------------------------------------------------------------
//  three r160 WebGLRenderer runs on it with no GPU: each call is a no-op or
//  a plausible value, and the draws, clears and framebuffer binds go to a
//  log. scene.js can then run its real frame (createScene, render) in node,
//  and a test can see which pass drew into which target.
//
//    installThree()                 the 'three' import map for node (call
//                                   before importing scene.js)
//    installDom()                   the small DOM that scene.js and three
//                                   need (document.createElementNS, window)
//    const f = fakeCanvas({ w, h, ext, compileError, maxTex })
//      f.canvas                     give it to createScene
//      f.gl                         the context (a Proxy)
//      f.log                        [{ op, fb, n, mode }] draws and clears
//      f.loseContext() / f.restoreContext()   fire the context events
//    ext: the extension names the device has (default: the float ones)
//    compileError: a string: a shader that has it in its source fails to
//    compile with that text in its info log
//
//  readPixels on a framebuffer gives the last clear colour when nothing was
//  drawn after the clear, else a grey (the sentinel check of scene.js).
// ============================================================================
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let threeDone = false;
export function installThree() {
  if (threeDone) return; threeDone = true;
  const V = pathToFileURL(path.join(HERE, '../../../vendor/three@0.160.0/')).href;
  register('data:text/javascript,' + encodeURIComponent(`
    const V = ${JSON.stringify(V)};
    export async function resolve(s, c, n) {
      if (s === 'three') return n(V + 'build/three.module.js', c);
      if (s.startsWith('three/addons/')) return n(V + 'examples/jsm/' + s.slice(13), c);
      return n(s, c);
    }`));
}

function evTarget(o) {
  const L = new Map();
  o.addEventListener = (t, f) => { if (!L.has(t)) L.set(t, new Set()); L.get(t).add(f); };
  o.removeEventListener = (t, f) => { if (L.has(t)) L.get(t).delete(f); };
  o.dispatch = (t, e = {}) => { e.type = t; e.preventDefault = e.preventDefault || (() => { e.defaultPrevented = true; }); for (const f of [...(L.get(t) || [])]) f.call(o, e); return e; };
  return o;
}

export function installDom() {
  const g = globalThis;
  if (!g.window) g.window = g;
  if (!g.devicePixelRatio) g.devicePixelRatio = 1;
  if (!g.document) {
    g.document = evTarget({
      createElementNS: () => evTarget({ style: {}, set src(v) { this._src = v; }, get src() { return this._src; } }),
      createElement: () => evTarget({ style: {} }),
      body: evTarget({ style: {} }),
    });
  }
  if (!g.requestAnimationFrame) g.requestAnimationFrame = () => 0;
  if (!g.self) g.self = g;
}

const DEFAULT_EXT = ['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'OES_texture_float_linear', 'EXT_float_blend', 'WEBGL_debug_renderer_info'];

export function fakeCanvas({ w = 800, h = 600, ext = DEFAULT_EXT, compileError = null, maxTex = 16 } = {}) {
  const C = new Map(); let cn = 0x8000;
  const K = name => { if (!C.has(name)) C.set(name, cn++); return C.get(name); };
  const log = [];
  let lost = false, fb = null, nextId = 1;
  const state = new Map();            // fb -> { clear: [r,g,b,a], drawn }
  const fbState = f => { const k = f ? f.id : 0; if (!state.has(k)) state.set(k, { clear: [0, 0, 0, 0], drawn: false }); return state.get(k); };
  let clearCol = [0, 0, 0, 0];
  const shaders = new Map();
  const obj = kind => ({ id: nextId++, kind });
  const canvas = evTarget({ width: w, height: h, clientWidth: w, clientHeight: h, style: {} });
  const params = () => ({
    [K('VERSION')]: 'WebGL 2.0 (fake)', [K('SHADING_LANGUAGE_VERSION')]: 'WebGL GLSL ES 3.00 (fake)',
    [K('MAX_TEXTURE_IMAGE_UNITS')]: maxTex, [K('MAX_VERTEX_TEXTURE_IMAGE_UNITS')]: 16, [K('MAX_COMBINED_TEXTURE_IMAGE_UNITS')]: 32,
    [K('MAX_TEXTURE_SIZE')]: 8192, [K('MAX_CUBE_MAP_TEXTURE_SIZE')]: 8192, [K('MAX_VERTEX_ATTRIBS')]: 16,
    [K('MAX_VERTEX_UNIFORM_VECTORS')]: 1024, [K('MAX_VARYING_VECTORS')]: 15, [K('MAX_FRAGMENT_UNIFORM_VECTORS')]: 1024,
    [K('MAX_SAMPLES')]: 4, [K('MAX_RENDERBUFFER_SIZE')]: 8192, [K('MAX_DRAW_BUFFERS')]: 8, [K('MAX_COLOR_ATTACHMENTS')]: 8,
    [K('VIEWPORT')]: new Int32Array([0, 0, canvas.width, canvas.height]), [K('SCISSOR_BOX')]: new Int32Array([0, 0, canvas.width, canvas.height]),
    [K('IMPLEMENTATION_COLOR_READ_TYPE')]: K('UNSIGNED_BYTE'), [K('IMPLEMENTATION_COLOR_READ_FORMAT')]: K('RGBA'),
    [K('MAX_TEXTURE_MAX_ANISOTROPY_EXT')]: 16,
  });
  const fns = {
    getContextAttributes: () => ({ alpha: false, antialias: false, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' }),
    isContextLost: () => lost,
    getExtension: n => (ext.includes(n) ? { name: n, MAX_TEXTURE_MAX_ANISOTROPY_EXT: K('MAX_TEXTURE_MAX_ANISOTROPY_EXT'), UNMASKED_RENDERER_WEBGL: K('UNMASKED_RENDERER_WEBGL'), loseContext: () => loseContext(), restoreContext: () => restoreContext() } : null),
    getSupportedExtensions: () => ext.slice(),
    getParameter: p => { const P = params(); return p in P ? P[p] : 0; },
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    createShader: t => { const s = obj('shader'); s.type = t; return s; },
    shaderSource: (s, src) => { shaders.set(s.id, src); },
    getShaderSource: s => shaders.get(s.id) || '',
    getShaderParameter: s => !(compileError && (shaders.get(s.id) || '').includes(compileError)),
    getShaderInfoLog: s => (compileError && (shaders.get(s.id) || '').includes(compileError) ? `ERROR: 0:12: '${compileError}' : fake compile error\n` : ''),
    getProgramParameter: (p, q) => (q === K('LINK_STATUS') ? !(p.bad) : q === K('ACTIVE_UNIFORMS') || q === K('ACTIVE_ATTRIBUTES') ? 0 : true),
    getProgramInfoLog: p => (p.bad ? 'fake link error' : ''),
    attachShader: (p, s) => { if (compileError && (shaders.get(s.id) || '').includes(compileError)) p.bad = true; },
    getAttribLocation: () => -1, getUniformLocation: () => null, getUniformBlockIndex: () => 0xFFFFFFFF,
    checkFramebufferStatus: () => K('FRAMEBUFFER_COMPLETE'),
    bindFramebuffer: (t, f) => { fb = f; },
    clearColor: (r, g, b, a) => { clearCol = [r, g, b, a]; },
    clear: () => { const s = fbState(fb); s.clear = clearCol.slice(); s.drawn = false; log.push({ op: 'clear', fb: fb ? fb.id : 0 }); },
    drawArrays: (mode, first, n) => { fbState(fb).drawn = true; log.push({ op: 'draw', fb: fb ? fb.id : 0, n }); },
    drawElements: (mode, n) => { fbState(fb).drawn = true; log.push({ op: 'draw', fb: fb ? fb.id : 0, n }); },
    drawArraysInstanced: (mode, first, n) => { fbState(fb).drawn = true; log.push({ op: 'draw', fb: fb ? fb.id : 0, n }); },
    drawElementsInstanced: (mode, n) => { fbState(fb).drawn = true; log.push({ op: 'draw', fb: fb ? fb.id : 0, n }); },
    readPixels: (x, y, w2, h2, f, t, buf) => {
      const s = fbState(fb);
      const c = s.drawn ? [0.1, 0.12, 0.14, 1] : s.clear;
      if (buf) for (let i = 0; i + 3 < buf.length; i += 4) { buf[i] = Math.round(c[0] * 255); buf[i + 1] = Math.round(c[1] * 255); buf[i + 2] = Math.round(c[2] * 255); buf[i + 3] = Math.round(c[3] * 255); }
    },
    fenceSync: () => obj('sync'), clientWaitSync: () => K('ALREADY_SIGNALED'), getSyncParameter: () => K('SIGNALED'),
  };
  for (const n of ['createProgram', 'createBuffer', 'createTexture', 'createFramebuffer', 'createRenderbuffer', 'createVertexArray', 'createQuery', 'createSampler']) fns[n] = () => obj(n);
  if (!globalThis.WebGL2RenderingContext) globalThis.WebGL2RenderingContext = class WebGL2RenderingContext {};
  const gl = new Proxy(new globalThis.WebGL2RenderingContext(), {
    get(_, p) {
      if (p === 'constructor') return globalThis.WebGL2RenderingContext;
      if (p === 'canvas') return canvas;
      if (p === 'drawingBufferWidth') return canvas.width;
      if (p === 'drawingBufferHeight') return canvas.height;
      if (p === 'drawingBufferColorSpace') return 'srgb';
      if (typeof p !== 'string') return undefined;
      if (p in fns) return fns[p];
      if (/^[A-Z0-9_]+$/.test(p)) return K(p);
      return () => {};
    },
    set() { return true; },
  });
  // three r160 WebGLRenderer asks the canvas for 'webgl2'
  canvas.getContext = (kind) => (kind === 'webgl2' ? gl : null);
  function loseContext() { lost = true; canvas.dispatch('webglcontextlost', {}); }
  function restoreContext() { lost = false; canvas.dispatch('webglcontextrestored', {}); }
  return { canvas, gl, log, K, loseContext, restoreContext, get lost() { return lost; } };
}
