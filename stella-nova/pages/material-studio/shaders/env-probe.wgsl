// ============================================================================
//  MATERIAL STUDIO  ·  shaders/env-probe.wgsl — the environment probe preview
// ────────────────────────────────────────────────────────────────────────────
//  The small canvas in the environment panel. It ray-traces three spheres
//  (mirror metal, rough gold, white diffuse) in front of the background and
//  shades them only with the env-lib.wgsl helper, so it is also the in-page
//  test of that helper. env.js puts envWGSL({group:0, binding:0}) in front.
//
//  BINDINGS  group 0: 0..5 env helper (see env-lib.wgsl), 6 PRU uniform
//  CONTENTS  probeVS · hitSphere · ggxDirect · shade · fs_probe
// ============================================================================

struct PRU {
  size: vec2f,
  exposure: f32,    // linear multiplier (2^EV)
  aspect: f32,
  yaw: f32,         // camera yaw (radians) around +Y
  p1: f32,
  p2: f32,
  p3: f32,
};
@group(0) @binding(6) var<uniform> pr: PRU;

@vertex
fn probeVS(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let x = f32((i << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(i & 2u) * 2.0 - 1.0;
  return vec4f(x, y, 0.0, 1.0);
}

fn hitSphere(ro: vec3f, rd: vec3f, c: vec3f, r: f32) -> f32 {
  let oc = ro - c;
  let b = dot(oc, rd);
  let h = (b * b) - (dot(oc, oc) - (r * r));
  if (h < 0.0) { return -1.0; }
  return -b - sqrt(h);
}

fn ggxDirect(N: vec3f, V: vec3f, L: vec3f, F0: vec3f, rough: f32) -> vec3f {
  let H = normalize(V + L);
  let nl = max(dot(N, L), 0.0);
  let nv = max(dot(N, V), 1e-4);
  let nh = max(dot(N, H), 0.0);
  let vh = max(dot(V, H), 0.0);
  let a = max(rough * rough, 0.002);
  let a2 = a * a;
  let k = ((nh * nh) * (a2 - 1.0)) + 1.0;
  let D = a2 / (3.14159265 * k * k);
  let kk = a * 0.5;
  let G = (nv / ((nv * (1.0 - kk)) + kk)) * (nl / ((nl * (1.0 - kk)) + kk));
  let F = F0 + ((vec3f(1.0) - F0) * pow(1.0 - vh, 5.0));
  return (D * G * F) / max(4.0 * nv, 1e-4);
}

fn shade(P: vec3f, N: vec3f, V: vec3f, base: vec3f, metal: f32, rough: f32) -> vec3f {
  let F0 = mix(vec3f(0.04), base, metal);
  let diffCol = base * (1.0 - metal);
  var c = envSpecularIBL(N, V, F0, rough) + (diffCol * envIrradiance(N));
  let n = envLightCount();
  for (var i = 0u; i < 4u; i++) {
    if (i >= n) { break; }
    let ls = envLight(i, P);
    let nl = max(dot(N, ls.L), 0.0);
    c += ((diffCol / 3.14159265) + ggxDirect(N, V, ls.L, F0, rough)) * ls.radiance * nl;
  }
  return c;
}

@fragment
fn fs_probe(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let ndc = vec2f(((pos.x / pr.size.x) * 2.0) - 1.0, 1.0 - ((pos.y / pr.size.y) * 2.0));
  let cy = cos(pr.yaw);
  let sy = sin(pr.yaw);
  var rd = normalize(vec3f(ndc.x * pr.aspect * 0.5, ndc.y * 0.5, -1.0));
  rd = vec3f((cy * rd.x) + (sy * rd.z), rd.y, (cy * rd.z) - (sy * rd.x));
  let ro = vec3f(0.0);
  var col = envBackground(rd);
  var best = 1e9;
  for (var s = 0; s < 3; s++) {
    let fx = f32(s - 1) * 1.12;
    let cl = vec3f((cy * fx) + (sy * -2.4), 0.0, (cy * -2.4) - (sy * fx));
    let t = hitSphere(ro, rd, cl, 0.52);
    if ((t > 0.0) && (t < best)) {
      best = t;
      let P = ro + (rd * t);
      let N = normalize(P - cl);
      let V = -rd;
      if (s == 0) { col = shade(P, N, V, vec3f(0.97, 0.97, 0.97), 1.0, 0.04); }
      else if (s == 1) { col = shade(P, N, V, vec3f(1.0, 0.78, 0.36), 1.0, 0.38); }
      else { col = shade(P, N, V, vec3f(0.8, 0.8, 0.8), 0.0, 0.85); }
    }
  }
  let t = (col * pr.exposure) / (vec3f(1.0) + (col * pr.exposure));
  let lo = t * 12.92;
  let hi = (1.055 * pow(t, vec3f(1.0 / 2.4))) - 0.055;
  return vec4f(select(hi, lo, t <= vec3f(0.0031308)), 1.0);
}
