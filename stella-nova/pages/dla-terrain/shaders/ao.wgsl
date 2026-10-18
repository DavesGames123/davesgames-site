// ============================================================================
//  DLA TERRAIN  ·  shaders/ao.wgsl — screen-space ambient occlusion (NEAR)
// ----------------------------------------------------------------------------
//  CORE joins common.wgsl + lib/dla-terrain-detail.wgsl in front of this
//  file. render/ao.js runs it after the water pass (the volumetricPrep hook
//  of gpu/frame.js), at half size:
//    cs_ao      one half-size pixel: the full-size depth at one of its 4
//               pixels (the choice turns each frame), the world point, a
//               normal from the depth neighbours (the side with the smaller
//               step), then AO_DIRS x 2 rays of AO_STEPS samples in screen
//               space over AP.a.x m (Alchemy AO, McGuire 2011, with a range
//               falloff). Out: r = AO 0..1 (1 open), g = view depth m.
//    cs_blurH,  a 9 tap bilateral blur (depth weight), horizontal then
//    cs_blurV   vertical.
//    fs_apply   full size in the volumetric pass (before SKY's haze): a
//               depth-weighted upsample of the 4 near half-size texels; the
//               output colour multiplies the HDR target (blend dst * src).
//               Sky (depth 0) and water (live depth differs from the copy
//               before water) keep 1.
//  The noise (IGN, turned each frame) is resolved by CORE's TAA, which is
//  why render/ao.js turns AO off without TAA. Every loop has a constant
//  bound (tests/caps.test.mjs).
//
//  grep -n targets: "fn cs_ao", "fn blur", "fn fs_apply", "AO_DIRS", "AO_STEPS"
// ============================================================================

struct AOParams {
  a: vec4f,   // x radius m, y strength 0..1, z max radius px (full size), w frame
  b: vec4f,   // x fade start m, y fade end m, z bias, w 0
};
@group(1) @binding(0) var<uniform> AP: AOParams;
@group(1) @binding(1) var tDepthAO: texture_depth_2d;
@group(1) @binding(2) var outAO: texture_storage_2d<rgba16float, write>;
@group(1) @binding(3) var inAO: texture_2d<f32>;
@group(1) @binding(4) var tDepthPre: texture_depth_2d;   // the depth before water

const AO_DIRS: i32 = 2;
const AO_STEPS: i32 = 4;
const AO_GAIN: f32 = 3.0;    // Alchemy 2 sigma: the darkness of a full occlusion

fn aoDepth(p: vec2i) -> f32 {
  let n = vec2i(textureDimensions(tDepthAO));
  return textureLoad(tDepthAO, clamp(p, vec2i(0), n - vec2i(1)), 0);
}
fn aoWorld(p: vec2i, d: f32) -> vec3f {
  let n = vec2f(textureDimensions(tDepthAO));
  return worldFromDepth((vec2f(p) + vec2f(0.5)) / n, d);
}

@compute @workgroup_size(8, 8)
fn cs_ao(@builtin(global_invocation_id) gid: vec3u) {
  let hs = vec2i(textureDimensions(outAO));
  let hp = vec2i(gid.xy);
  if (any(hp >= hs)) { return; }
  // one of the 4 full-size pixels, turning each frame (TAA averages them)
  let fr = u32(AP.a.w);
  let sub = vec2i(i32(fr & 1u), i32((fr >> 1u) & 1u));
  let fp = (hp * 2) + sub;
  let d = aoDepth(fp);
  if (d <= 0.0) { textureStore(outAO, hp, vec4f(1.0, 1e5, 0.0, 1.0)); return; }
  let vz = linearDepth(d);
  if (vz > AP.b.y) { textureStore(outAO, hp, vec4f(1.0, vz, 0.0, 1.0)); return; }
  let P = aoWorld(fp, d);
  // the normal from the depth neighbours (the side with the smaller step)
  let dl = aoDepth(fp - vec2i(1, 0)); let dr = aoDepth(fp + vec2i(1, 0));
  let du = aoDepth(fp - vec2i(0, 1)); let dd = aoDepth(fp + vec2i(0, 1));
  let Pl = aoWorld(fp - vec2i(1, 0), dl); let Pr = aoWorld(fp + vec2i(1, 0), dr);
  let Pu = aoWorld(fp - vec2i(0, 1), du); let Pd = aoWorld(fp + vec2i(0, 1), dd);
  let ex = select(Pr - P, P - Pl, abs(linearDepth(dl) - vz) < abs(linearDepth(dr) - vz));
  let ey = select(Pd - P, P - Pu, abs(linearDepth(du) - vz) < abs(linearDepth(dd) - vz));
  var N = normalize(cross(ex, ey) + vec3f(0.0, 1e-6, 0.0));
  let toCam = G.camPos.xyz - P;
  if (dot(N, toCam) < 0.0) { N = -N; }
  // the radius in full-size px
  let fullH = f32(textureDimensions(tDepthAO).y);
  let R = AP.a.x;
  let rPx = clamp((R * G.proj[1][1] * 0.5 * fullH) / max(vz, 0.1), 1.5, AP.a.z);
  let noise = fract(cm_ign(vec2f(hp)) + (AP.a.w * 0.6180339));
  let noise2 = fract(cm_ign(vec2f(hp) + vec2f(31.0, 17.0)) + (AP.a.w * 0.7548777));
  var occ = 0.0;
  var cnt = 0.0;
  let bias = AP.b.z * vz;
  for (var k = 0; k < AO_DIRS; k++) {
    let ang = (noise + (f32(k) / f32(AO_DIRS))) * 3.14159265;
    let dir = vec2f(cos(ang), sin(ang));
    for (var side = 0; side < 2; side++) {
      let sdir = select(-dir, dir, side == 0);
      for (var j = 0; j < AO_STEPS; j++) {
        let t = (f32(j) + noise2) / f32(AO_STEPS);
        let off = sdir * (rPx * ((t * t) * 0.85 + 0.15));
        let q = fp + vec2i(round(off));
        let dq = aoDepth(q);
        cnt += 1.0;
        if (dq <= 0.0) { continue; }
        let v = aoWorld(q, dq) - P;
        let vv = dot(v, v);
        let fall = clamp(1.0 - (vv / (R * R)), 0.0, 1.0);
        occ += (max(dot(v, N) - bias, 0.0) / (vv + (0.02 * R * R))) * fall;
      }
    }
  }
  let a = clamp(1.0 - ((AO_GAIN * R) * occ / max(cnt, 1.0)), 0.0, 1.0);
  // fade out with the distance (the radius is m, far ground needs none)
  let fade = 1.0 - smoothstep(AP.b.x, AP.b.y, vz);
  textureStore(outAO, hp, vec4f(mix(1.0, a, fade), vz, 0.0, 1.0));
}

fn blur(gid: vec2u, dir: vec2i) {
  let hs = vec2i(textureDimensions(outAO));
  let p = vec2i(gid);
  if (any(p >= hs)) { return; }
  let c = textureLoad(inAO, p, 0);
  if (c.g > 1e4) { textureStore(outAO, p, c); return; }
  var sum = c.r;
  var wsum = 1.0;
  let tol = max(c.g * 0.03, 0.05);
  for (var i = -4; i <= 4; i++) {
    if (i == 0) { continue; }
    let q = clamp(p + (dir * i), vec2i(0), hs - vec2i(1));
    let s = textureLoad(inAO, q, 0);
    let fi = f32(i);
    let w = exp(-(fi * fi) / 12.0) * exp(-abs(s.g - c.g) / tol);
    sum += s.r * w;
    wsum += w;
  }
  textureStore(outAO, p, vec4f(sum / wsum, c.g, 0.0, 1.0));
}
@compute @workgroup_size(8, 8)
fn cs_blurH(@builtin(global_invocation_id) gid: vec3u) { blur(gid.xy, vec2i(1, 0)); }
@compute @workgroup_size(8, 8)
fn cs_blurV(@builtin(global_invocation_id) gid: vec3u) { blur(gid.xy, vec2i(0, 1)); }

struct AOOut { @builtin(position) pos: vec4f };
@vertex
fn vs_apply(@builtin(vertex_index) i: u32) -> AOOut {
  var o: AOOut;
  let x = f32((i << 1u) & 2u);
  let y = f32(i & 2u);
  o.pos = vec4f((x * 2.0) - 1.0, 1.0 - (y * 2.0), 0.0, 1.0);
  return o;
}
@fragment
fn fs_apply(o: AOOut) -> @location(0) vec4f {
  let fp = vec2i(o.pos.xy);
  let d = textureLoad(tDepthAO, fp, 0);
  if (d <= 0.0) { return vec4f(1.0); }
  // water drew over this pixel: no AO on the water surface
  let d0 = textureLoad(tDepthPre, fp, 0);
  if (abs(d - d0) > (1e-6 + (d * 1e-4))) { return vec4f(1.0); }
  let vz = linearDepth(d);
  let hs = vec2i(textureDimensions(inAO));
  let hp = (vec2f(fp) + vec2f(0.5)) * 0.5 - vec2f(0.5);
  let b = vec2i(floor(hp));
  let f = hp - floor(hp);
  var sum = 0.0;
  var wsum = 0.0;
  for (var k = 0; k < 4; k++) {
    let o2 = vec2i(k & 1, k >> 1);
    let q = clamp(b + o2, vec2i(0), hs - vec2i(1));
    let s = textureLoad(inAO, q, 0);
    let bw = select(1.0 - f.x, f.x, o2.x == 1) * select(1.0 - f.y, f.y, o2.y == 1);
    let w = (bw + 1e-3) / (1e-3 + (abs(s.g - vz) / max(vz * 0.02, 0.02)));
    sum += s.r * w;
    wsum += w;
  }
  let a = sum / max(wsum, 1e-5);
  let m = mix(1.0, a, AP.a.y);
  return vec4f(m, m, m, 1.0);
}
