// ============================================================================
//  PLANET COLLISION  ·  shaders/shade.wgsl — sky, the lit fluid surface,
//  atmospheres and the smoke composite (after common.wgsl, scene.wgsl)
// ----------------------------------------------------------------------------
//  Full-screen passes on one triangle (vs_full), in the scene pass:
//    fs_sky       stars and the sun disc (the roche-limit sky, cut down).
//    fs_surface   the smoothed depth (smooth.wgsl) -> position; the normal
//                 of the depth pass (the field gradient of march.wgsl, or
//                 the sphere of fluid.wgsl), else from the depth;
//                 the coverage -> the outline, blended over one pixel;
//                 the fields of fluid.wgsl fs_attr -> albedo, temperature,
//                 speed; lit by the sun with shadows (scene.wgsl fn sunAt:
//                 a march of the density volume toward the sun, the sphere
//                 shadows while U.bodies[b].w > 0, and the smoke), a gloss on
//                 oceans, iron and melt, and the glow of hot matter (fn glow
//                 in common.wgsl). The atmospheres of the bodies (spheres
//                 at centres[b], drawn, not simulated) add along each ray
//                 up to the surface. Writes depth, so debris and streaks
//                 hide behind the surface. Premultiplied: alpha 0 where
//                 there is no fluid (the sky shows, the atmosphere adds).
//    fs_smokeComp the smoke (smoke.wgsl, half size, after the temporal
//                 pass) over the scene, premultiplied; scene.wgsl fn
//                 smokeAt upsamples it with the depth of each pixel.
//  The bindings of group 2 and the shadow helpers are in scene.wgsl.
//
//  grep -n targets: "fn vs_full", "fn fs_sky", "fn normalAt",
//  "fn atmosphere", "fn fs_surface", "fn fs_smokeComp"
// ============================================================================

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
  // the normal of the depth pass (the volume gradient or the sphere), or
  // from the smoothed depth on the pixels that the outline blur adds
  let nt = textureLoad(nTex, p, 0);
  var n = normalAt(p, z, P);
  if (nt.w > 0.5) { n = normalize(nt.xyz); }
  let a0 = textureLoad(a0Tex, p, 0);
  let a1 = textureLoad(a1Tex, p, 0);
  let a2 = textureLoad(a2Tex, p, 0);
  let w = max(a0.x, 1e-7);
  // the mean of log T (a geometric mean): one wall-heated particle does
  // not paint its own hot bead on the surface
  let T = exp2(16.0 * a0.y / w);
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
  let mode = i32(U0.mode.x + 0.5);
  // the volume march only after contact (before it the sphere shadows
  // are exact: the bodies are whole)
  let shadow = sunAt(P, n, select(0, 16, (mode == 0) && (coolH() >= 0.0)));
  var col = vec3f(0.0);
  if (mode == 0) {
    let bi = select(0, 1, b1 > 0.5);
    let style = i32(U0.bodies[bi].x + 0.5);
    // the map level from the size of the body on screen
    let Rpx = U0.bodies[bi].y * U0.fwd.w / max(z, 1e-4);
    let lod = clamp(log2(1024.0 / max(6.2832 * Rpx, 1.0)), 0.0, 6.0);
    let alb = matAlbedo(og, fIron, fIce, select(style, -1, cutF > 0.5), lod);
    let Tm = tMelt(fIron, fIce);
    // a cut face shows the hot inside of a planet (fn geotherm, drawn:
    // the solver starts cold), layer by layer
    // (the impact heat on it is held to 6000 K: SPH wall heating puts
    // 20000 K and more in places, which would draw blue-white)
    let Ti = select(T, max(min(T, 6000.0), geotherm(length(og), fIron)), cutF > 0.5);
    let hot = smoothstep(0.7 * Tm, Tm, Ti);
    let melt = smoothstep(Tm, 1.2 * Tm, Ti);
    // relief of the procedural bodies (pre-contact surfaces): bump the
    // normal while the crust is cold and whole
    let lo = length(og);
    if (cutF < 0.5 && lo > 0.85 && T < 0.7 * Tm) {
      n = normalize(n - 0.35 * smoothstep(0.85, 0.97, lo) * reliefGrad(style, og / max(lo, 1e-4)));
    }
    let ndl2 = dot(n, L);
    let diff = max(ndl2, 0.0) * shadow;
    // hot rock darkens before it glows; a cut face shows the inside as it is
    let base = alb.rgb * (1.0 - 0.7 * hot);
    // the visible skin: flowing melt, a crust that skins over as it cools
    // and glowing seams (fn lavaSkin) (the frame of the target body: the
    // remnant, where most crust forms)
    var skin = lavaSkin(T, (P - centres[0].xyz) / max(U0.bodies[0].y, 1e-4), 5.0);
    if (cutF > 0.5) { skin = vec2f(Ti, 0.0); }
    // the cut face: a low gain (1/15), so the layers read: a yellow-white
    // core, an orange mantle that darkens outward, a dark crust
    let em = select(glow(skin.x), glowG(skin.x, 0.04), cutF > 0.5);
    let H = normalize(L + V);
    let gloss = clamp(alb.w + 0.8 * melt * (1.0 - skin.y), 0.0, 1.0);
    // wet melt: a tight, bright highlight with a Fresnel rise (F0 0.05)
    let fres = 0.05 + 0.95 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
    // no highlight on and round a cut face (its rim blends two normals)
    let spec = gloss * pow(max(dot(n, H), 0.0), mix(40.0, 220.0, melt)) * diff * (fres + 0.2) * mix(1.0, 3.0, melt) * (1.0 - smoothstep(0.0, 0.3, cutF));
    // light from the glowing matter round about after contact (the night
    // sides are not black): a warm fill at the skin cap
    let fill = select(vec3f(0.0), glow(skinCap(0.6)) * (0.035 * (1.0 - 0.7 * crustShare())), coolH() >= 0.0);
    // the crust is thin: some glow of the melt under it shows through
    let under = glow(skinT(T, 0.6)) * (0.07 * skin.y * melt);
    col = base * (U0.sun.w * diff + U0.view.w + fill * (0.5 + 0.5 * max(-ndl2, 0.0))) + vec3f(spec) * U0.sun.w * 0.6 + em + under;
  } else {
    let mc = modeColor(mode, T, b1, mixw, speed, fIron, fIce);
    col = mc * (0.30 + 0.70 * max(ndl, 0.0) * mix(1.0, shadow, 0.6));
  }
  // the shell in front of the disc: thinner than at the limb, so the
  // surface (crust, oceans) reads through it
  col = col + 0.18 * atmosphere(e, Dn, dot(P - e, Dn));
  // premultiplied: the edge pixel lets the sky (and the atmosphere) through
  o.color = vec4f(col * edge + atmosphere(e, Dn, 1e9) * (1.0 - edge), edge);
  o.depth = select(0.0, depthOfZ(z), edge >= 0.5);
  return o;
}

// The smoke over the scene (premultiplied): the half-size result of
// smoke.wgsl, upsampled with the depth of this pixel (fn smokeAt).
@fragment
fn fs_smokeComp(in: VOut) -> @location(0) vec4f {
  let p = vec2i(in.pos.xy);
  let z = zAt(p);
  let s = smokeAt(in.pos.xy, select(1e9, z, z > 0.0));
  if (s.c.a <= 0.001 && max(s.c.r, max(s.c.g, s.c.b)) <= 1e-5) { discard; }
  return s.c;
}
