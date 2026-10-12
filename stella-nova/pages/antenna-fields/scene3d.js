// ============================================================================
//  ANTENNA FIELDS  ·  scene3d.js — the 3D view: pattern, sphere and slice
// ----------------------------------------------------------------------------
//  WebGL2, on the same context as field-gl.js. World units are wavelengths,
//  z is up (the dipole axis), the camera orbits the antenna centre.
//
//  WHAT IT DRAWS
//    surface  one mesh over theta x phi that morphs between two shapes of
//             the same function U(theta, phi):
//               morph 0  a sphere coloured by U: the radiated flux density
//                        <S_r> r^2 on a sphere around the antenna
//               morph 1  the radiation pattern: the radius is the field
//                        strength sqrt(U/U_max), or the gain in dB
//             Lit (two lights, specular, rim), with a faint line every 3 dB.
//             Colour: the --m3 green ramp of the energy flow.
//    slice    the 2D field of the page (field-gl.js drawSlice) on a plane
//             through the antenna, added as light, so the dark ground is clear
//    lines    the wires (white, gold with the current now), the cut ring (the
//             plane on screen in the field view), the ray to the observer
//             (orange), the axes, and on the sphere the far-field triads:
//             E (orange) and B (blue) across the radius, in phase, and S
//             (green) out along it. The triads fade as the sphere becomes
//             the pattern.
//  Thick lines are quads made in the vertex shader. The frame renders into a
//  4x multisampled target, then blits to the canvas.
//
//  createScene(gl) -> { setPattern, setWires, setTriads, draw, project, destroy }
//  grep -n: "const MESH_FS"  "const LINE_VS"  "function build"  "function draw"
//           "function setTriads"  "function lookAt"
// ============================================================================

const MESH_VS = `#version 300 es
in vec3 aPos;
in vec3 aNrm;
in float aG;
uniform mat4 uVP;
out vec3 vP;
out vec3 vN;
out float vG;
void main(){
  vP = aPos; vN = aNrm; vG = aG;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

const MESH_FS = `#version 300 es
precision highp float;
in vec3 vP;
in vec3 vN;
in float vG;
uniform vec3 uEye;
uniform float uAlpha;
uniform float uFade;
uniform float uBands;
out vec4 frag;
// Energy flow, --m3 #86dc7c: deep teal, green, pale.
vec3 ramp(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.035, 0.07, 0.09), c1 = vec3(0.09, 0.32, 0.28), c2 = vec3(0.525, 0.863, 0.486), c3 = vec3(0.95, 1.0, 0.9);
  vec3 a = mix(c0, c1, smoothstep(0.0, 0.4, t));
  a = mix(a, c2, smoothstep(0.35, 0.82, t));
  return mix(a, c3, smoothstep(0.84, 1.0, t));
}
void main(){
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uEye - vP);
  float db = 4.3429448 * log(max(vG, 1e-7));
  float t = clamp(1.0 + db / 30.0, 0.0, 1.0);
  vec3 base = ramp(t);
  vec3 L1 = normalize(vec3(-0.45, -0.35, 0.82));
  vec3 L2 = normalize(vec3(0.7, 0.5, -0.1));
  float d1 = max(dot(N, L1), 0.0);
  float d2 = max(dot(N, L2), 0.0);
  vec3 H1 = normalize(L1 + V);
  float sp = pow(max(dot(N, H1), 0.0), 56.0);
  float fr = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 col = base * (0.22 + 0.68 * d1 + 0.16 * d2) + vec3(0.9, 0.95, 0.9) * (sp * 0.3) + vec3(0.45, 0.8, 0.7) * (fr * 0.3);
  // a faint line every 3 dB below the peak
  float k = -db / 3.0;
  float w = max(fwidth(k), 1e-4);
  float iso = 1.0 - smoothstep(0.0, 1.5 * w, abs(fract(k + 0.5) - 0.5));
  col = mix(col, col * 0.6, iso * 0.45 * uBands * step(db, -0.5));
  frag = vec4(col * (uFade * uAlpha), uAlpha);
}`;

const LINE_VS = `#version 300 es
in vec3 aA;
in vec3 aB;
in vec2 aSide;
in vec4 aCol;
in float aW;
uniform mat4 uVP;
uniform vec2 uView;
out vec4 vCol;
void main(){
  vec4 a = uVP * vec4(aA, 1.0);
  vec4 b = uVP * vec4(aB, 1.0);
  vec4 p = mix(a, b, aSide.x);
  vec2 sa = a.xy / max(a.w, 1e-4) * uView;
  vec2 sb = b.xy / max(b.w, 1e-4) * uView;
  vec2 d = sb - sa;
  float l = length(d);
  vec2 n = l > 1e-5 ? vec2(-d.y, d.x) / l : vec2(0.0, 1.0);
  p.xy += n * (aSide.y * aW / uView) * p.w;
  vCol = aCol;
  gl_Position = p;
}`;

const LINE_FS = `#version 300 es
precision highp float;
in vec4 vCol;
uniform float uFade;
out vec4 frag;
void main(){
  frag = vec4(vCol.rgb * (vCol.a * uFade), vCol.a);
}`;

const QUAD_VS = `#version 300 es
in vec3 aPos;
in vec2 aUV;
uniform mat4 uVP;
out vec2 vUV;
void main(){
  vUV = aUV;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

const QUAD_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform float uAlpha;
out vec4 frag;
void main(){
  vec3 c = texture(uTex, vUV).rgb;
  vec2 e = min(vUV, vec2(1.0) - vUV);
  float edge = smoothstep(0.0, 0.12, min(e.x, e.y));
  // added as light: the dark ground of the field adds almost nothing
  vec3 g = max(c - vec3(0.02, 0.025, 0.04), vec3(0.0));
  frag = vec4(g * (edge * uAlpha), 0.0);
}`;

function sh(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const l = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error('scene3d shader: ' + l); }
  return s;
}
function prog(gl, vs, fs, attrs) {
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl, gl.FRAGMENT_SHADER, fs));
  attrs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('scene3d link: ' + gl.getProgramInfoLog(p));
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

// ── small matrix helpers (column-major) ──
function persp(fovy, asp, n, f) {
  const t = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
  m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = 2 * f * n / (n - f);
  return m;
}
function lookAt(e, c, up) {
  const z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross(up, z)), y = cross(z, x), m = new Float32Array(16);
  m[0] = x[0]; m[4] = x[1]; m[8] = x[2]; m[12] = -dot(x, e);
  m[1] = y[0]; m[5] = y[1]; m[9] = y[2]; m[13] = -dot(y, e);
  m[2] = z[0]; m[6] = z[1]; m[10] = z[2]; m[14] = -dot(z, e);
  m[15] = 1;
  return m;
}
function mul(a, b) {
  const m = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; m[i * 4 + j] = s; }
  return m;
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// Colours (linear 0..1) of the lib/sci.css symbols.
export const COL = { E: [1, 0.604, 0.384], B: [0.384, 0.769, 1], S: [0.525, 0.863, 0.486], I: [1, 0.839, 0.4], ink: [0.91, 0.925, 0.95], dim: [0.55, 0.6, 0.66] };

export function createScene(gl) {
  const P = {
    mesh: prog(gl, MESH_VS, MESH_FS, ['aPos', 'aNrm', 'aG']),
    line: prog(gl, LINE_VS, LINE_FS, ['aA', 'aB', 'aSide', 'aCol', 'aW']),
    quad: prog(gl, QUAD_VS, QUAD_FS, ['aPos', 'aUV']),
  };
  // ── mesh ──
  const mesh = { vao: gl.createVertexArray(), pos: gl.createBuffer(), nrm: gl.createBuffer(), g: gl.createBuffer(), idx: gl.createBuffer(), nIdx: 0, nt: 0, np: 0, G: null, P: null, N: null, key: '' };
  let pat = null, centre = [0, 0, 0], lobeR = 1;
  // pattern: geom.patternGrid result. R: the largest lobe radius (wavelengths).
  function setPattern(grid, c, R) {
    pat = grid; centre = c.slice(); lobeR = R; mesh.key = '';
    const { nt, np } = grid, n = (nt + 1) * (np + 1);
    if (mesh.nt !== nt || mesh.np !== np) {
      mesh.nt = nt; mesh.np = np;
      const I = new Uint16Array(nt * np * 6);
      let k = 0;
      for (let i = 0; i < nt; i++) for (let j = 0; j < np; j++) {
        const a = i * (np + 1) + j, b = a + 1, cc = a + np + 1, d = cc + 1;
        I[k++] = a; I[k++] = cc; I[k++] = b; I[k++] = b; I[k++] = cc; I[k++] = d;
      }
      mesh.nIdx = k;
      gl.bindVertexArray(mesh.vao);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.idx);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, I, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pos); gl.bufferData(gl.ARRAY_BUFFER, n * 12, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nrm); gl.bufferData(gl.ARRAY_BUFFER, n * 12, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.g); gl.bufferData(gl.ARRAY_BUFFER, n * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      mesh.P = new Float32Array(n * 3); mesh.N = new Float32Array(n * 3); mesh.G = new Float32Array(n);
    }
    const inv = 1 / Math.max(grid.Umax, 1e-30);
    for (let i = 0; i < n; i++) mesh.G[i] = grid.U[i] * inv;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.g); gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.G);
  }
  // radius of the surface for the normalised intensity g
  const shapeR = (g, morph, db) => {
    const f = db ? Math.max(0, 1 + 10 * Math.log10(Math.max(g, 1e-9)) / 30) : Math.sqrt(Math.max(0, g));
    const R0 = 0.82 * lobeR;
    return R0 + (lobeR * f - R0) * morph;
  };
  function build(morph, db) {
    const key = morph.toFixed(4) + db;
    if (!pat || key === mesh.key) return;
    mesh.key = key;
    const { nt, np } = mesh, Pp = mesh.P, N = mesh.N, G = mesh.G, W = np + 1;
    for (let i = 0; i <= nt; i++) {
      const th = Math.PI * i / nt, st = Math.sin(th), ct = Math.cos(th);
      for (let j = 0; j <= np; j++) {
        const ph = 2 * Math.PI * j / np, k = i * W + j, r = shapeR(G[k], morph, db);
        Pp[3 * k] = centre[0] + r * st * Math.cos(ph); Pp[3 * k + 1] = centre[1] + r * st * Math.sin(ph); Pp[3 * k + 2] = centre[2] + r * ct;
      }
    }
    for (let i = 0; i <= nt; i++) for (let j = 0; j <= np; j++) {
      const k = i * W + j;
      const i0 = Math.max(0, i - 1), i1 = Math.min(nt, i + 1), j0 = (j - 1 + np) % np, j1 = (j + 1) % np;
      const a = i0 * W + j, b = i1 * W + j, c = i * W + j0, d = i * W + j1;
      const dt = [Pp[3 * b] - Pp[3 * a], Pp[3 * b + 1] - Pp[3 * a + 1], Pp[3 * b + 2] - Pp[3 * a + 2]];
      const dp = [Pp[3 * d] - Pp[3 * c], Pp[3 * d + 1] - Pp[3 * c + 1], Pp[3 * d + 2] - Pp[3 * c + 2]];
      let n = cross(dt, dp);
      const radial = [Pp[3 * k] - centre[0], Pp[3 * k + 1] - centre[1], Pp[3 * k + 2] - centre[2]];
      if (Math.hypot(n[0], n[1], n[2]) < 1e-9) n = radial;
      else if (dot(n, radial) < 0 && (i === 0 || i === nt)) n = [-n[0], -n[1], -n[2]];
      n = norm(n);
      N[3 * k] = n[0]; N[3 * k + 1] = n[1]; N[3 * k + 2] = n[2];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pos); gl.bufferSubData(gl.ARRAY_BUFFER, 0, Pp);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nrm); gl.bufferSubData(gl.ARRAY_BUFFER, 0, N);
  }

  // ── lines ──
  const line = { vao: gl.createVertexArray(), buf: gl.createBuffer(), cap: 0, n: 0 };
  const STR = 13;
  gl.bindVertexArray(line.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, line.buf);
  [[0, 3, 0], [1, 3, 3], [2, 2, 6], [3, 4, 8], [4, 1, 12]].forEach(([loc, sz, off]) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, sz, gl.FLOAT, false, STR * 4, off * 4); });
  gl.bindVertexArray(null);
  let lineData = new Float32Array(STR * 6 * 512), segs = 0;
  const side = [[0, -1], [0, 1], [1, -1], [1, -1], [0, 1], [1, 1]];
  function seg(a, b, col, alpha, w) {
    if ((segs + 1) * 6 * STR > lineData.length) { const d = new Float32Array(lineData.length * 2); d.set(lineData); lineData = d; }
    let o = segs * 6 * STR;
    for (const [t, s] of side) {
      lineData.set([a[0], a[1], a[2], b[0], b[1], b[2], t, s, col[0], col[1], col[2], alpha, w], o);
      o += STR;
    }
    segs++;
  }

  // ── wires and triads (the caller sets them) ──
  let wires = [], triads = null;
  function setWires(ws) { wires = ws; }
  // t: [{ p: point, n: unit radius, pol: unit E direction, amp: [re, im] (E/sqrt(Umax)) }]
  function setTriads(t) { triads = t; }

  // ── quad (slice) ──
  const quad = { vao: gl.createVertexArray(), buf: gl.createBuffer() };
  gl.bindVertexArray(quad.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad.buf);
  gl.bufferData(gl.ARRAY_BUFFER, 6 * 5 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
  gl.bindVertexArray(null);

  // ── multisampled target ──
  let ms = null;
  function target(W, H) {
    if (ms && ms.w === W && ms.h === H) return ms;
    freeMs();
    const samples = Math.max(0, Math.min(4, gl.getParameter(gl.MAX_SAMPLES) | 0));
    const fb = gl.createFramebuffer(), c = gl.createRenderbuffer(), d = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, c);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, W, H);
    gl.bindRenderbuffer(gl.RENDERBUFFER, d);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, c);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, d);
    // A single-sample buffer of the same format for the resolve: a
    // multisample blit must not change the format, and the canvas (alpha:
    // false) may not be RGBA8. The second blit, from single-sample, may.
    const rfb = gl.createFramebuffer(), rc = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rc);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, rfb);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rc);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    ms = { fb, c, d, rfb, rc, w: W, h: H };
    return ms;
  }
  function freeMs() {
    if (!ms) return;
    gl.deleteFramebuffer(ms.fb); gl.deleteRenderbuffer(ms.c); gl.deleteRenderbuffer(ms.d);
    gl.deleteFramebuffer(ms.rfb); gl.deleteRenderbuffer(ms.rc);
    ms = null;
  }

  let VP = null, viewport = [1, 1, 0, 0];
  // Screen position (CSS px, from the top left) of a world point; w <= 0: behind.
  function project(p, dpr = 1) {
    if (!VP) return null;
    const x = VP[0] * p[0] + VP[4] * p[1] + VP[8] * p[2] + VP[12], y = VP[1] * p[0] + VP[5] * p[1] + VP[9] * p[2] + VP[13], w = VP[3] * p[0] + VP[7] * p[1] + VP[11] * p[2] + VP[15];
    if (w <= 1e-6) return null;
    return [(viewport[2] + (x / w * 0.5 + 0.5) * viewport[0]) / dpr, (viewport[3] + (0.5 - y / w * 0.5) * viewport[1]) / dpr];
  }

  // o: { W, H (canvas px), vp: { x, y, w, h } (the clear rect, canvas px, top-left origin),
  //      yaw, pitch, dist, morph, db, phase, fade, bands,
  //      slice: { tex, half, plane ('side'|'top'), alpha } | null,
  //      cut: 'side'|'top'|null, dir: unit vector | null, farU: (sx, sy, sz) -> U/Umax }
  function draw(o) {
    const { W, H } = o, vp = o.vp || { x: 0, y: 0, w: W, h: H };
    const T = target(W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0.016, 0.02, 0.035, 1);
    gl.clearDepth(1);
    gl.disable(gl.SCISSOR_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // the camera frames the clear rect: a viewport over it
    const vy = H - vp.y - vp.h;
    gl.viewport(vp.x, vy, vp.w, vp.h);
    viewport = [vp.w, vp.h, vp.x, vp.y];
    const cp = Math.cos(o.pitch), eye = [centre[0] + o.dist * cp * Math.cos(o.yaw), centre[1] + o.dist * cp * Math.sin(o.yaw), centre[2] + o.dist * Math.sin(o.pitch)];
    VP = mul(persp(0.62, vp.w / Math.max(1, vp.h), 0.05, o.dist * 6), lookAt(eye, centre, [0, 0, 1]));
    build(o.morph, o.db);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    // surface
    if (pat) {
      const alpha = 0.62 + 0.38 * Math.min(1, o.morph * 1.6);
      gl.useProgram(P.mesh.p);
      gl.uniformMatrix4fv(P.mesh.u.uVP, false, VP);
      gl.uniform3fv(P.mesh.u.uEye, eye);
      gl.uniform1f(P.mesh.u.uAlpha, alpha);
      gl.uniform1f(P.mesh.u.uFade, o.fade ?? 1);
      gl.uniform1f(P.mesh.u.uBands, o.bands ?? 1);
      gl.bindVertexArray(mesh.vao);
      if (alpha > 0.985) {
        gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.depthMask(true);
        gl.drawElements(gl.TRIANGLES, mesh.nIdx, gl.UNSIGNED_SHORT, 0);
      } else {
        // back faces, then front faces, blended, without depth writes
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.FRONT); gl.drawElements(gl.TRIANGLES, mesh.nIdx, gl.UNSIGNED_SHORT, 0);
        gl.cullFace(gl.BACK); gl.drawElements(gl.TRIANGLES, mesh.nIdx, gl.UNSIGNED_SHORT, 0);
        gl.disable(gl.CULL_FACE); gl.depthMask(true); gl.disable(gl.BLEND);
      }
      gl.bindVertexArray(null);
    }
    // lines
    segs = 0;
    const c = Math.cos(o.phase), s = Math.sin(o.phase), d = o.dpr || 1;
    // axes
    const ax = 0.42 * lobeR;
    seg(centre, [centre[0] + ax, centre[1], centre[2]], COL.dim, 0.7, 1.2 * d);
    seg(centre, [centre[0], centre[1] + ax, centre[2]], COL.dim, 0.7, 1.2 * d);
    seg(centre, [centre[0], centre[1], centre[2] + ax * 1.6], COL.dim, 0.7, 1.2 * d);
    // wires: white metal, gold where the current is strong now
    let imax = 1e-12;
    for (const w of wires) for (const I of w.I) imax = Math.max(imax, Math.hypot(I[0], I[1]));
    for (const w of wires) for (let k = 1; k < w.pts.length; k++) {
      const I0 = w.I[k - 1], I1 = w.I[k], i = Math.abs((I0[0] + I1[0]) * c - (I0[1] + I1[1]) * s) / (2 * imax);
      const col = [0, 1, 2].map(q => COL.ink[q] + (COL.I[q] - COL.ink[q]) * Math.min(1, i * 1.2));
      seg(w.pts[k - 1], w.pts[k], col, 1, (2.2 + 2.4 * i) * d);
    }
    // the cut ring and the observer ray
    if (pat && o.farU && o.cut) {
      const n = 180;
      let prev = null;
      for (let k = 0; k <= n; k++) {
        const a = 2 * Math.PI * k / n, u = o.cut === 'side' ? [Math.cos(a), 0, Math.sin(a)] : [Math.cos(a), Math.sin(a), 0];
        const r = shapeR(o.farU(u[0], u[1], u[2]), o.morph, o.db) * 1.004;
        const p = [centre[0] + r * u[0], centre[1] + r * u[1], centre[2] + r * u[2]];
        if (prev) seg(prev, p, COL.ink, 0.85, 1.6 * d);
        prev = p;
      }
    }
    if (pat && o.dir && o.farU) {
      const r = shapeR(o.farU(o.dir[0], o.dir[1], o.dir[2]), o.morph, o.db);
      const tip = [centre[0] + r * o.dir[0], centre[1] + r * o.dir[1], centre[2] + r * o.dir[2]];
      const far = [centre[0] + (r + 0.25 * lobeR) * o.dir[0], centre[1] + (r + 0.25 * lobeR) * o.dir[1], centre[2] + (r + 0.25 * lobeR) * o.dir[2]];
      seg(centre, tip, COL.E, 0.95, 1.8 * d);
      seg(tip, far, COL.E, 0.45, 1.2 * d);
    }
    // far-field triads on the sphere: E and B across, in phase; S out
    if (triads && o.morph < 0.98) {
      const fadeT = Math.max(0, 1 - o.morph * 1.4), L = 0.17 * lobeR;
      for (const t of triads) {
        const e = t.amp[0] * c - t.amp[1] * s;          // E(t)/sqrt(Umax)
        const R0 = shapeR(t.g, o.morph, o.db);
        const p = [centre[0] + R0 * t.n[0], centre[1] + R0 * t.n[1], centre[2] + R0 * t.n[2]];
        const b = cross(t.n, t.pol);
        const ep = [p[0] + t.pol[0] * e * L, p[1] + t.pol[1] * e * L, p[2] + t.pol[2] * e * L];
        const bp = [p[0] + b[0] * e * L, p[1] + b[1] * e * L, p[2] + b[2] * e * L];
        const sp = [p[0] + t.n[0] * e * e * L * 1.3, p[1] + t.n[1] * e * e * L * 1.3, p[2] + t.n[2] * e * e * L * 1.3];
        seg(p, ep, COL.E, 0.95 * fadeT, 1.7 * d);
        seg(p, bp, COL.B, 0.95 * fadeT, 1.7 * d);
        seg(p, sp, COL.S, 0.95 * fadeT, 1.9 * d);
      }
    }
    if (segs) {
      gl.useProgram(P.line.p);
      gl.uniformMatrix4fv(P.line.u.uVP, false, VP);
      gl.uniform2f(P.line.u.uView, vp.w, vp.h);
      gl.uniform1f(P.line.u.uFade, o.fade ?? 1);
      gl.bindVertexArray(line.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, line.buf);
      const need = segs * 6 * STR;
      if (line.cap < need) { line.cap = lineData.length; gl.bufferData(gl.ARRAY_BUFFER, line.cap * 4, gl.DYNAMIC_DRAW); }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, lineData, 0, need);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, segs * 6);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    }
    // the field slice, added as light, behind the surface where the surface is nearer
    if (o.slice && o.slice.tex) {
      const h = o.slice.half, cx = centre[0], cy = centre[1], cz = centre[2];
      const q = o.slice.plane === 'side'
        ? [[cx - h, cy, cz - h, 0, 0], [cx + h, cy, cz - h, 1, 0], [cx + h, cy, cz + h, 1, 1], [cx - h, cy, cz - h, 0, 0], [cx + h, cy, cz + h, 1, 1], [cx - h, cy, cz + h, 0, 1]]
        : [[cx - h, cy - h, cz, 0, 0], [cx + h, cy - h, cz, 1, 0], [cx + h, cy + h, cz, 1, 1], [cx - h, cy - h, cz, 0, 0], [cx + h, cy + h, cz, 1, 1], [cx - h, cy + h, cz, 0, 1]];
      gl.useProgram(P.quad.p);
      gl.uniformMatrix4fv(P.quad.u.uVP, false, VP);
      gl.uniform1f(P.quad.u.uAlpha, (o.slice.alpha ?? 0.9) * (o.fade ?? 1));
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, o.slice.tex);
      gl.uniform1i(P.quad.u.uTex, 0);
      gl.bindVertexArray(quad.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(q.flat()));
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.depthMask(true); gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    }
    gl.disable(gl.DEPTH_TEST);
    // resolve, then copy to the canvas
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, T.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.rfb);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, T.rfb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function destroy() {
    try { freeMs(); } catch (e) { ms = null; }
  }
  return { setPattern, setWires, setTriads, draw, project, destroy, get lobeR() { return lobeR; }, get centre() { return centre; } };
}
