// ============================================================================
//  WEATHER MAP  ·  clouds.wgsl — the cloud map (compute) and the cloud deck
//  (draw). render/clouds.js prepends frame.wgsl (struct Frame, F, fr_*).
// ----------------------------------------------------------------------------
//  csCloud  one thread per cloud-map texel (CLOUD_MAP_BOUNDS, row 0 north).
//           Grid cover, Catmull-Rom in space and linear in time, sets where
//           cloud is; flowing noise sets its texture. Writes outMap:
//           r opacity, g precip 0..1, b cirrus opacity, a top height 0..1.
//  fsCloud  full-screen pass, ray-traced against the shell CL_SHELL. Detail
//           octaves from the map scale to the pixel footprint, top relief from map a, self-shadow
//           toward the sun, warm terminator light, grazing-view thickening.
//           Display-referred sRGB, premultiplied; writes frag_depth so the
//           globe's depth hides the far side.
//
//  The noise (cl_pcg, cl_vnoise, cl_fbm, cl_worley, cl_lowNoise,
//  cl_cirrusNoise) and the cover tables CL_LOW_Q / CL_HIGH_Q mirror
//  render/clouds.js; tests/sky.test.mjs checks that the tables agree.
//
//  grep -n targets: "struct Sky", "fn cl_sample", "fn cl_background", "fn cl_field",
//  "fn cl_lowNoise", "fn cl_cirrusNoise", "fn cl_threshold", "fn csCloud",
//  "fn vsCloud", "fn fsCloud", "const CL_LOW_Q"
// ============================================================================

struct Sky {
  mapB: vec4f,     // cloud map lat0, lat1, lon0, lon1 (deg)
  gridA: vec4f,    // grid lat0, dLat, lon0, dLon
  gridB: vec4f,    // nLat, nLon, point offset of slice k0, of slice k1
  timeA: vec4f,    // x slice mix u, y flow hours, z has grid, w opacity
  mapSize: vec4f,  // w, h, 1 / w, 1 / h
  look: vec4f,     // x detail gain, y camera alt (unused), z quality, w flow period (h)
}

struct GP { a: vec4f, b: vec4f }  // a: cloud, low, high, precip (mm / 3 h); b: u10, v10, t2m, snow

@group(1) @binding(0) var<uniform> S: Sky;
@group(1) @binding(1) var<storage, read> GR: array<GP>;
@group(1) @binding(2) var outMap: texture_storage_2d<rgba16float, write>;
@group(1) @binding(3) var cloudMap: texture_2d<f32>;
@group(1) @binding(4) var cloudSmp: sampler;

const CL_SHELL = 1.0018;
const CL_DEG_PER_H = 0.0324;  // degrees of latitude per hour at 1 m/s
const CL_LOW_Q = array<f32, 17>(0.91, 0.6865, 0.6439, 0.6124, 0.5859, 0.5621, 0.5396, 0.5188, 0.4985, 0.478, 0.4564, 0.434, 0.41, 0.3836, 0.3528, 0.3102, 0.05);
const CL_HIGH_Q = array<f32, 17>(0.89, 0.6451, 0.6132, 0.5895, 0.5691, 0.5505, 0.5334, 0.5168, 0.5002, 0.4839, 0.4673, 0.4499, 0.4311, 0.4106, 0.3865, 0.3529, 0.12);
const CL_LOW_SOFT = 0.035;
const CL_DETAIL_F0 = 220.0;  // detail start, cycles per radian (about 30 km)
// rotation between detail octaves (render/clouds.js DETAIL_ROT), so the
// value-noise lattice does not show as squares
const CL_DETAIL_ROT = mat3x3f(0.0, -0.8, -0.6, 0.8, 0.36, -0.48, 0.6, -0.48, 0.64);
const CL_HIGH_SOFT = 0.07;

// ── noise (mirrors render/clouds.js) ──
fn cl_pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn cl_hash3(c: vec3i) -> u32 {
  let x = u32(c.x) * 73856093u;
  let y = u32(c.y) * 19349663u;
  let z = u32(c.z) * 83492791u;
  return cl_pcg((x ^ y) ^ z);
}
fn cl_h01(h: u32) -> f32 { return f32(h >> 8u) / 16777216.0; }

fn cl_vnoise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let c = vec3i(i);
  let x00 = mix(cl_h01(cl_hash3(c)), cl_h01(cl_hash3(c + vec3i(1, 0, 0))), u.x);
  let x10 = mix(cl_h01(cl_hash3(c + vec3i(0, 1, 0))), cl_h01(cl_hash3(c + vec3i(1, 1, 0))), u.x);
  let x01 = mix(cl_h01(cl_hash3(c + vec3i(0, 0, 1))), cl_h01(cl_hash3(c + vec3i(1, 0, 1))), u.x);
  let x11 = mix(cl_h01(cl_hash3(c + vec3i(0, 1, 1))), cl_h01(cl_hash3(c + vec3i(1, 1, 1))), u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

fn cl_fbm(p0: vec3f, oct: i32) -> f32 {
  var p = p0;
  var s = 0.0;
  var a = 0.5;
  var n = 0.0;
  for (var i = 0; i < oct; i++) {
    s += a * cl_vnoise(p);
    n += a;
    p = p * 2.03 + vec3f(17.1, 31.7, 7.3);
    a *= 0.5;
  }
  return s / n;
}

fn cl_worley(p: vec3f) -> f32 {
  let c = vec3i(floor(p));
  var d = 9.0;
  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let cc = c + vec3i(dx, dy, dz);
        let h1 = cl_hash3(cc);
        let h2 = cl_pcg(h1);
        let h3 = cl_pcg(h2);
        let q = vec3f(cc) + vec3f(cl_h01(h1), cl_h01(h2), cl_h01(h3)) - p;
        d = min(d, dot(q, q));
      }
    }
  }
  return sqrt(d);
}

// domain-warped fBm (render/clouds.js lowNoise): a 3-octave warp field at
// half frequency moves the sample point by up to 0.8 noise cells
fn cl_lowNoise(q: vec3f) -> f32 {
  let p = q * 32.0;
  let h = p * 0.5;
  let w = vec3f(cl_fbm(h + vec3f(5.2, 1.3, 8.1), 3), cl_fbm(h + vec3f(9.7, 4.4, 2.6), 3), cl_fbm(h + vec3f(3.9, 7.1, 6.3), 3)) - 0.5;
  return cl_fbm(p + w * 1.6, 4);
}

// five taps along the wind w (weights 0.1 0.2 0.4 0.2 0.1, step 0.012)
fn cl_cirrusNoise(q: vec3f, w: vec3f) -> f32 {
  var s = 0.0;
  for (var k = -2; k <= 2; k++) {
    let wt = select(select(0.1, 0.2, abs(k) == 1), 0.4, k == 0);
    s += wt * cl_fbm((q + w * (f32(k) * 0.012)) * 30.0, 4);
  }
  return s;
}

fn cl_threshold(high: bool, cover: f32) -> f32 {
  var lowQ = CL_LOW_Q;
  var highQ = CL_HIGH_Q;
  let x = clamp(cover, 0.0, 1.0) * 16.0;
  let i = min(15, i32(floor(x)));
  let f = x - f32(i);
  if (high) { return mix(highQ[i], highQ[i + 1], f); }
  return mix(lowQ[i], lowQ[i + 1], f);
}

// ── grid ──
fn cl_gp(i: i32, j: i32, off: f32) -> GP {
  let nLat = i32(S.gridB.x);
  let nLon = i32(S.gridB.y);
  let ii = clamp(i, 0, nLat - 1);
  let jj = clamp(j, 0, nLon - 1);
  return GR[u32(off) + u32(ii * nLon + jj)];
}

fn cl_cr(t: f32) -> vec4f {
  return vec4f(
    t * ((2.0 - t) * t - 1.0) * 0.5,
    (t * t * (3.0 * t - 5.0) + 2.0) * 0.5,
    t * ((4.0 - 3.0 * t) * t + 1.0) * 0.5,
    (t - 1.0) * t * t * 0.5);
}

// The grid at (lat, lon): Catmull-Rom in space, linear between the slices.
fn cl_sample(lat: f32, lon: f32) -> GP {
  let fi = clamp((lat - S.gridA.x) / S.gridA.y, 0.0, S.gridB.x - 1.0);
  let fj = clamp((lon - S.gridA.z) / S.gridA.w, 0.0, S.gridB.y - 1.0);
  let i0 = i32(floor(fi));
  let j0 = i32(floor(fj));
  let wi = cl_cr(fi - f32(i0));
  let wj = cl_cr(fj - f32(j0));
  var a0 = vec4f(0.0);
  var b0 = vec4f(0.0);
  var a1 = vec4f(0.0);
  var b1 = vec4f(0.0);
  for (var di = 0; di < 4; di++) {
    for (var dj = 0; dj < 4; dj++) {
      let w = wi[di] * wj[dj];
      let p0 = cl_gp(i0 - 1 + di, j0 - 1 + dj, S.gridB.z);
      let p1 = cl_gp(i0 - 1 + di, j0 - 1 + dj, S.gridB.w);
      a0 += w * p0.a;
      b0 += w * p0.b;
      a1 += w * p1.a;
      b1 += w * p1.b;
    }
  }
  var g: GP;
  g.a = mix(a0, a1, S.timeA.x);
  g.b = mix(b0, b1, S.timeA.x);
  return g;
}

// Climatological cover and wind outside the grid: the storm track near
// 55 N, the ITCZ near 8 N, the clear subtropical belt near 27 N.
fn cl_background(lat: f32, q: vec3f) -> GP {
  let band = 0.34 + 0.3 * exp(-pow((lat - 55.0) / 10.0, 2.0)) + 0.35 * exp(-pow((lat - 8.0) / 5.0, 2.0)) - 0.14 * exp(-pow((lat - 27.0) / 7.0, 2.0));
  let n = cl_fbm(q * 5.0 + vec3f(3.1, 7.7, 1.9), 3);
  let c = clamp(band + (n - 0.5) * 1.1, 0.0, 1.0);
  var g: GP;
  g.a = vec4f(c, c * 0.6, c * 0.4, 0.0);
  let u = 9.0 * exp(-pow((lat - 45.0) / 12.0, 2.0)) - 6.0 * exp(-pow((lat - 14.0) / 8.0, 2.0));
  g.b = vec4f(u, 0.0, 15.0, 0.0);
  return g;
}

fn cl_field(lat: f32, lon: f32, q: vec3f) -> GP {
  let lat1 = S.gridA.x + (S.gridB.x - 1.0) * S.gridA.y;
  let lon1 = S.gridA.z + (S.gridB.y - 1.0) * S.gridA.w;
  let cl = max(cos(radians(lat)), 0.2);
  let dOut = max(max(S.gridA.x - lat, lat - lat1), max(S.gridA.z - lon, lon - lon1) * cl);
  let wIn = 1.0 - smoothstep(0.0, 5.0, dOut);
  let bg = cl_background(lat, q);
  if (wIn <= 0.0) { return bg; }
  let g = cl_sample(lat, lon);
  var o: GP;
  o.a = mix(bg.a, g.a, wIn);
  o.b = mix(bg.b, g.b, wIn);
  return o;
}

// globe-space east and north unit vectors at unit point p
fn cl_east(p: vec3f) -> vec3f {
  let e = vec3f(p.z, 0.0, -p.x);
  if (dot(e, e) < 1e-8) { return vec3f(0.0, 0.0, -1.0); }
  return normalize(e);
}

// the point the noise is sampled at: (lat, lon) moved back along the wind
fn cl_advect(lat: f32, lon: f32, wind: vec2f, hours: f32) -> vec3f {
  let d = wind * CL_DEG_PER_H * hours;
  return fr_dir(lat - d.y, lon - d.x / max(cos(radians(lat)), 0.2));
}

@compute @workgroup_size(8, 8)
fn csCloud(@builtin(global_invocation_id) gid: vec3u) {
  let size = vec2u(S.mapSize.xy);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  let uv = (vec2f(gid.xy) + 0.5) * S.mapSize.zw;
  let lon = mix(S.mapB.z, S.mapB.w, uv.x);
  let lat = mix(S.mapB.y, S.mapB.x, uv.y);
  let q = fr_dir(lat, lon);
  let g = cl_field(lat, lon, q);

  let total = clamp(g.a.x, 0.0, 1.0);
  let low = clamp(g.a.y, 0.0, 1.0);
  let high = clamp(g.a.z, 0.0, 1.0);
  let mid = clamp(1.0 - (1.0 - total) / max((1.0 - low) * (1.0 - high), 1e-3), 0.0, 1.0);
  let cLM = 1.0 - (1.0 - low) * (1.0 - mid);
  let pc = 1.0 - exp(-max(g.a.w, 0.0) / 2.5);
  let wind = g.b.xy;

  // two-phase flow (render/clouds.js flowPhases), variance-preserving blend
  let T = S.look.w;
  let f1 = fract(S.timeA.y / T);
  let f2 = fract(f1 + 0.5);
  let w1 = 1.0 - abs(2.0 * f1 - 1.0);
  let w2 = 1.0 - w1;
  let wn = 1.0 / max(sqrt(w1 * w1 + w2 * w2), 1e-3);
  let steer = wind * 2.0;
  let qa = cl_advect(lat, lon, steer, f1 * T);
  let qb = cl_advect(lat, lon, steer, f2 * T) + vec3f(0.031, 0.017, 0.023);
  let nL = 0.5 + (w1 * (cl_lowNoise(qa) - 0.5) + w2 * (cl_lowNoise(qb) - 0.5)) * wn;

  // cirrus streaks along the upper wind (faster than the 10 m wind)
  let e = cl_east(q);
  let nrt = cross(q, e);
  var wd = e * wind.x + nrt * wind.y;
  wd = select(e, normalize(wd), dot(wd, wd) > 0.04);
  let ha = cl_advect(lat, lon, steer * 1.8, f1 * T);
  let hb = cl_advect(lat, lon, steer * 1.8, f2 * T) + vec3f(0.013, 0.029, 0.007);
  let nH = 0.5 + (w1 * (cl_cirrusNoise(ha, wd) - 0.5) + w2 * (cl_cirrusNoise(hb, wd) - 0.5)) * wn;

  // low and middle deck: cover-calibrated threshold, thicker inside
  let thrL = cl_threshold(false, cLM);
  let dL = smoothstep(thrL - CL_LOW_SOFT, thrL + CL_LOW_SOFT, nL);
  let midShare = mid / max(cLM, 1e-3);
  // interior thickness against a capped-cover threshold: the table is steep
  // near full cover, and the true threshold would draw ridges there
  let thrT = cl_threshold(false, min(cLM, 0.85));
  let tauL = dL * mix(0.42, 0.95, smoothstep(thrT, thrT + 0.2, nL)) * (0.8 + 0.2 * midShare);
  // cirrus: soft, thin
  let thrH = cl_threshold(true, high);
  let dH = smoothstep(thrH - CL_HIGH_SOFT, thrH + CL_HIGH_SOFT, nH);
  let tauH = dH * mix(0.22, 0.5, smoothstep(thrH, thrH + 0.25, nH));
  // rain: towering cells with bright, thick tops
  let cells = smoothstep(0.35, 0.8, (1.0 - min(cl_worley(qa * 45.0), 1.0)) * pc * 1.7);
  let tauC = max(cells, pc * 0.55 * dL);

  // fade at the map edge so the deck never ends in a hard line
  let ed = min(min(uv.x, 1.0 - uv.x) * (S.mapB.w - S.mapB.z), min(uv.y, 1.0 - uv.y) * (S.mapB.y - S.mapB.x));
  let edge = smoothstep(0.0, 4.0, ed) * S.timeA.z;
  let op = (1.0 - (1.0 - tauL) * (1.0 - tauH) * (1.0 - tauC)) * edge;
  let hL = 0.3 + 0.3 * midShare + 0.25 * clamp(nL - thrT, 0.0, 0.4);
  let top = (tauL * hL + tauH * 0.95 + tauC * 1.0) / max(tauL + tauH + tauC, 1e-3);
  textureStore(outMap, vec2i(gid.xy), vec4f(op, pc * edge, tauH * edge, top));
}

// ── draw ──
struct CV { @builtin(position) pos: vec4f }

@vertex
fn vsCloud(@builtin(vertex_index) i: u32) -> CV {
  var o: CV;
  let x = f32((i << 1u) & 2u);
  let y = f32(i & 2u);
  o.pos = vec4f(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
  return o;
}

fn cl_ray(px: vec2f) -> vec3f {
  let ndc = vec2f(px.x / F.viewport.x * 2.0 - 1.0, 1.0 - px.y / F.viewport.y * 2.0);
  let f = F.invViewProj * vec4f(ndc, 1.0, 1.0);
  return normalize(f.xyz / f.w - F.eye.xyz);
}

// near hit of a ray with the sphere of radius r, or -1
fn cl_hit(ro: vec3f, rd: vec3f, r: f32) -> f32 {
  let b = dot(ro, rd);
  let c = dot(ro, ro) - r * r;
  let h = b * b - c;
  // branch-free, so callers stay in uniform control flow
  let t = -b - sqrt(max(h, 0.0));
  return select(-1.0, t, h >= 0.0 && t > 0.0);
}

fn cl_mapUV(n: vec3f) -> vec2f {
  let lon = degrees(atan2(-n.z, n.x));
  let lat = degrees(asin(clamp(n.y, -1.0, 1.0)));
  return vec2f((lon - S.mapB.z) / (S.mapB.w - S.mapB.z), (S.mapB.y - lat) / (S.mapB.y - S.mapB.x));
}

fn cl_map(uv: vec2f) -> vec4f { return textureSampleLevel(cloudMap, cloudSmp, uv, 0.0); }

struct CO {
  @location(0) color: vec4f,
  @builtin(frag_depth) depth: f32,
}

@fragment
fn fsCloud(in: CV) -> CO {
  let ro = F.eye.xyz;
  let rd = cl_ray(in.pos.xy);
  let t = cl_hit(ro, rd, CL_SHELL);
  if (t <= 0.0) { discard; }
  let p = ro + rd * t;
  let n = normalize(p);
  let uv = cl_mapUV(n);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { discard; }
  let m = cl_map(uv);
  var op = m.r;
  if (op < 0.004) { discard; }

  // detail from the map scale down to the pixel footprint (render/clouds.js
  // detailErode): a crisp fractal edge, an opaque body, texture on the tops
  let mv0 = max(dot(n, -rd), 0.02);
  let foot = t * length(cl_ray(in.pos.xy + vec2f(1.0, 0.0)) - rd) / max(sqrt(mv0), 0.3);
  let maxOct = select(4.0, 7.0, S.look.z > 1.5);
  let oc = clamp(log2(0.5 / max(foot, 1e-9) / CL_DETAIL_F0), 0.0, maxOct);
  let cirrus0 = clamp(m.b / max(m.r, 1e-3), 0.0, 1.0);
  var bump = 0.0;
  var shade = 1.0;
  if (oc > 0.0) {
    var pd = n * CL_DETAIL_F0 + vec3f(S.timeA.y * 0.3, 0.0, S.timeA.y * 0.2);
    var amp = 0.5;
    var s = 0.0;
    var b = 0.0;
    var nr = 0.0;
    let nOct = i32(ceil(oc));
    for (var i = 0; i < nOct; i++) {
      let w = amp * min(1.0, oc - f32(i));
      let v = cl_vnoise(pd);
      s += w * v;
      b += w * (1.0 - abs(2.0 * v - 1.0));
      nr += w;
      pd = (CL_DETAIL_ROT * pd) * 2.03;
      amp *= 0.55;
    }
    let d = (0.6 * s + 0.4 * b) / nr;
    let k = min(1.0, oc / 2.5) * min(S.look.x, 1.0);
    let dc = clamp((d - 0.5) * 3.2, -1.0, 1.0);
    let edge = pow(1.0 - min(op, 1.0), 0.8);
    let x = op + dc * 0.85 * k * (1.0 - 0.5 * cirrus0) * edge;
    let wd = mix(mix(0.1, 0.02, k), 0.15, cirrus0);
    let c0 = mix(mix(0.1, 0.45, k), 0.1, cirrus0);
    let cov = smoothstep(c0 - wd, c0 + wd, x);
    let body = x + (smoothstep(0.35, 0.75, x) - x) * 0.85 * k * (1.0 - cirrus0);
    shade = 1.0 + dc * 0.12 * k * min(op * 1.5, 1.0);
    op = cov * clamp(body, 0.0, 1.0);
    bump = dc * 0.5 * k;
  }
  if (op < 0.004) { discard; }

  // top relief: the height map a, steeper where the deck thins out
  let ex = vec2f(S.mapSize.z, 0.0);
  let ey = vec2f(0.0, S.mapSize.w);
  let mE = cl_map(uv + ex);
  let mW = cl_map(uv - ex);
  let mN = cl_map(uv - ey);
  let mS = cl_map(uv + ey);
  let hE = mE.a * smoothstep(0.0, 0.5, mE.r);
  let hW = mW.a * smoothstep(0.0, 0.5, mW.r);
  let hN = mN.a * smoothstep(0.0, 0.5, mN.r);
  let hS = mS.a * smoothstep(0.0, 0.5, mS.r);
  let e = cl_east(n);
  let nrt = cross(n, e);
  let relief = 1.6;
  let nb = normalize(n - e * ((hE - hW) * relief + bump * 0.35) - nrt * ((hN - hS) * relief + bump * 0.2));

  // self-shadow: higher, thick cloud toward the sun darkens this point
  let L = F.sunDir.xyz;
  let mu = dot(n, L);
  let Lt = L - n * mu;
  let lt = vec2f(dot(Lt, e), dot(Lt, nrt));
  var shadow = 0.0;
  if (dot(lt, lt) > 1e-6) {
    let dir = normalize(lt);
    let reach = clamp(0.35 / max(mu, 0.12), 0.4, 3.0);
    let degU = vec2f(1.0 / (S.mapB.w - S.mapB.z) / max(sqrt(max(1.0 - n.y * n.y, 0.0)), 0.2), -1.0 / (S.mapB.y - S.mapB.x));
    let hHere = m.a;
    for (var k = 1; k <= 3; k++) {
      let s = f32(k) * f32(k) * 0.25 * reach;
      let mk = cl_map(uv + dir * degU * s);
      let rise = mk.a - hHere - f32(k) * 0.08;
      shadow += max(rise, 0.0) * mk.r * 1.4;
    }
  }
  let sh = exp(-shadow * 2.2);

  // light: white sun high up, warm at the terminator; sky fill
  let day = fr_daylight(n);
  let sunCol = mix(vec3f(1.0, 0.5, 0.26), vec3f(1.0, 0.97, 0.93), smoothstep(-0.02, 0.32, mu));
  let diff = clamp((dot(nb, L) + 0.35) / 1.35, 0.0, 1.0);
  let lit = sunCol * diff * sh * day * 1.05 + vec3f(0.16, 0.19, 0.25) * (0.25 + 0.75 * day) + vec3f(0.012, 0.016, 0.03);

  // albedo: grey thin stratus, white thick tops, blue-white cirrus
  let cirrus = clamp(m.b / max(m.r, 1e-3), 0.0, 1.0);
  var alb = mix(vec3f(0.74, 0.76, 0.8), vec3f(0.97, 0.97, 0.98), smoothstep(0.2, 0.9, op));
  alb = mix(alb, vec3f(0.86, 0.9, 0.98), cirrus * 0.7);
  var c = alb * lit * shade;

  // a slant view looks through more cloud: thicker, then hazier at the limb
  let mv = max(dot(n, -rd), 0.02);
  let a = 1.0 - pow(1.0 - min(op, 0.999), 1.0 / (0.3 + 0.7 * mv));
  c = 1.0 - exp(-c * 1.6 * F.misc.x);
  c = mix(c, vec3f(0.66, 0.77, 0.93) * (0.3 + 0.7 * day), pow(1.0 - mv, 4.0) * 0.35);
  let alpha = clamp(a * S.timeA.w, 0.0, 1.0);

  var o: CO;
  o.color = vec4f(fr_toSRGB(c) * alpha, alpha);
  let cp = F.viewProj * vec4f(p, 1.0);
  o.depth = clamp(cp.z / cp.w, 0.0, 1.0);
  return o;
}
