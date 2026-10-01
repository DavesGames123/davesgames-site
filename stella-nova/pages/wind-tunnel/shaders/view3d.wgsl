// view3d.wgsl — what the 3D tunnel shows. sdf.wgsl is prepended.
//
// Passes, in frame order (engine3d.js):
//   advect            compute  move each streamline particle one frame (RK2,
//                              trilinear velocity), write its new trail point
//   vsScene/fsScene   render   full-screen ray march: tunnel floor, the object
//                              (material or surface pressure), soft shadow;
//                              writes frag_depth
//   vsSlice/fsSlice   render   one plane through the field (speed, vorticity
//                              or pressure), alpha blended, depth tested
//   vsLine/fsLine     render   one screen-space quad per trail segment
//
// World = lattice frame: one unit is one cell, x downstream, y up. The floor
// of the fluid is y = 1 (row 0 is the ground or the free-slip floor). The
// macro texture holds (ux, uy, uz, rho - 1) at cell centers, so the texture
// coordinate of world point p is p / dims.
//
// grep: struct CamU  struct PartU  fn advect  fn fsScene  fn march  fn shadow
//       fn fsSlice  fn vsLine  fn speedRamp  fn divRamp  fn fieldColor  fn pref

struct CamU {
  vp: mat4x4f,
  ivp: mat4x4f,
  eye: vec4f,
  vpSize: vec4f,  // canvas w, h, streak width (px), streak alpha
  dims: vec4f,    // nx, ny, nz, U
  slice: vec4f,   // axis (0 x, 1 y, 2 z, 3 off), position (cells), field, alpha
  misc: vec4f,    // surface (0 material, 1 pressure), refL, ground, vorticity scale
  misc2: vec4f,   // pressure scale, time (s), streak color mode, pad
};

struct PartU {
  count: u32,
  K: u32,
  head: u32,
  seed: u32,
  dt: f32,
  mode: u32,      // 0 field, 1 rake
  life: f32,
  reseed: u32,
  rakeA: vec4f,   // x0, x1, y0, y1
  rakeB: vec4f,   // z0, z1
  sub: vec4u,     // trail slots written this frame, RK2 substeps per slot
};

@group(0) @binding(0) var<uniform> CAM: CamU;
@group(0) @binding(1) var<uniform> SH: ShapeU;
@group(0) @binding(2) var macroTex: texture_3d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var<storage, read> typesR: array<u32>;
@group(0) @binding(5) var<uniform> PU: PartU;
@group(0) @binding(6) var<storage, read_write> parts: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> trail: array<vec4f>;
@group(0) @binding(8) var<storage, read> partsR: array<vec4f>;
@group(0) @binding(9) var<storage, read> trailR: array<vec4f>;
@group(0) @binding(10) var<storage, read_write> prefOut: array<f32>;
@group(0) @binding(11) var<storage, read> prefR: array<f32>;

fn hashU(a: u32) -> u32 {
  var x = a;
  x ^= x >> 16u; x *= 0x7feb352du;
  x ^= x >> 15u; x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
fn rand01(a: u32) -> f32 { return f32(hashU(a) & 0xffffffu) / 16777216.0; }

fn macroAt(p: vec3f) -> vec4f {
  return textureSampleLevel(macroTex, samp, p / CAM.dims.xyz, 0.0);
}

fn solidAt(p: vec3f) -> bool {
  let d = vec3i(CAM.dims.xyz);
  let c = clamp(vec3i(floor(p)), vec3i(0), d - 1);
  return typesR[u32(c.x + d.x * (c.y + d.y * c.z))] >= 4u;
}

// ------------------------------------------------------------ color ramps

fn rampN(t: f32, c0: vec3f, c1: vec3f, c2: vec3f, c3: vec3f, c4: vec3f) -> vec3f {
  let x = clamp(t, 0.0, 1.0) * 4.0;
  if (x < 1.0) { return mix(c0, c1, x); }
  if (x < 2.0) { return mix(c1, c2, x - 1.0); }
  if (x < 3.0) { return mix(c2, c3, x - 2.0); }
  return mix(c3, c4, x - 3.0);
}
fn speedRamp(t: f32) -> vec3f {
  return rampN(t / 1.5, vec3f(0.02, 0.03, 0.08), vec3f(0.04, 0.22, 0.38), vec3f(0.10, 0.58, 0.66),
               vec3f(0.80, 0.90, 0.88), vec3f(1.0, 0.66, 0.24));
}
fn divRamp(t: f32) -> vec3f {
  return rampN(t * 0.5 + 0.5, vec3f(0.55, 0.80, 1.0), vec3f(0.12, 0.36, 0.78), vec3f(0.035, 0.04, 0.07),
               vec3f(0.82, 0.30, 0.14), vec3f(1.0, 0.86, 0.55));
}
// Streak color: deep blue at rest, cyan at U, white and amber above it.
fn streakRamp(t: f32) -> vec3f {
  return rampN(t / 1.9, vec3f(0.16, 0.30, 0.85), vec3f(0.20, 0.62, 0.95), vec3f(0.55, 0.92, 0.95),
               vec3f(0.98, 0.97, 0.90), vec3f(1.0, 0.62, 0.22));
}

fn fieldColor(p: vec3f, field: u32) -> vec3f {
  let m = macroAt(p);
  let U = CAM.dims.w;
  if (field == 1u) {
    let h = 1.0;
    let dx = (macroAt(p + vec3f(h, 0.0, 0.0)) - macroAt(p - vec3f(h, 0.0, 0.0))).xyz;
    let dy = (macroAt(p + vec3f(0.0, h, 0.0)) - macroAt(p - vec3f(0.0, h, 0.0))).xyz;
    let dz = (macroAt(p + vec3f(0.0, 0.0, h)) - macroAt(p - vec3f(0.0, 0.0, h))).xyz;
    let w = vec3f(dy.z - dz.y, dz.x - dx.z, dx.y - dy.x) * 0.5 / h;
    let wn = length(w) * CAM.misc.y / U * CAM.misc.w;
    return rampN(wn, vec3f(0.02, 0.03, 0.07), vec3f(0.20, 0.10, 0.45), vec3f(0.75, 0.22, 0.42),
                 vec3f(1.0, 0.62, 0.30), vec3f(1.0, 0.95, 0.75));
  }
  if (field == 2u) {
    return divRamp((m.w - prefR[0]) / 3.0 / (0.5 * U * U) * CAM.misc2.x);
  }
  return speedRamp(length(m.xyz) / U);
}

// ------------------------------------------------------------ particles

fn spawn(i: u32) -> vec3f {
  let base = i * 9781u + PU.seed * 6271u;
  var p = vec3f(0.0);
  for (var tries = 0u; tries < 6u; tries++) {
    let a = rand01(base + tries * 3u);
    let b = rand01(base + tries * 3u + 1u);
    let c = rand01(base + tries * 3u + 2u);
    if (PU.mode == 1u) {
      p = vec3f(mix(PU.rakeA.x, PU.rakeA.y, a), mix(PU.rakeA.z, PU.rakeA.w, b), mix(PU.rakeB.x, PU.rakeB.y, c));
    } else {
      p = vec3f(1.0, 1.5, 1.0) + vec3f(a, b, c) * (CAM.dims.xyz - vec3f(2.0, 2.5, 2.0));
    }
    if (!solidAt(p)) { break; }
  }
  return p;
}

@compute @workgroup_size(64)
fn advect(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= PU.count) { return; }
  var pa = parts[2u * i];
  var pb = parts[2u * i + 1u];
  var pos = pa.xyz;
  var fresh = PU.reseed != 0u || pb.x <= 0.0;
  // Trail. engine3d.js adds one ring slot each time the free stream has
  // moved TRAIL_SPACING cells, so a trail is about K x spacing cells long
  // at any step rate. This frame writes `slots` slots, the last one at
  // PU.head. With no new slot (slots 1, sub.x 0) the newest point slides.
  // Each slot takes m RK2 substeps of at most 1.5 cells.
  let slots = max(PU.sub.x, 1u);
  let m = max(PU.sub.y, 1u);
  if (!fresh) {
    let h = PU.dt / f32(slots * m);
    let d = CAM.dims.xyz;
    for (var k = 1u; k <= slots && !fresh; k++) {
      var u2 = vec3f(0.0);
      for (var j = 0u; j < m; j++) {
        let u1 = macroAt(pos).xyz;
        u2 = macroAt(pos + u1 * h * 0.5).xyz;
        pos += u2 * h;
        let out = any(pos < vec3f(0.5, 1.0, 0.5)) || any(pos > d - vec3f(1.0));
        if (out || solidAt(pos)) { fresh = true; break; }
      }
      if (!fresh) { trail[i * PU.K + (PU.head + PU.K - slots + k) % PU.K] = vec4f(pos, length(u2)); }
    }
    pa.w += 1.0;
    if (pa.w > pb.x) { fresh = true; }
  }
  if (fresh) {
    pos = spawn(i);
    let r = rand01(i * 131u + PU.seed * 17u + 5u);
    let life = PU.life * (0.5 + r);
    pa = vec4f(pos, select(0.0, r * life, PU.reseed != 0u));
    pb = vec4f(life, 0.0, 0.0, 0.0);
    for (var k = 0u; k < PU.K; k++) { trail[i * PU.K + k] = vec4f(pos, 0.0); }
    trail[i * PU.K + PU.head] = vec4f(pos, length(macroAt(pos).xyz));
  }
  pa = vec4f(pos, pa.w);
  parts[2u * i] = pa;
  parts[2u * i + 1u] = pb;
}

// ------------------------------------------------------------ pressure reference
// The solver holds rho = 1 at the inlet cells, and the sponge pulls rho
// toward 1 along the slip walls and the outlet. Inside the tunnel the
// static pressure sits higher, because the drag of the body needs a
// pressure drop along the tunnel. Cp from rho - 1 then showed the whole
// free stream as positive (a saturated orange field). pref averages
// rho - 1 over 256 points of the plane x = 6 (upstream, clear of the
// sponge bands), and the views take Cp = (rho - pref) / 3 / (U^2 / 2).
// That is the static port of a real tunnel. One workgroup, once a frame.
var<workgroup> pacc: array<f32, 256>;
@compute @workgroup_size(256)
fn pref(@builtin(local_invocation_index) li: u32) {
  let d = vec3i(CAM.dims.xyz);
  let sp = 10;
  let y0 = sp; let y1 = max(d.y - 1 - sp, sp + 1);
  let z0 = sp; let z1 = max(d.z - 1 - sp, sp + 1);
  let y = y0 + i32(f32(y1 - y0) * (f32(li % 16u) + 0.5) / 16.0);
  let z = z0 + i32(f32(z1 - z0) * (f32(li / 16u) + 0.5) / 16.0);
  pacc[li] = textureLoad(macroTex, vec3i(min(6, d.x - 1), y, z), 0).w;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (li < s) { pacc[li] += pacc[li + s]; }
    workgroupBarrier();
  }
  if (li == 0u) { prefOut[0] = pacc[0] / 256.0; }
}

// ------------------------------------------------------------ scene

struct SOut {
  @builtin(position) pos: vec4f,
  @location(0) ndc: vec2f,
};

@vertex
fn vsScene(@builtin(vertex_index) vi: u32) -> SOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  var o: SOut;
  o.pos = vec4f(p, 0.0, 1.0);
  o.ndc = p;
  return o;
}

struct FOut {
  @location(0) col: vec4f,
  @builtin(frag_depth) depth: f32,
};

fn unproject(ndc: vec2f, z: f32) -> vec3f {
  let h = CAM.ivp * vec4f(ndc, z, 1.0);
  return h.xyz / h.w;
}

fn depthOf(p: vec3f) -> f32 {
  let c = CAM.vp * vec4f(p, 1.0);
  return clamp(c.z / c.w, 0.0, 1.0);
}

// Ray against the box lo..hi: (t enter, t exit).
fn boxHit(ro: vec3f, rd: vec3f, lo: vec3f, hi: vec3f) -> vec2f {
  let inv = 1.0 / rd;
  let a = (lo - ro) * inv;
  let b = (hi - ro) * inv;
  let t0 = min(a, b);
  let t1 = max(a, b);
  return vec2f(max(max(t0.x, t0.y), max(t0.z, 0.0)), min(t1.x, min(t1.y, t1.z)));
}

fn march(ro: vec3f, rd: vec3f, t0: f32, t1: f32) -> vec4f {
  var t = t0;
  for (var i = 0; i < 200; i++) {
    let o = objDist(ro + rd * t);
    if (o.x < 0.02 + 0.002 * t) { return vec4f(t, o.y, o.z, 1.0); }
    t += o.x * 0.8;
    if (t > t1) { break; }
  }
  return vec4f(t1, 0.0, 0.0, 0.0);
}

fn shadow(p: vec3f, L: vec3f) -> f32 {
  var res = 1.0;
  var t = 0.6;
  for (var i = 0; i < 40; i++) {
    let d = objDist(p + L * t).x;
    res = min(res, 6.0 * d / t);
    t += clamp(d, 0.4, 8.0);
    if (res < 0.02 || t > 160.0) { break; }
  }
  return clamp(res, 0.0, 1.0);
}

fn normalAt(p: vec3f) -> vec3f {
  let e = 0.25;
  return normalize(vec3f(
    objDist(p + vec3f(e, 0.0, 0.0)).x - objDist(p - vec3f(e, 0.0, 0.0)).x,
    objDist(p + vec3f(0.0, e, 0.0)).x - objDist(p - vec3f(0.0, e, 0.0)).x,
    objDist(p + vec3f(0.0, 0.0, e)).x - objDist(p - vec3f(0.0, 0.0, e)).x));
}

@fragment
fn fsScene(i: SOut) -> FOut {
  let pn = unproject(i.ndc, 0.0);
  let pf = unproject(i.ndc, 1.0);
  let ro = CAM.eye.xyz;
  let rd = normalize(pf - pn);
  let d = CAM.dims.xyz;
  let L = normalize(vec3f(-0.45, 0.85, 0.35));

  var o: FOut;
  let sky = mix(vec3f(0.016, 0.018, 0.026), vec3f(0.04, 0.05, 0.07), clamp(rd.y * 0.5 + 0.5, 0.0, 1.0));
  o.col = vec4f(sky, 1.0);
  o.depth = 1.0;

  // Floor plane y = 1 over the tunnel footprint (and a dim apron around it).
  var tFloor = 1e9;
  if (rd.y < 0.0) { tFloor = (1.0 - ro.y) / rd.y; }

  let bh = boxHit(ro, rd, vec3f(0.0), d);
  var hit = vec4f(0.0);
  if (bh.x < bh.y) {
    hit = march(ro, rd, bh.x, min(bh.y, tFloor));
  }

  if (hit.w > 0.5) {
    let p = ro + rd * hit.x;
    let n = normalAt(p);
    let q = p - SH.origin.xyz - vec3f(hit.z * SH.spacing, 0.0, 0.0);
    var base = matColor(hit.y, toLocal(q));
    if (CAM.misc.x > 0.5) {
      let m = macroAt(p + n * 1.5);
      base = divRamp((m.w - prefR[0]) / 3.0 / (0.5 * CAM.dims.w * CAM.dims.w) * CAM.misc2.x);
    }
    let dif = max(dot(n, L), 0.0) * shadow(p + n * 0.3, L);
    let fill = max(dot(n, normalize(vec3f(0.6, 0.3, -0.7))), 0.0);
    let hv = normalize(L - rd);
    let shiny = select(0.15, 0.6, (hit.y > 1.5 && hit.y < 2.5) || (hit.y > 4.5 && hit.y < 6.5));
    let spec = pow(max(dot(n, hv), 0.0), 48.0) * shiny;
    let rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    var c = base * (0.18 + 0.85 * dif + 0.22 * fill) + vec3f(spec) + vec3f(0.12, 0.2, 0.3) * rim * 0.5;
    o.col = vec4f(c, 1.0);
    o.depth = depthOf(p);
    return o;
  }

  if (tFloor < 1e8) {
    let p = ro + rd * tFloor;
    let inside = p.x > 0.0 && p.x < d.x && p.z > 0.0 && p.z < d.z;
    let fade = exp(-0.0004 * tFloor * tFloor / (d.x * 0.2));
    var c = vec3f(0.035, 0.04, 0.05);
    if (inside) {
      c = vec3f(0.06, 0.068, 0.08);
      let g = abs(fract(p.xz / 8.0) - 0.5);
      let line = 1.0 - smoothstep(0.0, 0.04, 0.5 - max(g.x, g.y));
      c += vec3f(0.03) * line;
      // The belt: dashes that move downstream at the inlet speed.
      if (CAM.misc.z > 1.5) {
        let s = fract((p.x - CAM.misc2.y * 60.0 * CAM.dims.w * 4.0) / 12.0);
        c += vec3f(0.035, 0.04, 0.05) * step(0.75, s) * step(abs(fract(p.z / 6.0) - 0.5), 0.1);
      }
      c *= 0.35 + 0.65 * shadow(p + vec3f(0.0, 0.2, 0.0), L);
    }
    o.col = vec4f(mix(sky, c, clamp(fade, 0.0, 1.0)), 1.0);
    o.depth = depthOf(p);
  }
  return o;
}

// ------------------------------------------------------------ slice

struct POut {
  @builtin(position) pos: vec4f,
  @location(0) w: vec3f,
};

@vertex
fn vsSlice(@builtin(vertex_index) vi: u32) -> POut {
  var uv = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
                           vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  let t = uv[vi];
  let d = CAM.dims.xyz;
  let a = u32(CAM.slice.x);
  let s = CAM.slice.y;
  var w = vec3f(0.0);
  if (a == 0u) { w = vec3f(s, 1.0 + t.x * (d.y - 1.0), t.y * d.z); }
  else if (a == 1u) { w = vec3f(t.x * d.x, s, t.y * d.z); }
  else { w = vec3f(t.x * d.x, 1.0 + t.y * (d.y - 1.0), s); }
  var o: POut;
  o.pos = CAM.vp * vec4f(w, 1.0);
  if (a > 2u) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); }
  o.w = w;
  return o;
}

@fragment
fn fsSlice(i: POut) -> @location(0) vec4f {
  if (solidAt(i.w)) { discard; }
  let c = fieldColor(i.w, u32(CAM.slice.z));
  let a = CAM.slice.w;
  return vec4f(c * a, a);
}

// ------------------------------------------------------------ streaks

struct LOut {
  @builtin(position) pos: vec4f,
  @location(0) col: vec4f,
  @location(1) across: f32,
};

@vertex
fn vsLine(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> LOut {
  var o: LOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  o.col = vec4f(0.0);
  o.across = 0.0;
  let segs = PU.K - 1u;
  let p = ii / segs;
  let s = ii % segs;
  if (p >= PU.count) { return o; }
  let ia = (PU.head + 1u + s) % PU.K;
  let ib = (ia + 1u) % PU.K;
  let a = trailR[p * PU.K + ia];
  let b = trailR[p * PU.K + ib];
  if (distance(a.xyz, b.xyz) < 1e-4 || distance(a.xyz, b.xyz) > 30.0) { return o; }
  let ca = CAM.vp * vec4f(a.xyz, 1.0);
  let cb = CAM.vp * vec4f(b.xyz, 1.0);
  if (ca.w <= 0.01 || cb.w <= 0.01) { return o; }
  let sz = CAM.vpSize.xy;
  let sa = ca.xy / ca.w * sz * 0.5;
  let sb = cb.xy / cb.w * sz * 0.5;
  let dv = sb - sa;
  let len = max(length(dv), 1e-4);
  let dir = dv / len;
  let nrm = vec2f(-dir.y, dir.x);
  var corner = array<vec2f, 6>(vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
                               vec2f(0.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  let k = corner[vi];
  let w = CAM.vpSize.z * 0.5 + 0.75;
  let c = mix(ca, cb, k.x);
  let off = nrm * k.y * w / (sz * 0.5) * c.w;
  o.pos = vec4f(c.xy + off, c.z, c.w);
  let pa = partsR[2u * p];
  let life = partsR[2u * p + 1u].x;
  let tailF = pow(f32(s + 1u) / f32(segs), 1.3);
  let ageF = clamp(pa.w / 4.0, 0.0, 1.0) * clamp((life - pa.w) / 12.0, 0.0, 1.0);
  let sp = mix(a.w, b.w, k.x) / CAM.dims.w;
  var col = streakRamp(sp);
  if (CAM.misc2.z > 0.5) { col = mix(vec3f(0.80, 0.88, 0.95), vec3f(1.0, 0.97, 0.92), clamp(sp, 0.0, 1.0)); }
  o.col = vec4f(col, tailF * ageF * CAM.vpSize.w);
  o.across = k.y * w;
  return o;
}

@fragment
fn fsLine(i: LOut) -> @location(0) vec4f {
  let hw = CAM.vpSize.z * 0.5;
  let edge = 1.0 - smoothstep(hw - 0.25, hw + 0.75, abs(i.across));
  let a = i.col.a * edge;
  return vec4f(i.col.rgb * a, a);
}
