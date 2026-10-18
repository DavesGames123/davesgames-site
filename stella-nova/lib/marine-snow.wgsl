// ============================================================================
//  MARINE SNOW  ·  lib/marine-snow.wgsl — the WebGPU form of marine-snow.js
// ----------------------------------------------------------------------------
//  The same maths as the GLSL in lib/marine-snow.js (MS_VS_MAIN,
//  MARINE_SNOW_FS): world-locked flakes in a far box and a near box round
//  the eye, aggregate shapes from the atlas, a two-lobe Henyey-Greenstein
//  phase toward 4 spots and a sun, the thin-lens disc, the motion streak,
//  the soft fade against the scene depth, and an optional tone map.
//  lib/marine-snow-gpu.js packs the uniforms (packSnowUniforms), makes
//  the atlas texture, the instance buffer and the pipeline.
//
//  Bindings (group 0): 0 uniforms MsU, 1 atlas (rgba8unorm, mips),
//  2 sampler (linear, mipmap linear), 3 the scene depth (texture_depth_2d;
//  a 1 x 1 texture when soft is off). Instance buffer: location 0 seed,
//  location 1 rnd (vec4f each). Draw: 6 vertices per instance.
//  The scene depth must not be a writable attachment of the same pass: use
//  depthReadOnly, or a pass with no depth.
//
//  Mixed operators carry parentheses (Chrome Tint rejects a * b ^ c and
//  a && b || c without them).
//
//  grep -n: "struct MsU", "fn msLight", "fn vsSnow", "fn fsSnow"
// ============================================================================

struct MsU {
  vp: mat4x4f,       // view-projection of this frame
  prevVP: mat4x4f,   // view-projection of the last frame (the streak)
  view: mat4x4f,     // view matrix
  cam: vec4f,        // xyz the eye (render space), w time (s)
  box: vec4f,        // xyz the far box (m), w the near box side
  phase: vec4f,      // xyz mod(drift - origin, far box)
  phaseN: vec4f,     // xyz mod(drift - origin, near box)
  sink: vec4f,       // per type: the sink phase in the far box
  sinkN: vec4f,      // per type: the sink phase in the near box
  eddyO: vec4f,      // xyz mod(origin, 9 m)
  lens: vec4f,       // x px per metre at 1 m, y aperture (m), z focus (m), w shutter
  px: vec4f,         // x min disc px, y max disc px, z max streak px, w streak on
  share: vec4f,      // cumulative type shares
  typeK: vec4f,      // the visible share of each type
  sizeK: vec4f,      // the size scale of each type
  tintA: vec4f,      // rgb mote tint, w gain
  tintB: vec4f,      // rgb aggregate tint, w density
  ext: vec4f,        // rgb extinction per metre
  g: vec4f,          // forward g, back g, back weight, cap
  viewport: vec4f,   // xy target px, z near, w far
  frag: vec4f,       // x soft, y soft length (m), z post (tone map), w exposure
  disc: vec4f,       // x the mean of the atlas shapes in the unit disc
  sun: vec4f,        // xyz the way the light goes (unit), w on
  sunC: vec4f,       // rgb sun radiance, w spot count
  spotP: array<vec4f, 4>,  // xyz place, w range
  spotD: array<vec4f, 4>,  // xyz direction, w cos(outer)
  spotC: array<vec4f, 4>,  // rgb radiance, w cos(inner)
};

@group(0) @binding(0) var<uniform> U: MsU;
@group(0) @binding(1) var msAtlas: texture_2d<f32>;
@group(0) @binding(2) var msSamp: sampler;
@group(0) @binding(3) var msDepth: texture_depth_2d;

const MS_SMIN = vec4f(0.0006, 0.003, 0.008, 0.0015);
const MS_SMAX = vec4f(0.0025, 0.016, 0.035, 0.0045);
const MS_CB = vec4f(0.0, 4.0, 10.0, 13.0);
const MS_CN = vec4f(4.0, 6.0, 3.0, 3.0);
const MS_SPIN = vec4f(0.25, 0.12, 0.08, 0.2);
const MS_TUMBLE = vec4f(0.0, 0.6, 0.75, 0.7);

fn msHG(g: f32, c: f32) -> f32 {
  let d = 1.0 + (g * g) - (2.0 * g * c);
  return (1.0 - (g * g)) / (12.566371 * d * sqrt(d));
}
fn msPhase(c: f32) -> f32 { return min(mix(msHG(U.g.x, c), msHG(U.g.y, c), U.g.z), U.g.w); }
fn msMod3(x: vec3f, y: vec3f) -> vec3f { return x - (y * floor(x / y)); }

// MS_LIGHT_BEGIN (marine-snow-gpu.js can swap this function for a page light)
fn msLight(p: vec3f, V: vec3f) -> vec3f {
  var c = U.sunC.rgb * (msPhase(dot(U.sun.xyz, V)) * U.sun.w);
  let n = i32(U.sunC.w);
  for (var i = 0; i < 4; i++) {
    if (i >= n) { break; }
    let d = U.spotP[i].xyz - p;
    let dist = max(length(d), 0.05);
    let L = d / dist;
    let cone = smoothstep(U.spotD[i].w, U.spotC[i].w, dot(-L, U.spotD[i].xyz));
    let att = (cone / (1.0 + (0.06 * dist * dist))) * (1.0 - smoothstep(U.spotP[i].w * 0.55, U.spotP[i].w, dist));
    c += U.spotC[i].rgb * (att * msPhase(dot(-L, V))) * exp(-dist * U.ext.xyz);
  }
  return c;
}
// MS_LIGHT_END

struct MsOut {
  @builtin(position) pos: vec4f,
  @location(0) col: vec3f,
  @location(1) quad: vec4f,
  @location(2) rot: vec4f,
  @location(3) cell: vec4f,
};

@vertex
fn vsSnow(@builtin(vertex_index) vi: u32, @location(0) seed: vec4f, @location(1) rnd: vec4f) -> MsOut {
  var o: MsOut;
  var corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let c = corners[vi];
  // the type, the cell and a free random under the cell pick
  let u = rnd.x;
  let ty = select(select(select(3.0, 2.0, u < U.share.z), 1.0, u < U.share.y), 0.0, u < U.share.x);
  let oh = select(vec4f(0.0), vec4f(1.0), vec4f(ty) == vec4f(0.0, 1.0, 2.0, 3.0));
  let cn = dot(MS_CN, oh);
  let cell = dot(MS_CB, oh) + min(floor(rnd.y * cn), cn - 1.0);
  let r5 = fract(rnd.y * cn);
  let tk = dot(U.typeK, oh) * 1.08;
  let dk = U.tintB.w * 1.03;
  let vis = (1.0 - smoothstep(tk - 0.08, tk, r5)) * (1.0 - smoothstep(dk - 0.03, dk, abs(seed.w)));
  let nearL = seed.w < 0.0;
  let smin = dot(MS_SMIN, oh);
  let size = smin * pow(dot(MS_SMAX, oh) / smin, pow(rnd.z, 1.7)) * dot(U.sizeK, oh);
  // the place: world-locked, wraps round the eye
  let B = select(U.box.xyz, vec3f(U.box.w), nearL);
  let eye = U.cam.xyz;
  let base = eye - (0.5 * B);
  var q = (seed.xyz * B) + select(U.phase.xyz, U.phaseN.xyz, nearL);
  q.y += dot(select(U.sink, U.sinkN, nearL), oh);
  q = base + msMod3(q - base, B);
  let t = U.cam.w;
  let e = q + U.eddyO.xyz;
  q += vec3f(sin((e.z * 0.6981317) + (t * 0.21)) + sin((e.y * 1.3962634) - (t * 0.17)),
             0.5 * sin((e.x * 0.6981317) + (t * 0.13)),
             cos((e.x * 1.3962634) + (t * 0.19)) + sin((e.y * 0.6981317) + (t * 0.23))) * 0.03;
  q += vec3f(sin((t * 0.9) + (rnd.z * 40.0)), 0.6 * sin((t * 0.7) + (rnd.w * 40.0)), cos((t * 0.8) + (rnd.x * 40.0))) * 0.005;
  let mv = U.view * vec4f(q, 1.0);
  let z = -mv.z;
  let dq = eye - q;
  let dist = length(dq);
  let V = dq / max(dist, 1e-4);
  let fadeR = 0.5 * min(B.x, min(B.y, B.z));
  let fade = (1.0 - smoothstep(fadeR * select(0.62, 0.4, nearL), fadeR, dist)) * smoothstep(0.04, 0.12, z);
  let tint = mix(U.tintB.rgb, U.tintA.rgb, oh.x) * (1.0 - (0.45 * oh.w));
  // the lens
  let zc = max(z, 0.04);
  let sPx = (size * U.lens.x) / zc;
  let coc = min(U.lens.y * U.lens.x * abs((1.0 / U.lens.z) - (1.0 / zc)), U.px.y);
  let d2 = (sPx * sPx) + (coc * coc);
  let dPx = clamp(sqrt(d2), U.px.x, U.px.y);
  let sE = max(sPx, U.px.x);
  let cover = min((sPx * sPx) / (dPx * dPx), 1.0);
  let coverS = min((sPx * sPx) / (sE * sE), 1.0);
  let bok = (coc * coc) / max(d2, 1e-8);
  // the streak
  var cNow = U.vp * vec4f(q, 1.0);
  let cPrev = U.prevVP * vec4f(q, 1.0);
  var dS = vec2f(0.0);
  if ((U.px.w > 0.5) && (cPrev.w > 0.04) && (cNow.w > 0.04)) {
    dS = ((cNow.xy / cNow.w) - (cPrev.xy / cPrev.w)) * 0.5 * U.viewport.xy * U.lens.w;
  }
  let sl = length(dS);
  let L = min(sl, U.px.z);
  let ax = select(vec2f(1.0, 0.0), dS / max(sl, 1e-6), sl > 0.25);
  let R = 0.5 * dPx;
  let hl = 0.5 * L;
  let off = (ax * (c.x * (R + hl))) + (vec2f(-ax.y, ax.x) * (c.y * R));
  cNow = vec4f(cNow.xy + ((off * 2.0 / U.viewport.xy) * cNow.w), cNow.zw);
  let spin = (rnd.w - 0.5) * 2.0 * dot(MS_SPIN, oh);
  let th = (fract(rnd.w * 7.13) * 6.2831853) + (t * spin) - atan2(ax.y, ax.x);
  let sq = 1.0 - (dot(MS_TUMBLE, oh) * (0.5 - (0.5 * cos((t * spin * 0.7) + (rnd.x * 37.0)))));
  o.rot = vec4f(cos(th), sin(th), max(sq, 0.25), z);
  o.quad = vec4f((c.x * (R + hl)) / R, c.y, hl / R, bok);
  o.cell = vec4f(vec2f(cell - (4.0 * floor(cell / 4.0)), floor(cell / 4.0)) * 0.25, min(sE / dPx, 1.0), cover / max(coverS, 1e-6));
  let k = U.tintA.w * coverS * fade * vis * (R / (R + hl));
  o.col = select(vec3f(0.0), msLight(q, V) * tint * k * exp(-dist * U.ext.xyz), k > 0.0);
  o.pos = select(vec4f(0.0, 0.0, 2.0, 1.0), cNow, k > 0.0);
  return o;
}

@fragment
fn fsSnow(i: MsOut) -> @location(0) vec4f {
  let hl = i.quad.z;
  let bok = i.quad.w;
  let l = vec2f(sign(i.quad.x) * max(abs(i.quad.x) - hl, 0.0), i.quad.y);
  let r = length(l);
  var s = vec2f((i.rot.x * l.x) + (i.rot.y * l.y), (i.rot.x * l.y) - (i.rot.y * l.x));
  s.y = s.y / i.rot.z;
  s = s / i.cell.z;
  let uv = i.cell.xy + (clamp((s * 0.5) + 0.5, vec2f(0.0), vec2f(1.0)) * 0.25);
  let sh = textureSampleBias(msAtlas, msSamp, uv, -log2(i.cell.z)).r * step(abs(s.x), 1.0) * step(abs(s.y), 1.0);
  let rr = vec3f(r * 0.97, r, r * 1.03);
  let disc = (1.0 - smoothstep(vec3f(0.8), vec3f(1.0), rr)) * (0.6 + (0.55 * smoothstep(vec3f(0.35), vec3f(0.92), rr)));
  var col = i.col * mix(vec3f(sh), disc * (U.disc.x * i.cell.w), bok) * step(r, 1.0);
  if (U.frag.x > 0.5) {
    let dz = textureLoad(msDepth, vec2i(i.pos.xy), 0);
    let zs = (U.viewport.z * U.viewport.w) / (U.viewport.w - (dz * (U.viewport.w - U.viewport.z)));
    col *= clamp((zs - i.rot.w) / U.frag.y, 0.0, 1.0);
  }
  if (U.frag.z > 0.5) {
    let x0 = col * U.frag.w;
    let x = clamp((x0 * ((2.51 * x0) + 0.03)) / ((x0 * ((2.43 * x0) + 0.59)) + 0.14), vec3f(0.0), vec3f(1.0));
    col = select(x * 12.92, (1.055 * pow(x, vec3f(1.0 / 2.4))) - 0.055, x > vec3f(0.0031308));
  }
  return vec4f(col, 1.0);
}
