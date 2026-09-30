// trail.wgsl — the trail pass. The trail texture is one r16float density
// channel at backing size.
//
// vsFade/fsFade draw one fullscreen triangle. The pipeline blend is
// dst * constant, so the pass fades the old trails in place.
// vsLine/fsLine draw one line segment (prev -> pos) per particle, with
// additive blend. Vertex 2i is the particle start, vertex 2i+1 the end.

struct Particle {
  pos: vec2f,
  prev: vec2f,
  age: f32,
  life: f32,
  seed: u32,
  alpha: f32,
};

struct TrailU {
  size: vec2f,    // backing pixels
  gain: f32,      // density per segment
  lenRef: f32,    // segment length (px) with full weight
};

@group(0) @binding(0) var<uniform> T: TrailU;
@group(0) @binding(1) var<storage, read> parts: array<Particle>;

@vertex
fn vsFade(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fsFade() -> @location(0) vec4f {
  return vec4f(0.0);
}

struct LineOut {
  @builtin(position) pos: vec4f,
  @location(0) a: f32,
};

fn hash(v: u32) -> f32 {
  var s = v * 747796405u + 2891336453u;
  s = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return f32(((s >> 22u) ^ s) >> 8u) / 16777216.0;
}

@vertex
fn vsLine(@builtin(vertex_index) vi: u32) -> LineOut {
  let i = vi >> 1u;
  let q = parts[i];
  var o: LineOut;
  let p = select(q.prev, q.pos, (vi & 1u) == 1u);
  // A long segment spreads the same deposit over more pixels. Keep some of the
  // extra brightness, so fast water is brighter, but not all of it.
  let lenPx = length((q.pos - q.prev) * T.size);
  let w = pow(max(lenPx, T.lenRef) / T.lenRef, -0.5);
  // Each particle gets a fixed strength, so the strands differ a little.
  let strand = 0.45 + 0.55 * hash(i);
  o.a = max(q.alpha, 0.0) * T.gain * w * strand;
  o.pos = select(vec4f(3.0, 3.0, 0.0, 1.0), vec4f(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0), q.alpha > 0.0);
  return o;
}

@fragment
fn fsLine(@location(0) a: f32) -> @location(0) vec4f {
  return vec4f(a, 0.0, 0.0, 1.0);
}
