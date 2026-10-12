// ============================================================================
//  TWENTY TO FOUR  ·  render.js — the WebGL2 renderer of the stage
// ----------------------------------------------------------------------------
//  One canvas, five programs. Everything is drawn from data each frame, so
//  the saver records exactly what the page shows (no DOM on the stage).
//
//    sheet   a disc in a plane through the dipole axis. The fragment shader
//            evaluates the exact dipole field per pixel (the same formulas
//            as field.js): B through the sheet as a diverging map, the E
//            lines as antialiased level lines of Q, the λ rings and the
//            kr = 1 ring, and optional arrows of E or of the gauged A.
//    lines   instanced segments with a width in px (world or screen space)
//    heads   instanced arrowheads (a triangle in screen space)
//    mesh    a surface with a rim light (the radiation lobe, faces, discs)
//    sprite  a textured quad in px (labels and MathJax glyph equations),
//            or a procedural glow (the charges)
//  The field layers add (blend ONE, ONE) on a dark clear colour, so the
//  draw order of crossing sheets does not matter. Sprites go last, with
//  premultiplied alpha.
//
//  CAMERA. World z is up (the dipole axis). cam = { target, yaw, pitch,
//  dist, fov }. yaw 0, pitch 0 looks along +y at the x-z plane, x to the
//  right: the flat 2D view is that camera. band = { s, xc, yc } scales and
//  shifts clip space after the projection, so a scene can sit in the clear
//  part of the stage (the saver plate band, the phone sheet).
//
//  GREP MAP
//      grep -n "const SHEET_FS"       the field shader (maps, lines, arrows)
//      grep -n "const LINE_VS"        wide lines
//      grep -n "const HEAD_VS"        arrowheads
//      grep -n "const MESH_FS"        rim-lit surfaces
//      grep -n "const SPRITE_FS"      text, equations and glows
//      grep -n "export function createRenderer"   the public object
//      grep -n "function viewMatrix"  camera and band to one matrix
//      grep -n "MAPS ="               the map names and their colours
// ============================================================================

export const SHEET_VS = `#version 300 es
layout(location=0) in vec2 aQ;
uniform mat4 uM;
uniform vec3 uO, uU, uW;
uniform float uR;
out vec2 vP;
void main(){
  vP = aQ * uR;
  vec3 w = uO + uU * vP.x + uW * vP.y;
  gl_Position = uM * vec4(w, 1.0);
}`;

// Units in the shader: c = 1, k = 2π/λ. E and B are divided by k², A and φ
// by k, ∂E/∂t by k³, so one gain works for every λ. Display values are
// multiplied by kr (the far field falls as 1/r) and pass through tanh.
export const SHEET_FS = `#version 300 es
precision highp float;
in vec2 vP;
out vec4 o;
uniform float uK, uT, uLam, uR, uAlpha, uLineGap, uLineA, uMapA, uRingA, uHalf, uArrowCell, uMask;
uniform int uMap, uArrows;
uniform vec4 uGauge;
uniform vec3 uPos, uNeg, uEcol, uAcol;

void fieldAt(vec2 p, out vec2 E, out float Bo, out float Q, out vec4 X){
  float r = max(length(p), 1e-3);
  float s = p.x / r;
  float c = p.y / r;
  float k = uK;
  float u = k * (uT - r);
  float cu = cos(u);
  float su = sin(u);
  float P0 = cu;
  float P1 = -k * su;
  float P2 = -k * k * cu;
  float P3 = k * k * k * su;
  float ir = 1.0 / r;
  float ir2 = ir * ir;
  float ir3 = ir2 * ir;
  float a = 3.0 * P0 * ir3 + 3.0 * P1 * ir2 + P2 * ir;
  float b = P0 * ir3 + P1 * ir2 + P2 * ir;
  float n2 = 1.0 / (k * k);
  E = vec2(s * c * a, c * c * a - b) * n2;
  float m = P1 * ir2 + P2 * ir;
  Bo = -m * s * n2;
  Q = s * s * (cu / (k * r) - su);
  float a3 = 3.0 * P1 * ir3 + 3.0 * P2 * ir2 + P3 * ir;
  float b3 = P1 * ir3 + P2 * ir2 + P3 * ir;
  float n3 = n2 / k;
  X = vec4(P1 * ir / k, c * (P0 * ir2 + P1 * ir) / k, s * c * a3 * n3, (c * c * a3 - b3) * n3);
}

// The gauge blob: chi = g cos(k t) exp(-|p - c|^2 / w^2), in the units of A/k.
vec3 gaugeAt(vec2 p){
  vec2 d = p - uGauge.yz;
  float w2 = uGauge.w * uGauge.w;
  float G = exp(-dot(d, d) / w2);
  float ch = uGauge.x * cos(uK * uT) * G;
  return vec3(ch * (-2.0 / w2) * d, uGauge.x * sin(uK * uT) * G);
}

float sdSeg(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

void main(){
  if (uHalf > 0.5 && vP.x < 0.0) discard;
  float r = length(vP);
  float edge = 1.0 - smoothstep(uR * 0.78, uR, r);
  if (edge <= 0.0) discard;
  vec2 E; float Bo; float Q; vec4 X;
  fieldAt(vP, E, Bo, Q, X);
  float kr = uK * r;
  float core = smoothstep(uMask, uMask * 2.2, r);
  vec3 col = vec3(0.0);

  // The map: a signed quantity in a diverging pair of colours.
  float v = 0.0;
  if (uMap == 1) v = Bo * kr;
  else if (uMap == 2) v = E.x * kr;
  else if (uMap == 3) v = E.y * kr;
  else if (uMap == 4 || uMap == 5) {
    vec3 g = gaugeAt(vP);
    v = (uMap == 4 ? X.x + g.y : X.y + g.z) * kr * 0.6;
  }
  else if (uMap == 6) v = X.z * kr;
  else if (uMap == 7) v = X.w * kr;
  if (uMap > 0) {
    float t = tanh(v * 1.15);
    float m = pow(abs(t), 0.85);
    col += (t > 0.0 ? uPos : uNeg) * m * uMapA;
  }

  // The E lines: level lines of Q, one every uLineGap.
  float f = Q / uLineGap;
  float fw = max(fwidth(f), 1e-6);
  float d = abs(fract(f + 0.5) - 0.5) / fw;
  float line = 1.0 - smoothstep(0.55, 1.45, d);
  float halo = (1.0 - smoothstep(0.0, 4.0, d)) * 0.16;
  float dense = 1.0 - smoothstep(0.18, 0.5, fw);
  float em = tanh(length(E) * kr * 0.9);
  vec3 lc = mix(uEcol * 0.5, mix(uEcol, vec3(1.0, 0.96, 0.9), 0.4), em);
  col += lc * (line + halo) * dense * uLineA * (0.35 + 0.65 * em);

  // Rings at whole wavelengths, and the dashed ring kr = 1.
  float rr = r / uLam;
  float rw = max(fwidth(rr), 1e-6);
  float ring = 1.0 - smoothstep(0.4, 1.3, abs(fract(rr + 0.5) - 0.5) / rw);
  col += vec3(0.62, 0.68, 0.78) * ring * 0.07 * uRingA;
  float x1 = kr - 1.0;
  float k1 = 1.0 - smoothstep(0.4, 1.3, abs(x1) / max(fwidth(x1), 1e-6));
  float ang = atan(vP.y, vP.x);
  float dash = step(0.0, sin(ang * 40.0));
  col += vec3(0.85, 0.88, 0.95) * k1 * dash * 0.32 * uRingA;

  // Arrows on a grid: E (uArrows 1) or the gauged A (uArrows 2).
  if (uArrows > 0) {
    float cs = uArrowCell;
    vec2 pc = (floor(vP / cs) + 0.5) * cs;
    vec2 E2; float B2; float Q2; vec4 X2;
    fieldAt(pc, E2, B2, Q2, X2);
    float rc = length(pc);
    vec2 vec;
    if (uArrows == 1) vec = E2 * uK * rc;
    else vec = (vec2(0.0, X2.x) + gaugeAt(pc).xy) * uK * rc * 0.6;
    float mag = length(vec);
    float tn = tanh(mag * 0.9);
    float L = cs * 0.44 * tn;
    float px = max(fwidth(vP.x), 1e-6);
    if (L > 1.5 * px && rc > uMask * 2.5) {
      vec2 dir = vec / mag;
      vec2 q = vP - pc;
      vec2 l = vec2(dot(q, dir), dot(q, vec2(-dir.y, dir.x)));
      float hl = min(L * 0.5, cs * 0.2);
      float hw = hl * 0.55;
      float ds = sdSeg(l, vec2(-L, 0.0), vec2(L - hl, 0.0)) - 0.55 * px;
      float aS = clamp(0.5 - ds / px, 0.0, 1.0);
      float tri = max((L - hl) - l.x, abs(l.y) - hw * (L - l.x) / hl);
      float aT = clamp(0.5 - tri / px, 0.0, 1.0) * step(l.x, L + px);
      vec3 ac = uArrows == 1 ? uEcol : uAcol;
      col += ac * max(aS, aT) * (0.4 + 0.6 * tn);
    }
  }

  float a = edge * core * uAlpha;
  o = vec4(col * a, 0.0);
}`;

export const LINE_VS = `#version 300 es
layout(location=0) in vec2 aQ;
layout(location=1) in vec3 iA;
layout(location=2) in vec3 iB;
layout(location=3) in vec4 iC;
layout(location=4) in vec2 iW;
uniform mat4 uM;
uniform vec2 uView;
out vec4 vC;
out float vSide;
out float vHW;
out float vAlong;
out float vDash;
void main(){
  vec4 ca = uM * vec4(iA, 1.0);
  vec4 cb = uM * vec4(iB, 1.0);
  ca.w = max(ca.w, 1e-4);
  cb.w = max(cb.w, 1e-4);
  vec2 h = uView * 0.5;
  vec2 sa = ca.xy / ca.w * h;
  vec2 sb = cb.xy / cb.w * h;
  vec2 d = sb - sa;
  float len = length(d);
  vec2 dir = len > 1e-5 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float w = max(iW.x, 1.0);
  float hw = w * 0.5 + 1.0;
  vec4 c = mix(ca, cb, aQ.x);
  float e = aQ.x * 2.0 - 1.0;
  vec2 off = nrm * aQ.y * hw + dir * e * hw * 0.5;
  c.xy += off / h * c.w;
  gl_Position = c;
  vC = vec4(iC.rgb, iC.a * min(iW.x, 1.0));
  vSide = aQ.y * hw;
  vHW = w * 0.5;
  vAlong = aQ.x * len + e * hw * 0.5;
  vDash = iW.y;
}`;

export const LINE_FS = `#version 300 es
precision highp float;
in vec4 vC;
in float vSide;
in float vHW;
in float vAlong;
in float vDash;
out vec4 o;
void main(){
  float a = clamp(vHW + 0.5 - abs(vSide), 0.0, 1.0);
  if (vDash > 0.0) {
    float ph = fract(vAlong / vDash);
    a *= smoothstep(0.0, 0.06, ph) * (1.0 - smoothstep(0.5, 0.56, ph));
  }
  a *= vC.a;
  o = vec4(vC.rgb * a, a);
}`;

export const HEAD_VS = `#version 300 es
layout(location=1) in vec3 iT;
layout(location=2) in vec3 iF;
layout(location=3) in vec4 iC;
layout(location=4) in vec2 iS;
uniform mat4 uM;
uniform vec2 uView;
out vec4 vC;
void main(){
  vec4 ct = uM * vec4(iT, 1.0);
  vec4 cf = uM * vec4(iF, 1.0);
  ct.w = max(ct.w, 1e-4);
  cf.w = max(cf.w, 1e-4);
  vec2 h = uView * 0.5;
  vec2 st = ct.xy / ct.w * h;
  vec2 sf = cf.xy / cf.w * h;
  vec2 d = st - sf;
  float l = length(d);
  vec2 dir = l > 1e-5 ? d / l : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);
  float side = gl_VertexID == 1 ? 1.0 : -1.0;
  vec2 p = gl_VertexID == 0 ? st : st - dir * iS.x + n * iS.x * 0.42 * side;
  gl_Position = vec4(p / h, ct.z / ct.w, 1.0);
  vC = iC;
}`;

export const HEAD_FS = `#version 300 es
precision highp float;
in vec4 vC;
out vec4 o;
void main(){ o = vec4(vC.rgb * vC.a, vC.a); }`;

export const MESH_VS = `#version 300 es
layout(location=0) in vec3 aP;
layout(location=1) in vec3 aN;
uniform mat4 uM;
out vec3 vP;
out vec3 vN;
void main(){ vP = aP; vN = aN; gl_Position = uM * vec4(aP, 1.0); }`;

export const MESH_FS = `#version 300 es
precision highp float;
in vec3 vP;
in vec3 vN;
out vec4 o;
uniform vec3 uEye, uCol;
uniform float uAlpha, uRim, uBase;
void main(){
  vec3 v = normalize(uEye - vP);
  float f = 1.0 - abs(dot(normalize(vN), v));
  float a = uAlpha * (uBase + uRim * pow(f, 3.0));
  o = vec4(uCol * a, a);
}`;

export const SPRITE_VS = `#version 300 es
layout(location=0) in vec2 aQ;
uniform vec4 uRect;
uniform vec2 uView;
out vec2 vUV;
void main(){
  vec2 px = uRect.xy + aQ * uRect.zw;
  vUV = aQ;
  gl_Position = vec4(px.x / uView.x * 2.0 - 1.0, 1.0 - px.y / uView.y * 2.0, 0.0, 1.0);
}`;

export const SPRITE_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 o;
uniform sampler2D uTex;
uniform vec4 uTint;
uniform int uKind;
void main(){
  if (uKind == 1) {
    vec2 q = vUV * 2.0 - 1.0;
    float d = dot(q, q);
    float a = exp(-d * 5.0) * 0.55 + exp(-d * 40.0);
    o = vec4(uTint.rgb * a * uTint.a, 0.0);
  } else {
    o = texture(uTex, vUV) * uTint.a;
  }
}`;

// The map names and their colours: [positive, negative]. The colours are
// the lib/sci.css math colours of the same symbols (E --m2, B --m1, A and
// φ --m3, current --m5), with a darker partner for the negative side.
export const HEX = { E: '#ff9a62', B: '#62c4ff', A: '#86dc7c', Q: '#e889dc', J: '#ffd666', L: '#a8a4ff', ink: '#eef2f4' };
export const MAPS = {
  none: { id: 0 },
  B: { id: 1, pos: '#62c4ff', neg: '#8676ff' },
  Ex: { id: 2, pos: '#ff9a62', neg: '#d9577a' },
  Ez: { id: 3, pos: '#ff9a62', neg: '#d9577a' },
  Az: { id: 4, pos: '#86dc7c', neg: '#2fae9c' },
  phi: { id: 5, pos: '#86dc7c', neg: '#2fae9c' },
  Jx: { id: 6, pos: '#ffd666', neg: '#c77d2a' },
  Jz: { id: 7, pos: '#ffd666', neg: '#c77d2a' },
};
export function rgb(hex, a = 1) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
}
// The canvas output is sRGB and the shader adds in it, so a colour at full
// strength shows as the CSS colour.

// ── small matrix helpers (column-major, as WebGL wants) ─────────────────────
export function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
export function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far), o = new Float32Array(16);
  o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1; o[14] = 2 * far * near * nf;
  return o;
}
export function lookAt(eye, at, up) {
  const z = norm3(sub3(eye, at)), x = norm3(cross3(up, z)), y = cross3(z, x), o = new Float32Array(16);
  o[0] = x[0]; o[4] = x[1]; o[8] = x[2];
  o[1] = y[0]; o[5] = y[1]; o[9] = y[2];
  o[2] = z[0]; o[6] = z[1]; o[10] = z[2];
  o[12] = -dot3(x, eye); o[13] = -dot3(y, eye); o[14] = -dot3(z, eye); o[15] = 1;
  return o;
}
export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scl3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm3 = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// The camera eye for yaw, pitch and distance (see the header).
export function eyeOf(cam) {
  const cp = Math.cos(cam.pitch);
  return [cam.target[0] + cam.dist * Math.sin(cam.yaw) * cp, cam.target[1] - cam.dist * Math.cos(cam.yaw) * cp, cam.target[2] + cam.dist * Math.sin(cam.pitch)];
}
// Camera and band to one clip matrix.
export function viewMatrix(cam, w, h, band) {
  const P = perspective(cam.fov, w / h, Math.max(0.01, cam.dist * 0.02), cam.dist * 20 + 20);
  const V = lookAt(eyeOf(cam), cam.target, [0, 0, 1]);
  const B = new Float32Array(16);
  const s = band ? band.s : 1;
  B[0] = s; B[5] = s; B[10] = 1; B[15] = 1;
  B[12] = band ? band.xc : 0; B[13] = band ? band.yc : 0;
  return mul(B, mul(P, V));
}
// The matrix that maps CSS px (x right, y down) to clip space.
export function screenMatrix(w, h) {
  const o = new Float32Array(16);
  o[0] = 2 / w; o[5] = -2 / h; o[10] = 1; o[12] = -1; o[13] = 1; o[15] = 1;
  return o;
}
// World point to CSS px, or null behind the camera.
export function project(M, p, w, h) {
  const x = M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12];
  const y = M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13];
  const ww = M[3] * p[0] + M[7] * p[1] + M[11] * p[2] + M[15];
  if (ww <= 1e-4) return null;
  return [(x / ww * 0.5 + 0.5) * w, (0.5 - y / ww * 0.5) * h, ww];
}

// ── the renderer ────────────────────────────────────────────────────────────
export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) return null;

  function prog(vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }
  const P = {
    sheet: prog(SHEET_VS, SHEET_FS), line: prog(LINE_VS, LINE_FS), head: prog(HEAD_VS, HEAD_FS),
    mesh: prog(MESH_VS, MESH_FS), sprite: prog(SPRITE_VS, SPRITE_FS),
  };

  // A quad: (0,0)..(1,1) for sprites, and (-1,-1)..(1,1) for sheets.
  const quad01 = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad01);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const quadPM = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadPM);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  // Line base: x along 0..1, y side −1..1.
  const lineBase = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBase);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);

  const vaoSheet = gl.createVertexArray();
  gl.bindVertexArray(vaoSheet);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadPM); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const vaoSprite = gl.createVertexArray();
  gl.bindVertexArray(vaoSprite);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad01); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Instanced segment data: a(3) b(3) rgba(4) width,dash(2) = 12 floats.
  const instBuf = gl.createBuffer();
  const vaoLine = gl.createVertexArray();
  gl.bindVertexArray(vaoLine);
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBase); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  function instAttribs() {
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    const S = 48;
    [[1, 3, 0], [2, 3, 12], [3, 4, 24], [4, 2, 40]].forEach(([loc, n, off]) => {
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, S, off); gl.vertexAttribDivisor(loc, 1);
    });
  }
  instAttribs();
  const vaoHead = gl.createVertexArray();
  gl.bindVertexArray(vaoHead);
  instAttribs();
  gl.bindVertexArray(null);

  let W = 1, H = 1, dpr = 1;
  const textures = new Set();

  function resize(w, h, ratio) {
    W = Math.max(1, w); H = Math.max(1, h); dpr = ratio;
    const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
  }

  function blend(mode) {
    gl.enable(gl.BLEND);
    if (mode === 'add') gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  function begin(bg) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  // One sheet. s = { M, O, U, Wv, R, k, t, lam, alpha, lineGap, lineA, map,
  // mapA, ringA, half, arrows, arrowCell, mask, gauge:[g, cu, cw, w] }
  function sheet(s) {
    const { p, u } = P.sheet;
    gl.useProgram(p);
    blend('add');
    gl.uniformMatrix4fv(u.uM, false, s.M);
    gl.uniform3fv(u.uO, s.O); gl.uniform3fv(u.uU, s.U); gl.uniform3fv(u.uW, s.Wv);
    gl.uniform1f(u.uR, s.R); gl.uniform1f(u.uK, s.k); gl.uniform1f(u.uT, s.t); gl.uniform1f(u.uLam, s.lam);
    gl.uniform1f(u.uAlpha, s.alpha); gl.uniform1f(u.uLineGap, s.lineGap); gl.uniform1f(u.uLineA, s.lineA);
    gl.uniform1f(u.uMapA, s.mapA); gl.uniform1f(u.uRingA, s.ringA); gl.uniform1f(u.uHalf, s.half ? 1 : 0);
    gl.uniform1f(u.uArrowCell, s.arrowCell || 0.14); gl.uniform1f(u.uMask, s.mask || 0.03);
    const m = MAPS[s.map] || MAPS.none;
    gl.uniform1i(u.uMap, m.id); gl.uniform1i(u.uArrows, s.arrows | 0);
    gl.uniform4fv(u.uGauge, s.gauge || [0, 0.6, 0.3, 0.35]);
    gl.uniform3fv(u.uPos, rgb(m.pos || '#000000').slice(0, 3)); gl.uniform3fv(u.uNeg, rgb(m.neg || '#000000').slice(0, 3));
    gl.uniform3fv(u.uEcol, rgb(HEX.E).slice(0, 3)); gl.uniform3fv(u.uAcol, rgb(HEX.A).slice(0, 3));
    gl.bindVertexArray(vaoSheet);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Segments: data is a Float32Array of n × 12 floats (see SegBuf).
  function lines(M, data, n, mode = 'add') {
    if (!n) return;
    const { p, u } = P.line;
    gl.useProgram(p); blend(mode);
    gl.uniformMatrix4fv(u.uM, false, M); gl.uniform2f(u.uView, W, H);
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * 12), gl.STREAM_DRAW);
    gl.bindVertexArray(vaoLine);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
  }
  // Arrowheads: tip(3) from(3) rgba(4) size,0(2) = 12 floats each.
  function heads(M, data, n, mode = 'add') {
    if (!n) return;
    const { p, u } = P.head;
    gl.useProgram(p); blend(mode);
    gl.uniformMatrix4fv(u.uM, false, M); gl.uniform2f(u.uView, W, H);
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * 12), gl.STREAM_DRAW);
    gl.bindVertexArray(vaoHead);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, n);
  }

  // A mesh made once: { pos: Float32Array, nrm: Float32Array, idx: Uint16Array }.
  function makeMesh(m) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const b0 = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b0); gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const b1 = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b1); gl.bufferData(gl.ARRAY_BUFFER, m.nrm, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: m.idx.length, b0, b1 };
  }
  // Update the positions and normals of a mesh in place (same vertex count).
  function updateMesh(h, m) {
    gl.bindBuffer(gl.ARRAY_BUFFER, h.b0); gl.bufferSubData(gl.ARRAY_BUFFER, 0, m.pos);
    gl.bindBuffer(gl.ARRAY_BUFFER, h.b1); gl.bufferSubData(gl.ARRAY_BUFFER, 0, m.nrm);
  }
  function mesh(M, h, eye, col, alpha, rim = 1, base = 0.12) {
    const { p, u } = P.mesh;
    gl.useProgram(p); blend('add');
    gl.uniformMatrix4fv(u.uM, false, M); gl.uniform3fv(u.uEye, eye); gl.uniform3fv(u.uCol, col);
    gl.uniform1f(u.uAlpha, alpha); gl.uniform1f(u.uRim, rim); gl.uniform1f(u.uBase, base);
    gl.bindVertexArray(h.vao);
    gl.drawElements(gl.TRIANGLES, h.count, gl.UNSIGNED_SHORT, 0);
  }

  // A texture from a canvas (premultiplied, mipmapped).
  function texture(src) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    textures.add(t);
    return t;
  }
  function dropTexture(t) { if (t && textures.delete(t)) gl.deleteTexture(t); }

  // A sprite: rect in CSS px. tex null + kind 1 draws a glow in tint.
  function sprite(tex, x, y, w, h, alpha = 1, kind = 0, tint = [1, 1, 1]) {
    const { p, u } = P.sprite;
    gl.useProgram(p); blend(kind === 1 ? 'add' : 'over');
    gl.uniform4f(u.uRect, x, y, w, h); gl.uniform2f(u.uView, W, H);
    gl.uniform4f(u.uTint, tint[0], tint[1], tint[2], alpha); gl.uniform1i(u.uKind, kind);
    if (tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u.uTex, 0); }
    gl.bindVertexArray(vaoSprite);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  return {
    gl, canvas, resize, begin, sheet, lines, heads, makeMesh, updateMesh, mesh, texture, dropTexture, sprite,
    get W() { return W; }, get H() { return H; }, get dpr() { return dpr; },
  };
}

// A growing buffer of 12-float records for lines() and heads().
export class SegBuf {
  constructor(n = 1024) { this.d = new Float32Array(n * 12); this.n = 0; }
  clear() { this.n = 0; }
  grow() { const d = new Float32Array(this.d.length * 2); d.set(this.d); this.d = d; }
  // A segment from a to b, colour c = [r,g,b,a], width px, dash period px.
  seg(a, b, c, w = 1.5, dash = 0) {
    if ((this.n + 1) * 12 > this.d.length) this.grow();
    const o = this.n++ * 12, d = this.d;
    d[o] = a[0]; d[o + 1] = a[1]; d[o + 2] = a[2] || 0; d[o + 3] = b[0]; d[o + 4] = b[1]; d[o + 5] = b[2] || 0;
    d[o + 6] = c[0]; d[o + 7] = c[1]; d[o + 8] = c[2]; d[o + 9] = c[3]; d[o + 10] = w; d[o + 11] = dash;
  }
  // A polyline through pts (closed when close is true).
  poly(pts, c, w, close = false, dash = 0) {
    for (let i = 0; i + 1 < pts.length; i++) this.seg(pts[i], pts[i + 1], c, w, dash);
    if (close && pts.length > 2) this.seg(pts[pts.length - 1], pts[0], c, w, dash);
  }
}
