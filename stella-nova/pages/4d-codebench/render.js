// ============================================================================
//  RENDER  ·  raw WebGL2 player for 4D worlds (browser ES module)
// ----------------------------------------------------------------------------
//  This module draws one World (see world.js) at a frame index t. The index
//  t can be fractional: the renderer interpolates linearly between frame
//  floor(t) and the next frame. The page uses one renderer per canvas.
//
//  Draw order for each frame:
//    1. Floor: a dark plane with a faint 0.25 m and 1 m grid. The plane
//       fades to the clear colour at its edge. Side length is opts.ground.size
//       (default 4 m).
//    2. Contact shadows: each object is projected onto y = 0 along the light
//       direction. A stencil test darkens each pixel one time only.
//    3. Meshes: smooth normals that the CPU calculates for each frame. The
//       CPU also keeps, for each vertex, the smallest cosine between its
//       smooth normal and the normals of its triangles ("sharpness"). Where
//       that value is less than 0.8, the shader uses the triangle normal
//       (from screen derivatives). Thus a cube with shared corners gets hard
//       edges and a cloth stays smooth. Both sides of a triangle are lit.
//    4. Points: point sprites with sphere shading and sphere depth. The
//       sprite size comes from the particle radius and the perspective.
//    5. Paths (opts.showPaths): line strips of some vertex trajectories.
//       The part up to t is bright, the remainder is faint.
//    6. Ghost (opts.ghost): a second world, translucent and tinted. A
//       depth prepass keeps only its front surfaces, so the overlay stays
//       clean.
//
//  Camera: world.camera, with opts.orbit {yaw, pitch} (radians) added
//  around camera.target. On a canvas taller than createRenderer's
//  opts.fitAspect (width / height, default 1.2), the renderer widens fovY
//  to keep the horizontal view. createRenderer also reads opts.ground.size
//  (or opts.groundSize), the floor side in metres.
//
//  Light: one soft directional light plus a sky and ground ambient term.
//
//  GPU memory: a cache keeps the buffers of each world that the renderer
//  saw recently (a Map with world keys, at most 6 worlds). Static objects
//  upload one time. Dynamic objects upload only positions and normals,
//  and only when t changes. The draw path does not allocate.
//
//  Context loss: the renderer stops drawing, and does not throw. When the
//  browser restores the context, the renderer makes all GPU objects again.
//
//  Safari: WebGL2 core only. No extensions are necessary. 32-bit indices
//  are core in WebGL2.
//
//  EXPORTS   (grep -n "<anchor>" render.js)
//    factory ........... "export function createRenderer"
//  INTERNALS
//    shaders ........... "const SRC_"
//    matrix helpers .... "function lookAt"
//    world cache ....... "function entryFor"
//    normals ........... "function computeNormals"
//    per-frame upload .. "function uploadFrame"
//    paths ............. "function buildPaths"
//    world pass ........ "function drawWorld"
//    frame ............. "function draw("
//    context loss ...... "webglcontextlost"
// ============================================================================

const CLEAR = [0.024, 0.027, 0.043];          // #06070b
const LIGHT = norm3([0.38, 1.0, 0.28]);        // towards the light
const GHOST_TINT = [0.55, 0.85, 1.0];
const CACHE_MAX = 6;
const PATHS_MAX = 24;
const NO_OPTS = Object.freeze({});

// ---------------------------------------------------------------- shaders --

const SRC_MESH_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aNrm;     // xyz normal, w sharpness
uniform mat4 uVP;
out vec3 vW;
out vec3 vN;
out float vSharp;
void main() {
  vW = aPos; vN = aNrm.xyz; vSharp = aNrm.w;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

const SRC_MESH_FS = `#version 300 es
precision highp float;
in vec3 vW;
in vec3 vN;
in float vSharp;
uniform vec3 uEye;
uniform vec3 uLight;
uniform vec3 uColor;
uniform vec4 uTint;      // rgb, amount
uniform float uAlpha;
out vec4 frag;
void main() {
  vec3 V = normalize(uEye - vW);
  vec3 fn = normalize(cross(dFdx(vW), dFdy(vW)));
  if (dot(fn, V) < 0.0) fn = -fn;
  vec3 n = fn;
  float l = length(vN);
  if (l > 1e-6 && vSharp > 0.8) {
    n = vN / l;
    if (dot(n, fn) < 0.0) n = -n;
  }
  vec3 base = mix(uColor, uTint.rgb, uTint.a);
  float wrap = max((dot(n, uLight) + 0.3) / 1.3, 0.0);
  vec3 hemi = mix(vec3(0.10, 0.10, 0.12), vec3(0.30, 0.33, 0.40), n.y * 0.5 + 0.5);
  vec3 c = base * (hemi + wrap * vec3(0.82, 0.80, 0.77));
  c += pow(max(dot(n, normalize(uLight + V)), 0.0), 48.0) * 0.22;
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  c += rim * 0.10 * (1.0 + uTint.a * 3.0);
  frag = vec4(c, uAlpha);
}`;

const SRC_POINT_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uV;
uniform mat4 uP;
uniform float uRad;
uniform float uPx;       // proj[1][1] * viewport height
uniform float uMaxPx;
out vec3 vC;             // view-space centre
out float vSize;
void main() {
  vec4 v = uV * vec4(aPos, 1.0);
  vC = v.xyz;
  gl_Position = uP * v;
  float s = uRad * uPx / max(gl_Position.w, 1e-4);
  vSize = clamp(s, 1.0, uMaxPx);
  gl_PointSize = vSize;
}`;

const SRC_POINT_FS = `#version 300 es
precision highp float;
in vec3 vC;
in float vSize;
uniform mat4 uP;
uniform float uRad;
uniform vec3 uLightV;
uniform vec3 uUpV;
uniform vec3 uColor;
uniform vec4 uTint;
uniform float uAlpha;
out vec4 frag;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  c.y = -c.y;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  vec3 n = vec3(c, sqrt(1.0 - r2));
  vec3 p = vC + n * uRad;
  vec4 clip = uP * vec4(p, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  vec3 base = mix(uColor, uTint.rgb, uTint.a);
  float wrap = max((dot(n, uLightV) + 0.3) / 1.3, 0.0);
  vec3 hemi = mix(vec3(0.10, 0.10, 0.12), vec3(0.30, 0.33, 0.40), dot(n, uUpV) * 0.5 + 0.5);
  vec3 col = base * (hemi + wrap * vec3(0.82, 0.80, 0.77));
  col += pow(max(dot(n, normalize(uLightV + vec3(0.0, 0.0, 1.0))), 0.0), 40.0) * 0.25;
  float edge = clamp((1.0 - sqrt(r2)) * vSize * 0.5, 0.0, 1.0);
  frag = vec4(col, uAlpha * edge);
}`;

const SRC_SHADOW_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uVP;
uniform vec3 uLight;
uniform float uRad;      // > 0: points
uniform float uPx;
uniform float uMaxPx;
out vec2 vXZ;
void main() {
  float h = max(aPos.y, 0.0);
  vec3 q = aPos - uLight * (h / uLight.y);
  q.y = 0.0;
  vXZ = q.xz;
  gl_Position = uVP * vec4(q, 1.0);
  gl_PointSize = clamp(uRad * 1.1 * uPx / max(gl_Position.w, 1e-4), 1.0, uMaxPx);
}`;

const SRC_SHADOW_FS = `#version 300 es
precision highp float;
in vec2 vXZ;
uniform float uRad;
uniform float uHalf;
uniform float uStrength;
out vec4 frag;
void main() {
  if (uRad > 0.0) {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    if (dot(c, c) > 1.0) discard;
  }
  float r = length(vXZ) / uHalf;
  float fade = 1.0 - smoothstep(0.55, 1.0, r);
  frag = vec4(0.0, 0.0, 0.0, uStrength * fade);
}`;

const SRC_FLOOR_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uVP;
out vec2 vXZ;
void main() {
  vXZ = aPos.xz;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

const SRC_FLOOR_FS = `#version 300 es
precision highp float;
in vec2 vXZ;
uniform float uHalf;
uniform vec3 uClear;
out vec4 frag;
float gridLine(vec2 p, float step) {
  vec2 q = p / step;
  vec2 g = abs(fract(q - 0.5) - 0.5) / max(fwidth(q), vec2(1e-5));
  return 1.0 - min(min(g.x, g.y), 1.0);
}
void main() {
  float minor = gridLine(vXZ, 0.25);
  float major = gridLine(vXZ, 1.0);
  vec3 c = vec3(0.050, 0.057, 0.078);
  c += vec3(0.030, 0.036, 0.050) * minor;
  c += vec3(0.060, 0.070, 0.095) * major;
  float r = length(vXZ) / uHalf;
  float fade = 1.0 - smoothstep(0.55, 1.0, r);
  frag = vec4(mix(uClear, c, fade), 1.0);
}`;

const SRC_LINE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uVP;
void main() { gl_Position = uVP * vec4(aPos, 1.0); }`;

const SRC_LINE_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 frag;
void main() { frag = uColor; }`;

// ----------------------------------------------------------- small maths --

function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect; out[5] = f;
  out[10] = (far + near) * nf; out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

function lookAt(out, e, t) {
  let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2];
  let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  // x = up(0,1,0) x z
  let xx = zz, xy = 0, xz = -zx;
  l = Math.hypot(xx, xz);
  if (l < 1e-6) { xx = 1; xz = 0; l = 1; }
  xx /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * e[0] + xy * e[1] + xz * e[2]);
  out[13] = -(yx * e[0] + yy * e[1] + yz * e[2]);
  out[14] = -(zx * e[0] + zy * e[1] + zz * e[2]);
  out[15] = 1;
  return out;
}

function mul4(out, a, b) {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return out;
}

// Area-weighted vertex normals of a mesh at one frame (p: count*3 floats).
// out has 4 floats per vertex: the normal, then the sharpness (the smallest
// cosine between the vertex normal and the normals of its triangles).
function computeNormals(p, faces, out) {
  out.fill(0);
  for (let k = 0; k < faces.length; k += 3) {
    const a = faces[k] * 3, b = faces[k + 1] * 3, c = faces[k + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const A = faces[k] * 4, B = faces[k + 1] * 4, C = faces[k + 2] * 4;
    out[A] += nx; out[A + 1] += ny; out[A + 2] += nz;
    out[B] += nx; out[B + 1] += ny; out[B + 2] += nz;
    out[C] += nx; out[C + 1] += ny; out[C + 2] += nz;
  }
  for (let i = 0; i < out.length; i += 4) {
    const l = Math.hypot(out[i], out[i + 1], out[i + 2]);
    if (l > 0) { out[i] /= l; out[i + 1] /= l; out[i + 2] /= l; }
    out[i + 3] = 1;
  }
  for (let k = 0; k < faces.length; k += 3) {
    const a = faces[k] * 3, b = faces[k + 1] * 3, c = faces[k + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l === 0) continue;
    nx /= l; ny /= l; nz /= l;
    for (let j = 0; j < 3; j++) {
      const V = faces[k + j] * 4;
      const d = out[V] * nx + out[V + 1] * ny + out[V + 2] * nz;
      if (d < out[V + 3]) out[V + 3] = d;
    }
  }
}

// Write the interpolated positions of object o at frames f0, f1 (weight a).
function lerpFrame(o, f0, f1, a, out) {
  const n = o.count * 3, p = o.pos, b0 = f0 * n, b1 = f1 * n;
  if (a === 0 || f0 === f1) { for (let k = 0; k < n; k++) out[k] = p[b0 + k]; return; }
  const ia = 1 - a;
  for (let k = 0; k < n; k++) out[k] = p[b0 + k] * ia + p[b1 + k] * a;
}

// ------------------------------------------------------------ the factory --

export function createRenderer(canvas, opts = {}) {
  const groundSize = (opts.ground && opts.ground.size) || opts.groundSize || 4;
  const fitAspect = opts.fitAspect || 1.2;
  const gl = canvas.getContext('webgl2', {
    antialias: true, alpha: false, depth: true, stencil: true,
    premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance',
  });
  if (!gl) {
    const noop = () => {};
    return { ok: false, error: 'WebGL2 is not available', draw: noop, resize: noop, dispose: noop };
  }

  let lost = false;
  let P = null;                 // programs
  let floorVAO = null, floorBuf = null;
  let maxPx = 64;
  const cache = new Map();      // world -> entry

  // Per-frame scratch (no allocation in draw).
  const mV = new Float32Array(16), mP = new Float32Array(16), mVP = new Float32Array(16);
  const eye = [0, 0, 0], tgt = [0, 0, 0];
  const lightV = new Float32Array(3), upV = new Float32Array(3);
  const NO_TINT = new Float32Array([0, 0, 0, 0]);
  const GHOST = new Float32Array([GHOST_TINT[0], GHOST_TINT[1], GHOST_TINT[2], 0.35]);
  const lineCol = new Float32Array(4);
  let viewH = 1;

  function compile(vs, fs) {
    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error('render.js shader: ' + gl.getShaderInfoLog(sh));
      }
      gl.attachShader(prog, sh); gl.deleteShader(sh);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error('render.js link: ' + gl.getProgramInfoLog(prog));
    }
    const u = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) || 0;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i);
      u[info.name] = gl.getUniformLocation(prog, info.name);
    }
    return { prog, u };
  }

  function init() {
    P = {
      mesh: compile(SRC_MESH_VS, SRC_MESH_FS),
      point: compile(SRC_POINT_VS, SRC_POINT_FS),
      shadow: compile(SRC_SHADOW_VS, SRC_SHADOW_FS),
      floor: compile(SRC_FLOOR_VS, SRC_FLOOR_FS),
      line: compile(SRC_LINE_VS, SRC_LINE_FS),
    };
    const r = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
    maxPx = r && r[1] ? Math.min(r[1], 256) : 64;
    const h = groundSize / 2;
    floorVAO = gl.createVertexArray();
    floorBuf = gl.createBuffer();
    gl.bindVertexArray(floorVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, floorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-h, 0, -h, h, 0, -h, -h, 0, h, h, 0, h]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  // --------------------------------------------------------- world cache --

  function releaseEntry(e) {
    if (lost) return;
    for (const g of e.objs) {
      gl.deleteVertexArray(g.vao); gl.deleteBuffer(g.posBuf);
      if (g.nrmBuf) gl.deleteBuffer(g.nrmBuf);
      if (g.idxBuf) gl.deleteBuffer(g.idxBuf);
    }
    if (e.paths) { gl.deleteVertexArray(e.paths.vao); gl.deleteBuffer(e.paths.buf); }
  }

  function entryFor(w) {
    let e = cache.get(w);
    if (e) { cache.delete(w); cache.set(w, e); return e; }   // mark as recent
    e = { t: -1, objs: [], paths: null };
    for (const o of w.objects) {
      const stored = o.pos.length / (o.count * 3);
      const dyn = stored > 1;
      const g = { o, dyn, vao: gl.createVertexArray(), posBuf: gl.createBuffer(), nrmBuf: null, idxBuf: null, nIdx: 0, scratch: null, nrm: null };
      const p0 = dyn ? new Float32Array(o.count * 3) : o.pos.subarray(0, o.count * 3);
      if (dyn) lerpFrame(o, 0, 0, 0, p0);
      gl.bindVertexArray(g.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, p0, dyn ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      if (o.kind === 'mesh') {
        const nrm = new Float32Array(o.count * 4);
        computeNormals(p0, o.faces, nrm);
        g.nrmBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, g.nrmBuf);
        gl.bufferData(gl.ARRAY_BUFFER, nrm, dyn ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
        g.idxBuf = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.idxBuf);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, o.faces, gl.STATIC_DRAW);
        g.nIdx = o.faces.length;
        if (dyn) g.nrm = nrm;
      }
      if (dyn) g.scratch = p0;
      e.objs.push(g);
    }
    gl.bindVertexArray(null);
    cache.set(w, e);
    while (cache.size > CACHE_MAX) {
      const [k, old] = cache.entries().next().value;
      releaseEntry(old); cache.delete(k);
    }
    return e;
  }

  // Upload positions (and normals) of dynamic objects for frame t.
  function uploadFrame(w, e, t) {
    if (e.t === t) return;
    e.t = t;
    const last = w.frames - 1;
    const tc = t < 0 ? 0 : t > last ? last : t;
    const f0 = Math.floor(tc), f1 = f0 < last ? f0 + 1 : f0, a = tc - f0;
    for (const g of e.objs) {
      if (!g.dyn) continue;
      lerpFrame(g.o, f0, f1, a, g.scratch);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, g.scratch);
      if (g.nrm) {
        computeNormals(g.scratch, g.o.faces, g.nrm);
        gl.bindBuffer(gl.ARRAY_BUFFER, g.nrmBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, g.nrm);
      }
    }
  }

  // Trajectories of a few vertices of each dynamic object, one buffer.
  function buildPaths(w, e) {
    const dyn = e.objs.filter(g => g.dyn);
    const per = dyn.length ? Math.max(1, Math.min(6, Math.floor(PATHS_MAX / dyn.length))) : 0;
    const list = [];
    for (const g of dyn) {
      const k = Math.min(per, g.o.count);
      for (let j = 0; j < k; j++) list.push({ g, i: Math.floor((j + 0.5) * g.o.count / k) });
    }
    const F = w.frames;
    const data = new Float32Array(Math.max(1, list.length * F * 3));
    const strips = list.map((s, n) => {
      const o = s.g.o, c = o.color;
      for (let f = 0; f < F; f++) {
        const src = (f * o.count + s.i) * 3, dst = (n * F + f) * 3;
        data[dst] = o.pos[src]; data[dst + 1] = o.pos[src + 1]; data[dst + 2] = o.pos[src + 2];
      }
      return { first: n * F, color: [c[0] * 0.6 + 0.4, c[1] * 0.6 + 0.4, c[2] * 0.6 + 0.4] };
    });
    const vao = gl.createVertexArray(), buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    e.paths = { vao, buf, strips, frames: F };
  }

  // ------------------------------------------------------------ passes --

  // mode: 0 main colour, 1 ghost depth prepass, 2 ghost colour.
  function drawWorld(e, mode, alpha) {
    const tint = mode === 0 ? NO_TINT : GHOST;
    // Meshes
    const m = P.mesh;
    gl.useProgram(m.prog);
    gl.uniformMatrix4fv(m.u.uVP, false, mVP);
    gl.uniform3f(m.u.uEye, eye[0], eye[1], eye[2]);
    gl.uniform3f(m.u.uLight, LIGHT[0], LIGHT[1], LIGHT[2]);
    gl.uniform4fv(m.u.uTint, tint);
    gl.uniform1f(m.u.uAlpha, alpha);
    for (const g of e.objs) {
      if (!g.idxBuf) continue;
      const c = g.o.color;
      gl.uniform3f(m.u.uColor, c[0], c[1], c[2]);
      gl.bindVertexArray(g.vao);
      gl.drawElements(gl.TRIANGLES, g.nIdx, gl.UNSIGNED_INT, 0);
    }
    // Points
    const p = P.point;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.u.uV, false, mV);
    gl.uniformMatrix4fv(p.u.uP, false, mP);
    gl.uniform1f(p.u.uPx, mP[5] * viewH);
    gl.uniform1f(p.u.uMaxPx, maxPx);
    gl.uniform3fv(p.u.uLightV, lightV);
    gl.uniform3fv(p.u.uUpV, upV);
    gl.uniform4fv(p.u.uTint, tint);
    gl.uniform1f(p.u.uAlpha, alpha);
    if (mode === 0) gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    for (const g of e.objs) {
      if (g.idxBuf) continue;
      const c = g.o.color;
      gl.uniform3f(p.u.uColor, c[0], c[1], c[2]);
      gl.uniform1f(p.u.uRad, g.o.radius);
      gl.bindVertexArray(g.vao);
      gl.drawArrays(gl.POINTS, 0, g.o.count);
    }
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
  }

  function drawShadows(e) {
    const s = P.shadow;
    gl.useProgram(s.prog);
    gl.uniformMatrix4fv(s.u.uVP, false, mVP);
    gl.uniform3f(s.u.uLight, LIGHT[0], LIGHT[1], LIGHT[2]);
    gl.uniform1f(s.u.uPx, mP[5] * viewH);
    gl.uniform1f(s.u.uMaxPx, maxPx);
    gl.uniform1f(s.u.uHalf, groundSize / 2);
    gl.uniform1f(s.u.uStrength, 0.42);
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.EQUAL, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    for (const g of e.objs) {
      gl.bindVertexArray(g.vao);
      if (g.idxBuf) { gl.uniform1f(s.u.uRad, 0); gl.drawElements(gl.TRIANGLES, g.nIdx, gl.UNSIGNED_INT, 0); }
      else { gl.uniform1f(s.u.uRad, g.o.radius); gl.drawArrays(gl.POINTS, 0, g.o.count); }
    }
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  function drawPaths(w, e, t) {
    if (!e.paths) buildPaths(w, e);
    const ps = e.paths;
    if (!ps.strips.length) return;
    const l = P.line;
    gl.useProgram(l.prog);
    gl.uniformMatrix4fv(l.u.uVP, false, mVP);
    gl.bindVertexArray(ps.vao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    const last = ps.frames - 1;
    const upto = Math.max(1, Math.min(last, Math.floor(t)) + 1);
    for (const s of ps.strips) {
      lineCol[0] = s.color[0]; lineCol[1] = s.color[1]; lineCol[2] = s.color[2];
      lineCol[3] = 0.22;
      gl.uniform4fv(l.u.uColor, lineCol);
      gl.drawArrays(gl.LINE_STRIP, s.first, ps.frames);
      if (upto > 1) {
        lineCol[3] = 0.9;
        gl.uniform4fv(l.u.uColor, lineCol);
        gl.drawArrays(gl.LINE_STRIP, s.first, upto);
      }
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  // ------------------------------------------------------------- frame --

  function setCamera(cam, orbit) {
    tgt[0] = cam.target[0]; tgt[1] = cam.target[1]; tgt[2] = cam.target[2];
    let dx = cam.eye[0] - tgt[0], dy = cam.eye[1] - tgt[1], dz = cam.eye[2] - tgt[2];
    const r = Math.hypot(dx, dy, dz) || 1;
    if (orbit && (orbit.yaw || orbit.pitch)) {
      const yaw = Math.atan2(dx, dz) + (orbit.yaw || 0);
      let pitch = Math.asin(Math.max(-1, Math.min(1, dy / r))) + (orbit.pitch || 0);
      pitch = Math.max(0.02, Math.min(1.5, pitch));
      dx = r * Math.cos(pitch) * Math.sin(yaw); dz = r * Math.cos(pitch) * Math.cos(yaw); dy = r * Math.sin(pitch);
    }
    eye[0] = tgt[0] + dx; eye[1] = tgt[1] + dy; eye[2] = tgt[2] + dz;
    const aspect = Math.max(1e-3, gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight));
    const near = Math.max(0.01, r * 0.02), far = r * 8 + groundSize * 2;
    // On a tall (phone) canvas, widen fovY so that the horizontal view
    // stays as wide as at fitAspect. Else the scene sides go out of view.
    let half = Math.tan((cam.fovY || 45) * Math.PI / 360);
    if (aspect < fitAspect) half *= fitAspect / aspect;
    perspective(mP, 2 * Math.atan(half), aspect, near, far);
    lookAt(mV, eye, tgt);
    mul4(mVP, mP, mV);
    // Light and up directions in view space (rotation part of mV).
    lightV[0] = mV[0] * LIGHT[0] + mV[4] * LIGHT[1] + mV[8] * LIGHT[2];
    lightV[1] = mV[1] * LIGHT[0] + mV[5] * LIGHT[1] + mV[9] * LIGHT[2];
    lightV[2] = mV[2] * LIGHT[0] + mV[6] * LIGHT[1] + mV[10] * LIGHT[2];
    upV[0] = mV[4]; upV[1] = mV[5]; upV[2] = mV[6];
  }

  function draw(world, t = 0, o = NO_OPTS) {
    if (lost || !P || !world || gl.isContextLost()) return;
    viewH = gl.drawingBufferHeight;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(CLEAR[0], CLEAR[1], CLEAR[2], 1);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    setCamera(world.camera, o.orbit);

    const e = entryFor(world);
    uploadFrame(world, e, t);
    const ghost = o.ghost && o.ghost !== world ? o.ghost : null;
    const eg = ghost ? entryFor(ghost) : null;
    if (eg) uploadFrame(ghost, eg, t);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    // Floor, pushed back so that objects resting on y = 0 win.
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 2);
    gl.useProgram(P.floor.prog);
    gl.uniformMatrix4fv(P.floor.u.uVP, false, mVP);
    gl.uniform1f(P.floor.u.uHalf, groundSize / 2);
    gl.uniform3f(P.floor.u.uClear, CLEAR[0], CLEAR[1], CLEAR[2]);
    gl.bindVertexArray(floorVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.POLYGON_OFFSET_FILL);

    drawShadows(e);
    drawWorld(e, 0, 1);
    if (o.showPaths) drawPaths(world, e, t);

    if (eg) {
      gl.depthFunc(gl.LESS);
      gl.colorMask(false, false, false, false);
      drawWorld(eg, 1, 1);
      gl.colorMask(true, true, true, true);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      drawWorld(eg, 2, 0.42);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    }
    gl.bindVertexArray(null);
  }

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  // ------------------------------------------------------- context loss --

  function onLost(ev) {
    ev.preventDefault();
    lost = true;
    cache.clear();              // GPU objects are gone with the context
    P = null; floorVAO = null; floorBuf = null;
  }
  function onRestored() {
    lost = false;
    try { init(); } catch (err) { lost = true; console.warn('render.js: restore failed', err); }
  }
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);

  function dispose() {
    canvas.removeEventListener('webglcontextlost', onLost, false);
    canvas.removeEventListener('webglcontextrestored', onRestored, false);
    if (!lost && !gl.isContextLost()) {
      for (const e of cache.values()) releaseEntry(e);
      if (P) for (const k in P) gl.deleteProgram(P[k].prog);
      if (floorVAO) { gl.deleteVertexArray(floorVAO); gl.deleteBuffer(floorBuf); }
    }
    cache.clear(); P = null; lost = true;
  }

  init();
  resize();
  return { ok: true, gl, draw, resize, dispose };
}
