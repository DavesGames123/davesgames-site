// paint.wgsl - brush: copy the state and set one chemical inside a disc.
// Coordinates are in grid cells. The disc wraps across the edges on a
// periodic grid.

struct PaintU {
  w: u32, h: u32, chem: u32, wrap: u32,
  cx: f32, cy: f32, radius: f32, value: f32,
  noise: u32, seed: u32, soft: f32, pad: f32,
};
@group(0) @binding(0) var<uniform> B: PaintU;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba32float, write>;

fn hash(p: vec3<u32>) -> f32 {
  var v = p * vec3<u32>(1664525u, 1013904223u, 2654435761u);
  v.x = v.x + v.y * v.z;
  v.y = v.y + v.z * v.x;
  v.z = v.z + v.x * v.y;
  v = v ^ (v >> vec3<u32>(16u));
  v.x = v.x + v.y * v.z;
  return f32(v.x >> 8u) / 16777216.0;
}

@compute @workgroup_size(8, 8)
fn paint(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= B.w || gid.y >= B.h) { return; }
  let p = vec2<i32>(gid.xy);
  var s = textureLoad(src, p, 0);
  var d = vec2<f32>(gid.xy) + 0.5 - vec2<f32>(B.cx, B.cy);
  if (B.wrap != 0u) {
    let size = vec2<f32>(f32(B.w), f32(B.h));
    d = d - size * round(d / size);
  }
  let r = length(d);
  if (r < B.radius) {
    var v = B.value;
    if (B.noise != 0u) { v = B.value * hash(vec3<u32>(gid.xy, B.seed)); }
    // soft > 0 blends toward the edge of the disc.
    let k = select(1.0, clamp((B.radius - r) / max(B.soft, 1e-6), 0.0, 1.0), B.soft > 0.0);
    if (B.chem == 0u) { s.x = mix(s.x, v, k); }
    else if (B.chem == 1u) { s.y = mix(s.y, v, k); }
    else if (B.chem == 2u) { s.z = mix(s.z, v, k); }
    else { s.w = mix(s.w, v, k); }
  }
  textureStore(dst, p, s);
}
