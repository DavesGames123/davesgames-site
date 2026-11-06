// ============================================================================
//  COLLAPSE CITY  ·  shaders/city.wgsl — the city, the ground, the shadows
// ----------------------------------------------------------------------------
//  Needs common.wgsl in front of it (gpu.js joins them).
//
//  Vertex (32 bytes, CONTRACT.md): position @0, normal @1, colour index @2,
//  birth @3. A colour index of 16 or more is the far ground plane.
//
//  THE DROP-IN. birth is the collapse count of the slot of the vertex.
//  anim.x is the display clock (a count too). A slot with birth > clock is
//  not drawn: the vertex goes out of the clip volume. A slot with
//  clock - birth < anim.y falls from anim.z metres with an ease-out, and
//  fades in with a screen-door dither. Each slot has its own fall height
//  from a hash of its birth, so a row of slots does not fall as one block.
//
//  GREP MAP
//    fn dropOf ........... the fall of one vertex (shared by both passes)
//    fn vs_city / fs_city  the lit pass
//    fn vs_shadow ........ the sun depth pass
//    fn shadowAt ......... 5-tap PCF on the sun map
// ============================================================================

@group(0) @binding(1) var shadowMap: texture_depth_2d;
@group(0) @binding(2) var shadowCmp: sampler_comparison;

struct VIn {
  @location(0) pos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) ci: f32,
  @location(3) birth: f32,
};

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) nrm: vec3f,
  @location(2) @interpolate(flat) ci: f32,
  @location(3) @interpolate(flat) fade: f32,
  @location(4) @interpolate(flat) glow: f32,
};

struct Drop {
  pos: vec3f,
  t: f32,
  hidden: bool,
};

fn hash11(x: f32) -> f32 {
  return fract(sin(x * 12.9898 + 4.1414) * 43758.5453);
}

fn dropOf(p: vec3f, birth: f32) -> Drop {
  var d: Drop;
  let age = frame.anim.x - birth;
  d.hidden = age < 0.0;
  let span = max(frame.anim.y, 0.001);
  let t = clamp(age / span, 0.0, 1.0);
  let k = 1.0 - t;
  let ease = 1.0 - k * k * k;
  let h = frame.anim.z * (0.6 + 0.8 * hash11(birth));
  d.pos = p + vec3f(0.0, (1.0 - ease) * h, 0.0);
  d.t = t;
  return d;
}

const HIDE = vec4f(0.0, 0.0, -1.0, 1.0);

@vertex
fn vs_city(v: VIn) -> VOut {
  var o: VOut;
  let d = dropOf(v.pos, v.birth);
  o.world = d.pos;
  o.nrm = v.nrm;
  o.ci = v.ci;
  o.fade = clamp(d.t * 3.0, 0.0, 1.0);
  o.glow = (1.0 - d.t) * (1.0 - d.t);
  o.clip = frame.viewProj * vec4f(d.pos, 1.0);
  if (d.hidden) {
    o.clip = HIDE;
  }
  return o;
}

@vertex
fn vs_shadow(v: VIn) -> @builtin(position) vec4f {
  let d = dropOf(v.pos, v.birth);
  if (d.hidden) {
    return HIDE;
  }
  return frame.lightViewProj * vec4f(d.pos, 1.0);
}

fn shadowAt(world: vec3f, n: vec3f) -> f32 {
  let texel = frame.anim.w;
  let ndl = dot(n, normalize(frame.sunDir.xyz));
  let off = n * texel * (1.2 + 1.6 * (1.0 - clamp(ndl, 0.0, 1.0)));
  let sc = frame.lightViewProj * vec4f(world + off, 1.0);
  let p = sc.xyz / sc.w;
  let uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  let inside = all(uv > vec2f(0.002)) && all(uv < vec2f(0.998)) && (p.z < 1.0);
  let dims = vec2f(textureDimensions(shadowMap));
  let s = 1.0 / dims;
  let z = p.z - 0.0004;
  var acc = textureSampleCompareLevel(shadowMap, shadowCmp, uv, z);
  acc = acc + textureSampleCompareLevel(shadowMap, shadowCmp, uv + vec2f(1.2, 0.4) * s, z);
  acc = acc + textureSampleCompareLevel(shadowMap, shadowCmp, uv + vec2f(-0.4, 1.2) * s, z);
  acc = acc + textureSampleCompareLevel(shadowMap, shadowCmp, uv + vec2f(-1.2, -0.4) * s, z);
  acc = acc + textureSampleCompareLevel(shadowMap, shadowCmp, uv + vec2f(0.4, -1.2) * s, z);
  let lit = acc / 5.0;
  return select(1.0, lit, inside);
}

// interleaved gradient noise: the screen-door pattern of the fade
fn ign(p: vec2f) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}

fn hash31(p: vec3f) -> f32 {
  return fract(sin(dot(p, vec3f(127.1, 311.7, 74.7))) * 43758.5453);
}

@fragment
fn fs_city(i: VOut) -> @location(0) vec4f {
  if (i.fade < 1.0) {
    if (i.fade <= ign(i.clip.xy)) {
      discard;
    }
  }
  let n = normalize(i.nrm);
  let isGround = i.ci > 15.5;
  let ci = u32(clamp(i.ci, 0.0, 15.0));
  var albedo = frame.palette[ci].rgb;
  // palette alpha: gloss 0..1, plus 2 for an emissive colour (gpu.js materialOf)
  let mat = frame.palette[ci].a;
  let emissive = mat > 1.5;
  var gloss = select(mat, 0.0, emissive);
  if (isGround) {
    // the far ground: a faint 2 m tile so the plane does not read as paint
    let g = abs(fract(i.world.xz * 0.5) - vec2f(0.5));
    let line = smoothstep(0.47, 0.5, max(g.x, g.y));
    albedo = frame.groundColor.rgb * (1.0 - 0.08 * line);
    gloss = 0.0;
  }
  let l = normalize(frame.sunDir.xyz);
  let ndl = max(dot(n, l), 0.0);
  let sh = mix(1.0, shadowAt(i.world, n), frame.sunColor.w);
  // hemisphere ambient, and a height term on walls that darkens the base
  let amb = mix(frame.ambGround.rgb, frame.ambSky.rgb, n.y * 0.5 + 0.5);
  let wallness = 1.0 - abs(n.y);
  let ao = mix(1.0, 0.5 + 0.5 * smoothstep(0.0, 5.0, i.world.y), wallness);
  var c = albedo * (frame.sunColor.rgb * ndl * sh + amb * ao);

  let v = normalize(i.world - frame.camPos.xyz);
  if (gloss > 0.0) {
    let r = reflect(v, n);
    let cosv = clamp(dot(-v, n), 0.0, 1.0);
    let fres = 0.04 + 0.96 * pow(1.0 - cosv, 5.0);
    let env = skyColor(normalize(vec3f(r.x, abs(r.y), r.z)));
    c = mix(c, env * 0.9, clamp(fres * gloss + 0.15 * gloss, 0.0, 1.0));
    let spec = pow(max(dot(r, l), 0.0), 90.0) * 4.0;
    c = c + frame.sunColor.rgb * spec * sh * gloss;
  }
  // windows light up at night: a hash of the cell picks which
  let night = frame.sunDir.w;
  if (night > 0.0) {
    if (gloss > 0.55) {
      let cell = floor((i.world - n * 0.05) * 0.5);
      let hs = hash31(cell);
      let on = step(0.42, hs) * night;
      c = c + vec3f(1.0, 0.68, 0.34) * on * (0.9 + 0.6 * hs);
    }
  }
  // lamps: a faint glow by day, bright at night
  if (emissive) {
    c = c + albedo * (0.25 + 2.6 * night);
  }
  // a warm flash while a slot lands
  c = c + vec3f(1.0, 0.62, 0.3) * i.glow * 0.45 * (0.3 + 0.7 * night);

  c = fogMix(c, i.world);
  return vec4f(tonemap(c), 1.0);
}
