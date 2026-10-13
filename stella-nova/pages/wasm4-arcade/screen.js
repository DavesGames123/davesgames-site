// ============================================================================
//  WASM-4 ARCADE  ·  screen.js — the CRT glass of the 3D TV (GLSL)
// ----------------------------------------------------------------------------
//  createScreen() -> { material, setFrame(rgba, fx), uniforms, glow }
//    material   a ShaderMaterial for the curved glass mesh of room.js
//    setFrame   uploads the 160 x 160 RGBA picture of this frame, with the
//               phosphor persistence of crt.js (persist()) when fx > 0,
//               and measures the mean colour for the glow light
//    glow       [r, g, b] 0..1, the mean colour of the last frame
//  The uniforms time, fx, stat and power have the meaning of crt.js.
//
//  The fragment shader is the glass part of shaders/crt.wgsl in GLSL ES
//  3.0, so the 3D TV keeps the look of the flat tube: barrel glass, one
//  Gaussian beam per row, three taps per row, an aperture grille, bloom,
//  vignette, hum bar, flicker, glint, the static of a channel change and
//  the power-on line. Two changes for 3D: (1) the beams and the grille
//  fade out when a row is less than about 2 px tall (fwidth), so a small
//  far TV does not show moire; (2) outside the round glass corners it
//  draws the dark tube mask, not the bezel (room.js models the bezel).
//  It writes raw sRGB values (no tone mapping), so the four palette
//  colours of the cart reach the screen as they are.
//
//  grep -n targets  "export function createScreen"  "const FRAG"  "fn picture"
// ============================================================================
import * as THREE from 'three';
import { persist } from './crt.js';

const N = 160;

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const FRAG = /* glsl */`
precision highp float;
precision highp int;
uniform sampler2D tex;
uniform float time;
uniform float fx;
uniform float stat;
uniform float power;
varying vec2 vUv;

float hash(vec2 v) { return fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453); }
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}
vec3 texel(int ix, int iy) { return texelFetch(tex, ivec2(clamp(ix, 0, 159), clamp(iy, 0, 159)), 0).rgb; }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 rowColor(float x, int iy) {
  int ix = int(floor(x));
  float f = fract(x) - 0.5;
  float w0 = exp(-((f + 1.0) * (f + 1.0)) * 2.2);
  float w1 = exp(-(f * f) * 2.2);
  float w2 = exp(-((f - 1.0) * (f - 1.0)) * 2.2);
  vec3 s = texel(ix - 1, iy) * w0 + texel(ix, iy) * w1 + texel(ix + 1, iy) * w2;
  return s / (w0 + w1 + w2);
}
vec3 beam(vec3 c, float d) {
  float w = mix(0.24, 0.42, luma(c));
  return c * exp(-(d * d) / (2.0 * w * w));
}
// fn picture: the picture at glass coordinate g (0..1, y down), strength k
vec3 picture(vec2 g, float k, float kl, vec2 px) {
  vec2 t = g * 160.0;
  vec3 plain = texel(int(floor(t.x)), int(floor(t.y)));
  if (k <= 0.0) { return plain; }
  int iy = int(floor(t.y));
  float fy = fract(t.y) - 0.5;
  int nb = iy + 1;
  if (fy < 0.0) { nb = iy - 1; }
  vec3 col = beam(rowColor(t.x, iy), fy) + beam(rowColor(t.x, nb), 1.0 - abs(fy));
  col = col * 1.55;
  // fade beams to the flat rows when a row is small on screen
  col = mix(textureLod(tex, g, 0.0).rgb * 1.05, col, kl);
  int m = int(mod(floor(px.x), 3.0));
  vec3 mask = vec3(1.0, 0.72, 0.72);
  if (m == 1) { mask = vec3(0.72, 1.0, 0.72); }
  if (m == 2) { mask = vec3(0.72, 0.72, 1.0); }
  col = col * mix(vec3(1.0), mask * 1.18, 0.75 * k * kl);
  vec3 b = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5236;
    float r = 1.6;
    if (i % 2 == 1) { r = 3.6; }
    b = b + textureLod(tex, g + vec2(cos(a), sin(a)) * (r / 160.0), 0.0).rgb;
  }
  b = b / 12.0;
  col = col + b * b * 0.55 * k;
  return mix(plain, col, k);
}

void main() {
  float k = clamp(fx, 0.0, 1.0);
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 c = uv * 2.0 - vec2(1.0);
  vec2 cw = c * (vec2(1.0) + (c.yx * c.yx) * (0.11 * k));
  float rr = 0.035 + 0.05 * k;
  float dg = sdRoundBox(cw, vec2(1.0), rr);
  // rows per device px, taken before any branch (derivatives need it)
  float rows = fwidth(uv.y * 160.0);
  float kl = 1.0 - smoothstep(0.38, 0.6, rows);
  if (dg > 0.0) {
    gl_FragColor = vec4(vec3(0.012), 1.0);
    return;
  }
  vec2 g = cw * 0.5 + vec2(0.5);
  float pw = clamp(power, 0.0, 1.0);
  float sq = max(pw * pw, 0.004);
  float gy = (g.y - 0.5) / sq + 0.5;
  vec3 col = vec3(0.0);
  if (gy >= 0.0) {
    if (gy <= 1.0) { col = picture(vec2(g.x, gy), k, kl, gl_FragCoord.xy); }
  }
  if (pw < 1.0) {
    float ln = exp(-pow((g.y - 0.5) / (0.004 + 0.06 * sq), 2.0));
    col = col * smoothstep(0.0, 0.6, pw) + vec3(0.85, 0.95, 1.0) * ln * (1.0 - pw) * 1.4;
  }
  float st = clamp(stat, 0.0, 1.0);
  if (st > 0.0) {
    vec2 cell = floor(g * 320.0);
    float n = hash(cell + vec2(floor(time * 60.0) * 7.31, 3.7));
    float roll = smoothstep(0.0, 0.08, abs(fract(g.y + time * 1.7) - 0.5) - 0.38);
    col = mix(col, vec3(n) * (0.75 + 0.25 * roll), st);
  }
  float hb = exp(-pow((fract(time * 0.07) * 1.4 - 0.2 - g.y) / 0.12, 2.0));
  col = col * (1.0 + 0.035 * k * hb);
  col = col * (1.0 - 0.03 * k * (0.5 + 0.5 * sin(time * 377.0) * sin(time * 13.3)));
  float vig = 1.0 - 0.55 * k * pow(length(cw) * 0.72, 3.0);
  col = col * clamp(vig, 0.0, 1.0);
  float glint = exp(-pow(length((g - vec2(0.3, 0.16)) * vec2(1.0, 3.2)) / 0.32, 2.0));
  col = col + vec3(0.05) * glint * max(k, 0.4) + vec3(0.018) * (1.0 - g.y) * k;
  float inner = smoothstep(-0.05, 0.0, dg);
  col = col * (1.0 - 0.7 * inner * max(k, 0.3));
  col = max(col, vec3(0.018, 0.02, 0.019) * max(k, 0.5));
  gl_FragColor = vec4(col, 1.0);
}`;

export function createScreen() {
  const data = new Uint8Array(N * N * 4);
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
  const uniforms = { tex: { value: tex }, time: { value: 0 }, fx: { value: 0.8 }, stat: { value: 0 }, power: { value: 1 } };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, toneMapped: false });
  material.name = 'crtGlass';
  const prev = new Float32Array(N * N * 4);
  const glow = [0, 0, 0];
  return {
    material, uniforms, glow, tex,
    setFrame(rgba, fx = 1) {
      if (fx > 0) persist(prev, rgba, data, 0.5 * fx); else data.set(rgba);
      tex.needsUpdate = true;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < data.length; i += 4 * 37) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
      glow[0] = r / n / 255; glow[1] = g / n / 255; glow[2] = b / n / 255;
    },
    dispose() { tex.dispose(); material.dispose(); },
  };
}
