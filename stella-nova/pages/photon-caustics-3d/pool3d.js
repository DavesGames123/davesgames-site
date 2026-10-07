// ============================================================================
//  POOL CAUSTICS 3D  ·  pool3d.js — a pool in the sun (WebGL2)
// ----------------------------------------------------------------------------
//  World: the pool is x, z in [-1, 1], the still water level is y = 0, the
//  floor is y = -depth, the rim and the deck are at y = RIM. The sun is a
//  direction u_sun (toward the sun); light travels along L = -u_sun.
//
//  WAVES. A height field on a SIM x SIM half-float texture (r height,
//  g velocity) steps the discrete wave equation at a fixed rate:
//    v += 2 (mean of 4 neighbours - h);  v *= damp;  h += v
//  Clamp-to-edge sampling makes the walls reflect. Drops add a cosine bump
//  (rain: many small ones, swell: a few wide soft ones, or a tap).
//
//  CAUSTICS (the photon grid). A G x G grid of photons covers the water.
//  The vertex shader refracts the sun ray at each grid point through the
//  surface normal and moves the vertex to where the ray meets the floor
//  plane. The same ray through flat water lands at the old point. Each
//  triangle so maps a patch of water to a patch of floor, and the power
//  that comes through is spread over the new area. The fragment shader
//  gets the two areas from screen-space derivatives:
//    E = E_flat * |area_old| / |area_new|      (clamped at 40)
//  times the Fresnel transmittance. Triangles add into a half-float
//  caustic texture over the floor plane, |x|, |z| < S. Three passes with
//  the index for 650, 550 and 450 nm (colour masks R, G, B) give the
//  colour fringes. Floor that no triangle reaches is in the wall shadow.
//
//  VIEW. The sky is a full-screen pass. The pool box and the deck are
//  rasterized; a point under water takes its light from the caustic
//  texture: go back along the flat-water ray T0 to the floor plane and
//  read E there, times max(0, -n.T0) / |T0.y| for a wall, times the
//  absorption of water on that path. The water surface refracts the view
//  ray, finds the pool wall or floor it meets, shades that point, and
//  mixes in the sky reflection by Fresnel (Schlick).
//  The photon paths (optional) are GL lines from the vertex id: sky to
//  surface, surface to floor, through the same refraction.
//
//  EXPORTS
//    createPool3D(gl, caps, { phone }) -> { resize, draw, drop, pick, ray,
//                                            flatten }
//    CAUS_SRC ..... the caustic fragment shader source (the saver plate
//                   shows an extract of it)
//    draw(o): o = { dt, cam, shift, sun, depth, n, dn, mode, amp, rays,
//                   exposure, fade }
//      cam = { yaw, pitch, dist, ty }  orbit about (0, ty, 0)
//      shift = [sx, sy]  NDC shift of the centre (clear band of the plate)
//      sun = { el, az } radians;  mode 'rain' | 'swell' | 'calm'
// ============================================================================
import { program, target, drawFull, FULL_VS } from './gl.js';

const RIM = 0.16, DECK = 14, FOV = 42 * Math.PI / 180;
const NM = [650, 550, 450];

// ── shaders ─────────────────────────────────────────────────────────────────
const SIM_FS = `#version 300 es
precision highp float;
in vec2 v_uv; uniform sampler2D u_s; uniform vec2 u_px; uniform float u_damp; out vec4 o;
void main(){
  vec4 c = texture(u_s, v_uv);
  float avg = 0.25 * (texture(u_s, v_uv + vec2(u_px.x, 0.0)).r + texture(u_s, v_uv - vec2(u_px.x, 0.0)).r
                    + texture(u_s, v_uv + vec2(0.0, u_px.y)).r + texture(u_s, v_uv - vec2(0.0, u_px.y)).r);
  c.g += (avg - c.r) * 2.0;
  c.g *= u_damp;
  c.r += c.g;
  c.r *= 0.9995;
  o = c;
}`;
const DROP_FS = `#version 300 es
precision highp float;
in vec2 v_uv; uniform sampler2D u_s; uniform vec3 u_drop; uniform float u_str; out vec4 o;
void main(){
  vec4 c = texture(u_s, v_uv);
  float d = max(0.0, 1.0 - length(u_drop.xy - (v_uv * 2.0 - 1.0)) / u_drop.z);
  c.r += (0.5 - 0.5 * cos(d * 3.14159265)) * u_str;
  o = c;
}`;

// Height and normal of the water at x, z (world), shared by passes.
const WATER_GLSL = `
uniform sampler2D u_sim; uniform vec2 u_px;
float hAt(vec2 xz){ return texture(u_sim, xz * 0.5 + 0.5).r; }
vec3 nAt(vec2 xz){
  vec2 uv = xz * 0.5 + 0.5;
  float hx = texture(u_sim, uv + vec2(u_px.x, 0.0)).r - texture(u_sim, uv - vec2(u_px.x, 0.0)).r;
  float hz = texture(u_sim, uv + vec2(0.0, u_px.y)).r - texture(u_sim, uv - vec2(0.0, u_px.y)).r;
  return normalize(vec3(-hx / (4.0 * u_px.x), 1.0, -hz / (4.0 * u_px.y)));
}
float transmit(float ci, float n){
  float s2 = (1.0 - ci * ci) / (n * n);
  if (s2 >= 1.0) return 0.0;
  float ct = sqrt(1.0 - s2);
  float rs = (ci - n * ct) / (ci + n * ct), rp = (ct - n * ci) / (ct + n * ci);
  return 1.0 - 0.5 * (rs * rs + rp * rp);
}`;

const CAUS_VS = `#version 300 es
layout(location=0) in vec2 a_xz;
${WATER_GLSL}
uniform vec3 u_L; uniform float u_n, u_depth, u_S;
out vec2 v_old, v_new; out float v_t;
void main(){
  vec3 N = nAt(a_xz);
  vec3 P = vec3(a_xz.x, hAt(a_xz), a_xz.y);
  vec3 T = refract(u_L, N, 1.0 / u_n), T0 = refract(u_L, vec3(0.0, 1.0, 0.0), 1.0 / u_n);
  vec3 Q = P + T * ((-u_depth - P.y) / T.y);
  vec3 Q0 = vec3(a_xz.x, 0.0, a_xz.y) + T0 * (-u_depth / T0.y);
  v_old = Q0.xz; v_new = Q.xz;
  v_t = transmit(max(0.0, -dot(u_L, N)), u_n) / transmit(-u_L.y, u_n);
  gl_Position = vec4(Q.xz / u_S, 0.0, 1.0);
}`;
const CAUS_FS = `#version 300 es
precision highp float;
in vec2 v_old, v_new; in float v_t; out vec4 o;
float area(vec2 a, vec2 b){ return abs(a.x * b.y - a.y * b.x); }
void main(){
  float a0 = area(dFdx(v_old), dFdy(v_old)), a1 = area(dFdx(v_new), dFdy(v_new));
  float E = min(40.0, a0 / max(a1, 1e-12)) * v_t;
  o = vec4(E, E, E, 1.0);
}`;

export const CAUS_SRC = CAUS_FS;

// Shading of the pool and the sky, shared by the view passes.
const SCENE_GLSL = `
uniform sampler2D u_caus; uniform float u_depth, u_S, u_n, u_exp, u_fade;
uniform vec3 u_sun, u_T0, u_eye;
const vec3 SUNC = vec3(1.0, 0.93, 0.82) * 2.6;
const vec3 ABS = vec3(0.50, 0.13, 0.085);
const float RIM = ${RIM.toFixed(3)};
vec3 sky(vec3 d){
  float up = max(d.y, 0.0);
  vec3 c = mix(vec3(0.62, 0.70, 0.78), vec3(0.16, 0.34, 0.62), pow(up, 0.55));
  float s = max(dot(d, u_sun), 0.0);
  c += SUNC * (pow(s, 1400.0) * 40.0 + pow(s, 12.0) * 0.18);
  if (d.y < 0.0) c = mix(c, vec3(0.30, 0.31, 0.30), min(1.0, -d.y * 6.0));
  return c;
}
vec3 tiles(vec3 p, vec3 n){
  vec2 uv = abs(n.y) > 0.5 ? p.xz : (abs(n.x) > 0.5 ? p.zy : p.xy);
  vec2 f = abs(fract(uv * 7.0) - 0.5);
  float gr = smoothstep(0.45, 0.48, max(f.x, f.y));
  vec3 base = vec3(0.52, 0.68, 0.74);
  // dark lane line on the floor
  if (n.y > 0.5 && p.y < 0.0 && abs(p.x) < 0.07 && abs(p.z) < 0.75) base = vec3(0.10, 0.16, 0.30);
  return mix(base, vec3(0.26, 0.32, 0.36), gr);
}
vec3 deck(vec3 p){
  vec2 f = abs(fract(p.xz * 2.0) - 0.5);
  float gr = smoothstep(0.46, 0.49, max(f.x, f.y));
  float h = fract(sin(dot(floor(p.xz * 2.0), vec2(12.9898, 78.233))) * 43758.5453);
  return mix(vec3(0.13, 0.13, 0.135) * (0.8 + 0.2 * h), vec3(0.06, 0.06, 0.065), gr);
}
vec3 lightBelow(vec3 p, vec3 n){
  vec3 q = p + u_T0 * ((-u_depth - p.y) / u_T0.y);
  vec3 E = texture(u_caus, q.xz / (2.0 * u_S) + 0.5).rgb;
  float k = max(0.0, -dot(n, u_T0)) / abs(u_T0.y);
  float path = max(0.0, -p.y) / abs(u_T0.y);
  return SUNC * max(u_sun.y, 0.0) * E * k * exp(-ABS * path);
}
vec3 shadePool(vec3 p, vec3 n){
  bool top = n.y > 0.5 && p.y > 0.0;
  vec3 alb = top ? deck(p) : tiles(p, n);
  vec3 amb = vec3(0.06, 0.09, 0.12);
  vec3 L = p.y < 0.0 ? lightBelow(p, n) : SUNC * max(0.0, dot(n, u_sun));
  if (p.y < 0.0) amb *= exp(-ABS * (-p.y) * 1.5);
  return alb * (L + amb);
}
vec3 finish(vec3 c, vec3 p){
  float fog = 1.0 - exp(-max(0.0, length(p - u_eye) - 6.0) * 0.12);
  c = mix(c, vec3(0.55, 0.62, 0.70), fog);
  c = 1.0 - exp(-c * u_exp);
  c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  return c * u_fade;
}`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
${SCENE_GLSL}
uniform vec3 u_right, u_up, u_fwd; uniform vec4 u_proj; out vec4 o;
void main(){
  vec2 ndc = v_uv * 2.0 - 1.0;
  vec3 d = normalize(u_fwd + (ndc.x - u_proj.z) / u_proj.x * u_right + (ndc.y - u_proj.w) / u_proj.y * u_up);
  vec3 c = sky(d);
  c = 1.0 - exp(-c * u_exp);
  c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  o = vec4(c * u_fade, 1.0);
}`;

const BOX_VS = `#version 300 es
layout(location=0) in vec3 a_p; layout(location=1) in vec3 a_n;
uniform mat4 u_vp; uniform float u_depth;
out vec3 v_p, v_n;
void main(){
  vec3 p = vec3(a_p.x, a_p.y < -0.5 ? -u_depth : a_p.y, a_p.z);
  v_p = p; v_n = a_n;
  gl_Position = u_vp * vec4(p, 1.0);
}`;
const BOX_FS = `#version 300 es
precision highp float;
in vec3 v_p, v_n;
${SCENE_GLSL}
out vec4 o;
void main(){ o = vec4(finish(shadePool(v_p, v_n), v_p), 1.0); }`;

const WATER_VS = `#version 300 es
layout(location=0) in vec2 a_xz;
uniform sampler2D u_sim; uniform mat4 u_vp;
out vec3 v_p;
void main(){
  vec3 p = vec3(a_xz.x, texture(u_sim, a_xz * 0.5 + 0.5).r, a_xz.y);
  v_p = p; gl_Position = u_vp * vec4(p, 1.0);
}`;
const WATER_FS = `#version 300 es
precision highp float;
in vec3 v_p;
${WATER_GLSL}
${SCENE_GLSL}
out vec4 o;
vec3 boxHit(vec3 p, vec3 d, out vec3 n){
  float tx = d.x > 0.0 ? (1.0 - p.x) / d.x : d.x < 0.0 ? (-1.0 - p.x) / d.x : 1e9;
  float tz = d.z > 0.0 ? (1.0 - p.z) / d.z : d.z < 0.0 ? (-1.0 - p.z) / d.z : 1e9;
  float ty = d.y < 0.0 ? (-u_depth - p.y) / d.y : 1e9;
  float t = min(tx, min(ty, tz));
  n = t == ty ? vec3(0.0, 1.0, 0.0) : t == tx ? vec3(-sign(d.x), 0.0, 0.0) : vec3(0.0, 0.0, -sign(d.z));
  return p + d * t;
}
void main(){
  vec3 N = nAt(v_p.xz);
  vec3 V = normalize(v_p - u_eye);
  if (dot(V, N) > 0.0) N = normalize(N - 2.0 * dot(V, N) * V * 0.5);
  float ci = clamp(-dot(V, N), 0.0, 1.0);
  float R0 = pow((u_n - 1.0) / (u_n + 1.0), 2.0);
  float F = R0 + (1.0 - R0) * pow(1.0 - ci, 5.0);
  vec3 refl = sky(reflect(V, N));
  vec3 T = refract(V, N, 1.0 / u_n);
  vec3 hn; vec3 hp = boxHit(v_p, T, hn);
  float len = length(hp - v_p);
  vec3 refr = shadePool(hp, hn) * exp(-ABS * len) + vec3(0.0, 0.05, 0.07) * (1.0 - exp(-len * 0.8));
  o = vec4(finish(mix(refr, refl, F), v_p), 1.0);
}`;

const RAYS_VS = `#version 300 es
${WATER_GLSL}
uniform mat4 u_vp; uniform vec3 u_L; uniform float u_n, u_depth; uniform int u_nr;
out float v_a; out float v_under;
void main(){
  int ray = gl_VertexID / 4, k = gl_VertexID % 4;
  vec2 xz = (vec2(float(ray % u_nr), float(ray / u_nr)) + 0.5) / float(u_nr) * 1.7 - 0.85;
  vec3 N = nAt(xz), P = vec3(xz.x, hAt(xz), xz.y);
  vec3 T = refract(u_L, N, 1.0 / u_n);
  vec3 p = k == 0 ? P - u_L * 0.7 : k == 3 ? P + T * ((-u_depth - P.y) / T.y) : P;
  v_a = k == 0 ? 0.0 : 1.0; v_under = k >= 2 ? 1.0 : 0.0;
  gl_Position = u_vp * vec4(p, 1.0);
}`;
const RAYS_FS = `#version 300 es
precision highp float;
in float v_a; in float v_under; uniform float u_fade; out vec4 o;
void main(){
  vec3 c = mix(vec3(1.0, 0.86, 0.55), vec3(0.75, 0.95, 1.0), v_under);
  float a = mix(0.35 * v_a, 0.7, v_under) * u_fade;
  o = vec4(c * a, a);
}`;

// ── mesh helpers ────────────────────────────────────────────────────────────
function grid(gl, n) {
  const v = new Float32Array((n + 1) * (n + 1) * 2), idx = new Uint32Array(n * n * 6);
  for (let j = 0, k = 0; j <= n; j++) for (let i = 0; i <= n; i++) { v[k++] = i / n * 2 - 1; v[k++] = j / n * 2 - 1; }
  for (let j = 0, k = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    idx.set([a, b, c, b, d, c], k); k += 6;
  }
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: idx.length };
}
// The pool box inside faces, the rim and the deck. y = -1 in a vertex means
// the floor level (-depth), set in the shader.
function poolBox(gl) {
  const t = [];
  const quad = (a, b, c, d, n) => { for (const p of [a, b, c, a, c, d]) t.push(...p, ...n); };
  const F = -1, R = RIM, D = DECK;
  quad([-1, F, -1], [-1, F, 1], [1, F, 1], [1, F, -1], [0, 1, 0]);                 // floor
  quad([-1, F, -1], [-1, R, -1], [-1, R, 1], [-1, F, 1], [1, 0, 0]);               // x = -1 wall
  quad([1, F, 1], [1, R, 1], [1, R, -1], [1, F, -1], [-1, 0, 0]);                  // x = +1 wall
  quad([1, F, -1], [1, R, -1], [-1, R, -1], [-1, F, -1], [0, 0, 1]);               // z = -1 wall
  quad([-1, F, 1], [-1, R, 1], [1, R, 1], [1, F, 1], [0, 0, -1]);                  // z = +1 wall
  quad([-D, R, -D], [-D, R, D], [-1, R, D], [-1, R, -D], [0, 1, 0]);               // deck
  quad([1, R, -D], [1, R, D], [D, R, D], [D, R, -D], [0, 1, 0]);
  quad([-1, R, -D], [-1, R, -1], [1, R, -1], [1, R, -D], [0, 1, 0]);
  quad([-1, R, 1], [-1, R, D], [1, R, D], [1, R, 1], [0, 1, 0]);
  const v = new Float32Array(t);
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  gl.bindVertexArray(null);
  return { vao, count: v.length / 6 };
}

// ── small vector maths ──────────────────────────────────────────────────────
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function refract3(d, n, eta) {
  const c = -dot(d, n), k = 1 - eta * eta * (1 - c * c);
  if (k < 0) return null;
  const s = eta * c - Math.sqrt(k);
  return norm([eta * d[0] + s * n[0], eta * d[1] + s * n[1], eta * d[2] + s * n[2]]);
}
export function indexAt(n, dn, nm) {
  return n + dn * (1 / (nm * nm) - 1 / (589.3 * 589.3)) / (1 / (400 * 400) - 1 / (700 * 700));
}

// Camera basis and a view-projection matrix (column-major) with a shift of
// the centre in NDC.
export function camera(cam, aspect, shift) {
  const ty = cam.ty ?? -0.3, cp = Math.cos(cam.pitch);
  const tgt = [cam.tx || 0, ty, cam.tz || 0];
  const eye = [tgt[0] + cam.dist * cp * Math.sin(cam.yaw), ty + cam.dist * Math.sin(cam.pitch), tgt[2] + cam.dist * cp * Math.cos(cam.yaw)];
  const fwd = norm(sub(tgt, eye)), right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd);
  const f = 1 / Math.tan((cam.fov || FOV) / 2), near = 0.03, far = 60;
  const px = f / aspect, py = f, sx = shift ? shift[0] : 0, sy = shift ? shift[1] : 0;
  // view matrix rows: right, up, -fwd
  const V = [right[0], up[0], -fwd[0], 0, right[1], up[1], -fwd[1], 0, right[2], up[2], -fwd[2], 0,
    -dot(right, eye), -dot(up, eye), dot(fwd, eye), 1];
  const P = [px, 0, 0, 0, 0, py, 0, 0, -sx, -sy, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
  const M = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += P[k * 4 + r] * V[c * 4 + k]; M[c * 4 + r] = s; }
  return { eye, fwd, right, up, vp: M, proj: [px, py, sx, sy] };
}

export function createPool3D(gl, caps, opt = {}) {
  const SIM = 256, G = opt.phone ? 150 : 240, CRES = opt.phone ? 512 : 1024, S = 1.7, NR = 12;
  const pSim = program(gl, FULL_VS, SIM_FS), pDrop = program(gl, FULL_VS, DROP_FS);
  const pCaus = program(gl, CAUS_VS, CAUS_FS), pSky = program(gl, FULL_VS, SKY_FS);
  const pBox = program(gl, BOX_VS, BOX_FS), pWater = program(gl, WATER_VS, WATER_FS), pRays = program(gl, RAYS_VS, RAYS_FS);
  // The wave field wants full float when the GPU can render to it and
  // filter it; half float works but loses small ripples.
  const f32 = caps.float && gl.getExtension('EXT_color_buffer_float') && gl.getExtension('OES_texture_float_linear');
  const simCaps = f32 ? { internal: gl.RGBA32F, type: gl.FLOAT } : caps;
  let simA = target(gl, SIM, SIM, simCaps), simB = target(gl, SIM, SIM, simCaps);
  const caus = target(gl, CRES, CRES, caps);
  const cgrid = grid(gl, G), wgrid = grid(gl, 160), box = poolBox(gl), raysVao = gl.createVertexArray();
  const px = [1 / SIM, 1 / SIM];
  let W = 1, H = 1, acc = 0, rainAcc = 0, swellAcc = 0, last = null, simT = 0;
  const queue = [];

  const swap = () => { const t = simA; simA = simB; simB = t; };
  const simPass = (prog, set) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, simB.fbo); gl.viewport(0, 0, SIM, SIM);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, simA.tex); gl.uniform1i(prog.u.u_s, 0);
    set(prog); drawFull(gl); swap();
  };
  const setCommon = (p, o, view) => {
    const u = p.u;
    if (u.u_depth) gl.uniform1f(u.u_depth, o.depth);
    if (u.u_S) gl.uniform1f(u.u_S, S);
    if (u.u_n) gl.uniform1f(u.u_n, o.n);
    if (u.u_exp) gl.uniform1f(u.u_exp, o.exposure ?? 1);
    if (u.u_fade) gl.uniform1f(u.u_fade, o.fade ?? 1);
    if (u.u_sun) gl.uniform3fv(u.u_sun, view.sun);
    if (u.u_T0) gl.uniform3fv(u.u_T0, view.T0);
    if (u.u_eye) gl.uniform3fv(u.u_eye, view.cam.eye);
    if (u.u_vp) gl.uniformMatrix4fv(u.u_vp, false, view.cam.vp);
    if (u.u_px) gl.uniform2fv(u.u_px, px);
    if (u.u_sim) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, simA.tex); gl.uniform1i(u.u_sim, 1); }
    if (u.u_caus) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, caus.tex); gl.uniform1i(u.u_caus, 2); }
  };

  const api = {
    resize(w, h) { W = w; H = h; },
    // x, z in [-1, 1]; r radius in world units; s strength (height)
    drop(x, z, r = 0.05, s = 0.02) { queue.push([x, z, r, s]); },
    // the world ray through a CSS-px point, for taps
    ray(nx, ny) {
      if (!last) return null;
      const c = last.cam, [ppx, ppy, sx, sy] = c.proj, xe = (nx - sx) / ppx, ye = (ny - sy) / ppy;
      const d = norm([c.fwd[0] + xe * c.right[0] + ye * c.up[0], c.fwd[1] + xe * c.right[1] + ye * c.up[1], c.fwd[2] + xe * c.right[2] + ye * c.up[2]]);
      return { o: c.eye, d };
    },
    pick(nx, ny) {
      const r = api.ray(nx, ny); if (!r || r.d[1] >= 0) return null;
      const t = -r.o[1] / r.d[1], x = r.o[0] + t * r.d[0], z = r.o[2] + t * r.d[2];
      return Math.abs(x) < 1 && Math.abs(z) < 1 ? [x, z] : null;
    },
    get simTime() { return simT; },
    // still water: clear both wave textures
    flatten() {
      for (const t of [simA, simB]) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); queue.length = 0;
    },
    draw(o) {
      const dt = Math.min(0.1, o.dt || 0.016);
      gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
      // waves: auto drops, then fixed steps at 120 Hz
      const amp = o.amp ?? 1;
      if (o.mode === 'rain') {
        rainAcc += dt * 14;
        while (rainAcc >= 1) { rainAcc--; queue.push([Math.random() * 2 - 1, Math.random() * 2 - 1, 0.025 + Math.random() * 0.03, (Math.random() < 0.5 ? -1 : 1) * 0.012 * amp]); }
      } else if (o.mode === 'swell') {
        swellAcc += dt * 3.0;
        while (swellAcc >= 1) { swellAcc--; queue.push([Math.random() * 2 - 1, Math.random() * 2 - 1, 0.07 + Math.random() * 0.06, (Math.random() < 0.5 ? -1 : 1) * 0.022 * amp]); }
      }
      while (queue.length) {
        const [x, z, r, s] = queue.shift();
        simPass(pDrop, p => { gl.uniform3f(p.u.u_drop, x, z, r); gl.uniform1f(p.u.u_str, s); });
      }
      const damp = o.mode === 'swell' ? 0.997 : 0.993;
      acc += dt * 120;
      let steps = 0;
      while (acc >= 1 && steps < 6) { acc--; steps++; simT += 1 / 120; simPass(pSim, p => { gl.uniform2fv(p.u.u_px, px); gl.uniform1f(p.u.u_damp, damp); }); }
      if (acc > 3) acc = 0;

      // light
      const el = o.sun.el, az = o.sun.az;
      const sun = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)], L = [-sun[0], -sun[1], -sun[2]];
      const T0 = refract3(L, [0, 1, 0], 1 / o.n);
      const cam = camera(o.cam, W / H, o.shift);
      const view = { sun, T0, cam };
      last = view;

      // caustics: three wavelengths into one texture
      gl.bindFramebuffer(gl.FRAMEBUFFER, caus.fbo); gl.viewport(0, 0, CRES, CRES);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(pCaus); setCommon(pCaus, o, view);
      gl.uniform3fv(pCaus.u.u_L, L);
      gl.bindVertexArray(cgrid.vao);
      for (let c = 0; c < 3; c++) {
        gl.colorMask(c === 0, c === 1, c === 2, false);
        gl.uniform1f(pCaus.u.u_n, indexAt(o.n, o.dn, NM[c]));
        gl.drawElements(gl.TRIANGLES, cgrid.count, gl.UNSIGNED_INT, 0);
      }
      gl.colorMask(true, true, true, true);
      gl.disable(gl.BLEND);

      // view
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      gl.useProgram(pSky); setCommon(pSky, o, view);
      gl.uniform3fv(pSky.u.u_right, cam.right); gl.uniform3fv(pSky.u.u_up, cam.up); gl.uniform3fv(pSky.u.u_fwd, cam.fwd);
      gl.uniform4fv(pSky.u.u_proj, cam.proj);
      drawFull(gl);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(pBox); setCommon(pBox, o, view);
      gl.bindVertexArray(box.vao); gl.drawArrays(gl.TRIANGLES, 0, box.count);
      // the water does not write depth, so the rays under it still show
      gl.depthMask(false);
      gl.useProgram(pWater); setCommon(pWater, o, view);
      gl.bindVertexArray(wgrid.vao); gl.drawElements(gl.TRIANGLES, wgrid.count, gl.UNSIGNED_INT, 0);
      if (o.rays) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(pRays); setCommon(pRays, o, view);
        gl.uniform3fv(pRays.u.u_L, L); gl.uniform1f(pRays.u.u_n, o.n); gl.uniform1i(pRays.u.u_nr, NR);
        gl.bindVertexArray(raysVao); gl.drawArrays(gl.LINES, 0, NR * NR * 4);
        gl.disable(gl.BLEND);
      }
      gl.depthMask(true); gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(null);
    },
  };
  return api;
}
