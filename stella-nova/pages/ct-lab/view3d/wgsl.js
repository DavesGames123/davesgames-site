// view3d/wgsl.js - WGSL sources for the 3D cone-beam view.
// Every mixed && / || has parentheses (Chrome Tint rejects them, naga does not).
//
// grep handles: FRAME, BG_WGSL, MESH_WGSL, LINE_WGSL, VOLUME_WGSL, FRAME_BYTES

// Frame uniform, 320 bytes. view3d.js writeFrame() fills it in this order.
export const FRAME_BYTES = 320;
export const FRAME = /* wgsl */ `
struct Frame {
  viewProj: mat4x4<f32>,
  invViewProj: mat4x4<f32>,
  gantry: mat4x4<f32>,
  camPos: vec4<f32>,    // xyz eye, w time (s)
  boxHalf: vec4<f32>,   // xyz volume half size, w ray steps across the diagonal
  win: vec4<f32>,       // lo, hi, mode (0 mip 1 dvr 2 iso 3 slices), value scale
  slices: vec4<f32>,    // slice fractions x, y, z; w skin iso (0..1)
  viewport: vec4<f32>,  // w, h, 1/w, 1/h (pixels)
  params: vec4<f32>,    // bone iso, opacity scale, volume on (0/1), ghost strength
  clip: vec4<f32>,      // cutaway corner xyz, w on (0/1)
  clipSign: vec4<f32>,  // octant side per axis (+1 or -1); the octant on that side of clip.xyz is cut
};
@group(0) @binding(0) var<uniform> F: Frame;
`;

export const BG_WGSL = /* wgsl */ `${FRAME}
struct VO { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VO;
  o.pos = vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2<f32>(p.x, 1.0 - p.y);
  return o;
}
fn hash(p: vec2<f32>) -> f32 {
  var h = (u32(p.x) * 1973u) ^ (u32(p.y) * 9277u) ^ 26699u;
  h = (h ^ (h >> 16u)) * 2246822519u;
  h = (h ^ (h >> 13u)) * 3266489917u;
  h = h ^ (h >> 16u);
  return f32(h & 16777215u) / 16777216.0;
}
@fragment fn fs(o: VO) -> @location(0) vec4<f32> {
  let q = o.uv - vec2<f32>(0.5, 0.42);
  let r = length(q * vec2<f32>(F.viewport.x * F.viewport.w, 1.0));
  let top = vec3<f32>(0.035, 0.05, 0.085);
  let bot = vec3<f32>(0.008, 0.01, 0.018);
  var c = mix(top, bot, smoothstep(0.0, 1.0, o.uv.y));
  c = c + vec3<f32>(0.03, 0.07, 0.11) * exp(-r * r * 5.0);
  c = c * (1.0 - 0.35 * smoothstep(0.45, 1.1, r));
  c = c + (hash(o.pos.xy) - 0.5) / 255.0;
  return vec4<f32>(c, 1.0);
}
`;

// Opaque meshes (fs) and the additive glass cone (fsGlass) share one vertex stage.
export const MESH_WGSL = /* wgsl */ `${FRAME}
@group(0) @binding(1) var detTex: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
struct VO {
  @builtin(position) pos: vec4<f32>,
  @location(0) n: vec3<f32>,
  @location(1) col: vec4<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) tex: f32,
  @location(4) wp: vec3<f32>,
};
@vertex fn vs(@location(0) p: vec3<f32>, @location(1) n: vec3<f32>, @location(2) c: vec4<f32>,
              @location(3) uv: vec2<f32>, @location(4) fl: vec2<f32>) -> VO {
  var wp = vec4<f32>(p, 1.0);
  var nn = n;
  if (fl.y > 0.5) { wp = F.gantry * wp; nn = (F.gantry * vec4<f32>(n, 0.0)).xyz; }
  var o: VO;
  o.pos = F.viewProj * wp;
  o.n = nn; o.col = c; o.uv = uv; o.tex = fl.x; o.wp = wp.xyz;
  return o;
}
@fragment fn fs(o: VO) -> @location(0) vec4<f32> {
  let N = normalize(o.n);
  let V = normalize(F.camPos.xyz - o.wp);
  let L1 = normalize(vec3<f32>(0.45, 0.8, 0.55));
  let L2 = normalize(vec3<f32>(-0.6, -0.25, -0.7));
  let dif = max(dot(N, L1), 0.0) * 0.75 + max(dot(N, L2), 0.0) * 0.25;
  let rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  let spec = pow(max(dot(N, normalize(L1 + V)), 0.0), 48.0) * 0.4;
  var c = o.col.rgb * (0.22 + dif) + vec3<f32>(spec) + rim * vec3<f32>(0.15, 0.4, 0.65) * 0.7;
  c = mix(c, o.col.rgb * 2.0, o.col.a);
  let t = textureSampleLevel(detTex, smp, o.uv, 0.0).rgb;
  if (o.tex > 0.5) { c = t + vec3<f32>(0.01, 0.015, 0.03) + vec3<f32>(spec * 0.25); }
  return vec4<f32>(c, 1.0);
}
@fragment fn fsGlass(o: VO) -> @location(0) vec4<f32> {
  let N = normalize(o.n);
  let V = normalize(F.camPos.xyz - o.wp);
  let f = 0.35 + 0.65 * pow(1.0 - abs(dot(N, V)), 2.0);
  let along = clamp(o.uv.x, 0.0, 1.0);
  let k = o.col.a * f * (0.4 + 0.6 * along);
  return vec4<f32>(o.col.rgb * k, 0.0);
}
`;

// Screen-space glow lines. One instance per segment, six vertices per instance.
export const LINE_WGSL = /* wgsl */ `${FRAME}
struct VO {
  @builtin(position) pos: vec4<f32>,
  @location(0) col: vec4<f32>,
  @location(1) across: f32,
  @location(2) along: f32,
  @location(3) w: f32,
  @location(4) rot: f32,
};
@vertex fn vs(@builtin(vertex_index) vi: u32, @location(0) a: vec3<f32>, @location(1) b: vec3<f32>,
              @location(2) col: vec4<f32>, @location(3) wr: vec2<f32>) -> VO {
  var corner = array<vec2<f32>, 6>(vec2<f32>(0.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
                                   vec2<f32>(0.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0));
  let c = corner[vi];
  var A = vec4<f32>(a, 1.0);
  var B = vec4<f32>(b, 1.0);
  if (wr.y > 0.5) { A = F.gantry * A; B = F.gantry * B; }
  let ca = F.viewProj * A;
  let cb = F.viewProj * B;
  var o: VO;
  o.col = col; o.along = c.x; o.w = wr.x; o.rot = wr.y;
  if ((ca.w < 0.02) || (cb.w < 0.02)) { o.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0); o.across = 0.0; return o; }
  let half = 0.5 * F.viewport.xy;
  let sa = ca.xy / ca.w * half;
  let sb = cb.xy / cb.w * half;
  var d = sb - sa;
  if (length(d) < 1e-4) { d = vec2<f32>(1.0, 0.0); }
  d = normalize(d);
  let perp = vec2<f32>(-d.y, d.x);
  let hw = wr.x * 2.0 + 2.0;
  var cp = mix(ca, cb, c.x);
  cp = vec4<f32>(cp.xy + perp * (c.y * hw) / half * cp.w, cp.zw);
  o.pos = cp;
  o.across = c.y * hw;
  return o;
}
@fragment fn fs(o: VO) -> @location(0) vec4<f32> {
  let d = abs(o.across);
  let core = exp(-pow(d / (0.5 * o.w + 0.35), 2.0) * 1.4);
  let glow = 0.3 * exp(-pow(d / (o.w * 1.6 + 1.0), 2.0) * 1.5);
  var k = (core + glow) * o.col.a;
  if (o.rot > 0.5) { k = k * (0.8 + 0.2 * sin(o.along * 40.0 - F.camPos.w * 9.0)); }
  return vec4<f32>(o.col.rgb * k, 0.0);
}
`;

// Fullscreen ray-march through the volume box. Reads the opaque depth to stop at meshes.
export const VOLUME_WGSL = /* wgsl */ `${FRAME}
@group(0) @binding(1) var vol: texture_3d<f32>;
@group(0) @binding(2) var smp: sampler;
@group(0) @binding(3) var lut: texture_2d<f32>;
@group(0) @binding(4) var depthTex: texture_depth_2d;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

fn raw(p: vec3<f32>) -> f32 {
  let B = F.boxHalf.xyz;
  let tc = vec3<f32>(p.x / (2.0 * B.x) + 0.5, 0.5 - p.y / (2.0 * B.y), p.z / (2.0 * B.z) + 0.5);
  let v = textureSampleLevel(vol, smp, tc, 0.0).r * F.win.w;
  return (v - F.win.x) / (F.win.y - F.win.x);
}
fn val(p: vec3<f32>) -> f32 {
  if (F.clip.w > 0.5) {
    let d = (p - F.clip.xyz) * F.clipSign.xyz;
    if ((d.x > 0.0) && (d.y > 0.0) && (d.z > 0.0)) { return 0.0; }
  }
  return raw(p);
}
fn grad(p: vec3<f32>, h: f32) -> vec3<f32> {
  return vec3<f32>(val(p + vec3<f32>(h, 0.0, 0.0)) - val(p - vec3<f32>(h, 0.0, 0.0)),
                   val(p + vec3<f32>(0.0, h, 0.0)) - val(p - vec3<f32>(0.0, h, 0.0)),
                   val(p + vec3<f32>(0.0, 0.0, h)) - val(p - vec3<f32>(0.0, 0.0, h)));
}
fn tf(s: f32) -> vec4<f32> { return textureSampleLevel(lut, smp, vec2<f32>(clamp(s, 0.0, 1.0) * 0.99609375 + 0.001953125, 0.25), 0.0); }
fn cmap(s: f32) -> vec3<f32> { return textureSampleLevel(lut, smp, vec2<f32>(clamp(s, 0.0, 1.0) * 0.99609375 + 0.001953125, 0.75), 0.0).rgb; }
fn hash(p: vec2<f32>) -> f32 {
  var h = (u32(p.x) * 1973u) ^ (u32(p.y) * 9277u) ^ 26699u;
  h = (h ^ (h >> 16u)) * 2246822519u;
  h = (h ^ (h >> 13u)) * 3266489917u;
  h = h ^ (h >> 16u);
  return f32(h & 16777215u) / 16777216.0;
}
fn shade(N: vec3<f32>, V: vec3<f32>, base: vec3<f32>, shin: f32, ks: f32) -> vec3<f32> {
  let L1 = normalize(vec3<f32>(0.5, 0.75, 0.45));
  let L2 = normalize(vec3<f32>(-0.7, -0.1, -0.5));
  let d = max(dot(N, L1), 0.0) * 0.8 + max(dot(N, L2), 0.0) * 0.3;
  let s = pow(max(dot(N, normalize(L1 + V)), 0.0), shin) * ks;
  let rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.25;
  return base * (0.18 + d) + vec3<f32>(s) + vec3<f32>(0.3, 0.55, 0.85) * rim;
}

@fragment fn fs(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  if (F.params.z < 0.5) { discard; }
  let B = F.boxHalf.xyz;
  let ndc = vec2<f32>(fc.x * F.viewport.z * 2.0 - 1.0, 1.0 - fc.y * F.viewport.w * 2.0);
  let pn = F.invViewProj * vec4<f32>(ndc, 0.0, 1.0);
  let pf = F.invViewProj * vec4<f32>(ndc, 1.0, 1.0);
  let ro = pn.xyz / pn.w;
  let rd = normalize(pf.xyz / pf.w - ro);
  var tLim = 1e9;
  let dz = textureLoad(depthTex, vec2<i32>(fc.xy), 0);
  if (dz < 1.0) {
    let pw = F.invViewProj * vec4<f32>(ndc, dz, 1.0);
    tLim = dot(pw.xyz / pw.w - ro, rd);
  }
  let sg = select(vec3<f32>(-1.0), vec3<f32>(1.0), rd >= vec3<f32>(0.0));
  let inv = 1.0 / (rd + sg * 1e-7);
  let ta = (-B - ro) * inv;
  let tb = (B - ro) * inv;
  let tn = min(ta, tb);
  let tx = max(ta, tb);
  let t0 = max(max(max(tn.x, tn.y), tn.z), 0.0);
  let t1 = min(min(min(tx.x, tx.y), tx.z), tLim);
  if (t1 <= t0) { discard; }

  let diag = 2.0 * length(B);
  let baseDt = diag / max(F.boxHalf.w, 16.0);
  let n = min(u32(ceil((t1 - t0) / baseDt)), 2048u);
  let dt = (t1 - t0) / f32(max(n, 1u));
  let jit = hash(fc.xy);
  let V = -rd;
  let h = 1.0 / max(F.boxHalf.w * 0.35, 32.0);
  let mode = u32(F.win.z + 0.5);

  if (mode == 0u) {
    var m = 0.0;
    for (var i = 0u; i < n; i = i + 1u) { m = max(m, val(ro + rd * (t0 + (f32(i) + jit) * dt))); }
    let a = smoothstep(0.02, 0.3, m);
    return vec4<f32>(cmap(m) * a, a);
  }

  if (mode == 1u) {
    var acc = vec4<f32>(0.0);
    let refDt = 1.0 / 160.0;
    for (var i = 0u; i < n; i = i + 1u) {
      let p = ro + rd * (t0 + (f32(i) + jit) * dt);
      let s = val(p);
      let c = tf(s);
      if (c.a > 0.002) {
        let a = 1.0 - pow(max(1.0 - c.a * F.params.y, 0.0), dt / refDt);
        var rgb = c.rgb;
        if (a > 0.015) {
          let g = grad(p, h);
          let gl = length(g);
          if (gl > 0.02) { rgb = shade(-g / gl, V, c.rgb, 32.0, 0.25 * c.a); }
        }
        acc = acc + vec4<f32>(rgb * a, a) * (1.0 - acc.a);
        if (acc.a > 0.98) { break; }
      }
    }
    return acc;
  }

  if (mode == 2u) {
    var acc = vec4<f32>(0.0);
    let skin = F.slices.w;
    let bone = F.params.x;
    var prev = val(ro + rd * t0);
    var skinDone = false;
    for (var i = 1u; i <= n; i = i + 1u) {
      let t = t0 + (f32(i) - 1.0 + jit) * dt;
      let p = ro + rd * t;
      let s = val(p);
      if ((!skinDone) && (s >= skin) && (prev < skin)) {
        let g = grad(p, h);
        let N = -g / max(length(g), 1e-5);
        let fr = pow(1.0 - abs(dot(N, V)), 2.2);
        let col = shade(N, V, vec3<f32>(0.95, 0.55, 0.48), 24.0, 0.3);
        let a = 0.07 + 0.5 * fr;
        acc = acc + vec4<f32>(col * a, a) * (1.0 - acc.a);
        skinDone = true;
      }
      if (s >= bone) {
        var lo = t - dt;
        var hi = t;
        for (var k = 0; k < 6; k = k + 1) {
          let mid = 0.5 * (lo + hi);
          if (val(ro + rd * mid) >= bone) { hi = mid; } else { lo = mid; }
        }
        let q = ro + rd * hi;
        let g = grad(q, h);
        let N = -g / max(length(g), 1e-5);
        let open = val(q + N * h * 3.0) < bone * 0.8;
        let col = shade(N, V, vec3<f32>(0.96, 0.92, 0.84), 40.0, 0.45) * select(0.72, 1.0, open);
        acc = acc + vec4<f32>(col, 1.0) * (1.0 - acc.a);
        break;
      }
      prev = s;
    }
    return acc;
  }

  // mode 3: slices. Up to three plane hits, composited front to back. Air on a plane
  // is translucent, so the planes behind stay visible. A faint MIP sits in front.
  let P = vec3<f32>((F.slices.x - 0.5) * 2.0 * B.x, (0.5 - F.slices.y) * 2.0 * B.y, (F.slices.z - 0.5) * 2.0 * B.z);
  var ht = array<f32, 3>(1e9, 1e9, 1e9);
  var ha = array<u32, 3>(3u, 3u, 3u);
  var nh = 0u;
  for (var k = 0u; k < 3u; k = k + 1u) {
    if (abs(rd[k]) < 1e-6) { continue; }
    let t = (P[k] - ro[k]) / rd[k];
    if ((t < t0) || (t > t1)) { continue; }
    let q = ro + rd * t;
    var ok = true;
    for (var j = 0u; j < 3u; j = j + 1u) { if ((j != k) && (abs(q[j]) > B[j] + 1e-4)) { ok = false; } }
    if (ok) { ht[nh] = t; ha[nh] = k; nh = nh + 1u; }
  }
  for (var a = 0u; a < 2u; a = a + 1u) {
    for (var b = 0u; b < 2u - a; b = b + 1u) {
      if (ht[b] > ht[b + 1u]) {
        let tt = ht[b]; ht[b] = ht[b + 1u]; ht[b + 1u] = tt;
        let aa = ha[b]; ha[b] = ha[b + 1u]; ha[b + 1u] = aa;
      }
    }
  }
  let tEnd = min(ht[0], t1);
  var m = 0.0;
  let nG = min(n, 160u);
  let dG = (tEnd - t0) / f32(max(nG, 1u));
  for (var i = 0u; i < nG; i = i + 1u) { m = max(m, raw(ro + rd * (t0 + (f32(i) + jit) * dG))); }
  let ga = smoothstep(0.05, 0.6, m) * F.params.w;
  var acc = vec4<f32>(cmap(m) * ga, ga);
  for (var h = 0u; h < nh; h = h + 1u) {
    let axis = ha[h];
    let q = ro + rd * ht[h];
    let s = raw(q);
    var col = cmap(s);
    var edge = 1e9;
    for (var j = 0u; j < 3u; j = j + 1u) { if (j != axis) { edge = min(edge, B[j] - abs(q[j])); } }
    var accent = vec3<f32>(1.0, 0.45, 0.35);
    if (axis == 1u) { accent = vec3<f32>(0.4, 1.0, 0.55); }
    if (axis == 2u) { accent = vec3<f32>(0.35, 0.7, 1.0); }
    let e = 1.0 - smoothstep(0.004, 0.012, edge);
    col = mix(col, accent, e * 0.9);
    let a = max(0.22 + 0.76 * smoothstep(0.02, 0.15, s), e);
    acc = acc + vec4<f32>(col * a, a) * (1.0 - acc.a);
  }
  return acc;
}
`;
