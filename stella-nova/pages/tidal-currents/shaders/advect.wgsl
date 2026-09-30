// advect.wgsl — move every particle one frame through the current field.
//
// Positions are normalized poster coordinates (0..1, y down). The step is
// RK2 (midpoint) with bilinear field samples. The step length in backing
// pixels is stepPx * (speed / speedRef)^gamma, so slow water still drifts and
// the fastest channels make long streaks. A particle that leaves the water
// or ends its life respawns on a random water point (rejection sampling on
// the coverage channel, with acceptance = coverage), so the density stays
// uniform over the water and follows a soft coverage fade.

struct Particle {
  pos: vec2f,
  prev: vec2f,
  age: f32,     // frames (60 fps units)
  life: f32,    // frames
  seed: u32,
  alpha: f32,   // < 0 means no water point found yet
};

struct AdvectU {
  size: vec2f,      // backing pixels
  stepPx: f32,      // pixels per 60 fps frame at speedRef
  speedRef: f32,    // m/s
  dtScale: f32,     // dt * 60, clamped
  gamma: f32,       // speed exponent of the step length
  minLife: f32,
  maxLife: f32,
  count: u32,
  reseed: u32,      // 1: respawn all particles at a random life phase
  frame: u32,
  pad: u32,
};

@group(0) @binding(0) var<uniform> A: AdvectU;
@group(0) @binding(1) var<storage, read_write> parts: array<Particle>;
@group(0) @binding(2) var field: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;

fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn rnd(s: ptr<function, u32>) -> f32 {
  *s = pcg(*s);
  return f32(*s >> 8u) / 16777216.0;
}

fn fieldAt(p: vec2f) -> vec4f {
  return textureSampleLevel(field, samp, p, 0.0);
}

// Displacement in normalized coordinates for one step from point p.
fn stepAt(p: vec2f) -> vec2f {
  let f = fieldAt(p);
  let vel = vec2f(f.x, -f.y);          // v north is up on screen
  let s = length(vel);
  if (s < 1e-5) { return vec2f(0.0); }
  let px = A.stepPx * pow(s / A.speedRef, A.gamma) * A.dtScale;
  return vel / s * px / A.size;
}

fn respawn(q: ptr<function, Particle>, s: ptr<function, u32>, randomPhase: bool) {
  var found = false;
  var c = vec2f(0.0);
  for (var i = 0; i < 24; i++) {
    c = vec2f(rnd(s), rnd(s));
    // Accept with a probability equal to the coverage, so the particle
    // density follows a soft coverage fade.
    let cv = fieldAt(c).w;
    if (cv > 0.05 && rnd(s) < cv) { found = true; break; }
  }
  (*q).life = mix(A.minLife, A.maxLife, rnd(s));
  (*q).age = select(0.0, rnd(s) * (*q).life, randomPhase);
  if (found) {
    (*q).pos = c;
    (*q).prev = c;
    (*q).alpha = 0.0;
  } else {
    (*q).pos = vec2f(-1.0);
    (*q).prev = vec2f(-1.0);
    (*q).alpha = -1.0;
  }
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= A.count) { return; }
  var q = parts[i];
  var s = pcg(q.seed ^ pcg(A.frame * 1664525u + i));
  if (A.reseed == 1u) {
    respawn(&q, &s, true);
  } else {
    q.age += A.dtScale;
    if (q.alpha < 0.0 || q.age >= q.life) {
      respawn(&q, &s, false);
    } else {
      let k1 = stepAt(q.pos);
      let k2 = stepAt(q.pos + 0.5 * k1);
      let np = q.pos + k2;
      let inside = all(np > vec2f(0.0)) && all(np < vec2f(1.0));
      if (!inside || fieldAt(np).w < 0.04) {
        respawn(&q, &s, false);
      } else {
        q.prev = q.pos;
        q.pos = np;
        let fin = smoothstep(0.0, 10.0, q.age);
        let fout = 1.0 - smoothstep(q.life - 14.0, q.life, q.age);
        q.alpha = fin * fout;
      }
    }
  }
  q.seed = s;
  parts[i] = q;
}
