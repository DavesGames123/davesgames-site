// paint.wgsl - write a list of cells into the world.
//
// Each edit is (cell index, cell word). The engine builds the list on the
// CPU for a brush stroke, an erase, or a pattern stamp, and it wraps the
// coordinates first. n.x is the number of edits.

@group(0) @binding(0) var<storage, read> edits: array<vec2<u32>>;
@group(0) @binding(1) var<storage, read_write> state: array<u32>;
@group(0) @binding(2) var<uniform> n: vec4<u32>;

@compute @workgroup_size(64)
fn paint(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= n.x) { return; }
  let e = edits[g.x];
  state[e.x] = e.y;
}
