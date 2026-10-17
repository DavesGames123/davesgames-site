// ============================================================================
//  dla-terrain-detail.wgsl  ·  relief below one texel (WGSL twin of
//  detailHeight in lib/dla-terrain.js)
// ----------------------------------------------------------------------------
//  CORE joins pages/dla-terrain/shaders/common.wgsl and this file in front
//  of every package shader. This file uses only these names from
//  common.wgsl: G.terrain (x world size m), G.terrainOrigin (xy world xz
//  origin), tHeight (r32float, m) and tAux (rgba16float: g river 0..1,
//  a water depth m). All other names here start with dlat_.
//
//  fn detailHeight(xz: vec2f) -> f32   metres, add to the bilinear height
//
//  TEXEL FRAME  texel (i, j) is the sample at origin + (vec2(i, j) + 0.5) *
//  texel, texel = G.terrain.x / n, n = textureDimensions(tHeight).x. The
//  same frame as sampleHeight() in lib/dla-terrain.js.
//
//  HOW  Five octaves of gradient noise on lattices of texel / 2^k. The
//  lattice is anchored at the texel grid: the integer cell index is
//  ix * 2^k + floor(f * 2^k), so it is exact in f32 at any world size. The
//  hash is PCG (u32), the same bits in JS. On steep ground (slope from
//  tHeight central differences at the four corner texels) the relief is
//  ridged and larger; on river beds and under water it goes to zero. The
//  masks are bilinear over the four corner texels, so there are no seams.
//
//  grep -n targets: "fn dlat_pcg", "fn dlat_noise", "fn detailHeight"
// ============================================================================

fn dlat_pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn dlat_hash(ix: i32, iy: i32, k: u32) -> u32 {
  return dlat_pcg(bitcast<u32>(ix) ^ dlat_pcg(bitcast<u32>(iy) + (k * 0x9E3779B9u)));
}

fn dlat_grad(h: u32, f: vec2f, o: vec2f) -> f32 {
  let g = vec2f(f32(h & 0xffffu) / 32767.5 - 1.0, f32(h >> 16u) / 32767.5 - 1.0);
  return dot(g, f - o);
}

// one octave of gradient noise at integer cell c and fraction f
fn dlat_noise(c: vec2i, f: vec2f, k: u32) -> f32 {
  let a = dlat_grad(dlat_hash(c.x, c.y, k), f, vec2f(0.0, 0.0));
  let b = dlat_grad(dlat_hash(c.x + 1, c.y, k), f, vec2f(1.0, 0.0));
  let c2 = dlat_grad(dlat_hash(c.x, c.y + 1, k), f, vec2f(0.0, 1.0));
  let d = dlat_grad(dlat_hash(c.x + 1, c.y + 1, k), f, vec2f(1.0, 1.0));
  let u = f * f * (vec2f(3.0) - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c2, d, u.x), u.y);
}

fn dlat_h(i: i32, j: i32, n: i32) -> f32 {
  return textureLoad(tHeight, vec2i(clamp(i, 0, n - 1), clamp(j, 0, n - 1)), 0).r;
}

fn dlat_slope(i: i32, j: i32, n: i32, texel: f32) -> f32 {
  let gx = dlat_h(i + 1, j, n) - dlat_h(i - 1, j, n);
  let gz = dlat_h(i, j + 1, n) - dlat_h(i, j - 1, n);
  return length(vec2f(gx, gz)) / (2.0 * texel);
}

fn detailHeight(xz: vec2f) -> f32 {
  let n = i32(textureDimensions(tHeight).x);
  let texel = G.terrain.x / f32(n);
  let p = clamp((xz - G.terrainOrigin.xy) / texel - vec2f(0.5), vec2f(0.0), vec2f(f32(n - 1)));
  let ix = min(i32(floor(p.x)), n - 2);
  let iz = min(i32(floor(p.y)), n - 2);
  let f = p - vec2f(f32(ix), f32(iz));

  let s = mix(mix(dlat_slope(ix, iz, n, texel), dlat_slope(ix + 1, iz, n, texel), f.x),
              mix(dlat_slope(ix, iz + 1, n, texel), dlat_slope(ix + 1, iz + 1, n, texel), f.x), f.y);
  let a00 = textureLoad(tAux, vec2i(ix, iz), 0);
  let a10 = textureLoad(tAux, vec2i(ix + 1, iz), 0);
  let a01 = textureLoad(tAux, vec2i(ix, iz + 1), 0);
  let a11 = textureLoad(tAux, vec2i(ix + 1, iz + 1), 0);
  let aux = mix(mix(a00, a10, f.x), mix(a01, a11, f.x), f.y);

  let steep = smoothstep(0.3, 1.1, s);
  let flat = (1.0 - smoothstep(0.05, 0.6, aux.g)) * (1.0 - smoothstep(0.0, 1.5, aux.a));

  var sum = 0.0;
  for (var k = 0u; k < 5u; k = k + 1u) {
    let sc = i32(1u << k);
    let q = f * f32(sc);
    let fl = floor(q);
    let v = dlat_noise(vec2i(ix * sc + i32(fl.x), iz * sc + i32(fl.y)), q - fl, k);
    let ridged = 0.55 - abs(v) * 1.6;
    let lam = texel / f32(sc);
    sum = sum + lam * mix(0.035 * v, 0.07 * ridged, steep);
  }
  return sum * (0.35 + 0.65 * steep) * flat;
}
