// ============================================================================
//  MATERIAL STUDIO  ·  shaders/bake-util.wgsl — mip chain for baked maps
// ────────────────────────────────────────────────────────────────────────────
//  bake.js draws one full-screen triangle per mip level. The source view is
//  the level above; one bilinear sample at the center of each 2x2 block is a
//  box filter. fs_mipn renormalizes encoded normals (n*0.5+0.5).
//
//  ENTRY POINTS  (grep -n the name to jump)
//      vs ........ full-screen triangle
//      fs_mip .... 2x2 box average
//      fs_mipn ... 2x2 box average, then renormalize the decoded normal
// ============================================================================
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let x = f32((i << 1u) & 2u);
  let y = f32(i & 2u);
  return vec4f((x * 2.0) - 1.0, 1.0 - (y * 2.0), 0.0, 1.0);
}

@fragment
fn fs_mip(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let dim = vec2f(textureDimensions(src, 0));
  return textureSampleLevel(src, smp, (p.xy * 2.0) / dim, 0.0);
}

@fragment
fn fs_mipn(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let dim = vec2f(textureDimensions(src, 0));
  let c = textureSampleLevel(src, smp, (p.xy * 2.0) / dim, 0.0);
  let n = normalize((c.xyz * 2.0) - vec3f(1.0));
  return vec4f((n * 0.5) + vec3f(0.5), 1.0);
}
