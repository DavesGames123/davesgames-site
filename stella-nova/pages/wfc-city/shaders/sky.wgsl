// ============================================================================
//  COLLAPSE CITY  ·  shaders/sky.wgsl — the sky behind the city
// ----------------------------------------------------------------------------
//  One full-screen triangle at depth 0 (reversed depth: the far plane).
//  The depth test "greater-equal" keeps it only where no city was drawn.
//  Needs common.wgsl in front of it.
// ============================================================================

struct SkyOut {
  @builtin(position) pos: vec4f,
  @location(0) ndc: vec2f,
};

@vertex
fn vs_sky(@builtin(vertex_index) vi: u32) -> SkyOut {
  let x = f32((vi << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vi & 2u) * 2.0 - 1.0;
  var o: SkyOut;
  o.pos = vec4f(x, y, 0.0, 1.0);
  o.ndc = vec2f(x, y);
  return o;
}

@fragment
fn fs_sky(i: SkyOut) -> @location(0) vec4f {
  let p = frame.invViewProj * vec4f(i.ndc, 1.0, 1.0);
  let d = normalize(p.xyz / p.w - frame.camPos.xyz);
  var c = skyColor(d);
  // a few stars at night
  let night = frame.sunDir.w;
  if (night > 0.01 && d.y > 0.0) {
    let g = floor(d * 420.0);
    let hsh = fract(sin(dot(g, vec3f(12.9898, 78.233, 37.719))) * 43758.5453);
    let star = step(0.9975, hsh) * night * smoothstep(0.0, 0.25, d.y);
    c = c + vec3f(star * 0.8);
  }
  return vec4f(tonemap(c), 1.0);
}
