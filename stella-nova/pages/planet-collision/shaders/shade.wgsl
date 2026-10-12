// ============================================================================
//  PLANET COLLISION  ·  shaders/shade.wgsl — sky, the lit fluid surface,
//  atmospheres and the vapour (after common.wgsl)
// ----------------------------------------------------------------------------
//  Full-screen passes on one triangle (vs_full), in the scene pass:
//    fs_sky       stars and the sun disc (the roche-limit sky, cut down).
//    fs_surface   the smoothed depth (smooth.wgsl) -> position and normal;
//                 the coverage -> the outline, blended over one pixel;
//                 the fields of fluid.wgsl fs_attr -> albedo, temperature,
//                 speed; lit by the sun with shadows of the bodies (spheres
//                 at centres[b], only while U.bodies[b].w > 0), a gloss on
//                 oceans, iron and melt, and the glow of hot matter (fn glow
//                 in common.wgsl). The atmospheres of the bodies (spheres
//                 at centres[b], drawn, not simulated) add along each ray
//                 up to the surface. Writes depth, so debris and streaks
//                 hide behind the surface. Premultiplied: alpha 0 where
//                 there is no fluid (the sky shows, the atmosphere adds).
//    fs_vapour    the vapour thickness of fluid.wgsl fs_thick (half size,
//                 filtered) -> opacity 1 - exp(-k chord), sharpened at the
//                 edge; lit condensate plus a weak glow at the skin
//                 temperature (fn skinT). Premultiplied.
//
//  grep -n targets: "fn vs_full", "fn fs_sky", "fn normalAt", "fn shadowAt",
//  "fn atmosphere", "fn fs_surface", "fn fs_vapour"
// ============================================================================

@group(2) @binding(0) var sZ: texture_2d<f32>;      // smoothed view depth, coverage (rg32float)
@group(2) @binding(1) var a0Tex: texture_2d<f32>;
@group(2) @binding(2) var a1Tex: texture_2d<f32>;
@group(2) @binding(3) var a2Tex: texture_2d<f32>;
@group(2) @binding(4) var thickTex: texture_2d<f32>;

struct VOut { @builtin(position) pos: vec4f };
@vertex
fn vs_full(@builtin(vertex_index) vi: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  return o;
}

@fragment
fn fs_sky(in: VOut) -> @location(0) vec4f {
  let d = normalize(rayAt(in.pos.xy));
  var col = vec3f(0.003, 0.004, 0.007);
  for (var lv = 0; lv < 2; lv++) {
    let sc = select(90.0, 210.0, lv == 1);
    let q = d * sc;
    let cell = floor(q);
    let hsh = hash3(cell + vec3f(f32(lv) * 7.0));
    if (hsh > 0.985) {
      let off = vec3f(hash3(cell + vec3f(1.0, 0.0, 0.0)), hash3(cell + vec3f(0.0, 1.0, 0.0)), hash3(cell + vec3f(0.0, 0.0, 1.0)));
      let sp = cell + 0.2 + 0.6 * off;
      let dist = length(q - sp);
      let mag = pow((hsh - 0.985) / 0.015, 3.0);
      let tint = mix(vec3f(1.0, 0.75, 0.55), vec3f(0.7, 0.82, 1.0), hash3(cell + vec3f(3.0, 5.0, 7.0)));
      col = col + tint * mag * 2.0 * exp(-dist * dist * select(140.0, 260.0, lv == 1));
    }
  }
  let gn = normalize(vec3f(0.3, -0.5, 0.81));
  let band = exp(-pow(dot(d, gn) / 0.22, 2.0));
  if (band > 0.02) {
    let q = d * 3.0 + vec3f(2.0);
    let neb = 0.5 * vnoise(q) + 0.25 * vnoise(q * 2.03 + vec3f(1.7, 9.2, 3.1));
    col = col + band * (0.008 + 0.018 * neb) * mix(vec3f(0.55, 0.45, 0.70), vec3f(0.40, 0.55, 0.75), neb);
  }
  let cs = dot(d, U0.sun.xyz);
  col = col + vec3f(1.0, 0.92, 0.80) * (smoothstep(0.99996, 0.99999, cs) * 60.0 + pow(max(cs, 0.0), 900.0) * 1.5 + pow(max(cs, 0.0), 40.0) * 0.03);
  return vec4f(col, 1.0);
}

// the smoothed depth where the coverage is over 0.5, else 0 (no surface)
fn zAt(p: vec2i) -> f32 {
  let s = vec2i(textureDimensions(sZ));
  let t = textureLoad(sZ, clamp(p, vec2i(0), s - vec2i(1)), 0);
  return select(0.0, t.x, t.y >= 0.5);
}
fn covAt(p: vec2i) -> f32 {
  let s = vec2i(textureDimensions(sZ));
  return textureLoad(sZ, clamp(p, vec2i(0), s - vec2i(1)), 0).y;
}
fn posAt(p: vec2i, z: f32) -> vec3f { return U0.eye.xyz + rayAt(vec2f(p) + 0.5) * z; }
// The normal from the smoothed depth: on each axis the one-sided
// difference with the smaller depth step (a silhouette or a fold uses the
// side that is on the same surface).
fn normalAt(p: vec2i, z: f32, P: vec3f) -> vec3f {
  let zr = zAt(p + vec2i(1, 0)); let zl = zAt(p - vec2i(1, 0));
  let zd = zAt(p + vec2i(0, 1)); let zu = zAt(p - vec2i(0, 1));
  let leftX = zl > 0.0 && abs(zl - z) < abs(zr - z);
  let upY = zu > 0.0 && abs(zu - z) < abs(zd - z);
  var dx = posAt(p + vec2i(1, 0), zr) - P;
  if (zr <= 0.0 || leftX) { dx = P - posAt(p - vec2i(1, 0), zl); }
  var dy = posAt(p + vec2i(0, 1), zd) - P;
  if (zd <= 0.0 || upY) { dy = P - posAt(p - vec2i(0, 1), zu); }
  if (zr <= 0.0 && zl <= 0.0) { dx = U0.right.xyz; }
  if (zd <= 0.0 && zu <= 0.0) { dy = -U0.up.xyz; }
  var n = normalize(cross(dy, dx));
  if (dot(n, U0.eye.xyz - P) < 0.0) { n = -n; }
  return n;
}
// The sun light at P left by the other bodies: spheres at centres[b] with
// the drawn radius, while the page says the bodies are whole (bodies[b].w).
fn shadowAt(P: vec3f) -> f32 {
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
// The atmosphere shells along the ray e + t D (D unit) up to tEnd:
// optical path through the shell, lit by the sun, a red edge at the
// terminator (roche-limit fs_atmo, one shell per body).
fn atmosphere(e: vec3f, D: vec3f, tEnd: f32) -> vec3f {
  var col = vec3f(0.0);
  let L = U0.sun.xyz;
  for (var b = 0; b < 4; b++) {
    let fade = U0.bodies[b].z;
    let th = U0.atm[b].w;
    if (fade <= 0.0 || th <= 0.0 || centres[b].w < 1.0) { continue; }
    let c = centres[b].xyz;
    let R = U0.bodies[b].y;
    let Ra = R * (1.0 + th);
    let oc = e - c;
    let bq = dot(oc, D);
    let h = bq * bq - (dot(oc, oc) - Ra * Ra);
    if (h <= 0.0) { continue; }
    let sq = sqrt(h);
    let t0 = max(-bq - sq, 0.0);
    var t1 = min(-bq + sq, tEnd);
    let hr = bq * bq - (dot(oc, oc) - R * R);
    if (hr > 0.0) { let ti = -bq - sqrt(hr); if (ti > 0.0) { t1 = min(t1, ti); } }
    if (t1 <= t0) { continue; }
    let tc = clamp(-bq, t0, t1);
    let pc = oc + tc * D;
    let bw = length(pc);
    let dens = exp(-(max(bw / R, 1.0) - 1.0) / (th * 0.33));
    let chord = (t1 - t0) / (th * R);
    let ill = smoothstep(-0.35, 0.35, dot(pc / bw, L));
    let sunset = smoothstep(0.35, -0.05, dot(pc / bw, L)) * ill;
    let fwdS = pow(max(dot(D, L), 0.0), 8.0);
    let amount = (1.0 - exp(-0.6 * dens * chord)) * ill * fade;
    col = col + mix(U0.atm[b].rgb, vec3f(1.0, 0.45, 0.22), sunset) * amount * U0.sun.w * (0.9 + 2.5 * fwdS);
  }
  return col;
}

struct SurfOut { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 };
@fragment
fn fs_surface(in: VOut) -> SurfOut {
  var o: SurfOut;
  let p = vec2i(in.pos.xy);
  let Dn = normalize(rayAt(in.pos.xy));
  let e = U0.eye.xyz;
  // the outline: coverage 0.5, blended over one pixel of its gradient
  let cov = covAt(p);
  let gx = covAt(p + vec2i(1, 0)) - covAt(p - vec2i(1, 0));
  let gy = covAt(p + vec2i(0, 1)) - covAt(p - vec2i(0, 1));
  let fw = max(0.5 * length(vec2f(gx, gy)), 1e-3);
  let edge = clamp(0.5 + (cov - 0.5) / fw, 0.0, 1.0);
  let zRaw = textureLoad(sZ, p, 0).x;
  if (edge <= 0.0 || zRaw <= 0.0) {
    o.color = vec4f(atmosphere(e, Dn, 1e9), 0.0);
    o.depth = 0.0;
    return o;
  }
  let z = zRaw;
  let P = posAt(p, z);
  let n = normalAt(p, z, P);
  let a0 = textureLoad(a0Tex, p, 0);
  let a1 = textureLoad(a1Tex, p, 0);
  let a2 = textureLoad(a2Tex, p, 0);
  let w = max(a0.x, 1e-7);
  let T = 1000.0 * a0.y / w;
  let fIron = clamp(a0.z / w, 0.0, 1.0);
  let fIce = clamp(a0.w / w, 0.0, 1.0);
  let og = a1.xyz / w;
  let b1 = clamp(a1.w / w, 0.0, 1.0);
  let speed = a2.x / w;
  let mixw = clamp(a2.y / w, 0.0, 1.0);
  let cutF = clamp(a2.z / w, 0.0, 1.0);
  let L = U0.sun.xyz;
  let V = -Dn;
  let ndl = dot(n, L);
  let shadow = shadowAt(P);
  let diff = max(ndl, 0.0) * shadow;
  let mode = i32(U0.mode.x + 0.5);
  var col = vec3f(0.0);
  if (mode == 0) {
    let bi = select(0, 1, b1 > 0.5);
    let style = i32(U0.bodies[bi].x + 0.5);
    // the map level from the size of the body on screen
    let Rpx = U0.bodies[bi].y * U0.fwd.w / max(z, 1e-4);
    let lod = clamp(log2(1024.0 / max(6.2832 * Rpx, 1.0)), 0.0, 6.0);
    let alb = matAlbedo(og, fIron, fIce, style, lod);
    let Tm = tMelt(fIron, fIce);
    let hot = smoothstep(0.7 * Tm, Tm, T);
    let melt = smoothstep(Tm, 1.2 * Tm, T);
    // hot rock darkens before it glows; a cut face shows the inside as it is
    let base = alb.rgb * (1.0 - 0.7 * hot);
    // the visible skin: cooled crust plates and hot cracks (fn crustSkin)
    // (the frame of the target body: the remnant, where most crust forms)
    let skin = crustSkin(T, (P - centres[0].xyz) / max(U0.bodies[0].y, 1e-4), 7.0);
    let H = normalize(L + V);
    let gloss = clamp(alb.w + 0.5 * melt * (1.0 - skin.y), 0.0, 1.0);
    let spec = gloss * pow(max(dot(n, H), 0.0), mix(40.0, 160.0, melt)) * diff * (0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0) + 0.25);
    col = base * (U0.sun.w * diff + U0.view.w) + vec3f(spec) * U0.sun.w * 0.6 + glow(skin.x);
    col = col * (1.0 - 0.15 * cutF);
  } else {
    let mc = modeColor(mode, T, b1, mixw, speed, fIron, fIce);
    col = mc * (0.30 + 0.70 * max(ndl, 0.0) * mix(1.0, shadow, 0.6));
  }
  col = col + atmosphere(e, Dn, dot(P - e, Dn));
  // premultiplied: the edge pixel lets the sky (and the atmosphere) through
  o.color = vec4f(col * edge + atmosphere(e, Dn, 1e9) * (1.0 - edge), edge);
  o.depth = select(0.0, depthOfZ(z), edge >= 0.5);
  return o;
}

@fragment
fn fs_vapour(in: VOut) -> @location(0) vec4f {
  let uv = in.pos.xy * U0.vpSize.zw;
  let t = textureSampleLevel(thickTex, linSamp, uv, 0.0);
  if (t.x <= 1e-6) { discard; }
  let T = 10000.0 * t.y / t.x;
  let op = 1.0 - exp(-U0.vap.x * t.x);
  // a crisp edge: the opacity rises over a short range, then saturates
  let a = clamp(smoothstep(0.03, 0.22, op) * min(op * 1.4, 0.94), 0.0, 1.0);
  if (a <= 0.002) { discard; }
  let D = normalize(rayAt(in.pos.xy));
  let fwdS = pow(max(dot(D, U0.sun.xyz), 0.0), 6.0);
  // silicate condensate: grey-white, lit from the sun (more toward it)
  let lit = vec3f(0.78, 0.76, 0.74) * U0.sun.w * (0.35 + 0.5 * fwdS) + vec3f(U0.view.w);
  let col = lit + glow(skinT(T, 0.6)) * U0.vap.w;
  return vec4f(col * a, a);
}
