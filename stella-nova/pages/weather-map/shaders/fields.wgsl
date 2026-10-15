// ============================================================================
//  WEATHER MAP  ·  fields.wgsl — temperature fill, radar, wind streaks and
//  isobar lines. render/fields.js prepends frame.wgsl (struct Frame, F, fr_*).
// ----------------------------------------------------------------------------
//  vsField + fsTemp   full-screen, ray-traced against the shell FD_SHELL:
//                     Catmull-Rom t2m in the TV palette (Fd.temp), less
//                     opaque over water (tWater), faint 10 °F isotherms and a
//                     stronger 32 °F line (fwidth, so uniform control flow up
//                     to the derivative).
//  vsField + fsRadar  the radar mosaic (tRadA / tRadB, r = dBZ / 85, g snow)
//                     mixed by Fd.rad.x, crossfaded to the model precip
//                     (futurecast, Z = 200 R^1.6 with cell noise) by Fd.rad.y,
//                     coloured with Fd.rain or Fd.snow.
//  vsField + fsWind   dashes that move along the 10 m wind, in two staggered
//                     tile grids so the pattern bends with the flow.
//  vsLine + fsLine    isobar strips (render/fields.js lineMesh): miter offset
//                     in screen space, anti-aliased core with a dark halo.
//  Every fragment writes frag_depth of its shell point, so the globe depth
//  hides the far side. Colours are display sRGB, premultiplied.
//
//  grep -n targets: "struct Fld", "fn fd_sample", "fn fd_inside", "fn fd_ramp",
//  "fn fd_tempColor", "fn fsTemp", "fn fsRadar", "fn fsWind", "fn vsLine", "fn fsLine"
// ============================================================================

struct Fld {
  gridA: vec4f,   // grid lat0, dLat, lon0, dLon
  gridB: vec4f,   // nLat, nLon, point offset of slice k0, of slice k1
  mixA: vec4f,    // x slice mix u, y has grid, z flow hours, w quality
  op: vec4f,      // opacity: x temperature, y radar, z wind, w isobars
  radB: vec4f,    // radar texture lat0, lat1, lon0, lon1
  rad: vec4f,     // x frame A/B mix, y model weight, z has radar, w has water mask
  look: vec4f,    // x sea opacity factor, y isotherm alpha, z temp stop count, w rain stop count
  look2: vec4f,   // x snow stop count, y isobar width (CSS px), z lowest dBZ shown, w unused
  temp: array<vec4f, 16>,  // rgb (sRGB), w °C
  rain: array<vec4f, 12>,  // rgb, w dBZ
  snow: array<vec4f, 8>,   // rgb, w dBZ
}

struct GP { a: vec4f, b: vec4f }  // a: cloud, low, high, precip (mm / 3 h); b: u10, v10, t2m, snow (cm / 3 h)

@group(1) @binding(0) var<uniform> Fd: Fld;
@group(1) @binding(1) var<storage, read> GR: array<GP>;
@group(1) @binding(2) var tRadA: texture_2d<f32>;
@group(1) @binding(3) var tRadB: texture_2d<f32>;
@group(1) @binding(4) var tWater: texture_2d<f32>;
@group(1) @binding(5) var sClampF: sampler;
@group(1) @binding(6) var sWrapF: sampler;

const FD_SHELL = 1.0022;

// ── noise (same hash as clouds.wgsl) ──
fn fd_pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn fd_hash3(c: vec3i) -> f32 {
  let x = u32(c.x) * 73856093u;
  let y = u32(c.y) * 19349663u;
  let z = u32(c.z) * 83492791u;
  return f32(fd_pcg((x ^ y) ^ z) >> 8u) / 16777216.0;
}
fn fd_vnoise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let c = vec3i(i);
  let x00 = mix(fd_hash3(c), fd_hash3(c + vec3i(1, 0, 0)), u.x);
  let x10 = mix(fd_hash3(c + vec3i(0, 1, 0)), fd_hash3(c + vec3i(1, 1, 0)), u.x);
  let x01 = mix(fd_hash3(c + vec3i(0, 0, 1)), fd_hash3(c + vec3i(1, 0, 1)), u.x);
  let x11 = mix(fd_hash3(c + vec3i(0, 1, 1)), fd_hash3(c + vec3i(1, 1, 1)), u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}
fn fd_fbm(p0: vec3f, oct: i32) -> f32 {
  var p = p0;
  var s = 0.0;
  var a = 0.5;
  var n = 0.0;
  for (var i = 0; i < oct; i++) {
    s += a * fd_vnoise(p);
    n += a;
    p = p * 2.03 + vec3f(17.1, 31.7, 7.3);
    a *= 0.5;
  }
  return s / n;
}

// ── geometry ──
struct FV { @builtin(position) pos: vec4f }

@vertex
fn vsField(@builtin(vertex_index) i: u32) -> FV {
  var o: FV;
  let x = f32((i << 1u) & 2u);
  let y = f32(i & 2u);
  o.pos = vec4f(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
  return o;
}

fn fd_ray(px: vec2f) -> vec3f {
  let ndc = vec2f(px.x / F.viewport.x * 2.0 - 1.0, 1.0 - px.y / F.viewport.y * 2.0);
  let f = F.invViewProj * vec4f(ndc, 1.0, 1.0);
  return normalize(f.xyz / f.w - F.eye.xyz);
}

fn fd_hit(ro: vec3f, rd: vec3f, r: f32) -> f32 {
  let b = dot(ro, rd);
  let c = dot(ro, ro) - r * r;
  let h = b * b - c;
  // branch-free, so callers stay in uniform control flow
  let t = -b - sqrt(max(h, 0.0));
  return select(-1.0, t, h >= 0.0 && t > 0.0);
}

// (lat, lon) in degrees of a unit vector
fn fd_latLon(n: vec3f) -> vec2f {
  return vec2f(degrees(asin(clamp(n.y, -1.0, 1.0))), degrees(atan2(-n.z, n.x)));
}

fn fd_depth(p: vec3f) -> f32 {
  let c = F.viewProj * vec4f(p, 1.0);
  return clamp(c.z / c.w, 0.0, 1.0);
}

// ── grid ──
fn fd_gp(i: i32, j: i32, off: f32) -> GP {
  let nLat = i32(Fd.gridB.x);
  let nLon = i32(Fd.gridB.y);
  return GR[u32(off) + u32(clamp(i, 0, nLat - 1) * nLon + clamp(j, 0, nLon - 1))];
}

fn fd_cr(t: f32) -> vec4f {
  return vec4f(
    t * ((2.0 - t) * t - 1.0) * 0.5,
    (t * t * (3.0 * t - 5.0) + 2.0) * 0.5,
    t * ((4.0 - 3.0 * t) * t + 1.0) * 0.5,
    (t - 1.0) * t * t * 0.5);
}

// The grid at ll = (lat, lon): Catmull-Rom in space, linear in time.
fn fd_sample(ll: vec2f) -> GP {
  let fi = clamp((ll.x - Fd.gridA.x) / Fd.gridA.y, 0.0, Fd.gridB.x - 1.0);
  let fj = clamp((ll.y - Fd.gridA.z) / Fd.gridA.w, 0.0, Fd.gridB.y - 1.0);
  let i0 = i32(floor(fi));
  let j0 = i32(floor(fj));
  let wi = fd_cr(fi - f32(i0));
  let wj = fd_cr(fj - f32(j0));
  var a0 = vec4f(0.0);
  var b0 = vec4f(0.0);
  var a1 = vec4f(0.0);
  var b1 = vec4f(0.0);
  for (var di = 0; di < 4; di++) {
    for (var dj = 0; dj < 4; dj++) {
      let w = wi[di] * wj[dj];
      let p0 = fd_gp(i0 - 1 + di, j0 - 1 + dj, Fd.gridB.z);
      let p1 = fd_gp(i0 - 1 + di, j0 - 1 + dj, Fd.gridB.w);
      a0 += w * p0.a;
      b0 += w * p0.b;
      a1 += w * p1.a;
      b1 += w * p1.b;
    }
  }
  var g: GP;
  g.a = mix(a0, a1, Fd.mixA.x);
  g.b = mix(b0, b1, Fd.mixA.x);
  return g;
}

// 1 well inside the grid, 0 at and outside its edge (2 degree feather)
fn fd_inside(ll: vec2f) -> f32 {
  let lat1 = Fd.gridA.x + (Fd.gridB.x - 1.0) * Fd.gridA.y;
  let lon1 = Fd.gridA.z + (Fd.gridB.y - 1.0) * Fd.gridA.w;
  let c = cos(radians(ll.x));
  let d = min(min(ll.x - Fd.gridA.x, lat1 - ll.x), min(ll.y - Fd.gridA.z, lon1 - ll.y) * c);
  return smoothstep(0.0, 2.0, d) * Fd.mixA.y;
}

fn fd_tempColor(c: f32) -> vec3f {
  let n = i32(Fd.look.z);
  var col = Fd.temp[0].rgb;
  for (var i = 1; i < 16; i++) {
    if (i >= n) { break; }
    let a = Fd.temp[i - 1];
    let b = Fd.temp[i];
    col = select(col, mix(a.rgb, b.rgb, clamp((c - a.w) / (b.w - a.w), 0.0, 1.0)), c > a.w);
  }
  return col;
}

// radar ramp: rain (Fd.rain) or snow (Fd.snow) by dBZ
fn fd_ramp(dbz: f32, snow: bool) -> vec3f {
  var col = select(Fd.rain[0].rgb, Fd.snow[0].rgb, snow);
  let n = select(i32(Fd.look.w), i32(Fd.look2.x), snow);
  for (var i = 1; i < 12; i++) {
    if (i >= n) { break; }
    var a = Fd.rain[i - 1];
    var b = Fd.rain[i];
    if (snow) {
      a = Fd.snow[min(i - 1, 7)];
      b = Fd.snow[min(i, 7)];
    }
    col = select(col, mix(a.rgb, b.rgb, clamp((dbz - a.w) / (b.w - a.w), 0.0, 1.0)), dbz > a.w);
  }
  return col;
}

fn fd_radarAlpha(dbz: f32) -> f32 {
  let m = Fd.look2.z;
  return smoothstep(m - 3.0, m + 6.0, dbz) * (0.72 + 0.28 * smoothstep(20.0, 45.0, dbz));
}

struct FO {
  @location(0) color: vec4f,
  @builtin(frag_depth) depth: f32,
}

// ── temperature ──
@fragment
fn fsTemp(in: FV) -> FO {
  let ro = F.eye.xyz;
  let rd = fd_ray(in.pos.xy);
  let t = fd_hit(ro, rd, FD_SHELL);
  let hit = t > 0.0;
  // every pixel gets a point (closest approach on a miss), so fwidth below
  // runs in uniform control flow
  let p = select(ro + rd * max(-dot(ro, rd), 0.0), ro + rd * t, hit);
  let n = normalize(p);
  let ll = fd_latLon(n);
  let g = fd_sample(ll);
  let tc = g.b.z;
  let tF = tc * 1.8 + 32.0;
  let fw = max(fwidth(tF), 1e-3);
  let iso = 1.0 - smoothstep(0.6, 1.6, abs(fract(tF / 10.0 + 0.5) - 0.5) * 10.0 / fw);
  let frz = 1.0 - smoothstep(0.8, 2.0, abs(tF - 32.0) / fw);

  var col = fd_tempColor(tc);
  var water = 0.0;
  if (Fd.rad.w > 0.5) {
    let uv = vec2f(ll.y / 360.0 + 0.5, 0.5 - ll.x / 180.0);
    water = textureSampleLevel(tWater, sWrapF, uv, 0.0).r;
  }
  let inside = fd_inside(ll) * fr_limbFade(n) * select(0.0, 1.0, hit);
  var a = Fd.op.x * mix(1.0, Fd.look.x, water);
  col = mix(col, vec3f(1.0), iso * Fd.look.y);
  a = max(a, iso * Fd.look.y * Fd.op.x);
  col = mix(col, vec3f(0.82, 0.93, 1.0), frz * 0.7);
  a = max(a, frz * 0.7 * Fd.op.x) * inside;

  var o: FO;
  o.color = vec4f(col * a, a);
  o.depth = select(1.0, fd_depth(p), hit);
  return o;
}

// ── radar and futurecast ──
@fragment
fn fsRadar(in: FV) -> FO {
  let ro = F.eye.xyz;
  let rd = fd_ray(in.pos.xy);
  let t = fd_hit(ro, rd, FD_SHELL);
  if (t <= 0.0) { discard; }
  let p = ro + rd * t;
  let n = normalize(p);
  let ll = fd_latLon(n);

  // observed: the mosaic pair
  var dbzR = 0.0;
  var snowR = 0.0;
  if (Fd.rad.z > 0.5) {
    let uv = vec2f((ll.y - Fd.radB.z) / (Fd.radB.w - Fd.radB.z), (Fd.radB.y - ll.x) / (Fd.radB.y - Fd.radB.x));
    if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
      let s = mix(textureSampleLevel(tRadA, sClampF, uv, 0.0), textureSampleLevel(tRadB, sClampF, uv, 0.0), Fd.rad.x);
      dbzR = s.r * 85.0;
      snowR = s.g;
    }
  }
  // model: precip mm per 3 h as rain rate, broken into cells
  var dbzM = 0.0;
  var snowM = 0.0;
  let wM = Fd.rad.y;
  if (wM > 0.001 && Fd.mixA.y > 0.5) {
    let g = fd_sample(ll);
    let P = max(g.a.w, 0.0);
    let drift = vec3f(Fd.mixA.z * 0.004, 0.0, -Fd.mixA.z * 0.003);
    let cells = fd_fbm(n * 140.0 + drift, select(3, 4, Fd.mixA.w > 1.5));
    let R = P / 3.0 * exp((cells - 0.5) * 3.2) * smoothstep(0.32, 0.5, cells + P * 0.04);
    dbzM = select(0.0, 10.0 * log(200.0 * pow(R, 1.6)) / log(10.0), R > 0.02) * fd_inside(ll);
    snowM = clamp(max(g.b.w, 0.0) / max(0.7 * P, 1e-3), 0.0, 1.0);
  }
  let dbz = mix(dbzR, dbzM, wM);
  let snow = mix(snowR, snowM, wM);
  let a = fd_radarAlpha(dbz) * Fd.op.y * fr_limbFade(n);
  if (a < 0.003) { discard; }
  let col = fd_ramp(dbz, snow > 0.5);

  var o: FO;
  o.color = vec4f(col * a, a);
  o.depth = fd_depth(p);
  return o;
}

// ── wind ──
fn fd_windTile(pos: vec2f, shift: vec2f, ts: f32, sp: f32, dir: vec2f, speed: f32, px: f32) -> f32 {
  let q = pos + shift;
  let cell = floor(q / ts);
  let r = q - (cell + 0.5) * ts;
  let win = 1.0 - smoothstep(0.3 * ts, 0.5 * ts, max(abs(r.x), abs(r.y)));
  let along = dot(r, dir);
  let across = dot(r, vec2f(-dir.y, dir.x));
  let lane = floor(across / sp);
  let h = fd_hash3(vec3i(i32(cell.x), i32(cell.y), i32(lane) + 4099));
  let keep = select(0.0, 1.0, h < clamp(speed / 10.0, 0.25, 0.9));
  let off = abs(across - (lane + 0.5) * sp);
  let line = 1.0 - smoothstep(0.6 * px, 1.6 * px, off);
  let len = sp * 3.0;
  let ph = fract(along / len - F.eye.w * (0.08 + speed * 0.025) + h * 7.0);
  let streak = smoothstep(0.0, 0.7, ph) * (1.0 - smoothstep(0.7, 0.78, ph));
  return win * keep * line * streak;
}

@fragment
fn fsWind(in: FV) -> FO {
  let ro = F.eye.xyz;
  let rd = fd_ray(in.pos.xy);
  let t = fd_hit(ro, rd, FD_SHELL);
  if (t <= 0.0) { discard; }
  let p = ro + rd * t;
  let n = normalize(p);
  let ll = fd_latLon(n);
  let g = fd_sample(ll);
  let w = g.b.xy;
  let speed = length(w);
  if (speed < 0.5) { discard; }
  let dir = w / speed;
  let px = degrees(fr_pxSize(p)) * F.viewport.z;
  let sp = max(px * 9.0, 0.05);
  let ts = sp * 7.0;
  let pos = vec2f(ll.y * cos(radians(ll.x)), ll.x);
  let s = fd_windTile(pos, vec2f(0.0), ts, sp, dir, speed, px) + fd_windTile(pos, vec2f(0.5 * ts), ts, sp, dir, speed, px);
  let a = clamp(s, 0.0, 1.0) * smoothstep(0.5, 5.0, speed) * Fd.op.z * fd_inside(ll) * fr_limbFade(n);
  if (a < 0.003) { discard; }
  let col = mix(vec3f(0.85, 0.93, 1.0), vec3f(1.0, 1.0, 0.9), smoothstep(8.0, 20.0, speed));
  var o: FO;
  o.color = vec4f(col * a, a);
  o.depth = fd_depth(p);
  return o;
}

// ── isobars ──
struct LV {
  @builtin(position) pos: vec4f,
  @location(0) d: f32,      // signed px from the line centre
  @location(1) hw: f32,     // half width (device px)
  @location(2) alpha: f32,
}

fn fd_px(c: vec4f) -> vec2f {
  return c.xy / max(c.w, 1e-4) * 0.5 * F.viewport.xy;
}

@vertex
fn vsLine(@location(0) cur: vec4f, @location(1) prev: vec4f, @location(2) next: vec4f) -> LV {
  let cC = fr_clip(cur.xyz);
  let sC = fd_px(cC);
  let sP = fd_px(fr_clip(prev.xyz));
  let sN = fd_px(fr_clip(next.xyz));
  var d0 = sC - sP;
  var d1 = sN - sC;
  if (dot(d0, d0) < 1e-8) { d0 = d1; }
  if (dot(d1, d1) < 1e-8) { d1 = d0; }
  d0 = d0 / max(length(d0), 1e-6);
  d1 = d1 / max(length(d1), 1e-6);
  var tg = d0 + d1;
  if (dot(tg, tg) < 1e-6) { tg = d0; }
  tg = normalize(tg + vec2f(1e-9, 0.0));
  let nrm = vec2f(-tg.y, tg.x);
  let miter = 1.0 / max(dot(nrm, vec2f(-d0.y, d0.x)), 0.5);
  let hw = 0.5 * prev.w * F.viewport.z;
  let ext = hw + 1.5 * F.viewport.z;
  let off = nrm * cur.w * ext * miter;
  var o: LV;
  o.pos = vec4f(cC.xy + off / (0.5 * F.viewport.xy) * cC.w, cC.z, cC.w);
  o.d = cur.w * ext * miter;
  o.hw = hw;
  o.alpha = next.w * Fd.op.w * fr_limbFade(normalize(cur.xyz));
  return o;
}

@fragment
fn fsLine(in: LV) -> @location(0) vec4f {
  let d = abs(in.d);
  let cr = clamp(in.hw + 0.5 - d, 0.0, 1.0);
  let halo = clamp(in.hw + 1.2 * F.viewport.z + 0.5 - d, 0.0, 1.0);
  let a = (cr * 0.92 + (halo - cr) * 0.28) * in.alpha;
  let c = vec3f(0.97, 0.98, 1.0) * cr * 0.92 * in.alpha;
  return vec4f(c, a);
}
