// ============================================================================
//  MATERIAL STUDIO  ·  shaders/panels-thumb.wgsl — map strip thumbnails
// ────────────────────────────────────────────────────────────────────────────
//  Owner: PANELS agent (panels.js renderTiles). One full-screen triangle per
//  tile; the viewport rectangle picks the tile in an rgba8unorm atlas, which
//  panels.js reads back into 2D canvases.
//  Each output texel averages a 4x4 grid of bilinear taps over its footprint,
//  so a 4096 map shrinks to 128 px without heavy aliasing.
//
//  MODES  (u.mode)
//      0  rgb, linear to sRGB        base color
//      1  rgb as stored              encoded normal map
//      2  one channel, gray          dot(texel, u.mask): ao, roughness, ...
//      3  rgb * gain, soft clip, sRGB  emissive
// ============================================================================

struct U {
  mask: vec4f,   // channel mask for mode 2
  mode: u32,
  gain: f32,     // emissive strength for mode 3
  fp: f32,       // footprint of one output texel, in uv units
  tpp: f32,      // source texels per output texel (informative)
};

@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: U;

struct VO {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VO {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VO;
  o.pos = vec4f(p[i], 0.0, 1.0);
  // uv origin is the top-left of the map; +v goes down the image
  o.uv = vec2f((p[i].x + 1.0) * 0.5, (1.0 - p[i].y) * 0.5);
  return o;
}

fn to_srgb(c: vec3f) -> vec3f {
  let x = clamp(c, vec3f(0.0), vec3f(1.0));
  let lo = x * 12.92;
  let hi = (1.055 * pow(x, vec3f(1.0 / 2.4))) - vec3f(0.055);
  return select(hi, lo, x <= vec3f(0.0031308));
}

@fragment
fn fs(i: VO) -> @location(0) vec4f {
  var acc = vec4f(0.0);
  for (var y = 0; y < 4; y++) {
    for (var x = 0; x < 4; x++) {
      let o = ((vec2f(f32(x), f32(y)) + vec2f(0.5)) / 4.0) - vec2f(0.5);
      acc += textureSampleLevel(tex, samp, i.uv + (o * u.fp), 0.0);
    }
  }
  let s = acc / 16.0;
  var c = vec3f(0.0);
  if (u.mode == 0u) {
    c = to_srgb(s.rgb);
  } else if (u.mode == 1u) {
    c = clamp(s.rgb, vec3f(0.0), vec3f(1.0));
  } else if (u.mode == 2u) {
    c = vec3f(clamp(dot(s, u.mask), 0.0, 1.0));
  } else {
    let e = max(s.rgb * u.gain, vec3f(0.0));
    c = to_srgb(vec3f(1.0) - exp(-e));
  }
  return vec4f(c, 1.0);
}
