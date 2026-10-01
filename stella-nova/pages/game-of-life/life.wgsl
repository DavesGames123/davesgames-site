// life.wgsl - one generation of a Life-like rule, and the cell counts.
//
// The cell word is the same as in life.js:
//   bits 0..7   age (0 dead, 1 newborn, up to 255)
//   bits 8..15  trail of a dead cell, from TRAIL down to 0
// next_value() must stay the same as nextValue() in life.js. tests.mjs
// compares the two bit for bit.
//
// Entry points (one bind group layout for all three):
//   step        dst = rule(src)
//   step_stats  the same, and it adds population, births and deaths
//               to stats[0..2]
//   count       adds the population of src to stats[0]
// The engine clears stats before step_stats or count.

struct Rule {
  W: u32, H: u32, birth: u32, survive: u32,
  wrap: u32, trail: u32, pad0: u32, pad1: u32,
};

@group(0) @binding(0) var<uniform> R: Rule;
@group(0) @binding(1) var<storage, read> src: array<u32>;
@group(0) @binding(2) var<storage, read_write> dst: array<u32>;
@group(0) @binding(3) var<storage, read_write> stats: array<atomic<u32>, 4>;

var<workgroup> wPop: atomic<u32>;
var<workgroup> wBirth: atomic<u32>;
var<workgroup> wDeath: atomic<u32>;

fn live_at(x: i32, y: i32) -> u32 {
  let W = i32(R.W);
  let H = i32(R.H);
  var xx = x;
  var yy = y;
  if (xx < 0 || yy < 0 || xx >= W || yy >= H) {
    if (R.wrap == 0u) { return 0u; }
    xx = (xx + W) % W;
    yy = (yy + H) % H;
  }
  return select(0u, 1u, (src[u32(yy) * R.W + u32(xx)] & 0xFFu) != 0u);
}

fn next_value(v: u32, n: u32) -> u32 {
  let age = v & 0xFFu;
  if (age != 0u) {
    if (((R.survive >> n) & 1u) != 0u) { return min(age + 1u, 255u); }
    return R.trail << 8u;
  }
  if (((R.birth >> n) & 1u) != 0u) { return 1u; }
  let t = (v >> 8u) & 0xFFu;
  return select(0u, (t - 1u) << 8u, t > 0u);
}

fn neighbours(x: i32, y: i32) -> u32 {
  return live_at(x - 1, y - 1) + live_at(x, y - 1) + live_at(x + 1, y - 1)
       + live_at(x - 1, y)                         + live_at(x + 1, y)
       + live_at(x - 1, y + 1) + live_at(x, y + 1) + live_at(x + 1, y + 1);
}

@compute @workgroup_size(16, 16)
fn step(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= R.W || g.y >= R.H) { return; }
  let i = g.y * R.W + g.x;
  dst[i] = next_value(src[i], neighbours(i32(g.x), i32(g.y)));
}

// The barriers need uniform control flow, so no thread returns early here.
@compute @workgroup_size(16, 16)
fn step_stats(@builtin(global_invocation_id) g: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  if (li == 0u) {
    atomicStore(&wPop, 0u);
    atomicStore(&wBirth, 0u);
    atomicStore(&wDeath, 0u);
  }
  workgroupBarrier();
  if (g.x < R.W && g.y < R.H) {
    let i = g.y * R.W + g.x;
    let v = src[i];
    let o = next_value(v, neighbours(i32(g.x), i32(g.y)));
    dst[i] = o;
    let was = (v & 0xFFu) != 0u;
    let now = (o & 0xFFu) != 0u;
    if (now) { atomicAdd(&wPop, 1u); }
    if (now && !was) { atomicAdd(&wBirth, 1u); }
    if (was && !now) { atomicAdd(&wDeath, 1u); }
  }
  workgroupBarrier();
  if (li == 0u) {
    atomicAdd(&stats[0], atomicLoad(&wPop));
    atomicAdd(&stats[1], atomicLoad(&wBirth));
    atomicAdd(&stats[2], atomicLoad(&wDeath));
  }
}

@compute @workgroup_size(16, 16)
fn count(@builtin(global_invocation_id) g: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  if (li == 0u) { atomicStore(&wPop, 0u); }
  workgroupBarrier();
  if (g.x < R.W && g.y < R.H) {
    if ((src[g.y * R.W + g.x] & 0xFFu) != 0u) { atomicAdd(&wPop, 1u); }
  }
  workgroupBarrier();
  if (li == 0u) { atomicAdd(&stats[0], atomicLoad(&wPop)); }
}
