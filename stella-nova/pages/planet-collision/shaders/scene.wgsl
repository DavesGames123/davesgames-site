// ============================================================================
//  PLANET COLLISION  ·  shaders/scene.wgsl — the bindings and the light
//  helpers of the scene pass (after common.wgsl, before shade.wgsl and
//  debris.wgsl)
// ----------------------------------------------------------------------------
//  BIND GROUP 2 of the scene pass (render.js "bglShade")
//    0 sZ        smoothed view depth, coverage (rg32float, smooth.wgsl)
//    1-3 a0..a2  the front-layer fields (fluid.wgsl fs_attr)
//    4 smokeTex  the smoke after the temporal pass (half size, premultiplied)
//    5 nTex      the normal of the depth pass (w 1 where set)
//    6 smokeAux  the smoke aux (half size): mean depth, 0.5 depth, stop depth
//    7 bodyTex   the body density volume (vol.wgsl; 1^3 zero when off)
//    8 lightTex  the smoke light volume (smoke.wgsl cs_smokeLight): tau to
//                the sun, body transmittance (1^3 when off)
//
//  fn sunAt(P, n)   the sun light left at P: the smoke (exp(-tau), the
//                   coarse light volume), the bodies (a march of the body
//                   volume toward the sun from P, offset along n; or the
//                   sphere shadows while the bodies are whole)
//  fn smokeAt(px)   the smoke radiance + alpha and its 0.5 depth at a
//                   full-size pixel (depth-aware upsample of the half size)
//
//  grep -n targets: "fn sunAt", "fn smokeTauAt", "fn bodyShadow",
//  "fn sphereShadow", "fn smokeAt"
// ============================================================================

@group(2) @binding(0) var sZ: texture_2d<f32>;
@group(2) @binding(1) var a0Tex: texture_2d<f32>;
@group(2) @binding(2) var a1Tex: texture_2d<f32>;
@group(2) @binding(3) var a2Tex: texture_2d<f32>;
@group(2) @binding(4) var smokeTex: texture_2d<f32>;
@group(2) @binding(5) var nTex: texture_2d<f32>;
@group(2) @binding(6) var smokeAux: texture_2d<f32>;
@group(2) @binding(7) var bodyTex: texture_3d<f32>;
@group(2) @binding(8) var lightTex3: texture_3d<f32>;

// the sun light at P left by bodies drawn as spheres at centres[b], while
// the page says the bodies are whole (bodies[b].w)
fn sphereShadow(P: vec3f) -> f32 {
  var s = 1.0;
  let L = U0.sun.xyz;
  for (var b = 0; b < 4; b++) {
    let amt = U0.bodies[b].w;
    if (amt <= 0.0 || centres[b].w < 1.0) { continue; }
    let c = centres[b].xyz;
    let R = U0.bodies[b].y;
    let oc = P - c;
    if (length(oc) < 1.03 * R) { continue; }
    let along = -dot(oc, L);
    if (along <= 0.0) { continue; }
    let miss = length(oc + along * L);
    s = s * mix(1.0, 0.04, amt * smoothstep(1.04 * R, 0.96 * R, miss));
  }
  return s;
}
// x: optical depth of the smoke to the sun, y: the body transmittance of
// the light volume (0, 1 outside the smoke cube)
fn smokeTauAt(P: vec3f) -> vec2f {
  if (U0.smoke0.w <= 0.0) { return vec2f(0.0, 1.0); }
  let G = U0.smoke1.x;
  let g = (P - U0.smoke0.xyz) / U0.smoke0.w;
  if (any(g < vec3f(0.0)) || any(g > vec3f(G - 1.0))) { return vec2f(0.0, 1.0); }
  return textureSampleLevel(lightTex3, clampSamp, (g + vec3f(0.5)) / G, 0.0).xy;
}
// The body volume marched toward the sun from P (soft: the closest the
// ray comes to the iso level, over the distance). 1 lit, 0 in shadow.
fn bodyShadow(P: vec3f, n: vec3f, steps: i32) -> f32 {
  if (!volOn()) { return 1.0; }
  let G = U0.vol1.x;
  let cell = U0.vol0.w;
  let L = U0.sun.xyz;
  let iso = U0.vol1.y;
  // start past the reach of the body's own kernels: the field falls from
  // the iso level at the surface to 0 about 1.2 spacings out (U.surf.y is
  // 1.6 x 0.62 spacing)
  let s0 = U0.surf.y / 0.99;
  var t = 0.5 * s0;
  var dt = max(cell, 0.35 * s0);
  let p0 = P + n * (1.3 * s0);
  var lit = 1.0;
  for (var k = 0; k < steps; k++) {
    let g = toGrid(p0 + L * t);
    if (any(g < vec3f(0.0)) || any(g > vec3f(G - 1.0))) { break; }
    let f = textureSampleLevel(bodyTex, clampSamp, (g + vec3f(0.5)) / G, 0.0).w;
    // a soft edge: the penumbra widens with the distance
    lit = min(lit, 1.0 - smoothstep(0.85 * iso, 1.3 * iso, f));
    if (lit <= 0.01) { break; }
    t += dt;
    dt *= 1.2;
  }
  return lit;
}
// the sun light left at P (n: the surface normal, or 0 for a point)
fn sunAt(P: vec3f, n: vec3f, steps: i32) -> f32 {
  let sm = smokeTauAt(P);
  var b = sphereShadow(P);
  if (steps > 0) { b = min(b, bodyShadow(P, n, steps)); }
  return b * exp(-sm.x);
}
// The smoke at a full-size pixel: x radiance + alpha (premultiplied), and
// the depth where its alpha passes 0.5. The four half-size texels round
// the pixel, weighted by the bilinear weight and by how well their stop
// depth matches this pixel's surface depth (sky = 1e9), so smoke does not
// bleed over the edge of a body.
struct SmokeS { c: vec4f, t50: f32 };
fn smokeAt(px: vec2f, zHere: f32) -> SmokeS {
  var o: SmokeS;
  o.c = vec4f(0.0);
  o.t50 = 1e9;
  if (U0.smoke0.w <= 0.0) { return o; }
  let sz = vec2i(textureDimensions(smokeTex));
  let h = px * 0.5 - vec2f(0.5);
  let i0 = vec2i(floor(h));
  let f = fract(h);
  var acc = vec4f(0.0);
  var wsum = 0.0;
  var t50 = 1e9;
  var best = -1.0;
  var bestC = vec4f(0.0);
  for (var k = 0; k < 4; k++) {
    let o2 = vec2i(k & 1, k >> 1u);
    let q = clamp(i0 + o2, vec2i(0), sz - vec2i(1));
    let wb = select(1.0 - f.x, f.x, o2.x == 1) * select(1.0 - f.y, f.y, o2.y == 1);
    let ax = textureLoad(smokeAux, q, 0);
    let zt = ax.z;
    var wd = 1.0;
    if (zHere < 1e8 || zt < 1e8) { let r = abs(zt - zHere) / (0.03 * min(zHere, zt) + 1e-4); wd = exp(-r * r); }
    let c = textureLoad(smokeTex, q, 0);
    let w = wb * wd + 1e-6 * wb;
    acc += w * c;
    wsum += w;
    if (wd > best) { best = wd; bestC = c; t50 = ax.y; }
  }
  o.c = select(bestC, acc / wsum, wsum > 1e-3);
  o.t50 = t50;
  return o;
}
