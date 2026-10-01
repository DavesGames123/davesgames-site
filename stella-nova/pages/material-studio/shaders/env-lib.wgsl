// ============================================================================
//  MATERIAL STUDIO  ·  shaders/env-lib.wgsl — IBL helper for consumer shaders
// ────────────────────────────────────────────────────────────────────────────
//  Do not load this file directly. Call envWGSL({group, binding}) in env.js:
//  it replaces the $G and $B0..$B5 tokens and returns WGSL that declares the
//  six env bindings and the functions below. Paste it into a viewport shader.
//  Every name starts with "env" or "Env", so it does not collide.
//
//  BINDINGS  (group $G, binding base $B0, all FRAGMENT-visible by default)
//      $B0 envSpecTex  texture_2d<f32>  prefiltered specular equirect, mips by roughness
//      $B1 envSrcTex   texture_2d<f32>  source equirect with a box mip chain
//      $B2 envLutTex   texture_2d<f32>  BRDF LUT, x = N.V, y = roughness
//      $B3 envSamp     sampler          linear, mip linear, repeat U, clamp V
//      $B4 envSH       uniform array<vec4f, 9>  irradiance/pi SH9
//      $B5 envU        uniform EnvU             rotation, grade, background, lights
//
//  FUNCTIONS  (grep -n the name to jump)
//      envLocal ........... world direction -> map direction (rotation)
//      envUV .............. world direction -> equirect uv
//      envGrade ........... intensity, tint and saturation
//      envSpecular ........ prefiltered radiance along R at a roughness
//      envIrradiance ...... diffuse irradiance / pi at normal N
//      envBRDF ............ split-sum (scale, bias) for N.V and roughness
//      envSpecularIBL ..... envSpecular * (F0 * scale + bias), the common case
//      envBackground ...... background color for a view ray (mode hdri/blur/color)
//      envLightCount / envLight  analytic lights from state.env.lights
//
//  UNITS  All values are linear, scene-referred. envIrradiance already
//  divides by pi: diffuse = albedo * envIrradiance(N). Directional light
//  radiance is irradiance at normal incidence; point lights use 1/d^2, and
//  a point range > 0 multiplies a smooth window (1 - (d/range)^4)^2.
// ============================================================================

struct EnvLight {
  posType: vec4f,   // xyz: direction toward the light (w = 0) or position (w = 1 + range)
  color: vec4f,     // rgb: linear color * intensity, w: on (1) or off (0)
};
struct EnvU {
  rot: vec4f,       // cos(rotation), sin(rotation), spec max lod, intensity
  tint: vec4f,      // rgb tint (linear), w saturation
  bg: vec4f,        // rgb background color (linear), w mode: 0 hdri, 1 blur, 2 color
  misc: vec4f,      // x blur 0..1, y light count, z background intensity, w src max lod
  lights: array<EnvLight, 4>,
};

@group($G) @binding($B0) var envSpecTex: texture_2d<f32>;
@group($G) @binding($B1) var envSrcTex: texture_2d<f32>;
@group($G) @binding($B2) var envLutTex: texture_2d<f32>;
@group($G) @binding($B3) var envSamp: sampler;
@group($G) @binding($B4) var<uniform> envSH: array<vec4f, 9>;
@group($G) @binding($B5) var<uniform> envU: EnvU;

fn envLocal(d: vec3f) -> vec3f {
  let c = envU.rot.x;
  let s = envU.rot.y;
  return vec3f((c * d.x) - (s * d.z), d.y, (s * d.x) + (c * d.z));
}

fn envUV(d: vec3f) -> vec2f {
  let l = envLocal(d);
  let lon = atan2(l.x, -l.z);
  let lat = asin(clamp(l.y, -1.0, 1.0));
  return vec2f((lon / 6.28318530717959) + 0.5, 0.5 - (lat / 3.14159265358979));
}

fn envGrade(c: vec3f) -> vec3f {
  let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  return max(mix(vec3f(l), c, envU.tint.w), vec3f(0.0)) * envU.tint.rgb * envU.rot.w;
}

fn envSpecular(R: vec3f, rough: f32) -> vec3f {
  let lod = clamp(rough, 0.0, 1.0) * envU.rot.z;
  return envGrade(textureSampleLevel(envSpecTex, envSamp, envUV(R), lod).rgb);
}

fn envIrradiance(N: vec3f) -> vec3f {
  let d = envLocal(N);
  var c = envSH[0].rgb * 0.282095;
  c += envSH[1].rgb * (0.488603 * d.y);
  c += envSH[2].rgb * (0.488603 * d.z);
  c += envSH[3].rgb * (0.488603 * d.x);
  c += envSH[4].rgb * (1.092548 * d.x * d.y);
  c += envSH[5].rgb * (1.092548 * d.y * d.z);
  c += envSH[6].rgb * (0.315392 * ((3.0 * d.z * d.z) - 1.0));
  c += envSH[7].rgb * (1.092548 * d.x * d.z);
  c += envSH[8].rgb * (0.546274 * ((d.x * d.x) - (d.y * d.y)));
  return envGrade(max(c, vec3f(0.0)));
}

fn envBRDF(nv: f32, rough: f32) -> vec2f {
  let uv = clamp(vec2f(nv, rough), vec2f(0.5 / 256.0), vec2f(1.0 - (0.5 / 256.0)));
  return textureSampleLevel(envLutTex, envSamp, uv, 0.0).rg;
}

fn envSpecularIBL(N: vec3f, V: vec3f, F0: vec3f, rough: f32) -> vec3f {
  let nv = max(dot(N, V), 1e-4);
  let ab = envBRDF(nv, rough);
  let R = reflect(-V, N);
  return envSpecular(R, rough) * ((F0 * ab.x) + vec3f(ab.y));
}

fn envBackground(d: vec3f) -> vec3f {
  let mode = u32(envU.bg.w + 0.5);
  if (mode == 2u) { return envU.bg.rgb * envU.misc.z; }
  if ((mode == 1u) && (envU.misc.x > 0.001)) {
    let lod = clamp(envU.misc.x, 0.0, 1.0) * envU.rot.z;
    return envGrade(textureSampleLevel(envSpecTex, envSamp, envUV(d), lod).rgb) * envU.misc.z;
  }
  return envGrade(textureSampleLevel(envSrcTex, envSamp, envUV(d), 0.0).rgb) * envU.misc.z;
}

fn envLightCount() -> u32 { return u32(envU.misc.y + 0.5); }

struct EnvLightSample {
  L: vec3f,         // unit vector from the surface point toward the light
  radiance: vec3f,  // incident radiance scale (multiply by BRDF * N.L)
};

fn envLight(i: u32, P: vec3f) -> EnvLightSample {
  let lt = envU.lights[min(i, 3u)];
  var s: EnvLightSample;
  if (lt.posType.w < 0.5) {
    s.L = normalize(lt.posType.xyz);
    s.radiance = lt.color.rgb * lt.color.w;
  } else {
    let v = lt.posType.xyz - P;
    let d2 = max(dot(v, v), 1e-4);
    s.L = v * inverseSqrt(d2);
    var win = 1.0;
    let range = lt.posType.w - 1.0;
    if (range > 0.0) {
      let q = d2 / (range * range);
      let k = clamp(1.0 - (q * q), 0.0, 1.0);
      win = k * k;
    }
    s.radiance = lt.color.rgb * ((lt.color.w * win) / d2);
  }
  return s;
}
