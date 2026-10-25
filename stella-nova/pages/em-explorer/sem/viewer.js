// ============================================================================
//  EM EXPLORER  ·  sem/viewer.js — the WebGL2 turntable for surface scans
// ----------------------------------------------------------------------------
//  createSemViewer(canvas, { onChange }) -> {
//    setModel(model, { method }),  model = parseGlb() output (sem/glb.js)
//    reset(), setAuto(bool), resize(), state(), umPerPx(), dispose() }
//  onChange(state) fires when the view moves (for the scale bar).
//
//  CAMERA  orbit round the centre of the bounding box; perspective, 30 deg.
//    method 'mesh'   free orbit, a slow turntable when the reader is idle
//    method 'stereo' the scan sees one side, so yaw and pitch stay within
//                    55 deg of the original view, and the idle motion is a
//                    slow rock of 18 deg
//  INPUT   drag: turn · wheel or pinch: zoom · double click or tap: reset
//          arrows: turn · + and -: zoom · keys work when the canvas has focus
//  SHADING (fragment shader) an SEM look, not a photo: the secondary
//    electron yield rises as the surface turns away from the beam (about
//    1 / cos of the tilt), a side detector at the upper left lights the
//    faces that look at it, and the back of an open surface is dark.
//    A model with an SEM texture (stereo) shows that image, lightly shaded.
//
//  grep -n targets: "export function createSemViewer", "const FS",
//                   "function draw", "function onPointer", "umPerPx"
// ============================================================================

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in float aGrey;
layout(location=3) in vec2 aUv;
uniform mat4 uMvp;
uniform mat3 uRot;
out vec3 vN;
out float vGrey;
out vec2 vUv;
void main() {
  vN = uRot * aNrm;
  vGrey = aGrey;
  vUv = aUv;
  gl_Position = uMvp * vec4(aPos, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vN;
in float vGrey;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uHasTex;
uniform vec3 uLight;
out vec4 frag;
void main() {
  vec3 n = normalize(vN);
  float back = gl_FrontFacing ? 1.0 : 0.0;
  if (!gl_FrontFacing) n = -n;
  float c = clamp(n.z, 0.12, 1.0);               // cosine to the beam (view axis)
  float se = 1.0 / c - 1.0;                      // edge brightening
  float det = max(dot(n, uLight), 0.0);          // side detector
  float g = 0.30 + 0.42 * det + 0.16 * min(se, 2.5);
  g *= mix(1.0, 0.55 + 0.6 * vGrey, step(0.0, vGrey));
  if (uHasTex > 0.5) {
    float t = texture(uTex, vUv).r;
    g = t * (0.62 + 0.38 * (0.35 + 0.65 * det)) + 0.06 * min(se, 2.0);
  }
  g *= mix(0.35, 1.0, back);
  g = pow(clamp(g, 0.0, 1.0), 0.95);
  frag = vec4(vec3(g), 1.0);
}`;

const FOV = 30 * Math.PI / 180;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('SEM shader: ' + gl.getShaderInfoLog(s));
  return s;
}

// column-major 4x4 helpers
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
// rotation: pitch about x, then yaw about y (object turns, camera stays on +z)
function rotation(yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  // R = Rx(pitch) * Ry(yaw), rows
  return [
    [cy, 0, sy],
    [sp * sy, cp, -sp * cy],
    [-cp * sy, sp, cp * cy],
  ];
}

export function createSemViewer(canvas, { onChange = null } = {}) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: false });
  if (!gl) throw new Error('WebGL2 is not available');
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('SEM program: ' + gl.getProgramInfoLog(prog));
  const U = {};
  for (const n of ['uMvp', 'uRot', 'uTex', 'uHasTex', 'uLight']) U[n] = gl.getUniformLocation(prog, n);

  const S = {
    model: null, method: 'mesh', vao: null, bufs: [], tex: null, count: 0, type: 0,
    yaw: 0, pitch: 0, dist: 1, home: null, radius: 1, centre: [0, 0, 0],
    auto: true, idleAt: 0, t0: 0, raf: 0, dirty: true, disposed: false,
    w: 1, h: 1, dpr: 1, pointers: new Map(), pinch: null, lastTap: 0,
  };
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function freeModel() {
    for (const b of S.bufs) gl.deleteBuffer(b);
    S.bufs = [];
    if (S.vao) gl.deleteVertexArray(S.vao);
    if (S.tex) gl.deleteTexture(S.tex);
    S.vao = null; S.tex = null; S.count = 0;
  }

  function attrib(loc, data, size) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    S.bufs.push(b);
  }

  async function setModel(model, { method = 'mesh' } = {}) {
    freeModel();
    S.model = model; S.method = method;
    const p = model.positions;
    const lo = model.bounds.lo, hi = model.bounds.hi;
    S.centre = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    // centred positions (the shader has no model matrix)
    const q = new Float32Array(p.length);
    for (let i = 0; i < p.length; i += 3) { q[i] = p[i] - S.centre[0]; q[i + 1] = p[i + 1] - S.centre[1]; q[i + 2] = p[i + 2] - S.centre[2]; }
    S.radius = Math.max(1e-6, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2);
    S.vao = gl.createVertexArray();
    gl.bindVertexArray(S.vao);
    attrib(0, q, 3);
    attrib(1, model.normals || new Float32Array(p.length), 3);
    if (model.colors) attrib(2, model.colors, 1);
    else { gl.disableVertexAttribArray(2); gl.vertexAttrib1f(2, -1); }
    if (model.uvs) attrib(3, model.uvs, 2);
    else { gl.disableVertexAttribArray(3); gl.vertexAttrib2f(3, 0, 0); }
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, model.indices, gl.STATIC_DRAW);
    S.bufs.push(ib);
    S.count = model.indices.length;
    S.type = model.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    gl.bindVertexArray(null);
    if (model.image && typeof createImageBitmap === 'function') {
      try {
        const bmp = await createImageBitmap(new Blob([model.image.bytes], { type: model.image.mimeType }));
        if (S.model !== model || S.disposed) return;
        S.tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, S.tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, bmp);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (bmp.close) bmp.close();
      } catch (e) { /* no texture: the shape still shows */ }
    }
    reset();
  }

  function fitDist() {
    // the bounding sphere fills about 80 % of the shorter side
    const aspect = S.w / S.h;
    const half = Math.min(FOV / 2, Math.atan(Math.tan(FOV / 2) * aspect));
    return S.radius / Math.sin(half) * 1.08;
  }

  function reset() {
    S.yaw = S.method === 'stereo' ? 0 : 0.5;
    S.pitch = S.method === 'stereo' ? 0 : -0.45;
    S.dist = fitDist();
    S.home = { yaw: S.yaw, pitch: S.pitch, dist: S.dist };
    S.t0 = now(); S.idleAt = now();
    changed();
  }

  function clampView() {
    const lim = 55 * Math.PI / 180;
    if (S.method === 'stereo') {
      S.yaw = Math.max(-lim, Math.min(lim, S.yaw));
      S.pitch = Math.max(-lim, Math.min(lim, S.pitch));
    } else {
      S.pitch = Math.max(-1.45, Math.min(1.45, S.pitch));
    }
    const d0 = fitDist();
    S.dist = Math.max(d0 * 0.04, Math.min(d0 * 4, S.dist));
  }

  function changed() { S.dirty = true; loop(); if (onChange) onChange(state()); }

  function umPerPx() {
    // um per CSS px at the depth of the centre
    return 2 * S.dist * Math.tan(FOV / 2) / Math.max(1, S.h);
  }

  function state() {
    return { yaw: S.yaw, pitch: S.pitch, dist: S.dist, umPerPx: umPerPx(), method: S.method, auto: S.auto, width: S.w, height: S.h };
  }

  function draw() {
    const W = Math.max(1, Math.round(S.w * S.dpr)), H = Math.max(1, Math.round(S.h * S.dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    gl.viewport(0, 0, W, H);
    gl.clearColor(0.043, 0.047, 0.055, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!S.vao) return;
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(prog);
    const R = rotation(S.yaw, S.pitch);
    const model = [R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, 0, 0, -S.dist, 1];
    const near = Math.max(S.dist - S.radius * 1.5, S.dist * 0.01), far = S.dist + S.radius * 1.5;
    const mvp = mul(perspective(FOV, S.w / S.h, near, far), model);
    gl.uniformMatrix4fv(U.uMvp, false, new Float32Array(mvp));
    gl.uniformMatrix3fv(U.uRot, false, new Float32Array([R[0][0], R[1][0], R[2][0], R[0][1], R[1][1], R[2][1], R[0][2], R[1][2], R[2][2]]));
    const l = [-0.55, 0.62, 0.56], ll = Math.hypot(...l);
    gl.uniform3f(U.uLight, l[0] / ll, l[1] / ll, l[2] / ll);
    gl.uniform1f(U.uHasTex, S.tex ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, S.tex);
    gl.uniform1i(U.uTex, 0);
    gl.bindVertexArray(S.vao);
    gl.drawElements(gl.TRIANGLES, S.count, S.type, 0);
    gl.bindVertexArray(null);
  }

  function frame() {
    S.raf = 0;
    if (S.disposed) return;
    const t = now();
    const idle = S.auto && !S.pointers.size && t - S.idleAt > 2500 && S.vao;
    if (idle) {
      if (S.method === 'stereo') {
        const k = (t - S.t0) / 1000;
        S.yaw = S.home.yaw + 0.31 * Math.sin(k * 0.35) * Math.min(1, (t - S.idleAt - 2500) / 3000);
      } else {
        S.yaw += 0.0035;
      }
      S.dirty = true;
      if (onChange) onChange(state());
    }
    if (S.dirty) { S.dirty = false; draw(); }
    if (idle || S.dirty) loop();
  }
  function loop() { if (!S.raf && !S.disposed && typeof requestAnimationFrame === 'function') S.raf = requestAnimationFrame(frame); }
  // keep the turntable going while idle
  const tick = setInterval(() => { if (S.auto && S.vao && !S.disposed) loop(); }, 500);

  // ── input ──
  function touchIdle() { S.idleAt = now(); if (S.method === 'stereo') S.t0 = now() - 0; }
  function onPointer(e) {
    if (e.type === 'pointerdown') {
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      S.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (S.pointers.size === 2) {
        const [a, b] = [...S.pointers.values()];
        S.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: S.dist };
      }
      const t = now();
      if (e.pointerType !== 'mouse' && t - S.lastTap < 300) reset();
      S.lastTap = t;
      touchIdle();
    } else if (e.type === 'pointermove') {
      const p = S.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (S.pointers.size >= 2 && S.pinch) {
        const [a, b] = [...S.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        S.dist = S.pinch.dist * S.pinch.d / Math.max(d, 1);
      } else {
        S.yaw += dx * 0.008;
        S.pitch += dy * 0.008;
      }
      clampView(); touchIdle(); changed();
    } else {
      S.pointers.delete(e.pointerId);
      if (S.pointers.size < 2) S.pinch = null;
      touchIdle();
    }
  }
  function onWheel(e) {
    e.preventDefault();
    S.dist *= Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    clampView(); touchIdle(); changed();
  }
  function onKey(e) {
    const k = e.key;
    const step = 0.08;
    if (k === 'ArrowLeft') S.yaw -= step; else if (k === 'ArrowRight') S.yaw += step;
    else if (k === 'ArrowUp') S.pitch -= step; else if (k === 'ArrowDown') S.pitch += step;
    else if (k === '+' || k === '=') S.dist /= 1.15; else if (k === '-' || k === '_') S.dist *= 1.15;
    else if (k === '0') { reset(); return; }
    else return;
    e.preventDefault();
    clampView(); touchIdle(); changed();
  }
  const dbl = () => reset();
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) canvas.addEventListener(t, onPointer);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKey);
  canvas.addEventListener('dblclick', dbl);

  function resize() {
    const r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 800, height: 600 };
    S.w = Math.max(1, r.width || canvas.clientWidth || 800);
    S.h = Math.max(1, r.height || canvas.clientHeight || 600);
    S.dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    clampView();
    changed();
  }

  function dispose() {
    if (S.disposed) return;
    S.disposed = true;
    clearInterval(tick);
    if (S.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(S.raf);
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) canvas.removeEventListener(t, onPointer);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('keydown', onKey);
    canvas.removeEventListener('dblclick', dbl);
    freeModel();
    gl.deleteProgram(prog);
    try { const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (e) { /* gone */ }
  }

  resize();
  return {
    setModel, reset, resize, state, umPerPx, dispose,
    setAuto(b) { S.auto = !!b; touchIdle(); loop(); },
    get drawn() { return S.count; },
  };
}

// niceScale(umPerPx, maxPx) -> { um, px, label }: a 1-2-5 length for a scale bar
export function niceScale(umPerPx, maxPx = 120) {
  const raw = umPerPx * maxPx;
  if (!(raw > 0) || !Number.isFinite(raw)) return null;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  let um = p;
  for (const m of [1, 2, 5]) if (m * p <= raw) um = m * p;
  const px = um / umPerPx;
  let label;
  if (um >= 1000) label = (um / 1000) + ' mm';
  else if (um >= 1) label = um + ' µm';
  else label = Math.round(um * 1000) + ' nm';
  return { um, px, label };
}
