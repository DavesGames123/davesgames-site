// sky.wgsl — the sky behind the scene (common.wgsl in front).
//
// One full-screen triangle at the far plane (reversed depth: z = 0). The
// fragment shader rebuilds the view ray from G.invViewProj and mixes the
// horizon and zenith colours, a sun glow, and stars after dusk.
//
// grep: fn vs  fn fs

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) ndc: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
  var o: VOut;
  o.pos = vec4f(p, 0.0, 1.0);
  o.ndc = p;
  return o;
}

@fragment
fn fs(v: VOut) -> @location(0) vec4f {
  let a = G.invViewProj * vec4f(v.ndc, 1.0, 1.0);
  let b = G.invViewProj * vec4f(v.ndc, 0.0001, 1.0);
  let dir = normalize(b.xyz / b.w - a.xyz / a.w);
  let up = clamp(dir.z, -1.0, 1.0);
  let t = pow(clamp(up, 0.0, 1.0), 0.45);
  var col = mix(G.skyH.rgb, G.skyZ.rgb, t);
  if (up < 0.0) { col = G.skyH.rgb * (1.0 + up * 0.3); }
  let L = normalize(G.sun.xyz);
  let s = max(dot(dir, L), 0.0);
  col += G.sunCol.rgb * (pow(s, 600.0) * 2.5 + pow(s, 12.0) * 0.18) * (1.0 - G.sun.w * 0.8);
  if (G.sun.w > 0.0 && up > 0.0) {
    let h = hashCell(floor(dir * 420.0), 97u);
    col += vec3f(0.9, 0.93, 1.0) * G.sun.w * smoothstep(0.9975, 1.0, h) * smoothstep(0.0, 0.25, up) * 0.8;
  }
  return vec4f(col, 1.0);
}
