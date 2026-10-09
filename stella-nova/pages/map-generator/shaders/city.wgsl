// city.wgsl — the 3D City Generator view: sky, ground layers, blocks,
// buildings, roads, tensor field crosses and the sun shadow pass.
//
// The look follows City Atlas (pages/city-atlas/shaders): the same Frame
// light terms, the sky gradient with the sun glow, distance fog, the
// building colour ramp by height, a faint window grid by day and lit
// windows after dusk, a darker wall foot, and water with sky reflection
// and a sun glint.
//
// The city grows on the GPU. Each vertex carries its playback times
// (mesh3d.js), and G.eye.w is the playback time T:
//   kind 1 road      the fragment shows when T >= t0 + s * dur (s along the road)
//   kind 2 block     the top rises to 0.6 m
//   kind 3 building  a 0.5 m pad when its lot shows, then it rises to h
//   kind 4 sea       a disc from the middle of the coastline grows over it
//   kind 5, 6        park, river: they fade in from the ground colour
// A part that has not started goes outside the clip volume (vertex) or is
// discarded (fragment).
//
// Reversed depth (1 near, 0 far), depth test 'greater'.
//
// grep: struct Frame  fn place  fn vs  fn fs  fn vsShadow  fn vsSky  fn fsSky
//       fn vsField  fn fsField  fn shadowAt  fn heightColour

struct Frame {
  viewProj: mat4x4f,
  eye: vec4f,        // xyz camera, w playback time T (s)
  sun: vec4f,        // xyz unit vector to the sun, w night 0..1
  sunCol: vec4f,     // rgb sun light, w ambient strength
  skyH: vec4f,       // rgb horizon and fog, w fog distance (m)
  skyZ: vec4f,       // rgb zenith, w field alpha
  misc: vec4f,       // x wall clock (s), y shadows on, z 0, w 0
  invViewProj: mat4x4f,
  lightVP: mat4x4f,  // sun shadow map: orthographic, depth 0 near the sun
};

@group(0) @binding(0) var<uniform> G: Frame;
@group(0) @binding(1) var shadowMap: texture_depth_2d;
@group(0) @binding(2) var shadowS: sampler_comparison;

const BLOCK_H = 0.6;
const PAD_H = 0.5;
const GROUND = vec3f(0.25, 0.255, 0.26);

struct VIn {
  @location(0) pos: vec3f,
  @location(1) nrm: vec4f,
  @location(2) col: vec4f,
  @location(3) anim: vec4f,   // t0, dur, s, kind
  @location(4) ext: vec4f,    // building: h, t0 rise, dur rise; sea: cx, cy, R
};

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) n: vec3f,
  @location(2) col: vec3f,
  @location(3) @interpolate(flat) info: vec4f,   // kind, progress, height, roof
  @location(4) wall: vec2f,                      // z above the block, u along the wall
  @location(5) s: f32,                           // road: share of length; sea: disc radius
  @location(6) @interpolate(flat) road: vec2f,   // road: t0, dur; sea: disc centre
};

fn prog(t0: f32, d: f32) -> f32 {
  return clamp((G.eye.w - t0) / max(d, 0.001), 0.0, 1.0);
}
fn ease(x: f32) -> f32 { return x * x * (3.0 - 2.0 * x); }

struct Placed {
  p: vec3f,
  show: f32,      // 0 hidden, else 1
  k: f32,         // progress for colour
  zr: f32,        // building: z above the block
};

// The animated position of a vertex at time T.
fn place(v: VIn) -> Placed {
  let kind = i32(round(v.anim.w));
  var o: Placed;
  o.p = v.pos;
  o.show = 1.0;
  o.k = 1.0;
  o.zr = 0.0;
  let p = prog(v.anim.x, v.anim.y);
  if (kind == 2) {
    o.show = select(0.0, 1.0, p > 0.0);
    o.p.z = v.pos.z * BLOCK_H * max(ease(p), 0.1);
    o.k = p;
  } else if (kind == 3) {
    let h = v.ext.x;
    let pb = prog(v.ext.y, v.ext.z);
    o.show = select(0.0, 1.0, p > 0.0);
    let top = mix(PAD_H, h, ease(pb));
    o.zr = v.pos.z * top;
    o.p.z = BLOCK_H + o.zr;
    o.k = pb;
  } else if (kind == 5 || kind == 6) {
    o.show = select(0.0, 1.0, p > 0.0);
    o.k = p;
  } else if (kind == 4) {
    o.show = select(0.0, 1.0, p > 0.0);
    o.k = p;
  }
  return o;
}

@vertex
fn vs(v: VIn) -> VOut {
  let q = place(v);
  var o: VOut;
  o.world = q.p;
  o.pos = G.viewProj * vec4f(q.p, 1.0);
  if (q.show < 0.5) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); }
  o.n = v.nrm.xyz;
  o.col = v.col.rgb;
  o.info = vec4f(v.anim.w, q.k, v.ext.x, v.col.a);
  o.wall = vec2f(q.zr, v.anim.z);
  o.s = v.anim.z;
  o.road = v.anim.xy;
  if (i32(round(v.anim.w)) == 4) {
    // the sea: road = disc centre, s = disc radius at the end
    o.road = v.ext.xy;
    o.s = v.ext.z;
  }
  return o;
}

@vertex
fn vsShadow(v: VIn) -> @builtin(position) vec4f {
  let q = place(v);
  if (q.show < 0.5) { return vec4f(2.0, 2.0, 2.0, 1.0); }
  return G.lightVP * vec4f(q.p, 1.0);
}

fn hash11(n: u32) -> f32 {
  var x = n;
  x ^= x >> 16u; x *= 0x7feb352du;
  x ^= x >> 15u; x *= 0x846ca68bu;
  x ^= x >> 16u;
  return f32(x & 0xffffffu) / 16777216.0;
}

fn fogMix(c: vec3f, d: f32) -> vec3f {
  let k = d / max(G.skyH.w, 1.0);
  let f = 1.0 - exp(-k * k * 1.6);
  return mix(c, G.skyH.rgb, clamp(f, 0.0, 1.0));
}

// Sun shadow of the blocks and buildings, 0 (shadow) .. 1 (lit). Four taps.
fn shadowAt(world: vec3f, nrm: vec3f) -> f32 {
  if (G.misc.y < 0.5 || G.sun.w > 0.6) { return 1.0; }
  let q = G.lightVP * vec4f(world + nrm * 0.6, 1.0);
  let uv = vec2f(q.x * 0.5 + 0.5, 0.5 - q.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || q.z > 1.0) { return 1.0; }
  let px = 1.0 / f32(textureDimensions(shadowMap).x);
  let d = q.z - 0.0006;
  var s = 0.0;
  s += textureSampleCompareLevel(shadowMap, shadowS, uv + vec2f(-0.5, -0.5) * px, d);
  s += textureSampleCompareLevel(shadowMap, shadowS, uv + vec2f(0.5, -0.5) * px, d);
  s += textureSampleCompareLevel(shadowMap, shadowS, uv + vec2f(-0.5, 0.5) * px, d);
  s += textureSampleCompareLevel(shadowMap, shadowS, uv + vec2f(0.5, 0.5) * px, d);
  return s * 0.25;
}

fn shade(alb: vec3f, N: vec3f, world: vec3f) -> vec3f {
  let L = normalize(G.sun.xyz);
  let night = G.sun.w;
  let skyAmb = max(mix(G.skyH.rgb, G.skyZ.rgb, 0.6), vec3f(0.10, 0.11, 0.15) * night);
  let lamb = max(dot(N, L), 0.0) * shadowAt(world, N);
  return alb * (G.sunCol.rgb * lamb + skyAmb * G.sunCol.w * (0.55 + 0.45 * N.z));
}

fn water(base: vec3f, world: vec3f) -> vec3f {
  let L = normalize(G.sun.xyz);
  let V = normalize(G.eye.xyz - world);
  let night = G.sun.w;
  let skyAmb = max(mix(G.skyH.rgb, G.skyZ.rgb, 0.5), vec3f(0.06, 0.07, 0.10) * night);
  let sh = shadowAt(world, vec3f(0.0, 0.0, 1.0));
  var wl = base * (G.sunCol.rgb * 0.55 * (0.4 + 0.6 * sh) + skyAmb * G.sunCol.w);
  let N = vec3f(0.0, 0.0, 1.0);
  let fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  wl = mix(wl, G.skyH.rgb * 0.9, fres * 0.6);
  let H = normalize(L + V);
  wl += G.sunCol.rgb * pow(max(dot(N, H), 0.0), 220.0) * 0.6 * (1.0 - night) * sh;
  return wl;
}

@fragment
fn fs(v: VOut) -> @location(0) vec4f {
  let kind = i32(round(v.info.x));
  let night = G.sun.w;
  let N = normalize(v.n);
  var col = vec3f(0.0);
  if (kind == 1) {
    // the road draws along its length
    if (G.eye.w < v.road.x + v.s * v.road.y) { discard; }
    col = shade(v.col, N, v.world);
    // lamps along the roads after dusk
    col += night * vec3f(1.0, 0.72, 0.42) * 0.10;
  } else if (kind == 4) {
    if (distance(v.world.xy, v.road) > v.s * ease(v.info.y)) { discard; }
    col = water(v.col, v.world);
  } else if (kind == 6) {
    col = mix(shade(GROUND, N, v.world), water(v.col, v.world), v.info.y);
  } else if (kind == 5) {
    col = shade(mix(GROUND, v.col, v.info.y), N, v.world);
  } else if (kind == 3) {
    let h = v.info.z;
    let roof = v.info.w > 0.5;
    // grey pad until it rises, then the height colour
    var alb = mix(vec3f(0.40, 0.41, 0.43), v.col, smoothstep(0.0, 0.35, v.info.y));
    if (roof) { alb *= 0.82; }
    let skyAmb = max(mix(G.skyH.rgb, G.skyZ.rgb, 0.6), vec3f(0.10, 0.11, 0.15) * night);
    let L = normalize(G.sun.xyz);
    let lamb = max(dot(N, L), 0.0) * shadowAt(v.world, N);
    let ao = select(mix(0.55, 1.0, smoothstep(0.0, 25.0, v.wall.x)), 1.0, roof);
    col = alb * (G.sunCol.rgb * lamb + skyAmb * G.sunCol.w * (0.55 + 0.45 * N.z)) * ao;
    // windows: a faint grid by day, lit cells after dusk
    if (!roof && h > 6.0 && v.info.y > 0.0) {
      let fl = floor(v.wall.x / 3.5);
      let cl = floor(v.wall.y / 3.0);
      let fy = fract(v.wall.x / 3.5);
      let fx = fract(v.wall.y / 3.0);
      let pane = step(0.25, fy) * step(fy, 0.8) * step(0.18, fx) * step(fx, 0.82);
      col *= 1.0 - 0.10 * pane * (1.0 - night);
      let seed = u32(h * 97.0) * 7919u + u32(fl) * 104729u + u32(cl + 4096.0) * 31u;
      let on = step(0.58 - 0.25 * smoothstep(40.0, 0.0, v.wall.x), hash11(seed));
      let warm = mix(vec3f(1.0, 0.74, 0.42), vec3f(0.85, 0.92, 1.0), step(0.8, hash11(seed + 17u)));
      col += night * pane * on * warm * 0.85 * v.info.y;
    }
  } else {
    // ground and blocks
    col = shade(v.col, N, v.world);
    if (kind == 2 && N.z < 0.5) { col *= 0.8; }
  }
  col = fogMix(col, distance(G.eye.xyz, v.world));
  return vec4f(col, 1.0);
}

// ─── sky ────────────────────────────────────────────────────────────────────
struct SkyOut {
  @builtin(position) pos: vec4f,
  @location(0) ndc: vec2f,
};

@vertex
fn vsSky(@builtin(vertex_index) i: u32) -> SkyOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
  var o: SkyOut;
  o.pos = vec4f(p, 0.0, 1.0);
  o.ndc = p;
  return o;
}

@fragment
fn fsSky(v: SkyOut) -> @location(0) vec4f {
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
    let q = vec3i(floor(dir * 420.0));
    let h = hash11(u32(q.x * 7919) ^ u32(q.y * 104729) ^ u32(q.z * 31337) ^ 97u);
    col += vec3f(0.9, 0.93, 1.0) * G.sun.w * smoothstep(0.9975, 1.0, h) * smoothstep(0.0, 0.25, up) * 0.8;
  }
  return vec4f(col, 1.0);
}

// ─── tensor field crosses ───────────────────────────────────────────────────
@vertex
fn vsField(@location(0) p: vec3f) -> @builtin(position) vec4f {
  return G.viewProj * vec4f(p, 1.0);
}

@fragment
fn fsField() -> @location(0) vec4f {
  let a = G.skyZ.w * 0.6;
  return vec4f(vec3f(0.59, 0.73, 0.86) * a, a);
}
