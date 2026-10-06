// ============================================================================
//  HALFTONE  ·  shaders/halftone.wgsl — the WGSL port of glsl-halftone
// ----------------------------------------------------------------------------
//  A line-for-line port of glsl-halftone 1.0.4 (glslify/stackgl, MIT, see
//  ../LICENSE-glsl-halftone.txt) and of the two modules that it requires:
//  glsl-noise simplex/2d (Ian McEwan, Ashima Arts, MIT, see
//  ../LICENSE-webgl-noise.txt; it has the 2011 permutation +1.0, not the
//  +10.0 of the later webgl-noise) and glsl-aastep (stackgl, MIT). The halftone
//  method is by Stefan Gustavson (public domain, his WebGL shader tutorial).
//  The maths, the constants and the order of operations are the upstream
//  ones. Only the syntax changes. ../halftone-ref.js is the CPU twin, and
//  ../tests.mjs compares this file with that twin and with the upstream
//  GLSL in WebGL.
//
//  PORTS  (upstream GLSL function -> WGSL function)
//    glsl-noise/simplex/2d.glsl  vec3 mod289(vec3) ......... mod289_3
//    glsl-noise/simplex/2d.glsl  vec2 mod289(vec2) ......... mod289_2
//    glsl-noise/simplex/2d.glsl  vec3 permute(vec3) ........ permute3
//    glsl-noise/simplex/2d.glsl  float snoise(vec2) ........ snoise
//    glsl-aastep/index.glsl      float aastep(float, float)  aastep
//                                (the GL_OES_standard_derivatives branch:
//                                dFdx, dFdy -> dpdx, dpdy)
//    glsl-halftone/index.glsl    vec3 halftone(vec3, vec2, float)  halftone
//    glsl-halftone/index.glsl    vec3 halftone(vec3, vec2) ......  halftone30
//  WGSL has no overloads, so the two-argument halftone and the vec2 and vec3
//  mod289 get their own names.
//
//  MATRICES. GLSL mat2(a, b, c, d) and WGSL mat2x2f(a, b, c, d) both fill
//  the columns first, so the four screen matrices keep their upstream
//  argument order. The screen angles are K 45, C 15, M 75 (-15), Y 0 degrees.
//
//  UNIFORMITY. aastep calls dpdx and dpdy. Call halftone only in uniform
//  control flow (no branch on a per-pixel value before the call).
//
//  grep -n: "fn snoise"  "fn aastep"  "fn halftone("  "fn halftone30"
// ============================================================================

fn mod289_3(x: vec3f) -> vec3f {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

fn mod289_2(x: vec2f) -> vec2f {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

fn permute3(x: vec3f) -> vec3f {
  return mod289_3(((x * 34.0) + 1.0) * x);
}

fn snoise(v: vec2f) -> f32 {
  let C = vec4f(0.211324865405187,    // (3.0-sqrt(3.0))/6.0
                0.366025403784439,    // 0.5*(sqrt(3.0)-1.0)
               -0.577350269189626,    // -1.0 + 2.0 * C.x
                0.024390243902439);   // 1.0 / 41.0
  // First corner
  var i = floor(v + dot(v, C.yy));
  let x0 = v - i + dot(i, C.xx);

  // Other corners
  let i1 = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), x0.x > x0.y);
  var x12 = x0.xyxy + C.xxzz;
  x12 = vec4f(x12.xy - i1, x12.zw);

  // Permutations
  i = mod289_2(i);   // Avoid truncation effects in permutation
  let p = permute3(permute3(i.y + vec3f(0.0, i1.y, 1.0))
    + i.x + vec3f(0.0, i1.x, 1.0));

  var m = max(0.5 - vec3f(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), vec3f(0.0));
  m = m * m;
  m = m * m;

  // Gradients: 41 points uniformly over a line, mapped onto a diamond.
  // The ring size 17*17 = 289 is close to a multiple of 41 (41*7 = 287)
  let x = 2.0 * fract(p * C.www) - 1.0;
  let h = abs(x) - 0.5;
  let ox = floor(x + 0.5);
  let a0 = x - ox;

  // Normalise gradients implicitly by scaling m
  // Approximation of: m *= inversesqrt( a0*a0 + h*h );
  m = m * (1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h));

  // Compute final noise value at P
  var g: vec3f;
  g.x = a0.x * x0.x + h.x * x0.y;
  g = vec3f(g.x, a0.yz * x12.xz + h.yz * x12.yw);
  return 130.0 * dot(m, g);
}

fn aastep(threshold: f32, value: f32) -> f32 {
  let afwidth = length(vec2f(dpdx(value), dpdy(value))) * 0.70710678118654757;
  return smoothstep(threshold - afwidth, threshold + afwidth, value);
}

fn halftone(texcolor: vec3f, st: vec2f, frequency: f32) -> vec3f {
  var n = 0.1 * snoise(st * 200.0);   // Fractal noise
  n += 0.05 * snoise(st * 400.0);
  n += 0.025 * snoise(st * 800.0);
  let white = vec3f(n * 0.2 + 0.97);   // upstream computes it and does not use it
  let black = vec3f(n + 0.1);

  // Perform a rough RGB-to-CMYK conversion
  var cmyk = vec4f(1.0 - texcolor, 0.0);   // cmyk.xyz = 1.0 - texcolor;
  cmyk.w = min(cmyk.x, min(cmyk.y, cmyk.z));   // Create K
  cmyk = vec4f(cmyk.xyz - cmyk.w, cmyk.w);     // Subtract K equivalent from CMY

  // Distance to nearest point in a grid of
  // (frequency x frequency) points over the unit square
  let Kst = frequency * mat2x2f(0.707, -0.707, 0.707, 0.707) * st;
  let Kuv = 2.0 * fract(Kst) - 1.0;
  let k = aastep(0.0, sqrt(cmyk.w) - length(Kuv) + n);
  let Cst = frequency * mat2x2f(0.966, -0.259, 0.259, 0.966) * st;
  let Cuv = 2.0 * fract(Cst) - 1.0;
  let c = aastep(0.0, sqrt(cmyk.x) - length(Cuv) + n);
  let Mst = frequency * mat2x2f(0.966, 0.259, -0.259, 0.966) * st;
  let Muv = 2.0 * fract(Mst) - 1.0;
  let m = aastep(0.0, sqrt(cmyk.y) - length(Muv) + n);
  let Yst = frequency * st;   // 0 deg
  let Yuv = 2.0 * fract(Yst) - 1.0;
  let y = aastep(0.0, sqrt(cmyk.z) - length(Yuv) + n);

  let rgbscreen = 1.0 - 0.9 * vec3f(c, m, y) + n;
  _ = white;
  return mix(rgbscreen, black, vec3f(0.85 * k + 0.3 * n));
}

fn halftone30(texcolor: vec3f, st: vec2f) -> vec3f {
  return halftone(texcolor, st, 30.0);
}
