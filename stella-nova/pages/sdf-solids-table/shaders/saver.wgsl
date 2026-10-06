// ============================================================================
//  SDF SOLIDS TABLE  ·  shaders/saver.wgsl — the build-up screensaver
// ----------------------------------------------------------------------------
//  One full-screen pass. The solid is an ordered op list in the uniform block
//  (saver.js writes it). mapM walks the list: primitives join, cut or
//  intersect the running distance d, and modifier ops change d or the point.
//  Each op has a progress pr in [0, 1]. An op at pr = 0 changes nothing:
//    union ...... skipped; it grows in by scale, from pr > 0
//    subtract ... skipped; the cutter slides in from far (s.xyz), or its
//                 distance eases in from +L (the lerp
//                 distance L, about half the cutter depth)
//    intersect .. skipped; the distance eases in from -L
//    onion ...... d = mix(d, |d| - t, pr)     round ... d = d - r pr
//    twist ...... angle b.x pr y             grid .... spacing eases from 40
//  The active op (act.x) also draws a ghost glow along the ray, so a cutter
//  shows before it touches the solid.
//
//  OP LAYOUT (7 vec4 = 112 bytes, saver.js "function packOp")
//    a  type, combine (0 union, 1 subtract, 2 intersect), pr, k
//    b  primitive or modifier parameters
//    c  pos.xyz, polar repetition count (0 none)
//    r0 world-to-local row 0, material id   r1 row 1, lerp distance L (0 off)   r2 row 2
//    s  slide.xyz (offset at pr = 0), polar repetition radius
//
//  GREP MAP
//    fn prim ...... primitives 0 sphere 1 box 2 torus 3 cylinder 4 capsule
//                   5 capped cone 6 half-space (inside above y = b.x)
//                   7 ellipsoid 8 gyroid shell
//    fn opDist .... one op in its local frame (slide, scale, repetition)
//    fn mapM ...... the op list walk: distance and material
//    fn shade ..... studio light, shadow, occlusion, reflection
//    @fragment fs_saver
// ============================================================================
struct Op { a: vec4f, b: vec4f, c: vec4f, r0: vec4f, r1: vec4f, r2: vec4f, s: vec4f };
struct U {
  res: vec4f,                // width, height, time, fade
  eye: vec4f,                // eye xyz, tan(fov / 2)
  tgt: vec4f,                // target xyz, op count
  act: vec4f,                // active op, ghost strength, floor y, bound radius
  bg0: vec4f, bg1: vec4f,    // backdrop top (w: view lift) and bottom
  acc: vec4f,                // ghost and rim accent
  m: array<vec4f, 4>,        // material rgb, metalness
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

fn prim(t: i32, q: vec3f, b: vec4f) -> f32 {
  switch t {
    case 0: { return length(q) - b.x; }
    case 1: {
      let d = abs(q) - b.xyz + vec3f(b.w);
      return length(max(d, vec3f(0.0))) + min(max(d.x, max(d.y, d.z)), 0.0) - b.w;
    }
    case 2: { return length(vec2f(length(q.xz) - b.x, q.y)) - b.y; }
    case 3: {
      let d = vec2f(length(q.xz), abs(q.y)) - vec2f(b.x, b.y) + vec2f(b.z);
      return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0) - b.z;
    }
    case 4: { let y = clamp(q.y, -b.x, b.x); return length(q - vec3f(0.0, y, 0.0)) - b.y; }
    case 5: {
      // bottom radius b.x at y = -b.z, top radius b.y at y = +b.z
      let h = b.z;
      let w = vec2f(length(q.xz), q.y);
      let k1 = vec2f(b.y, h);
      let k2 = vec2f(b.y - b.x, 2.0 * h);
      let ca = vec2f(w.x - min(w.x, select(b.y, b.x, w.y < 0.0)), abs(w.y) - h);
      let cb = w - k1 + k2 * clamp(dot(k1 - w, k2) / dot(k2, k2), 0.0, 1.0);
      let sg = select(1.0, -1.0, (cb.x < 0.0) && (ca.y < 0.0));
      return sg * sqrt(min(dot(ca, ca), dot(cb, cb)));
    }
    case 6: { return b.x - q.y; }
    case 7: {
      let k0 = length(q / b.xyz);
      let k1 = length(q / (b.xyz * b.xyz));
      return k0 * (k0 - 1.0) / max(k1, 1e-5);
    }
    case 8: {
      let g = dot(sin(q * b.x), cos(q.zxy * b.x));
      return (abs(g) / b.x) * 0.55 - b.y;
    }
    default: { return 1e5; }
  }
}

// One op in its local frame. Union ops grow in by scale; cutters slide in
// from pos + s.xyz, or ease their distance in (lerp distance L (0 off) r1.w).
fn opDist(i: i32, p: vec3f) -> f32 {
  let o = u.ops[i];
  let t = i32(o.a.x);
  let c = i32(o.a.y);
  let pr = o.a.z;
  var q = p - (o.c.xyz + o.s.xyz * (1.0 - pr));
  q = vec3f(dot(o.r0.xyz, q), dot(o.r1.xyz, q), dot(o.r2.xyz, q));
  if (o.c.w > 0.5) {
    let sec = 6.2831853 / o.c.w;
    let a = atan2(q.z, q.x);
    let a2 = a - sec * round(a / sec);
    let rr = length(q.xz);
    q = vec3f(rr * cos(a2) - o.s.w, q.y, rr * sin(a2));
  }
  var d: f32;
  if (c == 0) { let sc = max(pr, 1e-3); d = prim(t, q / sc, o.b) * sc; }
  else { d = prim(t, q, o.b); }
  if (o.r1.w > 0.0) {
    if (c == 1) { d = mix(o.r1.w, d, pr); }
    if (c == 2) { d = mix(-o.r1.w, d, pr); }
  }
  return d;
}

// The op list walk. Returns (distance, material id).
fn mapM(p0: vec3f) -> vec2f {
  var p = p0;
  var d = 1e5;
  var m = 0.0;
  let n = i32(u.tgt.w);
  for (var i = 0; i < n; i++) {
    let o = u.ops[i];
    let t = i32(o.a.x);
    let pr = o.a.z;
    if (pr <= 0.0) { continue; }
    if (t >= 20) {
      if (t == 20) { d = mix(d, abs(d) - o.b.x, pr); }
      if (t == 21) { d = d - o.b.x * pr; }
      if (t == 22) {
        let an = o.b.x * pr * p.y;
        let cs = cos(an);
        let sn = sin(an);
        p = vec3f(cs * p.x - sn * p.z, p.y, sn * p.x + cs * p.z);
      }
      if (t == 23) {
        let sp = mix(40.0, o.b.x, pr);
        p.x = p.x - sp * clamp(round(p.x / sp), -o.b.y, o.b.y);
        p.z = p.z - sp * clamp(round(p.z / sp), -o.b.z, o.b.z);
      }
      continue;
    }
    let c = i32(o.a.y);
    let dp = opDist(i, p);
    if (c == 0) {
      if (dp < d) { m = o.r0.w; }
      d = smin(d, dp, o.a.w * pr);
    } else if (c == 1) {
      if (-dp > d) { m = o.r0.w; }
      d = smax(d, -dp, o.a.w);
    } else {
      if (dp > d) { m = o.r0.w; }
      d = smax(d, dp, o.a.w);
    }
  }
  return vec2f(d, m);
}

fn nrm(p: vec3f) -> vec3f {
  let e = vec2f(1.0, -1.0) * 0.0015;
  return normalize(e.xyy * mapM(p + e.xyy).x + e.yyx * mapM(p + e.yyx).x +
                   e.yxy * mapM(p + e.yxy).x + e.xxx * mapM(p + e.xxx).x);
}

fn backdrop(rd: vec3f) -> vec3f {
  let g = clamp(rd.y * 0.6 + 0.5, 0.0, 1.0);
  var c = mix(u.bg1.rgb, u.bg0.rgb, g);
  // two soft boxes, so metal has something to reflect
  c += vec3f(1.0, 0.96, 0.9) * 1.6 * pow(max(dot(rd, normalize(vec3f(0.5, 0.8, 0.3))), 0.0), 60.0);
  c += u.acc.rgb * 0.5 * pow(max(dot(rd, normalize(vec3f(-0.8, 0.2, -0.4))), 0.0), 18.0);
  return c;
}

fn shadow(ro: vec3f, rd: vec3f) -> f32 {
  var r = 1.0;
  var t = 0.02;
  for (var i = 0; i < 28; i++) {
    let h = mapM(ro + rd * t).x;
    r = min(r, 10.0 * h / t);
    t += clamp(h, 0.02, 0.25);
    if ((r < 0.01) || (t > 6.0)) { break; }
  }
  return clamp(r, 0.0, 1.0);
}

fn occl(p: vec3f, n: vec3f) -> f32 {
  var o = 0.0;
  var w = 1.0;
  for (var i = 1; i <= 5; i++) {
    let h = 0.03 * f32(i);
    o += (h - mapM(p + n * h).x) * w;
    w *= 0.7;
  }
  return clamp(1.0 - 3.0 * o, 0.0, 1.0);
}

fn shade(p: vec3f, n: vec3f, rd: vec3f, mid: f32) -> vec3f {
  let mt = u.m[clamp(i32(mid + 0.5), 0, 3)];
  let key = normalize(vec3f(0.5, 0.8, 0.3));
  let dif = max(dot(n, key), 0.0) * shadow(p + n * 0.01, key);
  let ao = occl(p, n);
  let r = reflect(rd, n);
  let fre = pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
  // reflections see two bright panels as well as the backdrop
  let env = backdrop(r) + vec3f(1.0, 0.97, 0.92) * 1.4 * smoothstep(0.55, 0.75, r.y)
          + u.acc.rgb * 0.6 * smoothstep(0.82, 0.95, dot(r, normalize(vec3f(-0.9, 0.1, 0.3))));
  let spec = pow(max(dot(r, key), 0.0), 48.0) * dif;
  let base = mt.rgb * (0.12 + 0.18 * (0.5 + 0.5 * n.y) + 0.85 * dif) * ao;
  let metal = mt.rgb * env * ao;
  var col = mix(base, metal, mt.w) + spec * mix(0.4, 1.0, mt.w);
  col += env * fre * 0.35 * ao + u.acc.rgb * fre * 0.25;
  return col;
}

@fragment fn fs_saver(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let res = u.res.xy;
  // the view lift moves the subject up, into the clear band of the plate
  let uv = (2.0 * fc.xy - res) / res.y * vec2f(1.0, -1.0) - vec2f(0.0, u.bg0.w);
  let ro = u.eye.xyz;
  let fw = normalize(u.tgt.xyz - ro);
  let rt = normalize(cross(fw, vec3f(0.0, 1.0, 0.0)));
  let up = cross(rt, fw);
  let rd = normalize(fw + (uv.x * rt + uv.y * up) * u.eye.w);
  var col = backdrop(rd);

  // the floor
  let fy = u.act.z;
  var tf = 1e9;
  if (rd.y < 0.0) { tf = (fy - ro.y) / rd.y; }

  // bound sphere at the origin
  let R = u.act.w;
  let bq = dot(ro, rd);
  let disc = bq * bq - dot(ro, ro) + R * R;
  var t = 1e9;
  var mid = 0.0;
  var glow = 0.0;
  if (disc > 0.0) {
    var s = max(-bq - sqrt(disc), 0.0);
    let s1 = -bq + sqrt(disc);
    let ai = i32(u.act.x);
    for (var i = 0; i < 120; i++) {
      let pp = ro + rd * s;
      let h = mapM(pp);
      if (ai >= 0) {
        let g = abs(opDist(ai, pp));
        glow += exp(-g * 26.0) * 0.045;
      }
      if (h.x < 0.0007 * s) { t = s; mid = h.y; break; }
      s += h.x * 0.9;
      if (s > s1) { break; }
    }
  }
  if (tf < t) {
    let p = ro + rd * tf;
    let key = normalize(vec3f(0.5, 0.8, 0.3));
    let sh = shadow(p + vec3f(0.0, 0.01, 0.0), key);
    let fall = exp(-0.07 * dot(p.xz, p.xz));
    col = mix(col, u.bg1.rgb * (0.55 + 0.45 * sh) + vec3f(0.02) * sh, fall);
  } else if (t < 1e8) {
    let p = ro + rd * t;
    col = shade(p, nrm(p), rd, mid);
  }
  col += u.acc.rgb * glow * u.act.y;
  col = 1.0 - exp(-col * 1.15);
  col = pow(col, vec3f(1.0 / 2.2));
  return vec4f(col * u.res.w, 1.0);
}
