// ============================================================================
//  PHOTON CAUSTICS 2D  ·  topview.js — the pool bottom from above (WebGL2)
// ----------------------------------------------------------------------------
//  Draws the "Pool bottom (top-down)" scene of topdown.js. World units are
//  metres on the floor plane, y up the screen.
//
//  CAUSTICS (the mesh-area method). A grid of rays covers the water above
//  the part of the floor that shows. The vertex shader refracts the
//  sunlight at each grid point through the normal of the analytic surface
//  (the same sum of waves as topdown.js) and moves the vertex to the
//  floor point of the ray. The same ray through flat water lands at the
//  old point. The fragment shader gets the two areas from screen-space
//  derivatives:  E = |area old| / |area new| (clamped at 40), times the
//  Fresnel transmittance ratio. The triangles add into a half-float
//  target over the floor, three passes for 650, 550 and 450 nm (colour
//  masks R, G, B) for soft colour fringes. The grid has about one vertex
//  each 2.5 target pixels, so the lines are smooth, with no grain.
//
//  VIEW. Each screen pixel looks straight down at a surface point p. The
//  view ray refracts there and meets the floor at F, so the tiles and the
//  light show the wobble of the water. The pixel takes the tile colour at
//  F times the light at F, the absorption of the water on the path, the
//  sky in the surface by Fresnel, and a small sun glint.
//
//  EXPORTS
//    createTopView(gl, caps, { phone }) -> { resize, draw }
//    TOP_SRC ....... the refraction part of the caustic shader (the plate)
//    draw(o): o = { waves, L, n, dn, d, view: { x0, y0, w, h } (the floor
//                   rect of the canvas), exposure, tiles, floor, fade,
//                   flight, fview: { sx, sy, ox, oy, cx, cy } }
// ============================================================================
import { program, target, drawFull, FULL_VS } from './gl.js';
import { FLY_VS, FLY_FS } from './render2d.js';
import { indexAt } from './optics2d.js';

const NM = [650, 550, 450];
const NW = 8;

const WAVES_GLSL = `
uniform vec4 u_w[${NW}]; uniform int u_nw;
// height and gradient of the surface: sum of A sin(k . p + ph)
vec3 hg(vec2 p){
  vec3 r = vec3(0.0);
  for (int i = 0; i < ${NW}; i++) {
    if (i >= u_nw) break;
    vec4 w = u_w[i]; float a = dot(w.xy, p) + w.w;
    r.x += w.z * sin(a); r.yz += w.z * cos(a) * w.xy;
  }
  return r;
}
float transmit(float ci, float n){
  float s2 = (1.0 - ci * ci) / (n * n);
  if (s2 >= 1.0) return 0.0;
  float ct = sqrt(1.0 - s2);
  float rs = (ci - n * ct) / (ci + n * ct), rp = (ct - n * ci) / (ct + n * ci);
  return 1.0 - 0.5 * (rs * rs + rp * rp);
}`;

const CAUS_VS = `#version 300 es
layout(location=0) in vec2 a_uv;
${WAVES_GLSL}
uniform vec4 u_src, u_dst; uniform vec3 u_L; uniform float u_n, u_d;
out vec2 v_old, v_new; out float v_t;
void main(){
  vec2 p = u_src.xy + a_uv * u_src.zw;
  vec3 s = hg(p);
  vec3 N = normalize(vec3(-s.yz, 1.0));
  vec3 T = refract(u_L, N, 1.0 / u_n), T0 = refract(u_L, vec3(0.0, 0.0, 1.0), 1.0 / u_n);
  vec2 Q = p + T.xy * ((u_d + s.x) / -T.z);
  v_old = p + T0.xy * (u_d / -T0.z); v_new = Q;
  v_t = transmit(-dot(u_L, N), u_n) / transmit(-u_L.z, u_n);
  gl_Position = vec4((Q - u_dst.xy) / u_dst.zw * 2.0 - 1.0, 0.0, 1.0);
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
export const TOP_SRC = CAUS_VS.slice(CAUS_VS.indexOf('void main')).trim();

const SHOW_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
${WAVES_GLSL}
uniform sampler2D u_caus; uniform vec4 u_view, u_dst; uniform vec3 u_L;
uniform float u_n, u_d, u_exp, u_fade, u_tiles; uniform vec3 u_floor; out vec4 o;
const vec3 ABS = vec3(0.42, 0.075, 0.05);
vec3 albedo(vec2 F){
  vec3 c = u_floor;
  if (u_tiles > 0.5) {
    vec2 g = abs(fract(F / 0.25) - 0.5);
    float grout = smoothstep(0.455, 0.475, max(g.x, g.y));
    // a dark lane line along y, 0.25 m wide, each 2.5 m
    float lane = step(abs(fract(F.x / 2.5 + 0.5) - 0.5) * 2.5, 0.125);
    c = mix(c, vec3(0.10, 0.20, 0.42), lane * 0.85);
    c = mix(c, c * 0.62 + vec3(0.04), grout);
  } else {
    float n = fract(sin(dot(floor(F * 60.0), vec2(12.9898, 78.233))) * 43758.5453);
    c *= 0.94 + 0.06 * n;
  }
  return c;
}
void main(){
  vec2 p = u_view.xy + v_uv * u_view.zw;
  vec3 s = hg(p);
  vec3 N = normalize(vec3(-s.yz, 1.0)), V = vec3(0.0, 0.0, -1.0);
  vec3 T = refract(V, N, 1.0 / u_n);
  vec2 F = p + T.xy * ((u_d + s.x) / -T.z);
  vec3 E = texture(u_caus, (F - u_dst.xy) / u_dst.zw).rgb;
  vec3 T0 = refract(u_L, vec3(0.0, 0.0, 1.0), 1.0 / u_n);
  float path = u_d / -T0.z + u_d;
  vec3 floorC = albedo(F) * (0.16 + 0.95 * E) * exp(-ABS * path);
  vec3 scatter = vec3(0.02, 0.10, 0.14) * (1.0 - exp(-u_d * 0.9));
  float ci = N.z, R0 = pow((u_n - 1.0) / (u_n + 1.0), 2.0);
  float F0 = R0 + (1.0 - R0) * pow(1.0 - ci, 5.0);
  vec3 Rv = reflect(V, N), sun = -u_L;
  vec3 sky = mix(vec3(0.55, 0.68, 0.82), vec3(0.25, 0.45, 0.75), clamp(Rv.z, 0.0, 1.0));
  // faint: a full glint (the sun in the surface) clips to white flakes
  float glint = smoothstep(0.9992, 0.99995, dot(Rv, sun)) * 0.22;
  vec3 c = mix(floorC + scatter, sky, F0) + vec3(1.0, 0.95, 0.85) * glint;
  c = 1.0 - exp(-c * u_exp * 1.3);
  c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  o = vec4(c * u_fade, 1.0);
}`;

function gridMesh(gl, nx, ny) {
  const v = new Float32Array((nx + 1) * (ny + 1) * 2), idx = new Uint32Array(nx * ny * 6);
  for (let j = 0, k = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { v[k++] = i / nx; v[k++] = j / ny; }
  for (let j = 0, k = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    idx[k++] = a; idx[k++] = b; idx[k++] = c; idx[k++] = b; idx[k++] = d; idx[k++] = c;
  }
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: idx.length, free() { gl.deleteVertexArray(vao); gl.deleteBuffer(vb); gl.deleteBuffer(ib); } };
}

export function createTopView(gl, caps, opt = {}) {
  const pCaus = program(gl, CAUS_VS, CAUS_FS), pShow = program(gl, FULL_VS, SHOW_FS), pFly = program(gl, FLY_VS, FLY_FS);
  const flyVao = gl.createVertexArray(), flyBuf = gl.createBuffer();
  gl.bindVertexArray(flyVao); gl.bindBuffer(gl.ARRAY_BUFFER, flyBuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 32, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 8);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
  gl.bindVertexArray(null);
  let W = 1, H = 1, caus = null, mesh = null, CW = 0, CH = 0;
  const wbuf = new Float32Array(NW * 4);
  const setWaves = (p, waves) => {
    wbuf.fill(0);
    waves.slice(0, NW).forEach((q, i) => wbuf.set([q.kx, q.ky, q.A, q.ph], i * 4));
    gl.uniform4fv(p.u.u_w, wbuf); gl.uniform1i(p.u.u_nw, Math.min(NW, waves.length));
  };
  return {
    resize(w, h) {
      W = w; H = h;
      // the caustic target: the canvas size, at most 1600 px wide
      const k = Math.min(1, 1600 / Math.max(w, h)) * (opt.phone ? 0.75 : 1);
      const cw = Math.max(64, Math.round(w * k)), ch = Math.max(64, Math.round(h * k));
      if (cw === CW && ch === CH) return;
      CW = cw; CH = ch;
      if (caus) caus.free(); if (mesh) mesh.free();
      caus = target(gl, CW, CH, caps);
      mesh = gridMesh(gl, Math.ceil(CW / 2.5), Math.ceil(CH / 2.5));
    },
    draw(o) {
      const v = o.view, d = o.d;
      // the floor rect of the caustic target: the view and a margin for
      // the wobble of the view rays
      const m = 0.08 + 0.3 * d * 0.25;
      const dst = [v.x0 - m, v.y0 - m, v.w + 2 * m, v.h + 2 * m];
      // the water that lights dst: dst moved back by the flat-water offset,
      // with a margin for the bend at the waves
      const T0 = o.shift0, mm = 0.12 + 0.35 * d;
      const src = [dst[0] - T0[0] - mm, dst[1] - T0[1] - mm, dst[2] + 2 * mm, dst[3] + 2 * mm];
      gl.disable(gl.DEPTH_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, caus.fbo); gl.viewport(0, 0, CW, CH);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(pCaus); setWaves(pCaus, o.waves);
      gl.uniform4fv(pCaus.u.u_src, src); gl.uniform4fv(pCaus.u.u_dst, dst);
      gl.uniform3fv(pCaus.u.u_L, o.L); gl.uniform1f(pCaus.u.u_d, d);
      gl.bindVertexArray(mesh.vao);
      for (let c = 0; c < 3; c++) {
        gl.colorMask(c === 0, c === 1, c === 2, false);
        gl.uniform1f(pCaus.u.u_n, indexAt(o.n, o.dn, NM[c]));
        gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
      }
      gl.colorMask(true, true, true, true);
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      gl.useProgram(pShow); setWaves(pShow, o.waves);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, caus.tex); gl.uniform1i(pShow.u.u_caus, 0);
      gl.uniform4f(pShow.u.u_view, v.x0, v.y0, v.w, v.h); gl.uniform4fv(pShow.u.u_dst, dst);
      gl.uniform3fv(pShow.u.u_L, o.L); gl.uniform1f(pShow.u.u_n, o.n); gl.uniform1f(pShow.u.u_d, d);
      gl.uniform1f(pShow.u.u_exp, o.exposure ?? 1); gl.uniform1f(pShow.u.u_fade, o.fade ?? 1);
      gl.uniform1f(pShow.u.u_tiles, o.tiles ? 1 : 0); gl.uniform3fv(pShow.u.u_floor, o.floor);
      drawFull(gl);
      if (o.flight && o.flight.count) {
        const f = o.fview;
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(pFly);
        gl.uniform4f(pFly.u.u_view, f.sx, f.sy, f.ox, f.oy); gl.uniform2f(pFly.u.u_c, f.cx, f.cy); gl.uniform1f(pFly.u.u_fade, o.fade ?? 1);
        gl.bindVertexArray(flyVao); gl.bindBuffer(gl.ARRAY_BUFFER, flyBuf);
        gl.bufferData(gl.ARRAY_BUFFER, o.flight.verts.subarray(0, o.flight.count * 8), gl.STREAM_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, o.flight.count);
        gl.disable(gl.BLEND);
      }
      gl.bindVertexArray(null);
    },
  };
}
