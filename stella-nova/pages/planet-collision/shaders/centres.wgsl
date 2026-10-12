// ============================================================================
//  PLANET COLLISION  ·  shaders/centres.wgsl — the centre of each body,
//  on the GPU, every frame (stand-alone: no common.wgsl)
// ----------------------------------------------------------------------------
//  cs_partial   one workgroup of 256 particles: for each body b, the sum
//               of the positions and the count, into part[wg * 4 + b]
//               (a tree sum in workgroup memory, one body at a time)
//  cs_final     one thread: the sums of all workgroups, then
//               centres[b] = (mean position, count)
//  The atmosphere and the shadows of shade.wgsl read centres[b], so they
//  follow the bodies with no CPU readback. Free fragments count too: the
//  page fades the atmospheres and shadows after the contact.
//
//  grep -n targets: "fn cs_partial", "fn cs_final"
// ============================================================================

struct CP { n: u32, nwg: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> C: CP;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> tag: array<u32>;
@group(0) @binding(3) var<storage, read_write> part: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> centres: array<vec4f>;

var<workgroup> acc: array<vec4f, 256>;

@compute @workgroup_size(256)
fn cs_partial(@builtin(global_invocation_id) g: vec3u, @builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3u) {
  let i = g.x;
  var p = vec4f(0.0);
  var b = 99u;
  if (i < C.n) {
    p = vec4f(pos[i].xyz, 1.0);
    b = (tag[i] >> 4u) & 15u;
  }
  for (var k = 0u; k < 4u; k++) {
    acc[li] = select(vec4f(0.0), p, b == k);
    workgroupBarrier();
    for (var s = 128u; s > 0u; s = s >> 1u) {
      if (li < s) { acc[li] = acc[li] + acc[li + s]; }
      workgroupBarrier();
    }
    if (li == 0u) { part[wg.x * 4u + k] = acc[0]; }
    workgroupBarrier();
  }
}

@compute @workgroup_size(1)
fn cs_final() {
  for (var k = 0u; k < 4u; k++) {
    var s = vec4f(0.0);
    for (var w = 0u; w < C.nwg; w++) { s = s + part[w * 4u + k]; }
    if (s.w > 0.0) { centres[k] = vec4f(s.xyz / s.w, s.w); } else { centres[k] = vec4f(0.0); }
  }
}
