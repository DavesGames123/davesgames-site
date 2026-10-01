// ============================================================================
//  MATERIAL STUDIO  ·  shaders/pbr.wgsl — mesh shading for the 3D viewport
// ────────────────────────────────────────────────────────────────────────────
//  viewport.js prepends viewport-common.wgsl and the generated env chunk.
//  Metal-rough PBR: GGX D, height-correlated Smith V, Schlick F, multiple
//  scattering energy compensation, split-sum IBL with the LUT from
//  viewport-lut.wgsl, a clearcoat lobe, Charlie sheen, anisotropic GGX,
//  thin transmission, emissive, AO with specular occlusion, parallax
//  occlusion mapping and vertex displacement from the height map.
//
//  ENTRY POINTS
//      vs_main / fs_main ... the shaded mesh (opaque, mask and blend)
//      vs_shadow / fs_shadow  depth only, key light shadow map (alpha cut-out)
//      vs_wire / fs_wire ... flat color wireframe overlay, nudged toward the eye
//
//  GROUP 1  (material; one bind group per map set, A and B in compare mode)
//      0 M ........ Material uniform
//      1..6 ....... albedo, normal, orm, height, emissive, extra (contract MAP_SLOTS)
//      7 sMap ..... repeat, linear sampler
//
//  OUTPUT
//      Linear HDR radiance, premultiplied alpha. For a debug view the value is
//      the raw channel; the post pass skips the tonemapper for those views.
//
//  SECTIONS  (grep -n the name to jump)
//      struct Material / VIn / VOut
//      displace ......... height map vertex displacement
//      pom .............. parallax occlusion mapping in tangent space
//      brdf ............. D_ggx_aniso, V_smith_aniso, F_schlick, D_charlie, V_neubelt
//      spec_occlusion
//      fs_main .......... the shading, the debug view switch at the end
// ============================================================================

struct Material {
  uvx: vec4f,  // xy uv scale, zw uv offset
  s0: vec4f,   // ior, transmission, displacementScale, emissiveStrength
  s1: vec4f,   // alphaMode (0 opaque, 1 mask, 2 blend), alphaCutoff, parallax depth (uv units, 0 = off), displacement on
  s2: vec4f,   // normal strength, green sign (+1 or -1), anisotropy rotation (rad), sheen roughness
  s3: vec4f,   // parallax max steps, double sided, 0, 0
}

@group(1) @binding(0) var<uniform> M: Material;
@group(1) @binding(1) var tAlbedo: texture_2d<f32>;
@group(1) @binding(2) var tNormal: texture_2d<f32>;
@group(1) @binding(3) var tOrm: texture_2d<f32>;
@group(1) @binding(4) var tHeight: texture_2d<f32>;
@group(1) @binding(5) var tEmissive: texture_2d<f32>;
@group(1) @binding(6) var tExtra: texture_2d<f32>;
@group(1) @binding(7) var sMap: sampler;

struct VIn {
  @location(0) pos: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) tangent: vec4f,
}

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) tangent: vec4f,
}

fn displace(p: vec3f, n: vec3f, uv: vec2f) -> vec3f {
  if (M.s1.w < 0.5) { return p; }
  let h = textureSampleLevel(tHeight, sMap, uv, 0.0).r;
  return p + (n * ((h - 0.5) * 2.0 * M.s0.z));
}

fn vertex_common(v: VIn) -> VOut {
  var o: VOut;
  let uv = (v.uv * M.uvx.xy) + M.uvx.zw;
  let p = displace(v.pos, v.normal, uv);
  o.clip = F.viewProj * vec4f(p, 1.0);
  o.world = p;
  o.normal = v.normal;
  o.uv = uv;
  o.tangent = v.tangent;
  return o;
}

@vertex
fn vs_main(v: VIn) -> VOut { return vertex_common(v); }

struct ShadowOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs_shadow(v: VIn) -> ShadowOut {
  let uv = (v.uv * M.uvx.xy) + M.uvx.zw;
  let p = displace(v.pos, v.normal, uv);
  var o: ShadowOut;
  o.clip = F.shadowMat * vec4f(p, 1.0);
  o.uv = uv;
  return o;
}

/** Shadow caster cut-out: mask uses the alpha cutoff, blend uses 0.5. */
@fragment
fn fs_shadow(s: ShadowOut) {
  if (M.s1.x > 0.5) {
    let a = textureSampleLevel(tAlbedo, sMap, s.uv, 0.0).a;
    let cut = select(0.5, M.s1.y, M.s1.x < 1.5);
    if (a < cut) { discard; }
  }
}

/** Wireframe vertex: vs_main pulled a little toward the camera in clip
 *  space (line topologies cannot use a pipeline depth bias). */
@vertex
fn vs_wire(v: VIn) -> VOut {
  var o = vertex_common(v);
  o.clip = vec4f(o.clip.xy, o.clip.z - (0.0008 * o.clip.w), o.clip.w);
  return o;
}

@fragment
fn fs_wire() -> @location(0) vec4f {
  // premultiplied, 45% coverage: the surface stays readable under dense wires
  return vec4f(0.9, 0.62, 0.12, 1.0) * 0.45;
}

// ------------------------------------------------------------ parallax
/** Find where the eye ray meets the height field. The neutral plane is
 *  height 0.5, so a flat 0.5 map leaves uv unchanged (no swimming).
 *  vts is the direction to the eye in tangent space (x = +u, y = image-up). */
fn pom(uv: vec2f, vts: vec3f, dx: vec2f, dy: vec2f) -> vec2f {
  let depth = M.s1.z;
  let vz = max(vts.z, 0.12);
  let shift = (vec2f(vts.x, -vts.y) / vz) * depth;
  let steps = clamp(mix(M.s3.x, 6.0, vts.z * vts.z), 4.0, 64.0);
  let dz = 1.0 / steps;
  var z = 0.5;
  var prevZ = 0.5;
  var prevD = 0.5 - (textureSampleGrad(tHeight, sMap, uv + (shift * 0.5), dx, dy).r - 0.5);
  var hit = uv;
  for (var i = 0; i < 64; i++) {
    if (f32(i) >= steps) { break; }
    z -= dz;
    let q = uv + (shift * z);
    let h = textureSampleGrad(tHeight, sMap, q, dx, dy).r - 0.5;
    let d = z - h;
    if (d <= 0.0) {
      // linear refinement between the last two samples
      let t = prevD / max(prevD - d, 1e-5);
      let zz = mix(prevZ, z, t);
      hit = uv + (shift * zz);
      return hit;
    }
    prevZ = z;
    prevD = d;
    hit = q;
  }
  return hit;
}

// ------------------------------------------------------------ brdf
fn F_schlick(f0: vec3f, vh: f32) -> vec3f {
  let k = pow(1.0 - clamp(vh, 0.0, 1.0), 5.0);
  return f0 + ((vec3f(1.0) - f0) * k);
}
fn F_schlick1(f0: f32, vh: f32) -> f32 {
  return f0 + ((1.0 - f0) * pow(1.0 - clamp(vh, 0.0, 1.0), 5.0));
}

/** Anisotropic GGX. at along the tangent t, ab along the bitangent b. */
fn D_ggx_aniso(nh: f32, th: f32, bh: f32, at: f32, ab: f32) -> f32 {
  let a2 = at * ab;
  let v = vec3f(ab * th, at * bh, a2 * nh);
  let w = a2 / dot(v, v);
  return a2 * w * w * INV_PI;
}

/** Height-correlated Smith visibility (includes 1 / (4 nl nv)). */
fn V_smith_aniso(nv: f32, nl: f32, tv: f32, bv: f32, tl: f32, bl: f32, at: f32, ab: f32) -> f32 {
  let lv = nl * length(vec3f(at * tv, ab * bv, nv));
  let ll = nv * length(vec3f(at * tl, ab * bl, nl));
  return 0.5 / max(lv + ll, 1e-6);
}

fn D_ggx(nh: f32, a: f32) -> f32 {
  let a2 = a * a;
  let d = ((nh * nh) * (a2 - 1.0)) + 1.0;
  return a2 / (PI * d * d);
}

/** Charlie sheen distribution (inverted Gaussian-like sine power). */
fn D_charlie(nh: f32, r: f32) -> f32 {
  let inv = 1.0 / max(r * r, 1e-3);
  let s2 = max(1.0 - (nh * nh), 1e-5);
  return (2.0 + inv) * pow(s2, inv * 0.5) * (0.5 * INV_PI);
}
fn V_neubelt(nv: f32, nl: f32) -> f32 {
  return 1.0 / max(4.0 * ((nl + nv) - (nl * nv)), 1e-4);
}

/** Specular occlusion from ambient occlusion, view angle and roughness. */
fn spec_occlusion(nv: f32, ao: f32, rough: f32) -> f32 {
  let e = exp2((-16.0 * rough) - 1.0);
  return clamp((pow(nv + ao, e) - 1.0) + ao, 0.0, 1.0);
}

fn max3(v: vec3f) -> f32 { return max(v.x, max(v.y, v.z)); }

fn uv_checker(uv: vec2f) -> vec3f {
  let g = floor(uv * 8.0);
  let c = (i32(g.x) + i32(g.y)) & 1;
  let f = fract(uv);
  let base = vec3f(f.x, f.y, 0.35);
  let edge = select(0.0, 1.0, (f.x < 0.004) || (f.y < 0.004) || (f.x > 0.996) || (f.y > 0.996));
  return mix(base * select(0.55, 1.0, c == 1), vec3f(1.0), edge);
}

// ------------------------------------------------------------ fragment
@fragment
fn fs_main(v: VOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  // derivatives first, in uniform control flow
  let dx = dpdx(v.uv);
  let dy = dpdy(v.uv);

  var ng = normalize(v.normal);
  var t0 = v.tangent.xyz;
  if (!front) { ng = -ng; t0 = -t0; }
  let tl = length(t0);
  var T = select(normalize(cross(vec3f(0.0, 1.0, 0.0), ng) + vec3f(1e-4, 0.0, 0.0)), t0 / max(tl, 1e-6), tl > 1e-6);
  T = normalize(T - (ng * dot(ng, T)));
  let B = cross(ng, T) * select(-1.0, 1.0, v.tangent.w >= 0.0);

  let V = normalize(F.camPos.xyz - v.world);
  var uv = v.uv;
  if ((M.s1.z > 0.0) && (M.s1.w < 0.5)) {
    let vts = vec3f(dot(V, T), dot(V, B), dot(V, ng));
    uv = pom(v.uv, vts, dx, dy);
  }

  let albedoS = textureSampleGrad(tAlbedo, sMap, uv, dx, dy);
  let nS = textureSampleGrad(tNormal, sMap, uv, dx, dy).xyz;
  let orm = textureSampleGrad(tOrm, sMap, uv, dx, dy);
  let hS = textureSampleGrad(tHeight, sMap, uv, dx, dy).r;
  let emS = textureSampleGrad(tEmissive, sMap, uv, dx, dy).rgb;
  let ex = textureSampleGrad(tExtra, sMap, uv, dx, dy);

  let alpha = clamp(albedoS.a, 0.0, 1.0);
  if ((M.s1.x > 0.5) && (M.s1.x < 1.5) && (alpha < M.s1.y)) { discard; }

  var nt = (nS * 2.0) - vec3f(1.0);
  nt = vec3f(nt.x * M.s2.x, nt.y * M.s2.x * M.s2.y, max(nt.z, 1e-3));
  let N = normalize((T * nt.x) + (B * nt.y) + (ng * nt.z));

  let base = max(albedoS.rgb, vec3f(0.0));
  let ao = clamp(orm.r, 0.0, 1.0);
  let perceptual = clamp(orm.g, 0.03, 1.0);
  let metal = clamp(orm.b, 0.0, 1.0);
  let rough = perceptual * perceptual;
  let ior = max(M.s0.x, 1.0);
  let f0d = ((ior - 1.0) / (ior + 1.0)) * ((ior - 1.0) / (ior + 1.0));
  let f0 = mix(vec3f(f0d), base, metal);
  let trans = clamp(M.s0.y, 0.0, 1.0) * (1.0 - metal);
  let diffColor = base * (1.0 - metal);
  let cc = clamp(ex.r, 0.0, 1.0);
  let ccRough = clamp(ex.g, 0.03, 1.0);
  let sheenAmt = clamp(ex.b, 0.0, 1.0);
  let sheenColor = sheenAmt * mix(vec3f(1.0), base, 0.6);
  let sheenRough = clamp(M.s2.w, 0.07, 1.0);
  let aniso = clamp(ex.a, -1.0, 1.0);

  // anisotropy frame: tangent rotated by M.s2.z, re-orthogonalized to N
  let cr = cos(M.s2.z);
  let sr = sin(M.s2.z);
  var Ta = (T * cr) + (B * sr);
  Ta = normalize(Ta - (N * dot(N, Ta)));
  let Ba = cross(N, Ta);
  let at = max(mix(rough, 1.0, aniso * aniso * step(0.0, aniso)), 0.0025);
  let ab = max(mix(rough, 1.0, aniso * aniso * step(aniso, 0.0)), 0.0025);

  let nv = max(dot(N, V), 1e-4);
  let lut = textureSampleLevel(tLut, sClamp, vec2f(nv, perceptual), 0.0);
  let Ess = lut.r + lut.g;
  let FssEss = (f0 * lut.r) + vec3f(lut.g);
  let Ems = 1.0 - Ess;
  let Favg = f0 + ((vec3f(1.0) - f0) / 21.0);
  let Fms = (FssEss * Favg) / (vec3f(1.0) - (Favg * Ems));
  let specE = FssEss + (Fms * Ems);
  let energyComp = vec3f(1.0) + (f0 * ((1.0 / max(Ess, 1e-3)) - 1.0));

  // clearcoat and sheen layering weights
  let nvc = max(dot(ng, V), 1e-4);
  let Fcc = F_schlick1(0.04, nvc) * cc;
  let lutS = textureSampleLevel(tLut, sClamp, vec2f(nv, sheenRough), 0.0);
  let sheenE = lutS.b;
  let sheenScale = 1.0 - (max3(sheenColor) * sheenE);
  let layer = (1.0 - Fcc) * sheenScale;

  // -------- image based light
  let mips = max(F.env.z, 1.0);
  // anisotropic bent normal for the reflection vector
  let aDir = select(Ta, Ba, aniso >= 0.0);
  let aT = cross(aDir, V);
  let aN = cross(aT, aDir);
  let bend = abs(aniso) * clamp(perceptual * 4.0, 0.0, 1.0);
  let Nr = normalize(mix(N, aN, bend));
  var R = reflect(-V, Nr);
  R = normalize(mix(R, Nr, rough * rough));
  let horizon = clamp(1.0 + dot(R, ng), 0.0, 1.0);
  let specRad = env_radiance(R, perceptual * (mips - 1.0)) * (horizon * horizon);
  let irr = env_irradiance(N);
  let so = mix(1.0, spec_occlusion(nv, ao, rough), F.params.w);

  var iblDiff = irr * diffColor * (vec3f(1.0) - specE) * (1.0 - trans) * ao;
  var iblSpec = specRad * specE * so;
  // thin transmission: the environment behind the surface, tinted by base
  if (trans > 0.0) {
    let Rt = refract(-V, N, 1.0 / ior);
    let tdir = select(-V, Rt, dot(Rt, Rt) > 0.0);
    let tcol = env_radiance(tdir, perceptual * (mips - 1.0)) * base * trans * (vec3f(1.0) - specE);
    iblDiff += tcol;
  }
  let iblSheen = irr * sheenColor * sheenE * ao;
  let Rc = reflect(-V, ng);
  let lutC = textureSampleLevel(tLut, sClamp, vec2f(nvc, ccRough), 0.0);
  let iblCoat = env_radiance(Rc, ccRough * (mips - 1.0)) * (cc * ((0.04 * lutC.r) + lutC.g)) * so;

  var diffuse = iblDiff * layer;
  var specular = (iblSpec * layer) + (iblSheen * (1.0 - Fcc)) + iblCoat;

  // -------- analytic lights
  let n = u32(F.params.y);
  for (var i = 0u; i < 4u; i++) {
    if (i >= n) { break; }
    let Lt = F.lights[i];
    if (Lt.pos.w < 0.5) { continue; }
    var L = normalize(Lt.pos.xyz);
    var radiance = Lt.color.rgb;
    if (Lt.pos.w > 1.5) {
      let d = Lt.pos.xyz - v.world;
      let d2 = max(dot(d, d), 1e-4);
      L = d * inverseSqrt(d2);
      // optional range window (1 - (d/range)^4)^2, the same as env.js
      let range = Lt.pos.w - 2.0;
      var win = 1.0;
      if (range > 0.0) {
        let q = d2 / (range * range);
        let k = clamp(1.0 - (q * q), 0.0, 1.0);
        win = k * k;
      }
      radiance = (radiance * win) / d2;
    }
    var vis = 1.0;
    if (Lt.color.w > 0.5) { vis = mix(1.0, shadow_key(v.world, ng), F.params.z); }
    let nl = dot(N, L);
    let H = normalize(L + V);
    let nh = max(dot(N, H), 0.0);
    let vh = max(dot(V, H), 0.0);
    let nlc = clamp(nl, 0.0, 1.0);
    let Fs = F_schlick(f0, vh);
    let D = D_ggx_aniso(nh, dot(Ta, H), dot(Ba, H), at, ab);
    let Vv = V_smith_aniso(nv, nlc, dot(Ta, V), dot(Ba, V), dot(Ta, L), dot(Ba, L), at, ab);
    let spec = Fs * (D * Vv) * energyComp;
    let diff = diffColor * INV_PI * (vec3f(1.0) - Fs) * (1.0 - trans);
    let Ds = D_charlie(nh, sheenRough);
    let sheen = sheenColor * (Ds * V_neubelt(nv, nlc));
    // clearcoat on the geometric normal
    let nlg = clamp(dot(ng, L), 0.0, 1.0);
    let nhg = max(dot(ng, H), 0.0);
    let Fc = F_schlick1(0.04, vh) * cc;
    let coat = Fc * D_ggx(nhg, max(ccRough * ccRough, 0.0025)) * (0.25 / max(vh * vh, 1e-3));
    let lit = radiance * vis;
    diffuse += diff * lit * nlc * layer;
    specular += (((spec * layer) + (sheen * (1.0 - Fcc))) * nlc + vec3f(coat * nlg)) * lit;
  }

  let emissive = emS * M.s0.w;
  var color = diffuse + specular + emissive;

  // -------- debug views (contract DEBUG_VIEWS order, then 'ndotl')
  let dbg = i32(F.params.x + 0.5);
  if (dbg != 0) {
    var c = vec3f(0.0);
    switch dbg {
      case 1: { c = base; }
      case 2: { c = vec3f(alpha); }
      case 3: { c = nS; }
      case 4: { c = (N * 0.5) + vec3f(0.5); }
      case 5: { c = vec3f(ao); }
      case 6: { c = vec3f(orm.g); }
      case 7: { c = vec3f(metal); }
      case 8: { c = vec3f(hS); }
      case 9: { c = emissive; }
      case 10: { c = vec3f(cc, ccRough * cc, 0.0) + vec3f(0.0, 0.0, cc * 0.3); }
      case 11: { c = sheenColor; }
      case 12: { c = (vec3f(max(aniso, 0.0), 0.0, max(-aniso, 0.0))) + ((Ta * 0.5 + vec3f(0.5)) * 0.25); }
      case 13: { c = uv_checker(uv); }
      case 14: { c = diffuse; }
      case 15: { c = specular; }
      case 16: {
        let k = select(F.keyDir.xyz, normalize(F.lights[0].pos.xyz), (F.params.y > 0.5) && (F.lights[0].pos.w > 0.5) && (F.lights[0].pos.w < 1.5));
        c = vec3f(clamp(dot(N, normalize(k)), 0.0, 1.0));
      }
      default: { c = color; }
    }
    return vec4f(c, 1.0);
  }

  // premultiplied output: the blend mode scales only the diffuse part
  if (M.s1.x > 1.5) {
    return vec4f((diffuse * alpha) + specular + emissive, alpha);
  }
  return vec4f(color, 1.0);
}
