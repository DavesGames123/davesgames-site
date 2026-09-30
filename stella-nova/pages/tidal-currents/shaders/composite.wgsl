// composite.wgsl — the lit image, the bloom source and the final pass.
//
// lit(uv) = ramp(T) * brightness(speed) * (base glow + trail density) * mask.
// fsBright draws the bloom source at low resolution: the mean of 4 lit
// samples (a 4x4 box of screen pixels at 1/4 res), with a soft threshold.
// fsMeter draws a 64x64 exposure meter (see the end of this file).
// fsFinal draws the canvas: lit + bloom, a soft tone map, a thin gray coast
// line from the mask, a soft vignette at the edges and a small dither.
// The mask (mask.png, or base.R for a v1 dataset) sets the visible coast.

struct CompU {
  size: vec2f,       // canvas pixels
  legendF: vec2f,    // deg F at ramp 0 and ramp 1
  speedRef: f32,
  trailGain: f32,
  baseGlow: f32,
  exposure: f32,
  frame: f32,
  coast: f32,        // coast line gray level
  vignette: f32,     // edge vignette strength
  brightFloor: f32,  // brightness of still water
  brightGamma: f32,  // brightness = floor + (1 - floor) * speed^gamma
  white: f32,        // how far the brightest water moves toward white
  hairWhite: f32,    // how far a dense trail moves toward white
  pastel: f32,       // how far every water color moves toward white
  speedWhite: f32,   // extra move toward white, times (speed / speedRef)^2
  maskW: f32,        // mask texture width in pixels
  hairGain: f32,     // weight of the trail density in the lit image
  bloom: f32,        // bloom strength in fsFinal
  bloomThreshold: f32,
  bloomTexel: f32,   // bloom source texel in screen pixels (4 for 1/4 res)
  bloomLand: f32,    // bloom kept over land (0..1), a soft halo at the coast
  view: vec4f,       // x0, y0, x1, y1 of the view rect in extent coordinates
};

@group(0) @binding(0) var<uniform> C: CompU;
@group(0) @binding(1) var field: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var trail: texture_2d<f32>;
@group(0) @binding(4) var ramp: texture_2d<f32>;
@group(0) @binding(5) var mask: texture_2d<f32>;
@group(0) @binding(6) var bloomTex: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn hash2(p: vec2f) -> f32 {
  let q = fract(p * vec2f(0.1031, 0.1030));
  let r = q + dot(q, q.yx + 33.33);
  return fract((r.x + r.y) * r.x);
}

fn toExtent(uv: vec2f) -> vec2f {
  return mix(C.view.xy, C.view.zw, uv);
}

fn coverage(uv: vec2f) -> f32 {
  return textureSampleLevel(mask, samp, toExtent(uv), 0.0).r;
}

// Lit water color at screen point uv, before the tone map. covMask is the
// visible coverage (0 on land).
fn lit(uv: vec2f, covMask: f32) -> vec3f {
  let f = textureSampleLevel(field, samp, toExtent(uv), 0.0);
  let spd = clamp(length(f.xy) / C.speedRef, 0.0, 1.6);
  let tF = f.z * 1.8 + 32.0;
  let tn = clamp((tF - C.legendF.x) / (C.legendF.y - C.legendF.x), 0.0, 1.0);
  let col = textureSampleLevel(ramp, samp, vec2f(tn * (255.0 / 256.0) + 0.5 / 256.0, 0.5), 0.0).rgb;
  let tr = textureSampleLevel(trail, samp, uv, 0.0).r;
  let dens = 1.0 - exp(-tr * C.trailGain);
  let bright = C.brightFloor + (1.0 - C.brightFloor) * pow(spd, C.brightGamma);
  // Pastel: move the ramp color toward white, more for fast water.
  let pc = mix(col, vec3f(1.0), clamp(C.pastel + C.speedWhite * spd * spd, 0.0, 0.85));
  let hair = mix(pc, vec3f(1.0), dens * C.hairWhite);
  return bright * (pc * C.baseGlow + hair * dens * C.hairGain) * C.exposure * covMask;
}

@fragment
fn fsBright(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let bs = C.size / C.bloomTexel;          // bloom target size
  let uv = fc.xy / bs;
  let d = 0.25 / bs;                        // a quarter bloom texel
  var e = vec3f(0.0);
  for (var i = 0; i < 4; i++) {
    let o = vec2f(select(-d.x, d.x, (i & 1) == 1), select(-d.y, d.y, (i & 2) == 2));
    e += lit(uv + o, clamp(coverage(uv + o), 0.0, 1.0));
  }
  e *= 0.25;
  let lum = dot(e, vec3f(0.3, 0.55, 0.15));
  let w = max(lum - C.bloomThreshold, 0.0) / max(lum, 1e-4);
  return vec4f(e * w, 1.0);
}

@fragment
fn fsFinal(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / C.size;
  let cov = coverage(uv);
  // Screen-space gradient of the coverage gives the distance (in pixels) to
  // the 0.5 contour, so the coast line has the same width at all sizes.
  let g = length(vec2f(dpdx(cov), dpdy(cov)));
  let dCoast = abs(cov - 0.5) / max(g, 1e-4);
  // The gradient per mask pixel tells a sharp coast (about 0.3 or more) from
  // a soft fade of the coverage (for example 1/40 at a model boundary).
  let gMask = g * C.size.x / (C.maskW * (C.view.z - C.view.x));
  let sharp = smoothstep(0.08, 0.2, gMask);
  let covMask = mix(clamp(cov, 0.0, 1.0), smoothstep(0.3, 0.7, cov), sharp);

  var e = lit(uv, covMask);
  e += textureSampleLevel(bloomTex, samp, uv, 0.0).rgb * C.bloom * mix(C.bloomLand, 1.0, clamp(cov, 0.0, 1.0));
  // Tone map: soft shoulder per channel, then lift bright water toward white.
  let lum = dot(e, vec3f(0.3, 0.55, 0.15));
  var c = vec3f(1.0) - exp(-e);
  c = mix(c, vec3f(1.0), smoothstep(0.9, 3.0, lum) * C.white);

  // Faint coast line on sharp coasts.
  let line = (1.0 - smoothstep(0.4, 1.3, dCoast)) * sharp * C.coast;
  c = max(c, vec3f(line));

  // Soft vignette at the canvas edges.
  let edge = min(min(uv.x, 1.0 - uv.x) * C.size.x, min(uv.y, 1.0 - uv.y) * C.size.y) / min(C.size.x, C.size.y);
  let vig = mix(1.0, smoothstep(0.0, 0.06, edge), C.vignette);
  let rad = length((uv - 0.5) * vec2f(1.0, 0.85));
  c *= vig * (1.0 - C.vignette * 0.22 * smoothstep(0.45, 0.8, rad));

  c += (hash2(fc.xy + C.frame * 17.0) - 0.5) / 255.0;
  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), 1.0);
}

// Exposure meter: one lit sample per texel of a small target. The output is
// (luminance * coverage, coverage). The engine reads the target back and
// divides the two sums to get the mean lit luminance over water.
@fragment
fn fsMeter(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / vec2f(64.0, 64.0);
  let cov = clamp(coverage(uv), 0.0, 1.0);
  let e = lit(uv, cov);
  let lum = dot(e, vec3f(0.3, 0.55, 0.15));
  return vec4f(lum, cov, 0.0, 1.0);
}
