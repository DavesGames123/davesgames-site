// ============================================================================
//  CHANDRASEKHAR LIMIT  ·  glkit.js — one WebGL 2 context per figure
// ----------------------------------------------------------------------------
//  makeGL(canvas) compiles full-screen fragment shaders (glsl.js) and
//  draws them with one triangle (no buffers: gl_VertexID). A figure that
//  scrolls out of view stops drawing (IntersectionObserver). A frame that
//  takes too long lowers the buffer scale, a fast one raises it again.
//  On pagehide every context is lost on purpose, so the shell can swap
//  pages without a GPU build-up (see lib notes on page swaps).
//
//  EXPORTS   (jump with grep -n "<anchor>" glkit.js)
//    makeGL ........ "export function makeGL"    context + programs
//    runLoop ....... "export function runLoop"   visible-only rAF loop
//    dragOrbit ..... "export function dragOrbit" pointer drag -> yaw, pitch
//    releaseAll .... "export function releaseAll"
// ============================================================================
import { VERT } from './glsl.js';

const LIVE = new Set();

export function makeGL(canvas, { alpha = false } = {}) {
  const gl = canvas.getContext('webgl2', { alpha, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) return null;
  LIVE.add(gl);
  const vao = gl.createVertexArray();
  const progs = new Map();
  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(s);
      throw new Error('shader compile: ' + log);
    }
    return s;
  }
  function program(name, frag) {
    if (progs.has(name)) return progs.get(name);
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('link ' + name + ': ' + gl.getProgramInfoLog(p));
    const loc = new Map();
    const P = {
      name, p,
      u(n) { if (!loc.has(n)) loc.set(n, gl.getUniformLocation(p, n)); return loc.get(n); },
    };
    progs.set(name, P);
    return P;
  }
  // Set uniforms by the JS type: number -> float, [a,b] vec2, [a,b,c] vec3,
  // {i: n} int, Float32Array -> float array.
  function set(P, U) {
    for (const k in U) {
      const v = U[k], l = P.u(k);
      if (l == null) continue;
      if (typeof v === 'number') gl.uniform1f(l, v);
      else if (v instanceof Float32Array) gl.uniform1fv(l, v);
      else if (Array.isArray(v)) (v.length === 2 ? gl.uniform2fv : v.length === 3 ? gl.uniform3fv : gl.uniform4fv).call(gl, l, v);
      else if (v && typeof v.i === 'number') gl.uniform1i(l, v.i);
    }
  }
  function draw(P, U, w, h) {
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.useProgram(P.p);
    gl.bindVertexArray(vao);
    set(P, Object.assign({ uRes: [w, h] }, U));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  return { gl, canvas, program, draw, lost: () => gl.isContextLost() };
}

// Render loop for one figure. frame(dt, t, scale) draws; it gets the
// buffer scale (0.4..1 of CSS px x dpr, dpr capped at maxDpr). The loop
// runs only while the canvas is on screen and the tab is visible.
export function runLoop(canvas, frame, { maxDpr = 1.5, minScale = 0.4, budgetMs = 22, always = false } = {}) {
  let vis = always, raf = 0, last = 0, scale = 0.8, slow = 0, fast = 0, t = 0, stopped = false;
  const io = new IntersectionObserver(es => { vis = always || es.some(e => e.isIntersecting); kick(); }, { rootMargin: '120px' });
  io.observe(canvas);
  function kick() { if (!raf && vis && !stopped && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(tick); } }
  function tick(now) {
    raf = 0;
    if (!vis || stopped || document.hidden) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now; t += dt;
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(r.width * dpr * scale)), h = Math.max(2, Math.round(r.height * dpr * scale));
    const t0 = performance.now();
    frame(dt, t, w, h);
    const ms = performance.now() - t0;
    // CPU time is a poor GPU measure, so also watch the frame interval.
    const gap = dt * 1000;
    if (gap > budgetMs * 1.6 || ms > budgetMs) { if (++slow > 8) { scale = Math.max(minScale, scale * 0.85); slow = 0; } fast = 0; }
    else if (gap < 18) { if (++fast > 90) { scale = Math.min(1, scale * 1.1); fast = 0; } slow = 0; }
    raf = requestAnimationFrame(tick);
  }
  document.addEventListener('visibilitychange', kick);
  return {
    kick,
    stop() { stopped = true; if (raf) cancelAnimationFrame(raf); raf = 0; io.disconnect(); },
    setAlways(v) { always = v; vis = vis || v; kick(); },
    get scale() { return scale; }, set scale(v) { scale = v; },
  };
}

// Drag to turn: yaw and pitch in radians. A vertical drag on a phone
// scrolls the page unless it starts as a horizontal drag (touch-action
// pan-y on the canvas).
export function dragOrbit(el, state, { pitchMin = -1.2, pitchMax = 1.2, onMove } = {}) {
  let id = null, x0 = 0, y0 = 0;
  el.addEventListener('pointerdown', e => { id = e.pointerId; x0 = e.clientX; y0 = e.clientY; el.setPointerCapture(id); state.held = true; });
  el.addEventListener('pointermove', e => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - x0, dy = e.clientY - y0; x0 = e.clientX; y0 = e.clientY;
    state.yaw -= dx * 0.006;
    state.pitch = Math.min(pitchMax, Math.max(pitchMin, state.pitch + dy * 0.005));
    onMove && onMove();
  });
  const up = e => { if (e.pointerId === id) { id = null; state.held = false; } };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}

export function releaseAll() {
  for (const gl of LIVE) { try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch (e) {} }
  LIVE.clear();
}
addEventListener('pagehide', releaseAll);
