// ============================================================================
//  ROCHE LIMIT  ·  shaders/particles.wgsl — the grains as lit sphere impostors
// ----------------------------------------------------------------------------
//  One instanced quad per grain, read straight from the simulation buffer
//  (engine.js bufBody). With 4x MSAA the grains use alpha-to-coverage
//  (fs_main): a grain smaller than a pixel writes a coverage, not a blend,
//  so it needs no sort and the depth test stays exact. With one sample
//  (budget.js: pixel ratio over 1.25, or a touch screen) fs_blend writes
//  the same colour premultiplied, blended, with depth.
//
//  STRAIN. In the default colour mode (ice and heat) the grains of the
//  bound moon take the tide-to-self-gravity ratio of the force kernel:
//  steel blue while self-gravity wins, through red to amber where the
//  tide wins (inst.heatP.w sets the share). Shed grains stay ice.
//
//  GLINTS. A shed ice grain has a facet that turns with the grain's real
//  spin (body spin, times the sim time). When the facet's normal lines up
//  with the half vector of the sun and the eye, the grain flashes. When a
//  frame turns the facet by more than 0.8 rad (fast forward), the glint is
//  its steady mean, so it never strobes.
//
//  IMPACTS. A grain that hit the planet has mass 0 and keeps the impact
//  point and time in its spin row (sim.wgsl cs_kick). For inst.heatP.z of
//  sim time after the hit it draws a flash there: white, then orange,
//  then dull red, growing from 2 to 8 grain radii, lifted 0.4% off the
//  surface so the planet's depth hides it only on the far side.
//
//  MOTION. Streaks are off unless inst.motion.x is 1. A grain that moves
//  more than inst.motion.y px in a frame dims (no strobing at high warp).
//  The stress colour comes from stressS, smoothed in time by cs_smooth.
//
//  MOTION BLUR. The quad is a capsule from the grain's screen position one
//  frame of sim time ago (cam.prevVp, with p - v dt) to its position now.
//  Its coverage falls as the capsule grows, so a streak keeps the light of
//  one grain. At low time warp the capsule is a disc.
//
//  LIGHT. Sun with a soft planet shadow (penumbra, and a red tint where the
//  sunlight grazes the atmosphere), planetshine from the lit planet, the
//  ring's own shadow (optical depth tau from ring.wgsl) and a faint fill.
//  Colour: bound rock / shed ice, speed, or tidal stress (the ratio
//  |tide| / |self-gravity| per grain, from the force kernel's diag).
//
//  grep -n targets: "fn vs_main", "fn fs_main", "fn fs_blend", "fn shade",
//  "fn sunShadow", "fn heat", "fn cs_smooth", "fn plasma", "fn glint",
//  "fn flashQuad"
// ============================================================================

struct Cam {
  vp: mat4x4f, prevVp: mat4x4f, view: mat4x4f,
  eye: vec4f, sun: vec4f, vpSize: vec4f,
  right: vec4f, up: vec4f, fwd: vec4f,
  planet: vec4f, misc: vec4f, sat: vec4f, sat2: vec4f, field: vec4f, ringExt: vec4f,
};
struct Body { pos: vec4f, vel: vec4f, spin: vec4f };
// frame: frame point (world) and k = 1/R_p; refV: frame velocity (world per
// sim time) and the blur time; opts: colour mode, stress mix, brightness,
// scale of the vesc for the speed colours; tint: shed-ice colour.
// motion: x 1 = draw streaks, y the screen motion (px per frame) above
// which a grain dims (anti-strobe, 0 = off), z the stress smoothing factor,
// w the heat decay factor of this frame, exp(-dt_frame / tau)
// heatP: x 1 / reference heat (energy per mass), the colour runs over
// log10(heat x) in [-3, 1]; y the sim time now; z how long an impact
// flash lasts (sim time, 0 = none); w the strain share of the default
// colour mode (0..1)
struct Inst { frame: vec4f, refV: vec4f, opts: vec4f, tint: vec4f, motion: vec4f, heatP: vec4f };

@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var tauTex: texture_2d<f32>;
@group(0) @binding(2) var linSamp: sampler;
@group(1) @binding(0) var<storage, read> body: array<Body>;
@group(1) @binding(1) var<storage, read> diag: array<vec4f>;
@group(1) @binding(2) var<storage, read> tag: array<f32>;
@group(1) @binding(3) var<uniform> inst: Inst;
// the tidal stress of each grain, smoothed in time (cs_smooth writes it,
// the vertex stage reads it), so the heatmap colours do not flicker
@group(1) @binding(4) var<storage, read> stressS: array<vec2f>;
@group(1) @binding(5) var<storage, read_write> stressW: array<vec2f>;
@group(1) @binding(6) var<storage, read_write> diagW: array<vec4f>;

// x: the tidal stress, smoothed in time. y: the collision heat, energy per
// unit mass that decays with time constant tau (exp(-dt/tau) in motion.w),
// fed by what cs_forces summed since the last frame. Both read by the
// vertex stage, so the colours never flicker.
@compute @workgroup_size(64)
fn cs_smooth(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&stressW)) { return; }
  let dg = diagW[i];
  let ratio = dg.x / max(dg.y, 1e-12);
  let st = clamp((log(max(ratio, 1e-6)) / 2.302585 + 1.5) / 3.0, 0.0, 1.0);
  let o = stressW[i];
  stressW[i] = vec2f(mix(o.x, st, inst.motion.z), o.y * inst.motion.w + dg.z);
  diagW[i].z = 0.0;
}

// matplotlib "plasma" as a polynomial fit (CC0, Matt Zucker's fit of the
// matplotlib colormaps): dark purple, magenta, orange, yellow
fn plasma(t0: f32) -> vec3f {
  let t = clamp(t0, 0.0, 1.0);
  let c0 = vec3f(0.05873234392399702, 0.02333670892565664, 0.5433401826748754);
  let c1 = vec3f(2.176514634195958, 0.2383834171260182, 0.7539604599784036);
  let c2 = vec3f(-2.689460476458034, -7.455851135738909, 3.110799939717086);
  let c3 = vec3f(6.130348345893603, 42.3461881477227, -28.51885465332158);
  let c4 = vec3f(-11.10743619062271, -82.66631109428045, 60.13984767418263);
  let c5 = vec3f(10.02306557647065, 71.41361770095349, -54.07218655560067);
  let c6 = vec3f(-3.658713842777788, -22.93153465461149, 18.19190778539828);
  return clamp(c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6))))), vec3f(0.0), vec3f(1.0));
}

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) a: vec2f,       // capsule end (px), now
  @location(1) @interpolate(flat) b: vec2f,       // capsule end (px), a frame ago
  @location(2) @interpolate(flat) rpx: f32,       // radius in px
  @location(3) @interpolate(flat) color: vec3f,   // lit albedo, before the normal term
  @location(4) @interpolate(flat) cover: f32,     // coverage scale (sub-pixel, streak)
  @location(5) @interpolate(flat) world: vec3f,   // centre, world
  @location(6) @interpolate(flat) emis: vec3f,    // emission (stress glow)
  @location(7) @interpolate(flat) vz: vec2f,      // view depth of the centre, radius (world)
};

fn hash11(n: f32) -> f32 { return fract(sin(n * 12.9898) * 43758.5453); }

// The stress ramp, t in [0, 1]: steel blue (self-gravity wins), magenta,
// red, amber, white (the tide wins by 30x). It starts bright enough to
// read on black.
fn heat(t: f32) -> vec3f {
  let c0 = vec3f(0.22, 0.36, 0.70);
  let c1 = vec3f(0.62, 0.26, 0.72);
  let c2 = vec3f(0.95, 0.30, 0.28);
  let c3 = vec3f(1.00, 0.66, 0.18);
  let c4 = vec3f(1.00, 0.97, 0.80);
  let s = clamp(t, 0.0, 1.0) * 4.0;
  if (s < 1.0) { return mix(c0, c1, s); }
  if (s < 2.0) { return mix(c1, c2, s - 1.0); }
  if (s < 3.0) { return mix(c2, c3, s - 2.0); }
  return mix(c3, c4, s - 3.0);
}
fn cool(t: f32) -> vec3f {
  let s = clamp(t, 0.0, 1.0);
  return mix(mix(vec3f(0.10, 0.20, 0.55), vec3f(0.25, 0.85, 0.95), smoothstep(0.0, 0.5, s)), vec3f(1.0, 0.95, 0.75), smoothstep(0.5, 1.0, s));
}

// Sunlight that reaches p: 0 in the planet's shadow, a soft edge, and a red
// tint where the ray grazes the atmosphere. The planet has radius 1.
fn sunShadow(p: vec3f) -> vec3f {
  let L = cam.sun.xyz;
  let t = -dot(p, L);
  if (t <= 0.0) { return vec3f(1.0); }
  let b = length(p + t * L);
  let pen = 0.012 + 0.004 * t;
  let lit = smoothstep(1.0 - pen, 1.0 + pen, b);
  let graze = smoothstep(1.0 + 0.09, 1.0, b) * lit;
  return lit * mix(vec3f(1.0), vec3f(1.0, 0.55, 0.32), graze);
}
fn ringTau(p: vec3f) -> f32 {
  let e = cam.ringExt.x;
  let uv = p.xy / (2.0 * e) + 0.5;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return 0.0; }
  return textureSampleLevel(tauTex, linSamp, uv, 0.0).r;
}

// A tumbling ice grain: a facet normal (from its index) turned by the
// grain's spin over the sim time, against the half vector h. The lobe is
// narrow (about 4 degrees), so few grains flash at once.
fn glint(ii: u32, spin: vec3f, h: vec3f) -> f32 {
  let fi = f32(ii);
  let z = 2.0 * hash11(fi + 11.7) - 1.0;
  let a = 6.2831853 * hash11(fi + 23.1);
  let f0 = vec3f(sqrt(max(0.0, 1.0 - z * z)) * vec2f(cos(a), sin(a)), z);
  let wl = length(spin);
  if (wl * inst.refV.w > 0.8) { return 0.004; }   // a blur of turns: the mean of the lobe
  var f = f0;
  if (wl > 1e-6) {
    let ax = spin / wl;
    let th = wl * inst.heatP.y;
    let c = cos(th); let s = sin(th);
    f = f0 * c + cross(ax, f0) * s + ax * dot(ax, f0) * (1.0 - c);
  }
  return pow(max(dot(f, h), 0.0), 900.0);
}
// The disc of an impact flash at world point wp, radius r (world), with
// emission em. Same varyings as a grain: no albedo, full cover.
fn flashQuad(vi: u32, wp: vec3f, r: f32, em: vec3f) -> VOut {
  var o: VOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  let c = cam.vp * vec4f(wp, 1.0);
  if (c.w <= 0.01) { return o; }
  let half = 0.5 * cam.vpSize.xy;
  let sa = (c.xy / c.w) * half;
  let rpx = max(r * cam.misc.x / c.w, 1.5);
  var corner = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let sp = sa + corner[vi] * (rpx + 1.0);
  o.pos = vec4f(sp / half * c.w, c.z, c.w);
  o.a = sa; o.b = sa; o.rpx = rpx;
  o.color = vec3f(0.0); o.cover = 1.0; o.world = wp; o.emis = em; o.vz = vec2f(c.w, r);
  return o;
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let bd = body[ii];
  let k = inst.frame.w;
  let m = bd.vel.w;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (m == 0.0) {
    // an impact flash (the spin row holds the point and the time)
    let age = inst.heatP.y - bd.spin.w;
    if (bd.spin.w <= 0.0 || inst.heatP.z <= 0.0 || age < 0.0 || age > inst.heatP.z) { return o; }
    let u = age / inst.heatP.z;
    let col = mix(mix(vec3f(1.0, 0.95, 0.85), vec3f(1.0, 0.55, 0.18), smoothstep(0.0, 0.35, u)), vec3f(0.45, 0.10, 0.04), smoothstep(0.35, 1.0, u));
    let wp = bd.spin.xyz * k * 1.004;
    return flashQuad(vi, wp, k * (2.0 + 6.0 * sqrt(u)), col * (9.0 * (1.0 - u) * (1.0 - u) + 0.3));
  }
  let wp = (inst.frame.xyz + bd.pos.xyz * k);
  let r = bd.pos.w * k;
  let vel = (inst.refV.xyz + bd.vel.xyz * k);
  let c = cam.vp * vec4f(wp, 1.0);
  if (c.w <= 0.01) { return o; }
  let pc = cam.prevVp * vec4f(wp - vel * inst.refV.w, 1.0);
  let half = 0.5 * cam.vpSize.xy;
  let sa = (c.xy / c.w) * half;
  var sb = sa;
  if (pc.w > 0.01) { sb = (pc.xy / pc.w) * half; }
  let rpxTrue = r * cam.misc.x / c.w;
  let rpx = max(rpxTrue, 0.75);
  var d = sa - sb;
  let dl = length(d);
  // a grain that jumps far across the screen each frame strobes at high
  // time warp; it dims, and the time-blended ring layer carries the light
  var fade = 1.0;
  if (inst.motion.y > 0.0 && dl > inst.motion.y) { fade = max(0.12, inst.motion.y / dl); }
  if (inst.motion.x < 0.5) { d = vec2f(0.0); }
  // a dead zone of one diameter: slow drift (a following camera that lags)
  // draws a round grain, only real motion draws a streak
  let dz = max(0.0, dl - 2.0 * rpxTrue);
  if (dl > 1e-4) { d = d * (dz / dl); }
  if (dz > 0.25 * cam.vpSize.x) { d = d * (0.25 * cam.vpSize.x / dz); }
  let len = length(d);
  let mid = sa - 0.5 * d;
  var ax = vec2f(1.0, 0.0);
  if (len > 1e-3) { ax = d / len; }
  let ay = vec2f(-ax.y, ax.x);
  var corner = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let cn = corner[vi];
  let hx = 0.5 * len + rpx + 1.0;
  let hy = rpx + 1.0;
  let sp = mid + cn.x * hx * ax + cn.y * hy * ay;
  o.pos = vec4f(sp / half * c.w, c.z, c.w);
  o.a = sa;
  o.b = sa - d;
  o.rpx = rpx;
  // sub-pixel grains: the disc is drawn at 0.75 px, the coverage keeps the
  // true area; a streak spreads the area over its length
  let area = (rpxTrue * rpxTrue) / (rpx * rpx);
  // a short streak stays opaque (a partial coverage dithers); a long one
  // spreads the light of the grain over its length
  // sub-pixel: sqrt of the area ratio, a little more than the true light,
  // so a distant stream still reads as a line of dots
  o.cover = min(1.0, sqrt(area)) * clamp((2.0 * rpx + 4.0) / (2.0 * rpx + len), 0.0, 1.0);
  o.world = wp;
  o.vz = vec2f(c.w, r);

  // albedo and emission
  let fi = f32(ii);
  let tg = tag[ii];
  let mode = inst.opts.x;
  var alb = mix(vec3f(0.52, 0.47, 0.42), vec3f(0.66, 0.58, 0.50), hash11(fi));
  alb = alb * (0.8 + 0.4 * hash11(fi + 7.1));
  var em = vec3f(0.0);
  if (mode < 0.5) {
    // bound rock, shed ice
    if (tg < 0.5 && tg > -0.5) { alb = inst.tint.xyz * (0.85 + 0.3 * hash11(fi + 3.3)); }
  } else if (mode < 1.5) {
    let s = length(bd.vel.xyz) / max(inst.opts.w, 1e-6);
    alb = cool(log2(1.0 + 4.0 * s) / log2(9.0));
    em = alb * 0.15;
  }
  let sh = stressS[ii];
  let st = sh.x;
  let hn = clamp((log(max(sh.y * inst.heatP.x, 1e-9)) / 2.302585 + 3.0) / 4.0, 0.0, 1.0);
  if (mode > 2.5 && mode < 3.5) {
    // heat: plasma colour of the collision heat
    let pc = plasma(hn);
    alb = pc * 0.55;
    em = pc * (0.08 + 1.1 * hn * hn);
  } else if (mode > 3.5) {
    // ice and heat: icy grains; the ones that collide glow in plasma
    alb = vec3f(0.80, 0.86, 0.95) * (0.85 + 0.3 * hash11(fi + 3.3));
    em = plasma(hn) * (1.3 * pow(smoothstep(0.3, 1.0, hn), 1.5));
    // the bound moon shows its tidal strain (|tide| / |self-gravity|):
    // st 0.12 is a ratio of 0.07, st 0.45 a ratio of 0.7
    if (tg > 0.5) {
      let ts = smoothstep(0.12, 0.45, st);
      alb = mix(alb, heat(ts) * 0.9, inst.heatP.w * (0.25 + 0.6 * ts));
      em = em + heat(ts) * (0.22 * inst.heatP.w * ts * ts);
    }
  }
  // glints of shed ice in the sunlight (modes 0 and 4)
  if ((mode < 0.5 || mode > 3.5) && tg < 0.5 && tg > -0.5) {
    let hv = normalize(cam.sun.xyz + normalize(cam.eye.xyz - wp));
    let sh0 = sunShadow(wp);
    em = em + vec3f(1.0, 0.97, 0.9) * (6.0 * cam.sun.w * glint(ii, bd.spin.xyz, hv)) * sh0;
  }
  let hcol = heat(st);
  let mixS = select(inst.opts.y, 1.0, mode > 1.5 && mode < 2.5);
  alb = mix(alb, hcol * 0.85, mixS);
  em = mix(em, hcol * (0.25 + 1.6 * st * st), mixS);
  o.color = alb * inst.opts.z * fade;
  o.emis = em * inst.opts.z * fade;
  return o;
}

struct FOut { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 };

@fragment
fn fs_main(in: VOut) -> FOut { return shade(in); }
// one sample (no alpha-to-coverage): the same colour, premultiplied
@fragment
fn fs_blend(in: VOut) -> FOut {
  var o = shade(in);
  o.color = vec4f(o.color.rgb * o.color.a, o.color.a);
  return o;
}
fn shade(in: VOut) -> FOut {
  var o: FOut;
  let half = 0.5 * cam.vpSize.xy;
  // fragment in the same px space as a, b (y up)
  let fp = vec2f(in.pos.x - half.x, half.y - in.pos.y);
  let ab = in.a - in.b;
  let l2 = dot(ab, ab);
  var h = 0.0;
  if (l2 > 1e-6) { h = clamp(dot(fp - in.b, ab) / l2, 0.0, 1.0); }
  let q = in.b + h * ab;
  let rel = (fp - q) / in.rpx;
  let rho2 = dot(rel, rel);
  // soft edge: 1 px wide
  let edge = clamp((in.rpx - sqrt(rho2) * in.rpx) + 0.5, 0.0, 1.0);
  if (edge <= 0.0) { discard; }
  let nz = sqrt(max(0.0, 1.0 - rho2));
  let n = normalize(rel.x * cam.right.xyz + rel.y * cam.up.xyz - nz * cam.fwd.xyz);
  let L = cam.sun.xyz;
  let p = in.world;
  let sh = sunShadow(p);
  let tau = ringTau(p);
  let ringT = exp(-0.5 * tau / max(abs(L.z), 0.08));
  // regolith: Lommel-Seeliger blended with Lambert
  let mu0 = max(dot(n, L), 0.0);
  let mu = max(nz, 0.05);
  let ls = mu0 / (mu0 + mu) * 2.0;
  let diffuse = mix(mu0, ls, 0.5);
  // planetshine: the lit fraction of the planet seen from p
  let dp = length(p);
  let toP = -p / dp;
  let phaseP = 0.5 + 0.5 * dot(-toP, L);
  let shine = vec3f(0.55, 0.62, 0.75) * cam.planet.w * phaseP * max(dot(n, toP), 0.0) / (dp * dp);
  let fill = vec3f(0.018, 0.022, 0.03);
  let col = in.color * (cam.sun.w * diffuse * sh * ringT + shine + fill) + in.emis;
  o.color = vec4f(col, in.cover * edge);
  // depth of the sphere surface at this fragment: the centre moved toward
  // the eye by nz r
  let cz = cam.vp * vec4f(p - nz * in.vz.y * cam.fwd.xyz, 1.0);
  o.depth = clamp(cz.z / cz.w, 0.0, 1.0);
  return o;
}
