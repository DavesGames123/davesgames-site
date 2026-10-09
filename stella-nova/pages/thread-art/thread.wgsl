// ============================================================================
//  THREAD ART  ·  thread.wgsl — the greedy step on the GPU
// ----------------------------------------------------------------------------
//  One greedy step is three dispatches. gpu.js puts many steps in one
//  compute pass, so the GPU lays many lines before the CPU reads back.
//
//    score   one workgroup per candidate (peg j, thread k): 64 invocations
//            walk the line from the thread's peg to j, sum the residual per
//            channel, reduce in workgroup memory, and write the gain
//                gain = sum_ch delta_ch * (2 * R_ch - n * delta_ch)
//    pick    one workgroup of 256: the largest gain over K * P candidates
//            (ties: the lowest index k * P + j); no positive gain sets done
//    apply   one workgroup of 64: subtract delta along the chosen line,
//            move the thread, and append (k << 16 | j) to seq
//
//  All values are i32 in units of 1/100 optical density, so the result is
//  the same integers as engine.js (the CPU model). Lines use the same
//  integer walk (rdiv). Mixed operators have parentheses (Tint rule).
//
//  grep -n: "struct Params"  "struct State"  "fn rdiv"  "fn line_pixel"
//           "fn score"  "fn pick"  "fn apply"
// ============================================================================

struct Params {
  res: u32,        // the model grid is res x res
  P: u32,          // peg count
  K: u32,          // thread count
  C: u32,          // channels: 1 (mono) or 3 (colour)
  gap: u32,        // the smallest peg distance along the frame
  max_lines: u32,  // done when step reaches it
  floor_: i32,     // the residual floor
  _pad: u32,
}

struct State {
  cur: array<i32, 8>,   // the peg of each thread
  step: u32,            // lines laid
  done: u32,
  best_k: i32,
  best_j: i32,
  best_gain: i32,
  _p0: u32, _p1: u32, _p2: u32,
}

@group(0) @binding(0) var<uniform> prm: Params;
@group(0) @binding(1) var<storage, read_write> resid: array<i32>;
@group(0) @binding(2) var<storage, read> pegs: array<vec4<i32>>;    // x, y, side, 0
@group(0) @binding(3) var<storage, read> deltas: array<vec4<i32>>;  // per thread: d0, d1, d2, 0
@group(0) @binding(4) var<storage, read_write> st: State;
@group(0) @binding(5) var<storage, read_write> scores: array<i32>;
@group(0) @binding(6) var<storage, read_write> seq: array<u32>;

const NO_GAIN: i32 = -2147483647;

// a / m rounded to the nearest integer, halves away from zero (m > 0).
fn rdiv(a: i32, m: i32) -> i32 {
  return ((2 * a) + (sign(a) * m)) / (2 * m);
}

// Pixel i of the line a -> b (0 <= i <= m), as an index into one plane.
fn line_pixel(a: vec4<i32>, b: vec4<i32>, i: i32, m: i32) -> u32 {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  var x: i32;
  var y: i32;
  if (abs(dx) >= abs(dy)) {
    x = a.x + (sign(dx) * i);
    y = a.y + rdiv(dy * i, m);
  } else {
    x = a.x + rdiv(dx * i, m);
    y = a.y + (sign(dy) * i);
  }
  return u32(y) * prm.res + u32(x);
}

fn valid_pair(i: i32, j: i32) -> bool {
  if (i == j) { return false; }
  let P = i32(prm.P);
  let d = abs(i - j);
  let cd = min(d, P - d);
  if (u32(cd) < prm.gap) { return false; }
  let pi = pegs[i];
  let pj = pegs[j];
  if ((pi.z >= 0) && (pi.z == pj.z)) { return false; }
  return (pi.x != pj.x) || (pi.y != pj.y);
}

var<workgroup> acc: array<vec3<i32>, 64>;

@compute @workgroup_size(64)
fn score(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let j = i32(wid.x);
  let k = wid.y;
  let a = st.cur[k];
  let ok = (st.done == 0u) && valid_pair(a, j);
  var m = 0;
  var pa = vec4<i32>(0);
  var pb = vec4<i32>(0);
  if (ok) {
    pa = pegs[a];
    pb = pegs[j];
    m = max(abs(pb.x - pa.x), abs(pb.y - pa.y));
  }
  let N = prm.res * prm.res;
  var s = vec3<i32>(0);
  for (var i = i32(lid); (i <= m) && ok; i += 64) {
    let p = line_pixel(pa, pb, i, m);
    s.x += resid[p];
    if (prm.C == 3u) {
      s.y += resid[N + p];
      s.z += resid[(2u * N) + p];
    }
  }
  acc[lid] = s;
  workgroupBarrier();
  for (var h = 32u; h > 0u; h >>= 1u) {
    if (lid < h) { acc[lid] += acc[lid + h]; }
    workgroupBarrier();
  }
  if (lid == 0u) {
    var g = NO_GAIN;
    if (ok) {
      let d = deltas[k];
      let n = m + 1;
      let R = acc[0];
      g = d.x * ((2 * R.x) - (n * d.x));
      if (prm.C == 3u) {
        g += (d.y * ((2 * R.y) - (n * d.y))) + (d.z * ((2 * R.z) - (n * d.z)));
      }
    }
    scores[(k * prm.P) + u32(j)] = g;
  }
}

var<workgroup> best_g: array<i32, 256>;
var<workgroup> best_i: array<u32, 256>;

@compute @workgroup_size(256)
fn pick(@builtin(local_invocation_index) lid: u32) {
  let total = prm.K * prm.P;
  var bg = NO_GAIN;
  var bi = 0xffffffffu;
  for (var i = lid; i < total; i += 256u) {
    let g = scores[i];
    if (g > bg) { bg = g; bi = i; }
  }
  best_g[lid] = bg;
  best_i[lid] = bi;
  workgroupBarrier();
  for (var h = 128u; h > 0u; h >>= 1u) {
    if (lid < h) {
      let g2 = best_g[lid + h];
      let i2 = best_i[lid + h];
      if ((g2 > best_g[lid]) || ((g2 == best_g[lid]) && (i2 < best_i[lid]))) {
        best_g[lid] = g2;
        best_i[lid] = i2;
      }
    }
    workgroupBarrier();
  }
  if (lid == 0u) {
    if (st.done == 0u) {
      st.best_gain = best_g[0];
      if ((best_g[0] <= 0) || (st.step >= prm.max_lines)) {
        st.done = 1u;
        st.best_k = -1;
        st.best_j = -1;
      } else {
        st.best_k = i32(best_i[0] / prm.P);
        st.best_j = i32(best_i[0] % prm.P);
      }
    }
  }
}

@compute @workgroup_size(64)
fn apply(@builtin(local_invocation_index) lid: u32) {
  let done = st.done;
  let k = st.best_k;
  let j = st.best_j;
  var a = 0;
  if (done == 0u) { a = st.cur[k]; }
  let step = st.step;
  workgroupBarrier();
  if (done == 0u) {
    let pa = pegs[a];
    let pb = pegs[j];
    let m = max(abs(pb.x - pa.x), abs(pb.y - pa.y));
    let d = deltas[k];
    let N = prm.res * prm.res;
    for (var i = i32(lid); i <= m; i += 64) {
      let p = line_pixel(pa, pb, i, m);
      resid[p] = max(prm.floor_, resid[p] - d.x);
      if (prm.C == 3u) {
        resid[N + p] = max(prm.floor_, resid[N + p] - d.y);
        resid[(2u * N) + p] = max(prm.floor_, resid[(2u * N) + p] - d.z);
      }
    }
    if (lid == 0u) {
      st.cur[k] = j;
      seq[step] = (u32(k) << 16u) | u32(j);
      st.step = step + 1u;
    }
  }
}
