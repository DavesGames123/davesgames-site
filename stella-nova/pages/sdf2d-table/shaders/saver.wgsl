// ============================================================================
//  SDF 2D TABLE  ·  shaders/saver.wgsl — the build-up screensaver, in 2D
// ----------------------------------------------------------------------------
//  One full-screen pass. The shape is an ordered op list in the uniform block
//  (saver.js writes it). mapM walks the list: primitives join, cut or
//  intersect the running distance d, and modifier ops change d or the point.
//  Each op has a progress pr in [0, 1]. An op at pr = 0 changes nothing:
//    union ...... skipped; it grows in by scale, from pr > 0
//    subtract ... skipped; the cutter slides in from far (s.xy), or its
//                 distance eases in from +5 (lerp flag)
//    intersect .. skipped; the distance eases in from -5
//    onion ...... d = mix(d, |d| - t, pr)     round ... d = d - r pr
//    swirl ...... turn by b.x pr |p|          grid .... spacing eases from 40
//  The field is the picture: iso bands that flow outward, a zero isoline
//  with a glint that sweeps round it, gradient colour, the ghost outline of
//  the active op, and a sphere-tracing demo (circles of radius d(p) that
//  step along a ray to the surface).
//
//  OP LAYOUT (4 vec4 = 64 bytes, saver.js "function packOp")
//    a  type, combine (0 union, 1 subtract, 2 intersect), pr, k
//    b  primitive or modifier parameters
//    c  pos.xy, turn (radians), polar repetition count (0 none)
//    s  slide.xy (offset at pr = 0), polar repetition radius, lerp flag
//
//  GREP MAP
//    fn prim ...... 0 circle 1 box 2 capsule 3 ring 4 polygon 5 star
//                   6 half-plane (inside above y = b.x) 7 ellipse (approx)
//    fn opDist .... one op in its local frame (slide, scale, repetition)
//    fn mapM ...... the op list walk
//    fn rayDemo ... sphere-tracing circles along the demo ray
//    @fragment fs_saver
// ============================================================================
struct Op { a: vec4f, b: vec4f, c: vec4f, s: vec4f };
struct U {
  res: vec4f,                // width, height, time, fade
  view: vec4f,               // centre xy, half height in units, lift
  look: vec4f,               // band spacing, band flow speed, gradient colour, glint angle
  act: vec4f,                // active op, ghost strength, ray steps shown, glint strength
  ray: vec4f,                // demo ray origin xy, direction angle, demo strength
  cIn: vec4f, cOut: vec4f,   // inside and outside colour
  cLine: vec4f, cAcc: vec4f, // zero line, accent (ghost, ray)
  bg: vec4f,                 // backdrop; w: op count
  ops: array<Op, 24>,
};
@group(0) @binding(0) var<uniform> u: U;

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn smin(a: f32, b: f32, k: f32) -> f32 {
  if (k <= 0.0) { return min(a, b); }
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
fn smax(a: f32, b: f32, k: f32) -> f32 { return -smin(-a, -b, k); }

// distance from q to the segment a-b
fn seg(q: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = q - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

fn prim(t: i32, q: vec2f, b: vec4f) -> f32 {
  switch t {
    case 0: { return length(q) - b.x; }
    case 1: {
      let d = abs(q) - b.xy + vec2f(b.z);
      return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0) - b.z;
    }
    case 2: { let x = clamp(q.x, -b.x, b.x); return length(q - vec2f(x, 0.0)) - b.y; }
    case 3: { return abs(length(q) - b.x) - b.y; }
    case 4: {
      // regular polygon: b.x sides, b.y apothem, b.z corner radius
      let n = b.x;
      let sec = 6.2831853 / n;
      let a = atan2(q.y, q.x);
      let a2 = a - sec * round(a / sec);
      let w = length(q) * vec2f(cos(a2), abs(sin(a2)));
      let half = b.y * tan(3.14159265 / n);
      let e = seg(w, vec2f(b.y, -half), vec2f(b.y, half));
      return select(-e, e, w.x > b.y) - b.z;
    }
    case 5: {
      // star: b.x points, b.y tip radius, b.z inner radius
      let n = b.x;
      let sec = 6.2831853 / n;
      let a = atan2(q.y, q.x);
      let a2 = a - sec * round(a / sec);
      let w = length(q) * vec2f(cos(a2), abs(sin(a2)));
      let tip = vec2f(b.y, 0.0);
      let inn = b.z * vec2f(cos(sec * 0.5), sin(sec * 0.5));
      let e = seg(w, tip, inn);
      let side = (inn.x - tip.x) * (w.y - tip.y) - (inn.y - tip.y) * (w.x - tip.x);
      return select(e, -e, side > 0.0);
    }
    case 6: { return b.x - q.y; }
    case 7: {
      let k0 = length(q / b.xy);
      let k1 = length(q / (b.xy * b.xy));
      return k0 * (k0 - 1.0) / max(k1, 1e-5);
    }
    default: { return 1e5; }
  }
}

fn opDist(i: i32, p: vec2f) -> f32 {
  let o = u.ops[i];
  let t = i32(o.a.x);
  let c = i32(o.a.y);
  let pr = o.a.z;
  var q = p - (o.c.xy + o.s.xy * (1.0 - pr));
  let cs = cos(o.c.z);
  let sn = sin(o.c.z);
  q = vec2f(cs * q.x + sn * q.y, -sn * q.x + cs * q.y);
  if (o.c.w > 0.5) {
    let sec = 6.2831853 / o.c.w;
    let a = atan2(q.y, q.x);
    let a2 = a - sec * round(a / sec);
    let rr = length(q);
    q = vec2f(rr * cos(a2) - o.s.z, rr * sin(a2));
  }
  var d: f32;
  if (c == 0) { let sc = max(pr, 1e-3); d = prim(t, q / sc, o.b) * sc; }
  else { d = prim(t, q, o.b); }
  if (o.s.w > 0.5) {
    if (c == 1) { d = mix(5.0, d, pr); }
    if (c == 2) { d = mix(-5.0, d, pr); }
  }
  return d;
}

fn mapM(p0: vec2f) -> f32 {
  var p = p0;
  var d = 1e5;
  let n = i32(u.bg.w);
  for (var i = 0; i < n; i++) {
    let o = u.ops[i];
    let t = i32(o.a.x);
    let pr = o.a.z;
    if (pr <= 0.0) { continue; }
    if (t >= 20) {
      if (t == 20) { d = mix(d, abs(d) - o.b.x, pr); }
      if (t == 21) { d = d - o.b.x * pr; }
      if (t == 22) {
        let an = o.b.x * pr * length(p);
        let cs = cos(an);
        let sn = sin(an);
        p = vec2f(cs * p.x - sn * p.y, sn * p.x + cs * p.y);
      }
      if (t == 23) {
        let sp = mix(40.0, o.b.x, pr);
        p.x = p.x - sp * clamp(round(p.x / sp), -o.b.y, o.b.y);
        p.y = p.y - sp * clamp(round(p.y / sp), -o.b.z, o.b.z);
      }
      continue;
    }
    let c = i32(o.a.y);
    let dp = opDist(i, p);
    if (c == 0) { d = smin(d, dp, o.a.w * pr); }
    else if (c == 1) { d = smax(d, -dp, o.a.w); }
    else { d = smax(d, dp, o.a.w); }
  }
  return d;
}

// The sphere-tracing demo: steps along the ray from u.ray.xy. Returns the
// cover of the circle outlines, the dots and the ray line at p (px: one
// pixel in units).
fn rayDemo(p: vec2f, px: f32) -> f32 {
  let ro = u.ray.xy;
  let rd = vec2f(cos(u.ray.z), sin(u.ray.z));
  let shown = u.act.z;
  var t = 0.0;
  var cov = 0.0;
  var reach = 0.0;
  for (var i = 0; i < 24; i++) {
    let fi = f32(i);
    if (fi >= shown) { break; }
    let q = ro + rd * t;
    let r = abs(mapM(q));
    let k = clamp(shown - fi, 0.0, 1.0);
    let ring = abs(length(p - q) - r * k);
    cov = max(cov, (1.0 - smoothstep(0.6 * px, 2.2 * px, ring)) * 0.8);
    cov = max(cov, 1.0 - smoothstep(3.0 * px, 4.5 * px, length(p - q)));
    t += r * k;
    reach = t;
    if (r < 0.004) { break; }
  }
  // the ray up to the last point
  let h = clamp(dot(p - ro, rd), 0.0, reach);
  cov = max(cov, (1.0 - smoothstep(1.0 * px, 2.2 * px, length(p - ro - rd * h))) * 0.95);
  return cov * u.ray.w;
}

@fragment fn fs_saver(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let res = u.res.xy;
  let px = 2.0 * u.view.z / res.y;
  let p = u.view.xy + ((2.0 * fc.xy - res) / res.y * vec2f(1.0, -1.0) - vec2f(0.0, u.view.w)) * u.view.z;
  let d = mapM(p);
  let e = vec2f(px, 0.0);
  let g = vec2f(mapM(p + e.xy) - mapM(p - e.xy), mapM(p + e.yx) - mapM(p - e.yx));
  let gl = length(g) / (2.0 * px);

  // backdrop with a soft vignette
  let vq = (2.0 * fc.xy - res) / res.y;
  var col = u.bg.rgb * (1.0 - 0.35 * dot(vq, vq) * 0.25);

  // flowing iso bands: phase moves outward with time
  let sp = u.look.x;
  let ph = d / sp - u.res.z * u.look.y;
  let band = 0.5 + 0.5 * cos(6.2831853 * ph);
  let far = exp(-max(d, 0.0) * 0.9);
  let ang = atan2(g.y, g.x);
  let hue = 0.5 + 0.5 * cos(vec3f(0.0, 2.094, 4.189) + ang);
  if (d > 0.0) {
    var c = mix(u.cOut.rgb * (0.35 + 0.65 * band), hue * (0.3 + 0.7 * band), u.look.z * 0.6);
    // thin contour lines on each band edge
    let fr = fract(ph);
    let edge = min(fr, 1.0 - fr) * sp / max(gl, 1e-3);
    c += u.cOut.rgb * 0.5 * (1.0 - smoothstep(0.0, 1.2 * px, edge));
    col = mix(col, c, far);
  } else {
    let c = mix(u.cIn.rgb * (0.55 + 0.45 * band), hue * (0.5 + 0.5 * band), u.look.z * 0.5);
    col = c;
  }
  // the zero isoline, and a glint that sweeps round it
  let zl = 1.0 - smoothstep(0.6 * px, 2.2 * px, abs(d) / max(gl, 1e-3));
  let pa = atan2(p.y - u.view.y, p.x - u.view.x);
  var da = abs(pa - u.look.w);
  da = min(da, 6.2831853 - da);
  let glint = exp(-da * da * 18.0) * u.act.w;
  col = mix(col, u.cLine.rgb * (1.0 + 2.5 * glint), zl);
  col += u.cLine.rgb * glint * exp(-abs(d) * 40.0) * 0.6;

  // ghost outline of the active op
  let ai = i32(u.act.x);
  if (ai >= 0) {
    let gd = abs(opDist(ai, p));
    let gline = 1.0 - smoothstep(0.5 * px, 2.0 * px, gd);
    let dash = step(0.5, fract(atan2(p.y, p.x) * 12.0 + u.res.z * 0.6));
    col = mix(col, u.cAcc.rgb, gline * u.act.y * mix(0.45, 1.0, dash));
    col += u.cAcc.rgb * exp(-gd * 18.0) * 0.18 * u.act.y;
  }

  // the sphere-tracing demo
  if (u.ray.w > 0.0) { col = mix(col, u.cAcc.rgb, rayDemo(p, px)); }

  col = pow(max(col, vec3f(0.0)), vec3f(1.0 / 2.2));
  return vec4f(col * u.res.w, 1.0);
}
