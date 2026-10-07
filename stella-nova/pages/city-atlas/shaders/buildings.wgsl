// buildings.wgsl — extruded buildings (common.wgsl in front).
//
// mesh.js builds the walls and the roofs. One vertex is 20 bytes:
//   pos   sint16x4  x, y in 0.5 m; z above the base in 0.1 m; u along the wall in 0.5 m
//   bat   sint16x2  base height in 0.1 m (lowest ground under the footprint), building height in 0.1 m
//   nrm   snorm8x4  normal xyz, 0
//   attr  unorm8x4  use class / 255, random 0..1, roof 1 / wall 0, height estimated 1 / tagged 0
// The base follows the terrain overlay: z = base * E + z above base. So a
// building stands on the same exaggerated surface as the ground.
// Colour: by height (G.res.w 0) or by use (1). After dusk the walls get lit
// windows: one cell per floor (3.5 m) and per 3 m of wall, picked by a hash.
//
// grep: fn vs  fn vsShadow  fn heightColour  fn useColour  fn fs

struct VIn {
  @location(0) pos: vec4i,
  @location(1) bat: vec2i,
  @location(2) nrm: vec4f,
  @location(3) attr: vec4f,
};

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) n: vec3f,
  @location(2) @interpolate(flat) info: vec4f,   // height m, use class, random, estimated
  @location(3) wall: vec3f,                     // z above base, u along wall, roof
};

@vertex
fn vs(v: VIn) -> VOut {
  let xy = vec2f(v.pos.xy) * 0.5;
  let zr = f32(v.pos.z) * 0.1;
  let base = f32(v.bat.x) * 0.1;
  var o: VOut;
  // A wall foot goes 6 m below the base, so a slope never shows a gap.
  let foot = select(0.0, 6.0, v.pos.z == 0 && v.attr.z < 0.5);
  let z = base * exag() + zr - foot;
  o.world = vec3f(xy, z);
  o.pos = G.viewProj * vec4f(xy, z, 1.0);
  o.n = v.nrm.xyz;
  o.info = vec4f(f32(v.bat.y) * 0.1, round(v.attr.x * 255.0), v.attr.y, v.attr.w);
  o.wall = vec3f(zr, f32(v.pos.w) * 0.5, v.attr.z);
  return o;
}

// The shadow pass: the same building, seen from the sun.
@vertex
fn vsShadow(v: VIn) -> @builtin(position) vec4f {
  let xy = vec2f(v.pos.xy) * 0.5;
  let z = f32(v.bat.x) * 0.1 * exag() + f32(v.pos.z) * 0.1;
  return G.lightVP * vec4f(xy, z, 1.0);
}

fn heightColour(h: f32) -> vec3f {
  let t = clamp(log2(max(h, 3.0) / 6.0) / log2(60.0), 0.0, 1.0);   // 6 m .. 360 m
  let a = vec3f(0.42, 0.45, 0.50);
  let b = vec3f(0.48, 0.58, 0.70);
  let c = vec3f(0.80, 0.74, 0.62);
  let d = vec3f(0.98, 0.84, 0.60);
  if (t < 0.4) { return mix(a, b, t / 0.4); }
  if (t < 0.75) { return mix(b, c, (t - 0.4) / 0.35); }
  return mix(c, d, (t - 0.75) / 0.25);
}

fn useColour(k: f32) -> vec3f {
  let i = u32(k) & 15u;
  switch i {
    case 1u: { return vec3f(0.82, 0.66, 0.50); }   // residential
    case 2u: { return vec3f(0.48, 0.66, 0.84); }   // commercial and office
    case 3u: { return vec3f(0.62, 0.56, 0.68); }   // industrial
    case 4u: { return vec3f(0.56, 0.78, 0.62); }   // civic, education, medical
    case 5u: { return vec3f(0.92, 0.80, 0.48); }   // religious
    case 6u: { return vec3f(0.70, 0.70, 0.74); }   // transport
    case 7u: { return vec3f(0.86, 0.56, 0.58); }   // entertainment
    default: { return vec3f(0.60, 0.61, 0.63); }   // unknown
  }
}

@fragment
fn fs(v: VOut) -> @location(0) vec4f {
  let L = normalize(G.sun.xyz);
  let night = G.sun.w;
  let N = normalize(v.n);
  var alb = mix(heightColour(v.info.x), useColour(v.info.y), G.res.w);
  alb *= 0.9 + 0.2 * v.info.z;
  let roof = v.wall.z > 0.5;
  if (roof) { alb *= 0.82; }
  // after dusk the city glow keeps the facades just visible
  let skyAmb = max(mix(G.skyH.rgb, G.skyZ.rgb, 0.6), vec3f(0.10, 0.11, 0.15) * night);
  let lamb = max(dot(N, L), 0.0) * shadowAt(v.world, N);
  // ground darkening: walls are darker near their foot (street canyon)
  let ao = select(mix(0.55, 1.0, smoothstep(0.0, 25.0, v.wall.x)), 1.0, roof);
  var col = alb * (G.sunCol.rgb * lamb + skyAmb * G.sunCol.w * (0.55 + 0.45 * N.z)) * ao;

  // windows: a faint grid by day, lit cells after dusk
  if (!roof && v.info.x > 6.0) {
    let fl = floor(v.wall.x / 3.5);
    let cl = floor(v.wall.y / 3.0);
    let fy = fract(v.wall.x / 3.5);
    let fx = fract(v.wall.y / 3.0);
    let pane = step(0.25, fy) * step(fy, 0.8) * step(0.18, fx) * step(fx, 0.82);
    col *= 1.0 - 0.10 * pane * (1.0 - night);
    let seed = u32(v.info.z * 65535.0) * 7919u + u32(fl) * 104729u + u32(cl + 4096.0) * 31u;
    let on = step(0.58 - 0.25 * smoothstep(40.0, 0.0, v.wall.x), hash11(seed));
    let warm = mix(vec3f(1.0, 0.74, 0.42), vec3f(0.85, 0.92, 1.0), step(0.8, hash11(seed + 17u)));
    col += night * pane * on * warm * 0.85;
  }
  col = fogMix(col, distance(G.eye.xyz, v.world), v.world.z);
  return vec4f(col, 1.0);
}
