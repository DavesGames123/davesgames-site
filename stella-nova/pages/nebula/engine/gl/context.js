// context.js: WebGL2 context, caps, programs, full-screen triangle, GPU timer, context loss.
// Owner: row A3. Spec: nebula-spec.md 7.1, 7.4 (table), 2.13.1.
//
// Exports (grep -n "^export"):
//   createGL(canvas) -> { gl, caps }       make the context and read the caps (7.1)
//   GL_ATTRS                               the context attributes (createGL, js/boot-compile.js)
//   checkCaps(caps, tierName) -> [string]  the caps of 7.1 that fail, for the "what is missing" line
//   rendererInfo(gl) -> { vendor, renderer }  unmasked strings when the browser gives them
//   program(gl, name, vsSrc, fsSrc)        compile and link with PRELUDE; log the time. If programStart
//                                          started the same name with the same text, program() adopts it.
//   programStart(gl, name, vsSrc, fsSrc)   L2: start a compile and link, and do not ask for the status
//   programReady(gl, name) -> bool         true when a started program is done (KHR_parallel_shader_compile)
//   programTimes                           { name: compile and link ms }, for report.programsMs
//   FULLSCREEN_VS                          vertex shader of the full-screen triangle
//   fullscreenTriangle(gl) -> { vao, draw() }
//   gpuTimer(gl, caps) -> { enabled, begin(label), end(), poll(), inFlight(), totals }
//   onContextLost(cb), onContextRestored(cb)
//
// The shells start with "#version 300 es". program() puts PRELUDE on the line after the
// version line. If a source has no version line, program() adds one first.

import { PRELUDE } from '../shaders/prelude.glsl.js';

const lostCallbacks = [];
const restoredCallbacks = [];

export const programTimes = {};

// The context attributes. js/boot-compile.js asks for the context with the same attributes before
// main.js runs. A second getContext call on the same canvas returns that context.
export const GL_ATTRS = {
  alpha: false, depth: false, stencil: false, antialias: false,
  premultipliedAlpha: false, preserveDrawingBuffer: false,
  powerPreference: 'high-performance',
};

export function createGL(canvas) {
  const gl = canvas.getContext('webgl2', GL_ATTRS);
  if (!gl) return { gl: null, caps: null };

  // getExtension enables the extension. Keep the calls here, before any texture is made.
  const cbf = gl.getExtension('EXT_color_buffer_float');
  const fl = gl.getExtension('OES_texture_float_linear');
  const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');

  const caps = {
    colorBufferFloat: !!cbf,
    floatLinear: !!fl,
    timer: !!tq,
    max3D: gl.getParameter(gl.MAX_3D_TEXTURE_SIZE),
    maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxDrawBuffers: gl.getParameter(gl.MAX_DRAW_BUFFERS),
    maxFragmentUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
    maxUniformBlockSize: gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE),
  };

  // Fixed state for every pass: no blend, no depth, no cull, no dither.
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.DITHER);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 1);

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();   // without this, the browser never restores the context
    console.warn('[gl] context lost');
    for (const cb of lostCallbacks) { try { cb(e); } catch (err) { console.error(err); } }
  }, false);
  canvas.addEventListener('webglcontextrestored', (e) => {
    console.warn('[gl] context restored');
    for (const cb of restoredCallbacks) { try { cb(e); } catch (err) { console.error(err); } }
  }, false);

  return { gl, caps };
}

// The checks of 7.1. tierName is 'W' (Preview) or 'U' (Full).
export function checkCaps(caps, tierName) {
  if (!caps) return ['WebGL2'];
  const miss = [];
  if (!caps.colorBufferFloat) miss.push('EXT_color_buffer_float');
  if (caps.max3D < 288) miss.push(`MAX_3D_TEXTURE_SIZE ${caps.max3D} < 288`);
  if (tierName === 'U') {
    if (caps.max3D < 576) miss.push(`MAX_3D_TEXTURE_SIZE ${caps.max3D} < 576`);
    if (caps.maxTex < 5760) miss.push(`MAX_TEXTURE_SIZE ${caps.maxTex} < 5760`);
  }
  if (caps.maxDrawBuffers < 2) miss.push(`MAX_DRAW_BUFFERS ${caps.maxDrawBuffers} < 2`);
  if (caps.maxFragmentUniformVectors < 64) miss.push(`MAX_FRAGMENT_UNIFORM_VECTORS ${caps.maxFragmentUniformVectors} < 64`);
  if (caps.maxUniformBlockSize < 16384) miss.push(`MAX_UNIFORM_BLOCK_SIZE ${caps.maxUniformBlockSize} < 16384`);
  return miss;
}

export function rendererInfo(gl) {
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    vendor: gl.getParameter(dbg ? dbg.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
    renderer: gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
  };
}

// Put PRELUDE after the "#version" line. Add the version line if it is not there.
// A "#version" line in PRELUDE is removed, because it must be the first line.
const PRELUDE_BODY = PRELUDE.replace(/^\s*#version[^\n]*\n/, '');

function withPrelude(src) {
  const m = /^\s*#version[^\n]*\n/.exec(src);
  if (m) return m[0] + PRELUDE_BODY + '\n#line 2\n' + src.slice(m[0].length);
  return '#version 300 es\n' + PRELUDE_BODY + '\n#line 1\n' + src;
}

function numbered(src) {
  return src.split('\n').map((l, i) => String(i + 1).padStart(4) + ' ' + l).join('\n');
}

// L2 (pass3-bake-speed.md B6): programs started at boot. The status query of program() blocks until the
// driver is done, so a boot that calls program() once per shader compiles them one after the other
// (4.4 s cold, measured). programStart() only submits the work. With KHR_parallel_shader_compile, ANGLE
// compiles on worker threads, and the later program() call waits only for the rest of that compile.
const started = new Map();   // name -> { gl, vsFull, fsFull, vs, fs, prog, t0 }

export function programStart(gl, name, vsSrc, fsSrc) {
  if (started.has(name)) return;
  gl.getExtension('KHR_parallel_shader_compile');
  const vsFull = withPrelude(vsSrc || FULLSCREEN_VS);
  const fsFull = withPrelude(fsSrc);
  const t0 = performance.now();
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(vs, vsFull);
  gl.shaderSource(fs, fsFull);
  gl.compileShader(vs);
  gl.compileShader(fs);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  started.set(name, { gl, vsFull, fsFull, vs, fs, prog, t0 });
}

export function programReady(gl, name) {
  const p = started.get(name);
  const k = gl.getExtension('KHR_parallel_shader_compile');
  return !p || !k || !!gl.getProgramParameter(p.prog, k.COMPLETION_STATUS_KHR);
}

// Compile and link. Returns { name, prog, uniforms: Map(name -> { loc, type, size }), ms }.
// On an error it logs the numbered source and throws.
export function program(gl, name, vsSrc, fsSrc) {
  const t0 = performance.now();
  const vsFull = withPrelude(vsSrc || FULLSCREEN_VS);
  const fsFull = withPrelude(fsSrc);
  let vs, fs, prog, adopted = false;
  const pre = started.get(name);
  if (pre) {
    started.delete(name);
    if (pre.gl === gl && pre.vsFull === vsFull && pre.fsFull === fsFull && !gl.isContextLost()) {
      ({ vs, fs, prog } = pre);
      adopted = true;
    } else {
      gl.deleteShader(pre.vs); gl.deleteShader(pre.fs); gl.deleteProgram(pre.prog);
    }
  }
  if (!adopted) {
    vs = gl.createShader(gl.VERTEX_SHADER);
    fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(vs, vsFull);
    gl.shaderSource(fs, fsFull);
    gl.compileShader(vs);
    gl.compileShader(fs);
    prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
  }
  // The status query waits for the driver. The time below includes compile and link.
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const vlog = gl.getShaderInfoLog(vs), flog = gl.getShaderInfoLog(fs), plog = gl.getProgramInfoLog(prog);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) console.error(`[gl] ${name} vs:\n${vlog}\n${numbered(vsFull)}`);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) console.error(`[gl] ${name} fs:\n${flog}\n${numbered(fsFull)}`);
    gl.deleteShader(vs); gl.deleteShader(fs); gl.deleteProgram(prog);
    throw new Error(`[gl] program ${name} failed: ${plog || flog || vlog}`);
  }
  gl.detachShader(prog, vs); gl.detachShader(prog, fs);
  gl.deleteShader(vs); gl.deleteShader(fs);
  // For an adopted program, ms is the wait in this call only (the rest ran on a worker thread).
  const ms = performance.now() - t0;
  programTimes[name] = ms;
  console.info(`[gl] program ${name}: ${adopted ? 'adopted, waited' : 'compile and link'} ${ms.toFixed(1)} ms`);

  const uniforms = new Map();
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(prog, i);
    if (!info) continue;
    const key = info.name.endsWith('[0]') ? info.name.slice(0, -3) : info.name;
    uniforms.set(key, { loc: gl.getUniformLocation(prog, info.name), type: info.type, size: info.size });
  }
  return { name, prog, uniforms, ms };
}

// One triangle that covers the viewport. It uses gl_VertexID, so it needs no vertex buffer.
export const FULLSCREEN_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export function fullscreenTriangle(gl) {
  const vao = gl.createVertexArray();   // empty VAO: the draw reads no attribute
  return {
    vao,
    draw() { gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3); },
  };
}

// GPU timer with EXT_disjoint_timer_query_webgl2. One query is open at a time.
// poll() collects the finished queries; totals holds the ms per label.
export function gpuTimer(gl, caps) {
  const ext = caps && caps.timer ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
  const pending = [];
  const totals = {};
  let open = null;
  if (!ext) {
    return { enabled: false, begin() {}, end() {}, poll() { return []; }, inFlight() { return 0; }, totals };
  }
  return {
    enabled: true,
    totals,
    begin(label) {
      if (open) this.end();
      const q = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      open = { q, label };
    },
    end() {
      if (!open) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(open);
      open = null;
    },
    poll() {
      const done = [];
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      while (pending.length) {
        const p = pending[0];
        if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) break;
        pending.shift();
        const ns = gl.getQueryParameter(p.q, gl.QUERY_RESULT);
        gl.deleteQuery(p.q);
        if (disjoint) continue;   // the GPU clock jumped: the value is not valid
        const ms = ns / 1e6;
        totals[p.label] = (totals[p.label] || 0) + ms;
        done.push({ label: p.label, ms });
      }
      return done;
    },
    // The queries that have no result yet: about the frames that the GPU has not done yet.
    inFlight() { return pending.length + (open ? 1 : 0); },
  };
}

// The callbacks run for every context that createGL made. The lost handler calls preventDefault.
export function onContextLost(cb) { lostCallbacks.push(cb); }
export function onContextRestored(cb) { restoredCallbacks.push(cb); }
