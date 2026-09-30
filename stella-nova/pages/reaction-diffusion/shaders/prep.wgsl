// prep.wgsl - turn the rgba32float state into a filterable display field.
// Output rgba16float: r = normalized value t, g = dt/dx, b = dt/dy (per cell).
// The render program samples this field with a linear sampler.

struct PrepU {
  w: u32, h: u32, chem: u32, wrap: u32,
  low: f32, high: f32, pad0: f32, pad1: f32,
};
@group(0) @binding(0) var<uniform> P: PrepU;
@group(0) @binding(1) var state: texture_2d<f32>;
@group(0) @binding(2) var field: texture_storage_2d<rgba16float, write>;

fn chem_at(x: i32, y: i32) -> f32 {
  let w = i32(P.w);
  let h = i32(P.h);
  var xi = x;
  var yi = y;
  if (P.wrap != 0u) {
    xi = (x + w) % w;
    yi = (y + h) % h;
  } else {
    xi = clamp(x, 0, w - 1);
    yi = clamp(y, 0, h - 1);
  }
  let v = textureLoad(state, vec2<i32>(xi, yi), 0);
  var s = v.x;
  if (P.chem == 1u) { s = v.y; } else if (P.chem == 2u) { s = v.z; } else if (P.chem == 3u) { s = v.w; }
  let t = (s - P.low) / max(P.high - P.low, 1e-20);
  // Keep NaN and huge values out of the f16 field.
  return select(clamp(t, -4.0, 5.0), 0.0, t != t);
}

@compute @workgroup_size(8, 8)
fn prep(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= P.w || gid.y >= P.h) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  let c = chem_at(x, y);
  let gx = 0.5 * (chem_at(x + 1, y) - chem_at(x - 1, y));
  let gy = 0.5 * (chem_at(x, y + 1) - chem_at(x, y - 1));
  textureStore(field, vec2<i32>(x, y), vec4<f32>(c, gx, gy, 1.0));
}
