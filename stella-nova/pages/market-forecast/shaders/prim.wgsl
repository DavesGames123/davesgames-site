// ============================================================================
//  PRIM  ·  market-forecast/shaders/prim.wgsl — the one chart shader
// ----------------------------------------------------------------------------
//  gfx.js builds every mark of a chart (candles, bands, lines, bars, grid)
//  as triangles in device pixels, on the CPU. Each vertex has:
//    p  position in device px
//    e  x: 1 if the reveal mask applies, else 0
//       y: edge coordinate across a line, -1..1 (0 for a fill)
//       z: soft width as a fraction of the half width (anti-alias or glow)
//       w: brightness gain at the reveal front (0 = none)
//    c  straight-alpha colour
//  The reveal mask hides a forecast past the front x, with a soft edge,
//  so a fan "unfurls" from the origin. The output is premultiplied: the
//  "alpha" pipeline blends with one / one-minus-src-alpha, the "add"
//  pipeline (glows) with one / one.
// ============================================================================
struct U {
  size   : vec2f,   // target size, device px
  reveal : vec2f,   // reveal x0 (origin) and x1 (end), device px
  prog   : f32,     // reveal progress 0..1
  time   : f32,     // seconds
  pad    : vec2f,
};
@group(0) @binding(0) var<uniform> u : U;

struct VO {
  @builtin(position) pos : vec4f,
  @location(0) e : vec4f,
  @location(1) c : vec4f,
};

@vertex
fn vs(@location(0) p : vec2f, @location(1) e : vec4f, @location(2) c : vec4f) -> VO {
  var o : VO;
  o.pos = vec4f(p.x / u.size.x * 2.0 - 1.0, 1.0 - p.y / u.size.y * 2.0, 0.0, 1.0);
  o.e = e;
  o.c = c;
  return o;
}

@fragment
fn fs(in : VO) -> @location(0) vec4f {
  var a = in.c.a;
  var rgb = in.c.rgb;
  // Edge fade across a line: full inside 1 - soft, zero at the edge.
  let ed = abs(in.e.y);
  let soft = max(in.e.z, 1e-3);
  a = a * (1.0 - smoothstep(1.0 - soft, 1.0, ed));
  if (in.e.x > 0.5) {
    let front = mix(u.reveal.x, u.reveal.y, u.prog);
    let x = in.pos.x;
    a = a * (1.0 - smoothstep(front - 10.0, front, x));
    // A soft light at the front while the fan grows.
    let d = (front - x) / 26.0;
    let lit = exp(-(d * d)) * in.e.w * (1.0 - u.prog * u.prog);
    rgb = rgb + vec3f(lit * 0.55);
    a = min(1.0, a * (1.0 + lit * 0.8));
  }
  return vec4f(rgb * a, a);
}
