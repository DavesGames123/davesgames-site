// ============================================================================
//  DLAF PAGE  ·  render.js — WebGL2 view of a DLA cluster
// ----------------------------------------------------------------------------
//  One vertex per particle: position (xyz), colour value (val) and id. One
//  index pair per particle: (parent, id), or (id, id) for a seed. So the
//  first k particles are drawArrays(POINTS, 0, k) and drawElements(LINES,
//  2k): the replay is only a smaller count.
//
//  Passes, in order:
//    0 lines   thin parent-to-child segments, 1 device px, alpha blend
//    1 dots    soft round point sprites, sized from ParticleSpacing on screen
//    2 glow    additive halos on the newest particles (the growth front)
//    3 overlay the walker demo: lines and points with their own colour
//  The colour is a 256 x 1 LUT texture of the gradient (lib/growth-gradients
//  lut()). A gradient change uploads 1 KB. A "Colour by" change uploads the
//  val buffer. Nothing regrows.
//
//  Both stages say "precision highp int": u_pass is in both, and GLSL ES
//  3.00 does not link a uniform with two precisions.
//
//  The t of a particle is floor + (1 - floor) * clamp(val / max)^gamma, the
//  same sum as colourT in sim.js.
//
//  grep -n targets
//    shaders ............... "const VS"
//    buffers ............... "function ensure"
//    new particles ......... "function sync"
//    colour values ......... "function setValues"
//    gradient .............. "function setLUT"
//    draw .................. "function draw"
//  The surface view (surface-render.js) shares the context, the LUT texture
//  (lut()) and the colour values (vals, valDirty: the id range that changed).
// ============================================================================

const VS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec3 a_pos;
layout(location=1) in float a_val;
layout(location=2) in float a_id;
uniform mat4 u_mvp;
uniform float u_max, u_floor, u_gamma, u_size, u_count, u_glowN, u_persp;
uniform int u_pass;
out float v_t;
out float v_glow;
void main() {
  vec4 c = u_mvp * vec4(a_pos, 1.0);
  gl_Position = c;
  float x = clamp(a_val / u_max, 0.0, 1.0);
  v_t = u_floor + (1.0 - u_floor) * pow(x, u_gamma);
  float g = clamp((a_id - (u_count - u_glowN)) / max(u_glowN, 1.0), 0.0, 1.0);
  v_glow = g * g;
  float s = u_size;
  if (u_persp > 0.0) s = u_size * u_persp / max(c.w, 0.01);
  if (u_pass == 2) s = s * (2.5 + 3.5 * v_glow) + 3.0;
  gl_PointSize = clamp(s, 1.0, 96.0);
}`;

const FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_lut;
uniform int u_pass;
uniform float u_alpha;
in float v_t;
in float v_glow;
out vec4 o;
void main() {
  vec3 col = texture(u_lut, vec2(v_t, 0.5)).rgb;
  if (u_pass == 0) { o = vec4(col, u_alpha); return; }
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  if (u_pass == 1) { o = vec4(col, u_alpha * smoothstep(1.0, 0.25, r2)); return; }
  float a = exp(-r2 * 5.0) * v_glow * u_alpha;
  o = vec4(col * a, a);
}`;

const OVS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec3 a_pos;
layout(location=1) in vec4 a_col;
layout(location=2) in float a_size;
uniform mat4 u_mvp;
uniform float u_dpr;
out vec4 v_col;
void main() {
  gl_Position = u_mvp * vec4(a_pos, 1.0);
  v_col = a_col;
  gl_PointSize = max(1.0, a_size * u_dpr);
}`;

const OFS = `#version 300 es
precision highp float;
precision highp int;
uniform int u_points;
in vec4 v_col;
out vec4 o;
void main() {
  if (u_points == 1) {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(q, q);
    if (r2 > 1.0) discard;
    o = vec4(v_col.rgb, v_col.a * smoothstep(1.0, 0.55, r2));
    return;
  }
  o = v_col;
}`;

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
  for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
  return { p, u };
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
  if (!gl) return null;
  const prog = compile(gl, VS, FS), oprog = compile(gl, OVS, OFS);
  let cap = 0, synced = 0, model = null;
  // ids whose colour value changed since the surface view last read them
  const valDirty = { lo: Infinity, hi: 0 };
  const markVals = (a, b) => { if (a < valDirty.lo) valDirty.lo = a; if (b > valDirty.hi) valDirty.hi = b; };
  let pos32 = new Float32Array(0), val32 = new Float32Array(0), id32 = new Float32Array(0), idx = new Uint32Array(0);
  const bPos = gl.createBuffer(), bVal = gl.createBuffer(), bId = gl.createBuffer(), bIdx = gl.createBuffer();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, bPos); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, bVal); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, bId); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bIdx);
  gl.bindVertexArray(null);

  const oBuf = gl.createBuffer(), ovao = gl.createVertexArray();
  gl.bindVertexArray(ovao);
  gl.bindBuffer(gl.ARRAY_BUFFER, oBuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 32, 28);
  gl.bindVertexArray(null);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));

  // GPU and CPU buffers for n particles or more.
  function ensure(n) {
    if (n <= cap) return;
    let c = Math.max(1024, cap); while (c < n) c *= 2;
    const np = new Float32Array(c * 3); np.set(pos32); pos32 = np;
    const nv = new Float32Array(c); nv.set(val32); val32 = nv;
    const ni = new Float32Array(c); ni.set(id32); id32 = ni;
    const nx = new Uint32Array(c * 2); nx.set(idx); idx = nx;
    cap = c;
    gl.bindBuffer(gl.ARRAY_BUFFER, bPos); gl.bufferData(gl.ARRAY_BUFFER, pos32, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, bVal); gl.bufferData(gl.ARRAY_BUFFER, val32, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, bId); gl.bufferData(gl.ARRAY_BUFFER, id32, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bIdx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.DYNAMIC_DRAW);
  }

  // Use model m from now on (a regrow or the walk demo). Nothing is uploaded
  // until sync().
  function setModel(m) { model = m; synced = 0; markVals(0, 0); valDirty.lo = 0; }

  // Upload the particles that joined since the last sync. valFn(i) gives the
  // colour value of a new particle.
  function sync(valFn) {
    if (!model) return 0;
    const n = model.count;
    if (n <= synced) return 0;
    ensure(n);
    const P = model.pos, par = model.parent, a = synced;
    for (let i = a; i < n; i++) {
      pos32[i * 3] = P[i * 3]; pos32[i * 3 + 1] = P[i * 3 + 1]; pos32[i * 3 + 2] = P[i * 3 + 2];
      val32[i] = valFn(i); id32[i] = i;
      const p = par[i]; idx[2 * i] = p >= 0 ? p : i; idx[2 * i + 1] = i;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, bPos); gl.bufferSubData(gl.ARRAY_BUFFER, a * 12, pos32, a * 3, (n - a) * 3);
    gl.bindBuffer(gl.ARRAY_BUFFER, bVal); gl.bufferSubData(gl.ARRAY_BUFFER, a * 4, val32, a, n - a);
    gl.bindBuffer(gl.ARRAY_BUFFER, bId); gl.bufferSubData(gl.ARRAY_BUFFER, a * 4, id32, a, n - a);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bIdx); gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, a * 8, idx, a * 2, (n - a) * 2);
    synced = n;
    markVals(a, n);
    return n - a;
  }

  // Replace the colour values of the first n synced particles (a "Colour by"
  // change, or the flow sizes). vals is any array-like of length n or more.
  function setValues(vals, n = synced) {
    n = Math.min(n, synced);
    if (n <= 0) return;
    for (let i = 0; i < n; i++) val32[i] = vals[i];
    markVals(0, n);
    gl.bindBuffer(gl.ARRAY_BUFFER, bVal); gl.bufferSubData(gl.ARRAY_BUFFER, 0, val32, 0, n);
  }

  function setLUT(bytes) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, bytes.length / 4, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  }

  // Match the drawing buffer to the CSS size times dpr. Returns the dpr used.
  function resize(dprCap = 2) {
    const dpr = Math.min(dprCap, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return dpr;
  }

  // o = { mat, k, max, floor, gamma, dotPx (device px), glowN, persp, bg,
  //   lineAlpha, dotAlpha, glowAlpha, overlay: { lines, points }, dpr }
  function draw(o) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    const bg = o.bg || [0.02, 0.012, 0.03];
    gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND);
    const k = Math.min(o.k ?? synced, synced);
    if (k > 0) {
      gl.useProgram(prog.p);
      const u = prog.u;
      gl.uniformMatrix4fv(u.u_mvp, false, o.mat);
      gl.uniform1f(u.u_max, o.max || 1); gl.uniform1f(u.u_floor, o.floor ?? 0.1); gl.uniform1f(u.u_gamma, o.gamma ?? 1);
      gl.uniform1f(u.u_count, k); gl.uniform1f(u.u_glowN, o.glowN ?? 0); gl.uniform1f(u.u_persp, o.persp || 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u.u_lut, 0);
      gl.bindVertexArray(vao);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1i(u.u_pass, 0); gl.uniform1f(u.u_alpha, o.lineAlpha ?? 0.9); gl.uniform1f(u.u_size, 1);
      gl.drawElements(gl.LINES, 2 * k, gl.UNSIGNED_INT, 0);
      if ((o.dotPx || 0) >= 1.5) {
        gl.uniform1i(u.u_pass, 1); gl.uniform1f(u.u_alpha, o.dotAlpha ?? 0.95); gl.uniform1f(u.u_size, o.dotPx);
        gl.drawArrays(gl.POINTS, 0, k);
      }
      const gn = Math.min(k, Math.round(o.glowN || 0));
      if (gn > 0) {
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.uniform1i(u.u_pass, 2); gl.uniform1f(u.u_alpha, o.glowAlpha ?? 0.5); gl.uniform1f(u.u_size, Math.max(1.5, o.dotPx || 1.5));
        gl.drawArrays(gl.POINTS, k - gn, gn);
      }
      gl.bindVertexArray(null);
    }
    const ov = o.overlay;
    if (ov && (ov.lines.length || ov.points.length)) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(oprog.p);
      gl.uniformMatrix4fv(oprog.u.u_mvp, false, o.mat); gl.uniform1f(oprog.u.u_dpr, o.dpr || 1);
      gl.bindVertexArray(ovao);
      gl.bindBuffer(gl.ARRAY_BUFFER, oBuf);
      if (ov.lines.length) {
        gl.bufferData(gl.ARRAY_BUFFER, ov.lines, gl.STREAM_DRAW);
        gl.uniform1i(oprog.u.u_points, 0); gl.drawArrays(gl.LINES, 0, ov.lines.length / 8);
      }
      if (ov.points.length) {
        gl.bufferData(gl.ARRAY_BUFFER, ov.points, gl.STREAM_DRAW);
        gl.uniform1i(oprog.u.u_points, 1); gl.drawArrays(gl.POINTS, 0, ov.points.length / 8);
      }
      gl.bindVertexArray(null);
    }
  }

  return {
    gl, canvas, ensure, setModel, sync, setValues, setLUT, resize, draw, lut: () => tex, valDirty,
    get vals() { return val32; }, get synced() { return synced; }, get model() { return model; },
  };
}
