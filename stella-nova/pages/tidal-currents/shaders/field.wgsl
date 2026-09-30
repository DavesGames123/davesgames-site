// field.wgsl — rebuild the current field for one frame from the EOF textures.
//
// One invocation per data pixel. The pass writes (u, v, T, coverage) into an
// rgba16float storage texture: u east and v north in m/s, T in deg C.
// The CPU interpolates the coefficient rows over hours and writes them to F.

struct FieldU {
  vel: array<vec4f, 4>,   // velocity coefficients 0..15 (unused ones are 0)
  temp: vec4f,            // temperature coefficients 0..3
  meanVelScale: f32,
  tMin: f32,
  tMax: f32,
  velModes: f32,
};

@group(0) @binding(0) var<uniform> F: FieldU;
@group(0) @binding(1) var baseTex: texture_2d<f32>;
@group(0) @binding(2) var velTex: texture_2d_array<f32>;
@group(0) @binding(3) var tempTex: texture_2d<f32>;
@group(0) @binding(4) var outTex: texture_storage_2d<rgba16float, write>;

// Signed decode of an 8-bit channel: 128 is zero, 1 and 255 are -1 and +1.
fn sdec(c: vec4f) -> vec4f {
  return clamp((c * 255.0 - 128.0) / 127.0, vec4f(-1.0), vec4f(1.0));
}

fn coef(k: u32) -> f32 {
  return F.vel[k / 4u][k % 4u];
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(baseTex);
  if (id.x >= dim.x || id.y >= dim.y) { return; }
  let p = vec2i(id.xy);
  let b = textureLoad(baseTex, p, 0);
  var uv = sdec(b).zw * F.meanVelScale;
  let layers = min(textureNumLayers(velTex), u32(F.velModes + 1.0) / 2u);
  for (var n = 0u; n < layers; n++) {
    let m = sdec(textureLoad(velTex, p, n, 0));
    uv += coef(2u * n) * m.xy + coef(2u * n + 1u) * m.zw;
  }
  let t = F.tMin + b.g * (F.tMax - F.tMin) + dot(F.temp, sdec(textureLoad(tempTex, p, 0)));
  textureStore(outTex, p, vec4f(uv, t, b.r));
}
