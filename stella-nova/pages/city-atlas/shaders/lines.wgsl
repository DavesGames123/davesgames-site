// lines.wgsl — draws the tracer trails of tracers.wgsl as screen-space quads
// (common.wgsl in front). Same buffers, bound read-only.
//
// Each instance is one particle, each 6 vertices one segment between two
// ring points, oldest to newest. A segment is a quad T.lineW CSS px wide,
// lifted T.lift m over the drawn surface, so it follows the terrain at any
// exaggeration. Alpha rises toward the head; blending is additive.
//
// grep: struct TrailU  fn vsLine  fn fsLine

struct TrailU {
  count: u32, K: u32, head: u32, seed: u32,
  dt: f32, mode: u32, nInner: u32, reseed: u32,
  speedup: f32, lift: f32, lineW: f32, alpha: f32,
  innerR: f32, outerR: f32, colourTop: f32, lifeS: f32,
};

@group(2) @binding(0) var<uniform> T: TrailU;
@group(2) @binding(1) var<storage, read> trail: array<vec4f>;   // x, y, speed m/s, alive

struct LOut {
  @builtin(position) pos: vec4f,
  @location(0) col: vec4f,
  @location(1) across: f32,
};

@vertex
fn vsLine(@builtin(vertex_index) vid: u32, @builtin(instance_index) inst: u32) -> LOut {
  var o: LOut;
  let seg = vid / 6u;
  let corner = vid % 6u;
  let base = inst * T.K;
  let ia = (T.head + 1u + seg) % T.K;
  let ib = (T.head + 2u + seg) % T.K;
  let a = trail[base + ia];
  let b = trail[base + ib];
  let alive = a.w * b.w;
  let za = surfaceZ(a.xy) + T.lift;
  let zb = surfaceZ(b.xy) + T.lift;
  let ca = G.viewProj * vec4f(a.xy, za, 1.0);
  let cb = G.viewProj * vec4f(b.xy, zb, 1.0);
  let useB = corner == 1u || corner == 2u || corner == 4u;
  let side = select(-1.0, 1.0, corner == 2u || corner == 4u || corner == 5u);
  var c = select(ca, cb, useB);
  let sa = ca.xy / max(ca.w, 1e-4) * G.res.xy;
  let sb = cb.xy / max(cb.w, 1e-4) * G.res.xy;
  var d = sb - sa;
  if (dot(d, d) < 1e-6) { d = vec2f(1.0, 0.0); }
  let nrm = normalize(vec2f(-d.y, d.x));
  let wpx = T.lineW * G.res.z;
  c = vec4f(c.xy + nrm * side * wpx / G.res.xy * c.w, c.zw);
  if (ca.w <= 0.0 || cb.w <= 0.0 || alive < 0.5) { c = vec4f(0.0, 0.0, -2.0, 1.0); }
  o.pos = c;
  let j = f32(seg + select(0u, 1u, useB)) / f32(T.K - 1u);
  let sp = select(a.z, b.z, useB);
  // wind: square-root colour scale, as the heat map (terrain.wgsl)
  var cs = sp / max(T.colourTop, 0.01);
  if (T.mode == 1u) { cs = sqrt(cs); }
  let tcol = ramp(cs);
  var alpha = pow(j, 1.6) * T.alpha;
  if (T.mode == 0u) { alpha *= O.ocean.x; } else { alpha *= O.wind.x * windAt(select(a.xy, b.xy, useB)).w; }
  o.col = vec4f(mix(tcol, vec3f(1.0), 0.25 * j), alpha);
  o.across = side;
  return o;
}

@fragment
fn fsLine(v: LOut) -> @location(0) vec4f {
  let edge = 1.0 - smoothstep(0.35, 1.0, abs(v.across));
  let a = v.col.a * edge;
  return vec4f(v.col.rgb * a, a);
}
