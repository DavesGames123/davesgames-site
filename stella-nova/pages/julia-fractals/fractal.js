/*
Copyright 2023 Matthias Müller - Ten Minute Physics, 
www.youtube.com/c/TenMinutePhysics
www.matthiasMueller.info/tenMinutePhysics

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
// Julia Fractals · upstream script 1, verbatim from Ten Minute Physics
// 19-julia.html by Matthias Müller. MIT License (notice kept above).
// Source: https://github.com/matthias-research/pages/blob/master/tenMinutePhysics/19-julia.html
// ============================================================================
//  JULIA FRACTALS  ·  pages/julia-fractals/fractal.js — the maths (no DOM)
// ----------------------------------------------------------------------------
//  UPSTREAM (MIT, notice above): Matthias Müller's Ten Minute Physics #19
//  (19-julia.html): getNumIters (z <- z^2 + c until |z| > 2), the gradient
//  colours and getGradientColor (20 steps per colour), the Mono view (escape
//  black, inside amber 255,192,0), and the Julia / Mandelbrot switch.
//  They are kept as escapeIters, UPSTREAM_GRADIENT, gradientColor below.
//
//  OUR ADDITIONS (davesgames.io, not upstream): smooth (continuous) escape
//  counts, the multibrot power z^d, colour maps, parameter paths for c
//  (circle, main cardioid, period-2 bulb, Lissajous, wander), named zoom
//  spots, a progressive CPU renderer, and the GLSL source for the WebGL2
//  renderer (gl.js) with the same colouring.
//
//  grep -n targets: "export function escapeIters", "export function smoothMu",
//  "export function colorOf", "export function cAt", "export function renderCPU",
//  "export const FRAG"
// ============================================================================

// ---- upstream ------------------------------------------------------------------
export function escapeIters(x1, x2, c1, c2, maxIters) {
  let iters;
  for (iters = 0; iters < maxIters; iters++) {
    if (x1 * x1 + x2 * x2 > 4.0) return iters;
    const x = x1;
    x1 = x1 * x1 - x2 * x2;
    x2 = 2.0 * x * x2;
    x1 += c1;
    x2 += c2;
  }
  return maxIters;
}
export const UPSTREAM_GRADIENT = [[15, 2, 66], [191, 41, 12], [222, 99, 11], [229, 208, 14], [255, 255, 255], [102, 173, 183], [14, 29, 104]];
export function gradientColor(nr, steps, cols = UPSTREAM_GRADIENT) {
  const numCols = cols.length, col0 = Math.floor(nr / steps) % numCols, col1 = (col0 + 1) % numCols, step = nr % steps, out = [0, 0, 0];
  for (let i = 0; i < 3; i++) { const c0 = cols[col0][i], c1 = cols[col1][i]; out[i] = Math.floor(c0 + (c1 - c0) / steps * step); }
  return out;
}

// ---- site layer -----------------------------------------------------------------
// The smooth escape count mu (Linas Vepstas: n + 1 - log2 log |z|) with a
// bailout of 16 for a clean fraction, and the power d (d = 2 is upstream).
// Returns -1 inside (no escape in maxIters).
export function smoothMu(zx, zy, cx, cy, maxIters, d = 2) {
  const B = 256;
  for (let n = 0; n < maxIters; n++) {
    const r2 = zx * zx + zy * zy;
    if (r2 > B) { const l = Math.log(r2) * 0.5; return n + 1 - Math.log(l / Math.LN2) / Math.log(d); }
    if (d === 2) { const x = zx; zx = zx * zx - zy * zy + cx; zy = 2 * x * zy + cy; }
    else { const r = Math.pow(r2, d / 2), a = Math.atan2(zy, zx) * d; zx = r * Math.cos(a) + cx; zy = r * Math.sin(a) + cy; }
  }
  return -1;
}

// Colour one pixel. P = { color: 'mono'|'gradient'|'smooth'|'bands', lut
// (768 bytes), density, offset, inside: [r,g,b] }; mu from smoothMu or the
// integer count; returns [r, g, b].
export function colorOf(mu, P) {
  if (P.color === 'mono') return mu < 0 ? [255, 192, 0] : [0, 0, 0];
  if (mu < 0) return P.inside;
  if (P.color === 'gradient') return gradientColor(Math.floor(mu), 20);
  // log scale: near the set mu grows fast, and a linear map aliases to noise
  let t = Math.log(1 + mu) * P.density / 24 + P.offset;
  if (P.color === 'bands') t = Math.floor(t * 12) / 12;
  t -= Math.floor(t);
  if (P.mirror) t = 1 - Math.abs(2 * t - 1);
  const q = (t * 255 | 0) * 3, L = P.lut;
  return [L[q], L[q + 1], L[q + 2]];
}

// c along a path, u in turns (0..1 is once round). k scales the boundary
// paths (k < 1 inside the set: connected Julia sets; k > 1 outside: dust).
export const PATHS = ['still', 'circle', 'cardioid', 'bulb', 'lissajous', 'wander'];
export function cAt(path, u, o = {}) {
  const th = 2 * Math.PI * u, k = o.k ?? 1;
  switch (path) {
    case 'circle': { const R = (o.R ?? 0.7885) * k; return [R * Math.cos(th), R * Math.sin(th)]; }
    // c = lambda/2 - lambda^2/4 with lambda = k e^(i theta): the fixed point
    // multiplier; |lambda| < 1 is inside the main cardioid
    case 'cardioid': return [0.5 * k * Math.cos(th) - 0.25 * k * k * Math.cos(2 * th), 0.5 * k * Math.sin(th) - 0.25 * k * k * Math.sin(2 * th)];
    case 'bulb': return [-1 + 0.25 * k * Math.cos(th), 0.25 * k * Math.sin(th)];
    case 'lissajous': return [-0.3 + 0.55 * k * Math.sin(3 * th + 0.5), 0.6 * k * Math.sin(2 * th)];
    case 'wander': {
      // the cardioid boundary with a slow wobble in and out of the set
      const w = th + 0.6 * Math.sin(3.1 * th + 1.3) + 0.3 * Math.sin(7.3 * th);
      const kk = k * (1 + 0.04 * Math.sin(5.7 * th));
      return [0.5 * kk * Math.cos(w) - 0.25 * kk * kk * Math.cos(2 * w), 0.5 * kk * Math.sin(w) - 0.25 * kk * kk * Math.sin(2 * w)];
    }
    default: return [o.cx ?? -0.6258, o.cy ?? 0.4025];
  }
}

// Named spots for the Mandelbrot zooms: centre and the view height at the
// bottom of the dive. 'upstream' is the deep point in 19-julia.html.
export const SPOTS = [
  { id: 'seahorse', name: 'Seahorse valley', x: -0.743643887037151, y: 0.13182590420533, depth: 2e-4 },
  { id: 'elephant', name: 'Elephant valley', x: 0.282, y: 0.0101, depth: 1.5e-2 },
  { id: 'spiral', name: 'Triple spiral', x: -0.0884055, y: 0.6545106, depth: 4e-4 },
  { id: 'needle', name: 'The needle', x: -1.7499, y: 0.0, depth: 1e-3 },
  { id: 'upstream', name: 'Upstream deep point', x: -0.8115734686602871, y: -0.20143013094290876, depth: 3e-4 },
  { id: 'mini', name: 'Mini Mandelbrot', x: -1.7686, y: 0.00173, depth: 2e-3 },
];

// Render into an RGBA buffer (W x H) at block size k (progressive: 4, 2, 1).
// V = { cx, cy, scale (units per pixel), mandel, c: [x, y], iters, power }.
export function renderCPU(buf, W, H, V, P, k = 1) {
  const s = V.scale;
  for (let j = 0; j < H; j += k) {
    const y = V.cy + (H / 2 - j - k / 2) * s;
    for (let i = 0; i < W; i += k) {
      const x = V.cx + (i + k / 2 - W / 2) * s;
      const mu = V.mandel ? smoothMu(0, 0, x, y, V.iters, V.power) : smoothMu(x, y, V.c[0], V.c[1], V.iters, V.power);
      const col = colorOf(P.color === 'gradient' || P.color === 'mono' ? (mu < 0 ? -1 : Math.floor(mu)) : mu, P);
      for (let jj = j; jj < Math.min(H, j + k); jj++) for (let ii = i; ii < Math.min(W, i + k); ii++) {
        const o = (jj * W + ii) * 4; buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2]; buf[o + 3] = 255;
      }
    }
  }
}

// GLSL ES 3.00 fragment shader of the same colouring (gl.js).
export const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uScale;
uniform vec2 uC;
uniform int uIters;
uniform int uMandel;
uniform float uPower;
uniform int uColor;
uniform float uDensity;
uniform float uOffset;
uniform int uMirror;
uniform vec3 uInside;
uniform sampler2D uLut;
out vec4 outColor;
vec3 grad(int i) {
  if (i == 0) return vec3(15.0, 2.0, 66.0);
  if (i == 1) return vec3(191.0, 41.0, 12.0);
  if (i == 2) return vec3(222.0, 99.0, 11.0);
  if (i == 3) return vec3(229.0, 208.0, 14.0);
  if (i == 4) return vec3(255.0, 255.0, 255.0);
  if (i == 5) return vec3(102.0, 173.0, 183.0);
  return vec3(14.0, 29.0, 104.0);
}
void main() {
  vec2 p = uCenter + (gl_FragCoord.xy - 0.5 * uRes) * uScale;
  vec2 z = (uMandel == 1) ? vec2(0.0) : p;
  vec2 c = (uMandel == 1) ? p : uC;
  float mu = -1.0;
  for (int n = 0; n < 4000; n++) {
    if (n >= uIters) { break; }
    float r2 = dot(z, z);
    if (r2 > 256.0) { mu = float(n) + 1.0 - log(0.5 * log(r2) / log(2.0)) / log(uPower); break; }
    if (uPower == 2.0) { z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c; }
    else { float r = pow(r2, 0.5 * uPower); float a = atan(z.y, z.x) * uPower; z = vec2(r * cos(a), r * sin(a)) + c; }
  }
  vec3 col;
  if (uColor == 0) {
    col = (mu < 0.0) ? vec3(1.0, 192.0 / 255.0, 0.0) : vec3(0.0);
  } else if (mu < 0.0) {
    col = uInside;
  } else if (uColor == 1) {
    int nr = int(floor(mu));
    int c0 = (nr / 20) - 7 * ((nr / 20) / 7);
    int c1 = (c0 + 1) - 7 * ((c0 + 1) / 7);
    float st = float(nr - 20 * (nr / 20)) / 20.0;
    col = floor(mix(grad(c0), grad(c1), st)) / 255.0;
  } else {
    float t = log(1.0 + mu) * uDensity / 24.0 + uOffset;
    if (uColor == 3) { t = floor(t * 12.0) / 12.0; }
    t = fract(t);
    if (uMirror == 1) { t = 1.0 - abs(2.0 * t - 1.0); }
    col = texture(uLut, vec2((t * 255.0 + 0.5) / 256.0, 0.5)).rgb;
  }
  outColor = vec4(col, 1.0);
}
`;
export const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;
