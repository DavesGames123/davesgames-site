// ============================================================================
//  ROCHE LIMIT  ·  shaders/ring.wgsl — optical depth of the shed ring
// ----------------------------------------------------------------------------
//  cs_splat    every shed grain (tag 0, from the bound mass analysis) adds
//              its cross-section pi r^2 / cell area to a grid over the
//              plane z = 0 (fixed point, atomicAdd). One dispatch per
//              satellite; render.js clears the grid each frame.
//  cs_resolve  grid -> tau texture, with a 5x5 Gaussian, the display gain,
//              and a time blend with the texture of the frame before: at
//              high time warp the grains move along their orbits between
//              frames, and the blend draws the Keplerian shear as streaks.
//  vs_disk, fs_disk
//              the ring as a lit layer: single scattering on the lit face
//              (Lommel-Seeliger), diffuse transmission on the unlit face
//              with a forward-scattering lobe (a backlit ring glows), the
//              planet's shadow, opacity 1 - exp(-tau/mu).
//  The grains are drawn too (particles.wgsl); the layer fills between them,
//  and fades out where one grain covers more than about two pixels.
//
//  grep -n targets: "fn cs_splat", "fn cs_resolve", "fn fs_disk", "fn phase"
// ============================================================================

struct Cam {
  vp: mat4x4f, prevVp: mat4x4f, view: mat4x4f,
  eye: vec4f, sun: vec4f, vpSize: vec4f,
  right: vec4f, up: vec4f, fwd: vec4f,
  planet: vec4f, misc: vec4f, sat: vec4f, sat2: vec4f, field: vec4f, ringExt: vec4f,
  extra: vec4f,   // z: real-ring overlay on (Saturn), w unused
};
// today's rings of Saturn in planet radii: C, B, Cassini Division, A
const RING_C0: f32 = 1.2388;
const RING_B0: f32 = 1.5265;
const RING_CD0: f32 = 1.9510;
const RING_A0: f32 = 2.0271;
const RING_A1: f32 = 2.2694;
struct Body { pos: vec4f, vel: vec4f, spin: vec4f };
struct Inst { frame: vec4f, refV: vec4f, opts: vec4f, tint: vec4f };
// ringExt: x half extent (world), y grid size, z display gain, w time blend

@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var tauTex: texture_2d<f32>;
@group(0) @binding(2) var linSamp: sampler;

// splat (group 1, per satellite)
@group(1) @binding(0) var<storage, read> body: array<Body>;
@group(1) @binding(1) var<storage, read> tag: array<f32>;
@group(1) @binding(2) var<uniform> inst: Inst;
@group(1) @binding(3) var<storage, read_write> grid: array<atomic<u32>>;

const FIX: f32 = 65536.0;

@compute @workgroup_size(64)
fn cs_splat(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&tag)) { return; }
  let b = body[i];
  if (b.vel.w == 0.0 || tag[i] < -0.5 || tag[i] > 0.5) { return; }
  let k = inst.frame.w;
  let p = inst.frame.xyz + b.pos.xyz * k;
  let e = cam.ringExt.x;
  let n = u32(cam.ringExt.y);
  let uv = p.xy / (2.0 * e) + 0.5;
  if (any(uv < vec2f(0.0)) || any(uv >= vec2f(1.0))) { return; }
  let cell = 2.0 * e / f32(n);
  let r = b.pos.w * k;
  let area = 3.14159265 * r * r / (cell * cell);
  let ix = u32(uv.x * f32(n));
  let iy = u32(uv.y * f32(n));
  atomicAdd(&grid[iy * n + ix], u32(area * FIX));
}

// resolve (group 1: the grid, the texture of the frame before, the output)
@group(1) @binding(4) var<storage, read_write> gridR: array<u32>;
@group(1) @binding(5) var prevTex: texture_2d<f32>;
@group(1) @binding(6) var outTex: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn cs_resolve(@builtin(global_invocation_id) gid: vec3u) {
  let n = i32(cam.ringExt.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= n || y >= n) { return; }
  var s = 0.0;
  var wsum = 0.0;
  for (var dy = -2; dy <= 2; dy++) {
    for (var dx = -2; dx <= 2; dx++) {
      let xx = clamp(x + dx, 0, n - 1);
      let yy = clamp(y + dy, 0, n - 1);
      let w = exp(-f32(dx * dx + dy * dy) / 2.5);
      s = s + w * f32(gridR[u32(yy * n + xx)]);
      wsum = wsum + w;
    }
  }
  let tau = s / wsum / FIX * cam.ringExt.z;
  let prev = textureLoad(prevTex, vec2i(x, y), 0).r;
  let blend = cam.ringExt.w;
  let v = mix(tau, prev, blend);
  textureStore(outTex, vec2i(x, y), vec4f(v, 0.0, 0.0, 1.0));
}

// ── the lit layer ───────────────────────────────────────────────────────────
struct VOut { @builtin(position) pos: vec4f, @location(0) w: vec3f };
@vertex
fn vs_disk(@builtin(vertex_index) vi: u32) -> VOut {
  var c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  var o: VOut;
  let p = vec3f(c[vi] * cam.ringExt.x, 0.0);
  o.pos = cam.vp * vec4f(p, 1.0);
  o.w = p;
  return o;
}
fn hg(c: f32, g: f32) -> f32 {
  let d = 1.0 + g * g - 2.0 * g * c;
  return (1.0 - g * g) / (4.0 * 3.14159265 * pow(d, 1.5));
}
// grains: a broad backscatter lobe; fine dust: a narrow forward lobe
fn phase(c: f32) -> f32 { return 4.0 * 3.14159265 * (0.75 * hg(c, -0.3) + 0.25 * hg(c, 0.8)); }

@fragment
fn fs_disk(in: VOut) -> @location(0) vec4f {
  let uv = in.w.xy / (2.0 * cam.ringExt.x) + 0.5;
  let tau = textureSampleLevel(tauTex, linSamp, uv, 0.0).r;
  let p = in.w;
  let r = length(p.xy);
  // a faint picture of today's rings, for comparison (cam.extra.z)
  var ghost = 0.0;
  if (cam.extra.z > 0.0 && r > RING_C0 && r < RING_A1 && !(r > RING_CD0 && r < RING_A0)) {
    ghost = select(0.016, select(0.03, 0.022, r > RING_A0), r > RING_B0 && r < RING_CD0) * cam.extra.z;
  }
  if (tau < 2e-4 && ghost <= 0.0) { discard; }
  if (r < 1.0) { discard; }
  let L = cam.sun.xyz;
  let V = normalize(cam.eye.xyz - p);
  let mu = max(abs(V.z), 0.03);
  let mu0 = max(abs(L.z), 0.03);
  let cosA = dot(-V, L);   // 1: looking toward the sun
  var I = 0.0;
  if (sign(V.z) == sign(L.z)) {
    I = mu0 / (mu0 + mu) * (1.0 - exp(-tau * (1.0 / mu0 + 1.0 / mu))) * phase(-cosA);
  } else {
    var tr = 0.0;
    if (abs(mu - mu0) > 1e-3) { tr = mu0 / (mu - mu0) * (exp(-tau / mu) - exp(-tau / mu0)); }
    else { tr = tau / mu * exp(-tau / mu); }
    I = max(tr, 0.0) * phase(cosA) * 1.4;
  }
  // the planet's shadow
  let t = -dot(p, L);
  var sh = 1.0;
  if (t > 0.0) { sh = smoothstep(0.985, 1.015, length(p + t * L)); }
  // the layer stands in for grains smaller than a pixel; where the grains
  // themselves are large on screen it fades out (cam.misc.w: grain radius)
  let rpx = cam.misc.w * cam.misc.x / max(length(cam.eye.xyz - p), 1e-4);
  let wgt = smoothstep(2.5, 0.6, rpx);
  if (wgt <= 0.0 && ghost <= 0.0) { discard; }
  let alpha = (1.0 - exp(-tau / mu)) * wgt;
  let tint = mix(vec3f(0.80, 0.72, 0.60), vec3f(0.92, 0.88, 0.82), smoothstep(0.0, 0.6, tau));
  let col = tint * I * sh * cam.sun.w * 0.55 * wgt + tint * alpha * 0.004;
  let gcol = vec3f(0.62, 0.70, 0.86) * ghost * cam.sun.w * sh;
  return vec4f(col + gcol, alpha * 0.7 + ghost * 0.5);
}
