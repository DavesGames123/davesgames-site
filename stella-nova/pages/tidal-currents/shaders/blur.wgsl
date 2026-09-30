// blur.wgsl — one direction of a separable Gaussian blur, for the bloom.
//
// B.dir is one texel step (in uv) along x or y. The pass takes 2 * radius + 1
// taps with Gaussian weights (sigma = radius / 2) and normalizes the sum.

struct BlurU {
  dir: vec2f,
  radius: f32,
  pad: f32,
};

@group(0) @binding(0) var<uniform> B: BlurU;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / vec2f(textureDimensions(src));
  let r = i32(B.radius);
  let s2 = 2.0 * (B.radius * 0.5) * (B.radius * 0.5);
  var acc = vec3f(0.0);
  var wsum = 0.0;
  for (var i = -r; i <= r; i++) {
    let w = exp(-f32(i * i) / s2);
    acc += textureSampleLevel(src, samp, uv + B.dir * f32(i), 0.0).rgb * w;
    wsum += w;
  }
  return vec4f(acc / wsum, 1.0);
}
