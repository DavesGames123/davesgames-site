// ============================================================================
//  STORM GLOBE  ·  shaders/solver.wgsl  ·  incompressible flow on the sphere
// ----------------------------------------------------------------------------
//  Grid: regular latitude-longitude, NX x NY cells, staggered (Arakawa C).
//    cell (i, j) centre   lon (i + 1/2) dl, lat -90 + (j + 1/2) dp
//    S[c].x  u            east face   lon (i + 1) dl
//    S[c].y  v            north face  lat -90 + (j + 1) dp  (row NY-1 = pole, 0)
//    S[c].z  dye          centre
//    S[c].w  p            centre, the projection potential (m2/s)
//  c = j * NX + i. Rows go south to north.
//
//    Z[c].x  absolute vorticity (zeta + f) at the corner (i, j):
//            lon (i + 1) dl, lat -90 + (j + 1) dp; Z[c].y its advected value;
//            Z[c].zw the target wind at the u and v faces
//
//  One step (solver.js "function encodeStep"):
//    vort       Z.x = curl u + f at the corners
//    reduce1/2 (slot 0)  dye mass before
//    advect     semi-Lagrangian, S -> S2 and Z.x -> Z.y. Trajectories are
//               great circles in 3D (midpoint rule), so the poles need no
//               special case. Values come from Catmull-Rom samples at the
//               departure point. A vector is carried from the departure
//               point to the arrival point by parallel transport, so the
//               metric terms come out of the geometry. Absolute vorticity
//               is a scalar of the motion: Z.y = (zeta + f)(departure) - f(here).
//               That is the Coriolis force in its exact form (beta drift).
//    reduce1/2 (slot 1)  dye mass after
//    goalpass   Z.zw = target wind (GFS frames + storm vortices)
//    forces     Coriolis on the velocity as a body force (u += f dt v),
//               nudging of Z.y toward the curl of the target wind, dye mass
//               fixer; in S2; commit S2 -> S
//    polar filter  rows of (u + i v) to Fourier space, wavenumbers above
//               m_c = NX/2 cos(lat) / cos(lat_c) damped, back
//    projection div -> C, FFT rows, solve (one tridiagonal per zonal
//               wavenumber), inverse FFT, pstore, project: u -= grad p.
//               The solve is direct: after it the discrete divergence is
//               zero to float rounding, so mass is conserved cell by cell.
//    vorticity correction (after IVOCK, Zhang et al. 2015)
//               zeta_rhs = Z.y - curl u, solve_psi (corner Poisson, psi = 0
//               at the poles), u += curl psi. The correction is
//               divergence-free by construction. Without it, splitting
//               advection and projection loses V (1 - cos(V dt / r)) of a
//               vortex each step: a test vortex kept 29 % of its peak
//               vorticity after 72 h, and 4 test vortex runs scaled with dt.
//
//  grep -n targets
//    params ............ "struct Params"
//    sampling .......... "fn sampleU", "fn sampleV", "fn velocity3"
//    target wind ....... "fn goal"
//    advection ......... "fn advect"
//    Coriolis, nudge ... "fn forces"
//    FFT ............... "fn fft_rows"
//    tridiagonal ....... "fn solve"
//    vorticity ......... "fn vort", "fn zeta_rhs", "fn solve_psi", "fn psi_apply"
//    diagnostics ....... "fn diag"
// ============================================================================

const PI: f32 = 3.14159265358979;
const MAXSTORM: u32 = 32u;

struct Params {
  nx: u32, ny: u32, log2nx: u32, fnx: u32,
  fny: u32, nstorm: u32, massFix: u32, filterOn: u32,
  dt: f32, R: f32, omega: f32, tauBg: f32,
  tauStorm: f32, fmix: f32, nudge: f32, coriolis: f32,
  cosFilter: f32, dyeRelax: f32, pad0: f32, pad1: f32,
};
// a: lat, lon (rad), vmax (m/s), hemisphere sign
// b: rmax, rout (rad), alpha, pc (hPa)
// c: motion east, north (m/s), penv (hPa), weight 0..1
struct Storm { a: vec4f, b: vec4f, c: vec4f, };
struct Op { kind: u32, slot: u32, dir: f32, pad: f32, };

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> S: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> S2: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> C: array<vec2f>;
@group(0) @binding(4) var<storage, read> F: array<f32>;
@group(0) @binding(5) var<uniform> ST: array<Storm, 32>;
@group(0) @binding(6) var<storage, read_write> SUM: array<f32>;
@group(0) @binding(7) var<storage, read_write> SCR: array<vec4f>;
@group(0) @binding(8) var DIAG: texture_storage_2d<rgba16float, write>;
@group(0) @binding(9) var<storage, read_write> Z: array<vec4f>;
@group(1) @binding(0) var<uniform> OP: Op;

fn dl() -> f32 { return 2.0 * PI / f32(P.nx); }
fn dp() -> f32 { return PI / f32(P.ny); }
fn latC(j: i32) -> f32 { return -0.5 * PI + (f32(j) + 0.5) * dp(); }
fn latF(j: i32) -> f32 { return -0.5 * PI + (f32(j) + 1.0) * dp(); }
// cos at the north face of row j: zero at the poles
fn cosF(j: i32) -> f32 {
  if (j < 0 || j >= i32(P.ny) - 1) { return 0.0; }
  return cos(latF(j));
}
fn wrapI(i: i32) -> u32 { let n = i32(P.nx); return u32(((i % n) + n) % n); }
fn idx(i: i32, j: i32) -> u32 { return u32(j) * P.nx + wrapI(i); }

fn unitOf(lat: f32, lon: f32) -> vec3f { return vec3f(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat)); }
fn eastOf(lon: f32) -> vec3f { return vec3f(-sin(lon), cos(lon), 0.0); }
fn northOf(lat: f32, lon: f32) -> vec3f { return vec3f(-sin(lat) * cos(lon), -sin(lat) * sin(lon), cos(lat)); }
fn latOf(p: vec3f) -> f32 { return asin(clamp(p.z, -1.0, 1.0)); }
fn lonOf(p: vec3f) -> f32 {
  let l = atan2(p.y, p.x);
  return select(l, l + 2.0 * PI, l < 0.0);
}

// ── grid reads across the poles ─────────────────────────────────────────
// A row past a pole is the row on the far side (longitude + 180 deg).
// East and north both turn round there, so u and v change sign.
fn fetchU(i: i32, j: i32) -> f32 {
  let ny = i32(P.ny); let h = i32(P.nx / 2u);
  if (j < 0) { return -S[idx(i + h, -1 - j)].x; }
  if (j >= ny) { return -S[idx(i + h, 2 * ny - 1 - j)].x; }
  return S[idx(i, j)].x;
}
fn fetchV(i: i32, j: i32) -> f32 {
  let ny = i32(P.ny); let h = i32(P.nx / 2u);
  if (j == -1) { return 0.5 * (S[idx(i, 0)].y - S[idx(i + h, 0)].y); }
  if (j == ny - 1) { return 0.5 * (S[idx(i, ny - 2)].y - S[idx(i + h, ny - 2)].y); }
  if (j < -1) { return -S[idx(i + h, -2 - j)].y; }
  if (j > ny - 1) { return -S[idx(i + h, 2 * (ny - 1) - j)].y; }
  return S[idx(i, j)].y;
}
fn fetchD(i: i32, j: i32) -> f32 {
  let ny = i32(P.ny); let h = i32(P.nx / 2u);
  if (j < 0) { return S[idx(i + h, -1 - j)].z; }
  if (j >= ny) { return S[idx(i + h, 2 * ny - 1 - j)].z; }
  return S[idx(i, j)].z;
}
fn bilin(a: f32, b: f32, c: f32, d: f32, t: vec2f) -> f32 {
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}
fn sampleU(lat: f32, lon: f32) -> f32 {
  let fi = lon / dl() - 1.0; let fj = (lat + 0.5 * PI) / dp() - 0.5;
  let i0 = i32(floor(fi)); let j0 = i32(floor(fj)); let t = vec2f(fi - floor(fi), fj - floor(fj));
  return bilin(fetchU(i0, j0), fetchU(i0 + 1, j0), fetchU(i0, j0 + 1), fetchU(i0 + 1, j0 + 1), t);
}
fn sampleV(lat: f32, lon: f32) -> f32 {
  let fi = lon / dl() - 0.5; let fj = (lat + 0.5 * PI) / dp() - 1.0;
  let i0 = i32(floor(fi)); let j0 = i32(floor(fj)); let t = vec2f(fi - floor(fi), fj - floor(fj));
  return bilin(fetchV(i0, j0), fetchV(i0 + 1, j0), fetchV(i0, j0 + 1), fetchV(i0 + 1, j0 + 1), t);
}
fn sampleD(lat: f32, lon: f32) -> f32 {
  let fi = lon / dl() - 0.5; let fj = (lat + 0.5 * PI) / dp() - 0.5;
  let i0 = i32(floor(fi)); let j0 = i32(floor(fj)); let t = vec2f(fi - floor(fi), fj - floor(fj));
  return bilin(fetchD(i0, j0), fetchD(i0 + 1, j0), fetchD(i0, j0 + 1), fetchD(i0 + 1, j0 + 1), t);
}
// Catmull-Rom (4 x 4) samples, for the values carried by advection: much
// less smoothing than bilinear for a vortex a few cells wide.
fn cr(a: f32, b: f32, c: f32, d: f32, t: f32) -> f32 {
  let t2 = t * t; let t3 = t2 * t;
  return 0.5 * (2.0 * b + (c - a) * t + (2.0 * a - 5.0 * b + 4.0 * c - d) * t2 + (3.0 * b - a - 3.0 * c + d) * t3);
}
fn cubicU(lat: f32, lon: f32) -> f32 {
  let fi = lon / dl() - 1.0; let fj = (lat + 0.5 * PI) / dp() - 0.5;
  let i0 = i32(floor(fi)); let j0 = i32(floor(fj)); let tx = fi - floor(fi); let ty = fj - floor(fj);
  var r: array<f32, 4>;
  for (var k = 0; k < 4; k++) {
    let jj = j0 - 1 + k;
    r[k] = cr(fetchU(i0 - 1, jj), fetchU(i0, jj), fetchU(i0 + 1, jj), fetchU(i0 + 2, jj), tx);
  }
  return cr(r[0], r[1], r[2], r[3], ty);
}
fn cubicV(lat: f32, lon: f32) -> f32 {
  let fi = lon / dl() - 0.5; let fj = (lat + 0.5 * PI) / dp() - 1.0;
  let i0 = i32(floor(fi)); let j0 = i32(floor(fj)); let tx = fi - floor(fi); let ty = fj - floor(fj);
  var r: array<f32, 4>;
  for (var k = 0; k < 4; k++) {
    let jj = j0 - 1 + k;
    r[k] = cr(fetchV(i0 - 1, jj), fetchV(i0, jj), fetchV(i0 + 1, jj), fetchV(i0 + 2, jj), tx);
  }
  return cr(r[0], r[1], r[2], r[3], ty);
}
// dye: cubic, clamped to the four nearest values (no new extremes)
fn cubicD(lat: f32, lon: f32) -> f32 {
  let fi = lon / dl() - 0.5; let fj = (lat + 0.5 * PI) / dp() - 0.5;
  let i0 = i32(floor(fi)); let j0 = i32(floor(fj)); let tx = fi - floor(fi); let ty = fj - floor(fj);
  var r: array<f32, 4>;
  for (var k = 0; k < 4; k++) {
    let jj = j0 - 1 + k;
    r[k] = cr(fetchD(i0 - 1, jj), fetchD(i0, jj), fetchD(i0 + 1, jj), fetchD(i0 + 2, jj), tx);
  }
  let a = fetchD(i0, j0); let b = fetchD(i0 + 1, j0); let c = fetchD(i0, j0 + 1); let d = fetchD(i0 + 1, j0 + 1);
  return clamp(cr(r[0], r[1], r[2], r[3], ty), min(min(a, b), min(c, d)), max(max(a, b), max(c, d)));
}
fn velocity3c(p: vec3f) -> vec3f {
  let lat = latOf(p); let lon = lonOf(p);
  return cubicU(lat, lon) * eastOf(lon) + cubicV(lat, lon) * northOf(lat, lon);
}
// corner scalar Z.x; past a pole, the row on the far side; the pole row
// itself is the mean of the two nearest corners across it
fn fetchZ(i: i32, k: i32) -> f32 {
  let ny = i32(P.ny); let h = i32(P.nx / 2u);
  if (k == -1) { return 0.5 * (Z[idx(i, 0)].x + Z[idx(i + h, 0)].x); }
  if (k == ny - 1) { return 0.5 * (Z[idx(i, ny - 2)].x + Z[idx(i + h, ny - 2)].x); }
  if (k < -1) { return Z[idx(i + h, -2 - k)].x; }
  if (k > ny - 1) { return Z[idx(i + h, 2 * (ny - 1) - k)].x; }
  return Z[idx(i, k)].x;
}
fn cubicZ(lat: f32, lon: f32) -> f32 {
  let fi = lon / dl() - 1.0; let fj = (lat + 0.5 * PI) / dp() - 1.0;
  let i0 = i32(floor(fi)); let j0 = i32(floor(fj)); let tx = fi - floor(fi); let ty = fj - floor(fj);
  var r: array<f32, 4>;
  for (var k = 0; k < 4; k++) {
    let jj = j0 - 1 + k;
    r[k] = cr(fetchZ(i0 - 1, jj), fetchZ(i0, jj), fetchZ(i0 + 1, jj), fetchZ(i0 + 2, jj), tx);
  }
  let a = fetchZ(i0, j0); let b = fetchZ(i0 + 1, j0); let c = fetchZ(i0, j0 + 1); let d = fetchZ(i0 + 1, j0 + 1);
  return clamp(cr(r[0], r[1], r[2], r[3], ty), min(min(a, b), min(c, d)), max(max(a, b), max(c, d)));
}
fn coriolisF(lat: f32) -> f32 { return 2.0 * P.omega * sin(lat) * P.coriolis; }
// relative vorticity of S at the corner (i, j), j < NY - 1
fn curlS(i: i32, j: i32) -> f32 {
  let jn = j + 1;
  let dvdl = (S[idx(i + 1, j)].y - S[idx(i, j)].y) / dl();
  let ducos = (S[idx(i, jn)].x * cos(latC(jn)) - S[idx(i, j)].x * cos(latC(j))) / dp();
  return (dvdl - ducos) / (P.R * cosF(j));
}
// the wind at a point, as a 3D tangent vector (m/s)
fn velocity3(p: vec3f) -> vec3f {
  let lat = latOf(p); let lon = lonOf(p);
  return sampleU(lat, lon) * eastOf(lon) + sampleV(lat, lon) * northOf(lat, lon);
}
// the point that reaches x after time dt, moving with velocity w (great circle)
fn back(x: vec3f, w: vec3f, dt: f32) -> vec3f {
  let s = length(w);
  if (s < 1e-6) { return x; }
  let th = s * dt / P.R;
  return normalize(x * cos(th) - (w / s) * sin(th));
}
// midpoint rule: velocity at x, a half step back, the velocity there
fn departure(x: vec3f, dt: f32) -> vec3f {
  let w0 = velocity3(x);
  let xm = back(x, w0, 0.5 * dt);
  var wm = velocity3(xm);
  wm = wm - dot(wm, x) * x;
  return back(x, wm, dt);
}
// carry the vector v from the tangent plane at d to the one at x
fn transport(v: vec3f, d: vec3f, x: vec3f) -> vec3f {
  let k = cross(d, x); let s = length(k);
  if (s < 1e-7) { return v; }
  let a = k / s; let c = clamp(dot(d, x), -1.0, 1.0);
  return v * c + cross(a, v) * s + a * dot(a, v) * (1.0 - c);
}

// ── the target wind: GFS frames, blended in time, plus storm vortices ──
fn frameAt(k: u32, f: u32, lat: f32, lon: f32) -> f32 {
  let n = P.fnx * P.fny;
  let fx = lon / (2.0 * PI) * f32(P.fnx);
  let fy = clamp((lat + 0.5 * PI) / PI * f32(P.fny - 1u), 0.0, f32(P.fny - 1u) - 0.001);
  let i0 = u32(floor(fx)) % P.fnx; let i1 = (i0 + 1u) % P.fnx; let j0 = u32(floor(fy));
  let t = vec2f(fx - floor(fx), fy - floor(fy));
  let o = (k * 3u + f) * n;
  return bilin(F[o + j0 * P.fnx + i0], F[o + j0 * P.fnx + i1], F[o + (j0 + 1u) * P.fnx + i0], F[o + (j0 + 1u) * P.fnx + i1], t);
}
fn bgAt(f: u32, lat: f32, lon: f32) -> f32 {
  return mix(frameAt(0u, f, lat, lon), frameAt(1u, f, lat, lon), P.fmix);
}
// returns (u, v, p hPa, storm weight)
fn goal(lat: f32, lon: f32) -> vec4f {
  var u = bgAt(0u, lat, lon); var v = bgAt(1u, lat, lon); var p = bgAt(2u, lat, lon);
  var wmax = 0.0;
  let x = unitOf(lat, lon);
  for (var k = 0u; k < P.nstorm; k++) {
    let s = ST[k];
    let c = unitOf(s.a.x, s.a.y);
    let r = acos(clamp(dot(c, x), -1.0, 1.0));
    let rout = s.b.y;
    if (r > 1.6 * rout) { continue; }
    let rm = s.b.x;
    let q = max(r, 1e-6) / rm;
    var vt = s.a.z * select(pow(1.0 / q, s.b.z), q, q < 1.0);
    vt = vt * (1.0 - smoothstep(0.7 * rout, 1.6 * rout, r));
    let tdir = cross(c, x);
    let tl = length(tdir);
    var w3 = vec3f(0.0);
    if (tl > 1e-7) { w3 = (tdir / tl) * vt * s.a.w; }
    let e = eastOf(lon); let nn = northOf(lat, lon);
    let wgt = exp(-(r / rout) * (r / rout)) * s.c.w;
    let vu = dot(w3, e) + s.c.x; let vv = dot(w3, nn) + s.c.y;
    u = mix(u, vu, wgt); v = mix(v, vv, wgt);
    let pr = s.b.w + (s.c.z - s.b.w) * exp(-rm / max(r, 1e-6));
    p = mix(p, min(p, pr), clamp(wgt * 1.5, 0.0, 1.0));
    wmax = max(wmax, wgt);
  }
  return vec4f(u, v, p, wmax);
}
fn dye0(lat: f32, lon: f32) -> f32 {
  let a = sin(lon * 12.0) * sin(lat * 12.0);
  return smoothstep(-0.25, 0.25, a);
}

// ── init: velocity = target, dye = pattern, p = 0 ───────────────────────
@compute @workgroup_size(64)
fn init(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x; if (c >= P.nx * P.ny) { return; }
  let i = i32(c % P.nx); let j = i32(c / P.nx);
  let lon = (f32(i) + 0.5) * dl();
  let tu = goal(latC(j), lon + 0.5 * dl());
  var v = 0.0;
  if (j < i32(P.ny) - 1) { v = goal(latF(j), lon).y; }
  S[c] = vec4f(tu.x, v, dye0(latC(j), lon), 0.0);
}

// ── advection ───────────────────────────────────────────────────────────
@compute @workgroup_size(64)
fn advect(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x; if (c >= P.nx * P.ny) { return; }
  let i = i32(c % P.nx); let j = i32(c / P.nx);
  let dt = P.dt;
  // u at the east face
  let lonU = (f32(i) + 1.0) * dl(); let latU = latC(j);
  let xu = unitOf(latU, lonU);
  let du = departure(xu, dt);
  let wu = transport(velocity3c(du), du, xu);
  let un = dot(wu, eastOf(lonU));
  // v at the north face
  var vn = 0.0;
  if (j < i32(P.ny) - 1) {
    let lonV = (f32(i) + 0.5) * dl(); let latV = latF(j);
    let xv = unitOf(latV, lonV);
    let dv = departure(xv, dt);
    let wv = transport(velocity3c(dv), dv, xv);
    vn = dot(wv, northOf(latV, lonV));
  }
  // dye at the centre
  let lonC = (f32(i) + 0.5) * dl(); let latc = latC(j);
  let xc = unitOf(latc, lonC);
  let dc = departure(xc, dt);
  let dn = cubicD(latOf(dc), lonOf(dc));
  S2[c] = vec4f(un, vn, dn, S[c].w);
  // absolute vorticity at the corner
  if (j < i32(P.ny) - 1) {
    let lonK = (f32(i) + 1.0) * dl(); let latK = latF(j);
    let xk = unitOf(latK, lonK);
    let dk = departure(xk, dt);
    Z[c].y = cubicZ(latOf(dk), lonOf(dk)) - coriolisF(latK);
  } else { Z[c].y = 0.0; }
}

// ── corner vorticity, target wind ───────────────────────────────────────
@compute @workgroup_size(64)
fn vort(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x; if (c >= P.nx * P.ny) { return; }
  let i = i32(c % P.nx); let j = i32(c / P.nx);
  if (j < i32(P.ny) - 1) { Z[c].x = curlS(i, j) + coriolisF(latF(j)); } else { Z[c].x = 0.0; }
}
@compute @workgroup_size(64)
fn goalpass(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x; if (c >= P.nx * P.ny) { return; }
  let i = i32(c % P.nx); let j = i32(c / P.nx);
  let tu = goal(latC(j), (f32(i) + 1.0) * dl());
  var tv = vec4f(0.0);
  if (j < i32(P.ny) - 1) { tv = goal(latF(j), (f32(i) + 0.5) * dl()); }
  Z[c].z = tu.x; Z[c].w = tv.y;
  SCR[c].w = max(tu.w, tv.w);
}

// ── dye mass: sum of dye * cos(lat) ─────────────────────────────────────
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn reduce1(@builtin(global_invocation_id) g: vec3u, @builtin(local_invocation_id) l: vec3u, @builtin(workgroup_id) w: vec3u) {
  let c = g.x;
  var s = 0.0;
  if (c < P.nx * P.ny) {
    let j = i32(c / P.nx);
    let d = select(S[c].z, S2[c].z, OP.slot == 1u);
    s = d * cos(latC(j));
  }
  red[l.x] = s;
  workgroupBarrier();
  for (var h = 128u; h > 0u; h = h / 2u) {
    if (l.x < h) { red[l.x] = red[l.x] + red[l.x + h]; }
    workgroupBarrier();
  }
  if (l.x == 0u) { SUM[8u + w.x] = red[0]; }
}
@compute @workgroup_size(256)
fn reduce2(@builtin(local_invocation_id) l: vec3u) {
  let n = (P.nx * P.ny + 255u) / 256u;
  var s = 0.0;
  for (var k = l.x; k < n; k += 256u) { s += SUM[8u + k]; }
  red[l.x] = s;
  workgroupBarrier();
  for (var h = 128u; h > 0u; h = h / 2u) {
    if (l.x < h) { red[l.x] = red[l.x] + red[l.x + h]; }
    workgroupBarrier();
  }
  if (l.x == 0u) { SUM[OP.slot] = red[0]; }
}

// ── Coriolis, nudging, dye fix: S2 in place, then commit S2 -> S ────────
// The Coriolis partner (v at a u face, u at a v face) comes from S, the
// divergence-free state before advection. Taken from S2 instead, it would
// turn the curvature term of the advection step into a spurious zonal
// acceleration (a first-order splitting error; TC2 lost 8.6 % in 5 days).
fn sv(i: i32, j: i32) -> f32 {
  if (j < 0 || j >= i32(P.ny) - 1) { return 0.0; }
  return S[idx(i, j)].y;
}
fn su(i: i32, j: i32) -> f32 {
  let jj = clamp(j, 0, i32(P.ny) - 1);
  return S[idx(i, jj)].x;
}
@compute @workgroup_size(64)
fn forces(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x; if (c >= P.nx * P.ny) { return; }
  let i = i32(c % P.nx); let j = i32(c / P.nx);
  let dt = P.dt;
  // u face
  var u = S2[c].x;
  let vbar = 0.25 * (sv(i, j) + sv(i + 1, j) + sv(i, j - 1) + sv(i + 1, j - 1));
  let latU = latC(j); let lonU = (f32(i) + 1.0) * dl();
  let thU = 2.0 * P.omega * sin(latU) * dt * P.coriolis;
  u = u + vbar * thU;
  // v face
  var v = 0.0;
  let top = j >= i32(P.ny) - 1;
  if (!top) {
    v = S2[c].y;
    let ubar = 0.25 * (su(i, j) + su(i - 1, j) + su(i, j + 1) + su(i - 1, j + 1));
    let thV = 2.0 * P.omega * sin(latF(j)) * dt * P.coriolis;
    v = v - ubar * thV;
  }
  // nudging: the advected vorticity Z.y moves toward the curl of the
  // target wind (its divergent part has no say in this flow); storm cores
  // (weight in SCR.w from goalpass) pull harder
  if (P.nudge > 0.0 && !top) {
    let zo = ((Z[idx(i + 1, j)].w - Z[c].w) / dl() - (Z[idx(i, j + 1)].z * cos(latC(j + 1)) - Z[c].z * cos(latC(j))) / dp()) / (P.R * cosF(j));
    let tau = mix(P.tauBg, P.tauStorm, max(SCR[c].w, SCR[idx(i + 1, j)].w));
    Z[c].y = mix(Z[c].y, zo, (1.0 - exp(-dt / tau)) * P.nudge);
  }
  // dye: mass fixer, then a slow return to the pattern (page only)
  var d = S2[c].z;
  if (P.massFix == 1u && SUM[1] > 1e-12) { d = d * SUM[0] / SUM[1]; }
  if (P.dyeRelax > 0.0) { d = mix(d, dye0(latU, (f32(i) + 0.5) * dl()), 1.0 - exp(-dt / P.dyeRelax)); }
  S2[c] = vec4f(u, v, d, S2[c].w);
}
@compute @workgroup_size(64)
fn commit(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x; if (c >= P.nx * P.ny) { return; }
  S[c] = S2[c];
}

// ── FFT along rows (radix 2, in workgroup memory) ───────────────────────
var<workgroup> sh: array<vec2f, 1024>;
fn cmul(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
@compute @workgroup_size(256)
fn fft_rows(@builtin(workgroup_id) w: vec3u, @builtin(local_invocation_id) l: vec3u) {
  let n = P.nx; let base = w.x * n;
  for (var i = l.x; i < n; i += 256u) {
    let r = reverseBits(i) >> (32u - P.log2nx);
    sh[r] = C[base + i];
  }
  workgroupBarrier();
  var half = 1u;
  for (var s = 0u; s < P.log2nx; s++) {
    for (var b = l.x; b < n / 2u; b += 256u) {
      let k = b % half;
      let i0 = (b / half) * half * 2u + k; let i1 = i0 + half;
      let ang = OP.dir * PI * f32(k) / f32(half);
      let t = cmul(vec2f(cos(ang), sin(ang)), sh[i1]);
      let a = sh[i0];
      sh[i0] = a + t; sh[i1] = a - t;
    }
    workgroupBarrier();
    half = half * 2u;
  }
  for (var i = l.x; i < n; i += 256u) { C[base + i] = sh[i]; }
}

// ── polar filter ────────────────────────────────────────────────────────
@compute @workgroup_size(64)
fn filt_load(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x; if (c >= P.nx * P.ny) { return; }
  C[c] = S[c].xy;
}
@compute @workgroup_size(64)
fn filt_apply(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x; if (c >= P.nx * P.ny) { return; }
  let m = c % P.nx; let j = i32(c / P.nx);
  let mm = f32(min(m, P.nx - m));
  let mc = 0.5 * f32(P.nx) * cos(latC(j)) / P.cosFilter;
  var h = 1.0;
  if (mm > mc) { h = (mc / mm) * (mc / mm); }
  C[c] = C[c] * h;
}
@compute @workgroup_size(64)
fn filt_store(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x; if (c >= P.nx * P.ny) { return; }
  let q = C[c] / f32(P.nx);
  let top = c / P.nx == P.ny - 1u;
  S[c] = vec4f(q.x, select(q.y, 0.0, top), S[c].z, S[c].w);
}

// ── projection ──────────────────────────────────────────────────────────
fn vS(i: i32, j: i32) -> f32 {
  if (j < 0 || j >= i32(P.ny) - 1) { return 0.0; }
  return S[idx(i, j)].y;
}
@compute @workgroup_size(64)
fn div(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x; if (c >= P.nx * P.ny) { return; }
  let i = i32(c % P.nx); let j = i32(c / P.nx);
  let cj = cos(latC(j));
  let du = (S[c].x - S[idx(i - 1, j)].x) / (cj * dl());
  let dv = (vS(i, j) * cosF(j) - vS(i, j - 1) * cosF(j - 1)) / (cj * dp());
  C[c] = vec2f((du + dv) * P.R, 0.0);       // R^2 D = R (du + dv)
}
// One thread per zonal wavenumber m: solve L p = R^2 D down the column.
@compute @workgroup_size(64)
fn solve(@builtin(global_invocation_id) g: vec3u) {
  let m = g.x; if (m >= P.nx) { return; }
  let ny = i32(P.ny); let nx = P.nx;
  let dpp = dp(); let dll = dl();
  if (m == 0u) {
    // m = 0: integrate the flux from the south pole (no tridiagonal)
    // (read each row's right-hand side before the row is written)
    var fl = vec2f(0.0); var p = vec2f(0.0);
    var rhs = C[0];
    C[0] = p;
    for (var j = 0; j < ny - 1; j++) {
      fl = fl + rhs * cos(latC(j)) * dpp;
      p = p + fl * dpp / cosF(j);
      rhs = C[u32(j + 1) * nx];
      C[u32(j + 1) * nx] = p;
    }
    return;
  }
  let lam = 2.0 * cos(2.0 * PI * f32(m) / f32(nx)) - 2.0;
  var cp = 0.0; var dpv = vec2f(0.0);
  for (var j = 0; j < ny; j++) {
    let cj = cos(latC(j));
    let a = cosF(j - 1) / (cj * dpp * dpp);
    let cc = cosF(j) / (cj * dpp * dpp);
    let b = -(a + cc) + lam / (cj * cj * dll * dll);
    let den = b - a * cp;
    let rhs = C[u32(j) * nx + m];
    cp = cc / den;
    dpv = (rhs - a * dpv) / den;
    SCR[u32(j) * nx + m] = vec4f(cp, dpv, SCR[u32(j) * nx + m].w);
  }
  var p = dpv;
  C[u32(ny - 1) * nx + m] = p;
  for (var j = ny - 2; j >= 0; j--) {
    let q = SCR[u32(j) * nx + m];
    p = q.yz - q.x * p;
    C[u32(j) * nx + m] = p;
  }
}
@compute @workgroup_size(64)
fn pstore(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x; if (c >= P.nx * P.ny) { return; }
  S[c].w = C[c].x / f32(P.nx);
}
@compute @workgroup_size(64)
fn project(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x; if (c >= P.nx * P.ny) { return; }
  let i = i32(c % P.nx); let j = i32(c / P.nx);
  let p = S[c].w;
  let cj = cos(latC(j));
  S[c].x = S[c].x - (S[idx(i + 1, j)].w - p) / (P.R * cj * dl());
  if (j < i32(P.ny) - 1) { S[c].y = S[c].y - (S[idx(i, j + 1)].w - p) / (P.R * dp()); }
  else { S[c].y = 0.0; }
}

// ── vorticity correction (corner Poisson) ───────────────────────────────
@compute @workgroup_size(64)
fn zeta_rhs(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x; if (c >= P.nx * P.ny) { return; }
  let i = i32(c % P.nx); let j = i32(c / P.nx);
  if (j < i32(P.ny) - 1) { C[c] = vec2f((Z[c].y - curlS(i, j)) * P.R * P.R, 0.0); }
  else { C[c] = vec2f(0.0); }
}
// corner rows k = 0 .. NY-2 at lat -90 + (k + 1) dp; psi = 0 at both poles
@compute @workgroup_size(64)
fn solve_psi(@builtin(global_invocation_id) g: vec3u) {
  let m = g.x; if (m >= P.nx) { return; }
  let nk = i32(P.ny) - 1; let nx = P.nx;
  let dpp = dp(); let dll = dl();
  let lam = 2.0 * cos(2.0 * PI * f32(m) / f32(nx)) - 2.0;
  var cp = 0.0; var dpv = vec2f(0.0);
  for (var k = 0; k < nk; k++) {
    let ck = cosF(k);
    let a = cos(latC(k)) / (ck * dpp * dpp);
    let cc = cos(latC(k + 1)) / (ck * dpp * dpp);
    let b = -(a + cc) + lam / (ck * ck * dll * dll);
    let aa = select(a, 0.0, k == 0);
    let den = b - aa * cp;
    let rhs = C[u32(k) * nx + m];
    cp = select(cc, 0.0, k == nk - 1) / den;
    dpv = (rhs - aa * dpv) / den;
    SCR[u32(k) * nx + m] = vec4f(cp, dpv, SCR[u32(k) * nx + m].w);
  }
  var p = dpv;
  C[u32(nk - 1) * nx + m] = p;
  for (var k = nk - 2; k >= 0; k--) {
    let q = SCR[u32(k) * nx + m];
    p = q.yz - q.x * p;
    C[u32(k) * nx + m] = p;
  }
  C[u32(nk) * nx + m] = vec2f(0.0);
}
@compute @workgroup_size(64)
fn psi_store(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x; if (c >= P.nx * P.ny) { return; }
  S2[c].w = C[c].x / f32(P.nx);
}
fn psiK(i: i32, k: i32) -> f32 {
  if (k < 0 || k >= i32(P.ny) - 1) { return 0.0; }
  return S2[idx(i, k)].w;
}
@compute @workgroup_size(64)
fn psi_apply(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x; if (c >= P.nx * P.ny) { return; }
  let i = i32(c % P.nx); let j = i32(c / P.nx);
  S[c].x = S[c].x - (psiK(i, j) - psiK(i, j - 1)) / (P.R * dp());
  if (j < i32(P.ny) - 1) { S[c].y = S[c].y + (psiK(i, j) - psiK(i - 1, j)) / (P.R * cosF(j) * dl()); }
}

// ── diagnostics for the globe: speed, cyclonic vorticity, p, dye ────────
fn uC(i: i32, j: i32) -> vec2f {
  let jj = clamp(j, 0, i32(P.ny) - 1);
  return vec2f(0.5 * (S[idx(i, jj)].x + S[idx(i - 1, jj)].x), 0.5 * (vS(i, jj) + vS(i, jj - 1)));
}
@compute @workgroup_size(64)
fn diag(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x; if (c >= P.nx * P.ny) { return; }
  let i = i32(c % P.nx); let j = i32(c / P.nx);
  let w = uC(i, j);
  let lat = latC(j); let cj = cos(lat);
  let jn = min(j + 1, i32(P.ny) - 1); let js = max(j - 1, 0);
  let dvdl = (uC(i + 1, j).y - uC(i - 1, j).y) / (2.0 * dl());
  let ducos = (uC(i, jn).x * cos(latC(jn)) - uC(i, js).x * cos(latC(js))) / (f32(jn - js) * dp());
  let zeta = (dvdl - ducos) / (P.R * cj);
  let t = goal(lat, (f32(i) + 0.5) * dl());
  let cyc = zeta * sign(lat) * 1e5;
  textureStore(DIAG, vec2u(u32(i), u32(j)), vec4f(length(w), cyc, t.z - 1000.0, S[c].z));
}
